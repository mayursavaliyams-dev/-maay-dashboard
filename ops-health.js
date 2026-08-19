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

  // FeedHealth already distinguishes an actual failed market-time poll from an
  // ordinary after-hours pause. Surface that distinction beside the engines so
  // the operator does not need to inspect a second endpoint during an incident.
  const dataQuality = safe(() => deps.dataQuality && deps.dataQuality(), null);
  const feed = dataQuality && dataQuality.feed ? dataQuality.feed : null;
  s.dataFeed = feed ? {
    level: feed.level || null,
    msSinceLastSuccess: feed.msSinceLastSuccess ?? null,
    outage: !!feed.outage,
  } : null;
  const marketOpen = s.market === 'MARKET_OPEN';
  add('market data feed fresh', !feed || !marketOpen || feed.level !== 'OUTAGE',
    !feed ? 'n/a' : marketOpen ? `${feed.level || 'UNKNOWN'}; last success ${Math.round((feed.msSinceLastSuccess || 0) / 1000)}s ago`
      : `market closed; feed ${feed.level || 'UNKNOWN'} is not actionable`);

  // The warehouse-capture heartbeat carries its own promised cadence, so its
  // age is judged against 300s rather than the server's much shorter heartbeat.
  const heartbeat = safe(() => deps.heartbeat && deps.heartbeat(), null);
  s.heartbeat = heartbeat ? heartbeat.summary : null;
  add('component heartbeats', !heartbeat || heartbeat.healthy === true,
    !heartbeat ? 'n/a' : heartbeat.healthy ? `${heartbeat.summary.alive}/${heartbeat.summary.total} alive`
      : `${heartbeat.summary.stale} stale, ${heartbeat.summary.never} never started`);

  const ft = safe(() => deps.forwardTest && deps.forwardTest(), null);
  s.forwardTest = ft ? { verdict: ft.verdict, trades: ft.metrics && ft.metrics.trades } : null;
  add('forward-test not failing', !ft || ft.verdict !== 'FAIL', ft ? ft.verdict : 'n/a');

  const sp = safe(() => deps.signalPaper && deps.signalPaper(), null);
  s.signalPaper = sp ? { enabled: !!sp.enabled, open: (sp.open || []).length, netPnl: sp.allTime && sp.allTime.netPnl } : null;

  s.engines = safe(() => deps.engines && deps.engines(), null);   // [{label, enabled, netPnl, ...}]

  // overall verdict — ATTENTION if any hard signal is bad, else OK
  const attention = s.checks.some(c => !c.ok);
  s.overall = attention ? 'ATTENTION' : 'OK';
  s.reason = attention
    ? s.checks.filter(c => !c.ok).map(c => c.name).join('; ') || 'a monitored check needs attention'
    : 'all monitored checks within tolerance';
  return s;
}

module.exports = { opsHealthSnapshot };
