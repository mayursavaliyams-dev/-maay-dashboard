/**
 * Volatility Context engine — unit tests. Run: node test/vol-context.test.js
 */
'use strict';
const assert = require('assert');
const vc = require('../vol-context');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ~${b})`); console.log('  ✓ ' + m); pass++; };

console.log('Volatility Context engine');

// ── IV Rank / Percentile ──
{
  const series = Array.from({ length: 21 }, (_, i) => 10 + i); // 10..30
  const r = vc.ivRankPercentile(20, series);
  ok(r.available, 'IVP available with sufficient history');
  near(r.ivRank, 50, 0.1, 'IV Rank = (20-10)/(30-10) = 50%');
  near(r.ivPercentile, 47.6, 0.5, 'IV Percentile ≈ 47.6% (10 of 21 below 20)');
  ok(r.sellingFavored === false, 'below 50th pct → selling not favored');
  const hi = vc.ivRankPercentile(29, series);
  ok(hi.sellingFavored === true && /rich/i.test(hi.label), 'high IVP → premium rich, selling favored');
  ok(vc.ivRankPercentile(20, [1, 2, 3]).available === false, 'too little history → unavailable');
}

// ── Black-Scholes gamma ──
{
  const gAtm = vc.bsGamma(24000, 24000, 0.14, 3 / 365);
  const gOtm = vc.bsGamma(24000, 24800, 0.14, 3 / 365);
  ok(gAtm > 0, 'ATM gamma positive');
  ok(gAtm > gOtm, 'ATM gamma > OTM gamma');
  ok(vc.bsGamma(24000, 24000, 0, 0) === 0, 'zero vol/time → gamma 0, no NaN');
}

// ── Expected Move ──
{
  const em = vc.expectedMove(24000, 200, 14, 3);
  ok(em.byExpiryPts === 170, 'by-expiry EM = 0.85 × straddle = 170');
  ok(em.upper === 24170 && em.lower === 23830, 'EM band = spot ± EM');
  ok(em.oneDayPts > 0 && em.oneDayPct > 0, 'one-day EM computed');
  ok(em.basis === 'ATM straddle (market)', 'prefers market straddle basis');
  const em2 = vc.expectedMove(24000, 0, 14, 3);
  ok(em2.basis === 'IV model' && em2.byExpiryPts > 0, 'falls back to IV model when no straddle');
}

// ── GEX-lite: walls + regime ──
{
  const rows = [
    { strike: 23600, ce: { oi: 100 }, pe: { oi: 900 } },
    { strike: 23800, ce: { oi: 200 }, pe: { oi: 1500 } }, // put wall
    { strike: 24000, ce: { oi: 500 }, pe: { oi: 500 } },
    { strike: 24200, ce: { oi: 1800 }, pe: { oi: 150 } }, // call wall
    { strike: 24400, ce: { oi: 700 }, pe: { oi: 80 } },
  ];
  const g = vc.gexLite(rows, 24000, 14, 3, 65);
  ok(g.available, 'GEX-lite available');
  ok(g.callWall === 24200, 'call wall = max call OI strike (24200)');
  ok(g.putWall === 23800, 'put wall = max put OI strike (23800)');
  ok(g.netGexSign === 'POSITIVE' || g.netGexSign === 'NEGATIVE', 'net GEX sign set');
  ok(/regime gauge/i.test(g.caveat), 'honest caveat attached (regime gauge, not predictor)');
  ok(vc.gexLite([], 24000, 14, 3, 65).available === false, 'empty chain → unavailable');
}

// ── combined ──
{
  const out = vc.analyze({
    currentVix: 20, vixHistory: Array.from({ length: 21 }, (_, i) => 10 + i),
    spot: 24000, atmStraddle: 200, ivPct: 14, dteDays: 3, lotSize: 65,
    rows: [{ strike: 23800, ce: { oi: 1 }, pe: { oi: 9 } }, { strike: 24000, ce: { oi: 5 }, pe: { oi: 5 } }, { strike: 24200, ce: { oi: 9 }, pe: { oi: 1 } }, { strike: 24400, ce: { oi: 3 }, pe: { oi: 1 } }, { strike: 23600, ce: { oi: 1 }, pe: { oi: 4 } }],
  });
  ok(out.ivp.available && out.expectedMove.byExpiryPts > 0 && out.gex.available, 'analyze() returns all three slices');
}

console.log(`\nVol Context: ${pass} assertions passed`);
