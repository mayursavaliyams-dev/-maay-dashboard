# 016 — AI INFRASTRUCTURE, MODEL GOVERNANCE & DECISION INTELLIGENCE

**Standard:** Master Prompt 016 · **Depends on:** 000-A…E, 001-A…F, 002…015
**Date:** 2026-07-12 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. Autonomous trading NOT authorized. No model trained or optimized.**

---

# SECTION 0 — THE FINDING

## 🔴 §0.1 — **THERE IS NO MACHINE LEARNING. THERE IS ONE LIVE LEARNED MODEL, AND IT IS TRAINED ON FIVE OBSERVATIONS.**

**Measured — the entire "AI" surface:**

```
ML libraries in package.json  : ZERO   (no tensorflow, torch, onnx, sklearn, xgboost, lightgbm, brain.js)
Model files on disk           : ZERO   (no .pkl, .h5, .onnx, .pt, .joblib)
Checkpoints / weights dirs    : ZERO
```

**What actually exists:**

| Component | What it really is |
|---|---|
| `ai.js`, `claude-ai.js` | 🟡 **LLM API calls to Anthropic.** Not models — remote inference. No versioning, no reproducibility |
| `multiconfirm.js`, `master-confluence.js`, `candlestick-patterns.js`, `meta-label.js` | 🟡 **Rule-based scorers.** Deterministic, hand-tuned. **Not learned** |
| 🔴 **`confluence-learner.js`** | 🔴 **THE ONLY THING THAT LEARNS. An online weight update over 9 factors. It is LIVE and it steers signals** |

---

## 🔴 §0.2 — **THE LIVE MODEL, IN FULL**

**`data/confluence-weights.json`. This is the platform's decision engine, as it stands right now.**

```
NIFTY
  factor        weight    correct/wrong    n     hit-rate
  trend          18.17         3/2         5       60%      ◀── HIGHEST WEIGHT. n = 5.
  oi             13.24         2/8        10       20%      ◀── 80% WRONG, weighted POSITIVE
  smartMoney     12.90         2/5         7       29%
  greeks         11.45         4/6        10       40%
  fii            10.08         0/0         0        —       ◀── 🔴 NEVER OBSERVED
  pcr            10.05         4/6        10       40%
  news            9.55         2/8        10       20%      ◀── 80% WRONG, weighted POSITIVE
  volume          8.06         0/0         0        —       ◀── 🔴 NEVER OBSERVED
  iv              5.49         3/7        10       30%
  ──────────────────────────────────────────────────────
  TOTAL observations: 62        labelled trades: 21
```

```
SENSEX    62 → 46 observations. trend 2/5 (40%). smartMoney 1/6 (17%). fii & volume: n = 0.
BANKNIFTY 22 observations.      news 0/4 (0%), weight 8.80.  pcr 4/4 (100%), weight 11.65, n = 4.
```

## Four defects, each independently disqualifying

| # | Defect | Evidence |
|---|---|---|
| **1** | 🔴 **Two factors have NEVER been observed — and they still vote.** `fii` (n=0, weight **10.08**) and `volume` (n=0, weight **8.06**) contribute to **every single decision**, on **zero evidence** | `confluence-weights.json` |
| **2** | 🔴 **The highest-weighted factor is trained on FIVE observations.** `trend`: 3 correct, 2 wrong, weight **18.17** — **the most influential input in the platform is a coin flip** | same |
| **3** | 🔴 **Seven of nine NIFTY factors are BELOW chance** — `oi` 20%, `news` 20%, `smartMoney` 29%, `iv` 30%, `greeks` 40%, `pcr` 40%. **A factor with a 20% hit rate is not a weak signal. It is an 80%-accurate CONTRA-indicator, and it is weighted POSITIVELY at 13.24** | same |
| **4** | 🔴 **BANKNIFTY `news`: 0 correct, 4 wrong — a 0% hit rate — weighted 8.80.** And `pcr`: 4/4 = 100%, on **n = 4** | same |

## 🔴 §0.3 — **THE PLATFORM'S OWN CONTRACT FORBIDS EXACTLY THIS**

```js
engine-verdict.js:25
 *   2. `reliability: null` ⇒ weight 0 ⇒ VETO-ONLY.
 *      An engine that has never been measured may not steer.
```

> **`fii` has never been measured. `volume` has never been measured.**
> **Both steer, every tick, with a combined weight of 18.14 — more than the top-weighted factor.**
>
> **The rule is written, it is tested (114 assertions), and the one component in this platform that
> actually learns violates it on every inference.**

**016's stop condition applies: *"Stop and report UNKNOWN if confidence cannot be justified."***
## **→ CONFIDENCE: UNJUSTIFIED. The weights are not evidence. They are decoration on a sample of five.**

---

# PART 1 — AI INVENTORY

| Component | Type | Owner | Learned? | Status | Confidence |
|---|---|---|---|---|---|
| **`confluence-learner.js`** (195 LOC) | 🔴 **Online learner — 9 factors × 3 instruments** | itself | 🔴 **YES — and it is LIVE** | 🔴 **n = 5–10 per factor; 2 factors n = 0** | **HIGH** |
| `claude-ai.js` (352) | LLM API call | — | no | 🟡 in use | HIGH |
| `ai.js` (485) | LLM API call · `aiDecision` (203 LOC, 8 params) | — | no | 🟡 in use | HIGH |
| `agents-engine.js` (773) | 🟡 **Rule-based "5-agent" pipeline** (news → impact → fusion → risk gate → paper) | itself | 🟡 hand-tuned weights | 🟡 LIVE, 23 trades | HIGH |
| `master-confluence.js` (162) | Rule-based fusion | — | no | in use | HIGH |
| `multiconfirm.js` (303) | Rule-based scorer | — | no | in use | HIGH |
| `candlestick-patterns.js` (462) | Rule-based | — | no | 🔴 **ships a `"backtest-grounded"` reliability for a backtest that DOES NOT EXIST** (`:344`) | HIGH |
| `meta-label.js` (137) | Meta-labelling | — | no | 2 callers | MEDIUM |
| `signal-health.js` (163) | Expectancy tracker | — | no | in use | MEDIUM |
| **`engine-verdict.js`** (194) | 🟢 **The AI contract — correct, tested, enforced** | — | — | 🔴 **1 adopter of 8 engines** | **HIGH** |
| **Feature store** | — | — | — | 🔴 **DOES NOT EXIST** | HIGH |
| **Model registry** | — | — | — | 🔴 **DOES NOT EXIST** | HIGH |
| **Calibration layer** | — | — | — | 🔴 **DOES NOT EXIST** | HIGH |
| **Drift detection** | — | — | — | 🔴 **DOES NOT EXIST** | HIGH |

---

# PART 2 — MODEL LIFECYCLE

```
 Research → Dataset → Feature Eng → Training → Validation → Calibration →
 Paper Eval → Approval → Inference → Retirement
     ↓          ↓            ↓           ↓          ↓            ↓
     │          │            │           │          │            └── 🔴 DOES NOT EXIST
     │          │            │           │          └── 🔴 DOES NOT EXIST
     │          │            │           └── 🔴 NO VALIDATION. The learner updates
     │          │            │                  weights in production, from production.
     │          │            └── 🔴 NO TRAINING RUN. It learns ONLINE, on live signals,
     │          │                   with NO held-out set and NO validation split.
     │          └── 🔴 NO FEATURE STORE. Features are computed and DISCARDED.
     └── 🔴 NO HYPOTHESIS. No research plan. (015 Part 2)
```

## 🔴 The lifecycle is a single step

> **`confluence-learner.js` trains on the very signals it is steering, in production, with no held-out
> data, no validation split, and no calibration.**
>
> **There is no train/test boundary. There is no model version. There is no approval. It went from an
> idea to steering live (paper) signals with nothing in between.**

**Retirement: no mechanism exists.** A factor with a 20% hit rate cannot be removed, because nothing
evaluates it.

---

# PART 3 — MODEL GOVERNANCE

| Requirement | Present? |
|---|---|
| **Model versioning** | 🔴 **NO.** `confluence-weights.json` is overwritten in place. `seq` is a counter, not a version |
| **Training dataset** | 🔴 **NO.** It trains on live signals as they arrive |
| **Validation dataset** | 🔴 **DOES NOT EXIST. There is no held-out set** |
| **Configuration snapshot** | 🔴 **NO** |
| **Hyperparameters** | 🟡 `CONFLUENCE_LR` (learning rate) — **an env var, absent from `.env`, so it takes a hardcoded default** (004) |
| **Promotion criteria** | 🔴 **NONE.** No gate between "an idea" and "steering live signals" |
| **Rollback** | 🟡 **`confluence-weights.json.bak` exists** — **exactly one prior version** 🟢 (the only AI artefact with any history at all) |

## ## **Model provenance: UNKNOWN. 016's stop condition applies.**

---

# PART 4 — INFERENCE PIPELINE

```
  Market Data ──▶ 🔴 `|| 0` × 119. An unknown OI becomes zero OI. (006 §0)
       ↓
  Feature Extraction ──▶ 9 factors: trend · oi · volume · news · pcr · greeks · fii · iv · smartMoney
       ↓                  🔴 FEATURES ARE COMPUTED AND DISCARDED. No feature store.
       ↓                  ⇒ no inference can EVER be reproduced. Not now, not with 200 outcomes.
       ↓
  Model Input ──▶ 🔴 NO input summary is recorded.
       ↓
  Prediction ──▶ Σ (factor_score × learned_weight)
       ↓          🔴 including `fii` (n=0) and `volume` (n=0).
       ↓
  Confidence ──▶ 🔴 A NUMBER, NOT A MEASUREMENT. Never calibrated against outcomes.
       ↓          `signal-outcomes.json` records `prob: 76` — and NOTHING has ever
       ↓          checked whether a "76%" wins 76% of the time. (009 Part 7)
       ↓
  Risk Review ──▶ 🔴🔴 THIS STAGE DOES NOT EXIST. (013)
       ↓
  Decision Support ──▶ 🔴 7 of 8 engines emit raw BUY/SELL, bypassing engine-verdict.
       ↓
  Outcome Logging ──▶ 🟡 21 labelled trades. 🔴 no strategyId, no inputsHash. (010 §3)
```

---

# PART 5 — MODEL OBSERVABILITY

| Required per inference | Recorded? |
|---|---|
| Timestamp | 🟡 |
| **Model version** | 🔴 **DOES NOT EXIST** |
| **Feature version** | 🔴 **DOES NOT EXIST** |
| **Input summary** | 🔴 **NO — the features are thrown away** |
| Prediction | 🟢 |
| Confidence | 🟡 emitted — 🔴 **never validated** |
| **Decision context** | 🔴 **NO** |
| Outcome reference | 🟡 21 trades |

> **016's rule: *"Predictions without provenance are not reproducible."***
>
> ## **NOT ONE INFERENCE IN THIS PLATFORM IS REPRODUCIBLE.**
>
> **The features that produced a signal were computed, used, and discarded. Given a past prediction, it
> is impossible to determine what the model saw.** *(007 Part 8, 010 Part 8 — the same finding, from
> three directions.)*
>
> **This is also why AI readiness is permanently BLOCKED: you cannot calibrate, and you cannot train,
> on data you did not keep. Growing to 200 outcomes does NOT fix this. The features must be stored
> starting today, or the next 200 outcomes will be as unusable as the last 21.**

---

# PART 6 — AI SAFETY

| Control | Verdict |
|---|---|
| **Unknown input handling** | 🔴 **FAILS OPEN.** `|| 0` × 119 — an unknown OI is scored as zero OI, an unknown IV as zero volatility (006 §0) |
| **Missing feature handling** | 🔴 **FAILS OPEN.** `fii` and `volume` have **n = 0** and still carry weight. **A never-observed feature is treated exactly like a measured one** |
| **Model fallback** | 🔴 **NONE** |
| **Confidence thresholds** | 🟡 exist per engine — 🔴 **on an uncalibrated confidence** |
| **Model disable** | 🟡 `AI_AGENTS_ENABLED` — 🔴 **defaults to `true` and appears in NO config file** (004 C-10). **`confluence-learner` has no disable flag at all** |
| **Safe defaults** | 🔴 **NO.** The AI is ON by default, on evidence that does not exist |
| **Human override** | 🟡 `/api/risk/emergency-stop` — 🔴 **which stops 2 of 8 engines and is undone by a restart** (012 §0) |

## 🔴 The safety verdict

> **The platform's own first rule is *"Unknown ≠ Zero. Refuse rather than guess."***
>
> **The AI layer's central artefact assigns a weight of 10.08 to a factor it has never once observed.**
> **That is not "unknown treated as zero." That is unknown treated as CONFIDENT.**

---

# PART 7 — MODEL PERFORMANCE EVIDENCE

| Metric | Evidence available? |
|---|---|
| **Accuracy** | 🔴 **Measurable, and it is BELOW CHANCE.** 7 of 9 NIFTY factors are under 50% |
| **Precision / Recall** | 🔴 **NOT COMPUTED** |
| **Calibration** | 🔴 **NEVER PERFORMED.** A `prob: 76` has never been checked against outcomes |
| **Stability** | 🔴 **NOT MEASURED** |
| **Drift** | 🔴 **NO DETECTOR EXISTS** — and **drift against what baseline? None is calibrated** |
| **Robustness** | 🔴 **NOT TESTED** |

## ## 🔴 **BLOCKED — INSUFFICIENT EVIDENCE**

**21 labelled trades. 62 factor-observations for NIFTY, 46 for SENSEX, 22 for BANKNIFTY. Two factors at
zero. Against constraint M2's ~200, that is 10%.**

---

# PART 8 — FAILURE MODE REGISTER

| ID | Failure | Present? | Impact |
|---|---|---|---|
| **AI-1** | **A never-observed feature steers a decision** | 🔴 **CONFIRMED — `fii`, `volume`** | **CRITICAL. Fabricated confidence** |
| **AI-2** | **A below-chance factor is weighted positively** | 🔴 **CONFIRMED — 7 of 9** | **CRITICAL. `oi` at 20% is an 80%-accurate contra-indicator** |
| **AI-3** | **Online training in production, no held-out set** | 🔴 **CONFIRMED** | **CRITICAL. There is no validation boundary** |
| **AI-4** | **Missing features** | 🔴 **`|| 0` — become zero, not `null`** | HIGH |
| **AI-5** | **No feature store ⇒ no inference is reproducible** | 🔴 **CONFIRMED** | **CRITICAL. Permanently blocks calibration and ML** |
| **AI-6** | **Uncalibrated confidence shipped as a probability** | 🔴 **CONFIRMED — `prob: 76`** | HIGH |
| **AI-7** | **An unmeasured reliability claim in a live path** | 🔴 **CONFIRMED — `candlestick-patterns.js:344` `"backtest-grounded"`, and no such backtest exists** | HIGH |
| **AI-8** | **Version mismatch / corrupted weights** | 🟢 **`confluence-weights.json.bak` exists** — **the only AI rollback in the platform** | LOW |
| **AI-9** | **LLM inference failure** | 🟡 `try/catch` — often an **empty catch** | MEDIUM |

---

# PART 9 & 10 — AI ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   FeatureStore  ★★★  THE PREREQUISITE FOR EVERYTHING ELSE.
     Every inference stores its inputs: featureVersion · values · ts · inputsHash.
     🔴 WITHOUT THIS, NO CALIBRATION AND NO ML IS EVER POSSIBLE —
        not at 21 outcomes, not at 200, not at 10,000.
     🔴 START STORING TODAY. Every day of delay is permanently lost. → kills AI-5

   ModelRegistry  ★
     modelId · version · trainedOn(datasetHash) · validatedOn(held-out) ·
     metrics · approvedBy · supersededBy
     🔴 A model WITHOUT a registry entry may not run.

   InferenceEngine
     🔴 A FEATURE WITH n = 0 CONTRIBUTES ZERO. It does not get a default weight.
     🔴 A FEATURE BELOW CHANCE IS REPORTED, NOT SILENTLY WEIGHTED POSITIVE.
     🔴 reliability: null ⇒ weight 0 ⇒ VETO-ONLY.  ← engine-verdict.js ALREADY SAYS THIS.
                                                     → kills AI-1, AI-2, §0.3

   CalibrationLayer  ★
     predicted p vs realised frequency, per bin.
     🔴 A confidence that has never been calibrated may not be published as a probability.
                                                     → kills AI-6

   DecisionSupport   PROPOSES. Never places. Never sizes. Never touches capital.

   AIAuditLog  ★     every inference: ts · modelVersion · featureVersion ·
                     inputsHash · prediction · confidence · outcomeRef.
```

## The one rule that would have prevented §0

> **A weight is a claim about evidence. A factor with n = 0 has no evidence, and therefore no weight.**
> **`engine-verdict.js` states this correctly and is enforced by 114 assertions. The one component that
> learns does not use it.**

---

# PART 11 — TESTING STRATEGY

| Test | Priority | Would it fail today? |
|---|---|---|
| 🔴 **A factor with `n = 0` contributes ZERO weight** | **P0** | ✅ **FAILS — `fii` 10.08, `volume` 8.06** |
| 🔴 **A factor below chance is reported, not silently weighted positive** | **P0** | ✅ **FAILS — 7 of 9** |
| 🔴 **Every inference stores its inputs (`inputsHash`)** | **P0** | ✅ **FAILS — no feature store** |
| 🔴 **No module publishes a `reliability` it did not measure** | **P0** | ✅ **FAILS — `candlestick-patterns.js:344`** |
| 🔴 **A published `prob: N` has been calibrated against outcomes** | **P0** | ✅ **FAILS — never calibrated** |
| **`confluence-learner` has a disable flag** | P1 | ✅ **FAILS — none exists** |
| **Corrupt weights ⇒ recover from `.bak`** | P1 | 🟢 **would pass — assert it** |
| **Inference is reproducible from stored features** | P1 | ✅ FAILS |

**Five P0 AI-safety tests. Every one fails against the running system.**

---

# PART 12 — AI MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Experimental** | 🟢 | A learner exists and runs |
| **1 — Managed Models** | 🔴 **NO** | **No model registry. No version. No approval. No disable flag** |
| **2 — Governed Training** | 🔴 **NO** | **Online training in production. No held-out set. No validation split** |
| **3 — Observable Inference** | 🔴 **NO** | **No inference is reproducible — the features are discarded** |
| **4 — Evidence-Based Decisions** | 🔴 **NO** | **Two factors vote on ZERO evidence. Seven of nine are below chance** |
| **5 — Production Candidate** | 🔴 **NO** | — |

## ## **AI Infrastructure: LEVEL 0 — EXPERIMENTAL.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE — this document** | — | none | 1 live learner, 0 ML models, 0 feature store |
| **2 — Model governance** | 🔴 **A factor with `n = 0` contributes ZERO** — enforce `engine-verdict`'s own rule in `confluence-learner`. 🔴 **Add a disable flag.** Version the weights | Phase 1 | **🔴 BEHAVIOUR CHANGE: `fii` and `volume` stop voting, and the below-chance factors get exposed. THAT IS THE POINT.** Approval | **No factor votes without evidence** |
| **3 — Inference governance** | 🔴 **BUILD THE FEATURE STORE. Store every inference's inputs, starting today** | Phase 2 | **Low — purely additive** | **Every inference is reproducible.** *This is the single most time-critical item in the entire audit programme — the data is being destroyed daily* |
| **4 — Observability** | `AIAuditLog`. `modelVersion` + `featureVersion` on every prediction | Phase 3 | Low | *"Why did the model say 76%?"* becomes answerable |
| **5 — Evidence-based readiness** | Calibration layer. Held-out validation. Grow **21 → 200** labelled outcomes **WITH their features** | Phase 4 | **Time. Cannot be shortcut** | **A published confidence has been measured** |

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every model has documented provenance | 🔴 **NO — the one live model has no version, no dataset, no approval** |
| Every prediction is reproducible | 🔴 **NO — the features are discarded** |
| **Confidence is evidence-based** | 🔴 **NO — two factors vote on n = 0; seven of nine are below chance** |
| Failures default to safe | 🔴 **NO — unknown becomes zero; unobserved becomes confident** |
| AI decisions are traceable | 🔴 **NO** |
| Model lifecycle is governed | 🔴 **NO — there is no lifecycle** |
| **Unsupported models cannot influence trading** | 🔴 **NO — the unsupported model IS the influence** |

## **0 of 7.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent ML engineer identify every model, reproduce every inference, verify
the evidence, and confirm that AI cannot influence trading without documented validation?**

## **They could identify it in one minute, and everything after that is no.**

**There is no machine learning in this platform.** No libraries, no models, no checkpoints. What is
called "AI" is **LLM API calls plus hand-tuned rule-based scorers** — **plus one thing that genuinely
learns, and it is live.**

> ## **`confluence-learner.js` steers the platform's signals with nine weighted factors.**
>
> **Two of them — `fii` and `volume` — have `n = 0`. They have never been observed, not once. Their
> combined weight is 18.14, which is more than the single highest-weighted factor.**
>
> **The highest-weighted factor, `trend` at 18.17, has been observed FIVE times: three right, two
> wrong.**
>
> **Seven of the nine NIFTY factors are BELOW CHANCE. `oi` sits at a 20% hit rate — meaning it is an
> 80%-accurate contra-indicator — and it is weighted POSITIVELY at 13.24.**
>
> **Total training evidence: 21 labelled trades.**

**And the platform already wrote the rule that forbids this:**

```js
engine-verdict.js:25   "reliability: null ⇒ weight 0 ⇒ VETO-ONLY.
                        An engine that has never been measured may not steer."
```

**It is correct. It is enforced by 114 assertions. It has one adopter — and the one component that
actually learns is not it.**

**Confidence: UNJUSTIFIED. Model performance: BLOCKED — INSUFFICIENT EVIDENCE. AI maturity: Level 0.**

**Two changes, in priority order:**

> **1. A factor with `n = 0` must contribute ZERO. This is the platform's own rule, applied to the one
> place it was never applied. It will silence `fii` and `volume`, and it will expose seven
> below-chance factors. Both are correct outcomes.**
>
> **2. BUILD THE FEATURE STORE — TODAY. Every inference currently computes its inputs, uses them, and
> throws them away. Without them, no calibration and no machine learning is possible — not at 21
> outcomes, not at 200, not ever. Every day this is not done, another day of the only honest evidence
> this platform generates is permanently destroyed.**

---

**Autonomous trading: NOT AUTHORIZED. Models trained: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** AI Inventory (Part 1) · Model Lifecycle (Part 2) · Model Governance (Part 3) ·
Inference Pipeline (Part 4) · Model Observability (Part 5) · AI Safety (Part 6) · Performance Evidence
(Part 7) · Failure Modes (Part 8) · Architecture & Contracts (Parts 9–10) · Testing Strategy (Part 11) ·
Maturity Assessment (Part 12) · Migration Roadmap (Part 13) · Executive Summary.
