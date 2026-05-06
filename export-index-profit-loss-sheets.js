const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const outDir = path.resolve('exports');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const inputs = [
  { instrument: 'NIFTY', file: 'backtest-tv-results-nifty.json' },
  { instrument: 'SENSEX', file: 'backtest-tv-results-sensex.json' },
  { instrument: 'BANKNIFTY', file: 'backtest-tv-results-banknifty.json' }
];

function round(n, digits = 2) {
  return typeof n === 'number' && Number.isFinite(n) ? +n.toFixed(digits) : n;
}

function sheetFromRows(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = rows[0].map((_, col) => {
    const max = rows.reduce((m, row) => Math.max(m, String(row[col] ?? '').length), 8);
    return { wch: Math.min(max + 2, 42) };
  });
  return ws;
}

function profitLossStats(report) {
  const trades = report.trades || [];
  const wins = trades.filter(t => t.win);
  const losses = trades.filter(t => !t.win);
  const grossProfitPct = wins.reduce((sum, t) => sum + (Number(t.pnlPct) || 0), 0);
  const grossLossPct = losses.reduce((sum, t) => sum + (Number(t.pnlPct) || 0), 0);
  const netPnlPct = grossProfitPct + grossLossPct;
  const avgWinPct = wins.length ? grossProfitPct / wins.length : 0;
  const avgLossPct = losses.length ? grossLossPct / losses.length : 0;
  const profitFactor = grossLossPct ? grossProfitPct / Math.abs(grossLossPct) : 0;
  const bestTrade = trades.reduce((best, t) => !best || (t.pnlPct || 0) > (best.pnlPct || 0) ? t : best, null);
  const worstTrade = trades.reduce((worst, t) => !worst || (t.pnlPct || 0) < (worst.pnlPct || 0) ? t : worst, null);

  return {
    trades,
    wins,
    losses,
    grossProfitPct,
    grossLossPct,
    netPnlPct,
    avgWinPct,
    avgLossPct,
    profitFactor,
    bestTrade,
    worstTrade
  };
}

function makeSummaryRows(reports) {
  const rows = [[
    'Instrument', 'Generated At', 'Total Expiries', 'Trades', 'Wins', 'Losses',
    'Win Rate %', 'Gross Profit %', 'Gross Loss %', 'Net P/L %',
    'Avg Win %', 'Avg Loss %', 'Profit Factor', 'Avg Multiplier', 'Max Multiplier'
  ]];

  for (const { instrument, report } of reports) {
    const s = report.stats || {};
    const pl = profitLossStats(report);
    rows.push([
      instrument,
      report.generatedAt,
      report.totalExpiries,
      s.totalTrades,
      s.wins,
      s.losses,
      s.winRate,
      round(pl.grossProfitPct),
      round(pl.grossLossPct),
      round(pl.netPnlPct),
      round(pl.avgWinPct),
      round(pl.avgLossPct),
      round(pl.profitFactor, 3),
      s.avgMultiplier,
      s.maxMultiplier
    ]);
  }

  return rows;
}

function makeProfitLossRows(instrument, report) {
  const s = report.stats || {};
  const pl = profitLossStats(report);
  const rows = [
    ['Metric', 'Value'],
    ['Instrument', instrument],
    ['Generated At', report.generatedAt],
    ['Data Source', report.dataSource],
    ['Total Expiries', report.totalExpiries],
    ['Expiries With Trades', report.expiriesWithTrades],
    ['Total Trades', s.totalTrades],
    ['Wins', s.wins],
    ['Losses', s.losses],
    ['Win Rate %', s.winRate],
    ['Gross Profit %', round(pl.grossProfitPct)],
    ['Gross Loss %', round(pl.grossLossPct)],
    ['Net P/L %', round(pl.netPnlPct)],
    ['Avg Win %', round(pl.avgWinPct)],
    ['Avg Loss %', round(pl.avgLossPct)],
    ['Profit Factor', round(pl.profitFactor, 3)],
    ['Avg Multiplier', s.avgMultiplier],
    ['Median Multiplier', s.medianMultiplier],
    ['Max Multiplier', s.maxMultiplier],
    ['Best Trade', pl.bestTrade ? `${pl.bestTrade.date} ${pl.bestTrade.type} ${round(pl.bestTrade.pnlPct)}%` : ''],
    ['Worst Trade', pl.worstTrade ? `${pl.worstTrade.date} ${pl.worstTrade.type} ${round(pl.worstTrade.pnlPct)}%` : ''],
    [],
    ['Date', 'Weekday', 'Side', 'Result', 'Reason', 'Strike', 'Entry Price', 'Exit Price', 'Multiplier', 'P/L %', 'Profit %', 'Loss %']
  ];

  for (const t of pl.trades) {
    const pnl = Number(t.pnlPct) || 0;
    rows.push([
      t.date,
      t.weekday,
      t.type,
      t.win ? 'PROFIT' : 'LOSS',
      t.reason,
      t.strike,
      t.entryPrice,
      t.exitPrice,
      t.multiplier,
      round(pnl),
      pnl > 0 ? round(pnl) : 0,
      pnl < 0 ? round(pnl) : 0
    ]);
  }

  return rows;
}

const reports = inputs.map(input => {
  const filePath = path.resolve(input.file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${input.file}. Run the backtest first.`);
  }
  return { instrument: input.instrument, report: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
});

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, sheetFromRows(makeSummaryRows(reports)), 'All Summary');

for (const item of reports) {
  XLSX.utils.book_append_sheet(
    wb,
    sheetFromRows(makeProfitLossRows(item.instrument, item.report)),
    `${item.instrument} Profit Loss`
  );
}

const outPath = path.join(outDir, 'nifty-sensex-banknifty-profit-loss.xlsx');
XLSX.writeFile(wb, outPath);
console.log(outPath);
