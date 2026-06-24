/**
 * Dhan v2 WebSocket live feed connector.
 */
const WebSocket = require('ws');
const EventEmitter = require('events');
const { normalizeDhanAccessToken, normalizeDhanClientId, validateDhanCredentials } = require('./dhan-auth');

const URL_BASE = 'wss://api-feed.dhan.co';
const DISCONNECT_REASONS = {
  805: 'connection limit exceeded',
  806: 'data APIs not subscribed',
  807: 'access token expired',
  808: 'authentication failed',
  809: 'access token invalid',
  810: 'client ID invalid',
};

const SEG_CODE = {
  IDX_I: 1,
  NSE_EQ: 1,
  NSE_FNO: 2,
  BSE_EQ: 3,
  BSE_FNO: 4,
  MCX: 5,
  CUR_NSE: 6,
  CUR_BSE: 7,
};

class DhanWsFeed extends EventEmitter {
  constructor({ clientId, accessToken } = {}) {
    super();
    this.clientId = normalizeDhanClientId(clientId || process.env.DHAN_CLIENT_ID);
    this.accessToken = normalizeDhanAccessToken(accessToken || process.env.DHAN_ACCESS_TOKEN);
    this.ws = null;
    this.connected = false;
    this._reconnectAttempt = 0;
    this._subscriptions = [];
    this._lastTick = new Map();
    this._pingInterval = null;
    this._retryTimer = null;
    this._closing = false;
    this._lastErrorCategory = null;
    this._lastDisconnectCode = null;
  }

  start() {
    if (!this.clientId || !this.accessToken) {
      throw new Error('Dhan WS: clientId / accessToken missing');
    }
    const auth = validateDhanCredentials(this.clientId, this.accessToken);
    if (!auth.ok) {
      const expiryText = auth.tokenStatus?.expiresAtIST ? ` Token expiry: ${auth.tokenStatus.expiresAtIST}.` : '';
      throw new Error(`Dhan WS auth invalid: ${auth.reason}.${expiryText} Refresh via /api/dhan/login.`);
    }
    this._closing = false;
    this._connect();
    return this;
  }

  stop() {
    this._closing = true;
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    if (this._pingInterval) {
      clearInterval(this._pingInterval);
      this._pingInterval = null;
    }
    if (this.ws) {
      try { this.ws.close(1000, 'shutdown'); } catch (_) {}
    }
  }

  updateCredentials({ clientId, accessToken } = {}) {
    if (clientId) this.clientId = normalizeDhanClientId(clientId);
    if (accessToken) this.accessToken = normalizeDhanAccessToken(accessToken);
  }

  subscribe(items) {
    for (const it of items) {
      const securityId = Number(it.securityId);
      if (!this._subscriptions.find((s) => s.exchangeSegment === it.exchangeSegment && Number(s.securityId) === securityId)) {
        this._subscriptions.push({ exchangeSegment: it.exchangeSegment, securityId });
      }
    }
    if (this.connected) this._sendSubscribe(items);
  }

  getLast(securityId, exchangeSegment) {
    const sid = Number(securityId);
    if (exchangeSegment) {
      return this._lastTick.get(`${SEG_CODE[exchangeSegment] || exchangeSegment}:${sid}`) || null;
    }
    for (const v of this._lastTick.values()) {
      if (v.securityId === sid) return v;
    }
    return null;
  }

  _url() {
    const params = new URLSearchParams({
      version: '2',
      token: this.accessToken,
      clientId: this.clientId,
      authType: '2',
    });
    return `${URL_BASE}?${params.toString()}`;
  }

  _connect() {
    if (this._closing) return;
    this._lastErrorCategory = null;
    this._lastDisconnectCode = null;
    console.log(`[ws] connecting (attempt ${this._reconnectAttempt + 1})`);
    this.ws = new WebSocket(this._url());

    this.ws.on('open', () => {
      this.connected = true;
      this._reconnectAttempt = 0;
      this._lastErrorCategory = null;
      console.log(`[ws] connected; sending ${this._subscriptions.length} subscriptions`);
      if (this._subscriptions.length) this._sendSubscribe(this._subscriptions);
      this._pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          try { this.ws.ping(); } catch (_) {}
        }
      }, 30000);
      this.emit('open');
    });

    this.ws.on('message', (data) => this._onTick(data));

    this.ws.on('error', (err) => {
      const msg = String(err?.message || '');
      if (/429/.test(msg)) this._lastErrorCategory = 'rate_limit';
      else if (/401|403|auth|token|client id/i.test(msg)) this._lastErrorCategory = 'auth';
      console.warn(`[ws] error: ${msg}`);
    });

    this.ws.on('close', (code, reason) => {
      this.connected = false;
      if (this._pingInterval) {
        clearInterval(this._pingInterval);
        this._pingInterval = null;
      }
      console.warn(`[ws] closed (${code}) ${reason || ''}`);
      this.emit('close', code);
      if (this._closing) return;

      let delay = Math.min(30000, 1000 * Math.pow(2, this._reconnectAttempt));
      if (this._lastErrorCategory === 'rate_limit') {
        delay = Math.max(delay, this._lastDisconnectCode === 805 ? 300000 : 60000);
      }
      if (this._lastErrorCategory === 'auth') {
        this._closing = true;
        this.ws = null;
        console.warn('[ws] auth failed; reconnect paused until the Dhan token is refreshed via /api/dhan/login');
        this.emit('auth-error', this._lastDisconnectCode);
        return;
      }
      this._reconnectAttempt++;
      this._retryTimer = setTimeout(() => {
        this._retryTimer = null;
        this._connect();
      }, delay);
    });
  }

  _sendSubscribe(items) {
    const payload = {
      RequestCode: 17,
      InstrumentCount: items.length,
      InstrumentList: items.map((it) => ({
        ExchangeSegment: it.exchangeSegment,
        SecurityId: String(it.securityId),
      })),
    };
    try {
      this.ws.send(JSON.stringify(payload));
    } catch (e) {
      console.warn(`[ws] subscribe send failed: ${e.message}`);
    }
  }

  _onTick(buf) {
    if (!Buffer.isBuffer(buf)) return;
    let off = 0;
    while (off + 8 <= buf.length) {
      const respCode = buf.readUInt8(off);
      const msgLen = buf.readUInt16LE(off + 1);
      const segCode = buf.readUInt8(off + 3);
      const secId = buf.readUInt32LE(off + 4);
      const payloadEnd = off + msgLen;
      if (payloadEnd > buf.length) break;

      const key = `${segCode}:${secId}`;
      const existing = this._lastTick.get(key) || { securityId: secId, segCode };

      try {
        if (respCode === 2) {
          existing.ltp = buf.readFloatLE(off + 8);
          existing.ltt = buf.readUInt32LE(off + 12);
        } else if (respCode === 4) {
          existing.ltp = buf.readFloatLE(off + 8);
          existing.ltq = buf.readUInt16LE(off + 12);
          existing.ltt = buf.readUInt32LE(off + 14);
          existing.atp = buf.readFloatLE(off + 18);
          existing.volume = buf.readUInt32LE(off + 22);
          existing.tbq = buf.readUInt32LE(off + 26);
          existing.tsq = buf.readUInt32LE(off + 30);
          existing.open = buf.readFloatLE(off + 34);
          existing.close = buf.readFloatLE(off + 38);
          existing.high = buf.readFloatLE(off + 42);
          existing.low = buf.readFloatLE(off + 46);
        } else if (respCode === 50) {
          const disconnectCode = msgLen >= 10 ? buf.readUInt16LE(off + 8) : 0;
          const reason = DISCONNECT_REASONS[disconnectCode] || 'feed disconnected';
          this._lastDisconnectCode = disconnectCode || null;
          if (disconnectCode >= 807 && disconnectCode <= 810) this._lastErrorCategory = 'auth';
          else if (disconnectCode === 805) this._lastErrorCategory = 'rate_limit';
          console.warn(`[ws] Dhan disconnect ${disconnectCode || 'unknown'}: ${reason}`);
          if (this.ws?.readyState === WebSocket.OPEN) {
            setImmediate(() => {
              try { this.ws?.terminate(); } catch (_) {}
            });
          }
          off = payloadEnd;
          continue;
        }
        existing.timestamp = Date.now();
        this._lastTick.set(key, existing);
        this.emit('tick', existing);
      } catch (_) {
        break;
      }
      off = payloadEnd;
    }
  }
}

module.exports = DhanWsFeed;
