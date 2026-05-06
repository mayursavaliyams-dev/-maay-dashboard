const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const START_POSITION = Number(process.env.START_POSITION_SIZE || 5000);
const LEVELS = [
  5000, 10000, 25000, 50000, 100000, 200000, 500000,
  1000000, 2000000, 5000000, 10000000
];

const inputs = [
  ['SENSEX', 'backtest-tv-results-sensex.json'],
  ['NIFTY', 'backtest-tv-results-nifty.json'],
  ['BANKNIFTY', 'backtest-tv-results-banknifty.json']
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function levelFor(value) {
  let level = LEVELS[0];
  for (const candidate of LEVELS) {
    if (value >= candidate) level = candidate;
  }
  return level;
}

function nextLevelFor(value) {
  return LEVELS.find(level => value < level) || '';
}

function inr(value) {
  return +Number(value || 0).toFixed(2);
}

function sheetFromObjects(rows) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const headers = Object.keys(rows[0] || {});
  ws['!cols'] = headers.map(h => {
    const max = rows.reduce((m, row) => Math.max(m, String(row[h] ?? '').length), h.length);
    return { wch: Math.min(max + 2, 30) };
  });
  return ws;
}

function compound(report) {
  const trades = (report.trades || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  let equity = START_POSITION;
  let peak = START_POSITION;
  let maxDrawdownPct = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  const rows = trades.map((t, index) => {
    const startEquity = equity;
    const positionSize = Math.max(startEquity, 0);
    const pnl = positionSize * (t.multiplier - 1);
    equity += pnl;

    if (pnl >= 0) grossProfit += pnl;
    else grossLoss += Math.abs(pnl);

    if (equity > peak) peak = equity;
    const drawdownPct = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (drawdownPct > maxDrawdownPct) maxDrawdownPct = drawdownPct;

    return {
      TradeNo: index + 1,
      Date: t.date,
      Weekday: t.weekday,
      Type: t.type,
      Result: t.win ? 'WIN' : 'LOSS',
      Reason: t.reason,
      StartEquity: inr(startEquity),
      PositionSize: inr(positionSize),
      Multiplier: t.multiplier,
      Pnl: inr(pnl),
      EndEquity: inr(equity),
      ProfitLevel: levelFor(equity),
      NextLevel: nextLevelFor(equity),
      DrawdownPct: +drawdownPct.toFixed(2)
    };
  });

  return {
    rows,
    summary: {
      Instrument: report.instrument || report.config?.instrument || '',
      StartPosition: START_POSITION,
      Trades: trades.length,
      FinalEquity: inr(equity),
      NetProfit: inr(equity - START_POSITION),
      NetProfitPct: +(((equity / START_POSITION) - 1) * 100).toFixed(2),
      FinalMultiple: +(equity / START_POSITION).toFixed(4),
      GrossProfit: inr(grossProfit),
      GrossLoss: inr(grossLoss),
      MaxDrawdownPct: +maxDrawdownPct.toFixed(2),
      HighestProfitLevel: levelFor(equity),
      NextProfitLevel: nextLevelFor(equity),
      WinRate: report.stats?.winRate || 0,
      AvgMultiplier: report.stats?.avgMultiplier || 0
    }
  };
}

const wb = XLSX.utils.book_new();
const summaries = [];

for (const [name, file] of inputs) {
  const report = readJson(file);
  const result = compound(report);
  summaries.push(result.summary);
  XLSX.utils.book_append_sheet(wb, sheetFromObjects(result.rows), name);
}

XLSX.utils.book_append_sheet(wb, sheetFromObjects(summaries), 'Summary');

const outDir = path.resolve('exports');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `backtest-2006-start-${START_POSITION}-profit-level-compounding.xlsx`);
XLSX.writeFile(wb, outPath);

console.table(summaries);
console.log(outPath);
