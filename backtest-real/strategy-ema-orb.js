/**
 * EMA + ORB COMBO STRATEGY
 *
 * Same EMA 9/21 crossover as strategy-ema.js, BUT only fires the signal
 * when price is also outside the Opening Range (9:15–9:30 IST).
 *   - CALL fires only if EMA9 crosses above EMA21 AND price > ORB high
 *   - PUT fires only if EMA9 crosses below EMA21 AND price < ORB low
 *
 * Goal: dramatically reduce false signals from EMA-alone (which gave us
 * 8% win rate). ORB filter rejects intra-range whipsaws.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const EMA_FAST_PERIOD = 9;
const EMA_SLOW_PERIOD = 21;
const SIGNAL_START_MINS = 9 * 60 + 31;
const SIGNAL_END_MINS   = 14 * 60 + 30;

function istTime(unixSec) { return new Date(unixSec * 1000 + IST_OFFSET_MS); }
function istMins(d)       { return d.getUTCHours() * 60 + d.getUTCMinutes(); }
function isAfterMarketOpen(date) { return istMins(date) >= 9 * 60 + 15; }
function isInOrbWindow(date) {
  const m = istMins(date);
  return m >= 9 * 60 + 15 && m <= 9 * 60 + 30;
}

function ema(values, period) {
  if (!values || values.length < period) return [];
  const k = 2 / (period + 1);
  const out = new Array(values.length).fill(null);
  let sma = 0;
  for (let i = 0; i < period; i++) sma += values[i];
  sma /= period;
  out[period - 1] = sma;
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

function runStrategy(spotCandles) {
  if (!spotCandles || spotCandles.length < EMA_SLOW_PERIOD + 4) {
    return { signals: [], reason: 'insufficient_candles' };
  }
  const candles = spotCandles.filter(c => isAfterMarketOpen(istTime(c.t)));
  if (candles.length < EMA_SLOW_PERIOD + 2) {
    return { signals: [], reason: 'insufficient_intraday_candles' };
  }

  // Compute ORB (high/low across 9:15–9:30 candles).
  let orbHigh = null, orbLow = null;
  for (const c of candles) {
    if (!isInOrbWindow(istTime(c.t))) continue;
    if (orbHigh === null || c.h > orbHigh) orbHigh = c.h;
    if (orbLow  === null || c.l < orbLow)  orbLow  = c.l;
  }
  if (orbHigh === null || orbLow === null) {
    return { signals: [], reason: 'no_orb' };
  }

  const closes = candles.map(c => c.c);
  const ema9   = ema(closes, EMA_FAST_PERIOD);
  const ema21  = ema(closes, EMA_SLOW_PERIOD);

  const signals = [];
  let alreadyFired = false;
  for (let i = EMA_SLOW_PERIOD; i < candles.length; i++) {
    if (alreadyFired) break;
    if (ema9[i] == null || ema21[i] == null || ema9[i - 1] == null || ema21[i - 1] == null) continue;

    const prevDiff = ema9[i - 1] - ema21[i - 1];
    const currDiff = ema9[i]     - ema21[i];
    const ist = istTime(candles[i].t);
    const mins = istMins(ist);
    if (mins < SIGNAL_START_MINS || mins > SIGNAL_END_MINS) continue;

    let direction = null;
    // EMA bullish cross AND price broke ORB high → CALL
    if (prevDiff <= 0 && currDiff > 0 && candles[i].c > orbHigh) direction = 'CALL';
    // EMA bearish cross AND price broke ORB low → PUT
    else if (prevDiff >= 0 && currDiff < 0 && candles[i].c < orbLow) direction = 'PUT';

    if (!direction) continue;

    signals.push({
      candleIndex:    i,
      entryCandle:    candles[i],
      entryTimestamp: candles[i].t,
      entryIst:       ist.toISOString(),
      signal:         direction,
      score:          90,  // higher than EMA-alone (filter applied)
      ema9:           +ema9[i].toFixed(2),
      ema21:          +ema21[i].toFixed(2),
      orbHigh, orbLow
    });
    alreadyFired = true;
  }

  return { signals, orbHigh, orbLow };
}

module.exports = { runStrategy };
