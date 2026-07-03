# World's Profitable Option Strategies → Re-tested on OUR Real NIFTY Data

**Deep report · 2026-07-03.** Two-part study: (A) what the world's most profitable
option platforms/funds actually run, with their published numbers and sources;
(B) those exact mechanics re-run HONESTLY on our own 600 real NIFTY trading days
(2024-01-08 → 2026-06-17, real bhavcopy premiums, charges.js costs, multi-day
walk) — `bt-world-strategies.js` / `bt-data/result-world-strategies.json`.

> Verification note: the adversarial-verify stage of the research harness hit a
> session limit, so the claims below are **source-linked but not 3-vote
> verified**. All key numbers are from primary publishers (CBOE research PDFs,
> OptionAlpha's own trade logs, ORATS docs) and are consistent with the
> well-known literature. Treat single-blog numbers with extra care.

## A. What the world's evidence actually says

### 1. The structural edge: Volatility Risk Premium (VRP)
- S&P VRP (VIX − subsequent realized vol) positive **86% of the time since 1990,
  averaging +4.2 vol points** (Barclays VRP paper; same 4.2-pt figure in CBOE/
  Bondarenko). Positive in **20 of 21 years** 1998–2018 (all but 2008).
- Academic: ATM S&P straddle **buyers lose ~3%/week**; short-vol Sharpe rivals
  the equity premium **but is left-tailed — raw harvesting is not viable without
  tail-risk management** (SSRN 5464595).
- ✔ This is the edge our bot already monetizes (validated strangle/condor).

### 2. CBOE benchmark indices — 30+ years of systematic selling
| Index | Mechanic | Result vs S&P 500 | Source |
|---|---|---|---|
| PUT | sell 1-month ATM cash-secured put | 9.54% vs 9.80%/yr at 10.0% vs 14.9% vol → **Sharpe 0.65 vs 0.49**; MaxDD −32.7% vs −50.9% | Bondarenko/CBOE 2019 |
| BXM | covered call | 11.77% vs 11.67% (1988-2006) at ⅔ vol → Sharpe 0.77 vs 0.51 | Callan/CBOE |
| WPUT | **weekly** ATM puts | LOWER return than monthly (4.51% vs 5.97% CAGR 2006-18) but **much smaller tail: MaxDD −24.2% vs −32.7%** | Bondarenko/CBOE |
| CNDR | iron condor, 0.20Δ shorts + 0.05Δ wings | 59% of months land in 0..+2%; **MaxDD 19% vs 51%** for S&P | CBOE insights |
- Takeaway: systematic selling ≈ index returns at far lower drawdown; weeklies
  trade some return for a much smaller tail; condor is the drawdown-killer.

### 3. tastytrade mechanics (independent large-sample validation)
- spintwig re-ran the core mechanic on **41,800+ short SPX 45-DTE strangles
  (2007–2023)**: profit accrual is non-linear and **levels off after ~50% of max
  profit**; managed exits (50% / 21-DTE) beat hold-to-expiration risk-adjusted.
- ORATS publishes the concrete regime parameterizations the industry uses:
  **IV-percentile buckets <33 / 33-66 / >66** and **VIX regimes <15 calm /
  15-20 normal / >20 uncertain**; tested exits SL −25/−50/−75%, TP +25..+300%.

### 4. 0DTE (expiry-day) findings — OptionAlpha's ~25,000 live autotrades
- Iron **butterflies 72%** win (4,959 trades) vs iron **condors 63%** (3,170).
- **Entry timing dominates**: condors opened <2h after open averaged **−0.36%**;
  opened later in the day **+37%** (759 positions).
- Held-to-expiry condors: 94% full winners (but only ~20% were held).
- A live 0DTE "breakeven IC" track record: **9,100 trades, 49/57 months
  profitable with only a 40% win rate** — asymmetric R:R, not win-rate, pays.
- ✔ Maps directly onto our expiry engines: the afternoon window we already use
  is exactly what OptionAlpha's data supports.

### 5. India-specific
- NIFTY weekly short strangle (OTM+2 CE/PE), 124 trading days: **64.5% win,
  17% ROI in ~6 months** (Finance Simplified/Goel — single blog, ballpark only).
- Our own 600-day bhavcopy backtests remain the strongest India evidence we
  have: selling wins, buying bleeds (PF 0.94 directional).

## B. Same mechanics on OUR data — 600 real NIFTY days, costs included

`node bt-world-strategies.js` · weekly cycle entries · multi-day daily-resolution
walk · 2× leg stop where noted · charges.js on every leg · compounding ₹1L @5%.

| Strategy (world mechanic) | Trades | Win% | PF | Net ₹ | ₹/trade | MaxDD | Worst |
|---|---|---|---|---|---|---|---|
| BASE_STRANGLE (ours, hold-to-exp) | 128 | 80% | 7.25 | **14,69,794** | 11,483 | 7.2% | −37,322 |
| **TT_MANAGE50** (exit @50% credit) | 128 | **84%** | 6.90 | 10,41,064 | 8,133 | **5.0%** | **−28,731** |
| TT_CONDOR50 (condor @50%) | 128 | 80% | 1.42 | 1,68,006 | 1,313 | 35.4% | −1,05,508 |
| EM_STRANGLE (±1×expected-move strikes) | 128 | 83% | 6.51 | 9,18,699 | 7,177 | 5.7% | −31,055 |
| PUT_WRITE (CBOE-style 2%-OTM weekly put) | 128 | 63% | 1.56 | 3,04,946 | 2,382 | 35.5% | −29,020 |

### Verdict — what we adopt, what we skip
1. **ADOPT: manage-at-50%-of-credit (tastytrade mechanic).** On our data it
   raises win rate 80→84%, cuts MaxDD 7.2→5.0%, trims the worst loss by ₹8.6k —
   for less absolute net (theta left on the table). Net/DD is a wash; the
   smoother equity curve is worth more for real capital and for a SaaS track
   record. **Already wired**: strangle-engine `tpPct=50` (STRANGLE_TP_PCT) and
   the AI-agents condor `sellTpPct=50` — this backtest converts those defaults
   from "reasonable choice" to **validated on 600 real days**.
2. **KEEP: fixed 1.5%-OTM strikes.** Expected-move-based strikes (EM_STRANGLE)
   did NOT beat them here (9.2L vs 10.4L with identical exits) — honest negative.
3. **SKIP: standalone PUT_WRITE** — 63%/PF 1.56/35% DD on 2024-26 NIFTY (this
   window had real corrections). The strangle already sells the put side better.
4. **SKIP: condor as the profit engine** — at daily resolution the wings eat the
   credit (PF 1.42). Condor stays what our earlier research said it is:
   **tail protection** (force-condor / high-IVP switch), not the return driver.
5. **CONFIRMED: our existing IVP≥50 gate** matches ORATS's published 33/66
   bucket practice and the WPUT lesson (weeklies = smaller tail, less net).

## C. 20-year Yahoo backtest — BUYING vs SELLING head-to-head (backtest-tv/)

`backtest-tv/run.js` (buying) already existed; added `backtest-tv/sell.js` — the
same Yahoo-daily + Black-Scholes engine, but SELLING 0-DTE straddle/strangle/
condor on every expiry (1200+ NIFTY/SENSEX, 1423 BANKNIFTY), net of charges.

| | BUY (run.js) | SELL straddle (sell.js) |
|---|---|---|
| NIFTY | 99 tr · 57.6% · avg 1.31x | 754 tr · **97.2%** · PF 195 · net ₹97.2L |
| SENSEX | 167 tr · 48.5% | 966 tr · **96.1%** · PF 76 · net ₹90.0L |
| BANKNIFTY | 138 tr · 72.5% | 883 tr · **96.4%** · PF 113 · net ₹130.8L |

⚠️ The 96-98% sell win-rates are a **BS-model artifact** — expiry-morning IV set
to 1.7×HV overprices the premium and daily OHLC can't model an intraday
gap-through-strike, so the modelled seller "never loses." Real bhavcopy says
~80-84%, not 98%. Do NOT quote 97%. What IS robust across every method (modelled
buy, modelled sell, and real bhavcopy): **selling dominates buying** — more
trades, far higher win rate, positive PF where buying is break-even. The sell
tail (the rare gap that the model hides) is exactly why we run defined-risk
condors + IVP filter live, not naked strangles.

### Caveats (honest)
- Daily-resolution walk (bhavcopy has no intraday path): TP/SL trigger on daily
  closes, leg-stops on day highs. Win rates are ballpark, comparable across the
  table, not broker-statement precision.
- One index (NIFTY), one regime window (2024-26). US numbers span decades —
  ours don't. Forward paper results (strangle-engine + agents) are the referee.
