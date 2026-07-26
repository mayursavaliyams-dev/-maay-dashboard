# 031 — MARKET DATA PLATFORM, INGESTION & DATA SOURCE GOVERNANCE

**Standard:** Master Prompt 031 · **Depends on:** 000-A … 030
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No strategy validated. No ingestion pipeline modified.**

**Relationship to 006:** audit **006** established the market-data *architecture*. **031 asks the harder
question its own stop condition demands: *"Never assume correctness because data was successfully
downloaded."* So this audit VERIFIES the dataset — for the first time.**

---

# SECTION 0 — DATASET INTEGRITY: VERIFIED FOR THE FIRST TIME

**600 bhavcopy files sit on disk. Nobody has ever checked them. I did.**

## 🟢 §0.1 — Every integrity check that CAN be run, PASSES

```
  files on disk              : 600
  range                      : 2024-01-08 → 2026-06-17
  duplicate dates            : NONE
  empty files (0 bytes)      : 0
  suspiciously small (<1 KB) : 0
  file size                  : min 269,869 · median 303,403 · max 421,620 bytes
  COLUMN COUNT distribution  : { 34: 600 }        ← ALL 600 FILES. IDENTICAL SCHEMA.
```

> **Zero duplicates. Zero empty files. Zero truncated files. And the schema is stable across the entire
> 2.4-year span — all 600 files carry exactly 34 columns.**
>
> **This is a genuinely clean dataset, and it is the strongest data asset the platform has.**

## 🔴 §0.2 — **AND THERE ARE 38 MISSING WEEKDAYS THAT NOTHING CAN EXPLAIN**

```
  expected weekdays in range : 638
  present                    : 600
  ─────────────────────────────────
  MISSING                    :  38
```

**Of those 38, exactly 11 can be verified against a fixed-date Indian market holiday:**

```
  2024-01-26  Republic Day        2025-05-01  Maharashtra Day
  2024-05-01  Maharashtra Day     2025-08-15  Independence Day
  2024-08-15  Independence Day    2025-10-02  Gandhi Jayanti
  2024-10-02  Gandhi Jayanti      2025-12-25  Christmas
  2024-12-25  Christmas           2026-01-26  Republic Day
                                  2026-05-01  Maharashtra Day
```

**The other 27 cannot be verified at all:**

```
  20240122  20240308  20240325  20240329  20240411  20240417  20240520  20240617
  20240717  20241115  20241120  20250226  20250314  20250331  20250410  20250414
  20250418  20250827  20251022  20251105  20260115  20260303  20260326  20260331
  20260403  20260414  20260528
```

**They are *plausibly* moveable holidays — 2024-03-25 lines up with Holi, 2024-03-29 with Good Friday,
2025-03-31 with Eid, 2025-10-22 with Diwali, 2026-03-03 with Holi. The pattern is right.**

## 🔴 **BUT THERE IS NO HOLIDAY CALENDAR IN THE REPOSITORY.**

```
grep -rli "holiday" bt-lib.js bt-bhav-fetch.js bt-validate.js   →   NOTHING
```

> ## **A genuine market holiday and a failed download are INDISTINGUISHABLE.**
>
> **The fetcher (`bt-bhav-fetch.js`) skips weekends (`isWeekday()`), downloads what it can, and **records
> nothing about what it could not get**. There is no manifest, no expected-days list, no failure log.**
>
> **031's stop condition: *"Never assume correctness because data was successfully downloaded."***
> ## **→ 27 of 638 expected days: UNKNOWN. Not missing. Not present. UNKNOWN.**

## 🔴 §0.3 — **AND THIS DIRECTLY UNDERMINES MY OWN 002 FIX**

**The fix I applied in audit 002 removed the look-ahead from `bt-validate.js` by making the strategy read
*yesterday's* close:**

```js
bt-validate.js   for (let i = 1; i < days.length; i++) {
                   const day = days[i], prev = days[i - 1];   // ← "yesterday"
```

**`days[i-1]` is the previous FILE. Not the previous TRADING DAY.**

**If any one of those 27 unexplained gaps is a *failed download* rather than a holiday, then `prev` is
silently 2 or more calendar days stale — and the strategy makes its entry decision from a reference
price that is two days old, with nothing detecting it.**

| | |
|---|---|
| **Is it a regression?** | **No.** Reading a stale price is strictly better than reading the *future*. |
| **Is it an undocumented assumption?** | 🔴 **YES — and I flagged it myself in 008 P3-A as a hazard. §0.2 has now MEASURED it: 27 gaps, unresolvable.** |
| **Can it be resolved?** | 🔴 **NOT WITHOUT A HOLIDAY CALENDAR.** The calendar does not exist |
| **Severity** | **MEDIUM** — and it is **the last unresolved defect in the one component this audit programme actually fixed** |

> **The fix is correct. Its precondition — that consecutive files are consecutive trading days — has now
> been measured, and it is UNVERIFIABLE.**

---

# PART 1 — DATA SOURCE INVENTORY

| # | Source | Owner | Frequency | Retention | Validation | Confidence |
|---|---|---|---|---|---|---|
| **1** | 🟢 **NSE UDiFF bhavcopy** — `nsearchives.nseindia.com` | `bt-bhav-fetch.js` | manual | 🟢 **permanent, re-downloadable** | 🟢 **§0 — verified clean** | **HIGH** |
| 2 | **NSE option chain** (`www.nseindia.com`) | `free-chain.js` | polled | in-memory | 🔴 **`\|\| 0`** | MEDIUM |
| 3 | **Sensibull** (`api.sensibull.com`) | `free-chain.js`, `sensibull-fetcher.js` | polled | cache | 🔴 **unofficial / scraped** | MEDIUM |
| 4 | **Dhan REST** (`api.dhan.co`) | `dhan-client.js` | polled | cache | 🟡 429 backoff 🟢 | HIGH |
| 5 | **Dhan WebSocket** | `dhan-ws-feed.js` | stream | — | 🟡 | HIGH |
| 6 | **Upstox REST** | `upstox-connector.js` | polled | cache | 🔴 **no retry** | HIGH |
| 7 | **Yahoo (VIX / spot fallback)** | `server.js`, `event-engine.js` | polled | 3-min cache | 🔴 | MEDIUM |
| **8** | 🔴 **BSE market data** | — | — | — | — | 🔴 **`oi_unit` UNKNOWN. F4 proved units for NSE only** |
| **9** | 🔴 **Intraday option chains** (`data/opt-candles/`) | `server.js` | live | 🔴 **NOT re-derivable** | — | 🔴 **1 COMPLETE SESSION EXISTS** |
| 10 | **Option High/Low archive** (`data/opt-hl/`) | `server.js` | live | 🔴 not re-derivable | — | MEDIUM |
| 11 | **Volatility (GEX/VIX history)** | `server.js` | derived | 15 entries | 🔴 raw write | LOW |
| **12** | 🔴 **VRP monitor** | — | — | **`data/vrp-monitor.json` = 0 entries** | — | 🔴 **The instrument that would test the core hypothesis has NEVER recorded an observation** |
| 13 | 🔴 **`encoding-pierce-season-edwards.trycloudflare.com`** | `preflight.js` | ? | ? | ? | ⚪ **UNKNOWN — an ephemeral tunnel URL hardcoded in the source** |
| 14 | **News** (4 sites) | `news-engine.js` | polled | `.jsonl` 🟢 | 🔴 scraped | LOW |

## **14 sources. One has verified provenance. One does not exist as a URL anyone can explain.**

---

# PART 2 — INGESTION PIPELINE

```
  Source ──▶ Download ──▶ Validation ──▶ Normalization ──▶ Transform ──▶ Persist ──▶ Index ──▶ Distribute ──▶ Consumers
     ↓          ↓             ↓               ↓                ↓            ↓          ↓           ↓
     │          │             │               │                │            │          │           └── 🔴 no port,
     │          │             │               │                │            │          │               6 shapes
     │          │             │               │                │            │          └── 🔴 NO INDEX. loadDays()
     │          │             │               │                │            │              readdir + sort by filename.
     │          │             │               │                │            └── 🟢 CSV / 🟡 JSON
     │          │             │               │                └── 🔴 `|| 0` × 119. Unknown → a number.
     │          │             │               └── 🔴 oiUnit NEVER DECLARED (A-13, still UNKNOWN)
     │          │             └── 🔴🔴 NO VALIDATION LAYER. A 200 OK is treated as correct data.
     │          └── 🟡 bt-bhav-fetch: skips weekends, downloads, RECORDS NOTHING ABOUT FAILURES (§0.2)
     └── 🟡 14 sources.
```

## **Three of nine stages do not exist: Validation, Indexing, and a Distribution port.**

---

# PART 3 — DATA OWNERSHIP

| Data class | Owner | Verdict |
|---|---|---|
| **Raw (bhavcopy)** | `bt-bhav-fetch.js` | 🟡 **SINGLE — but it records no manifest** |
| **Raw (live chain)** | **6 connectors** | 🔴 **MULTIPLE — no shared interface** |
| **Normalized** | 🔴 **NOBODY** | 🔴 **`free-chain.js` alone has THREE different leg parsers** *(006)* |
| **Derived** (GEX, IV, opt-hl) | `server.js` | 🔴 **CONTESTED** |
| **Cached** | per-connector | 🟡 |
| **Historical** | 🟢 `bt-lib.js` | 🟢 **SINGLE — and it is the one that was fixed** |
| **Live** | 🔴 **NOBODY** | 🔴 |

## **Two owners. Four missing or contested.**

---

# PART 4 — INGESTION GOVERNANCE

| Capability | Verdict |
|---|---|
| **Scheduling** | 🔴 **MANUAL.** `bt-bhav-fetch.js` is run by hand |
| **Retry logic** | 🟢 Dhan (429 backoff) · 🔴 **Upstox: none** · 🔴 **`bt-bhav-fetch`: unknown** |
| **Failure handling** | 🔴 **NONE. §0.2 is the proof — a failed download and a holiday look identical** |
| **Duplicate detection** | 🟢 **NOT NEEDED — verified zero duplicates (§0.1)** |
| **Missing-data detection** | 🔴 **NONE.** No expected-days manifest exists |
| **Source verification** | 🟢 **NSE bhavcopy is the exchange's own file — the highest provenance available** |
| **Versioning** | 🔴 **NONE.** No dataset hash, no manifest, no version |

## ## **031's stop condition: *"Unknown ingestion behaviour remains UNKNOWN."* → 27 days: UNKNOWN.**

---

# PART 5 — DATA PROVENANCE

| Required per dataset | Recorded? |
|---|---|
| **Source** | 🟡 Implied by the filename |
| Timestamp | 🟡 File mtime |
| **Collection method** | 🔴 **NO** |
| **Version / dataset hash** | 🔴 **NO** |
| **Validation status** | 🔴 **NO — §0 is the first validation ever performed** |
| **Transformation history** | 🔴 **NO** |
| **Integrity status** | 🔴 **NO — until §0** |

## 🔴 **1 of 7. *"Data without provenance is unsuitable for research."***

**This is the same defect as 008 P9-A (no `gitSha` on any backtest result), 015 §0 (no invalidation
marker on any result file), and 028 Part 7 (no artifact provenance). **The platform does not attach
identity to anything it produces or consumes — in research, in delivery, or in market data.**

---

# PART 6 — DISTRIBUTION

| Consumer | Receives | Validated? |
|---|---|---|
| **Research / Backtesting** | `bt-lib.loadDay()` | 🟢 **The ONE parser that obeys `Unknown ≠ Zero`** — `lot: null` when unreadable, **never a guess** |
| **Paper trading** | live chain | 🔴 **NO — `\|\| 0` × 119** |
| **AI engine** | 9 factors | 🔴 **NO — and the features are then DISCARDED** |
| **Risk engine** | — | ⚪ **DOES NOT EXIST** |
| **Portfolio** | — | ⚪ **DOES NOT EXIST** |
| **Dashboard** (19 pages) | everything | 🔴 **NO** |
| **Analytics** (GEX, vol-context) | chain OI | 🔴 **NO — and `oiUnit` is STILL UNKNOWN (A-13)** |

## 🟢 The one distribution path that is correct

```js
bt-lib.js:37   const lot = Number.isFinite(rawLot) && rawLot > 0 ? rawLot : null;
               // null, NEVER a fallback to 75.
```

> **`bt-lib.loadDay()` is the only parser in this platform that refuses to guess. Every other consumer
> receives a `0` where the truth was "unknown."**

---

# PART 7 — OBSERVABILITY

| Required per ingestion event | Recorded? |
|---|---|
| Timestamp | 🔴 **NO** |
| Dataset | 🔴 **NO** |
| Source | 🔴 **NO** |
| **Success / Failure** | 🔴 **NO — §0.2: a failure leaves no trace** |
| Duration | 🔴 **NO** |
| Validation result | 🔴 **NO** |
| Retry count | 🟢 **Broker calls only** *(`server.js:6280`)* |

## **1 of 7. *"Ingestion without observability is incomplete."***

---

# PART 8 — FAILURE MODE REGISTER

| ID | Failure | Present? | Impact |
|---|---|---|---|
| **MD-1** | **A failed download is indistinguishable from a holiday** | 🔴 **CONFIRMED — 27 days (§0.2)** | 🔴 **CRITICAL — and it undermines the 002 fix (§0.3)** |
| **MD-2** | **Missing market data silently becomes valid data** | 🔴 **CONFIRMED — `\|\| 0` × 119** | 🔴 **CRITICAL. An unknown OI becomes zero OI** |
| **MD-3** | **`oiUnit` UNKNOWN for the live broker chain** | 🔴 **STILL UNKNOWN (A-13, flagged since 006)** | 🔴 **If units, every GEX is wrong by 65×.** *One row of comparison settles it. Still not done* |
| **MD-4** | **BSE `oi_unit` UNKNOWN** | 🔴 **CONFIRMED** | HIGH — SENSEX/BANKEX analytics unverified |
| **MD-5** | **Intraday chains are not re-derivable** | 🔴 **CONFIRMED — 1 session exists** | 🔴 **IRREVERSIBLE. Every day of delay is permanently lost** |
| **MD-6** | **`vrp-monitor.json` is EMPTY** | 🔴 **CONFIRMED — 0 entries** | 🔴 **The core hypothesis has never been directly observed** |
| **MD-7** | **An unexplained Cloudflare tunnel in the source** | ⚪ **UNKNOWN** | ⚪ |
| **MD-8** | **Schema change** | 🟢 **NOT PRESENT — all 600 files carry 34 columns (§0.1)** | 🟢 |
| **MD-9** | **Corrupted / partial downloads** | 🟢 **NOT PRESENT — 0 empty, 0 truncated (§0.1)** | 🟢 |
| **MD-10** | **Duplicate ingestion** | 🟢 **NOT PRESENT — 0 duplicate dates (§0.1)** | 🟢 |

---

# PART 9 & 10 — MARKET DATA ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   SourceRegistry  ★   Every source: owner · frequency · retention · validation · confidence.
                       🔴 Today one source (a Cloudflare tunnel) cannot be explained by anyone.

   IngestionManager  ★
     🔴 AN EXPECTED-DAYS MANIFEST. Fetch what is expected; RECORD what was not obtained.
        A holiday is a DECLARED SKIP. A failure is a RECORDED FAILURE.
        They must never look the same again.                              → kills MD-1, §0.3

   ValidationLayer  ★★  RUNS BEFORE ANYTHING IS STORED.
     🔴 A MISSING FIELD IS `null`, NEVER `0`. An unknown OI is not zero OI. → kills MD-2
     🔴 `oiUnit` IS A MANDATORY FIELD in the chain contract. A required field makes the
        question un-skippable — and it has been UNKNOWN since audit 006.  → kills MD-3
     🔴 Schema assertion on every file: 34 columns, or REFUSE.

   TradingCalendar  ★★★  THE MISSING PRIMITIVE.
     🔴 Without it: a holiday and a failed download are the same thing,
        AND `days[i-1]` cannot be proven to be the previous trading day.
     🔴 IT IS THE PRECONDITION FOR THE ONE FIX THIS AUDIT PROGRAMME APPLIED.

   DataAuditRegistry  ★  datasetHash · source · fetchedAt · expectedDays · missingDays ·
                         validationResult.  (The append-only .jsonl writer already exists.)
```

## The rule §0 establishes

> **A dataset that passes every check you know how to run is not a verified dataset. It is a dataset
> whose gaps you cannot explain.**
>
> **600 clean files, zero duplicates, a stable schema — and twenty-seven days that are either holidays
> or failures, and nothing in this repository can tell you which.**

---

# PART 11 — TESTING STRATEGY

| Test | Priority | Would it fail today? |
|---|---|---|
| 🔴 **Every expected trading day is present, or its absence is a DECLARED holiday** | **P0 — §0.2** | ✅ **FAILS — 27 unexplained** |
| 🔴 **`days[i-1]` is the immediately preceding TRADING day** | **P0 — §0.3** | ✅ **FAILS — unverifiable without a calendar** |
| 🔴 **A missing chain field yields `null`, never `0`** | **P0 — MD-2** | ✅ **FAILS — 119 sites** |
| 🔴 **`oiUnit` — one live chain row vs the same-day bhavcopy row** | **P0 — MD-3** | ✅ **STILL NOT DONE. Flagged since 006** |
| 🟢 **Every bhavcopy file has 34 columns** | P1 | 🟢 **PASSES (§0.1). Lock it in — it is a schema-drift ratchet** |
| 🟢 **No duplicate dates, no empty files** | P1 | 🟢 **PASSES (§0.1). Lock it in** |
| **A failed download is recorded, not silent** | P1 | ✅ FAILS |

**Four P0 tests fail. Two P1 checks already pass and should be locked in as ratchets.**

---

# PART 12 — MARKET DATA MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Manual Downloads** | 🟢 | `bt-bhav-fetch.js`, run by hand |
| **1 — Automated Collection** | 🟡 **PARTIAL** | 🟢 A fetcher exists and works · 🔴 **no scheduling, no failure record** |
| **2 — Validated Ingestion** | 🔴 **NO** | **§0 is the first validation ever performed — and it found 27 unexplainable gaps** |
| **3 — Governed Distribution** | 🔴 **NO** | **6 connectors, no port. `oiUnit` still UNKNOWN. `\|\| 0` × 119** |
| **4 — Observable Data Platform** | 🔴 **NO** | **1 of 7 ingestion-observability fields** |
| **5 — Enterprise Market Data** | 🔴 **NO** | — |

## ## **Market Data Platform: LEVEL 0–1 — MANUAL / partially automated.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Source inventory** | ✅ **DONE — this document.** **§0 is the platform's first dataset verification** | — | none | 600 files clean · **27 days unexplainable** |
| **2 — Ingestion governance** | 🔴 **A TRADING CALENDAR.** 🔴 **An expected-days manifest** — fetch what is expected, **record what was not obtained** | none | **Zero — additive** | 🔴 **The 27 gaps become KNOWN. And the 002 fix's precondition becomes PROVABLE (§0.3)** |
| **3 — Validation** | 🔴 **Missing field ⇒ `null`, never `0`** (119 sites). 🔴 **`oiUnit` mandatory in the chain contract.** 🟢 **Lock in the 34-column schema ratchet** | Phase 2 | 🔴 **Changing `\|\| 0` → `null` WILL surface latent null-derefs downstream. That is the point.** Approval | **No unknown market value is ever a number** |
| **4 — Distribution** | `MarketDataPort` — one interface, six adapters. **Every payload carries `oiUnit` and its age** | Phase 3 | Medium | **Every consumer receives a validated, dated, unit-declared payload** |
| **5 — Enterprise** | 🔴 **CAPTURE INTRADAY CHAINS DAILY — MD-5 is IRREVERSIBLE.** 🔴 **Start the VRP monitor — it is EMPTY** | Phase 4 | **Time. Irreversible if delayed** | **The evidence that cannot be re-derived is being collected** |

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every source has one owner | 🔴 **NO — 4 classes are missing or contested; one source cannot be explained at all** |
| **Data provenance is complete** | 🔴 **NO — 1 of 7 fields. No hash, no manifest, no version** |
| **Ingestion failures are observable** | 🔴 **NO — §0.2: a failure and a holiday are identical** |
| **Validation is reproducible** | 🟢 **YES, as of §0 — and every check it can run, passes** |
| Distribution is governed | 🔴 **NO — 6 connectors, no port, `oiUnit` unknown** |
| Consumers receive deterministic datasets | 🟡 **Historical: YES 🟢. Live: NO — `\|\| 0` × 119** |
| **Missing market data never silently becomes valid data** | 🔴 **NO — 119 sites, and 27 missing days** |

## **1 of 7.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent market-data engineer identify every source, reproduce ingestion,
verify provenance, and confirm validation integrity?**

## **Identify: yes. Verify: I did it — for the first time. And the verification found something that undermines the one fix this entire audit programme applied.**

🟢 **The historical dataset is the strongest asset this platform has, and it is genuinely clean:**

> **600 bhavcopy files from the exchange's own UDiFF feed. Zero duplicate dates. Zero empty files. Zero
> truncated files. And a perfectly stable schema — all 600 files carry exactly 34 columns across a
> 2.4-year span.**
>
> **Every integrity check that can be run, passes. `bt-lib.loadDay()` is the one parser in this platform
> that refuses to guess: `lot: null` when the value is unreadable, never a fallback to 75.**

🔴 **And then the gap that nothing can close:**

> **638 weekdays lie between the first file and the last. 600 are present. Thirty-eight are missing.**
>
> **Eleven of them are verifiable fixed-date holidays — Republic Day, Independence Day, Gandhi Jayanti,
> Christmas, Maharashtra Day.**
>
> **The other twenty-seven are *plausibly* moveable holidays. The dates line up with Holi, Good Friday,
> Eid and Diwali. The pattern is right.**
>
> ## **But there is no trading calendar in this repository. A genuine market holiday and a failed download are INDISTINGUISHABLE.**

**And that ambiguity lands squarely on the one thing this audit programme actually changed:**

> **The 002 fix removed the look-ahead from `bt-validate.js` by making the strategy read *yesterday's*
> close — `days[i-1]`.**
>
> **`days[i-1]` is the previous FILE. Not the previous TRADING DAY.**
>
> **If even one of those twenty-seven gaps is a failed download rather than a holiday, then `prev` is
> silently two or more days stale, and the strategy sets its strike from a reference price that is two
> days old — with nothing detecting it.**
>
> **I flagged this as a hazard in 008 P3-A. §0.2 has now measured it. It is real, it is bounded at 27
> days, and it is UNRESOLVABLE without a calendar that does not exist.**
>
> **The fix is correct. Its precondition is unverifiable.**

**And two measurements that have now been outstanding since audit 006, and remain undone:**

> **`oiUnit` for the live broker chain — UNKNOWN. If the broker reports units rather than contracts,
> every GEX number this platform has ever displayed is wrong by a factor of 65. One row of comparison —
> a single live chain row against the same-day bhavcopy row — settles it. It has been flagged in five
> audits and has still not been done.**
>
> **`data/vrp-monitor.json` — the one instrument that would directly observe the volatility risk premium,
> which is the entire thesis of this platform — contains ZERO entries. It has never recorded anything.**

**The single most time-critical item, and it is irreversible:**

> ## **Intraday option chains. One complete session exists — 2026-07-08, 375 minutes.**
>
> **They cannot be reconstructed after the fact. Every day the platform does not capture them is a day of
> evidence destroyed permanently — the same irreversible-debt class as the missing feature store (018).**

**The cheapest fix in this document, and it unblocks the 002 fix's own precondition:**

> ## **A TRADING CALENDAR. One file. Twenty-seven days become KNOWN, and `days[i-1]` becomes provable.**

---

**Strategies validated: NONE. Ingestion pipelines modified: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Data Source Inventory (Part 1) · Ingestion Pipeline (Part 2) · Ownership Matrix
(Part 3) · Ingestion Governance (Part 4) · **Data Provenance + first-ever dataset verification (§0,
Part 5)** · Distribution (Part 6) · Observability (Part 7) · Failure Modes (Part 8) · Architecture &
Contracts (Parts 9–10) · Testing Strategy (Part 11) · Maturity Assessment (Part 12) · Migration Roadmap
(Part 13) · Executive Summary.
