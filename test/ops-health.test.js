/**
 * Ops health (#6) — unit tests. Run: node test/ops-health.test.js
 */
'use strict';
const assert = require('assert');
const { opsHealthSnapshot } = require('../ops-health');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };

console.log('Ops health (#6)');

// ── healthy snapshot → OK ──
{
  const s = opsHealthSnapshot({
    bootAt: 1000, getMarketSession: () => ({ status: 'MARKET_OPEN' }),
    signalHealth: () => ({ status: 'HEALTHY' }),
    forwardTest: () => ({ verdict: 'INSUFFICIENT', metrics: { trades: 5 } }),
    signalPaper: () => ({ enabled: true, open: [{}, {}], allTime: { netPnl: 1234 } }),
    engines: () => [{ label: 'CONDOR VRP', enabled: true }],
  }, 61000);
  ok(s.overall === 'OK', 'healthy + not-failing → OK');
  ok(s.uptimeSec === 60, 'uptime computed from bootAt');
  ok(s.market === 'MARKET_OPEN', 'market status surfaced');
  ok(s.signalPaper.open === 2 && s.signalPaper.netPnl === 1234, 'signal-paper open + net surfaced');
  ok(s.checks.length >= 2 && s.checks.every(c => typeof c.ok === 'boolean'), 'checklist present');
}

// ── DEGRADED health → ATTENTION ──
{
  const s = opsHealthSnapshot({ signalHealth: () => ({ status: 'DEGRADED' }) });
  ok(s.overall === 'ATTENTION', 'signal-health DEGRADED → ATTENTION');
  ok(/degraded/i.test(s.reason), 'reason names the degraded check');
}

// ── FAIL forward-test → ATTENTION ──
{
  const s = opsHealthSnapshot({ signalHealth: () => ({ status: 'HEALTHY' }), forwardTest: () => ({ verdict: 'FAIL', metrics: { trades: 40 } }) });
  ok(s.overall === 'ATTENTION', 'forward-test FAIL → ATTENTION');
}

// ── a throwing dep does not break the snapshot ──
{
  const s = opsHealthSnapshot({
    signalHealth: () => { throw new Error('boom'); },
    forwardTest: () => ({ verdict: 'PASS', metrics: { trades: 50 } }),
  });
  ok(s.signalHealth === null && s.overall === 'OK', 'one broken dep is isolated, snapshot still builds');
}

// ── empty deps → safe defaults ──
{
  const s = opsHealthSnapshot({});
  ok(s.overall === 'OK' && s.uptimeSec === null, 'empty deps → safe nulls, OK');
}

console.log(`\n${pass} assertions passed`);
