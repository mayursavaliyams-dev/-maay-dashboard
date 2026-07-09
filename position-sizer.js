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

// ── MIGRATION C1c-5 (2026-07-09) ─────────────────────────────────────────────
//
// `recommend()` used to carry `lotSize: 75` in DEFAULTS and apply it to EVERY
// instrument, because it never received an `inst` at all — strangle-engine.js:254,
// :392 and :393 all called it without one. That was the root cause; the wrong
// constant was only the symptom.
//
// Condor margin is `maxLossPerUnit × lotSize × buffer`, so a NIFTY condor's margin
// was over-estimated by +15.4% (₹15,094 vs ₹13,081 at the true lot of 65) and a
// SENSEX condor by +25.8% (₹15,094 vs the ₹12,000 floor at its true lot of 20).
// Over-estimated margin under-counts affordable lots, which silently under-sizes
// the book.
//
// `recommend()` now takes `inst` and resolves the lot from the Instrument Registry.
// There is no fallback: an unknown or trading-disabled instrument yields a refusal,
// not a guess. Only the CONDOR path needs a lot size, so the STRANGLE path is
// unaffected and remains backward compatible.
//
// SPAN margin is NOT broker contract metadata — it is an exchange risk parameter that
// changes daily — so it does NOT belong in the Instrument Registry. It stays in config.
// But `marginPerLotStrangle` is a NIFTY figure, and applying it to BANKNIFTY or SENSEX
// is an assumption. Rather than silently scaling it (we have no spot here, so any
// scaling would be invented), the result now reports `marginSource`, and a per-instrument
// override is available via `SIZER_STRANGLE_MARGIN_<INST>`.
const instrumentRegistry = require('./instrument-registry.js');

const DEFAULTS = {
  marginPerLotStrangle: parseFloat(process.env.SIZER_STRANGLE_MARGIN || 130000), // ₹/lot SPAN+exposure (NIFTY)
  condorMarginBuffer:   1.15,   // condor margin ≈ maxLoss × buffer
  marginUtilCap:        parseFloat(process.env.SIZER_MARGIN_UTIL || 0.6),  // use ≤ 60% of capital as margin
  kellyFraction:        parseFloat(process.env.SIZER_KELLY_FRACTION || 0.5), // half-Kelly
  ivScaleFloor:         parseFloat(process.env.SIZER_IV_SCALE_FLOOR || 0.4), // at max IV, size → 40%
  maxLots:              parseInt(process.env.SIZER_MAX_LOTS || 25),
  // NOTE: no `lotSize` here. It is resolved per-instrument from the registry.
};

/** Contract size for this call. cfg.lotSize is an explicit escape hatch; otherwise the registry. */
function _resolveLot(p, C) {
  if (C.lotSize != null && Number(C.lotSize) > 0) return { lot: Number(C.lotSize), lotSource: 'cfg.lotSize' };
  const lot = instrumentRegistry.lotSize(p.inst);
  if (lot) return { lot, lotSource: 'instrument-registry' };
  return { lot: null, lotSource: null };
}

/** SPAN+exposure per strangle lot. Per-instrument env override, else the NIFTY-calibrated default. */
function _strangleMargin(inst, C) {
  const key = `SIZER_STRANGLE_MARGIN_${String(inst || '').toUpperCase()}`;
  const raw = inst ? process.env[key] : null;
  const n = Number(raw);
  if (raw != null && raw !== '' && Number.isFinite(n) && n > 0) return { value: n, marginSource: `env:${key}` };
  return { value: C.marginPerLotStrangle, marginSource: 'global default (calibrated for NIFTY)' };
}

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
  const structure = p.structure || 'STRANGLE';
  const inst = p.inst ? String(p.inst).toUpperCase() : null;

  const { lot: lotSize, lotSource } = _resolveLot(p, C);
  const { value: strangleMargin, marginSource } = _strangleMargin(inst, C);

  // C1c-5: a condor's margin is maxLoss × lotSize × buffer. Without a verified lot
  // size that number is fabricated, and it drives how many lots we tell the engine to
  // trade. Refuse rather than guess.
  if (structure === 'CONDOR' && !lotSize) {
    return {
      recommendedLots: 0, maxLotsByMargin: 0, marginPerLot: null,
      fullKellyPct: 0, fracKellyPct: 0, ivScalePct: 0, riskFractionPct: 0,
      structure, inst, lotSize: null, lotSource: null, marginSource: null,
      reason: inst
        ? `No verified contract size for ${inst}: the Instrument Registry does not know it, or it ships tradingEnabled:false. Condor margin depends on the lot size, so no recommendation is possible. Set ${inst}_TRADING_ENABLED=true to opt in.`
        : 'No instrument supplied. Condor margin depends on the lot size, so no recommendation is possible. Pass `inst` (or cfg.lotSize).',
    };
  }

  // Margin per lot by structure.
  const marginPerLot = structure === 'CONDOR'
    ? Math.max(12000, (p.maxLossPerUnit || 175) * lotSize * C.condorMarginBuffer)
    : strangleMargin;

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
    // C1c-5 additions — every sizing decision now says where its numbers came from.
    inst, lotSize: lotSize ?? null, lotSource,
    marginSource: structure === 'CONDOR' ? 'derived: maxLoss × lotSize × buffer' : marginSource,
  };
}

module.exports = { recommend, kelly, DEFAULTS };
