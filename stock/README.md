# Antigravity Stock Bot (cash equity)

Intraday MIS stock-trading bot built to mirror the options bot's architecture
(execution engine, risk guards, paper/live gate, equity persistence, EOD summary,
dark trading-terminal dashboard) — with **equity** logic instead of options:

- Trades a **watchlist of NSE stocks** directly at LTP (no strikes, no premium).
- **Selectable strategy** via the `STRATEGY` env var — the same code path drives
  both live and backtest, so they behave identically:
  - `orb` — Opening Range Breakout (break the first `ORB_RANGE_MINUTES` range + volume)
  - `ema-pullback` — 9/21 EMA trend, enter on a pullback to EMA21 that resumes
  - `vwap-reversion` — fade extreme stretch from VWAP (in both % and ATR terms)
  - `gap-and-go` — trade the opening-gap direction with volume, early in the session
  Strategy code lives in `stock-backtest/strategies/`; pick with `STRATEGY=ema-pullback`.
- Position sizing is **risk-based on SL distance**: `qty = floor(capital × risk% / (entry − SL))`,
  capped at `MAX_POSITION_PCT` of capital.
- SL / target / trailing are **price-percent** moves; intraday positions square off at 15:15 IST.
- **Charges modeled and netted** on every round-trip (brokerage + STT + GST + exchange
  + SEBI + stamp) — equity charges are large and never hidden.
- Same halt layers as the options bot: **daily-loss**, **consecutive-loss**, **drawdown**;
  per-symbol auto flags; manual reset endpoint.
- **Paper mode by default** with a built-in simulated price feed (no broker creds needed),
  so the whole pipeline runs end-to-end for validation. Live mode places real Dhan orders
  and never auto-confirms unless `LIVE_AUTO_CONFIRM=true`.

## Run

```bash
cd stock
cp .env.example .env        # edit as needed (paper works with defaults)
# uses the parent project's node_modules — no separate npm install needed
node server.js              # http://localhost:3100
```

The bot polls/trades only during market hours (09:15–15:30 IST). To exercise it
outside market hours in paper mode, set `PAPER_FORCE_OPEN=true`.

## Live trading (Dhan)

1. **Resolve securityIds** (auto — no manual lookup):
   ```bash
   node equity-resolver.js          # maps WATCHLIST → data/equity-ids.json
   ```
   Downloads Dhan's public scrip master (cached 24h) and writes the symbol→id map.
   A symbol it can't find is reported and skipped for live (paper still works).
2. Set `DHAN_CLIENT_ID` + `DHAN_ACCESS_TOKEN` and `TRADE_MODE=live` in `.env`.
3. **Preflight** before market open — refuses to pass if the token is missing/expired
   or the feed isn't real:
   ```bash
   node preflight.js                # server must be running
   ```
4. Run at least one clean paper session before flipping to live.

## Production ops

- **Token monitor** — decodes the Dhan JWT, warns at ~08:30 IST if it expires within
  2h (and on Telegram). Live auto-entries refuse on an expired token. Status: `GET /api/token-status`.
- **Telegram alerts** — set `TELEGRAM_ENABLED=true` + `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`.
  Sends entry / exit / halt / EOD / startup. Test with `POST /api/telegram/test`.
- **Auto-restart** — `npm run pm2:start` (uses `ecosystem.config.js`); bot auto-starts on boot
  and restores equity + ORB state from disk after a restart.

## Backtest engine

Replays historical 1-min equity candles and trades ORB with the **same** SL/target/
trail/slippage/charges as the live engine (no look-ahead — each decision uses only
the current candle).

```bash
node stock-backtest/run.js --days 60 --windows 4              # default strategy (orb)
STRATEGY=ema-pullback node stock-backtest/run.js --days 60     # backtest a specific strategy
```

Outputs total trades, win rate, profit factor, max drawdown, avg win/loss, expectancy,
exit-reason breakdown (TARGET / STOP_LOSS / TRAIL_STOP / EOD), compounding equity curve,
and a **walk-forward consistency** verdict across windows (ROBUST / REGIME-DEPENDENT /
DO-NOT-USE). Also runnable from the dashboard's **Backtest → Run** button, or
`POST /api/backtest/run`.

- With Dhan creds + `data/equity-ids.json` → uses real equity history (cached in
  `data/stock-backtest-cache/`).
- Without creds → **deterministic synthetic** sessions, clearly flagged. These validate
  the engine, **not** a real edge — never trust synthetic numbers as a strategy result.

## Key endpoints

| Route | Purpose |
|-------|---------|
| `GET /api/health` | mode, bot state, market-open, watchlist |
| `GET /api/watchlist` | per-symbol LTP, ORB, VWAP, signal |
| `GET /api/stock/:sym/position` | open + closed positions |
| `POST /api/stock/:sym/enter` | manual entry (confirm modal) |
| `POST /api/stock/:sym/exit` | manual exit |
| `GET /api/stock/:sym/engine/status` | engine + halt status |
| `POST /api/engine/reset?sym=SYM` | clear a halt |
| `POST /api/engine/halt-all` | disable auto on all symbols |
| `GET /api/risk` | capital, daily-loss, halt layers |
| `GET /api/journal` | combined trade journal + stats |
| `GET /api/eod-summary` | end-of-day P&L (auto-saved 15:35 IST) |
| `POST /api/backtest/run` | run a backtest in the background |
| `GET /api/backtest/report` | last backtest report (metrics + walk-forward) |
| `GET /api/backtest/status` | is a backtest running? |
| `GET /api/token-status` | Dhan JWT expiry status |
| `POST /api/telegram/test` | send a Telegram test alert |

> ⚠️ Backtest profit does not guarantee future profit. Trading involves risk.
> Use paper trading before live. Charges and slippage erode returns.
