/**
 * strangle-engine — first test suite. Run: node test/strangle-engine.test.js
 *
 * Guards MIGRATION C1: the closed-trade P&L must apply the broker-verified contract
 * lot multiplier and per-leg transaction costs, while every legacy record and the
 * legacy formula's value are preserved verbatim.
 */
'use strict';
const assert = require('assert');
const os = require('os'), path = require('path'), fs = require('fs');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const near = (a, b, t, m) => { assert.ok(Math.abs(a - b) <= t, `${m} (got ${a}, want ~${b})`); console.log('  ✓ ' + m); pass++; };

console.log('strangle-engine (migration C1)');

// Isolate: no env lot overrides, engine writes into a temp cwd-independent state.
for (const k of ['NIFTY_LOT_SIZE', 'BANKNIFTY_LOT_SIZE', 'SENSEX_LOT_SIZE']) delete process.env[k];
const StrangleEngine = require('../strangle-engine.js');
const { roundTripCharges } = require('../charges.js');
const registry = require('../instrument-registry.js');

// Build a chain the engine will accept: rows at every step around ATM.
function chainOf(atm, step, priceAt, expiry = '2099-01-01') {
  const rows = [];
  for (let k = atm - 20 * step; k <= atm + 20 * step; k += step) {
    rows.push({ strike: k, ce: { ltp: priceAt(k, 'ce') }, pe: { ltp: priceAt(k, 'pe') } });
  }
  return { atm, interval: step, expiry, rows };
}

// A fresh engine with the trade/IV files pointed at a throwaway dir.
function freshEngine(cfg = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'strangle-'));
  const e = new StrangleEngine(Object.assign({ enabled: true, ivPctMin: 0, tailSafePct: 2, qtyPerLeg: 1 }, cfg));
  e._tradesFile = path.join(tmp, 'trades.json');
  e._ivFile = path.join(tmp, 'iv.json');
  e._allTrades = [];
  e._logMigration = () => {};          // don't touch the real migration log from tests
  e._ftLogger = { logTrade() {}, status() { return {}; } };
  return e;
}

// ── the lot multiplier is applied, and it is the broker-verified one ──
{
  const e = freshEngine();
  const atm = 24000, step = 50;
  // rich premiums so a strangle opens; ATM straddle drives the IV proxy
  e.update('NIFTY', chainOf(atm, step, (k) => (k === atm ? 200 : 60)));
  const pos = e._open.get('NIFTY');
  ok(pos && pos.structure === 'STRANGLE', 'a naked strangle opened (tailSafe disabled)');
  ok(pos.qty === 1, 'qty is in LOTS (1)');

  // premium decays to ~0 → take profit fires
  e.update('NIFTY', chainOf(atm, step, () => 0.05));
  const t = e._closed[0];
  ok(t && t.reason === 'TAKE_PROFIT', 'take-profit closed the position');
  ok(t.calcVersion === 2, 'closed record is calcVersion 2');
  ok(t.lot === 65, 'NIFTY lot 65 taken from instrument-registry (broker-verified)');
  ok(t.units === t.qty * t.lot, 'units = lots × lotSize');

  // the arithmetic must be exactly gross − charges
  near(t.gross, +(t.pnlPerUnit * t.units).toFixed(2), 0.011, 'gross = pnlPerUnit × units');
  near(t.pnlAbs, +(t.gross - t.charges).toFixed(2), 0.011, 'pnlAbs = gross − charges');
  ok(t.charges > 0, 'transaction costs are non-zero (v1 charged nothing)');
  ok(t.pnlAbs < t.gross, 'net P&L is strictly below gross');
}

// ── legacy value preserved on the record, and it is the OLD formula exactly ──
{
  const e = freshEngine();
  const atm = 24000, step = 50;
  e.update('NIFTY', chainOf(atm, step, (k) => (k === atm ? 200 : 60)));
  e.update('NIFTY', chainOf(atm, step, () => 0.05));
  const t = e._closed[0];
  near(t.pnlAbsLegacy, +(t.pnlPerUnit * t.qty).toFixed(2), 0.011, 'pnlAbsLegacy === pnlPerUnit × lots (the v1 formula)');
  ok(t.pnlAbs !== t.pnlAbsLegacy, 'corrected P&L differs from legacy (the bug is real)');
  ok(Math.abs(t.pnlAbs) > Math.abs(t.pnlAbsLegacy), 'corrected magnitude is larger — v1 was understated');
  ok(typeof t.calcMethod === 'string' && /lotSize/.test(t.calcMethod), 'calcMethod names the method');
}

// ── charges match the per-leg method used by agents-engine (comparability) ──
{
  const e = freshEngine();
  const atm = 24000, step = 50;
  e.update('NIFTY', chainOf(atm, step, (k) => (k === atm ? 200 : 60)));
  const pos = e._open.get('NIFTY');
  const entryCe = pos.ce.entry, entryPe = pos.pe.entry;
  e.update('NIFTY', chainOf(atm, step, () => 0.05));
  const t = e._closed[0];
  const units = t.units;
  const expected = +[
    roundTripCharges(Math.max(0.05, entryCe), 0.05, units).total,
    roundTripCharges(Math.max(0.05, entryPe), 0.05, units).total,
  ].reduce((a, b) => a + b, 0).toFixed(2);
  near(t.charges, expected, 0.02, 'charges = Σ per-leg roundTripCharges(entry, exit, units)');
}

// ── SENSEX uses its own lot (20), not NIFTY's ──
{
  const e = freshEngine();
  const atm = 78000, step = 100;
  e.update('SENSEX', chainOf(atm, step, (k) => (k === atm ? 400 : 120)));
  ok(e._open.get('SENSEX'), 'SENSEX strangle opened');
  e.update('SENSEX', chainOf(atm, step, () => 0.05));
  const t = e._closed[0];
  ok(t.lot === 20 && t.units === t.qty * 20, 'SENSEX lot 20 applied');
  ok(t.lot !== registry.lotSize('NIFTY'), 'SENSEX lot is not NIFTY lot');
}

// ── a condor charges all FOUR legs and respects the max-loss cap ──
{
  const e = freshEngine({ forceCondor: true, wingPts: 200 });
  const atm = 24000, step = 50;
  e.update('NIFTY', chainOf(atm, step, (k) => (k === atm ? 200 : 60)));
  const pos = e._open.get('NIFTY');
  ok(pos && pos.structure === 'CONDOR' && pos.ceWing && pos.peWing, 'forceCondor opened a 4-leg condor');
  const twoLeg = e._structureCharges({ structure: 'STRANGLE', ce: pos.ce, pe: pos.pe }, 65);
  const fourLeg = e._structureCharges(pos, 65);
  ok(fourLeg > twoLeg, 'condor (4 legs) costs more than strangle (2 legs)');

  // blow through the stop: shorts explode in value
  e.update('NIFTY', chainOf(atm, step, (k) => (Math.abs(k - atm) <= 400 ? 500 : 1)));
  const t = e._closed[0];
  ok(t && t.reason === 'STOP', 'stop fired');
  ok(t.calcVersion === 2 && t.charges > 0, 'stop close is also v2 with charges');
  near(t.gross, +(t.pnlPerUnit * t.units).toFixed(2), 0.011, 'condor gross respects the maxLoss-capped pnlPerUnit');
  ok(t.pnlPerUnit >= -pos.maxLoss - 1e-9, 'pnlPerUnit never exceeds the condor max loss');
}

// ── unknown instrument: NO silent guess — legacy math retained and flagged ──
{
  const e = freshEngine();
  const atm = 50000, step = 100;
  e.update('FINNIFTY', chainOf(atm, step, (k) => (k === atm ? 300 : 90)));
  ok(e._open.get('FINNIFTY'), 'engine opened on an unknown instrument');
  e.update('FINNIFTY', chainOf(atm, step, () => 0.05));
  const t = e._closed[0];
  ok(t.lot === null, 'unknown instrument → lot null, not a guessed default');
  ok(t.calcVersion === 1 && /fallback/.test(t.calcMethod), 'flagged as v1-fallback, not silently mislabelled v2');
  ok(t.pnlAbs === t.pnlAbsLegacy && t.charges === 0, 'legacy math retained verbatim when lot is unknown');
}

// ── status(): historical v1 records are preserved and reported separately ──
{
  const e = freshEngine();
  // simulate two pre-migration records exactly as they exist on disk today
  e._allTrades = [
    { inst: 'NIFTY', date: '2026-07-07', structure: 'CONDOR', pnlAbs: 0.5, pnlPerUnit: 0.5, reason: 'TAKE_PROFIT' },
    { inst: 'SENSEX', date: '2026-07-08', structure: 'CONDOR', pnlAbs: -23.85, pnlPerUnit: -23.85, reason: 'STOP' },
  ];
  const before = JSON.stringify(e._allTrades);
  const s = e.status();

  ok(JSON.stringify(e._allTrades) === before, 'historical records are NOT mutated by status()');
  ok(s.allTime.trades === 2, 'legacy trades still counted in allTime.trades');
  near(s.allTime.netPnl, -23.35, 0.011, 'allTime.netPnl unchanged for legacy-only data (backward compatible)');

  const c = s.allTime.calc;
  ok(c.legacy.trades === 2 && c.current.trades === 0, 'calc splits legacy vs current correctly');
  near(c.legacy.netPnl, -23.35, 0.011, 'legacy bucket carries the legacy sum');
  ok(c.mixed === false, 'not mixed when there are no v2 trades yet');
  ok(/NO lot multiplier/.test(c.legacy.method), 'legacy method string states what was wrong');
  ok(s.pnlCalcVersion === 2 && /lotSize/.test(s.pnlCalcMethod), 'status advertises the active calc version');

  // now add a v2 trade → report must flag the mix
  e._allTrades.push({ inst: 'NIFTY', date: '2026-07-09', pnlAbs: 900, gross: 1000, charges: 100, calcVersion: 2 });
  const s2 = e.status();
  ok(s2.allTime.calc.mixed === true, 'mixed flag flips once both versions exist');
  ok(s2.allTime.calc.current.trades === 1 && s2.allTime.calc.current.netPnl === 900, 'current bucket isolates v2');
  ok(s2.allTime.calc.current.charges === 100 && s2.allTime.calc.current.grossPnl === 1000, 'current bucket exposes gross + charges');
  ok(/mixed/.test(s2.allTime.calc.note), 'note warns the raw netPnl is mixed');
}

// ── backward compatibility: every field existing consumers read is still present ──
{
  const e = freshEngine();
  e._allTrades = [{ inst: 'NIFTY', date: '2026-07-07', pnlAbs: 0.5 }];
  const s = e.status();
  for (const k of ['enabled', 'config', 'ivRegime', 'sizing', 'openPositions', 'closedToday',
    'wins', 'winRate', 'netPnl', 'allTime', 'recent', 'forwardTest', 'note']) {
    ok(k in s, `status().${k} still present (backward compatible)`);
  }
  for (const k of ['trades', 'days', 'wins', 'winRate', 'netPnl', 'avgPerTrade', 'since']) {
    ok(k in s.allTime, `status().allTime.${k} still present`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  MIGRATION C1a — REGRESSION GUARD
//  Bug that shipped: `this._ftLogger = require('./forward-test-logger.js')` assigned
//  the CLASS, not an instance. `_ftLogger.status()` threw TypeError → GET
//  /api/strangle/status returned HTTP 500, and `_ftLogger.logTrade()` threw into a
//  silent `catch (_) {}` so no trade ever reached the forward-test shard.
//  These assertions fail loudly if the constructor is ever re-assigned unwrapped.
// ══════════════════════════════════════════════════════════════════════════════
{
  const ForwardTestLogger = require('../forward-test-logger.js');
  // Disabled path: constructing must not touch the filesystem.
  const prevEnv = process.env.FORWARD_TEST_DATE_FROM;
  delete process.env.FORWARD_TEST_DATE_FROM;

  // NOTE: no _ftLogger stub here — we exercise the REAL wiring.
  const e = new StrangleEngine({ enabled: true });

  ok(e._ftLogger instanceof ForwardTestLogger, 'C1a: _ftLogger is an INSTANCE, not the class constructor');
  ok(e._ftLogger !== ForwardTestLogger, 'C1a: _ftLogger is not the class itself (the exact bug)');
  ok(typeof e._ftLogger.status === 'function', 'C1a: _ftLogger.status is callable');
  ok(typeof e._ftLogger.logTrade === 'function', 'C1a: _ftLogger.logTrade is callable');

  // Requirement 3 — status().forwardTest returns the expected object.
  let s;
  assert.doesNotThrow(() => { s = e.status(); }, 'C1a: status() must not throw');
  ok(true, 'C1a: status() does not throw (this is what returned HTTP 500)'); pass++;
  ok(s.forwardTest && typeof s.forwardTest === 'object' && !Array.isArray(s.forwardTest), 'C1a: status().forwardTest is a plain object');
  ok('enabled' in s.forwardTest, 'C1a: status().forwardTest carries the `enabled` flag');
  ok(s.forwardTest.enabled === false && /FORWARD_TEST_DATE_FROM/.test(s.forwardTest.message), 'C1a: disabled logger reports why');

  // Requirement 4 — logTrade no longer throws.
  assert.doesNotThrow(() => e._ftLogger.logTrade({ inst: 'NIFTY', date: '2026-07-09', pnlAbs: 1, pnlPct: 1 }),
    'C1a: logTrade() must not throw');
  ok(true, 'C1a: logTrade() does not throw (it previously threw into a silent catch)'); pass++;

  // Requirement 7 — backward compatibility: status() shape is unchanged apart from additions.
  ok(typeof s.allTime === 'object' && typeof s.config === 'object', 'C1a: status() shape intact');

  if (prevEnv !== undefined) process.env.FORWARD_TEST_DATE_FROM = prevEnv;
}

console.log(`\n${pass} assertions passed`);
