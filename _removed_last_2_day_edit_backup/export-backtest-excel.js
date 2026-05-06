const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const inputPath = path.resolve(process.argv[2] || 'backtest-real-results.json');
const outDir = path.resolve('exports');

if (!fs.existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  process.exit(1);
}

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const report = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const instrument = (report.config && report.config.instrument)
  ? `${String(report.config.instrument).toLowerCase()}-`
  : '';
const outName = `backtest-${instrument}${report.totalExpiries || 'results'}-expiries.xlsx`;
const outPath = path.join(outDir, outName);
const stats = report.stats || {};
const skipped = report.skipped || {};
const config = report.config || {};

function pct(n) {
  return typeof n === 'number' ? `${n.toFixed(2)}%` : n;
}

function sheetFromRows(rows) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = rows[0].map((_, col) => {
    const max = rows.reduce((m, row) => Math.max(m, String(row[col] ?? '').length), 8);
    return { wch: Math.min(max + 2, 36) };
  });
  return ws;
}

const wb = XLSX.utils.book_new();

XLSX.utils.book_append_sheet(wb, sheetFromRows([
  ['Metric', 'Value'],
  ['Generated At', report.generatedAt],
  ['Data Source', report.dataSource],
  ['Expiries Requested', config.numExpiries || report.totalExpiries],
  ['Total Expiries', report.totalExpiries],
  ['Expiries With Trades', report.expiriesWithTrades],
  ['Total Trades', stats.totalTrades],
  ['Wins', stats.wins],
  ['Losses', stats.losses],
  ['Win Rate', pct(stats.winRate)],
  ['Average Multiplier', stats.avgMultiplier],
  ['Median Multiplier', stats.medianMultiplier],
  ['Max Multiplier', stats.maxMultiplier],
  ['Average PnL %', pct(stats.avgPnlPct)],
  ['2x Hits', stats.hit2x],
  ['5x Hits', stats.hit5x],
  ['10x Hits', stats.hit10x],
  ['50x Hits', stats.hit50x],
  ['Stop Loss %', config.risk && config.risk.stopLossPct],
  ['Target %', config.risk && config.risk.targetPct],
  ['Trail After Multiple', config.risk && config.risk.trailAfterMultiple],
  ['Trail Lock %', config.risk && config.risk.trailLockPct],
  ['Cutover', config.cutover]
]), 'Summary');

const tradeHeaders = [
  'Date', 'Weekday', 'Era', 'Type', 'Result', 'Reason', 'Confidence', 'Strike',
  'Strike Offset', 'Entry Price', 'Exit Price', 'PnL %', 'Multiplier', 'IV',
  'Blast Score', 'Blast Level', 'Greek Rank', 'Greek Grade', 'Gamma', 'Delta'
];
const tradeRows = (report.trades || []).map(t => [
  t.date, t.weekday, t.era, t.type, t.win ? 'WIN' : 'LOSS', t.reason, t.confidence,
  t.strike, t.strikeOffset, t.entryPrice, t.exitPrice, t.pnlPct, t.multiplier, t.iv,
  t.gammaBlast && t.gammaBlast.blastScore,
  t.gammaBlast && t.gammaBlast.blastLevel,
  t.gammaBlast && t.gammaBlast.greekRank,
  t.gammaBlast && t.gammaBlast.greekGrade,
  t.gammaBlast && t.gammaBlast.gamma,
  t.gammaBlast && t.gammaBlast.delta
]);
XLSX.utils.book_append_sheet(wb, sheetFromRows([tradeHeaders, ...tradeRows]), 'Trades');

const expiryRows = (report.expirySummaries || []).map(e => [
  e.date, e.weekday, e.era, e.traded ? 'YES' : 'NO', e.numTrades || 0, e.bestMultiplier || ''
]);
XLSX.utils.book_append_sheet(wb, sheetFromRows([
  ['Date', 'Weekday', 'Era', 'Traded', 'Num Trades', 'Best Multiplier'],
  ...expiryRows
]), 'All Expiries');

const byYearRows = Object.entries(stats.byYear || {}).map(([year, y]) => [
  year, y.trades, y.wins, y.trades ? +(y.wins / y.trades * 100).toFixed(2) : 0,
  +((y.totalPnl || 0) / Math.max(y.trades || 0, 1)).toFixed(2),
  +(y.totalPnl || 0).toFixed(2)
]);
XLSX.utils.book_append_sheet(wb, sheetFromRows([
  ['Year', 'Trades', 'Wins', 'Win Rate %', 'Avg PnL %', 'Total PnL %'],
  ...byYearRows
]), 'By Year');

const breakdownRows = [
  ['Skipped - No Spot Data', skipped.noSpotData || 0],
  ['Skipped - No Signal', skipped.noSignal || 0],
  ['Skipped - No Option Data', skipped.noOptionData || 0],
  ['Skipped - No Entry', skipped.noEntry || 0],
  ['Skipped - Fetch Error', skipped.fetchError || 0]
];
for (const [name, bucket] of Object.entries(stats.byType || {})) {
  breakdownRows.push([`Type - ${name} Trades`, bucket.trades || 0]);
  breakdownRows.push([`Type - ${name} Wins`, bucket.wins || 0]);
}
for (const [name, bucket] of Object.entries(stats.exitReasons || {})) {
  breakdownRows.push([`Exit - ${name}`, bucket]);
}
XLSX.utils.book_append_sheet(wb, sheetFromRows([
  ['Breakdown', 'Value'],
  ...breakdownRows
]), 'Breakdowns');

XLSX.writeFile(wb, outPath);
console.log(outPath);
