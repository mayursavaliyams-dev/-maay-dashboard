# 089 — Backend Hardening, Phases 0b → 4

**Run date 2026-08-08. Full suite: 93/93 green (was 85 before this work).**
Every number has the command that produced it. Nothing in Tier 0 or Tier 1 was
applied; those diffs are below, unapplied, as required.

Companion: docs/088 (Phase 0, attestation).

---

## Summary

| Phase | Delivered | Tests | Applied? |
|---|---|---|---|
| 0 | `attestation.js`, `scripts/attest-verify.js` | 12/12 | Tier 2 yes · endpoint diff **no** |
| 0b | `retention.js` | 11/11 | Tier 2 yes · server.js diff **no** |
| 1A | `route-guard.js` | 12/12 | Tier 2 yes · install diff **no** |
| 1B | `limits.js` | 21/21 | Tier 2 yes · call-site diffs **no** |
| 1C | `day-counter.js` | 12/12 | Tier 2 yes · engine diffs **no** |
| 1D | `test/two-key-rule.test.js` — audit only | 7/7 | **nothing applied (Tier 0)** |
| 2 | `capture-coverage.js` | 10/10 | Tier 2 yes · capture diff **no** |
| 3 | `banner.js`, `scripts/catch-triage.js` | 19/19 | Tier 2 yes · banner diff **no** |
| 4 | `scripts/construction-order.js` | map | analysis only |

---

## The four numbers that changed after measurement

Each of these was in the brief, and each was **wrong** — in every case because
the tool that produced the original number was broken in the direction of
reporting less.

| | Brief said | Measured | How it was found |
|---|---|---|---|
| Silent catches in `server.js` | 55 | **82** | grep matched 3 literal spellings; parsing found the rest |
| One-key order paths | 4 | **5**, of 11 order-capable files | the audit's own search was broken (below) |
| Capture start | "never before 11:16" | **mean 183 min late, worst 358** | 19 days measured, only 2 from the open |
| Files receiving a broker at construction | assumed many | **2** | `scripts/construction-order.js` |

---

## PHASE 0b — the archive stops deleting itself

**Deadline, measured today:** `data/opt-candles` holds **19 files / 62.7 MB**,
capped at 40. Headroom **21 trading days**. Earliest deletion **2026-09-07**
(weekends excluded; holidays not, so that is the earliest date, not the expected
one). A second loop caps `data/opthl` at 120; it holds 27, headroom 93.

**The shipped code proven to delete**, by lifting the expression verbatim out of
`server.js` and running it against a temp directory:

```
§1 — the SHIPPED expression, lifted verbatim from server.js, deletes
  ✓ server.js still contains the retention loop this test is about
  ✓ 45 files through the shipped opt-candles loop → 5 are unlinked
      (confirmed: 45 → 40, five days of option chain unlinked, silently)
  ✓ and it swallows the failure: an undeletable file leaves no trace
      (a deletion that fails silently and one that succeeds silently look identical)
```

**The policy in `retention.js`:** never delete by default. Deletion needs three
things and the absence of any one is a refusal — permission, a destination, and
**proof the copy arrived**. The third is the one that is easy to skip:
`fs.copyFileSync` not throwing is not evidence the bytes are at the destination.
A full disk, a truncating filesystem, or a destination that rewrites content all
return without error. The file is re-read and SHA-256-compared before the
original is unlinked.

### DIFF 0b — Tier 1, `server.js:741` and `:704`. Not applied.

```diff
-    const files = fs2.readdirSync(_optCandDir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
-    while (files.length > 40) { try { fs2.unlinkSync(path2.join(_optCandDir, files.shift())); } catch (_) {} }
-  } catch (_) {}
+    /* Retention is a policy decision, not a loop. See retention.js: pressure is
+       reported; deletion requires permission, a destination, and a verified
+       copy. The previous form deleted five days of option chain at the 41st
+       file, silently, inside a catch that made a failed deletion and a
+       successful one indistinguishable. */
+    const r = enforceRetention({ dir: _optCandDir, cap: 40, log: console });
+    if (r.refused) console.warn(`[opt-candles] ${r.reason}`);
+  } catch (e) {
+    console.error('[opt-candles] persist failed:', e.message);
+  }
```

Same shape at `:704` with `cap: 120` and `_optHLDir`. Add
`const { enforceRetention } = require('./retention');` beside the other requires.

**Note the second half of the diff.** Removing the deletion without removing the
outer `catch (_) {}` leaves the archive safe and the failures still invisible.

---

## PHASE 1A — an ungated mutating route cannot be created

The fix is **not** to gate 49 routes. That is what was done last time, and it
produced `/api/nifty/engine/mode` — a three-line route calling
`niftyEngine.setTradeMode(mode)`, ungated, while its SENSEX twin two hundred
lines earlier is gated.

`route-guard.js` wraps `app.post/put/patch/delete`, `app.all` and
`app.route().post()`. A route is gated because it was registered. Leaving one
open requires an allowlist entry, and **an entry without a written reason is
rejected at install time**.

A finding from building it: identifying the gate **by function name** does not
work. `ControlAuth.gate()` returns an arrow function whose `.name` is `""`, so
every gated route would have counted as ungated and Phase 1A could never have
gone green. Identification is now by marker-or-source, and the predicate is
proven against a real `ControlAuth` gate before its counts are used.

### DIFF 1A — Tier 1, `server.js`, immediately after `const app = express()`

```diff
+const { installRouteGuard } = require('./route-guard');
+/* Install BEFORE any route is registered. Routes registered above this line are
+   not wrapped; auditRoutes() reports them, and app.__routeGuard.preExisting
+   records the gap rather than leaving it to be assumed absent. */
+installRouteGuard(app, {
+  gate: control,
+  allowlist: [
+    { path: '/api/engine/halt-all', methods: ['post'],
+      reason: 'only ever reduces risk; an operator must be able to stop the system without a credential' },
+  ],
+});
```

`control` is already defined at `server.js:269`. **The allowlist above is a
proposal with one entry and the operator must review it** — every route not on it
becomes gated, and some of them may be called by the dashboard without a token.
That is the point of the change and also its risk, and it is the reason this is a
proposal rather than an edit.

---

## PHASE 1B — a malformed limit is a refusal, not a NaN

Proven against the real engine, not a paraphrase:

```
AFTERNOON_MAX_TRADES=abc  →  parseInt("abc")  →  NaN
afternoon-engine.js:374   →  if (this._tradesToday >= this.maxTrades) return;

  tradesToday=         0  >= NaN  →  false
  tradesToday=         1  >= NaN  →  false
  tradesToday=       100  >= NaN  →  false
  tradesToday=1000000000  >= NaN  →  false
```

The cap is false for every possible count. **The limit does not exist**, with no
error, no log and no test failure.

**A correction to the brief.** `risk-config.js:132` already rejects non-finite
values, with this reasoning written beside it: *"not a finite number — a NaN
limit disables its check entirely."* The dedicated risk module is not the
problem. The engines parse their own limits straight out of the environment and
never go near it. The affected variables are `AFTERNOON_MAX_TRADES`,
`MAX_CONSECUTIVE_LOSSES` and their neighbours — **not** `MAX_TRADES_PER_DAY`,
which the brief named.

`limits.js` uses `Number()` rather than `parseInt`, deliberately:
`parseInt("12abc")` is `12` — it reads a prefix and discards the rest, so a
mistyped value silently becomes a *different valid value*.

**Rule 2 is the one that is tempting to break:** a malformed value is an error,
never the default. Falling back to the default feels safe and converts an
operator's typo into a silent policy change.

### DIFF 1B — Tier 0 (risk limits), `afternoon-engine.js:86-135`. Not applied.

```diff
+const { assertLimits } = require('./limits');
+const L = assertLimits({
+  AFTERNOON_MAX_TRADES:  { default: 1,  min: 0, max: 50,  integer: true },
+  MAX_CONSECUTIVE_LOSSES:{ default: 5,  min: 1, max: 50,  integer: true },
+  MAX_DAILY_LOSS_PERCENT:{ default: 2,  min: 0, max: 100 },
+  MAX_DRAWDOWN_PERCENT:  { default: 20, min: 0, max: 100 },
+});
-    this.maxTrades       = parseInt(process.env.AFTERNOON_MAX_TRADES || 1);
-    this.maxConsecLosses = parseInt(process.env.MAX_CONSECUTIVE_LOSSES || 5);
+    this.maxTrades       = L.AFTERNOON_MAX_TRADES;
+    this.maxConsecLosses = L.MAX_CONSECUTIVE_LOSSES;
```

The bounds are **proposals**. They are risk limits, which is Tier 0, and the
numbers are the operator's to set.

---

## PHASE 1C — a restart is not a new trading day

`tradesToday` lives in memory; pm2 allows 10 restarts. Ten restarts is ten fresh
daily budgets, and the engine reports "0 trades today" truthfully about its
memory.

`day-counter.js` keys the count to the **IST calendar date and nothing else** —
not the process, not a session, not "since the engine started", each of which
makes a restart look like a new day. In particular it does **not** reset at
09:15: a restart at 09:20 loads what was recorded at 09:00.

Proven with genuinely separate processes:

```
✓ 3 trades recorded in one process are visible to the next
✓ ten restarts do not produce ten budgets          (10 processes, count reaches 10)
✓ the write happens at increment, not at shutdown  (process.exit(0), no hooks)
✓ a restart across the 09:15 open does NOT reset
✓ a genuine new IST day DOES reset
✓ a corrupt file yields null, never 0
```

The last one matters most: a corrupt state file returns **null**, not zero. Zero
is a claim that no trades happened, and an unreadable file is not evidence of
that. A caller that cannot get a count must refuse to trade.

---

## PHASE 1D — the two-key audit (Tier 0, nothing applied)

**11 files can reach a broker. 5 are one-key.**

```
ONE-KEY PATHS — TRADE_MODE=live alone would arm these:
  ! afternoon-engine.js         (expects ALLOW_LIVE)
  ! execution-engine.js         (expects ALLOW_LIVE)
  ! limit-order-engine.js       (expects ALLOW_LIVE)
  ! options_algo_dashboard.py   (expects OPTIONS_API_ALLOW_LIVE)
  ! stock/stock-engine.js       (expects STOCK_ALLOW_LIVE)
```

Also confirmed: **`LIVE_AUTO_CONFIRM` has no readers in any `.js` or `.py` file.**
It is documented and read by nothing (D-16). A flag an operator believes in and
no code reads is worse than no flag.

`flatten.js` is deliberately exempt: an exit that needs permission is a position
that cannot be closed during the incident that made closing necessary.

### THE LIMIT OF THIS AUDIT, stated rather than glossed

The check confirms the key **string appears in the file**. It does not confirm
the order path consults it. So:

```
confirmed one-key : 5 of 8
UNEVALUABLE       : 3 — file-level presence is not path-level proof
```

Settling the remaining three needs a runtime probe: set key 1 only, drive each
path, assert the broker was never reached. The parity harness can do it. **It has
not been run for this purpose.** Recorded, not claimed.

### DIFF 1D — Tier 0. Not applied. One shape, five places.

```diff
+const { livePermission, liveBlocked } = require('./live-permission');
+const KEY2 = 'ALLOW_LIVE';                    // STOCK_ALLOW_LIVE / OPTIONS_API_ALLOW_LIVE per deployable
 
   // immediately before the placeGuarded / placeOrder call:
+  const perm = livePermission(KEY2);
+  if (!perm.granted) return liveBlocked(KEY2, { intent, reason: perm.reason });
```

`livePermission` grants only on the word `true`, trimmed and lower-cased — the
same convention as every other flag here. A secretly case-sensitive permission
flag is worse than a permissive one: an operator who sets `TRUE` and sees no
effect concludes the feature is broken rather than that the value is wrong.

---

## PHASE 2 — data that cannot be re-bought

### The measurement, over all 19 archived days

```
day          IST window        vs 09:15–15:30
2026-07-06   14:20 → 15:29    305 min after the open
2026-07-08   09:15 → 15:29      from the open
2026-07-27   15:13 → 15:29    358 min after the open      ← the last 16 minutes only
2026-07-31   09:15 → 15:29      from the open
2026-08-07   09:22 → 14:03      7 min after the open      ← and 87 min missing at the CLOSE

days measured        : 19
captured from open   : 2
mean minutes missed  : 183 per day
worst                : 358 min
```

Two days of nineteen. This is materially worse than the brief's "never started
before 11:16", and it was invisible until a script was written to ask.

`capture-coverage.js` makes it a stored fact rather than an archaeology exercise.
Its central distinction:

- **`unchanged`** — we looked and it was the same. A positive observation.
- **absent** — we were not looking.

The capture currently writes nothing when nothing changed, so those two are
identical in the archive, and every backtest silently treats our downtime as a
quiet market.

`canAnswer(from, to)` returns false when any trading day in a period has no
record at all. A day we have no record of is not a day we may call quiet.

### 2A — WIRED, 2026-08-12, and what one day of real use taught

`raw-journal` and `capture-coverage` are now both live in `warehouse-capture.js`.
The old `jget` was six lines with two defects:

```js
async function jget(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();          // the bytes end here
  } catch (_) { return null; }      // and so does the reason
}
```

It now reads text, journals the bytes, and *then* parses — so a parse failure
costs a re-parse rather than a day. It returns `{ ok, json, status, error }`, so
a network failure, an HTTP 500 and a quiet market are three different answers
instead of the same `null`.

Every branch of the chain poll records coverage, including `unchanged`, which is
a positive observation: we looked and it was the same.

**Verified on disk:** `data/raw-journal/L0_journal/warehouse-capture/2026-08-12/16.jsonl`,
a `chain:NIFTY` body of 72,559 bytes that re-parses to the payload.

#### The volume, measured after 24 hours

| | |
|---|---|
| Journal growth | **3.7 MB/hour** |
| Per day | **88 MB** |
| Per year | **31.5 GB** |
| Capture cadence | `--every 300` (5 minutes) |

The loop runs around the clock, so most of that is out-of-hours polling.

**Coverage is bounded by cadence.** Coverage is recorded per minute; a 5-minute
poll can cover at most ~75 of the 376 session minutes — **about 20%, by design,
with nothing wrong.** Reading 20% as an outage would be as wrong as reading it as
full coverage.

#### Content addressing: works, except where it matters most

`warehouse-capture` says at the top that *"each writer is CONTENT-ADDRESSED"*.
The journal was the one writer that was not, so a `repeat` record was added — it
carries the SHA-256 of the bytes it repeats, so the payload stays reconstructable
and only the duplication goes.

Measured over four polls:

```
chain:BANKNIFTY  observation 8   repeat 0
chain:NIFTY      observation 8   repeat 0
chain:SENSEX     observation 8   repeat 0
engine:nifty     observation 4   repeat 4
engine:sensex    observation 4   repeat 4
pop:status       observation 4   repeat 4
```

**It dedupes the deterministic payloads and cannot dedupe the chain.** Two
consecutive chain bodies, with the market closed:

```
identical bytes? false     72,559 vs 72,565
common prefix 107          common suffix 2
"timestamp":"2026-08-12T10:41:05.069Z","ts":1786531265069
"timestamp":"2026-08-12T10:42:05.089Z","ts":1786531325089
```

The chain carries a server timestamp **and recomputed Greeks** — theta, delta and
IV all shift against a moving clock even after the close — so the bytes differ on
every poll and raw content addressing can never collapse them.

**That leaves a decision, and it is the operator's, not mine:**

1. **Accept 31.5 GB/year** for a genuinely raw archive. Disk is cheap; an
   unrepeatable Tuesday is not.
2. **Journal chains only when `chainFingerprint` changes.** The fingerprint
   already ignores the timestamp and the Greeks, which is why the capture logs
   `unchanged`. This would collapse the volume — and it would mean the journal no
   longer holds the exact bytes of the skipped polls. That is a real loss, and
   calling the result a *raw* journal afterwards would be a lie.
3. **Poll less out of hours.** `warehouse-capture` explicitly refuses to add
   session logic — *"Session logic already exists three times in this repo with
   divergent open times; a fourth would make the drift worse"* — so this belongs
   in the scheduler, not the code.

Nothing was chosen. Option 1 is in force because it is what the code already
does.

### 2A (superseded) — the raw journal was wired to nothing

`warehouse-capture.js:82` calls `return await r.json()` and the original bytes
are gone. `raw-journal.js` exists with 55 passing assertions and **is required by
exactly one file: its own test.** The wiring diff is in docs/077 §6.1 and remains
unapplied.

---

## PHASE 3 — operable

### 3A — the banner

```
shipped : Mode: LIVE (Dhan)
derived : Mode: upstox · PAPER · orders refuses · blocked by connector and mode
```

The defect is not the string. It is that the string is derived from
`live.connected`, which answers whether a **market-data session** was
established, and has never had anything to say about which broker, which mode, or
whether an order could be placed.

Capability read from the real connector modules:

```
UpstoxConnector      → refuses
KotakNeoConnector    → none            ← no placeOrder method at all (confirms D-7)
LiveConnector        → live-capable
```

`liveOrdersPossible` names **which** key is missing, because "no, the mode is
paper" and "no, the connector refuses" call for completely different actions.

**DIFF 3A — Tier 1, `server.js:8302`. Not applied.** Both variables already exist
at `server.js:193`:

```diff
-║   Mode: ${live.connected ? "LIVE (Dhan)" : "DISCONNECTED - set DHAN creds"}    ║
+║   ${renderBanner({ connector: CONNECTOR_NAME, tradeMode: process.env.TRADE_MODE,
+                     orderCapability: CONNECTOR_ORDER_CAPABILITY })}
```

### 3B — the silent catches: 82, not 55

```
══ SILENT CATCHES — server.js ══
  total silent      : 82
  EXPECTED-OPTIONAL : 0
  LOGGED            : 0
  TODO-TRIAGE       : 82
```

The brief said 55. That was a grep for three literal spellings. Parsing — with
comments and string literals blanked first, so a brace inside a string cannot
shift the count — finds **82**. The extra 27 are `catch(e){}`, catches whose body
is only a comment, multi-line catches, and catches containing a bare `return`.
Same defect, different clothes.

**Per the prompt: the discrepancy is reported, not reconciled by adjusting either
number.**

All 82 are TODO-TRIAGE, because the default is *undecided*, never *fine*. An
unexamined catch has not been judged safe. `node scripts/catch-triage.js` prints
line, what it swallows, and the source; `--assert` exits non-zero while any
remain uncategorised.

**No behaviour was changed in this phase.** Categorising 82 catches and changing
them are two different changes and must not share a commit.

---

## PHASE 4 — construction order

```
file length                : 8,364 lines
top-level constructions    : 97
top-level requires         : 117
raw connector  'live'      : line 193
guard 'guardedBroker'      : line 256

WHO RECEIVES A BROKER
   line  name                  receives     verdict
    256  guardedBroker         live         (wraps it — correct)
   6032  marginCalculator      live         RAW CONNECTOR
```

**Only two constructions receive a broker at all.** Every engine —
`ExecutionEngine` ×2, `AfternoonEngine` ×2, `BounceEngine`, `StrangleEngine`,
`GammaBlastEngine`, `TrendRideEngine`, `LimitOrderEngine`, `AgentsEngine`,
`AmiBrokerBridge` — takes **no broker at construction** and must be wired
afterwards, by assignment or by a setter this scan cannot see.

That is the finding, and it is why the phase stops here as the prompt allows.
`marginCalculator` holding the raw connector is not a defect — it reads margins
and is not an order path — but it is the only other place a broker object flows,
and it is worth knowing.

**What this proves:** a consumer constructed before line 256 cannot hold the
guard. `agentsEngine` (line 33) and `amiBridge` (line 223) are both before it.
`amiBridge` is wired at `registerRoutes(app, {…})` on line 464, which is after —
so it *could* hold the guard. Line order proves a negative; only the live object
graph confirms the positive, and that is attestation's `orderConsumers`, still
empty.

---

## Four defects in my own work, found and fixed

Recorded because the pattern matters more than the instances.

1. **Gate detection by function name.** `ControlAuth.gate()` returns an arrow
   function; `.name === ""`. Every gated route would have counted as ungated.
2. **`EXCLUDE` regex needed a leading separator.** `git grep` returns
   root-relative paths, so `test/flatten.test.js` was never excluded and four
   test files were reported as production order paths — 8 findings where the real
   number was different. Over-reporting is not the safe direction: it buries the
   real items.
3. **The audit's search failed closed to zero.** `execSync` on Windows goes
   through `cmd.exe`, which stripped the backslashes; git rejected the pattern and
   exited non-zero; `catch (_) { out = ''; }` turned that into an empty result.
   **The audit reported a clean system.** This is the same silent-catch defect
   Phase 3 is about, committed inside the tool auditing for it. Fixed with
   `execFileSync` (no shell) **and** by making a failed search throw.
4. **`split('\n')` left `\r`, and JS `.` does not match `\r`.** 48 lines in, 33
   parsed, 15 lost — all from CRLF-stored files, which is `server.js`,
   `execution-engine.js`, `afternoon-engine.js`, `amibroker-bridge.js` and
   `stock/stock-engine.js`. The audit found 3 of 11 order-capable files and every
   assertion passed on the three it could see.

**Number 4 is the third occurrence of this exact defect in this project.** The
credential scanner reported `.env: none` for a file holding five credentials for
the same reason. A line-oriented tool written on Windows that splits on `'\n'`
and matches with `.` will under-report, silently, always in the direction of
"nothing found".

Defects 3 and 4 both meant the two-key audit was reporting **5 of 11** files as
**3 of 3, all clean**. The finding of "1 one-key path" that I reported mid-run
was wrong; the real number is 5.

---

## What I did NOT verify

- **No Tier 0 or Tier 1 diff was applied**, so none has ever run inside
  `server.js`. Line numbers are as of today.
- **`route-guard.js` has never been installed on this application's Express app.**
  It is proven against real Express apps with real gates, including a mounted
  sub-router — but a four-route app is not `server.js`. The in-process route count
  must be compared against the 58 measured by parsing, and **if those two numbers
  disagree, the discrepancy is the finding.**
- **The allowlist has one entry and is a guess.** Some ungated routes are called
  by the dashboard without a token; gating them will break those calls. Which
  ones, I have not determined.
- **The three UNEVALUABLE two-key paths are unresolved.** File-level presence is
  not path-level proof and no runtime probe was run.
- **`capture-coverage.js` is not wired to the capture.** It measures the existing
  archive; it is not yet recording anything live.
- **`day-counter.js` is not wired to any engine.** The engines still count in
  memory.
- **The 82 catches are enumerated, not triaged.** Deciding which are genuinely
  optional requires reading each one; that has not been done.
- **Phase 4 stops at the map.** No code was moved, and the map cannot see wiring
  done by assignment or setter after construction — which, for every engine in
  this system, is how it is done.
- **Why the server stopped mid-session on 2026-08-08 (D-18).** No stack trace, no
  exit line. Restarted; cause unestablished.

---

## Recommended order for applying

1. **DIFF 0b** — it has a date on it. 21 trading days.
2. **DIFF 3A** — one line, no behaviour change, removes a lie an operator reads
   on every start.
3. **Phase 0 endpoint** (docs/088 §5) — after which everything else can be
   verified against the running process rather than the tree.
4. **DIFF 1A** — after reviewing the allowlist against what the dashboard calls.
5. **DIFF 1D** — five places, one shape.
6. **DIFF 1B / Phase 1C wiring** — Tier 0 bounds are the operator's to set.
