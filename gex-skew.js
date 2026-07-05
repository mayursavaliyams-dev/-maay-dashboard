// ============================================================================
//  gex-skew.js — Signal-Engine Roadmap · Phase 2 (GEX / OI as a REGIME LABEL, not alpha)
//
//  DELIBERATELY DEMOTED. Our research (flashalpha 8-yr GEX study, ScienceDirect
//  PCR-vs-VIX) found GEX has NO independent predictive edge on direction after you
//  control for VIX. So we do NOT trade GEX. We use dealer gamma + OI ONLY as:
//    1. a RANGE vs TREND regime label  (positive net GEX → dealers dampen moves →
//       range-friendly → condors are safer; negative GEX → moves amplify → trend risk)
//    2. a SKEW hint for WHICH SIDE to place credit-spread strikes (call wall / put wall).
//
//  Feeds trade-planner.js (Phase 4) as {regimeLabel, skew}. Pure & unit-tested.
// ============================================================================
'use strict';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, d = 2) => +(+v).toFixed(d);

// Black-Scholes gamma (per 1 unit of underlying), no-div. σ annualized, T in years.
function bsGamma(S, K, T, sigma, r = 0.065) {
  if (!(S > 0) || !(K > 0) || !(T > 0) || !(sigma > 0)) return 0;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  return pdf / (S * sigma * Math.sqrt(T));
}

/**
 * Compute dealer-gamma exposure + OI walls + a range/trend label from an option chain.
 * @param {object} p
 *   spot   underlying
 *   dte    days to expiry
 *   iv     representative annualized IV (decimal, e.g. 0.14); optional (falls back per-strike)
 *   lotSize contract multiplier (default 1)
 *   chain  [{strike, ceOI, peOI, ceIV?, peIV?}]   OI in contracts
 *   Dealer convention: dealers are SHORT calls (customers buy calls) and LONG puts →
 *   GEX_strike = gamma * (ceOI - peOI) * spot^2 * 0.01 * lotSize   (standard sign convention)
 */
function computeGEX(p = {}) {
  const spot = Number(p.spot) || 0, dte = Math.max(Number(p.dte) || 0, 0);
  const T = Math.max(dte, 0.5) / 365;                    // never zero (0-dte floor half a day)
  const lot = Number(p.lotSize) || 1;
  const chain = Array.isArray(p.chain) ? p.chain : [];
  if (!(spot > 0) || !chain.length) return { ok: false, reason: 'no spot / chain' };

  let netGEX = 0, totCeOI = 0, totPeOI = 0;
  let callWall = null, putWall = null, maxCe = -1, maxPe = -1;
  const perStrike = [];
  for (const row of chain) {
    const K = Number(row.strike); if (!(K > 0)) continue;
    const ceOI = Number(row.ceOI) || 0, peOI = Number(row.peOI) || 0;
    const ivCe = Number(row.ceIV) || Number(p.iv) || 0.14;
    const ivPe = Number(row.peIV) || Number(p.iv) || 0.14;
    const gCe = bsGamma(spot, K, T, ivCe), gPe = bsGamma(spot, K, T, ivPe);
    // dealers short calls (+ for customer long call), long puts → net dealer gamma
    const gexK = (gCe * ceOI - gPe * peOI) * spot * spot * 0.01 * lot;
    netGEX += gexK;
    totCeOI += ceOI; totPeOI += peOI;
    // pick the max-OI strike; break ties toward the strike nearest spot (so a flat chain reads neutral)
    if (ceOI > maxCe || (ceOI === maxCe && callWall != null && Math.abs(K - spot) < Math.abs(callWall - spot))) { maxCe = ceOI; callWall = K; }
    if (peOI > maxPe || (peOI === maxPe && putWall != null && Math.abs(K - spot) < Math.abs(putWall - spot))) { maxPe = peOI; putWall = K; }
    perStrike.push({ strike: K, gex: round(gexK) });
  }

  const pcr = totCeOI > 0 ? round(totPeOI / totCeOI, 3) : null;
  // Range vs trend: positive net dealer gamma → dealers sell rallies / buy dips → dampening → RANGE.
  const regimeLabel = netGEX >= 0 ? 'RANGE' : 'TREND';

  // Skew hint (−100..+100). Where is the spot relative to the walls?
  // Nearer put wall below (strong support) + PCR>1 → upward tilt; nearer call wall (resistance) → downward.
  let skew = 0;
  if (callWall != null && putWall != null) {
    const distCall = (callWall - spot) / spot;           // >0 resistance above
    const distPut = (spot - putWall) / spot;             // >0 support below
    // more room to the call wall than the put wall → upward bias, and vice-versa
    const room = distCall - distPut;                     // + = more upside room
    skew += clamp(room * 800, -60, 60);
  }
  if (pcr != null) skew += clamp((pcr - 1) * 40, -40, 40);   // PCR>1 (more puts) → support → up bias
  skew = round(clamp(skew, -100, 100), 0);

  return {
    ok: true, spot: round(spot), dte, netGEX: round(netGEX), regimeLabel,
    pcr, callWall, putWall, skew,
    flip: perStrike.length ? _gammaFlip(perStrike, spot) : null,
    note: 'GEX used as a range/trend label + strike-placement skew only — NOT as a directional alpha signal (no independent edge after VIX control).',
  };
}

// Rough "gamma flip" strike where cumulative GEX crosses zero near spot.
function _gammaFlip(perStrike, spot) {
  const sorted = [...perStrike].sort((a, b) => a.strike - b.strike);
  let cum = 0, prev = null;
  for (const s of sorted) {
    const before = cum; cum += s.gex;
    if (prev != null && ((before <= 0 && cum > 0) || (before >= 0 && cum < 0))) return s.strike;
    prev = s;
  }
  return null;
}

module.exports = { computeGEX, bsGamma };
