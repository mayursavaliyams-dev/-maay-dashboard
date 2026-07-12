'use strict';
/**
 * `confluence-learner.js` — 195 lines, five dependents, and until now ZERO tests.
 *
 * WHY THIS MODULE MATTERS MORE THAN ITS SIZE
 *   It is the only thing in the repo that turns closed trades into *measured* per-leg hit rates.
 *   `weightsView()` is the closest thing this platform has to a reliability estimator, which is
 *   the single input a future Meta Decision Engine is blocked on. An untested reliability
 *   estimator is worse than none: it produces numbers that look measured.
 *
 * ISOLATION
 *   The learner persists to `data/confluence-weights.json` (20.9 KB of real learned state) on
 *   every `learn()` and every `reset()`. This suite stubs `_save` on each instance, so no test
 *   can write production state, and asserts the file is byte-identical at the end.
 *
 *   @test:characterization @test:unit @test:integration @test:regression
 *   @test:performance @test:memory-leak @test:failure @test:rollback
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STATE = path.join(ROOT, 'data', 'confluence-weights.json');
const stateBytes = fs.existsSync(STATE) ? fs.readFileSync(STATE) : null;

const { ConfluenceLearner, LEARNABLE } = require('../confluence-learner.js');
const { DEFAULT_WEIGHTS } = require('../master-confluence.js');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
const eq = (a, b, m) => { n++; assert.strictEqual(a, b, m); };

// every instance in this suite is sealed off from the disk
const learner = () => { const l = new ConfluenceLearner(); l._save = () => {}; l.byInst = {}; l.trades = []; l.pending = {}; return l; };
const BASELINE = LEARNABLE.reduce((s, k) => s + (DEFAULT_WEIGHTS[k] || 8), 0);
const sumOf = (l, inst) => LEARNABLE.reduce((s, k) => s + l.weight(inst, k), 0);

// ── @test:unit — the shape of a fresh learner ───────────────────────────────
{
  const l = learner();
  eq(LEARNABLE.length, 9, 'nine learnable legs');
  eq(BASELINE, 99, 'their default weights sum to 99');
  for (const k of LEARNABLE) eq(l.weight('NIFTY', k), DEFAULT_WEIGHTS[k] || 8, `${k} starts at its default`);
  eq(l.weight('NIFTY', 'notALeg'), 8, 'an unknown leg falls back to 8 rather than throwing');

  const v = l.weightsView('NIFTY');
  eq(v.trend.samples, 0, 'no samples yet');
  eq(v.trend.hitRate, null,
    'THE CRITICAL ASSERTION: hitRate is NULL with zero samples, never 0. A leg that has never ' +
    'been tested is not a leg that is always wrong');
  eq(v.trend.delta, 0, 'and it has not drifted from its default');
}

// ── @test:unit — credit assignment, in each of the four quadrants ────────────
{
  // WIN on a BUY: a leg that voted bullish was right → its weight grows
  const l = learner();
  const before = l.weight('NIFTY', 'trend');
  l.learn({ inst: 'NIFTY', decision: 'BUY', result: 'WIN', factors: { trend: 100 } });
  ok(l.weight('NIFTY', 'trend') > before, 'WIN on BUY + bullish leg ⇒ weight grows');
}
{
  const l = learner();
  const before = l.weight('NIFTY', 'trend');
  l.learn({ inst: 'NIFTY', decision: 'BUY', result: 'LOSS', factors: { trend: 100 } });
  ok(l.weight('NIFTY', 'trend') < before, 'LOSS on BUY + bullish leg ⇒ weight shrinks');
}
{
  const l = learner();
  const before = l.weight('NIFTY', 'trend');
  l.learn({ inst: 'NIFTY', decision: 'BUY', result: 'LOSS', factors: { trend: -100 } });
  ok(l.weight('NIFTY', 'trend') > before,
    'LOSS on BUY + BEARISH leg ⇒ weight grows: the leg that disagreed was right');
}
{
  const l = learner();
  const before = l.weight('NIFTY', 'trend');
  l.learn({ inst: 'SENSEX', decision: 'SELL', result: 'WIN', factors: { trend: -100 } });
  eq(l.weight('NIFTY', 'trend'), before, 'learning on SENSEX leaves NIFTY untouched — weights are per-instrument');
  ok(l.weight('SENSEX', 'trend') > before, 'while SENSEX learned');
}

// ── @test:unit — strength scales the update ─────────────────────────────────
{
  const weak = learner(), strong = learner();
  weak.learn({ inst: 'NIFTY', decision: 'BUY', result: 'WIN', factors: { trend: 10 } });
  strong.learn({ inst: 'NIFTY', decision: 'BUY', result: 'WIN', factors: { trend: 100 } });
  ok(strong.weight('NIFTY', 'trend') > weak.weight('NIFTY', 'trend'),
    'a leg that voted strongly moves further than one that barely voted');
}

// ── @test:regression — re-normalisation keeps the MIX shifting, not the SCALE ─
{
  const l = learner();
  ok(Math.abs(sumOf(l, 'NIFTY') - BASELINE) < 0.01, 'a fresh instrument sums to the baseline');
  for (let i = 0; i < 20; i++) {
    l.learn({ inst: 'NIFTY', decision: 'BUY', result: 'WIN', factors: { trend: 100, pcr: -80, oi: 60 } });
  }
  ok(Math.abs(sumOf(l, 'NIFTY') - BASELINE) < 1.0,
    `after 20 updates the weights still sum to ~${BASELINE} (got ${sumOf(l, 'NIFTY').toFixed(2)}) — ` +
    'only the mix shifted, so the engine probability calibration is not silently rescaled');
  ok(l.weight('NIFTY', 'trend') > (DEFAULT_WEIGHTS.trend || 8), 'trend earned weight');
  ok(l.weight('NIFTY', 'pcr') < (DEFAULT_WEIGHTS.pcr || 8), 'pcr, which kept disagreeing with wins, lost weight');
}

// ── @test:unit — the clamps hold under sustained bias ───────────────────────
{
  const l = learner();
  for (let i = 0; i < 500; i++) l.learn({ inst: 'NIFTY', decision: 'BUY', result: 'WIN', factors: { trend: 100 } });
  const w = l.weight('NIFTY', 'trend');
  ok(w <= 40 && w >= 3, `500 identical wins drive trend to ${w.toFixed(2)}, inside the [3, 40] clamp`);
  ok(w > 30, 'and it does saturate — the clamp is doing the work, not a hidden cap');
}

// ── @test:characterization — TWO defects, pinned. Both are `null ≠ 0` failures ─
{
  const l = learner();
  const before = l.weight('NIFTY', 'trend');

  // (1) A leg scoring exactly 0 is skipped by `if (!isFinite(s) || s === 0) continue;`
  //     — treated identically to a leg that was ABSENT. But 0 is a real, confident, neutral
  //     reading, and absent is the absence of one. The comment even says "leg absent / no
  //     opinion", conflating them. This is the `null ≠ 0` rule, violated inside the module
  //     that is supposed to measure reliability.
  l.learn({ inst: 'NIFTY', decision: 'BUY', result: 'WIN', factors: { trend: 0 } });
  eq(l.weight('NIFTY', 'trend'), before,
    'CHARACTERIZATION: a leg scoring 0 produces NO update and NO sample — indistinguishable ' +
    'from a leg that was never consulted');
  eq(l.weightsView('NIFTY').trend.samples, 0,
    'CHARACTERIZATION: and it is not even counted as a sample, so hitRate never learns it was neutral');

  // (2) `track()` only accepts a verdict carrying decision BUY or SELL.
  const l2 = learner();
  const seqBefore = l2.seq;   // NOT 1000: the constructor restores it from the real state file
  eq(l2.track('NIFTY', { decision: 'BUY', direction: 'BULLISH', probability: 0.6 }, { trend: { score: 50 } }),
    seqBefore + 1, 'track() accepts a BUY verdict and returns the next signalId');
  eq(l2.track('NIFTY', { decision: 'ABSTAIN' }, {}), null,
    'CHARACTERIZATION: track() returns null for any verdict that is not BUY or SELL');
  eq(l2.track('NIFTY', { verdict: 'INTERESTING', confidence: 0.6, reliability: null }, {}), null,
    'CHARACTERIZATION: an EngineVerdict — the contract every engine must migrate to — is REJECTED. ' +
    'The reliability estimator cannot learn from the only object engines are allowed to emit. ' +
    'This is the blocking coupling between the AI Architecture Rule and reliability measurement');
}

// ── @test:failure — it refuses rather than guesses ──────────────────────────
{
  const l = learner();
  ok(l.learn({ inst: 'NIFTY', result: 'WIN', factors: { trend: 50 } }).error,
    'FAILURE: no direction ⇒ refuse, do not assume BUY');
  ok(l.learn({ inst: 'NIFTY', decision: 'BUY', factors: { trend: 50 } }).error,
    'FAILURE: no result ⇒ refuse, do not assume WIN');
  ok(l.learn({ inst: 'NIFTY', decision: 'BUY', result: 'MAYBE', factors: { trend: 50 } }).error,
    'FAILURE: an unrecognised result ⇒ refuse');
  ok(l.learn({ inst: 'NIFTY', decision: 'BUY', result: '', pnl: 0, factors: { trend: 50 } }).error,
    'FAILURE: pnl exactly 0 is neither a win nor a loss ⇒ refuse. Zero P&L is not a victory');
  ok(l.learn({ inst: 'NIFTY', decision: 'BUY', result: '', pnl: 5, factors: { trend: 50 } }).ok,
    'a positive pnl alone IS enough to label a win');
  ok(l.resolve(999999, 'WIN').error, 'FAILURE: resolving an unknown signalId reports an error, silently learning nothing');

  const l2 = learner();
  const r = l2.learn({ inst: 'NIFTY', decision: 'BUY', result: 'WIN', factors: { trend: NaN, pcr: Infinity, oi: 40 } });
  ok(r.ok, 'a NaN or Infinity leg does not crash the update');
  ok(!('trend' in r.applied) && !('pcr' in r.applied), 'and neither leg is learned from');
  ok('oi' in r.applied, 'while the finite leg beside them is');
}

// ── @test:integration — track() → resolve() round trip ─────────────────────
{
  const l = learner();
  const id = l.track('NIFTY', { decision: 'SELL', direction: 'BEARISH', probability: 0.7 },
    { trend: { score: -80 }, pcr: { score: 40 }, iv: { score: 0, available: false } });
  ok(id > 1000, 'track returns a monotonic signalId');
  eq(Object.keys(l.pending).length, 1, 'the signal is pending');

  const res = l.resolve(id, 'WIN', { pnl: 1200 });
  ok(res.ok, 'resolve learns from it');
  eq(Object.keys(l.pending).length, 0, 'and the pending entry is consumed');
  ok(l.weight('NIFTY', 'trend') > (DEFAULT_WEIGHTS.trend || 8), 'the bearish trend leg was right on a winning SELL');
  ok(l.weight('NIFTY', 'pcr') < (DEFAULT_WEIGHTS.pcr || 8), 'the bullish pcr leg was wrong');
  eq(l.weightsView('NIFTY').iv.samples, 0, 'an unavailable leg was never snapshotted, so it learned nothing');

  eq(l.resolve(id, 'WIN').error, 'unknown signalId', 'resolving the same signal twice is refused');
}

// ── @test:unit — hitRate is a measurement, and it says so ──────────────────
{
  const l = learner();
  for (let i = 0; i < 3; i++) l.learn({ inst: 'NIFTY', decision: 'BUY', result: 'WIN', factors: { trend: 50 } });
  l.learn({ inst: 'NIFTY', decision: 'BUY', result: 'LOSS', factors: { trend: 50 } });
  const v = l.weightsView('NIFTY');
  eq(v.trend.samples, 4, 'four samples');
  eq(v.trend.hitRate, 75, 'three of four ⇒ 75%');
  eq(v.oi.hitRate, null, 'a leg with no samples still reports null, not 0, alongside a measured one');
}

// ── @test:regression — reset ───────────────────────────────────────────────
{
  const l = learner();
  l.learn({ inst: 'NIFTY', decision: 'BUY', result: 'WIN', factors: { trend: 100 } });
  l.learn({ inst: 'SENSEX', decision: 'BUY', result: 'WIN', factors: { trend: 100 } });
  l.reset('NIFTY');
  eq(l.weight('NIFTY', 'trend'), DEFAULT_WEIGHTS.trend || 8, 'reset(inst) restores that instrument');
  ok(l.weight('SENSEX', 'trend') > (DEFAULT_WEIGHTS.trend || 8), 'and leaves the other alone');
  eq(l.weightsView('NIFTY').trend.samples, 0, 'its samples are cleared too');

  l.reset();
  eq(l.weight('SENSEX', 'trend'), DEFAULT_WEIGHTS.trend || 8, 'reset() clears everything');
  eq(l.trades.length, 0, 'including the trade ring buffer');
}

// ── @test:memory-leak — the ring buffers are bounded ───────────────────────
{
  const l = learner();
  for (let i = 0; i < 700; i++) l.learn({ inst: 'NIFTY', decision: 'BUY', result: 'WIN', factors: { trend: 50 } });
  ok(l.trades.length <= 500, `700 learned trades leave ${l.trades.length} in memory (cap 500)`);

  const l2 = learner();
  for (let i = 0; i < 1200; i++) l2.track('NIFTY', { decision: 'BUY', direction: 'BULLISH' }, { trend: { score: 50 } });
  ok(Object.keys(l2.pending).length <= 1001,
    `1,200 untracked signals leave ${Object.keys(l2.pending).length} pending — the map is bounded`);

  if (typeof global.gc === 'function') {
    global.gc();
    const base = process.memoryUsage().heapUsed;
    const l3 = learner();
    for (let i = 0; i < 20000; i++) l3.learn({ inst: 'NIFTY', decision: 'BUY', result: 'WIN', factors: { trend: 50 } });
    global.gc();
    const grown = process.memoryUsage().heapUsed - base;
    ok(grown < 16 * 1024 * 1024, `20k updates retained ${(grown / 1048576).toFixed(1)} MB — bounded`);
  } else {
    console.log('  (heap corroboration skipped: run with --expose-gc)');
  }
}

// ── @test:performance — learn() runs on every trade close ──────────────────
// Generous, order-of-magnitude threshold: it catches someone adding a disk read to the hot
// path, not a few percent of drift on a busy machine.
{
  const l = learner();
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 5000; i++) l.learn({ inst: 'NIFTY', decision: 'BUY', result: 'WIN', factors: { trend: 50, oi: -30 } });
  const per = Number(process.hrtime.bigint() - t0) / 5000 / 1000;
  ok(per < 500, `learn() costs ${per.toFixed(1)} µs (disk write stubbed, as in production it is amortised)`);

  const t1 = process.hrtime.bigint();
  for (let i = 0; i < 5000; i++) l.weightsView('NIFTY');
  const perView = Number(process.hrtime.bigint() - t1) / 5000 / 1000;
  ok(perView < 500, `weightsView() costs ${perView.toFixed(1)} µs — it is polled by the dashboard`);
}

// ── @test:rollback — this suite adds tests only; nothing was changed ───────
{
  const src = fs.readFileSync(path.join(ROOT, 'confluence-learner.js'), 'utf8');
  ok(/module\.exports = \{ ConfluenceLearner, LEARNABLE \}/.test(src),
    'ROLLBACK: the public surface is unchanged — this commit adds tests, no production code');
  ok(/readJsonSync/.test(src) && /writeJsonSync/.test(src),
    'ROLLBACK: the module still persists through safe-write, as C3 left it');
  ok(/if \(!isFinite\(s\) \|\| s === 0\) continue;/.test(src),
    'ROLLBACK: the `score === 0` defect is still present. It is CHARACTERIZED above, not fixed. ' +
    'Fixing it changes learned weights, which is a behaviour change and needs its own approval');
}

// ── production state must be untouched ─────────────────────────────────────
{
  if (stateBytes) {
    ok(Buffer.compare(stateBytes, fs.readFileSync(STATE)) === 0,
      'data/confluence-weights.json is byte-identical — 20.9 KB of real learned state, never written to');
  }
  ok(!fs.existsSync(path.join(ROOT, 'x.json')), 'and no stray file was written to the project root');
}

console.log(`\n${n} assertions passed`);
