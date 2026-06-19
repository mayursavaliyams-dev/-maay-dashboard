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

// ── Bollinger Bands — SMA(period) ± mult·stdev. %B = position within bands. ──
function bollinger(series, period = 20, mult = 2) {
  if (!series || series.length < period) return null;
  const win = series.slice(-period);
  const mid = win.reduce((s, v) => s + v, 0) / period;
  const variance = win.reduce((s, v) => s + (v - mid) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  const upper = mid + mult * sd, lower = mid - mult * sd;
  const price = series[series.length - 1];
  const pctB = upper !== lower ? (price - lower) / (upper - lower) : 0.5; // 0=lower, 1=upper
  const bandwidth = mid > 0 ? (upper - lower) / mid : 0;
  return { upper: +upper.toFixed(2), mid: +mid.toFixed(2), lower: +lower.toFixed(2), pctB: +pctB.toFixed(3), bandwidth: +bandwidth.toFixed(4) };
}

// ── MACD — EMA(fast) − EMA(slow); signal = EMA(macd, signalLen); hist = macd − signal. ──
function macd(series, fast = 12, slow = 26, signalLen = 9) {
  if (!series || series.length < slow + signalLen) return null;
  const fastSer = emaSeries(series, fast), slowSer = emaSeries(series, slow);
  const macdSer = fastSer.map((v, i) => v - slowSer[i]).slice(slow - 1); // align from where slow is valid
  const sigSer = emaSeries(macdSer, signalLen);
  const m = macdSer[macdSer.length - 1], sig = sigSer[sigSer.length - 1];
  const histNow = m - sig;
  const histPrev = macdSer.length >= 2 && sigSer.length >= 2 ? macdSer[macdSer.length - 2] - sigSer[sigSer.length - 2] : histNow;
  return { macd: +m.toFixed(2), signal: +sig.toFixed(2), hist: +histNow.toFixed(2), rising: histNow > histPrev };
}

// ── Stochastic %K over closes (no per-bar H/L → use close window). ──
function stochastic(series, period = 14, smooth = 3) {
  if (!series || series.length < period + smooth) return null;
  const k = (end) => {
    const win = series.slice(end - period, end);
    const hi = Math.max(...win), lo = Math.min(...win);
    return hi !== lo ? ((series[end - 1] - lo) / (hi - lo)) * 100 : 50;
  };
  const ks = [];
  for (let e = series.length - smooth + 1; e <= series.length; e++) ks.push(k(e));
  const kSmoothed = ks.reduce((s, v) => s + v, 0) / ks.length;
  return { k: +kSmoothed.toFixed(1) };
}

// ── OBV — On-Balance Volume; rising/falling tells volume-confirmed direction. ──
function obv(closes, volumes, look = 10) {
  if (!closes || !volumes || closes.length < look + 1) return null;
  let o = 0; const series = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) o += volumes[i] || 0;
    else if (closes[i] < closes[i - 1]) o -= volumes[i] || 0;
    series.push(o);
  }
  const now = series[series.length - 1], prev = series[series.length - 1 - look] ?? series[0];
  return { value: now, rising: now > prev, slope: now - prev };
}

const DEFAULTS = {
  emaFast: 9, emaMid: 21, emaSlow: 50,
  rsiLen: 14, rsiOb: 70, rsiOs: 30, rsiBullMin: 45, rsiBearMax: 55,
  volMaLen: 20, volSpikeMult: 1.2,
  minBodyPct: 40,
  swLookback: 20, swThreshold: 0.8, swCrossMax: 3, swCrossLook: 10,
  atrLen: 14, atrSlMult: 1.5, rrTarget1: 1.0, rrTarget2: 2.0,
  adxMin: 20, stFactor: 3.0, stAtrLen: 10,
  // New indicators
  bbLen: 20, bbMult: 2, macdFast: 12, macdSlow: 26, macdSignal: 9,
  stochLen: 14, stochSmooth: 3, stochOb: 80, stochOs: 20, obvLook: 10,
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

  // ── EXTRA INDICATORS ───────────────────────────────────────────────────────
  // Bollinger: bull bias when price reclaims from the lower band (%B < 0.2 →
  // oversold rebound), bear bias near the upper band (%B > 0.8 → overbought).
  const bb = bollinger(closes, C.bbLen, C.bbMult);
  const bbBull = bb ? bb.pctB <= 0.2 : false;   // near/below lower band → mean-reversion long
  const bbBear = bb ? bb.pctB >= 0.8 : false;   // near/above upper band → mean-reversion short

  // MACD: histogram > 0 and rising = bullish momentum; < 0 and falling = bearish.
  const mac = macd(closes, C.macdFast, C.macdSlow, C.macdSignal);
  const macdBull = mac ? (mac.hist > 0 && mac.rising) : false;
  const macdBear = mac ? (mac.hist < 0 && !mac.rising) : false;

  // Stochastic: oversold (<20) leaving = bull, overbought (>80) leaving = bear.
  const st = stochastic(closes, C.stochLen, C.stochSmooth);
  const stochBull = st ? st.k <= C.stochOs : false;
  const stochBear = st ? st.k >= C.stochOb : false;

  // OBV: volume-confirmed direction.
  const ob = obv(closes, volumes, C.obvLook);
  const obvBull = ob ? ob.rising : false;
  const obvBear = ob ? !ob.rising : false;

  // SCORES — core 5 (Pine table) + 3 extra momentum confirmations (MACD, OBV,
  // Bollinger). Stochastic stays advisory (mean-reversion timing, not trend).
  const callScore = (bullStack ? 1 : 0) + (vwapBull ? 1 : 0) + (rsiBullOk ? 1 : 0) + (volSpike ? 1 : 0) + (bullCandle ? 1 : 0)
                  + (macdBull ? 1 : 0) + (obvBull ? 1 : 0) + (bbBull ? 1 : 0);
  const putScore  = (bearStack ? 1 : 0) + (vwapBear ? 1 : 0) + (rsiBearOk ? 1 : 0) + (volSpike ? 1 : 0) + (bearCandle ? 1 : 0)
                  + (macdBear ? 1 : 0) + (obvBear ? 1 : 0) + (bbBear ? 1 : 0);

  const coreBuy  = bullMomentum && vwapBull && rsiBullOk && volSpike && bullCandle && notSideways;
  const coreSell = bearMomentum && vwapBear && rsiBearOk && volSpike && bearCandle && notSideways;
  const shieldsOk = adxOk;
  // MACD as a momentum shield: don't take a CALL while MACD histogram is firmly
  // bearish (and vice-versa). Permissive when MACD is unavailable/neutral.
  const macdCallOk = !mac || mac.hist >= 0 || mac.rising;
  const macdPutOk  = !mac || mac.hist <= 0 || !mac.rising;

  let signal = 'WAIT';
  if (coreBuy && stBull && htfBull && shieldsOk && macdCallOk) signal = 'CALL';
  else if (coreSell && stBear && htfBear && shieldsOk && macdPutOk) signal = 'PUT';

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
      sideways:  { rangePct: +rangePct.toFixed(2), crosses, choppy: isSideways },
      macd:      mac ? { ...mac, bull: macdBull, bear: macdBear } : null,
      bollinger: bb  ? { ...bb, bull: bbBull, bear: bbBear } : null,
      stochastic: st ? { k: st.k, bull: stochBull, bear: stochBear } : null,
      obv:       ob  ? { rising: ob.rising, bull: obvBull, bear: obvBear } : null
    },
    shields: {
      adx:        { value: +adx.toFixed(1), ok: adxOk },
      supertrend: { bull: stBull, bear: stBear },
      htf:        { bull: htfBull, bear: htfBear, ref: htfClose ?? null },
      macd:       { callOk: macdCallOk, putOk: macdPutOk }
    },
    values: { price: +price.toFixed(2), ema9: +eF.toFixed(2), ema21: +eM.toFixed(2), ema50: +eS.toFixed(2), vwap: vwap ? +vwap.toFixed(2) : null, atr: +atr.toFixed(2),
      bbUpper: bb?.upper ?? null, bbLower: bb?.lower ?? null, bbPctB: bb?.pctB ?? null,
      macdHist: mac?.hist ?? null, stochK: st?.k ?? null, ...levels }
  };
}

module.exports = { evaluate, DEFAULTS, bollinger, macd, stochastic, obv, rsi };
