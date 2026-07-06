// ============================================================================
//  signal-paper-engine.js — closes the Signal-Engine loop (Phase 2-5 → live paper)
//
//  Takes a defined-risk PLAN from trade-planner.js, opens a PAPER position, marks it
//  to market each tick, exits on target / stop / expiry / regime-flip, and returns the
//  realized outcome so it can feed signal-health.js + the meta-label calibrator.
//
//  100% PAPER. No real orders. This is the forward-test that turns the built-but-dormant
//  signal engine into one that actually accumulates calibration data. See
//  docs/SIGNAL-ENGINE-ROADMAP.md (Phase 5).
//
//  Unified P&L convention — for ANY leg set, value = Σ(SELL:+ltp, BUY:−ltp) = the net
//  credit to establish it now. P&L per lot (points) = entryNet − currentNet, which is
//  correct for both credit (condor / credit spread) and debit spreads.
// ============================================================================
'use strict';
const round = (v, d = 2) => +(+v).toFixed(d);

const isCredit = (structure) => structure === 'IRON_CONDOR' || String(structure).startsWith('CREDIT');

// net premium to establish the legs now, given quote(strike,type)->ltp
function positionValue(legs, quote) {
  let net = 0;
  for (const l of legs) { const p = Number(quote(l.strike, l.type)) || 0; net += l.side === 'SELL' ? p : -p; }
  return round(net, 2);
}
// P&L per lot in points (entryNet − currentNet) — works for credit and debit alike
function pnlPoints(pos, quote) { return round(pos.entryNet - positionValue(pos.legs, quote), 2); }

// widest strike gap among the legs (spread width in points) — for debit max-profit
function spreadWidth(legs) {
  const ks = legs.map(l => Number(l.strike)).filter(Boolean);
  return ks.length ? Math.max(...ks) - Math.min(...ks) : 0;
}

/**
 * Decide whether to close an open position.
 * @returns {close:boolean, reason:string}
 */
function exitDecision(pos, pnlPts, dte, regime, cfg) {
  if (dte != null && dte <= cfg.expiryDte) return { close: true, reason: 'EXPIRY' };
  if (pos.credit) {
    const target = cfg.creditTpFrac * pos.entryNet;          // capture % of credit
    const stop = -cfg.creditSlMult * pos.entryNet;           // lose N× credit
    if (pnlPts >= target) return { close: true, reason: 'TARGET' };
    if (pnlPts <= stop) return { close: true, reason: 'STOP' };
    if (regime === 'STAND-DOWN' && cfg.exitOnStandDown) return { close: true, reason: 'REGIME_FLIP' };
  } else {
    const debit = -pos.entryNet;                             // paid to open
    const maxProfit = Math.max(pos.width - debit, debit);    // guard tiny/degenerate
    if (pnlPts >= cfg.debitTpFrac * maxProfit) return { close: true, reason: 'TARGET' };
    if (pnlPts <= -cfg.debitSlFrac * debit) return { close: true, reason: 'STOP' };
  }
  return { close: false, reason: '' };
}

class SignalPaperEngine {
  constructor(opts = {}) {
    this.enabled = opts.enabled !== false;
    this.cfg = Object.assign({
      creditTpFrac: 0.5, creditSlMult: 1.0,       // sells: book +50% credit, stop at −1× credit
      debitTpFrac: 0.6, debitSlFrac: 0.6,          // debit: book 60% of max, stop at −60% of paid
      expiryDte: 0, exitOnStandDown: true, maxPerInst: 1, minProb: 55,
    }, opts.cfg || {});
    this.positions = [];                           // open
    this.closed = [];                              // realized ledger (capped)
    this.allTime = { trades: 0, wins: 0, netPnl: 0 };
  }

  hasOpen(inst) { return this.positions.some(p => p.inst === inst); }

  // Open a paper position from a plan (if allowed). Returns the position or null.
  open(inst, plan, quote, meta = {}) {
    if (!this.enabled) return null;
    if (!plan || plan.structure === 'NO_TRADE' || !Array.isArray(plan.legs) || !plan.legs.length) return null;
    if ((meta.probability != null ? meta.probability : 100) < this.cfg.minProb) return null;
    if (this.positions.filter(p => p.inst === inst).length >= this.cfg.maxPerInst) return null;
    const entryNet = positionValue(plan.legs, quote);
    if (!isFinite(entryNet) || entryNet === 0) return null;
    const pos = {
      id: `${inst}-${meta.now || 0}`, inst, structure: plan.structure, legs: plan.legs.map(l => ({ ...l })),
      entryNet, credit: isCredit(plan.structure), width: spreadWidth(plan.legs),
      lots: (plan.sizing && plan.sizing.lots) || 1, lotSize: meta.lotSize || 1,
      rawP: meta.rawP != null ? meta.rawP : (meta.probability != null ? meta.probability / 100 : 0.5),
      openedAt: meta.now || 0, regimeAtEntry: plan.regime || null, mtm: 0, pnlPts: 0,
    };
    this.positions.push(pos);
    return pos;
  }

  // Mark all open positions and close those that hit an exit. Returns closed outcomes.
  // quoteByInst: (inst) => (strike,type)=>ltp ; dteByInst/regimeByInst: (inst)=>value
  step(quoteByInst, dteByInst, regimeByInst, now = 0) {
    const outcomes = [];
    const still = [];
    for (const pos of this.positions) {
      const quote = quoteByInst(pos.inst);
      if (!quote) { still.push(pos); continue; }
      const pts = pnlPoints(pos, quote);
      pos.pnlPts = pts; pos.mtm = round(pts * pos.lotSize * pos.lots, 0);
      const dec = exitDecision(pos, pts, dteByInst ? dteByInst(pos.inst) : null, regimeByInst ? regimeByInst(pos.inst) : null, this.cfg);
      if (dec.close) {
        const pnl = round(pts * pos.lotSize * pos.lots, 2);
        const outcome = {
          inst: pos.inst, structure: pos.structure, strikes: pos.legs.map(l => `${l.strike}${l.type}`),
          entryNet: pos.entryNet, exitPnlPts: pts, pnl, won: pnl >= 0, reason: dec.reason,
          rawP: pos.rawP, prob: Math.round(pos.rawP * 100), heldMin: pos.openedAt ? Math.round((now - pos.openedAt) / 60000) : 0,
          openedAt: pos.openedAt, closedAt: now,
        };
        outcomes.push(outcome);
        this.closed.unshift(outcome); if (this.closed.length > 200) this.closed.length = 200;
        this.allTime.trades++; if (outcome.won) this.allTime.wins++; this.allTime.netPnl = round(this.allTime.netPnl + pnl, 2);
      } else { still.push(pos); }
    }
    this.positions = still;
    return outcomes;
  }

  status() {
    return {
      enabled: this.enabled, cfg: this.cfg,
      open: this.positions.map(p => ({ inst: p.inst, structure: p.structure, strikes: p.legs.map(l => `${l.strike}${l.type}`),
        entryNet: p.entryNet, credit: p.credit, lots: p.lots, mtm: p.mtm, pnlPts: p.pnlPts })),
      allTime: { ...this.allTime, winRate: this.allTime.trades ? round(this.allTime.wins / this.allTime.trades * 100, 1) : null },
      recent: this.closed.slice(0, 20),
      note: 'Signal-engine PAPER forward-test — defined-risk only, outcomes feed signal-health calibration. Educational.',
    };
  }

  toJSON() { return { positions: this.positions, closed: this.closed.slice(0, 200), allTime: this.allTime, enabled: this.enabled }; }
  load(o) { if (!o) return; if (Array.isArray(o.positions)) this.positions = o.positions; if (Array.isArray(o.closed)) this.closed = o.closed; if (o.allTime) this.allTime = o.allTime; if (typeof o.enabled === 'boolean') this.enabled = o.enabled; }
}

module.exports = { SignalPaperEngine, positionValue, pnlPoints, exitDecision, spreadWidth, isCredit };
