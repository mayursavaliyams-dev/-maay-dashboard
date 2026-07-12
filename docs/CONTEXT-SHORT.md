> **SUPERSEDED — do not send this file.**
> `docs/STATUS.md` is the single source of truth. It is self-contained.
> This file is kept only as history / detail, and is referenced from STATUS.md when needed.

---

# ANTIGRAVITY PRO — CONTEXT (short)

Paste this whole file into ChatGPT. It is self-contained. The long version is
`docs/MASTER-CONTEXT.md` — only send that if the assistant asks for detail.

**Project.** Indian index-options research platform. Node.js/Express, runs locally.
**100% paper trading. No live order execution.** `server.js` = 7,301 lines, 168 routes, monolith.
127 JS modules, 36 test suites. Brokers: Dhan, Upstox. HEAD `f8609ec`, nothing pushed.

**The validated edge is option SELLING (volatility risk premium).**
Directional option **buying has no edge**: 1,200-trade real-data backtest, **PF 0.94**, a net loser.
`strangle-engine.js` (paper) is the product face. `gamma-blast-engine.js` is the one buying strategy
with a rationale (gamma beats theta at 0-DTE) and is forward-test only.

---

## 1. Rules that override everything

- **Never rewrite. Enhance only.** `server.js` and `execution-engine.js` are **protected** — each edit
  needs the owner's individual approval (impact + risk + exact diff + rollback + test plan).
- **Never commit unasked. Never push. No live trading.**
- **Root cause before fix. Smallest safe change. One concern per commit. Rollback always possible.**
- **Characterization test first** — pin the bug, prove the test fails, then fix.
- **Run the full suite gated on exit code**, never on grepping output. Never commit a red suite.
- **FAIL CLOSED. Never invent market behaviour. Unknown ≠ Zero. `null ≠ 0`.**
  If evidence is missing: return `null`, say why, stop.
- **Classify every claim: Verified / Probable / Hypothesis / Unknown.**
- **Verify a module is absent before saying it is absent.** (`git ls-files`, read the header.
  This document once wrongly reported four existing modules as missing.)
- Replies to the owner in **Gujarati script**; code, paths, identifiers stay English.

### The AI Architecture Rule (ratified 2026-07-09)

- **No engine may directly recommend or execute trades.** Every engine returns only an `EngineVerdict`.
- **Only the Meta Decision Engine (future H15) may combine engine outputs.**
- Every engine exposes: `status`, `score`, `confidence`, `reliability`, `limitations`,
  `missingEvidence`, `assumptions`.
- **No engine may output BUY / SELL.** Decision belongs to Meta Decision alone.
- **No calibrated Meta Decision exists today.** Therefore: all strategy engines are **advisory**,
  **no probabilities may be published**, **no execution is permitted.**

```jsonc
{ "engine": "smart-money", "engineVersion": "0.1.0",
  "status": "ok" | "abstain" | "error",
  "score": -1..+1 | null,        // null, NEVER 0, when status ≠ ok
  "confidence": 0..1 | null,
  "reliability": 0..1 | null,    // MEASURED out-of-sample. null ⇒ weight 0 ⇒ veto-only
  "sampleSize": 41 | null, "dataQuality": 0..1,
  "limitations": ["underlying volume is zero by construction"],
  "missingEvidence": [{ "input": "risk-engine", "reason": "module absent" }],
  "assumptions": { "r": 0.065, "oi_unit": "UNVERIFIED" },
  "abstainReason": "...", "computedAt": "ISO-8601" }
```
**No engine has a `decision` field.**

**Compliance today — measured, not assumed.** The rule is a target; the code does not meet it.
`EngineVerdict` exists in 5 documents and **0 JavaScript files**. `missingEvidence`, `assumptions`,
`abstainReason` appear in **no module**. **15 modules emit BUY/SELL.** Not one exposes `limitations`.
**Four engines act on their own signal** (all paper): `execution-engine`, `afternoon-engine`,
`agents-engine`, `signal-paper-engine`.

**Open deadlock, owner's to resolve.** `reliability` must be *measured out-of-sample*; out-of-sample
outcomes come from running engines. There are 41 outcomes; ~200 are needed. Those outcomes are produced
by exactly the four paper self-executors the rule would silence. **Read literally, the rule stops the
forward tests that generate the evidence that unblocks the rule.**

**Owner decision, 2026-07-09.** (1) **Paper forward-test execution continues** and is the *only* sanctioned
execution — no broker order, ever; nothing published as a recommendation or a probability. (2) **The
migration is additive:** add `verdict()` to each engine *alongside* its existing method
(`reliability: null`, honest `limitations`); the BUY/SELL emitter stays until H15 consumes the verdict.
**No caller breaks.**

### The Dashboard Rule (ratified 2026-07-09)

The dashboard is a **visualization layer**. It never computes market logic. All calculations originate
inside engines. It **may cache. May aggregate. May reconcile** (recompute *only* to cross-check an engine
value and show ✗ on disagreement — it never replaces it). It must **never duplicate business logic**.
The single source of truth stays inside engines.

**The defect this rule caught, measured.** `dashboard.html` carried `const LOT = { NIFTY:75, ... }` and
recomputed open-condor P&L in the browser. The broker-verified registry says NIFTY is **65**. Every open
NIFTY position was overstated by **15.38%** — and `qty` was dropped, so a two-lot condor rendered at one
lot. A real position showing ₹2,250 was truly ₹3,900. `strategy.html` had the same table with NIFTY 75
**and** BANKNIFTY 35 (truth: 30), plus a `|| 75` fallback that extended the guess to every new instrument.

**Root cause was the engine, not the browser.** `strangle-engine` published the legs but neither the
contract size nor a mark-to-market, so the page had nothing to render and reinvented the arithmetic.
Fix: the engine publishes `lot`, `qty`, `entryNet`, `nowNet`, `unrealizedPnl` — and `null` with a stated
reason when it cannot know (a leg with no live LTP; an instrument with no verified lot). Browser metadata
is **generated** from the registry (`npm run gen:instrument-meta`), never hand-maintained, with a drift
tripwire in `test/dashboard-rule.test.js`.

**If the engine does not publish the number, someone downstream will compute it — and get it wrong.**

### The API Rule (ratified 2026-07-09)

Every future module exposes: **REST · WebSocket · Health · Metrics · Version · Configuration · OpenAPI ·
Structured logging · Graceful shutdown · Health score.**

**An engine is not a service.** The engine core stays pure and returns an `EngineVerdict`; a **service
adapter** exposes the eleven surfaces. `module-contract.js` builds all eleven from one descriptor
(100 assertions, HTTP smoke test). `pop-seller.service` is the first adopter.

**Two blockers, measured.** (1) All **168 routes live in `server.js`**, which is protected and uses **zero
`express.Router()`**. `mountAll()` needs exactly **one approved line** — `app.use('/api/m', mountAll())` —
after which every module has its surfaces. (2) **There is no WebSocket server**: `ws` is used only as a
broker *client* in `dhan-ws-feed.js`, and `server.js` discards the `http.Server` from `app.listen()`. So
`/ws` answers **501** and reports `attached:false`. *An unimplemented surface that reports itself present
is worse than an absent one.* Also: `_gracefulShutdown` never calls `server.close()` — it can't.

**What the contract refuses.** No evidence ⇒ health `'unknown'`, never `'ok'`. No measurable check ⇒
`healthScore: null`, never 0 and never 1. An unknown check **dilutes** the score (1 ok + 1 unknown = 0.5).
`UNKNOWN` outranks `DEGRADED` in the rollup. `/config` redacts **deny-by-default** (`.env` holds
`DHAN_ACCESS_TOKEN`, `UPSTOX_ACCESS_TOKEN`, `AUTH_SECRET`) — it may over-redact, never under-redact; log
fields too. Metrics omit `NaN`/`Infinity` rather than emit 0. `shutdown()` never rejects.

### The Testing Rule (ratified 2026-07-09)

Every new module requires: **Characterization · Unit · Integration · Regression · Performance ·
Memory Leak · Failure · Rollback Validation.** Enforced by `test/testing-rule.test.js` via `@test:`
markers. Coverage today: **5 of 41 suites; 36 predate the rule** — a ratchet that may only go down.

**One honest amendment.** A brand-new module *cannot* have a characterization test: characterization
pins behaviour that already exists so a change cannot silently alter it. For code written five minutes
ago there is nothing to pin, and the test passes on the day it is written no matter what the code does.
So: **changing** existing code ⇒ characterization first, proven to fail on the live bug. **Creating** a
new module ⇒ contract tests (unit + failure); characterization becomes mandatory on first change.

**What writing these suites found.** (1) The suite went **red at midnight with no code change**:
`scanPoP` read `new Date()` internally, an estimated premium landed on 0.504, the raw filter
`ltp > 0.5` admitted it, and `toFixed(2)` published it as `0.50`. The clock is now injected and the
filter runs on the *published* premium. **A test whose verdict depends on the wall clock is not a
test.** (2) `pop-seller`'s book grew forever — `popStatus()` returned **1.4 MB / 5,002 positions, one
open**, on a dashboard timer. (3) Underneath it, **silent data loss**: `_saveBook()` wrote
`_book.slice(-2000)` — the last 2,000 rows *by insertion order* — so a long-held **open** position at
the front of the array was **dropped from disk** and vanished on restart. Open positions are state;
closed ones are an audit trail. Only the audit trail is capped now.

**How to write these tests.** Performance thresholds are generous by design (catch order-of-magnitude
regressions, not 10% drift on a busy machine). The primary memory-leak assertion is **deterministic**,
not heap-sampled; the heap check runs only under `--expose-gc` and **prints that it was skipped**
otherwise — *a test that did not run must never look like a test that passed*. Rollback validation =
every pre-existing export unchanged, new arguments optional, `server.js` referencing nothing new. No
suite may write to production state (asserted byte-identical).

### Performance Targets (ratified 2026-07-09) — **1 verified, 4 missed, 3 unknown**

`npm run perf:report`. **A target is met, missed, or UNKNOWN — never met by silence.**

| target | state | evidence |
|---|---|---|
| API < 50 ms | UNKNOWN | needs a running server; the report **refuses to boot `server.js`** (booting starts the engines and writes the forward-test ledger). Proxy: `module-contract` `/health` p95 **1.4 ms**. The 168 real routes are unmeasured. |
| WebSocket < 100 ms | UNKNOWN | no WebSocket server exists. Cannot be met; cannot be missed. |
| Dashboard refresh 250 ms | MISSED | 16 timers, fastest 1,000 ms. **250 ms is a render budget, not a poll interval** — 16 timers at 250 ms = 64 req/s per tab against a single-threaded monolith. Blocked on the WebSocket server. |
| Memory leak 0 | VERIFIED | bounding invariants asserted; heap corroborated under `--expose-gc`. Zero-leak cannot be *proven* by heap sampling. |
| CPU under 20% | UNKNOWN | `cpuUsage()` in a test process measures the wrong process |
| All writes atomic | MISSED | 6 raw `writeFileSync` (4 in protected `server.js`, 1 fake-fs seam) |
| All reads validated | MISSED | 13 unvalidated `JSON.parse(readFileSync)` (11 in `server.js`) |
| No silent catch | MISSED | **114** across 19 files; **73 in `server.js`** |

**A fail-open this target found.** `event-risk-filter.loadCalendar` did `catch (_) { return [] }`. An
empty calendar means *"checked, nothing scheduled — trade on."* So a corrupt calendar **silently
disarmed the event-risk filter** on RBI/budget/CPI days. It cannot throw (its caller is protected
`server.js` at module scope), so corruption now rides on a **non-enumerable** `corrupt` flag and
`assess()` returns `REDUCE`, `sizeScale: 0.5`. **Absent vs corrupt is decided by `ENOENT`, not
`existsSync`** — the first version of the fix demanded `existsSync` and broke every injected fake `fs`.

---

## 2. Measured constraints — do NOT re-litigate these

Each was measured against the running code, the files on disk, or the live broker API.

| id | fact | what it forbids |
|---|---|---|
| **F1** | lot size is time-varying and lives in the data (50 → 25 → 75 → 65) | using today's lot in a backtest |
| **F2** | 45% of option rows never traded; OHLC is NULL, only `SttlmPric` is meaningful | treating the chain as OHLC |
| **F3** | no futures feed ⇒ no observable forward ⇒ `r` and `q` are **assumptions** | claiming a "market-implied" rate |
| **F4** | `oi_unit` is **UNVERIFIED** — contracts vs shares | **GEX is withheld. It would be wrong by 25–75×** |
| **V1** | the underlying has **ZERO volume** by construction | Wyckoff, volume profile, absorption |
| **M2** | **41 labelled outcomes** exist in total | calibrated probability, empirical CVaR, Brier optimisation, ensembles |
| **P1** | **4 distinct trading days** of intraday history | correlation matrices (15 params, 4 obs), regime models |
| **P3** | **no daily NAV series exists anywhere** (`equity-*.json` are scalar snapshots) | Sharpe, Sortino, Calmar, drawdown, all of portfolio intelligence |
| **E1** | `charges.js`: `.env.example` says STT `0.0625` / exch-txn `0.053`; code says `0.1` / `0.03503` | **which pair is right is Unknown.** Both wrong, in opposite directions, cancelling to −0.33%. Needs the exchange circular. Do not guess |

**Instrument Registry** (`instrument-registry.js`) is the single source of truth, broker-verified.
NIFTY lot 65 step 50 expiry **Tue** · BANKNIFTY 30/100/Tue · SENSEX 20/100/**Thu** (BSE).
FINNIFTY, MIDCPNIFTY (step **25**), BANKEX exist but `tradingEnabled: false`.
Reading metadata is not permission to trade. **Never hardcode market constants anywhere else.**

---

## 3. C3 — atomic writes: **COMPLETE**

The old idiom `try { JSON.parse(readFileSync(f)) } catch { return [] }` + `writeFileSync` destroyed data:
crash mid-write → truncated file → parse throws → `[]` returned → next save writes `[]` over the ledger.
Measured under a concurrent reader: **256 reads → 41 unparseable, 199 empty (94% corrupt).**

`safe-write.js` (validate-by-reparse → temp in same dir → `fsync` → atomic `rename`; `readJsonSync`
recovers from `.bak` and **throws rather than guessing**). Same test: **441 reads, 0 corrupt.**

**All 15 writers migrated.** A missing ledger yields the fallback; a corrupt one recovers from `.bak`;
an unrecoverable one marks the engine corrupt and **refuses to save**, so the bytes survive.

**Worst finding:** `execution-engine` and `afternoon-engine` both swallowed a corrupt equity file, leaving
`consecLosses = 0` — **silently disarming the halt-after-N-losses brake, exactly when a crash had just
happened.** Both now HALT. For a risk brake, **"state unknown" must mean "brake ON."**

Two caveats, stated honestly: **atomicity is not mutual exclusion** (it prevents corruption, not lost
updates); and directory-entry `fsync` returns `EPERM` on Windows — reported as `dirDurable:false`,
never pretended.

**Still raw: the 10 write sites inside `server.js` (protected).**

**Rule for any new code: no ledger may call `fs.writeFileSync`. Go through `safe-write.js` or not at all.**

---

## 4. Suggestions this codebase has already disproved

- *"Just use the TradingView API"* → there is none for Pine or Strategy Tester.
- *"Use range as a volume proxy" / "Wyckoff works on price alone"* → Wyckoff **is** effort vs result.
- *"Compute CVaR from the 41 trades"* → the tail estimate rests on ~2 observations.
- *"Monte Carlo will validate it"* → it propagates assumptions; it cannot detect a wrong model.
- *"Fill a missing engine with a neutral 0.5"* → that manufactures confidence from nothing. Use `null`.
- *"OI is obviously in contracts"* → unverified; it scales GEX by 25–75×.
- *"Report the portfolio Sharpe"* → there is no daily NAV series. It does not exist.
- *"Diversify across the five strategies"* → they all trade the same index; correlation is ~1 by
  construction. Use netting, not correlation.
- *"Ensemble the engines and optimise the Brier score"* → every engine has `reliability: null`, and 41
  samples is optimisation of noise.
- *"Postgres/TimescaleDB for the data lake"* → 15.5 M rows; DuckDB + Parquet, embedded, no server.
- Purged k-fold, deflated Sharpe and PSR already exist in `bt-validate.js`. **Reuse; never reimplement.**

---

## 5. What to do next, in order

1. **`server.js` write-site package — PROTECTED, one site at a time, owner approval each.**
   Start with `config-overrides.json` (`:3675`, `:3747`): it holds `STRANGLE_ENGINE_ENABLED` and
   `STRANGLE_CAPITAL: 700000`; a torn write silently reverts every engine to defaults.
   **Last, separately: `:2028` rewrites `.env`, which holds broker tokens — needs `mode: 0o600`.**
2. **Start capturing intraday option chains today.** Gates gamma/dealer/flow research at once.
   Every day of delay is a day permanently lost.
3. **Log the outcome of every engine's hypothetical call.** 41 → 200 unblocks all probability work.
   Cheapest item on the roadmap.
4. **Write a daily NAV series** (per book, net of charges). Everything in portfolio intelligence needs it.
5. **TD-4** — boot-time advisory lock on `data/` (`withLock` already exists in `safe-write.js`).
6. Resolve **F4** (`oi_unit`) against a live NSE chain. One afternoon; unblocks GEX permanently.
7. **Risk Engine**, then probability/decision layers. Structural, needs no history.

**Do not build the dashboard, replay, or portfolio intelligence first.** They render data that does not
yet exist.

### Known debt
`option-analyzer.js:166` fallback Greeks hardcode `volatility = 0.15`, discarding the live IV (TD-1) ·
one shared `OptionAnalyzer` mutated per request (TD-2) · Kelly implemented **three times, disagreeing** ·
two GEX implementations with different `r` and **opposite dealer-sign conventions** · 105 silent
`catch (_) {}` (58 in `server.js`) · `pop-seller.buildIronCondor` returns two short legs and **no wings**
— unbounded loss under a name promising defined risk · 18/21 UI pages still carry private CSS token
blocks that have drifted (10 backgrounds, 5 greens).

---

## 6. If you are asked for a Master Prompt

You can generate one. Make it self-contained so it can be pasted into a fresh session and work continues
with no context loss. It **must carry Sections 1, 2 and 3 above verbatim** — otherwise the next session
will confidently rebuild the same wrong things.

Structure it as: **A.** status to verify first · **B.** the measured constraints (copy them) ·
**C.** the brief: role, objective, MUST build / MUST NOT build **with the reason for each refusal** ·
**D.** the questions the module must answer *with measurements* before any code is written.
