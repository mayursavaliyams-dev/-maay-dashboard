# 042 — QUANTITATIVE RESEARCH FRAMEWORK, SCIENTIFIC METHODOLOGY & EVIDENCE GOVERNANCE

**Standard:** Master Prompt 042 · **Depends on:** 000-A … 041
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No strategy created. No performance optimised.**

**042's stop condition: *"Never infer the existence of a trading edge from historical profitability alone."***

**So this document does the one thing forty-one previous documents did not: it takes the platform's single
surviving edge claim, strips the contamination, charges it real costs, and puts it through the platform's
own validator. A verdict is delivered.**

---

# ═══════════════════════════════════════════════════════════
# SECTION 0 — THE PLATFORM'S FLAGSHIP EDGE, ADJUDICATED
# ═══════════════════════════════════════════════════════════

## §0.1 — 🔴 The look-ahead was never confined to the validator. I only fixed one of nine files.

**Audit 002 fixed `bt-validate.js`. I believed that closed the matter. It did not.**

**`bt-lib.js:22` publishes UDiFF column 20 — `UndrlygPric`, which is the day's OWN CLOSING PRICE — under
the innocent name `underlying`. Measured, every file that still selects a strike from it:**

```
  bt-strategies.js:45      atmStrike(day) = Math.round(day.underlying / step) * step
  bt-strategies.js:95      const off = Math.round((day.underlying * 0.015) / 50) * 50
  bt-strategies.js:113     const off = Math.round((day.underlying * 0.012) / 50) * 50
  bt-strangle-costs.js:46      bt-strangle-regime.js:64      bt-strangle-tailsafe.js:47, :114
  bt-strangle-trend.js:36      bt-world-strategies.js:110, :116      pop-seller.js
```

> ## 🔴 **EVERY STRANGLE BACKTEST THIS PLATFORM HAS EVER RUN CHOOSES ITS STRIKE FROM A PRICE THAT HAD NOT HAPPENED YET.**
>
> **The 002 fix cured the *validator*. The scripts that actually PRODUCED the 88–89% claim were never
> touched. I reported the leak fixed. It was fixed in one of nine places.**

**And `bt-real.js` is worse than a strike-selection leak — it is a perfect one:**

```js
bt-real.js:48   const gapPct = ((day.underlying - prevClose) / prevClose) * 100;   // TODAY'S CLOSE
bt-real.js:49   let sig = gapPct > GAP_THR ? 'CE' : gapPct < -GAP_THR ? 'PE' : null;
bt-real.js:53   const entry = opt.o * (1 + SLIP);                                  // TODAY'S OPEN
```

> **A "gap" is today's OPEN against yesterday's CLOSE. This decides the direction from where the market
> **ended today**, and then buys at the price the option had **before it got there**. It buys a call
> because the market went up, at the price from before it went up.**
>
> **(And it still loses. Option buying bleeds so hard that even perfect foresight of direction cannot
> carry it — which is itself the strongest evidence for the selling thesis in the entire repository.)**

## §0.2 — 🟢 THE DECISIVE MEASUREMENT

**One harness. Real 600-day NSE bhavcopy. The platform's own `charges.js`. ONE line differs between the
two columns — the reference price used to pick the strike.**

```
  SHORT_STRANGLE · 1 lot · 599 trades · 2024-01-08 → 2026-06-17 · lot read from data, never guessed

                          WITH look-ahead        WITHOUT look-ahead
                          (what the platform      (reality)
                           actually ran)
  ─────────────────────────────────────────────────────────────────────
  GROSS win rate            88.15%                  65.61%
  GROSS ₹ / trade         1,604.60                  326.99
  ─────────────────────────────────────────────────────────────────────
  avg cost / trade         ₹100.16                 ₹101.31
  ─────────────────────────────────────────────────────────────────────
  🔴 NET win rate           85.64%          →        59.43%
  🔴 NET ₹ / trade        1,504.45          →        225.68     ◀── 85% HAIRCUT
  🔴 NET Sharpe (ann.)        9.38          →          1.50
  🔴 NET total (600d)    ₹9,01,164          →     ₹1,35,182
```

## ## 🔴 **THE 88% CLAIM IS A LOOK-AHEAD ARTEFACT. CONFIRMED, ON REAL DATA, FOR THE THIRD TIME.**

## §0.3 — 🟢 **But something SURVIVES. And that is a new finding.**

**Unlike the validator's strangle (which collapsed to 51.2% and a NEGATIVE expectancy in audit 002), this
one does not die. After removing the look-ahead AND charging real costs:**

> **59.4% net win rate · ₹225.68 per trade · annualised Sharpe 1.50 · ₹1.35 lakh over 600 days on one lot.**
>
> **For the first time in forty-two documents, I am reporting a POSITIVE finding.**

## §0.4 — 🔴 AND THEN THE PLATFORM'S OWN VALIDATOR KILLS IT

**`bt-validate.js` has ZERO strategy callers (audit 009). It has never once been used for the purpose it
was written for. Today, for the first time, I pointed it at the strategy it was designed to validate.**

```
  WITHOUT LOOK-AHEAD — cost-net, ₹1L capital, n=599

    per-trade Sharpe   0.0945      skew 0.754      kurtosis 30.63  ◀── VIOLENT TAILS
    annualised Sharpe  1.50
    PSR (vs SR* = 0)   98.98%      ← passes against a zero benchmark

    🟢 walk-forward OOS      Sharpe holds out-of-sample across 26 folds, 520 trades
    🟢 purged 5-fold         [0.075, 0.038, 0.224, 0.196, 0.047]  ← ALL FIVE FOLDS POSITIVE

    DSR @  1 trial     100.00%   PASS (edge real @95%)
    🔴 DSR @ 10 trials   76.89%   FAIL (likely overfit)
    🔴 DSR @ 50 trials   51.21%   FAIL (likely overfit)
```

**And how many trials did this platform actually run? Measured — the strangle variants on disk:**

```
  bt-strategies.js (shortStrangle + 2 more) · bt-strangle-costs · bt-strangle-regime
  bt-strangle-tailsafe (×2 variants) · bt-strangle-trend · bt-world-strategies (×2) · pop-seller
    ≥ 10 strategy variants, across 6 scripts —
    BEFORE counting parameter choices (OTM_PCT, stopMult, wingPts, DTE, capital fraction).
    The true trial count is comfortably in the DOZENS.
```

> ## 🔴 **AT THE PLATFORM'S OWN TRUE TRIAL COUNT, THE SURVIVING EDGE FAILS DEFLATION.**
>
> **The edge is real out-of-sample. Every purged fold is positive. It holds up across 26 walk-forward
> windows. And it is still NOT statistically supported — because the platform searched a dozen-plus
> variants to find it, and the Deflated Sharpe Ratio exists precisely to charge you for that search.**
>
> ## **This is 042's stop condition made flesh: profitability is not evidence of an edge. The strategy is profitable. The edge is not proven.**

**And the finding underneath the finding:**

> ## **`bt-validate.js` WOULD HAVE CAUGHT THIS. It has been sitting in the repository the entire time, correct, tested, exported — and NOT ONE STRATEGY SCRIPT HAS EVER CALLED IT. The platform built the exact instrument that would have told it the truth, and then never picked it up.**

## §0.5 — Honest limitations of §0.2–§0.4 (these are NOT minor)

| # | Limitation | Direction of error |
|---|---|---|
| **1** | **Margin is not modelled.** ₹225/trade is measured against ₹1L. A short strangle blocks **₹1.2–1.5 lakh of SPAN+exposure margin**, not ₹1L | 🔴 **The true return-on-capital is LOWER than reported** |
| **2** | 🔴 **`charges.js` assumes every leg is LONG** *(013)*. For a SHORT, STT and stamp are swapped — the real cost is **higher** | 🔴 **The edge is SMALLER than reported** |
| **3** | 🔴 **The 2× stop assumes a fill at exactly 2× the entry, off the day's HIGH.** Real stops slip | 🔴 **SMALLER** |
| **4** | 🔴 **Entry at the bhavcopy OPEN assumes a fill at the open with no spread.** Index-option spreads are real | 🔴 **SMALLER** |
| **5** | 🔴 **`bt-lib.js:36` still reads the lot from `rows[0][28]` — an arbitrary row** *(032 §0)*. Wrong on **27 of 600 days** | 🟡 **unknown sign** |
| **6** | **Kurtosis 30.6.** This distribution has violent tails. 599 trades is not many for a fat-tailed seller | 🔴 **Sharpe is OVERSTATED for a tail-risk strategy** |

> **Every single limitation points the same way. ₹225.68 per trade is the OPTIMISTIC case, and it already
> fails deflation.**

---

# PART 1 — RESEARCH INVENTORY & DISPOSITION

| Artifact | Claim | Validation | 🔴 **DISPOSITION** |
|---|---|---|---|
| 🔴 **SHORT_STRANGLE (`bt-strategies`)** | **88–89% win** | 🔴 **look-ahead (§0.1)** | 🔴 **INVALIDATED as claimed.** 🟡 **Residual edge 59.4%/Sharpe 1.50 — FAILS deflation at true trial count** |
| 🔴 **`bt-validate` strangle** | 91.5%, DSR 0.9999 PASS | 🔴 **look-ahead** | 🔴 **INVALIDATED — audit 002. Now 51.2%, DSR 0.0008 FAIL** |
| 🔴 **GAP_BUY (`bt-real`)** | 2% win | 🔴 **PERFECT look-ahead (§0.1)** | 🔴 **INVALIDATED — and it loses ANYWAY** |
| 🔴 **NIFTY multi-confirm directional** | first-100: +312, PF 1.31 | 🟢 **1200-trade real backtest: PF 0.94** | 🟢 **HONESTLY INVALIDATED — and disabled. The one correctly retired hypothesis** |
| **`bt-strangle-costs / -regime / -tailsafe / -trend`** | variants | 🔴 **all read `day.underlying`** | 🔴 **INVALIDATED — same leak** |
| **`bt-world-strategies`** | VRP thesis | 🔴 **same leak** | 🔴 **INVALIDATED as measured** |
| **`gamma-blast-engine`** | expiry-day buying | ⚪ **"not backtestable"** | ⚪ **UNKNOWN — correctly labelled** |
| 🟢 **Paper trading ledgers** | — | 🟢 **REAL FORWARD EVIDENCE** | 🟢 **VALID — the only uncontaminated evidence in the repository** |
| **`confluence-learner`** | AI weights | 🔴 **33.8% correct over 130 obs** *(041)* | 🔴 **INVALIDATED** |
| **`meta-label`** | AUC 0.685 | 🔴 **permutation p = 0.191 — CHANCE** *(019)* | 🔴 **INVALIDATED** |
| 🔴 **Research notes / hypothesis register** | — | — | 🔴 **DOES NOT EXIST** |

## **11 research artifacts. 8 INVALIDATED. 1 UNKNOWN. 1 VALID — the paper ledger. 0 hypotheses documented.**

---

# PART 2 — RESEARCH LIFECYCLE

```
  Observation        🟡  happens informally
       ↓
  🔴 Hypothesis      🔴🔴  NEVER WRITTEN DOWN. No hypothesis register exists anywhere.
       ↓                   Entry criteria: none. Exit criteria: none.
  Experimental Design 🔴  no sample plan, no bias controls, no pre-registration
       ↓
  Data Collection    🟢  600 files, 0% missing fields  (031/033)
       ↓
  🔴 VALIDATION      🔴🔴  ══ SKIPPED. bt-validate.js has ZERO strategy callers. ══
       ↓
  Statistical Analysis 🔴  DSR/PSR/walk-forward/purged-kfold ALL EXIST — ALL UNUSED
       ↓
  Paper Trading      🟢  THE ONE HONEST SURFACE
       ↓
  🔴 Evidence Review 🔴  the 33.8% AI hit-rate sat unread on disk for months  (041)
       ↓
  Decision           🔴  made from GROSS, LOOK-AHEAD-CONTAMINATED profitability
       ↓
  🔴 Archive         🔴  results OVERWRITTEN in place (015). A FIFO cap deletes evidence (039)
```

## 🔴 **The lifecycle has ten stages. The two that constitute science — hypothesis and validation — are the two that are entirely absent.**

---

# PART 3 — HYPOTHESIS GOVERNANCE

| Required per hypothesis | Recorded? |
|---|---|
| Research question · Expected outcome · **Null hypothesis** · Success criteria · Failure criteria · Required evidence · Approval status | 🔴 **0 of 7. For 0 hypotheses.** |

> **042: *"Undocumented hypotheses remain exploratory."***
>
> ## **Therefore: EVERY piece of research this platform has ever produced is, by its own governing standard, EXPLORATORY. None of it is confirmatory. None of it may support a deployment decision.**
>
> **And that is not a technicality — it is exactly what went wrong. Without a pre-registered null, an
> 88% win rate looks like a discovery instead of a red flag.**

---

# PART 4 — EXPERIMENTAL DESIGN

| Required | Defined? |
|---|---|
| Sample selection | 🔴 **NO — "all 600 files" is not a sample plan** |
| Time horizon | 🟡 implicit (2024-01 → 2026-06) |
| Control assumptions | 🔴 **NO — no benchmark, no buy-and-hold control** |
| Independent / dependent variables | 🔴 **NOT DECLARED** |
| 🔴 **Bias controls** | 🔴 **NONE — which is precisely how a look-ahead survived nine files** |
| 🔴 **Reproducibility requirements** | 🔴 **NONE — 0 of 25 results carry a gitSha/dataHash/seed** *(040)* |

## **6 requirements. 0 met. Per 042: experimental assumptions are UNKNOWN.**

---

# PART 5 — STATISTICAL GOVERNANCE

| Method | Implemented? | **Ever used on a strategy?** |
|---|---|---|
| Out-of-sample validation | 🟢 **YES** | 🔴 **NO — until this document** |
| Walk-forward | 🟢 **YES — `bt-validate.js:100`** | 🔴 **NO — until this document** |
| Purged k-fold | 🟢 **YES — `:114`** | 🔴 **NO — until this document** |
| Deflated Sharpe | 🟢 **YES — `:88`, textbook-correct** | 🔴 **NO — until this document** |
| PSR | 🟢 **YES — `:68`, Bailey & López de Prado** | 🔴 **NO — until this document** |
| Confidence intervals | 🟡 via PSR | 🔴 **NO** |
| 🔴 **Multiple-testing correction** | 🟢 **YES — DSR's `nTrials` parameter** | 🔴 **NO. AND IT IS THE ONE THAT KILLS THE EDGE (§0.4)** |

> ## 🔴 **SEVEN correct statistical instruments. ZERO used. The platform built a complete, rigorous, correct validation toolkit — and then made every research decision by reading a gross, contaminated win-rate off a console.**
>
> **`deflatedSharpe(rets, nTrials)` takes the trial count as an argument. Someone wrote that parameter.
> Someone understood selection bias well enough to implement the Bailey–López de Prado correction. And
> nobody ever passed it a strategy.**

## **Are the conclusions statistically justified? NO. Measured, not asserted: at nTrials ≥ 10, DSR = 76.9% → FAIL.**

---

# PART 6 — EVIDENCE GOVERNANCE

| Every conclusion must record | Present? |
|---|---|
| Supporting datasets · Validation method · Statistical evidence · Confidence level · Known limitations · Open questions | 🔴 **0 of 6, for every conclusion** |

> **042: *"Evidence without provenance is unsuitable for decision-making."***
>
> ## **0 of 25 result files carry a gitSha, a dataHash, or a seed (040). Therefore NO research conclusion in this repository is suitable for a decision. That includes the ₹7 lakh strangle allocation, which was sized on the 88% number.**

---

# PART 7 — RESEARCH OBSERVABILITY

| Every experiment must record | Present? |
|---|---|
| Experiment ID · Dataset version · Feature version · Model version · Execution timestamp · Outcome · Validation status | 🔴 **0 of 7** |

**And results are OVERWRITTEN in place *(015 §0.B)* — so even the outcome does not survive the next run.
There is no experiment history. There is only the last experiment.**

---

# PART 8 — FAILURE MODE REGISTER

| Failure mode | Present? | Scientific impact |
|---|---|---|
| 🔴 **Look-ahead bias** | 🔴 **CONFIRMED — IN NINE FILES, NOT ONE** | 🔴 **CATASTROPHIC. It IS the 88% claim (§0.1–§0.2)** |
| 🔴 **Data leakage** | 🔴 **CONFIRMED** | 🔴 same mechanism |
| 🔴 **Multiple-testing / selection bias** | 🔴 **CONFIRMED — ≥10 variants, DSR never applied** | 🔴 **DECISIVE. It is what kills the residual edge (§0.4)** |
| 🔴 **Overfitting** | 🔴 **CONFIRMED** | 🔴 `BANKNIFTY.pcr` 4-for-4 weighted as signal *(041)* |
| 🔴 **Underpowered studies** | 🔴 **CONFIRMED** | 🔴 **12 labelled outcomes for meta-label; 130 for the AI. Kurtosis 30.6 on 599 trades** |
| 🔴 **Cherry-picking** | 🔴 **CONFIRMED** | 🔴 **"first-100 = +312, PF 1.31" was reported before the full 1200-trade run gave PF 0.94** |
| 🔴 **Confirmation bias** | 🔴 **CONFIRMED — INSTITUTIONAL** | 🔴 **Seven correct validators sat unused. An 88% win rate was accepted without one question** |
| 🔴 **Misinterpreted statistics** | 🔴 **CONFIRMED** | 🔴 **009: a look-ahead produced Sharpe 0.846 and would have PASSED DSR at any trial count. Rigour is DOWNSTREAM of temporal integrity** |
| 🟡 **Survivorship bias** | 🟡 **LOW** | 🟢 Index options — no delisting. Genuinely not a concern here |

## **9 failure modes. 8 CONFIRMED.**

---

# PART 9 & 10 — RESEARCH ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   HypothesisRegistry  ★★★   THE PRIMITIVE WHOSE ABSENCE EXPLAINS EVERYTHING.
     A hypothesis is REGISTERED BEFORE the experiment runs: question · null · success ·
     failure · required evidence · TRIAL COUNT SO FAR.
     🔴 The trial counter is not bookkeeping. It is the INPUT TO deflatedSharpe(). Without
        it, nTrials defaults to 1, and at nTrials=1 the contaminated strangle scores 100%.  §0.4

   ExperimentManager  ★
     🔴 Every run stamps gitSha + dataHash + seed. 0 of 25 do today.                     (040)
     🔴 Results are APPENDED, never overwritten. An invalidated hypothesis STAYS on the record.

   ValidationLayer  ★★★
     🟢 bt-validate.js IS this layer. It is CORRECT. It is TESTED. It is EXPORTED.
     🔴 IT HAS ZERO CALLERS. Wiring it in is not new engineering — it is picking up a
        finished tool that has been lying on the bench for the entire life of the project.

   StatisticalReviewLayer  ★
     🔴 NO RESULT IS A RESULT UNTIL IT HAS SURVIVED DSR AT THE HONEST TRIAL COUNT.
     🔴 An edge that passes at nTrials=1 and fails at nTrials=10 is NOT an edge. It is a search.

   THE ONE RULE 042 ESTABLISHES:
     🔴 TEMPORAL INTEGRITY IS UPSTREAM OF STATISTICS.
        A look-ahead produces a Sharpe of 0.846 that passes every correction ever invented (009).
        You cannot deflate your way out of reading tomorrow's price.
```

---

# PART 11 — TESTING STRATEGY

**Scientific validity has priority over positive results.**

| Test | Priority | Fails today? |
|---|---|---|
| 🔴 **No strategy may read a same-day close to make a same-day decision** | **P0 — §0.1. THIS IS THE ONE** | ✅ **FAILS in 9 files** |
| 🔴 **Every strategy result passes through `bt-validate` at the HONEST nTrials** | **P0 — §0.4** | ✅ **FAILS — 0 callers** |
| 🔴 **Every result stamps gitSha + dataHash + seed** | **P0** | ✅ **FAILS — 0 of 25** |
| 🔴 **Every backtest is charged direction-correct costs** | **P0** | ✅ **FAILS — `charges.js` assumes LONG** |
| 🔴 **A hypothesis exists before an experiment runs** | **P0** | ✅ **FAILS — none exist** |
| 🔴 **Invalidated hypotheses remain on the record** | P1 | ✅ **FAILS — results overwritten** |
| 🟢 **The 002 characterization test (`TRIPWIRE 1`)** | P0 | 🟢 **PASSES. Extend it to the other 8 files** |

---

# PART 12 — RESEARCH MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Exploratory Research** | 🟢 **YES — and per 042's own rule, this is where ALL of it sits (Part 3)** | No hypothesis is documented |
| **1 — Repeatable Experiments** | 🔴 **NO** | 🔴 **0 of 25 results carry provenance. Results are overwritten** |
| **2 — Managed Research** | 🔴 **NO** | 🔴 **No registry. No experiment history** |
| **3 — Governed Scientific Research** | 🔴 **NO** | 🔴 **The validator has ZERO callers** |
| **4 — Institutional Quantitative Research** | 🔴 **NO** | — |
| **5 — Evidence-Driven Organization** | 🔴 **NO** | 🔴 **A 33.8% AI hit-rate sat on disk, unread, for months** *(041)* |

## ## **QUANT RESEARCH PLATFORM: LEVEL 0 — EXPLORATORY.**

**Not because the tools are missing. Because the tools were never picked up.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Preconditions | Risks | Exit criteria |
|---|---|---|---|
| **1 — INVENTORY** | ✅ **DONE — Part 1. 8 of 11 artifacts INVALIDATED** | — | **Every claim has a disposition** |
| **2 — 🔴 TEMPORAL INTEGRITY (must come FIRST)** | none | 🟢 **LOW — 9 files, none protected. `prev.underlying` instead of `day.underlying`** | 🔴 **No strategy reads a same-day close. Re-run EVERY claim** |
| **3 — HYPOTHESIS GOVERNANCE** | Phase 2 | Low | **A registry with a TRIAL COUNTER — the input `deflatedSharpe` needs** |
| **4 — STATISTICAL VALIDATION** | Phase 3 | 🟢 **LOW — `bt-validate.js` is already written, tested and correct. Just CALL it** | 🔴 **No result is published until it survives DSR at the honest nTrials** |
| **5 — EVIDENCE GOVERNANCE** | Phase 4 | Low | **gitSha + dataHash + seed on every result; append-only history** |

> **Phase 2 must precede Phase 4. Audit 009 proved why: a look-ahead produced a Sharpe of 0.846 — four
> times the strongest overfitting correction the data could support. **It would have passed DSR at any
> trial count.** Statistical rigour applied to contaminated data certifies the contamination.**

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every hypothesis is documented | 🔴 **NO — zero exist** |
| Every experiment is reproducible | 🔴 **NO — 0 of 25** |
| **Statistical methods are appropriate** | 🟢 **YES — 7 correct methods** · 🔴 **NONE were used** |
| **Evidence supports conclusions** | 🔴 **NO — the flagship conclusion was a look-ahead artefact** |
| **Invalidated hypotheses remain recorded** | 🟡 **PARTIAL — the NIFTY directional PF 0.94 was honestly recorded and the engine disabled. THE ONE THING DONE RIGHT** |
| Unknown findings explicitly labelled | 🟡 **PARTIAL — `gamma-blast` is honestly marked "not backtestable"** |
| **Positive results not preferred over accurate results** | 🔴 **NO — the 88% number sized a ₹7 lakh allocation and was never questioned** |

## **1.5 of 7.**

---

# STOP CONDITIONS

| Condition | Verdict |
|---|---|
| *Hypotheses cannot be reconstructed* | 🔴 **FIRES — none were ever written** |
| *Statistical validation cannot be verified* | 🟢 **DOES NOT FIRE — I ran it. §0.4. The verdict is FAIL at nTrials ≥ 10** |
| *Evidence provenance is incomplete* | 🔴 **FIRES — 0 of 25 results carry provenance** |
| *Experimental methodology is undocumented* | 🔴 **FIRES — 0 of 6 design requirements** |

---

# EXECUTIVE SUMMARY

**The mission: could an independent quantitative researcher verify every statistical conclusion, identify
every source of bias, and determine whether any claimed trading edge is scientifically supported?**

## **Yes. And the answer is: NO EDGE IN THIS PLATFORM IS SCIENTIFICALLY SUPPORTED — including the one that is genuinely profitable.**

**Three findings, in order of severity.**

> ## 🔴 **ONE — I DID NOT FIX THE LOOK-AHEAD. I FIXED ONE NINTH OF IT.**
>
> **Audit 002 repaired `bt-validate.js` and I reported the leak closed. It was not. `bt-lib.js` publishes
> the day's own CLOSING PRICE under the name `underlying`, and **nine files still select their strike from
> it** — `bt-strategies`, `bt-strangle-costs`, `-regime`, `-tailsafe`, `-trend`, `bt-world-strategies`,
> `pop-seller`, and `bt-real`. Those are the scripts that produced the 88–89% claim. They were never touched.**
>
> **`bt-real.js` is the worst: it decides direction from where the market CLOSED, then buys at the OPEN.
> It buys a call because the market went up, at the price from before it went up. And it still loses money
> — which is the single strongest piece of evidence in this repository that option BUYING is hopeless.**

> ## 🟢 **TWO — AND YET, A REAL EDGE SURVIVES. This is the first positive finding in forty-two documents.**
>
> **Strip the look-ahead. Charge the platform's own costs. Real 600-day NSE bhavcopy, 599 trades:**
>
> | | claimed | **reality** |
> |---|---|---|
> | net win rate | 85.6% | **59.4%** |
> | net ₹/trade | ₹1,504 | **₹226** |
> | net Sharpe | 9.38 | **1.50** |
>
> **The 88% is fiction. But 59.4% at a Sharpe of 1.50 is not nothing. It holds across 26 walk-forward
> windows. **All five purged folds are positive.** The volatility-risk-premium thesis appears to be real.**

> ## 🔴 **THREE — AND THEN THE PLATFORM'S OWN VALIDATOR KILLS IT.**
>
> ```
>    DSR @  1 trial    100.00%   PASS
>    DSR @ 10 trials    76.89%   FAIL (likely overfit)
>    DSR @ 50 trials    51.21%   FAIL (likely overfit)
> ```
>
> **The platform ran at least ten strangle variants across six scripts, before counting parameter choices.
> Its honest trial count is in the dozens. **At its own true trial count, the surviving edge fails
> deflation.** And every unmodelled cost — real margin, direction-correct STT, slippage, spread, a
> kurtosis of 30.6 — pushes it further down. ₹226 a trade is the OPTIMISTIC case, and it already fails.**
>
> ## **The strategy is profitable. The edge is not proven. That distinction is the entire subject of Master Prompt 042, and this platform has never once made it.**

**The finding beneath all three:**

> **`bt-validate.js` contains seven correct, textbook statistical instruments — out-of-sample validation,
> walk-forward, purged k-fold, PSR, and the Bailey–López de Prado Deflated Sharpe with an explicit
> `nTrials` parameter for selection bias. Somebody understood multiple-testing well enough to implement
> the correction properly.**
>
> ## **It has ZERO strategy callers. Today, in this audit, it was pointed at a strategy for the first time in the life of this project — and it immediately returned the correct answer.**
>
> **The platform did not lack the means to know the truth. It built the means, tested them, exported them,
> and never called them. This is the same pathology as `/api/risk` reporting zero losses while the engine
> holds fifteen (013), and the AI's 33.8% hit-rate sitting unread on disk for months (041).**
>
> ## **ANTIGRAVITY PRO does not have an information problem. It has a LOOKING problem.**

**And per 042's own rule — *"undocumented hypotheses remain exploratory"* — with zero hypotheses on record,
every result this platform has ever produced is exploratory. None of it is confirmatory. None of it should
ever have sized a ₹7 lakh allocation.**

## **Research maturity: LEVEL 0 — EXPLORATORY. Not for want of tools. For want of picking them up.**

---

**Strategies created: NONE. Performance optimised: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Research Inventory (Part 1) · Lifecycle (Part 2) · Hypothesis Governance (Part 3) ·
Experimental Design (Part 4) · **Statistical Review (§0.4, Part 5)** · Evidence Governance (Part 6) ·
Observability (Part 7) · Failure Mode Register (Part 8) · Research Architecture (Parts 9–10) · Testing
Strategy (Part 11) · Maturity Assessment (Part 12) · Migration Roadmap (Part 13) · Executive Summary.

**Stop conditions: hypotheses — 🔴 FIRES · statistical validation — does not fire (it was RUN; verdict FAIL) ·
evidence provenance — 🔴 FIRES · methodology — 🔴 FIRES.**
