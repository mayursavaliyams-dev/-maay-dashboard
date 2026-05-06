const { calculateVWAP } = require('../strategy');

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Minimum ORB range as % of spot — filters out low-volatility days
const MIN_ORB_RANGE_PCT = 0.003; // 0.3%

// Only enter within first hour after ORB: 9:31–10:30 IST
const SIGNAL_START_MINS = 9 * 60 + 31;
const SIGNAL_END_MINS   = 10 * 60 + 30;

function istTime(unixSec) {
  return new Date(unixSec * 1000 + IST_OFFSET_MS);
}

function istMins(date) {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function isInOrbWindow(date) {
  const m = istMins(date);
  return m >= 9 * 60 + 15 && m <= 9 * 60 + 30;
}

function isAfterMarketOpen(date) {
  return istMins(date) >= 9 * 60 + 15;
}

function runStrategy(spotCandles) {
  if (!spotCandles || spotCandles.length < 4) {
    return { signals: [], orbHigh: null, orbLow: null, reason: 'insufficient_candles' };
  }

  const prices  = [];
  const volumes = [];
  let orbHigh = null;
  let orbLow  = null;
  const signals = [];
  const maxSignals = Math.max(1, Number(process.env.BACKTEST_MAX_TRADES_PER_DAY || process.env.MAX_TRADES_PER_DAY || 1));

  for (let i = 0; i < spotCandles.length; i++) {
    const candle = spotCandles[i];
    const ist    = istTime(candle.t);
    const mins   = istMins(ist);

    if (!isAfterMarketOpen(ist)) continue;

    prices.push(candle.c);
    volumes.push(candle.v || 1);

    if (isInOrbWindow(ist)) {
      if (orbHigh === null || candle.h > orbHigh) orbHigh = candle.h;
      if (orbLow  === null || candle.l < orbLow)  orbLow  = candle.l;
      continue;
    }

    if (orbHigh === null || orbLow === null) continue;
    if (signals.length >= maxSignals) continue;

    const orbRangePct = (orbHigh - orbLow) / orbLow;
    if (orbRangePct < MIN_ORB_RANGE_PCT) continue;
    if (mins < SIGNAL_START_MINS || mins > SIGNAL_END_MINS) continue;

    const vwap      = calculateVWAP(prices, volumes);
    const bullBreak = candle.c > orbHigh && candle.c > vwap;
    const bearBreak = candle.c < orbLow  && candle.c < vwap;
    const direction = bullBreak ? 'CALL' : bearBreak ? 'PUT' : null;

    if (direction) {
      signals.push({
        candleIndex:    i,
        entryCandle:    candle,
        entryTimestamp: candle.t,
        entryIst:       ist.toISOString(),
        signal:         direction,
        score:          85,
        orbHigh, orbLow, vwap,
        orbRangePct:    +(orbRangePct * 100).toFixed(3)
      });
    }
  }

  return { signals, orbHigh, orbLow };
}

module.exports = { runStrategy, istTime };
