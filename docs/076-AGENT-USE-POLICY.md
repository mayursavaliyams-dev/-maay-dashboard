# 076 — How AI Coding Agents Are Used on ANTIGRAVITY PRO

**Type:** Standing policy. Attach §2 to every agent task.
**Date:** 2026-07-31
**Includes:** the first claim audit, run against work already completed — **including
my own**, with the accuracy rate reported honestly in §7.

---

## 1. Permission tiers — every area of this codebase

The tier is a function of what a mistake costs, not of how capable the agent seems.
Assigned once, here, rather than argued per task.

### TIER 0 — never applied by an agent. Proposal as a diff only; a human types it.

| Area | Files |
|---|---|
| The order chokepoint | `risk-guard.js`, `place-guarded.js`, `order-breaker.js` |
| Risk limits and sizing | `risk-manager.js`, `risk-config.js`, `position-sizer.js`, `vix-kelly-sizer.js` |
| Kill switch | `kill-switch.js` |
| Anything that can reach a broker order | `live-connector.js`, `upstox-connector.js`, `kotak-neo-connector.js`, `broker-connector.js`, `dhan-client.js` |
| Credentials and auth | `.env`, `dhan-auth.js`, `auth.js`, `deploy/*.env*` |
| Production configuration | `config-overrides.json`, `ecosystem.config.js`, `deploy/` |
| Instrument truth | `instrument-registry.js`, `instrument-guard.js`, `registry-drift.js` |
| Raw captured data and audit records | `data/warehouse/L0_raw/**`, `data/opt-candles/`, `data/opthl/`, any ledger under `data/` |
| **The critical test set** | `test/risk-layer.test.js`, `test/order-path-chokepoint.test.js`, `test/order-path-characterization.test.js`, `test/instrument-registry.test.js`, `test/ledger-safety.test.js`, `test/repo-integrity.test.js`, `test/perf-budget.test.js` |

`instrument-registry.js` is Tier 0 for a specific, expensive reason: a wrong expiry
weekday in it silently produced a strategy result that looked excellent
(BANKNIFTY PoP 100% → 91.8% once corrected). A registry error does not announce
itself; it flatters you.

### TIER 1 — propose only; a human applies after independent review

`execution-engine.js`, `afternoon-engine.js`, `strangle-engine.js`,
`gamma-blast-engine.js`, `trend-ride-engine.js`, `bounce-engine.js`,
`pop-seller.js`, `signal-paper-engine.js`, `agents-engine.js`,
`limit-order-engine.js`, `liquidity-gate.js`, `execution-config.js`,
`slippage-ledger.js`, `margin-*.js`, `positions-book.js`, `risk-state.js`,
`data-gate.js`, `data-quality.js`, `feed-health.js`, `safe-write.js`,
`database.js`, `preflight*.js`, `server.js`, `amibroker-bridge.js`,
`warehouse-capture.js`, `option-warehouse.js`.

`server.js` is Tier 1 in its entirety, not per-region. It is 8,000+ lines whose
dependency mechanism is construction order (doc 074 §0.6 B9), so any edit to it
is potentially an ordering change. A per-region rule would require the reviewer
to know which regions are load-bearing — which is exactly the knowledge an agent
does not have and a tired reviewer will not reconstruct at 23:00.

### TIER 2 — apply, mandatory review before merge

Research and backtest (`bt-*.js`, `backtest-*/`, `validation-*.js`,
`walk-forward.js`), analytics (`gex-skew.js`, `vol-context.js`, `meta-label.js`,
`signal-health.js`, `trade-planner.js`, `payoff-engine.js`, `charges.js`),
data transforms (`warehouse-derive.js`, `warehouse-api.js`,
`stock-*.js`, `candlestick-patterns.js`), all `scripts/`, all `public/`,
and every test **outside the critical set**.

### TIER 3 — apply freely

`docs/`, scratch analysis in the session scratchpad, throwaway queries, anything
that cannot reach production state or credentials.

### Enforcing it as a boundary rather than a request

An instruction is a request; a permission is a boundary. Available today:

| Control | State |
|---|---|
| Data-only broker credential for agent sessions | **Not yet issued** — doc 073 §2.3 Barrier 1. Must be confirmed with the broker |
| Separate storage root per environment | **Not yet built** — doc 073 §2.3 Barrier 4 |
| Raw capability neutralised at runtime | **Built** — doc 075 §5 |
| Critical tests enumerated so a diff touching them is visible | **Built** — the list above |
| Git pre-commit refusing Tier 0 paths from an agent session | **Not built.** Named here so it is not mistaken for done |

Until the first two exist, Tier 0 is enforced by process, and that is a weaker
guarantee that should be stated rather than assumed.

---

## 2. Standing context — attach this to every task

> **System:** ANTIGRAVITY PRO. Node.js index options (NIFTY, BANKNIFTY, SENSEX;
> Upstox feed). Paper mode. No order has ever reached a broker.
>
> **Non-negotiables**
> - **Fail closed.** Every gate has three outcomes: PASS, BLOCKED, UNEVALUABLE.
>   UNEVALUABLE blocks. Never merge it with either of the others.
> - **`null` is not `0`.** Absent, zero, and error are three different facts.
>   A missing price is not a price of zero; a failed position read is not a flat
>   book. This is the single most consequential error class in this repository.
> - **One code path.** One chokepoint, one middleware, one owner per piece of
>   state — never N call sites that must each remember.
> - **Evidence grades never merge:** Verified / Measured / Estimated / Opinion /
>   Unknown. Unknown stays Unknown; it is never defaulted.
> - **Reproducible.** Anything derived must be regenerable from raw with a
>   recorded command.
>
> **Market facts — use these, do not infer them.** From the broker-verified
> registry (`instrument-registry.js`, verified 2026-07-09):
>
> | | lot | strike interval | tick | expiry weekday |
> |---|---|---|---|---|
> | NIFTY | 65 | 50 | 0.05 | Tuesday |
> | BANKNIFTY | 30 | 100 | 0.05 | Tuesday |
> | SENSEX | 20 | 100 | 0.05 | Thursday |
>
> Lot sizes and expiry weekdays **changed twice in two years**. Never hard-code
> them, never guess them, always read the registry. Session 09:15–15:30 IST.
>
> **Freeze windows.** No change lands during market hours (09:00–15:45 IST), on
> any traded instrument's expiry day, or the day before a scheduled high-impact
> event. Stopping is always allowed; starting, loosening or adjusting is not.
>
> **Load-bearing ugliness — do not tidy these:**
> - `risk-guard.js` neutralises the wrapped connector's `placeOrder`. It looks
>   like mutation of someone else's object. It is the bypass barrier (doc 075 §5).
> - `risk-manager.js` `riskMapComplete` requires the caller to declare
>   completeness. It looks like an avoidable parameter. Removing it makes an
>   unbuilt risk map read as a portfolio with no risk (doc 075 §2.1).
> - `positions-book.js` reports `unavailable` engines separately and never sums a
>   null as zero. The extra branches are the point.
> - `live-connector.js` passes `retries: 0` for `/v2/orders` specifically while
>   the client default is 3. It looks inconsistent. An order is not a read.
> - `dhan-client.js` per-path throttles and the 429 back-off took refusals from
>   458 to 0. Do not "simplify" the rate logic.
> - `data-gate.js` uses structured `codes`, not message text. A gate that parses
>   its own prose has already failed once here.
>
> **Failure history — learned expensively, written down so it is not re-learned:**
> - A registry with two expiry weekdays swapped produced a strategy that looked
>   excellent. Nothing announced it.
> - `/api/options/snapshot?instrument=TMPV` answered with SENSEX's price. Fixed
>   with one middleware, not 42 route patches.
> - A gate matched a regex against its own prose and let never-seen instruments
>   through. **The test contained the same bug** and passed.
> - A day-range check compared against a zero high; 19 of 186 sides report 0.
> - A deflation calculation produced an expected max Sharpe of 13.5 because a
>   quantile bracket was never multiplied by the estimator's standard error.
> - The risk layer was wired to one of twelve order paths and never called at
>   all, for weeks, while looking correct in review (doc 074 §0.2).
> - **2026-07-31:** an agent-written test asserted a consumer contained the right
>   call and passed, while the provider still handed it the raw connector. The
>   text was right and the wiring was absent. See §7, claim C2.
>
> **Current state:** doc 074 (inventory), doc 075 (audit 11/17, Phase 3 not
> started), doc 073 (operations, Phase A incomplete), doc 072 (research
> pre-registration, nothing tested).

---

## 3. Task template

```
TASK
  One outcome, stated in one sentence. If it contains "and", it is two tasks.

TIER
  0 / 1 / 2 / 3 — and therefore: propose-only, or apply.

DEFINITION OF DONE
  What must be true:
  The command that proves it:
  The output that constitutes proof:

OUT OF SCOPE  (explicit — including what you will be tempted by)
  · Do not modify any test in the critical set.
  · Do not rename, reformat or reorganise anything not named above.
  · Do not fix defects you notice. REPORT them at the end, do not make them.
  · Do not change market constants. Read them from instrument-registry.js.

CONTEXT
  Standing context: docs/076 §2 (attached in full)
  Prior decisions relevant here:
  Known defects in this area:

VERIFICATION REQUIRED  (see §4 for the tier's obligations)

REPORT BACK
  1. The diff, with TEST CHANGES LISTED SEPARATELY AND FIRST.
  2. The exact command run and its RAW output, not a summary.
  3. WHAT WAS NOT VERIFIED — this section may not be empty.
  4. Defects noticed and deliberately not fixed.
```

**"Make the tests pass" is never a task.** The task is to fix the defect.
Modifying a test is out of scope unless the test is itself proven wrong, and in
that case the proof is the deliverable, not the edit.

---

## 4. Verification obligations by tier

| | Tier 0 | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|---|
| Raw command output, not a summary | required | required | required | — |
| Re-runnable by a human with one command | required | required | required | — |
| Explicit "what was NOT verified" | required | required | required | required |
| **Failing-before test** for the defect | required | required | if behavioural | — |
| Parity harness clean on all four sessions | required | required if order path | — | — |
| `npm run smoke` output pasted | required | required | — | — |
| Full `npm test` output pasted | required | required | required | — |
| Test diff reported separately | required | required | required | — |
| Human applies the change | **yes** | **yes** | no | no |

**4.4 in practice.** A fix without a test that demonstrably fails against the old
code is a hypothesis about a defect, not a fix for one. The evidence is the
failing run, pasted — not the assertion that it would fail.

**4.5 in practice.** "I ran the tests and they pass" without output counts as no
verification. Not because the agent is lying: the failure mode where it believes
it ran them is real and is invisible from the summary. §7 contains a live example
where the tests genuinely ran, genuinely passed, and protected nothing.

---

## 5. Reviewing agent-written code — the checklist that is actually used

1. **Read for what is missing.** The happy path will be right. Ask: what happens
   on error, on absent, on zero, on stale, on partial?
2. **Error paths first, not last.** Empty catches, `catch (_) {}`, defaults that
   fail dangerous. There are 55 one-line silent catches in `server.js` today
   (doc 074 §0.6 B7); do not add the 56th.
3. **`null` vs `0` vs error**, deliberately, everywhere market data is touched.
4. **Market constants** — lot, tick, strike interval, expiry weekday, session
   times. Plausible is not correct, and these changed twice in two years.
5. **Diff scope against task scope**, explicitly. Do not assume alignment.
6. **Check the provider, not only the consumer.** A call site that looks correct
   proves nothing about whether anything wired it. This is C2 in §7.
7. **Be most suspicious of what reads best.** Fluency suppresses scrutiny, and
   that is the mechanism, not a metaphor.

---

## 6. Claim-audit schedule

| Cadence | Action |
|---|---|
| Every task, Tier 0–1 | Re-run the pasted command yourself before applying |
| Weekly | Sample **2** completed agent tasks at random; verify every claim independently |
| Monthly | Recompute the claim-accuracy rate; adjust tier autonomy on the number, not on impression |
| Quarterly | **Mutation drill** — introduce a real defect in a scratch branch and confirm the suite fails. A suite that has never failed may be protecting nothing |
| On any inaccurate claim | Fix the **process**: what context was missing, what verification was not required, what scope was not bounded. "Check more carefully" is not a fix |

---

## 7. The first claim audit — run 2026-07-31, on my own work

Twelve claims sampled from docs 072–075 and from this session's code, weighted
towards the kind Module 7.4 names as hardest to check: *exhaustive*, *all call
sites*, *nothing is synthetic*, *existing behaviour preserved*.

| # | Claim | Where | Verdict |
|---|---|---|---|
| C1 | "Exhaustive. Twelve sites." (order call graph) | 074 §0.1.1 | **Partial** |
| C2 | "amibroker-bridge routes through the chokepoint" | 075 §4 | **FALSE** |
| C3 | "No heartbeat anywhere — zero occurrences" | 073 §1 | Accurate but incomplete |
| C4 | "Every value below was captured live. Nothing is synthetic." | fixture `_note` | **FALSE** |
| C5 | "≥ 30 prior trial variants on the same sample" | 072 §4 | **Accurate** — exactly 30 |
| C6 | "600 bhavcopy files, 2024-01-08 → 2026-06-17" | 072 §2.1 | **Accurate** |
| C7 | "The open is missed on 4 of 4 sessions" | 072 §2.3 | **Accurate** |
| C8 | "`requestApproval` is never called in production" | 075 §2.2 | **Accurate** |
| C9 | "The risk layer is the only flag that defaults to enabled" | 074 §0.4 | **FALSE** |
| C10 | "Phase A scores 5 of 21" | 073 §1 | **FALSE** |
| C11 | "79/79 suites pass" | 075 §8 | **Accurate** — re-run, 79/79 |
| C12 | "All four engines now constructed after the guard" | 075 §3 | **Accurate** |

**Accuracy: 6 of 12 fully accurate. 4 of 12 materially inaccurate (33%).
1 partial, 1 incomplete.**

### C2 — the one that matters

I wrote that the AmiBroker bridge was routed through the chokepoint. I changed
the bridge to read `deps.broker`. **The corresponding change in `server.js` never
applied** — a string replace that silently matched nothing — so the bridge was
still being handed `liveConnector: live` and no `broker` at all.

The characterization test asserted that `amibroker-bridge.js` *contains* a
`placeGuarded(` call. It does. **The test passed.** The suite was green, the
smoke was green, and the wiring was absent.

Effect in production: `deps.broker` was undefined, the live branch never
executed, and the bridge fell silently to "Paper mode — order logged but not
executed". Fail-safe in direction, and entirely unintended.

This is the failure mode this whole document exists for, and it is worth being
precise about which control failed: not the tests, which ran; not the review,
which read a correct-looking consumer; but the **absence of a check on the
provider**. A source-text assertion on a consumer can never see an unwired
provider.

**Process fixes applied, not resolutions to be careful:**
- `test/order-path-chokepoint.test.js §1` now asserts the wiring site: the
  registration block contains `broker: guardedBroker` and `getRiskState`, and
  `server.js` contains **no** `liveConnector:` anywhere.
- §5 of the review checklist above: *check the provider, not only the consumer.*
- Verification obligations: a text-presence assertion never counts as evidence of
  wiring on Tier 0–1.

### C4 — a false provenance claim inside the artefact

The fixtures carried `_note: "Every value below was captured live on the stated
date. Nothing is synthetic."` The `market` block is captured. `side`, `lots`,
`quantity`, `seq` and the CE/PE alternation are constructed by the generator.

This is the worst shape a false claim can take: a provenance statement embedded
in the data it describes, where a later reader has no reason to doubt it and no
easy way to check. Replaced with separate `_captured` and `_constructed` fields
naming exactly which is which, and the correction recorded in the generator.

### C9 and C10 — errors of the ordinary kind

**C9:** I quoted `server.js`'s own comment — *"the only flag in this codebase
that defaults to enabled"* — and endorsed it as *"That reasoning is correct and
the default is right."* The reasoning is correct. The exclusivity claim is false:
at least eight other flags default to `'true'`, and **doc 074 §0.4 lists two of
them two paragraphs earlier**. I contradicted myself inside one section and
endorsed the contradiction.

**C10:** "Phase A scores 5 of 21." Recounted mechanically from the table it
refers to: **22 rows, 6 present, 2 partial, 14 absent** — and the table mixes
requirements from Modules 1–7, so a "Phase A score" cannot be read off it at all.
The number was a hand-count presented with the authority of a measurement. The
honest statement is: *of 22 audited operational capabilities, 6 present, 2
partial, 14 absent.*

### C1 and C3 — bounded but incomplete

**C1:** the enumeration was exhaustive *within a declared scope*, and the scope
was stated. But `stock/stock-engine.js` contains **2 unguarded `placeOrder`
sites** and doc 074 never says so. A reader would take "exhaustive, twelve sites"
as a statement about the system. Recorded here: **the stock bot has its own
ungoverned order path and is outside every control built in Phase 2.**

**C3:** "zero occurrences of `heartbeat` or `lastBeat`" is true as stated, and
the capability is genuinely absent. But a wider search finds a `/healthz`
liveness probe (`server.js:143`) and `_lastTick` maps in the feed, neither
mentioned. The conclusion holds; the search was narrower than the sentence
implied.

### What this rate means

33% materially inaccurate is not a number to explain away. Three observations
that follow from it directly:

1. **The inaccurate claims are not randomly distributed.** All four are claims of
   *completeness* or *provenance* — "exhaustive", "nothing is synthetic", "the
   only", a score. The accurate ones (C5–C8, C11, C12) are all claims with a
   mechanical check that was actually run. This is the argument for Module 2.4:
   prefer tasks with a mechanical check to tasks whose success is a judgement.
2. **A green suite was not protective in the one case that mattered.** C2 passed
   every gate in this repository.
3. **This rate is the basis for autonomy, per Module 7.2.** At 33%, Tier 0 and
   Tier 1 remaining propose-only is not caution, it is the correct calibration.
   Re-measure monthly; move the boundary on the number, not the impression.

---

## 8. When not to use an agent here

- Final judgement on anything Tier 0. A proposal is welcome; the keystroke is
  the owner's.
- During a live incident. Incidents are resolved by procedures written in
  advance (doc 073 §5), not by new code written under pressure.
- What to trade, how much to risk, when to stop. Delegating these produces an
  answer with no owner.
- When the reviewer could not evaluate the output competently. Generating code
  you cannot review is borrowing against a debt that comes due during an
  incident.
- Tired, in a money path. That is the combination in which fluent output is
  least scrutinised and most likely to be merged.

---

## 9. Session close obligations (Module 8)

Every session ends by updating: the audit score (doc 075 §7), the defect list
(doc 074 §0.6 and the pinned-defect list in 075 §7), the phase plan, and this
document's claim-audit table. Work whose record lives only in a conversation
will be redone or contradicted.

**This session's additions:** claims C1–C12 recorded above; C2 and C4 fixed in
code; C9 and C10 corrections noted against docs 073 and 074, which are **not
rewritten** — a corrected document that hides that it was wrong teaches nothing.
