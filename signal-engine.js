/**
 * SIGNAL ENGINE — Antigravity Pro · Module 11
 *
 * Turns the Master Confluence verdict (Module 10) into an ACTIONABLE option
 * trade plan. PURE — no I/O; the server supplies the verdict + live option chain
 * and this builds the plan, so it's identical for NIFTY/SENSEX and unit-testable.
 *
 * Emits exactly one of:  BUY CALL · BUY PUT · SELL CALL · SELL PUT · NO TRADE
 * Every tradeable signal carries:
 *   reason · strike · entry · stopLoss · target1/2/3 · expectedHoldingMin ·
 *   expectedPremium · expectedMove (underlying) · confidence · probability · riskScore
 *
 * Premium-based SL/targets (the instrument traded is the option). Risk = entry−SL;
 * targets are R-multiples scaled by conviction. Expected underlying move is
 * IV-implied for the holding window. NO TRADE on HOLD or missing/illiquid premium.
 */
'use strict';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r2 = v => +(+v).toFixed(2);

const HOLD_MIN = { 'VERY HIGH': 90, HIGH: 60, MODERATE: 40, LOW: 25 };

/**
 * @param {Object} verdict  master-confluence.fuse() output
 * @param {Object} ctx { inst, spot, atm, strikes:[{strike,ce,pe}], step, lotSize, ivAvg, isExpiry, drivers? }
 */
function buildPlan(verdict, ctx = {}) {
  const base = {
    instrument: ctx.inst || null, spot: ctx.spot != null ? Math.round(ctx.spot) : null,
    decision: verdict ? verdict.decision : 'HOLD',
    probability: verdict ? verdict.probability : 50,
    confidence: verdict ? verdict.conviction : 'NO EDGE',
    net: verdict ? verdict.net : 0,
  };

  if (!verdict || verdict.decision === 'HOLD') {
    return { ...base, signal: 'NO TRADE', tradeable: false,
      reason: verdict && verdict.reason ? verdict.reason : `no edge (net ${base.net})` };
  }

  const bullish = verdict.decision === 'BUY';
  const side = bullish ? 'ce' : 'pe';
  const signal = bullish ? 'BUY CALL' : 'BUY PUT';
  const creditAlt = bullish ? 'SELL PUT' : 'SELL CALL';

  // ── strike: ATM (best gamma/theta + liquidity for an intraday directional buy) ──
  const atm = Number(ctx.atm) || 0;
  const strikes = Array.isArray(ctx.strikes) ? ctx.strikes : [];
  const row = strikes.find(s => Number(s.strike) === atm) || strikes[Math.floor(strikes.length / 2)] || null;
  const leg = row ? row[side] || {} : {};
  const entry = r2(Number(leg.ltp) || 0);
  if (!row || !(entry > 0)) {
    return { ...base, signal: 'NO TRADE', tradeable: false, strike: atm || null,
      reason: 'no live premium for ATM ' + (bullish ? 'CALL' : 'PUT') + ' (illiquid / feed warming up)' };
  }
  const iv = Number(leg.iv) || Number(ctx.ivAvg) || 14;

  // ── expected underlying move (IV-implied over the holding window) ──
  const conv = verdict.conviction || 'MODERATE';
  let holdMin = HOLD_MIN[conv] || 40;
  if (ctx.isExpiry) holdMin = Math.round(holdMin * 0.6);          // expiry-day moves are faster
  const sigmaDay = ctx.spot * (iv / 100) / Math.sqrt(252);        // 1-day sigma
  const expMovePts = r2(sigmaDay * Math.sqrt(holdMin / 375));     // 375 trading minutes/day
  const expMovePct = r2((expMovePts / ctx.spot) * 100);

  // ── premium SL / targets ──
  // wider stop in higher IV; risk floor keeps it sane on cheap premiums
  const slPct = clamp(0.25 + (iv - 12) / 120, 0.2, 0.45);
  const stopLoss = r2(entry * (1 - slPct));
  const riskPerUnit = r2(entry - stopLoss);
  // conviction stretches the reward side
  const tMul = conv === 'VERY HIGH' ? 1.2 : conv === 'HIGH' ? 1.0 : 0.85;
  const target1 = r2(entry + riskPerUnit * 1.0 * tMul);
  const target2 = r2(entry + riskPerUnit * 2.0 * tMul);
  const target3 = r2(entry + riskPerUnit * 3.5 * tMul);

  // ── risk score (0-100, higher = riskier) ──
  const riskScore = clamp(Math.round(
    (verdict.riskPenalty || 0) * 1.5 +
    Math.max(0, iv - 14) * 1.2 +
    (100 - base.probability) * 0.4 +
    (verdict.cautions && verdict.cautions.length ? 12 : 0)
  ), 0, 100);

  // ── position economics (sizing itself is Module 12's job) ──
  const lot = Number(ctx.lotSize) || 0;
  const economics = lot ? {
    lotSize: lot, premiumPerLot: r2(entry * lot),
    maxLossPerLot: r2(riskPerUnit * lot), rewardAtT2PerLot: r2((target2 - entry) * lot),
    riskReward: riskPerUnit > 0 ? r2((target2 - entry) / riskPerUnit) : null,
  } : null;

  const drivers = (verdict.drivers || []).slice(0, 3).map(d => `${d.label}${d.note ? ' (' + d.note + ')' : ''}`);
  const reason = `${verdict.direction} · ${base.probability}% · ${drivers.join(' · ') || verdict.reason || ''}`.trim();

  return {
    ...base,
    signal, tradeable: true, creditAlternative: creditAlt,
    strike: atm, optionType: bullish ? 'CE' : 'PE',
    entry, stopLoss, stopLossPct: +(slPct * 100).toFixed(0),
    target1, target2, target3,
    riskPerUnit, expectedPremium: entry,
    expectedHoldingMin: holdMin,
    expectedMove: { points: expMovePts, pct: expMovePct, direction: bullish ? 'UP' : 'DOWN' },
    iv: r2(iv), riskScore,
    economics,
    reason,
    drivers: verdict.drivers ? verdict.drivers.slice(0, 4) : [],
    cautions: verdict.cautions || [],
  };
}

module.exports = { buildPlan, HOLD_MIN };
