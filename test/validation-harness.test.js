/**
 * validation-harness — the adversarial gate, and proof that it says NO.
 * Run: node test/validation-harness.test.js
 *
 * @test:unit @test:characterization @test:regression @test:failure
 * @test:integration @test:boundary @test:security @test:rollback
 *
 * A validation harness that cannot be shown to reject things is decoration. Most
 * of what follows constructs a strategy that ought to fail and confirms it does.
 *
 * THE THREE-VALUED VERDICT IS THE HEART OF IT
 *
 *   PASS · FAIL · CANNOT_VALIDATE
 *
 * CANNOT_VALIDATE is not a pass, and the tests below hold that line in every
 * place it could erode. It matters here more than anywhere else in this system,
 * because the evidence most often missing — the trial count — is missing
 * precisely for the strategies with the most impressive backtests.
 *
 * MEASURED ON THIS REPOSITORY, 2026-07-30: 17 backtest scripts, 15 result files,
 * and **no trial count recorded anywhere**. Requirement 3 asks for a counter
 * including the variants that were DISCARDED, and a discarded run leaves no
 * artefact at all.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };
const ROOT = path.join(__dirname, '..');

const S = require(path.join(ROOT, 'validation-stats.js'));
const W = require(path.join(ROOT, 'walk-forward.js'));
const { ValidationLedger } = require(path.join(ROOT, 'validation-ledger.js'));
const { ValidationHarness, DEFAULT_CRITERIA } = require(path.join(ROOT, 'validation-harness.js'));

const quiet = { warn() {}, error() {}, log() {} };
const tmpLedger = () => {
  const d = path.join(os.tmpdir(), `vl-${process.pid}-${Math.floor(Math.random() * 1e9)}`);
  fs.mkdirSync(d, { recursive: true });
  return new ValidationLedger({ log: quiet, files: { trials: path.join(d, 't.json'), budget: path.join(d, 'b.json'), runs: path.join(d, 'r.json') } });
};

/* A deterministic pseudo-random stream, so every number below is reproducible. */
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function gauss(r) { return Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()); }

console.log('\nvalidation harness\n');

/* ── 1. deflated Sharpe refuses an unknown trial count ───────────────────── */
console.log('deflated Sharpe');
{
  const d = S.deflatedSharpe({ observedSharpe: 2.5, trials: null, n: 500 });
  ok(!d.ok, 'a null trial count is REFUSED');
  ok(/wearing a serious name/.test(d.why),
    '  …because computing it as though one variant had been tried presents the original number as though it had been checked');
}
{
  const one = S.deflatedSharpe({ observedSharpe: 1.8, trials: 1, n: 500 });
  const many = S.deflatedSharpe({ observedSharpe: 1.8, trials: 200, n: 500 });
  ok(one.ok && many.ok, 'both compute');
  ok(many.deflatedSharpeProbability < one.deflatedSharpeProbability,
    `the SAME Sharpe deflates further with more trials (${one.deflatedSharpeProbability} → ${many.deflatedSharpeProbability} at 200 trials)`);
  ok(many.verdict === 'FAILS', 'and a Sharpe of 1.8 chosen from 200 variants FAILS deflation');
  ok(/200 coin flips/.test(many.plainly), '  …and says so in words, not only as a number');
  ok(/PROBABILITY/.test(many.units),
    'the output states its units — a probability read as a Sharpe is a serious misreading in the flattering direction');
}
{
  const d = S.deflatedSharpe({ observedSharpe: 4.0, trials: 3, n: 800 });
  ok(d.ok && d.verdict === 'SURVIVES', 'a genuinely strong Sharpe from few trials survives — the test is not merely a rejector');
}

/* ── 2. Sharpe itself refuses degenerate input ───────────────────────────── */
console.log('\nSharpe');
{
  ok(!S.sharpe([1, 1, 1, 1]).ok, 'a zero-variance series has NO Sharpe');
  ok(/not infinite/.test(S.sharpe([1, 1, 1, 1]).why), '  …and it is refused rather than reported as infinity or zero');
  ok(!S.sharpe([0.01]).ok, 'a single observation is refused');
}

/* ── 3. PBO ─────────────────────────────────────────────────────────────── */
console.log('\nprobability of backtest overfitting');
{
  const r = rng(7);
  // Pure noise: no trial has any real edge, so the in-sample best should land
  // below the out-of-sample median about half the time.
  const noise = Array.from({ length: 12 }, () => Array.from({ length: 8 }, () => gauss(r)));
  const p = S.pbo(noise);
  ok(p.ok && p.pbo >= 0.3, `noise with no edge gives PBO ${p.pbo} — the selection carries little information`);
  ok(p.verdict !== 'ACCEPTABLE', 'and it is not reported as acceptable');
}
{
  // One trial with a genuine edge on every block.
  const r = rng(11);
  const M = Array.from({ length: 8 }, (_, i) => Array.from({ length: 8 }, () => gauss(r) + (i === 0 ? 3 : 0)));
  const p = S.pbo(M);
  ok(p.ok && p.pbo <= 0.2, `a real edge gives PBO ${p.pbo} — the in-sample best stays best out of sample`);
}
ok(!S.pbo([[1, 2, 3]]).ok, 'a single trial cannot produce a PBO');
ok(!S.pbo([[1, 2, 3], [1, 2, 3]]).ok, 'and an odd number of blocks is refused rather than silently truncated');

/* ── 4. the null tests ──────────────────────────────────────────────────── */
console.log('\nnull tests');
{
  const r = rng(3);
  const res = S.randomEntryNull({ strategyMetric: 0.2, sampler: () => gauss(r) * 1.0, runs: 500 });
  ok(res.ok && res.verdict === 'INSIDE',
    `a strategy at the ${res.percentile}th percentile of random entries has demonstrated nothing`);
  ok(/has not demonstrated anything/.test(res.plainly), '  …and the report says exactly that');
}
{
  const r = rng(5);
  const res = S.randomEntryNull({ strategyMetric: 6, sampler: () => gauss(r), runs: 500 });
  ok(res.ok && res.verdict === 'OUTSIDE', 'a strategy far outside the null distribution is marked OUTSIDE');
}
ok(!S.randomEntryNull({ strategyMetric: 1, sampler: null }).ok,
  'no sampler means no null — the harness will not assume a cost model the caller owns');
{
  const r = rng(9);
  const good = S.shuffledLabels({ realMetric: 0.72, shuffledRun: () => 0.5 + gauss(r) * 0.01, runs: 20, chanceLevel: 0.5 });
  ok(good.ok && good.collapsedToChance && !good.halt, 'shuffled labels collapsing to chance PASSES');

  const leak = S.shuffledLabels({ realMetric: 0.72, shuffledRun: () => 0.70, runs: 20, chanceLevel: 0.5 });
  ok(leak.ok && !leak.collapsedToChance, 'shuffled labels that still score well are LEAKAGE');
  ok(leak.halt === true, '  …and the harness HALTS rather than continuing');
  ok(/every other number/.test(leak.plainly) || /would be about the leak/.test(leak.plainly),
    '  …because every downstream number would be about the leak, not the strategy');
}

/* ── 5. walk-forward ────────────────────────────────────────────────────── */
console.log('\nwalk-forward');
{
  const f = W.buildFolds({ n: 1000, inSample: 200, outSample: 50 });
  ok(f.ok && f.count === 16, `${f.count} folds from 1,000 observations`);
  ok(f.folds.every(x => x.oosStart === x.isEnd), 'every out-of-sample window starts where its in-sample window ends');
  ok(f.folds.every((x, i) => i === 0 || x.oosStart >= f.folds[i - 1].oosEnd), 'and the out-of-sample windows do not overlap');
}
{
  const f = W.buildFolds({ n: 1000, inSample: 200, outSample: 50, step: 10 });
  ok(f.ok && f.oosOverlap === true && /OVERLAP/.test(f.warning),
    'overlapping out-of-sample windows are reported, because the concatenated result would reuse observations');
}
ok(!W.buildFolds({ n: 100, inSample: 200, outSample: 50 }).ok, 'windows larger than the data are refused');

console.log('\npurging and embargo');
{
  const train = Array.from({ length: 100 }, (_, i) => i);
  const pe = W.purgeAndEmbargo({ trainIdx: train, testStart: 50, testEnd: 60, labelHorizon: 5, featureLookback: 3 });
  ok(pe.ok && pe.purgedCount > 0, `${pe.purgedCount} samples purged around the test window`);
  ok(!pe.train.some(i => i >= 45 && i < 50),
    'training samples whose LABEL resolves inside the test window are removed');
  ok(!pe.train.some(i => i >= 60 && i < 68),
    'and the embargo band after the test window is removed too');
}
{
  const short = W.purgeAndEmbargo({ trainIdx: [1, 2], testStart: 10, testEnd: 20, labelHorizon: 5, featureLookback: 3, embargo: 2 });
  ok(!short.ok && /leaves a seam/.test(short.why),
    'an embargo shorter than lookback + horizon is REFUSED, not clamped — the seam is leakage no other test would catch');
}
{
  const bad = W.assertNoOverlap({ train: [55], testStart: 50, testEnd: 60 });
  ok(!bad.ok && bad.offenderCount === 1, 'a training index inside the test window FAILS the assertion');
  ok(/FAILS rather than warns/.test(bad.why), '  …and it fails the run rather than warning');
  const good = W.assertNoOverlap({ train: [1, 2, 3], testStart: 50, testEnd: 60, labelHorizon: 5, featureLookback: 3 });
  ok(good.ok, 'a clean split passes');
}
{
  /* A walk-forward run whose splits leak must FAIL the whole run. Driven with a
     deliberately too-short embargo. */
  const data = Array.from({ length: 300 }, (_, i) => i);
  const r = W.walkForward({
    data, inSample: 100, outSample: 20, labelHorizon: 10, featureLookback: 5, embargo: 1,
    optimise: () => ({ p: 1 }), evaluate: () => ({ returns: [0.01] }),
  });
  ok(!r.ok && /seam/.test(r.why), 'a walk-forward run with a too-short embargo fails outright');
}

console.log('\nthe headline is out-of-sample');
{
  const r0 = rng(21);
  const data = Array.from({ length: 600 }, () => gauss(r0));
  const res = W.walkForward({
    data, inSample: 150, outSample: 50,
    optimise: () => ({ lookback: 10 }),
    evaluate: (slice) => ({ returns: slice.map(x => x * 0.01), pnl: slice.reduce((a, b) => a + b, 0) }),
  });
  ok(res.ok && res.foldCount >= 4, `${res.foldCount} folds ran`);
  ok(/OUT-OF-SAMPLE/.test(res.headline.basis), 'the headline is the concatenated out-of-sample result');
  ok(res.diagnosticOnly && res.diagnosticOnly.note.includes('never the reported result'),
    'in-sample figures are kept but marked diagnostic only');
  ok(res.diagnosticOnly.inSampleMinusOutOfSample !== null,
    'and the in-sample-minus-out-of-sample GAP is reported — it is the overfitting measurement');
  ok(res.bestFold !== null && /never the result/.test(res.bestFoldWarning),
    'the best fold is identified for diagnosis and explicitly disclaimed as a result');
}

console.log('\nparameter stability is a finding');
{
  const jumpy = W.parameterStability([{ lookback: 5 }, { lookback: 40 }, { lookback: 12 }, { lookback: 33 }]);
  ok(jumpy.ok && jumpy.verdict === 'FITTING_NOISE',
    `parameters ranging 5–40 across folds are reported as FITTING_NOISE (instability ${jumpy.overallInstability})`);
  ok(/fitting noise/.test(jumpy.plainly), '  …in words, with the actual range named');
  const steady = W.parameterStability([{ lookback: 20 }, { lookback: 21 }, { lookback: 20 }, { lookback: 22 }]);
  ok(steady.ok && steady.verdict === 'STABLE', 'and a steady choice is STABLE');
}

/* ── 6. the ledger ──────────────────────────────────────────────────────── */
console.log('\ntrial counting');
{
  const L = tmpLedger();
  ok(L.trialCount('X').count === null && L.trialCount('X').source === 'unknown',
    'a family with no recorded trials returns UNKNOWN, not zero and not one');
  L.recordTrial({ family: 'X', params: { a: 1 } });
  L.recordTrial({ family: 'X', params: { a: 2 } });
  L.recordTrial({ family: 'X', params: { a: 1 } });        // the same set again
  const c = L.trialCount('X');
  ok(c.count === 2 && c.source === 'recorded' && c.exact === true,
    'identical parameter sets are counted once (2 from 3 recordings), and the count is exact');
}

console.log('\nthe out-of-sample budget');
{
  const L = tmpLedger();
  ok(L.oosStatus('2025H1').status === 'FRESH', 'an unused period is FRESH');
  for (let i = 0; i < 3; i++) L.spendOos({ periodId: '2025H1', family: 'F' });
  ok(L.oosStatus('2025H1').status === 'DEGRADED', 'three evaluations DEGRADE it');
  for (let i = 0; i < 8; i++) L.spendOos({ periodId: '2025H1', family: 'F' });
  const s = L.oosStatus('2025H1');
  ok(s.status === 'SPENT' && s.evaluations === 11, `eleven evaluations SPEND it`);
  ok(/no longer out-of-sample/.test(s.note),
    '  …and it says the period is no longer out-of-sample in any meaningful sense');
  ok(s.thresholdsAreJudgement === true, 'the thresholds are labelled as judgement; the COUNT is not');
}

console.log('\nreproducibility');
{
  const L = tmpLedger();
  const base = { family: 'F', strategy: 's', codeHash: 'c1', configHash: 'g1', dataSnapshots: { d: 'v1' }, costModelVersion: 'cm1', seeds: 42 };
  const a = L.recordRun({ ...base, metrics: { sharpe: 1.2 } });
  ok(a.reproducible === true && a.runId, 'a fully specified run is recorded as reproducible');
  const b = L.recordRun({ ...base, metrics: { sharpe: 1.2 } });
  ok(b.runId === a.runId && b.reproducible === true, 'the same inputs give the same run ID and the same metrics');
  const c = L.recordRun({ ...base, metrics: { sharpe: 1.9 } });
  ok(c.reproducible === false && c.reproducibilityFailure,
    'the SAME inputs producing DIFFERENT metrics is recorded as a reproducibility failure');
  ok(/not deterministic/.test(c.reproducibilityFailure.detail), '  …and named as non-determinism, not overwritten');
  const d = L.recordRun({ family: 'F', strategy: 's', metrics: {} });
  ok(d.reproducible === false && d.missingInputs.length >= 4,
    'a run missing its hashes is recorded as NOT reproducible, with the missing inputs named');
}

/* ── 7. the harness verdict ─────────────────────────────────────────────── */
console.log('\nthe verdict');
{
  const h = new ValidationHarness({ ledger: tmpLedger(), log: quiet });
  ok(!h.validate({ family: 'F' }).ok, 'validation without declared criteria is refused');
  ok(/rationalisation/.test(h.validate({ family: 'F' }).why),
    '  …because a criterion chosen after seeing the numbers is a rationalisation');
}
{
  const h = new ValidationHarness({ ledger: tmpLedger(), log: quiet });
  h.declareCriteria();
  const r = h.validate({ family: 'NOTHING', strategy: 'a strategy with no evidence at all' });
  ok(r.verdict === 'CANNOT_VALIDATE', 'a strategy with no evidence CANNOT BE VALIDATED');
  ok(r.counts.pass === 0 && r.counts.cannotValidate >= 6, `${r.counts.cannotValidate} tests could not run`);
  ok(/NOT a pass/.test(r.plainly),
    '  …and the report says in words that this is NOT a pass — the single most important sentence in the harness');
  ok(r.tests.find(t => t.name === 'walkForward').detail.includes('single-period backtest is not a substitute'),
    'a single-period backtest is explicitly not accepted in place of walk-forward');
}
{
  const L = tmpLedger();
  const h = new ValidationHarness({ ledger: L, log: quiet });
  h.declareCriteria();
  const r0 = rng(31);
  const data = Array.from({ length: 800 }, () => gauss(r0) * 0.01);
  const r = h.validate({
    family: 'NOISE', strategy: 'pure noise dressed as a strategy',
    trials: { count: 150, source: 'recorded', exact: true },
    walkForward: {
      data, inSample: 200, outSample: 50,
      optimise: () => ({ p: 1 }),
      evaluate: (slice) => ({ returns: slice, pnl: slice.reduce((a, b) => a + b, 0) }),
    },
  });
  ok(r.tests.find(t => t.name === 'walkForward').status === 'PASS', 'the walk-forward ran on the noise series');
  const ds = r.tests.find(t => t.name === 'deflatedSharpe');
  ok(ds.status === 'FAIL', 'and a noise strategy chosen from 150 trials FAILS deflation');
  ok(r.verdict === 'FAIL', 'so the overall verdict is FAIL');
}

/* ── 8. the promotion gate ──────────────────────────────────────────────── */
console.log('\npromotion gate');
{
  const h = new ValidationHarness({ ledger: tmpLedger(), log: quiet });
  h.declareCriteria();
  const cannot = h.validate({ family: 'F', strategy: 's' });
  const p = h.promote({ stage: 'PAPER', result: cannot });
  ok(!p.allowed && /not a pass/.test(p.detail),
    'a CANNOT_VALIDATE result does not reach paper — the gate treats it as a block, not an absence of objections');
}
{
  const h = new ValidationHarness({ ledger: tmpLedger(), log: quiet });
  h.declareCriteria();
  const r = h.validate({ family: 'F', strategy: 's' });
  h.declareCriteria({ ...DEFAULT_CRITERIA, version: 2 });   // criteria changed after the run
  const p = h.promote({ stage: 'PAPER', result: r });
  ok(!p.allowed && p.reason === 'CRITERIA_CHANGED',
    'a result measured against one bar cannot be promoted against another');
}
{
  const h = new ValidationHarness({ ledger: tmpLedger(), log: quiet });
  h.declareCriteria();
  const fake = { family: 'F', criteriaHash: h.criteriaHash, verdict: 'PASS', tests: [] };
  const noPaper = h.promote({ stage: 'LIVE', result: fake, evidence: { paperDays: 5, paperTrades: 3 } });
  ok(!noPaper.allowed && noPaper.blocks.length >= 3,
    'LIVE is blocked without the minimum paper period, trade count and divergence report');
  const gap = h.promote({ stage: 'LIVE', result: fake, evidence: { paperDays: 90, paperTrades: 50, paperSharpe: 0.4, backtestSharpe: 2.6 } });
  ok(!gap.allowed && gap.blocks.some(b => /gap of/.test(b)),
    'and a large paper-versus-backtest divergence blocks it too');
  const okGo = h.promote({ stage: 'LIVE', result: fake, evidence: { paperDays: 90, paperTrades: 50, paperSharpe: 1.9, backtestSharpe: 2.1 } });
  ok(okGo.allowed, 'a strategy meeting every declared criterion is allowed');
}
{
  const h = new ValidationHarness({ ledger: tmpLedger(), log: quiet });
  h.declareCriteria();
  ok(!h.override({ stage: 'LIVE', family: 'F', by: '', reason: 'x'.repeat(30) }).ok, 'an override needs a named human');
  ok(!h.override({ stage: 'LIVE', family: 'F', by: 'mayur', reason: 'approved' }).ok,
    'and a written reason — "approved" is not a reason');
  const o = h.override({ stage: 'LIVE', family: 'F', by: 'mayur', reason: 'accepting the divergence for one week under supervision, reviewed with the log' });
  ok(o.ok && o.signature && o.by === 'mayur', 'a signed override is recorded with its signature and reason');
}

/* ── 9. robustness and fragility ────────────────────────────────────────── */
console.log('\nrobustness battery');
{
  const h = new ValidationHarness({ ledger: tmpLedger(), log: quiet });
  h.declareCriteria();
  // An edge that only exists at exactly 1× costs — the textbook fragile strategy.
  const rb = h.robustness({ run: ({ costMultiplier, slippageMultiplier }) => ({ sharpe: (costMultiplier > 1 || slippageMultiplier > 1) ? -0.2 : 2.0, pnl: 1 }) });
  ok(rb.ok && rb.verdict !== 'ROBUST', `an edge that vanishes under higher costs is ${rb.verdict}`);
  ok(rb.worstScenario && rb.worstScenario.dropPct > 50, `worst case costs ${rb.worstScenario.dropPct}% of the Sharpe`);
  ok(/collapses under/.test(rb.plainly), 'and the summary is one sentence, not a table nobody reads');
}
{
  const h = new ValidationHarness({ ledger: tmpLedger(), log: quiet });
  h.declareCriteria();
  const rb = h.robustness({ run: () => ({ sharpe: 1.5, pnl: 1 }) });
  ok(rb.ok && rb.verdict === 'ROBUST' && rb.fragility === 0, 'an edge that survives every perturbation is ROBUST');
}
{
  const h = new ValidationHarness({ ledger: tmpLedger(), log: quiet });
  h.declareCriteria();
  const rb = h.robustness({ run: ({ costMultiplier }) => { if (costMultiplier === 1) throw new Error('boom'); return { sharpe: 1 }; } });
  ok(!rb.ok && /baseline/.test(rb.why),
    'if the baseline itself will not run, nothing can be compared against it and the battery refuses');
}

/* ── 10. slicing by year, regime and underlying ──────────────────────────── */
console.log('\nslicing');
{
  const h = new ValidationHarness({ ledger: tmpLedger(), log: quiet });
  h.declareCriteria();

  /* The classic fragility that NO cost multiplier catches: one year carried the
     whole strategy and the other three lost money. The average is positive, so
     every perturbation scenario passes. */
  const trades = [];
  for (const y of [2023, 2025, 2026]) for (let i = 0; i < 20; i++) trades.push({ year: y, regime: 'RANGE', underlying: 'NIFTY', ret: -0.002 });
  for (let i = 0; i < 20; i++) trades.push({ year: 2024, regime: 'TREND', underlying: 'NIFTY', ret: 0.05 });

  const s = h.sliceBy(trades);
  ok(s.ok && s.dimensions.year.ok, 'trades are sliced by year');
  ok(s.dimensions.year.concentrated === true,
    `one year carrying the profit is flagged as concentrated (best slice takes ${(s.dimensions.year.concentrationInBestSlice * 100).toFixed(0)}%)`);
  ok(/not general/.test(s.dimensions.year.plainly) || /does not hold/.test(s.dimensions.year.plainly),
    '  …and said in words: the edge is concentrated, not general');
  ok(s.dimensions.underlying.ok && s.dimensions.underlying.count === 1,
    'a single underlying is sliced too, and its count is reported rather than assumed diversified');
}
{
  const h = new ValidationHarness({ ledger: tmpLedger(), log: quiet });
  h.declareCriteria();
  const trades = [];
  for (const y of [2023, 2024, 2025, 2026]) for (let i = 0; i < 20; i++) trades.push({ year: y, regime: i % 2 ? 'RANGE' : 'TREND', underlying: i % 3 ? 'NIFTY' : 'BANKNIFTY', ret: 0.01 });
  const s = h.sliceBy(trades);
  ok(s.ok && s.concentrationFailures === 0, 'an edge present in every year, regime and underlying is not flagged');
  ok(/holds across all/.test(s.plainly), '  …and the summary says so');
}
{
  const h = new ValidationHarness({ ledger: tmpLedger(), log: quiet });
  h.declareCriteria();
  const s = h.sliceBy([{ ret: 0.01 }, { ret: 0.02 }]);
  ok(s.ok && s.dimensionsNotTagged === 3, 'untagged rows leave all three dimensions unchecked');
  ok(!s.dimensions.year.ok && /NOT checked/.test(s.dimensions.year.why),
    '  …and each is reported as NOT CHECKED rather than as passing');
}
{
  /* The point of folding slicing into the fragility score: a strategy that
     survives every perturbation but earned everything in one year must not read
     as ROBUST. */
  const h = new ValidationHarness({ ledger: tmpLedger(), log: quiet });
  h.declareCriteria();
  const trades = [];
  for (const y of [2023, 2025, 2026]) for (let i = 0; i < 20; i++) trades.push({ year: y, regime: 'R', underlying: 'NIFTY', ret: -0.002 });
  for (let i = 0; i < 20; i++) trades.push({ year: 2024, regime: 'R', underlying: 'NIFTY', ret: 0.05 });

  const noSlice = h.robustness({ run: () => ({ sharpe: 1.5, pnl: 1 }) });
  ok(noSlice.verdict === 'ROBUST', 'perturbations alone call this strategy ROBUST');
  ok(/NOT checked/.test(noSlice.fragilityBasis) || /not checked/.test(noSlice.fragilityBasis),
    '  …but the basis line says slicing was not checked, rather than implying it passed');

  const withSlice = h.robustness({ run: () => ({ sharpe: 1.5, pnl: 1 }), trades });
  ok(withSlice.fragility > noSlice.fragility,
    `adding the slice check RAISES fragility (${noSlice.fragility} → ${withSlice.fragility}) — the one-year edge is now visible`);
  ok(/WORSE of/.test(withSlice.fragilityBasis),
    'and the score is the WORSE of the two, because averaging would let a robust cost profile hide a one-year edge');
  ok(withSlice.plainly.includes('perturbations') && /concentrat/i.test(withSlice.plainly),
    'the one-sentence summary carries both findings');
}

console.log(`\n${n} checks passed\n`);
