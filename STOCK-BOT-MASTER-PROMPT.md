# MASTER PROMPT — Build an Indian STOCK (Equity) Trading Bot

> Copy everything below the line into Claude / your AI to build the bot.
> It encodes hard-won lessons from a working NIFTY/SENSEX options bot.

---

## ROLE & GOAL

You are building a **production-grade intraday + swing STOCK trading bot** for Indian
equity markets (NSE/BSE). Not options — cash equity (delivery + intraday MIS).

Build it with: **Node.js + Express backend, vanilla HTML/CSS/JS dashboard** (no
React, no build step). Broker API: **Dhan** (or Zerodha Kite / Upstox — pick one,
abstract it). Real live data, paper mode first, live mode behind a confirmation gate.

**Do NOT promise profit.** Focus on: backtesting, probability, risk management,
drawdown control, charges-aware sizing, and safe execution.

---

## ⚠️ HARD RULES (learned the painful way — do not violate)

1. **Quality > quantity.** Few high-conviction trades beat many. More trades =
   more brokerage + STT + slippage that silently eat the edge. A strategy with
   45% win rate and 1-2 trades/day beats one with 12% win rate and 18 trades/day.
2. **Charges are real and large.** Model every cost: brokerage (₹20/order or
   0.03%), STT (0.025% sell intraday / 0.1% delivery both sides), exchange txn
   charges, GST, SEBI, stamp duty. A round-trip on ₹10k position ≈ ₹30-50. Over
   200 trades/month that's ₹6-10k — show this in the backtest, never hide it.
3. **No synthetic-price entries.** If the live quote / securityId is missing, SKIP
   the trade. Never fabricate a price. A trade you can't actually place is a
   fantasy P&L that lies to you.
4. **Slippage parity.** Apply the same slippage (e.g. 0.05-0.1% per fill) to BOTH
   live and backtest. If live uses raw LTP but backtest models slippage, live
   results diverge and you'll over-trust the strategy.
5. **Multiple halt layers, always on:** (a) daily loss limit (e.g. 3% of capital),
   (b) consecutive-loss circuit breaker (e.g. 6-8 in a row), (c) peak-to-trough
   drawdown halt (e.g. 15-20%). Each catches a different failure mode.
6. **Validation gate before live money:** at least one clean paper session (zero
   bugs, trades fire + exit as designed) before flipping TRADE_MODE=live. The
   first paper run WILL surface bugs — that's its job.
7. **Compound carefully.** Full compounding maximizes upside but no reserve cushion;
   half-compounding (reinvest 50%, reserve 50%) protects gains. Make it a config
   knob (PROFIT_REINVEST_PCT), default 0.5.
8. **Beware recency bias in backtests.** Test across MULTIPLE time windows (not
   just the most recent). A strategy that shines in one quarter and breaks even in
   three others is NOT robust. Run walk-forward / per-window consistency checks.
9. **Bot loop must auto-start on boot** and survive restarts (persist equity,
   positions, day-state to disk). A late restart must not wipe the day.
10. **Live trade NEVER auto-places** unless an explicit flag (LIVE_AUTO_CONFIRM=true)
    is set. Default: confirmation modal before every live order.

---

## DATA & INSTRUMENTS

- Universe: configurable watchlist of liquid stocks (e.g. NIFTY 50 / NIFTY 100
  constituents). Filter out ASM/GSM/illiquid/circuit-locked names daily.
- Feed: broker REST `/charts/intraday` (1-min candles) + WebSocket live ticks.
  Fall back to a free source (NSE/Yahoo) only for display, never for order pricing.
- Caveat to handle: brokers purge historical data for delisted symbols; intraday
  history is limited (~3-6 months at 1-min). Plan backtest data accordingly.

---

## STRATEGY (stock-specific — these are starting points, BACKTEST before trusting)

Stocks differ from options: **no theta decay, no expiry, can hold overnight.**
Trends persist longer; mean-reversion works on liquid large-caps.

Implement these as selectable strategies, each backtested independently:

1. **ORB (Opening Range Breakout)** — first 15-min range; long on break above with
   volume, short below. Intraday MIS, square off by 15:15.
2. **EMA trend + pullback** — 9/21 EMA stack for trend; enter on pullback to 21 EMA
   that resumes. Hold intraday or swing.
3. **VWAP reversion** — fade extreme deviations from VWAP on range-bound days.
4. **Multi-timeframe alignment** — 15-min trend + 5-min confirm + 3-min entry
   (CAUTION: backtest showed marginal/regime-dependent edge — verify hard).
5. **Gap-and-go** — trade direction of opening gap if volume confirms.

For EACH strategy, the engine must compute and log the ENTRY REASON
("BUY because EMA bullish + VWAP support + volume 1.4x avg + break ORB high").

### Position sizing
- Risk per trade: 1-2% of available capital (NOT fixed lots).
- `qty = floor((capital * riskPct) / (entry - stopLoss))` then round to lot/1.
- Cap position notional (e.g. ≤ 25% of capital in one name).
- Stop loss in PRICE POINTS (e.g. entry - 1%), not premium %.

### Exits
- Initial SL (e.g. -1% to -2% of entry).
- Target 1 (+1.5%), Target 2 (+3%), or ATR-based.
- Trailing SL after +1% (lock 60-70% of peak gain).
- Square-off intraday positions before close (15:15 IST).
- Trend-reversal exit, VWAP-break exit.

---

## DASHBOARD (vanilla HTML/JS, dark "trading terminal" theme)

- Top: market status bar + risk warning banner ("Backtest profit ≠ future profit").
- Watchlist table: LTP (flash green/red on change), %chg, volume, VWAP, signal.
- Per-stock detail: candlestick (embed TradingView widget) + your overlays.
- Panels (responsive grid, no horizontal overflow):
  - Auto Entry/Exit engine state (live decision tree + reason)
  - Open positions + live P&L
  - Capital + compounding tracker (active / reserved / available)
  - Risk guard (daily loss, consec losses, drawdown — all 3 with live values)
  - Trade journal (auto-saved: time, symbol, entry, SL, target, qty, reason, P&L)
  - Backtest summary + strategy ranking
  - EOD summary (auto at 15:35: trades, win rate, P&L, charges paid)
- Trade confirmation modal (entry, SL, T1, T2, qty, capital used, max loss,
  R:R ratio, charges estimate, mode). Disable confirm if R:R < 1:1.5 or
  validation fails. Live mode = extra red warning.

---

## BACKTEST ENGINE (the heart — be rigorous)

- Replay historical 1-min candles per symbol; simulate entry → hold → exit with
  the SAME SL/target/trail logic as live.
- **Include ALL charges + slippage.** Output net P&L, not gross.
- No look-ahead: each decision uses only data available at that candle.
- Per-strategy, per-symbol, per-window results.
- Output: total trades, win rate, profit factor, max drawdown, avg win/loss,
  Sharpe (if feasible), best/worst day, exit-reason breakdown (how many SL vs
  trail vs target — this reveals if the edge is real).
- **Walk-forward**: optimize on one window, test on the next unseen window. If it
  only works in-sample, mark "OVERFIT — do not use live."
- **Consistency check**: run the same strategy across 4+ separate windows. Report
  win rate per window. If it swings wildly, the edge is regime-dependent.
- Capital + compounding simulation: ₹X start, configurable reinvest %, lot
  ceiling, halt layers — show the equity curve and reserve curve.

---

## RISK MANAGEMENT (non-negotiable)

```
riskPerTrade   = availableCapital * 0.02        # 2% max
dailyLossLimit = availableCapital * 0.03        # 3% halt
dailyTarget    = availableCapital * 0.05        # optional: stop after hit
maxDrawdown    = 0.20                            # 20% peak-to-trough halt
maxConsecLoss  = 8                               # circuit breaker
```
- On any halt → disable auto-trading until manual reset endpoint is called.
- Per-instrument enable flags (don't let a global flag re-enable a disabled name).
- Reject trade if: spread too wide, data stale/delayed, API error, circuit-locked,
  or capital/risk limits invalid.

---

## CONFIG (.env — gitignored, never commit secrets)

```
BROKER=dhan
DHAN_CLIENT_ID= / API_KEY= / API_SECRET= / ACCESS_TOKEN=
TRADE_MODE=paper                 # paper | live
LIVE_AUTO_CONFIRM=false
CAPITAL_TOTAL=100000
RISK_PER_TRADE_PCT=2
MAX_DAILY_LOSS_PERCENT=3
MAX_DRAWDOWN_PERCENT=20
MAX_CONSECUTIVE_LOSSES=8
MAX_TRADES_PER_DAY=3             # keep low — charges!
PROFIT_REINVEST_PCT=0.5          # 0.5 half-compound, 1.0 full
SLIPPAGE_PERCENT=0.1
ENTRY_WINDOW_START=09:31
ENTRY_WINDOW_END=14:30
SQUARE_OFF_TIME=15:15
WATCHLIST=RELIANCE,HDFCBANK,INFY,TCS,...
```

---

## OPERATIONS

- Token refresh: broker JWT expires daily — monitor expiry, warn before market open,
  one-click re-auth endpoint. (Generating a new token may invalidate the old one →
  always restart after refresh.)
- pm2 / systemd for auto-restart; deploy script for a VPS (note: NSE blocks
  datacenter IPs, so a free NSE fallback won't work on cloud — rely on broker API).
- Logs + EOD JSON snapshot per day.

---

## DELIVERABLES (build in this order)

1. Broker connector (auth, quote, chart, order, positions) + paper-order simulator.
2. One strategy (ORB) end-to-end: signal → sizing → entry → exit → journal.
3. Backtest engine with charges + slippage + halt layers + equity curve.
4. Consistency / walk-forward validation.
5. Dashboard panels.
6. Risk guard + confirmation modal.
7. EOD summary + token monitor + auto-start.
8. Additional strategies, each backtested before wiring live.

**Test on desktop + tablet + mobile. No horizontal overflow. Dark premium UI.**

Add this warning permanently on the dashboard:
> "Backtest profit does not guarantee future profit. Trading involves risk.
> Use paper trading before live trading. Charges and slippage erode returns."
