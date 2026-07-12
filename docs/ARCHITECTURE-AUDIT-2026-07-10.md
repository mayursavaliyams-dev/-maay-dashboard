# PRINCIPAL QUANT ARCHITECT — FULL ARCHITECTURE AUDIT

**2026-07-10.** No code written. No rewrite proposed. Suite 46/46. Server live, 4.7 h uptime.
Every line is **Measured**, **Verified**, or **Unknown**. Nothing is inferred.

---

## Executive Summary

The platform has **excellent leaf-level architecture and no architecture above it.**

The dependency graph is **acyclic** and correctly shaped: `safe-write.js` has **28 dependents and zero
dependencies**. `instrument-registry.js` has 10. `charges.js` has 5. Storage does not import business
logic. **Execution does not import learning** — verified, not assumed.

What is missing sits one level up: **nothing owns capital, orders, risk, or exposure.** Eleven engine
instances each hold a fragment of all four and cannot see one another. The 7,327-line `server.js` is
not the monolith's cause; it is the vacuum's shape.

**The invalidation of the platform's edge claim this morning changes the audit's conclusion.** Building
a Risk Engine or Portfolio Engine now would be governance for a strategy that does not work.

---

## Architecture Score: **D+**

| axis | score | measurement |
|---|---|---|
| Dependency hygiene | **A** | **0 circular dependencies** (comment-stripped graph over 60 modules) |
| Leaf design | **A** | `safe-write.js` pure, 28 dependents. `charges.js` one implementation, 5 dependents |
| Layering | **B** | storage → no business logic. execution → no learning. Verified. |
| Ownership | **F** | capital ×4 owners, orders ×8 sites, risk ×11 private brakes, exposure ×0 |
| Composition root | **F** | `server.js` 7,327 lines, 168 routes, 0 `express.Router()`, **62 top-level mutable variables** |
| Observability | **F** | `/api/m/health` → 404. `EventEmitter` in 1 module |
| Runtime health | **A−** | 188 MB working set, **CPU 0.78% of wall clock** over 4.7 h |

---

## Subsystem Scorecard

| subsystem | grade | dominant evidence |
|---|---|---|
| **Storage / Persistence** | **A−** | `safe-write.js`: atomic rename, fsync, `.bak`, validate-by-reparse, fail-closed. 28 dependents. Measured: naive writes gave 94% corrupt reads under a concurrent reader; safe-write gave 0. |
| **Instrument Registry** | **A** | Broker-verified, fail-closed two-surface design (`trading` vs `catalog`). 10 dependents. |
| **Recovery** | **B+** | Crash recovery, `.bak` restore, refuse-on-corrupt. **Locking: `withLock` exists, unused.** **Replay: absent. Audit trail: absent.** |
| **Testing** | **A−** | 46 suites, exit-code gated. Every fix characterized red first. |
| **Performance (runtime)** | **B+** | CPU 0.78%, 188 MB. But **20 synchronous IO calls in the request path** and 14 `setInterval` / 0 `clearInterval`. |
| **Configuration** | **D** | 42 env reads, 12 override keys, 7 `setConfig` sites. Precedence was decided by line number until today. |
| **Market Data / Option Chain** | **C** | 198 legs, 100% two-sided quotes. But `open` is 0 on 198/198; `close` is yesterday's; 21.7% of IVs are `bsm`-derived. |
| **Backtesting** | **F** | Two invalidated claims. `bt-lib.js:18` publishes a closing price as `underlying`. `bt-lib.js:12` hardcodes `LOT = 75`, wrong on **59.3%** of 600 days. `bt-validate.js` used by **zero** strategy scripts. |
| **Risk** | **F** | No portfolio risk. No cross-engine exposure. `setAutoEnabled()` re-arms a halted engine. |
| **Execution** | **D** | 8 `placeOrder()` sites, 6 modules. One boolean (`paperMode`) is the only chokepoint. |
| **Paper Trading** | **B** | Ledgers atomic, `.bak`, refuse-on-corrupt. `strangle-engine` and `agents-engine` never forget a live position. |
| **Learning / Calibration** | **D** | `confluence-learner` returns `hitRate: null` at n=0 — correct. But `track()` **rejects an `EngineVerdict`**, so the reliability estimator cannot learn from the only object engines may emit. |
| **Probability** | **A (by refusal)** | `pop-seller.verdict()` **abstains**. `engine-verdict.build()` refuses a verdict with a direction verb. |
| **AI Engines** | **D** | 15 modules still emit BUY/SELL. 1 `verdict()` adopter. |
| **Dashboard** | **B** | Lot table removed; ratchet 2 → 0. Renders `null` as `—`, never 0 (verified at `dashboard.html:774`). |
| **API** | **D** | `/api/engine/status` ignores `?inst=`, always returns SENSEX. Auto endpoints echo the **request**, not the state. |
| **Logging** | **D** | 112 silent catches. Structured logging built in `module-contract.js`; unmounted. |
| **Security** | **D** | `.env` rewritten from an HTTP handler, mode `0644`. No webhook secret, no CSP. `/config` redaction exists — unreachable. |
| **Scheduler** | **D** | 14 `setInterval`, **0 `clearInterval`**. `_gracefulShutdown` stops nothing. |
| **WebSocket** | **F** | No WebSocket server. `app.listen()`'s return value discarded → nothing can attach. |
| **Caching** | **C** | Chain cache 5 s; VIX 30 s; `getVixHistory` 6 h. No shared cache layer; each engine caches privately. |
| **Portfolio** | **F** | Does not exist. |

---

## CRITICAL findings

### C1 — A halted engine is re-enabled at boot

- **Evidence:** MEASURED, reproduced on the real prototype. `setAutoEnabled()` contains **0 references
  to `_haltedReason`**. `tick()`'s only gate is `if (!this.autoEnabled) return;` (`:280`).
  `getHaltStatus()` publishes `{"halted": true, "autoEnabled": true}` — an impossible state.
- **Root cause:** `autoEnabled` and `_haltedReason` are two representations of one invariant, with no
  owner.
- **Files:** `execution-engine.js:698, 280`; `server.js:7287`
- **Runtime impact:** the engine trades on the next tick. **Trading impact:** paper only today.
- **Probability:** 1.0 on any restart with `NIFTY_DIRECTIONAL_AUTO: true`. **Severity:** critical.
  **Confidence:** high.
- **Dev cost:** 6 lines. **Test cost:** 1 suite. **Migration risk:** none. **Rollback:** `git checkout`.
- Package: `docs/APPROVAL-halt-reenabled-at-boot.md`

### C2 — `bt-lib.js` publishes a closing price named `underlying`

- **Evidence:** MEASURED. `bt-lib.js:18` `underlying = +rows[0][20]` = UDiFF `UndrlygPric` = the day's
  **close**. Consumers use it to choose strikes, then fill at the option's **open**.
- **Impact:** invalidated both edge claims. Selling: PF 7.41 → **0.55**. Buying: fails at PF 0.84 **even
  with look-ahead**.
- **Files:** `bt-lib.js`, and all six strategy scripts that import it.
- **Probability:** 1.0. **Severity:** critical. **Confidence:** high.
- **Dev cost:** one rename. **Rollback:** trivial. **But every result in `bt-data/` must be re-derived.**

### C3 — `LOT = 75` hardcoded in the backtest library

- **Evidence:** MEASURED. `bt-lib.js:12`. `NewBrdLotQty` is on every bhavcopy row and takes four values
  across 600 days: **25, 50, 65, 75**. The constant is wrong on **356 / 600 days (59.3%)**.
- This violates constraint **F1**, which was written about this exact hazard.
- **Dev cost:** ~5 lines. **Severity:** critical (it scales every P&L and every charge).

### C4 — No owner for capital, orders, risk, exposure

- **Evidence:** MEASURED. Capital: 4 modules, 2 files, 2 config keys. Orders: 8 `placeOrder()` sites in
  6 modules. Exposure: `grep -rlE "totalExposure|portfolioRisk|netDelta"` → **nothing**.
- **Consequence:** the *account* has no daily-loss brake. Eleven engines each have their own.
- **Severity:** critical. **Confidence:** high. **Dev cost:** weeks. **Migration risk:** high.
- **Blocked** behind C2/C3: do not build risk governance for an unvalidated strategy.

---

## HIGH findings

| # | finding | evidence | class |
|---|---|---|---|
| H1 | `signal-health.saveState()` overwrites a file it logged as *"untouched"* | MEASURED: 0 references to `stateCorrupt` in `:115-126` | Data loss |
| H2 | `execution-engine` persists `consecLosses` **before** updating it | MEASURED: brake trips one loss late after every restart | Risk |
| H3 | `_haltedReason` / `autoEnabled` never persisted | MEASURED: NIFTY runs at `consecLosses: 15` vs threshold 3 | Risk |
| H4 | `DAILY_LOSS` halt is permanent; the log says *"until tomorrow"* | MEASURED: `_resetIfNewDay()` clears the reason, never restores the flag | State machine |
| H5 | `/api/engine/status` ignores `?inst=` | MEASURED over HTTP: `?inst=NIFTY` → `instrument: SENSEX` | API lies |
| H6 | Auto endpoints echo the request, not the state | MEASURED: `res.json({autoEnabled: !!enabled})` | API lies |
| H7 | `confluence-learner.track()` rejects an `EngineVerdict` | MEASURED | AI blocked |
| H8 | 20 synchronous IO calls in the request path | MEASURED | Blocking IO |
| H9 | 14 `setInterval`, 0 `clearInterval`; shutdown stops nothing | MEASURED | Zombie timers |

---

## Duplication register — MEASURED

| duplicated | count | evidence |
|---|---|---|
| Kelly | **4** | `position-sizer`, `strangle-engine`, `trade-planner`, `vix-kelly-sizer` |
| GEX | **3** | `gex-skew.js` (`r = 0.065`), `vol-context.js` (`r = 0`, **opposite dealer sign**), `server.js` |
| Capital | **4 owners** | `execution-engine`, `afternoon-engine`, `strangle-engine`, `server.js` |
| Risk brakes | **11** | one per engine instance; none aggregates |
| JSON IO | **centralised** | `safe-write.js`, 28 dependents. **This one is correct.** |
| Charges | **centralised** | `charges.js`, 5 dependents in-tree. **Correct.** |
| Instrument metadata | **centralised** | `instrument-registry.js`, 10 dependents. **Correct.** |
| Timers | **14** in `server.js` | no scheduler abstraction |
| Caches | **per-engine** | chain 5 s, VIX 30 s, VIX history 6 h — no shared layer |

**Three of nine are already correct. The codebase knows how; it has not been made to.**

---

## Paradigm compliance

| paradigm | verdict | evidence |
|---|---|---|
| **Functional isolation** | **Partial — strong at the leaves** | `safe-write`, `charges`, `engine-verdict`, `derivatives` are pure. `fs` and the clock are injected in the modules that were touched this session. |
| **Dependency injection** | **Partial** | `signal-health(fs)`, `event-risk-filter(fs)`, `scanPoP({now})`. Elsewhere modules `require('fs')` directly. |
| **Single Responsibility** | **Violated** | `server.js` is composition root, HTTP layer, scheduler, market-state store and engine registry. |
| **Immutable state** | **Partial** | `engine-verdict.build()` returns a frozen object. 62 top-level mutable variables in `server.js`. |
| **Event-driven** | **Absent** | `EventEmitter` in **1** production module (`dhan-ws-feed.js`). No bus, no replay, no audit trail. |
| **Hexagonal / ports & adapters** | **Emerging** | `module-contract.js` is a correct adapter layer — **unmounted**. `engine-verdict.js` is a correct port — **1 adopter**. |
| **CQRS, DDD, Actor model** | **Not attempted** | No evidence of intent. Not a defect; a scope statement. |
| **Pipeline architecture** | **Absent** | Engines are wired to `server.js` closures over shared mutable slots, not composed. |

---

## AI architecture audit — answers, each measured

| question | answer | evidence |
|---|---|---|
| Are engines independent? | **Mostly yes** | The require graph is acyclic; engines do not import each other. But they share mutable slots through `server.js` closures (`getOpenPosition`/`setOpenPosition`, `:3119-3120`). |
| Does learning leak into execution? | **No** | `execution-engine`, `afternoon-engine`, `strangle-engine` import **none** of `confluence-learner`, `signal-health`, `meta-label`. Verified on the graph. |
| Does the dashboard compute logic? | **No longer** | Lot table removed; ratchet 2 → 0; the engine now publishes `unrealizedPnl`. |
| Does risk depend on the UI? | **No** | No engine imports anything from `public/`. |
| Does execution depend on learning? | **No** | Same as above. |
| Does storage depend on business logic? | **No** | `safe-write.js` has **zero** local dependencies. `database.js` imports only `safe-write.js`. |

**This is the healthiest part of the platform, and it is invisible from `server.js`.**

---

## Risk architecture audit

| question | answer |
|---|---|
| Portfolio risk exists? | **No.** MEASURED. |
| Cross-engine exposure exists? | **No.** `grep` returns nothing. |
| Capital ownership exists? | **No.** 4 owners; boot order decided the balance until this morning. |
| Order ownership exists? | **No.** 8 call sites. |
| Position ownership exists? | **Per engine only.** No aggregate. |
| Risk ownership exists? | **No.** 11 private brakes. |

---

## Recovery audit

| capability | status |
|---|---|
| Crash recovery | **Yes.** Atomic rename + `.bak` + refuse-on-corrupt, 15 writers. |
| Cold start | **Yes**, but boot order overwrote restored equity until today. |
| Warm restart | **Partial.** `_haltedReason` and `autoEnabled` are **not persisted**. |
| Ledger recovery | **Yes.** Recovers from `.bak`; refuses to save over an unreadable ledger. |
| Backup integrity | **Yes.** Validate-by-reparse before rename. |
| Atomic writes | **Yes** — except 8 raw sites in `server.js`. |
| Locking | **`withLock` exists. Unused.** Cross-process lost updates remain (TD-4). |
| Replay | **Absent.** |
| Audit trail | **Absent.** |

---

## Performance ceilings — MEASURED where possible

| quantity | value | method |
|---|---|---|
| CPU | **0.78% of wall clock** over 4.7 h | live process, 130.6 CPU-seconds / 16,845 s |
| Memory | **188 MB working set**, 211 MB private, 12 threads, 291 handles | live process |
| Concurrent engines | **11 instances**, one process, one event loop | counted |
| Chain fetch latency | **180 ms** end-to-end (`timings.totalMs`) | live API |
| `getVix()` latency | **4,513 ms** cold | measured |
| Largest data JSON | `data/ami-signals-all.json` **227 KB**; `bt-data/sensex-1min.json` **5,019 KB** | measured |
| Disk writes | ledger writes are event-driven; 2 caches on 60 s timers | counted |
| Max requests | **UNKNOWN.** No load test has ever been run. |
| Max polling | **UNKNOWN.** 16 dashboard timers per open tab; concurrency untested. |
| Restart time | **UNKNOWN.** Never instrumented. |
| Recovery time | **UNKNOWN.** Never instrumented. |

---

## Immediate actions — ranked by ROI

1. **C2 + C3** — `bt-lib.js`: rename the column, read the lot per row. **Under twenty lines.** They
   decide whether this platform has an edge at all. Nothing outranks them.
2. **C1** — `setAutoEnabled()` refuses to enable a halted engine. Package written.
3. **H1, H2** — data-loss and brake-staleness. Packages written.
4. **Mount `module-contract.mountAll()`** — one line, and Article 14 stops being violated.
5. **Start capturing intraday chains.** One complete session exists. Every day of delay is permanent.

## 90-day roadmap

Re-derive both edge claims through `bt-validate.js` with `underlyingOpen` and the per-row lot. Grow
labelled outcomes 55 → 200 by keeping the paper engines running. **Two possible outcomes: a validated
edge, or an honest retirement.** Nothing else is scheduled, because nothing else is decidable.

## 1-year roadmap — conditional on a validated edge

`AccountLedger` as sole owner of capital. `OrderManager` as a pass-through, then the chokepoint.
Read-only `RiskEngine` publishing exposure at `/api/risk` for two weeks before entering the path.
Event bus → audit trail → replay: **one investment, three products.** `quant/` kernel with one Kelly,
one GEX, one Greeks — gated by a cross-implementation equivalence test.

---

## Architecture diagram (as measured, not as intended)

```
                        ┌──────────────────────────────────────────┐
                        │  server.js — 7,327 lines, 168 routes     │
                        │  composition root · HTTP · scheduler     │
                        │  market state · engine registry          │
                        │  62 mutable globals · 14 timers · 0 clear│
                        └──────────────────────────────────────────┘
                             │ closures over shared mutable slots
        ┌────────────┬───────┴────────┬──────────────┬─────────────┐
        ▼            ▼                ▼              ▼             ▼
   execution×2   afternoon×2      strangle      gamma-blast    agents
   (capital)     (capital)        (capital)      ...           ...
   own brake     own brake        own brake      own brake     own brake
        │            │                │              │             │
        └────────────┴────────┬───────┴──────────────┴─────────────┘
                              ▼
              ┌───────────────────────────────┐
              │  safe-write.js  (28 dependents)│  ← pure leaf, zero deps
              │  instrument-registry.js (10)   │  ← fail-closed
              │  charges.js (5)                │  ← one implementation
              └───────────────────────────────┘

   ABSENT:  AccountLedger · OrderManager · RiskEngine · ExposureEngine
            EventBus · AuditTrail · Replay · Health surface (built, unmounted)
```

---

## Unknown appendix — stated, not guessed

- Max concurrent requests · max polling concurrency · restart time · recovery time — **never instrumented.**
- Whether `afternoon-engine` shares C1. **Same shape, untested. Not claimed.**
- Whether the live feed's `changeOI` shares `oi`'s unit. **Assumed, not evidence.**
- BSE (`SENSEX`, `BANKEX`) `oi_unit`. **Different exchange, different format. UNVERIFIED.**
- Which STT / exchange-txn rate pair is correct (**E1**). Needs the exchange circular. **Do not guess.**
- Whether the volatility risk premium exists. **No literature was read. No claim is made.**

## Evidence appendix

Dependency graph: comment-stripped `require()` scan over 60 in-tree modules → **0 cycles**. My first
scan reported 3; all three were `require()` strings inside **comments**. The scanner read prose. This is
the fourth time in this session that a scanner has done so, and it is recorded here rather than fixed
quietly.

## Official references

`bt-data/bhav/*.csv` — NSE UDiFF F&O bhavcopy, the exchange's official end-of-day file.
No academic paper was consulted. **No research reference is claimed.**
