# MASTER PROMPT (PYTHON BUILD) — Antigravity Options Trading Bot

> Paste this into an AI coding assistant to build a **Python** version of the bot.
> It is a self-contained spec: identity, architecture, the strategy edge, the
> Python stack to use, and the hard rules. Build incrementally, paper-first.

## 0. Your role
You are building **Antigravity-Py**, an Indian index-options (NIFTY / BANKNIFTY /
SENSEX) algorithmic trading bot in **Python**. It connects to a broker for live
data, runs an **option-selling** strategy with a web dashboard + REST API, and
runs in **PAPER mode** (no real money) until forward-tested. Port the design
below; do not invent a new strategy.

## 1. Python tech stack (use these)
- **API/server:** FastAPI + Uvicorn (single app, port 8000). Pydantic models for I/O.
- **Async HTTP:** `httpx` (async). **WebSocket:** `websockets` or the broker's SDK feed.
- **Broker:** Upstox (`upstox-python-sdk`) as the live connector; keep the connector
  behind an abstract `MarketConnector` interface so Dhan/Kotak can be added as fallbacks.
- **Cache/state:** `redis` (redis-py) + JSON files on disk for persisted config/state.
- **Scheduling:** APScheduler (market-hours loops, EOD square-off).
- **Data/maths:** `pandas`, `numpy`, `scipy` (Black-Scholes greeks, percentiles).
- **Config:** `pydantic-settings` / `.env`. **Logging:** `logging` + a crash-guard
  (catch unhandled exceptions, log to `data/crash.log`, keep serving in paper).
- **Tests:** `pytest`.

## 2. The core edge (most important — build for THIS)
The bot's real, evidence-backed edge is **selling option premium** (Volatility Risk
Premium / VRP), NOT directional buying.
- **SHORT_STRANGLE / tail-safe iron condor** is the profitable strategy: on 600 days
  of real NSE bhavcopy, ~91% win rate, robust to ~3% per-fill slippage. This is the
  primary engine.
- **Directional option BUYING has NO edge** (profit factor ~0.94, net loser — theta
  bleed). Do NOT make directional auto-trading the main strategy; if you implement it,
  keep it OFF by default and clearly flagged as low-edge.
- Regime nuance: VRP inverts ~25% of days, so gate entries by **IV percentile** (sell
  only when premium is genuinely rich) and use a **naked→iron-condor ladder**: skip
  when IV is low, sell a naked strangle in normal IV, switch to a defined-risk condor
  when IV percentile is very high / event risk (the condor caps the tail loss).
- The #1 risk is the naked-seller tail: a gap fill past the stop loses unbounded;
  iron-condor wings cap max loss. Always model this.

## 3. Components to build (mirror the Node design)
- `connectors/` — `MarketConnector` ABC + `UpstoxConnector` (quotes, option chain,
  place_order, ws feed). Stub `place_order` in paper mode.
- `engines/strangle_engine.py` — the premium-selling engine: pick ATM±~1.5% legs,
  IV-percentile gate, naked/condor tail-safe ladder, 2x leg stop, defensive adjust
  before the stop, take-profit %, hold-to-expiry, weekly re-entry. **Paper first.**
- `engines/execution_engine.py` (optional) — directional ORB engine; OFF by default.
- `analytics/` — option greeks (Black-Scholes), gamma-blast, OI/IV analysis, PoP.
  Exposed at `/api/options/{analytics,greeks,gamma-blast,oi-analysis,iv-analysis}`.
- `sizing/position_sizer.py` — margin-aware **fractional-Kelly** sizing, VIX-scaled
  (full Kelly is too aggressive; 1L cannot fund a naked NIFTY strangle ~1.3L/lot,
  condor ~15k/lot).
- `charges.py` — Indian F&O charges (brokerage, STT, GST, exchange, SEBI, stamp).
  **Always** net charges + slippage out of P&L; never hide them.
- `backtest/` — daily-resolution backtests on real NSE bhavcopy (entry = day open,
  exit = expiry close or stop vs day high/low). Mirror: strategies leaderboard,
  cost-stress (slippage sweep), regime filter, trend overlay, tail-safe stress.
- `api/` (FastAPI routes): `/api/health`, `/api/strangle/status`, `/api/strangle/enable`,
  `/api/options/*`. Serve a static dashboard.
- State persistence: a `config-overrides.json` applied LAST at startup so env can't
  override engine on/off state across restarts.

## 4. Operational rules / defaults
- `TRADE_MODE=paper` by default. Engine defaults: strangle ENABLED, directional autos
  DISABLED. Auto square-off at 15:15–15:25 IST; add a **loss-based kill-switch**
  (daily loss cap), not only EOD.
- Health must clearly report connector, mode (paper/live), and token validity.
- Forward-test in paper before any live trading.

## 5. Hard rules for the build
- **Never place real orders / switch to live** unless the user explicitly authorizes it.
- **Selling is the edge; directional buying is not** — don't propose directional as the fix.
- Charges + slippage are always modelled; backtests are daily-resolution (treat
  win-rates as ballpark; forward-test before trusting).
- Be honest: report losers as losers, failing tests with output, skipped steps as skipped.
- Build incrementally: connector → analytics → backtest (validate edge) → paper engine
  → forward-test → (only then, on explicit ask) live order path with margin pre-check
  and kill-switch.

## 6. Reference behaviour (from the working Node bot, to match)
- Real bhavcopy backtest leaderboard: SHORT_STRANGLE ~91% win; IRON_CONDOR lower return
  but capped risk; GAP_BUY (directional) ~2% win = loser.
- Edge survives 3% per-fill slippage (+net positive). Naked tail at 7x gap fill goes
  deeply negative — condor cap justified.
- Greeks for SENSEX use Black-Scholes breakeven PoP; NIFTY/BANKNIFTY can use broker PoP.
