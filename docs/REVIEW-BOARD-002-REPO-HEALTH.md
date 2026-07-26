# REVIEW BOARD — FORMAL REVIEW 002
## ANTIGRAVITY PRO — REPOSITORY HEALTH SCORECARD

**Authority:** Independent Scientific Review Board (Red Team)
**Date:** 2026-07-17 · **Basis:** audits 001–050, Review 001, live measurements 2026-07-13→17
**Scoring rule:** every score is DERIVED from a measured maturity level or a counted fact, with its
source cited. No score is invented. Where nothing was measured, the score is UNKNOWN — not a guess.

---

# 1. EXECUTIVE SUMMARY

A paper-trading research platform with **excellent explainability and honest paper evidence**, an
**invalidated flagship edge**, **self-erasing forward-test evidence**, and a **decision layer that
cannot see its own risk state**. Engineering quality is bimodal: the money path fails closed and its
brake has now fired correctly in production; the evidence path fails open almost everywhere.
Composite repository health: **3.6 / 10 (derived, equal-weight, excluding N/A)** — capped from below
by scientific and security dimensions, held up by documentation, explainability, and the paper-only
guarantee.

**Overall verdict: PASS WITH CONDITIONS** (as a paper research platform; same 5 conditions as
Review 001, restated in §22).

---

# 2. REPOSITORY HEALTH SCORE (composite)

| Dimension | Score /10 | Basis (measured source) |
|---|---|---|
| Scientific | **1** | Research maturity Level 0; 0 hypotheses; DSR disarmed (042/043/050) |
| Engineering | **5** | 49/49 suites; brake fired correctly; but persistence+availability broken (V6/V7) |
| Architecture | **4** | No black box; pure fusion; but risk-blind decisions, feature-store break (035/049) |
| Research | **2** | 8/11 artifacts invalidated; survivorship by deletion (042/043) |
| Risk | **4** | Money fails closed (012); monitoring lies (/api/risk, 013); paper-only caps severity |
| Performance | **UNKNOWN (≤3)** | No live baseline ever captured; perf-report never run (026) |
| Documentation | **7** | 93 docs incl. 52 audits; but runbook contradicts reality (029) |
| Security | **1** | 0/172 routes authed; 0.0.0.0 bind; published default key (023) |
| Regulatory | **N/A** | Private, paper, no clients, no live orders; see §10 |
| **Composite (derived)** | **3.6 / 10** | equal weights, N/A and UNKNOWN excluded |

# 3. SCIENTIFIC HEALTH — 1/10

Measured: 0 pre-registered hypotheses; 37 experiments deleted; the one multiple-testing correction
in the codebase is fed `nTrials=1`; 0/25 results carry provenance; contaminated column consumed by
9 files, fix applied to 1. The single correctly-run scientific act on record: the NIFTY directional
strategy tested over 1,200 trades, found PF 0.94, disabled, and documented.

# 4. ENGINEERING HEALTH — 5/10

Strong: `safe-write.js` (atomic, .bak, 28 dependents, 7/7 backups verified); the C3-07 fail-closed
brake **fired in production on 2026-07-14 and worked**; 49/49 test suites; all 7 order sites guarded.
Weak: 3 of 5 engines lose their open book on restart (observed twice, live); the process supervisor
dies with the operator's shell (12 daemon restarts logged); silent `catch(_){}` deletions; 119
`|| 0` sites including a fail-open event-risk gate.

# 5. ARCHITECTURE HEALTH — 4/10

Strong: zero opaque models; pure deterministic fusion; genuine abstention (`minFactors:4`); one
verified SPOF that is also the best file in the repo. Weak: the decision engine has zero
capital-risk inputs and the circuit-breaker is read by none of the four verdict consumers; features
computed then discarded; 11 built-correct-unused components; lineage not statically derivable
(45/55 variable write paths).

# 6. RESEARCH HEALTH — 2/10

The flagship claim is a measured artefact; the residual edge fails honest deflation and is
concentrated (88% of profit in DTE 1–2; 71% in 2025; negative at vol ≥15%). The paper ledgers are
the only clean evidence stream — and they are currently being censored by restarts (D4, Review 001).

# 7. RISK HEALTH — 4/10

Live-money risk: **NONE** (verified paper-only). Within-paper risk controls: per-engine daily-loss
caps exist and the central brake works when reached — but there is no single risk authority, the
recommendation surface is ungated, and `/api/risk` reports env defaults instead of engine state.

# 8. PERFORMANCE HEALTH — UNKNOWN (≤3)

No load test, no latency baseline, no live profiling has ever been captured (026). JSON-file
persistence with `readdirSync` in hot paths. The Board declines to score what was never measured;
the ceiling estimate reflects known I/O patterns only.

# 9. DOCUMENTATION HEALTH — 7/10

93 markdown documents, 52 of them evidence-backed audits with reproducible harnesses — likely the
best-documented dimension of the project. Deductions: the operational runbook actively misleads
(recommends bare `node server.js`; recommends deleting the unbacked config), and pre-audit
documentation asserted the invalidated 89% claim as fact.

# 10. REGULATORY HEALTH — N/A (with forward obligations)

Current state: private individual, paper trading, no client funds, no order routing → no active
regulatory surface identified by this Board (the Board notes it is not legal counsel). Forward
obligations if ever commercialized: SEBI algo/signal white-box requirements (effective 2026-04-01)
would apply to distributed signals; the platform's missing audit trail (022) would fail any
regulated inspection. Classification: N/A now; UNKNOWN if productized.

# 11. CRITICAL FINDINGS (4)

1. **Irreplaceable dataset under a delete timer** — only complete intraday session inside FIFO-40; ~35 sessions to silent deletion (039).
2. **Research history one `git gc` from permanent loss** — 37 deleted experiments exist only as unreferenced blobs (043).
3. **Evidence self-erasure** — session-coupled daemon death × non-persistent open books destroys forward-test records; observed twice (V6×V7).
4. **Honesty parameter disarmed** — `deflatedSharpe(pnls, nTrials || 1)`: the platform's only defense against its own 50+ trials, fed the one value that cannot fail (050).

# 12. MAJOR FINDINGS (7)

1. Look-ahead remains in 8 of 9 contaminated strategy files (042).
2. Model silently re-specified under its learned state; artifact unversioned and untracked (044).
3. Displayed "probability" is an uncalibrated heuristic; shown value discarded 20/21 times; gates real decisions and renders on 6 dashboards (046/048).
4. Decision layer capital-risk-blind; brake read by zero consumers (049).
5. Security: 0/172 authed routes on LAN-exposed bind; HTTP-deletable unbacked config (023/039).
6. Ensemble phantoms: 2 of 9 members never vote yet carry weight; N_eff 3.71 of 7 (047).
7. `/api/risk` reports fabricated state (env defaults, day-scoped recompute) (013).

# 13. MEDIUM FINDINGS (6)

1. bounce-engine prices nothing — 20+ positions with UNKNOWN P&L (live, positions-book).
2. `(eventRisk || 0) < 70` — gate opens on feed outage (049).
3. `.env` is a decoy — config-overrides silently wins (004).
4. `opthl` FIFO-120 silent deletion (039).
5. `bt-lib` lot from `rows[0]` — wrong 27/600 days (032).
6. Results overwritten in place — no experiment history (015).

# 14. MINOR FINDINGS (4)

1. `charges.js` short-direction error — ₹0.32/trade, immaterial (045; supersedes the retracted ₹157.62).
2. Upstox watchlist 429 spam in error.log (rate-limit hygiene).
3. Yahoo-survey noise in logs.
4. Dashboard referenced undefined `--warn` CSS var (fixed during session; noted for the record).

# 15. HIDDEN RISKS

- PM2 daemon lifetime coupled to operator shell (now diagnosed; recurs until the ONLOGON task exists).
- Cross-version contamination inside the live model's statistics — invisible by construction (U1).
- The unvalidated agreement term: every aligned-legs event raises displayed confidence with unknown sign of merit (U2).
- Silent-catch deletions: failures cannot even be observed where data is destroyed.
- A future operator "cleanup" repeating `3e388d1` — the pattern that already destroyed the control group once.

# 16. TECHNICAL DEBT

11 built-correct-unused components; 119 `||0` coercions; 45/55 unaddressable write sites; no feature
store (recompute-and-discard on every tick); no model registry; no audit trail; 8 contaminated
backtest files pending the one-line fix; monolithic 7,350-line server.js with 172 routes.

# 17. UNKNOWNS

U1 v1/v2 stats mixture (permanent) · U2 agreement-term sign · U3 true calibration of displayed
confidence (unverifiable until persisted) · U4 liquidity-regime robustness · U5 oiUnit (broker/BSE)
· U6 true slippage+margin profile · U7 performance envelope (never measured).

# 18. MISSING EVIDENCE

Per Review 001 §13: ≥200 labelled outcomes; persistent trial counter; persisted shown-confidence;
pre-registered regime gates; slippage/margin model; restored experiment corpus; model version field;
any live performance baseline.

# 19. REJECTED CLAIMS

"88–91% strangle win" · "89% validated by real backtest" · "the platform's probability is calibrated"
· "9-factor ensemble" (effective 3.7) · "risk-managed decisions" (risk not an input) ·
Board's own prior "₹157.62/trade charges error" (self-rejected, remeasured ₹0.32).

# 20. VERIFIED CLAIMS

100% paper (all order sites guarded) · brake fires at threshold (production log) · deterministic
replay byte-identical · bhavcopy integrity (600 files, 0 dup/empty, 0% missing fields) · safe-write
atomicity + backup verification 7/7 · full local explainability 21/21 · VRP stand-down gate operating
as designed (live logs) · positions book refuses to fabricate unknown P&L (56 assertions + live).

# 21. IMMEDIATE ACTIONS (this week; owner/engineering, not Board)

1. Copy `opt-candles/2026-07-08.json` out of the FIFO directory.
2. Exhume the 37 deleted experiments from git blobs into `docs/research-archive/`.
3. Operator runs the one-line ONLOGON task (launcher already exists).
4. Persist open books for strangle/bounce/gamma-blast.
5. Wire the trial counter into `deflatedSharpe`; stop passing 1.
6. Persist the shown confidence (route inline `learn()` through the tracked path).

# 22. LONG TERM ACTIONS

Fix the 8 remaining look-ahead files and re-run every historical claim · model registry + spec-hash
+ version-controlled artifact · hypothesis registry with pre-registered nulls · evidence column and
expectancy display · single RiskAuthority read by every decision surface · authenticated control
plane (auth.js exists) · feature persistence · append-only results.

# 23. INSTITUTIONAL RECOMMENDATION

**PASS WITH CONDITIONS** — as a paper-trading research platform, conditional on §21 items 1–5.

Component verdicts unchanged from Review 001: live deployment **REJECT**; claimed edge **REJECT**;
residual edge **INSUFFICIENT EVIDENCE**; confluence model as decision support **REJECT** in current
form.

The repository's defining property remains: it builds correct instruments and does not consult
them. Its health ceiling is set not by what is missing but by what is unread.

— Independent Scientific Review Board, 2026-07-17
