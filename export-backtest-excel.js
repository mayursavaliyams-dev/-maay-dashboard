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

function winRate(wins, trades) {
  return trades ? +(wins / trades * 100).toFixed(2) : 0;
}

function sortByDateAsc(a, b) {
  return String(a.date || '').localeCompare(String(b.date || ''));
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

const trades = report.trades || [];
const winningTrades = trades.filter(t => t.win);
const losingTrades = trades.filter(t => !t.win);
const bestTrade = trades.reduce((best, t) => !best || (t.pnlPct || 0) > (best.pnlPct || 0) ? t : best, null);
const worstTrade = trades.reduce((worst, t) => !worst || (t.pnlPct || 0) < (worst.pnlPct || 0) ? t : worst, null);
const firstTrade = [...trades].sort(sortByDateAsc)[0];
const lastTrade = [...trades].sort(sortByDateAsc).pop();

const tradeSummaryRows = [
  ['Section', 'Metric', 'Value', 'Extra'],
  ['Overview', 'First Trade Date', firstTrade && firstTrade.date, ''],
  ['Overview', 'Last Trade Date', lastTrade && lastTrade.date, ''],
  ['Overview', 'Total Trades', stats.totalTrades || trades.length, ''],
  ['Overview', 'Wins', stats.wins || winningTrades.length, ''],
  ['Overview', 'Losses', stats.losses || losingTrades.length, ''],
  ['Overview', 'Win Rate %', stats.winRate, ''],
  ['Overview', 'Average Multiplier', stats.avgMultiplier, ''],
  ['Overview', 'Median Multiplier', stats.medianMultiplier, ''],
  ['Overview', 'Max Multiplier', stats.maxMultiplier, ''],
  ['Overview', 'Average PnL %', stats.avgPnlPct, ''],
  ['Overview', '2x Hits', stats.hit2x, ''],
  ['Overview', '5x Hits', stats.hit5x, ''],
  ['Best Trade', bestTrade && bestTrade.date, bestTrade && bestTrade.pnlPct, bestTrade && `${bestTrade.type} ${bestTrade.reason}`],
  ['Worst Trade', worstTrade && worstTrade.date, worstTrade && worstTrade.pnlPct, worstTrade && `${worstTrade.type} ${worstTrade.reason}`],
  ['', '', '', ''],
  ['By Type', 'Type', 'Trades', 'Win Rate %']
];
for (const [name, bucket] of Object.entries(stats.byType || {})) {
  tradeSummaryRows.push(['By Type', name, bucket.trades || 0, winRate(bucket.wins || 0, bucket.trades || 0)]);
}
tradeSummaryRows.push(['', '', '', '']);
tradeSummaryRows.push(['By Reason', 'Reason', 'Trades', 'Share %']);
for (const [name, count] of Object.entries(stats.byReason || stats.exitReasons || {})) {
  tradeSummaryRows.push(['By Reason', name, count, stats.totalTrades ? +(count / stats.totalTrades * 100).toFixed(2) : 0]);
}
tradeSummaryRows.push(['', '', '', '']);
tradeSummaryRows.push(['By Year', 'Year', 'Trades', 'Win Rate %']);
for (const [year, y] of Object.entries(stats.byYear || {})) {
  tradeSummaryRows.push(['By Year', year, y.trades || 0, winRate(y.wins || 0, y.trades || 0)]);
}
XLSX.utils.book_append_sheet(wb, sheetFromRows(tradeSummaryRows), 'Trade Summary');

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
for (const [name, bucket] of Object.entries(stats.byReason || stats.exitReasons || {})) {
  breakdownRows.push([`Exit - ${name}`, bucket]);
}
XLSX.utils.book_append_sheet(wb, sheetFromRows([
  ['Breakdown', 'Value'],
  ...breakdownRows
]), 'Breakdowns');

XLSX.writeFile(wb, outPath);
console.log(outPath);
