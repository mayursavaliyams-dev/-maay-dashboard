# SUPREME REVIEW BOARD — the selling edge is NOT ESTABLISHED

**Subject:** `bt-strangle-costs.js`, the 600-day backtest cited as *"the validated edge is option
selling"* (`THE-ONE-DOCUMENT.md:17`).

**Verdict: REJECT the claim.** The 89% win rate is produced by look-ahead bias. Removed, the same
strategy is a **net loser at profit factor 0.55**.

No project file was executed. `bt-lib.js`, `bt-strangle-costs.js` and `charges.js` were **read**, and
the strategy independently re-implemented against the raw CSVs. Only `charges.js` was required — it is
29 pure lines with no I/O. Nothing was written. Suite 46/46.

---

## Executive Summary

This is the platform's central claim. It is the reason `strangle-engine.js` exists, the reason the paper
book is a short strangle, and the reason directional buying was retired. **It rests on a backtest that
chooses its strikes using the closing price of the day it trades.**

## Problem

`bt-strangle-costs.js:45-47`:

```js
const atm = atmStrike(day);                                    // bt-lib.js:26
const off = Math.round((day.underlying * OTM_PCT) / 50) * 50;  // OTM_PCT = 0.015
const ce = leg(day, 'CE', atm + off), pe = leg(day, 'PE', atm - off);
```

`bt-lib.js:18` — `underlying = +rows[0][20]`. UDiFF column 20 is `UndrlygPric`: the underlying's
**closing** level for that day.

`bt-strangle-costs.js:49-50` — the legs are then sold at `ce.o` and `pe.o`, the option **opens**.

**The strangle is centred on where the index finished, and sold at where it started.** A 1.5%-OTM
strangle drawn around the day's close is almost guaranteed to expire outside its strikes. That is the
88% win rate.

## Evidence — MEASURED

All three variants share identical sizing rules, slippage (`SLIP = 0.02`), stop (`STOP_MULT = 2.0`),
charges (`charges.js`), universe and cooldown. **Only the information set and the lot size differ.**

```
days: 600

variant                          trades   win%        net       PF
  A shipped (look-ahead, LOT=75)  129   88.4%    ₹3,65,579   7.41
  B no look-ahead (LOT=75)        129   46.5%     ₹-79,899   0.55
  C no look-ahead + real lot      129   46.5%     ₹-52,434   0.61

distinct NewBrdLotQty across the 600 days: 25, 50, 65, 75
days where the hardcoded LOT=75 is WRONG: 356 / 600 (59.3%)
```

- **Variant A reproduces the shipped result.** 88.4% against the claimed 89%. This is the source of the
  number in `THE-ONE-DOCUMENT.md`.
- **Variant B** uses yesterday's close for the ATM and the offset — everything a trader knows at 09:15.
  **Win rate collapses 88.4% → 46.5%. Profit factor 7.41 → 0.55. The strategy loses ₹79,899.**
- **Variant C** additionally reads the real lot size from the bhavcopy. Still a loser: PF 0.61.

**A profit factor of 7.41 falling to 0.55 is not a degradation. It is the removal of a result that was
never there.**

## Root Cause — one

**`bt-lib.js:18` exposes a closing price under the name `underlying`, and every consumer treats it as
the price available when it trades.**

Both this review and `docs/REVIEW-bt-real-lookahead.md` trace to that single unlabelled datum. It is not
a typo; it is an Article 5 ownership failure in a shared library.

## Three further defects, each measured

### 1. `LOT = 75` is hardcoded, and wrong on 59.3% of the days

`bt-lib.js:12` — `const LOT = 75, CAPITAL = 100000, RISK_PCT = 0.05;`

The bhavcopy carries `NewBrdLotQty` on **every row**. Across the 600 days it takes four values:
**25, 50, 65, 75**. This is constraint **F1** — *"lot size is time-varying and lives in the data"* —
violated by the library that F1 was written about. Position sizes, charges and P&L are all scaled by it.

### 2. The header describes a strategy the code does not run

`bt-strangle-costs.js:19` — *"hold to expiry close, weekly re-entry"*.

The code exits at `ce.c` / `pe.c`: **the same day's close.** It is a **one-day** short strangle with a
weekly cooldown, not a held-to-expiry position. Their risk profiles are not comparable — a one-day
strangle never experiences the gamma of expiry week.

**The comment is not documentation. It is a description of a different strategy.**

### 3. No out-of-sample split, no significance test

`bt-validate.js` exists in this repository and implements purged k-fold, deflated Sharpe and PSR.
`bt-strangle-costs.js` contains **zero references to it**. 129 trades, one pass, four tuned constants
(`OTM_PCT`, `STOP_MULT`, `RISK_PCT`, the 25-lot cap), no sensitivity analysis, no confidence interval.

## What this does **not** prove

**It does not prove that the volatility risk premium is absent.** VRP is a documented phenomenon in the
academic literature; this Board has read none of it and cites none of it.

What is proven is narrower and sufficient:

> **The evidence this repository offers for its own selling edge is invalid, and the honest replication
> of that evidence is a losing strategy.**

The claim must be withdrawn until it is re-established. Absence of valid evidence is not evidence of
absence — but it is also **not a licence to keep the claim**.

## Impacts

**Trading Impact.** `strangle-engine.js` is paper-only and places no broker order. **No capital has been
lost.** But its existence, its capital allocation (`STRANGLE_CAPITAL: 700000`) and its status as *"the
product face"* rest on this number.

**Risk Impact.** Severe and structural. A strategy believed to win 88% of the time is sized, monitored
and trusted differently from one that wins 46%. Every risk parameter downstream inherits the error.

**Research Impact.** `THE-ONE-DOCUMENT.md:17` states the edge as fact. That line is now false and is
corrected by this review.

**Data Impact.** None. Read-only.

**Future Impact.** Every strategy built on `bt-lib.loadDay()` — `bt-strangle-regime.js`,
`bt-strangle-tailsafe.js`, `bt-strangle-trend.js`, `bt-strategies.js`, `bt-world-strategies.js` — uses
the same `underlying` and the same hardcoded `LOT`. **None has been audited. All are suspect.**

## Regression Risk

None from this review; nothing was changed. Fixing `bt-lib.js` will change **every** backtest result in
`bt-data/`. That is the correct outcome, and it must happen with the results treated as evidence to be
re-derived, not defended.

## Rollback Plan

Not applicable. Read-only.

## Final Recommendation — **REJECT the claim. RESEARCH MORE.**

1. **Withdraw the sentence** *"The validated edge is option selling"* from `THE-ONE-DOCUMENT.md` and
   every doc that repeats it. Replace with the measured status: **NOT ESTABLISHED.**
2. **`bt-lib.js:18` must name its column** — `underlying` → `underlyingClose` — and expose
   `underlyingOpen` if a strategy needs it. One rename removes an entire bug class.
3. **`bt-lib.js:12` must not hardcode `LOT`.** The lot is on every bhavcopy row. Use it, or refuse.
4. **Re-audit all five remaining `bt-*` strategy scripts.** They share both defects.
5. **No strategy result may be written to `bt-data/` without passing `bt-validate.js`.**
6. **`strangle-engine.js` stays paper, stays running.** Its 7 closed forward-test trades are the only
   *un-contaminated* evidence this platform has about selling, and 7 is not a sample. It must keep
   accruing outcomes. **That is now the only path to re-establishing the claim.**

---

**The one claim this review strengthens:** directional option *buying* has no edge here. That was
already measured (PF 0.94, 1,200 trades) and was confirmed independently in
`docs/REVIEW-bt-real-lookahead.md`, where buying failed at PF 0.84 **even with tomorrow's newspaper**.

**Both sides of the book are now unsupported by their own backtests.** The platform's honest position is
that it has **no validated edge** — only a paper forward-test with 55 labelled outcomes, which the
project's own constraint M2 already declares insufficient.
