# 008 — BACKTESTING ENGINE, HISTORICAL SIMULATION & TEMPORAL INTEGRITY

**Standard:** Master Prompt 008 · **Depends on:** 000-A…E, 001-A…F, 002…007
**Date:** 2026-07-12 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No backtest modified. No strategy improved. No parameter tuned.**

---

# SECTION 0 — THE HEADLINE

> ## 🔴 **THE COST MODEL CHARGES STT ON THE WRONG SIDE OF EVERY SHORT POSITION.**

`charges.js` is documented for **a long-option position**:

```js
charges.js:27   /** Round-trip transaction cost for a long-option position.
                 *  @param entryPrice  premium PAID per unit (buy)
                 *  @param exitPrice   premium RECEIVED per unit (sell)  */
charges.js:35   function roundTripCharges(entryPrice, exitPrice, quantity) {
charges.js:36     const buyTurnover  = entryPrice * quantity;      // ← entry is assumed to be the BUY
charges.js:37     const sellTurnover = exitPrice  * quantity;      // ← exit  is assumed to be the SELL
charges.js:40     const stt   = sellTurnover * STT_SELL_PCT;       // STT: sell side only  ✔ correct FOR A LONG
charges.js:43     const stamp = buyTurnover  * STAMP_BUY_PCT;      // stamp: buy side only ✔ correct FOR A LONG
```

**For a SHORT strangle the entry IS the sell and the exit IS the buy-back — the reverse.**
And every short backtest passes them in long order:

```js
bt-strangle-costs.js:54   roundTripCharges(ce.o,  r1.exit, qty)
                          //              ↑ the SELL   ↑ the BUY-BACK   — passed as (buy, sell)
```

## Measured impact — a real leg, real numbers

```
SHORT leg: sold @ ₹100, bought back @ ₹50, qty 1,625 (25 lots × NIFTY 65)

  AS CODED   stt ₹81.25    stamp ₹4.88    →  total ₹234.37
  CORRECT    stt ₹162.50   stamp ₹2.44    →  total ₹313.18
                                             ────────────────
  UNDERSTATED   ₹78.81 per leg  ·  ₹157.62 per trade  ·  ≈ ₹20,333 over 129 trades
```

**STT is charged at exactly HALF**, because 0.1% is applied to the ₹50 buy-back instead of the ₹100 sell.

| | |
|---|---|
| **Direction of the error** | **Always understates costs on a WINNING short** (exit < entry). The strategy wins most of the time in every backtest ⇒ **the bias is systematically optimistic** |
| **Independent of E1?** | 🔴 **YES.** Even if the disputed *rates* are correct, the *sides* are wrong. **This is a second, separate cost defect** |
| **Affects live?** | 🔴 **YES.** `strangle-engine.js` and `agents-engine.js` import `charges.js`. **The live paper P&L for the iron condor carries the same swap** |
| **Confidence** | **HIGH — computed, not estimated** |

**Against the honest strangle backtest's net of −₹79,899, this adds a further −₹20,333.**
**The true result is worse than the already-failing one.**

---

# PART 1 — BACKTEST CATALOGUE

| Script | Purpose | Data | Period | Status | Owner | Conf |
|---|---|---|---|---|---|---|
| **`bt-validate.js`** | **The statistical harness** — purged k-fold · walk-forward · PSR · DSR | bhavcopy | 600 d | 🟢 **look-ahead FIXED (002)** · 🔴 **cost swap live** | — | HIGH |
| **`bt-strangle-costs.js`** | The flagship. Slippage sweep | bhavcopy | 600 d | 🔴 **look-ahead + cost swap + wrong structure** | — | HIGH |
| `bt-strangle-regime.js` | IV-regime filters | bhavcopy | 600 d | 🔴 same | — | HIGH |
| `bt-strangle-trend.js` | Trend filter | bhavcopy | 600 d | 🔴 same | — | HIGH |
| **`bt-strangle-tailsafe.js`** | **Wings / condor** — 33 condor refs | bhavcopy | 600 d | 🔴 look-ahead · 🟢 **the ONLY script modelling the LIVE structure** | — | HIGH |
| `bt-strategies.js` | Multi-strategy | bhavcopy | 600 d | 🔴 **own loader, own copy of the bug**; no slippage | — | HIGH |
| `bt-world-strategies.js` | Condors, calendars | bhavcopy | 600 d | 🔴 look-ahead; no slippage | — | HIGH |
| `bt-real.js` | Directional buying | bhavcopy | 197 d | 🔴 **TWO look-aheads · ZERO charges** | — | HIGH |
| `bt-nifty-intraday.js` | 1-min intraday | Upstox | — | 🔴 `LOT = 75` · **no costs at all** | — | HIGH |
| `bt-gex-vs-vix.js` | GEX/VIX study | derived | — | 🟡 exploratory | — | LOW |
| `bt-lib.js` | Shared loader | — | — | 🟢 **fixed 2026-07-10** | — | HIGH |
| `bt-bhav-fetch.js` / `bt-fetch-1min.js` | Fetchers | — | — | 🟢 | — | HIGH |

**Owner: NOBODY. Not one script declares an owner, a version, or a strategy id.**

---

# PART 2 — TEMPORAL INTEGRITY

*(Fully established in 001-D §3. Summary + the one change since.)*

| Script | Look-ahead | Status |
|---|---|---|
| **`bt-validate.js`** | strike from today's close · `LOT=75` · IV gate on today's proxy | 🟢 **FIXED (002)**. Result: win 91.5% → **51.2%**; DSR 0.9999 `PASS` → **0.0008 `FAIL`** |
| `bt-strangle-costs/regime/trend/tailsafe` | `atmStrike(day)` → today's close, traded at today's open | 🔴 **LIVE** |
| `bt-strategies.js` | **its own re-implementation of the same bug** (`:32`) | 🔴 **LIVE** — fixing `bt-lib` does not fix this file |
| `bt-world-strategies.js` | same | 🔴 **LIVE** |
| **`bt-real.js`** | **TWO**: `atmStrike` **and** an OI filter reading **end-of-day OI** (`MINOI=50000`) | 🔴 **LIVE** |

| Leakage class | Present? |
|---|---|
| Future candle access | 🔴 **YES — the day's close drives an entry at the open** |
| Future option chain | 🟢 NO — `nearExp` correctly filters `exps >= date` |
| Future IV | 🟡 **YES in `bt-validate` (fixed)** — the IV proxy is built from today's close |
| **Future OI** | 🔴 **YES — `bt-real.js`.** Bhavcopy `OpnIntrst` is END-OF-DAY OI, filtered at entry |
| Future Greeks | 🟢 N/A — not in the bhavcopy |
| **Settlement leakage** | ⚪ **UNKNOWN.** `SttlmPric` is present on 1,804/1,808 rows and **no script reads it.** No leakage found; not exhaustively proven |

---

# PART 3 — HISTORICAL REPLAY ASSESSMENT

| Property | Verdict |
|---|---|
| **Determinism of trade generation** | 🟢 **YES.** No `Math.random`. No `Date.now()` inside any strategy loop. **The same inputs produce the same trades** |
| **Determinism of the output FILE** | 🔴 **NO.** `bt-validate.js:248` and `bt-world-strategies.js:206` stamp `generatedAt: new Date()`. **Two identical runs produce different files ⇒ determinism cannot be proven by diffing** |
| **Event ordering** | 🟢 Day-level, sorted by filename (= date). Deterministic |
| Session boundaries / market open / close | ⚪ **N/A — the data is EOD only.** No intraday sessions exist to order |
| **Holidays** | 🔴 **ZERO handling.** No holiday calendar anywhere |
| **Missing sessions** | 🔴 **ZERO handling.** `loadDays()` reads whatever CSVs exist |
| **Expiry / contract rollover** | 🟡 `nearExp` picks the nearest expiry ≥ today. **No explicit rollover logic** |

## 🔴 P3-A — **A new hazard introduced by my own 002 fix. Recorded honestly.**

The 002 fix makes the strategy read **yesterday's close**:

```js
bt-validate.js   for (let i = 1; i < days.length; i++) {
                   const day = days[i], prev = days[i - 1];   // ← "yesterday"
```

**`days[i-1]` is the previous FILE, not the previous CALENDAR DAY.**

If a session's bhavcopy is missing — a holiday, a failed download, an exchange outage — then `prev` is
**2 or more days old**, and **nothing detects it.** The strategy silently uses a stale reference price.

| | |
|---|---|
| **Is this a regression?** | **No** — it is strictly better than reading the *future*. But it is a **real, undocumented assumption** |
| **Severity** | **MEDIUM** |
| **Fix (not applied)** | Assert `prev.date` is the immediately preceding **trading** day, or **skip the day** |
| **Why it is recorded here** | 008's own stop condition: *"Never substitute assumptions for evidence."* **My fix substituted an assumption. It is now written down** |

---

# PART 4 — EXECUTION MODEL REVIEW

| Assumption | Classification | Evidence |
|---|---|---|
| **Entry at the bhavcopy `Opn`** | 🔴 **ASSUMED** | `Opn` is the day's **first traded price** — for an illiquid OTM strike it may be a print no participant could obtain |
| **Exit at `Cls`, or at `STOP_MULT × entry` if `Hgh` touches it** | 🔴 **ASSUMED** | Assumes a stop **always fills at exactly the trigger.** On a gapping option this is false |
| **Fill price = the quoted price** | 🔴 **ASSUMED** | **No bid-ask spread is modelled anywhere** |
| **Partial fills** | 🔴 **ASSUMED NONE** | Every order fills completely |
| **Slippage** | 🟡 **PARTIAL** | `bt-strangle-costs` sweeps 0–2% 🟢 · `bt-real` uses 2% · **`bt-strategies`, `bt-world-strategies`, `bt-nifty-intraday`: ZERO** |
| **Liquidity** | 🔴 **ASSUMED INFINITE** | 25 lots assumed fillable at the open on any strike |
| **Order priority / queue** | ⚪ **UNKNOWN — UNOBSERVABLE.** No tick data, no order book, ever |
| **Rejections** | 🔴 **ASSUMED NONE** |
| **Margin available** | ⚪ **UNKNOWN.** SPAN is published daily by the exchange and is **not captured** |

**Verified: 0. Assumed: 7. Unknown: 2.**

---

# PART 5 — COST MODEL REVIEW

| Charge | Rate in code | Applied to | Verdict |
|---|---|---|---|
| **Brokerage** | ₹20/order × 2 | flat | 🟢 **Plausible** (discount broker) |
| **STT** | **0.1%** | 🔴 **the WRONG side for shorts (§0)** | 🔴 **DEFECT + rate DISPUTED (E1)** |
| **Exchange txn** | **0.03503%** ("~") | both sides | 🟡 **DISPUTED (E1)** |
| **SEBI** | 0.0001% | both sides | 🟢 ₹10/crore — plausible |
| **Stamp duty** | **0.003%** | 🔴 **the WRONG side for shorts (§0)** | 🔴 **DEFECT** |
| **GST** | 18% on (brokerage + exch + SEBI) | — | 🟢 Standard |

## Two independent cost defects

| | |
|---|---|
| **C-1 — the SIDE is wrong for shorts** | 🔴 **CONFIRMED, QUANTIFIED (§0).** ≈ **₹20,333 understated** across the flagship's 129 trades. **Independent of the rates** |
| **C-2 — E1: the RATES are disputed** | ⚪ **UNKNOWN — BLOCKED.** `0.1` vs `0.0625` (STT); `0.03503` vs `0.053` (exch). **Both are believed wrong in opposite directions and cancel to ≈ −0.33%, so the total LOOKS right.** **Needs the exchange circular. DO NOT GUESS** |

**Scripts with NO cost model at all:** `bt-real.js` (the directional buyer — **not one rupee of
brokerage or STT**), `bt-nifty-intraday.js`.

---

# PART 6 — POSITION SIZING ASSESSMENT

| Aspect | Verdict |
|---|---|
| **Historical lot size** | 🔴 **WRONG in most scripts.** The bhavcopy carries `NewBrdLotQty` per row; measured distribution over 600 NIFTY days: **`{25:161, 50:72, 65:123, 75:244}`** ⇒ **the hardcoded 75 is wrong on 356/600 days (59.3%)** |
| **Scripts using the REAL lot** | 🟢 **`bt-validate.js` only** (since 002) |
| **Scripts using `sizeLots(cap, prem)` — the 2-arg form ⇒ silently `LOT = 75`** | 🔴 `bt-strangle-regime`, `-trend`, `-tailsafe` |
| **Scripts hardcoding `LOT = 75`** | 🔴 `bt-strategies.js:23`, `bt-nifty-intraday.js:226` |
| **Capital allocation** | 🟡 `CAPITAL = 100000`, `RISK_PCT = 0.05`, cap 25 lots |
| **Margin** | 🔴 **NOT MODELLED.** A short strangle requires SPAN margin. **The backtest sizes on premium, not on margin — so it may be sizing positions that could never have been funded** |
| **Leverage** | 🔴 Implicit and unmeasured |
| **Fractional** | 🟢 `Math.floor` + `Math.max(1, …)` |

> 🔴 **The margin gap is the most under-appreciated sizing defect.** A 25-lot short strangle on NIFTY
> demands substantial SPAN margin. **The backtest never checks whether ₹100,000 could have supported
> the position it just opened.** ⚪ **UNKNOWN — SPAN data is not captured anywhere.**

---

# PART 7 — DATA QUALITY

| Dimension | Verdict |
|---|---|
| **Source** | 🟢 **NSE UDiFF bhavcopy — the exchange's own file. Highest possible provenance** |
| Coverage | 🟢 600 days, 2024-01-08 → 2026-06-17 |
| Completeness | 🟢 `SttlmPric` on 1,804/1,808 rows; `OpnIntrst` on 1,203 |
| **Missing sessions** | 🔴 **NOT DETECTED** (P3-A) |
| **Holidays** | 🔴 **NOT HANDLED** |
| **Duplicates** | ⚪ **UNKNOWN — never checked** |
| **Corrupt files** | 🟢 `loadDay()` returns `null` on an empty file |
| **Timestamp consistency** | 🟡 Date-only. **The timezone is assumed, never declared** |
| **Contract rollover** | 🟡 `nearExp ≥ date`. No explicit logic |
| **Symbol mapping** | 🟢 One symbol per file |
| **`oi_unit`** | 🟢 **MEASURED — UNITS** (NSE, 5 symbols). ⚪ **BSE: UNKNOWN** |

---

# PART 8 — METRIC VERIFICATION

| Metric | Implementations | Consistent? |
|---|---|---|
| Net profit | per script | 🟢 |
| **Profit factor** | **4** | 🟢 `grossWin/grossLoss`; div-by-zero handled |
| **Max drawdown** | **8** | 🔴 **INCONSISTENT.** `bt-strangle-*` compute `(peak−cap)/peak` (**a fraction**); `bt-nifty-intraday:203` computes `peak−cum` (**absolute points**). **Both are named `maxDD`** |
| Sharpe | 3 | 🟡 `backtest-report:90` annualises by `√tradesPerYear` — **an input, not a measurement.** ⚪ **UNVERIFIED** |
| Sortino | 1 | 🟢 |
| Expectancy | 3 | 🟢 `p·avgWin − (1−p)·avgLoss` |
| Win rate / avg win / avg loss | per script | 🟢 |
| **Recovery factor** | **0** | 🔴 **NOT COMPUTED ANYWHERE** |
| **Exposure** | **0** | 🔴 **NOT COMPUTED ANYWHERE** |
| CAGR | 2 | 🟡 not cross-checked |

---

# PART 9 — REPRODUCIBILITY ASSESSMENT

| Requirement | Present? |
|---|---|
| Same dataset | 🟢 **YES** — 600 CSVs on disk, re-downloadable from NSE |
| Same configuration | 🔴 **NO** — parameters are literals inside each script; **`params` is recorded in 1 of 13** |
| **Same code revision** | 🔴 **NO** — **`gitSha` / `commit` / `codeVersion`: recorded by ZERO scripts** |
| Same assumptions | 🔴 **NO** — undocumented until this audit |

## 🔴 P9-A — **No published result can be tied to the code that produced it**

`bt-data/result-strangle-costs.json` contains the **PF 7.41** that justifies a ₹7L allocation.

**It does not record which version of `bt-lib.js` produced it.**

> Was it run **before** the 2026-07-10 lot fix, or **after**? **UNKNOWABLE from the artefact.**
> Was it run with `LOT = 75` or the real per-day lot? **UNKNOWABLE.**
>
> **008 states the rule: *"Results without provenance are not reproducible."***
> **By that rule, not one result in `bt-data/` is reproducible.**

---

# PART 10 — OBSERVABILITY

**Measured across all 13 backtest scripts:**

| Required field | Scripts recording it |
|---|---|
| Dataset version | **0** |
| **Code version / git SHA** | **0** |
| Configuration | **2** |
| Parameters | **1** |
| Timestamp (`generatedAt`) | **3** |
| Strategy version | **0** |
| Random seed | **0** *(n/a — nothing is random)* |

**Result-file schemas are mutually incompatible:** some are bare arrays (`result-real.json`,
`result-daily.json`), some carry `{days, range, sweep}`, some `{data, params, summary, trades}`.
**There is no result contract.**

---

# PART 11 — BACKTESTING ARCHITECTURE (conceptual — no code)

```
   ReplayEngine  ★
     · emits days in strict order; ASSERTS the calendar (holidays, missing sessions)  → kills P3-A
     · a strategy sees ONLY a ReadOnlyContext of days ≤ t-1 and today's OPEN.
       🔴 It is STRUCTURALLY IMPOSSIBLE to read today's close.  → kills the entire 001-D class

   FillModel  ★     entry/exit price · spread · slippage · partial fills · rejection
   CostModel  ★     🔴 DIRECTION-AWARE. STT on the SELL leg. Stamp on the BUY leg.
                       side: 'LONG' | 'SHORT' is a REQUIRED argument.        → kills §0
   MarginModel      ⚪ BLOCKED — SPAN is not captured. Declare the gap; do not fabricate.
   SizingPort       lot comes from the DATA (NewBrdLotQty), never a literal. null ⇒ skip the day.

   RunManifest  ★   EVERY result carries: gitSha · datasetHash · params · strategyId ·
                    structure · assumptions[] · generatedAt.
                    🔴 A result WITHOUT a manifest is not a result.          → kills P9-A

   Validator        bt-validate — mathematics already correct; look-ahead already fixed.
```

## The one rule that would have prevented every finding in 001-D and 008 §0

> **The strategy must be given a context that makes the defect impossible, not a rule that asks it not
> to.** A `ReadOnlyContext` cannot expose today's close. A direction-aware `CostModel` cannot charge STT
> on a buy.

---

# PART 12 — TESTING STRATEGY

**Integrity tests before performance tests. Always.**

| Test | Priority |
|---|---|
| 🔴 **`charges(side='SHORT')`: STT lands on the SELL leg, stamp on the BUY leg** | **P0 — §0** |
| 🔴 **A look-ahead tripwire per script** (modelled on `test/bt-validate-lookahead.test.js`) | **P0 — 7 scripts remain** |
| 🔴 **`prev` is the immediately preceding TRADING day, or the day is skipped** | **P0 — P3-A, my own fix's assumption** |
| 🔴 **The lot comes from `NewBrdLotQty`; `null` ⇒ the day is skipped** | **P0** — wrong on 59.3% of days |
| 🔴 **Every result file carries a `RunManifest` (gitSha + datasetHash + params)** | **P0 — P9-A** |
| **The live structure matches the backtested structure** | **P0 — 007 §0** |
| Replay determinism: two runs produce byte-identical trades | P1 |
| Holiday / missing-session detection | P1 |
| `maxDD` means one thing | P1 |
| Cost calculation against a broker contract note | P1 — **would also settle E1** |

---

# PART 13 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE — this document** | — | none | 13 scripts catalogued with status and confidence |
| **2 — Temporal integrity** | Fix the look-ahead in the **7 remaining scripts**, one at a time. Fix `bt-real`'s **second** leak (EOD OI) | `bt-validate` ✅ clean (002) | 🔴 **Results WILL get worse. That is correct.** Approval per script | **0/13 scripts read the future** |
| **3 — Execution realism** | 🔴 **Direction-aware `CostModel` (§0).** Add costs to `bt-real` and `bt-nifty-intraday`. Slippage everywhere. **Declare the margin gap** | Phase 2 | 🔴 **Every published number changes.** Approval | Costs are correct **for the side actually traded** |
| **4 — Reproducibility** | `RunManifest` on every result | Phase 3 | Low — additive | **Every result names the code that made it** |
| **5 — Validation readiness** | Re-run **all** scripts through the clean `bt-validate` — **including the IRON CONDOR the platform actually trades** (007 §0) | Phases 2–4 | 🔴 **The answer may be "no edge." That is a SUCCESS** | Every enabled strategy has a valid backtest **of the structure it trades** |

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| No confirmed look-ahead bias | 🔴 **NO — 7 of 8 strategy scripts** *(the validator itself: ✅ fixed)* |
| Replay is deterministic | 🟡 **Trades: YES. Output files: NO** (`generatedAt`) |
| Historical assumptions documented | 🟢 **YES — as of this document** (Part 4: 0 verified, 7 assumed, 2 unknown) |
| **Costs are evidence-based** | 🔴 **NO — the SIDE is wrong (§0) and the RATES are disputed (E1)** |
| **Lot sizes are historically correct** | 🔴 **NO — 1 of 13 scripts.** Wrong on 59.3% of days elsewhere |
| Results are reproducible | 🔴 **NO — zero provenance** |
| Every simulation has complete provenance | 🔴 **NO — 0 of 13 record a code version** |

## **Backtesting Engine maturity: 1 of 7. NOT MATURE.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent researcher rerun any simulation, reproduce the outcome, identify
every assumption, and verify that no future information influenced it?**

**No — on all four counts. And this audit found a new, quantified defect that survives even the
look-ahead fix:**

> **`charges.js` assumes every position is a LONG.** For the short strangles and iron condors this
> platform actually trades, **STT is charged on the buy-back instead of the sell — exactly half the
> correct amount on a winning trade — and stamp duty is charged on the sell instead of the buy.**
>
> **Measured: ₹78.81 understated per leg, ₹157.62 per trade, ≈ ₹20,333 across the flagship's 129
> trades.** It biases **every short backtest optimistic**, and it is **live in the paper engine today.**
>
> **This is independent of the disputed rates (E1). Fixing E1 would not fix it.**

**Three things are genuinely sound and must be preserved:**

1. **The data.** 600 days of the exchange's own UDiFF bhavcopy — ~1.08M strike-days, re-downloadable.
2. **Trade generation is deterministic.** No `Math.random`, no clock inside any strategy loop. **Same inputs, same trades.**
3. **`bt-validate.js`'s mathematics** — purged k-fold, walk-forward, PSR, DSR — is correct. **Only its strategy leaked, and that is now fixed.**

**And this audit corrected its own author again:** the 002 look-ahead fix introduced an undocumented
assumption — **`days[i-1]` is the previous *file*, not the previous *trading day*** — which a missing
session would silently violate. **It is written down (P3-A) rather than left to be discovered.**

---

**Backtests modified: NONE. Strategies improved: NONE. Parameters tuned: NONE. Suite: 48/48.**

**Deliverables:** Backtest Catalogue (Part 1) · Temporal Integrity (Part 2) · Replay Assessment
(Part 3) · Execution Model (Part 4) · Cost Model (Part 5) · Position Sizing (Part 6) · Data Quality
(Part 7) · Metric Verification (Part 8) · Reproducibility (Part 9) · Observability (Part 10) ·
Architecture Blueprint (Part 11) · Testing Strategy (Part 12) · Migration Roadmap (Part 13) ·
Executive Summary.
