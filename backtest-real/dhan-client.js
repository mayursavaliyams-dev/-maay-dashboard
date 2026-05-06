const fetch = require('node-fetch');

const DEFAULT_BASE = 'https://api.dhan.co';
const MIN_INTERVAL_MS = 220;
// Short response cache TTL — absorbs concurrent "5 panels polling the same thing" pattern.
// Per-path override below covers slower-changing feeds (optionchain, marketfeed/quote).
const DEFAULT_CACHE_TTL_MS = 0;
const PATH_CACHE_TTL_MS = {
  '/v2/optionchain':      1500,
  '/v2/marketfeed/quote': 1200,
  '/v2/marketfeed/ltp':    800
};

class DhanClient {
  constructor({ clientId, accessToken, baseUrl } = {}) {
    this.clientId = clientId || process.env.DHAN_CLIENT_ID;
    this.accessToken = accessToken || process.env.DHAN_ACCESS_TOKEN;
    this.baseUrl = (baseUrl || process.env.DHAN_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');

    if (!this.accessToken) {
      throw new Error('DHAN_ACCESS_TOKEN is missing. Set it in .env before running the real backtest.');
    }
    if (!this.clientId) {
      throw new Error('DHAN_CLIENT_ID is missing. Set it in .env before running the real backtest.');
    }

    this._lastCallAt = 0;
    this._inflight = new Map();  // key → Promise
    this._cache = new Map();     // key → { at, data }
    this._stats = {
      calls: 0, coalesced: 0, cacheHits: 0,
      rateLimited: 0, errors: 0, authErrors: 0,
      lastCallAt: 0, lastErrorAt: 0, lastError: null
    };
  }

  async _throttle() {
    const now = Date.now();
    const wait = this._lastCallAt + MIN_INTERVAL_MS - now;
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    this._lastCallAt = Date.now();
  }

  _cacheKey(path, body) {
    return path + '|' + JSON.stringify(body || {});
  }

  getStats() {
    return {
      ...this._stats,
      inflight: this._inflight.size,
      cached:   this._cache.size,
      minIntervalMs: MIN_INTERVAL_MS
    };
  }

  async _post(path, body, { retries = 3 } = {}) {
    const key = this._cacheKey(path, body);
    const ttl = PATH_CACHE_TTL_MS[path] ?? DEFAULT_CACHE_TTL_MS;

    // 1. Response cache (short TTL, per-path)
    if (ttl > 0) {
      const hit = this._cache.get(key);
      if (hit && Date.now() - hit.at < ttl) {
        this._stats.cacheHits++;
        return hit.data;
      }
    }

    // 2. In-flight coalescing — if an identical request is already pending, share it
    const pending = this._inflight.get(key);
    if (pending) {
      this._stats.coalesced++;
      return pending;
    }

    const promise = this._postUncoalesced(path, body, { retries })
      .then((data) => {
        if (ttl > 0) this._cache.set(key, { at: Date.now(), data });
        return data;
      })
      .finally(() => {
        this._inflight.delete(key);
      });
    this._inflight.set(key, promise);
    return promise;
  }

  async _postUncoalesced(path, body, { retries = 3 } = {}) {
    const url = `${this.baseUrl}${path}`;
    let lastErr;

    for (let attempt = 0; attempt <= retries; attempt++) {
      await this._throttle();
      this._stats.calls++;
      this._stats.lastCallAt = Date.now();

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'access-token': this.accessToken,
            'client-id': this.clientId
          },
          body: JSON.stringify(body),
          timeout: 30000
        });

        const text = await res.text();
        let data;
        try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

        if (res.status === 429) {
          this._stats.rateLimited++;
          const backoff = 1000 * Math.pow(2, attempt);
          console.warn(`  [dhan] 429 rate-limited, backing off ${backoff}ms`);
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }

        if (!res.ok) {
          const msg = data.errorMessage || data.message || text || `HTTP ${res.status}`;
          const err = new Error(`Dhan ${path} failed: ${res.status} ${msg}`);
          err.status = res.status;
          err.body = data;
          this._stats.errors++;
          this._stats.lastErrorAt = Date.now();
          this._stats.lastError = `${res.status} ${msg}`.slice(0, 140);
          if (res.status === 401 || res.status === 403) this._stats.authErrors++;
          if (res.status >= 500 && attempt < retries) {
            lastErr = err;
            await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
            continue;
          }
          throw err;
        }

        return data;
      } catch (err) {
        lastErr = err;
        if (attempt === retries) {
          this._stats.errors++;
          this._stats.lastErrorAt = Date.now();
          this._stats.lastError = err.message.slice(0, 140);
          throw err;
        }
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  async getIntradayCandles({ securityId, exchangeSegment, instrument, interval, fromDate, toDate, oi = true }) {
    return this._post('/v2/charts/intraday', {
      securityId: String(securityId),
      exchangeSegment,
      instrument,
      interval: Number(interval),
      oi,
      fromDate,
      toDate
    });
  }

  async getRollingOptionCandles({
    exchangeSegment,
    instrument,
    securityId,
    interval,
    expiryCode = 0,
    expiryFlag = 'WEEK',
    strike,
    optionType,
    fromDate,
    toDate,
    requiredData = ['open', 'high', 'low', 'close', 'iv', 'volume', 'oi', 'spot', 'strike']
  }) {
    return this._post('/v2/charts/rollingoption', {
      exchangeSegment,
      instrument,
      securityId: String(securityId),
      interval: Number(interval),
      expiryCode: Number(expiryCode),
      expiryFlag,
      strike,
      drvOptionType: optionType,
      requiredData,
      fromDate,
      toDate
    });
  }
}

module.exports = DhanClient;
