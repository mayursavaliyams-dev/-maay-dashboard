/**
 * strike-resolver — unit tests. Run: node test/strike-resolver.test.js
 *
 * Migration C1c-7. The interval comes from the Instrument Registry, never from an inline
 * `Math.round(spot / 50) * 50`. The headline case is MIDCPNIFTY: its strike interval is
 * 25, so every inlined /50 or /100 in the codebase snaps it to a strike that does not exist.
 */
'use strict';
const assert = require('assert');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };

console.log('strike-resolver (migration C1c-7)');

const R = require('../strike-resolver.js');
const registry = require('../instrument-registry.js');

// ── atm(): rounds to the instrument's own interval ──
{
  ok(R.atm('NIFTY', 24013) === 24000, 'NIFTY 24013 → 24000 (step 50)');
  ok(R.atm('NIFTY', 24026) === 24050, 'NIFTY 24026 → 24050 (rounds up past the half-step)');
  ok(R.atm('NIFTY', 24025) === 24050, 'NIFTY exactly on the half-step rounds up (Math.round)');
  ok(R.atm('BANKNIFTY', 52040) === 52000, 'BANKNIFTY 52040 → 52000 (step 100)');
  ok(R.atm('SENSEX', 80070) === 80100, 'SENSEX 80070 → 80100 (step 100)');
  ok(R.atm('nifty', 24013) === 24000, 'lookup is case-insensitive');
}

// ── the MIDCPNIFTY case — why this module exists ──
{
  process.env.MIDCPNIFTY_TRADING_ENABLED = 'true';
  delete require.cache[require.resolve('../instrument-registry.js')];
  delete require.cache[require.resolve('../strike-resolver.js')];
  const Rm = require('../strike-resolver.js');
  const reg = require('../instrument-registry.js');

  ok(reg.step('MIDCPNIFTY') === 25, 'MIDCPNIFTY strike interval is 25, not 50');
  ok(Rm.atm('MIDCPNIFTY', 13060) === 13050, 'MIDCPNIFTY 13060 → 13050 on a 25-point lattice');
  ok(Math.round(13060 / 50) * 50 === 13050, '… the inlined /50 happens to agree here …');
  ok(Rm.atm('MIDCPNIFTY', 13040) === 13050 && Math.round(13040 / 50) * 50 === 13050, '… and here …');
  ok(Rm.atm('MIDCPNIFTY', 13030) === 13025 && Math.round(13030 / 50) * 50 === 13050,
    '… but at 13030 the inlined /50 gives 13050 while the true strike is 13025 — a non-existent contract');
  ok(Rm.isValidStrike('MIDCPNIFTY', 13025) === true, 'C1c-7: 13025 IS a real MIDCPNIFTY strike');
  ok(Rm.isValidStrike('NIFTY', 13025) === false, 'C1c-7: 13025 is NOT a real NIFTY strike (step 50)');

  delete process.env.MIDCPNIFTY_TRADING_ENABLED;
  delete require.cache[require.resolve('../instrument-registry.js')];
  delete require.cache[require.resolve('../strike-resolver.js')];
}

// ── fail-closed, exactly like the registry ──
{
  ok(R.atm('FINNIFTY', 24000) === null, 'a trading-disabled instrument yields null, not a guessed strike');
  ok(R.atm('NIFTYNEXT50', 24000) === null, 'an unknown instrument yields null');
  ok(R.atm('NIFTY', 0) === null && R.atm('NIFTY', -5) === null, 'non-positive spot → null');
  ok(R.atm('NIFTY', NaN) === null && R.atm('NIFTY', 'abc') === null, 'non-numeric spot → null');
  ok(R.atm(null, 24000) === null && R.atm(undefined, 24000) === null, 'null/undefined instrument → null');
  ok(R.strikes('FINNIFTY', 24000, 3).length === 0, 'strikes() on a disabled instrument → []');
  ok(R.strikesByPercent('FINNIFTY', 24000, 8).length === 0, 'strikesByPercent() on a disabled instrument → []');
  ok(R.resolve('FINNIFTY', 24000, 1) === null, 'resolve() on a disabled instrument → null');
  ok(R.offsetOf('FINNIFTY', 24000, 24100) === null, 'offsetOf() on a disabled instrument → null');
  ok(R.isValidStrike('FINNIFTY', 24000) === false, 'isValidStrike() on a disabled instrument → false');
}

// ── resolve(): offsets in intervals ──
{
  ok(R.resolve('NIFTY', 24013, 0) === 24000, 'offset 0 is ATM');
  ok(R.resolve('NIFTY', 24013, 2) === 24100, 'offset +2 → ATM + 2 × 50');
  ok(R.resolve('NIFTY', 24013, -1) === 23950, 'offset -1 → ATM − 50');
  ok(R.resolve('BANKNIFTY', 52040, 3) === 52300, 'BANKNIFTY offset +3 → ATM + 3 × 100');
  ok(R.resolve('NIFTY', 24013) === 24000, 'offset defaults to 0');
  ok(R.resolve('NIFTY', 24013, 1.5) === null, 'a fractional offset is rejected, not silently floored');
}

// ── floor / ceil ──
{
  ok(R.floorStrike('NIFTY', 24049) === 24000, 'floorStrike stays at or below spot');
  ok(R.ceilStrike('NIFTY', 24001) === 24050, 'ceilStrike stays at or above spot');
  ok(R.floorStrike('NIFTY', 24000) === 24000 && R.ceilStrike('NIFTY', 24000) === 24000, 'exactly on a strike, both agree');
  ok(R.floorStrike('NIFTY', 24049) <= 24049 && R.ceilStrike('NIFTY', 24001) >= 24001, 'the invariant holds');
}

// ── strikes(): symmetric ladder ──
{
  const s = R.strikes('NIFTY', 24013, 2);
  ok(s.length === 5, '±2 intervals → 5 strikes');
  ok(s[0] === 23900 && s[2] === 24000 && s[4] === 24100, 'the ladder is centred on ATM');
  ok(s.every((k, i) => i === 0 || k - s[i - 1] === 50), 'the ladder is uniformly spaced by the interval');
  ok(R.strikes('NIFTY', 24013, 0).length === 1, 'half=0 → just the ATM strike');
  ok(R.strikes('NIFTY', 24013, -1).length === 0, 'a negative half is rejected');
  ok(R.strikes('NIFTY', 24013, 1.5).length === 0, 'a fractional half is rejected');
  ok(R.strikes('NIFTY', 24013).length === 21, 'half defaults to 10 → 21 strikes');
  ok(R.strikes('NIFTY', 24013, 3).every((k) => R.isValidStrike('NIFTY', k)), 'every generated strike is a real strike');
}

// ── strikesByPercent(): replaces pop-seller's generateStrikes ──
{
  const s = R.strikesByPercent('NIFTY', 24000, 8);
  ok(s[0] === Math.round(24000 * 0.92 / 50) * 50, 'the lower bound is spot × 0.92, snapped to the lattice');
  ok(s[s.length - 1] === Math.round(24000 * 1.08 / 50) * 50, 'the upper bound is spot × 1.08, snapped');
  ok(s.every((k) => R.isValidStrike('NIFTY', k)), 'every strike lies on the lattice');
  ok(s.includes(24000), 'the ATM strike is included');
  ok(R.strikesByPercent('NIFTY', 24000, 0).length === 0, 'a zero range is rejected');
  ok(R.strikesByPercent('NIFTY', 24000, -8).length === 0, 'a negative range is rejected');
}

// ── offsetOf(): the inverse of resolve() ──
{
  ok(R.offsetOf('NIFTY', 24013, 24100) === 2, 'offsetOf inverts resolve');
  ok(R.offsetOf('NIFTY', 24013, 23950) === -1, 'and it is signed');
  ok(R.offsetOf('NIFTY', 24013, 24000) === 0, 'ATM is offset 0');
  for (const off of [-3, -1, 0, 2, 5]) {
    assert.strictEqual(R.offsetOf('NIFTY', 24013, R.resolve('NIFTY', 24013, off)), off, `round-trip offset ${off}`);
  }
  ok(true, 'resolve() and offsetOf() round-trip for every offset tested');
}

// ── the interval is never hardcoded here ──
{
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'strike-resolver.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
  ok(!/\/\s*(25|50|100)\s*\)\s*\*\s*(25|50|100)/.test(code), 'C1c-7: no inline `/50)*50` survives in executable code');
  ok(!/step\s*=\s*\d+/.test(code), 'C1c-7: no hardcoded step literal');
  ok(/require\(['"]\.\/instrument-registry/.test(src), 'C1c-7: the interval comes from the registry');
  for (const i of ['NIFTY', 'BANKNIFTY', 'SENSEX']) {
    assert.strictEqual(R.atm(i, 50000), Math.round(50000 / registry.step(i)) * registry.step(i), `${i} agrees with the registry`);
  }
  ok(true, 'C1c-7: zero drift between strike-resolver and the Instrument Registry');
}

console.log(`\n${pass} assertions passed`);
