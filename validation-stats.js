/* ═══════════════════════════════════════════════════════════════════════════
   validation-stats — the arithmetic that decides whether a result is real.

   Four instruments, and each is designed to say NO:

     deflatedSharpe   — how much of an observed Sharpe survives the fact that N
                        variants were tried and the best kept
     pbo              — probability of backtest overfitting: how often the
                        in-sample best is below median out of sample
     randomEntryNull  — the strategy's result placed against a distribution of
                        random entries with the same holding period, sizing and
                        costs
     shuffledLabels   — retrain on shuffled labels; performance must collapse to
                        chance, and if it does not there is leakage

   THE RULE THAT GOVERNS ALL FOUR

   An input that is unknown produces a REFUSAL, not a default. A deflated Sharpe
   computed with `trials = 1` because nobody counted is not a conservative
   estimate — it is the original number wearing a serious name, and it is worse
   than reporting nothing because it looks like it has been checked.

   Every function below returns `{ ok: false, why }` when it cannot honestly
   compute, and the harness prints that rather than a figure.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const num = (v) => (v === null || v === undefined || !isFinite(Number(v))) ? null : Number(v);
const r3 = (v, d = 4) => v === null || v === undefined ? null : +Number(v).toFixed(d);

/* Standard normal CDF and inverse, needed by the deflation formula. */
function normCdf(x) {
  // Abramowitz & Stegun 7.1.26 via erf
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  let p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}
function normInv(p) {
  // Acklam's rational approximation — adequate for the quantiles used here.
  if (!(p > 0 && p < 1)) return null;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  q = p - 0.5; r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
function stdev(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}
function skewKurt(a) {
  if (a.length < 4) return { skew: 0, kurt: 3 };
  const m = mean(a), s = stdev(a);
  if (!s) return { skew: 0, kurt: 3 };
  const n = a.length;
  const g1 = a.reduce((t, x) => t + ((x - m) / s) ** 3, 0) / n;
  const g2 = a.reduce((t, x) => t + ((x - m) / s) ** 4, 0) / n;
  return { skew: g1, kurt: g2 };
}

/** Sharpe of a return series, annualised by `periodsPerYear`. */
function sharpe(returns, periodsPerYear = 252) {
  const r = (returns || []).map(num).filter(v => v !== null);
  if (r.length < 2) return { ok: false, why: `need at least 2 returns, got ${r.length}` };
  const s = stdev(r);
  if (!s || s === 0) {
    // A zero-variance series has an undefined Sharpe. Reporting Infinity, or 0,
    // would both be inventions.
    return { ok: false, why: 'return series has zero variance — Sharpe is undefined, not infinite' };
  }
  const sr = mean(r) / s;
  return { ok: true, sharpe: r3(sr * Math.sqrt(periodsPerYear)), perPeriod: r3(sr), n: r.length, ...skewKurt(r) };
}

/**
 * Deflated Sharpe ratio.
 *
 * Follows Bailey & López de Prado's construction: the observed Sharpe is tested
 * against the Sharpe that the BEST of N independent trials would be expected to
 * produce by chance alone, adjusting for the sample's skew and kurtosis.
 *
 * @param observedSharpe   annualised
 * @param trials           number of variants tried — REQUIRED
 * @param n                number of return observations
 * @param skew, kurt       of the return series
 *
 * @returns { ok, expectedMaxSharpe, deflatedSharpe (a probability), verdict }
 *
 * `deflatedSharpe` here is the PROBABILITY that the true Sharpe exceeds the
 * benchmark — not a rescaled Sharpe. It is named as the literature names it and
 * its units are stated, because a probability read as a Sharpe is a serious
 * misreading in the flattering direction.
 */
function deflatedSharpe({ observedSharpe, trials, n, skew = 0, kurt = 3, periodsPerYear = 252 }) {
  const sr = num(observedSharpe), N = num(trials), T = num(n);
  if (sr === null) return { ok: false, why: 'observedSharpe is not a number' };
  if (T === null || T < 4) return { ok: false, why: `need at least 4 return observations, got ${T}` };
  if (N === null || N < 1) {
    return {
      ok: false,
      why: 'the trial count is UNKNOWN. A deflated Sharpe computed as though one variant had been tried ' +
           'is the original number wearing a serious name — worse than reporting nothing, because it looks checked',
    };
  }

  /* Expected maximum Sharpe from N independent trials of a zero-skill process.
     The standard approximation with the Euler-Mascheroni constant. */
  const srPer = sr / Math.sqrt(periodsPerYear);

  /* The standard error of the Sharpe estimator, adjusted for non-normal returns.
     Options returns are strongly non-normal — a short-premium strategy is the
     textbook case — so ignoring skew and kurtosis here would overstate
     significance for exactly the strategies this system runs. */
  const se = Math.sqrt((1 - skew * srPer + ((kurt - 1) / 4) * srPer * srPer) / (T - 1));
  if (!(se > 0)) return { ok: false, why: 'the Sharpe estimator variance is non-positive — the return series is degenerate' };

  /* Expected maximum Sharpe from N trials of a zero-skill process.
     The bracket is in STANDARD-NORMAL QUANTILE units; it becomes a Sharpe only
     after multiplying by the estimator's standard error. The first version of
     this function omitted that multiplication and reported an expected maximum
     of 13.5 annualised Sharpe from three trials — a figure absurd enough to
     catch, which is the only reason it was caught. */
  const g = 0.5772156649;
  const e = Math.exp(1);
  let zMax;
  if (N === 1) {
    /* One trial is no selection at all, so the expected maximum is the
       expectation of a single draw: zero. The quantile form is undefined at
       N=1 (normInv(0)), and erroring there would refuse the one case that needs
       no deflation. */
    zMax = 0;
  } else {
    const z1 = normInv(1 - 1 / N);
    const z2 = normInv(1 - 1 / (N * e));
    if (z1 === null || z2 === null) return { ok: false, why: 'trial count out of range for the quantile approximation' };
    zMax = (1 - g) * z1 + g * z2;
  }
  const expectedMax = zMax * se;                  // per-period Sharpe units

  const stat = (srPer - expectedMax) / se;
  const p = normCdf(stat);

  return {
    ok: true,
    trials: N,
    observedSharpe: r3(sr),
    expectedMaxFromChance: r3(expectedMax * Math.sqrt(periodsPerYear)),
    deflatedSharpeProbability: r3(p),
    units: 'deflatedSharpeProbability is a PROBABILITY that the true Sharpe exceeds the chance benchmark — it is not a Sharpe',
    verdict: p >= 0.95 ? 'SURVIVES' : p >= 0.90 ? 'MARGINAL' : 'FAILS',
    plainly: p < 0.90
      ? `With ${N} trials against the same data, a Sharpe of ${r3(sr)} is not distinguishable from the best of ${N} coin flips.`
      : `A Sharpe of ${r3(sr)} survives deflation for ${N} trials at p=${r3(p)}.`,
  };
}

/**
 * Probability of backtest overfitting, by combinatorially symmetric
 * cross-validation.
 *
 * @param perf  a matrix: perf[trial][block] = performance of that trial on that block
 *
 * PBO is the fraction of splits in which the trial chosen as best in-sample
 * lands below the median out-of-sample. A PBO near 0.5 means the selection
 * carries no information at all.
 */
function pbo(perf, opts = {}) {
  const M = (perf || []).filter(row => Array.isArray(row) && row.length);
  if (M.length < 2) return { ok: false, why: `need at least 2 trials, got ${M.length}` };
  const S = M[0].length;
  if (S < 4 || S % 2 !== 0) return { ok: false, why: `need an even number of blocks, at least 4 — got ${S}` };
  if (!M.every(r => r.length === S)) return { ok: false, why: 'every trial must be evaluated on every block' };

  // All ways of splitting S blocks into equal halves, capped so the count stays
  // tractable; the cap is reported rather than silently applied.
  const half = S / 2;
  const combos = [];
  const idx = [...Array(S).keys()];
  const maxCombos = opts.maxCombos || 500;
  (function build(start, chosen) {
    if (combos.length >= maxCombos) return;
    if (chosen.length === half) { combos.push([...chosen]); return; }
    for (let i = start; i < S; i++) { chosen.push(idx[i]); build(i + 1, chosen); chosen.pop(); if (combos.length >= maxCombos) return; }
  })(0, []);

  let logitsBelow = 0;
  const ranks = [];
  for (const isBlocks of combos) {
    const oosBlocks = idx.filter(i => !isBlocks.includes(i));
    const isPerf = M.map(row => mean(isBlocks.map(b => row[b])));
    const best = isPerf.indexOf(Math.max(...isPerf));
    const oosPerf = M.map(row => mean(oosBlocks.map(b => row[b])));
    const sorted = [...oosPerf].sort((a, b) => a - b);
    const rank = sorted.indexOf(oosPerf[best]) / (sorted.length - 1);
    ranks.push(rank);
    if (rank < 0.5) logitsBelow++;
  }

  const p = logitsBelow / combos.length;
  return {
    ok: true,
    pbo: r3(p),
    splits: combos.length,
    cappedAt: combos.length >= maxCombos ? maxCombos : null,
    medianOosRankOfIsBest: r3(mean(ranks)),
    verdict: p <= 0.2 ? 'ACCEPTABLE' : p <= 0.5 ? 'HIGH' : 'SEVERE',
    plainly: p >= 0.5
      ? `The in-sample best lands below the out-of-sample median ${(p * 100).toFixed(0)}% of the time — the selection is worse than a coin flip.`
      : `The in-sample best lands below the out-of-sample median ${(p * 100).toFixed(0)}% of the time.`,
  };
}

/**
 * Random-entry null.
 *
 * @param strategyMetric  the strategy's realised metric
 * @param sampler()       returns one random-entry metric with the SAME holding
 *                        period, sizing and costs — supplied by the caller,
 *                        because only the caller knows the cost model
 * @param runs            how many draws
 *
 * Returns the percentile of the strategy within the null distribution. A
 * strategy inside the bulk of it has demonstrated nothing.
 */
function randomEntryNull({ strategyMetric, sampler, runs = 1000, seed = 42 }) {
  const m = num(strategyMetric);
  if (m === null) return { ok: false, why: 'strategyMetric is not a number' };
  if (typeof sampler !== 'function') return { ok: false, why: 'no sampler supplied — the null must use the caller\'s cost model, not an assumed one' };

  const draws = [];
  for (let i = 0; i < runs; i++) {
    const v = num(sampler(i, seed));
    if (v !== null) draws.push(v);
  }
  if (draws.length < 30) return { ok: false, why: `only ${draws.length} usable draws — too few to place a result against` };

  const sorted = [...draws].sort((a, b) => a - b);
  const below = sorted.filter(v => v < m).length;
  const pct = below / sorted.length * 100;
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

  return {
    ok: true,
    strategyMetric: r3(m),
    draws: sorted.length,
    percentile: r3(pct, 2),
    nullMean: r3(mean(draws)), nullStdev: r3(stdev(draws)),
    null5th: r3(q(0.05)), nullMedian: r3(q(0.5)), null95th: r3(q(0.95)), nullMax: r3(sorted[sorted.length - 1]),
    verdict: pct >= 99 ? 'OUTSIDE' : pct >= 95 ? 'MARGINAL' : 'INSIDE',
    plainly: pct < 95
      ? `The strategy sits at the ${pct.toFixed(1)}th percentile of random entries with the same holding period and costs. It has not demonstrated anything.`
      : `The strategy sits at the ${pct.toFixed(1)}th percentile of ${sorted.length} random-entry draws.`,
  };
}

/**
 * Shuffled-label test.
 *
 * @param realMetric      performance with true labels
 * @param shuffledRun(i)  re-runs with labels shuffled, returns the metric
 * @param chanceLevel     what "chance" means for this metric (e.g. 0.5 for accuracy)
 *
 * If shuffled performance does NOT collapse to chance, there is leakage — and
 * this function returns `halt: true`, because continuing to validate a leaking
 * pipeline produces confident nonsense.
 */
function shuffledLabels({ realMetric, shuffledRun, runs = 20, chanceLevel, tolerance = 0.05 }) {
  const real = num(realMetric), chance = num(chanceLevel);
  if (real === null || chance === null) return { ok: false, why: 'realMetric and chanceLevel are both required' };
  if (typeof shuffledRun !== 'function') return { ok: false, why: 'no shuffledRun supplied' };

  const vals = [];
  for (let i = 0; i < runs; i++) { const v = num(shuffledRun(i)); if (v !== null) vals.push(v); }
  if (vals.length < 5) return { ok: false, why: `only ${vals.length} shuffled runs completed — too few to judge` };

  const m = mean(vals);
  const collapsed = Math.abs(m - chance) <= tolerance;

  return {
    ok: true,
    realMetric: r3(real),
    shuffledMean: r3(m), shuffledStdev: r3(stdev(vals)), runs: vals.length,
    chanceLevel: r3(chance), tolerance,
    collapsedToChance: collapsed,
    // The halt is the point. A leaking pipeline validated further produces
    // numbers that are confident and meaningless.
    halt: !collapsed,
    verdict: collapsed ? 'PASS' : 'LEAKAGE',
    plainly: collapsed
      ? `Shuffled labels collapse to ${r3(m)} against a chance level of ${r3(chance)} — no leakage detected by this test.`
      : `Shuffled labels still score ${r3(m)} against a chance level of ${r3(chance)}. There is leakage. ` +
        `The harness HALTS: every downstream number would be about the leak, not the strategy.`,
  };
}

module.exports = { sharpe, deflatedSharpe, pbo, randomEntryNull, shuffledLabels, normCdf, normInv, mean, stdev, skewKurt };
