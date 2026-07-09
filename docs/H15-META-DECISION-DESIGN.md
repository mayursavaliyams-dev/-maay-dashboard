# H15 — Institutional AI Probability & Meta Decision Engine
## Design Document (no code written)

> Self-contained. Paste into any assistant to continue this work.
> Written 2026-07-09 for **Antigravity Pro**. Every claim below was verified against the running code and
> the data files on disk. Where something is unverified or unavailable, it says so.

---

## 0. Two measured facts that decide the whole design

### M1 — 8 of the 24 declared input engines do not exist

Verified by scanning the repository:

| Present (16) | Absent (8) |
|---|---|
| `instrument-registry.js`, `broker-connector.js`, `gamma-blast-detect.js`, `option-analyzer.js`, `vrp-monitor.js`, `gex-skew.js`, `vol-context.js`, `candlestick-patterns.js`, `position-sizer.js`, `trade-planner.js`, `meta-label.js`, `signal-health.js`, `agents-engine.js`, `forward-test-logger.js`, `bt-validate.js`, `strangle-engine.js` | **Historical Data Lake**, **Feature Store**, **Risk Engine**, **Portfolio Engine**, **Event Engine**, **Smart Money Engine**, **Dealer Hedging Engine**, **Replay Engine**, Strategy Library, Market Regime |

The H15 brief's own **RISK FILTER** demands: Trend, Volatility, Gamma, OI, **Liquidity**, **Spread**,
**Risk Budget**, **Portfolio Exposure**, **Market Regime**, **Event Risk**, Paper Validation, Walk-Forward.

- **Liquidity** and **Spread** are *not obtainable at all* — the H14 audit proved there is no historical or
  free bid/ask for NSE options.
- **Risk Budget**, **Portfolio Exposure**, **Event Risk**, **Market Regime** depend on engines that do not
  exist.

> **Consequence.** A correctly built, honestly fail-closed H15 **returns `ABSTAIN` on 100% of inputs today.**
> That is not a bug. That is the engine telling the truth. Anything else means the fail-closed rule was
> quietly broken somewhere.
>
> This is not an argument for weakening fail-closed. It is an argument for **sequencing**: H15 should ship
> as the *contract and the arbiter*, whose first useful output is a precise, machine-readable list of what
> is missing. It becomes a decision engine as its inputs arrive.

### M2 — There are 41 labelled outcomes in the entire platform. Probability cannot be calibrated

| ledger | records |
|---|---|
| `data/signal-outcomes.json` | 11 |
| `data/ai-agents-trades.json` | 20 |
| `data/strangle-trades.json` | 7 |
| `data/signal-paper-positions.json` | 2 |
| `data/gamma-blast-trades.json` | 1 |
| `data/forward-test/` | **empty** |
| **total** | **41** |

At `p = 0.5`, `n = 41` gives a standard error of **±7.8 percentage points**; the 95% Wilson interval on a
raw 60% win rate is roughly **[45%, 74%]**. Reliability bins need hundreds of samples per bin. The
platform's own `meta-label.js` header states the goal correctly — *"so that '70%' empirically means ~70%"* —
and there is not enough data to establish that.

> **Rule H15-P1.** The engine **must not emit a probability** until calibration is established. Below the
> minimum sample size it returns `probability: null`, `class: "uncalibrated"`, and a decision restricted to
> `NO_TRADE` or `ABSTAIN`. **It never prints "78%".**

Related, and already in the codebase: `signal-health.js` tracks Brier score and calibration drift, and
`meta-label.js` is a Platt/isotonic calibrator. Both are the right tools. They are starved of data, not
missing.

### M2b — Monte Carlo is not validation

The brief lists "Monte Carlo Validation" under the Probability Engine. Monte Carlo **propagates the model's
assumptions**; it cannot tell you the model is wrong. It produces a confident distribution from a wrong
prior just as happily as from a right one.

**Validation of a probability is out-of-sample calibration**: Brier score, reliability curve, and a
walk-forward test on data the calibrator never saw. `bt-validate.js` already implements purged k-fold,
deflated Sharpe and PSR — **reuse it, do not reimplement**.

Monte Carlo is retained, but labelled `class: "assumption_propagation"` in every output. It answers
"given this model, what is the spread of outcomes?" — never "is this model right?".

---

## 1. The core architectural rule: unproven engines may **veto**, never **vote**

This is the mechanism that makes "never guess" enforceable rather than aspirational.

Every engine declares a `reliability` — its *measured* historical accuracy on out-of-sample outcomes.

| engine state | may contribute to the score? | may block the trade? |
|---|---|---|
| `reliability` measured, `ok` | **Yes** — weight `∝ reliability` | Yes |
| `reliability = null` (never scored) | **No — weight is exactly 0** | **Yes** (as a risk veto) |
| `status = abstain` (missing data) | No | **Yes, if `critical: true` → whole decision ABSTAINs** |
| `status = error` | No | Yes → ABSTAIN |

An engine that has never been scored against reality **cannot influence a probability**. It can still stop
a trade. This asymmetry is deliberate: being wrong about *not* trading costs an opportunity; being wrong
about trading costs capital.

Today **every** engine has `reliability = null` (M2). So today the arbiter can produce **no positive
score at all** — only `NO_TRADE` or `ABSTAIN`. Correct.

---

## 2. Contracts

### 2.1 `EngineVerdict` — what every adapter returns

```jsonc
{
  "engine": "vrp-monitor",
  "engineVersion": "1.2.0",
  "status": "ok" | "abstain" | "error",

  "score": -1.0 .. +1.0 | null,   // signed edge. negative = bearish/against the structure
  "confidence": 0.0 .. 1.0 | null,// the engine's own confidence in its own score
  "reliability": 0.0 .. 1.0 | null,// MEASURED out-of-sample accuracy. null = never scored ⇒ weight 0
  "freshnessMs": 1200,            // age of the newest input datum
  "dataQuality": 0.0 .. 1.0,      // from H14's quality engine, or 1.0 for live-computed
  "sampleSize": 41 | null,        // n behind `reliability`

  "evidence": [                   // for the Explainability engine. Facts, not prose.
    { "fact": "netVRP", "value": 3.4, "unit": "vol pts", "source": "vrp-monitor@1.2.0" }
  ],
  "assumptions": { "r": 0.065, "oi_unit": "UNVERIFIED" },
  "abstainReason": "vol-context: fewer than 60 IV observations",
  "computedAt": "2026-07-09T14:22:01.123Z"
}
```

**Rules.** `score` and `confidence` are **`null`** whenever `status !== "ok"` — never `0`. A zero score is
a claim of neutrality; `null` is an admission of ignorance. Conflating them is how fail-closed dies.

### 2.2 `EngineSpec` — the registry entry

```jsonc
{
  "id": "vrp-monitor",
  "class": "edge" | "risk" | "context" | "validation",
  "critical": true,               // if it abstains, the whole decision ABSTAINs
  "declaredWeight": 0.25,         // prior. Multiplied by reliability, so it is inert until measured
  "maxAgeMs": 300000,
  "minDataQuality": 0.9,
  "reliabilitySource": "signal-health@brier",
  "requiredFor": ["SHORT_STRANGLE", "IRON_CONDOR"],
  "adapter": "adapters/vrp.js",
  "assumptionsDeclared": ["r", "realizedVolWindow"]
}
```

`critical` is per **decision mode**. A missing Event Engine is critical for a 0-DTE gamma trade and merely
degrading for a 30-DTE condor. The registry encodes that, not the code.

### 2.3 `Decision` — the immutable output

```jsonc
{
  "decisionId": "DEC-2026-07-09-000114",
  "decisionHash": "sha256:…",     // content hash of (inputs + weights + code versions)
  "decision": "ABSTAIN",
  "mode": null,                    // one of BUY_CALL … IRON_CONDOR when not abstaining

  "confidence": null,              // 0-100, null when uncalibrated
  "probability": null,             // 0-100, null when uncalibrated
  "probabilityClass": "uncalibrated",
  "probabilityCI": null,           // Wilson interval
  "sampleSize": 41,

  "riskScore": null,
  "expectedReturn": null,          // NET of charges.js. Never gross.
  "expectedDrawdown": null,
  "tailRisk": null,
  "tradeGrade": "U",               // U = ungraded. NOT "F" — F is a judgement, U is an absence

  "coverage": { "availableWeight": 0.0, "requiredWeight": 0.7, "met": false },
  "supporting": [], "opposing": [],
  "missingConfirmation": [
    { "engine": "risk-engine",      "reason": "module absent" },
    { "engine": "portfolio-engine", "reason": "module absent" },
    { "engine": "event-engine",     "reason": "module absent" },
    { "engine": "liquidity",        "reason": "no bid/ask data exists for NSE options" }
  ],
  "rejectReasons": ["coverage 0.00 < 0.70", "probability uncalibrated (n=41 < 200)"],
  "suggestedAlternative": null,
  "historicalSimilarCases": null,  // requires H14 Data Lake
  "assumptions": { … },
  "engineVersions": { "vrp-monitor": "1.2.0", … },
  "weightsVersion": "w-v1-priors-unlearned",
  "createdAt": "…"
}
```

`tradeGrade: "U"` matters. Grading an unmeasurable trade as `"F"` implies we assessed it and found it bad.
We did not. We could not.

---

## 3. Decision flow

```
1. resolve mode candidates            (registry: which modes are even possible for this instrument?)
2. fan out to adapters (parallel)     → EngineVerdict[]
3. hard gates, in order:
     a. any critical engine  status ≠ ok             → ABSTAIN(reason)
     b. any risk-class engine returns veto           → NO_TRADE(reason)
     c. freshness / dataQuality below spec           → that engine ⇒ abstain, goto (a)
4. coverage:  Σ (declaredWeight × reliability × dataQuality × freshnessDecay)
     over engines with status = ok
     if coverage < requiredWeight(mode)              → ABSTAIN(coverage)
5. score  = Σ wᵢ·scoreᵢ / Σ wᵢ            (weights as above; reliability = null ⇒ wᵢ = 0)
6. agreement: ≥ K independent engines share the sign of `score`, else → NO_TRADE
7. probability:
     p̂ ← meta-label calibrator
     gate: n ≥ N_min AND Brier ≤ B_max AND reliability slope ∈ [0.8, 1.2]
     else → probability = null, class = uncalibrated → decision ∈ {NO_TRADE, ABSTAIN}
8. economics:  EV = p̂·avgWin − (1−p̂)·avgLoss − roundTripCharges()   ← charges.js, always
     if EV ≤ 0                                       → NO_TRADE
9. approval gate (for a *strategy*, not a single signal):
     paperTrades ≥ 30  AND  forwardDays ≥ 28  AND  walkForwardPass  AND  p̂ ≥ pMin  AND  risk ≤ rMax
10. explain: build supporting / opposing / missing / drivers from `evidence[]`
11. persist immutably, return
```

Step 4 is the one people skip. Without a coverage floor, an engine set that is 90% missing still produces a
confident number from the 10% that answered.

### Sequence diagram

```
Client        MetaDecision      Registry     Adapters(N)      Calibrator     Store
  │   POST /meta-decision │           │            │               │           │
  ├──────────────────────▶│           │            │               │           │
  │                       ├──specs───▶│            │               │           │
  │                       │◀──────────┤            │               │           │
  │                       ├───────────────fan-out─▶│               │           │
  │                       │◀──── EngineVerdict[] ──┤               │           │
  │                       │ hard gates: critical? veto? stale?     │           │
  │                       │ ──────── if fail ─────────────────────────ABSTAIN──┤
  │                       │ coverage < required? ─────────────────────ABSTAIN──┤
  │                       │ weighted score, agreement check         │           │
  │                       ├──── p̂ + n + Brier ────────────────────▶│           │
  │                       │◀── {p, class:'uncalibrated'} ───────────┤           │
  │                       │ EV net of charges.js                    │           │
  │                       ├──── Decision (immutable, hashed) ──────────────────▶│
  │◀── Decision + explain │           │            │               │           │
```

---

## 4. Probability engine — what it may and may not claim

| output | rule |
|---|---|
| Win / loss probability | Only from the **calibrated** `meta-label` output, gated by `n ≥ N_min` (start at 200 overall, ≥ 30 per reliability bin), `Brier ≤ B_max`, calibration slope ∈ [0.8, 1.2]. Otherwise `null` |
| Confidence interval | **Wilson**, not normal — `n` is small and `p` will be near the boundary |
| Expected value | `p·W − (1−p)·L − charges` using **`charges.js`**. A gross EV is a lie for an options seller |
| Expected drawdown | Empirical MAE/MFE quantiles from realised trades. `null` below `n_min` |
| Tail risk | Empirical 1% and 5% quantiles, plus the **defined** max loss for defined-risk structures. For a naked short strangle, tail risk is **unbounded** and must be reported as such, not as a percentile |
| Probability distribution | Empirical, from realised outcomes. Not a fitted normal |
| Monte Carlo | `class: "assumption_propagation"`. Never labelled validation |
| Historical similarity | **Requires H14.** Until then `null` with reason `"data lake absent"` |

**The overfitting trap.** Weights and the calibrator must never be fitted on the same outcomes used to
evaluate them. Use `bt-validate.js`'s purged k-fold with embargo. A weights version that was fitted must
record the fold scheme and the embargo in `weightsVersion`, or it is not reproducible.

---

## 5. Explainability

Explanations are **assembled from `evidence[]`**, never generated as prose by a model. Every line traces to
an engine, a version, a number and a source.

```
DECISION: ABSTAIN                                        grade U · coverage 0.00 / 0.70

WHY NOT (blocking):
  ✗ risk-engine        module absent                                     [critical]
  ✗ portfolio-engine   module absent                                     [critical]
  ✗ event-engine       module absent                                     [critical]
  ✗ liquidity/spread   no bid/ask data exists for NSE options            [structural]
  ✗ probability        uncalibrated: n=41 < 200 (Wilson CI ±7.8pp)

WOULD HAVE SUPPORTED (weight 0 — reliability never measured):
  · vrp-monitor        netVRP +3.4 vol pts                    reliability: unmeasured
  · vol-context        IV rank 71                             reliability: unmeasured
  · gex-skew           GEX withheld — oi_unit UNVERIFIED (H14 F4)

MISSING DATA:
  · historical similar cases → data lake absent (H14)
  · dealer positioning       → hypothesis, not data

ALTERNATIVE: none. Coverage is below floor; no mode is evaluable.
```

Note the third line under "would have supported": `gex-skew` is **withheld**, not zeroed, because H14's
finding F4 (the `OpnIntrst` unit is unverified, and GEX scales by the lot size, 25–75×) makes any GEX
number potentially wrong by an order of magnitude.

---

## 6. Folder structure

```
meta-decision/
  index.js                       # Express :3300, read-only, separate process
  routes/{meta-decision,probability,explain,confidence,decision-history}.js
  core/
    contracts.js                 # EngineVerdict / EngineSpec / Decision schemas + validators
    registry.js                  # EngineSpec table, per-mode criticality
    arbiter.js                   # hard gates → coverage → weighted score → agreement
    coverage.js
    probability.js               # calibration gate; delegates to meta-label.js
    economics.js                 # EV, RR, tail. Uses charges.js. Never gross.
    grade.js                     # A+..F, and U for ungraded
    explain.js                   # assembles evidence[]; no free-text generation
    approval.js                  # 30 paper / 28 days / walk-forward / thresholds
  adapters/                      # READ-ONLY wrappers. No engine is modified.
    vrp.js  vol-context.js  gex.js  greeks.js  gamma-blast.js
    patterns.js  agents.js  signal-health.js  forward-test.js  walk-forward.js
    _absent.js                   # returns {status:'abstain', abstainReason:'module absent'}
  store/
    decision-store.js            # append-only JSONL via safe-write.js (C3)
  test/
data/meta-decision/
  decisions.jsonl                # append-only, hashed, never overwritten
  weights/                       # immutable weight versions
  audit.jsonl
```

The 8 absent engines get an `_absent.js` adapter that abstains with a named reason. **Nothing is stubbed
with a fake score.** When a real engine lands, one line in `registry.js` changes.

`server.js` is not modified. The panel calls `:3300` directly.

---

## 7. API

| method | path | notes |
|---|---|---|
| `POST` | `/meta-decision` | `{symbol, mode?, asOf?}` → `Decision`. `asOf` enables replay |
| `GET` | `/probability?symbol&mode` | `{p, class, ci, n, brier}` — `class` is mandatory reading |
| `GET` | `/explain/:decisionId` | full evidence tree |
| `GET` | `/confidence` | per-engine reliability, sample size, calibration drift |
| `GET` | `/decision-history?from&to&symbol` | append-only, immutable |
| `GET` | `/coverage` | which engines are up, which are absent, current coverage per mode |

Every response carries `{ decisionHash, engineVersions, weightsVersion, assumptions, class }`. A consumer
that ignores `class` can still be wrong — but never *silently*, and the audit log proves it was told.

**Determinism:** the same `(inputs, weights, code versions)` must produce the same `decisionHash`. This is
what makes replay and post-mortem possible. `Date.now()` is injected, never read directly — the same
discipline already applied to `instrument-registry.timeToExpiryYears(inst, now)`.

---

## 8. Database

Append-only `decisions.jsonl`, written through **`safe-write.js` (C3)**. Never overwritten, never
compacted. Each record carries `decisionHash`, `engineVersions`, `weightsVersion`, and the full
`EngineVerdict[]` that produced it.

Weight versions are immutable files under `data/meta-decision/weights/`. Changing a weight creates
`w-v2`; `w-v1` decisions remain reproducible forever.

> **Dependency.** This store *requires* C3 to be finished. Today's `writeFileSync` inside `catch (_) {}`
> would silently truncate the decision audit log on a crash — the one file that must never be lost.

---

## 9. Testing plan

| suite | what it proves |
|---|---|
| **Abstain matrix** | For each `critical` engine, force `status: abstain` → decision **must** be `ABSTAIN` with that engine named. N tests, one per engine |
| **Zero vs null** | An engine returning `score: 0` and one returning `score: null` produce *different* decisions. Guards the core rule |
| **Weight-0 rule** | An engine with `reliability: null` and `score: +1` cannot move the final score by one bit |
| **Veto rule** | The same engine, as `class: risk`, *can* block the trade |
| **Coverage floor** | Coverage `0.69 < 0.70` → ABSTAIN, even with unanimous agreement |
| **Calibration gate** | `n = 199` → `probability: null`; `n = 200` with `Brier > B_max` → still `null` |
| **Wilson CI** | Known-answer test against published values |
| **EV net of charges** | EV must differ from gross by exactly `roundTripCharges()`. Regression-locks TD: `pop-seller.closePoP` applies no charges |
| **Determinism / replay** | Same inputs + injected clock → identical `decisionHash`, byte for byte |
| **Leakage** | Weight fitting on fold *k* must never see fold *k*'s outcomes. Purged + embargoed, via `bt-validate.js` |
| **Monte Carlo labelling** | Any MC output missing `class: "assumption_propagation"` fails the suite |
| **Approval gate** | 29 paper trades → blocked; 30 → allowed. 27 days → blocked; 28 → allowed |
| **Immutability** | A second write to an existing `decisionId` throws |
| **Performance** | Full fan-out + arbitration < 50 ms with all adapters cached |
| **Characterization** | Today's real engine outputs → snapshot the exact ABSTAIN payload, so the day an engine lands the diff is visible |

The **abstain matrix** is the single most valuable suite in the module. It is the executable form of
"never guess".

---

## 10. Migration plan (one commit each)

| step | deliverable | gate |
|---|---|---|
| **H15-00** | **Finish C3-02…C3-06** | the decision audit log cannot use `writeFileSync` |
| H15-01 | `contracts.js` + schema validators + tests | zero/null distinction asserted |
| H15-02 | `registry.js` + `_absent.js` + coverage | today's coverage = 0.00, asserted |
| H15-03 | read-only adapters for the 16 engines that exist | **no engine file is modified** — asserted by `git diff` |
| H15-04 | `arbiter.js` + the **abstain matrix** suite | ABSTAIN on every input today |
| H15-05 | `probability.js` — calibration gate only, no number yet | `n=41` → `null`, asserted |
| H15-06 | `economics.js` (EV net of `charges.js`), `grade.js` (U) | |
| H15-07 | `explain.js` from `evidence[]` | no free-text generation |
| H15-08 | `decision-store.js` (append-only, hashed, `safe-write`) | immutability test |
| H15-09 | `index.js` + API + provenance envelope | `server.js` diff empty |
| H15-10 | `approval.js` (30 / 28 / walk-forward) | 29→blocked, 30→allowed |
| *later* | reliability learning, once outcomes exist (n ≥ 200) | purged CV, embargo |

**H15 ships useful on day one** — not as a decision maker, but as the authoritative, machine-readable
answer to *"what exactly is missing before this platform may recommend a trade?"*

## 11. Rollback plan

```bash
bash scripts/rollback-H15.sh --check   # list; touch nothing
bash scripts/rollback-H15.sh           # remove meta-decision/ code only
```

`data/meta-decision/decisions.jsonl` is **never deleted** — it is the audit trail. `server.js` is not
modified, so the trading side has no rollback surface. Reverting a weights version means pointing at
`w-v1`; nothing is recomputed, because decisions are immutable.

## 12. Risk analysis

| risk | likelihood | impact | mitigation |
|---|---|---|---|
| **Fail-closed quietly relaxed** because "it always abstains" | **High** — this is the real danger | The engine becomes a confidence generator | The abstain matrix is a test suite. Relaxing it turns the build red |
| Publishing an uncalibrated probability | High | Institutional-looking fiction | Calibration gate; `probability: null`; grade `U` |
| Averaging over missing engines | High | Confident answer from 10% of the evidence | Coverage floor, checked before scoring |
| `score: 0` treated as neutral when it means unknown | High | Silent bias toward NO_TRADE-looking noise | `null` ≠ `0`, asserted by test |
| Weights fitted on the evaluation set | High | Fictional accuracy | Purged k-fold + embargo via `bt-validate.js` |
| GEX used in the score | Medium | Wrong by 25–75× | Withheld while H14's `oi_unit` is `UNVERIFIED` |
| Monte Carlo mistaken for validation | Medium | False assurance | `class` label enforced by test |
| Decision log corrupted | Medium | Audit trail lost | Requires C3. Append-only + hash |
| Engine version drift | Medium | Irreproducible decisions | `engineVersions` in every record; `decisionHash` covers it |
| H15 destabilises trading | **Zero** | — | Separate process, read-only adapters, no engine modified |

## 13. Performance

- Fan-out is CPU-bound and local. No network. Target **< 50 ms** for a full decision.
- Adapters memoise per `(symbol, asOf)` for the life of a request.
- `decisions.jsonl` grows ~2 KB per decision. At 100 decisions/day that is **73 MB/year** — irrelevant.
- The calibrator is `O(bins)`. Reliability learning is offline, never on the request path.
- Determinism forbids `Date.now()` on the hot path; the clock is injected. This costs nothing and buys
  replay.

## 14. Future expansion

1. **Reliability learning** — the moment `n ≥ 200` labelled outcomes exist, engines start earning weight.
   Until then every engine's vote is worth exactly zero, by design.
2. **Historical similarity** — needs H14. Nearest-neighbour over the feature store, with the same purge and
   embargo discipline.
3. **Regime-conditional weights** — an engine reliable in high-IV regimes may be useless in low-IV ones.
   Requires a Market Regime engine and enough data per regime. Do not attempt on 41 samples.
4. **Bayesian shrinkage** — with small `n`, shrink each engine's reliability toward the prior rather than
   trusting a raw win rate. This is the correct answer to "we have some data but not enough".
5. **Counterfactual logging** — record what the decision *would* have been had a missing engine returned
   `ok`. Free to compute, and it quantifies the value of building that engine next.

## 15. What this design deliberately refuses to do

- It will not output a probability without calibration evidence. Not once.
- It will not let an unproven engine influence a score. It may only veto.
- It will not treat `0` as "neutral" when the engine meant "unknown".
- It will not average across missing inputs.
- It will not call Monte Carlo a validation.
- It will not grade an unmeasurable trade `F`. It grades it `U`.
- It will not use GEX until H14's `oi_unit` finding is resolved.
- It will not report a percentile "tail risk" for a naked short strangle, whose tail is unbounded.

## 16. Open decisions for the owner

1. **Finish C3 first?** The decision audit log is the one file that must never be lost, and today's writer
   truncates on crash.
2. **Accept that H15 abstains on everything today?** If yes, it ships as the missing-input oracle and the
   approval gate. If no, the only honest alternative is to build Risk / Portfolio / Event / Regime first.
3. **`N_min` for calibration.** Recommendation: 200 overall, ≥ 30 per bin, Brier ≤ 0.22, slope ∈ [0.8, 1.2].
4. **Start forward-collecting outcomes today.** 41 → 200 is roughly a year of paper trading at current
   volume, or far less if `signal-outcomes` logging is extended to every engine's *hypothetical* call.
   **This is the cheapest thing on the roadmap and it gates everything else.**
