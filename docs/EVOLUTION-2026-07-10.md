# SELF-EVOLUTION SCAN — 2026-07-10

Every line below is **Measured**, **Verified**, or **Unknown**. No code was written. Suite 46/46.

**The scan happened on the day the platform's central claim was invalidated**
(`docs/REVIEW-selling-edge-invalidated.md`). That changes what "evolution" means. The answer to *"what
should exist next"* is no longer a feature list.

---

## 0. THE FINDING THAT REORDERS EVERYTHING

**MEASURED.** The selling edge — the reason `strangle-engine.js`, `pop-seller.js` and
`STRANGLE_CAPITAL: 700000` exist — rests on `bt-strangle-costs.js`, which selects strikes from the
**closing** price of the day it trades and sells them at that day's **open**.

```
A shipped (look-ahead)   129 trades   88.4% win   PF 7.41   +₹3,65,579
B no look-ahead          129 trades   46.5% win   PF 0.55   −₹79,899
```

Directional buying was already refuted (PF 0.94). An independent review showed it fails at **PF 0.84
even with look-ahead** (`docs/REVIEW-bt-real-lookahead.md`).

> **Both sides of the book are unsupported by their own backtests.**

Therefore: **building the Risk Engine, the Portfolio Engine, the Volatility Surface, the Meta Decision
Engine or the Feature Store right now would be building infrastructure to run a strategy that does not
work.** Every one of those is *deferred behind evidence*, not behind engineering.

---

## 1. READINESS SCORES — each with its measurement

| dimension | score | measurement |
|---|---|---|
| **Quant Readiness** | **F** | Both edge claims invalidated. `bt-lib.js:18` publishes a closing price named `underlying`; `bt-lib.js:12` hardcodes `LOT = 75`, wrong on **59.3%** of 600 days. `bt-validate.js` exists (purged k-fold, deflated Sharpe, PSR — 12 references) and is used by **zero** strategy scripts. |
| **Risk Readiness** | **D−** | `grep -rlE "totalExposure\|portfolioRisk\|netDelta"` → **nothing**. No account-level brake. `setAutoEnabled()` re-arms a halted engine (0 references to `_haltedReason`). 8 `placeOrder()` sites, 6 modules, one boolean between them and a broker. |
| **AI Readiness** | **F** | `meta-decision`, `confidence-engine`, `consensus`, `conflict-resolver`, `model-registry`, `feature-store`, `drift-detect` — **all absent**. 55 labelled outcomes; every `reliability` is `null`; a weighted ensemble is mathematically empty. 15 modules still emit BUY/SELL. |
| **Production Readiness** | **F** | `GET /api/m/health` → **404**. `EventEmitter` in **1** production module → no event bus, no replay, no audit trail. `app.listen()`'s return value discarded → `server.close()` unreachable, WebSocket cannot attach. |
| **Institutional Readiness** | **D** | 7,327-line monolith, 168 routes, 0 `express.Router()`, **62 top-level mutable variables**, 20 synchronous IO calls in the request path, 14 `setInterval` / 0 `clearInterval`. |
| **Engineering discipline** | **A−** | 46 suites, exit-code gated. Every fix characterized red first. The process caught its own author three times this session — including the edge invalidation. |

**The discipline is institutional. Nothing it is applied to is.**

---

## 2. WHAT ALREADY EXISTS AND IS UNDERVALUED

**MEASURED.** I got my own inventory wrong before checking. These are **not** missing:

| asset | evidence |
|---|---|
| **Settlement history** | `SttlmPric` non-zero on **1,804 / 1,808** rows, × 600 days |
| **EOD OI history** | `OpnIntrst` non-zero on **1,203** rows, × 600 days |
| **Per-strike daily OHLC** | 990 rows with real H/L, × 600 days |
| **`bt-validate.js`** | purged k-fold, deflated Sharpe, PSR — written, tested, **never called** |
| **`charges.js`** | 12 dependents, one implementation. The only module obeying Article 5. |
| **`instrument-registry.js`** | broker-verified, fail-closed two-surface design |
| **`safe-write.js`** | atomic, `.bak`, validate-by-reparse, fail-closed |
| **`module-contract.js`** | 11 service surfaces from one descriptor, 114 assertions — **0 routes reachable** |
| **`engine-verdict.js`** | contract enforced in code — **1 adopter** |

**≈1.08 million authoritative strike-days sit in `bt-data/bhav/`, and the only script that could
validate a strategy against them has never been run against one.**

The platform's problem is not missing components. **It is unused ones.**

---

## 3. TOP 10 IMMEDIATE — ranked by ROI, all evidence-backed

| # | task | class | evidence | difficulty |
|---|---|---|---|---|
| 1 | **`setAutoEnabled()` refuses to enable a halted engine** | Critical | MEASURED: reproduced; `getHaltStatus()` publishes `halted:true, autoEnabled:true` | 6 lines, protected file |
| 2 | **`bt-lib.js:18` rename `underlying` → `underlyingClose`** | Critical | MEASURED: source of two invalidated backtests | 1 rename |
| 3 | **`bt-lib.js:12` read `NewBrdLotQty` per row, delete `LOT = 75`** | Critical | MEASURED: wrong on 356/600 days | ~5 lines |
| 4 | **Re-run all five `bt-*` strategy scripts through `bt-validate.js`** | Critical | MEASURED: 0 references today | days |
| 5 | **Start capturing intraday chains** | Critical | MEASURED: **1 complete session** exists (375 minutes, 2026-07-08) | 1 module |
| 6 | **`execution-engine` persists `consecLosses` before updating it** | High | MEASURED: brake trips one loss late after every restart | move 6 lines |
| 7 | **`signal-health.saveState()` guards `stateCorrupt`** | High | MEASURED: overwrites a file it logged as "untouched" | 6 lines |
| 8 | **Mount `module-contract.mountAll()`** | High | MEASURED: `/api/m/health` → 404 | **1 line**, protected |
| 9 | **Daily NAV series** | High | MEASURED: **absent**. Gates Sharpe, drawdown, all portfolio work | 1 module |
| 10 | **`DAILY_LOSS` halt is permanent, and the log says "until tomorrow"** | Medium | MEASURED: `_resetIfNewDay()` clears `_haltedReason`, never restores `autoEnabled` | 3 lines |

**Items 2 and 3 together cost under twenty lines and invalidate or revalidate every strategy claim this
platform has ever made. Nothing else on any roadmap outranks them.**

---

## 4. WHAT MUST **NOT** BE BUILT — and why

Each is a headline feature. Each is blocked by evidence that does not exist.

| feature | blocker | classification |
|---|---|---|
| **Volatility Surface / Forecast** | Intraday IV exists for **1 complete session**. 21.7% of live IVs are `ivSource: 'bsm'` — **computed by us**, not observed | Blocked |
| **Dealer Flow / Gamma Exposure** | `oi_unit` now MEASURED (units, 5 NSE symbols). But `gex-skew.js` uses `r = 0.065`, `vol-context.js` uses `r = 0` **and the opposite dealer sign**. **No one owns the pricing model.** | Blocked |
| **Meta Decision Engine** | 55 labelled outcomes. Every `reliability` is `null` ⇒ every weight is 0 ⇒ the ensemble is **mathematically empty**. v1 could only ever return `INSUFFICIENT_DATA` | Blocked |
| **Portfolio / Exposure / Netting** | No daily NAV series. No cross-engine exposure. Would be built on numbers that do not exist | Blocked |
| **Execution / Slippage / Fill / Queue / Latency models** | **Zero tick data.** No order book, ever, at any depth. | Unobservable from current sources |
| **Order Book Replay / Tick Replay** | Same. | Unobservable |
| **Online Learning / Drift Detection** | Drift against what baseline? None is calibrated. | Blocked |
| **Margin Simulator** | SPAN is an exchange risk parameter published daily. **Not captured. Not in bhavcopy.** | Unknown — needs an evidence step |
| **Corporate Actions** | Index options. **Not applicable.** | Not needed |

**Nine of the thirty-two "advanced features" in the brief are unobservable or empty today.** Naming them
on a roadmap without this column would be a fabrication.

---

## 5. TECHNICAL DEBT — measured, not opined

| debt | measurement |
|---|---|
| God object | `server.js` **7,327 lines**, 168 routes, 0 Routers |
| Global mutable state | **62** top-level `let`/`var` in `server.js` |
| Blocking IO in the request path | **20** synchronous `readFileSync`/`writeFileSync`/`execSync` in `server.js` |
| Timer leaks | **14** `setInterval`, **0** `clearInterval` |
| Duplicate logic | Kelly **×4** · GEX **×3** (two disagree on `r` **and** dealer sign) · capital **×4 owners** |
| Magic numbers | `bt-real.js:9-10` — eight tuned constants on two lines, none justified |
| Silent catch | **112** · Raw JSON parse **11** · Raw file write **8** |
| Dead code | `postmortem.js`, `preflight.js`, `preflight-registry.js`, `export-backtest-excel.js` — required by nothing |
| Hardcoded market data | `bt-lib.js:12` `LOT = 75` — contradicts constraint **F1**, which was written about this exact hazard |

---

## 6. ROADMAPS — compressed to what evidence supports

**30 days.** Items 1–10 above. Nothing else. At the end of it, the platform knows whether it has an edge.

**90 days.** Capture intraday chains daily (the only irreversible clock). Grow labelled outcomes 55 → 200
by keeping the paper engines running. Re-derive both edge claims through `bt-validate.js` with the
`underlyingOpen` and per-row lot. **One of two outcomes: a validated edge, or an honest retirement.**

**6 months.** *Conditional on a validated edge only.* `OrderManager` as a pass-through, then read-only
`RiskEngine` publishing exposure at `/api/risk` for two weeks before entering the path. Event bus, then
audit trail, then replay — one investment, three products.

**1 year.** `AccountLedger` as the single owner of capital. `quant/` kernel: one Kelly, one GEX, one
Greeks, one charges — gated by a cross-implementation equivalence test.

**3 and 5 years.** **UNKNOWN.** A five-year roadmap for a platform whose edge was invalidated this
morning would be fiction. It will be written when there is something to project.

---

## 7. THE FINAL QUESTION

> *"If this platform had to compete with Bloomberg, Jane Street, Citadel, Tower, Optiver, IMC, Jump —
> what is still missing?"*

**The question is malformed, and answering it as asked would be the least honest thing in this document.**

Those firms are not competitors on any axis this platform occupies:

- **Jane Street, Citadel, Optiver, IMC, Jump, Tower** are market makers and prop traders. Their edge is
  **capital, colocation, exchange membership, and microsecond latency**. This platform polls a broker's
  REST chain and measured that call at **180 ms end-to-end**. The gap is not a feature list; it is six
  orders of magnitude and a regulatory licence. **No roadmap closes it.**
- **Bloomberg** is a data and distribution business. Competing means licensing the data this platform
  currently scrapes.

**What is missing, stated as evidence:**

| requirement | status |
|---|---|
| Tick data / order book | **Unobservable.** Never captured, at any depth |
| Colocation, exchange membership | **Absent.** Not a software problem |
| Execution: fill probability, queue position, latency model | **Unobservable** without the above |
| An order manager | **Absent.** 8 call sites, no chokepoint |
| A risk engine | **Absent.** No account-level exposure exists |
| A capital ledger | **Absent.** Capital lives in 4 places, and boot order decided the balance until today |
| Daily NAV | **Absent** |
| A validated edge | **Absent** — as of this morning |
| Audit trail, replay | **Absent.** One `EventEmitter` in the whole codebase |
| Observability | **Built and unmounted.** `/api/m/health` → 404 |

**And what is present that those firms would recognise:**

A characterization-test-first discipline that **invalidated its own flagship result** rather than defend
it. `safe-write.js`. A broker-verified instrument registry with a fail-closed two-surface design.
`charges.js` with twelve dependents and one implementation. An evidence chain in which every claim
carries its category, and `Unknown` is a permitted answer.

**That is not nothing. It is the part that is hardest to buy.**

The honest peer set for this platform is not Citadel. It is a serious independent options-research desk.
Against that peer set the gap is: **a validated edge, a daily NAV series, an exposure engine, and a
mounted health endpoint.** Four things. All measured. All reachable.

**Everything else on the brief's feature list is either already here, unusable, or unobservable.**
