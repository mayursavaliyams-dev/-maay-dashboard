/**
 * Event-risk filter — unit tests. Run: node test/event-risk-filter.test.js
 */
'use strict';
const assert = require('assert');
const F = require('../event-risk-filter');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };

console.log('Event-risk filter');

const cal = [
  { date: '2026-07-10', type: 'RBI_MPC', severity: 'HIGH' },
  { date: '2026-07-15', type: 'CPI', severity: 'MEDIUM' },
  { date: '2026-08-01', type: 'UNION_BUDGET', severity: 'HIGH' },
];

// ── daysBetween / nearestEvent ──
ok(F.daysBetween('2026-07-06', '2026-07-10') === 4, 'daysBetween counts 4 days');
ok(F.daysBetween('bad', '2026-07-10') === null, 'bad date → null');
{
  const n = F.nearestEvent('2026-07-06', cal, 10);
  ok(n && n.type === 'RBI_MPC' && n.daysAway === 4, 'nearest within lookahead = RBI in 4d');
  ok(F.nearestEvent('2026-07-06', cal, 3) === null, 'nothing within 3d → null');
}

// ── BLOCK: HIGH event tomorrow ──
{
  const r = F.assess({ dateISO: '2026-07-09', calendar: cal, vix: 12 });
  ok(r.verdict === 'BLOCK' && r.sizeScale === 0, 'HIGH event in 1d → BLOCK, size 0');
  ok(/RBI_MPC/.test(r.reason), 'reason names the event');
}
// ── REDUCE: HIGH event 3d away ──
{
  const r = F.assess({ dateISO: '2026-07-07', calendar: cal, vix: 12 });
  ok(r.verdict === 'REDUCE' && r.sizeScale === 0.5, 'event in 3d → REDUCE, half size');
}
// ── CLEAR: no event, calm vol ──
{
  const r = F.assess({ dateISO: '2026-07-20', calendar: cal, vix: 12 });
  ok(r.verdict === 'CLEAR' && r.sizeScale === 1, 'no nearby event + calm VIX → CLEAR');
}

// ── VIX spike blocks regardless of calendar ──
{
  const r = F.assess({ dateISO: '2026-07-20', calendar: [], vix: 24 });
  ok(r.verdict === 'BLOCK' && r.sizeScale === 0, 'VIX 24 → BLOCK even with empty calendar');
  const r2 = F.assess({ dateISO: '2026-07-20', calendar: [], vix: 19 });
  ok(r2.verdict === 'REDUCE', 'VIX 19 elevated → REDUCE');
}

// ── news/macro event-risk score works with empty calendar ──
{
  const r = F.assess({ dateISO: '2026-07-20', calendar: [], vix: 12, eventRiskScore: 80 });
  ok(r.verdict === 'BLOCK', 'event-risk 80 → BLOCK');
  const r2 = F.assess({ dateISO: '2026-07-20', calendar: [], vix: 12, eventRiskScore: 55 });
  ok(r2.verdict === 'REDUCE', 'event-risk 55 → REDUCE');
  const r3 = F.assess({ dateISO: '2026-07-20', calendar: [], vix: 12, eventRiskScore: 20 });
  ok(r3.verdict === 'CLEAR', 'event-risk 20 → CLEAR');
}

// ── MEDIUM event next day → only REDUCE (not BLOCK) ──
{
  const r = F.assess({ dateISO: '2026-07-14', calendar: cal, vix: 12 });
  ok(r.verdict === 'REDUCE', 'MEDIUM event in 1d → REDUCE (not BLOCK — HIGH-only blocks)');
}

// ── loadCalendar tolerates missing file ──
{
  const fakeFs = { readFileSync: () => { throw new Error('nofile'); } };
  ok(Array.isArray(F.loadCalendar(fakeFs, 'x.json')) && F.loadCalendar(fakeFs, 'x.json').length === 0, 'missing calendar → empty array');
  const okFs = { readFileSync: () => JSON.stringify({ events: cal }) };
  ok(F.loadCalendar(okFs, 'x.json').length === 3, 'loads {events:[...]} shape');
}

// ═══════════════════════════════════════════════════════════════════════════
// TASK A — an ABSENT India VIX must not read as a CALM one.
//
// `const vix = Number(i.vix) || 0;` mapped null, undefined, NaN and 0 all onto 0. Zero is below
// every threshold, so an unreachable volatility reading scored exactly like a calm market, and the
// gate on new premium selling silently stopped gating — precisely when the data source was down.
//
// EVIDENCE, measured rather than assumed:
//   • the value reaching this function is `server.js:5838` -> `ctx.regime?.components?.ivImplied`
//   • which is `server.js:5772` -> `vix = Number((await eventEngine.getVix()).value) || null`
//   • `getVix()` is a Yahoo network call inside `catch (_) {}`. It returned 12.34 in 4,513 ms from
//     this machine, so the value IS normally present: this fix does not pin the gate at REDUCE in
//     ordinary operation. It engages exactly when the source is unreachable.
//   • India VIX is never 0. A zero here means "no reading", not "no volatility".
//
// The policy matches the unreadable-calendar precedent already in this file: REDUCE, and say why.
//   @test:characterization @test:regression @test:failure
// ═══════════════════════════════════════════════════════════════════════════
{
  const base = { dateISO: '2026-07-20', calendar: [] };

  // @test:characterization — what the OLD coercion did, reproduced verbatim
  const oldVix = (v) => Number(v) || 0;
  ok(oldVix(null) === 0 && oldVix(undefined) === 0 && oldVix(NaN) === 0 && oldVix(0) === 0,
    'CHARACTERIZATION: the old coercion mapped null, undefined, NaN and 0 all onto 0');
  ok(oldVix(null) < 18, 'CHARACTERIZATION: 0 sits below vixReduce, so an outage CLEARED the gate');

  // @test:regression — the four unknown shapes now REDUCE, and say why
  for (const [label, v] of [['null', null], ['undefined', undefined], ['NaN', NaN], ['zero', 0]]) {
    const r = F.assess({ ...base, vix: v });
    ok(r.verdict === 'REDUCE', `unknown VIX (${label}) → REDUCE, not CLEAR`);
    ok(r.sizeScale === 0.5, `unknown VIX (${label}) → size actually halved`);
    ok(r.vixUnknown === true, `unknown VIX (${label}) → flagged as unknown`);
    ok(/VIX unavailable/.test(r.reason), `unknown VIX (${label}) → the reason names the missing evidence`);
    ok(r.vix === null, `unknown VIX (${label}) → reported as null, never as 0`);
  }

  // @test:regression — a KNOWN VIX behaves exactly as before
  const calm = F.assess({ ...base, vix: 12 });
  ok(calm.verdict === 'CLEAR' && calm.sizeScale === 1, 'a calm, KNOWN VIX still clears');
  ok(calm.vixUnknown === false && calm.vix === 12, 'and is reported as a real reading');
  ok(F.assess({ ...base, vix: 19 }).verdict === 'REDUCE', 'an elevated VIX still reduces');
  ok(F.assess({ ...base, vix: 24 }).verdict === 'BLOCK', 'a VIX spike still blocks');

  // the whole point, as one assertion
  ok(F.assess({ ...base, vix: null }).verdict !== F.assess({ ...base, vix: 12 }).verdict,
    'AN UNREACHABLE VIX AND A CALM ONE NO LONGER PRODUCE THE SAME VERDICT. Unknown != Zero');

  // @test:failure — BLOCK still outranks the unknown-VIX reduce
  const cal2 = [{ date: '2026-07-21', type: 'RBI_POLICY', title: 'MPC', severity: 'HIGH' }];
  const blocked = F.assess({ dateISO: '2026-07-20', calendar: cal2, vix: null });
  ok(blocked.verdict === 'BLOCK', 'a HIGH-impact event tomorrow still BLOCKs even when the VIX is unknown');
  ok(blocked.vixUnknown === true, 'and the unknown VIX is still reported alongside it');

  // two unknowns compound rather than cancel
  const both = F.assess({ dateISO: '2026-07-20', calendar: F.loadCalendar({ readFileSync: () => '{' }, 'x'), vix: null });
  ok(both.verdict === 'REDUCE', 'an unknown VIX and an unreadable calendar together still REDUCE');
  ok(both.vixUnknown === true && !!both.calendarCorrupt, 'and BOTH are named — neither masks the other');
  ok(/unavailable/.test(both.reason) && /unreadable/.test(both.reason), 'the reason carries both');
}

console.log(`\n${pass} assertions passed`);
