/**
 * POSITION-SIZER — margin-aware, fractional-Kelly, IV-scaled lot sizing.
 *
 * Tier-2 of the strategy-research roadmap. Two honest realities the earlier
 * backtests ignored:
 *   1. MARGIN. A naked NIFTY short strangle needs ~₹1.3L/lot of SPAN+exposure
 *      margin — so a ₹1L account literally cannot hold even one lot. A defined-
 *      risk iron condor needs only ~its max loss (~₹15-20k/lot). The "5% of
 *      capital as premium" sizing was fantasy; real sizing is margin-bound.
 *   2. KELLY. Full Kelly maximizes log-growth but is far too aggressive for an
 *      undefined-risk seller (research: catastrophic drawdowns). Use FRACTIONAL
 *      (e.g. half) Kelly, and scale DOWN further when IV is high (more risk).
 *
 * recommend() returns the number of lots to actually trade, with the reasoning,
 * so the engine/UI can size honestly instead of compounding an impossible book.
 */

const DEFAULTS = {
  marginPerLotStrangle: parseFloat(process.env.SIZER_STRANGLE_MARGIN || 130000), // ₹/lot SPAN+exposure (NIFTY)
  condorMarginBuffer:   1.15,   // condor margin ≈ maxLoss × buffer
  marginUtilCap:        parseFloat(process.env.SIZER_MARGIN_UTIL || 0.6),  // use ≤ 60% of capital as margin
  kellyFraction:        parseFloat(process.env.SIZER_KELLY_FRACTION || 0.5), // half-Kelly
  ivScaleFloor:         parseFloat(process.env.SIZER_IV_SCALE_FLOOR || 0.4), // at max IV, size → 40%
  maxLots:              parseInt(process.env.SIZER_MAX_LOTS || 25),
  lotSize:              75,
};

// Full-Kelly fraction of capital for a bet with win prob W, avg win, avg loss.
//   f* = W − (1−W)/R,  R = avgWin / |avgLoss|.  Clamped to [0,1].
function kelly(winRate, avgWin, avgLoss) {
  const R = Math.abs(avgWin) / Math.max(1, Math.abs(avgLoss));
  const f = winRate - (1 - winRate) / R;
  return Math.max(0, Math.min(1, f));
}

/**
 * @param {object} p
 *   capital       — account capital (₹)
 *   structure     — 'STRANGLE' | 'CONDOR'
 *   maxLossPerUnit— condor max loss per unit (premium pts); used for condor margin
 *   winRate, avgWin, avgLoss — strategy stats for the Kelly fraction
 *   ivPct         — current IV percentile 0..1 (scales size down when high)
 *   cfg           — overrides of DEFAULTS
 */
function recommend(p) {
  const C = { ...DEFAULTS, ...(p.cfg || {}) };
  const lotSize = C.lotSize;
  const structure = p.structure || 'STRANGLE';

  // Margin per lot by structure.
  const marginPerLot = structure === 'CONDOR'
    ? Math.max(12000, (p.maxLossPerUnit || 175) * lotSize * C.condorMarginBuffer)
    : C.marginPerLotStrangle;

  const affordable = (p.capital || 0) * C.marginUtilCap;
  const maxLotsByMargin = Math.floor(affordable / marginPerLot);

  // Fractional-Kelly risk fraction, scaled down as IV rises.
  const fullKelly = kelly(p.winRate ?? 0.9, p.avgWin ?? 2900, p.avgLoss ?? -3500);
  const fracKelly = Math.max(0, Math.min(1, fullKelly * C.kellyFraction));
  const ivPct = (typeof p.ivPct === 'number') ? Math.max(0, Math.min(1, p.ivPct)) : 0.5;
  const ivScale = 1 - (1 - C.ivScaleFloor) * ivPct;   // 1 at ivPct=0 → ivScaleFloor at ivPct=1
  const riskFraction = fracKelly * ivScale;

  // Floor: if at least one lot is affordable AND the edge is positive, trade ≥1
  // (don't let fractional-Kelly rounding zero out a small but +EV book).
  const minLot = (maxLotsByMargin >= 1 && fracKelly > 0) ? 1 : 0;
  let recommendedLots = Math.max(minLot, Math.floor(maxLotsByMargin * riskFraction));
  recommendedLots = Math.min(recommendedLots, C.maxLots, maxLotsByMargin);

  let reason;
  if (maxLotsByMargin < 1) {
    reason = `capital ₹${Math.round(p.capital)} cannot fund 1 ${structure} lot (margin ~₹${Math.round(marginPerLot)}/lot @ ${Math.round(C.marginUtilCap * 100)}% util)` +
             (structure === 'STRANGLE' ? ' — use a CONDOR (far lower margin) or add capital.' : '.');
  } else {
    reason = `${maxLotsByMargin} lot(s) affordable; half-Kelly ${(fracKelly * 100).toFixed(0)}% × IV-scale ${(ivScale * 100).toFixed(0)}% = ${(riskFraction * 100).toFixed(0)}% → ${recommendedLots} lot(s).`;
  }

  return {
    recommendedLots, maxLotsByMargin, marginPerLot: Math.round(marginPerLot),
    fullKellyPct: +(fullKelly * 100).toFixed(0), fracKellyPct: +(fracKelly * 100).toFixed(0),
    ivScalePct: +(ivScale * 100).toFixed(0), riskFractionPct: +(riskFraction * 100).toFixed(0),
    structure, reason,
  };
}

module.exports = { recommend, kelly, DEFAULTS };
