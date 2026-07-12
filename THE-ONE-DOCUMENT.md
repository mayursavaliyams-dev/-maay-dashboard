# ANTIGRAVITY PRO — THE ONE DOCUMENT

**This is the only file you need.** Paste it whole into ChatGPT. Everything else in `docs/` is either
history or an approval package referenced from here. Do not send them unless asked.

**State: 2026-07-10, after the boot-order capital fix.** Suite **46/46 green**, gated on exit code,
three consecutive runs. Git HEAD `f8609ec`. **Nothing committed. Nothing pushed.**

`execution-engine.js` — untouched. `server.js` — carries **three owner-approved patches** (7 hunks:
P1-T1, P1-T2, and the boot-order reorder); its remaining **8 raw write sites** are untouched, each
needing its own approval.

**The server is running right now**, `paperMode: true`, and `GET /api/engine/status` reports
`capital: 88011` — the real account, for the first time.

The project is a **100% paper-trading** Indian index-options research platform (Node/Express, local).
No live order execution.

> **THE PLATFORM HAS NO VALIDATED EDGE.** Corrected 2026-07-10 by
> `docs/REVIEW-selling-edge-invalidated.md`. The claim *"the validated edge is option selling"* rested
> on `bt-strangle-costs.js`, which **selects its strikes using the closing price of the day it trades**
> and sells them at that day's open. Independently replicated: the shipped result is 88.4% win, PF 7.41.
> With the look-ahead removed — strikes chosen from yesterday's close, everything a trader knows at
> 09:15 — the same strategy wins **46.5%** at **PF 0.55**, losing ₹79,899 over 600 days. It also
> hardcodes `LOT = 75`, which is wrong on **59.3%** of those days.
>
> Directional option **buying** has no edge either: PF 0.94 over 1,200 trades, and
> `docs/REVIEW-bt-real-lookahead.md` shows the 600-day buying backtest fails at PF 0.84 **even with
> look-ahead**.
>
> **Both sides of the book are unsupported by their own backtests.** This does not disprove the
> volatility risk premium — no literature was consulted. It means the evidence offered here is invalid.
> The only uncontaminated evidence is the paper forward-test: **7 closed strangle trades.** Constraint
> M2 already declares that insufficient.

---

## 1. Non-negotiable rules

- **Never rewrite. Enhance only.** `server.js` and `execution-engine.js` are **protected**: every edit
  needs an individual approval package (evidence, root cause, exact diff, risk, rollback,
  characterization test, regression tests, performance).
- **Never commit unasked. Never push. No live trading.**
- **Characterization test first** — pin the bug, prove the test fails, then fix.
- **Run the full suite gated on exit code**, never on grepping output. Never commit a red suite.
- **Fail closed. Unknown ≠ Zero. `null ≠ 0`.** Missing data returns `null`, never 0, never 0.5,
  never "neutral". Refuse rather than guess.
- **Never invent market behaviour.** Classify every claim: Verified / Probable / Hypothesis / Unknown.
- One defect → one root cause → one characterization test → one fix → one commit.
- Replies to the owner in **Gujarati script**; code, paths and identifiers stay English.

### The four ratified architecture rules

| rule | what it says | enforced by |
|---|---|---|
| **AI Architecture** | engines return only an `EngineVerdict`; **no engine emits BUY/SELL**; only a future Meta Decision Engine decides | `engine-verdict.js` + suite |
| **Dashboard** | the dashboard visualizes; it **never computes market logic**. It may cache, aggregate, and *reconcile* (recompute only to cross-check an engine and show ✗ on disagreement) | `test/dashboard-rule.test.js` |
| **API** | every module exposes 11 surfaces (REST, WebSocket, health, metrics, version, config, OpenAPI, structured logging, graceful shutdown, health score, EngineVerdict). **An engine is not a service** — the rule binds the *service adapter*, not the pure engine core | `module-contract.js` + suite |
| **Testing** | 8 categories per module. **A brand-new module cannot have a characterization test** — there is no prior behaviour to pin, and such a test passes on the day it is written no matter what the code does. New module ⇒ contract tests; characterization becomes mandatory on first change | `test/testing-rule.test.js` |

---

## 2. Measured constraints — do NOT re-litigate

Each was measured against the running code, the files on disk, or the live broker API.

| id | fact | what it forbids |
|---|---|---|
| **F1** | lot size is time-varying and lives in the data (50 → 25 → 75 → 65) | using today's lot in a backtest |
| **F2** | 45% of option rows never traded; OHLC is NULL, only `SttlmPric` is meaningful | treating the chain as OHLC |
| **F3** | no futures feed ⇒ no observable forward ⇒ `r` and `q` are **assumptions** | claiming a market-implied rate |
| **F4** | `oi_unit` **UNVERIFIED** — contracts vs shares | **GEX is withheld. It would be wrong by 25–75×** |
| **V1** | the underlying has **ZERO volume** by construction | Wyckoff, volume profile, absorption |
| **M2** | **55 labelled outcomes** platform-wide (measured 2026-07-10): `ai-agents` 23, `signal-engine` 12, `signal-paper` 12, `strangle` 7, `gamma-blast` **1**. It was 50 earlier this session — the running paper engines accrue outcomes, which is the *only* mechanism that will ever unblock M2 | calibrated probability, empirical CVaR, Brier optimisation, ensembles |
| **P1** | **4 distinct trading days** of intraday history | correlation matrices (15 params, 4 obs), regime models |
| **P3** | **no daily NAV series exists anywhere** | Sharpe, Sortino, Calmar, drawdown, all portfolio intelligence |
| **E1** | `charges.js`: `.env.example` says STT `0.0625` / exch-txn `0.053`; code says `0.1` / `0.03503` | **which pair is right is Unknown.** Both wrong, opposite directions, cancelling to −0.33% — the near-cancellation *is* the hazard. Needs the exchange circular. **Do not guess** |

**The consequence that shapes everything:** no engine's `reliability` can be measured, so every
`reliability` is `null`, every weight is 0, and a weighted ensemble is **mathematically empty**.
A Meta Decision Engine v1 can therefore only ever return `INSUFFICIENT_DATA`. That is the honest
answer, not a bug.

**Instrument Registry** (`instrument-registry.js`) is the single, broker-verified source of truth:
NIFTY lot 65 step 50 expiry **Tue** · BANKNIFTY 30/100/Tue · SENSEX 20/100/**Thu** (BSE).
FINNIFTY, MIDCPNIFTY (step **25**), BANKEX exist but `tradingEnabled: false`.
**Reading metadata is not permission to trade. Never hardcode market constants anywhere else.**

### Suggestions this codebase has already disproved

*"Report the portfolio Sharpe"* (no NAV series) · *"OI is obviously in contracts"* (unverified) ·
*"Compute CVaR from the trades"* (the tail rests on ~2 observations) · *"Monte Carlo will validate it"*
(it propagates assumptions; it cannot detect a wrong model) · *"Fill a missing engine with a neutral
0.5"* (that manufactures confidence from nothing) · *"Diversify across the five strategies"* (they all
trade the same index) · *"Just use the TradingView API"* (there is none for Pine or Strategy Tester) ·
*"Use range as a volume proxy"* (Wyckoff **is** effort vs result). Purged k-fold, deflated Sharpe and
PSR already exist in `bt-validate.js` — reuse, never reimplement.

---

## 3. What is DONE

### 3.1 C3 — atomic writes, complete across every engine

The old idiom destroyed data: crash mid-write → truncated file → `JSON.parse` throws →
`catch { return [] }` → `[]` written over the ledger. Measured under a concurrent reader:
**256 reads → 41 unparseable, 199 empty (94% corrupt)**. With `safe-write.js`: **441 reads → 0 and 0**.

All 15 module writers migrated. Each pairs the atomic write with `readJsonSync`: a **missing** file
yields the fallback, a **corrupt** one recovers from `.bak`, an **unrecoverable** one marks the engine
corrupt and **refuses to save**, so the bytes survive for forensics.

**Two risk brakes were failing OPEN.** `execution-engine.restoreEquity()` and
`afternoon-engine.restoreEquity()` both swallowed a corrupt equity file, leaving `consecLosses` at 0 —
silently disarming the halt-after-N-losses brake, *exactly when a crash had just happened*. Both now
HALT. For a risk brake, **"state unknown" must mean "brake ON."**

Two caveats, stated honestly: **atomicity is not mutual exclusion** (it prevents corruption, not lost
updates); directory-entry `fsync` returns `EPERM` on Windows — reported as `dirDurable:false`, never
pretended.

### 3.2 The dashboard was showing a wrong number, live

`dashboard.html` carried `const LOT = { NIFTY: 75, … }` and recomputed open-condor P&L in the browser.
The registry says NIFTY is **65**. It also dropped `qty` entirely.

A live 2-lot NIFTY condor (entry 135 → now 105) rendered **₹2,250**. The truth is **₹3,900** — the page
showed **58%**. The two errors pulled in opposite directions (lot 75 overstated 15.4%; dropping `qty`
halved it), which is why it never looked absurd enough to notice. `strategy.html` had the same table
with NIFTY 75 **and** BANKNIFTY 35, plus a `|| 75` fallback.

**Root cause was the engine, not the browser.** `strangle-engine` published the legs but neither the
contract size nor a mark-to-market, so the page reinvented the arithmetic. The engine now emits `lot`,
`qty`, `entryNet`, `nowNet`, `unrealizedPnl` — and `null` **with a stated reason** when it cannot know.
Browser metadata is **generated** from the registry (`npm run gen:instrument-meta`) with a drift
tripwire. Ratchet: pages with a lot table **2 → 0**.

### 3.3 Silent data loss, in code written during C3

`pop-seller._saveBook()` persisted `_book.slice(-2000)` — the last 2,000 rows **by insertion order**.
A position opened Monday and still open sits at the **front**. After 2,000 later round-trips it fell
outside the window and was **silently dropped from disk**; on restart the live position did not exist.

> A cap meant to protect the file was deleting the only rows that cannot be reconstructed.
> **Open positions are state. Closed positions are an audit trail.** Only the trail is capped now.

Alongside it, an unbounded leak: after 5,000 round-trips `popStatus()` returned a **1.4 MB JSON** with
5,002 positions, of which **one** was open — on a dashboard timer.

### 3.4 `config-overrides.json` destroyed itself on a corrupt read — 2 of 3 writers fixed (approved)

The file holds twelve keys including `STRANGLE_CAPITAL: 700000` and `MAX_DAILY_LOSS_PERCENT: 5`, and
had no backup. Three `server.js` call sites did the same read-modify-write:

```js
try { existing = JSON.parse(fs.readFileSync(PATH, 'utf8')); } catch (_) {}
fs.writeFileSync(PATH, JSON.stringify({ ...existing, ...patch }, null, 2));
```

**The data was destroyed on the READ, not the write.** `catch (_) {}` collapses *"corrupt"* into
*"empty"*, and the next statement spreads that empty object back to disk. Reproduced on a copy of the
live file: **12 keys → 1**, `STRANGLE_CAPITAL` gone, nothing logged.

Fixed under approval: **P1-T1** `_persistEngineOverride`, **P1-T2** `POST /api/gamma-blast/enable`.
Both recover from `.bak` and **refuse to write** when unrecoverable.

**A partial migration is itself a hazard.** After P1-T1 the file had a `.bak`, but the gamma-blast
handler still wrote raw — updating the file while leaving the backup **stale**, so a later recovery
would silently revert a setting the operator had just changed. Pinned by test.

### 3.5 An absent India VIX read as a calm one — FIXED (`event-risk-filter.js`)

```js
const vix = Number(i.vix) || 0;      // null, undefined, NaN and 0 all become 0
```

Zero is below every threshold, so an **unreachable** volatility reading scored exactly like a **calm**
market and the gate on new premium selling silently stopped gating — precisely when volatility was
least knowable. **India VIX is never 0. A zero means "no reading", not "no volatility."**

The fix was blocked on an unmeasured question: if `ivImplied` is usually absent, failing closed would
pin the gate at `REDUCE` forever and halve paper sizing. **Answered by running the real path, not by
reasoning about it:** `eventEngine.getVix()` returned **12.34 in 4,513 ms**. The value is normally
present, so the fix engages only during an outage. Now: `REDUCE`, `sizeScale 0.5`, `vixUnknown: true`,
`vix: null`, and the reason names the missing evidence. A HIGH-impact event still BLOCKs; two unknowns
compound rather than cancel.

### 3.6 `event-engine.eventRiskScore()` — two Unknown-as-Zero defects — **FIXED** (2026-07-10)

**B.** `vixLift = vix.value ? … : 0`. An unreachable India VIX got a lift of **zero** — identical to a
perfectly calm reading of 14. **C.** `TYPE_WEIGHT[e.type] || TYPE_WEIGHT.OTHER`. A budget day typed
`BUDGET_2026` scored **30 (LOW)** instead of 95 (HIGH). *This suite's own first draft typed `RBI`
instead of `RBI_POLICY` and scored an RBI policy day as `OTHER` — the defect caught its own author.*

**No number was invented.** The event component *is* measured, so `score` still reports it, unchanged.
The OTHER weight remains the floor for an unknown type, because no honest weight exists. What was
**withdrawn is the claim about the level**: a composite risk level computed from a component nobody
observed is a false statement wearing a measurement's clothes. `level: 'UNKNOWN'`, plus `unknowns`
naming exactly what is missing. Two unknowns **compound and are both named — neither masks the other.**

**Why `score` was deliberately left alone.** `server.js:5779` reads `.score` through
`Number(…) || 0`. Returning `null` would become **0**, and `cEvent` would then read **100 —
maximally safe to sell**. *Failing closed on the score would have failed open one layer up.* The numeric
path is fixed by the protected package `docs/APPROVAL-regime-unknown-vix.md`. `level` is consumed only
as a display label (`server.js:5401`), which is why it can safely carry `UNKNOWN`.

Detail: `docs/TASK-20260710-002.md`. `test/event-engine.test.js` 73 → **99 assertions**.

### 3.7 Boot order overwrote the account balance — **FIXED** (2026-07-10, owner-approved)

Three writers set `this.capital`, in `server.js` line order, and **the last one won**:

| order | line | writer | value |
|---|---|---|---|
| 1 | `execution-engine.js:54` | `process.env.CAPITAL_TOTAL` | 100000 |
| 2 | `server.js:3140` / `:3304` | `restoreEquity()` | **88011 / 96761 — the real account** |
| 3 | `server.js:3712` | `_loadConfigOverrides()` → `setConfig()` → `execution-engine.js:113` | 100000 |

Measured on the running server, before the fix — the boot log printed
`[SENSEX] Restored equity: ₹88011`, and `GET /api/engine/status` then served `capital: 100000`.

**`capital` is not only a sizing input. It arms the daily-loss brake** (`execution-engine.js:302`,
`if (todayLoss < -(this.capital * this.maxDailyLossPct))`). SENSEX's brake was armed at ₹5,000 instead
of ₹4,400.55 — **13.6% more loss than the account permits.**

**The asymmetry is what made it structural.** As the account bleeds, `recordTradeResult()` shrinks
`capital` and the brake tightens — by design. Every restart reset it to ₹1,00,000 and the brake
loosened again. **A losing account never reduced its risk.** And an account grown past ₹1,00,000 was
*under*-sized after a restart, so the half-compound curve could never compound across a restart.

**Root cause:** `CAPITAL_TOTAL` is a **balance**, not a setting, and it is stored and applied as if it
were one. Nothing declared a precedence rule — precedence was an accident of line numbers.

**Fix:** the two `restoreEquity()` calls now run **after** `_loadConfigOverrides()`. Restored state is
the account, so it is the last word. **Two statements moved. No new logic, no flag, no filter** — a
filter on `CAPITAL_TOTAL` would have needed a special case for a fresh install and another for the
stale-file branch; reordering needs neither.

Verified live after the fix: `capital: 88011`, daily-loss brake `₹4,400.55`.
`test/server-boot-capital.test.js`, 45 assertions. Detail: `docs/APPROVAL-capital-overwritten-at-boot.md`.

### 3.8 Other completed work

- **`event-risk-filter.loadCalendar`** — a corrupt calendar returned `[]`, which means *"checked,
  nothing scheduled — trade on"*, silently disarming the filter on RBI/budget/CPI days. It cannot throw
  (its only caller is protected `server.js` at module scope), so corruption rides on a **non-enumerable
  `corrupt` flag** and `assess()` returns `REDUCE`. Absent vs corrupt is decided by **`ENOENT`**, not by
  `existsSync` — the first version of the fix demanded `existsSync` and broke every injected fake `fs`.
- **The suite went red at midnight with no code change.** `scanPoP` read `new Date()` internally; an
  estimated premium landed on 0.504; the raw filter `ltp > 0.5` admitted it and `toFixed(2)` published
  it as `0.50`. The clock is now injected and the filter runs on the **published** premium.
  *A test whose verdict depends on the wall clock is not a test.*
- **`confluence-learner` and `event-engine`** — 344 lines, five dependents, and **zero tests**. Both now
  have eight-category suites (**66 + 73 assertions**). Every defect found is **characterized, not
  fixed** — each changes learned weights or a risk score.
- **`charges.js`** — five dependents, first suite, 26 assertions, E1 pinned.
- **Design tokens** — 21 pages had zero shared CSS and 10 different background colours.

---

## 4. Performance targets — **1 verified, 4 missed, 3 unknown**

`npm run perf:report`. **A target is met, missed, or UNKNOWN — never met by silence.**

| target | state | evidence |
|---|---|---|
| API < 50 ms | UNKNOWN | needs a running server. The report **refuses to boot `server.js`** — requiring it starts the engines and appends to the forward-test ledger that gates live approval. Proxy: `module-contract` `/health` p95 **1.4 ms**. The 168 real routes are unmeasured |
| WebSocket < 100 ms | UNKNOWN | **no WebSocket server exists.** `ws` is a broker *client* only. Cannot be met; cannot be missed |
| Dashboard refresh 250 ms | MISSED | 16 timers, fastest 1,000 ms. **250 ms is a render budget, not a poll interval** — 16 timers at 250 ms = 64 req/s per tab against a single-threaded monolith |
| Memory leak 0 | VERIFIED | bounding invariants asserted; heap corroborated under `--expose-gc`. Zero-leak cannot be *proven* by heap sampling |
| CPU under 20% | UNKNOWN | `cpuUsage()` in a test process measures the wrong process |
| All writes atomic | MISSED | **10** raw `writeFileSync`: `server.js`(**8**, protected), `consolidate-ami-signals`(1), `signal-health`(1, fake-fs seam) |
| All reads validated | MISSED | **11** unvalidated `JSON.parse(readFileSync)` (9 in `server.js`) |
| No silent catch | MISSED | **112** across 19 files; **71 in `server.js`** |

**A ratchet that cannot see what it guards is decoration.** The "all writes atomic" scan matched only
the `fs.` and `_fs.` receivers and never saw `fs2.`, `_fs2.`, `_persistFs.` or `_sigFs.` — `server.js`
uses all four. It reported **4** raw writes where there were **10**, and passed on the undercount.

**Testing Rule coverage: 11 of 46 suites** declare categories; 35 predate the rule. A ratchet, may only
go down. Written here so nobody can claim the rule is satisfied platform-wide.

---

## 4b. THE ARCHITECTURE, IN ONE PARAGRAPH

Measured, not opined. `server.js`: **7,318 lines · 168 routes · 0 `express.Router()` · 62 top-level
mutable variables · 14 `setInterval` · 0 `clearInterval` · 11 engine instances constructed.**
There are **8 `placeOrder()` call sites across 6 modules** — no order manager, and one boolean
(`execution-engine.js:519`, `paperMode`) is the only thing between them and a live broker.
`grep -rlE "totalExposure|portfolioRisk|netDelta"` returns **nothing**: no module computes exposure
across engines, so the *account* has no daily-loss brake at all — only eleven private ones that cannot
see each other. Kelly is implemented **four times**; GEX **twice**, with a different `r` and the
opposite dealer-sign convention. `EventEmitter` appears in **one** production module, so there is no
event bus, no audit trail and no replay. `module-contract.js` builds health/metrics/OpenAPI/shutdown
for any module — **and zero of its routes are reachable**, because mounting needs one line in the
protected `server.js`.

**Findings 1–3 are one finding wearing three hats: no module owns capital, no module owns orders, no
module owns risk.** Full analysis, ranked, with migration plans: `docs/ARCHITECTURE-REVIEW.md`.

---

## 5. PENDING

### 5.0 A LIVE FAIL-OPEN, VISIBLE RIGHT NOW — no package written yet

`restoreEquity()` sets `autoEnabled = false` and `_haltedReason = 'EQUITY_STATE_CORRUPT'` when the
equity file cannot be recovered. That is the C3-07 fail-closed halt. Then, inside the `app.listen`
callback, **`server.js:7278`**:

```js
if (typeof _cfgOverrides?.NIFTY_DIRECTIONAL_AUTO === 'boolean' && niftyEngine?.setAutoEnabled)
  niftyEngine.setAutoEnabled(_cfgOverrides.NIFTY_DIRECTIONAL_AUTO);   // config says true
```

**The fail-closed halt introduced by C3-07 is undone six thousand lines later.** The same mechanism
means a `CONSEC_LOSSES` halt never survives a restart either: `_haltedReason` and `autoEnabled` are
**never persisted**, so the halt lives only as the restored counter.

Observed on the running server this session:

```
[NIFTY] Restored equity: active ₹96761 (consec losses: 15)
GET /api/engine/status  ->  autoEnabled: true
```

`MAX_CONSECUTIVE_LOSSES=3`. **NIFTY is running at five times its halt threshold.** And the restored
`15` is itself one trade stale — see `docs/APPROVAL-consec-losses-persisted-stale.md`.

**This is the recommended next task.** It disarms a brake outright, where the capital defect only
loosened one. Protected file; package not yet written.

### 5.1 Blocked on approval — protected file (`server.js`)

**P1-T3, `server.js:3764` — `POST /api/strategy-config`.** The third and last raw writer of
`config-overrides.json`. Same read-modify-write, same `catch (_) {}`, same 12-key destruction.
Because two of three writers are now safe, a raw write here leaves their `.bak` **stale**.

The 8 remaining raw write sites, in the order they should be approved:

| # | line | file written | why it matters |
|---|---|---|---|
| 1 | 3764 | `config-overrides.json` | last of three writers; capital + daily-loss brake |
| 2 | 5876 | `signal-paper-positions.json` | **a position ledger, 2 open positions, no `.bak`.** Corrupt ⇒ engine believes it is flat ⇒ re-enters ⇒ doubled exposure, no record of the first leg |
| 3 | 1330 | `market-state.json` | the opening range is **not re-derivable** after 09:30 |
| 4 | 5855 | `vrp-monitor.json` | 40-observation rolling window; not reconstructible |
| 5 | 4246 | `eod-<date>.json` | daily archive, written on the shutdown path |
| 6 | 539, 576 | `opt-hl/`, `opt-candles/` | derived caches, **60 s** timers |
| 7 | 2028 | **`.env`** | live broker tokens. **NOT SAFE as one patch** |

**`.env` (`:2028`) needs three separate approvals, in order:** (1) atomicity **preserving the current
mode** (`0644`); (2) the mode decision — an atomic `rename` installs the **temp file's** mode, so
adopting atomic writes naively **silently re-permissions `.env`**, and `.env` is untracked so
`git checkout` will not undo it; (3) move the token out of `.env` entirely
(`data/broker-tokens.json`, `0600`, atomic, `.bak`) and fix `_envPath = path.resolve('./.env')`, which
resolves against `process.cwd()` — starting the server elsewhere writes a **new `.env` in the wrong
place**.

**Also protected, also waiting:**

- **The three-line package that unblocks five performance targets at once.** `app.listen()`'s return
  value is discarded, so `_gracefulShutdown` cannot call `server.close()` — it kills in-flight requests
  with a `setTimeout(() => process.exit(0), 400)` guess — and with no `http.Server` object **no
  WebSocket can ever attach**.
  ```js
  const server = app.listen(PORT, …);                              // 1. capture it
  app.use('/api/m', require('./module-contract.js').mountAll());   // 2. mount the 11 surfaces
  server.close(() => …);                                           // 3. drain in-flight requests
  ```
- **`server.js:5785` — the regime scores an unreachable VIX as maximally calm.** Approval package:
  `docs/APPROVAL-regime-unknown-vix.md`. **Recommendation SAFE, unconditional** — the dashboard was audited and already renders a `null` score as nothing rather than `0` (`dashboard.html:774`).
  ```js
  const cPanic = vix != null && vix >= 22 ? 0 : vix != null && vix >= 18 ? 40 : 100;
  ```
  `100` means *"measured, and maximally calm"*. The `!= null` guards show the author knew the value
  could be absent and chose the most permissive value. Isolating `cPanic` (all else held constant):

  | VIX | `cPanic` | regime score | verdict |
  |---|---|---|---|
  | 25 (panic, known) | 0 | 61 | REDUCE |
  | 12 (calm, known) | 100 | 71 | SELL-ON |
  | **null (unreachable)** | **100** | **71** | **SELL-ON** |

  **+10 points**, and near the `>= 62` threshold that one component decides `SELL-ON` vs `REDUCE`.
  `ivp` and `vrp` share the shape (`null → 50`).
- **71 silent catches**, **9 unvalidated JSON reads** inside `server.js`.
- **TD-1** — `option-analyzer.js:166` fallback Greeks hardcode `volatility = 0.15`, discarding the live
  IV the caller solved two lines earlier. The fix touches `server.js:2269`.
- **TD-2** — one shared `OptionAnalyzer`, mutated per request: a race on every Greek.
- **C2-02** — webhook secret, rate limiting, CSP.

### 5.2 Blocked on approval — behaviour change (non-protected)

Characterized by test, **not applied**. Each changes paper-trading behaviour.

| # | change | direction |
|---|---|---|
| ~~**B**~~ | ~~`event-engine.js` — `vixLift = vix.value ? … : 0`~~ **DONE 2026-07-10** — an unreachable VIX now yields `level: 'UNKNOWN'`, `vixLift: null`, `unknowns: ['indiaVix']`. **The `score` is deliberately unchanged**: it is consumed numerically at `server.js:5779` via `Number(…) \|\| 0`, so returning `null` there would become `0` and make `cEvent` **maximally sell-friendly** — failing closed on the score would have failed **open** one layer up | level, not score |
| ~~**C**~~ | ~~`event-engine.js` — unrecognised event type falls back to `OTHER` (30)~~ **DONE 2026-07-10** — a budget day typed `BUDGET_2026` scored **30 (LOW)**. OTHER remains the floor (no weight can be invented), but the type is named in `unknownTypes` and the level becomes `UNKNOWN`, never `LOW` | level, not score |
| **D** | `confluence-learner.js:137` — `if (!isFinite(s) \|\| s === 0) continue`. A leg scoring exactly 0 is skipped, indistinguishable from an absent leg, and never counted as a sample | changes **learned weights** |
| **E** | `pop-seller` P&L is **gross**, not net — no charges, while three other engines use `charges.js` | changes reported paper P&L |
| **F** | `pop-seller.buildIronCondor` returns two short legs and **no wings**: unbounded loss, no `maxLoss` field, under a name that promises defined risk | changes the structure it builds |

### 5.3 Unblocked — no approval needed, not yet done

- **TD-4** — boot-time advisory lock on `data/`. `withLock` already exists in `safe-write.js`.
  Atomicity is **not** mutual exclusion: it prevents corruption, not lost updates.
- **UI-02** — 18 of 21 pages still carry drifted private CSS token blocks.
- **UI-03** — 16 independent polling timers on `dashboard.html`. Blocked on the WebSocket above.
- **Deprecate `command.html`** — 14 `demo*` functions fabricate market data with `Math.random()`,
  including max-pain. Labelled `PAPER·DEMO` on screen, so not deception, but it is browser-side market
  logic and `dashboard.html` is now the home page.
- **TD-3** — `bt-data` is mounted `:ro` but the `bt-*.js` CLIs write results into it.

### 5.4 Blocked on a DECISION, not on work

Six answers are needed before another engine can be migrated. They will not be guessed.

1. **Does `score` survive?** `engine-verdict.js` has `score: -1..+1`; the newer contract has only a
   verdict enum. Without `score` a Meta Decision Engine has a **class** but no **magnitude**, and can
   only ever be a veto aggregator.
2. **`timestamp`** — the contract asks for one; the module deliberately **injects** `computedAt`,
   because `pop-seller`'s suite went red at midnight when `scanPoP` read the wall clock.
3. **"No globals / no mutable singleton"** — `module-contract.js:141` holds a module-level registry.
   Does the rule bind AI engines only, or infrastructure too?
4. **Forbidden-list scope** — "No Kelly / No position sizing" versus `strangle-engine`, which calls
   `position-sizer` today. Engines only, or everything?
5. **The 20 ms latency budget** applies to what — `verdict()`, or the underlying compute?
6. **`confluence-learner.track()` rejects an `EngineVerdict`.** It accepts only `decision: 'BUY'|'SELL'`.
   **The reliability estimator cannot learn from the only object engines are allowed to emit.** This is
   the blocking coupling between the AI Architecture Rule and reliability measurement.

**Migration status:** 15 modules still emit BUY/SELL. Only `pop-seller` exposes `verdict()`, and it
**abstains** — its book is fine, but its `reliability` has never been measured. *A health check that
reports `ok` for a thing it never checked is the most expensive kind of green light.*

### 5.5 The three cheapest actions, which gate everything else

1. **Start capturing intraday option chains today.** Four days of history exist. Every day of delay is a
   day permanently lost, and this gates all gamma/dealer/flow research.
2. **Log the outcome of every engine's hypothetical call.** 55 → ~200 unblocks every probability and
   meta-decision module. Cheapest item on the roadmap.
3. **Write a daily NAV series** (per book, net of charges). Every portfolio statistic is computed from a
   series that does not exist.

---

## 6. Resume

```
npm test                                  # expect 46/46, exit 0
git status                                # uncommitted working set; nothing staged for push
git diff -U0 server.js | grep -c '^@@'    # expect 7  (P1-T1, P1-T2, boot-order reorder)
```

**Rollback**

- Boot-order capital fix: `backups/migration-CAP-boot-order-20260710-145600/ROLLBACK.sh` (keeps P1-T1 + P1-T2)
- Task A: `git checkout -- event-risk-filter.js test/event-risk-filter.test.js`
- P1-T1 only: `backups/migration-P1T1-config-overrides-20260710-013608/ROLLBACK.sh`
- P1-T2 only (keeps P1-T1): `backups/migration-P1T2-gamma-blast-enable-20260710-015907/ROLLBACK.sh`
- All of `server.js`: `git checkout -- server.js`

**Next recommended task: `server.js:7278`** — it re-enables a halted engine at boot, undoing the
C3-07 fail-closed halt. It disarms a brake outright, where the capital defect only loosened one.
NIFTY is running at five times its halt threshold right now. See §5.0. Package not yet written.

**Approval queue — five packages waiting. None is applied.**

| # | package | what |
|---|---|---|
| **A** | *(not yet written)* | `server.js:7278` re-enables a halted engine at boot. **A live fail-open. Recommended next.** See §5.0 |
| B | `docs/APPROVAL-consec-losses-persisted-stale.md` | `execution-engine.js` persists the loss counter **before** updating it: the brake trips one loss late after every restart, and a win never persists its reset |
| C | `docs/APPROVAL-signal-health-save-over-corrupt.md` | `saveState()` overwrites a calibration file it has just logged as *"untouched"*. 12 of the platform's 55 labelled outcomes |
| D | `docs/APPROVAL-P1-T3-strategy-config.md` | `server.js:3764`, the last raw writer of `config-overrides.json` |
| E | `docs/APPROVAL-regime-unknown-vix.md` | `server.js:5785`, the regime scores an unreachable VIX as maximally calm. **SAFE, unconditional** |

Also open: `docs/APPROVAL-server-write-sites.md` (the remaining 7 raw write sites) and
`docs/ARCHITECTURE-REVIEW.md` (ten ranked design findings, evidence-backed).

Per-task records live in `docs/TASK-*.md`. Everything else in `docs/` is superseded by this file.

---

## 7. If you are ChatGPT reading this

- **Do not re-litigate section 2.** Those were measured against the running code, the files on disk, or
  the live broker API.
- **Verify a module is absent before saying so.** An earlier audit reported four existing modules as
  missing because it searched for guessed filenames.
- **`null ≠ 0`.** A missing score is `null`, never 0. Zero is a confident neutral reading; null is the
  absence of one. Collapsing them manufactures confidence from ignorance.
- **A test that did not run must never look like a test that passed.**
- **Prefer refusing over guessing.** If the evidence is absent, say so and stop.
