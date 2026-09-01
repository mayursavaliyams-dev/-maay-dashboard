/* calibration.js — does a shown probability mean what it says?
 *
 * The readiness page carried this blocker as a hardcoded string:
 *
 *     'No central calibrated recommendation gate has passed n>=200 outcomes
 *      and per-bin reliability.'
 *
 * while its own subtitle promised "runtime blockers, not intention". A constant
 * is intention. It reads identically whether the evidence is missing, damning or
 * excellent, so it can never *stop* being true and can never be argued with.
 *
 * This module measures it instead. It answers three separate questions and never
 * lets one stand in for another:
 *
 *   PASS         enough outcomes, and every evaluable bin is honest
 *   BLOCKED      measured, and the numbers do not clear the gate
 *   UNEVALUABLE  the evidence cannot be read or is too thin to judge
 *
 * BLOCKED and UNEVALUABLE are both "not live", so it is tempting to merge them.
 * They must not merge: BLOCKED is a finding about the model, UNEVALUABLE is a
 * finding about us. Only one of them is fixed by collecting more data.
 *
 * Measured on data/ai-agents-trades.json, 2026-09-01, 120 closed outcomes:
 * predicted ~68%, observed 42.5%, Brier 0.2969 — worse than a coin flip at 0.25.
 */

'use strict';

const fs = require('fs');

/* The gate, in one place, so the number on the page and the number in the test
 * cannot drift apart. Raising or lowering any of these is a deliberate act and
 * belongs in the same commit as the argument for it. */
const GATE = Object.freeze({
  minOutcomes: 200,   // total closed outcomes before any claim is publishable
  minPerBin: 20,      // below this a bin's win-rate is noise wearing a percentage
  minEvaluableBins: 3,// one honest bin is not a calibrated model
  tolerancePts: 10,   // |observed − predicted|, in percentage points
});

/* ── reading evidence ───────────────────────────────────────────────────────
 * An unreadable ledger returns null. It must never return [], because [] means
 * "we looked and there were no outcomes" — which would let a broken path
 * masquerade as an honest empty result and quietly report n = 0. */

function readJson(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) { return { rows: null, reason: `unreadable: ${e.code || e.message}` }; }
  try {
    const j = JSON.parse(raw);
    const rows = Array.isArray(j) ? j : (j.trades || j.rows || null);
    if (!Array.isArray(rows)) return { rows: null, reason: 'no array of rows in file' };
    return { rows, reason: null };
  } catch (e) { return { rows: null, reason: `unparseable: ${e.message}` }; }
}

/* Pull (predicted, outcome) pairs out of a ledger.
 *
 * `outcomeOf` is supplied by the caller and never defaulted. What counts as a
 * "win" is a modelling claim, not a fact about the file: the agent ledger's
 * `probability` is a *directional impact* estimate, while `pnl` is the result of
 * that estimate AND a +40%/−20% exit rule. Treating one as a prediction of the
 * other is an assumption, and an assumption the caller has to make out loud.
 */
function extractOutcomes(rows, { predictedOf, outcomeOf, scale = 100 }) {
  if (!Array.isArray(rows)) return null;
  const out = [];
  for (const r of rows) {
    /* Number(null) is 0 and Number('') is 0. Going through Number() first would
     * turn "this row carries no prediction" into "this row confidently predicted
     * 0%", and a heap of false 0% predictions that mostly lost would look like
     * beautiful calibration. Reject the absent value before it can be coerced. */
    const raw = predictedOf(r);
    if (raw === null || raw === undefined || raw === '') continue;
    const p = Number(raw);
    if (!Number.isFinite(p)) continue;
    const o = outcomeOf(r);
    if (o !== true && o !== false) continue;   // unresolved rows are not evidence
    out.push({ predicted: p / scale, outcome: o });
  }
  return out;
}

/* ── the measurement ────────────────────────────────────────────────────────── */

function makeBins(count) {
  const bins = [];
  for (let i = 0; i < count; i++) bins.push({ lo: i / count, hi: (i + 1) / count });
  return bins;
}

/**
 * Bin the predictions, compare each bin's promise against what happened, and
 * score the whole set.
 *
 * A bin holding fewer than `minPerBin` samples reports `evaluable: false` and
 * NO observed rate. Publishing "100% observed" off three samples is how a model
 * gets believed for the wrong reason; the honest output there is a refusal.
 */
function calibrate(records, gate = GATE, binCount = 10) {
  if (records === null) {
    return { verdict: 'UNEVALUABLE', reason: 'outcome evidence could not be read', n: null,
             bins: null, brier: null, gate };
  }

  const n = records.length;
  const bins = makeBins(binCount).map(b => {
    const inBin = records.filter(r => r.predicted >= b.lo && (r.predicted < b.hi || (b.hi === 1 && r.predicted === 1)));
    const count = inBin.length;
    if (count < gate.minPerBin) {
      return { lo: b.lo, hi: b.hi, n: count, evaluable: false,
               predicted: null, observed: null, gapPts: null };
    }
    const predicted = inBin.reduce((s, r) => s + r.predicted, 0) / count;
    const observed = inBin.filter(r => r.outcome).length / count;
    return { lo: b.lo, hi: b.hi, n: count, evaluable: true,
             predicted, observed, gapPts: (observed - predicted) * 100 };
  });

  /* Brier is only meaningful over the whole set, so it is reported even when the
   * gate fails — it is the single number that says how far off the promises were. */
  const brier = n ? records.reduce((s, r) => s + (r.predicted - (r.outcome ? 1 : 0)) ** 2, 0) / n : null;

  const evaluable = bins.filter(b => b.evaluable);
  const failing = evaluable.filter(b => Math.abs(b.gapPts) > gate.tolerancePts);

  /* Order matters. "Too little evidence" is checked before "the evidence is bad",
   * because a thin sample cannot support either verdict and saying BLOCKED there
   * would be a claim we have not earned. */
  if (n < gate.minOutcomes) {
    return { verdict: 'UNEVALUABLE', n, bins, brier, gate,
             reason: `${n} resolved outcomes; the gate needs ${gate.minOutcomes} before any probability is published` };
  }
  if (evaluable.length < gate.minEvaluableBins) {
    return { verdict: 'UNEVALUABLE', n, bins, brier, gate,
             reason: `only ${evaluable.length} bin(s) hold ${gate.minPerBin}+ samples; the model does not spread its predictions widely enough to be tested` };
  }
  if (failing.length) {
    const worst = failing.reduce((a, b) => Math.abs(b.gapPts) > Math.abs(a.gapPts) ? b : a);
    return { verdict: 'BLOCKED', n, bins, brier, gate,
             reason: `${failing.length} of ${evaluable.length} evaluable bins miss by more than ${gate.tolerancePts} points; worst is ${(worst.lo * 100).toFixed(0)}-${(worst.hi * 100).toFixed(0)}% promising ${(worst.predicted * 100).toFixed(1)}% and delivering ${(worst.observed * 100).toFixed(1)}%` };
  }
  return { verdict: 'PASS', n, bins, brier, gate,
           reason: `${n} outcomes across ${evaluable.length} evaluable bins, all within ${gate.tolerancePts} points` };
}

/** Read a ledger and calibrate it in one step. Returns UNEVALUABLE, never throws. */
function calibrateFile(file, opts) {
  const { rows, reason } = readJson(file);
  if (rows === null) {
    return { verdict: 'UNEVALUABLE', reason: `${file}: ${reason}`, n: null, bins: null,
             brier: null, gate: opts?.gate || GATE, source: file };
  }
  const records = extractOutcomes(rows, opts);
  return { ...calibrate(records, opts?.gate || GATE, opts?.binCount || 10), source: file };
}

module.exports = { GATE, readJson, extractOutcomes, calibrate, calibrateFile, makeBins };
