/**
 * position-sizer — CHARACTERIZATION suite. Run: node test/position-sizer.test.js
 *
 * Created as part of MIGRATION C1c-4. This module had ZERO tests despite deciding how many
 * lots strangle-engine actually trades (strangle-engine.js:254 → `qty`), and therefore
 * scaling every rupee of paper P&L that follows.
 *
 * These assertions pin CURRENT behaviour, including behaviour that is WRONG, so that the
 * C1c-5 migration produces a diff in which every changed number is visible. Assertions that
 * pin a known defect are prefixed `DEFECT:`.
 *
 * ── Defects pinned here ──────────────────────────────────────────────────────
 *  P1 :25  `lotSize: 75` — a single module-global lot for EVERY instrument. The broker
 *          says NIFTY 65, BANKNIFTY 30, SENSEX 20. Used at :52 for condor margin.
 *  P2 :19  `marginPerLotStrangle: 130000` — a NIFTY SPAN figure applied to BANKNIFTY and
 *          SENSEX identically.
 *  P3      `recommend()` never receives `inst`. strangle-engine.js:254/392/393 call it
 *          without one, so the sizer cannot know which contract it is sizing. This is the
 *          root cause of P1 and P2 — not the constants themselves.
 *  P4 :59  Default strategy stats (winRate 0.9, avgWin 2900, avgLoss -3500) are hardcoded
 *          fallbacks. A caller that forgets to pass stats gets a confident Kelly number
 *          derived from someone else's backtest.
 *  P5 :67  `minLot` forces ≥1 lot whenever one lot is affordable and fracKelly > 0, even
 *          when the Kelly-scaled recommendation rounds to 0. Deliberate, but it means the
 *          sizer never says "sit this one out" on margin grounds alone.
 *  P6 :31  `R = |avgWin| / Math.max(1, |avgLoss|)` — the `max(1, …)` guard is a rupee-scale
 *          hack. It silently changes the Kelly ratio for any strategy whose |avgLoss| < 1.
 */
'use strict';
const assert = require('assert');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ~${b})`); console.log('  ✓ ' + m); pass++; };

console.log('position-sizer (characterization, migration C1c-4)');

// isolate env — an operator's .env must not make this suite lie
for (const k of ['SIZER_STRANGLE_MARGIN', 'SIZER_MARGIN_UTIL', 'SIZER_KELLY_FRACTION', 'SIZER_IV_SCALE_FLOOR', 'SIZER_MAX_LOTS']) delete process.env[k];
const S = require('../position-sizer.js');
const registry = require('../instrument-registry.js');

// ── DEFAULTS: the constants, pinned ──
{
  const D = S.DEFAULTS;
  ok(D.lotSize === 75, 'DEFECT P1: DEFAULTS.lotSize is a single global 75 for every instrument (fix: C1c-5)');
  ok(D.marginPerLotStrangle === 130000, 'DEFECT P2: strangle margin is a NIFTY figure applied to all (fix: C1c-5)');
  ok(D.condorMarginBuffer === 1.15, 'condor margin buffer 1.15');
  ok(D.marginUtilCap === 0.6, 'margin utilisation cap 60%');
  ok(D.kellyFraction === 0.5, 'half-Kelly');
  ok(D.ivScaleFloor === 0.4, 'at max IV, size scales to 40%');
  ok(D.maxLots === 25, 'hard cap 25 lots');

  // The registry knows the truth. This is the exact divergence C1c-5 must close.
  ok(registry.lotSize('NIFTY') === 65 && registry.lotSize('SENSEX') === 20,
    'DEFECT P1: registry says NIFTY 65 / SENSEX 20, sizer says 75 for both (fix: C1c-5)');
}

// ── kelly() ──
{
  // f* = W − (1−W)/R,  R = |avgWin| / max(1,|avgLoss|)
  // W=0.9, avgWin=2900, avgLoss=-3500 → R=0.82857 → f = 0.9 − 0.1/0.82857 = 0.77931
  near(S.kelly(0.9, 2900, -3500), 0.77931, 1e-4, 'kelly(0.9, 2900, -3500) = 0.7793');
  ok(S.kelly(0.5, 100, -100) === 0, 'a 50/50 bet at 1:1 has zero edge → f = 0');
  ok(S.kelly(0.1, 100, -100) === 0, 'negative edge is clamped to 0, never a short bet');
  ok(S.kelly(1, 100, -100) === 1, 'a certain win is clamped to 1, never > 1');
  ok(S.kelly(0.9, 5000, 0) > 0, 'zero avgLoss does not divide by zero');
  near(S.kelly(0.9, 5000, 0), 0.9 - 0.1 / 5000, 1e-9, 'DEFECT P6: |avgLoss|=0 → max(1,0)=1, so R = avgWin (a rupee-scale hack) (fix: backlog)');
  near(S.kelly(0.9, 2, -0.5), 0.9 - 0.1 / 2, 1e-9, 'DEFECT P6: |avgLoss|=0.5 is floored to 1, changing R from 4 to 2 (fix: backlog)');
  ok(S.kelly(0.9, -2900, -3500) >= 0, 'a negative avgWin cannot produce a negative fraction');
}

// ── recommend(): STRANGLE on ₹1L — the "you cannot afford this" path ──
{
  const r = S.recommend({ capital: 100000, structure: 'STRANGLE', winRate: 0.9, avgWin: 2900, avgLoss: -3500, ivPct: 0.5 });
  ok(r.marginPerLot === 130000, 'DEFECT P2: ₹130,000/lot regardless of instrument (fix: C1c-5)');
  ok(r.maxLotsByMargin === 0, '₹1L × 60% util = ₹60,000 cannot fund one ₹130,000 lot');
  ok(r.recommendedLots === 0, 'unaffordable → 0 lots');
  ok(/cannot fund 1 STRANGLE lot/.test(r.reason), 'the reason says so plainly');
  ok(/use a CONDOR/.test(r.reason), 'and suggests the defined-risk alternative');
  ok(r.structure === 'STRANGLE', 'structure echoed back');
}

// ── recommend(): CONDOR on ₹1L — the affordable path ──
{
  const r = S.recommend({ capital: 100000, structure: 'CONDOR', maxLossPerUnit: 175, winRate: 0.9, avgWin: 2900, avgLoss: -3500, ivPct: 0.5 });
  // margin = max(12000, 175 × 75 × 1.15) = 15,093.75   ← the 75 is the defect
  near(r.marginPerLot, 15094, 1, 'DEFECT P1: condor margin = maxLoss × 75 × 1.15 (fix: C1c-5)');
  ok(r.maxLotsByMargin === 3, '₹60,000 / ₹15,094 = 3 lots affordable');
  // fullKelly 0.7793 → half 0.3897 ; ivScale @0.5 = 1 − 0.6×0.5 = 0.7 ; risk = 0.2728
  ok(r.fullKellyPct === 78, 'fullKellyPct 78');
  ok(r.fracKellyPct === 39, 'half-Kelly 39%');
  ok(r.ivScalePct === 70, 'IV scale at ivPct 0.5 → 70%');
  ok(r.riskFractionPct === 27, 'risk fraction 27%');
  // floor(3 × 0.2728) = 0 → minLot forces 1
  ok(r.recommendedLots === 1, 'DEFECT P5: Kelly rounds to 0 lots, minLot forces 1 (fix: backlog — deliberate)');
  ok(/lot\(s\) affordable/.test(r.reason), 'reason describes the affordable path');
}

// ── condor margin floor ──
{
  const r = S.recommend({ capital: 1000000, structure: 'CONDOR', maxLossPerUnit: 1, winRate: 0.9, avgWin: 2900, avgLoss: -3500 });
  ok(r.marginPerLot === 12000, 'condor margin floors at ₹12,000/lot');
}

// ── IV scaling is linear from 1.0 down to ivScaleFloor ──
{
  const at = (iv) => S.recommend({ capital: 5000000, structure: 'CONDOR', maxLossPerUnit: 175, winRate: 0.9, avgWin: 2900, avgLoss: -3500, ivPct: iv });
  ok(at(0).ivScalePct === 100, 'ivPct 0 → scale 100%');
  ok(at(1).ivScalePct === 40, 'ivPct 1 → scale 40% (the floor)');
  ok(at(0.5).ivScalePct === 70, 'ivPct 0.5 → scale 70% (linear)');
  ok(at(-5).ivScalePct === 100, 'ivPct below 0 is clamped');
  ok(at(99).ivScalePct === 40, 'ivPct above 1 is clamped');
  ok(S.recommend({ capital: 5000000, structure: 'CONDOR', maxLossPerUnit: 175 }).ivScalePct === 70,
    'a missing ivPct defaults to 0.5, not to 0');
  // At ₹50L both ends saturate the 25-lot cap, so monotonicity must be probed below it.
  const small = (iv) => S.recommend({ capital: 500000, structure: 'CONDOR', maxLossPerUnit: 175, winRate: 0.9, avgWin: 2900, avgLoss: -3500, ivPct: iv });
  ok(small(1).recommendedLots < small(0).recommendedLots, 'higher IV → strictly fewer lots (below the 25-lot cap)');
  ok(at(1).recommendedLots === at(0).recommendedLots, 'above the cap, IV scaling is masked by maxLots — a real blind spot');
}

// ── hard cap ──
{
  const r = S.recommend({ capital: 100000000, structure: 'CONDOR', maxLossPerUnit: 175, winRate: 0.95, avgWin: 5000, avgLoss: -1000, ivPct: 0 });
  ok(r.recommendedLots === 25, 'recommendedLots is capped at maxLots (25)');
  ok(r.recommendedLots <= r.maxLotsByMargin, 'and never exceeds what margin allows');
}

// ── no edge → no trade ──
{
  const r = S.recommend({ capital: 5000000, structure: 'CONDOR', maxLossPerUnit: 175, winRate: 0.3, avgWin: 100, avgLoss: -100, ivPct: 0.5 });
  ok(r.fracKellyPct === 0, 'a negative-edge strategy has zero Kelly fraction');
  ok(r.recommendedLots === 0, 'DEFECT P5: minLot does NOT fire when fracKelly is 0 — the sizer correctly sits out');
}

// ── DEFECT P4: hardcoded default strategy stats ──
{
  const withStats = S.recommend({ capital: 5000000, structure: 'CONDOR', maxLossPerUnit: 175, winRate: 0.9, avgWin: 2900, avgLoss: -3500, ivPct: 0.5 });
  const noStats = S.recommend({ capital: 5000000, structure: 'CONDOR', maxLossPerUnit: 175, ivPct: 0.5 });
  ok(withStats.fullKellyPct === noStats.fullKellyPct,
    'DEFECT P4: omitting winRate/avgWin/avgLoss silently reuses 0.9/2900/-3500 (fix: backlog)');
}

// ── cfg overrides DEFAULTS ──
{
  const r = S.recommend({ capital: 100000, structure: 'CONDOR', maxLossPerUnit: 175, winRate: 0.9, avgWin: 2900, avgLoss: -3500, ivPct: 0.5, cfg: { lotSize: 20, maxLots: 2 } });
  near(r.marginPerLot, Math.max(12000, 175 * 20 * 1.15), 1, 'cfg.lotSize is honoured (this is the escape hatch C1c-5 will build on)');
  ok(r.recommendedLots <= 2, 'cfg.maxLots is honoured');
}

// ── the instrument-blindness, stated as a single assertion ──
{
  const nifty = S.recommend({ capital: 1000000, structure: 'CONDOR', maxLossPerUnit: 175, winRate: 0.9, avgWin: 2900, avgLoss: -3500, ivPct: 0.5 });
  const sensex = S.recommend({ capital: 1000000, structure: 'CONDOR', maxLossPerUnit: 175, winRate: 0.9, avgWin: 2900, avgLoss: -3500, ivPct: 0.5 });
  ok(nifty.marginPerLot === sensex.marginPerLot,
    'DEFECT P3: recommend() takes no `inst`, so NIFTY and SENSEX get identical margin — the root cause of P1/P2 (fix: C1c-5)');

  // What the margin SHOULD be, per the registry:
  const trueNifty = Math.max(12000, 175 * registry.lotSize('NIFTY') * 1.15);   // 13,081
  const trueSensex = Math.max(12000, 175 * registry.lotSize('SENSEX') * 1.15); // 12,000 (floor)
  ok(Math.round(nifty.marginPerLot) === 15094, 'DEFECT P1: NIFTY condor margin is ₹15,094 …');
  ok(Math.round(trueNifty) === 13081, '… but with lot 65 it should be ₹13,081 (−15.4% over-estimated)');
  ok(Math.round(trueSensex) === 12000, '… and SENSEX (lot 20) should hit the ₹12,000 floor, not ₹15,094 (+25.8% over-estimated)');
}

// ── output shape (backward compatibility for C1c-5) ──
{
  const r = S.recommend({ capital: 100000, structure: 'CONDOR', maxLossPerUnit: 175 });
  for (const k of ['recommendedLots', 'maxLotsByMargin', 'marginPerLot', 'fullKellyPct',
                   'fracKellyPct', 'ivScalePct', 'riskFractionPct', 'structure', 'reason']) {
    assert.ok(k in r, `recommend() must keep field ${k}`);
  }
  ok(true, 'recommend() returns all 9 documented fields');
  ok(Number.isInteger(r.recommendedLots) && r.recommendedLots >= 0, 'recommendedLots is a non-negative integer');
  ok(S.recommend({}).recommendedLots === 0, 'recommend({}) does not throw and recommends nothing');
  ok(S.recommend({ capital: 0, structure: 'STRANGLE' }).recommendedLots === 0, 'zero capital → zero lots');
}

console.log(`\n${pass} assertions passed`);
