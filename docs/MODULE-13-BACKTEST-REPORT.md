# Module 13/14 — White-Box Backtest Report

Turns the existing real-bhavcopy backtest ledger into an institutional-grade,
**white-box** performance report. This is the **trust + SEBI-compliance
cornerstone**: every number is computed from real per-trade P&L, the exact
strategy rules are disclosed, and an honest-limitations disclaimer is attached.

> Why this first: the competitive research found the market leader (Sensibull)
> has **no backtesting**, and SEBI's 2026 framework makes **white-box disclosure
> mandatory**. We already had the validated edge — this productizes it.

## Metrics (all from real per-trade P&L)

- **Returns:** net, expectancy (₹ and R%), avg win / avg loss, profit factor, CAGR
- **Risk-adjusted:** Sharpe, Sortino (annualised by trades/year)
- **Drawdown:** max drawdown % + duration (trades underwater)
- **Distribution:** win rate, best/worst trade, max win/loss streaks
- **Equity curve:** per-trade `{date, pnl, equity, ddPct}` for charting
- **Breakdowns:** by year and by month
- **Loss ledger:** every losing trade, listed (nothing hidden)
- **White-box rules:** the exact entry/exit/cost/resolution of each strategy
- **Disclaimer:** past-performance, paper/educational, daily-resolution tail caveat, not advice

## API

```
GET /api/backtest/report?strategy=SHORT_STRANGLE   # full report (default strategy)
GET /api/backtest/report?all=1                     # leaderboard of all strategies' headline metrics
GET /api/backtest/report?strategy=...&capital=100000
```
Reads `bt-data/result-strategies.json` (produced by `bt-strategies.js`). Strategies:
SHORT_STRANGLE, SHORT_STRADDLE, IRON_CONDOR, EXPIRY_STRADDLE, GAP_BUY.

## Honesty by design

- **White-box:** `whiteBox` returns the literal rules used (entry/exit/costs/resolution).
- **Daily-resolution caveat:** the disclaimer states the 2× clean-stop assumption and that
  intraday gaps can understate tail losses (matches the tailsafe finding).
- **Losers shown as losers:** GAP_BUY (option buying, 2% win) is reported honestly, not hidden.

## Tests

`test/backtest-report.test.js` — 23 assertions (counts, win rate, PF, expectancy,
exact 4.55% drawdown, Sharpe/Sortino sign, equity curve, white-box disclosure,
disclaimer, all-loss series, empty guard). `npm test`.

## Files

- `backtest-report.js` — pure metrics engine (no I/O).
- `server.js` — `GET /api/backtest/report`.
