// ============================================================================
//  signal-health.js — Signal-Engine Roadmap · Phase 5 (forward-test + self-learn)
//
//  A signal engine that never checks itself is just a story. This module closes the
//  loop: every planned trade's realized paper outcome is logged, fed back into the
//  Phase-3 calibrator, and watched for CALIBRATION DRIFT (is "70%" still ~70% this
//  month?) and EDGE DECAY (is the recent win-rate / expectancy sliding?).
//
//  When drift crosses a threshold it emits a DEGRADED health status so the dashboard
//  can honestly say "the model's confidence is currently miscalibrated — stand down"
//  instead of pretending. Persists to data/signal-outcomes.json.
//
//  Depends only on meta-label.js (calibrator) + fs. Pure logic is unit-tested; the
//  fs persistence is a thin, optional wrapper (skipped when no path given).
// ============================================================================
'use strict';
const M = require('./meta-label');
const round = (v, d = 4) => +(+v).toFixed(d);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * In-memory tracker. Holds a rolling window of realized outcomes + a live calibrator.
 * @param {object} opts { window=200, driftBrier=0.28, minSamples=30 }
 */
function newTracker(opts = {}) {
  return {
    window: opts.window || 200,
    driftBrier: opts.driftBrier || 0.28,        // Brier above this (over minSamples) = degraded
    minSamples: opts.minSamples || 30,
    outcomes: [],                                // {t, inst, structure, rawP, prob, won, pnl}
    cal: M.newCalibrator(),
  };
}

/** Log a realized outcome and fold it into the calibrator. `rec` fields below. */
function logOutcome(tk, rec = {}) {
  const o = {
    t: Number(rec.t) || 0, inst: rec.inst || null, structure: rec.structure || null,
    rawP: rec.rawP != null ? Number(rec.rawP) : (Number(rec.prob) || 0.5),
    prob: rec.prob != null ? Number(rec.prob) : null,
    won: !!rec.won, pnl: Number(rec.pnl) || 0,
  };
  tk.outcomes.push(o);
  if (tk.outcomes.length > tk.window) tk.outcomes.shift();
  M.recordOutcome(tk.cal, o.rawP, o.won);
  return o;
}

/** Recent performance over the rolling window. */
function recentStats(tk) {
  const o = tk.outcomes;
  const n = o.length;
  if (!n) return { n: 0, winRate: null, expectancy: null, avgPnl: null, totalPnl: 0 };
  const wins = o.filter(x => x.won).length;
  const totalPnl = o.reduce((s, x) => s + x.pnl, 0);
  const winsPnl = o.filter(x => x.won).map(x => x.pnl);
  const lossPnl = o.filter(x => !x.won).map(x => x.pnl);
  const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
  const p = wins / n, avgWin = avg(winsPnl), avgLoss = Math.abs(avg(lossPnl));
  const expectancy = p * avgWin - (1 - p) * avgLoss;
  return { n, winRate: round(p, 3), expectancy: round(expectancy, 2), avgPnl: round(totalPnl / n, 2), totalPnl: round(totalPnl, 2) };
}

/**
 * Calibration-drift + edge-decay health verdict.
 * Compares the OLDER half vs the RECENT half of the window for win-rate decay,
 * and reads the calibrator's Brier/ECE for miscalibration.
 */
function assessHealth(tk) {
  const cal = M.health(tk.cal);
  const stats = recentStats(tk);
  const n = tk.outcomes.length;
  let status = 'LEARNING', reasons = [];

  if (n < tk.minSamples) {
    return { status: 'LEARNING', reasons: [`only ${n}/${tk.minSamples} samples — still gathering`], calibration: cal, recent: stats, drift: null };
  }

  // edge decay: recent-half win-rate vs older-half
  const half = Math.floor(n / 2);
  const older = tk.outcomes.slice(0, half), recent = tk.outcomes.slice(half);
  const wr = a => a.filter(x => x.won).length / a.length;
  const wrOld = wr(older), wrNew = wr(recent);
  const decay = round(wrNew - wrOld, 3);

  if (cal.brier != null && cal.brier > tk.driftBrier) { status = 'DEGRADED'; reasons.push(`Brier ${cal.brier} > ${tk.driftBrier} — probabilities miscalibrated`); }
  if (cal.ece != null && cal.ece > 0.15) { status = 'DEGRADED'; reasons.push(`ECE ${cal.ece} > 0.15 — confidence doesn't match outcomes`); }
  if (decay <= -0.15) { status = 'DEGRADED'; reasons.push(`win-rate decayed ${(decay * 100).toFixed(0)}% (recent vs older half) — edge fading`); }
  if (stats.expectancy != null && stats.expectancy < 0) { status = 'DEGRADED'; reasons.push(`negative expectancy ₹${stats.expectancy} — stop, re-validate`); }

  if (status === 'LEARNING') { status = 'HEALTHY'; reasons.push('calibration + edge within tolerance'); }

  return {
    status, reasons, calibration: cal, recent: stats,
    drift: { winRateOlder: round(wrOld, 3), winRateRecent: round(wrNew, 3), decay },
    advice: status === 'DEGRADED' ? 'Reduce or stand down — the model is out of calibration or the edge is decaying. Re-validate before sizing up.' : 'Continue paper forward-test; edge and calibration holding.',
  };
}

// ── optional fs persistence (thin wrapper) ──
function saveState(tk, fs, path) {
  try { fs.writeFileSync(path, JSON.stringify({ outcomes: tk.outcomes, window: tk.window, driftBrier: tk.driftBrier, minSamples: tk.minSamples }, null, 2)); return true; }
  catch (e) { return false; }
}
function loadState(fs, path, opts = {}) {
  const tk = newTracker(opts);
  try {
    const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
    if (raw && Array.isArray(raw.outcomes)) {
      if (raw.window) tk.window = raw.window;
      if (raw.driftBrier) tk.driftBrier = raw.driftBrier;
      if (raw.minSamples) tk.minSamples = raw.minSamples;
      for (const o of raw.outcomes.slice(-tk.window)) logOutcome(tk, o);
    }
  } catch (e) { /* fresh */ }
  return tk;
}

module.exports = { newTracker, logOutcome, recentStats, assessHealth, saveState, loadState };
