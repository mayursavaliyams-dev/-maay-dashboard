# 085 — Two Keys For Every Live Path

**Session:** 2026-07-31. **No deployment.** Code and configuration only.
**Verification:** `npm test` **84/84** · `node test/estate-boundary.test.js`
**92 assertions** · `py -m pytest tests/ -q` **11 passed**
**Nothing committed.**

---

## Task 3 — where the second key was missing

Measured from the working tree and the real `.env`.

| # | Order-capable path | KEY 1 · capability | KEY 2 · live permission | Defaults | Currently set | **What single change makes it send live?** |
|---|---|---|---|---|---|---|
| 1 | `execution-engine.js:709` — options entry | `NIFTY_AUTO_ENABLED` / `AUTO_TRADE_ENABLED` **+** `TRADE_MODE` | **NONE** | `TRADE_MODE` → paper | `AUTO=true`, `NIFTY=true`, `TRADE_MODE=paper` | **`TRADE_MODE=live` — ONE VARIABLE** |
| 2 | `afternoon-engine.js:658` | same | **NONE** | same | same | **`TRADE_MODE=live` — ONE VARIABLE** |
| 3 | `server.js:2077` `/api/trade/execute` | `botRunning` + daily trade count | **NONE** | — | bot autostarts | **`TRADE_MODE=live` — ONE VARIABLE** |
| 4 | `server.js:8037` TradingView webhook | `TRADE_MODE` + `live.connected` | **NONE** | — | — | **`TRADE_MODE=live` — ONE VARIABLE** |
| 5 | `limit-order-engine.js:281/284/349/370` | `EXEC_ENGINE_ENABLED` (false) | `EXEC_PAPER_MODE` (true) | both safe | both unset | two keys — already correct |
| 6 | `amibroker-bridge.js:623` | `AMIBROKER_AUTO_TRADE` (false) | `AMIBROKER_ALLOW_LIVE` (false) | both safe | key 1 **true**, key 2 unset | two keys — the model |
| 7 | `flatten.js:128` | reducing order — deliberately unconditional | n/a | n/a | n/a | n/a — an exit must never be blocked |
| 8 | `stock/stock-engine.js:387,508` | `STOCK_TRADE_MODE` | **`STOCK_ALLOW_LIVE`** ← new | both false | both unset | three acts: key 1 + key 2 + `STOCK_DHAN_*` |
| 9 | `options_algo_api.py` `/api/execute-trade` | `LIVE_TRADING` | **`OPTIONS_API_ALLOW_LIVE`** ← new | both false | both unset | two keys |
| 10 | `antigravity-py` `place_order` | `PY_TRADE_MODE` | **NONE — ACCIDENT** | — | unset | nothing: `raise NotImplementedError` |
| 11 | `upstox-connector.js` `placeOrder` | `TRADE_MODE` | **NONE — ACCIDENT** | — | — | nothing: the method throws |

**The finding: four rows answer "one variable", and it is the same variable —
`TRADE_MODE`.** All four are in the options bot. Rows 10 and 11 have no second
key at all; they have a **missing feature standing in for one**, and it will be
removed by someone who thinks they are fixing a bug.

### The `.env` as it actually stands

```
TRADE_MODE           = paper        ← the only thing preventing live orders
AUTO_TRADE_ENABLED   = true
NIFTY_AUTO_ENABLED   = true
SENSEX_AUTO_ENABLED  = false
AMIBROKER_AUTO_TRADE = true
AMIBROKER_ALLOW_LIVE   UNSET        ← the one second key that exists, and it is holding
AMIBROKER_BRIDGE     = true
BOT_AUTOSTART          UNSET → defaults TRUE
AGENTS_SELL_ENABLED    UNSET → defaulted TRUE (fixed this session)
LIVE_CONNECTOR       = upstox
```

---

## Task 2c — every `?? 'true'` on an arming flag

| File:line | Flag | Verdict |
|---|---|---|
| `agents-engine.js:230` | `AGENTS_SELL_ENABLED` | **FIXED → `'false'`** |
| `agents-engine.js:214` | `AI_AGENTS_ENABLED` | kept — paper-only executor, no broker path |
| `preflight.js:5` | `NIFTY_AUTO_ENABLED` | kept — a read-only preflight **report**, arms nothing |
| `server.js:265` | `BOT_AUTOSTART` | **Tier 1 — proposed below, not applied** |
| `server.js:6495` | `SIGNAL_PAPER_ENABLED` | kept — paper-only engine, no broker path |
| `stock/server.js:32` | `BOT_AUTOSTART` | **proposed with the same diff** |

All six are asserted by name in `test/estate-boundary.test.js §11`. A seventh
fails the test.

---

## Task 1 — what was built

`live-permission.js` — the Key 2 reader, **extracted from the AmiBroker
implementation rather than invented**, because a working one was already in the
tree.

```
  live-permission("undefined") → refused      live-permission("true")   → GRANTED
  live-permission("")          → refused      live-permission("TRUE")   → GRANTED
  live-permission("   ")       → refused      live-permission(" True ") → GRANTED
  live-permission("1")         → refused
  live-permission("yes")       → refused
  live-permission("on")        → refused
  live-permission("[object Object]") → refused
```

**A correction, recorded rather than quietly fixed.** The first draft of that
module's comment claimed `"TRUE"` was refused, while the code trimmed and
lower-cased it. The code was right — the AmiBroker implementation being copied
is `String(...).toLowerCase() === 'true'`, and every boolean flag in this
codebase behaves that way. A secretly case-sensitive permission flag would be
its own hazard: an operator who typed `TRUE` and got paper would go hunting for
a bug in the wrong place. `"1"` and `"yes"` are still refused, because accepting
them invites `"0"`/`"no"`/`"off"` — the values that get misread.

### Applied

| Deployable | Key 1 | Key 2 | Where |
|---|---|---|---|
| antigravity-stock-bot | `STOCK_TRADE_MODE` | **`STOCK_ALLOW_LIVE`** | `stock/arming.js` |
| options_algo_api | `LIVE_TRADING` | **`OPTIONS_API_ALLOW_LIVE`** | `options_algo_api.py` |

**Key 2 is checked BEFORE credentials**, deliberately, and the test asserts the
ordering. Credential presence is a fact about a file; permission is a decision
someone made. Telling an operator who never granted permission that they are
"missing credentials" points them at the wrong step — and at the step that makes
the system *more* dangerous.

```
  nothing                         paper
  STOCK_TRADE_MODE=live only      paper   blocked by STOCK_ALLOW_LIVE
  + creds, no ALLOW_LIVE          paper   blocked by STOCK_ALLOW_LIVE
  + ALLOW_LIVE=1                  paper   blocked by STOCK_ALLOW_LIVE
  + ALLOW_LIVE=true, no creds     paper   blocked by STOCK_DHAN_CLIENT_ID,STOCK_DHAN_ACCESS_TOKEN
  BOTH KEYS + creds               LIVE
```

The FastAPI refusal names the missing key in the response body:

```json
{"dry_run": true, "blocked_by": "OPTIONS_API_ALLOW_LIVE",
 "message": "Dry-run only. blocked by OPTIONS_API_ALLOW_LIVE (key 2 of 2, default false).
             Both keys are required; dry_run=false alone can never send an order."}
```

---

## PROPOSED — Tier 1, for human application

Rows 1–4 of the Task 3 table are all in `server.js` and the two engines.
**Proposed, not applied.**

### Diff A — `BOT_AUTOSTART` defaults false (Task 2a)

```diff
- server.js:265
- let botRunning = String(process.env.BOT_AUTOSTART ?? 'true').toLowerCase() !== 'false';
+ /* Defaults FALSE. A trading process that starts itself when nothing is
+    configured is a process that will start on a machine nobody meant to arm —
+    and pm2 restarts it ten times. Set BOT_AUTOSTART=true deliberately. */
+ let botRunning = String(process.env.BOT_AUTOSTART ?? 'false').toLowerCase() === 'true';

- stock/server.js:32   (same change, same reason)
```

**Note the operational consequence, stated because it is not free:** after this,
a restart leaves the bot *not running* until someone starts it. That is the
intent. It also means an unattended restart no longer resumes trading, which is
a behaviour change the owner should choose knowingly.

### Diff B — Key 2 for the options bot

```diff
+ // server.js, beside the risk layer construction (~line 247)
+ const { livePermission, liveBlocked } = require('./live-permission');
+ const OPTIONS_LIVE_VAR = 'OPTIONS_ALLOW_LIVE';        // KEY 2, default false
+ const optionsLivePermitted = () => livePermission(OPTIONS_LIVE_VAR).granted;

  // at each of the four sites, alongside the existing TRADE_MODE check:
- if (tradeMode !== 'live') { …paper… }
+ if (tradeMode !== 'live') { …paper… }
+ if (!optionsLivePermitted()) {
+   return res.status(403).json(liveBlocked(OPTIONS_LIVE_VAR, { instrument: inst }));
+ }
```

and in `execution-engine.js` / `afternoon-engine.js`, where `paperMode` is set:

```diff
- this.paperMode = (process.env.TRADE_MODE || 'paper') !== 'live';
+ // TWO KEYS. TRADE_MODE=live says this engine may act; OPTIONS_ALLOW_LIVE says
+ // it may reach a broker. Neither alone is enough.
+ this.paperMode = ((process.env.TRADE_MODE || 'paper') !== 'live')
+               || !require('./live-permission').livePermission('OPTIONS_ALLOW_LIVE').granted;
```

Add to `.env.example`:

```
# KEY 2 of 2 — LIVE PERMISSION for the OPTIONS bot. Default false.
# TRADE_MODE=live says the engines may act; this says they may reach a broker.
OPTIONS_ALLOW_LIVE=false
```

**Until Diff B is applied, `TRADE_MODE=live` is still one variable from live
auto-trading on the options bot.** That is the largest single remaining item in
this document.

---

## Task 4 — the test, and the proof it fails

`test/estate-boundary.test.js` §11, **92 assertions total**, reading the real
source and the real `.env`.

Demonstrated by removing Key 2 from `stock/arming.js`:

```
══ give a path a single key ══
AssertionError: and the refusal names the missing KEY 2 (STOCK_ALLOW_LIVE), not the credentials

══ reverting ══
92 assertions passed
84/84 suites passed
```

---

## Task 5 — register addendum

| Deployable | KEY 1 | default | now | KEY 2 | default | now | **One change to live?** |
|---|---|---|---|---|---|---|---|
| antigravity-sensex-bot | `TRADE_MODE` | paper | paper | **none** | — | — | **YES — `TRADE_MODE=live`** |
| antigravity-stock-bot | `STOCK_TRADE_MODE` | paper | unset | `STOCK_ALLOW_LIVE` | false | unset | no — 3 acts |
| options_algo_api | `LIVE_TRADING` | false | unset | `OPTIONS_API_ALLOW_LIVE` | false | unset | no — 2 keys |
| antigravity-py | `PY_TRADE_MODE` | paper | unset | **accident** | — | — | no send path |
| amibroker bridge | `AMIBROKER_AUTO_TRADE` | false | **true** | `AMIBROKER_ALLOW_LIVE` | false | unset | no — key 2 holds |
| limit-order-engine | `EXEC_ENGINE_ENABLED` | false | unset | `EXEC_PAPER_MODE` | true | unset | no — 2 keys |
| deprecated/backend | — | — | — | — | — | — | no order path at all |

**Keep the last column permanently.** It is the one line anyone should be able
to check in ten seconds.

---

## New defects

| # | Defect | Severity |
|---|---|---|
| **D-15** | Four options-bot order paths still have **one key** — `TRADE_MODE`. Diff B proposed, not applied (Tier 1) | **critical** |
| **D-16** | `LIVE_AUTO_CONFIRM` is documented in `stock/.env.example` as *"Live orders NEVER auto-place unless this is true"* and is **read by no code at all**. A documented control that does not exist | **high** |
| **D-17** | `options_algo_dashboard.Config.live_trading` is a dataclass default evaluated **once at import**. `Config()` does not re-read the environment, though the endpoint calls it per request. Setting `LIVE_TRADING=false` on a running process **changes nothing** — same class as the Node `TRADE_MODE` latching defect: safe paper→live, unsafe live→paper | **high** |

Measured for D-17:

```
LIVE_TRADING unset at import  -> Config().live_trading = False
set env, no reload            -> Config().live_trading = False   ← here
set env, reload               -> Config().live_trading = True
```

---

## What was NOT verified

- **Nothing was deployed or restarted.** Every change is in the tree.
- **Diff A and Diff B were not applied** — `server.js` is Tier 1 by the session
  rules. The options bot therefore still has one key.
- **`antigravity-py` was not executed.** Its `PY_TRADE_MODE` change and refusal
  are unrun; its dependencies are not installed here.
- **`options_algo_api` was never run as a service** — the tests exercise the app
  through `TestClient`; no uvicorn process was started.
- **The stock bot was not started** in either mode. Its arming logic was
  exercised directly.
- **The 1d question from docs/084 is still unanswered.** If a VPS exists, its
  `/etc/antigravity-bot/antigravity.env` may set `LIVE_TRADING=true` — and until
  Key 2 is deployed there, that file is one variable from a live send on a
  service with no controls.

## First action next session

Apply Diff B. It is the only remaining path in the estate where one variable
reaches a broker, and it is the one with the most credentials behind it.
