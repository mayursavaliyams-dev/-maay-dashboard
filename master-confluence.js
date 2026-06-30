/**
 * MASTER CONFLUENCE ENGINE — Antigravity Pro
 *
 * Fuses every independent signal the bot already computes into ONE probability
 * and a single BUY / SELL / HOLD verdict:
 *
 *   Trend + OI + Volume + News + Event + IV + PCR + Greeks + FII + Delivery
 *        ↓  (weighted, confidence-scaled, agreement-aware)
 *   Probability = NN%
 *        ↓
 *   BUY / SELL / HOLD
 *
 * This module is PURE — it does no I/O. The server gathers each factor from the
 * live engines and hands them in as normalised inputs; the math lives here so it
 * is unit-testable and identical for NIFTY and SENSEX.
 *
 * A "factor" is { score:-100..100, confidence:0..100, weight, label, note,
 *                 available:bool, kind:'dir'|'risk' }.
 *   - dir  : directional. +score = bullish, -score = bearish.
 *   - risk : a caution input (event risk, extreme IV). Never votes a direction;
 *            it only trims the final probability so we don't fire into a known
 *            landmine (RBI day, VIX spike).
 */
'use strict';

// default importance of each leg (re-normalised over whatever is actually available)
const DEFAULT_WEIGHTS = {
  trend: 16, smartMoney: 14, oi: 15, volume: 8, news: 9, pcr: 11, greeks: 11, fii: 9, iv: 6,
  // risk legs (do not carry directional weight)
  event: 0, delivery: 8,
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const sgn = v => (v > 0 ? 1 : v < 0 ? -1 : 0);

/**
 * @param {Object<string,Factor>} factors  keyed by leg name
 * @param {Object} [opts] { buyThreshold=12, holdBand=12, minFactors=4 }
 */
function fuse(factors, opts = {}) {
  const buyThreshold = opts.buyThreshold != null ? opts.buyThreshold : 12; // |net| to leave HOLD
  const minFactors   = opts.minFactors   != null ? opts.minFactors   : 4;

  const legs = [];
  for (const [key, f] of Object.entries(factors || {})) {
    if (!f || f.available === false) {
      legs.push({ key, available: false, label: f?.label || key, note: f?.note || 'unavailable' });
      continue;
    }
    const weight = f.weight != null ? f.weight : (DEFAULT_WEIGHTS[key] || 8);
    legs.push({
      key,
      available: true,
      kind: f.kind || 'dir',
      score: +clamp(Number(f.score) || 0, -100, 100).toFixed(1),
      confidence: clamp(Number(f.confidence == null ? 60 : f.confidence), 0, 100),
      weight,
      label: f.label || key,
      note: f.note || '',
    });
  }

  const dirLegs  = legs.filter(l => l.available && l.kind === 'dir');
  const riskLegs = legs.filter(l => l.available && l.kind === 'risk');

  if (dirLegs.length < minFactors) {
    return {
      decision: 'HOLD', direction: 'NEUTRAL', probability: 50, conviction: 'INSUFFICIENT',
      net: 0, agreement: 0, bullWeight: 0, bearWeight: 0,
      availableFactors: dirLegs.length, totalFactors: legs.length,
      reason: `warming up — only ${dirLegs.length}/${minFactors} directional factors ready`,
      legs,
    };
  }

  // confidence-scaled weighting → directional net in [-100, 100]
  let wSum = 0, sSum = 0, bullW = 0, bearW = 0;
  for (const l of dirLegs) {
    const w = l.weight * (l.confidence / 100);
    wSum += w;
    sSum += w * l.score;
    if (l.score > 0) bullW += w; else if (l.score < 0) bearW += w;
  }
  const net = wSum ? +(sSum / wSum).toFixed(1) : 0;            // -100..100
  const dirSign = sgn(net);

  // agreement = weighted share of directional legs pointing the same way as net
  let agreeW = 0, totW = 0;
  for (const l of dirLegs) {
    const w = l.weight * (l.confidence / 100);
    totW += w;
    if (sgn(l.score) === dirSign && dirSign !== 0) agreeW += w;
  }
  const agreement = totW ? +(agreeW / totW).toFixed(3) : 0;   // 0..1

  // decision
  let direction = 'NEUTRAL', decision = 'HOLD';
  if (net >= buyThreshold)       { direction = 'BULLISH'; decision = 'BUY'; }
  else if (net <= -buyThreshold) { direction = 'BEARISH'; decision = 'SELL'; }

  // base probability: magnitude × how unanimous the vote is
  let probability = 50;
  if (decision !== 'HOLD') {
    probability = 50 + (Math.abs(net) / 100) * 45 * (0.55 + 0.45 * agreement);
  } else {
    probability = 50 + (Math.abs(net) / 100) * 8;             // weak lean while still HOLD
  }

  // risk legs trim probability (and can force HOLD when severe)
  const cautions = [];
  let riskPenalty = 0;
  for (const l of riskLegs) {
    // risk score 0..100 (severity). penalty scales with weight share of the leg.
    const sev = clamp(Number(l.score) || 0, 0, 100);
    const pen = (sev / 100) * (l.weight ? 10 : 8) + (sev >= 75 ? 6 : 0);
    if (pen > 0.5) { riskPenalty += pen; cautions.push({ leg: l.key, label: l.label, severity: sev, note: l.note }); }
  }
  probability = clamp(probability - riskPenalty, 5, 95);

  // severe risk demotes a fired signal to HOLD
  const severeRisk = riskLegs.some(l => (Number(l.score) || 0) >= 80);
  if (decision !== 'HOLD' && (probability < 58 || severeRisk)) {
    if (severeRisk) cautions.push({ leg: 'override', label: 'High event/vol risk', severity: 100, note: 'verdict demoted to HOLD' });
    decision = 'HOLD';
  }

  const conviction =
    decision === 'HOLD'   ? (Math.abs(net) < buyThreshold ? 'NO EDGE' : 'STAND ASIDE') :
    probability >= 85     ? 'VERY HIGH' :
    probability >= 75     ? 'HIGH' :
    probability >= 65     ? 'MODERATE' : 'LOW';

  // human-readable driver list (strongest contributing legs in the chosen direction)
  const drivers = dirLegs
    .filter(l => dirSign !== 0 && sgn(l.score) === dirSign)
    .map(l => ({ leg: l.key, label: l.label, score: l.score, weight: l.weight, note: l.note }))
    .sort((a, b) => Math.abs(b.score) * b.weight - Math.abs(a.score) * a.weight);
  const against = dirLegs
    .filter(l => dirSign !== 0 && sgn(l.score) === -dirSign)
    .map(l => ({ leg: l.key, label: l.label, score: l.score, note: l.note }))
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score));

  return {
    decision,                                   // BUY | SELL | HOLD
    direction,                                  // BULLISH | BEARISH | NEUTRAL
    probability: Math.round(probability),       // %
    conviction,                                 // VERY HIGH | HIGH | MODERATE | LOW | ...
    net,                                        // -100..100 directional consensus
    agreement,                                  // 0..1 unanimity among directional legs
    bullWeight: +bullW.toFixed(1),
    bearWeight: +bearW.toFixed(1),
    riskPenalty: +riskPenalty.toFixed(1),
    cautions,
    availableFactors: dirLegs.length,
    totalFactors: legs.length,
    drivers,                                    // legs supporting the verdict
    against,                                    // legs disagreeing
    legs,                                       // full per-factor breakdown
  };
}

module.exports = { fuse, DEFAULT_WEIGHTS };
