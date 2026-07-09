/**
 * AI-LOGGER — measured, auditable hit-rate for the AI advisors.
 *
 * The Claude advisors (gamma-blast, mean-reversion) are NOT backtested, so their
 * real accuracy is unknown. This records every advisory signal with the spot at
 * call time + the predicted direction, then evaluates each one after a hold
 * window against the actual index move. Over a few days this turns "trust the
 * vibes" into "trust the numbers" — you get a real win-rate per advisor.
 *
 * Persisted to data/ai-signals.json so it survives restarts. Capped at 2000 rows.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'data', 'ai-signals.json');
const MAX_ROWS = 2000;

// C3: audit log. Missing → []; corrupt → recover from .bak; unrecoverable → refuse
// to append (never overwrite the evidence) and say so.
let _corrupt = false;
function _load() {
  _corrupt = false;
  try {
    const rows = require('./safe-write.js').readJsonSync(FILE, {
      fallback: [],
      onRecover: (reason, bak) => console.warn(`[ai-logger] log was corrupt (${reason}); recovered from ${bak}.`),
    });
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    _corrupt = true;
    console.error(`[ai-logger] LOG UNRECOVERABLE: ${e.message}. Appending disabled; file untouched.`);
    return [];
  }
}
function _save(arr) {
  if (_corrupt) return;   // never write over an audit log we could not read
  try { require('./safe-write.js').writeJsonSync(FILE, arr.slice(-MAX_ROWS), { backup: true }); }
  catch (e) { console.error(`[ai-logger] append failed: ${e.message}`); }
}

let _signals = _load();

/**
 * Record a fresh AI signal.
 * @param {object} s — { type:'gamma'|'meanrev', inst, spot, dir:+1|-1|0,
 *                        target?, stop?, conf?, valid?, payload? }
 * dir = +1 (expect index up) / -1 (expect down) / 0 (HOLD/No-Setup — not scored).
 */
function logSignal(s) {
  const spot = Number(s.spot);
  if (!(spot > 0)) return null;
  const rec = {
    id: `${s.type}_${s.inst}_${spot}_${_signals.length}`,
    type: s.type, inst: s.inst, ts: Date.now(),
    spot, dir: (s.dir | 0), target: s.target ?? null, stop: s.stop ?? null,
    conf: s.conf ?? null, valid: s.valid !== false,
    payload: s.payload ?? null,
    outcome: null, movePct: null, evalTs: null
  };
  _signals.push(rec);
  _save(_signals);
  return rec.id;
}

/**
 * Evaluate matured, still-open signals for an instrument against a fresh spot.
 * A signal "wins" if the index moved >= threshPct in the predicted direction
 * within/after the hold window, "loses" if it moved that far the other way.
 */
function evaluate(inst, spot, { holdMs = 15 * 60 * 1000, threshPct = 0.15 } = {}) {
  spot = Number(spot);
  if (!(spot > 0)) return;
  const now = Date.now();
  let changed = false;
  for (const s of _signals) {
    if (s.outcome || s.inst !== inst || !s.dir || !s.valid) continue;
    if (now - s.ts < holdMs) continue;                 // not matured yet
    const movePct = ((spot - s.spot) / s.spot) * 100;
    const dirMove = movePct * s.dir;                   // >0 if it moved the predicted way
    s.outcome = dirMove >= threshPct ? 'WIN' : dirMove <= -threshPct ? 'LOSS' : 'FLAT';
    s.movePct = +movePct.toFixed(2);
    s.evalTs = now;
    changed = true;
  }
  if (changed) _save(_signals);
}

function stats() {
  const byType = {};
  for (const s of _signals) {
    const t = byType[s.type] = byType[s.type] || { total: 0, valid: 0, win: 0, loss: 0, flat: 0, pending: 0 };
    t.total++;
    if (s.valid) t.valid++;
    if (!s.outcome) t.pending++;
    else if (s.outcome === 'WIN') t.win++;
    else if (s.outcome === 'LOSS') t.loss++;
    else t.flat++;
  }
  for (const k in byType) {
    const t = byType[k];
    const decided = t.win + t.loss;
    t.winRate = decided ? Math.round(100 * t.win / decided) : null;  // null = not enough data yet
  }
  return {
    note: 'Advisors are unbacktested — these are LIVE-measured outcomes, not a guarantee.',
    totalSignals: _signals.length,
    byType,
    recent: _signals.slice(-25).reverse().map(s => ({
      type: s.type, inst: s.inst, ts: s.ts, spot: s.spot, dir: s.dir,
      valid: s.valid, outcome: s.outcome, movePct: s.movePct, conf: s.conf
    }))
  };
}

module.exports = { logSignal, evaluate, stats };
