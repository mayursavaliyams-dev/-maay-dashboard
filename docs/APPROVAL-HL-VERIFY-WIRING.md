# APPROVAL PACKAGE — Wire `hl-verify.js` into the live H/L path

**Prepared:** 2026-07-17 · **Requested by:** engineering · **Decision:** owner
**Protected files touched:** `server.js` (1 function region + 1 new route)
**Status:** NOT APPLIED. Awaiting owner approval per the protected-file rule.
**Board precondition:** REVIEW-BOARD-008 (spec PASS WITH 8 CONDITIONS). The engine already
implements all 8; this package only connects it.

---

## 0. THE MEASURED FACT THAT SHAPES THIS ENTIRE DECISION

Before any diff, one thing must be on the table, because it changes what "verified" can honestly
mean today:

```
  _updateOptHL(inst, strike, type, ltp, quoteHigh, quoteLow)   — server.js:454
  called from FOUR sites:  :882, :2258, :6714, :6941
  EVERY caller passes:  leg.high / leg.low (REST option-chain poll)  +  ltp
  NO caller passes:     an exchange timestamp (ltt)
```

**MEASURED CONCLUSION:** the option H/L path is **REST-poll-fed, not WebSocket-tick-fed.** The Dhan
`ltt` (exchange last-trade-time) that the spec's rules 2, 6, 7, 8 depend on is **not reachable at
these call sites.** The WS feed exists (`dhan-ws-feed.js`) but is not the source of the H/L updates.

**Therefore, honestly:**
- Rules **2 (exch-ts), 6 (stale), 7 (WS-source), 8 (sequence)** cannot be *enforced* on today's
  data — there is no exchange timestamp and no WS provenance at the call site. Enforcing them would
  reject **100%** of real updates (all REST-sourced, no `ltt`).
- Rules **1 (out-of-order via recvTs), 4 (NaN/0/neg), 5 (duplicate), 9 (jump→suspicious)** and the
  **double-verification (next-poll confirmation)** *can* be honestly applied to REST polls.

This is not a defect in the engine — the engine correctly refuses to pretend REST data is
exchange-verified (that was Board condition COND-2). It means the wiring must choose a **mode**, and
the owner must pick it. That choice is Section 4.

---

## 1. EVIDENCE (why wire it at all)

- The current `:481` path saves a new high/low on the **first** observation with **no verification**:
  a single bad LTP print becomes a permanent session extreme, notified and stored. (VERIFIED, code)
- The platform's own history: audit 034 measured 8–30% WS delivery and partial capture presented as
  sessions; the H/L records inherit whatever noise the poll returns. (MEASURED)
- The owner's spec (2026-07-17) explicitly requires: reject-don't-update, a Yellow "waiting" state,
  a per-decision audit log, and "never display until verified." None exist today. (VERIFIED absence)
- `hl-verify.js` implements all of this, tested (70 assertions, 8 Testing-Rule categories, green).

## 2. ROOT CAUSE (of the current weakness)

`_updateOptHL` treats the first-seen and every-larger LTP as truth. There is no confirmation tier,
no structural validation beyond `last > 0`, and no audit of rejected data. A REST poll that returns
a stale or torn value writes it straight into `rec.high`/`rec.low` and fires `_pushHlTouch`.

## 3. EXACT DIFF (proposed — NOT APPLIED)

**Change A — gate the write through the verifier (region `server.js:481–488`).**
The verifier becomes the single owner (COND-1); `rec.high`/`rec.low` update **only** on an
`ACCEPTED` result, and `_pushHlTouch` fires **only** then, carrying the tier.

```js
// AT MODULE TOP (once), near the other requires:
const { HLVerifier, LEVEL, TIER } = require('./hl-verify');
const _hlVerifier = new HLVerifier({
  // REST-poll mode: no exchange ts/seq available (see approval §0), so the
  // timestamp-and-source rules are disabled by construction, NOT faked.
  staleMs: Infinity, skewMs: Infinity,         // no exch-ts ⇒ cannot judge staleness/skew
  confirmTimeoutMs: 90_000,                    // polls are ~seconds apart; give a candle window
});

// REPLACING lines 481–488:
const key2 = inst + ':' + strike + type;
const res = _hlVerifier.ingest(key2, {
  price: observedHigh,                          // LTP; high==low==last on this path
  exchTs: now,                                  // recvTs proxy — the ONLY clock we have here
  recvTs: now,
  source: 'rest',                               // HONEST tag: this is a REST poll, not WS
});
if (res.confirmed && !res.confirmed.rejected) {
  const c = res.confirmed;
  if (c.kind === 'HIGH') { rec.high = c.price; rec.highAt = now; }
  else                   { rec.low  = c.price; rec.lowAt  = now; }
  _pushHlTouch(inst, strike, type, c.kind, c.price,
               c.kind === 'HIGH' ? prevHigh : prevLow, c.tier);   // tier passed to the notification
}
// NOTE: rec.high/low are no longer updated on the raw observation — only on a
// confirmed one. prevHigh/prevLow are captured before ingest as today.
```

**Change B — the candle tier feeds the SAME verifier (region `server.js:759–873`, reconcile task).**
Where the reconcile task computes a 1-minute candle, call
`_hlVerifier.confirmByCandle(key, { high, low })` so a poll-confirmed-late extreme becomes
`EXCHANGE_RECONCILED`. (One line added inside the existing loop; no behavior removed.)

**Change C — audit export, behind a guard (new route, COND-8).**
```js
app.get('/api/hl-audit.csv', (req, res) => {
  // COND-8: this endpoint must NOT be reachable on the open LAN. Guard = loopback-only
  // until auth.js is enabled platform-wide.
  const ip = req.socket.remoteAddress || '';
  if (!/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(ip)) return res.status(403).end('local only');
  res.type('text/csv').send(_hlVerifier.toCSV());
});
```

**Change D — notification tier in the UI payload.** `_pushHlTouch` gains a trailing `tier` arg,
surfaced so the dashboard badge reads `FEED-VALIDATED` or `EXCHANGE-RECONCILED` — never a bare
"Verified by Exchange" (COND-2/F-3).

**Total added/changed:** ~28 lines in `server.js` (one require, one region rewrite, one route, one
reconcile line, `_pushHlTouch` arg) + the already-tested `hl-verify.js`.

## 4. THE OWNER'S CHOICE (must be answered before applying)

Because the path is REST-fed (§0), the verifier runs in **REST mode**. The owner picks the
confirmation policy:

| Option | What "confirmed" means | Trade-off |
|---|---|---|
| **R1 (recommended)** | A new extreme is held for **one more poll** before it is saved/notified | A real fast spike shows one poll late (~seconds); a torn single print is rejected. Matches the spec's double-verification intent honestly for REST |
| **R2** | Save immediately (as today) but **run the audit log + reject only structural garbage** (NaN/0/neg/duplicate) | Keeps current latency; gains the audit trail and garbage rejection; loses spike protection |
| **R3** | Defer wiring until the **WS `ltt` is plumbed** into `_updateOptHL` (a separate, larger change) | Full spec fidelity (all 9 rules real), but more surface and a second approval |

The engine supports all three by configuration; the diff above is written for **R1**.

## 5. RISK

- **Severity: MEDIUM.** This changes when/whether an H/L is recorded — a behavior change on a
  protected file, hence this package.
- **Blast radius:** option H/L records, the H/L timeline UI, and the touch notifications. Does NOT
  touch order placement, engine enable flags, capital, or the risk brake. No money path.
- **Failure mode if the verifier misbehaves:** it fails **closed** — a non-`ACCEPTED` result means
  the extreme is simply not recorded (same as a missed poll today). It cannot corrupt an existing
  record; it only gates new writes. Verified by test 2 ("record never touched by invalid ticks").
- **New surface:** one loopback-guarded GET route. No auth regression (it is stricter than the 172
  existing unauthed routes).
- **Known limitation, stated:** in REST mode, rules 2/6/7/8 are inert by design (§0). The audit log
  will show `source: rest` and no seq — that is honest, not a bug.

## 6. ROLLBACK

- Revert the `:481–488` region to the 8 original lines (captured in this package below).
- Delete the require, the route, the reconcile line, the `tier` arg.
- `hl-verify.js` and its tests can remain (they are inert if unused) or be removed.
- One migration snapshot of `server.js` is taken before applying; `ROLLBACK.sh` restores it.
- **Original region, for verbatim restore:**
```js
  const newHigh = observedHigh > rec.high;
  const newLow  = observedLow < rec.low;
  const prevHigh = rec.high, prevLow = rec.low;
  if (newHigh) { rec.high = observedHigh; rec.highAt = now; }
  if (newLow)  { rec.low  = observedLow; rec.lowAt  = now; }
  if (newHigh) _pushHlTouch(inst, strike, type, 'HIGH', observedHigh, prevHigh);
  if (newLow)  _pushHlTouch(inst, strike, type, 'LOW',  observedLow,  prevLow);
```

## 7. CHARACTERIZATION TEST (required before applying — proven RED first)

Because this CHANGES existing behavior, a characterization test must first pin what `_updateOptHL`
does **today** (saves on first observation, no confirmation), proven to fail once the gate is in
place — that red is the evidence the change actually changed something. To be written against the
live function before the diff is applied (Testing Rule; not yet written — this package proposes it).

## 8. REGRESSION TESTS (already green, 70 assertions)

`test/hl-verify.test.js` covers: structural rejection, duplicate, out-of-order, double-verification,
bad-spike rejection, the gamma-blast survival doctrine (COND-4), candle tier, GAP≠INVALID,
retention-with-TRIM, CSV escaping, fail-closed on garbage, and the `num(null)→0` regression that
this work also fixed in `positions-book.js`.

## 9. PERFORMANCE IMPACT

`ingest` measured at **< 0.25 µs/tick** (test 21, 20k ticks). `_updateOptHL` runs per strike per
poll (seconds apart) — the added cost is unmeasurable against the existing REST/JSON work. Audit log
is capped (`maxLog`, COND-6) so memory is bounded. **Net: negligible.**

---

## DECISION REQUESTED

1. **Approve wiring?** yes / no
2. **Which confirmation policy — R1 / R2 / R3?** (diff is written for R1)
3. If approved: the characterization test (§7) is written and proven red, then the diff applied,
   then `npm test` must stay green and the live path smoke-tested before it is considered done.

Nothing is applied until this is answered.

---

## 10. DELIVERED — COND-2 DASHBOARD SURFACING (2026-07-18)

Wiring applied under policy **R1**. This section records the follow-on that satisfies **COND-2**
end-to-end: the confirmation tier is now visible to the operator, not just held in memory.

**The chain, source of truth → eye:**

```
_hlVerifier.ingest → c.tier            (FEED_VALIDATED next-poll │ EXCHANGE_RECONCILED candle)
  → rec.highPath/lowPath.push({…, tier: c.tier})     server.js  (the record now carries HOW)
  → _toOptHLHistory / pathOut  emit  tier: e.tier     server.js  (both option-history mappers)
  → /api/option-strike-history  response                        (tier per high/low record)
  → cfBadge(tier)  →  <span class="cf exch|feed|none">          public/dashboard.html
       • EXCH  (green)  — reconciled against the 1-min exchange candle (strongest)
       • FEED  (blue)   — the print held one more poll before it was saved
       • ·     (dim)    — pre-verifier / merged candle backfill: no tier claimed, so none shown
```

**Where it shows:** the Strike-price-timeline panel (each ▲/▼ record row) and the full-record
modal — the two places an operator actually reads an option's session H/L. A one-line legend sits
in the panel header. Every badge has a hover `title` spelling the tier out in words.

**Honesty guarantees kept:**
- A record with no tier renders `·` (dim), never a fabricated "verified" — COND-2/F-3.
- The badge is a pure pass-through of `c.tier`; the page never *infers* a tier the engine did not assert.
- Old / candle-backfilled records (which legitimately have no per-poll tier) degrade to `·`, not to a
  false stronger claim.

**Tests:** `test/server-hl-verify-wiring.test.js` (now 24 assertions) locks the tier onto
`highPath`/`lowPath` and through both mappers, so a future edit cannot silently drop the badge back to
an untiered record. Full suite **51/51 green**. Dashboard inline JS parses clean.

**Smoke test (2026-07-18, market closed):** server boots (`/healthz` 200), dashboard serves (200),
`/api/option-strike-history` emits the `tier` key per record. Live tiered records will populate during
market hours — 0 records off-session is expected, not a failure.

**Protected-file note:** the `server.js` edits are staged for the **owner** to commit (per repo rule,
no unasked commits). `public/dashboard.html` is non-protected.
