/* ═══════════════════════════════════════════════════════════════════════════
   liquidity-gate — decide whether a book can absorb an order, and say why not.

   THE CONTRACT
   Every call returns a verdict with a REASON. There is no path through this
   module that refuses an order silently, and no path that admits one without
   recording the numbers it admitted it on. The reason string is what appears in
   the rejection log and in the slippage report's excluded count, so it is
   written for a human reading it at 15:20, not for a switch statement.

   FAIL CLOSED, ALWAYS
   A missing bid, a missing ask, a zero quantity, an unparseable timestamp — all
   of these REFUSE. They do not fall back to LTP, they do not assume a spread,
   and they do not treat absent depth as infinite depth. The whole point of a
   liquidity gate is to be the thing that says no when the book is unknown, and
   a gate that guesses when data is missing is worse than no gate: it produces a
   confident yes on exactly the instruments where the data was too thin to have
   an opinion about.

   WHY LTP IS NOT USED ANYWHERE HERE
   The last traded price is a fact about the past. A strike can show an LTP of
   ₹2,447 with a bid of ₹2,456 and an ask of ₹2,689 — measured on a live chain
   on 2026-07-30, volume zero for the session. Sizing or pricing off that LTP
   would put an order into a 9%-wide book believing it was at the market.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const num = (v) => (v === null || v === undefined || !isFinite(Number(v))) ? null : Number(v);

/**
 * Normalise one side of a chain row into a book snapshot.
 *
 * Returns { ok, bid, ask, mid, spread, relSpread, bidQty, askQty, topQty, ltp,
 *           quoteAgeMs, at } or { ok:false, reason }.
 *
 * `now` and `quoteAt` are passed in rather than read from the clock so this is a
 * pure function and can be tested without waiting.
 */
function snapshot(side, { now = Date.now(), quoteAt = null } = {}) {
  if (!side || typeof side !== 'object') return { ok: false, reason: 'no book for this strike side' };

  const bid = num(side.bid), ask = num(side.ask);
  const bidQty = num(side.bidQty), askQty = num(side.askQty);
  const ltp = num(side.ltp);

  if (bid === null || ask === null) return { ok: false, reason: 'quote incomplete — bid or ask missing' };
  if (!(bid > 0) || !(ask > 0)) return { ok: false, reason: `non-positive quote (bid ${bid}, ask ${ask})` };
  if (ask < bid) return { ok: false, reason: `crossed book (bid ${bid} > ask ${ask}) — refusing rather than averaging it away` };

  const mid = (bid + ask) / 2;
  const spread = ask - bid;
  const at = num(quoteAt) ?? num(side.at) ?? null;

  return {
    ok: true,
    bid, ask, mid: +mid.toFixed(4), spread: +spread.toFixed(4),
    relSpread: +(spread / mid).toFixed(5),
    bidQty, askQty,
    ltp,
    at,
    // null, not 0: "we do not know how old this quote is" and "this quote is
    // fresh" are different states, and only one of them is safe to trade on.
    quoteAgeMs: at === null ? null : Math.max(0, now - at),
  };
}

/* The side of the book we must take, and therefore the quantity that matters.
   Buying lifts the ask, so the ASK quantity is what has to be there. Sizing a
   buy against bid quantity is the classic version of this mistake and it always
   passes the gate. */
function topQtyFor(bookSnap, sideOfTrade) {
  const buy = String(sideOfTrade || 'BUY').toUpperCase() === 'BUY';
  return buy ? bookSnap.askQty : bookSnap.bidQty;
}

/**
 * The gate.
 *
 * @param {object} args
 *   book        raw chain side { bid, ask, bidQty, askQty, ltp }
 *   quantity    our order size, in the same units as bidQty/askQty
 *   side        'BUY' | 'SELL'
 *   strike      the strike being traded
 *   atmStrike   current ATM strike
 *   strikeStep  the instrument's strike interval
 *   cfg         from execution-config.get(strategy)
 *   now, quoteAt
 *
 * @returns {{ pass:boolean, reasons:string[], checks:object[], book:object }}
 */
function check({ book, quantity, side = 'BUY', strike, atmStrike, strikeStep, cfg, now = Date.now(), quoteAt = null }) {
  const checks = [];
  const reasons = [];
  const add = (name, pass, detail, measured) => {
    checks.push({ name, pass, detail, measured });
    if (!pass) reasons.push(detail);
  };

  const snap = snapshot(book, { now, quoteAt });
  if (!snap.ok) {
    add('book', false, snap.reason, null);
    return { pass: false, reasons, checks, book: snap };
  }
  add('book', true, `bid ${snap.bid} / ask ${snap.ask}, mid ${snap.mid}`, snap.mid);

  // ── 1. relative spread ────────────────────────────────────────────────────
  const maxRel = cfg.EXEC_MAX_REL_SPREAD;
  add('relSpread', snap.relSpread <= maxRel,
    `relative spread ${(snap.relSpread * 100).toFixed(2)}% ${snap.relSpread <= maxRel ? 'within' : 'exceeds'} the ${(maxRel * 100).toFixed(2)}% limit`,
    snap.relSpread);

  // ── 2. top-of-book depth against our size ────────────────────────────────
  const topQty = topQtyFor(snap, side);
  const need = quantity * cfg.EXEC_MIN_TOP_QTY_MULTIPLE;
  if (topQty === null) {
    // Absent depth is refused, not assumed. This is the single most tempting
    // place in the module to "just let it through".
    add('depth', false, 'top-of-book quantity not reported — refusing rather than assuming it is sufficient', null);
  } else {
    add('depth', topQty >= need,
      `${side === 'SELL' ? 'bid' : 'ask'} shows ${topQty} against an order of ${quantity} (needs ${need}, ${cfg.EXEC_MIN_TOP_QTY_MULTIPLE}×)`,
      topQty);
  }

  // ── 3. staleness ─────────────────────────────────────────────────────────
  if (snap.quoteAgeMs === null) {
    add('staleness', false, 'quote carries no timestamp — age unknown, so freshness cannot be asserted', null);
  } else {
    add('staleness', snap.quoteAgeMs <= cfg.EXEC_MAX_QUOTE_AGE_MS,
      `quote is ${snap.quoteAgeMs} ms old (limit ${cfg.EXEC_MAX_QUOTE_AGE_MS} ms)`,
      snap.quoteAgeMs);
  }

  // ── 4. distance from the money ───────────────────────────────────────────
  const s = num(strike), a = num(atmStrike), step = num(strikeStep);
  if (s === null || a === null || !(step > 0)) {
    add('band', false, 'strike, ATM or strike step unknown — cannot establish the liquidity band', null);
  } else {
    const steps = Math.abs(s - a) / step;
    add('band', steps <= cfg.EXEC_LIQUIDITY_BAND_STEPS,
      `${steps.toFixed(0)} strike steps from ATM (band is ${cfg.EXEC_LIQUIDITY_BAND_STEPS})`,
      steps);
  }

  // ── 5. premium floor ─────────────────────────────────────────────────────
  /* Not in the original four, and it belongs here. One tick is ₹0.05: on a
     ₹0.50 option that is 10% of the premium, so the tick alone swamps any
     placement decision this layer could make. Below the floor there is no
     execution technique, only luck. */
  add('premiumFloor', snap.mid >= cfg.EXEC_MIN_PREMIUM,
    `mid ₹${snap.mid} ${snap.mid >= cfg.EXEC_MIN_PREMIUM ? 'at or above' : 'below'} the ₹${cfg.EXEC_MIN_PREMIUM} floor — one tick is ${(0.05 / snap.mid * 100).toFixed(1)}% of this premium`,
    snap.mid);

  return { pass: reasons.length === 0, reasons, checks, book: snap };
}

/**
 * Which liquidity bucket a book falls in. Used to slice the slippage report,
 * because a 1%-spread book and a 6%-spread book are different execution
 * problems and averaging them together hides both.
 */
function bucket(relSpread) {
  const r = num(relSpread);
  if (r === null) return 'unknown';
  if (r <= 0.005) return 'tight (≤0.5%)';
  if (r <= 0.015) return 'normal (0.5–1.5%)';
  if (r <= 0.03) return 'wide (1.5–3%)';
  if (r <= 0.06) return 'very wide (3–6%)';
  return 'illiquid (>6%)';
}

module.exports = { check, snapshot, bucket, topQtyFor };
