# 078 — Session Record: 2026-07-31, Control Surface and Empirical Verification

**Window:** 01:43 – 02:30 IST, Friday 2026-07-31.
**R1 check:** market **CLOSED** (Friday 01:43 IST, outside 09:15–15:30). Work proceeded.
**End state:** fully deployable. `npm test` **81/81**, smoke **7/0/2**. Nothing half-migrated.
**Committed:** nothing. All work staged for review.

---

## 0. A correction to the session brief's premise, before anything else

The brief opens: *"the risk guard is constructed at line ~5825 while the engines
… are constructed at ~3226-3573. Seven of eight order paths hold the raw
connector."*

**That was true at the time of the audit. It is not the current state.** The
construction relocation (Block 3) and all seven call-site migrations (Block 4)
were completed in prior work and are recorded in docs 074 and 075. Measured this
session:

```
    179  live (connector)
    245  killSwitch
    246  riskManager
    247  guardedBroker          ←
   3339  engine (ExecutionEngine)
   3508  niftyEngine
   3633  afternoonEngine
   3698  niftyAfternoonEngine
   6186  executionEngine (LimitOrderEngine)
```

So Blocks 3 and 4 could not be performed as written. What this session did
instead: **Block 1 in full** (genuinely outstanding, an active exposure), **Block
2 in full** (both findings converted from inference to measurement), and the
Block 3a dependency map delivered retrospectively as the evidence for a move
already made.

**One brief rule was violated by that prior work and must be recorded rather
than smoothed over:** the brief says *"Do not move a second path in this
session… the remaining six are mechanical repetitions across later sessions,
each deployed and observed on its own."* All seven were migrated in a single
prior session, and **none has been observed in live operation.** The pacing
existed to catch a defect on path one before it was replicated six times. That
protection was skipped. It is not recoverable retrospectively; what is available
is the parity harness and one week of live observation before Phase 3, which doc
075 §9 already requires.

---

## 1. Block 1 — control surface closed · COMPLETE

### What was done

A gate that **never no-ops**, in front of every control that arms, loosens or
resets.

The obvious move was `auth.requireRole('admin')`. It would have been wrong:

```js
// auth.js:101
function requireRole(minRole = 'viewer') {
  return (req, res, next) => {
    if (!ENABLED) return next();     // ← AUTH_ENABLED defaults to false
```

That is a defensible design for a dashboard and no gate at all for a kill
switch. It would have passed review looking exactly like protection.

**`control-auth.js`** — 31 assertions in `test/control-auth.test.js`:

| | |
|---|---|
| Accepts | `X-Control-Token` header · `Authorization: Bearer` · **`?ct=` query** · a valid admin session when `AUTH_ENABLED=true` |
| Nothing configured | falls back to **loopback only**, and `mode()` says so — the brief's stop condition, automatic rather than remembered |
| Tunnel-aware | a request carrying `x-forwarded-for` is **never** treated as loopback, even though its socket is `127.0.0.1`, because the tunnel client is local and the caller is not |
| Comparison | constant-time; two empty strings do not compare equal, so an unset token can never authenticate |
| Logs | every attempt, allowed or denied, with source address and whether a credential was presented — **never the credential** |

### Endpoints now gated

```
server.js:3373  POST /api/engine/auto           control('engine-arm')
server.js:3380  POST /api/engine/mode           control('engine-TRADE-MODE')
server.js:3499  POST /api/engine/reset          control('engine-halt-reset')
server.js:6118  POST /api/risk/reload           control('risk-config-reload')
server.js:6124  POST /api/risk/kill             control('kill-switch-trip')
server.js:6135  POST /api/risk/kill/reset       control('kill-switch-RESET')
server.js:6143  GET  /api/control/audit         control('control-audit-read')
server.js:7193  POST /api/risk/emergency-stop   control('emergency-stop')
```

**Deliberately NOT gated:** `POST /api/engine/halt-all` (server.js:3471).
Stopping is always permitted; a gate on the stop button is a way to lose money,
not a way to protect it.

**Scope note, recorded rather than hidden:** the brief scoped Block 1 to kill,
kill-reset, risk reload, emergency stop and risk-config writes. `/api/engine/mode`
switches paper↔live and `/api/engine/auto` arms trading; leaving those open while
gating the kill switch would have been incoherent, so they were included. That is
three endpoints beyond the brief's list.

### Evidence — raw output, real HTTP

Method: the same gate factory `server.js` uses, mounted in front of stub handlers
on port 3999, exercised with real requests. **The bot was not booted:** a
production server is live on port 3000 and a second instance would contend on
`data/`, the kill-switch state file and the warehouse. **No kill switch was
tripped.**

```
mode: {"mode":"token","sessionAuth":false,"note":"CONTROL_TOKEN is set"}

──── UNAUTHENTICATED, arriving through the tunnel ────
  POST /api/risk/kill            → HTTP 401  {"error":"unauthorized","action":"kill-switch-trip","reason":"no credential presented"}
  POST /api/risk/kill/reset      → HTTP 401  {"error":"unauthorized","action":"kill-switch-RESET","reason":"no credential presented"}
  POST /api/risk/reload          → HTTP 401  {"error":"unauthorized","action":"risk-config-reload","reason":"no credential presented"}
  POST /api/risk/emergency-stop  → HTTP 401  {"error":"unauthorized","action":"emergency-stop","reason":"no credential presented"}
  POST /api/engine/mode          → HTTP 401  {"error":"unauthorized","action":"engine-TRADE-MODE","reason":"no credential presented"}
  GET  /api/control/audit        → HTTP 401  {"error":"unauthorized","action":"control-audit-read","reason":"no credential presented"}

──── WRONG TOKEN ────
  POST /api/risk/kill            → HTTP 401  {"error":"unauthorized","action":"kill-switch-trip","reason":"invalid control token"}

──── THE PHONE PATH: through the tunnel, token in the query string ────
  POST /api/risk/kill?ct=***     → HTTP 200  {"ok":true,"wouldHaveTripped":true,"via":"control-token"}
    x-forwarded-for: 203.0.113.9   user-agent: Mozilla/5.0 (iPhone)

──── HEADER PATH ────
  POST /api/risk/kill/reset      → HTTP 200  {"ok":true,"via":"control-token"}

──── STOPPING IS ALWAYS PERMITTED ────
  POST /api/engine/halt-all      → HTTP 200  {"ok":true,"note":"deliberately ungated"}

──── AUDIT LOG ────
  entries: 9   allowed: 2   denied: 7
  token present anywhere in log? false
```

### Deliverable status

- ✅ 401 unauthenticated · ✅ succeeds authenticated
- ⚠️ **"the phone path is confirmed working with a real request from the phone" — NOT DONE.**
  What was verified is a phone-*shaped* request over real HTTP: token in the
  query string, arriving with `x-forwarded-for` and an iPhone user-agent, 200.
  A request from the operator's actual handset through the actual tunnel has
  **not** been made, and it is the next action in §6.

### Required before this is operationally complete

`CONTROL_TOKEN` is **blank** in the deployed `.env`. Until it is set, the control
endpoints are **loopback only** — safe, and the operator's phone cannot reach the
kill switch, which breaks the manual flatten procedure (doc 073 §6). Set it:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Documented in `.env.example` with the trade-off stated.

---

## 2. Block 2 — the two findings, measured

### Test 1 — connector fall-through · **FINDING HOLDS, EXPOSURE OVERSTATED**

Method: the selection block was **extracted from `server.js` by text** and
executed verbatim against the real connector modules under six environments.
It is the shipped expression, not a paraphrase — but it is **not a full server
restart**, and that limitation is stated rather than glossed. No order placed.

```
  LIVE_CONNECTOR in .env  = upstox
  UPSTOX token length     = 335  (>40 threshold: true)
  KOTAK_CONSUMER_KEY set  = false
  DHAN creds present      = true

A. CURRENT deployed config          → UpstoxConnector   placeOrder: THROWS
B. auto, token intact               → UpstoxConnector   placeOrder: THROWS
C. auto, token SHORTENED to 30      → LiveConnector     placeOrder: IMPLEMENTED — CAN place a real order
D. auto, token CLEARED              → LiveConnector     placeOrder: IMPLEMENTED — CAN place a real order
E. LIVE_CONNECTOR UNSET, cleared    → LiveConnector     placeOrder: IMPLEMENTED — CAN place a real order
F. upstox PINNED, token CLEARED     → UpstoxConnector   placeOrder: THROWS
```

**The mechanism is real and reproducible.** Under AUTO, a token that expires,
is cleared, or falls below 41 characters silently promotes the process from a
connector that cannot place an order to one that can.

**And the deployed configuration does not use AUTO.** `.env` pins
`LIVE_CONNECTOR=upstox`. Case F shows the pin holds even with the token gone.

**Correction to doc 073 §0.1**, which stated the fall-through as a live hazard
without noting the pin. The hazard is one edited line away — deleting or
mistyping `LIVE_CONNECTOR`, or copying a `.env` that omits it — but it is not
active today. The audit's inference about the code was right; its implication
about the current exposure was too strong.

Per the brief, AUTO is **not deleted this session**. It is now to be fixed
against measured evidence rather than inference.

### Test 2 — order path inventory · **BRIEF'S PREMISE SUPERSEDED**

Every `.placeOrder(` in production code, with what it actually holds:

```
  ./execution-engine.js     724   GUARDED (this.broker)
  ./afternoon-engine.js     703   GUARDED (this.broker)
  ./limit-order-engine.js   386   GUARDED (this.broker)
  ./place-guarded.js         67   GUARDED (injected broker)
  ./risk-guard.js            81   — prose inside a comment, not a call site
  ./stock/stock-engine.js   417   *** RAW CONNECTOR ***
  ./stock/stock-engine.js   538   *** RAW CONNECTOR ***
```

Eight consumers receive the guard by name: `server.js:474` (AmiBroker bridge),
`2087` (manual trade route), `3343`, `3512`, `3637`, `3702` (four engines),
`6190` (LimitOrderEngine), `7969` (TradingView webhook).

**The main bot has zero raw order paths.** The brief's expectation of "seven
unguarded" no longer describes the tree.

**`stock/stock-engine.js` has two raw order sites and is outside every control
built in Phase 2.** This was first noted in doc 076 §7 (claim C1) and is
confirmed here by measurement. It is a separate bot with its own connector. Not
in scope today; added to the defect list.

---

## 3. Block 3a — dependency map, delivered retrospectively

For the four constructions the brief asks about, what each needs at construction
time and where that dependency lives:

| Constructed | Line | Requires at construction | Dependency at |
|---|---|---|---|
| `riskConfig` (require) | 239 | filesystem only | — |
| `killSwitch` | 245 | `riskConfig.get` | 239 ✓ |
| `riskManager` | 246 | `riskConfig.get`, `killSwitch` | 239, 245 ✓ |
| `guardedBroker` | 247 | `live`, `riskManager`, `killSwitch` | **179**, 246, 245 ✓ |

**Nothing they need lives between line 179 and line 247.** The connector is the
only external dependency and it is constructed first. That is why the move was
safe, and it is the check the brief asks for in 3a — recorded now against the
move already made.

`controlAuth` (258) depends on `auth.js` (a pure require) and nothing else, so it
sits immediately after with no ordering constraint of its own.

The durable protection asked for in 3c exists:
`test/order-path-chokepoint.test.js §1` fails if any consumer is constructed
before the guard, and `test/order-path-characterization.test.js §2` carries the
inverted defect pin.

---

## 4. New defect found today — mine, in code written this session

**The control-auth audit log leaked the token.**

The Block 1 HTTP proof printed `token present anywhere in log? true`. Cause: the
log recorded `req.originalUrl`, and the phone path is
`/api/risk/kill?ct=<token>`. The secret went into the audit log through the URL,
defeating the "never log the credential" rule by the back door.

**The unit test had asserted the opposite and passed.** It built its request with
the token in `req.query` and a clean `url` — a shape no real request ever has.
Express populates both.

Fixed: `redactPath()` masks `ct`, `control_token`, `token`, `key` and
`access_token` in the logged path while leaving the rest readable. The unit test
now uses URLs that actually carry the query string, and asserts the redacted
form:

```
  ✓ the correct token appears NOWHERE in the log — INCLUDING inside the logged URL [regression 2026-07-31]
  ✓ the secret query parameter is redacted while the rest of the URL survives — the log stays useful
```

Re-run of the HTTP proof: `token present anywhere in log? false`.

This is the third instance in three sessions of the same class — a source-shaped
test passing while the real shape fails (doc 076 §7, claims C2 and C4). The
pattern is now explicit enough to name: **a test that constructs its own input
tests the constructor's idea of the input.** Where a real request, a real file or
a real wiring can be exercised, it must be.

---

## 5. Current state

| | |
|---|---|
| Suite | **81/81** (`control-auth.test.js` new, 31 assertions) |
| Smoke | 7 passed · 0 failed · 2 not covered |
| Order paths, main bot | **all guarded**; 0 raw |
| Order paths, stock bot | **2 raw**, ungoverned — `stock/stock-engine.js:417,538` |
| Control endpoints | 8 gated, 1 deliberately open (`halt-all`) |
| `CONTROL_TOKEN` | **BLANK** — loopback-only until set |
| Connector | pinned `upstox`; AUTO fall-through present in code, not active |
| Chokepoint live days | **0** |
| Committed | **nothing** — all staged |

### What was NOT verified

- **A real request from the operator's phone.** Only a phone-shaped one.
- **The gate against the running server.** The routes were wired and the file
  parses; the gate was exercised on an isolated harness, not on port 3000. The
  running process is still the old code.
- **A full server restart** for the connector test — the selection block was
  executed in isolation.
- **That tripping the kill switch still works through the gate.** No kill switch
  was tripped, deliberately. The 200 came from a stub handler.
- **Whether the tunnel forwards `x-forwarded-for`.** The loopback fallback's
  correctness through the actual tunnel depends on it. If the tunnel does *not*
  set it, a tunnelled request would look like loopback and be **allowed**
  without a token. **This is the highest-priority unknown in this document.**
- Nothing was verified about live trading behaviour. There has been none.

---

## 6. Next session — exact first actions

1. **Determine whether the public tunnel sets `x-forwarded-for`.** Curl the
   running server through the public URL and inspect the header it sees. If it
   does not, `isLoopback()` must be changed to require an explicit
   `TRUST_LOOPBACK_ONLY_WHEN` marker, or the loopback fallback must be removed
   entirely in favour of a mandatory token. **Do this before setting
   `CONTROL_TOKEN`,** because the fallback is what protects the endpoints until
   the token exists.
2. Generate and set `CONTROL_TOKEN` in `.env`. Restart the server outside market
   hours. Confirm the startup banner reports `mode: token`.
3. **From the operator's actual phone, through the actual tunnel:** hit
   `/api/control/audit?ct=<token>` — a read, not the kill switch. Confirm 200.
   Then, once, hit `/api/risk/kill?ct=<token>` and immediately
   `/api/risk/kill/reset?ct=<token>`, outside market hours, with the trip
   recorded in the incident log as a drill. Time it. This closes doc 073 §9.1's
   untested manual flatten step.
4. Only then: delete the AUTO connector fall-through, against the evidence in §2.
   One commit, structural, with a test asserting a missing/short token is a
   **startup failure** rather than a substitution.

---

## 6b. SESSION 2 — 05:38 IST, same day

**R1:** Friday 05:38 IST, market CLOSED. ✓

### Precondition check — 2 of 4 FAILED

| # | Precondition | Result | Evidence |
|---|---|---|---|
| P1 | Control endpoints authenticated **and phone path verified** | **FAIL** | Gate is in source (8 endpoints) but **not deployed**: the running server on :3000 returns **HTTP 404** for `/api/control/audit`, i.e. it is the old code with the control surface **open right now**. `CONTROL_TOKEN` blank. No request from a real phone has ever been made |
| P2 | Connector fall-through empirically tested and recorded | **PASS** | §2 above |
| P3 | Relocation done, order test passes, parity held | **PASS** | guard at `server.js:247`; parity identical on all four recorded sessions |
| P4 | **Exactly one** call site migrated and verified | **FAIL** | zero raw sites remain in the main bot — all seven migrated in one prior session, none verified live |

Mitigating measurement for P1: `PUBLIC_API_BASE_URL` is **unset** and no
`cloudflared`/`ngrok`/`localtunnel`/`frpc` process was found on this host, so the
public exposure may not currently exist. That is a *signal*, not proof — the
check covers common tunnel binaries on one machine.

The brief supplies branches for two failure modes (relocation reverted;
measurement contradicted the finding). Neither describes P1 or P4, so the
session was not run as written.

**The brief's message was also truncated** mid-sentence at Block 1's third
bullet. Blocks 2–5 never arrived and were not guessed at.

Two of the session's three stated objectives were already complete: **zero raw
order paths remain** in the main bot, and the **automatic brake** (`order-breaker.js`,
latching on rate / per-instrument / duplicate) is built and wired inside the
guard. Only Block 1 was outstanding, fully specified, and independent of the
failed preconditions — so Block 1 alone was done.

### Block 1 — AUTO connector selection removed · COMPLETE

Justified by measurement, not inference: §2 confirmed the mechanism. It did not
contradict the finding, so the "skip Block 1" branch did not apply — though it
did establish that the deployed config pins `upstox`, so the hazard was latent
rather than active.

`connector-select.js` + `test/connector-select.test.js` — **27 assertions**.
Suite **82/82**.

- `LIVE_CONNECTOR` is **required**; one of `upstox | kotak | dhan`. No default.
- **`auto` is no longer a valid value.** An old `.env` carrying it fails to start
  rather than behaving as before — the failure mode chosen deliberately, because
  the alternative is a silent continuation of the behaviour being removed.
- A missing, placeholder or implausibly short credential is a **startup failure**
  naming what is missing. All missing credentials are named, not just the first.
- Nothing is ever substituted, in **any** direction — a broken Dhan credential
  does not fall back to Upstox either.
- Startup now prints the connector's **order capability**, so the operator reads
  it rather than inferring it from the name.

Raw output — R2 deployability against the real `.env`:

```
R2 boot check with the REAL .env:
  selected        : upstox
  order capability: refuses
  credentials from: UPSTOX_ACCESS_TOKEN
  → server WOULD start
```

Raw output — the previously dangerous case, now:

```
  [CONNECTOR_CREDENTIALS]
  LIVE_CONNECTOR="upstox" but its credentials are not usable:
      · UPSTOX_ACCESS_TOKEN — only 30 characters — an Upstox access token is far
        longer, so this is a placeholder or a truncated paste
    Fix the credential. This process will NOT fall back to another connector:
    the connector that would have been chosen instead can place real orders.
```

Under the old code that exact input returned a **live-capable Dhan connector**.

**Not verified:** the server was not restarted. The boot check executed the real
selection against the real `.env` and reports it would start; that is one step
short of an actual restart, which is deferred because a production process holds
port 3000.

### D-2 closed

Defect D-2 (AUTO fall-through) is fixed and regression-tested. D-1, D-3 and D-4
remain open. **D-3 is still the highest priority and is unchanged: nothing this
session established whether the tunnel sets `x-forwarded-for`.**

---

## 7. Defect list additions

| # | Defect | Where | Class |
|---|---|---|---|
| D-1 | Two raw order paths in the stock bot, outside every Phase 2 control | `stock/stock-engine.js:417,538` | new |
| D-2 | AUTO connector fall-through promotes to an order-capable connector on token loss | `server.js:178-203` | measured §2; fix next session |
| D-3 | Loopback fallback depends on the tunnel setting `x-forwarded-for` — unverified | `control-auth.js:isLoopback` | new, **highest priority** |
| D-4 | `CONTROL_TOKEN` blank ⇒ operator's phone cannot reach the kill switch | `.env` | operational |

Carried forward unchanged from doc 075 §7: A5 (`getPositions` returns `[]` on
error), A7, A8, A9, A10, A11, plus the six pinned characterization defects.
