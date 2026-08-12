# 087 — Research Brief: Backend Hardening

**Paste this whole file into Claude (or ChatGPT). It is self-contained — you do
not need the repository to answer.**

---

## WHAT I WANT BACK FROM YOU

Read everything below, then **write me an implementation prompt** — the prompt I
will hand to a coding agent that has write access to this repository, so it can
carry out the work.

Your output should be **the prompt itself**, not an essay about the prompt, and
it must contain:

1. **A single ordered work plan.** If you disagree with my ordering in §4,
   re-order it and say in one line why. Do not produce a menu of options.
2. **Per step: the acceptance test before the code.** State what must be true for
   the step to count as done, in a form a machine can check. A step whose only
   evidence is "the agent says it did it" is not acceptable.
3. **Explicit scope walls.** Name what the agent may edit and what it may only
   propose. My tiers are in §6.
4. **The failure modes to refuse.** §7 lists five ways work in this codebase has
   passed a test while protecting nothing. Your prompt must forbid each by name,
   because the agent will otherwise repeat them — the previous agent did, five
   times.
5. **A stopping rule.** What the agent should do when it finds something it
   cannot verify, rather than assuming.

**Where my brief below is wrong, say so.** I would rather be corrected than
agreed with. In particular: challenge §4's ordering if you think a generic
hardening order (validation and rate limits first) is actually correct here.

---

## 1. THE SYSTEM

A Node.js / Express quantitative options-trading platform. One process, one
machine, one operator (me). Trades Indian index options — NIFTY, BANKNIFTY,
SENSEX — on the Upstox market-data feed.

**It is paper-only today.** No order has ever reached a real broker. The
connector's `placeOrder` throws. That is the current safety, and part of the
point of this work is to replace safety-by-accident with safety-by-design before
any live capital exists.

It is not a web product. No users, no tenants, no public sign-up. The threat
model is not an attacker after data — it is **the system doing something with
money that I did not intend, and me not finding out**.

---

## 2. MEASURED STATE (2026-08-07, taken from commands, not judgement)

| | Measured |
|---|---|
| `server.js` | **8,363 lines** |
| Root-level modules | 124 |
| Test suites | **85, all passing** |
| HTTP routes | 204 |
| Mutating routes (POST/PUT/PATCH/DELETE) | **58** |
| …authenticated | **9** |
| …**unauthenticated** | **49** |
| Places reading `req.body` / `req.query` | 164 |
| Request schema validation (zod/joi/ajv) | **none** |
| HTTP rate limiting | **none** |
| Structured logging (pino/winston) | **none** |
| Express error middleware | **none** |
| `unhandledRejection` / `uncaughtException` handlers | 2 |
| Silent `catch {}` inside `server.js` | **55** |
| Persistence | **74 JSON files**. No SQLite, no Postgres |
| Supervision | pm2, `autorestart: true`, `max_restarts: 10` |

---

## 3. THE CONCRETE DEFECTS (each verified, not suspected)

**D1 — 49 unauthenticated mutating routes.** Including:

```
POST /api/bot/start            POST /api/nifty/engine/mode   ← flips paper ↔ live
POST /api/bot/stop             POST /api/nifty/engine/auto
POST /api/trade/execute        POST /api/strangle/enable
POST /api/test-trade           POST /api/gamma-blast/enable
POST /api/strategy-config      POST /api/pop/sell
```

The whole route is three lines:

```js
app.post('/api/nifty/engine/mode', (req, res) => {
  const { mode } = req.body;
  niftyEngine.setTradeMode(mode);
  res.json({ ok: true, mode });
});
```

Its SENSEX twin two hundred lines earlier **is** gated:

```js
app.post('/api/engine/mode', control('engine-TRADE-MODE'), (req, res) => { … });
```

The previous agent gated by matching `/api/engine/*` and never looked for the
instrument-prefixed duplicates. **This is the shape of the whole problem: a
control applied to some of the things it should cover provides the safety of the
ones it missed.** Any fix that enumerates routes by hand will reproduce it.

**D2 — The repository is not the running process.** An endpoint returned 404 for
a week while the code that serves it sat in the working tree, because nothing had
restarted. A wiring edit silently matched nothing and its test passed anyway. The
startup banner still prints:

```js
Mode: ${live.connected ? "LIVE (Dhan)" : "DISCONNECTED - set DHAN creds"}
```

…while the system is `upstox · paper · orders-refuse`. Three facts, all wrong, on
the first line an operator reads — two lines above engines correctly printing
`paper=true`.

**D3 — Irreplaceable data is being discarded, on a clock.**
- The market-data capture calls `r.json()` and the original bytes are gone. A raw
  journal module is written and tested (55 assertions) and **wired to nothing**.
- An unchanged snapshot is not written at all, so the archive cannot distinguish
  "the market did not move" from "we were not watching".
- One line deletes the option-candle archive once it exceeds 40 files, inside two
  nested `catch (_) {}`. It has not fired yet. It will.
- Capture has never started before 11:16 IST. The market opens at 09:15.

Price history can be re-bought from the broker. Last Tuesday's option chain at
11:00 cannot be bought back at any price.

**D4 — Unvalidated input has already destroyed a risk limit.**
`MAX_TRADES_PER_DAY="abc"` → `parseInt` → `NaN` → `tradesToday >= NaN` is false
for every possible count → **the daily trade cap silently ceases to exist**. No
error, no log, no test failure.

**D5 — In-memory counters reset on restart.** `tradesToday` and the open-position
state live only in memory, under a supervisor configured for 10 restarts. Ten
restarts is ten fresh daily trade budgets.

**D6 — 55 identical silent catches.** Some genuinely wrap optional work. None is
distinguishable from the ones that do not, because they are written identically.

**D7 — `server.js` dependency management is construction order.** 8,363 lines in
which "what is defined by the time this line runs" is the entire mechanism. This
is how the risk guard came to be constructed 2,300 lines *after* the engines that
were supposed to receive it — where it could not possibly have been passed to
them, and was not.

---

## 4. MY PROPOSED ORDERING — challenge it

The generic hardening order is: validation, rate limiting, logging, auth,
database, refactor. I claim that order is wrong **here**, because none of its
first three items prevents any of D1–D5.

My claim is that "strong" for this system means three things, in this order:

1. **It cannot lose money silently** → D1, D4, D5
2. **It cannot lose data that cannot be re-bought** → D3 (and this one has a date
   on it — the deletion fires at 41 files)
3. **It can be operated: I can see what it is doing and stop it** → D2, D6

And that the refactor of `server.js` (D7) belongs **last**, despite being the
most satisfying item, because a tidy `server.js` that is still one variable from
live, still losing chain data daily, and still not the process that is running,
is a tidier version of the same system.

**Tell me if you think that is wrong.**

---

## 5. WHAT IS ALREADY GOOD — the prompt must not undo it

- **85 test suites**, several of which caught real defects in the last week.
- **An order chokepoint**: exactly one code path may submit an order, and a
  bypass throws at run time rather than merely failing a lint rule.
- **A two-key rule** on the paths that have it: one flag grants capability, a
  second, separate flag grants permission to reach a broker. Neither alone is
  sufficient. **It is missing on four paths** — closing those is on the list.
- **An instrument registry** as single source of truth for lot size, tick size,
  strike interval and expiry weekday, verified against the broker's contract
  master on demand.
- **`null` is never silently converted to `0`.** An unknown quantity stays
  unknown and propagates as unknown. Verdicts are three-valued: PASS / BLOCKED /
  UNEVALUABLE, never merged.
- **Ratchets** (performance budget, repository integrity) that fired twice last
  week and were fixed at the cause rather than relaxed.

---

## 6. PERMISSION TIERS — the prompt must carry these

**Tier 0 — the agent may propose, and may never apply.** Credentials; risk
limits; the kill switch; position sizing; the order chokepoint; live-order paths;
production configuration; deletion of raw or audit data; and the critical test
set.

**Tier 1 — propose, do not apply.** `server.js` in its entirety; the engines; the
broker connectors; state persistence; reconciliation; the startup self-check.

**Tier 2 — the agent may apply.** New modules, new tests, documentation, and
scripts that only read.

**A test may never be modified to make something pass.** A failing test is the
finding. The single exception is a test *proven* wrong — and then the proof is
the deliverable, not the edit.

---

## 7. THE FIVE FAILURES THE PROMPT MUST FORBID BY NAME

Each of these actually happened in this codebase. Each produced a passing test
that protected nothing.

1. A data-quality gate matched a regular expression against **prose it had itself
   written** — and so did its test.
2. A wiring test confirmed the **consumer** called the right function, while the
   **provider** was still handing it the raw unguarded object.
3. A log-redaction test built a request with the token in `req.query` and a clean
   `url` — **a shape Express never produces**. The real request leaked the token.
4. A status fix read a capability **after** a guard had already replaced the
   method, and therefore reported the guard's behaviour rather than the
   connector's.
5. A provenance heuristic passed **the diagnostic probe the agent had itself
   injected**, and reported "real external signals are present" when the only
   such record was its own.

The generalisation, which the prompt should state outright:

> **A test that constructs its own input tests the constructor's idea of the
> input.** Where a real request, a real file, a real process launch or a real
> wiring can be exercised, it must be.

Related, and equally load-bearing: **a claim of completeness is the claim most
likely to be false.** An audit of the previous agent's own work found 4 of 12
claims materially inaccurate — 33% — and *all four* were claims of completeness
or of provenance, never claims about a specific line of code.

---

## 8. CONSTRAINTS ON ANY SOLUTION YOU PROPOSE

- **One process, one machine.** A second service is a second thing that fails
  during market hours. Prefer SQLite over Postgres, in-process over networked.
- **Market hours are 09:15–15:30 IST, Monday to Friday.** Nothing may require a
  restart during them.
- **Offline-capable.** No dependency that requires a live external service to
  start.
- **Fail closed.** Any ambiguity resolves to "do not trade". An unknown is never
  an assumed zero.
- **Node.js, CommonJS, Express.** No TypeScript migration as part of this work.
- The dashboard is dark-themed, built for 2560×1330, and **no page may scroll**.

---

## 9. NOW WRITE THE PROMPT

Give me the implementation prompt described in "WHAT I WANT BACK FROM YOU" at the
top. Ordered, with acceptance tests stated before the code, with the scope walls
and the five forbidden failures written in, and with a stopping rule.

If you think my ordering in §4 is wrong, correct it in the prompt and tell me why
in one line above it.
