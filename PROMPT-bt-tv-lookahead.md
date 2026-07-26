# TASK PROMPT — `backtest-tv/run.js` look-ahead invalidation

> Paste this whole file into the assistant working on Antigravity.
> Read `MASTER_PROMPT.md` and `THE-ONE-DOCUMENT.md` first; this task obeys both.
> Reply to the owner in **Gujarati script**. Code, paths and identifiers stay English.

---

## 0. Scope

One file: `backtest-tv/run.js`. It is **not** a protected file — no approval package is
needed. Do not touch `server.js` or `execution-engine.js` in this task.

Three result files are downstream of it and are **quarantined by this task**:
`backtest-tv-results-nifty.json`, `-banknifty.json`, `-sensex.json`.

**Do not fix anything until Phase 1 is green.** Characterization test first — pin the
behaviour, prove the test fails on the current code, then change one thing.

---

## 1. Evidence already measured — do not re-derive, verify and move on

Measured 2026-07-26 against the three committed result files (404 trades with
`status: "OK"`) and against `run.js` as it stands on disk.

### D1 — FATAL. The signal reads the close of the day it trades. `run.js:265`

```js
const direction = close >= open ? 'CALL' : 'PUT';
```

`getSignal(candle, …)` receives the **full daily candle** at `run.js:494`, including
`close`. `simulateTrade` then enters at `candle.open` (`run.js:320`). The direction is
therefore chosen with perfect hindsight and the entry is placed six hours earlier.

This is the same defect class as `bt-strangle-costs.js` in
`docs/REVIEW-selling-edge-invalidated.md` — "selects its strikes using the closing price
of the day it trades and sells them at that day's open."

Corroborating symptoms, all consistent with D1 and with nothing else:

| symptom | measured | what an honest model would show |
|---|---|---|
| STOP_LOSS hit rate, NIFTY | 35 / 99 | with `SL=5%`, `delta≈0.48`, `entryOpt≈61`, the stop sits **≈5.4 index points** from the open — it should fire on nearly every daily bar |
| pooled win rate | 58.9% | 0-DTE ATM directional buying, no edge claimed anywhere in the repo |
| `byReason` | zero `TRAIL_STOP` in 404 trades | the branch at `run.js:371` is reachable but never taken |

**Everything computed from these three files is void, including any CALL-vs-PUT
comparison.** State that in the report; do not quietly drop it.

### D2 — The three result files were generated with three different risk configs

| file | `stopLossPct` | `targetPct` | `trailLockPct` | `numExpiries` | generated |
|---|---|---|---|---|---|
| nifty | 5 | 400 | 90 | 1200 | 2026-05-12 |
| **banknifty** | **35** | **150** | **50** | **2000** | 2026-05-03 |
| sensex | 5 | 400 | 90 | 1200 | 2026-07-02 |

That single difference explains the whole cross-index table: BANKNIFTY has **0**
STOP_LOSS exits and **18** TARGET exits; NIFTY has **35** stops and **0** targets.
Not three indices — three strategies. Any aggregate across them is a category error.

### D3 — Second look-ahead: TARGET and TRAIL are awarded at the day's extreme. `run.js:359`

```js
const spotMidFav = signal === 'CALL' ? high : low;
const optAtMid   = bsPrice(spotMidFav, strike, T_mid, r, iv, optType);
```

The favourable extreme of the bar is not knowable at entry, and the bar carries no
ordering between the extreme and `spotSLLevel`. Fingerprint in the data: **every one of
the 18 BANKNIFTY TARGET exits is exactly `+150.0%`** — a fill at a level chosen by
hindsight, not a price anyone traded.

### D4 — `iv` in the output is not implied volatility. `run.js:315`

```js
const baseIV = Math.max(vol * 1.7, 0.30);
```

It is 1.7 × 20-day historical volatility, floored at 0.30. The floor is why the minimum
`iv` across all 404 trades is exactly `0.300`, and the top of the range reaches `1.649`
(165%). Any analysis that buckets by `iv` is bucketing **realized** vol wearing an
implied-vol field name. Rename the field or document it — silently keeping the name
`iv` will mislead the next reader, as it already misled one.

### D5 — Two dead columns

`blastLevel` is `LOW` on **404 of 404** trades; `confidence` is `HIGH` on 397 of 404;
`strikeOffset` is 0 on 397 of 404. They are recorded per trade and carry zero
information. Either make them vary or stop writing them.

---

## 2. Phase 1 — characterize, do not fix

Create `test/bt-tv-lookahead.test.js`. Eight categories per the Testing Rule; this file
is a **change** to existing behaviour, so a characterization test is mandatory.

Pin D1 with a test that cannot pass by accident:

1. Build a synthetic daily candle that **opens flat and closes up**: `open 100, high 101,
   low 99, close 101`. Assert `getSignal(...).direction === 'CALL'`.
2. Build its mirror — identical `open/high/low`, `close 99`. Assert `direction === 'PUT'`.
3. Assert that the two calls differ **only** in `close`. That is the pin: a function whose
   output flips on a field it must not be able to see.

Run the suite gated on exit code. **Prove it fails after the fix, not before.** Commit
nothing yet.

## 3. Phase 2 — the fix

`getSignal` must receive only what a trader knows at 09:15.

Change the call site at `run.js:494` to pass a candle with `close` (and `high`/`low`)
**absent**, not zeroed — `null ≠ 0`, and a zeroed close would make every day a PUT day.
Signal inputs are then limited to: `open`, `prevClose`, `recentCloses`, `vol`, `dateStr`.

`const direction = close >= open ? …` has no replacement that uses the same bar. Either
derive direction from the gap (`open` vs `prevClose`, already computed at `run.js:262`)
or **return `null` and record `noSignal`**. Refusing is an acceptable outcome — a
backtest that reports "this strategy has no entry rule I can evaluate honestly" is a
correct result, not a failure.

Do **not** fix D3 in the same commit. One defect, one root cause, one fix.

## 4. Definition of done

- [ ] `test/bt-tv-lookahead.test.js` fails on current `run.js`, passes after the fix
- [ ] full suite green, gated on exit code, three consecutive runs
- [ ] the three `backtest-tv-results-*.json` files are regenerated **with one identical
      risk config**, or renamed to `*-VOID-lookahead.json` and left unregenerated
- [ ] `THE-ONE-DOCUMENT.md` §2 gains a row recording that `backtest-tv/run.js` carried
      the same look-ahead as `bt-strangle-costs.js`
- [ ] the new win rate and PF are reported **as measured**, however bad

## 5. What NOT to do

- Do not propose a PUT-bias, an IV filter, or any directional rule from the old numbers.
  They were produced by hindsight. There is nothing in them to keep.
- Do not "improve" the strategy to recover the old win rate. The old win rate was fake.
- Do not touch `backtest-tv/sell.js` in this task, though it likely shares the defect —
  file it as a separate finding.
- Do not commit or push unasked.

## 6. Expected outcome, stated in advance so nobody is disappointed

`docs/REVIEW-bt-real-lookahead.md` already shows directional buying failing at PF 0.84
**with** look-ahead. Once D1 is removed, expect `backtest-tv` to land in the same
region. **That is the point of the task.** The deliverable is a number you can trust,
not a number you like.
