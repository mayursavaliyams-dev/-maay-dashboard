# C1c · Step 0a — the repository did not deploy from git

| | |
|---|---|
| **Date** | 2026-07-09 |
| **Severity** | **Critical** (deployment / cloud-readiness) |
| **Files changed** | **0 edited.** 15 files `git add`ed, contents untouched (md5 verified). |
| **Tests added** | `test/repo-integrity.test.js` (new suite, 7 assertions) |
| **Backup** | `backups/migration-C1c-0a-untracked-20260709-170607/ROLLBACK.sh` (`GIT_HEAD.txt` = `c42f5ec`) |
| **Tests before** | 25/25 suites |
| **Tests after** | **26/26 suites** |

---

## Current state (before)

Three modules existed on disk, were `require`d by tracked source, and had **never been `git add`ed**.
They were not `.gitignore`d — simply never added.

| Untracked module | Required by | Boot-critical? |
|---|---|---|
| `crash-analyzer.js` | `server.js:2168` — top-level `const CrashAnalyzer = require('./crash-analyzer')` | **YES** |
| `forward-test-logger.js` | `strangle-engine.js:119` (constructor); `server.js:3533` does `new StrangleEngine({…})` at top level | **YES** |
| `backtest-tv/run.js` | `backtest-tv/sell.js:32` | No (tooling) |

## Problem

A fresh `git clone && npm install && npm start` **died at boot**:

```
✗ require("./server.js")   → MODULE_NOT_FOUND: Cannot find module './crash-analyzer'
✗ new StrangleEngine()     → MODULE_NOT_FOUND: Cannot find module './forward-test-logger.js'
```

## Root cause

**"The file exists on my machine" was never distinguished from "the file is in the repository."**

Two things hid it:

1. `Dockerfile:11` is `COPY . .`, which copies the *working tree* — untracked files included. So a **local**
   `docker build` worked. Only a build from a git checkout (CI, cloud deploy) failed. Nobody built from a
   clean checkout, so nobody saw it.
2. No test could see it. Every suite asserts against the filesystem, and on the dev machine the filesystem
   is correct. A test that calls `fs.existsSync` is structurally incapable of detecting this defect.

**Ownership:** `crash-analyzer.js` predates this migration series. `forward-test-logger.js` is mine —
commit `25b4be1` (C1a) committed `strangle-engine.js` containing `require('./forward-test-logger.js')`
while leaving the required file untracked. I verified the *fix* worked and never verified the *dependency
was committed*.

## Solution

`git add` the files. **No file contents were modified** — md5 sums verified identical before and after
staging. Plus a guard suite that checks **git**, not the filesystem.

### Scope correction (reported, not silently absorbed)

Option A was approved for **3 files**. Tracking `backtest-tv/run.js` immediately exposed *its* own
untracked dependencies — invisible until it became tracked. The true transitive closure is **15 files**:

```
crash-analyzer.js  forward-test-logger.js  backtest-tv/run.js  export-backtest-excel.js
backtest-real/{aggregator,data-fetcher,dhan-client,expiry-days,instruments,
               strategy-ema,strategy-ema-orb,strategy-hl-reversal,strategy-runner,
               synth-option-pricer,trade-simulator}.js
```

1,632 lines / 84 KB of source. **No data files. No credentials.** `backtest-real/dhan-client.js` tripped
the credential scan; inspection showed it reads `process.env.DHAN_ACCESS_TOKEN` and *throws* when absent
(`dhan-client.js:17,21`) — no literal token anywhere in the closure.

This is not a new decision; it is the approved decision applied correctly. `backtest-tv/run.js` cannot
resolve without its own dependencies.

## Impact

| Area | Impact |
|---|---|
| Runtime (your machine) | **None.** Files already on disk; nothing edited. |
| Fresh clone / CI / cloud deploy | **Fixed.** Previously crashed at boot. |
| Docker | Local build was already fine; a git-checkout build now works too. |
| Database / API / dashboards | None. |
| Backward compatibility | **100%.** Pure additions. |

## Risk

Near zero. The only mutation is git's index. Rollback is `git rm --cached` — files stay on disk.

## Test results

```
25/25 → 26/26 suites passed
test/repo-integrity.test.js — 7 assertions
```

The guard is a **real** regression test. Before the fix it failed and named every offending edge:

```
✗ backtest-tv/sell.js:9        → require('./run.js')                 UNTRACKED
✗ server.js:2168               → require('./crash-analyzer')         UNTRACKED
✗ strangle-engine.js:74        → require('./forward-test-logger.js') UNTRACKED
✗ test/strangle-engine.test.js → require('../forward-test-logger.js') UNTRACKED
```

It strips comments before scanning, so a migration note *quoting* a `require(...)` is treated as prose,
not as a dependency edge.

**End-to-end verification (not a simulation):** the staged tree was extracted with
`git archive $(git write-tree)` into a scratch directory and `server.js` was loaded from it:

```
✓ server.js loaded from a clean checkout — NO MODULE_NOT_FOUND
[upstox] ✓ connected — NIFTY 23962.8
```

The scratch copy (which held a copied `.env`) was destroyed immediately afterwards.

## Files changed

0 edited. 15 added. 1 test suite created.

## Rollback plan

```bash
bash backups/migration-C1c-0a-untracked-20260709-170607/ROLLBACK.sh
```

Runs `git rm --cached` on the added modules and deletes the guard suite. Every file remains on disk with
identical contents, so the working tree returns to exactly its prior state.

## Follow-up (not done here — separate concern, separate commit)

`Dockerfile:11` `COPY . .` copies untracked and gitignored files into the image. It masked this defect and
risks shipping a developer's `.env` into a container. Recommend a `.dockerignore` and/or `COPY` of an
explicit manifest. **Not changed in this commit** (unrelated issue rule).
