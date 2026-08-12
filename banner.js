/* banner — the first line an operator reads must be true.
   Phase 3A of the backend hardening programme. See docs/086, docs/087.

   WHAT IT REPLACES, server.js:8302
   -------------------------------
       Mode: ${live.connected ? "LIVE (Dhan)" : "DISCONNECTED - set DHAN creds"}

   Observed 2026-08-07 on the running system: it printed

       Mode: LIVE (Dhan)

   while the system was upstox, paper, and holding a connector whose placeOrder
   throws. Three facts, all wrong, on the first line of the startup output — two
   lines above the engines correctly printing `paper=true`.

   The defect is not the string. It is that the string is derived from
   `live.connected`, which answers a different question: whether a market-data
   session was established. It has never had anything to say about which broker,
   which mode, or whether an order could be placed.

   WHAT THIS DERIVES INSTEAD
   -------------------------
   Three independent facts, each from its own source:

     connector      which module was actually constructed
     tradeMode      what the process is configured to do
     orderCapability whether an order could reach a broker AT ALL

   None is inferred from the others. In particular `orderCapability` is not
   `tradeMode === 'live'`: a connector whose placeOrder throws cannot place an
   order no matter what the mode says, and a paper-mode process holding a
   live-capable connector is one flag from doing so. Both facts are worth
   printing and neither substitutes for the other.

   ON WHEN CAPABILITY IS READ  (prompt F4)
   ---------------------------------------
   Capability must be captured from the connector BEFORE any guard replaces its
   methods. A previous fix read it at request time and therefore reported the
   guard's thrower rather than the connector's own — every connector looked
   incapable, including the ones that were not. `captureCapability` exists to be
   called at construction; `renderBanner` consumes what it recorded rather than
   re-deriving it later. */
'use strict';

const CAPABILITIES = {
  NONE: 'none',                 // no placeOrder method at all
  REFUSES: 'refuses',           // has one, and it throws by design
  LIVE_CAPABLE: 'live-capable', // has one, and it would submit
  NEUTRALISED: 'neutralised',   // a guard has replaced it; the underlying is unknown from here
  UNKNOWN: 'unknown',           // could not be determined — never merged with the others
};

/** Determine what a connector can do, from the connector itself.
 *
 *  CALL THIS AT CONSTRUCTION, before any guard wraps the object. Called later it
 *  inspects whatever replaced the method and answers a different question. */
function captureCapability(connector) {
  if (!connector) return CAPABILITIES.UNKNOWN;
  const fn = connector.placeOrder;
  if (typeof fn !== 'function') return CAPABILITIES.NONE;

  let body = '';
  try { body = Function.prototype.toString.call(fn); } catch (_) { return CAPABILITIES.UNKNOWN; }

  // A guard's replacement is recognisable and must not be read as the
  // connector's own behaviour.
  if (/requestApproval|approval\b.*missing|__guard/i.test(body) && !/placeOrder/.test(connector.constructor?.name || '')) {
    return CAPABILITIES.NEUTRALISED;
  }
  if (/throw new Error\(/.test(body) && /not implemented|paper mode only|read-only|unsupported/i.test(body)) {
    return CAPABILITIES.REFUSES;
  }
  return CAPABILITIES.LIVE_CAPABLE;
}

/** Could an order actually reach a broker right now?
 *
 *  Requires BOTH a live-capable connector AND live mode. Either alone is not
 *  enough, and the answer states which one is missing rather than only that the
 *  answer is no — "no, because the mode is paper" and "no, because the connector
 *  refuses" call for completely different actions. */
function liveOrdersPossible({ orderCapability, tradeMode }) {
  const capable = orderCapability === CAPABILITIES.LIVE_CAPABLE;
  const live = String(tradeMode || '').toLowerCase() === 'live';
  if (capable && live) return { possible: true, blockedBy: null };
  if (!capable && !live) return { possible: false, blockedBy: 'connector and mode' };
  return { possible: false, blockedBy: capable ? 'mode' : 'connector' };
}

/** The one line an operator reads. Every field derived, none inferred. */
function renderBanner({ connector, tradeMode, orderCapability, declared = true }) {
  const name = connector || 'UNKNOWN';
  const mode = String(tradeMode || 'paper').toLowerCase();
  const cap = orderCapability || CAPABILITIES.UNKNOWN;
  const { possible, blockedBy } = liveOrdersPossible({ orderCapability: cap, tradeMode: mode });

  const orders = possible
    ? 'LIVE ORDERS POSSIBLE'
    : `orders ${cap}${blockedBy ? ` · blocked by ${blockedBy}` : ''}`;

  return `Mode: ${name}${declared ? '' : ' (auto-selected)'} · ${mode.toUpperCase()} · ${orders}`;
}

module.exports = { renderBanner, captureCapability, liveOrdersPossible, CAPABILITIES };
