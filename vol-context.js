/**
 * VOLATILITY CONTEXT ENGINE — Antigravity Pro · Module 3 (vol slice)
 *
 * IV Rank / IV Percentile · Expected Move · GEX-lite (call/put walls + gamma flip).
 * PURE — no I/O; the server supplies the India-VIX history, spot, and option chain.
 *
 * HONEST BY DESIGN (per the competitive research):
 *   • IVP is the single best "is selling premium attractive now" gauge — it feeds,
 *     not replaces, the strangle edge.
 *   • GEX sign rests on an UN-VERIFIABLE dealer-positioning assumption (long calls /
 *     short puts). It is a REGIME GAUGE, not a price predictor. Every GEX output
 *     carries that caveat. Single-stock GEX is intentionally NOT supported (thin OI);
 *     this is index-only (NIFTY/SENSEX), exactly where it is defensible.
 */
'use strict';

const round = (v, d = 2) => +(+v).toFixed(d);
const SQRT2PI = Math.sqrt(2 * Math.PI);
const npdf = x => Math.exp(-0.5 * x * x) / SQRT2PI;

/** IV Rank + IV Percentile of `current` within a trailing `series` (e.g. 1y India VIX). */
function ivRankPercentile(current, series) {
  const s = (series || []).filter(v => isFinite(v) && v > 0);
  if (!isFinite(current) || current <= 0 || s.length < 20) return { available: false, reason: 'insufficient IV history' };
  const min = Math.min(...s), max = Math.max(...s);
  const rank = max > min ? (current - min) / (max - min) : 0.5;               // IV Rank (min-max)
  const below = s.filter(v => v < current).length;
  const percentile = below / s.length;                                        // IV Percentile
  const label = percentile >= 0.75 ? 'HIGH — premium rich (favor selling)'
    : percentile >= 0.5 ? 'ABOVE-AVG — selling ok'
    : percentile >= 0.25 ? 'BELOW-AVG — selling less attractive'
    : 'LOW — premium cheap (selling unattractive)';
  return {
    available: true, current: round(current, 2),
    ivRank: round(rank * 100, 1), ivPercentile: round(percentile * 100, 1),
    min: round(min, 2), max: round(max, 2), windowDays: s.length, label,
    sellingFavored: percentile >= 0.5,
  };
}

/** Black-Scholes gamma (r=0 index approximation). sigma decimal, T years. */
function bsGamma(S, K, sigma, T) {
  if (!(S > 0 && K > 0 && sigma > 0 && T > 0)) return 0;
  const d1 = (Math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
  return npdf(d1) / (S * sigma * Math.sqrt(T));
}

/**
 * Expected move — both the market's own (ATM straddle) and an IV model estimate.
 * @param spot, atmStraddle (₹ premium), ivPct (annualised %, e.g. 14), dteDays
 */
function expectedMove(spot, atmStraddle, ivPct, dteDays) {
  const sigma = (Number(ivPct) || 0) / 100;
  const dte = Math.max(0.5, Number(dteDays) || 1);
  const oneDay = sigma > 0 ? spot * sigma * Math.sqrt(1 / 252) : null;         // ±1σ, 1 session
  const byExpiryModel = sigma > 0 ? spot * sigma * Math.sqrt(dte / 365) : null; // ±1σ to expiry (IV model)
  const byExpiryStraddle = atmStraddle > 0 ? atmStraddle * 0.85 : null;         // market-implied ≈ 0.85×straddle
  const em = byExpiryStraddle || byExpiryModel;                                 // prefer the market's own price
  return {
    oneDayPts: oneDay != null ? round(oneDay) : null,
    oneDayPct: oneDay != null && spot > 0 ? round(oneDay / spot * 100, 2) : null,
    byExpiryPts: em != null ? round(em) : null,
    byExpiryPct: em != null && spot > 0 ? round(em / spot * 100, 2) : null,
    upper: em != null ? round(spot + em) : null,
    lower: em != null ? round(spot - em) : null,
    dteDays: round(dte, 1), basis: byExpiryStraddle ? 'ATM straddle (market)' : 'IV model',
    atmStraddle: atmStraddle > 0 ? round(atmStraddle) : null,
  };
}

/**
 * GEX-lite — call/put OI walls + a naive net dealer-gamma profile & flip level.
 * rows = [{strike, ce:{oi}, pe:{oi}}]. Index-only. Sign is an ASSUMPTION.
 */
function gexLite(rows, spot, ivPct, dteDays, lotSize) {
  const R = (rows || []).filter(r => r && r.strike > 0);
  if (R.length < 5 || !(spot > 0)) return { available: false, reason: 'insufficient chain' };
  const sigma = (Number(ivPct) || 12) / 100;
  const T = Math.max(0.5, Number(dteDays) || 1) / 365;
  const lot = Number(lotSize) || 1;

  let callWall = null, putWall = null, maxCe = -1, maxPe = -1, netGex = 0;
  const profile = [];
  for (const r of R) {
    const ceOI = Number(r.ce?.oi || 0), peOI = Number(r.pe?.oi || 0);
    if (ceOI > maxCe) { maxCe = ceOI; callWall = r.strike; }
    if (peOI > maxPe) { maxPe = peOI; putWall = r.strike; }
    const g = bsGamma(spot, r.strike, sigma, T);
    // naive convention: dealers long calls / short puts → +call gamma, −put gamma
    const gex = spot * spot * 0.01 * lot * g * (ceOI - peOI);
    netGex += gex;
    profile.push({ strike: r.strike, gex: round(gex), ceOI, peOI });
  }
  // gamma flip: strike where the running cumulative GEX (low→high strike) crosses zero
  profile.sort((a, b) => a.strike - b.strike);
  let cum = 0, flip = null, prevCum = 0;
  for (const p of profile) {
    prevCum = cum; cum += p.gex;
    if (flip == null && ((prevCum <= 0 && cum > 0) || (prevCum >= 0 && cum < 0))) flip = p.strike;
  }
  const regime = netGex > 0
    ? 'POSITIVE gamma — dealers dampen moves → range-bound / pins toward walls'
    : 'NEGATIVE gamma — dealers amplify moves → trend / breakout risk';
  return {
    available: true,
    callWall, putWall,                                   // OI magnets (S/R) — most reliable output
    gammaFlip: flip,
    netGex: round(netGex),
    netGexSign: netGex > 0 ? 'POSITIVE' : 'NEGATIVE',
    regime,
    spot: round(spot),
    caveat: 'GEX sign assumes dealers are long calls / short puts — an un-verifiable convention. ' +
      'Treat as a REGIME GAUGE, not a price predictor. Gamma uses an estimated DTE. Walls (max OI) are the most reliable part.',
  };
}

/** Combine all three into one vol-context snapshot. */
function analyze(ctx = {}) {
  const iv = ivRankPercentile(ctx.currentVix, ctx.vixHistory);
  const em = expectedMove(ctx.spot, ctx.atmStraddle, ctx.ivPct != null ? ctx.ivPct : ctx.currentVix, ctx.dteDays);
  const gex = gexLite(ctx.rows, ctx.spot, ctx.ivPct != null ? ctx.ivPct : ctx.currentVix, ctx.dteDays, ctx.lotSize);
  return { ivp: iv, expectedMove: em, gex };
}

module.exports = { analyze, ivRankPercentile, expectedMove, gexLite, bsGamma };
