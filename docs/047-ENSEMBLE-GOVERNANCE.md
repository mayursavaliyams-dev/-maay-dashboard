# 047 — ENSEMBLE LEARNING, MULTI-MODEL GOVERNANCE & CONSENSUS DECISION FRAMEWORK

**Standard:** Master Prompt 047 · **Depends on:** 000-A … 046
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No models created. No ensemble weights optimized.**

**047's stop condition: *"Never assume that combining multiple weak or correlated models automatically
produces a stronger decision."***

**That is a measurable claim, and the data to test it exists: 21 real recorded decisions, each retaining
every leg's score (046 §0.3). So for the first time, the ensemble was measured AS AN ENSEMBLE.**

---

# ═══════════════════════════════════════════════════════════
# SECTION 0 — NINE VOTERS, TWO OF WHOM NEVER VOTE
# ═══════════════════════════════════════════════════════════

## §0.1 — 🔴 Two of the nine ensemble members are PHANTOMS

**Measured across all 21 recorded decisions:**

```
  leg           votes cast   mean |score|   direction split (bull / bear)
  ──────────────────────────────────────────────────────────────────────────
  oi              21/21          63.4        19 / 2     ◀── the LOUDEST leg
  news            21/21          22.4        20 / 1     ◀── 🔴 almost never says "bear"
  pcr             21/21          40.4        14 / 7
  greeks          21/21          14.9        11 / 10    🟢 the only balanced leg
  iv              21/21          23.7        13 / 8
  smartMoney      15/21          26.2        12 / 3
  trend           10/21          23.8         6 / 4
  🔴 volume        0/21            —          NEVER VOTES
  🔴 fii           0/21            —          NEVER VOTES
```

> ## 🔴 **`volume` AND `fii` HAVE NEVER CAST A SINGLE VOTE IN 21 DECISIONS — AND THEY CARRY WEIGHTS OF 8.06 AND 10.08 IN THE MODEL.**
>
> **This is arithmetic, not statistics. Audit 041 found they had `n = 0` observations and non-zero weights.
> 047 explains WHY: they are wired into the ensemble and they never speak. Two of nine members are dead
> seats that still count toward the baseline sum the whole model is normalised against
> (`confluence-learner.js:150`).**
>
> **The ensemble is advertised as nine factors. It is seven.**

## §0.2 — 🔴 And one of the seven is not a vote. It is a constant.

```
  news:  20 BULLISH  /  1 BEARISH   out of 21
  oi  :  19 BULLISH  /  2 BEARISH   out of 21     ← and it is the LOUDEST leg (mean |score| 63.4)
```

> ## 🔴 **`news` VOTED BULLISH IN TWENTY OF TWENTY-ONE DECISIONS. A leg that almost always says the same thing carries ZERO information into an ensemble — it shifts the intercept, it does not discriminate.**
>
> **And `oi` — the loudest voice in the room, at nearly triple the average conviction — is bullish 19 times
> out of 21, and audit 041 measured it as correct **20% of the time in NIFTY**, while carrying the
> second-highest weight in the model.**
>
> **The ensemble's loudest member is its most one-sided member and one of its least accurate.**

## §0.3 — 🔴 The seven that DO vote are not independent

**Pairwise correlation of leg scores across the 21 decisions:**

```
             trend  smart     oi   news    pcr  greek     iv
   trend      1.00  -0.41  -0.63  -0.66  -0.29   0.34   0.54
   smartMon  -0.41   1.00   0.05   0.08  -0.04  -0.35   0.01
   oi        -0.63   0.05   1.00   0.43   0.18  -0.50   0.33
   news      -0.66   0.08   0.43   1.00   0.18  -0.53  -0.31
   pcr       -0.29  -0.04   0.18   0.18   1.00  -0.55  -0.42
   greeks     0.34  -0.35  -0.50  -0.53  -0.55   1.00   0.17
   iv         0.54   0.01   0.33  -0.31  -0.42   0.17   1.00
```

```
   legs that vote                :  7
   🔴 EFFECTIVE INDEPENDENT LEGS :  3.71        (N_eff = n² / ‖C‖_F²)
   diversification achieved      :  45%         (100% = independent · 0% = one vote counted 7×)
```

> ## 🔴 **NINE ADVERTISED FACTORS. SEVEN THAT VOTE. AND THE INFORMATION CONTENT OF ROUGHLY 3.7 INDEPENDENT OPINIONS.**
>
> **`trend` and `news` correlate at −0.66. `trend` and `oi` at −0.63. `greeks` and `pcr` at −0.55. These are
> not independent witnesses — they are measurements of overlapping things (`oi` and `pcr` are both option-flow
> statistics; the ensemble treats them as two separate votes).**
>
> **A weighted vote of correlated members does not average away error. It amplifies the shared error and
> reports a tighter number while doing it.**
>
> ***(Caveat, stated plainly: 21 decisions is a thin sample for a 7×7 correlation matrix. These figures are
> INDICATIVE, not conclusive. But `volume`/`fii` never voting and `news` being 20-for-21 bullish are
> counts, not estimates, and they are certain.)***

## §0.4 — 🔴 The confidence formula rests on an assumption nobody has ever tested

**046 established the confidence the platform displays:**

```js
master-confluence.js:103
   probability = 50 + (Math.abs(net) / 100) * 45 * (0.55 + 0.45 * agreement);
                                                                  ^^^^^^^^^
                              the more the legs AGREE, the higher the confidence shown to the user
```

**The embedded assumption: *when the ensemble agrees, it is more likely to be right.* That is the entire
justification for an ensemble. So I tested it against the platform's own 21 recorded outcomes.**

```
   mean agreement on the  5 WINS    :  69.1%
   mean agreement on the 16 LOSSES  :  75.3%
   difference                       :  −6.1 pp     ◀── agreement is HIGHER when it LOSES

   the ONE unanimous decision (7 of 7 legs agreed, id 1016)  ──▶  🔴 LOSS

   permutation test, 100,000 seeded shuffles:   one-sided p = 0.209
```

## 🔴 **AND HERE I STOP, BECAUSE p = 0.209 IS NOT SIGNIFICANT.**

> **Five wins against sixteen losses is badly underpowered. I will NOT claim that agreement predicts
> failure — that would be exactly the error audit 019 documented, where an AUC of 0.685 on twelve samples
> *looked* like skill and was chance (p = 0.191).**
>
> **The honest finding is narrower, and it is worse:**
>
> ## 🔴 **THERE IS NO EVIDENCE — IN EITHER DIRECTION — THAT ENSEMBLE AGREEMENT PREDICTS SUCCESS. AND THE PLATFORM'S CONFIDENCE FORMULA ASSUMES IT DOES.**
>
> **Every time the legs line up, the number shown to the user goes up. That term was never validated. It
> was never checked. And the only twenty-one data points the platform possesses lean, weakly and
> insignificantly, THE WRONG WAY — with the single unanimous call in the entire history being a loss.**
>
> **047's stop condition, verbatim: *"Never assume that combining multiple weak or correlated models
> automatically produces a stronger decision."* The confidence formula is that assumption, hard-coded, in
> production, on six dashboards.**

---

# PART 1 — MODEL INVENTORY (ensemble members)

| ID | Leg | Type | Votes | Accuracy *(041)* | Verdict |
|---|---|---|---|---|---|
| **E-1** | `trend` | Trend | 10/21 | 60% NIFTY · 40% SENSEX · **n=0 BANKNIFTY** | 🟡 the best leg, and it abstains half the time |
| **E-2** | `smartMoney` | Structure | 15/21 | 29% · 17% · 50% | 🔴 **poor** |
| 🔴 **E-3** | `oi` | Option flow | 21/21 | 🔴 **20% · 29% · 25%** | 🔴 **THE LOUDEST LEG (63.4). 19/21 bullish. 2nd-highest weight** |
| 🔴 **E-4** | `volume` | Liquidity | 🔴 **0/21** | 🔴 **n = 0** | 🔴 **PHANTOM — never votes, carries weight 8.06** |
| 🔴 **E-5** | `news` | Sentiment | 21/21 | 🔴 **20% · 29% · 0%** | 🔴 **20/21 BULLISH — a constant, not a vote** |
| **E-6** | `pcr` | Option flow | 21/21 | 40% · 29% · **100% (n=4)** | 🔴 correlated with `oi` — same underlying data |
| **E-7** | `greeks` | Derivatives | 21/21 | 40% · 43% · 50% | 🟢 **the ONLY balanced leg (11 bull / 10 bear)** |
| 🔴 **E-8** | `fii` | Flow | 🔴 **0/21** | 🔴 **n = 0** | 🔴 **PHANTOM — never votes, carries weight 10.08** |
| **E-9** | `iv` | Volatility | 21/21 | 30% · 29% · 50% | 🔴 poor |
| **E-R1** | `event` / `delivery` | Risk legs | — | — | 🟡 **trim probability; can force HOLD. Correctly separated** |

## **9 members. 2 never vote. 1 is a near-constant. 2 measure the same thing. Effective independent opinions: ~3.7.**

---

# PART 2 — ENSEMBLE LIFECYCLE

```
  Market Data          🟢
       ↓
  🔴 Feature Eng.      🔴  computed, then DISCARDED  (035)
       ↓
  Individual Eval.     🟡  7 of 9 legs actually produce a score  (§0.1)
       ↓
  Consensus Gen.       🟢  fuse() — confidence-weighted mean. Pure, readable, deterministic
       ↓
  🔴 Conflict Res.     🔴  see Part 4 — there is no conflict POLICY, only an average
       ↓
  🔴 Confidence Asmt.  🔴🔴  ══ an UNVALIDATED agreement term (§0.4) ══
       ↓
  🔴 Human Review      🔴  DOES NOT EXIST  (046)
       ↓
  Decision             🔴  5 wins in 21
       ↓
  Audit                🟡  21/21 keep the leg table 🟢 · 1/21 keeps the confidence 🔴  (046)
```

---

# PART 3 — CONSENSUS GOVERNANCE

| Mechanism | Supported? |
|---|---|
| Majority voting | 🔴 **NO — it is a weighted MEAN, not a vote count** |
| 🟢 **Weighted voting** | 🟢 **YES — `sSum / wSum`, weight × confidence** |
| 🟢 **Rule-based consensus** | 🟢 **YES — `net ≥ buyThreshold(12)` → BUY** |
| 🟡 **Hierarchical decision** | 🟡 **PARTIAL — risk legs can DEMOTE a fired signal to HOLD. This is the best-designed part of the engine** |
| 🔴 **Confidence-aware aggregation** | 🟡 **YES mechanically** (`weight × confidence/100`) · 🔴 **but leg `confidence` DEFAULTS TO 60 when absent — a fabricated number** |
| 🟢 **Abstention handling** | 🟢 **YES — `available: false` legs are excluded, and `minFactors: 4` blocks a decision on too few legs** |

> 🟢 **Credit: `minFactors = 4` and the `available: false` path are correct abstention handling. The engine
> refuses to decide when too few legs report. That is fail-closed behaviour, and it is right.**
>
> 🔴 **But `master-confluence.js:56` — `confidence: clamp(Number(f.confidence == null ? 60 : f.confidence), …)`
> — invents a confidence of **60** for any leg that does not supply one. That 60 then multiplies the leg's
> weight in the consensus. `Unknown ≠ 60`.**

---

# PART 4 — MODEL CONFLICTS

| Situation | Policy |
|---|---|
| **Models disagree** | 🔴 **NO POLICY — they are averaged. A 7-way split and a 4-3 split produce the same `net` if the weights work out** |
| **Confidence differs significantly** | 🟡 handled mechanically (confidence scales weight) — 🔴 **but a missing confidence becomes 60** |
| 🟢 **One model abstains** | 🟢 **HANDLED — excluded; `minFactors: 4` guards the floor** |
| 🟢 **Multiple models fail** | 🟢 **HANDLED — below 4 legs → `decision: HOLD`, `conviction: 'INSUFFICIENT'`. Fail-closed. Correct** |
| **Inputs incomplete** | 🟡 same path |
| 🔴 **Market conditions ambiguous** | 🔴 **NO REGIME AWARENESS AT ALL. And audit 045 measured the strategy LOSING MONEY at realised vol ≥ 15%** |

## 🔴 **Conflict resolution is an ARITHMETIC MEAN. There is no policy that distinguishes "the legs disagree because the market is genuinely ambiguous" from "the legs disagree because two of them are broken."**

---

# PART 5 — MODEL DIVERSITY — 🔴 **THE CORE FINDING**

| Dimension | Assessed? | Result |
|---|---|---|
| 🔴 **Feature overlap** | 🟢 **MEASURED** | 🔴 **`oi` and `pcr` are both option-flow statistics, counted as independent votes** |
| 🔴 **Error correlation** | 🟢 **MEASURED (§0.3)** | 🔴 **N_eff = 3.71 of 7. 45% diversification** |
| 🔴 **Decision diversity** | 🟢 **MEASURED (§0.2)** | 🔴 **`news` is 20/21 bullish. `oi` is 19/21 bullish. These are biases, not opinions** |
| 🔴 **Dependency relationships** | 🟢 **MEASURED** | 🔴 **trend↔news −0.66 · trend↔oi −0.63 · greeks↔pcr −0.55** |
| 🔴 **Common failure modes** | 🟢 **MEASURED** | 🔴 **046 trade 1004: `oi` +92.1 and `pcr` +88 both screamed bullish → LOSS. Two correlated legs, one shared error, double the confidence** |

> ## **047: *"High agreement alone is not evidence of diversity."* In this ensemble, high agreement is evidence of the OPPOSITE: the legs that agree most are the legs that measure the same thing.**

---

# PART 6 — OBSERVABILITY

| Every ensemble decision must record | Present? |
|---|---|
| 🟢 **Contributing models** | 🟢 **YES — 21/21** |
| 🔴 **Model versions** | 🔴 **NO — the model has no version and was silently re-specified** *(044)* |
| 🟢 **Individual outputs** | 🟢 **YES — every leg's score, 21/21. Excellent** |
| 🟢 **Consensus method** | 🟢 **YES — `fuse()` is pure and readable** |
| 🟢 **Final decision** | 🟢 **YES** |
| 🔴 **Confidence** | 🔴 **1 of 21** *(046)* |
| 🟢 **Timestamp** | 🟢 **YES** |

## **7 fields. 5 recorded. The two missing — version and confidence — are the two that make a decision reproducible.**

---

# PART 7 — FAILURE MODE REGISTER

| Failure mode | Present? | Impact |
|---|---|---|
| 🔴 **Dominant model bias** | 🔴 **CONFIRMED** | 🔴 **`oi` is the loudest leg (63.4 vs ~24 average), 19/21 bullish, and 20% accurate** |
| 🔴 **Correlated failures** | 🔴 **CONFIRMED** | 🔴 **N_eff 3.71 of 7. `oi`+`pcr` fail together — they read the same data** |
| 🔴 **Hidden weighting** | 🔴 **CONFIRMED** | 🔴 **The user sees "78% probability". The weights behind it changed silently on 2026-07-01** *(044)* |
| 🔴 **Missing contributors** | 🔴 **CONFIRMED — LITERALLY** | 🔴 **`volume` and `fii`: 0 votes in 21 decisions, non-zero weight (§0.1)** |
| 🔴 **Consensus instability** | 🔴 **CONFIRMED** | 🔴 **`baselineSum` moved 92 → 99, rescaling every weight by 7.6% with no evidence** *(044)* |
| 🔴 **Unsupported overrides** | 🟡 **PARTIAL** | 🟢 the risk-leg demotion to HOLD is well-designed · 🔴 **the `confidence ?? 60` default is a fabrication** |
| 🟡 **Circular dependencies** | 🟡 **NOT DETECTED** | 🟢 the legs read market data, not each other |

---

# PART 8 & 9 — ENSEMBLE ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   🔴 DiversityRegistry  ★★★   — THE PRIMITIVE WHOSE ABSENCE IS §0.3
     An ensemble member EARNS ITS SEAT by contributing INDEPENDENT information.
       • A leg that has never voted is REMOVED, not weighted.        (volume, fii — §0.1)
       • A leg that votes the same way 20 of 21 times is a BIAS TERM, not a voter.  (news)
       • Correlated legs share ONE seat, not two.                    (oi + pcr)
     🔴 N_eff, not N, is the ensemble's real size. Here: 3.7, advertised as 9.

   🔴 AgreementValidator  ★★★   — the term nobody checked
     The confidence formula multiplies by (0.55 + 0.45 × agreement).
     🔴 THAT TERM IS A HYPOTHESIS. It must be SCORED against outcomes before it is trusted.
        Today: 21 decisions, agreement 6.1pp HIGHER on losses, p=0.209 (not significant),
        and the only unanimous call in history LOST. That is not proof it is backwards —
        it is proof NOBODY HAS EVER LOOKED.

   ConsensusEngine  ★
     🟢 fuse() IS this engine and it is well-built: pure, deterministic, readable,
        with genuine abstention handling (minFactors: 4) and a risk-leg veto.
     🔴 It has no concept of DIVERSITY. It averages nine numbers and does not ask
        whether they are nine opinions or three opinions repeated.

   THE RULE 047 ESTABLISHES:
     🔴 AN ENSEMBLE OF CORRELATED WEAK MODELS IS NOT A STRONG MODEL.
        It is a weak model that reports a tighter confidence interval.
        Averaging reduces variance ONLY when errors are independent. When they are not,
        the ensemble amplifies the shared error AND raises the stated confidence for it.
```

---

# PART 10 — TESTING STRATEGY

**Reproducibility has priority over ensemble complexity.**

| Test | Priority | Fails today? |
|---|---|---|
| 🔴 **A leg with 0 votes carries 0 weight** | **P0 — §0.1** | ✅ **FAILS — `volume` 8.06, `fii` 10.08** |
| 🔴 **The `agreement` term is scored against outcomes before it is trusted** | **P0 — §0.4** | ✅ **FAILS — never checked** |
| 🔴 **`N_eff` is computed and reported alongside `N`** | **P0 — §0.3** | ✅ **FAILS — never computed** |
| 🔴 **A missing leg confidence is UNKNOWN, never 60** | **P0** | ✅ **FAILS — `f.confidence == null ? 60`** |
| 🔴 **Every decision records the model version** | **P0** *(044)* | ✅ **FAILS** |
| 🟢 **`minFactors` blocks a decision on too few legs** | P0 | 🟢 **PASSES — fail-closed, correct. Lock it in** |
| 🟢 **A severe risk leg demotes a fired signal to HOLD** | P0 | 🟢 **PASSES — well-designed. Lock it in** |
| 🟢 **`fuse()` is pure and deterministic** | P1 | 🟢 **PASSES** |

---

# PART 11 — ENSEMBLE MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Single Model** | 🟢 **SURPASSED** | A real multi-model fusion exists |
| **1 — Basic Voting** | 🟢 **YES** | 🟢 **Weighted, confidence-scaled, with abstention and a risk veto — genuinely competent** |
| **2 — Managed Ensembles** | 🔴 **NO** | 🔴 **2 of 9 members have NEVER VOTED and still carry weight** |
| **3 — Governed Multi-Model** | 🔴 **NO** | 🔴 **No diversity measurement ever performed. N_eff = 3.71 of 7** |
| **4 — Enterprise Ensemble** | 🔴 **NO** | 🔴 **The `agreement` term in the confidence formula has never been validated** |
| **5 — Institutional Consensus** | 🔴 **NO** | — |

## ## **ENSEMBLE MATURITY: LEVEL 1 — BASIC VOTING.**

---

# PART 12 — MIGRATION ROADMAP

| Phase | Preconditions | Risks | Exit criteria |
|---|---|---|---|
| **1 — INVENTORY** | ✅ **DONE — Part 1. 9 members, 2 phantoms** | — | Every member identified |
| **2 — 🔴 EVICT THE PHANTOMS (do this first — it is free)** | 🟢 **none. `volume` and `fii` have 0 votes in 21 decisions** | 🟢 **ZERO — they contribute nothing today except a baseline-sum distortion** | 🔴 **A leg with 0 observations carries 0 weight, or is removed** |
| **3 — MEASURE DIVERSITY** | Phase 2 | 🟢 LOW | 🔴 **`N_eff` reported beside `N`. Correlated legs share a seat** |
| **4 — VALIDATE THE AGREEMENT TERM** | Phase 3 + confidence persistence *(046)* | 🟡 **it may turn out to be backwards** | 🔴 **The `(0.55 + 0.45 × agreement)` term is scored against real outcomes, or removed** |
| **5 — INSTITUTIONAL** | Phase 4 | Low | Versioned, diversity-governed, auditable consensus |

---

# PART 13 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| 🟢 **Every contributing model is identified** | 🟢 **YES — 21/21 record the full leg table** |
| 🟢 **Consensus logic is documented** | 🟢 **YES — `fuse()` is pure and readable** |
| 🟡 **Conflicts handled consistently** | 🟡 **PARTIAL — abstention and the risk veto are CORRECT; disagreement is just averaged** |
| 🔴 **Confidence aggregation is transparent** | 🔴 **NO — the `agreement` term is an unvalidated assumption (§0.4)** |
| 🔴 **Decisions are reproducible** | 🔴 **NO — no model version** *(044)* |
| 🔴 **Unknown model behaviour is never silently ignored** | 🔴 **NO — `volume` and `fii` have NEVER VOTED and nobody noticed (§0.1)** |
| 🟢 **Ensemble outputs remain auditable** | 🟢 **YES — the leg table, 21/21** |

## **3.5 of 7.**

---

# STOP CONDITIONS

| Condition | Verdict |
|---|---|
| *Model relationships cannot be reconstructed* | 🟢 **DOES NOT FIRE — I reconstructed the full correlation matrix (§0.3)** |
| *Consensus logic cannot be explained* | 🟢 **DOES NOT FIRE — `fuse()` is pure and readable** |
| *Conflict resolution is undocumented* | 🔴 **FIRES — there is no disagreement policy. There is an average** |
| *Decision provenance is incomplete* | 🔴 **FIRES — no model version *(044)*; 20 of 21 confidences discarded *(046)*** |

---

# EXECUTIVE SUMMARY

**The mission: could an independent AI engineer identify every contributing model, reproduce the consensus,
assess diversity, and judge whether the ensemble is reliable?**

## **Yes. And the ensemble advertises nine members, seven of which vote, carrying the information of about three and a half.**

> ## 🔴 **`volume` AND `fii` HAVE NEVER CAST A VOTE. Not once in twenty-one recorded decisions. And they carry weights of 8.06 and 10.08.**
>
> **This is a count, not an estimate. Audit 041 found they had zero observations and non-zero weights;
> 047 shows why — they are wired into the ensemble and they never speak. They still count toward the
> baseline sum that every other weight is normalised against.**

> ## 🔴 **AND `news` VOTED BULLISH TWENTY TIMES OUT OF TWENTY-ONE.**
>
> **That is not a vote. It is a constant. A leg that almost always says the same thing shifts the intercept
> and discriminates nothing.**
>
> **Meanwhile `oi` — the LOUDEST leg in the ensemble, at nearly triple the average conviction — is bullish
> 19 times out of 21, and is right **20% of the time** (041), while carrying the second-highest weight.**

> ## 🔴 **AND THE SEVEN THAT VOTE ARE NOT INDEPENDENT.**
>
> ```
>    trend ↔ news    −0.66          legs that vote           :  7
>    trend ↔ oi      −0.63          EFFECTIVE INDEPENDENT    :  3.71
>    greeks ↔ pcr    −0.55          diversification achieved :  45%
> ```
>
> **`oi` and `pcr` are both option-flow statistics. The ensemble counts them as two separate witnesses.
> When they fail, they fail together — as they did in decision 1004, where `oi` scored +92.1 and `pcr`
> scored +88, the model bought with conviction, and lost ₹935.**
>
> ## **Averaging reduces error ONLY when the errors are independent. When they are not, the ensemble amplifies the shared mistake and reports a TIGHTER confidence while doing it.**

**And then the term at the heart of the whole thing:**

> **The confidence shown to the user is `50 + |net|/100 × 45 × (0.55 + 0.45 × agreement)`. Every time the
> legs line up, the displayed number goes up. That is the ensemble premise, hard-coded.**
>
> **So I tested it against the platform's own twenty-one outcomes:**
>
> ```
>    mean agreement on the  5 WINS   : 69.1%
>    mean agreement on the 16 LOSSES : 75.3%      ← HIGHER when it loses
>    the one unanimous decision in the entire history (7 of 7 legs) ──▶ LOSS
>    permutation test, 100,000 shuffles:  p = 0.209
> ```
>
> ## 🔴 **AND HERE I STOP. p = 0.209 IS NOT SIGNIFICANT. Five wins against sixteen losses is badly underpowered, and claiming "agreement predicts failure" would be exactly the error audit 019 documented — an AUC of 0.685 on twelve samples that looked like skill and was chance.**
>
> **The honest finding is narrower, and worse:**
>
> ## **THERE IS NO EVIDENCE, IN EITHER DIRECTION, THAT ENSEMBLE AGREEMENT PREDICTS SUCCESS — AND THE CONFIDENCE FORMULA ASSUMES IT DOES. The term was never validated. It was never checked. The only twenty-one data points in existence lean, weakly and insignificantly, the wrong way, and the sole unanimous call in the platform's history was a loss.**
>
> **047's stop condition, word for word: *"Never assume that combining multiple weak or correlated models
> automatically produces a stronger decision."* That assumption is not a risk here. It is a line of code,
> in production, feeding six dashboards.**

**Credit where it is due — and there is real credit:**

> 🟢 **`fuse()` is a well-built consensus engine: pure, deterministic, readable, confidence-weighted, with
> genuine abstention handling (`minFactors: 4` refuses to decide on too few legs — fail-closed and correct)
> and a risk-leg veto that can demote a fired signal to HOLD. That veto is one of the best-designed pieces
> of logic in the repository.**
>
> **The engine is sound. Its members are not.**

**And the first fix is free:**

> ## **Evict the phantoms. `volume` and `fii` have zero votes in twenty-one decisions and contribute nothing except a distortion of the baseline sum that every other weight is normalised against. A leg with zero observations must carry zero weight. That is `Unknown ≠ Prediction`, applied to an ensemble seat.**

## **Ensemble maturity: LEVEL 1 — BASIC VOTING. 3.5 of 7. The consensus mechanism is competent. It is averaging three and a half correlated opinions and calling the result nine.**

---

**Models created: NONE. Ensemble weights optimized: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Model Inventory (Part 1) · Ensemble Lifecycle (Part 2) · Consensus Governance (Part 3) ·
Conflict Resolution (Part 4) · **Model Diversity Report (§0, Part 5)** · Observability (Part 6) · Failure
Mode Register (Part 7) · Ensemble Architecture (Parts 8–9) · Testing Strategy (Part 10) · Maturity (Part 11) ·
Roadmap (Part 12) · Executive Summary.

**Stop conditions: model relationships — does not fire · consensus logic — does not fire ·
CONFLICT RESOLUTION 🔴 FIRES · DECISION PROVENANCE 🔴 FIRES.**
