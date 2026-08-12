# 060 — Strike Volatility Analysis: an institutional measurement module

**ANTIGRAVITY PRO · Chief Quantitative Volatility Research Scientist**
**Date:** 2026-07-29 · **Status:** DESIGN ONLY — no production code written
**Mandate:** measure where activity is concentrated. **Not** to predict. **No BUY or SELL output.**

---

## 0. Evidence grades and severity classes

| Grade | Meaning |
|---|---|
| **Verified** | Observed directly on this system and reproduced |
| **Measured** | Counted or computed from this repo's own data, today |
| **Estimated** | Reasoned from partial evidence |
| **Opinion** | A judgement call, reversible |
| **Unknown** | Not established — and left that way |

| Class | Meaning |
|---|---|
| **S1** | Would make the module confidently wrong. Fix before shipping |
| **S2** | Structural. Cheap now, expensive after the data is collected wrongly |
| **S3** | Quality. Real value, no compounding cost |
| **S4** | Deferred by decision, reason recorded |

---

# Part 1 — Ground truth: what this system can actually see

Everything in this section was measured on 2026-07-29 against the live server and
the stored archive. **Grade: Measured** unless stated otherwise.

## 1.1 Live, per strike, right now

From `/api/options/snapshot?instrument=NIFTY`, each strike carries a `ce` and a
`pe` object with these fields:

```
ltp · oi · changeOI · volume · open · high · low · close · prevClose
bid · ask · bidQty · askQty
iv · ivSource · delta · gamma · theta · vega · pop
```

This is a rich point-in-time snapshot. **The greeks are present**, which matters
enormously for Part 3.

## 1.2 Stored, per strike, over time

`data/opt-candles/<date>.json` stores, per strike-side series:

```
[ timestamp, open, high, low, close ]      ← premium only
```

**There is no IV, no OI, no volume and no greek in the stored series.** The entire
implied-volatility and open-interest time dimension is visible live and **discarded**.

| Property | Value |
|---|---|
| Series on 2026-07-29 | **662** (strike × side) |
| Points in a series | 157 |
| Nominal cadence | 60 s |
| **Mean gap** | **86.2 s** |
| **Largest gap** | **2,520 s — 42 minutes** |
| Files retained | **13** present; auto-deleted past **40** |
| `opthl` files | 21 |
| Tick size | **₹0.05** (registry, established empirically, not assumed) |

## 1.3 The two observations that reshape the whole design

**a. 70 of 662 series never moved at all.** 10.6% of the chain has open = high =
low = close for the entire session. Their realised volatility is exactly zero.

**b. A worked example from the same snapshot** — NIFTY 21600, one strike, two sides:

| | CE | PE |
|---|---|---|
| LTP | 2,447.25 | **1.35** |
| Volume | **0** | 5,664,230 |
| OI | 845 | 4,730,700 |
| Bid / Ask | 2,456.40 / 2,689.45 | 1.35 / 1.40 |
| Spread | **233.05 ≈ 9% of price** | 0.05 ≈ 3.7% |
| IV | **1** | 34.42 |
| `ivSource` | **`bsm`** | **`feed`** |
| Gamma | 4.0 × 10⁻¹² | — |

Read that carefully. In one row of one chain there are **four** distinct traps,
and a naive module would fall into all of them. Part 3 is about those traps.

---

# Part 2 — Feasibility of the 19 requested metrics

The single most valuable thing this document can do is state, honestly, which of
the nineteen are computable and which are not. **Never invent missing data** means
this table has to exist before any of the interesting work.

| # | Metric | Status | Why |
|---|---|---|---|
| 1 | Current Volatility | ✅ **Now** | Premium OHLC series exists |
| 2 | Historical Volatility | ⚠️ **Capped at 40 sessions** | Archive auto-deletes past 40 files; **13 present today** |
| 3 | Intraday Volatility | ✅ **Now** | 157 points/session, with the gap caveat (§3.3) |
| 4 | Price Velocity | ✅ **Now, gap-normalised** | Must be per-minute, never per-sample (§3.3) |
| 5 | Price Acceleration | ⚠️ **Low confidence** | Second derivative on 86 s irregular sampling is mostly noise (§3.3) |
| 6 | Premium Expansion | ✅ **Now** | |
| 7 | Premium Collapse | ✅ **Now** | |
| 8 | High-Low Range | ✅ **Now** | Also in `opthl` |
| 9 | Average Candle Size | ✅ **Now** | Interpret as per-minute, not per-candle (§3.3) |
| 10 | IV Change | ❌ **Not stored** | IV is live-only; the series is discarded. **S2** |
| 11 | **IV Rank** | ❌ **Unknown for ~1 year** | Convention needs 252 sessions. Ceiling is 40 by construction; 13 exist |
| 12 | **IV Percentile** | ❌ **Unknown for ~1 year** | Same |
| 13 | OI Change | ⚠️ **Point-in-time only** | `changeOI` is live; no stored series. Intraday OI is provisional (§3.6) |
| 14 | Volume Change | ❌ **Not stored** | `volume` is live and cumulative; without a series there is no Δ |
| 15 | **Trade Count** | ❌ **Not in the feed at all** | No such field. `volume` is contracts, not trades. **Unknown, permanently, from this source** |
| 16 | Premium Rotation | ❌ **Needs tick data** | Requires intra-bar path; only OHLC is kept |
| 17 | Time at High | ✅ **Now, quantised** | Resolution is one sample ≈ 86 s |
| 18 | Time at Low | ✅ **Now, quantised** | Already partly served by `/api/opt-at-low` |
| 19 | Liquidity Score | ✅ **Now (live), point-in-time** | bid/ask/bidQty/askQty/volume/OI all present |

**Score: 9 computable now, 3 degraded, 6 not computable, 1 impossible from this source.**

> **This is the headline finding.** Roughly a third of the requested metric set
> cannot be produced today — not because of effort, but because the data is
> observed and then thrown away. The module is worth building; it must ship with
> its Unknown column populated and visible, not quietly narrowed to the nine that
> happen to work.

### 2.1 The storage change that unlocks eight of them

Metrics 10, 11, 12, 13, 14 and part of 16 all need **one** change: persist the
per-strike fields that already arrive live.

```
STORED TODAY   [ t, o, h, l, c ]
NEEDED         [ t, o, h, l, c, iv, ivSource, oi, volume, bid, ask, bidQty, askQty,
                 delta, gamma, theta, vega ]
```

**Severity: S2, and time-critical.** Every session that passes without it is a
session of IV and OI history that can never be reconstructed. The 40-file cap
makes it worse: the archive is not merely thin, it is **actively being erased**.
IV Rank needs 252 sessions; starting today, the first honest IV Rank is roughly
**one year away** — and only if the cap is lifted in the same change.

**Grade: Measured** — the cap is documented in `option-warehouse.js`; 13 files remain.

---

# Part 3 — Six hazards that would make this module confidently wrong

Each is **S1**. Each is demonstrated with data measured today, not hypothesised.

## 3.1 Tick quantisation makes cheap options look explosive

Tick size is **₹0.05**. Therefore one tick is:

| Premium | One tick as % of price |
|---|---|
| ₹0.50 | **10.0%** |
| **₹1.35** (the real PE above) | **3.70%** |
| ₹20 | 0.25% |
| ₹200 | 0.025% |

A deep-OTM option jiggling by a single tick registers a **3.7% move**. Rank the
chain by percentage volatility and the top of every "explosive" list will be the
cheapest, least meaningful strikes in it — measuring the price grid, not the market.

**Design consequences (all mandatory):**
- Every volatility and expansion metric is reported in **two units: ₹ and %**. Neither alone is a ranking.
- A **tick-noise ratio** is computed per strike: `tickSize / premium`. A strike whose observed move is within 2 ticks is flagged `noise-dominated` and **excluded from explosive rankings while still being shown with its flag**.
- Rankings state their premium floor and how many strikes the floor excluded.

## 3.2 Stale is not stable — and the difference is the whole module

**70 of 662 series never moved all day.** A naive "most stable strikes" ranking
would put them first. But look at the CE above: **volume 0**, spread ≈ **9%**.
That strike is not stable. **Nobody traded it.**

Zero measured volatility has two completely different causes:

| Cause | Truth | Correct label |
|---|---|---|
| Traded actively, price held | Genuinely low volatility | **Sleeping Strike** |
| Not traded at all | **No observation exists** | **No Data** — never a volatility class |

**Rule: a volatility of zero derived from zero trades is Unknown, not low.** This
is the same rule already enforced elsewhere in this platform — a blank means *not
reported*, never zero. Reporting an untraded strike as "most stable" is the
volatility-module form of that failure.

Separation test (all three required for a real reading): `volume > 0`, at least
*k* distinct traded prices in the session, and a spread inside a liquidity bound.

## 3.3 Irregular sampling — a 42-minute hole in the day

Cadence is nominally 60 s; **measured mean 86.2 s; measured maximum gap 2,520 s.**

| Consequence | Requirement |
|---|---|
| A "candle" is not a fixed interval | All rates are **per minute**, never per sample. "Average candle size" is meaningless without dividing by elapsed time |
| Velocity across a 42-minute gap is not velocity | Any interval beyond a threshold (proposed 3 × median gap) is **excluded from rate metrics and counted in a `gapMinutes` field** |
| **Acceleration is barely measurable** | A second derivative on irregular ~86 s sampling is dominated by sampling noise. Ship it with **low confidence by construction**, or ship it only over smoothed windows and say so |
| Nyquist | Anything oscillating faster than ~3 minutes is invisible. The module must not describe a strike as "quiet" when it is only **unsampled** |
| Coverage | Every metric carries `samples`, `expectedSamples`, `coveragePct`. A 60%-covered session is not comparable to a 98%-covered one |

## 3.4 Premium volatility is not implied volatility — the central scientific point

An option's premium moves for four reasons:

```
dP  ≈  Δ·dS  +  ½Γ·dS²  +  ν·dIV  +  Θ·dt
       ↑           ↑          ↑        ↑
   underlying   convexity   vol      decay
```

**A strike "exploding" is usually the underlying moving, not the strike becoming
volatile.** A 0.50-delta option in a 1% index move gains roughly 0.5% × spot/premium
in premium terms — a large percentage — while its implied volatility may not have
moved at all.

Ranking strikes by raw premium volatility therefore produces, with near-certainty,
a ranking dominated by **whichever strikes had the highest delta during the
session's largest index move.** That is a re-derivation of moneyness, dressed as a
volatility discovery.

**This module must decompose, and the data to do it is already present live**
(`delta`, `gamma`, `vega`, `theta` per strike):

| Component | Meaning | Grade of the decomposition |
|---|---|---|
| **Delta-explained** | Premium move attributable to the index move | Estimated — greeks are snapshot-time |
| **Gamma-explained** | Convexity contribution | Estimated |
| **Vega-explained** | Attributable to IV change | **Unknown today** — IV is not stored (§2) |
| **Theta-explained** | Decay over elapsed time | Estimated |
| **Residual** | What none of the above explains | **This is the interesting number** |

> **The primary research output of this module should be the residual**, not the
> raw premium move. A strike whose premium moved far beyond what delta and gamma
> explain is genuinely anomalous. A strike that moved exactly as much as its delta
> implies is not news — it is arithmetic.

Until IV is stored, the vega term is Unknown and the residual therefore **conflates
"real anomaly" with "IV moved"**. That limitation must be printed on the output,
not buried. **Severity: S1 for the labelling; S2 for the storage fix.**

## 3.5 IV provenance must never be mixed

The snapshot carries `ivSource`, with two observed values in a single row:

- `feed` — the exchange/broker's implied volatility, an **observation**
- `bsm` — a locally computed Black-Scholes fallback, a **model output**

The CE above shows `iv: 1` with `ivSource: "bsm"` — a placeholder for a deep-ITM
option, not a market reading.

**Rule: rankings by IV, IV change, IV rank or IV percentile include `feed` rows
only.** A `bsm` row is displayed with its provenance and is **excluded from ranking**.
Mixing them produces a league table in which model artefacts outrank market
observations. The evidence-grade rule of this platform applies unchanged: grades
are never merged, and an observation and a model output are different grades.

## 3.6 OI, volume and the strike set are less stable than they look

- **Intraday `changeOI` is provisional.** The exchange's authoritative OI is
  end-of-day. Intraday figures are snapshot-based and can revise. Label intraday OI
  metrics **Estimated**; only EOD OI is **Measured**.
- **`volume` is cumulative**, not per-interval. Without a stored series there is
  no Δvolume — hence metric 14's status.
- **Chain membership is not stable.** Strikes enter and leave as spot moves. A
  strike's *moneyness* changes continuously, so **comparing "NIFTY 21600 CE" across
  two days is comparing two different instruments in economic terms.**

  **Consequence: all historical comparison is by moneyness or delta bucket, never
  by absolute strike.** Cross-day tables keyed on strike number are a survivorship
  artefact. **Severity: S1** for any "Historical Comparison" output.

---

# Part 4 — Metric definitions that survive the hazards

Every metric below carries, without exception: `value`, `unit`, `window`,
`samples`, `coveragePct`, `grade`, `confidence`, and `flags[]`.

## 4.1 Volatility family

| Metric | Definition | Notes |
|---|---|---|
| **Realised premium vol (intraday)** | Std. dev. of log returns of premium between valid consecutive samples, annualised by elapsed time, not by count | Gap-excluded intervals removed and counted |
| **Realised premium vol (historical)** | Same, across sessions | **Window capped at available files; state `n` sessions** |
| **Parkinson range vol** | From session high/low | More efficient than close-to-close on sparse sampling; `opthl` already holds the inputs |
| **Residual vol** | Vol of the greek-unexplained residual (§3.4) | **The headline research metric** |

## 4.2 Motion family

| Metric | Definition |
|---|---|
| **Velocity** | Δpremium per minute, gap-aware, in ₹/min **and** %/min |
| **Acceleration** | Δvelocity per minute over smoothed windows only; ships with a low-confidence flag by construction |
| **Premium expansion / collapse** | Max favourable / adverse excursion from session open, in ₹ and %, with the timestamp of each |
| **Average candle size** | Mean (high − low) **normalised to per-minute** |
| **Time at high / low** | Fraction of *sampled* time within a tolerance band of session extremes. Tolerance is **max(2 ticks, 0.5%)** — without it, quantisation makes cheap options appear pinned |

## 4.3 Activity family

| Metric | Definition | Grade |
|---|---|---|
| **Volume** | Cumulative contracts | Measured |
| **OI, ΔOI** | Point-in-time | Estimated intraday, Measured at EOD |
| **Trade count** | — | **Unknown — no such field exists** |
| **Liquidity score** | Composite of relative spread, quoted depth (`bidQty` + `askQty`), volume and OI — each normalised **cross-sectionally within today's chain**, never against fixed constants | Measured, point-in-time |

Illustrative from real data: the CE with a 9% spread and zero volume scores near
the bottom; the PE with a 3.7% spread, 5.66 M volume and 4.73 M OI scores near the
top. **The liquidity score is what makes every other ranking trustworthy**, because
it is the gate that keeps untraded strikes out of them.

## 4.4 IV family — reserved, not faked

| Metric | Today | On storage change |
|---|---|---|
| IV level | ✅ live, `feed` rows only | ✅ |
| IV change | ❌ Unknown | ✅ next session |
| **IV Rank** | ❌ Unknown | ✅ **~252 sessions later** |
| **IV Percentile** | ❌ Unknown | ✅ **~252 sessions later** |

The UI shows these fields **present and explicitly Unknown**, with the resolution
condition attached — the same pattern used for the hero-zero base rate:

> **IV Rank — Unknown.** Needs 252 sessions of stored per-strike IV. Storage began
> *(not yet)*; 0 of 252. Interim IV Rank over a shorter window is **not** IV Rank
> and will not be shown under that name.

An IV Rank computed over 13 sessions and labelled "IV Rank" is a fabricated
institutional statistic. A 13-session window may be shown as **"IV position, 13
sessions"** — a different name for a different, weaker claim.

---

# Part 5 — Classification

## 5.1 Thresholds are cross-sectional, never absolute

A fixed threshold ("vol > 40% = High") breaks the moment the regime changes: on a
calm day nothing qualifies, on an event day everything does, and the classifier
silently becomes a VIX detector.

**Every class boundary is a percentile within today's own chain**, computed over
the **eligible** strikes only (§5.3).

## 5.2 The eight classes, made measurable

| Class | Definition | Nature |
|---|---|---|
| **Very High Volatility** | Residual-vol percentile ≥ 95 | Cross-sectional, today |
| **High Volatility** | 80 – 95 | |
| **Medium Volatility** | 40 – 80 | |
| **Low Volatility** | < 40, **and liquidity-eligible** | |
| **Sleeping Strike** | Liquidity-eligible, traded, vol percentile < 10, range < 3 ticks | **Requires trades** — otherwise `No Data` |
| **Explosive Strike** | ≥ 1 velocity excursion beyond a cross-sectional extreme, **and** residual-dominated, **and** premium above the noise floor | **Past tense. Describes what happened.** Not a forecast |
| **Trending Strike** | Directional persistence (e.g. Hurst > 0.5 or a runs-test result) over the session | Statistical, with p-value |
| **Mean Reverting Strike** | Persistence below the random-walk band | Statistical, with p-value |

Plus two classes the brief did not ask for and that the data demands:

| Class | Why it must exist |
|---|---|
| **No Data** | 70 of 662 series today (§3.2). Without this class they are misfiled as "Low Volatility" |
| **Noise Dominated** | Premium so low that observed movement is within tick quantisation (§3.1) |

**Severity of omitting these two: S1.** They are 10.6% and (estimated) a further
substantial share of the chain.

## 5.3 Eligibility gate — applied before any classification

A strike is eligible for a volatility class only if **all** hold:
1. `volume > 0`
2. ≥ *k* distinct traded prices in the session (proposed *k* = 3)
3. Relative spread within a cross-sectional bound
4. `coveragePct` above a floor (proposed 60%)
5. Premium above the tick-noise floor

Everything failing the gate is classified `No Data` or `Noise Dominated`, is
**counted**, and is **shown** — never silently dropped. Every ranking prints
"*n* of 662 strikes eligible" as a first-class number.

## 5.4 Trending / mean-reverting: state the sample honestly

With ~157 samples per session and a 42-minute hole, a Hurst exponent or
variance-ratio test has wide confidence intervals. These two classes ship with
their **p-value and sample count visible**, and a strike that fails significance is
`Undetermined`, not defaulted to either class.

**Grade of any single-session persistence classification: Estimated at best.**

---

# Part 6 — Live detection

Ten "highest / fastest" boards. Each is a **cross-sectional extreme within an
eligible set**, and each carries the same envelope.

| Board | Ranked by | Eligibility beyond §5.3 |
|---|---|---|
| Fastest Moving | Residual velocity, ₹/min and %/min | Both units shown |
| Most Traded | Volume | — |
| Highest IV Increase | ΔIV | **`feed` rows only** (§3.5) · **Unknown until IV is stored** |
| Highest IV Drop | ΔIV | Same |
| Highest Premium Expansion | Max favourable excursion | Above noise floor |
| Highest Premium Collapse | Max adverse excursion | Above noise floor |
| Highest OI Build-up | ΔOI | Estimated intraday, confirmed at EOD |
| Highest OI Unwinding | ΔOI | Same |
| Highest Volume Spike | Volume vs its own recent norm | **Unknown until volume series is stored** |
| Highest Liquidity | Liquidity score | — |

**Three of the ten are Unknown today.** They appear on the board with that status
and the resolution condition, rather than being removed — a board with ten rows of
which three say "Unknown, needs stored IV history" is more useful and more honest
than a board with seven rows and no explanation.

**Every board row carries:** value, unit, rank, percentile within the eligible set,
confidence, flags, and the eligible-set size. A rank without its denominator is not
a rank.

---

# Part 7 — Outputs

## 7.1 Volatility Ranking

Full sortable table over eligible strikes. Default sort: **residual vol**, not raw
premium vol (§3.4). Columns carry units. Ineligible strikes are shown in a separate,
collapsed section labelled with the reason — never merged into the ranking.

## 7.2 Top 10 Active / Explosive / Stable

Each list header states: the metric, the unit, the window, the eligible-set size,
and how many strikes each gate excluded.

**"Top 10 Stable" is the one most likely to be wrong**, because the untraded
strikes are the natural false positives. It draws from `Sleeping Strike` only —
never from `No Data` — and says so on the panel.

## 7.3 Heatmap

Strike (y) × time (x); colour = the chosen metric.

- **Grey is a real colour and means no observation.** A gap of 42 minutes is a grey
  band, not an interpolated smear. Interpolating a heatmap across missing data is
  inventing data at exactly the point where a reader is least able to detect it.
- Diverging scale centred on the chain median, so colour means "relative to the
  rest of the chain today", consistent with §5.1.
- Rows ordered by moneyness with the ATM band marked, so the picture survives spot
  drifting during the session.

## 7.4 Timeline

Session view of one strike: premium, velocity, the greek-decomposition stack
(§3.4), and event markers. Gaps are drawn as gaps.

## 7.5 Historical Comparison

**By moneyness or delta bucket, never by absolute strike number** (§3.6). Header
states the honest window: *"vs the last 13 sessions available — the archive retains
40 and is auto-pruned."*

## 7.6 Evidence · Confidence · Verified · Unknown

Four panels, following the module-page contract in docs/059 §6.4.

**Verified data** — what was measured, over what window, from what source, with
sample counts.

**Unknown data** — each with *why*, and **what would resolve it**:

> **ΔIV per strike — Unknown.** IV arrives live and is not persisted; the stored
> series is premium OHLC only. **Resolves when** the per-strike record is extended
> (§2.1). First usable value: **the next session after that change**.

> **IV Rank — Unknown.** Needs 252 stored sessions. **Resolves ~252 sessions after
> storage begins, and only if the 40-file cap is lifted in the same change.**

> **Trade count — Unknown, permanently from this source.** No such field exists in
> the feed. **Resolves only** with a different data source.

---

# Part 8 — The confidence model

One global confidence number would be dishonest: a strike can have excellent
premium data and no IV data at all. **Confidence is per metric, per strike.**

Inputs, each independently reported:

| Input | Effect |
|---|---|
| `coveragePct` | Samples present ÷ expected |
| `maxGapMinutes` | A 42-minute hole caps confidence regardless of coverage |
| `tickNoiseRatio` | `tickSize / premium` — high ratio caps confidence on all % metrics |
| Liquidity score | Untraded ⇒ confidence 0, not low |
| Provenance | `feed` > `bsm` |
| Sample count | Small *n* widens every interval |
| Window completeness | 13 of 252 sessions is stated as such |

Rendering rule: **confidence is shown next to the value, always**, and a value
whose confidence is below a floor is rendered **struck through but still visible**
— hiding it would make the table look better than the data is.

---

# Part 9 — What this module must never do

The mandate is explicit and I would enforce it structurally, not by discipline.

1. **No BUY, SELL, LONG, SHORT, ENTRY, TARGET, STOP, or directional bias anywhere**
   — not in output, not in a field name, not in a tooltip. There is no `direction`
   field in the schema, so there is nothing to populate.
2. **No forecast tense.** "Explosive Strike" describes what a strike *did*. The
   copy reads "moved 6.2× the chain median in the last 30 minutes", never "is about
   to move".
3. **No ranking presented as a recommendation.** The most active strike is not the
   best strike. The panel says so once, plainly.
4. **No implied causation.** "OI built up and price rose" is two measurements, not
   a mechanism.
5. **No hidden exclusions.** Every filter states what it removed and why.
6. **No interpolation across missing data**, anywhere — table, chart or heatmap.

A checkable test for rule 1: the module's rendered output is scanned for a
vocabulary list, and the build fails on a hit. This repo already fails builds on
structural rules of exactly this kind.

---

# Part 10 — Prerequisites, in dependency order

| # | Step | Severity | Note |
|---|---|---|---|
| 1 | **Extend the stored per-strike record** to include `iv`, `ivSource`, `oi`, `volume`, `bid`, `ask`, `bidQty`, `askQty` and the greeks | **S2, time-critical** | Every session without it is permanently lost history. Unlocks 6 of the 6 missing metrics over time |
| 2 | **Lift the 40-file cap** | **S2, time-critical** | Without it, IV Rank can never be reached — the archive erases itself faster than 252 sessions accumulate |
| 3 | Record `coveragePct` and gaps per session | **S1** | Without it, no metric can be graded |
| 4 | Liquidity gate + `No Data` / `Noise Dominated` classes | **S1** | Prevents the two false rankings measured in §3.1–3.2 |
| 5 | Greek decomposition and the residual | **S1** | Prevents the module from re-deriving moneyness and calling it volatility |
| 6 | Cross-sectional classification | **S2** | Makes classes regime-stable |
| 7 | Ranking, boards, heatmap, timeline | **S3** | The visible part — last, deliberately |
| 8 | Moneyness-keyed historical comparison | **S2** | Only after ≥ 2 usable sessions of extended records |

Steps 1 and 2 are one change and should be made **before** the analytical work,
because they are the only items on this list whose cost increases every day they
are deferred.

---

# Part 11 — What the module will honestly deliver, in three phases

| Phase | Available | Not yet |
|---|---|---|
| **Today** | Premium volatility, velocity, expansion/collapse, range, time at high/low, liquidity, point-in-time IV and OI, classification, ranking, heatmap, timeline — all gated and graded | ΔIV, IV Rank, IV Percentile, Δvolume, ΔOI series, premium rotation, trade count |
| **Next session after storage change** | ΔIV, ΔOI series, Δvolume, vega-decomposition, volume-spike board | IV Rank, IV Percentile |
| **~252 sessions later** | IV Rank, IV Percentile, genuine historical comparison | Trade count — **permanently Unknown from this source** |

---

## Summary

The chain gives more than enough to build a serious volatility measurement module —
**and the archive keeps almost none of it.** Premium OHLC is stored; IV, OI, volume,
depth and the greeks are seen and discarded, and the archive erases itself after 40
sessions.

Three measured facts should govern the build:

1. **70 of 662 strikes never moved today.** Rank by volatility without a liquidity
   gate and the "most stable strikes" board fills with instruments nobody traded.
2. **One tick is 3.7% of a ₹1.35 option.** Rank by percentage without a noise floor
   and the "most explosive strikes" board fills with the price grid.
3. **Premium moves mostly because the index moved.** Rank by raw premium volatility
   and you have re-derived delta, elaborately.

Fix those three and this becomes a genuine research instrument. Skip them and it
becomes a confident, well-presented, ranked list of nothing — which is worse than
no module at all, because it will be believed.

And the metric most likely to be quoted in a meeting — **IV Rank** — is the one
this system cannot honestly produce for about a year. That belongs on the screen,
labelled Unknown, from day one.
