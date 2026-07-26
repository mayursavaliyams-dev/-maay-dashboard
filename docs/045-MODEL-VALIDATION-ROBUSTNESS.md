# 045 — MODEL VALIDATION, STATISTICAL TESTING, ROBUSTNESS & SCIENTIFIC VERIFICATION

**Standard:** Master Prompt 045 · **Depends on:** 000-A … 044
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No model performance improved. No architecture redesigned.**

**045's stop condition: *"Never declare a model production-ready solely because it performed well in
historical backtests."***

**042 established that a real edge survives the look-ahead fix, and then fails deflation at the true trial
count. 045 asks the question nobody has asked: IS IT ROBUST? The measurement re-runs, from scratch, the
exact question that `backtest-when-strategy-works.js` was asking when it was deleted as junk (043).**

**It also RETRACTS a number I published in audit 013.**

---

# ═══════════════════════════════════════════════════════════
# SECTION 0 — THE EDGE IS NOT ROBUST. IT IS CONCENTRATED.
# ═══════════════════════════════════════════════════════════

## §0.1 — 🔴 The regime slice — measured, look-ahead-free, cost-net

**The 042 survivor (strike from the PREVIOUS close, real costs, 1 lot), sliced by regimes computed only
from data available BEFORE each trade:**

```
  slice                        n    win%      ₹/trade   Sharpe          total
  ────────────────────────────────────────────────────────────────────────────────────
  ALL                        579   59.8%       ₹246     1.62      ₹1,42,491

  ── TREND (prior 20-day move) ──
  BULL   (>+3%)              112   61.6%        ₹59     0.43         ₹6,627   ◀── nothing
  SIDEWAYS (−3…+3%)          385   58.4%       ₹232     2.11        ₹89,466
  BEAR   (<−3%)               82   63.4%       ₹566     2.02        ₹46,398

  ── VOLATILITY (prior 20-day realised) ──
  LOW VOL  (<10%)            203   61.1%       ₹326     2.32        ₹66,257
  MID VOL  (10–15%)          248   60.9%       ₹314     2.55        ₹77,837
  🔴 HIGH VOL (≥15%)         128   55.5%       ₹−13    −0.06        ₹−1,604   ◀── LOSES MONEY

  ── DAYS TO EXPIRY ──
  DTE 0 (expiry day)         124   56.5%       ₹368     2.34        ₹45,640
  🟢 DTE 1–2                 191   67.5%       ₹660     4.90      ₹1,26,014   ◀── 88% OF ALL PROFIT
  🔴 DTE 3–4                 115   53.0%      ₹−257    −1.94       ₹−29,568   ◀── LOSES MONEY
  DTE 5+                     149   57.7%         ₹3     0.02           ₹405   ◀── nothing

  ── YEAR (out-of-time stability) ──
  2024                       220   51.4%        ₹91     1.43        ₹20,040
  🟢 2025                    248   66.9%       ₹409     3.19      ₹1,01,376   ◀── 71% OF ALL PROFIT
  2026                       111   60.4%       ₹190     0.70        ₹21,075   ◀── weak
```

## 🔴 **THREE FINDINGS, AND THE FIRST IS THE MOST IMPORTANT ONE IN THIS DOCUMENT**

> ## 🔴 **1. THE VOLATILITY SELLER LOSES MONEY WHEN VOLATILITY IS HIGH.**
>
> **At realised vol ≥ 15%, the strategy returns **₹−13 per trade at a Sharpe of −0.06**. It is not merely
> weaker there. It is negative.**
>
> **This is the volatility risk premium inverting. The entire thesis of the strategy — that implied vol is
> systematically richer than realised — holds in calm markets and FAILS in exactly the conditions a seller
> most needs it to hold. The strategy earns a small premium for years and gives it back in the regime that
> was supposed to be its payday.**
>
> **And nothing in the platform gates on this. `strangle-engine.js` has `stopMult`, `tpPct`, `wingPts` —
> and no volatility filter of any kind.**

> ## 🔴 **2. EIGHTY-EIGHT PERCENT OF ALL PROFIT COMES FROM ONE BUCKET: DTE 1–2.**
>
> **₹1,26,014 of the ₹1,42,491 total. And the adjacent bucket, DTE 3–4, LOSES ₹257 per trade at a Sharpe
> of −1.94. DTE 5+ earns ₹3 per trade — nothing at all.**
>
> **This is not a strategy that works. It is a strategy with one narrow window that works, surrounded by
> windows that do not.**

> ## 🔴 **3. SEVENTY-ONE PERCENT OF ALL PROFIT CAME FROM 2025.**
>
> **2024: Sharpe 1.43. 2025: Sharpe 3.19. 2026: Sharpe 0.70 — and 2026 is the most recent year, i.e. the
> closest thing to out-of-sample this data has. The edge is not stable across time.**

## §0.2 — 🔴 THE TRAP. Read this before "fixing" any of the above.

**The obvious response to §0.1 is: *restrict the strategy to DTE 1–2, filter out high vol, and the numbers
get much better.***

> ## 🔴 **DO NOT. THAT IS THE CURVE FIT.**
>
> **Every filter added AFTER seeing this table is another trial. Audit 042 measured the surviving edge
> through the platform's own Deflated Sharpe Ratio and found DSR = 76.89% (FAIL) at 10 trials and 51.21%
> (FAIL) at 50. Audit 043 then recovered a DELETED optimizer that alone swept **forty** configurations and
> ranked them by win rate.**
>
> **Selecting DTE 1–2 because this table says so does not make the edge stronger. It makes `nTrials`
> LARGER, and the Deflated Sharpe LOWER. The regime slice is a DIAGNOSIS, not a recipe.**
>
> **A DTE filter is only legitimate if it is derived from a pre-registered mechanical hypothesis (gamma and
> theta both peak near expiry; there is a genuine reason to expect it) — and then tested on data that was
> not used to find it. That data does not exist here. Every one of these 600 days has now been looked at.**

## §0.3 — Bootstrap and cost sensitivity (Part 3 — `bt-validate.js` has no bootstrap)

**10,000 resamples, seeded deterministic LCG (no `Math.random`, fully reproducible):**

```
  n trades                    599
  observed mean               ₹225.68
  95% CI on mean ₹/trade      [ ₹32.60 , ₹472.14 ]      ◀── the lower bound is barely above zero
  95% CI on annualised Sharpe [ 0.20 , 2.80 ]           ◀── enormous
  P(mean ≤ 0)                 0.05%

  SENSITIVITY — extra cost or slippage per trade:
    +₹  0   →  ₹226/trade
    +₹100   →  ₹126/trade
    +₹200   →  ₹ 26/trade
    🔴 +₹226 →  ₹  0/trade      *** EDGE GONE ***
```

> ## 🔴 **₹226 PER TRADE OF UNMODELLED COST DESTROYS THE EDGE ENTIRELY.**
>
> **And the backtest models NO SLIPPAGE and NO BID-ASK SPREAD AT ALL. It assumes a fill at the bhavcopy
> OPEN and a stop that fills at exactly 2× off the day's HIGH. Four executions per trade, on index options,
> with a real spread — ₹226 is not a remote scenario. It is a plausible one.**
>
> **The 95% confidence interval on the Sharpe is [0.20, 2.80]. A strategy whose Sharpe could honestly be
> 0.20 is not a strategy. It is a coin with a small tilt and a large tail (kurtosis 30.6).**

## §0.4 — 🔴 I RETRACT A NUMBER FROM MY OWN AUDIT 013

**Audit 013 states that `charges.js` assumes every position is LONG, and that for a SHORT this understates
costs by **₹78.81 per leg / ₹157.62 per trade / ≈₹20,333 over 129 trades**.**

**I re-derived it from scratch on the 599 real trades of the surviving strangle. The bug is REAL — the
argument order does put STT on the wrong side:**

```js
charges.js:41   const stt   = sellTurnover * STT_SELL_PCT;    // sell only  — 0.1%
charges.js:44   const stamp = buyTurnover  * STAMP_BUY_PCT;   // buy only   — 0.003%
                // called as roundTripCharges(entry, exit, qty), which assumes entry = BUY.
                // For a SHORT you SELL at entry and BUY BACK at exit. The legs are reversed.
```

**But the MAGNITUDE I published was wrong. The exact error is:**

```
    understatement = (entry − exit) × qty × (0.001 − 0.00003)
                   = gross P&L × 0.00097
```

```
  MEASURED over the 599 trades:
    cost as the platform charges     ₹101.31 / trade
    cost correctly (short)           ₹101.62 / trade
    🔴 UNDERSTATED                     ₹0.32 / trade      ← not ₹157.62
    the edge shrinks by                  0.1%             ← not 70%
    total over 600 days       ₹1,35,182  →  ₹1,34,992
```

> ## 🔴 **AUDIT 013's FIGURE OF ₹157.62 PER TRADE DOES NOT REPRODUCE. The true error is ₹0.32 per trade — roughly 500× smaller. The direction bug is real and should still be fixed for correctness, but it is NOT material, and my earlier claim that it eats ≈₹20,333 is RETRACTED pending re-derivation.**
>
> **045's stop condition says to report UNKNOWN when statistical evidence cannot be verified. That applies
> to my own evidence. This is the eleventh error I have caught in my own work across this programme, and
> the first one that had already been published as a number in a prior audit.**

---

# PART 1 — VALIDATION INVENTORY

| Process | Exists? | Acceptance criteria | Status |
|---|---|---|---|
| Training validation | 🔴 **NO** | 🔴 none | 🔴 **The model trains continuously and live** *(044)* |
| Out-of-sample testing | 🟢 **CODE EXISTS** | 🔴 none | 🔴 **ZERO callers until audit 042** |
| Walk-forward | 🟢 **`bt-validate.js:100`** | 🔴 none | 🟡 **RUN, FIRST TIME, in 042. OOS Sharpe holds** |
| 🔴 **Robustness testing** | 🔴 **NONE EXISTED** | 🔴 none | 🔴 **RUN FOR THE FIRST TIME IN §0.1. It FAILS** |
| 🔴 **Stress testing** | 🔴 **NONE** | 🔴 none | 🔴 **§0.1 IS the stress test: high vol → NEGATIVE** |
| Statistical testing | 🟢 **7 methods, all correct** | 🔴 none | 🔴 **DSR FAILS at true nTrials** *(042/043)* |
| 🔴 **Bootstrap** | 🔴 **NOT IMPLEMENTED** | — | 🔴 **RUN FOR THE FIRST TIME IN §0.3** |
| 🔴 **Sensitivity analysis** | 🔴 **NOT IMPLEMENTED** | — | 🔴 **§0.3: +₹226/trade kills it** |
| 🟢 **Paper trading validation** | 🟢 **REAL** | 🟡 informal | 🟢 **THE ONLY UNCONTAMINATED EVIDENCE** |
| Regression testing | 🟢 **48/48 suites** | 🟢 green | 🟢 **works — but tests CODE, not SCIENCE** |
| Operational validation | 🔴 **NO** | — | 🔴 **the bot is DOWN (INC-001)** |

## **11 validation processes. 4 did not exist until this document ran them. 0 have acceptance criteria.**

---

# PART 2 — VALIDATION LIFECYCLE

```
  Model Development     🟡  9 hand-written numbers
       ↓
  Internal Validation   🔴  NONE
       ↓
  Out-of-Sample         🔴  code existed, ZERO callers — until 042
       ↓
  Walk-Forward          🔴  same — until 042
       ↓
  🔴 Robustness         🔴🔴  ══ NEVER EXISTED. Run today. IT FAILS. §0.1 ══
       ↓
  Paper Trading         🟢  the one honest surface
       ↓
  Performance Review    🔴  the 33.8% AI hit-rate sat unread for months  (041)
       ↓
  Deployment Decision   🔴  NO APPROVAL STAGE. ₹7L was allocated on the 88% artefact.
       ↓
  Monitoring            🔴  NONE
```

## 🔴 **Nine stages. Five were empty. The ₹7 lakh allocation passed through all nine without one of them stopping it.**

---

# PART 3 — STATISTICAL VALIDATION

| Method | Implemented? | Applied? | Result |
|---|---|---|---|
| Confidence intervals | 🟡 via PSR | 🔴 **never** | 🔴 **§0.3: 95% CI on Sharpe = [0.20, 2.80]** |
| Hypothesis testing | 🔴 **no nulls exist** *(043)* | 🔴 | 🔴 **UNSUPPORTED** |
| **Deflated Sharpe** | 🟢 **correct** | 🔴 **never** | 🔴 **FAILS at nTrials ≥ 10** *(042)* |
| **PSR** | 🟢 **correct** | 🔴 **never** | 🟡 98.98% vs a zero benchmark |
| 🔴 **Multiple-testing correction** | 🟢 **DSR's `nTrials`** | 🔴 **NEVER** | 🔴 **THE ONE THAT KILLS IT. 043 found a deleted 40-config optimizer** |
| 🔴 **Bootstrap** | 🔴 **NOT IMPLEMENTED** | 🔴 | 🔴 **§0.3 — run today** |
| 🔴 **Sensitivity** | 🔴 **NOT IMPLEMENTED** | 🔴 | 🔴 **§0.3 — +₹226/trade = zero** |
| 🔴 **Stability** | 🔴 **NOT IMPLEMENTED** | 🔴 | 🔴 **§0.1 — 71% of profit from one year** |

## 🔴 **UNSUPPORTED CLAIMS, DOCUMENTED EXPLICITLY (as 045 requires):**

| Claim | Verdict |
|---|---|
| "SHORT_STRANGLE 89% win rate" | 🔴 **UNSUPPORTED — look-ahead artefact** *(042)* |
| "Real 120-day bhavcopy backtest validates the edge" | 🔴 **UNSUPPORTED — same contaminated column** |
| "600-day backtest reconfirms selling edge" | 🔴 **UNSUPPORTED — 59.4% net, FAILS deflation** |
| "VRP is the real edge" | 🔴 **UNSUPPORTED — §0.1: it INVERTS at high vol** |
| 🔴 **"charges.js understates short costs by ₹157.62/trade" — MY OWN CLAIM, audit 013** | 🔴 **RETRACTED. Measured: ₹0.32. §0.4** |

---

# PART 4 — ROBUSTNESS ASSESSMENT

| Condition | Assessed? | Result |
|---|---|---|
| **Bull markets** | 🟢 **YES — §0.1** | 🟡 **₹59/trade, Sharpe 0.43 — negligible** |
| **Bear markets** | 🟢 **YES** | 🟢 **₹566/trade, Sharpe 2.02 — the best trend regime** |
| **Sideways markets** | 🟢 **YES** | 🟢 **₹232/trade, Sharpe 2.11 — the bulk of the sample** |
| 🔴 **High-volatility regime** | 🟢 **YES** | 🔴 **₹−13/trade, Sharpe −0.06 — LOSES MONEY** |
| **Low/mid-volatility** | 🟢 **YES** | 🟢 **Sharpe 2.32 / 2.55** |
| 🔴 **Expiry periods** | 🟢 **YES** | 🔴 **DTE 1–2 = 88% of profit; DTE 3–4 = LOSES ₹257/trade** |
| 🔴 **High-volume / low-liquidity sessions** | 🔴 **NOT ASSESSED** | 🔴 **UNKNOWN — the bhavcopy has volume (col 24), and `bt-lib.js:39` DOES NOT MAP IT** *(032/033)* |

## **7 conditions. 6 assessed today for the first time. 1 is UNKNOWN and stays UNKNOWN — the data is in the file and the loader throws it away.**

---

# PART 5 — LEAKAGE & BIAS REGISTER

| Control | Present? | Evidence |
|---|---|---|
| 🔴 **Look-ahead bias** | 🔴 **CONFIRMED — 9 FILES** | 🔴 **`day.underlying` = the day's own close** *(042 §0.1)* |
| 🔴 **Data leakage** | 🔴 **CONFIRMED** | 🔴 same mechanism |
| 🟡 **Label leakage** | 🟡 **UNKNOWN** | 🔴 **cannot be ruled out — the AI labels from live state** *(018)* |
| 🟢 **Survivorship (market)** | 🟢 **LOW** | 🟢 index options — no delisting |
| 🔴 **Survivorship (RESEARCH)** | 🔴 **CONFIRMED — SEVERE** | 🔴 **37 experiments DELETED; only the winner survived** *(043)* |
| 🔴 **Selection bias** | 🔴 **CONFIRMED — DECISIVE** | 🔴 **a 40-config optimizer ranked by win rate** *(043)* |
| 🔴 **Curve fitting** | 🔴 **CONFIRMED — and §0.2 warns of the NEXT one** | 🔴 `BEST_GUESS` config, hand-assembled from winners |
| 🔴 **Hyperparameter overfitting** | 🔴 **CONFIRMED** | 🔴 **OTM_PCT, stopMult, wingPts — all hand-chosen, never counted as trials** |

## **8 controls. 6 CONFIRMED failures, 1 unknown, 1 clean.**

---

# PART 6 — OPERATIONAL VALIDATION

| Requirement | Status |
|---|---|
| 🟢 **Paper trading evidence** | 🟢 **REAL — and the only uncontaminated evidence in the repository** |
| **Execution consistency** | 🟡 **all 7 `placeOrder` sites GUARDED — verified** *(012)* |
| 🔴 **Risk controls** | 🔴 **`/api/risk` reports `consecLosses: 0` while the engine holds `15` against a limit of `8`** *(013)* |
| 🔴 **Monitoring readiness** | 🔴 **0 of 8 observability signals** *(040)* |
| 🔴 **Failure handling** | 🔴 **INC-001: the bot died during audit 021 and is STILL DOWN. MTTD = ∞** |
| 🔴 **Rollback readiness** | 🔴 **one `.bak`, 24 h stale; the model artifact is UNTRACKED** *(044)* |

> ## 🔴 **045: *"Deployment without operational evidence is not considered validated."* The bot has been DEAD for the entire back half of this audit programme. There IS no current operational evidence.**

---

# PART 7 — OBSERVABILITY

| Every validation run must record | Present? |
|---|---|
| Model version · Dataset version · Feature version · Config version · Validation timestamp · Statistical results · Decision outcome | 🔴 **0 of 7** |

**Including the runs in THIS document. They are reproducible only because the harness is deterministic
(seeded LCG, no `Math.random`) and the bhavcopy is immutable — not because the platform recorded anything.**

---

# PART 8 — FAILURE MODE REGISTER

| Failure mode | Present? | Scientific impact |
|---|---|---|
| 🔴 **False confidence** | 🔴 **CONFIRMED — THE DEFINING ONE** | 🔴 **DSR returned 0.9999 `PASS (edge real @95%)` on a look-ahead artefact** *(002/009)* |
| 🔴 **Underpowered validation** | 🔴 **CONFIRMED** | 🔴 **12 labelled outcomes for meta-label; 130 for the AI; kurtosis 30.6 on 599 trades** |
| 🔴 **Incomplete datasets** | 🔴 **CONFIRMED** | 🔴 **volume (col 24) is IN THE FILE and not loaded — so liquidity robustness is UNKNOWN** |
| 🔴 **Invalid benchmarks** | 🔴 **CONFIRMED** | 🔴 **PSR was run against SR* = 0. No buy-and-hold, no risk-free, no control** |
| 🟢 **Missing paper trading** | 🟢 **NOT PRESENT** | 🟢 **paper trading is the one thing that IS real** |
| 🔴 **Statistical misinterpretation** | 🔴 **CONFIRMED** | 🔴 **009: a look-ahead Sharpe of 0.846 would have PASSED DSR at any trial count** |
| 🔴 **Unverified assumptions** | 🔴 **CONFIRMED — INCLUDING MINE** | 🔴 **§0.4: audit 013's ₹157.62 figure does not reproduce. Measured: ₹0.32** |

---

# PART 9 & 10 — VALIDATION ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   ValidationRegistry  ★
     🔴 NO RESULT IS A RESULT until it carries: gitSha · dataHash · seed · nTrials · verdict.

   🔴 RobustnessEngine  ★★★   — THE LAYER WHOSE ABSENCE IS §0.1
     Every strategy is sliced by regime BEFORE it is believed:
       trend · VOLATILITY · DTE · liquidity · year.
     🔴 A strategy that is NEGATIVE in any regime it will actually trade in is NOT VALIDATED —
        it is a strategy with an undeclared filter.
     🔴 The short strangle LOSES MONEY at realised vol >= 15%. There is no vol gate anywhere
        in strangle-engine.js. That is a live, unguarded exposure.

   StatisticalReviewLayer  ★★★
     🔴 nTrials IS AN INPUT, NOT AN AFTERTHOUGHT. It comes from the TrialCounter (043).
     🔴 BOOTSTRAP AND SENSITIVITY ARE MANDATORY. §0.3: +Rs226/trade of slippage = zero edge,
        and slippage is not modelled AT ALL.

   THE RULE 045 ESTABLISHES:
     🔴 ROBUSTNESS IS NOT A REFINEMENT OF VALIDATION. IT IS VALIDATION.
        A strategy with an aggregate Sharpe of 1.62 that is NEGATIVE in high volatility and
        NEGATIVE at DTE 3-4, and earns 88% of its profit in one DTE bucket and 71% in one year,
        has not been validated. It has been AVERAGED.
```

---

# PART 11 — TESTING STRATEGY

**Scientific validity has priority over model accuracy.**

| Test | Priority | Fails today? |
|---|---|---|
| 🔴 **No strategy reads a same-day close (all 9 files)** | **P0** | ✅ **FAILS** |
| 🔴 **Every result passes DSR at the HONEST nTrials** | **P0** | ✅ **FAILS — 0 callers** |
| 🔴 **Every strategy is sliced by regime before deployment** | **P0 — §0.1** | ✅ **FAILS — never done until today** |
| 🔴 **A strategy negative in a tradeable regime is REJECTED or GATED** | **P0 — high vol** | ✅ **FAILS — no vol gate exists** |
| 🔴 **Bootstrap CI + cost sensitivity on every claim** | **P0 — §0.3** | ✅ **FAILS — not implemented** |
| 🔴 **A filter discovered post-hoc INCREMENTS nTrials** | **P0 — §0.2. The next trap** | ✅ **FAILS — nothing counts trials** |
| 🟢 **The 002 look-ahead tripwire** | P0 | 🟢 **PASSES — extend it to the other 8 files** |

---

# PART 12 — VALIDATION MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Basic Accuracy Checks** | 🟢 **YES** | Win rate off a console |
| **1 — Repeatable Validation** | 🔴 **NO** | 🔴 **0 of 7 provenance fields on any validation run** |
| **2 — Statistical Validation** | 🟡 **PARTIAL — as of 042/045** | 🟢 **7 correct methods EXIST** · 🔴 **0 were used until an audit used them** |
| **3 — Governed Validation Framework** | 🔴 **NO** | 🔴 **No acceptance criteria on any process** |
| **4 — Institutional Quant Validation** | 🔴 **NO** | 🔴 **No robustness engine; no vol gate on a vol-selling strategy** |
| **5 — Scientific Model Assurance** | 🔴 **NO** | — |

## ## **VALIDATION PLATFORM: LEVEL 0–1.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Preconditions | Risks | Exit criteria |
|---|---|---|---|
| **1 — INVENTORY** | ✅ **DONE — Part 1. 4 processes did not exist until today** | — | Every process named |
| **2 — 🔴 TEMPORAL INTEGRITY (still first)** | none | 🟢 LOW — 9 files, none protected | **No strategy reads a same-day close** |
| **3 — STATISTICAL GOVERNANCE** | Phase 2 + the TrialCounter *(043)* | 🟢 **LOW — `bt-validate.js` is written and correct. CALL it** | 🔴 **Every claim carries DSR at honest nTrials + a bootstrap CI** |
| **4 — 🔴 ROBUSTNESS ENGINE** | Phase 3 | 🟡 **MEDIUM — §0.2: every post-hoc filter is a new trial** | 🔴 **No strategy is deployed while NEGATIVE in a regime it trades. The high-vol result is a HARD BLOCKER** |
| **5 — OPERATIONAL VALIDATION** | Phase 4 | 🔴 **the bot is DOWN** | 🔴 **`/api/risk` tells the truth; the halt persists; paper evidence accrues** |

---

# PART 14 — SUCCESS CRITERIA — **is the short strangle validated?**

| Criterion | Verdict |
|---|---|
| **Statistical evidence supports its claims** | 🔴 **NO — DSR FAILS at the true trial count** *(042/043)* |
| **Out-of-sample performance documented** | 🟢 **YES — as of 042. Walk-forward OOS holds across 26 folds** |
| **Walk-forward is reproducible** | 🟢 **YES — deterministic, seeded** |
| **Paper trading confirms operational behaviour** | 🔴 **NO — the bot is DOWN. No current operational evidence** |
| **Bias and leakage investigated** | 🟢 **YES — and 6 of 8 controls FAILED** |
| 🔴 **Robustness assessed across market conditions** | 🔴 **NO — ASSESSED TODAY, AND IT FAILS. Negative at high vol. Negative at DTE 3–4** |
| **Unknown limitations explicitly documented** | 🟢 **YES — §0.3, §0.4, and the liquidity slice remains UNKNOWN** |

## 🔴 **3 of 7. THE SHORT STRANGLE IS NOT VALIDATED.**

---

# STOP CONDITIONS

| Condition | Verdict |
|---|---|
| *Statistical evidence cannot be verified* | 🔴 **FIRES — and it fired on MY OWN published number (§0.4)** |
| *Validation datasets are incomplete* | 🔴 **FIRES — volume is in the file and the loader discards it; liquidity robustness is UNKNOWN** |
| *Leakage assessment is unavailable* | 🟢 **DOES NOT FIRE — it was done. 6 of 8 controls failed** |
| *Paper trading evidence insufficient for operational claims* | 🔴 **FIRES — the bot is DOWN and has been for the second half of this programme** |

---

# EXECUTIVE SUMMARY

**The mission: could an independent validation engineer verify every statistical claim, assess robustness
across market conditions, and determine whether any model is suitable for deployment?**

## **Yes — and the verdict is that the platform's one surviving edge is NOT ROBUST. It is CONCENTRATED, and it is NEGATIVE in exactly the regime a volatility seller must survive.**

> ## 🔴 **THE VOLATILITY SELLER LOSES MONEY WHEN VOLATILITY IS HIGH.**
>
> **At realised volatility of 15% or more — 128 of 579 trades — the short strangle returns **₹−13 per trade
> at a Sharpe of −0.06.** Not weaker. Negative.**
>
> **That is the volatility risk premium inverting, and it is the whole thesis of the strategy failing in
> the one regime it was supposed to be paid for. The strategy collects small premiums through calm markets
> and hands them back when the market moves. And there is NO VOLATILITY FILTER anywhere in
> `strangle-engine.js` — it has a stop multiple, a take-profit and a wing width, and no idea what regime
> it is in.**

**Two more concentrations, both fatal to the word "robust":**

> **🔴 **Eighty-eight percent of all profit comes from a single bucket — DTE 1–2** (₹1,26,014 of ₹1,42,491).
> The bucket next door, DTE 3–4, **LOSES ₹257 per trade at a Sharpe of −1.94.** DTE 5+ earns ₹3 a trade.**
>
> **🔴 **Seventy-one percent of all profit came from 2025 alone.** 2026 — the most recent and most
> out-of-sample year available — returns a Sharpe of 0.70.**
>
> **An aggregate Sharpe of 1.62 across all 579 trades is not a validated edge. It is an AVERAGE of one
> excellent pocket and several losing ones.**

**And the trap that comes next, stated before anyone falls into it:**

> ## **DO NOT now restrict the strategy to DTE 1–2 and filter out high vol because this table says so. That is the curve fit. Every filter chosen after seeing this table is another trial — and 042 already measured the Deflated Sharpe at FAIL for ten trials, while 043 recovered a DELETED optimizer that alone swept FORTY configurations and ranked them by win rate. The regime slice is a DIAGNOSIS, not a recipe.**

**The bootstrap and the sensitivity test finish the picture:**

> **95% CI on the mean: **[₹32.60, ₹472.14]**. 95% CI on the annualised Sharpe: **[0.20, 2.80]**.
> And **₹226 per trade of unmodelled cost reduces the edge to exactly zero** — while the backtest models
> **no slippage and no bid-ask spread at all**, across four executions per trade on index options.**

**And one correction I have to make to my own work:**

> ## 🔴 **AUDIT 013 CLAIMED `charges.js` UNDERSTATES SHORT COSTS BY ₹157.62 PER TRADE (≈₹20,333 over 129 trades). I RE-DERIVED IT ON THE 599 REAL TRADES. THE TRUE FIGURE IS ₹0.32 PER TRADE — ABOUT 500× SMALLER.**
>
> **The bug is real: `roundTripCharges(entry, exit, …)` treats the entry as a BUY, and a short SELLS at
> entry, so STT lands on the wrong leg. But the error is `gross P&L × 0.00097`, and it is immaterial. My
> published figure is RETRACTED.**
>
> **045 exists to verify statistical claims. That includes mine. This is the eleventh error I have caught
> in my own work in this programme, and the first that had already been published as a number.**

## **The short strangle meets 3 of 7 validation criteria. It is NOT VALIDATED. It has a real but thin edge, concentrated in one expiry window and one calendar year, that fails multiple-testing correction, dies in high volatility, and would be erased by ₹226 a trade of the slippage nobody has modelled.**

**Per 045's stop condition: *"Never declare a model production-ready solely because it performed well in
historical backtests."* This one did not even do that.**

---

**Performance improved: NONE. Architecture redesigned: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Validation Inventory (Part 1) · Lifecycle (Part 2) · **Statistical Review (§0.3, Part 3)** ·
**Robustness Assessment (§0.1, Part 4)** · Leakage & Bias (Part 5) · Operational Validation (Part 6) ·
Observability (Part 7) · Failure Modes (Part 8) · Validation Architecture (Parts 9–10) · Testing Strategy
(Part 11) · Maturity (Part 12) · Roadmap (Part 13) · Executive Summary.

**Stop conditions: statistical evidence 🔴 FIRES (on my own number) · datasets 🔴 FIRES · leakage — does not
fire · paper-trading evidence 🔴 FIRES.**
