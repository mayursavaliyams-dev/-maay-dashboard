/**
 * Dhan v2 WebSocket Live Feed connector.
 *
 * Subscribes to the three index spots (NIFTY=13, SENSEX=51, BANKNIFTY=25
 * on segment IDX_I) and exposes their latest tick via getLast(securityId).
 *
 * Auto-reconnects on disconnect with exponential backoff.
 *
 * Usage:
 *   const feed = new DhanWsFeed({ clientId, accessToken });
 *   feed.start();
 *   feed.subscribe([{exchangeSegment:'IDX_I', securityId:13}, ...]);
 *   const tick = feed.getLast('13');  // {ltp, volume, timestamp, ohlc}
 *
 * Binary protocol reference (Dhan v2 docs):
 *   - 8-byte header on every packet:
 *       byte 0:    response code (1=disconnect 2=ticker 4=quote 5=oi 6=full 50=ack)
 *       bytes 1-2: message length (UInt16 LE)
 *       byte 3:    exchange segment (1=NSE_EQ 2=NSE_FNO 4=BSE_EQ 8=BSE_FNO 11=IDX_I etc)
 *       bytes 4-7: security id (UInt32 LE)
 *   - Ticker payload (response code 2):  4-byte LTP (Float32 LE) + 4-byte LTT (UInt32 LE)
 *   - Quote payload (response code 4):   LTP + LTQ + LTT + ATP + Vol + TBQ + TSQ + OHLC + close
 */
const WebSocket = require('ws');
const EventEmitter = require('events');

const URL_BASE = 'wss://api-feed.dhan.co';

// Map exchange segment string → numeric code used in subscribe payload
const SEG_CODE = {
  IDX_I:   1,
  NSE_EQ:  1,
  NSE_FNO: 2,
  BSE_EQ:  3,
  BSE_FNO: 4,
  MCX:     5,
  CUR_NSE: 6,
  CUR_BSE: 7,
};

// Reverse map: numeric segment code in tick → string segment
const SEG_NAME = ['', 'NSE_EQ_or_IDX', 'NSE_FNO', 'BSE_EQ', 'BSE_FNO', 'MCX', 'CUR_NSE', 'CUR_BSE'];

class DhanWsFeed extends EventEmitter {
  constructor({ clientId, accessToken } = {}) {
    super();
    this.clientId    = clientId    || process.env.DHAN_CLIENT_ID;
    this.accessToken = accessToken || process.env.DHAN_ACCESS_TOKEN;
    this.ws          = null;
    this.connected   = false;
    this._reconnectAttempt = 0;
    this._subscriptions = [];   // [{exchangeSegment, securityId}]
    this._lastTick = new Map(); // key: `${segCode}:${securityId}`  →  {ltp, volume, ohlc, timestamp, age}
    this._pingInterval = null;
    this._closing = false;
  }

  start() {
    if (!this.clientId || !this.accessToken) {
      throw new Error('Dhan WS: clientId / accessToken missing');
    }
    this._connect();
    return this;
  }

  stop() {
    this._closing = true;
    if (this._pingInterval) clearInterval(this._pingInterval);
    if (this.ws) try { this.ws.close(1000, 'shutdown'); } catch (_) {}
  }

  // Add to subscription list. Sent on connect, re-sent on reconnect.
  subscribe(items) {
    for (const it of items) {
      if (!this._subscriptions.find(s => s.exchangeSegment === it.exchangeSegment && Number(s.securityId) === Number(it.securityId))) {
        this._subscriptions.push({ exchangeSegment: it.exchangeSegment, securityId: Number(it.securityId) });
      }
    }
    if (this.connected) this._sendSubscribe(items);
  }

  // Last tick for a (securityId) — checks all segments
  getLast(securityId, exchangeSegment) {
    const sid = Number(securityId);
    if (exchangeSegment) {
      return this._lastTick.get(`${SEG_CODE[exchangeSegment] || exchangeSegment}:${sid}`) || null;
    }
    for (const v of this._lastTick.values()) if (v.securityId === sid) return v;
    return null;
  }

  // Build the WS connect URL with auth
  _url() {
    const params = new URLSearchParams({
      version:    '2',
      token:      this.accessToken,
      clientId:   this.clientId,
      authType:   '2',
    });
    return `${URL_BASE}?${params.toString()}`;
  }

  _connect() {
    if (this._closing) return;
    const url = this._url();
    console.log(`[ws] connecting (attempt ${this._reconnectAttempt + 1})`);
    this.ws = new WebSocket(url);

    this.ws.on('open', () => {
      this.connected = true;
      this._reconnectAttempt = 0;
      console.log(`[ws] ✓ connected — sending ${this._subscriptions.length} subscriptions`);
      if (this._subscriptions.length) this._sendSubscribe(this._subscriptions);
      this._pingInterval = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) try { this.ws.ping(); } catch (_) {}
      }, 30000);
      this.emit('open');
    });

    this.ws.on('message', (data) => this._onTick(data));

    this.ws.on('error', (err) => {
      console.warn(`[ws] error: ${err.message}`);
    });

    this.ws.on('close', (code, reason) => {
      this.connected = false;
      if (this._pingInterval) { clearInterval(this._pingInterval); this._pingInterval = null; }
      console.warn(`[ws] closed (${code}) ${reason || ''}`);
      this.emit('close', code);
      if (!this._closing) {
        const delay = Math.min(30000, 1000 * Math.pow(2, this._reconnectAttempt));
        this._reconnectAttempt++;
        setTimeout(() => this._connect(), delay);
      }
    });
  }

  _sendSubscribe(items) {
    const list = items.map(it => ({
      ExchangeSegment: it.exchangeSegment,
      SecurityId:      String(it.securityId),
    }));
    // Quote-level subscription (request code 17) — gives LTP + OHLCV
    const payload = {
      RequestCode:     17,
      InstrumentCount: list.length,
      InstrumentList:  list,
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
      const msgLen   = buf.readUInt16LE(off + 1);
      const segCode  = buf.readUInt8(off + 3);
      const secId    = buf.readUInt32LE(off + 4);
      const payloadEnd = off + msgLen;
      if (payloadEnd > buf.length) break;

      const key = `${segCode}:${secId}`;
      const existing = this._lastTick.get(key) || { securityId: secId, segCode };

      try {
        if (respCode === 2) {
          // Ticker: LTP (4B float) + LTT (4B uint)
          existing.ltp = buf.readFloatLE(off + 8);
          existing.ltt = buf.readUInt32LE(off + 12);
        } else if (respCode === 4) {
          // Quote: LTP, LTQ, LTT, ATP, Volume, TBQ, TSQ, day OHLC, day close
          existing.ltp     = buf.readFloatLE(off + 8);
          existing.ltq     = buf.readUInt16LE(off + 12);
          existing.ltt     = buf.readUInt32LE(off + 14);
          existing.atp     = buf.readFloatLE(off + 18);
          existing.volume  = buf.readUInt32LE(off + 22);
          existing.tbq     = buf.readUInt32LE(off + 26);
          existing.tsq     = buf.readUInt32LE(off + 30);
          existing.open    = buf.readFloatLE(off + 34);
          existing.close   = buf.readFloatLE(off + 38);
          existing.high    = buf.readFloatLE(off + 42);
          existing.low     = buf.readFloatLE(off + 46);
        } else if (respCode === 50) {
          // Server ack/feed-disconnected message — log and skip
          // payload is text after header
          const txt = buf.slice(off + 8, payloadEnd).toString('utf8');
          if (txt.trim()) console.log(`[ws] server msg: ${txt.trim()}`);
        }
        // Other codes (5=oi, 6=full, 1=disconnect) — skipped silently
        existing.timestamp = Date.now();
        this._lastTick.set(key, existing);
        this.emit('tick', existing);
      } catch (e) {
        // Malformed packet — skip rest of buffer
        break;
      }
      off = payloadEnd;
    }
  }
}

module.exports = DhanWsFeed;
