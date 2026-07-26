# 044 — MODEL DEVELOPMENT LIFECYCLE (MDLC), GOVERNANCE & REPRODUCIBLE AI ENGINEERING

**Standard:** Master Prompt 044 · **Depends on:** 000-A … 043
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No models designed. No accuracy optimised.**

**044's stop condition: *"Never assume two model versions are equivalent because they produce similar outputs."***

**Audit 041 measured WHAT the live model is. 044 asks a different question: WHEN did it change, and does
anybody know? The answer required git archaeology, and what it found is a model that was silently
re-specified underneath its own learned state.**

---

# ═══════════════════════════════════════════════════════════
# SECTION 0 — THE MODEL WAS RE-SPECIFIED UNDERNEATH ITSELF
# ═══════════════════════════════════════════════════════════

## §0.1 — 🔴 On 2026-07-01 the model changed. The learned state did not.

**Measured from git — `master-confluence.js`, `DEFAULT_WEIGHTS` (the model's prior):**

```
  BEFORE  commit da1e705 → 04c35a6        AFTER  commit 04c35a6  (2026-07-01)
  "Master Confluence Engine"              "feat(module-5): Smart Money Concepts engine"

    trend        18                          trend        16     ◀── CHANGED
    ── (does not exist) ──                   smartMoney   14     ◀── 🔴 NEW FACTOR
    oi           16                          oi           15     ◀── CHANGED
    volume        8                          volume        8
    news         10                          news          9     ◀── CHANGED
    pcr          12                          pcr          11     ◀── CHANGED
    greeks       12                          greeks       11     ◀── CHANGED
    iv            6                          iv            6
    fii          10                          fii           9     ◀── CHANGED

    8 factors                                9 factors
    baselineSum = 92                         baselineSum = 99
```

> ## 🔴 **THE MODEL'S INPUT DIMENSION WENT FROM EIGHT TO NINE. SIX OF THE EIGHT EXISTING PRIORS WERE CHANGED. THIS IS NOT A TUNING. IT IS A DIFFERENT MODEL.**

## §0.2 — 🔴 And nothing reset the learned state

```js
confluence-learner.js:73
  for (const k of LEARNABLE) {
    if (this.byInst[key].weights[k] == null) this.byInst[key].weights[k] = DEFAULT_WEIGHTS[k] || 8;
    if (!this.byInst[key].stats[k])          this.byInst[key].stats[k]   = { correct: 0, wrong: 0, n: 0 };
  }
  //  ▲ On the first boot after the re-spec, this quietly BACK-FILLED the new `smartMoney` key
  //    into a weights object that had been learned under the OLD eight-factor specification —
  //    and carried every old weight and every old statistic forward, untouched.

confluence-learner.js:187
  reset(inst) { … }     //  ◀── A RESET FUNCTION EXISTS. IT WAS NOT CALLED.
```

**And then the re-normalisation:**

```js
confluence-learner.js:53    const baselineSum = LEARNABLE.reduce((s, k) => s + (DEFAULT_WEIGHTS[k] || 8), 0);
confluence-learner.js:150   const scale = baselineSum / sum;
                            for (const k of LEARNABLE) st.weights[k] = clamp(st.weights[k] * scale, …);
```

```
  baselineSum  v1 = 92        v2 = 99        ratio = 1.0761
```

> ## 🔴 **THE RE-NORMALISATION TARGET SILENTLY MOVED FROM 92 TO 99. At the first update after the re-spec, EVERY weight learned under the old model was inflated by 7.6% — to hit a baseline that had changed for reasons that had nothing to do with evidence.**
>
> **No trade caused that. No outcome justified it. A commit did.**

## §0.3 — 🔴 AND THE PROVENANCE CANNOT BE RECONSTRUCTED. This is the stop condition.

**Measured — every field in the live model artifact:**

```
  data/confluence-weights.json
    top-level keys   : byInst, pending, trades, seq
    version field    : *** NONE ***
    schema field     : *** NONE ***
    trainedAt        : *** NONE ***
    🔴 GIT STATUS    : *** UNTRACKED — NO VERSION HISTORY EXISTS AT ALL ***
```

**The gap that cannot be resolved:**

```
                max n on a v1 factor      smartMoney n
    NIFTY               10                     7
    SENSEX               7                     6
    BANKNIFTY            4                     2
```

**A `smartMoney` count lower than its peers is consistent with observations made before the factor
existed. But `confluence-learner.js:137` — `if (!isFinite(s) || s === 0) continue;` — also skips a factor
that simply had no opinion that day.**

> ## 🔴 **I CANNOT TELL THE TWO APART. Neither can anyone else. There is no version field, no timestamp per statistic, and no git history for the artifact.**
>
> **The live model's `stats` block may be a mixture of observations scored under TWO DIFFERENT MODEL
> SPECIFICATIONS — with different priors, a different factor count, and a different normalisation target
> — and the platform has no way to determine which is which.**
>
> ## **This is not a finding I can resolve by measuring harder. It is UNKNOWN, permanently, and 044's stop condition fires: *"Version provenance cannot be reconstructed."***

## §0.4 — What the platform assumed

> **The platform assumed model v1 and model v2 were the same model, because the JSON file still parsed and
> the numbers still looked like weights.**
>
> ## **044's stop condition, verbatim: *"Never assume two model versions are equivalent because they produce similar outputs."* The platform did exactly this — and the only reason nobody noticed is that a weight vector always looks like a weight vector.**

## §0.5 — 🟢 One thing in this file is exactly right

```js
confluence-learner.js:126
  const won  = res === 'WIN'  || … || (trade.pnl != null && Number(trade.pnl) > 0);
  const lost = res === 'LOSS' || … || (trade.pnl != null && Number(trade.pnl) < 0);
                                        ▲ `!= null` — a null P&L is NOT coerced to zero,
                                          and therefore never counted as a loss.
```

> 🟢 **`null ≠ 0`, handled correctly, in the one place where getting it wrong would silently poison every
> statistic in the model. Against 119 `|| 0` sites elsewhere in the platform, somebody got this one right.**

---

# PART 1 — MODEL INVENTORY

| ID | Model | Type | Owner | Stage | Version | Validation |
|---|---|---|---|---|---|---|
| 🔴 **M-01** | **`confluence-learner`** | **Learning ensemble** | 🟢 itself | 🔴 **LIVE — and always learning** | 🔴 **NONE. Silently re-specified (§0)** | 🔴 **NEVER VALIDATED. 33.8% over 130 obs** *(041)* |
| **M-02** | `master-confluence` | Rule-based fusion | 🟢 itself | LIVE | 🔴 **NONE — the prior changed silently** | 🟡 mechanically tested |
| **M-03** | `meta-label` | Probability | 🟢 itself | LIVE | 🔴 **NONE** | 🔴 **AUC 0.685, permutation p = 0.191 = CHANCE** *(019)* |
| 🟢 **M-04** | `agents-engine` | Rule-based + calibrated | 🟢 itself | LIVE | 🟡 **`MOVE_CALIBRATION = 0.4`, fitted on 33 outcomes, DOCUMENTED** | 🟢 **PF 0.94 — DISCLOSED IN ITS OWN HEADER** *(041)* |
| **M-05** | `candlestick-patterns` | Rule-based | 🟢 itself | LIVE | 🔴 NONE | 🔴 **never validated** |
| **M-06** | `news-engine` | Sentiment | 🟢 itself | LIVE | 🔴 NONE | 🔴 **never validated** |
| **M-07** | `gex-skew` / `vol-context` | Volatility (Greeks) | 🟡 **TWO OWNERS** | LIVE | 🔴 NONE | 🔴 **TWO `bsGamma` IMPLEMENTATIONS DISAGREE BY 6.79%. No ground truth exists** *(036)* |
| 🔴 **M-08** | **Regime model** | — | 🔴 **NONE** | 🔴 **DELETED** | — | 🔴 **`backtest-when-strategy-works.js` deleted as junk** *(043)* |
| 🔴 **M-09** | **40-config signal optimiser** | Search | 🔴 **NONE** | 🔴 **DELETED, EXHUMED** | 🔴 **SYNTHETIC prices** | 🔴 **Ranked by win rate. IT IS 042's MISSING nTrials** *(043)* |
| **M-10** | `position-sizer` (Kelly) | Statistical | 🟢 itself | 🔴 **DISABLED** | 🔴 NONE | 🔴 **`kelly(p.winRate ?? 0.9)` — the 0.9 came from the INVALIDATED backtest. `kelly(0.512) = −0.077` = DO NOT BET** |
| ⚪ **Ensemble / RL** | — | — | — | ⚪ **none beyond M-01** | — | — |

## **10 models. 1 has a version marker of any kind. 0 were validated before deployment. 2 were deleted.**

---

# PART 2 — MODEL LIFECYCLE

```
  Research Question    🔴  never written  (043: 0 of 14 hypotheses documented)
       ↓
  Hypothesis           🔴  NONE
       ↓
  Dataset Selection    🟡  600 bhavcopy files — but the ARTIFACT IS UNTRACKED (§0.3)
       ↓
  🔴 Feature Eng.      🔴🔴  ══ COMPUTED AND DISCARDED ══  (035)
       ↓
  Model Design         🟡  9 hand-written numbers
       ↓
  Training             🔴  CONTINUOUS AND LIVE. There is no "training run" — only a running loop.
       ↓
  🔴 VALIDATION        🔴🔴  ══ SKIPPED. bt-validate.js has ZERO callers. ══  (042)
       ↓
  Paper Trading        🟢  the one honest surface
       ↓
  Performance Review   🔴  the 33.8% hit-rate sat unread on disk for months  (041)
       ↓
  🔴 Deployment Appr.  🔴🔴  ══ NO APPROVAL STAGE EXISTS. The model is ALWAYS deployed. ══
       ↓
  Monitoring           🔴  NONE
       ↓
  Retirement           🔴  NO POLICY. Nothing has ever been retired —
                           though two models were DELETED  (043)
```

## 🔴 **Twelve stages. The model has no "training run", no "deployment", and no "version" — because it never stops. It is a single unbroken loop that was silently re-specified on 2026-07-01 while running.**

---

# PART 3 — DEVELOPMENT GOVERNANCE

| Required per model | Defined? |
|---|---|
| Problem statement · **Target variable** · Input features · **Assumptions** · Constraints · Expected outputs · **Success criteria** | 🔴 **0 of 7, for all 10 models** |

> **The one place a model's specification IS written down is `DEFAULT_WEIGHTS` — nine numbers in a source
> file. And §0 shows that specification changed without a version, a migration, or a note.**
>
> **Per 044: unknown model assumptions remain **UNKNOWN**.**

---

# PART 4 — VERSION GOVERNANCE — 🔴 **THE CORE FAILURE**

| Linkage | Present? |
|---|---|
| 🔴 **Model versioning** | 🔴 **NONE. No `version` field. §0.3** |
| 🔴 **Dataset version linkage** | 🔴 **NONE — and the artifact is UNTRACKED in git** |
| 🔴 **Feature version linkage** | 🔴 **IMPOSSIBLE — there is no feature store** *(035)* |
| 🔴 **Code version linkage** | 🔴 **NONE — 0 of 25 results carry a gitSha** *(040)* |
| 🔴 **Configuration version linkage** | 🔴 **NONE — and `config-overrides.json` is HTTP-deletable** *(039)* |
| 🔴 **Experiment linkage** | 🔴 **NONE — 37 experiments were deleted** *(043)* |

## ## 🔴 **6 of 6 linkages ABSENT. No model version in this platform is reproducible. Not one.**

**And the sharpest form of it: the live model's weights are the OUTPUT of a training process whose CODE
changed on 2026-07-01, whose PRIOR changed, whose FACTOR COUNT changed, and whose NORMALISATION TARGET
changed — and the weights file itself carries no record of any of it, and is not in version control.**

---

# PART 5 — DEPLOYMENT GOVERNANCE

| Requirement | Present? |
|---|---|
| Approval workflow | 🔴 **NONE** |
| Deployment criteria | 🔴 **NONE** |
| 🔴 **Rollback** | 🔴 **ONE `.bak`, 24 HOURS STALE** *(039 §2)*. **And the artifact is untracked — git cannot roll it back either** |
| Paper trading requirement | 🟢 **MET — the model IS paper-only** |
| Operational readiness | 🔴 **the bot is DOWN (INC-001) and has been since audit 021** |
| Release documentation | 🔴 **NONE — the 2026-07-01 re-spec was shipped inside a feature commit** |

> ## 🔴 **044: *"No deployment should bypass documented validation."* Every deployment has bypassed it, because there is no deployment step — the model is redeployed on every server boot, whatever state the file happens to be in.**

---

# PART 6 — MODEL OBSERVABILITY

| Every model must record | M-01 `confluence-learner` |
|---|---|
| Version | 🔴 **NONE** |
| Training date | 🔴 **NONE** |
| Dataset version | 🔴 **NONE** |
| Feature version | 🔴 **NONE** |
| Validation metrics | 🔴 **NEVER VALIDATED** |
| Deployment status | 🔴 **NONE — always deployed** |
| Monitoring status | 🔴 **NONE** |
| Retirement status | 🔴 **NONE** |
| 🟢 **Performance stats** | 🟢 **`{correct, wrong, n}` — it recorded its own 33.8% honestly** |

## **8 required fields. 0 recorded. Per 044: *"Models without provenance are incomplete."***

---

# PART 7 — FAILURE MODE REGISTER

| Failure mode | Present? | Impact |
|---|---|---|
| 🔴 **Silent model changes** | 🔴 **CONFIRMED — THE HEADLINE (§0.1)** | 🔴 **CRITICAL. 8→9 factors, 6 priors changed, baseline 92→99, learned state carried forward untouched** |
| 🔴 **Irreproducible experiments** | 🔴 **CONFIRMED** | 🔴 **The artifact is UNTRACKED. 0 of 25 results carry a gitSha** |
| 🔴 **Untracked deployments** | 🔴 **CONFIRMED** | 🔴 **The re-spec shipped inside `feat(module-5): Smart Money Concepts engine`** |
| 🔴 **Missing feature versions** | 🔴 **CONFIRMED** | 🔴 **No feature store exists** *(035)* |
| 🔴 **Missing datasets** | 🔴 **CONFIRMED** | 🔴 **37 experiments + 14 result sets deleted** *(043)* |
| 🔴 **Undocumented models** | 🔴 **CONFIRMED** | 🔴 **10 of 10 — 0 of 7 governance fields** |
| 🔴 **Configuration drift** | 🔴 **CONFIRMED** | 🔴 **`.env` says 2%, `config-overrides.json` says 5% and wins** *(004)* |
| 🔴 **Two models, same name** | 🔴 **CONFIRMED** | 🔴 **TWO `bsGamma` implementations, 6.79% apart, no ground truth** *(036)* |

## **8 failure modes. 8 CONFIRMED.**

---

# PART 8 & 9 — MDLC ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   ModelRegistry  ★★★   THE PRIMITIVE WHOSE ABSENCE IS §0.
     modelId · VERSION · spec-hash(DEFAULT_WEIGHTS + LEARNABLE) · gitSha · createdAt · stage.
     🔴 A CHANGE TO THE SPEC MINTS A NEW VERSION. It does not silently inherit the old one's state.
     🔴 THE MODEL ARTIFACT CARRIES ITS OWN VERSION. Today it carries nothing, and is not even
        in git — so neither the file nor the repository can say what produced it.

   🔴 SpecGuard  ★★★   — the check that would have caught 2026-07-01 the day it happened
     On load: hash the current LEARNABLE + DEFAULT_WEIGHTS. Compare to the hash in the artifact.
       MATCH    → continue learning.
       MISMATCH → 🔴 REFUSE. The learned state belongs to a DIFFERENT MODEL.
                   Archive it as v1, start v2 from the prior, and SAY SO.
     🔴 Today the code does the opposite: confluence-learner.js:73 BACK-FILLS the missing key
        and carries on, and :150 rescales every old weight by 92→99 to fit the new baseline.
     🔴 reset() ALREADY EXISTS at :187. Nobody called it. (The eleventh built-and-unused component.)

   TrainingRegistry / ValidationRegistry / DeploymentRegistry  ★
     🔴 A model may not be DEPLOYED until it has been VALIDATED. Today there is no deployment
        step at all — the model is redeployed on every boot, in whatever state the file is in.
     🟢 bt-validate.js is the validation layer, and it is CORRECT. It has ZERO callers. (042)

   THE RULE 044 ESTABLISHES:
     🔴 LEARNED STATE IS A FUNCTION OF THE SPECIFICATION THAT PRODUCED IT.
        Change the specification and the learned state is not "slightly stale" — it is EVIDENCE
        FOR A MODEL THAT NO LONGER EXISTS.
```

---

# PART 10 — TESTING STRATEGY

**Reproducibility has priority over model performance.**

| Test | Priority | Fails today? |
|---|---|---|
| 🔴 **A spec change invalidates learned state (SpecGuard)** | **P0 — §0. THE ONE** | ✅ **FAILS — it back-fills and carries on** |
| 🔴 **The model artifact carries a version + spec-hash** | **P0 — §0.3** | ✅ **FAILS — no version field** |
| 🔴 **The model artifact is in version control** | **P0** | ✅ **FAILS — UNTRACKED** |
| 🔴 **No model is deployed without a recorded validation** | **P0** | ✅ **FAILS — 0 of 10 validated** |
| 🔴 **`baselineSum` may not change without a model version bump** | **P0 — 92→99** | ✅ **FAILS** |
| 🔴 **Rollback restores a specific, named version** | P1 | ✅ **FAILS — one `.bak`, 24 h stale** |
| 🟢 **`null` P&L is never counted as a loss** | P1 | 🟢 **PASSES (§0.5). Lock it in** |

---

# PART 11 — MDLC MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Experimental Models** | 🟢 **YES — and this is where it sits** | 10 models, 0 versioned |
| **1 — Repeatable Development** | 🔴 **NO** | 🔴 **The model artifact is UNTRACKED. No version is reproducible** |
| **2 — Managed Model Lifecycle** | 🔴 **NO** | 🔴 **§0: the model was re-specified underneath its own learned state, silently** |
| **3 — Governed MDLC** | 🔴 **NO** | 🔴 **No approval, no deployment step, no retirement policy** |
| **4 — Enterprise AI Engineering** | 🔴 **NO** | — |
| **5 — Institutional Model Platform** | 🔴 **NO** | — |

## ## **MDLC MATURITY: LEVEL 0 — EXPERIMENTAL MODELS.**

---

# PART 12 — MIGRATION ROADMAP

| Phase | Preconditions | Risks | Exit criteria |
|---|---|---|---|
| **1 — INVENTORY** | ✅ **DONE — Part 1. 10 models, 0 versioned** | — | Every model has an ID |
| **2 — 🔴 SPEC-HASH + VERSION (the fix for §0)** | none | 🟢 **LOW — `reset()` already exists at `:187`; the guard is a hash comparison on load** | 🔴 **A spec change can no longer inherit the previous model's learned state** |
| **3 — VERSION CONTROL THE ARTIFACT** | Phase 2 | 🟢 **LOW — it is one line in `.gitignore`** | 🔴 **The model's history becomes reconstructible for the first time** |
| **4 — VALIDATION GATE** | Phase 3 | 🟢 **LOW — `bt-validate.js` is written, tested, correct, and has ZERO callers. Just CALL it** | 🔴 **No model reaches paper trading without a recorded validation** |
| **5 — ENTERPRISE MDLC** | Phase 4 | Medium | Deployment approval · monitoring · retirement |

> **Phase 2 and Phase 3 together cost almost nothing. `reset()` is already written. Removing the artifact
> from `.gitignore` is one line. Between them they close the single worst finding in this document.**

---

# PART 13 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| **Every model has one owner** | 🟢 **YES — 9 of 10 map to one module** · 🔴 **`bsGamma` has TWO** |
| **Every version is reproducible** | 🔴 **NO — there are no versions** |
| Every deployment is approved | 🔴 **NO — there is no deployment step** |
| Every dataset is traceable | 🔴 **NO — the artifact is untracked** |
| Every feature version is documented | 🔴 **NO — no feature store exists** |
| Every retirement is recorded | 🔴 **NO — two models were DELETED instead** *(043)* |
| 🔴 **Unknown model behaviour is never assumed acceptable** | 🔴 **NO — §0.4. The platform assumed v1 ≡ v2 because the file still parsed** |

## **1 of 7.**

---

# STOP CONDITIONS

| Condition | Verdict |
|---|---|
| *Model ownership cannot be established* | 🟢 **DOES NOT FIRE — 9 of 10 have one owner** |
| *Dataset linkage is incomplete* | 🔴 **FIRES — 0 of 6 version linkages** |
| *Validation history is unavailable* | 🔴 **FIRES — no model was ever validated** |
| 🔴 *Version provenance cannot be reconstructed* | 🔴 **FIRES — §0.3. AND IT IS UNRESOLVABLE, NOT MERELY MISSING** |

---

# EXECUTIVE SUMMARY

**The mission: could an independent ML engineer reconstruct the complete lifecycle of any model, reproduce
its training, and determine why a version was promoted or retired?**

## **No. And the reason is the single most precise failure in forty-four documents: the model was re-specified underneath its own learned state, silently, and nothing recorded it.**

> ## 🔴 **ON 2026-07-01, COMMIT `04c35a6` — TITLED *"feat(module-5): Smart Money Concepts engine"* — CHANGED THE MODEL.**
>
> **It added a ninth factor. It changed six of the eight existing priors. And it moved the model's
> normalisation target from 92 to 99.**
>
> ```
>    v1  (8 factors)   trend 18 · oi 16 · news 10 · pcr 12 · greeks 12 · fii 10 · volume 8 · iv 6   → sum 92
>    v2  (9 factors)   trend 16 · smartMoney 14 · oi 15 · news 9 · pcr 11 · greeks 11 · fii 9 · … → sum 99
> ```
>
> **This is not a tuning. It is a different model.**

**And the learned state was carried straight across.**

> **`confluence-learner.js:73` quietly back-filled the new `smartMoney` key into a weights object that had
> been learned under the eight-factor specification, and kept every old weight and every old statistic.
> Then `:150` re-normalised everything to the new baseline — inflating every weight learned under the old
> model by **7.6%**, for a reason that had nothing to do with any trade, any outcome, or any evidence.**
>
> **A `reset()` function exists at line 187. Nobody called it.**

**And the provenance cannot be recovered — this is the stop condition, and it is permanent:**

> ```
>    data/confluence-weights.json
>       version   : NONE      schema : NONE      trainedAt : NONE
>       🔴 git    : UNTRACKED — no version history exists at all
> ```
>
> **The `smartMoney` observation count is lower than its peers — consistent with observations made before
> the factor existed. But `:137` also skips any factor that had no opinion that day. **I cannot tell the
> two apart. Neither can anyone else.** There is no version field, no per-statistic timestamp, and no git
> history for the file.**
>
> ## **The live model's statistics may be a blend of two different model specifications, and the platform has no way to determine which observation belongs to which. That is not a gap I can close by measuring harder. It is UNKNOWN, permanently.**

**What the platform assumed, stated plainly:**

> ## **It assumed model v1 and model v2 were the same model, because the JSON file still parsed and the numbers still looked like weights.**
>
> **044's stop condition, verbatim: *"Never assume two model versions are equivalent because they produce
> similar outputs."* The platform did precisely this. The only reason nobody noticed is that a weight
> vector always looks like a weight vector.**

**And the fix costs almost nothing, which is the recurring shape of this entire programme:**

> **A spec-hash compared on load. `reset()` is **already written**, at line 187 — the eleventh component in
> this repository that is built, correct, and never called. And removing the artifact from `.gitignore` is
> one line. Together they close the worst finding in this document.**

**Credit where it is earned:**

> 🟢 **`confluence-learner.js:126` handles a null P&L correctly — `trade.pnl != null` — so an unknown
> outcome is never silently counted as a loss. In a platform with 119 `|| 0` sites, somebody got the one
> that mattered right.**

## **MDLC maturity: LEVEL 0 — EXPERIMENTAL MODELS. 1 of 7 success criteria. Three of four stop conditions fire, and one of them — version provenance — is not merely unmet. It is unrecoverable.**

---

**Models designed: NONE. Accuracy optimised: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Model Inventory (Part 1) · MDLC Diagram (Part 2) · Development Governance (Part 3) ·
**Version Governance (§0, Part 4)** · Deployment Assessment (Part 5) · Observability (Part 6) · Failure
Mode Register (Part 7) · MDLC Architecture (Parts 8–9) · Testing Strategy (Part 10) · Maturity Assessment
(Part 11) · Migration Roadmap (Part 12) · Executive Summary.

**Stop conditions: ownership — does not fire · dataset linkage 🔴 FIRES · validation history 🔴 FIRES ·
VERSION PROVENANCE 🔴 FIRES (unrecoverable).**
