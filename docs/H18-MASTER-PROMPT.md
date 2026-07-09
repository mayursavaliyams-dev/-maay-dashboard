# H18 — Institutional Risk Engine
## Master Prompt (prepared at the end of H17, so context is never lost)

> Paste this whole file as the opening prompt for the H18 work session.
> It carries constraints that were **measured** during C1c, C3, H14, H15 and H17.
> An H18 built without them will produce institutional-looking fiction.

---

## Part A — Status correction (read first)

**H14, H15, H16 and H17 are designs. None is built.** Only their documents exist:
`docs/H14-DATA-LAKE-DESIGN.md`, `docs/H15-META-DECISION-DESIGN.md`, `docs/H16-MASTER-PROMPT.md`,
`docs/H17-SMART-MONEY-DESIGN.md`.

**C3 (atomic writes) is still uncommitted.** `safe-write.js` exists with 48 passing assertions; **no writer
uses it.** The ledger data-loss chain is live: a crash mid-write truncates a ledger, the loader's
`catch { return [] }` reads it as empty, and the next save overwrites the record. This is the file H18 must
depend on for its own audit log.

**H18 is, by measurement, the single most valuable missing engine.** H15 cannot emit any decision without
it — Risk Budget and Portfolio Exposure are `critical` inputs, and their absence forces `ABSTAIN` on every
evaluation.

---

## Part B — Non-negotiable measured constraints

### B1. There are **41 labelled outcomes** in the entire platform

| ledger | records |
|---|---|
| `data/signal-outcomes.json` | 11 |
| `data/ai-agents-trades.json` | 20 |
| `data/strangle-trades.json` | 7 |
| `data/signal-paper-positions.json` | 2 |
| `data/gamma-blast-trades.json` | 1 |
| `data/forward-test/` | **empty** |

**Consequences that must not be argued around:**

- **CVaR / Expected Shortfall from 41 samples is noise.** ES at 95% is estimated from the worst ~2 trades.
  Its standard error swamps its value. **Empirical CVaR is forbidden below a declared `n_min`.**
- **Risk of Ruin** requires a win rate and a payoff ratio. Both are uncalibrated (H15's Wilson interval on
  a 60% win rate at n=41 is roughly [45%, 74%]). A ruin probability computed from that range is not a number.
- **Monte Carlo is not validation.** It propagates the model's assumptions. It answers "given this
  distribution, what is the spread?", never "is this distribution right?". Label every MC output
  `class: "assumption_propagation"`, as H15 requires.

> **Rule H18-R1.** Below `n_min`, all *statistical* risk measures return `null` with a reason.
> **Structural** risk measures — which need no history — are computed instead. See B3.

### B2. Kelly already exists **three times**, and they disagree

| file | form |
|---|---|
| `position-sizer.js:30` | **full** Kelly, `f* = W − (1−W)/R`, with `R = |avgWin| / max(1, |avgLoss|)` |
| `trade-planner.js:28` | **half** Kelly |
| `vix-kelly-sizer.js:19` | **half** Kelly, clamped to `[0, 0.5]` |

`max(1, |avgLoss|)` is a rupee-scale hack: for any strategy whose `|avgLoss| < 1` it silently changes the
Kelly ratio. **H18 must unify these into one `sizing.js` and delete the duplicates — not add a fourth.**

Also carried from C1c-5: `position-sizer` uses a NIFTY-calibrated `marginPerLotStrangle = 130000` for
**every** instrument, and `.env.example` sets `SIZER_STRANGLE_MARGIN=150000` while the code default is
`130000` — a live config/code divergence.

And a real blind spot, found by test: **above the 25-lot cap, IV scaling has no effect at all.** At ₹50 L
capital, `ivPct = 0` and `ivPct = 1` both return 25 lots.

### B3. What *is* computable without history — and this is where H18's value lives

| measure | computable today? | how |
|---|---|---|
| **Structural max loss** | **Yes** | Defined-risk structures (iron condor, spreads) have an arithmetic max loss. Compute it exactly, net of `charges.js` |
| **Unbounded-risk flag** | **Yes** | A naked short strangle's tail is **unbounded**. It must be reported as `unbounded`, never as a percentile. `pop-seller.buildIronCondor` currently returns **two short legs and no wings** — a strangle wearing a condor's name, with **no `maxLoss` field at all** |
| **Portfolio exposure netting** | **Yes** | Five separate P&L books exist (`strangle-engine`, `agents-engine` directional + condor, `gamma-blast-engine`, `pop-seller`, `signal-paper-engine`) with **no aggregate netting anywhere.** Same underlying, same expiry — the true book-level delta/gamma/vega is nobody's number today |
| **Margin utilisation** | **Yes** | SPAN is an exchange parameter; keep it in config, per instrument, with `marginSource` provenance (C1c-5 already added this to `position-sizer`) |
| **Hard limits** | **Yes** | `data/config-overrides.json` already holds `MAX_DAILY_LOSS_PERCENT: 5`, `CAPITAL_TOTAL`, `STRANGLE_CAPITAL: 700000` |
| **Scenario / stress testing** | **Yes — deterministic** | Re-price the whole book under a grid: spot `±1/2/3/5%`, IV `±10/20/50%`, `T → 0`. No history needed. **This is the most honest risk number the platform can produce today** |
| **Correlation across books** | **Partly** | The books trade the same index. Cross-book correlation of *index exposure* is ≈ 1 by construction, not something to estimate from 41 trades. Netting, not correlation, is the right tool |
| Empirical CVaR / ES / VaR | **No** | n = 41 |
| Risk of Ruin | **No** | uncalibrated win rate |
| Portfolio Heat from realised vol of P&L | **No** | n = 41 |

### B4. Charges are not optional

`charges.js` exists and is used by three engines. `pop-seller.closePoP` applies **no transaction charges**
at all. Every H18 number — max loss, EV, risk budget consumption — must be **net of `roundTripCharges()`**.
A gross risk figure understates the loss for an options seller, which is precisely the wrong direction.

### B5. Engineering charter (in force)

- Never rewrite; enhance. `server.js` and `execution-engine.js` are protected — each edit needs approval.
- **Fail closed.** `null ≠ 0`. Refuse rather than emit a plausible wrong number.
- No mutable singleton state. Pass context as arguments.
- Characterization tests first; prove the tripwire fires; full suite gated on **exit code**; never commit red.
- **Never commit unasked. Never push.**
- Every design also produces a self-contained markdown doc under `docs/`.
- Replies to the owner in **Gujarati script**; code, paths, identifiers in English.

---

## Part C — The H18 brief

**Role:** Chief Risk Architect. You do not size trades to maximise growth. You size them to survive.

**Objective:** Build the Institutional Risk Engine that H15 lists as a `critical` input, such that H15 can
stop abstaining on risk grounds — and such that every number it emits is either **structural** (exact) or
**explicitly null** (honest).

### C1. Scope — build

1. **`risk-engine/` as a separate process (port 3500), emitting an `EngineVerdict`** per H15's
   `contracts.js`. `class: "risk"`. It has **veto power** and, until `reliability` is measured, **weight 0**.
   A risk engine that can only veto is exactly what a risk engine should be.
2. **Unified `sizing.js`** — one Kelly, one fractional-Kelly, one IV scaler. Delete the three copies. Fix
   the `max(1, |avgLoss|)` hack. Fix the IV-masked-above-cap blind spot, or document it as intended.
3. **Portfolio netting engine.** Aggregate the five books into one exposure: net delta, gamma, vega, theta
   per underlying and per expiry, plus notional and margin. **This number does not exist anywhere today.**
4. **Structural max-loss engine.** Exact arithmetic per structure, net of charges. Emit `unbounded: true`
   for naked short options rather than a percentile. Raise a defect against
   `pop-seller.buildIronCondor` for its missing wings and missing `maxLoss`.
5. **Hard-limit enforcement.** Daily / weekly / monthly loss limits and drawdown, read from
   `config-overrides.json`, **fail-closed**: if the ledger cannot be read, the limit is treated as breached.
6. **Deterministic stress testing.** A scenario grid (spot × IV × time), re-pricing the netted book.
   Reproducible, no randomness, no history. Ship this before any statistical risk measure.
7. **Risk budget accounting.** Capital → daily risk budget → consumed → remaining. This is the Business
   Owner Mode the H13 brief asked for, in its correct home.

### C2. Scope — do **not** build

- Empirical **CVaR / ES / VaR** from 41 trades. Return `null` with `reason: "n=41 < n_min"`.
- **Risk of Ruin** from an uncalibrated win rate.
- **Monte Carlo presented as validation.** Retain it, label it `assumption_propagation`.
- A **fourth Kelly implementation**.
- **Correlation matrices** estimated from 41 overlapping trades on one underlying.
- Anything requiring **bid/ask, spread or depth** — H14 established none exists for NSE options.

### C3. Deliverables (design before code)
Architecture · Folder structure · Data contracts · API design · Database design · Risk decision flow ·
Sequence diagram · Testing plan · Migration plan · Rollback plan · Risk analysis · Performance analysis ·
Future expansion.

### C4. API sketch
`/risk/verdict` · `/risk/exposure` (netted book) · `/risk/max-loss` · `/risk/limits` ·
`/risk/stress?spot&iv&t` · `/risk/budget` · `/risk/sizing`
Every response: `{ class, limitations[], missingEvidence[], assumptions, engineVersion, decisionHash }`.

### C5. Testing plan — the suites that matter

| suite | proves |
|---|---|
| **Fail-closed ledger** | If a P&L ledger is unreadable, `limits.breached = true`. **Never** "no loss recorded, so we're fine" |
| **`n_min` gate** | `n = 41` → CVaR/ES/RoR are `null`. `n = n_min − 1` → still `null` |
| **Unbounded tail** | A naked short strangle reports `unbounded: true`, never a percentile |
| **Netting** | Two books long and short the same strike net to zero delta. Today they do not — pin the current behaviour first |
| **Charges** | Every risk figure differs from its gross counterpart by exactly `roundTripCharges()` |
| **Kelly unification** | The three old call sites produce identical results through the new `sizing.js`, or the diff is explained |
| **Stress determinism** | Same book + same grid → identical output hash |
| **`null ≠ 0`** | An unmeasurable risk never contributes `0` |
| **H15 contract** | Verdict validates; `reliability: null` ⇒ weight 0, veto-only |
| **Monte Carlo labelling** | Any MC output missing `class` fails the suite |

### C6. Migration order

`H18-00` finish **C3-02…C3-06** (the risk audit log must not truncate) →
`H18-01` contracts + `EngineVerdict` →
`H18-02` characterization suite for the three Kelly implementations **before** unifying →
`H18-03` `sizing.js` unified; old call sites delegate →
`H18-04` portfolio netting (pin the current un-netted behaviour first) →
`H18-05` structural max loss + `unbounded` flag →
`H18-06` hard limits, fail-closed →
`H18-07` deterministic stress grid →
`H18-08` API + store (append-only, `safe-write`) →
`H18-09` register with H15; watch coverage rise above zero for the first time.

### C7. Success criteria

- H15 stops abstaining **on risk grounds** — not because risk was assumed away, but because the risk inputs
  now exist and are exact.
- Every statistical risk measure is `null` with a reason, or backed by `n ≥ n_min`.
- A naked short strangle is reported as **unbounded**, in writing, in the API.
- The five P&L books produce **one** netted exposure number for the first time.
- `pop-seller.buildIronCondor`'s missing wings are raised as a defect with evidence, not silently sized.

---

## Part D — Questions H18 must answer before writing code

1. What is `n_min` for CVaR / ES / Risk of Ruin? (Recommendation: 200 trades **and** ≥ 2 regimes.)
2. What is the true netted delta/gamma/vega of the five books right now? Nobody knows. Measure it first.
3. Is `SIZER_STRANGLE_MARGIN` 130000 or 150000? Code and `.env.example` disagree.
4. Should a naked short strangle be permitted at all under a daily-loss-limit regime, given its tail is
   unbounded and the platform's own backtest says the edge is in *defined-risk* condors?
5. When the ledger is unreadable, is "breached" the right default? (It is. Prove it with a test.)

**Answer with measurements. If the data is absent, say so and stop. Never invent risk.**
