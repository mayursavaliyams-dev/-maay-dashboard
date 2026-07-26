# 037 — TICK DATA, MARKET REPLAY, EVENT REPLAY & DETERMINISTIC SIMULATION

**Standard:** Master Prompt 037 · **Depends on:** 000-A … 036
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No replay infrastructure created. No synthetic data generated.**

**037's stop condition: *"Never claim replay fidelity beyond the available historical evidence."***
## **This audit measures the ceiling. It does not assert it.**

---

# SECTION 0 — THE REPLAY CEILING, MEASURED

## §0.1 — 🔴 **THERE IS NO TICK DATA. NONE. ANYWHERE.**

```
  data/ticks         → DOES NOT EXIST
  bt-data/ticks      → DOES NOT EXIST
  any .tick file     → DOES NOT EXIST
```

**The word `tick` appears throughout the codebase — `afternoon-engine.tick()`, `agents-engine.tick()` —
but every occurrence is an ENGINE TIMER CALLBACK, not a market tick.**

> **The platform polls a broker's REST chain. It has never received, stored, or observed a single market
> tick. Not one.**
>
> **This is not a gap to be filled. A REST poll cannot produce ticks. Tick data, the order book, queue
> position and fill probability are **UNOBSERVABLE from the platform's current sources** — and no
> roadmap changes that without a new data licence.**

## §0.2 — 🟢 **THE FINEST GRANULARITY THAT EXISTS: ONE MINUTE. AND IT IS GOOD.**

**Measured, on the one complete session:**

```
  data/opt-candles/2026-07-08.json      669 series (a FULL chain: strike × type)

  best-covered series (NIFTY|21400|PE):
    bars                   : 371
    span                   : 374 minutes
    ─────────────────────────────────────────
    COVERAGE               : 99%

    inter-bar gaps         : 368 × 60 s   (perfect one-minute cadence)
                             1 × 120 s    (one missed minute)
                             1 × 240 s    (three missed minutes)

    first bar : 2026-07-08 03:45 UTC  =  09:15 IST   ✅ the NSE open
    last bar  : 2026-07-08 09:59 UTC  =  15:29 IST   ✅ the NSE close
```

> ## 🟢 **This is a genuinely good dataset. A full option chain, at one-minute granularity, covering 99% of a real trading session, with only four missing minutes.**
>
> **It is the single most valuable derivative dataset this platform has ever produced — and there is
> exactly ONE of it.**

## §0.3 — 🔴 **AND THE OTHER FOUR SESSIONS ARE 8–30% COMPLETE**

*(Measured in 034 §0, reproduced because it is the cost of §0.2's rarity.)*

```
  2026-07-06     70 / 375 bars   ( 19%)
  2026-07-07     56 / 375 bars   ( 15%)
  2026-07-08    375 / 375 bars   (100%)   ← the only one
  2026-07-09    114 / 375 bars   ( 30%)
  2026-07-10     29 / 375 bars   (  8%)
```

**Cause: the capture pipeline is a `setInterval` that flushes every 60 seconds, so the file contains
exactly as many bars as the process was ALIVE to collect. The bot has no supervisor** *(029 §0)*.

> ## **The platform is capable of producing a 99%-complete intraday chain replay dataset. It has done it once, by accident, on a day the bot happened to stay up.**

## §0.4 — 🟢 **DETERMINISTIC REPLAY: VERIFIED**

```
  Two independent invocations of bt-lib.loadDays() over the 600-day archive:

    byte-identical output   :  YES
    days loaded             :  600
```

> **Historical replay of the daily archive is **deterministic**. Same inputs, same output, every time.
> No randomness, no clock, no ordering ambiguity.**
>
> **This is the third assumption in thirty-nine audits that was tested and HELD.**

---

## §0.5 — **THE CEILING, STATED HONESTLY**

| What can be faithfully replayed | Evidence |
|---|---|
| 🟢 **600 days of EOD OHLC + OI, per strike, per expiry** | Deterministic (§0.4) · verified clean (031, 033) |
| 🟢 **ONE intraday session — full chain, 1-minute, 99%** | §0.2 |
| 🟡 Four more sessions, 8–30% | §0.3 |

| What **cannot** be replayed — and why | Class |
|---|---|
| 🔴 **Ticks** | **UNOBSERVABLE** — a REST poll cannot produce them |
| 🔴 **Order book / queue position / fill probability** | **UNOBSERVABLE** |
| 🔴 **Bid/ask spread** | **UNOBSERVABLE** — never captured |
| 🔴 **Latency** | **UNOBSERVABLE** |
| 🔴 **Order lifecycle events** | 🔴 **NOT RECORDED — no order object exists** *(012)* |
| 🔴 **Risk events / halts** | 🔴 **NOT RECORDED — `_haltedReason` is in no schema** *(005 S-01)* |
| 🔴 **Configuration changes** | 🔴 **NOT RECORDED — zero config events persisted** *(022, 024)* |
| 🔴 **Strategy decisions** | 🔴 **NOT RECORDED — no `strategyId`, no inputs** *(007, 035)* |
| 🔴 **Capital changes** | 🔴 **NOT RECORDED — a single number, overwritten in place** *(014)* |
| 🔴 **Operational events** | 🔴 **NOT RECORDED — `INC-001` produced zero records** *(029)* |

> ## **THE REPLAY CEILING IS A DAY.**
>
> **The platform can replay the market at daily resolution, deterministically. It can replay one session
> at one-minute resolution. And it cannot replay a single order, a single halt, a single configuration
> change, or a single decision it has ever made — because none of them was ever written down.**

---

# PART 1 — REPLAY DATASET INVENTORY

| Dataset | Granularity | Coverage | Owner | Validation | Confidence |
|---|---|---|---|---|---|
| 🔴 **Tick data** | — | **NONE** | — | — | 🔴 **DOES NOT EXIST. UNOBSERVABLE** |
| 🟡 **Minute candles** (`opt-candles`) | **1 min** | **5 sessions: 1 × 99%, 4 × 8–30%** | `server.js` | 🟢 **§0.2 — cadence verified** | **HIGH** |
| 🟢 **Option chain snapshots (EOD)** | **daily** | **600 days** | `bt-lib` | 🟢 **VERIFIED (031, 033, 036)** | **HIGH** |
| 🔴 **Order events** | — | **NONE** | — | — | 🔴 **No order object exists** |
| 🟡 **Paper trade events** | per trade | **6 incompatible ledgers** | per-engine | 🔴 **5 of 14 required fields absent; open positions lost** *(010)* | HIGH |
| 🔴 **Risk events** | — | **NONE** | — | — | 🔴 **The halt is never persisted** |
| 🔴 **Configuration snapshots** | — | **NONE** | — | — | 🔴 **Overwritten in place. One `.bak`** |
| 🔴 **Market calendar** | — | **NONE** | — | — | 🔴 **27 gaps unexplainable** *(031 §0.2)* |
| 🟢 **Corporate actions** | — | ⚪ **N/A** | — | — | 🟢 **Index options — not applicable** |
| 🔴 **Exchange status events** | — | **NONE** | — | — | 🔴 |
| 🔴 **Historical logs** | — | **NONE** | — | — | 🔴 **`console.log` → a buffer that died with the process** *(021 §0)* |
| 🟢 **Option H/L archive** (`data/opthl`) | daily | **12 files** | `server.js` | 🔴 raw write | MEDIUM |

## **Twelve replay datasets. Two are usable. Six do not exist. One is unobservable.**

---

# PART 2 — REPLAY LIFECYCLE

```
  Historical Data ──▶ Validation ──▶ Time Alignment ──▶ Replay Scheduler ──▶ Event Queue ──▶ Consumers ──▶ Research ──▶ Paper ──▶ AI ──▶ Audit
        ↓                ↓                 ↓                   ↓                  ↓              ↓
        │                │                 │                   │                  │              └── 🔴 no event
        │                │                 │                   │                  │                  consumer exists
        │                │                 │                   │                  └── 🔴 NO EVENT QUEUE.
        │                │                 │                   │                      EventEmitter in 1 module —
        │                │                 │                   │                      AND IT IS DISABLED (034 §1)
        │                │                 │                   └── 🔴 DOES NOT EXIST.
        │                │                 │                       Replay = a `for` loop over sorted filenames.
        │                │                 └── 🔴 `days[i-1]` is the previous FILE, not the previous
        │                │                     TRADING DAY. 27 gaps. UNPROVABLE. (031 §0.3)
        │                └── 🟢 ONE rule: `o > 0` (bt-lib:40). Verified correct (033).
        └── 🟢 600 CSV, deterministic (§0.4).
```

## **Four of ten replay stages do not exist. What is called "replay" is a `for` loop.**

---

# PART 3 — TICK DATA GOVERNANCE

| Aspect | Verdict |
|---|---|
| **Tick timestamps** | ⚪ **N/A — no ticks exist** |
| **Exchange timestamps** | 🟢 **Daily: `TradDt`** · 🟢 **Minute: epoch ms in `opt-candles`, verified to align with the NSE session (§0.2)** |
| **Sequencing** | 🔴 **NONE. `dhan-ws-feed.js` has ZERO sequence-number references — and it is DISABLED** *(034 §1)* |
| **Missing ticks** | ⚪ **N/A** — 🟡 **Missing MINUTES: 4 of 375 on the one complete session** |
| **Duplicate ticks** | ⚪ **N/A** |
| **Ordering guarantees** | 🟢 **Daily: filename sort = date sort. Deterministic** · 🔴 **Streaming: NONE** |
| **Tick provenance** | 🔴 **N/A — nothing to have provenance about** |

## ## **037's stop condition: *"Stop and report UNKNOWN if tick provenance cannot be verified."***
## ## **→ There is no tick provenance, because there are no ticks. This is not UNKNOWN. It is ABSENT, and it is unobservable from current sources.**

---

# PART 4 — REPLAY CAPABILITY REVIEW

| Capability | Present? |
|---|---|
| **Full session replay** | 🔴 **NO — at daily resolution only.** One intraday session exists |
| **Partial replay** | 🟡 `loadDays()` returns an array; a script may slice it |
| **Speed control** | 🔴 **NO — replay runs at full CPU speed** |
| **Pause / Resume** | 🔴 **NO** |
| **Time travel** | 🔴 **NO** |
| 🟢 **Deterministic replay** | 🟢 **YES — VERIFIED (§0.4). Byte-identical output across independent loads** |
| **Checkpoint restart** | 🔴 **NO** |

## **One of seven capabilities. And it is the most important one.**

---

# PART 5 — SIMULATION GOVERNANCE

**037: *"Unknown market behaviour must remain UNKNOWN."***

| Simulated? | Verdict |
|---|---|
| **Latency** | 🔴 **NOT MODELLED. UNOBSERVABLE** |
| **Slippage** | 🟡 **PARTIAL — `bt-strangle-costs` sweeps 0–2% 🟢. `bt-strategies`, `bt-world-strategies`, `bt-nifty-intraday`: ZERO** *(008 Part 4)* |
| **Market gaps** | 🟡 The data contains them; no gap logic exists |
| **Exchange halts** | 🔴 **NOT MODELLED. Not captured** |
| **Session boundaries** | ⚪ **N/A at daily resolution** |
| **Order acknowledgement** | 🔴 **NOT MODELLED — no order object exists** |
| **Fill timing** | 🔴 **NOT MODELLED — the LTP IS the fill** |
| **Queue priority** | 🔴 **UNOBSERVABLE** |

## 🔴 The simulation's core assumption, stated plainly

> **Every backtest and every paper trade assumes it can transact at the observed price, instantly, in
> full, with no spread and no queue.**
>
> **The bhavcopy's `Opn` is the day's FIRST TRADED PRICE. The backtest treats it as a price available to
> anyone at 09:15. For a liquid ATM strike that is defensible — and 033 §0.4 verified the traded strikes
> ARE liquid (1.4M units of volume). For anything else it is a fiction.**
>
> **The paper engine is worse: it fills at the polled LTP with no spread at all — making the FORWARD
> TEST more optimistic than the backtest it is meant to validate** *(010 Part 1)*.

---

# PART 6 — EVENT REPLAY

| Event class | Replayable? |
|---|---|
| **Market events** | 🟢 **Daily: YES, deterministically** · 🟡 1 intraday session |
| **Configuration changes** | 🔴 **NO — zero config events persisted** |
| **Risk events** | 🔴 **NO — the halt is in no schema** |
| **Strategy decisions** | 🔴 **NO — no `strategyId`, and the inputs were discarded** |
| **Order lifecycle** | 🔴 **NO — no orders exist** |
| **Position lifecycle** | 🔴 **NO — open positions are never persisted in 3 of 4 engines** |
| **Capital changes** | 🔴 **NO — one number, overwritten in place** |
| **Operational events** | 🔴 **NO — `INC-001` produced ZERO records** |

## ## **Event completeness: 1 of 8. The platform can replay the MARKET. It cannot replay ITSELF.**

> **This is the same finding as 022 §0, arriving from a different direction: the append-only `.jsonl`
> writer that would make all seven of these replayable **already exists** in the repository — pointed at
> migrations and news headlines.**

---

# PART 7 — OBSERVABILITY

| Required per replay event | Recorded? |
|---|---|
| Replay timestamp | 🔴 **NO** |
| Original timestamp | 🟢 **YES** — `TradDt` / epoch ms |
| **Dataset version** | 🔴 **NO — no hash, no manifest** |
| **Replay speed** | 🔴 **N/A — full CPU speed, uncontrolled** |
| Consumer | 🔴 **NO** |
| Processing result | 🟡 `bt-data/result-*.json` — 🔴 **0 of 13 carry a `gitSha`** |
| Validation status | 🔴 **NO** |

## **1.5 of 7. *"Replay without provenance is scientifically incomplete."***

---

# PART 8 — FAILURE MODE REGISTER

| ID | Failure | Present? | Scientific impact |
|---|---|---|---|
| **RP-1** | 🔴 **No tick data** | 🔴 **CONFIRMED — UNOBSERVABLE** | 🔴 **CRITICAL. Execution, slippage, queue and fill models are impossible. Permanently** |
| **RP-2** | 🔴 **The platform cannot replay itself** | 🔴 **CONFIRMED — 1 of 8 event classes** | 🔴 **CRITICAL. "Why did it trade last Tuesday?" is unanswerable** |
| **RP-3** | 🔴 **Intraday capture at 8–30%** | 🔴 **CONFIRMED (§0.3)** | 🔴 **CRITICAL, IRREVERSIBLE** |
| **RP-4** | 🔴 **Time-alignment unprovable — `days[i-1]`** | 🔴 **CONFIRMED (031 §0.3)** | 🔴 **CRITICAL — it is the precondition of the 002 fix** |
| **RP-5** | 🔴 **No slippage in 3 of 8 backtests; no spread anywhere** | 🔴 **CONFIRMED** | 🔴 **HIGH — the forward test is MORE optimistic than the backtest** |
| **RP-6** | 🔴 **No event queue; no ordering guarantees for streaming** | 🔴 **CONFIRMED — and the one stream is disabled** | HIGH |
| **RP-7** | 🔴 **No dataset version — a result cannot name the data it used** | 🔴 **CONFIRMED** | 🔴 **CRITICAL** |
| 🟢 **RP-8** | **Non-deterministic execution** | 🟢 **NOT PRESENT — VERIFIED byte-identical (§0.4)** | 🟢 |
| 🟢 **RP-9** | **Out-of-order replay / duplicate sessions** | 🟢 **NOT PRESENT** *(031 §0.1)* | 🟢 |

---

# PART 9 & 10 — REPLAY ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   ReplayEngine  ★
     🟢 DETERMINISM ALREADY HOLDS (§0.4). PRESERVE IT.
     🔴 A strategy sees ONLY a ReadOnlyContext of days ≤ t-1 plus today's OPEN.
        It is STRUCTURALLY IMPOSSIBLE to read today's close.
        ← this alone kills the entire 001-D look-ahead class.
     🔴 TradingCalendar-aware: days[i-1] must be the previous TRADING day, ASSERTED.  → RP-4

   EventReplay  ★★★   THE PLATFORM CAN REPLAY THE MARKET. IT CANNOT REPLAY ITSELF.
     🟢 The append-only .jsonl writer ALREADY EXISTS (amibroker-bridge.js:141).
     🔴 POINT IT AT: startup · shutdown · crash · halt · resume · config change ·
        capital change · order · position · decision(inputsHash).
     🔴 Then `fold(events)` reproduces any past state — and "why did it trade?" becomes
        answerable for the first time.                                         → RP-2

   SimulationController  ★
     🔴 EVERY ASSUMPTION IS DECLARED, NOT ASSUMED:
        latency = UNKNOWN · spread = UNKNOWN · queue = UNOBSERVABLE · fill = LTP (OPTIMISTIC).
     🔴 A simulation that does not declare its assumptions is not a simulation. It is a hope.

   THE CEILING, DECLARED:
     🔴 Tick data · order book · queue position · fill probability are UNOBSERVABLE from a
        REST broker feed. NO ROADMAP CLOSES THIS without a new data licence.
        STATE THE CEILING. DO NOT PRETEND TO CROSS IT.
```

## The rule §0 establishes

> **Replay fidelity is bounded by what was recorded, not by what was computed.**
>
> **This platform records the market at daily resolution and replays it perfectly. It records nothing
> about itself, and can replay none of it.**

---

# PART 11 — TESTING STRATEGY

| Test | Priority | Status |
|---|---|---|
| 🟢 **`loadDays()` is byte-identical across independent runs** | **P0** | 🟢 **PASSES (§0.4). LOCK IT IN — it is the platform's strongest replay property** |
| 🔴 **`days[i-1]` is the previous TRADING day** | **P0 — RP-4** | ✅ **FAILS — no calendar** |
| 🔴 **A halt, a config change and a capital change are all replayable from events** | **P0 — RP-2** | ✅ **FAILS — zero events persisted** |
| 🔴 **The intraday capture achieves ≥ 95% of a session, or raises an incident** | **P0 — RP-3** | ✅ **FAILS — 8–30% on 4 of 5** |
| 🔴 **Every simulation DECLARES its assumptions (latency, spread, queue)** | **P0 — RP-5** | ✅ **FAILS — assumed silently** |
| 🔴 **Every result records a `datasetHash`** | **P0 — RP-7** | ✅ **FAILS — 0 of 13** |
| 🟢 **No duplicate or out-of-order sessions** | P1 | 🟢 **PASSES. Lock it in** |

**Five P0 tests fail. Two pass and are the platform's real replay assets.**

---

# PART 12 — REPLAY MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — No Replay** | 🟢 | — |
| **1 — Historical Playback** | 🟢 **YES** | **600 days, `loadDays()`, works** |
| **2 — Deterministic Replay** | 🟢 **YES — VERIFIED (§0.4)** | **Byte-identical across independent runs. This is REAL and it is the platform's strongest replay property** |
| **3 — Event Replay Platform** | 🔴 **NO** | **1 of 8 event classes. The platform cannot replay ITSELF** |
| **4 — Scientific Simulation** | 🔴 **NO** | **No latency, no spread, no queue. Assumptions undeclared** |
| **5 — Institutional Replay** | 🔴 **NO — AND UNREACHABLE** | **Tick data and the order book are UNOBSERVABLE from a REST feed** |

## ## **Replay Platform: LEVEL 2 — DETERMINISTIC REPLAY.**

**This ties with Delivery (028) as the highest maturity level any domain has reached in thirty-nine
audits — and unlike Delivery, it was earned by a property that was tested and held.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE.** **§0: the ceiling is a DAY, and determinism is VERIFIED** | — | none | 12 datasets · 2 usable · 1 unobservable |
| **2 — Time synchronization** | 🔴 **A TRADING CALENDAR.** `days[i-1]` becomes provable *(031 §0.3)* | none | **Low — one file** | 🔴 **The 002 fix's precondition becomes verifiable** |
| **3 — Deterministic replay** | 🟢 **ALREADY ACHIEVED. Lock it in with a test.** Add a `ReadOnlyContext` so today's close is STRUCTURALLY unreachable | Phase 2 | Low | **The look-ahead class becomes impossible, not merely tested-against** |
| **4 — Event replay** ⚠️ | 🔴 **POINT THE EXISTING `.jsonl` WRITER AT REAL EVENTS.** halt · config · capital · position · decision | none | **Low — purely additive** | 🔴 **The platform can replay ITSELF. `fold(events)` reproduces any past state** |
| **5 — Institutional** | ⚪ **BLOCKED — UNOBSERVABLE.** Ticks and the order book require a data licence this platform does not have. **DECLARE THE CEILING** | — | — | **The limit is documented, not fabricated** |

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every replay dataset has one owner | 🔴 **NO — 6 do not exist; 0 have an owner** |
| 🟢 **Replay preserves temporal order** | 🟢 **YES — daily. Verified** |
| **Simulations document assumptions** | 🔴 **NO — this document is the first to state them** |
| **Tick provenance is complete** | ⚪ **N/A — there are no ticks. ABSENT, not unknown** |
| 🟢 **Replay is deterministic** | 🟢 **YES — VERIFIED byte-identical (§0.4)** |
| **Event replay is reproducible** | 🔴 **NO — 1 of 8 event classes** |
| **Unknown market behaviour is never fabricated** | 🟡 **The REPLAY does not fabricate 🟢. The SIMULATION does: a fill at LTP with no spread is a fabrication** 🔴 |

## **2 of 7 — and both that pass are real.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent engineer reproduce historical sessions deterministically, verify
event ordering, and determine exactly what is faithfully replayed versus unknown?**

## **Yes — and this is one of the few audits in this programme with genuinely good news, precisely bounded.**

🟢 **What is real, tested and held:**

> **Historical replay is DETERMINISTIC. Two independent invocations of `bt-lib.loadDays()` over the
> 600-day archive produce byte-identical output. No randomness, no clock, no ordering ambiguity. This
> was tested, not assumed — the third assumption in thirty-nine audits to be checked and hold.**
>
> **And the one complete intraday session is genuinely excellent: a FULL option chain — 669 series — at
> one-minute granularity, 371 bars across a 374-minute span, **99% coverage**, with a perfect 60-second
> cadence broken only twice. The first bar lands at 09:15 IST and the last at 15:29 IST — exactly the
> NSE session.**
>
> **`data/opt-candles/2026-07-08.json` is the single most valuable derivative dataset this platform has
> ever produced.**

🔴 **And there is exactly one of it — because the other four sessions are 8%, 15%, 19% and 30% complete,
and the bot has no supervisor** *(034 §0, 029 §0)*.

🔴 **The ceiling, stated honestly:**

> ## **THERE IS NO TICK DATA. NOT ONE TICK, EVER.**
>
> **The word `tick` throughout the codebase refers to engine timer callbacks. The platform polls a REST
> chain. It has never observed a market tick, an order book, a bid-ask spread, a queue position or a
> fill.**
>
> **These are not gaps to be filled. They are **UNOBSERVABLE from the platform's current sources**, and
> no roadmap closes that without a data licence it does not have. Execution modelling, slippage
> modelling and fill-probability modelling are therefore **permanently blocked** — and 037's own rule
> demands that be stated, not worked around.**

🔴 **And the finding that matters most:**

> ## **THE PLATFORM CAN REPLAY THE MARKET. IT CANNOT REPLAY ITSELF.**
>
> **Of the eight event classes 037 requires, exactly ONE is replayable — market data. It cannot replay a
> single order (none exist), a single halt (never persisted), a single configuration change (never
> recorded), a single capital movement (one number, overwritten), a single strategy decision (no
> `strategyId`, inputs discarded), or a single operational event — `INC-001`, a real SEV-1 outage that
> occurred during this audit, produced **zero records**.**
>
> **The append-only `.jsonl` writer that would make all seven of them replayable **already exists** in
> this repository. It is pointed at migrations and news headlines.**

**The single highest-value replay action, and it is purely additive:**

> ## **POINT THE EXISTING EVENT WRITER AT THE EVENTS THAT MATTER.**
>
> **Halt. Resume. Config change. Capital change. Position open. Position close. Decision, with its
> `inputsHash`.**
>
> **Then `fold(events)` reproduces any past state of this platform — and *"why did it trade last
> Tuesday?"* becomes answerable for the first time in the project's history.**

---

**Replay infrastructure created: NONE. Synthetic data generated: NONE. Code modified: NONE.
Suite: 48/48.**

**Deliverables:** Replay Dataset Inventory (Part 1) · Replay Lifecycle (Part 2) · Tick Governance
(Part 3) · **Replay Capability Review (§0, Part 4)** · Simulation Governance (Part 5) · Event Replay
(Part 6) · Observability (Part 7) · Failure Modes (Part 8) · Replay Architecture (Parts 9–10) · Testing
Strategy (Part 11) · Maturity Assessment (Part 12) · Migration Roadmap (Part 13) · Executive Summary.
