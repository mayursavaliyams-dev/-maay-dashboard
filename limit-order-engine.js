/* ═══════════════════════════════════════════════════════════════════════════
   limit-order-engine — place at mid, chase towards the touch, stop at a policy.

   WHAT IT REPLACES
   `orderType: 'MARKET'`, which takes whatever the book offers. On a book quoted
   1.35/1.40 that is 3.6% given away on entry and again on exit. On the ₹200
   strikes it is far less. The point of this layer is that the difference is
   MEASURED per order rather than assumed at a flat percentage.

   THE STATE MACHINE
       GATED ──✗──> REJECTED (with reasons)
         │✓
       SLICED ──> for each child:
                    PLACED ──fill──> FILLED
                       │ no fill after reprice interval
                       ↓
                    AMENDED (one chase step towards the touch)
                       │ … up to maxChase or maxAmends …
                       ↓
                    TIMEOUT ──policy──> CANCELLED | CROSSED

   THE PAPER FILL MODEL, WHICH IS THE PART THAT DECIDES WHETHER ANY OF THIS IS
   HONEST

   A limit order is not a fill. In paper it is trivial to write a simulator that
   fills every limit at its limit price, and it will report beautiful slippage
   for a strategy that would in reality have sat unfilled while the move
   happened without it.

   So the paper model here fills ONLY on observed book evidence:

     · A BUY limit at L is marketable if L ≥ ask. It fills IMMEDIATELY — and it
       fills at the ASK, not at L. Sending a limit above the offer does not get
       you a better price than the offer; a simulator that fills it at L invents
       money.
     · A resting BUY limit at L fills when the ask trades DOWN THROUGH it
       (ask < L). Merely equalling it (ask == L) means we joined the queue at
       that price behind existing size, which is `JOINED`, not `FILLED`.
       Conservative, and deliberately so: the optimistic version of this
       assumption is the single largest source of fake backtest edge in
       execution work.
     · No fill by the deadline is a REAL outcome and is recorded as one. The
       report counts unfilled orders, because slippage measured only on the
       orders that filled is survivorship bias — and it always flatters the
       passive strategy.

   Everything is injected: the broker, the clock and the book feed. Nothing here
   reads a global, so the whole state machine can be driven deterministically in
   a test without waiting a single millisecond.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const gate = require('./liquidity-gate');
const { maySendLive } = require('./live-permission');

const num = (v) => (v === null || v === undefined || !isFinite(Number(v))) ? null : Number(v);

/* Round to the instrument's tick. An order at a price that is not a multiple of
   the tick is rejected by the exchange, and rounding it the wrong way turns a
   passive order into an aggressive one. Buys round DOWN, sells round UP: each
   errs towards the passive side of its own order. */
function toTick(price, tick, side) {
  const p = num(price), t = num(tick);
  if (p === null || !(t > 0)) return null;
  const n = p / t;
  const r = String(side).toUpperCase() === 'BUY' ? Math.floor(n + 1e-9) : Math.ceil(n - 1e-9);
  return +(r * t).toFixed(4);
}

/**
 * The ladder of prices this order will walk, first to last.
 *
 * A BUY starts at mid (plus aggression) and steps UP towards the ask.
 * A SELL starts at mid (minus aggression) and steps DOWN towards the bid.
 * The ladder never goes past the touch: chasing beyond the offer is a market
 * order with extra steps, and the timeout policy — not the chase — is what is
 * allowed to cross.
 *
 * Pure. No clock, no broker, no state.
 */
function priceLadder({ bid, ask, tick, side, aggressionTicks = 0, chaseStepTicks = 1, maxChaseTicks = 4 }) {
  const b = num(bid), a = num(ask), t = num(tick);
  if (b === null || a === null || !(t > 0)) return [];
  const buy = String(side).toUpperCase() === 'BUY';
  const mid = (b + a) / 2;
  const step = Math.max(1, Math.round(chaseStepTicks));
  const maxChase = Math.max(0, Math.round(maxChaseTicks));

  // Aggression moves the FIRST price towards the touch we must cross.
  const start = toTick(mid + (buy ? 1 : -1) * aggressionTicks * t, t, side);
  if (start === null) return [];

  const touch = buy ? a : b;
  const out = [];
  for (let moved = 0; moved <= maxChase; moved += step) {
    let p = +(start + (buy ? 1 : -1) * moved * t).toFixed(4);
    // Never step past the touch. Reaching it exactly is allowed — that is
    // joining the offer, not lifting it.
    if (buy ? p > touch : p < touch) p = touch;
    if (out.length && out[out.length - 1] === p) break;   // clamped; no further progress
    out.push(p);
    if (p === touch) break;
  }
  return out;
}

/**
 * Split an order so it never shows more than a configured fraction of the touch.
 *
 * Returns { slices:[qty…], reason } or { slices:null, reason } when the order is
 * too large to work at all — which is a REFUSAL, not a longer dribble. An order
 * needing twenty children in a book this thin is an order the book cannot take.
 */
function sliceOrder(quantity, topQty, cfg) {
  const q = num(quantity), top = num(topQty);
  if (!(q > 0)) return { slices: null, reason: 'order quantity is not positive' };
  if (top === null || !(top > 0)) {
    return { slices: null, reason: 'top-of-book quantity unknown — refusing to size against an unknown book' };
  }
  const maxChild = Math.max(1, Math.floor(top * cfg.EXEC_SLICE_TOP_QTY_FRACTION));
  if (q <= maxChild) return { slices: [q], reason: `single order — ${q} is within ${(cfg.EXEC_SLICE_TOP_QTY_FRACTION * 100).toFixed(0)}% of the ${top} showing` };

  const n = Math.ceil(q / maxChild);
  if (n > cfg.EXEC_MAX_SLICES) {
    return {
      slices: null,
      reason: `order of ${q} needs ${n} slices against ${top} showing (max ${cfg.EXEC_MAX_SLICES}) — refusing rather than dribbling into a book this thin`,
    };
  }
  // Even children, so the last one is not a conspicuous remainder.
  const base = Math.floor(q / n), extra = q - base * n;
  const slices = Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
  return { slices, reason: `${n} slices of ~${base} against ${top} showing at the touch` };
}

/**
 * Would this limit fill against this book, and at what price?
 *
 * Returns { filled, price, why }. The `why` is carried into the ledger so a
 * fill can be explained months later without re-deriving it.
 */
function evaluateFill({ side, limit, bid, ask, resting = false, allowJoinFill = false }) {
  const buy = String(side).toUpperCase() === 'BUY';
  const L = num(limit), b = num(bid), a = num(ask);
  if (L === null || b === null || a === null) return { filled: false, price: null, why: 'book incomplete — no fill asserted' };

  const touch = buy ? a : b;
  const far = buy ? a : b;

  /* AT PLACEMENT the only question is whether we are marketable. If we are, we
     take the far side and we pay ITS price. */
  if (!resting) {
    if (buy ? L >= far : L <= far) {
      return { filled: true, price: touch, why: `marketable on placement — limit ${L} ${buy ? '≥ ask' : '≤ bid'} ${touch}, filled at the touch, not at the limit` };
    }
    return { filled: false, price: null, why: `placed inside the spread at ${L}; ${buy ? 'ask' : 'bid'} is ${touch} — now resting` };
  }

  /* ONCE RESTING the question is different, and this is the distinction the
     first version of this function collapsed. A resting order is passive, so
     when an aggressor crosses into it the trade prints at OUR price, not at
     theirs — price-time priority gives the resting order its own price. That is
     the one case where a limit genuinely beats the touch, and it is the entire
     economic point of resting rather than crossing. */
  if (buy ? far < L : far > L) {
    return { filled: true, price: L, why: `the market came through the resting limit (${buy ? 'ask' : 'bid'} ${touch}); the passive order prints at its own price ${L}` };
  }
  /* The far side merely reached us. The book is touching our price and a trade
     may be happening — but at that price there is already size ahead of us in
     the queue, and we cannot see our position in it. Counted as NOT filled. */
  if (far === L) {
    return allowJoinFill
      ? { filled: true, price: L, why: 'touched at our price and assumed filled (allowJoinFill is ON — optimistic, queue position unknown)' }
      : { filled: false, price: null, why: `book touched our price ${L} but we are behind unseen queue size — not counted as a fill` };
  }
  return { filled: false, price: null, why: `still resting at ${L}, ${buy ? 'ask' : 'bid'} is ${touch}` };
}

/* ═══════════════════════════════════════════════════════════════════════════
   The engine
   ═══════════════════════════════════════════════════════════════════════════ */
class LimitOrderEngine {
  /**
   * @param {object} deps
   *   cfgFor(strategy)  → execution-config.get
   *   broker            { placeOrder, modifyOrder, cancelOrder, cancelMany? }
   *   getBook(ctx)      → the live { bid, ask, bidQty, askQty, ltp, at } for the instrument
   *   ledger            slippage-ledger
   *   now()             clock, injected so tests need no timers
   *   sleep(ms)         injected for the same reason
   *   log               console-like
   */
  constructor(deps = {}) {
    this.cfgFor = deps.cfgFor || require('./execution-config').get;
    this.broker = deps.broker || null;
    this.getBook = deps.getBook || null;
    this.ledger = deps.ledger || require('./slippage-ledger');
    this.now = deps.now || (() => Date.now());
    this.sleep = deps.sleep || ((ms) => new Promise(r => setTimeout(r, ms)));
    this.log = deps.log || console;
    this._lastActionAt = 0;
  }

  /* Broker rate limiting. The connector governs QUOTE traffic; order traffic is
     separate and stricter everywhere. This is a floor between any two actions,
     not a token bucket — a simple rule that cannot itself fail confusingly. */
  async _pace(cfg) {
    const gapNeeded = cfg.EXEC_MIN_ACTION_GAP_MS - (this.now() - this._lastActionAt);
    if (gapNeeded > 0) await this.sleep(gapNeeded);
    this._lastActionAt = this.now();
  }

  /**
   * Execute one order.
   *
   * @returns a full record: the gate result, the book the decision saw, every
   *          amendment, the outcome and the computed slippage. The same object
   *          is written to the ledger.
   */
  async execute(req) {
    const {
      strategy, instrument, strike, optionType, side = 'BUY', quantity,
      tick, atmStrike, strikeStep, securityId = null, paper = null, reason = null,
    } = req;

    const cfg = this.cfgFor(strategy);
    const isPaper = paper === null ? cfg.EXEC_PAPER_MODE : !!paper;
    const t0 = this.now();

    const rec = {
      id: `EX-${t0}-${Math.abs(hash(`${instrument}${strike}${optionType}${side}${t0}`)) % 100000}`,
      strategy: strategy || null, instrument, strike, optionType, side, quantity,
      securityId, paper: isPaper, reason,
      decidedAt: new Date(t0).toISOString(),
      config: pickCfg(cfg),
      // Amendments live on the child that made them. There is deliberately no
      // top-level copy: an empty array here read as "no amendments were made"
      // on the first live run, when in fact the child had walked five rungs.
      children: [],
      outcome: null,
    };

    // ── the book the decision saw. Recorded before anything else, because it
    //    is the only thing that makes the slippage number auditable later. ────
    let book;
    try { book = await this.getBook(req); }
    catch (e) { book = null; rec.bookError = e.message; }

    const g = gate.check({
      book, quantity, side, strike, atmStrike, strikeStep, cfg,
      now: t0, quoteAt: book && book.at,
    });
    rec.decisionBook = g.book;
    rec.gate = { pass: g.pass, reasons: g.reasons, checks: g.checks };
    rec.liquidityBucket = gate.bucket(g.book && g.book.relSpread);

    if (!g.pass) {
      rec.outcome = { state: 'REJECTED', why: g.reasons.join(' · ') };
      this.log.warn(`[exec] REJECTED ${instrument} ${strike}${optionType} ${side} — ${g.reasons.join(' · ')}`);
      await this.ledger.record(rec);
      return rec;
    }

    // ── slicing ──────────────────────────────────────────────────────────────
    const topQty = gate.topQtyFor(g.book, side);
    const sl = sliceOrder(quantity, topQty, cfg);
    rec.slicing = { topQty, reason: sl.reason, slices: sl.slices };
    if (!sl.slices) {
      rec.outcome = { state: 'REJECTED', why: sl.reason };
      this.log.warn(`[exec] REJECTED ${instrument} ${strike}${optionType} — ${sl.reason}`);
      await this.ledger.record(rec);
      return rec;
    }

    // The mid at the moment of decision, and the mid at the moment the first
    // child is sent. Slippage is reported against BOTH: the first measures the
    // whole decision-to-fill path, the second isolates what execution itself
    // cost after the delay of getting to the market.
    rec.decisionMid = g.book.mid;
    rec.arrivalMid = null;

    let filledQty = 0, notional = 0;
    for (let i = 0; i < sl.slices.length; i++) {
      if (i > 0) await this.sleep(cfg.EXEC_SLICE_DELAY_MS);
      const child = await this._workChild({
        rec, cfg, isPaper, side, tick, qty: sl.slices[i], index: i, req,
      });
      rec.children.push(child);
      if (rec.arrivalMid === null && child.arrivalMid !== null) rec.arrivalMid = child.arrivalMid;
      if (child.filled) { filledQty += child.qty; notional += child.fillPrice * child.qty; }
    }

    const avgFill = filledQty > 0 ? +(notional / filledQty).toFixed(4) : null;
    const dir = String(side).toUpperCase() === 'BUY' ? 1 : -1;

    rec.outcome = {
      // A partial fill is its own state. Rolling it into FILLED would let the
      // report average a 20%-filled order beside a complete one as though they
      // were the same event.
      state: filledQty === 0 ? 'UNFILLED' : (filledQty < quantity ? 'PARTIAL' : 'FILLED'),
      filledQty, requestedQty: quantity,
      fillRate: +(filledQty / quantity).toFixed(4),
      avgFillPrice: avgFill,
    };

    /* Slippage, signed so that POSITIVE always means WORSE THAN THE REFERENCE,
       for a buy and for a sell alike. Reported in rupees per unit and in ticks,
       because a rupee figure is not comparable across a ₹1.35 strike and a ₹200
       one and the tick is the only unit that is. */
    if (avgFill !== null) {
      const vsDecision = dir * (avgFill - rec.decisionMid);
      const vsArrival = rec.arrivalMid === null ? null : dir * (avgFill - rec.arrivalMid);
      rec.slippage = {
        vsDecisionMid: +vsDecision.toFixed(4),
        vsDecisionTicks: tick > 0 ? +(vsDecision / tick).toFixed(2) : null,
        vsArrivalMid: vsArrival === null ? null : +vsArrival.toFixed(4),
        vsArrivalTicks: (vsArrival !== null && tick > 0) ? +(vsArrival / tick).toFixed(2) : null,
        rupeesTotal: +(vsDecision * filledQty).toFixed(2),
        // What a market order would have paid on the SAME book — the honest
        // comparator, since it is measured from the observed touch rather than
        // from a flat assumed percentage.
        marketOrderWouldHavePaid: dir * ((side.toUpperCase() === 'BUY' ? g.book.ask : g.book.bid) - rec.decisionMid),
      };
      rec.slippage.savedVsMarketOrder = +(rec.slippage.marketOrderWouldHavePaid - vsDecision).toFixed(4);
      rec.slippage.savedTicks = tick > 0 ? +(rec.slippage.savedVsMarketOrder / tick).toFixed(2) : null;
      rec.slippage.savedRupeesTotal = +(rec.slippage.savedVsMarketOrder * filledQty).toFixed(2);
    } else {
      /* An unfilled order has no slippage — and it is NOT zero slippage. It is a
         missed trade, and the report counts it separately. Writing 0 here would
         let a strategy that fills 40% of the time show a perfect average. */
      rec.slippage = null;
      rec.missed = { quantity, reason: 'no fill within the timeout policy' };
    }

    rec.completedAt = new Date(this.now()).toISOString();
    rec.elapsedMs = this.now() - t0;
    await this.ledger.record(rec);
    return rec;
  }

  /* One child order: place, chase, then apply the timeout policy. */
  /* TWO KEYS. docs/085, docs/089 §1D.
       KEY 1  EXEC_PAPER_MODE=false  — this engine may act at all (`isPaper`)
       KEY 2  ALLOW_LIVE             — it may reach a broker

     Evaluated once per child rather than per ladder step: a permission that can
     change between the PLACE and the AMEND of the same order would leave a live
     order on the book that this process then refuses to modify, which is worse
     than either answer taken consistently.

     There is no exit exemption here because this engine only ever PLACES; the
     exit path lives in the engines above it. */
  _maySendLive(isPaper) {
    if (isPaper) return { allowed: false, reason: 'paper mode', key: 1 };
    return maySendLive({ capability: true, capabilityFlag: 'EXEC_PAPER_MODE', liveFlag: 'ALLOW_LIVE' });
  }

  async _workChild({ rec, cfg, isPaper, side, tick, qty, index, req }) {
    const child = {
      index, qty, amendments: [], filled: false, fillPrice: null,
      arrivalMid: null, ladder: null, state: null, why: null,
    };

    const startBook = await this._book(req);
    if (!startBook || !startBook.ok) {
      child.state = 'ABORTED';
      child.why = 'book unavailable at placement — no order sent';
      return child;
    }
    child.arrivalMid = startBook.mid;
    child.arrivalBook = startBook;

    const ladder = priceLadder({
      bid: startBook.bid, ask: startBook.ask, tick, side,
      aggressionTicks: cfg.EXEC_AGGRESSION_TICKS,
      chaseStepTicks: cfg.EXEC_CHASE_STEP_TICKS,
      maxChaseTicks: cfg.EXEC_MAX_CHASE_TICKS,
    });
    child.ladder = ladder;
    if (!ladder.length) {
      child.state = 'ABORTED';
      child.why = 'could not build a price ladder from this book';
      return child;
    }

    const deadline = this.now() + cfg.EXEC_TIMEOUT_MS;
    let brokerOrderId = null;

    /* Decided ONCE, before the ladder starts. See _maySendLive above. */
    const _perm = this._maySendLive(isPaper);
    if (!isPaper && !_perm.allowed) {
      console.warn(`[limit-order] LIVE SEND BLOCKED — ${_perm.reason}. Working this child as paper.`);
    }
    const _live = !isPaper && _perm.allowed;

    for (let step = 0; step < ladder.length; step++) {
      const limit = ladder[step];
      if (step >= cfg.EXEC_MAX_AMENDS_PER_ORDER) {
        child.why = `amendment cap reached (${cfg.EXEC_MAX_AMENDS_PER_ORDER})`;
        break;
      }

      await this._pace(cfg);
      const bookNow = await this._book(req);
      const action = step === 0 ? 'PLACE' : 'AMEND';

      if (_live) {
        try {
          if (step === 0) {
            const r = await this.broker.placeOrder({ ...req, quantity: qty, orderType: 'LIMIT', price: limit });
            brokerOrderId = r && (r.orderId || r.order_id) || null;
          } else {
            await this.broker.modifyOrder({ orderId: brokerOrderId, price: limit });
          }
        } catch (e) {
          child.state = 'BROKER_ERROR';
          child.why = `${action} failed: ${e.message}`;
          return child;
        }
      }

      /* Two questions, asked at two different moments, and collapsing them was
         the first bug this engine had.

         1. AT PLACEMENT — are we marketable? If so we take the touch now.
         2. AFTER RESTING — did the market come to us? A passive order that gets
            crossed into prints at ITS OWN price, which is the only way a limit
            order genuinely beats the touch. Checking only at placement would
            miss every one of those fills and make the passive path look strictly
            worse than it is. */
      const evPlace = evaluateFill({
        side, limit, resting: false,
        bid: bookNow && bookNow.bid, ask: bookNow && bookNow.ask,
      });
      child.amendments.push({
        at: new Date(this.now()).toISOString(), action, step, limit,
        book: bookNow ? { bid: bookNow.bid, ask: bookNow.ask, mid: bookNow.mid } : null,
        filled: evPlace.filled, why: evPlace.why,
      });

      if (evPlace.filled) {
        child.filled = true; child.fillPrice = evPlace.price;
        child.state = step === 0 ? 'FILLED_ON_PLACE' : 'FILLED_ON_CHASE';
        child.why = evPlace.why;
        return child;
      }

      if (this.now() >= deadline) { child.why = 'timeout reached mid-chase'; break; }
      await this.sleep(cfg.EXEC_REPRICE_INTERVAL_MS);

      // Now it has rested. Did the book come through our price while we waited?
      const bookAfter = await this._book(req);
      const evRest = evaluateFill({
        side, limit, resting: true,
        bid: bookAfter && bookAfter.bid, ask: bookAfter && bookAfter.ask,
      });
      child.amendments.push({
        at: new Date(this.now()).toISOString(), action: 'REST', step, limit,
        book: bookAfter ? { bid: bookAfter.bid, ask: bookAfter.ask, mid: bookAfter.mid } : null,
        filled: evRest.filled, why: evRest.why,
      });
      if (evRest.filled) {
        child.filled = true; child.fillPrice = evRest.price;
        child.state = 'FILLED_WHILE_RESTING';
        child.why = evRest.why;
        return child;
      }

      if (this.now() >= deadline) { child.why = 'timeout reached between amendments'; break; }
    }

    // ── the timeout policy. Explicit, per strategy, and always recorded. ─────
    const policy = String(cfg.EXEC_TIMEOUT_POLICY).toUpperCase();
    const finalBook = await this._book(req);

    if (policy === 'CROSS') {
      if (!finalBook || !finalBook.ok) {
        child.state = 'CANCELLED';
        child.why = `policy CROSS, but the book was unavailable to cross into — cancelled instead (${child.why || 'unfilled'})`;
        if (!isPaper && brokerOrderId) await this._safeCancel(brokerOrderId, cfg);
        return child;
      }
      const touch = String(side).toUpperCase() === 'BUY' ? finalBook.ask : finalBook.bid;
      await this._pace(cfg);
      if (!isPaper) {
        try { await this.broker.modifyOrder({ orderId: brokerOrderId, price: touch }); }
        catch (e) { child.state = 'BROKER_ERROR'; child.why = `cross failed: ${e.message}`; return child; }
      }
      child.amendments.push({
        at: new Date(this.now()).toISOString(), action: 'CROSS', step: -1, limit: touch,
        book: { bid: finalBook.bid, ask: finalBook.ask, mid: finalBook.mid },
        filled: true, why: `timeout policy CROSS — paid the ${side.toUpperCase() === 'BUY' ? 'ask' : 'bid'}`,
      });
      child.filled = true; child.fillPrice = touch; child.state = 'CROSSED';
      child.why = `unfilled after ${cfg.EXEC_TIMEOUT_MS} ms; strategy policy is CROSS, so the spread was paid deliberately`;
      return child;
    }

    if (!isPaper && brokerOrderId) await this._safeCancel(brokerOrderId, cfg);
    child.state = 'CANCELLED';
    child.why = `unfilled after ${cfg.EXEC_TIMEOUT_MS} ms; strategy policy is CANCEL, so the trade was given up (${child.why || 'no fill'})`;
    return child;
  }

  async _safeCancel(orderId, cfg) {
    await this._pace(cfg);
    try { await this.broker.cancelOrder({ orderId }); }
    catch (e) { this.log.warn(`[exec] cancel failed for ${orderId}: ${e.message} — the order may still be live`); }
  }

  async _book(req) {
    try {
      const raw = await this.getBook(req);
      const s = gate.snapshot(raw, { now: this.now(), quoteAt: raw && raw.at });
      return s.ok ? s : null;
    } catch (_) { return null; }
  }
}

function pickCfg(cfg) {
  const keep = ['EXEC_AGGRESSION_TICKS', 'EXEC_REPRICE_INTERVAL_MS', 'EXEC_CHASE_STEP_TICKS',
    'EXEC_MAX_CHASE_TICKS', 'EXEC_TIMEOUT_MS', 'EXEC_TIMEOUT_POLICY', 'EXEC_MAX_REL_SPREAD',
    'EXEC_MIN_TOP_QTY_MULTIPLE', 'EXEC_MAX_QUOTE_AGE_MS', 'EXEC_LIQUIDITY_BAND_STEPS',
    'EXEC_MIN_PREMIUM', 'EXEC_SLICE_TOP_QTY_FRACTION', 'EXEC_MAX_SLICES'];
  const out = {};
  for (const k of keep) out[k] = cfg[k];
  return out;
}

function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

module.exports = { LimitOrderEngine, priceLadder, sliceOrder, evaluateFill, toTick };
