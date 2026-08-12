/* ═══════════════════════════════════════════════════════════════════════════
   feed-health — the health of the feed this system actually has.

   AN HONEST NOTE ABOUT WEBSOCKETS, BECAUSE THE REQUIREMENT ASKS FOR THEM

   The requirement asks for websocket uptime, reconnect count and confirmed-vs-
   intended subscription counts. On the LIVE path none of those exist:

     · `server.js` constructs an UpstoxConnector; the option chain is obtained by
       POLLED REST with an adaptive interval (CHAIN_CACHE_MS, default 2,500 ms).
     · `dhan-ws-feed.js` is a real websocket client, but it belongs to the Dhan
       connector, which is not the live one.
     · The repo's own module-contract test already records: *"no WebSocket server
       exists; `ws` is used only as a broker client in dhan-ws-feed"*.

   So websocket metrics are reported as **NOT_APPLICABLE**, with the reason,
   rather than as `uptime: 100%`. Reporting perfect uptime for a connection that
   does not exist is precisely the fabrication the rest of this gate forbids —
   and it would be the most convincing number on the whole scorecard.

   What IS measured, because it is what the live feed does:
     · poll success rate and consecutive failures
     · interval adherence — is the poller keeping to its own cadence?
     · COVERAGE: instruments ticking ÷ instruments expected
     · outage detection and duration

   Coverage is the number that matters. A feed can be "connected" and returning
   200s while half the chain has stopped updating, and only coverage sees that.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const num = (v) => (v === null || v === undefined || !isFinite(Number(v))) ? null : Number(v);
const r2 = (v, d = 2) => v === null || v === undefined ? null : +Number(v).toFixed(d);

const DEFAULTS = {
  FEED_MIN_COVERAGE_PCT: 80,        // below this, coverage is degraded
  FEED_CRITICAL_COVERAGE_PCT: 50,   // below this, it is an outage in all but name
  FEED_OUTAGE_AFTER_MS: 30000,      // no successful poll for this long = outage
  FEED_MAX_CONSECUTIVE_FAILURES: 5,
  FEED_INTERVAL_TOLERANCE: 3,       // a poll gap this many × the target is a miss
  FEED_WINDOW: 100,                 // polls kept for the rate calculations
};

class FeedHealth {
  /**
   * @param deps
   *   dataQuality  a DataQuality instance — coverage is derived from it
   *   cfg, now, log, onAlert
   */
  constructor(deps = {}) {
    this.cfg = { ...DEFAULTS, ...(deps.cfg || {}) };
    this.dq = deps.dataQuality || null;
    this.now = deps.now || (() => Date.now());
    this.log = deps.log || console;
    this.onAlert = deps.onAlert || null;

    this.startedAt = this.now();
    this.polls = [];                 // { at, ok, ms, count }
    this.consecutiveFailures = 0;
    this.lastSuccessAt = null;
    this.expected = new Set();       // instruments we intend to have
    this.outages = [];               // { from, to, reason }
    this._outageOpen = null;
    this._lastLevel = null;
  }

  /** Declare what the system intends to be watching. */
  expectInstruments(keys) {
    this.expected = new Set(keys || []);
  }

  /**
   * Record one poll cycle.
   * @param {object} r { ok, instrumentsReturned, targetIntervalMs, error }
   */
  notePoll(r = {}) {
    const now = this.now();
    const prev = this.polls[this.polls.length - 1];
    const gap = prev ? now - prev.at : null;

    const entry = {
      at: now, ok: !!r.ok,
      count: num(r.instrumentsReturned),
      gapMs: gap,
      target: num(r.targetIntervalMs),
      error: r.ok ? null : (r.error || 'unknown'),
    };
    this.polls.push(entry);
    if (this.polls.length > this.cfg.FEED_WINDOW) this.polls.splice(0, this.polls.length - this.cfg.FEED_WINDOW);

    if (r.ok) {
      this.consecutiveFailures = 0;
      this.lastSuccessAt = now;
      if (this._outageOpen) {
        this._outageOpen.to = new Date(now).toISOString();
        this._outageOpen.durationMs = now - this._outageOpen.fromMs;
        this.outages.push(this._outageOpen);
        this.log.warn(`[feed] recovered after ${this._outageOpen.durationMs} ms (${this._outageOpen.reason})`);
        this._outageOpen = null;
      }
    } else {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= this.cfg.FEED_MAX_CONSECUTIVE_FAILURES && !this._outageOpen) {
        this._openOutage(`${this.consecutiveFailures} consecutive poll failures: ${entry.error}`);
      }
    }
    return entry;
  }

  _openOutage(reason) {
    const now = this.now();
    this._outageOpen = { from: new Date(now).toISOString(), fromMs: now, to: null, durationMs: null, reason };
    this.log.error(`[feed] OUTAGE — ${reason}`);
  }

  /**
   * Coverage: how many of the instruments we expect are actually ticking.
   *
   * Returns null rather than 0 when nothing is expected. "We are watching
   * nothing and all of it is fine" is not a health report.
   */
  coverage() {
    if (!this.expected.size) {
      return { expected: 0, ticking: null, stale: null, unseen: null, pct: null,
        why: 'no instruments declared — coverage is undefined, not 100%' };
    }
    if (!this.dq) {
      return { expected: this.expected.size, ticking: null, pct: null,
        why: 'no data-quality tracker attached — coverage cannot be computed' };
    }
    let ticking = 0, stale = 0, unseen = 0;
    for (const key of this.expected) {
      const a = this.dq.assess(key);
      if (!a.freshness || a.freshness.priceStale === null) unseen++;
      else if (a.freshness.priceStale) stale++;
      else ticking++;
    }
    return {
      expected: this.expected.size, ticking, stale, unseen,
      pct: r2(ticking / this.expected.size * 100),
    };
  }

  /** Poll-cadence adherence: is the poller keeping to its own schedule? */
  cadence() {
    const withGap = this.polls.filter(p => p.gapMs !== null && p.target !== null);
    if (!withGap.length) return { samples: 0, medianGapMs: null, misses: null, why: 'no paired polls yet' };
    const gaps = withGap.map(p => p.gapMs).sort((a, b) => a - b);
    const m = gaps.length % 2 ? gaps[gaps.length >> 1] : (gaps[(gaps.length >> 1) - 1] + gaps[gaps.length >> 1]) / 2;
    const misses = withGap.filter(p => p.gapMs > p.target * this.cfg.FEED_INTERVAL_TOLERANCE).length;
    return {
      samples: withGap.length, medianGapMs: r2(m, 0), misses,
      missRatePct: r2(misses / withGap.length * 100),
    };
  }

  /** The whole picture. */
  status() {
    const now = this.now();
    const cov = this.coverage();
    const ok = this.polls.filter(p => p.ok).length;
    const successPct = this.polls.length ? r2(ok / this.polls.length * 100) : null;
    const sinceSuccess = this.lastSuccessAt === null ? null : now - this.lastSuccessAt;

    const outage = this._outageOpen !== null ||
      (sinceSuccess !== null && sinceSuccess > this.cfg.FEED_OUTAGE_AFTER_MS) ||
      // Never having succeeded is an outage, not a blank slate.
      (this.lastSuccessAt === null && this.polls.length > 0);

    if (outage && !this._outageOpen) {
      this._openOutage(sinceSuccess === null
        ? 'no poll has ever succeeded'
        : `no successful poll for ${sinceSuccess} ms`);
    }

    let level;
    if (outage) level = 'OUTAGE';
    else if (cov.pct === null) level = 'UNKNOWN';
    else if (cov.pct < this.cfg.FEED_CRITICAL_COVERAGE_PCT) level = 'CRITICAL';
    else if (cov.pct < this.cfg.FEED_MIN_COVERAGE_PCT) level = 'DEGRADED';
    else level = 'OK';

    const s = {
      at: new Date(now).toISOString(),
      level,
      uptimeMs: now - this.startedAt,
      polls: this.polls.length,
      pollSuccessPct: successPct,
      consecutiveFailures: this.consecutiveFailures,
      msSinceLastSuccess: sinceSuccess,
      outage,
      openOutage: this._outageOpen,
      pastOutages: this.outages.slice(-20),
      coverage: cov,
      cadence: this.cadence(),

      /* Reported, not omitted, and reported as NOT_APPLICABLE rather than as a
         flattering number. Omitting it would leave a reader assuming it was
         checked and fine. */
      websocket: {
        applicable: false,
        state: 'NOT_APPLICABLE',
        why: 'the live path (UpstoxConnector) polls REST; the websocket client in dhan-ws-feed.js belongs to the inactive Dhan connector',
        uptimePct: null, reconnects: null,
        subscriptionsIntended: null, subscriptionsConfirmed: null,
      },
      thresholds: {
        minCoveragePct: this.cfg.FEED_MIN_COVERAGE_PCT,
        criticalCoveragePct: this.cfg.FEED_CRITICAL_COVERAGE_PCT,
        outageAfterMs: this.cfg.FEED_OUTAGE_AFTER_MS,
      },
    };

    if (level !== this._lastLevel) {
      const prev = this._lastLevel; this._lastLevel = level;
      const msg = `[feed] ${prev ? prev + ' → ' : ''}${level} · coverage ${cov.pct ?? '—'}% (${cov.ticking ?? '—'}/${cov.expected})`;
      if (level === 'OK') this.log.log(msg); else this.log.error(msg);
      if (this.onAlert) {
        try { this.onAlert({ level, previous: prev, status: s }); }
        catch (e) { this.log.error(`[feed] alert listener threw (${e.message}) — the level still changed`); }
      }
    }
    return s;
  }
}

module.exports = { FeedHealth, FEED_DEFAULTS: DEFAULTS };
