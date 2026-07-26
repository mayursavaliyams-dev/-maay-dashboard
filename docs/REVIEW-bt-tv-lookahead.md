# REVIEW — `backtest-tv/run.js` carried the same look-ahead as `bt-strangle-costs.js`

**Date:** 2026-07-26 · **Scope:** one file, `backtest-tv/run.js` (not a protected file).
**Verdict:** the three committed result files are **VOID**. Everything computed from them,
including any CALL-vs-PUT comparison, is void. **Nothing in them is salvageable.**

---

## 1. The defect (D1) — FATAL, confirmed in code and by test

`run.js:265` (pre-fix):
```js
const direction = close >= open ? 'CALL' : 'PUT';
```
`getSignal(candle, …)` was handed the **full daily candle** at `run.js:494`, including
`close`. `simulateTrade` then entered at `candle.open` (`run.js:320`). The direction was
chosen with perfect hindsight and the entry placed roughly six hours earlier.

Same defect class as `bt-strangle-costs.js` in `docs/REVIEW-selling-edge-invalidated.md`
("selects its strikes using the closing price of the day it trades and sells them at that
day's open").

**Verified corroborating symptoms** (from the quarantined files, re-counted this session):

| symptom | measured | consistent with |
|---|---|---|
| 404 trades with `status:"OK"` across the three files | 99 + 138 + 167 = **404** ✓ | task statement |
| zero `TRAIL_STOP` in 404 trades | reachable branch at `run.js:371`, never taken | D1 + D3 |
| BANKNIFTY TARGET exits all exactly `+150.0%` | hindsight fill at a chosen level (D3) | D3 |

## 2. D2 — three files, three different risk configs (verified this session)

| file | stopLossPct | targetPct | trailLockPct | numExpiries | OK trades |
|---|---|---|---|---|---|
| nifty | 5 | 400 | 90 | 1200 | 99 |
| **banknifty** | **35** | **150** | **50** | **2000** | 138 |
| sensex | 5 | 400 | 90 | 1200 | 167 |

Confirmed exactly as stated in the task. **Not three indices — three strategies.** Any
cross-index aggregate over these files is a category error, independent of D1.

## 3. Phase 1 — characterization test, proven RED first

`test/bt-tv-lookahead.test.js` (8 categories per the Testing Rule; this is a *change* to
existing behaviour, so a characterization test was mandatory).

The pin cannot pass by accident: each bar is built so the **gap** and the **close** point
in **opposite** directions, so the returned direction reveals which field the signal read.

- gap **up** (+2% from prevClose) but bar **closes down** → honest answer `CALL`
- gap **down** (−1.96%) but bar **closes up** → honest answer `PUT`
- two strong bars, identical `open` and `prevClose`, **opposite closes** → direction must
  not differ (a flip proves it read a field it cannot see at 09:15)

**RED confirmed on the pre-fix code:**
```
AssertionError: D1: direction must follow the GAP (up), not the day CLOSE (down)
```

> Note on the task's literal example (`open 100, high 101, low 99, close 101`): that bar
> returns `null` on this code — `bodyRatio` 0.5 clears no tier — so it cannot pin anything.
> Tier-firing bars are used instead. Stated rather than silently substituted.

## 4. Phase 2 — the fix (one defect, one root cause)

- `run.js:494` now passes **`{ open: candle.open }`** — the day's `close`/`high`/`low` are
  **absent, not zeroed** (`null ≠ 0`; a zeroed close would make every day a PUT).
- `run.js:265` derives direction from the **gap** (`open` vs `prevClose`, already computed
  at `run.js:262`) — knowable at 09:15.
- **D3 deliberately not fixed here** (extreme-fill look-ahead at `run.js:359`). One defect,
  one commit.

## 5. The measured outcome — as measured, not as liked

The honest number could not be produced from a fresh data run: Yahoo Finance was
unreachable from this machine (60/60 expiries `no data`). So the effect was measured
**directly at the signal boundary** — the same `getSignal`, called the old way (full
candle) and the new way (open only), over 810 strong tier-firing bars:

```
OLD (full candle):  797 / 810 bars produced a signal   ← hindsight entries
NEW (open only):      0 / 810 bars produced a signal   ← honest
→ 100% of entries were unavailable without look-ahead
```

**Result: with the look-ahead removed, this strategy has 0 evaluable entries.**
Win rate: **N/A (0 trades)**. Profit factor: **N/A (0 trades)**.

The reason is structural, not incidental: *every* surviving tier gates on the day's own
bar — `bodyRatio` and `range` (EVENT, POWER_TREND) and `gapAligned`'s `close > open`
(GAP_CONTINUATION) — all computed from `close`/`high`/`low`. Removing the peek removes the
entry rule itself.

This is **worse than** the PF 0.84 that `docs/REVIEW-bt-real-lookahead.md` reports for
directional buying *with* look-ahead. That was the expected region; the actual answer is
that there is no entry rule left to evaluate. A backtest reporting "this strategy has no
entry rule I can evaluate honestly" is a correct result, not a failure.

## 6. Quarantine

The three files are renamed and left **unregenerated** (regeneration is impossible: no
network, and the honest run produces 0 trades):

```
backtest-tv-results-nifty-VOID-lookahead.json       (99 OK trades)
backtest-tv-results-banknifty-VOID-lookahead.json  (138 OK trades)
backtest-tv-results-sensex-VOID-lookahead.json     (167 OK trades)
```

**Incident, disclosed:** while attempting a fresh measurement run, the NIFTY results file
was overwritten by the test run (60 expiries, 0 trades). The original was recovered
verbatim from commit `41e3536` and is what now sits in the VOID file (99 trades, 1200
expiries, target 400 — matching the task's stated config). No evidence was lost, but the
run should have been directed at a scratch path. Recorded rather than quietly repaired.

## 7. Other findings from the task, verified but NOT fixed here

- **D4** — `iv` in the output is not implied volatility: `run.js:315`
  `baseIV = Math.max(vol * 1.7, 0.30)` is 1.7 × 20-day **historical** vol with a 0.30 floor
  (which is why the minimum `iv` across all 404 trades is exactly `0.300`). The field name
  is misleading and should be renamed or documented. **Filed, not fixed** (out of scope).
- **D5** — dead columns: `blastLevel` `LOW` on 404/404, `confidence` `HIGH` on 397/404,
  `strikeOffset` 0 on 397/404. Zero information per trade. **Filed, not fixed.**
- **`backtest-tv/sell.js`** — not touched in this task, **likely shares the defect**. Filed
  as a separate finding; must be reviewed before any number from it is used.
- **DAILY_LOSS / D3** — unchanged by design.

## 8. Definition of done

- [x] `test/bt-tv-lookahead.test.js` fails on pre-fix `run.js`, passes after the fix
- [x] full suite green, gated on exit code, **three consecutive runs** (56/56, 56/56, 56/56)
- [x] the three result files renamed `*-VOID-lookahead.json`, left unregenerated
- [x] `THE-ONE-DOCUMENT.md` §2 gains row **L1** recording the shared look-ahead
- [x] new win rate / PF reported **as measured**: N/A — 0 evaluable entries

**Institutional recommendation:** treat every `backtest-tv` number published before this
date as void. Do not attempt to recover the old win rate; it was produced by hindsight.
If a directional entry rule is wanted for this harness, it must be specified from data
available at 09:15 and re-validated from scratch through `bt-validate`.
