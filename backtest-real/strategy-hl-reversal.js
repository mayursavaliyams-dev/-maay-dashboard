/**
 * HIGH/LOW REVERSAL STRATEGY
 *
 * Fade-the-extreme: when price tests today's session high then prints a
 * bearish-rejection candle (close below open + lower close than prior bar),
 * enter a PUT (bet on reversal down).
 *
 * Mirror for session low → CALL.
 *
 * Designed for "regular" (every weekday) trading with a conservative
 * 1× (= +100% premium) target. Wins more often, smaller average gain.
 *
 * Filters:
 *   - Need ≥30 minutes of session data before any signal (avoid morning chop)
 *   - High/low must be at least 0.3% above/below day-open (real range)
 *   - Reversal candle must close at least 0.05% away from the extreme
 *   - One signal per day
 *   - Entry window: 9:45 – 14:30 IST
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const SIGNAL_START_MINS = 9 * 60 + 45;
const SIGNAL_END_MINS   = 14 * 60 + 30;

// Range filters
const MIN_RANGE_PCT     = 0.0030;   // 0.3% — extreme must be a real move from open
const REJECTION_PCT     = 0.0005;   // 0.05% — candle close must be away from extreme
const TOUCH_TOLERANCE   = 0.0010;   // 0.1% — high tested = within this of session high

function istTime(unixSec) { return new Date(unixSec * 1000 + IST_OFFSET_MS); }
function istMins(d)       { return d.getUTCHours() * 60 + d.getUTCMinutes(); }
function isAfterMarketOpen(date) { return istMins(date) >= 9 * 60 + 15; }

function runStrategy(spotCandles) {
  if (!spotCandles || spotCandles.length < 8) {
    return { signals: [], reason: 'insufficient_candles' };
  }
  const candles = spotCandles.filter(c => isAfterMarketOpen(istTime(c.t)));
  if (candles.length < 8) return { signals: [], reason: 'insufficient_intraday' };

  const dayOpen = candles[0].o;
  let sessionHigh = candles[0].h;
  let sessionLow  = candles[0].l;
  let sessionHighIdx = 0;
  let sessionLowIdx  = 0;

  const signals = [];
  let alreadyFired = false;

  for (let i = 1; i < candles.length; i++) {
    if (alreadyFired) break;
    const c    = candles[i];
    const prev = candles[i - 1];
    const ist  = istTime(c.t);
    const mins = istMins(ist);

    // Update running session extremes BEFORE evaluating signal.
    if (c.h > sessionHigh) { sessionHigh = c.h; sessionHighIdx = i; }
    if (c.l < sessionLow)  { sessionLow  = c.l; sessionLowIdx  = i; }

    // Need to be inside the entry window
    if (mins < SIGNAL_START_MINS || mins > SIGNAL_END_MINS) continue;

    // The session range must be meaningful (not just morning chop)
    const rangePct = (sessionHigh - sessionLow) / dayOpen;
    if (rangePct < MIN_RANGE_PCT * 2) continue;

    // ── BEARISH REVERSAL AT HIGH → PUT ──
    // Conditions:
    //   - Recent bar (any of last 3) touched session high
    //   - Current bar's CLOSE is below its OPEN (bearish bar)
    //   - Current close is at least REJECTION_PCT below session high
    //   - Session high made within last 5 bars (still relevant)
    const touchedHigh = (i - sessionHighIdx) <= 5
      && (sessionHigh - c.h) / sessionHigh < TOUCH_TOLERANCE * 2;
    const bearishBar  = c.c < c.o && c.c < prev.c;
    const rejectedHigh = (sessionHigh - c.c) / sessionHigh > REJECTION_PCT;

    if (touchedHigh && bearishBar && rejectedHigh) {
      signals.push({
        candleIndex:    i,
        entryCandle:    c,
        entryTimestamp: c.t,
        entryIst:       ist.toISOString(),
        signal:         'PUT',
        score:          75,
        sessionHigh,
        sessionLow,
        rejection:      +(((sessionHigh - c.c) / sessionHigh) * 100).toFixed(3),
        rangePct:       +(rangePct * 100).toFixed(3)
      });
      alreadyFired = true;
      continue;
    }

    // ── BULLISH REVERSAL AT LOW → CALL ──
    const touchedLow = (i - sessionLowIdx) <= 5
      && (c.l - sessionLow) / sessionLow < TOUCH_TOLERANCE * 2;
    const bullishBar  = c.c > c.o && c.c > prev.c;
    const rejectedLow = (c.c - sessionLow) / sessionLow > REJECTION_PCT;

    if (touchedLow && bullishBar && rejectedLow) {
      signals.push({
        candleIndex:    i,
        entryCandle:    c,
        entryTimestamp: c.t,
        entryIst:       ist.toISOString(),
        signal:         'CALL',
        score:          75,
        sessionHigh,
        sessionLow,
        rejection:      +(((c.c - sessionLow) / sessionLow) * 100).toFixed(3),
        rangePct:       +(rangePct * 100).toFixed(3)
      });
      alreadyFired = true;
    }
  }

  return { signals, sessionHigh, sessionLow };
}

module.exports = { runStrategy };
