# 051 — Hero-Zero Detection: Measurement Status and Why No Base Rate Is Published Yet

**Author:** Chief Architect
**Date:** 2026-07-28
**Status:** Blocked on data. Two defects found and one fixed. **No hero-zero number is fit to publish.**
**Severity:** S2 (a shipped number here would have been confidently wrong)

---

## 1. Problem

"Hero-zero" is the retail name for buying a very cheap index option — typically under ₹20,
often on expiry day — where the position either multiplies several times over or decays to
near zero. The owner asked to start hero-zero detection.

Detection is worthless without a base rate. Before a screen can say *"this strike looks like a
hero-zero candidate"*, we must be able to answer: **out of every hundred such candidates, how
many actually paid, and by how much, net of costs?** Without that number the feature is a
lottery-ticket highlighter wearing a quant costume.

This document records what happened when we tried to measure it.

---

## 2. Constraints and Non-Negotiables

| # | Constraint | Source |
|---|---|---|
| C1 | Entry must be knowable at entry time — no look-ahead | Architecture principle; same class of defect as D1 in `backtest-tv/run.js` |
| C2 | `null ≠ 0`. An unmeasured outcome is not a zero outcome | Architecture principle |
| C3 | A published rate must state `n`, the window, and the evidence grade | Chief Architect charter |
| C4 | Correlated observations are not independent samples | Statistics |

---

## 3. Evidence

Evidence grades used throughout: **Verified** (checked against ground truth) /
**Measured** (computed from stored data) / **Estimated** / **Opinion** / **Unknown**.
They are never merged.

### 3.1 Defect A — sessions did not start at the open (**Verified**, now fixed)

The first measurement produced numbers that looked publishable. Before publishing, the input
was checked. Session coverage across every archived day:

| Date | First bar | Last bar | Span | Strikes | Bars |
|---|---|---|---|---|---|
| 2026-07-06 | 14:20 | 15:29 | 69 m | 665 | 34,495 |
| 2026-07-07 | 14:34 | 15:29 | 55 m | 506 | 27,450 |
| **2026-07-08** | **09:15** | **15:29** | **374 m** | **669** | **197,010** |
| 2026-07-09 | 13:36 | 15:29 | 113 m | 712 | 58,975 |
| 2026-07-10 | 15:01 | 15:29 | 28 m | 521 | 14,750 |
| 2026-07-14 | 13:56 | 15:29 | 93 m | 524 | 47,910 |
| 2026-07-15 | 10:16 | 15:29 | 313 m | 679 | 153,913 |
| 2026-07-17 | 12:07 | 15:29 | 202 m | 499 | 98,326 |
| 2026-07-20 | 11:57 | 15:29 | 212 m | 688 | 106,011 |
| 2026-07-21 | 13:40 | 15:19 | 99 m | 689 | 60,200 |
| 2026-07-27 | 15:13 | 15:29 | 16 m | 760 | 12,920 |
| 2026-07-28 | 12:02 | 15:07 | 185 m | 761 | 90,769 |

**One day in twelve begins at 09:15.** The start times are not market events — they are process
start times. `_optMin`, the in-memory minute-bar accumulator in `server.js`, was never seeded at
boot, so each restart began the day over and the persisted day file was rewritten from that
moment forward.

**Consequence.** A "hero-zero base rate" computed on this archive would have read as *"buy at the
open, hold to close"* while actually measuring *"buy at 2pm, hold to close"*. On expiry day the
afternoon is dominated by theta decay, so the measurement would have systematically understated
upside and overstated the zero rate — and it would have looked plausible.

**Fix (shipped, commit `b210d2c`).** `_restoreOptCandles()` seeds `_optMin` from the persisted day
file before the persist interval is scheduled. It refuses a file whose `date` is not today, skips
non-finite bars rather than coercing them to zero, and reports a torn file rather than swallowing
it. Verified live: a mid-session restart restored 86,780 bars across 761 strikes; the day file kept
its 12:02 start and continued to 15:02 instead of restarting at 15:00. Test:
`test/opt-candle-restore.test.js`, proven RED against the pre-fix source.

### 3.2 Defect B — the one good day is one event, not a sample (**Measured**)

2026-07-08 is the only day with a genuine 09:15 open. Measured on it: entry = the option's open
price in the 09:15–09:30 window (chosen before any later bar is read, satisfying C1), cheap =
entry ≤ ₹20, outcome = last close of the session.

n = 147 qualifying strikes.

| Held to close | Rate |
|---|---|
| ≥ 2× | 67.3% |
| ≥ 3× | 33.3% |
| ≥ 5× | 13.6% |
| median | 2.67× |
| finished below entry | 23.8% |
| ≤ 0.2× (near-zero) | 0.0% |

A 67% doubling rate is not a plausible base rate for lottery-profile instruments. Decomposing by
instrument and side:

| Group | n | ≥ 2× | median |
|---|---|---|---|
| NIFTY PE | 48 | **100%** | 3.90× |
| BANKNIFTY PE | 53 | **94%** | 2.93× |
| SENSEX PE | 1 | 100% | 36.08× |
| NIFTY CE | 32 | **0%** | 0.91× |
| BANKNIFTY CE | 13 | **0%** | 0.93× |

Near-perfect separation by side. Every put paid; no call did. 2026-07-08 was a single large down
day, and all 147 observations are the same directional event seen through 147 correlated
contracts on three indices that themselves move together.

**Effective sample size is approximately one, not 147.** Under C4 this cannot be a base rate. It
would be a sampling error of exactly the kind that produced the earlier
`project_nifty_directional_no_edge` finding, where a favourable first-100 window turned out to be
noise across 1,200 trades.

---

## 4. Options Considered

| Option | Argument for | Argument against | Verdict |
|---|---|---|---|
| **A. Ship the 67% figure** | Data exists today; the feature lands this week | It is one day's direction. A user sizing against it would be sized against a coin that already landed | **Rejected** — violates C3 and C4 |
| **B. Ship detection with no base rate** | Fast; "informational only" disclaimer | An unlabelled highlight *is* a recommendation. This is precisely the dishonesty the product positions against (`project_competitive_research`) | **Rejected** |
| **C. Backfill from an external historical source** | Instant sample size | No verified intraday option-minute source is wired; provenance unknown; the warehouse's WORM guarantee would be diluted by data we cannot reproduce | **Deferred**, not rejected — revisit if a source can be provenance-verified |
| **D. Fix capture, accumulate real full sessions, measure, then ship** | Only path to a number that survives scrutiny; the fix is small and already benefits every other open-relative study | Costs calendar time — roughly 20–30 sessions before any rate is worth quoting | **Adopted** |

---

## 5. Decision

Adopt **D**. Defect A is fixed and shipped. No hero-zero rate, badge, or screen ships until a
base rate exists that satisfies C3 and C4.

The gate for publishing a first number:

1. ≥ 20 sessions where the first bar is at or before 09:20 — **currently 1**.
2. Statistics reported **per side and per instrument**, never pooled, so a directional day cannot
   masquerade as a base rate.
3. A day-level view alongside the strike-level view, because the day is the independent unit.
4. Net of costs — brokerage, STT on the premium, exchange charges, and a realistic spread on a
   sub-₹20 option, where the spread alone is often 5–10% of the premium.
5. The base rate is the **first** number on the screen, not a footnote.

Until then the honest statement is: **Unknown.**

---

## 6. Institutional Recommendation

The recurring pattern across this codebase is not bad maths — it is measuring the wrong thing
convincingly. D1 in `backtest-tv/run.js` produced 797 signals from a direction that was not
knowable at entry. This one produced a 67% doubling rate from an archive that mostly began after
lunch. Both were arithmetically correct and both were meaningless.

**Recommendation:** any study that is relative to a market moment (the open, expiry, an event) must
declare that moment's data coverage *before* results are computed, and refuse to produce a number
when coverage is absent. A `coverage()` precondition belongs in the warehouse read path, so the
data layer — not the analyst's discipline — is what stops the wrong number from being produced.

---

## 7. Status

| Item | State |
|---|---|
| Defect A — restart erased the morning | **Fixed**, `b210d2c`, verified live, tested |
| Defect B — one-event sample | **Documented**, blocks publication |
| Full sessions accumulated | 1 of 20 |
| Hero-zero base rate | **Unknown** |
| Hero-zero UI | Not started, correctly |
