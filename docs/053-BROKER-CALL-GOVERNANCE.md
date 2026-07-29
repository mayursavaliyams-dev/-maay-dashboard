# 053 — Broker Call Governance: the front end was setting the broker's call rate

**Author:** Chief Architect
**Date:** 2026-07-29
**Status:** Fixed and proven under load. 458 rate-limit refusals → 0.
**Severity:** S2 — a live, recurring data outage on the trading surface, invisible in every metric the system published about itself.

---

## 1. Problem

A routine audit of the running system found the broker refusing requests **right now**, not historically:

```
[watchlist] error: Upstox /option/chain?instrument_key=BSE_INDEX%7CSENSEX...: 429 Too Many Requests
```

Counted across one session log: **477 rate-limit refusals, 458 of them from a single
endpoint**, `/api/watchlist`, split across NIFTY (269) and SENSEX (208).

A 429 is not a cosmetic error. It means the option chain did not arrive, so whatever
the screen showed for those seconds was the previous value or a dash — on the pages
a person uses to decide what to trade.

---

## 2. Evidence

Grades: **Verified** (checked against ground truth) / **Measured** (computed from
observed data) / **Estimated** / **Opinion** / **Unknown**. Never merged.

### 2.1 The caller side (**Measured**)

`dashboard.html` runs **fourteen** polling timers. Those that reach a chain-backed
endpoint:

| Timer | Interval |
|---|---|
| auto-movers (fast premium movers) | **2 s** |
| high/low | 4 s |
| chain | 5 s |
| watchlist | 6 s |
| positioning | 6 s |
| strike timeline / auto-movers | 5 s |

`trade.html` adds three more (chains 5 s, live trades 2 s, strangle 4 s). Across
three instruments.

### 2.2 The connector side (**Verified**, by reading the code and then measuring)

Three faults in one path, each amplifying the next:

1. **No single-flight.** `_chainCache` was `{ at, data }` with no in-flight slot.
   Every caller arriving after the TTL lapsed started *its own* fetch. Ten
   simultaneous callers meant ten simultaneous upstream calls.
2. **No 429 handling at all.** No retry, no backoff, no reading of `Retry-After`.
   The broker's refusal was logged, and the next tick a second later asked again at
   exactly the same rate.
3. **The metrics were hard-coded to say nothing.** `getStats()` returned
   `coalesced: 0, cacheHits: 0, inflight: 0, rateLimited: 0` as **literals**. Those
   are precisely the four numbers that would have exposed this, and they were
   incapable of reporting anything but zero.

### 2.3 The governor had been loosened (**Verified**)

`CHAIN_CACHE_MS` carries the comment `// was 4500`. The TTL had been reduced from
4.5 s to 2.5 s to cut update lag. That TTL was the only thing limiting the upstream
rate, so halving it doubled the ceiling: with something polling every 2 s against a
2.5 s TTL, essentially every tick is a miss — roughly **24 chain fetches a minute per
instrument, 72 across three**.

**The front end was setting the broker's call rate.** No component owned that number.

---

## 3. Options Considered

| Option | For | Against | Verdict |
|---|---|---|---|
| **A. Slow the pollers** | Direct, no new machinery | Fifteen call sites across pages; any new page reintroduces the fault; nothing prevents it | **Rejected** — treats the symptom at every site instead of the cause at one |
| **B. Rate-limit middleware** | One place | Rejects callers rather than serving them; a dashboard panel showing "429" is no better than one showing a dash | **Rejected** |
| **C. Single-flight + adaptive floor in the connector** | One owner for the rate; callers unchanged; cannot be bypassed by a new page | New state to keep correct | **Adopted** |

---

## 4. Decision

The connector owns the broker call rate. Three changes:

**Single-flight.** Concurrent callers share one in-flight promise. N callers, one
call. *Measured: 20 simultaneous callers now produce exactly 1 upstream call.*

**Adaptive minimum interval.** Single-flight collapses *simultaneous* callers, but
fourteen staggered timers are not simultaneous — after coalescing alone, only 5 of
219 requests coalesced and the hit rate was **7.3%**. So the per-instrument interval
**widens on a refusal and narrows on a run of clean fetches**:

- a 429 doubles the floor, bounded at **20 s** — beyond that the chain is too stale
  to trade from, and a screen showing minute-old option prices is worse than one that
  admits it cannot reach the broker;
- **three** consecutive clean fetches relax it by one step, never a snap back to the
  base, because snapping back turns a backoff into an oscillation.

I do not know the broker's exact published limit, and a guessed constant would be a
number pretending to be a fact. The system finds the limit and reports what it
settled on.

**Cooldown that serves rather than fails.** On a 429 the instrument pauses —
honouring `Retry-After` when the broker sends one, 30 s otherwise — and the *last
good chain* is served meanwhile. With nothing cached it throws, because an empty
chain would read as "no strikes", which is a different and false claim.

**Honest metrics.** `coalesced`, `cacheHits`, `inflight`, `rateLimited`, `cooldowns`,
`cooldownServes` and the learned `effectiveIntervalMs` are all real now.
`rateLimited` (refusals seen) and `cooldowns` (times we stopped calling) are kept
**separate**: a rising `rateLimited` with a flat `cooldowns` would mean the backoff
is not engaging, and one number could not tell you that.

---

## 5. Result (**Measured**)

Load test against the live server: 40 concurrent workers × 6 staggered rounds =
**240 requests** across three instruments.

| | Before | After |
|---|---|---|
| 429 refusals under load | 458 (from one endpoint) | **0** |
| Cache hits | 11 | **239** |
| Coalesced | 5 | **18** |
| **Hit rate** | **7.3 %** | **59.2 %** |
| Errors | 6 | **0** |

Test suite: **66/66**, including the new `test/upstox-coalescing.test.js` (33
assertions).

---

## 6. A Defect Found by the Test, Not by Review

The success-side bookkeeping (clearing the cooldown, counting clean runs, relaxing
the floor) initially lived inside `_fetchChain`, while the failure-side lived in
`_chain`. The test could not see the relaxation, because its harness replaced
`_fetchChain` — and that exposed the real problem: **the half of the bookkeeping that
lived further from its counterpart was the half that would be missed.** Both outcomes
are now booked in one place, next to each other.

The same shape appeared twice more in this session (a guard whose check never ran, a
root font-size silently overridden). It is worth naming: *bookkeeping split across
two functions is bookkeeping where one side is wrong.*

---

## 7. Institutional Recommendation

The 429s were not new. They had been happening for at least the sessions this log
covers, and nothing surfaced them, because **the four statistics that would have
shown the problem were hard-coded to zero**. A metric that cannot vary is worse than
no metric: it occupies the place where a real one would go and reports health.

**Recommendation:** any counter a component publishes about itself must be either
genuinely computed or absent. A literal zero in a stats object should be treated in
review the same way as a `catch {}` — a silence wearing the costume of an answer.
The `no-silent-catch` ratchet already encodes that instinct for errors; the same
ratchet should cover published metrics.

**Second, unresolved:** the poll cadences themselves remain uncoordinated. Fourteen
timers on one page, each chosen locally, is a design in which no component owns
freshness. The connector now protects the broker from that, but the pages still ask
far more often than the data changes. A shared client-side scheduler — one timer, one
fan-out — is the next step, and it is not done here.
