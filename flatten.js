/* ═══════════════════════════════════════════════════════════════════════════
   flatten — the SECONDARY exit path. Task 2b.

   THE PRIMARY PATH IS THE BROKER'S OWN APP, AND THAT IS NOT MODESTY

   This module runs inside the process that may be the thing that is broken. The
   flatten card in docs/073 §6 begins with the broker app for that reason, and
   nothing here changes it. This exists for the case where the bot is reachable
   but misbehaving — an engine re-opening positions, a runaway loop — which is
   commoner than a dead process and is the case where a human racing the machine
   by hand loses.

   THE ORDER OF OPERATIONS IS THE WHOLE DESIGN

   1. TRIP THE KILL SWITCH, AND CONFIRM IT TRIPPED, before any exit is sent.
      An armed bot re-opens what you just closed, and the operator ends up
      fighting their own system while a position moves against them. If the trip
      cannot be confirmed, nothing is sent — a flatten that races the engine is
      worse than no flatten, because it burns the operator's attention while
      achieving nothing.

   2. SHORT LEGS BEFORE LONG LEGS. Closing a protective wing first converts a
      defined-risk position into an undefined-risk one at the worst possible
      moment. Unknown-side legs go LAST, because an unknown might be a hedge.

   3. MARKET ORDERS. Not limits. A flatten is not an execution problem.

   4. RE-READ FROM THE BROKER AFTERWARDS and report what remains.

   5. PARTIAL IS NOT SUCCESS. A run that closed six of seven legs reports
      PARTIAL, loudly, with the survivor named. Reporting success on a partial
      exit is how an operator walks away from an open short.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const { readBrokerPositions } = require('./broker-positions');

/**
 * @param {object} deps
 *   broker      the GUARDED broker. Required — _exit() calls approveReducing()
 *               on it, which only the guard provides.
 *   killSwitch  must expose trip() and blocksNewEntries()
 *   log
 *   now
 *   dryRun      true = plan only, send nothing
 * @returns {Promise<object>} outcome: FLAT | SENT_UNVERIFIED | PARTIAL | REFUSED |
 *                            NOTHING_TO_DO | DRY_RUN | UNEVALUABLE
 */
async function flattenAll(deps = {}) {
  const { broker, killSwitch, dryRun = false } = deps;
  const log = deps.log || console;
  const now = deps.now || (() => Date.now());
  const at = new Date(now()).toISOString();
  const steps = [];
  const record = (step, detail, ok = true) => { steps.push({ step, detail, ok, at: new Date(now()).toISOString() }); (ok ? log.warn : log.error)?.(`[flatten] ${step}: ${detail}`); };

  if (!broker || typeof broker.placeOrder !== 'function') {
    record('preflight', 'no broker — nothing can be sent from here', false);
    return { at, outcome: 'UNEVALUABLE', reason: 'no broker', steps, operatorAction: 'Use the broker app.' };
  }

  /* ── 1. kill first, and CONFIRM ─────────────────────────────────────────── */
  if (!killSwitch || typeof killSwitch.trip !== 'function' || typeof killSwitch.blocksNewEntries !== 'function') {
    record('kill-switch', 'no kill switch available — refusing to send exits into an armed system', false);
    return {
      at, outcome: 'REFUSED', reason: 'kill switch unavailable', steps,
      operatorAction: 'Stop the bot by other means, then use the broker app to exit.',
    };
  }

  if (!killSwitch.blocksNewEntries()) {
    try { killSwitch.trip({ reason: 'MANUAL_FLATTEN', detail: 'flatten requested', by: deps.by || 'flatten', action: 'BLOCK_NEW_ENTRIES' }); }
    catch (e) { record('kill-switch', `trip() threw: ${e.message}`, false); }
  }
  if (!killSwitch.blocksNewEntries()) {
    record('kill-switch', 'trip did NOT take effect — refusing to send exits while the bot can re-open', false);
    return {
      at, outcome: 'REFUSED', reason: 'kill switch did not trip', steps,
      operatorAction: 'Stop the process, then use the broker app. Do not send exits into an armed bot.',
    };
  }
  record('kill-switch', 'tripped and confirmed — the bot cannot open new positions');

  /* ── 2. read the broker ─────────────────────────────────────────────────── */
  const before = await readBrokerPositions(broker);
  record('read-positions', `${before.status}${before.status === 'POSITIONS' ? ` — ${before.openLegs} open leg(s)` : ''}`, before.status === 'POSITIONS' || before.status === 'EMPTY_UNVERIFIABLE');

  if (before.status === 'UNAVAILABLE') {
    return { at, outcome: 'UNEVALUABLE', reason: before.reason, steps, before, operatorAction: before.operatorAction };
  }
  if (before.status === 'EMPTY_UNVERIFIABLE') {
    /* Not "nothing to do". The broker returned an empty list and this connector
       returns an empty list when it fails, so we do not know whether there is
       anything to close. Reported as UNEVALUABLE, and the kill switch stays
       tripped — which is the safe residue. */
    return {
      at, outcome: 'UNEVALUABLE', reason: before.reason, steps, before,
      operatorAction: 'The broker reported nothing, and that cannot be trusted from this connector. Open the broker app and confirm.',
    };
  }

  const open = before.positions.filter(p => p.absQuantity == null || p.absQuantity > 0);
  if (open.length === 0) {
    record('plan', 'broker reports positions, none of them open');
    return { at, outcome: 'NOTHING_TO_DO', steps, before, operatorAction: null };
  }

  /* ── 3. order the exits: short, then unknown-side, then long ────────────── */
  const rank = (p) => (p.side === 'SHORT' ? 0 : p.side === null ? 1 : 2);
  const plan = [...open].sort((a, b) => rank(a) - rank(b));
  record('plan', plan.map(p => `${p.side || '?'} ${p.instrument || '?'}`).join(' → '));

  if (dryRun) {
    return { at, outcome: 'DRY_RUN', steps, before, plan: plan.map(describe), operatorAction: null };
  }

  /* ── 4. send ────────────────────────────────────────────────────────────── */
  const results = [];
  for (const p of plan) {
    if (p.absQuantity == null || !p.securityId) {
      results.push({ leg: describe(p), sent: false, error: 'missing securityId or quantity — cannot construct an exit' });
      record('exit', `SKIPPED ${p.instrument || '?'} — missing securityId or quantity`, false);
      continue;
    }
    const closingSide = p.side === 'SHORT' ? 'BUY' : 'SELL';
    try {
      const res = await _exit(p, closingSide, broker);
      results.push({ leg: describe(p), sent: true, orderId: res && res.orderId ? res.orderId : null });
      record('exit', `${closingSide} ${p.absQuantity} ${p.instrument || '?'} sent`);
    } catch (e) {
      results.push({ leg: describe(p), sent: false, error: e.message, code: e.code || null });
      record('exit', `FAILED ${p.instrument || '?'} — ${e.message}`, false);
    }
  }

  /* ── 5. re-read, and refuse to call a partial exit a success ────────────── */
  const after = await readBrokerPositions(broker);
  const stillOpen = after.status === 'POSITIONS'
    ? after.positions.filter(p => p.absQuantity == null || p.absQuantity > 0)
    : null;
  record('verify', after.status === 'POSITIONS'
    ? `${stillOpen.length} leg(s) still open`
    : `could not verify — ${after.status}`, after.status === 'POSITIONS');

  const failed = results.filter(r => !r.sent);

  let outcome, operatorAction;
  if (after.status !== 'POSITIONS') {
    /* Two different facts, kept apart.

       SENT_UNVERIFIED — every leg was sent and none failed, but the read-back
       came home empty and this connector returns empty for a failed call too
       (A5). We did the work; we cannot confirm the result. Claiming FLAT here
       would be asserting a verification we do not have, and FLAT is the word an
       operator acts on by walking away.

       UNEVALUABLE — some legs failed AND the result cannot be read. Worse, and
       it must not be reported in the same word as the case above. */
    const allSent = failed.length === 0 && results.length > 0;
    outcome = allSent ? 'SENT_UNVERIFIED' : 'UNEVALUABLE';
    operatorAction = allSent
      ? `All ${results.length} exit(s) were sent and none was rejected, but the broker's read-back cannot be trusted from this connector. Open the broker app and confirm every leg is closed.`
      : `${failed.length} exit(s) FAILED and the result cannot be verified from here. Open the broker app and close what remains by hand.`;
  } else if (stillOpen.length === 0 && failed.length === 0) {
    outcome = 'FLAT';
    operatorAction = null;
  } else {
    outcome = 'PARTIAL';
    operatorAction = `NOT FLAT. ${stillOpen.length} leg(s) remain: ${stillOpen.map(p => p.instrument || '?').join(', ') || '(unnamed)'}. Open the broker app and close them by hand.`;
  }

  return { at, outcome, steps, before, results, after, stillOpen: stillOpen ? stillOpen.map(describe) : null, failed, operatorAction };
}

/* ── the exit path ───────────────────────────────────────────────────────────
   Named `_exit` because that is what this codebase calls an exit path —
   execution-engine.js:706 and afternoon-engine.js both use it — and because
   `test/order-path-chokepoint.test.js §5` checks that `approveReducing` is
   reached from inside one. The name satisfies the assertion because it IS an
   exit, not in order to satisfy it.

   THROUGH THE GUARD, VIA approveReducing. Ratified 2026-07-31 (docs/081 §2c,
   resolved). Three reasons, restated here because the next reader of this file
   will not have the report:

     · Around the guard would be a second door to the broker, used in an
       emergency — the worst one to have unrecorded. Phase 2 removed exactly
       that.
     · Through the guard an exit CANNOT be blocked. `risk-guard.js` skips both
       the kill-switch check and the breaker denial when the approval is marked
       reducing, and the chokepoint test proves an exit gets out with both
       tripped. The fear — a risk layer refusing an emergency exit — cannot
       happen by construction.
     · Recorded, counted by the breaker, and labelled `why: REDUCING` in the
       audit trail, distinguishable from an evaluated approval.

   This function is one of exactly three places in the repository permitted to
   open that door. Adding a fourth is a risk decision with an owner, and the
   chokepoint test is what forces the conversation. */
async function _exit(p, closingSide, broker) {
  const decision = broker.approveReducing({
    strategy: 'MANUAL_FLATTEN', instrument: p.instrument,
    strike: p.strike, optionType: p.type, side: closingSide,
    requestedLots: null,
  });
  return broker.placeOrder({
    instrument: p.instrument, strike: p.strike, optionType: p.type,
    side: closingSide, lots: null,
    securityId: p.securityId,
    exchangeSegment: p.exchangeSegment,
    transactionType: closingSide,
    productType: p.product || 'INTRADAY',
    orderType: 'MARKET',
    quantity: p.absQuantity,
    approval: decision.approval,
  });
}

const describe = (p) => ({
  instrument: p.instrument, securityId: p.securityId, strike: p.strike,
  type: p.type, side: p.side, quantity: p.quantity,
});

module.exports = { flattenAll };
