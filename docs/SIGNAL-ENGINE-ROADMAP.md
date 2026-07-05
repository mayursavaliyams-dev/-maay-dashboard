# Signal Engine Roadmap — how to generate a genuinely tradeable signal

**Goal:** a NIFTY/SENSEX/BANKNIFTY signal good enough to trust with real money —
not a prettier indicator, but a *statistically validated edge* with disclosed
probability, sized correctly, and executed in the structure that fits the edge.

> Status: grounded in our own validated backtests + a deep-research pass
> (2026-07-05). The research's adversarial-verify stage hit session limits, so
> the external claims below are **source-linked but single-pass (not 3-vote
> verified)** — all are from primary papers/sources and are consistent with what
> we proved on real data. Sources listed at the bottom.

## What the research changed vs the draft (2 big sharpenings)

1. **GEX / dealer-positioning has NO independent predictive edge.** An 8-year
   SPY study (1,972 days) found GEX's correlation with next-day realized vol
   (ρ = −0.36) **collapses to insignificance (ρ = −0.03, p = 0.18) once you
   control for VIX and ATM IV**; DEX doesn't predict next-day returns (p = 0.19)
   [flashalpha]. → **GEX/OI positioning is a *regime descriptor*, not a signal.**
   This matches our own honest GEX caveat and **demotes Phase 2** to "label the
   regime (range vs trend), never predict direction."
2. **PCR-conditioned selling beats VIX-conditioned selling.** A Taiwan index-
   options study found writing options only when **PCR is low** (and standing
   down when PCR is high) produced higher return + lower risk than the index,
   and **outperformed VIX-based conditional writing** [ScienceDirect]. → **add
   PCR as a first-class regime-timing filter in Phase 1**, not just IVP/VIX.

Everything else the research **confirmed**: overfitting is the #1 killer (not
bad algorithms), honest walk-forward kills most "edges," all signals are
regime-dependent, and meta-labelling measurably lifts precision.

## The single most important truth (already proven here)

Our real-data backtests settled the biggest question most retail traders get wrong:

| What | Result (real NSE bhavcopy) | Verdict |
|---|---|---|
| Directional option **BUYING** | 1200 trades, **PF 0.94**, net loser (theta bleed) | ❌ no edge |
| Short **STRANGLE** (hold) | 600 days, **80% win, PF 7.25** | ✅ edge |
| **manage-at-50%** strangle | **84% win, DD 5%** | ✅ edge, smoother |
| Iron **CONDOR** | ~81% win, defined risk | ✅ tail-safe edge |

**Implication for the signal engine:** the primary job of our signal is NOT
"which way will the market go" (that's a coin-flip we can't beat consistently) —
it is **"is now a good time to SELL premium, and how much risk to take"**. A
directional view is a *secondary, low-weight* input that only picks the *side to
skew* a spread, never a naked lottery ticket.

So the engine has two heads:
1. **VOL/REGIME head (primary):** should we be short premium now, and how hard?
2. **DIRECTION head (secondary):** if we take directional risk, which side —
   and only ever as a *defined-risk spread*, never a bought lottery option.

---

## Phase 0 — Fix the foundation (validation infra) · **✅ DONE**

**Built:** `bt-validate.js` (+ `test/bt-validate.test.js`, 32 assertions) — a pure
validation library: Sharpe/skew/kurtosis, **Probabilistic Sharpe Ratio**,
**Deflated Sharpe Ratio** (Bailey/LdP — corrects for #trials, skew, kurtosis,
sample length), **walk-forward** (rolling OOS, no look-ahead), **purged k-fold**,
and expectancy. `node bt-validate.js` re-runs the existing short-strangle through
it on 600 real days with charges + 0.5% slippage.

**Result — the known selling edge PASSES every honest test** (so the harness is
trustworthy): 129 trades, 91.5% win; in-sample Sharpe 0.85; **Deflated Sharpe
0.9999 (12 trials) → PASS @95%**; **walk-forward OOS Sharpe 1.23 / 93% win**
(higher than in-sample = robust, not overfit); purged 5-fold all positive
(mean 1.04). Left skew −2.0 / kurt 9.65 honestly capture the seller's tail. Every
future signal must clear this gate before we trust it. → `bt-data/result-validate.json`.

Without honest validation, every "signal" is data-mined noise. This phase adds
no signal; it makes every later phase trustworthy.

- **Build:** a walk-forward + purged/embargoed k-fold backtester (López de
  Prado style) that reuses our real bhavcopy dataset; report **deflated Sharpe
  ratio** (adjusts for how many strategies we tried), expectancy, and full
  cost model (STT on the sell side, brokerage, exchange, GST, **realistic
  bid-ask slippage** — we already found slippage can flip VRP negative).
- **Why:** our own research showed the VRP edge survives ~1% slippage but dies
  by ~3%; and that a rosy in-sample number (the +312 first-100 directional
  fluke) was pure noise. Deflated Sharpe + walk-forward is the only honest test.
  The literature is blunt here: **most quant funds fail from validation errors
  (overfitting), not bad ideas** [GARP]; **as few as 3 backtest trials can make
  a false strategy look real** — no Sharpe threshold is safe without correcting
  for trial count, skew, kurtosis and sample length (that's exactly what the
  Deflated Sharpe Ratio does) [Bailey-López de Prado SSRN 2460551; RSS 01588].
  A rigorous walk-forward of 5 microstructure signals on 100 US stocks
  (2015-24) came out **statistically insignificant (p=0.34)** — honest testing
  routinely reveals "edges" as noise [arXiv 2512.12924].
- **Validate:** re-run the *existing* strangle/condor edge through it; if the
  edge survives out-of-sample with realistic costs, the harness is trusted.
- **Edge contribution:** 0 direct, but it is the gate every later phase must
  pass. Prevents shipping overfit garbage.

## Phase 1 — VRP regime signal (the real edge, made conditional) · **✅ v1 DONE**

**Built:** `GET /api/regime[/:inst]` — per-instrument SELL-ON / REDUCE / STAND-DOWN
+ 0-100 score from IV-percentile (India VIX 1y) + **IV−realized-vol spread** (VRP,
realized derived from daily closes) + **PCR conditioning** (sell when PCR
low-normal, stand down at extremes) + event-risk + VIX-panic, **MA-smoothed**
across ticks to avoid whipsaw. Surfaced as live gauges on the new command-center
dashboard. Live now: NIFTY/SENSEX SELL-ON (VRP +2.5/+1.6), BANKNIFTY borderline
(realized ≈ implied). Next (v2): wire the regime gate into the agents' condor
play so it only sells when SELL-ON, and validate the gated vs un-gated
expectancy through `bt-validate.js`.

Selling premium is only +EV *when implied > realized*. Sell blindly and a vol
spike wipes months of theta. So gate the sell engine on a **volatility-risk-
premium regime score**.

- **Build:** a regime score per instrument from (a) **IV percentile/rank** of
  India VIX vs its 1y range (we have this), (b) **IV − realized vol spread**
  (30d realized from index closes vs ATM IV), (c) **VIX term structure**
  (contango = calm/sell-friendly, backwardation = stress/stand-down), (d) **PCR
  conditioning** — sell only when PCR is low, stand down when PCR is high, and
  (e) event-calendar blackout. **Smooth** the composite (moving average) so it
  doesn't whipsaw. Output: SELL-ON / REDUCE / STAND-DOWN + a 0-100 richness score.
- **Why:** VRP is real but *inverts ~25% of days* (our SSRN finding) and the
  IVP≥50 filter roughly doubled net/trade in backtest. Term-structure
  backwardation is the classic "don't sell vol now" flag. **PCR-conditioned
  writing beat VIX-conditioned writing** (higher return, lower risk) in a Taiwan
  index-options study [ScienceDirect] — so PCR earns a first-class seat, not a
  footnote. All signals are **regime-dependent** (microstructure edges only
  showed up in high-vol periods, negative in calm) [arXiv 2512.12924], and
  regime models whipsaw unless **return-smoothed** to boost persistence [Wiley
  HMM] — hence the moving-average smoothing.
- **Validate:** compare condor/strangle expectancy in SELL-ON vs STAND-DOWN
  buckets over the full history; the gap is the signal's value.
- **Edge contribution:** HIGH — turns a good-on-average edge into a
  good-*when-you-trade* edge; cuts the worst tail losses.

## Phase 2 — Options-positioning as a REGIME LABEL (GEX / OI walls) — *demoted*

**Research correction:** GEX/dealer-positioning has **no independent predictive
power** once you control for VIX/IV [flashalpha 8-yr SPY]. So this is NOT a
signal — it is a **regime descriptor** that only decides *strike placement &
whether the market is likely range-bound*, and it must never be used to predict
direction or as a standalone trigger.

- **Build:** use GEX-lite (call/put walls + gamma flip) + max-pain ONLY to (a)
  classify **range-bound (positive-gamma) vs trend-risk (negative-gamma)** — a
  gate that feeds the regime score in Phase 1 — and (b) **place condor wings**
  around the OI walls (the walls are the reliable, assumption-free output).
- **Why:** positive-gamma = mean-reverting/range = condor-friendly; negative-
  gamma = breakout risk = widen wings or stand down. But since GEX predicts
  nothing after VIX-control, we use it as *context*, not *edge*.
- **Validate:** does placing wings at OI walls beat fixed-offset wings? Does the
  positive/negative-gamma gate improve the Phase-1 stand-down decision?
- **Edge contribution:** LOW-MEDIUM — better strike/risk placement + one regime
  input; explicitly NOT a directional predictor (the research is clear on this).

## Phase 3 — Confluence meta-model (turn many weak signals into one)

We already have an 11-factor master signal + a 4-engine confirmed voter. Phase 3
makes the *combination* principled instead of hand-weighted.

- **Build:** a **logistic / gradient-boosted meta-model** trained (with purged
  CV) to output a *calibrated probability* that a given setup (regime + skew +
  pattern + OI + trend) yields a profitable defined-risk trade. Use **meta-
  labelling** (López de Prado): the primary rule proposes a trade, the ML model
  predicts *whether to take it* and *how big*. Keep it explainable (SHAP /
  per-factor contribution) — our moat is honest white-box signals.
- **Why:** naive equal-weight confluence dilutes strong signals; a calibrated
  ensemble raises precision (fewer, higher-quality signals) — exactly the
  "confirmed signals" idea, but learned and probability-calibrated. Meta-
  labelling has **measured uplift**: on a mean-reversion primary, out-of-sample
  accuracy went 17%→63% (precision 0.17→0.20); on a trend primary, 37%→56%
  [Hudson Thames]. It "separates the *side* decision from the *size* decision"
  and suppresses false positives [López de Prado; Wikipedia Meta-Labeling] —
  precisely our confirmed-voter goal, but learned.
- **Validate:** reliability curve (does "70%" mean 70%?), precision/recall vs
  the current voter, and out-of-sample expectancy per probability bucket.
- **Edge contribution:** MEDIUM-HIGH — the difference between "a signal" and "a
  *calibrated* signal you can size by."

## Phase 4 — Signal → structure → size (execution fit)

A signal is worthless until it maps to the right trade at the right size.

- **Build:** a rules layer: (regime SELL-ON + neutral skew) → iron condor;
  (SELL-ON + directional skew) → credit spread on the skewed side; (STAND-DOWN
  + strong directional confluence) → *debit spread* (defined-risk directional,
  never a naked buy); strike from **expected move** (ATM straddle) not fixed %;
  DTE per regime. Size via **fractional-Kelly × IV-scaling × VIX** (we have the
  position-sizer) capped by a unified drawdown/cooldown risk engine.
- **Why:** our data says buying loses and selling wins — so *every* directional
  view must be expressed as a spread, never a long option. Expected-move strikes
  and Kelly-scaled sizing are the documented professional defaults.
- **Validate:** full walk-forward of the end-to-end mapping vs the current fixed
  condor; compare risk-adjusted return + max DD.
- **Edge contribution:** HIGH — most retail "good signals" die at execution
  (wrong structure, wrong size). This is where edge is kept or lost.

## Phase 5 — Live forward-test + self-learning loop

- **Build:** paper-forward every signal with full attribution; feed outcomes to
  the confluence-learner (we have it) to re-weight factors; track *live*
  calibration drift; auto-demote factors that decay.
- **Why:** backtest edge ≠ live edge; regimes change. Continuous forward
  validation + credit assignment is how systematic desks stay honest.
- **Validate:** rolling live hit-rate vs backtest expectation; alert on drift.
- **Edge contribution:** compounding — protects the edge over time.

---

## What the best actually do differently (working hypothesis, to be cited)

- They **don't predict direction** as the core edge — they harvest structural
  premia (VRP) and use direction only to *shape risk*.
- They **gate on regime** and stand down in the wrong environment (the hardest,
  most valuable discipline).
- They **validate brutally** (walk-forward, deflated Sharpe, real costs) and
  distrust in-sample beauty.
- They **size to survive** (fractional Kelly, vol-scaled, hard drawdown stops) —
  survival compounds; blow-ups don't.
- Their edge is **execution + discipline + honest measurement**, not a secret
  indicator.

## Ranked priority (build order)

1. **Phase 0** validation infra (gate for everything) — *highest leverage*
2. **Phase 1** VRP regime gate — *biggest direct edge*
3. **Phase 4** signal→structure→size — *where edge is kept*
4. **Phase 3** calibrated confluence meta-model — *fewer, better signals*
5. **Phase 2** GEX/OI skew — *strike & risk placement*
6. **Phase 5** forward-test + learning loop — *durability*

Everything paper-first, each phase test+doc+committed, no phase trusted until it
clears Phase 0's honest validation.

## Sources (deep-research 2026-07-05 · source-linked, single-pass)

- Bailey & López de Prado, **Deflated Sharpe Ratio** — SSRN 2460551; RSS
  Significance 10.1111/1740-9713.01588 (trial-count/skew/kurtosis correction;
  "3 trials can fake an edge").
- GARP whitepaper a1Z1W0000054x6lUAA — quant funds fail from validation errors,
  not bad algorithms; purged k-fold needed for time series.
- arXiv 2512.12924 — walk-forward of 5 microstructure signals, 100 US stocks
  2015-24 → p=0.34; signals only work in high-vol regimes (regime dependence).
- flashalpha.com GEX/DEX 8-yr SPY backtest — GEX/DEX have no independent edge
  after VIX/IV control (regime descriptors, not signals).
- ScienceDirect S0927538X25000241 — PCR-conditioned option-writing beats
  VIX-conditioned (Taiwan index options).
- Wiley asmb.70058 — Bayesian HMM regime detection; smooth returns to cut
  false-signal whipsaw.
- Hudson Thames / López de Prado / Wikipedia — meta-labelling: separates side
  from size, measured precision/accuracy uplift.
- Zerodha Varsity — iron condor = defined-risk VRP structure for range-bound,
  elevated-premium regimes.
- Our own real-data backtests — directional buying PF 0.94 (no edge); short
  strangle 80%/PF 7.25, manage-at-50% 84%/DD 5%, condor ~81% (the edge).

> Caveat: the research verify-stage was rate-limited, so external claims are
> single-pass. They agree with our own real-data findings and standard quant
> literature, but treat any single-source number as directional, not gospel —
> which is exactly why **Phase 0 (honest validation) is non-negotiable first.**
