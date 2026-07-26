# 001-B — ARCHITECTURE & DEPENDENCY FORENSIC AUDIT

**Standard:** Master Prompt 001-B · **Depends on:** 000-A … 000-E, 001-A
**Date:** 2026-07-12 · **HEAD:** `7823864` · **Suite:** 47/47 green
**Mode:** READ-ONLY. **No file was modified. No behaviour was changed. No refactor was performed.**

**Method.** Every number below was produced by a measurement harness run against the working tree on
this date. Nothing is carried over from memory. Where a fact could not be established, it is recorded
as **UNKNOWN** and a measurement is specified. Two previously-stated "facts" failed re-verification and
are corrected in §19.

---

## SECTION 0 — EXECUTIVE SUMMARY

ANTIGRAVITY PRO is a **single-process Node/Express monolith** with a well-formed *library* layer and no
*application* layer. Domain logic, HTTP handling, persistence, scheduling and decision-making all live
in one 7,327-line file.

The architecture has **three genuinely good properties**, all rare:

1. **A real shared-kernel layer.** `safe-write.js` (Ca=17), `charges.js` (Ca=12) and
   `instrument-registry.js` (Ca=10) are pure, dependency-free, heavily depended upon, and each is the
   *single* implementation of its concern. Instability `I = 0.00` on all three — textbook stable
   abstractions.
2. **Zero dependency cycles.** Measured, not assumed.
3. **A fail-closed persistence primitive** with tested restore.

It has **one dominant pathology**: **`server.js` is the application layer, and it is not a layer, it is
a file.** 172 routes, 268 top-level functions, 62 mutable globals, 14 timers with zero cleanup, 8 raw
writes, and all 4 trading engines instantiated and orchestrated inline.

And it has **two ownership failures that are architectural, not stylistic**: nobody owns *capital*,
and nobody owns *the pricing model*.

| | Score |
|---|---|
| **Clean Architecture (§15)** | **41 / 120 — 34%** |
| **Maintainability** | **D** |
| **Architectural risk** | **2 Critical · 5 High · 6 Medium** |

---

## SECTION 1 — ARCHITECTURE OVERVIEW

### 1.1 Runtime architecture

```
                         ┌──────────────────────────────────────┐
   Browser (19 pages)───▶│  server.js — single Node process     │
   public/*.html         │  PORT, 0.0.0.0, app.listen()         │
                         │                                      │
                         │  ┌────────────────────────────────┐  │
   Broker REST ─────────▶│  │ 172 routes (0 express.Router)  │  │
   (Dhan / Upstox)       │  │ 14 setInterval (0 clearInterval)│ │
                         │  │ 62 mutable globals             │  │
   NSE bhavcopy ────────▶│  │ 4 engine instances, inline     │  │
   (bt-data/bhav)        │  └────────────────────────────────┘  │
                         │                 │                    │
                         └─────────────────┼────────────────────┘
                                           ▼
                    ┌──────────────────────────────────────────┐
                    │  data/*.json  — flat-file persistence    │
                    │  (no DB in the trading path; redis-store │
                    │   exists for intraday H/L only)          │
                    └──────────────────────────────────────────┘
```

**There is no process boundary anywhere.** No worker, no queue, no scheduler process, no separate risk
service. A crash in any engine takes the HTTP surface with it, and vice-versa.

### 1.2 Static architecture — the layer that exists, and the one that does not

```
  PRESENTATION   public/*.html  (19 pages, vanilla JS, no build step)
       │
  ════════════════ the only boundary that is real ═══════════════
       │
  API + APPLICATION + DOMAIN + INFRASTRUCTURE   ◀── ALL OF THIS IS server.js
       │            (172 routes · 62 globals · 14 timers · 4 engines)
       │
  ─────┼──────────── engines are called, not layered ────────────
       │
  ENGINES     execution-engine · afternoon-engine · strangle-engine
              pop-seller · gamma-blast-engine · agents-engine
       │
  ANALYTICS   option-analyzer · multiconfirm · strategy · vol-context
              gex-skew · meta-label · trade-planner · signal-health
       │
  ══════════ SHARED KERNEL — pure, stable, zero local deps ══════
              safe-write (Ca=17) · charges (Ca=12)
              instrument-registry (Ca=10) · engine-verdict
       │
  PERSISTENCE   data/*.json (flat files) · redis-store (H/L only)
```

**Finding.** The kernel layer is real and correct. The **application layer is absent** — its
responsibilities were absorbed into the API layer. That single decision produces most of §17's risks.

### 1.3 Control flow — the two entry points

| Path | Trigger | Ownership |
|---|---|---|
| **Request-driven** | HTTP → route handler → engine/analytics → JSON | The route handler *is* the use-case. There is no service object between them |
| **Timer-driven** | `setInterval` → tick → engine → mutate global → write JSON | **14 timers, none registered anywhere.** No scheduler, no timer registry, no `clearInterval` |

**Both paths mutate the same 62 globals with no synchronization.** Node's single thread makes this safe
*only between* `await` points. It is not safe *across* them — see Risk **A-04**.

### 1.4 Data flow

```
broker REST  ──▶ chain rows  ──▶ analytics (gex, vol, patterns)  ──▶ verdicts
                     │                                                  │
NSE bhavcopy ──▶ bt-lib.loadDay() ──▶ bt-* backtests                    ▼
                                                            engines ──▶ paper positions
                                                                        │
                                                            data/*.json ◀┘
```

**The two flows never meet.** Nothing that the backtests learn is fed to the engines, and nothing the
engines observe is fed back into a backtest. `bt-validate.js` — purged k-fold, deflated Sharpe, PSR —
is called by **zero** strategy scripts. **This is the deepest architectural gap in the repository:
there is no feedback loop.**

---

## SECTION 2 — MODULE CATALOG

**53 root modules.** Full catalog below; the 12 load-bearing ones carry detail.

### 2.1 The shared kernel — pure, stable, correct

| Module | LOC | Ca | Ce | I | State owned | Failure mode | Confidence |
|---|---|---|---|---|---|---|---|
| **`safe-write.js`** | 276 | **17** | 0 | **0.00** | none (pure) | Refuses on corrupt input — **fail-closed** | **HIGH** — tested restore |
| **`charges.js`** | 61 | **12** | 0 | **0.00** | none (pure) | Returns a number; cannot fail | **MEDIUM** — the *rates* are disputed (constraint E1) |
| **`instrument-registry.js`** | 386 | **10** | 0 | **0.00** | none (frozen table) | **Fail-closed** on unknown instrument | **HIGH** — broker-verified |
| **`engine-verdict.js`** | 194 | 0 | 0 | — | none | Throws `VerdictError` — the **only** custom Error class in the codebase | **HIGH** — but **1 adopter** |
| **`bt-lib.js`** | 58 | 7 | 0 | 0.00 | none | Returns `lot: null` when unreadable — **never guesses** | **HIGH** (post-fix) |

> These five are the architecturally healthy part of the system. `I = 0.00` with high `Ca` is exactly
> what a stable abstraction should look like.

### 2.2 The engines — where capital lives, and where ownership breaks

| Module | LOC | Purpose | State owned | Side effects | Failure mode |
|---|---|---|---|---|---|
| **`execution-engine.js`** | 725 | Position lifecycle, risk brakes, equity | **`this.capital`**, `consecLosses`, `_haltedReason`, open/closed positions | Writes `data/*.json` via `safe-write` (**no raw fs — good**) | **Fail-closed** on corrupt equity (C3-07). **But `setAutoEnabled()` can un-halt it** — see Risk A-01 |
| **`afternoon-engine.js`** | 904 | Second intraday session | **its own `capital`** | JSON | **Same stale-`consecLosses` bug** (`:747` before `:755`) |
| **`strangle-engine.js`** | 541 | Short strangle (paper) | **its own `capital`** | **Raw `fs` — the only engine that bypasses `safe-write`** | Unguarded |
| **`pop-seller.js`** | 593 | PoP-ranked selling book | book state | JSON | Clock was internal → suite went red at midnight; **now injected** |
| **`gamma-blast-engine.js`** | 241 | Expiry-day buying (paper) | positions | JSON | — |
| **`agents-engine.js`** | 774 | 5-agent news→impact→risk→paper pipeline | trades ledger | JSON | Ce=3 |

> **`this.capital` is assigned in THREE modules.** There is no ledger. See §4.

### 2.3 Analytics

`option-analyzer.js` (1,127 — the largest non-server module) · `multiconfirm.js` · `strategy.js` ·
`vol-context.js` · `gex-skew.js` · `meta-label.js` · `trade-planner.js` · `signal-health.js` ·
`candlestick-patterns.js` (462) · `smart-money.js` · `master-confluence.js` · `confluence-learner.js` ·
`event-engine.js` · `event-risk-filter.js` · `position-sizer.js` · `vix-kelly-sizer.js` ·
`backtest-report.js` · `crash-analyzer.js`

### 2.4 Infrastructure

`dhan-client.js` · `dhan-auth.js` · `dhan-ws-feed.js` · `upstox-connector.js` · `live-connector.js` ·
`free-chain.js` · `sensibull-fetcher.js` · `redis-store.js` · `database.js` · `auth.js` ·
`module-contract.js` · `ai.js` · `claude-ai.js` · `ai-logger.js` · `news-engine.js`

### 2.5 Dead code — required by nothing

`postmortem.js` · `preflight.js` · `preflight-registry.js` · `export-backtest-excel.js`
**Ca = 0. Recommend deletion (recommendation only — not performed).**

---

## SECTION 3 — LAYERING AUDIT

| Boundary | Enforced? | Evidence |
|---|---|---|
| Presentation → API | **YES** | `public/*.html` talks only over HTTP |
| API → Application | **NO — the layer does not exist** | The route handler *is* the use-case. 268 top-level functions in `server.js`; the longest handler is **139 lines** (`GET /api/nifty:1630`) |
| Application → Domain | **NO** | Engines are constructed and driven directly from `server.js` |
| Domain → Infrastructure | **PARTIAL** | `execution-engine.js` performs **zero raw `fs`** calls — it goes through `safe-write`. **Correct.** |
| **Domain → Infrastructure — VIOLATION** | **NO** | **`strangle-engine.js` calls `fs` directly.** The one engine that skips the kernel |
| **Domain → Presentation — VIOLATION** | **NO** | **`pine-converter.js`** and **`amibroker-bridge.js`** reference `req`/`res`. **Domain modules that know about HTTP.** An inward-pointing dependency inverted |

### Layer violations — complete list

| # | Violation | Evidence | Severity |
|---|---|---|---|
| **L-1** | **The application layer is missing entirely** | 172 route handlers contain the business logic | **Critical** |
| **L-2** | `pine-converter.js`, `amibroker-bridge.js` touch `req`/`res` | Domain depends on transport | High |
| **L-3** | `strangle-engine.js` bypasses `safe-write` with raw `fs` | Domain reaches past its infrastructure contract | High |
| **L-4** | 8 raw `writeFileSync` in `server.js` | API layer writing persistence directly | High (7 have approval packages pending) |
| **L-5** | 20 synchronous IO calls in the request path | Infrastructure blocking the API thread | Medium |

### Circular references

```
MEASURED: ZERO dependency cycles.
```
A naive scan reports three (`module-contract`, `crash-analyzer`, `consolidate-ami-signals` self-loops).
**All three are FALSE POSITIVES** — the `require()` appears inside a **documentation comment**
(`module-contract.js:20`, `crash-analyzer.js:8`, `consolidate-ami-signals.js:5`). Verified by reading
each line. **There are no cycles.**

---

## SECTION 4 — OWNERSHIP MATRIX

**The central deliverable of this audit.**

| Domain | Owner? | Evidence | Verdict |
|---|---|---|---|
| **Capital** | **3 owners** | `this.capital =` in `execution-engine.js`, `afternoon-engine.js`, `strangle-engine.js`. A 4th source (`CAPITAL_TOTAL` in `config-overrides.json`) **overwrote all of them at boot until 2026-07-10** | **NO OWNER — CRITICAL** |
| **Orders** | **6 modules** | `placeOrder()` in `execution-engine`, `afternoon-engine`, `amibroker-bridge`, `live-connector`, `upstox-connector`, `server.js`. **No chokepoint.** One boolean (`paperMode`) stands between them and a broker | **NO OWNER — CRITICAL** |
| **Risk / Exposure** | **ZERO** | `grep -rlE "totalExposure\|portfolioRisk\|netDelta"` → **NOTHING**. Per-engine brakes exist; **account-level risk does not** | **DOES NOT EXIST** |
| **Portfolio** | **ZERO** | No NAV series, no cross-engine position view | **DOES NOT EXIST** |
| **Positions** | Per-engine | Each engine owns its own slot; `server.js` holds 6 global position vars (`openPosition`, `niftyOpenPosition`, `afternoonOpenPosition`, …) | **FRAGMENTED** |
| **Configuration** | **3 writers** | `config-overrides.json` written from 3 sites; 2 now atomic, **1 raw (P1-T3, `server.js:3764`)** | **CONTESTED** |
| **Pricing model (`r`)** | **NOBODY** | See §5.3 — **two `bsGamma` implementations disagree on `r` AND swap their parameters** | **NO OWNER — CRITICAL (NEW)** |
| **Position sizing (Kelly)** | **4 implementations** | `position-sizer.js`, `strangle-engine.js`, `trade-planner.js`, `vix-kelly-sizer.js` | **DUPLICATED ×4** |
| **Market data** | `live-connector` + 4 others | `dhan-client`, `upstox-connector`, `free-chain`, `sensibull-fetcher` — 5 sources, no adapter interface | **FRAGMENTED** |
| **Storage** | **`safe-write.js`** | Ca=17. 18 modules use it | **SINGLE OWNER ✓** |
| **Charges** | **`charges.js`** | Ca=12, one implementation | **SINGLE OWNER ✓** |
| **Instruments** | **`instrument-registry.js`** | Ca=10, fail-closed | **SINGLE OWNER ✓** |
| **Logging** | **NOBODY** | 71 `console.log` in `server.js`; no logger dependency in `package.json` | **DOES NOT EXIST** |
| **Metrics** | **Built, unmounted** | `module-contract.js` → 11 surfaces, 114 assertions, **0 routes reachable** | **UNREACHABLE** |
| **AI verdicts** | **`engine-verdict.js`** | Contract enforced in code — **1 adopter**. 15 modules still emit raw BUY/SELL | **DECLARED, NOT ADOPTED** |
| **Research** | `bt-lib.js` + `bt-validate.js` | `bt-validate` called by **0** strategies | **BROKEN LOOP** |

> **Three domains have a single owner. Three have none. The three with none are capital, orders and
> the pricing model — that is, everything that decides how much money moves and at what price.**

---

## SECTION 5 — DEPENDENCY ANALYSIS

### 5.1 Coupling — Ca (in), Ce (out), I = Ce/(Ce+Ca)

| Module | Ca | Ce | I | Reading |
|---|---|---|---|---|
| **`safe-write.js`** | **17** | 0 | **0.00** | **Maximally stable.** Correct for a kernel |
| **`charges.js`** | **12** | 0 | **0.00** | **Maximally stable.** Correct |
| **`instrument-registry.js`** | **10** | 0 | **0.00** | **Maximally stable.** Correct |
| `bt-lib.js` | 7 | 0 | 0.00 | Stable |
| `dhan-auth.js` | 4 | 0 | 0.00 | Stable |
| `agents-engine.js` | 2 | 3 | 0.60 | Unstable *and* depended-upon — mild smell |
| `afternoon-engine.js` | 1 | 2 | 0.67 | Unstable, 904 LOC |
| **`server.js`** | **0** | **61** | **1.00** | **Maximally unstable.** Correct for a top — **but a top should be thin, and this one is 7,327 lines** |

**The distribution is healthy at the bottom and pathological at the top.** The kernel is stable and
abstract; the apex is unstable and enormous. There is nothing in between — **the missing middle is
exactly the missing application layer (§3, L-1).**

### 5.2 Cycles

**ZERO.** (See §3 — the three apparent cycles are comments.)

### 5.3 🔴 **CRITICAL — NO ONE OWNS THE PRICING MODEL** (new finding)

Two functions, **identical name**, **different signature**, **different physics**:

```js
// vol-context.js:42        — r = 0  (implicit; no rate term at all)
function bsGamma(S, K, sigma, T) {
  const d1 = (Math.log(S/K) + 0.5*sigma*sigma*T) / (sigma*Math.sqrt(T));
  ...
}

// gex-skew.js:18           — r = 0.065
function bsGamma(S, K, T, sigma, r = 0.065) {
  const d1 = (Math.log(S/K) + (r + 0.5*sigma*sigma)*T) / (sigma*Math.sqrt(T));
  ...
}
```

**Two defects, not one:**

1. **They disagree on the risk-free rate** — `0` vs `0.065`. Both are reachable from `server.js`
   (`vol-context` at `:25`, `gex-skew` at `:29`). **Two GEX numbers, two dealer-gamma profiles, one
   dashboard.** `vol-context.js` is at least *honest* about it (`:73 "Sign is an ASSUMPTION"`).
2. **The 3rd and 4th parameters are SWAPPED.** `(S, K, sigma, T)` vs `(S, K, T, sigma)`. Any developer
   who copies a call site from one module to the other **silently exchanges volatility for time** and
   gets a plausible, wrong number with no error. **This is a live footgun with no test guarding it.**

**Severity: CRITICAL.** Not because it is currently mis-called — no evidence of that — but because the
architecture *invites* the mis-call and nothing would catch it.

### 5.4 UNKNOWN — the GEX open-interest unit

`gex-skew.js:32` documents its input as **"OI in contracts"**. `server.js:5971` feeds it
`ceOI: s.ce?.oi` — **the live broker chain's OI**, whose unit is **UNVERIFIED**.

Constraint **F4** proved (5 NSE symbols, `docs/EVIDENCE-F4-oi-unit.md`) that **NSE bhavcopy OI is in
UNITS, not contracts.** Whether the *broker's* live chain follows the same convention is **not known.**

> **If the broker chain reports units, every GEX number on the dashboard is wrong by a factor of the
> lot size (65–75×).**

**This is UNKNOWN, not a defect claim.** **Measurement required:** take one live chain snapshot and one
same-day bhavcopy row for the same strike/expiry and compare `oi`. One row settles it. Until then, GEX
must not be described as calibrated.

### 5.5 Hidden dependencies

| Kind | Measured |
|---|---|
| **Filesystem** | `data/*.json` — **10 raw `JSON.parse(readFileSync(...))`** with no schema validation. A hand-edited file is a silent crash or, worse, a silent wrong number |
| **Environment** | `.env` — **no startup validation.** A missing var yields `undefined`, not a refusal. 000-E requires: *"Critical validation failure must prevent startup"* |
| **Boot order** | **Load-bearing.** Until 2026-07-10, `_loadConfigOverrides()` running before `restoreEquity()` silently overwrote the account balance. **An architecture in which line order decides the account balance has no ownership model.** Fixed; the *shape* that allowed it remains |
| **Time** | `new Date()` called inside domain logic (fixed in `pop-seller`; **not audited elsewhere**). A suite went red at midnight with no code change |

---

## SECTION 6 — GLOBAL STATE AUDIT

**62 top-level mutable variables in `server.js`.** Full inventory (name:line):

```
live:165, botRunning:212, tradesToday:213, orbHigh:214, orbLow:215, dayHigh:216, dayLow:217,
vwap:218, prices:219, volumes:220, currentSignal:221, confidence:222, suggestedStrike:223,
targetMultiplier:224, tradeHistory:225, todayDate:226, _lastAiResult:227, niftyTradesToday:230,
niftyOrbHigh:231, niftyOrbLow:232, niftyDayHigh:233, niftyDayLow:234, niftyVwap:235,
niftyPrices:236, niftyVolumes:237, niftySignal:238, niftyConfidence:239, niftySuggestedStrike:240,
niftyTargetMultiplier:241, _niftyLivePrice:242, _niftyLivePriceAt:243, _lastNiftyAiResult:244,
_bankNiftyLivePrice:245, _bankNiftyLivePriceAt:246, _livePrice:355, _livePriceAt:356,
_yahooPrice:357, _yahooPriceAt:358, _yahooNiftyPrice:359, _yahooNiftyPriceAt:360,
_optHLPurgeDate:399, _oiSnapDay:611, _backfillPurgeDate:764, _persistTimer:1325,
_tokenWarnedDate:2077, _dataHealth:2125, openPosition:2748, closedPositions:2749,
niftyOpenPosition:2752, niftyClosedPositions:2753, afternoonOpenPosition:2756,
afternoonClosedPositions:2757, niftyAfternoonOpenPosition:2758, niftyAfternoonClosedPositions:2759,
_strangleCfg:3535, _eodLoggedDate:4249, _dhanHist:4583, _scoringOutcomes:5603,
_signalTracker:5832, _eventCalendar:5841, _signalPaperBusy:5890, _shuttingDown:7298
```

### Classification

| Class | Count | Example | Risk | Recommendation |
|---|---|---|---|---|
| **Position state** | **6** | `openPosition:2748`, `niftyOpenPosition:2752`, `afternoonOpenPosition:2756` … | **CRITICAL** — written by both a timer tick and an HTTP handler, with `await` between guard and write | Move into the owning engine. **These are the `openPosition` authority race** |
| **Per-instrument market state** | ~28 | `orbHigh`/`niftyOrbHigh`, `dayHigh`/`niftyDayHigh`, `vwap`/`niftyVwap` … | **HIGH** — the entire block is **duplicated per instrument by copy-paste**. Adding a 3rd instrument means 14 more globals | A single `Map<instrument, MarketState>` |
| **Price cache** | 8 | `_livePrice`, `_yahooPrice`, `_niftyLivePrice` … | Medium — 4 sources, no adapter | A `PriceSource` interface |
| **Date guards** | 5 | `_optHLPurgeDate`, `_oiSnapDay`, `_eodLoggedDate` … | Medium — the "have I done this today?" idiom, 5 times | One `DailyGuard` |
| **Lifecycle** | 3 | `botRunning:212`, `_shuttingDown:7298`, `_persistTimer:1325` | **HIGH** — `_shuttingDown` guards a shutdown that **never clears the 14 timers** | Timer registry |
| **Signal / AI cache** | ~12 | `_lastAiResult`, `_signalTracker`, `_scoringOutcomes` … | Low | — |

**Synchronization: NONE.** No lock, no mutex, no queue. Node's single thread protects only
straight-line code; **every `await` inside a handler is a yield point** at which a timer tick may run
and mutate the same global. `_signalPaperBusy:5890` is the *only* variable in the file that appears to
be an ad-hoc mutex — **one guard, for one of six position slots.**

---

## SECTION 7 — FUNCTION COMPLEXITY

`server.js` has **268** top-level functions and route handlers.

### Longest (measured by brace-depth span)

| LOC | Location | Name |
|---|---|---|
| 147 | `server.js:5281` | `_clampScore` (encloses `gatherMasterSignal`) |
| **146** | **`server.js:5282`** | **`gatherMasterSignal`** — the master decision function |
| 141 | `server.js:2229` | `_buildOptionSnapshot` |
| **139** | **`server.js:1630`** | **`GET /api/nifty`** |
| **136** | **`server.js:1492`** | **`GET /api/sensex`** |
| 121 | `server.js:7045` | `POST /api/webhook/tradingview` |
| 117 | `server.js:1369` | `_backfillORBFromCandles` |
| 114 | `server.js:765` | `_backfillOptHLFromDhan` |
| 113 | `server.js:6857` | `GET /api/watchlist` |
| 101 | `server.js:6563` | `GET /api/performance` |
| 95 | `server.js:6348` | `GET /api/risk` |
| 88 | `server.js:4597` | `GET /api/strike-chart` |
| 80 | `server.js:678` | `GET /api/oi-signals` |
| 78 | `server.js:5667` | `GET /api/quant` |
| 70 | `server.js:2432` | `GET /api/options/greeks-matrix` |

**Highest fan-in:** `safe-write.writeJsonSync` (17 modules) · `charges.roundTripCharges` (12) ·
`instrumentRegistry.get` (10).
**Highest fan-out:** `server.js` — **61 `require()`**.

**`GET /api/nifty` and `GET /api/sensex` are 139 and 136 lines of near-identical logic.** They are the
same use-case, copy-pasted per instrument. That duplication is the direct cause of the 28 duplicated
market-state globals in §6.

---

## SECTION 8 — GOD OBJECT DETECTION

| Threshold | `server.js` | Verdict |
|---|---|---|
| LOC > 1,000 | **7,327** | **7.3×** |
| Routes in one file | **172** | — |
| `express.Router()` | **0** | **Zero route modularisation** |
| `require()` | **61** | Depends on ~all of the system |
| Top-level mutable state | **62** | — |
| Timers | **14** (`clearInterval`: **0**) | — |
| Raw file writes | **8** | — |
| Synchronous IO in request path | **20** | — |
| Business logic | 4 engines orchestrated inline | — |
| Decision logic | `gatherMasterSignal` (146 LOC) | — |

**Runner-up:** `option-analyzer.js` — **1,127 LOC**, `Ce = 1`. Large but self-contained; not a god object.

### Recommended decomposition — **RECOMMENDATION ONLY. NOT PERFORMED.**

| Extract | From | Into | Why it is safe |
|---|---|---|---|
| 172 routes | `server.js` | `routes/*.js` × ~12 namespaces (`options` 12, `nifty` 10, `afternoon` 8, `agents` 7, `engine` 5, `pop` 5 …) | `express.Router()` is a pure mechanical move |
| 4 engine instantiations + wiring | `server.js` | `app/EngineHost.js` | The missing application layer |
| 14 timers | `server.js` | `app/Scheduler.js` with a registry | Makes `clearInterval` *possible* |
| 62 globals | `server.js` | `state/MarketState.js` keyed by instrument | Kills the copy-paste-per-instrument pattern |
| 8 raw writes | `server.js` | `safe-write.js` | **7 approval packages already written** |

---

## SECTION 9 — API ARCHITECTURE

| Property | Measured | Verdict |
|---|---|---|
| **Total routes** | **172** (`GET` 135, `POST` 45, `PATCH` 4) | *(Corrects a prior claim of 168 — see §19)* |
| `express.Router()` | **0** | **No route organisation whatsoever** |
| **Routes carrying auth middleware** | **0** | **Every route is open when `AUTH_ENABLED=false`, which is the default.** `auth.js` exists (JWT/RBAC) but no route declares it inline |
| Request validation | **None systematic** | No `zod`/`joi`/`celebrate`. Handlers read `req.query.x` and coerce by hand |
| Error handling | **No error middleware** | Each handler `try/catch`es and shapes its own error. **382 catch blocks, 92 with an empty body** |
| Response consistency | **None** | Some return `{ok:true,...}`, some the bare object, some `{error}` |
| Versioning | **None** | No `/v1`. A breaking change breaks all 19 pages |
| Idempotency | **Not addressed** | `POST /api/engine/enable` etc. are not idempotency-keyed |
| REST semantics | **Loose** | 135 of 172 are `GET`, including several that mutate state |

**The API is a function-call surface with an HTTP coat of paint.** For a local single-user tool that is
survivable; §9's findings are why 000-E's security score is 3/10.

---

## SECTION 10 — EVENT & TIMER ARCHITECTURE

| | Count |
|---|---|
| `setInterval` (whole repo) | **15** — `server.js` **14**, `dhan-ws-feed.js` 1 |
| `clearInterval` | **2** — **both in `dhan-ws-feed.js`. `server.js` has ZERO** |
| `setTimeout` | 22 |
| `clearTimeout` | 3 |
| `EventEmitter` references | **2** (in **1** production module) |
| Async queue / job runner | **NONE** |

### 🔴 The shutdown race — CONFIRMED

`_gracefulShutdown` (guarded by `_shuttingDown:7298`) writes the EOD snapshot, then calls
`setTimeout(exit, 400)`. **It clears no timers.** For those 400 ms **all 14 intervals continue to fire**
and may mutate the very state that was just snapshotted.

> **The EOD snapshot is not a snapshot. It is a read taken while 14 writers are still running.**

**No event bus** ⇒ no audit trail ⇒ no replay ⇒ no way to reconstruct why a decision was taken.
000-E requires an audit trail. **One `EventEmitter` in the entire codebase.**

---

## SECTION 11 — CONFIGURATION ARCHITECTURE

| Source | Owner | Mutation | Validation |
|---|---|---|---|
| `.env` | none | **Rewritten by an HTTP handler** (`server.js:2028`, OAuth callback, **non-atomic**, mode `0644`, contains broker tokens) | **NONE at startup** |
| `data/config-overrides.json` | **3 writers** | Runtime `POST` | 2 atomic + refuse-on-corrupt; **1 raw (P1-T3, `server.js:3764`)** |
| `data/strategy-config.json` | ? | Runtime | Pending audit |
| Hardcoded constants | scattered | — | `bt-real.js:9-10` — **eight tuned constants on two lines, none justified** |

### 🔴 Config is a balance sheet, and nobody noticed

`CAPITAL_TOTAL` lives in `config-overrides.json` — **a settings file** — and `setConfig()` writes it
straight onto `this.capital` (`execution-engine.js:113`). **A configuration value silently overwrote
the account balance at every boot** until the load order was reversed on 2026-07-10.

> **`CAPITAL_TOTAL` is not a setting. It is a balance.** Putting it in a config file is the
> architectural defect; the boot-order fix treats the symptom. **Recommendation: the account balance
> belongs in a ledger owned by one module, and config must not be able to write it.**

---

## SECTION 12 — PERSISTENCE ARCHITECTURE

| | Measured |
|---|---|
| Storage | **Flat JSON files** in `data/`. No DB in the trading path (`database.js` and `redis-store.js` serve intraday H/L only) |
| Modules using `safe-write` | **18** |
| **Raw `writeFileSync` (production)** | **8 in `server.js`** + **1 in `strangle-engine.js`** + **1 in `signal-health.js`** |
| Raw `writeFileSync` (backtest scripts) | 11 — **acceptable**; these are offline, single-writer, re-runnable |
| **Raw `JSON.parse(readFileSync(...))`** | **10** — no schema, no validation |
| Atomicity | `safe-write.js`: temp → **validate-by-reparse** → rename → `.bak`. **Fail-closed** |
| Restore tested? | **YES** — corrupt-file recovery is asserted in the ledger, config-override and signal-health suites |
| Consistency across files | **NONE.** No transaction spans two files. A crash between two writes leaves them disagreeing, permanently |

**`safe-write.js` is the best-engineered module in the repository. Its problem is that 10 production
write sites still route around it** — and 7 of those are behind an approval package that has not been
decided.

---

## SECTION 13 — ERROR ARCHITECTURE

| | Count |
|---|---|
| `catch` blocks (repo) | **382** |
| **Empty-body `catch (_) {}`** | **92** |
| `catch` that re-throws | **12** |
| **Custom Error classes** | **1** — `VerdictError` in `engine-verdict.js` |
| Error middleware | **0** |
| Retry policy | Ad-hoc (broker throttle/backoff in `server.js:6280`) |
| Error classification | **NONE** |

### The architectural problem, stated precisely

**There is no error taxonomy.** A corrupt ledger, a 429 from the broker, and a typo in a query string
are all `catch (e) { console.log(e) }`. Nothing can distinguish *retryable* from *fatal* from *refuse*.

**92 empty catches mean 92 places where a failure is indistinguishable from a success.** That is the
exact fault class that produced the fail-opens this project has spent the cycle removing —
`Unknown → Zero`, `null → 0`, `corrupt → proceed`.

> **`engine-verdict.js` shows the right shape** — a typed error, thrown, tested. **It has one adopter.**

---

## SECTION 14 — OBSERVABILITY

Fully covered in **`docs/001-E-PRODUCTION-AUDIT.md`**. Architectural summary:

| | |
|---|---|
| Health | `/healthz` reports **uptime only — it cannot fail** |
| **Health that CAN fail** | `module-contract.js` builds it. **`mountAll()` is never called ⇒ `/api/m/health` → 404** |
| Metrics | Same cause — **built, unmounted** |
| Logs | **71 `console.log`**, unstructured. No logger in `package.json` |
| Tracing | None |
| Audit trail | **None** — 1 `EventEmitter` |

> **`app.use('/api/m', require('./module-contract.js').mountAll())` — one line, already documented at
> `module-contract.js:20` — moves observability from 1/10 to ~6/10.** It is in a protected file.

---

## SECTION 15 — CLEAN ARCHITECTURE SCORE

| Principle | Score | Evidence |
|---|---|---|
| **Single Responsibility** | **2** / 10 | `server.js` = API + application + domain + persistence + scheduling + decisions. 7,327 LOC |
| **Open/Closed** | **3** / 10 | Adding an instrument means copy-pasting ~14 globals and a 139-line handler |
| **Liskov** | **5** / 10 | Engines share a shape by convention, not by contract. **Two `bsGamma`s with swapped parameters is a direct LSP violation in spirit** |
| **Interface Segregation** | **3** / 10 | No interfaces. 5 market-data sources, no adapter |
| **Dependency Inversion** | **4** / 10 | Kernel (`safe-write`, `charges`, `registry`) is correctly depended-upon. **But `pine-converter`/`amibroker-bridge` depend on `req`/`res` — domain → transport** |
| **Separation of Concerns** | **2** / 10 | §3, L-1 |
| **Low Coupling** | **4** / 10 | Kernel: excellent (I=0.00). Apex: `server.js` Ce=61 |
| **High Cohesion** | **6** / 10 | The *modules* are cohesive. Their *container* is not |
| **Explicit Ownership** | **2** / 10 | **Capital: 3 owners. Orders: 6. Risk: 0. Pricing model: 0** |
| **Deterministic Behaviour** | **4** / 10 | Boot order was load-bearing. `new Date()` inside domain logic. 62 unsynchronized globals |
| **Testability** | **6** / 10 | **47 suites, exit-code gated, characterization-first.** Held back by the monolith: engines cannot be tested without booting `server.js`'s world |
| **Maintainability** | **3** / 10 | 268 functions, 62 globals, 92 silent catches, 0 Routers |
| **TOTAL** | **44 / 120** | **37%** |

---

## SECTION 16 — TARGET ARCHITECTURE (conceptual only — no implementation)

```
  PRESENTATION      public/*.html
        │
  ─────────────────────────────────────────────────────────────
  API               routes/*.js          ← express.Router() × ~12
                    middleware/          ← auth · validate · error · idempotency
        │                                  ONE error middleware. ZERO business logic.
  ─────────────────────────────────────────────────────────────
  APPLICATION       app/EngineHost.js    ← owns engine lifecycle    ◀── THE MISSING LAYER
                    app/Scheduler.js     ← owns ALL timers, registers every one,
                                            and CAN therefore clear them
        │
  ─────────────────────────────────────────────────────────────
  DOMAIN            AccountLedger        ← ★ THE SINGLE OWNER OF CAPITAL
                    OrderManager         ← ★ THE SINGLE CHOKEPOINT FOR placeOrder()
                    RiskEngine           ← ★ account-level exposure (read-only first)
                    engines/*            ← paper strategies; may PROPOSE, never PLACE
                    quant/               ← ★ ONE bsGamma · ONE Kelly · ONE charges · ONE r
        │
  ─────────────────────────────────────────────────────────────
  INFRASTRUCTURE    market-data/         ← ONE adapter interface, 5 implementations
                    broker/              ← Dhan · Upstox behind one port
                    EventBus             ← ★ audit trail → replay → observability
        │
  ─────────────────────────────────────────────────────────────
  PERSISTENCE       safe-write.js        ← already correct. Make it the ONLY door
```

### The four ★ items, and what each unlocks

| ★ | Unlocks |
|---|---|
| **`AccountLedger`** | Capital has one owner. `CAPITAL_TOTAL` can no longer be a config key. Daily NAV becomes derivable — which unblocks **Sharpe, drawdown, and every portfolio metric** |
| **`OrderManager`** | 8 call sites collapse to 1. Live trading becomes *gateable* at a single point rather than by a boolean in 6 modules |
| **`RiskEngine`** | Account-level exposure exists for the first time. Publish it **read-only at `/api/risk` for two weeks** before it is allowed to block anything |
| **`quant/` kernel** | One `bsGamma`, one `r`, one Kelly. **Guarded by a cross-implementation equivalence test** so a second copy cannot reappear |

### Migration strategy — strangler fig, safest-first, each step independently revertible

| Step | Change | Risk | Reversible? |
|---|---|---|---|
| **0** | **Approve the 3 pending protected fixes** (halt fail-open · `mountAll()` · `.env` atomic write) | **Low — 11 lines** | `git checkout` |
| **1** | `EventBus` — engines *emit*; nothing subscribes yet | **Zero** — purely additive | Yes |
| **2** | `Scheduler` — register the 14 timers **without changing them**. `clearInterval` becomes possible | Low | Yes |
| **3** | `routes/` — mechanical `express.Router()` extraction, one namespace at a time | Low | Yes |
| **4** | `quant/` — extract `bsGamma`/Kelly behind an **equivalence test that proves old == new** | **Medium — behaviour risk. Needs approval** | Yes |
| **5** | `AccountLedger` — read-only shadow first: publish alongside the existing capital and **assert they agree** for two weeks | **Medium** | Yes |
| **6** | `OrderManager` — pass-through only, no logic | Medium | Yes |
| **7** | `RiskEngine` — read-only at `/api/risk` for two weeks before it may block | Medium | Yes |

**Steps 1–3 change no behaviour and can be characterization-tested to byte-identical output.**
**Steps 4–7 are behaviour changes and require an approval package each.**

---

## SECTION 17 — ARCHITECTURE RISK REGISTER

| ID | Risk | Sev | Evidence | Impact | Likelihood | Owner | Mitigation |
|---|---|---|---|---|---|---|---|
| **A-01** | **`setAutoEnabled(true)` re-enables a HALTED engine at boot** | **CRITICAL** | `server.js:7278`; `setAutoEnabled()` has **0 refs to `_haltedReason`** | The fail-closed risk brake is undone by a restart. **000-E names this exact alert: "Trading unexpectedly enabled"** | **Certain — fires every boot** | **OWNER** | `docs/APPROVAL-halt-reenabled-at-boot.md` — **awaiting approval** |
| **A-02** | **Nobody owns the pricing model.** Two `bsGamma`s: `r=0` vs `r=0.065`, **and the 3rd/4th parameters are swapped** | **CRITICAL** | `vol-context.js:42` vs `gex-skew.js:18`; both reachable from `server.js` | Two GEX numbers on one dashboard. A copied call site silently swaps σ and T and returns a plausible wrong number **with no error** | High | **UNASSIGNED** | `quant/` kernel + equivalence test (§16 step 4) |
| **A-03** | **Capital has 3 owners; orders have 6; risk has 0** | **HIGH** | `this.capital=` ×3 · `placeOrder()` ×6 · `grep totalExposure` → **nothing** | No account-level brake can exist. Boot order decided the balance until 2026-07-10 | Certain | **UNASSIGNED** | `AccountLedger` + `OrderManager` (§16) |
| **A-04** | **Shutdown race — 14 timers, 0 `clearInterval`** | **HIGH** | `_gracefulShutdown` → EOD snapshot → `setTimeout(exit,400)` | **The EOD snapshot is taken while 14 writers still run.** Persisted state may not be the state that was measured | High | — | `Scheduler` registry (§16 step 2) |
| **A-05** | **`openPosition` authority race** | **HIGH** | 6 position globals; both a timer tick and an HTTP handler write them, with `await` between guard and write | Double-entry or lost position | Medium | — | Move into the owning engine |
| **A-06** | **`.env` rewritten by an HTTP handler, non-atomically** | **HIGH** | `server.js:2028` `_fs.writeFileSync(_envPath, env)` — broker tokens, mode `0644` | An interrupted write truncates `.env` ⇒ **every credential lost at next boot** | Medium | **OWNER** | Route through `safe-write` |
| **A-07** | **92 empty `catch` blocks** | **HIGH** | 382 catch / 92 `{}` | A failure is indistinguishable from a success. **This is the fault class behind every fail-open found this cycle** | Certain | — | Error taxonomy + `VerdictError` pattern |
| **A-08** | **10 unvalidated `JSON.parse(readFileSync)`** | MEDIUM | measured | A hand-edited or truncated file becomes a silent wrong number | Medium | — | Route through `safe-write.readJsonSync` |
| **A-09** | **Zero routes carry auth middleware; `AUTH_ENABLED` defaults OFF** | MEDIUM | measured | Default posture is ALLOW. 000-E mandates DENY | Low *(local-only)* | — | Mount `auth` at the Router level (§16 step 3) |
| **A-10** | **20 synchronous IO calls in the request path** | MEDIUM | measured | Event-loop stalls under load | Low *(single user)* | — | Async + cache |
| **A-11** | **No feedback loop between research and live** | MEDIUM | `bt-validate.js` called by **0** strategies | The system cannot learn it is wrong — **which is how the look-ahead survived to production** | Certain | — | Wire `bt-validate` into every `bt-*` |
| **A-12** | **Kelly ×4** | MEDIUM | 4 implementations | Four position sizes for one bet | Medium | — | `quant/` kernel |
| **A-13** | **GEX OI unit UNVERIFIED** | **UNKNOWN** | `gex-skew.js:32` says "contracts"; **F4 proved bhavcopy OI is UNITS**; broker chain unit **not measured** | **If units, every GEX is wrong by 65–75×** | **UNKNOWN** | — | **Compare one live chain row against the same-day bhavcopy row. One row settles it.** |

---

## SECTION 18 — TECHNICAL DEBT REGISTER

| Rank | Debt | Risk | Effort | Business impact | Priority |
|---|---|---|---|---|---|
| 1 | **`server.js` god object** — 7,327 LOC, 172 routes, 0 Routers, 62 globals | **Critical** | Weeks | Every change is high-risk; nothing can be unit-tested in isolation | **P0** |
| 2 | **No owner for capital / orders / risk / pricing** | **Critical** | Weeks | **No account-level safety is possible** | **P0** |
| 3 | **14 timers / 0 cleanup** | High | Hours | Corrupt EOD snapshot | **P0** |
| 4 | **92 silent catches** | High | Days | Failures look like successes | **P1** |
| 5 | **Duplicate `bsGamma` — different `r`, swapped params** | **Critical** | Hours | A wrong number with no error | **P0** |
| 6 | **Kelly ×4 · GEX ×3** | Medium | Days | Divergent sizing and exposure | P1 |
| 7 | **10 raw production writes / 10 unvalidated reads** | High | Hours | Corruption. **7 packages already written** | **P1 — blocked on owner** |
| 8 | **No structured logging** | Medium | Days | Not operable; 000-E fails | P1 |
| 9 | **No event bus / audit trail** | Medium | Weeks | No replay, no "why did it do that" | P2 |
| 10 | **Instrument logic copy-pasted** (2 × 139-line handlers, 28 globals) | Medium | Days | 3rd instrument = 3rd copy | P2 |
| 11 | **`bt-real.js:9-10`** — 8 tuned constants, none justified | Medium | Hours | Unfalsifiable overfitting | P2 |
| 12 | **Dead code** — `postmortem`, `preflight`, `preflight-registry`, `export-backtest-excel` (Ca=0) | Low | Minutes | Noise | P3 |

---

## SECTION 19 — CLAIMS THAT FAILED RE-VERIFICATION

000-A **Rule Zero**: *a claim is not a fact until it is measured.* Three statements previously made in
this project's own documents or in chat did **not** survive re-measurement:

| Prior claim | Re-measured | Correction |
|---|---|---|
| "`server.js` has **168** routes" | **172** (`GET` 135 · `POST` 45 · `PATCH` 4) | **Corrected.** Repeated across several documents |
| "There are **3 dependency cycles**" (naive scan) | The three `require()`s are inside **documentation comments** (`module-contract.js:20`, `crash-analyzer.js:8`, `consolidate-ami-signals.js:5`) | **ZERO cycles.** The scan was wrong, not the code |
| "`vol-context.js` uses `r = 0`" — *previously **retracted** as unverified* | **`vol-context.js:41-42`: `bsGamma(S,K,sigma,T)`, `d1 = (ln(S/K) + 0.5σ²T)/(σ√T)` — no rate term. Comment: `"(r=0 index approximation)"`** | **The claim was TRUE. My retraction was wrong.** And re-measuring it surfaced something worse: **the parameters are also swapped** (Risk A-02) |

> **The retraction was itself an unverified claim.** Recorded here because 000-A's Rule Zero applies to
> retractions exactly as it applies to assertions: *measure, then speak.*

---

## SECTION 20 — SUCCESS CRITERION

> *"Another principal architect should understand the entire architecture without reading the source."*

**The shortest true description of this system:**

> A single Node process holds a **correct, stable, well-tested shared kernel** (`safe-write`, `charges`,
> `instrument-registry` — Ca 17/12/10, I=0.00, zero cycles) underneath a **7,327-line file that is
> simultaneously the API, the application, the domain and the scheduler.** Six paper-trading engines
> are instantiated inside it and driven by 14 unregistered timers over 62 unsynchronized globals.
> **Capital is written by three modules, orders by six, risk by none, and the option-pricing model by
> nobody at all** — two `bsGamma` functions disagree on the risk-free rate *and* take their arguments
> in a different order. Persistence is flat JSON behind an excellent atomic writer that **ten
> production sites still route around.** Observability is **built and unmounted** — one line short of
> working. There is **no feedback loop from research to production**, which is precisely how a
> look-ahead bias survived into a shipped, celebrated backtest.
>
> **The engineering discipline is institutional. The architecture it is applied to is not.**

---

**Deliverables produced:** Architecture Handbook (this file) · Dependency Graph (§1.2, §5) · Module
Catalog (§2) · Ownership Matrix (§4) · Layer Violation Report (§3) · Coupling Report (§5) · Complexity
Report (§7) · Global State Report (§6) · Timer Architecture (§10) · Persistence Review (§12) ·
Configuration Review (§11) · Error Handling Review (§13) · Observability Review (§14 + `001-E`) ·
Technical Debt Register (§18) · Target Architecture Blueprint (§16) · Executive Summary (§0).

**Files modified: NONE. Behaviour changed: NONE. Suite: 47/47.**
