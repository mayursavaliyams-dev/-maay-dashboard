/**
 * Payoff engine — unit tests. Run: node test/payoff-engine.test.js
 */
'use strict';
const assert = require('assert');
const pe = require('../payoff-engine');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ~${b})`); console.log('  ✓ ' + m); pass++; };

console.log('Payoff engine');

// ── primitives ──
{
  near(pe.ncdf(0), 0.5, 0.001, 'ncdf(0) = 0.5');
  ok(pe.ncdf(3) > 0.99 && pe.ncdf(-3) < 0.01, 'ncdf tails sane');
  near(pe.legPayoff({ type: 'CE', side: 'BUY', strike: 100, premium: 5 }, 110), 5, 0.001, 'long CE payoff = intrinsic − premium');
  near(pe.legPayoff({ type: 'PE', side: 'SELL', strike: 100, premium: 5 }, 90), -5, 0.001, 'short PE payoff = premium − intrinsic');
}

// ── validation ──
{
  ok(pe.buildPayoff([], { spot: 24000 }).available === false, 'no legs → unavailable');
  ok(pe.buildPayoff([{ type: 'CE', side: 'BUY', strike: 24000, premium: 200 }], {}).available === false, 'no spot → unavailable');
  ok(pe.buildPayoff([{ type: 'XX', side: 'BUY', strike: 24000, premium: 200 }], { spot: 24000 }).available === false, 'invalid leg type filtered out');
}

// ── long call (defined debit) ──
{
  const r = pe.buildPayoff(
    [{ type: 'CE', side: 'BUY', strike: 24000, premium: 200, lots: 1, iv: 14 }],
    { spot: 24000, dteDays: 3, lotSize: 65 });
  ok(r.available, 'long call available');
  ok(r.netType === 'DEBIT' && r.netCredit === -13000, 'net debit = −200×65');
  near(r.maxLoss, -13000, 1, 'max loss = premium paid');
  ok(r.unbounded.upside === false && r.unbounded.downside === false, 'long call has no unbounded risk');
  ok(r.breakevens.length === 1, 'one breakeven');
  near(r.breakevens[0], 24200, 5, 'breakeven ≈ strike + premium (24200)');
  ok(r.greeks.delta > 30 && r.greeks.delta < 40, 'position delta ≈ 0.5 × qty (ATM call)');
  ok(r.greeks.theta < 0, 'long option bleeds theta');
  ok(r.probabilityOfProfit > 10 && r.probabilityOfProfit < 45, 'long-call PoP < 50% (must beat premium)');
  ok(r.curve.length === 122 && r.curve[0].spot < 24000 && r.curve[121].spot > 24000, 'curve spans ±35% in 122 points');
}

// ── short strangle (naked credit — unbounded) ──
{
  const r = pe.buildPayoff([
    { type: 'CE', side: 'SELL', strike: 24400, premium: 120, lots: 1, iv: 13 },
    { type: 'PE', side: 'SELL', strike: 23600, premium: 110, lots: 1, iv: 13 },
  ], { spot: 24000, dteDays: 3, lotSize: 65 });
  ok(r.netType === 'CREDIT' && r.netCredit === 14950, 'strangle credit = 230×65');
  near(r.maxProfit, 14950, 1, 'max profit = credit kept between strikes');
  ok(r.unbounded.upside === true && r.unbounded.downside === true, 'naked strangle flagged unbounded both sides');
  ok(String(r.maxLossLabel).includes('UNBOUNDED'), 'max-loss label warns UNBOUNDED');
  ok(r.breakevens.length === 2, 'two breakevens');
  near(r.breakevens[0], 23370, 12, 'lower BE ≈ 23600 − 230');
  near(r.breakevens[1], 24630, 12, 'upper BE ≈ 24400 + 230');
  ok(r.probabilityOfProfit > 85, 'wide strangle PoP high (theta seller edge)');
  ok(r.greeks.theta > 0, 'short strategy collects theta');
  near(r.marginEst, 2 * 24000 * 65 * 0.12, 1, 'naked margin ≈ 12% notional per short lot');
}

// ── iron condor (defined risk) ──
{
  const r = pe.buildPayoff([
    { type: 'CE', side: 'SELL', strike: 24400, premium: 120, lots: 1, iv: 13 },
    { type: 'PE', side: 'SELL', strike: 23600, premium: 110, lots: 1, iv: 13 },
    { type: 'CE', side: 'BUY', strike: 24600, premium: 60, lots: 1, iv: 13 },
    { type: 'PE', side: 'BUY', strike: 23400, premium: 55, lots: 1, iv: 13 },
  ], { spot: 24000, dteDays: 3, lotSize: 65 });
  ok(r.netCredit === 7475, 'condor credit = 115×65');
  ok(r.unbounded.upside === false && r.unbounded.downside === false, 'hedged wings → risk defined');
  near(r.maxLoss, -5525, 60, 'max loss = (200 wing − 115 credit)×65');
  near(r.riskReward, 1.35, 0.05, 'risk:reward computed for defined-risk');
  near(r.marginEst, Math.abs(r.maxLoss), 1, 'defined-risk margin = max loss');
  ok(r.probabilityOfProfit > 80, 'condor PoP high');
}

// ── lots scaling ──
{
  const one = pe.buildPayoff([{ type: 'CE', side: 'SELL', strike: 24200, premium: 100, lots: 1, iv: 13 }], { spot: 24000, dteDays: 2, lotSize: 65 });
  const two = pe.buildPayoff([{ type: 'CE', side: 'SELL', strike: 24200, premium: 100, lots: 2, iv: 13 }], { spot: 24000, dteDays: 2, lotSize: 65 });
  near(two.netCredit, one.netCredit * 2, 1, '2 lots → 2× credit');
  near(two.greeks.delta, one.greeks.delta * 2, 0.5, '2 lots → 2× delta');
}

console.log(`\n${pass} assertions passed`);
