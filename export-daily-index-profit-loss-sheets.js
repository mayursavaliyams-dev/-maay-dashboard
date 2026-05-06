const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const outDir = path.resolve('exports');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const inputs = [
  ['NIFTY', 'backtest-daily-results-nifty.json'],
  ['SENSEX', 'backtest-daily-results-sensex.json'],
  ['BANKNIFTY', 'backtest-daily-results-banknifty.json']
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

function calc(report) {
  const trades = report.trades || [];
  const wins = trades.filter(t => t.win);
  const losses = trades.filter(t => !t.win);
  const grossProfitPct = wins.reduce((sum, t) => sum + (Number(t.pnlPct) || 0), 0);
  const grossLossPct = losses.reduce((sum, t) => sum + (Number(t.pnlPct) || 0), 0);
  const netPnlPct = grossProfitPct + grossLossPct;
  return {
    trades,
    wins,
    losses,
    grossProfitPct,
    grossLossPct,
    netPnlPct,
    avgWinPct: wins.length ? grossProfitPct / wins.length : 0,
    avgLossPct: losses.length ? grossLossPct / losses.length : 0,
    profitFactor: grossLossPct ? grossProfitPct / Math.abs(grossLossPct) : 0
  };
}

const reports = inputs.map(([instrument, file]) => {
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}`);
  return [instrument, JSON.parse(fs.readFileSync(file, 'utf8'))];
});

const wb = XLSX.utils.book_new();
const summary = [[
  'Instrument', 'Generated At', 'Days', 'Trades', 'Wins', 'Losses', 'Win Rate %',
  'Gross Profit %', 'Gross Loss %', 'Net P/L %', 'Avg Win %', 'Avg Loss %',
  'Profit Factor', 'Avg Multiplier', 'Max Multiplier'
]];

for (const [instrument, report] of reports) {
  const s = report.stats || {};
  const c = calc(report);
  summary.push([
    instrument, report.generatedAt, report.totalExpiries, s.totalTrades, s.wins, s.losses,
    s.winRate, round(c.grossProfitPct), round(c.grossLossPct), round(c.netPnlPct),
    round(c.avgWinPct), round(c.avgLossPct), round(c.profitFactor, 3),
    s.avgMultiplier, s.maxMultiplier
  ]);

  const rows = [
    ['Date', 'Weekday', 'Side', 'Result', 'Reason', 'Entry Price', 'Exit Price', 'Multiplier', 'P/L %', 'Profit %', 'Loss %']
  ];
  for (const t of c.trades) {
    const pnl = Number(t.pnlPct) || 0;
    rows.push([
      t.date, t.weekday, t.type, t.win ? 'PROFIT' : 'LOSS', t.reason,
      t.entryPrice, t.exitPrice, t.multiplier, round(pnl),
      pnl > 0 ? round(pnl) : 0,
      pnl < 0 ? round(pnl) : 0
    ]);
  }
  XLSX.utils.book_append_sheet(wb, sheetFromRows(rows), `${instrument} P-L`);
}

XLSX.utils.book_append_sheet(wb, sheetFromRows(summary), 'Summary');
const outPath = path.join(outDir, 'daily-nifty-sensex-banknifty-profit-loss.xlsx');
XLSX.writeFile(wb, outPath);
console.log(outPath);
