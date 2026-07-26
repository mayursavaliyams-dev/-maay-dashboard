# 015 — RESEARCH PLATFORM, EXPERIMENT MANAGEMENT & SCIENTIFIC WORKFLOW

**Standard:** Master Prompt 015 · **Depends on:** 000-A…E, 001-A…F, 002…014
**Date:** 2026-07-12 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No strategy optimized. No production deployment authorized.**

---

# SECTION 0 — THE FINDING

**015's rule: *"Ensure invalidated evidence remains traceable and is not silently discarded."***

> ## 🔴 **BOTH HALVES OF THAT RULE ARE BROKEN — IN OPPOSITE DIRECTIONS, IN THE SAME DIRECTORY.**

## A. An **invalidated** result is still on disk, presented as **valid**

```
bt-data/result-strangle-costs.json   (slip = 0)
  { "trades": 129, "winPct": 91, "net": 441104, "final": 541104, "maxDDpct": 5.9 }
```

**91% win rate. +₹4,41,104.** This is **the look-ahead artefact** — the number
`docs/REVIEW-selling-edge-invalidated.md` demolished, and that `bt-validate.js` now scores at
**`FAIL (likely overfit)`**.

**It is unchanged. It is unmarked. It carries no `invalidated` flag, no `supersededBy`, no warning.**

> **Any reader — a human, a script, or a future maintainer — who opens `result-strangle-costs.json`
> takes 91% and ₹4.4 lakh at face value. The refutation lives in a different file, in a different
> format, that nothing links to.**

## B. A **superseded** result was **silently destroyed** — **by my own fix**

```
bt-data/result-validate.json   BEFORE 002:  win 91.5%, DSR 0.9999, "PASS (edge real @95%)"
                               AFTER  002:  Sharpe −0.1197, DSR 0.0008, "FAIL (likely overfit)"
```

**`bt-validate.js` overwrites its result file in place.** When I fixed the look-ahead (002), the run
**destroyed the evidence of what the harness used to claim.** No `.bak`. No `supersededBy`. No history.

> **The before/after comparison — the single most important piece of evidence this project has ever
> produced — survives ONLY because I happened to paste it into `docs/002-STABILIZATION-REPORT.md`
> before re-running.**
>
> **Had I not, the fact that this platform's validator once certified an artefact at 95% confidence
> would be unrecoverable. The artefact would simply have become a number that was always FAIL.**

## C. Zero result files carry any invalidation marker

```
grep -rl "INVALID|supersede|deprecat|DO NOT USE" bt-data/*.json   →   (nothing)
```

**15 result files. Zero markers. Zero provenance.** *(008 P9-A: **0 of 13 scripts record a git SHA.**)*

---

# PART 1 — RESEARCH INVENTORY

| Asset | Count | Owner | Status |
|---|---|---|---|
| **`docs/*.md`** | **59** | 🔴 none declared | 🟢 **The de-facto evidence repository — and it is genuinely strong** |
| **Approval documents** | **8** (`docs/APPROVAL-*.md`) | owner | 🟡 **7 awaiting decision** |
| **Negative findings** | **2** (`REVIEW-bt-real-lookahead`, `REVIEW-selling-edge-invalidated`) | — | 🟢 **Preserved, and central** |
| **Evidence documents** | **1** (`EVIDENCE-F4-oi-unit.md`) | — | 🟢 **Reproducible: `node scripts/verify-oi-unit.js`** |
| **Backtest scripts** | **13** | 🔴 **NOBODY** | 🔴 7 of 8 still carry look-ahead |
| **Result artefacts** | **15** | 🔴 **NOBODY** | 🔴 **§0 — unmarked, unprovenanced, mutually incompatible schemas** |
| **Test suites** | **48** | — | 🟢 **exit-code gated, characterization-first** |
| **Paper datasets** | 6 ledgers | per-engine | 🔴 5 of 14 required fields missing everywhere (010) |
| **Statistical reports** | 1 (`result-validate.json`) | — | 🟡 **overwritten in place (§0.B)** |
| **Architecture reviews** | **14** (001-B…015) | — | 🟢 |

---

# PART 2 — RESEARCH LIFECYCLE

```
 Hypothesis → Research Plan → Implementation → Backtest → Validation →
 Paper → Evidence Review → Promotion Decision → Production Candidate → Archive
     ↓            ↓                                  ↓          ↓            ↓
     │            │                                  │          │            └── 🔴 4 STRATEGIES
     │            │                                  │          │                ARE LIVE. NONE
     │            │                                  │          │                WAS PROMOTED.
     │            │                                  │          └── 🔴 NO PROMOTION GATE EXISTS.
     │            │                                  └── 🔴 0 of 8 strategies passed validation.
     │            └── 🔴 NO RESEARCH PLAN EXISTS FOR ANY STRATEGY.
     └── 🔴 NO HYPOTHESIS IS WRITTEN DOWN. Not one.
```

## Entry/exit criteria per transition: **DOCUMENTED FOR ZERO TRANSITIONS.**

**Not one strategy in this repository has a written hypothesis.** The volatility risk premium — the
entire thesis of the platform — **is never stated as a falsifiable claim anywhere.** It is implied by
the existence of `strangle-engine.js`.

---

# PART 3 — EXPERIMENT MANAGEMENT

## 🔴 **EXPERIMENT IDENTITY DOES NOT EXIST**

```
grep -rl "experimentId"  →  0 files
grep -rl "runId"         →  0 files
grep -rl "hypothesisId"  →  0 files
grep -rl "EXP-"          →  0 files
```

**No experiment in this platform has an identifier.**

| Required per experiment (015 Part 3) | Present? |
|---|---|
| **Identifier** | 🔴 **NO** |
| **Objective** | 🔴 **NO — no hypothesis is written** |
| Dataset | 🟡 implied (`bt-data/bhav`) — **no version, no hash** |
| **Code revision** | 🔴 **NO — 0 of 13 scripts record a git SHA** |
| **Configuration** | 🔴 **2 of 13** |
| **Parameters** | 🔴 **1 of 13** |
| **Assumptions** | 🔴 **NO — undocumented until this audit programme** |
| Results | 🟢 15 files — **mutually incompatible schemas** |
| **Conclusions** | 🟡 **in `docs/`, not linked to the artefact** |
| **Evidence quality** | 🔴 **NO** |

## ## **Reproducible? → UNKNOWN. 015's stop condition applies.**

**`result-strangle-costs.json` holds the PF that justified a ₹7L allocation. It does not record which
version of `bt-lib.js` produced it — before or after the 2026-07-10 lot fix. That is unknowable from the
artefact, and the artefact is the only thing a future researcher will find.**

---

# PART 4 — REPRODUCIBILITY

| Requirement | Present? |
|---|---|
| **Dataset version / hash** | 🔴 **NO** — the data is on disk and re-downloadable 🟢, but **no run records which snapshot it used** |
| **Code revision** | 🔴 **NO — 0 of 13** |
| **Configuration snapshot** | 🔴 **2 of 13** |
| **Random seed** | ⚪ **N/A — nothing is random.** 🟢 **Trade generation IS deterministic** (008 Part 3) |
| **Environment definition** | 🟡 `package.json` + `package-lock.json` 🟢 · **no Node version pin, no container** |
| **Dependencies** | 🟢 `package-lock.json` |

## 🟡 The honest picture

> **The experiments ARE deterministic — same inputs, same trades, every time. That is real and it is
> valuable.**
>
> **But no artefact records what its inputs WERE.** Determinism without provenance is reproducibility
> you cannot *invoke*: you can re-run the script today, but **you cannot re-run the script that produced
> the number you are looking at.**

---

# PART 5 — EVIDENCE GOVERNANCE

| Class | Managed? |
|---|---|
| **Positive findings** | 🔴 **BADLY.** `result-strangle-costs.json` still presents an invalidated 91% win rate as fact (§0.A) |
| **Negative findings** | 🟢 **WELL.** `REVIEW-selling-edge-invalidated.md` and `REVIEW-bt-real-lookahead.md` are **preserved, detailed, and central to the project's own narrative** |
| **Invalidated results** | 🔴 **BOTH FAILURE MODES (§0):** one left on disk as valid, one silently overwritten |
| **Failed experiments** | 🟢 **Preserved.** `bt-real.js`'s PF 0.94 is documented and was **not** buried |
| **Open questions** | 🟢 **Tracked and explicit:** E1 (STT rates) · F4-BSE (`oi_unit`) · M2 (200 outcomes) · A-13 (broker OI unit) · the `r` in `bsGamma` |
| **Pending investigations** | 🟢 **8 approval packages, 7 awaiting a decision** |

## 🟢 What is genuinely excellent

**This project's *narrative* evidence governance is stronger than most professional research desks.**

- **It preserved the results that killed its own thesis.** `REVIEW-selling-edge-invalidated.md` is a
  document whose sole purpose is to destroy the platform's reason for existing, and it was written,
  kept, and cited.
- **Its git history is honest.** `7823864 — fix(evidence): the platform's two edge claims were
  look-ahead artefacts`. **That is a commit message most teams would never write.**
- **Every open question is named, with the measurement that would settle it, and marked UNKNOWN rather
  than guessed.**
- **Every audit in this programme records its own author's errors** — seven false positives, one
  wrong claim published four times, one retraction that was itself wrong.

## 🔴 What is broken

**The *artefact* evidence governance.** The `docs/` prose knows the truth. **The `bt-data/` JSON does
not, and it is the JSON a machine will read.**

> **The refutation and the artefact it refutes have no link between them. Nothing in
> `result-strangle-costs.json` points to `REVIEW-selling-edge-invalidated.md`, and nothing in the
> review points back to the file. The connection exists only in a human's memory.**

---

# PART 6 — PROMOTION GOVERNANCE

| Gate | Exists? |
|---|---|
| Prototype → Backtested | 🔴 **NO** |
| Backtested → Validated | 🔴 **NO** |
| Validated → Paper | 🔴 **NO** |
| Paper → Production Candidate | 🔴 **NO** |
| Production Candidate → Live | 🟢 **YES — and it is the ONE that holds.** `TRADE_MODE=paper`, never persisted, 6 gates in 001-E |

## 🔴 Promotion without validation — **four confirmed cases**

| Strategy | Promoted to | On what evidence? |
|---|---|---|
| **Iron condor** (LIVE, ₹7L, auto ON) | Paper | 🔴 **A backtest of a DIFFERENT STRUCTURE** (007 §0) — the cited backtest models a naked strangle and now scores `FAIL` |
| **Directional buying** (LIVE, auto ON) | Paper | 🔴 **A REFUTED backtest** (PF 0.94), with **two** look-aheads and **zero** cost model |
| **Afternoon** (LIVE, auto ON ×2) | Paper | 🔴 **NO BACKTEST EXISTS AT ALL** |
| **Agents / Bounce** (LIVE) | Paper | 🔴 **NO BACKTEST EXISTS AT ALL** |
| **Gamma blast** (LIVE) | Paper | 🟢 **HONEST** — declares itself not backtestable; forward-test only. **The only clean promotion in the platform** |

> **Six engines are enabled. Five were promoted on evidence that is invalid, absent, or about a
> different strategy. The sixth was promoted honestly, by declaring it had no evidence at all.**
>
> **There is no promotion board, no gate, and no artefact that records a promotion decision. An engine
> is "promoted" by someone setting a boolean to `true` in `config-overrides.json`.**

---

# PART 7 — RESEARCH STATE

| State | Owner | Persisted? |
|---|---|---|
| **Active hypotheses** | 🔴 **NONE WRITTEN** | — |
| **Running experiments** | 🟡 the paper bot | 🔴 **and it loses open positions on restart** (010 §0) |
| **Pending validations** | 🔴 **8 strategy scripts, 7 still leaking** | `docs/` |
| **Blocked investigations** | 🟢 **E1 · F4-BSE · M2 · A-13 · `r`** — all named, all UNKNOWN, none guessed | `docs/` |
| **Invalidated strategies** | 🟡 **Documented in prose. NOT marked in the artefacts (§0)** | `docs/` only |
| **Evidence backlog** | 🔴 **12 canonical labelled outcomes vs M2's ~200 = 6%** | ledgers |

---

# PART 8 — OBSERVABILITY

| Required per research activity | Recorded? |
|---|---|
| Timestamp | 🟡 `generatedAt` in **3 of 15** |
| **Research ID / Experiment ID** | 🔴 **DO NOT EXIST** |
| **Dataset version** | 🔴 **NO** |
| **Code revision** | 🔴 **NO** |
| **Researcher action** | 🟢 **git history — and it is honest and detailed** |
| Outcome | 🟢 result files |
| **Supporting evidence** | 🟡 **in `docs/`, unlinked to the artefact** |

> **git is the only real research audit log this platform has — and it is a good one.**
> **But git tracks CODE. It does not link a RESULT to the CODE that made it, and no artefact does either.**

---

# PART 9 — FAILURE MODE REGISTER

| ID | Failure | Present? | Impact |
|---|---|---|---|
| **RS-1** | **Invalidated result presented as valid** | 🔴 **CONFIRMED (§0.A)** | **CRITICAL — a future reader trusts 91% and ₹4.4L** |
| **RS-2** | **Superseded result silently destroyed** | 🔴 **CONFIRMED (§0.B) — by my own fix** | **CRITICAL — the platform's most important before/after survives only in prose I happened to write** |
| **RS-3** | **Untracked parameter changes** | 🔴 **CONFIRMED** | `bt-real.js`'s 9 constants have **no history, no ADR, no justification** |
| **RS-4** | **Undocumented assumptions** | 🔴 **WAS confirmed — now documented** (008 Part 4: 0 verified, 7 assumed, 2 unknown) | Fixed by this programme |
| **RS-5** | **Promotion without validation** | 🔴 **CONFIRMED — 5 of 6 engines** (Part 6) | **CRITICAL** |
| **RS-6** | **Contradictory findings** | 🔴 **CONFIRMED** | Two `bsGamma`s disagree on `r`; `maxDD` means a fraction in one script and points in another |
| **RS-7** | **Missing datasets** | 🟢 **NO** — the bhavcopy is intact and re-downloadable | — |
| **RS-8** | **Lost experiment results** | 🔴 **CONFIRMED — RS-2** | — |
| **RS-9** | **Incomplete evidence** | 🔴 **CONFIRMED** — 12 outcomes, 4 days, 1 instrument | **Blocks everything** |

---

# PART 10 — RESEARCH ARCHITECTURE (conceptual — no code)

```
   ExperimentRegistry  ★
     experimentId · hypothesisId · objective · datasetHash · gitSha · params ·
     assumptions[] · nTrials · result · verdict · supersededBy · supersedes
     🔴 An experiment WITHOUT an id does not exist.
     🔴 nTrials is READ FROM THE REGISTRY, never hand-typed.        → kills 009 §0

   EvidenceRepository  ★
     Every CLAIM is a row: claimId · experimentId · statement · status ·
                           evidence[] · refutedBy · refutes
     🔴 A REFUTATION LINKS TO THE ARTEFACT IT REFUTES, AND THE ARTEFACT LINKS BACK.
     🔴 An invalidated result is MARKED, NEVER DELETED, NEVER LEFT LOOKING VALID.
                                                                    → kills §0.A AND §0.B

   DatasetRegistry     datasetHash → the exact snapshot. Immutable.

   ValidationPipeline  temporal-integrity → costs → sizing → WF → k-fold →
                       bootstrap → MC → DSR → paper → calibration
     🔴 STAGE 1 IS A HARD GATE. 009 §0 proved no downstream statistic detects look-ahead.

   PromotionBoard  ★
     promote(strategyId, toLevel) REQUIRES: a validated experiment whose
     STRUCTURE MATCHES the live structure.
     🔴 This one rule makes 007 §0 impossible.
     🔴 A promotion is an ARTEFACT with a decision, a date and an evidence list —
        not a boolean flipped in a config file.

   ResearchAuditLog    every run, every claim, every promotion, every refutation.
```

## The one rule that would have prevented §0

> **A result file is not a number. It is a claim, and a claim has a status.**
> **When a claim is refuted, the refutation must reach the artefact — or the artefact keeps lying.**

---

# PART 11 — TESTING STRATEGY

| Test | Priority |
|---|---|
| 🔴 **Every result file carries `{experimentId, gitSha, datasetHash, params, status}` — or the write is REJECTED** | **P0 — §0** |
| 🔴 **An invalidated result is MARKED, and its marker points at the refutation** | **P0 — §0.A** |
| 🔴 **A result file is NEVER overwritten in place — a new run is a new row** | **P0 — §0.B** |
| 🔴 **A strategy cannot be enabled unless a validated experiment exists whose STRUCTURE matches** | **P0 — Part 6 / 007 §0** |
| **Two runs of the same experiment produce byte-identical trades** | P1 — determinism 🟢 (already true) |
| **`nTrials` is read from the registry** | P1 — 009 §0 |
| Archive consistency: every claim in `docs/` links to an artefact, and back | P1 |

---

# PART 12 — RESEARCH MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Ad Hoc** | 🟢 | 13 scripts exist |
| **1 — Documented Experiments** | 🟡 **PARTIAL** | 🟢 **59 docs, 2 preserved refutations, honest git history — genuinely strong** · 🔴 **but 0 experiments have an identifier, an objective, or a written hypothesis** |
| **2 — Reproducible Research** | 🔴 **NO** | **0 of 13 scripts record a code revision.** Deterministic, but unprovenanced |
| **3 — Evidence Governance** | 🔴 **NO** | **§0 — invalidated evidence is both left looking valid AND silently destroyed** |
| **4 — Scientific Workflow** | 🔴 **NO** | **No hypothesis, no plan, no promotion gate.** 5 of 6 engines promoted without validation |
| **5 — Production Research Platform** | 🔴 **NO** | — |

## ## **Research Platform: LEVEL 1 — DOCUMENTED EXPERIMENTS (partial).**

**The prose is at Level 3. The artefacts are at Level 0. The platform's maturity is the artefacts',
because that is what a machine reads and what a future researcher will find.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE — this document** | — | none | 59 docs, 15 artefacts, 0 experiment ids |
| **2 — Experiment registry** | **A `RunManifest` on every result: `experimentId`, `gitSha`, `datasetHash`, `params`, `nTrials`, `status`.** Reject a write without one | Phase 1 | **Low — additive.** Old artefacts get a manifest retro-fitted **where the git SHA is knowable, and marked `provenance: UNKNOWN` where it is not** | **Every new result names the code that made it** |
| **3 — Evidence governance** | 🔴 **MARK `result-strangle-costs.json` as INVALIDATED, pointing at `REVIEW-selling-edge-invalidated.md`.** 🔴 **Never overwrite a result in place again.** Link every refutation to its artefact, both ways | Phase 2 | **Low** | **§0.A and §0.B are both impossible** |
| **4 — Promotion governance** | **A `PromotionBoard` artefact.** A strategy may not be enabled without a validated experiment **whose structure matches the live structure** | Phase 3 | 🔴 **This would DISABLE 5 of the 6 running engines. That is the correct outcome** | **Every enabled strategy names the experiment that justifies it** |
| **5 — Scientific reproducibility** | Written hypotheses. Entry/exit criteria per lifecycle stage. `ResearchAuditLog` | Phase 4 | Medium | **Any experiment can be re-run from its artefact alone** |

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every experiment has a unique identity | 🔴 **NO — zero do** |
| Every conclusion is supported by traceable evidence | 🟡 **In prose: yes. In artefacts: no link exists** |
| **Invalidated findings remain documented** | 🔴 **NO — §0. One left looking valid, one destroyed** |
| Research is reproducible | 🔴 **NO — deterministic, but unprovenanced** |
| Promotion decisions are evidence-based | 🔴 **NO — 5 of 6 engines promoted without valid evidence** |
| Research history is auditable | 🟡 **git: yes, and honestly. Artefacts: no** |
| Scientific workflow consistently followed | 🔴 **NO — no hypothesis is written down anywhere** |

## **0 of 7 fully. 2 partially.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent researcher reproduce every experiment, verify every conclusion,
understand every promotion, and audit the complete scientific history?**

## **They could read the history. They could not reproduce a single experiment, and they would be misled by the artefacts.**

🟢 **What this project does better than most professional research desks:**

- **It preserved the evidence that killed its own thesis.** `REVIEW-selling-edge-invalidated.md` exists
  for one purpose — to destroy the platform's reason for being — and it was written, kept, and cited.
- **Its git history is honest.** *`fix(evidence): the platform's two edge claims were look-ahead
  artefacts`* is a commit message most teams would never write.
- **Every unknown is named, not guessed.** E1, F4-BSE, M2, A-13, the ownerless `r` — each carries the
  measurement that would settle it, and each is marked UNKNOWN.
- **Every audit in this programme records its own author's mistakes.** Seven false positives. One
  HIGH-severity claim published four times and then retracted. One retraction that was itself wrong.

🔴 **And what breaks all of it:**

> **The prose knows the truth. The artefacts do not — and the artefacts are what a machine reads.**
>
> **`bt-data/result-strangle-costs.json` still contains `winPct: 91, net: ₹4,41,104` — the look-ahead
> artefact — unchanged, unmarked, with no link to the review that destroyed it. Anyone who opens that
> file believes it.**
>
> **And `bt-data/result-validate.json` — which once said `DSR 0.9999, PASS (edge real @95%)` — was
> silently overwritten in place when I fixed the look-ahead. There is no `.bak` and no history. The
> single most important before/after this project has ever produced survives ONLY because I pasted it
> into a markdown file before re-running.**
>
> **Zero of fifteen result files carry an invalidation marker. Zero of thirteen scripts record a code
> revision. Zero experiments have an identifier. And no strategy in this repository has a written
> hypothesis — not even the volatility risk premium, which is the entire thesis of the platform.**

**Five of six running engines were promoted on evidence that is invalid, absent, or about a different
strategy. The sixth — `gamma-blast-engine` — was promoted honestly, by declaring it had no evidence at
all. It is the only clean promotion in the platform.**

**The single highest-value research change:**

> ## **A result file is not a number. It is a CLAIM, and a claim has a STATUS.**
>
> **Mark `result-strangle-costs.json` as INVALIDATED and point it at the review that killed it. Stop
> overwriting results in place. Give every run a `gitSha`.**
>
> **Three changes, none of which touches a strategy — and after them, this platform stops lying to its
> own future.**

---

**Strategies optimized: NONE. Production deployment: NOT AUTHORIZED. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Research Inventory (Part 1) · Lifecycle (Part 2) · Experiment Registry Assessment
(Part 3) · Reproducibility Review (Part 4) · Evidence Governance (Part 5) · Promotion Governance
(Part 6) · Research State (Part 7) · Observability (Part 8) · Failure Modes (Part 9) · Architecture
Blueprint (Part 10) · Testing Strategy (Part 11) · Maturity Assessment (Part 12) · Migration Roadmap
(Part 13) · Executive Summary.
