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

  // `Number(i.vix) || 0` mapped null, undefined, NaN and 0 all onto 0 — and 0 is below every
  // threshold, so an UNREACHABLE volatility reading scored exactly like a CALM one. The upstream
  // source is `eventEngine.getVix()`, a network call to Yahoo wrapped in a silent catch: when it
  // fails, `vix` becomes null and this gate silently stopped gating. India VIX is never 0, so a
  // zero here means "no reading", not "no volatility". Unknown is not zero.
  const vixNum = Number(i.vix);
  const vixKnown = Number.isFinite(vixNum) && vixNum > 0;
  const vix = vixKnown ? vixNum : null;

  const ers = i.eventRiskScore != null ? Number(i.eventRiskScore) : null;

  const reasons = [];
  let block = false, reduce = false;

  // 1) scheduled calendar event proximity
  if (ev) {
    const sev = SEV[ev.severity] || SEV.MEDIUM;
    if (ev.daysAway <= cfg.blockDays && sev >= SEV.HIGH) { block = true; reasons.push(`${ev.type} in ${ev.daysAway}d (HIGH-impact)`); }
    else if (ev.daysAway <= cfg.reduceDays) { reduce = true; reasons.push(`${ev.type} in ${ev.daysAway}d`); }
  }
  // 2) live vol spike (India VIX). An absent reading REDUCES rather than clears: we are selling
  //    premium into volatility we cannot see. Same fail-closed policy as an unreadable calendar.
  if (!vixKnown) { reduce = true; reasons.push('India VIX unavailable — volatility unknown'); }
  else if (vix >= cfg.vixBlock) { block = true; reasons.push(`VIX ${vix} ≥ ${cfg.vixBlock} — vol spike`); }
  else if (vix >= cfg.vixReduce) { reduce = true; reasons.push(`VIX ${vix} elevated`); }
  // 3) live news/macro event-risk score (works even with an empty calendar)
  if (ers != null) {
    if (ers >= cfg.ersBlock) { block = true; reasons.push(`event-risk ${ers} ≥ ${cfg.ersBlock}`); }
    else if (ers >= cfg.ersReduce) { reduce = true; reasons.push(`event-risk ${ers} elevated`); }
  }

  // 4) THE CALENDAR ITSELF IS EVIDENCE. If it could not be read, we do not know what is ahead.
  //    An unreadable calendar must never be indistinguishable from an empty one: empty means
  //    "checked, nothing scheduled"; unreadable means "could not check". Size is halved and the
  //    reason is stated. `calendarCorrupt` is surfaced so a caller can escalate to BLOCK.
  const calCorrupt = i.calendar && i.calendar.corrupt ? i.calendar.corrupt : null;
  if (calCorrupt) { reduce = true; reasons.push(`event calendar unreadable (${calCorrupt}) — risk unknown`); }

  const verdict = block ? 'BLOCK' : reduce ? 'REDUCE' : 'CLEAR';
  const sizeScale = block ? 0 : reduce ? 0.5 : 1;
  return {
    verdict, sizeScale: clamp(sizeScale, 0, 1),
    reason: reasons.join(' · ') || 'no scheduled event · calm vol',
    calendarCorrupt: calCorrupt,
    vixUnknown: !vixKnown,
    nearestEvent: ev || null, vix, eventRiskScore: ers,
    note: 'Gates NEW premium selling only — cuts event/vol-spike tail risk (research #1). Defined-risk debit legs are unaffected.',
  };
}

const _realFs = require('fs');
const _isRealFs = (f) => f === _realFs;

/**
 * Load a user-maintained calendar from JSON.
 *
 * A MISSING calendar and a CORRUPT one are not the same thing, and the old code treated them
 * identically: `catch (_) { return [] }`. An empty calendar means "no scheduled events, trade on".
 * So a truncated JSON file — the exact thing a crash mid-write produces — silently disarmed the
 * event-risk filter, and it did so on the days that matter: RBI policy, budget, expiry-week CPI.
 * **Unknown is not zero.** This is the same fail-open shape as the equity-file bug in C3-07.
 *
 * `loadCalendar` cannot throw: its only caller is `server.js:5815`, at module scope, in a
 * PROTECTED file. Throwing would turn a bad calendar into a boot failure. So the corruption
 * rides along on the returned array as a NON-ENUMERABLE flag — invisible to JSON, to `length`,
 * and to every existing consumer — and `assess()` reads it and refuses to trade normally.
 */
function loadCalendar(fs, path) {
  const corrupt = (reason) => {
    console.error(`[event-risk-filter] CALENDAR UNREADABLE: ${reason}`);
    console.error('[event-risk-filter] Cannot know what events are ahead — assessing as ELEVATED RISK ' +
      '(fail closed). Fix or delete the file; a MISSING calendar is treated as "no events".');
    const arr = [];
    Object.defineProperty(arr, 'corrupt', { value: reason, enumerable: false });
    return arr;
  };

  // ABSENT vs CORRUPT is decided by the error, not by `existsSync`. Callers inject a fake `fs`
  // that implements `readFileSync` and nothing else; demanding `existsSync` would break every
  // one of them. A missing file raises ENOENT; anything else is a file we could not understand.
  const isMissing = (e) => e && (e.code === 'ENOENT' || /ENOENT|no such file/i.test(e.message || ''));

  let j;
  if (_isRealFs(fs)) {
    // recover from .bak, and if that fails too, say so rather than guess
    try {
      j = require('./safe-write.js').readJsonSync(path, {
        onRecover: (reason, bak) => console.warn(`[event-risk-filter] calendar was corrupt (${reason}); recovered from ${bak}.`),
      });
    } catch (e) {
      if (isMissing(e)) return [];            // absent ⇒ genuinely no scheduled events
      return corrupt(e.message);
    }
  } else {
    try { j = JSON.parse(fs.readFileSync(path, 'utf8')); }   // injected fake: no .bak to recover from
    catch (e) {
      if (isMissing(e)) return [];
      return corrupt(e.message);
    }
  }
  if (j === undefined || j === null) return [];              // safe-write's fallback for a missing file

  if (Array.isArray(j)) return j;
  if (j && Array.isArray(j.events)) return j.events;
  return corrupt('calendar is neither an array nor { events: [...] }');
}

module.exports = { assess, nearestEvent, daysBetween, loadCalendar, SEV };
