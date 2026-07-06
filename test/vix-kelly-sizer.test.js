/**
 * VIX-Kelly sizer (#3) — unit tests. Run: node test/vix-kelly-sizer.test.js
 */
'use strict';
const assert = require('assert');
const S = require('../vix-kelly-sizer');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const near = (a, b, t, m) => { assert.ok(Math.abs(a - b) <= t, `${m} (got ${a}, want ~${b})`); console.log('  ✓ ' + m); pass++; };

console.log('VIX-Kelly sizer (#3)');

// ── volTargetScale ──
near(S.volTargetScale(14, 14), 1, 1e-6, 'VIX at baseline → 1×');
near(S.volTargetScale(28, 14), 0.5, 1e-6, 'VIX 2× baseline → 0.5× size');
ok(S.volTargetScale(7, 14) <= 1.5, 'very low VIX capped at max (1.5×)');
ok(S.volTargetScale(60, 14) >= 0.4, 'very high VIX floored at min (0.4×)');
ok(S.volTargetScale(0, 14) === 1, 'no VIX → neutral 1× (backward-compatible)');
ok(S.volTargetScale(null, 14) === 1, 'null VIX → neutral 1×');

// ── halfKelly ──
ok(S.halfKelly(0.5, 1) === 0, 'no edge → Kelly 0');
ok(S.halfKelly(0.84, 0.86) > 0 && S.halfKelly(0.84, 0.86) <= 0.5, 'selling edge → positive, capped 0.5');

// ── sizeLots: higher VIX → fewer lots ──
{
  const base = { capital: 700000, riskPct: 0.05, perLotRisk: 5000, vixBaseline: 14, maxLots: 20 };
  const calm = S.sizeLots({ ...base, vix: 12 });
  const stormy = S.sizeLots({ ...base, vix: 28 });
  ok(calm.lots >= stormy.lots, 'calm VIX sizes >= stormy VIX');
  ok(stormy.volScale < calm.volScale, 'stormy vol-scale smaller');
  ok(calm.lots >= 1, 'positive sizing when budget allows');
  ok(calm.riskBudget === 35000, 'risk budget = capital × riskPct');
}

// ── extraScale (REDUCE regime) halves ──
{
  const full = S.sizeLots({ capital: 700000, riskPct: 0.05, perLotRisk: 3000, vix: 14, extraScale: 1, maxLots: 50 });
  const red = S.sizeLots({ capital: 700000, riskPct: 0.05, perLotRisk: 3000, vix: 14, extraScale: 0.5, maxLots: 50 });
  ok(red.lots <= full.lots, 'REDUCE extraScale 0.5 → fewer/equal lots');
  ok(red.extraScale === 0.5, 'extraScale surfaced');
}

// ── maxLots cap + tiny-budget floor ──
{
  const capped = S.sizeLots({ capital: 100000000, riskPct: 0.5, perLotRisk: 1000, vix: 14, maxLots: 8 });
  ok(capped.lots === 8, 'lots capped at maxLots');
  const broke = S.sizeLots({ capital: 5000, riskPct: 0.01, perLotRisk: 50000, vix: 14 });
  ok(broke.lots === 0 && broke.baseLots === 0, 'cannot afford a lot → 0 (honest)');
}

// ── no VIX → sizing still works (neutral scale) ──
{
  const r = S.sizeLots({ capital: 700000, riskPct: 0.05, perLotRisk: 5000 });
  ok(r.volScale === 1 && r.lots >= 1, 'missing VIX → neutral vol-scale, still sizes');
}

console.log(`\n${pass} assertions passed`);
