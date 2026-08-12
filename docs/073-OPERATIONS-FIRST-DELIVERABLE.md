# 073 — Engineering Operations: First Deliverable

**Document type:** Pre-live operations design and verified gap audit.
**Status:** Written artefacts complete. **Drills not yet rehearsed** — see §9.
**Verification date:** 2026-07-31, against the working tree at branch `main`.
**Scope:** ANTIGRAVITY PRO — Node.js index-options system, Indian retail broker APIs.

---

## 0. The finding that comes before everything else

The system has a risk layer. It is well built, it is unit-tested, and its own header
comment states the design intent precisely:

> *"Eight call sites reach `placeOrder` in this repository today... So the broker itself
> is wrapped. `placeOrder` on a guarded broker REFUSES any order without an approval
> from it — enforced by wrapping the broker itself rather than by asking eight call
> sites to remember, which is the arrangement that fails silently the one time it
> matters."* — `risk-guard.js`, lines 7–19

**That is the design. It is not what is deployed.**

Verified by direct inspection of `server.js` on 2026-07-31:

```
guardedBroker is constructed at   server.js:5825
guardedBroker is referenced at    server.js:5993  (a status report)
guardedBroker is referenced at    server.js:6071  (broker: for LimitOrderEngine)
                                  — and nowhere else.

The engines that place orders are constructed at:
  server.js:3226   new ExecutionEngine({ live, ... })      ← raw connector
  server.js:3391   new ExecutionEngine({ live, ... })      ← raw connector
  server.js:3512   new AfternoonEngine({ live, ... })      ← raw connector
  server.js:3573   new AfternoonEngine({ live, ... })      ← raw connector

Direct raw-connector order calls:
  server.js:1985            await live.placeOrder({...})
  server.js:7845            await live.placeOrder({...})
  afternoon-engine.js:520   await this.live.placeOrder({...})
  afternoon-engine.js:671   await this.live.placeOrder({...})
  execution-engine.js:540   await this.live.placeOrder({...})
  execution-engine.js:678   await this.live.placeOrder({...})
  amibroker-bridge.js:623   await deps.liveConnector.placeOrder({...})
```

**One of eight order paths passes through the risk guard.** The other seven hold the
raw connector. This is not an oversight that can be patched by remembering — it is
structural: the guard is constructed at line 5825, roughly **2,100 lines after** the
engines that would need it at 3226–3573. At the moment those engines are built, the
guarded broker does not yet exist.

The stated requirement for that layer was *"No order may reach the broker without
passing through it."* Measured against the working tree, that requirement is **not
met**, and the module's own comment describes the arrangement it was written to
prevent.

### 0.1 What is actually preventing live orders today

Not the risk layer. This:

```js
// upstox-connector.js:458
async placeOrder(/* params */) {
  throw new Error('Upstox placeOrder not implemented — paper mode only');
}
```

The active connector throws. That is a genuine structural block and it is why no order
has ever reached a broker from this system.

**But it is a property of which connector happens to be selected, not of the system.**
`live-connector.js:392` — the Dhan connector — implements `placeOrder` fully and
`POST`s to `/v2/orders` with a real order body. And the connector is chosen at runtime:

```js
// server.js:190-203  — CONNECTOR_MODE 'auto'
const upstoxTok = process.env.UPSTOX_ACCESS_TOKEN;
if (upstoxTok && upstoxTok.length > 40)      live = new UpstoxConnector(...);   // throws on order
else if (kotakKey && kotakKey !== 'your_...') live = new KotakNeoConnector();
else                                          live = new LiveConnector(...);    // PLACES ORDERS
```

Read that fall-through carefully. **If the Upstox token expires, is cleared, or is
shorter than 40 characters, AUTO mode silently selects the Dhan connector — the one
that can place real orders — and every engine is holding it unguarded.**

Module 3 of the operations brief names this exact failure: *"a token that silently
fails to refresh means the system is either not trading when it should be or unable to
exit when it must."* Here it is worse than either. A token expiry does not stop the
system; it **promotes** it from a connector that cannot trade to one that can, past a
risk layer that is not in the path.

Module 1 requires that a development or paper run be *"structurally impossible"* to
place a live order, *"not merely discouraged by a flag someone could forget."* Today the
protection is the identity of the selected connector, which is decided by the length of
an environment variable. That is a flag.

**Consequence for the build order.** Phase A is not "start Module 1." Phase A begins
with **A0 below**, and no other operations work matters until it is closed, because
every procedure in this document assumes orders pass a single controlled point.

---

## 1. Verified state of the operations surface

Each row measured on 2026-07-31 against the working tree. `Verified` = read in the
source or on disk. Absence rows record a search that returned nothing.

| Capability | Required by | State | Evidence |
|---|---|---|---|
| Single order chokepoint | M1, M9 | **1 of 8 paths** | §0 |
| Structural paper/live separation | M1 | **Absent.** One `.env`, one port, one `data/` tree. `TRADE_MODE` defaults to `paper` and is read per-engine at construction | `grep TRADE_MODE` — 10 sites, all `\|\| 'paper'` |
| Separate credentials by function | M3 | **Absent.** The same `UPSTOX_ACCESS_TOKEN` serves market data and would serve orders | `upstox-connector.js` single token |
| Secrets kept out of version control | M3 | **Present.** `.env` is gitignored; only `.env.example` variants are tracked | `.gitignore:2`, `git ls-files` |
| Startup self-check | M1 | **Partial.** `preflight.js` checks: server reachable, Dhan token valid, live spot, engine arm state, halts, capital + loss limit, **registry vs broker**, AmiBroker bridge, public tunnel | `preflight.js:61-155` |
| Self-check *enforced* at start | M1 | **Absent.** `npm run preflight` is a separate manual command. `npm start` is `node server.js` and arms regardless | `package.json` scripts |
| Clock synchronisation check | M1, M2 | **Absent** | not in `preflight.js` |
| Config integrity check | M1 | **Absent** | not in `preflight.js` |
| **Position reconciliation vs broker** | M1, M2, M4 | **Absent.** The only `reconcile` code concerns option candles and the margin estimator. Nothing compares internal positions to broker positions | `grep -rn reconcil` — 15 hits, none positional |
| Process supervision | M2 | **Present.** PM2, `autorestart: true`, `max_restarts: 10`, `min_uptime: 10s` | `ecosystem.config.js` |
| Restart-then-reconcile rule | M2 | **Absent.** PM2 restarts straight back into trading from internal state | as above |
| **Heartbeat from critical processes** | M6 | **Absent.** Zero occurrences of `heartbeat` or `lastBeat` in the tree | `grep` returned nothing |
| **Programmatic flatten-everything** | M4, P1 | **Absent.** No `squareOff`/`exitAll`/`flatten` function exists at broker level. The only matches are engines' time-of-day square-off *scheduling* | `grep -rn "squareOff\|exitAll\|flatten"` |
| Kill switch | M4, M5 | **Present.** `kill-switch.js`, atomic state persistence, `POST /api/risk/kill` | `server.js:6009` |
| **Access control on kill switch / risk config** | M3 | **Absent.** `requireAuth` appears nowhere in `server.js` except one comment at line 105. `POST /api/risk/kill`, `/api/risk/kill/reset`, `/api/risk/reload`, `/api/risk/emergency-stop` are unauthenticated — and a public tunnel is in use (`PUBLIC_API_BASE_URL`, checked by preflight) | `server.js:105, 6003-6028, 7074` |
| Registry drift check vs broker | M1 | **Present and good.** `npm run preflight:registry`, exit 1 = do not trade | `preflight-registry.js` |
| Deployment record (version, who, why) | M1 | **Absent** | no release manifest |
| Freeze-window enforcement | M1, M9 | **Absent** | no tooling |
| Incident log / runbooks | M5 | **Absent** | no `docs/runbooks/` |
| Change / decision log | M9 | **Partial.** `riskConfig.changeLog()` records risk-config changes only | `server.js:5998` |
| Data quality gate | — | **Present**, wired in front of decisions | `server.js:5836+` |
| Margin reconciliation ledger | M7 | **Present** but honest about being unvalidated: *"no reconciled samples yet — the estimator is UNVALIDATED, not accurate"* | `margin-calculator.js:224` |

**Score against Phase A (Modules 1, 2, 3): 5 of 21 requirements met.**

Two of the absences are individually sufficient to block live capital under the brief's
own principles:

- **P1 — "Manual override always exists and always works."** There is no flatten path
  in the system at all. The only exit is the broker's own terminal, which has never
  been tested for this account under time pressure.
- **M3 — "Access control on the kill switch and on risk configuration specifically.
  These are the two controls whose compromise or accidental misuse is most immediately
  expensive."** Both are open, and one of them is reachable through a public tunnel.

---

## 2. Environment separation design

### 2.1 Principle

Separation must be **structural**, meaning a development process must fail to place a
live order *because it cannot*, not because a boolean was set correctly. The test of a
structural separation is: *if every flag in the system were flipped to its most
dangerous value, what would still stop it?*

### 2.2 The three environments

| | `dev` | `paper` | `live` |
|---|---|---|---|
| Purpose | Feature work, tests, replay | Forward-testing with real market data | Real capital |
| Market data | Recorded fixtures, or live read-only | Live read-only | Live read-only |
| Order capability | **None — connector cannot place** | **None — connector cannot place** | Full |
| Credentials | `secrets/dev/` — a data-only key | `secrets/paper/` — a data-only key | `secrets/live/` — a trading key |
| Storage root | `data-dev/` | `data-paper/` | `data-live/` |
| Config file | `config/dev.json` | `config/paper.json` | `config/live.json` |
| Port | 3010 | 3020 | 3000 |
| Host | developer machine | same host as live, separate process | designated production host only |

### 2.3 The four structural barriers

Any one of these alone stops a wrong-environment order. All four are required, because
each has a failure mode the others cover.

**Barrier 1 — Credential capability.** Order placement requires a broker key with
trading permission. `dev` and `paper` are issued **data-only keys**. An order attempted
with a data-only key is rejected by the broker, not by us. This is the only barrier
that survives total compromise of our own code.

> *Action required:* confirm with the broker that a data-only API key is actually
> issuable on this account. If it is not, Barrier 1 is unavailable and must be replaced
> by a separate broker sub-account with zero funds. Record the verification date.

**Barrier 2 — Connector capability by construction.** The connector factory takes the
environment as a required argument and returns an *order-incapable* connector class for
`dev` and `paper`. The order-capable class is not merely unused in those environments —
it is not constructed, so there is no object in the process that has a working
`placeOrder`.

This replaces the present `CONNECTOR_MODE = 'auto'` fall-through. **AUTO mode is
deleted.** The connector is named explicitly per environment. A missing or expired
token becomes a **startup failure**, never a silent switch to a different connector.

**Barrier 3 — The single chokepoint.** All eight call sites receive the guarded broker
and nothing else. Enforced two ways: the raw connector is not exported into module
scope after wrapping, and a test asserts that no production file other than the wrapping
site references a raw connector's `placeOrder`.

**Barrier 4 — Storage and port separation.** Distinct data roots and ports mean a
mis-targeted process fails loudly on the wrong state rather than corrupting the right
state. This barrier protects the record, not the money — but a corrupted position file
is how a reconciliation becomes unresolvable.

### 2.4 Ordering rule

`guardedBroker` must be constructed **before** any consumer. Concretely: risk config,
kill switch, risk manager and the guard move from line 5825 to before line 3226.
A construction-order test asserts it, because the present bug is invisible at review —
both lines look correct in isolation, and only their order is wrong.

---

## 3. Startup self-check specification

Run in-process on every start, before anything is armed. **The system starts in
DISARMED state and only a fully passing self-check arms it.** A failed check leaves the
process running and serving the dashboard — so the operator can see *why* — but
refusing to trade.

| # | Check | Pass condition | On failure |
|---|---|---|---|
| S1 | Environment identity | `APP_ENV` set and matches the config file, storage root and port actually loaded | **Refuse to start.** Not merely disarm |
| S2 | Connector capability matches environment | `dev`/`paper` → connector has no order capability. `live` → it does | **Refuse to start** |
| S3 | Credential validity | A broker call returns 200 with the expected identity | Disarm, alert |
| S4 | Credential *scope* | In `live`, confirm the key has order permission; in others, confirm it does not | **Refuse to start** |
| S5 | Clock synchronisation | Offset vs NTP < 500 ms; drift monitored thereafter | Disarm. Every timestamp in the data lake and audit trail depends on it |
| S6 | Config integrity | Config file hash matches the hash recorded in the release manifest | **Refuse to start** — an unrecorded config is an unreviewed config |
| S7 | Contract metadata freshness | `preflight-registry.js` exit code 0 (registry agrees with the broker master) | Disarm. Exit 1 = do not trade |
| S8 | **Position reconciliation** | Broker positions fetched and compared to internal state; sets must match exactly | **Disarm and escalate.** Never auto-resolve |
| S9 | Kill switch state | Not tripped, or tripped-and-explicitly-reset with a recorded reason | Stay disarmed |
| S10 | Risk config loaded | Limits present, non-null, within sane bounds; `null` is not `0` | **Refuse to arm** |
| S11 | Data quality gate | Gate reports READY, not UNEVALUABLE | Disarm |
| S12 | Disk headroom | Free space above the declared floor | Disarm capture. Disk exhaustion during capture loses a day of irreplaceable data |
| S13 | Manual flatten path reachable | Broker positions endpoint responds; flatten function present and callable in dry-run | **Refuse to arm.** Never trade without a tested exit |

**S8 is the check the system does not have today and the one that matters most on a
restart.** PM2 currently restarts straight back into trading from internal state that
may be hours stale and may not know about a position opened seconds before the crash.

**Three-valued output.** Each check returns `PASS`, `FAIL`, or `UNEVALUABLE` — and
`UNEVALUABLE` is treated as `FAIL` for arming purposes while being reported separately,
because "we could not tell" and "we checked and it is wrong" are different facts and
merging them is how a broken check becomes a passing check.

---

## 4. Disaster recovery procedures

One per named failure mode. Each states the detection signal, the immediate action, and
the resume condition. The default action in every ambiguous case is **towards less
risk**.

### DR-1 · Broker API outage with open positions
- **Detect:** ≥3 consecutive API failures, or one failure lasting >30 s.
- **Immediate:** stop opening. Do **not** spam retries — trip the connector's cooldown.
  Existing positions stay; there is no way to close them through a dead API.
- **Escalate:** phone alert immediately. This is severity **SEV-1 (capital at risk)**.
- **Human action:** open the broker terminal or mobile app on a different network and
  assess. If the position is adverse and the API stays down, exit manually through the
  terminal or call-and-trade.
- **Resume:** only after S8 reconciliation passes.

### DR-2 · Websocket dead, REST alive
- **Detect:** no tick for > (per-instrument trailing median gap × declared multiple),
  while REST quotes still succeed. Detection is per instrument, not global — a single
  global threshold is wrong in both directions on the same chain.
- **Immediate:** data gate moves to HOLD. Stop opening. **Do not flatten** — flattening
  during a feed outage means sending orders while blind to price, which is how a feed
  problem becomes a loss.
- **Resume:** feed restored, gate returns READY, one clean reconciliation.

### DR-3 · Internet failure at the primary site
- **Detect:** all outbound broker calls fail while the process is healthy.
- **Immediate:** automatic failover to the secondary path (mobile hotspot at minimum).
  If failover does not restore within 60 s, treat as DR-1.
- **Human action:** the flatten procedure in §6 runs from a phone on mobile data and is
  therefore independent of the site connection **by design**.

### DR-4 · Power failure
- **Immediate:** the machine is gone; positions are open and unmanaged. This is
  **SEV-1** regardless of P&L.
- **Human action:** §6 flatten from a phone. Do not wait for power.
- **Prevention:** a UPS that covers at least an orderly close, and the explicit decision
  — recorded — of whether this system is permitted to hold positions on a machine
  without one.

### DR-5 · Process crash mid-order-placement
- **The hard case.** An order may have reached the broker, may have been rejected, or
  may be pending. Internal state does not know.
- **Immediate:** on restart, S8 blocks arming. Do **not** re-send the order. A
  re-sent order that the broker already accepted doubles the position.
- **Human action:** fetch the broker order book, match by `correlationId`, resolve
  manually, record the resolution.
- **Design requirement:** every order carries a client-generated idempotency key written
  to durable storage **before** the API call. Without it this case has no clean
  resolution. `live-connector.js` already generates `correlationId: ag-${Date.now()}` —
  but it is generated inline at call time and never persisted, so after a crash there is
  nothing to match against. **This must be fixed before live.**

### DR-6 · Broker order status that never resolves
- **Detect:** an order in a non-terminal state beyond a declared timeout.
- **Immediate:** treat the position as **possibly open** — the risk-increasing
  assumption, deliberately. Block further orders on that instrument.
- **Human action:** confirm on the terminal, cancel or complete, reconcile.

### DR-7 · Exchange halt or limit move
- **Detect:** halt flag, or quotes frozen at a limit.
- **Immediate:** stop opening. Exit is impossible by definition; do not queue orders
  that will fill at the reopen at an unknown price.
- **Pre-decided:** the position size at which a limit move is unsurvivable is a **hard
  ceiling**, set in §7, not a thing to reason about during the halt.

### DR-8 · Loss of contact with monitoring
- **Rule (from the brief, adopted verbatim):** if the system loses contact with its own
  monitoring, the safe default is **stop opening new positions and alert loudly.**
- Silence is failure. A monitoring channel that has gone quiet is treated exactly as a
  monitoring channel reporting a fault.

### DR-9 · Data lake backup restore
- Quarterly restore drill from backup into a scratch location, verified by hash against
  the manifest. **A backup never restored is not a backup.**

---

## 5. Runbook set

Runbooks live in `docs/runbooks/` as one file per mode, written in plain language for
someone under stress at 09:30. Each has five fixed sections: **Symptom · Diagnosis ·
Immediate action · Escalation · Recovery.**

### 5.1 Severity classes

| Class | Meaning | Default action | Response |
|---|---|---|---|
| **SEV-1** | Capital at immediate risk | Flatten or kill, then diagnose | Phone alert. Human within 2 min |
| **SEV-2** | Trading impaired | Disarm, stay flat, diagnose | Standard alert. Human within 15 min |
| **SEV-3** | Data loss occurring | Preserve first, trade second | Standard alert. Same day |
| **SEV-4** | Degraded but safe | Log, continue, fix in next window | Digest |

Note the ordering choice in SEV-3: irreplaceable data being lost outranks a degraded
but safe trading state, because the trade can be re-made tomorrow and the data cannot.

### 5.2 Required runbooks at go-live

`RB-01` broker API outage · `RB-02` websocket dead / REST alive · `RB-03` internet
failure · `RB-04` power failure · `RB-05` crash mid-order · `RB-06` unresolved order
status · `RB-07` exchange halt / limit move · `RB-08` token expiry mid-session ·
`RB-09` reconciliation mismatch · `RB-10` kill switch tripped — diagnosis and reset ·
`RB-11` disk full during capture · `RB-12` clock drift detected · `RB-13` monitoring
silent.

`RB-08` and `RB-09` are the two most likely to be needed in the first month, and
`RB-09` is the one with no code behind it today.

### 5.3 Incident log

One append-only record per incident: what happened, when detected, time to containment,
cost in rupees, and **the concrete system change it produced**. An incident that
produces only a resolution to be more careful has taught nothing and the entry stays
open until it produces a change.

---

## 6. Manual flatten procedure

**This is the single most important artefact in this document.** Principle P1: there
must never be a state in which a human cannot see every open position and flatten it,
independent of the bot, including when the bot is dead or lying.

**Present state, verified: there is no flatten function in this system at all.** No
`squareOff`, `exitAll` or `flatten` exists at broker level. The only exit today is the
broker's own interface.

That is not fatal — the broker terminal is in fact the *correct* primary path, because
it works when the bot is dead, which is precisely the case that matters. What is missing
is that it has never been written down and never been rehearsed.

### 6.1 The card

Printed, on the desk, and saved offline on the phone. It must work with no laptop, no
VPN, and no working bot.

```
FLATTEN EVERYTHING — target under 2 minutes

 0. Do not diagnose. Flatten first, understand afterwards.

 1. KILL THE BOT so it cannot re-open what you close.
    Phone browser →  <PUBLIC_URL>/api/risk/kill   (POST, reason: MANUAL)
    If unreachable →  PM2/host stop, or power off the machine.
    Confirm: bot must be DISARMED before step 3.

 2. OPEN THE BROKER APP.  Positions tab. Read the whole list aloud.
    Count the legs. Write the count down.

 3. SQUARE OFF ALL — use the broker's bulk exit if present.
    Market orders. Do not chase limits.
    Short options first, long hedges LAST — closing a hedge first
    leaves a naked short in a moving market.

 4. VERIFY the positions list is empty. Refresh once. Confirm zero.

 5. IF THE APP FAILS →  CALL-AND-TRADE:  <BROKER NUMBER>
    Have ready: client ID, position list, "square off all".

 6. Record: time started, time flat, what remained, what it cost.
```

**Three fields above are blanks that must be filled with real, tested values before this
card is usable:** the public URL, the broker's call-and-trade number, and confirmation
that the broker app offers a bulk exit. A card with an untested phone number on it is
worse than no card, because it will be trusted.

### 6.2 The order of steps is not arbitrary

Kill before flatten: an armed bot will re-open positions you just closed, and you will
be fighting your own system while a position moves against you. This has ended real
accounts.

Short legs before long hedges: exiting the protective wing first converts a defined-risk
position into an undefined-risk one at the worst possible moment.

### 6.3 What must be built to support it

- **`POST /api/risk/kill` must require authentication.** Today it does not, and it is
  reachable through a public tunnel. The control that stops the bot and the control that
  starts it are the same surface, and it is open.
- A **read-only positions view** that reads from the broker, not from internal state, so
  a lying bot cannot hide a position from the operator.
- A **programmatic flatten** as a *secondary* path — never the primary, because it
  depends on the thing that may be broken.

---

## 7. Capital and drawdown policy

**The figures below are proposals requiring the account owner's explicit ratification.
They are written as a template with defaults, not as an assumption about capital that
this document has no basis to know.** Once ratified they are frozen and may only be
changed by the process in §8, never on the day of a loss.

### 7.1 Allocation

| Parameter | Proposed | Note |
|---|---|---|
| Total capital at risk | `<RATIFY>` | The number you would be able to lose entirely without changing your life |
| Cash reserve, never deployed | 20% of total | Not a buffer for margin — genuinely untouched |
| Margin buffer above requirement | 40% of deployed | Sized for a volatility spike raising SPAN, not for normal variation |
| Maximum deployed at once | 40% of total | Total minus reserve minus buffer |
| Per-strategy allocation | ≤ 50% of deployed | No single strategy takes the book |
| Maximum loss per day | 2% of total | Kill switch trips |
| Maximum loss per week | 5% of total | Trading stops, review required |

### 7.2 Drawdown protocol — written now, while nothing is wrong

| Drawdown from peak | Action |
|---|---|
| 5% | Alert. No change. Recorded, not acted on |
| 8% | Size reduced to 50%. Automatic, by rule |
| 12% | Size reduced to 25%. Written review before any new position |
| 15% | **Trading stops entirely** |

**To resume after a 15% stop, all of the following must be demonstrated in writing:**
the cause identified and attributable to a specific strategy, config or operational
failure; a concrete system change made; twenty sessions of paper operation at full
process discipline; and a fresh ratification of these limits. *"Conditions have
improved"* is not one of the conditions.

### 7.3 Scale-up — by rule, not by feeling

Increase only when **all** hold: ≥60 live trading sessions at the current size; live
performance within the pre-declared band of expectation; zero SEV-1 incidents in the
period; and reconciliation clean every session. Increment: **one step of 25%**, never
a doubling. Cooling period of 20 sessions after each increase before the next is
considered.

Explicitly forbidden: increasing size because recent performance was good. Recent
performance being good is what the 60-session rule already accounts for.

### 7.4 The unsurvivable-size ceiling

Compute, before live, the loss under a **plausible extreme** — not the historical
maximum, since the historical sample almost certainly does not contain the worst case —
and identify the position size at which that extreme is unsurvivable. That size is a
**hard ceiling**, enforced in risk config, not an aspiration. `scripts/replay-bad-day.js`
exists for this and its intrinsic-value model is the right basis.

### 7.5 Reconciliation cadence

Funds daily against the broker statement. Full P&L, costs and taxes monthly. The honest
total cost of the operation — data, infrastructure, broker charges, taxes and time —
expressed as a required return hurdle, quarterly. Many small operations are
gross-profitable and net-negative once this is computed, and never compute it.

---

## 8. Change management

| Class | Examples | Required process |
|---|---|---|
| **C1 — highest** | Risk limits, kill-switch config, position sizing, order chokepoint | Written second review **completed on a different day** from the change. Paper for 10 sessions. Never during market hours |
| **C2** | Strategy parameters, new strategy, execution config | Paper for 5 sessions, then live at minimum size |
| **C3** | Observability, reporting, non-trading surfaces | Normal review, deploy outside market hours |
| **C4** | Cosmetic, docs | Normal review |

**Freeze windows, enforced in tooling rather than in memory:** no deployment during
market hours (09:00–15:45 IST); none on expiry day for any traded instrument; none on
the day before a scheduled high-impact event. The deploy script refuses and prints the
reason.

**During market hours, stopping is always permitted. Starting, loosening or adjusting is
not.** There is no exception to this and it does not require a judgement call — that is
the point of it.

**Rollback** returns code *and* config together in one command. Rolling back one without
the other produces a state that was never tested, which is a common way to turn a small
problem into an incident.

**Decision log** for judgement calls — overrides taken, limits relaxed, strategies
paused — with reasoning recorded **at the time**. Reasoning reconstructed afterwards is
reliably wrong, and reliably flattering.

---

## 9. Drill schedule — and what has and has not been rehearsed

### 9.1 Honest status

The brief's closing instruction was: *"Then rehearse the manual flatten procedure and
the feed-failure drill, and report the measured response times, before arming live
trading."*

**Neither drill has been rehearsed, and no response time has been measured.** Reporting
a number here would be fabrication. The reasons are specific:

- **The manual flatten drill cannot be run by me.** It requires the account owner's
  phone, the broker app, and a call to the broker's call-and-trade desk. Three fields on
  the §6.1 card are still blank. It is also a procedure whose whole purpose is to work
  without the bot, so automating its rehearsal would rehearse the wrong thing.
- **The feed-failure drill cannot be run meaningfully yet.** The gate logic that would
  respond to it is unit-tested, but there is no heartbeat, so the *detection* half of the
  drill has nothing to measure. A drill that exercises only the half that already works
  measures nothing.

What can be run today, and what I will run on your word:

| Drill | Runnable now? | What it would measure |
|---|---|---|
| Kill-switch trip and verify | **Yes** | Time from `POST /api/risk/kill` to all engines disarmed |
| Feed starvation in paper | **Partially** | Gate response only — detection latency is unmeasurable without heartbeats |
| Crash with open paper positions | **Yes, and it will fail** | It will demonstrate DR-5: PM2 restarts into trading with no reconciliation. Worth running precisely *because* it fails |
| Token expiry simulation | **Yes, and this is the important one** | Whether AUTO mode silently switches to the order-capable Dhan connector, as §0.1 predicts from the source |
| Manual flatten | **No** — needs the owner, the phone, the broker | Time to flat |
| Backup restore | Yes | Restore integrity vs manifest |

**Recommended first drill: token expiry.** It is cheap, it is safe in paper, and it
tests the §0.1 finding empirically rather than by reading. If the prediction holds, that
converts a source-code inference into a measured fact — and it is the single most
dangerous behaviour currently in the system.

### 9.2 Standing schedule, once live

| Cadence | Drill |
|---|---|
| **Quarterly** | Manual flatten, timed against the 2-minute target |
| **Quarterly** | One deliberate failure in paper: kill the feed, expire a token, or crash the process holding positions — rotating, so the same one is not always rehearsed |
| **Quarterly** | Backup restore, verified by hash |
| **Monthly** | Alert hygiene review: delete or re-threshold every alert that produced no action. An alert that is routinely ignored is worse than no alert |
| **Monthly** | Performance review — P&L attribution, slippage vs model, cost drag, incidents, data quality |
| **Quarterly** | Governance review — strategy continue/reduce/retire against pre-declared criteria, research progress including negative results, out-of-sample budget consumed |

---

## 10. Ordered plan to live

Sequenced by what blocks what. Nothing here is research; all of it is plumbing, and all
of it is the kind that only matters on the day it is missing.

| # | Work | Blocks | Why here |
|---|---|---|---|
| **A0** | Move guard construction before the engines; hand `guardedBroker` to all eight sites; add a test asserting no production file reaches a raw `placeOrder` | Everything | The chokepoint every other procedure assumes |
| **A1** | Delete AUTO connector fall-through. Explicit connector per environment. Missing token = startup failure | A0 | Removes the silent promotion to an order-capable connector |
| **A2** | Authenticate `/api/risk/kill`, `/kill/reset`, `/reload`, `/emergency-stop`, and risk config writes | Go-live | Two most expensive controls, currently open, publicly tunnelled |
| **A3** | Position reconciliation against broker (S8) + restart-then-reconcile rule | Go-live | The gap that turns a crash into an unknown position |
| **A4** | Durable idempotency key written **before** the order call | Go-live | DR-5 has no clean resolution without it |
| **A5** | Fill the §6.1 card's three blanks; rehearse; record the time | Go-live | P1. A card with an untested number is worse than no card |
| **A6** | Environment separation: data-only credentials, separate roots, separate ports | Go-live | Structural, not flag-based |
| **A7** | Enforce self-check at startup; start DISARMED | Go-live | A manual preflight is a preflight someone skips |
| **B1** | Heartbeats + treat silence as failure | Observability, drills | Without it, detection latency is unmeasurable |
| **B2** | Release manifest: code version, config version, who, when, why; single-command rollback of both | Change control | |
| **B3** | Freeze-window enforcement in the deploy script | Change control | |
| **C1** | Single operational view: armed state, connection health, data quality, positions with portfolio greeks, margin headroom, day P&L vs limit, last heartbeat | Daily operation | |
| **C2** | Runbooks RB-01 … RB-13 | Incident response | |
| **D** | Capital policy ratified; compliance verification with the broker, dated; monthly and quarterly review cadence started | Business | |

---

## 11. Compliance — what must be verified, not assumed

The SEBI retail algo framework took effect in 2025 and its operational details continue
to be clarified. **This document does not state what the framework currently requires,
because that must be verified directly with your broker and the exchange, and the
verification recorded with its date.** A secondary description — including this one — is
not a compliance basis.

What to verify, and record with the date of each answer:

1. Static IP whitelisting — is it required for this account and API, and what exact IPs
   are registered?
2. Algo identifier / tagging — does this system's order pattern require an exchange-
   registered, tagged algo ID?
3. Order-rate threshold — what is the current threshold above which registration
   applies, and what is our measured actual rate against it? Alert well before it.
4. Traceability retention — client → algo ID → API key → static IP on every order, and
   for how long must it be retained and queryable?
5. Record-keeping norms — build retention to **exceed** them; storage is trivial against
   the alternative.

Taxation and entity structure require a qualified professional. They have real
consequences for net returns and are outside the scope of any engineering document,
including this one.

---

## 12. Summary

- The risk layer is correctly designed, correctly tested, and **wired into one of eight
  order paths**. It wraps a broker object that the engines never receive.
- What prevents live orders today is that the selected connector's `placeOrder` throws.
  That is a property of which connector was selected, and **AUTO mode selects the
  order-capable one when the Upstox token is missing or short**. Token expiry does not
  stop this system; it promotes it.
- There is **no flatten function**, **no heartbeat**, **no position reconciliation**, and
  **no authentication on the kill switch** — which is publicly tunnelled.
- Phase A scores **5 of 21**.
- No drill has been rehearsed and **no response time is reported**, because none has been
  measured. The first drill worth running is **token expiry in paper**, which tests the
  §0.1 finding empirically.
- The written artefacts requested — environment design, self-check spec, DR procedures,
  runbook set, flatten card, capital and drawdown policy, drill schedule — are complete
  above. The capital figures require the owner's ratification and are marked `<RATIFY>`.

Nothing in this document authorises live capital. Under its own Phase A gate, this
system is not ready to be armed, and the specific reason is A0: there is not yet a
single point through which every order must pass.
