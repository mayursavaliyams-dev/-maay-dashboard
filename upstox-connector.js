/**
 * UPSTOX CONNECTOR — drop-in replacement for LiveConnector (Dhan).
 *
 * Solves the Dhan "Data APIs not subscribed" (HTTP 451) block: Upstox provides
 * live index quotes, full option chain (LTP+OI+greeks), and intraday candles on
 * a Plus plan token. Exposes the SAME public interface server.js depends on:
 *   connect, getNiftyPrice, getBankNiftyPrice, getSensexPrice,
 *   getNiftyOptionChain, getBankNiftyOptionChain, getOptionChain,
 *   getPositions, getOrders, placeOrder, isMarketOpen, disconnect,
 *   .connected, .client._post('/v2/charts/intraday', ...)
 *
 * Auth: UPSTOX_ACCESS_TOKEN in .env (Analytics token, ~1yr validity).
 */
const fetch = require('node-fetch');

const BASE = 'https://api.upstox.com/v2';
const CHAIN_CACHE_MS = 4500;
const PRICE_CACHE_MS = 4000;

// Upstox instrument keys
const IKEY = {
  NIFTY:     'NSE_INDEX|Nifty 50',
  BANKNIFTY: 'NSE_INDEX|Nifty Bank',
  SENSEX:    'BSE_INDEX|SENSEX',
};
const STEP = { NIFTY: 50, BANKNIFTY: 100, SENSEX: 100 };

function enc(k) { return encodeURIComponent(k); }

class UpstoxConnector {
  constructor(config = {}) {
    this.accessToken = config.accessToken || process.env.UPSTOX_ACCESS_TOKEN || '';
    this.connected = false;
    this._priceCache = {};   // inst -> { at, data }
    this._chainCache = {};   // inst -> { at, data }
    this._expiryCache = {};  // inst -> { at, list }
    this._stats = { calls: 0, errors: 0, lastError: null, lastCallAt: 0 };
    // .client shim so server.js's live.client._post('/v2/charts/intraday', body) works.
    this.client = {
      _post: (path, body, opts) => this._clientPost(path, body, opts),
      getStats: () => ({ ...this._stats, coalesced: 0, cacheHits: 0, inflight: 0, cached: 0,
                         rateLimited: 0, authErrors: this._stats.errors, minIntervalMs: 0 }),
    };
  }

  async _get(path) {
    this._stats.calls++; this._stats.lastCallAt = Date.now();
    const r = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${this.accessToken}`, Accept: 'application/json' },
      timeout: 15000,
    });
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { j = { raw: txt }; }
    if (!r.ok || j.status === 'error') {
      this._stats.errors++; this._stats.lastError = `${r.status} ${(j.errors && j.errors[0] && j.errors[0].message) || txt.slice(0, 120)}`;
      const e = new Error(`Upstox ${path}: ${this._stats.lastError}`); e.status = r.status; throw e;
    }
    return j;
  }

  async connect() {
    if (!this.accessToken) { console.warn('[upstox] no UPSTOX_ACCESS_TOKEN'); this.connected = false; return false; }
    try {
      // profile/quote sanity check
      const j = await this._get(`/market-quote/ltp?instrument_key=${enc(IKEY.NIFTY)}`);
      const px = j?.data?.['NSE_INDEX:Nifty 50']?.last_price;
      this.connected = px > 0;
      console.log(`[upstox] ${this.connected ? '✓ connected — NIFTY ' + px : 'connect failed'}`);
      return this.connected;
    } catch (e) { console.warn('[upstox] connect error:', e.message); this.connected = false; return false; }
  }

  _assertConnected() { if (!this.connected) throw Object.assign(new Error('Upstox not connected — set UPSTOX_ACCESS_TOKEN'), { code: 'UPSTOX_AUTH' }); }

  // ── index price ───────────────────────────────────────────────
  async _indexPrice(inst) {
    const cache = this._priceCache[inst];
    if (cache && Date.now() - cache.at < PRICE_CACHE_MS) return cache.data;
    this._assertConnected();
    const key = IKEY[inst];
    const j = await this._get(`/market-quote/ltp?instrument_key=${enc(key)}`);
    // response key uses ':' not '|'
    const respKey = key.replace('|', ':');
    const p = Number(j?.data?.[respKey]?.last_price || 0);
    const data = { price: p, volume: 0, open: 0, high: 0, low: 0, close: p, timestamp: new Date(), source: 'upstox' };
    this._priceCache[inst] = { at: Date.now(), data };
    return data;
  }
  async getNiftyPrice()     { return this._indexPrice('NIFTY'); }
  async getBankNiftyPrice() { return this._indexPrice('BANKNIFTY'); }
  async getSensexPrice()    { return this._indexPrice('SENSEX'); }

  // ── nearest expiry ────────────────────────────────────────────
  async _nextExpiry(inst) {
    const c = this._expiryCache[inst];
    if (c && Date.now() - c.at < 3600 * 1000) return c.list[0];
    const j = await this._get(`/option/contract?instrument_key=${enc(IKEY[inst])}`);
    const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const list = [...new Set((j.data || []).map(x => x.expiry))].filter(d => d >= today).sort();
    this._expiryCache[inst] = { at: Date.now(), list };
    return list[0];
  }

  _leg(o) {
    if (!o) return {};
    const md = o.market_data || {}, g = o.option_greeks || {};
    const oi = Number(md.oi || 0), prevOi = Number(md.prev_oi || 0);
    return {
      securityId: o.instrument_key || null,
      ltp: Number(md.ltp || 0),
      oi, changeOI: prevOi ? (oi - prevOi) : 0,
      volume: Number(md.volume || 0),
      iv: Number(g.iv || 0),
      open: 0, high: 0, low: 0, close: Number(md.close_price || 0),
      prevClose: Number(md.close_price || 0),
      bid: Number(md.bid_price || 0), ask: Number(md.ask_price || 0),
      bidQty: Number(md.bid_qty || 0), askQty: Number(md.ask_qty || 0),
      delta: Number(g.delta || 0), gamma: Number(g.gamma || 0),
      theta: Number(g.theta || 0), vega: Number(g.vega || 0),
      pop: Number(g.pop || 0),
    };
  }

  async _chain(inst, spotPrice = null) {
    const cache = this._chainCache[inst];
    if (cache && Date.now() - cache.at < CHAIN_CACHE_MS) return cache.data;
    this._assertConnected();
    const expiry = await this._nextExpiry(inst);
    if (!expiry) throw new Error(`Upstox: no expiry for ${inst}`);
    const j = await this._get(`/option/chain?instrument_key=${enc(IKEY[inst])}&expiry_date=${expiry}`);
    const rows = (j.data || []);
    const strikes = rows.map(r => ({
      strike: Number(r.strike_price),
      ce: this._leg(r.call_options),
      pe: this._leg(r.put_options),
    })).sort((a, b) => a.strike - b.strike);
    const spot = Number((rows[0] && rows[0].underlying_spot_price) || spotPrice || 0);
    const step = STEP[inst] || 50;
    const atmStrike = Math.round(spot / step) * step;
    const data = { spotPrice: spot, atmStrike, strikes, timestamp: new Date(), source: 'upstox', expiry };
    this._chainCache[inst] = { at: Date.now(), data };
    return data;
  }
  async getNiftyOptionChain(spot = null)     { return this._chain('NIFTY', spot); }
  async getBankNiftyOptionChain(spot = null) { return this._chain('BANKNIFTY', spot); }
  async getOptionChain(spot = null)          { return this._chain('SENSEX', spot); }

  // ── intraday candles — .client._post('/v2/charts/intraday', body) shim ──
  // server.js sends { securityId, exchangeSegment, instrument, interval, fromDate, toDate }.
  // Map securityId (Dhan numeric) → Upstox instrument key, return { timestamp,open,high,low,close,volume } arrays.
  async _clientPost(path, body) {
    if (path.includes('charts/intraday')) {
      const sid = String(body.securityId || '');
      // Dhan ids: NIFTY=13, SENSEX=51, BANKNIFTY=25 → upstox keys
      const inst = sid === '13' ? 'NIFTY' : sid === '25' ? 'BANKNIFTY' : sid === '51' ? 'SENSEX'
                 : body.instrument === 'OPTIDX' ? null : 'NIFTY';
      const ikey = inst ? IKEY[inst] : null;
      if (!ikey) return { timestamp: [], open: [], high: [], low: [], close: [], volume: [] }; // option intraday not mapped
      // Upstox's intraday endpoint only returns TODAY. server.js's last-session-hl
      // walks back to past days, so for a past fromDate use the HISTORICAL endpoint.
      const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
      const reqDate = String(body.fromDate || '').slice(0, 10);  // 'YYYY-MM-DD' (may have a time suffix)
      let candles = [];
      try {
        if (/^\d{4}-\d{2}-\d{2}$/.test(reqDate) && reqDate < today) {
          const j = await this._get(`/historical-candle/${enc(ikey)}/1minute/${reqDate}/${reqDate}`);
          candles = (j?.data?.candles || []).slice().reverse();
        } else {
          const j = await this._get(`/historical-candle/intraday/${enc(ikey)}/1minute`);
          candles = (j?.data?.candles || []).slice().reverse(); // upstox returns newest-first
        }
      } catch (_) { candles = []; }   // graceful — caller handles empty
      const out = { timestamp: [], open: [], high: [], low: [], close: [], volume: [] };
      for (const c of candles) {
        out.timestamp.push(Math.floor(new Date(c[0]).getTime() / 1000));
        out.open.push(c[1]); out.high.push(c[2]); out.low.push(c[3]); out.close.push(c[4]); out.volume.push(c[5] || 0);
      }
      return out;
    }
    throw new Error(`Upstox client: unsupported path ${path}`);
  }

  // ── orders / positions (Upstox endpoints) ────────────────────
  async getPositions() {
    try { const j = await this._get('/portfolio/short-term-positions'); return j.data || []; }
    catch { return []; }
  }
  async getOrders() {
    try { const j = await this._get('/order/retrieve-all'); return j.data || []; }
    catch { return []; }
  }
  async placeOrder(/* params */) {
    // Live order placement intentionally not implemented here — keep paper-mode safe.
    // Wire to POST /v2/order/place with Upstox order schema when going live.
    throw new Error('Upstox placeOrder not implemented — paper mode only');
  }

  isMarketOpen() {
    const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
    const d = ist.getUTCDay(), m = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    return d >= 1 && d <= 5 && m >= 555 && m < 930;
  }
  isExpiryDay() { return false; }
  disconnect() { this.connected = false; }
  async refreshAuth({ accessToken } = {}) { if (accessToken) { this.accessToken = accessToken; return this.connect(); } }
}

module.exports = UpstoxConnector;
