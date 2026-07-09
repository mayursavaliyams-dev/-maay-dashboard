/**
 * CONFLUENCE LEARNER — adaptive weighting for the Master Confluence Engine
 *
 *   Trade closes  →  Win / Loss  →  AI learns  →  re-weight the factors
 *
 * Each master-signal verdict carries a per-factor snapshot (which leg pointed
 * which way, how hard). When that trade resolves we run credit assignment:
 *
 *   LOSS on a BUY  → legs that voted BULLISH misled us      → shrink their weight
 *                    legs that voted BEARISH were right      → grow their weight
 *   WIN  on a BUY  → legs that voted BULLISH were right      → grow their weight
 *                    legs that voted BEARISH were noise       → shrink their weight
 *   (mirror for SELL)
 *
 * Update is multiplicative and scaled by how strongly the leg voted, then the
 * directional weights are re-normalised back to their baseline sum so the
 * engine's probability calibration stays stable — only the *mix* shifts. Per-leg
 * hit-rate stats are tracked so you can see WHY a weight moved.
 *
 * Pure-ish: persists learned state to data/confluence-weights.json. No network.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { DEFAULT_WEIGHTS } = require('./master-confluence');

const DATA = path.join(__dirname, 'data');
const FILE = path.join(DATA, 'confluence-weights.json');

// legs whose weight is learnable (directional). risk/unavailable legs excluded.
const LEARNABLE = ['trend', 'smartMoney', 'oi', 'volume', 'news', 'pcr', 'greeks', 'fii', 'iv'];
const LR_DEFAULT = Number(process.env.CONFLUENCE_LR || 0.06);   // learning rate
const W_MIN = 3, W_MAX = 40;                                    // per-leg bounds
const TRADES_KEEP = 500;

const sgn = v => (v > 0 ? 1 : v < 0 ? -1 : 0);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// C3: these files hold LEARNED WEIGHTS — reliability evidence accumulated from real
// wins/losses. Silently resetting them to defaults because the file is truncated is
// how a calibrated engine quietly becomes uncalibrated. Corrupt → recover; if
// unrecoverable → THROW (the caller must not pretend it has fresh weights).
function readJson(f, d) {
  return require('./safe-write.js').readJsonSync(f, {
    fallback: d,
    onRecover: (reason, bak) => console.warn(`[confluence-learner] ${f} was corrupt (${reason}); recovered from ${bak}.`),
  });
}
function writeJson(f, o) {
  try { require('./safe-write.js').writeJsonSync(f, o, { pretty: 1, backup: true }); return true; }
  catch (e) { console.error(`[confluence-learner] write failed for ${f}: ${e.message}`); return false; }
}

const baselineSum = LEARNABLE.reduce((s, k) => s + (DEFAULT_WEIGHTS[k] || 8), 0);
const freshInst = () => {
  const weights = {}, stats = {};
  for (const k of LEARNABLE) { weights[k] = DEFAULT_WEIGHTS[k] || 8; stats[k] = { correct: 0, wrong: 0, n: 0 }; }
  return { weights, stats };
};

class ConfluenceLearner {
  constructor() {
    const s = readJson(FILE, null) || {};
    this.byInst = s.byInst || {};          // { NIFTY: {weights, stats}, SENSEX: {...} }
    this.pending = s.pending || {};        // signalId -> snapshot (awaiting outcome)
    this.trades = s.trades || [];          // resolved, learned-from (ring buffer)
    this.seq = s.seq || 1000;              // signal/trade id counter
  }

  _inst(inst) {
    const key = String(inst || 'NIFTY').toUpperCase();
    if (!this.byInst[key]) this.byInst[key] = freshInst();
    // backfill any newly-added learnable leg
    for (const k of LEARNABLE) { if (this.byInst[key].weights[k] == null) this.byInst[key].weights[k] = DEFAULT_WEIGHTS[k] || 8; if (!this.byInst[key].stats[k]) this.byInst[key].stats[k] = { correct: 0, wrong: 0, n: 0 }; }
    return this.byInst[key];
  }

  _save() { writeJson(FILE, { byInst: this.byInst, pending: this.pending, trades: this.trades.slice(-TRADES_KEEP), seq: this.seq }); }

  /** current learned weight for a leg (falls back to default). */
  weight(inst, leg) { return LEARNABLE.includes(leg) ? this._inst(inst).weights[leg] : (DEFAULT_WEIGHTS[leg] || 8); }

  /** stamp learned weights onto a freshly-built factors object (mutates f.weight). */
  applyWeights(inst, factors) {
    const w = this._inst(inst).weights;
    for (const k of LEARNABLE) if (factors[k] && factors[k].available !== false) factors[k].weight = +w[k].toFixed(2);
    return factors;
  }

  /** register an emitted verdict so it can be resolved later. returns a signalId. */
  track(inst, verdict, factors, meta = {}) {
    if (!verdict || (verdict.decision !== 'BUY' && verdict.decision !== 'SELL')) return null; // only tradeable calls
    const id = ++this.seq;
    const snap = {};
    for (const k of LEARNABLE) if (factors[k] && factors[k].available !== false) snap[k] = Number(factors[k].score) || 0;
    this.pending[id] = {
      id, inst: String(inst).toUpperCase(), decision: verdict.decision, direction: verdict.direction,
      probability: verdict.probability, net: verdict.net, score: meta.score != null ? meta.score : verdict.probability,
      factors: snap, at: Date.now(),
    };
    // cap pending size
    const ids = Object.keys(this.pending);
    if (ids.length > TRADES_KEEP * 2) delete this.pending[ids[0]];
    this._save();
    return id;
  }

  /** resolve a previously-tracked signal by id with WIN/LOSS. */
  resolve(signalId, result, extra = {}) {
    const snap = this.pending[signalId];
    if (!snap) return { error: 'unknown signalId', signalId };
    delete this.pending[signalId];
    return this.learn({ ...snap, result, pnl: extra.pnl, lr: extra.lr });
  }

  /**
   * core learning step.
   * trade = { inst, decision|direction, factors:{leg:score}, result:'WIN'|'LOSS', pnl?, score?, lr? }
   */
  learn(trade) {
    const inst = String(trade.inst || 'NIFTY').toUpperCase();
    const dir = trade.direction ? (trade.direction === 'BULLISH' || trade.direction === 'BUY' ? 1 : -1)
      : (trade.decision === 'BUY' ? 1 : trade.decision === 'SELL' ? -1 : 0);
    if (!dir) return { error: 'no tradeable direction' };

    const res = String(trade.result || '').toUpperCase();
    const won = res === 'WIN' || res === 'PROFIT' || res === 'TP' || (trade.pnl != null && Number(trade.pnl) > 0);
    const lost = res === 'LOSS' || res === 'SL' || res === 'LOSE' || (trade.pnl != null && Number(trade.pnl) < 0);
    if (!won && !lost) return { error: 'result must be WIN or LOSS (or signed pnl)' };

    const st = this._inst(inst);
    const lr = clamp(Number(trade.lr) || LR_DEFAULT, 0.005, 0.3);
    const snap = trade.factors || {};
    const changes = {};

    for (const k of LEARNABLE) {
      const s = Number(snap[k]);
      if (!isFinite(s) || s === 0) continue;                  // leg absent / no opinion → no update
      const agreed = sgn(s) === dir;                          // did this leg back the trade direction?
      const helpful = (won && agreed) || (lost && !agreed);   // was the leg "right"?
      const strength = Math.abs(s) / 100;                     // 0..1 — strong votes move weight more
      const before = st.weights[k];
      const factor = helpful ? (1 + lr * strength) : (1 - lr * strength);
      st.weights[k] = clamp(before * factor, W_MIN, W_MAX);
      st.stats[k].n++; helpful ? st.stats[k].correct++ : st.stats[k].wrong++;
      changes[k] = { agreed, helpful, from: +before.toFixed(2), to: +st.weights[k].toFixed(2), score: s };
    }

    // re-normalise directional weights back to baseline sum → only the MIX shifts
    const sum = LEARNABLE.reduce((a, k) => a + st.weights[k], 0);
    if (sum > 0) { const scale = baselineSum / sum; for (const k of LEARNABLE) st.weights[k] = +clamp(st.weights[k] * scale, W_MIN, W_MAX).toFixed(2); }

    const rec = {
      id: trade.id || ++this.seq, inst, decision: dir > 0 ? 'BUY' : 'SELL', result: won ? 'WIN' : 'LOSS',
      score: trade.score != null ? trade.score : null, pnl: trade.pnl != null ? Number(trade.pnl) : null,
      at: trade.at || Date.now(), changes,
    };
    this.trades.push(rec);
    if (this.trades.length > TRADES_KEEP) this.trades = this.trades.slice(-TRADES_KEEP);
    this._save();
    return { ok: true, inst, result: rec.result, applied: changes, weights: this.weightsView(inst) };
  }

  weightsView(inst) {
    const st = this._inst(inst);
    const out = {};
    for (const k of LEARNABLE) {
      const s = st.stats[k];
      out[k] = {
        weight: +st.weights[k].toFixed(2), default: DEFAULT_WEIGHTS[k] || 8,
        delta: +(st.weights[k] - (DEFAULT_WEIGHTS[k] || 8)).toFixed(2),
        samples: s.n, hitRate: s.n ? Math.round((s.correct / s.n) * 100) : null,
      };
    }
    return out;
  }

  status(inst) {
    const insts = inst ? [String(inst).toUpperCase()] : Object.keys(this.byInst);
    const weights = {}; for (const i of insts) weights[i] = this.weightsView(i);
    return {
      learnedTrades: this.trades.length, pending: Object.keys(this.pending).length,
      learningRate: LR_DEFAULT, learnableLegs: LEARNABLE, weights,
      recent: this.trades.slice(-15).reverse(),
    };
  }

  reset(inst) {
    if (inst) { this.byInst[String(inst).toUpperCase()] = freshInst(); }
    else { this.byInst = {}; this.trades = []; this.pending = {}; }
    this._save();
    return { ok: true, reset: inst || 'ALL' };
  }
}

module.exports = { ConfluenceLearner, LEARNABLE };
