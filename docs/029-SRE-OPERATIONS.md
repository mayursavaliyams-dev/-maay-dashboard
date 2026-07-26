# 029 — PRODUCTION OPERATIONS, INCIDENT RESPONSE & SRE GOVERNANCE

**Standard:** Master Prompt 029 · **Depends on:** 000-A … 028
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No infrastructure deployed. No operational behaviour modified.**

**029's stop condition: *"Never assume production readiness because the service is currently running."***
## **The service is NOT running. It has been down since audit 021, and it is still down — verified: `GET /healthz` → HTTP 000.**

---

# SECTION 0 — THE FIRST POST-INCIDENT REVIEW THIS PLATFORM HAS EVER HAD

**A real incident occurred during this audit programme. 029 requires a post-incident review. Here it is.**

## INCIDENT — `INC-001` *(the first identifier this platform has ever issued)*

| Field | Value |
|---|---|
| **Service** | `antigravity-bot` — the sole trading process |
| **Severity** | 🔴 **SEV-1** — total loss of the only trading service |
| **Detected** | 2026-07-13 ~07:08 UTC |
| **Detected by** | 🔴 **A HUMAN, MANUALLY, BY ACCIDENT** — I attempted to query the health endpoint while writing audit 021 |
| **Last known alive** | 2026-07-13 06:53:46 UTC (last record written to `data/pop-book.json`) |
| **Time to detect** | **≥ 14 minutes.** 🔴 **Unattended: ∞ — no alert, heartbeat or monitor exists** |
| **Time to recover** | 🔴 **∞ — THE PROCESS IS STILL DOWN AS THIS IS WRITTEN** |
| **Root cause** | 🔴 **UNKNOWN.** No crash log, no exit event, no stack trace. `data/crash.log` was last written 2026-07-05 |
| **Contributing cause** | 🔴 **The bot was started with `node server.js` — bare, with no supervisor** |
| **Incident record produced by the system** | 🔴 **ZERO** |

## Impact — measured, not estimated

| Lost | Evidence |
|---|---|
| **The halt state** | `_haltedReason` is in no persisted schema *(005 S-01)* |
| **Any open position** | 3 of 4 paper engines never persist them *(010 §0)* |
| **The trading day** | No EOD snapshot since `eod-2026-07-10.json` |
| **The `_enteredToday` guard** | In-memory only *(007 P6-A)* |
| **Every log line since boot** | `console.log` → a terminal buffer that died with the process |
| **The forward-test evidence for that session** | **Permanently. The only uncontaminated evidence stream this platform has** *(010 §0)* |

## 🔴 §0.1 — **THE ROOT CAUSE IS IN THE RUNBOOK**

**`docs/OPS-PLAYBOOK.md` exists. It has an incident-response section. And its very first instruction is:**

```bash
docs/OPS-PLAYBOOK.md  §1. Run / restart

  node server.js                 # foreground
  # or background (Windows): start it detached and tail the log
```

**Meanwhile, in the same repository:**

```
  ecosystem.config.js   autorestart: true, max_restarts: 10, restart_delay: 3000   ← would restart in 3 s
  docker-compose.yml    restart: unless-stopped + HEALTHCHECK on /healthz          ← would restart in 30 s
  package.json          "pm2:start": "pm2 start ecosystem.config.js"               ← the command exists
```

> ## **The runbook instructs the operator to run the bot with no supervisor — while two working supervisors sit in the same directory, and the command to use one of them is already in `package.json`.**
>
> **This is not a missing capability. It is a documented instruction to not use the capability.**
>
> **`INC-001`'s root cause is a line in the operations playbook.**

## 🔴 §0.2 — **`INC-001` IS NOT IN THE RUNBOOK'S INCIDENT LIST**

**`OPS-PLAYBOOK.md §6 — Incident response` covers exactly four scenarios:**

| # | Scenario | Covers `INC-001`? |
|---|---|---|
| 1 | *"Dashboard shows old/wrong data"* → a **stale** server | 🔴 **No — this is a server that is RUNNING and wrong** |
| 2 | *"`signal-health` DEGRADED"* | 🔴 No |
| 3 | *"A paper P&L looks wrong"* | 🔴 No |
| 4 | *"Server **won't boot**"* | 🔴 **No — this is a server that booted and then DIED** |

> **There is no entry for *"the server died and nobody noticed."***
>
> **And there could not be — because the platform has no way to notice.** *(021: zero alerts. 022: zero
> lifecycle events. 026: MTTD unattended = ∞.)*
>
> **A runbook can only document incidents you are capable of detecting.**

## 🟢 §0.3 — And the Golden Rules are **excellent**

```
OPS-PLAYBOOK.md §7 — Golden rules

  • "Everything is PAPER. Do not wire live order placement without: a PASS forward-test
     report, a re-check of SEBI algo/RA rules, and an explicit decision."

  • "Never trust a single backtest — the edge is cost-control + regime-timing +
     risk-management, proven by forward-test, not a fancier signal."
```

> **That second rule is exactly, precisely correct. It is the thesis of this entire audit programme,
> written by the platform's own author, before the audit began.**
>
> **And the platform violated it.** The ₹7 lakh iron condor runs on a backtest of a **different
> structure** *(007 §0)*. `bt-real.js` was promoted on a **refuted** backtest. And the runbook's own
> recommended remedy — *"re-validate with `bt-validate.js`"* — **pointed at a harness that carried the
> same look-ahead until audit 002 fixed it.**
>
> **The operator wrote down the right rule and then had no tooling that could enforce it.**

---

# PART 1 — OPERATIONS INVENTORY

| Subsystem | Owner | Criticality | Availability req. | Recovery req. | State |
|---|---|---|---|---|---|
| **API service** (172 routes) | 🔴 none | 🔴 CRITICAL | ⚪ **UNKNOWN — no SLO declared** | ⚪ UNKNOWN | 🔴 **DOWN** |
| **Trading engines** (×6) | per-engine | 🔴 CRITICAL | ⚪ UNKNOWN | 🔴 **halt lost on restart** | 🔴 DOWN |
| **Paper trading** | per-engine | 🔴 **CRITICAL — the only clean evidence** | ⚪ UNKNOWN | 🔴 **open positions lost** | 🔴 DOWN |
| **Risk Engine** | — | — | — | — | ⚪ **DOES NOT EXIST** |
| **Capital Engine** | — | — | — | — | ⚪ **DOES NOT EXIST** |
| **AI services** | `confluence-learner` | MEDIUM | ⚪ UNKNOWN | 🟢 `.bak` | 🔴 DOWN |
| **Background workers** | — | — | — | — | ⚪ **NONE EXIST** |
| **Scheduler** | 🔴 **NOBODY** | 🔴 CRITICAL | ⚪ UNKNOWN | 🔴 **14 timers, 0 registered** | 🔴 DOWN |
| **Storage** | `safe-write` 🟢 | CRITICAL | 🟢 | 🟡 **14% backup coverage** *(025)* | 🟢 intact |
| **Monitoring** | — | — | — | — | ⚪ **DOES NOT EXIST** |
| **Alerting** | — | — | — | — | ⚪ **DOES NOT EXIST** |
| **Recovery service** | — | — | — | — | ⚪ **DOES NOT EXIST** |

## **Three of thirteen operational subsystems do not exist. Not one has a declared availability objective.**

---

# PART 2 — SERVICE LIFECYCLE

```
  Startup ──▶ 🟢 DETERMINISTIC (024 §0) — and it deterministically boots NIFTY at 15/8, unhalted.
     ↓
  Initialization ──▶ 🔴 NO CONFIG VALIDATION. The platform boots with no configuration at all.
     ↓
  Health Verification ──▶ 🔴 DOES NOT EXIST. /healthz cannot report ill health (021 §0.2).
     ↓
  Normal Operation ──▶ 🟡 works, unobserved.
     ↓
  INCIDENT ──▶ 🔴 INC-001. DETECTED BY ACCIDENT, 14 MINUTES LATE, BY A HUMAN.
     ↓
  Recovery ──▶ 🔴 NOT PERFORMED. MTTR = ∞. The process is still down.
     ↓
  Graceful Shutdown ──▶ 🔴 DID NOT RUN. No EOD snapshot. No record. 14 timers never cleared.
     ↓
  Restart ──▶ 🔴 UNSAFE TODAY: it would resume trading at 15/8 (024 §0).
     ↓
  Post-Recovery Validation ──▶ 🔴 DOES NOT EXIST.
```

## **Five of nine lifecycle stages do not exist, and the one that is deterministic produces an unsafe state.**

---

# PART 3 — RELIABILITY OBJECTIVES

| Objective | Declared? |
|---|---|
| **Availability (SLO)** | ⚪ **UNKNOWN — none declared** |
| **Reliability** | ⚪ **UNKNOWN** |
| **Recovery (RTO/RPO)** | ⚪ **UNKNOWN** |
| **Health** | 🟡 `scripts/perf-report.js` declares 4 **performance** targets 🟢 — 🔴 **no availability target** |
| **Error budget** | ⚪ **UNKNOWN** |
| **Operational policy** | 🟢 **`OPS-PLAYBOOK.md §7` — the Golden Rules.** *The only operational policy that exists, and it is good* |

**029: *"If explicit targets are absent, report them as UNKNOWN rather than inventing values."*** ✅ **Applied.**

## 🔴 The measured reality, against no target at all

```
  MTTD (unattended) : ∞
  MTTR              : ∞
  Availability      : the service has been DOWN for the duration of six audits
  Error budget      : ⚪ undefined — and therefore infinitely overspent
```

---

# PART 4 — INCIDENT GOVERNANCE

| Capability | Verdict |
|---|---|
| **Incident detection** | 🔴 **NONE. `INC-001` was found by accident** |
| **Incident classification** | 🔴 **NONE.** No severity scale, no incident ID — 🟢 *until this document issued `INC-001`* |
| **Escalation** | 🔴 **NONE.** Zero alerts exist *(021)* |
| **Operator notification** | 🔴 **NONE.** `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` and `TELEGRAM_ENABLED` are configured in `.env` **and read by no code at all** *(004)* |
| **Manual intervention** | 🟡 `/api/risk/emergency-stop` — 🔴 **stops 2 of 8 engines, records nothing, undone by a restart** *(012 §0)* — 🔴 **and it is unauthenticated** *(023)* |
| **Recovery procedures** | 🟡 **`OPS-PLAYBOOK.md` covers 4 scenarios. None of them is `INC-001`** |
| **Post-incident review** | 🔴 **NEVER PERFORMED — §0 is the first** |

## ## **Incident governance maturity: LEVEL 0. The platform cannot detect, classify, escalate, notify, or review an incident.**

---

# PART 5 — RUNBOOK ASSESSMENT

**`docs/OPS-PLAYBOOK.md` — 78 lines, 7 sections. Measured against 029's nine required runbooks:**

| Required runbook | Classification | Evidence |
|---|---|---|
| **Startup** | 🔴 **PARTIAL — AND HARMFUL** | §1 says `node server.js`. **It documents the unsupervised start that caused `INC-001` (§0.1)** |
| **Shutdown** | 🔴 **MISSING — zero mentions** | |
| **Restart** | 🟡 **IMPLEMENTED** — 6 mentions, incl. how to kill a stale PID on :3000 | |
| **Backup** | 🔴 **PARTIAL** — 1 mention | 🔴 **And 025 §0 found an orphaned backup and 9 unbacked critical datasets** |
| **Recovery** | 🔴 **MISSING — zero mentions** | |
| **Configuration failures** | 🟡 **PARTIAL** — *"a bad `config-overrides.json` … can be deleted (engines fall back to defaults)"* | 🔴 **And "falling back to defaults" silently changes the risk brake from 5% to 2%** *(024 §0)* |
| **Data corruption** | 🔴 **MISSING — zero mentions** | 🔴 **`safe-write` detects it and halts. Nobody has written down what to do next** |
| **Service degradation** | 🟡 **PARTIAL** — `signal-health DEGRADED` is covered | |
| **Emergency halt** | 🔴 **MISSING — zero mentions** | 🔴 **And the emergency stop stops 2 of 8 engines** *(012 §0)* |

## **Verified: 0. Implemented: 1. Partial: 4. Missing: 4.**

## 🟢 What the playbook gets right

- **§7 Golden Rules** — *"Never trust a single backtest… proven by forward-test, not a fancier signal."* **This is the thesis of the entire audit programme, written before it began.**
- **The `bootId` stale-server guard** — the dashboard auto-reloads when `/healthz` reports a new `bootId`. **A genuinely clever, working operational safeguard.**
- **The P&L verification panel** — re-computes each trade from `entry/exit × lot − charges` and **reconciles the sum against the headline**. **A real, working integrity check.**

---

# PART 6 — AVAILABILITY GOVERNANCE

| Risk | Verdict |
|---|---|
| **Single point of failure** | 🔴 **THE ENTIRE PLATFORM IS ONE PROCESS.** One `node server.js`. No redundancy, no supervisor, no failover. **`INC-001` is the proof** |
| **Operational dependencies** | 🟡 Redis (optional) · Dhan/Upstox (🔴 **the Dhan token has been expired for 7 days**) |
| **Critical services** | 🔴 **All in one process. All died together** |
| **Background jobs** | 🔴 **14 bare `setInterval`s. No queue, no workers, no registry** |
| **Scheduling reliability** | 🔴 **A dead timer is invisible.** A brake that never runs looks exactly like a brake that never fires |
| **Timer lifecycle** | 🔴 **14 `setInterval`, 0 `clearInterval`.** No timer can ever be stopped |
| **Service coordination** | 🔴 **No engine knows any other engine exists** *(007 P7-A)* |

---

# PART 7 — OPERATIONAL OBSERVABILITY

| Required per operational event | Recorded? |
|---|---|
| Timestamp | 🔴 **NO** |
| Service | 🔴 **NO** |
| **Event** | 🔴 **NO — zero lifecycle events are persisted** *(022 §0)* |
| **Severity** | 🔴 **NO** |
| **Operator** | 🔴 **NO — there is no identity** *(023)* |
| Outcome | 🔴 **NO** |
| **Recovery reference** | 🔴 **NO** |

## **0 of 7. *"Operations without observability are incomplete."***

**`INC-001` produced exactly zero records. The only artefact of the outage is this document.**

---

# PART 8 — FAILURE MODE REGISTER

| ID | Failure | Present? | Impact |
|---|---|---|---|
| **OP-1** | **Service crash with no detection, no alert, no record** | 🔴 **CONFIRMED — `INC-001`** | 🔴 **SEV-1. MTTR = ∞** |
| **OP-2** | **The runbook documents the unsupervised start** | 🔴 **CONFIRMED (§0.1)** | 🔴 **CRITICAL — it is the root cause** |
| **OP-3** | **Restart is UNSAFE** | 🔴 **CONFIRMED — it would resume trading at 15/8** *(024 §0)* | 🔴 **CRITICAL — this is why the bot is STILL down** |
| **OP-4** | **Shutdown failure** | 🔴 **CONFIRMED — no EOD snapshot, no record, 14 timers never cleared** | HIGH |
| **OP-5** | **Timer leak** | 🔴 **CONFIRMED — 14/0** | HIGH |
| **OP-6** | **Scheduler failure is invisible** | 🔴 **CONFIRMED — no timer registry** | HIGH |
| **OP-7** | **Dependency failure** | 🔴 **CONFIRMED — the Dhan token expired 7 days ago and nothing alerted** | MEDIUM |
| **OP-8** | **Resource exhaustion** | ⚪ **UNKNOWN — no monitoring** | ⚪ |
| **OP-9** | **Startup failure** | 🟢 **Would be visible — the operator would see it** | 🟢 |

---

# PART 9 & 10 — SRE ARCHITECTURE & OPERATIONAL CONTRACTS (conceptual — no code)

```
   ServiceSupervisor  ★★★   THE FIX FOR INC-001 — AND IT IS ALREADY WRITTEN, TWICE.
     🟢 ecosystem.config.js  : autorestart, max_restarts, restart_delay   ← works
     🟢 docker-compose.yml   : restart: unless-stopped + HEALTHCHECK      ← works
     🔴 THE RUNBOOK SAYS `node server.js`.  CHANGE ONE LINE OF DOCUMENTATION. → OP-2

   HealthManager  ★   A health check that CAN FAIL.
     engine halted? · consecLosses > limit? · ledger corrupt? · feed stale? · token expired?
     🔴 /healthz reports uptime only. /api/m/health → 404 (module-contract, unmounted).

   IncidentManager  ★
     detect → classify(SEV) → escalate → notify → RECORD.
     🔴 TELEGRAM_* is CONFIGURED IN .env AND READ BY NO CODE. The channel exists and is unwired.
     🔴 Every incident gets an ID. INC-001 is the first, and this document issued it.

   RecoveryManager  ★
     🔴 A RESTART MUST NOT RESUME TRADING WITH A BREACHED HALT INVARIANT.  → OP-3
        Boot → validate config → RE-EVALUATE THE HALT → refuse if breached.
        THIS IS WHY THE BOT IS STILL DOWN, AND IT IS THE RIGHT REASON.

   RunbookRegistry  ★  Nine runbooks. Today: 1 implemented, 4 partial, 4 missing.
                       🔴 A runbook is TESTED, not written once. (000-E: restore must be exercised.)

   OperationsAuditLog  ★  The append-only .jsonl writer already exists (022 §1).
                          Every startup, shutdown, crash, halt, resume, config change.
```

## The rule `INC-001` establishes

> **A supervisor that is configured but not started is a file. A runbook that documents the unsupervised
> start is worse than no runbook — it makes the failure official.**
>
> **The platform did not lack the ability to survive this. It had two ways to survive it, and the
> operations manual told the operator to use neither.**

---

# PART 11 — TESTING STRATEGY

**Operational safety has priority over operational convenience.**

| Test | Priority | Status |
|---|---|---|
| 🔴 **Kill the process → a supervisor restarts it within N seconds** | **P0 — `INC-001`** | ✅ **FAILS — MTTR = ∞** |
| 🔴 **A restart REFUSES to resume trading with a breached halt invariant** | **P0 — OP-3** | ✅ **FAILS — it would boot at 15/8** |
| 🔴 **A crash produces a persisted incident record** | **P0 — OP-1** | ✅ **FAILS — zero records** |
| 🔴 **`/healthz` returns UNHEALTHY when an engine is halted or a ledger is corrupt** | **P0** | ✅ **FAILS — it can only say `ok`** |
| 🔴 **The emergency halt stops EVERY engine and survives a restart** | **P0** | ✅ **FAILS — 2 of 8** |
| 🔴 **Every runbook is EXERCISED, not just written** | **P0** | ✅ **FAILS — 025 §0 was the first backup verification ever** |
| **An expired broker token raises an alert** | P1 — OP-7 | ✅ **FAILS — expired 7 days, silent** |
| 🟢 **The `bootId` stale-server guard forces a dashboard reload** | P1 | 🟢 **PASSES — keep it** |
| 🟢 **The P&L verification panel reconciles trades against the headline** | P1 | 🟢 **PASSES — keep it** |

**Six P0 tests. All six fail.**

---

# PART 12 — SRE MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Manual Operations** | 🟢 | `node server.js`, by hand, per the runbook |
| **1 — Basic Monitoring** | 🔴 **NO** | **`INC-001`: the service died and nothing noticed. Zero alerts exist** |
| **2 — Managed Operations** | 🔴 **NO** | 🟡 **A runbook EXISTS and has good parts** — 🔴 **but 4 of 9 required runbooks are missing, and the startup runbook is the root cause of `INC-001`** |
| **3 — Reliable Services** | 🔴 **NO** | **MTTD = ∞. MTTR = ∞. Single process. No supervisor** |
| **4 — Governed SRE** | 🔴 **NO** | **No SLO, no error budget, no incident process** |
| **5 — Enterprise Operations** | 🔴 **NO** | — |

## ## **Operations Platform: LEVEL 0 — MANUAL OPERATIONS.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE — this document.** **`INC-001` is the platform's first classified incident and first post-incident review** | — | none | Root cause established: **the runbook says `node server.js`** |
| **2 — Runbook governance** | 🔴 **CHANGE ONE LINE: the runbook must say `npm run pm2:start`, not `node server.js`.** Write the 4 missing runbooks: shutdown · recovery · data corruption · emergency halt | **🔒 B-3 + S-01 approval — otherwise an automatic restart is an automatic resumption at 15/8** | 🔴 **Until B-3 is approved, a supervisor makes things WORSE, not better** | **The bot runs supervised. MTTR < 5 min** |
| **3 — Incident governance** | 🔴 **An EXTERNAL heartbeat** *(021)*. **Wire the Telegram channel that is already configured and read by nothing.** Every incident gets an ID and a persisted record | Phase 2 | Low | **MTTD < 60 s. Every incident is recorded** |
| **4 — Reliability objectives** | **Declare an SLO.** Error budget. RTO/RPO | Phase 3 | Low | **Reliability is measured against a target, not against nothing** |
| **5 — Enterprise SRE** | Health registry · availability dashboard · operations audit log *(the `.jsonl` writer already exists)* | Phase 4 | Medium | **An SRE can operate this platform from documentation alone** |

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Critical services have documented owners | 🔴 **NO — the scheduler, monitoring and alerting have no owner and do not exist** |
| **Operational procedures are reproducible** | 🟡 **A runbook exists. 4 of 9 are missing. And the startup procedure CAUSED `INC-001`** |
| **Incidents are traceable** | 🔴 **NO — `INC-001` produced ZERO system records. This document is its only artefact** |
| **Recovery is measurable** | 🟢 **YES, for the first time — and it measures `MTTR = ∞`** |
| Health verification is continuous | 🔴 **NO — `/healthz` cannot report ill health** |
| Runbooks are maintained | 🟡 **One exists. Its startup instruction is the root cause of the incident** |
| **Operational failures fail safely** | 🟡 **The bot is DOWN and NOT being restarted — and that is CORRECT, because a restart today resumes trading at 15/8.** **The platform is failing safe by being broken** |

## **1 of 7 — and the one that passes is a measurement of failure.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent SRE operate this platform safely, diagnose incidents, execute
documented recovery, and demonstrate reliable operation using evidence rather than assumptions?**

## **No. And this audit did not have to construct a hypothetical to prove it — the platform produced a real SEV-1 incident, unprompted, while the audit was being written, and could not detect it, classify it, escalate it, record it, or recover from it.**

**`INC-001` — the first incident this platform has ever classified, and the first post-incident review it
has ever had:**

> **The bot died at approximately 06:53 UTC. I discovered it at 07:08, by accident, while querying the
> health endpoint for audit 021. It is still down as this is written.**
>
> ```
> TIME TO DETECT (unattended) : ∞     — no alert, no heartbeat, no monitor exists
> TIME TO RECOVER             : ∞     — the process is still down
> ROOT CAUSE                  : UNKNOWN — no crash log, no exit event, no stack trace
> INCIDENT RECORDS PRODUCED   : ZERO
> ```
>
> **It took the halt state, every open position, the trading day, and every log line since boot with
> it — including a session of the only uncontaminated evidence stream this platform has.**

**And the root cause of the *contributing* failure is not a missing capability. It is a line of
documentation:**

> ## **`docs/OPS-PLAYBOOK.md §1` instructs the operator to run `node server.js` — bare, with no supervisor.**
>
> **In the same repository: `ecosystem.config.js` declares PM2 auto-restart with a 3-second delay.
> `docker-compose.yml` declares `restart: unless-stopped` with a working `/healthz` health check.
> `package.json` already contains `"pm2:start"`.**
>
> **Two working supervisors. The command to use one of them is already written. And the operations
> manual tells the operator to use neither.**
>
> **This is the tenth time in this audit programme that a correct component has been found built and
> unused — and it is the first time the *documentation itself* is the reason.**

**And the runbook's incident-response section could not have covered this, because the platform has no
way to detect it. A runbook can only document incidents you are capable of seeing.**

🟢 **What the operations playbook gets exactly right, and it is worth quoting:**

> *"Never trust a single backtest — the edge is cost-control + regime-timing + risk-management, proven
> by forward-test, not a fancier signal."*
>
> **That is the thesis of this entire thirty-one-document audit programme, written by the platform's own
> author, before the audit began. The operator knew the right rule. What they did not have was any
> tooling capable of enforcing it — and the very harness the runbook recommends for re-validation
> (`bt-validate.js`) carried the same look-ahead bias until audit 002 fixed it.**

**And one final thing, which is genuinely the correct operational posture:**

> **The bot is down, and I have not restarted it — because per 024 §0, a restart today boots the NIFTY
> engine at fifteen consecutive losses against a limit of eight, unhalted and trading.**
>
> ## **The platform is currently failing safe by being broken. That is not a strategy. It is the only safety property this outage has, and it is an accident.**

**The single highest-value change in this document costs nothing and touches no code:**

> ## **Change one line of the runbook: `npm run pm2:start`, not `node server.js`.**
>
> **But only AFTER B-3 + S-01 are approved — because until the halt survives a restart, an automatic
> restart is an automatic resumption of trading at 15/8.**
>
> **Every operational improvement in this document is blocked behind the same single approval package.**

---

**Infrastructure deployed: NONE. Operational behaviour modified: NONE. Code modified: NONE.
Suite: 48/48.**

**Deliverables:** Operations Inventory (Part 1) · Service Lifecycle (Part 2) · Reliability Objectives
(Part 3) · **Incident Governance + `INC-001` post-incident review (§0, Part 4)** · Runbook Assessment
(Part 5) · Availability Governance (Part 6) · Operational Observability (Part 7) · Failure Modes
(Part 8) · SRE Architecture (Parts 9–10) · Testing Strategy (Part 11) · Maturity Assessment (Part 12) ·
Migration Roadmap (Part 13) · Executive Summary.
