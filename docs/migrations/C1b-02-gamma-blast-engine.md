# C1b · Module 2/5 — `gamma-blast-engine.js`

| | |
|---|---|
| **Date** | 2026-07-09 |
| **Module changed** | `gamma-blast-engine.js` (only) |
| **Tests added** | `test/gamma-blast-engine.test.js` — **the module's first test suite**, 36 assertions |
| **Backup** | `backups/migration-C1b-2-gamma-20260709-082725/` (+ `ROLLBACK.sh`, `GIT_HEAD.txt` = `70596d7`) |
| **Tests before** | 23/23 suites · gamma-blast-engine **untested** |
| **Tests after** | **24/24 suites** · gamma-blast-engine **36 assertions** |

## Root cause
```js
const LOT = { NIFTY: 75, BANKNIFTY: 35, SENSEX: 20 };   // :28 — WRONG
const lot = LOT[inst] || 75;                             // :86 — silent fallback
```
Broker contract master reports **NIFTY 65 · BANKNIFTY 30 · SENSEX 20**. P&L is
`units = qty × lot` (`_close`), so realized ₹P&L was **overstated +15.4% (NIFTY) / +16.7%
(BANKNIFTY)**. The formula was always correct; only the constant was wrong.

The single historical record on disk is `NIFTY lot=75` → its P&L is overstated 15.4%. It is
**preserved unmodified** and classified `legacy` by `_calcBreakdown`.

## Smallest change
- `LOT` map deleted; `lotOf(inst)` delegates to `instrument-registry`.
- Open path: `const lot = lotOf(inst); if (!lot) return;` — **refuses to open** for an unknown
  instrument. No `|| 75`, no guessing.
- Positions stamped `lotSource` + `calcVersion: 2`.
- `_close` unchanged in arithmetic (`units = pos.qty * pos.lot` was already right); it now also
  records `calcVersion` / `lotSource` / `pnlLegacy` via the shared `_closeCalcMeta`.
- `status().allTime.calc` splits legacy vs current; `status()` advertises `lotSource` + `lotSizes`.

## Legacy preservation
Identical to module 1. Historical trades are never rewritten (they embed their own lot).
A position opened before the migration closes on **its stored lot**, marked `calcVersion: 1`,
`lotSource: 'legacy-open-position'`, `pnlLegacy = pnl`. New positions are `calcVersion: 2` with
`pnlLegacy: null` — no invented counterfactual, so no `75` is re-introduced (requirement 3).

## Verification
| Requirement | Evidence |
|---|---|
| 1 · Backup + rollback | `backups/migration-C1b-2-gamma-20260709-082725/ROLLBACK.sh` |
| 2/4 · Registry is the source | `status().lotSource === 'instrument-registry'`; `lotSizes = {65,30,20}` |
| 3 · No hardcoded lots | Source-level guards over comment-stripped code: no `LOT[`, no `const LOT = {`, no `\|\| 75`, no `lot = <literal>` |
| 5 · Regression tests | First suite for this module: 36 assertions, incl. `pnl = (exit−entry) × qty × 65 − charges` |
| 6 · Complete suite | **24/24 suites** |
| 9 · Forbidden files | `server.js` ✓, `execution-engine.js` ✓ untouched |
| 10 · Backward compatible | 8 `status()` + 2 `allTime` field assertions |
| 11 · Legacy preserved | 1 historical record verified as an unmodified prefix |

## Rollback
```bash
bash backups/migration-C1b-2-gamma-20260709-082725/ROLLBACK.sh
rm -f test/gamma-blast-engine.test.js
```
