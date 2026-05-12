/**
 * Side-by-side: position-cap ₹2,500 vs ₹15,000 over last 1,200 expiries.
 *
 *   Both runs use:  same strategy data, 5% SL realized via source `multiplier`,
 *                    1 lot per trade (no compounding to keep it apples-to-apples),
 *                    brokerage ₹60 round-trip per trade.
 *
 *   Difference is ONLY the per-trade premium ceiling:
 *     ₹2,500 cap → NIFTY ₹38, BANKNIFTY ₹83, SENSEX ₹125
 *     ₹15,000 cap → NIFTY ₹230, BANKNIFTY ₹500, SENSEX ₹750
 *
 *   Output: console summary + xlsx with per-cap tabs and a Compare tab.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const FILES = [
  ['NIFTY',     'backtest-daily-results-nifty-2y-2024-05-04-to-2026-05-04.json'],
  ['BANKNIFTY', 'backtest-daily-results-banknifty-2y-2024-05-04-to-2026-05-04.json'],
  ['SENSEX',    'backtest-daily-results-sensex-2y-2024-05-04-to-2026-05-04.json'],
];
const LOTS         = { NIFTY: 65, BANKNIFTY: 30, SENSEX: 20 };
const NUM_EXPIRIES = 1200;
const SLIP_PCT     = 0.02;
const BROKERAGE_RT = 60;
const CAPS = [2500, 15000];     // the two scenarios to compare

function simulate(name, file, capINR) {
  const lotSz = LOTS[name];
  const maxPrem = capINR / lotSz;
  const data = require('./'+file);
  const all = (data.trades || [])
    .filter(t => t.status === 'OK' && typeof t.entryPrice === 'number'
        && typeof t.exitPrice === 'number' && t.entryTimestamp
        && t.entryPrice > 0 && t.entryPrice <= maxPrem)
    .sort((a,b) => a.entryTimestamp - b.entryTimestamp)
    .slice(-NUM_EXPIRIES);

  let wins = 0, losses = 0, totalGross = 0, totalNet = 0;
  let peak = 0, eq = 0, maxDD = 0;
  let bestDay = -Infinity, worstDay = Infinity;
  const trades = [];

  for (const t of all) {
    const entryFill = t.entryPrice * (1 + SLIP_PCT);
    const exitPrice = t.exitPrice * (1 - SLIP_PCT);
    const grossPnL = (exitPrice - entryFill) * lotSz;
    const netPnL = grossPnL - BROKERAGE_RT;

    totalGross += grossPnL;
    totalNet += netPnL;
    eq += netPnL;
    if (eq > peak) peak = eq;
    if (peak - eq > maxDD) maxDD = peak - eq;
    if (netPnL > bestDay) bestDay = netPnL;
    if (netPnL < worstDay) worstDay = netPnL;
    if (netPnL > 0) wins++; else losses++;

    trades.push({
      date: new Date((t.entryTimestamp || 0) * 1000 + 5.5*3600000).toISOString().slice(0,10),
      side: t.type, strike: t.strike,
      entry: +t.entryPrice.toFixed(2),
      exit:  +t.exitPrice.toFixed(2),
      mult:  +(t.exitPrice / t.entryPrice).toFixed(3),
      gross: +grossPnL.toFixed(0),
      net:   +netPnL.toFixed(0),
      eqAfter: +eq.toFixed(0),
    });
  }

  return {
    name, capINR, maxPrem, total: trades.length, wins, losses,
    winRate: trades.length ? +(wins/trades.length*100).toFixed(2) : 0,
    avgNet: trades.length ? +(totalNet/trades.length).toFixed(0) : 0,
    totalGross: +totalGross.toFixed(0),
    totalNet: +totalNet.toFixed(0),
    maxDD: +maxDD.toFixed(0),
    bestDay: trades.length ? +bestDay.toFixed(0) : 0,
    worstDay: trades.length ? +worstDay.toFixed(0) : 0,
    trades,
  };
}

console.log(`\n══════════════════════════════════════════════════════════════════════════════════════════`);
console.log(`  POSITION-SIZE CAP COMPARISON  —  1,200 expiries (per instrument)`);
console.log(`  1 lot fixed per trade  •  5% SL realized in source  •  2% slip  •  ₹60 brokerage`);
console.log(`══════════════════════════════════════════════════════════════════════════════════════════\n`);
console.log(`Instrument  Cap         MaxPrem  Trades  Win%   AvgNet     TotalNet      MaxDD       Best/Worst`);
console.log('-'.repeat(108));

const allResults = {};
for (const [name, file] of FILES) {
  allResults[name] = {};
  for (const cap of CAPS) {
    const r = simulate(name, file, cap);
    allResults[name][cap] = r;
    console.log(
      `${name.padEnd(11)} ₹${String(cap).padStart(5)}     ₹${String(r.maxPrem.toFixed(0)).padStart(5)}    ${String(r.total).padStart(5)}  ${r.winRate.toFixed(1).padStart(4)}%   ` +
      `₹${String(r.avgNet).padStart(7)}   ${r.totalNet>=0?'+':''}₹${String(r.totalNet).padStart(8)}   ` +
      `₹${String(r.maxDD).padStart(7)}   +₹${String(r.bestDay).padStart(6)}/-₹${String(Math.abs(r.worstDay)).padStart(5)}`
    );
  }
  console.log();
}

// Cross-cap comparison
console.log(`══════════════════════════════════════════════════════════════════════════════════════════`);
console.log(`  HEAD-TO-HEAD: ₹2,500 vs ₹15,000`);
console.log(`══════════════════════════════════════════════════════════════════════════════════════════`);
console.log(`Instrument   ₹2,500 NetPnL    ₹15,000 NetPnL    Δ            Winner`);
console.log('-'.repeat(80));
let tot2500 = 0, tot15000 = 0;
for (const name of Object.keys(allResults)) {
  const a = allResults[name][2500].totalNet;
  const b = allResults[name][15000].totalNet;
  tot2500 += a; tot15000 += b;
  const delta = b - a;
  const winner = a > b ? '₹2,500 cap wins' : a < b ? '₹15,000 cap wins' : 'tie';
  console.log(
    `${name.padEnd(12)} ${a>=0?'+':''}₹${String(a).padStart(8)}      ${b>=0?'+':''}₹${String(b).padStart(8)}     ` +
    `${delta>=0?'+':''}₹${String(delta).padStart(8)}    ${winner}`
  );
}
console.log('-'.repeat(80));
console.log(`TOTAL        ${tot2500>=0?'+':''}₹${String(tot2500).padStart(8)}      ${tot15000>=0?'+':''}₹${String(tot15000).padStart(8)}     ${(tot15000-tot2500)>=0?'+':''}₹${String(tot15000-tot2500).padStart(8)}    ${tot2500>tot15000 ? '₹2,500 cap wins' : '₹15,000 cap wins'}`);

// Save xlsx
const outDir = path.resolve('exports/win-loss-tabs');
fs.mkdirSync(outDir, { recursive: true });
const wb = XLSX.utils.book_new();
const FMT_INR = '"₹"#,##0;[Red]"-₹"#,##0';

// Compare tab first
const cmp = [['Instrument','Cap','MaxPrem','Trades','Win%','AvgNet','TotalGross','TotalNet','MaxDD','BestDay','WorstDay']];
for (const name of Object.keys(allResults)) {
  for (const cap of CAPS) {
    const r = allResults[name][cap];
    cmp.push([r.name, r.capINR, r.maxPrem, r.total, r.winRate/100, r.avgNet, r.totalGross, r.totalNet, r.maxDD, r.bestDay, r.worstDay]);
  }
}
const wsCmp = XLSX.utils.aoa_to_sheet(cmp);
wsCmp['!cols'] = [{wch:11},{wch:8},{wch:8},{wch:7},{wch:7},{wch:9},{wch:11},{wch:11},{wch:9},{wch:9},{wch:9}];
for (let R=1; R<cmp.length; R++) {
  for (const c of [1,2]) { const ref = XLSX.utils.encode_cell({r:R, c}); if (wsCmp[ref]) wsCmp[ref].z = '"₹"#,##0'; }
  { const ref = XLSX.utils.encode_cell({r:R, c:4}); if (wsCmp[ref]) wsCmp[ref].z = '0.0%'; }
  for (const c of [5,6,7,8,9,10]) { const ref = XLSX.utils.encode_cell({r:R, c}); if (wsCmp[ref]) wsCmp[ref].z = FMT_INR; }
}
XLSX.utils.book_append_sheet(wb, wsCmp, 'Compare');

// Per-instrument-cap tabs
for (const name of Object.keys(allResults)) {
  for (const cap of CAPS) {
    const r = allResults[name][cap];
    const head = ['#','Date','Side','Strike','Entry','Exit','Mult','Gross₹','Net₹','RunningEq'];
    const rows = [head, ...r.trades.map((t,i)=>[i+1, t.date, t.side, t.strike, t.entry, t.exit, t.mult, t.gross, t.net, t.eqAfter])];
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{wch:5},{wch:11},{wch:5},{wch:7},{wch:8},{wch:8},{wch:7},{wch:11},{wch:11},{wch:11}];
    for (let R=1; R<rows.length; R++) {
      for (const c of [4,5]) { const ref = XLSX.utils.encode_cell({r:R, c}); if (ws[ref]) ws[ref].z = '"₹"0.00'; }
      { const ref = XLSX.utils.encode_cell({r:R, c:6}); if (ws[ref]) ws[ref].z = '0.00"×"'; }
      for (const c of [7,8,9]) { const ref = XLSX.utils.encode_cell({r:R, c}); if (ws[ref]) ws[ref].z = FMT_INR; }
    }
    XLSX.utils.book_append_sheet(wb, ws, `${name}-${cap}`);
  }
}
const outPath = path.join(outDir, 'cap-2500-vs-15000-compare.xlsx');
XLSX.writeFile(wb, outPath);
console.log(`\nSaved → ${outPath}`);
console.log(`Tabs: Compare, NIFTY-2500, NIFTY-15000, BANKNIFTY-2500, BANKNIFTY-15000, SENSEX-2500, SENSEX-15000\n`);
