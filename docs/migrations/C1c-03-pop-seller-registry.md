# C1c · Step 3/7 — `pop-seller.js` → Instrument Registry

| | |
|---|---|
| **Date** | 2026-07-09 |
| **Files changed** | `pop-seller.js`, `test/pop-seller.test.js` |
| **Backup** | `backups/migration-C1c-3-popseller-20260709-181706/` (+ `ROLLBACK.sh`, `GIT_HEAD.txt` = `9fbe321`) |
| **Tests before** | 27/27 suites · `pop-seller` 87 assertions |
| **Tests after** | **27/27 suites** · `pop-seller` **103** assertions (+16) |

---

## Root cause

```js
const LOT_SIZE = { NIFTY: 75, BANKNIFTY: 35, SENSEX: 20, FINNIFTY: 65, BANKEX: 30 };  // :18
function lotSize(inst) { return LOT_SIZE[inst] || 75; }                              // :19
const STEP     = { NIFTY: 50, BANKNIFTY: 100, SENSEX: 100, FINNIFTY: 50, BANKEX: 100 }; // :22
function strikeStep(inst) { return STEP[inst] || 50; }                               // :23
```

The broker contract master reports **65 / 30 / 20 / 60 / 30**. Every rupee figure this module emits is
`premium × lot` — `maxProfit`, `creditCollected`, and realised paper `pnl`. The constants were simply wrong,
and the `|| 75` fallback priced **any** unknown symbol at 75.

## Smallest change

Both maps deleted. `lotSize()` and `strikeStep()` now delegate to `instrument-registry`. **No fallback.**
Four call sites learned to refuse:

| Site | Before | After |
|---|---|---|
| `generateStrikes` | `Math.round(spot/step)*step` with `step = 50` | `{strikes: [], atm: null}` when step is null |
| `scanPoP` | emitted `premium × 75` candidates | returns `[]` |
| `buildIronCondor` | built a condor at lot 75 | returns `null` |
| `payoffCurve` | `pnl × null` → **flat-zero curve that looks plausible** | returns `[]` |
| `sellPoP` | opened a position at lot 75 | `{ok:false, reason:'… Set FINNIFTY_TRADING_ENABLED=true …'}` |

`sellPoP` now also records `lotSource: 'instrument-registry' | 'caller-supplied'`, so every position
documents where its contract size came from.

## Measured impact

| Instrument | Old lot | New lot | Effect on every rupee figure |
|---|---|---|---|
| NIFTY | 75 | **65** | **−13.3%** (corrects a +15.4% overstatement) |
| BANKNIFTY | 35 | **30** | **−14.3%** (corrects +16.7%) |
| SENSEX | 20 | 20 | unchanged |
| FINNIFTY | 65 | **refused** | registry knows it (lot 60) but ships `tradingEnabled:false` |
| BANKEX | 30 | **refused** | same |
| MIDCPNIFTY | 75 *(fabricated)* | **refused** | true lot is 120 — was off by −37.5% |

**This is requirement 4 working as designed.** The +8.3% FINNIFTY error is killed by *refusing to trade*
rather than by trading at a corrected size. Opting in (`FINNIFTY_TRADING_ENABLED=true`) yields the
broker-verified **60**, never the old hardcoded 65 — asserted by test.

## Backward compatibility with `server.js` (requirement-9 protected, untouched)

All four call sites smoke-tested exactly as `server.js` invokes them:

```
/api/pop/scan   NIFTY     39 candidates, lot 65, ironCondor maxProfit 8260
/api/pop/payoff NIFTY     41 curve points
/api/pop/payoff FINNIFTY   0 curve points   (refused, not a flat-zero lie)
/api/pop/sell   NIFTY     ok:true  lot 65  credit 2600
/api/pop/sell   FINNIFTY  ok:false → HTTP 403 with an actionable reason
/api/pop/status ok
```

### Two deliberate behaviour changes, stated plainly

1. `POST /api/pop/sell` with a disabled instrument now returns **403** instead of **200 + a position**.
   `server.js:4183` already maps `result.ok` to the status code, so no server change was needed.
2. `GET /api/pop/scan?inst=FINNIFTY` returns **0 candidates** instead of garbage. Previously
   `getInstrumentMeta('FINNIFTY')` silently fell back to **SENSEX** for spot and chain
   (`server.js:276`), while `inst` stayed `'FINNIFTY'` — so the route scanned a **SENSEX spot near 80,000
   against FINNIFTY's lot 65 and strike step 50** and returned it as JSON. That output was never
   meaningful. Refusing is strictly better. (The underlying `getInstrumentMeta` fallback is a `server.js`
   defect and remains unfixed — requirement 9.)

## Not fixed here (separate defects, separate commits)

- **D4** `daysToExpiry` has NIFTY/SENSEX expiry weekdays **swapped** → every PoP is wrong. → **C1c-3a**
- **D5** `bsDelta` returns `±1` at `T<=0` regardless of moneyness → PoP inverted at expiry. → **C1c-3a**
- **D6** `buildIronCondor` is a short strangle with no wings and no `maxLoss`. → backlog
- **D7** `combinedPoP = popCE × popPE` assumes independence. → backlog
- **D8** `_book` is module-global, unpersisted. → backlog
- `closePoP` applies **no transaction charges** (`charges.js` exists and is used by three other engines).

## Test results

```
27/27 suites passed
test/pop-seller.test.js — 103 assertions (was 87)
```

Source-level guards assert the old constants cannot return: no `const LOT_SIZE = {`, no `const STEP = {`,
no `|| 75`, no `|| 50` in executable code, and `require('./instrument-registry')` present.

## Rollback

```bash
bash backups/migration-C1c-3-popseller-20260709-181706/ROLLBACK.sh
```
Open paper positions carry `lot: 65` and `lotSource`; under rolled-back code they close on their stored
`pos.lot`, which remains the correct contract size. No history is rewritten.
