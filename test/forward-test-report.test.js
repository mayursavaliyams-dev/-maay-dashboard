/**
 * Forward-test report (#9) — unit tests. Run: node test/forward-test-report.test.js
 */
'use strict';
const assert = require('assert');
const R = require('../forward-test-report');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };

console.log('Forward-test report (#9)');

const mkTrades = (n, winRate, win, loss) => {
  const t = [];
  for (let i = 0; i < n; i++) { const w = (i % 10) < Math.round(winRate * 10); t.push({ pnl: w ? win : -loss, won: w }); }
  return t;
};

// ── INSUFFICIENT below minTrades ──
{
  const r = R.buildReport({ trades: mkTrades(10, 0.8, 500, 300) });
  ok(r.verdict === 'INSUFFICIENT', 'below minTrades → INSUFFICIENT');
  ok(/keep paper-testing/.test(r.headline), 'headline says keep testing');
  ok(r.metrics.trades === 10, 'trade count reported');
}

// ── PASS: healthy forward edge matching thesis ──
{
  const r = R.buildReport({ trades: mkTrades(60, 0.8, 500, 300), calibration: { brier: 0.15 } });
  ok(r.verdict === 'PASS', '80% win, PF>1.2, +expectancy, calm Brier → PASS');
  ok(r.metrics.winRate >= 60 && r.metrics.profitFactor !== 'inf', 'metrics computed');
  ok(r.metrics.expectancy > 0, 'positive expectancy');
  ok(r.checks.every(c => typeof c.pass === 'boolean'), 'checklist booleans present');
}

// ── FAIL: net losing forward edge ──
{
  const r = R.buildReport({ trades: mkTrades(60, 0.5, 300, 500) });   // 50% win, loss bigger than win
  ok(r.verdict === 'FAIL', 'net-losing forward edge → FAIL');
  ok(/do NOT go live/.test(r.headline), 'headline warns against live');
  ok(r.metrics.netPnl < 0, 'net P&L negative');
}

// ── win rate below thesis even if net positive ──
{
  const r = R.buildReport({ trades: mkTrades(60, 0.5, 800, 300), thesis: { minTrades: 30, minWinRate: 0.6, minProfitFactor: 1.2 } });
  const wrCheck = r.checks.find(c => c.name === 'win rate vs thesis');
  ok(!wrCheck.pass, '50% win fails the 60% thesis win-rate check');
}

// ── calibration is a soft check (does not hard-fail an otherwise-good edge) ──
{
  const good = R.buildReport({ trades: mkTrades(60, 0.8, 500, 300), calibration: { brier: 0.4 } });
  ok(good.verdict === 'PASS', 'high Brier alone does not block a strong forward edge (soft check)');
  const cc = good.checks.find(c => c.name === 'calibration healthy');
  ok(cc && !cc.pass, 'calibration check still flagged failing');
}

// ── maxDrawdown ──
ok(R.maxDrawdown([100, 100, -300, 100]) === -300, 'max drawdown tracks worst equity dip');
ok(R.maxDrawdown([100, 200, 300]) === 0, 'monotonic up → 0 drawdown');

// ── metrics present + disclaimer ──
{
  const r = R.buildReport({ trades: mkTrades(40, 0.75, 400, 250), vrp: { positiveShare: 0.7 } });
  ok(r.metrics.vrpPositiveShare === 0.7, 'VRP positive-share surfaced');
  ok(r.metrics.sharpe != null && r.metrics.maxDrawdown != null, 'sharpe + drawdown computed');
  ok(/paper/i.test(r.disclaimer), 'disclaimer flags paper/not-advice');
}

console.log(`\n${pass} assertions passed`);
