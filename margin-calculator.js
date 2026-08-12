/* ═══════════════════════════════════════════════════════════════════════════
   margin-calculator — the broker is the source of truth. Everything else is a
   cache that has to prove itself.

   WHY THIS FILE IS NOT A FORMULA

   `position-sizer.js` currently sizes strangles against this:

       marginPerLotStrangle: parseFloat(process.env.SIZER_STRANGLE_MARGIN || 130000)

   Measured against the live broker on 2026-07-30, NIFTY 2026-08-04 expiry, one
   lot per leg:

       naked short strangle 23900P / 24700C   →  final margin ₹1,80,959
       the assumption                          →              ₹1,30,000

   **The assumption is 28% low, so a sizer using it takes about 1.4× the lots the
   account can actually carry.** That is not a rounding difference; it is the
   difference between a position that fits and a margin call.

   Exchange SPAN parameters change — sometimes intraday, always without notice.
   Any local number is therefore a CACHE, and this module labels it as one:

       source: 'broker'    the exchange's own calculator answered
       source: 'cache'     a previous broker answer, still inside its TTL
       source: 'estimate'  a local approximation, NEVER VALIDATED
       source: null        we do not know, and nothing may proceed on it

   A caller that treats 'estimate' as 'broker' is the bug this module exists to
   make impossible: `requireBroker()` returns only the first two, and the risk
   layer uses that one.

   RECONCILIATION IS THE POINT OF THE LEDGER
   Every estimate is written down beside the broker figure that later replaced
   it, so the estimator's error is a measured quantity rather than a hope. An
   estimator nobody scores is an assumption with a nicer name.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const { writeJsonSync, readJsonSync } = require('./safe-write');

const LEDGER = path.join(__dirname, 'data', 'margin-reconciliation.json');

const num = (v) => (v === null || v === undefined || !isFinite(Number(v))) ? null : Number(v);
const r2 = (v, d = 2) => v === null || v === undefined ? null : +Number(v).toFixed(d);

/* A basket's identity for caching. Sorted, so the same basket in a different
   order is the same key — otherwise a strangle priced PE-first and CE-first
   would occupy two cache slots and halve the hit rate. */
function basketKey(instruments) {
  return (instruments || [])
    .map(i => `${i.instrument_key || i.instrumentKey}|${String(i.transaction_type || i.side).toUpperCase()}|${i.quantity}`)
    .sort()
    .join('~');
}

class MarginCalculator {
  /**
   * @param {object} deps
   *   broker    must expose getBasketMargin(instruments)
   *   ttlMs     how long a broker answer stays usable
   *   minGapMs  floor between broker margin calls — this endpoint is rate limited
   *             like every other, and a basket ranker will hammer it
   */
  constructor(deps = {}) {
    this.broker = deps.broker || null;
    this.ttlMs = deps.ttlMs || 60000;
    this.minGapMs = deps.minGapMs || 300;
    this.log = deps.log || console;
    this.now = deps.now || (() => Date.now());
    this.sleep = deps.sleep || (ms => new Promise(r => setTimeout(r, ms)));
    this._cache = new Map();
    this._inflight = new Map();
    this._lastCallAt = 0;
    this.stats = { brokerCalls: 0, cacheHits: 0, coalesced: 0, failures: 0, estimates: 0 };
  }

  /**
   * Margin for a basket. Broker first, cache second, nothing third.
   *
   * @returns {{ok, source, final, span, exposure, legSum, basketBenefit, at, error?}}
   *          `source` is never inferred by the caller — it is stated here.
   */
  async forBasket(instruments, opts = {}) {
    const key = basketKey(instruments);
    if (!key) return { ok: false, source: null, error: 'empty basket' };

    const hit = this._cache.get(key);
    if (hit && !opts.fresh && this.now() - hit.at < this.ttlMs) {
      this.stats.cacheHits++;
      return { ...hit, source: 'cache', ageMs: this.now() - hit.at };
    }
    /* Single-flight. A basket ranker evaluating twenty candidates will ask for
       the same legs repeatedly; without this each duplicate is a broker call. */
    if (this._inflight.has(key)) { this.stats.coalesced++; return this._inflight.get(key); }

    if (!this.broker || typeof this.broker.getBasketMargin !== 'function') {
      return { ok: false, source: null, error: 'no broker margin calculator available — refusing to substitute a formula' };
    }

    const p = (async () => {
      const gap = this.minGapMs - (this.now() - this._lastCallAt);
      if (gap > 0) await this.sleep(gap);
      this._lastCallAt = this.now();
      try {
        const r = await this.broker.getBasketMargin(instruments);
        this.stats.brokerCalls++;
        const val = { ...r, ok: true, source: 'broker', at: this.now() };
        this._cache.set(key, val);
        return val;
      } catch (e) {
        this.stats.failures++;
        /* A stale broker answer is still a broker answer, and it is served with
           its age so the caller can decide. What is NOT done here is falling
           back to a local formula: that would turn a transient API failure into
           a silently wrong margin. */
        if (hit) {
          this.log.warn(`[margin] broker call failed (${e.message}) — serving a ${this.now() - hit.at} ms old figure`);
          return { ...hit, source: 'cache', stale: true, ageMs: this.now() - hit.at, error: e.message };
        }
        return { ok: false, source: null, error: e.message };
      } finally {
        this._inflight.delete(key);
      }
    })();

    this._inflight.set(key, p);
    return p;
  }

  /**
   * The strict accessor. Returns a margin ONLY if it came from the broker or a
   * fresh cache of one. Anything else is null.
   *
   * The risk layer uses this, so a trade can never be sized or admitted on an
   * unvalidated estimate.
   */
  async requireBroker(instruments, opts = {}) {
    const r = await this.forBasket(instruments, opts);
    if (r.ok && (r.source === 'broker' || r.source === 'cache')) return r;
    return { ok: false, source: null, final: null, error: r.error || 'no broker-sourced margin available' };
  }

  /* ── the local approximation, and what it is allowed to be used for ─────── */

  /**
   * A rough figure for display and for ordering candidates BEFORE the broker is
   * called. It is labelled `estimate` and `validated: false`, and
   * `requireBroker` will not return it.
   *
   * It exists because ranking fifty candidate baskets would otherwise be fifty
   * broker calls. Ranking on estimates and then confirming the top few with the
   * broker is the only shape that respects the rate limit — but the confirmation
   * is not optional, and nothing is sent on an estimate.
   */
  estimate(instruments, hints = {}) {
    this.stats.estimates++;
    const shorts = instruments.filter(i => String(i.transaction_type || i.side).toUpperCase() === 'SELL');
    const longs = instruments.filter(i => String(i.transaction_type || i.side).toUpperCase() === 'BUY');
    const perShortLot = num(hints.perShortLot);
    if (perShortLot === null) {
      return { ok: false, source: 'estimate', validated: false, final: null,
        error: 'no calibrated per-lot figure — an uncalibrated estimate is a guess and is refused' };
    }
    const lots = shorts.reduce((s, i) => s + (num(i.quantity) || 0), 0) / (num(hints.lotSize) || 1);
    const gross = perShortLot * lots;
    /* Hedged baskets are cheaper, and by a lot: measured 48.8% on the NIFTY
       condor above. But the number varies with wing distance and the exchange's
       own parameters, so this is a placeholder that MUST be replaced by a broker
       figure before anything is placed. */
    const hedged = longs.length >= shorts.length && shorts.length > 0;
    const factor = hedged ? (num(hints.hedgedFactor) ?? 0.55) : 1;
    return {
      ok: true, source: 'estimate', validated: false,
      final: r2(gross * factor),
      basis: `${lots} short lot(s) × ₹${perShortLot}${hedged ? ` × ${factor} hedged factor` : ''}`,
      warning: 'UNVALIDATED — this is a ranking aid. It must be replaced by a broker figure before any order.',
      at: this.now(),
    };
  }

  /* ── reconciliation ─────────────────────────────────────────────────────── */

  _rows() {
    try { const j = readJsonSync(LEDGER, { fallback: [] }); return Array.isArray(j) ? j : []; }
    catch (e) { this.log.error(`[margin] reconciliation ledger unreadable: ${e.message}`); return []; }
  }

  /**
   * Record what was estimated against what the broker actually said, or what the
   * account was actually charged. This is what makes the estimator's accuracy a
   * measured quantity instead of a hope.
   */
  record({ tag, strategy, instrument, basket, estimated, brokerFinal, actualBlocked = null, note = null }) {
    const rows = this._rows();
    const est = num(estimated), bro = num(brokerFinal), act = num(actualBlocked);
    const reference = act ?? bro;
    rows.push({
      at: new Date(this.now()).toISOString(), tag: tag || null, strategy: strategy || null,
      instrument: instrument || null, basket: basketKey(basket || []),
      estimated: est, brokerFinal: bro, actualBlocked: act,
      // null when there is nothing to compare against — an error of 0 would read
      // as a perfect estimate rather than as an absent one.
      errorRs: (est === null || reference === null) ? null : r2(est - reference),
      errorPct: (est === null || !(reference > 0)) ? null : r2((est - reference) / reference * 100),
      note,
    });
    if (rows.length > 5000) rows.splice(0, rows.length - 5000);
    try { writeJsonSync(LEDGER, rows); }
    catch (e) { this.log.error(`[margin] could not persist reconciliation: ${e.message}`); }
    return rows[rows.length - 1];
  }

  /** How wrong the estimator has been. Mean and median, signed and absolute. */
  accuracy(filter = {}) {
    let rows = this._rows().filter(r => r.errorPct !== null);
    if (filter.strategy) rows = rows.filter(r => r.strategy === filter.strategy);
    if (!rows.length) {
      return {
        samples: 0, meanErrorPct: null, medianAbsErrorPct: null, worstPct: null,
        // Explicit. "No samples" and "perfectly accurate" are different states
        // and must not share a display.
        note: 'no reconciled samples yet — the estimator is UNVALIDATED, not accurate',
      };
    }
    const errs = rows.map(r => r.errorPct);
    const abs = errs.map(Math.abs).sort((a, b) => a - b);
    const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
    const med = abs.length % 2 ? abs[abs.length >> 1] : (abs[(abs.length >> 1) - 1] + abs[abs.length >> 1]) / 2;
    return {
      samples: rows.length,
      meanErrorPct: r2(mean),
      medianAbsErrorPct: r2(med),
      worstPct: r2(Math.max(...abs)),
      // A signed mean near zero with a large absolute median means the estimator
      // is unbiased and imprecise — a different problem from being biased.
      biasNote: Math.abs(mean) < med / 2
        ? 'roughly unbiased but imprecise — errors cancel in the mean'
        : `biased ${mean > 0 ? 'HIGH (over-estimates margin)' : 'LOW (under-estimates margin — the dangerous direction)'}`,
    };
  }

  status() {
    return { stats: { ...this.stats }, cached: this._cache.size, ttlMs: this.ttlMs, accuracy: this.accuracy() };
  }
}

module.exports = { MarginCalculator, basketKey };
