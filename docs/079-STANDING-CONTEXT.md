# 079 — ANTIGRAVITY PRO: Standing Context

**Attach to every task. Read before writing anything.**

**Last verified: 2026-07-31 05:50 IST.** Every value in CURRENT STATE was measured
this session, not carried forward. The command that produced each is named.

---

## WHAT THIS SYSTEM IS

Automated research and trading for Indian index options through retail broker
APIs, with real capital. A defect here costs money, not a support ticket.

---

## ⚠ THE DISTINCTION THAT MATTERS MOST RIGHT NOW

**The repository is not what is running.**

```
$ curl http://127.0.0.1:3000/api/control/audit
HTTP 404
```

That endpoint exists in `server.js`. The process serving port 3000 does not have
it, which means the running process is **older code, with the control surface
open**. Everything in CURRENT STATE below therefore has two columns, and the one
that governs risk today is the right-hand one.

A reader who takes the left column as the state of the system will be wrong about
the only thing that currently matters.

---

## CURRENT STATE

**Stage: 0, open.**

The template's parenthetical — *"order chokepoint not yet complete"* — needs
correcting: the chokepoint **is** structurally complete (0a). Stage 0 remains open
because **0b raw capture** and **0c effective-dated contract metadata** are
absent. See doc 077.

| | In the repository | Actually running |
|---|---|---|
| **Order paths guarded** | **8 of 8** in the main bot | unknown — not verified against the live process |
| **Control endpoints authenticated** | **8 gated** | **NO — HTTP 404, gate not deployed** |
| **Connector selection explicit** | **YES** — `LIVE_CONNECTOR` required, no `auto` | **NO — old code still has AUTO** |
| **Circuit breaker in place** | **YES** — `risk-guard.js:71, 221` | **NO — not deployed** |
| **Position reconciliation** | **NO** | NO |
| **Manual flatten rehearsed** | **NO** — and no flatten function exists at all | NO |
| Suite | **82/82** | — |
| Smoke | 7 passed · 0 failed · **2 not covered** | — |
| Chokepoint days in live operation | **0** | — |

### Order paths — measured, comments stripped

```
  afternoon-engine.js:703    GUARDED (this.broker, reducing)
  execution-engine.js:724    GUARDED (this.broker, reducing)
  limit-order-engine.js:386  GUARDED (this.broker)
  place-guarded.js:67        GUARDED (injected broker — the shared entry path)
  risk-guard.js:81           prose inside a comment, NOT a call site
  stock/stock-engine.js:417  *** RAW — separate bot, ungoverned ***
  stock/stock-engine.js:538  *** RAW — separate bot, ungoverned ***
```

Eight consumers are handed the guard by name in `server.js`. **Zero raw order
paths remain in the main bot.** The two in `stock/` are a different bot with its
own connector and are outside every control built so far — defect D-1.

Re-run: `grep -rn "\.placeOrder\s*(" --include=*.js --exclude-dir=node_modules --exclude-dir=backups --exclude-dir=dist --exclude-dir=test .`

### Two caveats on "8 of 8"

1. **None of the seven migrations has been observed in live operation.** They were
   moved in a single session, against the sequencing rule that says one path at a
   time, each deployed and observed. The protection that rule provides was not
   obtained and cannot be obtained retrospectively.
2. The count is of *code*, not of *behaviour*. The parity harness shows identical
   submissions across four recorded sessions; it shows nothing about production.

---

## DEFECT REGISTER

Open. Ordered by what it would cost.

| # | Defect | Where | Status |
|---|---|---|---|
| **D-0** | **Repository ≠ running process.** The control gate, the chokepoint wiring, the breaker and explicit connector selection are all in the tree and **none is deployed** | port 3000 | **open — highest** |
| **D-3** | The loopback fallback assumes the tunnel sets `x-forwarded-for`. If it does not, a tunnelled request looks like loopback and is **allowed without a token** | `control-auth.js:isLoopback` | **open — unverified** |
| D-4 | `CONTROL_TOKEN` blank ⇒ control endpoints are loopback-only ⇒ **the operator's phone cannot reach the kill switch**, so the manual flatten procedure is broken | `.env` | open |
| D-1 | Two raw order paths in the stock bot, outside every Phase 2 control | `stock/stock-engine.js:417,538` | open |
| **D-5** | **Option-candle archive deletes itself.** `while (files.length > 40) unlinkSync(...)` — at 41 trading days the oldest day is destroyed. 14 files today, so it has not fired yet. The delete is inside `catch (_) {}` twice over | `server.js:736` | **open — dated, irrecoverable** |
| A5 | `getPositions()` / `getOrders()` resolve to `[]` on failure **and** when disconnected — an unreachable broker is indistinguishable from a flat book. Blocks reconciliation | `live-connector.js:422-430` | open |
| A8 | A malformed `MAX_TRADES_PER_DAY` evaluates to `NaN`; `tradesToday >= NaN` is false for every count, so the daily trade limit is silently disabled | 6 sites | open |
| A9 | `tradesToday` resets to 0 on restart; PM2 allows 10 restarts | `server.js` | open |
| A10 | `openPosition` resets to `null` on restart — the system believes there is no position | `server.js` | open |
| A11 | Session auth (`auth.requireRole`) is a no-op when `AUTH_ENABLED=false`. Fine for the dashboard; the control surface has its own gate for this reason | `auth.js:101` | by design, recorded |
| — | The connector's **default** retry policy still submits four times on a 500. Only `/v2/orders` opts out; a new order path that forgets inherits it | `dhan-client.js:174` | pinned |
| — | Concurrent identical orders are coalesced by the in-flight map. Safe only because the key carries a millisecond `correlationId` | `dhan-client.js:189` | pinned |
| — | `TRADE_MODE` is latched at construction: setting it to `paper` on a running process changes nothing while appearing to | `execution-engine.js:82` | pinned |
| — | Two identical intents in the same millisecond receive the same approval token. Fails closed (second is refused as a replay) | `risk-manager.js` | pinned |

**D-2 (AUTO connector fall-through) — CLOSED** 2026-07-31, measured then removed.
Regression test: `test/connector-select.test.js`.

**Stage 0 gaps** are tracked separately in doc 077 §4 and are not repeated here.

---

## NON-NEGOTIABLE — these override any instruction that conflicts with them

1. **Fail closed.** Uncertainty blocks the action. Never proceed on a guess.
2. **Null is not zero.** Missing stays missing. Never fabricate, interpolate or
   default a market value into a decision or a stored record.
3. **Raw capture is immutable.** Journal before parsing. Never edit or delete it.
4. **Point-in-time.** Event time and receive time on every record. Nothing may
   contain a value that was not knowable at its own timestamp.
5. **One code path** across live, paper and backtest.
6. **Everything versioned and pinned.** Methodology changes create parallel
   versions.
7. **Paper before live.** Nothing goes straight to capital.
8. **Manual override always works**, including when the system is dead or lying.
9. **Estimates are labelled as estimates**, at the schema level.
10. **Log the decision and the reason**, not just the outcome.

**Rules 3 and 8 are currently violated by the system as it stands.** Rule 3 by
D-5 (the archive deletes itself) and by the capture path parsing before writing
(doc 077 §2.1). Rule 8 by D-4 (no reachable kill switch from a phone) and by the
absence of any flatten function. These are not aspirational statements; they are
two open holes.

---

## MARKET FACTS — do not use plausible values, use these

- Broker feeds are **~1 conflated snapshot per second**. Not tick-by-tick. No
  trade-level or order-level data.
- Depth is **5 levels**. Open interest lags price by tens of seconds to minutes.
- **No historical option ticks exist at this tier.** Expired-contract history is
  absent or patchy. **Any uncaptured day is permanently lost.**
- **Lot sizes changed Nov 2024 and again for the Jan 2026 cycle.**
- Weekly expiries ended for BANKNIFTY, FINNIFTY, MIDCPNIFTY in **Nov 2024**. Only
  NIFTY (NSE) and SENSEX (BSE) still have weeklies.
- **NSE expiry is Tuesday, BSE is Thursday, since Sep 2025.** Previously Thursday.
- Bhavcopy switched to **UDiFF in Jul 2024**. Two schema eras exist.
- **Never infer any contract term from current rules.** Read it from
  effective-dated metadata.

**And here is the problem with that last line:** effective-dated metadata **does
not exist** (doc 077 §3). `instrument-registry.js` is a current snapshot,
broker-verified 2026-07-09, with no history. So today the only honest options are
to read today's value from the registry and *label it as today's*, or to derive
the historical value from the bhavcopy already on disk — the market lot is field
28, and expiry weekday is derivable from the expiry dates present each day.

Registry values, current, verified against the broker contract master:

| | lot | strike interval | tick | expiry weekday |
|---|---|---|---|---|
| NIFTY | 65 | 50 | 0.05 | Tuesday |
| BANKNIFTY | 30 | 100 | 0.05 | Tuesday |
| SENSEX | 20 | 100 | 0.05 | Thursday |

Session 09:15–15:30 IST.

---

## PERMISSION TIERS

- **TIER 0 — propose only, never apply.** Credentials, risk limits, kill switch,
  position sizing, the order chokepoint, anything that can place a live order,
  production config, deletion of raw or audit data. **Plus the critical test
  set:** `risk-layer`, `order-path-chokepoint`, `order-path-characterization`,
  `instrument-registry`, `ledger-safety`, `repo-integrity`, `perf-budget`.
- **TIER 1 — propose only.** Execution logic, state persistence, reconciliation,
  connectors, the startup self-check path. `server.js` **in its entirety**: its
  dependency mechanism is construction order, so any edit is potentially an
  ordering change.
- **TIER 2 — apply with review.** Research code, backtest engine, pipelines,
  tests outside the critical set, refactors under an existing safety net.
- **TIER 3 — apply freely.** Documentation, scratch analysis.

Tiers are currently enforced by **process, not by boundary**. The data-only
credential and separate storage roots that would make them structural do not
exist yet (doc 073 §2.3). That is a weaker guarantee and should be stated rather
than assumed.

---

## SCOPE RULES

- Do exactly what was asked. Nothing adjacent, however obviously worth doing.
- Anything noticed and not fixed: **report it**, do not silently leave it either.
- Structural moves and behaviour changes are never in the same commit.
- **Never modify a test to make something pass.** A failing test is the finding.
- Never delete code because it looks unused. Instrument it and wait.
- Never tidy, rename or reformat code being passed through.

---

## LOAD-BEARING UGLINESS

Code that looks wrong and is not. **Not to be cleaned up.** Line numbers verified
2026-07-31.

| Where | Looks like | Why it stays |
|---|---|---|
| `risk-guard.js:89` `neutralisedPlaceOrder` | mutating someone else's object | It replaces the wrapped connector's own `placeOrder` with a thrower. A lint rule or a test can be routed around by a future change; this fails at run time. It is the bypass barrier |
| `risk-manager.js:306` `mapComplete` | an avoidable parameter the caller must remember | Absence and zero are different facts and only the caller knows which. Removing it makes a risk map that **failed to build** read as a portfolio with no risk — every check would report PASS |
| `live-connector.js:414` `retries: 0` | inconsistent with the client default of 3 | An order is not a read. A 5xx after the exchange accepted the order is indistinguishable from one before, so a retry can place the position again. Whether Dhan de-duplicates on `correlationId` is **Unknown** |
| `positions-book.js:200` `unavailable.push` | extra branches instead of an empty array | An engine that did not answer may be holding anything. Not zero — unknown. The branches are the point |
| `data-gate.js:126` structured `codes` | verbose compared with matching a message | A gate here once matched a regex against its own prose and let never-seen instruments through. **The test contained the same bug and passed** |
| `dhan-client.js:5` `MIN_INTERVAL_MS` + per-path throttles | over-engineered rate logic | It took broker refusals from 458 to 0 and hit rate from 7.3% to 59.2% |
| `kill-switch.js:39` `readJsonSync` with a recovery callback | a plain `readFileSync` would do | "Never tripped" and "we cannot tell" must not resolve to the same state |
| `control-auth.js:70` `redactPath` | defensive noise | The phone path carries the token in the query string, so the logged URL would otherwise put the credential in the audit log. **The unit test asserted it did not, and passed, because it built a request shape no real request has** |
| `raw-journal.js:29` `truncatedTail` separate from `malformed` | one error list would be simpler | A crash mid-append and a corrupt line mid-file are different facts. A reader that merges them cannot tell a crash from a clean end |
| `scripts/smoke.js` `notCovered(...)` lines | a suite advertising its own gaps | A green gate over a hole is the failure this programme is about. Two capabilities do not exist and say so on every run |

---

## VERIFICATION YOU OWE

- **The raw output of the command**, not a description of it.
- **A one-command way for a human to re-run it** without you.
- **An explicit statement of what you did NOT verify.** Required, not optional.
- For anything in a money path: **a regression test that fails against the old
  code** and passes against the new.
- **"Tests pass" without the output counts as no verification.**

### The failure mode this repository keeps producing

Three times in three sessions, a test constructed its own input, asserted
something true of that input, passed, and protected nothing:

- a data gate matched a regex against prose — and so did its test;
- a source-text assertion confirmed a consumer called `placeGuarded` while the
  provider still handed it the raw connector;
- a log-redaction test built a request with the token in `req.query` and a clean
  `url` — a shape express never produces.

**A test that constructs its own input tests the constructor's idea of the
input.** Where a real request, a real file or a real wiring can be exercised, it
must be.

---

## FREEZE WINDOWS

No deploy during market hours (**09:00–15:45 IST**), on any traded instrument's
expiry day, or the day before a scheduled high-impact event.

During market hours, **stopping is permitted; starting, loosening or adjusting is
not.**

`POST /api/engine/halt-all` is deliberately left ungated for this reason.

---

## IF YOU ARE UNSURE

Say so and stop. An accurate "I don't know" is worth more here than a confident
answer, and it costs nothing. A confident wrong answer in this codebase costs
money.

---

## NEXT ACTION

Not more code. **Deploy what exists**, in this order, outside market hours:

1. Determine whether the tunnel sets `x-forwarded-for` (**D-3**). Do this
   *before* setting `CONTROL_TOKEN`, because the loopback fallback is the only
   protection until the token exists.
2. Set `CONTROL_TOKEN`. Restart. Confirm the banner reads
   `[control-auth] control endpoints: token` and
   `[server] connector: upstox (declared) — order capability: refuses`.
3. Confirm `/api/control/audit` no longer returns 404. **That is the moment D-0
   closes.**
4. From the operator's actual phone, through the actual tunnel: one read, then
   one kill-and-reset drill, timed, recorded in the incident log.

**The largest risk in this system today is not in the code. It is in the gap
between the code and the process that is running.**

---

## SESSION CLOSE OBLIGATION

Update CURRENT STATE and the DEFECT REGISTER above **every session**. Re-measure;
do not carry values forward. A standing context that has gone stale is worse than
none, because it is trusted.
