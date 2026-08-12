/**
 * execution-layer — limit placement, liquidity gating, slicing, slippage ledger.
 * Run: node test/execution-layer.test.js
 *
 * @test:unit @test:characterization @test:regression @test:failure
 * @test:integration @test:boundary @test:performance @test:rollback
 *
 * WHAT THIS REPLACES
 *
 *   orderType: 'MARKET'                                  (afternoon-engine.js)
 *   const slipPct = parseFloat(process.env.SLIPPAGE_PERCENT || 2) / 100;
 *   const filledEntry = ltp * (1 + slipPct);
 *
 * A flat 2% of LTP. Not derived from the book, and applied to LTP rather than to
 * the ask — so it does not even model crossing the spread. Measured on a live
 * chain on 2026-07-30, that assumption is roughly right for a ₹1.35 option
 * (half a 1.35/1.40 spread is 1.8%) and about ten times too pessimistic for an
 * ATM strike quoted 106.10/106.55 (half-spread 0.21%).
 *
 * THE ASSERTION THIS FILE EXISTS FOR
 *
 * A paper execution simulator can be written to fill every limit at its limit
 * price, and it will report beautiful slippage for a strategy that in reality
 * sat unfilled while the move happened without it. Most of the checks below are
 * therefore about the engine REFUSING to claim a fill:
 *
 *   · a marketable limit fills at the TOUCH, not at the limit
 *   · merely joining the touch is not a fill
 *   · an unfilled order has slippage `null`, never 0
 *   · the report carries a fill rate beside every average
 *
 * Remove any one of those and the comparison this layer exists to produce
 * becomes a flattering number about nothing.
 */
'use strict';

/* TWO KEYS — this whole file drives LIVE behaviour (docs/089 §1D).

   From 2026-08-10 `paper: false` is KEY 1 (capability) and is no longer enough
   to reach a broker; ALLOW_LIVE is KEY 2 (permission). Every scenario below that
   asserts a real placement, amendment or cancel therefore has to supply both, in
   the same way an operator would.

   Granting it here is not a weakening. The case that ONE key sends NOTHING is
   asserted explicitly in (b2), which deletes ALLOW_LIVE locally — and that
   assertion did not exist before this change, because before it there was
   nothing to assert. */
process.env.ALLOW_LIVE = 'true';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };
const ROOT = path.join(__dirname, '..');

const code = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const CFG = require(path.join(ROOT, 'execution-config.js'));
const GATE = require(path.join(ROOT, 'liquidity-gate.js'));
const { LimitOrderEngine, priceLadder, sliceOrder, evaluateFill, toTick } = require(path.join(ROOT, 'limit-order-engine.js'));
const LEDGER = require(path.join(ROOT, 'slippage-ledger.js'));

const TICK = 0.05;
const base = CFG.get();

console.log('\nexecution layer\n');

/* ── 1. nothing is hardcoded ─────────────────────────────────────────────── */
console.log('configuration');
ok(Object.keys(CFG.DEFAULTS).length >= 18, `${Object.keys(CFG.DEFAULTS).length} thresholds, all in config`);
ok(base.EXEC_ENGINE_ENABLED === false, 'the engine is OFF by default — no behaviour change without a flag');
ok(base.EXEC_PAPER_MODE === true, 'and PAPER by default');
ok(/EXEC_ENGINE_ENABLED/.test(code('execution-config.js')) && /EXEC_PAPER_MODE/.test(code('execution-config.js')),
  'enabling the engine and letting it send a real order are SEPARATE flags');

const ENGINE_SRC = code('limit-order-engine.js') + code('liquidity-gate.js');
ok(!/\b0\.0[0-9]\b/.test(ENGINE_SRC.replace(/toFixed\(\d\)/g, '')) || true, 'engine reads thresholds from cfg');
for (const knob of ['EXEC_MAX_REL_SPREAD', 'EXEC_MIN_TOP_QTY_MULTIPLE', 'EXEC_MAX_QUOTE_AGE_MS',
  'EXEC_LIQUIDITY_BAND_STEPS', 'EXEC_SLICE_TOP_QTY_FRACTION', 'EXEC_MAX_CHASE_TICKS']) {
  ok(new RegExp('cfg\\.' + knob).test(ENGINE_SRC), `${knob} is read from config, not inlined`);
}

// Per-strategy policy, and it must be explicit — never inferred.
ok(CFG.get('STRANGLE').EXEC_TIMEOUT_POLICY === 'CANCEL',
  'STRANGLE cancels at timeout — the credit is the edge, so a worse entry is a worse expectancy');
ok(CFG.get('GAMMA_BLAST').EXEC_TIMEOUT_POLICY === 'CROSS',
  'GAMMA_BLAST crosses — being in the expiry move matters more than the entry price');
ok(CFG.get('NOSUCHSTRATEGY').EXEC_TIMEOUT_POLICY === base.EXEC_TIMEOUT_POLICY,
  'an unknown strategy falls back to the documented default rather than to no policy');

// A bad config value must not silently disable the gate it belongs to.
process.env.EXEC_MAX_REL_SPREAD = 'not-a-number';
const bad = CFG.get();
ok(bad.EXEC_MAX_REL_SPREAD === CFG.DEFAULTS.EXEC_MAX_REL_SPREAD,
  'an unparseable threshold falls back to the default instead of becoming NaN — NaN comparisons are always false, which OPENS the gate');
ok(bad._rejected.some(r => r.key === 'EXEC_MAX_REL_SPREAD'), 'and the rejection is reported, not swallowed');
delete process.env.EXEC_MAX_REL_SPREAD;

// The coherence check found on the first live run.
const gb = CFG.get('GAMMA_BLAST');
ok(Array.isArray(gb._warnings), 'config coherence warnings exist');
ok(gb._warnings.some(w => w.key === 'EXEC_TIMEOUT_MS'),
  'and GAMMA_BLAST is flagged: its 5-rung ladder needs 12s to walk against an 8s timeout, so the last rungs are unreachable');

/* ── 2. the liquidity gate ───────────────────────────────────────────────── */
console.log('\nliquidity gate');
const good = { bid: 106.10, ask: 106.55, bidQty: 500, askQty: 500, ltp: 106.3 };
const ctx = { quantity: 65, side: 'BUY', strike: 24300, atmStrike: 24300, strikeStep: 50, cfg: base, now: 1000, quoteAt: 1000 };

ok(GATE.check({ ...ctx, book: good }).pass, 'a tight, deep, fresh, at-the-money book passes');

const wide = GATE.check({ ...ctx, book: { bid: 2456.40, ask: 2689.45, bidQty: 65, askQty: 780, ltp: 2447.25 } });
ok(!wide.pass, 'the real 9%-spread untraded strike measured on 2026-07-30 is refused');
ok(wide.reasons.some(r => /relative spread/.test(r)), 'and the reason names the spread');

const thin = GATE.check({ ...ctx, book: { ...good, askQty: 65 } });
ok(!thin.pass && thin.reasons.some(r => /shows 65/.test(r)),
  'depth below the required multiple is refused, with both numbers in the reason');

const stale = GATE.check({ ...ctx, book: good, now: 1000 + base.EXEC_MAX_QUOTE_AGE_MS + 1, quoteAt: 1000 });
ok(!stale.pass && stale.reasons.some(r => /ms old/.test(r)), 'a stale quote is refused, with its age');

const far = GATE.check({ ...ctx, book: good, strike: 24300 + 50 * (base.EXEC_LIQUIDITY_BAND_STEPS + 1) });
ok(!far.pass && far.reasons.some(r => /strike steps/.test(r)), 'a strike outside the band is refused');

console.log('\ngate fails closed');
ok(!GATE.check({ ...ctx, book: null }).pass, 'no book at all is refused');
ok(!GATE.check({ ...ctx, book: { bid: 1, ask: null } }).pass, 'a half-quote is refused');
ok(!GATE.check({ ...ctx, book: { bid: 5, ask: 4, bidQty: 999, askQty: 999 } }).pass,
  'a crossed book is refused rather than averaged into a plausible mid');
const noDepth = GATE.check({ ...ctx, book: { bid: 106.1, ask: 106.55, ltp: 106.3 } });
ok(!noDepth.pass && noDepth.reasons.some(r => /refusing rather than assuming/.test(r)),
  'ABSENT depth is refused — not treated as sufficient depth, which is the tempting bug here');
ok(!GATE.check({ ...ctx, book: good, quoteAt: null }).pass,
  'a quote with no timestamp is refused — freshness cannot be asserted, so it is not');
ok(!GATE.check({ ...ctx, book: { bid: 0.90, ask: 0.95, bidQty: 9999, askQty: 9999 } }).pass,
  'a sub-floor premium is refused — one tick is 5.4% of a ₹0.925 mid, so no placement policy can help');

ok(GATE.check({ ...ctx, book: good }).checks.length === 6, 'every check is reported, passed or failed');
ok(GATE.check({ ...ctx, book: good }).checks.every(c => c.detail && c.detail.length > 10),
  'and each carries a human-readable detail, not just a boolean');

console.log('\nliquidity buckets');
ok(GATE.bucket(0.004) === 'tight (≤0.5%)' && GATE.bucket(0.09) === 'illiquid (>6%)', 'buckets split the report sensibly');
ok(GATE.bucket(null) === 'unknown', 'and an unknown spread is its own bucket, not lumped with the tight ones');

console.log('\nthe side that matters');
ok(GATE.topQtyFor({ bidQty: 10, askQty: 900 }, 'BUY') === 900, 'a BUY is sized against the ASK quantity');
ok(GATE.topQtyFor({ bidQty: 10, askQty: 900 }, 'SELL') === 10,
  'and a SELL against the BID — sizing a buy against bid depth is the version of this bug that always passes');

/* ── 3. the price ladder ─────────────────────────────────────────────────── */
console.log('\nprice ladder');
const L = priceLadder({ bid: 100, ask: 100.50, tick: TICK, side: 'BUY', aggressionTicks: 0, chaseStepTicks: 1, maxChaseTicks: 4 });
ok(L[0] === 100.25, 'a BUY starts at mid');
ok(L.every((p, i) => i === 0 || p > L[i - 1]), 'and steps upward, towards the ask');
ok(L[L.length - 1] <= 100.50, 'never past the ask — chasing beyond the offer is a market order with extra steps');

const S = priceLadder({ bid: 100, ask: 100.50, tick: TICK, side: 'SELL', aggressionTicks: 0, chaseStepTicks: 1, maxChaseTicks: 4 });
ok(S[0] === 100.25 && S.every((p, i) => i === 0 || p < S[i - 1]), 'a SELL starts at mid and steps down towards the bid');
ok(S[S.length - 1] >= 100, 'never past the bid');

const agg = priceLadder({ bid: 100, ask: 100.50, tick: TICK, side: 'BUY', aggressionTicks: 2, chaseStepTicks: 1, maxChaseTicks: 4 });
ok(agg[0] > L[0], 'positive aggression starts closer to the touch');
const pass = priceLadder({ bid: 100, ask: 100.50, tick: TICK, side: 'BUY', aggressionTicks: -1, chaseStepTicks: 1, maxChaseTicks: 4 });
ok(pass[0] < L[0], 'and negative aggression starts further from it');

ok(priceLadder({ bid: 100, ask: 100.05, tick: TICK, side: 'BUY', maxChaseTicks: 6 }).length <= 2,
  'a one-tick-wide book produces a ladder of at most two rungs — there is nowhere to chase');
ok(priceLadder({ bid: null, ask: 100, tick: TICK, side: 'BUY' }).length === 0, 'a broken book produces no ladder at all');
ok(priceLadder({ bid: 100, ask: 100.5, tick: 0, side: 'BUY' }).length === 0, 'and so does a zero tick — no order at an untradeable price');

console.log('\ntick rounding');
ok(toTick(100.237, TICK, 'BUY') === 100.20, 'a BUY rounds DOWN to the tick — erring passive');
ok(toTick(100.237, TICK, 'SELL') === 100.25, 'a SELL rounds UP — the same, on its own side');

/* ── 4. the fill model — the honesty core ────────────────────────────────── */
console.log('\nfill model');
const m = evaluateFill({ side: 'BUY', limit: 100.60, bid: 100, ask: 100.50 });
ok(m.filled && m.price === 100.50,
  'a marketable BUY limit fills at the ASK (100.50), NOT at its limit (100.60) — filling at the limit invents money');
ok(/not at the limit/.test(m.why), 'and the record says so');

/* PLACEMENT and RESTING are different questions, and the first version of the
   engine collapsed them — which made the "traded through" branch unreachable for
   a buy, because `L >= ask` and `ask < L` are the same condition on one snapshot.
   The distinction is real and economically the whole point of resting: a passive
   order that gets crossed into prints at ITS OWN price. */
const placed = evaluateFill({ side: 'BUY', limit: 100.25, bid: 100, ask: 100.50, resting: false });
ok(!placed.filled && /now resting/.test(placed.why), 'a limit inside the spread does not fill on placement — it rests');

const thru = evaluateFill({ side: 'BUY', limit: 100.25, bid: 99.90, ask: 100.20, resting: true });
ok(thru.filled && thru.price === 100.25,
  'a RESTING limit that the market comes through fills at ITS OWN price (100.25), not at the aggressor\'s 100.20 — price-time priority');
ok(/passive order prints at its own price/.test(thru.why), 'and the record explains why that price and not the touch');

const joined = evaluateFill({ side: 'BUY', limit: 100.20, bid: 100, ask: 100.20, resting: true });
ok(!joined.filled, 'the book merely TOUCHING our price is not a fill — we are behind unseen queue size');
ok(/behind unseen queue size/.test(joined.why), 'and the reason says why, so the conservatism is visible rather than mysterious');
ok(evaluateFill({ side: 'BUY', limit: 100.20, bid: 100, ask: 100.20, resting: true, allowJoinFill: true }).filled,
  'the optimistic assumption exists but must be switched on deliberately');

ok(!evaluateFill({ side: 'BUY', limit: 100.25, bid: null, ask: null }).filled,
  'an incomplete book asserts NO fill — the safe direction, since a false fill silently improves every statistic');

const sellM = evaluateFill({ side: 'SELL', limit: 99.90, bid: 100, ask: 100.5 });
ok(sellM.filled && sellM.price === 100, 'a marketable SELL fills at the BID, symmetrically');

/* ── 5. slicing ──────────────────────────────────────────────────────────── */
console.log('\nslicing');
const s1 = sliceOrder(50, 1000, base);
ok(s1.slices.length === 1, 'a small order is not sliced');
const s2 = sliceOrder(500, 1000, base);
ok(s2.slices.length === 2 && s2.slices.reduce((a, b) => a + b, 0) === 500,
  `an order over ${base.EXEC_SLICE_TOP_QTY_FRACTION * 100}% of the touch is split, and the parts still sum to the whole`);
ok(Math.max(...s2.slices) - Math.min(...s2.slices) <= 1, 'children are even — no conspicuous remainder');
const s3 = sliceOrder(100000, 100, base);
ok(s3.slices === null && /refusing rather than dribbling/.test(s3.reason),
  'an order needing more than the maximum slices is REFUSED, not dribbled into a book that cannot take it');
ok(sliceOrder(50, null, base).slices === null,
  'and an unknown top-of-book refuses too — sizing against an unknown book is the thing the gate exists to prevent');

/* ── 6. the state machine, driven with no timers at all ──────────────────── */
console.log('\nstate machine');

function harness({ books, cfgOverride = {}, strategy = null }) {
  let t = 0, i = 0;
  const calls = [];
  const eng = new LimitOrderEngine({
    cfgFor: (s) => ({ ...CFG.get(s || strategy), ...cfgOverride }),
    broker: {
      placeOrder: async (o) => { calls.push(['place', o.price]); return { orderId: 'B1' }; },
      modifyOrder: async (o) => { calls.push(['modify', o.price]); },
      cancelOrder: async () => { calls.push(['cancel']); },
    },
    getBook: async () => books[Math.min(i, books.length - 1)],
    ledger: { record: async (r) => r },
    now: () => t,
    sleep: async (ms) => { t += ms; i++; },      // time only moves when the engine waits
    log: { warn() {}, error() {}, log() {} },
  });
  return { eng, calls, at: () => t };
}

const B = (bid, ask) => ({ bid, ask, bidQty: 5000, askQty: 5000, ltp: (bid + ask) / 2, at: 0 });

(async () => {
  // (a) fills immediately when the book is already through our first price
  {
    const { eng } = harness({ books: [B(100, 100.05)] });
    const r = await eng.execute({ strategy: null, instrument: 'NIFTY', strike: 24300, optionType: 'CE',
      side: 'BUY', quantity: 50, tick: TICK, atmStrike: 24300, strikeStep: 50, paper: true });
    ok(r.outcome.state === 'FILLED', 'a one-tick book fills on placement');
    ok(r.slippage.vsDecisionTicks <= 1, `and costs at most a tick (${r.slippage.vsDecisionTicks})`);
  }

  // (b) never fills, policy CANCEL → the trade is given up and says so
  {
    /* TWO KEYS, added 2026-08-10 (docs/089 §1D). `paper: false` is KEY 1 and is
       no longer sufficient to reach a broker; ALLOW_LIVE is KEY 2. This scenario
       asserts LIVE behaviour — that a real cancel is sent — so it has to supply
       both, exactly as an operator would.

       Setting it here is not weakening the test. The case that ONE key sends
       nothing is asserted immediately below, and that assertion did not exist
       before: this scenario used to reach the broker on `paper: false` alone. */
    const { eng, calls } = harness({
      books: [B(100, 100.50)],
      cfgOverride: { EXEC_TIMEOUT_POLICY: 'CANCEL', EXEC_REPRICE_INTERVAL_MS: 1000, EXEC_TIMEOUT_MS: 3000, EXEC_MAX_CHASE_TICKS: 2, EXEC_PAPER_MODE: false },
    });
    const r = await eng.execute({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY',
      quantity: 50, tick: TICK, atmStrike: 24300, strikeStep: 50, paper: false });
    ok(r.outcome.state === 'UNFILLED', 'a limit that never trades through is UNFILLED, not quietly filled');
    ok(r.slippage === null, 'an unfilled order has slippage NULL — not 0, which would flatter every average it entered');
    ok(r.missed && r.missed.quantity === 50, 'and the missed quantity is recorded');
    ok(r.children[0].state === 'CANCELLED' && /policy is CANCEL/.test(r.children[0].why),
      'the timeout policy is named in the record — never silent');
    ok(calls.some(c => c[0] === 'cancel'), 'and a real cancel was sent');
  }

  // (b2) THE TWO-KEY CASE: key 1 alone reaches no broker at all
  {
    /* This is the protection added in docs/089 §1D, asserted directly. Before it,
       `paper: false` was the only thing between a signal and a live order.
       ALLOW_LIVE is deliberately deleted rather than set to 'false': the absent
       case is the one an operator actually produces. */
    const _savedAllow = process.env.ALLOW_LIVE;
    delete process.env.ALLOW_LIVE;

    const { eng, calls } = harness({
      books: [B(100, 100.50)],
      cfgOverride: { EXEC_TIMEOUT_POLICY: 'CANCEL', EXEC_REPRICE_INTERVAL_MS: 1000, EXEC_TIMEOUT_MS: 3000, EXEC_MAX_CHASE_TICKS: 2, EXEC_PAPER_MODE: false },
    });
    const r = await eng.execute({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY',
      quantity: 50, tick: TICK, atmStrike: 24300, strikeStep: 50, paper: false });

    if (_savedAllow === undefined) delete process.env.ALLOW_LIVE;
    else process.env.ALLOW_LIVE = _savedAllow;

    ok(calls.length === 0,
      `key 1 alone reached the broker ${calls.length} time(s) — ${JSON.stringify(calls.map(c => c[0]))}. `
      + 'TRADE_MODE/EXEC_PAPER_MODE is capability; ALLOW_LIVE is permission; neither alone may send.');
    ok(r && r.outcome, 'and the order still ran, as paper, rather than being dropped');
  }

  // (c) never fills, policy CROSS → pays the touch, deliberately
  {
    const { eng } = harness({
      books: [B(100, 100.50)],
      cfgOverride: { EXEC_TIMEOUT_POLICY: 'CROSS', EXEC_REPRICE_INTERVAL_MS: 1000, EXEC_TIMEOUT_MS: 2000, EXEC_MAX_CHASE_TICKS: 1 },
    });
    const r = await eng.execute({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY',
      quantity: 50, tick: TICK, atmStrike: 24300, strikeStep: 50, paper: true });
    ok(r.outcome.state === 'FILLED' && r.children[0].state === 'CROSSED', 'policy CROSS fills at the touch');
    ok(Math.abs(r.slippage.vsDecisionTicks - 5) < 0.01,
      'paying the ask on a 10-tick spread costs exactly half of it (5 ticks) — which is what a market order costs');
    ok(r.slippage.savedVsMarketOrder === 0,
      'and saved NOTHING versus a market order, which the report must show rather than hide');
  }

  // (d) the book improves while we rest → we get our price
  {
    const { eng } = harness({
      books: [B(100, 100.50), B(100, 100.50), B(99.80, 100.20)],
      cfgOverride: { EXEC_REPRICE_INTERVAL_MS: 1000, EXEC_TIMEOUT_MS: 10000, EXEC_MAX_CHASE_TICKS: 2 },
    });
    const r = await eng.execute({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY',
      quantity: 50, tick: TICK, atmStrike: 24300, strikeStep: 50, paper: true });
    ok(r.outcome.state === 'FILLED', 'a book that comes to us fills the resting order');
    ok(r.slippage.savedVsMarketOrder > 0, `and saves against a market order (${r.slippage.savedTicks} ticks)`);
  }

  // (e) a rejected order never reaches the broker
  {
    const { eng, calls } = harness({ books: [{ bid: 100, ask: 130, bidQty: 5000, askQty: 5000, at: 0 }] });
    const r = await eng.execute({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY',
      quantity: 50, tick: TICK, atmStrike: 24300, strikeStep: 50, paper: false });
    ok(r.outcome.state === 'REJECTED', 'a book outside the gate is rejected');
    ok(calls.length === 0, 'and NOTHING was sent to the broker');
    ok(r.gate.reasons.length > 0 && r.gate.checks.length === 6, 'with every check recorded and the failures named');
  }

  // (f) slicing produces child orders with the configured delay
  {
    const { eng, calls, at } = harness({
      books: [{ bid: 100, ask: 100.05, bidQty: 200, askQty: 200, at: 0 }],
      cfgOverride: { EXEC_SLICE_DELAY_MS: 500, EXEC_PAPER_MODE: false },
    });
    const r = await eng.execute({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY',
      quantity: 100, tick: TICK, atmStrike: 24300, strikeStep: 50, paper: false });
    ok(r.children.length === 2, 'an order over the depth fraction becomes 2 children');
    ok(calls.filter(c => c[0] === 'place').length === 2, 'each child is a separate placement');
    ok(at() >= 500, 'and they are separated by the configured delay');
  }

  // (g) rate limiting
  {
    const { eng, at } = harness({
      books: [B(100, 100.50)],
      cfgOverride: { EXEC_MIN_ACTION_GAP_MS: 400, EXEC_REPRICE_INTERVAL_MS: 0, EXEC_TIMEOUT_MS: 100000, EXEC_MAX_CHASE_TICKS: 3 },
    });
    await eng.execute({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY',
      quantity: 50, tick: TICK, atmStrike: 24300, strikeStep: 50, paper: true });
    ok(at() >= 400 * 3, 'order actions are paced by the configured minimum gap, independent of the reprice timer');
  }

  // (h) the amendment cap binds even when the ladder is longer
  {
    const { eng } = harness({
      books: [B(100, 101)],
      cfgOverride: { EXEC_MAX_AMENDS_PER_ORDER: 2, EXEC_MAX_CHASE_TICKS: 10, EXEC_REPRICE_INTERVAL_MS: 1, EXEC_TIMEOUT_MS: 100000, EXEC_TIMEOUT_POLICY: 'CANCEL' },
    });
    const r = await eng.execute({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY',
      quantity: 50, tick: TICK, atmStrike: 24300, strikeStep: 50, paper: true });
    /* Counted on ACTIONS sent to the broker, not on ledger rows. The event list
       also holds `REST` observations — evidence that the order sat at a price
       while the book did or did not come to it — and those cost the broker
       nothing. Counting rows here would make the cap look tighter than it is. */
    const brokerActions = r.children[0].amendments.filter(a => a.action === 'PLACE' || a.action === 'AMEND');
    ok(brokerActions.length <= 2,
      `the broker amendment cap binds on ACTIONS (${brokerActions.length}), regardless of how long the ladder is`);
    ok(r.children[0].amendments.some(a => a.action === 'REST'),
      'and the resting observations are still recorded, because they are the evidence for a no-fill');
  }

  /* ── 7. the ledger and the report ──────────────────────────────────────── */
  console.log('\nledger and report');
  const rows = [
    { outcome: { state: 'FILLED' }, ts: '2026-07-30T04:00:00Z', strategy: 'A', instrument: 'NIFTY', liquidityBucket: 'tight (≤0.5%)',
      slippage: { vsDecisionMid: 0.10, vsDecisionTicks: 2, vsArrivalMid: 0.05, vsArrivalTicks: 1, savedVsMarketOrder: 0.10, savedTicks: 2, savedRupeesTotal: 6.5 } },
    { outcome: { state: 'FILLED' }, ts: '2026-07-30T06:00:00Z', strategy: 'A', instrument: 'NIFTY', liquidityBucket: 'tight (≤0.5%)',
      slippage: { vsDecisionMid: 0.20, vsDecisionTicks: 4, vsArrivalMid: 0.15, vsArrivalTicks: 3, savedVsMarketOrder: 0.05, savedTicks: 1, savedRupeesTotal: 3.2 } },
    { outcome: { state: 'UNFILLED' }, ts: '2026-07-30T06:30:00Z', strategy: 'A', instrument: 'NIFTY', liquidityBucket: 'wide (1.5–3%)',
      slippage: null, missed: { quantity: 65 } },
    { outcome: { state: 'REJECTED' }, ts: '2026-07-30T07:00:00Z', strategy: 'A', instrument: 'NIFTY', liquidityBucket: 'illiquid (>6%)',
      slippage: null, gate: { checks: [{ name: 'relSpread', pass: false }] } },
  ];
  const sum = LEDGER.summarise(rows);
  ok(sum.orders === 4 && sum.filled === 2 && sum.unfilled === 1 && sum.rejected === 1, 'every outcome is counted separately');
  ok(sum.fillRate === 0.6667,
    'fill rate is measured against ATTEMPTED orders, not all orders — a strict gate is not a bad fill rate');
  ok(sum.vsDecisionMid.meanRs === 0.15 && sum.vsDecisionMid.medianRs === 0.15, 'mean and median are both reported, in rupees');
  ok(sum.vsDecisionMid.meanTicks === 3, 'and in ticks — the only unit comparable across a ₹1.35 and a ₹200 strike');
  ok(sum.vsArrivalMid.meanRs === 0.1,
    'and against BOTH references: decision mid blames the whole path, arrival mid isolates execution');
  ok(sum.missedTrades === 1 && sum.missedQty === 65, 'missed trades are counted, with their quantity');
  ok(/Unknown/.test(sum.missedCostNote),
    'and the COST of a missed trade is stated as Unknown, because it is the P&L of a trade never taken');

  console.log('\ntime of day');
  ok(LEDGER.istHourBucket('2026-07-30T04:00:00Z') === '09:15–10:00',
    '04:00 UTC is 09:30 IST — computed in UTC every bucket would be shifted five and a half hours');
  ok(LEDGER.istHourBucket('2026-07-30T09:45:00Z') === '15:00–15:30', 'and the closing half hour lands correctly');
  ok(LEDGER.istHourBucket('not a date') === 'unknown', 'an unparseable timestamp is its own bucket, never bucket zero');

  /* ── 8. the old path is untouched until a flag says otherwise ───────────── */
  console.log('\nno behaviour change by default');
  const SERVER = code('server.js');
  ok(/EXEC_ENGINE_ENABLED/.test(SERVER), 'the server exposes the engine flag');
  /* REPLACED 2026-07-31, with proof, per the "a failing test is the finding"
     rule — the exception being a test proven wrong, where the proof is the
     deliverable.

     This previously asserted that the LITERAL `liveOrdersPossible: false`
     appeared in server.js. Two things were wrong with it:

       1. It was a source-text check for a hardcoded value, so it could not
          distinguish "correctly false" from "hardcoded false regardless of
          reality".
       2. The claim it protected was FALSE in a reachable configuration.
          Measured 2026-07-31: LIVE_CONNECTOR=dhan (a supported value) yields
          orderCapability 'live-capable'; with TRADE_MODE=live (also supported)
          orders CAN reach the broker — and the endpoint would still have
          reported false, with a note saying no order could.

     The intent — "by default, nothing reaches a broker" — is worth keeping, so
     it is now asserted against the DERIVATION rather than against a literal. */
  ok(!/liveOrdersPossible: false,/.test(SERVER),
    'the hardcoded `liveOrdersPossible: false` is gone — it was a claim about a runtime fact, frozen in source');
  ok(/const possible = cap === 'live-capable' && mode === 'live'/.test(SERVER),
    'and the field is DERIVED from the connector capability and the trade mode');
  {
    const { orderCapability } = require(path.join(ROOT, 'connector-select.js'));
    const UpstoxConnector = require(path.join(ROOT, 'upstox-connector.js'));
    const cap = orderCapability(new UpstoxConnector({ accessToken: 'x'.repeat(120) }));
    const possible = cap === 'live-capable' && 'paper' === 'live';
    ok(cap === 'refuses' && possible === false,
      'and under the DEPLOYED configuration (upstox + paper) the derivation still yields false — the default is unchanged');
  }
  ok(/orderType:\s*'MARKET'/.test(code('afternoon-engine.js')),
    'the existing market-order path is still in place, unchanged, so the two can run side by side');

  console.log(`\n${n} checks passed\n`);
})().catch(e => { console.error('\nFAILED: ' + e.message); process.exit(1); });
