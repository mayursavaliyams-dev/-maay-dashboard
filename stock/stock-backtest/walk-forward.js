/**
 * WALK-FORWARD + CONSISTENCY VALIDATION (master prompt: beware recency bias).
 *
 * consistency(): runs the SAME strategy across N equal windows and reports per-
 * window win rate / return. If the spread is wild, the edge is regime-dependent.
 *
 * walkForward(): treats each window as out-of-sample relative to the prior one.
 * Since the ORB params are fixed (not optimized per window here), this is really
 * a stability test: does the strategy keep working window after window, or only
 * in one? If most windows are negative, it's flagged DO-NOT-USE.
 */

const { runBacktest } = require('./engine');
const { computeMetrics } = require('./metrics');

function chunk(arr, n) {
  const size = Math.ceil(arr.length / n);
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function consistency({ dataSource, symbols, dates, cfg, windows = 4 }) {
  const buckets = chunk(dates, windows).filter(b => b.length);
  const perWindow = [];
  for (let w = 0; w < buckets.length; w++) {
    const res = await runBacktest({ dataSource, symbols, dates: buckets[w], cfg });
    const m = computeMetrics(res);
    perWindow.push({
      window: w + 1,
      from: buckets[w][0], to: buckets[w][buckets[w].length - 1],
      trades: m.totalTrades, winRate: m.winRate,
      netPnl: m.netPnl, returnPct: m.totalReturn,
      profitFactor: m.profitFactor === Infinity ? null : m.profitFactor,
      maxDrawdownPct: m.maxDrawdownPct
    });
  }

  // Verdict: how many windows were profitable, and how dispersed the win rates are.
  const profitable = perWindow.filter(w => w.netPnl > 0).length;
  const winRates = perWindow.map(w => w.winRate);
  const mean = winRates.reduce((a, b) => a + b, 0) / (winRates.length || 1);
  const variance = winRates.reduce((a, b) => a + (b - mean) ** 2, 0) / (winRates.length || 1);
  const std = Math.sqrt(variance);

  let verdict, note;
  if (profitable === perWindow.length && std < 15) {
    verdict = 'ROBUST';
    note = 'profitable in every window with stable win rate';
  } else if (profitable >= Math.ceil(perWindow.length * 0.6)) {
    verdict = 'REGIME-DEPENDENT';
    note = `profitable in ${profitable}/${perWindow.length} windows; win-rate spread ±${std.toFixed(1)}pts`;
  } else {
    verdict = 'DO-NOT-USE';
    note = `only ${profitable}/${perWindow.length} windows profitable — edge not reliable`;
  }

  return { perWindow, verdict, note, winRateStd: +std.toFixed(1) };
}

function printConsistency(c) {
  console.log(`\n════════ WALK-FORWARD / CONSISTENCY (${c.perWindow.length} windows) ════════`);
  for (const w of c.perWindow) {
    console.log(`  W${w.window} ${w.from}→${w.to}: ${w.trades} trades, win ${w.winRate}%, ₹${w.netPnl} (${w.returnPct >= 0 ? '+' : ''}${w.returnPct}%), maxDD ${w.maxDrawdownPct}%`);
  }
  const flag = c.verdict === 'ROBUST' ? '✅' : c.verdict === 'DO-NOT-USE' ? '⛔' : '⚠️';
  console.log(`  ${flag} ${c.verdict} — ${c.note}`);
}

module.exports = { consistency, printConsistency };
