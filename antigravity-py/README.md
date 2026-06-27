# Antigravity-Py

Python (FastAPI) port of the Antigravity options bot. **Paper-first.** The Node bot
keeps running; this is a parallel greenfield build per `../MASTER_PROMPT_PYTHON.md`.

## What's built (Phase 1)
- `app/analytics/black_scholes.py` — greeks, IV solver, **breakeven PoP** — a faithful
  port of `option-analyzer.js` (same normal-CDF approximation → PoP values match the
  Node dashboard). Pure stdlib, fully tested.
- `app/charges.py` — Indian F&O charges + slippage (always netted out of P&L).
- `app/connectors/` — `MarketConnector` ABC + async `UpstoxConnector` (httpx).
  `place_order` is a stub in paper mode.
- `app/engines/strangle_engine.py` — premium-selling engine skeleton (the validated edge).
- `app/main.py` — FastAPI: `/api/health`, `/api/options/analytics`, `/api/options/greeks`,
  `/api/strangle/status`, `/api/strangle/enable`. Global crash-guard → `data/crash.log`.

## Run
```bash
cd antigravity-py
python -m venv .venv && . .venv/Scripts/activate   # Windows; use .venv/bin/activate on *nix
pip install -r requirements.txt
cp .env.example .env        # add UPSTOX_ACCESS_TOKEN for live data (optional)
uvicorn app.main:app --port 8000 --reload
```
- Offline (no token): `GET /api/options/greeks?S=24050&K=24100&sigma=0.14&kind=CE` works.
- With token: `GET /api/options/analytics?inst=NIFTY` returns the live chain + PoP + PCR.

## Test
```bash
pytest -q
```

## Roadmap (next phases, per the master prompt)
1. **Backtest** (`backtest/`) on real NSE bhavcopy — validate the selling edge in Python
   *before* trusting the engine (math must match the Node leaderboard: SHORT_STRANGLE ~91% win).
2. **Strangle engine** entry/adjust/exit ladder (IV-percentile gate, naked→condor tail-safe).
3. **Sizing** — margin-aware fractional-Kelly, VIX-scaled.
4. **Serve the existing dashboard** (FastAPI static) — no frontend rewrite needed.
5. Live order path — only on explicit authorization, with margin pre-check + kill-switch.

## Safety
`TRADE_MODE=paper` by default · selling is the edge (directional buying has none) ·
charges + slippage always modelled · never place real orders without explicit opt-in.
