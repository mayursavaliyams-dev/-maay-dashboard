/**
 * Validation harness — unit tests (known-answer). Run: node test/bt-validate.test.js
 */
'use strict';
const assert = require('assert');
const V = require('../bt-validate');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ~${b})`); console.log('  ✓ ' + m); pass++; };

console.log('Validation harness');

// ── normal CDF / inverse ──
near(V.normCdf(0), 0.5, 1e-6, 'normCdf(0) = 0.5');
near(V.normCdf(1.96), 0.975, 2e-3, 'normCdf(1.96) ≈ 0.975');
near(V.normCdf(-1.96), 0.025, 2e-3, 'normCdf(-1.96) ≈ 0.025');
near(V.normInv(0.5), 0, 1e-6, 'normInv(0.5) = 0');
near(V.normInv(0.975), 1.96, 1e-3, 'normInv(0.975) ≈ 1.96');
near(V.normInv(0.025), -1.96, 1e-3, 'normInv(0.025) ≈ -1.96');

// ── moments ──
{
  const a = [1, 2, 3, 4, 5];
  near(V.mean(a), 3, 1e-9, 'mean');
  near(V.std(a), 1.5811, 1e-3, 'sample std');
  near(V.skewness([1, 2, 3, 4, 5]), 0, 1e-9, 'symmetric → skew 0');
  ok(V.skewness([1, 1, 1, 1, 10]) > 0, 'right-tailed → positive skew');
  ok(V.skewness([1, 10, 10, 10, 10]) < 0, 'left-tailed → negative skew');
  ok(Math.abs(V.kurtosis([1, 2, 3, 4, 5]) - 3) < 2, 'kurtosis near normal-ish for uniform-ish');
}

// ── Sharpe ──
{
  const r = [0.02, -0.01, 0.03, 0.01, -0.005, 0.02];
  const s = V.sharpe(r);
  near(s, V.mean(r) / V.std(r), 1e-9, 'sharpe = mean/std');
  ok(V.sharpe([0.01, 0.01, 0.01]) === 0 || !isFinite(V.sharpe([0.01, 0.01, 0.01])) || V.sharpe([0.01,0.01,0.01]) > 100, 'zero-variance handled');
}

// ── Probabilistic Sharpe ──
{
  const good = Array.from({ length: 100 }, (_, i) => 0.01 + (i % 5 - 2) * 0.002); // positive mean, low vol
  const p = V.probabilisticSharpe(good, 0);
  ok(p.psr > 0.9, 'strong positive series → high PSR(SR>0)');
  const noise = Array.from({ length: 100 }, (_, i) => ((i * 7) % 11 - 5) * 0.01);  // ~zero mean
  ok(V.probabilisticSharpe(noise, 0).psr < 0.8, 'zero-mean noise → low PSR');
  ok(V.probabilisticSharpe([1, 2, 3]).psr == null, 'too few points → null');
}

// ── expected max Sharpe rises with trials ──
{
  const e1 = V.expectedMaxSharpe(1, 0.04), e10 = V.expectedMaxSharpe(10, 0.04), e100 = V.expectedMaxSharpe(100, 0.04);
  ok(e100 > e10 && e10 > e1, 'expected max Sharpe increases with #trials (selection bias)');
}

// ── Deflated Sharpe: more trials → harder to pass ──
{
  const r = Array.from({ length: 120 }, (_, i) => 0.008 + (i % 7 - 3) * 0.003);
  const d1 = V.deflatedSharpe(r, 1), d50 = V.deflatedSharpe(r, 50);
  ok(d1.dsr >= d50.dsr, 'more trials → lower/equal DSR (deflation)');
  ok(d50.srBenchmark > d1.srBenchmark, 'benchmark SR* rises with trials');
  ok(V.deflatedSharpe([1, 2, 3]).dsr == null, 'too few trades → null DSR');
  ok(typeof d1.verdict === 'string', 'verdict string present');
}

// ── walk-forward: OOS only, rolls ──
{
  const rets = Array.from({ length: 100 }, (_, i) => 0.005 + Math.sin(i / 3) * 0.01);
  const wf = V.walkForward(rets.map((_, i) => i), i => rets[i], { trainWin: 40, testWin: 15 });
  ok(wf.folds.length >= 2, 'multiple walk-forward folds');
  ok(wf.oosTrades > 0 && wf.oosTrades <= rets.length, 'OOS trade count sane');
  ok(wf.folds[0].from >= 40, 'first OOS fold starts after the train window (no look-ahead)');
}

// ── purged k-fold ──
{
  const rets = Array.from({ length: 50 }, (_, i) => (i % 3 - 1) * 0.01 + 0.003);
  const pk = V.purgedKFold(rets, 5, 1);
  ok(pk.foldSharpes.length === 5, '5 folds reported');
  ok(typeof pk.meanFoldSharpe === 'number', 'mean fold Sharpe computed');
}

// ── expectancy ──
{
  const e = V.expectancy([100, 100, 100, -300]);
  near(e.winRate, 75, 0.1, 'win rate 75%');
  near(e.avgWin, 100, 0.1, 'avg win 100');
  near(e.avgLoss, -300, 0.1, 'avg loss -300');
  near(e.expectancy, 0, 0.1, 'expectancy = 0.75×100 + 0.25×(-300) = 0');
  near(e.payoff, 0.33, 0.01, 'payoff = avgWin/|avgLoss|');
}

console.log(`\n${pass} assertions passed`);
