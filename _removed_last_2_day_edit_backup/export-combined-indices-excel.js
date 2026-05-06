const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const inputs = [
  ['SENSEX', 'backtest-tv-results-sensex.json'],
  ['NIFTY', 'backtest-tv-results-nifty.json'],
  ['BANKNIFTY', 'backtest-tv-results-banknifty.json']
];

function readReport(label, file) {
  const fullPath = path.resolve(file);
  if (!fs.existsSync(fullPath)) throw new Error(`Missing ${label} report: ${fullPath}`);
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

function sheetFromRows(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = rows[0].map((_, col) => {
    const max = rows.reduce((m, row) => Math.max(m, String(row[col] ?? '').length), 8);
    return { wch: Math.min(max + 2, 36) };
  });
  return ws;
}

function sheetFromObjects(rows) {
  if (!rows.length) return XLSX.utils.aoa_to_sheet([['No rows']]);
  const ws = XLSX.utils.json_to_sheet(rows);
  const headers = Object.keys(rows[0]);
  ws['!cols'] = headers.map(h => {
    const max = rows.reduce((m, row) => Math.max(m, String(row[h] ?? '').length), h.length);
    return { wch: Math.min(max + 2, 36) };
  });
  return ws;
}

function tradeRows(report) {
  return (report.trades || []).map(t => ({
    Instrument: report.instrument || report.config?.instrument || '',
    Date: t.date,
    Weekday: t.weekday,
    Era: t.era,
    Type: t.type,
    Result: t.win ? 'WIN' : 'LOSS',
    Reason: t.reason,
    Confidence: t.confidence,
    Strike: t.strike,
    StrikeOffset: t.strikeOffset,
    EntryPrice: t.entryPrice,
    ExitPrice: t.exitPrice,
    PnlPct: t.pnlPct,
    Multiplier: t.multiplier,
    IV: t.iv,
    BlastScore: t.gammaBlast?.blastScore,
    BlastLevel: t.gammaBlast?.blastLevel,
    GreekRank: t.gammaBlast?.greekRank,
    GreekGrade: t.gammaBlast?.greekGrade
  }));
}

function expiryRows(report) {
  return (report.expirySummaries || []).map(e => ({
    Instrument: report.instrument || report.config?.instrument || '',
    Date: e.date,
    Weekday: e.weekday,
    Era: e.era,
    Traded: e.traded ? 'YES' : 'NO',
    NumTrades: e.numTrades || 0,
    BestMultiplier: e.bestMultiplier || ''
  }));
}

function yearRows(report) {
  return Object.entries(report.stats?.byYear || {}).map(([year, y]) => ({
    Instrument: report.instrument || report.config?.instrument || '',
    Year: year,
    Trades: y.trades,
    Wins: y.wins,
    WinRatePct: y.trades ? +(y.wins / y.trades * 100).toFixed(2) : 0,
    AvgPnlPct: +((y.totalPnl || 0) / Math.max(y.trades || 0, 1)).toFixed(2),
    TotalPnlPct: +(y.totalPnl || 0).toFixed(2)
  }));
}

const reports = inputs.map(([label, file]) => readReport(label, file));
const wb = XLSX.utils.book_new();

const comparison = reports.map(report => {
  const s = report.stats || {};
  return {
    Instrument: report.instrument || report.config?.instrument || '',
    Yahoo: report.config?.yahoo || '',
    From: report.expirySummaries?.[0]?.date || '',
    To: report.expirySummaries?.at(-1)?.date || '',
    Expiries: report.totalExpiries,
    Trades: s.totalTrades,
    WinRate: s.winRate,
    AvgMultiplier: s.avgMultiplier,
    MedianMultiplier: s.medianMultiplier,
    MaxMultiplier: s.maxMultiplier,
    Hit2x: s.hit2x,
    Hit5x: s.hit5x,
    EOD: s.byReason?.EOD_CLOSE || 0,
    Trail: s.byReason?.TRAIL_STOP || 0,
    Target: s.byReason?.TARGET || 0,
    StopLoss: s.byReason?.STOP_LOSS || 0
  };
});

XLSX.utils.book_append_sheet(wb, sheetFromObjects(comparison), 'Comparison');

for (const report of reports) {
  const name = report.instrument || report.config?.instrument || 'INDEX';
  const s = report.stats || {};
  const skipped = report.skipped || {};
  XLSX.utils.book_append_sheet(wb, sheetFromRows([
    ['Metric', 'Value'],
    ['Instrument', name],
    ['Generated At', report.generatedAt],
    ['Data Source', report.dataSource],
    ['From', report.expirySummaries?.[0]?.date || ''],
    ['To', report.expirySummaries?.at(-1)?.date || ''],
    ['Total Expiries', report.totalExpiries],
    ['Expiries With Trades', report.expiriesWithTrades],
    ['Skipped No Spot Data', skipped.noSpotData || 0],
    ['Skipped No Signal', skipped.noSignal || 0],
    ['Total Trades', s.totalTrades],
    ['Wins', s.wins],
    ['Losses', s.losses],
    ['Win Rate', s.winRate],
    ['Average Multiplier', s.avgMultiplier],
    ['Median Multiplier', s.medianMultiplier],
    ['Max Multiplier', s.maxMultiplier],
    ['2x Hits', s.hit2x],
    ['5x Hits', s.hit5x]
  ]), `${name} Summary`);
  XLSX.utils.book_append_sheet(wb, sheetFromObjects(tradeRows(report)), `${name} Trades`);
  XLSX.utils.book_append_sheet(wb, sheetFromObjects(yearRows(report)), `${name} Years`);
  XLSX.utils.book_append_sheet(wb, sheetFromObjects(expiryRows(report)), `${name} Expiries`);
}

XLSX.utils.book_append_sheet(wb, sheetFromObjects(reports.flatMap(tradeRows)), 'All Trades');
XLSX.utils.book_append_sheet(wb, sheetFromObjects(reports.flatMap(yearRows)), 'All Years');

const outDir = path.resolve('exports');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'backtest-2006-to-date-all-indices.xlsx');
XLSX.writeFile(wb, outPath);
console.log(outPath);
