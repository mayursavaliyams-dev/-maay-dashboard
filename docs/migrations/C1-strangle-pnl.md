# Migration C1 + C1a — `strangle-engine` P&L correction

| | |
|---|---|
| **Date** | 2026-07-09 |
| **Modules changed** | `strangle-engine.js` (only) |
| **Modules added** | `instrument-registry.js`, `test/instrument-registry.test.js`, `test/strangle-engine.test.js` |
| **Modules NOT touched** | everything else — including `execution-engine`, `server.js`, `agents-engine`, `gamma-blast-engine`, `charges.js`, `position-sizer.js` |
| **Approved strategy** | Option A — legacy preservation + forward-only correct calculation |
| **Backup** | `backups/migration-C1-20260709-075048/` (code + `data/strangle-*.json` + `GIT_HEAD.txt` + `ROLLBACK.sh`) |
| **Baseline tests** | 21/21 suites |
| **Post-migration tests** | **23/23 suites** (2 new: `instrument-registry` 26 asserts, `strangle-engine` 72 asserts) |

---

## C1 — P&L was computed without the contract multiplier or transaction costs

### Root cause
`strangle-engine.js` closed a trade with:

```js
const pnlAbs = +(pnlPerUnit * pos.qty).toFixed(2);   // qty is LOTS
```

`qty` is a **lot count**, not a unit count. The contract multiplier (`lotSize`) was never applied, and **no transaction costs were subtracted**. Every other engine does both:

```js
// gamma-blast-engine.js:116-118        agents-engine.js:522-525
const units   = pos.qty * pos.lot;      const units   = pos.qty * pos.lot;
const gross   = (exit - entry) * units; const charges = roundTripCharges(...).total;
const ch      = roundTripCharges(...);  const pnl     = gross - charges;
```

**Effect:** strangle ₹P&L was understated by the lot multiplier (65× NIFTY, 30× BANKNIFTY, 20× SENSEX) and reported **gross of costs**, making it non-comparable to the engines sharing the same dashboard. The whole VRP thesis is cost-sensitive.

### Lot size — resolved from the broker, not from memory
Six sources in the tree disagreed (some said NIFTY 65 / BANKNIFTY 30, others 75 / 35). Rather than pick one, the broker's own contract master was queried read-only:

```
GET https://api.upstox.com/v2/option/contract?instrument_key=<index>

NIFTY      lot_size = 65    (1672 contracts, single distinct value)
BANKNIFTY  lot_size = 30    (1014 contracts, single distinct value)
SENSEX     lot_size = 20    (3054 contracts, single distinct value)
```

These values now live in **`instrument-registry.js`** with the provenance recorded in code. `verifyAgainstContracts()` re-checks the registry against a live contract list and reports drift.

> The 75/35 values in `agents-engine.js:29`, `gamma-blast-engine.js:28`, `pop-seller.js:18`, `position-sizer.js:25` and `.env.example:161-163` are **wrong** and overstate those engines' P&L (+15.4% NIFTY, +16.7% BANKNIFTY). **Deliberately NOT changed here** — logged as migration **C1b**.

### Fix (v2)
```js
units   = qty × lotSize                       // lotSize from instrument-registry
gross   = pnlPerUnit × units
charges = Σ over legs: roundTripCharges(leg.entry, leg.ltp, units).total
pnlAbs  = gross − charges
```
Charges use the **identical per-leg method as `agents-engine._closeCondor`** (`agents-engine.js:596-601`) so the two engines' ₹ figures stay directly comparable.

If `lotSize` is unknown for an instrument, the engine **does not guess** — it retains the legacy math and flags the record `calcVersion: 1`, `calcMethod: 'v1-fallback…'`.

### Legacy preservation (approved Option A)
- Historical records in `data/strangle-trades.json` are **never rewritten** — verified byte-identical after migration.
- Pre-migration records carry no `calcVersion` → **v1 by definition**.
- New records carry `calcVersion: 2`, corrected `pnlAbs`, **and `pnlAbsLegacy`** (exactly what v1 would have produced), plus `gross`, `charges`, `lot`, `units`, `qty`, `calcMethod`.
- `status().allTime.calc` splits **legacy vs current**, exposes v2 gross + charges, and carries a `note` warning that raw `allTime.netPnl` is a mixed sum while `mixed === true`.
- Every v2 close appends one line to **`data/migrations/C1-strangle-pnl.jsonl`**: `{ts, migration, inst, structure, expiry, reasonForExit, legacyPnl, newPnl, gross, charges, qty, lot, units, calculationMethod, calcVersion, reasonForChange}`.

### Backward compatibility
Every pre-existing field of `status()` and `status().allTime` is still present and unchanged in meaning. `allTime.netPnl` remains the raw sum of `pnlAbs` (verified: still `−44.50` across the 7 legacy trades). All new information is **additive**.

### Known limitation (engine-wide, pre-existing, not introduced here)
`charges.roundTripCharges` models a **long** option (STT on the sell leg, stamp on the buy leg). For a **short** structure the opening leg is the sell. We reuse the exact method `agents-engine` already uses so the engines remain comparable; correcting the STT/stamp side is a separate, engine-wide change.

---

## C1a — `/api/strangle/status` returned HTTP 500 (pre-existing, uncommitted)

### Root cause
`forward-test-logger.js:154` exports a **class**. `strangle-engine.js` assigned the constructor itself:

```js
this._ftLogger = require('./forward-test-logger.js');   // ← the CLASS
this._ftLogger.status()      // TypeError: not a function  → HTTP 500
this._ftLogger.logTrade(...) // also threw — into a silent `catch (_) {}`
```

`git show HEAD:strangle-engine.js` contains **zero** matches for `_ftLogger` — these three lines were an **uncommitted, untested working-tree change** from an earlier session.

### Impact (both live at time of discovery)
1. `GET /api/strangle/status` returned **HTTP 500 on every call**; the dashboard's *Positions & P&L verification* panel silently lost its open-condor rows.
2. `logTrade()` threw into `catch (_) {}` → **`data/forward-test/` was empty; no strangle trade was ever recorded to the forward-test shard.**

### Fix (minimal — one statement, no refactoring)
```js
const ForwardTestLogger = require('./forward-test-logger.js');
this._ftLogger = new ForwardTestLogger();
```
Constructing is side-effect-free unless `FORWARD_TEST_DATE_FROM` is set.

### Regression guard
`test/strangle-engine.test.js` now asserts `_ftLogger instanceof ForwardTestLogger`, that it is **not** the class itself, that `status()` does not throw, that `status().forwardTest` is a plain object carrying `enabled`, and that `logTrade()` does not throw.

---

## Verification performed

| Requirement | Evidence |
|---|---|
| Full backup before migration | `backups/migration-C1-20260709-075048/` |
| Rollback supported | `backups/…/ROLLBACK.sh` + `GIT_HEAD.txt` (`58f7a77`) |
| Historical data preserved | `cmp` → `data/strangle-trades.json` **byte-identical** |
| Complete test suite after change | **23/23 suites** (baseline 21/21) |
| No unrelated functionality affected | `GET /api/strangle/status` → **HTTP 200**; all 12 legacy response fields present; `allTime.netPnl` still `−44.50` / 7 trades |
| Reports label legacy vs new | `status().allTime.calc.{legacy,current,mixed,note}`; `pnlCalcVersion`, `pnlCalcMethod` |
| No silent changes / hidden assumptions | lot size taken from the broker contract master, not memory; unknown instruments flagged rather than defaulted; the 75/35 discrepancy reported, not silently "fixed" |
| Boot log clean | `TypeError` count **0** (was 5+) |

## Rollback

```bash
git checkout 58f7a77882f2d4e5326ea5ed54e4395593ccdbef -- strangle-engine.js
rm -f instrument-registry.js test/instrument-registry.test.js test/strangle-engine.test.js
cp -p backups/migration-C1-20260709-075048/data/*.json data/
```
Rolling back restores the v1 formula. Any `calcVersion: 2` records already written remain on disk and are simply re-read as ordinary trades (their `pnlAbs` would then be a v2 number under v1 code) — if a rollback is ever performed **after** v2 trades exist, also truncate those records using `data/migrations/C1-strangle-pnl.jsonl` as the authority.

## Follow-up filed

**C1b (CRITICAL)** — correct the wrong lot maps (`75/35`) in `agents-engine.js:29`, `gamma-blast-engine.js:28`, `pop-seller.js:18`, `position-sizer.js:25`, `.env.example:161-163` to consume `instrument-registry.js`. Their P&L is currently overstated **+15.4% (NIFTY)** and **+16.7% (BANKNIFTY)**. `server.js` (`INSTRUMENT_META`, `PS_INSTS`) and `execution-engine` are already **correct** and must **not** be changed.
