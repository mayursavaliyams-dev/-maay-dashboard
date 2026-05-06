/**
 * Compare two profit-reinvest sizing rules over last 1200 expiries.
 *
 * RULE A — FUND-THE-EXTRA-LOTS PILE
 *   Base: 5 lots per trade
 *   On WIN:  extra_lots += floor(profit × 0.5 / cost_per_lot)
 *   On LOSS: extra_lots resets to 0
 *   Next trade lots = min(5 + extra, 25, affordable)
 *
 * RULE B — HALF-COMPOUND ON EQUITY
 *   Two equity tracks: active (used for sizing), reserve (locked safe)
 *   On WIN:  active += profit×0.5, reserve += profit×0.5
 *   On LOSS: active -= loss
 *   Next trade lots = floor(active × 5% / cost_per_lot), min 1
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
const MAX_PREM = { NIFTY: 38, BANKNIFTY: 83, SENSEX: 125 };
const NUM_EXPIRIES        = 1200;
const CAP_PER_INST_INR    = 50000 / 3;
const RISK_PCT            = 0.05;
const REINVEST_PCT        = 0.50;
const BASE_LOTS_A         = 5;
const MAX_LOTS_PER_TRADE  = 25;
const MAX_CONSEC_LOSSES   = 8;
const BROKERAGE_RT        = 60;

function loadTrades(file, name) {
  const data = require('./'+file);
  return (data.trades || [])
    .filter(t => t.status === 'OK' && typeof t.entryPrice === 'number'
        && typeof t.exitPrice === 'number' && t.entryTimestamp
        && t.entryPrice >= 0 && t.entryPrice <= MAX_PREM[name])
    .sort((a,b) => a.entryTimestamp - b.entryTimestamp)
    .slice(-NUM_EXPIRIES);
}

function simulateA(name, trades) {
  const lotSz = LOTS[name];
  let equity = CAP_PER_INST_INR;
  let extraPile = 0;
  let consecLoss = 0, halted = null;
  let totalWins = 0;
  for (const t of trades) {
    if (halted) break;
    const cost = t.entryPrice * lotSz;
    if (cost > POSITION_CAP_INR) continue;
    const wantLots = BASE_LOTS_A + extraPile;
    const affordable = Math.max(1, Math.floor(equity / cost));
    const budget = Math.floor(POSITION_CAP_INR / cost);
    const lots = Math.min(wantLots, MAX_LOTS_PER_TRADE, affordable, budget);
    if (lots < 1) { halted = 'cant-afford'; break; }
    const grossPnL = (t.exitPrice - t.entryPrice) * lotSz * lots;
    const netPnL = grossPnL - BROKERAGE_RT;
    equity += netPnL;
    if (netPnL > 0) {
      totalWins++; consecLoss = 0;
      extraPile += Math.floor((netPnL * REINVEST_PCT) / cost);
    } else {
      consecLoss++; extraPile = 0;
    }
    if (consecLoss >= MAX_CONSEC_LOSSES) { halted = 'consec-loss'; break; }
  }
  return { name, finalA: equity, winsA: totalWins, tradesA: trades.length, halted };
}

function simulateB(name, trades) {
  const lotSz = LOTS[name];
  let active = CAP_PER_INST_INR;
  let reserve = 0;
  let consecLoss = 0, halted = null;
  let totalWins = 0;
  for (const t of trades) {
    if (halted) break;
    const cost = t.entryPrice * lotSz;
    if (cost > POSITION_CAP_INR) continue;
    if (active < cost) { halted = 'active-too-low'; break; }
    const lotsRaw = Math.max(1, Math.floor((active * RISK_PCT) / cost));
    const budget = Math.floor(POSITION_CAP_INR / cost);
    const affordable = Math.max(1, Math.floor(active / cost));
    const lots = Math.min(lotsRaw, MAX_LOTS_PER_TRADE, affordable, budget);
    const grossPnL = (t.exitPrice - t.entryPrice) * lotSz * lots;
    const netPnL = grossPnL - BROKERAGE_RT;
    if (netPnL > 0) {
      const toReserve = netPnL * REINVEST_PCT;
      active += netPnL - toReserve;
      reserve += toReserve;
      totalWins++; consecLoss = 0;
    } else {
      active += netPnL;
      consecLoss++;
    }
    if (consecLoss >= MAX_CONSEC_LOSSES) { halted = 'consec-loss'; break; }
  }
  return { name, finalActive: active, finalReserve: reserve, finalB: active+reserve, winsB: totalWins };
}

console.log(`\n══════════════════════════════════════════════════════════════════════════════════`);
console.log(`  A vs B SIZING COMPARISON  •  ${NUM_EXPIRIES} expiries  •  ₹2,500 position cap`);
console.log(`══════════════════════════════════════════════════════════════════════════════════\n`);
console.log(`Instrument   Trades  Init       RULE A (5+pile)              RULE B (half-compound)`);
console.log(`                                Final         Mult   Halt    Final         Mult   Reserve`);
console.log('-'.repeat(100));

let totA=0, totB=0, totReserve=0;
for (const [name, file] of FILES) {
  const trades = loadTrades(file, name);
  const a = simulateA(name, trades);
  const b = simulateB(name, trades);
  totA += a.finalA; totB += b.finalB; totReserve += b.finalReserve;
  console.log(
    `${name.padEnd(12)} ${String(trades.length).padStart(6)}  ₹${CAP_PER_INST_INR.toFixed(0).padStart(7)}   ` +
    `₹${a.finalA.toFixed(0).padStart(10)}  ${(a.finalA/CAP_PER_INST_INR).toFixed(2).padStart(5)}×  ${(a.halted || 'ok').padEnd(7)}  ` +
    `₹${b.finalB.toFixed(0).padStart(10)}  ${(b.finalB/CAP_PER_INST_INR).toFixed(2).padStart(5)}×  ₹${b.finalReserve.toFixed(0).padStart(8)}`
  );
}
console.log('-'.repeat(100));
console.log(
  `TOTAL                ₹${(50000).toString().padStart(7)}   ` +
  `₹${totA.toFixed(0).padStart(10)}  ${(totA/50000).toFixed(2).padStart(5)}×           ` +
  `₹${totB.toFixed(0).padStart(10)}  ${(totB/50000).toFixed(2).padStart(5)}×  ₹${totReserve.toFixed(0).padStart(8)}`
);
console.log();
console.log(`Winner: ${totA > totB ? 'RULE A (' + (((totA/totB)-1)*100).toFixed(0) + '% more)' : 'RULE B (' + (((totB/totA)-1)*100).toFixed(0) + '% more)'}`);
console.log();
