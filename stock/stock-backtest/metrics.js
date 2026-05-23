/**
 * BACKTEST METRICS — the numbers that reveal whether the edge is real.
 * From the master prompt: total trades, win rate, profit factor, max drawdown,
 * avg win/loss, best/worst day, and the exit-reason breakdown (how many SL vs
 * trail vs target — this is the tell for whether a strategy actually works or
 * just rides luck).
 */

function computeMetrics(result) {
  const { trades, equityCurve, cfg } = result;
  const n = trades.length;

  const wins = trades.filter(t => t.netPnl > 0);
  const losses = trades.filter(t => t.netPnl <= 0);
  const grossWin = wins.reduce((a, t) => a + t.netPnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.netPnl, 0));
  const netPnl = trades.reduce((a, t) => a + t.netPnl, 0);
  const totalCharges = trades.reduce((a, t) => a + t.charges, 0);

  // Max drawdown off the total-equity curve (active + reserve).
  let peak = cfg.capital, maxDD = 0, maxDDdate = null;
  for (const pt of equityCurve) {
    if (pt.total > peak) peak = pt.total;
    const dd = (peak - pt.total) / peak;
    if (dd > maxDD) { maxDD = dd; maxDDdate = pt.date; }
  }

  // Exit-reason breakdown.
  const exitReasons = {};
  for (const t of trades) exitReasons[t.reason] = (exitReasons[t.reason] || 0) + 1;

  // Best / worst day from the equity curve dayPnl.
  const days = equityCurve.filter(d => d.dayPnl !== 0);
  const best = days.reduce((b, d) => (!b || d.dayPnl > b.dayPnl ? d : b), null);
  const worst = days.reduce((b, d) => (!b || d.dayPnl < b.dayPnl ? d : b), null);

  return {
    totalTrades: n,
    wins: wins.length,
    losses: losses.length,
    winRate: n ? +(wins.length / n * 100).toFixed(1) : 0,
    netPnl: +netPnl.toFixed(0),
    totalCharges: +totalCharges.toFixed(0),
    profitFactor: grossLoss > 0 ? +(grossWin / grossLoss).toFixed(2) : (grossWin > 0 ? Infinity : 0),
    avgWin: wins.length ? +(grossWin / wins.length).toFixed(0) : 0,
    avgLoss: losses.length ? +(-grossLoss / losses.length).toFixed(0) : 0,
    expectancy: n ? +(netPnl / n).toFixed(0) : 0,
    maxDrawdownPct: +(maxDD * 100).toFixed(1),
    maxDrawdownDate: maxDDdate,
    startEquity: cfg.capital,
    finalEquity: result.finalEquity,
    finalReserve: result.finalReserve,
    totalReturn: +(((result.finalEquity + result.finalReserve) / cfg.capital - 1) * 100).toFixed(1),
    exitReasons,
    bestDay: best ? { date: best.date, pnl: best.dayPnl } : null,
    worstDay: worst ? { date: worst.date, pnl: worst.dayPnl } : null
  };
}

// Pretty terminal printout.
function printReport(label, m) {
  const inf = (v) => v === Infinity ? '∞' : v;
  console.log(`\n──────── ${label} ────────`);
  console.log(`Trades: ${m.totalTrades}  |  Win rate: ${m.winRate}%  (${m.wins}W / ${m.losses}L)`);
  console.log(`Net P&L: ₹${m.netPnl.toLocaleString('en-IN')}  |  Charges paid: ₹${m.totalCharges.toLocaleString('en-IN')}`);
  console.log(`Profit factor: ${inf(m.profitFactor)}  |  Expectancy/trade: ₹${m.expectancy}`);
  console.log(`Avg win: ₹${m.avgWin}  |  Avg loss: ₹${m.avgLoss}`);
  console.log(`Max drawdown: ${m.maxDrawdownPct}%${m.maxDrawdownDate ? ` (on ${m.maxDrawdownDate})` : ''}`);
  console.log(`Equity: ₹${m.startEquity.toLocaleString('en-IN')} → ₹${m.finalEquity.toLocaleString('en-IN')} + reserve ₹${(m.finalReserve||0).toLocaleString('en-IN')}  (${m.totalReturn >= 0 ? '+' : ''}${m.totalReturn}%)`);
  console.log(`Exit reasons: ${Object.entries(m.exitReasons).map(([k, v]) => `${k}=${v}`).join('  ') || '—'}`);
  if (m.bestDay)  console.log(`Best day: ${m.bestDay.date} ₹${m.bestDay.pnl}  |  Worst day: ${m.worstDay.date} ₹${m.worstDay.pnl}`);
}

module.exports = { computeMetrics, printReport };
