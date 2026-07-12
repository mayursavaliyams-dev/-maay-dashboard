# ANTIGRAVITY PRO — INSTITUTIONAL ARCHITECTURE REVIEW

**Scope:** design, not defects. Durability, corruption recovery and fail-open fixes are treated as
complete and are not revisited. Every claim below is measured against the repository at
`f8609ec` + working tree, or against the **running server** (booted 2026-07-10, `paperMode: true`).

**Verdict up front.** The architecture is *not* adequate for a professional desk, and it is not
adequate for the scale the owner has already committed to (11 engine instances today). The single
largest weakness is that **no module owns capital**, and the second is that **no module owns orders**.
Both are proven live, below. Everything else follows from those two.

Ranked by production impact.

---

# 1. There is no capital authority. Boot order decides the account balance.

## ARCHITECTURE PACKAGE

**Current Design.** Each engine owns a private `this.capital`, restored from its own file, and there is
no account object. `execution-engine.js:54` seeds it from `process.env.CAPITAL_TOTAL`;
`restoreEquity()` overwrites it from `data/equity-<inst>.json`; `setConfig()` (`execution-engine.js:113`)
overwrites it again from `config-overrides.json`.

**Why It Becomes A Problem.** The three writers run in file order in `server.js`, and the **last one
wins**. Restored equity — the accumulated result of every closed paper trade — is silently discarded at
every boot.

**Evidence — VERIFIED, on the running server.**

```
boot order (server.js line numbers = execution order):
  3140  engine.restoreEquity()        -> capital = 88011   (from data/equity-sensex.json)
  3304  niftyEngine.restoreEquity()   -> capital = 96761   (from data/equity-nifty.json)
  3712  _loadConfigOverrides() -> setConfig({CAPITAL_TOTAL: 100000})

server log:
  [SENSEX] Restored equity: active ₹88011 + reserve ₹0 = ₹88011 (consec losses: 2)
  [NIFTY]  Restored equity: active ₹96761 + reserve ₹0 = ₹96761 (consec losses: 15)

GET /api/engine/status  ->  capital: 100000
```

The engine restored ₹88,011, then had ₹100,000 written over it 572 lines later. **The half-compound
curve that `recordTradeResult()` maintains is reset to baseline on every restart.** Sizing is computed
from a number that is not the account.

Capital also lives in four unrelated places: `data/equity-nifty.json`, `data/equity-sensex.json`,
`config-overrides.json:STRANGLE_CAPITAL = 700000`, and `config-overrides.json:CAPITAL_TOTAL = 100000`.
`grep -c capital` — `server.js` 12, `execution-engine` 9, `afternoon-engine` 8, `strangle-engine` 6.
Nothing reconciles them. **₹700,000 + ₹100,000 is not an account; it is two numbers.**

**Current Execution Flow.** `constructor(env) → restoreEquity(disk) → setConfig(overrides)` — three
independent writers, no owner, no invariant.

**Recommended Architecture.** One `AccountLedger` module: the sole owner of `capital`, `reserve`,
`peakEquity`. Engines receive an **allocation**, not a balance, and report fills back. Precedence is
declared once — restored state beats config, config beats env — instead of emerging from line numbers.

**Migration Strategy.** (1) Introduce `account.js` with `allocate(engine, amount)` and `applyPnl(fill)`;
back it with the existing atomic writer. (2) Engines take `getAllocation()` instead of reading
`this.capital`. (3) `setConfig` may only change an *allocation*, never a balance.

**Minimal Safe Migration.** One line, today, with no new module: move `_loadConfigOverrides()` above the
`restoreEquity()` calls, or make `setConfig` refuse `CAPITAL_TOTAL` once equity has been restored. This
is a **protected-file change and needs its own approval package.** It stops the bleeding; it does not
create the authority.

**Breaking Changes.** None for the minimal migration. The full one changes every engine constructor.
**Compatibility.** File formats unchanged. **Performance Impact.** None; this is a boot-time ordering.
**Engineering Cost.** Minimal fix: hours. Full `AccountLedger`: 3–5 days across 4 engines.
**Production Benefit.** Sizing stops being wrong. Multi-day compounding becomes real.
**Risk.** Medium — it changes the number every position is sized from. Characterization first.
**Rollback.** `git checkout -- server.js` for the minimal fix.

**Priority: 1.** Nothing else matters if the account balance is fiction.

---

# 2. There is no Order Manager. Eight call sites can place an order.

## ARCHITECTURE PACKAGE

**Current Design.** Each engine calls the broker directly.

**Evidence — VERIFIED.** `grep -rn "placeOrder("`, excluding tests and connectors' own definitions:

```
afternoon-engine.js:518   afternoon-engine.js:669
execution-engine.js:521   execution-engine.js:659
amibroker-bridge.js:623
server.js:1881            server.js:7101
stock/stock-engine.js:417 stock/stock-engine.js:538
```

Eight sites, six modules. There is **no chokepoint**. Nothing enforces idempotency, nothing dedupes,
nothing rate-limits, nothing records intent before the wire. Today `paperMode` (`execution-engine.js:65`)
short-circuits them all — the guard is `if (!this.paperMode && securityId)` at `:519`. **That single
boolean is the only thing standing between eight independent modules and a live broker.**

**Why It Becomes A Problem.** With one broker and paper mode, this is survivable. With `TRADE_MODE=live`
it is an outage waiting for a duplicate order. With a second broker it is unimplementable: each of the
eight sites would need its own routing, retry and reconciliation.

**Recommended Architecture.** A single `OrderManager`: `submit(intent) → orderId`. It owns the
client-order-id, the idempotency key, the retry policy, the broker adapter selection, and the audit
record. Engines emit **intents**, never orders. `paperMode` becomes a property of the *manager*, not of
each engine.

**Migration Strategy.** Add `order-manager.js` as a pure pass-through wrapper first (zero behaviour
change, one call site at a time), then move `paperMode` into it, then add idempotency, then add the
broker adapter registry.

**Breaking Changes.** None if introduced as a pass-through. **Compatibility.** Full.
**Performance Impact.** One function call per order (~µs) against a broker round-trip.
**Engineering Cost.** Pass-through: 1 day. Full manager with idempotency + audit: 1–2 weeks.
**Production Benefit.** A single, testable, auditable path to the market. Prerequisite for live trading
and for a second broker. **Risk.** Low as a pass-through. **Rollback.** Per-call-site revert.

**Priority: 2.**

---

# 3. Nothing knows the portfolio. Eleven engines, eleven private risk brakes.

## ARCHITECTURE PACKAGE

**Current Design.** `server.js` instantiates **11 engine objects** (`ExecutionEngine` ×2,
`AfternoonEngine` ×2, `StrangleEngine`, `GammaBlastEngine`, `AgentsEngine`, `SignalPaperEngine`,
`BounceEngine`, `NewsEngine`, `EventEngine`). At least seven of them can take a NIFTY position.

**Evidence — VERIFIED.**

```
grep -rlE "totalExposure|portfolioRisk|aggregateExposure|netDelta"  ->  NONE
```

**No module computes exposure across engines.** Each engine has its own `maxConsecLosses`, its own
drawdown circuit, its own capital. `execution-engine` can halt on a loss streak while `afternoon-engine`,
`strangle-engine` and `agents-engine` continue adding NIFTY exposure, because none of them can see the
others. The daily-loss brake is per-engine, so the *account* has no daily-loss brake at all.

**Why It Becomes A Problem.** This is the defining property of a hobby system versus a desk system. At
100 strategies it is not a weakness; it is an absence of the product.

**Recommended Architecture.** A `RiskEngine` / `PortfolioManager` sitting between engine intents and the
`OrderManager`. It holds net delta, net vega, per-underlying notional, per-day realised loss, and a
kill-switch. Every intent passes through `riskEngine.check(intent) → allow | reduce | veto`. This is the
`H18` module already described in the project's own design docs, and it is the `critical` input a Meta
Decision Engine is blocked on.

**Migration Strategy.** Build it read-only first: subscribe to fills, publish exposure at `/api/risk`.
Prove the numbers for two weeks. Only then put it in the path.

**Breaking Changes.** None while read-only. **Performance Impact.** In-memory aggregation; negligible.
**Engineering Cost.** Read-only: 3–4 days. In-path with veto: 2 weeks. **Production Benefit.** The
first account-level loss limit the system has ever had. **Risk.** Low read-only; high in-path.
**Rollback.** Feature flag.

**Priority: 3.**

---

# 4. `server.js` *is* the orchestration layer, and it is 7,318 lines of it.

## ARCHITECTURE PACKAGE

**Current Design / Evidence — VERIFIED.**

| measure | value |
|---|---|
| lines | **7,318** |
| routes | **168** |
| `express.Router()` | **0** |
| top-level `let` / `var` | **62** |
| `setInterval` | **14** |
| `clearInterval` | **0** |
| engine instances constructed | **11** |

Engines are wired to each other through closures over those 62 module-scope variables —
`getOpenPosition: () => openPosition`, `setOpenPosition: (p) => { openPosition = p; }`
(`server.js:3119-3120`). Two engines given the same closure share one mutable slot with no arbiter.

**Why It Becomes A Problem.** The file is protected precisely *because* it is dangerous, which means the
most dangerous code in the system is also the code nobody may touch without a package. That is a stable
equilibrium, and a bad one. Every new engine widens it.

**Recommended Architecture.** Extract three things, in order, each behind an unchanged HTTP surface:
(1) an **engine registry** (see #5), (2) a **market-state manager** owning the 62 variables, (3) route
modules mounted with `express.Router()`. `module-contract.js` already exists and already builds a
mountable router — **it needs one approved line to be reachable.**

**Minimal Safe Migration.** `app.use('/api/m', require('./module-contract.js').mountAll());`
Protected file; approval package already written.

**Breaking Changes.** None. **Performance Impact.** None. **Engineering Cost.** One line, then 2–3
weeks of incremental extraction. **Production Benefit.** The monolith stops growing.
**Risk.** Low per step. **Rollback.** Per step. **Priority: 4.**

---

# 5. There is no engine registry. Routing is a ternary, and one endpoint lies.

## ARCHITECTURE PACKAGE

**Current Design.** `server.js:3271` — `const target = inst === 'NIFTY' ? niftyEngine : engine;`

**Evidence — VERIFIED, live over HTTP.** `server.js:3156`:

```js
app.get('/api/engine/status', (req, res) => {
  res.json({ ...engine.status(), halt: engine.getHaltStatus() });
});
```

It never reads `req.query.inst`:

```
GET /api/engine/status?inst=NIFTY   ->  instrument: SENSEX | capital: 100000
GET /api/engine/status?inst=SENSEX  ->  instrument: SENSEX | capital: 100000
```

**An operator checking whether NIFTY is halted is shown SENSEX.** NIFTY currently carries
`consecLosses: 15` against `MAX_CONSECUTIVE_LOSSES=3`; that state is invisible from this endpoint.
The sibling `POST /api/engine/reset` *does* route by `inst`. The two endpoints disagree about what an
instrument is.

**Why It Becomes A Problem.** Ternary routing does not survive a third instrument, and it silently
returns the wrong object rather than failing. At 20 engines this is unmanageable.

**Recommended Architecture.** `engines.get(inst, strategy)` over a registry populated at startup; every
route resolves through it and returns **404 for an unknown key** rather than a default.

**Minimal Safe Migration.** Fix the status endpoint to route like `reset` does. Protected file;
one hunk; needs its own package. *This is a real bug, not a design opinion — it is listed here because
the registry is the design fix.*

**Breaking Changes.** `/api/engine/status?inst=NIFTY` starts returning NIFTY. Any dashboard panel
assuming SENSEX changes. **Engineering Cost.** Endpoint: hours. Registry: 2–3 days.
**Risk.** Low. **Priority: 5.**

---

# 6. Engines have no lifecycle. Shutdown stops nothing.

## ARCHITECTURE PACKAGE

**Evidence — VERIFIED.** Inside `_gracefulShutdown()` (`server.js:7268`):

```
clearInterval | autoEnabled = false | .stop() | server.close()   ->  0 occurrences
```

`server.js` registers **14 `setInterval` timers and calls `clearInterval` zero times.** The shutdown
handler flushes market state and the EOD snapshot, then calls
`setTimeout(() => process.exit(0), 400)`. During those 400 ms every timer keeps firing and every engine
keeps ticking — **after** the EOD snapshot has been written. `app.listen()`'s return value is discarded,
so `server.close()` is not merely absent; it is unreachable.

**Why It Becomes A Problem.** The archive can disagree with the ledger. In-flight HTTP requests are
killed mid-write. And no engine can ever be restarted without restarting the process.

**Recommended Architecture.** An `EngineLifecycle` contract — `start()`, `stop()`, `drain()`,
`healthScore()` — with the orchestrator stopping engines, then timers, then draining HTTP, then
flushing, then exiting. `module-contract.js` already defines `shutdown()` and `shutdownAll()` and
guarantees they never reject.

**Minimal Safe Migration.** Capture the server object and call `server.close()`; stop engines before the
EOD write. Protected file, approval package already drafted.

**Performance Impact.** None. **Engineering Cost.** 2–3 days. **Priority: 6.**

---

# 7. Configuration has three owners and no precedence rule.

## ARCHITECTURE PACKAGE

**Evidence — VERIFIED.** 42 distinct `process.env.*` reads in `server.js`; 12 keys in
`config-overrides.json`; 7 `setConfig()` call sites. The same knob — `CAPITAL_TOTAL` — is written by all
three, and **precedence is whichever line number runs last** (see #1). `MAX_CONSECUTIVE_LOSSES` is read
from env at construction (`execution-engine.js:77`) and can never be changed at runtime, while
`STOP_LOSS_PERCENT` can. Nothing documents which is which.

**Recommended Architecture.** A single `config.js` resolving `defaults → env → overrides → runtime` in a
declared order, exposing a typed, frozen object and a `set(key, value, {persist})` that validates against
one schema. `CONFIG_SPEC` (`server.js:3697`) already contains bounds for a subset — it should be the
schema for all of it, and it should live outside the monolith.

**Breaking Changes.** None if the resolved values are identical on day one — assert that in a test.
**Engineering Cost.** 3–4 days. **Priority: 7.**

---

# 8. The quant kernel is duplicated. Kelly exists four times.

## ARCHITECTURE PACKAGE

**Evidence — VERIFIED.**

```
Kelly:  position-sizer.js   strangle-engine.js   trade-planner.js   vix-kelly-sizer.js
GEX  :  server.js           vol-context.js          (different r, opposite dealer-sign convention)
```

By contrast `charges.js` is required by **12** modules — that is the pattern that works, and it is the
proof that the codebase can do this correctly.

**Why It Becomes A Problem.** Four Kelly implementations are four different position sizes for the same
edge, and the discrepancy is invisible because no test compares them. At 100 strategies the sizing
distribution becomes untraceable.

**Recommended Architecture.** A `quant/` kernel — `kelly()`, `gex()`, `greeks()`, `charges()` — pure,
injected, one implementation each, with a cross-implementation equivalence test as the migration gate.

**Minimal Safe Migration.** Write the equivalence test **first**. If the four Kellys already agree, the
consolidation is mechanical. If they disagree, that disagreement is the finding, and it is a defect
package, not an architecture one.

**Engineering Cost.** 1 week including the equivalence work. **Priority: 8.**

---

# 9. There is no event bus, and therefore no audit trail.

## ARCHITECTURE PACKAGE

**Evidence — VERIFIED.** `EventEmitter` / `.emit(` appears in exactly **one** production module:
`dhan-ws-feed.js`. State changes propagate by direct mutation through injected closures
(`setOpenPosition`, `pushClosedPosition`, `incrementTrades` — `server.js:3119-3122`).

**Why It Becomes A Problem.** There is no way to answer *"why did the system do that at 14:32?"* except
by reading `console.log`. There is no replay. There is no way to add a listener (risk, audit, metrics)
without editing the producer. Every observability requirement becomes a code change in `server.js`.

**Recommended Architecture.** One in-process bus with a typed envelope
(`{ topic, seq, ts, payload }` — already specified in `module-contract.js:wsChannel()`), an append-only
event log, and consumers for risk, audit, metrics and the WebSocket surface. **This is what makes the
replay engine, the audit layer and the observability stack possible; they are all the same investment.**

**Migration Strategy.** Emit alongside the existing closures — a shadow bus with no consumers — and
prove the event stream reconstructs the ledger before anything depends on it.

**Engineering Cost.** Bus + shadow emission: 1 week. Consumers: incremental.
**Production Benefit.** Replay, audit, observability, and the WebSocket surface, from one investment.
**Priority: 9.**

---

# 10. The observability layer exists and is not plugged in.

## ARCHITECTURE PACKAGE

**Evidence — VERIFIED.** `module-contract.js` builds health, metrics, version, config (secret-redacted),
OpenAPI, structured logging, shutdown and health-score for any module from one descriptor, with 114
assertions and an HTTP smoke test. **One module has adopted it** (`pop-seller.service`). **Zero of its
routes are reachable**, because mounting requires one line in the protected `server.js`, and
`app.listen()`'s discarded return value means `/ws` can never attach.

`/healthz` is the only health endpoint. It reports `status: "ok"` and process uptime. It does not know
whether an engine is halted, whether a ledger is corrupt, or whether the broker feed is stale. Today
NIFTY sits at `consecLosses: 15` and `/healthz` says `ok`.

**Why It Becomes A Problem.** A desk runs on the health endpoint. This one cannot fail.

**Recommended Architecture.** Mount `mountAll()`; give each engine a service descriptor; let
`/api/m/health` aggregate. The contract already refuses to report `ok` without evidence, dilutes the
score with unknown checks, and ranks `UNKNOWN` above `DEGRADED`.

**Minimal Safe Migration.** The one approved line. **Engineering Cost.** Hours, then one descriptor per
engine. **Production Benefit.** The system can finally say when it is sick. **Priority: 10.**

---

## What is already right, and should not be changed

- **`safe-write.js`** is the correct shape: a pure leaf, injected, fail-closed. It is the model the
  `quant/` kernel should copy.
- **`charges.js` with 12 dependents** proves the codebase can centralise a calculation when it decides to.
- **`instrument-registry.js`** is a genuine single source of truth with a fail-closed two-surface design
  (`trading` vs `catalog`) and a broker-verification preflight. It is better than most desks have.
- **`module-contract.js` and `engine-verdict.js`** are the right abstractions, written before they were
  needed. The problem is that they are not mounted, not that they are wrong.

## The honest summary

Findings 1, 2 and 3 are one finding wearing three hats: **there is no authority in this system.** No
module owns capital, no module owns orders, no module owns risk. Eleven engines each own a fragment of
all three and cannot see one another. Everything from #4 down is a consequence of that absence, or a
symptom of the monolith that fills the vacuum.

The cheapest step with the largest effect is **#1's minimal migration** — stop `setConfig` from
overwriting restored equity. It is a protected-file change, it is a few lines, and until it lands, every
position in this system is sized from a number that is not the account.
