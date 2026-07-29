# ANTIGRAVITY PRO — Strategy Guide

**How many strategies run in this system, what each one actually does, and what the
evidence says about it.**

Version 2026-07-29 · every engine is **PAPER**. No real order has ever been placed.

---

## The short answer

**Nine strategies.** Four sell premium, four buy options, one is a news-driven equity
pipeline.

| # | Strategy | Side | Runs live? | Evidence |
|---|---|---|---|---|
| 1 | Short Strangle / Iron Condor | **Sell** | **Yes** (paper) | **Strong** — 91% win over 600 days |
| 2 | Short Straddle | Sell | Backtest only | Strong — 86% win |
| 3 | Expiry Straddle | Sell | Backtest only | Strong but **suspicious** — see §2.3 |
| 4 | PoP Seller | Sell | Screen only | Model-based, not backtested |
| 5 | Gamma-Blast | Buy | **Yes** (paper) | **Rationale only** — no backtest possible |
| 6 | Trend-Ride | Buy | **Yes** (paper) | Underlying edge proven, **option leg unknown** |
| 7 | Bounce | Buy | Paper | **One day of data** — experimental |
| 8 | ORB / Afternoon execution | Buy | Paper | **Negative** — PF 0.94 |
| 9 | AI Agents (news → equity) | Either | **Yes** (paper) | Disclosed heuristic, unproven |

The rest of this document explains each one.

---

# Part 1 — The two families

Everything here is one of two bets.

**Selling premium** is a bet that the market will move **less** than the option price
implies. You collect money up front and keep it if nothing dramatic happens. You win
often and lose rarely, but a loss can be many times a win. Time is on your side —
every day that passes, the option you sold is worth less.

**Buying options** is the reverse. You pay up front and need a move big enough and fast
enough to beat the decay. You lose often and win rarely, and you need the rare win to
be very large. Time is against you.

In this system's own measurements, **selling works and buying mostly does not.** That
is not an opinion — §2 and §3 give the numbers.

---

# Part 2 — Selling premium (4 strategies)

## 2.1 Short Strangle → Iron Condor — *the main engine*

**File:** `strangle-engine.js` · **Runs:** yes, paper · **Page:** 🎚️ Strangle

**What it does.** Sells a call above the market and a put below it — both about
**1.5% out of the money** — and keeps the premium if the index stays between them.

**The regime ladder.** This is the important part. It does not always trade:

| Implied volatility percentile | Action |
|---|---|
| Below 50th | **SKIP** — premium is too thin to be worth the risk |
| 50th to 80th | Sell a **strangle** |
| Above 80th | Sell an **iron condor** — buy wings so the loss is capped |

Selling only when premium is rich is what separates this from selling blindly. The
condor above the 80th percentile exists because that is exactly when a violent move is
most likely, and a naked short strangle has **unbounded** loss.

**Managing the trade.** Take profit at **50%** of the credit. Stop when a leg reaches
**2×** what it was sold for. Both legs are closed together.

**Sizing.** Margin-aware fractional Kelly, scaled by volatility — not a fixed lot count.

**Evidence — 600 days of real NSE bhavcopy, ₹1 lakh:**

| | |
|---|---|
| Trades | 129 |
| Win rate | **91%** |
| Net | ₹4.41 lakh |
| Max drawdown | **5.9%** |
| CAGR | 103% |

**This is the strongest evidence in the system**, and this is the engine accumulating
a forward-test record.

## 2.2 Short Straddle

**Backtest only.** Sells the call *and* the put **at the same strike** — the at-the-money
one. Collects more premium than a strangle because at-the-money options are the most
expensive, and needs the index to sit almost exactly still.

**Evidence:** 129 trades, **86% win**, ₹4.94 lakh net, 6.9% max drawdown.

Higher return than the strangle, wider drawdown. That trade-off is the whole difference.

## 2.3 Expiry Straddle

**Backtest only.** Sells the at-the-money straddle **on expiry day**, when time decay
is at its most violent.

**Evidence:** 127 trades, **90% win**, ₹62.1 lakh net, 4.9% max drawdown, **470% CAGR**.

> **Treat this number with suspicion.** A 470% CAGR from 127 trades is the kind of
> result that usually means the test is easier than reality. Expiry day is exactly when
> fills are worst, spreads are widest and gaps are most violent, and none of that is
> fully modelled. It has not been forward-tested. **Do not plan around it.**

## 2.4 PoP Seller

**File:** `pop-seller.js` · **Screen only** — it does not trade · **Page:** 🎲 PoP Seller

Ranks every strike by the probability of expiring worthless, so you can see which
options are the "safest" to sell. It uses the broker-verified lot, tick and expiry from
the instrument registry.

**Not backtested.** It is a calculator, not a strategy — it tells you the model's
probability, not whether selling at that probability makes money after costs.

> Probability of expiring out-of-the-money is **not** probability of profit. A 90%
> option that loses 10× when it fails is not a good bet at any price.

---

# Part 3 — Buying options (4 strategies)

Read §3.0 before any of them.

## 3.0 Why buying is hard here — three tests, and they disagree

| Test | What it does | Result |
|---|---|---|
| **GAP_BUY** (600 days) | Gap-and-go, deep-OTM, buy at open | **2% win rate**, ₹15,007 net, **33.3% max drawdown** for a 6% CAGR |
| **`bt-real`** (same idea, risk-scaled sizing) | 5% risk per trade, compounding | 470 trades, 6.8% win, **profit factor 2.04** |
| **Intraday multi-confirm** | 1,200 trades, 197 days | **PF 0.94** (NIFTY), **0.89** (SENSEX), **0.97** (BANKNIFTY) — all net losers |

Read together this is a **lottery profile**: two of three lose money, and the one that
does not wins about 7 times in 100 while giving back a third of the account.

**So why are there buying engines at all?** Because two of them are attempts to find
the *specific* conditions under which buying is not a lottery — and both say plainly
what they have not yet proven.

## 3.1 Gamma-Blast — *the one buying strategy with a real rationale*

**File:** `gamma-blast-engine.js` · **Runs:** yes, paper · **Panel:** Command → Signals

**The reasoning.** Plain directional buying fails because theta bleeds you. On expiry
day, in the afternoon, **theta is already spent** — there is almost no time value left
to lose. What remains is gamma, which at that point is enormous: a small index move
makes the at-the-money premium explode, often +100% to +300% in minutes.

So the bet is not "the market will go up". It is "**when the market moves at all, at
this specific hour, the payoff is asymmetric**".

**Entry.** Only when *all* of these hold:
- it is an **expiry day**
- inside the **afternoon window**
- the live detector fires on **premium velocity plus a directional trigger**

Then it buys the **at-the-money option of the breakout side only** — CE on an up-move,
PE on a down-move — at the live price.

**Exit.** Take profit at +60%. Stop at −35%. Once the trade is +50% up, a trailing exit
gives back at most 35% of the gain. Hard square-off before the close. It also exits if
the detector's window closes — the reason for the trade having gone, the trade goes.

**Evidence: none, and it cannot have any yet.** This depends on intraday premium
velocity at minute resolution on expiry afternoons. That data has only been collected
since this system started recording it. **It is a forward test, not a backtest.**

## 3.2 Trend-Ride — *an honest open question*

**File:** `trend-ride-engine.js` · **Runs:** yes, paper

**The idea.** After the index breaks out of a coiled range by a threshold number of
points, buy the option on the trend side whose premium is around ₹15, and ride it.

**What testing did to that idea:**

- The raw idea with a **trailing exit is a net loser** — 1,816 real events, **PF 0.84**.
- The version that survives **out-of-sample** testing (train on 70%, test on 30%) is an
  **asymmetric fixed bracket on the underlying**: a big target, a tight stop.
  NIFTY +60 / −30 → test **PF 1.34**. BANKNIFTY +130 / −80 → **PF 1.14**.

**The catch, stated in the engine's own header.** Those are **gross index points**. A
₹15 option leg captures only about **0.4–0.5×** of an index move and pays theta and
spread on top. **Whether the option version is still profitable after costs is
Unknown.**

That is precisely what this engine is forward-testing. It is not claiming an edge; it
is measuring whether a proven *underlying* edge survives being expressed as a real
option.

## 3.3 Bounce

**File:** `bounce-engine.js` · **Paper**

Watches each near-the-money option's premium and tracks its **session low**. When the
price **bounces 5% off that low**, it buys — waiting for the bounce rather than catching
a falling knife. Exit at **+30%** or **−15%**.

**Evidence:** that exact configuration was the **only profitable one** on the data
tested; every trailing-exit variant lost money.

> **Validated on a single day of data.** The engine's own header calls it experimental
> until multi-day results exist. One day is one market condition, not a sample.

## 3.4 ORB / Afternoon execution

**Files:** `execution-engine.js`, `afternoon-engine.js` · **Paper**

- **ORB engine** — watches the opening-range breakout, enters an ATM+2 option, manages
  stop / trail / target / end-of-day exit.
- **Afternoon engine** — the 12:00–14:30 session, scoring entries by combining existing
  detectors: gamma blast (0–30 points), break-of-structure and rejection reversals
  (0–25), and others.

**Evidence: negative.** This is the multi-confirm directional family that returned
**PF 0.94 / 0.89 / 0.97** across the three indices. It is kept running for observation
and because both engines carry the **halt invariant** — the fail-closed risk brake
described in §4 — but it is not a strategy this system recommends.

---

# Part 4 — The safety layer that sits under all of them

## 4.1 The halt invariant

Both execution engines refuse to auto-trade when any of these is true:

- the equity state file is **corrupt or unreadable** — if the loss streak cannot be
  known, trading stops;
- consecutive losses have reached the configured limit;
- drawdown from the peak has exceeded the configured maximum.

It is computed from **persisted state**, not from a flag in memory, so a restart cannot
clear it. A halted engine stays halted until someone looks.

## 4.2 The forward-test gate

No strategy graduates from paper on anyone's opinion. The gate on the dashboard's
**Health** tab reads today:

> **INSUFFICIENT — only 22/30 forward trades. Keep paper-testing, no live decision yet.**

## 4.3 The instrument registry

Lot size, tick size, strike interval and expiry weekday come from one broker-verified
file. Where a value is unknown, engines **refuse to size a trade** rather than guessing.
A rupee figure built on a guessed lot is a fabricated number wearing a currency symbol.

## 4.4 Cost realism

Brokerage, STT on premium, exchange charges and a realistic spread are applied. This
matters most on cheap options: on a sub-₹20 option the **spread alone is 5–10%** of the
premium, which is why several backtests that look profitable gross are not net.

---

# Part 5 — The AI Agents pipeline (strategy 9)

**File:** `agents-engine.js` · **Runs:** yes, paper · **Page:** 🤖 AI Agents

Not an options strategy — a **news-to-equity** pipeline, in five stages:

1. **News** — headlines are scanned and classified.
2. **Impact probability** — deal-class events (results, orders, acquisitions) are scored
   for direction and expected move, with **every parameter disclosed** on screen:
   sentiment strength, confidence, event-type weight, recency, impact score.
3. **Fusion** — 11 factors combined.
4. **Risk gate** — 9 checks.
5. **Paper executor** — +40% target, −20% stop.

**What makes it honest.** Every prediction is archived with its probability and later
scored against what the stock actually did — the **Actual** and **Hit** columns. It is
graded, not just published.

**Evidence: unproven.** It is a disclosed-parameter heuristic, not a validated model.
The accuracy strip on the page is the running record.

---

# Part 6 — What to actually do with this

**If you want the strategy with real evidence behind it:** watch the **Strangle**
engine. 91% win rate over 600 days, single-digit drawdown, and it is the one building a
forward-test record.

**If you are drawn to buying options:** read §3.0 again. Two of three tests lose money.
The two buying engines that run — Gamma-Blast and Trend-Ride — exist to test *narrow,
specific* conditions, and both say in their own code that they have not proven
themselves.

**Treat with the most suspicion:** the Expiry Straddle's 470% CAGR, and any single
day's validation (Bounce).

**The honest one-line summary:**

> Selling premium into rich volatility has measured evidence across 600 days. Buying
> options does not, except possibly in two narrow cases that are still being measured.
> Nothing here has yet cleared the gate to trade real money.
