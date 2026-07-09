/**
 * registry-drift — unit tests. Run: node test/registry-drift.test.js
 *
 * Migration C1c-6 (requirement 15). The network is injected, so this suite runs offline
 * against fixture rows. It must prove three things:
 *   1. it reports "no drift" when the broker agrees with the registry
 *   2. it DETECTS drift when the broker disagrees — including the exact defect this whole
 *      migration series existed to kill (a lot size of 75 where the broker says 65)
 *   3. it distinguishes a broker OUTAGE from actual drift. Silence is not agreement.
 */
'use strict';
const assert = require('assert');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };

console.log('registry-drift (migration C1c-6)');

const D = require('../registry-drift.js');
const registry = require('../instrument-registry.js');

/** Broker contract rows that match the registry for `inst`, with optional overrides. */
function rowsFor(inst, override = {}) {
  const m = registry.catalog(inst);
  const lot = override.lot_size ?? m.lotSize;
  const tick = override.tick_size ?? m.tickRaw;
  const step = override.strikeInterval ?? m.strikeInterval;
  const weekly = override.weekly ?? (m.expiryType === 'WEEKLY_AND_MONTHLY');
  const base = 24000;
  const rows = [];
  for (let i = 0; i < 6; i++) {
    rows.push({ lot_size: lot, tick_size: tick, strike_price: base + i * step, expiry: '2026-07-14', weekly });
    rows.push({ lot_size: lot, tick_size: tick, strike_price: base + i * step, expiry: '2026-07-28', weekly: false });
  }
  return rows;
}

(async () => {
  // ── modalGap ──
  ok(D.modalGap([100, 150, 200, 250]) === 50, 'modalGap finds a uniform 50-point lattice');
  ok(D.modalGap([100, 125, 150, 175, 400]) === 25, 'modalGap ignores an outlier gap');
  ok(D.modalGap([100]) === null, 'a single strike has no gap');
  ok(D.modalGap([]) === null, 'no strikes → null');

  // ── summarise ──
  {
    const s = D.summarise(rowsFor('NIFTY'));
    ok(s.lotSize === 65 && s.tickRaw === 5 && s.strikeInterval === 50, 'summarise extracts lot/tick/step from contract rows');
    ok(s.expiryType === 'WEEKLY_AND_MONTHLY', 'a weekly flag anywhere ⇒ WEEKLY_AND_MONTHLY');
    ok(D.summarise(rowsFor('BANKNIFTY')).expiryType === 'MONTHLY', 'no weekly flag ⇒ MONTHLY');
    ok(D.summarise([]) === null && D.summarise(null) === null, 'empty/null rows → null, never a fabricated summary');

    const multi = [...rowsFor('NIFTY'), { lot_size: 75, tick_size: 5, strike_price: 24000, expiry: '2026-07-14' }];
    const sm = D.summarise(multi);
    ok(sm.lotSize === null && sm.lotSizesFound.length === 2, 'two distinct lot sizes ⇒ ambiguous, not a silent pick');
  }

  // ── happy path: broker agrees ──
  {
    const report = await D.checkDrift({ fetchContracts: (i) => Promise.resolve(rowsFor(i)) });
    ok(report.ok === true, 'no drift when the broker matches the registry');
    ok(report.checked === registry.allInstruments().length, 'every catalog instrument is checked, enabled or not');
    ok(report.drifted === 0 && report.errored === 0, 'zero drifted, zero errored');
    ok(report.results.every((r) => r.diffs.length === 0), 'no diffs reported');
    ok(report.results.some((r) => r.tradingEnabled === false), 'C1c-6: disabled instruments are validated too');
    ok(/agrees with the broker/.test(D.formatReport(report)), 'formatReport states agreement');
  }

  // ── THE test: it detects the exact defect this migration series killed ──
  {
    const report = await D.checkDrift({
      instruments: ['NIFTY'],
      fetchContracts: () => Promise.resolve(rowsFor('NIFTY', { lot_size: 75 })),   // the old wrong constant
    });
    ok(report.ok === false && report.drifted === 1, 'C1c-6: a lot size of 75 against a registry of 65 IS drift');
    const d = report.results[0].diffs.find((x) => x.field === 'lotSize');
    ok(d && d.expected === 65 && d.found === 75, 'C1c-6: the diff names both values');
    ok(/DRIFT/.test(D.formatReport(report)), 'formatReport shouts DRIFT');
  }

  // ── each field independently detected ──
  {
    const cases = [
      ['tick size', { tick_size: 10 }, 'tickRaw'],
      ['strike interval', { strikeInterval: 100 }, 'strikeInterval'],
      ['expiry type', { weekly: false }, 'expiryType'],
    ];
    for (const [label, override, field] of cases) {
      const r = await D.checkDrift({ instruments: ['NIFTY'], fetchContracts: () => Promise.resolve(rowsFor('NIFTY', override)) });
      assert.strictEqual(r.ok, false, `${label} drift must be detected`);
      assert.ok(r.results[0].diffs.some((x) => x.field === field), `${label} → diff on ${field}`);
    }
    ok(true, 'C1c-6: drift in tick size, strike interval and expiry type is each detected');
  }

  // ── a broker outage is NOT agreement ──
  {
    const r = await D.checkDrift({ instruments: ['NIFTY'], fetchContracts: () => Promise.reject(new Error('401 invalid token')) });
    ok(r.ok === false, 'C1c-6: a fetch failure is never reported as "no drift"');
    ok(r.errored === 1 && r.drifted === 0, 'C1c-6: an outage is counted separately from drift');
    ok(/fetch failed/.test(r.results[0].error), 'the error is surfaced verbatim');

    const empty = await D.checkDrift({ instruments: ['NIFTY'], fetchContracts: () => Promise.resolve([]) });
    ok(empty.ok === false && empty.errored === 1, 'C1c-6: an empty contract list is an error, not agreement');
  }

  // ── contract ──
  {
    let threw = false;
    try { await D.checkDrift({}); } catch (e) { threw = /fetchContracts/.test(e.message); }
    ok(threw, 'checkDrift refuses to run without a fetchContracts function');

    const r = await D.checkDrift({ instruments: ['NIFTYNEXT50'], fetchContracts: () => Promise.resolve([]) });
    ok(r.results[0].error === 'not in registry', 'an instrument outside the registry is reported, not skipped');
  }

  console.log(`\n${pass} assertions passed`);
})().catch((e) => { console.error(e); process.exit(1); });
