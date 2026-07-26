# 001-D — RESEARCH INTEGRITY, BACKTESTING & STATISTICAL VALIDATION FORENSIC AUDIT

**Standard:** Master Prompt 001-D · **Depends on:** 000-A…E, 001-A, 001-B, 001-C
**Date:** 2026-07-12 · **HEAD:** `7823864` · **Suite:** 47/47 green
**Mode:** READ-ONLY. **No strategy was improved, no parameter tuned, no backtest rewritten. Zero files modified.**

**Method.** A measurement harness was run against all 13 `bt-*.js` scripts, the 600-day bhavcopy
archive, and every paper-trading ledger in `data/`. Every number is reproducible. Where evidence was
insufficient, the entry reads **UNKNOWN** and names the measurement that would settle it.

---

## SECTION 0 — VERDICT

> ## **NO RESEARCH CONCLUSION PRODUCED BY THIS PLATFORM IS SCIENTIFICALLY RELIABLE.**

Not "some". **None.** The reason is a single defect that is present in **every** strategy script, and —
the finding that changes everything — **it is also present in the validation harness that exists to
catch it.**

| | |
|---|---|
| Strategy scripts audited | **8** (of 13 `bt-*` files; 5 are fetchers/libs) |
| **Scripts free of look-ahead** | **ZERO** |
| **`bt-validate.js` itself contaminated** | 🔴 **YES — `bt-validate.js:152, 172`** |
| Strategies at Level 3 (statistically validated) | **ZERO** |
| Labelled paper outcomes | **58 — across 5 incompatible ledgers** |
| **AI readiness** | 🔴 **BLOCKED — INSUFFICIENT EVIDENCE** |
| **Research maturity (highest strategy)** | **Level 2 — Backtested (invalidly)** |

---

## SECTION 1 — RESEARCH ASSET CATALOGUE

| Script | LOC | Purpose | Uses `bt-lib` | Costs | Calls `bt-validate` | Status | Confidence |
|---|---|---|---|---|---|---|---|
| `bt-lib.js` | 58 | Shared bhavcopy loader | — | — | — | **Fixed 2026-07-10** (additive) | HIGH |
| `bt-bhav-fetch.js` | 57 | Downloads NSE UDiFF bhavcopy | — | — | — | Works | HIGH |
| `bt-fetch-1min.js` | 42 | Upstox 1-min candles | — | — | — | Works | MEDIUM |
| **`bt-real.js`** | 81 | Directional intraday buying | **YES** | **NONE** | — | 🔴 **INVALID** | HIGH |
| **`bt-strangle-costs.js`** | 122 | Short strangle + cost sweep | **YES** | `charges.js` | — | 🔴 **INVALID — the flagship** | HIGH |
| **`bt-strangle-regime.js`** | 152 | Strangle + regime filters | **YES** | `charges.js` | — | 🔴 **INVALID** | HIGH |
| **`bt-strangle-tailsafe.js`** | 140 | Strangle + tail hedge | **YES** | `charges.js` | — | 🔴 **INVALID** | HIGH |
| **`bt-strangle-trend.js`** | 97 | Strangle + trend filter | **YES** | `charges.js` | — | 🔴 **INVALID** | HIGH |
| **`bt-strategies.js`** | 256 | Multi-strategy comparison | **no — own loader** | `charges.js` | — | 🔴 **INVALID + own copy of the bug** | HIGH |
| **`bt-world-strategies.js`** | 212 | Condors, calendars, world set | **YES** | `charges.js` | — | 🔴 **INVALID** | HIGH |
| **`bt-nifty-intraday.js`** | 246 | 1-min intraday | — | **NONE** | — | 🔴 `LOT = 75` hardcoded | HIGH |
| `bt-gex-vs-vix.js` | 100 | GEX/VIX relationship study | — | — | — | Exploratory | LOW |
| **`bt-validate.js`** | 227 | **Purged k-fold · walk-forward · PSR · DSR** | **YES** | `charges.js` | — | 🔴 **ITSELF CONTAMINATED** | HIGH |

### 🔴 FINDING R-01 — The validator has the disease it was built to detect

`bt-validate.js` implements everything a serious research desk needs:

```
purged k-fold      9 refs        deflated Sharpe    9 refs
walk-forward       4 refs        PSR               15 refs
Sharpe            71 refs        DSR               20 refs

exports: normCdf, normInv, mean, std, skewness, kurtosis, sharpe,
         probabilisticSharpe, expectedMaxSharpe, deflatedSharpe,
         walkForward, purgedKFold, expectancy
```

**And its own strategy function reads today's close:**

```js
bt-validate.js:152   const atm = atmStrike(day), off = Math.round((day.underlying * OTM_PCT) / 50) * 50;
bt-validate.js:172   const atm = atmStrike(day); const ce = leg(day,'CE',atm), pe = leg(day,'PE',atm);
bt-validate.js:173   const v = (ce && pe && ce.o > 0 && pe.o > 0) ? (ce.o + pe.o) / day.underlying : null;
```

> **Purged k-fold, deflated Sharpe and PSR exist to defend against overfitting and selection bias.
> None of them defends against look-ahead.** Feed a leaky strategy into a perfect validator and you get
> a **rigorously computed, statistically confident, completely wrong** answer.
>
> **A validator that shares the defect cannot detect it.** This is the most important finding in the
> audit, and it means the previously recommended action — *"run every strategy through
> `bt-validate.js`"* — **would have produced false confidence, not validation.**

**Callers of `bt-validate.js`: `forward-test-report.js` only.** *(Corrects a prior claim of "zero
callers" — zero **strategy** scripts call it; one **reporting** script does. See §14.)*

---

## SECTION 2 — DATA PROVENANCE

| Property | Value | Confidence |
|---|---|---|
| **Source** | NSE UDiFF F&O bhavcopy — `nsearchives.nseindia.com/content/fo/BhavCopy_NSE_FO_0_0_0_{YYYYMMDD}_F_0000.csv.zip` | **HIGH** — the exchange's own file |
| **Coverage** | **600 CSV days**, `nifty-20240108.csv` … `nifty-20260617.csv` | HIGH |
| **Timestamp semantics** | `TradDt` (col 0) = the trading date. **Daily EOD only. No intraday timestamps exist in this dataset** | HIGH |
| **Timezone** | IST implied, never declared anywhere in code | **MEDIUM — assumption flagged** |
| **Update frequency** | Manual (`bt-bhav-fetch.js`) | HIGH |
| **Column semantics** | `[0] TradDt · [9] Xpry · [11] Strk · [12] Optn · [14] Opn · [15] Hgh · [16] Lw · [17] Cls · [20] UndrlygPric · [22] OpnIntrst · [24] TtlTradgVol · [28] NewBrdLotQty` | HIGH |
| 🔴 **`UndrlygPric` (col 20)** | **The underlying's CLOSING level for that day.** This is the entire audit | **HIGH — the root cause** |
| **Lot size handling** | `NewBrdLotQty` (col 28) is present on **every row** | HIGH |
| **Contract adjustments** | Index options — **not applicable** | HIGH |
| `oi_unit` (NSE) | **UNITS, not contracts** — proven across 5 NSE symbols (`docs/EVIDENCE-F4-oi-unit.md`) | **HIGH** |
| `oi_unit` (BSE) | **UNKNOWN** — different file format, never tested | **UNKNOWN** |
| Settlement price | `SttlmPric` non-zero on **1,804/1,808** rows × 600 days | HIGH |

### 🔴 The lot distribution — measured, and it settles constraint F1

```
NewBrdLotQty across 600 NIFTY days:
    25 →  161 days
    50 →   72 days
    65 →  123 days
    75 →  244 days

The hardcoded 75 is WRONG on 356 / 600 days  =  59.3%
```

**Every position size, every charge, every P&L computed with `LOT = 75` is scaled by a number that is
wrong on three days out of five.** Still hardcoded in: `bt-strategies.js:23`, `bt-nifty-intraday.js:226`
— **and, per 001-C finding D-01, in `server.js` (as `lotSize: 65`) at three separate lines.**

### Assumptions flagged (per 001-D: "flag all assumptions")

| # | Assumption | Status |
|---|---|---|
| A-1 | Bhavcopy timestamps are IST | **Never declared. Assumed.** Harmless for EOD data; would matter the moment intraday data is joined |
| A-2 | `UndrlygPric` is the close, not a settlement or VWAP | **Consistent with the field name and with NSE's spec. HIGH confidence, but never verified against a second source** |
| A-3 | The option `Opn` (col 14) is a *tradeable* price at 09:15 | 🔴 **FALSE IN PRACTICE.** It is the first trade of the day — which may be at 09:15:03 at a price no one could have got. **No slippage model corrects for this.** See §4 |
| A-4 | Broker chain OI uses the same unit as bhavcopy OI | **UNKNOWN.** 001-B Risk A-13. **One row of comparison settles it** |

---

## SECTION 3 — TEMPORAL INTEGRITY REPORT

### 🔴 R-02 — LOOK-AHEAD BIAS. **Universal. All 8 strategy scripts.**

**The mechanism, in three lines:**

```js
bt-lib.js:22    const underlying = +rows[0][20];              // UndrlygPric = TODAY'S CLOSE
bt-lib.js:46    atmStrike = (day) => round(day.underlying/50)*50;   // strike chosen FROM the close
<strategy>      const entry = ce.o;                           // ...and SOLD at TODAY'S OPEN
```

**The strategy chooses which strike to trade using a price that will not exist for another six and a
half hours, then trades it at this morning's price.** It is not a subtle bias. It is time travel.

### Complete finding table

| File | Line | Function | Evidence | Sev | Confidence |
|---|---|---|---|---|---|
| **`bt-lib.js`** | **22, 46** | `loadDay`, `atmStrike` | `underlying = +rows[0][20]` (the close); `atmStrike` consumes it | **CRITICAL** | **HIGH** |
| **`bt-strangle-costs.js`** | **45, 46** | strike selection | `atmStrike(day)`; `off = round(day.underlying*OTM_PCT/50)*50` → entry at `ce.o + pe.o` (`:51`) | **CRITICAL** | **HIGH** |
| **`bt-strangle-regime.js`** | 35, 40, 63, 64, 100 | strike + IV proxy + trend | `straddle/(0.8*day.underlying*√(dte/365))` — **the regime filter itself uses the close** | **CRITICAL** | **HIGH** |
| **`bt-strangle-tailsafe.js`** | 46, 47, 113, 114 | strike (twice) | same pattern, both the naked and the hedged variant | **CRITICAL** | **HIGH** |
| **`bt-strangle-trend.js`** | 35, 36, 65 | strike + trend series | `days.map(d => d.underlying)` — **the trend filter is built from closes and applied same-day** | **CRITICAL** | **HIGH** |
| **`bt-strategies.js`** | **32, 45, 77, 94, 95, 112…** | **its own loader** | 🔴 **`const underlying = +rows[0][20]` — an independent re-implementation of the same bug.** Fixing `bt-lib` does **not** fix this file | **CRITICAL** | **HIGH** |
| **`bt-world-strategies.js`** | 82, 91, 100, 110, 116, 122 | condors, calendars, strangles | `mkStrangle(day, day.underlying*0.015)` | **CRITICAL** | **HIGH** |
| **`bt-real.js`** | **15, 48, 65** | ATM + **gap filter** | 🔴 `gapPct = (day.underlying − prevClose)/prevClose` — **the "gap" is measured from today's CLOSE, then used to decide a trade taken at today's OPEN.** The gap filter is *pure* look-ahead | **CRITICAL** | **HIGH** |
| 🔴 **`bt-validate.js`** | **152, 172, 173** | **the validator** | See R-01 | **CRITICAL** | **HIGH** |

### Other temporal checks

| Check | Result |
|---|---|
| **End-of-day data used intraday** | 🔴 **YES — this is the defect.** `UndrlygPric` (EOD) drives an entry at the open |
| **Close price used before close** | 🔴 **YES — universal** |
| Future option chain access | 🟢 **NO** — `nearExp` filters `exps >= date`. Correct |
| Future IV | 🟢 **N/A** — IV is not in the bhavcopy; it is computed |
| **Future OI** | 🟡 **PARTIAL RISK.** `OpnIntrst` in the bhavcopy is **end-of-day OI**. Any filter of the form "OI > 50,000" (`bt-real.js:9` `MINOI=50000`) applied to a trade taken **at the open** is reading OI that will not be known until 15:30. **`bt-real.js` does exactly this.** 🔴 **A SECOND, INDEPENDENT LOOK-AHEAD** |
| Future Greeks | 🟢 N/A |

### 🔴 R-03 — A **second** look-ahead in `bt-real.js`, previously unreported

`bt-real.js:9` declares `MINOI = 50000`. The OI it filters on comes from the bhavcopy — **which is
end-of-day OI.** A strategy that enters at 09:15 **cannot know the day's closing open interest.**

**`bt-real.js` therefore has TWO independent look-aheads** — the strike (via `atmStrike`) *and* the OI
filter. Removing one does not fix it.

> This matters because `bt-real.js` is the **buying** strategy — the one already reported as
> "refuted at PF 0.94, and PF 0.84 *even with* look-ahead". **That statement understated the problem:
> it had two.**

---

## SECTION 4 — EXECUTION REALISM

| Script | Lot | Costs | Slippage | Verdict |
|---|---|---|---|---|
| `bt-strangle-costs.js` | ✓ from data | `charges.js` | ✓ **swept 0–2%** | Best in class — *and still invalid* |
| `bt-strangle-regime.js` | ⚠️ `sizeLots(cap, credit)` — **2-arg form ⇒ silently uses `LOT = 75`** | `charges.js` | ✓ | Sizing wrong on 59.3% of days |
| `bt-strangle-trend.js` | ⚠️ same 2-arg `sizeLots` | `charges.js` | ✓ | same |
| `bt-strangle-tailsafe.js` | ⚠️ same | `charges.js` | ✓ | same |
| **`bt-strategies.js`** | 🔴 **`LOT = 75` hardcoded** | `charges.js` | 🔴 **NONE** | Fills assumed perfect |
| **`bt-world-strategies.js`** | ⚠️ | `charges.js` | 🔴 **NONE** | Fills assumed perfect |
| **`bt-nifty-intraday.js`** | 🔴 **`lot = 75`** | 🔴 **NONE** | 🔴 **NONE** | **No costs at all** |
| **`bt-real.js`** | — | 🔴 **NO `charges.js`** — the only cost is `SLIP = 0.02` | ✓ 2% | 🔴 **Brokerage, STT and exchange charges are entirely absent** |

### Findings

- 🔴 **R-04 — `bt-real.js` models slippage but not a single rupee of brokerage, STT or exchange
  charge.** It is the **directional buying** strategy. For an option buyer, round-trip charges on a
  ₹38 premium are material. **This strategy's P&L is overstated by every rupee of cost it never paid** —
  and it *still* lost money (PF 0.94).
- 🔴 **R-05 — `sizeLots(cap, prem)` silently defaults to `LOT = 75`.** The 2-argument form is used by
  `bt-strangle-regime`, `-trend` and `-tailsafe`. `bt-lib.js` now *offers* the real per-day lot
  (`sizeLots(cap, prem, day.lot)`), but **not one script passes it.** The additive fix is available and
  **unused**.
- **STT / exchange-charge rates are DISPUTED (constraint E1).** `charges.js` carries a rate pair that
  is believed wrong in **both** directions, netting to ≈ −0.33%. **UNKNOWN until the exchange circular
  is read. Do not guess.**
- **Entry-price realism.** All strategies enter at the bhavcopy `Opn` — the day's **first traded price**.
  For an illiquid OTM strike this may be a print no participant could have obtained. **No script models
  a bid-ask spread.** UNKNOWN magnitude; requires intraday data the platform does not have.

---

## SECTION 5 — STRATEGY ASSUMPTION REGISTER

| Strategy | Hypothesis | Entry | Exit | Risk model | Sizing | Regime | **Undocumented assumptions** |
|---|---|---|---|---|---|---|---|
| **Short strangle** (`bt-strangle-*`) | Volatility risk premium: implied > realised | Sell OTM CE+PE at the open | Close at EOD / stop | Stop on the leg's high | `sizeLots` (**silently `LOT=75`**) | Regime/trend filters trialled | 🔴 **That the strike can be chosen at the open.** 🔴 That margin is free (**SPAN not modelled — not in the bhavcopy**). 🔴 That a 5% risk cap is safe for a **naked short** with unbounded loss |
| **Directional buying** (`bt-real.js`) | Multi-confirm momentum | Buy ATM at the open | SL 5% / target 4× / trail | `SL = 0.05` | `RISKPCT = 0.05` | none | 🔴 **9 tuned constants, none justified.** 🔴 **OI filter reads EOD OI.** 🔴 **Zero brokerage/STT** |
| **Condor / calendar** (`bt-world-*`) | Defined-risk premium capture | open | EOD | — | — | — | 🔴 No slippage. 🔴 Calendars require **two expiries priced simultaneously** — the bhavcopy gives both, but not a tradeable spread |
| **Gamma blast** (`gamma-blast-engine.js`) | Expiry-day gamma | live paper only | — | — | — | expiry day | 🟢 **HONEST — declared not backtestable.** Forward-test only. **The only strategy whose evidence claim matches its evidence** |

### 🔴 R-06 — Nine free parameters, zero justification

```js
bt-real.js:9   const MAXPREM=38, MINOI=50000, SL=0.05, TARGET=4.0, TRAIL_AT=2.0, TRAIL_LOCK=0.90;
bt-real.js:10  const SLIP=0.02, RISKPCT=0.05, GAP_THR=0.15;
```

**Not one of the nine carries a source, a derivation, or a sensitivity test.** Nine free parameters on
a few hundred trades is enough to fit noise. There is **no ADR, no comment, no research note** for any
of them.

> The platform's own history confirms the hazard: `bt-real.js`'s first 100 trades showed **+312 pts,
> PF 1.31**; at 1,200 trades it was **PF 0.94**. The early result was sample noise, and nine knobs are
> exactly what lets noise look like signal.

---

## SECTION 6 — VALIDATION COVERAGE MATRIX

| | Strangle | Directional | World set | Intraday | Gamma blast |
|---|---|---|---|---|---|
| Characterization tests | 🟡 `bt-lib` only | 🟡 `bt-lib` only | ❌ | ❌ | ❌ |
| Historical backtest | ✅ 129 trades | ✅ 1,200 trades | ✅ | ✅ | ❌ **N/A — declared** |
| **Walk-forward** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Purged K-fold** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Bootstrap** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Monte Carlo** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **PSR** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **DSR** | ❌ | ❌ | ❌ | ❌ | ❌ |
| Paper validation | 🟡 partial | ❌ **disabled 2026-06-22** | ❌ | ❌ | 🟡 running |
| Forward evaluation | 🟡 | ❌ | ❌ | ❌ | 🟡 |

**Missing stages: walk-forward, purged k-fold, bootstrap, Monte Carlo, PSR, DSR — for EVERY strategy.**

**All six are implemented in `bt-validate.js` and connected to nothing.**

> **And — R-01 — even connecting them would not help, because the validator carries the same
> look-ahead.** The correct sequence is therefore: **fix the leak first, in the library AND in the
> validator, THEN validate.** Validating first would have manufactured confidence in a broken result.

---

## SECTION 7 — STATISTICAL QUALITY

| Metric | Strangle | Directional |
|---|---|---|
| **Sample size** | **129 trades** | 1,200 trades |
| Period | 600 days (2024-01-08 → 2026-06-17) | 197 days |
| Confidence intervals | **NONE COMPUTED** | **NONE COMPUTED** |
| Effect size | **NOT COMPUTED** | — |
| Drawdown stability | Single-path max-DD only. **No distribution** | same |
| Variance / distribution shape | **NOT COMPUTED** (`bt-validate.js` exports `skewness`, `kurtosis` — **unused**) | same |
| Outlier sensitivity | **NOT TESTED** | **NOT TESTED** |

### 🔴 R-07 — 129 trades is not a sample, it is an anecdote

A 129-trade sample with **no confidence interval, no bootstrap, and no out-of-sample split** cannot
distinguish an edge from luck **even if the data were clean.**

Reported win rates:

```
A  as shipped (look-ahead)     129 trades   88.4% win   PF 7.41   +₹3,65,579
B  no look-ahead               129 trades   46.5% win   PF 0.55   −₹79,899
C  no look-ahead + real lot     129 trades   46.5% win   PF 0.61   −₹52,434
```

**Naked short strangles are an unbounded-loss structure.** For such a strategy the tail is the entire
question, and **129 observations over 2.4 years contains approximately zero tail events.** Even a clean
PF of 1.5 on this sample would say nothing about the trade that ends the account.

> **STOP CONDITION.** Whether the volatility risk premium exists in Indian index options is
> **UNKNOWN and not answerable from this repository's evidence.** No literature was consulted; no clean
> backtest exists. **The finding is that the platform's evidence is invalid — not that the edge is
> absent.**

---

## SECTION 8 — METRIC VERIFICATION REPORT

### 🔴 R-08 — Every metric is re-implemented per script. **Eight `maxDD`s. Four `PF`s.**

| Metric | Implementations | Locations |
|---|---|---|
| **Max drawdown** | **8** | `bt-strangle-costs:63` · `-regime:88` · `-trend:53` · `-tailsafe:74` · `bt-strategies:205` · `bt-world:167` · `bt-nifty-intraday:201` · `backtest-report:62` · `server.js:6593` |
| **Profit factor** | **4** | `bt-nifty-intraday:200` · `forward-test-report:44` · `server.js:6587` · `bt-world` (inline) |
| **Sharpe** | **3** | `backtest-report:90` · `bt-validate` (`sharpe`, 71 refs) · `forward-test-report:47` |
| Sortino | 1 | `backtest-report:91` |
| Expectancy | **3** | `bt-validate` · `signal-health:60` · `server.js:6588` |

**Mathematical consistency check:**

| Check | Result |
|---|---|
| `PF = grossWin / grossLoss` | 🟢 Consistent across all 4 |
| Division-by-zero on PF | 🟢 Handled — `grossLoss > 0 ? … : Infinity`. **Correct** |
| **`maxDD` — % of peak vs absolute points** | 🔴 **INCONSISTENT.** `bt-strangle-*` compute `(peak − cap)/peak` (**a fraction**); `bt-nifty-intraday:203` computes `peak − cum` (**absolute points**). **Both are called `maxDD`.** They are not comparable, and they appear side by side in reports |
| **Sharpe annualisation** | 🟡 `backtest-report:90` uses `× √tradesPerYear`. **`tradesPerYear` is an input, not a measurement.** If it is wrong, Sharpe is wrong by its square root. **UNKNOWN — never verified** |
| Expectancy | 🟢 `signal-health:60` `p·avgWin − (1−p)·avgLoss` — **correct** |
| CAGR | 🟡 present in `bt-strategies:210`, `backtest-report:128`. **Not cross-checked** |
| Recovery factor | ❌ **NOT COMPUTED ANYWHERE** |
| Exposure | ❌ **NOT COMPUTED ANYWHERE** |

> **`maxDD` means two different things in two different reports, and nothing declares which.** This is
> a metric-integrity defect independent of the look-ahead, and it would survive the look-ahead fix.

---

## SECTION 9 — PAPER TRADING ASSESSMENT

### 🔴 R-09 — 58 labelled outcomes, spread across **five incompatible ledgers**

| Ledger | Entries | Labelled |
|---|---|---|
| `data/ai-agents-trades.json` | 23 | **23** |
| `data/confluence-weights.json` | — | **21** |
| **`data/signal-outcomes.json`** ← *the canonical one* | 12 | **12** |
| `data/gamma-blast-trades.json` | — | 1 |
| `data/pop-book.json` | 2 | 1 |
| `data/signal-paper-positions.json` | 2 | **0** |
| `data/vrp-monitor.json` | **0** | **0** |
| | | **TOTAL: 58** |

**This corrects the standing "≈55 labelled outcomes" figure — it is 58, and it is NOT one dataset.**

> **Five ledgers, five schemas, five different definitions of "an outcome."** Calibration requires a
> *single* labelled dataset with a consistent label. The canonical file — `signal-outcomes.json` —
> holds **12**. **Twelve.**
>
> The other 46 are not interchangeable with it: an AI-agent paper trade and a confluence weight update
> are not the same event type, and no schema unifies them.

| Quality dimension | Assessment |
|---|---|
| Logging quality | 🟡 JSON per subsystem, no common schema |
| Signal capture | 🟡 Signals are captured; **the features that produced them are not** — no feature store ⇒ **no post-hoc re-labelling is possible** |
| Outcome recording | 🔴 **Fragmented** — 5 ledgers |
| Missing labels | `signal-paper-positions.json`: 2 entries, **0 labelled** |
| **`data/vrp-monitor.json` — EMPTY** | 🔴 **The VRP monitor is the one instrument that would test the platform's core hypothesis (implied > realised). It has recorded ZERO observations.** |
| Sample sufficiency | 🔴 **12 (canonical) vs ~200 needed.** **6% of the requirement** |
| Operational consistency | 🟡 The bot runs; NIFTY directional auto was disabled 2026-06-22 |

---

## SECTION 10 — AI READINESS ASSESSMENT

> ## 🔴 **BLOCKED — INSUFFICIENT EVIDENCE**

| Capability | Verdict | Evidence |
|---|---|---|
| **Probability estimation** | **BLOCKED** | 12 canonical labelled outcomes. A probability estimate needs a labelled dataset; there isn't one |
| **Confidence calibration** | **BLOCKED** | Calibration requires predicted-vs-realised pairs across bins. **58 outcomes across 5 schemas cannot fill one bin honestly** |
| **Ensemble weighting** | **BLOCKED — mathematically** | `engine-verdict.js:25`: *"`reliability: null` ⇒ weight 0 ⇒ VETO-ONLY."* **No engine publishes a measured out-of-sample `reliability` — the contract has ONE adopter.** Therefore every weight is 0 and **the weighted ensemble is the empty sum** |
| **Meta Decision Engine** | **BLOCKED** | Follows from the above. **v1 could only ever return `INSUFFICIENT_DATA`.** Building it would produce a component that is correct and useless |
| **Machine learning** | **BLOCKED** | No feature store. Features are computed and discarded. **You cannot train on data you did not keep** |

### 🔴 R-10 — An unverified reliability claim is already **shipping in production code**

```js
candlestick-patterns.js:344
  // TF reliability (backtest-grounded): 1hr patterns are far more predictive than 15m/5m.
```

**"Backtest-grounded" — by which backtest?**

There is **no backtest of candlestick patterns anywhere in this repository.** No `bt-patterns.js`. No
result file. No evidence chain. **This is a confidence claim, written into a live scoring path, with
no measurement behind it** — and it is used to weight real (paper) signals today.

| | |
|---|---|
| **Severity** | **HIGH** |
| **Confidence** | **HIGH** — the absence is measurable: no such script exists |
| **Classification** | **UNKNOWN presented as MEASURED.** The precise failure mode 000-A Rule Zero exists to prevent |

---

## SECTION 11 — RESEARCH MATURITY MATRIX

| Strategy | Level | Evidence |
|---|---|---|
| **Short strangle** | **Level 2 — Backtested (INVALIDLY)** | Backtest exists; **look-ahead ⇒ the result is not evidence.** Honest level: **Level 1 — Prototype** |
| **Directional buying** | **Level 2 — Backtested (INVALIDLY)** | **TWO look-aheads** (strike + OI). No costs. Refuted anyway (PF 0.94). Honest level: **Level 1** |
| **World set** (condors, calendars) | **Level 1 — Prototype** | Backtest exists; look-ahead + **no slippage** |
| **Intraday 1-min** | **Level 1 — Prototype** | `LOT = 75`, **no costs at all** |
| **Gamma blast** | **Level 1 — Prototype** | 🟢 **Honest** — explicitly declared not backtestable; forward-test only |
| **PoP seller** | **Level 1 — Prototype** | 1 labelled outcome |
| **AI agents** | **Level 1 — Prototype** | 23 paper trades, no calibration |

> ## **ZERO strategies at Level 3 (Statistically Validated). ZERO at Level 4. The platform's true research maturity is Level 1–2.**

---

## SECTION 12 — RESEARCH RISK REGISTER

*Ranked by impact on scientific validity.*

| ID | Risk | Sev | Evidence | Impact on validity |
|---|---|---|---|---|
| **R-01** | **`bt-validate.js` carries the look-ahead it exists to catch** | 🔴 **CRITICAL** | `bt-validate.js:152, 172, 173` | **TOTAL.** Running it would manufacture statistical confidence in a leaky result. **The most dangerous single line in the repository** |
| **R-02** | **Look-ahead in all 8 strategy scripts** | 🔴 **CRITICAL** | §3, every file, every line cited | **TOTAL.** Both edge claims are artefacts |
| **R-03** | **`bt-real.js` has a SECOND look-ahead: the OI filter reads EOD OI** | 🔴 **CRITICAL** | `bt-real.js:9` `MINOI=50000` on bhavcopy `OpnIntrst` | Removing the strike leak does **not** clean this strategy |
| **R-04** | **`bt-real.js` models no brokerage / STT / exchange charges** | 🔴 **CRITICAL** | no `charges.js` import | P&L overstated by every rupee of cost never paid |
| **R-10** | **"Backtest-grounded" reliability shipping with no backtest** | 🔴 **HIGH** | `candlestick-patterns.js:344` | **UNKNOWN presented as MEASURED**, in a live scoring path |
| **R-05** | **`sizeLots` silently defaults to `LOT = 75`** — wrong on **59.3%** of days | 🔴 **HIGH** | `bt-lib.js:49`; 3 scripts use the 2-arg form | Every size, charge and P&L mis-scaled. **The fix exists and is unused** |
| **R-07** | **129 trades, no CI, no bootstrap, unbounded-loss structure** | 🔴 **HIGH** | §7 | Cannot separate edge from luck **even with clean data** |
| **R-06** | **9 free parameters, zero justification** | 🔴 **HIGH** | `bt-real.js:9-10` | Enough knobs to fit noise. **First-100 (+312, PF 1.31) → 1,200 (PF 0.94) proves it happened** |
| **R-09** | **58 outcomes across 5 incompatible ledgers; canonical file has 12** | 🔴 **HIGH** | §9 | **Blocks all calibration and all AI** |
| **R-08** | **`maxDD` means a fraction in one script and points in another** | 🟡 **MEDIUM** | 8 implementations | Reports are not comparable. **Survives the look-ahead fix** |
| **R-11** | **`data/vrp-monitor.json` is EMPTY** | 🟡 **MEDIUM** | 0 entries | The one instrument that would test the core hypothesis has never recorded an observation |
| **E1** | **STT / exchange rates disputed** | 🟡 **MEDIUM — BLOCKED** | `charges.js` | Two errors cancel to −0.33%, so the total *looks* right. **Needs the exchange circular. DO NOT GUESS** |
| **A-13** | **Broker chain `oi_unit` UNKNOWN** | 🟡 **UNKNOWN** | 001-B | If units, every live GEX is off by 65–75× |
| **F4-BSE** | **BSE `oi_unit` UNKNOWN** | 🟡 **UNKNOWN** | `docs/EVIDENCE-F4-oi-unit.md` (NSE only) | SENSEX/BANKEX analytics unverified |

---

## SECTION 13 — RESEARCH ROADMAP (sequencing only — no strategy redesign)

### Phase 1 — Integrity. **Nothing else may proceed until these are done.**

| # | Action | Why first |
|---|---|---|
| **1** | **Fix the look-ahead in `bt-validate.js` FIRST** | 🔴 **A contaminated validator is worse than no validator.** It converts a wrong answer into a *confidently* wrong answer |
| **2** | Fix the look-ahead in all 8 strategy scripts — **one at a time, each with its own review** | Each is a behaviour change (**PF 7.41 → ~0.55**). **Requires owner approval** |
| **3** | Fix `bt-real.js`'s **second** leak (the EOD-OI filter) and add `charges.js` | Two defects, not one |
| **4** | Pass `day.lot` to `sizeLots` in the 3 scripts using the 2-arg form | The fix already exists in `bt-lib`. **Free** |
| **5** | Remove or evidence `candlestick-patterns.js:344`'s "backtest-grounded" claim | An unmeasured claim is shipping in a live path |

### Phase 2 — Validation. **Only after Phase 1.**

| # | Action |
|---|---|
| 6 | Run every strategy through the **now-clean** `bt-validate.js` — walk-forward, purged k-fold, PSR, DSR |
| 7 | Bootstrap + Monte Carlo the strangle. **The tail is the whole question for a naked short** |
| 8 | Unify `maxDD` — one definition, one implementation |

### Phase 3 — Data collection. **Start today; every day of delay is permanently lost.**

| # | Action |
|---|---|
| 9 | **Unify the 5 ledgers into one labelled outcome schema** |
| 10 | **Start the VRP monitor recording** — it is empty, and it tests the core hypothesis |
| 11 | **Capture intraday option chains daily** — **1 complete session exists** (2026-07-08, 375 min) |
| 12 | Build a **feature store** — features are currently computed and thrown away ⇒ no ML is possible, ever |
| 13 | Grow labelled outcomes **12 → 200** |

### Phase 4 — Evidence gaps (blocked on external sources, not code)

`E1` — read the exchange circular · `F4-BSE` — port the OI test to the BSE format ·
`A-13` — compare one live chain row against the same-day bhavcopy row

### Phase 5 — Production readiness

**Blocked behind Phase 2. Not schedulable.**

---

## SECTION 14 — CORRECTIONS TO PRIOR CLAIMS (Rule Zero)

| Prior claim | Measured | Correction |
|---|---|---|
| *"`bt-validate.js` is called by **zero** scripts"* | **`forward-test-report.js` calls it** | **Zero *strategy* scripts call it; one *reporting* script does.** The distinction matters — the statistics are being applied to **forward-test** results, not backtests |
| *"~55 labelled outcomes"* | **58 — across 5 incompatible ledgers.** The canonical `signal-outcomes.json` holds **12** | **The aggregate was hiding the fragmentation.** 58 ≠ a dataset |
| *"Fix the strategies, then run them through `bt-validate.js`"* — the previously recommended action | 🔴 **`bt-validate.js` has the same look-ahead** | **The recommendation was WRONG and would have produced false confidence.** Fix the validator FIRST |
| *"`bt-real.js` fails at PF 0.84 even with look-ahead"* | It has **two** look-aheads and **no cost model** | **The statement understated the problem** |

---

## SECTION 15 — EXECUTIVE SUMMARY

**Reproducibility:** 🟢 **GOOD.** The data is the exchange's own file, 600 days, and every script is
deterministic and re-runnable. **Anyone can reproduce these results — including the wrong ones.**

**Research integrity:** 🔴 **FAILED.** A single unlabelled datum — `bt-lib.js:22`, a closing price
published under the name `underlying` — leaked into **every strategy and into the validator itself.**

**Statistical validity:** 🔴 **NONE.** Not one strategy has walk-forward, k-fold, bootstrap, PSR or DSR
applied — although all six are implemented, tested, and sitting unused in `bt-validate.js`.

**Operational readiness:** 🔴 **NOT READY.** 12 canonical labelled outcomes against a requirement of
~200. **6%.**

**AI readiness:** 🔴 **BLOCKED — INSUFFICIENT EVIDENCE.**

### The one thing to understand

> The platform did not fail because it lacked statistical machinery. **It had the machinery — purged
> k-fold, deflated Sharpe, PSR, DSR, all written, all tested — and it pointed that machinery at data
> that had already seen the future.**
>
> **And the machinery itself had seen the future.**
>
> The correct order is not "validate the strategies." It is: **clean the validator, clean the
> strategies, and only then ask what the numbers say.** Any other order manufactures confidence.

### What is genuinely good, and must be protected

- **600 days of the exchange's own authoritative data** — ~1.08 million strike-days
- **`bt-validate.js`'s statistics are correct** — the mathematics is sound; only its strategy function leaks
- **`charges.js`** — one implementation, 12 dependents *(rates disputed, but the structure is right)*
- **`gamma-blast-engine.js`** — **the only strategy whose evidence claim matches its evidence.** It says
  "not backtestable, forward-test only," and it means it
- **The discipline that produced this audit** — the process invalidated its own flagship result, twice,
  and then invalidated its own recommended fix

---

**Files modified: NONE. Strategies changed: NONE. Parameters tuned: NONE. Suite: 47/47.**

**Deliverables:** Research Asset Catalogue (§1) · Data Provenance Report (§2) · Temporal Integrity
Report (§3) · Strategy Assumption Register (§5) · Validation Coverage Matrix (§6) · Statistical Quality
Report (§7) · Metric Verification Report (§8) · Paper Trading Assessment (§9) · AI Readiness Assessment
(§10) · Research Maturity Matrix (§11) · Research Risk Register (§12) · Executive Summary (§15).
