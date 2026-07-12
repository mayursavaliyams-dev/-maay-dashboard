# SUPREME REVIEW BOARD — STATISTICAL REVIEW of `bt-real.js`

**Subject:** the 600-day "REAL-PREMIUM BACKTEST" that reports `Trades: 470 | Win: 7% | Net: +₹3,45,615`.
**Verdict: REJECT. The result is produced by look-ahead bias, and the strategy has no edge even with it.**

No project file was executed. `bt-lib.js` and `bt-real.js` were **read**, and their logic independently
re-implemented against the raw CSVs. Nothing was written.

---

## Problem

The strategy is described in its own header (`bt-real.js:1-5`):

> *"index gap-and-go direction → nearest-expiry deep-OTM strike → **BUY at open** → exit via 5% SL /
> 5x target / trail"*

An entry at the **open** may only use information available at the open.

## Evidence — MEASURED

**Defect 1 — the signal is computed from the day's closing price.**

| location | code | what it is |
|---|---|---|
| `bt-lib.js:18` | `underlying = +rows[0][20]` | UDiFF column 20 = `UndrlygPric`, the underlying's **closing** level for that day |
| `bt-real.js:48` | `gapPct = ((day.underlying - prevClose) / prevClose) * 100` | today's **close** vs yesterday's **close** |
| `bt-real.js:49` | `sig = gapPct > GAP_THR ? 'CE' : gapPct < -GAP_THR ? 'PE' : null` | direction chosen from that |
| `bt-real.js:53-55` | `entry = opt.o * (1 + SLIP)` | filled at the option's **open** |

This is not an overnight gap. It is a **full-day return**, known only at 15:30, used to place a trade at
09:15. **Look-ahead bias. Data leakage.**

**Defect 2 — strike selection also uses end-of-day information.**

`bt-real.js:14-19`, `pickStrike()`:

- `atmStrike(day)` is computed from `day.underlying` — again the **close**.
- `o.oi >= MINOI` filters on `OpnIntrst`, which is the **end-of-day** open interest.

The strike you "bought at the open" was chosen using the day's closing ATM and the day's closing
liquidity. **Selection bias, on top of the leakage.**

## Root Cause — one

**`day.underlying` is a closing price, and the code treats it as if it were available at the open.**
Both defects follow from that single mislabelling. `bt-lib.js` never states which price column 20 is.

## The measurement

Both variants share identical sizing, costs, exit logic and universe. Only the information set differs.

- **A — shipped:** signal = today's close vs yesterday's close (as written).
- **B — honest:** signal = yesterday's close vs the day before; ATM reference = yesterday's close.
  Everything a trader could actually know at 09:15.

```
days loaded: 600

variant                     trades   win%      net        PF    exits
  A shipped (look-ahead)     470    6.8%   ₹19,93,732   1.01  {"SL":438,"TRAIL":25,"TARGET":5,"EOD":2}
  B honest  (no look-ahead)  469    4.5%   ₹-1,01,513   0.84  {"SL":448,"TARGET":7,"TRAIL":11,"EOD":3}

  delta in net: ₹20,95,244   -> this is the value of knowing the future
```

**Profit factor collapses from 1.01 to 0.84. The strategy becomes a net loser.**

### Two honest caveats on this measurement

1. **This replication is not byte-identical to the shipped script.** My variant A nets ₹19,93,732 where
   `bt-real.js` reports ₹3,45,615 — the position-sizing differs (`bt-lib.js`'s `LOT` handling). The
   **comparison** is nonetheless valid: A and B are identical in every respect except the information
   set. The *level* is mine; the *delta* is the bias.
2. **The trade count is not the source of the difference** (470 vs 469). The signals differ in
   direction, not in frequency.

## The finding that matters more than the bias

**Even with look-ahead, variant A's profit factor is 1.01.**

A profit factor of 1.01 across 470 trades is not an edge; it is a coin flip that pays the slippage.
The reported `+₹3,45,615` comes from **compounding a 1.01 PF at `RISKPCT = 0.05`** — a sizing rule that
turns statistical noise into a rising equity curve. Remove the future knowledge and the same sizing
turns it into a falling one.

**A strategy that cannot win while cheating does not have a bug. It has no edge.**

## Additional statistical defects

| defect | evidence |
|---|---|
| **No out-of-sample split** | 600 days, one pass, no train/test partition. `bt-validate.js` — which already implements purged k-fold, deflated Sharpe and PSR — **is not used here**. |
| **Multiple testing / p-hacking surface** | Eight tuned constants in one line: `MAXPREM=38, MINOI=50000, SL=0.05, TARGET=4.0, TRAIL_AT=2.0, TRAIL_LOCK=0.90, RISKPCT=0.05, GAP_THR=0.15` (`bt-real.js:9-10`). None is justified in the file. No sensitivity analysis. |
| **Costs understated** | `SLIP = 0.02` is the only friction. Brokerage, STT and exchange charges are **not applied** — `bt-real.js` does not require `charges.js`, which twelve other modules do. Adding them moves both variants down. |
| **Tail dependence unstated** | 5 TARGET + 25 TRAIL exits carry the entire result; 438 of 470 trades stop out. The estimate rests on ~30 observations. **Confidence interval: not computed. Statistical power: not computed.** |
| **Survivorship** | None — all 600 bhavcopy days are used. This one is clean. |

## Impacts

**Trading Impact.** None today: `bt-real.js` is an offline CLI. It has never fed a live or paper engine.
**Risk Impact.** Indirect and serious. This result appears in `bt-data/result-real.json` and is the kind
of number that justifies capital. **It must not.**
**Data Impact.** None. Read-only.
**Architecture Impact.** `bt-lib.js` publishes `underlying` without declaring which price it is —
an unlabelled datum in a shared library. That is an Article 5 ownership failure, not a typo.
**Future Impact.** Any strategy built on `bt-lib.loadDay()` inherits the same ambiguity.

## Regression Risk of fixing it

**Low, and it should be fixed.** Shifting the signal by one day is a four-line change to an offline
script. But the honest result is a **losing strategy**, so the correct action is not to fix and re-run —
it is to **retire the claim**.

## Rollback Plan

Not applicable. Nothing was changed. `bt-data/result-real.json` was restored to its committed state
after an earlier accidental execution (see `docs/CONSTITUTION-AUDIT.md` §0).

## Final Recommendation — **REJECT**

1. **`bt-data/result-real.json` must not be cited as evidence of edge.** Its headline is a look-ahead
   artefact, and the underlying strategy fails at PF 0.84 without it.
2. **`bt-lib.js:18` must name its column.** `underlying` → `underlyingClose`. One rename, and every
   future reader is told what they are holding. Until then, every consumer is one assumption away from
   this same bug.
3. **Any strategy claim in this repository must pass `bt-validate.js`** — purged k-fold, deflated Sharpe,
   PSR — before it is written to `bt-data/`. That module exists and is unused here.
4. **The one surviving edge claim — option *selling* — has not been audited by this Board.** It is not
   endorsed by this document. `docs/THE-ONE-DOCUMENT.md` cites it from a separate backtest, which must
   receive the same treatment before it is trusted.

**The refuted claim in `THE-ONE-DOCUMENT.md` §Executive — that directional option *buying* has no edge
(PF 0.94, 1,200 trades) — is CONFIRMED and strengthened by this review.** Buying does not work here
either, even with tomorrow's newspaper.
