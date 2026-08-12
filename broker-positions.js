/* ═══════════════════════════════════════════════════════════════════════════
   broker-positions — what the BROKER says is open. Task 2a.

   P1: "a human must always be able to see every open position and flatten it,
   independent of the bot, including when the bot is dead or lying."

   The operative word is `independent`. This module therefore reads the broker
   and consults NO internal book — not positions-book, not the engines, not the
   paper ledger. A malfunctioning system must not be able to hide a position
   from the operator, and the only way to guarantee that is to never ask it.

   THE PROBLEM THIS MODULE CANNOT SOLVE, AND WILL NOT HIDE

   Both connectors swallow errors on this call:

       upstox-connector.js:450  try { ... } catch { return []; }
       live-connector.js:441    if (!this.connected) return [];
                                return this.client._post(...).catch(() => []);

   So an empty array means one of three things and the connector does not say
   which: the account is flat, the call failed, or the connector is
   disconnected. That is defect A5.

   A positions view that printed "no open positions" on that empty array would
   be doing the exact thing P1 forbids — showing an operator a clean screen
   during an outage while a short strangle sits open.

   So this module never reports "flat". A non-empty result is trustworthy and is
   shown. An empty result is reported as EMPTY_UNVERIFIABLE, naming the reason
   and telling the operator to open the broker app. When A5 is fixed — the
   connector distinguishing an error from an empty book — this module gets a
   truthful empty and can say so. Until then it says "I cannot tell", which is
   the honest answer and the safe one.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null));

/* Broker payloads differ per connector and per API version. Every field is
   read defensively and left NULL when absent — a position we cannot fully
   describe is still a position the operator must see, so it is shown with the
   gaps visible rather than dropped or filled in. */
function normalise(row) {
  const qtyRaw = num(row.netQty ?? row.netQuantity ?? row.quantity ?? row.net_quantity ?? row.qty);
  const sideHint = String(row.side ?? row.transactionType ?? row.transaction_type ?? '').toUpperCase();

  let side = null;
  if (qtyRaw != null && qtyRaw !== 0) side = qtyRaw < 0 ? 'SHORT' : 'LONG';
  else if (sideHint === 'SELL' || sideHint === 'S') side = 'SHORT';
  else if (sideHint === 'BUY' || sideHint === 'B') side = 'LONG';

  const type = (() => {
    const t = String(row.optionType ?? row.option_type ?? row.instrumentType ?? row.drvOptionType ?? '').toUpperCase();
    if (t.includes('CE') || t === 'CALL') return 'CE';
    if (t.includes('PE') || t === 'PUT') return 'PE';
    return null;
  })();

  return {
    instrument: row.tradingSymbol ?? row.trading_symbol ?? row.symbol ?? row.instrument ?? row.securityId ?? null,
    securityId: row.securityId ?? row.security_id ?? row.instrument_token ?? null,
    exchangeSegment: row.exchangeSegment ?? row.exchange_segment ?? row.exchange ?? null,
    strike: num(row.strikePrice ?? row.strike_price ?? row.strike),
    type,
    side,
    quantity: qtyRaw,
    absQuantity: qtyRaw == null ? null : Math.abs(qtyRaw),
    avgPrice: num(row.buyAvg ?? row.avgPrice ?? row.average_price ?? row.costPrice),
    ltp: num(row.lastTradedPrice ?? row.ltp ?? row.last_price),
    pnl: num(row.unrealizedProfit ?? row.unrealised ?? row.pnl),
    product: row.productType ?? row.product ?? null,
    _raw: row,
  };
}

/**
 * @param {object} connector  the RAW connector or the guarded broker — reads
 *                            pass through the guard untouched, so either works
 * @returns {Promise<object>} never throws; the outcome is in `status`
 *
 * status:
 *   POSITIONS           the broker reported open positions. Trustworthy.
 *   EMPTY_UNVERIFIABLE  the broker reported nothing, and this connector cannot
 *                       distinguish that from a failure. NOT "flat".
 *   UNAVAILABLE         no way to ask at all.
 */
async function readBrokerPositions(connector) {
  const at = new Date().toISOString();

  if (!connector || typeof connector.getPositions !== 'function') {
    return {
      at, status: 'UNAVAILABLE', positions: null, legCount: null, openLegs: null,
      reason: 'this connector has no getPositions() — there is no way to ask the broker from here',
      operatorAction: 'Open the broker app. This screen cannot tell you anything.',
    };
  }

  let rows;
  try {
    rows = await connector.getPositions();
  } catch (e) {
    return {
      at, status: 'UNAVAILABLE', positions: null, legCount: null, openLegs: null,
      reason: `getPositions() threw: ${e.message}`,
      operatorAction: 'Open the broker app. This screen cannot tell you anything.',
    };
  }

  if (!Array.isArray(rows)) {
    return {
      at, status: 'UNAVAILABLE', positions: null, legCount: null, openLegs: null,
      reason: `getPositions() returned ${rows === null ? 'null' : typeof rows}, not an array`,
      operatorAction: 'Open the broker app. This screen cannot tell you anything.',
    };
  }

  if (rows.length === 0) {
    /* THE IMPORTANT BRANCH.

       Whether an empty list means "flat" depends entirely on whether THIS
       connector can tell an empty answer from a failed call. Until 2026-08-12
       none could: `catch { return []; }` made a failure, a disconnected session
       and a genuinely flat account the same value, so every empty result had to
       be reported as unverifiable — including the ones that were true.

       A connector that now throws on failure declares
       `positionsDistinguishEmptyFromError`. Read from the OBJECT, not inferred
       from its class name: what matters is the connector actually in hand, and a
       mock, an older build or a future one written the old way will not carry
       it and will keep the honest-but-useless answer. */
    const trustworthy = connector.positionsDistinguishEmptyFromError === true;

    if (!trustworthy) {
      return {
        at, status: 'EMPTY_UNVERIFIABLE', positions: [], legCount: 0, openLegs: 0,
        reason: 'The broker returned an empty list. This connector returns an empty list ' +
                'for a FAILED call and for a DISCONNECTED state as well as for a flat account ' +
                '(defect A5), so an empty result cannot be read as "no positions".',
        operatorAction: 'Open the broker app and confirm for yourself. Do not treat this screen as evidence that you are flat.',
        connected: connector.connected === undefined ? null : !!connector.connected,
      };
    }

    return {
      at, status: 'EMPTY_VERIFIED', positions: [], legCount: 0, openLegs: 0,
      reason: 'The broker was asked and answered with no positions. This connector throws '
            + 'on a failed call and on a disconnected session, so an empty list here means '
            + 'the account is flat rather than that the question could not be asked.',
      operatorAction: 'Nothing. The broker reports no open positions.',
      connected: connector.connected === undefined ? null : !!connector.connected,
    };
  }

  const positions = rows.map(normalise);
  /* Only legs with a non-zero quantity are OPEN. Brokers routinely return
     closed positions with netQty 0 in the same list, and counting those would
     have the operator hunting for a leg that is not there — during a flatten,
     with a position moving. */
  const open = positions.filter(p => p.absQuantity == null || p.absQuantity > 0);

  return {
    at,
    status: 'POSITIONS',
    positions,
    legCount: positions.length,          // everything the broker returned
    openLegs: open.length,               // the number the flatten card asks for
    shortLegs: open.filter(p => p.side === 'SHORT').length,
    longLegs: open.filter(p => p.side === 'LONG').length,
    unknownSide: open.filter(p => p.side === null).length,
    unknownQuantity: open.filter(p => p.absQuantity == null).length,
    reason: null,
    operatorAction: null,
    connected: connector.connected === undefined ? null : !!connector.connected,
  };
}

/** Plain text, wide enough for a phone screen and no wider. */
function renderText(view) {
  const L = [];
  L.push(`BROKER POSITIONS  ${view.at}`);
  L.push('');
  if (view.status !== 'POSITIONS') {
    L.push(`  STATUS: ${view.status}`);
    L.push('');
    for (const line of wrap(view.reason, 46)) L.push(`  ${line}`);
    L.push('');
    for (const line of wrap(view.operatorAction, 46)) L.push(`  → ${line}`);
    return L.join('\n');
  }
  L.push(`  OPEN LEGS: ${view.openLegs}    short ${view.shortLegs}  long ${view.longLegs}`);
  if (view.unknownSide) L.push(`  ⚠ ${view.unknownSide} leg(s) with an UNKNOWN side`);
  if (view.unknownQuantity) L.push(`  ⚠ ${view.unknownQuantity} leg(s) with an UNKNOWN quantity`);
  L.push('');
  for (const p of view.positions) {
    const q = p.quantity == null ? '?' : p.quantity;
    L.push(`  ${(p.side || '?').padEnd(5)} ${String(q).padStart(6)}  ${p.instrument || '?'}`);
    if (p.strike != null || p.type) L.push(`        ${p.strike ?? '?'} ${p.type ?? '?'}   ltp ${p.ltp ?? '—'}  pnl ${p.pnl ?? '—'}`);
  }
  return L.join('\n');
}

function wrap(s, w) {
  const words = String(s || '').split(/\s+/);
  const out = []; let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > w) { if (line) out.push(line); line = word; }
    else line = (line ? line + ' ' : '') + word;
  }
  if (line) out.push(line);
  return out;
}

module.exports = { readBrokerPositions, renderText, normalise };
