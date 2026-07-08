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

## Setup (v2 — native GET, no curl)

The v2 script sends via AmiBroker's built-in **`InternetOpenURL`** (a GET) to
`/api/amibroker/push-signal?...` — no curl, no ShellExecute, no console flash, no
quote-escaping, and it works in a **Chart pane OR Analysis Scan/Exploration** (the old
v1 had a `Status("action")==actionIndicator` gate that silently blocked Scan mode — that
was the usual "nothing arrives" cause; removed in v2).

1. The file is already at `C:\Program Files (x86)\AmiBroker\Formulas\Custom\antigravity-bridge.afl`.
2. **`TEST_MODE = True`** is set — it force-sends a CALL on every new bar so you can confirm
   the pipe. Apply it to a NIFTY chart (or Analysis → Scan, Auto-Repeat RT).
3. Watch `GET http://127.0.0.1:3000/api/amibroker/status` → `signalsReceived` should climb.
   In AmiBroker, Tools → **Trace** shows `Antigravity OK → ...` or a FAIL reason.
4. Once it's climbing, set **`TEST_MODE = False`** and replace the SIGNAL LOGIC block with
   your own. Edit `BOT_HOST` if AmiBroker is on a different PC than the bot.

If the Trace shows `InternetOpenURL could not reach ...`: the server isn't running, the
`BOT_HOST` is wrong, or Windows Firewall is blocking port 3000 on the bot machine.

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
