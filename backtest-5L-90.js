/**
 * ₹5,00,000 starting capital backtest — last 90 expiries, half-compound (50%
 * reserve), shows lot progression. Higher capital → bigger lots (up to the
 * 25-lot liquidity ceiling).
 */
const FILES = [
  ['NIFTY',     'backtest-daily-results-nifty-2y-2024-05-04-to-2026-05-04.json'],
  ['BANKNIFTY', 'backtest-daily-results-banknifty-2y-2024-05-04-to-2026-05-04.json'],
  ['SENSEX',    'backtest-daily-results-sensex-2y-2024-05-04-to-2026-05-04.json'],
];
const LOTS = { NIFTY: 65, BANKNIFTY: 30, SENSEX: 20 };
const MAX_PREM = { NIFTY: 38, BANKNIFTY: 83, SENSEX: 125 };
const START_TOTAL   = 500000;
const CAP_PER_INST  = START_TOTAL / 3;     // ₹1,66,667 each
const RISK_PCT      = 0.05;
const REINVEST      = Number(process.env.RI || 1.0);   // 1.0=full, 0.5=half
const MAX_LOTS      = 25;                   // liquidity ceiling
const MAX_CONSEC    = 8;
const BROKERAGE_RT  = 60;
const NUM_EXPIRIES  = Number(process.env.N || 90);

function load(inst, file) {
  const d = require('./' + file);
  return (d.trades || []).filter(t =>
    t.status === 'OK' && typeof t.entryPrice === 'number' && typeof t.exitPrice === 'number'
    && t.entryTimestamp && t.entryPrice >= 0 && t.entryPrice <= MAX_PREM[inst]
  ).sort((a, b) => a.entryTimestamp - b.entryTimestamp).slice(-NUM_EXPIRIES);
}

function sim(inst, trades) {
  const lotSz = LOTS[inst];
  let active = CAP_PER_INST, reserve = 0, consec = 0, halted = false;
  let wins = 0, losses = 0, maxLots = 0, peakTotal = CAP_PER_INST;
  const lotHist = [];
  for (const t of trades) {
    if (halted) break;
    const cost = t.entryPrice * lotSz;
    if (cost <= 0) continue;
    let lots = Math.max(1, Math.floor((active * RISK_PCT) / cost));
    lots = Math.min(lots, MAX_LOTS);
    maxLots = Math.max(maxLots, lots);
    lotHist.push(lots);
    const qty = lots * lotSz;
    const gross = (t.exitPrice - t.entryPrice) * qty;
    const net = gross - BROKERAGE_RT;
    if (net > 0) { active += net * REINVEST; reserve += net * REINVEST; wins++; consec = 0; }
    else         { active += net; losses++; consec++; if (consec >= MAX_CONSEC) halted = true; }
    peakTotal = Math.max(peakTotal, active + reserve);
  }
  const total = active + reserve;
  const dd = peakTotal > 0 ? (100 * (peakTotal - total) / peakTotal) : 0;
  const avgLots = lotHist.length ? (lotHist.reduce((a, b) => a + b, 0) / lotHist.length) : 0;
  return { trades: wins + losses, wins, losses,
    winRate: ((wins / (wins + losses)) * 100) || 0,
    active, reserve, total, maxLots, avgLots, halted,
    drawdown: dd };
}

const fmt = n => '₹' + Math.round(n).toLocaleString('en-IN');
console.log('\n══════════════════════════════════════════════════════════════════════════');
console.log(`  ₹5,00,000 CAPITAL · LAST ${NUM_EXPIRIES} EXPIRIES · half-compound · 25-lot ceiling`);
console.log(`  ₹1,66,667 per instrument · 5% risk · ₹38/83/125 premium caps`);
console.log('══════════════════════════════════════════════════════════════════════════');
console.log('Inst        Trades  Win%   AvgLots MaxLots  Active      Reserve     Total       MaxDD  Halt');
console.log('----------------------------------------------------------------------------------------------');
let gTotal = 0, gStart = 0;
for (const [inst, file] of FILES) {
  const r = sim(inst, load(inst, file));
  gTotal += r.total; gStart += CAP_PER_INST;
  console.log(
    inst.padEnd(11) +
    String(r.trades).padStart(5) + '  ' +
    (r.winRate.toFixed(1) + '%').padStart(5) + '  ' +
    r.avgLots.toFixed(1).padStart(7) + '  ' +
    String(r.maxLots).padStart(6) + '  ' +
    fmt(r.active).padStart(11) + '  ' +
    fmt(r.reserve).padStart(10) + '  ' +
    fmt(r.total).padStart(11) + '  ' +
    (r.drawdown.toFixed(1) + '%').padStart(5) + '  ' +
    (r.halted ? '⛔' : '✓')
  );
}
console.log('----------------------------------------------------------------------------------------------');
console.log(`  START: ${fmt(gStart)}   →   FINAL: ${fmt(gTotal)}   (${(gTotal/gStart).toFixed(2)}x, ${((gTotal-gStart)/gStart*100).toFixed(1)}% return over ${NUM_EXPIRIES} expiries)`);
console.log('══════════════════════════════════════════════════════════════════════════\n');
