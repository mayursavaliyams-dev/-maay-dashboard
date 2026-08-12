/**
 * LIVE DATA CONNECTOR — Dhan only
 * Uses Dhan HQ v2 REST API for live quotes, option chain, and order placement.
 * No demo fallback: if Dhan is unreachable or credentials are missing, calls throw.
 */

const DhanClient = require('./dhan-client');
const DhanWsFeed = require('./dhan-ws-feed');
const { normalizeDhanAccessToken, normalizeDhanClientId, validateDhanCredentials } = require('./dhan-auth');

const SENSEX_SECURITY_ID = process.env.DHAN_SENSEX_SECURITY_ID || '51';
const NIFTY_SECURITY_ID  = process.env.DHAN_NIFTY_SECURITY_ID  || '13';
const BANKNIFTY_SECURITY_ID = process.env.DHAN_BANKNIFTY_SECURITY_ID || '25';
const IDX_SEGMENT = 'IDX_I';
const SENSEX_SEGMENT = IDX_SEGMENT;
const WS_TICK_MAX_AGE_MS = 10000;   // accept WS tick if it arrived in the last 10s
const OPTION_CHAIN_CACHE_MS = 4500;

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
    this._authFailureLogged = false;
  }

  _createClient(clientId, accessToken) {
    return new DhanClient({
      clientId,
      accessToken,
      onAuthFailure: (err) => this._handleAuthFailure(err)
    });
  }

  _handleAuthFailure(err) {
    this.connected = false;
    if (this.ws) {
      this.ws.stop();
      this.ws = null;
    }
    if (!this._authFailureLogged) {
      this._authFailureLogged = true;
      console.error(`[live] Dhan authentication paused: ${err.message}`);
      console.error('[live] Refresh credentials at http://localhost:3000/api/dhan/login');
    }
  }

  async connect() {
    const clientId = normalizeDhanClientId(this.config.dhanClientId || process.env.DHAN_CLIENT_ID);
    const accessToken = normalizeDhanAccessToken(this.config.dhanAccessToken || process.env.DHAN_ACCESS_TOKEN);

    if (!clientId || !accessToken || clientId === 'your_dhan_client_id') {
      throw new Error('DHAN_CLIENT_ID / DHAN_ACCESS_TOKEN not set — live connector cannot start');
    }

    const auth = validateDhanCredentials(clientId, accessToken);
    if (!auth.ok) {
      const expiryText = auth.tokenStatus?.expiresAtIST ? ` Token expiry: ${auth.tokenStatus.expiresAtIST}.` : '';
      throw new Error(`DHAN credentials invalid: ${auth.reason}.${expiryText} Refresh via /api/dhan/login.`);
    }

    this.config.dhanClientId = clientId;
    this.config.dhanAccessToken = accessToken;
    this.client = this._createClient(clientId, accessToken);
    await this.client.verifyCredentials();
    this.connected = true;
    this._authFailureLogged = false;
    console.log('[live] Connected to Dhan HQ v2');

    // Start WebSocket live tick feed for the three indices.
    if (process.env.DHAN_WS_ENABLED !== 'false') {
      try {
        this.ws = new DhanWsFeed({ clientId, accessToken });
        this.ws.on('auth-error', (code) => {
          const err = new Error(`Dhan WebSocket authentication rejected${code ? ` (${code})` : ''}`);
          err.status = 401;
          err.code = 'DHAN_AUTH';
          this._handleAuthFailure(err);
        });
        this.ws.start();
        this.ws.subscribe([
          { exchangeSegment: IDX_SEGMENT, securityId: NIFTY_SECURITY_ID  },
          { exchangeSegment: IDX_SEGMENT, securityId: SENSEX_SECURITY_ID },
          { exchangeSegment: IDX_SEGMENT, securityId: BANKNIFTY_SECURITY_ID },
        ]);
      } catch (e) {
        console.warn('[live] WS feed failed to start, falling back to REST polling:', e.message);
        this.ws = null;
      }
    }
  }

  async refreshAuth({ clientId, accessToken } = {}) {
    const nextClientId = normalizeDhanClientId(clientId || this.config.dhanClientId || process.env.DHAN_CLIENT_ID);
    const nextAccessToken = normalizeDhanAccessToken(accessToken || this.config.dhanAccessToken || process.env.DHAN_ACCESS_TOKEN);

    if (!nextClientId || !nextAccessToken) {
      throw new Error('Cannot refresh Dhan auth without DHAN_CLIENT_ID and DHAN_ACCESS_TOKEN');
    }

    const auth = validateDhanCredentials(nextClientId, nextAccessToken);
    if (!auth.ok) {
      const expiryText = auth.tokenStatus?.expiresAtIST ? ` Token expiry: ${auth.tokenStatus.expiresAtIST}.` : '';
      throw new Error(`Cannot refresh Dhan auth: ${auth.reason}.${expiryText} Refresh via /api/dhan/login.`);
    }

    this.config.dhanClientId = nextClientId;
    this.config.dhanAccessToken = nextAccessToken;
    process.env.DHAN_CLIENT_ID = nextClientId;
    process.env.DHAN_ACCESS_TOKEN = nextAccessToken;

    if (this.client) this.client.updateCredentials({ clientId: nextClientId, accessToken: nextAccessToken });
    else this.client = this._createClient(nextClientId, nextAccessToken);

    await this.client.verifyCredentials();
    this.connected = true;
    this._authFailureLogged = false;

    if (process.env.DHAN_WS_ENABLED !== 'false') {
      if (this.ws) {
        this.ws.stop();
        this.ws = null;
      }
      this.ws = new DhanWsFeed({ clientId: nextClientId, accessToken: nextAccessToken });
      this.ws.on('auth-error', (code) => {
        const err = new Error(`Dhan WebSocket authentication rejected${code ? ` (${code})` : ''}`);
        err.status = 401;
        err.code = 'DHAN_AUTH';
        this._handleAuthFailure(err);
      });
      this.ws.start();
      this.ws.subscribe([
        { exchangeSegment: IDX_SEGMENT, securityId: NIFTY_SECURITY_ID },
        { exchangeSegment: IDX_SEGMENT, securityId: SENSEX_SECURITY_ID },
        { exchangeSegment: IDX_SEGMENT, securityId: BANKNIFTY_SECURITY_ID },
      ]);
    }

  }

  _assertConnected() {
    if (!this.connected) {
      const authStatus = this.client?.getAuthStatus?.();
      const suffix = authStatus?.blocked ? ' Refresh via /api/dhan/login.' : '';
      throw new Error(`Dhan not connected - check DHAN_CLIENT_ID / DHAN_ACCESS_TOKEN.${suffix}`);
    }
  }

  async getNiftyPrice() {
    return this._getIndexPriceFromCharts(NIFTY_SECURITY_ID, IDX_SEGMENT, '_niftyChartCache', '_niftyChartAt');
  }

  async getBankNiftyPrice() {
    return this._getIndexPriceFromCharts(BANKNIFTY_SECURITY_ID, IDX_SEGMENT, '_bankNiftyChartCache', '_bankNiftyChartAt');
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
    const greeks = leg?.greeks || {};
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
      askQty: leg.top_ask_quantity ?? 0,
      delta: greeks.delta ?? leg.delta ?? 0,
      gamma: greeks.gamma ?? leg.gamma ?? 0,
      theta: greeks.theta ?? leg.theta ?? 0,
      vega: greeks.vega ?? leg.vega ?? 0
    } : {};
  }

  async getNiftyOptionChain(spotPrice = null) {
    if (this._niftyChainCache && Date.now() - this._niftyChainAt < OPTION_CHAIN_CACHE_MS) return this._niftyChainCache;
    // Skip Dhan entirely if a prior call failed with "Data APIs not Subscribed".
    if (!this._dhanChainBlocked) {
      try {
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
      } catch (err) {
        if (/Data APIs not Subscribed|806/i.test(err.message)) {
          this._dhanChainBlocked = true;
          console.log('[live] Dhan Data API not subscribed — falling back to free NSE option chain');
        } else { throw err; }
      }
    }
    const free = await require('./free-chain').getNiftyChain(spotPrice);
    this._niftyChainCache = free;
    this._niftyChainAt = Date.now();
    return free;
  }

  async getBankNiftyOptionChain(spotPrice = null) {
    if (this._bankNiftyChainCache && Date.now() - this._bankNiftyChainAt < OPTION_CHAIN_CACHE_MS) return this._bankNiftyChainCache;
    if (!this._dhanChainBlocked) {
      try {
        this._assertConnected();
        const expiry = await this._getNextExpiry(BANKNIFTY_SECURITY_ID, IDX_SEGMENT);
        const body = { UnderlyingScrip: Number(BANKNIFTY_SECURITY_ID), UnderlyingSeg: IDX_SEGMENT, Expiry: expiry };
        const res  = await this.client._post('/v2/optionchain', body);
        const oc   = res?.data?.oc || res?.data || {};
        const strikes = [];
        for (const strikeStr of Object.keys(oc)) {
          const row = oc[strikeStr];
          strikes.push({ strike: Number(strikeStr), ce: this._pickLeg(row?.ce), pe: this._pickLeg(row?.pe) });
        }
        const spot = Number(res?.data?.last_price ?? spotPrice ?? 0);
        const atmStrike = Math.round(spot / 100) * 100;
        const result = { spotPrice: spot, atmStrike, strikes: strikes.sort((a, b) => a.strike - b.strike),
                         timestamp: new Date(), source: 'dhan' };
        this._bankNiftyChainCache = result;
        this._bankNiftyChainAt = Date.now();
        return result;
      } catch (err) {
        if (/Data APIs not Subscribed|806/i.test(err.message)) {
          this._dhanChainBlocked = true;
          console.log('[live] Dhan Data API not subscribed for BANKNIFTY chain');
        } else { throw err; }
      }
    }
    throw new Error('BANKNIFTY option chain unavailable from Dhan');
  }

  async getSensexPrice() {
    const r = await this._getIndexPriceFromCharts(SENSEX_SECURITY_ID, SENSEX_SEGMENT, '_sensexChartCache', '_sensexChartAt');
    this.lastPrice = r.price;
    this.lastUpdate = r.timestamp;
    return r;
  }

  async getOptionChain(spotPrice = null) {
    if (this._sensexChainCache && Date.now() - this._sensexChainAt < OPTION_CHAIN_CACHE_MS) return this._sensexChainCache;
    if (this._dhanChainBlocked) {
      const free = await require('./free-chain').getSensexChain(spotPrice);
      this._sensexChainCache = free;
      this._sensexChainAt = Date.now();
      return free;
    }
    try {
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
    } catch (err) {
      if (/Data APIs not Subscribed|806/i.test(err.message)) {
        this._dhanChainBlocked = true;
        console.log('[live] Dhan Data API not subscribed — falling back to free Sensibull SENSEX chain');
        const free = await require('./free-chain').getSensexChain(spotPrice || this.lastPrice);
        this._sensexChainCache = free;
        this._sensexChainAt = Date.now();
        return free;
      }
      throw err;
    }
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

    /* retries: 0 — DELIBERATE, and not the client's default of 3.

       `_post` was written for market-data reads, where retrying a failed GET is
       free. An order is not a read. A 5xx or a dropped socket AFTER the exchange
       has accepted the order is indistinguishable from one before, so a retry
       can place the position a second, third and fourth time. Measured on
       2026-07-31: one order intent against a 500 produced four submissions
       (test/order-path-characterization.test.js §3).

       Whether Dhan de-duplicates on `correlationId` is UNKNOWN and has not been
       confirmed with the broker. Until it is confirmed in writing, an order is
       sent exactly once and an ambiguous failure is escalated to a human rather
       than resolved by guessing. Re-enabling retries requires a durable
       idempotency key written BEFORE the call — see docs/073 DR-5. */
    const res = await this.client._post('/v2/orders', body, { retries: 0 });
    return {
      status: res?.orderStatus || res?.status || 'SUBMITTED',
      orderId: res?.orderId,
      raw: res
    };
  }

  /* Same conflation as getPositions, same fix. An order book that reports "no
     orders" when it could not ask is how a rejected leg goes unnoticed. */
  async getOrders() {
    if (!this.connected) {
      throw Object.assign(
        new Error('live connector is not connected — cannot ask the broker for orders'),
        { code: 'BROKER_ORDERS_UNAVAILABLE' },
      );
    }
    try {
      return await this.client._post('/v2/orders', {});
    } catch (e) {
      throw Object.assign(
        new Error(`live getOrders failed: ${e.message}`),
        { code: 'BROKER_ORDERS_UNAVAILABLE', cause: e },
      );
    }
  }

  /* Same defect as upstox (A5 / D-8), same fix, 2026-08-12. `.catch(() => [])`
     turned a failed call into "no positions", and `!this.connected` turned a
     dead session into the same thing.

     Both now throw. Being disconnected is not evidence of being flat — it is the
     absence of evidence, and the two must not share a return value. This
     connector deliberately does NOT declare positionsDistinguishEmptyFromError
     until it has been exercised against a live Dhan session; the marker is a
     claim about observed behaviour, not about intent. */
  async getPositions() {
    if (!this.connected) {
      throw Object.assign(
        new Error('live connector is not connected — cannot ask the broker for positions'),
        { code: 'BROKER_POSITIONS_UNAVAILABLE' },
      );
    }
    try {
      return await this.client._post('/v2/positions', {});
    } catch (e) {
      throw Object.assign(
        new Error(`live getPositions failed: ${e.message}`),
        { code: 'BROKER_POSITIONS_UNAVAILABLE', cause: e },
      );
    }
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
    if (this.ws) {
      this.ws.stop();
      this.ws = null;
    }
    this.client = null;
  }
}

module.exports = LiveConnector;
