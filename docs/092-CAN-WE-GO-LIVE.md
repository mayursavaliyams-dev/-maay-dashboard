# 092 — Can Real Trading Start?

**Assessed 2026-08-12 against the running process.** Every claim below has the
command that produced it.

---

## The short answer

**No — and the blocker is not what the last three weeks of hardening was about.**

The hardening is largely done. The thing that stops a live order is simpler and
more absolute: **the code to place one does not exist.**

```js
// upstox-connector.js
async placeOrder(/* params */) {
  // Live order placement intentionally not implemented here — keep paper-mode safe.
  // Wire to POST /v2/order/place with Upstox order schema when going live.
  throw new Error('Upstox placeOrder not implemented — paper mode only');
}
```

The running process agrees:

```
connector               "upstox"
brokerOrderCapability   "refuses"
brokerCanPlaceOrders    false
tradeMode               "paper"
liveOrdersPossible      false
note   The upstox connector's placeOrder throws — no order can reach a
       broker regardless of TRADE_MODE.
```

Set `TRADE_MODE=live` and `ALLOW_LIVE=true` today and **nothing happens**. Every
entry throws at the connector.

That is protection **by accident**, not by design — and it is the last piece of
accidental protection left in the system. The moment somebody writes those twenty
lines, every other safeguard becomes the only thing standing between a signal and
real money. That is why the order of the work below matters.

---

## What IS ready — verified from the live object graph

| | Evidence |
|---|---|
| Order chokepoint **active** | `/api/attestation`: all 5 order-capable consumers hold the guard, `bypassing: []` |
| Kill switch **active** | same endpoint |
| Two-key rule | 10 of 11 order paths; the survivor is a Python CLI |
| Control surface | 52 of 64 mutating routes gated; the 12 open ones each carry a written reason |
| Risk limits | a malformed limit refuses startup by name |
| Daily counters | survive a restart, keyed to the IST date |
| Startup banner | states connector, mode and order capability, all derived |
| Attestation | 97 loaded files sealed; `attest-verify` exits 0 |
| Test suite | 98/98 |

None of that was true three weeks ago. It is worth saying plainly: the system is
now in a state where turning it on would be a **decision** rather than an
accident.

---

## What must be true before the first live rupee

In order. Each one is a prerequisite for the next being meaningful.

### 1. The system must know what it holds — **D-8, unfixed**

```js
async getPositions() {
  try { const j = await this._get('/portfolio/short-term-positions'); return j.data || []; }
  catch { return []; }          // an API failure reads as "no positions"
}
```

**When the broker errors, the system reports itself flat.** It will then open a
new position, because as far as it knows nothing is open.

Every other safeguard rests on this. The risk layer sizes against the book. The
concentration check reads the book. Reconciliation compares against the book. A
book that returns `[]` for "I could not ask" makes all three confidently wrong.

`broker-positions.js` already models this correctly — it has an
`EMPTY_UNVERIFIABLE` state and will never say "flat". The connector underneath it
does not match. **This is one file and a few lines, and it is the first thing to
do.**

### 2. Reconciliation — never built

Nothing compares the internal book against the broker's. Without it, a partial
fill, a rejected leg or a manual intervention on the broker's app drifts silently
and nothing notices.

### 3. Heartbeats — never started

No component reports that it is alive. Feed-failure detection latency cannot be
measured, because there is nothing to measure. "The feed died at 11:04" is
currently discovered by looking at a chart.

### 4. `placeOrder` itself, written and proven on one lot

Twenty lines against `POST /v2/order/place`. Then a **single order, one lot, at a
liquid ATM strike, placed and squared off by hand**, with the whole chain
observed: the guard's approval, the breaker's count, the journal record, the
reconciliation match, and the broker's own contract note. Once, before anything
automatic.

### 5. `CONTROL_TOKEN`, and a drill

Currently blank, so control endpoints are loopback-only. **Verified: the phone
can still reach `/api/engine/halt-all` through the tunnel** — halting is
allowlisted precisely because an operator must never need a credential to stop
the system. But nothing else is reachable, and the kill/reset drill has never
been rehearsed against the tunnel.

---

## The other question, which is not an engineering one

Even with all of the above, there is a separate matter: **is there an edge?**

What the evidence in this repository says, graded:

- **NIFTY intraday directional: no edge.** MEASURED — 1,200 trades over 197 days
  of real data, profit factor 0.94, a net loser. The encouraging first hundred
  trades were sample noise. Auto-trading was disabled for this reason.
- **Short strangle: 89% win rate.** MEASURED on 120 days of real bhavcopy — but
  **never forward-tested**, and a high win rate on a short-premium strategy is
  the exact shape that hides its losses in the tail.
- **Screen backtests, this week:** `Range position < 20` gave +1.01% edge over 20
  sessions (n=568); `Current price > SMA 50 AND RSI < 60` gave **−0.46%**. Both
  gross of costs, both over ~10 months, both survivorship-biased.
- **Gamma-blast and hero-zero:** base rates UNKNOWN. Gated on 20 clean sessions
  that have not been collected.

So the honest position is: **the platform is nearly ready to place an order it
has no measured reason to place.** Fixing that is a data problem and a forward-
testing problem, not a code problem, and it runs on a calendar rather than on
effort.

---

## What I would actually do

1. **Commit.** ~150 files, weeks of work, staged and uncommitted.
2. **D-8.** One file. It makes every other safeguard mean something.
3. **The 08:50 scheduled task**, which fails every morning with win32 4320 —
   capture starts at logon instead, and each late morning is a session of chain
   data that cannot be bought back.
4. **Heartbeats, then reconciliation.**
5. **Forward-test the strangle in paper for a stated number of sessions**, agreed
   in advance, while 1–4 are built.
6. **Then** write `placeOrder`, and do one manual lot.

Steps 1–4 are days. Step 5 is weeks and cannot be shortened by working harder.
Step 6 is an afternoon, and it is last on purpose.
