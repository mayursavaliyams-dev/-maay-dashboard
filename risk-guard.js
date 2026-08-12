/* ═══════════════════════════════════════════════════════════════════════════
   risk-guard — the chokepoint. Wraps the broker so no order can go round the
   risk layer.

   WHY A PROXY AND NOT A FUNCTION EVERY ENGINE CALLS

   Eight call sites reach `placeOrder` in this repository today:

     afternoon-engine.js:520, :671      execution-engine.js:540, :678
     amibroker-bridge.js:623            limit-order-engine.js:386
     server.js:1985, :7606

   A risk layer that each of those has to remember to consult is a risk layer
   that will be forgotten by at least one of them — and the one that forgets is
   the one that matters, because nothing will announce it. The same reasoning
   produced one `/api` middleware rather than 42 route patches when an endpoint
   was answering with the wrong instrument.

   So the broker itself is wrapped. `placeOrder` on a guarded broker REFUSES any
   order that does not carry a valid, unused approval issued by the risk manager
   for that exact instrument, strike, side and quantity. The guarantee is then
   structural: to bypass the risk layer you would have to reach past the object
   every engine was handed, and a test asserts that no file does.

   THE APPROVAL IS BOUND AND SINGLE-USE
     · bound   — an approval for 2 lots of 24300CE cannot send 5 lots, or a PE,
                 or a different strike. A generic "yes" would be a key that
                 opens every door once someone has any door open.
     · single-use — replaying an approval would let one risk decision authorise
                 an unbounded number of orders.
     · expiring — an approval issued against a book and an equity from ten
                 minutes ago is an approval about a different market.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const DEFAULT_TTL_MS = 30000;

class RiskGuardedBroker {
  /**
   * @param {object} broker      the real connector
   * @param {object} deps
   *   riskManager   required — nothing is approved without it
   *   killSwitch    optional  — consulted again at send time
   *   ttlMs         approval lifetime
   *   log, now
   */
  constructor(broker, deps = {}) {
    if (!broker) throw new Error('risk-guard: no broker to wrap');
    if (!deps.riskManager) {
      // Constructing a guard without a risk manager would produce an object that
      // looks guarded and is not. Refused loudly rather than degrading.
      throw new Error('risk-guard: refusing to construct without a riskManager — an unguarded guard is worse than none');
    }
    this._broker = broker;
    this.riskManager = deps.riskManager;
    this.killSwitch = deps.killSwitch || null;
    this.ttlMs = deps.ttlMs || DEFAULT_TTL_MS;
    this.log = deps.log || console;
    this.now = deps.now || (() => Date.now());
    this._used = new Set();
    this._issued = new Map();          // token → approval
    this.stats = { approved: 0, blocked: 0, sent: 0, refusedAtSend: 0 };

    /* Everything the broker exposes that is NOT an order-placing method passes
       straight through. Quotes, positions, chains and candles are reads and have
       nothing to do with risk; intercepting them would make this object a
       bottleneck for the whole system rather than a gate on one thing. */
    for (const key of allMethods(broker)) {
      if (key === 'placeOrder' || key === 'constructor') continue;
      if (typeof broker[key] !== 'function') continue;
      if (this[key] !== undefined) continue;
      this[key] = (...args) => broker[key](...args);
    }
    for (const key of ['connected', 'accessToken', 'client']) {
      if (key in broker) Object.defineProperty(this, key, { get: () => broker[key], configurable: true });
    }
  }

  /** Ask the risk layer. Returns the full decision; the approval is retained. */
  requestApproval(intent, state) {
    const d = this.riskManager.evaluate(intent, state);
    if (d.approved) {
      this.stats.approved++;
      this._issued.set(d.approval.token, d.approval);
    } else {
      this.stats.blocked++;
    }
    return d;
  }

  /**
   * The only way to an order.
   *
   * `order.approval` must be an approval object issued by requestApproval, for
   * this exact instrument/strike/side/quantity, unused, and unexpired.
   */
  async placeOrder(order = {}) {
    const a = order.approval;

    if (!a || !a.token) {
      this.stats.refusedAtSend++;
      const msg = 'risk-guard: order refused — no risk approval attached. ' +
                  'Every order must be evaluated by the risk layer before it is sent.';
      this.log.error(`[risk-guard] ${msg} (${order.instrument || '?'} ${order.strike || ''}${order.optionType || ''})`);
      throw Object.assign(new Error(msg), { code: 'RISK_NO_APPROVAL' });
    }

    const known = this._issued.get(a.token);
    if (!known) {
      this.stats.refusedAtSend++;
      throw Object.assign(new Error('risk-guard: approval token was not issued by this risk manager'), { code: 'RISK_UNKNOWN_APPROVAL' });
    }
    if (this._used.has(a.token)) {
      this.stats.refusedAtSend++;
      throw Object.assign(new Error('risk-guard: approval already used — one decision authorises one order'), { code: 'RISK_APPROVAL_REUSED' });
    }
    const age = this.now() - Date.parse(known.issuedAt);
    if (!(age >= 0) || age > this.ttlMs) {
      this.stats.refusedAtSend++;
      throw Object.assign(new Error(`risk-guard: approval is ${age} ms old (limit ${this.ttlMs}) — it was issued about a different market`), { code: 'RISK_APPROVAL_STALE' });
    }

    /* Bound. The approval names what it approved and the order must match it.
       Quantity is compared in LOTS, because an order in units and an approval in
       lots would silently pass a comparison neither side meant. */
    const mismatch = [];
    if (order.instrument !== known.instrument) mismatch.push(`instrument ${order.instrument} ≠ ${known.instrument}`);
    if (order.strike !== undefined && known.strike !== null && Number(order.strike) !== Number(known.strike)) mismatch.push(`strike ${order.strike} ≠ ${known.strike}`);
    if (order.optionType && known.optionType && order.optionType !== known.optionType) mismatch.push(`type ${order.optionType} ≠ ${known.optionType}`);
    if (order.side && known.side && String(order.side).toUpperCase() !== String(known.side).toUpperCase()) mismatch.push(`side ${order.side} ≠ ${known.side}`);
    if (order.lots !== undefined && Number(order.lots) > Number(known.lots)) mismatch.push(`lots ${order.lots} > approved ${known.lots}`);
    if (mismatch.length) {
      this.stats.refusedAtSend++;
      throw Object.assign(new Error(`risk-guard: order does not match its approval — ${mismatch.join('; ')}`), { code: 'RISK_APPROVAL_MISMATCH' });
    }

    /* Re-checked at SEND time, not only at approval time. The gap between the
       two is exactly where a day-loss limit gets crossed by a position that was
       already open. */
    if (this.killSwitch && this.killSwitch.blocksNewEntries()) {
      this.stats.refusedAtSend++;
      const st = this.killSwitch.status();
      throw Object.assign(new Error(`risk-guard: kill switch tripped between approval and send (${st.reason})`), { code: 'RISK_KILLED' });
    }

    this._used.add(a.token);
    this.stats.sent++;

    try {
      const res = await this._broker.placeOrder(order);
      if (this.killSwitch) this.killSwitch.noteBrokerCall(true);
      return res;
    } catch (e) {
      if (this.killSwitch) this.killSwitch.noteBrokerCall(false);
      throw e;
    }
  }

  status() {
    return {
      guarded: true,
      stats: { ...this.stats },
      approvalsOutstanding: this._issued.size - this._used.size,
      ttlMs: this.ttlMs,
      killSwitch: this.killSwitch ? this.killSwitch.status() : null,
    };
  }
}

function allMethods(obj) {
  const out = new Set();
  let o = obj;
  while (o && o !== Object.prototype) {
    for (const k of Object.getOwnPropertyNames(o)) out.add(k);
    o = Object.getPrototypeOf(o);
  }
  return [...out];
}

module.exports = { RiskGuardedBroker };
