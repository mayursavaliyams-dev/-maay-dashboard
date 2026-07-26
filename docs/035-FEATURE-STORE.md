# 035 — FEATURE STORE, FEATURE ENGINEERING & ML DATA GOVERNANCE

**Standard:** Master Prompt 035 · **Depends on:** 000-A … 034
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No ML model redesigned. No feature calculation changed.**

---

# SECTION 0 — 035's OWN STOP CONDITION, PROVEN NUMERICALLY

**035: *"Never assume two features are equivalent because they have the same name."***

## **I fed the duplicated features identical inputs and compared their answers.**

---

## 🔴 §0.1 — `bsGamma` — same name, same inputs, **different answers**

```js
gex-skew.js:18      function bsGamma(S, K, T, sigma, r = 0.065)
vol-context.js:42   function bsGamma(S, K, sigma, T)              // r = 0, implicit
```

**Identical market state: S = 24,000 · K = 24,500 · T = 7/365 · σ = 0.14**

```
  gex-skew.bsGamma(S, K, T, sigma)      =  5.2547e-4
  vol-context.bsGamma(S, K, sigma, T)   =  4.9206e-4
  ─────────────────────────────────────────────────────
  DIVERGENCE                            =  6.79%
```

**Both are reachable from `server.js` (`:25` and `:29`). Two gamma numbers. One dashboard.**

## 🔴 §0.2 — **And the parameter order is SWAPPED. Measured cost: −92%.**

**If a developer copies a call site from `gex-skew` into `vol-context` — the natural thing to do when
two functions share a name — `T` and `σ` are silently exchanged:**

```
  volGamma(S, K, T=0.0192, sigma=0.14)   =  3.7703e-5     ← what you get
  volGamma(S, K, sigma=0.14, T=0.0192)   =  4.9206e-4     ← what you meant
  ─────────────────────────────────────────────────────────
  ERROR                                   =  −92%
```

> ## **A plausible-looking number. Correct order of magnitude for a gamma. No exception. No warning. No test.**
>
> **This is exactly the failure 035's stop condition exists to prevent, and it is sitting in the
> codebase right now.**

---

## 🔴 §0.3 — **THE DEFAULT THAT ENCODES AN INVALIDATED RESULT**

```js
position-sizer.js:119
  const fullKelly = kelly(p.winRate ?? 0.9, p.avgWin ?? 2900, p.avgLoss ?? -3500);
                                     ↑
                              a 90% win rate — as a DEFAULT
```

**Where does 0.9 come from?**

| Source | Win rate |
|---|---|
| 🔴 **The INVALIDATED look-ahead backtest** | **88.4%** *(PF 7.41)* |
| 🟢 **The HONEST backtest, after the 002 fix** | **51.2%** *(DSR 0.0008 — `FAIL (likely overfit)`)* |

**Feed both into the platform's own Kelly function:**

```
  kelly(winRate = 0.900, avgWin = 2900, avgLoss = -3500)  =  +0.7793
  kelly(winRate = 0.512, avgWin = 2900, avgLoss = -3500)  =  −0.0770
```

> ## 🔴 **A NEGATIVE KELLY MEANS: DO NOT BET.**
>
> **At the platform's honest, measured win rate, the mathematically correct position size is ZERO.**
>
> **And the sizer's DEFAULT — the value it uses when nobody tells it otherwise — is a win rate taken
> from a backtest that this audit programme proved was an artefact of look-ahead bias.**
>
> **`position-sizer.js` is required by `strangle-engine.js` — the ₹7 lakh iron condor.**

**Mitigating fact, measured:** `STRANGLE_USE_SIZER` defaults to `'false'` *(014 §0.2)*, so the sizer is
**currently disabled**. **The bomb is armed and the fuse is unlit** — and the only reason is a flag that
was never set.

> **035 asks whether feature provenance is complete. This feature — `winRate` — has a default whose
> provenance is a refuted experiment, and nothing in the codebase records that.**

---

## 🔴 §0.4 — **TRAINING-SERVING SKEW, CONFIRMED**

**Three Kelly implementations. Different signatures. Different consumers.**

```
  position-sizer.js:73    kelly(winRate, avgWin, avgLoss)      ← 3 args
      └── used by: strangle-engine.js          (the ₹7L iron condor)

  trade-planner.js:28     halfKelly(winRate, payoff)           ← 2 args
      └── used by: server.js                   (the dashboard's trade plan)

  vix-kelly-sizer.js:19   halfKelly(winRate, payoff)           ← 2 args
      └── used by: trade-planner.js            (which ALSO defines its own halfKelly)
```

> ## **The engine that trades and the dashboard that displays the plan compute position size with DIFFERENT FUNCTIONS, taking DIFFERENT ARGUMENTS.**
>
> **And `trade-planner.js` imports `vix-kelly-sizer` — which contains a function with the *same name* as
> one `trade-planner` already defines. Two `halfKelly`s in a single dependency chain.**

## 🟡 §0.5 — A correction to my own grep, and the truth is worse

**My scan reported `expectedMove` as duplicated across `vol-context.js` and `bt-world-strategies.js`.
That was wrong — I read it before publishing it.**

```
  vol-context.js:52          function expectedMove(spot, atmStraddle, ivPct, dteDays)
  bt-world-strategies.js:99  function expectedMovePts(day)        ← A DIFFERENT NAME
```

> **They are not duplicates by name. They are **the same concept, computed differently, under different
> names** — one for live, one for research.**
>
> ## **035 warns: *"never assume two features are equivalent because they have the same name."***
> ## **The corollary is worse, and it is what is actually here: two features may be the SAME FEATURE, computed DIFFERENTLY, under DIFFERENT names — and nothing will ever compare them.**

---

# PART 1 — FEATURE INVENTORY

| Feature | Implementations | Owner | Consistent? | Confidence |
|---|---|---|---|---|
| **EMA** | `server.js` (cached, `EMA_TTL_MS`) | 🔴 none | ⚪ single | MEDIUM |
| **SMA** | `strangle-engine` (trend SMA) | 🔴 none | ⚪ | MEDIUM |
| **VWAP** | `strategy.js` `calculateVWAP` | 🟢 **1** | 🟢 | HIGH |
| **RSI / MACD / ATR** | ⚪ **NOT FOUND** | — | — | HIGH |
| **Volume** | 🔴 **NOT MAPPED INTO `opts[]`** *(033 §0.5)* | 🔴 **NOBODY** | 🔴 **invisible to every strategy** | HIGH |
| **Open Interest** | raw `oi` | 🔴 **NOBODY** | 🔴 **`oiUnit` UNKNOWN since audit 006** | HIGH |
| **OI Change** | `free-chain.js` | 🔴 none | 🔴 `\|\| 0` | MEDIUM |
| **IV** | `option-analyzer._impliedVol` | 🟡 1 | 🔴 **21.7% of live IVs are COMPUTED, not observed** | MEDIUM |
| 🔴 **Greeks / Gamma** | 🔴 **`bsGamma` × 2** | 🔴 **NOBODY** | 🔴 **6.79% divergence · −92% if mis-called (§0.1–0.2)** | **HIGH** |
| 🔴 **GEX** | `gex-skew` · `vol-context` | 🔴 **NOBODY** | 🔴 **Two implementations, two `r`, OPPOSITE dealer signs** | **HIGH** |
| **Dealer positioning** | `vol-context:89` | 🟡 | 🟢 **HONEST — `:73` declares "Sign is an ASSUMPTION"** | MEDIUM |
| **Expected move** | 🔴 **2 (different names)** | 🔴 **NOBODY** | 🔴 **§0.5** | HIGH |
| 🔴 **Kelly** | 🔴 **3** | 🔴 **NOBODY** | 🔴 **§0.4 — different signatures, different consumers** | **HIGH** |
| **PCR / max-pain** | `option-analyzer` | 🟡 1 | 🟡 | MEDIUM |
| 🔴 **AI scores** (9 factors) | `confluence-learner` | itself | 🔴 **`fii` and `volume` vote with n = 0** *(016 §0)* | HIGH |
| **Candlestick patterns** | `candlestick-patterns.js` | itself | 🔴 **ships a `"backtest-grounded"` reliability for a backtest that does not exist** | HIGH |

## **Sixteen feature families. One has a single, verified implementation (`VWAP`). Four have multiple, divergent ones. Zero have an owner.**

---

# PART 2 — FEATURE LIFECYCLE

```
  Raw Data ──▶ Validate ──▶ Transform ──▶ Calculate ──▶ Validate ──▶ FEATURE STORE ──▶ Research ──▶ Train ──▶ Infer ──▶ Monitor
      ↓           ↓             ↓            ↓             ↓              ↓                ↓           ↓         ↓         ↓
      │           │             │            │             │              │                │           │         │         └── 🔴 no drift
      │           │             │            │             │              │                │           │         └── 🔴 features
      │           │             │            │             │              │                │           │             DISCARDED
      │           │             │            │             │              │                │           └── 🔴 online, in prod,
      │           │             │            │             │              │                │               no held-out set
      │           │             │            │             │              │                └── 🔴 research uses DIFFERENT
      │           │             │            │             │              │                    feature code from live (§0.5)
      │           │             │            │             │              └──🔴🔴 **DOES NOT EXIST.**
      │           │             │            │             └── 🔴 NONE
      │           │             │            └── 🔴 §0: same name ≠ same feature
      │           │             └── 🔴 lot & volume never mapped (033)
      │           └── 🔴 `|| 0` × 119
      └── 🟡 6 connectors, no port.
```

## ## **THE FEATURE STORE — THE CENTRAL COMPONENT THIS ENTIRE PROMPT IS ABOUT — DOES NOT EXIST.**

**Every feature in this platform is computed, used for a single decision, and destroyed.**

---

# PART 3 — FEATURE GOVERNANCE

| Aspect | Verdict |
|---|---|
| **Versioning** | 🔴 **NONE. No feature has a version** |
| **Naming standards** | 🔴 **NONE — and §0 shows the cost: two `bsGamma`s, three Kellys, one concept under two names** |
| 🔴 **Units** | 🔴 **`oiUnit` has been UNKNOWN since audit 006. If the broker chain reports units, every GEX is wrong by 65×** |
| **Scaling** | 🔴 **Undeclared** |
| 🔴 **Missing-value handling** | 🔴 **`\|\| 0` × 119. And `gex-skew.js:49` FABRICATES an IV of 0.14** |
| 🔴 **Temporal alignment** | 🔴 **`days[i-1]` is the previous FILE, not the previous TRADING DAY** *(031 §0.3)* |
| **Update frequency** | 🟡 Per tick / per request |

---

# PART 4 — TRAINING / SERVING CONSISTENCY

| Path | Feature code used |
|---|---|
| **Historical research** (`bt-*`) | `bt-lib` + per-script inline maths — 🔴 **volume and lot NOT AVAILABLE** |
| **Backtesting** | same | |
| **Paper trading** | `option-analyzer` · `gex-skew` · `vol-context` · `multiconfirm` | |
| **Live trading** | **the same as paper** 🟢 | |
| **AI training** | `confluence-learner`, **online, in production** | |
| **AI inference** | **the same code** 🟢 | |

## 🔴 **The divergence, precisely located**

| # | Divergence |
|---|---|
| **1** | 🔴 **RESEARCH vs LIVE.** The backtests cannot see volume or the true lot *(033 §0.5, 032 §0)*. The live path can see volume — and does not use it |
| **2** | 🔴 **`expectedMove` — one implementation for live, a differently-named one for research** *(§0.5)* |
| **3** | 🔴 **Kelly — `strangle-engine` uses `position-sizer.kelly(3 args)`; `server.js` uses `trade-planner.halfKelly(2 args)`** *(§0.4)* |
| **4** | 🔴 **Gamma — `gex-skew` and `vol-context` disagree by 6.79%, and both feed the same dashboard** *(§0.1)* |
| 🟢 **5** | 🟢 **Paper and live DO use identical feature code.** The one consistency that holds |

## ## **035's stop condition: *"Stop and report UNKNOWN if training-serving consistency cannot be verified."* → FOUR CONFIRMED DIVERGENCES.**

---

# PART 5 — FEATURE QUALITY

| Dimension | Verdict |
|---|---|
| **Completeness** | 🔴 **`\|\| 0` × 119. A missing feature becomes a valid-looking zero** |
| **Freshness** | 🔴 **No consumer checks a feature's age before trading on it** |
| 🟢 **Determinism** | 🟢 **YES — no randomness, no clock inside any feature calculation** |
| **Statistical stability** | 🔴 **NEVER MEASURED** |
| **Missing values** | 🔴 **Silently repaired, never flagged** |
| **Drift detection** | 🔴 **DOES NOT EXIST — and drift against what baseline? None is calibrated** |
| 🔴 **Bias detection** | 🔴 **NONE. And §0.3 shows a feature DEFAULT that encodes an invalidated experiment** |

---

# PART 6 — FEATURE STORE GOVERNANCE

| Capability | Present? |
|---|---|
| **Central feature registry** | 🔴 **NO** |
| **Feature versioning** | 🔴 **NO** |
| **Metadata** | 🔴 **NO** |
| **Ownership** | 🔴 **NO — zero features have an owner** |
| **Access control** | 🔴 **NO** |
| **Provenance** | 🔴 **NO — and §0.3 shows the cost** |
| **Reproducibility** | 🔴 **IMPOSSIBLE — the inputs are destroyed on every inference** |

## ## **FEATURE STORE MATURITY: LEVEL 0. IT DOES NOT EXIST.**

---

# PART 7 — OBSERVABILITY

| Required per feature | Recorded? |
|---|---|
| Feature version | 🔴 **NO** |
| Calculation timestamp | 🔴 **NO** |
| **Source datasets** | 🔴 **NO** |
| **Transformation history** | 🔴 **NO** |
| Validation status | 🔴 **NO** |
| Confidence | 🔴 **NO** |
| Drift metrics | 🔴 **NO** |

## **0 of 7. *"Features without provenance are unsuitable for ML."***

---

# PART 8 — FAILURE MODE REGISTER

| ID | Failure | Present? | Impact |
|---|---|---|---|
| **FS-1** | 🔴 **No feature store — inputs discarded on every inference** | 🔴 **CONFIRMED** | 🔴 **CRITICAL. IRREVERSIBLE. Worsens every day** |
| **FS-2** | 🔴 **Two `bsGamma`s: 6.79% divergence, −92% if mis-called** | 🔴 **CONFIRMED, QUANTIFIED (§0.1–0.2)** | 🔴 **CRITICAL** |
| **FS-3** | 🔴 **A feature DEFAULT (`winRate = 0.9`) encodes an INVALIDATED backtest** | 🔴 **CONFIRMED (§0.3)** | 🔴 **CRITICAL. At the honest win rate, Kelly is NEGATIVE — bet zero** |
| **FS-4** | 🔴 **Training-serving skew: 3 Kellys, 2 expectedMoves, 2 gammas** | 🔴 **CONFIRMED (§0.4–0.5)** | 🔴 **CRITICAL** |
| **FS-5** | 🔴 **Inconsistent units — `oiUnit` UNKNOWN since audit 006** | 🔴 **CONFIRMED** | 🔴 **CRITICAL. Potential 65× error in every GEX** |
| **FS-6** | 🔴 **Data leakage — 7 of 8 scripts read the future** | 🔴 **CONFIRMED** | 🔴 **CRITICAL** |
| **FS-7** | 🔴 **A fabricated IV of 0.14 substituted for a missing one** | 🔴 **CONFIRMED — `gex-skew.js:49`** | 🔴 **HIGH. It invents a market observation** |
| **FS-8** | 🔴 **Drift undetectable — no baseline exists** | 🔴 **CONFIRMED** | HIGH |
| 🟢 **FS-9** | **Feature determinism** | 🟢 **VERIFIED — same inputs, same features** | 🟢 |
| 🟢 **FS-10** | **Paper/live feature parity** | 🟢 **VERIFIED — identical code** | 🟢 |

---

# PART 9 & 10 — FEATURE PLATFORM ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   FeatureStore  ★★★   THE MISSING COMPONENT THIS ENTIRE PROMPT IS ABOUT.
     Every inference PERSISTS: featureVersion · values · inputsHash · ts · sourceDatasetHash.
     🔴 WITHOUT IT: no calibration, no training, no reproduction — EVER.
        Not at 21 outcomes. Not at 200. Not at ten thousand.
     🔴 IT IS ONE OF ONLY TWO IRREVERSIBLE DEBTS IN THIS ENTIRE 37-DOCUMENT PROGRAMME.
        (The other is intraday chain capture — 031, 034.)
     🔴 START TODAY. Every day of delay destroys a day of evidence permanently.

   FeatureRegistry  ★   ONE definition per feature. Name · formula · units · owner · version.
     🔴 A SECOND IMPLEMENTATION OF A NAMED FEATURE IS A FAILING TEST, NOT A FILE.
        Today: bsGamma × 2 · Kelly × 3 · expectedMove × 2 (different names). → kills FS-2, FS-4

   FeatureCalculator  ★   ONE code path. Research, backtest, paper and live call THE SAME function.
     🔴 Today the backtest cannot even SEE volume (033 §0.5).

   ValidationLayer  ★
     🔴 A MISSING FEATURE IS `null`, NEVER `0`, NEVER A FABRICATED 0.14.    → kills FS-7
     🔴 A DEFAULT IS A CLAIM. It must cite its evidence, or it is not permitted.
        `winRate ?? 0.9` cites a refuted backtest, and nothing records that. → kills FS-3

   DriftDetector  ★   Requires a calibrated baseline, which requires a FeatureStore.
                      🔴 Blocked behind the one thing that must be built today.
```

## The rule §0 establishes

> **A feature is not a formula. It is a formula, a unit, a version, an owner, and a record of what it
> saw.**
>
> **This platform has the formulas. It has none of the rest — and where it has two formulas under one
> name, they disagree by 6.79%, and a single copied call site costs 92%.**

---

# PART 11 — TESTING STRATEGY

**Feature correctness has priority over model accuracy.**

| Test | Priority | Would it fail today? |
|---|---|---|
| 🔴 **A named feature has exactly ONE implementation** | **P0 — §0.1, §0.4** | ✅ **FAILS — `bsGamma` × 2, Kelly × 3** |
| 🔴 **A cross-implementation equivalence test: `gex-skew.bsGamma` == `vol-context.bsGamma`** | **P0 — §0.1** | ✅ **FAILS — 6.79% apart** |
| 🔴 **Every inference persists its `inputsHash`** | **P0 — FS-1** | ✅ **FAILS — no feature store** |
| 🔴 **A feature DEFAULT cites its evidence, or is rejected** | **P0 — §0.3** | ✅ **FAILS — `winRate ?? 0.9` cites a refuted backtest** |
| 🔴 **Research and live use the SAME feature function** | **P0 — FS-4** | ✅ **FAILS — 4 divergences** |
| 🔴 **A missing feature yields `null`, never `0` or a fabricated 0.14** | **P0 — FS-7** | ✅ **FAILS** |
| 🟢 **Features are deterministic** | P1 | 🟢 **PASSES. Lock it in** |
| 🟢 **Paper and live use identical feature code** | P1 | 🟢 **PASSES. Lock it in** |

**Six P0 tests. All six fail.**

---

# PART 12 — FEATURE MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Ad-hoc Features** | 🟢 | Formulas exist, scattered across 16 modules |
| **1 — Repeatable Features** | 🟡 **PARTIAL** | 🟢 **Deterministic. Paper and live share code** · 🔴 **Research does not. Same-name features disagree** |
| **2 — Managed Feature Engineering** | 🔴 **NO** | **No registry. No versioning. No units. No owner** |
| **3 — Governed Feature Store** | 🔴 **NO** | **THE FEATURE STORE DOES NOT EXIST** |
| **4 — Scientific ML Data Platform** | 🔴 **NO** | **No provenance, no drift, no lineage. A default encodes a refuted result** |
| **5 — Enterprise Feature Platform** | 🔴 **NO** | — |

## ## **Feature Platform: LEVEL 0–1 — AD-HOC.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE.** **§0 measured the divergence numerically for the first time** | — | none | 16 feature families · 4 duplicated · 0 owners |
| **2 — Feature store** ⚠️ | 🔴 **BUILD IT. TODAY.** Persist every inference's inputs: `featureVersion · values · inputsHash · ts` | **none — it is purely additive** | **ZERO. Nothing reads it yet** | 🔴 **THE MOST TIME-CRITICAL ACTION IN THE ENTIRE 37-DOCUMENT PROGRAMME. Every day of delay is permanent** |
| **3 — Feature registry** | 🔴 **ONE `bsGamma`, guarded by an equivalence test.** ONE Kelly. ONE `expectedMove` | Phase 2 | 🔴 **BEHAVIOUR CHANGE — the numbers WILL move. Approval** | **A second implementation of a named feature FAILS THE BUILD** |
| **4 — Training-serving parity** | 🔴 **Map volume and lot into `opts[]`** *(033)*. Research and live call the same function | Phase 3 | Approval | **Zero divergences** |
| **5 — Enterprise** | Drift detection · lineage · a feature audit log | Phase 4 | Medium | **Every feature has a version, an owner, and a record of what it saw** |

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every feature has one owner | 🔴 **NO — ZERO features have an owner** |
| Feature definitions are versioned | 🔴 **NO** |
| **Training and inference use identical logic** | 🟢 **Paper/live: YES** · 🔴 **Research/live: NO — 4 divergences** |
| **Provenance is complete** | 🔴 **NO — 0 of 7 fields. And a DEFAULT encodes a refuted experiment (§0.3)** |
| Drift is measurable | 🔴 **NO — no baseline, no store** |
| Feature quality is observable | 🔴 **NO** |
| **Unknown feature properties are never inferred** | 🔴 **NO — `\|\| 0` × 119, and a fabricated IV of 0.14** |

## **0 of 7.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent ML engineer reproduce every feature calculation, verify provenance,
confirm training-serving consistency, and certify the data as suitable for production AI?**

## **No — on every count. And 035's own stop condition is the finding, proven numerically.**

> **035 warns: *"Never assume two features are equivalent because they have the same name."***
>
> **I fed the two `bsGamma` functions an identical market state. They disagree by 6.79%. Both are
> reachable from `server.js`. Both feed the same dashboard.**
>
> **And their parameter orders are SWAPPED. Copy a call site from one to the other — the natural thing
> to do when two functions share a name — and time and volatility are silently exchanged. Measured cost:
> **−92%**. A plausible-looking number. The right order of magnitude. No exception, no warning, no test.**

**And the single most alarming feature in the platform is not a formula. It is a default:**

```js
position-sizer.js:119   kelly(p.winRate ?? 0.9, ...)
```

> **A ninety-percent win rate, as a fallback.**
>
> **That number comes from the invalidated look-ahead backtest — 88.4%, PF 7.41 — which this audit
> programme proved was an artefact. The honest, measured win rate after the fix is **51.2%**.**
>
> **Feed both into the platform's own Kelly function:**
>
> ```
>   kelly(0.900, 2900, −3500)  =  +0.7793
>   kelly(0.512, 2900, −3500)  =  −0.0770
> ```
>
> ## **A negative Kelly means: DO NOT BET.**
>
> **At the platform's true win rate, the mathematically correct position size is ZERO. And the sizer's
> default — the number it uses when nobody tells it otherwise — is drawn from an experiment that has
> been formally refuted, with nothing in the code recording that.**
>
> **`position-sizer.js` is required by `strangle-engine.js`, the ₹7 lakh iron condor. It is currently
> disabled by `STRANGLE_USE_SIZER=false` — a flag nobody set on purpose. The bomb is armed; the fuse is
> unlit.**

**And beneath all of it, the absence this entire prompt is named for:**

> ## **THE FEATURE STORE DOES NOT EXIST.**
>
> **Every feature in this platform is computed, used for one decision, and destroyed. Not one inference
> can ever be reproduced. Not one model can ever be validated. Not one confidence can ever be
> calibrated — not at 21 labelled outcomes, not at 200, not at ten thousand.**
>
> **It is one of only TWO irreversible debts in this thirty-seven-document programme. The other is the
> intraday chain capture, which audit 034 measured at 8–30% delivery on four days out of five.**
>
> **Every other defect found across thirty-seven audits can be fixed tomorrow at the same cost as today.
> These two cannot. They get permanently worse every single day they are not started.**

**The single highest-value action in this document, and it is purely additive, breaks nothing, and needs
no approval:**

> ## **PERSIST THE INPUTS. TODAY.**
>
> **Every inference already computes them. Writing them down costs one file and no behaviour change.
> Not writing them down costs a day of evidence, every day, forever.**

---

**ML models redesigned: NONE. Feature calculations changed: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Feature Inventory (Part 1) · Feature Lifecycle (Part 2) · Feature Governance (Part 3) ·
**Training-Serving Consistency (§0, Part 4)** · Feature Quality (Part 5) · Feature Store Assessment
(Part 6) · Observability (Part 7) · Failure Modes (Part 8) · Architecture & Contracts (Parts 9–10) ·
Testing Strategy (Part 11) · Maturity Assessment (Part 12) · Migration Roadmap (Part 13) · Executive
Summary.
