# APPROVAL — P1-T3 · `server.js:3764` · `POST /api/strategy-config`

**PROPOSAL ONLY. `server.js` has not been modified.** Suite 45/45 green at time of writing.
The third and last raw writer of `data/config-overrides.json`.

---

## Verified

Characterization run against a verbatim transcription of `server.js:3754-3765`, on a copy of the live
file. `data/config-overrides.json` never touched (asserted byte-identical).

```
A. the file, and the .bak the two approved writers now maintain
  ok   twelve keys
  ok   including STRANGLE_CAPITAL
  ok   a .bak exists (P1-T1 / P1-T2 create it)

B. THE STALE-BACKUP HAZARD this raw writer creates
  ok   the file carries the new value
  ok   CHARACTERIZATION: the .bak was NOT refreshed - it is now stale

C. CHARACTERIZATION - a corrupt file is destroyed. These PASS today.
  ok   one POST rewrote the file with 1 key
  ok   STRANGLE_CAPITAL destroyed by a strategy-config POST
  ok   the daily-loss brake destroyed with it
  ok   and the endpoint returned { ok: true }

D. THE TRIPWIRE - post-fix contract. MUST FAIL today.
  FAIL a corrupt file is recovered from .bak, or the write is REFUSED and the bytes survive

E. the live ledger was never touched
  ok   data/config-overrides.json byte-identical

10 passed, 1 failed        EXIT=1
```

## Current Behaviour

```js
let existing = {};
if (fs.existsSync(CONFIG_OVERRIDE_PATH)) {
  try { existing = JSON.parse(fs.readFileSync(CONFIG_OVERRIDE_PATH, 'utf8')); } catch(_) {}
}
const merged = { ...existing, ...applied };
fs.writeFileSync(CONFIG_OVERRIDE_PATH, JSON.stringify(merged, null, 2));
```

## Root Cause

**The data is destroyed on the READ, not the write.** `catch(_) {}` collapses *"the file is corrupt"*
into *"the file is empty"*. The next statement merges onto that empty object and writes it to disk.
One POST, and eleven keys — including `STRANGLE_CAPITAL: 700000` and `MAX_DAILY_LOSS_PERCENT: 5` — are
gone. The write only makes it permanent. Identical in shape to `:3675` (P1-T1) and `:3575` (P1-T2).

**A second, newer defect, created by the partial migration.** P1-T1 and P1-T2 now maintain a `.bak`.
This raw writer updates the *file* and leaves the *backup* untouched, so the `.bak` goes stale. A later
recovery would silently restore a configuration the operator had already changed. Group B above pins it.

## Blast Radius

- `POST /api/strategy-config` — engine config (`STOP_LOSS_PERCENT`, `TARGET_PERCENT`, …).
- `engine.setConfig(clean)` and `niftyEngine.setConfig(clean)` run **before** the persist block, so the
  in-memory engines are already mutated. If the write is refused, **memory ≠ disk** and a restart
  restores the old config. That is already true today whenever the write fails; this patch does not
  introduce it, it makes it **visible**.
- `res.json({ ok: true, applied, values })` — **unchanged**.
- `_loadConfigOverrides()` (boot) — **unchanged**.
- `POST /api/strategy-config/reset` (`unlinkSync`) — **unchanged**.

## Exact Diff

One hunk. No rename, no move, no reformat.

```diff
@@ server.js:3759  POST /api/strategy-config
-    let existing = {};
-    if (fs.existsSync(CONFIG_OVERRIDE_PATH)) {
-      try { existing = JSON.parse(fs.readFileSync(CONFIG_OVERRIDE_PATH, 'utf8')); } catch(_) {}
-    }
-    const merged = { ...existing, ...applied };
-    fs.writeFileSync(CONFIG_OVERRIDE_PATH, JSON.stringify(merged, null, 2));
+    // P1-T3: the last raw writer of this file. Same defect as _persistEngineOverride — a corrupt
+    // file read as `{}`, then written back, erasing STRANGLE_CAPITAL and MAX_DAILY_LOSS_PERCENT.
+    // It also left the .bak that P1-T1/P1-T2 maintain STALE, so a later recovery would revert the
+    // change the operator had just made.
+    const existing = require('./safe-write.js').readJsonSync(CONFIG_OVERRIDE_PATH, {
+      fallback: {},
+      onRecover: (reason, bak) => console.warn(`[config] overrides were corrupt (${reason}); recovered from ${bak}.`),
+    });
+    const merged = { ...existing, ...applied };
+    require('./safe-write.js').writeJsonSync(CONFIG_OVERRIDE_PATH, merged, { pretty: true, backup: true });
     console.log('[config] persisted overrides:', applied);
   } catch (err) {
-    console.error('[config] persist failed:', err.message);
+    console.error(`[config] REFUSING to persist ${JSON.stringify(applied)}: ${err.message}`);
+    console.error('[config] config-overrides.json is unreadable. File untouched. Config applied in memory only.');
   }
```

## Risk

**LOW** (the patch) / **HIGH** (the defect). Protected file.

The one behaviour a reviewer must accept: on a corrupt file the config now applies **in memory only**
and logs an error, instead of persisting and destroying eleven keys. Refusing is correct, and it is
visible — which the old behaviour was not.

## Rollback

```
backups/migration-P1T3-<ts>/ROLLBACK.sh      # restores only T3, keeps T1 + T2
git checkout -- server.js                    # reverts all three
```

## Characterization Test

Above; **red today** (`EXIT=1`, group D). On approval it is promoted into the existing
`test/server-config-overrides.test.js` as a new block — no new file.

## Regression Tests

1. missing file → `{}` → write succeeds → one key.
2. valid 12-key file → one POST → **twelve keys**, only the applied values differ.
3. corrupt + `.bak` → recovered → twelve keys, warning logged.
4. corrupt, no `.bak` → write **refused**, corrupt bytes byte-identical, `console.error` emitted.
5. **`.bak` is refreshed by all three writers** — the inverse of group B, which is the whole reason
   this task could not be left for later.
6. all three writers (`:3575`, `:3675`, `:3764`) satisfy 1–4 identically.
7. `POST /api/strategy-config/reset` still deletes the file.
8. `res.json({ ok: true, applied, values })` unchanged.
9. Full suite 45/45, gated on exit code, three consecutive runs; `data/` byte-identical after.

## Performance Impact

Operator-driven, one endpoint. Measured during C3: atomic + `fsync` **2.91 ms**, with `.bak`
**4.93 ms**, fair baseline **1.80 ms** → **+3 ms per POST**.

## Approval Recommendation

**SAFE.** On merge, all three writers of `config-overrides.json` are atomic, and Phase 1 Priority 1 is
complete.

---

### Deferred, deliberately not in this patch

- The endpoint returns `{ ok: true }` even when the persist fails — a fail-open at the API layer.
  Separate concern, separate approval.
- `:3571` rebuilds the path instead of using `CONFIG_OVERRIDE_PATH` — a duplicate literal, not a
  durability defect.
