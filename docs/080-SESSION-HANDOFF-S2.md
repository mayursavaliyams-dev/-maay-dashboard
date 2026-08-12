# 080 — SESSION HANDOFF — Session 2 · 2026-07-31 · 05:38–05:55 IST (~17 min)

**R1:** Friday 05:38 IST, market CLOSED. ✓
**End state:** fully deployable, nothing half-migrated. **Nothing committed.**
**Supersedes the CURRENT STATE numbers in doc 078.**

The session ran short of its 4-hour box because **the brief's preconditions
failed and its text was truncated**. Both are recorded under FINDINGS. An
overrun is information; so is an underrun.

---

## COMPLETED — with evidence

### 1. Precondition check (the brief's first instruction)

| # | Precondition | Result |
|---|---|---|
| P1 | Control endpoints authenticated **and phone path verified** | **FAIL** |
| P2 | Connector fall-through empirically tested and recorded | PASS |
| P3 | Relocation done, order test passes, parity held | PASS |
| P4 | **Exactly one** call site migrated and verified | **FAIL** |

Raw output for P1:

```
$ curl http://127.0.0.1:3000/api/control/audit
HTTP 404  → gate NOT deployed
  gated in source : 8
  CONTROL_TOKEN   : BLANK → loopback-only
```

Two of four failed, so the session was **not run as written**. The brief supplies
branches for two other failure modes; neither describes P1 or P4.

### 2. Block 1 — AUTO connector selection removed

`connector-select.js` (new) · `test/connector-select.test.js` (new).

```
$ node test/connector-select.test.js
27 assertions passed

$ npm test
82/82 suites passed

$ node scripts/smoke.js
7 passed · 0 failed · 2 not covered · 0.0s
```

R2 deployability, executed against the real `.env`:

```
R2 boot check with the REAL .env:
  selected        : upstox
  order capability: refuses
  credentials from: UPSTOX_ACCESS_TOKEN
  → server WOULD start
```

The regression, demonstrated. Under the old code this exact input returned a
**live-capable Dhan connector**:

```
  [CONNECTOR_CREDENTIALS]
  LIVE_CONNECTOR="upstox" but its credentials are not usable:
      · UPSTOX_ACCESS_TOKEN — only 30 characters — an Upstox access token is far
        longer, so this is a placeholder or a truncated paste
    Fix the credential. This process will NOT fall back to another connector:
    the connector that would have been chosen instead can place real orders.
```

Behaviour now: `LIVE_CONNECTOR` is **required**, `auto` is **rejected** as a
value, a missing/placeholder/implausibly-short credential is a **startup
failure** naming every missing item, and nothing is substituted in any direction.
Startup prints the connector's order capability.

Re-run without me: `node test/connector-select.test.js`

### 3. Standing context, filled from measurement

`docs/079-STANDING-CONTEXT.md`. Every CURRENT STATE value re-measured this
session rather than carried forward, with the command named for each. Load-bearing
ugliness list built with line numbers verified today.

---

## ATTEMPTED AND REVERTED

**Nothing was reverted this session.** Stated plainly rather than padded.

Two things were attempted and abandoned, with reasons:

1. **A full server restart to verify Block 1 end-to-end.** Not done: a production
   process holds port 3000, and a second instance would contend on `data/`, the
   kill-switch state file and the warehouse. The selection was instead executed
   against the real `.env` in isolation (evidence above). **This is one step short
   of a restart** and is listed under NOT VERIFIED.

2. **Running Blocks 2–5.** The brief's text ends mid-sentence at Block 1's third
   bullet — *"It must never result in a different"* — and Blocks 2–5 never
   arrived. They were not guessed at.

Carried forward from Session 1, because it belongs in this section and was
recorded there: a `sed`-based wiring edit for the AmiBroker bridge **silently
matched nothing**, leaving the bridge on the raw connector while its test — which
checked only that the consumer file contained `placeGuarded(` — passed. Found by
a claim audit, fixed, and the test strengthened to check the **provider**.

---

## CURRENT STATE — replaces the previous session's numbers

**Order paths guarded: 8 of 8** in the main bot.

**Unguarded paths remaining: none in the main bot.**

```
  afternoon-engine.js:658    GUARDED
  execution-engine.js:709    GUARDED
  limit-order-engine.js:281  GUARDED
  place-guarded.js:34        GUARDED   (the shared entry path)
```

Four `.placeOrder(` sites, comments stripped; eight consumers handed
`guardedBroker` by name in `server.js`.

**A note on the denominator, because "8 of 8" is not the same 8 the audit
counted.** The audit found 8 *call sites*, 7 of them raw. Migration collapsed
several: entries now route through `place-guarded.js` and exits through
`approveReducing`, so only 4 literal call sites remain and all hold the guard.
The 8 in "8 of 8" is the count of *consumers handed the guard* — the number that
matters, and the one a future migration would change.

**Outside the main bot:** `stock/stock-engine.js:417,538` — 2 raw sites, separate
bot, own connector, outside every control built. Defect D-1.

### Other state changes

| | Repository | Actually running on :3000 |
|---|---|---|
| Control endpoints authenticated | 8 gated | **NO — HTTP 404, not deployed** |
| Connector selection explicit | **YES** (new this session) | **NO — old code still has AUTO** |
| Circuit breaker | YES | **NO — not deployed** |
| Position reconciliation | NO | NO |
| Manual flatten rehearsed | NO — and no flatten function exists | NO |
| Suite | 82/82 | — |
| Chokepoint days live | **0** | — |

Working tree: **98 files changed, 93 staged, 0 committed.**

---

## FINDINGS

### F1 — The largest risk is not in the code

`/api/control/audit` returns **404** on the running server. The chokepoint
wiring, the control gate, the circuit breaker and explicit connector selection
are all in the tree and **none of them is running**. Every improvement of the
last several sessions is currently theoretical.

This complicates the plan in a specific way: further building increases the gap
rather than closing it. **Deployment is now the highest-value work available,
and it is not code.**

### F2 — The AUTO finding held, but its urgency was overstated

Measurement confirmed the mechanism (a short token selects a live-capable
connector) **and** established that `.env` pins `LIVE_CONNECTOR=upstox`, so AUTO
was never the deployed mode. Doc 073 §0.1 presented it as a live hazard without
that qualification. The code inference was right; the exposure claim was too
strong. Removal was still correct — the hazard was one edited line away.

### F3 — Two of the ten non-negotiables are currently violated

- **#3 "Raw capture is immutable, never delete."** `server.js:736` deletes the
  oldest option-candle file once there are more than 40, inside two nested
  `catch (_) {}`. And the capture path parses before writing (doc 077 §2.1), so
  there is no raw to be immutable about.
- **#8 "Manual override always works."** No flatten function exists anywhere, and
  with `CONTROL_TOKEN` blank the operator's phone cannot reach the kill switch.

These are not aspirational statements with a gap; they are two open holes.

### F4 — A repeating failure mode, now named

Three times in three sessions a test constructed its own input, asserted
something true of that input, passed, and protected nothing: the data gate that
matched prose (and whose test matched the same prose); the wiring test that
checked the consumer while the provider was unwired; the redaction test that
built a request with the token in `req.query` and a clean `url`.

**A test that constructs its own input tests the constructor's idea of the
input.** Recorded in doc 079 under VERIFICATION YOU OWE.

### F5 — The one-path-at-a-time rule was already broken, unrecoverably

All seven migrations landed in one prior session. The rule existed so a defect
would be caught on path one before being replicated six times. That protection
was not obtained and cannot be obtained retrospectively. What remains available
is the parity harness and one week of live observation before Phase 3.

---

## NOT VERIFIED

- **The server was not restarted.** Block 1's boot check ran the real selection
  against the real `.env` and reports it would start. That is not a restart.
- **Nothing was verified against the running process.** It is old code.
- **No request from the operator's actual phone**, through the actual tunnel, has
  ever been made. Session 1 verified a phone-*shaped* request on an isolated
  harness.
- **Whether the tunnel sets `x-forwarded-for`** — unknown, and it determines
  whether the loopback fallback is a gate or a hole. Highest-priority unknown.
- **The kill switch has never been tripped through the new gate.** Session 1's
  200 came from a stub handler; no real kill switch was touched, deliberately.
- **Whether a tunnel is running at all.** `PUBLIC_API_BASE_URL` is unset and no
  `cloudflared`/`ngrok`/`localtunnel`/`frpc` process was found on this host. That
  is a signal, not proof.
- **The seven migrated order paths in live operation.** Zero days. Parity holds
  on four recorded sessions; that says nothing about production.
- Nothing about live trading behaviour. There has been none.

---

## NEW DEFECTS DISCOVERED

| # | Defect | Where | Severity |
|---|---|---|---|
| **D-0** | Repository ≠ running process. Control gate, chokepoint wiring, breaker and explicit connector selection are all undeployed | port 3000 | **critical — capital at risk if the system is armed** |
| **D-5** | Option-candle archive deletes itself: `while (files.length > 40) unlinkSync(...)`, inside two nested `catch (_) {}`. 14 files today, so it has not fired; at 41 trading days the oldest day is destroyed permanently | `server.js:736` | **high — dated and irrecoverable** |

Recorded, **not fixed**. D-5 in particular is Tier 1 (`server.js`) and is a
behaviour change; it gets its own change with its own test.

D-2 (AUTO fall-through) is **CLOSED** this session, with a regression test.
D-1, D-3, D-4 remain open — see doc 079.

---

## NEXT ACTION

**Do not write more code. Deploy what exists.** In this order, outside market
hours:

1. **Establish whether the tunnel forwards `x-forwarded-for`.** Concretely: with
   the tunnel up, request any endpoint through the public URL and inspect the
   headers the server receives. Do this **before** step 2, because until
   `CONTROL_TOKEN` exists the loopback fallback in `control-auth.js:isLoopback`
   is the only thing protecting the kill switch — and if the tunnel does not set
   that header, the fallback treats a public caller as local and **allows** it.

   If the header is absent: change `isLoopback()` to require an explicit
   opt-in marker, or delete the fallback and make `CONTROL_TOKEN` mandatory.

2. Generate and set `CONTROL_TOKEN` in `.env`:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

3. Restart the server. Confirm both banner lines appear:
   ```
   [control-auth] control endpoints: token — CONTROL_TOKEN is set
   [server] connector: upstox (declared) — order capability: refuses
   ```

4. Confirm `curl http://127.0.0.1:3000/api/control/audit` no longer returns 404.
   **That is the moment D-0 closes.**

5. From the operator's actual phone, through the actual tunnel: one read
   (`/api/control/audit?ct=<token>`), then one timed kill-and-reset drill,
   recorded in the incident log. This closes the untested step in doc 073 §9.1.

---

## BLOCKED ON

1. **A human at the keyboard, on the machine, outside market hours.** Steps 1–5
   above all require restarting a live process and reading a physical phone. None
   can be done from this session.

2. **The remainder of the Session 2 brief.** Its text is truncated mid-sentence
   at Block 1's third bullet. Blocks 2–5 are unknown and were not invented.

3. **A broker confirmation, still outstanding from doc 073 §11:** whether Dhan
   de-duplicates orders on `correlationId`. Until answered in writing,
   `live-connector.js` sends orders with `retries: 0` and an ambiguous failure
   escalates to a human. That is the safe reading, and it is a guess about what
   the broker does.

4. **A decision the owner owns:** whether `stock/` (defect D-1, two raw order
   paths) is brought under the chokepoint, left as a separate system with its own
   controls, or retired. It is not an engineering question.
