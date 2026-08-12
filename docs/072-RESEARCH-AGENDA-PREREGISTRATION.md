# 072 — Research Agenda: Pre-Registration, Feasibility and Out-of-Sample Budget

**Document type:** First deliverable of the research programme. Pre-registration only.
**Status:** No hypothesis has been tested. No returns have been computed.
**Date of feasibility measurement:** 2026-07-30 / 2026-07-31
**Scope:** NSE index options (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50), BSE SENSEX.
**Author role:** head of quantitative research, ANTIGRAVITY PRO.

---

## 0. What this document is, and what it deliberately is not

This is the pre-registration required before any of the twelve research programmes may
be run. It contains, for each programme: the hypothesis, the economic rationale, the
data actually required, a **verified** statement of whether that data exists, the test
design, the numeric success criterion, the numeric falsification criterion, and the
prior recorded **before** any result is seen.

It is not a strategy document. It contains no BUY or SELL recommendation, no trade, and
no claim that any edge exists. The expected outcome of running this agenda honestly is
that most of these twelve hypotheses die. That is the intended result.

Three things in this document will be unwelcome, and all three are load-bearing:

1. **Five of the twelve programmes cannot be run at all today** for want of data, and
   one of those five is the programme with the highest research value.
2. **The in-sample data has already been used at least 30 times** before any
   pre-registration existed. Anything tested on it does not start at trial number one.
3. **There are roughly 30 trading days of genuinely untouched data sitting at NSE right
   now**, and their value as a holdout will be destroyed the first time anyone runs a
   backtest that silently includes them.

---

## 1. Integrity declaration — what was touched, and what was not

Research-integrity principle P1 says pre-registration comes before touching data. The
feasibility assessment in §2 required opening files. To keep P1 intact, the following
is declared explicitly:

**What was read during the feasibility pass**

- Directory listings, file counts, file sizes, modification times.
- Column headers and one to three sample rows per file format, to establish schema.
- The `at` / `datetime` field of every record in the raw chain capture, to compute
  cadence and session coverage.
- The count of previously evaluated strategy variants, and their names, from result
  files that already existed on disk.

**What was NOT read**

- No return series was computed.
- No profit or loss figure was computed from raw data.
- No conditional statistic, no correlation, no distribution of any outcome variable.

The one exception, disclosed rather than hidden: the pre-existing result files in
`bt-data/` contain headline P&L numbers for 30 strategy variants, and those numbers
were visible while counting the variants. They are reproduced in §4 **as evidence of
prior trial count**, not as evidence about any hypothesis. None of the twelve programmes
below tests any of those 30 variants. Where a programme is adjacent to one of them, the
adjacency is declared in that programme's block.

**Evidence grades used throughout** (never merged):
`Verified` = directly measured on disk on the stated date ·
`Measured` = computed from data by a named script ·
`Estimated` = derived from a stated model or assumption ·
`Opinion` = judgement, no measurement ·
`Unknown` = not established, and labelled as such rather than defaulted to zero.

---

## 2. Data inventory — verified 2026-07-30/31

### 2.1 What exists

| # | Asset | Path | Coverage | Resolution | Content | Grade |
|---|-------|------|----------|------------|---------|-------|
| D1 | NIFTY F&O bhavcopy | `bt-data/bhav/nifty-YYYYMMDD.csv` | 2024-01-08 → 2026-06-17, **600 files** | Daily EOD, per contract | Open/High/Low/Close, settle, prev close, **underlying close**, OI, change in OI, contracts, turnover, trades, **market lot**, expiry date, strike, CE/PE. ~1,500–1,800 rows/day, **18 distinct expiries per day** | Verified |
| D2 | Underlying 1-minute bars | `bt-data/nifty-1min.json`, `banknifty-1min.json`, `sensex-1min.json` | 2025-09-01 → 2026-06-19, **73,935 bars each** (~190 sessions) | 1 minute | OHLC. Volume field present but **always 0** (index, not tradable) | Verified |
| D3 | NIFTY daily underlying | `bt-data/nifty-daily.json` | 2023-03-08 → 2026-06-18, **812 days** | Daily | OHLC | Verified |
| D4 | Live raw option chain | `data/warehouse/L0_raw/chain/{NIFTY,BANKNIFTY,SENSEX}/*.jsonl` | 2026-07-27 → 2026-07-30, **4 usable sessions** (+ a 5-record stub on 07-26) | **~5 minutes**, and only from **11:16–12:06 IST onward** | Per strike: LTP, **IV** (with `ivSource` = feed/bsm), OI, change in OI, volume, OHLC, prev close, **bid/ask, bidQty/askQty (1 level only)**, delta/gamma/theta/vega. Per snapshot: spot, ATM, PCR-OI, max pain | Verified |
| D5 | Option premium candles | `data/opt-candles/*.json` | 2026-07-06 → 2026-07-30, 14 files | Intraday | Premium OHLC only. No IV, no OI, no depth | Verified |
| D6 | Option high/low scalars | `data/opthl/*.json` | 2026-06-24 → 2026-07-30, 22 files | Session scalar | High/low per contract | Verified |
| D7 | VIX / RV / GEX daily | `data/gex-vix-history.json` | 2026-07-07 → 2026-07-30, **51 rows** (2 instruments) | Daily | India VIX close, realised vol, gamma exposure | Verified |
| D8 | Cost model | `charges.js` | — | — | Brokerage, STT, exchange charges, GST, stamp duty | Verified (exists) |
| D9 | Measured slippage | `data/slippage-ledger.json` | From 2026-07-30 | Per fill | Realised slippage vs decision price | Verified (exists, thin) |
| D10 | Validation machinery | `validation-harness.js`, `walk-forward.js`, `validation-stats.js`, `validation-ledger.js` | — | — | Deflated Sharpe, PBO, purged+embargoed CV, trial ledger | Verified (exists) |

### 2.2 What does not exist

| # | Missing asset | Blocks | Recoverable? | Grade |
|---|---------------|--------|--------------|-------|
| M1 | **SENSEX and BANKNIFTY option history** — the bhavcopy archive is NIFTY only (`instType = IDO`, `symbol = NIFTY`, 600/600 files) | Programme 9 entirely; Programme 12 cross-instrument; Programme 2 per-underlying | Yes — BSE and NSE publish daily bhavcopy; a fetcher must be written | Verified |
| M2 | **India VIX history** — 51 rows from 2026-07-07 only | Programme 6 entirely; the VIX-conditioning slice of Programmes 2, 3, 7 | Yes — NSE publishes the full India VIX series | Verified |
| M3 | **Intraday option data before 2026-07-27** | Programmes 1, 7 (option leg), 10 | **No.** Not purchasable at this granularity for past dates without a vendor contract | Verified |
| M4 | **The first two hours of every captured session** — capture begins 11:16–12:06 IST on 4/4 days | Programme 1 (open-to-expiry decay), Programme 7 (opening seasonality) | Only forward, by fixing the capture start | Verified |
| M5 | **Order book beyond level 1** — D4 stores best bid/ask and quantity only | Programme 10 depth-imbalance work | Only forward, and only if the feed supplies it | Verified |
| M6 | **Participant-wise open interest** (FII/DII/Pro/Client) with correct knowledge time | The central sub-hypothesis of Programme 5 | Yes — NSE publishes daily; must be stored with next-morning knowledge time | Verified |
| M7 | **Event calendar** — RBI policy, budget, CPI/IIP, elections | Programme 8 entirely | Yes — cheap to construct, ~200 dated rows | Verified |
| M8 | **Point-in-time feature store / frozen dataset bundles** | Programme 11 entirely | Yes, but it is downstream of the data-lake build (doc 071) | Verified |
| M9 | **Effective-dated contract terms** — lot size history, expiry-weekday regime history | Programme 12 needs these as the intervention dates | **Partly already present**: market lot is a column in D1, so lot-size history is *derivable from the bhavcopy itself* — 2024-01-08 shows one lot regime, 2026-06-17 shows lot 65 | Verified |

### 2.3 The single most important measurement

Raw option-chain capture is live and its schema is rich — IV, OI, greeks, quotes. That
is a real improvement over the previous state, where chain fields were discarded.

But measured over every captured session:

```
NIFTY   2026-07-26  n=  5   IST 15:59 -> 16:02   (stub)
NIFTY   2026-07-27  n=196   IST 11:16 -> 15:31   median gap 1.3 min
NIFTY   2026-07-28  n= 31   IST 12:06 -> 15:36   median gap 7.0 min
NIFTY   2026-07-29  n= 45   IST 11:44 -> 15:35   median gap 5.2 min
NIFTY   2026-07-30  n= 50   IST 11:29 -> 15:34   median gap 5.0 min
SENSEX  2026-07-27  n=198   IST 11:16 -> 17:06   median gap 1.8 min
SENSEX  2026-07-28  n= 33   IST 12:06 -> 17:16   median gap 9.7 min
SENSEX  2026-07-29  n= 46   IST 11:44 -> 15:50   median gap 5.5 min
SENSEX  2026-07-30  n= 50   IST 11:29 -> 15:34   median gap 5.0 min
```

Three facts follow, all Verified:

1. **The open is missed on 4 of 4 sessions.** Not once has capture started before
   11:16 IST. The market opens at 09:15. The first 2 to 2 hours 51 minutes of every
   session — which includes the entire opening-auction aftermath that Programme 7
   exists to study — is absent.
2. **Cadence is ~5 minutes, not 1 minute, and it is not stable.** It was 1.3 minutes on
   27 July and 7.0 minutes on 28 July. A varying cadence is not merely coarse; it makes
   any time-weighted statistic biased toward the densely sampled days unless explicitly
   reweighted.
3. **Depth is one level.** Programme 10's stated data requirement is five levels.

Every intraday programme in Part A is written against data at one-minute resolution
across years. What exists is four afternoons at five minutes. This is not a criticism
of the capture — it started four days ago and works. It is a statement about which
questions can honestly be asked this month.

---

## 3. Feasibility verdict per programme

| Programme | Verdict | Binding constraint |
|-----------|---------|--------------------|
| **12 — Structural change** | **RUNNABLE NOW** | None. D1 spans 2024-01-08 → 2026-06-17, covering every intervention, and carries lot size and expiry date per row |
| **2 — Variance risk premium** | **RUNNABLE, RECONSTRUCTED** | D1 has no IV column; ATM IV must be inverted from settlement price via BSM. Daily only. NIFTY only |
| **3 — Term structure** | **RUNNABLE, RECONSTRUCTED** | 18 expiries per day in D1 makes front-vs-next well defined. Same IV inversion caveat |
| **4 — Skew dynamics** | **RUNNABLE, RECONSTRUCTED** | Daily smile from D1 strikes. Fitting convention must be frozen before first run |
| **5 — Open interest** | **PARTIAL** | EOD strike-wise OI and change in OI available in D1. **Intraday OI transitions absent. Participant-wise file absent (M6) — the knowledge-time sub-hypothesis, the most valuable part, cannot be tested at all** |
| **7 — Intraday seasonality** | **PARTIAL** | Underlying 1-minute available (D2, ~190 sessions, 3 indices). **Option spread, option volume and option decay by minute are absent.** Only the underlying half is testable |
| **1 — Expiry-day dynamics** | **NOT FEASIBLE as specified** | Requires full chain at 1-minute across every expiry day. A degraded EOD variant (close-to-settlement, terminal-day OI) is possible from D1 and is pre-registered separately as **1-D** |
| **6 — VIX and vol-of-vol** | **BLOCKED** | 51 rows of VIX (M2). Unblocked by one fetcher |
| **8 — Event studies** | **BLOCKED** | No event calendar (M7). Unblocked by ~200 dated rows, then runnable on D1 daily IV |
| **9 — Cross-exchange experiment** | **BLOCKED** | No SENSEX option history (M1). **This is the highest-value, least-crowded programme in the agenda and it is blocked on one missing dataset** |
| **10 — Microstructure** | **NOT FEASIBLE** | 4 afternoons, 5-minute cadence, 1 depth level (M3, M4, M5). Not fixable retrospectively |
| **11 — Machine learning** | **NOT FEASIBLE** | No point-in-time feature store (M8), and sample size does not support it |

**Summary: 4 runnable now, 2 partial, 1 degraded variant, 3 blocked on cheap data
acquisition, 2 not feasible at any near-term cost.**

---

## 4. The prior-trial debt

Research-integrity principle P3: *every variant tested against the same data increments
the family trial count. An uncounted trial is a lie told slowly.*

The 600-day NIFTY bhavcopy sample (D1) has already been used. Counting only variants
whose results were **persisted to disk** — abandoned runs are not recorded anywhere and
therefore cannot be counted:

| Result file | Variants | Window |
|-------------|----------|--------|
| `result-strategies.json` | 5 (EXPIRY_STRADDLE, SHORT_STRADDLE, SHORT_STRANGLE, IRON_CONDOR, GAP_BUY) | 2024-01-08 → 2026-06-17, 600 days |
| `result-world-strategies.json` | 5 (BASE_STRANGLE, TT_MANAGE50, TT_CONDOR50, EM_STRANGLE, PUT_WRITE) | same 600 days |
| `result-strangle-regime.json` | 5 | same 600 days |
| `result-strangle-costs.json` | 8 (slippage sweep) | same 600 days |
| `result-strangle-trend.json` | 4 | same 600 days |
| `result-strangle-tailsafe.json` | ≥3 (wing points, stress, condor economics) | same 600 days |
| **Total persisted** | **≥ 30** | **identical sample** |

**Pre-registered decision:** the family trial counter for anything evaluated on D1 is
seeded at **30**, not at 1, and this seed is written into `validation-ledger.js` before
Programme 12 runs. Deflated Sharpe for every result in this agenda is computed against
`30 + (trials incurred by this agenda)`.

This is a floor and is declared as a floor. The true number is higher — every abandoned
parameter sweep that was never saved is an uncounted trial. The floor is defensible;
the true count is `Unknown` and stays labelled `Unknown`.

### 4.1 A pre-existing result that this agenda does not inherit

`result-strategies.json` reports EXPIRY_STRADDLE at 90% win rate, 470% CAGR, and a
worst single trade of −₹1,79,066 against a ₹1,00,000 starting balance.

Two observations, both recorded now so they cannot be rationalised later:

- A single trade larger than the entire account is not a drawdown, it is ruin. The
  reported maximum drawdown of 4.9% is therefore describing something other than the
  risk actually taken — most likely position sizing that grew with a compounding
  balance the account never had.
- A 470% CAGR from a 600-day sample, discovered among ≥30 variants, is exactly the
  result that principle *"the more convincing it looks, the more carefully it should be
  doubted"* was written for.

**No programme in this agenda tests EXPIRY_STRADDLE.** It is named here only to make
the trial count honest and to record, before any new work begins, that the most
impressive number currently on disk is the one least likely to survive contact with
Part D. If it is ever revived, it enters at pipeline stage 1 like everything else.

---

## 5. Pre-registrations

Each block is frozen on publication of this document. Changing a success or
falsification criterion after seeing a result is not permitted; if a criterion proves
badly specified, the programme is **abandoned and re-registered as a new programme with
a new trial count**, and the abandonment is recorded.

Notation: **Prior** = probability, recorded before testing, that the hypothesis survives
to pipeline stage 6 (robustness battery) net of costs. **Cost basis** = `charges.js` plus
measured slippage from `data/slippage-ledger.json`; where measured slippage is absent for
an instrument, a declared `Estimated` slippage is used and labelled as such.

---

### PROGRAMME 12 — Structural change as a research subject
**Runs first. Its result governs how every other programme samples.**

- **Hypothesis.** The 2024–2026 regulatory interventions (weekly expiry
  rationalisation, lot-size changes, fixed expiry weekdays) produced detectable
  structural breaks in volume, spread proxy, open-interest distribution and strategy
  P&L, such that pooling the full history as one sample is invalid.
- **Economic rationale.** These are exogenous, dated, non-market interventions. A
  change in lot size mechanically changes the notional per contract and therefore the
  participant mix; a change in expiry weekday relocates the entire terminal-decay
  regime to a different day. Both are structural by construction, not by inference.
  Who is on the other side: nobody — this is not an edge, it is a sampling
  prerequisite.
- **Data.** D1 (600 days, spans every intervention). Lot size is column-resident in
  D1, so the intervention dates are derivable from the data itself and need not be
  supplied from an external table — this removes the usual dependency on M9.
- **Test design.**
  1. Derive the effective-dated lot-size series and the expiry-weekday series directly
     from D1, and identify candidate intervention dates as changes in those series.
  2. Bai–Perron / CUSUM break tests on: daily contracts traded, daily OI at ATM ±5
     strikes, the high-low range of ATM settlement price as a spread proxy, and the
     dispersion of OI across strikes.
  3. Compare distributions across eras, not just means — Kolmogorov–Smirnov on the
     daily statistic distributions either side of each candidate date.
  4. Report each break with its date, its confidence interval, and the statistic that
     broke.
- **Success criterion (pre-declared).** At least one break is detected at p < 0.01
  after Bonferroni correction across the four statistics tested, and its 95% confidence
  interval contains a known intervention date.
- **Falsification criterion (pre-declared).** No break at p < 0.01 in any of the four
  statistics, at any candidate date. This would justify pooling and would be a genuinely
  surprising, publishable negative result.
- **Prior:** 0.85 that at least one break is detected, i.e. that pooling is unsafe.
- **Trial cost:** 4 statistics × candidate dates. Counted as 4 family trials.
- **Out-of-sample budget:** **zero.** This is a descriptive test of the in-sample
  period itself, not a predictive claim. It consumes no holdout.
- **Adjacency disclosure:** none of the 30 prior variants tested for breaks.

---

### PROGRAMME 2 — Variance risk premium

- **Hypothesis.** ATM implied volatility systematically exceeds subsequently realised
  volatility over the matching horizon in NIFTY options.
- **Economic rationale.** The best-documented premium in global index options. Buyers
  of index options are predominantly hedgers and speculators paying for convex payoff;
  the seller is compensated for accepting a left tail that arrives rarely and violently.
  **Who is on the other side:** hedgers with a mandate, and retail buyers of cheap
  lottery tickets. Both have a reason to overpay that is not stupidity.
- **Data.** D1. **ATM IV is not in the file and must be reconstructed** by inverting
  Black-Scholes on the settlement price, using the underlying close in the same row,
  the exchange expiry date, and a declared risk-free rate. Realised volatility from D3
  (close-to-close, 812 days, so RV windows are available before the option sample
  starts). Costs from D8. Grade of the resulting IV series: `Estimated`, never
  `Measured`, because inversion depends on a rate assumption and a settlement-price
  convention.
- **Test design.**
  1. Freeze the inversion convention (rate source, dividend treatment, time-to-expiry
     in trading days vs calendar days) **before** the first run and record it here.
  2. Build the daily ATM IV series per expiry tenor.
  3. Compute the IV − subsequent-RV spread by tenor and by era (eras from Programme 12).
  4. Report the **full distribution** of the spread, not the mean. Explicitly report the
     worst decile.
  5. P&L of a mechanical short-volatility position net of D8 costs, D9 slippage and
     margin cost, sized by a fixed fraction of capital — **not** by a compounding
     balance.
  6. Drawdown profile and worst single day reported before any Sharpe figure.
- **Success criterion.** Mean spread positive **and** the strategy's deflated Sharpe
  (trials ≥ 34) exceeds 0 at p < 0.05 **and** worst single-day loss is less than 25% of
  allocated capital at the tested size.
- **Falsification criterion.** Any one of: mean spread ≤ 0 net of costs; deflated Sharpe
  not distinguishable from zero; or worst single day exceeds 25% of allocated capital —
  the last of which falsifies it as an *allocatable* strategy even if the premium exists.
- **Prior:** 0.70 that the raw spread is positive gross of costs. **0.35** that a
  mechanical short-vol position survives costs, slippage and the drawdown criterion.
  The gap between those two numbers is the entire research question.
- **Trial cost:** 4 (2 tenors × 2 eras).
- **Out-of-sample budget:** 2 holdout evaluations (the largest single allocation).
- **Adjacency disclosure:** SHORT_STRANGLE, BASE_STRANGLE, PUT_WRITE and 5 regime
  variants among the prior 30 are short-volatility strategies on this sample. This
  programme is therefore **not** an independent look at fresh data; it is a
  re-examination of a sample that has already favoured short volatility 13+ times. The
  deflation must, and does, reflect that.

---

### PROGRAMME 3 — Volatility term structure

- **Hypothesis.** The front-expiry minus next-expiry ATM IV spread mean-reverts and
  carries information about forward volatility beyond the level of volatility itself.
- **Economic rationale.** Near-dated contracts absorb shocks faster than far-dated ones
  because their vega is smaller and their gamma larger; a shock therefore steepens or
  inverts a structurally upward-sloping curve temporarily. **Who is on the other side:**
  participants who must roll on a fixed schedule regardless of curve shape.
- **Data.** D1 — 18 expiries per day, verified on both 2024-01-08 and 2026-06-17, so
  front and next are always populated. Same reconstructed-IV caveat as Programme 2.
- **Test design.** Curve slope series by era; frequency, magnitude and half-life of
  backwardation; forward realised volatility conditional on slope, **with current
  volatility level included as an explicit control regressor** so that any predictive
  content attributed to slope is content beyond level; calendar-spread P&L net of costs
  and margin.
- **Success criterion.** Slope retains a coefficient significant at p < 0.05 after
  controlling for volatility level, in **both** eras independently, and the implied
  calendar-spread P&L is positive net of costs.
- **Falsification criterion.** Slope adds nothing once level is controlled, or the sign
  of the coefficient flips between eras.
- **Prior:** 0.20.
- **Trial cost:** 3.
- **Out-of-sample budget:** 1 holdout evaluation.

---

### PROGRAMME 4 — Skew dynamics

- **Hypothesis.** The level and the change of the 25-delta risk reversal carry
  information about subsequent index returns or subsequent realised volatility.
- **Economic rationale.** Skew is the price of asymmetric protection demand. If
  protection demand rises before the move rather than after it, skew leads. If it rises
  with the move, skew is a description of the present, not a signal about the future.
  **Who is on the other side:** portfolio insurers who buy after a scare, i.e. late.
- **Data.** D1. The smile is available daily; delta must be computed from the same
  frozen inversion convention as Programme 2, and the fitting convention (which strikes
  enter the fit, how 25-delta is interpolated, how illiquid wings are excluded) must be
  **frozen and recorded before the first run**.
- **Test design.** The central test is **lead-lag, tested in both directions**:
  cross-correlation of skew change against spot return at lags −5 to +5 days. A signal
  requires the skew-leads direction to dominate. Then forward returns and forward RV
  conditional on skew level decile and skew change decile, by era.
- **Success criterion.** Skew change at lag −1 or earlier shows statistically
  significant cross-correlation with forward returns at p < 0.05, **larger in magnitude
  than the contemporaneous and lagging correlations**, in both eras.
- **Falsification criterion.** The contemporaneous or lagging correlation dominates,
  making skew a description rather than a signal. **This is the expected outcome.**
- **Prior:** 0.25 that skew leads. 0.55 that it is contemporaneous or lagging, i.e.
  falsified. 0.20 that the result is too noisy to distinguish, which is also a failure.
- **Trial cost:** 4.
- **Out-of-sample budget:** 1 holdout evaluation.

---

### PROGRAMME 5 — Open interest and positioning (PARTIAL)

- **Hypothesis.** Strike-wise open-interest distribution and its change carry
  information about subsequent index behaviour.
- **Economic rationale.** Concentrated open interest creates mechanical hedging flow
  near those strikes as expiry approaches. **Who is on the other side:** the writers who
  must hedge, and who are therefore forced buyers or sellers at predictable prices.
- **Data.** D1 gives EOD strike-wise OI and change in OI for 600 days — sufficient for
  the distribution and pinning tests. **Intraday OI transitions do not exist. The
  participant-wise file (M6) does not exist.**
- **Scope reduction, declared now:** the sub-hypothesis this agenda most wanted to
  test — that participant-class positioning leads index moves once the true
  next-morning knowledge time is enforced — **cannot be tested and is not
  pre-registered.** It is moved to the acquisition list in §9 and will be registered as
  a separate programme once M6 has accumulated enough history. Testing it on a
  back-scraped file would silently assume a knowledge time that was never observed, and
  that assumption is precisely the error this programme exists to expose.
- **What is registered:** (a) forward returns conditional on EOD OI build patterns;
  (b) whether PCR-OI has predictive content beyond the trend it mechanically reflects,
  with trend as an explicit control; (c) settlement pinning relative to the
  maximum-OI strike on expiry day.
- **Success criterion.** PCR retains significance at p < 0.05 after controlling for
  a 5-day and 20-day trend, in both eras; or pinning to the max-OI strike is closer than
  chance at p < 0.01.
- **Falsification criterion.** PCR's apparent predictive content vanishes entirely when
  trend is controlled. **Expected for PCR specifically.**
- **Prior:** 0.10 for PCR beyond trend. 0.40 for measurable expiry pinning.
- **Trial cost:** 3.
- **Out-of-sample budget:** 0 initially; pinning may claim 1 if it survives in-sample.

---

### PROGRAMME 7 — Intraday seasonality (PARTIAL)

- **Hypothesis.** Indian index sessions exhibit stable intraday patterns in volatility
  that are stable enough across years to inform entry and exit timing.
- **Economic rationale.** The session has structural features — opening auction
  aftermath, the European open around 12:30 IST, the closing auction — that concentrate
  flow at clock times rather than at price levels. **Who is on the other side:** nobody;
  this is not a prediction, it is a description of when liquidity is cheap. That is
  exactly why it is the most likely programme here to produce something real.
- **Data.** D2 — 1-minute underlying bars for NIFTY, BANKNIFTY and SENSEX,
  2025-09-01 → 2026-06-19, ~190 sessions each. **Option spread, option volume and
  option decay by minute do not exist** (M3, M4).
- **Scope reduction, declared now:** only the **underlying volatility and range**
  half of this programme is registered. Spread and volume seasonality in options is
  moved to §9 and requires forward capture with a fixed 09:15 start.
- **Test design.** Realised volatility and true range by minute-of-day, sliced by
  day-of-week and by days-to-expiry. Stability tested by splitting the 190 sessions into
  disjoint halves and correlating the two profiles. Because only ~190 sessions exist and
  they begin exactly at the September 2025 expiry-weekday change, **year-over-year
  stability cannot be tested** — this is a single-regime result by construction and is
  labelled provisional under P7 regardless of outcome.
- **Success criterion.** Rank correlation between the two disjoint half-sample profiles
  exceeds 0.6 with p < 0.01, for at least two of the three indices.
- **Falsification criterion.** Half-sample profiles correlate below 0.3, meaning the
  profile is fitted to a period.
- **Prior:** 0.65 that a stable underlying intraday volatility profile is found. 0.30
  that it translates into a measurable execution improvement, because that translation
  requires the option-side spread data that does not exist.
- **Trial cost:** 3 (one per index).
- **Out-of-sample budget:** 1 holdout evaluation, and only if the execution claim is
  made; the descriptive profile itself does not need one.

---

### PROGRAMME 1-D — Expiry-day dynamics, degraded EOD variant

The programme as specified (full chain, 1-minute, every expiry day) is **not feasible**
(M3, M4). Rather than pretend otherwise, a strictly weaker version is registered, with
its weakness named.

- **Hypothesis.** Terminal-day option settlement behaves systematically differently from
  non-terminal days, measurable at end-of-day resolution.
- **Data.** D1 — every expiry date in the 600-day window is identifiable from the file.
- **Test design.** Distribution of settlement relative to the previous close's ATM
  strike; terminal-day change in OI at ATM versus wings; the close-to-settlement move
  distribution on expiry days versus matched non-expiry days; **all split by
  Thursday-era and Tuesday-era as separate samples, never pooled**, per P12 and the
  September 2025 expiry-weekday change.
- **What this cannot test, stated explicitly:** the intraday decay profile by time of
  day, the gamma concentration through the session, and hedging-flow timing. Those are
  the substance of the original hypothesis. **This variant tests the shadow of it.**
- **Success criterion.** Expiry-day settlement distribution differs from matched
  non-expiry days at p < 0.01 (KS test) in both eras independently.
- **Falsification criterion.** No distributional difference, or a difference whose sign
  reverses between eras.
- **Prior:** 0.60 that an EOD distributional difference exists. **0.15** that anything
  tradable survives realistic expiry-day slippage — this is the most crowded area of
  Indian retail options and the base assumption is that the obvious version is arbitraged.
- **Trial cost:** 4 (2 statistics × 2 eras).
- **Out-of-sample budget:** 0. A degraded variant does not get to spend the holdout.

---

### PROGRAMMES 6, 8, 9 — Blocked, registered, not runnable

These are pre-registered now, before the data arrives, precisely so that the hypothesis
cannot be adjusted after seeing it.

**Programme 6 — VIX and vol-of-vol.** Hypothesis: India VIX percentile conditions option
strategy performance beyond what current realised volatility already conveys.
*Success:* VIX percentile retains significance at p < 0.05 with realised volatility as
an explicit control. *Falsification:* VIX adds nothing beyond realised volatility, making
it a redundant and more expensive input. **Prior: 0.30.** Blocked on M2. OOS budget: 1.

**Programme 8 — Event studies.** Hypothesis: scheduled events produce a systematic IV
run-up and post-event collapse exploitable net of event risk. *Success:* mean post-event
IV collapse exceeds the pre-event run-up by more than round-trip costs, with the tail
cases shown individually rather than averaged. *Falsification:* the run-up already fully
prices the collapse — **the efficient and most likely outcome for well-known event
classes.** **Prior: 0.20.** Blocked on M7. OOS budget: 1.

**Programme 9 — Cross-exchange natural experiment.** Hypothesis: NIFTY and SENSEX,
tracking highly correlated underlyings but expiring on different weekdays since
September 2025, differ systematically in expiry-day risk premium and microstructure, and
the difference is attributable to expiry structure rather than to liquidity.
*Success:* a difference in expiry-day premium survives after matching on liquidity
(contracts traded, spread proxy) and participant proxy. *Falsification:* the difference
is fully explained by liquidity, leaving no residual attributable to expiry weekday.
**Prior: 0.45** — the highest prior of any programme here, because the structural
difference is recent, exogenous and largely unstudied. Blocked on M1. OOS budget: 1.

**This is the sharpest finding of the feasibility pass.** The programme with the best
ratio of research value to crowding is blocked by the absence of a single dataset that
NSE and BSE both publish daily and that a fetcher could backfill. Everything else in
§9 is optional. This one is not.

---

### PROGRAMMES 10, 11 — Not feasible, not registered

**Programme 10 — Microstructure.** Requires one-second conflated data with five-level
depth. What exists is 4 afternoons at ~5-minute cadence with one depth level. The gap is
not a matter of degree. Not registered; re-registration requires ≥60 sessions of
1-second, 5-level capture starting at 09:15.

**Programme 11 — Machine learning.** Requires a point-in-time feature store and frozen
dataset bundles (M8), neither of which exists, and a sample size that 600 daily
observations across two regimes does not provide. Not registered. Registering it now
would be the exact failure mode the programme's own scoping paragraph warns against:
machine learning does not manufacture signal from noise, and at this sample size honest
validation is not possible.

---

## 6. Priority order and reasoning

| Rank | Programme | Why here |
|------|-----------|----------|
| 1 | **12 — Structural change** | Gate. Its result determines the sampling rule for every programme below it. Running anything else first risks pooling across a break and invalidating the work. Runnable today with zero blockers |
| 2 | **Acquisition sprint: M1, M2, M7** | Three fetchers. They unblock Programmes 9, 6 and 8 — three of the five blocked programmes — and none requires new infrastructure. Doing this before the analysis work means the blocked programmes come online while the runnable ones are being analysed, rather than after |
| 3 | **2 — Variance risk premium** | The premium already implicitly underwrites the paper strangle engine. If it does not survive costs and the drawdown criterion, that matters more than any new discovery. It is also the programme carrying the heaviest prior-trial debt, so it needs the most careful deflation |
| 4 | **7 — Intraday seasonality (underlying half)** | Cheapest real result. Improves execution rather than requiring prediction. Independent of Programme 12's outcome because it is intraday, not cross-era |
| 5 | **4 — Skew dynamics** | Well-posed lead-lag test with a clean falsification. Likely to die fast and cheap, which is the point |
| 6 | **3 — Term structure** | Same data preparation as 2 and 4, so marginal cost is low once the IV inversion is built |
| 7 | **5 — Open interest (reduced scope)** | Low prior on the PCR half; the pinning half is worth one clean test |
| 8 | **1-D — Expiry day, degraded** | Registered for completeness. Low prior, no holdout budget, and it cannot answer the question actually asked |
| 9 | **9, 6, 8** | Run as soon as their data lands from rank 2 |
| — | **10, 11** | Not scheduled |

**Sequencing note.** Programmes 2, 3 and 4 share one expensive dependency: the
Black-Scholes inversion of settlement prices into an IV surface, with a frozen
convention. That is built once, before Programme 2, and reused. It must be built with
the convention recorded in writing and hashed, because three programmes' results become
incomparable if it changes midway.

---

## 7. Out-of-sample budget

### 7.1 The period split

Conditional on Programme 12's break dates. The proposal below assumes the September 2025
expiry-weekday change is confirmed as a break; if Programme 12 finds different dates,
this split is redrawn **before** any strategy touches it, and the redraw is recorded.

| Segment | Window | Approx. sessions | Use |
|---------|--------|------------------|-----|
| **In-sample** | 2024-01-08 → 2025-08-29 | ~400 | Free. Iterate as needed. Every iteration counted |
| **Walk-forward OOS** | 2025-09-01 → 2026-02-27 | ~120 | Rolling walk-forward via `walk-forward.js`. Consumed gradually, tracked per programme |
| **Final holdout** | 2026-03-02 → 2026-06-17 | ~70 | **Touched exactly once, ever, per strategy. Shared across all programmes** |
| **Virgin forward data** | 2026-06-18 → today | ~30 | **Not yet fetched. See §7.3 — this is time-critical** |

### 7.2 Holdout allocation

The final holdout is a depletable, shared resource. Total evaluations available across
the entire agenda: **7**.

| Programme | Holdout evaluations | Rationale |
|-----------|--------------------|-----------|
| 2 — VRP | 2 | Largest allocation: it carries the most prior-trial debt and the most implicit capital |
| 3 — Term structure | 1 | |
| 4 — Skew | 1 | |
| 7 — Seasonality | 1 | Only if an execution claim is made |
| 6 — VIX | 1 | On unblocking |
| 9 — Cross-exchange | 1 | On unblocking |
| 8 — Events | 0 | Draws from the reserve if it survives in-sample |
| 12, 1-D, 5 | 0 | Descriptive or degraded; no predictive claim to validate |
| **Total** | **7** | |

Allocation exceeds the seven programmes listed because 6 and 9 are blocked; if both
unblock, the last two are drawn from the reserve created by any programme that dies
in-sample and returns its unspent allocation. **A dead programme's holdout allocation
returns to the pool. A surviving programme's does not carry over.**

**The exchange rate.** Once the 7 evaluations are spent, additional out-of-sample data
can be obtained in exactly one way: by waiting. NSE produces roughly **21 new trading
days per month**. There is no other source. This is worth stating as a rate because it
converts an abstract governance rule into a schedule: spending the holdout carelessly in
August costs approximately **three and a half months** to replace.

### 7.3 The virgin window — time-critical

D1 ends **2026-06-17**. Today is **2026-07-31**. Approximately **30 trading days** of
NIFTY bhavcopy exist at NSE that have never been fetched, never been backtested and
never been seen by any script in this repository.

That window is the only genuinely untouched out-of-sample data available without
waiting. Its value is destroyed the moment any script fetches it into `bt-data/bhav/`
and a subsequent backtest silently includes it in a 630-day sweep.

**Pre-registered action, to be taken before Programme 12 runs:**

1. Fetch 2026-06-18 → 2026-07-31 into a **separate sealed directory**, not into
   `bt-data/bhav/`.
2. Compute and record a SHA-256 manifest of every file.
3. Record the seal date and the fact that no analysis has been run against it.
4. Gate access behind an explicit, logged unseal step in `validation-ledger.js`.
5. Extend the seal monthly as new data accrues.

The distinction that makes this urgent: unlike the intraday chain data of M3, this data
is **not** at risk of being lost — NSE will still publish it next year. What is at risk
is its **virginity**, and that is lost the first time it is looked at. A fetcher written
carelessly this week costs an irreplaceable holdout; a fetcher written carefully costs
nothing extra.

---

## 8. Governance wiring

The governance requirements of Part E map onto modules that already exist. Nothing new
is needed except the seeding and the discipline.

| Requirement | Existing module | Action required |
|-------------|----------------|-----------------|
| Permanent research log | `validation-ledger.js` | Seed with the 30 prior trials of §4. Add a pre-registration record per programme in this document |
| Family trial counter feeding deflated significance | `validation-stats.js` | Already implements deflated Sharpe. Must read the seeded count, not default to 1 |
| Walk-forward with purge and embargo | `walk-forward.js` | Already implements purged + embargoed CV |
| Holdout consumption tracking | **missing** | Add an unseal log: which programme, which date, which segment, one row per touch, append-only |
| Negative results retained permanently | `validation-ledger.js` | Retention must be explicit — a negative result must never be overwritten by a later positive one on the same programme ID |
| Independent replication before live capital | — | Procedural. A second implementation reproducing the headline from the same pinned data |
| Quarterly review | — | Procedural. What was tested, what survived, what decayed, how much OOS was consumed |

**The failure mode to guard against, named:** the trial counter is the easiest thing in
the entire system to quietly under-count, and it is the only input that makes deflated
significance mean anything. A counter seeded at 1 when the truth is 30 does not produce
a slightly optimistic result; it produces a result that is wrong in the direction that
feels best, which is the direction nobody checks.

---

## 9. Acquisition list — what must be built to unblock

Ordered by ratio of research value unblocked to effort.

| # | Acquire | Unblocks | Effort | Note |
|---|---------|----------|--------|------|
| A1 | **SENSEX + BANKNIFTY option bhavcopy history** | Programme 9 entirely; cross-instrument work in 2, 12 | One fetcher per exchange | Highest value. Programme 9's prior of 0.45 is the highest in the agenda |
| A2 | **India VIX full history** | Programme 6; VIX-conditioned slices of 2, 3, 7 | One fetcher | NSE publishes it |
| A3 | **Event calendar** — RBI, budget, CPI/IIP, elections | Programme 8 | ~200 dated rows, manual or scraped | Must carry both event date and announcement time |
| A4 | **Capture start at 09:15** | Programme 7 option half; Programme 1 forward | Configuration and supervision, not code | Currently missing 2h–2h51m of every session, 4/4 days |
| A5 | **Fixed capture cadence** | Any time-weighted intraday statistic | Same | Cadence varied 1.3 → 9.7 minutes across four days |
| A6 | **Participant-wise OI with next-morning knowledge time** | The core of Programme 5 | One daily fetcher plus a knowledge-time column | Only meaningful going forward; back-scraping assumes a knowledge time never observed |
| A7 | **Five-level depth capture** | Programme 10 | Feed-dependent; may not be available | Verify feed capability before promising it |
| A8 | **Point-in-time feature store** | Programme 11 | Downstream of doc 071 | Not near-term |

A1 through A3 are three fetchers and unblock three programmes. They are the highest-
leverage work in this entire document and none of them is research — they are plumbing.

---

## 10. What could make this document wrong

Recorded now, so that a later correction is visible as a correction.

1. **The IV reconstruction may be unusable.** Programmes 2, 3 and 4 all depend on
   inverting BSM from daily settlement prices. Settlement prices are exchange-computed
   and may be theoretical rather than traded for illiquid strikes. If a material
   fraction of ATM settlements prove to be theoretical, the resulting IV series is
   circular and all three programmes collapse to `CANNOT_VALIDATE`. **This is checked
   first, before Programme 2 runs, and the check result is recorded whichever way it
   falls.**
2. **The two eras may be too short.** ~400 in-sample and ~120 walk-forward sessions
   split across two regimes is a small sample for any claim about volatility, which is
   itself slow-moving. Every result from this agenda is provisional under P7 until it
   has survived a full volatility regime cycle, and none of them will have.
3. **The prior-trial floor of 30 may be badly low.** It counts only persisted results.
   If the true figure is 100, every deflated significance in this agenda is optimistic.
   The floor is defensible; the true count remains `Unknown`.
4. **Programme 12 may find break dates that invalidate §7.1's split.** That is the
   expected mechanism, not a failure — the split is redrawn before use, and the redraw
   is recorded.
5. **The 4-session raw chain sample may not be representative of the capture that will
   exist in three months.** The feasibility verdicts for the intraday programmes should
   be re-measured, not assumed, once A4 and A5 are in place.

---

## 11. Summary

- **Runnable today:** Programmes 12, 2, 3, 4. Partial: 5, 7. Degraded: 1-D.
- **Blocked on three fetchers:** 9, 6, 8 — including the highest-prior programme in the
  agenda.
- **Not feasible:** 10, 11.
- **Prior trial debt:** ≥ 30 evaluations already spent on the in-sample data, unrecorded
  until now.
- **First action:** seal the ~30 virgin trading days before anything fetches them
  carelessly.
- **Second action:** run Programme 12, because its result governs how every other
  programme samples.
- **Priors are recorded above and are frozen.** When results arrive, the difference
  between the prior and the posterior is the measure of what was learned; the absence of
  such a difference is the signature of a rationalised result.

No test has been run. No hypothesis has been evaluated. Nothing in this document
constitutes a claim that any edge exists.
