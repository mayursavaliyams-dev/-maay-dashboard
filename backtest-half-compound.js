/**
 * Half-Kelly compounding: 50% of each profit reinvested, 50% kept as safe reserve.
 *   - Active equity grows by +50% of profits (used for position sizing)
 *   - Reserve accumulates +50% of profits (locked away)
 *   - Losses come out of active equity in full (reserve protected)
 *   - Final total = active + reserve
 *
 * Position cap: ₹0–2,500 (proven optimal earlier)
 * Sizing: lots = floor(active × 5% / cost), capped at 25 lots / ₹2,500
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const FILES = [
  ['NIFTY',     'backtest-daily-results-nifty-2y-2024-05-04-to-2026-05-04.json'],
  ['BANKNIFTY', 'backtest-daily-results-banknifty-2y-2024-05-04-to-2026-05-04.json'],
  ['SENSEX',    'backtest-daily-results-sensex-2y-2024-05-04-to-2026-05-04.json'],
];

const POSITION_CAP_INR = 2500;
const LOTS  = { NIFTY: 65,  BANKNIFTY: 30,  SENSEX: 20 };
const MAX_PREM = {
  NIFTY:     POSITION_CAP_INR / LOTS.NIFTY,      // ₹38.46
  BANKNIFTY: POSITION_CAP_INR / LOTS.BANKNIFTY,  // ₹83.33
  SENSEX:    POSITION_CAP_INR / LOTS.SENSEX,     // ₹125
};
const PROFIT_REINVEST_PCT = 0.50;
const RISK_PCT            = 0.05;
const MAX_CONSEC_LOSSES   = 8;
const MAX_LOTS_PER_TRADE  = 25;
const BROKERAGE_RT        = 60;
const NUM_EXPIRIES        = 1200;
const CAP_PER_INST_INR    = 50000 / 3;

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
  all.sort((a,b) => a.entryTimestamp - b.entryTimestamp);
  const recent = all.slice(-NUM_EXPIRIES);

  let active  = CAP_PER_INST_INR;          // equity used for sizing
  let reserve = 0;                         // safe profit pile
  let consecLoss = 0, halted = null;
  let totalWins = 0, totalLoss = 0;
  let peakTotal = active, maxDD = 0;
  const trades = [];

  for (const t of recent) {
    if (halted) break;
    const cost = t.entryPrice * lotSz;
    if (cost > POSITION_CAP_INR) continue;
    if (active < cost) { halted = `active equity (₹${active.toFixed(0)}) below trade cost`; break; }
    const lotsRaw = Math.max(1, Math.floor((active * RISK_PCT) / cost));
    const budgetLots = Math.max(1, Math.floor(POSITION_CAP_INR / cost));
    const affordableLots = Math.max(1, Math.floor(active / cost));
    const lots = Math.min(lotsRaw, budgetLots, affordableLots, MAX_LOTS_PER_TRADE);
    const grossPnL = (t.exitPrice - t.entryPrice) * lotSz * lots;
    const netPnL = grossPnL - BROKERAGE_RT;

    const win = netPnL > 0;
    const activeBefore = active, reserveBefore = reserve;
    if (win) {
      const toReserve = netPnL * PROFIT_REINVEST_PCT;
      const toActive  = netPnL - toReserve;
      active  += toActive;
      reserve += toReserve;
      totalWins++; consecLoss = 0;
    } else {
      active += netPnL;
      totalLoss++; consecLoss++;
    }

    const total = active + reserve;
    if (total > peakTotal) peakTotal = total;
    if (peakTotal - total > maxDD) maxDD = peakTotal - total;

    trades.push({
      instrument: name,
      date: ymd(t.entryTimestamp), day: DAY(t.entryTimestamp), time: HHMM(t.entryTimestamp),
      side: t.type, strike: t.strike || '',
      entry: +t.entryPrice.toFixed(2), exit: +t.exitPrice.toFixed(2),
      mult: +(t.exitPrice/t.entryPrice).toFixed(3),
      lots, qty: lots*lotSz,
      position: +(cost*lots).toFixed(0),
      gross: +grossPnL.toFixed(0), net: +netPnL.toFixed(0),
      result: win ? 'WIN' : 'LOSS',
      reason: t.exitReason || (t.netPnlPct < 0 && t.exitPrice < t.entryPrice * 0.94 ? 'STOP_LOSS' : 'OTHER'),
      activeBefore: +activeBefore.toFixed(0),
      activeAfter: +active.toFixed(0),
      reserveAfter: +reserve.toFixed(0),
      total: +total.toFixed(0),
      consec: consecLoss,
    });
    if (consecLoss >= MAX_CONSEC_LOSSES) { halted = `consec-loss after ${ymd(t.entryTimestamp)}`; break; }
  }

  return {
    name, trades,
    init: CAP_PER_INST_INR,
    finalActive: active, finalReserve: reserve, finalTotal: active+reserve,
    netPnL: (active+reserve) - CAP_PER_INST_INR,
    mult: (active+reserve)/CAP_PER_INST_INR,
    winRate: trades.length ? totalWins/trades.length*100 : 0,
    wins: totalWins, losses: totalLoss, maxDD, halted, count: trades.length,
  };
}

const FMT_INR  = '"₹"#,##0;[Red]"-₹"#,##0';
const FMT_PCT  = '0.0%';
const FMT_PCTC = '0.00%;[Red]-0.00%';
const FMT_MULT = '0.00"×"';

console.log(`\n══════════════════════════════════════════════════════════════════`);
console.log(`  HALF-COMPOUND BACKTEST (${PROFIT_REINVEST_PCT*100}% of profit reserved)`);
console.log(`  Position cap ₹${POSITION_CAP_INR}, ${NUM_EXPIRIES} most-recent expiries`);
console.log(`══════════════════════════════════════════════════════════════════\n`);
console.log(`Instrument   Trades  Wins  Loss  Win%   Active     Reserve     Total       Mult     NetPnL`);
console.log('-'.repeat(105));

const wb = XLSX.utils.book_new();
const HEAD = ['#','Date','Day','Time','Side','Strike','Entry','Exit','Mult','Lots','Qty','Position','Gross','Net','Result','Reason','ActiveBefore','ActiveAfter','ReserveAfter','TotalAfter'];

const results = [];
let totInit=0, totActive=0, totReserve=0, totTrades=0, totWins=0;
for (const [name, file] of FILES) {
  const r = simulate(name, file);
  results.push(r);
  totInit += r.init; totActive += r.finalActive; totReserve += r.finalReserve;
  totTrades += r.count; totWins += r.wins;
  console.log(
    `${r.name.padEnd(12)} ${String(r.count).padStart(6)}  ${String(r.wins).padStart(4)}  ${String(r.losses).padStart(4)}  ${r.winRate.toFixed(1).padStart(4)}%  ` +
    `₹${r.finalActive.toFixed(0).padStart(8)}  ₹${r.finalReserve.toFixed(0).padStart(8)}  ₹${r.finalTotal.toFixed(0).padStart(9)}  ${r.mult.toFixed(2).padStart(5)}×  ${r.netPnL>=0?'+':''}₹${r.netPnL.toFixed(0).padStart(9)}`
  );

  // Per-instrument tab
  const rows = [HEAD];
  for (let i=0; i<r.trades.length; i++) {
    const t = r.trades[i];
    rows.push([i+1, t.date, t.day, t.time, t.side, t.strike, t.entry, t.exit, t.mult, t.lots, t.qty, t.position, t.gross, t.net, t.result, t.reason, t.activeBefore, t.activeAfter, t.reserveAfter, t.total]);
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:5},{wch:11},{wch:5},{wch:6},{wch:5},{wch:7},{wch:8},{wch:8},{wch:8},{wch:5},{wch:6},{wch:11},{wch:11},{wch:11},{wch:7},{wch:11},{wch:13},{wch:13},{wch:13},{wch:13}];
  const fmts = {6:'"₹"0.00', 7:'"₹"0.00', 8:FMT_MULT, 11:FMT_INR, 12:FMT_INR, 13:FMT_INR, 16:FMT_INR, 17:FMT_INR, 18:FMT_INR, 19:FMT_INR};
  for (let r2=1; r2<rows.length; r2++) for (const [c,f] of Object.entries(fmts)) {
    const ref = XLSX.utils.encode_cell({r:r2, c:Number(c)});
    if (ws[ref]) ws[ref].z = f;
  }
  XLSX.utils.book_append_sheet(wb, ws, name);
}
console.log('-'.repeat(105));
console.log(`TOTAL          ${String(totTrades).padStart(6)}  ${String(totWins).padStart(4)}        ${(totWins/totTrades*100).toFixed(1).padStart(4)}%  ` +
  `₹${totActive.toFixed(0).padStart(8)}  ₹${totReserve.toFixed(0).padStart(8)}  ₹${(totActive+totReserve).toFixed(0).padStart(9)}  ${((totActive+totReserve)/totInit).toFixed(2).padStart(5)}×`);

// Combined summary tab
const all = [];
for (const r of results) for (const t of r.trades) all.push(t);
all.sort((a,b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
const SH = ['#','Date','Day','Time','Instrument','Side','Strike','Entry','Exit','Mult','Lots','Qty','Position','Net','Result','PortfolioActive','PortfolioReserve','PortfolioTotal'];
const sumRows = [SH];
let portActive=50000, portReserve=0;
for (let i=0; i<all.length; i++) {
  const t = all[i];
  if (t.result==='WIN') {
    portReserve += t.net * PROFIT_REINVEST_PCT;
    portActive  += t.net * (1 - PROFIT_REINVEST_PCT);
  } else {
    portActive += t.net;
  }
  sumRows.push([i+1, t.date, t.day, t.time, t.instrument, t.side, t.strike, t.entry, t.exit, t.mult, t.lots, t.qty, t.position, t.net, t.result, +portActive.toFixed(0), +portReserve.toFixed(0), +(portActive+portReserve).toFixed(0)]);
}
const wsSum = XLSX.utils.aoa_to_sheet(sumRows);
wsSum['!cols'] = [{wch:5},{wch:11},{wch:5},{wch:6},{wch:11},{wch:5},{wch:7},{wch:8},{wch:8},{wch:8},{wch:5},{wch:6},{wch:11},{wch:11},{wch:7},{wch:13},{wch:13},{wch:13}];
const sumFmts = {7:'"₹"0.00', 8:'"₹"0.00', 9:FMT_MULT, 12:FMT_INR, 13:FMT_INR, 15:FMT_INR, 16:FMT_INR, 17:FMT_INR};
for (let r=1; r<sumRows.length; r++) for (const [c,f] of Object.entries(sumFmts)) {
  const ref = XLSX.utils.encode_cell({r, c:Number(c)});
  if (wsSum[ref]) wsSum[ref].z = f;
}

const wb2 = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb2, wsSum, 'Step-Up Combined');
for (const sn of ['NIFTY','BANKNIFTY','SENSEX']) XLSX.utils.book_append_sheet(wb2, wb.Sheets[sn], sn);

const outPath = path.resolve(`exports/win-loss-tabs/${NUM_EXPIRIES}-expiries-half-compound.xlsx`);
XLSX.writeFile(wb2, outPath);
console.log(`\nSaved → ${outPath}\nTabs: Step-Up Combined, NIFTY, BANKNIFTY, SENSEX`);
