# 009 — VALIDATION ENGINE, STATISTICAL EVIDENCE & RESEARCH CONFIDENCE

**Standard:** Master Prompt 009 · **Depends on:** 000-A…E, 001-A…F, 002…008
**Date:** 2026-07-12 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No strategy optimized. No trading logic altered.**

---

# SECTION 0 — THE FINDING THAT MATTERS MOST

**`bt-validate.js` deflates its Sharpe for `NTRIALS = 12` — commented *"roughly how many strategy
variants we've tried."* The true count, counted from the saved result files:**

| Source | Variants |
|---|---|
| `bt-strangle-costs.js` — slippage sweep | **8** |
| `bt-strategies.js` — leaderboard | **5** |
| `bt-world-strategies.js` | **5** |
| `bt-strangle-regime.js` — filters | **5** |
| `bt-strangle-tailsafe.js` — stress | **5** |
| `bt-strangle-trend.js` — filters | **4** |
| `bt-validate.js` — gated/ungated A/B | **2** |
| `bt-real.js`, `bt-nifty-intraday.js` | **2** |
| **TOTAL** | **36** |

**The Deflated Sharpe Ratio exists for exactly one purpose: to correct for the number of hypotheses
tried. It was fed a number three times too small.**

## But the honest, and more important, result — **computed, not assumed**

```
                      SR       SR*@12 trials   SR*@36 trials   verdict @36
LEAKY  (pre-002)     0.846        0.171           0.222        STILL PASSES
HONEST (post-002)   −0.120        0.148           0.191        FAILS
```

> ## 🔴 **Correcting the trial count would NOT have saved you.**
>
> The look-ahead inflated the Sharpe to **0.846** — nearly **four times** the strongest overfitting
> correction the data could support (0.222). **It would have passed the Deflated Sharpe test at any
> realistic trial count.**
>
> **No amount of statistical rigour applied to contaminated data recovers the truth.**
> **Purged k-fold, PSR and DSR are defences against overfitting, selection bias and luck. Against a
> strategy that already knows the answer, they are decoration.**

**Both defects are real and both must be fixed. But their ranking is now evidence, not opinion:**
**temporal integrity FIRST, statistical rigour SECOND.**

---

# PART 1 — VALIDATION INVENTORY

| Component | Purpose | Owner | **Used by** | Confidence |
|---|---|---|---|---|
| **`bt-validate.js`** | The harness: purged k-fold · walk-forward · PSR · DSR | 🔴 **NOBODY** | itself (CLI) + `forward-test-report.js` | HIGH |
| `forward-test-report.js` | Forward-test scorecard | 🔴 NOBODY | — | MEDIUM |
| `backtest-report.js` | Sharpe/Sortino/DD/CAGR | 🔴 NOBODY | `server.js:5142` | MEDIUM |
| `signal-health.js` | Expectancy on live signals | 🔴 NOBODY | server | MEDIUM |
| `meta-label.js` | Meta-labelling | 🔴 NOBODY | 2 modules | MEDIUM |
| `confluence-learner.js` | Learned weights | itself | scoring | MEDIUM |
| **Bootstrap** | — | — | 🔴 **DOES NOT EXIST** | — |
| **Monte Carlo** | — | — | 🔴 **DOES NOT EXIST** | — |
| **Calibration utility** | — | — | 🔴 **DOES NOT EXIST** | — |

## 🔴 P1-A — Seven of thirteen statistics are used by **nothing**

`bt-validate.js` exports 13 functions. Measured usage **outside** its own CLI block:

| Function | Modules using it |
|---|---|
| `walkForward` | **1** (`forward-test-report.js`) |
| `sharpe`, `expectancy`, `deflatedSharpe` | **1** (same) |
| **`purgedKFold`** | **0** |
| **`probabilisticSharpe`** | **0** |
| **`expectedMaxSharpe`** | **0** |
| **`skewness`** | **0** |
| **`kurtosis`** | **0** |
| **`normInv`** | **0** |

> **Purged k-fold cross-validation — the single most important defence against data snooping in
> financial ML — is called by ZERO strategy scripts.** It runs only inside `bt-validate`'s own `main`.

---

# PART 2 — VALIDATION PIPELINE

```
 Research Idea → Implementation → Backtest → Walk-Forward → Purged K-Fold →
 Bootstrap → Monte Carlo → Statistical Eval → Paper → Evidence → Candidate
                              ↑              ↑          ↑↑         ↑
                              │              │          ││         └── 12 outcomes, 4 DAYS
                              │              │          │└── 🔴 MONTE CARLO: DOES NOT EXIST
                              │              │          └─── 🔴 BOOTSTRAP: DOES NOT EXIST
                              │              └── 🔴 0 of 8 strategy scripts
                              └── 🔴 8 of 8 scripts carry look-ahead (7 still live)
```

## Missing stages: **Bootstrap · Monte Carlo · Calibration.** All three: **do not exist.**

## Unsupported transitions — every strategy made at least one

| Strategy | Illegal jump | Evidence |
|---|---|---|
| **Iron condor (LIVE, ₹7L)** | **Backtest → Paper**, on a backtest of a **different structure** | 007 §0 — the live ledger contains only `IRON_CONDOR`; the flagship backtest has **zero** condor references |
| **Directional (LIVE, auto ON)** | **Backtest → Paper**, on a **refuted** backtest | PF 0.94 over 1,200 trades; **two** look-aheads; **zero** cost model |
| Afternoon (LIVE) | → Paper with **no backtest at all** | none exists |
| Agents, Bounce (LIVE) | → Paper with no backtest | none exists |
| Gamma blast (LIVE) | 🟢 **HONEST** — declares itself not backtestable | the only clean lifecycle |

---

# PART 3 — STATISTICAL ASSESSMENT

| Metric | Classification | Evidence |
|---|---|---|
| **Sharpe** | 🟢 **VERIFIED** | `bt-validate:64`. Used |
| **PSR** | 🟡 **IMPLEMENTED, UNUSED** | 0 external callers |
| **DSR** | 🟡 **IMPLEMENTED, USED — with a 3×-understated `nTrials`** (§0) | `NTRIALS = 12` vs **36** |
| **Purged K-Fold** | 🟡 **IMPLEMENTED, UNUSED** | 0 callers |
| **Walk-forward** | 🟢 **VERIFIED** | 1 caller |
| **Skewness / Kurtosis** | 🟡 **IMPLEMENTED, UNUSED** | Reported by `psr` only |
| **Max drawdown** | 🔴 **INCONSISTENT** | **8 implementations.** `bt-strangle-*` return a **fraction**; `bt-nifty-intraday:203` returns **absolute points**. **Both named `maxDD`** |
| **Confidence intervals** | 🔴 **MISSING** | Computed nowhere |
| **Effect size** | 🔴 **MISSING** | |
| **Distribution analysis** | 🟡 skew + kurt exist; no test |
| **Variance** | 🟢 `std` |
| **Bootstrap CI** | 🔴 **MISSING** |
| **Recovery factor / Exposure** | 🔴 **MISSING** |

**Verified: 3 · Implemented-but-unused: 5 · Missing: 5.**

---

# PART 4 — SAMPLE ADEQUACY

## Backtest sample

| | |
|---|---|
| Trades | **129** (strangle) · 1,200 (directional) |
| Period | 600 days, 2024-01-08 → 2026-06-17 |
| Regimes covered | ⚪ **UNKNOWN — never classified.** No regime labelling of the sample exists |
| Instruments | **1** (NIFTY). No cross-instrument confirmation |
| Statistical power | 🔴 **NOT COMPUTED** |
| Confidence interval | 🔴 **NOT COMPUTED** |

> 🔴 **A short strangle / iron condor is a negative-skew structure. The tail IS the strategy.**
> **129 observations over 2.4 years contains approximately zero tail events.** Even a *clean* PF of 1.5
> on this sample would say nothing about the trade that ends the account.
> **Measured skew of the honest returns: −0.765. Kurtosis: 3.227.** The distribution is already
> left-tailed, on a sample too small to see its own tail.

## 🔴 Paper-trading sample — **measured, and it is four days**

```
data/signal-outcomes.json
  entries    : 12
  won        : 9
  structures : IRON_CONDOR   (the only one)
  span       : 2026-07-07  →  2026-07-10        ← FOUR CALENDAR DAYS
```

> **12 trades over 4 days is not a sample. It is a long weekend.**
>
> A 9/12 win rate on a 4-day window carries **no information whatsoever** about a premium-selling
> strategy whose entire risk lives in a tail that appears a few times a decade.

**The project's own constraint M2 requires ~200 labelled outcomes. There are 12 in the canonical file
(58 across five incompatible ledgers — 001-D R-09). That is 6%.**

---

# PART 5 — BIAS AUDIT

| Bias | Present? | Evidence |
|---|---|---|
| **Look-ahead** | 🔴 **CONFIRMED — the defining defect** | 8/8 scripts. **7 still live.** `bt-validate` fixed in 002. Effect: **PF 7.41 → 0.55; DSR `PASS` → `FAIL`** |
| **Data leakage** | 🔴 **CONFIRMED** | The IV-proxy regime gate read **today's** proxy, built from **today's close** (`bt-validate:151` — fixed) |
| **Data snooping / multiple hypothesis** | 🔴 **CONFIRMED, QUANTIFIED (§0)** | **36 variants tried; DSR deflated for 12.** 3× understated |
| **Parameter overfitting** | 🔴 **CONFIRMED** | `bt-real.js:9-10` — **9 free constants, zero justification.** First-100 trades: +312 pts, PF 1.31. At 1,200: **PF 0.94.** *The early result was noise, and nine knobs are what let noise look like signal* |
| **Selection bias** | 🔴 **CONFIRMED** | Published results cite `bt-strangle-costs` (the winner). **`bt-strangle-tailsafe` — the only script modelling the structure actually traded — is cited by nothing** |
| **Confirmation bias** | 🔴 **CONFIRMED** | `bt-validate.js` prints **"GATE ADDS VALUE … wire it live"** for the gated variant — whose **DSR is 0.2354, a FAIL**. **The harness recommends deploying a variant its own statistics reject** (002 B-7) |
| **Survivorship bias** | 🟢 **NOT APPLICABLE** | Index options. No delisting |
| **Cost bias** | 🔴 **CONFIRMED, QUANTIFIED** | 008 §0 — **STT charged on the wrong side of every short.** ≈ **₹20,333 understated** across 129 trades. **Systematically optimistic on winners** |

**Seven of eight bias classes are confirmed present. Six are quantified.**

---

# PART 6 — PAPER TRADING VALIDATION

| Dimension | Verdict |
|---|---|
| Signal capture | 🟡 Signals are captured |
| **Inputs captured** | 🔴 **NO.** Features are computed and **discarded.** ⇒ **no post-hoc re-labelling, no calibration, no ML — ever** |
| **`strategyId`** | 🔴 **The field does not exist anywhere in the codebase** (007 P1-B) |
| Trade logging | 🟡 5 incompatible ledgers |
| **Label quality** | 🟡 `won`, `pnl` present |
| **Outcome completeness** | 🔴 **12 in the canonical file.** `signal-paper-positions.json`: 2 entries, **0 labelled** |
| **Calibration readiness** | 🔴 **BLOCKED.** 12 outcomes cannot fill one probability bin honestly |
| Forward performance tracking | 🟡 `forward-test-report.js` exists |
| 🔴 **`data/vrp-monitor.json`** | **EMPTY — 0 entries.** **The one instrument that would directly test the platform's core hypothesis (implied > realised) has never recorded an observation** |

### **Evidence maturity: 4 days of data. NOT SUFFICIENT FOR ANY CONCLUSION.**

---

# PART 7 — CONFIDENCE MODEL

> ## 🔴 **BLOCKED — INSUFFICIENT EVIDENCE**

| Capability | Verdict | Evidence |
|---|---|---|
| **Confidence scores** | 🔴 **BLOCKED** | Scores are emitted (`prob: 76`), but **nothing has ever validated that a "76%" wins 76% of the time.** 12 outcomes cannot test it |
| **Reliability estimates** | 🔴 **BLOCKED — mathematically** | `engine-verdict.js:25`: *"`reliability: null` ⇒ weight 0."* **No engine publishes a measured out-of-sample reliability. The contract has ONE adopter of eight** ⇒ every weight is 0 ⇒ **the weighted ensemble is the empty sum** |
| **Strategy ranking** | 🔴 **BLOCKED** | Ranking requires comparable, valid backtests. **There are none** |
| **Ensemble weighting** | 🔴 **BLOCKED** | Follows from reliability |
| **Decision probabilities** | 🔴 **BLOCKED** | 🔴 **And one is already shipping unmeasured:** `candlestick-patterns.js:344` — *"TF reliability (**backtest-grounded**)"* — **there is no such backtest anywhere in the repository.** **UNKNOWN presented as MEASURED, in a live scoring path** |

---

# PART 8 — OBSERVABILITY

| Required | Recorded? |
|---|---|
| Dataset version | 🔴 **NO — 0 of 13 scripts** |
| **Code version / git SHA** | 🔴 **NO — 0 of 13** |
| Parameters | 🔴 **1 of 13** |
| Random seeds | ⚪ **N/A — nothing is random.** 🟢 Replay is deterministic |
| **Statistical assumptions** | 🔴 **NO** — `NTRIALS = 12` is a **comment**, not an assumption record. **And it is wrong (§0)** |
| Validation results | 🟢 `bt-data/result-validate.json` |
| Confidence measures | 🟡 DSR/PSR present in that one file |

> **008's rule applies here verbatim: *"Without provenance, validation is not reproducible."***
> **`result-strangle-costs.json` holds the PF 7.41 that justifies ₹7L. It does not record which version
> of `bt-lib.js` produced it — before or after the 2026-07-10 lot fix. UNKNOWABLE from the artefact.**

---

# PART 9 — VALIDATION ARCHITECTURE (conceptual — no code)

```
   EvidenceRepository  ★
     Every claim is a ROW, not a memory:
       claimId · strategyId · structure · gitSha · datasetHash · nTrials ·
       assumptions[] · sample(n, span, regimes) · result · verdict · supersededBy
     🔴 A claim WITHOUT a row does not exist.        → kills the "PF 7.41" provenance gap

   TrialRegistry  ★
     Every backtest variant ever run INCREMENTS a counter.
     DSR reads nTrials FROM THE REGISTRY, never from a hand-typed literal.
     🔴 This makes §0 structurally impossible.

   ValidationPipeline  (a gate, not a suggestion)
     temporal-integrity  →  costs  →  sizing  →  walk-forward  →  purged k-fold
        →  bootstrap  →  Monte Carlo  →  DSR  →  paper  →  calibration
     🔴 STAGE 1 IS TEMPORAL INTEGRITY, AND IT IS A HARD GATE.
        §0 proves why: no downstream statistic can detect a look-ahead.

   ConfidenceModel
     reliability := MEASURED out-of-sample, or null.
     null ⇒ weight 0 ⇒ VETO-ONLY.        (engine-verdict.js — already written, 1 adopter)
     🔴 No module may publish a confidence it did not measure.
        → kills candlestick-patterns.js:344
```

## The one rule this architecture encodes

> **Statistical rigour is downstream of temporal integrity, and cannot substitute for it.**
> **§0 is the proof: a Sharpe of 0.846 obtained by seeing the future passes every overfitting
> correction the mathematics can offer.**

---

# PART 10 — TESTING STRATEGY

| Test | Priority |
|---|---|
| 🔴 **`nTrials` is read from a registry, not a literal** | **P0 — §0** |
| 🔴 **A look-ahead tripwire per script** (7 remain) | **P0** |
| 🔴 **`charges(side='SHORT')` — STT on the sell leg** | **P0 — 008 §0** |
| 🔴 **No module publishes a `reliability` it did not measure** | **P0** — `candlestick-patterns.js:344` |
| 🔴 **`bt-validate` does NOT recommend "wire it live" on a failing DSR** | **P0 — 002 B-7** |
| **Every result carries a RunManifest (gitSha + datasetHash + nTrials)** | **P0** |
| Statistical functions vs known reference values | P1 |
| `maxDD` means one thing | P1 |
| Replay determinism: two runs → byte-identical trades | P1 |

---

# PART 11 — RESEARCH MATURITY MATRIX

| Strategy | Level | Evidence |
|---|---|---|
| **Iron condor** *(LIVE, ₹7L, auto ON)* | **Level 1 — Prototype** | 🔴 **Its structure has NEVER been backtested** (007 §0). The cited backtest is a naked strangle, and it now scores **`FAIL (likely overfit)`** |
| **Directional buying** *(LIVE, auto ON)* | **Level 1 — Prototype** | PF 0.94 · **two** look-aheads · **zero** cost model · 9 unjustified parameters |
| **Afternoon** *(LIVE)* | **Level 0 — Hypothesis** | **No backtest exists** |
| **Agents / Bounce** *(LIVE)* | **Level 0 — Hypothesis** | No backtest exists |
| **Gamma blast** *(LIVE)* | **Level 1 — Prototype** | 🟢 **Honestly declared not backtestable.** Forward-test only |
| **PoP seller** | **Level 1** | 1 labelled outcome |

> ## 🔴 **ZERO strategies at Level 3 (Statistically Validated). ZERO at Level 4.**
> ## **FOUR strategies are running live at Level 0 or 1 — with no backtest at all.**

---

# PART 12 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE — this document** | — | none | Every component catalogued |
| **2 — Pipeline completion** | 🔴 **Temporal integrity FIRST** (7 scripts). Then **direction-aware costs** (008 §0). Then **`nTrials` from a registry** (§0) | `bt-validate` ✅ clean | 🔴 **Every published number changes. Approval per script** | Stage 1 is a hard gate that cannot be skipped |
| **3 — Statistical reinforcement** | Wire **purged k-fold** (0 callers today). Add **bootstrap** and **Monte Carlo** (neither exists). **The tail is the whole question for a negative-skew structure** | Phase 2 | Low — additive | Every strategy carries WF + k-fold + bootstrap + DSR at the **true** trial count |
| **4 — Evidence collection** | **Unify the 5 ledgers.** Add `strategyId` + `inputsHash`. **Start the VRP monitor** (empty). Grow **12 → 200** | Phase 3 | **Time. Cannot be shortcut** | One labelled dataset. ≥ 200 outcomes |
| **5 — Confidence calibration** | Measure out-of-sample `reliability` per engine | Phase 4 | Medium | **≥ 1 non-zero ensemble weight — the first in the platform's history** |

---

# PART 13 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every strategy follows a documented validation pipeline | 🔴 **NO — 0 of 8** |
| Statistical evidence is reproducible | 🔴 **NO — zero provenance** |
| Confidence measures are evidence-based | 🔴 **NO — and one unmeasured claim is shipping live** |
| Biases identified and documented | 🟢 **YES — as of this document. 7 of 8 confirmed, 6 quantified** |
| Validation is observable and repeatable | 🟡 **Deterministic, but unrecorded** |
| Conclusions traceable to evidence | 🔴 **NO — `result-*.json` cannot name the code that made it** |

## **Validation Engine maturity: 1 of 6. NOT MATURE.**

---

# EXECUTIVE SUMMARY

**The mission: can an independent researcher determine whether every conclusion is statistically
justified?**

**Yes — and the answer is that none of them is.**

**The platform possesses a genuinely sophisticated statistical toolkit** — purged k-fold, walk-forward,
PSR, deflated Sharpe, skewness, kurtosis — **all correctly implemented.** Seven of its thirteen
functions are called by **nothing**. The one that *is* called was fed a trial count **three times too
small**.

**And yet — this audit's most important result is that none of that was the deciding failure:**

> ```
>                    SR      SR*@12    SR*@36    verdict @36
> LEAKY (pre-002)   0.846    0.171     0.222     STILL PASSES
> HONEST (post-002) −0.120   0.148     0.191     FAILS
> ```
>
> **A look-ahead bias produced a Sharpe four times larger than the strongest overfitting correction the
> data could support. It would have passed the Deflated Sharpe test at ANY trial count.**
>
> **This is the single most valuable lesson in the entire audit programme: statistical rigour is
> DOWNSTREAM of temporal integrity, and cannot substitute for it. A perfect validator pointed at
> contaminated data produces a rigorously computed, statistically confident, completely wrong answer —
> and that is exactly what happened here, for the entire life of this project.**

**The evidence base, stated plainly:**

- **Backtests:** 129 trades, one instrument, negative skew, **no confidence interval, no bootstrap, no Monte Carlo** — and **seven of eight scripts still read the future.**
- **Paper:** **12 outcomes across four days.** All one structure. **Not a sample — a long weekend.**
- **Live:** **four strategies running at Level 0–1, two of them with no backtest of any kind.**

**Confidence model: BLOCKED — INSUFFICIENT EVIDENCE.** Every weight is zero, because no engine has ever
measured its own reliability — and one module is publishing a *"backtest-grounded"* reliability for a
backtest that **does not exist**.

**What is sound and must be kept:** the mathematics in `bt-validate.js` is correct; replay is
deterministic; the data is the exchange's own; and **the process caught its own author six times.**

---

**Strategies optimized: NONE. Trading logic altered: NONE. Suite: 48/48.**

**Deliverables:** Validation Inventory (Part 1) · Pipeline Diagram (Part 2) · Statistical Assessment
(Part 3) · Sample Adequacy (Part 4) · Bias Audit (Part 5) · Paper Trading Validation (Part 6) ·
Confidence Model (Part 7) · Observability (Part 8) · Architecture Blueprint (Part 9) · Testing Strategy
(Part 10) · Research Maturity Matrix (Part 11) · Migration Roadmap (Part 12) · Executive Summary.
