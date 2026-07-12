# APPROVAL PACKAGE

**Status: Proposal only.** No source file has been modified. Suite 45/45 green.
`server.js` is a **protected** file.

`config-overrides.json` overwrites the restored account equity at every boot. Both directional engines
size positions, and arm their daily-loss brake, from a number that is not the account.

This is **Architecture Review finding #1, minimal migration.** It stops the bleeding. It does not
create the `AccountLedger` authority; that remains a separate, larger project.

---

## Current Behaviour

Three independent writers set `this.capital`, in `server.js` line order. The last one wins.

| order | line | writer | value |
|---|---|---|---|
| 1 | `execution-engine.js:54` | `parseFloat(process.env.CAPITAL_TOTAL \|\| 100000)` | env default |
| 2 | `server.js:3140` / `:3304` | `engine.restoreEquity()` / `niftyEngine.restoreEquity()` | **the real account, from `data/equity-<inst>.json`** |
| 3 | `server.js:3712` | `_loadConfigOverrides()` → `engine.setConfig(data)` → `execution-engine.js:113` | `config-overrides.json: CAPITAL_TOTAL` |

`_loadConfigOverrides()` (`server.js:3697-3712`) applies the whole override object to both directional
engines:

```js
const data = JSON.parse(fs.readFileSync(CONFIG_OVERRIDE_PATH, 'utf8'));
if (engine?.setConfig)      engine.setConfig(data);
if (niftyEngine?.setConfig) niftyEngine.setConfig(data);
```

`execution-engine.js:113` then does `this.capital = num(partial.CAPITAL_TOTAL)`.

## Verified Evidence

Measured on the **running server** (booted 2026-07-10, `paperMode: true`).

Boot log:

```
[SENSEX] Restored equity: active ₹88011 + reserve ₹0 = ₹88011 (consec losses: 2)
[NIFTY]  Restored equity: active ₹96761 + reserve ₹0 = ₹96761 (consec losses: 15)
```

Over HTTP, after boot completed:

```
GET /api/engine/status  ->  { "instrument": "SENSEX", "capital": 100000, ... }
```

`data/config-overrides.json` holds `CAPITAL_TOTAL: 100000`. The engine restored ₹88,011 and had
₹100,000 written over it **572 lines later**.

**`capital` is not only a sizing input. It arms the daily-loss brake** —
`execution-engine.js:302`:

```js
if (todayLoss < -(this.capital * this.maxDailyLossPct)) { … }
```

With `MAX_DAILY_LOSS_PERCENT: 5` and `CAPITAL_PER_TRADE_PERCENT: 5`:

| engine | restored | used by engine | daily-loss brake (real) | brake (used) | over by |
|---|---|---|---|---|---|
| SENSEX | ₹88,011 | ₹1,00,000 | ₹4,400.55 | ₹5,000.00 | **+13.6%** |
| NIFTY | ₹96,761 | ₹1,00,000 | ₹4,838.05 | ₹5,000.00 | **+3.3%** |

Per-trade budget: SENSEX real ₹4,401 vs used ₹5,000 (**+₹599**); NIFTY ₹4,838 vs ₹5,000 (**+₹162**).

**The asymmetry is what makes this structural.** As the account bleeds, `recordTradeResult()` shrinks
`capital` and the brake tightens — exactly as designed. Every restart resets it to ₹1,00,000 and the
brake loosens again. **A losing account never reduces its risk.** Symmetrically, an account that has
grown past ₹1,00,000 is *under*-sized after a restart, so the half-compound curve that
`recordTradeResult()` maintains (`execution-engine.js:146-156`) can never compound across a restart.

## Root Cause

`CAPITAL_TOTAL` is a **balance**, not a setting, and it is stored and applied as if it were a setting.
`restoreEquity()` — the only writer that knows the truth — runs **before** the writer that knows nothing.

Nothing declares a precedence rule. Precedence is an accident of line numbers.

## Execution Path

1. `server.js:3113` — `const engine = new ExecutionEngine({...})`; `execution-engine.js:54` sets
   `capital = 100000` from env.
2. `server.js:3140` — `engine.restoreEquity()` reads `data/equity-sensex.json`, sets `capital = 88011`.
3. `server.js:3278` / `:3304` — same for `niftyEngine`, `capital = 96761`.
4. `server.js:3712` — `const _cfgOverrides = _loadConfigOverrides();` reads
   `config-overrides.json`, calls `engine.setConfig(data)` and `niftyEngine.setConfig(data)`.
5. `execution-engine.js:113` — `this.capital = 100000` for **both** engines.
6. `app.listen()` fires; every subsequent entry is sized from ₹1,00,000, and
   `execution-engine.js:302` arms the daily-loss brake at ₹5,000.

## Blast Radius

- `execution-engine` × 2 (SENSEX, NIFTY). `config-overrides.json` currently has
  `SENSEX_DIRECTIONAL_AUTO: true` and `NIFTY_DIRECTIONAL_AUTO: true`.
- **Not affected:** `afternoonEngine` and `niftyAfternoonEngine` restore equity at `server.js:3436` /
  `:3495` and are **never passed** `setConfig(data)` — `_loadConfigOverrides()` touches only the two
  directional engines. Verified by reading the function body.
- **Not affected:** `strangle-engine`, which owns `STRANGLE_CAPITAL` and has no equity file.
- Paper only. No broker order path exists (`execution-engine.js:519`, `paperMode: true`).
- Forward-test results are affected: every closed trade in the ledger was sized from the wrong capital.

## Minimal Safe Fix

**Move the two `restoreEquity()` calls to run after `_loadConfigOverrides()`.** Restored state becomes
the last word, which is the precedence rule that should have existed. No new logic, no new flag, no
conditional, no schema change — two statements change position.

Verified preconditions for the move:

- Nothing between `server.js:3141` and `:3711` reads `engine.capital`, `niftyEngine.capital`,
  `.reserve`, `._consecLosses` or `._haltedReason`. Checked with an `awk` range scan; the only match is
  a comment at `:3268`.
- `restoreEquity()` writes only `this.capital`, `this.reserve`, `this._consecLosses`, and — on an
  unrecoverable file — `this._haltedReason` and `this.autoEnabled`. Nothing else in the boot path
  depends on those before `:3712`.
- `setConfig()` does **not** touch `autoEnabled` (`execution-engine.js:113-125` handles numeric config
  only), so moving the restore later cannot be defeated by the override.

The alternative — filtering `CAPITAL_TOTAL` out of the override object — needs a special case for a
fresh install with no equity file, and another for the stale-file branch at `execution-engine.js:380`.
Reordering has neither.

## Exact Diff

```diff
@@ server.js:3140
 const engine = new ExecutionEngine({ … });
-engine.restoreEquity();
@@ server.js:3304
 const niftyEngine = new ExecutionEngine({ … });
-niftyEngine.restoreEquity();
@@ server.js:3712
 const _cfgOverrides = _loadConfigOverrides();
+
+// ORDER MATTERS. `CAPITAL_TOTAL` in config-overrides.json is a BALANCE, not a setting, and
+// setConfig() writes it straight onto `this.capital` (execution-engine.js:113). Restoring
+// equity BEFORE the overrides meant ₹88,011 of real SENSEX equity was overwritten with the
+// stored ₹1,00,000 on every boot — inflating both the per-trade budget and the daily-loss
+// brake (execution-engine.js:302), so a bleeding account never tightened its own risk.
+// Restored state is the account. It must be the last word.
+engine.restoreEquity();
+niftyEngine.restoreEquity();
```

Two statements moved. One function's worth of comment. No rename, no reformat, no signature change.

## Risk

**MEDIUM.** It changes the number every position is sized from, and the threshold of the daily-loss
brake. That is the point of the patch, and it is why it is medium rather than low.

- The change is **conservative in direction**: SENSEX's brake tightens from ₹5,000 to ₹4,400.55, its
  per-trade budget falls from ₹5,000 to ₹4,401. The engine risks less, not more.
- **A reviewer must accept one consequence:** an operator who deliberately set `CAPITAL_TOTAL` through
  `POST /api/strategy-config` will find that value ignored at the next boot for any engine with an
  equity file. That is correct — a balance is not a setting — but it is a change in what the API means.
  Runtime `POST /api/strategy-config` still works within the session; only the boot-time reapplication
  stops.
- On a **fresh install** with no equity file, `restoreEquity()` returns immediately
  (`execution-engine.js:376`, `if (!_fs.existsSync(file)) return;`) and `CAPITAL_TOTAL` from the
  overrides survives — the current behaviour, preserved.
- On a **stale** equity file (>30 days, `execution-engine.js:380`) the restore keeps the baseline that
  `setConfig` has just written. Also preserved, and now for the right reason.
- Log ordering changes: the two `Restored equity` lines move to after `[config] Loaded overrides`.
- **This patch does not touch the corruption path.** If the equity file is unrecoverable,
  `restoreEquity()` still sets `_haltedReason = 'EQUITY_STATE_CORRUPT'` and `autoEnabled = false`.
  Running it *later* is strictly safer, because fewer statements follow it.

## Rollback

```
git checkout -- server.js
```

One command. No data migration. `data/equity-*.json` and `config-overrides.json` are untouched by this
patch, in either direction.

## Characterization Test

`test/server-boot-capital.test.js`, new file. `server.js` cannot be required — it boots the engines and
writes ledgers — so the test drives the **real** `ExecutionEngine.prototype` and reproduces the boot
sequence exactly, with `process.cwd()` pointed at a `mkdtemp` directory. It asserts
`data/equity-sensex.json`, `data/equity-nifty.json` and `data/config-overrides.json` are byte-identical
afterwards.

```
A. write equity-testinst.json with capital 88011
B. construct the engine (env CAPITAL_TOTAL=100000)
C. replay the CURRENT boot order:  restoreEquity()  →  setConfig({CAPITAL_TOTAL: 100000})
   CHARACTERIZATION: capital === 100000                                  [passes today]
   CHARACTERIZATION: daily-loss threshold === 5000, not 4400.55          [passes today]
   TRIPWIRE 1: capital === 88011 after the boot sequence                 [FAILS today]
   TRIPWIRE 2: threshold === capital * maxDailyLossPct === 4400.55       [FAILS today]
D. replay the PROPOSED order:      setConfig(...)  →  restoreEquity()
   assert capital === 88011                                             [passes only after the move]
E. fresh install: no equity file
   assert setConfig's CAPITAL_TOTAL survives, capital === 100000         [must pass BOTH ways]
F. stale equity file (updatedAt 40 days old)
   assert capital === 100000, the baseline is kept                       [must pass BOTH ways]
```

Tripwires 1 and 2 must be red before the move. Evidence they will be: the running server serves
`capital: 100000` while its own boot log printed `Restored equity: active ₹88011`.

## Regression Tests

1. `restoreEquity()` still restores `reserve` and `_consecLosses` — the values, and the order of the
   `if (Number.isFinite(...))` guards, are untouched.
2. An **unrecoverable** equity file still yields `_haltedReason === 'EQUITY_STATE_CORRUPT'` and
   `autoEnabled === false`, now set after `setConfig` rather than before.
3. `_loadConfigOverrides()` still applies every **non-capital** key — `STOP_LOSS_PERCENT`,
   `TARGET_PERCENT`, `CAPITAL_PER_TRADE_PERCENT` — to both engines, unchanged.
4. `_cfgOverrides` is still the value returned by `_loadConfigOverrides()`, and `server.js:7278`
   still applies `NIFTY_DIRECTIONAL_AUTO` / `SENSEX_DIRECTIONAL_AUTO` via `setAutoEnabled`.
5. `afternoonEngine.restoreEquity()` (`:3436`) and `niftyAfternoonEngine.restoreEquity()` (`:3495`)
   remain where they are and are unaffected — they never receive `setConfig(data)`.
6. `POST /api/strategy-config` with `CAPITAL_TOTAL` still changes `this.capital` **within the running
   session**; only the boot-time reapplication is removed.
7. Fresh install (no equity file) and stale file (>30 days) both preserve today's behaviour.
8. Full suite 45/45, gated on exit code, three consecutive runs. `data/` byte-identical after.
9. A boot smoke test: `GET /api/engine/status` reports a `capital` equal to the value in
   `data/equity-sensex.json`.

## Performance Impact

**None.** Two statements move within the boot path. `restoreEquity()` performs one `readFileSync` per
engine, executed once per process. No work is added, removed, or repeated.

## Approval Recommendation

**SAFE, with a reviewer decision required on one point:** whether `CAPITAL_TOTAL` in
`config-overrides.json` should continue to exist at all. This patch makes it inert at boot for any
engine with an equity file, which is correct, but leaves a dead key in the file that an operator can
still set from the UI and that will silently do nothing on the next restart. **A dead knob that looks
live is its own hazard.** My recommendation is to land this patch, then remove `CAPITAL_TOTAL` from
`CONFIG_SPEC` in a separate change so the UI stops offering it.

## Deferred Items

Each is a separate defect with its own evidence. None is bundled here.

1. **`server.js:7278` re-enables a halted engine at boot.** `restoreEquity()` sets
   `autoEnabled = false` when the equity file is unrecoverable (C3-07). Later, inside the `app.listen`
   callback, `niftyEngine.setAutoEnabled(_cfgOverrides.NIFTY_DIRECTIONAL_AUTO)` sets it back to `true`,
   because `config-overrides.json` has `NIFTY_DIRECTIONAL_AUTO: true`. **The fail-closed halt introduced
   by C3-07 is undone six thousand lines later.** This is a live fail-open and it deserves the next
   package. It is not fixed by the reordering above.
2. **`_haltedReason` and `autoEnabled` are never persisted.** NIFTY currently runs with
   `consecLosses: 15` against `MAX_CONSECUTIVE_LOSSES=3` because the halt does not survive a restart.
   Already documented in `docs/APPROVAL-consec-losses-persisted-stale.md` §Deferred.
3. **`_peakEquity` is not persisted**, so the drawdown circuit re-establishes its peak from restored
   equity on every boot.
4. **The `AccountLedger` authority itself** — `docs/ARCHITECTURE-REVIEW.md` §1. Capital lives in four
   places (`equity-nifty.json`, `equity-sensex.json`, `STRANGLE_CAPITAL: 700000`,
   `CAPITAL_TOTAL: 100000`) and nothing reconciles them. This patch fixes precedence, not ownership.
