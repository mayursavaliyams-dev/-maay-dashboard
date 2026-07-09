# Registry Validation Report — C1c-1

**Generated:** 2026-07-09 · **Source:** `GET https://api.upstox.com/v2/option/contract` (re-queried live, requirement 1)
**Verdict:** registry validated ✅ · **repository-wide single-source-of-truth: NOT yet achieved ❌**

---

## 1. Registry contents vs broker contract master

| Instrument | Field | Registry | Broker | Match |
|---|---|---|---|---|
| NIFTY | lot / tick / step / expiry / exch / seg | 65 / 5 / 50 / WEEKLY_AND_MONTHLY / NSE / NSE_FO | identical | ✅ |
| BANKNIFTY | | 30 / 5 / 100 / MONTHLY / NSE / NSE_FO | identical | ✅ |
| SENSEX | | 20 / 5 / 100 / WEEKLY_AND_MONTHLY / BSE / BSE_FO | identical | ✅ |
| FINNIFTY | | 60 / 5 / 50 / MONTHLY / NSE / NSE_FO | identical | ✅ |
| MIDCPNIFTY | | 120 / 5 / 25 / MONTHLY / NSE / NSE_FO | identical | ✅ |
| BANKEX | | 30 / 5 / 100 / MONTHLY / BSE / BSE_FO | identical | ✅ |

Exactly one distinct `lot_size` per instrument across 1672 / 1014 / 3054 / 488 / 792 / 980 contracts.

### tickSize resolution (measured, not assumed)
`tick_size: 5` is **paise**. Verified against 429 live LTPs on NSE and BSE: prices like `1016.85` and
`2239.05` are not multiples of `5.00`; every fractional price's paise remainder lies in `{5,…,95}` and is
divisible by 5. Stored as `tickRaw: 5` **and** `tickSize: 0.05`.

### Coverage matrix

| Instrument | lot | tick | strike interval | expiry type | exchange | segment | tradingEnabled |
|---|---|---|---|---|---|---|---|
| NIFTY | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **true** |
| BANKNIFTY | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **true** |
| SENSEX | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **true** |
| FINNIFTY | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | false |
| MIDCPNIFTY | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | false |
| BANKEX | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | false |
| Stock options | ❌ not in registry | | | | | | — |
| Futures | ❌ not covered by `/option/contract`; needs the instrument-master file | | | | | | — |

## 2. Conflicts the registry now exposes

| Site | Declares | Broker says | Consequence |
|---|---|---|---|
| `pop-seller.js:18` | `FINNIFTY: 65` | **60** | paper P&L overstated **+8.3%** — still live, fixed in **C1c-3** |
| `pop-seller.js:18` | `NIFTY: 75`, `BANKNIFTY: 35` | 65 / 30 | +15.4% / +16.7% — still live, fixed in **C1c-3** |
| `position-sizer.js:25` | `lotSize: 75` for every instrument | 65/30/20 | condor margin over-estimated ~15% (NIFTY) and ~275% (SENSEX) — fixed in **C1c-5** |
| everywhere | MIDCPNIFTY absent | lot 120, step **25** | any inlined `Math.round(spot/50)*50` mis-rounds it |
| `server.js` `INSTRUMENT_META` | `segment: 'NSE_FNO'` | `NSE_FO` | both valid per-broker; a **failover landmine** — owned by **H3** |

`verifyAgainstContracts()` now works for disabled instruments, so `preflight` (C1c-6) can validate all six.
Demonstration, asserted in test: had the registry carried pop-seller's `FINNIFTY: 65`, the drift alarm
would fire (`expected 65, broker 60`).

## 3. Requirement 12 — repository-wide confirmation

> *"Confirm that every engine now reads instrument metadata exclusively from the Instrument Registry and that no duplicate market metadata remains elsewhere."*

**It does not, and I will not claim otherwise.** C1c-1 built the source of truth; it did not migrate the
remaining consumers, which requirement 11 explicitly scoped out of this step.

Measurement below is over **executable code only** (comments excluded via a quote-aware stripper — a naive
one is wrong here, because `free-chain.js:37` contains the string `'application/json, text/plain, */*'`,
whose `*/*` reads as a block-comment open and blanks the rest of the file).

### A. Production engines

| Engine | Reads registry | Hardcoded sites | Status |
|---|---|---|---|
| `strangle-engine.js` | yes | 0 | ✅ **registry-exclusive** |
| `gamma-blast-engine.js` | yes | 0 | ✅ **registry-exclusive** |
| `agents-engine.js` | yes | 1 | ⚠️ partial — `:607` `Number(chain.step) \|\| (inst === 'NIFTY' ? 50 : 100)` |
| `pop-seller.js` | **no** | 3 | ❌ `:18` lot map · `:19` `\|\| 75` · `:22` step map |
| `position-sizer.js` | **no** | 1 | ❌ `:25` `lotSize: 75` |
| `execution-engine.js` | **no** | 0 | ❌ receives lot/step as constructor args from `server.js` |

**2 of 6 engines are registry-exclusive.**

### B. Duplicate market metadata remaining in other production modules — 25 sites

| Module | Sites | Detail |
|---|---|---|
| `server.js` | **15** | `:252`,`:260` `lotSize` literals in `INSTRUMENT_META`; `:3121`,`:3286`,`:3420`,`:3479` execution-engine ctor args; `:934`,`:2468`,`:4145` inline step ternaries; `:1280`,`:1714`,`:1793`,`:2583`,`:2623`,`:7068` inline ATM rounding |
| `live-connector.js` | 3 | `:279`,`:313`,`:363` inline ATM rounding |
| `option-analyzer.js` | 3 | `:135`,`:642`,`:760` inline ATM rounding |
| `free-chain.js` | 3 | `:93`,`:115`,`:148` inline ATM rounding |
| `upstox-connector.js` | 1 | `:28` `STEP = { NIFTY:50, BANKNIFTY:100, SENSEX:100 }` |
| `sensibull-fetcher.js` | 1 | `:102` inline ATM rounding |

Two candidates were **rejected as false positives** after inspection, rather than inflating the count:
`server.js:4133` is `Number(req.query.minPoP || 75)` — a 75 % probability floor, not a lot size — and
`server.js:4783` is `lot: 1`, a display quantity. Requirement 12 is about accuracy, not a high score.

### C. Path to satisfying requirement 12

| Step | Closes |
|---|---|
| **C1c-3** `pop-seller` → registry | 3 sites; kills the FINNIFTY +8.3 % error and the `\|\| 75` fallback |
| **C1c-5** `position-sizer` → per-call `lotSize` | 1 site; fixes the SENSEX margin error |
| **C1c-7** `strike-resolver.js` | 12 inline ATM-rounding sites + 3 step ternaries + `upstox-connector:28` |
| **H3** Universal Market Data Layer | `server.js` `INSTRUMENT_META` / `PS_INSTS`, `execution-engine` ctor args, and the `NSE_FNO` vs `NSE_FO` split — the adapter owns its own vocabulary |

`server.js`, `INSTRUMENT_META`, `PS_INSTS` and `execution-engine.js` remain **requirement-9 protected** and
were not touched. Their *values* are correct; their sin is duplication.

## 4. Anti-widening verification (requirement 5)

Measured after the change, with no engine edited:

```
instruments()             = ["BANKNIFTY","NIFTY","SENSEX"]      ← unchanged
lotSize NIFTY/BN/SENSEX   = 65 30 20                            ← unchanged
lotSize FINNIFTY          = null   (engines refuse to open)
lotSize MIDCPNIFTY        = null
lotSize BANKEX            = null
catalog('FINNIFTY').lotSize = 60   (metadata available, trading not)
```

Files verified untouched: `agents-engine.js`, `gamma-blast-engine.js`, `strangle-engine.js`,
`pop-seller.js`, `position-sizer.js`, `server.js`, `execution-engine.js`, `charges.js`,
`upstox-connector.js`, `live-connector.js`.

## 5. Test report

```
26/26 suites passed
test/instrument-registry.test.js — 68 assertions (was 26, +42)
```
