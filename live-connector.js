/**
 * LIVE DATA CONNECTOR — Dhan only
 * Uses Dhan HQ v2 REST API for live quotes, option chain, and order placement.
 * No demo fallback: if Dhan is unreachable or credentials are missing, calls throw.
 */

const DhanClient = require('./backtest-real/dhan-client');
const DhanWsFeed = require('./dhan-ws-feed');

const SENSEX_SECURITY_ID = process.env.DHAN_SENSEX_SECURITY_ID || '51';
const NIFTY_SECURITY_ID  = process.env.DHAN_NIFTY_SECURITY_ID  || '13';
const IDX_SEGMENT = 'IDX_I';
const SENSEX_SEGMENT = IDX_SEGMENT;
const WS_TICK_MAX_AGE_MS = 10000;   // accept WS tick if it arrived in the last 10s

class LiveConnector {
  constructor(config = {}) {
    this.config = config;
    this.connected = false;
    this.lastPrice = null;
    this.lastUpdate = null;
    this.client = null;
    // Short-lived chain caches (3s TTL) to avoid duplicate calls in the same tick
    this._sensexChainCache = null;
    this._sensexChainAt = 0;
    this._niftyChainCache = null;
    this._niftyChainAt = 0;
  }

  async connect() {
    const clientId = this.config.dhanClientId || process.env.DHAN_CLIENT_ID;
    const accessToken = this.config.dhanAccessToken || process.env.DHAN_ACCESS_TOKEN;

    if (!clientId || !accessToken || clientId === 'your_dhan_client_id') {
      throw new Error('DHAN_CLIENT_ID / DHAN_ACCESS_TOKEN not set — live connector cannot start');
    }

    this.client = new DhanClient({ clientId, accessToken });
    this.connected = true;
    console.log('[live] Connected to Dhan HQ v2');

    // Start WebSocket live tick feed for the three indices.
    if (process.env.DHAN_WS_ENABLED !== 'false') {
      try {
        this.ws = new DhanWsFeed({ clientId, accessToken });
        this.ws.start();
        this.ws.subscribe([
          { exchangeSegment: IDX_SEGMENT, securityId: NIFTY_SECURITY_ID  },
          { exchangeSegment: IDX_SEGMENT, securityId: SENSEX_SECURITY_ID },
          { exchangeSegment: IDX_SEGMENT, securityId: '25' /* BANKNIFTY */ },
        ]);
      } catch (e) {
        console.warn('[live] WS feed failed to start, falling back to REST polling:', e.message);
        this.ws = null;
      }
    }
  }

  _assertConnected() {
    if (!this.connected) throw new Error('Dhan not connected — check DHAN_CLIENT_ID / DHAN_ACCESS_TOKEN');
  }

  async getNiftyPrice() {
    return this._getIndexPriceFromCharts(NIFTY_SECURITY_ID, IDX_SEGMENT, '_niftyChartCache', '_niftyChartAt');
  }

  // /v2/marketfeed/quote returns empty {} for index data even with Data API
  // active on this account. Last 1-min candle from /v2/charts/intraday is the
  // working fallback — gives same OHLCV for both indices with proper volume.
  async _getIndexPriceFromCharts(securityId, segment, cacheKey, atKey) {
    this._assertConnected();
    // Prefer WebSocket live tick if it's fresh (≤10s old) — sub-second price feed.
    if (this.ws) {
      const tick = this.ws.getLast(securityId, segment);
      if (tick && tick.ltp > 0 && (Date.now() - tick.timestamp) < WS_TICK_MAX_AGE_MS) {
        return {
          price:  Number(tick.ltp),
          volume: Number(tick.volume || 0),
          open:   Number(tick.open  || 0),
          high:   Number(tick.high  || 0),
          low:    Number(tick.low   || 0),
          close:  Number(tick.close || 0),
          timestamp: new Date(tick.timestamp),
          source: 'dhan-ws',
        };
      }
    }
    if (this[cacheKey] && Date.now() - this[atKey] < 5000) return this[cacheKey];
    const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    const r = await this.client._post('/v2/charts/intraday', {
      securityId: String(securityId),
      exchangeSegment: segment,
      instrument: 'INDEX',
      interval: '1',
      fromDate: today,
      toDate: today,
    });
    const closes = r?.close || [];
    const i = closes.length - 1;
    if (i < 0) throw new Error(`no chart data for ${today} (market holiday or pre-open)`);
    const result = {
      price:  Number(closes[i]),
      volume: Number((r.volume || [])[i] || 0),
      open:   Number((r.open  || [])[i] || 0),
      high:   Number((r.high  || [])[i] || 0),
      low:    Number((r.low   || [])[i] || 0),
      close:  Number(closes[i]),
      timestamp: new Date(),
      source: 'dhan-charts',
    };
    this[cacheKey] = result;
    this[atKey] = Date.now();
    return result;
  }

  // Fetch valid expiries from Dhan (cached 1 hour per underlying) and return
  // the nearest expiry ≥ today in YYYY-MM-DD format. Self-correcting across
  // schedule changes (SEBI rationalization, holiday shifts, etc.).
  async _getNextExpiry(underlyingScrip, segment) {
    const key = `${underlyingScrip}|${segment}`;
    this._expiryCache = this._expiryCache || {};
    const cached = this._expiryCache[key];
    if (cached && Date.now() - cached.at < 3600 * 1000) {
      return this._pickNearestExpiry(cached.list);
    }
    const res = await this.client._post('/v2/optionchain/expirylist', {
      UnderlyingScrip: Number(underlyingScrip),
      UnderlyingSeg: segment
    });
    const list = Array.isArray(res?.data) ? res.data : [];
    this._expiryCache[key] = { at: Date.now(), list };
    return this._pickNearestExpiry(list);
  }

  _pickNearestExpiry(list) {
    if (!list || !list.length) return '';
    const todayIST = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    return list.find(d => d >= todayIST) || list[0];
  }

  _pickLeg(leg) {
    return leg ? {
      securityId: leg.security_id ?? leg.securityId ?? null,
      ltp: leg.last_price ?? 0,
      oi:  leg.oi ?? 0,
      changeOI: leg.previous_oi !== undefined ? (leg.oi - leg.previous_oi) : 0,
      volume: leg.volume ?? 0,
      iv:  leg.implied_volatility ?? 0,
      open:  leg.ohlc?.open  ?? 0,
      high:  leg.ohlc?.high  ?? 0,
      low:   leg.ohlc?.low   ?? 0,
      close: leg.ohlc?.close ?? 0,
      prevClose: leg.previous_close_price ?? leg.ohlc?.close ?? 0,
      bid:   leg.top_bid_price ?? 0,
      ask:   leg.top_ask_price ?? 0,
      bidQty: leg.top_bid_quantity ?? 0,
      askQty: leg.top_ask_quantity ?? 0
    } : {};
  }

  async getNiftyOptionChain(spotPrice = null) {
    if (this._niftyChainCache && Date.now() - this._niftyChainAt < 8000) return this._niftyChainCache;
    this._assertConnected();
    const expiry = await this._getNextExpiry(NIFTY_SECURITY_ID, IDX_SEGMENT);
    const body = { UnderlyingScrip: Number(NIFTY_SECURITY_ID), UnderlyingSeg: IDX_SEGMENT, Expiry: expiry };
    const res  = await this.client._post('/v2/optionchain', body);
    const oc   = res?.data?.oc || res?.data || {};
    const strikes = [];
    for (const strikeStr of Object.keys(oc)) {
      const row = oc[strikeStr];
      strikes.push({ strike: Number(strikeStr), ce: this._pickLeg(row?.ce), pe: this._pickLeg(row?.pe) });
    }
    const spot = Number(res?.data?.last_price ?? spotPrice ?? 0);
    const atmStrike = Math.round(spot / 50) * 50;
    const result = { spotPrice: spot, atmStrike, strikes: strikes.sort((a, b) => a.strike - b.strike),
                     timestamp: new Date(), source: 'dhan' };
    this._niftyChainCache = result;
    this._niftyChainAt = Date.now();
    return result;
  }

  async getSensexPrice() {
    const r = await this._getIndexPriceFromCharts(SENSEX_SECURITY_ID, SENSEX_SEGMENT, '_sensexChartCache', '_sensexChartAt');
    this.lastPrice = r.price;
    this.lastUpdate = r.timestamp;
    return r;
  }

  async getOptionChain(spotPrice = null) {
    if (this._sensexChainCache && Date.now() - this._sensexChainAt < 8000) return this._sensexChainCache;
    this._assertConnected();
    const expiry = this.config.expiryDate
      || await this._getNextExpiry(SENSEX_SECURITY_ID, SENSEX_SEGMENT);
    const body = {
      UnderlyingScrip: Number(SENSEX_SECURITY_ID),
      UnderlyingSeg: SENSEX_SEGMENT,
      Expiry: expiry
    };
    const res = await this.client._post('/v2/optionchain', body);

    const oc = res?.data?.oc || res?.data || {};
    const strikes = [];
    for (const strikeStr of Object.keys(oc)) {
      const row = oc[strikeStr];
      strikes.push({ strike: Number(strikeStr), ce: this._pickLeg(row?.ce), pe: this._pickLeg(row?.pe) });
    }

    const spot = Number(res?.data?.last_price ?? spotPrice ?? this.lastPrice ?? 0);
    const atmStrike = Math.round(spot / 100) * 100;

    const result = {
      spotPrice: spot, atmStrike,
      strikes: strikes.sort((a, b) => a.strike - b.strike),
      timestamp: new Date(), source: 'dhan'
    };
    this._sensexChainCache = result;
    this._sensexChainAt = Date.now();
    return result;
  }

  /**
   * Place a Dhan order. Params:
   *   securityId, exchangeSegment, transactionType (BUY/SELL),
   *   quantity, orderType (MARKET/LIMIT), productType (INTRADAY/CNC/MARGIN),
   *   price (required for LIMIT)
   */
  async placeOrder(params) {
    this._assertConnected();
    const clientId = this.config.dhanClientId || process.env.DHAN_CLIENT_ID;
    const body = {
      dhanClientId: clientId,
      correlationId: params.correlationId || `ag-${Date.now()}`,
      transactionType: params.transactionType,
      exchangeSegment: params.exchangeSegment,
      productType: params.productType || 'INTRADAY',
      orderType: params.orderType || 'MARKET',
      validity: params.validity || 'DAY',
      securityId: String(params.securityId),
      quantity: Number(params.quantity),
      disclosedQuantity: params.disclosedQuantity ?? 0,
      price: params.orderType === 'LIMIT' ? Number(params.price) : 0,
      triggerPrice: params.triggerPrice ?? 0,
      afterMarketOrder: false,
      amoTime: 'OPEN',
      boProfitValue: 0,
      boStopLossValue: 0
    };

    const res = await this.client._post('/v2/orders', body);
    return {
      status: res?.orderStatus || res?.status || 'SUBMITTED',
      orderId: res?.orderId,
      raw: res
    };
  }

  async getOrders() {
    if (!this.connected) return [];
    return this.client._post('/v2/orders', {}).catch(() => []);
  }

  async getPositions() {
    if (!this.connected) return [];
    return this.client._post('/v2/positions', {}).catch(() => []);
  }

  isMarketOpen() {
    const now = new Date();
    const istMs = now.getTime() + 5.5 * 60 * 60 * 1000 - now.getTimezoneOffset() * 60 * 1000;
    const ist = new Date(istMs);
    const day = ist.getUTCDay();
    if (day === 0 || day === 6) return false;
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    return mins >= 9 * 60 + 15 && mins <= 15 * 60 + 30;
  }

  isExpiryDay() {
    const cutover = new Date(process.env.SENSEX_EXPIRY_CUTOVER || '2024-10-28');
    const today = new Date();
    const targetDow = today.getTime() >= cutover.getTime() ? 2 : 5;
    return today.getDay() === targetDow;
  }

  disconnect() {
    this.connected = false;
    this.client = null;
  }
}

module.exports = LiveConnector;
