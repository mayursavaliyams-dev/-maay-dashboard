# C1c · Step 1/7 — `instrument-registry.js` becomes the Universal Instrument Registry

| | |
|---|---|
| **Date** | 2026-07-09 |
| **Files changed** | `instrument-registry.js`, `test/instrument-registry.test.js` |
| **Engines changed** | **none** |
| **Backup** | `backups/migration-C1c-1-registry-20260709-174405/` (+ `ROLLBACK.sh`, `GIT_HEAD.txt` = `bbdd501`) |
| **Tests before** | 26/26 suites · `instrument-registry` **26** assertions |
| **Tests after** | **26/26 suites** · `instrument-registry` **68** assertions (+42) |

---

## Current state (before)

The registry knew three instruments and four attributes:

```js
const VERIFIED_LOT_SIZE = Object.freeze({ NIFTY: 65, BANKNIFTY: 30, SENSEX: 20 });
const VERIFIED_STEP     = Object.freeze({ NIFTY: 50, BANKNIFTY: 100, SENSEX: 100 });
const SEGMENT           = Object.freeze({ NIFTY: 'NSE_FNO', ... });
```

No tick size. No expiry type. No exchange. No FINNIFTY / MIDCPNIFTY / BANKEX.

## Requirement 1 — broker re-queried, nothing cached

`GET /v2/option/contract` was re-run live before any edit. Result (2026-07-09):

| inst | lot | tick_size | strike interval | expiry type | exch | broker segment | contracts | distinct lots |
|---|---|---|---|---|---|---|---|---|
| NIFTY | 65 | 5 | 50 | WEEKLY_AND_MONTHLY | NSE | NSE_FO | 1672 | 1 |
| BANKNIFTY | 30 | 5 | 100 | MONTHLY | NSE | NSE_FO | 1014 | 1 |
| FINNIFTY | **60** | 5 | 50 | MONTHLY | NSE | NSE_FO | 488 | 1 |
| MIDCPNIFTY | **120** | 5 | **25** | MONTHLY | NSE | NSE_FO | 792 | 1 |
| SENSEX | 20 | 5 | 100 | WEEKLY_AND_MONTHLY | BSE | BSE_FO | 3054 | 1 |
| BANKEX | 30 | 5 | 100 | MONTHLY | BSE | BSE_FO | 980 | 1 |

Exactly one distinct `lot_size` per instrument across its entire contract list.

### tickSize: paise, established by measurement — not assumed

`tick_size: 5` is ambiguous. It was resolved empirically against **429 live LTPs** across NSE and BSE:

- prices such as `1016.85`, `2239.05` are **not** multiples of `5.00` → the tick is not ₹5
- every fractional price has a paise remainder in `{5,10,…,95}`, all divisible by 5, and remainders of
  `.05` / `.75` / `.85` occur → the tick is **₹0.05**, not ₹0.10 and not ₹0.01

The registry therefore stores **both** `tickRaw: 5` (broker verbatim, paise) and `tickSize: 0.05` (rupees).
A call site never has to re-derive one from the other, so the ambiguity cannot recur.

## Problem this step had to solve

All three live engines gate on the same idiom:

```js
const lot = lotOf(inst);
if (!lot) return null;      // unknown contract size → refuse, do not guess
```
`agents-engine.js:511,623` · `gamma-blast-engine.js:104` · `strangle-engine.js:314`

**Naively adding FINNIFTY to the registry would have silently enabled trading on it** — precisely the
implicit widening requirement 5 forbids. `agents-engine.js:250` even uses `lotOf(i) != null` *as* its
whitelist, and `gamma-blast-engine.js:210` builds `status().lotSizes` from `instruments()`.

## Solution — a fail-closed trading surface

The module now has two surfaces. **Reading metadata is not permission to trade.**

| Surface | Functions | Answers for |
|---|---|---|
| **Trading** | `lotSize` `step` `strikeInterval` `tickSize` `tickRaw` `segment` `brokerSegment` `exchange` `expiryType` `getMeta` `instruments` | `tradingEnabled` instruments only — `null` otherwise |
| **Catalog** | `catalog` `allInstruments` `isTradingEnabled` | every known instrument, enabled or not |

Consequences, all verified by test:

- `lotSize('FINNIFTY')` is still `null` → **every engine behaves exactly as before**. Zero engine edits.
- `instruments()` still returns exactly `['BANKNIFTY','NIFTY','SENSEX']` → no whitelist widened.
- `catalog('FINNIFTY').lotSize === 60` → the verified metadata is available to preflight/reporting.
- Opt-in is explicit: `FINNIFTY_TRADING_ENABLED=true`. Only the exact string `"true"` enables;
  `"1"`, `"yes"`, `""` and garbage do not. Enabling logs a warning naming lot and step.

## Fields stored per instrument (requirement 3)

`exchange` · `segment` · `brokerSegment` · `lotSize` · `tickSize` · `tickRaw` · `strikeInterval` ·
`expiryType` · `tradingEnabled` · `lastVerifiedAt` · `verificationSource` (+ `underlyingKey`, `contractCount`)

### Two vocabularies for `segment`, deliberately

Upstox returns `NSE_FO` / `BSE_FO`. Dhan — and this codebase's `server.js` `INSTRUMENT_META` — uses
`NSE_FNO` / `BSE_FNO`. Both are right *for their own broker*. `segment` keeps the internal value
(backward compatible); `brokerSegment` records Upstox's. Storing a broker-specific string in shared
instrument metadata is a latent failover bug, and reconciling it is owned by roadmap **H3**, not this file.

### expiryType — post-SEBI reality

Only NIFTY (NSE) and SENSEX (BSE) still have weeklies. **BANKNIFTY, FINNIFTY, MIDCPNIFTY and BANKEX are
MONTHLY-only.** Any code assuming a weekly BANKNIFTY expiry is wrong today.

## Impact

| Area | Impact |
|---|---|
| Engine behaviour | **None.** Proven: `lotSize`/`step`/`instruments()` return identical values; all 26 suites pass with zero engine or existing-test edits. |
| API surface | Additive only. Every pre-migration export preserved; `getMeta()` is a superset of its old shape. |
| Database / dashboards | None. |
| Backward compatibility | **100%**, asserted. |

## Risk

Low. The one behavioural lever is `<INST>_TRADING_ENABLED`, which ships unset. The registry is
`Object.freeze`d at both levels (map and records), asserted by test, so nothing can mutate it at runtime.

## Test results

```
26/26 suites passed
test/instrument-registry.test.js — 68 assertions (was 26)
```

Coverage added for requirement 7: registry loading · lot-size lookup · tick-size lookup (paise vs rupees) ·
strike-interval lookup (incl. MIDCPNIFTY = 25) · tradingEnabled behaviour + explicit opt-in ·
unknown-instrument handling · drift detection on disabled instruments · backward-compat export check ·
provenance on every record.

One pre-existing assertion was **reworded, not weakened**: `lotSize('FINNIFTY') === null` used to be
labelled *"unknown instrument"*. FINNIFTY is now *known but disabled*, so the unknown-path assertions were
re-pointed at `NIFTYNEXT50`, a symbol the registry has genuinely never heard of. The two cases can no
longer be conflated.

## Files changed

| File | Change |
|---|---|
| `instrument-registry.js` | rewritten around a frozen `INSTRUMENTS` catalog; 6 instruments × 13 fields; trading/catalog split; `isTradingEnabled`; `verifyAgainstContracts` now works for disabled instruments |
| `test/instrument-registry.test.js` | +42 assertions |

Not committed: `package.json`, `bt-real.js` — both carry pre-existing, unrelated working-tree changes.

## Rollback plan

```bash
bash backups/migration-C1c-1-registry-20260709-174405/ROLLBACK.sh
```

No data file, ledger or runtime state is touched by this migration; rollback is total.
