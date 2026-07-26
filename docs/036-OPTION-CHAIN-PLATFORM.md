# 036 — ENTERPRISE OPTION CHAIN PLATFORM, DERIVATIVES DATA & STRIKE LIFECYCLE

**Standard:** Master Prompt 036 · **Depends on:** 000-A … 035
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No strategy redesigned. No calculation modified.**

---

# SECTION 0 — 🔴 THE GREEKS CANNOT BE VERIFIED. THERE IS NO GROUND TRUTH.

**036's stop condition: *"Stop and report UNKNOWN if Greeks cannot be independently verified."***

## §0.1 — Measured: the exchange file carries **no Greeks and no IV**

```
  bt-data/bhav/nifty-*.csv    34 columns, all 600 files.

  Delta   : NOT PRESENT
  Gamma   : NOT PRESENT
  Theta   : NOT PRESENT
  Vega    : NOT PRESENT
  Rho     : NOT PRESENT
  IV      : NOT PRESENT
```

> ## **EVERY GREEK AND EVERY IMPLIED VOLATILITY IN THIS PLATFORM IS COMPUTED FROM A MODEL. NOT ONE IS OBSERVED.**

## §0.2 — And the platform has **two models that disagree**

*(Measured numerically in 035 §0.1, reproduced here because it is the core of this audit.)*

```js
gex-skew.js:18      function bsGamma(S, K, T, sigma, r = 0.065)
vol-context.js:42   function bsGamma(S, K, sigma, T)              // r = 0, implicit
```

```
  Identical inputs (S=24000, K=24500, T=7/365, σ=0.14):

    gex-skew.bsGamma      =  5.2547e-4
    vol-context.bsGamma   =  4.9206e-4
    ──────────────────────────────────
    DIVERGENCE            =  6.79%
```

**Both are reachable from `server.js` (`:25`, `:29`). Both feed the same dashboard.**
**And their parameter orders are SWAPPED — a copied call site costs **−92%** *(035 §0.2)*.**

## §0.3 — 🔴 **AND NOTHING CAN ADJUDICATE BETWEEN THEM**

> **There are no observed Greeks anywhere in this platform's data. Not in the bhavcopy. Not in
> `opt-candles` (which stores `[ts, o, h, l, c]` only). Not in `opthl`.**
>
> **Two models disagree by 6.79%, and there is no measurement in existence — inside this repository —
> that could tell you which one is closer to the truth.**
>
> ## **036's stop condition applies exactly: GREEKS — UNKNOWN. INDEPENDENTLY UNVERIFIABLE.**
>
> **036 also instructs: *"Document disagreements explicitly rather than choosing one implementation."***
> **That is the only honest action available, and this document is it.**

**The disagreement cannot be resolved by reading more code. It requires an external source of observed
Greeks — a broker feed that publishes them, or a validated reference implementation. Neither exists
here.**

---

# SECTION 1 — 🔴 `oiUnit`: SIX AUDITS OUTSTANDING, AND IT IS BLOCKED BY THE SAME APPROVAL

**The measurement has been flagged since audit 006 (A-13) and repeated in 011, 016, 031, 033 and 035:**

> **`gex-skew.js:32` documents its input as *"OI in contracts."*
> Constraint **F4** proved (5 NSE symbols) that **NSE bhavcopy OI is in UNITS.**
> **What unit does the LIVE BROKER CHAIN report? UNKNOWN.**
> **If it reports units, every GEX number this platform has ever displayed is wrong by 65×.**

## Why it still cannot be settled — measured

**The test requires one live chain row and the same-day bhavcopy row for the same strike and expiry.**

| Requirement | Status |
|---|---|
| A live chain snapshot **with OI** | 🔴 **`data/opt-candles` stores `[ts, o, h, l, c]` — NO OI.** `data/opthl` — no OI |
| A running server to fetch one | 🔴 **THE BOT IS DOWN** *(`INC-001`, 029 §0)* |
| A same-day bhavcopy | 🔴 **The archive ends 2026-06-17. Today is 2026-07-13** |

> ## **The single measurement that could reveal a 65× error in every GEX number this platform displays is blocked behind the same approval package as everything else — because restarting the bot today boots the NIFTY engine at 15 consecutive losses against a limit of 8** *(024 §0)*.
>
> **It is a five-minute measurement. It has been outstanding for six audits. And it cannot be taken.**

---

# SECTION 2 — 🟢 WHAT CHECKED OUT

**Two assumptions were tested and HELD. This is the second time in thirty-eight audits.**

## 🟢 §2.1 — ATM determination is **CORRECT**

```
  nifty-20250115.csv    underlying = 23,213.2

  atmStrike(step = 50)       →  23,200
  CLOSEST LISTED STRIKE      →  23,200      ✅ MATCH
  strike step in the chain   →  50          ✅ matches the assumed step
```

**`bt-lib.atmStrike()` and `instrument-registry`'s `strikeInterval: 50` both agree with what the
exchange actually lists.**

## 🟢 §2.2 — The chain structure is clean and symmetric

```
  expiry 2025-01-16   104 strikes   range 21350–26500   CE/PE = 104/104   80% traded
  expiry 2025-01-23    93 strikes   range 21350–25950   CE/PE =  93/93    82% traded
  expiry 2025-01-30   104 strikes   range 21350–26500   CE/PE = 104/104   84% traded
  expiry 2025-02-06    93 strikes   range 21350–25950   CE/PE =  93/93    43% traded
```

**Perfect CE/PE symmetry. No missing legs. No duplicate strikes. 18 expiries listed.**
**Near expiries trade at 80–84%; a further-dated expiry drops to 43% — consistent with 033 §0.2.**

---

# PART 1 — OPTION DATA INVENTORY

| Dataset | Source | Granularity | Owner | Validation | Confidence |
|---|---|---|---|---|---|
| 🟢 **Historical chain (bhavcopy)** | NSE UDiFF | daily, per-strike | `bt-lib` | 🟢 **VERIFIED (031, 033, §2)** | **HIGH** |
| **Live chain** | 6 connectors | polled | 🔴 **NOBODY** | 🔴 **`\|\| 0` × 119** | MEDIUM |
| **Strike history** | `public/strike-history.html` | daily | `server.js` | 🔴 none | MEDIUM |
| 🔴 **Option candles** | live | 1-min | `server.js` | 🔴 **8–30% delivery on 4 of 5 days** *(034 §0)* | **HIGH** |
| **Strike High/Low** | live | daily | `server.js` (`data/opthl`, **12 files**) | 🔴 raw write | MEDIUM |
| 🔴 **Greeks** | 🔴 **COMPUTED — 2 disagreeing models** | per request | 🔴 **NOBODY** | 🔴 **UNVERIFIABLE (§0)** | **HIGH** |
| 🔴 **Implied Volatility** | 🔴 **COMPUTED** (`option-analyzer._impliedVol`) | per request | 🔴 **NOBODY** | 🔴 **21.7% of live IVs are `ivSource: 'bsm'` — our own model, not the market's** | **HIGH** |
| 🔴 **Open Interest** | bhavcopy 🟢 / live chain 🔴 | daily / polled | 🔴 **NOBODY** | 🔴 **`oiUnit` UNKNOWN since audit 006 (§1)** | **HIGH** |
| **OI Change** | `free-chain.js` | polled | 🔴 none | 🔴 `\|\| 0` | MEDIUM |
| 🔴 **Bid / Ask** | ⚪ **DOES NOT EXIST** | — | — | 🔴 **No spread is modelled ANYWHERE. Fills are assumed at LTP** | HIGH |
| **LTP** | live chain | polled | connectors | 🔴 `\|\| 0` | MEDIUM |
| 🔴 **Volume** | bhavcopy 🟢 | daily | 🔴 **NOT MAPPED INTO `opts[]`** *(033 §0.5)* | 🔴 **INVISIBLE to every strategy** | HIGH |
| 🔴 **Expiry calendar** | ⚪ **DOES NOT EXIST** | — | — | 🔴 **`option-analyzer.js:654` hardcodes the weekday with `getDay()`** *(006 T-1)* | HIGH |
| 🔴 **Contract specifications** | `instrument-registry` 🟢 | — | 🟢 registry | 🔴 **`server.js` bypasses it 8×** *(006 N-1)* | HIGH |
| 🔴 **Lot-size history** | in the data | per-contract | 🔴 **NOBODY** | 🔴 **MODELLED AS PER-DAY, WHICH DOES NOT EXIST** *(032 §0)* | **HIGH** |
| 🔴 **Multi-index chains** | 🔴 **BHAVCOPY IS NIFTY-ONLY** | — | — | 🔴 **No SENSEX/BANKNIFTY history. F4-BSE cannot be settled** | **HIGH** |

## **Sixteen datasets. Two are verified. Four do not exist. Zero have an owner.**

---

# PART 2 — STRIKE LIFECYCLE

```
  Underlying ──▶ Strike Creation ──▶ Listing ──▶ Chain ──▶ Live Updates ──▶ Historical ──▶ Research ──▶ Replay ──▶ Expiry ──▶ Archive
      ↓               ↓                 ↓          ↓            ↓               ↓             ↓           ↓          ↓
      │               │                 │          │            │               │             │           │          └── 🟡 files kept
      │               │                 │          │            │               │             │           │              forever
      │               │                 │          │            │               │             │           └── 🔴 NO EXPIRY CALENDAR.
      │               │                 │          │            │               │             │               getDay() is hardcoded.
      │               │                 │          │            │               │             └── 🔴 REPLAY IMPOSSIBLE.
      │               │                 │          │            │               │                 No event store (022).
      │               │                 │          │            │               └── 🔴 the LOT is read from an
      │               │                 │          │            │                   ARBITRARY ROW (032 §0)
      │               │                 │          │            └── 🔴 8–30% capture (034 §0)
      │               │                 │          └── 🟢 CLEAN. 104 strikes, CE/PE symmetric (§2.2)
      │               │                 └── 🔴 NOT MODELLED. A new strike simply appears.
      │               └── 🔴 NOT MODELLED.
      └── 🟢 UndrlygPric (col 20) — 🔴 and it is the CLOSE, which caused every look-ahead.
```

## **Five of ten lifecycle stages are unmodelled or impossible.**

---

# PART 3 — OPTION CHAIN GOVERNANCE

| Aspect | Verdict |
|---|---|
| **Strike identification** | 🟢 `(expiry, strike, type)` — 🔴 **no contract ID; no versioning** |
| 🟢 **ATM determination** | 🟢 **VERIFIED CORRECT (§2.1)** |
| **ITM / OTM classification** | 🟡 Derived from ATM. Correct by construction |
| 🔴 **Expiry handling** | 🔴 **`nearExp = min(expiries ≥ date)`** — 🔴 **and `option-analyzer.js:654` hardcodes the expiry WEEKDAY with `getDay()`, bypassing the registry.** The project's own history records that NIFTY/SENSEX expiry weekdays were **SWAPPED** in `pop-seller` |
| **Weekly vs monthly** | 🔴 **NOT DISTINGUISHED. 18 expiries are treated as one undifferentiated list** |
| **Symbol normalization** | 🟢 One symbol per bhavcopy file · 🔴 **6 connectors normalize the live chain differently** |
| 🔴 **Contract versioning** | 🔴 **NONE — and 032 §0 is the consequence. A lot revision creates two coexisting contract generations, and nothing models it** |

---

# PART 4 — GREEKS GOVERNANCE

| Greek | Source | Formula | `r` | Validation |
|---|---|---|---|---|
| **Delta** | `option-analyzer._rawGreeks` | Black-Scholes | 🔴 **UNKNOWN owner** | 🔴 **UNVERIFIABLE (§0)** |
| 🔴 **Gamma** | 🔴 **`gex-skew.js:18` AND `vol-context.js:42`** | 🔴 **TWO Black-Scholes variants** | 🔴 **`0.065` vs `0` — 6.79% divergence** | 🔴 **UNVERIFIABLE** |
| **Theta** | `option-analyzer` | Black-Scholes | 🔴 UNKNOWN | 🔴 UNVERIFIABLE |
| **Vega** | `option-analyzer` | Black-Scholes | 🔴 UNKNOWN | 🔴 UNVERIFIABLE |
| **Rho** | ⚪ **NOT COMPUTED** | — | — | — |

## 🔴 **The risk-free rate `r` has no owner.**

```
  gex-skew.js:18     r = 0.065
  vol-context.js:41  "(r=0 index approximation)"   ← no rate term at all
```

**Two values. Two files. Both live. No ADR. No decision record. Nobody owns it.**
*(This is ADR-002, outstanding since audit 003.)*

## 036's instruction, followed

> ***"Document disagreements explicitly rather than choosing one implementation."***
>
> **The disagreement is documented here, quantified at 6.79%, and it is NOT resolved — because
> resolving it would require observed Greeks, and none exist (§0.3).**

---

# PART 5 — IMPLIED VOLATILITY GOVERNANCE

| Aspect | Verdict |
|---|---|
| **IV source** | 🔴 **COMPUTED, never observed.** The bhavcopy carries no IV column (§0.1) |
| **IV calculation** | `option-analyzer._impliedVol` (7 params) — Newton/bisection on Black-Scholes |
| 🔴 **Live IV** | 🔴 **21.7% of live IVs carry `ivSource: 'bsm'`** — **computed by us from our own model, not reported by the market** |
| 🔴 **Surface construction** | 🔴 **DOES NOT EXIST.** Blocked: intraday IV exists for **ONE complete session** *(034 §0)* |
| 🔴 **Missing IV handling** | 🔴 **`gex-skew.js:49` SUBSTITUTES A FABRICATED 0.14.** *(000-A: "Never invent market behaviour.")* |
| **Interpolation / smoothing** | 🔴 **NONE** |
| **Historical IV** | 🔴 **A proxy only** — `bt-validate`'s ATM-straddle / underlying |

## ## **036: *"Unknown IV must remain UNKNOWN."* → It does not. It becomes 0.14.**

---

# PART 6 — OPEN INTEREST GOVERNANCE

| Aspect | Verdict |
|---|---|
| **OI source (historical)** | 🟢 **NSE bhavcopy. 0% missing** *(033 §0.1)* |
| 🟢 **Units (historical)** | 🟢 **PROVEN: UNITS.** F4 — 5 NSE symbols, `docs/EVIDENCE-F4-oi-unit.md`. **Reproducible: `node scripts/verify-oi-unit.js`** |
| 🔴 **Units (LIVE BROKER CHAIN)** | 🔴 **UNKNOWN — SIX AUDITS OUTSTANDING (§1)** |
| 🔴 **Units (BSE / SENSEX)** | 🔴 **UNKNOWN — and unsettleable: the bhavcopy archive is NIFTY-ONLY** |
| 🔴 **Lot normalization** | 🔴 **`contracts = oi / lot` — and the LOT is read from an arbitrary row** *(032 §0)* |
| 🔴 **OI Change** | 🔴 `\|\| 0` |
| 🔴 **Historical consistency** | 🔴 **29.28% of rows have `OpnIntrst = 0`, and `0` is indistinguishable from `unknown` in the source** *(033 §0.6)* |

---

# PART 7 — OPTION DATA QUALITY

| Dimension | Verdict |
|---|---|
| 🟢 **Missing strikes** | 🟢 **NONE — CE/PE perfectly symmetric (§2.2)** |
| 🟢 **Duplicate strikes** | 🟢 **NONE** |
| 🟢 **Corrupted contracts** | 🟢 **NONE — 0 empty, 0 truncated** *(031 §0.1)* |
| 🟡 **Invalid timestamps** | 🟡 Date-only. TZ assumed, never declared |
| 🟢 **Expired contracts** | 🟢 Filtered: `exps ≥ date` |
| 🔴 **Broken chains** | 🔴 **27 unexplainable missing sessions** *(031 §0.2)* |
| 🔴 **Freshness (live)** | 🔴 **No consumer checks it** |
| 🔴 **Multi-index consistency** | 🔴 **IMPOSSIBLE — the archive is NIFTY-ONLY** |

---

# PART 8 — OBSERVABILITY

| Required per option record | Recorded? |
|---|---|
| Underlying · Strike · Type · Expiry | 🟢 **YES** |
| Timestamp | 🟢 `TradDt` |
| **Version** | 🔴 **NO** |
| **Source** | 🔴 **NO** |
| **Validation status** | 🔴 **NO** |
| **Provenance** | 🔴 **NO** |

## **5 of 9. *"Option records without provenance are unsuitable for research."***

---

# PART 9 — FAILURE MODE REGISTER

| ID | Failure | Present? | Impact |
|---|---|---|---|
| **OC-1** | 🔴 **Greeks computed from 2 disagreeing models, with NO ground truth to adjudicate** | 🔴 **CONFIRMED (§0)** | 🔴 **CRITICAL. UNRESOLVABLE from within the repository** |
| **OC-2** | 🔴 **`oiUnit` UNKNOWN — a potential 65× error in every GEX** | 🔴 **CONFIRMED — 6 audits (§1)** | 🔴 **CRITICAL. And blocked behind the same approval** |
| **OC-3** | 🔴 **Incorrect lot — read from an arbitrary row** | 🔴 **CONFIRMED — 27 of 600 days** *(032 §0)* | 🔴 **CRITICAL** |
| **OC-4** | 🔴 **A fabricated IV of 0.14** | 🔴 **CONFIRMED — `gex-skew.js:49`** | 🔴 **CRITICAL** |
| **OC-5** | 🔴 **Expiry weekday hardcoded via `getDay()`, bypassing the registry** | 🔴 **CONFIRMED** | 🔴 **HIGH — the exact bug that SWAPPED NIFTY/SENSEX expiry in `pop-seller`** |
| **OC-6** | 🔴 **No bid/ask. Fills assumed at LTP** | 🔴 **CONFIRMED** | 🔴 **HIGH — every backtest and paper fill is optimistic** |
| **OC-7** | 🔴 **Incomplete chains — 8–30% intraday capture** | 🔴 **CONFIRMED** *(034 §0)* | 🔴 **CRITICAL, IRREVERSIBLE** |
| **OC-8** | 🔴 **Multi-index: the archive is NIFTY-ONLY** | 🔴 **CONFIRMED** | 🔴 **HIGH. SENSEX/BANKNIFTY strategies have NO historical data** |
| 🟢 **OC-9** | **Wrong ATM · missing strikes · duplicates · corrupt contracts** | 🟢 **NOT PRESENT — verified (§2)** | 🟢 |

---

# PART 10 & 11 — OPTION PLATFORM ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   ContractRegistry  ★★★   THE PRIMITIVE 032 §0 PROVED IS MISSING.
     contract = (symbol, expiry, strike, type)
     🔴 lot(contract)  — from THE CONTRACT'S OWN ROW. Never from a day.
     🔴 A lot revision creates TWO COEXISTING CONTRACT GENERATIONS. Model it.  → OC-3

   GreeksEngine  ★   ONE Black-Scholes. ONE `r`, owned by an ADR (ADR-002, outstanding since 003).
     🔴 GUARDED BY A CROSS-IMPLEMENTATION EQUIVALENCE TEST — the only thing that
        prevents a second bsGamma reappearing.
     🔴 AND: THE DISAGREEMENT CANNOT BE RESOLVED WITHOUT OBSERVED GREEKS.
        Acquire them, or declare every Greek MODELLED and UNVALIDATED. Do not pretend. → OC-1

   IVEngine  ★   🔴 A MISSING IV IS `null`. NEVER 0.14.
                 🔴 `ivSource` is MANDATORY: 'observed' | 'bsm' | null.
                    (21.7% are already 'bsm' — the field exists and is honest. USE IT.)

   OIEngine  ★   🔴 `oiUnit` IS A MANDATORY FIELD in the chain contract.
                 A required field makes the question UN-SKIPPABLE.
                 It has been skippable for six audits.                            → OC-2

   ExpiryCalendar  ★  Weekly vs monthly. Per-instrument weekday. FROM THE REGISTRY.
                      🔴 getDay() is hardcoded, and it has ALREADY caused a swapped-expiry bug. → OC-5
```

## The rule §0 establishes

> **A computed Greek is a model output, not a measurement. Two models that disagree by 6.79% are not a
> bug to be fixed by picking one — they are an admission that the platform has never observed the
> quantity it is publishing.**

---

# PART 12 — TESTING STRATEGY

| Test | Priority | Would it fail today? |
|---|---|---|
| 🔴 **`gex-skew.bsGamma` == `vol-context.bsGamma`** *(equivalence test)* | **P0 — §0.2** | ✅ **FAILS — 6.79% apart** |
| 🔴 **`oiUnit` — one live chain row vs the same-day bhavcopy row** | **P0 — §1** | 🔴 **CANNOT BE RUN — the bot is down** |
| 🔴 **The lot comes from the CONTRACT'S row** | **P0 — OC-3** | ✅ **FAILS — 27 of 600 days** |
| 🔴 **A missing IV yields `null`, never 0.14** | **P0 — OC-4** | ✅ **FAILS** |
| 🔴 **The expiry weekday comes from the registry, not `getDay()`** | **P0 — OC-5** | ✅ **FAILS** |
| 🟢 **`atmStrike()` equals the closest listed strike** | **P0** | 🟢 **PASSES (§2.1). LOCK IT IN** |
| 🟢 **CE/PE symmetry; no duplicate strikes** | P1 | 🟢 **PASSES (§2.2). Lock it in** |
| **Historical replay of a chain** | P1 | ✅ FAILS — no event store |

**Five P0 tests fail. One cannot be run. Two pass and must be locked in.**

---

# PART 13 — OPTION PLATFORM MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Raw Option Data** | 🟢 | 600 days of exchange bhavcopy |
| **1 — Managed Option Chains** | 🟡 **PARTIAL** | 🟢 **ATM correct. CE/PE symmetric. No duplicates. Expiry filtering works** · 🔴 **No contract registry. No expiry calendar. The lot is misaligned** |
| **2 — Validated Derivatives Platform** | 🔴 **NO** | 🔴 **Greeks UNVERIFIABLE. IV fabricated. `oiUnit` UNKNOWN** |
| **3 — Scientific Option Platform** | 🔴 **NO** | 🔴 **No replay. No provenance. NIFTY-only** |
| **4 — Enterprise Derivatives Platform** | 🔴 **NO** | — |
| **5 — Institutional-Grade** | 🔴 **NO** | 🔴 **No bid/ask, no order book, no tick data — UNOBSERVABLE from current sources** |

## ## **Option Platform: LEVEL 0–1 — RAW DATA / partially managed.**

---

# PART 14 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE.** **§0: the Greeks are unverifiable. §2: ATM and chain structure VERIFIED CORRECT** | — | none | 16 datasets · 2 verified · 4 absent |
| **2 — Governance** | 🔴 **MEASURE `oiUnit`** *(§1 — 5 minutes, blocked on the bot)*. 🔴 **A `ContractRegistry`: `lot(contract)`** *(032)*. 🔴 **An expiry calendar from the registry** | 🔒 **B-3 + S-01 — the bot must be restartable** | **Low** | 🔴 **A potential 65× GEX error is resolved, one way or the other** |
| **3 — Scientific validation** | 🔴 **ONE `bsGamma`, ONE `r`, guarded by an equivalence test** *(ADR-002)*. 🔴 **A missing IV becomes `null`, never 0.14** | Phase 2 | 🔴 **BEHAVIOUR CHANGE — every GEX number moves. Approval** | **One Greeks engine. Every IV honest about its source** |
| **4 — Enterprise** | 🔴 **CAPTURE INTRADAY CHAINS PROPERLY** *(034 — 8–30% today, IRREVERSIBLE)*. Multi-index history | Phase 3 | **Time. Irreversible if delayed** | **A chain can be replayed** |
| **5 — Institutional** | ⚪ **BLOCKED — bid/ask, order book and tick data are UNOBSERVABLE from a REST broker feed.** *Declare the ceiling; do not pretend to cross it* | — | — | **The limit is documented, not fabricated** |

---

# PART 15 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every option dataset has one owner | 🔴 **NO — ZERO have an owner** |
| **Strike lifecycle is deterministic** | 🟡 **ATM and chain structure: VERIFIED 🟢. Contract/lot lifecycle: WRONG 🔴** |
| **Greeks are reproducible** | 🟡 **Reproducible from the code, yes. VERIFIABLE against reality — NO. There is no ground truth (§0)** |
| **IV assumptions are documented** | 🔴 **NO — and a fabricated 0.14 is substituted for a missing one** |
| **OI normalization is evidence-based** | 🟡 **Historical: YES 🟢 (F4).** 🔴 **Live: UNKNOWN — six audits** |
| Historical chains are replayable | 🔴 **NO — no event store** |
| **Unknown option properties are never silently inferred** | 🔴 **NO — a fabricated IV, an arbitrary lot, an assumed `oiUnit`** |

## **1 of 7.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent derivatives engineer reconstruct any historical chain, reproduce the
Greeks and IV, validate strike continuity, verify lot-size evolution, and confirm OI normalization?**

## **Strike continuity: yes, and it is CORRECT. Everything else: no — and the Greeks cannot be verified by anyone, from anything in this repository.**

🟢 **What is genuinely right, and was tested:**

> **The ATM determination is correct: on a day when NIFTY closed at 23,213.2, `atmStrike(step=50)`
> returns 23,200 — and 23,200 is exactly the closest strike the exchange actually listed. The chain's
> strike step is 50, precisely as `instrument-registry` assumes.**
>
> **The chain structure is clean: 104 strikes, perfect CE/PE symmetry, no duplicates, 18 expiries, and
> correct filtering of expired contracts.**
>
> **This is the second assumption in thirty-eight audits that was checked and HELD.**

🔴 **And the finding that this entire prompt exists to surface:**

> ## **THE NSE BHAVCOPY CARRIES NO GREEKS AND NO IMPLIED VOLATILITY. Thirty-four columns, and not one of them is a Delta, a Gamma, a Theta, a Vega or an IV.**
>
> ## **EVERY GREEK AND EVERY IV IN THIS PLATFORM IS COMPUTED FROM A MODEL. NOT ONE IS OBSERVED.**
>
> **And the platform has TWO models. `gex-skew.js` uses `r = 0.065`. `vol-context.js` uses `r = 0`. Fed
> an identical market state, they disagree by **6.79%** — and their parameter orders are swapped, so a
> single copied call site costs **92%**.**
>
> **Both are reachable from `server.js`. Both feed the same dashboard.**
>
> ## **And there is NO measurement anywhere in this repository that could tell you which one is closer to the truth. Not in the bhavcopy. Not in `opt-candles`. Not in `opthl`. Nowhere.**
>
> **036's stop condition is explicit: *"Stop and report UNKNOWN if Greeks cannot be independently
> verified."* And its instruction is equally explicit: *"Document disagreements explicitly rather than
> choosing one implementation."***
>
> **This document is that. The disagreement is quantified, and it is NOT resolved — because resolving it
> honestly requires observed Greeks, and the platform has never acquired any.**

**And the one measurement that could settle a 65× error, still outstanding after six audits:**

> **`gex-skew.js:32` says its input is *"OI in contracts."* Constraint F4 proved the NSE bhavcopy reports
> OI in **units**. What the live broker chain reports is **UNKNOWN** — and if it is units, every GEX
> number this platform has ever displayed is wrong by a factor of sixty-five.**
>
> **The test is one live chain row against the same-day bhavcopy row. Five minutes.**
>
> **It cannot be run. `data/opt-candles` stores `[ts, o, h, l, c]` and no OI. The bhavcopy archive ends
> 2026-06-17. And the bot is down — because restarting it today boots the NIFTY engine at fifteen
> consecutive losses against a limit of eight.**
>
> ## **A five-minute measurement that could invalidate every GEX number on the dashboard is blocked behind the same approval package as everything else in this thirty-eight-document programme.**

---

**Strategies redesigned: NONE. Calculations modified: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Option Dataset Inventory (Part 1) · Strike Lifecycle (Part 2) · Chain Governance
(Part 3) · **Greeks Review (§0, Part 4)** · IV Assessment (Part 5) · **OI Assessment (§1, Part 6)** ·
Data Quality (Part 7) · Observability (Part 8) · Failure Modes (Part 9) · Platform Blueprint
(Parts 10–11) · Testing Strategy (Part 12) · Maturity Assessment (Part 13) · Migration Roadmap
(Part 14) · Executive Summary.
