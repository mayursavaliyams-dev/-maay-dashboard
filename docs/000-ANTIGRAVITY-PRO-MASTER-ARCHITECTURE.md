# ANTIGRAVITY PRO — Master System Architecture Blueprint

**Document 000 — the unifying index over docs 001–050 + the ratified Rules.**
Author role: Chief System / AI / Quantitative-Systems Architect.
Discipline: *architecture only — no production code, no refactoring, no bug-fixes.*
Doctrine: **Evidence over assumptions. Unknown stays Unknown. Fail closed.**

> This document does **not** replace any existing doc. 003 remains the canonical
> migration blueprint; 030 the enterprise capstone; 040/050 the data/AI capstones;
> 001-F the executive report. **000 sits above them** — it states the timeless
> principles, reconciles the four fresh forensic audits into one ground-truth, names
> the eight singletons and their single owners, draws the flows, and sequences the
> roadmaps that 003/030/001-F already agree on. Where 000 and a lower doc conflict,
> the lower, more specific doc wins on detail; 000 wins only on *framing and order*.

---

## PART 0 — WHAT THIS DOCUMENT IS

### 0.1 Provenance of every claim below
Nothing here is asserted from imagination. The current-state facts come from four
independent code-level forensic sweeps of the live tree (2026-07-18), cross-checked
against the existing 001–050 corpus:

| Sweep | Scope | Load-bearing finding |
|---|---|---|
| A — State & Ownership | `server.js` + engines | Capital has **3 writers, no owner**; positions fragmented across **5 engines**; order placement called from **3 sites**; risk brakes **per-instance**, no global kill-switch |
| B — Data / Config / Registry | registry, config, feeds | `server.js` **does not import** `instrument-registry.js` — keeps a parallel `INSTRUMENT_META` copy; market-session logic exists **3×** with divergent open times; **~226 `process.env` reads across 93 files** |
| C — Modules & Dependencies | require graph, engines | **Zero circular dependencies** (clean star); tangle is **inside** `server.js`; **170 inline routes**; **no event bus**; only **4 instances** can ever place a live order |
| D — Existing Docs | `docs/` 001–050 | A full governance corpus **already exists**; the central missing capability is **adoption governance**, not more components |

Provenance grades used throughout: **[V]** verified in code with file:line · **[P]**
probable / documented · **[U]** unknown, deliberately left open.

### 0.2 The one sentence that organises everything
> **Where this platform touches *money* it fails closed (correctly). Where it touches
> *evidence* it fails open (every time). Same authors, same repo, opposite instinct —
> and only the money instinct was ever written down as a rule.** (030 §0)

Every principle, owner, and roadmap phase in this document exists to **extend the
fail-closed instinct to evidence**, and to **make correct components *required*
instead of merely *available*.**

---

## PART I — ARCHITECTURE PRINCIPLES (the timeless laws)

These are ranked. A lower-numbered law overrides a higher-numbered one in conflict.

1. **One fact, one owner.** Every fact (capital, a position, a lot size, "is the
   market open", `r`) has exactly one module that may mutate it. Everyone else holds
   a *read model*, never a second copy. *Violation today: capital ×3, lot size ×2,
   market-session ×3, position state ×5.* **[V]**

2. **Fail closed on money; fail closed on evidence too.** Missing/corrupt/unknown
   input ⇒ stop and say why, never fabricate a default. `null ≠ 0`. A risk brake that
   cannot read its equity file must read as **brake ON**. Extend the money instinct to
   every `reliability`, every `prob`, every backtest claim.

3. **Evolve, never rewrite.** The kernel stays. The engines stay. Every migration
   step is *provably byte-identical, or it ships behind an owner approval package.*
   **There is no third option.** (003 §0)

4. **Availability is not adoption.** A correct, tested component that nothing is
   *required* to call is technical debt, not an asset. Every component declares its
   required adopters; an unadopted required component is a failing check. (030 thesis)

5. **No engine decides.** Every engine returns an **EngineVerdict** (`status, score,
   confidence, reliability, limitations, missingEvidence, assumptions`) — never a
   `BUY/SELL`, never a `decision` field. Only the **Meta-Decision Engine** may combine
   verdicts. `reliability=null ⇒ weight 0 ⇒ veto-only`.

5b. **A verdict without evidence is a hypothesis.** Every published number carries a
   grade: Verified / Probable / Hypothesis / Unknown. An uncalibrated score may not be
   published as a probability.

6. **One door to the broker.** Exactly one module may call `placeOrder`. Every order
   passes a single risk gate first. *Violation today: 3 call sites, no gate.* **[V]**

7. **State is owned, persisted, and reconciled — never fire-and-forget for money.**
   Cache writes may be fire-and-forget; ledger writes may not. In-memory and on-disk
   truth must have a defined reconciliation, not a silent last-writer-wins.

8. **Determinism is a feature.** Anything that decides money must be replayable:
   same inputs ⇒ same outputs. This requires a feature store (inputs are recorded, not
   discarded) and event-sourced history.

9. **The dashboard computes nothing.** Presentation is a pure projection of owned
   state. Business logic never lives in a route handler or a browser.

10. **Protected files change only by approval package.** `server.js`,
    `execution-engine.js` (and any file so designated) change only via an
    impact+risk+exact-diff+rollback+test-plan package the **owner** commits.

11. **Every service exposes the same surfaces.** REST · WS · Health · Metrics ·
    Version · Config · OpenAPI · structured logs · graceful shutdown · health-score.
    "An engine is not a service" until an adapter gives it these.

12. **Write the decision down.** Any non-obvious ownership or config choice needs an
    ADR. *"Nobody knows why `CAPITAL_TOTAL` is a config key"* is the failure this
    prevents. (001-F D-19)

---

## PART II — CURRENT-STATE GROUND TRUTH (evidence-backed)

### 2.1 The shape of the system as it actually is
- **A hub-and-spoke monolith.** `server.js` ≈ **372 KB / ~7,400–9,000 LOC**, **170
  routes** (128 GET + 42 POST), **0 `express.Router()`**, **~35+ module-level mutable
  containers**, **~14 `setInterval` / 0 `clearInterval`**. It is HTTP server, tick
  handler, market-state cache, EOD writer, config store, backtest host, dashboard
  aggregator, **and** the instantiator/feeder of every engine. **[V]**
- **The require graph is clean.** 78 root modules, **zero import cycles**, max depth 2
  (server → live-connector → dhan-client → dhan-auth). The kernel — `safe-write`,
  `charges`, `instrument-registry`, `engine-verdict` — is `I=0.00`, cycle-free, and
  **correct: do not touch.** Decomposition is therefore *mechanically possible.* **[V]**
- **The tangle is state, not imports.** All coupling lives inside `server.js` as
  shared module-scope variables hand-wired to engines. Fixing the monolith is a
  *state-ownership* problem, not a dependency-untangling problem. **[V]**
- **Only 4 instances can trade.** 2 `ExecutionEngine` + 2 `AfternoonEngine`, all
  through the single `live.placeOrder`, all gated behind `TRADE_MODE=live` (default
  `paper`). Every other engine is structurally paper-only (zero broker calls). **[V]**
- **The AI layer is isolated.** The 5-agent pipeline (`agents-engine.js`) writes only
  JSON paper ledgers, makes zero broker calls, and does not require the execution
  path. A self-contained sandbox. **[V]**

### 2.2 The four ownerless money domains (the core defect class)
| Domain | Owners today | Evidence | Consequence |
|---|---|---|---|
| **Capital** | 3: engine `this.capital`, `data/equity-*.json`, `server.js` `CAPITAL_TOTAL` recompute | `execution-engine.js:54,113,150`, `server.js:2995,3036,3748` | **Real ₹88,011 SENSEX equity once overwritten at boot** [V] |
| **Orders** | 3 call sites, no gate | `live-connector.js:392` called from `execution-engine`, `afternoon-engine`, `server.js:1915,7177` | No single pre-trade risk check |
| **Risk** | per-engine + a 4th calc in server.js | `execution-engine.js:302`, `server.js:6416` | Halting one engine halts no other; **no global kill-switch** |
| **Pricing `r`** | nobody | `bsGamma` defined ×2 with **params swapped** (r=0 vs 0.065) | GEX/greeks disagree by design |

### 2.3 The single-source-of-truth violations (ranked by money-impact)
1. **Lot size / strike step ×2** — canonical `instrument-registry.js:87` vs the
   parallel hardcoded `INSTRUMENT_META` at `server.js:257-273`, and **server.js never
   imports the registry**. P&L = points × lots × **lotSize** → highest blast radius. **[V]**
2. **`pop-seller.js:18` FINNIFTY:65** contradicts the registry's 60 (self-flagged). **[V]**
3. **Market-session ×3** — `server.js:283` (opens 9:15) vs `ai.js:40` (opens 9:00,
   divergent) vs each broker's own `isMarketOpen`. **[V]**
4. **Config split** — `data/config-overrides.json` (13 keys, silently wins) vs
   **~226 `process.env` reads / 93 files**; `CAPITAL_TOTAL` — a *balance* — lives in
   both. No startup schema validation; 107 hidden literals (~68% of settings). **[V/P]**
5. **Backtest universe forked** — `backtest-real/{dhan-client,instruments,expiry-days}`
   is a parallel instrument/expiry/feed stack disconnected from the registry. **[V]**

### 2.4 What is already *right* (do not regress)
`hl-verify.js` (two-tier honest H/L gate, `null` not `0`), `safe-write.js` (atomic +
`.bak`), `instrument-registry.js` (frozen, fail-closed, drift-checked), `charges.js`,
`engine-verdict.js`, the ratified **Rules**, and a **zero-cycle** graph. The bones are
institutional-grade; the wiring is not.

### 2.5 The verdict
**Maturity: Level 1 of 5 (Functional Application).** Live-trading gate: **0 of 6
criteria passed, unchanged across 32 prior audits.** The blocker is not capability.
It is that *no mechanism makes a correct component a required one* — **adoption
governance** — compounded by an **evidence layer that fails open.**

---

## PART III — THE EIGHT SINGLETONS (the user's explicit mandate)

Each domain below must resolve to **exactly one owner**. For each: what it owns, the
current violation (with evidence), the target owner (adopting 003's names), and the
migration state.

| # | Singleton | Owns | Violation today [V] | Target owner | State |
|---|---|---|---|---|---|
| 1 | **Capital** | equity, reserve, margin, mark-to-market | 3 writers; boot-order clobber | **`AccountLedger`** — *no setter*; every change caused by a Fill or MarkToMarket event | Shadow first |
| 2 | **Risk** | limits, drawdown, consec-loss, kill-switch, halt invariant | per-engine + 4th calc; no global halt | **`RiskEngine`** — read-only `/api/risk` 2 wks, then may block | Read-only first |
| 3 | **Order** | order lifecycle, the only broker door | 3 call sites, no gate | **`OrderManager`** — starts as pass-through | Pass-through first |
| 4 | **Instrument Registry** | lot/tick/step/expiry, tradability | server.js parallel copy; pop-seller/backtest forks | **`instrument-registry.js`** (exists) — *every* consumer imports it; server's `INSTRUMENT_META` deleted | Enforce adoption |
| 5 | **Market State** | is-open, session, ORB, day H/L | 3 divergent implementations | **`MarketClock`** (extract `getMarketSession`) — one exported module | Extract + adopt |
| 6 | **Configuration** | every tunable, one writer, schema-validated | config-file vs 226 env reads; non-atomic writers | **`Config`** — load+validate at boot, **read-only after**; `CAPITAL_TOTAL` removed (needs ADR-001) | Consolidate |
| 7 | **Event Bus** | domain events (Tick, Fill, Verdict, Halt, Break) | none exists; direct calls + globals | **`EventBus`** — typed, in-proc first | New (interface) |
| 8 | **Single Source of Truth (index)** | which doc/module is authoritative for what | pointer drift (STATUS→CONTEXT-SHORT→THE-ONE-DOCUMENT) | **`THE-ONE-DOCUMENT.md`** + this 000 index | Reconcile |

> Note on ordering: singletons 4, 5, 6 are *consolidations of things that already
> exist* — cheapest, do first. 1, 2, 3 touch money — shadow/read-only/pass-through
> before authoritative, per Principle 2 & 3. 7 is the one genuinely new interface.

---

## PART IV — TARGET SYSTEM ARCHITECTURE (18 subsystems)

### 4.1 The layer model (adopted verbatim from 003 §4 — do not reinvent)
```
PRESENTATION      dashboards, browser (pure projection, computes nothing)
      │
API               routes/ (thin) · middleware/ (auth, validation) · OpenAPI
      │
APPLICATION  ◄── THE MISSING LAYER ── EngineHost · Scheduler(owns the 14 timers) · MetaDecisionEngine
      │
DOMAIN            AccountLedger★ · OrderManager★ · RiskEngine★ · Portfolio★ ·
                  StrategyRegistry · quant/(greeks,r) · the engines (verdict-only)
      │
INFRASTRUCTURE    MarketDataPort · BrokerPort · EventBus · FeatureStore
      │
PERSISTENCE       safe-write · Redis(cache) · event-log(append-only) · snapshots
```
★ = today ownerless; the whole migration is about giving these four (plus the missing
Application layer) a single owner each.

### 4.2 The subsystem contracts
Format per subsystem — Purpose · Owner · Inputs · Outputs · Dependencies · Failure
modes · Recovery · Scalability · Testing. Kept tight; the deep spec for each lives in
its numbered doc (cited).

**1. System / Orchestration** — *Purpose:* boot, wire, schedule, shut down cleanly.
*Owner:* `EngineHost` + `Scheduler`. *In:* config, registry, ports. *Out:* running
engines, tick cadence. *Deps:* everything below it. *Failure:* shutdown race (14
timers, 0 `clearInterval`) — EOD snapshot taken while writers run. *Recovery:*
graceful-shutdown surface drains timers then snapshots. *Scale:* one process now;
Scheduler makes multi-process possible later. *Test:* boot/shutdown ordering,
route-snapshot (all 170) as the decomposition precondition. (003, 029)

**2. AI / Decision Intelligence** — *Purpose:* combine engine verdicts into one
decision. *Owner:* `MetaDecisionEngine` (only combiner). *In:* EngineVerdicts, news
bias, event-risk. *Out:* one graded decision + evidence trail. *Deps:* engine-verdict
contract, feature store. *Failure:* fabricated `reliability`, uncalibrated `prob`
published. *Recovery:* `reliability=null ⇒ veto-only`. *Scale:* verdict fan-in is
linear. *Test:* calibration, ensemble-weight = 0 when reliability null. (016,020,041,050)

**3. Research Platform** — *Purpose:* form, register, and test hypotheses before code.
*Owner:* `HypothesisRegistry`. *In:* idea + prior. *Out:* registered experiment, go/no-go.
*Deps:* backtesting, validation. *Failure:* HARKing, look-ahead. *Recovery:* pre-registration.
*Scale:* experiment count. *Test:* every hypothesis has a falsifier. (015,042,043)

**4. Execution** — *Purpose:* translate an approved decision into a filled order.
*Owner:* `OrderManager` (the one door). *In:* approved order intent. *Out:* Fill events.
*Deps:* BrokerPort, RiskEngine (gate), registry. *Failure:* 3 uncontrolled call sites;
expired token. *Recovery:* pass-through shadow first; refuse live on stale token.
*Scale:* per-broker adapters behind one port. *Test:* pass-through equivalence,
gate-precedes-order invariant. (012)

**5. Risk** — *Purpose:* the veto and the kill-switch. *Owner:* `RiskEngine`. *In:*
positions, equity, event-risk, halt state. *Out:* allow/deny + global halt. *Deps:*
AccountLedger, Portfolio. *Failure:* halt fails **open** (not persisted; edge-trigger
not level-check; re-armed at boot). *Recovery:* halt invariant (ADR-003):
`autoEnabled` may not be set while `_haltedReason` non-null; corrupt state ⇒ halt ON.
*Scale:* one authority for N engines. *Test:* read-only 2 wks; fail-closed on corrupt
equity. (013,005)

**6. Portfolio / Exposure** — *Purpose:* aggregate true exposure across all engines.
*Owner:* `Portfolio` (state) reading from `positions-book` (projection). *In:* per-engine
positions. *Out:* net Greeks, exposure, concentration. *Deps:* AccountLedger. *Failure:*
5 engines own 5 shapes; aggregator can't enforce agreement; open-position write race
(timer vs HTTP handler with `await` between guard and write). *Recovery:* positions
become owned state, not per-engine memory. *Scale:* N engines → one book. *Test:*
authority-race regression, cross-engine reconciliation. (011)

**7. Capital** — *Purpose:* the single account of record. *Owner:* `AccountLedger`
(no setter). *In:* Fill, MarkToMarket, funding events. *Out:* equity, reserve, buying
power. *Deps:* charges (correct STT side), OrderManager. *Failure:* 3 writers; boot
clobber; `charges.js` bills STT on the wrong side of every short (~₹20k understated /
129 trades). *Recovery:* shadow-asserts-agreement 2 wks before authoritative. *Scale:*
event-sourced, replayable. *Test:* shadow equivalence, charges golden-set. (014)

**8. Data / Market Data** — *Purpose:* one clean feed abstraction. *Owner:*
`MarketDataPort`. *In:* Dhan WS+REST, Upstox, backtest source. *Out:* normalized
ticks/chains. *Deps:* broker adapters, hl-verify. *Failure:* WS delivery 8–30% ⇒ REST
reconcile required; 3 broker couplings under a thin additive registry. *Recovery:*
hl-verify two-tier gate; REST fallback. *Scale:* add adapters behind the port. *Test:*
normalization contract, out-of-order/stale/NaN → INVALID. (006,031,036)

**9. Storage** — *Purpose:* durable, reconcilable persistence. *Owner:* `safe-write`
(ledgers) + Redis (same-day cache, 12h TTL) + append-only event log. *In:* domain
state. *Out:* durable files, restorable snapshots. *Deps:* none (leaf). *Failure:*
fire-and-forget Redis silently diverges from memory; raw `fs.writeFileSync` in a few
sites bypasses safe-write; `.env` rewritten non-atomically from an HTTP handler
(credential-loss risk). *Recovery:* no ledger may call `fs` directly; atomic+bak+refuse-on-corrupt.
*Scale:* JSON now; Postgres/timeseries later behind the same port. *Test:* corrupt-file
recovery, dual-write reconciliation. (005,025,039)

**10. Learning** — *Purpose:* turn labelled outcomes into calibrated weights.
*Owner:* `ConfluenceLearner` / model-lifecycle. *In:* feature store rows + realized
outcomes. *Out:* measured `reliability` per factor. *Deps:* **FeatureStore (does not
exist yet).** *Failure:* inputs computed then **discarded** ⇒ no inference is
reproducible — *"the only irreversible debt; worsens daily."* *Recovery:* build the
feature store **now**. *Scale:* offline batch. *Test:* out-of-sample reliability, no
weight without ≥N labelled outcomes. (018,035,044)

**11. Simulation** — *Purpose:* deterministic tick/event replay. *Owner:*
`ReplayEngine`. *In:* recorded ticks + events. *Out:* reproduced runs. *Deps:* event
log, feature store. *Failure:* none recorded to replay from today. *Recovery:* event
sourcing precondition. *Scale:* replay any historical day. *Test:* determinism
(same input ⇒ same output). (037,022)

**12. Backtesting** — *Purpose:* honest historical evaluation. *Owner:* `bt-*` behind
`bt-validate`. *In:* historical bars, cost model. *Out:* cost-net PF, PBO/PSR. *Deps:*
registry, charges. *Failure:* **look-ahead in 7 of 8 scripts** (strangle PF 7.41→0.55;
directional 0.94); the validator itself once leaked (B-1, fixed). *Recovery:* NO-LOOK-AHEAD
harness; every strategy must call the validator (0 do today). *Scale:* per-strategy
parallel. *Test:* look-ahead guard, cost-net gate. (008,009,032)

**13. Monitoring** — *Purpose:* is the system healthy right now. *Owner:* `ops-health`
+ `module-contract` (11 surfaces, **mounted on 0 routes today**). *In:* per-service
health. *Out:* health-score, alerts. *Deps:* all services. *Failure:* built and
**unmounted** (`mountAll()` is one line). *Recovery:* mount it; no-evidence ⇒ health
`unknown`, never `ok`. *Scale:* per-service rollup. *Test:* 114 contract assertions. (021,026)

**14. Observability** — *Purpose:* explain *why*, after the fact. *Owner:*
`AuditTrail` (append-only event source). *In:* every domain event. *Out:* immutable
history, lineage. *Deps:* event log. *Failure:* jsonl append-log mispointed; decisions
not reconstructable. *Recovery:* event sourcing + data lineage catalog. *Scale:*
append-only. *Test:* replay a decision from the trail. (022,038)

**15. Logging** — *Purpose:* structured, queryable, no silent loss. *Owner:*
`ai-logger` / structured-log surface. *In:* events, errors. *Out:* typed log stream.
*Deps:* none. *Failure:* **92 empty/silent catches** (57 in server.js, 4 inside
safe-write itself); no error taxonomy — unknown which swallow a state mutation.
*Recovery:* error taxonomy; a catch that hides a money mutation is a defect (the
perf-budget ratchet already enforces "no new silent catch"). *Scale:* stream. *Test:*
silent-catch ratchet (may only go down). (021)

**16. Recovery** — *Purpose:* survive crash/restart with truth intact. *Owner:*
`Recovery` (boot restore + snapshot). *In:* equity files, Redis, event log. *Out:*
reconciled boot state. *Deps:* storage. *Failure:* boot restore **overwrites without
merge** (the ₹88k incident); halt re-armed at boot; Redis restore conflict handling
**[U]** — not confirmed whether it merges or blind-overwrites. *Recovery:* defined
restore order + reconciliation; halt invariant honored across restart. *Scale:* one
process. *Test:* boot-order regression, crash-mid-write recovery. (005,025)

**17. Security** — *Purpose:* nobody unauthorized touches money. *Owner:* `auth.js`
(**correct, mounted nowhere**) + middleware. *In:* requests, secrets. *Out:*
authenticated/authorized access. *Deps:* config (secrets). *Failure:* **0 of 170
routes authenticated**; `'antigravity'` is the live credential; auth default-off.
*Recovery:* mount auth (opt-in JWT/RBAC exists); secrets out of `.env`-as-config.
*Scale:* per-route middleware. *Test:* every mutating route requires auth. (023)

**18. Governance** — *Purpose:* make correct components *required* and decisions
*recorded.* *Owner:* `AdoptionRegistry` + `OwnershipRegistry` + `DecisionLog(ADR)`
— **the one genuinely net-new capability the platform needs.** *In:* component
declarations of required adopters. *Out:* a failing check when a required component is
switched off. *Deps:* CI. *Failure:* 10 correct components sit switched off
(engine-verdict 1/8 adopters, auth 0/170, module-contract 404, bt-validate 0 strategy
callers, position-sizer disabled, PM2/Docker not running). *Recovery:* the registry
*is* the recovery. *Scale:* one check per component. *Test:* adoption check in CI;
zero ADRs today → the three prerequisite ADRs. (030)

---

## PART V — OWNERSHIP MATRIX

| Fact / Domain | Single owner (target) | Current writers [V] | Read models (may hold a copy) |
|---|---|---|---|
| Equity / capital | `AccountLedger` | 3 | dashboards, RiskEngine, Portfolio |
| A position | `Portfolio` | 5 engines | `positions-book` (projection), dashboards |
| Order lifecycle | `OrderManager` | 3 sites | audit trail |
| Risk limits / halt | `RiskEngine` | per-engine ×N + server | dashboards, EngineHost |
| Lot / tick / step / expiry | `instrument-registry` | 2 (+ pop-seller, backtest) | every consumer (import, not copy) |
| Is-market-open / session | `MarketClock` | 3 | every engine |
| Any tunable / config | `Config` (read-only post-boot) | file + 226 env | everyone (read) |
| Risk-free `r` / greeks | `quant/` | 2 (params swapped) | GEX, sizers |
| Domain events | `EventBus` | n/a (none) | subscribers |
| Authoritative-doc index | `THE-ONE-DOCUMENT.md` + 000 | drifted pointers | all docs |

**Rule:** a cell may have **one** owner and **many** read models. A read model is
*derived and never written back.* Today's defect is cells with many *writers.*

---

## PART VI — DEPENDENCY GRAPH & THE FLOWS

### 6.1 Dependency shape
Star, acyclic. `server.js` is the hub (requires ~50 modules); engines are leaves;
kernel (`safe-write`, `charges`, `instrument-registry`, `engine-verdict`) is depended
upon by many and depends on nothing. **Target:** insert the Application layer so route
handlers stop being where business logic lives; keep the graph acyclic.

### 6.2 Control flow (today)
`5s runBotEngine heartbeat → pull live chains → hand-feed each engine → engine mutates
its own paper ledger → (only Execution/Afternoon, only if TRADE_MODE=live) →
live.placeOrder`. Plus ~13 other timers (persistence 60s, agents 45s, signal 90s,
news 300s). **Target:** `Scheduler` owns all timers with `clearInterval` on shutdown.

### 6.3 Data flow
`Broker(WS 8–30% + REST) → MarketDataPort → hl-verify (two-tier) → normalized tick →
in-memory caches + Redis(12h) + option/OI snapshots → analyzers → EngineVerdicts`.
**Target:** every tick also lands in the **FeatureStore** so decisions are replayable.

### 6.4 Event flow (target — does not exist today)
`Tick · ChainUpdate · Break · Fill · MarkToMarket · Verdict · HaltRequested ·
HaltCleared` published on `EventBus`; `AccountLedger` mutates only on Fill/MarkToMarket;
`RiskEngine` subscribes to positions+equity and may publish `HaltRequested`;
`AuditTrail` subscribes to everything (append-only).

### 6.5 Risk flow (target)
`positions + equity + event-risk → RiskEngine → {allow | deny | GLOBAL HALT}`. One
authority; a global kill-switch halts **all** engines; halt state persisted and
honored across restart (ADR-003 invariant).

### 6.6 Decision flow (target)
`EngineVerdict[] (no engine decides) → MetaDecisionEngine (only combiner) → graded
decision + evidence → RiskEngine gate → OrderManager (one door) → BrokerPort`.

### 6.7 Capital flow (target)
`Fill → charges (correct STT side) → AccountLedger (no setter) → equity/reserve →
event-sourced snapshot`. No other path may change capital. Boot restore reconciles,
never blind-overwrites.

### 6.8 AI flow
`news-engine → Scout → Impact(disclosed math) → Fusion(combineSignal) → Risk gate →
paper Executor → JSON ledgers`. Isolated from the live-order path today; **keep it
verdict-only** if it is ever promoted — it must route through MetaDecision → Risk →
OrderManager like any other engine, never gain its own broker door.

---

## PART VII — REPOSITORY LAYERS & MODULE BOUNDARIES

Target tree (evolution of today's flat root; nothing rewritten, only relocated behind
byte-identical or approval):
```
/api          routes/ (thin handlers)      · middleware/ (auth, validation)
/app          EngineHost · Scheduler · MetaDecisionEngine
/domain       account-ledger · order-manager · risk-engine · portfolio
              strategy-registry · engines/* (verdict-only) · quant/*
/infra        market-data-port · broker-port/* (dhan,upstox,neo) · event-bus · feature-store
/persist      safe-write · redis-store · event-log · snapshots
/registry     instrument-registry (kernel) · charges (kernel) · engine-verdict (kernel)
/research     bt-* · validation · hypothesis-registry · forward-test
/governance   adoption-registry · ownership-registry · adr/ (DecisionLog)
/docs         000..050 + Rules + APPROVAL-* + ADR-*
/public       dashboards (pure projection)
/test         one suite per module, @test: markers enforced
```
**Boundary rule:** a module may import *down* the layer stack, never *up*, never
sideways into another engine. Cross-engine truth flows through owned state + EventBus,
not direct requires.

---

## PART VIII — THE RULES (cite the ratified set; do not re-invent)

These already exist and are owner-ratified (2026-07-09). 000 adopts them verbatim.

- **Protected-File Rule** — `server.js`, `execution-engine.js` change only via an
  approval package (impact+risk+exact-diff+rollback+test-plan); the **owner** commits.
- **Testing Rule** — every new module: Characterization · Unit · Integration ·
  Regression · Performance · Memory-Leak · Failure · Rollback. Changing existing code
  ⇒ characterization test first, **proven RED on the live bug**. Enforced by
  `test/testing-rule.test.js` (`@test:` ratchet, may only go up). *"A test that did
  not run must never look like a test that passed."*
- **AI-Architecture Rule** — engines return `EngineVerdict`, never a decision; only
  MetaDecision combines; `reliability` measured out-of-sample or `null ⇒ veto-only`.
- **Dashboard Rule** — visualization only; computes nothing; metadata from the
  registry, not hand-maintained.
- **API Rule** — every service exposes the 11 surfaces; "an engine is not a service."
- **Config Governance (004)** — one writer; atomic+`.bak`+refuse-on-corrupt;
  schema-validated at boot; `CAPITAL_TOTAL` never writable from a config path (ADR-001).
- **State/Persistence (005, C3)** — no ledger calls `fs.writeFileSync` directly;
  corrupt/unknown on a risk brake ⇒ brake ON; open positions are state, closed are an
  audit trail (only the trail may be capped).
- **Versioning Rule (new here)** — every service exposes a Version surface; a schema
  change to any persisted ledger ships with a migration journal entry
  (`data/migrations/*.jsonl` pattern already in use); no silent shape changes.
- **Documentation Rule** — every design/audit/plan is a self-contained English
  markdown doc under `docs/` (this file included); non-obvious decisions get an ADR.
- **Approval Rule** — byte-identical or approval package. **No third option.**
- **Working discipline** — root cause before fix; smallest safe change; one concern
  per commit; full suite gated on exit code (never grep); never commit red; never
  commit unasked; never push; no live trading.

---

## PART IX — GOVERNANCE: THE CENTRAL MISSING CAPABILITY

The deepest finding of the entire audit programme (030) and the spine of this
blueprint: **the platform builds correct components and then leaves them switched
off.** No amount of new capability fixes this. The one net-new system required is:

- **OwnershipRegistry** — machine-readable "who owns what" (Part V as code); CI fails
  if a fact gains a second writer.
- **AdoptionRegistry** — every component declares its *required* adopters; CI fails if
  a required component has zero live callers (would have caught: auth 0/170,
  engine-verdict 1/8, module-contract 404, bt-validate 0 strategy callers).
- **DecisionLog (ADR)** — the three prerequisite ADRs before any money-code moves:
  - **ADR-001** — why is `CAPITAL_TOTAL` a config key (and the plan to remove it)?
  - **ADR-002** — what is `r`, who owns it, what value, one definition?
  - **ADR-003** — the halt invariant: `autoEnabled` may not be set while
    `_haltedReason` is non-null; corrupt state ⇒ halt ON; survives restart.

Until these three exist, the money layer must not be decomposed. This is a **hard
precondition**, not a preference.

---

## PART X — ROADMAP (sequence the agreeing plans; do not renumber)

003, 030, and 001-F already describe the *same* path in different words. 000 sequences
them; it invents no new phase numbering.

**Phase 0 — Unblock (protected, <30 LOC total, owner-committed).** Halt invariant
(ADR-003 in code), lot size from registry (delete `INSTRUMENT_META`), atomic `.env`
write, `mountAll()` for module-contract, mount `auth`, add the global kill-switch and
read-only `/api/risk`. *Precondition for everything.*

**Phase 1 — Ownership on paper (docs/ADRs only, zero code).** Write ADR-001/002/003;
stand up the OwnershipRegistry + AdoptionRegistry as CI checks. Consolidate the three
cheap singletons: registry adoption (#4), `MarketClock` extraction (#5), `Config`
consolidation (#6).

**Phase 2 — Interfaces (byte-identical or equivalence-tested).** `EventBus` (#7,
in-proc), `Scheduler` (registers the 14 timers, adds `clearInterval`), `quant/` behind
an equivalence test. **Non-negotiable precondition:** a response-snapshot test for all
**170 routes** before any `server.js` decomposition.

**Phase 3 — Adoption + the irreversible debt.** Turn on the 10 switched-off
components. Build the **FeatureStore today** (the only debt that worsens daily). Fix
`charges.js` STT side. Persist positions. Close the 7 remaining look-aheads. Move
routes into `routes/`, add `middleware/`, extract `MarketDataPort`.

**Phase 4 — Money owners (shadow → authoritative).** `AccountLedger` runs as a
read-only shadow asserting agreement for 2 weeks → then owns capital. `OrderManager`
starts as pass-through → then the one door. `RiskEngine` read-only at `/api/risk` for
2 weeks → then may block. `Portfolio` aggregates owned position state.

**Phase 5 — Institutional.** Postgres/timeseries behind the persistence port;
event-sourced AuditTrail + ReplayEngine; per-service 11-surface adapters; multi-process
via Scheduler; the research platform (hypothesis registry → validation → forward-test)
as the *only* path an edge may reach live.

### 5-Year Architecture
A governed, event-sourced, single-owner platform where: capital/risk/order each have
one authority; every decision is replayable from the feature store + event log; every
component is adopted-or-removed by CI; `server.js` is <2,000 LOC of thin routing; and
**no edge reaches live without a pre-registered, cost-net, forward-tested hypothesis.**
The moat is not the software — it is *honest, backtested, white-box, single-owner
decisions* that competitors relying on raw-data dashboards cannot match.

### 10-Year Architecture
Optionality, deliberately under-specified (Principle: Unknown stays Unknown). Plausible
directions *if* an edge is proven and capital scales: multi-strategy portfolio
optimization across owned exposure; a true simulation lab (tick replay + synthetic
regimes) as the research substrate; model-lifecycle governance (MDLC) with calibrated
ensembles; regulatory-grade audit (SEBI white-box mandate, 2026-04-01) as a *product
feature*, not a burden. **This section is intentionally not a commitment** — 001-F is
right that "a 24-month roadmap for a platform whose edge was invalidated is fiction."
It is written the day there is a validated edge to project.

### Migration principle throughout
Every step: *provably byte-identical, or an approval package.* Shadow before
authoritative for anything touching money. Never rewrite the kernel.

---

## PART XI — TECH-DEBT LEDGER, HEALTH SCORE, INSTITUTIONAL READINESS

### 11.1 Tech-debt ledger (ranked by irreversibility × money-impact)
| Rank | Debt | Reversible? | Owner to fix | Doc |
|---|---|---|---|---|
| 1 | **No feature store** — inputs discarded, no replay | **No — worsens daily** | Learning/Infra | 030,035 |
| 2 | Capital 3-writer clobber | Yes (shadow) | AccountLedger | 014,005 |
| 3 | Halt fails open | Yes (invariant) | RiskEngine | 013,005 |
| 4 | Look-ahead in 7/8 strategies | Yes (validator) | Backtesting | 008,002 |
| 5 | `charges.js` STT wrong side (~₹20k/129) | Yes | Capital/charges | 030 |
| 6 | Registry bypass (lot ×2) | Yes (delete copy) | Registry adoption | 003 |
| 7 | 92 silent catches | Yes (taxonomy) | Logging | 002,001-C |
| 8 | 0/170 routes authenticated | Yes (mount) | Security | 023 |
| 9 | Config split / 226 env reads | Yes (consolidate) | Config | 004 |
| 10 | 14 timers / 0 clearInterval | Yes (Scheduler) | System | 002 |

### 11.2 Architecture Health Score (this assessment)
Scored 0–10 per dimension; evidence-anchored, not aspirational.

| Dimension | Score | Basis |
|---|---|---|
| Dependency hygiene (cycles) | **9** | zero import cycles, clean kernel [V] |
| Single-source-of-truth | **3** | capital ×3, lot ×2, session ×3, config split [V] |
| State ownership | **2** | 5-engine position split, 3 capital writers [V] |
| Fail-closed on money | **7** | strong instinct, but boot-clobber + STT bug |
| Fail-closed on evidence | **2** | fabricated reliability, uncalibrated prob [V] |
| Testability | **6** | Testing Rule + ratchets exist; 51 suites |
| Observability (mounted) | **2** | built and unmounted (module-contract 404) |
| Security | **1** | 0/170 auth, shared credential |
| Reproducibility | **1** | no feature store, no event source |
| Governance / adoption | **2** | 10 components switched off; 0 ADRs |
| **Composite** | **≈3.5 / 10** | *Level 1 — Functional Application* |

The gap between dimension 1 (9) and the rest is the whole story: **the structure is
sound; the ownership and adoption are not.**

### 11.3 Institutional-Readiness scorecard (live-trading gate)
| Criterion | Status |
|---|---|
| Single capital owner | ✗ (3 writers) |
| Single risk authority + global kill-switch | ✗ (per-engine) |
| One broker door with a pre-trade gate | ✗ (3 sites) |
| Reproducible decisions (feature store + event log) | ✗ (none) |
| A validated, cost-net, forward-tested edge | ✗ (edges invalidated) |
| Auth on every mutating route | ✗ (0/170) |
| **Passed** | **0 of 6 — unchanged across 32 audits** |

**Verdict: not live-ready. The path is known, sequenced, and mechanically possible
(zero cycles). The blocker is governance and adoption, not capability.**

---

## PART XII — WHAT REMAINS UNKNOWN (honest)

- **[U]** Whether Redis boot-restore *merges* or *blind-overwrites* in-memory state on
  conflict (restore path appears to overwrite; not confirmed).
- **[U]** Whether the afternoon/nifty-afternoon closed-position arrays feed the
  daily-loss brake (only SENSEX+NIFTY confirmed).
- **[U]** Whether `database.js` / `data/trading.db/` is wired at all (appears
  vestigial; persistence is JSON-file based).
- **[U]** The 10-year architecture. It is deliberately not committed. It will be
  written the day there is a validated edge to project. *Unknown stays Unknown.*

---

*End of Document 000. This blueprint owns framing and sequence; each numbered doc
(001–050) owns its subsystem's depth; the ratified Rules own conduct; the owner owns
every protected-file commit. Nothing here authorizes code — it authorizes order.*
