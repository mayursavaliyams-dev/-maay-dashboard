/**
 * ₹2 crore starting balance — 2-year backtest with realistic liquidity cap.
 *
 *   Reality: deep-OTM weekly options have open interest of ~5k-20k contracts.
 *   A 25-lot order = NIFTY 1,625 qty / BANKNIFTY 750 qty / SENSEX 500 qty.
 *   Beyond ~25-50 lots per single strike, slippage explodes.
 *
 *   At ₹2 crore capital, 5% per-trade budget = ₹10 lakh — but 25 lots × ₹38
 *   premium = ₹62,500 max realistic position. So effective per-trade size is
 *   capped by LIQUIDITY, not capital. The strategy stops scaling around
 *   ~₹50L equity for NIFTY-style strikes.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const FILES = [
  ['NIFTY',     'backtest-daily-results-nifty-2y-2024-05-04-to-2026-05-04.json'],
  ['BANKNIFTY', 'backtest-daily-results-banknifty-2y-2024-05-04-to-2026-05-04.json'],
  ['SENSEX',    'backtest-daily-results-sensex-2y-2024-05-04-to-2026-05-04.json'],
];
const STARTING_CAPITAL    = 2_00_00_000;          // ₹2 crore
const POSITION_CAP_INR    = 2500;                 // per-share-cap × lot = ₹2,500 max position size
const LOTS                = { NIFTY: 65, BANKNIFTY: 30, SENSEX: 20 };
const RISK_PCT            = 0.05;                 // 5% of equity per trade
const MAX_LOTS_PER_TRADE  = 25;                   // realistic liquidity ceiling
const MAX_CONSEC_LOSSES   = 8;
const SLIP_PCT            = 0.02;
const BROKERAGE_RT        = 60;
const NUM_EXPIRIES        = 1200;

const CAP_PER_INST = STARTING_CAPITAL / 3;        // ~₹66.67 L per instrument
const fmtINR = n => Math.abs(n)>=1e7 ? '₹'+(n/1e7).toFixed(2)+'Cr' : Math.abs(n)>=1e5 ? '₹'+(n/1e5).toFixed(2)+'L' : '₹'+Math.round(n).toLocaleString('en-IN');

function simulate(name, file) {
  const lotSz = LOTS[name];
  const maxPrem = POSITION_CAP_INR / lotSz;
  const data = require('./'+file);
  const all = (data.trades || [])
    .filter(t => t.status === 'OK' && typeof t.entryPrice === 'number'
        && typeof t.exitPrice === 'number' && t.entryTimestamp
        && t.entryPrice > 0 && t.entryPrice <= maxPrem)
    .sort((a,b) => a.entryTimestamp - b.entryTimestamp)
    .slice(-NUM_EXPIRIES);

  let equity = CAP_PER_INST;
  let consec = 0, halted = null;
  let wins=0, losses=0;
  let peak = equity, maxDD = 0;
  let totalLotsDeployed = 0;
  let liquidityCappedCount = 0;

  for (const t of all) {
    if (halted) break;
    const cost = t.entryPrice * lotSz;
    if (cost <= 0) continue;

    // Compound budget says: 5% × equity / cost-per-lot
    const budgetLots = Math.floor((equity * RISK_PCT) / cost);
    const compound = Math.max(1, budgetLots);

    // Liquidity ceiling
    const lots = Math.min(compound, MAX_LOTS_PER_TRADE);
    if (compound > MAX_LOTS_PER_TRADE) liquidityCappedCount++;

    const entryFill = t.entryPrice * (1 + SLIP_PCT);
    const exitPrice = t.exitPrice * (1 - SLIP_PCT);
    const grossPnL = (exitPrice - entryFill) * lotSz * lots;
    const netPnL = grossPnL - BROKERAGE_RT;

    equity += netPnL;
    totalLotsDeployed += lots;
    if (equity > peak) peak = equity;
    if (peak - equity > maxDD) maxDD = peak - equity;
    if (netPnL > 0) { wins++; consec = 0; } else { losses++; consec++; }
    if (consec >= MAX_CONSEC_LOSSES) { halted = `consec-loss after ${new Date((t.entryTimestamp||0)*1000+5.5*3600000).toISOString().slice(0,10)}`; break; }
  }

  return {
    name,
    initial: CAP_PER_INST,
    final: equity,
    netPnL: equity - CAP_PER_INST,
    mult: equity / CAP_PER_INST,
    trades: wins + losses,
    wins, losses,
    winRate: (wins+losses) ? +(wins/(wins+losses)*100).toFixed(2) : 0,
    maxDD,
    avgLotsPerTrade: (wins+losses) ? +(totalLotsDeployed / (wins+losses)).toFixed(1) : 0,
    liquidityCappedPct: (wins+losses) ? +(liquidityCappedCount / (wins+losses) * 100).toFixed(0) : 0,
    halted,
  };
}

console.log(`\n══════════════════════════════════════════════════════════════════════════════════════════`);
console.log(`  ₹2 CRORE STARTING BALANCE — 2-YEAR BACKTEST`);
console.log(`  Per-instrument start: ${fmtINR(CAP_PER_INST)}  •  5% sizing, capped at ${MAX_LOTS_PER_TRADE} lots, ₹${POSITION_CAP_INR} per trade max`);
console.log(`══════════════════════════════════════════════════════════════════════════════════════════\n`);
console.log(`Instrument   Trades  Win%   AvgLots  LiqCap%  Initial         Final           Mult     NetPnL          MaxDD      Halt?`);
console.log('-'.repeat(120));

const results = [];
let totInit = 0, totFinal = 0;
for (const [name, file] of FILES) {
  const r = simulate(name, file);
  results.push(r);
  totInit += r.initial; totFinal += r.final;
  console.log(
    `${r.name.padEnd(12)} ${String(r.trades).padStart(6)}  ${r.winRate.toFixed(1).padStart(4)}%  ` +
    `${String(r.avgLotsPerTrade).padStart(6)}   ${String(r.liquidityCappedPct).padStart(4)}%   ` +
    `${fmtINR(r.initial).padStart(11)}    ${fmtINR(r.final).padStart(11)}    ${r.mult.toFixed(2).padStart(5)}×  ` +
    `${r.netPnL>=0?'+':''}${fmtINR(r.netPnL).padStart(10)}    ${fmtINR(r.maxDD).padStart(8)}   ${r.halted ? '⛔ '+r.halted.slice(0,30) : 'no'}`
  );
}
console.log('-'.repeat(120));
console.log(`TOTAL                                                ${fmtINR(totInit).padStart(11)}    ${fmtINR(totFinal).padStart(11)}    ${(totFinal/totInit).toFixed(2).padStart(5)}×  ${(totFinal-totInit)>=0?'+':''}${fmtINR(totFinal-totInit).padStart(10)}`);

console.log(`\n══════════════════════════════════════════════════════════════════════════════════════════`);
console.log(`  REALITY CHECK`);
console.log(`══════════════════════════════════════════════════════════════════════════════════════════`);
console.log(`Starting capital:        ${fmtINR(STARTING_CAPITAL)}`);
console.log(`Capital you risked:      ${fmtINR(totInit)} (deployed across 3 instruments)`);
console.log(`Final capital:           ${fmtINR(totFinal)}`);
console.log(`Absolute return:         ${(totFinal-totInit)>=0?'+':''}${fmtINR(totFinal-totInit)}  (${(((totFinal/totInit)-1)*100).toFixed(1)}%)`);
console.log(`Annualized:              ${(((Math.pow(totFinal/totInit, 1/2))-1)*100).toFixed(1)}% / year`);
console.log();
console.log(`At ₹2 Cr starting, the strategy is HEAVILY liquidity-capped.`);
console.log(`Most trades hit the ${MAX_LOTS_PER_TRADE}-lot ceiling, so absolute ₹ growth is capped at`);
console.log(`roughly the same as ₹50L starting capital. Beyond ₹50L equity, edge stops scaling.`);
console.log();

// Save xlsx
const outDir = path.resolve('exports/win-loss-tabs');
fs.mkdirSync(outDir, { recursive: true });
const wb = XLSX.utils.book_new();
const FMT_INR = '"₹"#,##0;[Red]"-₹"#,##0';
const FMT_MULT = '0.00"×"';
const FMT_PCT = '0.00%';

const sumHead = ['Instrument','Trades','Wins','Losses','WinRate','AvgLots','LiqCap%','Initial','Final','Mult','NetPnL','MaxDD','Halt'];
const sumRows = [sumHead];
for (const r of results) {
  sumRows.push([r.name, r.trades, r.wins, r.losses, r.winRate/100, r.avgLotsPerTrade, r.liquidityCappedPct/100, +r.initial.toFixed(0), +r.final.toFixed(0), r.mult, +r.netPnL.toFixed(0), +r.maxDD.toFixed(0), r.halted || '-']);
}
const wsSum = XLSX.utils.aoa_to_sheet(sumRows);
wsSum['!cols'] = [{wch:11},{wch:7},{wch:6},{wch:7},{wch:8},{wch:8},{wch:8},{wch:14},{wch:14},{wch:7},{wch:14},{wch:13},{wch:30}];
for (let R=1; R<sumRows.length; R++) {
  { const ref = XLSX.utils.encode_cell({r:R, c:4}); if (wsSum[ref]) wsSum[ref].z = FMT_PCT; }
  { const ref = XLSX.utils.encode_cell({r:R, c:6}); if (wsSum[ref]) wsSum[ref].z = FMT_PCT; }
  { const ref = XLSX.utils.encode_cell({r:R, c:9}); if (wsSum[ref]) wsSum[ref].z = FMT_MULT; }
  for (const c of [7,8,10,11]) { const ref = XLSX.utils.encode_cell({r:R, c}); if (wsSum[ref]) wsSum[ref].z = FMT_INR; }
}
XLSX.utils.book_append_sheet(wb, wsSum, 'Summary');
const outPath = path.join(outDir, '2cr-start-2year-backtest.xlsx');
XLSX.writeFile(wb, outPath);
console.log(`Saved → ${outPath}\n`);
