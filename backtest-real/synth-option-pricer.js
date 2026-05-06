/**
 * Synthetic 0-DTE option pricer (Black-Scholes).
 * Fallback when real option candle data is unavailable.
 * IV = 8% — calibrated to observed SENSEX expiry-morning premiums (~0.5% daily move priced in).
 */

const TRADING_HOURS_PER_DAY = 6.5;      // 9:15–15:45
const TRADING_DAYS_PER_YEAR = 252;
const DEFAULT_IV = 0.08;                 // 8% effective IV for SENSEX 0-DTE (market prices ~0.5% daily move)
const STRIKE_STEP = 100;                 // SENSEX options in 100-pt increments
const MARKET_OPEN_HOUR_UTC = 3;         // 9:15 IST = 03:45 UTC  (approx 3h)
const MARKET_OPEN_MIN_UTC  = 45;
const MARKET_CLOSE_HOUR_UTC = 10;       // 15:30 IST = 10:00 UTC
const MARKET_CLOSE_MIN_UTC  = 0;

// ── Normal distribution helpers ──────────────────────────────────────────────

function normPDF(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

function normCDF(x) {
  const a1 =  0.254829592, a2 = -0.284496736, a3 =  1.421413741;
  const a4 = -1.453152027, a5 =  1.061405429, p  =  0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + p * x);
  const poly = t * (a1 + t * (a2 + t * (a3 + t * (a4 + t * a5))));
  return 0.5 * (1 + sign * (1 - poly * Math.exp(-x * x)));
}

// ── Black-Scholes price ───────────────────────────────────────────────────────

function bsmPrice(spot, strike, T, iv, type) {
  if (T <= 0) {
    // At expiry: intrinsic value only
    if (type === 'CE') return Math.max(spot - strike, 0);
    return Math.max(strike - spot, 0);
  }
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(spot / strike) + 0.5 * iv * iv * T) / (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;
  if (type === 'CE') return spot * normCDF(d1) - strike * normCDF(d2);
  return strike * normCDF(-d2) - spot * normCDF(-d1);
}

// ── Time-to-expiry in years (trading time) ────────────────────────────────────

function tteYears(candleTimestampSec) {
  const d = new Date(candleTimestampSec * 1000);
  const hUtc = d.getUTCHours(), mUtc = d.getUTCMinutes();
  const candleMins = hUtc * 60 + mUtc;
  const closeMins  = MARKET_CLOSE_HOUR_UTC * 60 + MARKET_CLOSE_MIN_UTC;
  const remainMins = Math.max(closeMins - candleMins, 0);
  const remainHrs  = remainMins / 60;
  return remainHrs / (TRADING_HOURS_PER_DAY * TRADING_DAYS_PER_YEAR);
}

// ── Build synthetic option candles from spot candles ─────────────────────────

/**
 * @param {Array}  spotCandles  – normalised spot candles {t,o,h,l,c,v}
 * @param {number} strikeOffset – e.g. +1 → ATM+100, -1 → ATM-100
 * @param {string} optionType   – 'CALL' | 'PUT'
 * @param {number} [iv]         – annualised IV override
 * @returns {Array} option candles in same {t,o,h,l,c,v} format
 */
function synthOptionCandles(spotCandles, strikeOffset, optionType, iv = DEFAULT_IV) {
  if (!spotCandles || spotCandles.length === 0) return [];

  const orbEndMins = MARKET_OPEN_HOUR_UTC * 60 + MARKET_OPEN_MIN_UTC + 15;
  const type = optionType === 'CALL' ? 'CE' : 'PE';

  // Determine ATM from first post-ORB candle — found inline to avoid second pass
  let strike = null;
  const out = [];

  for (const c of spotCandles) {
    const d    = new Date(c.t * 1000);
    const mins = d.getUTCHours() * 60 + d.getUTCMinutes();

    if (strike === null && mins > orbEndMins) {
      strike = Math.round(c.c / STRIKE_STEP) * STRIKE_STEP + strikeOffset * STRIKE_STEP;
    }
    if (strike === null) continue;

    const T  = tteYears(c.t);
    const o  = Math.max(bsmPrice(c.o, strike, T, iv, type), 0.05);
    const h  = Math.max(bsmPrice(c.h, strike, T, iv, type), 0.05);
    const l  = Math.max(bsmPrice(c.l, strike, T, iv, type), 0.05);
    const cl = Math.max(bsmPrice(c.c, strike, T, iv, type), 0.05);
    out.push({ t: c.t, o, h: Math.max(o, h, cl), l: Math.min(o, l, cl), c: cl, v: 0, strike, spot: c.c, synthetic: true });
  }

  return out;
}

module.exports = { synthOptionCandles, bsmPrice, tteYears };
