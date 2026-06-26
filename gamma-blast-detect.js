/**
 * GAMMA-BLAST LIVE DETECTOR
 * Scores 0-100 using gamma-blast-params.js. Design:
 *   ~70  = PRIMED (loaded gun): expiry-day + in-window + spot on ATM + cheap IV
 *   ~100 = BLASTING NOW: the live trigger fires (premium velocity + spot breakout + vol)
 * Tracks ATM-straddle premium + spot in-memory for the velocity/trigger signals.
 */
const P = require('./gamma-blast-params.js');
const _hist = {};                                   // inst -> { prem:[{t,v}], spot:[{t,v}] }
const hhmm = s => { const [a, b] = String(s).split(':').map(Number); return a * 60 + b; };

function detect({ inst, rows, spot, atm, expiry, istDate, istMins, atmIV }) {
  const now = Date.now();
  const h = _hist[inst] = _hist[inst] || { prem: [], spot: [] };

  const atmRow = (rows || []).find(r => Number(r.strike) === atm) || {};
  const ceLtp = Number(atmRow.ce?.ltp || 0), peLtp = Number(atmRow.pe?.ltp || 0);
  const straddle = ceLtp + peLtp;
  if (straddle > 0) h.prem.push({ t: now, v: straddle });
  if (spot > 0)     h.spot.push({ t: now, v: spot });
  const cut = now - 25 * 60 * 1000;
  h.prem = h.prem.filter(x => x.t >= cut);
  h.spot = h.spot.filter(x => x.t >= cut);

  // ── timing ──
  const isExpiryToday = expiry === istDate;
  const winStart = hhmm(P.startHHMM), winEnd = hhmm(P.endHHMM);
  const inWindow = istMins >= winStart && istMins <= winEnd;
  let windowState = 'before', minsToWindow = Math.max(0, winStart - istMins), minsLeft = 0;
  if (inWindow)            { windowState = 'active'; minsLeft = winEnd - istMins; minsToWindow = 0; }
  else if (istMins > winEnd) { windowState = 'closed'; }

  // ── conditions ──
  const atmProxPct = spot > 0 ? Math.abs(spot - atm) / spot * 100 : 99;
  // premium velocity (%/min) over the params window
  const pPast = h.prem.find(x => x.t <= now - P.premVelWindowMin * 60000) || h.prem[0];
  const vMin = pPast ? Math.max((now - pPast.t) / 60000, 0.5) : 1;
  const premVelPctMin = (pPast && pPast.v > 0) ? ((straddle - pPast.v) / pPast.v * 100) / vMin : 0;
  // spot trigger move (%) over the pre-range window
  const sPast = h.spot.find(x => x.t <= now - P.preRangeWindowMin * 60000) || h.spot[0];
  const spotMovePct = (sPast && sPast.v > 0) ? (spot - sPast.v) / sPast.v * 100 : 0;
  const atmVol = Number(atmRow.ce?.volume || 0) + Number(atmRow.pe?.volume || 0);

  const cond = {
    dteGate:    isExpiryToday && inWindow,                 // expiry day + in the afternoon window
    atmProx:    atmProxPct <= P.maxSpotToATMPct,           // spot sitting on the strike
    blastScore: isExpiryToday && atmProxPct <= P.maxSpotToATMPct, // structural gamma loaded at 0-DTE/ATM
    gtr:        isExpiryToday,                             // gamma dominates theta at 0-DTE
    ivCheap:    atmIV > 0 && atmIV <= P.maxATMIVpct,       // cheap premium → bigger % blast
    premVel:    Math.abs(premVelPctMin) >= P.premVelPctPerMin,  // LIVE: premium ripping
    trigger:    Math.abs(spotMovePct) >= P.triggerMovePct,      // LIVE: spot breakout
    volOI:      atmVol > 0,
  };

  const W = P.weights;
  let score = 0;
  for (const k of Object.keys(W)) if (cond[k]) score += W[k];
  score = Math.min(100, Math.round(score));

  const side = spotMovePct > 0 ? 'CE' : spotMovePct < 0 ? 'PE' : null;
  const level = P.levelFor(score);
  const firing = score >= P.alertThreshold && cond.premVel && (cond.trigger || cond.dteGate);

  return {
    inst, expiry, isExpiryToday, windowState, minsToWindow, minsLeft,
    score, level, firing, alertThreshold: P.alertThreshold,
    side, atmStrike: atm, spot: +Number(spot).toFixed(2), atmStraddle: +straddle.toFixed(2),
    premVelPctMin: +premVelPctMin.toFixed(1), spotMovePct: +spotMovePct.toFixed(2),
    atmProxPct: +atmProxPct.toFixed(3), atmIV: +Number(atmIV).toFixed(1),
    window: `${P.startHHMM}-${P.endHHMM}`, conditions: cond,
  };
}
module.exports = { detect };
