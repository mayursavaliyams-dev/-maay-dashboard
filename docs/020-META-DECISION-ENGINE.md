# 020 — META DECISION ENGINE, DECISION ORCHESTRATION & EVIDENCE-FIRST GOVERNANCE

**Standard:** Master Prompt 020 · **Depends on:** 000-A…E, 001-A…F, 002…019
**Date:** 2026-07-12 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No strategy created. No risk control overridden. Live trading NOT authorized.**

**This is the capstone of the audit programme. Every finding converges here.**

---

# SECTION 0 — THE META DECISION ENGINE, RUN FOR THE FIRST TIME

**The Meta Decision Engine does not exist.**

**But 020 Part 3 defines exactly what it must do: require seven pieces of evidence, and BLOCK when any
is missing. Every one of those seven has now been measured by this audit programme.**

**So I ran it.**

```
  ENGINE                              strategy  stats  paper  calib  reliab  risk   ops    VERDICT
  ─────────────────────────────────────────────────────────────────────────────────────────────────
  strangle-engine (IRON CONDOR, ₹7L)    FAIL    FAIL   FAIL   FAIL   FAIL   FAIL   FAIL   BLOCKED (0/7)
  execution-engine (DIRECTIONAL ×2)     FAIL    FAIL   FAIL   FAIL   FAIL   PASS   FAIL   BLOCKED (1/7)
  afternoon-engine ×2                   FAIL    FAIL   FAIL   FAIL   FAIL   PASS   FAIL   BLOCKED (1/7)
  gamma-blast-engine                    FAIL    FAIL   FAIL   FAIL   FAIL   FAIL   FAIL   BLOCKED (0/7)
  agents-engine                         FAIL    FAIL   FAIL   FAIL   FAIL   FAIL   FAIL   BLOCKED (0/7)
  bounce-engine                         FAIL    FAIL   FAIL   FAIL   FAIL   FAIL   FAIL   BLOCKED (0/7)
  ─────────────────────────────────────────────────────────────────────────────────────────────────
  ENABLED RIGHT NOW : 8 engine instances
  WOULD BE APPROVED : 0
  WOULD BE BLOCKED  : 8
```

## The evidence behind every FAIL — each cited, none assumed

| Gate | Requirement (020 Part 3) | Measured reality |
|---|---|---|
| **strategy** | The strategy is valid | 🔴 **The ₹7L iron condor's live structure has NEVER been backtested.** The cited backtest models a naked strangle *(007 §0)* |
| **stats** | Statistically validated | 🔴 **0 of 8 strategies have walk-forward, purged k-fold, bootstrap, PSR or DSR applied.** The one that does now scores **`FAIL (likely overfit)`** *(002 §0, 009)* |
| **paper** | Sufficient paper evidence | 🔴 **12 outcomes, 4 calendar days, 1 instrument, 0 regime changes.** vs M2's ~200 = **6%.** And **3 of 4 engines LOSE their open positions on restart** *(010 §0)* |
| **calib** | Probability calibrated | 🔴 **The first calibration ever performed returns AUC 0.685, p = 0.191 — indistinguishable from chance** *(019 §0)* |
| **reliab** | Reliability measured | 🔴 **Every `reliability` is null. Two factors (`fii`, `volume`) vote with n = 0** *(016 §0)* |
| **risk** | Risk approved | 🔴 **6 of 8 engines have NO daily-loss, NO consecutive-loss and NO drawdown limit.** The 2 that do **lose their halt on every restart** *(013 §0, 005 S-01)* |
| **ops** | Operationally ready | 🔴 **Emergency stop covers 2 of 8 and is undone by a restart.** Margin is never modelled — **₹9.8L allocated from a ₹1L account** *(012 §0, 014 §0)* |

---

## §0.1 — 🔴 **THE PLATFORM HAS ALREADY WRITTEN THIS ENGINE. IT JUST NEVER RAN IT.**

```js
engine-verdict.js:25
 *   2. `reliability: null` ⇒ weight 0 ⇒ VETO-ONLY.
 *      An engine that has never been measured may not steer.
```

**Every engine's reliability is `null`.**
**By the platform's own contract, every weight is 0.**
**A weighted ensemble of eight zero-weight engines is the empty sum.**

> ## **The Meta Decision Engine's v1 output was ALWAYS knowable, from the contract alone:**
> ## **`INSUFFICIENT_DATA`.**
>
> **`engine-verdict.js` is correct, is tested with 114 assertions, and has ONE adopter of eight engines.
> Had it been adopted, the platform would have been telling itself `INSUFFICIENT_DATA` from the day it
> was written.**
>
> **Instead, eight engines bypass the contract, emit raw `BUY`/`SELL`, and trade.**

---

# PART 1 — DECISION INVENTORY

| Input | Source | Owner | Validated? | Confidence |
|---|---|---|---|---|
| **Strategy signals** | 8 engines | per-engine | 🔴 **NO — 7 of 8 bypass `engine-verdict`** | HIGH |
| **Portfolio state** | — | 🔴 **NONE** | 🔴 **DOES NOT EXIST** *(011)* | HIGH |
| **Capital state** | 3 modules | 🔴 **NONE** | 🔴 **9.8× over-allocated** *(014 §0)* | HIGH |
| **Risk approvals** | — | 🔴 **NONE** | 🔴 **THE STAGE DOES NOT EXIST** — `grep riskEngine\|canTrade` → nothing *(013)* | HIGH |
| **Probability estimates** | `prob: 76` | 🔴 **NONE** | 🔴 **UNCALIBRATED. p = 0.191** *(019 §0)* | HIGH |
| **Reliability estimates** | — | 🔴 **NONE** | 🔴 **ALL NULL** | HIGH |
| **Calibration status** | — | — | 🔴 **NEVER PERFORMED before 019** | HIGH |
| **Market regime** | `_computeRegime()` | — | 🔴 **An unreachable VIX scores as maximally calm** *(pending approval)* | HIGH |
| **Session state** | `_resetIfNewDay()` | engine | 🔴 **In-memory. A restart re-arms today's entry** *(007 P6-A)* | HIGH |
| **Operational state** | `/healthz` | — | 🔴 **Reports uptime only. `/api/m/health` → 404** *(001-E)* | HIGH |

**Ten decision inputs. Three do not exist. Seven are unvalidated. Zero have an owner.**

---

# PART 2 — DECISION PIPELINE

```
  Market Data ──────▶ 🔴 `|| 0` × 119. Unknown becomes a number.              (006 §0)
       ↓
  Feature Store ────▶ 🔴🔴 DOES NOT EXIST. Features computed and DISCARDED.   (018)
       ↓                ⇒ NO decision is reproducible. Ever. And it worsens daily.
       ↓
  Strategies ───────▶ 🟡 8 engines. 🔴 7 bypass the verdict contract.          (007)
       ↓
  Validation Evidence ▶ 🔴 0 of 8 strategies validated.                        (009)
       ↓
  Probability Engine ─▶ 🔴 uncalibrated. p = 0.191.                            (019 §0)
       ↓
  Portfolio ────────▶ 🔴 DOES NOT EXIST.                                       (011)
       ↓
  Capital ──────────▶ 🔴 ₹9,80,000 claimed from a ₹1,00,000 account.           (014 §0)
       ↓
  Risk ─────────────▶ 🔴🔴 DOES NOT EXIST.                                     (013)
       ↓
  META DECISION ────▶ 🔴🔴🔴 DOES NOT EXIST.
       ↓                And if it did, §0 shows it would BLOCK all 8.
       ↓
  Execution ────────▶ 🟢 7/7 placeOrder sites guarded. PAPER MODE HOLDS.       (012 §1)
       ↓
  Outcome ──────────▶ 🟡 12 rows. 🔴 5 of 14 required fields missing.          (010 §3)
```

## **Four of eleven stages do not exist. The only one that fully works is the one that stops real money.**

---

# PART 3 — EVIDENCE GATING ASSESSMENT

| Does the platform gate on…? | Present? |
|---|---|
| Strategy validity | 🔴 **NO.** An engine is enabled by setting a boolean to `true` in `config-overrides.json` *(015 Part 6)* |
| Statistical validation | 🔴 **NO** |
| Paper trading evidence | 🔴 **NO** |
| Probability calibration | 🔴 **NO** |
| Reliability | 🔴 **NO** — 🟢 **but the RULE exists** (`engine-verdict.js`) and has 1 adopter |
| Risk approval | 🔴 **NO — the stage does not exist** |
| Operational readiness | 🔴 **NO** |

## ## 🔴 **THERE IS NO EVIDENCE GATE ANYWHERE IN THIS PLATFORM.**

**A strategy goes from an idea to steering live (paper) capital by way of a JSON boolean. Nothing in the
running system knows that a strategy was invalidated, that its structure was never backtested, or that
its probability is uncalibrated.**

---

# PART 4 — DECISION STATES

| State | Exists? |
|---|---|
| `NOT_READY` | 🔴 **NO** |
| `INSUFFICIENT_DATA` | 🔴 **NO** — 🔴 **and §0.1 proves it is the ONLY honest answer today** |
| `BLOCKED` | 🔴 **NO** |
| `READY_FOR_REVIEW` | 🔴 **NO** |
| `APPROVED` | 🔴 **NO** |
| `EXECUTED` | 🟡 implicit — a position appears | |
| `ARCHIVED` | 🟡 a closed-trade ledger row | |

**Five of seven decision states do not exist. The platform has exactly two: "a position exists" and "a
position closed."**

> **There is no state in which this system can say *"I do not know."*** *(020 Part 15 requires
> `INSUFFICIENT_DATA` and `UNKNOWN` as first-class outcomes. Neither exists.)*

---

# PART 5 — DECISION OWNERSHIP MATRIX

| Question | Answer |
|---|---|
| **Who creates decisions?** | **8 engines, independently. None sees another** *(007 P7-A)* |
| **Who validates decisions?** | 🔴 **NOBODY** |
| **Who approves decisions?** | 🔴 **NOBODY. The engine that wants the trade approves it** |
| **Who blocks decisions?** | 🔴 **NOBODY.** *(An engine's own brake is not a block — and 6 of 8 have none)* |
| **Who archives decisions?** | 6 incompatible ledgers |

### **CONFLICT OF INTEREST BY DESIGN: the proposer is the approver is the executor.**

**020's stop condition: *"Stop and report UNKNOWN if decision ownership cannot be established."***
## **→ DECISION OWNERSHIP: DOES NOT EXIST.**

---

# PART 6 — DECISION OBSERVABILITY

| Required per decision | Recorded? |
|---|---|
| Timestamp | 🟢 |
| **Decision ID** | 🔴 **DOES NOT EXIST** |
| **Input versions** | 🔴 **DOES NOT EXIST** |
| **Evidence references** | 🔴 **DOES NOT EXIST** |
| Probability | 🟡 `prob: 76` — 🔴 **unjustified** |
| **Reliability** | 🔴 **NULL, always** |
| **Risk outcome** | 🔴 **THE STAGE DOES NOT EXIST** |
| **Final status** | 🔴 **THE STATES DO NOT EXIST** |
| **Reason** | 🔴 **NOT RECORDED** |

## **2 of 9. 020's rule: *"Decisions without provenance are not trustworthy."***

---

# PART 7 — FAILURE MODE REGISTER

| ID | Failure | Present? | Impact |
|---|---|---|---|
| **MD-1** | **Missing evidence does not block** | 🔴 **CONFIRMED** | **CRITICAL. §0: all 8 engines would be BLOCKED, and all 8 are running** |
| **MD-2** | **Missing validation does not block** | 🔴 **CONFIRMED** | **CRITICAL. 0 of 8 validated** |
| **MD-3** | **Missing calibration does not block** | 🔴 **CONFIRMED** | **CRITICAL. Never performed before 019** |
| **MD-4** | **Missing risk approval does not block** | 🔴 **CONFIRMED** | **CRITICAL. The stage does not exist** |
| **MD-5** | **Conflicting strategies** | 🔴 **UNDETECTABLE.** No engine sees another. Nothing nets | **HIGH** |
| **MD-6** | **Contradictory evidence** | 🔴 **CONFIRMED.** Two `bsGamma`s disagree on `r`. `maxDD` means a fraction in one script and points in another | HIGH |
| **MD-7** | **Unknown market conditions** | 🔴 **BECOME ZERO** — 119 sites | **CRITICAL** |
| **MD-8** | **No `INSUFFICIENT_DATA` state exists** | 🔴 **CONFIRMED** | **CRITICAL — the system is structurally incapable of saying "I don't know"** |

---

# PART 8 — SAFETY GOVERNANCE

**020: *"Determine whether unsafe conditions fail closed."***

## 🟢 Where the platform touches MONEY — **it fails closed, and it does it well**

| | |
|---|---|
| **Paper/live isolation** | 🟢 **7 of 7 `placeOrder` sites guarded. `TRADE_MODE` never persists to live. Every boot starts in paper** *(012 §1)* |
| **Corrupt equity state** | 🟢 **HALTS.** *"Cannot know the loss streak — HALTING (fail closed)"* |
| **Unknown instrument** | 🟢 `lotSize()` → `null` ⇒ **refuse** |
| **Expired broker token in live mode** | 🟢 **Entry refused** |
| **Unreadable position file** | 🟢 `agents-engine:458` — ***"The engine cannot know what is open. Saving disabled; file untouched. Reconcile by hand."*** |
| **Unknown VIX / event type** | 🟢 Yields `UNKNOWN`, not a fabricated calm |

## 🔴 Where the platform touches EVIDENCE — **it fails OPEN, every time**

| | |
|---|---|
| **Unknown market data** | 🔴 **Becomes `0`** — 119 sites |
| **Unobserved factor** | 🔴 **Gets a default weight of 10.08 and votes** |
| **Uncalibrated score** | 🔴 **Published as `prob: 76`** |
| **Unvalidated strategy** | 🔴 **Enabled by a JSON boolean** |
| **A halt** | 🔴 **Evaporates at the next restart** |
| **An emergency stop** | 🔴 **Covers 2 of 8, and is undone by a restart** |

## The structural finding of the entire audit programme

> ## **This platform knows how to say *"I cannot know"* about money — and has never once said it about evidence.**
>
> **The same authors. The same codebase. Two opposite instincts, and only one of them was ever
> written down as a rule.**
>
> **`engine-verdict.js` IS that rule, applied to evidence. It is correct. It is tested with 114
> assertions. It has one adopter.**

---

# PART 9 & 10 — META DECISION ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   EvidenceValidator  ★★★   THE GATE. It runs FIRST, and it can only say no.

     For every proposal, it demands:
       strategyValid  ← StrategyRegistry: is the LIVE STRUCTURE backtested?     (007 §0)
       statValid      ← ValidationEngine: WF + k-fold + bootstrap + DSR?        (009)
       paperEvidence  ← EvidenceStore: n ≥ M2, complete, traceable?             (010)
       calibrated     ← CalibrationLayer: Brier + AUC + **p-value**?            (019 §0)
       reliability    ← ReliabilityRegistry: MEASURED out-of-sample, or null?   (016)
       riskApproved   ← RiskEngine: account-level exposure says allow?          (013)
       opsReady       ← health, halt-persistence, kill-switch coverage?         (012)

     🔴 ANY MISSING ⇒ BLOCKED. Never fabricate readiness.
     🔴 The DEFAULT is BLOCKED. Evidence unblocks. Absence never approves.

   DecisionStateManager  ★
     NOT_READY → INSUFFICIENT_DATA → BLOCKED → READY_FOR_REVIEW → APPROVED → EXECUTED → ARCHIVED
     🔴 INSUFFICIENT_DATA and UNKNOWN are FIRST-CLASS, PUBLISHABLE outcomes.
        Today the system has NO WAY TO SAY "I DON'T KNOW."                        → kills MD-8

   DecisionCoordinator
     Strategies PROPOSE (EngineVerdict). They never approve, never size, never place.
     The Coordinator is the ONLY thing that composes them — and it composes ZEROS
     until a reliability has been MEASURED.                                       → §0.1

   DecisionRegistry + DecisionAuditLog  ★
     decisionId · ts · inputVersions · evidenceRefs · probability(+n, +CI) ·
     reliability · riskOutcome · status · reason
     🔴 A decision WITHOUT a reason is not a decision. It is an event.
```

## Contract boundaries

| From | To | Rule |
|---|---|---|
| Strategy → Meta | `EngineVerdict` | **PROPOSE only. `reliability: null` ⇒ weight 0 ⇒ VETO-ONLY.** 🟢 *Already written. 1 adopter.* |
| Validation → Meta | evidence | 🔴 **Stage 1 is temporal integrity, and it is a HARD GATE** *(009 §0 proved no statistic detects a look-ahead)* |
| Probability → Meta | `p` **or `null`** | 🔴 **An uncalibrated score is NOT a probability** *(019)* |
| Risk → Meta | `{allow, reason}` | 🔴 **No order without `allow: true`.** *Today: 7 sites, 0 gates* |
| Meta → Execution | `APPROVED` **only** | 🔴 **`BLOCKED` must be unbypassable** |

---

# PART 11 — TESTING STRATEGY

**Safety tests have priority. All of these fail today.**

| Test | Priority | Fails now? |
|---|---|---|
| 🔴 **An engine with any FAILED evidence gate CANNOT be enabled** | **P0** | ✅ **FAILS — §0: 8 of 8 would be BLOCKED, and 8 of 8 are running** |
| 🔴 **`reliability: null` ⇒ weight 0** *(the platform's own contract)* | **P0** | ✅ **FAILS — `fii` votes at 10.08 on n = 0** |
| 🔴 **`INSUFFICIENT_DATA` is a publishable decision outcome** | **P0** | ✅ **FAILS — the state does not exist** |
| 🔴 **An uncalibrated score is never published as a probability** | **P0** | ✅ **FAILS — `prob: 76`** |
| 🔴 **A strategy whose live structure is unbacktested cannot be enabled** | **P0** | ✅ **FAILS — the ₹7L condor** |
| 🔴 **No order without an explicit `RiskEngine.allow`** | **P0** | ✅ **FAILS — 7 sites, 0 gates** |
| 🔴 **Every decision records a `reason`** | **P0** | ✅ **FAILS** |
| **Unknown market data ⇒ `null`, never `0`** | **P0** | ✅ **FAILS — 119 sites** |

**Eight P0 safety tests. All eight fail.**

---

# PART 12 — DECISION MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Concept** | 🟢 | 🟢 **The concept EXISTS and is CORRECT** — `engine-verdict.js`, 114 assertions |
| **1 — Decision Aggregation** | 🔴 **NO** | **Nothing aggregates. 8 engines decide independently and none sees another** |
| **2 — Evidence Gating** | 🔴 **NO** | **No gate exists. §0 shows all 8 engines would be BLOCKED** |
| **3 — Governed Decisions** | 🔴 **NO** | **The proposer is the approver is the executor** |
| **4 — Observable Orchestration** | 🔴 **NO** | **2 of 9 provenance fields. No decision ID. No reason** |
| **5 — Production Candidate** | 🔴 **NO** | — |

## ## **Meta Decision Engine: LEVEL 0 — CONCEPT.**

**The concept is written, tested, and correct. Nothing uses it.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE — this document.** **And the evidence gate has now been RUN (§0)** | — | none | The verdict is measured: **8 of 8 BLOCKED** |
| **2 — Evidence governance** | 🔴 **ADOPT `engine-verdict.js` IN ALL 8 ENGINES.** It already exists. **It has one adopter.** | none | 🔴 **BEHAVIOUR CHANGE: every weight becomes 0, and the ensemble honestly returns `INSUFFICIENT_DATA`. THAT IS THE CORRECT ANSWER.** Approval | **Every engine publishes a verdict with an honest `reliability: null`** |
| **3 — Decision orchestration** | **`EvidenceValidator` + `DecisionStateManager`, in SHADOW MODE.** Publish what it *would* block at `/api/decisions` for two weeks. **Block nothing yet** | Phase 2 | **Low — it decides nothing** | **The dashboard shows `BLOCKED (0/7)` beside every running engine.** *This alone is the highest-value observability change available* |
| **4 — Observability** | `DecisionRegistry` + `DecisionAuditLog`. Every decision: id, evidence refs, reason | Phase 3 | Low | *"Why did the system trade?"* becomes answerable |
| **5 — Operational readiness** | 🔴 **The gate becomes BINDING.** A `BLOCKED` engine cannot trade | Phase 4 | 🔴 **THIS WOULD STOP EVERY ENGINE ON THE PLATFORM TODAY. That is the point of building it** | **An engine trades only on evidence. `BLOCKED` is unbypassable** |

---

# PART 14 & 15 — SUCCESS CRITERIA & CANONICAL OUTCOMES

| Criterion | Status |
|---|---|
| Every decision has one owner | 🔴 **NO — the proposer approves itself** |
| Decisions require validated evidence | 🔴 **NO — a JSON boolean is the gate** |
| **Missing evidence blocks execution** | 🔴 **NO — §0: 8 of 8 would be blocked, 8 of 8 are trading** |
| Risk cannot be bypassed | 🔴 **NO — the Risk Engine does not exist** |
| Decisions are reproducible | 🔴 **NO — the features were discarded** |
| Decision history is auditable | 🔴 **NO — no decision ID, no reason** |
| **Unknown conditions default to safe** | 🔴 **NO for evidence** · 🟢 **YES for money** |

**Canonical outcomes required (Part 15):** `APPROVED` · `REJECTED` · `BLOCKED` · `INSUFFICIENT_DATA` ·
`UNKNOWN`
## **Implemented: ZERO of five.**

---

# EXECUTIVE SUMMARY — AND THE CONCLUSION OF THE AUDIT PROGRAMME

**The mission: could an independent researcher inspect any decision, identify every input, reproduce the
orchestration, verify the evidence, and determine exactly why the system approved, blocked, rejected or
deferred it?**

## **No. And this audit has now measured precisely why.**

**The Meta Decision Engine does not exist. So I built its evidence gate on paper, populated it with the
seven measurements this programme produced, and ran it:**

> ## **Eight engines are enabled. Eight would be BLOCKED. Zero would be approved.**
> ## **The best score any engine achieves is one gate out of seven.**
> ## **The ₹7 lakh iron condor — the platform's largest allocation — scores ZERO of seven.**

**And the deepest finding of the entire programme is this:**

> ## **The platform already wrote this engine. It just never ran it.**
>
> ```js
> engine-verdict.js:25   "reliability: null ⇒ weight 0 ⇒ VETO-ONLY.
>                         An engine that has never been measured may not steer."
> ```
>
> **Every engine's reliability is null. By this contract — which is correct, which is enforced by 114
> passing assertions, and which is sitting in the repository right now — every weight is zero, and the
> ensemble is the empty sum.**
>
> **The Meta Decision Engine's v1 output was ALWAYS knowable, from the contract alone, without a single
> line of new code: `INSUFFICIENT_DATA`.**
>
> **`engine-verdict.js` has ONE adopter out of eight engines. The other seven bypass it, emit raw
> `BUY`/`SELL`, and trade.**

**The structural truth, stated once, plainly:**

> **This platform knows how to say *"I cannot know"* about MONEY. A corrupt ledger halts the engine. An
> unknown instrument refuses to size. `agents-engine` writes: *"The engine cannot know what is open.
> Saving disabled. Reconcile by hand."* Seven of seven order paths are guarded. `TRADE_MODE` never
> persists to live. **These are the instincts of a system built by someone who knew what they did not
> know, and they are holding.**
>
> **And it has never once said it about EVIDENCE. A factor observed zero times gets a weight of 10.08.
> A score never checked against reality is published as `prob: 76`. A strategy whose structure was never
> backtested runs on ₹7 lakh. A halt evaporates at the next restart. An unknown market value becomes
> zero, one hundred and nineteen times.**
>
> **Same authors. Same codebase. Opposite instinct — and only one of the two was ever written down as a
> rule.**

**The single highest-value change available, and it requires no new architecture:**

> ## **Adopt `engine-verdict.js` in all eight engines. It already exists. It is already right.**
>
> **Every weight will become zero. The ensemble will honestly return `INSUFFICIENT_DATA`. And for the
> first time in this platform's history, it will be telling the truth about what it knows.**

---

**Strategies created: NONE. Risk controls overridden: NONE. Live trading: NOT AUTHORIZED.
Code modified: NONE. Suite: 48/48.**

**Deliverables:** Decision Inventory (Part 1) · Pipeline (Part 2) · **Evidence Gating Assessment — RUN
FOR THE FIRST TIME (§0, Part 3)** · Decision States (Part 4) · Ownership Matrix (Part 5) ·
Observability (Part 6) · Failure Modes (Part 7) · Safety Governance (Part 8) · Architecture & Contracts
(Parts 9–10) · Testing Strategy (Part 11) · Maturity Assessment (Part 12) · Migration Roadmap
(Part 13) · Executive Summary.
