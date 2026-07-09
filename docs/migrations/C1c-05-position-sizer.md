# C1c · Step 5/7 — `position-sizer.js` → Instrument Registry

| | |
|---|---|
| **Date** | 2026-07-09 |
| **Files changed** | `position-sizer.js`, `strangle-engine.js` (3 call sites), `test/position-sizer.test.js` |
| **Backup** | `backups/migration-C1c-5-sizer-20260709-183321/ROLLBACK.sh` (HEAD `9ab6a0e`) |
| **Tests** | 28/28 suites · position-sizer 54 → **63** assertions |

---

## Root cause — P3, not P1

`recommend()` **never received an `inst`**. `strangle-engine.js:254`, `:392` and `:393` all called it
without one. So a single global `lotSize: 75` and a single NIFTY `marginPerLotStrangle: 130000` were
applied to every instrument. The wrong constants were the *symptom*; the missing parameter was the
*cause*. Fixing `75 → 65` without passing `inst` would merely have relocated the guess.

## Impact (condor margin = `maxLossPerUnit × lotSize × 1.15`, floored at ₹12,000)

| Instrument | true lot | old margin | correct margin | over-estimate | affordable lots @ ₹10L |
|---|---|---|---|---|---|
| NIFTY | 65 | ₹15,094 | **₹13,081** | **+15.4%** | 39 → **45** |
| BANKNIFTY | 30 | ₹15,094 | **₹12,000** (floor) | **+25.8%** | 39 → **50** |
| SENSEX | 20 | ₹15,094 | **₹12,000** (floor) | **+25.8%** | 39 → **50** |

Over-estimated margin under-counts affordable lots, which **silently under-sizes the book**. The error
compounds: `strangle-engine.js:259` takes `Math.max(this.qtyPerLeg, sizing.recommendedLots)`.

## Fix

- `recommend({ inst, … })` resolves the lot via `instrumentRegistry.lotSize(inst)`.
- `DEFAULTS.lotSize` **deleted**. `cfg.lotSize` survives as an explicit, labelled escape hatch.
- **Fail-closed:** a CONDOR on an unknown or `tradingEnabled:false` instrument returns
  `recommendedLots: 0`, `marginPerLot: null` and a reason naming `<INST>_TRADING_ENABLED=true`.
  No lot is fabricated.
- Only the CONDOR path uses a lot size, so **STRANGLE remains fully backward compatible** and still works
  without `inst`.
- `strangle-engine` passes `inst` at the entry site. In `status()` there is no single instrument, so it
  passes the most-tracked one (`Object.keys(this._lastIv)[0]`) rather than defaulting to a guessed
  `'NIFTY'`; with nothing tracked yet the condor sizer refuses and says why.

### SPAN margin deliberately stays out of the registry

`marginPerLotStrangle` is an **exchange risk parameter that changes daily**, not broker contract metadata.
It does not belong in the Instrument Registry. But applying a NIFTY figure to SENSEX is an assumption, and
this codebase does not do silent assumptions. So:

- `SIZER_STRANGLE_MARGIN_<INST>` gives a per-instrument override
- every result now carries `marginSource`, which for the default literally reads
  `"global default (calibrated for NIFTY)"`

We do **not** scale it by lot ratio — margin tracks notional (spot × lot), and `recommend()` has no spot.
Any scaling would be invented.

## New provenance fields (additive)

`inst` · `lotSize` · `lotSource` (`'instrument-registry'` | `'cfg.lotSize'`) · `marginSource`

All 9 pre-migration fields are preserved and asserted.

## Still open (each needs its own commit)

- **P4** default strategy stats `0.9 / 2900 / -3500` are hardcoded fallbacks — a caller that forgets to
  pass stats gets a confident Kelly number from someone else's backtest.
- **P5** `minLot` forces ≥1 lot whenever one is affordable and `fracKelly > 0`.
- **P6** `R = |avgWin| / Math.max(1, |avgLoss|)` — the `max(1, …)` guard is a rupee-scale hack.
- Above the 25-lot cap, **IV scaling has no effect**: at ₹50L, `ivPct 0` and `ivPct 1` both return 25 lots.
  Found while writing the characterization suite, asserted in both directions.
- `.env.example:208` sets `SIZER_STRANGLE_MARGIN=150000` while the code default is `130000` — a
  config/code divergence, unrelated to lot sizing.

## Rollback

```bash
bash backups/migration-C1c-5-sizer-20260709-183321/ROLLBACK.sh
```
No persisted state is touched; sizing is computed fresh on every call.
