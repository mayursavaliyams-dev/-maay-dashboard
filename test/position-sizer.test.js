/**
 * position-sizer — unit tests. Run: node test/position-sizer.test.js
 *
 * Born as a CHARACTERIZATION suite (C1c-4) pinning the module's defects, then re-pointed
 * by C1c-5 to assert the fix. The tripwire fired on cue: patching `lotSize: 75` failed the
 * suite before a single production line changed.
 *
 * ── What C1c-5 fixed ────────────────────────────────────────────────────────
 *  P3 (root cause)  `recommend()` never received `inst`. strangle-engine.js:254/392/393
 *                   all called it without one, so a single global lot and a single NIFTY
 *                   SPAN figure were applied to every instrument.
 *  P1 :25  `lotSize: 75` global default        → resolved per-instrument from the registry
 *  P2 :19  `marginPerLotStrangle: 130000`      → per-instrument env override + marginSource
 *
 * ── Still open (each needs its own commit) ──────────────────────────────────
 *  P4  default strategy stats (0.9 / 2900 / -3500) are hardcoded fallbacks
 *  P5  `minLot` forces ≥1 lot whenever one is affordable and fracKelly > 0
 *  P6  `R = |avgWin| / Math.max(1, |avgLoss|)` — the max(1,…) guard is a rupee-scale hack
 *  --  above the 25-lot cap, IV scaling has NO effect on the recommendation
 */
'use strict';
const assert = require('assert');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ~${b})`); console.log('  ✓ ' + m); pass++; };

console.log('position-sizer (migration C1c-5)');

for (const k of ['SIZER_STRANGLE_MARGIN', 'SIZER_MARGIN_UTIL', 'SIZER_KELLY_FRACTION', 'SIZER_IV_SCALE_FLOOR',
                 'SIZER_MAX_LOTS', 'SIZER_STRANGLE_MARGIN_SENSEX', 'SIZER_STRANGLE_MARGIN_NIFTY',
                 'NIFTY_LOT_SIZE', 'SENSEX_LOT_SIZE', 'BANKNIFTY_LOT_SIZE']) delete process.env[k];
const S = require('../position-sizer.js');
const registry = require('../instrument-registry.js');

const STATS = { winRate: 0.9, avgWin: 2900, avgLoss: -3500 };
const condor = (extra) => S.recommend({ structure: 'CONDOR', maxLossPerUnit: 175, ...STATS, ivPct: 0.5, ...extra });

// ── DEFAULTS ──
{
  const D = S.DEFAULTS;
  ok(!('lotSize' in D), 'C1c-5: DEFAULTS no longer carries a global lotSize');
  ok(D.marginPerLotStrangle === 130000, 'strangle SPAN default 130000 (a NIFTY figure — see marginSource)');
  ok(D.condorMarginBuffer === 1.15 && D.marginUtilCap === 0.6, 'condor buffer 1.15, margin util cap 60%');
  ok(D.kellyFraction === 0.5 && D.ivScaleFloor === 0.4 && D.maxLots === 25, 'half-Kelly, IV floor 40%, cap 25 lots');
}

// ── kelly() — unchanged by C1c-5 ──
{
  near(S.kelly(0.9, 2900, -3500), 0.77931, 1e-4, 'kelly(0.9, 2900, -3500) = 0.7793');
  ok(S.kelly(0.5, 100, -100) === 0, 'a 50/50 bet at 1:1 has zero edge → f = 0');
  ok(S.kelly(0.1, 100, -100) === 0, 'negative edge clamps to 0, never a short bet');
  ok(S.kelly(1, 100, -100) === 1, 'a certain win clamps to 1, never > 1');
  ok(S.kelly(0.9, 5000, 0) > 0, 'zero avgLoss does not divide by zero');
  near(S.kelly(0.9, 2, -0.5), 0.9 - 0.1 / 2, 1e-9, 'OPEN P6: |avgLoss|=0.5 is floored to 1, changing R from 4 to 2');
  ok(S.kelly(0.9, -2900, -3500) >= 0, 'a negative avgWin cannot produce a negative fraction');
}

// ════════════════════════════════════════════════════════════════════════════
//  C1c-5 — the lot now comes from the registry, per instrument
// ════════════════════════════════════════════════════════════════════════════
{
  const n = condor({ inst: 'NIFTY', capital: 1000000 });
  const s = condor({ inst: 'SENSEX', capital: 1000000 });
  const b = condor({ inst: 'BANKNIFTY', capital: 1000000 });

  ok(n.lotSize === 65 && n.lotSource === 'instrument-registry', 'C1c-5: NIFTY lot 65, sourced from the registry');
  ok(s.lotSize === 20 && b.lotSize === 30, 'C1c-5: SENSEX 20, BANKNIFTY 30 — no longer all 75');
  ok(n.inst === 'NIFTY' && s.inst === 'SENSEX', 'C1c-5: the result names the instrument it sized');

  // margin = max(12000, maxLoss × lot × 1.15)
  near(n.marginPerLot, 13081, 1, 'C1c-5: NIFTY condor margin ₹13,081 (was ₹15,094 — a +15.4% over-estimate)');
  near(b.marginPerLot, Math.max(12000, 175 * 30 * 1.15), 1, 'C1c-5: BANKNIFTY condor margin uses lot 30');
  ok(s.marginPerLot === 12000, 'C1c-5: SENSEX (lot 20) hits the ₹12,000 floor, not ₹15,094 (+25.8% over-estimated)');

  ok(n.marginPerLot !== s.marginPerLot, 'C1c-5 (P3 root cause): NIFTY and SENSEX no longer receive identical margin');
  ok(n.maxLotsByMargin > 0 && s.maxLotsByMargin > n.maxLotsByMargin,
    'C1c-5: a cheaper SENSEX condor funds strictly more lots than a NIFTY one at equal capital');

  ok(condor({ inst: 'nifty', capital: 1000000 }).lotSize === 65, 'C1c-5: instrument lookup is case-insensitive');
}

// ── fail-closed: no verified lot ⇒ no recommendation ──
{
  const noInst = condor({ capital: 1000000 });
  ok(noInst.recommendedLots === 0 && noInst.marginPerLot === null, 'C1c-5: CONDOR without `inst` refuses, and returns no margin');
  ok(/No instrument supplied/.test(noInst.reason), 'C1c-5: the refusal explains what is missing');

  const disabled = condor({ inst: 'FINNIFTY', capital: 1000000 });
  ok(disabled.recommendedLots === 0, 'C1c-5: CONDOR on a trading-disabled instrument refuses');
  ok(/FINNIFTY_TRADING_ENABLED=true/.test(disabled.reason), 'C1c-5: and tells the operator exactly how to opt in');
  ok(disabled.lotSize === null && disabled.lotSource === null, 'C1c-5: no lot is fabricated for a refusal');

  const unknown = condor({ inst: 'NIFTYNEXT50', capital: 1000000 });
  ok(unknown.recommendedLots === 0, 'C1c-5: CONDOR on an unknown instrument refuses');

  ok(registry.lotSize('FINNIFTY') === null, 'C1c-5: the registry is what makes this fail-closed');
}

// ── cfg.lotSize remains an explicit escape hatch ──
{
  const r = condor({ inst: 'NIFTY', capital: 1000000, cfg: { lotSize: 20 } });
  ok(r.lotSize === 20 && r.lotSource === 'cfg.lotSize', 'C1c-5: an explicit cfg.lotSize still wins, and is labelled as such');
  const r2 = condor({ capital: 1000000, cfg: { lotSize: 50 } });
  ok(r2.recommendedLots >= 0 && r2.lotSource === 'cfg.lotSize', 'C1c-5: cfg.lotSize alone is enough — no `inst` required');
}

// ── STRANGLE margin: per-instrument override, and honest provenance ──
{
  const r = S.recommend({ inst: 'NIFTY', capital: 100000, structure: 'STRANGLE', ...STATS, ivPct: 0.5 });
  ok(r.marginPerLot === 130000, 'strangle margin default 130000');
  ok(/global default/.test(r.marginSource) && /NIFTY/.test(r.marginSource),
    'C1c-5: marginSource admits the default is a NIFTY figure — no hidden assumption');
  ok(r.maxLotsByMargin === 0 && r.recommendedLots === 0, '₹1L × 60% util cannot fund one ₹130,000 lot');
  ok(/cannot fund 1 STRANGLE lot/.test(r.reason) && /use a CONDOR/.test(r.reason), 'the reason says so, and suggests the alternative');

  process.env.SIZER_STRANGLE_MARGIN_SENSEX = '90000';
  delete require.cache[require.resolve('../position-sizer.js')];
  const S2 = require('../position-sizer.js');
  const sx = S2.recommend({ inst: 'SENSEX', capital: 1000000, structure: 'STRANGLE', ...STATS, ivPct: 0.5 });
  ok(sx.marginPerLot === 90000, 'C1c-5: SIZER_STRANGLE_MARGIN_SENSEX overrides the NIFTY default');
  ok(sx.marginSource === 'env:SIZER_STRANGLE_MARGIN_SENSEX', 'C1c-5: and marginSource records where it came from');
  const nf = S2.recommend({ inst: 'NIFTY', capital: 1000000, structure: 'STRANGLE', ...STATS, ivPct: 0.5 });
  ok(nf.marginPerLot === 130000, 'C1c-5: a per-instrument override does not leak to other instruments');
  delete process.env.SIZER_STRANGLE_MARGIN_SENSEX;
  delete require.cache[require.resolve('../position-sizer.js')];
}

// ── STRANGLE needs no lot size, so it stays backward compatible ──
{
  const r = S.recommend({ capital: 100000, structure: 'STRANGLE', ...STATS, ivPct: 0.5 });
  ok(r.recommendedLots === 0 && r.marginPerLot === 130000, 'C1c-5: STRANGLE without `inst` still works — it never needed a lot size');
  ok(r.lotSize === null, 'and reports no lot size rather than pretending to have one');
}

// ── the Kelly / IV / cap machinery, now on correct margins ──
{
  const r = condor({ inst: 'NIFTY', capital: 100000 });
  ok(r.maxLotsByMargin === 4, '₹60,000 / ₹13,081 = 4 lots affordable (was 3 at the inflated ₹15,094)');
  ok(r.fullKellyPct === 78 && r.fracKellyPct === 39, 'fullKelly 78%, half-Kelly 39%');
  ok(r.ivScalePct === 70 && r.riskFractionPct === 27, 'IV scale 70% at ivPct 0.5 → risk fraction 27%');
  ok(r.recommendedLots === 1, 'OPEN P5: Kelly rounds to 1 lot here; minLot would force 1 regardless');
  ok(/lot\(s\) affordable/.test(r.reason), 'reason describes the affordable path');
  ok(r.marginSource === 'derived: maxLoss × lotSize × buffer', 'C1c-5: condor margin provenance is explicit');
}
{
  const r = condor({ inst: 'NIFTY', capital: 1000000, maxLossPerUnit: 1 });
  ok(r.marginPerLot === 12000, 'condor margin floors at ₹12,000/lot');
}

// ── IV scaling ──
{
  const at = (iv) => condor({ inst: 'NIFTY', capital: 5000000, ivPct: iv });
  ok(at(0).ivScalePct === 100 && at(1).ivScalePct === 40 && at(0.5).ivScalePct === 70, 'IV scale is linear from 100% to the 40% floor');
  ok(at(-5).ivScalePct === 100 && at(99).ivScalePct === 40, 'ivPct is clamped to [0,1]');
  ok(condor({ inst: 'NIFTY', capital: 5000000, ivPct: undefined }).ivScalePct === 70, 'a missing ivPct defaults to 0.5, not 0');

  const small = (iv) => condor({ inst: 'NIFTY', capital: 500000, ivPct: iv });
  ok(small(1).recommendedLots < small(0).recommendedLots, 'higher IV → strictly fewer lots (below the 25-lot cap)');
  ok(at(1).recommendedLots === at(0).recommendedLots, 'OPEN: above the cap, IV scaling is masked by maxLots — a real blind spot');
}

// ── caps and the no-edge path ──
{
  const r = condor({ inst: 'NIFTY', capital: 100000000, winRate: 0.95, avgWin: 5000, avgLoss: -1000, ivPct: 0 });
  ok(r.recommendedLots === 25, 'recommendedLots is capped at maxLots (25)');
  ok(r.recommendedLots <= r.maxLotsByMargin, 'and never exceeds what margin allows');

  const z = condor({ inst: 'NIFTY', capital: 5000000, winRate: 0.3, avgWin: 100, avgLoss: -100 });
  ok(z.fracKellyPct === 0 && z.recommendedLots === 0, 'a negative-edge strategy trades nothing — minLot does not fire');
}

// ── OPEN P4: hardcoded default strategy stats ──
{
  const withStats = condor({ inst: 'NIFTY', capital: 5000000 });
  const noStats = S.recommend({ inst: 'NIFTY', capital: 5000000, structure: 'CONDOR', maxLossPerUnit: 175, ivPct: 0.5 });
  ok(withStats.fullKellyPct === noStats.fullKellyPct,
    'OPEN P4: omitting winRate/avgWin/avgLoss silently reuses 0.9/2900/-3500');
}

// ── output shape: additive only (backward compatibility) ──
{
  const r = condor({ inst: 'NIFTY', capital: 100000 });
  for (const k of ['recommendedLots', 'maxLotsByMargin', 'marginPerLot', 'fullKellyPct',
                   'fracKellyPct', 'ivScalePct', 'riskFractionPct', 'structure', 'reason']) {
    assert.ok(k in r, `recommend() must keep pre-migration field ${k}`);
  }
  ok(true, 'C1c-5: all 9 pre-migration fields preserved');
  for (const k of ['inst', 'lotSize', 'lotSource', 'marginSource']) assert.ok(k in r, `new field ${k} missing`);
  ok(true, 'C1c-5: 4 provenance fields added (inst, lotSize, lotSource, marginSource)');

  ok(Number.isInteger(r.recommendedLots) && r.recommendedLots >= 0, 'recommendedLots is a non-negative integer');
  ok(S.recommend({}).recommendedLots === 0, 'recommend({}) does not throw and recommends nothing');
  ok(S.recommend({ capital: 0, structure: 'STRANGLE' }).recommendedLots === 0, 'zero capital → zero lots');
  ok(condor({ inst: 'NIFTY', capital: 0 }).recommendedLots === 0, 'zero capital → zero condor lots');
}

// ── the registry, not the sizer, owns the truth ──
{
  for (const i of ['NIFTY', 'BANKNIFTY', 'SENSEX']) {
    assert.strictEqual(condor({ inst: i, capital: 1000000 }).lotSize, registry.lotSize(i), `${i} lot must equal the registry's`);
  }
  ok(true, 'C1c-5: zero drift between the sizer and the Instrument Registry');

  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'position-sizer.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
  ok(!/lotSize:\s*\d+/.test(code), 'C1c-5: no hardcoded lotSize literal survives in executable code');
  ok(/require\(['"]\.\/instrument-registry/.test(src), 'C1c-5: position-sizer requires the Instrument Registry');
}

console.log(`\n${pass} assertions passed`);
