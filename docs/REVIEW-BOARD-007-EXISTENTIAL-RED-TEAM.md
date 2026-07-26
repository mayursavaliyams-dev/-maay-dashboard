# REVIEW BOARD — FORMAL REVIEW 007
## ANTIGRAVITY PRO — EXISTENTIAL RED TEAM · "SHOULD THIS PROJECT EXIST?"

**Authority:** Independent Institutional Red Team · Mission-Critical Failure Review Board
**Date:** 2026-07-17 · **Basis:** the full adversarial record — 52 audits (each a measurement
attack), Reviews 001–006, production logs, git archaeology, live observation
**Mode:** Destruction testing. For every attack: evidence, counter-evidence, and an honest verdict —
*destroyed*, *survived*, or *unresolved*. Counter-evidence is mandatory; a red team that only
reports kills is a propaganda unit.

**Integrity note.** The instruction requests ~600 ranked entries. Its own rules — *never invent
facts; unknown remains unknown; counter-evidence is mandatory* — override the quotas. This report
contains every evidence-backed attack and every evidence-backed survival the record supports.
Padding an existential verdict with invented reasons would be the exact crime this project is
convicted of (manufactured confidence).

**Method note.** This project has already been under continuous measured attack for the entire
audit programme: every headline number was re-derived adversarially, every mechanism probed, the
git history exhumed, the live system killed and observed. Review 007's job is to consolidate the
kill-record honestly — and, for the first time, the survival-record with equal rigor.

---

# PART 1 — THE KILL RECORD (attacks that SUCCEEDED; the case against existence)

**Condensed — full evidence in the cited registers. These are destroyed, not disputed.**

| # | Belief attacked | Kill weapon | Status |
|---|---|---|---|
| K-01 | "88–91% edge exists" | one-line A/B on 599 real trades | **DESTROYED** (88.15→59.43% net) |
| K-02 | "Our validator certifies the edge" | nTrials ladder (1→100% PASS; 40→FAIL) | **DESTROYED** |
| K-03 | "Research was rigorous" | git exhumation: 37 studies deleted, optimizer ranked by win-rate | **DESTROYED** |
| K-04 | "The AI learns" | its own stats: 33.8%, corr(w,acc)=0.177, n=0 weights drifting | **DESTROYED** |
| K-05 | "The probability is a probability" | formula read + 20/21 discarded + 1/1 persisted→LOSS | **DESTROYED** |
| K-06 | "Nine independent signals" | vote census: 2 never vote, 1 near-constant, N_eff 3.71 | **DESTROYED** |
| K-07 | "Decisions are risk-aware" | input census 10/10 market; brake readers = 0 | **DESTROYED** |
| K-08 | "We'd halt at 8" | production: restored 15 sat unhalted; halt at 16 | **DESTROYED** (as stated) |
| K-09 | "Always-on under PM2" | pm2.log: 12 daemon deaths, all session-coupled | **DESTROYED** |
| K-10 | "Restarts are safe" | 24 then 20+ open positions destroyed, observed | **DESTROYED** |
| K-11 | "We are backed up" | 0/9 critical; 1 orphan; PIT = one write | **DESTROYED** |
| K-12 | "Results are reproducible" | 0/25 provenance; overwrite-in-place | **DESTROYED** |
| K-13 | "Costs are conservative" | slippage=0 modeled; ₹226/tr sensitivity = edge size | **DESTROYED** |
| K-14 | "Monitoring exists" | `/api/risk` fabricates; HALT line buried in 429 spam; MTTD ∞ precedent | **DESTROYED** |
| K-15 | "Security is handled" | 0/172 authed; 0.0.0.0; deletable unbacked config; published key | **DESTROYED** |

**Red-team summary of Part 1:** as an *edge-harvesting machine with institutional discipline* —
the thing the repository believed itself to be — **the project does not exist.** That entity was
destroyed by measurement, mostly using the project's own instruments.

# PART 2 — THE SURVIVAL RECORD (attacks that FAILED; the case for existence)

**Each entry: the attack mounted, and the counter-evidence that stopped it.**

| # | Attack | Counter-evidence — why it survived | Confidence |
|---|---|---|---|
| S-01 | "It secretly can trade real money" | line-verified: all 7 `placeOrder` sites guarded; early-return audit incl. the site 3 lines outside the first grep window; no live path found in 50 audits | HIGH |
| S-02 | "The paper ledger is fabricated/rigged" | append-through-safe-write; charges suite (26 asserts); P&L-verify panel reconciles; losses recorded faithfully incl. 16-streak; a rigged ledger does not persist its own 33.8% | MED-HIGH |
| S-03 | "No edge signal exists at all — pure noise" | after removing look-ahead AND costs: 26-fold walk-forward holds; 5/5 purged folds positive; bootstrap P(mean≤0)=0.05%; direction consistent with published VRP literature (Bakshi-Kapadia, Carr-Wu class) | MED — survives as *plausible*, killed as *proven* |
| S-04 | "The data foundation is rotten" | 600 files: 0 duplicates, 0 empty, 0% missing fields, stable 34-col schema; lot 65 confirmed by data to 2030 | HIGH |
| S-05 | "Determinism is a myth here" | byte-identical replay measured; seeded harnesses reproduce | HIGH |
| S-06 | "The brake is decorative" | it fired in production at the first evaluable event and disabled trading | HIGH (mechanism), with the K-08 bypass caveat |
| S-07 | "Atomic writes are claimed, not real" | temp+rename read in source; 7/7 `.bak` parse; 20 modules routed | HIGH |
| S-08 | "Explainability is a facade" | 21/21 decisions carry full leg attribution incl. the ones that embarrass the model | HIGH |
| S-09 | "All engines are reckless" | VRP gate observed standing down with stated reasons for days; `minFactors:4` abstention; `checks.every` fail-closed gate | HIGH |
| S-10 | "Nobody here ever did honest science" | NIFTY directional: 1,200 trades, PF 0.94, disabled, recorded; `agents-engine` measured its own 2.7× overshoot and shrank itself, in comments | HIGH |
| S-11 | "The audit itself is AI theater" | the audit retracted its own published number (₹157.62→₹0.32), logged 13 self-caught errors, and refused claims at p=0.209 twice — theater does not self-convict | MED-HIGH |
| S-12 | "Tests are green-washing" | characterization tests proven RED first (tripwire); repo-integrity test caught a real defect (untracked require) during this very programme | HIGH |
| S-13 | "The registry is another decoy" | fail-closed nulls verified; lot cross-checked against exchange data, not docs | HIGH |
| S-14 | "Nothing improved during audit" | measured deltas: honest positions book live (Unknown≠Zero enforced, 56 asserts); brake fail-closed fix committed; look-ahead tripwire committed | HIGH |

# PART 3 — UNRESOLVED ATTACKS (neither destroyed nor survived; UNKNOWN stands)

| # | Attack | Why unresolved |
|---|---|---|
| U-01 | "The residual edge is a bhav-open pricing artifact of DTE 1–2" | time-of-day sensitivity experiment never run (gap in 006 Part 4) |
| U-02 | "Slippage+margin make the true net edge negative" | no empirical friction anchor exists (CE-4/5); sensitivity says possible, not proven |
| U-03 | "The agreement term actively inverts confidence" | p=0.209, n=21 — underpowered both ways |
| U-04 | "Live-state labels leaked into the learner" | leakage cannot be excluded (018); cannot be demonstrated either |
| U-05 | "The paper P&L is contaminated by restart-censoring" | books destroyed on restarts — the surviving ledger may be a biased sample of itself; magnitude unmeasured |
| U-06 | "2025's profit was one regime that is gone" | 2026 Sharpe 0.70 is consistent with both decay and noise; insufficient span |

# PART 4 — STRONGEST vs WEAKEST (the honest asymmetry)

**Strongest assumptions (survived attack):** paper-only invariant · EOD data integrity · atomicity
core · determinism · fail-closed money-path philosophy (where wired) · explainability-by-design ·
abstention logic.
**Weakest assumptions (all destroyed):** agreement⇒correctness · v1≡v2 · P(win) relevance ·
zero-friction fills · unknown=0 · running=supervised · restart-safe state · "8 halts us".

**Strongest scientific argument FOR existence:** a cost-netted, look-ahead-free, walk-forward-stable
positive premium consistent with an economically-motivated, literature-documented risk premium (VRP)
— *found by the audit, not by the project*.
**Strongest scientific argument AGAINST:** the platform's search process (≥50 trials, survivor-only
records, no pre-registration) is statistically guaranteed to produce exactly such a survivor from
noise — and its own DSR, honestly parameterized, says so (41–55%).
**Red-team adjudication:** these two arguments currently annihilate to **UNKNOWN**. Only CE-1/2/4/5
evidence (006) can separate them. That is not a stalemate of opinion; it is a measured coin-flip.

# PART 5 — KILLERS (top, by domain; consolidated from Reviews 003–004 registers)

**Repository killers:** git-gc (A-01) · FIFO-40 (A-02) · single-SSD (A-15) · cleanup-culture (A-09).
**Architecture killers:** risk-blind decision layer (F-01) · authority-less risk (F-02) ·
feature-discard (F-03).
**Scientific killers:** disarmed nTrials (E-01) · destroyed control group (E-02) · unverifiable
calibration (E-06).
**Statistical killers:** n=12/21/130 inference · kurtosis-30 tails on 599 · post-hoc filter trap
staged (E-04).
**Operational killers:** session-coupled daemon (B-02) · zero alerting (D-03) · lying risk API
(D-04) · bus-factor 1 (D-12).
**Unknown killers:** U-01…U-06 above + oiUnit + disk-full + dual-writer incidence.

# PART 6 — TOP REASONS TO STOP vs CONTINUE (both sides, evidence-anchored)

**STOP (strongest 10):** the founding claim was false (K-01) · the search process manufactures
survivors (E-01/02) · evidence self-erases faster than it accrues (A-03) · the only real-money
vector is human belief in a fake number (A-11) · two irreplaceable assets are on countdown
(A-01/02) · calibration is unverifiable by construction until rewired · 19% evidence coverage ·
institutional readiness 1.5/10 · opportunity cost of operator time · the residual edge may be
friction-negative (U-02).
**CONTINUE (strongest 10):** the measurement stack now exists and works (it found everything) ·
the data foundation is verified and cheap to extend · a literature-consistent premium survived
honest attack as *plausible* (S-03) · the paper stream is the correct instrument to resolve it and
costs nothing but time · every Critical rescue is minutes-to-hours (004 closing) · the discipline
artifacts now exist (tripwires, registry, honest book) · genuine engineering assets (safe-write,
gates, brake) are reusable regardless of edge outcome · the honest-negative culture exists in
pockets (S-10) and can be generalized · abandonment forfeits the 12-labelled-outcome→200 pipeline
just as it starts · **the project's remaining question is empirically decidable** — few projects
can say that.

# PART 7 — SURVIVAL PROBABILITIES (Board ESTIMATES — declared as estimates, with bases)

| Probability | Estimate | Basis (declared) |
|---|---|---|
| Repository survival, 12mo, **current practice** | **~35%** | two scheduled irreversible losses + single-SSD + session-coupled ops (Review 004 scores) |
| Repository survival, 12mo, **conditions executed** | **~85%** | all Critical rescues are minutes-scale; residual = ordinary hazard |
| Scientific survival of residual edge under honest forward test | **UNKNOWN, bracketed ~40–55%** | DSR@40–100 = 41–55% is precisely the honest bracket; frictions unmodeled (U-02) push down |
| Engineering survival (mechanisms remain sound under continued audit) | **~80%** | survival record S-01…S-14; debt is wiring, not rot |
| Operational survival, 3mo unattended, current practice | **~15%** | 12 session-coupled deaths / 0 alerting / no boot hook |
| Institutional investment probability, today | **~0%** | Level-0 science, 1.5/10 readiness — no institution funds this state; not a value judgment on potential |

# PART 8 — FINAL VERDICT

## **PROJECT SHOULD CONTINUE** — narrowly, and under a changed identity.

**The red team failed to prove the project should not exist — but succeeded in proving that the
project it believed itself to be does not exist.** The entity that survives this attack is not an
edge-harvesting trading system. It is:

> **a verified-data, fully-explainable, paper-trading measurement instrument, currently pointed at
> one empirically decidable question — "does a friction-surviving VRP premium exist at retail scale
> in Indian index options?" — with a self-erasure defect that must be fixed before the instrument
> can answer it.**

As that entity, it survives on evidence: the question is real (S-03), the instrument is now proven
capable of honest measurement (the audit ran on it), the marginal cost of the answer is calendar
time, and every existential threat identified has a minutes-scale rescue (004). **PAUSE** would
forfeit accruing forward evidence for no risk reduction; **REDESIGN** is unjustified — the failures
are wiring and lifecycle, not foundations; **ABANDON** would discard a decidable question at the
moment it became decidable, which is the one scientifically indefensible option.

**Conditions carried forward (unchanged, survival-ordered — Reviews 001–006):** rescue the two
countdown assets · break the evidence-erasure loop · guard the destroyers · arm nTrials · persist
the confidence.

**The red team's closing statement.** We attacked this project with its own tools, and that is the
finding: *its tools are good.* Its beliefs were not. Strip the beliefs, keep the tools, let the
paper stream run honestly, and this project earns the right to exist — as an instrument, not as a
conviction. Trust is earned by surviving attack; what survived is listed in Part 2, and nothing
else.

— Independent Institutional Red Team, 2026-07-17
