/**
 * EQUITY DATA CONNECTOR — Dhan (cash equity) + paper price source
 *
 * Sibling of the options bot's live-connector.js, for STOCK symbols.
 *  - Live mode: Dhan HQ v2 REST for equity LTP (1-min charts) and order placement.
 *  - Paper mode (or when Dhan creds are absent): a deterministic random-walk
 *    price generator so the full pipeline (ORB → signal → entry → exit → journal)
 *    runs end-to-end without a broker. This is for VALIDATION only; it is clearly
 *    flagged source:'paper-sim' so it can never be mistaken for a real fill.
 *
 * Security IDs: Dhan keys equity orders by securityId (per its scrip master),
 * not by symbol. Map your watchlist symbols → securityIds in data/equity-ids.json:
 *   { "RELIANCE": "2885", "INFY": "1594", ... }
 * Without an id a symbol can still be paper-traded but NOT live-traded (we skip it).
 */

const path = require('path');
const fs   = require('fs');

const EQ_SEGMENT = 'NSE_EQ';
const WS_TICK_MAX_AGE_MS = 10000;

// Pull the Dhan REST client + WS feed from the parent options project so we
// don't duplicate the throttling / caching / auth logic.
let DhanClient = null, DhanWsFeed = null;
try { DhanClient = require('../backtest-real/dhan-client'); } catch (_) { /* paper-only */ }
try { DhanWsFeed = require('../dhan-ws-feed'); } catch (_) { /* optional */ }

function loadIdMap() {
  const file = path.resolve('./data/equity-ids.json');
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_) { return {}; }
}

class EquityConnector {
  constructor(config = {}) {
    this.config    = config;
    this.connected = false;
    this.client    = null;
    this.ws        = null;
    this.idMap     = loadIdMap();
    this._chartCache = new Map();   // securityId → { at, data }
    // Paper random-walk state per symbol (seeded from a plausible base price).
    this._paper = new Map();
    this.paperMode = (process.env.TRADE_MODE || 'paper') !== 'live';
  }

  async connect() {
    const clientId    = this.config.dhanClientId    || process.env.DHAN_CLIENT_ID;
    const accessToken = this.config.dhanAccessToken  || process.env.DHAN_ACCESS_TOKEN;

    // Paper mode with no creds → run the simulator. This is the default dev path.
    if (this.paperMode && (!clientId || !accessToken || !DhanClient)) {
      this.connected = true;
      console.log('[equity] PAPER mode — using simulated price feed (no Dhan creds needed)');
      return;
    }

    if (!clientId || !accessToken || clientId === 'your_dhan_client_id') {
      throw new Error('DHAN_CLIENT_ID / DHAN_ACCESS_TOKEN not set — equity live connector cannot start');
    }

    this.client = new DhanClient({ clientId, accessToken });
    this.connected = true;
    console.log('[equity] Connected to Dhan HQ v2 (equity)');

    if (DhanWsFeed && process.env.DHAN_WS_ENABLED !== 'false') {
      try {
        this.ws = new DhanWsFeed({ clientId, accessToken });
        this.ws.start();
        const subs = Object.values(this.idMap)
          .filter(Boolean)
          .map(securityId => ({ exchangeSegment: EQ_SEGMENT, securityId: String(securityId) }));
        if (subs.length) this.ws.subscribe(subs);
      } catch (e) {
        console.warn('[equity] WS feed failed, REST polling only:', e.message);
        this.ws = null;
      }
    }
  }

  resolveId(symbol) {
    return this.idMap[(symbol || '').toUpperCase()] || null;
  }

  // ── Live LTP for one equity symbol ──────────────────────────────
  // Returns { price, volume, open, high, low, close, timestamp, source }.
  async getQuote(symbol) {
    const sym = (symbol || '').toUpperCase();
    if (this.paperMode || !this.client) return this._paperQuote(sym);

    const securityId = this.resolveId(sym);
    if (!securityId) throw new Error(`no securityId mapped for ${sym} (add it to data/equity-ids.json)`);

    // Fresh WS tick wins.
    if (this.ws) {
      const tick = this.ws.getLast(securityId, EQ_SEGMENT);
      if (tick && tick.ltp > 0 && (Date.now() - tick.timestamp) < WS_TICK_MAX_AGE_MS) {
        return {
          price: Number(tick.ltp), volume: Number(tick.volume || 0),
          open: Number(tick.open || 0), high: Number(tick.high || 0),
          low: Number(tick.low || 0), close: Number(tick.close || 0),
          timestamp: new Date(tick.timestamp), source: 'dhan-ws'
        };
      }
    }

    const cached = this._chartCache.get(securityId);
    if (cached && Date.now() - cached.at < 5000) return cached.data;

    const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const r = await this.client._post('/v2/charts/intraday', {
      securityId: String(securityId),
      exchangeSegment: EQ_SEGMENT,
      instrument: 'EQUITY',
      interval: '1',
      fromDate: today,
      toDate: today
    });
    const closes = r?.close || [];
    const i = closes.length - 1;
    if (i < 0) throw new Error(`no chart data for ${sym} on ${today} (holiday or pre-open)`);
    const data = {
      price: Number(closes[i]),
      volume: Number((r.volume || [])[i] || 0),
      open: Number((r.open || [])[i] || 0),
      high: Number((r.high || [])[i] || 0),
      low: Number((r.low || [])[i] || 0),
      close: Number(closes[i]),
      timestamp: new Date(),
      source: 'dhan-charts'
    };
    this._chartCache.set(securityId, { at: Date.now(), data });
    return data;
  }

  // Deterministic-ish random walk for paper validation. Seeds a base price per
  // symbol, drifts it each call. Volume oscillates so volume-confirm logic exercises.
  _paperQuote(sym) {
    let st = this._paper.get(sym);
    if (!st) {
      // Base price from a small built-in table; unknown symbols start at ₹1000.
      const bases = { RELIANCE: 2900, HDFCBANK: 1650, INFY: 1500, TCS: 3900, ICICIBANK: 1150 };
      const base = bases[sym] || 1000;
      st = { price: base, open: base, high: base, low: base, vol: 0, ticks: 0 };
      this._paper.set(sym, st);
    }
    // ±0.15% step, gentle upward bias so paper sessions occasionally trigger longs.
    const step = (Math.random() - 0.48) * 0.0015;
    st.price = +(st.price * (1 + step)).toFixed(2);
    st.high  = Math.max(st.high, st.price);
    st.low   = Math.min(st.low, st.price);
    st.vol   = Math.round(50000 + Math.random() * 150000);
    st.ticks++;
    return {
      price: st.price, volume: st.vol,
      open: st.open, high: st.high, low: st.low, close: st.price,
      timestamp: new Date(), source: 'paper-sim'
    };
  }

  // ── Order placement (live equity) ───────────────────────────────
  async placeOrder(params) {
    if (this.paperMode || !this.client) {
      return { status: 'PAPER', orderId: `PAPER-${Date.now()}`, raw: null };
    }
    const clientId = this.config.dhanClientId || process.env.DHAN_CLIENT_ID;
    const body = {
      dhanClientId: clientId,
      correlationId: params.correlationId || `ag-stk-${Date.now()}`,
      transactionType: params.transactionType,       // BUY | SELL
      exchangeSegment: params.exchangeSegment || EQ_SEGMENT,
      productType: params.productType || 'INTRADAY',  // INTRADAY (MIS) | CNC (delivery)
      orderType: params.orderType || 'MARKET',
      validity: params.validity || 'DAY',
      securityId: String(params.securityId),
      quantity: Number(params.quantity),
      disclosedQuantity: params.disclosedQuantity ?? 0,
      price: params.orderType === 'LIMIT' ? Number(params.price) : 0,
      triggerPrice: params.triggerPrice ?? 0,
      afterMarketOrder: false
    };
    const res = await this.client._post('/v2/orders', body);
    return { status: res?.orderStatus || res?.status || 'SUBMITTED', orderId: res?.orderId, raw: res };
  }

  isMarketOpen() {
    const now = new Date();
    const ist = new Date(now.getTime() + 5.5 * 3600 * 1000 - now.getTimezoneOffset() * 60 * 1000);
    const day = ist.getUTCDay();
    if (day === 0 || day === 6) return false;
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
  }

  disconnect() { this.connected = false; this.client = null; if (this.ws?.stop) this.ws.stop(); }
}

module.exports = EquityConnector;
