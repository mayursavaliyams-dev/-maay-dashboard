# 081 — Session Report: Phase-A Gaps · 2026-07-31, 06:17–06:28 IST

**R1:** Friday, market CLOSED (06:17 IST, outside 09:15–15:30). ✓
**End state:** fully deployable. **83/83 suites**, smoke 7/0/2. **Nothing committed.**

**Tasks 1 and 2 complete. Tasks 3 and 4 NOT STARTED.** Per the brief — *"four
tasks half-done is worse than two done"* — the session stopped rather than
opening a third front.

The brief's line numbers were verified before editing; all six matched the
snapshot.

---

## TASK 1 — the status surface · COMPLETE

### 1a/1b — the lying fields

Both replaced with a single derivation. Raw output, the real `orderCapability()`
against the real connectors:

```
A. refusing connector (upstox), paper
    {"connector":"upstox","brokerOrderCapability":"refuses","brokerCanPlaceOrders":false,
     "tradeMode":"paper","liveOrdersPossible":false,
     "liveOrdersNote":"The upstox connector's placeOrder throws — no order can reach
                       a broker regardless of TRADE_MODE."}

B. LIVE-CAPABLE connector (dhan), paper
    {"connector":"dhan","brokerOrderCapability":"live-capable","brokerCanPlaceOrders":true,
     "tradeMode":"paper","liveOrdersPossible":false,
     "liveOrdersNote":"dhan can place orders, but TRADE_MODE=paper — orders are not sent."}

C. LIVE-CAPABLE connector (dhan), live
    {"connector":"dhan","brokerOrderCapability":"live-capable","brokerCanPlaceOrders":true,
     "tradeMode":"live","liveOrdersPossible":true,
     "liveOrdersNote":"dhan can place orders and TRADE_MODE=live — orders CAN reach the broker."}
```

### The fix was wrong first, and the proof caught it

The brief said to use `orderCapability(live)`. Done — and the verification run
printed:

```
  after wrapping, typeof live.placeOrder === 'function'  →  true   ← the OLD field
  orderCapability(live)                                  →  live-capable   ← "the truth"
```

**`live-capable` is not the truth.** The guard replaces the connector's
`placeOrder` with `neutralisedPlaceOrder`, whose body is
`throw Object.assign(new Error(...))`. `orderCapability`'s pattern was
`throw new Error(`, which does not match, and the message contains neither
"not implemented" nor "paper mode only". So **at request time it reported
`live-capable` for a connector that refuses** — the same lie, reshaped.

It reads correctly at `server.js:205` only because the guard does not exist yet
at line 251. `/api/execution/status` runs long after.

Two defences, because one was not enough:

1. `server.js` captures the capability **at startup, before wrapping**, into
   `CONNECTOR_ORDER_CAPABILITY`, and the status endpoint reports the captured
   value.
2. `orderCapability()` now recognises a neutralised method and returns
   **`'neutralised'`** — an honest "ask the guard" rather than a confident wrong
   answer for any future caller that asks too late.

Regression test, wrapping the **real** Upstox connector with the **real** guard:

```
  ✓ the real Upstox connector, unwrapped, reports "refuses"
  ✓ after wrapping, the connector still HAS a placeOrder — which is why
    `typeof x === "function"` was never an answer
  ✓ and orderCapability now reports "neutralised" rather than "live-capable"
    [regression: it said live-capable]
  ✓ it does not claim "refuses" either — the guard, not this function, is the
    authority once wrapped
```

### An existing test failed, and it was the test that was wrong

`execution-layer.test.js` asserted the **literal** `liveOrdersPossible: false`
appears in `server.js`. Removing the hardcoded field broke it.

Per the rule, a failing test is the finding — the exception being a test proven
wrong, where **the proof is the deliverable**. The proof:

```
  connector          : dhan (LIVE_CONNECTOR=dhan is a supported value)
  orderCapability    : live-capable
  TRADE_MODE=live    : a supported value
  → orders CAN reach the broker, and the old endpoint would still have
    reported liveOrdersPossible:false with its note saying otherwise.

  The assertion checked a LITERAL in source text. It could not distinguish
  "correctly false" from "hardcoded false regardless of reality".
```

The assertion was not weakened — its intent ("by default nothing reaches a
broker") is now asserted against the **derivation**, plus a behavioural check
that the deployed configuration still yields `false`.

### 1c — the two ungated endpoints

`/api/risk/config` and `/api/risk/evaluate` now use the existing `control()`
gate. No second mechanism was invented. Raw output, six endpoints, through a
simulated tunnel:

```
══ UNAUTHENTICATED ══
  GET  /api/risk/config          → HTTP 401  {"error":"unauthorized","action":"risk-config-read",...}
  POST /api/risk/reload          → HTTP 401  {"error":"unauthorized","action":"risk-config-reload",...}
  POST /api/risk/kill            → HTTP 401  {"error":"unauthorized","action":"kill-switch-trip",...}
  POST /api/risk/kill/reset      → HTTP 401  {"error":"unauthorized","action":"kill-switch-RESET",...}
  POST /api/risk/evaluate        → HTTP 401  {"error":"unauthorized","action":"risk-evaluate",...}
  POST /api/risk/emergency-stop  → HTTP 401  {"error":"unauthorized","action":"emergency-stop",...}

══ AUTHENTICATED ══
  GET  /api/risk/config          → HTTP 200  {"ok":true,"endpoint":"risk/config","via":"control-token"}
  POST /api/risk/reload          → HTTP 200  ...
  POST /api/risk/kill            → HTTP 200  ...
  POST /api/risk/kill/reset      → HTTP 200  ...
  POST /api/risk/evaluate        → HTTP 200  ...
  POST /api/risk/emergency-stop  → HTTP 200  ...
```

Ten control endpoints are now gated. `/api/engine/halt-all` remains ungated by
design: stopping is always permitted.

---

## TASK 2 — positions view and flatten · COMPLETE AS A PROPOSAL

`broker-positions.js`, `flatten.js`, `test/flatten.test.js` — **46 assertions**.
`GET /api/positions/broker` is **wired and gated**. `POST /api/flatten` is
**deliberately not wired** — see §2c.

### 2a — the view, and the thing it refuses to say

It reads the broker and consults **no internal book**, asserted by a test that
greps the module for `positions-book|openPosition|strangleEngine|paper`.

The design point that matters: **both connectors return `[]` on failure.**

```
upstox-connector.js:450   try { ... } catch { return []; }
live-connector.js:441     if (!this.connected) return [];
                          return this.client._post(...).catch(() => []);
```

An empty array therefore means *flat*, *call failed*, or *disconnected*, and the
connector does not say which. A view that printed "no open positions" on that
would do exactly what P1 forbids: show a clean screen during an outage while a
short strangle sits open.

So it never reports flat. An empty reply is **`EMPTY_UNVERIFIABLE`** with the
reason and the instruction to open the broker app:

```
  ✓ an empty broker reply is EMPTY_UNVERIFIABLE — never "flat"
  ✓ the rendered text never says "no open positions" — the phrase that would cause the harm
  ✓ a connector with no getPositions is UNAVAILABLE, not empty
```

`openLegs` counts only non-zero quantities — brokers return closed legs in the
same list, and counting those sends the operator hunting for a leg that is not
there, during a flatten, with a position moving.

### 2b — the flatten

```
  ✓ the kill switch is tripped ... and it is the FIRST step, before any exit
  ✓ a kill switch that does not take effect REFUSES the flatten
  ✓ and NOTHING is sent — exits into an armed bot are a race the operator loses
  ✓ the SHORT leg is exited first
  ✓ the LONG protective leg is exited LAST
  ✓ an unknown-side leg sits between them — it might be a hedge
  ✓ every exit is a MARKET order
  ✓ one failed leg makes the whole run PARTIAL, not a success with a footnote
  ✓ an empty-unverifiable book gives UNEVALUABLE, and the kill switch STAYS tripped
```

**A test caught my own outcome model conflating two facts.** A clean run — every
leg sent, none rejected — read back an empty list, which is unverifiable, and my
code called it `UNEVALUABLE`, the same word as "could not read the book at all".
Those are different facts and the operator acts differently on each. Now:

- **`SENT_UNVERIFIED`** — every exit sent, none rejected, result unconfirmable.
  *"Open the broker app and confirm every leg is closed."*
- **`UNEVALUABLE`** — exits failed **and** the result cannot be read.
- **`FLAT`** — only when the read-back positively shows nothing open. Reachable,
  and proven reachable by a test against a broker whose read-back is verifiable.

`FLAT` is the word an operator acts on by walking away. It is not given away.

### 2c — RESOLVED by the owner, 2026-07-31. Implemented as ratified.

> **The flatten goes THROUGH the guarded broker using `approveReducing()`.**

Implemented in three separable pieces, deliberately kept apart:

| Piece | What |
|---|---|
| **1. Behaviour** | `flatten.js` calls `broker.approveReducing()` directly. The injected-approver indirection is gone |
| **2. Wiring** | `POST /api/flatten` wired and gated with `control('FLATTEN')`. 200 only on `FLAT`/`NOTHING_TO_DO`/`DRY_RUN`; `SENT_UNVERIFIED`, `PARTIAL` and `UNEVALUABLE` return **409**, because a 200 on any of those reads as "handled" |
| **3. The widening** | `flatten.js` added to `ALLOWED` in `test/order-path-chokepoint.test.js §5` — **its own change, its own commit**, marked with a box comment naming what was added, why, where, and by whose decision |

**The calling function is named `_exit`.** The proximity assertion —
`/_exit\s*\(/` within 1500 characters before the first `approveReducing` —
**passes unchanged**. The regex was not widened and the diff touches no line
containing it:

```
$ git diff test/order-path-chokepoint.test.js | grep -E "^[-+].*_exit"
+       WHERE: flatten.js:_exit(), which the proximity assertion below checks
```

The only `_exit` line in the diff is a comment referring to it. The name is not
a device to satisfy a regex: `_exit` is what this codebase already calls an exit
path (`execution-engine.js:706`, `afternoon-engine.js`), and the assertion is
checking for exactly that convention.

**The test fired first, as designed.** Before the allowlist change:

```
5 · the reducing door has a fixed guest list
  ✓ afternoon-engine.js calls approveReducing and is on the allowed list
  ✓ execution-engine.js calls approveReducing and is on the allowed list
  ✗ AssertionError: flatten.js calls approveReducing and is on the allowed list
```

After:

```
  ✓ flatten.js calls approveReducing and is on the allowed list
  ✓ exactly 3 files call approveReducing (found 3: afternoon-engine.js, execution-engine.js, flatten.js)
  ✓ flatten.js calls it from inside an exit path, not an entry path
```

### The decision's central claim, now proven end to end

Not against a scripted approver — against the **real** `RiskGuardedBroker`, the
real `RiskManager`, a real `OrderBreaker` with its limit set to 1, and a kill
switch **already tripped** before the flatten starts:

```
2c · through the REAL guard, with kill switch AND breaker tripped
  ✓ the kill switch is tripped BEFORE the flatten starts
  ✓ BOTH exits reached the broker through the real guard with the kill switch tripped
  ✓ and in the right order — short before the protective wing
  ✓ the breaker latched on the second order (limit was 1) — it counted them
  ✓ and the latched breaker did NOT stop the second exit — a trapped position is the worst failure
  ✓ every exit carried a REDUCING approval issued by the real risk manager
  ✓ labelled REDUCING in the audit trail — distinguishable from an evaluated approval
  ✓ an ENTRY is still refused while the kill switch is tripped (RISK_BLOCKED)
    — the reducing door did not open the building
```

The last line matters as much as the rest: widening the door for exits did not
widen it for entries.

`test/flatten.test.js`: **55 assertions**. Suite **83/83**. Smoke 7/0/2.

### 2c — the original proposal, retained for the record

**What happened when I built it:** the first implementation called
`broker.approveReducing(...)` directly. `test/order-path-chokepoint.test.js §5`
immediately failed:

```
✗ flatten.js calls approveReducing and is on the allowed list
```

That test enumerates who may open the door that skips every limit. **It fired
correctly**, and it fired on exactly the decision the brief said not to make
alone. Silently adding `flatten.js` to that allowlist would have been deciding.

**So the decision was moved out of the module.** `flattenAll` now takes
`approve` as a dependency and **refuses to send without one**
(`FLATTEN_NO_APPROVER`). `flatten.js` contains no reference to the reducing door.
The endpoint is not wired. The choice is one visible line in `server.js`, and
`server.js` carries the exact diff in a comment.

**My proposal: go THROUGH the guard, via `approveReducing`.** Reasoning:

1. **Around the guard is a second door.** Phase 2 spent a session proving there
   is exactly one path to a broker and making bypass throw. A flatten that
   reached the raw connector would recreate the thing that was removed, and it
   would be the path used in an emergency — the worst one to have unrecorded.
2. **Through the guard, an exit cannot be blocked.** `risk-guard.js` skips both
   the kill-switch check and the breaker denial when `known.reducing` is true.
   This was designed in deliberately (doc 075 §2.3): *"trapping a position is not
   a conservative failure, it is the worst one."* So the fear behind the question
   — *what if the risk layer refuses a reducing order during an emergency exit* —
   **cannot happen by construction.** I read `risk-manager.js` and `risk-guard.js`
   before answering, as instructed.
3. **The audit trail is the point.** Through the guard the exit is recorded,
   counted by the breaker, and labelled `why: REDUCING` — distinguishable from an
   evaluated approval. Around the guard it is invisible.

**Residual risk, stated:** if `guardedBroker` is itself broken or unconstructed,
the flatten cannot send. That is acceptable and is why this is the **secondary**
path. The primary remains the broker's own app, which works when this process
does not.

**What ratification requires:** wire the endpoint using the diff in `server.js`,
and add `flatten.js` to the allowlist in `test/order-path-chokepoint.test.js §5`.
Two edits, both deliberate, both visible.

### What was NOT verified in Task 2

- **No paper positions were opened and flattened against a running system.** The
  brief asked for that. It was not done: the flatten is unwired pending §2c, and
  a production process holds port 3000. All 46 assertions run against a scripted
  broker.
- The partial-exit path **was** exercised (a scripted leg rejection), but not
  against a real broker rejection.
- `renderText` has not been looked at on a physical phone screen.
- `/api/positions/broker` was not called against the running server — it is old
  code and does not have the route.

---

## TASKS 3 AND 4 — NOT STARTED

Reconciliation (Task 3) and heartbeats (Task 4) were not begun. Nothing was
half-built. The tree contains no partial work from either.

This matters for one claim already on record: **no feed-failure detection latency
has been measured, and still cannot be**, because heartbeats do not exist. That
number remains unavailable.

---

## ATTEMPTED AND REVERTED

1. **`orderCapability(live)` at request time** — reverted to a startup capture,
   because it reported `live-capable` for a refusing connector. Above.
2. **`POST /api/flatten`** — written, wired, then **reverted to a documented
   proposal** when the chokepoint allowlist test fired. The revert is the correct
   outcome: the test was enforcing a decision boundary the brief drew.
3. **`flatten.js` calling `approveReducing` directly** — replaced with an
   injected approver so the module contains no reference to the reducing door.

---

## NOT VERIFIED

- The server was **not restarted**. Nothing in this session has been verified
  against the running process, which is still old code (`/api/control/audit` →
  404).
- No endpoint was called against port 3000. All HTTP evidence comes from an
  isolated harness mounting the same gate factory and the same status derivation.
- **No real order, no real position, no real broker call.** Every broker in these
  tests is scripted.
- The flatten has never run. Not in paper, not anywhere.
- Whether the tunnel sets `x-forwarded-for` — **unchanged, still unknown, still
  the highest-priority open question** (D-3).
- Task 1's status endpoint was verified by reproducing its derivation, not by
  calling `/api/execution/status` on a live server.

---

## NEW DEFECTS — recorded, not fixed

| # | Defect | Where | Severity |
|---|---|---|---|
| **D-6** | `orderCapability()` misreports a guard-neutralised connector as `live-capable`. **Fixed this session**, but the class remains: any code inspecting a connector's method after wrapping is inspecting the guard's stub | `connector-select.js` | medium — fixed, class open |
| **D-7** | `kotak-neo-connector.js` has **no `getPositions()` at all**. The positions view reports UNAVAILABLE for it, correctly — but a Kotak deployment would have no position visibility whatsoever, and `LIVE_CONNECTOR=kotak` is a supported value | `kotak-neo-connector.js` | **high** |
| **D-8** | Both connectors return `[]` on a failed positions read (this is A5, now confirmed in a second place). It makes an honest `FLAT` unreachable and forces `SENT_UNVERIFIED` on every clean flatten | `upstox-connector.js:450`, `live-connector.js:441` | high — blocks Task 3 |

**D-8 is a precondition for Task 3.** A reconciliation built on `getPositions()`
as it stands would compare internal state against `[]` during an outage and
conclude MATCH — a broken check that passes. Task 3 must fix A5/D-8 first or be
built to treat every empty read as UNEVALUABLE.

---

## FIRST ACTION FOR THE NEXT SESSION

**Fix A5/D-8 before starting Task 3.** Concretely, in `live-connector.js` and
`upstox-connector.js`: make `getPositions()` and `getOrders()` distinguish three
outcomes rather than one — a list, an explicit "empty and confirmed", or a thrown
error carrying the reason. Do **not** keep `catch(() => [])`. Both files are
Tier 1, so propose the diff; do not apply it.

Then, and only then, Task 3's reconciliation has something truthful to compare
against.

**Before any of that, if the operator is available:** the deployment sequence in
doc 080 §NEXT ACTION is still outstanding and still outranks new code. Nothing in
this session is running.
