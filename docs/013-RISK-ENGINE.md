# 013 — RISK ENGINE, ENTERPRISE RISK GOVERNANCE & SAFETY ARCHITECTURE

**Standard:** Master Prompt 013 · **Depends on:** 000-A…E, 001-A…F, 002…012
**Date:** 2026-07-12 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. Trading NOT authorized. Risk parameters NOT modified.**

---

# SECTION 0 — THE FINDING

> ## 🔴 **SIX OF THE EIGHT RUNNING ENGINES HAVE NO RISK BRAKE OF ANY KIND.**
> ## 🔴 **AND THE EMERGENCY STOP COVERS ONLY THE TWO THAT DO.**

**Measured. Every engine, every brake:**

| Engine | Halt logic | Daily-loss | Consec-loss | Drawdown | **Verdict** |
|---|---|---|---|---|---|
| **`execution-engine.js`** (SENSEX + NIFTY) | 12 | 4 | 16 | 13 | 🟢 **FULL** |
| **`afternoon-engine.js`** (×2) | 11 | 2 | 13 | 9 | 🟢 **FULL** |
| 🔴 **`strangle-engine.js`** — **the ₹7L iron condor** | **0** | **0** | **0** | 2 | 🔴 **NONE** |
| 🔴 **`gamma-blast-engine.js`** | **0** | **0** | **0** | **0** | 🔴 **NONE** |
| 🔴 **`agents-engine.js`** | **0** | 6 | **0** | **0** | 🔴 daily-loss only |
| 🔴 **`bounce-engine.js`** | **0** | **0** | **0** | **0** | 🔴 **NONE** |
| 🔴 **`signal-paper-engine.js`** | **0** | **0** | **0** | **0** | 🔴 **NONE** |
| 🔴 **`pop-seller.js`** | **0** | **0** | **0** | **0** | 🔴 **NONE** |

**All eight are enabled right now** *(`data/config-overrides.json` — 004 §4)*.

## The three failures compose into one

```
 8 engines enabled
 └─ 2 have risk brakes            (execution-engine × 2 instruments, afternoon × 2)
    └─ and those brakes DO NOT SURVIVE A RESTART        (005 S-01: _haltedReason is never persisted)
       └─ and the page that displays them shows ZERO    (011 §0: /api/risk reads process.env)
          └─ and the EMERGENCY STOP covers only those same 2   (012 §0)
             └─ and a restart UNDOES the emergency stop         (B-3)
```

> **The platform's entire risk apparatus covers a quarter of its engines. For that quarter, the brake
> evaporates on restart. The page that would reveal this shows zeros. And the emergency stop — which
> also covers only that quarter — is itself undone by the next restart.**
>
> **The ₹7L iron condor, the largest allocation on the platform, has no daily-loss limit, no
> consecutive-loss limit, no drawdown halt, and cannot be stopped by the emergency stop.**

**Severity: CRITICAL.** Contained today **only** by `TRADE_MODE=paper`.

---

# PART 1 — RISK INVENTORY

| Control | Implemented in | Covers | Persisted? | Survives restart? | Confidence |
|---|---|---|---|---|---|
| **Daily loss limit** | `execution-engine:76`, `afternoon-engine` | **2 of 8 engines** | 🔴 **NO** (halt state absent) | 🔴 **NO** | HIGH |
| **Consecutive-loss limit** | `execution-engine:77,195` | **2 of 8** | 🟡 the **counter** yes; the **halt** no | 🔴 **NO** | HIGH |
| **Drawdown protection** | `execution-engine:99,166` | **2 of 8** | 🔴 **NO** | 🔴 **NO** | HIGH |
| **Max trades / day** | `getMaxTrades()` | 2 of 8 | 🔴 in-memory | 🔴 **NO** | HIGH |
| **Position limits** | 🟡 `_enteredToday` (one trade/day) | 2 of 8 | 🔴 **NO** | 🔴 **NO** | HIGH |
| **Exposure limits** | 🔴 **DO NOT EXIST** — `grep totalExposure\|netDelta` → **0 modules** | — | — | — | HIGH |
| **Capital protection** | 🟡 per-engine `capital` | 🔴 **3 separate accounts, never summed** (011 P1-A) | 🟡 | 🟡 | HIGH |
| **Session limits** | 🟡 entry windows | 2 of 8 | 🔴 | 🔴 | HIGH |
| **Trading halts** | `_haltedReason` — 5 paths | **2 of 8** | 🔴 **NEVER PERSISTED (S-01)** | 🔴 **NO** | HIGH |
| **Kill switch** | `/api/risk/emergency-stop` | 🔴 **2 of 8** | 🔴 **NO** | 🔴 **UNDONE BY RESTART** | HIGH |
| **Emergency controls** | 🔴 that is the complete list | — | — | — | HIGH |
| **Risk Engine** | 🔴 **DOES NOT EXIST** | — | — | — | HIGH |

---

# PART 2 — RISK DECISION FLOW

```
  Strategy Signal ──▶ 🟡 exists (no strategyId)
       ↓
  Portfolio State ──▶ 🔴 DOES NOT EXIST (011). No portfolio object. No NAV.
       ↓
  Capital State ────▶ 🔴 THREE separate capitals. Nothing sums them.
       ↓                  live: ₹88,011 · ₹96,761 · ₹700,000
       ↓
  RISK EVALUATION ──▶ 🔴🔴 **THIS STAGE DOES NOT EXIST.**
       ↓                  grep -rl "riskEngine|risk.evaluate|canTrade|allowTrade" → NOTHING
       ↓                  What exists is 2 engines checking THEIR OWN brakes, on THEIR OWN capital.
       ↓
  Approval / Rejection ─▶ 🔴 DOES NOT EXIST. No component may say "no" on behalf of the account.
       ↓
  Execution Request ──▶ 🔴 no order object (012)
       ↓
  Order ─────────────▶ 🟡 7 guarded placeOrder sites, no chokepoint
       ↓
  Monitoring ────────▶ 🔴 /api/risk reports the WRONG NUMBERS (011 §0)
       ↓
  Risk Updates ──────▶ 🔴 not persisted (005 S-01)
```

**Four of nine decision points do not exist. One reports false data.**

---

# PART 3 — RISK OWNERSHIP MATRIX

| Question | Answer | Verdict |
|---|---|---|
| **Who calculates risk?** | Each of 2 engines, for itself. **Nobody, for the account** | 🔴 **NO ACCOUNT-LEVEL OWNER** |
| **Who approves a trade?** | 🔴 **NOBODY. The engine approves itself and then places its own order** | 🔴 **MISSING** |
| **Who blocks a trade?** | Only the engine that wanted it | 🔴 **CONFLICT OF INTEREST BY DESIGN** |
| **Who halts trading?** | 5 paths in `execution-engine` + `afternoon-engine` — **for 2 of 8 engines** | 🔴 **PARTIAL** |
| **Who resumes trading?** | 🔴 **FOUR different actors:** `resetHalt()` (deliberate, correct) · `_resetIfNewDay()` (daily-loss only, correct) · **`setAutoEnabled(true)` (B-3 — cannot see the halt)** · **a restart (S-01 — the halt simply vanishes)** | 🔴 **CONFLICTING** |
| **Who persists risk state?** | 🔴 **NOBODY.** `saveEquity()` writes `{capital, reserve, consecLosses}` — **`_haltedReason` is not in the schema** | 🔴 **MISSING** |

> **Five code paths carefully halt an engine. Four different things un-halt it — and two of those four
> (`setAutoEnabled`, and a plain restart) cannot see that a halt was ever in force.**

---

# PART 4 — RISK CONTROLS ASSESSMENT

| Control | Classification | Evidence |
|---|---|---|
| **Daily loss limit** | 🟡 **PARTIALLY IMPLEMENTED** | Works in 2 of 8 engines. 🔴 **The live threshold is 5%, not the 2% written in `.env`** (004 C-01), and 🔴 **`/api/risk` displays the 2%** |
| **Consecutive-loss limit** | 🟡 **PARTIALLY IMPLEMENTED** | 🔴 **NIFTY is live at 15/8 and NOT halted** (005 §0). The check is an **edge trigger**, never re-evaluated at boot (S-02) |
| **Max open positions** | 🟡 **PARTIAL** | `_enteredToday` — **in-memory. A restart re-arms today's entry** (007 P6-A) |
| **Position sizing constraints** | 🟡 **PARTIAL** | `Math.min(25, …)` lot cap. 🔴 **Sized on premium, never on margin. SPAN is not captured** |
| **Instrument restrictions** | 🟡 | `instrument-registry` is fail-closed 🟢 — **but `server.js` bypasses it 8 times** (006 N-1) |
| **Session restrictions** | 🟡 **PARTIAL** | Entry windows in 2 of 8 |
| **Trading halt logic** | 🔴 **PARTIALLY IMPLEMENTED, FAILS OPEN** | **The design intent is correct** *(`execution-engine.js:135`: "a 5-trade losing streak across days is still a streak — needs manual reset")*. **The implementation loses it at every restart** |
| **Emergency shutdown** | 🔴 **PARTIALLY IMPLEMENTED** | **Stops 2 of 8. No reason recorded. Not persisted. Undone by a restart** (012 §0) |
| **Exposure limits** | 🔴 **NOT IMPLEMENTED** | 0 modules |
| **Account-level risk** | 🔴 **NOT IMPLEMENTED** | 0 modules |
| **Margin limits** | 🔴 **NOT IMPLEMENTED** | ⚪ SPAN not captured |

**Implemented: 0. Partially: 8. Not implemented: 3.**

---

# PART 5 — RISK STATE REPORT

| State | Owner | Persisted | Recovery | Reset policy |
|---|---|---|---|---|
| **Daily P&L** | `server.js` per-instrument | 🟡 `eod-*.json` (**raw write**) | 🟡 | daily |
| **`_consecLosses`** | engine | 🟢 **`equity-<inst>.json`** | 🟢 restored | 🟢 on a win, or `resetHalt()` |
| 🔴 **`_haltedReason`** | engine | 🔴 **NOT IN THE SCHEMA** | 🔴 **NONE — lost at every restart** | `_resetIfNewDay()` (DAILY_LOSS only) · `resetHalt()` |
| 🔴 **`autoEnabled`** | 🔴 **contested — engine, config, `setAutoEnabled`, restart** | 🟡 in `config-overrides.json` | 🔴 **the config wins over the halt** | — |
| **Current exposure** | 🔴 **DOES NOT EXIST** | — | — | — |
| **Session limits** | engine | 🔴 in-memory | 🔴 **a restart re-arms** | daily |
| **Strategy permissions** | 🔴 **DOES NOT EXIST** | — | — | — |

## The persisted schema, in full

```json
data/equity-nifty.json
{ "capital": 96761, "reserve": 0, "consecLosses": 15, "updatedAt": "2026-07-09T09:59:47.580Z" }
```

> **The engine writes down HOW MANY times it lost. It does not write down THAT IT DECIDED TO STOP.**
>
> **`consecLosses: 15` is on disk, right now, against a limit of 8 — and the engine boots, reads it,
> and trades.**

---

# PART 6 — FAIL-SAFE ANALYSIS

## 🟢 Fail-CLOSED — the platform gets these right

| Control | Evidence |
|---|---|
| **Corrupt equity file** | `execution-engine:386` → `_haltedReason = 'EQUITY_STATE_CORRUPT'` + `autoEnabled = false`. *"Cannot know the loss streak — HALTING (fail closed)"* 🟢 **EXEMPLARY** |
| **`TRADE_MODE` never persists to live** | Every boot starts in paper 🟢 **THE SINGLE BEST SAFETY DECISION IN THE CODEBASE** |
| **Expired broker token in live mode** | Entry refused 🟢 |
| **Unknown instrument** | `instrument-registry.lotSize()` returns `null` → engines refuse 🟢 |
| **Unknown VIX / event type** | Yields `UNKNOWN`, not a fabricated calm reading 🟢 *(fixed this session)* |
| **`safe-write` on corrupt input** | Refuses; leaves the file untouched 🟢 |
| **`agents-engine:458`** | *"The engine cannot know what is open. Saving disabled; file untouched. Reconcile by hand."* 🟢 |

## 🔴 Fail-OPEN — and these are where the money is

| # | Fail-open | Evidence |
|---|---|---|
| **1** | **The halt does not survive a restart** | 005 S-01 — `_haltedReason` is not in the persisted schema |
| **2** | **The halt is never re-evaluated at boot** | 005 S-02 — an edge trigger, not a level check. **NIFTY: 15/8, unhalted, live** |
| **3** | **`setAutoEnabled(true)` cannot see a halt** | B-3 — 0 references to `_haltedReason` |
| **4** | **The emergency stop is undone by a restart** | 012 §0 |
| **5** | **6 of 8 engines have no brake at all** | §0 |
| **6** | **`/api/risk` shows the wrong numbers** | 011 §0 — reads `process.env`, not the engine |
| **7** | **`_enteredToday` re-arms on restart** | 007 P6-A |
| **8** | **Open positions vanish on restart** | 010 §0 — 3 of 4 paper engines |
| **9** | **Unsafe default: `AUTH_ENABLED=false`** | 004 C-09 — default posture is ALLOW |
| **10** | **119 sites where an unknown market value becomes `0`** | 006 §0 |

## The verdict on 013's own question: *"does the platform prefer safety over availability?"*

> **In its DESIGN: unambiguously yes.** The fail-closed corrupt-state halt, the never-persist-live rule,
> the fail-closed registry, the refuse-rather-than-guess ledger — **these are the instincts of a
> safety-first system, and they are genuinely well done.**
>
> **In its LIFECYCLE: no.** **Every one of those safety decisions is discarded at the next restart,
> because the platform persists what it HAS and never what it DECIDED.**
>
> **The platform is safe while it is running and forgets why the moment it stops.**

---

# PART 7 — RISK OBSERVABILITY

| Required per risk decision | Recorded? |
|---|---|
| Timestamp | 🔴 **NO** |
| Risk check | 🔴 **NO** |
| Inputs | 🔴 **NO** |
| Thresholds | 🔴 **NO** |
| Outcome | 🟡 a `console.warn` at halt time |
| Responsible component | 🔴 **NO** |
| Reason | 🟡 `_haltedReason` — **in memory only, until the process dies** |

> **013's rule: *"Risk decisions without audit history are unacceptable."***
>
> **There is no risk audit history. A halt is a `console.warn` in a terminal scrollback, and it is gone
> forever the moment the process restarts. There is no way to answer: *"why did trading stop last
> Tuesday?"* — not approximately, not at all.**

---

# PART 8 — FAILURE MODE REGISTER

| ID | Failure | Consequence |
|---|---|---|
| **RK-1** | **Restart while halted** | 🔴 **THE HALT IS GONE. The engine trades.** *Live right now: NIFTY 15/8* |
| **RK-2** | **Restart after an emergency stop** | 🔴 **THE STOP IS UNDONE.** All engines resume |
| **RK-3** | **Corrupt risk state** | 🟢 **HALTS (fail-closed)** — 🔴 **until the next restart, when the halt is lost** |
| **RK-4** | **Missing market data** | 🔴 **Becomes `0`** (119 sites). A zero IV is a calm market |
| **RK-5** | **Missing portfolio state** | 🔴 **N/A — no portfolio exists** |
| **RK-6** | **Missing capital state** | 🟡 silently starts at ₹100,000 |
| **RK-7** | **Timer failure** | 🔴 **14 timers, 0 `clearInterval`.** A dead timer = a brake that never runs, **and nothing notices** |
| **RK-8** | **Unexpected exception in the risk path** | 🔴 **92 empty catches** — a failed check is indistinguishable from a passed one |
| **RK-9** | **The ₹7L condor exceeds any limit** | 🔴 **THERE IS NO LIMIT TO EXCEED** |

---

# PART 9 & 10 — RISK ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   RiskEngine  ★   THE SINGLE COMPONENT THAT MAY SAY "NO".

     RiskRegistry      every engine registers. No engine trades unregistered.
                       🔴 today: 6 of 8 engines are invisible to risk entirely.

     RiskEvaluator     evaluate(proposal) → { allow, reason }
                       Sees: Portfolio · Capital · Exposure · Halt state.
                       🔴 today: this call does not exist anywhere.

     RiskPolicies      declarative. Per-account, per-engine, per-instrument, per-expiry.
                       accountDailyLoss · accountDrawdown · grossExposure · netDelta ·
                       marginUtilisation · perEngineLimits
                       🔴 today: 0 of these are account-level.

     RiskStateManager  🔴 haltedReason IS PERSISTED, WITH its cause and its inputs.
                       🔴 An ABSENT halt field in an old file means UNKNOWN ⇒ BRAKE ON.
                       🔴 The invariant is RE-EVALUATED AFTER RESTORE (a LEVEL check).
                                                                        → kills S-01, S-02, RK-1

     HaltController    ONE way in, ONE way out.
                       autoEnabled is NOT SETTABLE while haltedReason is non-null.  → kills B-3
                       The kill switch iterates the REGISTRY, not a list of two.    → kills 012 §0
                       A halt PERSISTS. A restart NEVER clears it.                  → kills RK-2

     RiskAuditLog  ★   every check: ts · policy · inputs · threshold · outcome · reason.
                       🔴 today: nothing is retained.                               → kills PART 7
```

## Contract boundaries

| From | To | Rule |
|---|---|---|
| Strategy → Risk | `Proposal` | **A strategy MAY PROPOSE. It may NEVER approve itself.** 🔴 *Today it does both.* |
| Portfolio → Risk | exposure, NAV | 🔴 *Today: neither exists.* |
| Capital → Risk | one balance | 🔴 *Today: three.* |
| **Risk → Execution** | `{allow, reason}` | **No order reaches a broker without `allow: true`.** 🔴 *Today: 7 sites, zero gates.* |
| Risk → Monitoring | the audit log | 🔴 *Today: a `console.warn`.* |

---

# PART 11 — TESTING STRATEGY

**Safety tests take precedence. All of these would FAIL against the live system today.**

| Test | Priority | Would it fail now? |
|---|---|---|
| 🔴 **`halt → persist → restart → STILL HALTED`** | **P0** | ✅ **FAILS** — S-01 |
| 🔴 **`restore(consecLosses ≥ max) → HALTED at boot`** | **P0** | ✅ **FAILS** — NIFTY is 15/8 and running |
| 🔴 **`emergency-stop` halts EVERY registered engine, and survives a restart** | **P0** | ✅ **FAILS** — stops 2 of 8, not persisted |
| 🔴 **`setAutoEnabled(true)` on a halted engine → REFUSED** | **P0** | ✅ **FAILS** — B-3 |
| 🔴 **`/api/risk` reports the ENGINE's brake, not `process.env`** | **P0** | ✅ **FAILS** — shows 0, truth is 15 |
| 🔴 **Every engine has a daily-loss and a drawdown limit** | **P0** | ✅ **FAILS** — 6 of 8 have none |
| **An equity file with NO `haltedReason` field ⇒ UNKNOWN ⇒ BRAKE ON** | **P0** | forward-compatibility for the fix |
| **A dead timer is detected** | P1 | RK-7 |
| **A risk-path exception halts, never proceeds** | P1 | RK-8 |

**Six P0 safety tests. Every one fails against the running system.**

---

# PART 12 — RISK MATURITY ASSESSMENT

| Level | Met? | Evidence |
|---|---|---|
| **0 — Prototype** | 🟢 | Brakes exist for 2 of 8 engines |
| **1 — Basic Limits** | 🔴 **NO** | **6 of 8 engines have no limit of any kind** — including the ₹7L condor |
| **2 — Centralized Controls** | 🔴 **NO** | **No Risk Engine exists.** Each engine polices itself |
| **3 — Risk Governance** | 🔴 **NO** | No account-level exposure. No policies. No registry |
| **4 — Operational Safety** | 🔴 **NO** | **The halt does not survive a restart. The kill switch does not either** |
| **5 — Production Candidate** | 🔴 **NO** | — |

## ## **Risk Engine: LEVEL 0 — PROTOTYPE.**

**Strictly: the Risk Engine does not exist.** What exists is **two engines with good, well-designed
brakes that they forget every time the process restarts.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE — this document** | — | none | Every control, every gap catalogued |
| **2 — Ownership** *(the one that matters)* | 🔴 **PERSIST THE HALT (S-01)** · 🔴 **RE-EVALUATE AT BOOT (S-02)** · 🔴 **`setAutoEnabled` refuses while halted (B-3)** · 🔴 **The kill switch iterates every engine and persists (012 §0)** · 🔴 **`/api/risk` reads the engines (011 §0)** | Owner approval | 🔴 **BEHAVIOUR CHANGE — and it is the entire point.** A halt will now survive a restart, and **NIFTY will halt at boot.** 🔒 **`execution-engine.js` and `server.js` are PROTECTED** | **All six P0 safety tests pass.** NIFTY reads `halted: true, reason: CONSEC_LOSSES` |
| **3 — Centralization** | `RiskEngine` — **read-only at `/api/risk` for two weeks**, publishing what it *would* have blocked, **before it may block anything** | Phase 2 | Medium | Account-level exposure exists and has been **correct for a fortnight** |
| **4 — Observability** | `RiskAuditLog`. Every check retained | Phase 3 | Low — additive | *"Why did trading stop last Tuesday?"* becomes answerable |
| **5 — Operational validation** | Every engine registered. Every engine limited. Chaos-test the restart paths | Phase 4 | Medium | **0 fail-open paths** |

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every risk decision has a single owner | 🔴 **NO — the engine that wants the trade approves it** |
| Risk approvals are deterministic | 🔴 **NO — there are no approvals** |
| **Trading halts fail closed** | 🔴 **NO — they fail closed while running, and fail OPEN at restart** |
| **Risk state survives restart correctly** | 🔴 **NO — the halt is not persisted at all** |
| Safety controls are observable | 🔴 **NO — `/api/risk` shows zeros while the engine sits at 15/8** |
| Unknown conditions default to safe | 🟡 **Sometimes yes (corrupt state, unknown instrument, unknown VIX) · often no (119 `\|\| 0` sites)** |
| Every blocked/approved trade is auditable | 🔴 **NO — no audit history exists** |

## **0 of 7.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent risk engineer explain every approval and rejection, reproduce every
risk decision, verify that failures default to safe, and confirm the platform cannot bypass its
documented controls?**

## **No. And the reason is not that the controls are badly designed. It is that they do not exist for most of the platform, and do not persist for the rest.**

**What is genuinely good — and it is real:**

The **design instincts are excellent.** A corrupt equity file **halts the engine** rather than guess at
the loss streak. `TRADE_MODE` **never persists to live**, so every boot starts in paper. An unknown
instrument **refuses to size**. An unknown VIX yields `UNKNOWN`, not a fabricated calm. `agents-engine`
**refuses to write** rather than pretend it knows what it holds. The comment at
`execution-engine.js:135` — *"a losing streak across days is still a streak — needs manual reset"* — is
**exactly right**.

**Every one of those is the instinct of a safety-first system. And every one of them is thrown away at
the next restart.**

**What is measured, and what it means:**

> **Eight engines are enabled. Two have risk brakes. Six — including the ₹7 lakh iron condor, the
> largest allocation on the platform — have no daily-loss limit, no consecutive-loss limit, and no
> drawdown halt.**
>
> **The two that do have brakes cannot keep them: `_haltedReason` is never written to disk, so no halt
> of any kind — daily loss, drawdown, consecutive losses, corrupt state — has ever survived a restart.**
>
> **The proof is live, right now: the NIFTY engine sits at 15 consecutive losses against a limit of 8,
> unhalted and enabled.**
>
> **The page whose entire purpose is to show that number displays `0`, because it reads `process.env`
> instead of the engine.**
>
> **And the emergency stop — the last line of defence — covers only those same two engines, records no
> reason, persists nothing, and is silently reversed by the next restart.**

**The platform is safe while it is running, and forgets why the moment it stops.**

**The single highest-value change in this entire audit programme, stated as one sentence:**

> ## **Put `haltedReason` in the file, re-check it at boot, and refuse to enable an engine that is halted.**

**Three changes. Under twenty lines. They convert every fail-open in this document into a fail-closed —
and they are the reason `TRADE_MODE=paper` is currently the only thing standing between this platform
and a real account.**

---

**Trading: NOT AUTHORIZED. Risk parameters: NOT MODIFIED. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Risk Inventory (Part 1) · Decision Flow (Part 2) · Ownership Matrix (Part 3) ·
Controls Assessment (Part 4) · Risk State (Part 5) · Fail-Safe Analysis (Part 6) · Observability
(Part 7) · Failure Modes (Part 8) · Architecture & Contracts (Parts 9–10) · Testing Strategy (Part 11) ·
Maturity Assessment (Part 12) · Migration Roadmap (Part 13) · Executive Summary.
