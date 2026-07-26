# 030 — ENTERPRISE ARCHITECTURE, TECHNICAL DEBT & LONG-TERM EVOLUTION

**Standard:** Master Prompt 030 · **Depends on:** 000-A … 029
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No application redesigned. No module rewritten. Zero code modified.**

## **This is the final document of the audit programme. Thirty-two audits. Zero lines of production code changed. Every finding measured.**

---

# SECTION 0 — THE DEFINING FINDING OF THE ENTIRE PROGRAMME

**Thirty-one audits looked for missing components. They found something else, ten times.**

| Component | What it does — **correctly** | Adoption |
|---|---|---|
| **`engine-verdict.js`** | `reliability: null ⇒ weight 0 ⇒ VETO-ONLY`. 114 assertions | 🔴 **1 of 8 engines** |
| **`module-contract.js`** | 11 service surfaces, health/metrics/OpenAPI, secret redaction | 🔴 **0 routes — all 404** |
| **`bt-validate.js`** | Purged k-fold · walk-forward · PSR · deflated Sharpe | 🔴 **0 strategy callers** |
| **`position-sizer.js`** | Margin-aware sizing. Its own header calls premium sizing *"fantasy"* | 🔴 **Imported, and DISABLED by default** |
| **`auth.js`** | HMAC-SHA256 · `crypto.timingSafeEqual` · expiry · RBAC · fail-closed | 🔴 **0 of 172 routes** |
| **Append-only `.jsonl` writer** | Immutable, date-partitioned event log | 🔴 **Points at migrations and news headlines** |
| **`scripts/perf-report.js`** | Refuses to boot the server to measure; reports UNKNOWN rather than guessing | 🔴 **Never run against a live server** |
| **`ecosystem.config.js`** (PM2) | `autorestart`, `max_restarts: 10`, `restart_delay: 3000` | 🔴 **NOT RUNNING** |
| **`docker-compose.yml`** | `restart: unless-stopped` + a working `/healthz` HEALTHCHECK | 🔴 **NOT RUNNING** |
| **`OPS-PLAYBOOK.md §7`** | *"Never trust a single backtest… proven by forward-test, not a fancier signal"* | 🔴 **VIOLATED — the ₹7L condor runs on a backtest of a different structure** |

> ## 🔴 **TEN CORRECT COMPONENTS. ZERO-TO-PARTIAL ADOPTION.**
>
> ## **This platform's defining architectural characteristic is not that it lacks the right components. It is that it builds them — correctly, thoughtfully, with tests — and then leaves them switched off.**

## §0.1 — And what IS adopted is excellent

| Component | Ca | Instability | Status |
|---|---|---|---|
| **`safe-write.js`** | **17** | **I = 0.00** | 🟢 **ADOPTED — 18 modules.** Atomic, `.bak`, validate-by-reparse, fail-closed |
| **`charges.js`** | **12** | **I = 0.00** | 🟢 **ADOPTED — one implementation** *(rates disputed — E1)* |
| **`instrument-registry.js`** | **10** | **I = 0.00** | 🟢 **ADOPTED — fail-closed, broker-verified.** 🔴 *But `server.js` hardcodes the lot **8 times***, bypassing it |

**Three stable abstractions at `I = 0.00` with high afferent coupling. Zero dependency cycles.**
**This is a textbook shared kernel, and most codebases this age do not have one.**

## §0.2 — The architectural diagnosis, stated once

> **The problem is NOT capability. It is ADOPTION GOVERNANCE.**
>
> **There is no mechanism in this platform by which a correct component becomes a *required* one.**
> **`engine-verdict.js` says an unmeasured engine may not steer — and seven engines bypass it, because
> nothing forces them not to. `auth.js` protects nothing, because nothing mounts it. PM2 restarts
> nothing, because the runbook says `node server.js`.**
>
> ## **Every one of the ten is one decision away from working. None of them is one line of code away from existing.**

---

# PART 1 — ARCHITECTURE INVENTORY

| Domain | Owner | Coupling | Complexity | Maturity | Confidence |
|---|---|---|---|---|---|
| **API Layer** | 🔴 `server.js` | 🔴 **Ce = 61** | **172 routes, 0 Routers** | **L0** | HIGH |
| **Trading Engine** | per-engine | 🟡 | 6 engines | **L1** | HIGH |
| **Risk Engine** | 🔴 **NOBODY** | — | — | 🔴 **DOES NOT EXIST** | HIGH |
| **Capital Engine** | 🔴 **3 modules** | 🔴 | **₹9.8L claimed from ₹1L** | **L0–1** | HIGH |
| **Portfolio** | 🔴 **NOBODY** | — | — | 🔴 **DOES NOT EXIST** | HIGH |
| **Paper Trading** | per-engine | 🟡 | 6 ledgers | **L0** | HIGH |
| **AI Platform** | `confluence-learner` | 🟡 | 1 live learner, n=5–10 | **L0** | HIGH |
| **Research Platform** | 🔴 **NOBODY** | 🟢 isolated | 13 scripts | **L1** | HIGH |
| **Data Platform** | 🟢 `safe-write` | 🟢 **I = 0.00** | 51 files | **L0–1** | HIGH |
| **Storage** | 🟢 `safe-write` | 🟢 | — | **L1** | HIGH |
| **Monitoring** | 🔴 **NOBODY** | — | — | **L0** | HIGH |
| **Security** | 🔴 **NOBODY** | — | `auth.js` correct, unused | **L0** | HIGH |
| **Configuration** | 🔴 **3 writers** | 🔴 | 107 hidden literals | **L0–1** | HIGH |
| **Deployment** | 🟢 CI is good | 🟢 | Docker + PM2, unused | 🟢 **L2 — the highest** | HIGH |
| **Operations** | 🔴 **NOBODY** | — | 1 runbook, 4/9 missing | **L0** | HIGH |

## **Three domains do not exist. Nine have no owner. One reached Level 2.**

---

# PART 2 — DOMAIN MODEL

```
  External ──▶ Market Data ──▶ Feature Eng ──▶ Research ──▶ Validation ──▶ Probability
      ↓             ↓               ↓             ↓             ↓              ↓
      │             │               │             │             │              └── 🔴 uncalibrated.
      │             │               │             │             │                  AUC 0.685, p=0.191
      │             │               │             │             └── 🟢 FIXED (002). Was contaminated.
      │             │               │             └── 🔴 7 of 8 scripts still read the future
      │             │               └── 🔴🔴 NO FEATURE STORE. Inputs discarded on every inference.
      │             │                   ⇒ NOTHING downstream is reproducible. EVER. And it worsens daily.
      │             └── 🔴 `|| 0` × 119. Unknown becomes a number.
      └── 🟡 6 connectors, no port.

  ──▶ Risk ──▶ Portfolio ──▶ Decision ──▶ Execution ──▶ Monitoring ──▶ Audit
       ↓          ↓             ↓             ↓              ↓            ↓
       │          │             │             │              │            └── 🔴 0 lifecycle events
       │          │             │             │              └── 🔴 the bot died; nothing noticed
       │          │             │             └── 🟢 7/7 placeOrder sites guarded. PAPER HOLDS.
       │          │             └── 🔴 DOES NOT EXIST. And §0 of 020 shows it would BLOCK all 8 engines.
       │          └── 🔴 DOES NOT EXIST
       └── 🔴 DOES NOT EXIST
```

## **Four of twelve domains in the value chain do not exist. The one that fully works is the one that stops real money.**

---

# PART 3 — OWNERSHIP MATRIX

| Domain | Owner | Verdict |
|---|---|---|
| **Capital** | **3 modules, 6 write sites** | 🔴 **MULTIPLE** — and a config file can write it |
| **Orders** | **8 sites, 6 modules** | 🔴 **MULTIPLE, no chokepoint** |
| **Positions** | **8 independent stores** | 🔴 **FRAGMENTED** |
| **Risk** | — | 🔴 **MISSING** |
| **Configuration** | **3 writers, 107 hidden literals** | 🔴 **CONTESTED** |
| **Research** | — | 🔴 **MISSING** |
| **AI** | `confluence-learner` | 🟡 **SINGLE — untested, unvalidated** |
| **Monitoring** | — | 🔴 **MISSING** |
| **Security** | — | 🔴 **MISSING** |
| **Deployment** | — | 🔴 **MISSING — and it cost `INC-001`** |
| **Pricing model (`r`)** | — | 🔴 **MISSING — two `bsGamma`s, swapped parameters** |
| 🟢 **Storage** | **`safe-write.js`** | 🟢 **SINGLE** |
| 🟢 **Charges** | **`charges.js`** | 🟢 **SINGLE** |
| 🟢 **Instruments** | **`instrument-registry.js`** | 🟢 **SINGLE** *(bypassed 8× in `server.js`)* |

## ## **Three owners. Eight missing. Three contested.**
## **Everything that decides how much money moves, and at what price, is in the missing or contested columns.**

---

# PART 4 — COUPLING ANALYSIS

| Property | Measured | Risk |
|---|---|---|
| 🟢 **Dependency cycles** | **ZERO** *(001-B — the 3 apparent cycles were `require()` inside comments)* | 🟢 **Decomposition is structurally POSSIBLE** |
| 🟢 **Shared kernel** | `safe-write` Ca=17 · `charges` Ca=12 · `instrument-registry` Ca=10 — **all I = 0.00** | 🟢 **Textbook stable abstractions** |
| 🔴 **Apex coupling** | **`server.js`: Ce = 61, 7,328 LOC, 172 routes, 0 Routers** | 🔴 **CRITICAL** |
| 🔴 **Global mutable state** | **62 top-level `let`/`var` in `server.js`** | 🔴 **CRITICAL** |
| 🔴 **Hidden dependencies** | **Boot order was load-bearing** (fixed 2026-07-10; the shape remains) · `new Date()` inside domain logic | 🔴 HIGH |
| 🔴 **Module isolation** | **`pine-converter.js` and `amibroker-bridge.js` reference `req`/`res`** — domain depends on transport | 🔴 HIGH |
| 🔴 **Missing middle** | **Nothing between a stable kernel (I=0.00) and an unstable apex (I=1.00)** | 🔴 **This IS the missing Application layer** |

> 🟢 **The most important architectural fact in this document: ZERO dependency cycles.**
> **Every refactor proposed across thirty-two audits is mechanically possible.**

---

# PART 5 — TECHNICAL DEBT REGISTER

| Debt | Severity | Operational impact | Scientific impact | Priority |
|---|---|---|---|---|
| **The halt is not persisted (S-01) + not re-evaluated (S-02) + `setAutoEnabled` overrides it (B-3)** | 🔴 **CRITICAL** | **NIFTY boots at 15/8, unhalted, trading. Blocks the restart, the perf baseline, and every supervisor** | — | **P0** |
| **`server.js` monolith** | 🔴 **CRITICAL** | 7,328 LOC · 62 globals · 0 Routers · testability 1/10 | — | **P0** |
| **`lotSize: 65` hardcoded 8× in `server.js`** | 🔴 **CRITICAL** | Every size/charge/P&L right only by coincidence | **Every backtest mis-sized** | **P0** |
| **No feature store — inputs discarded** | 🔴 **CRITICAL** | — | 🔴 **NO inference is EVER reproducible. Worsens daily. THE ONLY IRREVERSIBLE DEBT** | **P0** |
| **Look-ahead in 7 of 8 strategy scripts** | 🔴 **CRITICAL** | — | 🔴 **Both edge claims invalid** | **P0** |
| **`charges.js` charges STT on the wrong side of every short** | 🔴 **CRITICAL** | Live paper P&L wrong | 🔴 **≈₹20,333 understated across 129 trades** | **P0** |
| **Two `bsGamma` — different `r`, swapped params** | 🔴 **CRITICAL** | Silent wrong numbers, no error | 🔴 GEX unreliable | **P0** |
| **No supervisor in production** | 🔴 **CRITICAL** | 🔴 **`INC-001`: MTTR = ∞** | 🔴 **A session of forward-test evidence lost forever** | **P0** |
| **92 empty catches** | 🔴 HIGH | A failure is indistinguishable from a success | — | **P1** |
| **14 timers, 0 `clearInterval`** | 🔴 HIGH | The EOD snapshot is a read taken mid-write | — | **P1** |
| **Capital: 9.8× over-allocated; margin never modelled** | 🔴 HIGH | Orders would be margin-rejected in live | 🔴 **Every backtest position could never have been funded** | **P1** |
| **`fii` and `volume` vote with n = 0** | 🔴 HIGH | — | 🔴 **Fabricated confidence, permanent by renormalisation** | **P1** |
| **107 hidden config literals; no validation** | 🔴 HIGH | Boots with no config at all | — | **P1** |
| **0 of 172 routes authenticated; `'antigravity'` hardcoded** | 🔴 HIGH | Anyone on the LAN can clear a halt | — | **P1** |
| **Duplicate logic: Kelly ×4 · GEX ×3 · `maxDD` ×8 · PF ×4** | 🟡 MEDIUM | Divergent numbers | 🔴 **`maxDD` means two different things** | **P2** |
| **Zero ADRs** | 🟡 MEDIUM | **Nobody knows why `CAPITAL_TOTAL` is a config key** | — | **P2** |
| **Four Node versions, none pinned** | 🟡 MEDIUM | Build reproducibility UNKNOWN | — | **P2** |

## 🔴 The one debt that is **irreversible**

> **Every item above can be fixed tomorrow with the same effort as today — except one.**
>
> ## **The feature store. Every inference computes its inputs, uses them, and throws them away.**
> **Without them, no model can ever be validated, no confidence calibrated, no inference reproduced —
> not at 21 outcomes, not at 200, not at ten thousand.**
>
> **Every day it is not built, another day of the only honest evidence this platform generates is
> permanently destroyed.**

---

# PART 6 — ARCHITECTURAL PRINCIPLES

| Principle | Adherence | Evidence |
|---|---|---|
| **Single Responsibility** | 🔴 **2/10** | `server.js` = API + application + domain + scheduler + persistence |
| **Single Source of Truth** | 🟡 **6/10** | 🟢 `charges`, `safe-write`, `instrument-registry` · 🔴 Kelly ×4, GEX ×3, `maxDD` ×8, capital ×3 |
| **Explicit Ownership** | 🔴 **2/10** | 8 domains have no owner |
| **Fail Closed** | 🟡 **SPLIT — and this is the deepest finding** | See below |
| **Unknown ≠ Zero** | 🟡 **SPLIT** | See below |
| **null ≠ Zero** | 🟡 **SPLIT** | See below |
| **Deterministic Startup** | 🟢 **9/10** | **024 §0 predicted the next boot exactly from files alone** — 🔴 **and it deterministically produces an unsafe state** |
| **Evidence Before Decisions** | 🔴 **1/10** | **020 §0: all 8 engines would be BLOCKED by the platform's own evidence gate. All 8 are running** |
| **Behaviour Preservation** | 🟢 **10/10** | **32 audits. 48/48 suites green throughout. Zero production code changed** |

## 🔴 **THE SPLIT — the deepest structural finding of the programme**

| Where the platform touches **MONEY** — 🟢 **it fails closed** | Where it touches **EVIDENCE** — 🔴 **it fails open** |
|---|---|
| Corrupt equity → **HALTS.** *"Cannot know the loss streak"* | An unknown market value → **becomes `0`.** 119 sites |
| Unknown instrument → `lotSize()` returns `null` → **refuse** | A factor observed **zero** times → **weight 10.08** |
| `TRADE_MODE` **never persists to live** | An uncalibrated score → **published as `prob: 76`** |
| 7 of 7 `placeOrder` sites **guarded** | A strategy with no backtest → **enabled by a JSON boolean** |
| Expired token in live mode → **entry refused** | *"backtest-grounded"* reliability → **no such backtest exists** |
| `agents-engine:458`: *"cannot know what is open… Reconcile by hand"* | A halt → **evaporates at the next restart** |

> ## **The same authors. The same codebase. The opposite instinct — and only one of the two was ever written down as a rule.**
>
> **`engine-verdict.js` IS that rule, applied to evidence. It is correct. It has 114 assertions. It has
> one adopter.**

---

# PART 7 — EVOLUTION GOVERNANCE

| Aspect | Verdict |
|---|---|
| **Modularization strategy** | 🔴 **NONE.** 0 `express.Router()` |
| **Refactoring roadmap** | 🟢 **EXISTS — 003 §16, and every audit since.** 🔴 **Blocked on approval, not on engineering** |
| **Backward compatibility** | 🔴 **No schema version in any state file** — 🔴 **and it bites S-01: an absent `haltedReason` must mean UNKNOWN ⇒ BRAKE ON, not "not halted"** |
| **API evolution** | 🔴 **No versioning. A breaking change breaks all 19 pages** |
| **Schema evolution** | 🔴 **NONE** |
| **Version governance** | 🔴 **`package.json` says 2.0.0. Zero git tags. Zero releases** |

## 🟢 **Long-term sustainability: the single strongest asset**

> **Zero dependency cycles. A stable kernel at I = 0.00. 48 exit-code-gated test suites. A
> characterization-first discipline that caught its own author eight times, including one HIGH-severity
> claim published in four documents and then retracted.**
>
> **The platform is sustainable. It is not currently governed.**

---

# PART 8 — ARCHITECTURE OBSERVABILITY

| Required per architectural decision | Present? |
|---|---|
| **Decision ID** | 🔴 **NO — zero ADRs exist** |
| **Rationale** | 🟡 **In `docs/APPROVAL-*.md` (8 packages) and commit messages** |
| Date | 🟢 git |
| Owner | 🟡 |
| **Alternatives considered** | 🔴 **NO** |
| **Supporting evidence** | 🟢 **EXCELLENT — in the approval packages** |
| **Expected impact** | 🟢 **In the approval packages** |

## 🔴 **Zero ADRs. The three that must be written first:**

| ADR | The question nobody can answer |
|---|---|
| **ADR-001** | **Why is `CAPITAL_TOTAL` a configuration key?** A settings file overwrote the account balance at every boot until 2026-07-10. **Nobody knows why it was ever a setting** |
| **ADR-002** | **What is the risk-free rate `r`, and who owns it?** Two `bsGamma`s disagree, and take their arguments in a different order |
| **ADR-003** | **What is the halt invariant?** Five paths halt an engine. One setter undoes all five, and cannot see the halt |

> 🟢 **The protected-file approval workflow IS a decision log — for changes. It is excellent, and it held
> across all 32 audits. It simply was never extended to architecture.**

---

# PART 9 — FAILURE MODE REGISTER

| ID | Failure | Long-term impact |
|---|---|---|
| **EA-1** | 🔴 **Correct components are built and not adopted (§0 — ten instances)** | **The platform's engineering effort does not compound. It accumulates unused.** THE defining failure |
| **EA-2** | **`server.js` monolithic growth** | Every change is high-risk; nothing can be unit-tested |
| **EA-3** | **8 domains have no owner** | No account-level safety is possible |
| **EA-4** | **No ADRs** | **Decisions are unrecoverable. `CAPITAL_TOTAL` is the proof** |
| **EA-5** | **Fail-open on evidence** | **Confidence is fabricated where it is not measured** |
| **EA-6** | **No feature store** | 🔴 **Irreversible. The only debt that worsens daily** |
| **EA-7** | **Governance gap: nothing makes a correct component required** | **§0 will recur with every future component** |

---

# PART 10 & 11 — TARGET ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   GOVERNANCE BOARD  ★★★   THE ONLY NEW THING THIS PLATFORM ACTUALLY NEEDS.

     🔴 §0 IS NOT A CAPABILITY PROBLEM. IT IS AN ADOPTION PROBLEM.
        The platform builds correct components and never makes them mandatory.

     AdoptionRegistry:  every component declares its REQUIRED adopters.
       engine-verdict.js  → ALL 8 engines.        (today: 1)
       auth.js            → ALL mutating routes.  (today: 0)
       module-contract    → MOUNTED.              (today: 404)
       position-sizer     → ALL sizing paths.     (today: disabled)
       safe-write         → ALL writes.           (today: 10 bypass it)
       PM2 or compose     → PRODUCTION.           (today: node server.js)
     🔴 A COMPONENT WITH ZERO ADOPTERS IS A FAILING TEST, NOT A FEATURE.

   OwnershipRegistry  ★   Every domain names ONE owner. 8 are blank today.
   DecisionLog (ADR)  ★   ADR-001/002/003 first. Extend the approval workflow to architecture.
   TechnicalDebtRegister  ★  Part 5. Severity · operational impact · SCIENTIFIC impact.

   THE MISSING LAYER (003 §16, unchanged and still correct):
     API (routes/)  →  APPLICATION (EngineHost, Scheduler)  →  DOMAIN (AccountLedger ★,
     OrderManager ★, RiskEngine ★, Portfolio ★, quant/ ★)  →  INFRASTRUCTURE  →  PERSISTENCE
```

## The one rule this programme establishes

> **A correct component with no adopters is not an asset. It is unamortised effort, and it is
> indistinguishable — at runtime — from a component that was never written.**
>
> **Governance is the mechanism that converts the first into the second.**

---

# PART 12 — ARCHITECTURE MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Prototype** | 🟢 | — |
| **1 — Functional Application** | 🟢 **YES** | It trades (on paper), it persists, it reports. **48 suites green** |
| **2 — Modular System** | 🔴 **NO** | **0 `express.Router()`. 62 globals. `server.js` = 29% of the codebase at maintainability 16/100** |
| **3 — Governed Platform** | 🔴 **NO** | **§0: ten correct components, unadopted. 8 domains with no owner. Zero ADRs** |
| **4 — Enterprise Architecture** | 🔴 **NO** | — |
| **5 — Long-Term Sustainable** | 🔴 **NO** | — |

## ## **Enterprise Architecture: LEVEL 1 — FUNCTIONAL APPLICATION.**

**030's stop condition: *"Never infer architectural maturity from application size or feature count."***
**81 modules and 172 routes do not make a Level 2. Zero Routers and 62 globals make a Level 1.**

---

# PART 13 — EVOLUTION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE — 32 audits.** **§0 is the finding: adoption, not capability** | — | none | Every domain, debt and gap measured |
| **2 — Ownership** *(the unlock)* | 🔒 **APPROVE THE PROTECTED PACKAGE.** B-3 + **S-01** + **S-02** · B-4 (8 lot sites) · B-6 · `mountAll()` · the kill switch · `/api/risk` | **OWNER DECISION** | 🔴 **BEHAVIOUR CHANGE — and it is the entire point. NIFTY will HALT at boot** | 🔴 **This ONE package unblocks: the restart, the supervisor, the perf baseline, the deployment, and every operational improvement in audits 021–029** |
| **3 — Adoption** *(§0)* | **Adopt what already exists.** `engine-verdict` in 8 engines · `auth.js` on mutating routes · `position-sizer` enabled · PM2 in the runbook · the `.jsonl` writer on real events | Phase 2 | 🔴 **Every weight becomes 0 and the ensemble honestly returns `INSUFFICIENT_DATA`. CORRECT.** | **Zero components with zero adopters** |
| **4 — Debt reduction** | 🔴 **THE FEATURE STORE — TODAY** *(irreversible)*. Fix `charges.js` direction. Persist open positions. The 7 remaining look-aheads | Phase 3 | Approval per script | **Every inference reproducible. Every backtest leak-free** |
| **5 — Modularization** | `routes/` · `Scheduler` · `AccountLedger` (shadow, 2 weeks) · `OrderManager` (pass-through) · `RiskEngine` (read-only, 2 weeks) · `quant/` | **A route-response snapshot test for all 172 routes.** 🔴 **NON-NEGOTIABLE** | Medium | `server.js` < 2,000 LOC. One owner per domain |

---

# PART 14 — PRODUCTION READINESS

**030: *"Do not produce a single numeric score unless supported by documented criteria."*** ✅ **Complied — no composite score. Each dimension is judged against a documented gate.**

| Dimension | Verdict | Documented criterion |
|---|---|---|
| **Governance** | 🔴 **NOT READY** | §0: ten correct components unadopted. 8 domains ownerless. Zero ADRs |
| **Reliability** | 🔴 **NOT READY** | `INC-001`: MTTD = ∞, MTTR = ∞, zero incident records *(029)* |
| **Maintainability** | 🔴 **NOT READY** | `server.js`: 16/100, 29% of the codebase *(001-C)* |
| **Recoverability** | 🔴 **NOT READY** | The halt and open positions are lost on every restart. 14% backup coverage; **0 of 9 critical datasets backed up** *(025)* |
| **Security** | 🔴 **NOT READY** | 0 of 172 routes authenticated. `'antigravity'` is the live credential *(023)* |
| **Research integrity** | 🔴 **NOT READY** | 7 of 8 scripts read the future. The live structure was never backtested *(001-D, 007, 008)* |
| **Operational maturity** | 🔴 **NOT READY** | Level 0. The runbook documents the unsupervised start that caused `INC-001` *(029)* |
| 🟢 **Behaviour preservation** | 🟢 **READY** | **32 audits. 48/48 green throughout. Zero production code changed** |
| 🟢 **Paper/live isolation** | 🟢 **READY** | **7/7 `placeOrder` sites guarded. `TRADE_MODE` never persists to live** *(012)* |

## **Live-trading gate (001-E): 0 of 6 passed. UNCHANGED across 32 audits.**

---

# PART 15 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every critical domain has one owner | 🔴 **NO — 8 are blank** |
| Responsibilities are explicit | 🔴 **NO** |
| **Technical debt is measurable** | 🟢 **YES — for the first time. Part 5, every item cited to a measurement** |
| Architectural decisions are documented | 🔴 **NO — zero ADRs** |
| Evolution is planned rather than reactive | 🟢 **YES — 32 audits, one roadmap, blocked on one approval** |
| **Scientific integrity is preserved** | 🟡 **The INTEGRITY of the audit: yes — every claim measured, eight self-corrections published. The integrity of the RESEARCH: no — 7 of 8 scripts still read the future** |
| Governance is reproducible | 🟢 **YES — every finding in 32 documents is reproducible from a command** |

## **3 of 7.**

---

# EXECUTIVE SUMMARY — AND THE CONCLUSION OF THE AUDIT PROGRAMME

**Thirty-two audits. Zero lines of production code changed. Forty-eight test suites green throughout.**

**The mission of 030: could an independent enterprise architect understand the system, identify
ownership, evaluate debt, assess maturity, and determine a sustainable evolution path?**

## **Yes. And the answer is not the one thirty-one audits were looking for.**

**Every audit began by hunting for missing components. Ten times, it found the opposite:**

> ## **`engine-verdict.js` — correct, 114 assertions — 1 adopter of 8.**
> ## **`module-contract.js` — 11 surfaces, tested — every route 404.**
> ## **`bt-validate.js` — purged k-fold, PSR, DSR — 0 strategy callers.**
> ## **`position-sizer.js` — margin-aware, calls the alternative *"fantasy"* — imported and disabled.**
> ## **`auth.js` — HMAC, `timingSafeEqual`, RBAC — 0 of 172 routes.**
> ## **The append-only `.jsonl` writer — immutable, correct — pointed at migrations and news.**
> ## **`scripts/perf-report.js` — refuses to guess, reports UNKNOWN — never run.**
> ## **PM2 and Docker Compose — both configured to auto-restart — neither running.**
> ## **And the operations playbook's own golden rule — *"never trust a single backtest"* — violated by the ₹7 lakh position it was written to prevent.**

**Ten correct components. Zero-to-partial adoption.**

> ## **THIS PLATFORM'S PROBLEM IS NOT THAT IT LACKS THE RIGHT COMPONENTS. IT IS THAT IT BUILDS THEM — CORRECTLY, THOUGHTFULLY, WITH TESTS — AND THEN LEAVES THEM SWITCHED OFF.**
>
> **There is no mechanism by which a correct component becomes a *required* one. That mechanism has a
> name — governance — and it is the only thing this architecture is actually missing.**

**And beneath it, the structural split that explains everything:**

> **Where this platform touches MONEY, it fails closed — beautifully. A corrupt ledger halts the engine.
> An unknown instrument refuses to size. Seven of seven order paths are guarded. `TRADE_MODE` never
> persists to live. `agents-engine` writes: *"The engine cannot know what is open. Saving disabled.
> Reconcile by hand."***
>
> **Where it touches EVIDENCE, it fails open — every time. A factor observed zero times carries a weight
> of 10.08. A score never checked against reality is published as `prob: 76`. A strategy whose structure
> was never backtested runs on ₹7 lakh. An unknown market value becomes zero, one hundred and nineteen
> times.**
>
> **Same authors. Same codebase. Opposite instinct. And only one of the two was ever written down as a
> rule.**

**What is genuinely, permanently valuable — and it is more than most platforms have:**

- **Zero dependency cycles.** Every refactor proposed in thirty-two audits is mechanically possible.
- **A stable kernel at `I = 0.00`** — `safe-write` (Ca=17), `charges` (Ca=12), `instrument-registry` (Ca=10). **Adopted, and correct.**
- **48 exit-code-gated suites and a characterization-first discipline** that **invalidated its own flagship result, then invalidated its own recommended fix, then caught its own author eight more times** — including one HIGH-severity claim published across four documents and publicly retracted.
- **A protected-file approval workflow that held across all thirty-two audits without a single violation.**

**The evolution path is one decision long:**

> ## **ONE approval package — B-3 + S-01 + S-02, B-4, B-6, `mountAll()`, the kill switch, `/api/risk` — under thirty lines of code — unblocks the restart, the supervisor, the performance baseline, the deployment, and every operational improvement across audits 021 to 029.**
>
> ## **Then adopt what already exists.**
>
> ## **Then build the feature store — today — because it is the only debt in this entire register that gets permanently worse every day it is not fixed.**

**And the platform's own author already wrote the closing line of this report, in the operations
playbook, before any of it began:**

> *"Never trust a single backtest — the edge is cost-control + regime-timing + risk-management, proven
> by forward-test, not a fancier signal."*

**They were right. What they lacked was any tooling capable of enforcing it — and, until 002, the very
harness they recommended for re-validation carried the same look-ahead bias as everything else.**

**That is now fixed. Everything else is waiting on a decision.**

---

**Application redesigned: NONE. Modules rewritten: NONE. Production code modified: NONE.
Suite: 48/48.**

**Deliverables:** Architecture Inventory (Part 1) · Domain Model (Part 2) · Ownership Matrix (Part 3) ·
Coupling Analysis (Part 4) · Technical Debt Register (Part 5) · Principles Assessment (Part 6) ·
Evolution Governance (Part 7) · Architecture Observability (Part 8) · Failure Modes (Part 9) · Target
Architecture (Parts 10–11) · Maturity Assessment (Part 12) · Evolution Roadmap (Part 13) · Production
Readiness (Part 14) · Executive Summary.
