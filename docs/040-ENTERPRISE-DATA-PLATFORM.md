# 040 — ENTERPRISE DATA PLATFORM: MASTER BLUEPRINT, GOVERNANCE & TARGET ARCHITECTURE

**Standard:** Master Prompt 040 · **The capstone. Depends on: 000-A … 039**
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No application logic redesigned. No infrastructure implemented.**

**040 asks whether an independent enterprise data architect could trace any dataset from origin to
consumer, verify governance, and reproduce research using documented evidence alone.**

---

# ═══════════════════════════════════════════════════════════
# SECTION 0 — THREE OF 040's FOUR STOP CONDITIONS FIRE
# ═══════════════════════════════════════════════════════════

**040 lists four stop conditions. I tested all four by measurement, not assertion.**

| # | Stop condition | Verdict |
|---|---|---|
| **SC-1** | *"A domain has no identifiable owner"* | 🔴 **FIRES — 6 of 15 domains** |
| **SC-2** | *"Data contracts cannot be established"* | 🔴 **FIRES — and the reason is remarkable (§0.2)** |
| **SC-3** | *"Scientific reproducibility cannot be demonstrated"* | 🔴 **FIRES — 0 of 25 result files** |
| **SC-4** | *"Cross-domain dependencies cannot be verified"* | 🟢 **DOES NOT FIRE — 137 edges verified (§0.3)** |

## §0.1 — SC-1: six domains have no owner because **they do not exist**

```
  MEASURED — 15 enterprise data domains, owner search across 81 root modules:

  🔴 NO IDENTIFIABLE OWNER (6):
     Tick Data       — no ticks, ever. Not one tick has been persisted.       (037)
     Replay Data     — 1 of 8 event classes replayable.                       (037)
     Feature Store   — features are COMPUTED AND DISCARDED on every tick.     (035)
     Audit Records   — no audit trail exists.                                 (022)
     Archives        — nothing is archived. Files are DELETED, not moved.     (039)
     Logs            — console only; they die with the process.               (021)

  🟡 CONTESTED OWNERSHIP (4):
     Market Data     — dhan-client · dhan-ws-feed · upstox-connector
     Historical Data — bt-bhav-fetch · bt-lib
     AI Datasets     — agents-engine · confluence-learner
     Paper Trading   — strangle · gamma-blast · execution-engine
     Configuration   — 3 writers, no owning module                            (004)

  🟢 SINGLE CLEAR OWNER (5):  Option Chain · Risk · Portfolio · Reports · (bhavcopy fetch)
```

> **The six ownerless domains are ownerless for the cleanest possible reason: there is nothing to own.
> Four of the fifteen enterprise data domains have never been built. `Unknown ≠ Zero` — so I report them
> as UNKNOWN/ABSENT, not as "immature."**

## §0.2 — 🔴 SC-2: **the platform HAS a data-contract layer. It is used as a display widget.**

**`broker-connector.js` — 89 lines, its own header states its purpose:**

```js
//  • CORE — the method contract every connector must satisfy
//  • conforms() — validate an adapter against the contract (SAFE-SWAP GATE)
//  • describe() — capability map
//  • normalizePrice / normalizeChain — ONE CANONICAL OUTPUT SHAPE (kills duplication)
//  • BrokerRegistry — register named adapters, select the active one
//  It does NOT modify the existing connectors — it wraps/introspects them. Pure + tested.
```

**It is correct. It is unit-tested (`test/broker-connector.test.js`). It is required by `server.js:6093`.**

**And then:**

```js
server.js:6094
  app.get('/api/brokers', (req, res) => {
    const reg = new _BrokerRegistry();
    try { reg.register(live.constructor.name, live, { activate: true }); } catch (_) {}
    res.json({ ok: true, active: reg.activeName, contract: _BROKER_CORE, connectors: reg.list() });
  });                        ↑
                    THAT IS THE ONLY USE. A READ-ONLY JSON PAGE.
```

**Measured — production call sites, excluding `backups/` and `test/`:**

```
  conforms()        →  0
  normalizeChain()  →  0
  normalizePrice()  →  0
```

> ## 🔴 **The safe-swap GATE is never called. The canonical chain NORMALIZER is never called. The platform wrote a data-contract enforcement layer, tested it, wired it into the server — and then used it to render a JSON page that lists what the contract *would* be.**
>
> **This is the ELEVENTH component in this programme that is BUILT, CORRECT, and NOT USED** —
> after `engine-verdict`, `module-contract`, `bt-validate`, `position-sizer`, `auth`, the append-only
> `.jsonl` writer, `perf-report`, PM2, Docker Compose, and the ops playbook's own golden rule.

**And the second half of SC-2 — the write sites (038, re-measured):**

```
  write sites naming a LITERAL file:      10
  write sites using a VARIABLE path:      45     ← writeJsonSync(file, …) / (FILE, …) / (this._tradesFile, …)
```

> **82% of all writes do not name what they write. The lineage graph cannot be statically derived —
> ownership must be *inferred from filenames*. That is not a data contract. That is a naming convention.**

## §0.3 — 🟢 SC-4 does NOT fire — and it names the single point of failure

```
  81 root modules · 137 internal require() edges · graph fully resolvable

  MOST-DEPENDED-UPON MODULE:
    🔴 safe-write.js        ← 28 modules
       charges.js           ← 12
       instrument-registry  ← 10
       bt-lib.js            ←  7
```

> ## 🔴 **`safe-write.js` IS THE PLATFORM'S SINGLE POINT OF FAILURE. Twenty-eight modules depend on it. Every durable write in the system passes through it.**
>
> **The good news, and it is genuinely good: `safe-write.js` is one of the best-engineered files in the
> repository — atomic temp-and-rename, a `.bak` on every write, corrupt-file restore-from-backup, and its
> seven backups were verified to parse with zero corruption (025 §0.1).**
>
> **The platform's most load-bearing component is also one of its most correct. That is not luck; it is
> the one place someone thought about failure.**

---

# PART 1 — ENTERPRISE DATA DOMAIN MAP

| Domain | Owner | Exists? | Backed up? | Versioned? | Contract? |
|---|---|---|---|---|---|
| **Market Data** | 🟡 3 connectors | 🟢 YES | ⚪ transient | 🔴 NO | 🔴 **`conforms()` never called (§0.2)** |
| **Historical Data** | 🟡 `bt-bhav-fetch` + `bt-lib` | 🟢 **600 files, 0 dupes, 0 empty** *(031)* | 🟢 **re-downloadable** | 🔴 NO | 🔴 NO |
| **Option Chain** | 🟢 `server.js` | 🟢 YES | 🔴 **NO** | 🔴 NO | 🔴 NO — **no Greeks, no IV in source** *(036)* |
| 🔴 **Tick Data** | 🔴 **NONE** | 🔴 **DOES NOT EXIST** | — | — | — |
| 🔴 **Replay Data** | 🔴 **NONE** | 🔴 **1 of 8 event classes** *(037)* | — | — | — |
| 🔴 **Feature Store** | 🔴 **NONE** | 🔴 **FEATURES DISCARDED** *(035)* | — | — | — |
| **AI Datasets** | 🟡 2 modules | 🟢 YES | 🟡 **`.bak` 24 h STALE** *(039)* | 🔴 NO | 🔴 NO |
| **Paper Trading** | 🟡 4 modules | 🟢 **THE ONLY CLEAN EVIDENCE** | 🟡 3 of 6 | 🔴 NO | 🔴 NO |
| 🔴 **Risk Data** | 🟢 `execution-engine` | 🟡 **IN-MEMORY ONLY** | 🔴 **NOT PERSISTED** *(005 S-01)* | 🔴 NO | 🔴 NO |
| **Portfolio Data** | 🟢 `execution-engine` | 🟢 YES | 🟡 | 🔴 NO | 🔴 NO |
| **Reports** | 🟢 `server.js` | 🟢 19 files | 🔴 **raw write, no `.bak`** | 🔴 **OVERWRITTEN** *(015)* | 🔴 NO |
| 🔴 **Logs** | 🔴 **NONE** | 🔴 **console — die with the process** *(021)* | — | — | — |
| **Configuration** | 🔴 **3 writers, no module** | 🟢 YES | 🔴 **NO `.bak`** | 🔴 NO | 🔴 **HTTP-DELETABLE** *(039 §1)* |
| 🔴 **Audit Records** | 🔴 **NONE** | 🔴 **DO NOT EXIST** *(022)* | — | — | — |
| 🔴 **Archives** | 🔴 **NONE** | 🔴 **NOTHING IS ARCHIVED** *(039)* | — | — | — |

## **15 domains. 4 do not exist. 0 are versioned. 0 have an enforced contract. 1 is deletable over unauthenticated HTTP.**

---

# PART 2 — END-TO-END DATA FLOW (the flow 040 asks for, against the flow that exists)

```
  040's REQUIRED FLOW                    WHAT ACTUALLY HAPPENS
  ──────────────────────────────────────────────────────────────────────────────────
  External Exchanges          🟢  NSE/BSE via 3 connectors
        ↓
  Market Data Collection      🟢  works. WS feed + REST
        ↓
  Validation                  🔴  NONE. First validation ever performed was audit 031.
        ↓
  Normalization               🔴  normalizeChain() EXISTS AND IS NEVER CALLED (§0.2)
        ↓
  Quality Assessment          🔴  NONE in-line. (033 measured it OUT-OF-BAND: 0% missing fields)
        ↓
  Historical Storage          🟢  600 bhavcopy files.  🔴 lot read from rows[0] (032 §0)
        ↓
  Feature Engineering         🟡  happens — 13 indicators, GEX, skew, meta-label
        ↓
  🔴 Feature Store            🔴🔴  ══ THE FLOW BREAKS HERE ══
                                    Features are COMPUTED AND THROWN AWAY.  (035)
        ↓                           Nothing is stored. Nothing can be replayed.
  🔴 Replay Platform          🔴  1 of 8 event classes. No ticks. (037)
        ↓
  Research                    🟡  13 backtest scripts.  🔴 0 carry a gitSha (§0.4)
        ↓
  AI Training                 🔴  TRAINS ON LIVE STATE, not on a stored dataset (018)
        ↓
  Paper Trading               🟢  THE ONE HONEST SURFACE. Real forward evidence.
        ↓
  Risk Engine                 🔴  reads process.env, NOT the engine. Reports 0 when it holds 15. (013)
        ↓
  Reporting                   🟡  works.  🔴 results OVERWRITTEN in place (015)
        ↓
  🔴 Archive                  🔴  DOES NOT EXIST. Files are DELETED by silent FIFO caps. (039)
```

## 🔴 The structural finding

> **The flow 040 describes is a LINE from exchange to archive. The platform's flow is a line that
> **BREAKS AT THE FEATURE STORE** and never rejoins.**
>
> **Everything upstream of the break (collection → storage) is broadly sound. Everything downstream
> (replay → research → AI → archive) is built on data that was never kept.**
>
> **The platform can see the market. It cannot remember what it saw.**

---

# PART 3 — GOVERNANCE MODEL — one owner per responsibility

| Responsibility | Accountable owner today | Verdict |
|---|---|---|
| **Ownership** | 🔴 **NOBODY** | 82% of writes don't name their file (§0.2) |
| **Validation** | 🟡 `instrument-registry` (fail-closed, excellent) | 🟢 **the ONE governed thing in the platform** |
| **Metadata** | 🔴 **NOBODY** | No catalog. Inferred from filenames *(038)* |
| **Lineage** | 🔴 **NOBODY** | 🔴 **cannot be statically built** *(038)* |
| **Versioning** | 🔴 **NOBODY** | 0 of 15 domains versioned |
| **Security** | 🔴 **NOBODY** | 🔴 **0 of 172 routes authenticated.** `auth.js` guards nothing *(023)* |
| **Access** | 🔴 **NOBODY** | Server binds `0.0.0.0` |
| **Recovery** | 🟡 `safe-write.js` | 🟢 **atomic + `.bak`, 7/7 verified** · 🔴 **14% coverage, 0 of 9 critical** |
| **Compliance** | 🔴 **NOBODY** | — |

## **9 governance responsibilities. 7 have NO owner. The 2 that do — `instrument-registry` and `safe-write` — are both excellent, and both are the work of somebody who cared about one problem in isolation.**

---

# PART 4 — CAPABILITY MATURITY (evidence-backed)

| Capability | Level | Evidence |
|---|---|---|
| **Market Data** | **2** | 3 connectors, WS feed. 🔴 contract never enforced |
| **Historical Storage** | **2** | 🟢 600 files, 0 dupes, stable 34 cols *(031)*. 🔴 27 unexplained gaps; no trading calendar |
| **Data Quality** | **1** | 🟢 **0% missing across 98,410 rows** *(033)*. 🔴 measured by an AUDIT, not by the platform |
| **ETL** | **1** | 🟡 works. 🔴 no orchestration, no retries, no DAG |
| **Streaming** | **1** | 🟡 WS feed. 🔴 **8–30% delivery on 4 of 5 sessions** *(034)* |
| 🔴 **Feature Store** | **0** | 🔴 **DOES NOT EXIST** *(035)* |
| **Option Chain** | **1** | 🔴 **no Greeks, no IV in source; 2 models disagree 6.79%; NO GROUND TRUTH** *(036)* |
| 🔴 **Replay** | **0** | 🟢 determinism VERIFIED byte-identical. 🔴 **1 of 8 event classes** *(037)* |
| 🔴 **Catalog** | **0** | 🔴 **lineage cannot be built** *(038)* |
| 🔴 **Lifecycle** | **0–1** | 🔴 **a FIFO cap will DELETE the only complete intraday session** *(039 §0)* |

## **Ten capabilities. Average ≈ 1. Four are at Level 0.**

---

# PART 5 — ARCHITECTURAL PRINCIPLES REVIEW

| Principle | Held? | Violation |
|---|---|---|
| **Single source of truth** | 🟢 **YES — `instrument-registry.js`** | 🟢 **The one unambiguous win in 41 documents** |
| **Explicit ownership** | 🔴 **NO** | 82% of writes use variable paths |
| **Deterministic processing** | 🟢 **YES — VERIFIED byte-identical** *(037)* | 🟢 |
| 🔴 **Scientific reproducibility** | 🔴 **NO** | 🔴 **0 of 25 result files carry a gitSha, dataHash, or seed (§0.4)** |
| 🔴 **Unknown ≠ Zero** | 🔴 **NO** | 🔴 **119 `\|\| 0` sites. A fabricated IV of `0.14` at `gex-skew.js:49`** |
| 🔴 **Null ≠ 0** | 🔴 **NO** | 🔴 same |
| **Fail closed** | 🔴 **SPLIT** | 🟢 **Money fails CLOSED.** 🔴 **Evidence fails OPEN.** *(the programme's defining finding)* |
| 🔴 **Immutable historical evidence** | 🔴 **NO** | 🔴 **Results OVERWRITTEN** *(015)*. **A FIFO cap DELETES it** *(039)* |
| **Observable pipelines** | 🔴 **NO** | 🔴 **0 of 8 lifecycle events recorded. Deletions inside `catch (_) {}`** |
| **Versioned datasets** | 🔴 **NO** | 🔴 **Recovery window = ONE WRITE** *(039 §2)* |

## **10 principles. 3 held. And `Unknown ≠ Zero` — the principle stated in EVERY master prompt from 000-A to 040 — is violated 119 times.**

---

# PART 6 — CROSS-DOMAIN DEPENDENCY GRAPH (verified — SC-4 does not fire)

```
                        ┌──────────────────────────────────┐
                        │  🔴 safe-write.js  ← 28 MODULES  │  THE SINGLE POINT OF FAILURE
                        │     (and one of the best files)  │
                        └──────────────────────────────────┘
                                      ▲
        ┌────────────┬────────────────┼────────────────┬──────────────┐
     Market Data  Historical      Paper Trading     AI/Agents      Config
        │            │                │                │              │
        └────────────┴──────► 🔴 THE FEATURE-STORE BREAK ◄───────────┘
                                      │
                     ┌────────────────┴────────────────┐
                  Research                          Dashboard
                     │                                 │
                  🔴 0 gitSha                    🟢 works
                     │
                   Risk ──🔴── reads process.env, NOT the engine (013)
                     │
                 Execution ──🟢── all 7 placeOrder sites GUARDED (verified)
```

**CRITICAL DEPENDENCY CHAINS:**

| # | Chain | Risk |
|---|---|---|
| **1** | 🔴 **Everything → `safe-write.js` (28 modules)** | 🟢 **Mitigated: atomic + `.bak` + verified.** A genuine SPOF that happens to be well-built |
| **2** | 🔴 **Research → Feature Store → ✗ NOTHING** | 🔴 **The break. All downstream science stands on discarded data** |
| **3** | 🔴 **Risk → `process.env`, NOT the engine** | 🔴 **`/api/risk` reports `consecLosses: 0` while the engine holds `15`. THIS IS WHY EVERY OTHER DEFECT SURVIVED** |
| **4** | 🟡 `charges.js` ← 12 modules | 🔴 **assumes every position is LONG. ≈₹20,333 understated over 129 trades** |
| **5** | 🟢 `instrument-registry` ← 10 modules | 🟢 **fail-closed. Correct** |

---

# PART 7 — OPERATIONAL READINESS

| Capability | Ready? | Evidence |
|---|---|---|
| **Daily ingestion** | 🟡 **CONDITIONAL** | Works — 🔴 **but the bot is DOWN and has been since audit 021 (INC-001)** |
| 🔴 **Historical replay** | 🔴 **NO** | **1 of 8 event classes; no ticks** *(037)* |
| 🔴 **Research** | 🔴 **NO** | 🔴 **0 of 25 results reproducible.** And 002 proved the flagship result was a look-ahead artefact |
| 🔴 **AI experimentation** | 🔴 **NO** | 🔴 **No feature store. Trains on live state. 12 labelled outcomes, need ~200** |
| 🟢 **Paper trading** | 🟢 **YES — THE ONE READY SURFACE** | 🟢 Real forward evidence, honestly recorded |
| 🔴 **Disaster recovery** | 🔴 **NO** | 🔴 **No procedure. `INC-001` was a real SEV-1 and produced ZERO records** *(029)* |
| 🔴 **Scaling** | 🔴 **NO** | JSON files + `readdirSync`; `perf-report.js` has never been run live |

## **7 capabilities. ONE is ready — paper trading. Which is exactly what this platform actually is.**

---

# PART 8 — MINIMUM ENTERPRISE OBSERVABILITY MODEL

| Signal | Observable today? |
|---|---|
| Pipeline health · Data freshness · Validation results · Quality metrics · Replay status · Storage health · Backup status · Recovery status | 🔴 **0 of 8** |

> **`/api/ops/health` and `/healthz` exist and work. They report **engine enabled-flags**, not data health.
> Not one of the eight signals 040 requires is emitted. And the two deletions that matter most (039) happen
> inside empty `catch` blocks — they cannot fail loudly even in principle.**

---

# PART 9 — TARGET ENTERPRISE ARCHITECTURE (conceptual — no code)

```
  ┌─ MARKET DATA LAYER ────────────────────────────────────────────────────────┐
  │  🔴 ENFORCE the contract that already exists. conforms() at REGISTRATION,   │
  │     not on a JSON page. normalizeChain() ON INGEST.                  §0.2   │
  └────────────────────────────────────────────────────────────────────────────┘
  ┌─ DATA GOVERNANCE LAYER ★★★  — THE MISSING PRIMITIVE ───────────────────────┐
  │  DatasetRegistry: every dataset DECLARES owner · schema · retention ·       │
  │    backup policy · version. A write to an UNDECLARED dataset is REFUSED.    │
  │  🔴 This one primitive closes SC-1, SC-2, lineage (038) and lifecycle (039).│
  └────────────────────────────────────────────────────────────────────────────┘
  ┌─ STORAGE LAYER ───────────────────────────────────────────────────────────┐
  │  🟢 safe-write.js IS this layer. It is correct. GIVE IT THE REGISTRY,      │
  │     and 28 modules inherit governance for free.  ← the highest-leverage    │
  │     single change available in this entire programme.                      │
  └───────────────────────────────────────────────────────────────────────────┘
  ┌─ FEATURE PLATFORM ★★★ ─────────────────────────────────────────────────────┐
  │  🔴 PERSIST WHAT YOU COMPUTE. Today: computed → discarded. Every hour the   │
  │     platform runs without this, an hour of irreplaceable features is lost.  │
  └────────────────────────────────────────────────────────────────────────────┘
  ┌─ REPLAY · AI · RESEARCH · PAPER · AUDIT · ARCHIVE LAYERS ──────────────────┐
  │  Replay:   record all 8 event classes, not 1.                       (037)  │
  │  Research: EVERY result carries gitSha + dataHash + seed. 0 do.     (§0.4) │
  │  Audit:    the append-only .jsonl writer ALREADY EXISTS — point it here.   │
  │  Archive:  🔴 IRREPRODUCIBLE DATA IS ARCHIVED, NEVER DELETED BY A CAP.(039)│
  └───────────────────────────────────────────────────────────────────────────┘
```

## **The target architecture is not a rewrite. It is a REGISTRY placed under a storage layer that is already correct — plus persisting the features the platform already computes.**

---

# PART 10 — DATA GOVERNANCE COUNCIL (conceptual — one accountable owner per domain)

| Domain | Accountable owner (target) | Today |
|---|---|---|
| Market Data | `broker-connector` — **as a GATE, not a page** | 🔴 3 connectors, no gate |
| Historical Data | `bt-lib` — **and fix the lot key (032 §0)** | 🟡 contested |
| Feature Engineering | 🔴 **`feature-store` — DOES NOT EXIST** | 🔴 **NONE** |
| Research Data | `bt-validate` — **which nobody calls** | 🔴 **0 strategy callers** |
| AI Data | `confluence-learner` | 🟡 |
| Replay | 🔴 **DOES NOT EXIST** | 🔴 **NONE** |
| Metadata | 🔴 **`DatasetRegistry` — DOES NOT EXIST** | 🔴 **NONE** |
| Lifecycle | 🔴 **`RetentionRegistry` — DOES NOT EXIST** | 🔴 **two silent FIFO caps** |
| Compliance | 🔴 **DOES NOT EXIST** | 🔴 **NONE** |

## **9 council seats. 5 are empty because the domain does not exist. 2 are held by modules that are built, correct, and not called.**

---

# PART 11 — ENTERPRISE TESTING STRATEGY

**Scientific correctness has priority over throughput.**

| Test | Priority | Fails today? |
|---|---|---|
| 🔴 **Irreproducible data is never deleted by a cap** | **P0 — has a DEADLINE** *(039 §0)* | ✅ **FAILS — ~37 sessions** |
| 🔴 **Every result carries gitSha + dataHash + seed** | **P0 — SC-3** | ✅ **FAILS — 0 of 25** |
| 🔴 **Every write names a DECLARED dataset** | **P0 — SC-2** | ✅ **FAILS — 45 of 55 dynamic** |
| 🔴 **`conforms()` gates every connector registration** | **P0 — §0.2** | ✅ **FAILS — 0 call sites** |
| 🔴 **Unknown is never coerced to 0** | **P0 — the principle in every prompt** | ✅ **FAILS — 119 sites** |
| 🔴 **`/api/risk` reports the ENGINE's state** | **P0** | ✅ **FAILS — says 0, engine holds 15** |
| 🔴 **Replay reproduces all 8 event classes** | P1 | ✅ **FAILS — 1 of 8** |
| 🟢 **Determinism: identical input → identical bytes** | P1 | 🟢 **PASSES. Lock it in** |
| 🟢 **Every `.bak` parses** | P1 | 🟢 **PASSES (7/7). Lock it in** |

---

# PART 12 — ENTERPRISE DATA MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Isolated Files** | 🟢 **YES** | 51 JSON files, ownership inferred from filenames |
| **1 — Managed Data** | 🟡 **PARTIAL** | 🟢 `safe-write` (28 modules) + `instrument-registry` (fail-closed) are genuinely Level-2 work · 🔴 14% backup coverage; 0 of 9 critical |
| **2 — Integrated Data Platform** | 🔴 **NO** | 🔴 **The flow BREAKS at the feature store and never rejoins (Part 2)** |
| **3 — Governed Enterprise Platform** | 🔴 **NO** | 🔴 **7 of 9 governance responsibilities have NO owner** |
| **4 — Scientific Research Platform** | 🔴 **NO** | 🔴 **0 of 25 results reproducible. SC-3 FIRES** |
| **5 — Institutional Quantitative Infrastructure** | 🔴 **NO** | — |

## ## **ENTERPRISE DATA PLATFORM: LEVEL 0–1 — ISOLATED FILES, partially managed.**

**And 040's own warning — *"Never infer architectural maturity from code size or feature count alone"* —
is the correct warning for this repository. It has 81 root modules, 172 routes, 8 engines, 13 backtest
scripts and 20 dashboards. Its data platform is at Level 0–1.**

---

# PART 13 — FIVE-PHASE STRATEGIC ROADMAP

| Phase | Objectives | Dependencies | Risks | Exit criteria | Success metric |
|---|---|---|---|---|---|
| **1 — STABILIZE** | 🔴 **(a) Move `opt-candles/2026-07-08.json` out of the FIFO directory — TODAY.** (b) Restart the bot — **but only after the halt bug**, since a restart today resumes at **15 consecutive losses against a limit of 8, unhalted** (c) Fix `/api/risk` to read the engine | none — (a) is a **file copy** | 🔴 **(a) has a DEADLINE.** 🔒 (b)(c) touch **protected** files | **The only complete intraday session is safe. The bot's risk display tells the truth** | **0 irreplaceable datasets under a delete cap** |
| **2 — GOVERN** | 🔴 **`DatasetRegistry` under `safe-write.js`.** Every dataset declares owner · schema · retention · backup. **28 modules inherit governance for free** | Phase 1 | **Low — `safe-write` is already correct and already central** | **0 writes to an undeclared dataset** | **SC-1 and SC-2 stop firing** |
| **3 — INTEGRATE** | 🔴 **BUILD THE FEATURE STORE. Persist what is already computed.** 🔴 **Call `conforms()` and `normalizeChain()`** | Phase 2 | **Medium — the break is structural** | **The Part-2 flow is unbroken end to end** | **Features survive the tick that made them** |
| **4 — VALIDATE** | 🔴 **Every result carries `gitSha` + `dataHash` + `seed`.** 🔴 **Route the 8 event classes into the append-only writer that already exists.** 🔴 **Kill the 119 `\|\| 0` sites** | Phase 3 | Medium | **Any result re-runs to identical bytes** | **SC-3 stops firing. Replay ≥ 8 of 8** |
| **5 — SCALE** | Archive tier. Off-machine backups. Postgres/Parquet when JSON stops holding | Phase 4 | Low | **Level 3** | — |

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every dataset has one owner | 🔴 **NO — 6 domains ownerless, 4 contested** |
| Every transformation is traceable | 🔴 **NO — 82% of writes don't name their file** |
| Every consumer has a documented contract | 🔴 **NO — the contract layer EXISTS and is never called** |
| Every dataset is versioned | 🔴 **NO — recovery window = ONE write** |
| **Replay is reproducible** | 🟡 **DETERMINISM VERIFIED (byte-identical) — but only 1 of 8 event classes** |
| Historical evidence is immutable | 🔴 **NO — results overwritten; a FIFO cap will DELETE the only complete session** |
| Unknown values are never silently fabricated | 🔴 **NO — 119 sites; a fabricated IV of 0.14** |
| **Data quality is measurable** | 🟢 **YES — 033 measured it: 0% missing across 98,410 rows** |
| Governance is auditable | 🟢 **YES — as of this document. 41 of them** |
| Scientific reproducibility is demonstrable | 🔴 **NO — 0 of 25 results** |

## **2 of 10.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent enterprise data architect trace any dataset from origin to consumer,
verify governance, reproduce research, and assess readiness — from documented evidence alone?**

## **After forty-one documents: yes. And the answer they would reach is that this is not an enterprise data platform. It is an excellent market-data collector bolted to a research process that cannot remember what it saw.**

**Three of 040's four stop conditions fire.**

> **SC-1 — six of fifteen data domains have no owner. Not because ownership is unclear, but because the
> domain does not exist: no ticks, no replay, no feature store, no audit trail, no archive, no persisted
> logs. `Unknown ≠ Zero`, so I report them as ABSENT, not "immature."**
>
> **SC-3 — zero of twenty-five result files carry a git SHA, a data hash, or a seed. Not one research
> result this platform has ever produced can be reproduced. This is the same disease audit 002 diagnosed
> when the flagship 91.5% win-rate turned out to be a look-ahead artefact reading the day's own close.**
>
> **SC-2 — and this is the finding of the document:**
>
> ## 🔴 **THE PLATFORM HAS A DATA-CONTRACT LAYER. IT IS CORRECT. IT IS UNIT-TESTED. IT IS WIRED INTO THE SERVER. AND IT IS USED TO RENDER A READ-ONLY JSON PAGE.**
>
> **`broker-connector.js` provides `conforms()` — described in its own header as a "safe-swap gate" — and
> `normalizeChain()`, "one canonical output shape." Production call sites: `conforms()` = **0**.
> `normalizeChain()` = **0**. `normalizePrice()` = **0**. The only thing `server.js` does with the module
> is instantiate a registry and print what the contract *would* be at `GET /api/brokers`.**
>
> **That makes it the ELEVENTH component in this programme that is BUILT, CORRECT, AND NOT USED — after
> `engine-verdict`, `module-contract`, `bt-validate`, `position-sizer`, `auth`, the append-only writer,
> `perf-report`, PM2, Docker Compose, and the ops playbook's own golden rule.**
>
> ## **This platform's defining pathology is not that it lacks good engineering. It is that it keeps building good engineering and then not calling it.**

**The one stop condition that does NOT fire tells us where to act:**

> **The dependency graph resolves cleanly — 81 modules, 137 edges. And it names a single point of failure:
> **`safe-write.js`, depended on by 28 modules.** Every durable write in the system passes through it.**
>
> **And `safe-write.js` is one of the best files in the repository: atomic temp-and-rename, a `.bak` on
> every write, corrupt-file restore, and seven backups that were verified to parse with zero corruption.**
>
> ## **The platform's most load-bearing component is also one of its most correct. That is the leverage. A `DatasetRegistry` placed underneath `safe-write.js` — every dataset declaring its owner, schema, retention and backup policy — would close SC-1, SC-2, the lineage failure of 038 and the lifecycle failure of 039, and twenty-eight modules would inherit governance without changing a line.**

**The flow, in one sentence:**

> **Everything upstream of the feature store is sound. Everything downstream is built on data that was
> thrown away. The platform computes thirteen indicators, gamma exposure, skew and meta-labels on every
> tick — and discards all of it. It can see the market. It cannot remember what it saw.**

**And one action still has a deadline, and still costs nothing:**

> ## **`data/opt-candles/2026-07-08.json` — the only complete intraday option-chain session this platform has ever captured — sits in a directory with a silent FIFO cap of 40. In roughly thirty-seven trading sessions it will be deleted, inside an empty `catch`, with no backup, forever.**
>
> **Copy it out. It is one file.**

**Maturity: LEVEL 0–1. Ready for exactly one thing — paper trading — which is exactly what this platform is.**

---

**Application logic redesigned: NONE. Infrastructure implemented: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Domain Map (Part 1) · End-to-End Flow (Part 2) · Governance Model (Part 3) · Capability
Assessment (Part 4) · Principles Review (Part 5) · Dependency Graph (§0.3, Part 6) · Operational Readiness
(Part 7) · Observability (Part 8) · Target Architecture (Part 9) · Governance Council (Part 10) · Testing
Strategy (Part 11) · Maturity Assessment (Part 12) · Five-Phase Roadmap (Part 13) · Executive Summary.

**Stop conditions: SC-1 FIRES · SC-2 FIRES · SC-3 FIRES · SC-4 does not.**
