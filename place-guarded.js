/* ═══════════════════════════════════════════════════════════════════════════
   place-guarded — the one function every order call site uses. Phase 2.3.

   WHY A SHARED FUNCTION AND NOT SEVEN COPIES

   Seven call sites now need the same three steps: build an intent, ask the risk
   layer, attach the approval. Written seven times, six of them will drift and
   the seventh will be the one that matters. Written once, a change to the
   protocol reaches every site or fails to compile at every site.

   This is NOT a second chokepoint. The chokepoint is the guarded broker, which
   refuses any order without an approval regardless of who calls it. This
   function is a convenience that makes the correct call easy; the guarantee is
   still enforced one layer down, where it cannot be routed around.

   FAIL CLOSED, INCLUDING ON MISSING INPUTS

   No broker, no risk state, no intent — each is a refusal, not a fallback to
   the old path. A fallback would reintroduce exactly the bypass this phase
   removed, and it would do so on the days when something was already wrong,
   which is when it would be least noticed.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

/**
 * @param {object} args
 *   broker    the RiskGuardedBroker. Required.
 *   intent    { strategy, instrument, strike, optionType, side, expiry,
 *               stopDistance, lotSize, requestedLots, marginVerdict }
 *   state     portfolio state from risk-state.buildRiskState(). Required.
 *   order     the broker payload (securityId, exchangeSegment, quantity, ...)
 *   log       optional
 * @returns {Promise<object>} the broker response
 * @throws   with a `code` — never resolves to a silent no-op
 */
async function placeGuarded({ broker, intent, state, order, log = console } = {}) {
  if (!broker || typeof broker.requestApproval !== 'function' || typeof broker.placeOrder !== 'function') {
    throw Object.assign(
      new Error('place-guarded: no guarded broker. An order call site was wired to something that is not the chokepoint.'),
      { code: 'ORDER_NO_BROKER' }
    );
  }
  if (!intent || !intent.instrument) {
    throw Object.assign(new Error('place-guarded: no intent — the risk layer cannot evaluate an unnamed order'), { code: 'ORDER_NO_INTENT' });
  }
  if (!state) {
    /* An absent portfolio state is not an empty one. Sending here would ask the
       risk layer to approve against nothing, and every check would come back
       UNEVALUABLE anyway — so refuse at the caller with a clearer reason. */
    throw Object.assign(
      new Error('place-guarded: no portfolio risk state. Nothing is approved against an unmeasured book.'),
      { code: 'ORDER_NO_RISK_STATE' }
    );
  }

  const decision = broker.requestApproval(intent, state);
  if (!decision.approved) {
    const blocks = (decision.blocks || []).map(b => `${b.name}:${b.status}`).join(', ');
    const err = Object.assign(
      new Error(`place-guarded: risk layer refused — ${blocks || 'no reason reported'}`),
      { code: 'RISK_BLOCKED', blocks: decision.blocks || [], checks: decision.checks || [] }
    );
    log.warn?.(`[order] BLOCKED ${intent.instrument} ${intent.strike ?? ''}${intent.optionType || ''} — ${blocks}`);
    throw err;
  }

  return broker.placeOrder({ ...order, ...boundFields(intent), approval: decision.approval });
}

/* The guard compares the order against the approval on instrument, strike,
   type, side and lots. Those five fields are copied from the intent rather than
   left to the caller, so a payload that names the strike differently from the
   thing that was approved cannot be constructed by accident. */
function boundFields(intent) {
  return {
    instrument: intent.instrument,
    strike: intent.strike,
    optionType: intent.optionType,
    side: intent.side,
    lots: intent.requestedLots,
  };
}

module.exports = { placeGuarded };
