# 043 — HYPOTHESIS REGISTRY, EXPERIMENT GOVERNANCE & RESEARCH KNOWLEDGE MANAGEMENT

**Standard:** Master Prompt 043 · **Depends on:** 000-A … 042
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No hypotheses created. No profitability evaluated.**

**043's stop condition: *"Never delete failed hypotheses simply because they produced negative results."***

**Audit 042 established that ZERO hypotheses are documented. So 043 did the only thing left: ARCHAEOLOGY.
I went into the git history to reconstruct the hypotheses from what survived. What I found there is worse
than an absent registry.**

---

# ═══════════════════════════════════════════════════════════
# SECTION 0 — THE RESEARCH GRAVEYARD
# ═══════════════════════════════════════════════════════════

## §0.1 — 🔴 An entire research programme was deleted in a commit labelled "junk"

```
  commit 3e388d1   2026-06-21
  "chore: full-program cleanup — untrack 18k caches + junk, drop orphan pages"

      18,330 files changed, 19 insertions(+), 1,876,936 deletions(-)
```

**Measured — strategy and backtest CODE files destroyed by that cleanup:**

```
  backtest-iron-condor.js            backtest-straddle-expiry.js       backtest-trend.js
  backtest-when-strategy-works.js    backtest-yearly-consistency.js    backtest-AB-compare.js
  backtest-compound-variants.js      backtest-cap-compare.js           backtest-half-compound.js
  backtest-500-expiries-15k.js       backtest-5L-90.js                 backtest-1L-current.js
  backtest-2cr-start.js              backtest-realistic-50k.js         backtest-15d.js
  backtest-daily.js                  export-backtest-excel.js          public/backtesting-pro.js
  backtest-real/strategy-ema.js      backtest-real/strategy-ema-orb.js
  backtest-real/strategy-hl-reversal.js                backtest-real/trade-simulator.js
  backtest-real/synth-option-pricer.js                 backtest-tv/run.js
  🔴 backtest-gate-postmortem.js     🔴 optimize-strategy.js
      … 37 files in total, plus 14 RESULT files — the evidence itself.
```

> ## 🔴 **THIRTY-SEVEN EXPERIMENTS AND FOURTEEN RESULT SETS WERE DELETED IN A COMMIT THAT CALLED THEM "JUNK".**
>
> **`backtest-gate-postmortem.js` is a POST-MORTEM — a written analysis of why something FAILED. It is
> precisely the artefact 043's stop condition exists to protect. It was deleted as junk.**
>
> **`backtest-when-strategy-works.js` is a REGIME STUDY — the exact question audits 007 and 015 later had
> to ask again from scratch, because the answer had been thrown away.**

**And the results went with the code. The hypotheses can be reconstructed from the FILENAMES. The findings
cannot be reconstructed at all — nobody knows whether the iron condor worked.**

## §0.2 — 🔴 I EXHUMED `optimize-strategy.js`. It is the smoking gun for audit 042.

**Recovered from the commit before its deletion. 292 lines. Its own header:**

```js
/**
 * STRATEGY OPTIMIZER
 * Tests dozens of parameter combinations and RANKS BY WIN RATE × avg multiplier
 * Finds the best signal filters for SENSEX expiry day options
 */
```

**Measured, from the recovered source:**

```
  configs in the grid                40      ◀── FORTY
  selection rule                     results.sort((a,b) => b.score - a.score)
                                     "STRATEGY OPTIMIZER — sorted by WinRate × AvgMult"
                                     "TOP 5 CONFIGS:"
  a hand-picked winner config        'BEST_GUESS'  ✓ present — a hand-assembled combination
                                                     of whichever knobs won
  option prices                      🔴 SYNTHETIC. Black-Scholes (`bs()`) over Yahoo index
                                        closes with `histVol()`. NO REAL OPTION PRICES AT ALL.
```

**The grid itself — forty ways to ask the same data the same question:**

```
  BASELINE · NO_MEDIUM · NO_MEDIUM+NOGAPCONT · STREAK1 · STREAK2 · STREAK1+NOMED · STREAK2+NOMED
  EMA_FILTER · EMA+NOMED · EMA+STREAK1 · EMA+STREAK1+NOMED · VOLEXP · VOLEXP+NOMED · VOLEXP+EMA
  VOLEXP+EMA+STREAK1 · VOLEXP+EMA+NOMED · HIGH_BODY_0.78 · HIGH_BODY_0.80 · HIGH_RANGE_1.3
  HIGH_RANGE_1.4 · HIGH_BODY+RANGE · TIGHT_ALL · TIGHT+STREAK1 · TIGHT+EMA · TIGHT+EMA+STREAK1
  TIGHT+EMA+STREAK2 · TIGHT+VOLEXP+EMA · TIGHT+VOLEXP+EMA+S1 · MINVOL_0.14 · MINVOL_0.14+NOMED
  MINVOL_0.14+EMA · ALL_ATM · ALL_ATM+NOMED · ALL_ATM+EMA+S1 · 🔴 BEST_GUESS
```

## 🔴 **WHAT THIS DOES TO AUDIT 042's VERDICT**

**042 put the surviving strangle edge through the platform's own Deflated Sharpe Ratio and measured:**

```
    DSR @  1 trial    100.00%   PASS
    DSR @ 10 trials    76.89%   FAIL (likely overfit)
    DSR @ 50 trials    51.21%   FAIL (likely overfit)
```

**042 estimated the platform's honest trial count at "a dozen or more" from the ten strangle variants still
on disk. That estimate was far too kind.**

> ## 🔴 **THIS ONE DELETED FILE SWEPT FORTY CONFIGURATIONS AND SELECTED THE WINNER BY WIN RATE. Add the ten surviving strangle variants, the thirty-seven other deleted backtest scripts, and every parameter chosen by hand along the way, and the platform's true trial count is not "dozens." It is comfortably past fifty, and plausibly in the hundreds.**
>
> **At nTrials = 50 the Deflated Sharpe already returns 51.21% — FAIL. The true number is worse.**
>
> ## **042 concluded the edge was not proven. 043 has recovered the evidence that makes it not proven BY A WIDER MARGIN — and that evidence had been deleted.**
>
> **And the optimizer never touched a real option price. It priced everything with Black-Scholes off Yahoo
> index closes. Whatever it "found," it found in a simulation of a market that does not exist.**

## §0.3 — 🔴 Only the WINNERS survived. This is textbook survivorship.

```
  DELETED (37 experiments):  iron condor · straddle-expiry · trend · EMA · EMA-ORB · HL-reversal ·
                             regime study · A/B compare · yearly consistency · 6 capital variants ·
                             🔴 the failure POST-MORTEM · 🔴 the 40-config OPTIMIZER

  SURVIVED:                  the short strangle — the one that produced the 88% number.
```

> ## **The platform's institutional memory contains exactly the ideas that appeared to work, and none of the ideas that did not. 043 names this failure mode explicitly: *"survivorship of successful ideas only."* It is not a risk here. It is the recorded history.**

---

# PART 1 — HYPOTHESIS INVENTORY (reconstructed by archaeology — no registry exists)

| ID | Hypothesis (reconstructed) | Source | Status | Evidence |
|---|---|---|---|---|
| **H-01** | Short strangles harvest the volatility risk premium | `bt-strategies.js` | 🟡 **PARTIAL** | 🔴 **88% claim = look-ahead.** 🟢 **59.4% net survives.** 🔴 **FAILS DSR at true nTrials** *(042, §0.2)* |
| **H-02** | Expiry-day gap continuation | `bt-real.js` | 🔴 **INVALIDATED** | 🔴 **perfect look-ahead — and loses anyway** *(042)* |
| **H-03** | NIFTY multi-confirm directional | disabled | 🟢 **HONESTLY INVALIDATED** | 🟢 **PF 0.94 over 1200 trades. THE ONE DONE RIGHT** |
| 🔴 **H-04** | **Iron condor** | 🔴 **`backtest-iron-condor.js` — DELETED** | 🔴 **UNKNOWN FOREVER** | 🔴 **evidence destroyed** |
| 🔴 **H-05** | **Expiry straddle** | 🔴 **`backtest-straddle-expiry.js` — DELETED** | 🔴 **UNKNOWN FOREVER** | 🔴 **destroyed** |
| 🔴 **H-06** | **EMA trend / ORB / HL-reversal (3 strategies)** | 🔴 **`backtest-real/` — DELETED** | 🔴 **UNKNOWN FOREVER** | 🔴 **destroyed** |
| 🔴 **H-07** | **"When does the strategy work?" — a REGIME hypothesis** | 🔴 **`backtest-when-strategy-works.js` — DELETED** | 🔴 **UNKNOWN FOREVER** | 🔴 **The question 007 and 015 later had to re-ask** |
| 🔴 **H-08** | **A failure POST-MORTEM** | 🔴 **`backtest-gate-postmortem.js` — DELETED** | 🔴 **LOST** | 🔴 **The exact artefact 043 exists to protect** |
| 🔴 **H-09** | **40-config signal-filter optimisation** | 🔴 **`optimize-strategy.js` — DELETED, EXHUMED (§0.2)** | 🔴 **INVALID — synthetic prices, ranked by win rate** | 🔴 **AND IT IS 042's MISSING nTrials** |
| **H-10** | Capital/compounding structure (6 variants) | 🔴 **all DELETED** | 🔴 **UNKNOWN** | 🔴 destroyed |
| **H-11** | 9 confluence factors predict direction | `confluence-learner` | 🔴 **INVALIDATED** | 🔴 **33.8% over 130 obs** *(041)* |
| **H-12** | Meta-labelling improves signal quality | `meta-label` | 🔴 **INVALIDATED** | 🔴 **AUC 0.685, permutation p = 0.191 = CHANCE** *(019)* |
| **H-13** | Gamma-blast on expiry day | `gamma-blast-engine` | ⚪ **UNKNOWN — honestly labelled** | ⚪ **"not backtestable"** |
| **H-14** | News → stock impact → index bias | `agents-engine` | 🟡 **WEAK — and DISCLOSED** | 🟢 **PF 0.94, stated in its own header** *(041)* |
| 🔴 **Risk / portfolio / execution hypotheses** | — | 🔴 **NONE EXIST** | 🔴 | 🔴 **Never formulated** |

## **14 reconstructible hypotheses. 7 are UNKNOWN FOREVER because their evidence was deleted. 0 were ever documented. 0 have an owner, a date, a null, or a success criterion.**

---

# PART 2 — HYPOTHESIS LIFECYCLE

```
  Observation      🟡  informal
       ↓
  🔴 Hypothesis    🔴  NEVER WRITTEN. Reconstructed today from FILENAMES.
       ↓
  🔴 Approval      🔴  NO APPROVAL STAGE EXISTS
       ↓
  Experiment       🟢  40+ ran — and 37 scripts were later DELETED
       ↓
  🔴 Validation    🔴  bt-validate.js: ZERO callers  (042)
       ↓
  🔴 Evidence Rev. 🔴  the optimizer RANKED BY WIN RATE — the opposite of review
       ↓
  Decision         🔴  made from a gross, contaminated, synthetically-priced win rate
       ↓
  🔴 ARCHIVE       🔴🔴  ══ NOT AN ARCHIVE. A DELETION. ══   §0.1
```

## 🔴 **The lifecycle's final stage is supposed to preserve. Here it destroys. `git` retains the blobs — but only because git is git, not because anyone decided to keep them.**

---

# PART 3 — HYPOTHESIS GOVERNANCE

| Required per hypothesis | Recorded? |
|---|---|
| Research objective · **Null hypothesis** · Alternative hypothesis · Success criteria · Failure criteria · Statistical requirements · Required datasets | 🔴 **0 of 7 — for all 14 hypotheses** |

> **Per 043 and 042: unknown assumptions remain UNKNOWN, and undocumented hypotheses remain exploratory.**
>
> ## **Not one of the fourteen hypotheses in Part 1 had a null. Without a null, a 40-config sweep sorted by win rate is not an experiment — it is a search that cannot fail.**

---

# PART 4 — EXPERIMENT TRACEABILITY

| Every experiment must record | Present? |
|---|---|
| Hypothesis ID · Dataset version · Feature version · **Code version** · Validation methodology · Results · **Limitations** · Final decision | 🔴 **0 of 8** |

**And 015 established that result files are OVERWRITTEN IN PLACE. So even where a result survived deletion,
only the LAST run of it exists. There is no experiment history — there is one snapshot of one run.**

## 🔴 **Per 043: *"Experiments without traceability are incomplete."* All of them are incomplete.**

---

# PART 5 — KNOWLEDGE PRESERVATION

| Must be preserved | Preserved? |
|---|---|
| 🔴 **Failed ideas** | 🔴 **DELETED — 37 scripts (§0.1)** |
| 🔴 **Invalidated strategies** | 🔴 **DELETED — iron condor, straddle, EMA, ORB, HL-reversal** |
| 🔴 **Negative findings** | 🔴 **DELETED — including a POST-MORTEM** |
| 🟡 **Lessons learned** | 🟡 **PARTIAL — the NIFTY directional PF 0.94 IS honestly recorded and the engine disabled. The single best act of research hygiene in this repository** |
| 🔴 **Research decisions** | 🔴 **NONE recorded** |
| 🟡 **Open questions** | 🟡 **PARTIAL — `agents-engine` writes "re-fit as the archive grows" in its own code** *(041)* |
| 🔴 **Future work** | 🔴 **NONE** |

> **043: *"Institutional memory must include failures as well as successes."***
>
> ## **This platform's institutional memory contains its successes and DELETED its failures. That is not an oversight in bookkeeping — it is the direct cause of audit 042's central finding. Nobody could deflate the Sharpe by the true trial count, because the trials had been thrown in the bin.**

---

# PART 6 — DECISION GOVERNANCE

| Status | Ever used? |
|---|---|
| Accepted | 🟡 implicitly — H-01, on a contaminated number |
| 🟢 **Rejected** | 🟢 **ONCE — H-03, NIFTY directional, PF 0.94, engine disabled** |
| **Invalidated** | 🔴 **never recorded as such — the file was just deleted** |
| **Inconclusive** | 🔴 **never used** |
| **Deferred** | 🔴 **never used** |
| **Superseded** | 🔴 **never used** |

## **6 statuses. 1 has ever been applied with evidence. The other five have no mechanism.**

---

# PART 7 — OBSERVABILITY

| Every hypothesis must record | Present? |
|---|---|
| Creation timestamp · Owner · Review history · Evidence references · Validation history · Final disposition | 🔴 **0 of 6** |

**The only timestamps that exist anywhere are git commit dates — and they record when a hypothesis was
DELETED, not when it was formed or what it concluded.**

---

# PART 8 — FAILURE MODE REGISTER

| Failure mode | Present? | Scientific impact |
|---|---|---|
| 🔴 **Undocumented hypotheses** | 🔴 **CONFIRMED — 14 of 14** | 🔴 **All research is exploratory by 042's own rule** |
| 🔴 **Lost experiments** | 🔴 **CONFIRMED — 37 scripts, 14 result sets** | 🔴 **CATASTROPHIC (§0.1)** |
| 🔴 **Missing evidence** | 🔴 **CONFIRMED** | 🔴 **7 hypotheses are UNKNOWN FOREVER** |
| 🟡 **Duplicate hypotheses** | 🟡 **CONFIRMED** | 🟡 **6 capital-sizing variants; 10 strangle variants across 6 scripts** |
| 🔴 **Contradictory findings** | 🔴 **CONFIRMED** | 🔴 **"first-100: PF 1.31" vs "1200 trades: PF 0.94". Both were true; only one was reported first** |
| 🔴 **Forgotten failures** | 🔴 **CONFIRMED — LITERALLY** | 🔴 **`backtest-gate-postmortem.js` — a failure analysis, DELETED AS JUNK** |
| 🔴 **Survivorship of successful ideas only** | 🔴 **CONFIRMED — THE DEFINING ONE** | 🔴 **The one strategy that "worked" survived. The 37 that did not were deleted. §0.3** |

## **7 failure modes. 7 CONFIRMED. This is the worst register in forty-three documents.**

---

# PART 9 & 10 — REGISTRY ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   HypothesisRegistry  ★★★
     ID · statement · NULL · alternative · success · failure · owner · created · status.
     🔴 IMMUTABLE. A hypothesis is NEVER deleted — only transitioned to INVALIDATED.
        43's stop condition is not advice. §0.1 is what happens without it.

   🔴 TrialCounter  ★★★  — THE PRIMITIVE WHOSE ABSENCE DESTROYED THE EDGE CLAIM
     Every experiment run against a dataset INCREMENTS a persistent counter for that dataset.
     That counter IS the nTrials argument to deflatedSharpe().
     🔴 The deleted optimizer swept 40 configs and RANKED BY WIN RATE. Nothing counted them.
        Nothing could — the file that ran them was deleted.  §0.2
     🔴 A trial that is not counted is a trial that is not charged for.

   ExperimentRegistry  ★
     hypothesisId · gitSha · dataHash · seed · method · result · LIMITATIONS · decision.
     🔴 APPEND-ONLY. 015: results are overwritten in place — even the survivors have no history.

   EvidenceRegistry / DecisionRegistry / KnowledgeBase  ★
     🔴 A DECISION CITES EVIDENCE BY ID, or it is not a decision.
     🔴 NEGATIVE RESULTS ARE FIRST-CLASS. The condor result is worth exactly as much as the
        strangle result — and it is the one that no longer exists.

   THE RULE 043 ESTABLISHES:
     🔴 A DELETED EXPERIMENT IS NOT A CLEANED REPOSITORY. IT IS A DESTROYED CONTROL GROUP.
        Every deleted trial makes the surviving strategy look better than it is —
        by exactly the amount the Deflated Sharpe would have charged for it.
```

---

# PART 11 — TESTING STRATEGY

**Scientific traceability has priority over research velocity.**

| Test | Priority | Fails today? |
|---|---|---|
| 🔴 **No experiment file may be deleted — only marked INVALIDATED** | **P0 — §0.1** | ✅ **FAILS — 37 deleted** |
| 🔴 **Every experiment increments a persistent trial counter** | **P0 — §0.2. It IS `nTrials`** | ✅ **FAILS — nothing counts** |
| 🔴 **Every experiment links to a hypothesis ID** | **P0** | ✅ **FAILS — no IDs exist** |
| 🔴 **Every decision cites evidence by ID** | **P0** | ✅ **FAILS** |
| 🔴 **A negative result is stored with the same durability as a positive one** | **P0 — §0.3** | ✅ **FAILS — survivorship** |
| **Duplicate-hypothesis detection** | P1 | ✅ **FAILS — 10 strangle variants, unlinked** |
| 🟢 **The NIFTY-directional rejection stays on the record** | P1 | 🟢 **PASSES. It is the model to copy** |

---

# PART 12 — HYPOTHESIS MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Informal Ideas** | 🟢 **YES — and this is where it sits** | Hypotheses exist only as filenames |
| **1 — Documented Hypotheses** | 🔴 **NO** | 🔴 **0 of 14 documented. 0 have a null** |
| **2 — Managed Experiments** | 🔴 **NO** | 🔴 **37 experiments DELETED AS "JUNK"** |
| **3 — Governed Research Registry** | 🔴 **NO** | 🔴 **No registry, no IDs, no trial counter** |
| **4 — Institutional Knowledge Platform** | 🔴 **NO** | 🔴 **The failure post-mortem was deleted** |
| **5 — Enterprise Scientific Organization** | 🔴 **NO** | — |

## ## **RESEARCH KNOWLEDGE PLATFORM: LEVEL 0 — INFORMAL IDEAS.**

**And it is below Level 0 in one respect the model does not anticipate: the platform has NEGATIVE
institutional memory. It does not merely fail to preserve failures — it deletes them, which makes the
surviving record actively misleading.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Preconditions | Risks | Exit criteria |
|---|---|---|---|
| **1 — INVENTORY** | ✅ **DONE — Part 1, by archaeology. 14 hypotheses, 7 unrecoverable** | — | **Every hypothesis has an ID and a disposition** |
| **2 — 🔴 EXHUME (do this before anything else)** | 🟢 **git still holds the blobs — TODAY** | 🔴 **A future `git gc` / repo re-init loses them permanently** | 🔴 **The 37 deleted experiments are recovered to `docs/research-archive/` and marked INVALIDATED, not deleted** |
| **3 — TRIAL COUNTER** | Phase 2 | Low | 🔴 **`deflatedSharpe()` is finally called with an HONEST nTrials (≥ 50, per §0.2)** |
| **4 — EXPERIMENT REGISTRY** | Phase 3 | Low | **Append-only. gitSha + dataHash + seed. No overwrites** |
| **5 — KNOWLEDGE BASE** | Phase 4 | Low | **Negative findings are as durable as positive ones** |

> **Phase 2 has a deadline, like 039's FIFO cap. The deleted blobs survive only inside git's object store.
> They are one aggressive garbage-collection or one fresh-clone-and-reinit away from being gone for good.**

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every hypothesis has a unique identifier | 🔴 **NO — zero do** |
| Every experiment links to a hypothesis | 🔴 **NO** |
| Every decision cites supporting evidence | 🔴 **NO** |
| 🔴 **Failed hypotheses remain permanently recorded** | 🔴 **NO — 37 EXPERIMENTS WERE DELETED** |
| **Knowledge survives personnel and code changes** | 🔴 **NO — it did not survive one `chore:` commit** |
| Unknown findings remain explicitly unresolved | 🟡 **PARTIAL — `gamma-blast` is honestly "not backtestable"** |

## **0.5 of 6. The lowest score in forty-three documents.**

---

# STOP CONDITIONS

| Condition | Verdict |
|---|---|
| *Hypothesis ownership cannot be established* | 🔴 **FIRES — no hypothesis has an owner, because no hypothesis was ever written** |
| *Evidence cannot be linked* | 🔴 **FIRES — 14 result files deleted; survivors are overwritten in place** |
| *Decision history is incomplete* | 🔴 **FIRES — 1 decision (H-03) has evidence. The rest have none** |
| *Experiment provenance is missing* | 🔴 **FIRES — 0 of 8 traceability fields, for every experiment** |

## 🔴 **FOUR OF FOUR STOP CONDITIONS FIRE.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent research auditor reconstruct the complete history of any hypothesis,
reproduce its experiments, and understand why it was accepted or rejected?**

## **No. And the reason is not neglect. The research was DELETED.**

> ## 🔴 **ON 2026-06-21, COMMIT `3e388d1` — TITLED *"chore: full-program cleanup — untrack 18k caches + junk"* — DELETED THIRTY-SEVEN BACKTEST AND STRATEGY SCRIPTS AND FOURTEEN RESULT FILES.**
>
> **Among them: the iron condor. The expiry straddle. Three named directional strategies. Six capital
> structures. A regime study asking *"when does the strategy work"* — the very question audits 007 and 015
> later had to ask again from nothing.**
>
> **And two files that should never have been touched:**
>
> ## **`backtest-gate-postmortem.js` — a written analysis of a FAILURE. The precise artefact 043's stop condition exists to protect. Deleted as junk.**
>
> ## **`optimize-strategy.js` — and this one changes the verdict of audit 042.**

**I recovered it from the git object store. Its own header reads:**

> *"STRATEGY OPTIMIZER — Tests dozens of parameter combinations and **RANKS BY WIN RATE** × avg multiplier."*
>
> **Measured from the recovered source: **FORTY configurations**, sorted by `WinRate × AvgMult`, printing a
> "TOP 5", and containing a hand-assembled config literally named **`BEST_GUESS`** — a strategy built out of
> whichever knobs happened to win.**
>
> **It priced every option with Black-Scholes off Yahoo index closes. It never touched a real option price.**

## **What this does to audit 042**

**042 measured the surviving strangle edge — 59.4% net, Sharpe 1.50 — through the platform's own Deflated
Sharpe Ratio, and found it FAILED once you charged it for the search that found it:**

```
     DSR @  1 trial   100.00%   PASS
     DSR @ 10 trials   76.89%   FAIL
     DSR @ 50 trials   51.21%   FAIL
```

**042 estimated the honest trial count at "a dozen or more," from the ten strangle variants still on disk.**

> ## 🔴 **THAT ESTIMATE WAS FAR TOO GENEROUS. ONE DELETED FILE ALONE SWEPT FORTY CONFIGURATIONS AND PICKED THE WINNER BY WIN RATE. Add the ten survivors, the other thirty-six deleted scripts, and every hand-tuned parameter, and the true trial count is past fifty and plausibly in the hundreds.**
>
> **At fifty trials the Deflated Sharpe already returns 51.21% — FAIL. The true figure is worse.**
>
> ## **042 said the edge was not proven. 043 recovered the evidence showing it is not proven by a much wider margin — and that evidence had been deleted as junk.**

**And the deepest finding of all — survivorship, in its purest form:**

> **Thirty-seven experiments were deleted. One survived: the short strangle — the one that produced the 88%
> number. The platform's institutional memory now contains exactly the idea that appeared to work, and none
> of the ideas that did not.**
>
> ## **A deleted experiment is not a cleaned repository. It is a destroyed control group. Every trial thrown away makes the surviving strategy look better than it is — by precisely the amount the Deflated Sharpe would have charged for it.**
>
> **This is why the platform believed it had an 88% edge. Not because anyone lied. Because the losing
> lottery tickets were thrown in the bin, and only the winner was left on the table.**

**One thing was done right, and it deserves to be the template:**

> 🟢 **The NIFTY multi-confirm directional strategy was tested over 1,200 real trades, returned PF 0.94,
> was declared a loser, and the engine was DISABLED — and the finding was written down and kept. That is
> the single best act of research hygiene in this repository. It is also the only one.**

**And Phase 2 of the roadmap has a deadline, exactly like 039's FIFO cap:**

> ## **The thirty-seven deleted experiments survive ONLY as blobs inside git's object store. One aggressive `git gc`, one fresh clone, one repo re-init — and the platform's entire research history is gone for real. EXHUME THEM NOW, while they still exist.**

## **Research Knowledge maturity: LEVEL 0 — INFORMAL IDEAS. 0.5 of 6 success criteria. Four of four stop conditions fire. This is the lowest score in forty-three documents — and it is the one that explains all the others.**

---

**Hypotheses created: NONE. Profitability evaluated: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Hypothesis Inventory (Part 1) · Lifecycle (Part 2) · Governance (Part 3) · Experiment
Traceability (Part 4) · **Knowledge Preservation (§0, Part 5)** · Decision Governance (Part 6) ·
Observability (Part 7) · Failure Mode Register (Part 8) · Registry Architecture (Parts 9–10) · Testing
Strategy (Part 11) · Maturity Assessment (Part 12) · Migration Roadmap (Part 13) · Executive Summary.

**Stop conditions: ownership 🔴 FIRES · evidence linkage 🔴 FIRES · decision history 🔴 FIRES · provenance 🔴 FIRES.**
