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
// NOTE (C1c-1): FINNIFTY is now KNOWN but tradingEnabled:false, so it still returns null
// from the trading surface. Use a symbol the registry has genuinely never heard of to
// test the unknown path, so these two cases can never be conflated again.
ok(R.lotSize('nifty') === 65, 'lookup is case-insensitive');
ok(R.lotSize('NIFTYNEXT50') === null, 'unknown instrument → null (not a silent default)');
ok(R.step('NIFTYNEXT50') === null, 'unknown step → null');
ok(R.getMeta('NIFTYNEXT50') === null, 'unknown getMeta → null');
ok(R.catalog('NIFTYNEXT50') === null, 'unknown catalog → null');
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

// ════════════════════════════════════════════════════════════════════════════
//  MIGRATION C1c-1 — FINNIFTY / MIDCPNIFTY / BANKEX + tickSize + tradingEnabled
//  Broker re-queried live on 2026-07-09 (requirement 1); no cached values used.
// ════════════════════════════════════════════════════════════════════════════
const FRESH = () => { delete require.cache[require.resolve('../instrument-registry')]; return require('../instrument-registry'); };

// ── req 7a: registry loading ──
{
  const Rc = FRESH();
  ok(Rc.allInstruments().sort().join(',') === 'BANKEX,BANKNIFTY,FINNIFTY,MIDCPNIFTY,NIFTY,SENSEX',
    'C1c-1: catalog loads all six instruments');
  ok(Object.isFrozen(Rc.INSTRUMENTS), 'C1c-1: catalog is frozen (cannot be mutated at runtime)');
  ok(Object.isFrozen(Rc.INSTRUMENTS.NIFTY), 'C1c-1: each record is frozen');
  for (const i of Rc.allInstruments()) {
    const c = Rc.catalog(i);
    for (const f of ['exchange', 'segment', 'lotSize', 'tickSize', 'tickRaw', 'strikeInterval',
                     'expiryType', 'tradingEnabled', 'lastVerifiedAt', 'verificationSource']) {
      assert.ok(c[f] !== undefined, `${i}.${f} missing`);
    }
  }
  ok(true, 'C1c-1: every instrument stores all 10 required fields (req 3)');
}

// ── req 7b: lot size lookup, from the broker contract master ──
{
  const Rc = FRESH();
  ok(Rc.catalog('FINNIFTY').lotSize === 60, 'C1c-1: FINNIFTY lot 60 (broker) — pop-seller.js:18 says 65, corrected in C1c-3');
  ok(Rc.catalog('MIDCPNIFTY').lotSize === 120, 'C1c-1: MIDCPNIFTY lot 120');
  ok(Rc.catalog('BANKEX').lotSize === 30, 'C1c-1: BANKEX lot 30');
}

// ── req 7c: tick size lookup — paise vs rupees never conflated ──
{
  const Rc = FRESH();
  ok(Rc.tickSize('NIFTY') === 0.05, 'C1c-1: tickSize is RUPEES (0.05)');
  ok(Rc.tickRaw('NIFTY') === 5, 'C1c-1: tickRaw is the broker value verbatim (5 paise)');
  ok(Rc.tickSize('NIFTY') === Rc.tickRaw('NIFTY') / 100, 'C1c-1: tickSize = tickRaw / 100');
  for (const i of Rc.allInstruments()) {
    assert.strictEqual(Rc.catalog(i).tickSize, 0.05, `${i} tickSize`);
    assert.strictEqual(Rc.catalog(i).tickRaw, 5, `${i} tickRaw`);
  }
  ok(true, 'C1c-1: all six instruments carry tick 5 paise / ₹0.05');
  ok(Rc.PROVENANCE.tickUnit.includes('paise'), 'C1c-1: provenance records that the broker reports paise');
}

// ── req 7d: strike interval lookup ──
{
  const Rc = FRESH();
  ok(Rc.catalog('MIDCPNIFTY').strikeInterval === 25, 'C1c-1: MIDCPNIFTY strike interval 25 (NOT 50 — inlined roundings would mis-round it)');
  ok(Rc.catalog('FINNIFTY').strikeInterval === 50, 'C1c-1: FINNIFTY strike interval 50');
  ok(Rc.catalog('BANKEX').strikeInterval === 100, 'C1c-1: BANKEX strike interval 100');
  ok(Rc.strikeInterval('NIFTY') === Rc.step('NIFTY'), 'C1c-1: strikeInterval() is an alias of step()');
}

// ── req 7e: tradingEnabled behaviour — the anti-widening guarantee ──
{
  const Rc = FRESH();
  ok(Rc.isTradingEnabled('NIFTY') && Rc.isTradingEnabled('BANKNIFTY') && Rc.isTradingEnabled('SENSEX'),
    'C1c-1: the three pre-existing instruments remain enabled');
  for (const i of ['FINNIFTY', 'MIDCPNIFTY', 'BANKEX']) {
    assert.strictEqual(Rc.isTradingEnabled(i), false, `${i} must ship disabled`);
  }
  ok(true, 'C1c-1: every NEWLY ADDED instrument defaults to tradingEnabled:false (req 4)');

  // The whole point: three engines gate on `lotSize(inst) == null`.
  ok(Rc.lotSize('FINNIFTY') === null, 'C1c-1: disabled instrument → lotSize null (engines refuse to open)');
  ok(Rc.step('FINNIFTY') === null && Rc.tickSize('FINNIFTY') === null && Rc.getMeta('FINNIFTY') === null,
    'C1c-1: the whole trading surface is fail-closed for a disabled instrument');
  ok(Rc.catalog('FINNIFTY') !== null && Rc.catalog('FINNIFTY').lotSize === 60,
    'C1c-1: but the catalog still exposes its verified metadata (reading ≠ trading)');

  ok(Rc.instruments().sort().join(',') === 'BANKNIFTY,NIFTY,SENSEX',
    'C1c-1: instruments() did NOT widen — still exactly the original three (req 5)');
  ok(Rc.allInstruments().length === 6 && Rc.instruments().length === 3,
    'C1c-1: catalog 6, trading surface 3');
}

// ── req 7e (cont.): explicit opt-in works, and only when explicit ──
{
  process.env.FINNIFTY_TRADING_ENABLED = 'true';
  const Ron = FRESH();
  ok(Ron.isTradingEnabled('FINNIFTY') === true, 'C1c-1: explicit env opt-in enables the instrument');
  ok(Ron.lotSize('FINNIFTY') === 60, 'C1c-1: once enabled, lotSize is the BROKER value 60 (never 65)');
  ok(Ron.step('FINNIFTY') === 50 && Ron.tickSize('FINNIFTY') === 0.05, 'C1c-1: full trading surface opens with it');
  ok(Ron.instruments().sort().join(',') === 'BANKNIFTY,FINNIFTY,NIFTY,SENSEX', 'C1c-1: instruments() widens ONLY on explicit opt-in');
  delete process.env.FINNIFTY_TRADING_ENABLED;

  for (const v of ['false', 'TRUE_ish', '1', 'yes', '']) {
    process.env.BANKEX_TRADING_ENABLED = v;
    const Rx = FRESH();
    assert.strictEqual(Rx.isTradingEnabled('BANKEX'), false, `BANKEX must stay disabled for env value ${JSON.stringify(v)}`);
  }
  delete process.env.BANKEX_TRADING_ENABLED;
  ok(true, 'C1c-1: only the exact string "true" enables — "1"/"yes"/""/garbage do not');
}

// ── req 7f: unknown instrument handling ──
{
  const Rc = FRESH();
  for (const bad of ['NIFTYNEXT50', 'RELIANCE', '', null, undefined, 'nifty50']) {
    assert.strictEqual(Rc.lotSize(bad), null, `lotSize(${JSON.stringify(bad)})`);
    assert.strictEqual(Rc.catalog(bad), null, `catalog(${JSON.stringify(bad)})`);
    assert.strictEqual(Rc.isTradingEnabled(bad), false, `isTradingEnabled(${JSON.stringify(bad)})`);
  }
  ok(true, 'C1c-1: unknown instruments → null everywhere, never a silent default');
  const v = Rc.verifyAgainstContracts('NIFTYNEXT50', [{ lot_size: 10 }]);
  ok(!v.ok && /unknown instrument/.test(v.reason), 'C1c-1: drift check on an unknown instrument reports it, does not throw');
}

// ── drift detection must work for DISABLED instruments too (preflight, C1c-6) ──
{
  const Rc = FRESH();
  ok(Rc.verifyAgainstContracts('FINNIFTY', [{ lot_size: 60 }]).ok,
    'C1c-1: a disabled instrument can still be validated against the broker');
  const d = Rc.verifyAgainstContracts('FINNIFTY', [{ lot_size: 65 }]);
  ok(!d.ok && d.expected === 60 && d.found[0] === 65,
    'C1c-1: had pop-seller\'s 65 been the registry value, the drift alarm would fire');
}

// ── backward compatibility: every pre-C1c-1 export still exists and behaves ──
{
  const Rc = FRESH();
  for (const fn of ['lotSize', 'step', 'segment', 'getMeta', 'instruments', 'verifyAgainstContracts']) {
    assert.strictEqual(typeof Rc[fn], 'function', `${fn} export missing`);
  }
  for (const c of ['PROVENANCE', 'VERIFIED_LOT_SIZE', 'VERIFIED_STEP', 'SEGMENT']) {
    assert.ok(Rc[c], `${c} export missing`);
  }
  ok(true, 'C1c-1: all pre-migration exports preserved (req 10)');
  ok(Rc.VERIFIED_LOT_SIZE.NIFTY === 65 && Rc.VERIFIED_STEP.BANKNIFTY === 100 && Rc.SEGMENT.SENSEX === 'BSE_FNO',
    'C1c-1: the legacy projections still resolve to the same values');
  const m = Rc.getMeta('BANKNIFTY');
  ok(m.inst === 'BANKNIFTY' && m.lotSize === 30 && m.step === 100 && m.segment === 'NSE_FNO',
    'C1c-1: getMeta keeps its original four fields (superset, not a reshape)');
}

// ── segment vocabularies are BOTH recorded (the H3 failover landmine) ──
{
  const Rc = FRESH();
  ok(Rc.segment('NIFTY') === 'NSE_FNO' && Rc.brokerSegment('NIFTY') === 'NSE_FO',
    'C1c-1: internal segment vs broker segment are stored separately');
  ok(Rc.exchange('SENSEX') === 'BSE' && Rc.segment('SENSEX') === 'BSE_FNO' && Rc.brokerSegment('SENSEX') === 'BSE_FO',
    'C1c-1: SENSEX exchange/segment/brokerSegment all recorded');
}

// ── expiryType: post-SEBI reality ──
{
  const Rc = FRESH();
  ok(Rc.catalog('NIFTY').expiryType === 'WEEKLY_AND_MONTHLY', 'C1c-1: NIFTY has a weekly expiry');
  ok(Rc.catalog('SENSEX').expiryType === 'WEEKLY_AND_MONTHLY', 'C1c-1: SENSEX has a weekly expiry');
  for (const i of ['BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'BANKEX']) {
    assert.strictEqual(Rc.catalog(i).expiryType, 'MONTHLY', `${i} expiryType`);
  }
  ok(true, 'C1c-1: BANKNIFTY/FINNIFTY/MIDCPNIFTY/BANKEX are MONTHLY-only (no weekly, post-SEBI)');
}

// ── provenance on every record (auditability) ──
{
  const Rc = FRESH();
  for (const i of Rc.allInstruments()) {
    const c = Rc.catalog(i);
    assert.strictEqual(c.lastVerifiedAt, '2026-07-09', `${i} lastVerifiedAt`);
    assert.ok(/upstox/i.test(c.verificationSource) && /contract/i.test(c.verificationSource), `${i} verificationSource`);
  }
  ok(true, 'C1c-1: every record carries lastVerifiedAt + verificationSource (req 3)');
}

console.log(`\n${pass} assertions passed`);
