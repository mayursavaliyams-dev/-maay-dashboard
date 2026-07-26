# 019 — PROBABILITY ENGINE, CALIBRATION & RELIABILITY GOVERNANCE

**Standard:** Master Prompt 019 · **Depends on:** 000-A…E, 001-A…F, 002…018
**Date:** 2026-07-12 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No prediction model created. No strategy optimized.**

---

# SECTION 0 — THE FIRST CALIBRATION EVER PERFORMED ON THIS PLATFORM

**`data/signal-outcomes.json` holds 12 rows that carry BOTH a published probability AND a realised
outcome. That is everything needed to calibrate — and it has never been done.**

**I did it.**

```
   #   published    realised
   1      76%         WIN
   2      61%         WIN
   3      69%         WIN
   4      68%         WIN
   5      67%         WIN
   6      74%        LOSS      ◀── the 2nd-highest-confidence signal lost
   7      63%        LOSS
   8      65%         WIN
   9      73%         WIN
  10      57%        LOSS
  11      74%         WIN
  12      72%         WIN
  ──────────────────────────────
  MEAN PUBLISHED PROBABILITY : 68.3%
  REALISED WIN RATE          : 75.0%
  CALIBRATION ERROR          : −6.8 points   ← the model is UNDER-confident, not over
  BRIER SCORE                : 0.1773
  Brier of a constant base-rate predictor : 0.1875
  → the model BEATS the base rate.
```

## 🟢 **And for one moment, this is the first positive quantitative result in the entire audit programme.**

**Then I tested it.**

```
  DISCRIMINATION — can the probability RANK a winner above a loser?

  winners (n=9)  mean published prob : 69.4%
  losers  (n=3)  mean published prob : 64.7%

  AUC = 0.685                    (0.5 = no skill, 1.0 = perfect)
  permutation p-value = 0.191    (20,000 random re-labellings)
```

> ## 🔴 **p = 0.191.**
> ## **NINETEEN PERCENT of RANDOM labellings rank the outcomes this well or better.**
> ## **The ranking is INDISTINGUISHABLE FROM CHANCE.**

## §0.1 — What this means, stated exactly

| Claim | Verdict |
|---|---|
| *"The probabilities are well calibrated"* | ⚪ **UNKNOWN.** A −6.8-point error on n=12 is noise |
| *"The probabilities are badly calibrated"* | ⚪ **UNKNOWN.** Also unsupported |
| *"The model beats the base rate (Brier 0.1773 < 0.1875)"* | 🔴 **NOT SUPPORTED.** The margin is 0.0102 on **twelve** samples |
| *"The model can rank a winner above a loser (AUC 0.685)"* | 🔴 **NOT SUPPORTED. p = 0.191** |
| *"The model is useless"* | ⚪ **ALSO UNKNOWN.** n = 12 supports **no conclusion in any direction** |

## §0.2 — 🔴 **This is the mirror image of 009 §0, and together they are the lesson of this entire audit**

| | 009 §0 | **019 §0** |
|---|---|---|
| The number looked | **certain** (DSR 0.9999, "edge real @95%") | **encouraging** (AUC 0.685, beats base rate) |
| The cause | **a look-ahead bias** | **a sample of twelve** |
| The truth | **the edge was an artefact** | **the skill is unknown** |
| The error | **mistaking a computed number for evidence** | **mistaking a computed number for evidence** |

> **In 009, contaminated data made a bad strategy look statistically certain.**
> **In 019, a tiny sample makes an unknown model look promising.**
>
> **They are the same mistake, and both were made by this platform, and one of them was nearly made by
> me — in this document, five minutes ago, before I ran the permutation test.**

---

# PART 1 — PROBABILITY INVENTORY

| Component | Purpose | Owner | Calibrated? | Confidence |
|---|---|---|---|---|
| **`prob` / `rawP`** (`signal-outcomes.json`) | The published probability | 🔴 **NOBODY** | 🔴 **NEVER — until §0** | HIGH |
| **`confluence-learner.js`** | 9 learned factor weights | itself | 🔴 **NO** | HIGH |
| **`signal-health.js`** | Expectancy `p·avgWin − (1−p)·avgLoss` | — | 🔴 uses an **uncalibrated** `p` | MEDIUM |
| **`meta-label.js`** | Meta-labelling | — | 🔴 NO | MEDIUM |
| **`bt-validate.js`** | PSR, DSR, purged k-fold | — | 🟢 **The mathematics is correct** | HIGH |
| **`engine-verdict.js`** | 🟢 **The reliability CONTRACT** — `reliability: null ⇒ weight 0 ⇒ VETO-ONLY` | — | 🟢 **correct** | HIGH |
| **`candlestick-patterns.js:344`** | 🔴 **A `"backtest-grounded"` reliability** | — | 🔴 **THE BACKTEST DOES NOT EXIST** | HIGH |
| **Calibration utility** | — | — | 🔴 **DOES NOT EXIST** | HIGH |
| **Reliability registry** | — | — | 🔴 **DOES NOT EXIST** | HIGH |
| **Confidence intervals** | — | — | 🔴 **COMPUTED NOWHERE** | HIGH |

---

# PART 2 — PROBABILITY PIPELINE

```
  Prediction ──▶ Σ (factor × learned weight)
       ↓          🔴 including `fii` (n=0) and `volume` (n=0)  (016 §0)
       ↓
  Probability ──▶ `prob: 76`  — a NUMBER, published to a dashboard
       ↓          🔴 Where does 76 come from? A score, rescaled. NOT a frequency.
       ↓
  Calibration ──▶ 🔴🔴 **THIS STAGE DOES NOT EXIST.** §0 is the first one ever run.
       ↓
  Reliability ──▶ 🔴 **EVERY reliability is `null`.** No engine has ever measured its own.
       ↓
  Evidence Check ──▶ 🔴 **DOES NOT EXIST.** Nothing checks n before publishing a probability.
       ↓
  Decision Confidence ──▶ the same uncalibrated number
       ↓
  Decision Support ──▶ 7 of 8 engines emit raw BUY/SELL
       ↓
  Outcome ──▶ 12 rows. 🔴 features discarded ⇒ no inference is reproducible. (016, 018)
```

**Three of eight stages do not exist. Two more publish numbers with no evidence behind them.**

---

# PART 3 — CALIBRATION ASSESSMENT

| Capability | Present? |
|---|---|
| **Probability calibration** | 🔴 **NEVER PERFORMED before §0** |
| **Reliability calibration** | 🔴 **NEVER PERFORMED** |
| **Confidence intervals** | 🔴 **COMPUTED NOWHERE.** `bt-validate.js` exports the machinery; **nothing calls it** |
| **Calibration monitoring** | 🔴 **DOES NOT EXIST** |
| **Probability consistency** | 🔴 **NOT CHECKED** |

## 🔴 Are the probability estimates empirically justified?

> ## **NO. And after §0, that is now a MEASURED statement rather than an absence.**
>
> **A `prob: 76` is published to a live dashboard as if it means "this wins 76 times in 100."**
> **Nothing has ever verified that. The one attempt — §0, n=12 — returns p = 0.191.**
>
> **The number is not wrong. The number is UNJUSTIFIED, which is a different and more dangerous thing:
> a wrong number can be corrected; an unjustified one is trusted.**

---

# PART 4 — RELIABILITY

| Dimension | Status |
|---|---|
| **Reliability definition** | 🟢 **EXISTS AND IS CORRECT.** `engine-verdict.js:60`: *"`reliability` — 0..1 **MEASURED OUT-OF-SAMPLE**, or null"* |
| **Evidence sources** | 🔴 **NONE.** No engine has ever measured its own out-of-sample reliability |
| **Sample dependence** | 🔴 **NOT MODELLED.** A factor with n=5 and one with n=10 are treated identically |
| **Regime dependence** | 🔴 **NOT MODELLED.** All 12 outcomes span **four consecutive days** — **one regime, at most** |
| **Time dependence** | 🔴 **NOT MODELLED.** No decay, no recency weighting on the reliability |
| **Strategy dependence** | 🔴 **NOT MODELLED.** No `strategyId` exists anywhere (007 P1-B) |

## ## **RELIABILITY: UNKNOWN — for every component, without exception.**

**019's stop condition: *"Unknown reliability remains UNKNOWN."*** ✅ **Applied.**

---

# PART 5 — EVIDENCE REQUIREMENTS

**Using the project's own gates. No thresholds invented.**

| Estimate | Project-defined gate | Actual | Met? |
|---|---|---|---|
| **Probability** | **M2: ~200 labelled outcomes** | **12** (canonical) | 🔴 **6%** |
| **Reliability** | `engine-verdict.js`: *"MEASURED out-of-sample"* | **0 measured** | 🔴 **0%** |
| **Confidence** | *(none defined)* | published anyway | 🔴 |
| **Ensemble weighting** | `engine-verdict.js`: *"`reliability: null` ⇒ weight 0"* | **all null ⇒ all weights 0** | 🔴 **The ensemble is the EMPTY SUM** |
| **Production readiness** | 001-E: **6 live-trading gates** | **0 of 6** | 🔴 |

## 🔴 The contradiction, stated plainly

> **`engine-verdict.js` says: every weight must be zero, because no reliability has been measured.**
> **`confluence-learner.js` assigns nine non-zero weights, two of them to factors with n = 0.**
>
> **The platform's own contract and the platform's only learning model directly contradict each other,
> and the contract is the one with 114 passing assertions.**

---

# PART 6 — UNCERTAINTY GOVERNANCE

**019: *"Safe behaviour must preserve uncertainty rather than fabricate certainty."***

| Situation | Behaviour | Verdict |
|---|---|---|
| **Missing evidence** (a factor with n=0) | 🔴 **Gets a DEFAULT WEIGHT and votes** | 🔴 **FABRICATES CERTAINTY** |
| **Insufficient samples** (n=5) | 🔴 **Weighted as if fully measured** | 🔴 **FABRICATES CERTAINTY** |
| **Unknown market regime** | 🔴 **Not modelled at all** | 🔴 |
| **Uncalibrated prediction** | 🔴 **Published as `prob: 76`** | 🔴 **FABRICATES CERTAINTY** |
| **Conflicting evidence** | 🔴 **Renormalised away** (018 §0.3) | 🔴 |
| **Unknown market data** | 🔴 **`\|\| 0` × 119** — becomes zero | 🔴 **FABRICATES CERTAINTY** |
| — | — | — |
| 🟢 **Corrupt equity state** | 🟢 **HALTS. *"Cannot know the loss streak."*** | 🟢 **PRESERVES UNCERTAINTY** |
| 🟢 **Unknown instrument** | 🟢 **`lotSize()` returns `null` ⇒ refuse** | 🟢 **PRESERVES UNCERTAINTY** |
| 🟢 **Unknown VIX / event type** | 🟢 **Yields `UNKNOWN`** | 🟢 **PRESERVES UNCERTAINTY** |
| 🟢 **`agents-engine`, on an unreadable position file** | 🟢 ***"The engine cannot know what is open. Saving disabled. Reconcile by hand."*** | 🟢 **EXEMPLARY** |

## The pattern, and it is exact

> **Where the platform touches MONEY, it preserves uncertainty — correctly, deliberately, and well.**
> **Where the platform touches PROBABILITY, it fabricates certainty — every single time.**
>
> **The same codebase, the same authors, and the opposite instinct. The money paths were written by
> someone who knew what they did not know. The probability paths were not.**

---

# PART 7 — OBSERVABILITY

| Required per probability decision | Recorded? |
|---|---|
| Timestamp | 🟢 `t` |
| **Model version** | 🔴 **DOES NOT EXIST** |
| **Dataset version** | 🔴 **DOES NOT EXIST** |
| **Calibration version** | 🔴 **CALIBRATION ITSELF DOES NOT EXIST** |
| **Reliability estimate** | 🔴 **NEVER MEASURED** |
| Confidence | 🟢 `prob`, `rawP` — 🔴 **unjustified** |
| **Supporting evidence** | 🔴 **THE FEATURES WERE DISCARDED** (016, 018) |

> **019's rule: *"Probability without provenance is not scientifically valid."***
> ## **→ 2 of 7 fields. NOT SCIENTIFICALLY VALID.**

---

# PART 8 — FAILURE MODE REGISTER

| ID | Failure | Present? | Downstream impact |
|---|---|---|---|
| **PR-1** | **Calibration never performed** | 🔴 **CONFIRMED — §0 is the first, and it returns UNKNOWN** | **CRITICAL. Every `prob` on the dashboard is unjustified** |
| **PR-2** | **Confidence inflation** | ⚪ **UNKNOWN — and honestly, the opposite is measured:** the model is **under**-confident by 6.8 points. **But at n=12 that is noise** | — |
| **PR-3** | **Zero-evidence factors carry weight** | 🔴 **CONFIRMED — `fii`, `volume`, n = 0** | **CRITICAL** |
| **PR-4** | **Ensemble weighting unjustified** | 🔴 **CONFIRMED.** Every `reliability` is null ⇒ the contract says every weight is 0 | **CRITICAL** |
| **PR-5** | **Unmeasured reliability shipped live** | 🔴 **CONFIRMED — `candlestick-patterns.js:344` `"backtest-grounded"`, no such backtest exists** | HIGH |
| **PR-6** | **Reliability drift** | ⚪ **UNKNOWN — no detector, and no baseline to drift from** | — |
| **PR-7** | **Evidence degradation** | 🔴 **CONFIRMED — the features are destroyed on every inference** (018) | **CRITICAL, and it worsens daily** |
| **PR-8** | **No confidence intervals** | 🔴 **CONFIRMED.** `bt-validate.js` has the machinery; **zero callers** | HIGH |

---

# PART 9 & 10 — PROBABILITY ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   EvidenceValidator  ★   THE GATE. It runs BEFORE anything is published.
     🔴 n < N_MIN                → publish `probability: null`, reason: 'INSUFFICIENT_SAMPLE'
     🔴 not calibrated           → publish `probability: null`, reason: 'UNCALIBRATED'
     🔴 reliability unmeasured   → weight 0. VETO-ONLY.
        ← engine-verdict.js ALREADY SAYS ALL OF THIS. It has one adopter.

   CalibrationLayer  ★
     predicted p vs realised frequency, PER BIN, with a CONFIDENCE INTERVAL.
     🔴 An uncalibrated score MAY NOT be published as a probability. It is a SCORE.
     🔴 Report the Brier score AND the permutation p-value. §0 shows why:
        AUC 0.685 looks like skill. p = 0.191 says it is not.

   ReliabilityRegistry  ★
     per engine, per factor: n · hit-rate · out-of-sample · CI · lastMeasured
     🔴 reliability = null until MEASURED OUT-OF-SAMPLE. No exceptions. No defaults.

   ConfidenceManager
     🔴 UNCERTAINTY IS A FIRST-CLASS VALUE. `null` is a legal, expected, published answer.

   ProbabilityAuditLog  ★
     every published probability: ts · modelVersion · calibrationVersion ·
     reliability · inputsHash · n · CI.
```

## The one rule

> **A score is not a probability. A probability is a score that has been checked against reality.**
> **Until it has been, it must be published as `null` — not as `76`.**

---

# PART 11 — TESTING STRATEGY

| Test | Priority | Would it fail today? |
|---|---|---|
| 🔴 **A probability is published ONLY if calibrated; otherwise `null` + a reason** | **P0** | ✅ **FAILS — `prob: 76` is published uncalibrated** |
| 🔴 **A factor with `n = 0` contributes ZERO weight** | **P0** | ✅ **FAILS — `fii` 10.08, `volume` 8.06** |
| 🔴 **`reliability` is `null` unless MEASURED out-of-sample** | **P0** | ✅ **FAILS — `candlestick-patterns.js:344`** |
| 🔴 **Every published probability carries `n` and a confidence interval** | **P0** | ✅ **FAILS — neither is computed** |
| 🔴 **Calibration is re-run and REPORTED on every new outcome** | **P0** | ✅ **FAILS — §0 is the first run ever** |
| **A reported AUC is accompanied by a permutation p-value** | **P0** | ✅ **FAILS — and §0 shows exactly why this matters** |
| **`null` propagates: an unknown probability does not become 0.5** | P1 | — |

**Six P0 tests. All six fail.**

---

# PART 12 — MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Experimental** | 🟢 | Probabilities are produced |
| **1 — Probability Reporting** | 🟡 **PARTIAL** | 🟢 `prob` is published and outcomes ARE logged — **the raw material for calibration exists.** 🔴 **But no `n`, no CI, no version** |
| **2 — Calibrated Estimates** | 🔴 **NO** | **§0 is the first calibration ever performed, and it returns `p = 0.191` — UNKNOWN** |
| **3 — Reliability Governance** | 🔴 **NO** | **Every reliability is null. Two factors vote on n = 0** |
| **4 — Evidence-Based Confidence** | 🔴 **NO** | **12 outcomes vs M2's 200 = 6%** |
| **5 — Production Candidate** | 🔴 **NO** | — |

## ## **Probability Engine: LEVEL 0–1 — EXPERIMENTAL / partial reporting.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE — this document.** **And the first calibration ever run (§0)** | — | none | Calibration status is now MEASURED, not merely absent |
| **2 — Calibration** | **Wire §0 into the platform as a recurring job.** Report Brier, AUC **and the permutation p-value**, with `n`, on every new outcome | none | **Low — read-only** | **The dashboard shows the calibration, and it shows `n = 12`** |
| **3 — Reliability governance** | 🔴 **A factor with `n < N_MIN` contributes ZERO** (018 §0.3 — **and it must be EXCLUDED from renormalisation, or it keeps its share**). **Remove `candlestick-patterns.js:344`'s unmeasured claim** | Phase 2 | 🔴 **BEHAVIOUR CHANGE — `fii` and `volume` go silent. Correct.** Approval | **No weight without evidence** |
| **4 — Evidence gating** | 🔴 **An uncalibrated score is published as a SCORE, never as a `probability`.** `null` becomes a legal published value | Phase 3 | **Medium — the dashboard will show `null` where it now shows `76%`. That is the point** | **No unjustified probability reaches a user** |
| **5 — Decision readiness** | **Feature store** (018) → grow **12 → 200** *with their inputs* → re-calibrate | Phase 4 | **Time. Cannot be shortcut** | **A published probability has been measured against reality, out of sample** |

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Probability estimates are calibrated | 🔴 **NO — §0 is the first attempt, and it returns UNKNOWN (p = 0.191)** |
| Reliability is evidence-based | 🔴 **NO — every reliability is null; two factors vote on n = 0** |
| Confidence reflects available evidence | 🔴 **NO — a `prob: 76` on n = 12 does not reflect n = 12** |
| **Unknown remains UNKNOWN** | 🔴 **NO for probability** (fabricated) · 🟢 **YES for money** (halts, refuses, nulls) |
| Ensemble weighting is scientifically justified | 🔴 **NO — the platform's own contract says every weight must be 0** |
| Probability decisions are auditable | 🔴 **NO — 2 of 7 provenance fields** |
| **Uncertainty is preserved rather than hidden** | 🔴 **NO — and §0 shows the cost: an AUC of 0.685 that is pure chance** |

## **0 of 7.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent researcher explain every reported probability, reproduce every
confidence estimate, verify calibration quality, and confirm that uncertainty is represented honestly?**

## **They can now — because this audit performed the platform's first calibration. The answer it returns is UNKNOWN, and that answer is the finding.**

**What was measured (§0), on the 12 rows that carry both a published probability and a realised
outcome:**

```
  mean published probability : 68.3%        realised win rate : 75.0%
  calibration error          : −6.8 pts     (UNDER-confident)
  Brier                      : 0.1773       base-rate Brier   : 0.1875   → model "wins"
  AUC                        : 0.685        permutation p     : 0.191    → NOT SIGNIFICANT
```

> **For about five minutes, this was the first positive quantitative finding in the entire audit
> programme. The model appeared to beat the base rate and to rank winners above losers.**
>
> **Then the permutation test returned p = 0.191. Nineteen percent of RANDOM labellings rank these
> twelve outcomes as well or better. There is no measurable skill. There is also no measurable
> failure. There is a sample of twelve, and it supports nothing.**

**And that is precisely the lesson of this whole programme, arriving from the opposite direction:**

> **In 009, a look-ahead bias produced a Sharpe so large that the Deflated Sharpe Ratio certified a
> worthless strategy at 95% confidence.**
>
> **In 019, a sample of twelve produces an AUC of 0.685 that looks like skill and is chance.**
>
> **Both are the same error: mistaking a computed number for evidence. The platform made the first.
> I very nearly made the second, in this document, before I ran the test.**

**The structural finding:**

> **Where this platform touches MONEY, it preserves uncertainty — beautifully. A corrupt ledger halts
> the engine. An unknown instrument refuses to size. `agents-engine` writes: *"The engine cannot know
> what is open. Saving disabled. Reconcile by hand."***
>
> **Where this platform touches PROBABILITY, it fabricates certainty — every single time. A factor
> observed zero times gets a weight of 10.08. A score that has never been checked against reality is
> published as `prob: 76`. A `"backtest-grounded"` reliability is shipped for a backtest that does not
> exist.**
>
> **Same codebase. Same authors. Opposite instinct.**

**The single highest-value probability change:**

> ## **A score is not a probability. Publish `null` until it has been checked against reality.**
>
> **And when it has been — publish the `n` and the p-value beside it, so that nobody, including the
> next auditor, mistakes 0.685 for skill again.**

---

**Prediction models created: NONE. Strategies optimized: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Probability Inventory (Part 1) · Pipeline (Part 2) · **Calibration Assessment — the
first ever performed (§0, Part 3)** · Reliability Review (Part 4) · Evidence Requirements (Part 5) ·
Uncertainty Governance (Part 6) · Observability (Part 7) · Failure Modes (Part 8) · Architecture &
Contracts (Parts 9–10) · Testing Strategy (Part 11) · Maturity Assessment (Part 12) · Migration Roadmap
(Part 13) · Executive Summary.
