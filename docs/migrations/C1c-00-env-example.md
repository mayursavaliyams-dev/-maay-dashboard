# C1c · Step 0/7 — `.env.example` lot-size neutralisation

| | |
|---|---|
| **Date** | 2026-07-09 |
| **Files changed** | `.env.example` (only) |
| **Tests added** | `test/env-example.test.js` (new suite, 13 assertions) |
| **Backup** | `backups/migration-C1c-0-env-20260709-145145/` (+ `ROLLBACK.sh`, `GIT_HEAD.txt` = `9d7189f`) |
| **Tests before** | 24/24 suites |
| **Tests after** | **25/25 suites** (+1 suite, +13 assertions) |
| **Requirement-9 files** | `server.js`, `execution-engine.js`, `charges.js`, `position-sizer.js`, `pop-seller.js`, `forward-test-logger.js` — all verified untouched |

---

## Current state (before)

```env
CAPITAL_TOTAL=100000
NIFTY_LOT_SIZE=75      # ← line 161
SENSEX_LOT_SIZE=20     # ← line 162
BANKNIFTY_LOT_SIZE=35  # ← line 163
```

## Problem

`.env.example` is not inert documentation. `${INST}_LOT_SIZE` is a **live override channel** read by three
independent consumers, and in every one of them the env value **wins over the broker-verified constant**:

| Consumer | Line | Code |
|---|---|---|
| `instrument-registry._envLot()` | `instrument-registry.js:49` | `process.env[`${inst}_LOT_SIZE`]` → returned in preference to `VERIFIED_LOT_SIZE` |
| `server.js` `INSTRUMENT_META` | `server.js:268` | `lotSize: Number(process.env.BANKNIFTY_LOT_SIZE \|\| 30)` |
| `server.js` `PS_INSTS` | `server.js:4415-4417` | `lot: Number(process.env.NIFTY_LOT_SIZE \|\| 65)` |

The ordinary onboarding step `cp .env.example .env` would therefore have **silently reverted the entire
C1 + C1b lot-size migration**, restoring NIFTY 75 and BANKNIFTY 35. Because P&L is
`(exit − entry) × lots × lotSize`, realised ₹P&L would be re-inflated:

| Instrument | Poisoned lot | Verified lot | P&L overstatement |
|---|---|---|---|
| NIFTY | 75 | 65 | **+15.4%** |
| BANKNIFTY | 35 | 30 | **+16.7%** |
| SENSEX | 20 | 20 | none |

**No test would have caught it.** Every existing suite tests JavaScript modules; none had ever read a
`.env` file. The defect lived in the one file the test pyramid did not cover.

Reproduced live before fixing:

```
$ NIFTY_LOT_SIZE=75 node -e 'console.log(require("./instrument-registry").lotSize("NIFTY"))'
[instrument-registry] NIFTY_LOT_SIZE=75 overrides the broker-verified 65 (2026-07-09). …
75
```

The registry's `console.warn` is a *notification*, not a *defence* — it does not stop the wrong value being used.

## Root cause

**A documentation file was a load-bearing part of the money math**, and the configuration surface was
never covered by the test suite. The values in it were also simply stale (pre-2024 contract sizes).

Note: these three lines were an **uncommitted working-tree addition**. `git show HEAD:.env.example` contains
no `*_LOT_SIZE` keys at all. The defect had not yet reached `main` — it was caught in the window between
authoring and committing.

## Solution (smallest change that fixes the root cause)

- The three values are **blanked**, not deleted. `_envLot()` returns `null` for `''`, and
  `Number('' || 65)` evaluates to `65`, so all three consumers fall through to the verified constant.
- The keys **remain documented** — the emergency override for a genuine SEBI contract revision is preserved.
- A comment states which file is authoritative, why a value here is dangerous, and the verified sizes.

No JavaScript was modified. No behaviour changed for any existing `.env` (verified: your live `.env`
sets none of these keys, so the registry was already authoritative at runtime).

## Impact

| Area | Impact |
|---|---|
| Runtime behaviour | **None.** Live `.env` never set these keys. |
| Future onboarding | `cp .env.example .env` is now safe. |
| Database / schema | None. |
| API surface | None. |
| Dashboards | None. |
| Backward compatibility | **100%.** The override channel still functions (asserted). |

## Risk

**Lowest of the seven C1c steps.** The only conceivable regression is an operator who *depended* on
`.env.example` supplying a lot size — impossible, since a copied `.env` would then have carried a wrong
value, which is the defect itself.

## Test results

```
25/25 suites passed          (was 24/24)
test/env-example.test.js — 13 assertions passed
```

The guard was proven to be a real regression test, not a tautology:

```
guard regex catches OLD (pre-fix) file : true    ← test WOULD have failed on the bug
guard regex catches NEW (post-fix) file : false
```

Assertions cover: keys still present (backward compat) · every `*_LOT_SIZE` blank · no numeric lot literal
anywhere · blank → registry returns 65/30/20 · blank → both `server.js` idioms yield their defaults ·
a deliberate override still wins (escape hatch intact) · the comment names the source of truth.

## Files changed

| File | Change |
|---|---|
| `.env.example` | 3 values blanked; 10-line warning comment added |
| `test/env-example.test.js` | **new** — 13 assertions |

`package.json` shows as modified in the working tree due to a **pre-existing** `analytics:api` script that
predates this session. It is **deliberately excluded from this commit** (small commits only).

## Rollback plan

```bash
bash backups/migration-C1c-0-env-20260709-145145/ROLLBACK.sh
```

Restores the pre-fix `.env.example` and removes the guard suite. No runtime state, ledger, or data file is
touched by this migration, so rollback is total and instantaneous.
