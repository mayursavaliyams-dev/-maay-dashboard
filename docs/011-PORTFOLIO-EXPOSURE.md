# 011 — PORTFOLIO ENGINE, POSITION MANAGEMENT & EXPOSURE GOVERNANCE

**Standard:** Master Prompt 011 · **Depends on:** 000-A…E, 001-A…F, 002…010
**Date:** 2026-07-12 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No code modified. Execution and risk decisions NOT in scope.**

---

# SECTION 0 — 🔴 LIVE: THE RISK ENDPOINT REPORTS NUMBERS THAT ARE ALL WRONG

**Queried from the running process. Not inferred.**

```json
GET /api/risk                          THE ENGINES, ACTUALLY
{
  "capital": 100000,          ◀──🔴   SENSEX ₹88,011  ·  NIFTY ₹96,761
  "maxDailyLossPct": 2,       ◀──🔴   both engines run at 5   (live: riskPct: 5)
  "dailyLossLimit": -2000,    ◀──🔴   SENSEX −₹4,400  ·  NIFTY −₹4,838
  "niftyConsecLosses": 0,     ◀──🔴🔴 THE ENGINE SAYS 15 — against a limit of 8
  "sensexConsecLosses": 0,    ◀──🔴   the engine says 2
  "maxConsecutiveLosses": 8
}
```

## Root cause — the risk page never asks the engines

```js
server.js:6349   const capital     = parseFloat(process.env.CAPITAL_TOTAL        || 500000);
server.js:6350   const maxLossPct  = parseFloat(process.env.MAX_DAILY_LOSS_PERCENT || 2) / 100;
server.js:6376   const niftyConsecLosses = tailLosses(niftyToday);   // ◀── counts TODAY's closed trades
```

**Three independent defects, one screen:**

1. **`capital` is read from `process.env`, not from the engine.** The engines restored ₹88,011 and
   ₹96,761 from disk. `/api/risk` shows the env's ₹100,000. *(And its fallback is **₹500,000** — a
   second, different default from the engines' ₹100,000 — 004 C-07.)*
2. **`maxDailyLossPct` is read from `.env` (2%).** The engines actually run at **5%**, because
   `config-overrides.json` silently overrides `.env` *(004 C-01)*. **The displayed loss limit is less
   than half the real one.**
3. **`consecLosses` is recomputed from *today's* closed trades.** The engine's brake counts the streak
   **across days**, persisted in `equity-<inst>.json`. **Today has zero trades ⇒ the page shows `0`.**

> ## 🔴 **THIS IS WHY NOBODY EVER NOTICED S-01.**
>
> The NIFTY engine has been sitting at **15 consecutive losses against a limit of 8**, unhalted, since
> its halt state failed to survive a restart *(005 S-01/S-02)*.
>
> **The one page whose entire job is to show that number displays `0` — because it computes a different
> quantity from a different source.**
>
> **A risk display that cannot show the state of the risk brake is not a risk display. It is
> reassurance.**

**Severity: CRITICAL.** Contained today only by `TRADE_MODE=paper`.

---

# PART 1 — PORTFOLIO INVENTORY

| Component | Owner | Where it lives | Confidence |
|---|---|---|---|
| **Open positions** | 🔴 **8 independent stores** — `server.js` (35 refs) · `agents-engine` (11) · `signal-paper-engine` (9) · `gamma-blast-engine` (6) · `strangle-engine` (5) · `bounce-engine` (5) · `amibroker-bridge` (2) · `pop-seller` (1) | scattered | HIGH |
| **Closed positions** | per-engine | **6 incompatible ledgers** (010 §3) | HIGH |
| **Orders** | 🔴 **DO NOT EXIST.** No order object, no order id, no state machine | — | HIGH |
| **Holdings** | 🔴 **DO NOT EXIST** | — | HIGH |
| **Realized P&L** | per-engine | ledgers | MEDIUM |
| **Unrealized P&L** | per-engine, in memory | 🔴 lost on restart | MEDIUM |
| **Daily P&L** | `server.js` per-instrument | `eod-*.json` (raw write) | MEDIUM |
| **Exposure** | 🔴 **DOES NOT EXIST** | — | HIGH |
| **Portfolio valuation** | 🔴 **DOES NOT EXIST** | — | HIGH |
| **Strategy allocation** | 🔴 **3 separate `capital` fields** | config + 3 engines | HIGH |
| **Session summaries** | `server.js:4255` | 19 × `eod-*.json`, **raw, no `.bak`** | HIGH |

## 🔴 P1-A — Capital, measured live: **nobody knows how much money there is**

```
SENSEX directional engine   believes it has   ₹  88,011
NIFTY  directional engine   believes it has   ₹  96,761
Strangle engine             believes it has   ₹ 700,000   (STRANGLE_CAPITAL)
afternoon engines           derive from       CAPITAL_TOTAL × pct
config-overrides.json says                    ₹ 100,000
                                              ──────────
Engines collectively believe they control    ₹ 884,772+
```

**There is one real account.**

> **No component in this system adds these numbers up. Nothing can. There is no place where the
> question *"how much money do I have?"* is even asked.**
>
> **This is the direct cause of 001-B's finding that capital has three owners and zero ledgers.**

---

# PART 2 — POSITION LIFECYCLE

```
 Signal → Order Request → Accepted Order → Fill → Open Position → Update →
 Partial Exit → Final Exit → Closed Position → Archive
      ↓            ↓              ↓        ↓          ↓            ↓
      │            │              │        │          │            └── 🔴 NO PARTIAL EXITS.
      │            │              │        │          │                   Exit is all-or-nothing.
      │            │              │        │          └── 🔴 IN MEMORY ONLY in 3 of 4 engines.
      │            │              │        │                LOST ON RESTART (010 §0).
      │            │              │        └── 🔴 NO FILL MODEL. LTP = fill.
      │            │              └── 🔴 DOES NOT EXIST. No order object.
      │            └── 🔴 DOES NOT EXIST. No risk review, no acceptance.
      └── 🟡 exists, but carries no strategyId (007 P1-B)
```

**Four of ten lifecycle states do not exist.** The position goes **directly from a signal to an open
position**, with **no order, no acceptance, no fill.**

---

# PART 3 — POSITION OWNERSHIP MATRIX

| Action | Who does it | Verdict |
|---|---|---|
| **Creates** | 8 modules, independently | 🔴 **MULTIPLE WRITERS** |
| **Modifies** | the same 8, plus `server.js` route handlers | 🔴 **MULTIPLE** |
| **Closes** | the owning engine · **plus 5 manual REST routes** in `server.js` · **plus the TradingView webhook** (`server.js:7075`) | 🔴 **CONFLICTING** |
| **Archives** | per-engine, to 6 different ledgers | 🔴 **FRAGMENTED** |

### Hidden ownership
- **A restart owns every open position** — because 3 of 4 engines drop them (010 §0).
- **`server.js`'s 6 manual position globals are a seventh, invisible portfolio** that no engine knows about.

### Missing ownership
- **Portfolio: no owner.** **Exposure: no owner.** **Net P&L across engines: no owner.**

---

# PART 4 — PORTFOLIO VALUATION

| Quantity | Computed? | Source | Assumption |
|---|---|---|---|
| **Market value** | 🔴 **NO** | — | — |
| **Net portfolio value** | 🔴 **NO** | — | — |
| **Equity** | 🟡 **per-engine only** | `equity-<inst>.json` | Each engine's `capital` is its **own** account |
| **Cash balance** | 🔴 **NO** | — | — |
| **Margin usage** | 🔴 **NOT IMPLEMENTED** | — | ⚪ **SPAN is published daily by the exchange and is NOT CAPTURED** |
| **Available capital** | 🔴 **NO** — `grep availableCapital` → **0 modules** | — | — |
| **Realized P&L** | 🟡 per-engine | ledgers | — |
| **Unrealized P&L** | 🟡 per-engine, in memory | 🔴 **lost on restart** | — |
| **Daily NAV series** | 🔴 **DOES NOT EXIST** | — | **`pop-seller.js:503` says so in its own words: *"no daily NAV or RV series is captured"*** |

## 🔴 P4-A — No NAV ⇒ no Sharpe, no drawdown, no portfolio metric of any kind

**Every portfolio-level statistic the platform could ever want is gated behind one absent series.**
`pop-seller.js` already declares this honestly at `:503` — **it is the only module that admits it.**

**Portfolio valuation is not reproducible. 011's stop condition applies: → UNKNOWN.**

---

# PART 5 — EXPOSURE GOVERNANCE

**Measured. Every one of these is a `grep -rl` across the whole non-test codebase.**

| Aggregate | Modules implementing it |
|---|---|
| `totalExposure` | **0** |
| `grossExposure` | **0** |
| `netExposure` | **0** |
| `portfolioRisk` | **0** |
| `netDelta` | **0** |
| `netGamma` | **0** |
| `netVega` | **0** |
| `netTheta` | **0** |
| `marginUsed` | **0** |
| `availableCapital` | **0** |
| `navSeries` | **0** |

### **NOT IMPLEMENTED — every single one.**

**Greeks:** `option-analyzer.js` and `gex-skew.js` compute **per-strike** delta/gamma/vega/theta.
**Nothing aggregates them.** There is no portfolio delta. There is no portfolio gamma.

> ## 🔴 **THE PLATFORM RUNS SIX CONCURRENT STRATEGIES ON ONE ACCOUNT AND CANNOT COMPUTE A SINGLE AGGREGATE NUMBER ABOUT THEM.**
>
> **And no engine can see any other engine** *(007 P7-A: `grep strangleEngine|niftyEngine` outside
> `server.js` → nothing)*.
>
> **The NIFTY directional engine can be long an ATM call while the iron condor is short a call at the
> same strike, on the same expiry, funded by the same real account — and there is no component in this
> system capable of noticing, netting, or refusing.**

---

# PART 6 — RECONCILIATION

| Type | Present? |
|---|---|
| **Internal reconciliation** | 🔴 **NO** — the word appears in `agents-engine.js:446` and `server.js:759`, but both refer to **option-candle** reconciliation, **not positions** |
| **Session reconciliation** | 🔴 **NO** |
| **Restart reconciliation** | 🔴 **NO — and this is the worst gap.** 3 of 4 engines simply **forget** their open positions (010 §0). **There is no comparison, no warning, no incident** |
| **Position consistency** | 🔴 **NO** — 8 stores, never compared |
| **Duplicate detection** | 🔴 **NO** — no position id, no dedupe key |
| **Missing positions** | 🔴 **UNDETECTABLE.** An orphaned trade leaves **no trace** |

## 🟢 The one honest module

```js
agents-engine.js:458
  console.error('[agents] The engine cannot know what is open. Saving disabled;
                 file untouched. Reconcile by hand.');
```

> **`agents-engine.js` is the only component in this platform that admits it does not know what it
> holds — and it refuses to write rather than guess.** *(000-A: "Refuse rather than guess.")*
> **Every other engine, in the same situation, silently starts empty.**

---

# PART 7 — OBSERVABILITY

| Required per portfolio mutation | Recorded? |
|---|---|
| Timestamp | 🟡 sometimes |
| **Source** | 🔴 **NO** |
| **Position ID** | 🔴 **DOES NOT EXIST** |
| **Order ID** | 🔴 **DOES NOT EXIST** |
| **Strategy ID** | 🔴 **DOES NOT EXIST** (007 P1-B) |
| **Portfolio snapshot** | 🔴 **DOES NOT EXIST** |
| **P&L impact** | 🟡 on close only |

> **011's rule: *"Portfolio state without audit history is not reproducible."***
> **There is no audit history. There is one `EventEmitter` in the entire codebase** *(001-B §10)*.
>
> **The complete state of the portfolio at any past moment cannot be reconstructed. Not approximately.
> At all.**

---

# PART 8 — FAILURE MODE REGISTER

| ID | Failure | Present? | Impact |
|---|---|---|---|
| **PF-1** | **Lost positions** | 🔴 **CONFIRMED** — restart drops them (010 §0) | **CRITICAL — evidence destroyed, survivorship bias introduced** |
| **PF-2** | **The risk page shows the wrong numbers** | 🔴 **CONFIRMED, LIVE (§0)** | **CRITICAL — it hid S-01 for days** |
| **PF-3** | **Duplicate positions** | ⚪ **UNDETECTABLE** — no position id | UNKNOWN |
| **PF-4** | **Inconsistent P&L across ledgers** | 🔴 **LIKELY** — 6 schemas, 2 structure names | HIGH |
| **PF-5** | **Missing fills** | 🔴 **N/A — there are no fills** | — |
| **PF-6** | **Restart inconsistency** | 🔴 **CONFIRMED** — positions, halt, `_enteredToday` all evaporate | **CRITICAL** |
| **PF-7** | **Partial updates** | 🔴 **N/A — no partial exits exist** | — |
| **PF-8** | **Negative quantities** | 🟢 **Not found** | — |
| **PF-9** | **Cross-engine conflict** | 🔴 **UNDETECTABLE** — no engine sees another | HIGH |

---

# PART 9 — PORTFOLIO ARCHITECTURE (conceptual — no code)

```
   Portfolio  ★   THE SINGLE OWNER OF EVERY POSITION

     PositionRegistry
       positionId · strategyId · orderId · instrument · expiry · legs[] · qty ·
       entry · sessionId · configVersion
       🔴 PERSISTED ATOMICALLY ON EVERY MUTATION.
       🔴 A restart RESTORES, or RAISES AN INCIDENT. It never starts empty.   → kills PF-1/PF-6

     ExposureCalculator
       gross · net · per-strategy · per-instrument · per-expiry
       netDelta · netGamma · netVega · netTheta          ← 0 of these exist today
       🔴 The ONE place that can answer "how much am I risking?"              → kills PART 5

     Valuation
       NAV(t) — a DAILY SERIES.
       🔴 Without it there is no Sharpe, no drawdown, no portfolio metric — ever.

     Reconciliation
       on every boot: registry vs engines vs ledgers.
       🔴 A MISMATCH IS AN INCIDENT, NOT A SILENCE.                            → kills PART 6

     PortfolioView  (the ONLY source for /api/risk)
       🔴 /api/risk MUST read the ENGINES, never process.env.                  → kills §0
```

## The one rule that would have prevented §0

> **A display that reports a safety-critical number must read it from the component that enforces it.**
> **`/api/risk` reads `process.env`. The brake lives in the engine. They have never agreed.**

---

# PART 10 — TESTING STRATEGY

| Test | Priority |
|---|---|
| 🔴 **`/api/risk` reports the ENGINE's capital, loss limit and consecLosses — not `process.env`** | **P0 — §0. It would fail RIGHT NOW: it would show 15, not 0** |
| 🔴 **An open position survives a restart, or an incident is raised** | **P0 — PF-1** |
| 🔴 **Boot reconciliation: registry vs engines vs ledgers** | **P0 — PART 6** |
| **Two engines cannot hold opposing positions in the same strike/expiry** | P1 — PF-9 |
| **Exposure: gross/net/delta computed and asserted against a hand-worked example** | P1 |
| Portfolio valuation is deterministic from the ledger | P1 |
| Duplicate detection via a position id | P1 |
| Partial exits | P2 — not implemented |

---

# PART 11 — MATURITY ASSESSMENT

| Level | Met? | Evidence |
|---|---|---|
| **0 — Prototype** | 🟢 | Positions exist |
| **1 — Position Tracking** | 🔴 **NO** | **8 independent stores. 3 of 4 engines lose positions on restart. No position id** |
| **2 — Portfolio Management** | 🔴 **NO** | **No portfolio object. No NAV. No cash balance. Capital lives in 3 places** |
| **3 — Exposure Governance** | 🔴 **NO** | **ZERO exposure aggregates exist. Not one** |
| **4 — Reconciliation Complete** | 🔴 **NO** | **No reconciliation of any kind** |
| **5 — Production Candidate** | 🔴 **NO** | — |

## ## **Portfolio Engine: LEVEL 0 — PROTOTYPE.**

**Strictly: the Portfolio Engine does not exist.** What exists is **eight position stores and a risk
page that reads a different data source from the one that enforces the risk.**

---

# PART 12 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE — this document** | — | none | 8 stores, 0 aggregates, 1 wrong risk page — all catalogued |
| **2 — Ownership** | 🔴 **FIX `/api/risk` FIRST (§0).** Make it read the engines. **It is the cheapest fix with the largest safety return in the entire programme** | none | **Low.** 🔒 **`server.js` is PROTECTED — approval required** | **`/api/risk` shows `niftyConsecLosses: 15`, and the operator finally sees the truth** |
| **3 — Valuation consistency** | `AccountLedger` (003 §3.1) as a **read-only shadow**: publish alongside the 3 capitals and **assert they reconcile for 2 weeks** | Phase 2 | Medium | One capital number. A daily NAV series exists |
| **4 — Exposure governance** | `ExposureCalculator` — gross/net/delta/gamma/vega/theta. **Read-only at `/api/exposure` for 2 weeks before it may block anything** | Phase 3 | Medium | **The platform can, for the first time, answer "how much am I risking?"** |
| **5 — Reconciliation** | `PositionRegistry`, persisted. Boot reconciliation. **A mismatch is an incident** | Phase 4 | **Medium — touches 4 engines. `strangle-engine` is NOT protected; `execution-engine` IS** | **Zero orphaned trades. Restart preserves the portfolio** |

---

# PART 13 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every position has a single owner | 🔴 **NO — 8 stores, and a restart owns them all** |
| Portfolio valuation is deterministic | 🔴 **NO — there is no portfolio** |
| Exposure is measurable | 🔴 **NO — zero aggregates exist** |
| Reconciliation is reproducible | 🔴 **NO — none exists** |
| Restarts preserve portfolio integrity | 🔴 **NO — 3 of 4 engines lose everything** |
| Portfolio history is fully auditable | 🔴 **NO — one `EventEmitter` in the codebase** |

## **0 of 6.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent engineer reconstruct the portfolio at any point in time, explain
every change, verify exposure, and reproduce the valuation?**

## **No. On every count. The Portfolio Engine does not exist.**

**What exists instead:**

- **Eight independent position stores**, none of which knows the others exist.
- **Three separate `capital` fields** — live: **₹88,011**, **₹96,761**, **₹700,000** — describing **one real account**, which **nothing adds up**.
- **Zero exposure aggregates.** `totalExposure`, `netDelta`, `netGamma`, `marginUsed`, `availableCapital`, `navSeries` — **every one measured at 0 modules.**
- **No orders. No fills. No partial exits. No position ids. No reconciliation. No audit history.**

**And the finding that outranks all of them, because it is live and it explains the others:**

> ## **`/api/risk` — the risk page — reports capital from `process.env`, a loss limit from `.env` (2%, while the engines run at 5%), and a consecutive-loss count computed from *today's* trades.**
>
> ## **It therefore displays `niftyConsecLosses: 0`.**
> ## **The engine's actual, persisted value is `15` — against a limit of `8`.**
>
> **The one screen whose entire purpose is to show that the risk brake is holding has been showing zero
> while the brake was seven losses past its limit and disarmed.**
>
> **That is not a display bug. It is the reason every other defect in this audit survived undetected.**
> **A risk display that reads a different source from the risk enforcer is not observability. It is
> reassurance.**

**The cheapest fix with the largest safety return in the entire audit programme:**
**make `/api/risk` ask the engines.**

**And the one thing that is genuinely right:** `agents-engine.js:458` — *"The engine cannot know what is
open. Saving disabled; file untouched. Reconcile by hand."* **One module, out of eight, refuses to guess
about what it holds. That is the standard the other seven must be held to.**

---

**Code modified: NONE. Execution/risk decisions: NOT IN SCOPE. Suite: 48/48.**

**Deliverables:** Portfolio Inventory (Part 1) · Position Lifecycle (Part 2) · Ownership Matrix
(Part 3) · Valuation Assessment (Part 4) · Exposure Governance (Part 5) · Reconciliation (Part 6) ·
Observability (Part 7) · Failure Mode Register (Part 8) · Architecture Blueprint (Part 9) · Testing
Strategy (Part 10) · Maturity Assessment (Part 11) · Migration Roadmap (Part 12) · Executive Summary.
