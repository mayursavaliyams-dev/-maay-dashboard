/**
 * registry-drift.js — compare the Instrument Registry against the live broker
 * instrument master and report any disagreement.
 *
 * WHY (migration C1c-6, requirement 15)
 * `instrument-registry.js` is the single source of truth for lot size, tick size, strike
 * interval and expiry type. Those values were read from the broker's contract master on
 * 2026-07-09 — but the exchange revises contracts (SEBI lot-size revisions, new weeklies).
 * A registry that has silently gone stale is worse than no registry at all: every engine
 * would trust it, and every rupee of P&L (`pnl = points × lots × lotSize`) would be wrong
 * with no test failing.
 *
 * This module never fetches anything itself. `fetchContracts` is injected, so the
 * comparison logic is unit-testable with fixture rows and the network lives at the edge.
 * It reads the CATALOG surface, so trading-disabled instruments are validated too.
 *
 * Exit semantics for CI / preflight:
 *   ok:true   → registry agrees with the broker on every checked field
 *   ok:false  → DRIFT. Do not trade. Re-verify and update the registry.
 */
'use strict';

const registry = require('./instrument-registry.js');

/** Most common gap between adjacent strikes — the strike interval. */
function modalGap(strikes) {
  const s = [...new Set(strikes.filter((n) => Number.isFinite(n)))].sort((a, b) => a - b);
  if (s.length < 2) return null;
  const counts = new Map();
  for (let i = 1; i < s.length; i++) {
    const g = s[i] - s[i - 1];
    counts.set(g, (counts.get(g) || 0) + 1);
  }
  let best = null, bestN = -1;
  for (const [g, n] of counts) if (n > bestN) { bestN = n; best = g; }
  return best;
}

/** Reduce broker contract rows to the four fields the registry claims to know. */
function summarise(rows) {
  const clean = (rows || []).filter(Boolean);
  if (!clean.length) return null;

  const lots = [...new Set(clean.map((r) => Number(r.lot_size)).filter((n) => n > 0))];
  const ticks = [...new Set(clean.map((r) => Number(r.tick_size)).filter((n) => n > 0))];
  const expiries = [...new Set(clean.map((r) => r.expiry).filter(Boolean))].sort();
  const nearest = expiries[0];
  const strikeInterval = modalGap(clean.filter((r) => r.expiry === nearest).map((r) => Number(r.strike_price)));
  const anyWeekly = clean.some((r) => r.weekly === true);

  return {
    lotSize: lots.length === 1 ? lots[0] : null,
    lotSizesFound: lots,
    tickRaw: ticks.length === 1 ? ticks[0] : null,
    tickSizesFound: ticks,
    strikeInterval,
    expiryType: anyWeekly ? 'WEEKLY_AND_MONTHLY' : 'MONTHLY',
    nearestExpiry: nearest,
    contractCount: clean.length,
  };
}

const FIELDS = ['lotSize', 'tickRaw', 'strikeInterval', 'expiryType'];

/**
 * @param {object} opts
 *   fetchContracts  async (inst) => rows[]   — broker contract master rows
 *   instruments     string[]                 — defaults to every instrument in the catalog
 * @returns {{ok:boolean, checked:number, drifted:number, errored:number, results:Array}}
 */
async function checkDrift({ fetchContracts, instruments } = {}) {
  if (typeof fetchContracts !== 'function') throw new TypeError('checkDrift requires a fetchContracts(inst) function');
  const list = instruments && instruments.length ? instruments : registry.allInstruments();

  const results = [];
  for (const inst of list) {
    const expected = registry.catalog(inst);
    if (!expected) {
      results.push({ inst, ok: false, error: 'not in registry', diffs: [] });
      continue;
    }

    let rows;
    try {
      rows = await fetchContracts(inst);
    } catch (e) {
      // A broker outage is NOT drift. Report it separately so CI can tell them apart.
      results.push({ inst, ok: false, error: `fetch failed: ${e.message}`, diffs: [] });
      continue;
    }

    const found = summarise(rows);
    if (!found) {
      results.push({ inst, ok: false, error: 'broker returned no contracts', diffs: [] });
      continue;
    }

    const diffs = [];
    for (const f of FIELDS) {
      if (found[f] == null) { diffs.push({ field: f, expected: expected[f], found: null, note: 'broker value ambiguous or absent' }); continue; }
      if (found[f] !== expected[f]) diffs.push({ field: f, expected: expected[f], found: found[f] });
    }
    if (found.lotSizesFound.length > 1) diffs.push({ field: 'lotSize', expected: expected.lotSize, found: found.lotSizesFound, note: 'broker reports multiple distinct lot sizes' });

    results.push({
      inst, ok: diffs.length === 0, diffs,
      expected: Object.fromEntries(FIELDS.map((f) => [f, expected[f]])),
      found: Object.fromEntries(FIELDS.map((f) => [f, found[f]])),
      contractCount: found.contractCount, nearestExpiry: found.nearestExpiry,
      tradingEnabled: expected.tradingEnabled,
      lastVerifiedAt: expected.lastVerifiedAt,
    });
  }

  const drifted = results.filter((r) => !r.ok && !r.error).length;
  const errored = results.filter((r) => r.error).length;
  return { ok: drifted === 0 && errored === 0, checked: results.length, drifted, errored, results };
}

/** Human-readable one-line-per-instrument report. */
function formatReport(report) {
  const lines = [];
  for (const r of report.results) {
    if (r.error) { lines.push(`  ? ${r.inst.padEnd(11)} ${r.error}`); continue; }
    if (r.ok) { lines.push(`  ✓ ${r.inst.padEnd(11)} lot ${r.expected.lotSize}, tick ${r.expected.tickRaw}, step ${r.expected.strikeInterval}, ${r.expected.expiryType} (${r.contractCount} contracts)`); continue; }
    lines.push(`  ✗ ${r.inst.padEnd(11)} DRIFT:`);
    for (const d of r.diffs) lines.push(`      ${d.field}: registry ${JSON.stringify(d.expected)} vs broker ${JSON.stringify(d.found)}${d.note ? '  — ' + d.note : ''}`);
  }
  const verdict = report.ok
    ? `registry agrees with the broker on all ${report.checked} instruments`
    : `${report.drifted} instrument(s) DRIFTED, ${report.errored} could not be checked`;
  lines.push(`  ${verdict}`);
  return lines.join('\n');
}

module.exports = { checkDrift, formatReport, summarise, modalGap };
