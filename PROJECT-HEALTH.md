# Project Health & Best-Next Improvements

_Full-program audit + cleanup, 2026-06-21. Snapshot of what's clean, what's left, and the best next steps._

## ✅ Done in this cleanup
- **Repo bloat removed:** tracked files **18,446 → 117** (99.4%). Untracked 18,213 regenerable API caches (`data/dhan-cache-*`, `sweep-cache`), old `backend/`, `backtest-real/`, `__pycache__`, and ~100 stale one-off scripts/outputs (already gone from disk). Runtime state (`market-state`, `prices`, `signals`, `trades`, `candles`, `optionchain`, `equity-*`, `eod-*`) untracked but kept on disk; `.gitignore` updated so none come back.
- **Orphan pages dropped:** `index.html` (duplicate of the default `command.html`), `multi-heatmap.html`, `multi-heatmap-compact.html` — all zero inbound links.
- **Verified clean:** 0 root-`.js` orphans (all 37 are active modules or standalone backtest/util tools); all 7 npm deps used; server healthy (Upstox); default route + active pages serve 200.

## ✅ Extras removed (round 2, user-approved)
Removed 6 pages that formed a disconnected subgraph — **zero links from the active app**, so no dead links left behind: `app.html`, `terminal.html`, `site.html`, `chain-trend.html`, `chain-visual.html`, `indicators.html`.

**Active app is now 10 pages:** `command.html` (default) · `command-pro.html` · `trade.html` · `dashboard.html` (hub) · analysis ring (`ami-heatmap`, `heatmap`, `pop`, `signal-heatmap`, `strategy`, `strike-history`).

## 🔧 Optimization opportunities (do incrementally — it's a live bot)
1. **`server.js` is a 215 KB monolith.** Split routes into modules (`routes/options.js`, `routes/strangle.js`, `routes/health.js`) over time. High value, medium risk — do one slice at a time with the server running.
2. **Three broker connectors** (`dhan-client`, `kotak-neo-connector`, `upstox-connector`) — extract a shared `Connector` interface to cut duplication and make swapping providers trivial.
3. **Trade history in flat JSON** — fine now; move to the existing SQLite (`database.js`) if the log grows large.
4. **Backtest scripts (`bt-*.js`)** share `loadDay`/`leg`/`atmStrike`/sizing copy-paste — extract a tiny `bt-lib.js` so all six reuse one loader.

## 🎯 Strategy status — the real "best possibility"
The evidence-backed roadmap (see `memory/project_strategy_research.md`) is **fully built in paper**:
- Tier-1: cost-net validated · IV-percentile regime filter · tail-safe condor ladder
- Tier-2: margin-aware fractional-Kelly + IV-scaled sizing
- Tier-3: optional trend kill-switch + defensive ADJUST signal

**Next is NOT more features — it's forward-testing.** Enable the strangle engine in paper (`STRANGLE_ENGINE_ENABLED=true`), let it collect live regime/sizing/hit-rate data for a few weeks, then review before ever going live. The bot's edge is the volatility-risk-premium; the game is cost-control + regime-timing + risk-management + discipline — all now wired.
