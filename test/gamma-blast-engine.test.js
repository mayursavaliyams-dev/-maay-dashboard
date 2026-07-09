/**
 * gamma-blast-engine — first test suite. Run: node test/gamma-blast-engine.test.js
 *
 * Created as part of MIGRATION C1b. Primary purpose: guard the lot-size source.
 * Bug that shipped: `const LOT = { NIFTY: 75, BANKNIFTY: 35, SENSEX: 20 }` and
 * `LOT[inst] || 75`. The broker contract master says 65/30/20. Because P&L is
 * `units = qty × lot`, realized ₹P&L was overstated +15.4% (NIFTY) / +16.7% (BANKNIFTY).
 */
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path'), os = require('os');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const near = (a, b, t, m) => { assert.ok(Math.abs(a - b) <= t, `${m} (got ${a}, want ~${b})`); console.log('  ✓ ' + m); pass++; };

console.log('gamma-blast-engine (migration C1b)');

for (const k of ['NIFTY_LOT_SIZE', 'BANKNIFTY_LOT_SIZE', 'SENSEX_LOT_SIZE']) delete process.env[k];
const GammaBlastEngine = require('../gamma-blast-engine.js');
const registry = require('../instrument-registry');
const { roundTripCharges } = require('../charges.js');

const fresh = (cfg = {}) => {
  const e = new GammaBlastEngine(Object.assign({ enabled: true, qty: 1 }, cfg));
  e._tradesFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gb-')), 'trades.json');
  e._allTrades = [];
  return e;
};

// ══ source-level guard: no hardcoded lot survives in executable code ══
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'gamma-blast-engine.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  ok(/require\(['"]\.\/instrument-registry/.test(src), 'C1b: requires instrument-registry');
  ok(!/LOT\[/.test(code), 'C1b: no LOT[...] lookups in executable code');
  ok(!/const\s+LOT\s*=\s*\{/.test(code), 'C1b: hardcoded LOT map removed');
  ok(!/\|\|\s*75\b/.test(code), 'C1b: the `|| 75` silent fallback is gone');
  ok(!/lot\s*=\s*(75|35|65|30)\b/.test(code), 'C1b: no `lot = <literal>` assignment survives');
}

// ══ lot comes from the registry ══
{
  const e = fresh();
  const s = e.status();
  ok(s.lotSource === 'instrument-registry', 'C1b: status() advertises the registry as the lot source');
  ok(s.lotSizes.NIFTY === 65 && s.lotSizes.BANKNIFTY === 30 && s.lotSizes.SENSEX === 20,
    'C1b: lotSizes = registry values (65 / 30 / 20)');
  ok(s.lotSizes.NIFTY === registry.lotSize('NIFTY'), 'C1b: agrees with the registry directly');
}

// ══ legacy classification ══
{
  const e = fresh();
  const m = e._closeCalcMeta({ inst: 'NIFTY', qty: 1, lot: 75 }, 1000);   // no calcVersion
  ok(m.calcVersion === 1, 'C1b: pre-migration position → calcVersion 1');
  ok(m.lotSource === 'legacy-open-position', 'C1b: flagged as a legacy open position');
  ok(m.pnlLegacy === 1000, 'C1b: its pnl IS the legacy value');

  const m2 = e._closeCalcMeta({ inst: 'NIFTY', qty: 1, lot: 65, calcVersion: 2, lotSource: 'instrument-registry' }, 800);
  ok(m2.calcVersion === 2, 'C1b: new position → calcVersion 2');
  ok(m2.pnlLegacy === null, 'C1b: new trade has NO invented legacy counterfactual');
}

// ══ reports label legacy vs current, and never mutate history ══
{
  const e = fresh();
  const hist = [{ inst: 'NIFTY', lot: 75, pnl: 1200 }];   // exactly the shape on disk today
  const before = JSON.stringify(hist);
  let c = e._calcBreakdown(hist);
  ok(JSON.stringify(hist) === before, 'C1b: _calcBreakdown does not mutate historical records');
  ok(c.legacy.trades === 1 && c.current.trades === 0, 'C1b: legacy-only data → legacy bucket');
  ok(c.mixed === false, 'C1b: not mixed when no v2 trades exist');
  ok(/hardcoded lot/.test(c.legacy.method), 'C1b: legacy method string names the defect');

  c = e._calcBreakdown([...hist, { inst: 'NIFTY', lot: 65, pnl: 500, calcVersion: 2 }]);
  ok(c.mixed === true, 'C1b: mixed flag flips once both versions exist');
  ok(c.current.trades === 1 && c.current.netPnl === 500, 'C1b: current bucket isolates v2');
  ok(/mixed/.test(c.note), 'C1b: note warns the raw netPnl is mixed');
}

// ══ close math: units = qty × registry lot, net of charges ══
{
  const e = fresh();
  const pos = { inst: 'NIFTY', side: 'CE', strike: 24000, entry: 100, qty: 2, lot: registry.lotSize('NIFTY'),
    lotSource: 'instrument-registry', calcVersion: 2, score: 80, level: 'HIGH', openMins: 600 };
  e._day = '2026-07-09';
  e._open.set('NIFTY', pos);
  e._close('NIFTY', pos, 150, 'TARGET', 700);
  const t = e._allTrades[0];
  ok(t.lot === 65, 'C1b: closed record carries lot 65');
  const units = 2 * 65;
  const gross = (150 - 100) * units;
  const ch = roundTripCharges(100, 150, units).total;
  near(t.pnl, +(gross - ch).toFixed(2), 0.011, 'C1b: pnl = (exit − entry) × qty × 65 − charges');
  ok(t.calcVersion === 2 && t.pnlLegacy === null, 'C1b: closed record stamped v2');
  ok(t.charges > 0, 'charges applied');
}

// ══ unknown instrument: engine refuses to open, never guesses ══
{
  const e = fresh();
  ok(registry.lotSize('FINNIFTY') === null, 'C1b: registry returns null for FINNIFTY');
  // drive _open indirectly is awkward (needs a firing detector); assert the guard directly
  const src = fs.readFileSync(path.join(__dirname, '..', 'gamma-blast-engine.js'), 'utf8');
  ok(/const lot = lotOf\(inst\);[\s\S]{0,120}if \(!lot\) return;/.test(src),
    'C1b: open path refuses when the registry does not know the instrument');
}

// ══ backward compatibility: status() shape preserved ══
{
  const s = fresh().status();
  for (const k of ['enabled', 'config', 'openPositions', 'today', 'allTime', 'recent', 'detect', 'note']) {
    ok(k in s, `C1b: status().${k} still present (backward compatible)`);
  }
  for (const k of ['since', 'days']) ok(k in s.allTime, `C1b: status().allTime.${k} still present`);
}

console.log(`\n${pass} assertions passed`);
