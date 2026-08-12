# 084 — Estate Register (v2) and Arming-Surface Separation

**Session:** 2026-07-31. **No deployment.** Code and documents only.
**Verification:** `npm test` **84/84** · `py -m pytest tests/ -q` **4 passed** ·
`node test/estate-boundary.test.js` **62 assertions**
**Nothing committed.**

Supersedes the register in doc 083, which covered the Node half only and was
wrong by three deployables.

---

## 1d — WAS ANY OF THIS EVER DEPLOYED TO A VPS?

**This cannot be settled from the repository. The owner must answer it.** What
the repository says, in full:

**Evidence that it was prepared but NOT executed:**

| Artefact | What it says |
|---|---|
| `nginx/antigravity.conf` | `server_name your-domain.com` — placeholder |
| `deploy/nginx-antigravity.conf` | `server_name bot.example.com` — placeholder |
| `deploy/CLOUD_DEPLOYMENT_GUIDE.md` | `yourdomain.com` throughout, and reads *"Use Amazon Lightsail … for the **first production move**"* — future tense |
| `deploy/vps-setup.sh` | usage line still carries `<you>/<repo>` and `you@example.com` |
| `deploy/antigravity.env` | **absent** — only `.example` exists |
| Any real IP address, anywhere | **none found** |
| Git log | no commit mentions a deployment having happened |

**The one thing that is not a placeholder:**

`deploy/vps-setup.sh:8` reads `sudo DOMAIN=sareetex.in EMAIL=you@example.com …`
— a real, registered-looking domain, sitting between two placeholders. Git
shows it entered in commit `5939d62` *"feat: 5-min bucketed H/L timeline with
Dhan backfill + VPS deploy script"* — the same commit that **created** the
script (118 new lines). So it is the author's own domain written into the
example while writing it, not a record of a run.

**My reading: prepared, never executed.** It is a reading, not a fact.

### Why this matters more than it looks

`deploy/antigravity-fastapi.service` describes:

```
WorkingDirectory=/opt/antigravity-bot
EnvironmentFile=/etc/antigravity-bot/antigravity.env
ExecStart=… uvicorn options_algo_api:app --host 127.0.0.1 --port 8091
Restart=always
```

`options_algo_api` has an **implemented order path** (§2). If such a host exists,
a service with an order endpoint and no controls is running on it right now,
reading a configuration file nobody in this repository can see — and
`Restart=always` means it has been restarting since the day it was installed.

**Question for the owner, and the only one that blocks:**
*Was `vps-setup.sh` ever run, or any part of this deployed to Lightsail, EC2 or
any other host? If yes, that host is inventoried before anything else.*

### Why the session continued

The instruction was to stop at 1d **if the answer is yes**. It is not yes on the
available evidence, and every remaining task is code-only, deploys nothing, and
makes the estate strictly safer whichever way the answer falls. Task 3 in
particular is exactly the fix such a host would need. Stopping would have left
the defect in place while waiting for an answer.

---

## 1a — `deprecated/backend/`

| Deployable | Order path | Arming flag | Config resolved | Verdict |
|---|---|---|---|---|
| `deprecated/backend` | **none** | none | none | Pure analytics FastAPI. No `os.getenv`, no HTTP client, no broker import, nothing in the repository references it |

Measured: `grep place_order|placeOrder|/orders|square_off` → no matches.
`grep getenv|environ|BaseSettings|env_file` → no matches.
`grep requests\.|httpx|aiohttp|dhan|upstox|kotak` → no matches.

**It cannot send.** It is dead weight, not a hazard. Kept in the register
because a component nobody thinks about is still a component.

---

## 2 — The completed estate

`npm run census` · `node test/estate-boundary.test.js`

| # | Deployable | Purpose | Supervisor | Port | CWD | Config resolved at runtime | Credentials in scope | Controls | Order capability | State | Owner |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **antigravity-sensex-bot** | Index options | pm2 `antigravity-bot`, autorestart, max 10 | 3000 | `.` | `.env` | `DHAN_*`, `UPSTOX_ACCESS_TOKEN` | chokepoint, risk layer, breaker, kill switch, control gate, data gate | Upstox **throws** (accident); Dhan connector **IMPLEMENTED** | **running — old code** | owner |
| 2 | **antigravity-stock-bot** | Cash equity ORB | pm2 `antigravity-stock-bot`, autorestart, max 10 | 3100 *(collides)* | `stock/` | **no `.env` of its own** → root `.env` | paper: shared read-only. live: **requires `STOCK_DHAN_*`** | **none** | Dhan equity **IMPLEMENTED** | not observed running | owner |
| 3 | **options_algo_api** (FastAPI) | Options selection + execute endpoint | `deploy/antigravity-fastapi.service` (systemd, `Restart=always`) — **not installed locally** | 8091 | `/opt/antigravity-bot` per unit | `EnvironmentFile=/etc/antigravity-bot/antigravity.env` — **file absent here** | `KITE_*`, `ANGEL_*` — **none present anywhere in this repo** | **none** | `place_and_log` → `place_buy_order` **IMPLEMENTED** | **never deployed locally; unknown on any VPS** | owner |
| 4 | **antigravity-py** | Newer Python engine | none | — | `antigravity-py/` | `env_file=".env"`, cwd-relative | inherits whatever cwd gives it | none | `place_order` **raises NotImplementedError** (accident) | never deployed | owner |
| 5 | **deprecated/backend** | Analytics only | none | — | — | none | none | n/a | **none** | abandoned | owner |
| — | **warehouse-api** | Read-only L2 archive HTTP | **none** | 3100 | `.` | `.env` | inherits root | n/a | none | **RUNNING** PID 27692 | owner |
| — | **warehouse-capture / derive / option-warehouse** | Loops that write the archive | **none** | — | `.` | `.env` | inherits root | n/a | none | unknown | owner |

### Protected by ACCIDENT, not by design

| Component | The accident | What removes it |
|---|---|---|
| `upstox-connector.js` `placeOrder()` | throws `not implemented` | Someone implementing it. **It will look like a feature commit.** This is the only reason the main bot has never sent an order |
| `antigravity-py` `place_order()` | raises `NotImplementedError` | Same |
| `options_algo_api` | `KITE_*` / `ANGEL_*` credentials are absent from every file in this repository | Someone adding them. The code is complete and waiting |
| stock bot ↔ warehouse-api | both default to **port 3100**; whichever starts second fails to bind | Any port change |

---

## 3 — Arming flags, complete (Task 1b)

| Flag | Arms | Status |
|---|---|---|
| `TRADE_MODE` | **antigravity-sensex-bot only** | was read by 3 deployables |
| `STOCK_TRADE_MODE` | antigravity-stock-bot only | **new** |
| `PY_TRADE_MODE` | antigravity-py only | **new** |
| `LIVE_TRADING` | options_algo_api only | **found this session** — a different name, invisible to any `TRADE_MODE` audit |
| `BROKER` | options_algo_dashboard — selects paper / Kite / Angel | single reader |
| `dry_run` | **was a request body field** | **fixed — see §4** |
| `AUTO_TRADE_ENABLED` | sensex-bot **and** stock-bot | **still shared — D-9, open** |
| `BOT_AUTOSTART` | sensex-bot **and** stock-bot | **still shared — D-9, open** |

**Third and fourth brokers found:** Zerodha Kite (`KITE_API_KEY`,
`KITE_ACCESS_TOKEN`) and Angel One (`ANGEL_API_KEY`, `ANGEL_CLIENT_CODE`,
`ANGEL_PIN`, `ANGEL_TOTP_SECRET`), reached through `options_algo_dashboard.py`.
Neither appears in any prior document. **No credentials for either are present.**

### Genuinely shared by design, recorded rather than renamed (Task 2d)

15 tuning values are read by both Node bots — `STOP_LOSS_PERCENT`,
`CAPITAL_TOTAL`, `MAX_TRADES_PER_DAY`, `SLIPPAGE_PERCENT`, `TARGET_PERCENT`,
`TRAIL_LOCK_PERCENT`, `MAX_DAILY_LOSS_PERCENT`, `MAX_DRAWDOWN_PERCENT`,
`MAX_CONSECUTIVE_LOSSES`, `PROFIT_REINVEST_PCT`, `DHAN_WS_ENABLED`,
`PREFLIGHT_BASE`, `PORT`, and the two Dhan credentials.

**None of them can arm anything.** They are shared blast radius for *behaviour*
— changing `MAX_TRADES_PER_DAY` for the options bot silently changes it for the
equity bot too — and that is recorded here rather than renamed, because renaming
fifteen tuning knobs is churn that hides the two that matter.

---

## 4 — Task 3: caller-supplied arming removed

`options_algo_api.py` line 170 was one expression:

```python
if req.dry_run or not cfg.live_trading:
```

The boolean was already correct in both directions — a request alone could not
arm a send. **One expression invites the wrong simplification**, and an
environment flag needs host access while a request body field needs only reaching
the endpoint, which has no authentication of its own. So it is now split and
named:

```python
server_permits_live = bool(cfg.live_trading)   # the ONLY thing that can allow a send
caller_forces_dry   = bool(req.dry_run)        # a ONE-WAY switch, towards safety
is_dry_run          = caller_forces_dry or not server_permits_live
...
if not server_permits_live:
    raise HTTPException(500, "refusing to send: live path reached with server-side live_trading disabled")
```

**`dry_run` is kept, not removed, and the code says why:** on a server where live
sending *is* permitted, a caller can preview without sending. It does something
real; it simply cannot arm. The trailing guard is not redundant — it is redundant
only while the boolean above is correct, which is exactly what it exists to
survive.

**Test — through the real framework**, `tests/test_execute_trade_arming.py`,
4 passed:

```
test_dry_run_false_does_not_send_when_server_forbids_live
test_dry_run_true_is_always_a_dry_run
test_omitting_dry_run_does_not_send
test_the_guard_is_present_in_source
```

`place_and_log` — the only function that reaches a broker — is monkeypatched to
**fail the test if it is ever called**. That is stronger than checking the
response body: a response can say `dry_run: true` after an order has gone out.
The request is a real `TestClient.post` with a real JSON body, not a hand-built
object.

---

## 5 — Task 2: the refusals

Both new flags refuse the old name rather than falling back to it. A silent
fallback would reintroduce the coupling — the next person "fixes" the fallback
and re-arms three things with one variable.

```
  nothing                 paper
  TRADE_MODE=paper        paper          ← the normal resting state stops nothing
  TRADE_MODE=live only    REFUSED [ARMING_OLD_FLAG]
  STOCK=live no creds     paper          ← its own flag is not enough
  STOCK=live + own creds  LIVE
```

**Interpretation stated, because the instruction was literal.** "Refuse if the
old name is set and the new one is not" would refuse always — the root `.env`
sets `TRADE_MODE=paper` permanently. The check fires only when the old flag says
**live**, which is the case where an operator believes they armed something and
did not.

---

## 6 — Task 4: the boundary test, and the proof it fails

`test/estate-boundary.test.js`, **62 assertions**, all reading the real disk.

Demonstrated by adding a throwaway sixth deployable:

```
══ boundary test WITH an unregistered sixth deployable ══
AssertionError: exactly 2 package-level deployables (found 3: antigravity-sensex-bot,
                antigravity-stock-bot, throwaway-sixth-bot) — a new one fails here, by design
  census exit: 1

══ after removing it ══
  62 assertions passed
```

**`npm run census` exits 1 today and should.** Two uncontrolled order paths
remain in the stock bot. The gate is honestly red, not tuned green.

---

## 7 — New defects

| # | Defect | Severity |
|---|---|---|
| **D-13** | `options_algo_api` has an implemented order path, **no controls**, **no endpoint authentication**, and a systemd unit with `Restart=always` pointing at a host this repository cannot see | **critical, pending the 1d answer** |
| **D-14** | Two further brokers — Zerodha Kite and Angel One — are reachable through `options_algo_dashboard.py` and appear in no prior document | **high** |
| D-9 | `AUTO_TRADE_ENABLED` and `BOT_AUTOSTART` still shared between both Node bots | high |
| D-10 | Port 3100 collision: stock bot vs warehouse-api | medium |
| D-11 | Four standalone processes supervised by nothing, including the one that writes the raw archive | high |
| D-12 | Stock bot still has no chokepoint — hard to arm now, still uncontrolled | high |

---

## 8 — What was NOT verified

- **Whether any VPS exists.** The blocking question. §1d.
- **Nothing was deployed or restarted.** Every change is in the tree only. The
  process on port 3000 is still old code.
- **`options_algo_api` was never run as a service.** The tests exercise the app
  object through `TestClient`; no uvicorn process was started.
- **The systemd unit was not installed or validated** — no systemd on this host.
- **`antigravity-py` config change was not executed.** Python parses it (pytest
  imports succeed elsewhere) but `_assert_no_legacy_arming()` was not run against
  a live import of that package, because `antigravity-py` has no test that
  imports `config.py` and its dependencies are not installed here.
- **The stock bot was not started** in either mode. Its arming logic was
  exercised directly, not through a boot.
- **Kite / Angel credentials were searched for and not found.** Absence in this
  repository is not absence on a host I cannot see.

---

## 9 — First action next session

**Get the 1d answer.** If yes: inventory that host — what is installed, what
`/etc/antigravity-bot/antigravity.env` contains, whether `LIVE_TRADING` is set
there, and whether Kite or Angel credentials are present. A FastAPI service with
`Restart=always` and an order endpoint has been either running or not running for
months, and which of those it is, is not currently known.

If no: split `AUTO_TRADE_ENABLED` and `BOT_AUTOSTART` (D-9), then give the stock
bot a chokepoint (D-12).
