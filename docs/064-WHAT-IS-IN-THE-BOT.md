# 064 — What Is In The Bot

**ANTIGRAVITY PRO · the single master file**
**Date:** 2026-07-29 · Everything below was **measured from the repository and the
running server on this date**, not recalled.

This is the one file to read to know what this system is. Where a number appears,
it was counted. Where something is unproven, it says so.

---

## 0. One paragraph

ANTIGRAVITY PRO is a Node.js quantitative index-options platform for the Indian
market — NIFTY, BANKNIFTY and SENSEX — running on a live Upstox feed. It contains
nine trading strategies, of which five run in **paper mode** and none has ever
placed a real order. It carries 25 screens, 139 API routes, 95 modules totalling
26,200 lines, 70 test suites and 128 research documents. Its distinguishing feature
is not the strategies — it is that **every number on screen is graded by how well it
is evidenced**, and that unknown values stay blank rather than becoming zero.

---

## 1. The system in numbers

**Grade: Measured**, 2026-07-29.

| Dimension | Count |
|---|---|
| Root `.js` modules | **96** |
| Total lines in those modules | **26,499** |
| `server.js` alone | 7,174 lines |
| HTTP screens (`public/*.html`) | **26** |
| Screens listed in the navigation rail | 26 (in 5 groups) |
| `/api` routes | **144** |
| Test suites | **72** (all green) |
| Research documents (`docs/`) | **130** |
| Searchable listed equities | **5,798** (NSE 3,314 · BSE 2,484 · 208 with F&O) |
| Indices priced live | **6** — NIFTY, BANKNIFTY, SENSEX, FINNIFTY, MIDCPNIFTY, BANKEX |
| Git commits | 250 |

*Counts re-measured 2026-07-30. A detailed record of the work behind the last
increment is docs/065.*

---

## 2. The nine strategies, and what the evidence actually says

Four sell premium, four buy options, one is a news-driven equity pipeline.
**Every one is paper. No real order has ever been placed.**

| # | Strategy | Side | Running now | Evidence | Grade |
|---|---|---|---|---|---|
| 1 | **Short Strangle → Iron Condor** | Sell | **ON** (paper) | 129 trades, **91% win**, ₹4.41 L net, 5.9% max DD over 600 days of real bhavcopy | **Measured** |
| 2 | Short Straddle | Sell | Backtest only | 129 trades, 86% win, ₹4.94 L, 6.9% DD | **Measured** |
| 3 | Expiry Straddle | Sell | Backtest only | 127 trades, 90% win, **470% CAGR** — *treat with suspicion* | **Measured but suspect** |
| 4 | PoP Seller | Sell | Screen only | A calculator, never backtested | **Opinion** |
| 5 | **Gamma-Blast** | Buy | **ON** (paper) | No backtest is possible — needs minute-resolution expiry-afternoon data only now being collected | **Unknown** |
| 6 | **Trend-Ride** | Buy | **ON** (paper) | Underlying edge survives out-of-sample (PF 1.34 NIFTY); **whether the option leg survives costs is Unknown** | **Estimated** |
| 7 | **Bounce** | Buy | **ON** (paper) | Validated on **one day** — one market condition, not a sample | **Estimated** |
| 8 | ORB / Afternoon | Buy | **ON** (paper) | 1,200 trades, 197 days: **PF 0.94 / 0.89 / 0.97 — net losers** | **Measured, negative** |
| 9 | **AI Agents** (news → equity) | Either | **ON** (paper) | Disclosed-parameter heuristic, graded against outcomes, unproven | **Hypothesis** |

### 2.1 The one honest summary

> Selling premium into rich volatility has measured evidence across 600 days.
> Buying options does not, except possibly in two narrow cases still being measured.
> **Nothing here has cleared the gate to trade real money.**

### 2.2 Why the Strangle engine is the real one

It does not always trade. Below the 50th IV percentile it **skips** — premium is too
thin to be worth the risk. Between 50 and 80 it sells a strangle. Above 80 it sells
an **iron condor**, buying wings, because that is exactly when a violent move is most
likely and a naked short strangle has unbounded loss. Take profit at 50% of credit;
stop when a leg doubles. Sizing is margin-aware fractional Kelly scaled by volatility.

Selling *only when premium is rich* is what separates it from selling blindly.

---

## 3. What is switched on right now

Read from `data/config-overrides.json`. **Grade: Verified.**

| Setting | Value |
|---|---|
| `STRANGLE_ENGINE_ENABLED` | **true** |
| `STRANGLE_CAPITAL` | ₹7,00,000 |
| `STRANGLE_FORCE_CONDOR` | **true** (wings always bought) |
| `GAMMA_BLAST_ENGINE_ENABLED` | true |
| `BOUNCE_ENGINE_ENABLED` | true |
| `TREND_RIDE_ENABLED` | true |
| `AI_AGENTS_ENABLED` | true |
| `SENSEX_DIRECTIONAL_AUTO` | true |
| **`NIFTY_DIRECTIONAL_AUTO`** | **false** — disabled after 1,200 trades showed PF 0.94 |
| `SENSEX_AFTERNOON_AUTO` / `NIFTY_AFTERNOON_AUTO` | true |
| `CAPITAL_TOTAL` | ₹1,00,000 |
| `MAX_DAILY_LOSS_PERCENT` | 5 |

`NIFTY_DIRECTIONAL_AUTO = false` is the most informative line in that file: **a
strategy was switched off because its own measurement said so.**

---

## 4. The 25 screens

| Group | Screens |
|---|---|
| **Live** | Command Centre (`dashboard.html` — the home, 6 tabs), Signal Heatmap, AMI Heatmap, OI Analysis, Heatmap |
| **Research** | **Stock View**, **Stock Universe**, Buy Low → Sell High, Greeks → P&L, Strike History, PoP Seller, Strategy, Payoff |
| **Charts** | Chart, 4 Charts, Patterns |
| **Engines** | AI Agents, Quant Center, Strangle Monitor, 4 Engines, Trade, Health |
| **Learn** | User Manual, Strategy Guide, Data Honesty |
| Unlisted | `login.html` (pre-auth, correctly hidden), `command.html` / `command-pro.html` (superseded by the dashboard) |

**UI standards, measured and enforced by tests:** 24/24 pages do not scroll at
2560×1330; 24/24 have dominant text ≥13px; one shared rail owns navigation; one
shared `fit.js` bounds every page to the viewport.

---

## 5. The modules that decide things

40 of the 95 modules carry logic rather than plumbing. The significant ones:

| Module | Lines | What it does |
|---|---|---|
| `afternoon-engine.js` | 820 | 12:00–14:30 session scoring by combining detectors |
| `agents-engine.js` | 723 | The 5-stage news → equity pipeline |
| `execution-engine.js` | 673 | ORB entries, stop/trail/target, EOD exit, **halt invariant** |
| `pop-seller.js` | 548 | Ranks every strike by probability of expiring worthless |
| `strangle-engine.js` | 504 | The main engine — regime ladder, condor wings, Kelly sizing |
| `stock-analyst.js` | 489 | Stock resolution, fundamentals, verdict fusion |
| `candlestick-patterns.js` | 432 | Real 15m/1h patterns × OI × momentum confluence |
| `stock-technicals.js` | 280 | RSI/MACD/SMA/ATR + **corporate-action detection** |
| `trend-ride-engine.js` | 257 | Breakout option-buying, forward-testing an underlying edge |
| `gamma-blast-engine.js` | 220 | Expiry-afternoon gamma buying |
| `smart-money.js` | 211 | Market-structure detection |
| `news-engine.js` | 202 | Headline ingest and classification |
| `engine-verdict.js` | 179 | Cross-engine adjudication |
| `confluence-learner.js` | 174 | Weight learning across signals |
| `warehouse-*.js` | 601 | Capture, derive, serve the option archive |
| `meta-label.js`, `signal-health.js`, `trade-planner.js`, `gex-skew.js`, `vol-context.js`, `vrp-monitor.js` | ~650 | The Signal-Engine phases 2–5 |
| `position-sizer.js`, `vix-kelly-sizer.js`, `charges.js` | 241 | Money — sizing and true cost |
| `instrument-guard.js`, `loop-guard.js` | 168 | Fail-closed guards (§7) |

---

## 6. The rules this system runs on

These are not style preferences. They are the reason to trust anything on screen.

1. **`null ≠ 0`.** A blank means *not reported*. It never means zero. A bank
   reporting no gross margin and a bank with a 0% gross margin are different facts
   and they look different.
2. **Fail closed on money, fail open on evidence.** If a lot size is unknown, the
   engine **refuses to size a trade** rather than guessing. A rupee figure built on a
   guessed lot is a fabricated number wearing a currency symbol.
3. **Evidence grades never merge.** Verified, Measured, Estimated, Opinion, Unknown
   are five separate states. An Unknown is never averaged into a Measured.
4. **Unknown stays Unknown, with a resolution condition.** Every Unknown records
   *what would resolve it* — which turns the Unknown list into the research roadmap.
5. **Negative results are published.** The NIFTY directional engine's PF 0.94 is on
   the record and in the strategy guide. A system that only records what worked has
   stopped measuring.
6. **The instrument registry is the single source of truth** for lot, tick, strike
   step and expiry — broker-verified, and it once caught NIFTY/SENSEX expiry weekdays
   being **swapped**.

---

## 7. The two guards, and the bugs that produced them

**`instrument-guard.js`** — until 2026-07-29, `/api/options/snapshot?instrument=TMPV`
returned **spotPrice 77654.6** (SENSEX's price) labelled `"instrument":"TMPV"`.
RELIANCE and NOTAREALTHING returned the same number under their own names. One line
was responsible: `|| INSTRUMENT_META.SENSEX`. It is now refused with a 400 naming
the value and listing what is supported. One middleware covers all 139 routes,
including any added tomorrow. **Grade: Verified**, fixed and tested the same day.

**`loop-guard.js`** — three warehouse collectors ended with an unguarded
`setInterval(run, …)`. Node ≥15 terminates on an unhandled rejection, so one bad
cycle would silently end collection forever while the dashboard kept serving.

Both are the same shape: **a failure that produces no error message is worse than a
crash**, because a crash is visible.

---

## 8. The safety layer under every strategy

**The halt invariant.** Both execution engines refuse to auto-trade when the equity
state file is corrupt or unreadable (if the loss streak cannot be known, trading
stops), when consecutive losses hit the limit, or when drawdown exceeds the maximum.
It is computed from **persisted state**, so a restart cannot clear it.

**The forward-test gate.** No strategy graduates from paper on anyone's opinion.
The gate currently reads: **INSUFFICIENT — 22 of 30 forward trades.**

**Cost realism.** Brokerage, STT on premium, exchange charges and a realistic spread
are applied. On a sub-₹20 option the **spread alone is 5–10% of premium**, which is
why several backtests that look profitable gross are not net.

**Broker call governance.** The connector owns its own call rate — single-flight
coalescing, an adaptive floor honouring `Retry-After`, and a 429 cooldown. Refusals
went **458 → 0**; hit rate **7.3% → 59.2%**. **Grade: Measured.**

---

## 9. What the system knows about its own data — the honest part

This is the weakest area, it is measured, and it gates most future research.

| Fact | Grade |
|---|---|
| **12 of 13 archived sessions are missing the market open** (61–358 minutes each) | **Measured** |
| Complete sessions | **1** — 2026-07-08 |
| Cause: the collector was not running (the restart fix landed 2026-07-28; today's collector started 11:50 against a first sample at 11:45) | **Verified** timeline, **Estimated** attribution |
| Stored per strike | `[t, o, h, l, c]` — **premium only** |
| IV, OI, volume, depth, greeks stored | **None** — observed live, discarded every day |
| Index spot price history | **None** — `candles.json`, `prices.json` are 0 KB |
| Archive retention | Auto-deleted past **40 files** |
| Sampling | 60 s nominal, **86.2 s mean, 2,520 s (42 min) maximum gap** |
| Chain observed | A **±10% window**, not the listed universe |

**The asymmetry that matters:** price history can be re-fetched from the broker.
**Option-chain state cannot.** Where the OI walls stood at 11:00 last Tuesday is gone
permanently.

**Consequence:** of the 100 tasks in the research programme (docs/063), **61 depend
on data not currently being kept.**

---

## 10. What this system cannot do, and will not pretend to

| Not available | Why | Grade |
|---|---|---|
| Participant identity per strike (institutional vs retail) | No such field exists in any obtainable Indian source | **Estimated → definitively ruled by research task T005** |
| Verified dealer gamma sign | Requires customer/market-maker separation, which India does not publish per strike. `gex-skew.js:33` states its assumption openly | **Unknown, possibly permanent** |
| Trade count per strike | No such field in the feed — `volume` is contracts, not trades | **Verified absent** |
| IV Rank / IV Percentile | Needs 252 stored sessions; the archive caps at 40 and holds 13 | **Unknown for ~1 year** |
| Market depth, delivery %, circuit limits, SEBI shareholding pattern | Exchange entitlements and filings, not in a market-data vendor's API | **Verified absent** |
| Retroactive backtest of chain-state strategies | Chain state was never stored | **Verified** |
| Hero-zero base rate | One clean day, effectively n≈1 | **Unknown** — needs 20 clean sessions |

---

## 11. The research programme

Five design documents were produced this week. All are design only; none is built.

| Doc | Subject | The finding that mattered |
|---|---|---|
| **059** | Navigation architecture for 100+ modules | 94 of 95 modules are invisible from the menu, and no mechanism would notice a 96th |
| **060** | Strike volatility analysis | Of 19 requested metrics, **9 computable, 6 blocked, 1 impossible**. One tick is 3.7% of a ₹1.35 option; 70 of 662 strikes never moved |
| **061** | Strike lifecycle engine | Birth happens at the open, and **12 of 13 sessions have no open**. A strike's life is a contract, not an organism |
| **062** | Market gravity engine | OI concentrates near spot, so "price is near the OI wall" is **true by construction**. Needs a moneyness-matched, round-number-controlled null |
| **063** | 100-task research programme | 39 tasks need no data and start today; **61 wait on data being discarded**; every citation marked `NOT_RETRIEVED` |

---

## 12. How to run it

```
npm start                    # node server.js — run from the project root
npm test                     # 70 suites
npm run preflight            # pre-market checks
npm run preflight:registry   # instrument registry drift check
npm run pm2:start            # supervised
npm run export:engine        # package engines as a portable drop-in
```

Home page is `/dashboard.html`. Auth (`AUTH_ENABLED`) is **off** by default;
`viewer < trader < admin` RBAC exists behind it.

---

## 13. The three things worth fixing first

Ranked by consequence per unit of effort. All three are cheap.

| # | Fix | Why it is first |
|---|---|---|
| **1** | **Collector runs 09:15–15:30 every session, with an alert below 95% coverage** | Unblocks 61 research tasks. Costs almost nothing. Every day it is deferred is a day permanently absent from the future evidence base |
| **2** | **Persist the index spot series and the per-strike `iv/oi/volume/depth/greeks`** | Currently observed live and thrown away. Unreconstructable afterwards |
| **3** | **Lift the 40-file retention cap** | Without it, the archive erases itself faster than a year of sessions can accumulate, so IV Rank is permanently out of reach |

---

## The honest summary

This is a real quantitative platform with one strategy that has genuine evidence
behind it, four that are being forward-tested honestly, one that its own data proved
does not work and which was switched off, and a discipline — grades, blanks that
stay blank, fail-closed money — that is more unusual than any of the strategies.

Its weakness is not the code. **It is that the platform observes far more than it
keeps.** IV, open interest, volume, depth and the index price itself arrive every
minute and are discarded, and the collector misses the market open on most days.
Fix the collection, and most of what this system wants to know becomes answerable.
Leave it, and the strategies will stay exactly as well-evidenced as they are today.

**Nothing here has traded real money. That is a decision, not an accident, and the
gate is still at 22 of 30.**
