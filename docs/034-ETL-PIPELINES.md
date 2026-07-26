# 034 — ETL, DATA INGESTION, STREAMING & PIPELINE GOVERNANCE

**Standard:** Master Prompt 034 · **Depends on:** 000-A … 033
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No ETL job redesigned. No technology migrated.**

---

# SECTION 0 — 034's OWN STOP CONDITION, PROVEN

**034: *"Never assume a successful pipeline run guarantees complete or correct data delivery."***

## **Measured. Five pipeline runs. Four of them silently delivered a fraction of a session.**

```
  data/opt-candles/          (a full NSE session = 09:15–15:30 = 375 one-minute bars)

  2026-07-06.json    series keys: 665    max bars:   70 / 375    ( 19%)
  2026-07-07.json    series keys: 506    max bars:   56 / 375    ( 15%)
  2026-07-08.json    series keys: 669    max bars:  375 / 375    (100%)   ◀── the ONE complete session
  2026-07-09.json    series keys: 712    max bars:  114 / 375    ( 30%)
  2026-07-10.json    series keys: 521    max bars:   29 / 375    (  8%)
```

## §0.1 — **The 8% file is indistinguishable from the 100% file**

**Every one of those five runs "succeeded." Every one wrote a well-formed JSON artefact with a `date`,
a `savedAt` and a `series`. Nothing in any of them records how many bars were EXPECTED versus how many
were DELIVERED.**

> **`2026-07-10.json` captured twenty-nine minutes of a three-hundred-and-seventy-five-minute session —
> eight percent — and its artefact looks exactly like the complete one.**
>
> ## **A pipeline that cannot tell you it delivered 8% of the data is not a pipeline. It is a file
> ## writer that occasionally succeeds.**

## §0.2 — **And the cause is `INC-001`**

```js
server.js:566   function _persistOptCandles() { ... }
server.js:581   setInterval(_persistOptCandles, 60 * 1000);
```

**The pipeline accumulates bars in memory and flushes every 60 seconds. The file therefore contains
exactly as many bars as the process was ALIVE to collect.**

> ## **29 bars on 2026-07-10 means the bot ran for 29 minutes that day.**
>
> **This is the same root cause as `INC-001` *(029 §0)*: the bot is started with `node server.js`, bare,
> with no supervisor — while `ecosystem.config.js` (PM2) and `docker-compose.yml` both sit in the
> repository, correctly configured to auto-restart, and both unused.**

## §0.3 — **The chain, complete**

```
  No supervisor (029 §0)
      ↓
  The bot runs intermittently, and dies unnoticed (021 §0, INC-001)
      ↓
  The intraday capture pipeline delivers 8–30% of a session, four times out of five
      ↓
  🔴 AND THIS IS THE ONE DATA STREAM THAT CANNOT BE RE-DERIVED.
     Intraday option chains do not exist anywhere else. They cannot be back-filled.
      ↓
  🔴 NOTHING RECORDS THAT THE DELIVERY WAS INCOMPLETE.
```

> **The only irreversible evidence this platform generates is being destroyed by the absence of a
> supervisor that is already written, already correct, and switched off.**

---

# SECTION 1 — 🔴 THE ONLY STREAMING PIPELINE IS DISABLED

```
  dhan-ws-feed.js                                242 LOC
    EventEmitter                                   2   ◀── THE ONLY ONE IN THE ENTIRE PLATFORM
    clearInterval                                  2   ◀── THE ONLY MODULE THAT CLEANS UP ITS TIMERS
    reconnect / retry logic                       12   ◀── genuinely present
    message ordering                               0
    loss detection                                 0
    backpressure                                   1

  .env:  DHAN_WS_ENABLED=false                       ◀── 🔴 IT IS TURNED OFF.
```

> ## **The platform's only streaming pipeline, its only `EventEmitter`, and the only module in the entire codebase that clears its own timers — is disabled by a flag in `.env`.**
>
> **This is the ELEVENTH instance in this audit programme of a correct component that is BUILT and NOT
> USED** — after `engine-verdict.js`, `module-contract.js`, `bt-validate.js`, `position-sizer.js`,
> `auth.js`, the append-only `.jsonl` writer, `scripts/perf-report.js`, PM2, Docker Compose, and the
> ops playbook's own golden rule.

**Consequence:** all six market-data connectors **poll**. There is no streaming path in production, no
event bus, and 13 of the platform's 14 timers can never be stopped — **because the one module that knows
how is switched off.**

---

# SECTION 2 — CORRECTIONS TO MY OWN PRIOR AUDITS (Rule Zero)

| My claim | Reality |
|---|---|
| *"The option High/Low archive is in `data/opt-hl/`"* — stated in audits **006, 025 and 031** | 🔴 **WRONG. `server.js:518` writes to `data/opthl`** (no hyphen). `data/opt-hl` **does not exist**. The real directory holds **12 daily files** |
| *"Only 1 intraday session exists"* | 🟡 **IMPRECISE. FIVE sessions were captured. ONE is complete (2026-07-08, 375/375). The other four are 8–30%** — which is the far more important fact, and §0 is the finding |
| My first parse of `opt-candles` reported **"0 bars"** | 🔴 **WRONG — I guessed the schema.** The real shape is `{date, savedAt, series}`. **I caught it before publishing, by reading the file** |

> **Three corrections, all self-inflicted, all caught by reading the data instead of trusting a grep.
> This is the tenth time in this programme.**

---

# PART 1 — PIPELINE INVENTORY

| # | Pipeline | Trigger | Owner | Frequency | Delivery verified? | Confidence |
|---|---|---|---|---|---|---|
| 1 | **Bhavcopy ingestion** (`bt-bhav-fetch.js`) | 🔴 **MANUAL** | — | ad-hoc | 🟢 **VERIFIED (031, 033)** — 🔴 **27 gaps unexplainable** | HIGH |
| 2 | **Option chain (poll)** | request | 6 connectors | 5 s–3 min cache | 🔴 **NO — `\|\| 0` × 119** | MEDIUM |
| 3 | 🔴 **Live WebSocket** (`dhan-ws-feed.js`) | — | itself | — | 🔴 **DISABLED (§1)** | HIGH |
| 4 | **Historical import** (`bt-fetch-1min.js`) | manual | — | ad-hoc | 🔴 no validation | MEDIUM |
| 5 | 🔴 **Intraday capture** (`_persistOptCandles`) | `setInterval` 60 s | `server.js` | 1/min | 🔴 **§0 — 4 of 5 runs delivered 8–30%** | **HIGH** |
| 6 | **Option H/L archive** (`_persistOptHLDay`) | `setInterval` | `server.js` | daily | 🔴 **RAW write, no `.bak`.** 12 files in `data/opthl` | HIGH |
| 7 | **Paper-trading events** | per trade | per-engine | on close | 🔴 **6 incompatible ledgers; open positions LOST** *(010)* | HIGH |
| 8 | 🔴 **AI feature generation** | per inference | — | per tick | 🔴 **FEATURES ARE DISCARDED** *(018)* | HIGH |
| 9 | **Reporting** | request | `server.js` | on demand | 🟡 | MEDIUM |
| 10 | **Export jobs** (`export-backtest-excel.js`) | manual | — | — | ⚪ **DEAD — Ca = 0** | HIGH |
| 11 | **Scheduled tasks** | **14 bare `setInterval`s** | 🔴 **NOBODY** | various | 🔴 **0 registered, 0 clearable, a dead timer is invisible** | HIGH |

## **Eleven pipelines. One has verified delivery. One is disabled. One discards its output entirely.**

---

# PART 2 — PIPELINE LIFECYCLE

```
  Extract ──▶ Validate ──▶ Normalize ──▶ Transform ──▶ Enrich ──▶ Persist ──▶ Distribute ──▶ Archive ──▶ Monitor
     ↓           ↓            ↓             ↓            ↓           ↓            ↓             ↓          ↓
     │           │            │             │            │           │            │             │          └── 🔴 §0
     │           │            │             │            │           │            │             └── 🔴 no retention
     │           │            │             │            │           │            └── 🔴 no port, 6 shapes
     │           │            │             │            │           └── 🟡 safe-write where used;
     │           │            │             │            │               🔴 RAW for opthl, eod, ami
     │           │            │             │            └── 🔴 features enriched then DISCARDED
     │           │            │             └── 🔴 lot & volume NEVER MAPPED (033 §0.5)
     │           │            └── 🔴 `|| 0` × 119
     │           └── 🔴 ONE rule in the whole platform: `o > 0` (bt-lib:40)
     └── 🟡 manual / polled / one disabled stream.

  Monitor ──▶ 🔴🔴 §0: FOUR OF FIVE RUNS DELIVERED A FRACTION, AND EVERY ONE REPORTED SUCCESS.
```

## **Six of nine stages do not exist.**

---

# PART 3 — INGESTION GOVERNANCE

| Capability | Verdict |
|---|---|
| **Source connectivity** | 🟡 6 connectors · 🔴 **`live-connector.js` (460 LOC, the primary path) has NO timeout** |
| **Retry behaviour** | 🟢 Dhan (429 backoff) · 🟢 `dhan-ws-feed` (12 reconnect refs) — **and it is disabled** · 🔴 Upstox: none |
| **Duplicate detection** | 🟢 **Not needed for bhavcopy (0 duplicates verified)** · 🔴 **No event ID anywhere else** |
| **Ordering guarantees** | 🔴 **NONE. `dhan-ws-feed`: 0 sequence/ordering refs** |
| **Missing-data detection** | 🔴 **NONE. §0 is the proof: 8% delivery reported as success** |
| **Schema validation** | 🔴 **NONE. 34 columns assumed, never asserted** |
| **Pipeline restart behaviour** | 🔴 **CATASTROPHIC. §0.2: the intraday pipeline's output IS a function of process uptime, and the process has no supervisor** |

## ## **034's stop condition: *"Unknown pipeline behaviour remains UNKNOWN."* → Delivery completeness: UNKNOWN for 10 of 11 pipelines.**

---

# PART 4 — TRANSFORMATION GOVERNANCE

| Category | Verdict |
|---|---|
| **Deterministic transformations** | 🟢 **YES — `bt-lib.loadDay()` and every `bt-*` script. No randomness, no clock** |
| **Derived fields** | 🔴 **`|| 0` × 119. An unknown becomes a number** |
| **Feature generation** | 🔴 **Computed, used, DISCARDED.** No lineage is even possible *(018)* |
| 🔴 **Time alignment** | 🔴 **`days[i-1]` is the previous FILE, not the previous TRADING DAY** *(031 §0.3)* |
| 🔴 **Unit conversions** | 🔴 **`oiUnit` has been UNKNOWN since audit 006.** If the broker chain reports units, **every GEX is wrong by 65×** |
| **Schema evolution** | 🟢 **STABLE — 34 columns across 600 files** *(031)* |
| 🔴 **Data lineage** | 🔴 **NONE. No result cites the data it used. 0 of 13 scripts record a `gitSha`** |

## 🔴 The transformation that is provably wrong

> **`bt-lib.js:36` reads the lot from `rows[0][28]` — an arbitrary row — instead of the traded
> contract's own row. Wrong on 27 of 600 days. It is in the ONE fix this programme applied**
> *(032 §0)*.

---

# PART 5 — STREAMING GOVERNANCE

| Capability | Verdict |
|---|---|
| **Live feeds** | 🔴 **THE ONLY STREAM IS DISABLED (`DHAN_WS_ENABLED=false`)** |
| **Streaming reliability** | 🟢 **12 reconnect refs — genuinely built** · 🔴 **and switched off** |
| **Backpressure** | 🔴 **1 reference. Effectively none** |
| **Event ordering** | 🔴 **ZERO. No sequence numbers, no monotonic clock** |
| **Message-loss detection** | 🔴 **ZERO** |
| **Replay capability** | 🔴 **NONE — no event store** *(022)* |
| **Stream health** | 🔴 **NONE** |

## ## **Streaming maturity: LEVEL 0. The one stream that exists is off, and if it were on, nothing would detect a dropped message.**

---

# PART 6 — PIPELINE OBSERVABILITY

| Required per pipeline run | Recorded? |
|---|---|
| Start time | 🔴 **NO** |
| End time | 🟡 **`savedAt` in `opt-candles`** |
| Duration | 🔴 **NO** |
| **Input volume** | 🔴 **NO** |
| **Output volume** | 🟡 **Derivable from the artefact — but no run states its EXPECTED volume (§0.1)** |
| Validation failures | 🔴 **NO — there is no validation** |
| Retry count | 🟢 **Broker calls only** *(`server.js:6280`)* |
| **Success / Failure status** | 🔴 **NO — §0: an 8% delivery is indistinguishable from a 100% one** |

## **1 of 8. *"Pipelines without observability are incomplete."***

---

# PART 7 — DELIVERY GUARANTEES

| Pipeline | Guarantee |
|---|---|
| **Bhavcopy** | 🟡 **AT-MOST-ONCE.** A failed download is silent *(031)* |
| **Intraday capture** | 🔴 **BEST-EFFORT, AND IT IS NOT DELIVERING.** §0: 8–30% on four of five runs |
| **Option chain (poll)** | 🔴 **BEST-EFFORT.** Stale data is indistinguishable from fresh |
| **WebSocket** | ⚪ **UNKNOWN — disabled. If enabled: no ordering, no loss detection ⇒ AT-MOST-ONCE at best** |
| **Paper trades** | 🔴 **AT-MOST-ONCE. Open positions are LOST on restart** *(010 §0)* |
| **AI features** | 🔴 **ZERO-ONCE. They are generated and destroyed** *(018)* |

## ## **Exactly-once: NOWHERE. At-least-once: NOWHERE. Every pipeline in this platform is best-effort, and none of them measures its own effort.**

---

# PART 8 — FAILURE MODE REGISTER

| ID | Failure | Present? | Impact |
|---|---|---|---|
| **PL-1** | 🔴 **A successful run delivers 8% of the data and reports success** | 🔴 **CONFIRMED — §0. 4 of 5 runs** | 🔴 **CRITICAL. Destroys the ONLY irreversible evidence stream** |
| **PL-2** | 🔴 **Pipeline output is a function of process uptime, and there is no supervisor** | 🔴 **CONFIRMED — §0.2** | 🔴 **CRITICAL** |
| **PL-3** | 🔴 **The only streaming pipeline is disabled** | 🔴 **CONFIRMED — §1** | 🔴 **HIGH. And with it, the only `EventEmitter` and the only `clearInterval`** |
| **PL-4** | 🔴 **No ordering, no loss detection** | 🔴 **CONFIRMED** | HIGH |
| **PL-5** | 🔴 **Transformation is wrong (the lot)** | 🔴 **CONFIRMED — 27 of 600 days** *(032 §0)* | 🔴 **CRITICAL** |
| **PL-6** | 🔴 **No lineage — no result cites its data** | 🔴 **CONFIRMED** | 🔴 **CRITICAL** |
| **PL-7** | 🔴 **Partial loads are invisible** | 🔴 **CONFIRMED — §0** | 🔴 **CRITICAL** |
| **PL-8** | 🔴 **14 timers, unregistered, unclearable** | 🔴 **CONFIRMED** | HIGH — a dead pipeline is invisible |
| 🟢 **PL-9** | **Schema drift · duplicate loads · corruption** | 🟢 **NOT PRESENT** *(031, 033)* | 🟢 |
| 🟢 **PL-10** | **Transformation determinism** | 🟢 **VERIFIED — same inputs, same trades** | 🟢 |

---

# PART 9 & 10 — PIPELINE ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   PipelineRun  ★★★   THE MISSING PRIMITIVE. §0 IS THE PROOF.
     Every run RECORDS: runId · start · end · EXPECTED volume · ACTUAL volume ·
                        validationFailures · retries · status.
     🔴 A RUN THAT DELIVERS 8% OF ITS EXPECTED VOLUME IS A FAILURE, NOT A FILE.
        Today it is indistinguishable from a 100% run.                     → kills PL-1, PL-7

   PipelineScheduler  ★   Registers all 14 timers. A MISSED TICK IS AN ALERT.
                          🔴 Today a dead pipeline is invisible.            → kills PL-8

   StreamingManager   🟢 dhan-ws-feed.js ALREADY HAS: reconnect, EventEmitter, clearInterval.
                      🔴 IT IS DISABLED. And it has no ordering or loss detection.
                         Enable it, add sequence numbers, and the platform gains its first
                         event bus — for free.                             → §1

   TransformationRegistry  ★
     🔴 EVERY transformation is a NAMED, TESTED, VERSIONED function with a LINEAGE record.
        lot(contract) · volume(contract) · oiUnit · alignment(t-1).
        Today the lot transformation is wrong and nobody could have found it in a registry
        that does not exist.                                                → kills PL-5, PL-6

   DeliveryManager  ★   AT-LEAST-ONCE for evidence. Idempotency keys.
                        🔴 Today: best-effort everywhere, measured nowhere.
```

## The rule §0 establishes

> **A pipeline that does not know what it expected cannot know that it failed.**
> **Four runs out of five delivered a fraction of a session, wrote a well-formed file, and reported
> success. The data they lost cannot be recovered.**

---

# PART 11 — TESTING STRATEGY

**Pipeline correctness has priority over throughput.**

| Test | Priority | Would it fail today? |
|---|---|---|
| 🔴 **Every run records EXPECTED vs ACTUAL volume, and a shortfall is a FAILURE** | **P0 — §0** | ✅ **FAILS — 4 of 5 runs reported success at 8–30%** |
| 🔴 **The intraday pipeline captures 375 bars, or raises an incident** | **P0 — §0** | ✅ **FAILS** |
| 🔴 **The bot runs under a supervisor** *(the root cause of §0)* | **P0 — 029 §0** | ✅ **FAILS** |
| 🔴 **The lot and volume come from the CONTRACT'S row** | **P0 — 032, 033** | ✅ **FAILS — neither is mapped** |
| 🔴 **A dead timer is detected within one interval** | **P0 — PL-8** | ✅ **FAILS — 14 unregistered** |
| **Stream ordering: a gap in the sequence is detected** | P1 — PL-4 | ✅ **FAILS — 0 sequence refs** |
| 🟢 **Transformations are deterministic** | P1 | 🟢 **PASSES. Lock it in** |
| 🟢 **No duplicate loads, no schema drift** | P1 | 🟢 **PASSES. Lock it in** |

**Five P0 tests fail.**

---

# PART 12 — PIPELINE MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Manual Processing** | 🟢 | Bhavcopy is fetched by hand |
| **1 — Automated ETL** | 🟡 **PARTIAL** | 🟢 14 `setInterval` pipelines run automatically · 🔴 **none registered, none clearable, none measured** |
| **2 — Managed Pipelines** | 🔴 **NO** | **§0: 4 of 5 runs delivered a fraction and reported success** |
| **3 — Observable Data Flows** | 🔴 **NO** | **1 of 8 observability fields** |
| **4 — Governed Streaming** | 🔴 **NO** | **The only stream is DISABLED. Zero ordering. Zero loss detection** |
| **5 — Enterprise Pipeline Platform** | 🔴 **NO** | — |

## ## **Data Pipeline Platform: LEVEL 0–1 — MANUAL / partially automated.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE.** **§0 proved 034's own stop condition on live data** | — | none | 11 pipelines · 1 with verified delivery · 1 disabled |
| **2 — Ingestion governance** | 🔴 **A `PipelineRun` record: expected vs actual volume.** 🔴 **RUN THE BOT UNDER A SUPERVISOR — it is the root cause of §0** | 🔒 **B-3 + S-01 approval** *(else a restart resumes trading at 15/8)* | **Low** | 🔴 **A partial capture becomes an INCIDENT, not a file** |
| **3 — Transformation governance** | 🔴 **Map columns 24 and 28** *(033)*. 🔴 **A trading calendar** *(031)*. **A transformation registry with lineage** | Phase 2 | 🔴 **Every backtest result moves. CORRECT** | **The lot transformation is right. `days[i-1]` is provable** |
| **4 — Streaming governance** | 🔴 **ENABLE `DHAN_WS_ENABLED`.** Add sequence numbers + gap detection. **The platform gains its first event bus for free** | Phase 3 | Medium | **Ordering guaranteed. Message loss detected** |
| **5 — Enterprise** | Delivery guarantees per pipeline. Replay. Pipeline audit registry | Phase 4 | Medium | **Every data flow traceable from source to consumer** |

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every pipeline has one owner | 🔴 **NO — the scheduler has no owner; 14 timers are unregistered** |
| **Transformations are deterministic** | 🟢 **YES** — 🔴 **but one of them is deterministically WRONG** *(032 §0)* |
| Streaming behaviour is observable | 🔴 **NO — the only stream is disabled** |
| **Delivery guarantees are documented** | 🟢 **YES — as of Part 7. And every one is "best-effort"** |
| **Failures are recoverable** | 🔴 **NO — §0: the lost intraday data CANNOT be re-derived** |
| Replay capability is understood | 🔴 **NO — no event store** |
| **Unknown pipeline behaviour is never assumed safe** | 🔴 **NO — 4 of 5 runs were assumed successful, and were 8–30%** |

## **2 of 7.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent data platform engineer reproduce every ETL process, verify each
transformation, trace every data flow, confirm delivery guarantees, and diagnose pipeline failures?**

## **Diagnose failures: yes — and the first one I diagnosed proves 034's own stop condition on live data.**

> **034 warns: *"Never assume a successful pipeline run guarantees complete or correct data delivery."***
>
> **Five intraday capture runs sit in `data/opt-candles/`. Every one of them "succeeded." Every one
> wrote a well-formed JSON artefact.**
>
> ```
>   2026-07-06    70 / 375 bars   ( 19%)
>   2026-07-07    56 / 375 bars   ( 15%)
>   2026-07-08   375 / 375 bars   (100%)   ← the only complete session this platform has ever captured
>   2026-07-09   114 / 375 bars   ( 30%)
>   2026-07-10    29 / 375 bars   (  8%)
> ```
>
> **The 8% file is indistinguishable from the 100% file. No run records how many bars it expected.
> No run records that it failed. And this is the ONE data stream that cannot be re-derived — intraday
> option chains exist nowhere else and can never be back-filled.**

**And the cause is not a bug in the pipeline. The pipeline is a `setInterval` that flushes every sixty
seconds — so the file contains exactly as many bars as the process was alive to collect.**

> **Twenty-nine bars on 2026-07-10 means the bot ran for twenty-nine minutes that day.**
>
> ## **The chain is complete: no supervisor (029 §0) → the bot dies unnoticed (`INC-001`) → the intraday pipeline delivers 8–30% → and the only irreversible evidence this platform generates is destroyed, silently, four days out of five.**
>
> **`ecosystem.config.js` and `docker-compose.yml` are both in the repository, both correctly configured
> to auto-restart, and both unused.**

**And the streaming pipeline — the eleventh correct-but-unused component of this audit programme:**

> **`dhan-ws-feed.js` contains the platform's ONLY `EventEmitter`, the ONLY `clearInterval` in the
> entire codebase, and twelve references to reconnection logic.**
>
> **`.env` says `DHAN_WS_ENABLED=false`.**
>
> **The one module that knows how to clean up after itself is switched off — which is why the other
> thirteen timers can never be stopped.**

**Three corrections to my own prior audits are recorded in §2** — including that the option High/Low
archive lives in `data/opthl`, not `data/opt-hl` as I wrote in audits 006, 025 and 031, and that my
first parse of `opt-candles` reported "0 bars" because I guessed the schema. **All three were caught by
reading the data instead of trusting a grep. That is the tenth time in this programme.**

**The single highest-value change, and it requires no new architecture:**

> ## **RECORD, ON EVERY PIPELINE RUN, WHAT IT EXPECTED AND WHAT IT DELIVERED.**
>
> **A run that captures 29 of 375 bars is a failure. Today it is a file.**
>
> **And then run the bot under the supervisor that is already written — because the pipeline's output is
> a function of the process's uptime, and nothing is keeping it alive.**

---

**ETL jobs redesigned: NONE. Technologies migrated: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Pipeline Inventory (Part 1) · ETL Lifecycle (Part 2) · Ingestion Governance (Part 3) ·
Transformation Review (Part 4) · Streaming Assessment (§1, Part 5) · Observability (Part 6) · **Delivery
Guarantees (§0, Part 7)** · Failure Modes (Part 8) · Pipeline Architecture (Parts 9–10) · Testing
Strategy (Part 11) · Maturity Assessment (Part 12) · Migration Roadmap (Part 13) · Executive Summary.
