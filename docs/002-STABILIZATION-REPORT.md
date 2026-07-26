# 002 — PLATFORM STABILIZATION PROGRAM

**Standard:** Master Prompt 002 · **Depends on:** 000-A…E, 001-A…F
**Date:** 2026-07-12 · **Suite:** **48/48 green** (was 47/47 — one suite added)
**Scope:** No new features. No AI. No live-trading enablement. **Correctness, safety, maintainability only.**

---

## SECTION 0 — WHAT CHANGED IN THIS PROGRAM

**One defect fixed. It was the one that made every other number meaningless.**

| | |
|---|---|
| **Fixed** | `bt-validate.js` — the statistical validation harness — **carried the look-ahead it exists to detect** (001-D, R-01) |
| **Files touched** | `bt-validate.js` (1 hunk, CLI block only) · `test/bt-validate-lookahead.test.js` (new, 30 assertions) |
| **Protected files touched** | **NONE** |
| **Consumers affected** | **ZERO** — see §0.2 |
| **Characterization** | **Proven RED before the fix** (`TRIPWIRE 1` fired), green after |

### 0.1 The evidence — before and after

The harness runs the short strangle across 600 real exchange days and subjects it to deflated Sharpe,
walk-forward and purged k-fold. **The only thing that changed is which price the strategy is allowed
to see.**

| Metric | **Before** (strike chosen from *today's close*) | **After** (strike chosen from *yesterday's close*) |
|---|---|---|
| Trades | 129 | 129 |
| **Win rate** | **91.5%** | **51.2%** |
| ₹ per trade | **+3,282** | **−174** |
| In-sample Sharpe | +0.846 | **−0.120** |
| PSR(SR>0) | **1.0** | **0.0785** |
| **Deflated Sharpe (12 trials)** | **0.9999 → `PASS (edge real @95%)`** | **0.0008 → `FAIL (likely overfit)`** |
| Walk-forward OOS | Sharpe **1.232**, win **93.4%** | Sharpe **−0.022**, win **53.9%** |
| Purged 5-fold mean | **+1.044 ± 0.622** | **−0.11 ± 0.14** |
| **VERDICT** | ✅ *"Edge survives Deflated-Sharpe + walk-forward + purged k-fold with costs — harness trusts it."* | ⚠️ *"Edge weak/unproven under honest validation."* |

> **The validator certified an artefact at 95% confidence.**
> Purged k-fold defends against overfitting. Deflated Sharpe defends against selection bias. PSR
> defends against luck. **None of them defends against look-ahead** — and the harness itself had it.
>
> **This is why no other stabilization work could safely proceed first.** Every measurement taken with
> this tool, before today, was a measurement of the future.

### 0.2 Why this fix was safe — blast radius ZERO

`bt-validate.js:136` exports **only 13 pure statistics functions** (`normCdf`, `mean`, `sharpe`,
`probabilisticSharpe`, `deflatedSharpe`, `walkForward`, `purgedKFold`, `expectancy`, …). **The
mathematics was never wrong and was not touched.**

The leaky `strangleTrades()` and `ivProxyPercentiles()` live inside `if (require.main === module)` —
**the CLI block. They are exported to nobody.**

The module's only consumer, `forward-test-report.js`, calls `V.expectancy`, `V.sharpe` and
`V.deflatedSharpe` — **all pure statistics.** A regression test now asserts the export surface is
**exactly those 13 functions and nothing else.**

> **Fixing the strategy changed no shipped result. It changed one number: the one that was wrong.**

### 0.3 The three leaks removed

| # | Line | Defect | Fix |
|---|---|---|---|
| 1 | `:152` | `atmStrike(day)` + `day.underlying` → the strike was chosen from **today's close**, then sold at **today's open** | The strike is derived from `prev.underlyingClose` — **the last price that actually existed** |
| 2 | `:157` | `sizeLots(cap, credit)` — the 2-argument form silently used `LOT = 75`, **wrong on 356/600 days (59.3%)** | `sizeLots(cap, credit, lot)` with the real per-day `NewBrdLotQty`. **If the lot is unreadable the day is SKIPPED — never sized with a guessed 75** |
| 3 | `:151` | The IV-proxy regime gate read **today's** proxy — which is computed from **today's close** | The gate reads the **previous session's** proxy |

---

## SECTION 1 — CRITICAL ISSUE REGISTER (Workstream 1)

| ID | Defect | Sev | Evidence | Regression protection | Status |
|---|---|---|---|---|---|
| **B-1** | **`bt-validate.js` carried the look-ahead it exists to detect** | 🔴 CRITICAL | `bt-validate.js:152/157/151` | ✅ `test/bt-validate-lookahead.test.js` — **30 assertions, proven RED first** | ✅ **RESOLVED** |
| **B-2** | **Look-ahead in all 8 strategy scripts** | 🔴 CRITICAL | 001-D §3 — every file, every line cited | ⏳ per-script characterization required | 🔓 **UNBLOCKED by B-1.** Behaviour change ⇒ **owner approval per script** |
| **B-3** | **`setAutoEnabled(true)` re-enables a HALTED engine at boot** | 🔴 CRITICAL | `afternoon-engine.js:826`, `server.js:7278`; **0 refs to `_haltedReason`** | package written | 🔒 **PROTECTED — awaiting owner** |
| **B-4** | **`lotSize: 65` hardcoded ×3 in `server.js`** while a fail-closed registry exists | 🔴 CRITICAL | `server.js:260, 3290, 3483` | package needed | 🔒 **PROTECTED — awaiting owner** |
| **B-5** | **Two `bsGamma`: `r=0` vs `r=0.065`, 3rd/4th parameters SWAPPED** | 🔴 CRITICAL | `vol-context.js:42` / `gex-skew.js:18` | equivalence test needed | ⏳ **Not protected — needs an owner for `r` first** |
| **B-6** | **`.env` rewritten non-atomically from an HTTP handler** | 🟠 HIGH | `server.js:2028` | package needed | 🔒 **PROTECTED — awaiting owner** |
| **B-7** | **NEW — `bt-validate.js` recommends `wire it live` on a FAILING DSR** | 🟠 HIGH | The gated variant scores **DSR 0.2354** (below the 0.1477 benchmark ⇒ FAIL), and the script still prints **"GATE ADDS VALUE … wire it live."** | ⏳ | 🆕 **FOUND WHILE FIXING B-1.** Not touched — **one concern per commit** |
| **B-8** | `afternoon-engine` persists `consecLosses` **before** updating it | 🟠 HIGH | `:747` before `:755` — the brake trips one loss late after every restart | ⏳ | package needed |
| **B-9** | **Shutdown race — 14 timers, 0 `clearInterval`** | 🟠 HIGH | `_gracefulShutdown` writes the EOD snapshot, then `setTimeout(exit, 400)`. **The snapshot is read while 14 writers still run** | ⏳ | Not protected |
| **B-10** | **`openPosition` authority race** | 🟠 HIGH | 6 position globals written by both a timer tick and an HTTP handler, with `await` between guard and write | ⏳ | Not protected |
| **B-11** | **92 empty catches** — 57 in `server.js`, **4 inside `safe-write.js` itself** | 🟠 HIGH | 001-C §6 | ⏳ | **UNKNOWN which swallow a state mutation — see §6** |
| **B-12** | **`"backtest-grounded"` reliability shipping with no backtest** | 🟠 HIGH | `candlestick-patterns.js:344` — **no such backtest exists in the repository** | ⏳ | Not protected |

---

## SECTION 2 — PROTECTED FILE REVIEW (Workstream 2)

**Protected: `server.js`, `execution-engine.js`.** In this program **neither was modified.**

| Package | Defect | Status |
|---|---|---|
| `docs/APPROVAL-halt-reenabled-at-boot.md` | **B-3** — live fail-open | ✅ Written · ⏳ **awaiting owner** |
| `docs/APPROVAL-consec-losses-persisted-stale.md` | **B-8** | ✅ Written · ⏳ awaiting owner |
| `docs/APPROVAL-P1-T3-strategy-config.md` | last raw `config-overrides.json` writer | ✅ Written · ⏳ awaiting owner |
| `docs/APPROVAL-regime-unknown-vix.md` | `server.js:5785` — unreachable VIX scores as maximally calm | ✅ Written · ⏳ awaiting owner |
| `docs/APPROVAL-server-write-sites.md` | the remaining 7 raw write sites | ✅ Written · ⏳ awaiting owner |
| `docs/APPROVAL-signal-health-save-over-corrupt.md` | overwrites a file it logged as untouched | ✅ Written · ⏳ awaiting owner |
| **NEEDED — `lotSize: 65` ×3** | **B-4** | 🆕 **Not yet written** |
| **NEEDED — `.env` atomic write** | **B-6** | 🆕 **Not yet written** |
| **NEEDED — `mountAll()`** | observability 404 | 🆕 **Not yet written** |

> **Nine protected-file changes are queued. Six have packages. Three do not.**
> **Total code: under 30 lines.** The platform's safety, correctness and observability posture is
> blocked on **owner approval, not on engineering.**

---

## SECTION 3 — CONFIGURATION STABILITY REPORT (Workstream 3)

| Aspect | State | Evidence |
|---|---|---|
| **Configuration ownership** | 🔴 **CONTESTED** — `config-overrides.json` has **3 writers** | 001-B §11 |
| **Atomic persistence** | 🟡 **2 of 3** writers are atomic + `.bak` + refuse-on-corrupt (P1-T1, P1-T2). **The third (P1-T3, `server.js:3764`) is raw** | package written |
| **Runtime overrides** | 🟡 Work, and now persist across boots | `data/config-overrides.json` |
| **Duplicate configuration** | 🔴 **`lotSize` is defined in `instrument-registry.js` AND hardcoded 3× in `server.js`** | 001-C D-01 |
| **Startup validation** | 🔴 **NONE.** A missing env var yields `undefined`, not a refusal | 001-E §2 |
| 🔴 **`CAPITAL_TOTAL` is a BALANCE living in a SETTINGS file** | **The architectural defect.** `setConfig()` writes it straight onto `this.capital` (`execution-engine.js:113`). Boot order decided the account balance until 2026-07-10 | 001-B §11 |

### Determinism verdict: 🟡 **PARTIAL**

Boot is now deterministic **because the load order was fixed**, not because the ownership was.
**The shape that allowed a config file to overwrite an account balance is unchanged.**

**Recommendation (no implementation):** `CAPITAL_TOTAL` must not be writable from a configuration
path. The account balance belongs to a ledger with a single owner. **This requires an ADR before any
code.**

---

## SECTION 4 — STATE OWNERSHIP MATRIX (Workstream 4)

| Domain | Owner | Writers | Readers | Verdict | Consolidation plan *(no implementation)* |
|---|---|---|---|---|---|
| **Capital** | **NONE** | **6 sites / 3 modules** — `execution-engine:54,113,381` · `afternoon-engine:80,782` · `strangle-engine:82` | daily-loss brake (`execution-engine:302`), all sizing, `/api/risk`, dashboard | 🔴 **NO OWNER** | **`AccountLedger`** — single owner. Introduce as a **read-only shadow** that publishes alongside the existing capital and **asserts agreement for 2 weeks** before becoming authoritative |
| **Orders** | **NONE** | **8 `placeOrder()` sites / 6 modules** | — | 🔴 **NO OWNER.** One boolean (`paperMode`) stands between them and a broker | **`OrderManager`** — introduce as a **pass-through with no logic**; then make it the only door |
| **Positions** | Per-engine + **6 globals in `server.js`** | timer ticks **and** HTTP handlers, with `await` between guard and write | — | 🔴 **FRAGMENTED — race (B-10)** | Move each slot into its owning engine |
| **Portfolio** | **NONE** | — | — | 🔴 **DOES NOT EXIST** | Blocked on a daily NAV series, which does not exist |
| **Risk** | **NONE** | — | — | 🔴 **DOES NOT EXIST.** `grep totalExposure\|portfolioRisk\|netDelta` → **nothing** | **`RiskEngine`** — publish **read-only at `/api/risk` for 2 weeks** before it may block anything |
| **Configuration** | **CONTESTED** | 3 writers | everything | 🔴 §3 | One writer, atomic, schema-validated at startup |
| **Market Data** | **FRAGMENTED** | 5 sources: `dhan-client`, `upstox-connector`, `free-chain`, `sensibull-fetcher`, `live-connector` | — | 🟡 No adapter interface | One `MarketDataPort`, 5 implementations |
| **Pricing model (`r`)** | **NONE** | 2 conflicting `bsGamma`s | GEX, dashboard | 🔴 **NO OWNER (B-5)** | One `quant/` kernel, guarded by a **cross-implementation equivalence test** so a second copy cannot reappear |
| **Storage** | **`safe-write.js`** | — | 18 modules | 🟢 **SINGLE OWNER** | — |
| **Charges** | **`charges.js`** | — | 12 modules | 🟢 **SINGLE OWNER** *(rates disputed — E1)* | — |
| **Instruments** | **`instrument-registry.js`** | — | 10 modules | 🟢 **SINGLE OWNER** — **but `server.js` bypasses it (B-4)** | Close the bypass |

> **Three domains have a single owner. Four have none.** The four with none are **capital, orders,
> risk and the pricing model** — that is, **everything that decides how much money moves and at what
> price.**

---

## SECTION 5 — LIFECYCLE ASSESSMENT (Workstream 5)

| Phase | State | Risk |
|---|---|---|
| **Startup** | 🟡 Load order is **load-bearing** — `_loadConfigOverrides()` must run before `restoreEquity()`, or the config overwrites the account balance. **Fixed 2026-07-10; the fragility is unchanged** | HIGH |
| | 🔴 **No config validation.** 000-E: *"Critical validation failure must prevent startup."* It does not | HIGH |
| | 🔴 **`setAutoEnabled(true)` re-arms a halted engine (B-3)** — **the halt does not survive a restart** | **CRITICAL** |
| **Background timers** | 🔴 **14 `setInterval`, 0 `clearInterval`.** Not registered anywhere. No scheduler | HIGH |
| **Shutdown** | 🔴 **RACE (B-9).** `_gracefulShutdown` writes the EOD snapshot, then `setTimeout(exit, 400)`. **For 400 ms all 14 timers keep firing and may mutate the state that was just snapshotted.** The EOD snapshot is not a snapshot — **it is a read taken while 14 writers are running** | **CRITICAL** |
| **Cleanup** | 🔴 **NONE.** `app.listen()`'s return value is discarded ⇒ `server.close()` is unreachable | MEDIUM |
| **Recovery** | 🟢 **GOOD.** `safe-write.js` fails closed on corrupt input, keeps a `.bak`, and **restore is tested** in 3 suites | — |
| | 🔴 **No position reconciliation. No documented DR procedure** | HIGH |

**Recommendation (no implementation):** a `Scheduler` that **registers** the 14 timers without changing
them. Registration alone makes `clearInterval` *possible*. **Additive; zero behaviour change.**

---

## SECTION 6 — ERROR HANDLING (Workstream 6)

| Class | Count | Observable? |
|---|---|---|
| `catch` blocks | **382** | — |
| **Silent — empty body `catch (_) {}`** | **92 (24%)** | 🔴 **NO** |
| Log-only | 29 | 🟡 unstructured `console.log` |
| Re-throwing (propagated) | **14 (3.7%)** | 🟢 yes |
| **Custom Error classes** | **1** — `VerdictError` | 🟢 the correct shape, **one adopter** |
| Error middleware | **0** | 🔴 |

### Empty catches by file
```
server.js 57 · event-engine.js 5 · strangle-engine.js 5 · news-engine.js 4
safe-write.js 4 · dhan-ws-feed.js 3 · afternoon-engine.js 2 · agents-engine.js 2
```

### 🔴 STOP CONDITION — declared, not guessed

**Static analysis cannot determine which of the 92 empty catches swallow a *state mutation*.**
An empty catch around an optional news fetch is correct. An empty catch around a **failed persist**
is a fail-open — and **that is the exact fault class behind every defect found in this cycle**
(`Unknown → Zero`, `null → 0`, `corrupt → proceed`).

**Four of them are inside `safe-write.js` — the module whose entire purpose is to fail closed.**
An empty catch inside a fail-closed primitive is a contradiction in terms **until it is read.**

| | |
|---|---|
| **Status** | **UNKNOWN** |
| **Measurement that settles it** | Scan for `catch {}` whose `try` block contains an assignment to `this.*` or a `writeFileSync`, then read each hit |
| **Effort** | **1–2 hours** |
| **Recommendation** | **Do this before any refactor.** It is the cheapest way to find the next fail-open |

**The architectural fault: there is no error taxonomy.** A corrupt ledger, a broker 429 and a typo in
a query string are all the same thing to this codebase. Nothing can distinguish *retryable* from
*fatal* from *refuse*.

---

## SECTION 7 — TECHNICAL DEBT PRIORITY LIST (Workstream 7)

*Implementation sequence only. No implementation prescribed.*

| Seq | Debt | User impact | Op risk | Effort | Dependency impact | Gate |
|---|---|---|---|---|---|---|
| **✅ 1** | **Contaminated validator (B-1)** | Every research number was fiction | — | Hours | **Blocked everything** | ✅ **DONE** |
| **2** | **B-3** halt fail-open | The risk brake dies on restart | **CRITICAL** | ~6 lines | — | 🔒 **OWNER** |
| **3** | **B-4** `lotSize: 65` ×3 | Sizing/charges/P&L wrong whenever the lot changes | HIGH | Hours | — | 🔒 **OWNER** |
| **4** | **B-6** `.env` non-atomic write | Total credential loss on an interrupted write | HIGH | Hours | — | 🔒 **OWNER** |
| **5** | **`mountAll()`** | Unknown operational state (000-E: unacceptable) | HIGH | **1 line** | Unblocks all observability | 🔒 **OWNER** |
| **6** | **B-2** look-ahead in 8 strategy scripts | **The edge question itself** | — | Days | **Depends on B-1 ✅** | 🔓 **Approval per script — results WILL move** |
| **7** | **B-9** timer cleanup | Corrupt EOD snapshot | HIGH | ~10 lines | — | Not protected |
| **8** | **B-11** the 92 empty catches | A failure looks like a success | HIGH | **1–2 h to triage** | Finds the next fail-open | Not protected |
| **9** | **B-5** two `bsGamma`s | Silent wrong numbers, no error | HIGH | Hours | **Needs an owner for `r` first** | Needs an ADR |
| **10** | **B-7** `wire it live` on a failing DSR | An unjustified recommendation in a research tool | MEDIUM | Minutes | — | Not protected |
| **11** | **B-12** unmeasured "backtest-grounded" claim | UNKNOWN presented as MEASURED, in a live path | MEDIUM | Minutes | — | Not protected |
| **12** | **B-8** stale `consecLosses` | Brake trips one loss late | MEDIUM | ~6 lines | — | package written |
| **13** | **B-10** `openPosition` race | Double-entry / lost position | MEDIUM | Days | — | Not protected |
| 14 | Dead code (4 modules, Ca=0) | Noise | — | Minutes | — | **Zero risk** |

---

## SECTION 8 — TESTING REINFORCEMENT PLAN (Workstream 8)

**Current: 48 suites, exit-code gated, characterization-first.** *(+1 this program.)*

| Area | Testability today | Required before refactor | Priority |
|---|---|---|---|
| **Pure analytics** (`charges`, `gex-skew`, `vol-context`, `meta-label`, `multiconfirm`) | **9–10 / 10** — pure, deterministic | ✅ Covered | — |
| **Kernel** (`safe-write`, `instrument-registry`, `engine-verdict`) | **9–10 / 10** | ✅ Covered, restore tested | — |
| 🔴 **Routes — all 172** | **0 / 10 — ZERO route tests exist** | **A response-snapshot test for every route.** **This is the prerequisite for ANY `server.js` decomposition** | **P0** |
| 🔴 **`execution-engine.js`** (the risk brake) | **5 / 10** | **Characterization of every halt path**: DAILY_LOSS, DRAWDOWN, CONSEC_LOSSES, EQUITY_STATE_CORRUPT — **and that each SURVIVES A RESTART** *(this is B-3)* | **P0** |
| 🔴 **`afternoon-engine.js`** | **4 / 10** — 14 internal clock reads | **Inject the clock**, as `pop-seller` already did | **P1** |
| 🔴 **`strangle-engine.js`** | **3 / 10** — raw `fs` + internal clock | Remove raw `fs`; inject the clock | **P1** |
| **The 7 remaining `bt-*` strategy scripts** | — | **A look-ahead tripwire per script**, modelled exactly on `test/bt-validate-lookahead.test.js` | **P0 — this is B-2** |
| **The two `bsGamma`s** | — | **A cross-implementation equivalence test** — the only thing that prevents a third copy | **P1** |
| **Integration: boot → halt → restart → still halted** | **NONE** | **The single highest-value integration test in the repository.** It is exactly the B-3 defect | **P0** |

> **`pop-seller.js` is the proof the process works.** Its suite went red at midnight with no code
> change; the clock was injected; testability moved **4 → 7**. **That is the template for every
> engine.**

---

## SECTION 9 — DOCUMENTATION (Workstream 9)

| Artefact | State |
|---|---|
| **Architecture Handbook** | ✅ `docs/001-B-ARCHITECTURE-HANDBOOK.md` |
| **Risk Register** | ✅ Consolidated — `docs/001-F-EXECUTIVE-REPORT.md` §6 |
| **Approval Packages** | 🟡 **6 written, 3 needed** (B-4, B-6, `mountAll`) |
| **Recovery Playbook** | 🔴 **MISSING.** `safe-write` has tested restore; **the procedure to recover a corrupt `data/` directory is written nowhere** |
| 🔴 **ADRs** | **NONE EXIST — the most damaging documentation gap** |

### The three ADRs that must be written first

| ADR | Question it must answer |
|---|---|
| **ADR-001** | **Why is `CAPITAL_TOTAL` a configuration key?** A settings file silently overwrote the account balance at every boot until 2026-07-10. **Nobody knows why it was ever a setting** |
| **ADR-002** | **What is the risk-free rate `r`, and who owns it?** Two `bsGamma`s disagree (`0` vs `0.065`) **and take their arguments in a different order** |
| **ADR-003** | **What is the halt invariant?** Four code paths halt an engine; **one setter silently undoes all four.** The correct statement is *"`autoEnabled` must not be settable while `_haltedReason` is non-null"* — **and that invariant belongs in the engine, not in the caller** |

---

## SECTION 10 — EXIT CRITERIA

| # | Criterion | Status |
|---|---|---|
| 1 | **Critical correctness issues resolved or formally accepted** | 🟡 **1 of 6 resolved (B-1).** B-3/B-4/B-6 **blocked on owner**. B-2 unblocked. B-5 needs an ADR |
| 2 | **Ownership boundaries documented** | ✅ **DONE** — §4 |
| 3 | **Configuration is deterministic** | 🟡 **PARTIAL.** Boot is deterministic; **ownership is not.** 1 raw writer remains. No startup validation |
| 4 | **Lifecycle risks understood** | ✅ **DONE** — §5. Two races **documented, not fixed** |
| 5 | **Regression protection for critical behaviour** | 🟡 **48 suites.** But **0 route tests** and **no restart-halt integration test** — the exact behaviour B-3 breaks |
| 6 | **Remaining risks explicitly tracked** | ✅ **DONE** — §1, and 001-F §6 |

> ## **STABILIZATION: NOT COMPLETE.**
>
> **Two of six criteria are fully met. The blocker is not engineering — it is that four critical
> defects sit in protected files and require an owner's decision.**
>
> **Total code across all four: under 30 lines.**

---

## SECTION 11 — STABILIZATION ROADMAP

### Immediate — **owner decision required**

| | Action | Code |
|---|---|---|
| 1 | **Approve B-3** — a halted engine must stay halted across a restart | ~6 lines |
| 2 | **Approve B-4** — `server.js` reads the lot from `instrument-registry`, not `65` | ~3 lines |
| 3 | **Approve B-6** — `.env` written atomically via `safe-write` | ~4 lines |
| 4 | **Approve `mountAll()`** — observability 1/10 → ~6/10 | **1 line** |

### Next — **no approval needed** *(non-protected, additive or defect-only)*

| | Action |
|---|---|
| 5 | **Triage the 92 empty catches** (1–2 h) — the cheapest way to find the next fail-open |
| 6 | **`clearInterval` on all 14 timers** in `_gracefulShutdown` (B-9) |
| 7 | **B-7** — stop recommending `wire it live` on a failing DSR |
| 8 | **B-12** — remove or evidence the "backtest-grounded" claim |
| 9 | **Delete the 4 dead modules** (Ca = 0) — zero risk |
| 10 | **Write ADR-001, ADR-002, ADR-003** |

### Then — **behaviour change, approval per script**

| | Action |
|---|---|
| 11 | **B-2** — fix the look-ahead in the 7 remaining strategy scripts, **one at a time**, each with its own tripwire test modelled on `test/bt-validate-lookahead.test.js`. **The results WILL get worse. That is the correct outcome** |

---

## SECTION 12 — THE ONE THING TO UNDERSTAND

> Before today, this platform had a statistical validation harness implementing purged k-fold,
> walk-forward, PSR and deflated Sharpe — **and it certified a look-ahead artefact as a real edge at
> 95% confidence.**
>
> **The machinery was never the problem. The machinery was pointed at data that had already seen the
> future — and the machinery itself had seen it too.**
>
> **`bt-validate.js` now returns `FAIL (likely overfit)` on the platform's flagship strategy.**
> That is not a regression. **That is the first honest number this repository has ever produced about
> its own edge.**

---

**Protected files modified: NONE. New features: NONE. Live trading: NOT ENABLED. Suite: 48/48.**

**Deliverables:** Stabilization Report (this file) · Critical Issue Register (§1) · State Ownership
Matrix (§4) · Configuration Stability Report (§3) · Lifecycle Assessment (§5) · Technical Debt Priority
List (§7) · Testing Reinforcement Plan (§8) · Stabilization Roadmap (§11).
