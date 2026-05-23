/**
 * MULTI-CONFIRMATION F&O STRATEGY (ported from the TradingView Pine v5 script
 * "F&O Profit Strategy [Multi-Confirm]"). Pure JS over a close-price series so
 * it runs in the options bot without disrupting the existing AI signal path.
 *
 * Layers (all must agree for an entry):
 *   CORE 5 : EMA-stack(9/21/50) + slope, VWAP side, RSI zone, volume spike, candle body
 *   FILTER : not-sideways (range% + EMA-cross chop)
 *   SHIELDS: ADX>min, Supertrend side, higher-TF EMA side
 *
 * CE BUY (Pine) → 'CALL';  PE BUY → 'PUT';  else 'WAIT'.
 *
 * The server feeds: closes[] (price snapshots used as the close series),
 * volumes[], the latest OHLC candle, the session VWAP, and an optional
 * higher-TF close for the HTF-EMA check. Every layer is reported back with a
 * pass/fail so the dashboard can render the confirmation table.
 *
 * NOTE: snapshots are not true OHLC candles, so EMA/RSI/ATR here are
 * approximations of the Pine values on real 3/5-min bars. Treated as a live
 * confirmation read-out, not a backtest-grade signal.
 */

// ── indicator helpers (no look-ahead; value as of the last element) ──────────
function ema(series, period) {
  if (!series.length) return null;
  const k = 2 / (period + 1);
  let e = series[0];
  for (let i = 1; i < series.length; i++) e = series[i] * k + e * (1 - k);
  return e;
}
function emaSeries(series, period) {
  const out = []; const k = 2 / (period + 1); let e = series[0];
  out.push(e);
  for (let i = 1; i < series.length; i++) { e = series[i] * k + e * (1 - k); out.push(e); }
  return out;
}
function rsi(series, period = 14) {
  if (series.length < period + 1) return 50;
  let gain = 0, loss = 0;
  for (let i = series.length - period; i < series.length; i++) {
    const d = series[i] - series[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  if (loss === 0) return 100;
  const rs = (gain / period) / (loss / period);
  return 100 - 100 / (1 + rs);
}
function sma(series, period) {
  const n = Math.min(period, series.length);
  if (!n) return null;
  let s = 0; for (let i = series.length - n; i < series.length; i++) s += series[i];
  return s / n;
}
// True-range ATR proxy from a close series (no H/L per bar → |Δclose|).
function atrFromCloses(series, period = 14) {
  const n = Math.min(period, series.length - 1);
  if (n < 1) return 0;
  let s = 0; for (let i = series.length - n; i < series.length; i++) s += Math.abs(series[i] - series[i - 1]);
  return s / n;
}
// ADX proxy: directional strength from close-to-close moves over the window.
// Real ADX needs H/L; this approximates trend strength so the shield is usable.
function adxProxy(series, period = 14) {
  const n = Math.min(period, series.length - 1);
  if (n < 2) return 0;
  let up = 0, dn = 0, tr = 0;
  for (let i = series.length - n; i < series.length; i++) {
    const d = series[i] - series[i - 1];
    if (d > 0) up += d; else dn -= d;
    tr += Math.abs(d);
  }
  if (tr === 0) return 0;
  const diPlus = (up / tr) * 100, diMinus = (dn / tr) * 100;
  const dx = Math.abs(diPlus - diMinus) / ((diPlus + diMinus) || 1) * 100;
  return dx;
}
// Count EMA-fast/EMA-mid crosses over the last `look` bars (chop detector).
function emaCrosses(closes, fastLen, midLen, look) {
  const f = emaSeries(closes, fastLen), m = emaSeries(closes, midLen);
  let crosses = 0;
  const start = Math.max(1, closes.length - look);
  for (let i = start; i < closes.length; i++) {
    const prevDiff = f[i - 1] - m[i - 1], diff = f[i] - m[i];
    if ((prevDiff <= 0 && diff > 0) || (prevDiff >= 0 && diff < 0)) crosses++;
  }
  return crosses;
}

const DEFAULTS = {
  emaFast: 9, emaMid: 21, emaSlow: 50,
  rsiLen: 14, rsiOb: 70, rsiOs: 30, rsiBullMin: 45, rsiBearMax: 55,
  volMaLen: 20, volSpikeMult: 1.2,
  minBodyPct: 40,
  swLookback: 20, swThreshold: 0.8, swCrossMax: 3, swCrossLook: 10,
  atrLen: 14, atrSlMult: 1.5, rrTarget1: 1.0, rrTarget2: 2.0,
  adxMin: 20, stFactor: 3.0, stAtrLen: 10,
  useAdx: true, useSupertrend: true, useHtf: true,
};

/**
 * Evaluate all layers. Inputs:
 *   closes   : number[]  price snapshots (close series), oldest→newest
 *   volumes  : number[]  matching volume series
 *   candle   : { open, high, low, close }  latest bar
 *   vwap     : number    session VWAP
 *   htfClose : number?   higher-TF reference close (for HTF-EMA side); optional
 *   cfg      : overrides of DEFAULTS
 * Returns { signal, callScore, putScore, layers, shields, values }.
 */
function evaluate({ closes, volumes, candle, vwap, htfClose, cfg = {} }) {
  const C = { ...DEFAULTS, ...cfg };
  if (!closes || closes.length < C.emaSlow + 2) {
    return { signal: 'WAIT', reason: 'warming up', callScore: 0, putScore: 0, layers: {}, shields: {}, values: {} };
  }
  const price = closes[closes.length - 1];

  // CORE 1 — EMA stacking + slope
  const eF = ema(closes, C.emaFast), eM = ema(closes, C.emaMid), eS = ema(closes, C.emaSlow);
  const eFprev = ema(closes.slice(0, -2), C.emaFast), eMprev = ema(closes.slice(0, -2), C.emaMid);
  const bullStack = eF > eM && eM > eS && price > eS;
  const bearStack = eF < eM && eM < eS && price < eS;
  const bullMomentum = bullStack && eF > eFprev && eM > eMprev;
  const bearMomentum = bearStack && eF < eFprev && eM < eMprev;

  // CORE 2 — VWAP side
  const vwapBull = vwap ? price > vwap : false;
  const vwapBear = vwap ? price < vwap : false;

  // CORE 3 — RSI zone
  const r = rsi(closes, C.rsiLen);
  const rsiBullOk = r > C.rsiBullMin && r < C.rsiOb;
  const rsiBearOk = r < C.rsiBearMax && r > C.rsiOs;

  // CORE 4 — volume spike
  const volMa = sma(volumes, C.volMaLen) || 0;
  const lastVol = volumes[volumes.length - 1] || 0;
  const volSpike = volMa > 0 ? lastVol > volMa * C.volSpikeMult : false;

  // CORE 5 — candle body strength
  let bullCandle = false, bearCandle = false, bodyPct = 0;
  if (candle) {
    const range = candle.high - candle.low, body = Math.abs(candle.close - candle.open);
    bodyPct = range > 0 ? (body / range) * 100 : 0;
    const strong = bodyPct >= C.minBodyPct;
    bullCandle = candle.close > candle.open && strong;
    bearCandle = candle.close < candle.open && strong;
  }

  // FILTER — sideways / chop
  const recent = closes.slice(-C.swLookback);
  const rngHi = Math.max(...recent), rngLo = Math.min(...recent);
  const rangePct = rngLo > 0 ? (rngHi - rngLo) / rngLo * 100 : 0;
  const crosses = emaCrosses(closes, C.emaFast, C.emaMid, C.swCrossLook);
  const isSideways = rangePct <= C.swThreshold || crosses >= C.swCrossMax;
  const notSideways = !isSideways;

  // SHIELD — ADX
  const adx = adxProxy(closes, C.atrLen);
  const adxOk = !C.useAdx || adx >= C.adxMin;

  // SHIELD — Supertrend (proxy: price vs ATR band around the mid EMA)
  const atr = atrFromCloses(closes, C.stAtrLen);
  const stUpper = eM + C.stFactor * atr, stLower = eM - C.stFactor * atr;
  const stBull = !C.useSupertrend || price > stLower;
  const stBear = !C.useSupertrend || price < stUpper;

  // SHIELD — higher-TF EMA side (if a HTF close was provided)
  const htfBull = !C.useHtf || htfClose == null || price > htfClose;
  const htfBear = !C.useHtf || htfClose == null || price < htfClose;

  // SCORES (core 5, like the Pine table)
  const callScore = (bullStack ? 1 : 0) + (vwapBull ? 1 : 0) + (rsiBullOk ? 1 : 0) + (volSpike ? 1 : 0) + (bullCandle ? 1 : 0);
  const putScore  = (bearStack ? 1 : 0) + (vwapBear ? 1 : 0) + (rsiBearOk ? 1 : 0) + (volSpike ? 1 : 0) + (bearCandle ? 1 : 0);

  const coreBuy  = bullMomentum && vwapBull && rsiBullOk && volSpike && bullCandle && notSideways;
  const coreSell = bearMomentum && vwapBear && rsiBearOk && volSpike && bearCandle && notSideways;
  const shieldsOk = adxOk;

  let signal = 'WAIT';
  if (coreBuy && stBull && htfBull && shieldsOk) signal = 'CALL';
  else if (coreSell && stBear && htfBear && shieldsOk) signal = 'PUT';

  // ATR-based SL/TP levels (for display + downstream use)
  const slDist = atrFromCloses(closes, C.atrLen) * C.atrSlMult;
  const levels = signal === 'CALL'
    ? { sl: price - slDist, tp1: price + slDist * C.rrTarget1, tp2: price + slDist * C.rrTarget2 }
    : signal === 'PUT'
    ? { sl: price + slDist, tp1: price - slDist * C.rrTarget1, tp2: price - slDist * C.rrTarget2 }
    : { sl: null, tp1: null, tp2: null };

  return {
    signal,
    callScore, putScore,
    layers: {
      emaStack:  { bull: bullStack, bear: bearStack },
      vwap:      { bull: vwapBull, bear: vwapBear },
      rsi:       { value: +r.toFixed(1), bull: rsiBullOk, bear: rsiBearOk },
      volume:    { ratio: volMa > 0 ? +(lastVol / volMa).toFixed(2) : 0, spike: volSpike },
      candle:    { bodyPct: +bodyPct.toFixed(0), bull: bullCandle, bear: bearCandle },
      sideways:  { rangePct: +rangePct.toFixed(2), crosses, choppy: isSideways }
    },
    shields: {
      adx:        { value: +adx.toFixed(1), ok: adxOk },
      supertrend: { bull: stBull, bear: stBear },
      htf:        { bull: htfBull, bear: htfBear, ref: htfClose ?? null }
    },
    values: { price: +price.toFixed(2), ema9: +eF.toFixed(2), ema21: +eM.toFixed(2), ema50: +eS.toFixed(2), vwap: vwap ? +vwap.toFixed(2) : null, atr: +atr.toFixed(2), ...levels }
  };
}

module.exports = { evaluate, DEFAULTS };
