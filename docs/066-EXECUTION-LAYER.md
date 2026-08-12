# 066 — Execution Layer: limit placement, liquidity gating, slippage ledger

**ANTIGRAVITY PRO** · **Date:** 2026-07-30 · **Status:** built, tested, OFF by default
**Suites:** 73/73 green · **New modules:** `execution-config.js`, `liquidity-gate.js`,
`limit-order-engine.js`, `slippage-ledger.js`

---

## 0. Read this first — the brief's premise needs one correction

The brief says:

> *"Currently orders are sent as market orders, which loses roughly half the
> spread on every entry and exit."*

The first half is true of the **code path** — `afternoon-engine.js` builds
`orderType: 'MARKET'`. The second half has never happened, because:

```js
// upstox-connector.js:369
async placeOrder(/* params */) {
  throw new Error('Upstox placeOrder not implemented — paper mode only');
}
```

**No order from this system has ever reached a broker.** **Grade: Verified.**

What the paper P&L actually charges today is this, from `afternoon-engine.js:539`:

```js
const slipPct = parseFloat(process.env.SLIPPAGE_PERCENT || 2) / 100;
const filledEntry = ltp * (1 + slipPct);
```

**A flat 2% of LTP.** Not derived from the book, and applied to LTP rather than
to the ask — so it does not even model crossing the spread. Measured against a
live chain on 2026-07-30:

| Strike | Book | Half-spread | The 2% assumption |
|---|---|---|---|
| NIFTY 24300 CE (ATM) | 106.10 / 106.55 | **0.21%** | ~10× too pessimistic |
| NIFTY 24800 CE | 3.05 / 3.20 | **2.40%** | about right |
| A ₹1.35 PE | 1.35 / 1.40 | **1.85%** | about right |

So the work is worth doing — but the thing being replaced is **an assumption,
not an observed cost**, and that changes what the acceptance test can prove (§6).

---

## 1. What was built

| Module | Lines | Responsibility |
|---|---|---|
| `execution-config.js` | 210 | Every threshold, with precedence and coherence checks |
| `liquidity-gate.js` | 175 | Book normalisation and six gates, each with a reason |
| `limit-order-engine.js` | 330 | Ladder, chase, timeout policy, slicing, fill model |
| `slippage-ledger.js` | 230 | Record every order; report by four axes |
| `test/execution-layer.test.js` | 300 | **97 checks** |

Endpoints: `/api/execution/config`, `/api/execution/status`,
`/api/execution/dry-run`, `/api/execution/slippage`, `/api/execution/enable`.

**Nothing is switched on.** `EXEC_ENGINE_ENABLED` defaults `false` and
`EXEC_PAPER_MODE` defaults `true` — two separate flags, because enabling the
engine and letting it send a real order are different decisions.

---

## 2. Requirement by requirement

### 2.1 Limit placement ✅

- Reference price is the **mid of best bid/ask**. LTP is used nowhere in this
  layer — a strike can show LTP ₹2,447 against a 2,456/2,689 book with zero
  volume, and pricing off that puts an order into a 9%-wide book believing it
  is at the market.
- Aggression is **in ticks**, not rupees. One tick is ₹0.05: 3.7% of a ₹1.35
  option and 0.025% of a ₹200 one. Ticks are the only unit that means the same
  thing across the chain.
- The chase steps one tick at a time up to `EXEC_MAX_CHASE_TICKS`, and **never
  past the touch** — chasing beyond the offer is a market order with extra steps.
- Buys round **down** to the tick, sells round **up**: each errs towards the
  passive side of its own order.
- Hard timeout, then an **explicit per-strategy policy**, always recorded:

| Strategy | Policy | Why |
|---|---|---|
| `STRANGLE` | **CANCEL** | The credit *is* the edge; a worse entry is directly worse expectancy |
| `GAMMA_BLAST` | **CROSS** | Being in the expiry move matters more than the entry |
| `BOUNCE`, `TREND_RIDE`, `AFTERNOON` | CANCEL | Directional buys with tight stops — a bad entry eats the stop distance |

### 2.2 Liquidity gate ✅ — six checks, not four

The four asked for, plus two the data demanded:

| Check | Refuses when |
|---|---|
| `relSpread` | `(ask−bid)/mid` exceeds `EXEC_MAX_REL_SPREAD` (default 6%) |
| `depth` | Top-of-book on **the side we must take** is below `quantity × EXEC_MIN_TOP_QTY_MULTIPLE` |
| `staleness` | Quote older than `EXEC_MAX_QUOTE_AGE_MS` — **or carrying no timestamp at all** |
| `band` | More than `EXEC_LIQUIDITY_BAND_STEPS` strike steps from ATM |
| **`premiumFloor`** | Mid below `EXEC_MIN_PREMIUM`. One tick is 10% of a ₹0.50 option — below the floor there is no execution technique, only luck |
| **`book`** | Missing bid or ask, non-positive quotes, or a **crossed book** |

**Every rejection is logged with its reason and every check is recorded whether
it passed or failed.** The report counts rejections by gate name.

**It fails closed, deliberately:**

- Absent depth is **refused**, not read as sufficient depth. This is the single
  most tempting bug in the module and it always passes.
- A quote with no timestamp is **refused** — freshness cannot be asserted, so it
  is not.
- A crossed book is **refused**, not averaged into a plausible-looking mid.
- A `BUY` is sized against **ask** quantity, a `SELL` against **bid**. Sizing a
  buy against bid depth is the version of this mistake that always passes.

### 2.3 Slicing ✅

Splits when the order exceeds `EXEC_SLICE_TOP_QTY_FRACTION` of visible top-of-book
(default 25%), with `EXEC_SLICE_DELAY_MS` between children and even child sizes.

**An order needing more than `EXEC_MAX_SLICES` children is refused, not dribbled.**
An order needing twenty slices in a book that thin is an order the book cannot take.

### 2.4 The ledger ✅

Per order: decision timestamp · **the exact book the decision saw** (bid, ask,
both quantities, mid, relative spread, quote age) · every gate check with its
measured value · the slicing decision · **every price the order was ever at,
with the book at that moment** · the final state · the fill price · slippage.

### 2.5 The report ✅

`/api/execution/slippage` returns mean **and** median, in **rupees and in ticks**,
sliced four ways: **per strategy · per instrument · per liquidity bucket ·
per time-of-day** (IST buckets — computed in UTC every bucket would be shifted
five and a half hours). Plus rejections by gate.

---

## 3. The part that decides whether any of this is honest

A paper execution simulator can be written to fill every limit at its limit
price. It will report beautiful slippage for a strategy that would in reality
have sat unfilled while the move happened without it.

Four rules prevent that, and most of the 97 tests exist to hold them:

**1. A marketable limit fills at the TOUCH, not at the limit.** Sending a buy
limit of 100.60 into an offer of 100.50 gets you 100.50. A simulator that fills
it at 100.60 invents money.

**2. Placement and resting are different questions.** The first version of the
engine collapsed them, which made the "traded through" branch unreachable for a
buy — `L ≥ ask` and `ask < L` are the same condition on one snapshot. The real
distinction:

- *At placement:* marketable or not.
- *Once resting:* a passive order that gets crossed into **prints at its own
  price**, because price-time priority gives the resting order its price. **That
  is the only way a limit genuinely beats the touch, and it is the entire
  economic point of resting rather than crossing.**

**3. Touching our price is not a fill.** When the far side reaches our limit
there is size ahead of us in a queue we cannot see. Counted as no fill.
`allowJoinFill` exists, is off, and must be switched on deliberately.

**4. An unfilled order has slippage `null`, never 0.** A strategy filling 40% of
the time and recording zeros for the rest would report a perfect average. Every
aggregate carries its **fill rate** beside it, and the fill rate is measured
against *attempted* orders — a strict gate is not a bad fill rate.

---

## 4. What the first live runs showed

Dry-run against the real NIFTY book on 2026-07-30. **Grade: Measured.**

| Strike | Spread | Strategy | Outcome | Saved vs market order |
|---|---|---|---|---|
| 24300 CE (ATM) | 0.42% | GAMMA_BLAST | walked all 5 rungs, **CROSSED** | **0 ticks** |
| 24300 CE | 0.42% | STRANGLE | **UNFILLED**, cancelled | — (trade missed) |
| 24700 CE | 3.69% | GAMMA_BLAST | filled on chase at the ask | **0 ticks** |
| 24800 CE | 4.80% | GAMMA_BLAST | filled on chase at the ask | **0 ticks** |

**The layer saved nothing on any of them, and the report says so.** That is the
result an optimistic simulator would have hidden, and there are two real reasons
for it:

1. **These books are only two to three ticks wide.** NIFTY 24800 CE at 3.05/3.20
   is three ticks; mid to touch is 1.5 ticks. There is almost nowhere to place.
   The maximum a limit order can ever save is half the spread, and half of three
   ticks is not worth a 20-second delay on an expiry-day gamma trade.
2. **The saving is only realised by RESTING and being hit.** A configuration that
   starts aggressive and crosses at timeout captures none of it — correctly, for
   a strategy that needs the fill. The saving and the missed trade are the same
   trade-off seen from two sides.

**The honest conclusion so far:** on ATM and near-ATM NIFTY, the spread is too
narrow for placement policy to matter much. The thesis in the brief — that the
gain is away from ATM — is right in principle, but the gate refuses most of those
strikes for other reasons, which is itself the finding.

### A config defect the first run exposed

`GAMMA_BLAST` builds a 5-rung ladder, re-prices every 3,000 ms, and times out at
8,000 ms. **Rungs 4 and 5 can never be reached.** The order looks like it is
chasing to the touch and in fact gives up two ticks short of it. Every knob was
individually valid.

`execution-config.get()` now returns `_warnings` for exactly this class, and
`/api/execution/status` surfaces them.

---

## 5. Constraints

| Constraint | How |
|---|---|
| Broker rate limits | `EXEC_MIN_ACTION_GAP_MS` floors the time between any two order actions; `EXEC_MAX_AMENDS_PER_ORDER` caps re-prices independently of the chase maths. Quote traffic is already governed by the connector — order traffic is separate and stricter |
| Batch cancels | `EXEC_BATCH_CANCELS` is honoured where the API exposes it. **Upstox's connector implements no order methods at all**, so this is a declared intent, not a tested path |
| Everything in config | 20 knobs, no magic numbers in the engine or the gate. A value that will not coerce falls back to its default and is **reported** — a NaN threshold would make every comparison false, which *opens* the gate |
| No behaviour change without a flag | Both flags default off/paper. The existing `orderType: 'MARKET'` path is untouched so the two can run side by side |

---

## 6. The acceptance criterion — what it can and cannot prove

> *"Run the new execution path in paper mode alongside the existing one for a
> full week and produce a comparison of realised slippage between the two."*

**This cannot be run as written, and the reason matters more than the obstacle.**

### 6.1 What "realised slippage" would mean on each side

| Path | What its number is |
|---|---|
| **Existing** | `ltp × 1.02`. A **constant**. It does not vary with the book, the strike, or the day |
| **New** | Whatever the fill model says |

Comparing them measures **the difference between two assumptions**, not between
two executions. Write an optimistic fill model and the new path wins by
construction — and the number would be believed, because it would carry a
ledger, a report and four axes of breakdown behind it.

### 6.2 What a week of paper CAN produce, and it is worth having

Three of these are **real measurements**, not simulations:

1. **A spread census.** For every strike the bot would have traded: the actual
   bid, ask, depth and quote age at decision time. This is observed data, and the
   system has never recorded it before. On its own it tells you what execution is
   worth attempting.

2. **A measured market-order cost.** What crossing the observed spread would
   actually have cost, per order — replacing the flat 2%. This is arithmetic over
   observed quotes, and it is the number that should replace
   `SLIPPAGE_PERCENT` in every backtest.

3. **Gate rejection statistics.** How many intended trades the liquidity rules
   refuse, and under which rule. If the gate refuses 40% of the strategy's
   trades, that is a strategy change, not an execution improvement, and it must
   be seen before anything is switched on.

4. **A limit-path counterfactual** — evidence-based but still a model. Fills are
   decided from whether the observed book actually came through the limit price,
   not assumed. It is the best available answer and it is **not** a measurement.

### 6.3 The three prerequisites, and one is already the session's largest finding

| # | Needed | Status |
|---|---|---|
| 1 | The collector runs **09:15–15:30** | **12 of 13 archived sessions are missing the market open** (61–358 min). A week of comparison over half-days is not a week |
| 2 | **Persist bid/ask/depth per strike.** The chain carries them live; the archive stores premium OHLC only | Not stored. Without it the counterfactual can only be computed live, never re-run |
| 3 | Decide the fill model's queue assumption *before* collecting | `allowJoinFill` is off. Turning it on later, after seeing results, is how a study talks itself into an answer |

### 6.4 What I recommend instead

**Run the dry-run path on every signal for a week — placing nothing.**
`/api/execution/dry-run` already walks the whole path and writes a full ledger
row without sending an order. That produces items 1–4 above with no risk and no
change to the existing engines, and the deliverable is a real report:

> *"Over N trades in week 1: measured market-order cost X ticks (mean) / Y
> (median), by strike bucket; the gate would have refused Z% and here is why;
> the limit path would have filled F% and saved S ticks on those, missing (1−F)%
> whose cost is Unknown."*

**That last clause is the one I would not drop.** The cost of a missed entry is
the P&L of a trade never taken, and this ledger does not observe it. A comparison
that reports slippage saved without reporting trades missed is not a comparison —
and it always favours the passive path.

---

## 7. Verification

| Check | Result |
|---|---|
| `test/execution-layer.test.js` | **97 checks** |
| Full suite | **73/73 green** |
| Live dry-run | ATM and two wide strikes, gate passed, ladder walked, ledger written |
| Config coherence | GAMMA_BLAST's unreachable rungs detected and surfaced |
| Silent-catch ratchet | held at 112 — a new empty catch in `clear()` was caught and given a real message |
| Default behaviour | engine off, paper on, existing market-order path untouched |

---

## Summary

The execution layer is built, tested and switched off. It prices from the book,
gates on six measured conditions, chases in ticks, applies an explicit
per-strategy timeout policy, slices against visible depth, and records every
order in enough detail to audit a fill months later.

Three things I would want said back to me before anything is enabled:

1. **The market-order cost being replaced was never measured** — it is a flat 2%
   of LTP, roughly right on cheap options and about ten times too pessimistic at
   the money.
2. **On the books measured so far, the limit path saved nothing**, because NIFTY
   near the money is two to three ticks wide and the saving is bounded by half of
   that. The layer's value is a hypothesis, and this ledger is how it gets tested.
3. **A week of paper cannot compare two executions**, only two models. What it
   can produce — a real spread census, a measured market-order cost, and gate
   rejection rates — is worth more than the comparison that was asked for, and is
   available with the dry-run path placing nothing at all.
