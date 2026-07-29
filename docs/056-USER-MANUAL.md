# ANTIGRAVITY PRO — User Manual

**Version:** 2026-07-29
**Mode:** PAPER. No real order has ever been placed by this system.

---

# Part 1 — What this product is

## 1.1 In one paragraph

ANTIGRAVITY PRO is a **decision-support terminal for Indian index options** — NIFTY,
BANKNIFTY and SENSEX. It reads live option chains from your Upstox account, records
every strike's price movement minute by minute, keeps a permanent archive of what
happened, and shows you the result on twenty-two pages. It also runs several trading
strategies **on paper** so their real performance can be measured before any money is
involved.

It is a **measuring instrument**, not an oracle.

## 1.2 What makes it different from a broker terminal

A broker's terminal tells you what a price *is*. This tells you what a price **did**,
and how confident you are entitled to be about it.

Three commitments run through every screen:

**Unknown is not zero.** If a data source does not report a number, the screen shows a
dash. It never fills the gap with a plausible-looking zero. A bank with no reported
return-on-equity shows `—`, not `0%`, because `0%` would be a claim that the bank earns
nothing.

**Hindsight is labelled as hindsight.** The page that shows the best possible buy-low
sell-high of the day says, in its own words, that this is a ceiling nobody could have
captured. It is useful for judging which strikes moved. It is not a profit you missed.

**A signal is only as good as its measurement.** Where a strategy has been tested, the
number is shown — including when the number is bad. Where it has *not* been tested, the
screen says **Unknown** rather than implying confidence.

## 1.3 What it does NOT do

- **It does not place real orders.** Everything is paper.
- **It does not predict.** No screen tells you what will happen next.
- **It does not have a proven money-making strategy.** See §1.4 — this is stated
  plainly rather than buried.

## 1.4 What the evidence actually says (read this before anything else)

### Selling premium — the strongest evidence

600 days of real NSE bhavcopy data, ₹1 lakh starting capital:

| Strategy | Trades | Win rate | Net | Max drawdown | CAGR |
|---|---|---|---|---|---|
| EXPIRY_STRADDLE | 127 | **90 %** | ₹62.1 L | 4.9 % | 470 % |
| SHORT_STRADDLE | 129 | 86 % | ₹4.94 L | 6.9 % | 111 % |
| SHORT_STRANGLE | 129 | **91 %** | ₹4.41 L | 5.9 % | 103 % |
| IRON_CONDOR | 129 | 81 % | ₹1.79 L | 3.9 % | 54 % |

High win rates, modest drawdowns. This is why the **Strangle** engine is the one that
matters, and why it is the strategy accumulating a forward-test record.

> The EXPIRY_STRADDLE line is extraordinary and should be treated with suspicion until
> it survives forward testing. A 470% CAGR from 127 trades is the kind of number that
> usually means the test is easier than reality — fills, slippage and gap risk are not
> fully modelled.

### Buying options — two tests, and they disagree

This is stated in full because collapsing it into one verdict would be exactly the
mistake this product exists to avoid.

| Test | What it does | Result |
|---|---|---|
| **GAP_BUY** (in the 600-day comparison) | Gap-and-go, deep-OTM, buy at open | **2 % win rate**, net ₹15,007, **33.3 % max drawdown** for a 6 % CAGR |
| **`bt-real`** (same idea, risk-scaled sizing) | Same strategy, 5 % risk per trade, compounding | 470 trades, 6.8 % win rate, **profit factor 2.04** |
| **Intraday multi-confirm directional** | NIFTY, 197 days, 1,200 trades | **Profit factor 0.94** — a net loser. SENSEX 0.89, BANKNIFTY 0.97 |

Read together: buying options is a **lottery profile**. Two of three tests lose money;
the one that does not wins 7 times in 100 and pays for it with a third of the account
in drawdown. Nothing here supports buying an option because a screen made it look
attractive.

### The rest

| Claim | Status |
|---|---|
| "Hero-zero" — cheap options that multiply | **Unknown.** The base rate has never been measured on valid data. See §4.6. |
| The paper strategies are ready to go live | **No.** The forward-test gate reads `INSUFFICIENT` — 22 of the 30 trades needed. |

**Everything on the buying side of this platform is research, not a recommendation.**

---

# Part 2 — Getting started

## 2.1 Starting the bot

The bot starts **by itself**:

| Trigger | When |
|---|---|
| `Antigravity-Bot-Auto-Start` | Weekdays **08:50** — before the 09:15 market open |
| `AntigravityBot-Server` | At logon — catches up if the machine started late |

Both run `start-bot.bat`. Each of the five components is started **only if it is not
already running**, so both triggers firing on the same day is harmless.

**To start it manually:**
```
Start-ScheduledTask -TaskName 'AntigravityBot-Server'
```

> **Do not run `start-bot.bat` from a terminal you are about to close.** The components
> become children of that console and die with it. Use the scheduled task, which runs
> them detached.

**To check it is running:** open `http://localhost:3000/` — that is the Command page.
Five node processes should exist: the server plus four warehouse helpers.

## 2.2 The five components

| Component | Job | Interval |
|---|---|---|
| `server.js` | Serves every page and every API, talks to Upstox, runs the engines | continuous |
| `option-warehouse.js` | Copies the day's option history into a permanent archive before it is purged | 5 min |
| `warehouse-derive.js` | Rebuilds each strike's high/low record from that archive | 10 min |
| `warehouse-api.js` | Read-only archive server on port 3100 | continuous |
| `warehouse-capture.js` | Snapshots chains, position outcomes and daily NAV | 5 min |

**Why the capture helper must never run faster than 5 minutes:** the server's snapshot
cache is 4 seconds, so every capture cycle forces a fresh call to Upstox. At 60-second
intervals across three instruments that added roughly 180 chain calls an hour and
helped trigger a rate-limit ban on 2026-07-27.

## 2.3 Navigation

Every page has the same left sidebar. Press **`b`** to collapse or expand it.

The sidebar is the **only** list of pages in the system — there are no duplicate menus
to drift out of date.

---

# Part 3 — The pages

## LIVE

### ⌂ Command (`dashboard.html`) — the home page

Everything important, grouped into six tabs so each is one screen:

| Tab | What it holds |
|---|---|
| **High / Low** | Day range, ORB high/low, VWAP per index; the strike price timeline; the full high/low mapping for every strike |
| **Chain & Quotes** | Option chain with OI build-up; full market quotes with paper BUY buttons |
| **Signals** | Signals & regime, 13 technical indicators, live positioning, the Gamma-Blast engine |
| **Book & P&L** | Paper performance, position and P&L verification, the open book |
| **Health** | Trade plan, signal-engine health, the forward-test gate |
| **All** | Everything at once — the only tab that scrolls |

Panels keep updating in the background, so switching tabs shows data, never a spinner.

**High / Low mapping** — for every strike, the CE and PE day high and low, each with
the time it was made. A dash means the archive has no record for that leg, not that it
did not move.

### 🔥 Signal Heatmap (`signal-heatmap.html`)

Every strike as a coloured row: CALL on the left, PUT on the right, strike in the
middle. Colour is probability of finishing out-of-the-money.

Each leg shows:

```
H 392.1        L 350.1        ← the day's high and low
▬▬▬▬●▬▬▬▬▬                    ← where the price is between them
42.1 pts  ₹2,733 /lot  +34.1 / −8.0
```

- **pts** — the day's range in points
- **₹/lot** — what that range is worth for one lot, using the broker-verified lot size.
  Shows `—` if the lot is unknown; it is never guessed.
- **+34.1 / −8.0** — how far the live price sits above the low and below the high

**PoP** is a risk-neutral estimate (1 − |Δ|) — the chance of finishing out-of-the-money.
It is **not** a probability of profit, and it never prints a bare `100%`; anything at or
above 99 reads `≥99%`.

Below the grid, the **analysis strip** scores up to 11 factors. When a factor has no
feed it says **UNKNOWN** in amber and is *excluded* from the verdict — the header tells
you how many factors were actually live (e.g. "7 of 11"). A verdict from 7 factors is
labelled a partial reading.

### 🧭 AMI Heatmap (`ami-heatmap.html`)

The same strike grid, plus signals pushed from AmiBroker, with three views — **PoP**,
**OI** and **LTP**. Each leg carries the same high/low mapping with points and rupees.

### 🧱 OI Analysis, 🗺️ Heatmap

Open-interest build-up and the option-chain heatmap: where positions are being added
and removed.

---

## RESEARCH

### 🎯 Buy Low → Sell High (`capture.html`)

Two views, answering two different questions. **They must never be read as one.**

**"Day's best"** — for each strike, the best buy-low-then-sell-high that was actually
available *in time order*: the low must come before the high, so it is a pair someone
could in principle have taken.

> **This is perfect hindsight, not a strategy.** Nobody times both ends. Read it as the
> ceiling the day offered — never as a P&L you missed.

**"At the low now"** — which legs are trading at their session low *right now*.
`0%` means at the low, `100%` at the high.

> **This is where the price is, not a reason to buy.** A leg sits at its low because it
> has been falling. This platform's own 1,200-trade intraday test put directional buying
> at a profit factor of 0.94 — see §1.4 for the full picture, which is worse than that
> single number suggests.

The **min day range %** filter is doing real work: without it the list fills with
deep-ITM strikes whose entire day spanned 1% of their premium. Those are not "at a low";
they never moved.

The **ARCHIVE** chip shows the true age of the data. Rows reach this page through
capture → mirror → derive, so it can be up to about **15 minutes** behind live. The chip
counts from when the data was derived, not from when the page last asked.

### Δ Greeks → P&L (`greeks.html`)

Answers "when the Greeks are at what values, does this position make money?"

Net theta, delta, gamma and vega for your position, then a **scenario grid**: rows are
moves in the underlying, columns are time and a shift in implied volatility.

- The **At expiry** column is exact — read off the payoff engine's own curve.
- **Today** and **+1 day** are **estimates** (a second-order Greek approximation) and
  are badged `EST`. They ignore higher-order terms and the volatility smile, and get
  less reliable the larger the move.

Where loss is unbounded, the page says **UNBOUNDED** rather than showing a large number
that looks like a limit.

### 🕘 Strike History, 🎲 PoP Seller, 🧪 Strategy, 📐 Payoff

- **Strike History** — one strike's full high/low history for any archived day.
- **PoP Seller** — premium-selling candidates ranked by probability of expiring
  worthless.
- **Strategy** — build a multi-leg position and see its chain, Greeks and payoff.
- **Payoff** — the payoff diagram on its own.

---

## CHARTS

**📈 Chart** (one instrument), **▦ 4 Charts** (four panes, any instrument and
timeframe, EMA 9/21/200), **🕯️ Patterns** (candlestick patterns crossed with OI,
momentum and trend).

---

## ENGINES

### 🤖 AI Agents (`agents.html`)

A five-agent pipeline: news → stock-impact probability → 11-factor fusion → 9-check
risk gate → **paper** executor.

The **Stock Analyst** answers any Indian stock with a live verdict plus full
fundamentals — valuation, per-share, returns and margins, growth, balance sheet,
dividend, shares, and analyst consensus.

Two things to understand:

- **Every blank is a figure the source does not report** for that issuer. A bank shows
  no EBITDA, no current ratio and no debt-to-equity because those are not reported for
  lenders — not because they are zero. Where return-on-equity is missing it is derived
  as EPS ÷ book value and badged **DERIVED**.
- **Shareholding is Yahoo's insiders/institutions split, not the SEBI pattern.** For an
  Indian company "insiders" lands near the promoter stake, but it is a different
  taxonomy and the parts do not sum to 100 — the remainder is shown as "other" rather
  than being split into FII/DII/retail the source does not have.
- **Analyst targets are opinion**, badged as such. Nothing in the platform acts on them.

Fundamentals are context only — they are fetched *after* the verdict is computed and
cannot influence it.

### ⚡ Quant Center, 🎚️ Strangle, ✅ 4 Engines, 💼 Trade, 🩺 Health

- **Quant Center** — paper P&L, win rate, trade count across all engines.
- **Strangle** — the short-strangle / condor engine, the one with measured evidence
  behind it. Regime-gated: it skips when implied volatility is below the 50th
  percentile, sells a strangle between 50 and 80, and switches to a defined-risk condor
  above 80.
- **4 Engines** — the four signal engines side by side.
- **Trade** — live paper positions and both option chains with BUY buttons. The header
  keeps the spot prices and the **PAPER** badge on screen at all times.
- **Health** — component health, latency, and the forward-test gate.

---

# Part 4 — Reading the numbers honestly

## 4.1 PAPER means paper

Every engine is in paper mode. `TRADE_MODE` is deliberately **not** persisted across
restarts — every boot starts in paper, so a restored "auto ON" setting can never re-arm
a live mode by accident.

## 4.2 The forward-test gate

Before any strategy could be considered for real money it must clear the gate. Today:

> **INSUFFICIENT — only 22/30 forward trades. Keep paper-testing, no live decision yet.**

The gate is on the dashboard's Health tab. It is not advisory.

## 4.3 What a dash means

`—` means **the source did not report this**. It never means zero. This applies
everywhere: a missing lot size, an unreported ROE, a strike with no archived high/low.

## 4.4 What EST and DERIVED mean

- **EST** — a model estimate, not a measurement (the Greeks scenario grid).
- **DERIVED** — arithmetic from two reported figures, not a source number (ROE from
  EPS ÷ book value).

Reported and derived values are never merged into one number.

## 4.5 Data freshness by page

| Data | Lag |
|---|---|
| Live prices, chains, signals | seconds |
| High/low archive (`opthl`) | up to 60 s |
| Warehouse pages (Buy Low → Sell High) | up to ~15 min |

The live feed being current does **not** mean the archive is. Early in a session the
warehouse can still be showing yesterday.

## 4.6 The hero-zero question — why there is no number

The obvious question — *how often does a cheap option multiply several times?* — has
**no answer here yet**, deliberately.

The archive mostly does not start at 09:15. Of twelve archived days, one begins at the
open; the rest begin whenever the bot was started. A base rate computed on that data
would read as "buy at the open, hold to close" while actually measuring "buy at 2pm" —
and on expiry day that is mostly afternoon theta decay.

The one clean day gave 67% of cheap options doubling — which is not a base rate at all.
Split by side: **every put paid, no call did.** It was one large down day seen through
147 correlated contracts. Effective sample size: about one.

**A number will appear when there are 20 sessions starting by 09:20, reported per side
and per instrument, net of costs — including the 5–10% spread a sub-₹20 option carries.
Until then the honest answer is Unknown.**

---

# Part 5 — Practical notes

## 5.1 Everything fits one screen

No page scrolls. Where a table is genuinely longer than a screen it scrolls *inside its
own panel*, so headings, filters and caveats stay visible. The measurement behind that
claim is checked in — you can rerun it:

```
node tools/ui-measure.js scroll     # does any page scroll?
node tools/ui-measure.js fonts      # is any text too small?
node tools/ui-measure.js clip       # is anything hidden?
node tools/ui-measure.js requests dashboard.html 60
```

## 5.2 If a page looks stale

1. Check the server is up: `http://localhost:3000/healthz`
2. Check the five processes exist.
3. Restart: `Start-ScheduledTask -TaskName 'AntigravityBot-Server'`

The dashboard detects a server restart and reloads itself within 12 seconds.

## 5.3 If the broker starts refusing

You will see `429` in `data/logs/server.log`. The connector handles this on its own: it
pauses that instrument, serves the last good chain meanwhile, and widens its call
interval, narrowing again after three clean fetches. Under a 240-request load test this
took rate-limit refusals from 458 to zero.

## 5.4 Where things are

| | |
|---|---|
| Logs | `data/logs/` |
| Option high/low archive | `data/opthl/<date>.json` |
| Minute bars | `data/opt-candles/<date>.json` |
| Permanent warehouse | `data/warehouse/` |
| Engine settings that survive restart | `data/config-overrides.json` |

## 5.5 Tests

```
npm test
```

67 suites. They are **ratchets** — they encode defects that have already happened once,
so the same mistake cannot return silently.

---

# Part 6 — The honest summary

**What is proven:** option **selling** has an edge across 600 days of real bhavcopy —
81% to 91% win rates with single-digit drawdowns. The infrastructure is sound: no page
scrolls, no data is hidden, the broker is no longer being over-called, and every
collector survives a bad cycle.

**What is disproven:** directional option **buying**. Two of the three tests lose money
outright (profit factor 0.89 to 0.97 across three indices), and the one that does not
wins 2–7 times in 100 while giving back a third of the account in drawdown.

**What is unknown:** the hero-zero base rate, and whether the paper strategies survive
contact with real fills. Both need time and data, not code.

**What you should do with it:** use it to see what the market actually did, and to
watch the selling engines accumulate a forward-test record. Do not use any screen here
as a reason to buy an option — the platform's own evidence argues against it, and it
says so on the pages themselves.
