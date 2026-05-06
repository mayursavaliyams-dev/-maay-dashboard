const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const START_CAPITAL = Number(process.env.CAPITAL_TOTAL || 50000);
const BASE_POSITION = Number(process.env.BASE_POSITION_SIZE || 5000);
const POSITION_PCT = Number(process.env.POSITION_PERCENT || 10);
const STEP_SIZE = Number(process.env.POSITION_STEP_SIZE || 5000);

const inputs = [
  ['SENSEX', 'backtest-tv-results-sensex.json'],
  ['NIFTY', 'backtest-tv-results-nifty.json'],
  ['BANKNIFTY', 'backtest-tv-results-banknifty.json']
];

function positionForEquity(equity) {
  const raw = equity * (POSITION_PCT / 100);
  const stepped = Math.floor(raw / STEP_SIZE) * STEP_SIZE;
  return Math.min(equity, Math.max(BASE_POSITION, stepped));
}

function sheetFromObjects(rows) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const headers = Object.keys(rows[0] || {});
  ws['!cols'] = headers.map(h => ({ wch: Math.min(Math.max(h.length + 2, 14), 28) }));
  return ws;
}

function run(report) {
  const trades = (report.trades || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  let equity = START_CAPITAL;
  let peak = START_CAPITAL;
  let maxDrawdownPct = 0;
  let maxPosition = BASE_POSITION;

  const rows = trades.map((t, index) => {
    const startEquity = equity;
    const positionSize = positionForEquity(startEquity);
    const pnl = positionSize * (t.multiplier - 1);
    equity += pnl;
    if (equity > peak) peak = equity;
    if (positionSize > maxPosition) maxPosition = positionSize;
    const drawdownPct = peak ? ((peak - equity) / peak) * 100 : 0;
    if (drawdownPct > maxDrawdownPct) maxDrawdownPct = drawdownPct;

    return {
      TradeNo: index + 1,
      Date: t.date,
      Type: t.type,
      Result: t.win ? 'WIN' : 'LOSS',
      Reason: t.reason,
      BuyPrice: t.entryPrice,
      SellPrice: t.exitPrice,
      StartEquity: +startEquity.toFixed(2),
      PositionSize: +positionSize.toFixed(2),
      PositionLevel: positionSize / STEP_SIZE,
      Multiplier: t.multiplier,
      Pnl: +pnl.toFixed(2),
      EndEquity: +equity.toFixed(2),
      DrawdownPct: +drawdownPct.toFixed(2)
    };
  });

  return {
    rows,
    summary: {
      Instrument: report.instrument || report.config?.instrument || '',
      StartingCapital: START_CAPITAL,
      BasePosition: BASE_POSITION,
      PositionRule: `${POSITION_PCT}% equity rounded down to ${STEP_SIZE}`,
      Trades: trades.length,
      FinalEquity: +equity.toFixed(2),
      NetProfit: +(equity - START_CAPITAL).toFixed(2),
      NetProfitPct: +(((equity / START_CAPITAL) - 1) * 100).toFixed(2),
      FinalMultiple: +(equity / START_CAPITAL).toFixed(4),
      MaxPosition: +maxPosition.toFixed(2),
      MaxDrawdownPct: +maxDrawdownPct.toFixed(2),
      WinRate: report.stats?.winRate || 0
    }
  };
}

const wb = XLSX.utils.book_new();
const summaries = [];

for (const [name, file] of inputs) {
  const report = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const result = run(report);
  summaries.push(result.summary);
  XLSX.utils.book_append_sheet(wb, sheetFromObjects(result.rows), name);
}

XLSX.utils.book_append_sheet(wb, sheetFromObjects(summaries), 'Summary');

const outDir = path.resolve('exports');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'backtest-2006-profit-level-position-5000.xlsx');
XLSX.writeFile(wb, outPath);

console.table(summaries);
console.log(outPath);
