# C3 · Step 1 — `safe-write.js`: atomic, fail-closed JSON persistence

| | |
|---|---|
| **Date** | 2026-07-09 |
| **Severity of the defect addressed** | **Critical — silent, unrecoverable data loss** |
| **Files added** | `safe-write.js`, `test/safe-write.test.js`, `test/fixtures/c3-writer.js`, `scripts/rollback-C3.sh` |
| **Files modified** | **none** |
| **Tests** | 32/32 → **33/33 suites**; safe-write: **48 assertions** |
| **`server.js`** | untouched |

---

## Architecture Notes

### The defect, measured

Every ledger was persisted with `fs.writeFileSync(file, json)` inside `catch (_) {}`. That is three
defects wearing one coat.

**1 — Not atomic.** `writeFileSync` truncates, then writes. A reader arriving in between sees an empty or
half-written file. Measured on this machine, ~20k-row ledger, concurrent reader:

```
naive writeFileSync : 256 reads → 41 unparseable, 199 empty     (94% corrupt)
safe-write          : 441 reads →  0 unparseable,   0 empty
```

**2 — Not crash-safe.** Kill the process mid-write and the file stays truncated. Verified: 6 × `SIGKILL`
during an in-flight write; with `safe-write` the ledger remained complete and parseable every time.

**3 — Silent, and therefore fatal.** The chain that destroys the record:

```
1. crash (or Ctrl-C) mid writeFileSync   → ledger.json is empty or truncated
2. next boot: _loadTrades() JSON.parse throws → catch { return [] }
3. first save of the day: _saveTrades()  → writes [] over the ledger
4. every prior trade is gone. No error. Nowhere.
```

`strangle-engine.js:126` and `agents-engine.js:299` both degrade a corrupt ledger to `[]` and then
overwrite it. **A single mistimed Ctrl-C can destroy the forward-test evidence that gates live approval.**

TD-4 (the container and a local `node server.js` sharing one bind-mounted `data/`) made this reachable
from a second process, which is why C3 was re-prioritised above security work.

### Design

```
serialize → validate (JSON.parse round-trip) → write to temp in the SAME dir
          → fsync(fd) → chmod → rename(temp, file)  ← the atomic step
          → best-effort fsync(dir)
```

The temp file lives in the target's own directory because `rename` is only atomic **within one
filesystem**. On error at any stage the temp is unlinked and the exception is rethrown; the original file
is never touched.

**Platform facts, probed rather than assumed:**

| | result |
|---|---|
| `renameSync` over an existing file | atomic overwrite — works on Windows (libuv → `MoveFileExW`, `REPLACE_EXISTING`) |
| `fsync` on a file fd | works |
| `fsync` on a **directory** fd | `EPERM` on Windows. Best-effort; reported as `dirDurable: false` |

### What this does NOT do — stated plainly

**Atomicity is not mutual exclusion.** Two concurrent writers each produce a *complete, valid* file, but the
last `rename` wins and the other's update is lost. This module prevents **corruption**, not **lost updates**.
Verified: 3 concurrent writers + a reader → 2,585 reads, 0 corrupt, final file one valid version.

The correct fix for lost updates is a single writer per ledger, or an append-only log — **not** a lock.
`withLock()` exists for callers that genuinely need read-modify-write serialization; it is **advisory**
(it only excludes processes that also call it) and breaks a stale lock after `staleMs`.

`NaN` and `Infinity` serialize to `null`. That is `JSON.stringify`'s behaviour, not ours. It is valid JSON
and silently lossy; documented and asserted rather than blocked.

## API

| function | contract |
|---|---|
| `writeJsonSync(file, value, opts)` | serialize → **validate** → atomic replace. Throws on unserializable input |
| `writeFileAtomicSync(file, data, opts)` | same, for a string/Buffer |
| `readJsonSync(file, opts)` | parse; on corruption recover from `<file>.bak`; **throws rather than guessing** |
| `cleanupTemp(dir)` | remove inert `.tmp-*` orphans left by a crashed writer |
| `withLock(file, fn, opts)` | advisory cross-process lock, released even if `fn` throws |

`opts`: `fsync` (default `true`) · `backup` (default `false`) · `pretty` · `mode` · `fallback` · `onRecover`

`readJsonSync` **fails closed**: a corrupt file with no backup throws. A missing file throws unless an
explicit `fallback` is supplied. Returning `[]` on a parse error is precisely how the ledger was lost.

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| This commit breaks something | **None** | — | New leaf module, zero consumers, zero existing files modified |
| `rename` not atomic on some filesystem | Low | High | Probed on this machine. Temp is always in the target's directory. A cross-device rename would throw `EXDEV`, not silently copy |
| `.bak` doubles write cost | Certain when enabled | +2.0 ms | Opt-in, per call. Recommended for trade ledgers, not for high-frequency caches |
| Orphaned `.tmp-` files accumulate | Certain after crashes | Cosmetic | Inert — the rename never happened. `cleanupTemp()` provided; `scripts/rollback-C3.sh` lists them |
| Lost updates under concurrent writers | Real | Medium | **Not solved by this module.** Documented above; see Technical Debt |
| `withLock` misused as a correctness guarantee | Plausible | Medium | Documented as advisory; timeout throws rather than proceeding |

## Test Results

```
48 assertions passed          suites 32/32 → 33/33
12/12 consecutive runs clean  wall clock 3.9 s
```

The suite **reproduces the defect before proving it fixed** — a test that only asserts "safe-write writes a
file" would prove nothing.

| group | what it proves |
|---|---|
| Control + race | naive is observably torn; safe-write yields 0 unparseable, 0 empty |
| Crash | 6 × `SIGKILL` mid-write → ledger complete every time; orphan temps inert; `cleanupTemp` clears them |
| Interrupted write | injected `ENOSPC` at `rename` and `EIO` at `write` → **throws**, original byte-identical, no temp left |
| Invalid JSON | circular / `undefined` / function / `BigInt` all rejected **before** the file is touched |
| Recovery | truncated ledger recovers from `.bak` and reports it; corrupt-with-no-backup **throws**; corrupt backup **throws**; missing file throws unless `fallback` given |
| Permissions | `0600` survives replacement |
| Concurrency | 3 writers + reader → 2,585 reads, 0 corrupt |
| Lock | released on throw; stale lock broken; live lock times out |
| Regression | pure leaf, zero local dependencies |

## Performance Impact

Two naive baselines are reported, because they differ by ~6–50× and only one is a fair comparison.

| | ms | vs fair baseline |
|---|---|---|
| naive, **fresh** file *(fair baseline — same syscall shape as our temp write)* | 1.80 | 1.0× |
| atomic, `fsync:false` | 2.61 | 1.4× |
| **atomic, `fsync:true`** | **2.91** | **1.6×** |
| atomic + backup | 4.93 | 2.7× |
| naive, **overwrite in place** *(what the code does today)* | 10.42 | 5.8× |

*(239 KB payload. Timings swing with the filesystem cache and the on-access AV scanner; an earlier run
measured the overwrite path at 37.5 ms.)*

Atomic writing is **~1.6× the theoretical minimum** and, on this machine, **faster than what production
does today** — because truncate-in-place is unusually expensive on Windows. **That speedup is a platform
artefact and is not claimed as a benefit of this module.**

Realistic ledger sizes: 1 KB → 2.1 ms, 11 KB → 2.8 ms, 114 KB → 4.3 ms per write.

`strangle-engine` saves on trade close (a handful per day). The cost is irrelevant. `server.js`'s
option-H/L cache writes on a 5 s timer — that one deserves a measurement before migration.

The suite **deliberately does not assert `fsync_time > no_fsync_time`**: the delta is ~0.3 ms and swings
with the AV scanner, so a timing comparison in a correctness gate is a coin-flip. It asserts that `fsync`
*ran* (`durable: true`) and leaves milliseconds to the table.

## Migration Notes

This step adds the module and **migrates nothing**. Consumers follow one per commit, each with a
characterization test capturing the ledger's current bytes first:

| step | target | notes |
|---|---|---|
| C3-02 | `strangle-engine.js` (`_saveTrades`, `_saveIv`) | `backup: true` on the trade ledger |
| C3-03 | `agents-engine.js` (`_saveTrades`, `_saveImpactHistory`, `_saveOpen`) | `_saveOpen` holds condors across restarts |
| C3-04 | `gamma-blast-engine.js` (`_saveTrades`) | |
| C3-05 | `forward-test-logger.js`, `signal-health.js` | the live-approval gate |
| C3-06 | `database.js` | `write()` returns `false` on error and `read()` returns `[]` on a parse failure — **two silent failures**, see Technical Debt |
| C3-07 | `execution-engine.js` | requirement-9 protected; needs approval |
| deferred | `server.js` (10 sites) | requirement 9. H/L + candle caches, not ledgers |

Each migration also replaces `catch { return [] }` with `readJsonSync(..., { fallback: [] })`, so a
**missing** ledger yields `[]` while a **corrupt** one raises instead of being overwritten. That is the
half of the fix that actually stops the data loss; atomic writing alone only stops *creating* the corruption.

## Rollback Plan

```bash
bash scripts/rollback-C3.sh --check    # list what would be removed; touch nothing
bash scripts/rollback-C3.sh            # remove the module + tests, after confirmation
```

No existing file was modified, so nothing can be lost. The script **deliberately preserves `.bak` files** —
they may be the only surviving copy of a ledger — and lists any orphaned `.tmp-` files and stale `.lock`
files so an operator can see whether a writer died mid-flight.

## Technical Debt

- **TD-4 (re-evaluated).** Atomic writes remove the *corruption* half of TD-4. The *lost-update* half
  remains: two processes writing one bind-mounted ledger will silently overwrite each other. **`safe-write`
  does not fix this and does not claim to.** Recommended: a single writer per ledger, enforced by a
  boot-time advisory lock on `data/`, so a second server refuses to start rather than racing. Downgraded
  **High → Medium**, not closed.
- **TD-5 (new).** `database.js:69` `write()` swallows the error and returns `false`; `database.js:57`
  `read()` returns `[]` on a parse failure. Two silent failures in the module named "database", violating
  the charter's *no silent failures* and *fail closed* rules. Only `server.js` uses it. Fix in C3-06.
- **TD-6 (new).** The `catch { return [] }` loaders (`strangle-engine.js:126`, `agents-engine.js:299`,
  `gamma-blast-engine.js`) are the actual mechanism of data loss. Atomic writing prevents new corruption;
  it does **not** repair a ledger already corrupted, nor stop these loaders from overwriting one. Fixed per
  engine in C3-02…C3-04.
- Eight `bt-*.js` CLIs write into `data/` without `mkdirSync`; developer tools, never run in the container.
