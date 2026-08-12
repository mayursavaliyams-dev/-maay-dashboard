/* ═══════════════════════════════════════════════════════════════════════════
   risk-state — assembles the portfolio picture the risk layer evaluates against.

   WHY THIS MODULE EXISTS

   `RiskManager.evaluate(intent, state)` needs a portfolio state: equity, what is
   deployed, open counts, greeks, and how risk is distributed across expiries and
   strikes. Nothing in this repository built one. The consequence, found on
   2026-07-31: `requestApproval` is never called in production, so even the one
   order path that holds the guarded broker could not have placed an order — it
   would have been refused for having no approval. The chokepoint was not merely
   narrow, it was inert.

   THE ONE RULE

   Every field is either measured or null. Nothing is defaulted to zero to make
   a check evaluable, because a check that evaluates against a fabricated zero
   is worse than one that refuses: it reports PASS on a portfolio nobody
   measured. Where a value cannot be established the field is null, the
   corresponding check returns UNEVALUABLE, and the order blocks. That is the
   intended direction of failure.

   COMPLETENESS IS DECLARED, NOT ASSUMED

   `riskMapComplete` is true only when every engine reported and every leg could
   be priced. It is the flag that lets the risk layer read an absent strike as
   zero rather than unknown. If one engine is unreachable, the flag is false and
   new positions block — which is correct, because an unreachable engine may be
   holding exactly the concentration the check exists to catch.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * @param {object} book    output of positions-book.build()
 * @param {object} inputs
 *   equity, startOfDayEquity, peakEquityToday, dayRealisedPnl   rupees or null
 *   greeks            { delta, gamma, vega, theta } or null
 *   dataAgeMs         age of the market data the decision is based on, or null
 *   consecutiveLosses integer or null
 *   isExpiryDay       boolean or null
 *   minutesToClose    integer or null
 * @returns {{ state: object, complete: boolean, gaps: string[] }}
 */
function buildRiskState(book, inputs = {}) {
  const gaps = [];
  const positions = (book && Array.isArray(book.positions)) ? book.positions : null;

  if (!positions) {
    gaps.push('positions book unavailable');
    return { state: emptyState(inputs, gaps), complete: false, gaps };
  }

  if (book.unavailable && book.unavailable.length) {
    // An engine that did not answer may be holding anything. Not zero — unknown.
    gaps.push(`engines did not report: ${book.unavailable.join(', ')}`);
  }

  const riskByStrike = {};
  const riskByExpiry = {};
  const deployedByUnderlying = {};
  const lotsByInstrument = {};
  let total = 0;
  let anyLegUnpriced = false;

  for (const p of positions) {
    const qty = num(p.qty);
    const lot = num(p.lot);
    if (qty === null || lot === null) { anyLegUnpriced = true; gaps.push(`${p.engine}/${p.inst}: qty or lot unknown`); continue; }

    lotsByInstrument[p.inst] = (lotsByInstrument[p.inst] || 0) + qty;

    const legs = Array.isArray(p.legs) ? p.legs : [];
    if (!legs.length) { anyLegUnpriced = true; gaps.push(`${p.engine}/${p.inst}: no legs published`); continue; }

    for (const leg of legs) {
      const px = num(leg.px);
      const strike = num(leg.strike);
      if (px === null || strike === null) {
        anyLegUnpriced = true;
        gaps.push(`${p.engine}/${p.inst}: leg ${leg.type || '?'} ${leg.strike ?? '?'} has no entry price`);
        continue;
      }
      // Exposure of THIS leg, exactly: lots × contract size × entry price.
      const legNotional = qty * lot * px;
      total += legNotional;

      const key = `${p.inst}|${strike}|${leg.type || '?'}`;
      riskByStrike[key] = (riskByStrike[key] || 0) + legNotional;
      deployedByUnderlying[p.inst] = (deployedByUnderlying[p.inst] || 0) + legNotional;

      // Expiry is not carried on a leg today. Recorded as a gap rather than
      // guessed from the strike or the calendar.
      const exp = p.expiry || leg.expiry || null;
      if (exp) riskByExpiry[exp] = (riskByExpiry[exp] || 0) + legNotional;
      else anyLegUnpriced = true;
    }
  }

  if (anyLegUnpriced) gaps.push('at least one leg could not be priced — risk maps are partial');
  if (!Object.keys(riskByExpiry).length && positions.length) gaps.push('no position publishes an expiry — riskByExpiry is empty');

  const complete = gaps.length === 0;

  const state = {
    equity: num(inputs.equity),
    startOfDayEquity: num(inputs.startOfDayEquity),
    peakEquityToday: num(inputs.peakEquityToday),
    dayRealisedPnl: num(inputs.dayRealisedPnl),

    // With no open positions and a COMPLETE book, deployed is a measured zero.
    // With an incomplete book it is unknown, and stays unknown.
    deployed: complete ? round2(total) : (positions.length === 0 && !gaps.length ? 0 : null),
    deployedByUnderlying,
    openPositions: positions.length,
    lotsByInstrument,

    greeks: inputs.greeks && typeof inputs.greeks === 'object' ? {
      delta: num(inputs.greeks.delta), gamma: num(inputs.greeks.gamma),
      vega: num(inputs.greeks.vega), theta: num(inputs.greeks.theta),
    } : null,

    totalRisk: complete ? round2(total) : null,
    riskByExpiry,
    riskByStrike,

    // The declaration that lets an absent strike read as a measured zero.
    riskMapComplete: complete,

    isExpiryDay: typeof inputs.isExpiryDay === 'boolean' ? inputs.isExpiryDay : null,
    minutesToClose: num(inputs.minutesToClose),
    dataAgeMs: num(inputs.dataAgeMs),
    consecutiveLosses: num(inputs.consecutiveLosses),
  };

  return { state, complete, gaps };
}

function emptyState(inputs, gaps) {
  return {
    equity: num(inputs.equity), startOfDayEquity: num(inputs.startOfDayEquity),
    peakEquityToday: num(inputs.peakEquityToday), dayRealisedPnl: num(inputs.dayRealisedPnl),
    deployed: null, deployedByUnderlying: {}, openPositions: null, lotsByInstrument: {},
    greeks: null, totalRisk: null, riskByExpiry: {}, riskByStrike: {},
    riskMapComplete: false,
    isExpiryDay: typeof inputs.isExpiryDay === 'boolean' ? inputs.isExpiryDay : null,
    minutesToClose: num(inputs.minutesToClose), dataAgeMs: num(inputs.dataAgeMs),
    consecutiveLosses: num(inputs.consecutiveLosses),
    _gaps: gaps,
  };
}

const round2 = (v) => +Number(v).toFixed(2);

module.exports = { buildRiskState };
