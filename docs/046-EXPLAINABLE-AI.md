# 046 — EXPLAINABLE AI (XAI), FEATURE ATTRIBUTION, INTERPRETABILITY & DECISION TRANSPARENCY

**Standard:** Master Prompt 046 · **Depends on:** 000-A … 045
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No accuracy improved. No architecture redesigned.**

**046's stop condition: *"Never present an explanation as factual if it is only an approximation or heuristic."***

**Audit 041 established that this platform has NO BLACK BOX — every decision is traceable to a readable
number. So 046 asks the harder question: the platform SHOWS the user a "probability" and a "conviction."
What are those numbers, and do they mean anything?**

---

# ═══════════════════════════════════════════════════════════
# SECTION 0 — A FAITHFUL EXPLANATION OF A BROKEN MODEL
# ═══════════════════════════════════════════════════════════

## §0.1 — 🔴 The "probability" is not a probability. It is an affine rescaling of a score.

```js
master-confluence.js:101
  // base probability: magnitude × how unanimous the vote is
  let probability = 50;
  if (decision !== 'HOLD') {
    probability = 50 + (Math.abs(net) / 100) * 45 * (0.55 + 0.45 * agreement);
  } else {
    probability = 50 + (Math.abs(net) / 100) * 8;
  }
  …
  probability = clamp(probability - riskPenalty, 5, 95);
```

**There is no likelihood here. No base rate. No calibration. No data of any kind.**

**`net` is a weighted average of nine hand-scored factors. `agreement` is the weighted share voting the
same way. The number `probability` is those two quantities pushed through a linear map whose constants —
`50`, `45`, `0.55`, `0.45`, `8`, `10`, `6`, `58`, `5`, `95` — were all chosen by hand.**

**And then it is named, ranked, and published:**

```js
master-confluence.js:124
  const conviction = … probability >= 85 ? 'VERY HIGH' :
                       probability >= 75 ? 'HIGH' : …
```

```
  server.js:5417   const verdict = masterConfluence.fuse(factors);
  surfaced on:     dashboard.html · command.html · command-pro.html
                   agents.html · pattern-signals.html · payoff.html
```

> ## 🔴 **THE PLATFORM TAKES A HEURISTIC SCORE, APPLIES A HAND-TUNED LINEAR TRANSFORM, CALLS THE RESULT A "PROBABILITY", LABELS IT "VERY HIGH CONVICTION" ABOVE 85, AND PUTS IT ON SIX DASHBOARDS.**
>
> **046's stop condition, verbatim: *"Never present an explanation as factual if it is only an approximation
> or heuristic."***
>
> **This is that, exactly. The word "probability" makes a claim the arithmetic does not support. A user
> reading "78% probability, HIGH conviction" will believe roughly 78 out of 100 such calls resolve their
> way. Nothing in the code has ever checked whether that is true.**

## §0.2 — 🔴 AND IT CANNOT BE CHECKED. The platform did not keep the number it showed.

**Measured — the 21 recorded decisions with a known outcome in `data/confluence-weights.json`:**

```
  trades retaining a factor-level explanation   :  21 / 21     🟢
  trades retaining the CONFIDENCE THAT WAS SHOWN:   1 / 21     🔴
```

```
  THE ENTIRE CALIBRATION DATASET THIS PLATFORM POSSESSES:

     id 1001 · NIFTY · BUY · score 91 · ──▶ LOSS
```

**One data point. A "VERY HIGH conviction" call at 91, which lost.**

**n = 1 proves nothing statistically, and I will not pretend otherwise. But it is *everything the platform
has*, and it points the wrong way.**

```
  ACTUAL OUTCOME OF THE 21 RECORDED AI DECISIONS:   5 WINS / 21   =   23.8%
```

> ## 🔴 **THE CONFIDENCE NUMBER IS DISPLAYED, ACTED ON, AND THEN DISCARDED. Twenty of twenty-one decisions stored `score: null`.**
>
> **Calibration is therefore not "poor." It is **UNVERIFIABLE** — and 046's stop condition fires:
> *"Confidence meaning is undocumented"* and *"Explanations cannot be reproduced."***
>
> **This is the same disease as everywhere else in this platform: the information was generated, it was
> correct, and nobody kept it or looked at it.**

## §0.3 — 🟢 AND YET THE EXPLANATION ITSELF IS GENUINELY EXCELLENT

**Every one of the 21 decisions retains a complete, factor-level, local attribution — the real thing:**

```
  trade 1004 · NIFTY · BUY · P&L −₹935.14 · result LOSS

    leg          agreed  helpful   weight from → to     score
    ────────────────────────────────────────────────────────────
    trend         false   true     16.22 → 16.54        −33.3
    smartMoney    true    false    12.91 → 12.65        +33.0
    oi            true    false    15.44 → 14.59        +92.1   ◀── screaming bullish
    news          true    false     9.78 →  9.57        +35.0
    pcr           true    false    11.49 → 10.88        +88.0   ◀── screaming bullish
    greeks        false   true     10.96 → 11.02         −9.0
    iv            false   true      5.37 →  5.39         −6.0
```

> 🟢 **This is a real local feature attribution. It records what every leg said, how strongly, whether it
> agreed with the decision, whether it turned out to be right, and exactly how much weight it gained or
> lost as a result. Most commercial ML systems do not retain this. It is present here on 21 of 21
> decisions, and it is the best XAI artefact in the repository.**

## §0.4 — 🔴 **AND THAT IS PRECISELY WHAT MAKES IT DANGEROUS.**

**Read trade 1004 again. `oi` scored +92.1. `pcr` scored +88. The model went BUY with high conviction.
It lost ₹935.**

**The explanation is not wrong. The explanation is PERFECT. It records, in exact numerical detail, why the
model was confidently mistaken — and audit 041 later measured that in NIFTY, `oi` is right 20% of the time
and still carries the second-highest weight in the model.**

> ## 🔴 **A FAITHFUL EXPLANATION OF A BROKEN MODEL DOES NOT REVEAL THE ERROR. IT MANUFACTURES TRUST.**
>
> **A black box that is 24% accurate invites scepticism. A model that is 24% accurate AND shows you a clean
> table of exactly which indicators voted which way, with weights and agreement and a "78% probability,
> HIGH conviction" badge, invites belief.**
>
> **Explainability, on its own, is not a safety property. It is a *presentation* property. It becomes a
> safety property only when someone reads the explanation and checks it against the outcome — and across
> twenty-one recorded decisions, five of which won, nobody ever did.**

**This is the sharpest form of the pathology this whole programme keeps finding: the platform does not lack
information. It lacks the habit of looking.**

---

# PART 1 — EXPLAINABILITY INVENTORY

| Model | Explainability method | Faithful? | Confidence documented? |
|---|---|---|---|
| 🟢 **`master-confluence` (fusion)** | 🟢 **Full leg-level attribution + `reason` string** | 🟢 **YES — §0.3** | 🔴 **NO — it is a heuristic named "probability" (§0.1)** |
| 🔴 **`confluence-learner`** | 🟢 **`changes{}` — before/after weight per leg** | 🟢 **YES** | 🔴 **NO — 33.8% correct over 130 obs** *(041)* |
| **`meta-label`** | 🟡 `rawP` / `prob` retained in `signal-outcomes.json` | 🟡 | 🔴 **AUC 0.685, permutation p = 0.191 = CHANCE** *(019)* |
| 🟢 **`agents-engine`** | 🟢 **Parameters DISCLOSED in the header; `MOVE_CALIBRATION = 0.4` fitted on 33 outcomes** | 🟢 **YES** | 🟢 **THE ONLY MODEL WITH A DOCUMENTED, MEASURED CALIBRATION** |
| **`candlestick-patterns`** | 🟡 pattern name | 🟡 | 🔴 **never validated** |
| **`news-engine`** | 🟡 sentiment + confidence | 🟡 | 🔴 **never validated** |
| **`signal-engine` / `trade-planner`** | 🟢 rule-based, readable | 🟢 | 🔴 **NO** |
| ⚪ **Black-box models** | ⚪ **NONE EXIST** | — | 🟢 **the platform's real strength** |

## **8 decision-producing models. 0 are black boxes. 1 has a documented, measured confidence.**

---

# PART 2 — DECISION LIFECYCLE

```
  Market Data          🟢  works
       ↓
  🔴 Feature Eng.      🔴  computed, then DISCARDED  (035)
       ↓
  Model Evaluation     🟢  fuse() — pure, readable, deterministic
       ↓
  Prediction           🟢  BUY / SELL / HOLD
       ↓
  🔴 Confidence Est.   🔴🔴  ══ A HAND-TUNED AFFINE TRANSFORM NAMED "probability" ══   §0.1
       ↓
  🟢 Explanation Gen.  🟢  EXCELLENT — full leg attribution, 21/21 retained   §0.3
       ↓
  🔴 Human Review      🔴🔴  ══ NOBODY EVER READ IT ══   §0.4
       ↓
  Decision             🔴  acted on. 5 wins in 21.
       ↓
  🔴 Audit             🔴  the SHOWN confidence was NOT PERSISTED — 20 of 21 are null   §0.2
```

## 🔴 **The explanation is generated correctly and then dropped into a stage — Human Review — that does not exist.**

**And 046 requires: *"Every explanation must correspond to a specific model version."* Audit 044 proved the
model has NO VERSION, is UNTRACKED in git, and was silently re-specified on 2026-07-01. **Therefore no
explanation in this platform can be tied to the model that produced it.***

---

# PART 3 — FEATURE ATTRIBUTION

| Capability | Supported? |
|---|---|
| 🟢 **Relative feature importance** | 🟢 **YES — the weight vector** |
| 🟢 **Local feature influence** | 🟢 **YES — per-decision `changes{}`, 21/21. Genuinely good** |
| 🟢 **Global feature influence** | 🟢 **YES — `stats{correct, wrong, n}`. It recorded its own 33.8% honestly** |
| 🔴 **Interaction effects** | 🔴 **NO — the fusion is strictly linear. Interactions are invisible by construction** |
| 🔴 **Feature stability over time** | 🔴 **UNKNOWN — and UNKNOWABLE. No feature store** *(035)*, **no model version** *(044)* |
| 🔴 **Feature redundancy** | 🔴 **NOT ASSESSED — `oi` and `pcr` are both option-flow measures and are treated as independent votes** |
| 🔴 **Feature uncertainty** | 🔴 **NO — `volume` and `fii` carry weight from n = 0 observations** *(041)* |

## **7 capabilities. 3 strong, 4 absent. Per 046: unknown feature influence remains UNKNOWN.**

---

# PART 4 — INTERPRETABILITY

| Can a user understand… | Yes? |
|---|---|
| 🟢 **Why the prediction occurred** | 🟢 **YES — the leg table is complete and readable** |
| 🟢 **Which inputs mattered most** | 🟢 **YES — weight × score, all visible** |
| 🔴 **Which assumptions were influential** | 🔴 **NO — the prior (`DEFAULT_WEIGHTS`) is invisible to the user, and it CHANGED on 2026-07-01** *(044)* |
| 🔴 **Which uncertainties exist** | 🔴 **NO — an n=0 factor looks identical to an n=130 factor on screen** |
| 🔴 **WHEN THE MODEL SHOULD NOT BE TRUSTED** | 🔴 **NO. AND THIS IS THE ONE THAT MATTERS** |

> ## 🔴 **046: *"Explainability should distinguish evidence from inference."* The platform's explanation distinguishes NOTHING. `oi` scoring +92.1 with a 20% historical hit-rate renders on screen exactly like a factor that is actually informative. The interface shows the INFERENCE with great clarity and hides the EVIDENCE entirely.**
>
> **A single column — "this leg has been right 2 times out of 10" — next to each score would have exposed
> the entire problem, and the platform already stores that number.**

---

# PART 5 — CONFIDENCE INTERPRETATION

| Required | Present? |
|---|---|
| 🔴 **Definition** | 🔴 **NO — "probability" is `50 + |net|/100 × 45 × (0.55 + 0.45·agreement)`** |
| 🔴 **Calibration status** | 🔴 **UNVERIFIABLE — 20 of 21 decisions stored `score: null` (§0.2)** |
| 🔴 **Statistical meaning** | 🔴 **NONE. It is not a likelihood of anything** |
| 🟡 **Operational meaning** | 🟡 `probability < 58` demotes to HOLD — so the number DOES gate real decisions |
| 🔴 **Limitations** | 🔴 **NOT STATED ANYWHERE the user can see** |
| 🔴 **Appropriate usage** | 🔴 **NOT STATED** |

## 🔴 **046: *"Confidence values without interpretation are incomplete."* The confidence gates the decision (`< 58` → HOLD), is displayed as a percentage on six dashboards, is labelled "VERY HIGH" above 85 — and has no definition, no calibration, and no recorded history.**

**The one honourable exception:**

> 🟢 **`agents-engine.js:53` — *"the raw heuristic OVERSHOOTS — over 33 scored outcomes mean predicted |move|
> was 3.85% vs 1.42% realised (ratio ~0.37). Shrink … Re-fit as the archive grows."* `MOVE_CALIBRATION = 0.4`.
> That is a definition, a calibration measurement, a limitation, and a maintenance instruction — written
> unprompted, in the code, by someone who did not want to fool themselves.**

---

# PART 6 — HUMAN REVIEW

| Capability | Present? |
|---|---|
| **Analyst review** | 🔴 **NO WORKFLOW EXISTS** |
| 🟢 **Explanation inspection** | 🟢 **the data is there (§0.3) — but no UI surfaces the leg table against outcomes** |
| **Manual override** | 🟡 engines can be toggled — 🔴 **over unauthenticated HTTP** *(023)* |
| **Evidence review** | 🔴 **NO — the 33.8% hit-rate sat unread on disk for months** |
| 🟢 **Decision logging** | 🟢 **21/21 with full attribution** · 🔴 **1/21 with the shown confidence** |
| 🔴 **Post-decision analysis** | 🔴 **NONE — this audit is the first** |

## 🔴 **Human Review is the stage where explainability converts into safety. It is empty. The explanations have been accumulating, correctly, unread.**

---

# PART 7 — OBSERVABILITY

| Every decision must record | Present? |
|---|---|
| 🔴 **Model version** | 🔴 **NO — the model has no version** *(044)* |
| 🔴 **Feature version** | 🔴 **NO — no feature store** *(035)* |
| 🟢 **Prediction** | 🟢 **YES** |
| 🔴 **Confidence** | 🔴 **1 of 21** |
| 🟢 **Explanation** | 🟢 **21 of 21 — excellent** |
| 🟢 **Timestamp** | 🟢 **YES (`at`)** |
| **Reviewer** | 🔴 **N/A — no review exists** |

## **7 fields. 3 recorded. The two missing ones — model version and confidence — are exactly the two that make an explanation *reproducible*, and 046's stop condition fires on both.**

---

# PART 8 — FAILURE MODE REGISTER

| Failure mode | Present? | Impact |
|---|---|---|
| 🟢 **Black-box decisions** | 🟢 **NOT PRESENT — the platform's genuine strength** | 🟢 |
| 🔴 **Misleading explanations** | 🔴 **CONFIRMED — THE HEADLINE** | 🔴 **A heuristic affine transform is presented as a "probability" and labelled "VERY HIGH conviction" (§0.1)** |
| 🔴 **Uncalibrated confidence** | 🔴 **CONFIRMED — AND UNVERIFIABLE** | 🔴 **20 of 21 decisions discarded the number they showed (§0.2)** |
| 🔴 **Feature attribution instability** | 🔴 **CONFIRMED** | 🔴 **The weights were silently re-specified on 2026-07-01. Old explanations refer to a model that no longer exists** *(044)* |
| 🟢 **Missing explanations** | 🟢 **NOT PRESENT — 21/21** | 🟢 |
| 🔴 **Unsupported conclusions** | 🔴 **CONFIRMED** | 🔴 **`oi` renders a +92.1 vote with a 20% hit-rate, and looks the same as a good factor** |
| 🔴 **HUMAN MISUNDERSTANDING** | 🔴 **CONFIRMED — AND IT IS THE MOST SERIOUS** | 🔴 **§0.4. A faithful explanation of a broken model MANUFACTURES TRUST** |

---

# PART 9 & 10 — XAI ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   🔴 ConfidenceRegistry  ★★★   — THE PRIMITIVE WHOSE ABSENCE IS §0.1–§0.2
     A confidence is a CLAIM. A claim must be:
       DEFINED  — "P(this call resolves in our favour)", not "50 + |net|/100 × 45 × …"
       STORED   — the number SHOWN is the number KEPT. Today 20 of 21 are null.
       SCORED   — reliability curve: claimed 80% must resolve ~80% of the time.
     🔴 UNTIL A CONFIDENCE IS SCORED AGAINST OUTCOMES, IT MAY NOT BE CALLED A PROBABILITY.
        Call it a SCORE. The word "probability" is a factual claim the arithmetic cannot back.

   🔴 EvidenceColumn  ★★★   — the single highest-leverage change in this document
     Next to every leg's score, render the leg's OWN TRACK RECORD.
       "oi  +92.1  (right 2 of 10)"      instead of      "oi  +92.1"
     🔴 The platform ALREADY STORES stats{correct, wrong, n}. It is one column.
        It would have exposed the entire 33.8% problem to the user on day one.
     🔴 An n=0 leg must render as UNKNOWN, never as a number. (volume, fii — 041)

   ExplanationEngine  ★
     🟢 ALREADY EXISTS AND IS GOOD. changes{} is a real local attribution, 21/21.
     🔴 It must carry a MODEL VERSION (044). An explanation without a version explains nothing.

   HumanReviewPortal  ★★★
     🔴 THE EMPTY STAGE. Explainability is a PRESENTATION property until someone reads it.
        It becomes a SAFETY property only at the moment an explanation is compared to an outcome.

   THE RULE 046 ESTABLISHES:
     🔴 EXPLAINABILITY IS NOT A SAFETY FEATURE. IT IS A TRUST MULTIPLIER.
        Applied to a correct model, it earns warranted trust.
        Applied to a 24%-accurate model, it manufactures unwarranted trust — and does so
        MORE EFFECTIVELY than a black box ever could.
```

---

# PART 11 — TESTING STRATEGY

**Transparency has priority over presentation quality.**

| Test | Priority | Fails today? |
|---|---|---|
| 🔴 **A number may not be called "probability" until it is scored against outcomes** | **P0 — §0.1** | ✅ **FAILS** |
| 🔴 **The confidence SHOWN is the confidence STORED** | **P0 — §0.2** | ✅ **FAILS — 20 of 21 null** |
| 🔴 **Every explanation carries a model version** | **P0 — 044** | ✅ **FAILS — no version exists** |
| 🔴 **Every leg renders its own track record beside its score** | **P0 — the EvidenceColumn** | ✅ **FAILS — the data exists and is not shown** |
| 🔴 **An n=0 leg renders as UNKNOWN, never as a number** | **P0 — `Unknown ≠ Prediction`** | ✅ **FAILS — `volume`, `fii`** |
| 🔴 **A reliability curve is produced and reviewed** | P1 | ✅ **FAILS — n=1 of calibration data exists** |
| 🟢 **Explanations are deterministic and reproducible** | P1 | 🟢 **PASSES — `fuse()` is pure** |

---

# PART 12 — XAI MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Opaque Models** | 🟢 **SURPASSED — no black box exists anywhere** | 🟢 **a genuine achievement** |
| **1 — Basic Feature Importance** | 🟢 **YES** | 🟢 **weights + `stats{correct,wrong,n}`** |
| **2 — Repeatable Explanations** | 🔴 **NO** | 🔴 **No model version. The 2026-07-01 re-spec orphaned every prior explanation** *(044)* |
| **3 — Governed Explainability** | 🔴 **NO** | 🔴 **"probability" is a heuristic with no definition; 20 of 21 confidences discarded** |
| **4 — Enterprise XAI** | 🔴 **NO** | 🔴 **No human-review stage exists** |
| **5 — Institutional Transparency** | 🔴 **NO** | — |

## ## **XAI MATURITY: LEVEL 1 — BASIC FEATURE IMPORTANCE.**

**And this is the HIGHEST maturity score awarded in the entire forty-six-document programme. Explainability
is genuinely this platform's strongest dimension — which is exactly why §0.4 matters.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Preconditions | Risks | Exit criteria |
|---|---|---|---|
| **1 — INVENTORY** | ✅ **DONE — Part 1. 8 models, 0 black boxes** | — | Every model's method named |
| **2 — 🔴 THE EVIDENCE COLUMN (do this first — it is one column)** | 🟢 **none. `stats{correct,wrong,n}` is ALREADY STORED** | 🟢 **ZERO** | 🔴 **Every leg shows its own hit-rate beside its score. An n=0 leg shows UNKNOWN** |
| **3 — CONFIDENCE GOVERNANCE** | Phase 2 | 🟡 **the word "probability" must be retired until it is earned** | 🔴 **The shown confidence is PERSISTED. A reliability curve becomes possible** |
| **4 — HUMAN REVIEW** | Phase 3 | Low | 🔴 **Somebody compares an explanation to an outcome. That has never happened** |
| **5 — INSTITUTIONAL** | Phase 4 | Low | Versioned, reproducible explanations |

> **Phase 2 costs almost nothing and is the highest-leverage change in this document. The platform already
> stores the number that would have exposed everything. It just never renders it.**

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| 🟢 **Every prediction can be explained** | 🟢 **YES — 21/21. Genuinely excellent** |
| 🟢 **Feature influence is measurable** | 🟢 **YES — local and global** |
| 🔴 **Confidence has documented meaning** | 🔴 **NO — it is an undocumented affine heuristic (§0.1)** |
| 🔴 **Human review is supported** | 🔴 **NO — the stage does not exist** |
| 🔴 **Explanations are reproducible** | 🔴 **NO — no model version; the model was silently re-specified** *(044)* |
| 🔴 **Unknown factors explicitly documented** | 🔴 **NO — an n=0 leg renders as a number** |
| 🔴 **Explanations never overstate certainty** | 🔴 **NO — "VERY HIGH conviction" on a 24%-accurate decision stream** |

## **2 of 7.**

---

# STOP CONDITIONS

| Condition | Verdict |
|---|---|
| *Decision logic cannot be explained* | 🟢 **DOES NOT FIRE — emphatically. No black box exists** |
| *Feature attribution cannot be verified* | 🟢 **DOES NOT FIRE — 21/21 retain full local attribution** |
| 🔴 *Confidence meaning is undocumented* | 🔴 **FIRES — §0.1. It is `50 + |net|/100 × 45 × (0.55 + 0.45·agreement)`** |
| 🔴 *Explanations cannot be reproduced* | 🔴 **FIRES — no model version *(044)*; 20 of 21 confidences discarded** |

---

# EXECUTIVE SUMMARY

**The mission: could an independent AI auditor inspect any decision, understand the contributing features,
interpret the confidence, and judge whether the decision is transparent enough to act on?**

## **The features: YES, and impressively so. The confidence: NO — and the gap between those two answers is the most dangerous thing in this repository.**

> ## 🟢 **THIS PLATFORM HAS NO BLACK BOX. Every one of its eight decision-producing models is fully readable, and every one of the twenty-one recorded AI decisions retains a complete, leg-by-leg attribution: what each factor scored, how strongly, whether it agreed with the call, whether it turned out to be right, and exactly how much weight it gained or lost as a result.**
>
> **Most commercial ML systems do not keep this. It is the best artefact in the repository, and it earns
> this platform the highest maturity score in forty-six documents.**

**And then:**

> ## 🔴 **THE "PROBABILITY" IS NOT A PROBABILITY.**
>
> ```js
>    probability = 50 + (Math.abs(net) / 100) * 45 * (0.55 + 0.45 * agreement);
> ```
>
> **No likelihood. No base rate. No data. It is a weighted score pushed through a hand-tuned linear map,
> and every constant in it — 50, 45, 0.55, 0.45, 58, 85 — was chosen by hand.**
>
> **It is then named `probability`, labelled **"VERY HIGH conviction"** above 85, used to gate real
> decisions (below 58 it forces HOLD), and rendered on **six dashboards**.**
>
> **046's stop condition, word for word: *"Never present an explanation as factual if it is only an
> approximation or heuristic."***

**And it cannot be checked, because the platform threw away the evidence:**

> ```
>    decisions retaining a full factor-level explanation :  21 / 21    🟢
>    decisions retaining the CONFIDENCE THAT WAS SHOWN   :   1 / 21    🔴
>
>    the entire calibration dataset this platform owns:
>        id 1001 · NIFTY · BUY · score 91 ──▶ LOSS
>
>    actual outcome of the 21 recorded AI decisions: 5 wins — 23.8%
> ```
>
> **One data point: a "VERY HIGH conviction" call at 91 that lost. It proves nothing on its own, and it is
> everything the platform has.**

## **And now the finding that this entire document exists to state:**

> **Look at decision 1004. `oi` voted **+92.1** — screaming bullish. `pcr` voted **+88**. The model went BUY
> with conviction. It lost ₹935.**
>
> **The explanation is not wrong. The explanation is **perfect**. It records, in precise numerical detail,
> exactly why the model was confidently mistaken. And audit 041 measured that in NIFTY, `oi` is right **20%
> of the time** — and still carries the second-highest weight in the model.**
>
> ## 🔴 **A FAITHFUL EXPLANATION OF A BROKEN MODEL DOES NOT REVEAL THE ERROR. IT MANUFACTURES TRUST.**
>
> **A black box that is 24% accurate invites scepticism. A model that is 24% accurate *and* shows you a
> clean table of which indicators voted which way, with weights and agreement and a confident percentage
> badge, invites belief. Explainability made this model MORE persuasive without making it MORE correct.**
>
> ## **Explainability is not a safety property. It is a TRUST MULTIPLIER. Pointed at a correct model it earns warranted trust; pointed at a 24%-accurate one it manufactures unwarranted trust — and it does so more effectively than a black box ever could.**

**And the fix is one column.**

> ## **The platform ALREADY STORES `stats{correct, wrong, n}` for every factor. Render it beside the score:**
>
> ```
>        oi   +92.1   (right 2 of 10)          instead of          oi   +92.1
>        volume  —    UNKNOWN (0 observations)  instead of          volume  8.06
> ```
>
> **One column. It would have exposed the entire 33.8% problem to the user on the first day. The number that
> proves the model is broken has been sitting one field away from the number that makes it look right, and
> the interface renders only the second one.**

## **XAI maturity: LEVEL 1 — the platform's strongest dimension, and 2 of 7 success criteria. It explains everything about a model nobody checked, and the quality of the explanation is exactly what made it credible.**

---

**Accuracy improved: NONE. Architecture redesigned: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Explainability Inventory (Part 1) · Decision Lifecycle (Part 2) · Feature Attribution
(Part 3) · Interpretability (Part 4) · **Confidence Interpretation (§0.1–§0.2, Part 5)** · Human Review
(Part 6) · Observability (Part 7) · Failure Mode Register (Part 8) · XAI Architecture (Parts 9–10) ·
Testing Strategy (Part 11) · Maturity (Part 12) · Roadmap (Part 13) · Executive Summary.

**Stop conditions: decision logic — does not fire · feature attribution — does not fire ·
CONFIDENCE MEANING 🔴 FIRES · REPRODUCIBILITY 🔴 FIRES.**
