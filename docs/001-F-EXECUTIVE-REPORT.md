# 001-F — EXECUTIVE REPOSITORY ASSESSMENT & MASTER REPORT

**Standard:** Master Prompt 001-F · **Version 2.0 — supersedes v1.0 of the same date**
**Date:** 2026-07-12 · **HEAD:** `7823864` (committed, **not pushed**) · **Suite:** 47/47 green
**Audience:** Project Owner · CTO · Principal Engineers · Quant Research Lead · Future Maintainers

**Evidence base — every conclusion below cites one of these. NO NEW FINDINGS ARE INTRODUCED.**

| Audit | Document |
|---|---|
| 001-A Repository Discovery | `docs/ARCHITECTURE-AUDIT-2026-07-10.md`, `docs/EVOLUTION-2026-07-10.md` §5 |
| **001-B** Architecture & Dependency | **`docs/001-B-ARCHITECTURE-HANDBOOK.md`** |
| **001-C** Code Quality & Technical Debt | **`docs/001-C-CODE-QUALITY-AUDIT.md`** |
| **001-D** Research Integrity | **`docs/001-D-RESEARCH-INTEGRITY-AUDIT.md`** |
| **001-E** Production & Operations | **`docs/001-E-PRODUCTION-AUDIT.md`** |
| Evidence | `docs/REVIEW-selling-edge-invalidated.md` · `docs/REVIEW-bt-real-lookahead.md` · `docs/EVIDENCE-F4-oi-unit.md` |

> **Note on v1.0.** An earlier 001-F was written *before* audits 001-B/C/D completed. It is superseded.
> Three of its statements were later contradicted by measurement and are corrected in §15.

---

# SECTION 1 — EXECUTIVE SUMMARY

**ANTIGRAVITY PRO** is a 100% paper-trading Indian index-options research platform (Node/Express,
single process, local-only). No live order path is reachable: `TRADE_MODE=paper` renders the
`placeOrder` guard at `execution-engine.js:519` unreachable *(001-E §1)*.

### Current status, in one paragraph

The platform has **institutional-grade engineering discipline applied to research that is
scientifically invalid.** Every strategy backtest — and, decisively, **the validation harness built to
catch exactly this** — chooses which option to trade using a price that will not exist for another six
and a half hours *(001-D §3, R-01/R-02)*. The two edge claims that justify the entire product are
therefore artefacts: the short-strangle edge collapses from **PF 7.41 to PF 0.55** once the future is
removed, and the directional edge was already dead at PF 0.94 *(REVIEW-selling-edge-invalidated.md)*.
Underneath that sits a **7,328-line file that is simultaneously the API, the application layer, the
domain and the scheduler**, in which **capital is written by three modules, orders by six, risk by
none, and the option-pricing model by nobody at all** *(001-B §4)*.

### Strengths *(preserve these — §4)*

A genuinely stable shared kernel (`safe-write` Ca=17, `charges` Ca=12, `instrument-registry` Ca=10,
all instability **I = 0.00**, **zero dependency cycles**); **47 exit-code-gated test suites** with a
characterization-first discipline; and a review culture that **invalidated its own flagship result,
then invalidated its own recommended fix.**

### Weaknesses

God object · no ownership of capital/orders/risk/pricing · 92 empty catches · 14 timers with zero
cleanup · observability built and unmounted · **no feedback loop from research to production** — which
is precisely how a look-ahead survived into a shipped, celebrated backtest.

### Critical blockers — **six** *(§5)*

Five are ≤ 11 lines of code. **Four sit in protected files and are blocked on owner approval, not on
engineering.**

### Recommended direction

> **Do not build a feature. Do not run a validation. Clean the validator first, then the strategies,
> then ask what the numbers say. Any other order manufactures confidence.** *(001-D §13)*

---

# SECTION 2 — PROJECT HEALTH DASHBOARD

| # | Dimension | Score | Confidence | Evidence & key finding |
|---|---|---|---|---|
| 1 | **Platform Stability** | **55** | HIGH | Runs continuously in paper mode. But: **14 `setInterval` / 0 `clearInterval`**; the EOD snapshot is taken while 14 writers still run *(001-B §10)* |
| 2 | **Code Quality** | **38** | HIGH | Weighted maintainability. **`server.js` = 16/100 and is 29% of the codebase. The other 80 files average 74** *(001-C §12)* |
| 3 | **Architecture** | **37** | HIGH | Clean-architecture score **44/120**. Kernel excellent (I=0.00, 0 cycles); **the application layer does not exist** *(001-B §3, §15)* |
| 4 | **Documentation** | **60** | HIGH | 73/81 files have module headers; comment ratio 20.5%. **But: no ADRs, no `@owner` notes, and the 3 riskiest files average 7% comments** *(001-C §11)* |
| 5 | **Test Quality** | **80** | HIGH | **47 suites, exit-code gated, every fix characterized RED first.** Held back only by the monolith: **no route can be tested** *(001-C §8)* |
| 6 | **Research Integrity** | **5** | HIGH | 🔴 **Look-ahead in 8/8 strategy scripts AND in `bt-validate.js` itself** *(001-D §3, R-01)* |
| 7 | **Backtesting Reliability** | **10** | HIGH | Data is authoritative (600 exchange days, ~1.08M strike-days) and every script is reproducible. **The results are reproducibly wrong** *(001-D §15)* |
| 8 | **Paper Trading Readiness** | **35** | HIGH | Bot runs; capital fix verified live (₹88,011). **But: 58 labelled outcomes across 5 incompatible ledgers; the canonical file holds 12** *(001-D §9, R-09)* |
| 9 | **Risk Engine** | **10** | HIGH | 🔴 **Does not exist.** `grep -rlE "totalExposure\|portfolioRisk\|netDelta"` → **nothing**. Per-engine brakes only *(001-B §4)* |
| 10 | **Operational Readiness** | **20** | HIGH | No alerting, no audit trail, no position reconciliation, no DR procedure *(001-E §4, §5)* |
| 11 | **Security** | **30** | HIGH | **Better than expected** — command-injection, path-traversal, CORS and hardcoded-secret checks all **CLEARED**. **One real vulnerability:** `.env` rewritten non-atomically from an HTTP handler *(001-C §10)* |
| 12 | **Observability** | **10** | HIGH | 🔴 **Built and unmounted.** `module-contract.js` → 11 surfaces, 114 assertions, **0 routes reachable**. `/healthz` reports uptime only — **it cannot fail** *(001-E §3)* |
| 13 | **Data Quality** | **75** | HIGH | 600 authoritative exchange days; `oi_unit` **MEASURED** for 5 NSE symbols. **Unknowns: BSE `oi_unit`, broker-chain OI unit** *(001-D §2)* |
| 14 | **AI Readiness** | **5** | HIGH | 🔴 **BLOCKED.** Every `reliability` is null ⇒ every weight is 0 ⇒ **the ensemble is the empty sum** *(001-D §10)* |
| 15 | **Production Readiness** | **34** | HIGH | **27/80.** Live-trading gate: **0 of 6 passed** *(001-E §0)* |

### **Composite: 33 / 100**

> **Two numbers explain the whole dashboard: Test Quality 80, Research Integrity 5.**
> This project builds correctly. **It has been building the wrong thing correctly.**

---

# SECTION 3 — MATURITY MODEL

| Domain | Level | Evidence |
|---|---|---|
| **Engineering** | **Level 4 — Managed** | Characterization-first, 47 gated suites, approval packages, rollback per change. **The strongest domain by a wide margin** *(001-C §14)* |
| **Research** | **Level 1–2 — Prototype / invalidly Backtested** | **Zero strategies at Level 3 (Statistically Validated). Zero at Level 4** *(001-D §11)* |
| **Operations** | **Level 1 — Ad-hoc** | No alerting, no monitoring, no runbook, no DR *(001-E §4)* |
| **Testing** | **Level 4 — Managed** | 47 suites; **but 0 route tests, and `server.js` testability is 1/10** *(001-C §8)* |
| **Documentation** | **Level 3 — Defined** | 90% module-header coverage, extensive `docs/`. **No ADRs ⇒ decisions are unrecoverable** *(001-C §11)* |
| **Security** | **Level 2 — Repeatable** | Secrets git-ignored and redacted; auth exists but **defaults OFF, and 0 of 172 routes declare it** *(001-C §10)* |
| **AI** | **Level 0 — Idea** | Contract written (`engine-verdict.js`), **one adopter**, zero measured reliabilities *(001-D §10)* |
| **Production (000-E scale)** | **Level 3 — Paper Trading** | Claimed elsewhere: "production-grade". **It is not** *(001-E §0)* |

---

# SECTION 4 — STRENGTHS *(preserve — do not refactor these)*

| Strength | Evidence | Why it must be preserved |
|---|---|---|
| **The shared kernel** | `safe-write.js` **Ca=17**, `charges.js` **Ca=12**, `instrument-registry.js` **Ca=10** — all **I = 0.00**, zero local dependencies *(001-B §5.1)* | **This is a textbook stable-abstraction layer.** Most codebases this age do not have one. It is the foundation everything else can be rebuilt on |
| **Zero dependency cycles** | Measured; the 3 apparent cycles were `require()`s inside **comments** *(001-B §3)* | The dependency graph is genuinely acyclic — decomposition is *possible* |
| **`safe-write.js` — fail-closed with TESTED restore** | temp → validate-by-reparse → rename → `.bak`. Corrupt-file recovery is asserted in 3 suites *(001-E §5)* | **000-E: "backups are not valid until restore has been tested."** This gate is genuinely met — one of very few |
| **`instrument-registry.js`** | Broker-verified, fail-closed, 41% comments, maintainability **96/100** *(001-C §12)* | It already caught a real defect: **NIFTY/SENSEX expiry weekdays were swapped** |
| **47 exit-code-gated suites; characterization-first** | Every fix proven RED before being written *(001-C §8)* | **This discipline is what found everything in these audits.** It is the single hardest asset to buy |
| **The data** | 600 days of the exchange's own UDiFF bhavcopy — **~1.08 million strike-days** *(001-D §2)* | Authoritative, reproducible, already on disk |
| **`bt-validate.js`'s mathematics** | purged k-fold, walk-forward, PSR, DSR — **the statistics are sound**; only its strategy function leaks *(001-D §1)* | **Do not rewrite it. Fix its one contaminated function** |
| **`gamma-blast-engine.js`** | Explicitly declares itself **not backtestable**; forward-test only *(001-D §5)* | 🟢 **The only strategy whose evidence claim matches its evidence.** It is the template for honesty |
| **A culture that kills its own results** | The process invalidated the flagship backtest, **then invalidated its own recommended fix** *(001-D §14)* | **This is the reason any number in this report can be trusted** |

---

# SECTION 5 — CRITICAL BLOCKER REGISTER

| # | Blocker | Evidence | Impact | Depends on | Sev | Sequence |
|---|---|---|---|---|---|---|
| **B-1** | **`bt-validate.js` carries the look-ahead it exists to detect** | `bt-validate.js:152, 172, 173` *(001-D R-01)* | **Running it would manufacture statistical confidence in a leaky result.** Blocks ALL validation | Nothing — **it is a tool, not a shipped strategy. Fixing it changes no published result** | 🔴 CRITICAL | **1st — start here** |
| **B-2** | **Look-ahead in all 8 strategy scripts** | `bt-lib.js:22/46` + every script, lines cited *(001-D §3)* | **Both edge claims are artefacts.** PF 7.41 → 0.55 | **B-1** (fix the validator first) | 🔴 CRITICAL | 2nd — **behaviour change, needs approval** |
| **B-3** | **`setAutoEnabled(true)` re-enables a HALTED engine at boot** | `afternoon-engine.js:826`; `server.js:7278`; **0 refs to `_haltedReason`** *(001-C §7)* | **A live fail-open.** 000-E names this exact alert: *"Trading unexpectedly enabled"* | **OWNER APPROVAL** (protected) | 🔴 CRITICAL | **Package written — awaiting decision** |
| **B-4** | **`lotSize: 65` hardcoded ×3 in `server.js`** while a fail-closed broker-verified registry exists | `server.js:260, 3290, 3483` *(001-C D-01)* | Every size / charge / P&L through these paths is right **only by coincidence, and only today**. The lot has been 25/50/65/75 | **OWNER APPROVAL** (protected) | 🔴 CRITICAL | **Package needed** |
| **B-5** | **Nobody owns the option-pricing model.** Two `bsGamma`s: `r=0` vs `r=0.065`, **and the 3rd/4th parameters are swapped** | `vol-context.js:42` / `gex-skew.js:18` *(001-B A-02)* | Two GEX numbers on one dashboard. **A copied call site silently exchanges σ and T and returns a plausible wrong number with no error** | Nobody owns `r` | 🔴 CRITICAL | 3rd |
| **B-6** | **`.env` rewritten non-atomically from an HTTP handler** | `server.js:2028` *(001-C §10)* | An interrupted write truncates `.env` ⇒ **every broker credential lost at next boot** | **OWNER APPROVAL** (protected) | 🔴 HIGH | **Package needed** |

> **Four of six blockers sit in protected files. The platform's safety, correctness and observability
> posture is, at this moment, blocked on owner approval — not on engineering.**

---

# SECTION 6 — CONSOLIDATED RISK REGISTER

## 🔴 CONFIRMED — Critical

| ID | Risk | Source |
|---|---|---|
| R-01 | `bt-validate.js` is contaminated | 001-D |
| R-02 | Look-ahead in 8/8 strategy scripts | 001-D |
| R-03 | `bt-real.js` has a **second** look-ahead (EOD-OI filter) | 001-D |
| R-04 | `bt-real.js` models **no** brokerage / STT / exchange charges | 001-D |
| A-01 / B-3 | Halted engine re-enabled at boot | 001-B, 001-C |
| A-02 / B-5 | Two `bsGamma`s — different `r`, **swapped parameters** | 001-B |
| D-01 / B-4 | `lotSize: 65` hardcoded ×3 in `server.js` | 001-C |
| A-03 | Capital: 6 write sites, 3 owners, **0 ledgers** | 001-B |
| D-05 | `server.js` god object — 7,328 LOC, 172 routes, 62 globals, 0 Routers | 001-C |

## 🟠 CONFIRMED — High

| ID | Risk | Source |
|---|---|---|
| A-04 | Shutdown race — 14 timers, 0 `clearInterval`; **the EOD snapshot is read mid-write** | 001-B |
| A-05 | `openPosition` authority race — timer tick and HTTP handler write the same slot | 001-B |
| A-06 / B-6 | `.env` non-atomic write from an HTTP path | 001-C |
| A-07 / D-06 | **92 empty catches** — 57 in `server.js`, **4 inside `safe-write.js` itself** | 001-C |
| R-10 | *"backtest-grounded"* reliability shipping with **no backtest** (`candlestick-patterns.js:344`) | 001-D |
| R-05 | `sizeLots` silently defaults to `LOT = 75` — **wrong on 59.3% of days.** The fix exists and is unused | 001-D |
| R-06 | **9 free parameters, zero justification** (`bt-real.js:9-10`) | 001-D |
| R-07 | 129 trades, no CI, no bootstrap — on an **unbounded-loss structure** | 001-D |
| R-09 | 58 outcomes across **5 incompatible ledgers**; canonical file holds **12** | 001-D |
| D-13 | **Speculative generality** — `module-contract` (0 routes), `engine-verdict` (1 adopter), `bt-validate` (0 strategy callers). **The three best modules do nothing** | 001-C |

## 🟡 CONFIRMED — Medium

A-08 (10 unvalidated `JSON.parse`) · A-09 (**0 of 172 routes carry auth**; default posture ALLOW) ·
A-10 (20 sync IO in the request path) · A-11 (**no research→production feedback loop**) ·
A-12 / D-09 (Kelly ×4) · D-10 (`/api/nifty` ≈ `/api/sensex`, 139L/136L) ·
R-08 (**`maxDD` means a fraction in one script and points in another**) · R-11 (`vrp-monitor.json` is **empty**) ·
D-14 (no structured logging) · D-16 (**no performance baseline ⇒ every perf claim is unfalsifiable**) ·
D-19 (**no ADRs — nobody knows why `CAPITAL_TOTAL` is a config key**)

## ⚪ SUSPECTED — requires measurement, **not yet a claim**

| ID | Suspicion | Measurement that would settle it |
|---|---|---|
| — | Which of the **92 empty catches** swallow a *state mutation*? | Scan for `catch {}` whose `try` contains `this.* =` or `writeFileSync`. **1–2 hours** *(001-C stop condition)* |
| — | Does `gatherMasterSignal` recompute or cache across routes? | A call counter for one session |

## ❓ UNKNOWN — **evidence does not exist. Do not guess.**

| ID | Unknown | Why it cannot be inferred |
|---|---|---|
| **A-13** | **Broker chain `oi_unit`** | `gex-skew.js:32` says "contracts"; **F4 proved bhavcopy OI is UNITS**. **If the live chain reports units, every GEX on the dashboard is wrong by 65–75×.** *One row of comparison settles it* |
| **E1** | **STT / exchange-charge rates** | Two rates are believed wrong **in opposite directions**, cancelling to ≈ −0.33% — **so the total looks right.** Needs the exchange circular |
| **F4-BSE** | **BSE `oi_unit`** | The F4 proof is NSE-only (5 symbols). BSE file format differs |
| **M2** | Is there a volatility risk premium in Indian index options? | **No clean backtest exists. No literature was consulted.** The finding is that *the platform's evidence is invalid* — **not that the edge is absent** |
| — | Sharpe annualisation | `backtest-report.js:90` uses `× √tradesPerYear`, an **input, not a measurement** |

---

# SECTION 7 — TECHNICAL DEBT SUMMARY

*Ranked. No implementation prescribed.*

| Rank | Debt | Business impact | Effort | Risk if ignored | Priority |
|---|---|---|---|---|---|
| 1 | **Contaminated validator + 8 leaky strategies** | **The product has no validated edge** | Days | Every future result is fiction | **P0** |
| 2 | **No owner: capital / orders / risk / pricing** | **No account-level safety is possible** | Weeks | The boot order decided the balance until 2026-07-10 | **P0** |
| 3 | **`lotSize: 65` ×3 in `server.js`** | Sizing, charges and P&L wrong whenever the lot changes | Hours | The exact defect just fixed in `bt-lib`, still live | **P0** |
| 4 | **Halt fail-open at boot** | The risk brake is undone by a restart | Hours | 000-E's *"Trading unexpectedly enabled"* | **P0** |
| 5 | **`server.js` god object** | Every change is high-risk; **nothing can be unit-tested** | Weeks | Compounding | **P1** |
| 6 | **14 timers / 0 cleanup** | Persisted EOD state may not be the state measured | Hours | Silent corruption | **P1** |
| 7 | **92 empty catches** | **A failure is indistinguishable from a success** — the fault class behind every fail-open found | Days | More fail-opens | **P1** |
| 8 | **10 raw production writes / 10 unvalidated reads** | Corruption | Hours | — | **P1 — 7 packages already written** |
| 9 | **Observability built and unmounted** | **Unknown operational state** (000-E: unacceptable) | **1 line** | — | **P1** |
| 10 | **9 unjustified constants in `bt-real.js`** | **Enough knobs to fit noise** | Days | Unfalsifiable overfitting | P2 |
| 11 | Kelly ×4 · GEX ×3 · `maxDD` ×8 · PF ×4 | Divergent numbers, no single truth | Days | — | P2 |
| 12 | No structured logging · no ADRs · no perf baseline | Not operable; decisions unrecoverable; perf claims unfalsifiable | Days | — | P2 |
| 13 | Dead code (4 modules, Ca=0) · 31 hardcoded URLs | Noise | Minutes | — | P3 |

---

# SECTION 8 — STRATEGIC PRIORITY MATRIX

### Immediate (0–30 days)

| Objective | Depends on | Expected outcome | Evidence |
|---|---|---|---|
| **Fix the look-ahead in `bt-validate.js`** | — | A validator that can be trusted. **Changes no shipped result** | 001-D R-01 |
| **Approve & apply B-3, B-4, B-6, and `mountAll()`** | **OWNER** | Live fail-open closed · lot from the registry · credentials safe · health/metrics reachable. **≈ 15 lines total** | 001-B, 001-C, 001-E |
| **Fix the look-ahead in the 8 strategy scripts, one at a time** | B-1, **approval** | **The honest answer to "does this platform have an edge?"** | 001-D §13 |
| **Remove or evidence `candlestick-patterns.js:344`** | — | No unmeasured claim in a live scoring path | 001-D R-10 |
| **Measure A-13** — one live chain row vs one bhavcopy row | — | Settles whether GEX is wrong by 65× | 001-B A-13 |
| **Start the VRP monitor recording** | — | The one instrument that tests the core hypothesis. **It is empty** | 001-D R-11 |

### Short term (1–3 months)

Run every strategy through the **now-clean** validator (walk-forward, purged k-fold, PSR, DSR) ·
**Bootstrap + Monte Carlo the strangle — the tail is the whole question for a naked short** ·
Unify the 5 outcome ledgers into one schema · **Capture intraday chains daily** (1 session exists;
every day of delay is permanently lost) · `clearInterval` on all 14 timers · structured logging.

**Exit criterion: a validated edge, or an honest retirement. Both are acceptable outcomes.**

### Medium term (3–6 months) — *conditional on a validated edge*

`EventBus` (additive, zero behaviour change) → `Scheduler` → `routes/` extraction → `quant/` kernel
(one `bsGamma`, one `r`, one Kelly, guarded by an equivalence test) *(001-B §16 steps 1–4)*.

### Long term (6–12 months) — *conditional*

`AccountLedger` (read-only shadow first, assert agreement for 2 weeks) → `OrderManager` (pass-through
only) → `RiskEngine` (**read-only at `/api/risk` for 2 weeks before it may block anything**)
*(001-B §16 steps 5–7)*. Daily NAV series → Sharpe, drawdown, all portfolio metrics become derivable.

### Future (12–24 months)

**UNKNOWN.** A 24-month roadmap for a platform whose edge was invalidated is fiction. **It will be
written when there is something to project.** *(EVOLUTION-2026-07-10 §6)*

---

# SECTION 9 — PHASED ROADMAP

| Phase | Goals | Exit criteria | Blocking risks | Success metrics |
|---|---|---|---|---|
| **1 — Repository Stabilization** | Close the 4 protected blockers (B-3, B-4, B-6, `mountAll`); `clearInterval`; route the 10 raw writes through `safe-write` | Suite green · `/api/m/health` returns 200 · a halted engine **stays halted** across a restart · lot comes from the registry | **OWNER APPROVAL** (4 protected files) | 0 live fail-opens · observability 1/10 → 6/10 · 0 raw production writes |
| **2 — Research Integrity** | **Clean the validator, THEN the 8 strategies.** Add costs to `bt-real`. Pass `day.lot` to `sizeLots` | Every `bt-*` runs with **no future information** and is re-scored | **Approval — results WILL move (PF 7.41 → ~0.55)** | 8/8 scripts leak-free · `bt-validate` leak-free · every claim re-derived |
| **3 — Architecture Evolution** | `EventBus` → `Scheduler` → `routes/` → `quant/` kernel | `server.js` < 2,000 LOC · one `bsGamma` · one Kelly · one `maxDD` | Behaviour risk — **characterize before refactor** | Clean-arch 44/120 → 80+ · testability of routes > 0 |
| **4 — Operational Excellence** | Structured logs · alerting · audit trail · DR procedure · perf baselines | 000-E production checklist ≥ 8/10 | — | Production readiness 34% → 70% |
| **5 — AI Readiness** | Unified outcome ledger · feature store · labelled outcomes **12 → 200** | ≥ 1 engine publishes a **measured out-of-sample `reliability`** | **Time. Cannot be shortcut** | Ensemble weights become non-zero for the first time |
| **6 — Production Candidate** | `AccountLedger` · `OrderManager` · read-only `RiskEngine` | Account-level exposure exists and has been correct for 2 weeks | Conditional on **Phase 2 returning an edge** | Live-trading gate 0/6 → 5/6 |
| **7 — Live Validation** | — | **All 6 gates + owner approval** | **NOT SCHEDULABLE.** Blocked behind Phase 2 | — |

---

# SECTION 10 — AI READINESS ASSESSMENT

> ## 🔴 **BLOCKED — INSUFFICIENT EVIDENCE**

| Capability | Verdict | Evidence |
|---|---|---|
| **AI signal ranking** | **BLOCKED** | Ranking requires a measured reliability per source. **None exists** *(001-D §10)* |
| **Probability estimation** | **BLOCKED** | **12** canonical labelled outcomes *(001-D R-09)* |
| **Confidence calibration** | **BLOCKED** | 58 outcomes across 5 schemas **cannot fill one calibration bin honestly** |
| **Meta Decision Engine** | **BLOCKED — mathematically** | `engine-verdict.js:25`: *"`reliability: null` ⇒ weight 0."* No engine publishes a measured reliability ⇒ **every weight is 0 ⇒ the ensemble is the empty sum.** v1 could only ever return `INSUFFICIENT_DATA` |
| **Autonomous decision making** | **BLOCKED — and must remain so** | No validated edge · no risk engine · no audit trail. **Autonomy on top of an invalidated edge is the worst possible configuration** |
| **Machine learning** | **BLOCKED** | **No feature store.** Features are computed and discarded. **You cannot train on data you did not keep** |

**The unblocking sequence is not technical. It is: (1) a clean backtest, (2) a unified labelled ledger,
(3) time.**

---

# SECTION 11 — GO / NO-GO DECISION MATRIX

| Activity | Decision | Evidence |
|---|---|---|
| **Research** | 🟢 **GO** | The data is authoritative (600 exchange days), the discipline is Level 4, and the audit trail is intact. **This is what the platform should be doing** |
| **Backtesting** | 🔴 **NO-GO — until B-1 and B-2 are fixed** | **Every current backtest is invalid, and so is the validator** *(001-D R-01, R-02)*. **Running more backtests today produces more fiction** |
| **Paper Trading** | 🟢 **CONDITIONAL GO — continue** | It is the **only uncontaminated evidence stream**. **Condition:** fix B-3 (halted engines are silently re-enabled) and unify the 5 ledgers, or the outcomes will not be usable |
| **Operational Deployment** | 🔴 **NO-GO** | No alerting, no audit trail, no DR, `/api/m/health` → 404 *(001-E)* |
| **Production Deployment** | 🔴 **NO-GO** | Production readiness **27/80 (34%)**; checklist **4/10** *(001-E §6)* |
| **Live Trading** | 🔴 **BLOCKED** | **0 of 6 gates passed.** No validated edge · no risk engine · 12 labelled outcomes · no operational review *(001-E §1)* |
| **Any AI/autonomous decisioning** | 🔴 **BLOCKED** | §10 |

> **The paper bot should keep running. Everything downstream of a backtest should stop until the
> validator is clean.**

---

# SECTION 12 — EXECUTIVE RECOMMENDATIONS

*Only where evidence supports them.*

### Safety
1. **Approve B-3** — a halted engine must not be silently re-enabled at boot. **The fix belongs in the engine as an invariant (`autoEnabled` must not be settable while `_haltedReason` is non-null`), not as a check at the call site** *(001-C §7)*.
2. **Approve B-4** — `server.js` must read the lot from `instrument-registry`, not hardcode 65.
3. **Approve B-6** — `.env` must be written atomically, via `safe-write`.

### Research
4. **Fix `bt-validate.js` FIRST.** It is a tool, not a shipped strategy — **fixing it changes no published result and unblocks everything else.**
5. **Then fix the 8 strategies, one at a time, each with its own review.** Results will move. **That is the point.**
6. **Do not run `bt-validate.js` before step 4.** It would convert a wrong answer into a confidently wrong answer.
7. **Remove or evidence** `candlestick-patterns.js:344`'s "backtest-grounded" claim.

### Architecture
8. **Do not refactor `server.js` yet.** Characterize first — a route-response snapshot test for all 172 routes *(001-C §14)*.
9. **`EventBus` and `Scheduler` are additive and safe** — they change no behaviour and make `clearInterval` *possible*.
10. **Give `r` an owner.** One `bsGamma`, guarded by an equivalence test *(001-B A-02)*.

### Operations
11. **`module-contract.mountAll(app)` — one line.** Observability **1/10 → ~6/10** *(001-E §8)*.
12. **Establish baselines** (startup, memory, latency) — **000-E forbids optimising without one, and none exists.**

### Maintainability
13. **Delete the 4 dead modules** (Ca = 0). Zero risk.
14. **Extract `registerRoutes` out of `amibroker-bridge.js`** — a domain module must not know about HTTP.

### Testing
15. **Preserve the characterization-first discipline. It is the most valuable asset in the repository.**
16. **Add route tests** — currently **zero**.

### Documentation
17. **Start an ADR log.** The single most damaging documentation gap: **nobody knows why `CAPITAL_TOTAL` is a config key**, and that ambiguity silently overwrote the account balance at every boot until 2026-07-10.

### Production
18. **Do not pursue production readiness yet.** It is a **Phase 4** goal and it is **conditional on Phase 2 returning an edge.** Hardening a platform with no validated edge is building infrastructure to run a strategy that does not work *(EVOLUTION-2026-07-10 §0)*.

---

# SECTION 13 — SUCCESS METRICS

*Measurable outcomes only. No invented targets.*

### 30 days
- `bt-validate.js` look-ahead **removed**; its own characterization test proven RED first → green
- **8/8** strategy scripts free of future information *(currently 0/8)*
- **0** live fail-opens *(currently 1: `server.js:7278`)*
- `GET /api/m/health` returns **200** *(currently 404)*
- `lotSize` literals in `server.js`: **0** *(currently 3)*
- `clearInterval` count: **14** *(currently 0)*
- **A-13 measured** — the broker chain's OI unit is known *(currently UNKNOWN)*
- `data/vrp-monitor.json` entries: **> 0** *(currently 0)*

### 90 days
- Every `bt-*` strategy carries walk-forward + purged k-fold + PSR + DSR *(currently 0/8)*
- A **single unified labelled-outcome ledger** exists *(currently 5 incompatible ones)*
- Labelled outcomes: **≥ 60 in ONE schema** *(currently 12 in the canonical file)*
- Intraday chain sessions captured: **≥ 60** *(currently 1)*
- **The edge question is answered — validated or retired.** Both are successes

### 180 days
- `server.js` < **2,000 LOC** *(currently 7,328)*
- **One** `bsGamma`, **one** Kelly, **one** `maxDD` definition *(currently 2 / 4 / 2)*
- Empty catches: **< 20** *(currently 92)*
- Daily NAV series exists *(currently absent)* → Sharpe and drawdown become derivable
- Production readiness: **≥ 60%** *(currently 34%)*

### 365 days
- **≥ 1 engine publishes a MEASURED out-of-sample `reliability`** *(currently 0)* — the first non-zero ensemble weight in the platform's history
- Labelled outcomes: **≥ 200** *(currently 12)*
- `AccountLedger` is the single owner of capital *(currently 3 owners)*
- Live-trading gate: **≥ 5 of 6** *(currently 0 of 6)*

---

# SECTION 14 — PROJECT VISION

```
  CURRENT STATE
  Paper-trading research platform · no validated edge · Level 3 (000-E)
        │
        │  EVIDENCE REQUIRED: a validator that does not see the future,
        │  and 8 strategy scripts that do not either.
        ▼
  RESEARCH PLATFORM
  Every backtest leak-free · every claim re-derived · walk-forward + PSR + DSR applied
        │
        │  EVIDENCE REQUIRED: an edge that survives purged k-fold, deflated Sharpe
        │  and a bootstrap of the tail — OR an honest retirement of the hypothesis.
        │  ⚠️ BOTH OUTCOMES ARE SUCCESSES. Only a fabricated one is a failure.
        ▼
  VALIDATED DECISION PLATFORM
  ≥ 200 labelled outcomes in ONE schema · ≥ 1 engine publishing a MEASURED reliability
        │
        │  EVIDENCE REQUIRED: a daily NAV series · account-level exposure ·
        │  a single owner for capital and for orders.
        ▼
  OPERATIONAL TRADING PLATFORM
  AccountLedger · OrderManager · read-only RiskEngine · audit trail · alerting
        │
        │  EVIDENCE REQUIRED: 000-E production checklist ≥ 8/10 ·
        │  monitoring · alerting · tested DR · owner approval.
        ▼
  PRODUCTION CANDIDATE
        │
        │  EVIDENCE REQUIRED: all 6 live-trading gates · an operational review ·
        │  and an owner who has read the evidence, not the summary.
        ▼
  LIVE VALIDATED SYSTEM
```

**The platform is at the first arrow. It cannot skip one.**

---

# SECTION 15 — CORRECTIONS TO PRIOR CLAIMS (Rule Zero)

*Statements this project previously made that did not survive measurement. Recorded, not deleted.*

| Prior claim | Measured | Where corrected |
|---|---|---|
| *"`server.js` has 168 routes"* | **172** (GET 135 · POST 45 · PATCH 4) | 001-B §19 |
| *"There are 3 dependency cycles"* | **ZERO** — all three `require()`s are inside **documentation comments** | 001-B §19 |
| *"`vol-context.js` uses `r = 0`"* — **retracted as unverified** | **The claim was TRUE. The retraction was wrong** — and re-measuring surfaced something worse: **the parameters are also swapped** | 001-B §19 |
| *"~55 labelled outcomes"* | **58 — across 5 incompatible ledgers.** The canonical file holds **12** | 001-D §14 |
| *"`bt-validate.js` is called by zero scripts"* | **`forward-test-report.js` calls it.** Zero *strategy* scripts do; one *reporting* script does | 001-D §14 |
| 🔴 ***"Fix the strategies, then run them through `bt-validate.js`"*** — **the previously recommended action** | **`bt-validate.js` has the same look-ahead.** The recommendation **would have produced false confidence, not validation** | 001-D §14 |
| *"`bt-real.js` fails at PF 0.84 even with look-ahead"* | It has **two** look-aheads **and no cost model.** The statement understated the problem | 001-D §14 |
| Three of my own automated "critical" findings (a 1,647-line function · command injection · a CORS wildcard) | **All three FALSE POSITIVES**, discarded after reading the code by hand | 001-C §16 |

> **This table is the most important evidence of quality in the report.** A forensic audit that produced
> no corrections to its own authors would not be a forensic audit.

---

# FINAL MASTER REPORT — FOR A NEW CTO

### Where the project stands
A **well-engineered, well-tested, honestly-documented research platform with no validated edge, no risk
engine, no owner for its capital, and an observability layer that is one line short of working.**
Composite health **33/100** — the average of a **Test Quality of 80** and a **Research Integrity of 5**.

### Why it stands there
**One unlabelled datum.** `bt-lib.js:22` published a *closing* price under the name `underlying`. Eight
strategy scripts consumed it. **So did the validator built to catch exactly this.** Everything
downstream — the ₹7L capital allocation, the strangle engine, the PoP seller, the "88.4% win rate" —
rests on a number from the future.

### What must happen next
1. **Fix the validator.** It is a tool, not a shipped result. **Nothing else may proceed first.**
2. **Approve the four protected fixes** — ≈15 lines: the halt fail-open, the hardcoded lot, the `.env`
   write, and `mountAll()`.
3. **Fix the eight strategies, one at a time.** **The results will get worse. That is the correct
   outcome.**

### What must NOT happen yet
**No live trading** (0 of 6 gates). **No Meta Decision Engine** (every weight is 0). **No Risk Engine,
Portfolio Engine or Volatility Surface** — each would be infrastructure built to run a strategy that
does not work. **No refactor of `server.js`** without characterization. **And no further backtests until
the validator is clean** — running them now produces confident fiction.

### The one thing worth knowing
> This platform's most valuable asset is not its code, its data, or its 47 test suites.
> **It is that its own process invalidated its flagship result — and then invalidated its own
> recommended fix.**
>
> **A system that can prove itself wrong is the only kind whose next claim is worth anything.**

---

**Files modified: NONE. New findings: NONE — every conclusion cites 001-B, 001-C, 001-D or 001-E.
Suite: 47/47.**
