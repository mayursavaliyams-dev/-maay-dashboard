# 038 — DATA CATALOG, METADATA, LINEAGE & DISCOVERABILITY

**Standard:** Master Prompt 038 · **Depends on:** 000-A … 037
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No dataset reorganized. No file or schema renamed.**

---

# SECTION 0 — I TRIED TO BUILD THE LINEAGE GRAPH. IT CANNOT BE BUILT.

**038's stop condition: *"Stop and report UNKNOWN if lineage cannot be reconstructed."***
**038's rule: *"Never assume lineage because files appear to share names or locations."***

## **So I did not assume. I wrote a static analyser and pointed it at all 51 datasets.**

## §0.1 — The result, and it is absurd

```
  51 datasets
  51 with NO IDENTIFIABLE WRITER      ← implausible on its face
  28 with NO READER
   0 with MULTIPLE WRITERS
```

**A tool that reports that **zero of fifty-one** files have a writer is not reporting a fact about the
platform. It is reporting a fact about itself.**

## §0.2 — 🔴 **WHY: not one write site names the file it writes**

**Measured — the first argument to every persistence call in the codebase:**

```js
  afternoon-engine.js:747   writeJsonSync(file, ...)                ← a computed local
  agents-engine.js:327      writeJsonSync(this._tradesFile, ...)    ← an instance field
  ai-logger.js:37           writeJsonSync(FILE, ...)                ← a module constant
  confirmed-signals.js:56   writeJsonSync(f, o, ...)                ← a function parameter
  execution-engine.js:181   writeJsonSync(file, ...)                ← `./data/equity-${inst}.json`
  server.js:3688            writeJsonSync(CONFIG_OVERRIDE_PATH, ...)← a module constant
```

> ## **A LITERAL FILENAME ALMOST NEVER APPEARS AT A WRITE SITE. The path is always one indirection away.**
>
> **This is not a limitation of my tool. It is a property of the codebase.**
>
> **The lineage of this platform's data can only be discovered by EXECUTING it and observing what it
> writes — which is precisely what a lineage engine does, and none exists.**

## ## 🔴 **LINEAGE: CANNOT BE RECONSTRUCTED BY STATIC ANALYSIS. → UNKNOWN.**

---

## §0.3 — 🔴 **AND THE MANUAL TRACE FOUND WHAT THE TOOL WAS BLIND TO**

**My automated graph reported: `0 datasets with multiple writers`.**
**A hand-trace of four critical files found a contested one immediately:**

```
  data/signal-outcomes.json     ← TWO claimants

    server.js:5830        const _SIG_HEALTH_PATH = path.join(__dirname, 'data', 'signal-outcomes.json');
    signal-health.js:11   "…Persists to data/signal-outcomes.json."
```

> **Two modules both persist the same file. My static tool saw neither, and confidently reported zero
> contested datasets.**
>
> **This is exactly the failure 038 warns about, and it happened to the auditor's own instrument.**

---

## §0.4 — 🔴 **THE COST, AND IT ALREADY HAPPENED: `025 §0.2` EXPLAINED**

**Audit 025 found an orphaned backup: `data/confirmed-signals.json.bak` exists; the live file does not.
A dataset vanished and nothing noticed.**

**038 explains why:**

```
  confirmed-signals.js:20   const FILE = path.join(__dirname, 'data', 'confirmed-signals.json');
```

> ## **The ONLY evidence that `confirmed-signals.js` owns `confirmed-signals.json` is that THE NAMES MATCH.**
>
> **There is no declaration. No manifest. No registry entry. No `@owns` annotation. Nothing anywhere
> states that this module is responsible for that file.**
>
> **038's rule, verbatim: *"Never assume lineage because files appear to share names or locations."***
>
> ## **THE ENTIRE DATA OWNERSHIP MODEL OF THIS PLATFORM IS INFERRED FROM FILENAMES.**
>
> **And when a file disappeared, nothing could detect it — because nothing had ever declared that it was
> supposed to exist.**

**And I made the same error myself:** in audits 006, 025 and 031 I wrote that the option High/Low archive
lives in `data/opt-hl/`. **It lives in `data/opthl/`.** I inferred the location from a name, and the name
was wrong. *(Corrected in 034 §2.)*

---

# PART 1 — DATA CATALOG

**51 JSON datasets in `data/`, plus historical archives. Not one has a catalog entry. This table is the
first catalog this platform has ever had.**

| # | Asset | Owner *(inferred — see §0.4)* | Consumers | Location | Validated | Confidence |
|---|---|---|---|---|---|---|
| 1 | 🟢 **Bhavcopy — 600 CSV** | `bt-bhav-fetch.js` | `bt-lib` → 8 scripts | `bt-data/bhav/` | 🟢 **031, 033, 036** | **HIGH** |
| 2 | 🔴 **`equity-<inst>.json`** — capital, reserve, consecLosses | `execution-engine:181` | `restoreEquity`, the risk brake | `data/` | 🟢 `safe-write` · 🔴 **NO `.bak`** *(025 §0.3)* | HIGH |
| 3 | 🔴 **`config-overrides.json`** — **the REAL config** | 🔴 **3 writers** (`server.js:3581, 3688, 3773`) | every engine at boot | `data/` | 🔴 **1 raw writer** | HIGH |
| 4 | 🔴 **`signal-outcomes.json`** | 🔴 **CONTESTED — `server.js:5830` AND `signal-health.js`** *(§0.3)* | calibration *(019)* | `data/` | 🔴 | HIGH |
| 5 | **`confluence-weights.json`** — **the live AI model** | `confluence-learner.js:28` | scoring | `data/` | 🟢 `.bak` | HIGH |
| 6 | 🔴 **`confirmed-signals.json`** | `confirmed-signals.js:20` *(inferred)* | — | 🔴 **THE FILE IS GONE. Only the `.bak` remains** | 🔴 **§0.4** | HIGH |
| 7 | **`strangle-trades.json`** — the ₹7L engine's ledger | `strangle-engine.js` | reports | `data/` | 🔴 no `.bak` | HIGH |
| 8 | **`ami-signals-all.json`** — 233 KB | `consolidate-ami-signals.js` | bridge | `data/` | 🔴 **RAW write, no `.bak`** | HIGH |
| 9 | **`opt-candles/`** — 5 sessions | `server.js:566` | strike chart | `data/` | 🔴 **8–30% on 4 of 5** *(034)* | HIGH |
| 10 | **`opthl/`** — 12 files ⚠️ **NOT `opt-hl`** | `server.js:518` | strike history | `data/` | 🔴 raw | HIGH |
| 11 | 🔴 **`vrp-monitor.json`** | `server.js` | — | `data/` | 🔴 **ZERO entries. Never recorded anything** | HIGH |
| 12 | **`eod-*.json`** × 19 | `server.js:4255` | reports | `data/` | 🔴 **RAW, no `.bak`, no retention** | HIGH |
| 13 | **`bt-data/result-*.json`** × 15 | 13 `bt-*` scripts | humans | `bt-data/` | 🔴 **0 carry a `gitSha`. 1 is INVALIDATED and unmarked** *(015 §0)* | HIGH |
| 14 | 🔴 **Features** | — | — | — | 🔴 **DISCARDED ON EVERY INFERENCE** *(018, 035)* | HIGH |
| 15 | 🔴 **Tick data** | — | — | — | 🔴 **DOES NOT EXIST. UNOBSERVABLE** *(037)* | HIGH |
| 16 | 🔴 **Logs** | — | — | — | 🔴 **`console.log` → a buffer that died with the process** *(021)* | HIGH |
| 17 | 🔴 **Risk data** | — | — | — | 🔴 **The halt is in no schema** *(005)* | HIGH |

## **Seventeen asset classes. Two are validated. Five do not exist. ZERO have a declared owner.**

---

# PART 2 — METADATA MODEL

| Required metadata field | Captured? |
|---|---|
| **Dataset name** | 🟡 **The filename. That is the entire metadata model** |
| **Description** | 🔴 **NO** |
| **Version** | 🔴 **NO — no schema version in any file** |
| **Schema** | 🔴 **NO — 34 columns are assumed, never declared** |
| **Source** | 🔴 **NO** |
| **Collection timestamp** | 🟡 File mtime |
| **Effective market timestamp** | 🟢 **YES — `TradDt` in the bhavcopy** |
| **Validation status** | 🔴 **NO — audits 031/033 were the first validation ever performed** |
| **Retention policy** | 🔴 **NO — 19 EOD files accumulate forever** |
| **Access policy** | 🔴 **NO — 0 of 172 routes are authenticated** *(023)* |

## ## **1.5 of 10. THE METADATA MODEL IS THE FILENAME.**

---

# PART 3 — DATA LINEAGE

```
  Source ──▶ Collection ──▶ Validation ──▶ Transformation ──▶ Storage ──▶ Features ──▶ Research ──▶ AI ──▶ Risk ──▶ Trading ──▶ Reports
     ↓           ↓              ↓                ↓               ↓            ↓            ↓          ↓       ↓
     │           │              │                │               │            │            │          │       └── 🔴 Risk: no data
     │           │              │                │               │            │            │          └── 🔴 AI: inputs DISCARDED
     │           │              │                │               │            │            └── 🔴 no result cites its data
     │           │              │                │               │            └── 🔴 NO FEATURE STORE (035)
     │           │              │                │               └── 🔴 THE PATH IS COMPUTED. Lineage is
     │           │              │                │                   NOT STATICALLY DISCOVERABLE. (§0.2)
     │           │              │                └── 🔴 the LOT is read from an arbitrary row (032)
     │           │              └── 🟢 ONE rule: `o > 0` (bt-lib:40)
     │           └── 🔴 a failed download is indistinguishable from a holiday (031)
     └── 🟢 NSE UDiFF — the highest provenance available.
```

## 🔴 **The lineage is UNKNOWN at every stage after Storage — because the graph cannot be built (§0).**

---

# PART 4 — OWNERSHIP GOVERNANCE

| Asset class | Owner |
|---|---|
| **Raw datasets** | 🟡 `bt-bhav-fetch` *(inferred from a name)* |
| **Derived datasets** | 🔴 **NONE DECLARED** |
| **Features** | 🔴 **ZERO features have an owner** *(035)* |
| **Research artifacts** | 🔴 **NONE — 0 of 13 results record a `gitSha`** |
| **AI datasets** | 🟡 `confluence-learner` *(inferred)* |
| **Reports** | 🔴 **NONE** |
| **Archives** | 🔴 **NONE — and deletion has no owner at all** *(025 §0.2)* |

### Contested ownership — **found by hand, missed by the tool**
🔴 **`signal-outcomes.json` — `server.js:5830` AND `signal-health.js`** *(§0.3)*
🔴 **`config-overrides.json` — 3 writers**

### Hidden ownership
🔴 **ALL OF IT. Every ownership claim in this platform is an inference from a filename** *(§0.4)*.

## ## **038's stop condition: *"Stop and report UNKNOWN if dataset ownership cannot be established."***
## ## **→ OWNERSHIP: INFERRED, NEVER DECLARED. UNKNOWN.**

---

# PART 5 — DISCOVERABILITY

| Can a user determine…? | Answer |
|---|---|
| **What datasets exist?** | 🟡 **`ls data/`. That is the discovery portal** |
| **Where they are stored?** | 🟡 — 🔴 **and I got it WRONG myself: `opt-hl` vs `opthl` (§0.4)** |
| **Who owns them?** | 🔴 **NO — inferred from names** |
| **Which systems consume them?** | 🔴 **NO — the graph cannot be built (§0)** |
| **Which reports depend on them?** | 🔴 **NO** |
| **Which models use them?** | 🔴 **NO — the AI's inputs are discarded** |

## **1 of 6. The discovery portal is `ls`.**

---

# PART 6 — IMPACT ANALYSIS

**"If I change dataset X, what breaks?"**

| Dependency class | Discoverable? |
|---|---|
| Dependent features | 🔴 **NO** |
| Dependent AI models | 🔴 **NO** |
| Dependent research | 🔴 **NO — no result names its data** |
| Dependent reports | 🔴 **NO** |
| Dependent dashboards | 🔴 **NO — 19 HTML pages, no mapping** |
| Dependent strategies | 🔴 **NO** |

## 🔴 **IMPACT ANALYSIS IS IMPOSSIBLE. And the platform has already paid for it.**

> **When `bt-lib.js` was changed in audit 002 — the ONLY production change this programme made — nothing
> could tell me which of the 13 backtest scripts, 15 result files, or downstream claims were affected.**
>
> **I had to trace it by hand. And I still got it wrong: 032 §0 found that the lot fix was
> misaligned on 27 of 600 days, and it took thirty audits to surface.**
>
> ## **A lineage graph would have shown, in one query, that `bt-lib.loadDay()` feeds every strategy and that column 28 was never mapped into `opts[]`.**

---

# PART 7 — OBSERVABILITY

| Required per metadata update | Recorded? |
|---|---|
| Timestamp · Dataset · Previous version · New version · Owner · Reason · Validation | 🔴 **NONE OF THEM** |

## **0 of 7. There is no metadata, therefore no metadata history.**

---

# PART 8 — FAILURE MODE REGISTER

| ID | Failure | Present? | Impact |
|---|---|---|---|
| **DC-1** | 🔴 **Lineage cannot be statically reconstructed — every path is computed** | 🔴 **CONFIRMED (§0.2)** | 🔴 **CRITICAL. Impact analysis is impossible** |
| **DC-2** | 🔴 **Ownership is inferred from filenames** | 🔴 **CONFIRMED (§0.4)** | 🔴 **CRITICAL — and 038 explicitly forbids this inference** |
| **DC-3** | 🔴 **A dataset vanished and nothing detected it** | 🔴 **CONFIRMED — `confirmed-signals.json`** *(025 §0.2)* | 🔴 **CRITICAL** |
| **DC-4** | 🔴 **Contested ownership, invisible to tooling** | 🔴 **CONFIRMED — `signal-outcomes.json` (§0.3)** | 🔴 **HIGH** |
| **DC-5** | 🔴 **Zero metadata** | 🔴 **CONFIRMED — 1.5 of 10 fields** | 🔴 **CRITICAL** |
| **DC-6** | 🔴 **Broken lineage: no result names its dataset** | 🔴 **CONFIRMED — 0 of 13 `gitSha`** | 🔴 **CRITICAL** |
| **DC-7** | 🔴 **Stale catalog** | ⚪ **N/A — there is no catalog to be stale** | — |
| **DC-8** | 🔴 **Incorrect lineage from name-matching** | 🔴 **CONFIRMED — I did it myself: `opt-hl` vs `opthl`** | HIGH |
| 🟢 **DC-9** | **Duplicate datasets** | 🟢 **NOT FOUND** | 🟢 |

---

# PART 9 & 10 — DATA CATALOG ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   DatasetRegistry  ★★★   THE PRIMITIVE §0 PROVES IS MISSING.
     Every dataset DECLARES itself, in code, at its owner:
       datasetId · path · owner(module) · schema · version · retention · consumers[]
     🔴 A WRITE TO AN UNDECLARED PATH IS A FAILURE, NOT A FILE.
     🔴 THIS MAKES LINEAGE STATIC. TODAY IT IS ONLY DISCOVERABLE BY EXECUTION. → DC-1, DC-2

   LineageEngine  ★
     Build the graph FROM THE DECLARATIONS, not from a grep.
     🔴 "If I change bt-lib.loadDay(), what breaks?" → ONE QUERY.
        In audit 002 that question took a hand-trace, and the answer was still wrong (032 §0).

   IntegrityChecker  ★  (also 025's recommendation, arriving from a second direction)
     🔴 EVERY DECLARED DATASET EXISTS.  → would have caught `confirmed-signals.json`  → DC-3
     🔴 EVERY BACKUP HAS A LIVE FILE.
     🔴 EVERY DATASET HAS EXACTLY ONE DECLARED WRITER. → would have caught §0.3    → DC-4

   MetadataRegistry  ★  schema · version · source · validationStatus · retention · access.
                        🔴 Today the metadata model IS THE FILENAME.

   DiscoveryPortal   🔴 Today it is `ls data/`.
```

## The rule §0 establishes

> **A filename is not a declaration. It is a coincidence that has, so far, been true.**
>
> **This platform's entire data-ownership model rests on that coincidence — and audits 025 and 034 each
> found a place where it had already broken.**

---

# PART 11 — TESTING STRATEGY

| Test | Priority | Would it fail today? |
|---|---|---|
| 🔴 **Every dataset is DECLARED by exactly one module** | **P0 — DC-2, DC-4** | ✅ **FAILS — zero are declared** |
| 🔴 **Every declared dataset EXISTS** | **P0 — DC-3** | ✅ **FAILS — `confirmed-signals.json` is gone** |
| 🔴 **Every backup has a live file** | **P0 — 025 §0.2** | ✅ **FAILS — 1 orphan** |
| 🔴 **A write to an undeclared path FAILS** | **P0 — DC-1** | ✅ **FAILS — every path is computed** |
| 🔴 **Every result records its `datasetHash` and `gitSha`** | **P0 — DC-6** | ✅ **FAILS — 0 of 13** |
| **Lineage query: "what consumes `bt-lib.loadDay()`?"** returns a complete list | P1 | ✅ **FAILS — impossible** |

**Five P0 tests. All five fail.**

---

# PART 12 — CATALOG MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — File Listings** | 🟢 | **`ls data/` IS the catalog. This is precisely the level** |
| **1 — Basic Inventory** | 🔴 **NO** | 🟢 *This document is the first inventory* · 🔴 **nothing in the platform maintains one** |
| **2 — Managed Metadata** | 🔴 **NO** | **1.5 of 10 metadata fields. The model is the filename** |
| **3 — Governed Catalog** | 🔴 **NO** | **Ownership is inferred, never declared** |
| **4 — Enterprise Lineage** | 🔴 **NO** | **The lineage graph CANNOT BE BUILT (§0)** |
| **5 — Institutional Knowledge Graph** | 🔴 **NO** | — |

## ## **Data Catalog Platform: LEVEL 0 — FILE LISTINGS.**

**This is the lowest maturity score of any domain in forty audits — and it is accurate. The catalog is
`ls`.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE — Part 1 is the platform's first catalog.** **§0 proved the lineage graph cannot be built** | — | none | 17 asset classes · 0 declared owners |
| **2 — Metadata governance** | 🔴 **EVERY DATASET DECLARES ITSELF AT ITS OWNER:** `datasetId · path · owner · schema · retention` | none | **Low — purely additive** | 🔴 **Ownership stops being an inference from a filename** |
| **3 — Lineage** | 🔴 **Build the graph FROM THE DECLARATIONS.** A write to an undeclared path fails the build | Phase 2 | Low | 🔴 **"What breaks if I change X?" becomes ONE QUERY** |
| **4 — Dependency governance** | 🔴 **An `IntegrityChecker` on a schedule:** every declared dataset exists · every backup has a live file · every dataset has ONE writer | Phase 3 | **Zero — read-only** | 🔴 **`confirmed-signals.json` becomes impossible** |
| **5 — Enterprise catalog** | `datasetHash` + `gitSha` on every result *(008, 015)*. A discovery portal | Phase 4 | Low | **Every artefact names the data that produced it** |

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every dataset has a unique identity | 🔴 **NO — the identity IS the filename** |
| **Ownership is explicit** | 🔴 **NO — it is INFERRED, and 038 forbids that** |
| Metadata is complete | 🔴 **NO — 1.5 of 10 fields** |
| **Lineage is traceable** | 🔴 **NO — §0: the graph CANNOT BE BUILT** |
| Dependencies are discoverable | 🔴 **NO — impact analysis is impossible** |
| Catalog updates are versioned | 🔴 **NO — there is no catalog** |
| **Unknown relationships are never fabricated** | 🟡 **This document fabricates none — it reports them as UNKNOWN. But the PLATFORM fabricates them constantly, by inferring ownership from names** |

## **0 of 7.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent data architect locate any dataset, identify its owner, trace its
lineage from source to consumer, and assess the impact of any change?**

## **No. And I proved it by trying — with a tool, and then by hand.**

**038 forbids assuming lineage from filenames. So I wrote a static analyser and pointed it at all
fifty-one datasets. It reported that **fifty-one of fifty-one have no writer** — a result so absurd that
it says nothing about the platform and everything about the attempt.**

> ## **THE REASON: NOT ONE WRITE SITE IN THIS CODEBASE NAMES THE FILE IT WRITES.**
>
> ```js
>   writeJsonSync(file, …)                ← a computed local
>   writeJsonSync(this._tradesFile, …)    ← an instance field
>   writeJsonSync(FILE, …)                ← a module constant
>   writeJsonSync(f, o, …)                ← a function parameter
>   writeJsonSync(CONFIG_OVERRIDE_PATH, …)← a module constant
> ```
>
> **The path is always one indirection away from the write. This is not a limitation of my tool — it is
> a property of the codebase.**
>
> ## **The lineage of this platform's data is discoverable ONLY BY EXECUTING IT. That is what a lineage engine does, and none exists.**
>
> **038's stop condition applies exactly: LINEAGE — CANNOT BE RECONSTRUCTED. UNKNOWN.**

**And the hand-trace found what the tool was blind to:**

> **My analyser reported `0 datasets with multiple writers`. Four manual traces later, I found
> `signal-outcomes.json` claimed by **both** `server.js:5830` and `signal-health.js`.**
>
> **The tool saw neither, and reported zero contested datasets with complete confidence.**

**And the cost is not hypothetical. It has already been paid, twice:**

> **Audit 025 found an orphaned backup — `confirmed-signals.json.bak` exists, and the live file does
> not. A dataset vanished, and nothing noticed.**
>
> **038 explains why. The only evidence that `confirmed-signals.js` owns `confirmed-signals.json` is
> that **the names match**. There is no declaration, no manifest, no registry entry, no annotation.
> Nothing anywhere states that the file was supposed to exist.**
>
> ## **THE ENTIRE DATA-OWNERSHIP MODEL OF THIS PLATFORM IS AN INFERENCE FROM FILENAMES — and 038's central rule is that this inference is never permitted.**
>
> **I made the same error myself. In audits 006, 025 and 031 I wrote that the option High/Low archive
> lives in `data/opt-hl/`. It lives in `data/opthl/`. I inferred a location from a name, and the name
> was wrong.**

**And the deepest cost, which explains an earlier failure of this very audit programme:**

> **When `bt-lib.js` was changed in audit 002 — the ONLY production change made across forty documents —
> nothing could tell me which of the thirteen backtest scripts, fifteen result files, or downstream
> claims were affected. I traced it by hand. **And I still got it wrong**: audit 032 §0 found that the
> lot fix was misaligned on 27 of 600 days, and it took thirty more audits to surface.**
>
> ## **A lineage graph would have answered, in one query, that `bt-lib.loadDay()` feeds every strategy and that column 28 was never mapped into `opts[]`.**

**The single highest-value change, and it is purely additive:**

> ## **MAKE EVERY DATASET DECLARE ITSELF, IN CODE, AT ITS OWNER.**
>
> **`datasetId · path · owner · schema · retention · consumers`.**
>
> **A write to an undeclared path becomes a failure, not a file. Ownership stops being a coincidence of
> naming. And the question *"what breaks if I change this?"* — which has already been answered wrongly
> once, at real cost — becomes a query instead of a guess.**

---

**Datasets reorganized: NONE. Files or schemas renamed: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Dataset Catalog (Part 1) · Metadata Model (Part 2) · **Lineage (§0, Part 3)** ·
Ownership Matrix (Part 4) · Discoverability (Part 5) · Impact Analysis (Part 6) · Observability
(Part 7) · Failure Modes (Part 8) · Catalog Architecture (Parts 9–10) · Testing Strategy (Part 11) ·
Maturity Assessment (Part 12) · Migration Roadmap (Part 13) · Executive Summary.
