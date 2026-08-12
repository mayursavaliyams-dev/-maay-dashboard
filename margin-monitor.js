/* ═══════════════════════════════════════════════════════════════════════════
   margin-monitor — how much margin is used, how much is left, and what the peak
   will be if everything currently working fills.

   THE NUMBER THAT MATTERS IS THE PROJECTED PEAK, NOT THE CURRENT USE

   Current utilisation is history. An account at 60% with three working orders
   that would take it to 95% is already at 95% for every decision purpose — the
   only thing standing between it and a shortfall is that the orders have not
   filled yet, and they were sent because someone wanted them to.

   So `projectedPeak` includes:
     · margin currently blocked
     · the margin of every order still working
     · the margin of any order the risk layer is about to approve

   and the headroom check runs against THAT, which is why a trade can be refused
   here rather than by the broker three seconds later.

   WHY BEING REFUSED BY THE BROKER IS THE FAILURE WORTH AVOIDING
   A broker margin rejection is not a free "no". It arrives after the order has
   been sent, it may arrive after a partial fill on a multi-leg basket, and a
   half-filled hedge is a naked short. Refusing before sending is the difference
   between a decision and an accident.

   FAIL CLOSED
   If utilisation cannot be computed — no funds figure, no broker margin for the
   open book — headroom is `null` and every check against it BLOCKS. An unknown
   headroom is not infinite headroom.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const num = (v) => (v === null || v === undefined || !isFinite(Number(v))) ? null : Number(v);
const r2 = (v, d = 2) => v === null || v === undefined ? null : +Number(v).toFixed(d);

const DEFAULTS = {
  MARGIN_WARN_UTIL_PCT: 70,        // warn
  MARGIN_STOP_ENTRY_UTIL_PCT: 85,  // no new entries
  MARGIN_HARD_UTIL_PCT: 95,        // approaching the broker's limit
  MARGIN_HEADROOM_BUFFER_PCT: 5,   // keep this much of the limit untouched
};

class MarginMonitor {
  /**
   * @param {object} deps
   *   cfg()      returns the thresholds above (from risk-config or its own)
   *   calculator MarginCalculator, for pricing working orders
   *   getFunds() → { available, used, total } from the broker
   */
  constructor(deps = {}) {
    this.cfg = deps.cfg || (() => ({ ...DEFAULTS }));
    this.calc = deps.calculator || null;
    this.getFunds = deps.getFunds || null;
    this.log = deps.log || console;
    this.now = deps.now || (() => Date.now());
    this.onAlert = deps.onAlert || null;
    this._working = new Map();       // orderId → { instruments, margin, at }
    this._lastAlertLevel = null;
    this.history = [];
  }

  /** Register an order that has been sent but not yet filled or cancelled. */
  addWorking(orderId, instruments, margin) {
    this._working.set(orderId, { instruments, margin: num(margin), at: this.now() });
  }
  removeWorking(orderId) { this._working.delete(orderId); }
  workingCount() { return this._working.size; }

  /**
   * The full picture.
   *
   * @param {object} state
   *   totalMargin      the account's margin limit (funds available for margin)
   *   usedMargin       what is blocked right now
   *   pendingMargin    optional, margin of an order about to be approved
   */
  async snapshot(state = {}) {
    const cfg = this.cfg();
    const total = num(state.totalMargin);
    const used = num(state.usedMargin);

    const working = [...this._working.values()];
    const workingKnown = working.every(w => w.margin !== null);
    const workingMargin = workingKnown ? working.reduce((s, w) => s + w.margin, 0) : null;
    const pending = num(state.pendingMargin) ?? 0;

    /* Every derived figure is null the moment any input is. A headroom of
       "total − null" must not become "total". */
    const measurable = total !== null && total > 0 && used !== null;
    const utilPct = measurable ? used / total * 100 : null;
    const headroom = measurable ? total - used : null;

    const projectedPeak = (measurable && workingMargin !== null)
      ? used + workingMargin + pending : null;
    const projectedUtilPct = (projectedPeak !== null && total > 0) ? projectedPeak / total * 100 : null;

    const level = this._level(projectedUtilPct ?? utilPct, cfg);

    const snap = {
      at: new Date(this.now()).toISOString(),
      totalMargin: r2(total), usedMargin: r2(used),
      headroom: r2(headroom),
      utilisationPct: r2(utilPct),

      workingOrders: working.length,
      workingMargin: r2(workingMargin),
      workingMarginKnown: workingKnown,
      pendingMargin: r2(pending),

      projectedPeakMargin: r2(projectedPeak),
      projectedUtilisationPct: r2(projectedUtilPct),
      projectedHeadroom: projectedPeak === null ? null : r2(total - projectedPeak),

      level,
      thresholds: {
        warn: cfg.MARGIN_WARN_UTIL_PCT,
        stopEntries: cfg.MARGIN_STOP_ENTRY_UTIL_PCT,
        hard: cfg.MARGIN_HARD_UTIL_PCT,
      },
      /* Stated, not implied. A caller that sees `measurable: false` and proceeds
         is making a choice; one that sees a plausible-looking zero is not. */
      measurable,
      why: measurable
        ? (workingKnown ? null : 'projected peak is null — at least one working order has no priced margin')
        : 'utilisation is not computable — total margin or used margin is unknown',
    };

    this.history.push({ at: snap.at, util: snap.utilisationPct, projected: snap.projectedUtilisationPct, level });
    if (this.history.length > 2000) this.history.splice(0, this.history.length - 2000);

    this._maybeAlert(snap);
    return snap;
  }

  _level(utilPct, cfg) {
    // Unknown is its own level, and it is not "ok".
    if (utilPct === null) return 'UNKNOWN';
    if (utilPct >= cfg.MARGIN_HARD_UTIL_PCT) return 'HARD';
    if (utilPct >= cfg.MARGIN_STOP_ENTRY_UTIL_PCT) return 'STOP_ENTRIES';
    if (utilPct >= cfg.MARGIN_WARN_UTIL_PCT) return 'WARN';
    return 'OK';
  }

  _maybeAlert(snap) {
    if (snap.level === this._lastAlertLevel) return;
    const prev = this._lastAlertLevel;
    this._lastAlertLevel = snap.level;
    const msg = `[margin] utilisation ${snap.projectedUtilisationPct ?? snap.utilisationPct}% ` +
      `(projected peak ₹${snap.projectedPeakMargin ?? '—'} of ₹${snap.totalMargin ?? '—'}) → ${snap.level}` +
      (prev ? ` (was ${prev})` : '');
    if (snap.level === 'OK') this.log.log(msg);
    else if (snap.level === 'WARN') this.log.warn(msg);
    else this.log.error(msg);
    if (this.onAlert) {
      try { this.onAlert({ level: snap.level, previous: prev, snapshot: snap }); }
      catch (e) { this.log.error(`[margin] alert listener threw (${e.message}) — the level still changed`); }
    }
  }

  /**
   * Would this basket fit?
   *
   * Called by the risk layer BEFORE the order is sent. Returns a block with the
   * numbers, not a boolean, because "blocked" without "by how much" cannot be
   * acted on.
   */
  async wouldFit({ instruments, state = {} }) {
    const cfg = this.cfg();
    const m = this.calc ? await this.calc.requireBroker(instruments) : { ok: false, error: 'no calculator' };
    if (!m.ok || num(m.final) === null) {
      return {
        fits: false, reason: 'MARGIN_UNKNOWN',
        detail: `cannot price this basket with the broker (${m.error || 'no figure'}) — refusing rather than sending an order whose cost is unknown`,
        required: null,
      };
    }
    const snap = await this.snapshot({ ...state, pendingMargin: m.final });
    if (!snap.measurable) {
      return { fits: false, reason: 'UTILISATION_UNKNOWN', detail: snap.why, required: r2(m.final) };
    }
    if (snap.projectedPeakMargin === null) {
      return {
        fits: false, reason: 'PROJECTION_UNKNOWN',
        detail: snap.why || 'projected peak margin could not be computed',
        required: r2(m.final),
      };
    }

    /* The buffer is deliberate. Filling to exactly 100% of the limit leaves
       nothing for the intraday SPAN revisions the exchange issues without
       notice, and a shortfall carries a penalty rather than a rejection. */
    const usableLimit = snap.totalMargin * (1 - cfg.MARGIN_HEADROOM_BUFFER_PCT / 100);
    if (snap.projectedPeakMargin > usableLimit) {
      return {
        fits: false, reason: 'HEADROOM',
        detail: `projected peak ₹${snap.projectedPeakMargin} exceeds the usable limit ₹${r2(usableLimit)} ` +
                `(₹${snap.totalMargin} less a ${cfg.MARGIN_HEADROOM_BUFFER_PCT}% buffer). ` +
                `This basket needs ₹${r2(m.final)}.`,
        required: r2(m.final), projectedPeak: snap.projectedPeakMargin, usableLimit: r2(usableLimit),
      };
    }
    if (snap.level === 'STOP_ENTRIES' || snap.level === 'HARD') {
      return {
        fits: false, reason: snap.level,
        detail: `projected utilisation ${snap.projectedUtilisationPct}% is at or past the ` +
                `${cfg.MARGIN_STOP_ENTRY_UTIL_PCT}% stop-entries threshold`,
        required: r2(m.final), projectedPeak: snap.projectedPeakMargin,
      };
    }
    return {
      fits: true, required: r2(m.final), marginSource: m.source,
      projectedPeak: snap.projectedPeakMargin,
      projectedUtilisationPct: snap.projectedUtilisationPct,
      level: snap.level,
    };
  }
}

module.exports = { MarginMonitor, MARGIN_DEFAULTS: DEFAULTS };
