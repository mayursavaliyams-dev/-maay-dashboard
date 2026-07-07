// ============================================================================
//  forward-test-report.js — #9 ⭐ THE gate-to-live validation report
//
//  The bot's whole discipline is "forward-test before live." This module reads the
//  accumulated PAPER forward-test data (signal-paper closed trades + signal-health
//  calibration + net-of-cost VRP monitor) and produces ONE quantified verdict on whether
//  the realized forward edge matches the thesis — the honest GATE before any live move.
//
//  Verdict:  INSUFFICIENT (not enough trades yet) · PASS (forward edge confirms thesis) ·
//            FAIL (forward edge contradicts thesis — do NOT go live).
//
//  Reuses bt-validate.js (Sharpe / deflated Sharpe / expectancy) so the forward P&L is
//  held to the same statistical bar as the backtests. Pure buildReport() + unit-tested;
//  the server reads the live data files and exposes /api/forward-test-report.
// ============================================================================
'use strict';
const V = require('./bt-validate');
const round = (v, d = 2) => (v == null || !isFinite(v)) ? null : +(+v).toFixed(d);

function maxDrawdown(pnls) {
  let equity = 0, peak = 0, mdd = 0;
  for (const p of pnls) { equity += p; peak = Math.max(peak, equity); mdd = Math.min(mdd, equity - peak); }
  return round(mdd, 0);
}

/**
 * @param {object} d
 *   trades       [{pnl, won, structure, inst, reason}]  realized forward paper trades
 *   calibration  { brier, ece, total }                  from signal-health
 *   vrp          { positiveShare }                       share of days net-VRP was positive
 *   thesis       { minTrades, minWinRate, minProfitFactor }  gate thresholds
 *   nTrials      strategy-search trials (for deflated Sharpe honesty)
 */
function buildReport(d = {}) {
  const th = Object.assign({ minTrades: 30, minWinRate: 0.6, minProfitFactor: 1.2, maxBrier: 0.25 }, d.thesis || {});
  const trades = (d.trades || []).filter(t => t && isFinite(Number(t.pnl)));
  const n = trades.length;
  const pnls = trades.map(t => Number(t.pnl));
  const wins = trades.filter(t => Number(t.pnl) >= 0).length;
  const netPnl = round(pnls.reduce((s, x) => s + x, 0), 0);
  const winRate = n ? wins / n : null;
  const grossWin = pnls.filter(x => x > 0).reduce((s, x) => s + x, 0);
  const grossLoss = Math.abs(pnls.filter(x => x < 0).reduce((s, x) => s + x, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);
  const avgTrade = n ? netPnl / n : null;
  const expectancy = n ? V.expectancy(pnls).expectancy : null;   // V.expectancy returns an object
  const sharpe = n > 1 ? V.sharpe(pnls) : null;
  const dsr = n > 5 ? V.deflatedSharpe(pnls, d.nTrials || 1) : null;
  const maxDD = maxDrawdown(pnls);

  const cal = d.calibration || {};
  const brier = cal.brier != null ? Number(cal.brier) : null;
  const vrpFavShare = d.vrp && d.vrp.positiveShare != null ? Number(d.vrp.positiveShare) : null;

  // ── GATE logic ──
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: !!pass, detail });
  const enough = n >= th.minTrades;
  add('sample size', enough, `${n}/${th.minTrades} closed forward trades`);
  add('positive expectancy', expectancy != null && expectancy > 0, `expectancy ₹${round(expectancy, 0)}`);
  add('profit factor', profitFactor >= th.minProfitFactor, `PF ${profitFactor === Infinity ? '∞' : round(profitFactor, 2)} (need ≥${th.minProfitFactor})`);
  add('win rate vs thesis', winRate != null && winRate >= th.minWinRate, `${winRate != null ? Math.round(winRate * 100) + '%' : '—'} (need ≥${Math.round(th.minWinRate * 100)}%)`);
  add('net P&L positive', netPnl > 0, `net ₹${netPnl}`);
  add('calibration healthy', brier == null || brier <= th.maxBrier, brier == null ? 'no calibration yet' : `Brier ${round(brier, 3)} (≤${th.maxBrier})`);

  let verdict, headline;
  if (!enough) { verdict = 'INSUFFICIENT'; headline = `Only ${n}/${th.minTrades} forward trades — keep paper-testing, no live decision yet.`; }
  else {
    const hardFails = checks.filter(c => !c.pass && c.name !== 'calibration healthy');
    if (hardFails.length === 0) { verdict = 'PASS'; headline = 'Forward edge confirms the thesis — statistically eligible to consider a small live pilot (still your call).'; }
    else { verdict = 'FAIL'; headline = `Forward edge contradicts the thesis on ${hardFails.length} check(s) — do NOT go live; re-validate.`; }
  }

  return {
    verdict, headline, generatedFor: 'paper forward-test',
    metrics: { trades: n, winRate: winRate != null ? round(winRate * 100, 1) : null, netPnl, avgTrade: round(avgTrade, 0),
      profitFactor: profitFactor === Infinity ? 'inf' : round(profitFactor, 2), expectancy: round(expectancy, 0),
      sharpe: round(sharpe, 3), deflatedSharpe: round(dsr, 4), maxDrawdown: maxDD,
      brier: round(brier, 3), vrpPositiveShare: round(vrpFavShare, 2) },
    checks, thesis: th,
    disclaimer: 'PASS = statistically eligible to CONSIDER a live pilot; it is not advice and does not remove tail risk. All data is paper. Re-check SEBI algo/RA rules before any live move.',
  };
}

module.exports = { buildReport, maxDrawdown };
