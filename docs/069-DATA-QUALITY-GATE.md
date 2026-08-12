# 069 — Data Quality Gate

**ANTIGRAVITY PRO** · **Date:** 2026-07-30 · **Status:** built, tested, live-verified
**Suites:** 76/76 green · **New modules:** `data-quality.js`, `feed-health.js`,
`data-gate.js` · **Tests:** 78 checks including the three-scenario acceptance harness

---

## 1. Why one global staleness threshold is wrong

Measured on this system's own archive, 2026-07-29: of **662 strike-side series**
in a single session, **70 never printed a different price all day**, while the ATM
strikes moved constantly.

A single threshold is wrong in **both directions on the same chain at the same
moment**. Set it tight and every deep OTM strike is permanently "stale" although
it is behaving exactly as it always does. Set it loose and an ATM strike that has
died goes unnoticed for minutes.

So **each instrument is judged against its own trailing median inter-change gap**:

```
staleLimit = clamp( medianGap × 6 , floor 15 s , ceiling 15 min )
```

**Median, not mean.** The same archive contains one **42-minute** hole; a single
gap like that drags a mean far enough to make everything after it look fresh.

Verified in the tests: an ATM strike with a 2-second norm and a deep OTM strike
with a 5-minute norm get limits differing by more than 10×. After one minute of
silence **the ATM strike is stale and the deep OTM one is not** — which no single
threshold can express.

The floor stops a hyperactive instrument being called stale after 200 ms. The
ceiling stops any instrument being called fresh for ever, whatever its median.

### Freshness is measured from the last CHANGE, not the last snapshot

The poller re-delivers an identical quote every 2.5 seconds. Measuring from
snapshot arrival would make a dead instrument look permanently fresh — the exact
failure this module exists to catch.

---

## 2. OI is a separate clock

Open interest updates far more slowly than price and, on this feed, is
effectively a snapshot rather than a stream. Treating a fresh price as evidence
of fresh OI is how a strategy reads last hour's positioning as current.

The two clocks are tracked apart, and a consumer must **declare** which it needs.
A price-only decision is not blocked by hour-old OI — blocking it would stop
trading on every deep strike all day for no gain — but a consumer passing
`needsOi` is refused when the OI clock trips.

---

## 3. Eleven sanity checks, every one a flag

| Flag | Fires when |
|---|---|
| `CROSSED_BOOK` | bid ≥ ask |
| `OUT_OF_DAY_RANGE` | last price outside the day high/low **in the same snapshot** |
| `OUT_OF_BAND` | last price outside the exchange price band |
| `VOLUME_REGRESSION` | cumulative volume moved backwards |
| `OI_REGRESSION` | open interest fell beyond tolerance |
| `TIMESTAMP_REGRESSION` | this snapshot is older than the previous one |
| `CLOCK_SKEW` | exchange and receive time disagree implausibly |
| `DEPTH_MISSING` | no quoted size on an instrument that normally shows it |
| `STALE_PRICE` / `STALE_OI` / `NEVER_SEEN` | the freshness clocks |

**Nothing is corrected.** A crossed book is stored exactly as received and
flagged; the test asserts that `bid: 101, ask: 100` survives ingestion unchanged.
A repaired value is indistinguishable from a good one at the point of use, which
is precisely where the decision is made.

### The gate caught a real inconsistency on the live feed within minutes

```
NIFTY 23050 PE   ltp 1.75   day low 1.95   volume 3,916,575
NIFTY 26100 CE   ltp 0.45   day low 0.50
```

The snapshot contradicts itself: a last traded price below the day low it reports
in the same payload, on an instrument with 39 lakh volume. **Grade: Verified.**

### …and one of my own checks was violating the project's null rule

Also measured live: **19 of 186 strike-sides report `0` for a day high or low** on
strikes that have not traded. A zero there means *not reported*, not *a price of
zero*, and comparing an LTP against it would flag all nineteen. The check now
requires a positive range before it will judge — **this project's own
null-is-not-zero rule was being broken inside the module that enforces it.**

---

## 4. Feed health — reported honestly, including what does not exist

The requirement asks for websocket uptime, reconnect count and confirmed-vs-
intended subscriptions. On the live path **none of those exist**:

- `server.js` constructs an `UpstoxConnector`; the chain is obtained by **polled
  REST** with an adaptive interval (default 2,500 ms).
- `dhan-ws-feed.js` is a real websocket client, but it belongs to the **inactive**
  Dhan connector.
- The repo's own module-contract test already records: *"no WebSocket server
  exists; `ws` is used only as a broker client in dhan-ws-feed"*.

So the scorecard reports:

```json
"websocket": { "applicable": false, "state": "NOT_APPLICABLE",
               "uptimePct": null, "reconnects": null,
               "why": "the live path polls REST; the websocket client belongs to the inactive Dhan connector" }
```

> Reporting `uptime: 100%` for a connection that does not exist would be the most
> convincing number on the whole scorecard, and it would be fabricated — which is
> the one thing this gate exists to prevent.

**What is measured instead:** poll success rate, consecutive failures, cadence
adherence, outage open/close with durations, and **coverage** — instruments
ticking ÷ instruments expected. Coverage is the number that matters: a feed can
return 200s all day while half the chain has stopped updating, and only coverage
sees that.

Coverage with nothing declared returns `null`, not 100%. *"Watching nothing and
all of it is fine"* is not a health report.

---

## 5. The gates

| Gate | Behaviour |
|---|---|
| Instrument | Blocked if stale, never seen, or carrying a flag on the current snapshot |
| Strategy | Blocked unless **all** required instruments are trustworthy |
| Feed outage | Blocked, with the **declared policy** attached to the decision |

**One bad leg blocks the whole strategy.** A strangle priced off one good leg and
one stale one is not a strangle — it is a naked short with a decoration.

**A strategy that declares no required instruments cannot be cleared.** Unknown
data needs are not zero data needs.

### The outage policy is declared, not discovered

`HOLD` (default) or `FLATTEN`. There is deliberately **no third branch** meaning
*whatever the code happens to do*.

HOLD is the default because flattening during an outage means sending exit orders
priced from data just declared untrustworthy. That may still be right for a
short-gamma book near expiry — which is why it is configurable, and why the
`FLATTEN` path prints that warning rather than executing quietly.

---

## 6. A real bug the acceptance harness caught

The first version of the gate decided staleness by matching a **regular
expression against the human-readable reason**:

```js
const stale = a.reasons.some(r => /never been received/i.test(r));
```

The message reads *"no snapshot **has ever** been received"*. `ever` ≠ `never`, so
**an instrument that had never ticked at all was ALLOWED through the gate.**

`assess()` now returns structured `codes` and the gate switches on those. The rule
that follows: **a gate must not parse its own error messages.** The test was
rewritten the same way — it had the identical bug, one rewording away from passing
while the gate stood open.

---

## 7. Acceptance — three simulated failures, three blocks

| Scenario | Result |
|---|---|
| **Feed outage** | 5 consecutive poll failures open an outage. `checkInstrument` → `allowed: false, reason: FEED_OUTAGE`, with the declared policy on the decision. With `FLATTEN` configured, `requiresFlatten: true` and the exit-pricing warning appears |
| **Stale instrument** | The feed keeps polling successfully throughout — every poll returns 200 — and **one** instrument stops ticking. `allowed: false, reason: DATA_STALE`, with the age, the limit and the basis. This is the case a single global health check cannot see |
| **Crossed book** | `bid 101 / ask 100` → `allowed: false, reason: DATA_FLAGGED`, with the offending values. Once the book resolves the block **lifts** — a flag is about the current snapshot, not a permanent mark |

Plus: an instrument that has **never** ticked is blocked, with `freshness: null`
rather than an age of zero.

---

## 8. Observable now, not only at end of day

`/api/data-quality/status` is the live view: feed level, coverage, per-flag
counts, live decision tallies, and **currently-gated scopes with how long they
have been gated and why**.

`/api/data-quality/scorecard` is the daily summary — coverage, stale counts,
**undecidable counted separately from stale and fresh**, flag rates by type,
connection uptime, and every period during which trading was gated with its
reason and duration.

> Counting undecidable instruments as either fresh or stale is the quiet lie this
> whole module exists to prevent, so it gets its own column.

### Wired at one point

The gate observes every **fresh** chain snapshot inside `_buildOptionSnapshot`,
where the chain is actually built — not in each engine that consumes it. Cached
reads are deliberately **not** re-observed: counting the same snapshot twice would
halve every measured inter-tick gap and make a dying feed look twice as lively.

---

## 9. Live verification

Three real snapshots driven through the running server:

| | |
|---|---|
| Instruments tracked | **186** |
| Coverage | **100%** (186/186) |
| Fresh / stale / undecidable | 186 / 0 / 0 |
| Feed level | OK |
| Websocket | `NOT_APPLICABLE`, with the reason |
| Flags raised | **6** — all genuine `OUT_OF_DAY_RANGE` inconsistencies |

---

## 10. Verification

| Check | Result |
|---|---|
| `test/data-gate.test.js` | **78 checks**, including the three-scenario acceptance harness |
| Full suite | **76/76 green** |
| Live | 186 instruments, real flags raised, no false positives from zero ranges |
| Fail closed | a gate built without both halves throws; undecidable freshness is `null` and never passes |

---

## Summary

Freshness is judged per instrument against its own norm, because 70 of 662 series
never moved all day while the ATM strikes moved constantly — one threshold cannot
serve both. OI has its own clock. Eleven checks produce flags and **none of them
repairs anything**.

Three things worth saying back:

1. **The gate found a live inconsistency within minutes** — a last traded price
   below the day low reported in the same payload, on an instrument with 39 lakh
   volume.
2. **It also found that one of my own checks broke the project's null rule**, by
   treating a zero day-high as a real price. Nineteen of 186 sides were exposed
   to it.
3. **The acceptance harness found a genuine bug in the gate**: it decided
   staleness by regex-matching its own prose, and *"has ever been received"* did
   not match `/never been received/`, so an instrument that had never ticked was
   allowed through. The fix is structured codes; the rule is that **a gate must
   not parse its own error messages** — and the test had the same bug until it
   was rewritten the same way.

Where websocket metrics were asked for, the scorecard says `NOT_APPLICABLE` with
the reason, because the live path polls REST. A fabricated 100% uptime would have
been the most convincing figure on the page.
