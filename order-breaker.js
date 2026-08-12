/* ═══════════════════════════════════════════════════════════════════════════
   order-breaker — the automatic circuit breaker at the chokepoint. Phase 2.5.

   WHY IT IS SEPARATE FROM THE KILL SWITCH

   The kill switch is manual and deliberate: a human decides to stop. It is the
   wrong instrument for a loop that fires two hundred orders in four seconds,
   because by the time a human has noticed, opened the dashboard and clicked,
   the damage is complete. A runaway loop is a more common cause of ruin than
   any strategy error, and it is the one failure the operator cannot outrun.

   So this sits in the send path and latches on breach, without asking anyone.

   THREE BREAKERS, EACH LATCHING INDEPENDENTLY

     rate           more than N orders in a rolling window, across everything
     perInstrument  more than M orders in that window for one instrument
     duplicate      the same instrument|strike|type|side|lots seen again inside
                    a short window — the signature of a retry loop rather than
                    a strategy, because a strategy that genuinely wants twice
                    the size asks for twice the size once

   LATCHING IS THE POINT

   A breaker that resets itself when the rate falls back under the limit will
   let a loop through in bursts forever. Once tripped it stays tripped until a
   human resets it, and the reset is recorded with who and why.

   WHAT IT CANNOT SEE

   It counts orders arriving AT the chokepoint. The Dhan connector retries a
   failed order up to three times below this point (docs/074 §0.6 B1), so four
   broker submissions can arrive from one intent and this breaker will count
   one. That amplification is fixed at the connector, not here; a breaker that
   pretended to cover it would be worse than one that states the limit.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const DEFAULTS = {
  BREAKER_ENABLED: true,
  BREAKER_WINDOW_MS: 60000,          // rolling window for both rate limits
  BREAKER_MAX_PER_WINDOW: 12,        // across every instrument
  BREAKER_MAX_PER_INSTRUMENT: 6,     // for any one instrument
  BREAKER_DUP_WINDOW_MS: 5000,       // an identical order inside this window is a duplicate
  BREAKER_DUP_ALLOWED: 1,            // how many identical orders are tolerated in that window
};

class OrderBreaker {
  /**
   * @param {object} deps
   *   cfg   () => config object (may supply any DEFAULTS key)
   *   now   () => epoch ms
   *   log
   */
  constructor(deps = {}) {
    this.cfg = deps.cfg || (() => ({}));
    this.now = deps.now || (() => Date.now());
    this.log = deps.log || console;
    this._events = [];                 // { at, key, instrument }
    this._tripped = null;              // { breaker, reason, at, observed, threshold }
    this.stats = { checked: 0, tripped: 0 };
  }

  _c() { return { ...DEFAULTS, ...(this.cfg() || {}) }; }

  /** True when the breaker is latched. Consulted before every send. */
  isTripped() { return this._tripped !== null; }
  status() {
    const c = this._c();
    return {
      enabled: c.BREAKER_ENABLED !== false,
      tripped: this._tripped !== null,
      trip: this._tripped,
      recentOrders: this._events.length,
      limits: {
        windowMs: c.BREAKER_WINDOW_MS,
        maxPerWindow: c.BREAKER_MAX_PER_WINDOW,
        maxPerInstrument: c.BREAKER_MAX_PER_INSTRUMENT,
        dupWindowMs: c.BREAKER_DUP_WINDOW_MS,
        dupAllowed: c.BREAKER_DUP_ALLOWED,
      },
      stats: { ...this.stats },
    };
  }

  /**
   * Called immediately before an order is sent. Records the order and returns a
   * verdict. Once latched it keeps returning the same trip, and it records the
   * order anyway so the post-mortem shows what kept arriving after the breach.
   *
   * @returns {{ allowed: boolean, breaker: string|null, reason: string|null }}
   */
  check(order = {}) {
    const c = this._c();
    this.stats.checked++;

    const at = this.now();
    const instrument = String(order.instrument || '?').toUpperCase();
    const key = [instrument, order.strike ?? '?', order.optionType || '?',
                 String(order.side || '?').toUpperCase(), order.lots ?? '?'].join('|');

    this._events.push({ at, key, instrument });
    const oldest = at - Math.max(c.BREAKER_WINDOW_MS, c.BREAKER_DUP_WINDOW_MS);
    while (this._events.length && this._events[0].at < oldest) this._events.shift();

    if (c.BREAKER_ENABLED === false) return { allowed: true, breaker: null, reason: null };
    if (this._tripped) return this._deny(this._tripped);

    const inWindow = this._events.filter(e => e.at >= at - c.BREAKER_WINDOW_MS);

    if (inWindow.length > c.BREAKER_MAX_PER_WINDOW) {
      return this._trip('rate', `${inWindow.length} orders in ${c.BREAKER_WINDOW_MS} ms`, inWindow.length, c.BREAKER_MAX_PER_WINDOW, at);
    }

    const sameInst = inWindow.filter(e => e.instrument === instrument);
    if (sameInst.length > c.BREAKER_MAX_PER_INSTRUMENT) {
      return this._trip('perInstrument', `${sameInst.length} orders for ${instrument} in ${c.BREAKER_WINDOW_MS} ms`, sameInst.length, c.BREAKER_MAX_PER_INSTRUMENT, at);
    }

    const dups = this._events.filter(e => e.key === key && e.at >= at - c.BREAKER_DUP_WINDOW_MS);
    if (dups.length > c.BREAKER_DUP_ALLOWED) {
      return this._trip('duplicate', `identical order ${key} seen ${dups.length} times in ${c.BREAKER_DUP_WINDOW_MS} ms`, dups.length, c.BREAKER_DUP_ALLOWED, at);
    }

    return { allowed: true, breaker: null, reason: null };
  }

  _trip(breaker, reason, observed, threshold, at) {
    this._tripped = { breaker, reason, at: new Date(at).toISOString(), observed, threshold };
    this.stats.tripped++;
    this.log.error(`[order-breaker] LATCHED (${breaker}): ${reason}. No further orders until reset.`);
    return this._deny(this._tripped);
  }

  _deny(t) {
    return { allowed: false, breaker: t.breaker, reason: `order-breaker latched (${t.breaker}): ${t.reason}` };
  }

  /** Explicit, recorded, human. There is deliberately no auto-reset. */
  reset({ by, note } = {}) {
    if (!by) throw new Error('order-breaker: reset requires `by` — an unattributed reset is not a decision');
    const was = this._tripped;
    this._tripped = null;
    this._events = [];
    this.log.warn(`[order-breaker] reset by ${by}${note ? ` — ${note}` : ''} (was: ${was ? was.breaker : 'not tripped'})`);
    return { ok: true, was };
  }
}

module.exports = { OrderBreaker, BREAKER_DEFAULTS: DEFAULTS };
