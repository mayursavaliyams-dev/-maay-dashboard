# Backtest Data — What to Buy So the Money Isn't Wasted

> For validating the "premium ~15 → trend-ride" option-buying strategy (and the
> bot's other strategies) over a long, multi-regime history. Read Section 2
> before purchasing anything — a naive "12 years of data" order will not test
> this strategy.

---

## 1. There are TWO different data needs — do not conflate them

| # | Data | Tests | Cost | Availability |
|---|------|-------|------|--------------|
| A | **Underlying index 1-min** (NIFTY/BANKNIFTY/SENSEX) | the DIRECTIONAL edge across regimes | low | easy, ~12 yrs exists |
| B | **Intraday OPTION chain** (per-strike premium + IV/OI/vol) | the OPTION-NET after real costs — **the real gate** | high | hard, limited history |

The strategy's open question is **B** (does the option leg profit after theta +
spread?), NOT A. Buying only A lets us model premiums with Black-Scholes — which
this codebase already rejects as unreliable for 0-DTE (`gamma-blast-engine.js:18`).
**A alone cannot validate this strategy.** B is what the rupees should buy.

---

## 2. The hard truth: "12 years of this instrument" does NOT exist

This strategy trades **cheap, near-expiry weekly/0-DTE index options**. That
market is recent:

- **NIFTY weekly options**: launched **Feb 2019**.
- **BANKNIFTY weekly**: 2016 → **discontinued Nov 2024** (SEBI: one weekly per
  exchange).
- **FINNIFTY weekly**: 2021. **SENSEX weekly (BSE)**: 2023.
- **The 0-DTE-heavy era** (multiple weeklies/week) was **2022–2024**, then curtailed.
- Monthly index options go back to 2001, but a monthly option is NOT what
  "premium ~15 explodes on expiry-day" describes.

**Implication:** a mechanical 12-year option backtest is partly incoherent — the
traded instrument didn't exist for most of it. Target **"as far back as the
weekly/0-DTE instrument existed"** (~2019→2024 for NIFTY weeklies), not a round
12 years. 12 years is the right horizon for the **underlying** (A), to prove the
directional edge survives bull/bear/COVID/2022 regimes.

---

## 3. Exact spec to purchase (give this verbatim to the vendor)

### Track A — Underlying index 1-minute (buy this first; cheap, immediately useful)
- Instruments: **NIFTY 50, NIFTY BANK, SENSEX** spot index
- Granularity: **1-minute OHLC** (tick not required)
- Period: **2013 → present** (~12 yrs)
- Fields: `datetime (IST), open, high, low, close` (volume optional for index)
- Format: CSV or JSON per instrument

### Track B — Intraday OPTION chain (the real gate)
- Instruments: **NIFTY & BANKNIFTY** index options (SENSEX optional)
- Granularity: **1-minute** per contract (tick ideal, 1-min sufficient)
- Strikes: **ATM ± 15 strikes** each side, every expiry (weeklies + monthlies)
- Period: **from weekly launch (NIFTY 2019 / BANKNIFTY 2016) → present**
- **Fields (critical — insist on all):**
  - `datetime, expiry, strike, optionType (CE/PE)`
  - `open, high, low, close` (premium)
  - **`volume`, `openInterest`** ← needed for the OI/volume gate (we have NONE today)
  - **`impliedVolatility`** (or bid/ask so we can compute it)
  - ideally **`bid`, `ask`** ← to model real spread cost (else we assume ~0.5–1 pt)
- Aligned **underlying spot** at each timestamp (or we join from Track A)
- Format: partitioned by date, CSV/Parquet

> If bid/ask and IV are unavailable, buy OHLC+Volume+OI at minimum; we assume a
> conservative spread. Without Volume+OI, the strategy's confirmation gate can
> never be tested — do not buy option data that lacks them.

---

## 4. Where to look (verify current pricing yourself — these change)

Indian intraday historical options vendors to quote:
- **TrueData**, **Global Datafeeds (GDFL)** — intraday + historical F&O.
- **iVolatility**, **AlgoTest / StockMock / Definedge Opstra** — historical
  options backtesting datasets/platforms.
- **NSE historical data** (official, limited intraday depth).
- **Interactive Brokers / Quandl-style** aggregators for the index underlying.

Rough order-of-magnitude (VERIFY — do not treat as quotes): underlying 1-min
multi-year is typically the cheapest tier; full intraday **options** history with
IV/OI over several years is the expensive line item (can run into lakhs depending
on depth and tick vs 1-min). Ask specifically for **weekly-expiry option 1-min
with OI + IV**, not just spot or EOD.

---

## 5. What each purchase will actually prove

| You buy | You can finally answer |
|---|---|
| A (underlying 12yr) | Does the **directional bracket edge** hold across 12 yrs / all regimes? (gross points — still not option-net) |
| B (option intraday, real) | Does the **actual option leg profit after theta + spread + charges**? ← the decision gate for real money |
| A + B | The complete, honest verdict — regime-robust direction AND real option economics |

**Only B answers "will it profit with real money."** A is necessary context and
cheap insurance, but it is not the gate.

---

## 6. Recommended plan

1. **Now (₹0):** I build the backtest harness to the Section-3 spec so it runs
   the day data lands — no waiting, no format surprises. In parallel the paper
   forward-test keeps collecting live evidence.
2. **Cheap first:** buy **Track A** (underlying 12-yr 1-min). I run the
   directional-edge robustness across all regimes immediately — a real result
   for little money, and it tells us whether B is even worth buying.
3. **If A holds:** buy **Track B** (option intraday with OI+IV) for the weekly
   era. I run the true option-net backtest with real spread + charges. This is
   the number that decides real money — no modeling, no guessing.
4. **Only if B clears the gate** (net-of-cost PF > ~1.2 across regimes, tolerable
   drawdown): a tiny capped live pilot, with explicit sign-off.

This spends the least money to kill-or-confirm fastest, in the right order.
