# Antigravity Pro — SENSEX Expiry Bot (Dhan HQ)

AI-powered intraday options trading bot for BSE SENSEX weekly expiries.
Live data, signals, and order execution via **Dhan HQ v2 API** only.

## Features

- Live SENSEX spot + option chain (Dhan `/v2/marketfeed/quote`, `/v2/optionchain`)
- ORB (9:15–9:30) + VWAP breakout strategy
- AI confidence scoring (antigravity logic)
- Semi-auto order placement via Dhan `/v2/orders`
- Real backtest over 200 Friday/Tuesday expiries using Dhan historical option candles
- Web dashboard at `http://localhost:3000`

## Setup

```bash
npm install
```

Fill in `.env`:

```
DHAN_CLIENT_ID=your_dhan_client_id
DHAN_ACCESS_TOKEN=your_dhan_access_token
```

Get credentials from https://web.dhan.co → Profile → Access DhanHQ APIs.

## Run

```bash
# Start live server + dashboard
npm start

# Dev mode (auto-reload)
npm run dev

# Real historical backtest (uses Dhan API)
npm run backtest
```

## Project Layout

```
.
├── server.js                 # Express API + dashboard
├── live-connector.js         # Dhan v2 REST client wrapper
├── strategy.js               # ORB + VWAP breakout logic
├── ai.js                     # Confidence scoring
├── option-analyzer.js        # PCR, Max Pain, Greeks, IV
├── database.js               # SQLite wrapper
├── backtest-real/
│   ├── run.js                # Entry point
│   ├── dhan-client.js        # Rate-limited v2 API client
│   ├── instruments.js        # Scrip master parser
│   ├── expiry-days.js        # 200 expiries w/ Fri→Tue cutover
│   ├── data-fetcher.js       # Disk-cached candle fetcher
│   ├── strategy-runner.js    # Replay strategy on real candles
│   ├── trade-simulator.js    # Entry, SL, target, trailing stop
│   └── aggregator.js         # Win rate, multipliers, stats
├── public/
│   ├── index.html            # Landing page
│   └── dashboard.html        # Live dashboard
└── .env                      # Dhan credentials + risk params
```

## Risk Settings (`.env`)

| Var | Default | Purpose |
|---|---|---|
| `MAX_TRADES_PER_DAY` | 2 | Hard cap per session |
| `CAPITAL_PER_TRADE_PERCENT` | 5 | Position sizing |
| `STOP_LOSS_PERCENT` | 35 | Per-trade SL |
| `TARGET_PERCENT` | 150 | Per-trade target |
| `TRAIL_AFTER_MULTIPLE` | 2 | Start trailing at 2× premium |
| `TRAIL_LOCK_PERCENT` | 50 | Lock 50% of max gain |
| `AUTO_TRADE_ENABLED` | false | Manual confirm vs auto |
| `TRADE_MODE` | paper | `paper` or `live` |

## Backtest Config

| Var | Default | Purpose |
|---|---|---|
| `BACKTEST_NUM_EXPIRIES` | 200 | # of expiry days to test |
| `BACKTEST_INTERVAL` | 5 | Candle interval (minutes) |
| `BACKTEST_STRIKE_OFFSET` | 1 | ATM±N strikes to fetch |
| `SENSEX_EXPIRY_CUTOVER` | 2024-10-28 | Fri→Tue expiry switch date |

## Notes

- BSE SENSEX weekly expiry moved from **Friday → Tuesday** on 2024-10-28. Backtest handles this automatically.
- First backtest run fetches ~200 days of option candles; results are cached in `data/dhan-cache/`.
- `TRADE_MODE=paper` simulates fills; switch to `live` only after reviewing signals manually.
