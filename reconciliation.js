/* reconciliation — does the book we think we have match the one the broker has.
   docs/093 §2.

   THIS WAS IMPOSSIBLE UNTIL 2026-08-12
     scripts/smoke.js carried the reason in its own words: "Building it on
     live-connector.getPositions() would be unsound while that returns [] on
     error." A connector that answers [] for a failed call makes every
     reconciliation trivially pass at exactly the moment it matters — the broker
     is unreachable, both sides look flat, and the report says AGREED.

     That is fixed (D-8). An empty list now means the broker was asked and
     answered with nothing, failures throw, and `EMPTY_VERIFIED` is a distinct
     answer from `EMPTY_UNVERIFIABLE`. So this module can exist.

   THE THREE RULES, and each one is a way this could quietly become useless

   1. A DIFFERENCE IS NEVER AUTO-CORRECTED.
      It is reported, and it BLOCKS. Correcting means choosing which side is
      right, and the whole reason the check exists is that we do not know. A
      reconciliation that heals itself is a reconciliation that never reports
      anything.

   2. UNAVAILABLE IS NOT AGREEMENT.
      A broker that cannot be asked produces UNAVAILABLE, which blocks exactly as
      a mismatch does. The tempting bug is to treat "no differences found" as
      passing when the reason none were found is that one side was never read.

   3. IT MUST BE KNOWN TO BE RUNNING.
      A reconciliation that silently stops is worse than none, because its
      silence reads as agreement. Every result carries the heartbeat name it
      beats under, and `verdict()` refuses to report AGREED from a stale run.

   ON MATCHING
     Positions are keyed by instrument + strike + option type + side. Quantities
     are compared as SIGNED lot counts. A leg present on one side only is a
     difference, not a rounding matter, and quantity differences are reported with
     both numbers — never a delta alone, because a delta cannot be checked
     against the broker's screen. */
'use strict';

const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

/** The comparison key. Deliberately coarse: instrument, strike, type, side.
 *  Expiry is included when BOTH sides carry it — a broker that omits it must not
 *  cause every leg to mismatch, and a broker that provides it must not let two
 *  different expiries collapse into one row. */
function legKey(p) {
  const parts = [
    String(p.instrument || p.symbol || '').toUpperCase(),
    p.strike === null || p.strike === undefined ? '' : String(p.strike),
    String(p.optionType || p.type || '').toUpperCase(),
    String(p.side || '').toUpperCase(),
  ];
  if (p.expiry) parts.push(String(p.expiry).slice(0, 10));
  return parts.join('|');
}

const VERDICT = {
  AGREED: 'AGREED',
  MISMATCH: 'MISMATCH',
  UNAVAILABLE: 'UNAVAILABLE',
};

/**
 * @param internal  { ok, positions:[...] } — our own book
 * @param broker    the shape broker-positions.js returns:
 *                  { status: 'OK'|'EMPTY_VERIFIED'|'EMPTY_UNVERIFIABLE'|'UNAVAILABLE',
 *                    positions: [...]|null, reason, operatorAction }
 */
function reconcile({ internal, broker } = {}) {
  const at = new Date().toISOString();

  /* ── the broker side must be KNOWN before anything is compared ── */
  if (!broker || broker.status === 'UNAVAILABLE' || broker.positions === null) {
    return {
      at, verdict: VERDICT.UNAVAILABLE, blocking: true,
      differences: null, counts: null,
      reason: `the broker book is unavailable: ${(broker && broker.reason) || 'no broker result supplied'}`,
      operatorAction: (broker && broker.operatorAction)
        || 'Open the broker app. Nothing here can tell you whether the books agree.',
    };
  }

  if (broker.status === 'EMPTY_UNVERIFIABLE') {
    /* The subtle one. The broker returned an empty list from a connector that
       cannot tell an empty answer from a failed call. Comparing against it would
       report every internal position as "missing at the broker" — a page of
       alarming differences produced by a connector limitation, or, if our book is
       also empty, a confident AGREED built on two unknowns. */
    return {
      at, verdict: VERDICT.UNAVAILABLE, blocking: true,
      differences: null, counts: null,
      reason: 'the broker returned an empty list from a connector that cannot distinguish '
            + 'an empty account from a failed call, so it cannot be compared against',
      operatorAction: broker.operatorAction || 'Open the broker app and confirm for yourself.',
    };
  }

  if (!internal || internal.ok === false || !Array.isArray(internal.positions)) {
    return {
      at, verdict: VERDICT.UNAVAILABLE, blocking: true,
      differences: null, counts: null,
      reason: `the internal book is unavailable: ${(internal && internal.reason) || 'no internal result supplied'}`,
      operatorAction: 'The engines could not report their positions. Do not trade until this is understood.',
    };
  }

  /* ── both sides are known; compare ── */
  const ours = new Map();
  for (const p of internal.positions) {
    const k = legKey(p);
    const q = num(p.lots ?? p.quantity ?? p.qty);
    ours.set(k, { key: k, lots: q, raw: p });
  }
  const theirs = new Map();
  for (const p of broker.positions) {
    const k = legKey(p);
    const q = num(p.lots ?? p.quantity ?? p.netQty ?? p.qty);
    theirs.set(k, { key: k, lots: q, raw: p });
  }

  const differences = [];
  for (const [k, a] of ours) {
    const b = theirs.get(k);
    if (!b) {
      differences.push({
        key: k, kind: 'ONLY_INTERNAL', internalLots: a.lots, brokerLots: null,
        detail: 'we believe we hold this and the broker does not report it',
      });
      continue;
    }
    if (a.lots === null || b.lots === null) {
      /* A quantity we could not read is not a match and not a mismatch — it is a
         leg we cannot check, and calling it agreed would be the same error as
         treating UNAVAILABLE as agreement, one row down. */
      differences.push({
        key: k, kind: 'QUANTITY_UNKNOWN', internalLots: a.lots, brokerLots: b.lots,
        detail: 'one side did not report a readable quantity for this leg',
      });
      continue;
    }
    if (a.lots !== b.lots) {
      differences.push({
        key: k, kind: 'QUANTITY', internalLots: a.lots, brokerLots: b.lots,
        detail: `we say ${a.lots} lots, the broker says ${b.lots}`,
      });
    }
  }
  for (const [k, b] of theirs) {
    if (ours.has(k)) continue;
    differences.push({
      key: k, kind: 'ONLY_BROKER', internalLots: null, brokerLots: b.lots,
      detail: 'the broker reports this and no engine claims it — a manual trade, or a fill we did not record',
    });
  }

  const agreed = differences.length === 0;
  return {
    at,
    verdict: agreed ? VERDICT.AGREED : VERDICT.MISMATCH,
    /* A mismatch BLOCKS. It is never repaired here: repairing means choosing a
       side, and not knowing which side is right is the reason this runs. */
    blocking: !agreed,
    differences,
    counts: {
      internal: ours.size,
      broker: theirs.size,
      differences: differences.length,
      onlyInternal: differences.filter((d) => d.kind === 'ONLY_INTERNAL').length,
      onlyBroker: differences.filter((d) => d.kind === 'ONLY_BROKER').length,
      quantity: differences.filter((d) => d.kind === 'QUANTITY').length,
      unknown: differences.filter((d) => d.kind === 'QUANTITY_UNKNOWN').length,
    },
    reason: agreed
      ? `both books report the same ${ours.size} leg(s)`
      : `${differences.length} difference(s) between our book and the broker's`,
    operatorAction: agreed
      ? null
      : 'Do not trade. Open the broker app, decide which side is right, and correct it there or here by hand. This screen will not choose for you.',
  };
}

/** The verdict, refusing to report AGREED from a run nobody can prove happened.
 *
 *  @param result     what reconcile() returned
 *  @param heartbeat  the component entry from heartbeat.status(), or null
 */
function verdict(result, heartbeat) {
  if (!result) {
    return { verdict: VERDICT.UNAVAILABLE, blocking: true, reason: 'no reconciliation has run' };
  }
  if (result.verdict !== VERDICT.AGREED) return result;

  /* RULE 3. A reconciliation that stopped running reports nothing, and nothing
     reads as agreement. An AGREED whose own heartbeat is stale is not evidence. */
  if (!heartbeat || heartbeat.state === 'NEVER') {
    return {
      ...result, verdict: VERDICT.UNAVAILABLE, blocking: true,
      reason: 'the books agreed, but this reconciliation has no heartbeat — there is no evidence it is still running',
      operatorAction: 'Check that the reconciliation loop is started before relying on this.',
    };
  }
  if (heartbeat.state === 'STALE') {
    return {
      ...result, verdict: VERDICT.UNAVAILABLE, blocking: true,
      reason: `the books agreed at ${result.at}, but the reconciliation heartbeat is stale (${heartbeat.reason})`,
      operatorAction: 'This agreement is old. Treat it as unknown until the loop is running again.',
    };
  }
  return result;
}

module.exports = { reconcile, verdict, legKey, VERDICT };
