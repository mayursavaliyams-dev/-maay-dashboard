# AmiBroker → Antigravity bridge

The bot receives AmiBroker signals at **`POST /api/amibroker/signal`** and it works —
verified end-to-end (receive, validate, dedup, store, aggregate). If signals aren't
arriving, the problem is on the **AmiBroker side** (not running / wrong URL / wrong
format), not the bot.

## The one rule the bot enforces

The signal MUST carry a **`signal` field = `CALL` / `PUT` / `WAIT`** (aliases: `sig`,
`side`, `direction`; `CE`→CALL, `PE`→PUT). A payload with `action:"BUY"/"SELL"` and no
`signal` is **rejected as `invalid_signal`** — this is the usual reason a working-looking
AFL sends nothing that lands.

### Accepted payload (verified)
```json
POST http://<bot-host>:3000/api/amibroker/signal
Content-Type: application/json
{ "signal":"CALL", "instrument":"NIFTY", "confidence":75,
  "strike":24450, "price":24450, "strategy":"AFL_EMA", "barId":"123" }
```
No auth by default. `instrument` ∈ {NIFTY, SENSEX, BANKNIFTY}.

## Setup

1. Copy [`antigravity-bridge.afl`](antigravity-bridge.afl) into AmiBroker's `Formulas`
   folder. Add it to a chart, or run it in **Analysis → Scan/Exploration** with
   **Auto-Repeat (Real-Time)** on.
2. Edit `BOT_URL` — `127.0.0.1:3000` if AmiBroker is on the same PC, else the bot
   machine's LAN IP (open port 3000 on that machine).
3. Replace the **SIGNAL LOGIC** block with your own strategy; keep the send plumbing.
4. It sends at most once per new bar per symbol (CALL/PUT only unless `SEND_WAIT=True`).
   Uses `curl.exe` (built into Windows 10/11) — no ActiveX, no installs.

## Verify it's landing

- `GET /api/amibroker/status` → `stats.signalsReceived` should climb; `lastSignalAt` set.
- `GET /api/amibroker/signals-all` → recent signals list.
- Live page: **`/ami-heatmap.html`**.

## Important: signals are logged, NOT auto-traded (by design)

`autoTrade` is **false** (`AMIBROKER_AUTO_TRADE`), so signals are stored/shown but do NOT
place paper trades. To let them execute, set `AMIBROKER_AUTO_TRADE=true` in `.env` and
restart — and only when you actually want that. Everything stays paper.

## Quick manual test (no AmiBroker needed)

```bash
curl -X POST http://127.0.0.1:3000/api/amibroker/signal \
  -H "Content-Type: application/json" \
  -d '{"signal":"CALL","instrument":"NIFTY","confidence":80,"strike":24450,"price":24450}'
# → {"ok":true,...}   and status.signalsReceived increments
```
