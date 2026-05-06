const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const CAPITAL_TOTAL = Number(process.env.CAPITAL_TOTAL || 50000);
const CAPITAL_PCT = Number(process.env.CAPITAL_PER_TRADE_PERCENT || 5);
const FIXED_POSITION_SIZE = Number(process.env.POSITION_SIZE || 0);

const inputs = [
  ['SENSEX', 'backtest-tv-results-sensex.json'],
  ['NIFTY', 'backtest-tv-results-nifty.json'],
  ['BANKNIFTY', 'backtest-tv-results-banknifty.json']
];

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function sheetFromObjects(rows) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const headers = Object.keys(rows[0] || {});
  ws['!cols'] = headers.map(h => {
    const max = rows.reduce((m, row) => Math.max(m, String(row[h] ?? '').length), h.length);
    return { wch: Math.min(max + 2, 28) };
  });
  return ws;
}

function compound(report) {
  const trades = (report.trades || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  let equity = CAPITAL_TOTAL;
  let peak = CAPITAL_TOTAL;
  let maxDrawdownPct = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  const rows = trades.map((t, index) => {
    const startEquity = equity;
    const positionSize = FIXED_POSITION_SIZE > 0 ? FIXED_POSITION_SIZE : startEquity * (CAPITAL_PCT / 100);
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
      StartEquity: +startEquity.toFixed(2),
      PositionPct: FIXED_POSITION_SIZE > 0 ? '' : CAPITAL_PCT,
      PositionSize: +positionSize.toFixed(2),
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
      StartingCapital: CAPITAL_TOTAL,
      PositionPct: FIXED_POSITION_SIZE > 0 ? '' : CAPITAL_PCT,
      FixedPositionSize: FIXED_POSITION_SIZE > 0 ? FIXED_POSITION_SIZE : '',
      Trades: trades.length,
      FinalEquity: +equity.toFixed(2),
      NetProfit: +(equity - CAPITAL_TOTAL).toFixed(2),
      NetProfitPct: +(((equity / CAPITAL_TOTAL) - 1) * 100).toFixed(2),
      FinalMultiple: +(equity / CAPITAL_TOTAL).toFixed(4),
      GrossProfit: +grossProfit.toFixed(2),
      GrossLoss: +grossLoss.toFixed(2),
      MaxDrawdownPct: +maxDrawdownPct.toFixed(2),
      WinRate: report.stats?.winRate || 0,
      AvgMultiplier: report.stats?.avgMultiplier || 0,
      MaxMultiplier: report.stats?.maxMultiplier || 0
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
const outName = FIXED_POSITION_SIZE > 0
  ? `backtest-2006-fixed-position-${FIXED_POSITION_SIZE}.xlsx`
  : 'backtest-2006-compounding-position-size.xlsx';
const outPath = path.join(outDir, outName);
XLSX.writeFile(wb, outPath);

console.table(summaries);
console.log(outPath);
