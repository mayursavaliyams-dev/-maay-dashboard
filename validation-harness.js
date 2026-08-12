/* ═══════════════════════════════════════════════════════════════════════════
   validation-harness — the adversarial gate a strategy must survive.

   Its purpose is to try to prove a strategy is NOT real. A strategy that
   survives is a candidate. A strategy that has produced a good backtest is not.

   THE THREE OUTCOMES, AND THE THIRD IS THE IMPORTANT ONE

     PASS            every applicable test ran and the strategy survived
     FAIL            a test ran and the strategy did not survive
     CANNOT_VALIDATE a test could not run, because the evidence it needs does
                     not exist

   CANNOT_VALIDATE is not a pass. This matters more here than anywhere else in
   the system, because the evidence most often missing — the trial count — is
   missing precisely for the strategies with the most impressive backtests. A
   harness that reported "no failures" for a strategy it could not test would be
   the most dangerous artefact in this repository.

   THE PROMOTION GATE'S CRITERIA ARE DECLARED BEFORE THE TESTS RUN
   `declareCriteria()` must be called and its hash is stored with the result. A
   criterion added after seeing the numbers is not a criterion; it is a
   rationalisation, and the hash is what makes the difference visible.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const stats = require('./validation-stats');
const wf = require('./walk-forward');
const { ValidationLedger, sha } = require('./validation-ledger');

const num = (v) => (v === null || v === undefined || !isFinite(Number(v))) ? null : Number(v);
const r3 = (v, d = 4) => v === null || v === undefined ? null : +Number(v).toFixed(d);
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

/* The promotion criteria, declared up front. Changing any of these changes the
   hash, so a result carries proof of which bar it was measured against. */
const DEFAULT_CRITERIA = {
  version: 1,
  paper: {
    walkForwardRequired: true,
    minFolds: 4,
    minOosObservations: 100,
    deflatedSharpeRequired: true,
    minDeflatedSharpeProbability: 0.90,
    maxPbo: 0.5,
    maxParameterInstability: 0.5,
    randomEntryPercentileMin: 95,
    shuffledLabelsMustCollapse: true,
    maxFragility: 0.5,
  },
  live: {
    minPaperTradingDays: 60,
    minPaperTrades: 30,
    paperVsBacktestDivergenceRequired: true,
    maxPaperVsBacktestSharpeGap: 0.5,
    allPaperCriteriaStillMet: true,
  },
};

class ValidationHarness {
  constructor(deps = {}) {
    this.ledger = deps.ledger || new ValidationLedger();
    this.log = deps.log || console;
    this.now = deps.now || (() => Date.now());
    this.criteria = null;
    this.criteriaHash = null;
  }

  /** Must be called BEFORE any test runs. */
  declareCriteria(criteria = DEFAULT_CRITERIA) {
    this.criteria = JSON.parse(JSON.stringify(criteria));
    this.criteriaHash = sha(this.criteria);
    this.declaredAt = new Date(this.now()).toISOString();
    return { criteriaHash: this.criteriaHash, declaredAt: this.declaredAt };
  }

  /* ── slicing ──────────────────────────────────────────────────────────── */

  /**
   * Slice performance by year, regime and underlying.
   *
   * @param trades  [{ year, regime, underlying, ret }] — one row per trade or period
   *
   * WHY THIS IS A FRAGILITY TEST AND NOT A BREAKDOWN TABLE
   *
   * The cost and timing perturbations ask "does the edge survive being taxed?".
   * Slicing asks a different and often more damning question: "does the edge
   * exist everywhere, or did one year carry it?"
   *
   * A strategy whose entire profit came from 2024 and lost money in the other
   * three years survives every cost multiplier — the average is still positive —
   * and is not a strategy. Concentration is invisible to every other test in
   * this battery, which is why it belongs in the fragility score rather than in
   * an appendix.
   *
   * The measure is the share of slices that are profitable, plus the share of
   * total profit taken by the single best slice. A strategy where one slice
   * carries most of the profit is flagged whatever its headline says.
   */
  sliceBy(trades) {
    const rows = (trades || []).filter(t => t && num(t.ret) !== null);
    if (rows.length < 2) return { ok: false, why: `need at least 2 tagged rows, got ${rows.length}` };

    const dims = {};
    for (const dim of ['year', 'regime', 'underlying']) {
      const present = rows.filter(r => r[dim] !== undefined && r[dim] !== null);
      if (!present.length) {
        // Stated, not skipped. A dimension nobody tagged is a dimension nobody
        // checked, and that is different from one that passed.
        dims[dim] = { ok: false, why: `no row carries a "${dim}" tag — this dimension was NOT checked` };
        continue;
      }
      const buckets = {};
      for (const r of present) {
        const k = String(r[dim]);
        (buckets[k] = buckets[k] || []).push(num(r.ret));
      }
      const slices = Object.entries(buckets).map(([k, v]) => ({
        slice: k, n: v.length,
        total: r3(v.reduce((a, b) => a + b, 0)),
        mean: r3(mean(v)),
        profitable: v.reduce((a, b) => a + b, 0) > 0,
      })).sort((a, b) => b.total - a.total);

      const totalProfit = slices.reduce((s, x) => s + Math.max(0, x.total), 0);
      const best = slices[0];
      const profitableShare = slices.filter(s => s.profitable).length / slices.length;
      const bestShare = totalProfit > 0 ? best.total / totalProfit : null;

      /* The concentration threshold SCALES with the number of slices, because a
         fixed one is wrong at both ends. Across 2 underlyings an even split is
         50%, so 60% is barely uneven; across 10 years an even split is 10%, so
         60% is one year carrying almost everything.

             threshold = 0.5 + 0.5 / count

           2 slices → 0.75    a 2:1 split passes, a 9:1 split does not
           4 slices → 0.625   one year carrying the profit is caught
          10 slices → 0.55    a single slice at 60% is caught

         A fixed 60% flagged a perfectly ordinary 2:1 underlying split as
         concentrated, which is how a fragility test loses its credibility. */
      const threshold = 0.5 + 0.5 / slices.length;

      dims[dim] = {
        ok: true, slices, count: slices.length,
        profitableShare: r3(profitableShare),
        concentrationInBestSlice: r3(bestShare),
        concentrationThreshold: r3(threshold),
        /* Two independent ways of being concentrated, and either is enough:
           most slices losing, or one slice carrying more than its scaled share. */
        concentrated: profitableShare < 0.6 || (bestShare !== null && bestShare > threshold),
        plainly: bestShare !== null && bestShare > threshold
          ? `${best.slice} carries ${(bestShare * 100).toFixed(0)}% of the profit across ${slices.length} ${dim}s — the edge is concentrated, not general`
          : profitableShare < 0.6
            ? `only ${(profitableShare * 100).toFixed(0)}% of ${dim}s were profitable — the edge does not hold across ${dim}`
            : `the edge holds across ${slices.length} ${dim}s (${(profitableShare * 100).toFixed(0)}% profitable, best takes ${bestShare === null ? '—' : (bestShare * 100).toFixed(0) + '%'})`,
      };
    }

    const checked = Object.values(dims).filter(d => d.ok);
    const concentrated = checked.filter(d => d.concentrated);
    return {
      ok: true, dimensions: dims,
      dimensionsChecked: checked.length,
      dimensionsNotTagged: 3 - checked.length,
      concentrationFailures: concentrated.length,
      // Folded into the fragility score by robustness() below.
      sliceFragility: checked.length ? r3(concentrated.length / checked.length) : null,
      plainly: concentrated.length
        ? `Concentrated on ${concentrated.length} of ${checked.length} dimension(s): ` +
          Object.entries(dims).filter(([, d]) => d.ok && d.concentrated).map(([k, d]) => `${k} — ${d.plainly}`).join(' · ')
        : checked.length
          ? `The edge holds across all ${checked.length} checked dimension(s).`
          : 'No dimension was tagged — slicing could not be checked at all.',
    };
  }

  /* ── the robustness battery ───────────────────────────────────────────── */

  /**
   * Run the strategy under systematic perturbation.
   *
   * @param run({ costMultiplier, slippageMultiplier, timingShiftMin, paramScale })
   *        → { sharpe, pnl, ... } — supplied by the caller
   * @param baseParams  for the ±10/20% parameter sweep
   *
   * Returns per-scenario results AND a single fragility score, because a table
   * of forty rows is a table nobody reads.
   */
  robustness({ run, baseParams = {}, slices = null, trades = null }) {
    if (typeof run !== 'function') return { ok: false, why: 'no run function supplied' };

    const scenarios = [];
    const push = (name, group, cfg) => {
      let r = null, error = null;
      try { r = run(cfg); } catch (e) { error = e.message; }
      const s = num(r && r.sharpe);
      scenarios.push({ name, group, config: cfg, sharpe: r3(s), pnl: r3(num(r && r.pnl)), error, ran: !error && s !== null });
    };

    push('baseline', 'baseline', { costMultiplier: 1, slippageMultiplier: 1, timingShiftMin: 0, paramScale: 1 });
    for (const m of [1.5, 2]) push(`costs ×${m}`, 'costs', { costMultiplier: m, slippageMultiplier: 1, timingShiftMin: 0, paramScale: 1 });
    push('slippage ×2', 'slippage', { costMultiplier: 1, slippageMultiplier: 2, timingShiftMin: 0, paramScale: 1 });
    for (const t of [-5, -2, 2, 5]) push(`timing ${t > 0 ? '+' : ''}${t} min`, 'timing', { costMultiplier: 1, slippageMultiplier: 1, timingShiftMin: t, paramScale: 1 });
    for (const p of [0.8, 0.9, 1.1, 1.2]) push(`params ×${p}`, 'params', { costMultiplier: 1, slippageMultiplier: 1, timingShiftMin: 0, paramScale: p, baseParams });

    const base = scenarios.find(s => s.name === 'baseline');
    if (!base || !base.ran) {
      return { ok: false, why: `the baseline scenario itself did not run (${base ? base.error : 'missing'}) — nothing can be compared against it` };
    }

    const ran = scenarios.filter(s => s.ran && s.name !== 'baseline');
    const failed = scenarios.filter(s => !s.ran);
    /* An edge that survives every perturbation is not fragile. An edge that
       disappears under ANY of them is, and the worst case is what matters —
       averaging the scenarios would let three good ones hide one catastrophic
       one, which is the specific failure a fragility summary exists to expose. */
    const drops = ran.map(s => ({
      name: s.name, group: s.group,
      dropPct: base.sharpe > 0 ? r3((base.sharpe - s.sharpe) / base.sharpe * 100, 1) : null,
      sharpe: s.sharpe,
      survives: s.sharpe > 0 && (base.sharpe <= 0 || s.sharpe >= base.sharpe * 0.5),
    }));
    const worst = drops.filter(d => d.dropPct !== null).sort((a, b) => b.dropPct - a.dropPct)[0] || null;
    const collapses = drops.filter(d => !d.survives);
    const fragility = ran.length ? r3(collapses.length / ran.length) : null;

    const byGroup = {};
    for (const d of drops) {
      byGroup[d.group] = byGroup[d.group] || { scenarios: 0, collapses: 0, worstDropPct: null };
      byGroup[d.group].scenarios++;
      if (!d.survives) byGroup[d.group].collapses++;
      if (d.dropPct !== null && (byGroup[d.group].worstDropPct === null || d.dropPct > byGroup[d.group].worstDropPct)) {
        byGroup[d.group].worstDropPct = d.dropPct;
      }
    }

    /* Slicing by year, regime and underlying, run automatically as the
       requirement asks — and FOLDED INTO the fragility score rather than left as
       a separate table. A strategy whose whole profit came from one year
       survives every cost multiplier, because the average is still positive.
       Concentration is invisible to every other scenario above, so if it does
       not enter the single summary number it will not be acted on. */
    const sliced = trades ? this.sliceBy(trades) : { ok: false, why: 'no tagged trades supplied — slicing by year, regime and underlying was NOT checked' };
    const combined = (fragility !== null && sliced.ok && sliced.sliceFragility !== null)
      ? r3(Math.max(fragility, sliced.sliceFragility))   // the WORST of the two, not the average
      : fragility;

    return {
      ok: true,
      baseline: base.sharpe,
      scenarios: drops,
      byGroup,
      slicing: sliced,
      slices: slices || null,
      scenariosThatFailedToRun: failed.map(f => ({ name: f.name, error: f.error })),
      perturbationFragility: fragility,
      sliceFragility: sliced.ok ? sliced.sliceFragility : null,
      fragility: combined,
      fragilityBasis: sliced.ok
        ? 'the WORSE of perturbation fragility and slice concentration — averaging them would let a robust cost profile hide a one-year edge'
        : 'perturbations only; slicing was not checked because no tagged trades were supplied',
      worstScenario: worst,
      verdict: combined === null ? 'UNKNOWN' : combined >= 0.5 ? 'FRAGILE' : combined >= 0.2 ? 'SENSITIVE' : 'ROBUST',
      plainly: [
        collapses.length
          ? `The edge collapses under ${collapses.length} of ${ran.length} perturbations. Worst: ${worst ? `${worst.name} costs ${worst.dropPct}% of the Sharpe` : 'unknown'}.`
          : `The edge survives all ${ran.length} perturbations. Worst case: ${worst ? `${worst.name}, −${worst.dropPct}%` : 'n/a'}.`,
        sliced.ok ? sliced.plainly : sliced.why,
      ].join(' '),
    };
  }

  /* ── the full run ─────────────────────────────────────────────────────── */

  /**
   * Validate one strategy.
   *
   * Anything the caller cannot supply is reported as CANNOT_VALIDATE with the
   * missing evidence named. Nothing is assumed and nothing is skipped quietly.
   */
  validate(spec) {
    if (!this.criteria) {
      return { ok: false, why: 'criteria were not declared before the run. A criterion chosen after seeing the numbers is a rationalisation' };
    }
    const { family, strategy } = spec;
    const tests = [];
    const add = (name, status, detail, data = null) => tests.push({ name, status, detail, data });

    // ── 1. walk-forward ─────────────────────────────────────────────────
    let oosReturns = null, wfResult = null;
    if (spec.walkForward) {
      wfResult = wf.walkForward(spec.walkForward);
      if (!wfResult.ok) {
        add('walkForward', wfResult.leakage ? 'FAIL' : 'CANNOT_VALIDATE', wfResult.why, wfResult);
      } else {
        oosReturns = wfResult.headline.returns;
        const enough = wfResult.foldCount >= this.criteria.paper.minFolds &&
          oosReturns.length >= this.criteria.paper.minOosObservations;
        add('walkForward', enough ? 'PASS' : 'FAIL',
          `${wfResult.foldCount} folds, ${oosReturns.length} out-of-sample observations ` +
          `(need ${this.criteria.paper.minFolds} folds, ${this.criteria.paper.minOosObservations} observations)`,
          { headline: wfResult.headline, diagnosticOnly: wfResult.diagnosticOnly });

        const st = wfResult.parameterStability;
        add('parameterStability', !st.ok ? 'CANNOT_VALIDATE'
          : st.overallInstability <= this.criteria.paper.maxParameterInstability ? 'PASS' : 'FAIL',
          st.ok ? st.plainly : st.why, st);
      }
    } else {
      add('walkForward', 'CANNOT_VALIDATE',
        'no walk-forward specification supplied. A single-period backtest is not a substitute and is not accepted as one');
    }

    // ── 2. deflated Sharpe, which needs the trial count ─────────────────
    let observed = num(spec.observedSharpe);
    if (observed === null && oosReturns && oosReturns.length > 1) {
      const s = stats.sharpe(oosReturns, spec.periodsPerYear || 252);
      if (s.ok) observed = s.sharpe;
    }
    const trials = spec.trials || this.ledger.trialCount(family);
    if (observed === null) {
      add('deflatedSharpe', 'CANNOT_VALIDATE', 'no out-of-sample Sharpe could be computed');
    } else if (!trials || trials.count === null) {
      add('deflatedSharpe', 'CANNOT_VALIDATE',
        `the trial count for "${family}" is UNKNOWN. ${trials && trials.why ? trials.why : ''} ` +
        'Without it the deflated Sharpe cannot be computed, and computing it as though one variant had been tried ' +
        'would present the original number as though it had been checked', { observed, trials });
    } else {
      const sk = oosReturns ? stats.skewKurt(oosReturns) : { skew: 0, kurt: 3 };
      const d = stats.deflatedSharpe({
        observedSharpe: observed, trials: trials.count,
        n: oosReturns ? oosReturns.length : num(spec.n), skew: sk.skew, kurt: sk.kurt,
        periodsPerYear: spec.periodsPerYear || 252,
      });
      add('deflatedSharpe', !d.ok ? 'CANNOT_VALIDATE'
        : d.deflatedSharpeProbability >= this.criteria.paper.minDeflatedSharpeProbability ? 'PASS' : 'FAIL',
        d.ok ? `${d.plainly} (trial count source: ${trials.source})` : d.why,
        { ...d, trialSource: trials.source, trialsExact: trials.exact });
    }

    // ── 3. probability of backtest overfitting ──────────────────────────
    if (spec.pboMatrix) {
      const p = stats.pbo(spec.pboMatrix);
      add('pbo', !p.ok ? 'CANNOT_VALIDATE' : p.pbo <= this.criteria.paper.maxPbo ? 'PASS' : 'FAIL',
        p.ok ? p.plainly : p.why, p);
    } else {
      add('pbo', 'CANNOT_VALIDATE', 'no per-trial per-block performance matrix supplied — PBO needs every trial evaluated on every block');
    }

    // ── 4. robustness ───────────────────────────────────────────────────
    if (spec.robustness) {
      const rb = this.robustness(spec.robustness);
      add('robustness', !rb.ok ? 'CANNOT_VALIDATE'
        : rb.fragility <= this.criteria.paper.maxFragility ? 'PASS' : 'FAIL',
        rb.ok ? rb.plainly : rb.why, rb);
    } else {
      add('robustness', 'CANNOT_VALIDATE', 'no run function supplied for the sensitivity battery');
    }

    // ── 5. null tests ───────────────────────────────────────────────────
    let halted = false;
    if (spec.shuffledLabels) {
      const sl = stats.shuffledLabels(spec.shuffledLabels);
      add('shuffledLabels', !sl.ok ? 'CANNOT_VALIDATE' : sl.collapsedToChance ? 'PASS' : 'FAIL',
        sl.ok ? sl.plainly : sl.why, sl);
      if (sl.ok && sl.halt) halted = true;
    } else {
      add('shuffledLabels', 'CANNOT_VALIDATE', 'no shuffled-label runner supplied. For a non-ML strategy this test does not apply, and that is stated rather than counted as a pass');
    }

    if (spec.randomEntry) {
      const re = stats.randomEntryNull(spec.randomEntry);
      add('randomEntryNull', !re.ok ? 'CANNOT_VALIDATE'
        : re.percentile >= this.criteria.paper.randomEntryPercentileMin ? 'PASS' : 'FAIL',
        re.ok ? re.plainly : re.why, re);
    } else {
      add('randomEntryNull', 'CANNOT_VALIDATE', 'no random-entry sampler supplied — the null must use the caller\'s own cost model');
    }

    // ── 6. out-of-sample budget ─────────────────────────────────────────
    const budget = (spec.oosPeriods || []).map(p => this.ledger.oosStatus(p));
    const spent = budget.filter(b => b.status === 'SPENT');
    if (budget.length) {
      add('oosBudget', spent.length ? 'FAIL' : 'PASS',
        spent.length
          ? `${spent.length} of ${budget.length} evaluation periods are SPENT: ${spent.map(s => `${s.periodId} (${s.evaluations}×)`).join(', ')}. ` +
            'Repeated evaluation turns out-of-sample data into in-sample data'
          : `${budget.length} period(s), most-used evaluated ${Math.max(...budget.map(b => b.evaluations))}×`,
        budget);
    } else {
      add('oosBudget', 'CANNOT_VALIDATE', 'no evaluation periods declared — the out-of-sample spend cannot be tracked');
    }

    // ── verdict ─────────────────────────────────────────────────────────
    const fails = tests.filter(t => t.status === 'FAIL');
    const cannot = tests.filter(t => t.status === 'CANNOT_VALIDATE');
    const passes = tests.filter(t => t.status === 'PASS');

    const verdict = halted ? 'HALTED'
      : fails.length ? 'FAIL'
      : cannot.length ? 'CANNOT_VALIDATE'
      : 'PASS';

    const result = {
      family, strategy,
      criteriaHash: this.criteriaHash, criteriaDeclaredAt: this.declaredAt,
      at: new Date(this.now()).toISOString(),
      verdict,
      counts: { pass: passes.length, fail: fails.length, cannotValidate: cannot.length },
      tests,
      halted,
      /* Said in words, because a verdict enum invites being read as a score. */
      plainly: halted
        ? 'HALTED: the shuffled-label test did not collapse to chance. There is leakage, and every other number here would be about the leak.'
        : fails.length
          ? `FAILS ${fails.length} test(s): ${fails.map(f => f.name).join(', ')}.`
          : cannot.length
            ? `CANNOT BE VALIDATED. ${cannot.length} test(s) could not run: ${cannot.map(c => c.name).join(', ')}. ` +
              'This is NOT a pass — the evidence required to judge this strategy does not exist.'
            : 'Survives every applicable test. A candidate, not a proven edge.',
    };
    return result;
  }

  /* ── the promotion gate ───────────────────────────────────────────────── */

  /**
   * May this strategy be promoted?
   *
   * @param stage    'PAPER' | 'LIVE'
   * @param result   the output of validate()
   * @param evidence for LIVE: { paperDays, paperTrades, paperSharpe, backtestSharpe }
   */
  promote({ stage, result, evidence = {} }) {
    if (!this.criteria) return { allowed: false, reason: 'NO_CRITERIA', detail: 'criteria were never declared' };
    if (result.criteriaHash !== this.criteriaHash) {
      return {
        allowed: false, reason: 'CRITERIA_CHANGED',
        detail: `this result was measured against criteria ${result.criteriaHash}, the gate now holds ${this.criteriaHash}. ` +
                'Re-run against the current bar rather than comparing across two different ones',
      };
    }

    const blocks = [];
    if (result.verdict === 'HALTED') blocks.push('the run halted on leakage');
    if (result.verdict === 'FAIL') blocks.push(`failed: ${result.tests.filter(t => t.status === 'FAIL').map(t => t.name).join(', ')}`);
    if (result.verdict === 'CANNOT_VALIDATE') {
      blocks.push(`could not be validated: ${result.tests.filter(t => t.status === 'CANNOT_VALIDATE').map(t => t.name).join(', ')} — this is not a pass`);
    }

    if (stage === 'LIVE') {
      const c = this.criteria.live;
      const days = num(evidence.paperDays), trades = num(evidence.paperTrades);
      if (days === null || days < c.minPaperTradingDays) blocks.push(`paper trading ${days ?? 'unknown'} days, need ${c.minPaperTradingDays}`);
      if (trades === null || trades < c.minPaperTrades) blocks.push(`paper trades ${trades ?? 'unknown'}, need ${c.minPaperTrades}`);
      const ps = num(evidence.paperSharpe), bs = num(evidence.backtestSharpe);
      if (c.paperVsBacktestDivergenceRequired) {
        if (ps === null || bs === null) blocks.push('no paper-versus-backtest divergence report');
        else if (Math.abs(bs - ps) > c.maxPaperVsBacktestSharpeGap) {
          blocks.push(`paper Sharpe ${r3(ps)} against backtest ${r3(bs)} — a gap of ${r3(Math.abs(bs - ps))}, over the ${c.maxPaperVsBacktestSharpeGap} limit`);
        }
      }
    }

    return {
      allowed: blocks.length === 0, stage,
      reason: blocks.length ? 'CRITERIA_NOT_MET' : 'OK',
      blocks,
      criteriaHash: this.criteriaHash,
      detail: blocks.length ? blocks.join(' · ') : `meets every declared ${stage} criterion`,
    };
  }

  /**
   * Override a promotion block. Requires a named human and a written reason,
   * both recorded. There is no unsigned path.
   */
  override({ stage, family, by, reason, blocks }) {
    if (!by || !String(by).trim()) return { ok: false, error: 'an override requires a named human' };
    if (!reason || String(reason).trim().length < 20) {
      return { ok: false, error: 'an override requires a written reason of at least 20 characters — "approved" is not a reason' };
    }
    const rec = {
      at: new Date(this.now()).toISOString(), stage, family, by,
      reason: String(reason), overrode: blocks || [],
      criteriaHash: this.criteriaHash,
      signature: sha({ stage, family, by, reason, blocks, criteriaHash: this.criteriaHash }),
    };
    this.log.error(`[validation] PROMOTION OVERRIDE by ${by} for ${family} → ${stage}: ${reason}`);
    return { ok: true, ...rec };
  }
}

module.exports = { ValidationHarness, DEFAULT_CRITERIA };
