/**
 * Signal health (Phase 5) — unit tests. Run: node test/signal-health.test.js
 */
'use strict';
const assert = require('assert');
const H = require('../signal-health');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };

console.log('Signal health (Phase 5)');

let t = 1000;
const feed = (tk, rawP, won, pnl) => H.logOutcome(tk, { t: t++, inst: 'NIFTY', structure: 'IRON_CONDOR', rawP, prob: rawP, won, pnl });

// ── LEARNING until minSamples ──
{
  const tk = H.newTracker({ minSamples: 30 });
  for (let i = 0; i < 10; i++) feed(tk, 0.7, true, 500);
  const h = H.assessHealth(tk);
  ok(h.status === 'LEARNING', 'below minSamples → LEARNING');
}

// ── HEALTHY: well-calibrated, positive expectancy, no decay ──
{
  const tk = H.newTracker({ minSamples: 30 });
  // 70% win, consistent across window, wins +500 losses -300 → positive expectancy
  for (let i = 0; i < 100; i++) { const won = i % 10 < 7; feed(tk, 0.7, won, won ? 500 : -300); }
  const h = H.assessHealth(tk);
  ok(h.status === 'HEALTHY', 'calibrated + positive expectancy → HEALTHY');
  ok(h.recent.winRate > 0.6 && h.recent.winRate < 0.8, 'recent win-rate ~0.7');
  ok(h.recent.expectancy > 0, 'positive expectancy');
  ok(h.calibration.brier != null, 'calibration brier computed');
}

// ── DEGRADED: miscalibration (says 90% wins only ~40%) ──
{
  const tk = H.newTracker({ minSamples: 30 });
  for (let i = 0; i < 100; i++) { const won = i % 10 < 4; feed(tk, 0.9, won, won ? 300 : -400); }
  const h = H.assessHealth(tk);
  ok(h.status === 'DEGRADED', 'overconfident + losing → DEGRADED');
  ok(h.reasons.length > 0, 'gives honest reasons');
  ok(/calibrat|expectancy|Brier|ECE|decay/i.test(h.reasons.join(' ')), 'reason names the failure');
}

// ── DEGRADED: edge decay (was winning, now losing) ──
{
  const tk = H.newTracker({ minSamples: 20 });
  for (let i = 0; i < 40; i++) feed(tk, 0.65, true, 400);    // older half all wins
  for (let i = 0; i < 40; i++) feed(tk, 0.65, false, -400);  // recent half all losses
  const h = H.assessHealth(tk);
  ok(h.status === 'DEGRADED', 'win-rate collapse across halves → DEGRADED');
  ok(h.drift.decay < 0, 'drift.decay negative');
}

// ── recentStats math ──
{
  const tk = H.newTracker();
  feed(tk, 0.6, true, 1000); feed(tk, 0.6, false, -500); feed(tk, 0.6, true, 1000); feed(tk, 0.6, false, -500);
  const s = H.recentStats(tk);
  ok(s.n === 4 && s.winRate === 0.5, 'recentStats counts n + win-rate');
  ok(s.totalPnl === 1000, 'totalPnl sums pnl');
  ok(s.expectancy === 250, 'expectancy = 0.5*1000 - 0.5*500 = 250');
}

// ── rolling window drops old ──
{
  const tk = H.newTracker({ window: 50 });
  for (let i = 0; i < 120; i++) feed(tk, 0.6, true, 100);
  ok(tk.outcomes.length === 50, 'window caps outcome list at 50');
}

// ── persistence round-trip via in-memory fake fs ──
{
  const store = {};
  const fakeFs = { writeFileSync: (p, d) => { store[p] = d; }, readFileSync: (p) => { if (!(p in store)) throw new Error('nofile'); return store[p]; } };
  const tk = H.newTracker({ minSamples: 5 });
  for (let i = 0; i < 40; i++) feed(tk, 0.7, i % 10 < 7, i % 10 < 7 ? 500 : -300);
  ok(H.saveState(tk, fakeFs, 'x.json') === true, 'saveState writes');
  const tk2 = H.loadState(fakeFs, 'x.json', {});
  ok(tk2.outcomes.length === 40, 'loadState restores all outcomes');
  ok(H.assessHealth(tk2).recent.n === 40, 'restored tracker assesses');
  const tk3 = H.loadState(fakeFs, 'missing.json', {});
  ok(tk3.outcomes.length === 0, 'missing file → fresh tracker');
}

console.log(`\n${pass} assertions passed`);
