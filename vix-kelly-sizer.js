// ============================================================================
//  vix-kelly-sizer.js — VIX-target fractional-Kelly position sizing (research #3)
//
//  Research: India VIX is validated for EXPOSURE LIMITS & position sizing (not direction).
//  Volatility targeting keeps risk roughly constant across regimes — size DOWN when VIX is
//  high (moves are bigger, tails fatter) and UP (capped) when VIX is calm. Combined with
//  fractional-Kelly (survival > growth), this is the documented professional sizing default.
//
//  volScale = clamp(vixBaseline / vix, min, max) — at baseline VIX → 1×; VIX 2× baseline → 0.5×.
//  lots = floor( (capital·riskPct / perLotRisk) · halfKelly · volScale · extraScale ), clamped.
//
//  Pure + unit-tested. Used by trade-planner.js (backward-compatible: neutral when no VIX).
// ============================================================================
'use strict';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, d = 2) => +(+v).toFixed(d);

// Half-Kelly fraction from win-rate p and payoff b (avgWin/avgLoss). Survival-first.
function halfKelly(winRate, payoff) {
  const p = clamp(Number(winRate) || 0, 0, 1), b = Math.max(Number(payoff) || 0, 0.05);
  return clamp((p - (1 - p) / b) * 0.5, 0, 0.5);
}

// Volatility-target scale from India VIX. baseline≈long-run VIX (~14). Higher VIX → smaller.
function volTargetScale(vix, baseline = 14, opts = {}) {
  const min = opts.min != null ? opts.min : 0.4, max = opts.max != null ? opts.max : 1.5;
  if (!(Number(vix) > 0) || !(baseline > 0)) return 1;              // no VIX → neutral (backward-compatible)
  return round(clamp(baseline / Number(vix), min, max), 3);
}

/**
 * Vol-targeted fractional-Kelly lot sizing.
 * @param {object} i
 *   capital, riskPct        account size + max fraction at risk per trade
 *   perLotRisk              worst-case ₹ loss per lot (e.g. wing width × lotSize)
 *   winRate, payoff         for half-Kelly (defaults to the selling edge)
 *   vix, vixBaseline        India VIX + its long-run baseline
 *   extraScale              regime/reduce multiplier (e.g. 0.5 in REDUCE), default 1
 *   maxLots                 hard cap
 * @returns { lots, volScale, kellyFraction, riskBudget, baseLots }
 */
function sizeLots(i = {}) {
  const capital = Number(i.capital) || 700000, riskPct = Number(i.riskPct) || 0.05;
  const perLotRisk = Math.max(1, Number(i.perLotRisk) || 1);
  const riskBudget = capital * riskPct;
  const baseLots = Math.floor(riskBudget / perLotRisk);
  const kelly = halfKelly(i.winRate != null ? i.winRate : 0.84, i.payoff != null ? i.payoff : 0.86);
  const volScale = volTargetScale(i.vix, i.vixBaseline != null ? i.vixBaseline : 14);
  const extraScale = i.extraScale != null ? Number(i.extraScale) : 1;
  const raw = baseLots * kelly * volScale * extraScale;
  const lots = clamp(Math.max(baseLots > 0 ? 1 : 0, Math.round(raw)), baseLots > 0 ? 1 : 0, Number(i.maxLots) || 10);
  return { lots, volScale, kellyFraction: round(kelly, 3), extraScale, riskBudget: Math.round(riskBudget), baseLots };
}

module.exports = { sizeLots, volTargetScale, halfKelly };
