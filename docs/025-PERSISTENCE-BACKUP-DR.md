# 025 — DATA PERSISTENCE, STORAGE, BACKUP & DISASTER RECOVERY

**Standard:** Master Prompt 025 · **Depends on:** 000-A … 024
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No database redesigned. No storage migrated.**

---

# SECTION 0 — BACKUP VERIFICATION: PERFORMED FOR THE FIRST TIME

**025's stop condition: *"Never assume recoverability because data currently exists."***
**000-E's rule: *"Backups are not valid until restore has been tested."***

**Nobody has ever tested them. So I did — every `.bak` in `data/`, parsed, compared against its live
file, and checked for orphans.**

```
  file                            parses?  live exists?   age gap    entries (live / bak)
  ──────────────────────────────────────────────────────────────────────────────────────
  ai-agents-impact-history.json    yes       YES           297 s      216 / 215
  ai-agents-open.json              yes       YES             0 s        3 / 3
  ai-agents-trades.json            yes       YES           799 s       23 / 22
  confirmed-signals.json           yes    *** NO ***        n/a       GONE / 1      ◀── 🔴
  confluence-weights.json          yes       YES        86,389 s       21 / 20      ◀── 24 h
  pop-book.json                    yes       YES             0 s        2 / 1
  signal-outcomes.json             yes       YES        84,226 s       12 / 11      ◀── 23 h
  ──────────────────────────────────────────────────────────────────────────────────────
  .bak files: 7      parse OK: 7      CORRUPT: 0      ORPHANED: 1
```

## 🟢 §0.1 — The good news, and it is real

**All seven backups parse. Zero are corrupt.** `safe-write.js` — temp → `fsync` → validate-by-reparse →
atomic rename → `.bak` — **works exactly as designed.** Every backup it produced is a valid, restorable
file.

## 🔴 §0.2 — **AN ORPHANED BACKUP: THE LIVE FILE IS GONE**

```
  data/confirmed-signals.json.bak   EXISTS   (valid, parses, 1 entry)
  data/confirmed-signals.json       DOES NOT EXIST
```

**At some point `confirmed-signals.json` was written — creating a backup — and then the live file
disappeared. Deleted, lost, or never re-created.**

> **Nothing detected it. Nothing reported it. No integrity check exists that compares the set of live
> files against the set of backups.**
>
> **The backup outlived the thing it was backing up, and the platform does not know.**
>
> *(This audit found it only because my verification script crashed on the missing file.)*

## 🔴 §0.3 — **THE RISK-STATE FILE HAS NO BACKUP**

```
  CRITICAL datasets with NO .bak at all:
    equity-nifty.json         ◀── THE RISK STATE. capital · reserve · consecLosses.
    equity-sensex.json        ◀── The entire basis of the C3-07 fail-closed halt.
    config-overrides.json     ◀── The REAL configuration (024 §0)
    strangle-trades.json      ◀── The ₹7L engine's only ledger
    ami-signals-all.json      ◀── 233 KB, the largest state file
    vrp-monitor.json · gex-vix-history.json · market-state.json · signal-paper-positions.json
```

**`execution-engine.js:184` writes the equity file with `{ pretty: true, backup: true }`.**
**And there is no `.bak` on disk.**

**Why?** `safe-write.js:111` — `if (opts.backup && existed)` — a backup is created **only if the file
already existed at write time**. The most likely explanation is that **`saveEquity()` has not run since
the file was created** *(last written 2026-07-09; no paper trade has closed since)*.

⚪ **Whether that is the cause is UNKNOWN — and that uncertainty is precisely the finding.**

### What happens if `equity-nifty.json` corrupts right now

| Step | Behaviour |
|---|---|
| 1 | `restoreEquity()` → `safe-write.readJsonSync` detects corruption |
| 2 | It looks for `.bak` — **and there is none** |
| 3 | The `catch` fires → **`_haltedReason = 'EQUITY_STATE_CORRUPT'`, `autoEnabled = false`** |
| 4 | 🟢 **The engine HALTS. Fail-closed. Correct.** *"Cannot know the loss streak — HALTING."* |
| 5 | 🔴 **And the capital (₹96,761) and the loss streak (15) are UNRECOVERABLE.** |
| 6 | 🔴 **And per 005 S-01, that halt does not survive the next restart anyway.** |

> **The fail-closed behaviour is correct. The recovery is impossible. The halt that protects you from the
> impossible recovery then evaporates on the next boot.**

## §0.4 — Coverage

```
  7 backups / 51 JSON files  =  14% coverage
  0 of the 9 CRITICAL datasets have a backup.
```

---

# PART 1 — DATA INVENTORY

| Dataset | Owner | Mechanism | Backup | Recovery requirement | Confidence |
|---|---|---|---|---|---|
| **`equity-<inst>.json`** — capital, reserve, consecLosses | engine | 🟢 `safe-write` | 🔴 **NONE ON DISK** | 🔴 **CRITICAL** | HIGH |
| 🔴 **Halt state (`_haltedReason`)** | engine | 🔴 **NOT PERSISTED AT ALL** | — | 🔴 **CRITICAL** | HIGH |
| **`config-overrides.json`** — the real config | 🔴 3 writers | 🟡 2 atomic, **1 raw** | 🔴 **NONE** | 🔴 **CRITICAL** | HIGH |
| 🔴 **Open positions** | — | 🔴 **NOT PERSISTED** in 3 of 4 engines | — | 🔴 **CRITICAL** | HIGH |
| **Orders** | — | 🔴 **DO NOT EXIST** | — | — | HIGH |
| **Paper trades (closed)** | per-engine | 🟢 `safe-write` | 🟡 **3 of 6 ledgers** | HIGH | HIGH |
| **`confluence-weights.json`** — the live AI model | learner | 🟢 `safe-write` | 🟢 **`.bak` (24 h old)** | HIGH | HIGH |
| **Research results** | — | 🔴 **overwritten in place** *(015 §0.B)* | 🔴 **NONE** | HIGH | HIGH |
| 🔴 **Feature data** | — | 🔴 **DISCARDED ON EVERY INFERENCE** *(018)* | — | 🔴 **CRITICAL — worsens daily** | HIGH |
| **Market data (`bt-data/bhav`)** | — | 🟢 600 CSV | 🟢 **RE-DOWNLOADABLE FROM NSE** | 🟢 **The one thing that is safe** | HIGH |
| 🔴 **Option history (`opt-hl/`, `opt-candles/`)** | — | 🟡 files | 🔴 **NONE** | 🔴 **NOT RE-DERIVABLE. Live-only. Lost forever** | HIGH |
| **Logs** | — | 🔴 **`console.log` → a terminal buffer** | — | 🔴 **Died with the process (021 §0)** | HIGH |
| **Audit history** | — | 🔴 **DOES NOT EXIST** *(022)* | — | 🔴 **CRITICAL** | HIGH |
| **EOD snapshots** | `server.js:4255` | 🔴 **RAW `writeFileSync`** | 🔴 **NONE** | MEDIUM | HIGH |
| **`backups/` (migration snapshots)** | this audit | 🟢 16 snapshots + `ROLLBACK.sh` | 🟢 | 🟢 **The best-governed store in the repo** | HIGH |

---

# PART 2 — DATA LIFECYCLE

```
  Creation ──▶ Validation ──▶ Persistence ──▶ Updates ──▶ Snapshots ──▶ Backup ──▶
  Recovery ──▶ Archive ──▶ Deletion
      ↓            ↓             ↓             ↓            ↓            ↓
      │            │             │             │            │            └── 🔴 14% coverage.
      │            │             │             │            │                0 of 9 critical files.
      │            │             │             │            └── 🔴 The EOD "snapshot" is a read taken
      │            │             │             │                while 14 timers are still writing.
      │            │             │             └── 🔴 OVERWRITE IN PLACE. One .bak = one version.
      │            │             └── 🟢 safe-write: atomic, fsync, validate-by-reparse. EXCELLENT.
      │            │                 🔴 …and 10 production sites route around it.
      │            └── 🔴 NO VALIDATION on write. (11 raw JSON.parse on read.)
      └── 🟡 files appear.

  Deletion ──▶ 🔴 NO RETENTION POLICY. 19 eod-*.json accumulate forever.
               🔴 AND: confirmed-signals.json was deleted by SOMETHING, and nothing knows (§0.2).
```

---

# PART 3 — STORAGE GOVERNANCE

| Store | Owner | Lifecycle |
|---|---|---|
| **`data/*.json`** — 51 files | 🔴 **fragmented** | 🔴 **no retention policy, no cleanup, no integrity check** |
| **`bt-data/bhav/`** — 600 CSV | 🟢 fetcher | 🟢 **permanent, re-downloadable** |
| **`data/opt-hl/`, `data/opt-candles/`** | `server.js` | 🔴 **live-only, NOT re-derivable** |
| **`data/migrations/*.jsonl`** | — | 🟢 **append-only, immutable** *(022 §1)* |
| **`logs/`** | ⚪ **DEAD — 19 files, all from 2026-06-18, from abandoned experiments** | 🔴 **The bot writes to NO log file** |
| **`backups/`** | this audit | 🟢 16 migration snapshots + `ROLLBACK.sh` |
| **Cache** | in-memory | 🔴 lost on restart |
| **Redis** | `redis-store.js` | 🟡 intraday H/L only |

---

# PART 4 — PERSISTENCE GOVERNANCE

| Question | Answer |
|---|---|
| **Who creates data?** | 🔴 **18 modules via `safe-write` 🟢 · 10 production sites raw 🔴** |
| **Who updates it?** | 🔴 Same, no coordination |
| **Who deletes it?** | 🔴 **UNKNOWN — and §0.2 proves it: `confirmed-signals.json` is gone and nobody knows why** |
| **Who owns persistence?** | 🟢 **`safe-write.js` — where it is used.** 🔴 **10 sites bypass it** |
| **Who restores state?** | 🟡 `restoreEquity()` per engine — 🔴 **and it never restores the halt** |

### Missing ownership
**Deletion has no owner. Retention has no owner. Integrity has no owner.**

## 🔴 **025's stop condition triggers: *"Data ownership cannot be established"* → for deletion, UNKNOWN.**

---

# PART 5 — BACKUP GOVERNANCE

| Aspect | Verdict |
|---|---|
| **Frequency** | 🟡 **On every `safe-write` with `backup: true`** — **so it depends on writes happening.** `equity-*.json` has not been written since 2026-07-09 |
| **Integrity** | 🟢 **VERIFIED — §0. All 7 parse. Zero corrupt** |
| **Snapshot consistency** | 🔴 **The EOD snapshot is written while 14 timers are still running** *(001-B A-04)* |
| **Versioning** | 🔴 **ONE prior version. And it can be 24 hours old** (`confluence-weights.json.bak`: 86,389 s) |
| **Retention** | 🔴 **NONE** |
| **Verification** | 🔴 **NEVER PERFORMED before §0** |
| **Coverage** | 🔴 **14%. Zero of the 9 critical datasets** |
| **Orphan detection** | 🔴 **NONE — §0.2** |

## ## **Backup maturity: the MECHANISM is excellent. The GOVERNANCE does not exist.**

---

# PART 6 — RECOVERY GOVERNANCE

| Scenario | Behaviour |
|---|---|
| **Startup recovery** | 🟡 capital ✓ reserve ✓ consecLosses ✓ · 🔴 **halt ✗** · 🔴 **open positions ✗** |
| **Restart recovery** | 🔴 **BROKEN.** 021 §0 proved it live: the bot died and **the halt, the open positions and the trading day all vanished** |
| **Partial recovery** | 🟢 `safe-write` prevents torn writes **where it is used** |
| **Corrupted storage** | 🟢 **DETECTED. HALTS. Fail-closed (C3-07).** 🔴 **And with no `.bak` for `equity-*.json`, recovery is IMPOSSIBLE (§0.3)** |
| **Missing files** | 🟡 `restoreEquity()` silently starts at ₹100,000 — 🔴 **no warning that the account is unknown** |
| **Interrupted persistence** | 🟢 Atomic rename — impossible via `safe-write` · 🔴 **possible on the 10 raw sites, including `.env`** |
| **Snapshot replay** | 🔴 **IMPOSSIBLE.** No event history *(022)* |

## Recovery guarantees, stated honestly

| | |
|---|---|
| 🟢 **GUARANTEED** | A `safe-write` file is never torn. A corrupt read is **detected and refused**. The bhavcopy is re-downloadable |
| 🟡 **PARTIAL** | Capital and `consecLosses` survive a restart |
| 🔴 **NOT GUARANTEED** | **The halt. Open positions. Any file written raw. The EOD snapshot's consistency. Intraday option chains — gone forever** |
| 🔴 **IMPOSSIBLE** | **Recovery of `equity-*.json` if it corrupts — there is no backup** |

---

# PART 7 — DATA INTEGRITY

| Guarantee | Verdict |
|---|---|
| **Atomicity** | 🟢 **`safe-write`: temp → fsync → validate-by-reparse → atomic rename.** **Genuinely excellent** |
| | 🔴 **10 production sites bypass it** — `.env`, `eod-*.json`, `config-overrides` (1 of 3), `signal-paper-positions`, `ami-signals-all` |
| **Consistency** | 🔴 **NO transaction spans two files.** A crash between two writes leaves them disagreeing, permanently |
| **Duplicate detection** | 🔴 **NONE — no event ID, no position ID** |
| **Partial writes** | 🟢 Impossible via `safe-write` · 🔴 possible on the 10 raw sites |
| **Corruption handling** | 🟢 **Detected and refused.** 🔴 **And nobody is told** *(021)* |
| **Validation after recovery** | 🔴 **NONE.** No integrity check compares live files against backups — **which is why §0.2 went unnoticed** |

---

# PART 8 — OBSERVABILITY

| Required per persistence event | Recorded? |
|---|---|
| Timestamp | 🟡 `updatedAt` — **the latest only** |
| Dataset | 🟡 implied by filename |
| **Version** | 🔴 **NO — no schema version in any file** |
| **Operation** | 🔴 **NO** |
| **Source** | 🔴 **NO** |
| Outcome | 🔴 **NO** |
| **Recovery reference** | 🔴 **NO** |

## **1 of 7. And §0.2 is the cost: a file vanished and no record exists.**

---

# PART 9 — FAILURE MODE REGISTER

| ID | Failure | Present? | Impact |
|---|---|---|---|
| **DR-1** | **The risk-state file has NO backup** | 🔴 **CONFIRMED (§0.3)** | **CRITICAL. Corruption ⇒ correct halt, impossible recovery** |
| **DR-2** | **An orphaned backup — the live file is gone** | 🔴 **CONFIRMED (§0.2)** | **CRITICAL. A dataset vanished and nothing knows** |
| **DR-3** | **Open positions are not persisted** | 🔴 **CONFIRMED — 3 of 4 engines** | **CRITICAL — 021 §0 proved it live** |
| **DR-4** | **The halt is not persisted** | 🔴 **CONFIRMED** | **CRITICAL** |
| **DR-5** | **Results overwritten in place** | 🔴 **CONFIRMED** *(015 §0.B)* | **CRITICAL. Evidence destroyed** |
| **DR-6** | **Features discarded** | 🔴 **CONFIRMED** *(018)* | **CRITICAL — and it worsens every day** |
| **DR-7** | **The EOD snapshot is inconsistent** | 🔴 **CONFIRMED — written while 14 timers run** | HIGH |
| **DR-8** | **10 raw write sites** | 🔴 **CONFIRMED — including `.env`** | HIGH |
| **DR-9** | **No retention policy** | 🔴 **CONFIRMED — 19 EOD files accumulate** | LOW |
| **DR-10** | **Storage exhaustion** | ⚪ **UNKNOWN — no disk monitoring** | ⚪ |
| **DR-11** | **Intraday option chains are not re-derivable** | 🔴 **CONFIRMED — 1 session exists** | **CRITICAL — irreversible** |
| 🟢 **DR-12** | **Backup integrity** | 🟢 **VERIFIED — 7/7 parse, 0 corrupt** | — |

---

# PART 10 & 11 — DISASTER RECOVERY ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   BackupManager  ★
     🔴 EVERY CRITICAL DATASET IS BACKED UP — not just those that happen to be written.
        Today: 0 of 9 critical files have a backup.
     🔴 Backup on a SCHEDULE, not only on write. equity-*.json has not been written since 09 Jul.
     🔴 N versions, not one. A .bak that is 24 hours old is not a backup — it is a coin flip.

   IntegrityChecker  ★★  RUNS ON A SCHEDULE. IT IS THE THING THAT WAS MISSING.
     🔴 every live file parses?
     🔴 every live file has a valid backup?
     🔴 EVERY BACKUP HAS A LIVE FILE?          ← this ONE check would have caught §0.2
     🔴 a mismatch is an INCIDENT, not a silence.

   RecoveryManager  ★
     🔴 RESTORE IS TESTED ON A SCHEDULE, not assumed. (000-E: "not valid until restore has been tested.")
     🔴 A restart that cannot restore an open position is an INCIDENT.        → DR-3
     🔴 An ABSENT haltedReason in an old file means UNKNOWN ⇒ BRAKE ON.       → DR-4

   ArchiveLayer  ★  Append-only. Immutable. The .jsonl writer already exists (022 §1).
                    🔴 A RESULT IS NEVER OVERWRITTEN. A new run is a NEW row.  → DR-5

   safe-write.js  🟢 ALREADY CORRECT. MAKE IT THE ONLY DOOR. 10 sites still bypass it.
```

## The rule §0 establishes

> **A backup you have never restored is a belief, not a guarantee. And a backup with no live file is
> proof that nobody is looking.**

---

# PART 12 — TESTING STRATEGY

| Test | Priority | Would it fail today? |
|---|---|---|
| 🔴 **Every backup has a live file, and every critical live file has a backup** | **P0 — §0.2/§0.3** | ✅ **FAILS — 1 orphan, 9 unbacked critical files** |
| 🔴 **`equity-*.json` corrupts ⇒ restore from `.bak` succeeds** | **P0 — §0.3** | ✅ **FAILS — there is no `.bak`** |
| 🔴 **An open position survives a restart, or an incident is raised** | **P0 — DR-3** | ✅ **FAILS** |
| 🔴 **A halt survives a restart** | **P0 — DR-4** | ✅ **FAILS** |
| 🔴 **A result file is never overwritten in place** | **P0 — DR-5** | ✅ **FAILS** |
| **Restore is exercised on a schedule, not assumed** | **P0 — 000-E** | ✅ **FAILS — §0 is the first ever** |
| 🟢 **`safe-write`: an interrupted write leaves the original intact** | P1 | 🟢 **PASSES — it already has a suite. Keep it** |
| 🟢 **Every `.bak` parses** | P1 | 🟢 **PASSES (§0). Lock it in as a scheduled check** |

**Six P0 tests fail. Two pass and must be locked in.**

---

# PART 13 — DATA MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Local Persistence** | 🟢 | 51 JSON files on disk |
| **1 — Managed Storage** | 🟡 **PARTIAL** | 🟢 **`safe-write` is excellent, and 18 modules use it.** 🔴 **10 production sites bypass it. No retention. No owner for deletion** |
| **2 — Governed Persistence** | 🔴 **NO** | **The halt and open positions are not persisted at all** |
| **3 — Verified Recovery** | 🔴 **NO** | 🟢 **§0 is the first backup verification ever performed** — 🔴 **and it found an orphan and 9 unbacked critical files** |
| **4 — Disaster Readiness** | 🔴 **NO** | **No DR procedure exists. 021 §0 was a live disaster and produced no record** |
| **5 — Enterprise Data Platform** | 🔴 **NO** | — |

## ## **Data Platform: LEVEL 0–1 — LOCAL PERSISTENCE / partially managed.**

---

# PART 14 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE — this document. §0 is the platform's first backup verification** | — | none | 7 backups verified · 1 orphan · 9 unbacked critical files |
| **2 — Ownership** | 🔴 **An `IntegrityChecker` on a schedule.** *"Every backup has a live file. Every critical live file has a backup."* **One check would have caught §0.2** | none | **Zero — read-only** | **An orphan or a missing backup raises an incident** |
| **3 — Persistence governance** | 🔴 **`equity-*.json` and `config-overrides.json` get scheduled backups, not write-triggered ones.** Route the 10 raw sites through `safe-write` | Phase 2 | **Low.** 🔒 **7 sites are in `server.js` — PROTECTED (packages written)** | **0 raw production writes. Every critical file has N versions** |
| **4 — Recovery validation** | 🔴 **PERSIST THE HALT** (005 S-01). 🔴 **PERSIST OPEN POSITIONS** (010 §0). **Test restore on a schedule** | Phase 3 | 🔴 **BEHAVIOUR CHANGE — and it is the entire point.** Approval | **A restart loses nothing. 021 §0 becomes impossible** |
| **5 — Disaster readiness** | **A written, tested DR procedure.** Off-machine copies of `data/` and `.env`. **Start capturing intraday chains — DR-11 is irreversible** | Phase 4 | Medium | **The platform can be rebuilt from documented governance alone** |

---

# PART 15 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every persisted dataset has one owner | 🔴 **NO — deletion has no owner at all (§0.2)** |
| Persistence behaviour is deterministic | 🟢 **YES — where `safe-write` is used** · 🔴 **NO on 10 raw sites** |
| **Backups are verifiable** | 🟢 **YES — and §0 verified them for the first time. All 7 parse** |
| **Recovery is reproducible** | 🔴 **NO — 021 §0 was a live disaster with no record, and `equity-*.json` has no backup to recover from** |
| Data integrity is measurable | 🔴 **NO — no integrity check exists** |
| **Restart state is recoverable** | 🔴 **NO — the halt and open positions are lost, every time** |
| **DR procedures are documented and testable** | 🔴 **NO — none exists** |

## **1 of 7.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent engineer identify every dataset, reproduce recovery after restart,
verify backup integrity, and confirm the platform can recover from storage failure?**

## **Verify the backups: yes — I did it, for the first time. Recover from a restart: no. And the verification found two things nobody knew.**

🟢 **The mechanism is genuinely excellent.** `safe-write.js` — temp file → `fsync` → **validate by
re-parsing** → atomic rename → `.bak` — is the best-engineered module in this repository. **All seven
backups it produced parse cleanly. Zero are corrupt.** When it detects corruption, it **refuses to
write and the engine halts, fail-closed** — *"Cannot know the loss streak — HALTING."* **That is exactly
right.**

🔴 **And the governance around it does not exist.**

> ## **1. AN ORPHANED BACKUP.**
> **`data/confirmed-signals.json.bak` exists, valid and parseable. `data/confirmed-signals.json` does
> not exist at all.**
>
> **A dataset vanished. The backup outlived it. No check compares the set of live files against the set
> of backups, so nothing noticed — and nothing ever would have. I found it only because my verification
> script crashed on the missing file.**

> ## **2. THE RISK-STATE FILE HAS NO BACKUP.**
> **`equity-nifty.json` and `equity-sensex.json` hold the capital, the reserve and the consecutive-loss
> count. They are the entire basis of the C3-07 fail-closed halt. They are written with
> `backup: true`.**
>
> **And there is no `.bak` on disk for either of them.**
>
> **If `equity-nifty.json` corrupts, the engine will correctly halt with `EQUITY_STATE_CORRUPT` — and
> the ₹96,761 balance and the 15-loss streak will be unrecoverable. And per 005 S-01, that halt will not
> survive the next restart anyway.**

**Coverage: seven backups across fifty-one files — 14%. Zero of the nine critical datasets are backed
up.**

**And 021 §0 already showed what this costs in practice: the bot died, and the halt, the open positions
and the trading day went with it, leaving no record at all.**

**The single cheapest change with the largest return — and it is read-only:**

> ## **AN INTEGRITY CHECKER, ON A SCHEDULE. THREE QUESTIONS:**
> **Does every live file parse? Does every critical live file have a backup? DOES EVERY BACKUP HAVE A
> LIVE FILE?**
>
> **That third question — one line of code — would have caught the orphan. Nobody has ever asked it.**
>
> **000-E says it plainly: *"Backups are not valid until restore has been tested."* Until §0, this
> platform's backups were a belief. Now seven of them are a fact, and nine critical datasets are known
> to have none.**

---

**Databases redesigned: NONE. Storage migrated: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Data Inventory (Part 1) · Lifecycle (Part 2) · Storage Governance (Part 3) ·
Persistence Review (Part 4) · **Backup Assessment — VERIFIED FOR THE FIRST TIME (§0, Part 5)** ·
Recovery Assessment (Part 6) · Data Integrity (Part 7) · Observability (Part 8) · Failure Modes
(Part 9) · DR Architecture (Parts 10–11) · Testing Strategy (Part 12) · Maturity Assessment (Part 13) ·
Migration Roadmap (Part 14) · Executive Summary.
