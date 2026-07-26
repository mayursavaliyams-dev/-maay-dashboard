# 048 — PROBABILITY CALIBRATION, RELIABILITY ENGINEERING & DECISION CONFIDENCE GOVERNANCE

**Standard:** Master Prompt 048 · **Depends on:** 000-A … 047
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No accuracy improved. No model outputs changed.**

**048's stop condition: *"Never present a confidence score as a calibrated probability unless that
relationship has been empirically demonstrated."***

**046 found the fusion "probability" is a hand-tuned affine heuristic. 048 goes to the one place in the
platform where a real probability meets a real outcome — `data/signal-outcomes.json` — and computes, for
the first time, Brier · Log Loss · ECE · MCE.**

**The result is the strangest finding in forty-eight documents: the probability is roughly RIGHT, and it
is the WRONG NUMBER.**

---

# ═══════════════════════════════════════════════════════════
# SECTION 0 — THE PLATFORM SOLVED THE WRONG PROBLEM CORRECTLY
# ═══════════════════════════════════════════════════════════

## §0.1 — 🔴 There is no calibration step. There is a unit conversion named like one.

**`data/signal-outcomes.json` carries two probability fields — `rawP` and `prob`. A reader would take
`rawP` as the model's raw score and `prob` as the CALIBRATED probability. Measured:**

```
     rawP        prob
   0.7611   →     76
   0.6050   →     61
   0.6900   →     69
   0.6843   →     68
   0.6734   →     67
   0.7433   →     74
```

> ## 🔴 **`prob` IS `Math.round(rawP × 100)`.**
>
> **No Platt scaling. No isotonic regression. No reliability curve. No calibration of any kind. The field
> that reads as "the calibrated probability" is the raw score expressed as a percentage.**
>
> **048's stop condition, verbatim: *"Never present a confidence score as a calibrated probability unless
> that relationship has been empirically demonstrated."* The relationship was never demonstrated. It was
> never even attempted. It was renamed.**

## §0.2 — The first calibration metrics ever computed on this platform

**12 labelled outcomes — the entire calibratable evidence base:**

```
   estimator                    Brier    LogLoss     ECE      MCE
   ──────────────────────────────────────────────────────────────────
   rawP  (raw model score)     0.1770    0.5401   0.0680   0.2389
   prob  (after "calibration") 0.1773    0.5405   0.0675   0.2400   ◀── WORSE than rawP
   CONSTANT = base rate        0.1875    0.5623   0.0000   0.0000
   ──────────────────────────────────────────────────────────────────
   (lower is better on all four)

   Brier Skill Score vs a constant predictor:  BSS = 1 − 0.1773/0.1875 = 0.054
```

**Two honest readings:**

> **🟡 The model has a Brier Skill Score of **+0.054** over a constant. That is *positive*, and it is
> *tiny*, and it is computed on **twelve** samples. Audit 019 already proved what twelve samples do: they
> produced an AUC of 0.685 that looked like skill and was chance (permutation p = 0.191). I will not claim
> skill here, and I will not claim its absence. **n = 12 supports neither.***
>
> **🔴 The "calibration" step makes the Brier score marginally WORSE (0.1770 → 0.1773) — because rounding a
> probability to the nearest whole percent discards information. It is a rounding error, not a scandal.
> But it is worth stating plainly: the only transformation the platform applies to a probability makes it
> very slightly worse, and it is named as though it makes it better.**

## §0.3 — 🔴 **AND NOW THE FINDING THAT MATTERS**

**The probability is approximately correct:**

```
   P(win) reported (mean of rawP) :  68.2%
   P(win) ACTUALLY observed       :  75.0%      ◀── the model is roughly right. If anything, modest.
```

**And here is what the same twelve trades did in rupees:**

```
   mean WIN     :  ₹  1,476     (9 trades)
   mean LOSS    :  ₹ −4,260     (3 trades)
   🔴 loss / win ratio :  2.89 ×

   EXPECTANCY  =  0.75 × 1,476  +  0.25 × (−4,260)  =  🔴 ₹ 41.90 per trade
   total realised over all 12 trades               =  🔴 ₹ 503
```

> ## 🔴 **A 75%-WIN STRUCTURE THAT LOSES 2.89× WHAT IT WINS IS A COIN FLIP IN RUPEES.**
>
> **Twelve trades. Nine wins. A win rate that the model predicted almost perfectly. And the entire
> enterprise netted **₹503** — about forty-two rupees a trade.**
>
> ## **THE PLATFORM DISPLAYS P(win). P(win) IS NOT THE DECISION-RELEVANT QUANTITY. EXPECTANCY IS. And nothing in `master-confluence.js` computes expectancy — it computes, ranks, colours, and badges a probability that, on this evidence, is nearly orthogonal to whether you make money.**
>
> **"76% probability · VERY HIGH conviction" is, on this data, **TRUE AND USELESS**. The user is being shown
> a number that is calibrated and irrelevant, in a font size that implies it is the answer.**

**This is the same disease audit 045 found in the strangle from the opposite direction — a 59.4% win rate
with a payoff ratio of 0.99, and a kurtosis of 30.6. High win rates on asymmetric payoffs are the
signature of premium selling, and the win rate is precisely the statistic that hides the risk.**

> ## **The platform reports the number that makes a premium-selling strategy look safe, and does not report the number that would show it is not.**

## §0.4 — 🔴 And the evidence base covers ONE structure

```
   structures in the entire calibration dataset:   IRON_CONDOR
   n = 12
```

**Zero calibration evidence exists for the short strangle (the ₹7 lakh allocation), the directional
engines, the gamma-blast engine, the AI agents, the pattern signals, or the confluence fusion — which is
the model whose "probability" is displayed on six dashboards.**

## 🔴 **The only model the platform has EVER calibrated is not the model it shows you.**

---

# PART 1 — PROBABILITY INVENTORY

| ID | Output | Source | Mathematical meaning | Calibration evidence | Confidence in the calibration |
|---|---|---|---|---|---|
| 🔴 **P-1** | **`probability` (fusion)** | `master-confluence.js:103` | 🔴 **`50 + |net|/100 × 45 × (0.55+0.45·agreement)`. NOT a likelihood** | 🔴 **NONE — 20 of 21 confidences discarded** *(046)* | 🔴 **ZERO** |
| 🔴 **P-2** | **`conviction`** | `:124` | 🔴 **a threshold on P-1. "VERY HIGH" ≥ 85** | 🔴 **NONE** | 🔴 **ZERO** |
| 🟡 **P-3** | **`prob` (meta-label)** | `signal-outcomes.json` | 🔴 **`Math.round(rawP × 100)` — a unit conversion (§0.1)** | 🟡 **n = 12, ONE structure** | 🔴 **INSUFFICIENT — 019: p = 0.191** |
| 🔴 **P-4** | **leg `confidence`** | `:56` | 🔴 **DEFAULTS TO 60 when absent — a fabricated number that scales the leg's weight** | 🔴 **NONE** | 🔴 **ZERO. `Unknown ≠ 60`** |
| 🔴 **P-5** | **`agreement` → confidence** | `:103` | 🔴 **assumes agreement ⇒ correctness** | 🔴 **NEVER TESTED. 047: p = 0.209, and the only unanimous call LOST** | 🔴 **ZERO** |
| 🔴 **P-6** | **`riskPenalty`** | `:113` | 🔴 **`(sev/100) × 10 + (sev≥75 ? 6 : 0)` — hand-chosen** | 🔴 **NONE** | 🔴 **ZERO** |
| 🟢 **P-7** | **`agents-engine` impact prob** | `agents-engine.js` | 🟢 **PARAMETERS DISCLOSED in the header** | 🟢 **`MOVE_CALIBRATION = 0.4`, fitted on 33 real outcomes** | 🟢 **THE ONLY GENUINELY CALIBRATED OUTPUT** |
| 🔴 **P-8** | **`confluence-learner` weights** | learned | 🔴 33.8% correct over 130 obs | 🔴 **NEVER VALIDATED** *(041)* | 🔴 **ZERO** |

## **8 probability outputs. ONE has a documented, measured calibration — and it is `agents-engine`, the one nobody asked to do it.**

---

# PART 2 — CONFIDENCE LIFECYCLE

```
  Prediction              🟢
       ↓
  Raw Score               🟢  net ∈ [−100, 100]
       ↓
  🔴 Probability Mapping  🔴🔴  ══ A HAND-TUNED AFFINE TRANSFORM. Constants: 50, 45, 0.55, 0.45 ══
       ↓
  🔴 CALIBRATION          🔴🔴  ══ DOES NOT EXIST. `prob` = Math.round(rawP × 100). §0.1 ══
       ↓
  🔴 Reliability Asmt.    🔴🔴  ══ NEVER PERFORMED. This document is the first. ══
       ↓
  Decision Support        🔴  the number GATES decisions (< 58 → HOLD) and sits on 6 dashboards
       ↓
  Outcome Observation     🟡  outcomes ARE recorded — but 20 of 21 discard the confidence shown  (046)
       ↓
  🔴 Calibration Review   🔴  NEVER. Not once.
       ↓
  Audit                   🔴  no calibration version, no calibration dataset, no review history
```

## 🔴 **Nine stages. Three of them — mapping, calibration, review — are the ones that turn a score into a probability. One is a heuristic and two do not exist.**

---

# PART 3 — CALIBRATION GOVERNANCE

| Method | Used by the platform? | Computed in this audit? |
|---|---|---|
| Reliability diagram | 🔴 **NO** | 🟡 4-bin, n=12 — too thin to plot honestly |
| Calibration curve | 🔴 **NO** | 🔴 **n = 12. UNKNOWN** |
| **Brier Score** | 🔴 **NO** | 🟢 **0.1773 (prob) vs 0.1875 (constant). §0.2** |
| **Expected Calibration Error** | 🔴 **NO** | 🟢 **ECE = 0.0675** |
| **Maximum Calibration Error** | 🔴 **NO** | 🟢 **MCE = 0.2400** |
| **Log Loss** | 🔴 **NO** | 🟢 **0.5405 vs 0.5623 (constant)** |

## 🔴 **The platform uses NONE of the six. All four computable metrics were computed for the first time today, in an audit, on twelve samples of one structure.**

**And 048 asks explicitly which cannot be verified:**

> **🔴 CANNOT BE VERIFIED: P-1 (`probability`), P-2 (`conviction`), P-4 (leg confidence), P-5 (agreement),
> P-6 (risk penalty), P-8 (learner weights). Six of eight probability outputs have NO calibration evidence
> and cannot acquire any, because the confidence they emitted was never persisted (046 §0.2).**

---

# PART 4 — RELIABILITY ENGINEERING

| Reliability dimension | Measured? |
|---|---|
| **Prediction reliability** | 🟡 **n = 12, one structure. BSS = +0.054 — indistinguishable from noise** |
| 🔴 **Regime-specific reliability** | 🔴 **UNKNOWN — and 045 measured the strategy LOSING MONEY at realised vol ≥ 15%. The confidence has no idea** |
| 🔴 **Time-varying reliability** | 🔴 **UNKNOWN — 045: 71% of all strangle profit came from 2025 alone** |
| 🔴 **Feature-dependent reliability** | 🔴 **UNKNOWN — the model cannot say "trust me less when `oi` is loud", and 047 shows `oi` is loud 19 times in 21 and 20% accurate** |
| 🔴 **Model-specific reliability** | 🔴 **UNKNOWN for 6 of 8 outputs** |
| 🔴 **Ensemble reliability** | 🔴 **UNKNOWN — 047: N_eff = 3.71 of 7; the `agreement` term was never tested** |
| 🔴 **Operational reliability** | 🔴 **THE BOT IS DOWN (INC-001) and has been for the second half of this programme** |

## **7 dimensions. 1 partially measured on 12 samples. Per 048: unknown reliability remains UNKNOWN.**

---

# PART 5 — UNCERTAINTY GOVERNANCE

| Uncertainty type | Represented? |
|---|---|
| 🔴 **Aleatoric (irreducible noise)** | 🔴 **NO — the platform reports a point estimate, never an interval** |
| 🔴 **Epistemic (model ignorance)** | 🔴 **NO — AND THIS IS THE CORE FAILURE. An `n=0` leg (`volume`, `fii`) renders identically to an `n=130` leg** *(041/047)* |
| 🔴 **Unknown conditions** | 🔴 **NO regime awareness of any kind** |
| 🔴 **Out-of-distribution inputs** | 🔴 **NO OOD detection. High-vol regimes — where the strategy LOSES — are not flagged** |
| 🔴 **Low-evidence situations** | 🟡 **PARTIAL — `minFactors: 4` blocks a decision on too few legs. 🟢 That is real and correct.** 🔴 **But a leg with 4 observations and a leg with 130 are weighted identically** |

> ## 🔴 **048: *"Confidence should never conceal uncertainty."* This platform's confidence conceals uncertainty as its primary function. A factor with ZERO observations contributes a weight to the consensus and appears on screen as a number, indistinguishable from a factor with a hundred and thirty. The interface has no way to say "I don't know."**

---

# PART 6 — EVIDENCE REVIEW

| Every confidence claim must record | Present? |
|---|---|
| Validation dataset · Calibration dataset · Observation period · Statistical evidence · Known limitations · Review history | 🔴 **0 of 6 — for 7 of 8 outputs** |
| **Exception: `agents-engine`** | 🟢 **4 of 6** — dataset (33 scored outcomes), evidence (3.85% predicted vs 1.42% realised), limitation ("the raw heuristic overshoots"), and a maintenance instruction ("re-fit as the archive grows") |

## 🔴 **048: *"Confidence without supporting evidence is not considered calibrated."* Seven of eight probability outputs in this platform are, by that definition, UNCALIBRATED — including every single one that reaches a dashboard.**

---

# PART 7 — OBSERVABILITY

| Every probability component must record | Present? |
|---|---|
| Model version · **Calibration version** · Dataset version · Confidence output · Calibration status · Timestamp · Review status | 🔴 **1 of 7 (timestamp)** |

**There is no calibration version because there is no calibration. There is no model version at all *(044)*.
And 20 of 21 decisions discarded the confidence they displayed *(046)*.**

## 🔴 **Calibration history is not merely unreproducible. There is none to reproduce.**

---

# PART 8 — FAILURE MODE REGISTER

| Failure mode | Present? | Impact |
|---|---|---|
| 🔴 **Unsupported certainty** | 🔴 **CONFIRMED — THE HEADLINE** | 🔴 **"VERY HIGH conviction" from an unvalidated affine heuristic, on 6 dashboards** |
| 🔴 **Miscalibration** | 🔴 **UNVERIFIABLE for 6 of 8 outputs** | 🔴 **The confidence shown was never stored (046)** |
| 🟡 **Overconfident predictions** | 🟡 **UNPROVEN** | 🟡 **The one recorded confidence — 91 → LOSS. n=1.** On the condors the model is if anything MODEST (68% claimed, 75% actual) |
| 🔴 **Regime-dependent failure** | 🔴 **CONFIRMED** | 🔴 **045: NEGATIVE at realised vol ≥ 15%. The confidence never changes** |
| 🔴 **Confidence drift** | 🔴 **CONFIRMED, UNMEASURABLE** | 🔴 **044: the model was silently re-specified on 2026-07-01; all weights rescaled 7.6%** |
| 🔴 **Sparse evidence** | 🔴 **CONFIRMED** | 🔴 **n = 12, one structure. 019 needs ~200** |
| 🔴 **THE WRONG QUANTITY** | 🔴 **CONFIRMED — AND IT IS THE DEEPEST ONE** | 🔴 **§0.3. A calibrated P(win) of 75% on a 2.89× payoff ratio is ₹41.90 a trade. The platform reports the probability and never the expectancy** |

---

# PART 9 & 10 — RELIABILITY ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   🔴 ExpectancyLayer  ★★★   — THE PRIMITIVE WHOSE ABSENCE IS §0.3
     A PROBABILITY IS NOT A DECISION. Expectancy is:   E = p·W − (1−p)·L
     🔴 The platform computes, ranks, colours and badges p. It never computes E.
     🔴 On the only 12 calibrated trades it owns: p = 75% (correct!) and E = ₹41.90.
        The number it shows is right. The number it doesn't show is the one that matters.
     🔴 EVERY confidence badge must carry the payoff ratio beside it, or it is a lie of omission.

   CalibrationRegistry  ★★
     A score becomes a PROBABILITY only after it has been SCORED against outcomes:
       Brier · Log Loss · ECE · MCE · reliability curve — versioned, dated, reviewed.
     🔴 Until then it is a SCORE, and must be called one. §0.1 renamed a rounding as a calibration.

   🔴 UncertaintyRegistry  ★★★
     EPISTEMIC uncertainty must be VISIBLE. A leg with n=0 is not a weak opinion —
     IT IS THE ABSENCE OF AN OPINION, and it must render as UNKNOWN, never as a number.
     🔴 volume (n=0, weight 8.06) and fii (n=0, weight 10.08) prove the layer does not exist.

   THE RULE 048 ESTABLISHES:
     🔴 A CALIBRATED PROBABILITY OF THE WRONG QUANTITY IS WORSE THAN AN UNCALIBRATED ONE.
        An uncalibrated number invites doubt. A CORRECT number invites action —
        and this platform's correct number (P(win) = 75%) describes a coin flip.
```

---

# PART 11 — TESTING STRATEGY

**Calibration correctness has priority over optimistic confidence.**

| Test | Priority | Fails today? |
|---|---|---|
| 🔴 **Every confidence badge shows the PAYOFF RATIO beside it** | **P0 — §0.3. THE ONE** | ✅ **FAILS — probability only** |
| 🔴 **A score may not be called a "probability" until Brier/ECE are computed on it** | **P0 — §0.1** | ✅ **FAILS — `prob` is a rounding** |
| 🔴 **The confidence SHOWN is the confidence STORED** | **P0** *(046)* | ✅ **FAILS — 20 of 21 null** |
| 🔴 **An n=0 leg renders as UNKNOWN, never as a number** | **P0 — epistemic** | ✅ **FAILS — `volume`, `fii`** |
| 🔴 **Reliability is measured per REGIME** | **P0 — 045: negative at high vol** | ✅ **FAILS — never done** |
| 🔴 **Calibration drift is monitored across model versions** | P1 | ✅ **FAILS — no model version exists** *(044)* |
| 🟢 **`minFactors: 4` blocks a decision on sparse evidence** | P0 | 🟢 **PASSES — fail-closed. Lock it in** |

---

# PART 12 — RELIABILITY MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Raw Scores** | 🟢 **YES — and this is where it sits** | `net ∈ [−100,100]`, mapped by hand |
| **1 — Basic Confidence** | 🟡 **PARTIAL** | 🟢 A confidence exists and gates decisions · 🔴 **it has no definition** |
| **2 — Calibrated Probabilities** | 🔴 **NO** | 🔴 **No calibration exists anywhere. `prob` = `Math.round(rawP × 100)`** |
| **3 — Governed Reliability** | 🔴 **NO** | 🔴 **Brier/ECE/MCE/LogLoss computed for the first time today, by an audit** |
| **4 — Enterprise Confidence** | 🔴 **NO** | 🔴 **Reliability is UNKNOWN across all 7 dimensions** |
| **5 — Institutional Assurance** | 🔴 **NO** | — |

## ## **RELIABILITY PLATFORM: LEVEL 0–1 — RAW SCORES.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Preconditions | Risks | Exit criteria |
|---|---|---|---|
| **1 — INVENTORY** | ✅ **DONE — Part 1. 8 outputs, 1 calibrated** | — | Every probability named and sourced |
| **2 — 🔴 SHOW THE EXPECTANCY (do this first — the data already exists)** | 🟢 **none. Every ledger already records `pnl`** | 🟢 **ZERO** | 🔴 **No confidence is displayed without its payoff ratio beside it. §0.3** |
| **3 — HONEST NAMING** | Phase 2 | 🟢 LOW | 🔴 **"probability" is retired until Brier/ECE are computed. Until then it is a SCORE** |
| **4 — CALIBRATION** | Phase 3 + persist the shown confidence *(046)* | 🟡 **needs ~200 labelled outcomes; 12 exist** | 🔴 **A real reliability curve, versioned and reviewed** |
| **5 — UNCERTAINTY** | Phase 4 | Low | 🔴 **An n=0 leg renders as UNKNOWN. Regime-specific reliability is reported** |

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every confidence has a documented interpretation | 🔴 **NO — 7 of 8 have none** |
| Calibration methodology is explicit | 🔴 **NO — there is no calibration** |
| **Reliability is measured with evidence** | 🔴 **NO — 0 of 7 dimensions, until this audit** |
| **Uncertainty is represented rather than hidden** | 🔴 **NO — an n=0 leg renders as a number** |
| Calibration drift is monitored | 🔴 **NO — no model version to drift from** *(044)* |
| **Probability claims remain statistically defensible** | 🔴 **NO — n = 12, one structure** |
| 🔴 **Unknown reliability is never reported as high confidence** | 🔴 **NO — "VERY HIGH conviction" on an unvalidated heuristic** |

## **0 of 7. The lowest score awarded to any dimension in this programme except 043.**

---

# STOP CONDITIONS

| Condition | Verdict |
|---|---|
| *Confidence meaning cannot be defined* | 🔴 **FIRES — `50 + |net|/100 × 45 × (0.55+0.45·agreement)` is not a meaning** |
| *Calibration evidence is unavailable* | 🔴 **FIRES — for 7 of 8 outputs. And the 8th is `agents-engine`, which calibrated itself** |
| *Reliability cannot be measured* | 🔴 **FIRES — the confidence emitted was never persisted (046). It is not merely unmeasured; it is unmeasurable** |
| *Probability claims cannot be statistically supported* | 🔴 **FIRES — n = 12, one structure, BSS = +0.054** |

## 🔴 **FOUR OF FOUR STOP CONDITIONS FIRE.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent validation engineer determine exactly what every reported confidence
value means, reproduce the calibration, and verify that the probabilities are statistically defensible?**

## **The meaning: NO — six of eight confidence outputs have none. The calibration: there is none to reproduce. And the one probability that IS approximately correct turns out to be the wrong number entirely.**

**First, the small finding.**

> ## 🔴 **THE PLATFORM'S "CALIBRATION" IS `Math.round(rawP × 100)`.**
>
> **`signal-outcomes.json` carries `rawP` and `prob`. A reader takes `prob` for the calibrated probability.
> It is the raw score expressed as a percentage. No Platt scaling, no isotonic regression, no reliability
> curve — and the rounding makes the Brier score very slightly *worse* (0.1770 → 0.1773).**
>
> **Brier, Log Loss, ECE and MCE were computed on this platform for the first time TODAY, by this audit, on
> twelve samples. The platform uses none of the six methods 048 lists.**

**Now the finding this document exists for.**

> **On those twelve trades, the model's probability was approximately RIGHT:**
>
> ```
>    P(win) reported : 68.2%          P(win) actual : 75.0%
> ```
>
> **And here is what those same twelve trades did in rupees:**
>
> ```
>    mean win   : ₹ 1,476   (9 trades)
>    mean loss  : ₹−4,260   (3 trades)        loss/win ratio: 2.89 ×
>
>    EXPECTANCY = 0.75 × 1,476 + 0.25 × (−4,260)  =  ₹41.90 per trade
>    total realised over all 12 trades            =  ₹503
> ```
>
> ## 🔴 **A SEVENTY-FIVE PERCENT WIN PROBABILITY, PREDICTED ALMOST PERFECTLY, ON A STRUCTURE THAT LOSES 2.89× WHAT IT WINS. TWELVE TRADES. FIVE HUNDRED AND THREE RUPEES.**
>
> ## **THE PLATFORM DISPLAYS P(win). P(win) IS NOT THE DECISION-RELEVANT QUANTITY — EXPECTANCY IS. And `master-confluence.js` computes, ranks, colours and badges the probability, and never once computes the expectancy.**
>
> **"76% probability · VERY HIGH conviction", rendered large on six dashboards, is on this evidence **TRUE
> AND USELESS**. The user is shown a number that is calibrated and irrelevant, formatted as though it is
> the answer.**

**And this is not an isolated quirk — it is the signature of the entire product:**

> **Audit 045 found the short strangle at a 59.4% win rate with a payoff ratio of 0.99 and a kurtosis of
> 30.6. High win rates on asymmetric payoffs are what premium selling *is*, and the win rate is precisely
> the statistic that hides the risk.**
>
> ## **The platform reports the number that makes premium selling look safe, and does not report the number that would show it is not. That is not a bug in a formula. It is a bug in what the product chose to measure.**

**A calibrated probability of the wrong quantity is worse than an uncalibrated one. An uncalibrated number
invites doubt; a correct number invites action — and this platform's correct number describes a coin flip.**

**And the fix, once again, is nearly free:**

> ## **Every ledger in this repository already records `pnl`. Show the PAYOFF RATIO beside every confidence badge. "76% · wins ₹1,476 / loses ₹4,260 · expectancy ₹42" tells the whole truth in one line, and every input to it is already on disk.**

**Credit, for the last time, where it is unambiguously earned:**

> 🟢 **`agents-engine.js` is the ONLY probability output in this platform with a documented, measured
> calibration — it compared its own predicted moves against 33 real outcomes, found it was overshooting by
> 2.7×, applied a shrinkage factor, and wrote the measurement into the code. It is one of eight. Nobody
> asked it to.**

## **Reliability maturity: LEVEL 0–1 — RAW SCORES. 0 of 7 success criteria. Four of four stop conditions fire. The platform's confidence is not miscalibrated. It is uncalibrated, undefined, and — where it happens to be right — measuring the wrong thing.**

---

**Accuracy improved: NONE. Model outputs changed: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Probability Inventory (Part 1) · Confidence Lifecycle (Part 2) · **Calibration Governance
(§0.1–§0.2, Part 3)** · Reliability Assessment (Part 4) · Uncertainty Governance (Part 5) · Evidence Review
(Part 6) · Observability (Part 7) · Failure Mode Register (Part 8) · Reliability Architecture (Parts 9–10) ·
Testing Strategy (Part 11) · Maturity (Part 12) · Roadmap (Part 13) · Executive Summary.

**Stop conditions: confidence meaning 🔴 FIRES · calibration evidence 🔴 FIRES · reliability 🔴 FIRES ·
statistical support 🔴 FIRES.**
