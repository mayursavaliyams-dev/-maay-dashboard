# 062 — Market Gravity Engine

**ANTIGRAVITY PRO · Chief Quantitative Market Structure Research Scientist**
**Date:** 2026-07-29 · **Status:** DESIGN ONLY — no production code written
**Mandate:** measure attraction forces. **Not** prediction. **No BUY or SELL.**
**Unknown remains Unknown. No evidence claimed without a citation.**

Third in a series. Companion to docs/060 (Strike Volatility) and docs/061 (Strike
Lifecycle). Hazards established there — tick quantisation, stale ≠ stable, greek
decomposition, IV provenance, expiry-baseline, censoring, the missing morning —
apply unchanged and are not restated.

---

## 0. Grades and severity

| Grade | Meaning |
|---|---|
| **Verified** | Observed directly on this system and reproduced |
| **Measured** | Counted from this repo's own data, today |
| **Estimated** | Reasoned from partial evidence |
| **Opinion** | Judgement or practitioner convention, reversible |
| **Unknown** | Not established — and left that way |

| Class | Meaning |
|---|---|
| **S1** | Would make the engine confidently wrong, or blocks it |
| **S2** | Structural; cost compounds daily |
| **S3** | Quality |

---

# Part 1 — The problem this engine has that the previous two did not

Volatility and lifecycle are **descriptive**. "This strike moved 3%" is a
measurement; it can be right or wrong, but it makes no claim about why.

**"Gravity" is a causal claim.** Saying a zone *attracts* price asserts that
concentration of open interest, gamma or liquidity at a level **causes** price to
move toward it. That is a mechanism, it has a real academic literature, that
literature is partly supportive and partly contested, and it is extremely easy to
confirm accidentally.

## 1.1 The tautology that will silently validate this engine

Open interest and volume concentrate **near the money**, because at-the-money
strikes are the ones people trade. So:

> "Price is close to the highest-OI strike"

is true almost by construction, most of the time, in every market. An engine that
computes a gravity zone from OI and then observes that price is near it has
measured **nothing**. It has rediscovered that traders trade near spot.

This is endogeneity, and it is the single most likely way this module produces a
confident, well-presented, entirely circular result.

**Severity: S1.** Every claim of attraction in this engine must be tested against a
**null model** (§8), not against zero.

## 1.2 The direction of causation is genuinely unresolved

Three explanations are consistent with "price sits near high-OI strikes", and this
system's data cannot separate them:

| Explanation | Direction |
|---|---|
| Hedging flow pulls price toward the strike | Gravity → price |
| Traders write options at strikes they expect price to stay near | Price expectation → OI |
| Both are driven by where price already is | Spot → both |

The literature in §9 supports a real hedging-flow effect **near expiry, for
individually pinnable stocks**. It does not establish that a mid-cycle OI wall
pulls an index. **Grade of "OI walls attract price on a normal Tuesday": Unknown.**

---

# Part 2 — Data audit: what can be measured

## 2.1 Available live, per strike

**Grade: Verified** (docs/060 §1.1, re-checked): `ltp, oi, changeOI, volume, iv,
ivSource, bid, ask, bidQty, askQty, delta, gamma, theta, vega`.

Everything the gravity inputs need — **at a point in time**.

## 2.2 Stored

| Series | Stored? |
|---|---|
| Premium OHLC per strike | ✅ `[t,o,h,l,c]` |
| OI per strike over time | ❌ |
| Volume per strike over time | ❌ |
| IV per strike over time | ❌ |
| Greeks over time | ❌ |
| Depth (bid/ask/qty) over time | ❌ |
| **Index spot price over time** | ❌ **`data/candles.json` and `data/prices.json` are 0 KB** |

**Grade: Measured**, today.

## 2.3 The asymmetry that decides the whole build order

> **Price history can be re-fetched from the broker. Gravity history cannot be
> reconstructed at all.**

Index candles are retrievable on demand. But **where the OI walls stood at 11:00
last Tuesday is gone forever** — it was observed live, used for one render, and
discarded.

**Consequence: this engine cannot be backtested retroactively. It can only ever be
validated forward, starting from the day storage begins.** Every day of delay is a
day permanently removed from the future evidence base.

**Severity: S2, time-critical** — the same finding as docs/060 §2.1 and docs/061
§13, now with a third independent reason.

## 2.4 And the observation window is short

12 of 13 archived sessions are missing the market open, 61–358 minutes each
(docs/061 §1). The archive auto-deletes past 40 files. So even forward validation
starts from a base of roughly **one complete session**.

---

# Part 3 — The dealer-sign problem

This is the largest evidence weakness in any gravity engine, and this repo is
already honest about it.

## 3.1 What the existing module assumes

`gex-skew.js:33` states it outright:

> *"Dealer convention: dealers are SHORT calls (customers buy calls) and LONG puts"*

**Grade: Verified** — read from the source today. The module also states it uses
GEX **only** as a range/trend regime label and explicitly **not** as directional
alpha. That is the right posture and this design keeps it.

## 3.2 Why the convention is not data

Dealer gamma exposure requires knowing **who is on which side** of the open
interest. Open interest is a net count; it carries no participant tag.

- In the US, CBOE publishes **open-close volume data** separating customer from
  market-maker activity — which is what makes credible dealer-positioning work
  possible there.
- **No equivalent per-strike customer/market-maker split is available for NSE or
  BSE index options.** NSE's participant-wise data is instrument-level and
  end-of-day.

**Grade: Estimated** for the non-availability claim (it should be re-verified
against current exchange publications before being cited externally); **Verified**
that this system has no such field.

## 3.3 Why this matters more than it appears

The sign is not a detail — **it inverts the conclusion**. If dealers are net long
gamma, they buy dips and sell rallies, which **dampens** moves and produces
attraction. If they are net short gamma, they do the opposite, which **amplifies**
moves and produces the reverse. A single wrong assumption turns a "magnet" into a
"repellent".

**Design rules:**
1. Every dealer-gamma output is graded **Estimated**, never Verified, and names the
   convention in the panel.
2. The engine reports **both signs** where it materially changes the answer —
   "under the standard convention: attraction at 24,300; under the inverse:
   amplification at 24,300."
3. Net GEX sign is a **regime label**, not a magnet location. This preserves the
   existing module's stated posture.

**Severity: S1.**

---

# Part 4 — The twelve inputs

Each: what it actually measures, feasibility today, grade.

| # | Input | What it really measures | Today | Grade |
|---|---|---|---|---|
| 1 | **OI Concentration** | Where positions are held. **Not** where price will go | ✅ point-in-time | Measured (EOD) / Estimated (intraday) |
| 2 | **Volume Concentration** | Where trading occurred. Cumulative — must be differenced (docs/061 §4.1) | ✅ point-in-time | Measured |
| 3 | **Liquidity Concentration** | Where size stands: depth, spread, turnover | ✅ point-in-time | Measured |
| 4 | **Gamma Concentration** | Hedging sensitivity **conditional on the dealer-sign assumption** (§3) | ✅ point-in-time | **Estimated** |
| 5 | **Strike Dominance** | One strike's share of chain totals — a Herfindahl-style concentration | ✅ | Measured |
| 6 | **Premium Concentration** | Notional premium at risk by strike | ✅ | Measured |
| 7 | **Historical Reaction Zones** | Levels where price previously decelerated or reversed | ❌ **no spot history stored** (§2.2) | **Unknown** |
| 8 | **Dealer Positioning** | See §3 | ⚠️ | **Estimated, assumption-dependent** |
| 9 | **High-Low Memory** | Prior session extremes | ⚠️ `opthl` holds **option** H/L with timestamps; **index** H/L is not stored | Partial |
| 10 | **Expiry Pressure** | Time-to-expiry weighting of gamma and OI | ✅ registry gives expiry | Measured (calendar) |
| 11 | **VWAP Attraction** | Volume-weighted average price as a reference level | ❌ needs intraday index price + volume | **Unknown** — and see §9.6 |
| 12 | **Market Breadth** | Participation across constituents | ❌ **no constituent data in this system** | **Unknown** |

**Score: 6 of 12 computable today (point-in-time only), 2 assumption-dependent,
1 partial, 3 not computable at all.**

Note what is missing: **inputs 7, 11 and 12 — the three that would provide
independent, non-option evidence of attraction — are exactly the ones this system
cannot produce.** The engine as it stands would be built entirely from option-chain
data, which is precisely the data most exposed to the tautology in §1.1.

**That is the honest headline of this document.**

---

# Part 5 — Per-strike scores

## 5.1 A composite score must be decomposable, or it is not a measurement

A single "Gravity Score: 87" invites false precision and hides its weights. Two
requirements:

1. **Report the underlying quantities in their own units** — gamma notional per 1%
   move in ₹, OI in contracts *and* in notional, depth in contracts, share of chain
   total in %. Units make a number checkable.
2. If a composite is published, **its weights are disclosed on the panel and the
   score decomposes back into contributions.** This repo already holds that standard
   — the AI agents pipeline discloses every parameter on screen.

**A rank or percentile is preferred to a score.** "3rd of 93 eligible strikes by
gamma notional" is honest; "87/100" is a number nobody can audit.

## 5.2 The nine per-strike outputs

| Output | Definition | Status |
|---|---|---|
| **Gravity Score** | Disclosed-weight composite of inputs 1–6, decomposable | ⚠️ point-in-time only |
| **Attraction Score** | Concentration measures alone, **no causal claim in the name or copy** | ⚠️ |
| **Repulsion Score** | Modelled from negative-gamma amplification. **See §5.3** | **Estimated, weak** |
| **Magnet Strength** | Cohort-relative concentration percentile | ⚠️ |
| **Persistence** | How long a zone stays dominant | ❌ needs OI time series |
| **Duration** | Elapsed time as dominant zone | ❌ same |
| **Confidence** | Per-metric (docs/060 §8) | ✅ |
| **Reliability** | Stability of the zone under resampling and small perturbations | ⚠️ partly computable |
| **Historical Accuracy** | **See §5.4 — redefined** | ❌ blocked |

## 5.3 Repulsion is a model, not an observation

Attraction has a literature (§9.1). **Repulsion largely does not.** The nearest
established mechanism is negative dealer gamma producing hedging that *amplifies*
moves — which is instability, not a repelling point in space.

**Design rule:** `Repulsion Score` is labelled as **a modelled construct derived
from the dealer-sign assumption**, graded Estimated, and the panel says that no
peer-reviewed support for point-repulsion is claimed. Renaming it
**`Amplification Zone`** would be more accurate and is recommended.

## 5.4 "Historical Accuracy" is where prediction re-enters — and it must not

Accuracy *of what*? If it means "did price reach the zone", then the engine is
scoring a forecast, and the mandate is broken in the metric name.

**Redefinition, ex-post and non-directional:**

> **Residence statistic.** Over completed sessions, did the index spend more time
> within *b* basis points of the identified zone than of a **moneyness-matched
> baseline strike** selected without reference to OI?

This is a descriptive comparison of realised dwell time against a null (§8). It
makes no statement about the future and produces no target.

**Even so, it will be read as a forecast** the moment it is displayed live. So:
- It is computed and shown **only on completed sessions**, never on the live zone.
- The panel states, in words: *"this is realised dwell time versus a matched
  baseline. It is not a probability that price will go there."*

**Severity: S1.**

---

# Part 6 — Detection

All eight detections require a **time series of the gravity inputs**. That series
does not exist (§2.2). Every one is blocked today.

| Detection | Definition | Blocker |
|---|---|---|
| Gravity Build-up | Concentration rising over ≥ *n* samples, cohort-relative | OI/volume series |
| Gravity Expansion | Zone widening across adjacent strikes | Same |
| Gravity Compression | Zone narrowing | Same |
| Gravity Collapse | Concentration falling below activation floor with dwell | Same |
| Gravity Shift | Dominant zone moves ≥ *k* strikes, dwell-confirmed | Same |
| **Gravity Flip** | Net dealer gamma changes sign | Same + §3 assumption |
| Multiple Gravity Zones | ≥ 2 zones above the significance floor | Point-in-time possible |
| **Competing Gravity Zones** | Top zones statistically indistinguishable | Point-in-time possible |

## 6.1 Competing zones — the case that must not be collapsed to a winner

When the top two zones are within measurement noise, reporting a single "current
gravity zone" **manufactures a decision the data does not support.**

**Rule:** if the top-2 separation is inside the bootstrap confidence interval, the
output is **"No dominant zone — 2 competing zones at 24,300 and 24,500"**, not a
winner. A concentration index (Herfindahl over strike shares) is published
alongside, so a diffuse chain is visibly diffuse.

This is the gravity analogue of `Undetermined` in docs/060 §5.4.

---

# Part 7 — Classification

| Requested | Decision |
|---|---|
| Very Strong / Strong / Medium / Weak Gravity | ✅ **Cross-sectional percentiles within today's chain**, never fixed constants |
| Temporary Gravity | ❌ Blocked — needs persistence over time (§6) |
| Persistent Gravity | ❌ Blocked — same |
| **Institutional Gravity** | ❌ **Refused.** No participant data exists (docs/061 §7). Replaced by **`POSITION_HELD_CONCENTRATION`** (ΔOI ÷ volume), which describes flow behaviour, not identity |
| **Unknown Gravity** | ✅ **And it is the correct default**, not a residual bucket |

## 7.1 Unknown is the default, not the leftover

A strike is classified `Unknown Gravity` unless it passes the eligibility gate
(docs/060 §5.3) **and** its concentration is separable from the null (§8). On a
diffuse day, **most of the chain should be Unknown**, and the board should look
sparse. A gravity board that is fully populated every single day is not measuring
gravity; it is ranking noise.

---

# Part 8 — Validation design

This is the part that determines whether the engine is science or decoration.

## 8.1 The null model

For every attraction claim, the null is: **"price is near this zone only because
the zone is near spot."**

Construct a **matched baseline**: for each identified gravity zone, select a
comparison strike matched on moneyness and time-to-expiry but chosen **without
reference to OI, gamma or volume**. Compare realised dwell time, approach
frequency and reversal frequency between the two.

**If the gravity zone does not beat its matched baseline, the engine has found
nothing — and must say so.** That result is publishable and belongs on the
Discoveries panel (docs/059 §8.4). A negative result here is a genuine finding.

## 8.2 Statistical discipline

| Requirement | Why |
|---|---|
| **Pre-registration** | Zone definition, dwell band *b*, and horizon are fixed **before** looking at outcomes. Otherwise *b* gets tuned until the effect appears |
| **Multiple-testing correction** | 93 strikes × several metrics × many days. At *p* < 0.05 uncorrected, ~5 strikes "work" every day by chance. Benjamini–Hochberg or equivalent, and report the corrected figure |
| **Effect size, not just significance** | With enough samples, trivial effects become significant. Report dwell-time difference in minutes and basis points |
| **Out-of-sample split** | Any tuned parameter is fitted on one period and reported on another |
| **Censoring** | docs/061 §8.1 — sessions are left-censored; the archive is right-censored |
| **Regime stratification** | Results split by expiry-day / non-expiry, and by volatility regime. Pinning literature finds effects concentrated near expiry (§9.1); pooling would smear a real expiry effect across ordinary days |

## 8.3 The honest power statement

With ~1 complete archived session, **no validation is possible today.** Any claim
of measured attraction, at present, would be fabricated.

**Estimated** requirement for a first weak test: **40–60 complete sessions**,
stratified by expiry proximity. That is roughly **3 months of clean collection**
from the day storage begins. This number is an estimate and should be replaced by a
proper power calculation once the effect size of interest is chosen.

---

# Part 9 — Literature

**A caution I want on the record.** The references below are given from knowledge,
with a stated confidence in each. **Every citation must be verified against the
actual paper before it is quoted in any external document, panel or report.** A
plausible-looking citation with a wrong year or a misremembered finding is exactly
the failure mode this platform's evidence rules exist to prevent. Where my
confidence is not high, I say so rather than supply false precision.

## 9.1 Option-induced pinning — the strongest support for attraction

| Work | Finding | Citation confidence |
|---|---|---|
| **Ni, Pearson & Poteshman (2005), *Stock price clustering on option expiration dates*, Journal of Financial Economics** | Stock prices cluster at option strikes on expiration dates | **High** |
| **Avellaneda & Lipkin (2003), *A market-induced mechanism for stock pinning*, Quantitative Finance** | Provides the delta-hedging mechanism for pinning | **High** |
| **Golez & Jackwerth (2012), *Pinning in the S&P 500 futures*, Journal of Financial Economics** | Pinning found in S&P 500 futures around expiration | **High** |
| Ni, Pearson, Poteshman & White (c. 2021), on option trading's impact on underlying prices, Review of Financial Studies | Option hedging flow affects underlying prices more broadly | **Medium-high** — verify title and year |

**What this literature supports:** attraction to strikes **near expiration**, driven
by hedging.
**What it does not support:** a mid-cycle OI wall acting as a magnet on a large
index on an ordinary day. **Grade: Unknown.**

## 9.2 Dealer inventory and demand-based pricing

| Work | Finding | Confidence |
|---|---|---|
| **Gârleanu, Pedersen & Poteshman (2009), *Demand-Based Option Pricing*, Review of Financial Studies** | End-user demand moves option prices when intermediaries cannot hedge perfectly — the foundation for dealer inventory mattering at all | **High** |
| **Bollen & Whaley (2004), *Does net buying pressure affect the shape of implied volatility functions?*, Journal of Finance** | Net buying pressure shapes the IV surface | **High** |
| **Baltussen, Da, Lammers & Martens (2021), *Hedging demand and market intraday momentum*, Journal of Financial Economics** | Hedging demand relates to intraday momentum patterns | **Medium-high** — verify year |

**Critical caveat:** all of these identify demand or dealer position using data that
separates customer from intermediary. **This system has no such data** (§3.2). The
mechanism is supported; **this system's ability to measure the input is not.**

## 9.3 Liquidity and price impact

| Work | Relevance | Confidence |
|---|---|---|
| **Kyle (1985), *Continuous Auctions and Insider Trading*, Econometrica** | Price impact λ — the formal basis for "depth resists movement" | **High** |
| **Glosten & Milgrom (1985), Journal of Financial Economics** | Spread from adverse selection | **High** |
| **Amihud (2002), *Illiquidity and stock returns*, Journal of Financial Markets** | Practical illiquidity measure | **High** |

These justify treating **depth as resistance to movement** — the most defensible
"gravity-like" input, because it is a direct microstructure quantity rather than an
inferred position.

## 9.4 Price discovery

**Hasbrouck (1995), *One security, many markets*, Journal of Finance** (information
share) and **Gonzalo & Granger (1995)** (permanent-transitory decomposition).
**Confidence: high / medium-high.** Relevant if this engine is ever extended to ask
*where* price discovery happens — options versus futures versus cash.

## 9.5 Volatility clustering

**Mandelbrot (1963)**; **Engle (1982), ARCH, Econometrica**; **Bollerslev (1986),
GARCH, Journal of Econometrics**; **Cont (2001), *Empirical properties of asset
returns***, Quantitative Finance. **Confidence: high.**

Relevance: volatility clusters, so **persistence in a gravity metric may reflect
volatility persistence rather than a zone's own stability.** Any persistence claim
must control for the prevailing volatility regime, or it will re-derive GARCH.

## 9.6 Auction market theory and VWAP — practitioner, not peer-reviewed

- **Steidlmayer & Koy, *Markets and Market Logic* (1986)**, and the Market Profile
  tradition. **This is practitioner literature, not peer-reviewed research.** Its
  concepts (value area, point of control) map naturally onto "gravity", which is
  precisely why they must be labelled **Opinion**, not Verified.
- **Berkowitz, Logue & Noser (1988), *The total cost of transactions on the NYSE*,
  Journal of Finance** — origin of VWAP as an execution **benchmark**.
  **Confidence: medium-high.**
- **VWAP as an attractor of price: I know of no peer-reviewed support.** It is an
  execution benchmark that became folklore. **Grade: Opinion.** If the engine
  includes VWAP attraction, it must carry that label.

## 9.7 Round-number clustering — the confound nobody controls for

**Harris (1991), *Stock price clustering and discreteness*, Review of Financial
Studies** (confidence: medium-high) and **Osler (2003)** on order clustering at
round numbers, Journal of Finance (confidence: medium).

**Why this matters here:** option strikes **are** round numbers. Any apparent
attraction to a strike may be attraction to a round number that would exist with no
options listed at all. **The null model in §8.1 must include a round-number
control**, or the engine will attribute to gamma what belongs to psychology.

**This is the most-overlooked confound in practitioner gravity work, and it is
cheap to control for.** **Severity: S1.**

## 9.8 Max Pain

**I am not aware of credible peer-reviewed support for max pain as a predictor or
attractor.** The pinning literature (§9.1) is related but **distinct**: it concerns
clustering at strikes with large open interest near expiration, not convergence to
the payout-minimising point.

`server.js` already computes a max-pain figure. **Recommendation: keep it, label it
Opinion / practitioner convention, and exclude it from any composite gravity score
until it beats the §8.1 null on this system's own data.**

## 9.9 The transfer problem — the caveat over everything above

**Nearly all of this literature is US equity and US index markets.** NSE and BSE
weekly index options differ in retail share, expiry frequency, contract size and
settlement. **Whether any of these findings transfer to NIFTY/BANKNIFTY/SENSEX
weeklies is Unknown**, and this system's own data is the only way to find out.

**No result from §9 may be presented as evidence about this market.** It is evidence
that the *mechanism exists somewhere*, and it justifies looking. Nothing more.

---

# Part 10 — Outputs

Every output carries: metric, units, window, cohort, eligible-set size, exclusions
with reasons, confidence, grade, and — for any attraction claim — its **baseline
comparison** (§8.1).

| Output | Today | Blocker |
|---|---|---|
| Current Gravity Zone | ⚠️ Point-in-time concentration, **no causal language** | Persistence needs OI series |
| Top 10 Gravity Zones | ⚠️ Same, with competing-zone handling (§6.1) | |
| Top Magnet Strikes | ⚠️ Rename to **Top Concentration Strikes** until §8.1 is passed | Validation |
| Top Repulsion Zones | ⚠️ Rename to **Amplification Zones**, Estimated (§5.3) | Dealer sign |
| Gravity Heatmap | ⚠️ Strike × time, **grey = unobserved, no interpolation** | Needs the series |
| Gravity Timeline | ❌ | Needs the series |
| Historical Comparison | ❌ | ~1 complete session exists |
| **Evidence / Unknown / Verified / Confidence / Reliability** | ✅ **Fully deliverable now** | — |

As in docs/061: the honesty layer is the part that can be shipped complete today.
On this data that is not a consolation prize — **it is the deliverable**.

---

# Part 11 — Prohibitions

Carried forward and extended:

1. **No BUY, SELL, target, stop or direction** — no such field in the schema.
2. **No causal verbs in output copy.** Not "pulls", "will hold", "should attract".
   The permitted form is: *"38% of chain gamma notional sits at 24,300."*
3. **No live Historical Accuracy** (§5.4).
4. **No single gravity zone when zones compete** (§6.1).
5. **No composite score without disclosed weights and decomposition** (§5.1).
6. **No dealer-gamma output without the assumption named** (§3.3).
7. **No participant-type classification** (§7).
8. **No citation without verification** (§9 preamble) — and no claim that a US
   finding is evidence about this market (§9.9).
9. **No interpolation across unobserved periods.**

Rules 1, 2 and 3 are build-checkable against a vocabulary list, as in docs/060–061.

---

# Part 12 — Prerequisites, in dependency order

| # | Step | Severity | Why here |
|---|---|---|---|
| **1** | **Collector runs from 09:15; alert below 95% coverage** | **S1, operational** | Unchanged from docs/061. Nothing below is worth anything without it |
| **2** | **Persist the index spot series** | **S1** | Currently 0 KB. **Without where price was, no attraction claim is testable at all** |
| **3** | Persist per-strike `oi, volume, iv, ivSource, greeks, depth` | **S2, time-critical** | Gravity history is otherwise unreconstructable (§2.3) |
| 4 | Lift the 40-file cap | **S2** | Validation needs 40–60 sessions (§8.3) |
| 5 | Pre-register zone definition, dwell band, horizon | **S1** | Before any outcome is examined |
| 6 | Null model: moneyness-matched **and round-number-controlled** baseline | **S1** | §8.1, §9.7 |
| 7 | Point-in-time concentration metrics with units and decomposition | **S2** | The first genuinely shippable analytic |
| 8 | Competing-zone / no-dominant-zone logic | **S1** | §6.1 |
| 9 | Dealer-sign dual reporting | **S1** | §3.3 |
| 10 | Time-series detections, persistence, timeline | **S3** | After step 3 has run for weeks |
| 11 | Residence statistics vs baseline, with multiple-testing correction | **S2** | After ~40–60 clean sessions |

Steps 1 and 2 are small, operational, and worth more than everything below them.

---

# Part 13 — Honest delivery phases

| Phase | Deliverable | Unknown |
|---|---|---|
| **Today** | Point-in-time concentration (OI, volume, liquidity, premium, dominance), gamma concentration **labelled assumption-dependent**, competing-zone detection, full Evidence/Confidence/Unknown accounting | Every persistence, timeline and accuracy claim; all attraction validation |
| **After steps 1–3** *(next session)* | Gravity time series, build-up/collapse/shift/flip detection, persistence, duration, timeline | Whether any of it predicts or explains anything |
| **After ~40–60 clean sessions** | First **weak** test of attraction against the null, stratified by expiry proximity, multiple-testing corrected | Dealer positioning — **assumption-dependent, indefinitely** |
| **Never, from this data** | Participant identity; market breadth without constituent data; verified dealer sign | — |

---

## Summary

A gravity engine is the most scientifically demanding of the three modules designed
this week, because it is the only one making a **causal** claim — and the only one
that can validate itself by accident.

Four findings should govern the build:

1. **The tautology.** OI concentrates near spot; "price is near the OI wall" is
   nearly always true and means nothing. Without a moneyness-matched, round-number-
   controlled null model, this engine will confirm itself forever.
2. **The dealer sign is assumed, not measured.** `gex-skew.js:33` names the
   convention honestly. But no per-strike customer/market-maker split exists for
   Indian index options, and **getting the sign wrong turns a magnet into a
   repellent.** All dealer-gamma output is Estimated, permanently, unless that data
   appears.
3. **The index spot series is not stored** — `candles.json` and `prices.json` are
   0 KB. **Attraction cannot be tested without knowing where price was.** Price
   history can be re-fetched; **gravity history cannot be reconstructed at all**, so
   every day without storage is a day permanently absent from the future evidence
   base.
4. **The literature supports pinning near expiry, not mid-cycle magnetism** — and
   nearly all of it is US markets. Whether it transfers to NIFTY weeklies is
   **Unknown**, and this system's own data is the only way to find out.

Three things I decline to build: **`Institutional Gravity`** (no participant data),
**live `Historical Accuracy`** (a forecast in a measurement engine's clothing), and
**max pain inside a composite score** (no credible peer-reviewed support, and it
would silently borrow the credibility of the inputs beside it).

Build the collector schedule and the spot series first. Everything scientific here
depends on data that is, today, being discarded.
