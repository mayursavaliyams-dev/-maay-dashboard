# 039 — DATA LIFECYCLE, RETENTION, BACKUP, RECOVERY & COMPLIANCE

**Standard:** Master Prompt 039 · **Depends on:** 000-A … 038
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No storage redesigned. No backup system implemented.**

**039's stop condition: *"Never assume recoverability because backup files exist."***
**Audit 025 verified the backups. 039 audits what DELETES, what is RETAINED, and how far back you can
actually go. Nobody has ever looked.**

---

# ═══════════════════════════════════════════════════════════
# SECTION 0 — 🔴 A SILENT RETENTION CAP IS ABOUT TO DESTROY
#              THE PLATFORM'S MOST VALUABLE IRREPLACEABLE DATASET
# ═══════════════════════════════════════════════════════════

## §0.1 — The retention policy nobody wrote down, and nobody knows exists

```js
server.js:578
  fs2.writeFileSync(path2.join(_optCandDir, `${day}.json`), JSON.stringify({...}));
  const files = fs2.readdirSync(_optCandDir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  while (files.length > 40) { try { fs2.unlinkSync(path2.join(_optCandDir, files.shift())); } catch (_) {} }
                                    ↑                                          ↑
                            SILENT DELETE                              OLDEST FIRST (FIFO)
```

**`data/opt-candles/` has a hard FIFO cap of 40 files. The oldest is deleted, silently, inside an empty
`catch`.**

## §0.2 — 🔴 **AND `2026-07-08.json` IS IN THAT DIRECTORY**

```
  data/opt-candles/2026-07-08.json
    669 series (a FULL option chain)
    371 bars across a 374-minute span  =  99% coverage
    09:15 IST → 15:29 IST  —  exactly the NSE session
```

> ## **This is the ONLY complete intraday option-chain session this platform has ever captured** *(037 §0.2)*.
>
> **The other four sessions are 8%, 15%, 19% and 30% complete** *(034 §0)*.
>
> ## **It cannot be re-derived. Not from the bhavcopy, which is EOD-only. Not from any broker, which does not sell history at this granularity. Not ever.**

## §0.3 — The countdown, measured

```
  data/opt-candles/    5 files today.    CAP = 40.
  ──────────────────────────────────────────────────
  →  ~35 more trading sessions until files.shift() begins deleting.
  →  2026-07-06 goes first. Then 2026-07-07. THEN 2026-07-08.
```

> ## 🔴 **THE PLATFORM'S ONLY COMPLETE INTRADAY SESSION IS SCHEDULED FOR SILENT DELETION IN ROUGHLY THIRTY-SEVEN TRADING DAYS.**
>
> **Nothing warns. Nothing backs it up — `opt-candles` is not among the seven files with a `.bak`
> *(025 §0.3)*. The delete is wrapped in `catch (_) {}` so it cannot even fail loudly.**
>
> **And the cap was set to 40 by someone who was managing disk space, in a directory that at the time
> held nothing irreplaceable.**

**Severity: CRITICAL. And unlike almost every other finding in this forty-one-document programme, this
one has a deadline.**

---

# SECTION 1 — 🔴 AN UNAUTHENTICATED ROUTE DELETES THE REAL CONFIGURATION

```js
server.js:3781
  app.post('/api/strategy-config/reset', (req, res) => {
    try {
      const fs = require('fs');
      if (fs.existsSync(CONFIG_OVERRIDE_PATH)) fs.unlinkSync(CONFIG_OVERRIDE_PATH);   // ◀── DELETE
    } catch (_) {}
```

## What is being deleted

**Audit 004 §0 established that `data/config-overrides.json` is **THE REAL CONFIGURATION** — it silently
overrules `.env` on every value it contains:**

```json
  { "MAX_DAILY_LOSS_PERCENT": 5,        ← .env says 2. The ENGINE runs at 5.
    "CAPITAL_TOTAL": 100000,
    "STRANGLE_CAPITAL": 700000,          ← the ₹7L allocation
    "STRANGLE_ENGINE_ENABLED": true,
    "NIFTY_DIRECTIONAL_AUTO": true,
    "SENSEX_DIRECTIONAL_AUTO": true,     ← .env says SENSEX_AUTO_ENABLED=false
    "GAMMA_BLAST_ENGINE_ENABLED": true,
    "AI_AGENTS_ENABLED": true,
    "SENSEX_AFTERNOON_AUTO": true,
    "NIFTY_AFTERNOON_AUTO": true,
    "BOUNCE_ENGINE_ENABLED": true }
```

## Three compounding facts

| # | Fact |
|---|---|
| **1** | 🔴 **The route is UNAUTHENTICATED.** `0 of 172 routes carry auth middleware`; `AUTH_ENABLED` defaults to `false` *(023)*. **Any host on the LAN can `POST` it** |
| **2** | 🔴 **`config-overrides.json` has NO BACKUP.** It is one of the nine critical datasets with no `.bak` *(025 §0.3)*. **`unlinkSync` is unrecoverable** |
| **3** | 🔴 **THE OPS PLAYBOOK RECOMMENDS DELETING IT.** `OPS-PLAYBOOK.md §6`: *"a bad `config-overrides.json` or data file **can be deleted** (engines fall back to defaults)"* |

> ## **The operations manual instructs the operator to delete an unbacked file that holds the entire engine state — and an unauthenticated HTTP route does it in one call.**
>
> **The ₹7 lakh strangle allocation, every engine's enabled/disabled state, and the account's capital
> figure all live in that file, and only in that file.**

---

# SECTION 2 — THE REAL RECOVERY WINDOW: **ONE WRITE**

**Measured — the age of every `.bak` relative to its live file:**

```
  dataset                          .bak lag behind live      window
  ─────────────────────────────────────────────────────────────────────
  ai-agents-open.json                    0 s                 ONE version
  pop-book.json                          0 s                 ONE version
  ai-agents-impact-history.json          0.1 h               ONE version
  ai-agents-trades.json                  0.2 h               ONE version
  signal-outcomes.json                  23.4 h               ONE version
  confluence-weights.json               24.0 h               ONE version   ← the LIVE AI MODEL
  confirmed-signals.json            *** LIVE FILE GONE ***   NONE (orphan)
```

> ## **POINT-IN-TIME RECOVERY WINDOW = EXACTLY ONE WRITE BACK. Nothing older exists anywhere.**
>
> **And the "backup" of `confluence-weights.json` — the platform's only live learning model — is
> **twenty-four hours stale**. Restoring from it discards a full day of learning.**
>
> **`safe-write` overwrites `.bak` on every write. There is no version 2. There is no archive.**

---

# PART 1 — DATA LIFECYCLE INVENTORY

| Category | Owner *(inferred — 038)* | Lifetime | Retention policy | Backup | Recovery priority |
|---|---|---|---|---|---|
| 🟢 **Raw market data (bhavcopy)** | `bt-bhav-fetch` | permanent | 🔴 **NONE** | 🟢 **RE-DOWNLOADABLE from NSE** | LOW *(recoverable)* |
| 🔴 **Option chains — intraday** | `server.js:566` | 🔴 **FIFO 40** | 🔴 **§0 — SILENT DELETE** | 🔴 **NONE** | 🔴 **CRITICAL — IRREPLACEABLE** |
| **Option H/L archive** | `server.js:518` | 🔴 **FIFO 120** | 🔴 silent delete | 🔴 NONE | HIGH |
| ⚪ **Tick data** | — | — | — | — | ⚪ **DOES NOT EXIST** *(037)* |
| ⚪ **Replay data** | — | — | — | — | ⚪ **1 of 8 event classes** *(037)* |
| 🔴 **Feature store** | — | — | — | — | 🔴 **DOES NOT EXIST — features DISCARDED** *(035)* |
| **AI training data** | `confluence-learner` | permanent | 🔴 none | 🟡 **`.bak` — 24 h STALE** | 🔴 **HIGH** |
| **Paper trading logs** | 6 engines | permanent | 🟡 `slice(-5000)`, `slice(-4000)` | 🟡 **3 of 6 have a `.bak`** | 🔴 **CRITICAL — the only clean evidence** |
| 🔴 **Risk data (the halt)** | — | 🔴 **process lifetime** | — | 🔴 **NOT PERSISTED** *(005 S-01)* | 🔴 **CRITICAL** |
| **Reports (`eod-*.json`)** | `server.js:4255` | permanent | 🔴 **NONE — 19 files accumulate** | 🔴 **RAW write, no `.bak`** | MEDIUM |
| 🔴 **Configuration snapshots** | 3 writers | 🔴 **DELETABLE BY HTTP (§1)** | 🔴 none | 🔴 **NO `.bak`** | 🔴 **CRITICAL** |
| 🔴 **Audit logs** | — | — | — | — | 🔴 **DO NOT EXIST** *(022)* |
| **Backtest results** | 13 scripts | permanent | 🔴 **OVERWRITTEN IN PLACE** *(015 §0.B)* | 🔴 NONE | HIGH |
| 🟢 **Migration archives** | audits | permanent | 🟢 append-only `.jsonl` | 🟢 | LOW |

## **Fourteen categories. Two have a real retention policy — and both of those DELETE. Three do not exist.**

---

# PART 2 — LIFECYCLE STAGES

```
  Creation ──▶ Validation ──▶ Operational Use ──▶ Versioning ──▶ Archive ──▶ Retention ──▶ Deletion
      ↓            ↓                ↓                  ↓             ↓            ↓            ↓
      │            │                │                  │             │            │            └── 🔴 SILENT.
      │            │                │                  │             │            │                Inside catch(_){}.
      │            │                │                  │             │            └── 🔴 TWO FIFO CAPS,
      │            │                │                  │             │                UNDECLARED, and one is
      │            │                │                  │             │                a TIME BOMB (§0)
      │            │                │                  │             └── 🔴 NO ARCHIVE. Nothing is ever
      │            │                │                  │                 moved to cold storage.
      │            │                │                  └── 🔴 ONE VERSION. The .bak IS the versioning.
      │            │                └── 🟡 works
      │            └── 🔴 NONE (until audits 031/033)
      └── 🟡 files appear.
```

## **Four of seven lifecycle stages are absent or silent.**

---

# PART 3 — RETENTION GOVERNANCE

| Data class | Policy | Declared? |
|---|---|---|
| **Market data (bhavcopy)** | 🔴 **NONE — grows forever** | — |
| 🔴 **Intraday chains** | 🔴 **FIFO 40 — DELETES** | 🔴 **NO. Buried at `server.js:578`** |
| 🔴 **Option H/L** | 🔴 **FIFO 120 — DELETES** | 🔴 **NO. Buried at `server.js:541`** |
| **AI trades** | 🟡 `slice(-5000)` | 🔴 NO |
| **AI impact history** | 🟡 `slice(-4000)` | 🔴 NO |
| **AmiBroker signals** | 🟡 `slice(-300)` | 🔴 NO |
| **Paper trades** | 🔴 **NONE** | — |
| **Logs** | 🔴 **N/A — they die with the process** *(021)* | — |
| **Config snapshots** | 🔴 **NONE — and one HTTP call deletes them (§1)** | — |
| **Audit records** | 🔴 **N/A — they do not exist** | — |
| **`eod-*.json`** | 🔴 **NONE — 19 files, unbounded** | — |

## 🔴 **Every retention policy in this platform is a silent cap or a silent slice. Not one is declared, documented, logged, or alertable.**

---

# PART 4 — BACKUP GOVERNANCE

| Aspect | Verdict |
|---|---|
| **Scope** | 🔴 **7 of 51 datasets = 14%.** **ZERO of the 9 critical ones** *(025 §0.3)* |
| **Frequency** | 🔴 **WRITE-TRIGGERED, not scheduled.** `equity-*.json` has not been written since 2026-07-09 ⇒ **no `.bak` exists** |
| **Verification** | 🟢 **PERFORMED — 025 §0. All 7 parse, 0 corrupt. First time ever** |
| **Ownership** | 🔴 **NONE** |
| **Versioning** | 🔴 **ONE version. §2** |
| **Encryption** | 🔴 **NONE. `.env` is mode `0644`** *(023)* |
| **Monitoring** | 🔴 **NONE — 025 §0.2's orphan proves it** |

---

# PART 5 — RECOVERY GOVERNANCE

| Recovery type | Supported? |
|---|---|
| **Full recovery** | 🔴 **NO** |
| **Partial recovery** | 🟡 `safe-write` restores a corrupt file from its `.bak` — **where one exists** |
| 🔴 **Point-in-time recovery** | 🔴 **ONE WRITE BACK. §2.** No archive, no history |
| 🔴 **Configuration recovery** | 🔴 **IMPOSSIBLE. `config-overrides.json` has NO `.bak`, and an HTTP route deletes it (§1)** |
| **Dataset recovery** | 🟢 Bhavcopy: **re-downloadable** · 🔴 **Intraday: IRREPLACEABLE (§0)** |
| 🔴 **Research reproducibility** | 🔴 **NO — 0 of 13 results carry a `gitSha`** *(008)* |
| 🔴 **Disaster recovery** | 🔴 **NO PROCEDURE EXISTS.** `INC-001` was a real SEV-1 and produced **zero records** *(029)* |

## 🔴 Recovery assumptions, made explicit for the first time

> **The platform assumes: (a) the bhavcopy can be re-fetched, (b) a corrupt file has a `.bak`, and
> (c) an operator can rebuild `config-overrides.json` from memory.**
>
> **(a) is TRUE. (b) is FALSE for the nine most important files. (c) is a fiction — nothing records what
> was in it.**

---

# PART 6 — ARCHIVAL GOVERNANCE

| Aspect | Verdict |
|---|---|
| **Archive criteria** | 🔴 **NONE — nothing is ever archived. Files are DELETED, not moved** |
| **Archive integrity** | ⚪ **N/A** |
| **Archive discoverability** | ⚪ **N/A** |
| **Archive retention** | ⚪ **N/A** |
| 🟢 **The one real archive** | 🟢 **`backups/` — 16 migration snapshots with `ROLLBACK.sh`, created by THIS audit programme.** The only governed archive in the repository |

## 🔴 **"Historical evidence must remain reproducible." — §0 is a scheduled deletion of irreproducible historical evidence.**

---

# PART 7 — OBSERVABILITY

| Required per lifecycle event | Recorded? |
|---|---|
| Dataset · Stage · Timestamp · Owner · Version · Backup status · Recovery status · Validation | 🔴 **NONE OF THEM** |

## **0 of 8. And the deletions happen inside `catch (_) {}` — they cannot even fail loudly.**

---

# PART 8 — FAILURE MODE REGISTER

| ID | Failure | Present? | Impact |
|---|---|---|---|
| **LC-1** | 🔴 **A silent FIFO cap will delete the only complete intraday session** | 🔴 **CONFIRMED (§0) — ~37 sessions away** | 🔴 **CRITICAL, IRREVERSIBLE, AND IT HAS A DEADLINE** |
| **LC-2** | 🔴 **An unauthenticated HTTP route deletes the real config, which has no backup** | 🔴 **CONFIRMED (§1)** | 🔴 **CRITICAL. The ₹7L allocation and all engine state, unrecoverable** |
| **LC-3** | 🔴 **The runbook RECOMMENDS deleting that unbacked file** | 🔴 **CONFIRMED — `OPS-PLAYBOOK §6`** | 🔴 **CRITICAL** |
| **LC-4** | 🔴 **Point-in-time recovery = one write** | 🔴 **CONFIRMED (§2)** | 🔴 **HIGH. The AI model's backup is 24 h stale** |
| **LC-5** | 🔴 **9 critical datasets have NO backup** | 🔴 **CONFIRMED** *(025 §0.3)* | 🔴 **CRITICAL** |
| **LC-6** | 🔴 **An orphaned backup — the live file vanished** | 🔴 **CONFIRMED** *(025 §0.2)* | 🔴 **HIGH** |
| **LC-7** | 🔴 **Results overwritten in place — evidence destroyed** | 🔴 **CONFIRMED** *(015 §0.B)* | 🔴 **CRITICAL** |
| **LC-8** | 🔴 **No DR procedure. `INC-001` produced zero records** | 🔴 **CONFIRMED** *(029)* | 🔴 **CRITICAL** |
| **LC-9** | 🔴 **Deletions are silent — inside empty catches** | 🔴 **CONFIRMED** | HIGH |
| 🟢 **LC-10** | **Backup integrity** | 🟢 **VERIFIED — 7/7 parse, 0 corrupt** *(025 §0.1)* | 🟢 |

---

# PART 9 & 10 — LIFECYCLE ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   RetentionRegistry  ★★★   THE PRIMITIVE §0 PROVES IS MISSING.
     Every dataset DECLARES its retention: keep(N) | keep(days) | KEEP_FOREVER.
     🔴 `data/opt-candles/` MUST BE KEEP_FOREVER. It is IRREPRODUCIBLE.
        A FIFO cap of 40 on an irreproducible dataset is a scheduled data loss.  → LC-1
     🔴 A DELETION IS AN EVENT, NEVER A SILENT unlinkSync INSIDE A catch(_){}.   → LC-9

   BackupManager  ★
     🔴 SCHEDULED, not write-triggered. equity-*.json has no .bak because it has not
        been WRITTEN since 09 Jul — the backup policy depends on trading activity.  → LC-5
     🔴 N VERSIONS, not one. Today the window is ONE WRITE. (§2)                     → LC-4

   ArchiveLayer  ★
     🔴 IRREPRODUCIBLE DATA IS ARCHIVED, NEVER DELETED.
        opt-candles · opthl · paper ledgers · results — MOVE them, do not unlink them.

   RecoveryManager  ★
     🔴 CONFIGURATION MUST BE RECOVERABLE. Today one unauthenticated POST destroys it
        with no backup, and the runbook recommends doing so.                       → LC-2, LC-3
     🔴 000-E: "Backups are not valid until restore has been TESTED." Test it on a schedule.

   THE ONE RULE:
     🔴 A DATASET THAT CANNOT BE RE-DERIVED MAY NEVER BE DELETED BY A CAP.
        The bhavcopy can be re-downloaded — cap it freely.
        The intraday chain CANNOT — and it is the one under a cap.
```

## The rule §0 establishes

> **A retention policy written by someone managing disk space, applied to a directory that later came to
> hold something irreplaceable, is a bomb with a calendar.**
>
> **`data/opt-candles/` has a FIFO cap of 40 and holds the only complete intraday session this platform
> has ever produced.**

---

# PART 11 — TESTING STRATEGY

**Recovery correctness has priority over backup speed.**

| Test | Priority | Would it fail today? |
|---|---|---|
| 🔴 **An irreproducible dataset is NEVER deleted by a cap** | **P0 — §0. THE MOST URGENT TEST IN 41 DOCUMENTS** | ✅ **FAILS — ~37 sessions to impact** |
| 🔴 **`config-overrides.json` cannot be deleted without a backup and an admin role** | **P0 — §1** | ✅ **FAILS — unauthenticated, unbacked** |
| 🔴 **Every critical dataset has a scheduled, verified backup** | **P0 — LC-5** | ✅ **FAILS — 0 of 9** |
| 🔴 **Every deletion emits a persisted event** | **P0 — LC-9** | ✅ **FAILS — inside `catch (_) {}`** |
| 🔴 **Restore is EXERCISED on a schedule** | **P0 — 000-E** | ✅ **FAILS — 025 §0 was the first ever** |
| 🔴 **Every declared dataset exists; every backup has a live file** | **P0 — LC-6** | ✅ **FAILS — 1 orphan** |
| 🟢 **Every `.bak` parses** | P1 | 🟢 **PASSES (025 §0.1). Lock it in** |

**Six P0 tests. All six fail. One has a deadline.**

---

# PART 12 — LIFECYCLE MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Ad-hoc Storage** | 🟢 | Files accumulate; two silent caps delete |
| **1 — Basic Backups** | 🟡 **PARTIAL** | 🟢 **`safe-write` is excellent, and its 7 backups all verify** · 🔴 **14% coverage. 0 of 9 critical files** |
| **2 — Managed Retention** | 🔴 **NO** | **Two undeclared FIFO caps, one of which is a scheduled destruction of irreproducible evidence** |
| **3 — Governed Lifecycle** | 🔴 **NO** | **No archive. No retention registry. Deletions are silent** |
| **4 — Enterprise Recovery** | 🔴 **NO** | **Point-in-time window = ONE WRITE. No DR procedure** |
| **5 — Institutional Preservation** | 🔴 **NO** | — |

## ## **Data Lifecycle Platform: LEVEL 0–1 — AD-HOC / basic backups.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **0 — 🔴 URGENT** | 🔴 **RAISE THE `opt-candles` CAP, OR ARCHIVE `2026-07-08.json` OUT OF THE FIFO DIRECTORY. TODAY.** | **none — it is a copy** | **ZERO** | 🔴 **The only complete intraday session is out of the blast radius** |
| **1 — Inventory** | ✅ **DONE.** **§0 found the time bomb. §1 found the delete route. §2 measured the window** | — | none | 14 categories · 2 retention policies · both DELETE |
| **2 — Retention governance** | 🔴 **A `RetentionRegistry`: every dataset DECLARES `keep(N)` or `KEEP_FOREVER`.** 🔴 **A deletion emits a persisted event** | Phase 1 | **Low** | **No silent delete anywhere** |
| **3 — Backup verification** | 🔴 **SCHEDULED backups for the 9 critical datasets.** 🔴 **N versions, not one.** 🟢 **Lock in the `.bak` parse check** | Phase 2 | Low | **Point-in-time window > 1 write** |
| **4 — Recovery governance** | 🔴 **`config-overrides.json` becomes admin-only and backed-up** *(023, §1)*. 🔴 **Persist the halt** *(005)*. **A written, TESTED DR procedure** | 🔒 **`server.js` PROTECTED** | Medium | **`INC-001` becomes recoverable** |
| **5 — Preservation** | 🔴 **Archive, never delete, anything irreproducible.** Off-machine copies | Phase 4 | Low | **Nothing irreplaceable is ever one `unlinkSync` from gone** |

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| **Every dataset has a retention policy** | 🔴 **NO — 2 of 14, and both are silent DELETES** |
| **Backups are verified, not assumed** | 🟢 **YES — as of 025 §0. 7/7 parse.** 🔴 **But 14% coverage, 0 of 9 critical** |
| **Recovery procedures are reproducible** | 🔴 **NO — none is written, none has been exercised** |
| **Archives preserve scientific evidence** | 🔴 **NO — §0: a FIFO cap is scheduled to DESTROY it** |
| **DR assumptions are documented** | 🟢 **YES — Part 5, for the first time. And two of the three are false** |
| **Historical research can be reproduced** | 🔴 **NO — 0 of 13 results name their data** |
| **Unknown lifecycle behaviour is never treated as compliant** | 🔴 **NO — two undeclared FIFO caps were treated as compliant until this audit read line 578** |

## **1 of 7.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent governance engineer determine how every dataset is created, retained,
backed up, archived, restored and retired — while verifying that scientific evidence stays reproducible?**

## **Yes — and the answer is that the platform is thirty-seven trading days away from silently destroying the most valuable irreplaceable dataset it has ever produced.**

> ## 🔴 **`server.js:578` enforces a FIFO cap of 40 on `data/opt-candles/`. The oldest file is deleted, silently, inside an empty `catch`.**
>
> **`data/opt-candles/2026-07-08.json` is in that directory. It holds a full option chain — 669 series —
> at one-minute granularity, covering 99% of a real NSE session, from 09:15 to 15:29 IST.**
>
> **It is the ONLY complete intraday session this platform has ever captured. The other four are 8%, 15%,
> 19% and 30%. It cannot be re-derived — not from the EOD bhavcopy, not from any broker, not ever.**
>
> **There are five files in that directory today. The cap is forty.**
>
> ## **In roughly thirty-seven more trading sessions, `files.shift()` will delete it. Nothing warns. It has no backup. And the deletion is wrapped in a `catch (_) {}` so it cannot even fail loudly.**
>
> **The cap was almost certainly written by someone managing disk space, in a directory that at the time
> held nothing irreplaceable. It is a bomb with a calendar.**

**And a second deletion path, unauthenticated:**

> **`POST /api/strategy-config/reset` calls `fs.unlinkSync(CONFIG_OVERRIDE_PATH)`.**
>
> **`config-overrides.json` is THE REAL CONFIGURATION *(004 §0)*: the 5% daily-loss brake that overrules
> `.env`'s 2%, the ₹7 lakh strangle allocation, the account capital, and the enabled/disabled state of
> all eight engines.**
>
> **The route is unauthenticated — 0 of 172 routes carry auth, and `AUTH_ENABLED` defaults to false. The
> file has NO backup — it is one of the nine critical datasets with no `.bak`. And the operations
> playbook explicitly recommends deleting it: *"a bad `config-overrides.json` … can be deleted."***
>
> ## **The runbook tells the operator to destroy an unbacked file that holds the entire engine state, and an unauthenticated HTTP call does it in one line.**

**And the recovery window, measured for the first time:**

> ```
>   POINT-IN-TIME RECOVERY = EXACTLY ONE WRITE BACK.
>
>   confluence-weights.json.bak   →  24.0 hours stale   (the LIVE AI MODEL)
>   signal-outcomes.json.bak      →  23.4 hours stale
>   confirmed-signals.json.bak    →  the live file is GONE (orphan)
> ```
>
> **`safe-write` overwrites the `.bak` on every write. There is no version two. There is no archive.
> Restoring the AI model means discarding a full day of learning — and that is the *best* case.**

**The one action in this document that has a deadline, and it costs nothing:**

> ## **COPY `data/opt-candles/2026-07-08.json` OUT OF THE FIFO DIRECTORY. TODAY.**
>
> **Or raise the cap. Or exempt it. Any of the three. But do one of them before thirty-seven trading
> sessions pass, because after that the platform's only complete intraday option-chain session — the
> single most valuable irreproducible artefact it has ever produced — will be gone, silently, and no
> backup exists.**
>
> **039's own rule: *"Never assume recoverability because backup files exist."***
> **It has no backup file to be wrong about.**

---

**Storage redesigned: NONE. Backup systems implemented: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Lifecycle Inventory (Part 1) · Lifecycle Stages (Part 2) · **Retention Governance
(§0, Part 3)** · Backup Governance (Part 4) · **Recovery Assessment (§2, Part 5)** · Archival Governance
(Part 6) · Observability (Part 7) · Failure Modes (Part 8) · Lifecycle Architecture (Parts 9–10) ·
Testing Strategy (Part 11) · Maturity Assessment (Part 12) · Migration Roadmap (Part 13) · Executive
Summary.
