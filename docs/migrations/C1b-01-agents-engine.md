# C1b · Module 1/5 — `agents-engine.js`

| | |
|---|---|
| **Date** | 2026-07-09 |
| **Module changed** | `agents-engine.js` (only) |
| **Tests changed** | `test/agents-engine.test.js` (regression block appended) |
| **Backup** | `backups/migration-C1b-1-agents-20260709-081606/` (+ `ROLLBACK.sh`, `GIT_HEAD.txt` = `25b4be1`) |
| **Tests before** | 23/23 suites · `agents-engine` **59** assertions |
| **Tests after** | 23/23 suites · `agents-engine` **102** assertions (+43) |

---

## Root cause

```js
const LOT = { NIFTY: 75, BANKNIFTY: 35, SENSEX: 20 };   // agents-engine.js:29 — WRONG
...
lot: LOT[inst] || 75                                     // :494, :568 — silent fallback
maxLossDefined: ... * (LOT[inst] || 75) - credit * (LOT[inst] || 75)   // :570
this.instruments = ....filter(i => LOT[i]);              // :232 — LOT doubled as a whitelist
```

The broker contract master (`GET /v2/option/contract`) reports **NIFTY 65, BANKNIFTY 30, SENSEX 20**.
P&L in this module is `units = qty × lot`, and the formula was always correct — only the
**constant** was wrong. Realized ₹P&L was therefore **overstated**:

| Instrument | Wrong lot | True lot | Overstatement |
|---|---|---|---|
| NIFTY | 75 | 65 | **+15.4%** |
| BANKNIFTY | 35 | 30 | **+16.7%** |
| SENSEX | 20 | 20 | none |

## Smallest change that fixes the root cause

- Deleted the hardcoded `LOT` map; added `const lotOf = (inst) => instrumentRegistry.lotSize(inst)`.
- `this.instruments` whitelist now filters on `lotOf(i) != null` (the registry *is* the whitelist).
- `_enter` / `_enterCondor` obtain the lot dynamically and **refuse to open** (`return null`) when the
  registry does not know the instrument. **No `|| 75` fallback. No guessing.**
- `maxLossDefined` is now derived from `units = qty × lot` instead of inlining the lot twice.
- No other logic touched. `_close` / `_closeCondor` already used `pos.lot` and were left alone.

## Legacy preservation (approved protocol)

There is a genuine tension between **requirement 3** ("never hardcode 75/35") and **requirement 11**
("`pnlLegacy` + `calcVersion`"). Here the *formula* never changed — only the *constant* — so producing a
`pnlLegacy` for a **new** trade would require re-introducing the wrong `75` to compute a counterfactual.

**Resolution — no invented numbers:**

| Case | Handling |
|---|---|
| Historical closed trades | **Never rewritten.** They already embed the `lot` they were opened with, so they are self-documenting. Verified: the original 13 records survive as an unmodified prefix. |
| Position opened **before** the migration (restored from `ai-agents-open.json` with `lot: 75`) | Closed on **its stored lot** — re-lotting mid-position would change the entry basis. Marked `calcVersion: 1`, `lotSource: 'legacy-open-position'`, and `pnlLegacy = pnl` (its P&L genuinely *is* the legacy value). |
| Position opened **after** the migration | `lot` from the registry, `calcVersion: 2`, `lotSource: 'instrument-registry'`, `pnlLegacy: null` — no legacy counterpart exists. |

`status().allTime.calc` splits `legacy` vs `current`, sets `mixed`, and carries a `note` warning that the
raw `allTime.netPnl` is a mixed sum. `status()` also now advertises `lotSource` and the live `lotSizes`.

## Backward compatibility

Every pre-existing field of `status()` and `status().allTime` is present and unchanged in meaning
(9 + 6 fields asserted). All additions are purely additive.

## False positive corrected

`agents-engine.js:603` — `charges = 4 * 65 * pos.qty` — was flagged by the requirement-14 scan as a
hardcoded lot size. **It is not.** It is `4 legs × ₹65 charge-per-leg × lots`, a rupee **cost** fallback
inside a `catch`. Left untouched (smallest-change rule); annotated in place and corrected in
`C1b-lot-size-inventory.md`.

## Verification

| Requirement | Evidence |
|---|---|
| 1 · Backup + rollback | `backups/migration-C1b-1-agents-20260709-081606/ROLLBACK.sh` |
| 2 · Registry is the single source | `status().lotSource === 'instrument-registry'`; `lotSizes = {NIFTY:65, SENSEX:20, BANKNIFTY:30}` |
| 3 · No hardcoded lot sizes | Source-level assertions: no `LOT[`, no `const LOT = {`, no `lot: <literal>`, no `\|\| 75` in executable code |
| 4 · Dynamic lot | `_enter` / `_enterCondor` call `lotOf(inst)`; unknown → `null` (refuse) |
| 5 · Regression tests | +43 assertions, incl. *"unknown instrument → \_enter refuses (no `\|\| 75` guess)"* |
| 6 · Complete suite | **23/23 suites** |
| 8 · Unexpected behaviour | Two halts raised and cleared: assertion count 60→59 (stale baseline — `HEAD` is 59) and ledger diff (**live server appended 1 record; original 13 preserved as an unmodified prefix**) |
| 9 · Forbidden files | `git diff --quiet HEAD` → `server.js` ✓ untouched, `execution-engine.js` ✓ untouched |
| 10 · Backward compatible | 15 field-presence assertions |
| 11 · Legacy preserved | `calcVersion` / `lotSource` / `pnlLegacy` as tabled above |

## Rollback

```bash
bash backups/migration-C1b-1-agents-20260709-081606/ROLLBACK.sh
git checkout HEAD -- test/agents-engine.test.js
```
Positions opened after the migration carry `lot: 65` + `calcVersion: 2`; under rolled-back code they
would close on their stored `lot: 65`, which remains the correct contract size.
