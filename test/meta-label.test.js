/**
 * Meta-label (Phase 3) — unit tests. Run: node test/meta-label.test.js
 */
'use strict';
const assert = require('assert');
const M = require('../meta-label');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };

console.log('Meta-label (Phase 3)');

// ── rawProbability monotonic in the strong features ──
{
  const weak = M.rawProbability(M.featuresFrom({ regimeScore: 50, ivp: 50, ivMinusRV: 0, pcr: 1 }));
  const strong = M.rawProbability(M.featuresFrom({ regimeScore: 90, ivp: 85, ivMinusRV: 0.06, pcr: 1.3, gexRange: 'RANGE' }));
  ok(strong > weak, 'strong confluence → higher raw probability');
  ok(weak > 0 && weak < 1, 'probability stays in (0,1)');
  const evented = M.rawProbability(M.featuresFrom({ regimeScore: 90, ivp: 85, eventRisk: 1 }));
  const calm = M.rawProbability(M.featuresFrom({ regimeScore: 90, ivp: 85, eventRisk: 0 }));
  ok(evented < calm, 'event risk lowers probability');
}

// ── featuresFrom normalization bounds ──
{
  const f = M.featuresFrom({ regimeScore: 200, ivp: -50, ivMinusRV: 5, momentum: 999, pcr: 10 });
  for (const k of ['regime', 'ivp', 'vrp', 'momentum', 'pcr']) ok(f[k] >= -1 && f[k] <= 1, `feature ${k} clamped to [-1,1]`);
  ok(M.featuresFrom({ gexRange: 'RANGE' }).gexRange === 1, 'RANGE gex → +1');
  ok(M.featuresFrom({ gexRange: 'TREND' }).gexRange === -1, 'TREND gex → -1');
}

// ── calibration: learns empirical win-rate ──
{
  const cal = M.newCalibrator();
  // Feed 100 trades whose raw prob was 0.75 but only 50% actually won → calibrated should drop below raw.
  for (let n = 0; n < 100; n++) M.recordOutcome(cal, 0.75, n % 2 === 0);
  const c = M.calibrate(cal, 0.75);
  ok(c < 0.75 && c > 0.5, 'over-confident bin gets calibrated DOWN toward observed ~0.5');
  const h = M.health(cal);
  ok(h.total === 100, 'health counts all samples');
  ok(h.brier > 0 && h.brier <= 1, 'brier score in (0,1]');
  ok(Array.isArray(h.reliability) && h.reliability.length === 10, 'reliability table has 10 bins');
  ok(h.ece >= 0, 'ECE non-negative');
}

// ── thin data shrinks toward raw ──
{
  const cal = M.newCalibrator();
  M.recordOutcome(cal, 0.7, true);            // a single win
  const c = M.calibrate(cal, 0.7);
  ok(Math.abs(c - 0.7) < 0.1, 'one sample → calibrated stays near raw (pseudo-count shrink)');
}

// ── well-calibrated model → low Brier, calibration ≈ raw ──
{
  const cal = M.newCalibrator();
  // bin 0.7-0.8: exactly 70% win
  for (let n = 0; n < 100; n++) M.recordOutcome(cal, 0.75, n % 10 < 7);
  const c = M.calibrate(cal, 0.75);
  ok(Math.abs(c - 0.72) < 0.05, 'honest 70%-bin calibrates to ~0.7');
}

// ── scoreConfluence end-to-end ──
{
  const cal = M.newCalibrator();
  const s = M.scoreConfluence({ regimeScore: 80, ivp: 70, ivMinusRV: 0.04, trend: 0.5, momentum: 30, pcr: 1.2, gexRange: 'RANGE' }, cal);
  ok(s.probability > 0 && s.probability < 1, 'scoreConfluence returns a probability');
  ok(s.probabilityPct >= 0 && s.probabilityPct <= 100, 'pct form 0-100');
  ok(s.weights && s.features, 'white-box: exposes weights + features');
  ok(s.rawProbability != null, 'exposes raw probability too');
  // no calibrator → probability == raw
  const s0 = M.scoreConfluence({ regimeScore: 80, ivp: 70 });
  ok(s0.probability === s0.rawProbability, 'no calibrator → calibrated == raw');
}

console.log(`\n${pass} assertions passed`);
