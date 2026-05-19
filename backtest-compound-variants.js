/**
 * Three-variant compound backtest on the same 1200-expiry dataset:
 *
 *   1) FULL COMPOUND     — PROFIT_REINVEST_PCT=1.0 (all profit stays in active)
 *   2) PYRAMID 2→25      — lots = 2 base, +1 per consec win, reset on loss, cap 25
 *   3) TREND GATE        — post-hoc filter: drop trades whose direction
 *                          contradicts the prior 3-trade direction streak
 *                          (same logic spirit as the live engine's trend gate)
 *
 * All variants share: ₹2,500 position cap, 5% risk, 2% slip already in data,
 * ₹60 RT brokerage, 8 consec-loss circuit breaker.
 */
const fs = require('fs');

const FILES = [
  ['NIFTY',     'backtest-daily-results-nifty-2y-2024-05-04-to-2026-05-04.json'],
  ['BANKNIFTY', 'backtest-daily-results-banknifty-2y-2024-05-04-to-2026-05-04.json'],
  ['SENSEX',    'backtest-daily-results-sensex-2y-2024-05-04-to-2026-05-04.json'],
];

const POSITION_CAP_INR = 2500;
const LOTS  = { NIFTY: 65,  BANKNIFTY: 30,  SENSEX: 20 };
const MAX_PREM = {
  NIFTY:     POSITION_CAP_INR / LOTS.NIFTY,
  BANKNIFTY: POSITION_CAP_INR / LOTS.BANKNIFTY,
  SENSEX:    POSITION_CAP_INR / LOTS.SENSEX,
};
const RISK_PCT          = 0.05;
const MAX_CONSEC_LOSSES = 8;
const MAX_LOTS_PER_TRADE = 25;
const BROKERAGE_RT      = 60;
const NUM_EXPIRIES      = 1200;
const CAP_PER_INST_INR  = 50000 / 3;

function loadTrades(file, inst) {
  const data = require('./' + file);
  const lotSz = LOTS[inst];
  const maxPrem = MAX_PREM[inst];
  const all = (data.trades || []).filter(t =>
    t.status === 'OK' && typeof t.entryPrice === 'number' && typeof t.exitPrice === 'number'
    && t.entryTimestamp && t.entryPrice >= 0 && t.entryPrice <= maxPrem
  );
  all.sort((a, b) => a.entryTimestamp - b.entryTimestamp);
  return all.slice(-NUM_EXPIRIES);
}

// ── Variant 1: full compound (single-lot or simple % sizing, all profit recompounds) ──
function fullCompound(inst, trades) {
  const lotSz = LOTS[inst];
  let active = CAP_PER_INST_INR;
  let consecLoss = 0;
  let halted = false;
  let wins = 0, losses = 0;
  for (const t of trades) {
    if (halted) break;
    const cost = t.entryPrice * lotSz;
    if (cost <= 0) continue;
    let lots = Math.max(1, Math.floor((active * RISK_PCT) / cost));
    lots = Math.min(lots, MAX_LOTS_PER_TRADE);
    const qty = lots * lotSz;
    const gross = (t.exitPrice - t.entryPrice) * qty;
    const net = gross - BROKERAGE_RT;
    active += net;
    if (net > 0) { wins++; consecLoss = 0; }
    else         { losses++; consecLoss++; if (consecLoss >= MAX_CONSEC_LOSSES) halted = true; }
  }
  return { trades: wins + losses, wins, losses,
           winRate: ((wins / (wins + losses)) * 100) || 0,
           equity: active, halted };
}

// ── Variant 2: pyramid 2→25 (base lots = 2, +1 per consec win, cap 25, reset on loss) ──
function pyramid(inst, trades) {
  const lotSz = LOTS[inst];
  let active = CAP_PER_INST_INR;
  let consecWin = 0, consecLoss = 0;
  let halted = false, wins = 0, losses = 0;
  for (const t of trades) {
    if (halted) break;
    const cost = t.entryPrice * lotSz;
    if (cost <= 0) continue;
    let lots = 2 + consecWin;
    lots = Math.min(lots, MAX_LOTS_PER_TRADE);
    // Affordability cap — never deploy > 50% of active equity
    const maxAffordable = Math.floor((active * 0.5) / cost);
    if (maxAffordable < 1) continue;
    lots = Math.min(lots, maxAffordable);
    const qty = lots * lotSz;
    const gross = (t.exitPrice - t.entryPrice) * qty;
    const net = gross - BROKERAGE_RT;
    active += net;
    if (net > 0) { wins++; consecWin++; consecLoss = 0; }
    else         { losses++; consecLoss++; consecWin = 0;
                   if (consecLoss >= MAX_CONSEC_LOSSES) halted = true; }
  }
  return { trades: wins + losses, wins, losses,
           winRate: ((wins / (wins + losses)) * 100) || 0,
           equity: active, halted };
}

// ── Variant 3: trend gate (drop trades whose direction fights prior 3-trade streak) ──
function trendGate(inst, trades) {
  const lotSz = LOTS[inst];
  let active = CAP_PER_INST_INR;
  let consecLoss = 0;
  let halted = false, wins = 0, losses = 0, blocked = 0;
  const recentSides = [];   // last 3 sides (CALL/PUT) of TAKEN trades
  for (const t of trades) {
    if (halted) break;
    const side = (t.type || t.entrySide || t.side || '').toUpperCase();
    if (recentSides.length === 3) {
      const allCall = recentSides.every(s => s === 'CALL');
      const allPut  = recentSides.every(s => s === 'PUT');
      const oppose = (allCall && side === 'PUT') || (allPut && side === 'CALL');
      if (oppose) { blocked++; continue; }
    }
    const cost = t.entryPrice * lotSz;
    if (cost <= 0) continue;
    let lots = Math.max(1, Math.floor((active * RISK_PCT) / cost));
    lots = Math.min(lots, MAX_LOTS_PER_TRADE);
    const qty = lots * lotSz;
    const gross = (t.exitPrice - t.entryPrice) * qty;
    const net = gross - BROKERAGE_RT;
    active += net;
    if (net > 0) { wins++; consecLoss = 0; }
    else         { losses++; consecLoss++; if (consecLoss >= MAX_CONSEC_LOSSES) halted = true; }
    recentSides.push(side);
    if (recentSides.length > 3) recentSides.shift();
  }
  return { trades: wins + losses, wins, losses, blocked,
           winRate: ((wins / (wins + losses)) * 100) || 0,
           equity: active, halted };
}

// ── Variant 4: half-compound (matches PROFIT_REINVEST_PCT=0.5 in .env) ──
function halfCompound(inst, trades) {
  const lotSz = LOTS[inst];
  let active = CAP_PER_INST_INR;
  let reserve = 0;
  let consecLoss = 0;
  let halted = false, wins = 0, losses = 0;
  for (const t of trades) {
    if (halted) break;
    const cost = t.entryPrice * lotSz;
    if (cost <= 0) continue;
    let lots = Math.max(1, Math.floor((active * RISK_PCT) / cost));
    lots = Math.min(lots, MAX_LOTS_PER_TRADE);
    const qty = lots * lotSz;
    const gross = (t.exitPrice - t.entryPrice) * qty;
    const net = gross - BROKERAGE_RT;
    if (net > 0) {
      active  += net * 0.5;
      reserve += net * 0.5;
      wins++; consecLoss = 0;
    } else {
      active += net;     // losses come fully from active
      losses++; consecLoss++;
      if (consecLoss >= MAX_CONSEC_LOSSES) halted = true;
    }
  }
  return { trades: wins + losses, wins, losses,
           winRate: ((wins / (wins + losses)) * 100) || 0,
           equity: active + reserve, reserve, active, halted };
}

// ── Variant 5: half-compound + trend gate (current live engine config) ──
function halfCompoundWithTrendGate(inst, trades) {
  const lotSz = LOTS[inst];
  let active = CAP_PER_INST_INR;
  let reserve = 0;
  let consecLoss = 0;
  let halted = false, wins = 0, losses = 0, blocked = 0;
  const recentSides = [];
  for (const t of trades) {
    if (halted) break;
    const side = (t.type || '').toUpperCase();
    if (recentSides.length === 3) {
      const allCall = recentSides.every(s => s === 'CALL');
      const allPut  = recentSides.every(s => s === 'PUT');
      const oppose = (allCall && side === 'PUT') || (allPut && side === 'CALL');
      if (oppose) { blocked++; continue; }
    }
    const cost = t.entryPrice * lotSz;
    if (cost <= 0) continue;
    let lots = Math.max(1, Math.floor((active * RISK_PCT) / cost));
    lots = Math.min(lots, MAX_LOTS_PER_TRADE);
    const qty = lots * lotSz;
    const gross = (t.exitPrice - t.entryPrice) * qty;
    const net = gross - BROKERAGE_RT;
    if (net > 0) {
      active  += net * 0.5;
      reserve += net * 0.5;
      wins++; consecLoss = 0;
    } else {
      active += net;
      losses++; consecLoss++;
      if (consecLoss >= MAX_CONSEC_LOSSES) halted = true;
    }
    recentSides.push(side);
    if (recentSides.length > 3) recentSides.shift();
  }
  return { trades: wins + losses, wins, losses, blocked,
           winRate: ((wins / (wins + losses)) * 100) || 0,
           equity: active + reserve, reserve, active, halted };
}

const fmt   = n => '₹' + Math.round(n).toLocaleString('en-IN');
const fmtP  = p => p.toFixed(1) + '%';
const fmtM  = (e) => (e / CAP_PER_INST_INR).toFixed(2) + '×';

function runAll() {
  const variants = [
    ['FULL-COMPOUND',         fullCompound],
    ['PYRAMID-2to25',         pyramid],
    ['TREND-GATE',            trendGate],
    ['HALF-COMPOUND',         halfCompound],
    ['HALF-COMPOUND+TRENDGATE (live config)', halfCompoundWithTrendGate],
  ];
  const allTrades = {};
  for (const [inst, file] of FILES) allTrades[inst] = loadTrades(file, inst);

  for (const [vname, vfn] of variants) {
    console.log('\n' + '═'.repeat(110));
    console.log(`  ${vname}    (₹2500 cap · 5% risk · 1200 expiries · ₹60 RT · halt @8 consec loss)`);
    console.log('═'.repeat(110));
    console.log('Instrument   Trades   Wins  Loss  Win%   Final Equity        Multiple  NetPnL          Halt' + (vname === 'TREND-GATE' ? '   Blocked' : ''));
    console.log('-'.repeat(110));
    let totalEquity = 0, totalTrades = 0, totalNet = 0, totalBlocked = 0;
    for (const [inst] of FILES) {
      const r = vfn(inst, allTrades[inst]);
      const net = r.equity - CAP_PER_INST_INR;
      const blockedCol = vname === 'TREND-GATE' ? `   ${String(r.blocked || 0).padStart(4)}` : '';
      console.log(
        inst.padEnd(13) +
        String(r.trades).padStart(5) +
        String(r.wins).padStart(6) +
        String(r.losses).padStart(6) +
        '  ' + fmtP(r.winRate).padStart(5) +
        '  ' + fmt(r.equity).padStart(14) +
        '  ' + fmtM(r.equity).padStart(8) +
        '  ' + (net >= 0 ? '+' : '') + fmt(net).padStart(13) +
        '  ' + (r.halted ? '⛔' : '✓').padStart(4) +
        blockedCol
      );
      totalEquity += r.equity;
      totalTrades += r.trades;
      totalNet    += net;
      totalBlocked += (r.blocked || 0);
    }
    console.log('-'.repeat(110));
    console.log(
      'TOTAL        '.padEnd(13) +
      String(totalTrades).padStart(5) +
      '            ' +
      '       ' +
      '  ' + fmt(totalEquity).padStart(14) +
      '  ' + (totalEquity / 50000).toFixed(2) + '× '.padStart(7) +
      '  ' + (totalNet >= 0 ? '+' : '') + fmt(totalNet).padStart(13) +
      (vname === 'TREND-GATE' ? `              ${totalBlocked}` : '')
    );
  }
  console.log('');
}

runAll();
