// REAL-premium backtest — NSE bhavcopy daily option OHLC (no modeling).
// Strategy: index gap-and-go direction → nearest-expiry deep-OTM strike (real
// premium ≤ MAXPREM, liquid OI) → BUY at open → exit via 5% SL / 5x target /
// trail(2x,90%), evaluated against the strike's REAL daily High/Low/Close.
// Conservative: assume LOW hits before HIGH (worst case for a long).
const fs = require('fs');
const { BHAV, LOT, loadDay, atmStrike } = require('./bt-lib.js');

const MAXPREM = 38, MINOI = 50000, SL = 0.05, TARGET = 4.0, TRAIL_AT = 2.0, TRAIL_LOCK = 0.90;
const SLIP = 0.02, RISKPCT = 0.05, GAP_THR = 0.15;


function pickStrike(day, type) {
  // deep-OTM: walk away from spot, first liquid strike with real OHLC and open ≤ MAXPREM
  const atm = atmStrike(day, 50);  // using bt-lib's atmStrike with 50-pt interval
  const cands = day.opts.filter(o => o.type === type && o.o > 0.5 && o.o <= MAXPREM && o.oi >= MINOI && o.h > 0 && o.l > 0)
    .filter(o => type === 'CE' ? o.strike > atm : o.strike < atm)
    .sort((a, b) => Math.abs(a.strike - atm) - Math.abs(b.strike - atm)); // nearest OTM first
  return cands[0] || null;
}

// exit using real daily O/H/L/C (conservative: low-before-high)
function resolveExit(entry, o) {
  const tgt = entry * (1 + TARGET);
  const slLvl = entry * (1 - SL);
  // 1. did low breach SL? (assume low first)
  if (o.l <= slLvl) return { exit: slLvl * (1 - SLIP), reason: 'SL' };
  // 2. did high reach 5x target?
  if (o.h >= tgt) return { exit: tgt * (1 - SLIP), reason: 'TARGET' };
  // 3. trail: if high reached 2x, lock 90% of the high's gain; exit at close if below floor
  if (o.h >= entry * TRAIL_AT) {
    const floor = entry + (o.h - entry) * TRAIL_LOCK;
    if (o.c <= floor) return { exit: floor * (1 - SLIP), reason: 'TRAIL' };
  }
  // 4. else exit at close
  return { exit: o.c * (1 - SLIP), reason: 'EOD' };
}

const files = fs.readdirSync(BHAV).filter(f => f.startsWith('nifty-')).sort();
const days = files.map(f => loadDay(BHAV + '/' + f)).filter(Boolean);

console.log(`Loaded ${days.length} real trading days (${days[0].date} → ${days[days.length-1].date})\n`);

let cap = 100000; const trades = [];
let prevClose = null;
for (const day of days) {
  if (prevClose !== null) {
    const gapPct = ((day.underlying - prevClose) / prevClose) * 100;
    let sig = gapPct > GAP_THR ? 'CE' : gapPct < -GAP_THR ? 'PE' : null;
    if (sig) {
      const opt = pickStrike(day, sig);
      if (opt) {
        const entry = opt.o * (1 + SLIP);
        const { exit, reason } = resolveExit(entry, opt);
        const mult = exit / entry;
        const lots = Math.max(1, Math.floor((cap * RISKPCT) / (entry * LOT)));
        const pnl = (mult - 1) * lots * entry * LOT;
        cap += pnl;
        trades.push({ date: day.date, signal: sig, strike: opt.strike, gap: +gapPct.toFixed(2),
          entry: +entry.toFixed(1), exit: +exit.toFixed(1), mult: +mult.toFixed(2), reason,
          pnl: Math.round(pnl), cap: Math.round(cap) });
      }
    }
  }
  prevClose = day.underlying;
}

const wins = trades.filter(t => t.pnl > 0).length;
const net = cap - 100000;
const byR = r => trades.filter(t => t.reason === r).length;
console.log(`===== REAL-PREMIUM BACKTEST (NSE bhavcopy, ${days.length} days) =====`);
console.log(`Trades: ${trades.length} | Win: ${trades.length ? Math.round(100*wins/trades.length) : 0}% | Final: ₹${cap.toLocaleString('en-IN')} | Net: ${net>=0?'+':''}₹${net.toLocaleString('en-IN')}`);
console.log(`Exits: ${byR('TARGET')} TARGET(5x), ${byR('TRAIL')} TRAIL, ${byR('SL')} SL, ${byR('EOD')} EOD`);
if (trades.length) {
  console.log(`Best: +₹${Math.max(...trades.map(t=>t.pnl)).toLocaleString('en-IN')} | Worst: ₹${Math.min(...trades.map(t=>t.pnl)).toLocaleString('en-IN')}`);
  console.log('\nTrade-by-trade:');
  trades.forEach(t => console.log(`  ${t.date} ${t.signal} ${t.strike} (gap ${t.gap}%) ₹${t.entry}→₹${t.exit} ${t.mult}x ${t.reason} → ${t.pnl>=0?'+':''}₹${t.pnl} | cap ₹${t.cap}`));
}
fs.writeFileSync('bt-data/result-real.json', JSON.stringify(trades, null, 1));
console.log('\nSaved: bt-data/result-real.json');
