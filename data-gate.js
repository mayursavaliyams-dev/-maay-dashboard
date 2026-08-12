/* ═══════════════════════════════════════════════════════════════════════════
   data-gate — the thing that says no when the data cannot be trusted.

   It sits in front of every trading decision and answers one question per
   request: may this strategy act on this instrument, right now, given the state
   of the feed? It never repairs data, never fills a gap, and never returns a
   permissive answer it could not justify.

   THE OUTAGE POLICY IS DECLARED, NOT DISCOVERED

   `DQ_OUTAGE_POLICY` is either `HOLD` or `FLATTEN`, and there is deliberately no
   third value meaning "whatever the code happens to do". The default is `HOLD`:

     · HOLD    — no new entries; existing positions keep their stops and targets.
     · FLATTEN — close everything now.

   HOLD is the default because flattening during a feed outage means sending
   exit orders priced from data that has just been declared untrustworthy. That
   may still be the right choice for a short-gamma book near expiry — which is
   why it is configurable and why the choice is written down rather than
   inherited from whatever a catch block did.

   OBSERVABLE IN REAL TIME
   `status()` is the live view and `gatedPeriods()` accumulates through the
   session. The scorecard at the end of the day is a summary of what was already
   visible, not the first time anyone could see it.

   THE RULE THAT OVERRIDES EVERY OTHER
   Uncertainty means no. Not "probably fine", not the last known good value, not
   zero. Every accessor here returns `allowed: false` when it cannot establish
   otherwise, and the reason says which fact was missing.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const DEFAULTS = {
  DQ_GATE_ENABLED: true,
  DQ_BLOCK_ON_STALE: true,
  DQ_BLOCK_ON_FLAGS: true,
  DQ_REQUIRE_FULL_COVERAGE: true,   // a strategy needs ALL of its instruments
  DQ_MIN_STRATEGY_COVERAGE_PCT: 100,
  DQ_OUTAGE_POLICY: 'HOLD',         // HOLD | FLATTEN
};

const r2 = (v, d = 2) => v === null || v === undefined ? null : +Number(v).toFixed(d);

class DataGate {
  constructor(deps = {}) {
    this.cfg = deps.cfg || (() => ({ ...DEFAULTS }));
    this.dq = deps.dataQuality;
    this.feed = deps.feedHealth;
    this.now = deps.now || (() => Date.now());
    this.log = deps.log || console;
    if (!this.dq || !this.feed) {
      // A gate missing either half would answer "allowed" to everything.
      throw new Error('data-gate: needs both a dataQuality tracker and a feedHealth monitor — a half-built gate is an open one');
    }
    this._gated = [];        // { from, to, scope, reason }
    this._open = new Map();  // scope -> open period
    this.decisions = { allowed: 0, blocked: 0, byReason: {} };
  }

  _openPeriod(scope, reason) {
    if (this._open.has(scope)) return;
    const p = { scope, reason, from: new Date(this.now()).toISOString(), fromMs: this.now(), to: null, durationMs: null };
    this._open.set(scope, p);
    this.log.warn(`[gate] ${scope} GATED — ${reason}`);
  }
  _closePeriod(scope) {
    const p = this._open.get(scope);
    if (!p) return;
    p.to = new Date(this.now()).toISOString();
    p.durationMs = this.now() - p.fromMs;
    this._gated.push(p);
    this._open.delete(scope);
    this.log.log(`[gate] ${scope} released after ${p.durationMs} ms`);
  }

  _record(allowed, reason) {
    if (allowed) this.decisions.allowed++;
    else {
      this.decisions.blocked++;
      this.decisions.byReason[reason] = (this.decisions.byReason[reason] || 0) + 1;
    }
  }

  /**
   * May we act on this instrument?
   *
   * @param key      instrument key
   * @param opts     { needsOi, strategy }
   * @returns {{ allowed, reason, detail, assessment }}
   */
  checkInstrument(key, opts = {}) {
    const cfg = this.cfg();
    if (!cfg.DQ_GATE_ENABLED) {
      // Recorded rather than silent: a disabled gate is a decision, and it
      // belongs beside the trades it let through.
      this._record(true, 'GATE_DISABLED');
      return { allowed: true, reason: 'GATE_DISABLED', detail: 'the data gate is switched off', assessment: null };
    }

    const feed = this.feed.status();
    if (feed.outage) {
      this._openPeriod('FEED', `feed outage — policy ${cfg.DQ_OUTAGE_POLICY}`);
      this._record(false, 'FEED_OUTAGE');
      return {
        allowed: false, reason: 'FEED_OUTAGE',
        detail: `the feed is in outage (${feed.openOutage ? feed.openOutage.reason : 'no recent successful poll'}). ` +
                `Declared policy: ${cfg.DQ_OUTAGE_POLICY}.`,
        outagePolicy: cfg.DQ_OUTAGE_POLICY,
        requiresFlatten: cfg.DQ_OUTAGE_POLICY === 'FLATTEN',
        assessment: null,
      };
    }
    this._closePeriod('FEED');

    const a = this.dq.assess(key, { needsOi: !!opts.needsOi });

    if (!a.trustworthy) {
      /* Switched on CODES, never on the prose. The first version of this matched
         a regular expression against the human-readable reason, and
         "no snapshot has ever been received" did not match /never been received/
         — so an instrument that had never ticked at all was ALLOWED. The test
         caught it; the lesson is that a gate must not parse its own error
         messages. */
      const codes = a.codes || [];
      const stale = codes.includes('STALE_PRICE') || codes.includes('NEVER_SEEN') || codes.includes('STALE_OI');
      const flagged = codes.includes('FLAGGED') || a.recentFlags.length > 0;
      if ((stale && cfg.DQ_BLOCK_ON_STALE) || (flagged && cfg.DQ_BLOCK_ON_FLAGS)) {
        const reason = flagged ? 'DATA_FLAGGED' : 'DATA_STALE';
        this._openPeriod(`INSTRUMENT:${key}`, a.reasons[0]);
        this._record(false, reason);
        return { allowed: false, reason, detail: a.reasons.join(' · '), assessment: a };
      }
    }
    this._closePeriod(`INSTRUMENT:${key}`);
    this._record(true, 'OK');
    return { allowed: true, reason: 'OK', detail: null, assessment: a };
  }

  /**
   * May this strategy run at all?
   *
   * A strategy whose required instruments are not all trustworthy is blocked as
   * a whole, because a strangle priced off one good leg and one stale one is not
   * a strangle — it is a naked short with a decoration.
   */
  checkStrategy(strategy, requiredKeys, opts = {}) {
    const cfg = this.cfg();
    if (!cfg.DQ_GATE_ENABLED) {
      this._record(true, 'GATE_DISABLED');
      return { allowed: true, reason: 'GATE_DISABLED', instruments: [] };
    }
    if (!Array.isArray(requiredKeys) || !requiredKeys.length) {
      this._record(false, 'NO_REQUIREMENTS');
      return {
        allowed: false, reason: 'NO_REQUIREMENTS',
        detail: `${strategy} declared no required instruments — a strategy whose data needs are unknown cannot be cleared`,
        instruments: [],
      };
    }

    const results = requiredKeys.map(k => ({ key: k, ...this.checkInstrument(k, opts) }));
    const good = results.filter(r => r.allowed).length;
    const pct = good / results.length * 100;

    const outage = results.find(r => r.reason === 'FEED_OUTAGE');
    if (outage) {
      return { allowed: false, reason: 'FEED_OUTAGE', detail: outage.detail,
        outagePolicy: outage.outagePolicy, requiresFlatten: outage.requiresFlatten, instruments: results };
    }

    const need = cfg.DQ_REQUIRE_FULL_COVERAGE ? 100 : cfg.DQ_MIN_STRATEGY_COVERAGE_PCT;
    if (pct < need) {
      this._openPeriod(`STRATEGY:${strategy}`, `coverage ${r2(pct)}% of required instruments`);
      return {
        allowed: false, reason: 'INCOMPLETE_COVERAGE',
        detail: `${strategy}: ${good} of ${results.length} required instruments are trustworthy (${r2(pct)}%, need ${need}%). ` +
                `Blocked: ${results.filter(r => !r.allowed).map(r => r.key).join(', ')}`,
        coveragePct: r2(pct), instruments: results,
      };
    }
    this._closePeriod(`STRATEGY:${strategy}`);
    return { allowed: true, reason: 'OK', coveragePct: r2(pct), instruments: results };
  }

  /** What the outage policy says to do with EXISTING positions. */
  outageAction() {
    const cfg = this.cfg();
    const feed = this.feed.status();
    if (!feed.outage) return { inOutage: false, action: 'NONE' };
    return {
      inOutage: true,
      action: cfg.DQ_OUTAGE_POLICY,
      detail: cfg.DQ_OUTAGE_POLICY === 'FLATTEN'
        ? 'Declared policy is FLATTEN: close everything. Note that exit orders will be priced from data just declared untrustworthy.'
        : 'Declared policy is HOLD: no new entries; existing positions keep their stops and targets.',
      since: feed.openOutage ? feed.openOutage.from : null,
    };
  }

  /** Live view — the gate is observable now, not only at end of day. */
  status() {
    return {
      at: new Date(this.now()).toISOString(),
      enabled: this.cfg().DQ_GATE_ENABLED,
      outagePolicy: this.cfg().DQ_OUTAGE_POLICY,
      feed: this.feed.status(),
      data: this.dq.stats(),
      decisions: { ...this.decisions, byReason: { ...this.decisions.byReason } },
      currentlyGated: [...this._open.values()].map(p => ({ scope: p.scope, reason: p.reason, since: p.from, forMs: this.now() - p.fromMs })),
    };
  }

  gatedPeriods() {
    const open = [...this._open.values()].map(p => ({ ...p, to: null, durationMs: this.now() - p.fromMs, stillOpen: true }));
    return [...this._gated, ...open];
  }

  /**
   * The daily scorecard.
   *
   * Every figure is either measured or explicitly null. There is no section that
   * reports a default when the underlying fact is unavailable — a scorecard that
   * fills its own gaps is the same failure as a feed that does.
   */
  scorecard() {
    const feed = this.feed.status();
    const data = this.dq.stats();
    const periods = this.gatedPeriods();
    const total = this.decisions.allowed + this.decisions.blocked;

    return {
      generatedAt: new Date(this.now()).toISOString(),

      coverage: {
        expected: feed.coverage.expected,
        ticking: feed.coverage.ticking,
        stale: feed.coverage.stale,
        neverSeen: feed.coverage.unseen,
        pct: feed.coverage.pct,
        note: feed.coverage.why || null,
      },

      staleness: {
        instrumentsTracked: data.instruments,
        stale: data.stale, fresh: data.fresh,
        // Counted separately and deliberately: an instrument whose freshness
        // cannot be decided is neither fresh nor stale, and merging it into
        // either number is the quiet lie this whole module exists to prevent.
        undecidable: data.undecidable,
        oiStale: data.oiStale,
      },

      flags: {
        total: data.totalFlags,
        byType: data.flagsByType,
        ratePerInstrument: data.instruments ? r2(data.totalFlags / data.instruments, 3) : null,
      },

      connection: {
        uptimeMs: feed.uptimeMs,
        polls: feed.polls,
        pollSuccessPct: feed.pollSuccessPct,
        cadence: feed.cadence,
        outages: feed.pastOutages.length + (feed.openOutage ? 1 : 0),
        outageDetail: feed.pastOutages,
        // The honest section, rather than a fabricated 100%.
        websocket: feed.websocket,
      },

      gating: {
        decisions: total,
        allowed: this.decisions.allowed,
        blocked: this.decisions.blocked,
        blockedPct: total ? r2(this.decisions.blocked / total * 100) : null,
        byReason: { ...this.decisions.byReason },
        periods: periods.map(p => ({ scope: p.scope, reason: p.reason, from: p.from, to: p.to, durationMs: p.durationMs, stillOpen: !!p.stillOpen })),
        totalGatedMs: periods.reduce((s, p) => s + (p.durationMs || 0), 0),
      },

      policy: { outage: this.cfg().DQ_OUTAGE_POLICY },
    };
  }
}

module.exports = { DataGate, GATE_DEFAULTS: DEFAULTS };
