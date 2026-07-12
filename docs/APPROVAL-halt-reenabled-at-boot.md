# APPROVAL PACKAGE — a halted engine is re-enabled at boot

**Status: Proposal only.** No source file was modified. Suite 46/46 green. `execution-engine.js` and
`server.js` are both **protected**; this package proposes a change to **one function in one of them**.

**Priority: CRITICAL. Impact: Risk. Classification: MEASURED (reproduced on the real prototype).**

---

## Problem Statement

`restoreEquity()` sets `autoEnabled = false` and `_haltedReason = 'EQUITY_STATE_CORRUPT'` when the
equity file cannot be recovered. That is the C3-07 fail-closed halt: *if the loss streak is unknowable,
the brake is ON.*

Sixty-one hundred lines later, inside the `app.listen` callback, `server.js:7287` calls
`setAutoEnabled(true)` because `config-overrides.json` says `NIFTY_DIRECTIONAL_AUTO: true`.

**`setAutoEnabled()` does not consult `_haltedReason`. The halt is undone. The engine trades.**

## Business Impact

The halt exists to stop a losing regime and to stop an engine whose risk state is unknown. Both are
defeated by a restart. Today this is **paper only** — `paperMode: true`, and `execution-engine.js:519`
guards `placeOrder` behind `if (!this.paperMode && securityId)`. The damage is to the forward-test
evidence that gates any future live approval, and to the credibility of every risk control above it.

**With `TRADE_MODE=live`, this is an engine that resumes trading after being halted for not knowing its
own loss streak.**

## Technical Impact

`getHaltStatus()` publishes an **impossible state**, and the API serves it:

```json
{"halted": true, "reason": "EQUITY_STATE_CORRUPT", "autoEnabled": true, ...}
```

Two fields, one truth, no owner. This is an architecture-governance violation, not merely a bug:
*"Never duplicate risk. Everything has one owner."*

## Evidence — MEASURED

Reproduced against the **real** `ExecutionEngine.prototype`, with `process.cwd()` pointed at a
`mkdtemp` directory. The project's `data/` was never touched.

```
STEP 1  corrupt equity file on disk (truncated JSON), no .bak
[TESTINST] ⛔ EQUITY STATE UNRECOVERABLE: … Refusing to guess.
        _haltedReason : EQUITY_STATE_CORRUPT
        autoEnabled   : false   <- C3-07 fail-closed halt HOLDS

STEP 2  server.js:7287 runs inside the app.listen callback
        _cfgOverrides.NIFTY_DIRECTIONAL_AUTO = true
[TESTINST] autoEnabled=true | paper=true
        _haltedReason : EQUITY_STATE_CORRUPT   <- still set
        autoEnabled   : true    <- RE-ARMED

STEP 3  the only gate in tick() is execution-engine.js:280
        if (!this.autoEnabled) return;   -> passes: true
        _haltedReason is never consulted in tick()

RESULT  a HALTED engine trades on the next tick.
        getHaltStatus() -> {"halted":true,"reason":"EQUITY_STATE_CORRUPT","autoEnabled":true, …}
```

Supporting facts, each read from the source:

| fact | location |
|---|---|
| `setAutoEnabled(v) { this.autoEnabled = v; … }` — no halt check, **0 references to `_haltedReason`** | `execution-engine.js:698` |
| `tick()`'s only gate is `if (!this.autoEnabled) return;` | `execution-engine.js:280` |
| `resetHalt()` clears `_haltedReason` and writes `this.autoEnabled` **directly**, bypassing `setAutoEnabled` | `execution-engine.js:206-217` |
| boot re-enable, directional | `server.js:7287`, `:7288` |
| boot re-enable, afternoon | `server.js:7282`, `:7283` |
| API toggles | `server.js:3145`, `:3383`, `:3600` |

**Observed on the live server this session:** NIFTY runs with `consecLosses: 15` against
`MAX_CONSECUTIVE_LOSSES=3`, `autoEnabled: true`. `_haltedReason` and `autoEnabled` are never persisted,
so a `CONSEC_LOSSES` halt survives only as the restored counter — and this path re-arms it anyway.

## Official References

None required. This is a defect in this repository's own invariant, established by C3-07 and by
`execution-engine.js:93` (`_haltedReason` documented as the halt reason). **No exchange or regulator
document bears on it.** Classification: **MEASURED**, not *Exchange Verified*.

## Unknowns

- Whether the same defect exists in `afternoon-engine.js`. It has an identical `autoEnabled` gate
  (`:364`) and receives the same boot re-enable (`server.js:7282-7283`). **Not tested. Not claimed.**
- Whether `stock/server.js:347` reaches an engine that can halt. Out of scope for this package.

## Root Cause — ONE

**`autoEnabled` and `_haltedReason` are two representations of one invariant — *may this engine trade?*
— and no code owns the consistency between them.** `setAutoEnabled()` writes one without reading the
other.

Not "the boot callback re-enables it": that is *a* caller. There are **seven**. Fixing the caller fixes
one path and leaves six.

## Affected Modules

`execution-engine.js` (the invariant), `server.js` (seven callers), `afternoon-engine.js` (unverified,
same shape), `stock/server.js` (out of scope).

## Alternative Solutions

| # | approach | closes | why not chosen |
|---|---|---|---|
| **A** | **`setAutoEnabled()` refuses to enable while `_haltedReason` is set** | **all 7 callers, present and future** | **chosen** |
| B | `tick()` also checks `_haltedReason` (`:280`) | trading | leaves `autoEnabled` lying, and `getHaltStatus()` still publishes the impossible state |
| C | Remove the boot re-enable at `server.js:7287-7288` | boot only | the three API toggles still re-arm a halted engine |
| D | Persist `_haltedReason` / `autoEnabled` across restarts | a different defect | larger, changes boot semantics, needs its own evidence. **Deferred, not merged into this.** |

A is the smallest change that closes the class rather than an instance. `resetHalt()` is unaffected
because it writes `this.autoEnabled` directly — **the only sanctioned way to re-arm after a halt
remains an explicit, logged, operator-initiated reset.**

## Chosen Solution — Exact Diff

`execution-engine.js:698` — one function, six functional lines.

```diff
   setAutoEnabled(v) {
+    // A halt and an auto-flag are two representations of ONE invariant: may this engine trade?
+    // Nothing owned the consistency between them, so `server.js:7287` could re-arm an engine that
+    // restoreEquity() had halted for EQUITY_STATE_CORRUPT, and `tick()` (:280) gates only on
+    // autoEnabled. The halt is the owner. `resetHalt()` writes `autoEnabled` directly and is
+    // therefore unaffected — an explicit, logged, operator-initiated reset stays the only way back.
+    if (v && this._haltedReason) {
+      console.warn(`[${this.instrumentName}] ⛔ REFUSING to enable auto trading: engine is HALTED ` +
+        `(${this._haltedReason}). Use POST /api/engine/reset?inst=${this.instrumentName} after manual review.`);
+      return false;
+    }
     this.autoEnabled = v;
     console.log(`[${this.instrumentName}] autoEnabled=${v} | paper=${this.paperMode}`);
+    return true;
   }
```

`setAutoEnabled` currently returns `undefined`; every caller ignores the return value (verified across
all seven). Returning a boolean is **additive**.

**Disabling is never refused.** `setAutoEnabled(false)` on a halted engine still works — `server.js:3248-3251`
(the kill-switch) is untouched.

## Risk Analysis

**Patch risk: LOW. Defect risk: CRITICAL.**

- Direction of change: an engine that would have traded while halted now does not. **Strictly safer.**
- `resetHalt()` unaffected — verified: it assigns `this.autoEnabled` directly, not via the setter.
- Kill-switch unaffected — `setAutoEnabled(false)` is never refused.
- **The one consequence a reviewer must accept:** after this patch, an operator who POSTs
  `/api/engine/auto {enabled:true}` to a halted engine receives `{"ok":true,"autoEnabled":true}` while
  the engine stays **off**. The API already lies — `server.js:3145` echoes `!!enabled`, not
  `engine.autoEnabled` — and this patch makes the lie *visible* rather than causing it.

  **Before:** the API said ON and the engine was ON — and it should not have been.
  **After:** the API says ON and the engine is OFF — safe, but the operator is misinformed.

  Both are wrong. This patch fixes the **safety**; it does not fix the **API**. See *Release Gate*.

## Architecture Analysis

This is the first enforcement of *"everything has one owner"* inside an engine. `_haltedReason` becomes
the owner of the trading permission; `autoEnabled` becomes a derived, guarded field. That is the correct
direction, and it is a precedent the `RiskEngine` (Architecture Review §3) will inherit.

## Rollback Plan

```
git checkout -- execution-engine.js
```

One command. No schema change, no data migration, no persisted state touched. `backups/` snapshot and a
`ROLLBACK.sh` will be created before the patch is applied.

## Characterization Test — MUST FAIL BEFORE THE FIX

`test/execution-engine-halt-guard.test.js`, new. Drives the real prototype with `process.cwd()` at a
`mkdtemp` directory; asserts `data/` byte-identical afterwards.

```
A. corrupt equity file, no .bak
B. restoreEquity()
   CHARACTERIZATION: _haltedReason === 'EQUITY_STATE_CORRUPT', autoEnabled === false   [passes today]
C. setAutoEnabled(true)                     <- what server.js:7287 does
   CHARACTERIZATION: autoEnabled becomes true                                          [passes today]
   CHARACTERIZATION: getHaltStatus() reports halted:true AND autoEnabled:true           [passes today]
   TRIPWIRE 1: autoEnabled stays false                                                 [FAILS today]
   TRIPWIRE 2: setAutoEnabled(true) returns false                                      [FAILS today]
   TRIPWIRE 3: getHaltStatus() is self-consistent — never halted && autoEnabled        [FAILS today]
D. resetHalt(); then setAutoEnabled(true)
   assert autoEnabled === true                                    [must pass BOTH ways]
E. setAutoEnabled(false) on a halted engine
   assert it succeeds — disabling is never refused                [must pass BOTH ways]
```

Evidence the tripwires will be red: the reproduction above, run against the current prototype.

## Regression Matrix

| # | scenario | expected |
|---|---|---|
| 1 | clean equity file → `setAutoEnabled(true)` | enabled, returns `true` |
| 2 | `CONSEC_LOSSES` halt → `setAutoEnabled(true)` | refused, returns `false`, warning logged |
| 3 | `DRAWDOWN` halt → `setAutoEnabled(true)` | refused |
| 4 | `DAILY_LOSS` halt → `_resetIfNewDay()` clears `_haltedReason` | `autoEnabled` stays **false**. **This row previously claimed the engine re-enables. It does not.** Nothing calls `setAutoEnabled` at day rollover — verified. See *Future Debt #5* |
| 5 | any halt → `setAutoEnabled(false)` | succeeds, never refused |
| 6 | `resetHalt()` → engine re-arms per env flag | unchanged |
| 7 | `server.js:3248-3251` kill-switch | unchanged |
| 8 | `tick()` on a refused engine | returns at `:280`, no trade |
| 9 | full suite 46/46, exit-code gated, three runs; `data/` byte-identical | green |

## Performance Impact

One property read on a function called **seven times per process lifetime** (five at boot, plus operator
toggles). **Not measurable.** No allocation, no I/O, no clock read.

## Approval Decision

**APPROVED WITH CONDITIONS — recommended.** The conditions are release-gate conditions, not code:

1. The characterization test must be red before the patch and green after, proven by reverting
   `execution-engine.js` and re-running.
2. **The three API endpoints must echo `engine.autoEnabled`, not `!!enabled`, in the same release.**
   `server.js:3145`, `:3383`, `:3600`. This is a **separate three-line package with its own root cause**
   ("the API reports the request, not the state") and must not be merged into this commit. But shipping
   this patch without it leaves an operator believing trading is on when it is off. **Fail closed on the
   release, not on the commit.**

## Future Debt

1. **`afternoon-engine.js`** almost certainly carries the identical defect: same `autoEnabled` gate at
   `:364`, same boot re-enable at `server.js:7282-7283`. **Untested. A separate package, after this one
   establishes the pattern.**
2. **`_haltedReason` and `autoEnabled` are not persisted.** A `CONSEC_LOSSES` halt does not survive a
   restart at all. That is defect **D** above, deliberately not merged. Its evidence: NIFTY runs today at
   `consecLosses: 15` against a threshold of 3.
3. **`getHaltStatus()` can publish an impossible state.** This patch makes it consistent for the
   `setAutoEnabled` path. It does not prove consistency for every path. A single `canTrade()` accessor,
   owned by `_haltedReason`, would.
4. **`stock/server.js:347`** calls `setAutoEnabled` on a different engine class. Unreviewed.

5. **`DAILY_LOSS` is a permanent halt, and the log says otherwise.** Found by the Supreme Review Board
   while auditing *this* package's own regression matrix, which asserted the opposite.

   `execution-engine.js:304-306` sets `autoEnabled = false` and `_haltedReason = 'DAILY_LOSS'`, and logs
   *"auto trading DISABLED until tomorrow"*. `_resetIfNewDay()` (`:136`) clears `_haltedReason` the next
   day — **but never restores `autoEnabled`**, and nothing calls `setAutoEnabled` at rollover.
   `tick()`'s gate (`:280`) reads `autoEnabled`. Reproduced on the real prototype:

   ```
   STEP 1  daily loss -6000 vs limit -5000
           _haltedReason: DAILY_LOSS | autoEnabled: false
   STEP 2  next day: _resetIfNewDay()
           _haltedReason: null    <- cleared
           autoEnabled  : false   <- NOT restored
   RESULT  "disabled until tomorrow" is disabled FOREVER.
   ```

   Direction is **safe** (the engine stays off), so this is not a fail-open. But the declared intent and
   the behaviour disagree, and the log is false. **Separate root cause, separate package.** It is named
   here because this package's own matrix asserted a behaviour that does not exist.

## Guard sufficiency — independently verified

`this.autoEnabled` is written directly in **seven** places. The Board checked each, because a guard on
the setter is worthless if another line can enable the engine:

| line | value | can it enable? |
|---|---|---|
| `:167`, `:197`, `:304`, `:387` | `false` | no — safe direction |
| `:72` constructor | from env | `_haltedReason` is still `null` at construction |
| `:215` `resetHalt()` | from env | `:208` clears `_haltedReason` first |
| `:699` `setAutoEnabled` | `v` | **the guard goes here** |

**Exactly three paths can enable, and all three are safe under the patch.** The guard is sufficient.
