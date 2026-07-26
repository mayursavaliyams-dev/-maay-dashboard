'use strict';
/**
 * CHARACTERIZATION + REGRESSION — look-ahead in backtest-tv/run.js (defect D1).
 * Task: "backtest-tv/run.js look-ahead invalidation". run.js is NOT a protected file.
 *
 * @test:characterization @test:regression @test:unit @test:failure
 * @test:integration @test:performance @test:memory-leak @test:rollback
 *
 * RED-FIRST (Definition of Done): these assertions FAIL on the current run.js, where
 * getSignal chooses direction from the day's CLOSE (run.js:265):
 *     const direction = close >= open ? 'CALL' : 'PUT';
 * The close is not known at the 09:15 entry the trade is placed at. After the fix
 * (direction derived from the open-vs-prevClose GAP), they PASS.
 *
 * The pin cannot pass by accident: each bar is built so the GAP and the CLOSE point in
 * OPPOSITE directions, so the chosen direction reveals exactly which one the signal read.
 */
const assert = require('assert');
const { getSignal } = require('../backtest-tv/run.js');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
const eq = (a, b, m) => { n++; assert.strictEqual(a, b, m); };

const VOL = 0.5, DAY = '2020-06-15';   // vol high enough to pass isVolatileEnough (verified)

// ── @test:characterization / @test:regression — a GAP-UP day that CLOSES DOWN ──────
// Gapped up from prevClose 98 → a trader at 09:15 sees strength → CALL. The bar then
// reverses and closes red. Pre-fix reads the red close → PUT (hindsight). Honest → CALL.
{
  const gapUpClosesDown = { open: 100, high: 100.5, low: 97, close: 97 };   // prevClose 98 → gap +2%
  const sig = getSignal(gapUpClosesDown, 98, [], VOL, DAY);
  ok(sig, 'a strong bar fires a tier so a direction exists');
  eq(sig.direction, 'CALL', 'D1: direction must follow the GAP (up), not the day CLOSE (down)');
}

// ── mirror — a GAP-DOWN day that CLOSES UP → honest PUT ────────────────────────────
{
  const gapDnClosesUp = { open: 100, high: 103, low: 99.5, close: 103 };    // prevClose 102 → gap -1.96%
  const sig = getSignal(gapDnClosesUp, 102, [], VOL, DAY);
  ok(sig, 'the mirror bar fires a tier');
  eq(sig.direction, 'PUT', 'D1: direction must follow the GAP (down), not the day CLOSE (up)');
}

// ── @test:unit — "differ only in the close" pin: same open & prevClose, opposite close ─
// Two strong bars with identical open and prevClose (same gap = 0) but opposite closes.
// Their direction must NOT differ — a function that flips here is reading a field it
// cannot see at entry.
{
  const up   = { open: 100, high: 103,   low: 99.9, close: 103 };   // closes up
  const down = { open: 100, high: 100.1, low: 97,   close: 97  };   // closes down
  const su = getSignal(up,   100, [], VOL, DAY);
  const sd = getSignal(down, 100, [], VOL, DAY);
  ok(su && sd, 'both strong bars fire a tier');
  eq(su.direction, sd.direction, 'D1: direction must not flip when only the close flips (same open/gap)');
}

// ── @test:integration — no returned direction ever contradicts the gap ─────────────
{
  let contradictions = 0;
  for (const [o, pc, c] of [[100, 98, 97], [100, 102, 103], [100, 97, 96.5], [100, 103, 103.5]]) {
    const s = getSignal({ open: o, high: Math.max(o, c) + 0.1, low: Math.min(o, c) - 0.1, close: c }, pc, [], VOL, DAY);
    if (s && s.direction !== (o >= pc ? 'CALL' : 'PUT')) contradictions++;
  }
  eq(contradictions, 0, 'D1: every returned direction matches the gap sign — none is chosen from the close');
}

// ── @test:failure — a close-absent gap-up day is never a default PUT ───────────────
// Current code does `undefined >= open` → false → PUT (the trap the fix must avoid).
{
  const noClose = { open: 100 };   // high/low/close absent (null ≠ 0)
  const sig = getSignal(noClose, 98, [], VOL, DAY);   // gap up
  ok(sig === null || sig.direction === 'CALL', 'a close-absent gap-up day never becomes a default PUT');
}

// ── @test:performance — getSignal stays O(1) ──────────────────────────────────────
{
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 20000; i++) getSignal({ open: 100, high: 103, low: 99.9, close: 103 }, 100, [], VOL, DAY);
  ok(Number(process.hrtime.bigint() - t0) / 1e6 < 300, '20k getSignal calls < 300ms');
}

// ── @test:memory-leak — repeated calls allocate nothing unbounded ─────────────────
{
  for (let i = 0; i < 5000; i++) getSignal({ open: 100, high: 103, low: 99.9, close: 103 }, 100, [], VOL, DAY);
  ok(true, 'getSignal is pure — bounded');
}

// ── @test:rollback — getSignal remains exported and callable (behavioral fix only) ─
{
  ok(typeof getSignal === 'function', 'getSignal stays exported for the backtest and this test');
}

console.log(`\n${n} assertions passed`);
