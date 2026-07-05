// ============================================================================
//  meta-label.js — Signal-Engine Roadmap · Phase 3 (calibrated confluence probability)
//
//  López de Prado's META-LABELING: the primary model decides the SIDE (our regime +
//  direction heads already do). A SECONDARY model decides whether to ACT and how big,
//  by turning a pile of raw confluence factors into ONE calibrated probability —
//  "given all this, how often has a trade like this actually worked?"
//
//  We keep it honest & transparent (SEBI white-box friendly): a logistic blend of
//  disclosed features, then PLATT/ISOTONIC-style calibration against realized outcomes
//  so that "70%" empirically means ~70%. A reliability tracker measures calibration
//  drift (Brier score, reliability bins) — feeds Phase 5 signal-health.
//
//  Pure & unit-tested. No external ML libs — logistic + online outcome bins only.
// ============================================================================
'use strict';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, d = 4) => +(+v).toFixed(d);
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

// Disclosed feature weights (white-box). Each feature is normalized to ~[-1,1].
// These are PRIORS from our backtests, refined by calibration, never hidden.
const WEIGHTS = {
  bias: -0.15,
  regime: 1.35,        // SELL-ON regime strength — our strongest, validated edge
  ivp: 0.55,           // IV percentile (rich premium to sell)
  vrp: 0.85,           // IV − realized vol premium
  trend: 0.45,         // trend alignment for the chosen side
  momentum: 0.35,      // RSI/MACD momentum agreement
  pcr: 0.30,           // PCR conditioning (beats VIX-only in research)
  gexRange: 0.40,      // positive GEX = range-friendly for premium selling
  event: -0.70,        // event/panic risk penalizes (widens tails)
};

/**
 * Raw confluence features, each already normalized to roughly [-1, 1]
 * (helpers below build them from real inputs). Returns a RAW logistic probability
 * before empirical calibration.
 * @param {object} f
 */
function rawProbability(f = {}) {
  const w = WEIGHTS;
  let z = w.bias;
  z += w.regime * (Number(f.regime) || 0);
  z += w.ivp * (Number(f.ivp) || 0);
  z += w.vrp * (Number(f.vrp) || 0);
  z += w.trend * (Number(f.trend) || 0);
  z += w.momentum * (Number(f.momentum) || 0);
  z += w.pcr * (Number(f.pcr) || 0);
  z += w.gexRange * (Number(f.gexRange) || 0);
  z += w.event * (Number(f.event) || 0);
  return clamp(sigmoid(z), 0.01, 0.99);
}

/**
 * Build normalized features from real signal inputs.
 *   regimeScore 0-100, ivp 0-100, ivMinusRV (decimal vol pts), trend/-1..1,
 *   momentum -100..100, pcr ~0.4..2, gexRange 'RANGE'|'TREND', eventRisk 0-1
 */
function featuresFrom(inp = {}) {
  const regimeScore = inp.regimeScore != null ? Number(inp.regimeScore) : 50;
  const ivp = inp.ivp != null ? Number(inp.ivp) : 50;
  const pcr = inp.pcr != null ? Number(inp.pcr) : 1;
  return {
    regime: clamp((regimeScore - 50) / 50, -1, 1),
    ivp: clamp((ivp - 50) / 50, -1, 1),
    vrp: clamp((Number(inp.ivMinusRV) || 0) / 0.08, -1, 1),      // 8 vol pts = saturated
    trend: clamp(Number(inp.trend) || 0, -1, 1),
    momentum: clamp((Number(inp.momentum) || 0) / 100, -1, 1),
    pcr: clamp((pcr - 1) / 0.6, -1, 1),
    gexRange: inp.gexRange === 'RANGE' ? 1 : inp.gexRange === 'TREND' ? -1 : 0,
    event: clamp(Number(inp.eventRisk) || 0, 0, 1),
  };
}

// ── Empirical calibration: reliability bins over realized outcomes ──
// Turns raw model probs into calibrated ones so "70%" means ~70% observed win-rate.
function newCalibrator() {
  // 10 bins [0,0.1)…[0.9,1]; each holds {n, wins} of realized trades whose raw p fell here.
  return { bins: Array.from({ length: 10 }, () => ({ n: 0, wins: 0 })), total: 0, brierSum: 0 };
}
const binOf = (p) => clamp(Math.floor(p * 10), 0, 9);

// Record a realized outcome (won: bool) for a trade whose raw prob was rawP.
function recordOutcome(cal, rawP, won) {
  const b = cal.bins[binOf(rawP)];
  b.n++; if (won) b.wins++;
  cal.total++;
  const y = won ? 1 : 0;
  cal.brierSum += (rawP - y) * (rawP - y);
  return cal;
}

// Calibrated probability: empirical win-rate of the bin, shrunk toward the raw prob
// by sample size (Laplace/pseudo-count smoothing) so thin bins don't overfit.
function calibrate(cal, rawP) {
  if (!cal || !cal.total) return rawP;
  const b = cal.bins[binOf(rawP)];
  const pseudo = 8;                                   // pseudo-count → shrink to raw when data is thin
  const emp = (b.wins + pseudo * rawP) / (b.n + pseudo);
  return clamp(round(emp, 4), 0.01, 0.99);
}

// Calibration health: Brier score (lower is better) + reliability table + ECE.
function health(cal) {
  if (!cal || !cal.total) return { total: 0, brier: null, ece: null, reliability: [] };
  const brier = round(cal.brierSum / cal.total, 4);
  let ece = 0;
  const reliability = cal.bins.map((b, i) => {
    const conf = (i + 0.5) / 10;
    const acc = b.n ? b.wins / b.n : null;
    if (b.n) ece += (b.n / cal.total) * Math.abs(acc - conf);
    return { bin: `${(i / 10).toFixed(1)}-${((i + 1) / 10).toFixed(1)}`, n: b.n, winRate: acc == null ? null : round(acc, 3) };
  });
  return { total: cal.total, brier, ece: round(ece, 4), reliability };
}

/** One-call convenience: features → raw → calibrated, with the disclosed breakdown. */
function scoreConfluence(inp, cal) {
  const feats = featuresFrom(inp);
  const raw = rawProbability(feats);
  const calibrated = cal ? calibrate(cal, raw) : raw;
  return {
    rawProbability: round(raw, 4),
    probability: round(calibrated, 4),
    probabilityPct: Math.round(calibrated * 100),
    features: feats,
    weights: WEIGHTS,
    calibrationSamples: cal ? cal.total : 0,
    note: 'White-box meta-label: disclosed logistic blend, empirically calibrated against realized paper outcomes.',
  };
}

module.exports = {
  rawProbability, featuresFrom, scoreConfluence,
  newCalibrator, recordOutcome, calibrate, health, WEIGHTS,
};
