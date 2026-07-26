# 022 — AUDIT TRAIL, EVENT SOURCING & IMMUTABLE SYSTEM HISTORY

**Standard:** Master Prompt 022 · **Depends on:** 000-A … 021
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No storage redesigned. No logging modified.**

---

# SECTION 0 — THE TEST: RECONSTRUCT THE OUTAGE THAT JUST HAPPENED

**022's rule: *"Never assume auditability from the presence of log files."***
**022's success criterion: *"An independent auditor should be able to reconstruct any significant system
event… using only the documented event history."***

**A significant system event occurred one hour ago: the bot died silently, during audit 021.**

**So I tried to reconstruct it — using only the event history.**

| Question an auditor must answer | Answer |
|---|---|
| **Q1. WHEN did the process die?** | 🔴 **UNKNOWN.** `grep` for a persisted lifecycle event (`STARTUP` / `SHUTDOWN` / `CRASH` / `EXIT` / `HALT`) across **every** file in `data/` → **ZERO.** **Not one lifecycle event is persisted anywhere** |
| **Q2. WHY did it die?** | 🔴 **UNKNOWN.** `data/crash.log` was last written **2026-07-05** — eight days ago |
| **Q3. WAS a position open when it died?** | 🔴 **UNKNOWN AND UNKNOWABLE.** `strangle-trades.json` holds **closed trades only**. **No open-position file exists** for the strangle, gamma-blast or signal-paper engines *(010 §0)* |
| **Q4. WAS the engine halted when it died?** | 🔴 **UNKNOWN AND UNKNOWABLE.** `equity-nifty.json` keys: `capital, reserve, consecLosses, updatedAt`. **`haltedReason` is not among them** *(005 S-01)* |
| **Q5. What was the last decision it made?** | 🟡 **PARTIAL.** The most recent record anywhere in `data/` is in `pop-book.json`, timestamped **2026-07-13T06:53:46Z** |

## The measured timeline

```
  2026-07-13 06:53:46Z   last record written anywhere in data/   ← the bot was ALIVE
  2026-07-13 07:08:05Z   now                                     ← the bot is DEAD
  ─────────────────────────────────────────────────────────────
  ELAPSED: 14 minutes.
  RECORDS MARKING THE TRANSITION: ZERO.
```

> ## 🔴 **THE BOT WAS ALIVE FOURTEEN MINUTES AGO. IT IS DEAD NOW. NOT ONE RECORD MARKS THE TRANSITION.**
>
> **022's stop condition is triggered on four of five questions:**
> ***"Stop and report UNKNOWN if replay cannot reconstruct platform state."***
>
> ## **→ REPLAY: IMPOSSIBLE. AUDIT COMPLETENESS: UNVERIFIABLE.**

---

# SECTION 1 — 🔴 **THE PLATFORM KNOWS HOW TO DO THIS. IT APPLIES IT TO THE WRONG THINGS.**

**This is the sharpest finding of the audit. Append-only event logs are NOT missing from this
codebase — they exist, they are correctly implemented, and they are pointed at the least important
things in the system.**

## What HAS an append-only, immutable, event-sourced ledger 🟢

```
data/migrations/C1-strangle-pnl.jsonl          ← a P&L migration
data/migrations/C1b-lot-size.jsonl             ← a lot-size migration
data/migrations/C1c-config-consistency.jsonl   ← a config-consistency migration
data/news/news-YYYY-MM-DD.jsonl                ← archived news headlines
data/ami-signals-YYYY-MM-DD.jsonl              ← AmiBroker signals
```

```js
amibroker-bridge.js:141
  fs.appendFileSync(this.signalStoreFile(record.date), `${JSON.stringify(record)}\n`, 'utf8');
```

**Date-partitioned. Append-only. One JSON object per line. Never rewritten.**
**This is a correct, textbook event store — and it exists, today, in this repository.**

## What has NO event record at all 🔴

| | |
|---|---|
| **System startup** | 🔴 none |
| **System shutdown** | 🔴 none — **§0 Q1** |
| **Process crash** | 🔴 none — **§0 Q2** |
| **Trading halt** | 🔴 none — **§0 Q4.** *A halt is a `console.warn` that dies with the process* |
| **Emergency stop** | 🔴 none *(012 §0)* |
| **Capital mutation** | 🔴 none — **a single number, overwritten in place** *(014 Part 9)* |
| **Configuration change** | 🔴 none — **the daily-loss brake can be doubled over unauthenticated HTTP and the only trace is a terminal line** *(004 §5)* |
| **Risk decision** | 🔴 none — **the stage does not exist** *(013)* |
| **Order lifecycle** | 🔴 none — **no order object exists** *(012)* |
| **AI prediction** | 🔴 none — **the features are discarded on every inference** *(016, 018)* |
| **Promotion of a strategy to live** | 🔴 none — **a boolean flipped in a JSON file** *(015 Part 6)* |

> ## **The platform maintains an immutable, append-only, date-partitioned event ledger — for a lot-size migration it ran once, and for news headlines.**
>
> ## **It maintains none for: a halt, a crash, a capital change, an order, a risk decision, or a strategy being switched on.**
>
> **The capability is present. The instinct is present. It was simply never pointed at anything that
> could lose money.**

---

# PART 1 — EVENT INVENTORY

| Event | Emitted? | Persisted? | Owner | Confidence |
|---|---|---|---|---|
| **System startup** | 🟡 `console.log` | 🔴 **NO** | — | HIGH |
| **Shutdown** | 🟡 `console.log` | 🔴 **NO** | — | HIGH |
| **Configuration change** | 🟡 11 `[config]` log lines | 🔴 **NO** | — | HIGH |
| **Strategy decision** | 🟡 in-memory | 🔴 **NO — no `strategyId` exists** *(007)* | — | HIGH |
| **Risk decision** | 🔴 **NO** | 🔴 **NO** | 🔴 none | HIGH |
| **Capital update** | 🟡 `console.log` (`execution-engine:158`) | 🔴 **NO — overwritten in place** | — | HIGH |
| **Portfolio update** | 🔴 **N/A — no portfolio exists** | — | — | HIGH |
| **Order lifecycle** | 🔴 **N/A — no orders exist** | — | — | HIGH |
| **Paper trade (closed)** | 🟢 | 🟢 **6 incompatible ledgers** | per-engine | HIGH |
| **Paper trade (opened)** | 🔴 **NO** | 🔴 **NO — lost on restart in 3 of 4 engines** | — | HIGH |
| **AI prediction** | 🟡 `prob: 76` | 🔴 **inputs discarded** | — | HIGH |
| **Validation run** | 🟡 `result-*.json` | 🔴 **overwritten in place** *(015 §0.B)* | — | HIGH |
| **Research experiment** | 🔴 **no experiment ID exists** | 🔴 | — | HIGH |
| **User action** | 🔴 **NO** | 🔴 | — | HIGH |
| **API request** | 🔴 **NO** | 🔴 | — | HIGH |
| **Scheduler / timer** | 🔴 **NO — 14 timers, unregistered** | 🔴 | 🔴 **none** | HIGH |
| **Error** | 🟡 `console.log` — 🔴 **92 empty catches emit NOTHING** | 🔴 | — | HIGH |
| 🟢 **Migration** | 🟢 | 🟢 **`.jsonl`, append-only** | — | HIGH |
| 🟢 **AmiBroker signal** | 🟢 | 🟢 **`.jsonl`, append-only, date-partitioned** | `amibroker-bridge` | HIGH |
| 🟢 **News headline** | 🟢 | 🟢 **`.jsonl`, append-only** | `agents-engine` | HIGH |

## **17 event types. 3 are properly event-sourced. None of the 3 can lose money.**

---

# PART 2 — EVENT LIFECYCLE

```
  Created ──▶ Validated ──▶ Serialized ──▶ Persisted ──▶ Distributed ──▶ Consumed ──▶ Archived ──▶ Recovered
     ↓            ↓             ↓              ↓              ↓             ↓            ↓            ↓
     │            │             │              │              │             │            │            └── 🔴 §0
     │            │             │              │              │             │            └── 🟡 6 ledgers,
     │            │             │              │              │             │                6 schemas
     │            │             │              │              │             └── 🔴 nothing consumes
     │            │             │              │              └── 🔴 NO EVENT BUS.
     │            │             │              │                  EventEmitter: 1 module — and it is
     │            │             │              │                  `dhan-ws-feed.js`, a WEBSOCKET CLIENT.
     │            │             │              │                  There is NO internal event bus at all.
     │            │             │              └── 🔴 3 of 17 event types.
     │            │             └── 🟡 JSON, 6 incompatible schemas.
     │            └── 🔴 NO VALIDATION.
     └── 🟡 mostly a console.log.
```

## **Five of eight lifecycle stages do not exist.**

---

# PART 3 — AUDIT COVERAGE

| Subject | Classification |
|---|---|
| **Orders** | 🔴 **UNKNOWN — no orders exist** |
| **Trades (closed)** | 🟡 **PARTIAL** — 6 ledgers, **5 of 14 required fields missing everywhere** *(010 §3)* |
| **Trades (open)** | 🔴 **UNKNOWN — lost on restart in 3 of 4 engines** |
| **Capital mutations** | 🔴 **UNKNOWN — one number, overwritten. One `.bak` = one prior value** |
| **Risk decisions** | 🔴 **UNKNOWN — the stage does not exist** |
| **Strategy outputs** | 🔴 **PARTIAL — no `strategyId` anywhere** |
| **AI decisions** | 🔴 **UNKNOWN — the inputs were discarded** |
| **Configuration updates** | 🔴 **UNKNOWN — HTTP-mutable, no auth by default, no audit** |
| **Authentication events** | 🔴 **UNKNOWN — `AUTH_ENABLED` defaults to off** |
| **Errors** | 🔴 **PARTIAL — 92 empty catches emit nothing at all** |
| **Failures** | 🔴 **UNKNOWN — §0** |
| **Shutdown** | 🔴 **UNKNOWN — §0 Q1** |
| **Restart** | 🔴 **UNKNOWN — §0** |

## **Verified: 0. Implemented: 0. Partial: 3. Unknown: 10.**

---

# PART 4 — IMMUTABILITY

| Property | Reality |
|---|---|
| **Append-only** | 🟢 **3 event types** — migrations, AmiBroker signals, news |
| **Mutable** | 🔴 **`confluence-weights.json`, `equity-*.json`, `config-overrides.json`** — all **overwritten in place** |
| **Replaceable** | 🔴 **`result-validate.json` was silently OVERWRITTEN, destroying the evidence that the validator once certified an artefact at 95% confidence** *(015 §0.B)* |
| **Lost** | 🔴 **Open positions, halts, emergency stops, the entire outage of §0** |
| **Duplicated** | ⚪ **UNKNOWN — no event ID exists, so duplicates cannot be detected** |
| **Undocumented** | 🔴 **All of it** |

## 🔴 **Historical reconstruction: NOT POSSIBLE.**

**The single most important before/after this project ever produced — `DSR 0.9999 PASS` → `DSR 0.0008
FAIL` — survives only because I pasted it into a markdown file before re-running the script that
destroyed it.** *(015 §0.B.)* **The event history preserved nothing.**

---

# PART 5 — STATE RECONSTRUCTION

**Can the platform's state at any past moment be rebuilt from the event history?**

| Domain | Reconstructable? | Missing information |
|---|---|---|
| **Portfolio** | 🔴 **NO** | **No portfolio ever existed** *(011)* |
| **Capital** | 🔴 **NO** | **No per-trade capital impact is recorded.** The balance is a single overwritten number. **"Why is SENSEX at ₹88,011?" is unanswerable** *(014 Part 9)* |
| **Positions** | 🔴 **NO** | **Open positions are never persisted** by 3 of 4 engines |
| **Risk** | 🔴 **NO** | **`haltedReason` is not in any schema.** §0 Q4 |
| **Configuration** | 🔴 **NO** | Overwritten in place. **One `.bak`** |
| **Research** | 🔴 **NO** | **0 of 13 scripts record a git SHA** *(008 P9-A)* |
| **AI** | 🔴 **NO** | **The features were discarded on every inference** *(016, 018)* |

## ## **STATE RECONSTRUCTION: IMPOSSIBLE FOR ALL SEVEN DOMAINS.**

---

# PART 6 — EVENT GOVERNANCE

| Aspect | Verdict |
|---|---|
| **Event naming** | 🔴 **No convention.** `"CONDOR"` in one ledger, `"IRON_CONDOR"` in another — **same structure, two names** *(010 P3-A)* |
| **Versioning** | 🔴 **NONE.** No schema version in any file |
| **Schemas** | 🔴 **6 incompatible ledgers.** No contract |
| **Ownership** | 🔴 **NONE** |
| **Documentation** | 🔴 **NONE** |
| **Compatibility** | 🔴 **NONE** — 🔴 **and this bites the S-01 fix:** adding `haltedReason` to an old equity file means its **absence must be treated as UNKNOWN ⇒ brake ON**, not as "not halted" |
| **Deprecation** | 🔴 **NONE** |

## ## **Event governance: DOES NOT EXIST.**

---

# PART 7 — OBSERVABILITY

| Required per event | Recorded? |
|---|---|
| Timestamp | 🟡 in most ledgers |
| **Event ID** | 🔴 **DOES NOT EXIST** |
| **Source** | 🔴 **DOES NOT EXIST** |
| **Owner** | 🔴 **DOES NOT EXIST** |
| **Payload version** | 🔴 **DOES NOT EXIST** |
| **Correlation ID** | 🔴 **DOES NOT EXIST** — 🔴 **so a signal cannot be linked to the trade it caused, or the trade to the capital change it produced** |
| Outcome | 🟡 `won`, `pnl` |
| **Audit reference** | 🔴 **DOES NOT EXIST** |

## **2 of 8. *"Events without provenance are not reliable."***

---

# PART 8 — FAILURE MODE REGISTER

| ID | Failure | Present? | Impact |
|---|---|---|---|
| **EV-1** | **A crash produces no event** | 🔴 **CONFIRMED — LIVE (§0)** | **CRITICAL. The outage is unreconstructable** |
| **EV-2** | **A halt produces no event** | 🔴 **CONFIRMED** | **CRITICAL. *"Why did trading stop last Tuesday?"* is unanswerable** |
| **EV-3** | **A capital change produces no event** | 🔴 **CONFIRMED** | **CRITICAL. The account's history is unrecoverable** |
| **EV-4** | **Evidence silently altered** | 🔴 **CONFIRMED — `result-validate.json` overwritten** *(015 §0.B)* | **CRITICAL** |
| **EV-5** | **No correlation ID** | 🔴 **CONFIRMED** | **HIGH. A signal cannot be traced to its trade, or a trade to its capital impact** |
| **EV-6** | **No event ID ⇒ duplicates undetectable** | 🔴 **CONFIRMED** | HIGH |
| **EV-7** | **Silent failures** | 🔴 **CONFIRMED — 92 empty catches** | **CRITICAL** |
| **EV-8** | **Event ordering** | ⚪ **UNKNOWN — no sequence number, no monotonic clock** | MEDIUM |
| **EV-9** | **No event bus** | 🔴 **CONFIRMED — `EventEmitter` in 1 module, and it is a websocket client** | HIGH |

---

# PART 9 & 10 — EVENT SOURCING ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   EventStore  ★   APPEND-ONLY. IMMUTABLE. DATE-PARTITIONED. ONE JSON OBJECT PER LINE.
     🟢 THIS ALREADY EXISTS: amibroker-bridge.js:141 does exactly this, correctly.
        data/ami-signals-YYYY-MM-DD.jsonl · data/migrations/*.jsonl
     🔴 IT IS POINTED AT MIGRATIONS AND NEWS. POINT IT AT THE THINGS THAT LOSE MONEY.

   Event schema (universal):
     eventId · correlationId · ts(monotonic) · type · source · owner ·
     payloadVersion · payload · outcome
     🔴 correlationId is what links: signal → decision → order → fill → capital → outcome.
        Today NOTHING links them.                                          → kills EV-5

   The events that MUST exist, and today do not:
     SYSTEM_STARTUP · SYSTEM_SHUTDOWN · PROCESS_CRASH        → §0 Q1/Q2
     ENGINE_HALTED(reason, inputs) · ENGINE_RESUMED(by whom) → §0 Q4, 013
     EMERGENCY_STOP(who, when, engines)                      → 012 §0
     CAPITAL_CHANGED(prev, next, cause, tradeRef)            → 014
     CONFIG_CHANGED(key, prev, next, actor)                  → 004
     STRATEGY_ENABLED(strategyId, evidenceRefs)              → 015 Part 6
     POSITION_OPENED / POSITION_CLOSED                       → 010 §0
     AI_INFERENCE(modelVersion, inputsHash, prediction)      → 016, 018

   EventBus  ★     Producers emit. Consumers subscribe. Neither knows the other.
                   🔴 Today: EventEmitter in ONE module, and it is a broker websocket client.

   ReplayEngine + SnapshotManager  ★
     🔴 State = fold(events). A snapshot is an OPTIMISATION, never the source of truth.
        Today the snapshot IS the only truth, and it is overwritten in place.

   AuditLedger  ★  WORM. Nothing may be deleted or rewritten. A correction is a NEW event
                   that SUPERSEDES an old one — never an overwrite.        → kills EV-4
```

## The one rule §0 establishes

> **If an event can change what the system does next — or what a human would decide next — it must be
> written down before the system acts on it. A `console.log` is not a record. It is a rumour that dies
> with the process.**

---

# PART 11 — TESTING STRATEGY

| Test | Priority | Would it fail today? |
|---|---|---|
| 🔴 **A crash produces a persisted `PROCESS_CRASH` event** | **P0 — §0** | ✅ **FAILS** |
| 🔴 **A halt produces a persisted `ENGINE_HALTED(reason)` event, and it survives a restart** | **P0** | ✅ **FAILS** |
| 🔴 **A capital change produces `CAPITAL_CHANGED(prev, next, cause, tradeRef)`** | **P0** | ✅ **FAILS** |
| 🔴 **No result file is ever overwritten — a new run is a NEW event** | **P0 — EV-4** | ✅ **FAILS** |
| 🔴 **Every event carries an `eventId` and a `correlationId`** | **P0** | ✅ **FAILS** |
| **Replay: fold(events) reproduces the current capital exactly** | **P0** | ✅ **FAILS — impossible today** |
| **Event ordering is monotonic and gap-free** | P1 | ✅ FAILS |
| **A duplicate event is rejected by `eventId`** | P1 | ✅ FAILS |

**Six P0 tests. All six fail.**

---

# PART 12 — MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Basic Logs** | 🟢 | **71 `console.log` in `server.js`. No logger dependency. This is the level** |
| **1 — Structured Events** | 🟡 **PARTIAL** | 🟢 **3 event types ARE properly structured and append-only** — migrations, AmiBroker signals, news. 🔴 **None of the 14 that matter** |
| **2 — Auditable Operations** | 🔴 **NO** | **§0: a crash, a halt, an open position and a capital change are all unauditable** |
| **3 — Immutable History** | 🔴 **NO** | **Results, weights, capital and config are all overwritten in place** |
| **4 — Event Sourcing** | 🔴 **NO** | **State cannot be reconstructed from events in ANY of the 7 domains** |
| **5 — Enterprise Audit Platform** | 🔴 **NO** | — |

## ## **Audit Platform: LEVEL 0–1 — BASIC LOGS, with three correctly event-sourced streams that do not matter.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Event inventory** | ✅ **DONE — this document.** **17 event types; 3 event-sourced; none of the 3 can lose money** | — | none | The gap is measured |
| **2 — Audit coverage** | 🔴 **Point the EXISTING append-only pattern at the events that matter.** Start with the four that §0 proves are missing: `SYSTEM_STARTUP` · `SYSTEM_SHUTDOWN` · `PROCESS_CRASH` · `ENGINE_HALTED(reason)` | **`amibroker-bridge.js:141` is the reference implementation. It already works** | **Low — purely additive. Nothing reads it yet** | **§0's five questions all become answerable** |
| **3 — Immutable history** | 🔴 **Stop overwriting in place.** `result-*.json`, `confluence-weights.json`, `equity-*.json` → **a new run is a NEW event, and the old one is SUPERSEDED, never deleted** | Phase 2 | Low | **EV-4 becomes impossible.** *(015 §0.B could not happen again)* |
| **4 — Replay** | `correlationId` on every event: signal → decision → order → fill → capital → outcome. **`ReplayEngine`: state = fold(events)** | Phase 3 | Medium | **`fold(events)` reproduces the current capital exactly** |
| **5 — Enterprise governance** | WORM audit ledger. Event schema registry. Versioning and deprecation | Phase 4 | Medium | **Historical evidence cannot be silently altered** |

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every critical action produces an immutable event | 🔴 **NO — 3 of 17, and none of the 3 can lose money** |
| **State can be reconstructed from event history** | 🔴 **NO — impossible in all 7 domains** |
| Event ownership is documented | 🔴 **NO** |
| Events are versioned | 🔴 **NO** |
| Silent failures are detectable | 🔴 **NO — 92 empty catches; §0 is the proof** |
| **Historical evidence cannot be silently altered** | 🔴 **NO — `result-validate.json` was silently overwritten, by me** *(015 §0.B)* |
| Audit history is complete and reproducible | 🔴 **NO — §0: four of five questions return UNKNOWN** |

## **0 of 7.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent auditor reconstruct any significant system event, trace every
decision back to its evidence, and reproduce the platform's operational history from the documented
event history alone?**

## **No — and I proved it on the only event that mattered.**

**One hour ago, during audit 021, the bot died. I attempted to reconstruct that event using nothing but
the platform's own history:**

> **When did it die? UNKNOWN — not one lifecycle event is persisted anywhere in `data/`.**
> **Why did it die? UNKNOWN — `crash.log` is eight days stale.**
> **Was a position open? UNKNOWN AND UNKNOWABLE — three of four engines never persist open positions.**
> **Was the engine halted? UNKNOWN AND UNKNOWABLE — `haltedReason` is in no schema.**
>
> **The bot was alive at 06:53:46Z. It is dead at 07:08:05Z. Fourteen minutes apart, and ZERO records
> mark the transition.**

**And then the finding that makes this different from a simple absence:**

> ## **The platform already knows how to do event sourcing. It does it correctly. It has pointed it at the wrong things.**
>
> ```js
> amibroker-bridge.js:141
>   fs.appendFileSync(this.signalStoreFile(record.date), `${JSON.stringify(record)}\n`, 'utf8');
> ```
>
> **Append-only. Date-partitioned. One JSON object per line. Never rewritten. A correct, textbook event
> store — and it exists, today, in this repository.**
>
> **It logs AmiBroker signals. `data/migrations/*.jsonl` logs migrations. `data/news/*.jsonl` logs news
> headlines.**
>
> **It logs NOTHING about: a crash. A halt. An emergency stop. A capital change. An order. A risk
> decision. A strategy being switched on. An open position.**
>
> **Three event types in this platform are immutably, correctly event-sourced. Not one of the three can
> lose money.**

**The capability is present. The implementation is correct. The instinct is present. It was simply never
pointed at anything that could hurt.**

**And the sharpest illustration of the cost is one I inflicted myself:** when I fixed the look-ahead in
`bt-validate.js`, the script **overwrote its own result file in place** — destroying the evidence that
this platform's validator had once certified a worthless strategy at 95% confidence. **That before/after
— the single most important finding of the entire audit programme — survives only because I happened to
paste it into a markdown file before re-running the script.** *(015 §0.B.)*

**The event history preserved nothing. It never has.**

**The one change that matters, and it requires no new architecture:**

> ## **Take the append-only `.jsonl` writer that already works, and point it at the events that can lose money.**
>
> **Start with the four that §0 proves are missing: `SYSTEM_STARTUP`, `SYSTEM_SHUTDOWN`, `PROCESS_CRASH`,
> and `ENGINE_HALTED(reason)`.**
>
> **After that, the five questions in §0 become answerable — and the next time the bot dies, someone
> will know.**

---

**Storage redesigned: NONE. Logging modified: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Event Inventory (Part 1) · Event Lifecycle (Part 2) · Audit Coverage (Part 3) ·
Immutability (Part 4) · State Reconstruction (Part 5) · Event Governance (Part 6) · Observability
(Part 7) · Failure Modes (Part 8) · Architecture & Contracts (Parts 9–10) · Testing Strategy (Part 11) ·
Maturity Assessment (Part 12) · Migration Roadmap (Part 13) · Executive Summary.
