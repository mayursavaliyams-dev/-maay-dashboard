# C1c — Final Report: Instrument Registry adoption (requirement 12)

**Date:** 2026-07-09 · **Tests:** 30/30 suites · **Commits:** `c42f5ec` … `05362a9` (10)
**Verdict:** **5 of 6 production engines read instrument metadata exclusively from the Instrument Registry.** The sixth is requirement-9 protected. **27 duplicate sites remain outside the engines**, all enumerated below with an owner.

---

## 1. What was actually wrong

Every defect below was found by reading the code and verifying against the **broker contract master**, never by assumption. Each was fixed in its own commit, with a regression test that was proven to fail beforehand.

| # | Defect | Impact | Commit |
|---|---|---|---|
| 1 | `.env.example` shipped `NIFTY_LOT_SIZE=75`, `BANKNIFTY_LOT_SIZE=35`. These env keys **override** the verified registry in 3 consumers. | `cp .env.example .env` silently reverted the whole migration: P&L +15.4% / +16.7% | `c42f5ec` |
| 2 | `crash-analyzer.js`, `forward-test-logger.js`, `backtest-tv/run.js` were `require`d but never `git add`ed | **A fresh clone crashed at boot.** `Dockerfile COPY . .` hid it; a local build worked, a CI build never would | `bbdd501` |
| 3 | `pop-seller.js:18` `LOT_SIZE = {NIFTY:75, BANKNIFTY:35, FINNIFTY:65…}` + `\|\| 75` fallback | Paper P&L overstated. MIDCPNIFTY (true lot 120) priced at 75 | `d0558fd` |
| 4 | **`pop-seller.js:31` had the expiry weekdays exactly swapped** — NIFTY assumed Thursday, SENSEX Tuesday; broker says the opposite. It also assumed a weekly expiry for four MONTHLY-only instruments. | `T` feeds Black-Scholes. **BANKNIFTY at 5% OTM reported 100.0% PoP when the truth is 91.8%** | `6e9380a` |
| 5 | `pop-seller.js:51` `bsDelta` returned `±1` whenever `T<=0`, ignoring moneyness | A worthless deep-OTM call at expiry reported **PoP 0%** instead of 100%. Inverted | `8e5903d` |
| 6 | `position-sizer` **never received an `inst`** (`strangle-engine:254,392,393`), so one global `lotSize:75` sized every instrument | Condor margin over-estimated **+15.4% NIFTY, +25.8% SENSEX/BANKNIFTY** → silently **under-sized the book** | `0908896` |
| 7 | No mechanism existed to detect a stale registry | A registry that drifts is worse than none: every engine trusts it and no test fails | `62a8d6a` |
| 8 | `Math.round(spot/50)*50` inlined ≥12 times; `STEP` map triplicated | All wrong for MIDCPNIFTY (interval **25**): at spot 13030 they yield 13050, a **contract that does not exist** | `fddc540`, `05362a9` |

Defect 4 is the most serious thing found in this entire series. It silently inflated the single number `pop-seller` exists to produce, in the direction that makes a position look safer than it is.

## 2. Requirement 12 — measured, not asserted

Measured over **executable code only**, with a quote-aware comment stripper. (A naive one is wrong here: `free-chain.js:37` contains the string `'application/json, text/plain, */*'`, whose `*/*` reads as a block-comment open and blanks the rest of the file. My first two measurements were wrong for this reason and for CRLF; both are described in the commit history rather than quietly corrected.)

### A. Production engines — 5 / 6 compliant

| Engine | Reads registry | Hardcoded sites | Status |
|---|---|---|---|
| `strangle-engine.js` | yes | 0 | ✅ registry-exclusive |
| `agents-engine.js` | yes | 0 | ✅ registry-exclusive |
| `gamma-blast-engine.js` | yes | 0 | ✅ registry-exclusive |
| `pop-seller.js` | yes | 0 | ✅ registry-exclusive |
| `position-sizer.js` | yes | 0 | ✅ registry-exclusive |
| `execution-engine.js` | no | 0 | ⛔ receives lot/step as **constructor arguments from `server.js`** — both requirement-9 protected. Owner: **H3** |

### B. Duplicate market metadata remaining — 27 sites, all owned

| Module | Sites | Detail | Owner |
|---|---|---|---|
| `server.js` | **17** | `:252,:260` lotSize literals in `INSTRUMENT_META`; `:3121,:3286,:3420,:3479` execution-engine ctor args; `:934,:2468,:4145` step ternaries; `:1280,:1714,:1793,:2583,:2623,:7068` inline ATM rounding | **H3** (requirement-9 protected) |
| `live-connector.js` | 3 | `:279,:313,:363` inline ATM rounding | C1c-7b |
| `option-analyzer.js` | 3 | `:135,:642,:760` inline ATM rounding | C1c-7b |
| `free-chain.js` | 3 | `:93,:115,:148` inline ATM rounding | C1c-7b |
| `sensibull-fetcher.js` | 1 | `:102` inline ATM rounding | C1c-7b |
| `upstox-connector.js` | **0** | `STEP` map deleted, uses `strike-resolver` | ✅ done |

Two candidates were **rejected as false positives** rather than inflating the count: `server.js:4133` is `Number(req.query.minPoP || 75)`, a 75 % probability floor; `server.js:4783` is `lot: 1`, a display quantity.

**Requirement 12 is therefore not yet fully satisfied, and this report does not claim it is.** The engines are clean; the data-fetch layer and the `server.js` god-object are not.

## 3. The registry today

Six instruments × 14 broker-verified fields, `Object.freeze`d at both levels.

| inst | lot | tick (raw/₹) | step | expiry | expiryDow | exch | segment / brokerSegment | trading |
|---|---|---|---|---|---|---|---|---|
| NIFTY | 65 | 5 / 0.05 | 50 | WEEKLY_AND_MONTHLY | Tue | NSE | NSE_FNO / NSE_FO | **on** |
| BANKNIFTY | 30 | 5 / 0.05 | 100 | MONTHLY | Tue | NSE | NSE_FNO / NSE_FO | **on** |
| SENSEX | 20 | 5 / 0.05 | 100 | WEEKLY_AND_MONTHLY | Thu | BSE | BSE_FNO / BSE_FO | **on** |
| FINNIFTY | 60 | 5 / 0.05 | 50 | MONTHLY | Tue | NSE | NSE_FNO / NSE_FO | off |
| MIDCPNIFTY | 120 | 5 / 0.05 | **25** | MONTHLY | Tue | NSE | NSE_FNO / NSE_FO | off |
| BANKEX | 30 | 5 / 0.05 | 100 | MONTHLY | Thu | BSE | BSE_FNO / BSE_FO | off |

Design decisions worth restating:

- **Fail-closed.** The *trading surface* (`lotSize`, `step`, `tickSize`, `getMeta`, `instruments`) answers only for `tradingEnabled` instruments. The *catalog surface* (`catalog`, `allInstruments`, `isTradingEnabled`) exposes the verified metadata regardless. **Reading metadata is not permission to trade.** That is what let C1c-1 add three instruments while editing **zero engines** and changing **zero behaviour**.
- **`tickSize` was measured, not assumed.** `tick_size: 5` is ambiguous; 429 live LTPs across NSE and BSE proved it is **paise**. Both `tickRaw: 5` and `tickSize: 0.05` are stored so no call site re-derives it.
- **Two segment vocabularies are recorded on purpose.** Upstox says `NSE_FO`, Dhan and `server.js` say `NSE_FNO`. Both are right *for their own broker* — which is exactly why a broker-specific string must not live in shared instrument metadata. The day your mandated Dhan↔Upstox failover lands, that field is wrong for exactly one provider. Owner: **H3**.
- **SPAN margin deliberately stays out.** It is an exchange risk parameter that changes daily, not contract metadata.

## 4. Drift protection (requirement 15)

`registry-drift.js` compares registry vs broker on `lotSize`, `tickRaw`, `strikeInterval`, `expiryType`, for **all six** instruments including disabled ones. The network is injected, so the logic is unit-tested offline.

Live run:

```
✓ NIFTY   65/5/50/WEEKLY_AND_MONTHLY (1672)   ✓ BANKNIFTY 30/5/100/MONTHLY (1014)
✓ SENSEX  20/5/100/WEEKLY_AND_MONTHLY (3054)  ✓ FINNIFTY  60/5/50/MONTHLY (488)
✓ MIDCPNIFTY 120/5/25/MONTHLY (792)           ✓ BANKEX    30/5/100/MONTHLY (980)
registry agrees with the broker on all 6 instruments      exit 0
```

Crucially, **a broker outage is not agreement**: a fetch failure or empty contract list is counted as `errored`, exits `2`, and never reports `ok`. `npm run preflight:registry` needs no server. Requirement 9 was honoured — no `server.js` boot hook was added.

## 5. Test coverage delta

| Suite | Before C1c | After |
|---|---|---|
| total suites | 23 | **30** |
| `instrument-registry` | 26 | 88 |
| `pop-seller` | **0** | 111 |
| `position-sizer` | **0** | 63 |
| `strike-resolver` | — | 55 |
| `registry-drift` | — | 25 |
| `repo-integrity` | — | 7 |
| `env-example` | — | 13 |

Two modules that decide money went from **zero tests** to 174 assertions between them.

## 6. Mistakes made and corrected (recorded, not hidden)

- My first expected ATM call delta (`0.5326`) was wrong; the module was right (`0.5579` — the 6.5% drift lifts it above 0.50). Test fixed, code untouched.
- I wrote an assertion `x !== x || true`, which can never fail. Deleted — a tautological test is worse than none.
- My monotonicity assertion for IV scaling failed because at ₹50L capital both ends saturate the 25-lot cap. The module was right; the test was wrong. That failure **surfaced a real blind spot**, now asserted in both directions.
- I committed C1c-6 with a red suite because my shell gate `grep -E "FAILED"` *succeeded* when it found the word "FAILED". The commit was reset and redone gated on **exit code**. `repo-integrity` had correctly caught a tracked file requiring an untracked one — the guard from `bbdd501` doing exactly its job.
- The same amend swept in an unrelated `package.json` line. Undone; only the `preflight:registry` script was committed.

## 7. Open items, each needing its own commit

**Correctness**
- `pop-seller` `buildIronCondor` returns **two short legs and no wings** — a short strangle with unbounded loss and no `maxLoss` field, under a name that promises defined risk.
- `combinedPoP = popCE × popPE` assumes the two breaches are independent; spot cannot pierce both sides, so it **understates** true PoP.
- `closePoP` applies **no transaction charges**, while three other engines use `charges.js`.
- `position-sizer` P4 (hardcoded default strategy stats), P5 (`minLot` forces ≥1 lot), P6 (`Math.max(1, |avgLoss|)` rupee-scale hack), and IV scaling being **completely masked above the 25-lot cap**.
- `pop-seller._book` is module-global and unpersisted.
- `.env.example:208` sets `SIZER_STRANGLE_MARGIN=150000`; the code default is `130000`.

**Security (C2)**
- `Dockerfile:11` `COPY . .` copies untracked **and gitignored** files into the image — a developer's `.env`, with live broker tokens, can be baked into a container layer.

**Architecture (H3)**
- `server.js` `INSTRUMENT_META` / `PS_INSTS`, `execution-engine` constructor args, and the `NSE_FNO` vs `NSE_FO` split. The adapter must own its own vocabulary. **Requires separate approval to touch `server.js`.**
