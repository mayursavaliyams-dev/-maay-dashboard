/**
 * BACKTEST DATA SOURCE — equity 1-min candles
 *
 * Live mode: pulls intraday 1-min candles per symbol per day from Dhan
 * (/v2/charts/intraday, instrument=EQUITY), cached to disk so reruns are free.
 *
 * No-creds mode: generates a DETERMINISTIC synthetic session per (symbol, date)
 * — seeded by the date string so the same day always replays identically. This
 * lets the backtester run end-to-end without a broker, for engine validation.
 * Synthetic candles are clearly flagged source:'synthetic' and MUST NOT be
 * presented as a real historical result.
 *
 * Candle shape (per minute): { t (epoch ms), o, h, l, c, v }.
 */

const fs   = require('fs');
const path = require('path');

let DhanClient = null;
try { DhanClient = require('../../backtest-real/dhan-client'); } catch (_) { /* synthetic only */ }

const EQ_SEGMENT = 'NSE_EQ';
const SESSION_START_MIN = 9 * 60 + 15;   // 09:15 IST
const SESSION_END_MIN   = 15 * 60 + 30;  // 15:30 IST

function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); }

// Cheap deterministic PRNG (mulberry32) seeded from a string — same seed,
// same sequence, so a backtest day is reproducible across runs/machines.
function seedFromString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BASE_PRICES = { RELIANCE: 2900, HDFCBANK: 1650, INFY: 1500, TCS: 3900, ICICIBANK: 1150 };

class BacktestDataSource {
  constructor({ cacheDir = './data/stock-backtest-cache', idMapFile = './data/equity-ids.json' } = {}) {
    this.cacheDir = path.resolve(cacheDir);
    ensureDir(path.join(this.cacheDir, 'eq'));
    this.idMap = {};
    try { this.idMap = JSON.parse(fs.readFileSync(path.resolve(idMapFile), 'utf8')); } catch (_) {}

    const clientId = process.env.DHAN_CLIENT_ID, token = process.env.DHAN_ACCESS_TOKEN;
    this.client = (DhanClient && clientId && token) ? new DhanClient({ clientId, accessToken: token }) : null;
    this.live = !!this.client;
  }

  _cacheFile(symbol, date) {
    return path.join(this.cacheDir, 'eq', `${symbol.toLowerCase()}__${date}.json`);
  }

  // Returns array of 1-min candles for one symbol on one date (YYYY-MM-DD).
  async getCandles(symbol, date) {
    const sym = symbol.toUpperCase();
    const file = this._cacheFile(sym, date);
    try { const c = JSON.parse(fs.readFileSync(file, 'utf8')); if (c?.length) return c; } catch (_) {}

    let candles;
    if (this.live && this.idMap[sym]) {
      candles = await this._fetchDhan(sym, date);
    } else {
      candles = this._synthSession(sym, date);
    }
    try { fs.writeFileSync(file, JSON.stringify(candles)); } catch (_) {}
    return candles;
  }

  // Daily candles for one symbol over a date range (for swing/accumulation
  // strategies). Returns [{ t, o, h, l, c, v, source }] one per trading day.
  // Cached as eq/<sym>__daily__<from>__<to>.json.
  async getDailyCandles(symbol, fromDate, toDate) {
    const sym = symbol.toUpperCase();
    const file = path.join(this.cacheDir, 'eq', `${sym.toLowerCase()}__daily__${fromDate}__${toDate}.json`);
    try { const c = JSON.parse(fs.readFileSync(file, 'utf8')); if (c?.length) return c; } catch (_) {}

    let candles;
    if (this.live && this.idMap[sym]) {
      const raw = await this.client._post('/v2/charts/historical', {
        securityId: String(this.idMap[sym]), exchangeSegment: EQ_SEGMENT,
        instrument: 'EQUITY', fromDate, toDate
      });
      const o = raw?.open || [], h = raw?.high || [], l = raw?.low || [],
            c = raw?.close || [], v = raw?.volume || [], ts = raw?.timestamp || [];
      candles = [];
      for (let i = 0; i < c.length; i++) {
        candles.push({
          t: ts[i] ? Number(ts[i]) * 1000 : Date.parse(fromDate) + i * 86400000,
          o: +o[i], h: +h[i], l: +l[i], c: +c[i], v: +(v[i] || 0), source: 'dhan'
        });
      }
    } else {
      candles = this._synthDaily(sym, fromDate, toDate);
    }
    try { fs.writeFileSync(file, JSON.stringify(candles)); } catch (_) {}
    return candles;
  }

  // Deterministic synthetic daily series between two dates (validation only).
  _synthDaily(sym, fromDate, toDate) {
    const rng = mulberry32(seedFromString(`${sym}|daily|${fromDate}|${toDate}`));
    const base = BASE_PRICES[sym] || 1000;
    let price = base;
    const out = [];
    let d = Date.parse(fromDate + 'T00:00:00Z');
    const end = Date.parse(toDate + 'T00:00:00Z');
    while (d <= end) {
      const dow = new Date(d).getUTCDay();
      if (dow !== 0 && dow !== 6) {
        const o = price;
        const c = +(price * (1 + (rng() - 0.5) * 0.025)).toFixed(2);
        const hi = +(Math.max(o, c) * (1 + rng() * 0.01)).toFixed(2);
        const lo = +(Math.min(o, c) * (1 - rng() * 0.01)).toFixed(2);
        out.push({ t: d, o: +o.toFixed(2), h: hi, l: lo, c, v: Math.round(1e6 + rng() * 5e6), source: 'synthetic' });
        price = c;
      }
      d += 86400000;
    }
    return out;
  }

  async _fetchDhan(sym, date) {
    const securityId = this.idMap[sym];
    const raw = await this.client.getIntradayCandles({
      securityId, exchangeSegment: EQ_SEGMENT, instrument: 'EQUITY',
      interval: 1, fromDate: `${date} 09:00:00`, toDate: `${date} 15:45:00`, oi: false
    });
    const o = raw?.open || [], h = raw?.high || [], l = raw?.low || [], c = raw?.close || [],
          v = raw?.volume || [], ts = raw?.timestamp || raw?.start_Time || [];
    const out = [];
    for (let i = 0; i < c.length; i++) {
      out.push({
        t: ts[i] ? Number(ts[i]) * 1000 : Date.parse(`${date}T03:45:00Z`) + i * 60000,
        o: +o[i], h: +h[i], l: +l[i], c: +c[i], v: +(v[i] || 0), source: 'dhan'
      });
    }
    return out;
  }

  // Build one synthetic trading session: a gentle trend + noise random walk,
  // ~375 one-minute candles (09:15–15:30). Deterministic per (symbol, date).
  _synthSession(sym, date) {
    const rng = mulberry32(seedFromString(`${sym}|${date}`));
    const base = BASE_PRICES[sym] || 1000;
    // Day's character: trend direction & strength chosen from the seed.
    const trendPerMin = (rng() - 0.5) * 0.00025;     // small per-minute drift
    const vola = 0.0008 + rng() * 0.0009;            // per-minute volatility
    const dayBase = base * (1 + (rng() - 0.5) * 0.02); // open gap vs base

    const candles = [];
    let price = dayBase;
    const dayStartUtc = Date.parse(`${date}T03:45:00Z`); // 09:15 IST in UTC
    for (let m = 0; m <= SESSION_END_MIN - SESSION_START_MIN; m++) {
      const drift = trendPerMin;
      const shock = (rng() - 0.5) * 2 * vola;
      const o = price;
      const c = +(price * (1 + drift + shock)).toFixed(2);
      const hi = +(Math.max(o, c) * (1 + rng() * vola)).toFixed(2);
      const lo = +(Math.min(o, c) * (1 - rng() * vola)).toFixed(2);
      const v = Math.round(20000 + rng() * 200000);
      candles.push({ t: dayStartUtc + m * 60000, o: +o.toFixed(2), h: hi, l: lo, c, v, source: 'synthetic' });
      price = c;
    }
    return candles;
  }

  // List of trading dates (skips weekends) ending today, going back `days`.
  // Synthetic mode invents the calendar; live mode trusts the same calendar
  // and lets Dhan return empty for actual holidays (those days yield no trade).
  static tradingDates(days, endDate = null) {
    const out = [];
    let d = endDate ? new Date(endDate + 'T00:00:00Z') : new Date();
    while (out.length < days) {
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) out.push(d.toISOString().slice(0, 10));
      d = new Date(d.getTime() - 86400000);
    }
    return out.reverse();
  }
}

module.exports = BacktestDataSource;
module.exports.SESSION_START_MIN = SESSION_START_MIN;
module.exports.SESSION_END_MIN = SESSION_END_MIN;
