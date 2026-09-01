/* calibration.test.js
 *
 * The property under test is not "does it compute a percentage". It is that the
 * three answers stay apart: PASS, BLOCKED and UNEVALUABLE each mean something
 * different, and collapsing any two of them is the defect.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const C = require('../calibration.js');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
const eq = (a, b, m) => { n++; assert.strictEqual(a, b, m); };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'calib-'));

/** k records at probability p, of which `wins` resolved true. */
const rec = (p, k, wins) =>
  Array.from({ length: k }, (_, i) => ({ predicted: p, outcome: i < wins }));

// ── @test:unit — a bin too thin to judge refuses to report a rate ──────────────
{
  const r = C.calibrate(rec(0.65, 3, 3), C.GATE);
  const bin = r.bins.find(b => b.lo === 0.6);
  eq(bin.n, 3, 'the bin still counts what it holds');
  eq(bin.evaluable, false, 'three samples cannot support a reliability claim');
  eq(bin.observed, null, 'and so it reports no observed rate at all');
  ok(bin.observed !== 1, '100% off three samples is exactly the number that gets believed wrongly');
}

// ── @test:unit — thin evidence is UNEVALUABLE, never BLOCKED ──────────────────
{
  const r = C.calibrate(rec(0.65, 30, 5), C.GATE);
  eq(r.verdict, 'UNEVALUABLE',
     '30 outcomes cannot convict the model — that verdict has not been earned');
  eq(r.n, 30, 'but the count is still reported');
  ok(r.brier !== null, 'and Brier is still computed, because it is evidence either way');
  ok(/needs 200/.test(r.reason), 'the reason names the threshold it fell short of');
}

// ── @test:unit — unreadable evidence is UNEVALUABLE with n = null, not 0 ──────
{
  const r = C.calibrate(null, C.GATE);
  eq(r.verdict, 'UNEVALUABLE', 'evidence that cannot be read is not evidence of nothing');
  eq(r.n, null, 'n is null, never 0 — 0 would read as "we looked and found none"');
}

// ── @test:unit — a wide, honest model passes ─────────────────────────────────
{
  const records = [
    ...rec(0.30, 70, 21),   // 30.0% promised, 30.0% delivered
    ...rec(0.50, 70, 35),   // 50.0% / 50.0%
    ...rec(0.70, 70, 49),   // 70.0% / 70.0%
  ];
  const r = C.calibrate(records, C.GATE);
  eq(r.verdict, 'PASS', '210 outcomes across three honest bins clears the gate');
  eq(r.n, 210, 'every record counted');
  ok(r.brier < 0.25, 'a calibrated model beats a coin flip');
}

// ── @test:unit — enough evidence and a dishonest bin is BLOCKED ──────────────
{
  const records = [
    ...rec(0.30, 70, 21),
    ...rec(0.50, 70, 35),
    ...rec(0.70, 70, 14),   // promises 70%, delivers 20%
  ];
  const r = C.calibrate(records, C.GATE);
  eq(r.verdict, 'BLOCKED', 'measured, and the numbers do not clear the gate');
  ok(/70/.test(r.reason) && /20/.test(r.reason),
     'the reason names the promise and the delivery, so it can be argued with');
}

// ── @test:unit — a model that predicts one number cannot be called calibrated ─
{
  const r = C.calibrate(rec(0.70, 250, 175), C.GATE);
  eq(r.verdict, 'UNEVALUABLE',
     '250 outcomes in a single bin is a lot of evidence about one point, not a calibrated curve');
  ok(/spread/.test(r.reason), 'and the reason says why, rather than implying the model is wrong');
}

// ── @test:integration — a missing file does not throw and does not pass ──────
{
  const r = C.calibrateFile(path.join(TMP, 'nope.json'),
    { predictedOf: x => x.probability, outcomeOf: x => x.pnl > 0 });
  eq(r.verdict, 'UNEVALUABLE', 'an absent ledger is unevaluable');
  eq(r.n, null, 'with no count invented for it');
}

// ── @test:integration — unresolved rows are not counted as losses ────────────
{
  const f = path.join(TMP, 'led.json');
  fs.writeFileSync(f, JSON.stringify([
    { probability: 70, pnl: 100, exitAt: 1 },
    { probability: 70, pnl: -50, exitAt: 1 },
    { probability: 70 },                        // still open — no outcome yet
    { probability: null, pnl: 10, exitAt: 1 },  // no prediction — not evidence
  ]));
  const r = C.calibrateFile(f, {
    predictedOf: x => x.probability,
    outcomeOf: x => (x.exitAt != null && Number.isFinite(Number(x.pnl))) ? Number(x.pnl) > 0 : null,
  });
  eq(r.n, 2, 'only rows carrying BOTH a prediction and a resolution are evidence');
  ok(r.verdict === 'UNEVALUABLE', 'two outcomes decide nothing');
}

/* ── @test:characterization — the live ledger, as it actually stands ───────────
 *
 * Measured 2026-09-01: 120 resolved outcomes, predicted ~68%, observed 42.5%,
 * Brier 0.2969 — worse than a coin flip. This asserts the SHAPE of that answer,
 * not the numbers, so collecting more outcomes does not break the suite. When n
 * crosses 200 this test starts exercising the PASS/BLOCKED path for real. */
{
  const led = path.join(__dirname, '..', 'data', 'ai-agents-trades.json');
  if (fs.existsSync(led)) {
    const r = C.calibrateFile(led, {
      predictedOf: x => x.probability,
      outcomeOf: x => (x.exitAt != null && Number.isFinite(Number(x.pnl))) ? Number(x.pnl) > 0 : null,
    });
    ok(['PASS', 'BLOCKED', 'UNEVALUABLE'].includes(r.verdict), 'the live ledger yields one of the three verdicts');
    ok(r.n === null || r.n >= 0, 'n is a count or null, never NaN');
    ok(r.verdict !== 'PASS' || r.n >= C.GATE.minOutcomes,
       'PASS is impossible below the minimum — the gate cannot be cleared by a small sample');
  }
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
console.log(`\n${n} assertions passed`);
