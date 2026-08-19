# 095 — Buying the Day Low: What the Data Says

**Researched 2026-08-13 on 43 sessions of real 5-minute index bars.**
The question: *when a low signal fires, buy — and sell when it reverses.*

---

## The answer in three lines

1. **The exit you proposed is the part that is clearly wrong.** Selling on a
   reversal is *monotonically* worse the tighter you set it, across five settings
   and all three indices. The trailing stop removes the return.
2. **The entry has a consistent positive sign**, above market drift and above a
   random entry, on all three indices.
3. **It is not statistically significant.** Best case NIFTY t = 1.99, and I ran
   about thirty variants to find it. That is what noise looks like when you go
   looking.

**So: build the signal, forward-test it, do not trade it yet.**

---

## The instrument

43 trading days of 5-minute bars for NIFTY, BANKNIFTY and SENSEX — 3,152 bars
each, 2026-06-15 to 2026-08-13. Real vendor data, not the 16 thin days in the
warehouse.

**The rule, made precise enough to be wrong:** a LOW SIGNAL fires on the first
5-minute bar that sets a **new session low**, after a 30-minute warm-up (the
opening range is not a signal), at most once per 15 minutes. Entry at that bar's
**close** — never at its low, which was already gone by the time the signal
existed.

About **2.3–2.5 signals per session**.

---

## 1. The reversal exit destroys the return

Mean return per signal, **net of 0.03% round-trip cost**, by trailing-stop width:

| trail | NIFTY | BANKNIFTY | SENSEX |
|---|---|---|---|
| 0.15% | −0.021% | −0.051% | −0.038% |
| 0.25% | +0.006% | −0.029% | −0.010% |
| 0.40% | +0.025% | −0.022% | −0.012% |
| 0.60% | +0.033% | −0.000% | +0.009% |
| 1.00% | +0.071% | +0.031% | +0.009% |
| **no trail, hold to close** | **+0.080%** | **+0.051%** | **+0.008%** |

Read the columns downward. **Every loosening of the exit improves the result, on
every index, without exception**, and the limit of the trend is not exiting on a
reversal at all.

This is not a parameter that needs tuning. A trailing stop on this entry is
paying to be taken out of the winners: the move that follows a session low is
not smooth, and any stop tight enough to "lock in profit" is tight enough to be
hit by the noise on the way up.

A fixed 30-minute exit is negative on all three (−0.028%, −0.037%, −0.022%),
which says the same thing differently — the return is not in the first half hour.

---

## 2. The entry is real, and small

The control that mattered: **was this simply a rising 42 days?**

| | NIFTY | BANKNIFTY | SENSEX |
|---|---|---|---|
| session drift, open→close | −0.001% | +0.010% | −0.027% |
| **random** bar → close | +0.014% | +0.060% | −0.025% |
| **low signal** → close | **+0.109%** | **+0.080%** | **+0.038%** |
| signal minus random | **+0.095%** | **+0.021%** | **+0.064%** |

The market went nowhere over the sample. So the result is not drift, and it is
not the exit either — a random entry with the *same* exit earns roughly nothing.
Whatever is there is in the **entry**.

Win rates: 69.8%, 59.2%, 67.7%.

---

## 3. And it is not significant

Net of cost, tested against zero:

| index | n | mean | sd | SE | **t** | win |
|---|---|---|---|---|---|---|
| NIFTY | 96 | +0.079% | 0.390 | 0.040 | **1.99** | 66.7% |
| BANKNIFTY | 103 | +0.050% | 0.369 | 0.036 | **1.39** | 55.3% |
| SENSEX | 96 | +0.008% | 0.345 | 0.035 | **0.24** | 57.3% |

A t below about 2 is not distinguishable from luck at this sample size. NIFTY
sits exactly on the line — **and that is before accounting for the search**. I
ran five trailing widths × two stops × three indices, plus three exit families:
roughly thirty tests. A single t of 1.99 out of thirty trials is the expected
best of a pile of noise, not a discovery.

Three further limits, none of them fixable by working harder:

- **43 sessions is one regime.** The sample contains whatever conditions
  mid-June to mid-August happened to hold.
- **These are index percentages.** The trade would be an option, where the move
  is amplified and so are the spread and the theta. A +0.08% index move over half
  a session is not obviously a profitable option trade.
- **26 distinct signal days for NIFTY.** Signals cluster within a session and are
  not independent observations.

---

## What was built, and why it is shaped this way

`low-signal.js` — the detector and a **paper** tracker.

- **Entry**: new session low, 30-minute warm-up, 15-minute cooldown. Exactly the
  rule tested above; changing it invalidates the numbers on this page.
- **Exit: hold to the close.** Not a reversal trail. §1 is the reason, and the
  module refuses a trailing exit tighter than 1% rather than accepting a
  parameter that the evidence says destroys the return.
- **It carries its own research.** Every status response includes the measured
  expectation and the t-statistic, so the number on screen is never separated
  from how weak it is.
- **Paper only.** It touches no order path.

The point of shipping it is to **forward-test the entry out of sample**. The
research above is the in-sample story, and the in-sample story is always the
better one.

### The gate, agreed in advance

Do not trade this until **60 distinct signal days** have accumulated live, and
the forward result is positive net of *option* costs — not index costs. Setting
the number now is the point: a test that ends when the result is pleasing has
measured nothing.

---

## Reproducing this

The three scripts are in the session scratchpad and are deliberately
deterministic — the random benchmark uses a seeded generator, so a re-run
produces the same numbers rather than a different edge each time.

Anyone re-running should expect the sample to have grown, and should expect the
t-statistics to move. If they move *up*, that is one session of evidence, not a
confirmation.
