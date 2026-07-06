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

console.log(`\n${pass} assertions passed`);
