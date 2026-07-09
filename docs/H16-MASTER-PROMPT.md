# H16 — Institutional Gamma Blast Intelligence Engine
## Master Prompt (prepared at the end of H15, so context is never lost)

> Paste this whole file as the opening prompt for the H16 work session.
> It carries the constraints that were **measured** during H14 and H15. An H16 built without them will
> produce confident, wrong numbers.

---

## Part A — Non-negotiable context (measured, do not re-litigate)

Before proposing anything, know these facts. Each was verified against the code or the data on disk.

### A1. What already exists
- `gamma-blast-detect.js` — the detector. Gates on `expiry === istDate`, an afternoon window, ATM proximity
  and a blast score. It correctly derives expiry from the option chain, **not** from a hardcoded weekday.
- `gamma-blast-engine.js` — an **expiry-day option-BUYING paper engine** on top of the detector. It is the
  only *buying* strategy in the platform with a stated rationale (gamma dominates theta at 0-DTE). It is
  registry-exclusive: lot size comes from `instrument-registry.js`, and it refuses to open on an
  instrument the registry does not know.
- `gex-skew.js` (`computeGEX`, `bsGamma`, `r = 0.065`) and `vol-context.js` (`gexLite`, `bsGamma`,
  **`r = 0`**, and the **opposite dealer-sign convention**). Two GEX implementations that can disagree on
  the same dashboard.
- `data/gamma-blast-trades.json` — **1 record.**

### A2. The three hard constraints

**C1 — Gamma Exposure is currently un-publishable.**
H14 finding F4: the unit of `OpnIntrst` in the NSE bhavcopy is **unverified**. GEX is
`Σ gamma × OI × lot × S² × 0.01`. If OI is already in units and the code multiplies by lot again, **every
GEX figure is wrong by a factor of the lot size (25–75×)**. Until `oi_unit` is verified and recorded as a
property of the dataset version, **no GEX number may be emitted**. H16 must treat this as fail-closed, not
as a caveat in a footnote.

**C2 — Dealer gamma / dealer positioning is a hypothesis, not a measurement.**
Public data shows open interest. It does not show *who is short*. Every "dealer gamma" figure in the
industry rests on an assumption (dealers are short gamma; or trade-side is inferred from tick data that
does not exist here). H16 may compute it, but it must be labelled `class: "hypothesis"` with a named,
versioned `dealer_sign_model`, and it must never be returned from a `/greeks` or `/features` endpoint
without that label.

**C3 — Gamma-blast is not backtestable today, and saying otherwise is the failure mode.**
Gamma-blast is an **intraday, expiry-day** phenomenon. The platform holds:
- option-level intraday: **4 days** (`data/opt-candles/`)
- underlying 1-minute: ~9.5 months
- NIFTY EOD bhavcopy: 2.4 years — **end-of-day only**, so it cannot see an intraday premium expansion at all

You cannot backtest a 5×/10× intraday premium event on end-of-day settle prices. Any "gamma blast backtest"
built on bhavcopy is measuring something else and calling it gamma blast.

Related, already established by real backtests on this platform: **directional option BUYING has no edge**
(1,200 trades, PF 0.94, net loser). Option **selling** (VRP) is the validated edge. Gamma-blast is the one
buying strategy with a rationale, and it is **forward-test only**. Treat that status as evidence, not as a
gap to be filled with a synthetic backtest.

### A3. The engineering charter (already in force)
- **Never rewrite. Enhance only.** `server.js` and `execution-engine.js` are protected; each edit needs its
  own approval.
- **Fail closed.** Refuse rather than emit a plausible wrong number. `null ≠ 0`.
- **No mutable singleton state.** Pass context as arguments.
- **Characterization tests first** — pin current behaviour, prove the tripwire fires, then change.
- **Full suite gated on exit code**, never on grepping output. Never commit a red suite.
- **Never commit unasked.** Never push.
- **Every design also produces a self-contained markdown doc under `docs/`.**
- Replies to the owner are in **Gujarati script**; code, paths and identifiers stay English.

### A4. Blocking dependencies
- **C3 (atomic writes)** — `safe-write.js` exists; **no writer uses it yet**. Any new ledger H16 creates
  must use it from day one, and the existing `catch { return [] }` loaders still silently destroy ledgers.
- **H14 (Data Lake)** — required for any historical gamma study, and for `oi_unit` resolution.
- **H15 (Meta Decision)** — H16 must expose an `EngineVerdict`, not a bespoke output shape.

---

## Part B — The H16 brief

**Role:** Chief Quantitative Architect for expiry-day gamma dynamics.

**Objective:** Turn the existing gamma-blast detector into an *institutional intelligence engine* that
measures, explains and forward-validates expiry-day gamma behaviour — **without inventing a backtest that
the data cannot support.**

### B1. Deliverables (design before code, as always)
Architecture · Folder structure · Data contracts · API design · Database design · Decision flow ·
Testing plan · Migration plan · Rollback plan · Risk analysis · Performance analysis · Future expansion.

### B2. Scope

**Must build**
1. **`EngineVerdict` adapter** so H15 can consume gamma-blast. `reliability: null` until outcomes exist —
   therefore weight 0, veto-only. This is the correct starting state.
2. **Unified gamma module.** `gex-skew.js` and `vol-context.js` disagree on `r` (0.065 vs 0) and on the
   dealer sign convention. Reconcile into one implementation with **explicit, versioned assumptions**.
   Do not silently pick one. Measure the divergence first and report it.
3. **Fail-closed GEX.** Refuses to compute while `oi_unit` is `UNVERIFIED`. Emits
   `{ value: null, reason: "oi_unit unverified (H14 F4)" }`.
4. **Intraday capture pipeline.** Persist live option chains to `bronze/option_intraday` **starting today**.
   This is the only path to a real gamma dataset, and every day of delay is a day permanently lost.
5. **Forward-test harness** for the buying engine: pre-registered hypotheses, outcome labelling into
   `signal-outcomes`, Brier tracking through `signal-health.js`.
6. **Expiry-day microstructure features** computable from what exists: time-to-close, ATM distance in
   strike steps (`strike-resolver.js`), realized vol of the underlying 1-min series, premium decay curve.

**Must NOT build**
- A gamma-blast backtest on EOD bhavcopy. (C3)
- A published GEX number. (C1)
- A dealer-positioning number presented as data. (C2)
- Anything that modifies `gamma-blast-engine.js`'s trading behaviour without a characterization suite first.
- A 5×/10× "premium expansion" study. It requires intraday option prices across many expiries. **We have
  four days.** Say so; do not approximate it.

### B3. The honest research question
Not *"how do we backtest gamma blast?"* — we cannot, yet.
But: **"what must be true for gamma blast to have an edge, and how few forward-test observations do we need
to reject it?"**

Design the experiment first: pre-register the hypothesis, the entry rule, the exit rule, the sample size,
and the stopping rule. Then let the forward test run. A pre-registered forward test on 40 expiries beats a
fabricated backtest on 600 EOD days.

### B4. Success criteria
- H16 emits a valid `EngineVerdict` that H15's abstain matrix accepts.
- GEX is **withheld**, with a machine-readable reason, and a test proves it stays withheld.
- The intraday capture pipeline is running and its coverage is visible in `/quality`.
- The two gamma implementations are reconciled, their historical divergence measured and documented.
- A pre-registered forward-test protocol exists, with a stopping rule, before a single trade is judged.

### B5. First three commits
1. Characterization suite for `gamma-blast-detect.js` and `gamma-blast-engine.js` (the engine has 36
   assertions; the detector has none). Pin current behaviour before touching anything.
2. Divergence report: `gex-skew.computeGEX` vs `vol-context.gexLite` on the same inputs — quantify the
   disagreement in `r` and in sign, on real chains.
3. `bronze/option_intraday` capture, written through `safe-write.js`. Start collecting today.

---

## Part C — Questions H16 must answer before writing code

1. Is `OpnIntrst` in contracts or units? (One afternoon; unblocks GEX permanently.)
2. Which `r` and which dealer-sign convention are correct, and what is the measured impact of choosing
   wrong?
3. What is the minimum number of expiries needed to reject "gamma blast has no edge" at a given power?
4. Does the detector's afternoon window have any basis in measured data, or is it a chosen constant?
5. What is the capture cadence for intraday chains that balances fidelity against disk and API limits?

**Answer with measurements. If the data is absent, say so and stop. Never invent market behaviour.**
