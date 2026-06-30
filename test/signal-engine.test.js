/**
 * Signal Engine — unit tests. Run: node test/signal-engine.test.js
 */
'use strict';
const assert = require('assert');
const { buildPlan } = require('../signal-engine');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ✓ ' + msg); pass++; };

// a tiny option chain around ATM 23800
const chain = [
  { strike: 23700, ce: { ltp: 150, iv: 14 }, pe: { ltp: 60, iv: 15 } },
  { strike: 23800, ce: { ltp: 95, iv: 14 }, pe: { ltp: 90, iv: 15 } },   // ATM
  { strike: 23900, ce: { ltp: 55, iv: 14 }, pe: { ltp: 140, iv: 16 } },
];
const ctx = { inst: 'NIFTY', spot: 23805, atm: 23800, strikes: chain, step: 50, lotSize: 65, ivAvg: 14 };

const buyVerdict = { decision: 'BUY', direction: 'BULLISH', probability: 82, conviction: 'HIGH', net: 55,
  riskPenalty: 4, cautions: [], drivers: [{ label: 'Trend', note: 'CALL', score: 70, weight: 16 }, { label: 'Smart Money', note: 'BULLISH BOS', score: 60 }] };
const sellVerdict = { ...buyVerdict, decision: 'SELL', direction: 'BEARISH' };
const holdVerdict = { decision: 'HOLD', direction: 'NEUTRAL', probability: 50, conviction: 'NO EDGE', net: 4, reason: 'no edge' };

console.log('Signal Engine');

// ── BUY → BUY CALL with a coherent plan ──
{
  const p = buildPlan(buyVerdict, ctx);
  ok(p.signal === 'BUY CALL' && p.tradeable, 'BUY verdict → BUY CALL');
  ok(p.strike === 23800 && p.optionType === 'CE', 'selects ATM CE strike');
  ok(p.entry === 95, 'entry = ATM CE premium (95)');
  ok(p.stopLoss < p.entry, 'stop-loss below entry');
  ok(p.target1 > p.entry && p.target2 > p.target1 && p.target3 > p.target2, 'targets ascend T1<T2<T3');
  ok(p.expectedMove.points > 0 && p.expectedMove.direction === 'UP', 'expected underlying move up, >0');
  ok(p.expectedHoldingMin === 60, 'HIGH conviction → 60min holding');
  ok(p.riskScore >= 0 && p.riskScore <= 100, 'risk score within 0-100');
  ok(p.economics && p.economics.premiumPerLot === 95 * 65, 'economics: premium/lot = entry×lot');
  ok(p.creditAlternative === 'SELL PUT', 'credit alternative = SELL PUT for bullish');
}

// ── SELL → BUY PUT ──
{
  const p = buildPlan(sellVerdict, ctx);
  ok(p.signal === 'BUY PUT' && p.optionType === 'PE', 'SELL verdict → BUY PUT (PE)');
  ok(p.entry === 90, 'entry = ATM PE premium (90)');
  ok(p.expectedMove.direction === 'DOWN', 'expected move down');
  ok(p.creditAlternative === 'SELL CALL', 'credit alternative = SELL CALL for bearish');
}

// ── HOLD → NO TRADE ──
{
  const p = buildPlan(holdVerdict, ctx);
  ok(p.signal === 'NO TRADE' && p.tradeable === false, 'HOLD → NO TRADE');
}

// ── missing premium → NO TRADE (illiquid) ──
{
  const p = buildPlan(buyVerdict, { ...ctx, strikes: [{ strike: 23800, ce: { ltp: 0 }, pe: { ltp: 0 } }] });
  ok(p.signal === 'NO TRADE' && /premium/i.test(p.reason), 'zero premium → NO TRADE');
}

// ── expiry day shortens holding ──
{
  const p = buildPlan(buyVerdict, { ...ctx, isExpiry: true });
  ok(p.expectedHoldingMin === 36, 'expiry day → holding ×0.6 (36min)');
}

console.log(`\nSignal Engine: ${pass} assertions passed`);
