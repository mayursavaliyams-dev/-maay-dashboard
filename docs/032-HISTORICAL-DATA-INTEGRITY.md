# 032 — HISTORICAL DATA, TIME-SERIES GOVERNANCE & SCIENTIFIC DATA INTEGRITY

**Standard:** Master Prompt 032 · **Depends on:** 000-A … 031
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No storage redesigned. No dataset modified.**

**032's stop condition: *"Never assume historical correctness because the dataset appears internally
consistent."***

## **This audit applied that rule to the one change this entire programme actually made — and the change is defective.**

---

# ═══════════════════════════════════════════════════════════
# SECTION 0 — 🔴 THE AUDITOR'S OWN FIX IS WRONG. MEASURED.
# ═══════════════════════════════════════════════════════════

**In audit 002, I fixed `bt-lib.js` to read the "real per-day lot" from the bhavcopy instead of the
hardcoded `LOT = 75`. I called it a fix. It is not correct.**

## §0.1 — What the data actually says

**A single bhavcopy file contains MULTIPLE lot sizes at the same time:**

```
  nifty-20241203.csv    1,352 rows @ lot 25    +    338 rows @ lot 75
  nifty-20251029.csv      142 rows @ lot 65    +  1,424 rows @ lot 75
```

**And when grouped by expiry, the reason is unambiguous:**

```
  nifty-20241203.csv  (trade date 2024-12-03)
    expiry 2024-12-05  →  lot 25          ← the NEAREST expiry. The one the strategy trades.
    expiry 2024-12-12  →  lot 25
    expiry 2024-12-19  →  lot 25
    expiry 2025-01-02  →  lot 75          ← a NEWER contract, issued after a lot revision
    expiry 2025-02-27  →  lot 75
    ...
```

> ## 🔴 **THE LOT IS A PROPERTY OF THE CONTRACT (its expiry), NOT OF THE DAY.**
>
> **When NSE revises a lot size, **existing contracts keep the old lot until they expire**; only **newly
> issued contracts** carry the new one. A single trading day therefore legitimately carries **both**
> lots — and which one applies depends entirely on **which expiry you are trading**.**
>
> **This is a real market-structure fact. It is in the data. And nothing in this repository models it.**

## §0.2 — What my fix actually does

```js
bt-lib.js:36   const rawLot = +rows[0][28];                    // ◀── ROW ZERO. AN ARBITRARY ROW.
bt-lib.js:37   const lot = Number.isFinite(rawLot) && rawLot > 0 ? rawLot : null;
bt-lib.js:39   const opts = rows.map(r => ({ xpry: r[9], strike: +r[11], type: r[12],
                                             o: +r[14], h: +r[15], l: +r[16], c: +r[17], oi: +r[22] }))
               //                          ◀── COLUMN 28 (the lot) IS NOT MAPPED INTO opts[] AT ALL.
```

**`rows[0]` is whichever contract happens to sort first in that day's file. Its lot has no necessary
relationship to the contract the strategy trades (`day.nearExp`).**

**And `bt-validate.js` — the harness I fixed in 002 — sizes *every leg* with that arbitrary lot.**

## §0.3 — The impact, measured across all 600 days

```
  days checked                                     : 600
  ─────────────────────────────────────────────────────────
  days where MY FIX reads the wrong lot            :  27   ( 4.5%)
  days where the OLD hardcoded LOT=75 was wrong    : 355   (59.2%)
```

**Examples where my fix reads the wrong lot:**

```
  2024-12-03   row[0] = 75   but nearExp 2024-12-05 → lot 25
  2024-12-06   row[0] = 75   but nearExp 2024-12-12 → lot 25
  2024-12-19   row[0] = 75   but nearExp 2024-12-19 → lot 25
  2024-12-23   row[0] = 75   but nearExp 2024-12-26 → lot 25
```

## §0.4 — The honest verdict

| | |
|---|---|
| **Is my fix an improvement?** | 🟢 **YES — enormously. Wrong on 59.2% of days → wrong on 4.5%. A 13× reduction** |
| **Is my fix correct?** | 🔴 **NO. It is wrong on 27 of 600 days, and it is wrong for a structural reason I did not understand when I wrote it** |
| **Did I claim it was correct?** | 🔴 **YES.** `docs/002-STABILIZATION-REPORT.md` says: *"the real per-day lot, straight from the data."* **There is no such thing as a per-DAY lot. There is only a per-CONTRACT lot** |
| **Does it change the 002 conclusion?** | 🟡 **UNKNOWN, and it must be re-run.** The look-ahead removal is by far the dominant effect (win 91.5% → 51.2%). But the sizing is demonstrably wrong on 27 days, and **no result in this repository can be trusted until it is re-derived with the correct lot** |
| **The correct fix** | **Map column 28 into `opts[]` (`bt-lib.js:39`), and size each leg with the lot ON THAT LEG'S ROW.** The lot belongs to the contract, not the day |

> ## **This is the ninth time this audit programme has caught its own author — and the first time on the ONE change actually applied to production code.**
>
> **The 002 fix was characterization-tested, proven red first, reviewed, documented, and celebrated. It
> passed 48 test suites. And it encodes a market-structure assumption — *"a day has a lot"* — that the
> data itself refutes.**
>
> **032's stop condition exists precisely for this: *"Never assume historical correctness because the
> dataset appears internally consistent."* The dataset is internally consistent. My reading of it was
> not.**

---

# PART 1 — HISTORICAL DATASET INVENTORY

| Dataset | Source | Range | Granularity | Owner | Validation | Confidence |
|---|---|---|---|---|---|---|
| **Daily bhavcopy** | 🟢 NSE UDiFF | 2024-01-08 → 2026-06-17 (**600 files**) | daily, per-strike | `bt-lib.js` | 🟢 **VERIFIED (031 §0)** — 0 dupes, 0 empty, stable 34-col schema | **HIGH** |
| 🔴 **Option chain history** | — | — | — | — | 🔴 **DOES NOT EXIST** | HIGH |
| 🔴 **Intraday data** | live | **1 SESSION** (2026-07-08, 375 min) | 1-min | `server.js` | 🔴 **NOT re-derivable** | **HIGH** |
| **Option High/Low archive** | live | date-wise | daily | `server.js` | 🔴 none | MEDIUM |
| **Candle data** | Upstox | partial | 1-min | `bt-fetch-1min.js` | 🔴 none | MEDIUM |
| 🔴 **Derived features** | — | — | — | — | 🔴 **DISCARDED ON EVERY INFERENCE** *(018)* | **HIGH** |
| **Research snapshots** | `bt-data/result-*.json` | 15 files | per-run | 🔴 **nobody** | 🔴 **0 carry a `gitSha`; 1 is invalidated and unmarked** *(015)* | HIGH |
| **Validation datasets** | — | — | — | — | 🔴 **NO train/test split exists** *(018)* | HIGH |
| 🔴 **Replay datasets** | — | — | — | — | 🔴 **DO NOT EXIST — no event history** *(022)* | HIGH |

## **Nine dataset classes. One is verified. Four do not exist.**

---

# PART 2 — TIME-SERIES LIFECYCLE

```
  Collection ──▶ Validation ──▶ Normalization ──▶ Versioning ──▶ Storage ──▶ Consumption ──▶ Research ──▶ Archival
      ↓              ↓               ↓                ↓             ↓            ↓              ↓
      │              │               │                │             │            │              └── 🔴 0 gitSha
      │              │               │                │             │            └── 🔴 §0: THE LOT IS READ
      │              │               │                │             │                FROM AN ARBITRARY ROW.
      │              │               │                │             └── 🟢 600 CSV, immutable
      │              │               │                └── 🔴 NO VERSION. No dataset hash. No manifest.
      │              │               └── 🔴 §0: the lot is NOT normalized per contract.
      │              └── 🔴 NONE until 031 §0. 27 days remain UNEXPLAINABLE.
      └── 🟡 manual fetch, no failure record.
```

---

# PART 3 — TEMPORAL GOVERNANCE

| Aspect | Verdict |
|---|---|
| **Timestamp accuracy** | 🟡 **Date-only (`TradDt`). No intraday timestamps exist in this dataset** |
| **Exchange timestamps** | 🟢 The exchange's own file |
| **Session boundaries** | ⚪ **N/A — EOD data** |
| 🔴 **Trading holidays** | 🔴 **NO CALENDAR EXISTS.** 27 of 638 expected weekdays are unexplainable *(031 §0.2)* |
| **Expiry handling** | 🟡 `nearExp = min(expiries ≥ date)` — 🔴 **and §0 shows the expiry determines the LOT, which nothing models** |
| **Time zones** | 🔴 **IST is ASSUMED, never declared.** No TZ library. 22 hardcoded offsets *(006 T-2)* |
| **Daylight saving** | 🟢 **N/A — India has none** |

## 🔴 Temporal correctness: **UNVERIFIABLE**

> **`days[i-1]` is the previous FILE, not the previous TRADING DAY. With 27 unexplainable gaps and no
> calendar, this cannot be proven** *(031 §0.3)*.
>
> **The 002 fix has TWO unverified preconditions: the calendar (031 §0.3) and the lot (§0 here).**

---

# PART 4 — SCIENTIFIC INTEGRITY

| Bias | Present? |
|---|---|
| **Look-ahead** | 🔴 **CONFIRMED — 7 of 8 strategy scripts still read today's close.** 🟢 `bt-validate.js` fixed in 002 |
| **Survivorship** | 🟢 **NOT APPLICABLE for the index** — 🔴 **BUT CONFIRMED in the paper-trading evidence:** 3 of 4 engines lose open positions on restart, so surviving trades are silently selected *(010 §0)*. **The infrastructure introduced the bias** |
| **Data leakage** | 🔴 **CONFIRMED** — the IV-proxy regime gate read today's close *(fixed in 002)* |
| **Future information** | 🔴 **CONFIRMED — `bt-real.js`'s OI filter reads END-OF-DAY OI at entry** *(001-D R-03)* |
| **Selection bias** | 🔴 **CONFIRMED** — the published results cite `bt-strangle-costs` (the winner); `bt-strangle-tailsafe`, the only script modelling the structure actually traded, is cited by nothing *(009)* |
| **Forward contamination** | 🔴 **CONFIRMED** — `nTrials = 12` where 36 variants were tried *(009 §0)* |
| 🔴 **IMPROPER ALIGNMENT** | 🔴 **CONFIRMED — §0. The lot is aligned to the FILE, not to the CONTRACT. A structural misalignment I introduced myself** |

## **Six of seven bias classes confirmed. The seventh — improper alignment — was introduced by this audit.**

---

# PART 5 — DATASET VERSIONING

| Requirement | Present? |
|---|---|
| **Dataset identity** | 🔴 **NO hash, no manifest** |
| **Dataset revisions** | 🔴 **NONE tracked** |
| **Schema evolution** | 🟢 **STABLE — all 600 files carry 34 columns** *(031 §0.1)* |
| **Historical corrections** | 🔴 **NONE tracked.** If NSE re-issues a bhavcopy, nothing detects it |
| **Provenance** | 🔴 **NONE. 0 of 13 backtest scripts record a `gitSha`** *(008 P9-A)* |
| **Reproducibility after a dataset update** | 🔴 **IMPOSSIBLE.** No result names the data it used |

## 🔴 **Are historical experiments reproducible after a dataset update?**

> **NO. `bt-data/result-strangle-costs.json` holds the PF 7.41 that justified ₹7 lakh. It does not
> record which version of `bt-lib.js` produced it, which files were on disk, or what the lot was.**
>
> **And §0 now adds a second unknown: even if the code version were recorded, the lot it read was
> arbitrary.**

---

# PART 6 — MARKET STRUCTURE EVOLUTION

## 🔴 **This is where §0 came from, and it is the finding of this audit**

**Measured directly from the 600-day dataset:**

| Structural change | Preserved explicitly? |
|---|---|
| **Lot-size changes** | 🔴 **NO — and the model of them is WRONG.** The lot is per-CONTRACT (keyed by expiry), because NSE revises the lot only for **newly issued** contracts while existing ones keep the old lot until expiry. **The platform models it as per-DAY, which does not exist** |
| **Contract specification changes** | 🔴 **NOT MODELLED** |
| **Index methodology changes** | ⚪ **UNKNOWN — never investigated** |
| **Exchange rule changes** | 🔴 **NOT MODELLED** |
| **Symbol migrations** | 🟢 N/A — one symbol per file |
| **Expiry calendar changes** | 🔴 **NOT MODELLED.** The project's own history records that NIFTY/SENSEX expiry weekdays were **SWAPPED** in `pop-seller` — and `option-analyzer.js:654` still hardcodes the expiry weekday with `getDay()`, bypassing the registry *(006 T-1)* |

## The lot regimes, as they actually appear in the data

```
  2024-01-08 → 2024-04-25    nearest-expiry lot: 50
  2024-04-26 → 2024-11-xx    nearest-expiry lot: 25
  2024-12 onwards            TRANSITION — 25 and 75 COEXIST, keyed by expiry
  2025-10/11/12              TRANSITION — 65 and 75 COEXIST, keyed by expiry
```

> **A naive scan of `rows[0][28]` reports "28 distinct lot regimes across 600 days" — a lot changing
> three times in one week, which is impossible.**
>
> **The truth is far simpler and far more important: there are a handful of genuine revisions, and each
> one creates a TRANSITION WINDOW during which both lots are valid, and the correct one depends on the
> contract.**
>
> ## **032 asks whether historical evolution is "preserved explicitly rather than assumed constant."**
> ## **The answer is worse than "assumed constant." It is assumed to be a function of the wrong variable.**

---

# PART 7 — OBSERVABILITY

| Required per historical dataset | Recorded? |
|---|---|
| Source | 🟡 implied |
| **Collection date** | 🟡 file mtime |
| **Effective market date** | 🟢 `TradDt` (col 0) |
| **Version** | 🔴 **NO** |
| **Validation result** | 🔴 **NO — 031 §0 was the first** |
| **Integrity status** | 🔴 **NO** |
| **Transformation history** | 🔴 **NO** |

## **2 of 7. *"Historical data without provenance is unsuitable for scientific research."***

---

# PART 8 — FAILURE MODE REGISTER

| ID | Failure | Present? | Scientific impact |
|---|---|---|---|
| **HD-1** | 🔴 **The lot is read from an arbitrary row, not from the traded contract** | 🔴 **CONFIRMED (§0) — 27 of 600 days** | 🔴 **CRITICAL. Every sized position, charge and P&L on those days is wrong. AND IT IS MY OWN FIX** |
| **HD-2** | **A missing session is indistinguishable from a failed download** | 🔴 **CONFIRMED — 27 days** *(031 §0.2)* | 🔴 **CRITICAL. Undermines `days[i-1]`** |
| **HD-3** | **Improper alignment: the lot aligned to the file, not the contract** | 🔴 **CONFIRMED (§0)** | 🔴 **CRITICAL** |
| **HD-4** | **Look-ahead in 7 of 8 scripts** | 🔴 **CONFIRMED** | 🔴 **CRITICAL** |
| **HD-5** | **Survivorship bias in the paper evidence** | 🔴 **CONFIRMED — introduced by the infrastructure** *(010 §0)* | 🔴 **CRITICAL** |
| **HD-6** | **No dataset version ⇒ no experiment is reproducible** | 🔴 **CONFIRMED** | 🔴 **CRITICAL** |
| **HD-7** | **Intraday history is not re-derivable** | 🔴 **CONFIRMED — 1 session** | 🔴 **IRREVERSIBLE** |
| **HD-8** | **Derived features discarded** | 🔴 **CONFIRMED** *(018)* | 🔴 **IRREVERSIBLE** |
| 🟢 **HD-9** | **Duplicate sessions / corrupted history / schema drift** | 🟢 **NOT PRESENT** *(031 §0.1)* | 🟢 |

---

# PART 9 & 10 — TIME-SERIES ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   ContractRegistry  ★★★   THE PRIMITIVE §0 PROVES IS MISSING.
     🔴 A LOT BELONGS TO A CONTRACT (symbol, expiry), NOT TO A DAY.
        lot(symbol, expiry) — read from THAT CONTRACT'S ROW, never from row 0.
     🔴 bt-lib.js:39 must map column 28 into opts[]. It does not.  → kills HD-1, HD-3
     🔴 A transition window (two lots coexisting) is NORMAL and must be MODELLED,
        not flattened to a single per-day value.

   TradingCalendar  ★★★   The other missing primitive (031 §0.3).
     🔴 Without it, a holiday and a failed download are the same thing,
        AND days[i-1] cannot be proven to be the previous trading day.

   DatasetVersionRegistry  ★
     datasetHash · fileCount · dateRange · missingDays · schemaVersion.
     🔴 Every result cites the datasetHash it used. Today: none do.

   BiasDetectionLayer  ★
     look-ahead tripwire per script · alignment assertion (lot from the CONTRACT row) ·
     nTrials from a registry · survivorship check on the paper ledger.
     🔴 §0 IS THE PROOF THAT THIS LAYER IS NEEDED: a fix that passed 48 suites,
        was characterization-tested and peer-reviewed in a formal report,
        still encoded a false assumption about market structure.
```

## The rule §0 establishes

> **A test suite proves that the code does what the author believed. It cannot prove that the author's
> belief about the market was true.**
>
> **The 002 fix was proven red first, reviewed, documented and green across 48 suites — and it encodes
> a market-structure assumption that the data itself refutes. Only the data can refute a belief about
> the data.**

---

# PART 11 — TESTING STRATEGY

**Scientific correctness has priority over execution speed.**

| Test | Priority | Would it fail today? |
|---|---|---|
| 🔴 **The lot used for a leg equals the lot ON THAT LEG'S ROW** | **P0 — §0** | ✅ **FAILS — 27 of 600 days.** **THE HIGHEST-PRIORITY TEST IN THIS DOCUMENT** |
| 🔴 **`day.lot` is REMOVED — a per-day lot does not exist** | **P0 — §0** | ✅ **FAILS — `bt-lib.js:37` publishes one** |
| 🔴 **`days[i-1]` is the immediately preceding TRADING day** | **P0 — 031 §0.3** | ✅ **FAILS — no calendar** |
| 🔴 **Every result records a `datasetHash` and a `gitSha`** | **P0 — HD-6** | ✅ **FAILS — 0 of 13** |
| 🔴 **A look-ahead tripwire per strategy script** | **P0** | ✅ **FAILS — 7 of 8 remain** |
| 🟢 **All 600 files carry 34 columns** | P1 | 🟢 **PASSES. Lock it in as a schema ratchet** |
| 🟢 **No duplicate dates, no empty files** | P1 | 🟢 **PASSES. Lock it in** |

**Five P0 tests fail. The first one invalidates the only fix this programme applied.**

---

# PART 12 — HISTORICAL DATA MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Static Files** | 🟢 | 600 CSV on disk |
| **1 — Managed History** | 🟡 **PARTIAL** | 🟢 A fetcher exists; the archive is clean and re-downloadable · 🔴 **no manifest, no version, no failure record** |
| **2 — Validated Time-Series** | 🔴 **NO** | **031 §0 was the first validation. It found 27 unexplainable gaps.** **032 §0 found a misalignment in the platform's own loader** |
| **3 — Scientific Dataset Governance** | 🔴 **NO** | **No dataset hash. No result cites its data. No experiment is reproducible** |
| **4 — Bias-Resistant** | 🔴 **NO** | **6 of 7 bias classes confirmed — and the 7th was introduced by this audit** |
| **5 — Enterprise Research Data** | 🔴 **NO** | — |

## ## **Historical Data Platform: LEVEL 0–1 — STATIC FILES / partially managed.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE.** **§0 found a defect in the one fix this programme applied** | — | none | The lot is per-CONTRACT. Measured: 27 of 600 days wrong |
| **2 — Temporal governance** | 🔴 **A CONTRACT REGISTRY: `lot(symbol, expiry)`, read from the contract's own row.** 🔴 **Map column 28 into `opts[]` (`bt-lib.js:39`).** 🔴 **REMOVE `day.lot` — it does not exist.** 🔴 **A TRADING CALENDAR** *(031)* | **A characterization test proving the current lot is wrong on 27 days** | 🔴 **BEHAVIOUR CHANGE. Every backtest result moves again. THAT IS CORRECT** | 🔴 **`bt-validate.js` re-run with the CONTRACT lot. The 002 conclusion re-derived** |
| **3 — Bias validation** | Look-ahead tripwire × 7 scripts. Alignment assertion. `nTrials` from a registry | Phase 2 | Approval per script | **6 of 7 bias classes closed** |
| **4 — Version governance** | `datasetHash` + `gitSha` on every result. **Never overwrite a result in place** *(015)* | Phase 3 | Low | **Every experiment reproducible** |
| **5 — Scientific platform** | 🔴 **Feature store** *(018 — irreversible)*. 🔴 **Intraday chain capture** *(031 — irreversible)* | Phase 4 | **Time. Both worsen daily** | **The evidence that cannot be re-derived is being collected** |

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every dataset has one owner | 🟡 **The bhavcopy: yes (`bt-lib`). Four dataset classes do not exist** |
| **Time-series integrity is measurable** | 🟢 **YES — as of 031 §0 and 032 §0. And both found defects** |
| Dataset versions are reproducible | 🔴 **NO — no hash, no manifest** |
| **Temporal alignment is verified** | 🔴 **NO — §0: the lot is aligned to the FILE, not the CONTRACT. 27 of 600 days** |
| **Scientific biases are explicitly assessed** | 🟢 **YES — 6 of 7 confirmed, and the 7th self-reported** |
| **Historical evolution is preserved** | 🔴 **NO — the lot revision is modelled as a per-DAY value, which does not exist** |
| **Unknown historical properties are never replaced with assumptions** | 🔴 **NO — and I did it myself. §0** |

## **2 of 7.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent researcher reproduce every historical experiment, verify temporal
correctness, detect bias, and explain every observation using documented evidence?**

## **No. And the most important reason is a defect in the one fix this audit programme applied to production code.**

**In audit 002 I removed the look-ahead from `bt-validate.js` and replaced the hardcoded `LOT = 75` with
what I called *"the real per-day lot, straight from the data."* It was characterization-tested, proven
red first, reviewed, documented in a formal report, and green across 48 test suites.**

**It is wrong.**

> ## **THERE IS NO SUCH THING AS A PER-DAY LOT.**
>
> **When NSE revises a lot size, existing contracts keep the old lot until they expire; only newly
> issued contracts carry the new one. A single trading day therefore legitimately contains BOTH lots —
> and which one applies depends entirely on which expiry you are trading.**
>
> **`nifty-20241203.csv` contains 1,352 rows at lot 25 and 338 rows at lot 75. My fix reads
> `rows[0][28]` — an arbitrary row — and gets 75. The nearest expiry, which is what the strategy
> actually trades, is lot 25.**
>
> **`bt-lib.js:39` never maps the lot into `opts[]` at all. The correct lot is sitting on the contract's
> own row, and nothing reads it.**

**The impact, measured across all 600 days:**

```
  My 002 fix reads the wrong lot on          :  27 of 600 days   ( 4.5%)
  The old hardcoded LOT=75 was wrong on      : 355 of 600 days   (59.2%)
```

**So the fix is a thirteen-fold improvement — and it is not correct. Both statements are true, and
neither one excuses the other.**

**This is the ninth time this programme has caught its own author, and the first time on production
code. It matters more than the other eight, because:**

> **The fix passed every gate the platform has. It was proven red first. It carried 23 characterization
> assertions. It was reviewed in a formal stabilization report. It went green across 48 suites. And it
> encodes a belief about market structure — *"a day has a lot"* — that the data itself refutes.**
>
> ## **A test suite proves that the code does what its author believed. It cannot prove that the author's belief about the market was true.**
> ## **Only the data can refute a belief about the data — and nobody had asked it.**

**Two structural primitives are missing, and both are one file each:**

> **A CONTRACT REGISTRY — `lot(symbol, expiry)`, read from the contract's own row. It makes §0 impossible.**
>
> **A TRADING CALENDAR — 27 unexplainable gaps become known, and `days[i-1]` becomes provable *(031 §0.3)*.**

**And what remains irreversible, worsening every day it is not started:**

> **The feature store *(018)*. The intraday chain capture — one session exists *(031)*.**
> **Every other defect in this thirty-four-document programme can be fixed tomorrow at the same cost as
> today. These two cannot.**

**The final, honest statement of this audit programme:**

> **`bt-validate.js` is the only production file it changed. That change removed a look-ahead bias that
> had invalidated every result this platform ever published — and it introduced a lot misalignment on
> 4.5% of days.**
>
> **Both findings are measured. Both are reported. Neither is spun.**
>
> **That is what the process is for.**

---

**Storage redesigned: NONE. Datasets modified: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Historical Dataset Inventory (Part 1) · Time-Series Lifecycle (Part 2) · Temporal
Governance (Part 3) · **Scientific Integrity Review (§0, Part 4)** · Dataset Versioning (Part 5) ·
**Market Structure Evolution (Part 6)** · Failure Modes (Part 8) · Time-Series Architecture (Parts 9–10) ·
Testing Strategy (Part 11) · Maturity Assessment (Part 12) · Migration Roadmap (Part 13) · Executive
Summary.
