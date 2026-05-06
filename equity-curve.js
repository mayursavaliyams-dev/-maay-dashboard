/**
 * Replay the saved backtest trades through a starting capital, applying
 * CAPITAL_PER_TRADE_PERCENT per trade. Reports the equity curve, max
 * drawdown, and final compounded balance.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.resolve('./backtest-real-results.json');
const CAPITAL     = Number(process.env.CAPITAL_TOTAL || 50000);
const PCT         = Number(process.env.CAPITAL_PER_TRADE_PERCENT || 5);
const LOT_PRINT   = process.argv.includes('--full');

if (!fs.existsSync(REPORT_PATH)) {
  console.error(`No backtest report at ${REPORT_PATH}. Run \`npm run backtest\` first.`);
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
const trades = (report.trades || []).slice().sort((a, b) => a.date.localeCompare(b.date));

if (!trades.length) {
  console.error('No trades in report.');
  process.exit(1);
}

console.log(`\n₹${CAPITAL.toLocaleString('en-IN')} STARTING CAPITAL — ${PCT}% per trade`);
console.log(`Replaying ${trades.length} trades from ${trades[0].date} → ${trades[trades.length-1].date}\n`);

let equity = CAPITAL;
let peak = CAPITAL;
let maxDDPct = 0;
let maxDDAbs = 0;
let wins = 0, losses = 0;
let bestTrade = null, worstTrade = null;
const equityPoints = [{ date: trades[0].date, equity }];

for (const t of trades) {
  const bet = equity * (PCT / 100);
  const pnl = bet * (t.multiplier - 1);
  equity += pnl;
  if (pnl > 0) wins++; else losses++;
  if (!bestTrade || pnl > bestTrade.pnl) bestTrade = { date: t.date, type: t.type, mult: t.multiplier, pnl };
  if (!worstTrade || pnl < worstTrade.pnl) worstTrade = { date: t.date, type: t.type, mult: t.multiplier, pnl };
  if (equity > peak) peak = equity;
  const ddAbs = peak - equity;
  const ddPct = (ddAbs / peak) * 100;
  if (ddPct > maxDDPct) { maxDDPct = ddPct; maxDDAbs = ddAbs; }
  equityPoints.push({ date: t.date, equity });
}

const totalReturnPct = ((equity / CAPITAL) - 1) * 100;
const finalMult      = equity / CAPITAL;
const days           = Math.max(1, daysBetween(trades[0].date, trades[trades.length - 1].date));
const years          = days / 365;
const cagr           = (Math.pow(finalMult, 1 / years) - 1) * 100;

console.log(`============================================================`);
console.log(`  EQUITY CURVE`);
console.log(`============================================================`);
console.log(`  Starting capital:    ₹${CAPITAL.toLocaleString('en-IN')}`);
console.log(`  Ending capital:      ₹${Math.round(equity).toLocaleString('en-IN')}`);
console.log(`  Total return:        ${totalReturnPct.toFixed(1)}%  (${finalMult.toFixed(2)}×)`);
console.log(`  CAGR:                ${cagr.toFixed(1)}%/yr  over ${years.toFixed(2)} years`);
console.log(`  Peak equity:         ₹${Math.round(peak).toLocaleString('en-IN')}`);
console.log(`  Max drawdown:        ₹${Math.round(maxDDAbs).toLocaleString('en-IN')}  (${maxDDPct.toFixed(1)}%)`);
console.log();
console.log(`  Trades:              ${trades.length} (${wins} wins / ${losses} losses)`);
console.log(`  Win rate:            ${((wins / trades.length) * 100).toFixed(1)}%`);
console.log(`  Best trade:          ${bestTrade.date} ${bestTrade.type} ${bestTrade.mult}× → +₹${Math.round(bestTrade.pnl).toLocaleString('en-IN')}`);
console.log(`  Worst trade:         ${worstTrade.date} ${worstTrade.type} ${worstTrade.mult}× → ₹${Math.round(worstTrade.pnl).toLocaleString('en-IN')}`);
console.log();

// Year-end snapshots
console.log(`  Equity at year-end:`);
const byYear = {};
for (const p of equityPoints) {
  const y = p.date.split('-')[0];
  byYear[y] = p.equity;
}
const years_arr = Object.keys(byYear).sort();
let prev = CAPITAL;
for (const y of years_arr) {
  const e = byYear[y];
  const yr = ((e / prev - 1) * 100).toFixed(1);
  console.log(`    ${y}: ₹${Math.round(e).toLocaleString('en-IN').padStart(12)}  (${yr.padStart(6)}% YoY)`);
  prev = e;
}

if (LOT_PRINT) {
  console.log('\n  Full trade ledger:');
  let bal = CAPITAL;
  for (const t of trades) {
    const bet = bal * (PCT / 100);
    const pnl = bet * (t.multiplier - 1);
    bal += pnl;
    console.log(`    ${t.date}  ${t.type.padEnd(4)}  ${(t.multiplier+'x').padStart(7)}  ${(t.reason||'').padEnd(12)}  bet ₹${Math.round(bet).toString().padStart(6)}  pnl ${(pnl>=0?'+':'')}${Math.round(pnl).toString().padStart(6)}  bal ₹${Math.round(bal).toLocaleString('en-IN')}`);
  }
}

function daysBetween(a, b) {
  const da = new Date(a + 'T00:00:00Z').getTime();
  const db = new Date(b + 'T00:00:00Z').getTime();
  return Math.round((db - da) / 86400000);
}
