# 001-E — PRODUCTION AUDIT

**Standard:** Master Prompt 000-E (Production, Security, Operations & Release Governance)
**Date:** 2026-07-12 · **HEAD:** `7823864` · **Suite:** 47/47 green
**Method:** every row below is MEASURED against the working tree. No claim is carried over from
memory or from an earlier document without being re-run. Two claims failed that re-check and are
recorded in §7.

---

## 0. VERDICT

| | |
|---|---|
| **Production Readiness** | **FAIL — 27 / 80 (34%)** |
| **Operational Maturity (000-E scale)** | **Level 3 — Paper Trading** (claimed elsewhere: "production-grade") |
| **Live Trading Gate** | **0 of 6 gates passed** |
| **Is that the wrong outcome?** | **No.** The platform runs in paper mode and belongs there. This audit's purpose is to stop the gap being *invisible*, not to close it today. |

---

## 1. LIVE TRADING GATE — 0 / 6

000-E: *"Live trading is prohibited until all required gates are satisfied."*

| Gate | Status | Evidence |
|---|---|---|
| Research validation completed | **FAIL** | Both edge claims invalidated. Selling: PF 7.41 → **0.55** without look-ahead. Buying: PF **0.84** *even with* look-ahead. `docs/REVIEW-selling-edge-invalidated.md` |
| Paper trading evidence sufficient | **FAIL** | ~55 labelled outcomes; ~200 required (constraint M2) |
| Risk engine approved | **FAIL** | `grep -rlE "totalExposure\|portfolioRisk\|netDelta"` → **nothing**. There is no account-level risk engine to approve |
| Operational review completed | **FAIL** | This document is the first one |
| Production checklist completed | **FAIL** | §6 |
| Owner approval granted | **FAIL** | Not sought |

**Structural protection that is actually working:** `TRADE_MODE=paper` → `paperMode = true` → the
`placeOrder` guard at `execution-engine.js:519` is unreachable. Live execution is not merely
*disallowed*, it is **not wired**. That is the single strongest production fact in this repository.

---

## 2. SECURITY — 3 / 10

Default posture required by 000-E: **DENY**.

| Control | Status | Evidence |
|---|---|---|
| Secrets not committed | **PASS** | `.env` is in `.gitignore`; no key material in tracked files |
| Secrets not logged | **PASS** | `module-contract.js` redacts by deny-list before publishing any surface |
| Auth available | **PARTIAL** | `auth.js` implements JWT/RBAC cookie auth. `AUTH_ENABLED` **defaults to off** — i.e. the default posture is ALLOW, not DENY. Acceptable for a local-only tool; **not** acceptable if ever exposed |
| **Secrets written by an HTTP handler** | **FAIL** | **`server.js:2028`** — `_fs.writeFileSync(_envPath, env)`. The broker OAuth callback **rewrites the entire `.env` file**, including tokens, from a request path. Mode `0644`. Not atomic: an interrupted write truncates `.env` and the next boot loses every credential |
| CSP / security headers | **FAIL** | `grep -c helmet server.js` → **0**. No CSP, HSTS, X-Frame-Options |
| Rate limiting | **FAIL** | **0** rate-limit middleware. (A naive grep returns 4 hits — all are comments and an *outbound* broker-throttle counter. Re-checked; see §7) |
| Config validation at startup | **PARTIAL** | `instrument-registry.js` fails closed. Nothing validates required env vars or a config schema at boot |

> **The single highest-value security fix is `server.js:2028`.** It is the only place in the codebase
> where an unauthenticated-by-default HTTP request causes a **non-atomic overwrite of the credential
> file**. `safe-write.js` already exists and solves exactly this. Protected file → approval package required.

---

## 3. OBSERVABILITY — 1 / 10

000-E: *"Unknown operational state is unacceptable."*

| Requirement | Status | Evidence |
|---|---|---|
| Health status | **FAIL** | `/healthz` exists (`server.js:143`) but reports **only uptime, bootId, authEnabled**. It does **not** know whether an engine is halted, a ledger is corrupt, or the broker feed is stale. **A health check that cannot fail is not a health check.** |
| **Health surface that CAN fail** | **FAIL** | `module-contract.js` builds 11 service surfaces including `/api/m/health`, with 114 passing assertions. `grep -c mountAll server.js` → **0**. **Every one of those routes is 404.** Built, tested, unreachable |
| Metrics | **FAIL** | Same cause |
| Structured logs | **FAIL** | **71** `console.log` in `server.js`. No `winston`/`pino`/`bunyan` in `package.json`. Logs are unstructured, unsearchable, not machine-parseable |
| Error counts | **FAIL** | **236** `catch` blocks in `server.js`; no error counter, no aggregation |
| Processing latency | **PARTIAL** | Broker-call latency is instrumented (`server.js:6280` — coalescing/cache/rate-limit counters). Nothing else is |
| Audit trail | **FAIL** | `EventEmitter` appears in **1** production module. No event bus ⇒ no audit trail ⇒ no replay |
| Timer health | **FAIL** | **14** `setInterval`, **0** `clearInterval` |

> **`module-contract.mountAll(app)` is one line in a protected file and it converts the entire
> observability score from 1/10 to roughly 6/10.** It is the highest ROI change in this document.

---

## 4. ALERTING — 0 / 10

**No alerting exists.** Not degraded — absent.

000-E enumerates the critical alerts. Measured against the repository:

| Required alert | Exists? | Reality |
|---|---|---|
| Process crash | ✗ | — |
| Risk engine unavailable | ✗ | There is no risk engine |
| Configuration corruption | ✗ | `safe-write.js` **detects** it and refuses — but tells no one |
| Order failure | ✗ | — |
| Market data interruption | ✗ | — |
| Persistent storage failure | ✗ | — |
| **Trading unexpectedly enabled** | ✗ | **This exact failure is live in the code.** `server.js:7278` calls `setAutoEnabled(true)` at boot, which undoes the C3-07 fail-closed halt. `setAutoEnabled()` has **0 references to `_haltedReason`** — it cannot see that the engine is halted. `docs/APPROVAL-halt-reenabled-at-boot.md` |

> 000-E names "Trading unexpectedly enabled" as a critical alert. **The platform has both the defect
> and no alert for it.** Paper mode is the only reason this is not an incident.

---

## 5. BACKUP, RECOVERY & RELEASE

| Requirement | Score | Evidence |
|---|---|---|
| Backup | **PASS** | `safe-write.js` — write-temp → validate-by-reparse → rename → `.bak`. Fail-closed on corrupt input |
| **Restore tested** | **PASS** | 000-E: *"Backups are not valid until restore has been tested."* Corrupt-file recovery is asserted in the ledger, config-override and signal-health suites. **This gate is genuinely met** |
| Rollback | **PASS** | Every change this session shipped with a `backups/` snapshot and a `ROLLBACK.sh`. Rollback is a single `git checkout` |
| Position reconciliation | **FAIL** | Does not exist |
| Restart validation | **PARTIAL** | Boot logs restored equity; nothing asserts it automatically |
| Disaster recovery procedure | **FAIL** | Not documented |
| Release notes / version identifier | **FAIL** | No version tags, no release notes |
| Risk assessment per release | **PARTIAL** | Approval packages carry Risk + Rollback; ordinary commits do not |
| Audit trail of approvals | **PASS** | `docs/APPROVAL-*.md`, 7 packages, immutable in git |
| Change freeze policy | **FAIL** | Not defined |

**Baselines (000-E: "never optimize without a baseline"):**
`scripts/perf-report.js` exists and `test/perf-budget.test.js` ratchets it. **Startup time, memory,
CPU and recovery time have no baseline.** Only IO-write counts are ratcheted.

---

## 6. PRODUCTION CHECKLIST

| | |
|---|---|
| ✗ | Research validated — **both edge claims invalidated** |
| ✗ | Paper trading sufficient — 55 / ~200 outcomes |
| ✗ | Risk reviewed — no risk engine exists |
| **✓** | **Tests passing — 47/47, exit-code gated** |
| ✗ | Monitoring enabled — `/api/m/health` → 404 |
| ✗ | Alerting verified — none exists |
| **✓** | **Backups verified — restore is tested** |
| **✓** | **Rollback tested** |
| **✓** | **Documentation updated** |
| ✗ | Owner approval received — 7 packages pending |

**4 / 10.** The four that pass are the four this session built.

---

## 7. CLAIMS THAT FAILED RE-VERIFICATION

000-A Rule Zero: *a claim is not a fact until it is measured.* Two statements previously made **in chat**
did not survive a fresh grep and are corrected here rather than silently dropped:

| Claim made | Re-measured | Correction |
|---|---|---|
| "No rate limiting" — cited as 4 grep hits | `grep -n 'rateLimit'` → 4 hits, **all comments or an outbound broker-throttle counter** | The **conclusion** (no rate limiting) is correct; the **evidence** was wrong. The number 4 meant nothing |
| "`vol-context.js` uses `r = 0`, contradicting `gex-skew.js`'s `r = 0.065`" | Fresh grep **did not confirm** the `r = 0` | `gex-skew.js:18 r = 0.065` is confirmed. **The vol-context value is UNKNOWN and must be re-measured before the contradiction is repeated.** Carried forward as an open item |

---

## 8. RANKED REMEDIATION

| # | Action | Score impact | Cost | Blocker |
|---|---|---|---|---|
| **1** | **`setAutoEnabled()` refuses to enable a halted engine** (`server.js:7278`) | Removes the live fail-open 000-E names by name | ~6 lines | **Owner approval** (protected) |
| **2** | **`module-contract.mountAll(app)`** | Observability **1/10 → ~6/10**. Health, metrics, OpenAPI all become reachable | **1 line** | **Owner approval** (protected) |
| **3** | **`server.js:2028` → `safe-write.js`** | Removes the non-atomic credential-file overwrite from an HTTP path | ~4 lines | **Owner approval** (protected) |
| 4 | `clearInterval` on all 14 timers in `_gracefulShutdown` | Closes the shutdown race (14 timers fire for 400 ms *after* the EOD snapshot) | ~10 lines | Owner approval |
| 5 | Structured logger (`pino`) behind the existing `console.log` calls | Logs become searchable and actionable | 1 module + sweep | None |
| 6 | Startup config validation — fail closed on missing required env | 000-E: *"Critical validation failure must prevent startup"* | 1 module | None |
| 7 | Baselines: startup time, memory, recovery time | Enables 000-E's "never optimize without a baseline" | extend `scripts/perf-report.js` | None |
| 8 | `helmet` + CSP | Security 3/10 → 5/10 | 2 lines | None |

**Items 1–4 are all in protected files. The production posture of this platform is, at this moment,
blocked on owner approval — not on engineering.**

---

## 9. SCORECARD

| Dimension | Score |
|---|---|
| Research validated | **0 / 10** |
| Monitoring | **1 / 10** |
| Alerting | **0 / 10** |
| Audit trail | **0 / 10** |
| Backup & Recovery | **7 / 10** |
| Security | **3 / 10** |
| Rollback | **8 / 10** |
| Testing | **8 / 10** |
| **TOTAL** | **27 / 80 — 34% — FAIL** |

**Nothing in this document recommends live trading. Nothing in this document is a reason to hurry
toward it.** The platform's honest state is a well-tested research tool with no validated edge and no
operational surface. Both facts are now written down.
