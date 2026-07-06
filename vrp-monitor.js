// ============================================================================
//  vrp-monitor.js — Net-of-cost realized Variance-Risk-Premium monitor (research #2)
//
//  Deep-research REFUTED the assumption "implied vol always exceeds realized vol" — the
//  premium is NOT mechanically positive every period. So instead of assuming it, MEASURE
//  it: track IV − realized-vol − transaction-cost drag per instrument on a rolling window,
//  and only call the environment sell-favorable when the NET VRP is actually positive.
//
//  This is the honest edge-confirmation the research asked for: our whole face is selling
//  the VRP; this module verifies the VRP is really there, net of costs, right now.
//  Pure + unit-tested. Feeds the signal-paper open path + /api/vrp-monitor.
// ============================================================================
'use strict';
const round = (v, d = 2) => +(+v).toFixed(d);

// Annualized realized volatility (%) from a close series — log returns × √periodsPerYear.
function realizedVol(closes, periodsPerYear = 252) {
  const c = (closes || []).map(Number).filter(x => x > 0);
  if (c.length < 3) return null;
  const rets = [];
  for (let i = 1; i < c.length; i++) rets.push(Math.log(c[i] / c[i - 1]));
  const m = rets.reduce((s, x) => s + x, 0) / rets.length;
  const varc = rets.reduce((s, x) => s + (x - m) * (x - m), 0) / (rets.length - 1);
  return round(Math.sqrt(varc * periodsPerYear) * 100, 2);
}

// Net VRP in vol points: gross = IV − RV; net = gross − cost drag (round-trip friction).
function netVRP(iv, rv, costDrag = 1.5) {
  if (iv == null || rv == null || !isFinite(iv) || !isFinite(rv)) return null;
  const gross = round(Number(iv) - Number(rv), 2);
  return { iv: round(iv, 2), rv: round(rv, 2), grossVRP: gross, costDrag: round(costDrag, 2), netVRP: round(gross - costDrag, 2) };
}

class VRPMonitor {
  constructor(opts = {}) {
    this.window = opts.window || 40;
    this.costDrag = opts.costDrag != null ? opts.costDrag : 1.5;   // vol-point equivalent of round-trip cost
    this.series = {};                                              // inst → [{t, iv, rv, grossVRP, netVRP}]
  }

  record(inst, iv, rv, t = 0) {
    const nv = netVRP(iv, rv, this.costDrag);
    if (!nv) return null;
    const s = (this.series[inst] = this.series[inst] || []);
    s.push({ t, ...nv });
    if (s.length > this.window) s.shift();
    return s[s.length - 1];
  }

  assess(inst) {
    const s = this.series[inst] || [];
    if (!s.length) return { inst, favorable: false, n: 0, reason: 'no VRP samples yet' };
    const last = s[s.length - 1];
    const nets = s.map(x => x.netVRP).slice().sort((a, b) => a - b);
    const median = nets[Math.floor(nets.length / 2)];
    const positiveShare = s.filter(x => x.netVRP > 0).length / s.length;
    // sell-favorable only when the premium is present BOTH right now AND typically (median > 0)
    const favorable = last.netVRP > 0 && median > 0;
    return {
      inst, favorable, current: last,
      medianNetVRP: round(median, 2), positiveShare: round(positiveShare, 2), n: s.length,
      reason: favorable
        ? `net VRP +${last.netVRP} (median +${round(median, 2)}, ${Math.round(positiveShare * 100)}% of days +) — premium present net of cost`
        : `net VRP ${last.netVRP} / median ${round(median, 2)} — premium thin/absent net of cost, stand down`,
    };
  }

  status(insts = Object.keys(this.series)) {
    const out = {};
    for (const i of insts) out[i] = this.assess(i);
    return { costDrag: this.costDrag, window: this.window, monitors: out,
      note: 'Measured net-of-cost VRP (IV−RV−cost). Sell only when positive — research refuted the assumption that IV always exceeds RV.' };
  }

  toJSON() { return { series: this.series, window: this.window, costDrag: this.costDrag }; }
  load(o) { if (o && o.series) this.series = o.series; if (o && o.window) this.window = o.window; if (o && o.costDrag != null) this.costDrag = o.costDrag; }
}

module.exports = { VRPMonitor, realizedVol, netVRP };
