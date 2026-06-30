/**
 * Backtest Report engine — unit tests. Run: node test/backtest-report.test.js
 */
'use strict';
const assert = require('assert');
const { report } = require('../backtest-report');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m} (got ${a}, want ${b})`); console.log('  ✓ ' + m); pass++; };

console.log('Backtest Report engine');

// deterministic 3-trade series, ₹1000 start
const T = [
  { date: '2024-01-01', pnl: 100 },
  { date: '2024-02-01', pnl: -50 },
  { date: '2024-03-01', pnl: 100 },
];
const r = report(T, { startCapital: 1000, strategy: 'SHORT_STRANGLE' });

eq(r.summary.trades, 3, 'counts trades');
eq(r.summary.wins, 2, 'counts wins');
eq(r.summary.losses, 1, 'counts losses');
eq(r.summary.winRate, 66.7, 'win rate 66.7%');
eq(r.summary.net, 150, 'net = 150');
eq(r.summary.expectancy, 50, 'expectancy ₹50/trade');
eq(r.summary.profitFactor, 4, 'profit factor = 200/50 = 4');
eq(r.summary.best.pnl, 100, 'best trade +100');
eq(r.summary.worst.pnl, -50, 'worst trade -50');
eq(r.finalCapital, 1150, 'final capital 1150');
// equity 1000→1100(peak)→1050→1150 : maxDD = 50/1100 = 4.55%
eq(r.risk.maxDrawdownPct, 4.55, 'max drawdown 4.55%');
ok(r.risk.sharpe > 0, `sharpe positive (got ${r.risk.sharpe})`);
ok(r.risk.sortino > 0, `sortino positive (got ${r.risk.sortino})`);
ok(typeof r.risk.cagrPct === 'number', 'CAGR computed');
eq(r.equityCurve.length, 3, 'equity curve has a point per trade');
eq(r.equityCurve[2].equity, 1150, 'equity curve ends at 1150');

// white-box rules disclosed for a known strategy
ok(r.whiteBox && /strangle/i.test(r.whiteBox.summary), 'white-box rules disclosed for SHORT_STRANGLE');
ok(/not investment advice/i.test(r.disclaimer), 'honest disclaimer attached');

// streaks
eq(r.summary.maxLossStreak, 1, 'max loss streak = 1');

// year breakdown
ok(r.byYear.length === 1 && r.byYear[0].period === '2024', 'year breakdown groups 2024');

// all-losing series → negative expectancy, PF ~0, no crash
const L = report([{ date: '2024-01-01', pnl: -100 }, { date: '2024-01-08', pnl: -50 }], { startCapital: 1000 });
ok(L.summary.net === -150 && L.summary.winRate === 0, 'all-loss series: net -150, 0% win');
ok(L.risk.maxDrawdownPct > 0, 'all-loss series has drawdown');

// guard
ok(report([], {}).available === false, 'empty trades → unavailable, no throw');

console.log(`\nBacktest Report: ${pass} assertions passed`);
