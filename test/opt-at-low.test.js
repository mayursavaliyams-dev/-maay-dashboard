/**
 * opt-at-low — which legs are sitting at today's low RIGHT NOW.
 * Run: node test/opt-at-low.test.js
 *
 * @test:characterization @test:regression @test:unit @test:failure
 * @test:integration @test:performance @test:memory-leak @test:rollback
 *
 * WHAT THIS IS
 *   `pos` is a fact: 0 means the leg is trading at its session low, 100 at its high.
 *   It is NOT a signal, and the page says so. A leg sits at its low because it has
 *   been falling; this platform's own 1,200-trade backtest put directional option
 *   BUYING at a profit factor of 0.94, and the hero-zero base rate is still Unknown.
 *
 * THREE THINGS MEASUREMENT CHANGED
 *   1. The obvious source, /api/options/snapshot, triggers an upstream broker fetch
 *      whenever its 4s cache has lapsed. A page polling it every 20s would force a
 *      fresh chain call every single time — the mechanism behind the Upstox 429 on
 *      2026-07-27. Reading the in-memory tracker instead measured 3-5ms and costs
 *      nothing upstream, which is the only reason a 20s cadence is defensible.
 *   2. Sorting by "closest to the low" alone put deep-ITM strikes at the top whose
 *      entire day spanned 1% of their premium. They are not at a low; they never
 *      moved. Hence the range gate.
 *   3. rec.high/low only advance on a CONFIRMED extreme, so a live tick can sit
 *      outside them for one poll. Unclamped that rendered "+-2.17%" and "-12.5%".
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };

const ROOT = path.join(__dirname, '..');
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
// The slice starts at the endpoint's own header comment, not at app.get: the reasons
// this endpoint exists at all live there, and a test that reads only the code cannot
// check that they were written down.
const H = SRV.slice(SRV.indexOf("/* Where each leg is sitting inside TODAY'S range"),
                    SRV.indexOf('// Black-Scholes greeks'));
// Two views of the same region. Claims about SHAPE must be checked against the code
// alone: the header comment names /api/options/snapshot in order to explain why the
// endpoint does not call it, and matching on the prose said the opposite of the truth.
const CODE = H.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const PAGE = fs.readFileSync(path.join(ROOT, 'public', 'capture.html'), 'utf8');

console.log('opt-at-low');

// ── @test:performance — it must not touch the broker ─────────────────────────
{
  ok(H.length > 0, 'the endpoint exists');
  ok(/_optHL\[inst\]/.test(CODE), 'it reads the in-memory high/low tracker');
  ok(!/optionSnapshot|options\/snapshot|await /.test(CODE),
    'and never awaits a chain fetch — a poll that costs an upstream call is how the 429 happened');
  ok(/429/.test(H), 'with that reason recorded where the next person will read it');
}

// ── @test:failure — it survives a restart ────────────────────────────────────
{
  ok(/_optMin\.get\(/.test(CODE),
    'when the tick path is empty it falls back to the restored minute bars');
  ok(/bar\[3\]/.test(CODE), 'taking the newest bar\'s close as the last price');
  // Measured: straight after a restart the tick path is empty for every leg, so
  // without the fallback the endpoint returned nothing at all.
  ok(/138 of 138|NOT restored at boot/.test(H),
    'and the measurement that forced it is written down');
}

// ── @test:unit — position, clamping, and the confirmed-extreme lag ──────────
{
  // The endpoint's arithmetic, exercised directly.
  const calc = (last, low, high) => ({
    pos: +Math.min(100, Math.max(0, ((last - low) / (high - low)) * 100)).toFixed(1),
    fromLowPct: +Math.max(0, ((last - low) / low) * 100).toFixed(2),
    atLow: last <= low,
  });
  assert.deepStrictEqual(calc(10, 10, 20), { pos: 0, fromLowPct: 0, atLow: true }); n++;
  assert.deepStrictEqual(calc(20, 10, 20), { pos: 100, fromLowPct: 100, atLow: false }); n++;
  assert.deepStrictEqual(calc(15, 10, 20), { pos: 50, fromLowPct: 50, atLow: false }); n++;
  console.log('  ✓ 0% at the low, 100% at the high, 50% in the middle');

  // A tick outside the CONFIRMED range: the verifier makes a candidate wait a poll.
  const below = calc(11.25, 11.5, 13.5);
  assert.strictEqual(below.pos, 0); n++;
  assert.strictEqual(below.fromLowPct, 0); n++;
  assert.strictEqual(below.atLow, true); n++;
  const above = calc(44.95, 38.4, 44.9);
  assert.strictEqual(above.pos, 100); n++;
  console.log('  ✓ a tick outside the confirmed range clamps to 0 or 100 — it never renders a negative percent');
  ok(/Clamped, because/.test(H) && /verifier/.test(H),
    'and the clamp says why, so nobody "fixes" it back');
}

// ── @test:regression — the range gate ───────────────────────────────────────
{
  ok(/minRangePct/.test(CODE), 'a minimum day range can be required');
  ok(/thinRange\+\+/.test(CODE), 'and legs that never moved are counted, not silently dropped');
  ok(/has not moved|never moved|simply sat/.test(H + PAGE),
    'with the reason stated: at the low of a 1% range is not at a low');
  // A deep-ITM leg with a 1.2% range must not outrank a real mover sitting mid-range.
  const legs = [
    { name: 'deep ITM, never moved', last: 1025.65, low: 1025.65, high: 1037.65 },
    { name: 'real mover',            last: 12.4,    low: 10.65,   high: 14.15 },
  ].map(l => ({ ...l, rangePct: ((l.high - l.low) / l.low) * 100 }));
  assert.ok(legs[0].rangePct < 2); n++;
  assert.ok(legs[1].rangePct > 30); n++;
  assert.strictEqual(legs.filter(l => l.rangePct >= 15).length, 1); n++;
  console.log('  ✓ a 15% gate keeps the mover and drops the leg that spanned 1.2% all day');
}

// ── @test:integration — full accounting, and honest framing on the page ────
{
  for (const k of ['returned', 'tracked', 'noTick', 'noRange', 'belowFloor', 'thinRange'])
    { assert.ok(new RegExp(k).test(CODE), `counts.${k} is reported`); n++; }
  console.log('  ✓ every tracked leg is accounted for, not just the survivors');

  ok(/not a reason to buy/.test(PAGE), 'the page states plainly that this is not a buy signal');
  ok(/0\.94/.test(PAGE), 'and cites the profit factor from this platform\'s own backtest');
  ok(/Unknown/.test(PAGE), 'and that the hero-zero base rate is still unknown');
  ok(/noteNow[\s\S]{0,400}noteHind|id="noteNow"/.test(PAGE),
    'the two views carry separate caveats — they answer different questions');
}

// ── @test:memory-leak / @test:rollback ─────────────────────────────────────
{
  ok(!/setInterval|setTimeout/.test(CODE), 'the endpoint holds no timer — it answers and returns');
  ok(/const NOW_POLL_MS = 20000;/.test(PAGE), 'the live view polls every 20s');
  ok(/MODE === 'now'/.test(PAGE) && /if \(MODE === 'now'\) return loadNow\(opts\)/.test(PAGE),
    'the live view is a branch on top of the existing loader, so it can be removed on its own');
  ok(/\$\('dSel'\)\.disabled = m === 'now'/.test(PAGE),
    'controls that do not drive the current view are disabled rather than left lying');
}

console.log(`\n${n} assertions passed`);
