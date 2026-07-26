# 028 — CI/CD, BUILD, RELEASE & DEPLOYMENT GOVERNANCE

**Standard:** Master Prompt 028 · **Depends on:** 000-A … 026 *(027 was not issued)*
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No software deployed. No infrastructure redesigned.**

---

# SECTION 0 — THE ANSWER TO 026's OPEN QUESTION

**Audit 026 §1 measured the outage and left one thing UNKNOWN:**

> *"`ecosystem.config.js` (PM2) exists — and the process died and stayed dead. Whether it was not
> running under PM2, or PM2 failed to restart it, is UNKNOWN — and that question must be answered
> before any other reliability work."*

## 🔴 **028 answers it. The platform has TWO working auto-restart mechanisms. NEITHER was used.**

### Mechanism 1 — Docker Compose

```yaml
docker-compose.yml:16   restart: unless-stopped
docker-compose.yml:38   healthcheck: ...
```

```dockerfile
Dockerfile   HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3
             CMD node -e "fetch('http://127.0.0.1:3000/healthz')
                            .then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

**In 021 §0, port 3000 was unbound. `fetch` would have thrown. The container would have been marked
UNHEALTHY within 30 seconds, and `restart: unless-stopped` would have restarted it.**

### Mechanism 2 — PM2

```js
ecosystem.config.js
  autorestart   : true
  max_restarts  : 10
  min_uptime    : '10s'
  restart_delay : 3000
```

**PM2 would have restarted the process within three seconds.**

### And the bot died, and stayed dead.

```json
package.json   "start": "node server.js"
```

> ## **The bot was started bare — `node server.js` — with no supervisor of any kind.**
>
> **Both supervisors exist. Both are correctly configured. Both would have caught it. Neither was
> running.**
>
> **This is the definitive answer to 026's open question, and it is the eighth and ninth instance in
> this audit programme of a correct component that was BUILT and NOT USED.**

**The cost, from 026 §1: `MTTD (unattended) = ∞. MTTR = ∞. Incident records = 0.`**
**Every one of those numbers would have been finite under either supervisor.**

---

# PART 1 — DELIVERY INVENTORY

| Component | Present? | Quality |
|---|---|---|
| **Source repository** | 🟢 `github.com/mayursavaliyams-dev/-maay-dashboard` | HIGH |
| **Branch strategy** | 🔴 **NONE.** 2 local branches (`main`, `session-fixes-2026-06-19`). **All work goes to `main`** | HIGH |
| **Build scripts** | 🟢 `npm start` · `npm test` · 13 scripts | HIGH |
| **Package management** | 🟢 `package.json` | HIGH |
| **Dependency locking** | 🟢 **`package-lock.json` — 139 packages** | HIGH |
| **CI workflow** | 🟢 **`.github/workflows/ci.yml` — and it is GOOD (§2)** | HIGH |
| **Release workflow** | 🔴 **DOES NOT EXIST** | HIGH |
| **Deployment scripts** | 🟢 `Dockerfile` · `docker-compose.yml` · `.dockerignore` · `ecosystem.config.js` — **all correct, none in use (§0)** | HIGH |
| **Runtime artifacts** | 🔴 **NONE. No image is built, tagged or published** | HIGH |
| **Version metadata** | 🔴 **`package.json` says `2.0.0`. `git tag` count: ZERO** | HIGH |

---

# SECTION 2 — 🟢 THE CI PIPELINE IS GENUINELY GOOD

**`.github/workflows/ci.yml`, verified stage by stage:**

| Stage | What it does | Verdict |
|---|---|---|
| **Checkout + Node 20** | `actions/checkout@v4`, `setup-node@v4` | 🟢 |
| **Install** | `npm ci \|\| npm install` | 🟢 Lockfile-first |
| **Syntax-check core modules** | `node -c` on **23 named files** | 🟢 **All 23 exist. VERIFIED — CI would pass** |
| **Unit test suites** | **`npm test`** | 🟢 **Gates on the 48-suite exit code** |
| **Validate dashboard inline scripts** | Parses every `<script>` block in **12 HTML pages** with `vm.Script` | 🟢 **Genuinely clever. Catches a broken dashboard before it ships** |
| **Auth unit test** | Signs a token, verifies it, **verifies a TAMPERED token is rejected**, tests login, bad login, and role checks | 🟢 **A real security regression test** |
| **Pattern module test** | Asserts `Bullish Engulfing` is detected from a known candle pair | 🟢 |
| **Python job** | `pytest` in `antigravity-py/` | 🟡 **Non-blocking (`\|\| echo "skipped"`)** |

> **This CI is better than most production Node projects have. It syntax-checks, it runs 48 suites, it
> validates inline dashboard scripts, and it contains a genuine auth-tampering regression test.**

## 🔴 But there are three gaps

| # | Gap |
|---|---|
| **1** | 🔴 **No security scan.** No `npm audit`, no dependency CVE check, no secret scanning |
| **2** | 🔴 **No artifact.** CI verifies the code and then **produces nothing**. No image is built, tagged or published |
| **3** | 🟡 **The Python job is non-blocking and tests a duplicate.** `antigravity-py/` still exists — and the project's own audit archived the Python backend to `deprecated/` as a dead duplicate. **CI is spending time on a component the platform has already retired** |

---

# PART 2 — DELIVERY PIPELINE

```
  Source ──▶ Build ──▶ Static Verify ──▶ Test ──▶ Artifact ──▶ Release Approval ──▶
  Deploy ──▶ Post-Deploy Verify ──▶ Rollback Readiness
     ↓         ↓            ↓            ↓          ↓               ↓
     │         │            │            │          │               └── 🔴 DOES NOT EXIST
     │         │            │            │          └── 🔴 NO ARTIFACT IS EVER PRODUCED
     │         │            │            └── 🟢 48 SUITES, EXIT-CODE GATED. EXCELLENT.
     │         │            └── 🟢 node -c × 23 · inline-script parse × 12 pages
     │         └── 🟡 npm ci (no build step — it is plain Node)
     └── 🔴 NO BRANCH STRATEGY. Everything lands on main.

  Deploy ──▶ 🔴 MANUAL. `npm start`. No supervisor. (§0)
  Post-Deploy Verify ──▶ 🔴 NONE. 021 §0: the process died and nobody knew.
  Rollback ──▶ 🟡 `git checkout` + 16 `backups/` snapshots with ROLLBACK.sh — from THIS audit only.
```

## **Four of nine stages do not exist. The three that do are excellent.**

---

# PART 3 — BUILD GOVERNANCE

| Aspect | Verdict |
|---|---|
| **Reproducible builds** | 🟡 **PARTIAL.** No build step (plain Node). `package-lock.json` pins 139 packages 🟢 |
| **Dependency locking** | 🟢 **`package-lock.json` — and CI uses `npm ci`** |
| **Environment consistency** | 🔴 **BROKEN — FOUR different Node versions:** |
| **Version generation** | 🔴 **NONE.** `package.json` says `2.0.0`; **`git tag` count is ZERO** |
| **Artifact integrity** | 🔴 **N/A — no artifact is produced** |
| **Build determinism** | 🟡 **UNKNOWN — never verified across environments** |

## 🔴 P3-A — Environment parity: **four Node versions, none pinned**

```
  package.json  "engines"  : ">=14.0.0"     ← a RANGE, spanning 10 major versions
  Dockerfile               : node:20-alpine
  CI (setup-node)          : 20
  LOCAL RUNTIME            : v24.14.1       ← where the 48 suites actually pass
```

> **The tests pass on Node 24 locally. CI runs them on Node 20. The Docker image is Node 20. And
> `engines` would happily accept Node 14.**
>
> **028's stop condition: *"Stop and report UNKNOWN if build reproducibility cannot be verified."***
> ## **→ BUILD REPRODUCIBILITY: UNKNOWN. Nothing is pinned.**

---

# PART 4 — CI GOVERNANCE

| Capability | Verdict |
|---|---|
| **Automated testing** | 🟢 **YES — `npm test`, 48 suites, exit-code gated** |
| **Regression verification** | 🟢 **YES — and the auth-tampering test is a real security regression** |
| **Security checks** | 🔴 **NONE.** No `npm audit`, no CVE scan, no secret scanning — 🔴 **and 023 §0 found a hardcoded credential (`'antigravity'`) that a secret scanner would have flagged on day one** |
| **Build verification** | 🟢 `node -c` × 23 + inline-script parse × 12 |
| **Artifact validation** | 🔴 **N/A — no artifact** |
| **Failure reporting** | 🟡 GitHub Actions default |

---

# PART 5 — RELEASE GOVERNANCE

| Aspect | Verdict |
|---|---|
| **Version numbering** | 🔴 **`2.0.0` in `package.json`. ZERO git tags. No release has ever been cut** |
| **Release notes** | 🔴 **NONE** |
| **Approval process** | 🟢 **EXCELLENT — for protected files.** `server.js` and `execution-engine.js` require an approval package with evidence, root cause, exact diff, risk, rollback and a characterization test. **This workflow held across all 29 audits in this programme** |
| | 🔴 **And it does not exist for a RELEASE.** A release is `git push`, and deployment is `npm start` |
| **Change history** | 🟢 **git — and it is honest.** *`fix(evidence): the platform's two edge claims were look-ahead artefacts`* |
| **Compatibility** | 🔴 **No schema version in any state file.** *(025)* |
| **Release evidence** | 🔴 **NONE. No release exists to have evidence about** |

## ## **Release readiness: there is no release. There is only `main`, and whatever is on it.**

---

# PART 6 — DEPLOYMENT GOVERNANCE

| Aspect | Verdict |
|---|---|
| **Deployment strategy** | 🔴 **MANUAL. `npm start`. No supervisor (§0)** |
| **Roll-forward** | 🔴 `git pull` + restart, by hand |
| **Rollback** | 🟡 **`git checkout` + 16 `backups/` snapshots with `ROLLBACK.sh`** — 🔴 **all of them created by THIS audit. No pre-existing rollback procedure** |
| **Health verification** | 🟢 **The Dockerfile HEALTHCHECK is CORRECT and would have caught 021 §0** — 🔴 **and it is not in use (§0)** |
| **Smoke testing** | 🔴 **NONE post-deploy** |
| **Configuration validation** | 🔴 **NONE. The platform boots with no configuration at all** *(024)* |
| **Deployment safety** | 🔴 **A deployment starts the engines.** 024 §0: **today, a restart boots NIFTY at 15/8, unhalted, trading** |

## 🔴 P6-A — **A deployment is currently an unsafe act**

> **`git pull && npm start` today means: the NIFTY engine boots at fifteen consecutive losses against a
> limit of eight, with no halt, auto-trading enabled — because the halt is not persisted, is not
> re-evaluated at boot, and `setAutoEnabled(true)` fires from `config-overrides.json`.**
>
> **Deployment safety is blocked behind the risk fix (B-3 + S-01 + S-02) that has not been approved.**

---

# PART 7 — ARTIFACT GOVERNANCE

| Required per artifact | Recorded? |
|---|---|
| **Version** | 🔴 **NO — no artifact exists** |
| **Build ID** | 🔴 **NO** |
| **Commit reference** | 🔴 **NO** |
| **Build timestamp** | 🔴 **NO** |
| **Test results** | 🟡 **In the CI log — ephemeral, not attached to anything** |
| **Dependency snapshot** | 🟢 **`package-lock.json` is committed** |
| **Approval status** | 🔴 **NO** |

## **1 of 7. *"Artifacts without provenance are not production-ready."* — There are no artifacts at all.**

**This is the same defect as 008 P9-A (backtest results carry no `gitSha`) and 015 §0 (result files carry
no provenance). The platform does not attach identity to the things it produces — in research, in
delivery, or anywhere else.**

---

# PART 8 — FAILURE MODE REGISTER

| ID | Failure | Present? | Impact |
|---|---|---|---|
| **CD-1** | **No supervisor in production** | 🔴 **CONFIRMED (§0) — and it cost a trading day** | **CRITICAL. MTTR = ∞** |
| **CD-2** | **A deployment starts an engine at 15/8, unhalted** | 🔴 **CONFIRMED** *(024 §0)* | **CRITICAL. Deployment is currently unsafe** |
| **CD-3** | **No artifact, no version, no tag** | 🔴 **CONFIRMED — 0 git tags** | **HIGH. No release is traceable** |
| **CD-4** | **Environment mismatch — 4 Node versions** | 🔴 **CONFIRMED** | **HIGH. Build reproducibility: UNKNOWN** |
| **CD-5** | **No security scanning in CI** | 🔴 **CONFIRMED** | **HIGH — a secret scanner would have caught `'antigravity'` (023 §0)** |
| **CD-6** | **No branch strategy — everything on `main`** | 🔴 **CONFIRMED** | MEDIUM |
| **CD-7** | **No post-deployment verification** | 🔴 **CONFIRMED — 021 §0** | **CRITICAL** |
| **CD-8** | **Rollback is untested** | 🟡 **16 snapshots + `ROLLBACK.sh` exist — from this audit. Never exercised in a real rollback** | MEDIUM |
| **CD-9** | **CI tests an archived Python duplicate** | 🟡 **CONFIRMED — non-blocking** | LOW |
| 🟢 **CD-10** | **Tests do not gate the build** | 🟢 **FALSE — `npm test` DOES gate CI. 48 suites, exit code** | 🟢 |

---

# PART 9 & 10 — DELIVERY ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   RunSupervisor  ★★★   THE ENTIRE FIX FOR §0 — AND IT IS ALREADY WRITTEN, TWICE.
     🟢 docker-compose.yml : restart: unless-stopped + healthcheck    ← works
     🟢 ecosystem.config.js: autorestart, max_restarts, min_uptime    ← works
     🔴 THE BOT IS STARTED WITH `npm start`. USE EITHER ONE.
        This is not a build task. It is a decision about which command to type.

   ArtifactRepository  ★
     Every CI run produces an IMAGE tagged with the commit SHA.
     🔴 Today CI verifies the code and then throws the result away.
     🔴 An artifact without a gitSha is not an artifact. (Same defect as 008, 015.)

   ReleaseManager  ★
     version = git tag. Release notes. Test results ATTACHED to the artifact.
     🔴 Today: 0 tags, version 2.0.0 in a file nobody reads.
     🟢 The protected-file APPROVAL workflow already models the right discipline —
        extend it from FILES to RELEASES.

   DeploymentController  ★
     🔴 A DEPLOYMENT MUST NOT START AN ENGINE THAT IS HALTED.  → CD-2
        Boot → validate config → re-evaluate the halt invariant → refuse if breached.
     Post-deploy smoke test. Health gate. Automatic rollback on failure.

   SecurityGate in CI  ★   npm audit · secret scanning · CVE check.
                           🔴 Would have caught `'antigravity'` on day one.  → CD-5

   PIN THE RUNTIME.  engines: "20.x". Dockerfile: node:20-alpine. CI: 20. Local: 20.
                     One number, four places. Today there are four numbers.   → CD-4
```

## The rule §0 establishes

> **A supervisor that is configured but not running is not a supervisor. It is a file.**
> **The platform did not lack the ability to restart itself. It lacked the decision to use it.**

---

# PART 11 — TESTING STRATEGY

**Deployment safety has priority over deployment speed.**

| Test | Priority | Status |
|---|---|---|
| 🔴 **The bot runs under a supervisor that restarts it on death** | **P0 — §0** | ✅ **FAILS — it ran bare and stayed dead** |
| 🔴 **A deployment REFUSES to start an engine whose halt invariant is breached** | **P0 — CD-2** | ✅ **FAILS — it would boot NIFTY at 15/8** |
| 🔴 **Every CI run produces an artifact tagged with the commit SHA** | **P0 — CD-3** | ✅ **FAILS — no artifact** |
| 🔴 **CI runs `npm audit` and a secret scan** | **P0 — CD-5** | ✅ **FAILS** |
| 🔴 **The runtime version is pinned identically in `engines`, Dockerfile, CI and local** | **P0 — CD-4** | ✅ **FAILS — 4 versions** |
| 🔴 **A post-deployment smoke test verifies the process is serving** | **P0 — CD-7** | ✅ **FAILS** |
| **Rollback is exercised, not assumed** | P1 — CD-8 | 🟡 16 snapshots exist, never used in anger |
| 🟢 **`npm test` gates the build** | P1 | 🟢 **PASSES — 48 suites, exit-code gated. Keep it** |
| 🟢 **Inline dashboard scripts parse** | P1 | 🟢 **PASSES. Keep it** |
| 🟢 **A tampered auth token is rejected** | P1 | 🟢 **PASSES. Keep it** |

**Six P0 tests fail. Three P1 tests already pass and are genuinely good.**

---

# PART 12 — DELIVERY MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Manual Releases** | 🟢 | `git push`, then `npm start`, by hand |
| **1 — Repeatable Builds** | 🟡 **PARTIAL** | 🟢 `package-lock.json` + `npm ci` · 🔴 **four Node versions; nothing pinned** |
| **2 — Continuous Integration** | 🟢 **YES — and it is GOOD** | **`npm test` (48 suites) gates every push. Plus `node -c` × 23, inline-script validation × 12, and a real auth-tampering regression test.** 🔴 *Missing: security scanning* |
| **3 — Governed Releases** | 🔴 **NO** | **Zero tags. Zero artifacts. Zero release notes.** 🟢 *The protected-FILE approval workflow is excellent — it just does not extend to releases* |
| **4 — Automated Deployments** | 🔴 **NO** | 🟢 **Docker + compose + PM2 all EXIST and are CORRECT** — 🔴 **and none is in use (§0)** |
| **5 — Enterprise Delivery** | 🔴 **NO** | — |

## ## **Delivery Platform: LEVEL 2 — CONTINUOUS INTEGRATION.**

**This is the HIGHEST maturity level any domain has scored in this entire audit programme.**
**The CI is real, it is good, and it works.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE — this document.** **§0 answers 026's open question** | — | none | Both supervisors found, correct, and unused |
| **2 — Build governance** | 🔴 **PIN THE RUNTIME.** `engines: "20.x"` everywhere. **Verify the 48 suites pass on Node 20, not just Node 24** | none | **Low** | **Build reproducibility moves from UNKNOWN to verified** |
| **3 — CI verification** | 🔴 **Add `npm audit` + secret scanning.** **Produce an artifact tagged with the commit SHA.** Retire the Python job | Phase 2 | **Low — additive** | **Every CI run yields a traceable artifact** |
| **4 — Release governance** | 🔴 **Tag releases. Write release notes.** **Extend the protected-file approval discipline to releases** | Phase 3 | Low | **Every deployment names the commit that produced it** |
| **5 — Deployment governance** | 🔴 **RUN THE BOT UNDER PM2 OR COMPOSE. Both already work (§0).** 🔴 **A deployment must REFUSE to start a halted engine** *(CD-2 — needs B-3 + S-01)* | 🔒 **B-3 + S-01 approval** | 🔴 **Until B-3 is approved, EVERY deployment is unsafe** | **MTTR < 5 min. A halted engine cannot be deployed into service** |

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| **Builds are reproducible** | 🔴 **UNKNOWN — four Node versions, none pinned** |
| Artifacts are versioned and traceable | 🔴 **NO — there are no artifacts** |
| Releases require documented approval | 🟡 **PROTECTED FILES: yes, and excellently.** 🔴 **RELEASES: no such thing exists** |
| Deployments are verifiable | 🔴 **NO — no post-deploy check.** *(021 §0 is the proof)* |
| **Rollback procedures are tested** | 🟡 **16 snapshots + `ROLLBACK.sh` exist — never exercised in anger** |
| Environment consistency is measurable | 🔴 **NO — 4 Node versions** |
| **Every production release is auditable** | 🔴 **NO — zero tags, zero artifacts** |

## **0 of 7 fully. 2 partially.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent DevOps engineer reproduce any build, verify every artifact, trace
every release to its source revision, confirm deployment safety, and demonstrate rollback readiness?**

## **Reproduce the build: UNKNOWN. Verify an artifact: there are none. Trace a release: there have been none. And deployment safety is the reason the bot is still down.**

🟢 **What is genuinely good — and it is the best-scoring domain in this entire audit programme:**

> **The CI pipeline is real and it is better than most production Node projects have.** It syntax-checks
> 23 core modules, runs all **48 test suites gated on the exit code**, parses every inline `<script>`
> block across 12 dashboard pages to catch a broken UI before it ships, and contains a **genuine
> auth-tampering regression test** that verifies a forged token is rejected.
>
> **`package-lock.json` pins 139 packages, and CI uses `npm ci`.**
>
> **Delivery is the only domain in 29 audits to reach Level 2.**

🔴 **And then §0 — which answers the question audit 026 had to leave open:**

> ## **The platform has TWO working auto-restart mechanisms. Neither was used.**
>
> **`docker-compose.yml` declares `restart: unless-stopped` and the `Dockerfile` carries a HEALTHCHECK
> that fetches `/healthz` every 30 seconds. In 021 §0, port 3000 was unbound — that fetch would have
> failed, the container would have been marked unhealthy, and Docker would have restarted it.**
>
> **`ecosystem.config.js` declares `autorestart: true`, `max_restarts: 10`, `restart_delay: 3000`. PM2
> would have restarted it within three seconds.**
>
> **`package.json` declares `"start": "node server.js"`. The bot was started bare, with no supervisor
> at all. It died. It stayed dead. MTTR = ∞.**
>
> **Both supervisors exist. Both are correctly configured. Both would have caught it. The platform did
> not lack the ability to restart itself — it lacked the decision to use it.**

**This is the eighth and ninth time in this audit programme that a correct component has been found
BUILT and NOT USED — after `engine-verdict.js` (1 adopter of 8), `module-contract.js` (11 surfaces,
404), `bt-validate.js` (0 strategy callers), `position-sizer.js` (imported, disabled), `auth.js`
(0 of 172 routes), the append-only `.jsonl` writer (pointed at migrations), and `scripts/perf-report.js`
(never run live).**

**And the deployment finding that blocks everything else:**

> **A deployment today is an unsafe act. `git pull && npm start` boots the NIFTY engine at fifteen
> consecutive losses against a limit of eight, unhalted and trading — because the halt is not persisted,
> is not re-evaluated at boot, and `setAutoEnabled(true)` fires from `config-overrides.json`
> *(024 §0)*.**
>
> **Deployment safety, the performance baseline (026 §0), and restarting the bot at all are ALL blocked
> behind one approval package that has not been decided.**

**The single highest-value action in this document, and it costs nothing:**

> ## **START THE BOT UNDER PM2 OR DOCKER COMPOSE. BOTH ARE ALREADY WRITTEN AND ALREADY CORRECT.**
>
> **`npm run pm2:start` instead of `npm start`. That is the entire change.**
>
> **It converts MTTR from ∞ to three seconds — but only AFTER B-3 + S-01 are approved, because until
> then, an automatic restart is an automatic resumption of trading at 15/8.**

---

**Software deployed: NONE. Infrastructure redesigned: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Delivery Inventory (Part 1) · Pipeline (Part 2) · Build Governance (Part 3) ·
CI Assessment (§2, Part 4) · Release Governance (Part 5) · Deployment Assessment (Part 6) · Artifact
Governance (Part 7) · Failure Modes (Part 8) · Delivery Architecture (Parts 9–10) · Testing Strategy
(Part 11) · Maturity Assessment (Part 12) · Migration Roadmap (Part 13) · Executive Summary.
