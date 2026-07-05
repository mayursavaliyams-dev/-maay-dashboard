/**
 * Trade planner (Phase 4) — unit tests. Run: node test/trade-planner.test.js
 */
'use strict';
const assert = require('assert');
const { planTrade, halfKelly, roundToStep } = require('../trade-planner');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ~${b})`); console.log('  ✓ ' + m); pass++; };

console.log('Trade planner (Phase 4)');

const base = { spot: 24000, step: 50, emPts: 150, ivp: 60, capital: 700000, riskPct: 0.05, lotSize: 75, dte: 3, minProb: 65 };

// ── half-Kelly ──
near(halfKelly(0.84, 0.86), 0.5 * (0.84 - 0.16 / 0.86), 1e-6, 'half-Kelly = 0.5×(p−(1−p)/b)');
ok(halfKelly(0.5, 1) === 0, 'no edge (p=0.5,b=1) → Kelly 0');
ok(halfKelly(0.9, 2) > 0, 'strong edge → positive Kelly');
ok(halfKelly(0.99, 5) <= 0.5, 'half-Kelly capped at 0.5');
near(roundToStep(24037, 50), 24050, 0, 'roundToStep 24037→24050');

// ── SELL-ON + neutral → iron condor ──
{
  const p = planTrade({ ...base, regime: 'SELL-ON', regimeScore: 70, decision: 'HOLD', probability: 50, skew: 5 });
  ok(p.structure === 'IRON_CONDOR', 'SELL-ON + neutral skew → iron condor');
  ok(p.legs.length === 4, 'condor has 4 legs');
  ok(p.legs.filter(l => l.side === 'SELL').length === 2 && p.legs.filter(l => l.side === 'BUY').length === 2, '2 shorts + 2 wings');
  const ceShort = p.legs.find(l => l.type === 'CE' && l.side === 'SELL');
  ok(ceShort.strike > p.atm, 'short call above ATM');
  ok(p.legs.find(l => l.type === 'CE' && l.side === 'BUY').strike > ceShort.strike, 'call wing beyond short');
  ok(p.sizing.lots >= 1, 'positive lot sizing');
}

// ── SELL-ON + upward skew → bull put credit spread ──
{
  const p = planTrade({ ...base, regime: 'SELL-ON', regimeScore: 68, decision: 'HOLD', skew: 55 });
  ok(p.structure === 'CREDIT_SPREAD_PUT', 'upward skew → sell the put side (bull put)');
  ok(p.legs.every(l => l.type === 'PE'), 'put-only legs');
  ok(p.dir === 'bullish', 'bullish tilt');
}
// ── SELL-ON + downward skew → bear call credit spread ──
{
  const p = planTrade({ ...base, regime: 'SELL-ON', skew: -55, decision: 'HOLD' });
  ok(p.structure === 'CREDIT_SPREAD_CALL', 'downward skew → sell the call side (bear call)');
  ok(p.legs.every(l => l.type === 'CE'), 'call-only legs');
}

// ── STAND-DOWN + strong direction → debit spread (never naked) ──
{
  const p = planTrade({ ...base, regime: 'STAND-DOWN', decision: 'BUY', probability: 72, skew: 0 });
  ok(p.structure === 'DEBIT_SPREAD_CALL', 'stand-down + strong BUY → bull call DEBIT spread');
  ok(p.legs.length === 2 && p.legs.some(l => l.side === 'BUY') && p.legs.some(l => l.side === 'SELL'), 'debit spread = 1 buy + 1 sell (defined risk)');
  ok(!p.legs.some(l => l.side === 'BUY' && p.legs.length === 1), 'never a lone naked buy');
  const pp = planTrade({ ...base, regime: 'STAND-DOWN', decision: 'SELL', probability: 70 });
  ok(pp.structure === 'DEBIT_SPREAD_PUT', 'stand-down + strong SELL → bear put debit spread');
}

// ── stand-down + weak direction → NO TRADE ──
{
  const p = planTrade({ ...base, regime: 'STAND-DOWN', decision: 'BUY', probability: 55 });
  ok(p.structure === 'NO_TRADE', 'stand-down + weak prob → NO TRADE (patience is the edge)');
  const h = planTrade({ ...base, regime: null, decision: 'HOLD', probability: 50 });
  ok(h.structure === 'NO_TRADE', 'no regime + HOLD → NO TRADE');
}

// ── REDUCE → half size ──
{
  const full = planTrade({ ...base, regime: 'SELL-ON', skew: 0, decision: 'HOLD' });
  const red = planTrade({ ...base, regime: 'REDUCE', skew: 0, decision: 'HOLD' });
  ok(red.structure === 'IRON_CONDOR', 'REDUCE still allows a condor');
  ok(red.sizing.regimeScale === 0.5, 'REGIME REDUCE → half-size scale');
}

// ── never a naked long option anywhere ──
{
  for (const reg of ['SELL-ON', 'REDUCE', 'STAND-DOWN']) for (const dec of ['BUY', 'SELL', 'HOLD']) {
    const p = planTrade({ ...base, regime: reg, decision: dec, probability: 80, skew: 40 });
    if (p.structure !== 'NO_TRADE') {
      const nakedLong = p.legs.length === 1 && p.legs[0].side === 'BUY';
      ok(!nakedLong, `${reg}/${dec} never emits a naked long option`);
    }
  }
}

// ── guards ──
ok(planTrade({ spot: 0, emPts: 150 }).structure === 'NO_TRADE', 'no spot → NO_TRADE');
ok(planTrade({ spot: 24000, emPts: 0 }).structure === 'NO_TRADE', 'no expected move → NO_TRADE');

console.log(`\n${pass} assertions passed`);
