/**
 * ORB STRATEGY (pure, shared by backtest) — mirrors the live server's
 * updateSignal() exactly so backtest and live behave identically:
 *   - Opening range = high/low over the first `orbRangeMinutes` of the session.
 *   - LONG  when close breaks above ORB high with volume >= avg * mult.
 *   - SHORT when close breaks below ORB low  with volume >= avg * mult.
 *
 * Stateless helper: caller feeds candles in order and tracks the returned state.
 */

const { SESSION_START_MIN } = require('./data-source');

function minutesIntoSession(candleTs) {
  const ist = new Date(candleTs + 5.5 * 3600 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

// Build ORB levels and rolling avg-volume from the day's candles up to index i.
// Returns { orbHigh, orbLow, orbDone, avgVol } as of candle i.
function computeContext(candles, i, orbRangeMinutes) {
  const orbEnd = SESSION_START_MIN + orbRangeMinutes;
  let orbHigh = null, orbLow = null, orbDone = false;
  for (let k = 0; k <= i; k++) {
    const mins = minutesIntoSession(candles[k].t);
    if (mins < orbEnd) {
      orbHigh = orbHigh == null ? candles[k].h : Math.max(orbHigh, candles[k].h);
      orbLow  = orbLow  == null ? candles[k].l : Math.min(orbLow,  candles[k].l);
    } else {
      orbDone = orbHigh != null;
      break;
    }
  }
  // Rolling avg volume over last 20 candles (matches live engine window).
  const from = Math.max(0, i - 19);
  const vols = candles.slice(from, i + 1).map(c => c.v).filter(v => v > 0);
  const avgVol = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : 0;
  return { orbHigh, orbLow, orbDone, avgVol };
}

// Decide the signal at candle i. Returns 'BUY' | 'SELL' | 'WAIT' (+ reason).
function signalAt(candles, i, { orbRangeMinutes, volumeConfirmMult }) {
  const ctx = computeContext(candles, i, orbRangeMinutes);
  const mins = minutesIntoSession(candles[i].t);
  const orbEnd = SESSION_START_MIN + orbRangeMinutes;
  if (mins < orbEnd || !ctx.orbDone || ctx.orbHigh == null) {
    return { signal: 'WAIT', reason: 'building ORB', ctx };
  }
  const price = candles[i].c, vol = candles[i].v;
  const volOk = ctx.avgVol > 0 ? vol >= ctx.avgVol * volumeConfirmMult : true;
  if (price > ctx.orbHigh && volOk) {
    return { signal: 'BUY', reason: `break ORB high ${ctx.orbHigh.toFixed(2)} + vol ${(vol / (ctx.avgVol || 1)).toFixed(1)}×`, ctx };
  }
  if (price < ctx.orbLow && volOk) {
    return { signal: 'SELL', reason: `break ORB low ${ctx.orbLow.toFixed(2)} + vol ${(vol / (ctx.avgVol || 1)).toFixed(1)}×`, ctx };
  }
  return { signal: 'WAIT', reason: 'inside opening range', ctx };
}

module.exports = { signalAt, computeContext, minutesIntoSession };
