/**
 * CONFIRMED SIGNALS + ACCURACY TRACKER — Antigravity Pro
 *
 * The problem: single engines fire too many WRONG signals (our own backtest: a
 * lone directional call wins ~32%). The fix is CONFLUENCE — only surface a signal
 * when MULTIPLE independent engines agree, then TRACK its real accuracy so the user
 * trusts (and we tune) what's shown.
 *
 *   4 engines vote: Pattern · OI build-up · Early(H/L break) · ORB
 *   CONFIRMED only when ≥ minAgree agree on ONE direction AND no engine opposes.
 *   Every confirmed signal is recorded with a reference spot, then resolved after a
 *   horizon against the real index move → correct / wrong → rolling hit-rate.
 *
 * Pure agreement math is `agree()`. `ConfirmedTracker` persists to data/ and does
 * the record → resolve → accuracy loop (server feeds it live votes + spot).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, 'data', 'confirmed-signals.json');

const DIR = { BULLISH: 1, BEARISH: -1, NEUTRAL: 0 };
const sgn = v => (v > 0 ? 1 : v < 0 ? -1 : 0);
const dirWord = d => (d > 0 ? 'BULLISH' : d < 0 ? 'BEARISH' : 'NEUTRAL');

/**
 * votes = { pattern:'BULLISH'|'BEARISH'|'NEUTRAL', oi, early, orb }  (missing = NEUTRAL)
 * @returns { confirmed, direction, agreeN, bull, bear, engines, votes }
 */
function agree(votes = {}, opts = {}) {
  const minAgree = opts.minAgree != null ? opts.minAgree : 3;
  const keys = ['pattern', 'oi', 'early', 'orb'];
  let bull = 0, bear = 0; const engines = {};
  for (const k of keys) {
    const d = DIR[String(votes[k] || 'NEUTRAL').toUpperCase()] || 0;
    engines[k] = dirWord(d);
    if (d > 0) bull++; else if (d < 0) bear++;
  }
  const agreeN = Math.max(bull, bear);
  const oppose = Math.min(bull, bear);
  // CONFIRMED = strong one-sided agreement, NOTHING opposing (clean confluence)
  const confirmed = agreeN >= minAgree && oppose === 0;
  const direction = !confirmed ? 'NEUTRAL' : (bull > bear ? 'BULLISH' : 'BEARISH');
  return { confirmed, direction, agreeN, bull, bear, oppose, engines, votes };
}

// C3: missing → fallback; corrupt → recover from .bak; unrecoverable → THROW.
// Returning the fallback for a corrupt file is the read half of the data-loss chain.
function readJson(f, d) {
  return require('./safe-write.js').readJsonSync(f, {
    fallback: d,
    onRecover: (reason, bak) => console.warn(`[confirmed-signals] ${f} was corrupt (${reason}); recovered from ${bak}.`),
  });
}
function writeJson(f, o) {
  try { require('./safe-write.js').writeJsonSync(f, o, { pretty: 1, backup: true }); }
  catch (e) { console.error(`[confirmed-signals] write failed for ${f}: ${e.message}`); }
}

class ConfirmedTracker {
  constructor(opts = {}) {
    this.horizonMin = opts.horizonMin != null ? opts.horizonMin : 15;   // resolve after N min
    this.minMovePct = opts.minMovePct != null ? opts.minMovePct : 0.1;  // % move that counts as a hit
    const s = readJson(FILE, null) || {};
    this.pending = s.pending || [];      // [{id,inst,direction,refSpot,strike,at,agreeN,engines}]
    this.resolved = s.resolved || [];    // [{...,correct,exitSpot,movePct,resolvedAt}]
    this.seq = s.seq || 1;
  }
  _save() { writeJson(FILE, { pending: this.pending, resolved: this.resolved.slice(-1000), seq: this.seq }); }

  /** record a fresh confirmed signal (deduped while an open one exists for inst+direction). */
  record(sig) {
    if (!sig || !sig.confirmed) return null;
    const dup = this.pending.find(p => p.inst === sig.inst && p.direction === sig.direction);
    if (dup) return null;                                   // one open confirmed per inst+dir
    const rec = { id: this.seq++, inst: sig.inst, direction: sig.direction, refSpot: sig.spot,
      strike: sig.strike, optType: sig.direction === 'BULLISH' ? 'CE' : 'PE',
      agreeN: sig.agreeN, engines: sig.engines, at: sig.at != null ? sig.at : Date.now() };
    this.pending.push(rec); this._save();
    return rec;
  }

  /** resolve pendings older than the horizon using current spot per inst. spotByInst = {NIFTY:24000,...} */
  resolve(spotByInst = {}, nowMs) {
    const now = nowMs || Date.now();
    const still = [];
    for (const p of this.pending) {
      const spot = Number(spotByInst[p.inst]);
      if (!(now - p.at >= this.horizonMin * 60000) || !(spot > 0) || !(p.refSpot > 0)) { still.push(p); continue; }
      const movePct = +(((spot - p.refSpot) / p.refSpot) * 100).toFixed(3);
      const thr = this.minMovePct;
      const correct = p.direction === 'BULLISH' ? movePct >= thr : movePct <= -thr;
      const flat = Math.abs(movePct) < thr;
      this.resolved.push({ ...p, exitSpot: spot, movePct, correct, flat, resolvedAt: now });
    }
    this.pending = still; this._save();
  }

  accuracy() {
    const decided = this.resolved.filter(r => !r.flat);            // flats don't count for/against
    const per = {};
    for (const r of this.resolved) {
      const k = r.inst; (per[k] = per[k] || { n: 0, correct: 0, flat: 0 });
      per[k].n++; if (r.flat) per[k].flat++; else if (r.correct) per[k].correct++;
    }
    const byInst = {};
    for (const k of Object.keys(per)) {
      const p = per[k], d = p.n - p.flat;
      byInst[k] = { resolved: p.n, correct: p.correct, flat: p.flat, hitRate: d ? Math.round(p.correct / d * 100) : null };
    }
    const overallCorrect = decided.filter(r => r.correct).length;
    return {
      overall: { resolved: this.resolved.length, decided: decided.length, correct: overallCorrect,
        flat: this.resolved.length - decided.length, hitRate: decided.length ? Math.round(overallCorrect / decided.length * 100) : null },
      byInst, horizonMin: this.horizonMin, minMovePct: this.minMovePct,
    };
  }

  status() {
    return { pending: this.pending.slice().sort((a, b) => b.at - a.at), recent: this.resolved.slice(-20).reverse(), accuracy: this.accuracy() };
  }
}

module.exports = { agree, ConfirmedTracker };
