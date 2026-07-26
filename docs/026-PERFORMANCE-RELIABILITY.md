# 026 — PERFORMANCE, SCALABILITY & RELIABILITY ENGINEERING

**Standard:** Master Prompt 026 · **Depends on:** 000-A … 025
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No code optimized. No architecture rewritten.**

**Note on method:** the server is **down** *(021 §0)*. **I did not restart it to take measurements** —
because per 024 §0 it would boot the NIFTY engine at **15/8, unhalted, trading**. Everything below is
either **measured statically**, **measured from the platform's own tooling**, or declared **UNKNOWN**.

---

# SECTION 0 — THE MOST HONEST ARTEFACT IN THE PLATFORM

**`scripts/perf-report.js` exists. I ran it. This is its complete output:**

```
  PERFORMANCE TARGETS — measured 2026-07-13

  UNKNOWN   API < 50 ms
            "no PORT given. Start the server, then `PORT=3000 npm run perf:report`.
             This script REFUSES to boot server.js: doing so starts the engines and
             writes ledgers."

  UNKNOWN   WebSocket latency < 100 ms
            "NO WebSocket server exists. `ws` is a broker CLIENT in dhan-ws-feed.js.
             server.js discards the http.Server from app.listen(), so nothing can attach."

  MISSED    Dashboard refresh 250 ms
            "16 independent polling timers, fastest 1000 ms. 250 ms is a RENDER budget,
             not a poll interval: 16 timers at 250 ms = 64 req/s per open tab against a
             single-threaded monolith."

  VERIFIED  Memory leak 0
            "pop-seller book bounded at 2001 rows after 20k round-trips, open position
             retained. Zero-leak cannot be PROVEN by heap sampling; the bounding
             invariants are asserted instead."
```

## Why this is remarkable

| | |
|---|---|
| 🟢 **It refuses to measure by causing side effects** | *"This script refuses to boot server.js: doing so starts the engines and writes ledgers."* **A performance tool that will not corrupt the thing it measures** |
| 🟢 **It reports UNKNOWN rather than guessing** | Two of four targets. **000-A's Rule Zero, applied to performance** |
| 🟢 **It admits what cannot be proven** | *"Zero-leak cannot be PROVEN by heap sampling; the bounding invariants are asserted instead."* **This is a statement most professional performance engineers would not make** |
| 🟢 **It quantifies the miss precisely** | *"16 timers at 250 ms = 64 req/s per open tab against a single-threaded monolith"* |

> ## **This is the same instinct found in `safe-write.js`, `engine-verdict.js`, `agents-engine.js:458`, and `position-sizer.js` — a component that knows exactly what it does not know, and says so.**
>
> **And it is the same fate: it exists, it is correct, and its two most important targets have never been measured because nobody has run it against a live server.**

## 🔴 And 000-E's requirement remains unmet

**000-E: *"Never optimize without comparing against a baseline."***

| Baseline required by 000-E | Exists? |
|---|---|
| **Startup time** | 🔴 **NO** |
| **API latency** | 🔴 **UNKNOWN — the tool exists and has never been run against a live server** |
| **Data-processing latency** | 🔴 **NO** |
| **Memory usage** | 🟡 **Bounding invariants asserted 🟢 — no heap baseline** |
| **CPU usage** | 🔴 **NO** |
| **Recovery time** | 🔴 **NO — and 021 §0 gives the first real datum: see §1** |

---

# SECTION 1 — THE ONLY RELIABILITY MEASUREMENT THIS PLATFORM HAS EVER PRODUCED

**021 §0 was not a drill. The bot died. That gives me real numbers — the first reliability data in the
project's history.**

```
  Last record written anywhere in data/ : 2026-07-13 06:53:46Z   ← the process was alive
  Outage discovered                     : 2026-07-13 07:08:05Z   ← because I queried it
  ─────────────────────────────────────────────────────────────
  TIME TO DETECT (MTTD)                 : ≥ 14 minutes — AND ONLY BECAUSE A HUMAN LOOKED
  TIME TO DETECT, unattended            : ∞   (no alert, no heartbeat, no monitor exists)
  TIME TO RECOVER (MTTR)                : ∞   (the process is STILL DOWN as of this writing)
  INCIDENT RECORD PRODUCED              : NONE
```

## What the outage cost, measured

| Loss | Evidence |
|---|---|
| **The halt state** | `_haltedReason` is in no schema *(005 S-01)* |
| **Any open position** | 3 of 4 engines never persist them *(010 §0)* |
| **The trading day** | No EOD snapshot since `eod-2026-07-10.json` |
| **The `_enteredToday` guard** | In-memory only *(007 P6-A)* |
| **Every log line since boot** | `console.log` → a terminal buffer that died with the process |

> ## **MTTD (unattended) = ∞. MTTR = ∞. Incident records = 0.**
>
> **These are not estimates. They are the measured characteristics of a real outage that happened
> during this audit.**

---

# PART 1 — PERFORMANCE INVENTORY

| Subsystem | Owner | Expected workload | Measured? | Confidence |
|---|---|---|---|---|
| **HTTP API** | `server.js` | **172 routes, 1 thread** | 🔴 **UNKNOWN** — the tool exists, never run live | HIGH |
| **Strategy execution** | 6 engines | 14 timer ticks | 🔴 **UNKNOWN** | HIGH |
| **Risk Engine** | — | — | ⚪ **DOES NOT EXIST** | HIGH |
| **Capital Engine** | — | — | ⚪ **DOES NOT EXIST** | HIGH |
| **Paper trading** | per-engine | ~1 trade/day | 🔴 UNKNOWN | HIGH |
| **Data ingestion** | 5 connectors | polled | 🟢 **INSTRUMENTED** — latency, coalescing, 429 counters *(`server.js:6280`)* | HIGH |
| **Market data processing** | `option-analyzer` (1,127 LOC) | per chain fetch | 🔴 UNKNOWN | HIGH |
| **Storage** | `safe-write` | per trade | 🔴 UNKNOWN — 🟡 **IO-write count IS ratcheted** *(`test/perf-budget.test.js`)* | HIGH |
| **Scheduler** | 🔴 **NOBODY** | **14 timers** | 🔴 **UNKNOWN — a dead timer is invisible** | HIGH |
| **Background workers** | ⚪ **NONE — no worker threads, no queue** | — | — | HIGH |
| **AI inference** | `confluence-learner` | per signal | 🔴 UNKNOWN | HIGH |
| **Reporting** | 19 HTML pages | polling | 🟡 **71 polling timers across 20 pages** | HIGH |

## 🟢 The one properly instrumented subsystem

**Broker data ingestion** (`server.js:6280`) — in-flight request coalescing, exponential backoff,
rate-limit counters, and a `/api/*` surface exposing them. **This is the only subsystem in the platform
whose performance is actually observable, and it is well done.**

---

# PART 2 — EXECUTION FLOW

```
  Input ──▶ Validation ──▶ Processing ──▶ Storage ──▶ Response ──▶ Background ──▶ Monitoring
    ↓            ↓              ↓            ↓            ↓             ↓             ↓
    │            │              │            │            │             │             └── 🔴 021 §0:
    │            │              │            │            │             │                 NONE.
    │            │              │            │            │             └── 🔴 14 timers,
    │            │              │            │            │                 0 clearInterval,
    │            │              │            │            │                 NO queue, NO workers.
    │            │              │            │            └── 🟡 JSON
    │            │              │            └── 🔴 16 SYNCHRONOUS IO CALLS INSIDE ROUTE HANDLERS.
    │            │              │                Each one BLOCKS the single event loop.
    │            │              └── 🔴 `gatherMasterSignal` is 146 LOC. Whether it re-computes
    │            │                  per route or caches is ⚪ UNKNOWN — never measured.
    │            └── 🔴 NO VALIDATION LAYER.
    └── 🟡 Express.

  ONE THREAD. 172 ROUTES. 14 TIMERS. NO WORKERS. NO QUEUE.
```

---

# PART 3 — LATENCY ASSESSMENT

| Latency | Value | Source |
|---|---|---|
| **API** | 🔴 **UNKNOWN** | The tool refuses to boot the server. **Correctly** |
| **Broker round-trip** | 🟢 **~180 ms** *(measured previously, `docs/EVOLUTION`)* | The only real latency number in the project |
| **Strategy** | 🔴 **UNKNOWN** | |
| **Risk** | ⚪ **N/A — no risk engine** | |
| **Storage** | 🔴 **UNKNOWN** — 🟡 **write COUNT is ratcheted** | `test/perf-budget.test.js` |
| **Startup** | 🟡 **MEASURED HERE: 10.6 ms to load 11 of 81 modules** ⇒ **module loading is not the bottleneck.** The rest of boot (config, restore, engine construction) is 🔴 **UNKNOWN** | this audit |
| **Shutdown** | 🔴 **UNKNOWN** — 🔴 **and `setTimeout(exit, 400)` is a hardcoded guess, not a measurement** |
| **Recovery** | 🔴 **∞ — §1. The process is still down** |

## ## **026's stop condition: *"Stop and report UNKNOWN if performance cannot be measured."* → SIX of eight latencies are UNKNOWN.**

---

# PART 4 — RESOURCE UTILIZATION

| Resource | Measured | Risk |
|---|---|---|
| **CPU** | 🔴 **UNKNOWN — never sampled** | ⚪ |
| **Memory** | 🟡 **Bounding invariants asserted** (pop-seller book capped at 2001 rows after 20k round-trips) 🟢 · 🔴 **no heap baseline** | 🟡 |
| **File handles** | 🔴 **UNKNOWN** | ⚪ |
| **Timers** | 🔴 **14 `setInterval`, 0 `clearInterval`, 16 `setTimeout`** | 🔴 **HIGH — no timer can EVER be stopped** |
| **Event-loop blocking** | 🔴 **38 synchronous IO calls in `server.js` — 16 of them INSIDE route handlers** | 🔴 **HIGH** |
| **Synchronous IO** | 🔴 **38** | 🔴 |
| **Cache** | 🟢 TTL caches: 5 s (price), 3 min (Yahoo), per-connector | 🟢 |

## 🔴 P4-A — **Sixteen synchronous IO calls inside route handlers, on a single thread**

**Node runs one event loop. Every `readFileSync` / `writeFileSync` inside a route handler **stops the
entire server** — all 172 routes, all 14 timers, every engine tick — until the disk returns.**

**Today, with one user, this is invisible.** ⚪ **Under any concurrency it is UNKNOWN — and 026 forbids
inferring scalability from the current workload.**

## 🔴 P4-B — **Fourteen timers that can never be stopped**

```
  setInterval   : 14
  clearInterval :  0
```

**No timer in this platform can be stopped. Ever.** *(001-B A-04.)*

**The cost is measured, not theoretical:** `_gracefulShutdown` writes the EOD snapshot and then calls
`setTimeout(exit, 400)` — **while all 14 timers keep firing.** **The EOD snapshot is a read taken while
fourteen writers are still running.**

**And 021 §0 showed the second cost: a dead timer is a brake that never runs, and it looks exactly like
a brake that never fires.**

---

# PART 5 — SCALABILITY

| Dimension | Classification | Evidence |
|---|---|---|
| **Routes** | 🔴 **UNKNOWN** | **172 routes, 1 thread, 0 `express.Router()`, 16 blocking IO calls in handlers** |
| **Background workers** | 🔴 **NOT IMPLEMENTED** | **No worker threads. No queue. No job runner.** 14 bare `setInterval`s |
| **Storage** | 🔴 **PARTIAL** | Flat JSON. **`ami-signals-all.json` is 233 KB and read/written whole** |
| **Market data** | 🟢 **IMPLEMENTED** | **Coalescing + backoff + caching. The one scalable subsystem** |
| **Paper trading** | 🔴 **UNKNOWN** | ~1 trade/day. **Untested at any other rate** |
| **AI inference** | 🔴 **UNKNOWN** | |
| **Reporting** | 🔴 **PARTIAL** | **71 polling timers across 20 HTML pages.** The main dashboard alone has **16** |

## 🔴 P5-A — The dashboard's own scalability, quantified by the platform's own tool

> *"16 timers at 250 ms = **64 req/s per open tab** against a single-threaded monolith."*

**Every one of those requests may hit a route containing a synchronous `readFileSync`.**
**Two open tabs would double it. This has never been tested.**

**026: *"Never infer scalability from current workload alone."*** ⚪ **UNKNOWN, and correctly so.**

---

# PART 6 — RELIABILITY

| Aspect | Verdict |
|---|---|
| **Restart behaviour** | 🔴 **BROKEN. Measured live (021 §0):** the halt, the open positions, `_enteredToday` and the trading day are all lost |
| **Recovery** | 🔴 **MTTR = ∞. The process is still down** |
| **Fault tolerance** | 🔴 **A single process. No supervisor. `ecosystem.config.js` (PM2) exists — and the process died and stayed dead** |
| **Retry behaviour** | 🟢 **Broker: backoff + coalescing** · 🔴 **Order-level: NONE, and no idempotency** *(012)* |
| **Timeout handling** | 🟡 4 of 6 connectors 🟢 · 🔴 **`live-connector.js` (460 LOC, the primary path) has NO timeout** |
| **Resource cleanup** | 🔴 **0 `clearInterval`. `app.listen()`'s return value is discarded ⇒ `server.close()` is unreachable** |
| **Graceful shutdown** | 🔴 **RACE.** 10 writes, then `setTimeout(exit, 400)`, with 14 timers still firing. 🔴 **And 021 §0 shows the last shutdown produced NO record at all** |

## ## **Reliability maturity: the platform has ONE real reliability measurement, and it is `MTTR = ∞`.**

---

# PART 7 — OBSERVABILITY

| Metric | Reported? |
|---|---|
| **Throughput** | 🔴 **NO** |
| **Latency** | 🟢 **Broker calls only** — the one instrumented path |
| **Error rate** | 🔴 **NO — 92 empty catches emit nothing** |
| **Queue depth** | ⚪ **N/A — no queue exists** |
| **Resource usage** | 🔴 **NO** |
| **Availability** | 🔴 **NO — 021 §0: the process died and nothing noticed** |
| **Health** | 🔴 **`/healthz` cannot report ill health. `/api/m/health` → 404** |

## **1 of 7. *"Performance without measurement is UNKNOWN."***

---

# PART 8 — FAILURE MODE REGISTER

| ID | Failure | Present? | Impact |
|---|---|---|---|
| **PF-1** | **Event-loop blocking** | 🔴 **CONFIRMED — 16 sync IO calls inside route handlers** | 🔴 **HIGH under concurrency. UNKNOWN today** |
| **PF-2** | **Timer leak** | 🔴 **CONFIRMED — 14 `setInterval`, 0 `clearInterval`** | 🔴 **HIGH. The EOD snapshot is read mid-write** |
| **PF-3** | **No supervisor / no auto-restart** | 🔴 **CONFIRMED — 021 §0. MTTR = ∞** | 🔴 **CRITICAL** |
| **PF-4** | **Memory leak** | 🟢 **VERIFIED BOUNDED** — pop-seller book capped at 2001 rows after 20k round-trips | 🟢 |
| **PF-5** | **Deadlock** | 🟢 **N/A — single-threaded, no locks** | 🟢 |
| **PF-6** | **Race conditions** | 🟡 **Shutdown race CONFIRMED.** 🟢 **The `openPosition` race I claimed in four documents does NOT exist — RETRACTED** *(005 §1)* | 🟡 |
| **PF-7** | **Storage bottleneck** | ⚪ **UNKNOWN.** `ami-signals-all.json` (233 KB) is read/written whole | ⚪ |
| **PF-8** | **API saturation** | ⚪ **UNKNOWN — never load-tested.** **No rate limiting exists** *(023)* | ⚪ |
| **PF-9** | **No timeout on the primary connector** | 🔴 **CONFIRMED — `live-connector.js`** | 🔴 **HIGH. A hung socket has no bounded failure** |

---

# PART 9 & 10 — ENGINEERING ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   Supervisor  ★★★   THE MISSING PIECE. §1 IS THE PROOF.
     🔴 An EXTERNAL process restarts the bot when it dies.
     🔴 MTTR = ∞ today because NOTHING is watching.
     🟡 ecosystem.config.js (PM2) EXISTS — and the process died and stayed dead.
        ⚪ WHY is UNKNOWN. Either it is not running under PM2, or PM2 did not restart it.
           THIS MUST BE ESTABLISHED BEFORE ANY OTHER RELIABILITY WORK.

   Scheduler  ★   Registers all 14 timers ⇒ clearInterval becomes POSSIBLE.
                  A missed tick is an ALERT, not a silence.                  → PF-2

   PerformanceMonitor  ★
     🟢 scripts/perf-report.js ALREADY IS THIS. It is correct, honest, and has never been
        run against a live server. RUN IT. It will fill 2 of 4 UNKNOWNs in one command.

   ResourceMonitor  ★  CPU · memory · file handles · event-loop LAG.
                       🔴 Event-loop lag is the ONE metric that would expose PF-1.

   CapacityManager    🔴 NEVER INFER SCALABILITY FROM CURRENT WORKLOAD (026's own rule).
                         Load-test 172 routes with 16 blocking IO calls before claiming anything.
```

## The rule §0 and §1 establish together

> **The platform has an honest performance tool that has never been run, and a supervisor config that
> did not supervise. Measurement is not missing because it is hard. It is missing because nobody
> pressed the button.**

---

# PART 11 — TESTING STRATEGY

| Test | Priority | Status |
|---|---|---|
| 🔴 **An EXTERNAL supervisor restarts the process within N seconds of death** | **P0 — §1, MTTR = ∞** | ✅ **FAILS — the process is still down** |
| 🔴 **Establish why PM2 did not restart it** | **P0** | ⚪ **UNKNOWN — must be answered first** |
| 🔴 **`npm run perf:report` against a live server — fill the 2 UNKNOWNs** | **P0 — §0** | **Never run** |
| 🔴 **Event-loop lag stays under N ms during a route sweep** | **P0 — PF-1** | ✅ **FAILS — never measured** |
| 🔴 **Shutdown clears all 14 timers BEFORE writing the EOD snapshot** | **P0 — PF-2** | ✅ **FAILS** |
| 🔴 **`live-connector` has a timeout** | **P0 — PF-9** | ✅ **FAILS** |
| **Startup latency baseline** | P1 — 000-E | 🟡 **Partial: 10.6 ms for 11 modules, measured here** |
| 🟢 **Memory bounded under 20k round-trips** | P1 | 🟢 **PASSES — already asserted. Keep it** |
| 🟢 **IO-write count ratchet** | P1 | 🟢 **PASSES — `test/perf-budget.test.js`. Keep it** |

**Six P0 tests. All six fail or have never been run. Two P1 tests already pass.**

---

# PART 12 — PERFORMANCE MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Prototype** | 🟢 | It runs — when it is running |
| **1 — Measured Performance** | 🟡 **PARTIAL** | 🟢 **A correct, honest perf tool EXISTS.** 🟢 **Broker latency is instrumented.** 🟢 **Memory is bounded and asserted.** 🔴 **6 of 8 latencies are UNKNOWN. The tool has never been run live** |
| **2 — Managed Resources** | 🔴 **NO** | **14 timers, 0 cleanup. 16 blocking IO calls in handlers. No resource monitor** |
| **3 — Reliable Operations** | 🔴 **NO** | **§1: MTTD (unattended) = ∞. MTTR = ∞. Zero incident records** |
| **4 — Scalable Platform** | 🔴 **NO** | **1 thread, 172 routes, no workers, no queue, never load-tested** |
| **5 — Enterprise Reliability** | 🔴 **NO** | — |

## ## **Engineering Platform: LEVEL 0–1 — PROTOTYPE / partially measured.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE — this document.** **§1 is the platform's first reliability measurement** | — | none | 6 of 8 latencies UNKNOWN; MTTR = ∞ |
| **2 — Measurement** | 🔴 **ANSWER: why did PM2 not restart it?** 🔴 **Run `npm run perf:report` against a live server** — the tool is written and correct | 🔴 **B-3 + S-01 must be approved FIRST, or booting the server starts NIFTY at 15/8** | **Low** | **2 of 4 targets move from UNKNOWN to a number.** MTTR becomes finite |
| **3 — Reliability** | 🔴 **An EXTERNAL supervisor + heartbeat** *(021)*. `clearInterval` on all 14 timers. A timeout on `live-connector` | Phase 2 | **Low** | **MTTD < 60 s. MTTR < 5 min. The EOD snapshot is consistent** |
| **4 — Capacity** | **Event-loop lag monitoring.** Move the 16 blocking IO calls out of the request path | Phase 3 | Medium | **The blocking-IO count in handlers is 0** |
| **5 — Scalability** | **Load-test 172 routes.** WebSocket instead of 71 polling timers | Phase 4 | Medium | **Scalability is validated, not assumed** |

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| **Critical latency is measurable** | 🟡 **The TOOL exists and is correct. It has never been run live. 6 of 8 UNKNOWN** |
| Resource ownership is documented | 🔴 **NO — the scheduler has no owner; 14 timers are unregistered** |
| Capacity limits are understood | 🔴 **NO — never load-tested** |
| **Reliability is evidence-based** | 🟢 **YES, for the first time — §1. And the evidence is `MTTR = ∞`** |
| Recovery behaviour is reproducible | 🔴 **NO — 021 §0: the halt, the positions and the day were all lost, with no record** |
| **Performance regressions are detectable** | 🟡 **PARTIAL — the IO-write ratchet works** 🟢 · 🔴 **nothing else** |
| Scalability assumptions are validated | 🔴 **NO** |

## **1 of 7 — and the one that passes is the measurement of a failure.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent reliability engineer measure system behaviour, identify bottlenecks,
reproduce operational characteristics, and assess scalability using evidence rather than assumptions?**

## **The evidence exists for reliability — because the system failed during this audit and I measured the failure. For everything else, the honest answer is UNKNOWN, and the platform's own tool says so first.**

🟢 **What is genuinely excellent — and it is the theme of this entire audit programme:**

> **`scripts/perf-report.js` is the most intellectually honest artefact in this repository.**
>
> **It refuses to boot the server to take a measurement, because doing so *"starts the engines and
> writes ledgers."* It reports `UNKNOWN` for two of its four targets rather than guessing. It states,
> without being asked, that *"zero-leak cannot be PROVEN by heap sampling; the bounding invariants are
> asserted instead."* And it quantifies its one missed target precisely: *"16 timers at 250 ms = 64
> req/s per open tab against a single-threaded monolith."***
>
> **It is correct. It is written. And its two most important targets have never been measured, because
> nobody has run it against a live server.**
>
> **This is the seventh time in this programme that the right thing has been found built, correct, and
> unused — after `engine-verdict.js`, `module-contract.js`, `bt-validate.js`, `position-sizer.js`,
> `auth.js`, and the append-only `.jsonl` writer.**

🔴 **And then §1 — the only reliability data this platform has ever produced, obtained the hard way:**

> **The bot died during audit 021. It is still down.**
>
> ```
> TIME TO DETECT (unattended) : ∞    — no alert, no heartbeat, no monitor exists
> TIME TO RECOVER             : ∞    — the process is still down as of this writing
> INCIDENT RECORDS PRODUCED   : 0
> ```
>
> **`ecosystem.config.js` — a PM2 supervisor config — exists in the repository. The process died and
> stayed dead. ⚪ Whether it was not running under PM2, or PM2 failed to restart it, is UNKNOWN — and
> that question must be answered before any other reliability work.**

**The measured resource facts:**

- **38 synchronous IO calls in `server.js`. Sixteen of them are inside route handlers.** Node runs one event loop; each one **stops the entire server** — all 172 routes, all 14 timers, every engine tick — until the disk returns. With one user this is invisible. **026 explicitly forbids inferring scalability from the current workload, so: UNKNOWN.**
- **14 `setInterval`. Zero `clearInterval`.** **No timer in this platform can ever be stopped** — which is why the EOD snapshot is a read taken while fourteen writers are still running.
- **71 polling timers across 20 dashboard pages.** The main dashboard alone drives **16**.
- 🟢 **Memory is bounded, and the bound is asserted, not assumed.**
- 🟢 **Broker data ingestion is properly instrumented** — coalescing, backoff, rate-limit counters. **The one subsystem whose performance is actually observable.**

**The single highest-value action, and it is one command:**

> ## **RUN `npm run perf:report` AGAINST A LIVE SERVER.**
>
> **The tool is written, correct, and honest. It will convert two of four `UNKNOWN`s into numbers in a
> single command.**
>
> **But it cannot be run yet — because per 024 §0, booting the server today starts the NIFTY engine at
> fifteen consecutive losses against a limit of eight, unhalted, and trading.**
>
> **The performance baseline this platform needs is blocked behind the risk fix it has not approved.**

---

**Code optimized: NONE. Architecture rewritten: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Performance Inventory (Part 1) · Execution Flow (Part 2) · Latency Assessment
(Part 3) · Resource Utilization (Part 4) · Scalability (Part 5) · Reliability Review (Part 6) ·
Observability (Part 7) · Failure Modes (Part 8) · Engineering Architecture (Parts 9–10) · Testing
Strategy (Part 11) · Maturity Assessment (Part 12) · Migration Roadmap (Part 13) · Executive Summary.
