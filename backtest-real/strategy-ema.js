/**
 * EMA 9/21 CROSSOVER STRATEGY
 *
 * Entry rule: when EMA9 crosses above EMA21 → CALL
 *             when EMA9 crosses below EMA21 → PUT
 *
 * Mirrors strategy-runner.js (ORB+VWAP) shape so it slots into the same
 * pipeline: fed spotCandles, returns { signals, ... } with the entry
 * timestamp the trade-simulator can match against option candles.
 *
 * Conservative defaults: only one entry per day, only during the
 * 9:31–14:30 IST window so EOD square-off has time to act.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const EMA_FAST_PERIOD = 9;
const EMA_SLOW_PERIOD = 21;

// Entry window IST: 9:31–14:30 (gives ~45 min before 15:15 square-off)
const SIGNAL_START_MINS = 9 * 60 + 31;
const SIGNAL_END_MINS   = 14 * 60 + 30;

function istTime(unixSec) {
  return new Date(unixSec * 1000 + IST_OFFSET_MS);
}

function istMins(d) {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function isAfterMarketOpen(date) {
  return istMins(date) >= 9 * 60 + 15;
}

// Standard EMA. seed = SMA of the first `period` values, then standard
// recursive formula.
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
  if (!spotCandles || spotCandles.length < EMA_SLOW_PERIOD + 2) {
    return { signals: [], reason: 'insufficient_candles' };
  }

  // Filter to market-hours only — we don't want pre-market noise
  // contaminating EMA history.
  const candles = spotCandles.filter(c => isAfterMarketOpen(istTime(c.t)));
  if (candles.length < EMA_SLOW_PERIOD + 2) {
    return { signals: [], reason: 'insufficient_intraday_candles' };
  }

  const closes = candles.map(c => c.c);
  const ema9   = ema(closes, EMA_FAST_PERIOD);
  const ema21  = ema(closes, EMA_SLOW_PERIOD);

  const signals = [];
  let alreadyFired = false;

  // Walk forward looking for the first crossover inside the entry window.
  for (let i = EMA_SLOW_PERIOD; i < candles.length; i++) {
    if (alreadyFired) break;
    if (ema9[i] == null || ema21[i] == null || ema9[i - 1] == null || ema21[i - 1] == null) continue;

    const prevDiff = ema9[i - 1] - ema21[i - 1];
    const currDiff = ema9[i]     - ema21[i];

    let direction = null;
    if (prevDiff <= 0 && currDiff > 0) direction = 'CALL';   // bullish cross-up
    else if (prevDiff >= 0 && currDiff < 0) direction = 'PUT'; // bearish cross-down

    if (!direction) continue;

    const ist = istTime(candles[i].t);
    const mins = istMins(ist);
    if (mins < SIGNAL_START_MINS || mins > SIGNAL_END_MINS) continue;

    signals.push({
      candleIndex:    i,
      entryCandle:    candles[i],
      entryTimestamp: candles[i].t,
      entryIst:       ist.toISOString(),
      signal:         direction,
      score:          80,
      ema9:           +ema9[i].toFixed(2),
      ema21:          +ema21[i].toFixed(2),
      crossDelta:     +(currDiff).toFixed(2)
    });
    alreadyFired = true;
  }

  return { signals };
}

module.exports = { runStrategy, ema, istTime };
