# 021 — OBSERVABILITY PLATFORM, TELEMETRY & SYSTEM HEALTH GOVERNANCE

**Standard:** Master Prompt 021 · **Depends on:** 000-A … 020
**Date:** 2026-07-12 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No performance optimized. No monitoring code modified.**

---

# SECTION 0 — THE PLATFORM PROVED THIS AUDIT'S POINT WHILE THE AUDIT WAS BEING WRITTEN

**021's own rule: *"Never assume observability from the presence of logs alone."***

**So I did not assume. I queried the running system — the same one I had queried, successfully, during
audits 011 and 013 a short time earlier.**

```
  GET /healthz          HTTP 000
  GET /api/health       HTTP 000
  GET /api/m/health     HTTP 000
  GET /api/risk         HTTP 000
  GET /api/nifty/engine/status   HTTP 000
```

## 🔴 **THE BOT IS DEAD. IT DIED DURING THIS AUDIT. NOTHING TOLD ANYONE.**

**This is not a hypothetical. It is not a contrived failure injection. It happened, unprompted, in the
middle of the observability audit — and the only reason it is known is that I tried to query it.**

## §0.1 — What every possible monitoring approach would have reported

| Check | Answer | Correct? |
|---|---|---|
| **Process liveness — "is a PID there?"** | **YES.** Two `node.exe` processes are running | 🔴 **WRONG. The service is down** |
| **Port check — "is `:3000` bound?"** | **NO. Nothing is listening** | 🟢 **The only check that would have caught it — and it does not exist** |
| **`/healthz` — the platform's only health endpoint** | **UNREACHABLE** | 🔴 **It is served BY the dead server** |
| **Any alert** | **NONE EXIST** | 🔴 |
| **Any incident record** | `data/crash.log` — **last written 2026-07-05** | 🔴 **Seven days stale** |
| **Any log from the bot** | `logs/` holds **19 files, ALL from 2026-06-18** — dead sidecar and FastAPI experiments | 🔴 **The bot writes to no log file at all** |
| **A graceful-shutdown EOD snapshot** | Last is `eod-2026-07-10.json`. **Today is 2026-07-12** | 🔴 **`_gracefulShutdown` did not run, or ran and wrote nothing** |

## §0.2 — 🔴 **THE HEALTH-ENDPOINT PARADOX**

```js
server.js:143   app.get('/healthz', (req, res) => res.json({ status: 'ok', uptimeSec, ... }));
```

> **`/healthz` is served BY the process it monitors.**
>
> **It can only ever return `ok`. When the process is healthy, it says `ok`. When the process is dead,
> it says nothing at all — and "nothing" is indistinguishable from a network blip, a firewall, a typo
> in the URL, or a laptop that went to sleep.**
>
> ## **A health check that cannot report ill health is not a health check. It is a liveness probe with
> ## a misleading name — and this platform has no other.**

## §0.3 — 🔴 **AND WHAT DIED WITH IT — measured, from the files still on disk**

```
data/equity-nifty.json     consecLosses: 15   capital: 96761   (last written 2026-07-09)
                           _haltedReason:  NOT IN THE FILE     ← never persisted (005 S-01)
```

**On the next boot, in sequence:**

1. `restoreEquity()` restores **`consecLosses: 15`** — against a limit of **8**.
2. `_haltedReason` is restored as **`null`**, because **it was never written** *(005 S-01)*.
3. The halt check is an **edge trigger** — it only fires inside a losing trade — so **15 > 8 is never
   re-evaluated** *(005 S-02)*.
4. `server.js:7288` calls **`setAutoEnabled(true)`** from `config-overrides.json` *(B-3)*.
5. **NIFTY trades again, at fifteen consecutive losses against a limit of eight.**

**And any iron condor that was open when the process died is simply gone** — never exited, never priced,
never scored, never written to `strangle-trades.json` *(010 §0)*. **The ledger shows no gap where it
was.**

> ## **NO ALERT. NO INCIDENT. NO LOG. NO TRACE.**
>
> **Every single finding of this audit programme — the unpersisted halt, the edge-triggered brake, the
> boot-time re-enable, the lost open positions, the absent alerting, the health check that cannot fail —
> composed themselves into one real event, unprompted, while this document was being written.**
>
> **This section is not an argument. It is a transcript.**

---

# PART 1 — OBSERVABILITY INVENTORY

| Telemetry source | Present? | Owner | Collection | Retention |
|---|---|---|---|---|
| **Application metrics** | 🔴 **NO** | — | — | — |
| **Trading metrics** | 🟡 `/api/engine/status`, `/api/risk` — 🔴 **and `/api/risk` reports WRONG numbers** *(011 §0)* | 🔴 none | on request | none |
| **Risk metrics** | 🔴 **`/api/risk` shows `niftyConsecLosses: 0` when the engine holds 15** | 🔴 none | — | — |
| **AI metrics** | 🔴 **NO** — 🟡 the evidence sits **unread** in `confluence-weights.json.stats` *(018)* | — | — | — |
| **Strategy metrics** | 🔴 **NO** | — | — | — |
| **Paper trading metrics** | 🟡 6 incompatible ledgers | per-engine | on trade | permanent |
| **System metrics** (CPU, mem, disk) | 🔴 **NO** | — | — | — |
| **Database metrics** | 🔴 **N/A** — flat JSON | — | — | — |
| **API metrics** | 🟡 **broker-call latency + 429 counters** (`server.js:6280`) 🟢 — **the ONLY properly instrumented thing in the platform** | — | live | in-memory |
| **Scheduler / timer metrics** | 🔴 **NO.** **14 timers, 0 registered, 0 `clearInterval`.** **A dead timer is invisible** | 🔴 **none** | — | — |
| **`module-contract.js`** | 🔴 **11 surfaces, 114 assertions, `mountAll()` NEVER CALLED ⇒ every route is 404** | — | — | — |

## 🔴 P1-A — **The observability layer is BUILT and UNMOUNTED**

`module-contract.js` constructs **eleven service surfaces** — health, metrics, OpenAPI, config, and more
— from a single descriptor, with **114 passing assertions** and deny-list secret redaction.

**`grep -c mountAll server.js` → `0`.**

**The module documents its own mounting line, twice, in its own header:**

```js
module-contract.js:20   *   app.use('/api/m', require('./module-contract.js').mountAll());
module-contract.js:23   *   "Until that line exists, the surfaces are real, tested, and simply not
                        *    reachable over HTTP. That is a deployment gap, not a design gap —
                        *    and it is stated, not hidden."
```

> **One line. It has been missing for the entire life of the project. §0 is what that costs.**

---

# PART 2 — TELEMETRY PIPELINE

```
  Component ──▶ Event ──▶ Metric ──▶ Collection ──▶ Aggregation ──▶ Storage ──▶ Dashboard ──▶ Alert ──▶ Operator
      ↓          ↓          ↓            ↓              ↓             ↓            ↓           ↓          ↓
      │          │          │            │              │             │            │           │          └── 🔴 §0: the
      │          │          │            │              │             │            │           │              operator was
      │          │          │            │              │             │            │           │              never told.
      │          │          │            │              │             │            │           └── 🔴 NO ALERTING EXISTS.
      │          │          │            │              │             │            └── 🟡 19 HTML pages, polling REST.
      │          │          │            │              │             │                🔴 One of them shows WRONG numbers.
      │          │          │            │              │             └── 🔴 NO TELEMETRY STORE.
      │          │          │            │              └── 🔴 NO AGGREGATION.
      │          │          │            └── 🔴 NO COLLECTOR.
      │          │          └── 🔴 NO METRICS. (71 console.log in server.js. No logger in package.json.)
      │          └── 🔴 NO EVENT BUS. EventEmitter appears in ONE production module.
      └── 🟡 components exist.
```

## **Seven of nine pipeline stages do not exist. The telemetry pipeline is: `console.log` → a terminal buffer → oblivion.**

---

# PART 3 — HEALTH MONITORING

| Subsystem | Classification | Evidence |
|---|---|---|
| **API health** | 🔴 **MISSING** | `/healthz` returns `ok` and knows nothing. §0.2 |
| **Strategy health** | 🔴 **MISSING** | No engine reports whether it is functioning |
| **Risk Engine** | 🔴 **MISSING** | **The Risk Engine does not exist** *(013)* |
| **Capital Engine** | 🔴 **MISSING** | **`/api/risk` reports `process.env` capital, not the engine's** *(011 §0)* |
| **Execution Engine** | 🔴 **MISSING** | No order state, no broker-response retention *(012)* |
| **Paper trading** | 🔴 **MISSING** | **An orphaned trade leaves no trace at all** *(010 §0)* |
| **Data ingestion** | 🟡 **PARTIAL** | `_dataHealth` exists (`server.js:2125`) — 🔴 **and `/api/m/health` is 404, so it is unreachable** |
| **Scheduler health** | 🔴 **MISSING** | **14 timers, unregistered. A dead timer is a brake that never runs, and nothing notices** |
| **Timer health** | 🔴 **MISSING** | 0 `clearInterval`, 0 heartbeat |
| **Storage health** | 🟡 **PARTIAL** | `safe-write` **detects** corruption and refuses 🟢 — 🔴 **and tells no one** |

## **Implemented: 0. Partial: 2. Missing: 8.**

---

# PART 4 — METRIC GOVERNANCE

| Aspect | Verdict |
|---|---|
| **Metric naming** | 🔴 **No convention.** `maxDD` means a **fraction** in one script and **absolute points** in another *(008 Part 8)* |
| **Metric ownership** | 🔴 **NONE.** `maxDD` ×8 · `profitFactor` ×4 · `Sharpe` ×3 · `capital` ×3 |
| **Cardinality** | 🔴 **N/A — no metrics system** |
| **Units** | 🔴 **UNDECLARED — and it has already caused a real defect:** `oi_unit` is **UNKNOWN** for the broker chain, and if it is units rather than contracts, **every GEX number is wrong by 65×** *(006 N-2)* |
| **Retention** | 🔴 **NONE.** `console.log` → a terminal scrollback |
| **Documentation** | 🔴 **NONE** |

## ## **Metric governance: DOES NOT EXIST. 021's stop condition — metric ownership cannot be established → UNKNOWN.**

---

# PART 5 — ALERTING

| Alert class | Present? |
|---|---|
| **Critical** | 🔴 **NONE** |
| **Warning** | 🔴 **NONE** |
| **Informational** | 🔴 **NONE** |
| **Recovery** | 🔴 **NONE** |
| **Escalation** | 🔴 **NONE** |
| **Suppression** | 🔴 **N/A** |

## 🔴 **ZERO ALERTS EXIST. NOT ONE.**

**000-E enumerated the alerts this platform must have. Measured against reality:**

| Required by 000-E | Status |
|---|---|
| **Process crash** | 🔴 **NONE — §0 IS THIS ALERT, AND IT NEVER FIRED** |
| **Risk engine unavailable** | 🔴 NONE *(there is no risk engine)* |
| **Configuration corruption** | 🔴 NONE — `safe-write` **detects it and tells nobody** |
| **Order failure** | 🔴 NONE |
| **Market data interruption** | 🔴 NONE |
| **Persistent storage failure** | 🔴 NONE |
| **Trading unexpectedly enabled** | 🔴 **NONE — and the defect is LIVE** *(B-3 + 005 S-01)* |

> **`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` and `TELEGRAM_ENABLED` sit in `.env`, configured — and are
> read by no code at all** *(004 §4: genuinely dead)*. **An entire notification channel was configured
> and wired to nothing.**

---

# PART 6 — OBSERVABILITY ARCHITECTURE (conceptual — no code)

```
   HealthRegistry  ★   Every subsystem REGISTERS a check that CAN FAIL.
     engine(halted? consecLosses? capital?) · scheduler(all 14 timers ticked?) ·
     storage(last write ok?) · data(freshness?) · broker(token valid?)
     🔴 A health check that cannot return UNHEALTHY is not a health check.   → kills §0.2

   ExternalHeartbeat  ★★★   THE ONE THING §0 PROVES IS NON-NEGOTIABLE.
     🔴 A process CANNOT monitor its own death.
        Something OUTSIDE the process must observe: is :3000 bound? did the
        heartbeat file update in the last N seconds?
     🔴 A PID is not liveness. §0: two node.exe were "running" and :3000 was unbound.

   EventCollector  ★   The EventBus that does not exist. 1 EventEmitter in the whole codebase.
   TelemetryStore  ★   Metrics with a name, an owner, a unit and a retention.
   AlertManager    ★   Severity · trigger · owner · escalation.  (000-E's 7 alerts. Zero exist.)
   ObservabilityAuditLog  ★  Structured, timestamped, searchable. Not console.log.

   🔴 AND ONE LINE, TODAY:
      app.use('/api/m', require('./module-contract.js').mountAll());
      → 11 surfaces, 114 assertions, already written and tested, currently 404.
```

## The one rule §0 establishes beyond argument

> **A system cannot report its own death. Observability that lives inside the observed process is not
> observability — it is a diary that stops being written at the exact moment it matters most.**

---

# PART 7 — FAILURE MODE REGISTER

| ID | Failure | Present? | Impact |
|---|---|---|---|
| **OB-1** | **The process dies and nothing notices** | 🔴 **CONFIRMED — LIVE, DURING THIS AUDIT (§0)** | **CRITICAL. The halt, the open positions and the trading day are all lost silently** |
| **OB-2** | **The health endpoint cannot report ill health** | 🔴 **CONFIRMED (§0.2)** | **CRITICAL** |
| **OB-3** | **The observability layer is built and unmounted** | 🔴 **CONFIRMED — `mountAll()` never called** | **CRITICAL. One line** |
| **OB-4** | **The dashboard reports WRONG numbers** | 🔴 **CONFIRMED — `/api/risk` shows `consecLosses: 0` when the engine holds 15** *(011 §0)* | **CRITICAL. This is why every other defect survived** |
| **OB-5** | **Silent failures** | 🔴 **CONFIRMED — 92 empty catches** | **CRITICAL. A failure is indistinguishable from a success** |
| **OB-6** | **A dead timer is invisible** | 🔴 **CONFIRMED — 14 timers, 0 registered** | **HIGH. A brake that never runs looks exactly like a brake that never fires** |
| **OB-7** | **Corruption detected and not reported** | 🔴 **CONFIRMED — `safe-write` refuses and logs to a terminal** | HIGH |
| **OB-8** | **No metric ownership / units** | 🔴 **CONFIRMED — `maxDD` ×8, two meanings** | MEDIUM |
| **OB-9** | **Alert failure** | 🔴 **N/A — there are no alerts to fail** | **CRITICAL** |

---

# PART 8 — TESTING STRATEGY

| Test | Priority | Would it fail today? |
|---|---|---|
| 🔴 **An EXTERNAL heartbeat detects that the process is gone within N seconds** | **P0 — §0** | ✅ **FAILS — nothing exists** |
| 🔴 **`/healthz` returns UNHEALTHY when an engine is halted, a ledger is corrupt, or the feed is stale** | **P0 — §0.2** | ✅ **FAILS — it can only say `ok`** |
| 🔴 **`GET /api/m/health` returns 200** | **P0 — one line** | ✅ **FAILS — 404** |
| 🔴 **`/api/risk` reports the ENGINE's `consecLosses`, not a recomputed one** | **P0 — 011 §0** | ✅ **FAILS — shows 0, truth is 15** |
| 🔴 **Every one of 000-E's 7 critical alerts fires in a simulated failure** | **P0** | ✅ **FAILS — 0 of 7 exist** |
| **A dead timer is detected within one interval** | P1 | ✅ FAILS |
| **A corrupt-file refusal raises an alert, not just a log line** | P1 | ✅ FAILS |
| **Every metric has a name, an owner and a unit** | P1 | ✅ FAILS |

**Five P0 tests. All five fail.**

---

# PART 9 — OBSERVABILITY MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Ad Hoc Logging** | 🟢 | **71 `console.log` in `server.js`. No logger in `package.json`. This is the level** |
| **1 — Basic Metrics** | 🔴 **NO** | **No metrics system.** 🟢 *One exception: broker-call latency and 429 counters (`server.js:6280`) — genuinely well done, and it is the only one* |
| **2 — Health Monitoring** | 🔴 **NO** | **§0: the process died and the health endpoint died with it** |
| **3 — Governed Telemetry** | 🔴 **NO** | **No metric has a name, an owner, a unit or a retention** |
| **4 — Unified Observability** | 🔴 **NO** | — |
| **5 — Production Observability Platform** | 🔴 **NO** | — |

## ## **Observability: LEVEL 0 — AD HOC LOGGING.**

---

# PART 10 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every critical subsystem emits telemetry | 🔴 **NO — 8 of 10 subsystems have no health check at all** |
| **Health status is measurable** | 🔴 **NO — §0. The health endpoint died with the thing it monitors** |
| Metrics have documented ownership | 🔴 **NO — `maxDD` has eight implementations and two meanings** |
| Silent failures are minimized | 🔴 **NO — 92 empty catches** |
| **Alerts are actionable** | 🔴 **NO — there are ZERO alerts** |
| **System state is observable** | 🔴 **NO — §0.1: a PID says UP, a port says DOWN, and only one of them is right** |
| Operational behaviour is auditable | 🔴 **NO — one `EventEmitter` in the whole codebase** |

## **0 of 7.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent Site Reliability Engineer determine the operational health of every
critical subsystem, identify failures in real time, and explain the platform's behaviour using
documented signals?**

## **No — and the platform demonstrated exactly why, without being asked, in the middle of this audit.**

> **The bot died. Two `node.exe` PIDs remained. Port 3000 was never bound. `/healthz` — the platform's
> only health endpoint — could not answer, because it is served by the very process that stopped.**
>
> **No alert fired, because none exists. No incident was recorded: `data/crash.log` was last written
> seven days ago. No log was produced: `logs/` contains nineteen files, every one of them from a dead
> experiment on 18 June. No graceful-shutdown snapshot was written: the last EOD file is dated two days
> before today.**
>
> **The only reason anyone knows the bot is down is that I tried to query it.**

**And what died with it is exactly what every earlier audit predicted:**

**`consecLosses: 15` is on disk. `_haltedReason` is not, because it was never persisted. The halt check
is an edge trigger that will not re-evaluate at boot. `setAutoEnabled(true)` fires from
`config-overrides.json` on every start. So on the next boot, NIFTY resumes trading at fifteen
consecutive losses against a limit of eight. And any iron condor that was open is simply gone — never
exited, never priced, never scored, and the ledger shows no gap where it was.**

**Six findings from six separate audits — the unpersisted halt (005), the edge-triggered brake (005),
the boot-time re-enable (B-3), the lost open positions (010), the absent alerting (000-E), and the
health check that cannot fail (001-E) — composed themselves into one real event, unprompted, while this
document was being written.**

**This section is not an argument. It is a transcript.**

**What is genuinely good — and it is one thing:**
**the broker-call instrumentation** (`server.js:6280`) — coalescing, backoff, rate-limit counters.
**It is the only properly instrumented failure path in the entire platform, and it is excellent.**

**And what is one line away:**

```js
app.use('/api/m', require('./module-contract.js').mountAll());
```

**Eleven service surfaces. One hundred and fourteen passing assertions. Health, metrics, OpenAPI —
written, tested, redacted, and returning 404 for the entire life of the project.**

**The two changes that matter, in order:**

> ## **1. An EXTERNAL heartbeat. A process cannot report its own death.**
> **§0 is the proof, and it cost a trading day and an unknown number of open positions to obtain.**
>
> ## **2. Mount `module-contract`. One line. It is already written and already right.**

---

**Performance optimized: NONE. Monitoring code modified: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Observability Inventory (Part 1) · Telemetry Pipeline (Part 2) · Health Monitoring
(Part 3) · Metric Governance (Part 4) · Alerting (Part 5) · Architecture Blueprint (Part 6) · Failure
Modes (Part 7) · Testing Strategy (Part 8) · Maturity Assessment (Part 9) · Executive Summary.
