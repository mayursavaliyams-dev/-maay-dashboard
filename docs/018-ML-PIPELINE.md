# 018 — MACHINE LEARNING PIPELINE, TRAINING GOVERNANCE & MODEL LIFECYCLE

**Standard:** Master Prompt 018 · **Depends on:** 000-A…E, 001-A…F, 002…016
*(Prompt 017 was not issued. This audit does not depend on it.)*
**Date:** 2026-07-12 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No model trained. No hyperparameter optimized.**

---

# SECTION 0 — THE FINDING

> ## 🟢 **THE LEARNING ALGORITHM IS CORRECT.**
> ## 🔴 **THE PIPELINE AROUND IT DOES NOT EXIST.**

## §0.1 — The algorithm, read line by line — **and it is legitimate**

```js
confluence-learner.js:131   const lr = clamp(Number(trade.lr) || LR_DEFAULT, 0.005, 0.3);
confluence-learner.js:142   const factor = helpful ? (1 + lr * strength) : (1 - lr * strength);
confluence-learner.js:143   st.weights[k] = clamp(before * factor, W_MIN, W_MAX);
confluence-learner.js:148   // re-normalise directional weights back to baseline sum → only the MIX shifts
```

**This is a multiplicative weight update with renormalisation** — the Hedge / exponentiated-gradient
family. It is bounded (`clamp`), it is stable (renormalised), and it is **a real, sound online-learning
algorithm.** It is not naive. **It works.**

## §0.2 — And every single thing a training pipeline requires is absent

**Measured, by direct count against `confluence-learner.js`:**

```
  train             0 occurrences
  test              0 occurrences
  split             0 occurrences
  holdout           0 occurrences
  validation        0 occurrences
  seed              0 occurrences
  epoch             0 occurrences
  batch             0 occurrences
  modelVersion      0 occurrences
  featureVersion    0 occurrences
  ────────────────────────────────
  TRAINING SET      21 trades      ← the entire dataset, ever
  LEARNING RATE     0.06           ← hardcoded; CONFLUENCE_LR is in no config file
```

> **There is no train/test split. There is no held-out set. There is no validation. There is no seed.
> There is no model version.**
>
> **The learner trains on the very signals it steered, in production, with no boundary of any kind
> between training data and evaluation data.**
>
> **Every weight in this model is an IN-SAMPLE fit to 21 observations — and the model is live.**

## §0.3 — 🔴 **THE RENORMALISATION MAKES THE UNOBSERVED FACTORS PERMANENT**

This is a **new** finding, and it is the sharpest one in this audit.

```js
confluence-learner.js:56    weights[k] = DEFAULT_WEIGHTS[k] || 8;   // every factor starts at a default
confluence-learner.js:148   // re-normalise directional weights back to baseline sum
                            // → only the MIX shifts
```

**`fii` (n = 0) and `volume` (n = 0) have never been observed, so their weights have never been
updated. They sit at their defaults — 10.08 and 8.06 — forever.**

**And because the weights are renormalised to a constant baseline sum, those two factors do not merely
fail to learn. They permanently consume 18.14 of a fixed weight budget** — **more than the
highest-weighted factor that *does* have evidence (`trend`, 18.17).**

> **The two factors with zero evidence are not just voting. They are structurally guaranteed to keep
> diluting the seven factors that DO have evidence, forever, by construction.**
>
> **No amount of additional training data fixes this. The renormalisation is what makes it permanent.**

---

# PART 1 — ML PIPELINE INVENTORY

| Component | Exists? | Owner | Evidence |
|---|---|---|---|
| **Dataset preparation** | 🔴 **NO** | — | The "dataset" is `confluence-weights.json.trades` — **21 rows, appended live** |
| **Feature selection** | 🟡 **HARDCODED** | — | 9 factors, fixed in `LEARNABLE`. **Never evaluated, never pruned** |
| **Data splitting** | 🔴 **DOES NOT EXIST** | — | 0 occurrences of split/holdout/validation |
| **Training** | 🟡 **ONLINE, IN PRODUCTION** | `confluence-learner.js` | Multiplicative weight update. 🟢 **Algorithm correct** |
| **Validation** | 🔴 **DOES NOT EXIST** | — | — |
| **Hyperparameter config** | 🟡 **ONE** — `CONFLUENCE_LR = 0.06` | — | 🔴 **Not in `.env`. Never tuned. Never recorded per run** |
| **Model registry** | 🔴 **DOES NOT EXIST** | — | `seq: 1021` is a counter, not a version |
| **Evaluation** | 🔴 **DOES NOT EXIST** | — | **Nothing ever scores the model.** *(016 §0: 7 of 9 factors are below chance, and nothing reports it)* |
| **Deployment prep** | 🔴 **N/A** | — | It is already deployed. It always was |
| **Model retirement** | 🔴 **NO MECHANISM** | — | A 20%-hit-rate factor cannot be removed, because nothing evaluates it |

**One of ten components exists, and it is the one in the middle.**

---

# PART 2 — TRAINING LIFECYCLE

```
 Dataset → Feature Store → Split → Training → Validation → Calibration →
 Evaluation → Model Registry → Approval → Inference → Retirement
    ↓            ↓             ↓        ↓          ↓           ↓
    │            │             │        │          │           └── 🔴 NONE
    │            │             │        │          └── 🔴 NONE
    │            │             │        └── 🟢 THE ONLY STAGE THAT EXISTS
    │            │             └── 🔴 NONE — no train/test boundary at all
    │            └── 🔴🔴 NO FEATURE STORE. Features are computed and DISCARDED.
    │                   ⇒ NO training run can ever be reproduced. Ever.
    └── 🔴 NO DATASET. 21 rows, appended live, unversioned.

 Entry/exit criteria documented for: ZERO stages.
```

## The lifecycle collapses to a single arrow

> **`inference → training → inference`, in a loop, in production, on live signals, with no
> validation boundary, no version, and no approval.**
>
> **The model that is steering today's signals is the model that was trained on yesterday's — and there
> is no artefact recording either.**

---

# PART 3 — DATASET GOVERNANCE

| Requirement | Present? |
|---|---|
| **Dataset versioning** | 🔴 **NO.** `confluence-weights.json` is overwritten in place |
| **Training dataset** | 🟡 **21 rows, live-appended, unversioned** |
| **Validation dataset** | 🔴 **DOES NOT EXIST** |
| **Test dataset** | 🔴 **DOES NOT EXIST** |
| **Time-based splits** | 🔴 **DOES NOT EXIST** — 🔴 **and for a time-series problem this is the one split that matters** |
| **Data provenance** | 🔴 **NO.** No `datasetHash`, no `gitSha` |
| **Dataset documentation** | 🔴 **NO** |

## The training row, in full

```json
{ "id": 1001, "inst": "NIFTY", "decision": "BUY", "result": "LOSS",
  "score": 91, "pnl": null, "at": 1782848955163,
  "changes": { "trend": { "agreed": true, "helpful": false, "from": 18, "to": 17.35, ... } } }
```

🟢 **The row is well-formed** — it records the decision, the outcome, the score, and **the exact weight
delta the update produced.** That is genuinely good telemetry.

🔴 **But: `pnl: null`.** The label is `WIN`/`LOSS` only — **magnitude is discarded.** A one-rupee win and
a fifty-thousand-rupee loss are the same training signal.

🔴 **And `score: 91 → LOSS`.** A signal the model rated **91** lost. **That single row is the calibration
problem in miniature — and nothing anywhere measures it.** *(016 Part 7: calibration has never been
performed.)*

🔴 **The features are NOT in the row.** `changes` records which factors *moved*, not what they *saw*.
**The inference cannot be reproduced from the training row.**

## ## **Dataset provenance: UNKNOWN. Reproducibility: NOT POSSIBLE.**

---

# PART 4 — TRAINING GOVERNANCE

| Requirement | Present? |
|---|---|
| **Configuration management** | 🔴 **NO** |
| **Hyperparameter tracking** | 🔴 **NO.** `LR = 0.06` is a literal. **It is not in `.env`, not in `config-overrides.json`, and not recorded on any training row** |
| **Random seed control** | ⚪ **N/A — the update is deterministic.** 🟢 **Given the same trade sequence, the same weights result** |
| **Environment reproducibility** | 🟡 `package-lock.json` 🟢 · no Node pin, no container |
| **Dependency management** | 🟢 `package-lock.json` |
| **Model versioning** | 🔴 **NO.** `seq` counts trades; it does not version the model |

## 🟡 The one honest bright spot

> **Training IS deterministic.** No randomness, no shuffling, no seed needed. **Replay the same 21
> trades in the same order and you get the same weights, exactly.**
>
> **But you cannot replay them**, because the *inputs* those trades saw were never stored (§0.2, and
> 016 Part 5). **Determinism without a feature store is reproducibility you cannot invoke.**

---

# PART 5 — MODEL EVALUATION

| Evaluation | Classification | Evidence |
|---|---|---|
| **Classification metrics** | 🔴 **MISSING as a pipeline stage** — 🟡 **but computable from `stats`, and I computed them (016 §0):** 7 of 9 NIFTY factors below chance; `oi` 20%; `news` 20% |
| **Regression metrics** | 🔴 **N/A** — `pnl: null`; magnitude is discarded |
| **Calibration** | 🔴 **MISSING.** A `score: 91` that lost has never been checked against a `prob: 76` that won |
| **Stability** | 🔴 **MISSING** |
| **Robustness** | 🔴 **MISSING** |
| **Drift assessment** | 🔴 **MISSING** — 🔴 **and drift against what baseline? None was ever established** |
| **Error analysis** | 🔴 **MISSING** |

## ## **Evaluation stage: DOES NOT EXIST.**

> **The model's own `stats` object contains everything needed to discover that seven of its nine
> factors are worse than a coin flip. Nothing reads it. No dashboard shows it. No test asserts it.**
>
> **The evidence of failure is sitting in the model's own file, and no component in this platform is
> looking at it.**

---

# PART 6 — MODEL REGISTRY

| Capability | Present? |
|---|---|
| **Model identity** | 🔴 **NO** |
| **Version history** | 🔴 **NO** — overwritten in place |
| **Metadata** | 🟡 `stats` per factor 🟢 — **the best metadata in the platform, and it is unread** |
| **Promotion status** | 🔴 **NO.** It went from idea to live with no gate |
| **Rollback** | 🟢 **`confluence-weights.json.bak` — exactly one prior version.** *(The only ML rollback that exists)* |
| **Retirement** | 🔴 **NO MECHANISM** |

## ## **Model registry: DOES NOT EXIST. Governance maturity: NONE.**

---

# PART 7 — OBSERVABILITY

| Required per training run | Recorded? |
|---|---|
| **Training ID** | 🔴 **NO** |
| **Dataset version** | 🔴 **NO** |
| **Feature version** | 🔴 **NO** |
| **Configuration** | 🔴 **NO — the LR is not recorded on any row** |
| **Random seed** | ⚪ N/A |
| **Environment** | 🔴 **NO** |
| **Model version** | 🔴 **NO** |
| **Evaluation summary** | 🔴 **NO** |
| 🟢 **Weight delta per update** | 🟢 **YES — `changes: {from, to, agreed, helpful}`.** **This is genuinely excellent, and it is the only training telemetry in the platform** |

> **018's rule: *"Training without provenance is not reproducible."***
> ## **→ ZERO of eight required fields. NOT REPRODUCIBLE.**

---

# PART 8 — FAILURE MODE REGISTER

| ID | Failure | Present? | Impact |
|---|---|---|---|
| **ML-1** | **No train/test split — the model is fit in-sample and deployed** | 🔴 **CONFIRMED** | **CRITICAL. Every weight is an in-sample fit to 21 rows** |
| **ML-2** | **Unobserved factors permanently dilute observed ones** | 🔴 **CONFIRMED — §0.3** | **CRITICAL. The renormalisation makes it structural and permanent** |
| **ML-3** | **No feature store ⇒ no training run is reproducible** | 🔴 **CONFIRMED** | **CRITICAL. Unfixable retroactively** |
| **ML-4** | **The evaluation evidence exists and nothing reads it** | 🔴 **CONFIRMED** | **HIGH. 7 of 9 factors below chance, in the model's own file** |
| **ML-5** | **Magnitude discarded (`pnl: null`)** | 🔴 **CONFIRMED** | HIGH. A ₹1 win == a ₹50,000 loss as a training signal |
| **ML-6** | **Hyperparameter not tracked** | 🔴 **CONFIRMED** | MEDIUM |
| **ML-7** | **Corrupted weights** | 🟢 **`.bak` exists** | LOW |
| **ML-8** | **No retirement mechanism** | 🔴 **CONFIRMED** | HIGH. A 20%-hit-rate factor cannot be removed |
| **ML-9** | **Training interruption / restart** | 🟡 weights persist via `safe-write` 🟢 | LOW |

---

# PART 9 & 10 — ML ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   FeatureStore  ★★★   THE PREREQUISITE. NOTHING ELSE IS POSSIBLE WITHOUT IT.
     Every inference persists: featureVersion · values · inputsHash · ts
     🔴 START TODAY. Retroactively unfixable. Every day destroys another day of evidence.

   DatasetRegistry  ★  datasetHash → an IMMUTABLE snapshot.
                       🔴 A TIME-BASED SPLIT IS MANDATORY for a time-series problem.
                          train: t < T.  validate: t ≥ T.  Never shuffled.

   TrainingOrchestrator  ★
     🔴 TRAINING IS AN OFFLINE RUN over a FROZEN dataset. It is NOT a side effect of inference.
     Records: trainingId · datasetHash · featureVersion · hyperparams · gitSha · metrics

   EvaluationEngine  ★
     🔴 A FACTOR WITH n < N_MIN CONTRIBUTES ZERO. It does not hold a default share.
     🔴 A FACTOR BELOW CHANCE IS REPORTED AND RETIRED, not silently renormalised around.
                                                            → kills §0.3, ML-2, ML-4, ML-8
   ModelRegistry  ★    modelId · version · trainedOn · validatedOn · metrics · approvedBy
                       🔴 A model without a registry entry MAY NOT RUN.

   PromotionPipeline   🔴 A model may not steer live signals until it has beaten a
                          held-out baseline. Today: no baseline, no held-out set, no gate.
```

## The one rule that would have prevented every finding here

> **Training must be an offline run over a frozen dataset, evaluated on data it has never seen.**
> **The moment training becomes a side effect of inference, there is no such thing as an out-of-sample
> result — and every number the model produces about itself becomes a description of its own memory.**

---

# PART 11 — TESTING STRATEGY

| Test | Priority | Would it fail today? |
|---|---|---|
| 🔴 **A factor with `n < N_MIN` contributes ZERO weight — and is EXCLUDED from renormalisation** | **P0 — §0.3** | ✅ **FAILS** |
| 🔴 **Every inference stores its features (`inputsHash`)** | **P0 — ML-3** | ✅ **FAILS** |
| 🔴 **Training runs on a FROZEN dataset, evaluated on a held-out split** | **P0 — ML-1** | ✅ **FAILS** |
| 🔴 **A factor below chance is reported** | **P0 — ML-4** | ✅ **FAILS — the evidence is in the file and unread** |
| 🔴 **Every training run records `{trainingId, datasetHash, hyperparams, gitSha}`** | **P0** | ✅ **FAILS — 0 of 8 fields** |
| **Replaying the same trade sequence reproduces the same weights** | P1 | 🟢 **would pass — assert it, it is a real strength** |
| **Corrupt weights ⇒ recover from `.bak`** | P1 | 🟢 would pass |

**Five P0 tests. All five fail.**

---

# PART 12 — ML MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Experimental** | 🟢 | A learner exists, runs, and its algorithm is sound |
| **1 — Managed Training** | 🔴 **NO** | **No training run exists. Training is a side effect of inference** |
| **2 — Reproducible Pipeline** | 🔴 **NO** | **No feature store ⇒ no run can ever be reproduced** |
| **3 — Governed Models** | 🔴 **NO** | **No registry, no version, no promotion gate, no retirement** |
| **4 — Observable Lifecycle** | 🔴 **NO** | **0 of 8 provenance fields** |
| **5 — Production Candidate** | 🔴 **NO** | — |

## ## **ML Pipeline: LEVEL 0 — EXPERIMENTAL.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE — this document** | — | none | 1 of 10 pipeline components exists |
| **2 — Dataset governance** | 🔴 **BUILD THE FEATURE STORE — TODAY.** Persist every inference's inputs. **A time-based split** (`t < T` train, `t ≥ T` validate) | none | **Low — purely additive** | **Every inference's inputs are on disk.** ⚠️ **THE MOST TIME-CRITICAL ITEM IN THE ENTIRE AUDIT PROGRAMME — the evidence is being destroyed daily** |
| **3 — Training governance** | 🔴 **A factor with `n < N_MIN` contributes ZERO and is EXCLUDED from renormalisation.** Move training offline, over a frozen dataset | Phase 2 | 🔴 **BEHAVIOUR CHANGE: `fii` and `volume` stop voting; the below-chance factors get exposed. Both are correct.** Approval | **No in-sample weight steers a live signal** |
| **4 — Model registry** | `modelId`, version, `trainedOn`, `validatedOn`, `approvedBy`. **Retirement for below-chance factors** | Phase 3 | Low | **A model without a registry entry cannot run** |
| **5 — Deployment readiness** | Held-out baseline. Calibration. Promotion gate | Phase 4 | **Time — cannot be shortcut** | **A model may not steer until it has beaten a baseline on data it has never seen** |

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every training run is reproducible | 🔴 **NO — the features were discarded** |
| Datasets are versioned | 🔴 **NO — 21 rows, overwritten in place** |
| Models have complete provenance | 🔴 **NO — 0 of 8 fields** |
| **Evaluation is evidence-based** | 🔴 **NO — the evaluation stage does not exist, and the evidence sits unread in the model's own file** |
| Registry governance is explicit | 🔴 **NO — no registry** |
| Training history is auditable | 🟡 **Weight deltas ARE recorded per trade — genuinely good — but nothing else is** |
| **Unsupported models cannot be promoted** | 🔴 **NO — the unsupported model is already live** |

## **0 of 7.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent ML engineer reproduce every training run, verify every dataset,
inspect every model version, and audit the lifecycle?**

## **No — and the reason is not that the machine learning is bad. It is that there is no pipeline around it.**

🟢 **What is genuinely good, and should be preserved:**

- **The learning algorithm is correct.** A bounded, renormalised, multiplicative weight update —
  the Hedge / exponentiated-gradient family. **It is a real online-learning algorithm and it works.**
- **Training is deterministic.** Same trades, same order, same weights. No seed needed.
- **The per-update telemetry is excellent.** Every training row records the exact weight delta:
  `{from: 18, to: 17.35, agreed: true, helpful: false}`. **This is better telemetry than most production
  ML systems have.**
- **`confluence-weights.json.bak`** — the only ML rollback in the platform.

🔴 **And then everything else:**

> **There is no train/test split, no held-out set, no validation, no seed, no model version, no
> registry, no evaluation stage, no calibration, no drift detection, and no retirement mechanism.
> Measured directly: `train`, `test`, `split`, `holdout`, `validation`, `seed`, `epoch`, `batch`,
> `modelVersion`, `featureVersion` — **zero occurrences of each.**
>
> **Training is not a run. It is a side effect of inference. The model trains on the very signals it
> steered, and every weight it holds is an in-sample fit to twenty-one observations.**

**And the sharpest finding, which is new:**

> **`fii` and `volume` have never been observed — `n = 0` — so their weights have never moved. They sit
> at their defaults, 10.08 and 8.06.**
>
> **And because the weights are RENORMALISED to a constant baseline sum, those two factors do not
> merely fail to learn. They are STRUCTURALLY GUARANTEED to keep consuming 18.14 of a fixed weight
> budget — more than the highest-weighted factor that actually has evidence — diluting the seven
> factors that DO, forever, by construction.**
>
> **No quantity of future data fixes this. The renormalisation is what makes it permanent.**

**And the evidence of all of it is sitting in the model's own file. `stats` contains `oi: {correct: 2,
wrong: 8}`. Nothing reads it. No dashboard shows it. No test asserts it. The model is telling anyone who
opens the file that seven of its nine factors are worse than a coin flip — and no component in this
platform is listening.**

**The single most time-critical action in the entire audit programme:**

> ## **BUILD THE FEATURE STORE. TODAY.**
>
> **Every inference computes its inputs, uses them, and throws them away. Without them, no training run
> can ever be reproduced, no model can ever be validated, and no confidence can ever be calibrated —
> not at 21 outcomes, not at 200, not at ten thousand.**
>
> **This is the one defect in this entire programme that gets permanently worse every single day it is
> not fixed. Every other finding can be fixed tomorrow with the same effort as today. This one cannot.**

---

**Models trained: NONE. Hyperparameters optimized: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** ML Pipeline Inventory (Part 1) · Training Lifecycle (Part 2) · Dataset Governance
(Part 3) · Training Governance (Part 4) · Model Evaluation (Part 5) · Model Registry (Part 6) ·
Observability (Part 7) · Failure Modes (Part 8) · Architecture & Contracts (Parts 9–10) · Testing
Strategy (Part 11) · Maturity Assessment (Part 12) · Migration Roadmap (Part 13) · Executive Summary.
