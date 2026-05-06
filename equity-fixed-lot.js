/**
 * Fixed-lot equity calc for the daily/regular-order backtest.
 *
 * Unlike equity-curve.js (which uses % sizing), this assumes you trade
 * exactly 1 lot per signal, with brokerage subtracted per round-trip.
 * Reports NET ₹ P&L after fees.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Args: [reportPath] [--lots=N]
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
const REPORT_PATH = path.resolve(args[0] || './backtest-daily-results.json');
const CAPITAL     = Number(process.env.CAPITAL_TOTAL || 50000);
const LOTS_MULT   = Number((flags.find(f => f.startsWith('--lots='))    || '--lots=1').split('=')[1])    || 1;
const BROKERAGE   = Number((flags.find(f => f.startsWith('--brokerage='))|| '--brokerage=30').split('=')[1]) || 30;

if (!fs.existsSync(REPORT_PATH)) {
  console.error(`No report at ${REPORT_PATH}.`);
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
const trades = (report.trades || []).slice().sort((a, b) => a.entryTimestamp - b.entryTimestamp);

if (!trades.length) { console.error('No trades.'); process.exit(1); }

console.log(`\nFIXED-LOT P&L — ${trades.length} trades from ${trades[0].date} → ${trades[trades.length-1].date}`);
console.log(`Starting capital: ₹${CAPITAL.toLocaleString('en-IN')}   Lots/trade: ${LOTS_MULT}   Brokerage: ₹${BROKERAGE}/order\n`);

let equity = CAPITAL;
let peak = CAPITAL;
let maxDDPct = 0, maxDDAbs = 0;
let wins = 0, losses = 0;
let grossSum = 0, brokerageSum = 0;
let bestTrade = null, worstTrade = null;
let consecLoss = 0, longestLossStreak = 0;
const byMonth = {};

for (const t of trades) {
  // Compute fresh so --lots multiplier applies. Default lot 65 (NIFTY); use t.lotSize if set.
  const baseLot = (t.lotSize || 65);
  const lot     = baseLot * LOTS_MULT;
  const grossAbs   = (t.exitPrice - t.entryPrice) * lot;
  const brokerage  = BROKERAGE * 2;  // round-trip, flat per-order regardless of lots
  const netAbs     = grossAbs - brokerage;

  equity += netAbs;
  grossSum += grossAbs;
  brokerageSum += brokerage;

  if (netAbs > 0) { wins++; consecLoss = 0; }
  else            { losses++; consecLoss++; if (consecLoss > longestLossStreak) longestLossStreak = consecLoss; }

  if (!bestTrade || netAbs > bestTrade.net) bestTrade = { date: t.date, type: t.type, mult: t.multiplier, net: netAbs };
  if (!worstTrade || netAbs < worstTrade.net) worstTrade = { date: t.date, type: t.type, mult: t.multiplier, net: netAbs };

  if (equity > peak) peak = equity;
  const ddAbs = peak - equity;
  const ddPct = peak > 0 ? (ddAbs / peak) * 100 : 0;
  if (ddPct > maxDDPct) { maxDDPct = ddPct; maxDDAbs = ddAbs; }

  const ym = t.date.slice(0, 7);
  byMonth[ym] = byMonth[ym] || { trades: 0, net: 0 };
  byMonth[ym].trades++;
  byMonth[ym].net += netAbs;
}

const totalReturnPct = ((equity / CAPITAL) - 1) * 100;
const finalMult      = equity / CAPITAL;
const days           = Math.max(1, Math.round((new Date(trades[trades.length-1].date) - new Date(trades[0].date)) / 86400000));
const years          = days / 365;
const cagr           = (Math.pow(finalMult, 1 / years) - 1) * 100;

console.log(`============================================================`);
console.log(`  FIXED 1-LOT P&L (NET, after brokerage)`);
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
console.log(`  Longest loss streak: ${longestLossStreak}`);
console.log(`  Gross P&L:           ₹${Math.round(grossSum).toLocaleString('en-IN')}`);
console.log(`  Brokerage paid:      ₹${Math.round(brokerageSum).toLocaleString('en-IN')}  (${trades.length} × ₹60 round-trip)`);
console.log(`  Net P&L per trade:   ₹${Math.round((equity - CAPITAL) / trades.length).toLocaleString('en-IN')}`);
console.log();
console.log(`  Best trade:          ${bestTrade.date} ${bestTrade.type} ${bestTrade.mult}× → ₹${Math.round(bestTrade.net).toLocaleString('en-IN')}`);
console.log(`  Worst trade:         ${worstTrade.date} ${worstTrade.type} ${worstTrade.mult}× → ₹${Math.round(worstTrade.net).toLocaleString('en-IN')}`);
console.log();

console.log(`  Monthly breakdown (recent 12):`);
const months = Object.keys(byMonth).sort().slice(-12);
for (const m of months) {
  const d = byMonth[m];
  const sign = d.net >= 0 ? '+' : '';
  console.log(`    ${m}:  ${String(d.trades).padStart(3)} trades   ${sign}₹${Math.round(d.net).toLocaleString('en-IN').padStart(10)}`);
}
