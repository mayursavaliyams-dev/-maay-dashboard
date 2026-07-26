# 001-C — CODE QUALITY, MAINTAINABILITY & TECHNICAL DEBT FORENSIC AUDIT

**Standard:** Master Prompt 001-C · **Depends on:** 000-A…E, 001-A, 001-B
**Date:** 2026-07-12 · **HEAD:** `7823864` · **Suite:** 47/47 green
**Mode:** READ-ONLY. **Nothing was refactored, renamed, reorganised or optimised. Zero files modified.**

**Method.** A measurement harness was run against the working tree. Every number is reproducible.
Where static analysis could not establish a fact, the entry reads **UNKNOWN** and states the
measurement that would settle it. **Three findings from my own harness were false positives and were
discarded after manual verification** — they are listed in §16 rather than hidden, because a report
that only shows its successes cannot be trusted.

---

## SECTION 0 — BASELINE

| | |
|---|---|
| Root `.js` files | **81** |
| Total LOC | **25,175** |
| Average comment ratio | **20.5%** — healthy; not padded |
| Functions | **684** |
| Test suites | **47**, exit-code gated |
| **Overall Maintainability** | **38 / 100 — POOR** |

**The single sentence that explains the score:** the codebase is **73 well-written modules averaging
215 lines, plus one file of 7,328 lines that contains the entire application.** Quality is bimodal,
and every aggregate metric is an average across those two populations.

---

## SECTION 1 — FILE HEALTH

| File | LOC | Comment % | Imports | Exports | Responsibilities | Verdict |
|---|---|---|---|---|---|---|
| **`server.js`** | **7,328** | **11%** | **102** | 1 | **≥ 8** | 🔴 **GOD OBJECT** |
| `option-analyzer.js` | 1,128 | 19% | 1 | 1 | 3 (IV, Greeks, PoP) | 🟡 Oversized, cohesive |
| `afternoon-engine.js` | 904 | 13% | 6 | 1 | 4 | 🟡 Oversized |
| `agents-engine.js` | 774 | 16% | 8 | 8 | 5 (the 5-agent pipeline) | 🟡 Cohesive by design |
| `amibroker-bridge.js` | 762 | **8%** | 2 | 1 | **3 + HTTP routes** | 🔴 **Layer violation** (§3) |
| `execution-engine.js` | 726 | 17% | 6 | 1 | 4 | 🟡 **PROTECTED** |
| `pop-seller.js` | 594 | **35%** | 6 | **16** | 3 | 🟢 Well documented |
| `strangle-engine.js` | 542 | 29% | 9 | 1 | 3 | 🟡 **Raw `fs`** (§3) |
| `instrument-registry.js` | 386 | **41%** | **0** | 24 | 1 | 🟢 **EXEMPLARY** |
| `module-contract.js` | 347 | **38%** | 6 | 12 | 1 | 🟢 Well documented |
| `safe-write.js` | 276 | **41%** | 3 | 5 | 1 | 🟢 **EXEMPLARY** |
| `charges.js` | 61 | — | 0 | — | 1 | 🟢 **EXEMPLARY** |
| `live-connector.js` | 460 | **5%** | 6 | 1 | 3 | 🔴 **Undocumented** |
| `dhan-client.js` | 356 | **3%** | 2 | 1 | 2 | 🔴 **Undocumented** |

### Findings

- **Oversized (> 500 LOC): 8 files.** Only `server.js` is a *god object*; the other seven are large but
  cohesive.
- **Responsibility drift — `amibroker-bridge.js`.** A domain module that also **registers HTTP routes**
  (`registerRoutes`, **227 lines** — the longest genuine function in the repository). It knows about
  `req`/`res`. **This is the clearest single-file layer violation in the codebase.**
- **Comment ratio is inversely correlated with risk.** The three files that most need explanation —
  `server.js` (11%), `amibroker-bridge.js` (8%), `dhan-client.js` (3%) — are the least documented.
  The three safest — `safe-write` (41%), `instrument-registry` (41%), `module-contract` (38%) — are the
  best. **The documentation is where the risk is not.**
- **Lazy classes:** `kotak-neo-connector.js` (17 LOC) — a stub. `ecosystem.config.js` (20) — config, fine.

---

## SECTION 2 — FUNCTION HEALTH

**684 functions.** Distribution:

| | Count | % |
|---|---|---|
| > 50 LOC | **71** | 10.4% |
| > 100 LOC | **17** | 2.5% |
| > 4 parameters | **38** | 5.6% |
| Nesting depth > 4 | **40** | 5.8% |

### Top longest (verified; the harness's #1 was a false positive — see §16)

| LOC | Location | Function | Note |
|---|---|---|---|
| **227** | `amibroker-bridge.js:493` | `registerRoutes` | **A domain module registering HTTP routes** |
| **203** | `ai.js:6` | `aiDecision` | 8 parameters |
| **171** | `afternoon-engine.js:123` | `computeScore` | The scoring logic, uninterrupted |
| **147** | `server.js:5281` | `_clampScore` | encloses `gatherMasterSignal` |
| **146** | `server.js:5282` | `gatherMasterSignal` | **the master decision function** |
| **139** | `server.js:1630` | `GET /api/nifty` | |
| **136** | `multiconfirm.js:137` | `evaluate` | |
| **136** | `server.js:1492` | `GET /api/sensex` | **near-duplicate of `/api/nifty`** |
| 127 | `module-contract.js:77` | `defineModule` | **depth 9** |
| 124 | `amibroker-bridge.js:230` | `signalReplayBacktest` | |
| 121 | `master-confluence.js:15` | `fuse` | |
| 121 | `server.js:3475` | `POST` handler | |

### Deepest nesting

| Depth | Location |
|---|---|
| **9** | **`module-contract.js:77` `defineModule`** — 🔴 *the module that enforces contracts is the most deeply nested function in the repository* |
| 7 | `server.js:1369` `_backfillORBFromCandles` |
| 6 | `pop-seller.js:119` `scanPoP` · `amibroker-bridge.js:411` `handleIncomingSignal` |

### Most parameters — **Data Clump / Primitive Obsession**

| Params | Function |
|---|---|
| **9** | **`pop-seller.js:317` `sellPoP`** |
| 8 | `ai.js:6` `aiDecision` · `ai.js:413` `aiDecisionWithClaude` · `database.js:80` `saveCandle` · `gamma-blast-detect.js:6` `detect` |
| 7 | `option-analyzer.js:644` `_impliedVol` · `option-analyzer.js:662` `_popBuyer` · `pop-seller.js:119` `scanPoP` |

**`sellPoP(9 params)` and `scanPoP(7 params)` share most of their arguments** — a textbook **Data Clump**.
A `PoPRequest` object would carry them.

### Most exit points

| Returns | Function |
|---|---|
| **19** | `candlestick-patterns.js:93` `detectPattern` (79 LOC) — a 19-way decision tree in one function |
| 14 | `module-contract.js:77` `defineModule` |
| 13 | `amibroker-bridge.js:493` `registerRoutes` |
| 10 | `afternoon-engine.js:296` `tick` |

---

## SECTION 3 — CODE SMELL INVENTORY

| Smell | Present? | Evidence | Severity |
|---|---|---|---|
| **God Object** | **YES** | `server.js` — 7,328 LOC, 172 routes, 62 globals, 102 imports, 14 timers, ≥8 responsibilities | **CRITICAL** |
| **God Function** | **YES** | `registerRoutes` 227L · `aiDecision` 203L · `computeScore` 171L · `gatherMasterSignal` 146L | **HIGH** |
| **Long Method** | **YES** | **71 functions > 50 LOC; 17 > 100 LOC** | HIGH |
| **Long Parameter List** | **YES** | **38 functions with > 4 params**; worst `sellPoP` (9) | MEDIUM |
| **Duplicate Code** | **YES** | See §4 — `GET /api/nifty` (139L) ≈ `GET /api/sensex` (136L); Kelly ×4; `bsGamma` ×2 | **CRITICAL** |
| **Divergent Change** | **YES** | `server.js` changes for *any* reason: a new route, a new engine, a new timer, a new instrument | **CRITICAL** |
| **Shotgun Surgery** | **YES** | Adding an instrument requires: 14 new globals + a ~139-line handler + a `lotSize` literal + engine wiring. **Measured:** the NIFTY/SENSEX pair already demonstrates it | **HIGH** |
| **Feature Envy** | **YES** | `server.js` reaches into engine internals (`engine.capital`, `engine.autoEnabled`, `engine._haltedReason`) rather than asking them | HIGH |
| **Inappropriate Intimacy** | **YES** | `server.js:7278` calls `setAutoEnabled(true)` — **reaching past the engine's own halt state**. This *is* Risk A-01 | **CRITICAL** |
| **Primitive Obsession** | **YES** | Capital, lot size, strike, premium — all bare numbers. **No value objects.** `lot` is a `number` that is sometimes `null` and used to be `75` | HIGH |
| **Data Clumps** | **YES** | `sellPoP(9)` / `scanPoP(7)` share arguments; `(S, K, T, sigma, r)` passed as 5 loose numbers to two different `bsGamma`s **in a different order** | **CRITICAL** |
| **Temporary Fields** | **YES** | `_signalPaperBusy:5890` — an ad-hoc mutex for one of six position slots | MEDIUM |
| **Message Chains** | Minor | `gammaBlastEngine.status().detect[inst]?.expiry` (`server.js:5956`) | LOW |
| **Middle Man** | **NO** | — | — |
| **Speculative Generality** | **YES** | `module-contract.js` — 347 LOC, 11 service surfaces, 114 assertions, **0 routes mounted**. `engine-verdict.js` — a full contract, **1 adopter**. `bt-validate.js` — **0 callers**. `kotak-neo-connector.js` — 17-LOC stub | **HIGH** — *built for a future that never arrived* |
| **Lazy Class** | Minor | `kotak-neo-connector.js` (17 LOC stub) | LOW |
| **Dead Code** | **YES** | `postmortem.js`, `preflight.js`, `preflight-registry.js`, `export-backtest-excel.js` — **Ca = 0** | LOW |

> **The most damning smell is not the god object. It is Speculative Generality *combined with* the god
> object:** three of the best-engineered modules in this repository (`module-contract`, `engine-verdict`,
> `bt-validate`) are **fully built, fully tested, and connected to nothing** — because the only place
> they could connect to is a protected 7,328-line file.

---

## SECTION 4 — DUPLICATION ANALYSIS

### 🔴 Harmful — must be resolved

| Duplication | Evidence | Why harmful |
|---|---|---|
| **`bsGamma` × 2** | `vol-context.js:42` `(S,K,sigma,T)`, **r=0** · `gex-skew.js:18` `(S,K,T,sigma,r=0.065)`, **r=0.065** | **Different physics AND swapped parameters.** A copied call site silently exchanges σ and T and returns a plausible wrong number **with no error.** See 001-B Risk A-02 |
| **Kelly × 4** | `position-sizer.js` · `strangle-engine.js` · `trade-planner.js` · `vix-kelly-sizer.js` | Four position sizes for one bet |
| **`GET /api/nifty` (139L) ≈ `GET /api/sensex` (136L)** | `server.js:1630` / `server.js:1492` | Copy-paste per instrument. **Directly causes the 28 duplicated market-state globals** (§7). A third instrument = a third copy |
| **`lotSize` literals** | **`server.js:260`, `server.js:3290`, `server.js:3483` → `lotSize: 65`** | See §5 — 🔴 **this is the worst finding in this report** |
| **Halt/capital restore logic** | `execution-engine.js:381` ≈ `afternoon-engine.js:782` | The same `consecLosses` stale-by-one bug exists in **both** — proving copied code propagates bugs |
| **`LOT = 75`** | `bt-lib.js:16` · `bt-strategies.js:23` · `bt-nifty-intraday.js:226` | Constraint **F1** says the lot is time-varying and lives in the data. Three files disagree |

### 🟢 Acceptable duplication

| | Why acceptable |
|---|---|
| 11 raw `writeFileSync` in `bt-*.js` scripts | Offline, single-writer, re-runnable. `safe-write` buys nothing here |
| Per-strategy backtest scaffolding | Each `bt-*` is a standalone experiment; sharing would couple experiments |

---

## SECTION 5 — MAGIC VALUES

### 🔴 CRITICAL — `lotSize: 65` is hardcoded in `server.js`, three times

```
server.js:260    lotSize: 65,
server.js:3290   lotSize:         65,
server.js:3483   lotSize:         65,
```

**This directly contradicts the project's own single-source-of-truth rule.**
`instrument-registry.js` exists, is **broker-verified**, is **fail-closed**, has **Ca = 10**, is
described in the project's own memory as *"the single source of truth for lot/tick/step/expiry"* — and
`server.js` **bypasses it and writes the number by hand.**

And `65` is not a constant. It is **today's** NIFTY lot. The bhavcopy proves the lot has been
**25, 50, 65 and 75** across 600 days (constraint **F1**). This is the *identical* defect that was found
in `bt-lib.js:16` and fixed on 2026-07-10 — **still live, in the protected file, in three places.**

| | |
|---|---|
| **Classification** | **SAFETY RISK**, not technical debt |
| **Business impact** | Every position size, margin estimate, charge and P&L computed through these paths is scaled by a number that is right only by coincidence, and only today |
| **Confidence** | **HIGH** — measured, three exact line numbers |
| **Blocker** | **Protected file. Requires an approval package.** |

### Other magic values

| Kind | Count | Classification |
|---|---|---|
| **Hardcoded URLs** | **31** — `nsearchives.nseindia.com`, `api.dhan.co`, `api.upstox.com`, `web.sensibull.com`, `api.sensibull.com` | **Technical debt.** Should be config. Not a safety risk — they are public endpoints |
| Hardcoded `data/` paths | 10 | Technical debt. Low |
| **`bt-real.js:9-10`** | **9 tuned constants on two lines**: `MAXPREM=38, MINOI=50000, SL=0.05, TARGET=4.0, TRAIL_AT=2.0, TRAIL_LOCK=0.90, SLIP=0.02, RISKPCT=0.05, GAP_THR=0.15` | 🔴 **Unfalsifiable overfitting.** **Not one of the nine carries a justification, a source, or a sensitivity test.** This is the strategy whose backtest returned PF 0.94. **Nine free parameters is enough to fit noise** |
| Hidden defaults | `CAPITAL_TOTAL \|\| 100000` (`execution-engine.js:54`), `MAX_TRADES_PER_DAY \|\| 2` | **Intentional and acceptable** — but `CAPITAL_TOTAL`'s default is how a *config* value became a *balance* (001-B §11) |

---

## SECTION 6 — ERROR HANDLING

| | Count |
|---|---|
| `catch` blocks | **382** |
| **Empty body `catch (_) {}`** | **92 (24%)** |
| Log-only (`catch { console.log }`) | 29 |
| Re-throwing | **14 (3.7%)** |
| Custom Error classes | **1** — `VerdictError` (`engine-verdict.js`) |
| Error middleware | **0** |
| Unawaited async (heuristic) | 2 — low |

### Empty catches by file

```
server.js 57 · event-engine.js 5 · strangle-engine.js 5 · news-engine.js 4
safe-write.js 4 · dhan-ws-feed.js 3 · afternoon-engine.js 2 · agents-engine.js 2
```

### Severity classification

| Class | Count | Severity | Reasoning |
|---|---|---|---|
| **Empty catch around a WRITE or a STATE MUTATION** | **UNKNOWN — requires line-by-line review** | **CRITICAL** | A failed persist that looks like a success is the exact fault class behind every fail-open found this cycle |
| Empty catch around an optional read / enrichment | most of the 92 | LOW | Genuinely optional — a missing news feed should not halt trading |
| **`safe-write.js` — 4 empty catches** | 4 | **MEDIUM** | 🔴 **In the module whose entire purpose is to fail closed.** Requires review: an empty catch inside a fail-closed primitive is a contradiction in terms |

> **STOP CONDITION (per 001-C).** Classifying all 92 individually requires reading each site's
> surrounding block. **Static analysis cannot determine which of them swallow a state mutation.**
> Recorded as **UNKNOWN**. The measurement that settles it: a scan for `catch {}` whose `try` block
> contains an assignment to `this.*` or a `writeFileSync`. **Estimated 1–2 hours. Recommended.**

**The architectural fault:** there is **no error taxonomy**. A corrupt ledger, a broker 429 and a typo
in a query string are the same thing to this codebase. Nothing can distinguish *retryable* from *fatal*
from *refuse*. `engine-verdict.js` demonstrates the correct shape — **it has one adopter.**

---

## SECTION 7 — STATE MUTATION REPORT

### Capital — **6 write sites, 3 owners, 0 ledgers**

| Site | Writer |
|---|---|
| `execution-engine.js:54` | `this.capital = parseFloat(process.env.CAPITAL_TOTAL \|\| 100000)` |
| `execution-engine.js:113` | `setConfig()` ← **`CAPITAL_TOTAL` from `config-overrides.json`** |
| `execution-engine.js:381` | `restoreEquity()` ← the persisted balance |
| `afternoon-engine.js:80` | `this.capital = totalCapital * afternoonPct` |
| `afternoon-engine.js:782` | `restoreEquity()` |
| `strangle-engine.js:82` | `this.capital = parseFloat(cfg.capital ?? STRANGLE_CAPITAL ?? 100000)` |

| | |
|---|---|
| **Owner** | **NONE** |
| **Readers** | `execution-engine.js:302` (**arms the daily-loss brake**), all sizing paths, `/api/risk`, the dashboard |
| **Mutation frequency** | Every trade, every boot, every `POST /api/engine/config` |
| **Synchronization** | **NONE** |
| **Safety concern** | 🔴 **Until 2026-07-10, line order decided the account balance.** A *settings* file (`config-overrides.json`) overwrote a *restored balance*. The boot-order fix treats the symptom; **the shape that allowed it — capital being writable from a config path — is unchanged** |

### Halt / risk state — 12 write sites in `afternoon-engine.js` alone

```
afternoon-engine.js:391-392   autoEnabled=false; _haltedReason='DAILY_LOSS'
afternoon-engine.js:737-738   autoEnabled=false; _haltedReason='DRAWDOWN'
afternoon-engine.js:760-761   _haltedReason='CONSEC_LOSSES'; autoEnabled=false
afternoon-engine.js:787-788   _haltedReason='EQUITY_STATE_CORRUPT'; autoEnabled=false
afternoon-engine.js:826-828   setAutoEnabled(v) { this.autoEnabled = v; }    ◀── 🔴
```

🔴 **`setAutoEnabled(v)` sets `autoEnabled` and NEVER reads `_haltedReason`.** Four separate code paths
carefully halt the engine; **one setter silently undoes all four.** `server.js:7278` calls it at every
boot.

> **Four writers halt. One writer un-halts. The un-halter cannot see the halt.**
> This is Risk **A-01**, and §7 shows it is not a typo — it is a **missing invariant**. The correct fix
> is not "check the flag at line 7278"; it is **"`autoEnabled` must not be settable while
> `_haltedReason` is non-null."** The invariant belongs in the engine, not the caller.

---

## SECTION 8 — TESTABILITY

| Module | Clock refs | Hidden IO | Injectable? | Score | Evidence |
|---|---|---|---|---|---|
| **`charges.js`** | 0 | 0 | pure | **10** | Pure function. 12 dependents. Fully deterministic |
| **`gex-skew.js`** | 0 | 0 | pure | **10** | Pure |
| **`vol-context.js`** | 0 | 0 | pure | **10** | Pure |
| **`meta-label.js`** | 0 | 0 | pure | **10** | Pure |
| **`multiconfirm.js`** | 0 | 0 | pure | **9** | Pure; one 136-LOC function |
| **`strategy.js`** | 0 | 0 | pure | **9** | Pure |
| **`engine-verdict.js`** | 0 | 0 | yes | **10** | Pure + typed errors. **The model to copy** |
| **`instrument-registry.js`** | 2 | 0 | frozen table | **9** | Clock used only for expiry-weekday logic |
| `option-analyzer.js` | 4 | 0 | partial | **7** | Mostly pure; 1,128 LOC |
| `safe-write.js` | 7 | **4** | no | **6** | IO **is** its purpose; tested via temp dirs |
| `pop-seller.js` | 5 | 0 | **yes — clock injected** | **7** | 🟢 **Was 4.** The suite went red at midnight; the clock is now injected. **Proof the discipline works** |
| `execution-engine.js` | **9** | 0 | constructor | **5** | **PROTECTED.** No raw `fs` (good), but 9 internal clock reads |
| `signal-health.js` | 0 | **2** | no | **4** | Hidden file IO |
| `afternoon-engine.js` | **14** | 0 | constructor | **4** | 14 internal clock reads |
| `strangle-engine.js` | 6 | **3** | partial | **3** | 🔴 **Raw `fs` + internal clock.** The least testable engine |
| **`server.js`** | many | **36 sync IO** | no | **1** | 🔴 **Cannot be tested without booting the world.** No route is reachable without the whole process |

### The pattern

**Testability is bimodal, exactly like file size.** The analytics layer is **9–10/10 — genuinely
excellent, pure, deterministic**. The engine layer is **3–5**. `server.js` is **1**.

> **The 47 test suites exist *despite* the architecture, not because of it.** They test the pure
> modules (easy) and reach into the engines through characterization (hard). **Nothing tests a route.**

**`pop-seller.js` is the proof the process works:** its suite went red at midnight with no code change,
the clock was injected, and the score moved 4 → 7. **That is the template for every engine.**

---

## SECTION 9 — PERFORMANCE SMELLS

**Per 001-C: no optimisation is recommended without evidence. There is no profiling evidence. Nothing
below is a recommendation to optimise — only a recorded observation.**

| Smell | Measured | Assessment |
|---|---|---|
| **Synchronous IO in `server.js`** | **36 calls**; **8 within a route handler** | **Real, but not currently harmful.** Single user, local disk. Would matter under concurrency. **No profile exists — do not optimise** |
| `JSON.parse` calls | 44 | Config/state files are small. Not a concern |
| `bt-bhav-fetch.js` sync IO | 10 | Offline script. **Correct — sync is simpler and safe here** |
| Redundant parsing | **UNKNOWN** | Would need a profile |
| Duplicate computation | **`gatherMasterSignal` is called from several routes** — whether it recomputes or is cached is **UNKNOWN** without tracing | **UNKNOWN — measurement: add a call counter for one session** |

> **The honest performance finding is that there is no baseline.** 000-E requires one
> ("never optimize without comparing against a baseline"). `scripts/perf-report.js` ratchets **IO-write
> counts** only. **Startup time, memory, and request latency have no baseline.** Until they do, every
> performance claim in this project — including this section — is unfalsifiable.

---

## SECTION 10 — SECURITY SMELLS

**Only evidence is reported. Three suspected findings were investigated and cleared.**

| Check | Result | Evidence |
|---|---|---|
| **Secrets written by an HTTP handler** | 🔴 **CONFIRMED** | **`server.js:2028`** `_fs.writeFileSync(_envPath, env)` — the broker OAuth callback **rewrites the entire `.env`**, including tokens. **Non-atomic**, mode `0644`. An interrupted write truncates it and **every credential is lost at the next boot** |
| Security headers | 🔴 **ABSENT** | `helmet` / CSP → **0 matches**. No HSTS, no X-Frame-Options |
| Auth on routes | 🔴 **ZERO** | **0 of 172 routes carry auth middleware.** `auth.js` (JWT/RBAC) exists; `AUTH_ENABLED` **defaults to off**. **Default posture = ALLOW.** 000-E mandates DENY |
| **Command injection** | 🟢 **CLEARED** | `server.js:5110` `spawn(process.execPath, ['bt-real.js'], {cwd:__dirname})` — **arguments are fixed literals. No user input reaches the command.** Not a vulnerability |
| **Path traversal** | 🟢 **CLEARED** | `grep` for a file path built from `req.query`/`params`/`body` → **0 matches** |
| **Hardcoded secrets in source** | 🟢 **CLEARED** | **0 matches.** `.env` is git-ignored; `module-contract.js` redacts by deny-list |
| **CORS wildcard** | 🟢 **LOW** | `server.js:99` sets `Access-Control-Allow-Origin: *` **only when the request carries no `Origin` header** (for `file://` pages). A request with no origin is not a cross-origin request. **Not a vulnerability** |
| **Request body limit** | 🟢 **CLEARED** | `express.json()` — Express's **default limit is 100 kb**. Bounded |
| Input validation | 🟡 **ABSENT** | No `zod`/`joi`. Handlers coerce `req.query.x` by hand. **Low impact locally; would be HIGH if exposed** |

> **The security posture is better than expected in every category except one.** There is exactly **one
> real vulnerability**: `server.js:2028`. It is in a protected file and it has an approval package.

---

## SECTION 11 — DOCUMENTATION QUALITY

| | |
|---|---|
| Files with a module header | **73 / 81 (90%)** — **good** |
| JSDoc `@param`/`@returns` blocks | 114 |
| Average comment ratio | 20.5% — **not padded, not sparse** |

### Files with **NO** module header

```
server.js  ·  engine-verdict.js  ·  module-contract.js  ·  dhan-auth.js
dhan-client.js  ·  export-backtest-excel.js  ·  preflight-registry.js  ·  ecosystem.config.js
```

> **`server.js` — the 7,328-line file that IS the application — has no module header.** Neither do
> `engine-verdict.js` and `module-contract.js`, the two modules that define the project's own contracts.

### What is missing that matters

| Gap | Impact |
|---|---|
| **No ADRs** | Decisions live in `docs/APPROVAL-*.md`, which record *changes*, not *decisions*. **Why is `CAPITAL_TOTAL` in a config file? Why two `bsGamma`s? Nobody wrote it down, and nobody now knows** |
| **No ownership notes** | No `@owner` anywhere. §7 shows capital has 3 writers — **and no file claims it** |
| **No recovery documentation** | `safe-write.js` has tested restore; **the procedure to actually recover a corrupt `data/` directory is not written anywhere** |
| **Comment ratio inverted against risk** | The 3 riskiest files average **7%**; the 3 safest average **40%** |

**Not a problem:** comment volume. **The comments that exist are good** — `bt-lib.js` and
`instrument-registry.js` explain *why*, not *what*. **Do not add more comments. Add ADRs.**

---

## SECTION 12 — MAINTAINABILITY INDEX

| Module | Read | Test | Modular | Coupling | Cohesion | Docs | Stability | **Score** |
|---|---|---|---|---|---|---|---|---|
| **`charges.js`** | 10 | 10 | 10 | 10 | 10 | 8 | 10 | **97** |
| **`safe-write.js`** | 9 | 6 | 10 | 10 | 10 | 10 | 10 | **93** |
| **`instrument-registry.js`** | 9 | 9 | 10 | 10 | 10 | 10 | 9 | **96** |
| **`engine-verdict.js`** | 9 | 10 | 10 | 10 | 10 | 6 | 9 | **91** |
| `gex-skew.js` / `vol-context.js` | 8 | 10 | 9 | 9 | 9 | 8 | 5 | **83** ⚠️ *stability 5 — the two disagree* |
| `meta-label.js` | 8 | 10 | 9 | 9 | 9 | 8 | 8 | **87** |
| `multiconfirm.js` | 6 | 9 | 8 | 9 | 8 | 7 | 8 | **79** |
| `pop-seller.js` | 7 | 7 | 7 | 7 | 8 | 9 | 7 | **74** |
| `option-analyzer.js` | 6 | 7 | 6 | 9 | 8 | 7 | 8 | **73** |
| `execution-engine.js` | 6 | 5 | 6 | 8 | 7 | 7 | 6 | **64** |
| `afternoon-engine.js` | 5 | 4 | 5 | 7 | 6 | 5 | 5 | **53** |
| `strangle-engine.js` | 5 | **3** | 5 | 6 | 6 | 7 | 5 | **50** |
| `amibroker-bridge.js` | 4 | 3 | **2** | 5 | **3** | 2 | 5 | **34** |
| **`server.js`** | **2** | **1** | **1** | **1** | **1** | 2 | **3** | **16** |

### **Overall Maintainability: 38 / 100 — POOR**

**Weighted by LOC.** `server.js` is 29% of the codebase and scores **16**. Remove it and the remaining
80 files average **74 — GOOD**.

> **This is the most important number in this report: 38 is not the codebase's quality. It is the
> average of a 74 and a 16, and the 16 is 7,328 lines long.**

---

## SECTION 13 — TECHNICAL DEBT REGISTER

| ID | Description | Evidence | Sev | Business impact | Effort | Risk if ignored | Sequence |
|---|---|---|---|---|---|---|---|
| **D-01** | **`lotSize: 65` hardcoded in `server.js` ×3** while a fail-closed broker-verified registry exists | `server.js:260, 3290, 3483` | **CRITICAL** | Every size / charge / P&L through these paths is right only by coincidence, and only today | Hours | The exact defect just fixed in `bt-lib.js`, still live | **1 — PROTECTED, needs approval** |
| **D-02** | **`setAutoEnabled()` can un-halt a halted engine** | `afternoon-engine.js:826`; `server.js:7278`; **0 refs to `_haltedReason`** | **CRITICAL** | The risk brake is undone by a restart | Hours | 000-E's "Trading unexpectedly enabled" | **1 — package written, awaiting owner** |
| **D-03** | **Two `bsGamma`: r=0 vs r=0.065, parameters swapped** | `vol-context.js:42` / `gex-skew.js:18` | **CRITICAL** | A copied call silently swaps σ and T. Two GEX numbers on one dashboard | Hours | Silent wrong numbers, no error | **2** |
| **D-04** | **`.env` rewritten non-atomically from an HTTP handler** | `server.js:2028` | **HIGH** | Interrupted write ⇒ all credentials lost | Hours | Total credential loss | **2 — PROTECTED** |
| **D-05** | **`server.js` god object** — 7,328 LOC, 172 routes, 62 globals, 0 Routers | measured | **CRITICAL** | Every change is high-risk; **nothing can be unit-tested** | Weeks | Compounding | **3 — after characterization** |
| **D-06** | **92 empty catches** (57 in `server.js`, **4 in `safe-write.js`**) | measured | **HIGH** | A failure is indistinguishable from a success | Days | The fault class behind every fail-open found | **3** |
| **D-07** | **14 timers / 0 `clearInterval`** | measured | **HIGH** | The EOD snapshot is read while 14 writers still run | Hours | Corrupt persisted state | **2** |
| **D-08** | **`bt-real.js:9-10` — 9 tuned constants, none justified** | measured | **HIGH** | **Nine free parameters can fit noise.** This is the strategy that returned PF 0.94 | Days | Unfalsifiable overfitting | **3** |
| **D-09** | Kelly ×4 | measured | MEDIUM | 4 sizes for 1 bet | Days | Divergence | 4 |
| **D-10** | `GET /api/nifty` ≈ `GET /api/sensex` (139L / 136L) | measured | MEDIUM | 3rd instrument = 3rd copy + 14 globals | Days | Shotgun surgery | 4 |
| **D-11** | 10 raw production writes / 10 unvalidated JSON reads | measured | HIGH | Corruption | Hours | — | **1 — 7 packages already written** |
| **D-12** | `amibroker-bridge.js` registers HTTP routes (227-LOC `registerRoutes`) | measured | MEDIUM | Domain knows about transport | Days | — | 4 |
| **D-13** | **Speculative generality** — `module-contract` (0 routes), `engine-verdict` (1 adopter), `bt-validate` (0 callers) | measured | **HIGH** | **The three best modules do nothing** | **1 line for `mountAll`** | Wasted investment | **1 — PROTECTED** |
| **D-14** | No structured logging (71 `console.log`) | measured | MEDIUM | Not operable | Days | 000-E fails | 4 |
| **D-15** | No error taxonomy; 1 custom Error class | measured | MEDIUM | Cannot distinguish retryable/fatal | Days | — | 4 |
| **D-16** | No performance baseline (startup, memory, latency) | measured | MEDIUM | **Every perf claim is unfalsifiable** | Days | — | 4 |
| **D-17** | 31 hardcoded URLs | measured | LOW | Config drift | Hours | — | 5 |
| **D-18** | Dead code — 4 modules, Ca=0 | measured | LOW | Noise | Minutes | — | 5 |
| **D-19** | No ADRs, no `@owner` notes | measured | MEDIUM | **Nobody knows why `CAPITAL_TOTAL` is a config key** | Days | Knowledge loss | 4 |
| **D-20** | 38 functions with > 4 params (worst: 9) | measured | LOW | — | Days | — | 5 |

---

## SECTION 14 — REFACTORING READINESS MATRIX

| Subsystem | Ready? | Blocked by | Characterize first? | Protected? | Approval? | Behaviour-sensitive? |
|---|---|---|---|---|---|---|
| **`charges.js`** | ✅ | — | Already tested | No | No | **YES — the rates are disputed (E1)**. Do not touch |
| **`safe-write.js`** | ✅ | — | Tested | No | No | Low. **Except: review the 4 empty catches** |
| **`instrument-registry.js`** | ✅ | — | Tested | No | No | **YES — fail-closed. Do not weaken** |
| **`gex-skew` + `vol-context` → one `quant/`** | ⚠️ | **Nobody owns `r`** | **YES — equivalence test proving old == new** | No | **YES — the numbers WILL move** | **YES** |
| **Kelly ×4 → one** | ⚠️ | — | **YES — equivalence test** | No | **YES** | **YES** |
| **`server.js` → `routes/`** | ✅ | — | **YES — a route-response snapshot test for all 172** | **YES** | **YES** | **No — a mechanical `express.Router()` move** |
| **`server.js` timers → `Scheduler`** | ✅ | — | **YES** | **YES** | **YES** | **No — registration only, no timing change** |
| **`server.js` globals → `MarketState`** | ❌ | **62 unsynchronized globals, 6 position slots, 1 ad-hoc mutex** | **YES** | **YES** | **YES** | **YES — high** |
| **`execution-engine.js`** | ❌ | **PROTECTED** | **YES** | **YES** | **YES** | **YES — this is the risk brake** |
| **`afternoon-engine.js`** | ⚠️ | Same stale-`consecLosses` bug | **YES** | No | **YES** | **YES** |
| **`strangle-engine.js`** | ⚠️ | Raw `fs`, internal clock | **YES** | No | Low for the `fs` fix | Low |
| **`amibroker-bridge.js`** | ✅ | — | **YES** | No | Low | Low — moving routes out is mechanical |
| **`bt-real.js` 9 constants** | ❌ | **No evidence for any of the 9** | **N/A — this needs research, not refactoring** | No | **YES** | **YES** |
| **Dead code deletion** | ✅ | — | Ca=0 — nothing to characterize | No | No | **None** |

**Default per 001-C: characterize before refactor. Applied everywhere above.**

**The one subsystem that is ready, unprotected, safe and valuable: deleting the 4 dead modules
(Ca = 0), and extracting `registerRoutes` out of `amibroker-bridge.js`.** Everything else either needs
an approval package or needs research first.

---

## SECTION 15 — EXECUTIVE SUMMARY

### Top 10 code-quality risks

| # | Risk | Evidence |
|---|---|---|
| 1 | **`lotSize: 65` hardcoded ×3 in `server.js`** while a fail-closed registry exists | `server.js:260, 3290, 3483` |
| 2 | **`setAutoEnabled()` un-halts a halted engine; 4 halters, 1 un-halter, no invariant** | `afternoon-engine.js:826`, `server.js:7278` |
| 3 | **Two `bsGamma`: different `r`, swapped parameters** | `vol-context.js:42` / `gex-skew.js:18` |
| 4 | **92 empty catches — 4 inside `safe-write.js` itself** | measured |
| 5 | **`.env` rewritten non-atomically from an HTTP handler** | `server.js:2028` |
| 6 | **14 timers, 0 `clearInterval`; the EOD snapshot is read mid-write** | measured |
| 7 | **`bt-real.js` — 9 unjustified tuned constants** | `bt-real.js:9-10` |
| 8 | **Capital: 6 write sites, 3 modules, 0 ledgers** | §7 |
| 9 | **0 of 172 routes carry auth; default posture ALLOW** | measured |
| 10 | **No performance baseline ⇒ every perf claim unfalsifiable** | measured |

### Top 10 maintainability risks

1. `server.js` — **maintainability 16/100**, 29% of the codebase
2. 71 functions > 50 LOC; 17 > 100 LOC
3. 62 unsynchronized globals; no mutex except one ad-hoc flag
4. `GET /api/nifty` ≈ `GET /api/sensex` — instrument logic copy-pasted
5. `module-contract.defineModule` — **nesting depth 9**, in the contract-enforcing module
6. `amibroker-bridge.registerRoutes` — **227 LOC**, a domain module doing HTTP
7. No ADRs — **decisions are unrecoverable**
8. Comment ratio inverted against risk (riskiest files ≈ 7%)
9. No error taxonomy; 1 custom Error class
10. `server.js` testability **1/10** — no route can be tested

### Top 10 **safest** refactoring opportunities *(low risk, real gain)*

| # | Action | Risk |
|---|---|---|
| 1 | **Delete 4 dead modules** (`postmortem`, `preflight`, `preflight-registry`, `export-backtest-excel` — Ca=0) | **Zero** |
| 2 | **`mountAll()`** — 1 line, observability 1/10 → 6/10 | **Near-zero** (protected) |
| 3 | Extract `registerRoutes` out of `amibroker-bridge.js` | Low |
| 4 | Register the 14 timers in a `Scheduler` **without changing them** | Low |
| 5 | `express.Router()` extraction, one namespace at a time | Low (needs route snapshot tests) |
| 6 | Route the 10 raw writes through `safe-write` | Low (**7 packages written**) |
| 7 | Add `helmet` | Low |
| 8 | Add module headers to the 8 files lacking one | Zero |
| 9 | Startup config validation (fail closed on missing env) | Low |
| 10 | Structured logger behind the existing `console.log` calls | Low |

### Top 10 **highest-risk** areas — *do not touch without characterization + approval*

`server.js` (all of it) · `execution-engine.js` (the risk brake) · the 62 globals · the 6 position
slots · `setAutoEnabled` · capital's 6 write sites · `charges.js` (rates disputed — E1) ·
`instrument-registry.js` (fail-closed — do not weaken) · the two `bsGamma`s · `bt-real.js`'s 9 constants

### Top 10 files that must remain **STABLE** *(they are correct — protect them)*

`charges.js` (97) · `instrument-registry.js` (96) · `safe-write.js` (93) · `engine-verdict.js` (91) ·
`meta-label.js` (87) · `bt-lib.js` (fixed 2026-07-10) · `module-contract.js` · `bt-validate.js` ·
the 47 test suites · `docs/APPROVAL-*.md` (the audit trail)

### Top 10 files requiring architectural redesign *(conceptual only — 001-B §16)*

`server.js` → `routes/` + `app/EngineHost` + `app/Scheduler` + `state/MarketState` ·
`amibroker-bridge.js` (remove HTTP) · `afternoon-engine.js` (inject clock) ·
`strangle-engine.js` (remove raw `fs`, inject clock) · `gex-skew.js` + `vol-context.js` → one `quant/` ·
the 4 Kelly implementations → one · `ai.js` (`aiDecision` 203L, 8 params) ·
`option-analyzer.js` (1,128 LOC, 3 concerns) · `bt-real.js` (9 free parameters)

---

## SECTION 16 — MY OWN HARNESS'S FALSE POSITIVES

**Three findings my measurement produced were WRONG and were discarded after manual verification.**
Recorded per 000-A Rule Zero — a report that hides its own errors is evidence of nothing.

| Reported | Reality | How it was caught |
|---|---|---|
| **"`server.js:1994` — a 1,647-line function with 83 exit points"** | **`server.js:1994` is not a function.** It is an `if` block *inside* a handler that ends at `:2003`. My brace-walker matched a nested line and ran away | Read the line |
| **"Command-injection risk at `server.js:5110`"** | `spawn(process.execPath, ['bt-real.js'], {cwd:__dirname})` — **arguments are fixed literals. No user input.** Not a vulnerability | Read the call |
| **"CORS wildcard at `server.js:99`"** | `Access-Control-Allow-Origin: *` is set **only when the request has no `Origin` header** (for `file://` pages). A request with no origin is not cross-origin | Read the block |

> **Three of my automated findings were false. All three would have been "critical" in a report that
> did not verify them.** This is exactly why 001-C requires evidence per finding, and why every
> surviving finding above carries a file and a line number that was read by hand.

---

## STOP CONDITIONS DECLARED

| Question | Status |
|---|---|
| Which of the 92 empty catches swallow a **state mutation**? | **UNKNOWN.** Static analysis cannot tell. Measurement: scan for `catch {}` whose `try` contains `this.* =` or `writeFileSync`. **1–2 hours** |
| Does `gatherMasterSignal` recompute or cache across routes? | **UNKNOWN.** Needs a call counter for one session |
| What is the correct risk-free rate `r`? | **UNKNOWN. Nobody owns it.** Not a code question |
| Are any of `bt-real.js`'s 9 constants justified? | **UNKNOWN — and that is the finding.** No source, no sensitivity test, no ADR |
| What unit is the live broker chain's OI? | **UNKNOWN.** 001-B Risk A-13. **One row of comparison settles it** |

---

**Files modified: NONE. Behaviour changed: NONE. Suite: 47/47.**

**Deliverables:** Code Health Report (§1) · Maintainability Report (§12) · Technical Debt Register (§13) ·
Code Smell Inventory (§3) · Function Complexity Report (§2) · State Mutation Report (§7) ·
Testability Report (§8) · Performance Smell Report (§9) · Security Smell Report (§10) ·
Refactoring Readiness Matrix (§14) · Executive Summary (§15).
