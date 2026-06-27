# MASTER PROMPT — Antigravity Options Trading Bot

> Paste this into another AI assistant as context so it understands the project,
> its strategy, current state, and the rules to work within.

## 1. What this project is
You are assisting on **Antigravity**, an Indian index-options (NIFTI / BANKNIFTY / SENSEX)
algorithmic trading bot. It is a **Node.js** application that connects to a broker for
live market data, runs option-selling and (legacy) directional strategies, and serves a
web dashboard. The system currently runs in **PAPER mode** (no real money) and is being
forward-tested before going live.

- **Language/stack:** Node.js (Express, `ws`, `node-fetch`, `redis`, `yahoo-finance2`).
- **Entry point:** `server.js` (port **3000**). Start with `node server.js` from the **project root**.
- **Frontend:** static HTML in `public/` (dashboard.html is the main UI; command.html, oi.html, etc.).
- **Data connector:** **Upstox** is the active connector (`upstox-connector.js`). Dhan
  (`dhan-client.js`, `dhan-ws-feed.js`) and Kotak (`kotak-neo-connector.js`) remain wired
  as fallbacks inside `live-connector.js` but are NOT the live path.
- **Persistence:** Redis + JSON files in `data/` (e.g. `config-overrides.json`, `opthl/`).

## 2. The core edge (most important)
The bot's real, evidence-backed edge is **selling option premium** (Volatility Risk
Premium / VRP), NOT directional buying.
- **SHORT_STRANGLE / tail-safe iron condor** is the profitable strategy. On 600 days of
  real NSE bhavcopy (2024-01-08 → 2026-06-17): ~91% win rate, robust to 3% per-fill
  slippage. Implemented in `strangle-engine.js` (PAPER, forward-testing).
- **Directional option BUYING has NO edge** — multi-confirm intraday NIFTI backtest:
  profit factor 0.94, net loser (theta bleed). GAP_BUY benchmark: ~2% win. These auto
  engines are intentionally **OFF**.
- Regime nuance: VRP inverts ~25% of days ("always sell vol" is wrong 1-in-4); the engine
  has an IV-percentile gate and a naked→condor tail-safe ladder for high-IV/event regimes.
- The naked-seller tail is the #1 risk: a gap fill past the stop can lose unbounded
  (−₹59k @7x in backtest) → iron-condor wings cap max loss.

## 3. Engine state (persisted across restarts via data/config-overrides.json)
- `STRANGLE_ENGINE_ENABLED: true` — selling forward-test stays ON.
- `NIFTY_DIRECTIONAL_AUTO: false`, `SENSEX_DIRECTIONAL_AUTO: false` — directional autos
  stay OFF (proven losers).
- `TRADE_MODE`: **paper** (do not switch to live without explicit instruction).

## 4. How to run / verify
- Start: `cd <project root> && node server.js`. CORRECT build logs `[server] Using Upstox
  connector` + `[upstox] ✓ connected`; health `mode` = `DATA (Upstox)`.
- Gotcha: there are TWO server.js (root = real Upstox+strangle build; `stock/server.js` =
  separate equity bot on :3100). If health shows `DATA (Dhan)` or `/api/strangle/status`
  404s, the wrong/stale build is running — kill :3000 and restart from the root.
- Health: `GET /api/health`; strategy: `GET /api/strangle/status`; preflight: `node preflight.js`.
- Backtests (real bhavcopy in `bt-data/bhav/`): `node bt-strategies.js` (leaderboard),
  `bt-strangle-costs.js`, `-regime.js`, `-trend.js`, `-tailsafe.js`, `bt-real.js`,
  `bt-nifty-intraday.js`. `bt-bhav-fetch.js` / `bt-fetch-1min.js` are data fetchers (need creds).

## 5. Repo layout (key files)
- `server.js` — Express app, routes, engine wiring, crash-guard.
- `strangle-engine.js` — the profitable premium-selling engine (PAPER only; no live placeOrder yet).
- `execution-engine.js` — directional ORB engine (has live placeOrder, but directional = no edge).
- `upstox-connector.js` / `live-connector.js` — market data + (live) order plumbing.
- `option-analyzer.js`, `gamma-blast-detect.js` — analytics served at `/api/options/*`.
- `position-sizer.js` — margin-aware fractional-Kelly sizing.
- `charges.js` — Indian F&O charges model (always net out of P&L).
- `bt-*.js` — backtests. `postmortem.js` — post-close diagnostic CLI.
- `stock/` — sibling cash-equity bot (port 3100); its real-data backtest path is broken
  (always synthetic) — do not trust its "edge" numbers.
- `deprecated/` — archived dead code (a former duplicate Python FastAPI analytics backend, design screenshots).

## 6. Known gaps / TODO (do not silently "fix" — confirm first)
1. Broker auth **token is expired** — refresh via `/api/dhan/login` (interactive).
2. `strangle-engine.js` has **no live order path** — only paper. Going live needs
   `placeOrder` + margin pre-check + loss-based kill-switch (current auto square-off is EOD-only).
3. `preflight.js` still flags "NIFTY engine armed" as a failure even though NIFTY auto is
   intentionally OFF — stale assertion.
4. Forward-test must pass before any live trading.

## 7. Hard rules for any agent working here
- **Never switch to live trading / place real orders** unless the user explicitly authorizes it.
- Keep everything in **paper** by default; charges + slippage must always be modelled, never hidden.
- Backtests are **daily-resolution** (no intraday tick path) — treat win-rates as ballpark; forward-test before trusting.
- **Selling is the edge; directional buying is not** — don't propose directional auto-trading as a fix.
- Be honest: report losers as losers, failing tests with their output, skipped steps as skipped.
- Don't re-add Telegram to the main bot (it was deliberately removed).
- Prefer the Upstox path; don't rip out Dhan/Kotak fallbacks without care.
