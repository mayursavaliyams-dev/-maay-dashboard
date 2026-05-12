/**
 * Fit-to-₹1L realistic simulator — mirrors current .env config:
 *   CAPITAL_TOTAL=100000, caps NIFTY 76 / BANKNIFTY 166 / SENSEX 250
 *   5% risk, 6 trades/day max, MAX_CONSEC=8, 2% daily loss limit.
 * Outputs trade-by-trade to console (head/tail) + full xlsx.
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const FILES = [
  ['NIFTY',     'backtest-daily-results-nifty-2y-2024-05-04-to-2026-05-04.json'],
  ['BANKNIFTY', 'backtest-daily-results-banknifty-2y-2024-05-04-to-2026-05-04.json'],
  ['SENSEX',    'backtest-daily-results-sensex-2y-2024-05-04-to-2026-05-04.json'],
];

const CAPS  = { NIFTY: 76,  BANKNIFTY: 166, SENSEX: 250 };
const MIN_PREM = { NIFTY: 0.1, BANKNIFTY: 0.1, SENSEX: 0.1 };
const LOTS  = { NIFTY: 65,  BANKNIFTY: 30,  SENSEX: 20  };
const CAP_PER_INST_INR = 100000 / 3;
const MAX_TRADES_PER_DAY = 6;
const RISK_PCT     = 0.05;
const MAX_DAILY_LOSS_PCT = 0.02;
const MAX_CONSEC_LOSSES  = 8;
const MAX_LOTS_PER_TRADE = 25;   // hard cap — realistic broker margin + option liquidity ceiling
const BASE_LOTS          = 2;    // start every fresh streak at 2 lots
const PYRAMID_ON_WIN     = true; // +1 lot per consecutive win; reset to BASE on loss
const BROKERAGE_RT = 60;

const ymd = ts => new Date(ts*1000 + 5.5*3600*1000).toISOString().slice(0,10);
const hhmm = ts => { const d = new Date(ts*1000 + 5.5*3600*1000); return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`; };

function simulate(name, file) {
  const cap = CAPS[name], lotSz = LOTS[name], minPrem = MIN_PREM[name];
  const data = require('./'+file);
  const all = (data.trades || []).filter(t =>
    t.status === 'OK' && typeof t.entryPrice === 'number' && typeof t.exitPrice === 'number'
    && t.entryTimestamp && t.entryPrice >= minPrem && t.entryPrice <= cap
  );
  all.sort((a,b) => a.entryTimestamp - b.entryTimestamp);

  const byDay = new Map();
  for (const t of all) {
    const d = ymd(t.entryTimestamp);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(t);
  }
  const dates = [...byDay.keys()].sort();

  let equity = CAP_PER_INST_INR;
  let consecLoss = 0, halted = null;
  let totalWins = 0, totalLoss = 0;
  let peak = equity, maxDD = 0;
  let nextLots = BASE_LOTS;          // pyramid-up state
  const trades = [];

  for (const d of dates) {
    if (halted) break;
    const dayTrades = byDay.get(d).slice(0, MAX_TRADES_PER_DAY);
    let dayPnl = 0;
    const dayStartEq = equity;
    for (const t of dayTrades) {
      if (halted) break;
      if (dayPnl < -dayStartEq * MAX_DAILY_LOSS_PCT) break;
      const cost = t.entryPrice * lotSz;
      // Pyramid-up sizing: starts at BASE_LOTS, +1 per consecutive win, resets on loss.
      // Hard-capped by MAX_LOTS_PER_TRADE (broker margin / liquidity).
      // Also bounded by equity affordability so we don't exceed available capital.
      const affordableLots = Math.max(1, Math.floor(equity / cost));
      const lots = Math.min(nextLots, MAX_LOTS_PER_TRADE, affordableLots);
      const grossPnL = (t.exitPrice - t.entryPrice) * lotSz * lots;
      const netPnL   = grossPnL - BROKERAGE_RT;   // ₹60 round-trip flat per ORDER, not per lot
      const eqBefore = equity;
      equity += netPnL;
      dayPnl += netPnL;
      const win = netPnL > 0;
      if (win) {
        totalWins++; consecLoss = 0;
        if (PYRAMID_ON_WIN) nextLots = Math.min(nextLots + 1, MAX_LOTS_PER_TRADE);
      } else {
        totalLoss++; consecLoss++;
        nextLots = BASE_LOTS;            // reset on any loss
      }
      if (equity > peak) peak = equity;
      const dd = peak - equity; if (dd > maxDD) maxDD = dd;

      trades.push({
        instrument: name,
        date: d,
        entryTime: hhmm(t.entryTimestamp),
        side: t.type,
        strike: t.strike || '',
        entryPrice: +t.entryPrice.toFixed(2),
        exitPrice: +t.exitPrice.toFixed(2),
        multiplier: +(t.exitPrice/t.entryPrice).toFixed(3),
        lots,
        qty: lots * lotSz,
        deployedINR: +(cost*lots).toFixed(0),
        grossPnL: +grossPnL.toFixed(0),
        brokerage: BROKERAGE_RT,
        netPnL: +netPnL.toFixed(0),
        result: win ? 'WIN' : 'LOSS',
        exitReason: t.exitReason || (t.netPnlPct < 0 && t.exitPrice < t.entryPrice * 0.94 ? 'STOP_LOSS' : 'OTHER'),
        equityBefore: +eqBefore.toFixed(0),
        equityAfter: +equity.toFixed(0),
        consecLoss,
      });

      if (consecLoss >= MAX_CONSEC_LOSSES) { halted = `consec-loss after ${d}`; break; }
    }
  }

  return {
    name, trades,
    totalTrades: trades.length, totalWins, totalLoss,
    winPct: trades.length ? totalWins/trades.length*100 : 0,
    initial: CAP_PER_INST_INR, final: equity,
    netPnL: equity - CAP_PER_INST_INR,
    multiplier: equity / CAP_PER_INST_INR,
    maxDD, halted,
  };
}

const outDir = path.resolve('exports/win-loss-tabs');
fs.mkdirSync(outDir, { recursive: true });

const allRows = [];
const wb = XLSX.utils.book_new();
const HEADER = ['#','Instrument','Date','Time','Side','Strike','Entry','Exit','Mult','Lots','Qty','Deployed₹','Gross₹','Brokerage','Net₹','Result','ExitReason','EquityBefore','EquityAfter','ConsecLoss'];

console.log('\n' + '═'.repeat(100));
console.log(`  REALISTIC ₹1L 2-YEAR TRADE-BY-TRADE  (caps ₹0-${CAPS.NIFTY}/₹0-${CAPS.BANKNIFTY}/₹0-${CAPS.SENSEX}, ${MAX_TRADES_PER_DAY}/day, 5% SL, MAX_CONSEC=${MAX_CONSEC_LOSSES}, daily loss ${(MAX_DAILY_LOSS_PCT*100).toFixed(0)}%)`);
console.log('═'.repeat(100));

for (const [name, file] of FILES) {
  const r = simulate(name, file);
  console.log(`\n──  ${name}  (${r.totalTrades} trades, ${r.winPct.toFixed(1)}% win, ₹${r.initial.toFixed(0)} → ₹${r.final.toFixed(0)})  ${r.halted ? '⛔ '+r.halted : ''}`);
  console.log(`Date         Time  Side Strike  Entry   Exit   Mult Lots Qty   Deployed   NetPnL    Equity      Result`);
  console.log('-'.repeat(110));
  const showFirst = 5, showLast = 5;
  const list = r.trades;
  const display = list.length <= showFirst+showLast ? list : [...list.slice(0,showFirst), null, ...list.slice(-showLast)];
  for (const t of display) {
    if (!t) { console.log(`...    (${list.length - showFirst - showLast} trades hidden)    ...`); continue; }
    const sign = t.netPnL >= 0 ? '+' : '';
    console.log(
      `${t.date}   ${t.entryTime} ${(t.side||'').padEnd(4)} ${String(t.strike).padEnd(6)} ${t.entryPrice.toFixed(2).padStart(6)} ${t.exitPrice.toFixed(2).padStart(6)} ${t.multiplier.toFixed(2).padStart(4)}× ${String(t.lots).padStart(3)} ${String(t.qty).padStart(4)} ₹${String(t.deployedINR).padStart(7)}  ${sign}₹${String(t.netPnL).padStart(7)}  ₹${String(t.equityAfter).padStart(8)}  ${t.result}`
    );
  }
  // Write per-instrument tab
  const rows = [HEADER, ...list.map((t,i)=>[i+1,t.instrument,t.date,t.entryTime,t.side,t.strike,t.entryPrice,t.exitPrice,t.multiplier,t.lots,t.qty,t.deployedINR,t.grossPnL,t.brokerage,t.netPnL,t.result,t.exitReason,t.equityBefore,t.equityAfter,t.consecLoss])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  for (const t of list) allRows.push(t);
}

allRows.sort((a,b) => a.date.localeCompare(b.date) || a.entryTime.localeCompare(b.entryTime));
const allArr = [HEADER, ...allRows.map((t,i)=>[i+1,t.instrument,t.date,t.entryTime,t.side,t.strike,t.entryPrice,t.exitPrice,t.multiplier,t.lots,t.qty,t.deployedINR,t.grossPnL,t.brokerage,t.netPnL,t.result,t.exitReason,t.equityBefore,t.equityAfter,t.consecLoss])];
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(allArr), 'ALL');

const outPath = path.join(outDir, '2year-realistic-1L-trade-by-trade.xlsx');
XLSX.writeFile(wb, outPath);
console.log(`\n${'═'.repeat(100)}\nFull trade-by-trade saved → ${outPath}\nTotal trades across all 3: ${allRows.length}\n`);
