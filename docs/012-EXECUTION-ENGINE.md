# 012 — EXECUTION ENGINE, ORDER LIFECYCLE & EXECUTION GOVERNANCE

**Standard:** Master Prompt 012 · **Depends on:** 000-A…E, 001-A…F, 002…011
**Date:** 2026-07-12 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. Live trading NOT approved. No execution algorithm optimized.**

---

# SECTION 0 — 🔴 THE KILL SWITCH STOPS ONE QUARTER OF THE ENGINES AND A RESTART UNDOES IT

**The complete emergency stop. This is the entire implementation:**

```js
server.js:6445
app.post('/api/risk/emergency-stop', (req, res) => {
  try { engine.autoEnabled = false; } catch(_) {}          // SENSEX directional
  try { niftyEngine.autoEnabled = false; } catch(_) {}     // NIFTY directional
  console.log('[risk] EMERGENCY STOP — both auto engines disabled');
  res.json({ ok: true, sensexAutoEnabled: false, niftyAutoEnabled: false });
});
```

## Measured against what is actually running

```
ENABLED RIGHT NOW (data/config-overrides.json)     STOPPED BY THE KILL SWITCH?
  STRANGLE_ENGINE_ENABLED        true    ₹7L        🔴 NO
  NIFTY_DIRECTIONAL_AUTO         true               ✅ yes
  SENSEX_DIRECTIONAL_AUTO        true               ✅ yes
  GAMMA_BLAST_ENGINE_ENABLED     true               🔴 NO
  AI_AGENTS_ENABLED              true               🔴 NO
  SENSEX_AFTERNOON_AUTO          true               🔴 NO
  NIFTY_AFTERNOON_AUTO           true               🔴 NO
  BOUNCE_ENGINE_ENABLED          true               🔴 NO
                                        ─────────────────────
                                        STOPS 2 OF 8   (25%)
```

## Four defects in five lines

| # | Defect | Consequence |
|---|---|---|
| **1** | **It stops 2 of 8 enabled engines** | 🔴 **The ₹7L iron condor — the largest allocation on the platform — keeps trading through an emergency stop** |
| **2** | **It assigns `autoEnabled = false` directly**, bypassing `setAutoEnabled()` | 🔴 **`_haltedReason` stays `null`.** The engine does not know it was stopped, or why |
| **3** | **It persists nothing** — 0 write calls | 🔴 The stop exists only in memory |
| **4** | **Combined with B-3** *(`server.js:7288` calls `setAutoEnabled(true)` at boot from `config-overrides.json`)* | 🔴 **THE NEXT RESTART SILENTLY UNDOES THE EMERGENCY STOP** |

> ## 🔴 **The last line of defence stops a quarter of the engines, records no reason, and is reversed by a restart.**
>
> An operator who hits emergency stop and then restarts the process — the single most natural pair of
> actions in an incident — **ends up with every engine running again, including the two they stopped,
> with no record that a stop ever happened.**

**Severity: CRITICAL.** Contained today only by `TRADE_MODE=paper`.

---

# SECTION 1 — 🟢 PAPER/LIVE ISOLATION HOLDS — AND I ALMOST REPORTED OTHERWISE

**Every `placeOrder` call site in the platform, and its guard:**

| # | Site | Guard | Verdict |
|---|---|---|---|
| 1 | `execution-engine.js:521` | `if (!this.paperMode && securityId)` | 🟢 |
| 2 | `execution-engine.js:659` | `if (!this.paperMode && pos.securityId)` | 🟢 |
| 3 | `afternoon-engine.js:518` | `if (!this.paperMode && securityId)` | 🟢 |
| 4 | `afternoon-engine.js:669` | `if (!this.paperMode && pos.securityId)` | 🟢 |
| 5 | `amibroker-bridge.js:623` | `if (deps.getTradeMode() === 'live' && deps.liveConnector)` | 🟢 |
| 6 | **`server.js:1881`** | **`if (tradeMode !== 'live') { …paper…; return; }`** — an **early return 15 lines above** | 🟢 |
| 7 | `server.js:7110` | `if (tradeMode === 'live' && live.connected)` | 🟢 |
| — | `upstox-connector.js:202` | `throw new Error('Upstox placeOrder not implemented — paper mode only')` | 🟢 **fail-closed stub** |

## ## **7 of 7 guarded. Paper/live isolation is INTACT.**

**I nearly published the opposite.** My first scan looked 12 lines above each call and found no guard at
`server.js:1881`. **The guard is an early return at `:1866`, three lines outside my window.** Reading the
route settled it in thirty seconds. *(This is my **seventh** false positive in this programme — §12.)*

## 🔴 But the isolation holds by SEVEN separate correct decisions, not by one invariant

**Four different expressions ask the same question across seven sites:**

```
!this.paperMode                         (×4)
deps.getTradeMode() === 'live'          (×1)
tradeMode === 'live' && live.connected  (×1)
tradeMode !== 'live'  → early return    (×1)
```

> **There is no chokepoint.** A future engine, a new route, or a copy-paste that omits the guard would
> reach the broker with nothing to stop it. **Safety here is a property of seven authors having been
> careful, not of an architecture that makes carelessness impossible.**
>
> **003 §3.3 named the fix: `OrderManager` — the ONLY door to a broker. 8 call sites → 1.**

---

# PART 1 — EXECUTION INVENTORY

| Component | Exists? | Owner |
|---|---|---|
| **Order creation** | 🔴 **NO.** There is no order object, no order id, no state | — |
| **Order routing** | 🔴 **NO.** Each engine calls its own connector | — |
| **Broker adapters** | 🟢 **YES** — `live-connector`, `dhan-client`, `upstox-connector`, `kotak-neo` (stub) | — |
| **Broker contract** | 🟢 **YES — `broker-connector.js`** *(see Part 5 — this is genuinely good)* | — |
| **Paper execution** | 🟡 **A bookkeeping entry.** No order, no fill, no rejection | per-engine |
| **Live execution** | 🟡 7 guarded call sites, **no chokepoint** | 7 modules |
| **Order cancellation** | 🔴 **DOES NOT EXIST** | — |
| **Order modification** | 🔴 **DOES NOT EXIST** | — |
| **Fill processing** | 🔴 **DOES NOT EXIST.** LTP = fill | — |
| **Retry logic** | 🟡 broker-level backoff on 429 (`server.js:6280`) — **not order-level** | — |
| **Execution logging** | 🔴 **NO.** No request/response payloads, no broker status, no retry count | — |
| **Kill switch** | 🔴 **BROKEN (§0)** | — |

---

# PART 2 — ORDER LIFECYCLE

```
 Signal → Risk Approval → Execution Request → Validation → Broker Request →
 Ack → Pending → Partial Fill → Complete Fill → Cancel/Reject/Expire →
 Portfolio Update → Archive
    ↓        ↓              ↓            ↓           ↓        ↓      ↓
    │        │              │            │           │        │      └── 🔴 NO CANCEL. NO REJECT.
    │        │              │            │           │        └── 🔴 NO PARTIAL FILLS.
    │        │              │            │           └── 🔴 NO PENDING STATE. Fire and forget.
    │        │              │            └── 🔴 NO ACKNOWLEDGEMENT TRACKING.
    │        │              └── 🟡 minimal (securityId present?)
    │        └── 🔴🔴 **RISK APPROVAL DOES NOT EXIST.** grep riskEngine|canTrade → nothing
    └── 🔴 carries no strategyId (007 P1-B)
```

## **Eight of twelve lifecycle states do not exist.**

**The order goes from a strategy decision directly to `await live.placeOrder(...)`, and whatever comes
back is used or discarded. There is no order.**

---

# PART 3 — ORDER OWNERSHIP MATRIX

| Action | Who | Verdict |
|---|---|---|
| **Creates** | **7 sites across 5 modules** | 🔴 **MULTIPLE WRITERS, NO CHOKEPOINT** |
| **Validates** | 🔴 **NOBODY.** No risk approval stage exists | 🔴 **MISSING** |
| **Modifies** | 🔴 **NOBODY.** Not implemented | — |
| **Cancels** | 🔴 **NOBODY.** Not implemented | — |
| **Archives** | per-engine → **6 incompatible ledgers** (010 §3) | 🔴 **FRAGMENTED** |

### Duplicate execution paths — **CONFIRMED**

**Two entirely separate live paths exist for the same instrument:**
1. The engine's own `tick()` → `execution-engine.js:521`
2. `POST /api/trade/execute` → `server.js:1881`
3. The TradingView webhook → `server.js:7110`
4. The AmiBroker bridge → `amibroker-bridge.js:623`

**None of them knows about the others.** *(007 P7-A: no engine can see another.)*

---

# PART 4 — EXECUTION SAFETY ASSESSMENT

| Control | Verdict |
|---|---|
| **Paper mode isolation** | 🟢 **INTACT — 7/7 sites guarded** (§1) |
| **Live mode isolation** | 🟡 **Holds by seven separate decisions, not one invariant** |
| **`TRADE_MODE` is never persisted** | 🟢 **THE BEST SAFETY DECISION IN THE CODEBASE.** `server.js:7286`: *"a restored AUTO ON can never re-arm LIVE."* **Every boot starts in paper** |
| **Live-mode token guard** | 🟢 `execution-engine.js:287` — refuses entry in live mode with an expired token. **Fail-closed** |
| **`forceEntry` guard** | 🟢 `execution-engine.js:454` — refuses in live mode unless `allowLive` is passed explicitly |
| **Kill switch** | 🔴 **BROKEN — stops 2 of 8, records nothing, undone by a restart (§0)** |
| **Trading halts** | 🔴 **DO NOT SURVIVE A RESTART** (005 S-01/S-02) |
| **Restart behaviour** | 🔴 **Positions lost** (010 §0) · **halt lost** (005) · **`_enteredToday` lost** (007 P6-A) · **emergency stop lost** (§0) |
| **Duplicate order prevention** | 🔴 **`_enteredToday` only — and it is in-memory.** A restart re-arms today's entry |
| **Idempotency** | 🔴 **ZERO.** `grep idempotenc\|clientOrderId` → **0 modules**. A retried request is a **second order** |
| **Retry safety** | 🔴 **UNKNOWN — and therefore UNSAFE.** Without an idempotency key, **any retry of `placeOrder` may duplicate a real position.** ⚪ **012's stop condition: *"Unknown safety behaviour remains UNKNOWN."*** |

## 🔴 P4-A — Retry without idempotency is the classic double-order bug

There is **no `clientOrderId`**, no request hash, no dedupe key. If a `placeOrder` call times out **after
the broker accepted it**, the platform has no way to know whether the order exists. **Any retry logic
added later would silently double positions.**

**Today this is contained by paper mode. It is a live-money defect waiting for the day paper mode is turned off.**

---

# PART 5 — BROKER INTEGRATION REVIEW

## 🟢 **`broker-connector.js` — the one piece of real architecture in the execution layer**

```js
broker-connector.js:18
const CORE = [
  'connect', 'disconnect',
  'getNiftyPrice', 'getSensexPrice', 'getBankNiftyPrice',
  'getNiftyOptionChain', 'getBankNiftyOptionChain', 'getOptionChain',
  'placeOrder', 'getPositions', 'getOrders', 'isMarketOpen',
];
const OPTIONAL = ['refreshAuth', 'isExpiryDay', 'getSensexOptionChain', 'getOptionHistory'];

function conforms(connector) { ... }                 // and it THROWS if a connector does not
broker-connector.js:74   if (!this.entries[name].conforms.ok)
                            throw new Error(`connector '${name}' does not satisfy the contract`);
```

> **A declared interface, a conformance check, and a fail-closed throw.** This is exactly the
> `BrokerPort` that 003 §4 called for — **and it already exists.**
> **It is the strongest piece of design in the entire execution layer, and it is barely used.**

| Broker | Auth | Session | Place | Modify | Cancel | Position sync | Errors |
|---|---|---|---|---|---|---|---|
| **Dhan** | OAuth → **rewrites `.env` non-atomically** (B-6) | 🔴 **token expired 7 days ago** *(live: `tokenExpired: true`)* | 🟢 | 🔴 | 🔴 | 🔴 | 🟡 429 backoff |
| **Upstox** | token | 🟡 | 🟢 **fail-closed stub — refuses** | 🔴 | 🔴 | 🔴 | 🔴 no retry |
| **Kotak Neo** | — | — | 🔴 **17-LOC stub** | — | — | — | — |

🔴 **Position synchronization with the broker: DOES NOT EXIST for any broker.** The platform never asks
the broker what it actually holds. *(011 Part 6.)*

---

# PART 6 — EXECUTION STATE

| State | Exists? | Persisted? |
|---|---|---|
| **Pending orders** | 🔴 **NO** | — |
| **Working orders** | 🔴 **NO** | — |
| **Filled orders** | 🟡 as a closed-trade ledger row | 🟢 `safe-write` |
| **Cancelled orders** | 🔴 **NO** | — |
| **Rejected orders** | 🔴 **NO** | — |
| **Broker acknowledgements** | 🔴 **NOT STORED.** The response is used and discarded | 🔴 |

> **There is no execution state. `placeOrder` is called, and the platform moves on.**

---

# PART 7 — FAILURE MODE REGISTER

| ID | Failure | Handling | Recovery |
|---|---|---|---|
| **EX-1** | **Broker timeout after acceptance** | 🔴 **NONE.** No order id, no reconciliation | 🔴 **The position exists at the broker and not in the platform. UNDETECTABLE** |
| **EX-2** | **Duplicate request** | 🔴 **NO IDEMPOTENCY** | 🔴 **A double position** |
| **EX-3** | **Restart during execution** | 🔴 **The in-flight order is forgotten** | 🔴 **NONE** |
| **EX-4** | **Broker disconnect** | 🟡 `live-connector` reconnects | 🔴 **No position resync** |
| **EX-5** | **Network interruption** | 🟡 429 backoff exists | 🔴 order-level: none |
| **EX-6** | **Lost confirmation** | 🔴 **The response is discarded** | 🔴 **NONE** |
| **EX-7** | **Partial acknowledgement** | 🔴 **N/A — no partial fills modelled** | — |
| **EX-8** | **Emergency stop, then restart** | 🔴 **THE STOP IS UNDONE (§0)** | 🔴 **NONE** |
| **EX-9** | **Expired broker token in live mode** | 🟢 **REFUSES TO ENTER** (`execution-engine.js:287`) | 🟢 **The best failure handling in the layer** |

**One of nine failure modes fails safe.**

---

# PART 8 — OBSERVABILITY

| Required per execution event | Recorded? |
|---|---|
| Timestamp | 🟡 |
| **Order ID** | 🔴 **DOES NOT EXIST** |
| **Strategy ID** | 🔴 **DOES NOT EXIST** |
| **Request payload** | 🔴 **NOT STORED** |
| **Response payload** | 🔴 **NOT STORED** |
| **Broker status** | 🔴 **NOT STORED** |
| **Retry count** | 🔴 **NOT TRACKED** |
| Final outcome | 🟡 on close |

> **012's rule: *"Execution without provenance is unacceptable."***
> **There is no execution provenance at all. Not one broker request or response is retained.**

---

# PART 9 & 10 — EXECUTION CONTRACTS & ARCHITECTURE (conceptual — no code)

```
   Strategy   propose(ctx) → EngineVerdict     MAY PROPOSE. MAY NEVER PLACE.
      ↓
   RiskEngine evaluate(proposal) → {allow, reason}
      ↓                            🔴 THIS STAGE DOES NOT EXIST TODAY.
   OrderManager  ★  THE ONLY DOOR TO A BROKER.  7 call sites → 1.
      · Order = { orderId, clientOrderId, strategyId, state, attempts, broker }
      · state: NEW → SUBMITTED → ACKED → PARTIAL → FILLED | REJECTED | CANCELLED
      · 🔴 clientOrderId IS MANDATORY ⇒ a retry can NEVER double a position.  → kills EX-2
      · 🔴 paper/live is decided HERE, ONCE.                                   → kills §1's fragility
      ↓
   BrokerPort   🟢 ALREADY EXISTS — broker-connector.js. Contract + conformance + throw.
      ↓
   Portfolio    a FILL is the only thing that moves a position.               → 011
      ↓
   ExecutionAuditLog  ★  every request, every response, every retry, every state change.
                         🔴 Today: nothing is retained.

   KillSwitch  ★  ONE call. Stops EVERY engine. Sets _haltedReason. PERSISTS.
                  🔴 A restart MUST NOT undo it.                              → kills §0
```

## The one rule that would have prevented §0 and §1's fragility

> **A safety control must act on the registry of engines, not on a hand-written list of two.**
> **And it must be persisted, or it is not a control — it is a suggestion.**

---

# PART 11 — TESTING STRATEGY

| Test | Priority |
|---|---|
| 🔴 **Emergency stop halts EVERY enabled engine, sets `_haltedReason`, and SURVIVES A RESTART** | **P0 — §0. It would fail right now on all three counts** |
| 🔴 **No `placeOrder` is reachable when `TRADE_MODE=paper`** — asserted at **all 7 sites**, and **a new unguarded site FAILS the build** | **P0 — §1** |
| 🔴 **A retried `placeOrder` with the same `clientOrderId` does not create a second position** | **P0 — EX-2** |
| 🔴 **`TRADE_MODE` is never persisted; every boot starts in paper** | **P0 — the one thing that must never regress** |
| **Restart during an in-flight order → reconciled or an incident raised** | P1 — EX-3 |
| **Broker position sync: platform state == broker state** | P1 — EX-1 |
| Order state machine transitions | P1 |
| `broker-connector.conforms()` rejects an incomplete adapter | ✅ **the contract exists — assert it** |

---

# PART 12 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE — this document** | — | none | 7 call sites, 8 missing lifecycle states, 1 broken kill switch |
| **2 — Ownership** | 🔴 **FIX THE KILL SWITCH (§0).** It must (a) iterate **every** engine, (b) go through `setAutoEnabled()` so `_haltedReason` is set, (c) **persist** | **B-3 first** (else a restart undoes it) | **Low — ~10 lines.** 🔒 **`server.js` PROTECTED** | **Emergency stop halts all 8 engines and survives a restart** |
| **3 — Execution contracts** | `OrderManager` as a **pass-through with no logic**. 7 sites → 1. `clientOrderId` mandatory | Phase 2 | **Medium — approval per call site** | **One door. Zero unguarded paths. Idempotent by construction** |
| **4 — Safety reinforcement** | `ExecutionAuditLog`. Broker position sync. Order state machine | Phase 3 | Medium | **Every broker request and response is retained** |
| **5 — Operational readiness** | Reconciliation on boot. **A live-mode gate that requires all 6 live-trading gates (001-E)** | Phase 4 | **HIGH — this is where real money becomes possible** | **NOT SCHEDULABLE.** Blocked behind a validated edge |

---

# PART 13 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every order has one owner | 🔴 **NO — there are no orders** |
| Duplicate execution prevented | 🔴 **NO — zero idempotency** |
| **Paper and Live strictly isolated** | 🟢 **YES — 7/7 guarded.** 🟡 **But by seven decisions, not one invariant** |
| Every execution event traceable | 🔴 **NO — nothing is retained** |
| Recovery is deterministic | 🔴 **NO — an in-flight order is simply forgotten** |
| Broker interactions observable | 🔴 **NO** |
| Execution failures auditable | 🔴 **NO** |

## **1 of 7 — and the one that passes is the one that matters most.**

---

# SECTION 12 — MY SEVENTH FALSE POSITIVE (Rule Zero)

| My scan reported | Reality |
|---|---|
| **"`server.js:1881` — a `placeOrder` with NO paper/live guard"** | 🔴 **FALSE.** The guard is an **early return at `:1866`** — `if (tradeMode !== 'live') { …paper…; return; }` — **three lines outside my 12-line window.** **All 7 sites are guarded** |

**Prior:** a "1,647-line function" (an `if` block) · "command injection" (a fixed-literal `spawn`) · a
"CORS wildcard" (origin-less only) · a "dead safety flag" (live and overridden) · **an `openPosition`
race that does not exist — published in FOUR documents** · a "naked short with no stop" (a defined-risk
condor).

> **Seven false positives across eleven audits. Every one was killed by reading the code.**
> **The one I did not catch in time — the `openPosition` race — I published four times.**
>
> **This one mattered most: had I published it, I would have told the owner that real money could leak
> out of a paper-mode system. It could not. The guard is there.**

---

# EXECUTIVE SUMMARY

**The mission: trace any order from strategy decision to broker outcome, verify ownership at every
stage, reproduce execution behaviour, and confirm paper/live isolation.**

## **Three of four: impossible. The fourth: confirmed, and it is the one that protects the money.**

🟢 **PAPER/LIVE ISOLATION IS INTACT.** All seven `placeOrder` call sites are guarded. `TRADE_MODE` is
never persisted — *"a restored AUTO ON can never re-arm LIVE"* — so **every boot starts in paper.** A
live-mode entry with an expired token is **refused**. `upstox-connector` **throws rather than pretend**.
**These are correct, deliberate, safety-first decisions and they are holding.**

🔴 **But there is no execution engine.** There are no orders — no order object, no id, no state machine,
no acknowledgement, no cancellation, no fill, no retry, no idempotency, and **not one broker request or
response is retained anywhere.** A strategy decides, and `await live.placeOrder(...)` is called from one
of **seven independent sites** using **four different ways of asking "is this live?"**. The isolation
holds because seven authors were each careful — **not because the architecture makes carelessness
impossible.**

🔴 **And the last line of defence is broken:**

> **The emergency stop disables 2 of the 8 engines that are enabled right now. It leaves the ₹7L iron
> condor running. It sets `autoEnabled = false` directly, so the engine never learns it was halted or
> why. It persists nothing. And because `server.js:7288` re-enables engines from `config-overrides.json`
> at every boot, THE NEXT RESTART SILENTLY UNDOES IT.**
>
> **An operator who hits emergency stop and then restarts — the two most natural actions in an
> incident — gets every engine back, with no record that a stop ever happened.**

**What is genuinely excellent and must be preserved:** `broker-connector.js` — a **declared interface,
a conformance check, and a fail-closed throw.** It is precisely the `BrokerPort` the architecture needs,
**it already exists, and almost nothing uses it.**

**The cheapest safety-critical fix here:** make the emergency stop iterate the **engine registry**, route
through `setAutoEnabled()` so a reason is recorded, and **persist it**. **About ten lines — and it
depends on B-3, because without B-3 a restart will undo it anyway.**

---

**Live trading: NOT APPROVED. Execution algorithms: NOT OPTIMIZED. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Execution Inventory (Part 1) · Order Lifecycle (Part 2) · Ownership Matrix (Part 3) ·
Safety Assessment (Part 4) · Broker Integration (Part 5) · Execution State (Part 6) · Failure Modes
(Part 7) · Observability (Part 8) · Execution Contracts & Architecture (Parts 9–10) · Testing Strategy
(Part 11) · Migration Roadmap (Part 12) · Executive Summary.
