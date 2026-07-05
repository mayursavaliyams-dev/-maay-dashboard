/**
 * GEX/OI skew (Phase 2) — unit tests. Run: node test/gex-skew.test.js
 */
'use strict';
const assert = require('assert');
const { computeGEX, bsGamma } = require('../gex-skew');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };

console.log('GEX / OI skew (Phase 2)');

// bsGamma sanity: peaks near ATM, positive, zero on bad input.
{
  const gAtm = bsGamma(24000, 24000, 3 / 365, 0.14);
  const gOtm = bsGamma(24000, 25000, 3 / 365, 0.14);
  ok(gAtm > 0, 'ATM gamma positive');
  ok(gAtm > gOtm, 'gamma peaks near ATM (ATM > far OTM)');
  ok(bsGamma(0, 24000, 0.01, 0.14) === 0, 'bad spot → gamma 0');
  ok(bsGamma(24000, 24000, 0, 0.14) === 0, 'zero T → gamma 0');
}

// Build a symmetric chain around 24000.
const strikes = [];
for (let k = 23000; k <= 25000; k += 100) strikes.push(k);
const sym = strikes.map(k => ({ strike: k, ceOI: 1000, peOI: 1000 }));

{
  const r = computeGEX({ spot: 24000, dte: 3, iv: 0.14, lotSize: 75, chain: sym });
  ok(r.ok, 'symmetric chain computes');
  ok(r.pcr === 1, 'symmetric OI → PCR 1');
  ok(Math.abs(r.skew) <= 5, 'symmetric chain → ~neutral skew');
  ok(r.callWall != null && r.putWall != null, 'walls identified');
}

// Heavy PUT OI below spot → support → upward skew + PCR>1.
{
  const chain = strikes.map(k => ({ strike: k, ceOI: 800, peOI: k < 24000 ? 4000 : 800 }));
  const r = computeGEX({ spot: 24000, dte: 3, iv: 0.14, chain });
  ok(r.pcr > 1, 'heavy put OI → PCR > 1');
  ok(r.skew > 0, 'heavy put support below → upward skew');
  ok(r.putWall < 24000, 'put wall sits below spot');
}

// Heavy CALL OI above spot → resistance → downward skew.
{
  const chain = strikes.map(k => ({ strike: k, ceOI: k > 24000 ? 4000 : 800, peOI: 800 }));
  const r = computeGEX({ spot: 24000, dte: 3, iv: 0.14, chain });
  ok(r.pcr < 1, 'heavy call OI → PCR < 1');
  ok(r.skew < 0, 'heavy call resistance above → downward skew');
  ok(r.callWall > 24000, 'call wall sits above spot');
}

// regimeLabel is RANGE or TREND, skew bounded.
{
  const r = computeGEX({ spot: 24000, dte: 3, chain: sym });
  ok(r.regimeLabel === 'RANGE' || r.regimeLabel === 'TREND', 'regimeLabel is RANGE or TREND');
  ok(r.skew >= -100 && r.skew <= 100, 'skew bounded to [-100,100]');
}

// guards
ok(!computeGEX({ spot: 0, chain: sym }).ok, 'no spot → not ok');
ok(!computeGEX({ spot: 24000, chain: [] }).ok, 'empty chain → not ok');

console.log(`\n${pass} assertions passed`);
