/* ═══════════════════════════════════════════════════════════════════════════
   validation-ledger — what has been tried, what has been spent, and what can
   be reproduced.

   THREE RECORDS, AND THE FIRST TWO ARE THE ONES NOBODY KEEPS

   1. THE TRIAL COUNTER. Every parameter set, variant and idea tested against
      the same data — INCLUDING the ones that were discarded. Discarded trials
      are the whole point: if 200 were run and the best kept, the best one's
      Sharpe is close to meaningless, and the only way to say so is to have
      counted the 199.

      Measured on this repository, 2026-07-30: **no trial count is recorded
      anywhere.** 17 backtest scripts and 15 result files exist, and not one of
      them records how many variants were run to produce it. So for every
      existing strategy the true trial count is UNKNOWN — and a deflated Sharpe
      computed from an unknown trial count is not a deflated Sharpe.

      What this module does instead is derive a FLOOR from the artefacts that
      genuinely are parameter sweeps, and label it a floor. A floor is honest and
      useful: a result that fails deflation even at the most generous possible
      trial count has failed.

   2. THE OUT-OF-SAMPLE BUDGET. Out-of-sample data is spent when it is used.
      Evaluating against the same period twenty times turns it into in-sample,
      silently, and nothing in a normal backtest pipeline notices. This ledger
      counts evaluations per period and surfaces the count beside every result.

   3. THE RUN RECORD. Code hash, config hash, data snapshot IDs, cost model
      version, seeds, metrics. Re-running a run ID must produce identical
      numbers. A result that cannot be reproduced is not a result.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeJsonSync, readJsonSync } = require('./safe-write');

const DIR = path.join(__dirname, 'data');
const TRIALS = path.join(DIR, 'validation-trials.json');
const BUDGET = path.join(DIR, 'validation-oos-budget.json');
const RUNS = path.join(DIR, 'validation-runs.json');

const sha = (v) => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex').slice(0, 16);

function load(file, fallback) {
  try { const j = readJsonSync(file, { fallback }); return j === undefined ? fallback : j; }
  catch (e) { console.error(`[validation-ledger] ${path.basename(file)} unreadable: ${e.message}`); return fallback; }
}
function save(file, v) {
  try { fs.mkdirSync(DIR, { recursive: true }); writeJsonSync(file, v); }
  catch (e) { console.error(`[validation-ledger] could not persist ${path.basename(file)}: ${e.message}`); }
}

class ValidationLedger {
  constructor(deps = {}) {
    this.now = deps.now || (() => Date.now());
    this.log = deps.log || console;
    this.files = deps.files || { trials: TRIALS, budget: BUDGET, runs: RUNS };
  }

  /* ── 1. trials ────────────────────────────────────────────────────────── */

  /**
   * Record a trial. Called for EVERY variant evaluated, including failures.
   *
   * The signature is hashed so the same parameter set counted twice is counted
   * once — otherwise re-running a sweep would inflate the count and over-deflate
   * the Sharpe, which errs in the safe direction but is still wrong.
   */
  recordTrial({ family, params, note = null, outcome = null }) {
    const all = load(this.files.trials, {});
    const fam = all[family] || { family, trials: [], firstAt: new Date(this.now()).toISOString() };
    const sig = sha({ family, params });
    if (!fam.trials.some(t => t.sig === sig)) {
      fam.trials.push({ sig, at: new Date(this.now()).toISOString(), params, note, outcome });
    }
    fam.lastAt = new Date(this.now()).toISOString();
    all[family] = fam;
    save(this.files.trials, all);
    return { family, count: fam.trials.length };
  }

  /**
   * The trial count for a family.
   *
   * `source` is always stated:
   *   'recorded' — every trial was logged as it ran; the count is exact
   *   'floor'    — reconstructed from artefacts; the TRUE count is at least this
   *   'unknown'  — nothing to go on
   *
   * A caller must not treat a floor as an exact count, and `deflatedSharpe`
   * refuses to present a headline number when the source is 'unknown'.
   */
  trialCount(family) {
    const all = load(this.files.trials, {});
    const fam = all[family];
    if (fam && fam.trials.length) {
      return { count: fam.trials.length, source: 'recorded', exact: true, family };
    }
    return {
      count: null, source: 'unknown', exact: false, family,
      why: 'no trials were recorded for this family. A deflated Sharpe cannot be computed from an unknown trial count',
    };
  }

  /**
   * Reconstruct a FLOOR on the trial count from artefacts on disk.
   *
   * Only counts things that are genuinely parameter sweeps or leaderboards. It
   * deliberately does NOT count trades: a result file with 1,200 trades in it is
   * one trial, not 1,200, and conflating them is exactly the error this harness
   * exists to catch.
   */
  inferTrialFloor(family, opts = {}) {
    const dir = opts.dir || path.join(__dirname, 'bt-data');
    const patterns = opts.patterns || [];
    let floor = 0;
    const evidence = [];
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.startsWith('result-') && f.endsWith('.json')); }
    catch (_) { return { count: null, source: 'unknown', why: `no artefact directory at ${dir}` }; }

    for (const f of files) {
      if (patterns.length && !patterns.some(p => f.includes(p))) continue;
      let j; try { j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { continue; }
      // Sweeps and leaderboards are trials. `trades` is not.
      for (const key of ['sweep', 'results', 'leaderboard', 'stress', 'variants', 'grid']) {
        if (Array.isArray(j[key]) && j[key].length) {
          floor += j[key].length;
          evidence.push(`${f}:${key}=${j[key].length}`);
        }
      }
    }
    // Each distinct backtest script is at least one idea tested against the same
    // data, whether or not its output survived.
    const scripts = opts.scripts ?? 0;
    if (scripts) { floor += scripts; evidence.push(`${scripts} backtest script(s) as distinct ideas`); }

    if (!floor) return { count: null, source: 'unknown', family, why: 'no sweep or leaderboard artefacts found' };
    return {
      count: floor, source: 'floor', exact: false, family, evidence,
      why: 'reconstructed from artefacts. The TRUE trial count is at least this and is almost certainly higher, ' +
           'because discarded runs leave no artefact at all',
    };
  }

  /* ── 2. the out-of-sample budget ──────────────────────────────────────── */

  /**
   * Charge an evaluation against a period. Returns the new count.
   *
   * The point of the count is that it is visible. A period evaluated against
   * fifteen times is not out-of-sample any more, whatever the pipeline calls it.
   */
  spendOos({ periodId, family, runId = null }) {
    const all = load(this.files.budget, {});
    const p = all[periodId] || { periodId, evaluations: 0, byFamily: {}, firstAt: new Date(this.now()).toISOString(), runs: [] };
    p.evaluations++;
    p.byFamily[family] = (p.byFamily[family] || 0) + 1;
    p.lastAt = new Date(this.now()).toISOString();
    if (runId) { p.runs.push(runId); if (p.runs.length > 200) p.runs.splice(0, p.runs.length - 200); }
    all[periodId] = p;
    save(this.files.budget, all);
    return { periodId, evaluations: p.evaluations, byFamily: { ...p.byFamily } };
  }

  /**
   * How spent is this period?
   *
   * The thresholds are judgement, and are labelled as such. What is NOT
   * judgement is that the count exists and is shown.
   */
  oosStatus(periodId, thresholds = {}) {
    const warn = thresholds.warn ?? 3;
    const spent = thresholds.spent ?? 10;
    const all = load(this.files.budget, {});
    const p = all[periodId];
    if (!p) return { periodId, evaluations: 0, status: 'FRESH', note: 'never evaluated against' };
    const status = p.evaluations >= spent ? 'SPENT' : p.evaluations >= warn ? 'DEGRADED' : 'FRESH';
    return {
      periodId, evaluations: p.evaluations, byFamily: { ...p.byFamily }, status,
      note: status === 'SPENT'
        ? `evaluated ${p.evaluations} times — this period is no longer out-of-sample in any meaningful sense`
        : status === 'DEGRADED'
          ? `evaluated ${p.evaluations} times — each additional evaluation makes it more in-sample`
          : 'still usable as out-of-sample',
      thresholdsAreJudgement: true,
    };
  }

  oosBudgetAll() { return load(this.files.budget, {}); }

  /* ── 3. run records ───────────────────────────────────────────────────── */

  /**
   * Record a validation run so it can be reproduced.
   *
   * `inputs` must include everything that could change the numbers. What is NOT
   * hashed here cannot be reproduced, so anything omitted is a silent hole in
   * the guarantee.
   */
  recordRun({ family, strategy, codeHash, configHash, dataSnapshots, costModelVersion, seeds, metrics, notes = null }) {
    const missing = [];
    if (!codeHash) missing.push('codeHash');
    if (!configHash) missing.push('configHash');
    if (!dataSnapshots || !Object.keys(dataSnapshots).length) missing.push('dataSnapshots');
    if (!costModelVersion) missing.push('costModelVersion');
    if (seeds === undefined || seeds === null) missing.push('seeds');

    const inputs = { family, strategy, codeHash, configHash, dataSnapshots, costModelVersion, seeds };
    const runId = sha(inputs);
    const all = load(this.files.runs, {});
    const prev = all[runId];

    const rec = {
      runId, at: new Date(this.now()).toISOString(),
      ...inputs, metrics, notes,
      // A run missing any input is recorded as NOT reproducible rather than
      // quietly stored as though it were.
      reproducible: missing.length === 0,
      missingInputs: missing,
    };

    /* If the same inputs produced different metrics, that is a reproducibility
       FAILURE and it is recorded as one — not overwritten, which would erase the
       evidence that the run is not deterministic. */
    if (prev && JSON.stringify(prev.metrics) !== JSON.stringify(metrics)) {
      rec.reproducible = false;
      rec.reproducibilityFailure = {
        detail: 'identical inputs produced different metrics — this run is not deterministic',
        previous: prev.metrics, now: metrics, previousAt: prev.at,
      };
      this.log.error(`[validation-ledger] REPRODUCIBILITY FAILURE on ${runId}: identical inputs, different metrics`);
    }

    all[runId] = rec;
    save(this.files.runs, all);
    return rec;
  }

  getRun(runId) { return load(this.files.runs, {})[runId] || null; }
  allRuns() { return load(this.files.runs, {}); }

  /** Hash a file's contents — used for the code hash. */
  static hashFile(p) {
    try { return sha(fs.readFileSync(p, 'utf8')); }
    catch (_) { return null; }   // null, not a fake hash: an unhashable file is unrecorded, not "hash 0"
  }
  static hash(v) { return sha(v); }
}

module.exports = { ValidationLedger, sha };
