# 099 — Expiry-Day Buying vs Selling: a 1,280-trade backtest on real NSE data

Run 2026-09-01. Script: `bt-expiry-buy-vs-sell.js`. Tests: `test/bt-expiry-buy-vs-sell.test.js`.

Evidence grades: **[MEASURED]** a number this run produced · **[VERIFIED]** ran it
and read the output · **[ESTIMATED]** reasoned, assumptions shown · **[OPINION]**
judgement · **[UNKNOWN]** not established. Never merged.

---

## 0. THE REQUEST, AND WHAT THE DATA ACTUALLY SUPPORTS

The ask was a backtest over "1200 expiries", buying and selling.

**1,200 expiries do not exist in this archive, and could not.** [MEASURED]
`bt-data/bhav` holds 600 daily NSE UDiFF bhavcopy files, 2024-01-08 → 2026-06-17,
195 MB, 983,999 NIFTY option rows. Within them, **128 expiry days** were actually
observed settling (2024-01-11 → 2026-06-16). NIFTY lists roughly 52 weekly
expiries a year, so 1,200 expiries would require about 23 years of history.

What the archive *does* support is **1,280 trades** — 128 expiries × 5 strikes ×
CE and PE — which matches the scale of the earlier 1,200-trade study. That is what
was run. The number 1,200 is honoured as a trade count, not as an expiry count,
and the distinction is not cosmetic: see §3, where treating 1,280 trades as 1,280
independent observations is shown to overstate the result by a factor of 3.2.

---

## 1. THE TRADE TESTED

Enter at the **expiry-day open**, exit at the **expiry-day close**, on contracts
settling that same day. Five strikes either side of the money, calls and puts,
each run both long and short.

Gross, the two sides are exact mirrors — that is deliberate. Everything that
separates buying from selling here is **costs, win-rate asymmetry, and the shape
of the tail**, and those are the only things this backtest is asked to measure.

Costs come from `charges.js`, the production model — brokerage, STT, exchange
transaction, SEBI, stamp, GST. Nothing was invented for the backtest.

---

## 2. HEADLINE RESULT [MEASURED]

1,280 trades · 128 expiries · 2024-01-11 → 2026-06-16 · 0 contracts skipped.

| side | n | win% | net total | mean | median | max win | max loss | PF |
|---|---|---|---|---|---|---|---|---|
| **BUY** | 1,280 | 28.6% | **−₹8,01,242** | −₹626 | −₹1,380 | +₹31,859 | −₹39,316 | 0.73 |
| **SELL** | 1,280 | 71.0% | **+₹6,58,482** | +₹514 | +₹1,282 | +₹39,010 | −₹32,033 | 1.30 |

By distance from the money (strike chosen on the prior close):

| bucket | BUY net | SELL net | SELL win% | SELL PF |
|---|---|---|---|---|
| ATM−2 | −₹2,07,065 | +₹1,78,210 | 73.0% | 1.44 |
| ATM−1 | −₹1,89,957 | +₹1,61,550 | 72.3% | 1.39 |
| ATM | −₹1,48,465 | +₹1,20,244 | 69.5% | 1.28 |
| ATM+1 | −₹1,51,282 | +₹1,22,846 | 70.3% | 1.27 |
| ATM+2 | −₹1,04,473 | +₹75,632 | 69.9% | 1.17 |

By side of the chain:

| | BUY net | SELL net | SELL win% | SELL PF |
|---|---|---|---|---|
| CE | −₹5,38,233 | **+₹4,66,343** | 73.1% | 1.44 |
| PE | −₹2,63,008 | +₹1,92,139 | 68.9% | 1.17 |

**Cost drag on the selling side: ₹71,734 against a gross of ₹7,30,216 — charges
eat 9.8% of gross.** [MEASURED]

The direction agrees with everything else this project has measured: buying
option premium bleeds, selling it collects. Selling wins 71% of the time and buying
loses in every single bucket. What follows is why that is not yet a green light.

---

## 3. THE CORRECTION THAT MATTERS MOST

**Ten trades on the same expiry day are not ten independent observations.**
[VERIFIED] All five strikes and both rights move together with the same
underlying, on the same day, under the same volatility. The independent unit is
the **expiry**, not the trade.

Aggregating the ten trades into one P&L per expiry and testing on n = 128:

| | value |
|---|---|
| expiries | 128 [MEASURED] |
| mean per expiry | +₹5,144 [MEASURED] |
| standard deviation | ₹28,596 [MEASURED] |
| **t-statistic** | **2.04** [MEASURED] |
| expiries profitable | 87 / 128 = 68.0% [MEASURED] |

**A naive per-trade t-test would have inflated this by about √(1280/128) = 3.2×,
reporting roughly 6.5.** [MEASURED] That would have read as overwhelming evidence.
The honest number, 2.04, sits just past the 1.96 line — which is to say: real
enough to keep studying, nowhere near strong enough to fund.

---

## 4. THE LOOK-AHEAD THAT WAS NOT COMMITTED

Strikes must be chosen from information available at the open. This backtest
centres them on the **previous session's closing underlying**.

The alternative — centring on the expiry day's own closing underlying — is a
single-line change and looks entirely reasonable while reading the code. It was
run as a control:

| strike chosen from | SELL net |
|---|---|
| prior session's close (honest) | **₹6,58,482** [MEASURED] |
| same day's close (look-ahead) | **₹48,67,135** [MEASURED] |

**The bias would have added ₹42,08,654 — a 639% inflation.** [MEASURED]

One line separates a marginal, arguable edge from a spectacular fake one. This is
the single most important number in the document, and it is not about options at
all — it is about how easily a backtest lies. `test/bt-expiry-buy-vs-sell.test.js`
pins the honest version so it cannot drift back.

---

## 5. WHY THE EDGE IS NOT BANKABLE YET

Four measured reasons, in order of how much they should worry an operator:

1. **The profit is concentrated.** The **top 10 expiries of 128 produce 77% of the
   total**. [MEASURED] The remaining 118 expiries together net about ₹1.5L over
   two and a half years. This is not the steady grind that selling is supposed to
   be, and a strategy that depends on ten days in 128 is a strategy exposed to
   which ten days you happen to be flat.
2. **The tail is where the money goes.** Worst single expiry **−₹90,206** on
   2025-05-15. The five worst expiries sum to **−₹4,03,449**, against a total
   profit of ₹6,58,482. [MEASURED] Five bad days remove 61% of the entire result.
3. **t = 2.04.** [MEASURED] Marginal.
4. **The backtest flatters selling by construction.** [VERIFIED] It carries every
   short from open to close with no stop and no intraday path. A short that would
   have been closed at a loss mid-day is held to a better close. The real strategy
   would have stops, and stops would change these numbers in a direction this run
   cannot measure.

---

## 6. WHAT WAS NOT MODELLED

Stated so no reader has to guess. [VERIFIED — all absent from the code]

- **Slippage.** Fills assumed at the printed open and close.
- **Margin.** The seller's return on capital is not comparable to the buyer's;
  ten short legs per expiry demand a margin this run never computes. Return on
  margin is **[UNKNOWN]**, and deliberately not estimated.
- **Intraday path**, stops, and adjustments — see §5.4.
- **Exercise STT.** Positions are squared off at the close, so the 0.125%
  settlement STT on exercised in-the-money longs never applies. A buyer who holds
  to settlement instead pays materially more than this model shows.
- **Other instruments.** NIFTY only. BANKNIFTY and SENSEX are **[UNKNOWN]** here.

---

## 7. HONEST VERDICT

**[MEASURED]** On real NSE data across 128 expiries, expiry-day option *buying*
lost money in every bucket tested — 28.6% win rate, PF 0.73, −₹8.01L. That
finding is unambiguous and consistent with the project's earlier work.

**[MEASURED]** Expiry-day option *selling* made ₹6.58L at a 71% win rate, but on
the correct unit of analysis carries **t = 2.04**, draws **77% of its profit from
10 of 128 expiries**, and gives back **61% of everything in its five worst days**.

**[OPINION]** This is evidence that the selling side is where the edge lives, and
evidence that this *particular* expiry-day, no-stop, ten-leg expression of it is
not yet a fundable strategy. The sensible next tests are a stop-loss variant, a
volatility-regime filter on which expiries to sit out, and the same run on
BANKNIFTY and SENSEX — each of which changes the tail, which is the part that
decides whether this survives.

**[OPINION]** And the finding worth carrying beyond this strategy: a one-line
change in strike selection moved the answer by 639%. Any backtest in this project
that does not state where its selection information came from should be treated as
unmeasured until it does.
