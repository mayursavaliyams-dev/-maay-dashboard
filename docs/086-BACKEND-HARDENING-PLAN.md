# 086 — How to Make This Backend Strong

**Measured 2026-08-07 against the running tree.** Every number below came from a
command, not from judgement. The ordering is the argument; the list is easy.

---

## 0. The finding that came out of writing this

While counting routes I found a live gap **I created myself** last week.

Three engine-control routes were gated: `/api/engine/auto`, `/api/engine/mode`,
`/api/engine/reset`. Their NIFTY twins were not:

```
3382: app.post('/api/engine/auto',        control('engine-arm'),        …)   ✓ gated
3389: app.post('/api/engine/mode',        control('engine-TRADE-MODE'), …)   ✓ gated
3508: app.post('/api/engine/reset',       control('engine-halt-reset'), …)   ✓ gated
3624: app.post('/api/nifty/engine/auto',                                …)   ✗ OPEN
3631: app.post('/api/nifty/engine/mode',                                …)   ✗ OPEN
```

`/api/nifty/engine/mode` is three lines long and calls
`niftyEngine.setTradeMode(mode)`. It flips NIFTY between paper and live, and it
is reachable by anyone who can reach the port.

I gated by matching `/api/engine/*` and did not look for the instrument-prefixed
duplicates. **A control applied to some of the things it should cover provides
the safety of the ones it missed** — which is the theme of this entire document,
demonstrated by the person writing it.

---

## 1. What is actually there today

| | Measured |
|---|---|
| `server.js` | **8,363 lines** |
| Root modules | 124 |
| Test suites | **85, all passing** |
| HTTP routes | **204** |
| Mutating routes (POST/PUT/PATCH/DELETE) | **58** |
| …gated | **9** |
| …**ungated** | **49** |
| Request-input reads (`req.body` / `req.query`) | 164 |
| Schema validation (zod / joi / ajv) | **none** |
| HTTP rate limiting | **none** |
| Structured logging (pino / winston) | **none** |
| Express error middleware | **none** |
| `unhandledRejection` / `uncaughtException` guards | 2 |
| Silent `catch {}` in `server.js` | **55** |
| Datastore | **74 JSON files**. No SQLite, no Postgres |
| Supervision | pm2, `autorestart: true`, `max_restarts: 10` |

The tests are the strong part. 85 suites is not decoration — several of them
caught real defects during this session's work.

---

## 2. The ordering argument

A generic hardening list would start with input validation and rate limiting.
For **this** backend that ordering is wrong, and it is worth saying why.

This is not a web service where the worst outcome is a bad response. It is a
process that can move money, that records data which cannot be re-bought, and
that is operated by one person who is sometimes asleep. So "strong" means three
things, in this order:

1. **It cannot lose money silently.**
2. **It cannot lose irreplaceable data.**
3. **It can be operated** — you can see what it is doing and stop it.

Everything else — validation, rate limits, logging, a real database — is real
work that makes the system better, and none of it prevents the three failures
above. Do it, but do it after.

---

## 3. The plan, in order

### STEP 1 — Close the control surface properly (hours)

**49 ungated mutating routes**, including:

```
POST /api/bot/start          POST /api/nifty/engine/mode   ← paper ↔ live
POST /api/bot/stop           POST /api/nifty/engine/auto
POST /api/trade/execute      POST /api/strangle/enable
POST /api/test-trade         POST /api/gamma-blast/enable
POST /api/strategy-config    POST /api/pop/sell
```

Do not gate them one by one — that is exactly how the NIFTY twins were missed.

**Gate by default, exempt by name.** One middleware in front of every mutating
verb, with an explicit allowlist of routes that may stay open (`halt-all`, and
anything else that only ever *reduces* risk). Then adding a new POST route is
gated automatically, and leaving it open is a deliberate act that appears in a
diff.

The test writes itself: enumerate every mutating route from the source, assert
each is either gated or on the exemption list, and assert the exemption list's
exact length so it cannot grow silently.

**Also:** `CONTROL_TOKEN` is still blank, so the control endpoints are
loopback-only and the operator's phone cannot reach the kill switch. Set it.

### STEP 2 — Make the running process knowable (days)

The single most repeated finding of this whole programme:
**the repository is not the process.**

- `/api/control/audit` returned 404 for a week while the code that serves it sat
  in the tree, because nothing had restarted.
- A `sed` wiring change silently matched nothing, and its test passed anyway.
- The startup banner still prints `Mode: LIVE (Dhan)` while the system is
  `upstox · paper · orders refuse`. Three facts, all wrong, on the first line an
  operator reads.

Build:
- **An attestation endpoint** — code commit hash, config hash, and a *runtime-derived*
  boolean per control (chokepoint active? breaker active? gate active?). Derived,
  never a constant: a hardcoded version string is the defect it was meant to catch.
- **A verify command** that diffs the running process's report against the working
  tree and exits non-zero. Run it on start, on a schedule, and as step one of any
  incident.
- **Fix the banner** to print the derived values. `CONNECTOR_NAME` and
  `CONNECTOR_ORDER_CAPABILITY` already exist at `server.js:193,204`.

### STEP 3 — Stop losing data that cannot be re-bought (weeks, and it is dated)

- **The capture parses before it writes.** `warehouse-capture.js:78` calls
  `r.json()` and the bytes are gone. `raw-journal.js` is built and tested
  (55 assertions) and **wired to nothing**. The wiring diff is in docs/077 §6.1.
- **An unchanged snapshot is not written at all**, so the archive cannot tell
  "the market did not move" from "we were not watching".
- **`server.js:736` deletes the option-candle archive** once it exceeds 40 files,
  inside two nested `catch (_) {}`. It has not fired yet. It will.
- **Capture has never started before 11:16 IST.** The market opens at 09:15.

Price history can be re-bought from the broker. Last Tuesday's option chain at
11:00 cannot be bought back at any price.

### STEP 4 — Errors must be visible (days)

- **No express error middleware.** An unhandled route error returns the default
  handler's stack trace to the caller and nothing to you.
- **55 silent `catch {}` in `server.js`.** Not all are wrong — some wrap genuinely
  optional work — but none is distinguishable from the ones that are, because
  they are written identically. Give each one either a log line or a comment
  stating why silence is correct.
- **No structured logging.** `console.log` cannot be filtered, correlated or
  alerted on. pino, one line of setup, and a request id.

### STEP 5 — Validate what comes in (days)

164 places read `req.body` / `req.query` with **no schema anywhere**. This
codebase has already been bitten twice by exactly this class:

- `MAX_TRADES_PER_DAY="abc"` → `parseInt` → `NaN` → `tradesToday >= NaN` is false
  for every count → **the daily trade limit silently disappears**.
- `dry_run` was a caller-supplied field participating in an arming decision.

Add zod at the boundary. Reject on parse failure with a named error. **Never
coerce** — a malformed number must be a refusal, not a `NaN` that flows onward.

### STEP 6 — Give the state a real store (weeks)

74 JSON files. `safe-write.js` already makes the important ones atomic with a
`.bak` recovery, which is genuinely good. But:

- No transactions, so a multi-file update has no atomicity.
- No query. "What did the bounce engine hold at 14:00 last Tuesday?" is a grep.
- `tradesToday` and `openPosition` live only in memory and **reset on restart**,
  with pm2 configured for 10 restarts. Ten restarts is ten fresh trade budgets.

SQLite, one file, WAL mode. Not Postgres — this is one process on one machine
and a second service is a second thing that fails during market hours.

### STEP 7 — Split `server.js` (months, and only after the above)

8,363 lines whose dependency mechanism is **construction order**. That is the
defect class that put the risk guard 2,300 lines after the engines that needed
it, where it could not possibly have been passed to them.

Do it by the strangler method already documented in docs/074–075: characterise,
move with no modification, verify parity, then narrow the interface — never all
three in one commit. Extract by dependency, not by topic.

**This is last on purpose.** It is the most satisfying item on the list and the
least protective. A tidy `server.js` that is still one variable from live, still
losing chain data every day, and still not the process that is running, is a
tidier version of the same system.

---

## 4. What is already strong — do not undo it

- **85 test suites**, several of which caught real defects this week.
- **The order chokepoint**: one path, bypass throws at run time rather than
  failing a lint rule.
- **The registry as single source of truth** — verified against the broker
  contract master on demand (`npm run preflight:registry`, all 6 instruments
  agree today).
- **`null` is not `0`** as a discipline, and `safe-write.js` behind it.
- **The two-key rule** on the paths that have it.
- **Ratchets** (`perf-budget`, `repo-integrity`) that fired twice this week and
  were fixed at the cause rather than raised.

---

## 5. The habit that matters more than any of the steps

Five times in this programme a test passed while protecting nothing:

- a data gate matched a regex against prose it had written itself — and so did
  its test;
- a wiring test confirmed the *consumer* called the right function while the
  *provider* still handed it the raw connector;
- a redaction test built a request with the token in `req.query` and a clean
  `url` — a shape express never produces;
- a status fix read a capability *after* the guard had replaced the method;
- a provenance heuristic passed my own diagnostic probe and reported "real AFL
  pushes are present" when the only such record was mine.

**A test that constructs its own input tests the constructor's idea of the
input.** Where a real request, a real file, a real launch or a real wiring can be
exercised, it must be. That habit is worth more than steps 4, 5 and 6 combined,
and it costs nothing.

---

## 6. If you only do one thing this week

**Step 1.** Gate-by-default on the 58 mutating routes, with a named exemption
list and a test that pins its length.

It is a few hours, it closes 49 open doors including a paper↔live switch, and it
is the only item on this list that would have caught my own mistake in §0.
