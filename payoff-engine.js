/**
 * PAYOFF ENGINE — Antigravity Pro · Module (strategy builder)
 *
 * Multi-leg option strategy → expiry payoff curve, breakevens, max P/L, net
 * credit/debit, combined Greeks (Black-Scholes), and Probability-of-Profit (PoP,
 * lognormal at expiry). PURE — no I/O; the server supplies leg premiums/IV/spot.
 *
 * leg = { type:'CE'|'PE', side:'BUY'|'SELL', strike, premium, lots, iv? }
 * ctx = { spot, dteDays, lotSize, riskFreeRate=0.06 }
 *
 * The #1 feature retail options tools compete on (OptionStrat / thinkorswim).
 * Honest: PoP is a lognormal estimate (not a guarantee); naked shorts flag
 * unbounded risk explicitly.
 */
'use strict';

const round = (v, d = 2) => +(+v).toFixed(d);
const npdf = x => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
// Abramowitz-Stegun normal CDF
function ncdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.319381530 * t - 0.356563782 * t * t + 1.781477937 * t ** 3 - 1.821255978 * t ** 4 + 1.330274429 * t ** 5;
  const p = 1 - npdf(x) * d;
  return x >= 0 ? p : 1 - p;
}

/** payoff of a single leg at expiry spot S, per unit (before ×lots×lotSize). */
function legPayoff(leg, S) {
  const intrinsic = leg.type === 'CE' ? Math.max(S - leg.strike, 0) : Math.max(leg.strike - S, 0);
  const prem = Number(leg.premium) || 0;
  return leg.side === 'BUY' ? (intrinsic - prem) : (prem - intrinsic);
}

/** Black-Scholes greeks for one leg (r default 0.06, per-day theta, per-1%-vol vega). */
function legGreeks(leg, spot, dteDays, r) {
  const K = leg.strike, sigma = (Number(leg.iv) || 12) / 100, T = Math.max(0.5, dteDays) / 365;
  if (!(spot > 0 && K > 0 && sigma > 0 && T > 0)) return { delta: 0, gamma: 0, theta: 0, vega: 0 };
  const d1 = (Math.log(spot / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const delta = leg.type === 'CE' ? ncdf(d1) : ncdf(d1) - 1;
  const gamma = npdf(d1) / (spot * sigma * Math.sqrt(T));
  const vega = spot * npdf(d1) * Math.sqrt(T) / 100;
  const thetaAnnual = leg.type === 'CE'
    ? -(spot * npdf(d1) * sigma) / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * ncdf(d2)
    : -(spot * npdf(d1) * sigma) / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * ncdf(-d2);
  return { delta, gamma, theta: thetaAnnual / 365, vega };
}

function buildPayoff(legs, ctx = {}) {
  const L = (legs || []).filter(l => l && l.strike > 0 && (l.type === 'CE' || l.type === 'PE'))
    .map(l => ({ type: l.type, side: l.side === 'SELL' ? 'SELL' : 'BUY', strike: +l.strike, premium: Number(l.premium) || 0, lots: Math.max(1, Number(l.lots) || 1), iv: Number(l.iv) || null }));
  if (!L.length) return { available: false, reason: 'no valid legs' };
  const spot = Number(ctx.spot) || 0;
  const lotSize = Math.max(1, Number(ctx.lotSize) || 1);
  const dteDays = Math.max(0.5, Number(ctx.dteDays) || 3);
  const r = ctx.riskFreeRate != null ? ctx.riskFreeRate : 0.06;
  if (!(spot > 0)) return { available: false, reason: 'spot required' };

  const qty = l => l.lots * lotSize;
  const total = S => L.reduce((s, l) => s + legPayoff(l, S) * qty(l), 0);

  // net credit(+)/debit(-)
  const netCredit = round(L.reduce((s, l) => s + (l.side === 'SELL' ? l.premium : -l.premium) * qty(l), 0));

  // curve ±35% of spot
  const lo = spot * 0.65, hi = spot * 1.35, steps = 121;
  const curve = [];
  for (let i = 0; i <= steps; i++) {
    const S = round(lo + (hi - lo) * i / steps);
    curve.push({ spot: S, payoff: round(total(S)) });
  }
  // breakevens — zero-crossings on the curve (linear interpolation)
  const breakevens = [];
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1], b = curve[i];
    if ((a.payoff <= 0 && b.payoff > 0) || (a.payoff >= 0 && b.payoff < 0)) {
      const t = a.payoff / (a.payoff - b.payoff);
      breakevens.push(round(a.spot + t * (b.spot - a.spot)));
    }
  }
  // max profit / loss over the plotted range
  let maxProfit = -Infinity, maxLoss = Infinity;
  for (const p of curve) { if (p.payoff > maxProfit) maxProfit = p.payoff; if (p.payoff < maxLoss) maxLoss = p.payoff; }

  // unbounded-risk flags — net short calls = unbounded upside loss; net short puts = large downside loss
  const netCE = L.reduce((s, l) => s + (l.type === 'CE' ? (l.side === 'SELL' ? 1 : -1) * l.lots : 0), 0);
  const netPE = L.reduce((s, l) => s + (l.type === 'PE' ? (l.side === 'SELL' ? 1 : -1) * l.lots : 0), 0);
  const unbounded = { upside: netCE > 0, downside: netPE > 0 };

  // Probability of Profit — lognormal S_T, mass over the profit intervals
  const sigmaAtm = ((L.find(l => l.iv) || {}).iv || ctx.ivPct || 12) / 100;
  const T = dteDays / 365, s = sigmaAtm * Math.sqrt(T);
  const mu = Math.log(spot) + (-0.5 * sigmaAtm * sigmaAtm) * T;
  const lnCdf = x => (x <= 0 ? 0 : ncdf((Math.log(x) - mu) / s));
  const bounds = [spot * 0.01, ...breakevens.slice().sort((a, b) => a - b), spot * 5];
  let pop = 0;
  for (let i = 1; i < bounds.length; i++) {
    const a = bounds[i - 1], b = bounds[i], mid = (a + b) / 2;
    if (total(mid) > 0) pop += lnCdf(b) - lnCdf(a);
  }
  pop = Math.max(0, Math.min(1, pop));

  // combined greeks
  const g = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const l of L) {
    const lg = legGreeks(l, spot, dteDays, r), sgn = l.side === 'BUY' ? 1 : -1;
    g.delta += lg.delta * sgn * qty(l); g.gamma += lg.gamma * sgn * qty(l);
    g.theta += lg.theta * sgn * qty(l); g.vega += lg.vega * sgn * qty(l);
  }

  // rough margin: defined-risk → max loss; else ~12% notional per naked short leg
  const nakedShorts = L.filter(l => l.side === 'SELL').reduce((s, l) => s + l.lots, 0);
  const marginEst = (unbounded.upside || unbounded.downside)
    ? round(nakedShorts * spot * lotSize * 0.12)
    : round(Math.abs(maxLoss));

  return {
    available: true,
    legs: L, spot: round(spot), lotSize, dteDays: round(dteDays, 1),
    netCredit, netType: netCredit >= 0 ? 'CREDIT' : 'DEBIT',
    maxProfit: round(maxProfit), maxLoss: round(maxLoss),
    maxProfitLabel: unbounded.upside ? 'limited (rises with drop)' : round(maxProfit),
    maxLossLabel: (unbounded.upside || unbounded.downside) ? 'UNBOUNDED (naked short)' : round(Math.abs(maxLoss)),
    breakevens, unbounded,
    probabilityOfProfit: round(pop * 100, 1),
    greeks: { delta: round(g.delta, 2), gamma: round(g.gamma, 4), theta: round(g.theta), vega: round(g.vega) },
    marginEst,
    riskReward: (isFinite(maxProfit) && maxLoss < 0 && !(unbounded.upside || unbounded.downside)) ? round(maxProfit / Math.abs(maxLoss), 2) : null,
    curve,
    note: 'PoP is a lognormal estimate at expiry, not a guarantee. Greeks are Black-Scholes (r=' + r + ').',
  };
}

module.exports = { buildPayoff, legPayoff, legGreeks, ncdf };
