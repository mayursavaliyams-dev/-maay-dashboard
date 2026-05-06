# Antigravity Quant Backtesting Module

## What This Adds

- FastAPI backtesting and paper-trading service under `backend/`
- CSV-first historical data engine for NIFTY, BANKNIFTY, and SENSEX options
- Modular strategy framework with AI-style ranking
- Excel report export with charts and formatted sheets
- Static web UI entry point served by the existing Node app

## Python Packages

Install from the project root:

```bash
python -m pip install -r backend/requirements.txt
```

## Backend Run Command

```bash
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Or from `npm`:

```bash
npm run backtesting:api
```

## Frontend Run Command

This project already uses the existing Node/Express server for the dashboard and static pages.

```bash
npm install
npm start
```

Windows one-click starter:

```bash
start-backtesting-stack.bat
```

Open:

- Existing app: `http://localhost:3000/app.html`
- New backtesting page: `http://localhost:3000/backtesting-pro.html`
- FastAPI docs: `http://localhost:8000/docs`

## CSV Format

Use `backend/backtesting/sample_data_format.csv` as the template. Preferred columns:

- `datetime`
- `index`
- `record_type`
- `expiry`
- `strike`
- `option_type`
- `open`
- `high`
- `low`
- `close`
- `ltp`
- `volume`
- `oi`
- `iv`
- `delta`
- `gamma`
- `theta`
- `vega`
- `spot_open`
- `spot_high`
- `spot_low`
- `spot_close`
- `futures_close`

The loader auto-detects common variants like `date`, `time`, `underlying_price`, `open_interest`, and `strike_price`.

## Upload Historical Data

Example with `curl`:

```bash
curl -X POST "http://localhost:8000/data/upload" ^
  -F "file=@backend/backtesting/sample_data_format.csv"
```

List uploaded datasets:

```bash
curl "http://localhost:8000/data/list"
```

## Run a Backtest

Example request body:

```json
{
  "index": "NIFTY",
  "strategy": "all",
  "start_date": "2006-01-01",
  "end_date": "2026-05-01",
  "capital": 500000,
  "lot_size": 50,
  "stop_loss": 25,
  "target": 40,
  "trailing_sl": 12,
  "timeframe": "5m",
  "brokerage": 40,
  "slippage": 0.3,
  "max_trades_per_day": 3,
  "max_loss_per_day": 25000,
  "max_profit_lock": 50000,
  "capital_allocation": 0.1,
  "dataset_id": "your_uploaded_dataset_id"
}
```

Example:

```bash
curl -X POST "http://localhost:8000/backtest/run" ^
  -H "Content-Type: application/json" ^
  -d "{\"index\":\"NIFTY\",\"strategy\":\"all\",\"timeframe\":\"5m\",\"dataset_id\":\"YOUR_DATASET_ID\"}"
```

## Poll Status and Fetch Output

```bash
curl "http://localhost:8000/backtest/status/JOB_ID"
curl "http://localhost:8000/backtest/result/JOB_ID"
curl -L "http://localhost:8000/backtest/report/JOB_ID" -o report.xlsx
```

## Paper Trading Simulation

Start:

```bash
curl -X POST "http://localhost:8000/paper/start" ^
  -H "Content-Type: application/json" ^
  -d "{\"index\":\"NIFTY\",\"strategy\":\"combined_ai\",\"dataset_id\":\"YOUR_DATASET_ID\"}"
```

Stop:

```bash
curl -X POST "http://localhost:8000/paper/stop"
```

## Dhan Adapter Placeholder

Environment variables are read from your shell or `.env`:

```bash
set DHAN_CLIENT_ID=your_client_id
set DHAN_ACCESS_TOKEN=your_access_token
```

The adapter is a placeholder for:

- historical data
- live market data
- option chain
- paper-order bridge

No live-money execution is implemented in this module.

## Troubleshooting

- `No dataset uploaded yet`: upload a CSV first or pass `data_path`.
- `Only CSV uploads are supported`: upload `.csv` only.
- `ModuleNotFoundError: multipart`: run `python -m pip install -r backend/requirements.txt`.
- Empty results: confirm your CSV includes option rows with `expiry`, `strike`, `option_type`, and candle prices.
- Weak rankings on sample data: the sample CSV is illustrative only. Real 2006-to-latest backtests require your own historical dataset.
