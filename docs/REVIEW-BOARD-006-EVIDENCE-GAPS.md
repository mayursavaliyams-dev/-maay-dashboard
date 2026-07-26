# REVIEW BOARD — FORMAL REVIEW 006
## ANTIGRAVITY PRO — RESEARCH GAP COMMITTEE · THE MISSING-EVIDENCE MAP

**Authority:** Institutional Research Gap Committee · Scientific Evidence Review Board
**Date:** 2026-07-17 · **Basis:** audits 001–050, Reviews 001–005 (what EXISTS is settled there;
this review maps what does NOT)
**Mode:** Gap identification only. No code, no fixes, no redesign.

**Integrity notes.**
(1) Quotas: the instruction requests ~450 ranked items. Its own rules — *never invent sources;
Unknown remains Unknown* — override the quotas. Every entry below is a real gap anchored to a
measured absence; every named external source is one the Committee is confident exists. Where a
precise document is needed but its identifier is unknown to the Committee, the entry names the
*document class* and marks the identifier TO-OBTAIN — inventing circular numbers or paper titles
would poison the very register meant to cure missing evidence.
(2) Effort figures are ESTIMATES and declared as such.

---

# PART 1 — MODULE EVIDENCE MATRIX (proven / measured / estimated / assumed / unknown / impossible)

| Module | Proven | Measured | Estimated | Assumed | Unknown | Impossible-to-know |
|---|---|---|---|---|---|---|
| **Backtesting** | determinism (byte-identical) | look-ahead effect; cost sensitivity | slippage=0 (declared) | fills at open; 2× stop fills | true fill quality | pre-2024 intraday fills (no data survives) |
| **Statistics** | method stack correct (DSR/PSR/WF/PKF reproduce) | DSR ladder; bootstrap CI | — | nTrials≈1 (in code) | true trial count (partially recoverable from blobs) | trials run and never recorded anywhere |
| **Probability/Calibration** | — | Brier/ECE on n=12 | — | P(win) decision-relevant | calibration of displayed confidence | pre-persistence confidence stream (20/21 discarded — gone) |
| **Volatility/VRP** | — | regime slices (RV proxy) | IV pct via window proxy | VRP premise global | IV-surface-based VRP; term structure | historical intraday IV surface (never captured) |
| **Greeks/GEX** | — | 6.79% model divergence | r=6.5% in one model | dealer positioning = OI sign convention | true dealer inventory | Indian dealer inventory (undisclosed by exchanges) |
| **Market structure/Microstructure** | — | — | — | continuous liquidity at mid | spreads, depth, impact | historical order-book (not retained by NSE for retail) |
| **Execution** | order-guard integrity | — | ₹20 brokerage flat | zero rejection/partial fills | broker fill/latency stats | — |
| **Risk mgmt** | brake fires on new loss (production) | 8-vs-16 bypass | — | daily-loss % basis (capital def.) | SPAN/exposure margin per structure | — |
| **Option pricing** | — | — | BS with flat σ (deleted optimizer) | European exercise fine for index | discrete dividend handling in indices | — |
| **Portfolio theory** | — | expectancy on n=12 | — | 1-lot sizing neutral | cross-engine correlation of books | — |
| **Exchange rules** | lot=65 vs data | — | — | txn rates uniform NSE/BSE | current expiry weekday truth; circular rates (E1) | — |
| **Regulatory** | — | — | — | paper research exempt | SEBI algo framework applicability boundary | — |

**Matrix summary (derived):** 72 cells; **Proven 5 · Measured 9 · Estimated 5 · Assumed 12 ·
Unknown 12+ · Impossible 5.** Evidence coverage from this matrix ≈ **(5+9)/72 ≈ 19%** of cells
resting on proof or measurement.

---

# PART 2 — CRITICAL EVIDENCE MISSING (blocking; each with why/impact/required/source/effort/risk)

| # | Missing evidence | Why it matters | If ignored | Required | Source | Effort (est.) | Risk |
|---|---|---|---|---|---|---|---|
| CE-1 | **Trial-count ledger** (all variants ever tested) | it IS the nTrials input; without it DSR is theater | false discovery institutionalized | persistent counter + blob-recovered history | internal + git blobs | hours | CRITICAL |
| CE-2 | **~200 labelled outcomes** (have 12, one structure) | minimum for calibration & meta-label claims (019) | every probability claim unfounded | paper forward-log accumulation | internal | months (calendar) | CRITICAL |
| CE-3 | **Persisted shown-confidence stream** | calibration is *unverifiable* until it exists | trust badge forever untestable | route fix already specified (Rev-001 C5) | internal | hours | CRITICAL |
| CE-4 | **Slippage/fill model with any empirical anchor** | ₹226/tr sensitivity = edge-sized | net numbers remain optimistic bounds | paper-vs-quote deltas once live-quote logging exists; broker fill notes | internal + broker docs | days–weeks | CRITICAL |
| CE-5 | **SPAN/exposure margin per structure** | return-on-capital divisor wrong (₹1L vs 1.2–1.5L) | ROC inflated ~20–50% | broker margin calculator outputs per structure; exchange SPAN files | broker portal; NSE SPAN | days | HIGH |
| CE-6 | **Exchange fee circular set (E1)** | charges.js rates unverified; BSE-vs-NSE txn differ | cost model unaudited at the source | current NSE & BSE fee schedules + STT notification | NSE/BSE official fee pages; CBDT STT notification (TO-OBTAIN ids) | hours | HIGH |
| CE-7 | **oiUnit attestations** (broker chain; BSE bhavcopy) | every OI-based signal's scale | OI logic possibly 1×-vs-lot× wrong | broker API doc line; BSE bhavcopy spec | Upstox/Dhan docs; BSE UDiFF spec | hours | HIGH |
| CE-8 | **Trading calendar (authoritative)** | 27 unexplained missing weekdays | gap-vs-holiday indistinguishable; DTE errors possible | NSE holiday lists 2024–26 | NSE official | hours | HIGH |
| CE-9 | **Off-machine existence proof for `data/`** | single-SSD extinction risk (A-15) | one disk = project ends | verified external copy + restore drill record | internal | hours | CRITICAL |
| CE-10 | **The 37 deleted studies' contents** | the control group; also feeds CE-1 | survivorship locked; nTrials floor unknown | blob exhumation before any `gc` | git object store | hours | CRITICAL (deadline) |

# PART 3 — MISSING DATASETS (top 30)

Intraday option-chain archive beyond one session (capture 8–30% on 4/5 days) · tick data (none ever)
· historical IV surface · order-book/depth snapshots (impossible retroactively; possible forward) ·
spread/quote log (bid-ask never recorded) · broker fill log (paper-fill vs quote) · dealer/participant
positioning beyond FII-DII aggregates · labelled outcomes ≥200 (12 exist) · confidence→outcome pairs
(1 exists) · trial ledger (0) · trading calendar · SPAN margin series · fee-schedule history ·
lot-size revision history (derivable from bhavcopy cols — unextracted) · corporate-action/index-rebal
calendar · event calendar with verified dates (RBI/budget/CPI) · India VIX intraday history ·
cross-engine correlation matrix of paper books · restart/incident log (0 incidents recorded ever) ·
perf/latency baseline (0 samples) · memory profile over multi-day run · WS gap-vs-broker-outage
attribution log · pre-2026-07 `confirmed-signals` (orphaned; live file lost) · v1-era model snapshot
(unrecoverable) · deleted result sets ×14 (blob-recoverable) · BSE bhavcopy parallel history (NSE
only, 600 files) · risk-free rate series used consistently (r=6.5% hardcoded once) · realized-vol
reference series (currently derived ad hoc) · holiday-adjacent session behavior set · benchmark
series (NIFTY buy-and-hold) for any relative claim.

# PART 4 — MISSING EXPERIMENTS (top 30)

Pre-registered forward test of residual edge (the one that matters) · slippage experiment
(paper-fill vs live quotes) · margin-realistic ROC re-run · liquidity-slice robustness (volume is in
data, unloaded) · condor-vs-strangle wings cost experiment (engine trades condor; backtest evidence
is strangle) · gap-at-open stress replay on 2026-07-08 session · dual-writer interleaving test ·
disk-full behavior test · kill-during-write torn-file census (32 raw sites) · restore drill from
.bak set · halt-recovery end-to-end (halt → reset → state audit) · Linux parity run · second-instance
EADDRINUSE behavior · reliability curve once CE-3 exists · agreement-term validation (or removal) ·
N_eff on ≥100 decisions · per-leg hit-rate stationarity test · learner ablation (weights frozen vs
learning) vs outcomes · minimum-n gate sensitivity · phantom-leg removal A/B on verdict distribution
· expectancy-vs-P(win) display decision study (does the number change operator behavior — links
A-11) · calibration of `agents-engine` MOVE_CALIBRATION on next 33 outcomes (its own protocol!) ·
retention-registry fire-drill (FIFO exemption verified) · bhavcopy column-name assertion harness ·
UDiFF spec conformance check · fee reconciliation vs a real contract note (single trade suffices) ·
VIX-spike session replay (engines' behavior under H-03) · time-of-day entry sensitivity (bhav open
vs 09:20 anchor) · multi-day paper P&L reconciliation (ledger-vs-equity) · results-append migration
dry run.

# PART 5 — MISSING ACADEMIC ANCHORS (25; all real, standard works — no invented citations)

Bailey & López de Prado (2014), *The Deflated Sharpe Ratio* — the platform implements it; nobody has
read it against the implementation · Bailey & López de Prado (2012), *The Sharpe Ratio Efficient
Frontier* (PSR) · López de Prado (2018), *Advances in Financial Machine Learning* — purged k-fold,
embargo, label leakage (directly relevant to 018's live-state labels) · Harvey, Liu & Zhu (2016),
*…and the Cross-Section of Expected Returns* — multiple-testing thresholds · White (2000), *A
Reality Check for Data Snooping* · Sullivan, Timmermann & White (1999) — data-snooping in trading
rules · Platt (1999) — probability calibration · Zadrozny & Elkan (2002) — isotonic calibration ·
Brier (1950) — the score already computed in 048 · Murphy (1973) — reliability diagrams · Kelly
(1956) — before any sizer reactivation · Thorp (2006 chapter) — Kelly practice · Bollen & Whaley
(2004) — net buying pressure & IV (VRP mechanism) · Gârleanu, Pedersen & Poteshman (2009) —
demand-based option pricing (dealer positioning theory the GEX code assumes) · Bakshi & Kapadia
(2003) — volatility risk premium evidence · Carr & Wu (2009) — variance risk premia · Sinclair,
*Volatility Trading* — practitioner VRP/sizing · Israelov & Nielsen (AQR papers on covered
calls/option selling) — cost-aware option-selling base rates · Aronson (2006), *Evidence-Based
Technical Analysis* — the philosophy this repo re-learned empirically · Ioannidis (2005), *Why Most
Published Research Findings Are False* — the survivorship chapter of this project · Gelman & Loken
(2013), *The Garden of Forking Paths* — post-hoc filter trap (045 §0.2) · Efron & Tibshirani —
bootstrap foundations (used, uncited) · Diebold & Mariano (1995) — forecast comparison ·
Hasbrouck — microstructure measurement (before any spread claims) · Almgren & Chriss (2000) —
execution cost framing.
**Effort:** reading-and-reconciliation, days; **Priority:** MEDIUM (method already matches several;
citations convert practice into defensible method).

# PART 6 — MISSING EXCHANGE & BROKER REFERENCES (15)

NSE UDiFF bhavcopy specification (column semantics incl. `UndrlygPric` — would have prevented C-01 by
documentation) · BSE equivalent spec (oi unit; SENSEX options fees) · NSE & BSE current transaction-
charge schedules · STT rate notification (current) · SEBI/exchange peak-margin & SPAN documentation ·
NSE holiday calendars 2024–26 · lot-size revision circulars (registry cross-check) · expiry-day
scheme circulars in force (weekday truth — Commission's probe failed; re-verify) · index methodology
docs (rebalance dates) · Upstox API: option-chain field semantics (oi unit; ltp staleness; rate
limits — the 429 storms) · Dhan equivalents · broker contract-note fee breakdown (one real note
reconciles charges.js end-to-end) · exchange circuit-breaker rules (H-04 behavior design input) ·
India VIX methodology paper (NSE) · SPAN parameter files access route.
**All marked TO-OBTAIN by identifier; none invented here.**

# PART 7 — MISSING REGULATORY EVIDENCE (8)

SEBI retail algorithmic-trading framework (2025 circular; effective-date and applicability boundary
for *personal, non-distributed, paper* systems — believed exempt; UNVERIFIED) · algo-tagging /
white-box requirements if signals are ever distributed (memory: mandatory from 2026-04-01;
TO-VERIFY against the circular text) · investment-advice boundary (if dashboards are ever shown to
others) · data-license terms for redistributing bhavcopy-derived analytics · broker API terms on
automation · record-keeping obligations that would bind a live system (audit-trail gap 022 becomes
legal, not just scientific) · tax characterization of F&O (affects net-edge math if ever live) ·
KYC/consent constraints on storing any third-party data (currently none stored — confirm).

# PART 8 — TOP BLOCKING UNKNOWNS (consolidated; 18 — the full evidence-backed set)

v1/v2 stat mixture (permanent) · agreement-term sign · displayed-confidence calibration (blocked on
CE-3) · true trial count (partially blocked on CE-10) · slippage profile · SPAN margins · oiUnit ×2
· liquidity slice · exchange fee truth (E1) · expiry-weekday current truth · disk-full behavior ·
dual-writer incidence · halt-recovery end-to-end · Linux parity · memory profile · deleted studies'
findings · regulatory applicability boundary · dealer inventory (impossible-class).

# PART 9 — PRIORITY LADDERS (top items; effort declared as estimates)

**Research priorities (10):** CE-10 exhume (hours) → CE-1 trial ledger (hours) → CE-3 persist
confidence (hours) → CE-2 outcome accumulation (calendar months; starts only after books persist) →
pre-registered forward test protocol (days) → CE-4 slippage anchor (days) → CE-5 margins (days) →
liquidity slice (hours; load col 24) → agreement-term test (hours, after CE-3) → condor-parity
backtest (days).
**Scientific priorities (8):** reconcile DSR implementation with Bailey–LdP paper · adopt
forking-paths discipline for any regime gate · reliability curve protocol (Murphy) · label-leakage
review per LdP ch.7 · Brier/ECE as standing metrics · benchmark series for relative claims ·
stationarity tests per leg · replication file for every published number.
**Statistical priorities (7):** power analysis before any new claim (min-n) · multiple-testing
ledger · CI reporting norm (no point estimates alone) · permutation-test standard for AUC-class
claims · fat-tail-aware Sharpe caveats (kurtosis 30.6) · seeded-reproducibility norm (exists —
codify) · effect-size over win-rate reporting.

---

# PART 10 — SCORES (derived)

| Score | Value | Derivation |
|---|---|---|
| **Repository Evidence Coverage** | **≈19%** | matrix cells proven+measured / total (Part 1) |
| **Scientific Evidence Score** | **2 / 10** | 10 critical evidence classes: 0 complete, 3 partially (outcomes 12/200; trials partial-recoverable; charges rates coded-unverified) |
| **Research Completeness Score** | **2 / 10** | 30 named experiments: ~4 run (look-ahead A/B, bootstrap, regime, calibration-n12) |
| **Institutional Readiness Score** | **1.5 / 10** | blocked by CE-1..CE-10; lifted only by data-integrity (031/033) and method-stack correctness |

---

# FINAL RECOMMENDATION

## **MORE EVIDENCE REQUIRED**

— for the platform as a research programme. The measurement *method* stack is sound and the raw
EOD data foundation is verified (600 files, 0% missing) — so **INSUFFICIENT SCIENTIFIC FOUNDATION
would overstate**, and **READY FOR RESEARCH would understate**: research may *continue*, but no
conclusion may *graduate* until the Critical Evidence set (CE-1…CE-10) exists.

**Sub-verdicts:** the residual-edge research line specifically — **INSUFFICIENT SCIENTIFIC
FOUNDATION** until CE-1 (trial ledger) and CE-4/5 (frictions) exist, because its central statistic
cannot even be computed honestly today. The calibration research line — blocked at CE-2/CE-3 by
construction.

**The Committee's closing observation.** This repository's missing evidence is unusually
*acquirable*: most Critical items are hours of work or calendar-time accumulation, not new science.
The two exceptions are already lost forever (pre-persistence confidence; v1-era model state) — and
both were lost by *not writing down a number the system already had in hand*. The cheapest evidence
in empirical finance is the evidence you are currently holding. Write it down.

— Institutional Research Gap Committee, 2026-07-17
