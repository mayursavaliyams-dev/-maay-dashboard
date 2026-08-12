# 061 — Strike Lifecycle Analysis Engine

**ANTIGRAVITY PRO · Chief Quantitative Market Structure Research Scientist**
**Date:** 2026-07-29 · **Status:** DESIGN ONLY — no production code written
**Mandate:** track how a strike is born, grows, peaks, weakens and dies.
**No BUY or SELL output. Unknown remains Unknown.**

Companion to docs/060 (Strike Volatility Analysis). The hazards established there
— tick quantisation, stale ≠ stable, greek decomposition, IV provenance — apply
here unchanged and are not repeated. This document covers what is **new** about
the lifecycle question.

---

## 0. Grades and severity

| Grade | Meaning |
|---|---|
| **Verified** | Observed directly on this system and reproduced |
| **Measured** | Counted from this repo's own data, today |
| **Estimated** | Reasoned from partial evidence |
| **Opinion** | Judgement, reversible |
| **Unknown** | Not established — and left that way |

| Class | Meaning |
|---|---|
| **S1** | Would make the engine confidently wrong, or blocks it entirely |
| **S2** | Structural; cost compounds daily |
| **S3** | Quality |
| **S4** | Deferred by decision, reason recorded |

---

# Part 1 — The blocking finding, measured today

A lifecycle engine's entire premise is **birth → death**. Birth happens at the
open. So the first question is not "how should we model it" but "do we observe
the open at all".

I checked every archived session. **Grade: Measured.**

| Date | First sample | Last | Samples | Session coverage |
|---|---|---|---|---|
| 2026-07-06 | 14:20 | 15:29 | 70 | **lost 305 min at open** |
| 2026-07-07 | 14:34 | 15:29 | 56 | **lost 319 min** |
| **2026-07-08** | **09:15** | 15:29 | **375** | **FULL** |
| 2026-07-09 | 13:36 | 15:29 | 114 | lost 261 min |
| 2026-07-10 | 15:01 | 15:29 | 29 | **lost 346 min** |
| 2026-07-14 | 13:56 | 15:29 | 94 | lost 281 min |
| 2026-07-15 | 10:16 | 15:29 | 314 | lost 61 min |
| 2026-07-17 | 12:07 | 15:29 | 203 | lost 172 min |
| 2026-07-20 | 11:57 | 15:29 | 213 | lost 162 min |
| 2026-07-21 | 13:40 | 15:19 | 100 | lost 265 min |
| 2026-07-27 | 15:13 | 15:29 | 17 | **lost 358 min** |
| 2026-07-28 | 12:02 | 15:29 | 204 | lost 167 min |
| 2026-07-29 | 11:45 | 15:29 | 177 | lost 150 min |

**12 of 13 archived sessions are missing the market open.** One session — 2026-07-08
— is complete. Every file ends correctly at 15:29; only the beginning is absent.

## 1.1 The cause, established rather than assumed

The obvious hypothesis is the restart-erases-the-morning defect. **That is not what
this is.** Evidence:

- The restore fix (`_restoreOptCandles`, commit `b210d2c`) landed **2026-07-28**.
  **Grade: Verified** — from the commit log.
- Today is **2026-07-29**, the day *after*. The morning is still missing.
- Today's collector processes started at **11:50**; the first stored sample is
  **11:45**. **Grade: Verified.**

`_restoreOptCandles` restores bars already on disk *for today*. If nothing was
collecting between 09:15 and 11:45, there are no bars to restore. **The collector
was not running.** The fix addresses restarts *within* a session; it cannot
reconstruct a period when nothing was observing.

> **This is an operational finding, not a code defect.** It is also the single
> largest obstacle to this engine: **birth is unobservable in 92% of the archive.**
> **Severity: S1.**

## 1.2 Three further structural facts

**a. The chain is a moving window, not the listed universe.**
NIFTY on 2026-07-29: **93 distinct strikes, 21600 → 26200, step 50**, with spot near
24250 — roughly ±10% around the money. The exchange lists far more. **Grade: Measured.**

**b. No intraday entry or exit is recorded.**
All 165 NIFTY series in that file carry **exactly 157 samples**, and every one spans
the whole recorded session. The archive writes every strike at every tick of the
sampler. **Grade: Measured.** Whatever appearing-and-disappearing happens in the
live window, the stored file cannot show it.

**c. The stored record is premium OHLC only** — no IV, no OI, no volume, no greeks
(docs/060 §1.2). Every growth, peak and decline metric in the brief that is defined
on OI, volume or IV is therefore **not computable from the archive today**.

---

# Part 2 — What "birth" and "death" can actually mean

This is the definitional core, and getting it wrong produces an engine that
measures itself.

## 2.1 Four candidate definitions of birth

| # | Definition | Observable? | What it actually is |
|---|---|---|---|
| **B1** | Exchange lists the contract | ❌ Not in this data | The true birth. A calendar event |
| **B2** | Strike first appears in our chain window | ⚠️ Live only | **A property of our window, not the market** |
| **B3** | First non-zero OI | ⚠️ Live only, not stored | First position taken — economically meaningful |
| **B4** | First trade / first non-zero volume | ⚠️ Live only, not stored | First transaction — the strongest claim |

**The trap: a naive implementation measures B2 and calls it birth.** But B2 fires
when *spot moves toward the strike*, not when the strike comes alive. A rally makes
fifty strikes "born" simultaneously — which is a fact about the index, re-badged as
fifty lifecycle events.

This is the same class of error as docs/060 §3.4, where ranking by premium
volatility silently re-derives delta. Here, ranking by B2-birth silently re-derives
the index path.

**Design rule:** B2 is recorded under its honest name — `windowEntry` — and is
**never** presented as birth. Birth is B3 or B4, both of which require the storage
change in §7.

**Severity: S1.**

## 2.2 Death is even less symmetric

| # | Definition | Observable? | Note |
|---|---|---|---|
| **D1** | Expiry | ✅ Known from the registry | **Every strike dies here, by calendar** |
| **D2** | Last trade before a sustained silence | ⚠️ Needs volume series | Absence must outlast the sampling gap (§4) |
| **D3** | OI → 0 | ⚠️ Needs OI series | Position fully unwound |
| **D4** | Strike leaves the window | ⚠️ Live only | **Observer artefact again** — `windowExit`, not death |

**D1 dominates everything.** Every weekly strike dies on a known date. An engine
that reports "life duration" without controlling for this is reporting the expiry
calendar with extra steps (§3).

## 2.3 The honest statement of what is measurable today

| Lifecycle field in the brief | Status today |
|---|---|
| Birth Time | ❌ **Unknown** — B2 is an artefact; B3/B4 not stored; and the open is missing on 12/13 days |
| First Trade | ❌ Not stored (volume series absent) |
| First OI | ❌ Not stored |
| First Volume | ❌ Not stored |
| Premium Start | ⚠️ Only from the first *observed* sample — which is 11:45, not 09:15, on most days |
| Liquidity Start | ❌ Not stored (bid/ask/qty absent) |
| Activity Start | ❌ Not stored |

**Seven of seven birth-phase fields are Unknown or degraded today.** Not one of them
is a modelling problem; all seven are a collection problem.

---

# Part 3 — The expiry-baseline trap

## 3.1 The problem

Option strikes do not have organic lifespans. They have **contractual** ones. OI
builds through the cycle, volume concentrates near expiry, premium decays as a
function of time-to-expiry, IV behaves systematically into the event.

So if you plot "activity over life" for 500 strikes and average them, you will
recover, with high confidence, **the shape of the expiry calendar**. It will look
like a discovery. It is a tautology.

**Severity: S1.**

## 3.2 The fix — analyse in expiry-relative time, against a cohort

Two changes make every lifecycle statement non-trivial:

1. **The x-axis is T-minus**, not wall clock. Every curve is expressed in
   time-to-expiry (days, then minutes on expiry day itself).
2. **Every strike is compared to its cohort**, where a cohort is
   `{instrument × moneyness bucket × time-to-expiry × expiry type}`.

The output then becomes the *deviation from cohort baseline*:

> "This strike's OI grew 3.4× the median for 2%-OTM calls at T-2 in this instrument."

That is a finding. "This strike's OI grew" is a calendar.

## 3.3 Moneyness, not strike number

Restating docs/060 §3.6 because it is load-bearing here: spot moves, so a strike's
moneyness changes continuously. Tracking a lifecycle by strike number across days
tracks an instrument whose economic identity changes underneath it.

**Every lifecycle record carries moneyness at each sample**, and cross-day analysis
keys on moneyness bucket. Strike number is an identifier, never an axis.

---

# Part 4 — Sampling limits on lifecycle events

Measured cadence (docs/060 §1.2): nominal 60 s, **mean 86.2 s, largest gap 2,520 s
(42 minutes)**.

| Consequence | Requirement |
|---|---|
| **Birth timestamp has an uncertainty equal to the gap** | Every event carries `timestampUncertaintySec`. A birth "at 11:46" that could be anywhere in the preceding 42 minutes is not a timestamp — it is an interval, and must be rendered as one |
| **Death requires proving absence** | Absence in our sample ≠ absence in the market. Death needs silence lasting ≥ *max(3 × median gap, 15 min)*, and must be marked provisional until confirmed |
| **Revival is contaminated by gaps** | A strike that traded during a 42-minute hole reads as *died then revived*. Without a dwell threshold, `Recovery Count` measures our sampler, not the market |
| **Phase transitions flap** | State changes require confirmation over ≥ *n* consecutive samples plus hysteresis (§5.2) |
| **Nyquist** | Anything with a period under ~3 minutes is invisible. A strike is never described as "sleeping" when it may only be **unsampled** |

## 4.1 The cumulative-volume trap

`volume` in the feed is **cumulative for the session**, and therefore monotonically
non-decreasing. Plot it raw and **every strike appears to be in a growth phase all
day, right up to the close.**

Growth must be measured on the **differenced** series (volume per interval,
normalised per minute), never on the cumulative one. **Severity: S1** — this is the
single easiest way to produce a lifecycle engine in which nothing ever declines.

The same applies to any "Market Attention" metric built on cumulative counters.

---

# Part 5 — The phase model

## 5.1 States

| State | Meaning |
|---|---|
| `UNLISTED` | Before the contract exists |
| `LISTED_INACTIVE` | Exists, no OI, no trades |
| `ACTIVATING` | First OI or first trades appear |
| `GROWING` | Sustained increase in differenced activity vs cohort |
| `PEAK` | At or near its own maximum, sustained |
| `DECLINING` | Sustained decrease |
| `DORMANT` | Alive, negligible activity |
| `DEAD` | Sustained silence, or expired |
| **`UNOBSERVED`** | **We were not collecting** |

**`UNOBSERVED` is a first-class state, not a gap.** It is the correct state for
09:15–11:45 on 12 of 13 archived sessions, and it must be visually distinct from
`DORMANT` — the difference between "the strike was quiet" and "we were not looking"
is the difference between a measurement and a guess.

**Severity: S1.**

## 5.2 Transition discipline

- **Hysteresis.** Entering `GROWING` and leaving it use different thresholds.
  Without this, a strike oscillating at the boundary generates dozens of phantom
  lifecycle events per session.
- **Dwell time.** A state must persist ≥ *n* samples before it is recorded.
- **Provisional vs confirmed.** Live states are provisional; end-of-session
  reconciliation confirms them. Any state assigned across a gap is marked
  `low-confidence` regardless of dwell.
- **No skipping.** `ACTIVATING → DEAD` without an intervening state is a data
  artefact and is flagged as one, not recorded as a dramatic life.

---

# Part 6 — The nine events

Each carries: timestamp, **uncertainty interval**, evidence, confidence, and the
cohort-relative magnitude.

| Event | Definition | Observability today |
|---|---|---|
| **Birth** | First OI or first trade (B3/B4) | ❌ Needs storage change **and** morning coverage |
| **Activation** | Activity crosses a cohort-relative floor with dwell | ❌ Needs volume/OI series |
| **Expansion** | Differenced activity rising ≥ *k* samples, above cohort median | ⚠️ Premium-only proxy today |
| **Explosion** | Extreme cohort-relative excursion, above the noise floor (docs/060 §3.1) | ⚠️ Premium-only proxy |
| **Climax** | The session/cycle maximum | ⚠️ **Retrospective only** — see below |
| **Exhaustion** | Activity falls from peak while premium does not recover | ❌ Needs volume + OI |
| **Decay** | Sustained decline vs cohort | ⚠️ Premium-only proxy |
| **Revival** | Return above the activation floor after ≥ dwell in `DORMANT`/`DEAD` | ❌ Needs volume series |
| **Death** | Sustained silence ≥ threshold, or expiry | ⚠️ Expiry is known; silence needs volume |

## 6.1 Climax and Exhaustion are retrospective, and this is non-negotiable

A maximum is only knowable **after** it has been exceeded-and-not-exceeded. Any
live "Climax" label is a claim that the peak is in — which is a **forecast**, and
this engine does not forecast.

**Rule:** `Climax` and `Exhaustion` are emitted only with a confirmation lag, and
are rendered as *"peak so far, confirmed at T+n"* — never as a live badge. Without
this rule, the engine is a top-caller wearing a measurement badge.

**Severity: S1** — this is the most likely route by which a prediction re-enters a
system that was told not to predict.

---

# Part 7 — Institutional vs Retail: a refusal, and what to build instead

The brief asks for `Institutional Strike` and `Retail Strike` classes. **I will not
design them, because they are not measurable from any data this system has or can
get.** **Grade: Unknown, with a stated resolution path.**

## 7.1 Why not

- The feed carries **no client-type field**. Verified against a live snapshot: the
  per-strike object holds price, OI, volume, depth, IV and greeks. Nothing about
  who traded. **Grade: Verified.**
- NSE's participant-wise data (FII / DII / Pro / Client) is published **at
  instrument level, end-of-day** — not per strike, not intraday.
- Every popular heuristic — round strikes are retail, large lots are institutional,
  far-OTM is retail — is **folklore with no validation available in this system**.
  A single institution hedging in 1-lot clips, or a retail trader buying 50 lots,
  breaks each of them.

Publishing a strike as "Institutional" on that basis is inventing missing
information, which the mandate forbids in its own words.

## 7.2 What to build instead — behaviour, not identity

Two descriptive metrics that *are* measurable and are honestly named:

| Metric | Definition | What it says | What it does **not** say |
|---|---|---|---|
| **Position-vs-Turnover ratio** | ΔOI ÷ volume over the interval | Whether flow is being *held* or *turned over* intraday | Nothing about who is doing it |
| **Depth concentration** | Quoted size (`bidQty`+`askQty`) relative to the cohort | How much size stands at this strike | Nothing about who posted it |

Classes become `POSITION_HELD` and `TURNOVER_DOMINATED`, with a one-line note on
the panel: *"describes flow behaviour, not participant type — participant identity
is not available from this data."*

**Resolution path, recorded honestly:** true participant classification requires
exchange participant-wise data per strike, or order-level data. Neither is
available to this system. **Status: Unknown, indefinitely.**

---

# Part 8 — Measures, and their statistical treatment

## 8.1 Censoring — the point most lifecycle analyses get wrong

Naive lifecycle statistics on this archive are **biased**, for two independent
reasons:

- **Left-censoring.** On 12 of 13 sessions, observation begins mid-day. Every
  strike already alive at that moment has an unknown true start. Computing "life
  duration" from first-observation understates it, systematically.
- **Right-censoring.** The archive auto-deletes past 40 files (docs/060), and
  strikes alive at session end have not finished. Their durations are lower bounds.

**Requirement: use survival analysis — Kaplan–Meier with explicit censoring flags —
not means of observed durations.** Every duration statistic reports:
`n_complete`, `n_left_censored`, `n_right_censored`.

On today's archive that would read: *n_complete = 1 session's worth; left-censored =
12 sessions.* Which is exactly the honest picture, and exactly what a mean would hide.

**Severity: S1.**

## 8.2 The seven measures

| Measure | Definition | Status |
|---|---|---|
| **Life Duration** | Birth → death, in **expiry-relative** time | ❌ Blocked (birth unobservable) |
| **Growth Speed** | Slope of differenced activity, normalised per minute and by cohort | ⚠️ Premium proxy only |
| **Decay Speed** | Same, negative side; **theta-adjusted** — premium decay is partly contractual, not weakness | ⚠️ Proxy |
| **Peak Duration** | Time within *x*% of the strike's own maximum, dwell-confirmed | ✅ Computable on premium |
| **Recovery Count** | Dormant → active transitions meeting dwell | ❌ Needs volume series |
| **Revival Success** | **Redefined:** revival sustained ≥ *m* minutes above the activation floor. **Not** a P&L or directional outcome | ❌ Needs volume |
| **Failure Count** | Activations that failed the dwell test | ❌ Needs volume |

**Note on "Revival Success".** As phrased in the brief, "success" invites a
profit-or-direction reading. Redefined above as *persistence of activity*, it stays
inside the mandate. If it cannot be defined without an outcome, it does not belong
in a measurement engine.

## 8.3 Decay must be theta-adjusted

An option losing premium daily is not weakening — it is **expiring**. `theta` is
available live. Decay speed must be reported as *decay in excess of theta*, or it
will rank every short-dated option as "fastest dying" every single day.

Same family of error as docs/060 §3.4. **Severity: S1.**

---

# Part 9 — Classification

Eight classes were requested. My mapping, with two renamed and two refused:

| Requested | Design decision |
|---|---|
| Strong Strike | ✅ **Sustained-Activity High** — cohort percentile of dwell-weighted activity |
| Weak Strike | ✅ **Sustained-Activity Low** — eligible strikes only |
| **Institutional Strike** | ❌ **Refused** → `POSITION_HELD` (§7) |
| **Retail Strike** | ❌ **Refused** → `TURNOVER_DOMINATED` (§7) |
| Fast Strike | ✅ Growth-speed percentile, cohort-relative |
| Slow Strike | ✅ Same, low end |
| Explosive Strike | ✅ Past tense, noise-floor gated (docs/060 §5.2) |
| Dead Strike | ✅ Only with confirmed silence — **never** from `No Data` or `UNOBSERVED` |

Plus the classes the data forces, carried over and extended from docs/060:

| Class | Why mandatory |
|---|---|
| **No Data** | 70 of 662 series never moved on 2026-07-29 — untraded, not stable |
| **Noise Dominated** | One tick is 3.7% of a ₹1.35 option |
| **Unobserved** | 12 of 13 sessions have no morning |

All thresholds are **cross-sectional percentiles within the cohort**, never fixed
constants — a fixed threshold turns the classifier into an expiry detector.

---

# Part 10 — Visualisation

| View | Design | Non-negotiable rule |
|---|---|---|
| **Lifecycle Timeline** | Swimlane per strike; phases as coloured segments | `UNOBSERVED` is a distinct hatched band — never blank, never interpolated |
| **Activity Curve** | Differenced activity per minute | **Never the cumulative series** (§4.1) |
| **Premium Curve** | Premium with theta-expected decay overlaid | The gap between actual and theta-expected is the signal |
| **OI Curve** | ΔOI per interval | Intraday marked Estimated; EOD marked Measured |
| **IV Curve** | `feed` rows only | `bsm` rows drawn in grey, excluded from statistics |
| **Volume Curve** | Per-interval, not cumulative | |
| **Heatmap** | Strike (by moneyness) × expiry-relative time | Grey = no observation. **No interpolation, ever** |
| **Historical Comparison** | Cohort baseline ± band, with the strike overlaid | Header states `n` sessions and how many were left-censored |

Two global rules: **gaps are drawn as gaps**, and **every chart states its
observation coverage** as a percentage in the corner. A 40%-covered day and a
98%-covered day must not look alike.

---

# Part 11 — Outputs

Every board carries: metric, unit, window, cohort definition, eligible-set size,
excluded counts with reasons, and per-row confidence.

| Output | Status today | Blocker |
|---|---|---|
| Top Active Strikes | ⚠️ Premium/liquidity proxy | Volume series |
| Top Growing Strikes | ⚠️ Proxy | Differenced volume + OI |
| Top Dying Strikes | ⚠️ Proxy, theta-adjusted | Volume series |
| **Longest Living Strike** | ❌ **Blocked** | Birth unobservable; censoring (§8.1) |
| Fastest Growing Strike | ⚠️ Proxy | |
| Fastest Dying Strike | ⚠️ Proxy | |
| **Highest Revival Strike** | ❌ **Blocked** | Needs volume series + morning coverage |
| Evidence / Confidence / Verified / Unknown | ✅ **Fully deliverable now** | — |

> Note the shape of that table. The four panels the mandate cares most about —
> Evidence, Confidence, Verified, Unknown — are the ones that can be delivered
> completely today. That is not a consolation. **On this data, the honest
> accounting is the deliverable**, and the rankings are the part still waiting on
> collection.

---

# Part 12 — What this engine must never do

Carried from docs/060 §9 and extended for lifecycle:

1. **No BUY, SELL, direction, target or stop** — no such field exists in the schema.
2. **No live Climax or Exhaustion** (§6.1). A live peak call is a forecast.
3. **"Strong Strike" is not a recommendation.** It is a cohort percentile of past
   activity, and the panel says so.
4. **"Revival Success" is persistence, never profit** (§8.2).
5. **No participant-type claims** (§7).
6. **No interpolation across `UNOBSERVED`.**
7. **No lifecycle statistic without its censoring counts** (§8.1).
8. **`windowEntry` is never called birth; `windowExit` is never called death** (§2).

Rules 1, 2 and 8 are checkable: scan rendered output and the schema for a
vocabulary list and fail the build on a hit — the pattern this repo already uses
for structural rules.

---

# Part 13 — Prerequisites, in strict dependency order

| # | Step | Severity | Why here |
|---|---|---|---|
| **1** | **Collector runs from 09:15 every session** | **S1, operational** | **12 of 13 sessions have no morning. Every other item on this list is worthless until this is true — birth happens at the open** |
| 2 | Alert when a session's coverage < 95% | **S1** | Without it, item 1 silently regresses and nobody knows for weeks |
| 3 | Extend the stored per-strike record: `iv, ivSource, oi, volume, bid, ask, bidQty, askQty, greeks` (docs/060 §2.1) | **S2, time-critical** | Unlocks birth, activation, revival, death, and every OI/volume measure |
| 4 | Lift the 40-file cap | **S2, time-critical** | Right-censoring is otherwise permanent |
| 5 | Record per-sample presence, `windowEntry`, `windowExit` separately from lifecycle events | **S1** | Keeps the observer artefact out of the market measurement (§2.1) |
| 6 | Expiry-relative time axis + cohort baselines | **S1** | Otherwise the engine re-derives the expiry calendar (§3) |
| 7 | Differenced activity series | **S1** | Otherwise nothing ever declines (§4.1) |
| 8 | Phase state machine with dwell + hysteresis + `UNOBSERVED` | **S1** | |
| 9 | Survival analysis with censoring flags | **S1** | |
| 10 | Event detection with uncertainty intervals | **S2** | |
| 11 | Curves, timeline, heatmap, boards | **S3** | Last, deliberately |

Steps 1 and 2 are operational and cost almost nothing. **They are worth more than
every analytical item below them combined**, because they are the only ones that
determine whether the data to do any of this will exist next month.

---

# Part 14 — Honest delivery phases

| Phase | Deliverable | Still Unknown |
|---|---|---|
| **Today** | Premium-based activity proxies, peak duration, phase segmentation with `UNOBSERVED`, cohort framework, and the complete Evidence / Confidence / Verified / Unknown accounting | Birth, first trade, first OI, revival, death-by-silence, all OI/volume/IV measures |
| **After steps 1–4** *(next session)* | True activation, revival, death, OI and volume growth, theta-adjusted decay, position-vs-turnover | Long-horizon lifecycle statistics |
| **After ~40+ clean sessions** | Cohort baselines with real confidence bands, survival curves, historical comparison | Participant identity — **permanently Unknown from this source** |

---

## Summary

The lifecycle question is a good one, and this system is close to being able to
answer it. Three measured facts decide the order of work:

1. **12 of 13 archived sessions are missing the market open** — 61 to 358 minutes
   each, only 2026-07-08 complete. The cause is not the restart defect, which was
   fixed on 2026-07-28; the collector simply was not running. **Birth happens at the
   open, so birth is currently unobservable.**
2. **The archive stores premium OHLC only.** Every OI, volume and IV lifecycle
   measure — which is most of them — is not computable, and the data that would
   make them computable arrives live and is discarded every day.
3. **A strike's life is a contract, not an organism.** Without expiry-relative time
   and cohort baselines, every curve this engine draws will be the expiry calendar,
   and it will look like a discovery.

Two things I decline to build: a **participant classification** that no available
data supports, and a **live Climax label**, which is a forecast in a measurement
engine's clothing. Both are replaced with something measurable and honestly named.

Fix the collector schedule first. It is the cheapest item on the list and the only
one that decides whether anything else here can ever be true.
