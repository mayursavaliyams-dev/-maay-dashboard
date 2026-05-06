/**
 * 500-expiries backtest, ₹0-15,000 position-size cap.
 *   NIFTY (lot 65):     ₹15,000 → max premium ₹230/share
 *   BANKNIFTY (lot 30): ₹15,000 → max premium ₹500/share
 *   SENSEX (lot 20):    ₹15,000 → max premium ₹750/share
 *
 * Outputs Excel with chronological "step-up" view per instrument
 * (each row = one expiry, running equity at every step).
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const FILES = [
  ['NIFTY',     'backtest-daily-results-nifty-2y-2024-05-04-to-2026-05-04.json'],
  ['BANKNIFTY', 'backtest-daily-results-banknifty-2y-2024-05-04-to-2026-05-04.json'],
  ['SENSEX',    'backtest-daily-results-sensex-2y-2024-05-04-to-2026-05-04.json'],
];

const POSITION_CAP_INR = 2500;          // ₹0–2,500 per trade
const LOTS  = { NIFTY: 65,  BANKNIFTY: 30,  SENSEX: 20  };
const MAX_PREM = {
  NIFTY:     POSITION_CAP_INR / LOTS.NIFTY,      // ₹230
  BANKNIFTY: POSITION_CAP_INR / LOTS.BANKNIFTY,  // ₹500
  SENSEX:    POSITION_CAP_INR / LOTS.SENSEX,     // ₹750
};
const NUM_EXPIRIES        = 500;
const CAP_PER_INST_INR    = 50000 / 3;
const RISK_PCT            = 0.05;
const MAX_CONSEC_LOSSES   = 8;
const MAX_LOTS_PER_TRADE  = 25;
const MAX_DAILY_LOSS_PCT  = 0.05;
const BROKERAGE_RT        = 60;

const ymd  = ts => new Date(ts*1000 + 5.5*3600000).toISOString().slice(0,10);
const HHMM = ts => { const d = new Date(ts*1000 + 5.5*3600000); return String(d.getUTCHours()).padStart(2,'0')+':'+String(d.getUTCMinutes()).padStart(2,'0'); };
const DAY  = ts => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(ts*1000 + 5.5*3600000).getUTCDay()];

function simulate(name, file) {
  const lotSz = LOTS[name];
  const maxPrem = MAX_PREM[name];
  const data = require('./'+file);
  const all = (data.trades || []).filter(t =>
    t.status === 'OK' && typeof t.entryPrice === 'number' && typeof t.exitPrice === 'number'
    && t.entryTimestamp && t.entryPrice >= 0 && t.entryPrice <= maxPrem
  );
  // Take LAST 500 expiries (most-recent)
  all.sort((a,b) => a.entryTimestamp - b.entryTimestamp);
  const recent = all.slice(-NUM_EXPIRIES);

  let equity = CAP_PER_INST_INR;
  let consecLoss = 0;
  let halted = null;
  let totalWins = 0, totalLoss = 0;
  let peak = equity, maxDD = 0;
  const trades = [];
  let lastDay = null, dayStartEq = equity, dayPnl = 0;

  for (const t of recent) {
    if (halted) break;
    const day = ymd(t.entryTimestamp);
    if (day !== lastDay) { dayStartEq = equity; dayPnl = 0; lastDay = day; }
    if (dayPnl < -dayStartEq * MAX_DAILY_LOSS_PCT) continue;

    const cost = t.entryPrice * lotSz;
    if (cost > POSITION_CAP_INR) continue;
    const affordableLots = Math.max(1, Math.floor(equity / cost));
    const budgetLots = Math.max(1, Math.floor(POSITION_CAP_INR / cost));
    const compoundLots = Math.max(1, Math.floor((equity * RISK_PCT) / cost));
    const lots = Math.min(compoundLots, budgetLots, affordableLots, MAX_LOTS_PER_TRADE);
    const grossPnL = (t.exitPrice - t.entryPrice) * lotSz * lots;
    const netPnL = grossPnL - BROKERAGE_RT;
    const eqBefore = equity;
    equity += netPnL;
    dayPnl += netPnL;
    const win = netPnL > 0;
    if (win) { totalWins++; consecLoss = 0; } else { totalLoss++; consecLoss++; }
    if (equity > peak) peak = equity;
    if (peak - equity > maxDD) maxDD = peak - equity;

    trades.push({
      instrument: name,
      date: day,
      day: DAY(t.entryTimestamp),
      time: HHMM(t.entryTimestamp),
      side: t.type,
      strike: t.strike || '',
      entry: +t.entryPrice.toFixed(2),
      exit: +t.exitPrice.toFixed(2),
      mult: +(t.exitPrice/t.entryPrice).toFixed(3),
      lots,
      qty: lots * lotSz,
      position: +(cost*lots).toFixed(0),
      gross: +grossPnL.toFixed(0),
      net: +netPnL.toFixed(0),
      result: win ? 'WIN' : 'LOSS',
      reason: t.exitReason || (t.netPnlPct < 0 && t.exitPrice < t.entryPrice * 0.94 ? 'STOP_LOSS' : 'OTHER'),
      eqBefore: +eqBefore.toFixed(0),
      eqAfter: +equity.toFixed(0),
      consec: consecLoss,
    });
    if (consecLoss >= MAX_CONSEC_LOSSES) { halted = `consec-loss after ${day}`; break; }
  }

  return {
    name, trades,
    init: CAP_PER_INST_INR, final: equity, mult: equity/CAP_PER_INST_INR,
    netPnL: equity - CAP_PER_INST_INR,
    winRate: trades.length ? totalWins/trades.length*100 : 0,
    wins: totalWins, losses: totalLoss, maxDD, halted, count: trades.length,
  };
}

const outDir = path.resolve('exports/win-loss-tabs');
fs.mkdirSync(outDir, { recursive: true });

console.log(`\n══════════════════════════════════════════════════════════════════`);
console.log(`  500-EXPIRY BACKTEST  •  ₹15,000 max position`);
console.log(`  Caps: NIFTY ₹${MAX_PREM.NIFTY}/share  BANKNIFTY ₹${MAX_PREM.BANKNIFTY}/share  SENSEX ₹${MAX_PREM.SENSEX}/share`);
console.log(`══════════════════════════════════════════════════════════════════\n`);
console.log(`Instrument   Expiries  Wins  Loss  Win%   Init      Final          Mult    NetPnL         MaxDD       Halt?`);
console.log('-'.repeat(115));

const results = [];
const FMT_INR = '"₹"#,##0;[Red]"-₹"#,##0';
const FMT_PCT = '0.0%';
const FMT_PCTC = '0.00%;[Red]-0.00%';
const FMT_MULT = '0.00"×"';

const wb = XLSX.utils.book_new();
let totInit=0, totFinal=0, totNet=0, totTrades=0, totWins=0;
const HEAD = ['#','Date','Day','Time','Side','Strike','Entry','Exit','Mult','Lots','Qty','Position','Gross','Net','Result','Reason','EqBefore','EqAfter','StepUp'];

for (const [name, file] of FILES) {
  const r = simulate(name, file);
  totInit += r.init; totFinal += r.final; totNet += r.netPnL;
  totTrades += r.count; totWins += r.wins;
  results.push(r);
  console.log(
    `${r.name.padEnd(12)} ${String(r.count).padStart(8)}  ${String(r.wins).padStart(4)}  ${String(r.losses).padStart(4)}  ${r.winRate.toFixed(1).padStart(4)}%  ` +
    `₹${r.init.toFixed(0).padStart(7)}  ₹${r.final.toFixed(0).padStart(11)}  ${r.mult.toFixed(2).padStart(6)}×  ` +
    `${r.netPnL>=0?'+':''}₹${r.netPnL.toFixed(0).padStart(10)}  ₹${r.maxDD.toFixed(0).padStart(8)}  ${r.halted ? '⛔ '+r.halted : 'no'}`
  );

  // Per-instrument tab with step-up equity
  const rows = [HEAD];
  let prevEq = r.init;
  for (let i=0; i<r.trades.length; i++) {
    const t = r.trades[i];
    const stepUp = (t.eqAfter - prevEq) / prevEq;
    prevEq = t.eqAfter;
    rows.push([i+1, t.date, t.day, t.time, t.side, t.strike, t.entry, t.exit, t.mult, t.lots, t.qty, t.position, t.gross, t.net, t.result, t.reason, t.eqBefore, t.eqAfter, +stepUp.toFixed(4)]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:5},{wch:11},{wch:5},{wch:6},{wch:5},{wch:7},{wch:8},{wch:8},{wch:8},{wch:5},{wch:6},{wch:11},{wch:11},{wch:11},{wch:7},{wch:11},{wch:11},{wch:11},{wch:9}];
  const fmts = {6:'"₹"0.00', 7:'"₹"0.00', 8:FMT_MULT, 11:FMT_INR, 12:FMT_INR, 13:FMT_INR, 16:FMT_INR, 17:FMT_INR, 18:FMT_PCTC};
  for (let r2=1; r2<rows.length; r2++) for (const [c,f] of Object.entries(fmts)) {
    const ref = XLSX.utils.encode_cell({r:r2, c:Number(c)});
    if (ws[ref]) ws[ref].z = f;
  }
  XLSX.utils.book_append_sheet(wb, ws, name);
}

console.log('-'.repeat(115));
console.log(`TOTAL          ${String(totTrades).padStart(8)}  ${String(totWins).padStart(4)}        ${(totWins/totTrades*100).toFixed(1).padStart(4)}%  ` +
  `₹${totInit.toFixed(0).padStart(7)}  ₹${totFinal.toFixed(0).padStart(11)}  ${(totFinal/totInit).toFixed(2).padStart(6)}×  ${totNet>=0?'+':''}₹${totNet.toFixed(0).padStart(10)}`);

// Combined Step-Up Summary tab — all 3 instruments interleaved chronologically
const allTrades = [];
for (const r of results) for (const t of r.trades) allTrades.push(t);
allTrades.sort((a,b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
const SUM_HEAD = ['#','Date','Day','Time','Instrument','Side','Strike','Entry','Exit','Mult','Lots','Qty','Position','Net','Result','EqAfter','PortfolioRunning'];
const sumRows = [SUM_HEAD];
let portRun = 50000;
for (let i=0; i<allTrades.length; i++) {
  const t = allTrades[i];
  portRun += t.net;
  sumRows.push([i+1, t.date, t.day, t.time, t.instrument, t.side, t.strike, t.entry, t.exit, t.mult, t.lots, t.qty, t.position, t.net, t.result, t.eqAfter, +portRun.toFixed(0)]);
}
const wsSum = XLSX.utils.aoa_to_sheet(sumRows);
wsSum['!cols'] = [{wch:5},{wch:11},{wch:5},{wch:6},{wch:11},{wch:5},{wch:7},{wch:8},{wch:8},{wch:8},{wch:5},{wch:6},{wch:11},{wch:11},{wch:7},{wch:11},{wch:13}];
const sumFmts = {7:'"₹"0.00', 8:'"₹"0.00', 9:FMT_MULT, 12:FMT_INR, 13:FMT_INR, 15:FMT_INR, 16:FMT_INR};
for (let r=1; r<sumRows.length; r++) for (const [c,f] of Object.entries(sumFmts)) {
  const ref = XLSX.utils.encode_cell({r, c:Number(c)});
  if (wsSum[ref]) wsSum[ref].z = f;
}

const wb2 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb2, wsSum, 'Step-Up Combined');
for (const sn of ['NIFTY','BANKNIFTY','SENSEX']) XLSX.utils.book_append_sheet(wb2, wb.Sheets[sn], sn);

const outPath = path.join(outDir, '500-expiries-15k-position-step-up.xlsx');
XLSX.writeFile(wb2, outPath);
console.log(`\n${'═'.repeat(115)}\nSaved → ${outPath}\nTabs: Step-Up Combined, NIFTY, BANKNIFTY, SENSEX\nTotal trades: ${allTrades.length}\n`);
