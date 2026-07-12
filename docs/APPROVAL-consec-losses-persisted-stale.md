# APPROVAL PACKAGE

**Status: Proposal only.** No source file has been modified. Suite 45/45 green at time of writing.
`execution-engine.js` is a **protected** file.

`recordTradeResult()` persists the consecutive-loss counter **before** it updates it. The number on disk
is always exactly one trade stale, so after any restart the halt-after-N-losses brake trips one loss
late — and a winning trade's streak reset is never written at all.

This is **not** a durability defect. The write is atomic, the `.bak` is correct, the file is never
corrupt. The **value being written is wrong.**

---

## Current Behaviour

`execution-engine.js:178-185` — the persist:

```js
    try {
      const _path = require('path');
      const file = _path.resolve(`./data/equity-${this.instrumentName.toLowerCase()}.json`);
      require('./safe-write.js').writeJsonSync(file, {
        capital: this.capital, reserve: this.reserve,
        consecLosses: this._consecLosses, updatedAt: new Date().toISOString()
      }, { pretty: true, backup: true });
    } catch (e) { console.warn(`[${this.instrumentName}] equity persist failed: ${e.message}`); }
```

`execution-engine.js:187-200` — the update, which runs **after**:

```js
    if (pnl > 0) {
      if (this._consecLosses > 0) { console.log(`… ✅ Win — consecutive-loss counter reset (was ${this._consecLosses})`); }
      this._consecLosses = 0;
    } else {
      this._consecLosses += 1;
      …
      if (this._consecLosses >= this.maxConsecLosses) {
        this._haltedReason = 'CONSEC_LOSSES';
        this.autoEnabled = false;
      }
    }
```

`capital` and `reserve` are mutated at `:148-156`, i.e. **before** the persist, so they are correct.
`_consecLosses` is the only field written pre-update.

## Verified Evidence

Both runs exercise the **real** `ExecutionEngine.prototype.recordTradeResult`, with `process.cwd()` set
to a temp directory so `path.resolve('./data/…')` writes there. The project's `data/` was never touched.

**Loss path** — `maxConsecLosses = 3`:

```
trade | in-memory _consecLosses | persisted on disk | autoEnabled
  L1   |          1             |         0         |   true
  L2   |          2             |         1         |   true
  L3   |          3             |         2         |   false

halt reason: CONSEC_LOSSES
disk lags memory by: 1 trade(s)
```

At the very moment the brake fires with `_consecLosses = 3`, the file records **2**.

**Win path** — `maxConsecLosses = 5`:

```
after 4 losses      : memory 4 | disk 3
after a WIN         : memory 0 | disk 4   <- the reset was NOT persisted

if the process crashes now, restoreEquity() restores consecLosses = 4
engine boots believing it is 4 losses deep, one loss from halting -- having just WON.
```

Live file today, `data/equity-nifty.json`:

```json
{ "capital": 96761, "reserve": 0, "consecLosses": 15, "updatedAt": "2026-07-09T09:59:47.580Z" }
```

`15` on disk means the in-memory counter was `16` when that trade closed.

Defaults: `execution-engine.js:77` `maxConsecLosses = parseInt(process.env.MAX_CONSECUTIVE_LOSSES || 5)`;
`.env.example:159` sets `MAX_CONSECUTIVE_LOSSES=3`.

## Root Cause

Statement ordering. The persist block reads `this._consecLosses` at `:183`, and the two branches that
change it run at `:189` and `:193`. Nothing else in the function is out of order — `capital` and
`reserve` are already updated by then. The comment directly above the block (`:175-177`) calls this
"RISK STATE … the one file the halt-after-N-losses brake depends on", which is exactly right, and is
exactly why writing it one trade early matters.

## Execution Path

1. `_exit()` closes a paper trade and calls `recordTradeResult({ pnl })` (`execution-engine.js:143`).
2. `:178-185` writes `consecLosses: <value before this trade>` to `data/equity-<inst>.json`.
3. `:187-200` updates `_consecLosses`, and on the Nth loss sets `_haltedReason = 'CONSEC_LOSSES'` and
   `autoEnabled = false`.
4. The process restarts (deploy, `Ctrl-C`, `pm2 restart`, Windows reboot, crash).
5. `restoreEquity()` reads the file and applies `if (Number.isFinite(s.consecLosses)) this._consecLosses = s.consecLosses;`
   — restoring **N − 1**.
6. The constructor sets `autoEnabled` from `NIFTY_AUTO_ENABLED` / `AUTO_TRADE_ENABLED`
   (`execution-engine.js:72-74`), and `_haltedReason` starts `null`. Auto trading is live again.
7. The engine now needs **one more losing trade** than configured before the brake fires.

The symmetric case: a win resets the counter in memory but the file still holds the pre-win value, so a
restart after a winning trade restores a streak the engine has already broken.

## Blast Radius

- **`execution-engine.js`** — NIFTY and SENSEX directional paper engines. `data/config-overrides.json`
  currently has `NIFTY_DIRECTIONAL_AUTO: true` and `SENSEX_DIRECTIONAL_AUTO: true`.
- The error is **in both directions**: after a restart the brake is one loss too permissive following a
  loss, and one loss too strict following a win. It is not conservative.
- `capital`, `reserve`, `_peakEquity` are unaffected by this patch.
- **Paper only.** No broker order exists on this path. The damage is to the loss-streak brake that
  exists to stop a losing regime, and to the fidelity of forward-test results.
- **`afternoon-engine.js:747` / `:755` has the identical ordering.** It is a separate file, a separate
  patch, and a separate approval — see *Deferred Items*. It is not fixed here.

## Minimal Safe Fix

Move the persist block so it runs **after** the counter is updated. Nothing is added, removed or
renamed; six lines change position within one function.

## Exact Diff

```diff
@@ execution-engine.js:171  recordTradeResult
     const totalEquity = this.capital + (this.reserve || 0);
     …
     }

-    // Persist active/reserve across restarts. Half-compound only works if the
-    // reserve pile carries forward — losing it every restart resets sizing back
-    // to baseline and breaks the multi-month compounding curve.
-    // C3-07: this is RISK STATE (capital + reserve + consecLosses), not a cache.
-    // Atomic write + .bak, so a crash mid-write can never truncate the one file the
-    // halt-after-N-losses brake depends on.
-    try {
-      const _path = require('path');
-      const file = _path.resolve(`./data/equity-${this.instrumentName.toLowerCase()}.json`);
-      require('./safe-write.js').writeJsonSync(file, {
-        capital: this.capital, reserve: this.reserve,
-        consecLosses: this._consecLosses, updatedAt: new Date().toISOString()
-      }, { pretty: true, backup: true });
-    } catch (e) { console.warn(`[${this.instrumentName}] equity persist failed: ${e.message}`); }
-
     if (pnl > 0) {
       if (this._consecLosses > 0) {
         console.log(`[${this.instrumentName}] ✅ Win — consecutive-loss counter reset (was ${this._consecLosses})`);
       }
       this._consecLosses = 0;
     } else {
       this._consecLosses += 1;
       console.log(`[${this.instrumentName}] ⚠️  Loss — consecutive losses: ${this._consecLosses}/${this.maxConsecLosses}`);
       if (this._consecLosses >= this.maxConsecLosses) {
         this._haltedReason = 'CONSEC_LOSSES';
         this.autoEnabled = false;
         console.warn(`[${this.instrumentName}] ⛔ HALT: ${this._consecLosses} losses in a row — auto trading DISABLED. Use POST /api/engine/reset to resume.`);
       }
     }
+
+    // Persist active/reserve across restarts. Half-compound only works if the
+    // reserve pile carries forward — losing it every restart resets sizing back
+    // to baseline and breaks the multi-month compounding curve.
+    // C3-07: this is RISK STATE (capital + reserve + consecLosses), not a cache.
+    // Atomic write + .bak, so a crash mid-write can never truncate the one file the
+    // halt-after-N-losses brake depends on.
+    //
+    // ORDER MATTERS. This block used to run BEFORE the counter was updated, so the file
+    // always held the value from the previous trade. On the Nth loss the brake fired with
+    // _consecLosses = N while the file recorded N-1, and a restart restored the smaller
+    // number — the brake then permitted one extra losing trade. A win reset the counter in
+    // memory but never on disk. Persist the state that exists AFTER the trade is accounted for.
+    try {
+      const _path = require('path');
+      const file = _path.resolve(`./data/equity-${this.instrumentName.toLowerCase()}.json`);
+      require('./safe-write.js').writeJsonSync(file, {
+        capital: this.capital, reserve: this.reserve,
+        consecLosses: this._consecLosses, updatedAt: new Date().toISOString()
+      }, { pretty: true, backup: true });
+    } catch (e) { console.warn(`[${this.instrumentName}] equity persist failed: ${e.message}`); }
   }
```

One hunk, one function, one concern. No signature change, no new field, no schema change.

## Risk

**LOW.**

- The file schema is unchanged. Old files remain readable; new files carry a corrected value in the
  same key.
- `capital` and `reserve` are written with the same values as before — they were already updated
  before the block.
- The drawdown circuit (`:166`) runs before the persist in both the old and the new order, so its
  behaviour is untouched.
- If the write throws, the `catch` still logs and the function still returns; the counter is now
  already updated in memory, which is strictly better than the previous order.
- **What a reviewer must accept:** `data/equity-nifty.json` currently reads `consecLosses: 15`, a stale
  value. This patch does not correct historical files; the next closed trade writes a correct one.
  Stated rather than silently repaired.

## Rollback

```
git checkout -- execution-engine.js
```

One command. No data migration. Files written under the new order are read identically by the old code.

## Characterization Test

`test/execution-engine-consec-losses.test.js`, new file. It drives the **real prototype method** with
`process.cwd()` pointed at a `mkdtemp` directory, so `path.resolve('./data/…')` never reaches the
project. It asserts `data/equity-nifty.json` is byte-identical afterwards.

```
A. build an engine: maxConsecLosses = 3, _consecLosses = 0
B. recordTradeResult({pnl: -1000}) ×3
   CHARACTERIZATION: after the 3rd loss, memory === 3 and disk === 2       [passes today]
   CHARACTERIZATION: _haltedReason === 'CONSEC_LOSSES', autoEnabled === false [passes today]
   TRIPWIRE 1: disk === memory === 3                                        [FAILS today: disk 2]
C. fresh engine, maxConsecLosses = 5, four losses then one win
   CHARACTERIZATION: memory === 0, disk === 4                              [passes today]
   TRIPWIRE 2: disk === 0 — a win persists the reset                        [FAILS today: disk 4]
D. simulate the restart: restoreEquity() from the file written at the halt
   TRIPWIRE 3: restored _consecLosses === 3, i.e. still at the halt threshold [FAILS today: 2]
```

Evidence the tripwires will be red: the two measured runs above printed `disk lags memory by: 1
trade(s)` and `after a WIN : memory 0 | disk 4`.

## Regression Tests

1. A single loss: memory `1`, disk `1`.
2. A single win from a clean streak: memory `0`, disk `0`.
3. `capital` and `reserve` on disk equal the post-trade values, exactly as before the patch — the
   half-compound split (`PROFIT_REINVEST_PCT`) is unchanged.
4. Drawdown halt still fires at `maxDrawdownPct` with `_haltedReason === 'DRAWDOWN'`, and the disk
   still records the post-trade `consecLosses`.
5. `resetHalt()` sets `_consecLosses = 0`, `_haltedReason = null`, and re-reads the per-instrument
   auto flag — unchanged.
6. `_resetIfNewDay()` clears only `DAILY_LOSS`, never `CONSEC_LOSSES` — unchanged.
7. A throwing `writeJsonSync` leaves the in-memory counter correct and logs `equity persist failed`.
8. Exactly **one** file write per closed trade, as before.
9. Full suite 45/45, gated on exit code, three consecutive runs. `data/` byte-identical after.

## Performance Impact

**None.** The patch moves a block; it does not add work. The write count per closed trade is unchanged
at one. Measured cost of that write (atomic + `fsync` + `.bak`, from the C3 benchmarks): **4.93 ms**,
against a fair `writeFileSync` baseline of **1.80 ms**. Both figures are unaffected by this change.
`recordTradeResult` runs once per closed paper trade — a handful of times per day.

## Approval Recommendation

**SAFE.** The brake that exists to stop a losing regime is off by one across every restart, in both
directions, and the fix is a statement reordering inside one function with no schema or API change.

## Deferred Items

Each is a separate defect and needs its own package. None is bundled here.

1. **`afternoon-engine.js:747` / `:755`** — identical ordering, identical consequence. Non-protected
   file, so it does not need this approval, but it is a **different patch on a different file** and
   must not ride along.
2. **`_haltedReason` and `autoEnabled` are never persisted.** After a `CONSEC_LOSSES` or `DRAWDOWN`
   halt, a restart re-enables auto trading from `NIFTY_AUTO_ENABLED` / `AUTO_TRADE_ENABLED`
   (`execution-engine.js:72-74`) with `_haltedReason = null`. The halt survives only as the restored
   counter. This is a larger design question — should a halt be durable? — and it changes boot
   behaviour. It deserves its own evidence and its own approval.
3. **`_peakEquity` is not persisted.** The drawdown circuit re-establishes its peak from the restored
   equity on every boot, so a multi-day bleed that spans a restart is measured from a lower peak.
   Separate defect, separate package.
