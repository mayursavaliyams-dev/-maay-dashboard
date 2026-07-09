/**
 * instrument-registry — unit tests. Run: node test/instrument-registry.test.js
 *
 * Guards the SINGLE SOURCE OF TRUTH for contract metadata. The lot sizes here are
 * broker-verified (Upstox contract master, 2026-07-09). If this suite ever fails,
 * a P&L somewhere is silently wrong.
 */
'use strict';
const assert = require('assert');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };

console.log('instrument-registry');

// isolate env so an operator override in .env can't make this suite lie
for (const k of ['NIFTY_LOT_SIZE', 'BANKNIFTY_LOT_SIZE', 'SENSEX_LOT_SIZE']) delete process.env[k];
const R = require('../instrument-registry');

// ── broker-verified lot sizes (the whole point of this module) ──
ok(R.lotSize('NIFTY') === 65, 'NIFTY lot size = 65 (broker contract master)');
ok(R.lotSize('BANKNIFTY') === 30, 'BANKNIFTY lot size = 30 (broker contract master)');
ok(R.lotSize('SENSEX') === 20, 'SENSEX lot size = 20 (broker contract master)');

// ── strike steps ──
ok(R.step('NIFTY') === 50, 'NIFTY step 50');
ok(R.step('BANKNIFTY') === 100, 'BANKNIFTY step 100');
ok(R.step('SENSEX') === 100, 'SENSEX step 100');

// ── segments ──
ok(R.segment('NIFTY') === 'NSE_FNO', 'NIFTY segment NSE_FNO');
ok(R.segment('SENSEX') === 'BSE_FNO', 'SENSEX segment BSE_FNO');

// ── case-insensitive + unknown handling ──
ok(R.lotSize('nifty') === 65, 'lookup is case-insensitive');
ok(R.lotSize('FINNIFTY') === null, 'unknown instrument → null (not a silent default)');
ok(R.step('FINNIFTY') === null, 'unknown step → null');
ok(R.getMeta('FINNIFTY') === null, 'unknown getMeta → null');
ok(R.lotSize(undefined) === null && R.lotSize(null) === null, 'null/undefined → null');

// ── getMeta shape ──
{
  const m = R.getMeta('BANKNIFTY');
  ok(m.inst === 'BANKNIFTY' && m.lotSize === 30 && m.step === 100 && m.segment === 'NSE_FNO', 'getMeta returns the full record');
}
ok(R.instruments().sort().join(',') === 'BANKNIFTY,NIFTY,SENSEX', 'instruments() lists all three');

// ── provenance is recorded (auditability requirement) ──
{
  const p = R.PROVENANCE;
  ok(/upstox/i.test(p.source) && /contract/i.test(p.source), 'provenance names the broker contract master');
  ok(p.verifiedAt === '2026-07-09', 'provenance carries the verification date');
  ok(p.lotSize.NIFTY === 65, 'provenance snapshot matches the active value');
}

// ── env override is honoured (operator intent) but does not corrupt defaults ──
{
  process.env.NIFTY_LOT_SIZE = '75';
  delete require.cache[require.resolve('../instrument-registry')];
  const R2 = require('../instrument-registry');
  ok(R2.lotSize('NIFTY') === 75, 'env override wins when set');
  ok(R2.VERIFIED_LOT_SIZE.NIFTY === 65, 'verified constant is NOT mutated by the override');
  delete process.env.NIFTY_LOT_SIZE;
  delete require.cache[require.resolve('../instrument-registry')];
}
{
  // an invalid override must fall back, never produce NaN/0 into money math
  process.env.SENSEX_LOT_SIZE = 'abc';
  delete require.cache[require.resolve('../instrument-registry')];
  const R3 = require('../instrument-registry');
  ok(R3.lotSize('SENSEX') === 20, 'garbage env override falls back to verified value');
  process.env.SENSEX_LOT_SIZE = '0';
  delete require.cache[require.resolve('../instrument-registry')];
  const R4 = require('../instrument-registry');
  ok(R4.lotSize('SENSEX') === 20, 'zero env override falls back (never 0 units)');
  delete process.env.SENSEX_LOT_SIZE;
  delete require.cache[require.resolve('../instrument-registry')];
}

// ── verifyAgainstContracts — the drift alarm ──
{
  const Rv = require('../instrument-registry');
  ok(Rv.verifyAgainstContracts('NIFTY', [{ lot_size: 65 }, { lot_size: 65 }]).ok, 'matching contract master → ok');
  const bad = Rv.verifyAgainstContracts('NIFTY', [{ lot_size: 75 }]);
  ok(!bad.ok && bad.expected === 65 && bad.found[0] === 75, 'drift detected and reported with both values');
  const multi = Rv.verifyAgainstContracts('NIFTY', [{ lot_size: 65 }, { lot_size: 75 }]);
  ok(!multi.ok && /multiple/.test(multi.reason), 'multiple distinct lot sizes → not ok');
  const none = Rv.verifyAgainstContracts('NIFTY', []);
  ok(!none.ok && /no lot_size/.test(none.reason), 'empty contract list → not ok, explicit reason');
}

console.log(`\n${pass} assertions passed`);
