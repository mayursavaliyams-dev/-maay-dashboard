const fs = require('fs');
const path = require('path');
const { synthOptionCandles } = require('./synth-option-pricer');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeLen(arr) {
  return (arr && arr.length) || 0;
}

function cacheKey(parts) {
  return parts.map(p => String(p).replace(/[^a-zA-Z0-9_-]/g, '_')).join('__') + '.json';
}

class DataFetcher {
  // `spot` is the resolved index instrument ({securityId, exchangeSegment, instrument, symbol}).
  // `optionExchangeSegment` is the segment options trade on (BSE_FNO for SENSEX, NSE_FNO for NIFTY).
  // `cacheLabel` tags cache filenames so SENSEX and NIFTY don't collide when sharing cacheDir.
  constructor({ client, sensex, spot, cacheDir, interval, optionExchangeSegment, cacheLabel }) {
    this.client = client;
    // Backwards-compat: existing callers pass `sensex` — alias to `spot`.
    this.spot = spot || sensex;
    this.interval = Number(interval);
    this.cacheDir = cacheDir;
    this.optionExchangeSegment = optionExchangeSegment || 'BSE_FNO';
    this.cacheLabel = cacheLabel || (this.spot && this.spot.symbol) || 'sensex';
    ensureDir(path.join(cacheDir, 'spot'));
    ensureDir(path.join(cacheDir, 'options'));
  }

  _readCache(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  }

  _writeCache(file, data) {
    fs.writeFileSync(file, JSON.stringify(data));
  }

  async getSpotCandles(expiryDate) {
    const file = path.join(
      this.cacheDir, 'spot',
      cacheKey([this.cacheLabel.toLowerCase(), this.interval, expiryDate])
    );
    const cached = this._readCache(file);
    if (cached) return cached;

    const fromDate = `${expiryDate} 09:00:00`;
    const toDate = `${expiryDate} 15:45:00`;

    const raw = await this.client.getIntradayCandles({
      securityId: this.spot.securityId,
      exchangeSegment: this.spot.exchangeSegment,
      instrument: this.spot.instrument,
      interval: this.interval,
      fromDate,
      toDate,
      oi: false
    });

    const candles = this._normalizeSpot(raw);
    this._writeCache(file, candles);
    return candles;
  }

  _normalizeSpot(raw) {
    if (!raw || !raw.open) return [];
    const { open, high, low, close, volume, timestamp } = raw;
    const n = Math.min(safeLen(open), safeLen(high), safeLen(low), safeLen(close), safeLen(timestamp));
    if (n === 0) return [];
    const out = [];
    for (let i = 0; i < n; i++) {
      if (open[i] == null || close[i] == null) continue;
      out.push({ t: timestamp[i], o: open[i], h: high[i], l: low[i], c: close[i], v: volume?.[i] || 0 });
    }
    return out;
  }

  async getOptionCandles({ expiryDate, strikeOffset, optionType, spotCandles }) {
    const strikeTag = strikeOffset === 0 ? 'ATM' : (strikeOffset > 0 ? `ATM+${strikeOffset}` : `ATM${strikeOffset}`);
    const file = path.join(
      this.cacheDir, 'options',
      cacheKey([this.cacheLabel.toLowerCase(), expiryDate, this.interval, strikeTag, optionType])
    );
    const cached = this._readCache(file);
    if (cached) return cached;

    let candles = [];
    try {
      const raw = await this.client.getRollingOptionCandles({
        exchangeSegment: this.optionExchangeSegment,
        instrument: 'OPTIDX',
        securityId: this.spot.securityId,
        interval: this.interval,
        expiryCode: 0,
        expiryFlag: 'WEEK',
        strike: strikeTag,
        optionType,
        fromDate: expiryDate,
        toDate: expiryDate
      });
      candles = this._normalizeOption(raw, optionType);
    } catch (_) { /* fall through to synthetic */ }

    // Fall back to BSM synthetic option prices derived from spot candles
    if (candles.length === 0 && spotCandles && spotCandles.length > 0) {
      candles = synthOptionCandles(spotCandles, strikeOffset, optionType);
    }

    if (candles.length > 0) this._writeCache(file, candles);
    return candles;
  }

  _normalizeOption(raw, optionType) {
    if (!raw || !raw.data) return [];
    const src = raw.data[optionType === 'CALL' ? 'ce' : 'pe'];
    if (!src || !src.open) return [];
    const n = Math.min(safeLen(src.open), safeLen(src.high), safeLen(src.low), safeLen(src.close), safeLen(src.timestamp));
    if (n === 0) return [];
    const out = [];
    for (let i = 0; i < n; i++) {
      if (src.open[i] == null || src.close[i] == null) continue;
      out.push({
        t: src.timestamp[i], o: src.open[i], h: src.high[i], l: src.low[i], c: src.close[i],
        v: src.volume?.[i] || 0, oi: src.oi?.[i] || 0, iv: src.iv?.[i] || 0,
        spot: src.spot?.[i] || 0, strike: src.strike?.[i] || 0
      });
    }
    return out;
  }
}

module.exports = DataFetcher;
