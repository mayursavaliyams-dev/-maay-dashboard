# APPROVAL PACKAGE — `server.js` remaining write sites

**Status: PROPOSAL ONLY. Nothing has been modified. No code was generated into the repository.**
`server.js` is a protected file. Every hunk below awaits the owner's individual approval.

- Audited against HEAD `f8609ec`, working tree at 2026-07-09. Suite 42/42 green before and after (no change).
- Audit method: alias-proof grep for `.writeFileSync(` (my earlier pass missed `fs2`, `_fs2`, `_persistFs`
  and under-counted), then read every call site, its matching read path, its `catch` block, its caller,
  and its timer. Two claims in `docs/MASTER-CONTEXT.md` §18 were **wrong** and are corrected here.

---

## 0. Corrections to my own prior classification

`docs/MASTER-CONTEXT.md` §18 recorded ten sites. The count is right; two facts were not.

| §18 said | Measured truth |
|---|---|
| `:3575` is a "persist blob" | It is a **third writer to `config-overrides.json`** — the same file as `:3675` and `:3747` |
| `:539`, `:576` run on **5-second** timers | They run on **60-second** timers (`setInterval(_persistOptHLDay, 60*1000)` at `:547`, `:581`) |

The `fsync:false` recommendation for the hot caches was therefore based on a write rate **12× too high**.
It is withdrawn; see S6.

---

## 1. Site inventory — 10 writes, 7 packages

| # | line(s) | file written | class | risk | recommendation |
|---|---|---|---|---|---|
| **S1** | 3575, 3675, 3747 | `data/config-overrides.json` | control-plane | **HIGH** | **SAFE to approve** |
| **S2** | 5859 | `data/signal-paper-positions.json` | position ledger | **HIGH** | **SAFE to approve** |
| **S3** | 5838 | `data/vrp-monitor.json` | accumulated state | MEDIUM | SAFE to approve |
| **S4** | 1330 | `data/market-state.json` | intraday state | MEDIUM | SAFE to approve |
| **S5** | 4229 | `data/eod-<date>.json` | archive | LOW | SAFE to approve |
| **S6** | 539, 576 | `data/opt-hl/*.json`, `data/opt-candles/*.json` | derived cache | LOW | SAFE to approve |
| **S7** | 2028 | **`.env`** (live broker tokens) | secrets | **HIGH** | **NOT SAFE as one patch** — see S7 |

Live files at audit time, all currently parseable: `config-overrides.json` (12 keys),
`signal-paper-positions.json` (**2 open positions**), `vrp-monitor.json`, `market-state.json`.
**None of them has a `.bak`.** Only the three files already migrated to `safe-write.js` do.

---

# S1 — `config-overrides.json` · three writers · **HIGH**

## Section A — Current behaviour

Three independent read-modify-write cycles against one file, each with a silent catch on the read.

```js
// :3666  _persistEngineOverride(patch)   ← 8 callers: engine on/off toggles
let existing = {};
if (fs.existsSync(CONFIG_OVERRIDE_PATH)) {
  try { existing = JSON.parse(fs.readFileSync(CONFIG_OVERRIDE_PATH, 'utf8')); } catch (_) {}
}
fs.writeFileSync(CONFIG_OVERRIDE_PATH, JSON.stringify({ ...existing, ...patch }, null, 2));

// :3744  POST /api/strategy-config      ← same shape, `merged`
// :3572  POST /api/gamma-blast/enable   ← same shape, `o`
```

Boot-time reader `_loadConfigOverrides()` (`:3680`) also swallows a parse error and returns `{}`.

The file currently holds twelve keys, including `STRANGLE_CAPITAL: 700000`,
`STRANGLE_ENGINE_ENABLED`, `AI_AGENTS_ENABLED`, `MAX_DAILY_LOSS_PERCENT`.

## Section B — Root cause

**The read is where the data is destroyed; the write only records it.**

`catch (_) {}` on the read collapses *"the file is corrupt"* into *"the file is empty."* The very next
statement spreads that empty object and writes the result back. One toggle, and eleven keys are gone —
permanently, because the write is also non-atomic and there is no `.bak`.

This is the identical chain closed in C3 for every engine ledger, and identical in shape to the
`execution-engine` brake bug of C3-07: *a corrupt file read as a clean empty one.*

**Reproduced on an isolated copy of the live file** (never on `data/`):

```
keys before        : 12
after a torn write : file is corrupt? true
keys after 1 toggle: 1 -> {"BOUNCE_ENGINE_ENABLED":false}
STRANGLE_CAPITAL   : GONE
```

Consequence: `STRANGLE_CAPITAL` reverts to its env/code default, so the strangle engine silently
re-sizes the whole book. `MAX_DAILY_LOSS_PERCENT` vanishes, so the daily-loss brake reverts to default.
Nothing logs an error, because nothing detected one.

**Concurrency.** Within one process the read-modify-write is fully synchronous, so Node's event loop
cannot interleave two handlers — there is **no lost update from concurrent HTTP requests.** The lost
update is only across processes (container + local server on one bind mount), which is **TD-4**, and is
*not* solved by atomicity. Do not let this patch imply otherwise.

## Section C — Exact diff (minimal)

Three hunks. No function renamed, no code moved, no reformatting.

```diff
@@ server.js:3666  _persistEngineOverride
 function _persistEngineOverride(patch) {
   try {
     const fs = require('fs');
     const dir = require('path').dirname(CONFIG_OVERRIDE_PATH);
     if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
-    let existing = {};
-    if (fs.existsSync(CONFIG_OVERRIDE_PATH)) {
-      try { existing = JSON.parse(fs.readFileSync(CONFIG_OVERRIDE_PATH, 'utf8')); } catch (_) {}
-    }
-    fs.writeFileSync(CONFIG_OVERRIDE_PATH, JSON.stringify({ ...existing, ...patch }, null, 2));
+    // C3-08: a corrupt file must never read as an empty one — the merge would erase every
+    // persisted key (STRANGLE_CAPITAL, MAX_DAILY_LOSS_PERCENT) and the write would make it final.
+    const existing = require('./safe-write.js').readJsonSync(CONFIG_OVERRIDE_PATH, {
+      fallback: {},
+      onRecover: (reason, bak) => console.warn(`[config] overrides were corrupt (${reason}); recovered from ${bak}.`),
+    });
+    require('./safe-write.js').writeJsonSync(CONFIG_OVERRIDE_PATH, { ...existing, ...patch },
+      { pretty: true, backup: true });
     console.log('[config] persisted engine state:', patch);
-  } catch (err) { console.warn('[config] engine-state persist failed:', err.message); }
+  } catch (err) {
+    console.error(`[config] ⛔ REFUSING to persist ${JSON.stringify(patch)}: ${err.message}`);
+    console.error('[config] ⛔ config-overrides.json is unreadable. The file is untouched. ' +
+      'Fix or delete it, then retry. Engine state was NOT saved.');
+  }
 }
```

```diff
@@ server.js:3744  POST /api/strategy-config
-    let existing = {};
-    if (fs.existsSync(CONFIG_OVERRIDE_PATH)) {
-      try { existing = JSON.parse(fs.readFileSync(CONFIG_OVERRIDE_PATH, 'utf8')); } catch(_) {}
-    }
-    const merged = { ...existing, ...applied };
-    fs.writeFileSync(CONFIG_OVERRIDE_PATH, JSON.stringify(merged, null, 2));
+    const existing = require('./safe-write.js').readJsonSync(CONFIG_OVERRIDE_PATH, { fallback: {} });
+    const merged = { ...existing, ...applied };
+    require('./safe-write.js').writeJsonSync(CONFIG_OVERRIDE_PATH, merged, { pretty: true, backup: true });
     console.log('[config] persisted overrides:', applied);
```

```diff
@@ server.js:3572  POST /api/gamma-blast/enable
-    let o = {}; try { o = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) {}
-    o.GAMMA_BLAST_ENGINE_ENABLED = gammaBlastEngine.enabled;
-    fs.mkdirSync(p.dirname(f), { recursive: true });
-    fs.writeFileSync(f, JSON.stringify(o, null, 2));
+    const o = require('./safe-write.js').readJsonSync(f, { fallback: {} });
+    o.GAMMA_BLAST_ENGINE_ENABLED = gammaBlastEngine.enabled;
+    fs.mkdirSync(p.dirname(f), { recursive: true });
+    require('./safe-write.js').writeJsonSync(f, o, { pretty: true, backup: true });
```

**Deliberately NOT changed:** `_loadConfigOverrides()` (`:3680`) and the reset `unlinkSync` (`:3759`).
Boot-time behaviour is a separate concern and a separate approval — see "Deferred" below.

## Section D — Risk: **LOW** (the patch) / **HIGH** (the defect)

The behaviour change is: a corrupt overrides file now **refuses the write and logs loudly**, instead of
silently discarding eleven keys. A missing file still yields `{}` and writes normally. The API still
returns `{ ok: true }` on the strategy-config path — this patch does not change any HTTP status code.

**The one behaviour a reviewer must accept:** an operator toggling an engine while the file is corrupt
will now see the toggle apply **in memory but not persist**, with an error in the log. Previously it
persisted, and destroyed the rest of the config. Refusing is correct. It is also visible, which the
old behaviour was not.

## Section E — Rollback

```
git checkout -- server.js
```
No data migration, no schema change. `.bak` files created by the new writer are additive and ignored by
the old code. Reverting is complete and instantaneous.

## Section F — Characterization test (must FAIL before the fix)

`test/server-config-overrides.test.js`, new file. It must not touch `data/`; it copies the live file to
a temp directory and drives a verbatim transcription of the current function.

```
A. seed a 12-key overrides file
B. truncate it mid-write (simulate a crash)
C. call the CURRENT _persistEngineOverride({ BOUNCE_ENGINE_ENABLED: false })
   EXPECT (pinning the bug): the file now has exactly 1 key, STRANGLE_CAPITAL is gone
   → this assertion PASSES today, proving the defect exists
D. assert the POST-fix contract:
   the file still has 12 keys, or the write was refused and the corrupt bytes survive
   → this assertion FAILS today (exit 1). It is the tripwire.
```

Step D is the test that must fail first. Evidence it will: the reproduction in Section B, run on an
isolated copy, produced `keys after 1 toggle: 1`.

## Section G — Regression tests

1. missing file → `{}` → write succeeds → 1 key. (Today's behaviour, preserved.)
2. valid 12-key file → toggle one → **12 keys**, only the toggled value differs.
3. corrupt file **with** `.bak` → recovered → 12 keys, and a warning is logged.
4. corrupt file **without** `.bak` → write **refused**, corrupt bytes byte-identical afterwards,
   `console.error` emitted.
5. all three writers (`:3575`, `:3675`, `:3747`) satisfy 1–4 identically — the file has three authors
   and they must not disagree.
6. `POST /api/strategy-config/reset` still deletes the file (`unlinkSync`, unchanged).
7. Boot: `_loadConfigOverrides()` on a valid file still applies `setConfig` to both engines.
8. Full suite 42/42, gated on exit code, three consecutive runs.
9. `data/config-overrides.json` is byte-identical after the suite.

## Section H — Performance impact

Measured on this machine during C3: atomic + `fsync` = **2.91 ms**; with `.bak` = **4.93 ms**; naive
baseline (fresh file) = 1.80 ms. Fair ratio **≈1.6×**, not the 3× "speedup" I once mis-reported (on
Windows, `writeFileSync` *overwriting* costs 10–37 ms from truncate-in-place plus AV rescan).

Call rate: **operator-driven only** — 8 toggle endpoints plus one config POST. Realistic worst case is
a few dozen writes per day. Added cost ≈ **3 ms per toggle**. Not measurable by a human.

## Section I — Approval recommendation: **SAFE**

Highest value of the seven. It closes a live, reproduced, silent-destruction path on the file that
carries the capital figure and the daily-loss brake, and it costs 3 ms on a human-triggered action.

---

# S2 — `signal-paper-positions.json` · **HIGH**

## Section A — Current behaviour

```js
// :5856  boot
try { signalPaperEngine.load(JSON.parse(_sigFs.readFileSync(_SIG_PAPER_PATH, 'utf8'))); } catch (_) {}
// :5859  persist, called from :5912 (on trade) and :6115 (on enable)
function _persistSignalPaper() { try { _sigFs.writeFileSync(_SIG_PAPER_PATH, JSON.stringify(signalPaperEngine.toJSON(), null, 2)); } catch (_) {} }
```

The file on disk right now holds `positions, closed, allTime, enabled` — **2 open positions.**

## Section B — Root cause

The complete data-loss chain, unmodified:

1. crash mid-`writeFileSync` → truncated JSON
2. next boot → `JSON.parse` throws → `catch (_) {}` → **the engine starts believing it is flat**
3. first trade or first `/enable` → `_persistSignalPaper()` overwrites the file with the empty state
4. the two open positions, their entries and their `allTime` history are gone. Nothing logged.

This is a **position ledger**. It is the same class as `strangle-engine`'s trade ledger, which was
migrated in C3-02 precisely because of this. It was missed because it lives inside `server.js`.

Fail-open severity: an engine that thinks it is flat while positions exist will re-enter, doubling
exposure with no record of the first leg.

## Section C — Exact diff

```diff
@@ server.js:5856
-try { signalPaperEngine.load(JSON.parse(_sigFs.readFileSync(_SIG_PAPER_PATH, 'utf8'))); } catch (_) {}
+// C3-09: a corrupt position ledger must never be read as "flat".
+let _sigPaperCorrupt = false;
+try {
+  const _sp = require('./safe-write.js').readJsonSync(_SIG_PAPER_PATH, {
+    fallback: null,
+    onRecover: (reason, bak) => console.warn(`[signal-paper] ledger was corrupt (${reason}); recovered from ${bak}.`),
+  });
+  if (_sp) signalPaperEngine.load(_sp);
+} catch (e) {
+  _sigPaperCorrupt = true;
+  signalPaperEngine.enabled = false;
+  console.error(`[signal-paper] ⛔ LEDGER UNRECOVERABLE: ${e.message}`);
+  console.error('[signal-paper] ⛔ Cannot know which positions are open — engine DISABLED (fail closed). ' +
+    'Saving is refused; the file is untouched for forensics.');
+}
```

```diff
@@ server.js:5859
-function _persistSignalPaper() { try { _sigFs.writeFileSync(_SIG_PAPER_PATH, JSON.stringify(signalPaperEngine.toJSON(), null, 2)); } catch (_) {} }
+function _persistSignalPaper() {
+  if (_sigPaperCorrupt) return;   // never overwrite a ledger we could not read
+  try { require('./safe-write.js').writeJsonSync(_SIG_PAPER_PATH, signalPaperEngine.toJSON(), { pretty: true, backup: true }); }
+  catch (e) { console.error(`[signal-paper] persist failed: ${e.message}`); }
+}
```

A missing file yields `fallback: null` → `load()` is not called → the engine starts genuinely flat,
exactly as today. **Absent and corrupt are different, and only corrupt disables the engine.**

## Section D — Risk: **MEDIUM** (the patch) / **HIGH** (the defect)

The patch introduces one new module-scope variable (`_sigPaperCorrupt`) and disables one paper engine
on an unrecoverable ledger. It is paper-only — no live order is possible. The disable is the point:
this is the fail-closed rule applied to a position ledger.

Reviewer must accept: on a corrupt ledger, `/api/signal-paper/*` will report `enabled: false` until an
operator intervenes. That is louder than today, and today's alternative is doubled exposure.

## Section E — Rollback

`git checkout -- server.js`. `.bak` is additive; the old loader ignores it.

## Section F — Characterization test (must FAIL before the fix)

`test/server-signal-paper.test.js`:

```
A. seed a ledger with 2 open positions
B. truncate it
C. run the CURRENT boot loader → engine reports 0 open positions   ← passes today (pins the bug)
D. call the CURRENT _persistSignalPaper() → the 2 positions are now gone from disk ← passes today
E. POST-fix contract: after C, either the positions are restored from .bak,
   or the engine is disabled AND the corrupt bytes on disk are byte-identical
   → FAILS today (exit 1)
```

## Section G — Regression tests

1. missing file → engine flat, enabled, writes normally.
2. valid file with 2 open → both restored, `allTime` intact.
3. corrupt + `.bak` → recovered, warning logged, engine enabled.
4. corrupt, no `.bak` → engine `enabled === false`, `_persistSignalPaper()` is a no-op, file unchanged.
5. `/api/signal-paper/enable` on a corrupt ledger does not resurrect the engine silently.
6. Suite 42/42 ×3; `data/signal-paper-positions.json` byte-identical after the run.

## Section H — Performance impact

Two call sites: on trade, and on enable. **+3 ms per trade.** Irrelevant next to a broker round-trip.

## Section I — Approval recommendation: **SAFE**

---

# S3 — `vrp-monitor.json` · **MEDIUM**

## Section A

```js
// :5829 boot
try { vrpMonitor.load(JSON.parse(_sigFs.readFileSync(_VRP_PATH, 'utf8'))); } catch (_) {}
// :5838 inside _recordVRP(ctx)
try { _sigFs.writeFileSync(_VRP_PATH, JSON.stringify(vrpMonitor.toJSON(), null, 2)); } catch (_) {}
```

## Section B — Root cause

Same silent-catch pair. The distinction from S2: this is a **40-observation rolling window** of implied
vs realised volatility. It is *accumulated evidence*, not position state. Losing it does not double
exposure; it silently resets the VRP regime filter to "no history", which makes the filter permissive
until the window refills. Fail-open, but bounded and self-healing.

**It is not reconstructible** — the observations are not stored anywhere else — so it earns a `.bak`.

## Section C — Exact diff

```diff
@@ server.js:5829
-try { vrpMonitor.load(JSON.parse(_sigFs.readFileSync(_VRP_PATH, 'utf8'))); } catch (_) {}
+try {
+  const _v = require('./safe-write.js').readJsonSync(_VRP_PATH, { fallback: null });
+  if (_v) vrpMonitor.load(_v);
+} catch (e) {
+  // Accumulated evidence, not position state: an unreadable window rebuilds in ~40 observations.
+  // Say so once, loudly, and start empty — but never overwrite the file we could not read.
+  _vrpCorrupt = true;
+  console.error(`[vrp] monitor state unreadable (${e.message}); starting with an EMPTY window. ` +
+    'The VRP filter is permissive until it refills. File untouched.');
+}
```

```diff
@@ server.js:5838
-  try { _sigFs.writeFileSync(_VRP_PATH, JSON.stringify(vrpMonitor.toJSON(), null, 2)); } catch (_) {}
+  if (!_vrpCorrupt) {
+    try { require('./safe-write.js').writeJsonSync(_VRP_PATH, vrpMonitor.toJSON(), { pretty: true, backup: true }); }
+    catch (e) { console.error(`[vrp] persist failed: ${e.message}`); }
+  }
```

Requires one new declaration `let _vrpCorrupt = false;` immediately above `:5829`.

## Section D — Risk: **LOW**

Behaviour on the happy path is byte-identical. On corruption the engine is *more* conservative in what
it writes and *louder* about what it lost.

## Section E — Rollback
`git checkout -- server.js`

## Section F — Characterization test (must FAIL before the fix)
Seed a 40-observation window · truncate · boot → today the window silently reads as empty and the very
next `_recordVRP` **overwrites the file with a 1-observation window**. Assert (post-fix) that the file
is untouched. Fails today.

## Section G — Regression tests
Missing → empty window, writes normally · valid → 40 observations restored · corrupt + `.bak` → recovered ·
corrupt without `.bak` → empty window **and no write** · `_recordVRP` still calls `_recordGexVix`.

## Section H — Performance impact
`_recordVRP` fires **once per instrument per day** (`_vrpLastRecord[ctx.inst] = today` guards it).
**+3 ms/day.**

## Section I — **SAFE**

---

# S4 — `market-state.json` · **MEDIUM**

## Section A

```js
// :1330  _writeMarketState()   — debounced 2 s by _persistMarketState()
_persistFs.writeFileSync(_persistPath, JSON.stringify({ date, sensex:{orbHigh,...}, nifty:{...} }));
// :1345  _restoreMarketState()
const s = JSON.parse(_persistFs.readFileSync(_persistPath, 'utf8'));
```

Also called synchronously from `_gracefulShutdown` (`:7280`).

## Section B — Root cause

`catch (_) { /* best-effort */ }` on write, and the restore path guards `existsSync` but not a parse
failure. The payload is the **opening-range breakout levels** (`orbHigh`, `orbLow`) and the day's
high/low, for both instruments. Losing them mid-session means the ORB strategy has no reference range
for the rest of the day — it does not fail loudly, it simply stops recognising a breakout.

The file is **partially reconstructible** (the day's high/low can be re-derived from the live feed; the
opening range cannot, once 09:15–09:30 has passed).

Additional exposure: `_writeMarketState()` is called from the shutdown path. A crash *during shutdown*
truncates the file, and the next boot's `_restoreMarketState()` throws inside a `try` that returns
silently — the engines start with no ORB.

## Section C — Exact diff

```diff
@@ server.js:1328
 function _writeMarketState() {
   try {
-    _persistFs.writeFileSync(_persistPath, JSON.stringify({
+    require('./safe-write.js').writeJsonSync(_persistPath, {
       date: todayDate,
       sensex: { orbHigh, orbLow, dayHigh, dayLow },
       nifty:  { orbHigh: niftyOrbHigh, orbLow: niftyOrbLow, dayHigh: niftyDayHigh, dayLow: niftyDayLow }
-    }));
-  } catch (_) { /* best-effort */ }
+    }, { backup: true });
+  } catch (e) { console.warn(`[market-state] persist failed: ${e.message}`); }
 }
```

```diff
@@ server.js:1345
-    const s = JSON.parse(_persistFs.readFileSync(_persistPath, 'utf8'));
+    const s = require('./safe-write.js').readJsonSync(_persistPath, {
+      onRecover: (reason, bak) => console.warn(`[market-state] state was corrupt (${reason}); recovered from ${bak}.`),
+    });
```

The enclosing `try` at `:1343` already guards the restore; an unrecoverable file will now log its reason
via the existing `catch`, instead of failing an implicit `JSON.parse`. **The `existsSync` early-return
at `:1344` is left in place** so a missing file still returns silently.

## Section D — Risk: **LOW**

No new state. The debounce (`:1337`) is untouched. The shutdown path gains durability, which is the
one place it was most needed.

## Section E — Rollback
`git checkout -- server.js`

## Section F — Characterization test (must FAIL before the fix)
Seed a state file with an ORB · truncate · call the current `_restoreMarketState()` → `orbHigh` stays
`null` and **no error is logged**. Post-fix: it recovers from `.bak`, or logs. Fails today.

## Section G — Regression tests
Missing → silent return, ORB null (unchanged) · stale date → ignored (unchanged) · valid → both
instruments restored · corrupt + `.bak` → recovered · debounce still collapses N calls in 2 s into one
write · `_gracefulShutdown` still flushes before exit.

## Section H — Performance impact

Debounced to at most **one write per 2 s**, and only when a high/low actually moves. Worst case during
an active session ≈ 1,800 writes/session. At +1.1 ms (atomic, no `.bak`) that is **~2 s of added CPU
across a 6.25-hour session** — 0.009%. With `.bak` (+3.1 ms) it is ~5.6 s, or 0.025%.

**Recommendation: `{ backup: true }` is affordable here.** But if the reviewer prefers, `{ backup: false }`
halves it, and the ORB is re-derivable from the next tick for `dayHigh`/`dayLow` only. I recommend
keeping `.bak` because the opening range is **not** re-derivable after 09:30.

## Section I — **SAFE**

---

# S5 — `eod-<date>.json` · **LOW**

## Section A
`:4229` `_fs2.writeFileSync(_path.resolve('./data/eod-' + dayStr + '.json'), JSON.stringify(s, null, 2));`
inside `try { … } catch` at `:4225`. Called from `:4263`, `:4269` (5-minute snapshotter) and `:7284`
(graceful shutdown).

## Section B — Root cause
Non-atomic write of a **daily archive**. A crash mid-write leaves a truncated EOD file. Nothing reads
it back in `server.js`, so there is no fail-open — but the file *is* the day's permanent record of P&L
and win rate, and it is written on the shutdown path, which is exactly when a crash is likely.

Also note `_path.resolve('./data/…')` resolves against **`process.cwd()`**, not `__dirname`. Starting
the server from another directory writes the archive somewhere else. **Out of scope for this patch —
flagged as a separate finding.**

## Section C — Exact diff

```diff
@@ server.js:4229
-    _fs2.writeFileSync(_path.resolve(`./data/eod-${dayStr}.json`), JSON.stringify(s, null, 2));
+    require('./safe-write.js').writeJsonSync(_path.resolve(`./data/eod-${dayStr}.json`), s, { pretty: true });
```

No `.bak`: each day's file is written afresh from in-memory state, and a same-day rewrite is not a merge.

## Section D — Risk: **LOW**
Single line. Same path, same content, same `catch`.

## Section E — Rollback
`git checkout -- server.js`

## Section F — Characterization test (must FAIL before the fix)
Concurrent-reader harness (the one used in `safe-write.test.js`): while `_persistEod` writes, a reader
in a loop parses the file. Today: unparseable and empty reads occur. Post-fix: **0 of N reads corrupt.**
The measured baseline for this pattern is *256 reads → 41 unparseable, 199 empty*.

## Section G — Regression tests
Snapshot at 5-minute mark writes a parseable file · `isFinal` still prints the banner · shutdown still
writes before exit · a second call for the same `dayStr` overwrites cleanly.

## Section H — Performance impact
2 calls/hour during market hours plus 1 on shutdown. **+1.1 ms each.** Immaterial.

## Section I — **SAFE**

---

# S6 — `opt-hl/*.json` and `opt-candles/*.json` · **LOW**

## Section A
`:539` and `:576`, each on a **60-second** `setInterval` (`:547`, `:581`). Both are derived caches:
per-strike option high/low for the day, and 1-minute option candles. Both prune to a retention window
(120 files / 40 files) with `unlinkSync` inside `catch (_) {}`.
Reader at `:594` parses candle files with a silent catch.

## Section B — Root cause
Non-atomic writes on a timer. A crash leaves a truncated day-file which `:594` then skips silently.
The data is **derived from the live feed and re-accumulates within the same session**, so there is no
data-loss chain here — only a corrupt artefact that the reader hides.

**My §18 recommendation of `fsync:false` was based on a 5-second timer. The timer is 60 seconds.**
At 60 s, fsync costs ~1.1 ms per minute. There is no reason to weaken durability.

## Section C — Exact diff

```diff
@@ server.js:539
-    fs2.writeFileSync(path2.join(_optHLDir, `${date}.json`), JSON.stringify(out));
+    require('./safe-write.js').writeJsonSync(path2.join(_optHLDir, `${date}.json`), out);
```

```diff
@@ server.js:576
-    fs2.writeFileSync(path2.join(_optCandDir, `${day}.json`), JSON.stringify({ date: day, savedAt: Date.now(), series }));
+    require('./safe-write.js').writeJsonSync(path2.join(_optCandDir, `${day}.json`), { date: day, savedAt: Date.now(), series });
```

No `.bak` (regenerable), default `fsync: true` (once a minute, it is free).
The reader at `:594` is **not** changed — a corrupt historical day-file should still be skipped, not fatal.

## Section D — Risk: **LOW**

## Section E — Rollback
`git checkout -- server.js`

## Section F — Characterization test (must FAIL before the fix)
Concurrent reader against a ~1 MB candle file during write. Today: unparseable reads. Post-fix: zero.

## Section G — Regression tests
Retention prune still caps at 120 / 40 files · `:594` still skips a bad historical file without
throwing · `_persistOptHLDay` still early-returns when `count === 0`.

## Section H — Performance impact
**+1.1 ms per minute, per cache.** Two caches → +2.2 ms/min → **0.0037% of wall clock.**

## Section I — **SAFE**

---

# S7 — `.env` rewrite · **HIGH** · **NOT SAFE as a single patch**

## Section A — Current behaviour

`GET /auth/dhan/callback` (`:2028`) rewrites the entire `.env` after a token exchange:

```js
let env = _fs.readFileSync(_envPath, 'utf8');
env = env.replace(/^DHAN_ACCESS_TOKEN=.*$/m, `DHAN_ACCESS_TOKEN=${cleanToken}`);
_fs.writeFileSync(_envPath, env);
```

Measured: `.env` is **8,404 bytes, 92 lines, mode `0644`**. It contains `DHAN_ACCESS_TOKEN`,
`UPSTOX_ACCESS_TOKEN`, `ANTHROPIC_API_KEY`, `AUTH_SECRET`, `TELEGRAM_BOT_TOKEN`, `KOTAK_CONSUMER_KEY`.

## Section B — Root cause, three distinct defects

1. **Non-atomic rewrite of the credential file.** A crash between truncate and write leaves a partial
   `.env`. The next boot loses every variable below the truncation point — broker tokens, `AUTH_SECRET`,
   engine capital. There is no backup. This is the single highest-consequence write in the process.
2. **Mode `0644`.** World-readable secrets. `writeFileSync` on an existing file preserves the old mode,
   so an atomic `rename` **must** be told `mode: 0o600` explicitly or it will silently *change* the
   permissions of the temp file into place. This is a real hazard of naive atomic-write adoption and is
   why this site cannot ride along with the others.
3. **`_envPath = require('path').resolve('./.env')`** (`:1978`) resolves against `process.cwd()`.
   Starting the server from any other directory makes this endpoint **write a new `.env` in the wrong
   place**, and read the wrong one. The project's own operating note says *"run the server from the
   project root"* — that note is load-bearing, and it should not be.

## Section C — Exact diff (proposed, **for a separate review**)

```diff
@@ server.js:2028
-    _fs.writeFileSync(_envPath, env);
+    // C3-10: the credential file. Atomic, and 0600 — an atomic rename installs the TEMP file's
+    // mode, so it must be stated explicitly or the rewrite silently re-permissions .env.
+    require('./safe-write.js').writeFileAtomicSync(_envPath, env, { mode: 0o600 });
```

**Blocking question for the owner before this hunk can be approved:** `safe-write.writeFileAtomicSync`
accepts `opts.mode`, but the *current* file is `0644`. Applying `0600` is a **permission change on a
file outside `data/`**, and on Windows the mode bits are largely advisory. I will not change the
permissions of a file the owner created without an explicit instruction.

Options, for the owner to choose:
- **(a)** `mode: 0o600` — tighten. Correct on Linux/Docker; near-no-op on Windows.
- **(b)** preserve the existing mode explicitly (`mode: statSync(_envPath).mode`) — atomic, no
  permission change. Strictly better than today, changes nothing else.
- **(c)** leave `.env` writing alone entirely, and instead **stop writing `.env` from an HTTP handler** —
  persist the token to `data/broker-tokens.json` (mode `0600`, atomic, `.bak`) and read it at boot with
  `.env` as the fallback. This removes the credential file from the request path altogether.

**I recommend (c), as its own change, after (b) lands as a one-line safety net.** I have not written
either. Defect 3 (`cwd` resolution) must also be its own hunk, because it changes *which file* is
written — that is a behaviour change, not a durability change, and it deserves to fail its own test.

## Section D — Risk: **HIGH**
Touches credentials, an OAuth callback, and file permissions. Three defects with three different blast
radii. Bundling them is how a "safety" patch locks an operator out of their own broker session.

## Section E — Rollback
`git checkout -- server.js`. **But note:** if option (a) is taken and `.env` is rewritten once, the
permission change **is not rolled back by git** — `.env` is untracked. Rollback would need
`chmod 644 .env` on POSIX. This asymmetry is the reason for the separate review.

## Section F — Characterization test (must FAIL before the fix)
Copy `.env` to a temp dir · run the current rewrite with a `writeFileSync` stub that throws after
writing 200 bytes · assert the file is truncated and `AUTH_SECRET` is gone → **passes today**.
Post-fix contract: the file is either the old content or the new content, never a prefix → fails today.

## Section G — Regression tests
Token line replaced in place, all 92 lines preserved, byte-for-byte outside that line · a `.env` with no
`DHAN_ACCESS_TOKEN` line gets one appended · `process.env` still updated in memory · the Dhan client
still reconnects without restart · **no test may run against the real `.env`.**

## Section H — Performance impact
One write per OAuth callback. Irrelevant.

## Section I — Approval recommendation: **NOT SAFE** as presented.

Split into three approvals: **(1)** atomicity preserving the current mode; **(2)** the mode decision;
**(3)** move the token out of `.env`, and fix the `cwd` resolution. Approve them in that order.

---

## 2. Deferred — found during this audit, deliberately NOT patched here

| finding | why deferred |
|---|---|
| `_loadConfigOverrides()` (`:3680`) swallows a parse error at boot and returns `{}` — every engine then runs on env defaults, silently | Boot-time fail-open. Fixing it means deciding whether the server should **refuse to start** on a corrupt config. That is an owner decision, not a durability patch. |
| `_envPath` / `_persistEod` resolve against `process.cwd()`, not `__dirname` | Changes *which file* is written. Behaviour change; needs its own characterization test. |
| `:594`, `:5046`, `:5105`, `:6743` — four more `JSON.parse(readFileSync)` with silent catches | Read-only paths; no write follows, so no data-loss chain. Lower priority than the seven above. |
| **TD-4**, lost updates across processes | Atomicity does **not** solve it. Needs the boot-time advisory lock (`withLock` already exists in `safe-write.js`). Must not be conflated with this package. |

---

## 3. Recommended approval order

1. **S1** — `config-overrides.json`. Reproduced destruction of 11 keys including `STRANGLE_CAPITAL`.
2. **S2** — `signal-paper-positions.json`. A position ledger with 2 open positions and no backup.
3. **S4** — `market-state.json`. The opening range is not re-derivable after 09:30.
4. **S3** — `vrp-monitor.json`.
5. **S5**, **S6** — archive and caches. One commit, or fold into a cleanup.
6. **S7** — `.env`. Three separate approvals, in the order given in S7-I.

One concern per commit. Characterization test proven to fail first, in every case. Full suite gated on
exit code, three runs, before each commit. `data/` verified byte-identical after every suite run.

**No code has been written. No file has been modified. Nothing is staged. Nothing is committed.**
