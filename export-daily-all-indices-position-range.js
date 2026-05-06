const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const START_CAPITAL = Number(process.env.CAPITAL_TOTAL || 50000);
const MIN_POSITION = Number(process.env.MIN_POSITION_SIZE || 5000);
const MAX_POSITION = Number(process.env.MAX_POSITION_SIZE || 15000);
const POSITION_PCT = Number(process.env.POSITION_PERCENT || 10);
const STEP_SIZE = Number(process.env.POSITION_STEP_SIZE || 5000);
const STEP_MODE = String(process.env.POSITION_STEP_MODE || 'pct').toLowerCase();
const NO_MAX_POSITION = String(process.env.NO_MAX_POSITION || 'false').toLowerCase() === 'true';
const CHARGE_PER_ORDER_PCT = Number(process.env.CHARGE_PER_ORDER_PCT || 0);

const inputs = [
  ['SENSEX', 'backtest-daily-results-sensex.json'],
  ['NIFTY', 'backtest-daily-results-nifty.json'],
  ['BANKNIFTY', 'backtest-daily-results-banknifty.json']
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function positionForEquity(equity) {
  if (STEP_MODE === 'ladder') {
    const profit = Math.max(0, equity - START_CAPITAL);
    const steps = Math.floor(profit / STEP_SIZE);
    const position = MIN_POSITION + steps * STEP_SIZE;
    return NO_MAX_POSITION ? Math.max(MIN_POSITION, position) : clamp(position, MIN_POSITION, MAX_POSITION);
  }
  const raw = equity * (POSITION_PCT / 100);
  const stepped = Math.floor(raw / STEP_SIZE) * STEP_SIZE;
  if (NO_MAX_POSITION) return Math.max(MIN_POSITION, stepped || MIN_POSITION);
  return clamp(stepped || MIN_POSITION, MIN_POSITION, MAX_POSITION);
}

function roundMoney(value) {
  return Math.round(Number(value) || 0);
}

function sheetFromObjects(rows) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const headers = Object.keys(rows[0] || {});
  ws['!cols'] = headers.map(h => {
    const max = rows.reduce((m, row) => Math.max(m, String(row[h] ?? '').length), h.length);
    return { wch: Math.min(max + 2, 30) };
  });
  applyFormats(ws, headers, rows.length);
  return ws;
}

function applyFormats(ws, headers, rowCount) {
  const money = new Set([
    'StartingCapital', 'FinalEquity', 'NetProfit', 'GrossProfit', 'GrossLoss',
    'MinPosition', 'MaxPosition', 'StartEquity', 'PositionSize', 'Deployed',
    'BuyCharge', 'SellCharge', 'BuySellCharges', 'TotalCharges', 'GrossPnl',
    'Pnl', 'NetPnl', 'EndEquity', 'Equity', 'SENSEX', 'NIFTY', 'BANKNIFTY'
  ]);
  const pct = new Set(['NetProfitPct', 'MaxDrawdownPct', 'WinRate', 'RawWinRate', 'RealisticAccuracy', 'AvgMultiplier', 'DrawdownPct', 'ChargePerOrderPct']);
  const mult = new Set(['Multiplier']);
  const price = new Set(['BuyPrice', 'SellPrice']);

  for (let c = 0; c < headers.length; c++) {
    const h = headers[c];
    const base = h.replace(/^(Win|Loss)_/, '');
    let fmt = null;
    if (money.has(base)) fmt = '"Rs "#,##0';
    if (money.has(h)) fmt = '"₹"#,##0.00';
    else if (price.has(base)) fmt = '0.00';
    else if (base === 'ChargePerOrderPct') fmt = '0.00"%"';
    else if (pct.has(base)) fmt = '0.00"%"';
    else if (mult.has(base)) fmt = '0.000"x"';
    if (!fmt) continue;

    for (let r = 2; r <= rowCount + 1; r++) {
      const cell = XLSX.utils.encode_cell({ r: r - 1, c });
      if (ws[cell] && typeof ws[cell].v === 'number') ws[cell].z = fmt;
    }
  }
}

function buildRows(report) {
  const trades = (report.trades || []).slice().sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const lotSize = Number(report.config?.risk?.lotSize || 1);
  let equity = START_CAPITAL;
  let peak = START_CAPITAL;
  let maxDrawdownPct = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let realisticWins = 0;

  const curve = [];
  const rows = trades.map((t, index) => {
    const startEquity = equity;
    const positionSize = positionForEquity(startEquity);
    const lots = Math.max(1, Math.floor(positionSize / Math.max(t.entryPrice * lotSize, 1)));
    const quantity = lots * lotSize;
    const deployed = t.entryPrice * quantity;
    const grossPnl = deployed * (t.multiplier - 1);
    const buyCharge = deployed * (CHARGE_PER_ORDER_PCT / 100);
    const sellTurnover = deployed * t.multiplier;
    const sellCharge = sellTurnover * (CHARGE_PER_ORDER_PCT / 100);
    const totalCharges = buyCharge + sellCharge;
    const pnl = grossPnl - totalCharges;
    const realisticResult = pnl > 0 ? 'WIN' : 'LOSS';
    equity += pnl;
    if (pnl > 0) {
      grossProfit += pnl;
      realisticWins += 1;
    } else {
      grossLoss += Math.abs(pnl);
    }
    if (equity > peak) peak = equity;
    const drawdownPct = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (drawdownPct > maxDrawdownPct) maxDrawdownPct = drawdownPct;

    const row = {
      TradeNo: index + 1,
      Date: t.date,
      Weekday: t.weekday,
      Type: t.type,
      Result: realisticResult,
      RawResult: t.win ? 'WIN' : 'LOSS',
      Reason: t.reason,
      BuyPrice: t.entryPrice,
      SellPrice: t.exitPrice,
      Lots: lots,
      Deployed: roundMoney(deployed),
      Multiplier: t.multiplier,
      StartEquity: roundMoney(startEquity),
      PositionSize: roundMoney(positionSize),
      BuySellCharges: roundMoney(totalCharges),
      TotalCharges: roundMoney(totalCharges),
      GrossPnl: roundMoney(grossPnl),
      NetPnl: roundMoney(pnl),
      EndEquity: roundMoney(equity),
      DrawdownPct: +drawdownPct.toFixed(2)
    };
    curve.push({
      Instrument: report.config?.instrument || '',
      TradeNo: index + 1,
      Date: t.date,
      Equity: roundMoney(equity),
      NetPnl: roundMoney(pnl),
      DrawdownPct: +drawdownPct.toFixed(2),
      Result: realisticResult
    });
    return row;
  });

  const summary = {
    Instrument: report.config?.instrument || '',
    Days: report.totalExpiries,
    Trades: trades.length,
    StartingCapital: START_CAPITAL,
    MinPosition: MIN_POSITION,
    MaxPosition: NO_MAX_POSITION ? 'NO LIMIT' : MAX_POSITION,
    PositionRule: STEP_MODE === 'ladder'
      ? `start ${MIN_POSITION}, step +${STEP_SIZE} per ${STEP_SIZE} profit${NO_MAX_POSITION ? ', no max' : `, capped ${MAX_POSITION}`}`
      : `${POSITION_PCT}% equity, ${STEP_SIZE} step${NO_MAX_POSITION ? ', no max' : `, capped ${MIN_POSITION}-${MAX_POSITION}`}`,
    FinalEquity: roundMoney(equity),
    NetProfit: roundMoney(equity - START_CAPITAL),
    NetProfitPct: +(((equity / START_CAPITAL) - 1) * 100).toFixed(2),
    GrossProfit: roundMoney(grossProfit),
    GrossLoss: roundMoney(grossLoss),
    ChargePerOrderPct: CHARGE_PER_ORDER_PCT,
    MaxDrawdownPct: +maxDrawdownPct.toFixed(2),
    RealisticAccuracy: trades.length ? +((realisticWins / trades.length) * 100).toFixed(2) : 0,
    RawWinRate: report.stats?.winRate || 0,
    AvgMultiplier: report.stats?.avgMultiplier || 0
  };

  return { rows, curve, summary };
}

function buildWinLossRows(rows) {
  const displayColumns = [
    'Instrument', 'TradeNo', 'Date', 'Type', 'Reason', 'BuyPrice', 'SellPrice',
    'Lots', 'Deployed', 'Multiplier', 'GrossPnl', 'TotalCharges', 'NetPnl', 'EndEquity'
  ];
  const wins = rows.filter(row => row.Result === 'WIN');
  const losses = rows.filter(row => row.Result === 'LOSS');
  const maxRows = Math.max(wins.length, losses.length);
  const output = [];

  for (let i = 0; i < maxRows; i++) {
    const row = {};
    const win = wins[i] || {};
    const loss = losses[i] || {};
    for (const col of displayColumns) row[`Win_${col}`] = win[col] ?? '';
    row.Blank = '';
    for (const col of displayColumns) row[`Loss_${col}`] = loss[col] ?? '';
    output.push(row);
  }

  return output;
}

function buildGraphRows(curve, valueField) {
  const byTrade = new Map();
  for (const row of curve) {
    if (!byTrade.has(row.TradeNo)) byTrade.set(row.TradeNo, { TradeNo: row.TradeNo });
    byTrade.get(row.TradeNo)[row.Instrument] = roundMoney(row[valueField]);
  }
  return Array.from(byTrade.values())
    .sort((a, b) => a.TradeNo - b.TradeNo)
    .map(row => ({
      TradeNo: row.TradeNo,
      SENSEX: row.SENSEX ?? '',
      NIFTY: row.NIFTY ?? '',
      BANKNIFTY: row.BANKNIFTY ?? ''
    }));
}

function buildDateWiseRows(rows) {
  return rows.slice().sort((a, b) => {
    const dateCompare = String(a.Date || '').localeCompare(String(b.Date || ''));
    if (dateCompare !== 0) return dateCompare;
    const instrumentCompare = String(a.Instrument || '').localeCompare(String(b.Instrument || ''));
    if (instrumentCompare !== 0) return instrumentCompare;
    return (a.TradeNo || 0) - (b.TradeNo || 0);
  });
}

const wb = XLSX.utils.book_new();
const summaries = [];
const allCurve = [];
const allTrades = [];

for (const [sheetName, file] of inputs) {
  const report = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const built = buildRows(report);
  summaries.push(built.summary);
  allCurve.push(...built.curve);
  allTrades.push(...built.rows.map(row => ({ Instrument: sheetName, ...row })));
  XLSX.utils.book_append_sheet(wb, sheetFromObjects(built.rows), sheetName);
}

XLSX.utils.book_append_sheet(wb, sheetFromObjects(summaries), 'Summary');
XLSX.utils.book_append_sheet(wb, sheetFromObjects(buildDateWiseRows(allTrades)), 'ALL DATE WISE');
XLSX.utils.book_append_sheet(wb, sheetFromObjects(buildWinLossRows(allTrades)), 'WIN LOSS');
XLSX.utils.book_append_sheet(wb, sheetFromObjects(allCurve), 'Market Visual');
XLSX.utils.book_append_sheet(wb, sheetFromObjects(buildGraphRows(allCurve, 'Equity')), 'Equity Graph');
XLSX.utils.book_append_sheet(wb, sheetFromObjects(buildGraphRows(allCurve, 'NetPnl')), 'Pnl Graph');

const outDir = path.resolve('exports');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(
  outDir,
  `daily-all-indices-6trades-equity-${START_CAPITAL}-position-${MIN_POSITION}-${NO_MAX_POSITION ? 'nolimit' : MAX_POSITION}-${STEP_MODE}-charges-${CHARGE_PER_ORDER_PCT}-all-date-wise-rounded-graph.xlsx`
);
XLSX.writeFile(wb, outPath);

console.table(summaries);
console.log(outPath);
