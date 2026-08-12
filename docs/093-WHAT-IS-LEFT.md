# 093 — Everything That Is Left

**Measured 2026-08-12.** Ordered by what unblocks what, not by size.
Companion: docs/092 (can we go live), docs/089 (what was done).

---

## Where things stand

| | |
|---|---|
| Test suites | **99/99** |
| Files staged, **uncommitted** | **162** |
| Silent catches in `server.js` | **78** (was 82; four went with the fixes) |
| `heartbeat*` files | **none — the word does not appear in production code** |
| `reconcile*` files | **none** — three unrelated files mention the word |
| Running process vs tree | byte-identical, `attest-verify` exits 0 |

---

## 0. Commit — minutes, and it is first

162 files. Weeks of work: the chokepoint, the two-key rule, the route guard, the
limits, the counters, the screener, the backtester, D-8. All of it exists only in
one working directory on one machine.

Nothing else on this list matters if this is lost.

---

## 1. Heartbeats — a day. Yours to approve, mine to build.

**Nothing in production emits one.** No component reports that it is alive, so:

- feed-failure detection latency **cannot be measured**, because there is nothing
  to measure it against
- "the feed died at 11:04" is currently discovered by looking at a chart
- the drills in docs/073 cannot be rehearsed, because there is no signal to wait for

What it is: each long-running component writes `{ name, at, seq }` on a fixed
interval; one reader reports the age of each. A component that stops is visible
in seconds instead of at the next glance.

**Why it comes before reconciliation:** a reconciliation that silently stops
running is worse than no reconciliation, because its silence reads as agreement.

---

## 2. Reconciliation — days. **Unblocked as of today.**

Compare the internal book against the broker's, on a schedule, and report every
difference by name.

This was genuinely impossible until this afternoon. `scripts/smoke.js` carried
the reason in its own words: *"Building it on live-connector.getPositions() would
be unsound while that returns [] on error."* That is now fixed — an empty list
means flat, a failure throws, and `EMPTY_VERIFIED` exists as a distinct answer
from `EMPTY_UNVERIFIABLE`.

Rules it must follow, all of which the pieces already support:
- a difference is **never** auto-corrected; it is reported and it blocks
- `UNAVAILABLE` is not agreement — a broker that cannot be asked is a **blocking**
  state, not a passing one
- it runs on a heartbeat, so its own silence is visible (hence item 1 first)

---

## 2b. WHAT RECONCILIATION FOUND ON ITS FIRST RUN — 2026-08-12

Within eight seconds of being wired, it reported:

```
verdict  : UNAVAILABLE   blocking: true
reason   : the broker book is unavailable: getPositions() threw:
           Upstox /portfolio/short-term-positions: 401
           "The API you are trying to access is permitted only when requested
            from the static IP configured in your account."   (UDAPI1221)
```

Confirmed directly against the broker, outside this codebase, same 401 and same
error code.

**The portfolio API is unreachable from this machine.** The token is valid — it
serves quotes and chains all day. Upstox restricts portfolio endpoints to a
static IP registered on the account, and this machine is not it.

Three things follow, and the first is the reason D-8 was worth doing:

1. **Before D-8 this returned `[]`.** The system would have reported itself flat,
   permanently, and any reconciliation built on it would have said AGREED every
   minute of every day while never once reading the broker. The defect would have
   been invisible precisely because it never produced an error.
2. **Reconciliation cannot run at all until this is fixed** — not partially, not
   degraded. It blocks, which is correct.
3. **This is a live-gate blocker nobody knew about.** Position reads are not
   optional for real trading, and the fix is account configuration on Upstox's
   side: register the static IP, or run the bot from the address already
   registered.

**Owner: you.** Nothing in this repository can change it.

---

## 3. Two operational fixes — yours, not mine

### 3a. The 08:50 scheduled task fails every morning

```
Antigravity-Bot-Auto-Start   08:50 Mon–Fri   lastResult 2147946720
   → win32 4320: "The operator or administrator has refused the request."
AntigravityBot-Server        ON LOGON        lastResult 0   ✓ 09:22:31
```

It runs as `Interactive`, and at 08:50 nobody is logged on. **What actually
starts the capture is the logon trigger**, so capture begins whenever you log in
— 09:22 on a good day, 15:13 on 2026-07-27. That is the whole explanation for the
183-minute average loss at the open.

The fix is *"Run whether user is logged on or not"*, which requires storing the
account password. **I cannot do that and should not.**

### 3b. `CONTROL_TOKEN` is blank

Control endpoints are loopback-only. Verified: **`/api/engine/halt-all` still
reaches you from the tunnel** — halting is allowlisted precisely so that stopping
never needs a credential. Everything else returns 401 from the phone.

Set it, then rehearse the kill/reset drill against the tunnel once.

---

## 4. The last one-key path — an hour

`options_algo_dashboard.py`'s CLI path. The HTTP entry point it shares
(`options_algo_api.py`) already has both keys and its own test.

---

## 5. Triage the 78 silent catches — a day of reading

Enumerated by parsing, never triaged. Each needs one of three labels:
`EXPECTED-OPTIONAL`, `LOGGED`, `TODO-TRIAGE`. `node scripts/catch-triage.js
--assert` exits non-zero while any remain uncategorised.

**Categorising and changing them are two different commits.** Doing both at once
is how a "tidy-up" changes behaviour nobody reviewed.

---

## 6. A decision only you can make — the chain journal, 31.5 GB/year

Measured over 24 hours of real use: 3.7 MB/hour, 88 MB/day. `repeat` records
collapse the deterministic payloads, and **cannot** collapse the option chain,
which carries a server timestamp and recomputed Greeks — the bytes differ on
every poll even with the market shut.

1. **Accept it.** Disk is cheap; an unrepeatable Tuesday is not.
2. **Journal chains only when the fingerprint changes.** Volume collapses; the
   exact bytes of skipped polls are gone, and calling the result a *raw* journal
   afterwards would be a lie.
3. **Poll less out of hours** — scheduler, not code. `warehouse-capture` refuses
   to add a fourth copy of session logic and says so at the top of the file.

Option 1 is in force because it is what the code does. Nothing was chosen for you.

---

## 7. Before real money — the part that runs on a calendar

### 7a. `placeOrder` does not exist

```js
throw new Error('Upstox placeOrder not implemented — paper mode only');
```

Both keys turned today and **nothing happens**. This is the last accidental
protection in the system: the moment those twenty lines are written, every other
safeguard becomes the only thing between a signal and real money.

Write it **last**, after 1–2 are running, and prove it with **one lot, by hand**,
watching the whole chain: the guard's approval, the breaker's count, the journal
record, the reconciliation match, and the broker's own contract note.

### 7b. Forward-test, on an agreed number of sessions

- **NIFTY intraday directional: no edge.** MEASURED — 1,200 trades, 197 days,
  profit factor 0.94.
- **Short strangle: 89% win** on 120 days of real bhavcopy, **never
  forward-tested**. A high win rate on short premium is exactly the shape that
  hides its losses in the tail.

Agree the number of sessions **before** starting, or the test ends whenever the
result is pleasing.

**This cannot be shortened by working harder.** It is the only item here that
runs on a calendar rather than on effort, which is why it should start now, in
paper, while 1–5 are built.

---

## 8. Deliberately NOT next

- **Splitting `server.js`.** 8,400 lines, and the map is drawn. The most
  satisfying job on this list and the least protective — a tidy `server.js` that
  is still one file from live and still losing morning chain data is a tidier
  version of the same system.
- **The option-selling screener (docs/091 item 3).** Needs a year of IV history
  that has never been recorded. Starting that clock is an investment, not a
  requirement — and it starts paying only in a year.

---

## The order, in one line each

1. **Commit.** 162 files.
2. **Heartbeats** — so silence becomes visible.
3. **Reconciliation** — newly possible; must block, never auto-correct.
4. **Your two:** the 08:50 task, and `CONTROL_TOKEN`.
5. **Start the paper forward-test** — it runs on a calendar, so start it while
   building the rest.
6. Last one-key path · triage the 78 catches · decide the journal volume.
7. **Then, and only then:** `placeOrder`, and one manual lot.
