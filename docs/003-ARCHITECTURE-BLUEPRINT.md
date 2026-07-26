# 003 — ARCHITECTURE OWNERSHIP & MODULARIZATION BLUEPRINT

**Standard:** Master Prompt 003 · **Depends on:** 000-A…E, 001-A…F, 002
**Date:** 2026-07-12 · **Suite:** 48/48 green
**Mode:** **PLANNING ONLY. No code was modified. No refactor was performed.**

**Every claim below cites a measurement from 001-B (architecture), 001-C (code quality), 001-D
(research) or 002 (stabilization). Nothing here is invented.**

---

## SECTION 0 — THE ONE-PARAGRAPH BLUEPRINT

The current system is a **7,328-line file** that is simultaneously the API, the application layer, the
domain and the scheduler, sitting on top of a **genuinely excellent shared kernel** (`safe-write` Ca=17,
`charges` Ca=12, `instrument-registry` Ca=10, all instability **I = 0.00**, **zero dependency cycles**).
**Three domains have a single owner. Four have none — and the four with none are capital, orders, risk
and the option-pricing model.**

The target architecture adds **one missing layer** (Application), gives **four ownerless domains an
owner**, and turns **five duplicated concepts into one each** (`bsGamma` ×2, Kelly ×4, GEX ×3,
`maxDD` ×8, capital ×3). It **does not rewrite anything that works.** The kernel stays. The 48 test
suites stay. The engines stay — they simply stop being allowed to touch capital and orders directly.

> **The migration's guiding rule: every phase must be provable byte-identical, or it needs an approval
> package. There is no third option.**

---

## SECTION 1 — DOMAIN CATALOG

*13 domains. For each: responsibilities, inputs, outputs, dependencies, and the **single** owner.*

| # | Domain | Responsibilities | Inputs | Outputs | Depends on | **Target owner** | Today |
|---|---|---|---|---|---|---|---|
| **1** | **API** | HTTP transport only. Routing, auth, validation, error shaping, idempotency. **Zero business logic** | HTTP | JSON | Application | `routes/*.js` (~12 Routers) | 🔴 `server.js` — **172 routes, 0 `express.Router()`, 0 with auth middleware** |
| **2** | **Application** | Use-cases. Engine lifecycle. **All scheduling.** The only layer that orchestrates | API calls, timer ticks | Domain commands | Domain | `app/EngineHost.js`, `app/Scheduler.js` | 🔴 **DOES NOT EXIST.** Absorbed into `server.js` |
| **3** | **Capital** | **The single truth of the account balance.** Equity, realised/unrealised P&L, daily NAV series | Fills, EOD marks | Balance, NAV series | Persistence | **`AccountLedger`** | 🔴 **NO OWNER — 6 write sites, 3 modules** |
| **4** | **Risk** | Account-level exposure, brakes, halts. **The single authority on whether a trade may happen** | Positions, capital, market | ALLOW / REFUSE + reason | Capital, Portfolio | **`RiskEngine`** | 🔴 **DOES NOT EXIST.** `grep totalExposure\|portfolioRisk\|netDelta` → **nothing** |
| **5** | **Execution** | The **only** door to a broker. Order lifecycle, idempotency, paper/live gate | Validated decisions | Fills | Broker port, Risk | **`OrderManager`** | 🔴 **NO OWNER — 8 `placeOrder()` sites across 6 modules** |
| **6** | **Portfolio** | Cross-engine positions, netting, exposure, drawdown | Fills, marks | Position book, NAV | Capital | **`Portfolio`** | 🔴 **DOES NOT EXIST** |
| **7** | **Strategy** | Paper strategies. **May PROPOSE. May never PLACE, size, or touch capital** | Market data, quant | `EngineVerdict` | Quant, Market Data | `engines/*` | 🟡 6 engines; **3 of them write `this.capital` directly** |
| **8** | **Quant** | **One** `bsGamma`. **One** Kelly. **One** `r`. **One** charges. **One** `maxDD` | Prices, chain | Greeks, GEX, size, cost | — | **`quant/`** | 🔴 **`bsGamma` ×2 (different `r`, SWAPPED params)** · Kelly ×4 · GEX ×3 · `maxDD` ×8 |
| **9** | **Market Data** | One port, N adapters. Freshness, staleness, **never a fabricated value** | Broker, bhavcopy | Normalised chain/quote | — | **`MarketDataPort`** | 🟡 **5 sources, no interface** |
| **10** | **Research** | Backtests. Strategy hypotheses. **Isolated from live — no shared state, ever** | Bhavcopy | Trade lists | Quant, Data | `research/bt-*` | 🟡 8 scripts, **all look-ahead** (001-D) |
| **11** | **Validation** | Statistics. Walk-forward, purged k-fold, PSR, DSR. **The one judge of whether an edge is real** | Trade lists | Verdict + confidence | — | **`bt-validate.js`** | ✅ **FIXED in 002.** Mathematics correct; leak removed |
| **12** | **AI / Decision** | Ensemble, calibration, meta-decision | `EngineVerdict[]` + **measured** reliabilities | One decision | Validation | `engine-verdict.js` → `MetaDecision` | 🔴 **BLOCKED** — every `reliability` is null ⇒ every weight is 0 |
| **13** | **Observability** | Health, metrics, structured logs, audit trail | Events | `/api/m/*`, logs | EventBus | **`module-contract.js`** | 🔴 **BUILT AND UNMOUNTED** — 11 surfaces, 114 assertions, **0 routes reachable** |
| **14** | **Configuration** | Settings **only**. Schema-validated at startup. **Fails closed** | `.env`, JSON | Frozen config object | Persistence | **`Config`** | 🔴 **3 writers. `CAPITAL_TOTAL` — a BALANCE — lives here** |
| **15** | **Persistence** | Atomic, validated, recoverable writes. **The only door to disk** | Objects | Files + `.bak` | — | **`safe-write.js`** | 🟢 **SINGLE OWNER** — but **10 production sites still route around it** |

---

## SECTION 2 — OWNERSHIP MATRIX

| Concept | Owners today | Verdict | **Target owner** | Consequence of the current state |
|---|---|---|---|---|
| **Capital** | **3** — `execution-engine:54,113,381` · `afternoon-engine:80,782` · `strangle-engine:82` | 🔴 **MULTIPLE + CONFLICTING** | **`AccountLedger`** | **Boot order decided the account balance until 2026-07-10.** A *settings* file overwrote a *restored balance* |
| **Orders** | **6 modules, 8 sites** | 🔴 **MULTIPLE** | **`OrderManager`** | **No chokepoint.** One boolean (`paperMode`) stands between 8 call sites and a broker |
| **Positions** | Per-engine **+ 6 globals in `server.js`** | 🔴 **CONFLICTING** | Owning engine only | **Race:** a timer tick and an HTTP handler write the same slot, with `await` between guard and write |
| **Portfolio** | — | 🔴 **MISSING** | **`Portfolio`** | No cross-engine view. No NAV. ⇒ **Sharpe and drawdown are not derivable** |
| **Risk** | — | 🔴 **MISSING** | **`RiskEngine`** | **No account-level brake can exist.** Per-engine brakes only — and one setter un-halts them |
| **Market Data** | 5 sources | 🟡 **DIFFUSE** | **`MarketDataPort`** | No staleness contract. `Unknown` can silently become a number |
| **Configuration** | **3 writers** | 🔴 **CONFLICTING** | **`Config`** (read-only after boot) | A config key is an account balance |
| **Strategy Registry** | — | 🔴 **MISSING** | **`StrategyRegistry`** | No strategy declares its own maturity level, so **an invalidated strategy is indistinguishable from a validated one at runtime** |
| **Research Results** | Per-script JSON | 🟡 **DIFFUSE** | **`ResearchStore`** | No lineage. A result cannot be traced to the code that produced it |
| **Statistics** | **`bt-validate.js`** ✅ · **but `maxDD` ×8, PF ×4, Sharpe ×3** | 🔴 **DUPLICATED** | **`quant/stats`** | 🔴 **`maxDD` means a *fraction* in one script and *absolute points* in another. Both are called `maxDD`** |
| **Pricing model (`r`)** | **2 conflicting `bsGamma`s** | 🔴 **MISSING OWNER** | **`quant/greeks`** | `r=0` vs `r=0.065`, **and the 3rd/4th parameters are swapped.** A copied call site silently exchanges σ and T |
| **Storage** | **`safe-write.js`** | 🟢 **SINGLE** | keep | — |
| **Charges** | **`charges.js`** | 🟢 **SINGLE** | keep | *(rates disputed — E1)* |
| **Instruments** | **`instrument-registry.js`** | 🟢 **SINGLE** | keep | **But `server.js` bypasses it: `lotSize: 65` hardcoded ×3** |

> **Three green. Four missing. Four conflicting.**
> **Everything that decides how much money moves, and at what price, is in the red columns.**

---

## SECTION 3 — MODULE BOUNDARY SPECIFICATION

### 3.1 `AccountLedger` — **the single owner of capital**

| | |
|---|---|
| **Public** | `balance()` · `nav(date)` · `navSeries()` · `applyFill(fill)` · `markToMarket(marks)` |
| **Internal** | the equity file, the `.bak`, the reconciliation log |
| **Allowed deps** | `safe-write`, `charges` |
| **🔴 FORBIDDEN** | **`Config` — a settings file must NEVER be able to write a balance.** This is the defect that overwrote the account at every boot |
| **Data contract** | `Fill { instrument, side, qty, price, ts, charges }` → `Balance { cash, realised, unrealised, ts }` |
| **Invariant** | **Every mutation is caused by a `Fill` or a `MarkToMarket`. There is no setter.** |

### 3.2 `RiskEngine` — **the single authority on whether a trade may happen**

| | |
|---|---|
| **Public** | `evaluate(proposal) → { allow: boolean, reason: string }` · `exposure()` · `haltStatus()` |
| **Allowed deps** | `AccountLedger`, `Portfolio` |
| **🔴 FORBIDDEN** | **Strategy internals.** Risk must not know *why* a strategy wants a trade — only *what* it is |
| **Data contract** | `Proposal { instrument, legs[], maxLoss, marginEstimate }` → `Verdict { allow, reason }` |
| **🔴 INVARIANT (this is defect B-3, stated as architecture)** | **`autoEnabled` MUST NOT be settable while `_haltedReason` is non-null.** Today four code paths halt an engine and **one setter silently undoes all four.** The invariant belongs **in the engine**, not at the call site |
| **Rollout** | **Read-only at `/api/risk` for two weeks. It publishes and is compared. It blocks nothing until it has been right for a fortnight** |

### 3.3 `OrderManager` — **the only door to a broker**

| | |
|---|---|
| **Public** | `submit(order) → OrderId` · `cancel(id)` · `status(id)` |
| **Allowed deps** | `RiskEngine` (must ALLOW first), `BrokerPort` |
| **🔴 FORBIDDEN** | **Strategies. Engines. Route handlers.** Nothing may call a broker directly. **Today 8 sites do** |
| **Invariant** | **No order reaches a broker without a `RiskEngine.evaluate()` that returned `allow: true`.** The paper/live gate lives here, and **nowhere else** |

### 3.4 `quant/` — **one implementation of each number**

| | |
|---|---|
| **Public** | `greeks(S,K,T,sigma,r)` · `gex(chain, spot, lot)` · `kelly(p, payoff)` · `charges(...)` · `stats.maxDD(series)` |
| **Allowed deps** | **NONE. Pure.** |
| **🔴 FORBIDDEN** | IO, clock, randomness, network |
| **🔴 GUARD** | **A cross-implementation equivalence test.** This is the *only* mechanism that prevents a second `bsGamma` reappearing. **Without it, this consolidation will silently un-happen** |
| **Contract** | **One signature. One parameter order. One `r`, owned by an ADR.** |

### 3.5 `MarketDataPort` — **one interface, five adapters**

| | |
|---|---|
| **Public** | `quote(inst)` · `chain(inst, expiry)` · `freshness(inst) → seconds` |
| **🔴 INVARIANT** | **A stale or missing value returns `null` and a reason. It NEVER returns a number.** *Unknown ≠ Zero. null ≠ 0.* This is the single rule that this codebase has broken most often |
| **Contract** | `Chain { strikes: [{strike, ce:{oi, ltp, iv}, pe:{...}}], oiUnit: 'units'\|'contracts', ts }` |
| **🔴 `oiUnit` is MANDATORY in the contract** | **Because it is currently UNKNOWN for the live broker chain** (001-B A-13). **If the broker reports units and `gex-skew.js` assumes contracts, every GEX on the dashboard is wrong by 65–75×.** Making it a required field means the question **cannot be silently skipped** |

### 3.6 `StrategyRegistry` — **maturity is a runtime fact, not a memory**

| | |
|---|---|
| **Public** | `list()` · `maturity(id) → 0..6` · `mayPropose(id) → bool` |
| **🔴 INVARIANT** | **A strategy below Level 3 (Statistically Validated) may propose only in paper mode.** |
| **Why this is a boundary and not a comment** | Today, **an invalidated strategy is indistinguishable from a validated one at runtime.** `strangle-engine.js` runs with a ₹7L allocation based on a **PF 7.41** that is now measured at **PF 0.55** *(002 §0.1)*. Nothing in the code knows that |

---

## SECTION 4 — LAYER MODEL & MAPPING

```
  PRESENTATION    public/*.html (19 pages)
  ════════════════════════════════════════════════════════════════════
  API             routes/*.js  (~12 Routers)
                  middleware/  auth · validate · error · idempotency
  ────────────────────────────────────────────────────────────────────
  APPLICATION     app/EngineHost.js      ◀── THE MISSING LAYER
                  app/Scheduler.js       ◀── owns ALL timers ⇒ clearInterval becomes POSSIBLE
  ────────────────────────────────────────────────────────────────────
  DOMAIN          AccountLedger  ★  ·  OrderManager  ★  ·  RiskEngine  ★
                  Portfolio  ★  ·  StrategyRegistry  ★
                  engines/*  (may PROPOSE, never PLACE)
                  quant/  ★  (one bsGamma, one Kelly, one r, one maxDD)
  ────────────────────────────────────────────────────────────────────
  INFRASTRUCTURE  MarketDataPort  ·  BrokerPort  ·  EventBus ★
  ────────────────────────────────────────────────────────────────────
  PERSISTENCE     safe-write.js   ◀── already correct. Make it the ONLY door
```

### Mapping — existing → target

| Existing | Target layer | Move |
|---|---|---|
| `public/*.html` | Presentation | ✅ already correct |
| **`server.js` (7,328 L)** | **splits across 4 layers** | 172 routes → API · engine wiring → Application · 14 timers → Application · 62 globals → Domain · 8 raw writes → Persistence |
| `execution-engine`, `afternoon-engine`, `strangle-engine`, `pop-seller`, `gamma-blast-engine`, `agents-engine` | Domain | **Stop writing `this.capital`. Stop calling `placeOrder`. Emit proposals** |
| `option-analyzer`, `gex-skew`, `vol-context`, `multiconfirm`, `strategy`, `meta-label` | Domain (`quant/`) | **Merge the duplicates.** Testability is already **9–10/10** — these are the easiest modules to move |
| `dhan-client`, `upstox-connector`, `free-chain`, `sensibull-fetcher`, `live-connector` | Infrastructure | Behind `MarketDataPort` |
| **`safe-write`, `charges`, `instrument-registry`, `engine-verdict`** | **Kernel** | 🟢 **DO NOT TOUCH. They are already right** (I = 0.00, Ca 17/12/10) |
| `bt-*` | **Research — isolated** | **No shared state with live, ever** |
| `module-contract` | Observability | **Mount it. One line** |

### Boundary violations today

| # | Violation | Evidence | Severity |
|---|---|---|---|
| **L-1** | **The Application layer does not exist** | 172 route handlers contain the business logic | 🔴 **CRITICAL** |
| **L-2** | **Domain → Presentation** | **`pine-converter.js` and `amibroker-bridge.js` reference `req`/`res`.** `registerRoutes` is **227 lines** — the longest function in the repo, in a *domain* module | 🔴 HIGH |
| **L-3** | **Domain → Persistence, bypassing the kernel** | **`strangle-engine.js` calls raw `fs`.** The only engine that skips `safe-write` | 🔴 HIGH |
| **L-4** | **API → Persistence** | **8 raw `writeFileSync` in `server.js`** | 🔴 HIGH |
| **L-5** | **API → Infrastructure (blocking)** | **20 synchronous IO calls in the request path** | 🟡 MEDIUM |
| **L-6** | **Domain → Configuration (capital)** | `setConfig()` writes `CAPITAL_TOTAL` onto `this.capital` (`execution-engine:113`) | 🔴 **CRITICAL — this is the boot-order defect** |

**Cycles: ZERO.** *(001-B §3 — the three apparent cycles were `require()`s inside comments.)*
**Decomposition is therefore mechanically possible.**

---

## SECTION 5 — SHARED STATE INVENTORY

**62 top-level mutable variables in `server.js`.** *(Full list: 001-B §6.)*

| Class | Count | Current risk | **Conceptual owner** |
|---|---|---|---|
| **Position slots** — `openPosition`, `niftyOpenPosition`, `afternoonOpenPosition`, … | **6** | 🔴 **CRITICAL** — written by both a timer tick and an HTTP handler, with `await` between guard and write. **One ad-hoc mutex (`_signalPaperBusy`) guards one of the six** | **The owning engine.** Never `server.js` |
| **Per-instrument market state** — `orbHigh`/`niftyOrbHigh`, `dayHigh`/`niftyDayHigh`, `vwap`/`niftyVwap` … | **~28** | 🔴 HIGH — **duplicated per instrument by copy-paste.** A third instrument means 14 more globals | **`Map<Instrument, MarketState>`** — one shape, N instruments |
| **Price cache** | 8 | 🟡 4 sources, no adapter | **`MarketDataPort`** |
| **Date guards** — `_optHLPurgeDate`, `_oiSnapDay`, `_eodLoggedDate` … | 5 | 🟡 the "have I done this today?" idiom, **5 times** | **`DailyGuard`** |
| **Lifecycle** — `botRunning`, `_shuttingDown`, `_persistTimer` | 3 | 🔴 HIGH — **`_shuttingDown` guards a shutdown that never clears the 14 timers** | **`app/Scheduler`** |
| Signal / AI cache | ~12 | 🟢 LOW | `engines/*` |

**Synchronization today: NONE.** Node's single thread protects straight-line code only.
**Every `await` in a handler is a yield point at which a timer tick may run and mutate the same
global.**

---

## SECTION 6 — DEPENDENCY RULEBOOK

*Enforceable rules. Each carries the current deviation, measured.*

| # | Rule | Current deviation |
|---|---|---|
| **D-1** | **Domain must not depend on Presentation** | 🔴 **VIOLATED** — `pine-converter.js`, `amibroker-bridge.js` touch `req`/`res` |
| **D-2** | **Research must not depend on Presentation or live state** | 🟢 **HELD** — `bt-*` are standalone |
| **D-3** | **Risk must not depend on Strategy internals** | ⚪ **N/A — Risk does not exist** |
| **D-4** | **Execution must consume validated decisions only** | 🔴 **VIOLATED** — **8 `placeOrder()` sites; no validation gate anywhere** |
| **D-5** | **Nothing may write capital except `AccountLedger`** | 🔴 **VIOLATED** — 6 write sites, 3 modules |
| **D-6** | **Configuration must never write a balance** | 🔴 **VIOLATED** — `CAPITAL_TOTAL` in `config-overrides.json` → `this.capital` |
| **D-7** | **Nothing may write disk except `safe-write`** | 🔴 **VIOLATED** — 10 production sites (8 in `server.js`, 1 `strangle-engine`, 1 `signal-health`) |
| **D-8** | **Nothing may read the lot except `instrument-registry`** | 🔴 **VIOLATED** — `server.js:260, 3290, 3483` hardcode `lotSize: 65` |
| **D-9** | **One implementation per number** (`bsGamma`, Kelly, GEX, `maxDD`, PF) | 🔴 **VIOLATED** — 2 / 4 / 3 / 8 / 4 |
| **D-10** | **The kernel (`safe-write`, `charges`, `registry`, `engine-verdict`) depends on nothing** | 🟢 **HELD** — **I = 0.00 on all four.** Preserve this at any cost |
| **D-11** | **A strategy below Level 3 may propose only in paper mode** | 🔴 **VIOLATED** — an invalidated strategy is indistinguishable from a validated one at runtime |
| **D-12** | **Unknown is never a number** | 🔴 **REPEATEDLY VIOLATED** — the fault class behind every fail-open found this cycle |

> **Rules D-5 through D-9 are all "single owner" rules, and all five are violated.
> They are not five problems. They are one problem, five times.**

---

## SECTION 7 — INTEGRATION CONTRACT CATALOGUE

| Boundary | Input | Output | Required invariant |
|---|---|---|---|
| **Market Data → Strategy** | `Chain { strikes[], oiUnit, ts }` | — | 🔴 **`oiUnit` is MANDATORY.** It is currently **UNKNOWN** for the broker chain. **A required field makes the question un-skippable** |
| | | | **Stale ⇒ `null` + reason. NEVER a number** |
| **Strategy → Risk** | `EngineVerdict { direction, confidence, reliability, reasons[] }` | `Proposal` | 🔴 **`reliability: null` ⇒ weight 0 ⇒ VETO-ONLY.** Already enforced in `engine-verdict.js` — **and it has ONE adopter** |
| | | | **No `decision` field. No BUY/SELL from an engine.** Engines *propose*; only the Meta layer *decides* |
| **Risk → Execution** | `Proposal` | `{ allow, reason }` | 🔴 **No order reaches a broker without `allow: true`.** Today: **8 sites, zero gates** |
| **Execution → Portfolio** | `Fill { qty, price, charges, ts }` | position delta | **A fill is the ONLY thing that moves capital.** No setter |
| **Portfolio → Reporting** | position book | NAV, exposure, drawdown | **Daily NAV series — which does not exist today.** Without it: no Sharpe, no drawdown, no portfolio metric of any kind |
| **Research → Validation** | `Trade[] { date, pnl, ret }` | `{ sharpe, psr, dsr, walkForward, purgedKFold }` | 🔴 **THE TRADES MUST CARRY NO FUTURE INFORMATION.** ✅ **`bt-validate.js` was itself violating this until 002.** The contract must be asserted by a **tripwire test per strategy**, not by convention |
| **Validation → AI** | `{ dsr, verdict, nTrials }` | `reliability: 0..1` **or `null`** | 🔴 **`reliability` may be set ONLY from an out-of-sample measurement.** Today **zero engines publish one** ⇒ every weight is 0 ⇒ **the ensemble is the empty sum** |

> **The Research → Validation contract is the one the platform actually broke.** It was not written
> down, so it could not be checked — and the validator itself violated it for the entire life of the
> project.

---

## SECTION 8 — MIGRATION ROADMAP

**Guiding rule: a phase is either provably byte-identical, or it needs an approval package.
There is no third option.**

### Phase 0 — Unblock *(protected files — OWNER DECISION)*

| | |
|---|---|
| **Preconditions** | Packages written |
| **Actions** | **B-3** halt invariant · **B-4** `lotSize` from registry · **B-6** `.env` atomic · **`mountAll()`** |
| **Total code** | **< 30 lines** |
| **Risks** | Low — each is a defect fix with a characterization test |
| **Exit criteria** | A halted engine **stays halted across a restart** · `/api/m/health` returns **200** · **0** `lotSize` literals · **0** raw `.env` writes |

### Phase 1 — Ownership clarification *(documentation only — ZERO code)*

| | |
|---|---|
| **Preconditions** | none |
| **Actions** | **ADR-001** why is `CAPITAL_TOTAL` a config key? · **ADR-002** what is `r`, and who owns it? · **ADR-003** what is the halt invariant? · Adopt the Dependency Rulebook (§6) |
| **Risks** | **ZERO — no code changes** |
| **Exit criteria** | Every domain in §1 has exactly **one** named owner in writing |

### Phase 2 — Interface extraction *(additive — provably byte-identical)*

| | |
|---|---|
| **Preconditions** | Phase 1 |
| **Actions** | **`EventBus`** — engines *emit*; nothing subscribes yet · **`Scheduler`** — **register** the 14 timers **without changing them** · **`quant/`** — extract behind an **equivalence test proving old == new** |
| **Risks** | **Low.** Every step is provable byte-identical. **The `quant/` merge is NOT** — it changes numbers ⇒ **approval** |
| **Exit criteria** | `clearInterval` is **possible** for all 14 timers · **one** `bsGamma`, guarded by an equivalence test · an audit trail exists |

### Phase 3 — Module isolation *(mechanical)*

| | |
|---|---|
| **Preconditions** | **A response-snapshot test for all 172 routes.** 🔴 **NON-NEGOTIABLE — there are ZERO route tests today** |
| **Actions** | `express.Router()` extraction, **one namespace at a time** · `routes/` + `middleware/` · move the 6 position slots into their owning engines · `MarketDataPort` |
| **Risks** | **Medium** — mechanical, but `server.js` is protected ⇒ **approval per namespace** |
| **Exit criteria** | `server.js` < **2,000 LOC** · **0** raw writes · **0** business logic in a handler |

### Phase 4 — Incremental refactoring *(behaviour-sensitive — approval each)*

| | |
|---|---|
| **Preconditions** | Phases 0–3 |
| **Actions** | **`AccountLedger`** — **read-only shadow first; publish alongside the existing capital and assert they agree for 2 weeks** · **`OrderManager`** — pass-through, no logic · **`RiskEngine`** — **read-only at `/api/risk` for 2 weeks before it may block anything** · `Portfolio` + daily NAV |
| **Risks** | **HIGH — these touch money.** Every one shadows before it decides |
| **Exit criteria** | Capital has **one** writer · orders have **one** door · account-level exposure exists and **has been correct for a fortnight** |

---

## SECTION 9 — ARCHITECTURE PRINCIPLES: COMPLIANCE

| Principle | Now | Target | Evidence for the current score |
|---|---|---|---|
| **Single Responsibility** | **2/10** | 8 | `server.js` = API + application + domain + persistence + scheduling + decisions. **7,328 LOC** |
| **Separation of Concerns** | **2/10** | 8 | The Application layer does not exist |
| **Explicit Ownership** | **2/10** | **9** | **Capital 3 · Orders 6 · Risk 0 · Pricing 0** |
| **Dependency Inversion** | **4/10** | 8 | Kernel is correctly inverted (**I = 0.00**). But domain modules depend on `req`/`res` |
| **Low Coupling** | **4/10** | 8 | Kernel excellent; **`server.js` Ce = 61** |
| **High Cohesion** | **6/10** | 8 | **The modules are cohesive. Their container is not** |
| **Deterministic Behaviour** | **4/10** | 9 | Boot order was load-bearing · `new Date()` inside domain logic · **62 unsynchronized globals** |
| **Testability** | **6/10** | 9 | **48 suites** — but **0 route tests**, and `server.js` scores **1/10** |
| **TOTAL** | **30 / 80** | **67 / 80** | |

---

## SECTION 10 — EXECUTIVE ARCHITECTURE SUMMARY

### What is already right — **do not touch it**

The **shared kernel**: `safe-write` (Ca=17), `charges` (Ca=12), `instrument-registry` (Ca=10),
`engine-verdict` — all **pure, all I = 0.00, zero cycles**. This is a textbook stable-abstraction layer,
and most codebases this age do not have one. **Every rebuild proposed here stands on it.**

### What is wrong — **one sentence**

> **`server.js` is not a file with problems. It is four missing layers wearing a trench coat** — and
> underneath it, **capital, orders, risk and the pricing model have no owner at all.**

### What must be built — **five things**

| ★ | Unlocks |
|---|---|
| **`AccountLedger`** | Capital gets one owner. `CAPITAL_TOTAL` can no longer be a config key. **Daily NAV becomes derivable ⇒ Sharpe, drawdown and every portfolio metric become possible for the first time** |
| **`OrderManager`** | 8 broker call sites collapse to **1**. Live trading becomes *gateable* at a single point instead of by a boolean in six modules |
| **`RiskEngine`** | Account-level exposure exists. **Read-only for two weeks before it may block anything** |
| **`quant/`** | One `bsGamma`, one `r`, one Kelly, one `maxDD` — **guarded by an equivalence test, without which the duplication silently returns** |
| **`Scheduler`** | The 14 timers become **clearable**. The EOD snapshot stops being a read taken while 14 writers are running |

### What must NOT be done yet

**Do not refactor `server.js`.** There are **zero route tests**. A response-snapshot test for all 172
routes is the **precondition**, not a nice-to-have.

**Do not build the Meta Decision Engine, the Portfolio Engine, or the Volatility Surface.** Each would
be infrastructure to run a strategy that — as of `002` — **the platform's own now-honest validator
scores at `FAIL (likely overfit)`.**

### The success criterion, restated

> *"A new engineering team should be able to implement future architectural improvements without
> changing business behaviour unexpectedly."*
>
> **Today that is impossible, and the reason is measurable: 62 unsynchronized globals, 0 route tests,
> 4 ownerless domains, and 5 concepts with more than one implementation.**
>
> **This blueprint's entire purpose is to make "unexpectedly" a word that no longer applies.**

---

**Code modified: NONE. Refactoring performed: NONE. Suite: 48/48.**

**Deliverables:** Target Architecture Blueprint (§4, §10) · Domain Catalog (§1) · Ownership Matrix (§2) ·
Module Boundary Specification (§3) · Layer Mapping Report (§4) · Shared State Inventory (§5) ·
Dependency Rulebook (§6) · Integration Contract Catalogue (§7) · Migration Roadmap (§8) ·
Executive Architecture Summary (§10).
