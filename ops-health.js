// ============================================================================
//  ops-health.js — #6 Server Refactor Phase 1: consolidated ops health (foundation)
//
//  First step in splitting the 200KB+ server monolith: extract the "is the bot healthy?"
//  aggregation into a pure, testable module. The server passes live engine handles as
//  deps; this returns ONE snapshot for an ops view. Purely additive — existing routes are
//  untouched, so there is no risk to the running forward-test.
// ============================================================================
'use strict';

// Build a single ops-health snapshot. Every dep is optional and wrapped so one bad
// source can't break the whole snapshot.
function opsHealthSnapshot(deps = {}, nowMs = 0) {
  const s = { checks: [] };
  const safe = (fn, fallback = null) => { try { return fn(); } catch (_) { return fallback; } };
  const add = (name, ok, detail) => s.checks.push({ name, ok: !!ok, detail });

  s.uptimeSec = deps.bootAt ? Math.max(0, Math.round((nowMs - deps.bootAt) / 1000)) : null;
  s.market = safe(() => deps.getMarketSession && deps.getMarketSession().status, null);

  const health = safe(() => deps.signalHealth && deps.signalHealth(), null);
  s.signalHealth = health ? health.status : null;
  add('signal-health not degraded', s.signalHealth !== 'DEGRADED', s.signalHealth || 'n/a');

  const ft = safe(() => deps.forwardTest && deps.forwardTest(), null);
  s.forwardTest = ft ? { verdict: ft.verdict, trades: ft.metrics && ft.metrics.trades } : null;
  add('forward-test not failing', !ft || ft.verdict !== 'FAIL', ft ? ft.verdict : 'n/a');

  const sp = safe(() => deps.signalPaper && deps.signalPaper(), null);
  s.signalPaper = sp ? { enabled: !!sp.enabled, open: (sp.open || []).length, netPnl: sp.allTime && sp.allTime.netPnl } : null;

  s.engines = safe(() => deps.engines && deps.engines(), null);   // [{label, enabled, netPnl, ...}]

  // overall verdict — ATTENTION if any hard signal is bad, else OK
  const attention = s.signalHealth === 'DEGRADED' || (s.forwardTest && s.forwardTest.verdict === 'FAIL');
  s.overall = attention ? 'ATTENTION' : 'OK';
  s.reason = attention
    ? s.checks.filter(c => !c.ok).map(c => c.name).join('; ') || 'a monitored check needs attention'
    : 'all monitored checks within tolerance';
  return s;
}

module.exports = { opsHealthSnapshot };
