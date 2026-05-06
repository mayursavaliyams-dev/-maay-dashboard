const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const INPUT = path.resolve(process.argv[2] || 'backtest-daily-results.json');
const START_CAPITAL = Number(process.env.CAPITAL_TOTAL || 50000);
const MIN_POSITION = Number(process.env.MIN_POSITION_SIZE || 5000);
const MAX_POSITION = Number(process.env.MAX_POSITION_SIZE || 15000);
const POSITION_PCT = Number(process.env.POSITION_PERCENT || 10);
const STEP_SIZE = Number(process.env.POSITION_STEP_SIZE || 5000);

if (!fs.existsSync(INPUT)) {
  console.error(`Missing input file: ${INPUT}`);
  process.exit(1);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function positionForEquity(equity) {
  const raw = equity * (POSITION_PCT / 100);
  const stepped = Math.floor(raw / STEP_SIZE) * STEP_SIZE;
  return clamp(stepped || MIN_POSITION, MIN_POSITION, MAX_POSITION);
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

const report = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
const trades = (report.trades || []).slice().sort((a, b) => {
  const d = String(a.date || '').localeCompare(String(b.date || ''));
  if (d !== 0) return d;
  return String(a.entryTime || a.enteredAt || '').localeCompare(String(b.entryTime || b.enteredAt || ''));
});

let equity = START_CAPITAL;
let peak = START_CAPITAL;
let maxDrawdownPct = 0;
let grossProfit = 0;
let grossLoss = 0;

const rows = trades.map((t, index) => {
  const startEquity = equity;
  const positionSize = positionForEquity(startEquity);
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
    BuyPrice: t.entryPrice,
    SellPrice: t.exitPrice,
    Multiplier: t.multiplier,
    StartEquity: +startEquity.toFixed(2),
    PositionSize: +positionSize.toFixed(2),
    Pnl: +pnl.toFixed(2),
    EndEquity: +equity.toFixed(2),
    DrawdownPct: +drawdownPct.toFixed(2)
  };
});

const summary = [{
  Instrument: report.config?.instrument || '',
  Days: report.totalExpiries,
  Trades: trades.length,
  StartingCapital: START_CAPITAL,
  MinPosition: MIN_POSITION,
  MaxPosition: MAX_POSITION,
  PositionRule: `${POSITION_PCT}% equity, ${STEP_SIZE} step, capped ${MIN_POSITION}-${MAX_POSITION}`,
  FinalEquity: +equity.toFixed(2),
  NetProfit: +(equity - START_CAPITAL).toFixed(2),
  NetProfitPct: +(((equity / START_CAPITAL) - 1) * 100).toFixed(2),
  GrossProfit: +grossProfit.toFixed(2),
  GrossLoss: +grossLoss.toFixed(2),
  MaxDrawdownPct: +maxDrawdownPct.toFixed(2),
  WinRate: report.stats?.winRate || 0,
  AvgMultiplier: report.stats?.avgMultiplier || 0
}];

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, sheetFromObjects(summary), 'Summary');
XLSX.utils.book_append_sheet(wb, sheetFromObjects(rows), 'Orders');

const outDir = path.resolve('exports');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const instrument = String(report.config?.instrument || 'daily').toLowerCase();
const outPath = path.join(outDir, `daily-${instrument}-6trades-position-5000-15000.xlsx`);
XLSX.writeFile(wb, outPath);

console.table(summary);
console.log(outPath);
