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
// Latency knobs (env-tunable). Lower = fresher data / less lag, more API calls.
// Upstox Plus comfortably handles these; raise if you ever hit rate limits.
const CHAIN_CACHE_MS = Number(process.env.UPSTOX_CHAIN_CACHE_MS) || 2500;  // was 4500
/* Bounds for the adaptive floor. 20s is the widest it may go: past that the chain is
   too stale to trade from, and a screen showing minute-old option prices is worse
   than one that admits it cannot reach the broker. Three clean fetches before
   relaxing a step, so a single lucky call does not undo a backoff. */
const MAX_INTERVAL_MS = Number(process.env.UPSTOX_MAX_INTERVAL_MS) || 20000;
const CLEAN_RUNS_TO_RELAX = 3;
const PRICE_CACHE_MS = Number(process.env.UPSTOX_PRICE_CACHE_MS) || 1500;  // was 4000

// Upstox instrument keys
const IKEY = {
  NIFTY:     'NSE_INDEX|Nifty 50',
  BANKNIFTY: 'NSE_INDEX|Nifty Bank',
  SENSEX:    'BSE_INDEX|SENSEX',
};
// C1c-7: the strike interval used to live here as
//   const STEP = { NIFTY: 50, BANKNIFTY: 100, SENSEX: 100 };
// a third copy of the same map (registry, pop-seller, here). It now comes from the
// Instrument Registry via strike-resolver, so MIDCPNIFTY's interval of 25 can never be
// silently rounded to 50.
const strikeResolver = require('./strike-resolver.js');

function enc(k) { return encodeURIComponent(k); }

class UpstoxConnector {
  constructor(config = {}) {
    this.accessToken = config.accessToken || process.env.UPSTOX_ACCESS_TOKEN || '';
    this.connected = false;
    this._priceCache = {};   // inst -> { at, data }
    this._chainCache = {};   // inst -> { at, data, promise }
    this._expiryCache = {};  // inst -> { at, list }
    /* Cooldown after the broker says 429. Measured 2026-07-29 on a live session:
       477 rate-limit responses in one log, 458 of them from a single caller. The
       connector had no 429 handling at all — it logged the refusal and the next
       poll a second later asked again at exactly the same rate. */
    this._cooldown = {};     // inst -> epoch ms until which we must not call
    /* Adaptive minimum interval per instrument.
     *
     * Single-flight collapses SIMULTANEOUS callers, but the dashboard's fourteen
     * timers are staggered, not simultaneous — measured on the live connector after
     * coalescing was added, only 5 of 219 requests coalesced and the cache hit rate
     * was 7.3%. With a 2.5s TTL and something asking every 2 seconds, essentially
     * every tick is a miss, so the front end sets the broker call rate: about 24
     * chain fetches a minute per instrument, 72 across three.
     *
     * The TTL comment in this file records that it was lowered from 4500ms to 2500ms
     * to cut update lag. That loosened the only governor there was.
     *
     * I do not know the broker's exact limit, and guessing one would be a number
     * pretending to be a fact. So the interval widens when the broker refuses and
     * narrows again when it stops — the system finds the limit instead of asserting
     * it, and the stats say what it settled on. */
    this._minInterval = {};  // inst -> ms, starts at CHAIN_CACHE_MS
    this._cleanRuns = {};    // inst -> consecutive successful fetches
    /* `rateLimited` counts refusals seen at the HTTP layer; `cooldowns` counts the
       times we actually stopped calling because of one. They are not the same number
       and conflating them would hide whichever is the interesting one — a rising
       rateLimited with a flat cooldowns would mean the backoff is not engaging. */
    this._stats = { calls: 0, errors: 0, lastError: null, lastCallAt: 0,
                    coalesced: 0, cacheHits: 0, rateLimited: 0,
                    cooldowns: 0, cooldownServes: 0 };
    this._inflight = 0;
    // .client shim so server.js's live.client._post('/v2/charts/intraday', body) works.
    this.client = {
      _post: (path, body, opts) => this._clientPost(path, body, opts),
      /* These were hard-coded zeros. A statistic that always reports nothing cannot
         reveal the condition it exists to measure, and coalesced/inflight/rateLimited
         are exactly the numbers that would have shown this problem months ago. */
      getStats: () => ({ ...this._stats, inflight: this._inflight,
                         cached: Object.keys(this._chainCache).length,
                         authErrors: this._stats.errors,
                         minIntervalMs: CHAIN_CACHE_MS,
                         // What the floor has actually settled on per instrument —
                         // the number the system learned, not the one it was given.
                         effectiveIntervalMs: { ...this._minInterval },
                         cooldownUntil: { ...this._cooldown } }),
    };
  }

  async _get(path) {
    this._stats.calls++; this._stats.lastCallAt = Date.now();
    const r = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${this.accessToken}`, Accept: 'application/json' },
      timeout: Number(process.env.UPSTOX_TIMEOUT_MS) || 6000,  // was 15000 — fail fast, no long hangs
    });
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { j = { raw: txt }; }
    if (!r.ok || j.status === 'error') {
      this._stats.errors++; this._stats.lastError = `${r.status} ${(j.errors && j.errors[0] && j.errors[0].message) || txt.slice(0, 120)}`;
      const e = new Error(`Upstox ${path}: ${this._stats.lastError}`); e.status = r.status;
      // Carry the broker's own Retry-After up to the caller. Guessing a backoff when
      // the server has told you the number is worse than not backing off at all,
      // because it looks deliberate.
      if (r.status === 429) {
        this._stats.rateLimited++;
        const ra = Number(r.headers && r.headers.get && r.headers.get('retry-after'));
        e.retryAfterMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : null;
      }
      throw e;
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

  /* One upstream chain call per instrument at a time, whatever the callers do.
   *
   * WHY: the cache was {at, data} with no in-flight slot, so every caller that
   * arrived after the 2.5s TTL lapsed started its OWN fetch. The dashboard alone
   * runs fourteen timers — auto-movers at 2s, high/low at 4s, chain and watchlist at
   * 5-6s — and trade.html adds three more, across three instruments. Polling faster
   * than the TTL meant every tick was a miss, and every miss was a burst of parallel
   * calls rather than one. Measured result: 477 rate-limit refusals in a single
   * session log, 458 of them from one endpoint.
   *
   * Callers arriving during a fetch now await the same promise. N callers, one call.
   */
  _interval(inst) { return this._minInterval[inst] || CHAIN_CACHE_MS; }

  async _chain(inst, spotPrice = null) {
    const cache = this._chainCache[inst];
    if (cache && Date.now() - cache.at < this._interval(inst)) { this._stats.cacheHits++; return cache.data; }
    if (cache && cache.promise) { this._stats.coalesced++; return cache.promise; }

    // The broker asked us to stop. Serve the last good chain and say nothing new was
    // fetched, rather than spending the cooldown proving it meant it.
    const until = this._cooldown[inst] || 0;
    if (Date.now() < until) {
      if (cache && cache.data) { this._stats.cooldownServes++; return cache.data; }
      throw new Error(`Upstox ${inst}: rate-limited, cooling off for ${Math.ceil((until - Date.now())/1000)}s and no cached chain to serve`);
    }

    /* Both outcomes are booked HERE, next to each other. They used to be split —
       failure handled in this function, success handled inside _fetchChain — and the
       half that lived further away was the half that got missed: the floor widened on
       a refusal but never narrowed again, because the relaxing branch sat behind a
       function a test could replace. Bookkeeping that lives in two places is
       bookkeeping where one place is wrong. */
    const p = this._fetchChain(inst, spotPrice)
      .then(data => {
        delete this._cooldown[inst];
        this._cleanRuns[inst] = (this._cleanRuns[inst] || 0) + 1;
        if (this._cleanRuns[inst] >= CLEAN_RUNS_TO_RELAX && this._interval(inst) > CHAIN_CACHE_MS) {
          this._cleanRuns[inst] = 0;
          this._minInterval[inst] = Math.max(CHAIN_CACHE_MS, Math.round(this._interval(inst) / 1.5));
        }
        return data;
      })
      .catch(e => {
        if (e && e.status === 429) {
          // Honour Retry-After when the broker sends one; otherwise a flat 30s, which
          // is long enough to actually clear a burst and short enough that a live
          // session recovers on its own.
          const wait = e.retryAfterMs || 30000;
          this._cooldown[inst] = Date.now() + wait;
          this._stats.cooldowns++;
          // Widen the floor as well as pausing. The pause clears the burst; the floor
          // is what stops it re-forming the moment the pause ends.
          this._cleanRuns[inst] = 0;
          this._minInterval[inst] = Math.min(MAX_INTERVAL_MS, this._interval(inst) * 2);
          console.warn(`[upstox] ${inst} rate-limited — pausing chain fetches for ${Math.round(wait/1000)}s and widening the floor to ${this._minInterval[inst]}ms; serving the cached chain meanwhile`);
        }
        throw e;
      })
      .finally(() => {
        this._inflight--;
        const c = this._chainCache[inst];
        if (c) c.promise = null;
      });

    this._inflight++;
    this._chainCache[inst] = { ...(cache || { at: 0, data: null }), promise: p };
    return p;
  }

  async _fetchChain(inst, spotPrice = null) {
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
    // C1c-7: interval from the registry; null (not a fabricated 0) when spot is unusable.
    const atmStrike = strikeResolver.atm(inst, spot);
    const data = { spotPrice: spot, atmStrike, strikes, timestamp: new Date(), source: 'upstox', expiry };
    // Keep the in-flight slot: replacing the whole entry here would drop the promise
    // that concurrent callers are already awaiting. It happens to be safe today only
    // because the fresh `at` makes them take the TTL branch first, and relying on
    // that ordering is how a coalescing bug gets reintroduced.
    const prev = this._chainCache[inst];
    this._chainCache[inst] = { at: Date.now(), data, promise: prev ? prev.promise : null };
    // Cooldown clearing and floor relaxation are booked by the caller, _chain, so
    // that both outcomes are handled in one place. This function only fetches.
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
