const fetch = require('node-fetch');
const { normalizeDhanAccessToken, normalizeDhanClientId, validateDhanCredentials } = require('./dhan-auth');

const DEFAULT_BASE = 'https://api.dhan.co';
const MIN_INTERVAL_MS = 220;
const AUTH_ERROR_CODES = new Set(['807', '808', '809', '810']);
const QUOTE_INTERVAL_MS = 1000;
const OPTION_CHAIN_INTERVAL_MS = 3000;
// Short response cache TTL — absorbs concurrent "5 panels polling the same thing" pattern.
// Per-path override below covers slower-changing feeds (optionchain, marketfeed/quote).
const DEFAULT_CACHE_TTL_MS = 0;
const PATH_CACHE_TTL_MS = {
  '/v2/optionchain':      3000,    // raised 1500→3000 to absorb H/L snapshot bursts
  '/v2/marketfeed/quote': 1200,
  '/v2/marketfeed/ltp':    800,
  // 1-min intraday candles update at most once/60s. Same (securityId, today)
  // series is fetched by the index-price getter, EMA endpoint, ORB backfill and
  // prev-day levels — a short TTL lets them share one fetch instead of each
  // firing its own HTTP call on a cache-miss. Cache key includes the full body,
  // so today vs prev-day vs OPTIDX requests stay distinct.
  '/v2/charts/intraday':  2500
};

function extractDhanError(data, text, status) {
  const nested = data?.data && typeof data.data === 'object'
    ? Object.entries(data.data)[0]
    : null;
  const code = String(data?.internalErrorCode || data?.errorCode || nested?.[0] || '');
  const message = String(
    data?.internalErrorMessage
    || data?.errorMessage
    || data?.message
    || nested?.[1]
    || text
    || `HTTP ${status}`
  );
  return { code, message };
}

function isAuthFailure(status, code, message) {
  return status === 401
    || status === 403
    || AUTH_ERROR_CODES.has(String(code || ''))
    || /authentication failed|access token.*(?:invalid|expired)|client id.*invalid/i.test(String(message || ''));
}

class DhanClient {
  constructor({ clientId, accessToken, baseUrl, onAuthFailure } = {}) {
    this.clientId = normalizeDhanClientId(clientId || process.env.DHAN_CLIENT_ID);
    this.accessToken = normalizeDhanAccessToken(accessToken || process.env.DHAN_ACCESS_TOKEN);
    this.baseUrl = (baseUrl || process.env.DHAN_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
    this._onAuthFailure = typeof onAuthFailure === 'function' ? onAuthFailure : null;

    if (!this.accessToken) {
      throw new Error('DHAN_ACCESS_TOKEN is missing. Set it in .env before starting live data.');
    }
    if (!this.clientId) {
      throw new Error('DHAN_CLIENT_ID is missing. Set it in .env before starting live data.');
    }
    const auth = validateDhanCredentials(this.clientId, this.accessToken);
    if (!auth.ok) {
      const expiryText = auth.tokenStatus?.expiresAtIST ? ` Token expiry: ${auth.tokenStatus.expiresAtIST}.` : '';
      throw new Error(`Dhan auth invalid: ${auth.reason}.${expiryText} Refresh via /api/dhan/login.`);
    }

    this._lastCallAt = 0;
    this._throttleTail = Promise.resolve();
    this._lastScopedCallAt = new Map();
    this._inflight = new Map();  // key → Promise
    this._cache = new Map();     // key → { at, data }
    this._authBlocked = null;
    this._stats = {
      calls: 0, coalesced: 0, cacheHits: 0,
      rateLimited: 0, errors: 0, authErrors: 0,
      lastCallAt: 0, lastErrorAt: 0, lastError: null
    };
  }

  async _throttle(path, requestKey) {
    const task = this._throttleTail.then(async () => {
      const now = Date.now();
      let waitUntil = this._lastCallAt + MIN_INTERVAL_MS;

      if (path.startsWith('/v2/marketfeed/')) {
        waitUntil = Math.max(waitUntil, (this._lastScopedCallAt.get('quote') || 0) + QUOTE_INTERVAL_MS);
      } else if (path.startsWith('/v2/optionchain')) {
        waitUntil = Math.max(
          waitUntil,
          (this._lastScopedCallAt.get(`option:${requestKey}`) || 0) + OPTION_CHAIN_INTERVAL_MS
        );
      }

      const wait = waitUntil - now;
      if (wait > 0) await new Promise(r => setTimeout(r, wait));

      const calledAt = Date.now();
      this._lastCallAt = calledAt;
      if (path.startsWith('/v2/marketfeed/')) this._lastScopedCallAt.set('quote', calledAt);
      if (path.startsWith('/v2/optionchain')) {
        this._lastScopedCallAt.set(`option:${requestKey}`, calledAt);
      }
    });
    this._throttleTail = task.catch(() => {});
    return task;
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

  getAuthStatus() {
    return this._authBlocked
      ? { blocked: true, ...this._authBlocked }
      : { blocked: false, blockedAt: null, status: null, code: null, message: null };
  }

  updateCredentials({ clientId, accessToken } = {}) {
    const nextClientId = normalizeDhanClientId(clientId || this.clientId);
    const nextAccessToken = normalizeDhanAccessToken(accessToken || this.accessToken);
    const auth = validateDhanCredentials(nextClientId, nextAccessToken);
    if (!auth.ok) {
      throw new Error(`Cannot update Dhan credentials: ${auth.reason}`);
    }
    this.clientId = nextClientId;
    this.accessToken = nextAccessToken;
    this._authBlocked = null;
    this._cache.clear();
  }

  async verifyCredentials() {
    const profile = await this._get('/v2/profile', { retries: 0 });
    const profileClientId = normalizeDhanClientId(profile?.dhanClientId);
    if (profileClientId && profileClientId !== this.clientId) {
      const err = new Error(`Dhan profile client ID ${profileClientId} does not match configured client ID`);
      err.status = 401;
      err.code = 'DHAN_AUTH';
      this._setAuthBlocked(err);
      throw err;
    }
    return profile;
  }

  _setAuthBlocked(err) {
    if (this._authBlocked) return;
    this._authBlocked = {
      blockedAt: new Date().toISOString(),
      status: Number(err?.status || 401),
      code: String(err?.dhanCode || err?.code || 'DHAN_AUTH'),
      message: String(err?.message || 'Dhan authentication failed').slice(0, 240)
    };
    try { this._onAuthFailure?.(err); } catch (_) {}
  }

  _throwIfAuthBlocked(path) {
    if (!this._authBlocked) return;
    const err = new Error(
      `Dhan ${path} blocked: credentials were rejected by Dhan. Refresh via /api/dhan/login.`
    );
    err.status = 401;
    err.code = 'DHAN_AUTH_BLOCKED';
    err.dhanCode = this._authBlocked.code;
    throw err;
  }

  async _post(path, body, { retries = 3 } = {}) {
    this._throwIfAuthBlocked(path);
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

  async _get(path, { retries = 1 } = {}) {
    this._throwIfAuthBlocked(path);
    return this._requestUncoalesced(path, null, { retries, method: 'GET' });
  }

  async _postUncoalesced(path, body, { retries = 3 } = {}) {
    return this._requestUncoalesced(path, body, { retries, method: 'POST' });
  }

  async _requestUncoalesced(path, body, { retries = 3, method = 'POST' } = {}) {
    this._throwIfAuthBlocked(path);
    const auth = validateDhanCredentials(this.clientId, this.accessToken);
    if (!auth.ok) {
      const expiryText = auth.tokenStatus?.expiresAtIST ? ` Token expiry: ${auth.tokenStatus.expiresAtIST}.` : '';
      const err = new Error(`Dhan ${path} blocked before request: ${auth.reason}.${expiryText} Refresh via /api/dhan/login.`);
      err.status = 401;
      err.code = 'DHAN_AUTH';
      this._setAuthBlocked(err);
      throw err;
    }
    const url = `${this.baseUrl}${path}`;
    const requestKey = this._cacheKey(path, body);
    let lastErr;

    for (let attempt = 0; attempt <= retries; attempt++) {
      await this._throttle(path, requestKey);
      this._stats.calls++;
      this._stats.lastCallAt = Date.now();

      try {
        const res = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'access-token': this.accessToken,
            'client-id': this.clientId
          },
          body: method === 'GET' ? undefined : JSON.stringify(body),
          timeout: 30000
        });

        const text = await res.text();
        let data;
        try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

        if (res.status === 429) {
          this._stats.rateLimited++;
          const retryAfterSeconds = Number(res.headers.get('retry-after') || 0);
          const backoff = retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : 1000 * Math.pow(2, attempt);
          const err = new Error(`Dhan ${path} rate-limited: HTTP 429`);
          err.status = 429;
          err.code = 'DHAN_RATE_LIMIT';
          lastErr = err;
          if (attempt === retries) throw err;
          console.warn(`  [dhan] 429 rate-limited, backing off ${backoff}ms`);
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }

        if (!res.ok) {
          const details = extractDhanError(data, text, res.status);
          const authRejected = isAuthFailure(res.status, details.code, details.message);
          const authHint = authRejected
            ? ' Check DHAN_CLIENT_ID and refresh DHAN_ACCESS_TOKEN via /api/dhan/login.'
            : '';
          const err = new Error(`Dhan ${path} failed: ${res.status} ${details.message}${authHint}`);
          err.status = res.status;
          err.body = data;
          err.dhanCode = details.code || null;
          err.code = authRejected ? 'DHAN_AUTH' : 'DHAN_HTTP_ERROR';
          this._stats.errors++;
          this._stats.lastErrorAt = Date.now();
          this._stats.lastError = `${res.status} ${details.message}`.slice(0, 140);
          if (authRejected) {
            this._stats.authErrors++;
            this._setAuthBlocked(err);
          }
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
        if (err?.code === 'DHAN_AUTH' || err?.code === 'DHAN_AUTH_BLOCKED') throw err;
        if (Number(err?.status) >= 400 && Number(err?.status) < 500 && err?.status !== 429) throw err;
        if (attempt === retries) {
          if (!err?.status) {
            this._stats.errors++;
            this._stats.lastErrorAt = Date.now();
            this._stats.lastError = err.message.slice(0, 140);
          }
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
