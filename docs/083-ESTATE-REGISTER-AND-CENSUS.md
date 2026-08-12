# 083 — Estate Register and Order-Capability Census

**Master Prompt 8, first deliverable.**
**Measured 2026-07-31** by `npm run census` and by a port scan of the machine.
Every fact below is derived from the real filesystem and the real process list.

**Regenerate:** `npm run census` (exit 1 if any uncontrolled order path exists)
**Assert:** `node test/estate-boundary.test.js` — 37 assertions, reads the disk

---

## 0. The finding, and what was closed

A census of the **whole** repository found this chain:

1. `stock/equity-connector.js` `placeOrder()` is **fully implemented** — it
   `POST`s to Dhan `/v2/orders`. Not a stub, does not throw.
2. `stock/stock-engine.js:386` and `:507` call it directly. **None** of the main
   bot's controls apply: no chokepoint, no risk layer, no circuit breaker, no
   approval.
3. It was gated by `process.env.TRADE_MODE` — **the same variable the main bot
   reads**. One flag, two deployables.
4. `stock/` has **no `.env` of its own**. Launched from the repository root —
   which is how the batch files launch it — `dotenv` resolves against
   `process.cwd()` and it loads the **root** `.env`.
5. The root `.env` holds `DHAN_CLIENT_ID` (10 chars) and `DHAN_ACCESS_TOKEN`
   (303 chars), both present.

**So `TRADE_MODE=live` — one variable, in a file shared with the main bot —
armed a second bot with a working order path and zero controls.** Anyone setting
that variable would have been thinking about the main bot, which is protected by
the chokepoint. They would not have been thinking about this one.

### Closed, before anything else was written

**Barrier A — the flag is namespaced.** `stock/arming.js` is new. The stock
deployable reads `STOCK_TRADE_MODE` and never `TRADE_MODE`. Rewired:
`stock/stock-engine.js`, `stock/equity-connector.js` (×2), `stock/preflight.js`.
`stock/server.js` still reads `TRADE_MODE` — for **display only**, asserted as
display-only by the boundary test.

**Barrier B — the credentials must be its own.** Even with
`STOCK_TRADE_MODE=live`, it will not go live on credentials it merely found in a
shared file. It requires `STOCK_DHAN_CLIENT_ID` and `STOCK_DHAN_ACCESS_TOKEN`,
which exist nowhere unless someone puts them there deliberately. In paper it
still uses the shared credentials for **read-only market data**, which is all
paper needs.

Barrier B is the one that holds. A flag is a delay; a credential a component
does not hold is a barrier.

```
  ✓ setting TRADE_MODE=live — the main bot's flag — does NOT arm the stock bot [this was the defect]
  ✓ even its OWN flag does not arm it while it holds only the shared credentials
  ✓ and the refusal names exactly which credentials it is missing
  ✓ with its own flag AND its own credentials it can go live — the barrier is deliberate, not a wall
```

---

## 1. Estate register

### 1.1 Package-level deployables

| | **antigravity-sensex-bot** | **antigravity-stock-bot** |
|---|---|---|
| Purpose | Index options: capture, research, paper trading | Cash equity: ORB signals, paper trading |
| Directory | `.` | `stock/` |
| Start | `node server.js` | `node server.js` |
| Supervisor | pm2 `antigravity-bot`, autorestart, max 10 | pm2 `antigravity-stock-bot`, autorestart, max 10 |
| Port | 3000 | 3100 default (`PORT`) — **see §1.3, it collides** |
| Config loaded | `.env` (root) | **no `.env` of its own** → root `.env` when launched from root |
| Order-capable credentials in scope | `DHAN_*`, `UPSTOX_ACCESS_TOKEN` | **paper: shared (read-only use). live: requires its own `STOCK_DHAN_*`** |
| Controls | chokepoint, risk layer, breaker, kill switch, control gate, data gate | **none** |
| Order capability | 8 paths, all through the chokepoint | **2 paths, both uncontrolled** |
| Current state | running on 3000 — **old code**, see doc 079 | not observed running |
| Owner | account owner | account owner |

### 1.2 Standalone processes — no `package.json`, therefore invisible to any register built from one

| File | Kind | Port | State |
|---|---|---|---|
| `warehouse-api.js` | HTTP server, **loopback-bound**, GET-only (405 otherwise) | `WAREHOUSE_API_PORT`, default **3100** | **RUNNING** — PID 27692, started 08:50 |
| `warehouse-capture.js` | loop — polls the bot's own REST API and writes L0/L1 | — | unknown |
| `warehouse-derive.js` | loop — derives L2 from L0 | — | unknown |
| `option-warehouse.js` | loop | — | unknown |

**None of these were in any register until this document.** The census did not
find `warehouse-api` either — its own definition of "deployable" was
"a package.json with a start script", the same blind spot. **Only a scan of the
machine's listening ports found it.** The census definition has been widened and
the boundary test now asserts all four by name.

### 1.3 Reconciliation against the machine — and a collision

```
LocalPort OwningProcess   StartTime
     3000          8272   30-07-2026 23:01:50   antigravity-sensex-bot (old code)
     3100         27692   31-07-2026 08:50:01   warehouse-api  → /wh/health returns ok
```

**`warehouse-api` and `antigravity-stock-bot` both default to port 3100.**
Whichever starts second fails to bind. Today `warehouse-api` holds it, which
means the stock bot **cannot currently start** — a containment nobody chose,
provided by a port collision. That is accidental protection and it is recorded
as such: it disappears the moment someone changes a port.

---

## 2. Order-capability census

`npm run census`, comments stripped, tests and scripts excluded.

### 2.1 Controlled — 8 paths, all in the deployable that owns the chokepoint

```
  ✓ afternoon-engine.js:658      this.broker.placeOrder
  ✓ execution-engine.js:709      this.broker.placeOrder
  ✓ flatten.js:128               broker.placeOrder (reducing)
  ✓ limit-order-engine.js:281    this.broker.placeOrder
  ✓ limit-order-engine.js:284    this.broker.modifyOrder
  ✓ limit-order-engine.js:349    this.broker.modifyOrder
  ✓ limit-order-engine.js:370    this.broker.cancelOrder
  ✓ place-guarded.js:34          broker.placeOrder (the shared entry path)
```

### 2.2 Uncontrolled — 2 paths, both in the stock bot

| Path | Controlled? | What single change would make it live? |
|---|---|---|
| `stock/stock-engine.js:387` | **NO** | **Before today:** `TRADE_MODE=live` — one variable, already in a file it reads, with credentials already present. **Now:** `STOCK_TRADE_MODE=live` **and** `STOCK_DHAN_CLIENT_ID` **and** `STOCK_DHAN_ACCESS_TOKEN` — three deliberate acts, none of which exists today |
| `stock/stock-engine.js:508` | **NO** | same |

They remain **uncontrolled** — they do not pass a chokepoint, and building one
for the stock bot is a separate piece of work. What changed is that they are no
longer **one variable** from live. This is recorded as a known, listed exception
in `test/estate-boundary.test.js §2`, not as a silent one.

### 2.3 Send-path capability — implemented, or throws?

```
  ⚠ IMPLEMENTED  live-connector.js              placeOrder()   [sensex-bot]
  ⚠ IMPLEMENTED  stock/equity-connector.js      placeOrder()   [stock-bot]
  · refuses      upstox-connector.js            placeOrder()   [sensex-bot]
  · guard-stub   risk-guard.js                  placeOrder()   [sensex-bot]
```

### 2.4 Protected by ACCIDENT, not by design — named, because it will look like a bug fix

- **`upstox-connector.js:placeOrder()` throws.** This is the only reason the
  main bot has never sent an order. It is the *active* connector. The day
  someone implements it — a reasonable-looking feature commit — that protection
  vanishes. The chokepoint is the designed protection; this is not.
- **The 3100 port collision** currently prevents the stock bot from starting.
  Nobody chose it.
- **`stock/` having no `.env`** was, before today, the reason it needed only one
  variable rather than a credential too. That has been converted from accident
  into design by Barrier B.

---

## 3. Configuration blast radius

18 environment variables are read by both deployables. The three that can **arm**
something:

| Variable | Readers | Status |
|---|---|---|
| `TRADE_MODE` | sensex-bot (arming), stock-bot (**display only**, asserted) | **split** |
| `AUTO_TRADE_ENABLED` | both | **still shared — open finding** |
| `BOT_AUTOSTART` | both | **still shared — open finding** |

The remaining 15 are tuning values (`STOP_LOSS_PERCENT`, `CAPITAL_TOTAL`,
`MAX_TRADES_PER_DAY`, …). They cannot arm anything, but they are shared blast
radius for behaviour: changing `MAX_TRADES_PER_DAY` for the options bot silently
changes it for the equity bot too.

**`AUTO_TRADE_ENABLED` and `BOT_AUTOSTART` were not split today.** They gate
whether an engine auto-trades and whether the loop starts, so splitting them is
a behaviour change to a money path in a deployable with no controls, and it
deserves its own change with its own test rather than being bundled here.
Recorded as **D-9**.

---

## 4. Credential placement

```
  .env:
      DHAN_CLIENT_ID           present (10 chars)
      DHAN_API_KEY             present (8 chars)
      DHAN_API_SECRET          present (36 chars)
      DHAN_ACCESS_TOKEN        present (303 chars)
      UPSTOX_ACCESS_TOKEN      present (335 chars)
```

One file, order-capable, resolved to by **both** deployables and by all four
standalone processes. Module 4 wants order-capable credentials issued only to
the deployable that owns the chokepoint; that is not the state today and cannot
be reached until either the broker issues a data-scoped key or a second, unfunded
account exists. **Until then, per Module 4, the barrier for everything else is
recorded as a flag plus Barrier B, and the file itself is treated as
live-capable.**

### The scanner that read this file was wrong first, in the dangerous direction

It reported **`.env: none`**. The file is CRLF; the scanner split on `'\n'`,
leaving `\r` at the end of every line, and in a JavaScript regex `.` does not
match `\r` — so `(.*)$` never reached the end of the string and every line
failed to match.

**A credential scanner failing open**, telling the reader there were no
order-capable credentials in a file holding five. Found by comparing it against
a direct read of the same file, fixed, and pinned by
`test/estate-boundary.test.js §7`, which asserts the real `.env` is CRLF **and**
that the census finds ≥3 credentials in it.

---

## 5. New defects

| # | Defect | Severity |
|---|---|---|
| **D-9** | `AUTO_TRADE_ENABLED` and `BOT_AUTOSTART` are still read by both deployables — shared arming surface | **high** |
| **D-10** | `warehouse-api` (3100) and `antigravity-stock-bot` (3100) collide. Containment by accident; also means one of them silently fails to start | medium |
| **D-11** | Four standalone processes are supervised by nothing — no pm2 entry, no restart policy, no register until today. `warehouse-capture` is the process that writes the raw archive; if it dies, capture stops silently | **high** |
| **D-12** | `stock/stock-engine.js` has no chokepoint. Barriers A and B stop it being armed by accident; they do not make its two order paths controlled | **high** |

D-1 (from doc 079) is **superseded** by D-12 and by the closure above.

---

## 6. What was NOT done

- **The stock bot was not given a chokepoint.** It is now hard to arm; it is not
  controlled. Building it one is the next real piece of work in this area.
- **`AUTO_TRADE_ENABLED` / `BOT_AUTOSTART` were not split** — D-9.
- **The port collision was not resolved** — D-10.
- **No process was restarted.** The stock bot's rewiring exists in the tree and
  is not running, like everything else (doc 079 §D-0). The running process on
  3000 is still old code.
- **Modules 1, 7, 8, 9 and 10 of the prompt** — attestation, verified
  deployment, drift detection, decommissioning, and the pre-live gate — were not
  built. The first deliverable was the register and the census, and closing the
  one-variable path. Those five are the next sessions.
- **Nothing was committed.**

---

## 7. First action next session

**Build Module 1, the running-process attestation.** It is the only thing that
turns "is the deployed code the built code" into a question with a mechanical
answer — and that question currently has the answer "no" on port 3000, which
nobody would know without asking by hand.

Then Module 10's item 10: demonstrate that each boundary test **fails when its
protection is removed**. A gate whose tests have never been shown to fail is a
gate that has never been tested — and three of the four defects in §5 exist
because something that looked like a check was not one.
