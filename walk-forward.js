/* ═══════════════════════════════════════════════════════════════════════════
   walk-forward — roll through history, optimise in-sample, report out-of-sample.

   THE HEADLINE NUMBER IS THE CONCATENATED OUT-OF-SAMPLE RESULT. Nothing else.

   In-sample results are computed and kept, because they are diagnostic — the gap
   between in-sample and out-of-sample IS the overfitting measurement. They are
   never the headline, and `result()` puts them behind a field called
   `diagnosticOnly` so a reader cannot mistake one for the other.

   PARAMETER STABILITY IS A RESULT, NOT A FOOTNOTE

   If the optimiser picks a lookback of 5 in one fold, 40 in the next and 12 in
   the third, the strategy is fitting noise and the out-of-sample number is an
   accident of which fold happened to align. That finding appears in the report
   with the same prominence as the returns, because it is the more important of
   the two.

   PURGING AND EMBARGO

   For anything with a label horizon, a training sample whose label resolves
   INSIDE the test window has seen the test window. Purging removes those; the
   embargo removes the samples immediately after the test window, whose features
   overlap it backwards.

   The embargo must be at least `maxFeatureLookback + maxLabelHorizon`. Anything
   shorter leaves a seam, and a seam is leakage that no other test will catch —
   the shuffled-label test would pass, because the leak is structural rather than
   in the labels.

   `assertNoOverlap` is run on every split and FAILS the run rather than warning.
   A split that leaks produces confident numbers about nothing.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const num = (v) => (v === null || v === undefined || !isFinite(Number(v))) ? null : Number(v);
const r3 = (v, d = 4) => v === null || v === undefined ? null : +Number(v).toFixed(d);
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
function stdev(a) { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); }

/**
 * Build rolling walk-forward folds.
 *
 * @param n            number of observations
 * @param inSample     in-sample window length
 * @param outSample    out-of-sample window length
 * @param step         how far to roll (defaults to outSample — non-overlapping OOS)
 * @param anchored     true = expanding in-sample window; false = rolling
 */
function buildFolds({ n, inSample, outSample, step = null, anchored = false }) {
  const N = num(n), IS = num(inSample), OS = num(outSample);
  if (N === null || IS === null || OS === null) return { ok: false, why: 'n, inSample and outSample are all required' };
  if (IS < 2 || OS < 1) return { ok: false, why: 'windows too small to mean anything' };
  if (IS + OS > N) return { ok: false, why: `not enough data: ${N} observations cannot hold a ${IS}+${OS} fold` };

  const st = num(step) || OS;
  const folds = [];
  for (let start = 0; start + IS + OS <= N; start += st) {
    folds.push({
      index: folds.length,
      isStart: anchored ? 0 : start,
      isEnd: start + IS,            // exclusive
      oosStart: start + IS,
      oosEnd: start + IS + OS,      // exclusive
    });
  }
  if (!folds.length) return { ok: false, why: 'no folds could be built from these windows' };

  /* Overlapping out-of-sample windows would evaluate the same observations
     repeatedly and make the concatenated result look longer than the evidence
     behind it. Reported rather than silently allowed. */
  const overlapping = st < OS;
  return {
    ok: true, folds, count: folds.length, anchored,
    oosOverlap: overlapping,
    warning: overlapping
      ? `step ${st} is smaller than the out-of-sample window ${OS}: OOS windows OVERLAP, so the concatenated result reuses observations`
      : null,
  };
}

/**
 * Purge and embargo a training index set against a test window.
 *
 * @param trainIdx        candidate training indices
 * @param testStart/End   test window, end exclusive
 * @param labelHorizon    how many observations forward a label needs to resolve
 * @param featureLookback how many observations back a feature reaches
 * @param embargo         explicit embargo; defaults to labelHorizon+featureLookback
 */
function purgeAndEmbargo({ trainIdx, testStart, testEnd, labelHorizon = 0, featureLookback = 0, embargo = null }) {
  const lh = num(labelHorizon) ?? 0, fl = num(featureLookback) ?? 0;
  const emb = num(embargo) ?? (lh + fl);

  if (emb < lh + fl) {
    /* Refused, not clamped. An embargo shorter than the lookback plus the
       horizon leaves a seam, and a seam is structural leakage that the
       shuffled-label test cannot see — it would pass, because the leak is not
       in the labels. */
    return {
      ok: false,
      why: `embargo ${emb} is shorter than featureLookback ${fl} + labelHorizon ${lh} = ${fl + lh}. ` +
           'A shorter embargo leaves a seam, and that seam is leakage no other test in this harness will catch',
    };
  }

  const purged = [], kept = [];
  for (const i of trainIdx) {
    // A training sample whose LABEL resolves inside the test window has seen it.
    const labelEnd = i + lh;
    const overlapsForward = labelEnd >= testStart && i < testEnd;
    // A sample after the test window whose FEATURES reach back into it.
    const featureStart = i - fl;
    const overlapsBackward = i >= testEnd && featureStart < testEnd;
    // The embargo band immediately after the test window.
    const inEmbargo = i >= testEnd && i < testEnd + emb;
    if (overlapsForward || overlapsBackward || inEmbargo) purged.push(i); else kept.push(i);
  }

  return {
    ok: true, train: kept, purged,
    purgedCount: purged.length, keptCount: kept.length,
    embargo: emb, labelHorizon: lh, featureLookback: fl,
  };
}

/**
 * Prove a split does not leak. Returns { ok } or FAILS with the offending indices.
 *
 * This is deliberately a separate, independent check rather than trusting
 * `purgeAndEmbargo` to have done its job: the assertion is what the run is
 * allowed to depend on.
 */
function assertNoOverlap({ train, testStart, testEnd, labelHorizon = 0, featureLookback = 0, embargo = null }) {
  const lh = num(labelHorizon) ?? 0, fl = num(featureLookback) ?? 0;
  const emb = num(embargo) ?? (lh + fl);
  const offenders = [];
  for (const i of train) {
    if (i >= testStart && i < testEnd) offenders.push({ i, why: 'training index is inside the test window' });
    else if (i < testStart && i + lh >= testStart) offenders.push({ i, why: `label horizon reaches into the test window (${i}+${lh} ≥ ${testStart})` });
    else if (i >= testEnd && i - fl < testEnd) offenders.push({ i, why: `feature lookback reaches back into the test window (${i}-${fl} < ${testEnd})` });
    else if (i >= testEnd && i < testEnd + emb) offenders.push({ i, why: `inside the ${emb}-observation embargo` });
  }
  return offenders.length
    ? { ok: false, offenders: offenders.slice(0, 20), offenderCount: offenders.length,
        why: `${offenders.length} training sample(s) appear on both sides of the split — the run FAILS rather than warns` }
    : { ok: true, checked: train.length };
}

/**
 * Measure how stable the chosen parameters are across folds.
 *
 * Numeric parameters get a coefficient of variation; categorical ones get the
 * share taken by the modal value. Both are turned into a 0–1 instability score
 * where higher is worse, and the summary names the worst offender — because
 * "the parameters are unstable" is not actionable and "lookback ranged 5–40
 * across 6 folds" is.
 */
function parameterStability(chosenPerFold) {
  const folds = (chosenPerFold || []).filter(p => p && typeof p === 'object');
  if (folds.length < 2) return { ok: false, why: `need at least 2 folds, got ${folds.length}` };

  const keys = [...new Set(folds.flatMap(Object.keys))];
  const params = {};
  for (const k of keys) {
    const vals = folds.map(f => f[k]).filter(v => v !== undefined);
    const nums = vals.map(num).filter(v => v !== null);
    if (nums.length === vals.length && nums.length >= 2) {
      const m = mean(nums), s = stdev(nums);
      const cv = (m !== 0) ? Math.abs(s / m) : (s > 0 ? Infinity : 0);
      params[k] = {
        type: 'numeric', values: nums, mean: r3(m), stdev: r3(s),
        min: Math.min(...nums), max: Math.max(...nums),
        coefficientOfVariation: r3(cv),
        instability: r3(Math.min(1, cv)),
      };
    } else {
      const counts = {};
      for (const v of vals) counts[String(v)] = (counts[String(v)] || 0) + 1;
      const modal = Math.max(...Object.values(counts));
      params[k] = {
        type: 'categorical', values: vals, distinct: Object.keys(counts).length,
        modalShare: r3(modal / vals.length),
        instability: r3(1 - modal / vals.length),
      };
    }
  }

  const scores = Object.entries(params).map(([k, v]) => ({ k, s: v.instability }));
  const worst = scores.sort((a, b) => b.s - a.s)[0];
  const overall = mean(scores.map(x => x.s));

  return {
    ok: true, folds: folds.length, params,
    overallInstability: r3(overall),
    worstParameter: worst ? worst.k : null,
    verdict: overall >= 0.5 ? 'FITTING_NOISE' : overall >= 0.25 ? 'UNSTABLE' : 'STABLE',
    plainly: worst && params[worst.k].type === 'numeric'
      ? `Across ${folds.length} folds the optimiser chose ${worst.k} between ${params[worst.k].min} and ${params[worst.k].max}` +
        (overall >= 0.25 ? '. Parameters that jump around between folds indicate the strategy is fitting noise.' : '.')
      : `Parameter stability across ${folds.length} folds: ${r3(overall)}.`,
  };
}

/**
 * Run a walk-forward analysis.
 *
 * @param data      the observation array
 * @param optimise(slice, foldIndex)  → chosen params  (the caller's optimiser)
 * @param evaluate(slice, params, foldIndex) → { returns:[], ...metrics }
 *
 * Both are injected, because this module has no business knowing what a strategy
 * is. It knows only what a fold is and what may not cross one.
 */
function walkForward({ data, inSample, outSample, step = null, anchored = false, optimise, evaluate,
                       labelHorizon = 0, featureLookback = 0, embargo = null, onFold = null }) {
  if (!Array.isArray(data) || !data.length) return { ok: false, why: 'no data' };
  if (typeof optimise !== 'function' || typeof evaluate !== 'function') {
    return { ok: false, why: 'optimise and evaluate must both be supplied — this module does not know what a strategy is' };
  }
  const built = buildFolds({ n: data.length, inSample, outSample, step, anchored });
  if (!built.ok) return built;

  const folds = [];
  const chosen = [];
  const oosReturns = [];
  const isReturns = [];

  for (const f of built.folds) {
    const trainIdx = [];
    for (let i = f.isStart; i < f.isEnd; i++) trainIdx.push(i);

    const pe = purgeAndEmbargo({
      trainIdx, testStart: f.oosStart, testEnd: f.oosEnd,
      labelHorizon, featureLookback, embargo,
    });
    if (!pe.ok) return { ok: false, why: `fold ${f.index}: ${pe.why}` };

    const check = assertNoOverlap({
      train: pe.train, testStart: f.oosStart, testEnd: f.oosEnd,
      labelHorizon, featureLookback, embargo,
    });
    if (!check.ok) {
      // FAILS the run. Not a warning, not a skipped fold.
      return { ok: false, leakage: check, why: `fold ${f.index}: ${check.why}` };
    }

    const params = optimise(pe.train.map(i => data[i]), f.index);
    chosen.push(params);

    const isRes = evaluate(pe.train.map(i => data[i]), params, f.index) || {};
    const oosSlice = [];
    for (let i = f.oosStart; i < f.oosEnd; i++) oosSlice.push(data[i]);
    const oosRes = evaluate(oosSlice, params, f.index) || {};

    (isRes.returns || []).forEach(v => { const x = num(v); if (x !== null) isReturns.push(x); });
    (oosRes.returns || []).forEach(v => { const x = num(v); if (x !== null) oosReturns.push(x); });

    const rec = {
      fold: f.index, window: f,
      trainSize: pe.keptCount, purged: pe.purgedCount, embargo: pe.embargo,
      params,
      inSample: { ...isRes, returns: undefined, n: (isRes.returns || []).length },
      outOfSample: { ...oosRes, returns: undefined, n: (oosRes.returns || []).length },
    };
    folds.push(rec);
    /* A progress listener must never break the run — but a listener that has
       been throwing on every fold is a report nobody is receiving, so it is
       reported rather than swallowed. */
    if (onFold) {
      try { onFold(rec); }
      catch (e) { (typeof console !== 'undefined' ? console : { error() {} }).error(`[walk-forward] fold listener threw on fold ${f.index} (${e.message}) — the fold still ran`); }
    }
  }

  const stability = parameterStability(chosen);

  return {
    ok: true,
    folds,
    foldCount: folds.length,
    oosOverlapWarning: built.warning,

    /* THE HEADLINE. Concatenated out-of-sample returns and nothing else. */
    headline: {
      basis: 'concatenated OUT-OF-SAMPLE returns across all folds',
      returns: oosReturns,
      n: oosReturns.length,
      mean: r3(mean(oosReturns)),
      stdev: r3(stdev(oosReturns)),
    },

    /* Kept, and named so it cannot be mistaken for the headline. The GAP is the
       overfitting measurement and is the reason in-sample is computed at all. */
    diagnosticOnly: {
      inSample: { n: isReturns.length, mean: r3(mean(isReturns)), stdev: r3(stdev(isReturns)) },
      inSampleMinusOutOfSample: (mean(isReturns) !== null && mean(oosReturns) !== null)
        ? r3(mean(isReturns) - mean(oosReturns)) : null,
      note: 'in-sample figures are diagnostic. They are never the reported result.',
    },

    parameterStability: stability,
    bestFold: folds.reduce((b, f) => (!b || (f.outOfSample.pnl ?? -Infinity) > (b.outOfSample.pnl ?? -Infinity)) ? f : b, null)?.fold ?? null,
    bestFoldWarning: 'the best fold is reported for diagnosis ONLY. It is never the result — presenting it as one is the error this harness exists to prevent.',
  };
}

module.exports = { walkForward, buildFolds, purgeAndEmbargo, assertNoOverlap, parameterStability };
