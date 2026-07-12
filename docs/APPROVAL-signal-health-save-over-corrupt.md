# APPROVAL PACKAGE

**Status: Proposal only.** No source file has been modified. Suite 45/45 green at time of writing.

`signal-health.js` — `saveState()` overwrites a calibration state file it has already declared
unrecoverable, immediately after logging that the file is untouched.

---

## Current Behaviour

`signal-health.js:132-162` — `loadState()`:

```js
} catch (e) {
  tk.stateCorrupt = true;
  tk.stateCorruptReason = e.message;
  console.error(`[signal-health] CALIBRATION STATE UNRECOVERABLE: ${e.message}`);
  console.error('[signal-health] Treating confidence as UNCALIBRATED. The file is untouched.');
  return tk;
}
```

`signal-health.js:115-126` — `saveState()`:

```js
function saveState(tk, fs, path) {
  const payload = { outcomes: tk.outcomes, window: tk.window, driftBrier: tk.driftBrier, minSamples: tk.minSamples };
  try {
    if (_isRealFs(fs)) require('./safe-write.js').writeJsonSync(path, payload, { pretty: true, backup: true });
    else fs.writeFileSync(path, JSON.stringify(payload, null, 2));
    return true;
  } catch (e) { … }
}
```

`saveState` never reads `tk.stateCorrupt`. There is no guard at any line between 115 and 126.

## Verified Evidence

Reproduced against the real module on a temp copy. `data/` never touched.

```
saved outcomes on disk : 40
file parses?           : false            <- crash truncates it

[signal-health] CALIBRATION STATE UNRECOVERABLE: … Refusing to guess.
[signal-health] Treating confidence as UNCALIBRATED. The file is untouched.

stateCorrupt           : true
outcomes in memory     : 0
assessHealth status    : LEARNING

saveState returned     : true
corrupt bytes survive? : false            <- the log was false
outcomes now on disk   : 1   (was 40)
```

**The module logs "The file is untouched", and then the next call overwrites it.**

Live file: `data/signal-outcomes.json`, 1,994 bytes, **11 outcomes**, `window: 300`,
`minSamples: 30`. **No `.bak` exists** (`ls: data/signal-outcomes.json.bak: No such file`), so the
recovery path in `readJsonSync` has nothing to recover from — the `stateCorrupt` branch is the one that
fires today.

Every sibling writer migrated under C3 guards this exact case. `signal-health` is the only one that
does not:

| module | line | guard |
|---|---|---|
| `pop-seller.js` | 378 | `if (_bookCorrupt) return;   // never write over a book we could not read` |
| `agents-engine.js` | 326 | `if (this._ledgerCorrupt) return;   // never write [] over a ledger we could not read` |
| `signal-health.js` | 115-126 | **none** |

## Root Cause

`loadState()` correctly distinguishes *missing* (fresh start, `fallback: null`) from *corrupt*
(a loss, `stateCorrupt = true`). It then hands the caller an **empty tracker** carrying that flag.

`saveState()` serialises `tk.outcomes` unconditionally. An empty tracker serialises to an empty
`outcomes` array. The flag that says *"this emptiness is a loss, not a fresh start"* is written nowhere
and read nowhere.

The distinction is created and then discarded one function later. **A flag with no consumer is a
comment.**

## Execution Path

1. `server.js:5824` — `_signalTracker = signalHealth.loadState(_sigFs, _SIG_HEALTH_PATH, {window: 300, minSamples: 30})`
   where `_SIG_HEALTH_PATH = data/signal-outcomes.json` (`server.js:5821`) and `_sigFs` is the **real**
   `fs`, so the `_isRealFs` branch is taken.
2. File is corrupt, no `.bak` ⇒ `readJsonSync` throws ⇒ `signal-health.js:144` sets
   `tk.stateCorrupt = true`, logs *"The file is untouched"*, returns a tracker with `outcomes: []`.
3. First paper trade closes. `server.js:5928` — `if (closed.length) signalHealth.saveState(_signalTracker, _sigFs, _SIG_HEALTH_PATH);`
   (also reachable from `server.js:6051`).
4. `saveState` writes `{ outcomes: [<the one new outcome>], … }` over the corrupt bytes.

The 11 recorded outcomes and the corrupt bytes are both gone. Nothing is logged.

## Blast Radius

- **`data/signal-outcomes.json`** — 11 of the platform's 50 labelled outcomes. Under constraint **M2**
  these are the *entire* calibration evidence base for the signal path; ~200 are needed and every one
  is irreplaceable. They cannot be recomputed: a closed paper trade's outcome is a historical fact.
- **`assessHealth()`** (`signal-health.js:69`) then reports `status: 'LEARNING'`,
  `"only 0/30 samples — still gathering"` — indistinguishable from a fresh install. After 30 new
  outcomes it reports `HEALTHY`, with no memory that a history was destroyed.
- The corrupt bytes are destroyed, so the cause can never be diagnosed.
- **No trading decision changes.** `assessHealth` output is advisory. This is a data-loss defect, not a
  fail-open in a risk brake.

## Minimal Safe Fix

Guard `saveState` on the flag `loadState` already sets. Refuse, log, return `false`.

Placed **before** the `_isRealFs` branch so it applies to the injected-fake seam too: a fake `fs` has no
atomicity to give, but it must not be used to smuggle a write past the guard in a test.

## Exact Diff

```diff
@@ signal-health.js:115  saveState
 function saveState(tk, fs, path) {
+  // A corrupt state file is a LOSS, not a fresh start. `loadState` says so — it sets
+  // `tk.stateCorrupt` and logs "The file is untouched" — and then this function used to
+  // overwrite it with the empty tracker that corruption produced. Refuse, exactly as
+  // pop-seller.js:378 and agents-engine.js:326 refuse for their own ledgers. The corrupt
+  // bytes stay on disk for forensics.
+  if (tk && tk.stateCorrupt) {
+    console.error('[signal-health] REFUSING to save: calibration state was unrecoverable ' +
+      `(${tk.stateCorruptReason || 'unknown'}). The file is untouched. ` +
+      'Fix or delete it, then restart; a MISSING file is treated as a fresh start.');
+    return false;
+  }
   const payload = { outcomes: tk.outcomes, window: tk.window, driftBrier: tk.driftBrier, minSamples: tk.minSamples };
   try {
     if (_isRealFs(fs)) require('./safe-write.js').writeJsonSync(path, payload, { pretty: true, backup: true });
     else fs.writeFileSync(path, JSON.stringify(payload, null, 2));   // injected fake: no atomicity to give
     return true;
   } catch (e) {
     console.error(`[signal-health] state save failed: ${e.message}`);
     return false;
   }
 }
```

One hunk. Six functional lines. `signal-health.js` is **not** a protected file. No rename, no move, no
reformat, no signature change.

## Risk

**LOW.**

- `saveState` already returns `false` on failure and **both call sites ignore the return value**
  (`server.js:5928`, `server.js:6051`). No caller branches on it, so returning `false` breaks nothing.
- Behaviour changes only on a path that today destroys data.
- On the happy path — `stateCorrupt` is `false` — the function is byte-for-byte identical.
- `newTracker()` (`signal-health.js:25`) does not set `stateCorrupt`, so a tracker built directly is
  `undefined` there and the guard is skipped. The `tk &&` and truthiness test make that explicit.
- Once corrupt, outcomes accumulate **in memory only** until an operator intervenes. That is the same
  contract `pop-seller` and `agents-engine` already have, and it is strictly better than writing the
  loss to disk. Stated plainly rather than hidden.

## Rollback

```
git checkout -- signal-health.js test/signal-health.test.js
```

One command. No schema change, no data migration, no persisted state touched.

## Characterization Test

`test/signal-health.test.js`, new block. Must **fail before** the fix and pass after. It never touches
`data/`; it writes into a `mkdtemp` directory and asserts `data/signal-outcomes.json` is byte-identical
at the end.

```
A. seed a tracker with 40 outcomes and saveState() it            -> 40 on disk
B. truncate the file (simulate a crash); no .bak exists
C. loadState()  -> tk.stateCorrupt === true, tk.outcomes.length === 0   [passes today]
D. logOutcome(tk, …) then saveState(tk, fs, path)
   TRIPWIRE 1: saveState() returns false                          [FAILS today: returns true]
   TRIPWIRE 2: the corrupt bytes are byte-identical               [FAILS today: overwritten]
   TRIPWIRE 3: the file does not parse as JSON                    [FAILS today: parses, 1 outcome]
```

Evidence the tripwires will be red: the reproduction above, run against the current module, printed
`saveState returned : true`, `corrupt bytes survive? : false`, `outcomes now on disk : 1 (was 40)`.

## Regression Tests

1. **Missing** file → `loadState` returns a fresh tracker, `stateCorrupt === false` → `saveState` writes
   normally. A missing file is a fresh start; this must not change.
2. **Valid** 40-outcome file → restored, `stateCorrupt === false`, `saveState` writes, `.bak` created.
3. **Corrupt with a `.bak`** → `readJsonSync` recovers, `stateCorrupt === false`, `saveState` proceeds.
   The guard must not fire on a recovered file.
4. **Corrupt without a `.bak`** → `stateCorrupt === true`, `saveState` returns `false`, file
   byte-identical, `console.error` emitted.
5. `saveState` on a tracker from `newTracker()` (no `stateCorrupt` property) still writes — the guard
   must not fire on `undefined`.
6. **The injected-fake seam still works**: a fake `fs` receives the write on the happy path, and
   receives **nothing** when `stateCorrupt` is true. An injected `fs` never writes to the real disk.
7. `assessHealth()` on a corrupt tracker still returns `LEARNING` — unchanged by this patch, and the
   reason it is listed under *Deferred*.
8. Full suite 45/45, gated on exit code, three consecutive runs. `data/signal-outcomes.json`
   byte-identical after.

## Performance Impact

Measured on this machine:

| what | measured |
|---|---|
| `saveState()` with 300 outcomes (atomic + `.bak`) | **3.47 ms** per call |
| the proposed guard — 10,000,000 property reads | **8.3 ms total** (≈0.8 ns per call) |

The guard is one property read on a hot-path function that already costs 3.47 ms. It is not measurable.
On the corrupt path it makes `saveState` **faster**, because the write is skipped.

## Approval Recommendation

**SAFE.** It closes a reproducible data-loss path on the platform's calibration evidence, it restores a
promise the module already prints to the log, and it brings the last unguarded C3 writer in line with
`pop-seller.js:378` and `agents-engine.js:326`.

## Deferred Items

Not in this patch. Each is a separate concern and needs its own package.

1. **`assessHealth()` (`signal-health.js:69`) ignores `tk.stateCorrupt`.** A tracker that lost its
   history reports `LEARNING`, identical to a fresh install, and `HEALTHY` 30 outcomes later. The flag
   should surface in the returned object. *Separate concern: it changes a published status.*
2. **`loadState`'s injected-fake branch (`signal-health.js:151`)** does `catch (_) { raw = null }` and
   never sets `stateCorrupt`. Absent and corrupt are conflated there. Test-seam only; no production
   path reaches it.
3. **`server.js:5825`** — `catch (_) { _signalTracker = signalHealth.newTracker(…) }` is unreachable
   for the corruption case, because `loadState` returns rather than throws. Protected file; no defect
   today, but the dead catch will hide a future throw.
