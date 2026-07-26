# Antigravity Pro

Live index-options trading workstation for NIFTY, SENSEX, and BANKNIFTY. The
project combines a Node/Express dashboard server, broker connectors, paper/live
execution gates, AmiBroker signal ingestion, Python option analytics, and
long-horizon backtesting.

## Setup

```bash
npm install
```

Copy `.env.example` to `.env` and configure broker credentials. Never commit
`.env`.

## Run

```bash
npm start
```

Open `http://localhost:3000/dashboard.html`.

Optional commands:

```bash
npm run dev
npm run preflight
npm run analytics:api
npm test
```

## Main Components

- `server.js`: Express API and dashboard server
- `live-connector.js`, `upstox-connector.js`, `kotak-neo-connector.js`: broker market data / order adapters
- `execution-engine.js`: Paper and live execution
- `strategy.js`: Signal logic
- `option-analyzer.js`: Options analytics
- `public/`: Dashboard pages
- `options_algo_api.py`: FastAPI options webhook / execution API
- `options_algo_dashboard.py`: Streamlit options helper dashboard
- `antigravity-py/`: newer FastAPI/paper-engine modules
- `amibroker/`: AFL signal push templates
- `backtest-tv/` and `backtest-real/`: 1200-expiry backtest runner and helpers

Keep `TRADE_MODE=paper` until the setup has been validated.

## Production Safety Checklist

Before exposing the dashboard outside localhost:

```ini
AUTH_ENABLED=true
AUTH_SECRET=<64+ random chars>
AUTH_ADMIN_USER=admin
AUTH_ADMIN_PASS=<strong password>
AUTH_COOKIE_SECURE=true
TRADE_MODE=paper
```

Use HTTPS through Nginx/Cloudflare before setting `AUTH_COOKIE_SECURE=true`.
Refresh the broker token before market hours and verify:

```text
GET /healthz
GET /api/health
GET /api/selftest
GET /api/dhan/token-status
```

## AmiBroker Signals

The bridge accepts AmiBroker-generated signals at:

```text
GET  /api/amibroker/push-signal?key=antigravity&inst=NIFTY&sig=CALL&conf=75
POST /api/amibroker/signal
```

Use `amibroker/Signal-Push-Template.afl` as the starting AFL file. Replace
`MyCallSignal` and `MyPutSignal` with your strategy rules.
`signal-heatmap.html` reads `/api/amibroker/signals?inst=NIFTY` so all recent
NIFTY signal strikes are highlighted together.

Incoming AmiBroker signals are persisted by IST day in
`data/ami-signals/ami-signals-YYYY-MM-DD.jsonl`. Use date/time filters to review
a session:

```text
GET /api/amibroker/signals?inst=NIFTY&date=2026-06-17&from=09:30&to=15:30&limit=500
GET /api/amibroker/backtest?inst=NIFTY&date=2026-06-17&from=09:30&to=15:30
```

The day backtest is a signal-to-signal replay. It uses `premium` / `optionPrice`
from the AmiBroker payload when present; otherwise it uses the AFL `price` field
as spot-points replay.

Signals are display-only by default. To let AmiBroker trigger the execution
engine, set `AMIBROKER_AUTO_TRADE=true` after paper testing. Live orders also
require `TRADE_MODE=live` and `AMIBROKER_ALLOW_LIVE=true`.

## Python Options Algo Dashboard

`options_algo_dashboard.py` is a Streamlit dashboard and CLI helper for NIFTY,
BANKNIFTY, and SENSEX option buying.

```bash
pip install -r requirements-options-dashboard.txt
streamlit run options_algo_dashboard.py
```

Paper mode is the default. Live broker orders are blocked unless
`LIVE_TRADING=true`.

Useful commands:

```bash
python options_algo_dashboard.py webhook --host 0.0.0.0 --port 8090
python options_algo_dashboard.py once --index NIFTY --trend BULLISH
```

On this Windows machine, if the Microsoft Store Python alias interferes, use:

```powershell
& "C:\Users\Admin\AppData\Local\Python\bin\python.exe" -m uvicorn options_algo_api:app --host 0.0.0.0 --port 8091 --reload
```

Webhook payload example:

```json
{"trend":"BULLISH","source":"pine"}
```

Accounting logs are written to `logs/tally_trades.csv` and
`logs/tally_trades.jsonl`.

### Options Algo REST API

Backend-only API for an existing frontend:

```bash
python -m uvicorn options_algo_api:app --host 0.0.0.0 --port 8091 --reload
```

Endpoints:

```text
GET  /api/option-chain?index=NIFTY&trend=BULLISH
GET  /api/target-premium?index=NIFTY&trend=BULLISH
POST /api/webhook-signal
POST /api/execute-trade
GET  /api/tally-logs
```

`/api/option-chain` returns `rows[].is_target_strike` and
`rows[].ce/pe.is_target_option` so the frontend can highlight exactly one
selected strike. Trade execution remains dry-run unless `LIVE_TRADING=true`.

## Backtesting Data

Restored long-horizon data lives at:

```text
backtest-tv-results-nifty.json      # 1200 expiries
backtest-tv-results-sensex.json     # 1200 expiries
backtest-tv-results-banknifty.json  # 1423 expiries
```

Run a fresh Yahoo/TradingView-style backtest:

```powershell
$env:BACKTEST_INSTRUMENT='SENSEX'
$env:BACKTEST_NUM_EXPIRIES='1200'
node backtest-tv/run.js
```

Excel exports are generated under `exports/` and are intentionally gitignored.
