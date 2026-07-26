# REVIEW BOARD — FORMAL REVIEW 003
## ANTIGRAVITY PRO — COMPLETE INSTITUTIONAL AUDIT · TOP 50 DISCOVERIES

**Authority:** Independent Institutional Review Board (Red Team)
**Date:** 2026-07-17 · **Basis:** audits 001–050 (each with reproducible harness), Reviews 001–002,
live observation 2026-07-13→17, git archaeology, production logs, 49/49 test suites
**Mode:** Audit only. No code. No implementation guidance beyond naming the deficiency.
**Ranking key:** B = business impact, E = engineering impact, S = scientific impact (H/M/L).
**Classification key:** VERIFIED (inspection/log/git) · MEASURED (quantitative harness) ·
DERIVED (computed from measured, assumptions stated) · HYPOTHESIS · UNKNOWN.

---

# TOP 10 CRITICAL ISSUES (full treatment)

### C-01 — Look-ahead bias contaminates 9 strategy files; the flagship claim is an artefact
**Class:** MEASURED · **Confidence:** near-certain (A/B harness, 599 trades, one line differing)
**Evidence:** `bt-lib.js:22` publishes same-day close as `underlying`; strike selection in
`bt-strategies/-costs/-regime/-tailsafe/-trend/-world/pop-seller/bt-real`. With: 88.15% win; without:
65.61% gross / 59.43% net. **Root cause:** an innocently-named column; no temporal-integrity test.
**Blast radius:** every historical strangle claim; the ₹7L allocation sized on it. **Risk:** false
belief in edge. **Unknowns:** none material. **Recommendation:** reference-price fix in the 8
remaining files, then re-derive every claim; committed fix exists for `bt-validate.js` only.
**Rank:** B-H · E-M · S-H

### C-02 — The multiple-testing correction is disarmed: `deflatedSharpe(pnls, nTrials || 1)`
**Class:** VERIFIED (call sites) + MEASURED (DSR ladder) · **Confidence:** certain
**Evidence:** `forward-test-report.js:48`; `server.js:6107` omits (→1), `:6129` hard-codes 5. Ladder:
1→100% PASS · 10→76.9% FAIL · 40→54.7% · 100→41.1%. Comment on the parameter: "for deflated Sharpe
honesty". **Root cause:** no persistent trial counter exists to supply the argument. **Blast radius:**
the platform's only statistical defense reports PASS unconditionally. **Recommendation:** trial
counter as mandatory input; treat absence as UNKNOWN, not 1. **Rank:** B-H · E-L · S-H

### C-03 — Survivorship engineered by deletion: 37 experiments + 14 result sets destroyed
**Class:** VERIFIED (git) · **Confidence:** certain
**Evidence:** commit `3e388d1` "chore… junk" (2026-06-21): iron-condor, straddle, 3 directional
strategies, 6 capital variants, a regime study, a failure post-mortem, and a 40-config optimizer
ranked by win rate (exhumed, header quoted in 043). **Root cause:** no experiment registry; no
deletion policy. **Blast radius:** control group destroyed; honest nTrials unknowable from disk;
survivors misleading. **Unknowns:** findings of the deleted studies — unrecoverable if blobs are
GC'd. **Recommendation:** immediate exhumation to an archive directory; permanent no-delete policy.
**Rank:** B-M · E-L · S-H · **DEADLINE: one `git gc`**

### C-04 — The only complete intraday session sits under a silent FIFO-40 delete timer
**Class:** VERIFIED · **Confidence:** certain
**Evidence:** `server.js:578` `while(files.length>40) unlinkSync(files.shift())` inside `catch(_){}`;
`opt-candles/2026-07-08.json` = 669 series, 371/374 bars; other sessions 8–30%. Not re-derivable from
any source. **Root cause:** disk-space cap written before the directory held anything irreplaceable.
**Blast radius:** permanent loss of the platform's only tick-adjacent scientific asset.
**Recommendation:** copy out / exempt / raise cap — any one, before ~35 more sessions.
**Rank:** B-M · E-L · S-H · **DEADLINE**

### C-05 — Forward-test evidence is self-erasing (supervisor death × non-persistent books)
**Class:** VERIFIED (12 daemon starts in pm2.log, session-correlated) + observed twice live
**Evidence:** PM2 daemon dies with the spawning shell (no crash, no error); `strangle`/`bounce`/
`gamma-blast` do not persist open positions → restarts destroyed 24, then 20+ paper positions.
**Root cause:** daemon lifetime coupled to operator session; three engines never implemented
restore (two did). **Blast radius:** the paper record — the platform's only clean evidence stream —
is censored at every session end. **Recommendation:** session-independent supervision (operator's
one-line task; launcher exists) + book persistence. **Rank:** B-H · E-H · S-H

### C-06 — The live model was silently re-specified beneath its learned state; provenance unrecoverable
**Class:** VERIFIED (git diff of `DEFAULT_WEIGHTS`) + UNKNOWN (v1/v2 mixture)
**Evidence:** commit `04c35a6` (2026-07-01): 8→9 factors, six priors changed, baselineSum 92→99 →
every learned weight rescaled +7.6% by re-normalisation; `reset()` exists at `:187`, uncalled;
artifact untracked, no version/schema/timestamp fields. **Root cause:** no model registry, no
spec-hash guard. **Blast radius:** all model statistics may blend two specifications —
**permanently unresolvable**. **Recommendation:** version the artifact; spec-change ⇒ archived v1 +
fresh v2. **Rank:** B-M · E-M · S-H

### C-07 — An uncalibrated heuristic is displayed as "probability", gates decisions, and its shown value was discarded 20/21 times
**Class:** MEASURED · **Confidence:** certain on mechanism; calibration itself UNKNOWN (by construction)
**Evidence:** `master-confluence.js:103` affine map (constants 50/45/0.55/0.45); `<58` forces HOLD;
"VERY HIGH" ≥85; rendered on 6 dashboards; persisted score null in 20/21 records; the single
persisted case: 91 → LOSS; stream outcome 5W/16L. **Root cause:** inline `learn()` path drops the
tracked snapshot (`server.js:6171`). **Blast radius:** human trust manufactured by a number with no
definition; calibration permanently unverifiable until persistence exists. **Recommendation:**
persist shown value; rename until Brier/ECE computed. **Rank:** B-H · E-L · S-H

### C-08 — The decision layer cannot see capital risk; the circuit-breaker has zero readers
**Class:** MEASURED (grep across 4 consumers = 0) + VERIFIED (inputs enumerated)
**Evidence:** 10/10 fusion inputs are market data; `consecLosses/halted` read by none of
agents/signal-paper/strangle/gamma engines; `/api/master-signal` ungated to 6 dashboards; the brake
did fire (16 losses, 2026-07-14) — nothing consuming verdicts knew. **Root cause:** five independent
per-engine risk opinions; no single authority. **Blast radius:** BUY·VERY-HIGH renderable while
halted. Paper-only caps severity. **Recommendation:** one risk state, read before any verdict
publishes (protected-file change → approval package). **Rank:** B-H · E-M · S-M

### C-09 — The platform's only learning model learns from noise
**Class:** MEASURED · **Confidence:** high (its own persisted stats)
**Evidence:** 44/130 correct (33.8%); 16/20 populated cells <50%; 7/27 cells weighted from n=0
(re-normalisation moves unobserved weights); corr(weight, accuracy)=0.177; no minimum-sample gate
(update on observation #1; 4-for-4 pcr treated as signal). **Root cause:** update rule violates
Unknown≠Prediction structurally. **Blast radius:** every fusion verdict weighted by it.
**Recommendation:** zero-weight n=0 legs; sample floor; validation before live learning.
**Rank:** B-M · E-L · S-H

### C-10 — Unauthenticated LAN-exposed control plane; unbacked config deletable over HTTP
**Class:** VERIFIED · **Confidence:** certain
**Evidence:** 0/172 routes authed; bind `0.0.0.0:3000`; `POST /api/strategy-config/reset` unlinks
`config-overrides.json` (sole store of all engine state, 5% brake, ₹7L allocation; no `.bak`);
default API key `'antigravity'` published in `.env.example`; complete `auth.js` unused. **Root
cause:** hardening built, never wired (AUTH_ENABLED default off). **Blast radius:** any LAN device;
paper-only and local-network caps severity. **Recommendation:** loopback bind or enable existing
auth. **Rank:** B-M · E-H · S-L

---

# TOP 20 MAJOR ISSUES (compact; all fields per row)

| ID | Finding | Class | Evidence | Blast radius | Conf. | B/E/S | Recommendation |
|---|---|---|---|---|---|---|---|
| M-01 | Residual edge fails honest deflation (DSR ≤54.7% at ≥40 trials) | MEASURED | 042/050 ladder | edge belief | high | H/L/H | forward-test per R1 (Rev-001 §13) |
| M-02 | Edge negative at realised vol ≥15% (₹−13/tr, Sh −0.06); **no vol gate exists** | MEASURED | 045 §0.1 | seller's worst regime unguarded | high | H/M/H | pre-registered regime gate only |
| M-03 | 88% of profit in DTE 1–2; DTE 3–4 −₹257/tr | MEASURED | 045 | concentration | high | M/L/H | diagnosis, not filter (curve-fit trap) |
| M-04 | 71% of profit from 2025 alone; 2026 Sharpe 0.70 | MEASURED | 045 | time instability | high | M/L/H | same |
| M-05 | Zero slippage/spread modeled; +₹226/tr erases edge; margin divisor ₹1L vs SPAN ₹1.2–1.5L | MEASURED+DERIVED | 045 §0.3, D3 | all net figures optimistic bounds | high | H/L/H | realistic friction model before belief |
| M-06 | `/api/risk` fabricates state (env defaults; day-scoped recount) — reported 0 while engine held 15 | VERIFIED | 013; live | monitoring blind | certain | H/M/M | protected-file fix (package exists) |
| M-07 | Kelly sizer seeded `winRate ?? 0.9` from invalidated backtest; kelly(0.512)=−0.077 ⇒ do-not-bet; off only by default flag | VERIFIED+DERIVED | 014 | one flag from mis-sizing | high | H/M/M | remove fabricated prior |
| M-08 | Ensemble phantoms: `volume`,`fii` 0 votes/21 with weights 8.06/10.08 | MEASURED | 047 | baseline distortion | certain | L/L/H | zero-weight unobserved legs |
| M-09 | `news` 20/21 bullish — a constant, not a voter; loudest leg `oi` 19/21 bullish at 20% accuracy | MEASURED | 047/041 | intercept bias amplified | high | M/L/H | diversity governance |
| M-10 | N_eff = 3.71 of 7 (oi↔pcr same data; trend↔news −0.66) | DERIVED (n=21 caveat) | 047 §0.3 | shared-error amplification | med | M/L/H | report N_eff beside N |
| M-11 | Agreement term in confidence formula unvalidated; only unanimous call LOST (p=0.209, underpowered) | UNKNOWN (sign) | 047 §0.4 | confidence direction unknown | — | M/L/H | score or remove the term |
| M-12 | Expectancy never computed anywhere; calibrated 75% condor = ₹41.9/tr, ₹503/12 trades | MEASURED | 048 §0.3 | wrong quantity displayed | certain | H/L/H | payoff ratio beside every badge |
| M-13 | Zero hypotheses ever documented → all research exploratory by own standard | VERIFIED | 043 | no confirmatory result exists | certain | M/L/H | registry with nulls |
| M-14 | 0/25 results carry gitSha/dataHash/seed | MEASURED | 040 | nothing reproducible | certain | M/M/H | provenance stamps |
| M-15 | Results overwritten in place — only the last run exists | VERIFIED | 015 | no experiment history | certain | M/M/H | append-only |
| M-16 | Feature store absent — features computed then discarded every tick | VERIFIED | 035 | replay/AI/drift impossible | certain | M/H/H | persistence layer |
| M-17 | `bt-lib` lot from `rows[0]` — wrong 27/600 days (Board's own prior fix defective) | MEASURED | 032 §0 | sizing noise in every backtest | high | M/M/M | per-expiry lot keying |
| M-18 | Two `bsGamma` implementations diverge 6.79%; no ground truth exists to adjudicate | MEASURED | 036 | GEX numbers model-dependent | high | M/M/H | single owner; declare model |
| M-19 | meta-label: AUC 0.685 at n=12 = chance (perm p=0.191); `prob`=round(rawP×100) | MEASURED | 019/048 | fake calibration field | high | M/L/H | ≥200 outcomes before claims |
| M-20 | 119 `\|\|0` coercions; `(eventRisk\|\|0)<70` opens gate on feed outage | VERIFIED | 001-C/049 | fail-open on unknowns | certain | H/H/M | unknown⇒block convention |

# TOP 20 MEDIUM ISSUES (compact)

| ID | Finding | Class | Evidence | Conf. | B/E/S | Recommendation |
|---|---|---|---|---|---|---|
| D-01 | bounce-engine prices nothing — 20+ open positions with UNKNOWN P&L | VERIFIED (live) | positions-book | certain | M/M/M | engine must mark its book |
| D-02 | bounce concentration: 22–23 simultaneous one-instrument longs; no cap observed | VERIFIED (obs) / cap UNKNOWN | live | med | M/M/L | declare/verify position cap |
| D-03 | `.env` is a decoy — config-overrides silently wins (2% vs 5% brake) | VERIFIED | 004 | certain | M/M/L | precedence documentation |
| D-04 | Runbook recommends deleting the unbacked config; recommends bare `node` | VERIFIED | 029/039 | certain | M/M/L | runbook correction |
| D-05 | `opthl` FIFO-120 silent delete (same pattern as C-04) | VERIFIED | 039 | certain | L/L/M | retention registry |
| D-06 | Destructive ops inside `catch(_){}` — failures unobservable | VERIFIED | 039 | certain | L/M/M | deletions must log |
| D-07 | `entryAt` is a clock-string, no date — audit trail weak, cross-day ambiguity | VERIFIED | positions work | certain | L/M/M | epoch timestamps |
| D-08 | 45/55 write sites use variable paths — lineage not statically derivable | MEASURED | 038 | certain | L/M/M | dataset registry |
| D-09 | `server.js` monolith: 7,350 lines, 172 routes, mixed concerns | VERIFIED | 001-B | certain | L/H/L | (long-term) decomposition |
| D-10 | No audit trail of engine events; append-only writer exists, aimed at migrations | VERIFIED | 022 | certain | M/M/M | repoint existing writer |
| D-11 | Backups: 7 files, 0 of 9 critical; 1 orphan (`confirmed-signals` live file gone) | VERIFIED | 025 | certain | M/M/M | scheduled backup of critical set |
| D-12 | Point-in-time recovery = one write; model `.bak` 24h stale | VERIFIED | 039 §2 | certain | M/M/M | versioned snapshots |
| D-13 | `restoreEquity` >30-day staleness ⇒ baseline reset — a dormant streak silently forgiven | DERIVED (code path read) | exec-engine | med | M/M/M | stale⇒halt, not fresh-start |
| D-14 | Upstox watchlist 429 storms — polling without backoff | VERIFIED (logs) | error.log | certain | L/M/L | rate-limit hygiene |
| D-15 | 27 unexplained missing weekdays in bhavcopy; no trading calendar exists | MEASURED | 031 | high | L/L/M | calendar source |
| D-16 | Intraday WS capture 8–30% on 4 of 5 sessions | MEASURED | 034 | high | M/M/H | capture reliability |
| D-17 | Source data has no Greeks/IV — all computed; no adjudication possible | VERIFIED | 036 | certain | M/L/H | declare model + params everywhere |
| D-18 | `charges.js` short-direction error ₹0.32/tr (Board's prior ₹157.62 figure retracted) | MEASURED | 045 §0.4 | certain | L/L/L | fix for correctness only |
| D-19 | Performance envelope never measured; JSON+`readdirSync` on hot paths | UNKNOWN (≤3/10) | 026 | — | L/M/L | capture one baseline |
| D-20 | 11 built-correct-unused components (auth, validators, contracts, reset, sizer, module surfaces…) | VERIFIED | 050 §0.1 | certain | M/H/H | consultation, not construction |

---

# IMMEDIATE PRIORITIES (ranked by value ÷ cost)
1. Rescue C-04 (one copy) and C-03 (blob exhumation) — both deadline-bound, near-zero cost.
2. Neutralize C-05: operator's one-line ONLOGON task + open-book persistence for 3 engines.
3. Arm C-02: persistent trial counter feeding `deflatedSharpe`.
4. Close C-07's evidence hole: persist the shown confidence.
5. Zero-weight the phantoms (M-08) — free, pure correctness.

# RESEARCH PRIORITIES
Pre-registered, cost-realistic forward test of the residual edge (R1); ≥200 labelled outcomes;
regime gates fixed before observation; fix the 8 remaining look-ahead files and re-derive every
historical number; expectancy as the reported quantity.

# ENGINEERING PRIORITIES
Durable evidence (books, confidence, results-append); session-independent supervision; unknown⇒block
coercion sweep (119 sites); authenticated or loopback-bound control plane; deletion logging.

# ARCHITECTURE PRIORITIES
Single RiskAuthority consulted by every verdict surface; model registry with spec-hash; dataset/
retention registry under `safe-write`; feature persistence; consult the 11 unused components before
building anything new.

# UNKNOWNS BLOCKING PROGRESS
U1 v1/v2 stats mixture (permanent) · U2 agreement-term sign · U3 displayed-confidence calibration
(blocked on persistence) · U4 liquidity-regime robustness (volume unloaded) · U5 oiUnit broker/BSE ·
U6 true slippage+margin profile · U7 performance envelope.

---

# SCORES (derived; sources cited)

| Score | Value | Derivation |
|---|---|---|
| **Institutional Health** | **3.6 / 10** | Review 002 composite (equal-weight, N/A excluded) |
| **Repository Maturity** | **Level 1 / 5** | data platform 0–1 (040), MDLC 0 (044), lifecycle 0–1 (039); docs 7/10 lift |
| **Scientific Maturity** | **Level 0 / 5** | research L0 (042), hypothesis L0 (043), validation L0–1 (045), calibration L0–1 (048) |
| **Engineering Maturity** | **Level 2 / 5** | money-path fail-closed + verified brake + 49/49 tests, offset by C-05/M-20 |
| **Risk Maturity** | **Level 1–2 / 5** | brake works when reached; no authority, blind surfaces, lying monitor |

---

# FINAL RECOMMENDATION

**PASS WITH CONDITIONS** — continued operation as a paper research platform, conditional on
Immediate Priorities 1–4 (deadline items first).

Component verdicts (unchanged, Reviews 001–002): live deployment **REJECT** · claimed 88–91% edge
**REJECT** · residual edge **INSUFFICIENT EVIDENCE** · confluence model as decision support
**REJECT** in current form.

**The audit's unifying discovery, stated once:** across fifty documents and fifty findings, the
platform's failures share one mechanism — *it builds correct instruments and does not consult them*.
The validator, the auth layer, the reset function, the hit-rate ledger, the brake, the honesty
parameter: all present, all correct, all unread. The repository does not need more construction.
It needs consultation.

— Independent Institutional Review Board, 2026-07-17
