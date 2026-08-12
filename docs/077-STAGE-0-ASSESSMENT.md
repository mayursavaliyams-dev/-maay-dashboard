# 077 — Which Stage Is This System In? Evidence, Not Intent

**Date:** 2026-07-31
**Method:** every claim below cites a file and line, or a command and its output.
**Answer:** **Stage 0, open.** 0a is structurally complete and unproven in
production. **0b is largely absent. 0c is absent.**

Nothing in Stages 1–6 is valid while Stage 0 is open. Several Stage 1 components
have been built (execution, risk, margin, data-quality gate, validation harness).
They are not thereby valid: each assumes a capture and a contract history that do
not yet exist, and their results inherit that.

---

## 1. Stage 0a — the order chokepoint

**Status: structurally complete. Zero days of live operation.**

| Requirement | Evidence |
|---|---|
| One point every order passes through | 7 raw call sites moved; `test/order-path-characterization.test.js §1` asserts **0** raw sites remain |
| Enforced structurally, not by convention | `risk-guard.js` replaces the wrapped connector's `placeOrder` with a thrower; calling it raises `RISK_BYPASS_ATTEMPT` (`test/order-path-chokepoint.test.js §2`) |
| Construction order correct | guard at `server.js:247`; all six consumers after it (§1 of the same test) |
| Order-rate circuit breaker | `order-breaker.js`, latching on rate / per-instrument / duplicate, wired inside the guard |
| Closing orders never blocked | `approveReducing`, with a two-file caller allowlist asserted |

**What it is not.** Doc 075 §9 requires one full week of live operation before
Phase 3 opens. It has had none. This is evidence about recorded sessions and
unit behaviour, not about production.

Also outstanding from doc 075 §7: A5, A7, A8, A9, A10, A11 — six audited defects
belonging to later phases and to operations.

---

## 2. Stage 0b — raw data capture

**Status: largely absent.** What exists is a derived, column-projected,
deduplicated poll — not a journal.

### 2.1 The raw bytes are discarded at a single line

```js
// warehouse-capture.js:78-85
async function jget(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();          // ← the response body is parsed and dropped
  } catch (_) { return null; }
}
```

Principle 3 requires journalling every inbound byte **before** parsing.
`r.json()` parses and returns an object; the bytes are never written anywhere.
Everything downstream is a projection of a projection, and none of it is
rebuildable from raw because there is no raw.

The same function makes a failed poll indistinguishable from an empty one: a
non-OK status returns `null`, and so does a thrown fetch. Principle 2.

### 2.2 What is stored is a fixed column projection

```js
// warehouse-capture.js:89-91
const LEG_COLS = ['ltp','oi','changeOI','volume','iv','ivSource','open','high','low','close', …]
```

`buildChainSnapshot` copies these columns and nothing else. Any field the broker
adds — or any field this list was wrong about — is lost at capture time and
cannot be recovered, because §2.1 means there is no original to go back to.

### 2.3 An unchanged snapshot is not recorded at all

```js
// warehouse-capture.js
const fp = chainFingerprint(snap);
if (state[`chain:${inst}`] === fp) { summary.chain[inst] = 'unchanged'; continue; }
```

This is the most consequential line in the capture path. A snapshot whose
observed columns match the previous one is **discarded**, not written. So the
archive cannot distinguish:

- the market did not move, and we were watching, from
- we were not watching.

Coverage is required to be a recorded fact (Workstream 1: *"Coverage gaps
recorded as facts"*). Here, absence is the same as stillness. It also explains
the measured cadence: doc 072 §2.3 recorded a median 5-minute gap and a 44.7-
minute hole on 2026-07-27, and neither can now be attributed to the market or to
the capture.

### 2.4 The writer has none of the required properties

```js
// warehouse-capture.js:54-57
function appendLine(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}
```

| Required | Present |
|---|---|
| Hourly rolled | no — one file per day |
| Dual disk | no |
| Self-describing header | no |
| Crash-tolerant / truncation detectable | no |
| Per-file SHA-256 manifest | no (`_manifest/` holds only fingerprint state) |
| Seek index | no |

### 2.5 No websocket frame journal exists

`dhan-ws-feed.js:132` has an `on('message')` handler; it updates an in-memory
`_lastTick` map and journals nothing. It is also the inactive Dhan path. The
live Upstox feed has no frame journal at all.

### 2.6 Official files are not landed daily

`bt-bhav-fetch.js` contains no scheduler and no `require.main` guard hooked to
one. Measured: `bt-data/bhav/` holds 600 files ending **2026-06-17**. Today is
2026-07-31 — roughly **30 trading days** unfetched.

### 2.7 What capture actually starts and misses

Measured across every captured session (doc 072 §2.3): capture begins between
**11:16 and 12:06 IST on 4 of 4 days**. The market opens at 09:15. Between two
and two hours fifty-one minutes of every session has never been captured.

---

## 3. Stage 0c — effective-dated contract metadata

**Status: absent.**

```
$ grep -n "effective|effectiveFrom|asOf|validFrom|history" instrument-registry.js
(no matches)
```

The registry is a **current snapshot** carrying `PROVENANCE.verifiedAt:
"2026-07-09"`. It is broker-verified and correct for today, and that is the
whole problem: the brief records that lot sizes changed in November 2024 and
again for the January 2026 cycle, that weekly expiries ended for BANKNIFTY,
FINNIFTY and MIDCPNIFTY in November 2024, and that NSE moved to Tuesday and BSE
to Thursday in September 2025.

Every historical P&L computed with today's lot size is wrong, and wrong by a
multiple rather than a rounding. The 600-day backtests in `bt-data/` span all of
those changes.

**One mitigation already exists and is worth stating:** the market lot is a
column in the UDiFF bhavcopy itself (verified: `nifty-20260617.csv` field 28 =
`65`). So the effective-dated lot series is derivable from data already on disk,
without an external circular table. Expiry-weekday history is likewise derivable
from the expiry dates present in each day's file.

---

## 4. Stage 0 gap list — the only work that is valid right now

In order. Nothing below the first open item may be started.

| # | Requirement | State |
|---|---|---|
| 0a.1 | Chokepoint exists and is structurally enforced | **DONE** |
| 0a.2 | One week of live operation behind it | **OPEN** — calendar, not code |
| **0b.1** | **Raw journal: every inbound byte written before parsing** | **OPEN** |
| **0b.2** | **Hourly roll, self-describing header, dual disk, manifest, truncation-detectable** | **OPEN** |
| **0b.3** | **Coverage recorded as a fact — an observation is written even when unchanged; a gap is written when nothing arrived** | **OPEN** |
| **0b.4** | **Websocket frame journal on the live feed** | **OPEN** |
| **0b.5** | **Daily landing of official files with hashes** | **OPEN** |
| 0b.6 | Capture starts at 09:15 and holds a fixed cadence | **OPEN** — configuration and supervision (doc 073 A4, A5) |
| **0c.1** | **Effective-dated contract terms, derived from the bhavcopy already held** | **OPEN** |
| 0c.2 | Permanent canonical instrument IDs, never reused | **OPEN** |
| 0c.3 | Date-ranged symbol maps per source | **OPEN** |
| 0c.4 | Exchange calendars incl. Muhurat and holiday-shifted expiries | **OPEN** |
| 0c.5 | Unresolved-symbol queue nothing bypasses | **OPEN** |

**0b.1–0b.3 come first**, because they are the only items on this list whose
cost rises every day. 0b.5 and 0c.1 are recoverable — NSE will still publish
last week's bhavcopy next year. A chain snapshot not written today is gone.

---

## 5. A note on the order of work, and on permission

Doc 076 places `warehouse-capture.js` in **Tier 1 — propose only, human applies
after independent review**. That tier assignment was written one day ago and it
applies to this work.

So the journal writer is delivered as a **new, self-contained module with its own
tests, wired to nothing**, plus a written diff for the wiring. The module can be
reviewed and run in isolation; the change to the live capture path is a human
keystroke. This is not ceremony: the capture path is the one component whose
failure loses data that cannot be bought back, and doc 076 §7 records that in
the last session an agent-applied wiring change silently failed while its test
passed.

---

## 6. Delivered: `raw-journal.js` (Stage 0b.1–0b.3)

`raw-journal.js` + `test/raw-journal.test.js` — **55 assertions, suite 80/80.**
Wired to nothing. Reviewable and runnable in isolation.

| Requirement | How |
|---|---|
| Raw bytes before parsing | `write({ body })` takes a Buffer or string and stores it verbatim; utf8 when it round-trips exactly, base64 otherwise, recorded **per record** so a binary websocket frame and a JSON REST body share one stream without either being mangled |
| Append-only | only `write()` reaches the file; the reader is a separate function that never opens for writing |
| Hourly roll | file per `L0_journal/<stream>/<YYYY-MM-DD>/<HH>.jsonl`, IST |
| Self-describing header | first line of each file names format, version, stream, hour, writer, and the meaning of every record field |
| Dual disk | `mirrorRoot`; `status().mirrored` reports **false** when absent, so one copy is never assumed to be two |
| SHA-256 manifest | sealed on roll and on `close()`; mirror hashed **independently** and compared |
| Truncation detectable | `readJournalFile()` returns `truncatedTail` separately from `malformed` — a crash mid-append and a corrupt line mid-file are different facts |
| Absence is a fact | `gap()` and `error()` write a record with a null body and a reason. **An observation with no body is refused** — it would read as data later |

Two design points worth reviewing specifically, because both are deliberate and
both look wrong at a glance:

- **A mirror-write failure does not fail the write.** Refusing to keep one copy
  because the second disk is full would convert a degraded state into a total
  loss. It is counted, logged, and reported to the caller as `mirrored: false`.
- **A primary-write failure returns `{ok: false}` rather than throwing.** The
  caller is a capture loop; a throw would end the cycle. The failure is counted
  and surfaced so the loop can record it and continue.

### 6.1 Proposed wiring diff — TIER 1, FOR HUMAN APPLICATION

Not applied. Review, then apply by hand.

**`warehouse-capture.js`, near the top:**

```diff
+const { RawJournal } = require('./raw-journal.js');
+
+/* Stage 0b. The journal records what ARRIVED. The projections below record
+   what we currently think matters about it — and that second thing has been
+   wrong before. Mirror disk is opt-in via WAREHOUSE_MIRROR; when it is unset
+   there is one copy and status() says so rather than implying two. */
+const journal = new RawJournal({
+  root: WAREHOUSE,
+  mirrorRoot: process.env.WAREHOUSE_MIRROR || null,
+  stream: 'rest-chain',
+  writer: `warehouse-capture@${process.pid}`,
+});
```

**Replace `jget` (currently lines 78–85). This is the line that discards the
bytes, and it is also the line that makes a failed poll look like an empty one:**

```diff
-async function jget(url) {
-  try {
-    const r = await fetch(url, { cache: 'no-store' });
-    if (!r.ok) return null;
-    return await r.json();
-  } catch (_) { return null; }
-}
+async function jget(url, { journalIt = false } = {}) {
+  let r, text;
+  try {
+    r = await fetch(url, { cache: 'no-store' });
+    text = await r.text();                       // TEXT, not json — bytes first
+  } catch (e) {
+    if (journalIt) journal.error(url, `fetch failed: ${e.message}`);
+    return null;
+  }
+  if (!r.ok) {
+    if (journalIt) journal.error(url, `HTTP ${r.status}`, { status: r.status });
+    return null;
+  }
+  if (!text) {
+    if (journalIt) journal.gap(url, 'empty body');
+    return null;
+  }
+  // Journalled BEFORE parsing. A parser bug now costs a re-parse, not a day.
+  if (journalIt) journal.write({ kind: 'observation', source: url, body: text });
+  try { return JSON.parse(text); }
+  catch (e) {
+    if (journalIt) journal.error(url, `unparseable body: ${e.message}`);
+    return null;
+  }
+}
```

**In the chain loop, ask for journalling and stop letting the dedupe hide
coverage:**

```diff
-    const chain = await jget(`${API}/api/options/chain?instrument=${inst}`);
+    const chain = await jget(`${API}/api/options/chain?instrument=${inst}`, { journalIt: true });
     const snap = buildChainSnapshot(inst, chain, now);
-    if (!snap) { summary.chain[inst] = 'no-data'; continue; }
+    if (!snap) { summary.chain[inst] = 'no-data'; continue; }   // the journal already holds the reason
     snaps[inst] = snap;
     const fp = chainFingerprint(snap);
-    if (state[`chain:${inst}`] === fp) { summary.chain[inst] = 'unchanged'; continue; }
+    // The L2 projection may still skip an unchanged snapshot — it is a
+    // derivation and a duplicate row there costs storage for no information.
+    // The COVERAGE record no longer depends on it: the journal above wrote a
+    // record for this poll whether the market moved or not, so "unchanged" and
+    // "not running" are now different bytes on disk.
+    if (state[`chain:${inst}`] === fp) { summary.chain[inst] = 'unchanged'; continue; }
```

**On shutdown, seal the open hour:**

```diff
   require('./loop-guard.js').runLoop('capture', run, every * 1000);
+  for (const sig of ['SIGINT', 'SIGTERM']) {
+    process.on(sig, () => { try { journal.close(); } catch (_) {} process.exit(0); });
+  }
```

### 6.2 What this diff does NOT do — stated so it is not assumed

- **It does not journal the websocket feed (0b.4).** This capture process polls
  REST against the bot's own API; the live Upstox socket lives inside
  `server.js`, which is Tier 1 and a separate change.
- **It does not fix the 11:16 start or the drifting cadence (0b.6).** Those are
  supervision and configuration, not code — doc 073 A4 and A5.
- **It does not land official files daily (0b.5).**
- **It does not make the archive rebuildable yet.** A journal is the
  precondition for that, not the thing itself; the rebuild path is Stage 2a.
- **It journals what the bot's own API returns, not what the broker returned.**
  That is one parse removed from true raw. Genuine broker-edge journalling has
  to happen inside the connector — a Tier 0/1 change, and the next one to
  propose.

### 6.3 Next Stage 0 items, in order

1. **0b.4** — journal the live websocket frames at the connector edge. Tier 1;
   propose, do not apply.
2. **0b.5** — daily landing of NSE/BSE official files with hashes, and a
   coverage register that records a missing day as a fact.
3. **0c.1** — effective-dated contract terms derived from the bhavcopy already
   on disk (lot size is field 28; expiry weekday is derivable from the expiry
   dates present each day).
