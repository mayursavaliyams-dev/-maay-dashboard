# 070 — Adversarial Validation Harness

**ANTIGRAVITY PRO** · **Date:** 2026-07-30 · **Status:** built, tested, run against every strategy
**Suites:** 77/77 green · **Tests:** 79 checks
**New modules:** `validation-ledger.js`, `validation-stats.js`, `walk-forward.js`, `validation-harness.js`
**Run it:** `npm run validate:strategies`

---

## 1. The result

The harness was run against all nine strategies this system trades or has tested.
**Criteria were declared and hashed before the run** (`4da1dad76c6cbd81`).

| Outcome | Count |
|---|---|
| Survived the harness | **0** |
| Failed a test | 0 |
| **CANNOT BE VALIDATED** | **9 of 9** |

**Five of these strategies are running in paper right now. None has cleared this
bar.**

`CANNOT_VALIDATE` is not a pass, and the harness says so in words on every line
that reports it. It is the most important sentence in the whole system:

> *"This is NOT a pass — the evidence required to judge this strategy does not
> exist."*

---

## 2. Why nothing could be validated, specifically

Measured on this repository, 2026-07-30: **17 backtest scripts, 15 result files,
and no trial count recorded anywhere.**

Requirement 3 asks for a counter incremented on *every* parameter set, variant and
idea tested against the same data — **including the ones that were discarded**.
Discarded runs leave no artefact at all, so that history is simply gone.

Where the artefacts on disk *are* genuinely parameter sweeps, the harness
reconstructs a **floor**:

| Family | Trial floor | Source |
|---|---|---|
| SHORT_STRANGLE | **26** | 4 sweep/stress artefacts + 4 scripts |
| SHORT_STRADDLE | 11 | leaderboard + script |
| EXPIRY_STRADDLE | 11 | leaderboard + script |
| TREND_RIDE | 6 | sweeps + 2 scripts |
| ORB_AFTERNOON | 3 | scripts only |
| POP_SELLER, GAMMA_BLAST, AI_AGENTS, BOUNCE | **UNKNOWN** | nothing on disk |

A floor is the **most generous possible reading** of the evidence: the true count
is higher, because the discarded runs left nothing behind.

### What was deliberately not counted

`result-intraday-nifty.json` contains 1,200 **trades**. That is **one trial**, not
1,200. Conflating trades with trials would inflate the counter and over-deflate
the Sharpe — an error in the safe direction, and still an error, and precisely
the kind of thing this harness exists to catch. Only `sweep`, `results`,
`leaderboard`, `stress`, `variants` and `grid` arrays are counted.

---

## 3. The three-valued verdict

`PASS` · `FAIL` · `CANNOT_VALIDATE`

The third exists because the evidence most often missing — the trial count — is
missing **precisely for the strategies with the most impressive backtests**. A
harness that reported "no failures" for a strategy it could not test would be the
most dangerous artefact in this repository.

The promotion gate treats `CANNOT_VALIDATE` as a **block**, not as an absence of
objections.

---

## 4. Walk-forward: the headline is out-of-sample, and nothing else

- Rolling or anchored folds; in-sample optimise, immediately-following
  out-of-sample evaluate, roll forward.
- **The headline is the concatenated out-of-sample return series.** In-sample
  figures live under a field literally named `diagnosticOnly`, whose note reads
  *"in-sample figures are diagnostic. They are never the reported result."*
- The **in-sample minus out-of-sample gap** is reported, because that gap *is*
  the overfitting measurement and is the reason in-sample is computed at all.
- The best fold is identified **and explicitly disclaimed**:
  *"the best fold is reported for diagnosis ONLY. It is never the result —
  presenting it as one is the error this harness exists to prevent."*
- Overlapping out-of-sample windows are **reported**, because a concatenated
  result built from them reuses observations.

### Parameter stability is a result, not a footnote

Numeric parameters get a coefficient of variation, categorical ones a modal
share, both mapped to a 0–1 instability score. A run where the optimiser chose
lookbacks of 5, 40, 12 and 33 across four folds returns:

> **FITTING_NOISE** — *"Across 4 folds the optimiser chose lookback between 5 and
> 40. Parameters that jump around between folds indicate the strategy is fitting
> noise."*

---

## 5. Purging and embargo

- Training samples whose **label horizon** resolves inside the test window are
  purged.
- Samples after the window whose **feature lookback** reaches back into it are
  purged.
- The embargo must be at least `maxFeatureLookback + maxLabelHorizon`. **A
  shorter one is REFUSED, not clamped:**

> *"A shorter embargo leaves a seam, and that seam is leakage no other test in
> this harness will catch"* — the shuffled-label test would pass, because the
> leak is structural rather than in the labels.

- `assertNoOverlap` runs independently on every split and **fails the run**
  rather than warning. It is a separate check on purpose: the assertion is what
  the run is allowed to depend on, not the function that was supposed to have
  done the job.

---

## 6. Multiple-testing accounting

### A real error the tests caught in the deflation maths

The first implementation returned an **expected maximum Sharpe of 13.5 annualised
from three trials.** The bracket in the Bailey–López de Prado construction is in
**standard-normal quantile units**; it becomes a Sharpe only after multiplying by
the Sharpe estimator's standard error. That multiplication was missing.

It was caught only because the number was absurd enough to notice. Corrected, the
figures behave:

| Trials | Observed Sharpe | Expected max from chance | p | Verdict |
|---|---|---|---|---|
| 1 | 1.8 | 0 | 0.994 | SURVIVES |
| 3 | 4.0 | 0.49 | 1.000 | SURVIVES |
| 50 | 1.8 | 1.62 | 0.598 | **FAILS** |
| 200 | 1.8 | 1.97 | 0.405 | **FAILS** |
| 200 | 3.5 | 1.99 | 0.982 | SURVIVES |

> *"With 200 trials against the same data, a Sharpe of 1.8 is not distinguishable
> from the best of 200 coin flips."*

Two further details that matter:

- **Skew and kurtosis are in the estimator.** Options returns are strongly
  non-normal — a short-premium strategy is the textbook case — so ignoring them
  would overstate significance for exactly the strategies this system runs.
- **The output states its units.** `deflatedSharpeProbability` is a *probability*,
  not a rescaled Sharpe. A probability read as a Sharpe is a serious misreading in
  the flattering direction.

### PBO

Combinatorially symmetric cross-validation: how often the in-sample best lands
below the out-of-sample median. Verified on constructed data — pure noise gives a
PBO near 0.5 (*"the selection is worse than a coin flip"*), a genuine edge gives
≤ 0.2.

---

## 7. Null tests that must fail

**Shuffled labels.** If performance does **not** collapse to chance, there is
leakage and the harness sets `halt: true`:

> *"Shuffled labels still score 0.70 against a chance level of 0.5. There is
> leakage. The harness HALTS: every downstream number would be about the leak,
> not the strategy."*

**Random entry.** The strategy's metric is placed against a distribution of random
entries with the same holding period, sizing and costs. **The sampler must be
supplied by the caller** — the harness refuses to assume a cost model it does not
own. A strategy inside the bulk of the distribution gets:

> *"The strategy sits at the 58.2nd percentile of random entries with the same
> holding period and costs. It has not demonstrated anything."*

---

## 8. Robustness, summarised in one sentence

Costs ×1/×1.5/×2 · slippage ×2 · timing ±2 and ±5 minutes · parameters ×0.8/0.9/1.1/1.2
· **and slicing by year, regime and underlying, run automatically.**

### Slicing is a fragility test, not a breakdown table

The perturbations ask *"does the edge survive being taxed?"*. Slicing asks a
different and often more damning question: *"does the edge exist everywhere, or
did one year carry it?"*

**A strategy whose entire profit came from one year survives every cost
multiplier**, because the average is still positive. Concentration is invisible
to every other scenario in the battery — so it is folded into the single
fragility score rather than printed in an appendix:

```
fragility = max(perturbationFragility, sliceFragility)
```

**The worse of the two, never the average.** Averaging would let a robust cost
profile hide a one-year edge, which is exactly the case the slicing exists for.
Demonstrated in the tests: a strategy scoring Sharpe 1.5 under every perturbation
reads `ROBUST` on perturbations alone, and `fragility 0 → 0.33` once its
one-year concentration is measured.

An untagged dimension is reported as **NOT CHECKED**, never as passing.

### A threshold bug the tests exposed

The first version flagged concentration at a fixed 60% of profit in the best
slice. Across **two** underlyings an even split is 50%, so an entirely ordinary
2:1 split tripped it; across **ten** years an even split is 10%, so 60% would be
one year carrying nearly everything and the same threshold was far too lenient.

The threshold now scales:

```
threshold = 0.5 + 0.5 / sliceCount
```

| Slices | Threshold | Effect |
|---|---|---|
| 2 | 0.75 | a 2:1 split passes; a 9:1 split does not |
| 4 | 0.625 | one year carrying the profit is caught |
| 10 | 0.55 | a single slice at 60% is caught |

A fragility test that flags ordinary data is a fragility test nobody keeps.

**Fragility is the share of perturbations under which the edge collapses — the
worst case, not the average.** Averaging would let three good scenarios hide one
catastrophic one, which is the specific failure a fragility summary exists to
expose.

> *"The edge collapses under 6 of 11 perturbations. Worst: costs ×2 costs 110% of
> the Sharpe."*

If the **baseline itself** does not run, the battery refuses rather than
comparing against nothing.

---

## 9. Out-of-sample data is spent when it is used

The ledger counts evaluations per period and surfaces the count:

| Evaluations | Status |
|---|---|
| 0 | FRESH |
| ≥3 | DEGRADED — *"each additional evaluation makes it more in-sample"* |
| ≥10 | **SPENT** — *"this period is no longer out-of-sample in any meaningful sense"* |

The thresholds are labelled `thresholdsAreJudgement: true`. **The count is not
judgement**, and it is the count that does the work.

---

## 10. Reproducibility

Every run records code hash, config hash, data snapshot IDs, cost model version,
seeds and metrics. The run ID is the hash of those inputs.

- Identical inputs → identical run ID.
- **Identical inputs producing different metrics is recorded as a reproducibility
  FAILURE**, not overwritten — overwriting would erase the evidence that the run
  is non-deterministic.
- A run missing any input is stored as `reproducible: false` with the missing
  inputs named, rather than stored as though it were.

---

## 11. The promotion gate

Criteria are declared **before** the tests and hashed. A result carries the hash
it was measured against, and **a result measured against one bar cannot be
promoted against another** — which makes a criterion loosened after seeing the
numbers visible rather than silent.

| Stage | Requires |
|---|---|
| **PAPER** | walk-forward ≥4 folds, ≥100 OOS observations, deflated-Sharpe p ≥ 0.90, PBO ≤ 0.5, parameter instability ≤ 0.5, random-entry percentile ≥ 95, shuffled labels collapse, fragility ≤ 0.5 |
| **LIVE** | ≥60 paper days, ≥30 paper trades, a paper-versus-backtest divergence report, Sharpe gap ≤ 0.5, and every paper criterion still met |

**Overrides require a named human and a written reason of at least 20
characters** — *"approved" is rejected as a reason* — and are signed and logged.

---

## 12. Verification

| Check | Result |
|---|---|
| `test/validation-harness.test.js` | **79 checks** |
| Full suite | **77/77 green** |
| Acceptance run | 9 strategies, report at `data/validation-report.json` |
| Deflation maths | corrected after the tests exposed a 13.5-Sharpe absurdity |
| Silent-catch ratchet | held at 112 — one new empty catch caught and given a real message |

---

## 13. What this changes, and what it does not

**It does not make any strategy worse.** The 600-day strangle backtest is exactly
as good as it was yesterday. What has changed is that the system can now state
what that backtest does and does not establish — and the answer is that a 91% win
rate chosen from at least 26 variants, with no walk-forward, no PBO, no
robustness battery and no null test, is **not evidence that the strategy is real**.

**The honest position after this run:**

- Nine strategies, none validated.
- Five of them running in paper.
- The blocking evidence is the same for all nine and it is not the market's fault
  — it is that the trials were never counted and the walk-forward was never run.

**Nothing was tuned to pass.** A strategy tuned until it passes the harness has
simply moved the overfitting one level up, into the harness — which is why the
acceptance script prints failures first, prints `CANNOT_VALIDATE` as loudly as a
failure, and exits non-zero when anything fails.

---

## The one-line summary

> The harness was built to try to prove these strategies are not real. It could
> not even get that far for any of them, because the evidence needed to judge
> them — most of all the count of how many variants were tried and discarded —
> was never recorded. That is the finding, and it is a more useful one than any
> Sharpe ratio in the repository.
