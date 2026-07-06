// ============================================================================
//  event-risk-filter.js — Scheduled-Event Exclusion Filter
//
//  Deep-research #1 actionable finding (2026-07-06): a short-premium (strangle/condor)
//  edge is real BUT event/vol-spike weeks convert winners into heavy losers. So a
//  VRP-selling bot must BLOCK or DOWNSIZE new premium selling near scheduled high-impact
//  events (RBI MPC, Union Budget, elections, Fed/FOMC, CPI/GDP) and on live vol spikes.
//
//  Sources: Samco (event weeks turn strangles into heavy losses); Bangur JIS 2020 (NIFTY
//  short-strangle edge is real but tail-exposed); India-VIX exposure-limit study.
//  NOTE: the "IV always > RV" assumption was REFUTED in research — this filter is about
//  cutting the tail, not assuming a mechanical premium.
//
//  Pure + unit-tested. The server loads a user-maintained data/event-calendar.json and
//  folds in the LIVE India VIX + the existing news-driven event-risk score, so it works
//  even with an empty calendar. Feeds trade-planner / signal-paper executor (gates SELLING).
// ============================================================================
'use strict';
const SEV = { HIGH: 1.0, MEDIUM: 0.5, LOW: 0.25 };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// whole-day difference between two YYYY-MM-DD strings (b − a), UTC-safe
function daysBetween(aISO, bISO) {
  const a = Date.parse(String(aISO).slice(0, 10) + 'T00:00:00Z');
  const b = Date.parse(String(bISO).slice(0, 10) + 'T00:00:00Z');
  if (!isFinite(a) || !isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

// nearest scheduled event at or after `dateISO`, within `lookahead` days
function nearestEvent(dateISO, calendar, lookahead = 10) {
  let best = null;
  for (const e of (calendar || [])) {
    if (!e || !e.date) continue;
    const d = daysBetween(dateISO, e.date);
    if (d == null || d < 0 || d > lookahead) continue;
    if (!best || d < best.daysAway || (d === best.daysAway && (SEV[e.severity] || 0) > (SEV[best.severity] || 0))) {
      best = { ...e, daysAway: d };
    }
  }
  return best;
}

/**
 * Should we open NEW premium-selling risk today?
 * @param {object} i
 *   dateISO         today (YYYY-MM-DD)
 *   calendar        [{date, type, severity:'HIGH'|'MEDIUM'|'LOW'}]
 *   vix             live India VIX
 *   eventRiskScore  0-100 news/macro event-risk (from eventEngine), optional
 *   cfg overrides:  blockDays, reduceDays, vixBlock, vixReduce, ersBlock, ersReduce
 * @returns { verdict:'BLOCK'|'REDUCE'|'CLEAR', sizeScale, reason, nearestEvent, vix }
 */
function assess(i = {}) {
  const cfg = Object.assign({ blockDays: 1, reduceDays: 3, vixBlock: 22, vixReduce: 18, ersBlock: 70, ersReduce: 50, lookahead: 10 }, i.cfg || {});
  const ev = nearestEvent(i.dateISO, i.calendar, cfg.lookahead);
  const vix = Number(i.vix) || 0;
  const ers = i.eventRiskScore != null ? Number(i.eventRiskScore) : null;

  const reasons = [];
  let block = false, reduce = false;

  // 1) scheduled calendar event proximity
  if (ev) {
    const sev = SEV[ev.severity] || SEV.MEDIUM;
    if (ev.daysAway <= cfg.blockDays && sev >= SEV.HIGH) { block = true; reasons.push(`${ev.type} in ${ev.daysAway}d (HIGH-impact)`); }
    else if (ev.daysAway <= cfg.reduceDays) { reduce = true; reasons.push(`${ev.type} in ${ev.daysAway}d`); }
  }
  // 2) live vol spike (India VIX)
  if (vix >= cfg.vixBlock) { block = true; reasons.push(`VIX ${vix} ≥ ${cfg.vixBlock} — vol spike`); }
  else if (vix >= cfg.vixReduce) { reduce = true; reasons.push(`VIX ${vix} elevated`); }
  // 3) live news/macro event-risk score (works even with an empty calendar)
  if (ers != null) {
    if (ers >= cfg.ersBlock) { block = true; reasons.push(`event-risk ${ers} ≥ ${cfg.ersBlock}`); }
    else if (ers >= cfg.ersReduce) { reduce = true; reasons.push(`event-risk ${ers} elevated`); }
  }

  const verdict = block ? 'BLOCK' : reduce ? 'REDUCE' : 'CLEAR';
  const sizeScale = block ? 0 : reduce ? 0.5 : 1;
  return {
    verdict, sizeScale: clamp(sizeScale, 0, 1),
    reason: reasons.join(' · ') || 'no scheduled event · calm vol',
    nearestEvent: ev || null, vix: vix || null, eventRiskScore: ers,
    note: 'Gates NEW premium selling only — cuts event/vol-spike tail risk (research #1). Defined-risk debit legs are unaffected.',
  };
}

// Load a user-maintained calendar from JSON (via injected fs); tolerant of a missing file.
function loadCalendar(fs, path) {
  try { const j = JSON.parse(fs.readFileSync(path, 'utf8')); return Array.isArray(j) ? j : (Array.isArray(j.events) ? j.events : []); }
  catch (_) { return []; }
}

module.exports = { assess, nearestEvent, daysBetween, loadCalendar, SEV };
