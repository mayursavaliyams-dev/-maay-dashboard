# Ops Playbook — Antigravity Pro (paper index-options bot)

> Runbook for **operating** the bot. 100% PAPER — no live orders are placed by any engine.
> For strategy/dashboard usage see [TRADER-PLAYBOOK.md](TRADER-PLAYBOOK.md).

## 1. Run / restart

```bash
# from the PROJECT ROOT (not stock/) — the Upstox build has the strangle + signal routes
node server.js                 # foreground
# or background (Windows): start it detached and tail the log
```

- Port: `3000` (env `PORT`). Home page `/` serves `public/dashboard.html`.
- Liveness: `GET /healthz` → `{status:"ok", bootId, uptimeSec}`. `bootId` changes on every restart — the dashboard auto-reloads when it changes (stale-server guard).
- **Kill a stale server on 3000** (Git Bash):
  ```bash
  for pid in $(netstat -ano | grep ':3000' | grep LISTENING | awk '{print $NF}' | sort -u); do taskkill //F //PID $pid; done
  ```
- After editing `server.js` you MUST restart. Editing `public/*.html` needs only a browser refresh (HTML is served no-cache).
- Known trap: a second copy under `D:\BACKUP\...` used to auto-start via a scheduled task and serve an OLD dashboard. It is disabled (`Disable-ScheduledTask Expiry5x-AutoStart`). If the old UI reappears, that task is back — disable it and kill the stale PID.

## 2. Engine state (persists across restarts)

`data/config-overrides.json` holds the ON/OFF state of every engine (applied last in `app.listen`, so env can't override it). Toggle via the APIs, not by editing env:

| Engine | Enable API | Status API |
|---|---|---|
| Condor/VRP strangle | `POST /api/strangle/enable {enabled}` | `/api/strangle/status` |
| Gamma-blast (expiry buying) | `POST /api/gamma-blast/enable {enabled}` | `/api/gamma-blast/status` |
| AI agents (news→paper) | `POST /api/agents/enable {enabled}` | (in `/api/quant`) |
| Signal-engine paper loop | `POST /api/signal-paper/enable {enabled}` | `/api/signal-paper/status` |
| Event-risk filter | (always on) | `/api/event-filter` |

## 3. Daily health checks (open the dashboard, or curl)

1. `GET /healthz` → ok + recent `uptimeSec`.
2. Dashboard header dots: bot running (green), data source live.
3. `GET /api/signal-paper/status` → enabled, open positions, all-time P&L.
4. `GET /api/signal-health` → HEALTHY / LEARNING / DEGRADED. **DEGRADED = the model is miscalibrated or edge is decaying — stand down / investigate.**
5. `GET /api/forward-test-report` → INSUFFICIENT / PASS / FAIL (the gate).
6. Market session sanity: engines only OPEN new positions during market hours (09:15–15:30 IST, Mon–Fri). Outside hours they idle (correct).

## 4. Data files (JSON, under `data/`)

| File | What |
|---|---|
| `config-overrides.json` | engine on/off state |
| `signal-paper-positions.json` | signal-engine paper open + closed trades |
| `signal-outcomes.json` | signal-health calibration outcomes |
| `vrp-monitor.json` | net-of-cost VRP daily samples |
| `gex-vix-history.json` | daily GEX/VIX/realized-vol rows (#4 backtest input) |
| `event-calendar.json` | **user-maintained** scheduled high-impact events (RBI/Budget/…) |
| `ai-agents-trades.json` | AI-agent paper ledger |
| `opt-candles/`, `opthl/` | recorded option premium candles + high/low archive |

Back these up before any risky change. They are the forward-test record.

## 5. Tests & verification

```bash
npm test                       # runs every test/*.test.js (should be all green)
node bt-validate.js            # re-runs the strangle backtest through the validation gauntlet
node bt-gex-vs-vix.js          # GEX-vs-VIX analysis once ~20+ daily rows exist
```

## 6. Incident response

- **Dashboard shows old/wrong data** → stale server. Kill PID on 3000, confirm the scheduled task is disabled, restart from project root.
- **`signal-health` DEGRADED** → the calibration drifted or edge decayed. Disable auto opens (`/api/signal-paper/enable {enabled:false}`), read the reasons, re-validate with `bt-validate.js` before re-enabling.
- **A paper P&L looks wrong** → open the dashboard "Positions & P&L verification" panel; it re-computes each trade from entry/exit×lot−charges and reconciles the sum against the headline (✓ or ⚠).
- **Server won't boot** → `node -c server.js` for syntax; check the log tail; a bad `config-overrides.json` or data file can be deleted (engines fall back to defaults).

## 7. Golden rules

- Everything is **PAPER**. Do not wire live order placement without: a PASS forward-test report, a re-check of SEBI algo/RA rules, and an explicit decision.
- Commit engine/logic changes; restart; verify `/healthz` bootId changed and the panel you touched renders.
- Never trust a single backtest — the edge is cost-control + regime-timing + risk-management, proven by forward-test, not a fancier signal.
