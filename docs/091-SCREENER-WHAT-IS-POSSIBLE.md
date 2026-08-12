# 091 — What the Screener Can Become: Research

**Measured 2026-08-10 against live endpoints, with the token this system holds.**
Every capability below is graded. Nothing is listed as possible because it sounds
possible.

Evidence grades, never merged:
**VERIFIED** — I ran it and pasted the output · **MEASURED** — a number from a
command · **ESTIMATED** — reasoned from measurements · **OPINION** — judgement ·
**UNKNOWN** — not established.

Companion: docs/090 (the query language, already built).

---

## 1. What we can reach — measured, one call each

| Capability | Result | Grade |
|---|---|---|
| **Daily bars per stock** | **646 bars**, 2024-01-01 → 2026-08-07, OHLC + volume + adjclose | VERIFIED |
| **Sector / industry** | `Energy` / `Oil & Gas Refining & Marketing`, plus headcount | VERIFIED |
| **Stock OPTION contracts, via our broker** | **RELIANCE 201**, **ABB 138** contracts. `RELIANCE 1080 PE 25 AUG 26`, lot 500 | VERIFIED |
| **Quotes on a stock option** | LTP 0.25 · OI 184,500 · volume 2,500 · **bid/ask depth present** | VERIFIED |
| **Stock options from yahoo** | **0 expirations** for Indian tickers | VERIFIED |
| **Historical fundamentals** | **6 quarters only** (2025-03 → 2026-06); `stockholdersEquity` and `totalDebt` **absent** | VERIFIED |
| Current fundamentals | PE, P/B, EPS, D/E, growth, margins, PEG, beta — docs/090 §2 | VERIFIED |
| ROE / ROCE / current ratio | absent from this source | VERIFIED |

### The two findings that decide everything

**Our broker carries stock options, and yahoo does not.**
`GET /v2/option/contract?instrument_key=NSE_EQ|INE002A01018` returns 201
contracts with lot sizes, and each one quotes with OI and depth. Every public
screener that works from free data cannot see this. We can.

**Historical fundamentals are 15 months deep and have no balance sheet.**
That single measurement removes an entire category of work, and it is better to
know now. See §4.

---

## 2. A correction to what we shipped yesterday

`screener-fields.js` lists **Sector** and **Industry** as UNAVAILABLE with the
reason *"the universe file carries no sector column"*.

That reason is true and the conclusion is wrong. The universe file has no sector
column; `quoteSummary(..., {modules:['assetProfile']})` returns one. Measured
above.

Two fields are refusable when they are one call away. That is a defect in the
registry, not a missing feature, and it goes in the first change made after this
document.

---

## 3. What the market already has — so we do not rebuild it

**Searched, not assumed.** India already has IV-rank screeners for NSE F&O:
**StockMojo** (live IV vs HV, IV rank, IV-HV spread), **JustTicks** (IV regime,
liquidity, call-put skew), **NiftyTrader** (IV/OI/volume/build-up),
**Talkoptions** (IV rank and percentile). Globally, **Barchart** and
**MarketXLS** do the same across thousands of names.

**So "an IV rank screener" is table stakes, not a differentiator.** Building one
and calling it an edge would be the same mistake as the GEX work in
docs/competitive research: shipping a commodity and describing it as a moat.

The published premium-selling workflow is well known: *IV Rank 70–100, IV
Percentile 60+, positive IV−HV spread, adequate liquidity* → roughly **8–12
candidates from ~200 F&O names per session**. That is a starting filter, not a
strategy, and everyone has it.

**What nobody offers is whether the screen has ever worked.** — OPINION, but see
§4 for why it is the open lane.

---

## 4. Screen backtesting: the honest version, and its hard limit

The literature is unambiguous about what makes a screen backtest worthless:
using data that was not available at the time (look-ahead), and testing only on
names that survived (survivorship). Recent work on **Indian small-caps** puts a
number on the second: testing on current index members reported **26.17% annual
returns against 21.23% for the true universe — an overstatement of about 23%.**

### What we CAN backtest — VERIFIED

**Technical screens.** 646 daily bars per stock, ~2.6 years. RSI, moving
averages, ATR, volatility, range position and price change are all computable at
any past date from bars that existed at that date. A screen made only of
technical fields can be run as-of 2025-03-01 with no look-ahead at all.

### What we CANNOT backtest — VERIFIED, and this is the wall

**Fundamental screens.** `fundamentalsTimeSeries` returned **6 quarters**, and
only income-statement lines: `totalRevenue`, `netIncome`, `basicEPS` are there;
**`stockholdersEquity` and `totalDebt` are absent.**

Consequences, stated plainly:

- **No historical P/B, no historical D/E** — the balance sheet is not there.
- **No historical market cap** — needs a historical share count we do not have.
- **Historical P/E is derivable** — historical price ÷ trailing EPS from the
  quarterly series — but only ~15 months back, and restatements are not tracked.
- **Survivorship is unsolved either way.** Our universe file is today's list.
  Companies delisted or dropped from F&O since 2024 are simply not in it, which
  is precisely the ~23% bias named above.

**Therefore:** a "backtest this screen" button that accepts a P/E condition would
be dishonest. The correct product is a backtest that **runs technical screens and
refuses fundamental ones by name**, saying why. That refusal is the feature — it
is the thing no competitor does, because refusing is bad marketing.

---

## 5. What is worth building, ranked

Ranking is OPINION; the evidence under each item is not.

### 1. Sector and industry as real fields — hours
One `assetProfile` call per stock, cached with everything else. Turns `Price to
Earning < 15` into `Price to Earning < 15 AND Sector = "Energy"`, which is the
single most-asked screener feature. Also fixes the registry defect in §2.
**Blocked by: nothing.**

### 2. Technicals wired in — a day
`stock-technicals.js` already computes RSI, SMA 20/50/200, ATR, volatility and
change. `screener-fields.js` already declares them. They return `null` today
because nothing fetches bars. 646 bars per stock × 208 F&O names is one backfill.
**Blocked by: nothing.** This also unlocks item 4.

### 3. The option-selling screen — days. This is the one nobody else can copy.
Our broker returns stock option contracts with OI and depth (§1). For each of the
208 F&O names we can compute, from data we already have or can fetch:

- IV of the near-month ATM strikes, and therefore **IV rank / percentile**
- **IV − HV spread**, using realised volatility from the 646 bars
- **liquidity that is real** — bid/ask depth and OI per strike, not just volume
- **lot value**, so a candidate is filtered by whether this account can trade it

`option-analyzer.js` and `free-chain.js` already exist and are the place to look
before writing new Greeks code.

**The distinguishing part is not the screen. It is that every candidate carries
its own history**: how the same filter performed on the same name over the last N
expiries, computed from bars, net of costs.

### 4. Point-in-time technical screen backtesting — weeks. The open lane.
"What would this screen have returned on 2025-03-01, and what happened next?"
Only technical fields; fundamentals refused by name with the §4 reason shown on
screen. Must report **survivorship as a stated limitation**, because our universe
is today's list, and a backtest that hides that is the 23% error.

### 5. Screen alerts — days
A saved screen re-run on a schedule, reporting what entered and left the set. Only
worth building after 4, so an alert is about a screen somebody has tested.

### Deliberately NOT recommended

- **An IV-rank-only screener** — §3, four Indian products already do it.
- **Fundamental screen backtesting** — §4, the data is not there. Not "later":
  not with this source.
- **A ranking engine** — filtering and ranking are different products, and
  ranking on unbacktested factors is a leaderboard of noise.
- **Buying a fundamentals vendor feed** before item 4 proves anyone uses screens.

---

## 6. What I did NOT verify

- **Whether stock-option quotes are usable at scale.** One contract was quoted.
  208 names × ~150 contracts is ~31,000 instruments; the rate limit, the wall
  clock and the cost of that sweep are **UNKNOWN**. The connector's own governance
  (docs: broker call governance) exists precisely because this class of sweep has
  bitten before, and it must be measured before item 3 is scoped.
- **Whether `option-analyzer.js` computes IV** and to what convention. It exists;
  I did not read it.
- **Whether 646 bars is enough for IV rank.** The convention is a one-year
  lookback; we have ~2.6 years of price, which gives HV. IV rank needs a **year of
  IV history, which we do not have and have never recorded.** Building item 3
  starts the clock on collecting it — that is a real dependency, not a detail.
- **Restatement handling in the 6-quarter fundamentals series.** UNKNOWN.
- **Whether F&O membership changed** over the backtest window. Our universe file
  is today's list; the historical F&O list is not held.

---

## 7. The one-line answer

We already have what a public screener has. **What we have that they do not is a
broker feed that carries stock option chains with depth, and a platform that can
act on them.** The work worth doing is the option-selling screen — and the thing
that makes it worth using is not the filter, which everyone has, but the honest
history attached to each candidate, which nobody publishes.

---

## Sources

- [Backtesting bias — how to avoid it](https://fortraders.com/blog/how-to-avoid-bias-in-backtesting)
- [Survivorship bias in Indian small-caps (arXiv)](https://arxiv.org/pdf/2603.19380)
- [Screener backtest with point-in-time data — Quant Investing](https://www.quant-investing.com/blog/how-to-back-test-your-investment-strategy)
- [StockMojo IV percentile screener (India)](https://stockmojo.in/iv-grid)
- [JustTicks IV screener for NSE options](https://www.justticks.in/iv-screener)
- [NiftyTrader options screener](https://www.niftytrader.in/options-screener)
- [Talkoptions IV screener](https://www.talkoptions.in/iv-implied-volatility-screener)
- [Barchart IV Rank and Percentile](https://www.barchart.com/options/iv-rank-percentile)
- [MarketXLS IV Rank screener](https://marketxls.com/iv-rank-screener)
