# C2 · Step 1 — Docker build context: state persistence and size

| | |
|---|---|
| **Date** | 2026-07-09 |
| **Files changed** | `.dockerignore`, `docker-compose.yml` |
| **Tests added** | `test/docker-context.test.js` (new suite, **25 assertions**) |
| **Tests** | 31/31 → **32/32 suites** |
| **`server.js`** | untouched |
| **Risk** | Low — build-time files only; the platform runs locally with `node server.js` |

---

## Correction to a previously reported finding

In earlier reports I stated that `Dockerfile:11` `COPY . .` could bake a developer's `.env`, with live
broker tokens, into an image layer. **That was wrong.** `.dockerignore` already excluded `.env` and
`.env.*`. I inferred the vulnerability from the `COPY` line without reading the file that prevents it.

A full credential scan of the computed build context — every `.js`, `.json`, `.jsonl`, `.yml`, `.csv`,
`.html`, `.sh` under 3 MB — found **no credential-shaped literal**. The finding is retracted, and the
retraction is asserted by test so it stays true.

## What the audit actually found

### 1. Mutable runtime state was baked into the image — **High**

`COPY . .` copied `data/` (49 JSON files: paper-trade ledgers, open positions, forward-test records,
audit log), and `docker-compose.yml` gave the `app` service **no volume for `/app/data`**.

Consequence: container writes land in the ephemeral writable layer. **Every `docker build` or
`docker compose up --force-recreate` resets paper-trading history to the build-time snapshot and discards
accumulated forward-test evidence** — the precise records this platform exists to gather before any live
approval. `data/config-overrides.json` also carries `STRANGLE_ENGINE_ENABLED`, `STRANGLE_CAPITAL: 700000`
and `AI_AGENTS_ENABLED`, so a stale snapshot silently starts the engines on a stale configuration.

### 2. The build context was 237.7 MB

| entry | size | disposition |
|---|---|---|
| `bt-data/` | 187.7 MB | bind-mounted read-only, excluded |
| `SCREEENSHOTS/` | 26.3 MB | excluded |
| `data/` | 15.5 MB | bind-mounted read-write, excluded |
| `exports/`, `backups/`, `design-candidates/`, `terminal-candidates/` | ~3.5 MB | excluded |

`backups/migration-C1c-0-env-.../.env.example` was also being copied. Harmless (the file is blanked), but
no migration backup belongs in an image.

**After: 2.9 MB, 182 files.** Largest single file is `public/vendor/highstock.js` at 0.38 MB.

## Solution

`.dockerignore` now excludes secrets, mutable state, research data, backups, screenshots, tests and
archived trees — each with a comment saying *why*, not just *what*.

`docker-compose.yml` gains two mounts:

```yaml
volumes:
  - ./data:/app/data          # mutable runtime state
  - ./bt-data:/app/bt-data:ro # 187 MB research corpus, read-only
```

**A bind mount, not a named volume — deliberately.** An empty named volume would start the container with
no `data/`, and `server.js` would recreate it from defaults, silently reverting
`STRANGLE_ENGINE_ENABLED` / `STRANGLE_CAPITAL` / `AI_AGENTS_ENABLED`. The bind keeps one ledger shared
between the container and a local `node server.js`, which is what a single-machine research platform wants.

**The exclusion and the mount are one change, not two.** Excluding `data/` without mounting it would cause
exactly the data loss this migration prevents. The test suite asserts both together.

## Risk Analysis

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| App cannot boot without `data/` in the image | — | would be fatal | **Empirically disproved:** the 182-file context was materialised and booted; `data/` was auto-created (8 entries), Upstox connected, `GET /healthz` → 200 |
| Excluding `data/` loses state | Certain **without** the mount | High | Bind mount added in the same commit; asserted by test |
| Container and local server write the same ledger | Real | Corrupt ledger | Documented in `docker-compose.yml`: run only one at a time. A file-locking fix belongs to **C3 (atomic writes)** |
| A future edit re-adds a secret or `data/` | Plausible | High | Guard suite recomputes the context and fails. **All three tripwires verified to fire** |
| Backtest CLIs need `bt-data` writable | Low | backtest fails | Mounted `:ro`; the CLIs write to `bt-data/result-*.json`. **Known limitation — see Technical Debt** |
| `server.js` regression | None | — | Not touched |

## Test Plan / Results

`test/docker-context.test.js` re-implements Docker's ignore semantics (`*` does not cross `/`; a pattern
matches a path or any leading directory) and asserts on the **computed context**, not on the text of
`.dockerignore`. A grep-based test would pass on a typo'd pattern that matches nothing.

```
25 assertions passed          suites 31/31 → 32/32
```

Covers: `.env` and every `.env.*` excluded · no `.env`-shaped file anywhere, including `backups/` ·
no credential-shaped literal in any copied text file · `data/`, `bt-data/`, `backups/`, `SCREEENSHOTS/`,
`exports/`, `node_modules`, `.git`, `test/`, archived trees all excluded · every module `server.js`
requires at boot **is** present · `public/` present but `public/designs`, `public/terminals` excluded ·
`Dockerfile` still `COPY . .` · compose bind-mounts `./data:/app/data` and `./bt-data:ro` ·
compose uses `env_file`, not a layer · **no named volume for data** · `TRADE_MODE=paper` pinned ·
context < 40 MB and no single file > 5 MB.

**Tripwires verified.** Each protection was removed on a scratch copy and the suite failed on cue:

```
remove `.env` from .dockerignore  → C2-01: .env is excluded from the build context
remove `data` from .dockerignore  → C2-01: data/ ... is NOT baked into the image
remove ./data mount from compose  → C2-01: docker-compose bind-mounts ./data:/app/data
```

**End-to-end boot proof.** The exact 182-file context was materialised into a scratch directory (with `.env`
supplied at runtime only, as `env_file` does) and `server.js` was started from it:

```
✓ server.js boots from the image contents
  running in: scratch image ✓
  data/ auto-created at runtime? YES (8 entries)
  GET /healthz -> HTTP 200
```

The scratch copy, which held a copy of `.env`, was destroyed immediately.

## Performance Impact

| | before | after |
|---|---|---|
| build context | 237.7 MB, 1,256 files | **2.9 MB, 182 files** |
| `COPY . .` layer | ~238 MB | ~3 MB |

Roughly **98.8% smaller**. Build and rebuild times drop accordingly; the runtime cost is zero, since
nothing on the request path changed. There is no measurable runtime performance impact to report.

## Migration Notes

No data migration. The first `docker compose up` after this change mounts the host's existing `./data`,
so paper-trading history carries over intact rather than being replaced by the image snapshot. Because
the platform currently runs via `node server.js` locally, this change has **no effect on the running
system today**; it fixes the container path before it is used.

## Rollback Plan

```bash
git checkout HEAD -- .dockerignore docker-compose.yml
rm -f test/docker-context.test.js
```

No runtime state, ledger or data file is touched by this migration. Rollback is total and instantaneous.

## Technical Debt discovered (not fixed here)

- **TD-3 — `bt-data` is mounted read-only, but the backtest CLIs write results into it.**
  `bt-strangle-*.js`, `bt-validate.js` and friends write `bt-data/result-*.json`. Under `:ro` those CLIs
  will fail inside a container. They are not part of the server image's job, and none of them runs in the
  container today. **Recommended fix:** give results their own directory (`bt-results/`) mounted `rw`,
  separating an immutable input corpus from mutable outputs. Raised, not silently accepted.
- **TD-4 — the container and a local `node server.js` share one bind-mounted ledger.** Concurrent writers
  can interleave a `writeFileSync` and truncate a JSON ledger. This is precisely the failure mode that
  **C3 (atomic file writes)** exists to fix; the bind mount makes it reachable from a second process.
  Documented in `docker-compose.yml`.
- Eight `bt-*.js` CLIs write into `data/` without `mkdirSync`, so they throw if `data/` is absent. They are
  developer tools, never run in the container, and were left alone.
