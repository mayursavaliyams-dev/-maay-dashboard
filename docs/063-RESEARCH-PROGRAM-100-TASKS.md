# 063 — ANTIGRAVITY PRO Institutional Research Program: 100 Tasks

**Chief Research Director · Chief Quantitative Scientist · Chief Market Microstructure
Researcher · Chief AI Architect · Chief Risk Scientist · Chief Institutional Systems Architect**

**Date:** 2026-07-29 · **Status:** ROADMAP — research program design
**No production code. No BUY/SELL. No trade recommendations.**
**Assume nothing. Verify everything. Unknown remains Unknown.**

---

# Part 0 — Preamble: three controls that make this program honest

## 0.1 The citation control

**I cannot retrieve documents from this environment.** I therefore will not produce
a single SEBI circular number, NSE document ID, DOI, page number or publication date
that I have not verified. Fabricated precision is worse than acknowledged absence,
because it is *believed*.

The program handles this by making **citation retrieval a tracked state**, not an
assumption:

| Citation state | Meaning |
|---|---|
| `NOT_RETRIEVED` | The authoritative document class is identified; nobody has fetched it |
| `RETRIEVED` | Document obtained, archived with a hash and retrieval date |
| `EXTRACTED` | The specific claim has been located inside it, quoted with locator |
| `SUPERSEDED` | A later circular replaces it — the replacement is linked |

**Every source field in every task below starts at `NOT_RETRIEVED`.** No task may
be marked complete while any load-bearing source is still in that state. Where I
name an academic work from knowledge, I attach my own confidence and the same rule
applies: it must be verified against the actual paper before use.

This is the single most important control in the document.

## 0.2 The evidence-grade control

Six categories. **Never merged. Never averaged. Never rounded into one another.**

| Grade | Definition | Test |
|---|---|---|
| **Verified** | Established from a primary authoritative source, retrieved and quoted | Can I point to the document and the line? |
| **Measured** | Computed from data in our possession, method stated | Can someone re-run it and get the same number? |
| **Estimated** | Derived under stated assumptions from partial evidence | Are the assumptions written down and falsifiable? |
| **Hypothesis** | A proposition formulated for testing, not yet tested | Is the test pre-registered? |
| **Opinion** | Professional judgement or practitioner convention | Is it labelled as such and reversible? |
| **Unknown** | Not established | Is the resolution condition written down? |

**An Unknown without a resolution condition is a research backlog item nobody wrote
down.** Every Unknown in this program carries "what would resolve this".

## 0.3 The starting ground truth

This program does **not** start from zero. Docs 060–062 established the following
against this system's own data. **Grade: Measured**, 2026-07-29.

| Fact | Value |
|---|---|
| Archived sessions | 13 |
| **Sessions missing the market open** | **12 of 13** (61–358 minutes each) |
| Complete sessions | **1** (2026-07-08) |
| Stored per strike | `[t, o, h, l, c]` — **premium only** |
| IV, OI, volume, depth, greeks stored | **None** — observed live, discarded |
| **Index spot price history stored** | **None** — `candles.json`, `prices.json` are 0 KB |
| Archive retention | Auto-deleted past **40 files** |
| Chain observed | A **±10% window**, not the listed universe (NIFTY: 93 strikes) |
| Sampling | 60 s nominal, **86.2 s mean, 2,520 s max gap** |
| Tick size | ₹0.05 — **3.7% of a ₹1.35 option** |
| Strikes that never moved (2026-07-29) | **70 of 662** |
| Dealer sign | **Assumed** by convention (`gex-skew.js:33`), not measured |
| Participant identity per strike | **Not available in any field** |

---

# Part 1 — Gate G0: why the program cannot start at Phase 1 empirically

**Sixty-one of the hundred tasks below require time-series data this system is not
currently keeping.**

Desk research — exchange rules, regulation, contract specifications, literature —
requires no data and can begin immediately. Empirical research cannot.

## G0 — Preconditions (not counted among the 100; they are infrastructure, not research)

| # | Precondition | Blocks | Severity |
|---|---|---|---|
| **G0.1** | Collector runs 09:15–15:30 every session | 61 tasks | **S1** |
| **G0.2** | Session coverage alert below 95% | Silent regression of G0.1 | **S1** |
| **G0.3** | Persist index spot series | All 20 empirical price tasks | **S1** |
| **G0.4** | Persist per-strike `iv, ivSource, oi, volume, bid, ask, bidQty, askQty, greeks` | All option-structure tasks | **S2, time-critical** |
| **G0.5** | Lift the 40-file retention cap | All multi-month tasks | **S2, time-critical** |
| **G0.6** | Bitemporal storage: record *when we learned* a value, not only what it was | Point-in-time correctness (T074, T087) | **S2** |

> **The asymmetry that makes G0 urgent:** price history can be re-fetched from a
> broker. **Option-chain state cannot.** Where the OI walls stood at 11:00 last
> Tuesday is gone permanently. Every day G0.4 is deferred is a day removed from the
> future evidence base of this entire program.

---

# Part 2 — The task template

Each task carries all 24 fields. Fully instantiated examples are in Part 4; the
complete 100-task register is Part 3 in compact form, which carries the fields that
drive sequencing and cost.

```
Task ID · Objective · Research Questions · Required Data
Official / Academic / Exchange / SEBI / NSE / BSE sources · Research papers
Validation Method · Limitations · Unknowns
Measured Facts · Estimated Facts · Opinions
Deliverables · Priority · Dependencies
Research Complexity · Engineering Complexity · Data Requirements · Risk Level
Future Extensions
```

Complexity is 1–5. **Risk Level** means *risk of producing a confident wrong answer*,
not operational risk — the failure mode this program exists to prevent.

---

# Part 3 — The 100-task register

Legend — **P**riority: `P0` blocking · `P1` high · `P2` normal · `P3` opportunistic.
**RC/EC**: research / engineering complexity 1–5. **RL**: risk of confident error 1–5.
**Data**: `DESK` (no data), `LIVE`, `HIST` (needs G0), `EXT` (external data purchase/access).

## Phase 1 — Market Structure

| ID | Task | P | RC | EC | RL | Data | Deps |
|---|---|---|---|---|---|---|---|
| **T001** | Contract specification census: all six index option instruments — lot, tick, strike interval, expiry weekday, settlement type, freeze quantity | P0 | 2 | 1 | 3 | DESK | — |
| **T002** | Expiry architecture: weekly/monthly cycle, historical changes to expiry weekdays, and the dates each change took effect | P0 | 2 | 1 | **4** | DESK | T001 |
| **T003** | Settlement mechanics: final settlement price computation, exercise, STT treatment on exercised options | P0 | 3 | 1 | **4** | DESK | T001 |
| **T004** | Session structure: pre-open, continuous, closing session, special sessions, and their effect on the first and last observations | P1 | 2 | 1 | 2 | DESK | — |
| **T005** | **Participant taxonomy**: what participant-category data exists, at what granularity and latency — the definitive answer to "can we ever classify institutional vs retail?" | **P0** | 3 | 1 | **5** | DESK | — |

## Phase 2 — Exchange Rules

| ID | Task | P | RC | EC | RL | Data | Deps |
|---|---|---|---|---|---|---|---|
| **T006** | Margin framework: SPAN + exposure/ELM, calendar spread margin, cross-margin | P0 | 4 | 2 | **4** | DESK | T001 |
| **T007** | Peak margin and intraday margin reporting rules; implications for intraday capital | P1 | 3 | 1 | 3 | DESK | T006 |
| **T008** | Position limits: client, trading member, market-wide; and how they bind at our capital scale | P1 | 2 | 1 | 3 | DESK | T001 |
| **T009** | Price bands, circuit filters and the option price band mechanism | P1 | 3 | 1 | **4** | DESK | — |
| **T010** | Regulatory timeline: every SEBI/exchange change materially affecting index derivatives, with effective dates | **P0** | 3 | 2 | **5** | DESK | T001–T009 |

## Phase 3 — Order Book

| ID | Task | P | RC | EC | RL | Data | Deps |
|---|---|---|---|---|---|---|---|
| **T011** | Order types, matching rules, price-time priority, and their microstructure consequences | P1 | 3 | 1 | 2 | DESK | — |
| **T012** | Data product census: tick-by-tick vs snapshot, latency, cost, historical depth — what is purchasable | **P0** | 2 | 1 | 3 | DESK/EXT | — |
| **T013** | Order-to-trade ratio penalties, algo approval regime, and the SEBI white-box requirements | P1 | 3 | 1 | **4** | DESK | T010 |
| **T014** | Market-maker and liquidity-enhancement schemes on index options: existence, terms, and who quotes | P2 | 3 | 1 | 3 | DESK | — |
| **T015** | **Order-book depth availability**: what Level-2 can be obtained, at what refresh, and the limits — resolves the "market depth unavailable" finding in docs/058 | **P0** | 2 | 2 | 3 | DESK/EXT | T012 |

## Phase 4 — Liquidity

| ID | Task | P | RC | EC | RL | Data | Deps |
|---|---|---|---|---|---|---|---|
| **T016** | Spread taxonomy for index options: quoted, effective, realised — definitions and estimators | P1 | 3 | 2 | 3 | HIST | G0.4 |
| **T017** | Depth and resilience: quoted size, replenishment after trades | P2 | 4 | 3 | **4** | EXT | T015 |
| **T018** | Price-impact estimation (Kyle λ, Amihud) for index options; feasibility given available data | P2 | **5** | 3 | **4** | HIST/EXT | T016 |
| **T019** | The liquidity surface: spread and depth across moneyness × time-to-expiry | P1 | 3 | 3 | 3 | HIST | T016 |
| **T020** | Intraday liquidity seasonality; expiry-day liquidity behaviour | P1 | 3 | 2 | 3 | HIST | T016, G0.1 |

## Phase 5 — Option Pricing

| ID | Task | P | RC | EC | RL | Data | Deps |
|---|---|---|---|---|---|---|---|
| **T021** | Model selection: Black-Scholes-Merton vs Black-76 for Indian index options — which is correct and why | **P0** | 4 | 2 | **5** | DESK | T001, T003 |
| **T022** | Rate and carry inputs: which risk-free curve, dividend treatment for index options | P0 | 3 | 2 | **4** | DESK | T021 |
| **T023** | IV inversion: numerical method, convergence, behaviour at deep OTM/ITM and near expiry | P0 | 4 | 3 | **4** | LIVE | T021, T022 |
| **T024** | **Put-call parity as a data-integrity test** on every captured chain | P1 | 2 | 2 | 2 | LIVE | T021 |
| **T025** | Terminal-hour pricing: where the model breaks as T→0 on expiry day | P1 | **5** | 3 | **5** | HIST | T023, G0.1 |

## Phase 6 — Greeks

| ID | Task | P | RC | EC | RL | Data | Deps |
|---|---|---|---|---|---|---|---|
| **T026** | Greek reconciliation: vendor-supplied vs independently computed, with tolerance bands | **P0** | 3 | 3 | **4** | LIVE | T023 |
| **T027** | Second-order exposures: vanna, charm, vomma — definitions, units, and whether they are computable here | P2 | 4 | 3 | 3 | LIVE | T026 |
| **T028** | Aggregation convention: net chain exposure, units (₹ per 1% move), lot and multiplier handling | **P0** | 3 | 2 | **5** | LIVE | T026, T001 |
| **T029** | Greek stability at low premium and near expiry; interaction with the ₹0.05 tick | P1 | 4 | 2 | **4** | HIST | T026 |
| **T030** | Delta-hedging cost model under Indian cost structure | P2 | 4 | 3 | **4** | HIST | T028, T061 |

## Phase 7 — Volatility

| ID | Task | P | RC | EC | RL | Data | Deps |
|---|---|---|---|---|---|---|---|
| **T031** | Realised-volatility estimator comparison for Indian indices (close-close, Parkinson, Garman-Klass, Rogers-Satchell, Yang-Zhang) | P1 | 3 | 2 | 3 | HIST | G0.3 |
| **T032** | **India VIX**: construction methodology, what it measures, and its documented limits | **P0** | 3 | 1 | **4** | DESK | — |
| **T033** | Volatility term structure across weekly expiries | P1 | 4 | 3 | **4** | HIST | G0.4 |
| **T034** | The volatility surface: skew and smile shape, stability, and parameterisation | P1 | 4 | 3 | **4** | HIST | T023, T033 |
| **T035** | **Variance risk premium** measurement for Indian indices, net of costs | **P0** | 4 | 3 | **5** | HIST | T031, T032, T061 |

## Phase 8 — Dealer Positioning

| ID | Task | P | RC | EC | RL | Data | Deps |
|---|---|---|---|---|---|---|---|
| **T036** | **Dealer-sign feasibility**: can customer/market-maker separation be established for Indian index options from any obtainable source? Definitive answer | **P0** | 3 | 1 | **5** | DESK/EXT | T005, T012 |
| **T037** | GEX methodology audit: sign convention, units, and sensitivity of every conclusion to the assumption | **P0** | 3 | 2 | **5** | LIVE | T036, T028 |
| **T038** | Alternative dealer-inventory proxies constructible from available Indian data | P2 | **5** | 3 | **5** | HIST | T036 |
| **T039** | Cross-market comparison: what CBOE open-close data enables that Indian data does not | P2 | 2 | 1 | 2 | DESK | T036 |
| **T040** | **Replication**: test published pinning findings on NSE/BSE index data | P1 | **5** | 4 | **4** | HIST | T036, T081 |

## Phase 9 — Strike Intelligence

| ID | Task | P | RC | EC | RL | Data | Deps |
|---|---|---|---|---|---|---|---|
| **T041** | Strike activity taxonomy and eligibility gates — formalises docs/060 | P1 | 3 | 3 | **4** | HIST | G0.4 |
| **T042** | Strike lifecycle empirics in expiry-relative time — formalises docs/061 | P1 | 4 | 4 | **4** | HIST | T041, G0.1 |
| **T043** | **Gravity null model**: moneyness-matched, round-number-controlled baseline — formalises docs/062 | **P0** | **5** | 4 | **5** | HIST | T041, G0.3 |
| **T044** | Round-number vs strike-listing confound isolation | P1 | 4 | 3 | **5** | HIST | T043 |
| **T045** | **Max pain**: empirical test against the null on Indian data | P2 | 3 | 3 | **5** | HIST | T043 |

## Phase 10 — Market Memory

| ID | Task | P | RC | EC | RL | Data | Deps |
|---|---|---|---|---|---|---|---|
| **T046** | Historical reaction zones: definition, detection, and significance testing | P2 | 4 | 3 | **5** | HIST | G0.3, T043 |
| **T047** | Prior-session extremes: are they statistically distinguishable from arbitrary levels? | P2 | 3 | 2 | **4** | HIST | G0.3 |
| **T048** | Volatility clustering: GARCH-family fit and diagnostics for Indian indices | P1 | 3 | 3 | 3 | HIST | T031 |
| **T049** | Long memory / Hurst in index returns and option premia | P3 | 4 | 3 | **4** | HIST | T031 |
| **T050** | Intraday seasonality and the U-shape in volume, spread and volatility | P1 | 3 | 2 | 3 | HIST | G0.1 |

## Phase 11 — Market Regime

| ID | Task | P | RC | EC | RL | Data | Deps |
|---|---|---|---|---|---|---|---|
| **T051** | Regime taxonomy: volatility, trend and liquidity regimes — definitions before detection | **P0** | 3 | 2 | **4** | DESK | T031 |
| **T052** | Regime detection methods and their look-ahead hazards (HMM, changepoint, threshold) | P1 | 4 | 4 | **5** | HIST | T051, T072 |
| **T053** | Regime persistence and transition statistics | P1 | 3 | 3 | **4** | HIST | T052 |
| **T054** | Event calendar effects: policy, budget, elections, offshore macro | P1 | 3 | 2 | **4** | DESK/HIST | T010 |
| **T055** | Regime-conditional variance risk premium | P1 | 4 | 3 | **5** | HIST | T035, T053 |

## Phase 12 — Portfolio Risk

| ID | Task | P | RC | EC | RL | Data | Deps |
|---|---|---|---|---|---|---|---|
| **T056** | SPAN margin replication: feasibility and error bounds | P1 | **5** | 4 | **5** | DESK | T006 |
| **T057** | Portfolio greek aggregation and netting across instruments and expiries | P1 | 3 | 3 | **4** | LIVE | T028 |
| **T058** | Tail risk: extreme value theory applied to Indian index gaps | P1 | 4 | 3 | **4** | HIST | G0.3 |
| **T059** | Stress scenarios calibrated to actual Indian market history | **P0** | 3 | 3 | **4** | HIST | T058 |
| **T060** | Sizing under margin constraints: fractional Kelly, and where it fails | P1 | 4 | 3 | **5** | DESK/HIST | T056, T058 |

## Phase 13 — Execution Risk

| ID | Task | P | RC | EC | RL | Data | Deps |
|---|---|---|---|---|---|---|---|
| **T061** | **Complete cost schedule**: brokerage, STT (incl. exercise), exchange charges, stamp duty, GST, SEBI fees — current and dated | **P0** | 2 | 2 | **5** | DESK | T010 |
| **T062** | Slippage measurement methodology from our own fills | P1 | 3 | 3 | **4** | HIST | T061 |
| **T063** | Spread as a share of premium on cheap options; the economics of sub-₹20 strikes | **P0** | 2 | 2 | **4** | HIST | T016, T061 |
| **T064** | Expiry-day execution hazards: gaps, spread widening, freeze quantity | P1 | 3 | 2 | **4** | HIST | T063 |
| **T065** | Operational failure modes: rejections, disconnects, partial fills | P1 | 2 | 3 | 3 | LIVE | — |

## Phase 14 — Risk Management

| ID | Task | P | RC | EC | RL | Data | Deps |
|---|---|---|---|---|---|---|---|
| **T066** | Halt and kill-switch design principles; audit of the existing halt invariant | **P0** | 3 | 2 | **5** | DESK | — |
| **T067** | Drawdown control methods and the evidence for each | P1 | 3 | 2 | **4** | DESK/HIST | T060 |
| **T068** | Concentration and position-limit governance at our capital scale | P1 | 2 | 2 | 3 | DESK | T008, T060 |
| **T069** | **Operational risk from data outages** — 12 of 13 sessions missing the open is the live example | **P0** | 2 | 3 | **4** | Measured | G0.1, G0.2 |
| **T070** | Model risk governance: pre-agreed conditions for withdrawing trust in a model | **P0** | 3 | 1 | **5** | DESK | T083 |

## Phase 15 — Machine Learning

| ID | Task | P | RC | EC | RL | Data | Deps |
|---|---|---|---|---|---|---|---|
| **T071** | Label design for non-directional market-structure tasks | P1 | 4 | 3 | **5** | DESK | T051 |
| **T072** | **Leakage taxonomy** and automated detection; extend the existing look-ahead test suite | **P0** | 4 | 4 | **5** | HIST | — |
| **T073** | Time-series cross-validation: purged and embargoed splits | **P0** | 4 | 3 | **5** | DESK | T072 |
| **T074** | Feature store with point-in-time correctness | P1 | 4 | **5** | **5** | HIST | G0.6 |
| **T075** | Evaluation beyond accuracy: calibration curves, reliability diagrams, Brier score | P1 | 3 | 3 | **4** | HIST | T073 |

## Phase 16 — Statistical Validation

| ID | Task | P | RC | EC | RL | Data | Deps |
|---|---|---|---|---|---|---|---|
| **T076** | Multiple-testing framework across the whole research programme, not per study | **P0** | 4 | 2 | **5** | DESK | — |
| **T077** | Deflated Sharpe ratio and probability of backtest overfitting | P1 | 4 | 3 | **5** | DESK/HIST | T076 |
| **T078** | Bootstrap methods for dependent data; block and stationary bootstrap | P1 | 4 | 3 | **4** | DESK | T076 |
| **T079** | **Power analysis**: minimum sample per claimed effect — how many sessions before any claim is possible | **P0** | 4 | 2 | **5** | DESK | T076 |
| **T080** | **Pre-registration protocol**: hypotheses and thresholds fixed before outcomes are examined | **P0** | 2 | 2 | **5** | DESK | T076 |

## Phase 17 — Research Validation

| ID | Task | P | RC | EC | RL | Data | Deps |
|---|---|---|---|---|---|---|---|
| **T081** | Replication protocol for external findings on Indian data, including the transfer question | **P0** | 3 | 2 | **5** | DESK | T076 |
| **T082** | **Negative-results register**: disproved hypotheses recorded permanently and published internally | **P0** | 1 | 2 | 2 | DESK | — |
| **T083** | Evidence-grade governance: assignment rules, audit, and appeal | **P0** | 2 | 2 | **4** | DESK | — |
| **T084** | Adversarial review: a standing reviewer whose job is to refute, not confirm | P1 | 2 | 1 | 3 | DESK | T083 |
| **T085** | Reproducibility: data snapshots, seeds, environment capture, result hashing | **P0** | 2 | 4 | **4** | DESK | G0.6 |

## Phase 18 — Institutional Architecture

| ID | Task | P | RC | EC | RL | Data | Deps |
|---|---|---|---|---|---|---|---|
| **T086** | Data warehouse architecture: raw-immutable through derived layers | **P0** | 3 | **5** | **4** | DESK | G0.4 |
| **T087** | Bitemporal data model: valid time and knowledge time | **P0** | 4 | **5** | **5** | DESK | G0.6 |
| **T088** | Module registry and navigation architecture — docs/059 | P1 | 2 | 4 | 3 | DESK | — |
| **T089** | Compute and storage budget over a 10-year horizon | P1 | 2 | 3 | 3 | DESK | T086 |
| **T090** | Change governance and the audit trail | P1 | 2 | 3 | **4** | DESK | T083 |

## Phase 19 — System Audit

| ID | Task | P | RC | EC | RL | Data | Deps |
|---|---|---|---|---|---|---|---|
| **T091** | Data-integrity audit: coverage, gaps, corruption, silent truncation | **P0** | 2 | 3 | **4** | Measured | G0.2 |
| **T092** | Numerical audit: greeks, IV inversion, aggregation, rounding | **P0** | 3 | 3 | **5** | LIVE | T026, T028 |
| **T093** | Security and credential audit | P1 | 2 | 3 | **4** | DESK | — |
| **T094** | Regulatory compliance audit against current algo/white-box requirements | **P0** | 3 | 2 | **5** | DESK | T013 |
| **T095** | **Independent reproduction of every published internal claim** | **P0** | 3 | 4 | **5** | HIST | T085, T083 |

## Phase 20 — Final Blueprint

| ID | Task | P | RC | EC | RL | Data | Deps |
|---|---|---|---|---|---|---|---|
| **T096** | Institutional Research Blueprint | P1 | 3 | 2 | 3 | — | T001–T095 |
| **T097** | Market knowledge graph + data, mathematical, risk and feature dependency graphs | P1 | 3 | 4 | 3 | — | T096 |
| **T098** | AI architecture blueprint | P1 | 4 | 4 | **4** | — | T071–T075 |
| **T099** | Validation blueprint | P1 | 3 | 2 | **4** | — | T076–T085 |
| **T100** | Ranked future research priorities with evidence-value estimates | P1 | 3 | 1 | 3 | — | T096–T099 |

### Register summary

| Cut | Count |
|---|---|
| Total | **100** |
| `P0` blocking | **34** |
| Pure desk research — startable today | **39** |
| Require G0 data foundation | **61** |
| Risk-of-confident-error 5 (highest) | **31** |
| Require external data purchase | 5 |

---

# Part 4 — Fully instantiated tasks

Six tasks on the critical path, in full 24-field form. These set the standard for
the remaining ninety-four.

---

## T005 — Participant taxonomy and identifiability

**Objective.** Establish definitively what participant-category information exists
for Indian index options, at what granularity, latency and cost — and therefore
whether "institutional vs retail" can *ever* be a measured attribute in this system.

**Research questions.**
1. What participant categories do the exchanges define, and how are they assigned?
2. Is any participant breakdown published **per strike**? Per instrument? Intraday or EOD?
3. Does any obtainable product separate customer from market-maker flow, as CBOE open-close data does in the US?
4. If not, what is the closest defensible proxy, and what exactly does it measure?

**Required data.** Exchange participant-wise publications; data-product catalogues; any historical archive of such files.

**Sources.** *All `NOT_RETRIEVED`.*
· **Exchange:** NSE and BSE participant-wise turnover/OI publications; derivatives data-product catalogues
· **Regulator:** SEBI classification of participant categories in derivatives reporting
· **Clearing:** NSCCL / ICCL member and client reporting formats
· **Comparative:** CBOE open-close data specification; OCC volume-by-account-type publications
· **Academic:** Gârleanu, Pedersen & Poteshman, *Demand-Based Option Pricing*, RFS 2009 *(my confidence in this citation: high; must still be verified)* — as the canonical example of research requiring exactly this data

**Validation method.** Documentary. A claim of non-availability is only accepted after the exchange's full data-product catalogue has been retrieved and searched; absence of evidence is recorded as such, and re-checked annually.

**Limitations.** A negative finding is inherently weaker than a positive one — a product may exist and not be found. Mitigated by requiring the catalogue itself as the artefact.

**Unknowns.**
· Whether any per-strike participant split exists. **Resolves when** the catalogues are retrieved.
· Whether commercial vendors reconstruct it. **Resolves when** vendor documentation is obtained.

**Measured facts (today).** No participant field exists in this system's option-chain feed. **Grade: Verified** against a live snapshot, 2026-07-29.

**Estimated facts.** No per-strike customer/market-maker split is available for Indian index options. **Grade: Estimated** — must be upgraded or refuted by this task.

**Opinions.** Heuristics such as "round strikes are retail" or "large lots are institutional" are folklore. **Grade: Opinion**, and unusable until tested.

**Deliverables.** (1) Participant-data availability matrix. (2) A binding ruling: is participant classification permitted anywhere in this platform? (3) If not, the approved substitute vocabulary (`POSITION_HELD` / `TURNOVER_DOMINATED`).

**Priority** P0 · **Dependencies** none · **RC** 3 · **EC** 1 · **Data** DESK · **Risk level 5**

*Why risk 5:* a wrong "yes" here licenses participant labels across three modules, and every downstream conclusion inherits a fabricated attribute.

**Future extensions.** Annual re-check; monitor whether SEBI's transparency agenda changes the answer.

**Quality control.**
· *Evidence audit* — every claim traced to a retrieved catalogue.
· *Data-quality audit* — n/a (documentary).
· *Gap analysis* — vendor-reconstructed data is the most likely blind spot.
· *Validation checklist* — catalogues retrieved, hashed, dated; search terms recorded.
· *Contradiction detection* — against docs/061 §7 and docs/062 §3.
· *Missing-evidence report* — list every catalogue **not** obtained.
· *Future research* — feasibility of inferring participant mix from order-size distributions, **stated as a hypothesis only**.

---

## T036 — Dealer-sign feasibility

**Objective.** Determine whether dealer directional gamma exposure can be *measured*
rather than *assumed* for Indian index options.

**Research questions.**
1. Can the sign of dealer inventory be established from any obtainable Indian source?
2. If not, how large is the error introduced by the standard convention?
3. Under what market conditions does the convention most likely fail?
4. Can bounds be placed on net dealer gamma even when the point estimate cannot?

**Required data.** T005 output; any customer/market-maker split; option-chain OI and greeks; historical episodes for stress-testing the assumption.

**Sources.** *All `NOT_RETRIEVED`.*
· **Exchange:** NSE/BSE derivatives data products; market-maker scheme documentation
· **Comparative:** CBOE open-close specification; OCC account-type volume
· **Academic:** Gârleanu, Pedersen & Poteshman (RFS 2009) *(confidence: high)*; Bollen & Whaley, *Does net buying pressure affect the shape of implied volatility functions?*, Journal of Finance 2004 *(confidence: high)*; Baltussen, Da, Lammers & Martens, *Hedging demand and market intraday momentum*, JFE *(confidence: medium-high — verify year)*
· **BIS/IOSCO:** market-making and inventory-risk literature

**Validation method.** Documentary, plus a **sensitivity study**: recompute every GEX-derived conclusion under (a) the standard convention, (b) its inverse, (c) a 50/50 mix. Record how many conclusions survive all three.

**Limitations.** Even with a customer/market-maker split, dealers hedge across instruments; net exposure is not observable from options alone.

**Unknowns.** True dealer sign. **Resolves when** a customer/market-maker split is obtained — **and possibly never**, in which case that is the finding and it is recorded permanently.

**Measured facts.** `gex-skew.js:33` assumes dealers are short calls and long puts. **Grade: Verified** — read from source, 2026-07-29. The module already restricts GEX to a regime label and forbids directional use. **Grade: Verified.**

**Estimated facts.** No Indian equivalent of CBOE open-close data exists. **Grade: Estimated.**

**Opinions.** The "customers buy calls" convention is a reasonable prior for a retail-heavy market. **Grade: Opinion.**

**Deliverables.** (1) Feasibility ruling. (2) Sensitivity table: conclusions × three sign assumptions. (3) A standing label for every dealer-gamma output. (4) If infeasible: a permanent Unknown entry with annual review.

**Priority** P0 · **Dependencies** T005, T012 · **RC** 3 · **EC** 1 · **Data** DESK/EXT · **Risk level 5**

*Why risk 5:* the sign inverts the conclusion. A wrong assumption turns a magnet into a repellent, and every gravity, regime and hedging conclusion flips with it.

**Future extensions.** Inferring sign from IV-surface asymmetry — **hypothesis only**, requiring its own pre-registered test.

**Quality control.** Contradiction detection against docs/062 §3 is mandatory; the sensitivity table is the deliverable that makes this task falsifiable.

---

## T043 — Gravity null model

**Objective.** Construct the null against which any claim of price attraction to a
strike zone must be tested, and establish whether the effect survives it.

**Research questions.**
1. Is the index closer to high-concentration strikes than to a **moneyness-matched** strike selected without reference to OI?
2. Does any effect survive a **round-number control**?
3. Is any effect concentrated near expiry, as the pinning literature suggests, rather than present mid-cycle?
4. What effect size, in minutes of dwell and basis points, is detectable at our sample size?

**Required data.** Index spot series (**G0.3 — not currently stored**); per-strike OI/volume/greeks series (**G0.4**); expiry calendar (T002); ≥40–60 complete sessions.

**Sources.**
· **Academic:** Ni, Pearson & Poteshman, *Stock price clustering on option expiration dates*, JFE 2005 *(confidence: high)*; Avellaneda & Lipkin, *A market-induced mechanism for stock pinning*, Quantitative Finance 2003 *(confidence: high)*; Golez & Jackwerth, *Pinning in the S&P 500 futures*, JFE 2012 *(confidence: high)*; Harris, *Stock price clustering and discreteness*, RFS 1991 *(confidence: medium-high)*; Osler on round-number order clustering, Journal of Finance 2003 *(confidence: medium)*
· **All `NOT_RETRIEVED`.** No finding above may be cited as evidence about the Indian market (**transfer: Unknown**).

**Validation method.** Pre-registered (T080). Matched-baseline design with round-number control. Benjamini-Hochberg correction across strikes and days (T076). Block bootstrap for dependence (T078). Stratified by expiry proximity. Effect size reported in physical units, not only *p*.

**Limitations.** Observational; no instrument for causality. Confounded by the fact that strikes *are* round numbers — the control is imperfect because the treatment and confound are structurally co-located.

**Unknowns.** Whether attraction exists in Indian index options outside expiry. **Resolves at** ≈40–60 clean sessions — an **Estimated** requirement, to be replaced by T079's power calculation.

**Measured facts.** Index spot history is not stored (`candles.json`, `prices.json` = 0 KB). Gravity history cannot be reconstructed retroactively. **Grade: Measured**, 2026-07-29.

**Estimated facts.** ~3 months of clean collection needed for a first weak test.

**Opinions.** Practitioner "gravity" frameworks (Market Profile lineage) are conceptually useful and **not peer-reviewed**. **Grade: Opinion.**

**Deliverables.** (1) Pre-registration document. (2) Baseline construction specification. (3) Result — **including a null result, which is a publishable finding**. (4) Effect-size confidence intervals.

**Priority** P0 · **Dependencies** T041, G0.3, T080 · **RC** 5 · **EC** 4 · **Data** HIST · **Risk level 5**

*Why risk 5:* this is the task most able to confirm itself. Without the null, "price is near the OI wall" is true by construction and will be believed.

**Future extensions.** Extend to futures and to single stocks where pinning is better documented.

---

## T061 — Complete cost schedule

**Objective.** Establish the exact, dated, all-in transaction cost for index option
trades, including the exercise case.

**Research questions.**
1. What is every statutory and exchange charge, at what rate, on what base?
2. How is STT applied on exercised versus squared-off options — and at what rate on what value?
3. What changed, and when, over the backtest window?
4. What is the all-in cost as a percentage of premium for a ₹5, ₹20 and ₹200 option?

**Required data.** Current and historical charge schedules; broker contract notes as ground truth.

**Sources.** *All `NOT_RETRIEVED`.*
· **SEBI:** turnover fee schedule · **NSE/BSE:** transaction charge circulars
· **Government:** STT schedule; state stamp-duty schedule; GST rate on brokerage and charges
· **Clearing:** NSCCL/ICCL charges
· **Ground truth:** our own broker contract notes, reconciled line by line

**Validation method.** Reconcile the modelled cost against **actual contract notes** to the paisa. A cost model that has never been checked against a real contract note is an assumption.

**Limitations.** Stamp duty is state-dependent; brokerage is broker-specific and negotiable.

**Unknowns.** Historical rates across the full backtest window. **Resolves when** dated circulars are retrieved.

**Measured facts.** On a sub-₹20 option, **spread alone is 5–10% of premium** — recorded previously in this system's own documentation. **Grade: Measured**, to be re-verified under T063.

**Estimated facts.** Prior backtests applied a cost model whose provenance is not fully documented. **Grade: Estimated** — T095 must reproduce it.

**Deliverables.** (1) Dated cost schedule. (2) Contract-note reconciliation. (3) Cost-as-percentage-of-premium curve. (4) A ruling on the minimum premium below which trading is uneconomic.

**Priority** P0 · **Dependencies** T010 · **RC** 2 · **EC** 2 · **Data** DESK · **Risk level 5**

*Why risk 5:* **every** economic conclusion in the platform — every backtest, every VRP measurement, every strategy verdict — is a function of this number. An error here does not produce a wrong answer in one place; it produces a consistent, plausible wrong answer everywhere at once.

---

## T079 — Power analysis

**Objective.** Determine, for each claimed effect in this programme, the minimum
sample required to detect it — **before** any of them is tested.

**Research questions.**
1. What effect size is economically meaningful for each hypothesis?
2. How many sessions are required at that size, given the observed variance?
3. Which hypotheses are **untestable** at any realistic sample and should be retired?
4. How does multiple testing across 100 tasks change the required sample?

**Required data.** Variance estimates from existing data; the full hypothesis register.

**Sources.** Standard statistical literature; López de Prado on backtest overfitting and deflated Sharpe *(confidence: medium-high on specific titles — verify)*; Benjamini & Hochberg (1995) on FDR *(confidence: high)*.

**Validation method.** Simulation-based power curves per hypothesis. Published before any result.

**Limitations.** Requires an effect size to be *chosen*; that choice is a judgement and must be recorded as **Opinion**.

**Unknowns.** True variances until G0 data accumulates.

**Deliverables.** (1) Power table for all hypotheses. (2) **A retired-hypothesis list** — propositions this system will never have the data to test, stated openly. (3) A "months of collection required" figure per hypothesis.

**Priority** P0 · **Dependencies** T076 · **RC** 4 · **EC** 2 · **Data** DESK · **Risk level 5**

*Why risk 5:* without this, every underpowered study that happens to produce a result will be believed, and the negative ones will be quietly forgotten.

**Future extensions.** Sequential testing designs to reach conclusions with fewer sessions.

---

## T069 — Operational risk from data outages

**Objective.** Quantify and control the loss of research capability caused by
collection gaps.

**Research questions.**
1. What is the historical distribution of session coverage?
2. What research is foreclosed by each hour of missing data?
3. What is the recovery cost — and what is genuinely unrecoverable?
4. What monitoring would have detected this within one session rather than weeks?

**Required data.** Archive coverage statistics — **already available**.

**Validation method.** Direct measurement, re-run weekly as a ratchet.

**Measured facts.** **12 of 13 archived sessions are missing the market open, 61–358 minutes each. One session is complete. `data/candles.json` and `data/prices.json` are 0 KB. The archive auto-deletes past 40 files.** **Grade: Measured**, 2026-07-29, reproducible from the archive.

**Estimated facts.** The cause is that the collector was not running, rather than a restart defect — the restore fix landed 2026-07-28 and today's collector started at 11:50 against a first sample at 11:45. **Grade: Verified** for the timeline; **Estimated** for the causal attribution.

**Unknowns.** Why the collector was not running on those specific mornings. **Resolves when** launcher and machine-uptime logs are examined.

**Deliverables.** (1) Coverage time series. (2) A foreclosed-research register — which tasks each gap delays. (3) Monitoring specification. (4) A written retention policy replacing the 40-file cap.

**Priority** P0 · **Dependencies** G0.1, G0.2 · **RC** 2 · **EC** 3 · **Data** Measured · **Risk level 4**

*Why this is a research task and not a chore:* **61 of the 100 tasks depend on data
that is currently not being kept.** This is the highest-leverage item in the entire
programme, and it is also the cheapest.

---

# Part 5 — Programme-level quality control

Applied at every task, and audited at every phase boundary.

| Audit | Question | Artefact |
|---|---|---|
| **Evidence audit** | Is every claim graded, and every Verified claim traced to a retrieved primary source? | Grade ledger |
| **Data-quality audit** | Coverage, gaps, provenance, and known corruption for every dataset used | Dataset card |
| **Research-gap analysis** | What would change the conclusion, and do we have it? | Gap register |
| **Validation checklist** | Pre-registered? Corrected for multiplicity? Powered? Out-of-sample? | Signed checklist |
| **Contradiction detection** | Does this contradict any prior internal finding? | Contradiction log |
| **Missing-evidence report** | Every source still `NOT_RETRIEVED` | Retrieval queue |
| **Future research** | What did this open? | Feeds T100 |

## 5.1 Three programme-wide rules

1. **No phase closes with a load-bearing source at `NOT_RETRIEVED`.**
2. **Negative results are deliverables** (T082). A programme that only records
   confirmations is a programme that has stopped measuring.
3. **Contradictions are escalated, never silently resolved.** When a new finding
   contradicts an old one, both stay in the record with dates and grades until an
   explicit adjudication is written.

---

# Part 6 — Sequencing

```
IMMEDIATELY, in parallel:
  ├── G0.1–G0.6  data foundation ...................... unblocks 61 tasks
  └── 39 desk-research tasks ............... no data required, start today
        T001–T015, T021–T022, T032, T036, T039, T061, T066, T070,
        T076, T079, T080, T081–T085, T086–T090, T094

MONTH 1–3   Desk research completes · G0 accumulates sessions
MONTH 3–6   First empirical tasks become possible (T016–T020, T031, T041)
MONTH 6–12  Powered tests: T035 VRP · T043 gravity null · T040 replication
MONTH 12+   Regime, ML, portfolio risk — all downstream of validated primitives
YEAR 1 END  T096–T100 blueprints
```

**The two facts that set this timeline:**
· 39 tasks need no data and are gated only by reading.
· **61 tasks are gated on data that is being discarded today.**

---

# Part 7 — What this programme will not produce

Stated at the outset, so it is not discovered as a disappointment later.

| Not produced | Why | Grade |
|---|---|---|
| Participant identity per strike | No such data exists in any obtainable source | **Estimated → T005 rules definitively** |
| Verified dealer gamma sign | Requires customer/market-maker separation | **Unknown, possibly permanent** |
| Trade count per strike | No such field in the feed | **Verified absent** |
| IV Rank / IV Percentile before ~252 stored sessions | Definitional | **Unknown until then** |
| Retroactive backtest of chain-state strategies | Chain state was never stored and cannot be reconstructed | **Verified** |
| Buy/sell signals, targets, stops | Out of mandate | — |
| Trade recommendations | Out of mandate | — |

---

## Summary

One hundred tasks, twenty phases, twenty-four fields each. Three things about this
programme matter more than its contents.

**First: 61 of the 100 tasks depend on data this system is not keeping.** Twelve of
thirteen archived sessions are missing the market open; index price history is not
stored at all; per-strike IV, OI, volume and depth are observed live and discarded;
the archive erases itself after forty files. Price history can be re-fetched.
**Option-chain state cannot.** The data foundation — six small operational items —
is worth more than every analytical task below it, because it alone determines
whether the evidence to run them will exist.

**Second: 39 tasks need no data at all** and are gated only by reading exchange
rulebooks, SEBI circulars and the literature. They can begin today, and they include
the three rulings that constrain everything else — T005 (can participants ever be
identified?), T036 (can dealer sign ever be measured?), T061 (what does a trade
actually cost?).

**Third: no citation in this document has been retrieved.** Every source is marked
`NOT_RETRIEVED`, every academic reference carries my own confidence in it, and no
task may close while a load-bearing source remains unfetched. This is deliberate. A
research programme that begins with invented citations does not recover, because
every later conclusion inherits them — and the more institutional the presentation,
the more completely they are believed.

Thirty-one of the hundred tasks carry the highest risk-of-confident-error rating.
Not one of them is dangerous because it is hard. They are dangerous because each has
an answer that looks right, arrives quickly, and is wrong.
