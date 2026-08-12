# 068 — Margin Awareness and Optimisation

**ANTIGRAVITY PRO** · **Date:** 2026-07-30 · **Status:** built, tested, live-verified
**Suites:** 75/75 green · **New modules:** `margin-calculator.js`, `margin-optimiser.js`,
`margin-monitor.js` · **Tests:** 74 checks · **Report:** `npm run margin:report`

---

## 1. The measurement that justifies the whole thing

`position-sizer.js:45` sizes strangles against this:

```js
marginPerLotStrangle: parseFloat(process.env.SIZER_STRANGLE_MARGIN || 130000)
```

Measured against the live broker calculator on 2026-07-30, NIFTY 2026-08-04
expiry, one lot per leg:

| | |
|---|---|
| Broker's final margin, short strangle 23900P/24700C | **₹1,80,959** |
| The assumption | **₹1,30,000** |
| Error | **−28.2%** |

**A sizer using that number takes roughly 1.4× the lots the account can actually
carry.** Not a rounding difference — the difference between a position that fits
and a margin call.

**Grade: Verified.** `POST /v2/charges/margin` returned 200 with a full
SPAN/exposure breakdown. (`/v3/charges/margin` returns 404; the v2 path is the
one that exists.)

---

## 2. The hedge number, which no formula would have produced

Same expiry, one lot per leg, all figures from the broker:

| Structure | Legs summed | **Final margin** | Basket benefit |
|---|---|---|---|
| Single naked short CE 24700 | ₹1,50,836 | **₹1,50,404** | ₹432 (0.3%) |
| Naked short strangle 23900P/24700C | ₹1,82,470 | **₹1,80,959** | ₹1,511 (0.8%) |
| Iron condor, wings at 23400P/25200C | ₹1,82,769 | **₹92,694** | **₹90,075 (49.3%)** |

> **Adding the protective wings releases ₹88,265 — 48.8% of the margin — for the
> cost of two long options.**

Two things follow, and both are structural rather than opinions:

1. **A basket must be priced as a basket.** The legs summed and the final margin
   differ by 49% on the condor. Any per-leg model gets this wrong by construction.
2. **The benefit exists only while both legs are open** — which is why §6 is a
   safety rule and not a preference.

---

## 3. The broker is the source of truth; everything else is a cache

Four labels, and a caller cannot confuse them because the strict accessor returns
only the first two:

| `source` | Meaning |
|---|---|
| `broker` | The exchange calculator answered |
| `cache` | A previous broker answer, inside TTL — stale ones carry `stale: true` and their age |
| `estimate` | A local approximation. **`validated: false`**, carries a warning, and **`requireBroker()` will not return it** |
| `null` | We do not know, and nothing proceeds on it |

**When the broker fails and there is no cached answer, no margin is returned at
all.** It does not fall back to a formula: that would turn a transient API failure
into a silently wrong margin, which is the worst of the three outcomes because it
is the only one that looks like success.

A stale broker figure *is* served — marked stale, with its age and the failure —
because a real number from four minutes ago beats an invented one from now.

**An uncalibrated estimate is refused outright.** `estimate()` without a
per-lot figure returns `ok: false`, because an estimate with no calibration is a
guess with a label.

### Rate limits

Measured in the tests: five requests for the same basket cost **one** broker call;
three concurrent requests are **coalesced into one**. The basket key is
order-independent, so a strangle priced PE-first and CE-first is one cache entry
rather than two.

---

## 4. Return on margin is the ranking metric

```
returnOnMargin = expectedEdge / marginBlocked
```

Ranking by rupee edge asks *"which trade makes the most"*. Ranking by return on
margin asks *"which trade makes the most per rupee the account cannot use for
anything else"* — the question a capital-constrained book actually faces.

**The case the requirement is about**, from the tests: two candidates with the
**same** ₹9,000 expected edge. By rupees they are identical. By return on margin
the hedged structure wins **1.96×**, because it blocks half the capital.

And where the two metrics disagree, the report says so:

> *"Ranking by return on margin picks 'smaller rupees, light margin' where ranking
> by rupee edge would have picked 'big rupees, heavy margin'."*

₹6,000 on ₹92,694 beats ₹10,000 on ₹1,80,959.

**Candidates that could not be priced are returned separately**, not dropped.
Silently ranking only what could be priced would make an API failure look like an
absence of opportunities.

---

## 5. Acceptance — per-strategy return on margin, before and after

`npm run margin:report`, live broker figures, 2026-08-04 expiry:

| Strategy | RoM naked | RoM hedged | Multiple | Margin released | Credit given up | **Tail risk** |
|---|---|---|---|---|---|---|
| **SHORT_STRANGLE** | 4.97% | **7.12%** | 1.43× | ₹88,265 (48.8%) | ₹2,400 (26.7%) | **UNBOUNDED → ₹32,500** |
| **SHORT_STRADDLE** | 7.32% | **12.23%** | 1.67× | ₹1,11,043 (58.1%) | ₹4,200 (30.0%) | **UNBOUNDED → ₹32,500** |
| **SINGLE_SHORT_CALL** | 2.99% | **5.46%** | 1.83× | ₹90,002 (59.8%) | ₹1,200 (26.7%) | **UNBOUNDED → ₹32,500** |

### How to read it

Return on margin rises in every case **and** the credit falls in every case.
Those are two halves of the same trade: a hedged book earns less per trade and
can hold more trades at once.

**The tail-risk column is not a trade-off.** A naked short option has no maximum
loss. The report prints **UNBOUNDED** rather than any number, because every
number that could go there would be wrong. Capping it is not a price paid for
margin efficiency — it is the reason the margin was that high to begin with.

### What is measured and what is not

- **Measured:** every margin figure, from the broker, today.
- **Assumed:** the credits, which are each strategy's own expectation. Change them
  and every return-on-margin moves proportionally — **the ratio between naked and
  hedged does not**, because the margins are real.

---

## 6. The unwind order is a safety rule with a number behind it

The margin benefit exists only while both legs are open. Close a protective wing
first and the position is instantly a naked short.

`unwindPlan()` enforces **shorts first, protective longs last**, prices every
intermediate state with the broker, and prints what the wrong order would cost:

> Closing the wings first takes the position from **₹92,694 to ₹1,80,959** — the
> instant the account is least able to absorb it.

A property the tests pin rather than assert as advice: **in the safe order the
margin falls monotonically**, so a position that fitted before the unwind fits at
every step. A breach in that order would mean the position was already over the
limit. With ₹1,20,000 available, the safe order fits and the unsafe one breaches —
which is the entire reason the rule exists.

---

## 7. Utilisation, headroom, and refusing before the broker does

**The number that matters is the projected peak, not current use.** An account at
43% with two working orders that would take it to 82% is at 82% for every decision
purpose; the only thing between it and a shortfall is that the orders have not
filled yet, and they were sent because someone wanted them to.

`projectedPeak = used + every working order + the order being approved`

| Level | Threshold | Action |
|---|---|---|
| `OK` | < 70% | — |
| `WARN` | ≥ 70% | Warn |
| `STOP_ENTRIES` | ≥ 85% | No new entries |
| `HARD` | ≥ 95% | **Trips the kill switch** |
| `UNKNOWN` | not computable | **Blocks** — and is not "OK" |

### Fail closed, specifically

- **One** unpriced working order makes the projection `null` — not "the rest of it".
- Unknown total margin makes utilisation, headroom and the level all `null`.
  Headroom is never *"total minus null"*.
- A **5% buffer** is held back below the limit, because the exchange revises SPAN
  intraday without notice and a shortfall carries a **penalty**, not a rejection.

### The risk layer refuses first

A new `marginHeadroom` check sits in `risk-manager.js`. **An intent with no margin
verdict is UNEVALUABLE and blocks** — so the pricing step cannot be skipped by
forgetting it.

The distinction is kept: a basket that could not be priced is `UNEVALUABLE`; one
priced and too large is `BLOCKED`.

> **Why refusing beats being rejected.** A broker margin rejection arrives after
> the order has been sent, possibly after a partial fill on a multi-leg basket —
> and a half-filled hedge is a naked short.

---

## 8. Reconciliation makes the estimator measurable

Every estimate is recorded beside the broker figure that replaced it. The real
assumption, scored:

```
estimated ₹1,30,000 · broker ₹1,80,959 · error −₹50,959 (−28.16%)
```

`accuracy()` reports mean and median absolute error, the worst case, and a bias
note that names the direction:

> *"biased LOW (under-estimates margin — the dangerous direction)"*

With no samples it returns `null`, not zero, and says **"UNVALIDATED, not
accurate"** — because *no samples* and *perfect* must never share a display.

---

## 9. Verification

| Check | Result |
|---|---|
| Broker margin API | **Verified live** — v2 returns 200 with SPAN/exposure; v3 returns 404 |
| `test/margin-layer.test.js` | **74 checks** |
| `test/risk-layer.test.js` | 106 checks (updated for the margin verdict) |
| Full suite | **75/75 green** |
| Acceptance report | 3 strategies, live figures, tail risk stated alongside |
| Leg validation | every leg checked before the call — a malformed basket returns a margin for something else |

---

## 10. What is left, and stated rather than left to be found

| Item | Status |
|---|---|
| `position-sizer.js` still uses ₹1,30,000 | **Not changed.** It is the sizer used by a live paper engine, and swapping a synchronous constant for an async broker call is a change to that engine's shape. `/api/margin/status` returns the assumption, the broker figure and the error so it is visible until it is fixed |
| Actual margin blocked per position over time | The ledger and `record()` exist; **populating it needs live positions**, and no order has ever reached a broker |
| Zerodha / Dhan calculators | Only the Upstox path is implemented and verified. The calculator takes any broker exposing `getBasketMargin`, so a second one is an adapter, not a redesign |
| Credits in the acceptance report | The strategies' own expectations, labelled as such. The **ratios** do not depend on them |

---

## Summary

The broker's calculator is now the only source of margin in this system, and the
first thing it revealed is that the sizer has been **28% low** on the main
engine's structure — enough to size 1.4× too large.

The second thing it revealed is worth more: **protective wings release nearly half
the margin**, which raises return on margin by 1.4× to 1.8× across all three short
structures while costing about a quarter to a third of the credit.

Those two facts are reported side by side and **not resolved into a
recommendation**, because a capital-constrained account and a risk-constrained one
want different answers — and the module knows neither.

The one column that is not a trade-off is tail risk. **UNBOUNDED → capped** is not
a cost of margin efficiency. It is what the margin was for.
