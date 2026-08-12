# 074 — Phase 0: Inventory and Truth

**Document type:** Structural inventory. **No production code was changed to produce it.**
**Measured:** 2026-07-31, working tree at branch `main`.
**Subject:** `server.js` (8,062 lines) and the modules it constructs.
**Method:** direct source inspection. Every claim below cites file and line.

Scope exclusions, stated so the reader knows what was *not* searched: `node_modules/`,
`backups/` (gitignored rollback snapshots), `dist/` (generated export), `test/`,
`deprecated/`, `stock/` (separate bot), `antigravity-py/` (archived).

---

## 0.1 Call graph for every dangerous operation

### 0.1.1 Order placement, modification, cancellation

Exhaustive. Twelve sites.

| # | Site | Reaches broker via | Guarded today by |
|---|---|---|---|
| 1 | `execution-engine.js:540` | `this.live.placeOrder` | `if (!this.paperMode && securityId)` — `paperMode` read **once at construction** from `TRADE_MODE` |
| 2 | `execution-engine.js:678` | `this.live.placeOrder` | same |
| 3 | `afternoon-engine.js:520` | `this.live.placeOrder` | same |
| 4 | `afternoon-engine.js:671` | `this.live.placeOrder` | same |
| 5 | `amibroker-bridge.js:623` | `deps.liveConnector.placeOrder` | `deps.getTradeMode() === 'live' && deps.liveConnector` — read **per call** |
| 6 | `server.js:1985` | `live.placeOrder` | `tradeMode !== 'live'` early-return, plus `botRunning`, plus `tradesToday >= maxTrades` |
| 7 | `server.js:7845` | `live.placeOrder` | `tradeMode === 'live' && live.connected`, plus `tradesToday >= maxTrades` |
| 8 | `limit-order-engine.js:386` | `this.broker.placeOrder` | **the risk guard** — this is the one wired path |
| 9 | `limit-order-engine.js:389` | `this.broker.modifyOrder` | risk guard passthrough |
| 10 | `limit-order-engine.js:462` | `this.broker.modifyOrder` | risk guard passthrough |
| 11 | `limit-order-engine.js:483` | `this.broker.cancelOrder` | risk guard passthrough |
| 12 | `risk-guard.js:150` | `this._broker.placeOrder` | **is** the guard |

**Sites 1–7 hold the raw connector. Sites 8–11 hold the guarded one.**

Note what actually guards 1–7: a `TRADE_MODE` check. That is a mode flag, not a risk
decision. None of sites 1–7 consults position limits, exposure, loss limits, the kill
switch, order rate, or duplicate detection. `risk-guard.js:7` states the design intent —
*"Eight call sites reach `placeOrder` in this repository today… the broker itself is
wrapped"* — and the wrapping reaches one of them.

### 0.1.2 What the guarded path actually protects against

`modifyOrder` and `cancelOrder` pass through `RiskGuardedBroker` by proxy
(`risk-guard.js:69` forwards every key except `placeOrder` and `constructor`). So they
are *reachable* through the guard but not *evaluated* by it. This is correct for cancel
— cancelling reduces risk and must never be blocked — but `modifyOrder` can increase
risk by repricing into a worse fill, and it is currently unevaluated. Recorded as a
finding, not fixed here.

### 0.1.3 Armed-state changes

| Site | State | Default |
|---|---|---|
| `server.js:226` | `botRunning` | `BOT_AUTOSTART ?? 'true'` → **starts armed** |
| `server.js` ×3 writes | `botRunning` | mutated by API routes |
| `agents-engine.js:238` | `this.enabled` | `AI_AGENTS_ENABLED ?? 'true'` → **on by default** |
| `gamma-blast-engine.js:51` | `this.enabled` | `?? 'false'` → off |
| `bounce-engine.js:19` | `this.enabled` | `?? 'false'` → off |
| `amibroker-bridge.js:22` | `this.enabled` | `AMIBROKER_BRIDGE === 'true'` → off |
| `server.js:6009` | kill switch trip | **no authentication** |
| `server.js:6020` | kill switch reset | **no authentication** |
| `server.js:6003` | risk config reload | **no authentication** |
| `server.js:7074` | emergency stop | **no authentication** |

### 0.1.4 Risk configuration changes

`riskConfig.reload({ by })` at `server.js:5822` (startup) and `server.js:6003` (HTTP
route). The route has no auth. `riskConfig.changeLog()` records changes — this is the
one change log that exists and it works.

### 0.1.5 Persistent state writes

Production writers, grouped by discipline:

**Atomic, via `safe-write.js`** (correct): `agents-engine.js` ×4, `gamma-blast-engine.js`
×2, `pop-seller.js` ×2, `database.js` ×3, `kill-switch.js`.

**Raw, non-atomic** (`writeFileSync` / `appendFileSync` — a crash mid-write leaves a
truncated file that will be parsed as valid or throw on load):
`server.js:595` (opthl day file), `server.js:632` (opt-candles day file),
`server.js:1434` (`_persistPath`), `server.js:70` (crash log — acceptable, append-only),
`amibroker-bridge.js:141`, `news-engine.js:149`, `option-warehouse.js:53`,
`forward-test-logger.js:76`.

`server.js:632` is the one that matters most: it writes the whole day's option-candle
archive in a single non-atomic `writeFileSync`. A crash during that write loses the
day's capture, which §0.6 of doc 072 established is irreplaceable.

---

## 0.2 Construction order map

Significant constructions in `server.js`, in file order:

| Line | Object | Depends on | Dependency constructed at |
|---|---|---|---|
| 19 | `confluenceLearner` | — | |
| 22 | `confirmedTracker` | env | |
| 33 | `agentsEngine` | — | |
| 181–200 | `live` (connector) | env | |
| 212 | `optionAnalyzer` | — | |
| 213 | `database` | — | |
| 214 | `amiBridge` | `live` (given at 363 via `registerRoutes`) | 181 ✓ |
| 494 | `_hlVerifier` | | |
| 2273 | `crashAnalyzer` | | |
| **3226** | **`engine` (ExecutionEngine)** | **`live`** | 181 ✓ — *but should be `guardedBroker`* |
| **3391** | **`niftyEngine` (ExecutionEngine)** | **`live`** | same |
| **3512** | **`afternoonEngine`** | **`live`** | same |
| **3573** | **`niftyAfternoonEngine`** | **`live`** | same |
| 3632 | `bounceEngine` | | |
| 3650 | `strangleEngine` | | |
| 3670 | `gammaBlastEngine` | | |
| 3706 | `trendRideEngine` | | |
| 5387–88 | `newsEngine`, `eventEngine` | | |
| 5817–20 | risk module **requires** | | |
| 5823 | `killSwitch` | `riskConfig` | 5817 ✓ |
| 5824 | `riskManager` | `killSwitch` | 5823 ✓ |
| **5825** | **`guardedBroker`** | `live`, `riskManager`, `killSwitch` | ✓ |
| 5840–42 | data quality trio | | |
| 5908–10 | margin trio | | |
| **6067** | **`executionEngine` (LimitOrderEngine)** | **`guardedBroker`** | 5825 ✓ **correct** |
| 6443 | `vrpMonitor` | | |
| 6470 | `signalPaperEngine` | | |
| 6694 | `positionsBook` require | | |

### The inversion

```
guardedBroker exists from line 5825 onward.
Its four intended consumers are constructed at 3226, 3391, 3512, 3573.
```

**Every one of them is constructed 2,252 to 2,599 lines before the object they should
receive.** At the moment `new ExecutionEngine({ live, … })` executes, the identifier
`guardedBroker` is in the temporal dead zone — referencing it would throw
`ReferenceError`. So the four engines could not have been given the guard even if
someone had tried.

This is the defect class Phase 0.2 exists to surface: **each line is correct in
isolation and only the order is wrong.** A reviewer reading line 3226 sees a correct
construction; a reviewer reading line 5825 sees a correct wrapping. Nothing in either
view reveals that the second is useless to the first.

`guardedBroker` is referenced in exactly three places: its construction (5825), a status
report (5993), and `broker:` for `LimitOrderEngine` (6071).

---

## 0.3 State ownership map

Module-scope mutable state in `server.js` that outlives a request:

| State | Line | Writers | Persists? | On restart |
|---|---|---|---|---|
| `botRunning` | 226 | **3** (init + 2 routes) | No | Reset from `BOT_AUTOSTART`, default **true** |
| `tradesToday` | 227 | **6** | No | **Reset to 0** |
| `openPosition` | 2861 | **4** | No | **Reset to null** |
| `orbHigh` / `orbLow` | 228–229 | multiple | No | null |
| `vwap` | 232 | multiple | No | 0 |
| `currentSignal` / `confidence` | 235–236 | multiple | No | `"WAIT"` / 0 |
| `_livePrice` | 383 | multiple | No | **`70000`** — a hardcoded fake SENSEX price |
| `_livePriceAt` | 384 | multiple | No | 0 |
| `tradeHistory` | array | multiple | No | empty |

**Every one of these has more than one writer and none of them survives a restart.**

Three consequences, all of which follow directly from the table:

1. **`tradesToday` resets to 0 on restart.** The daily trade limit — the only rate
   control on sites 6 and 7 — is defeated by a process restart. PM2 is configured with
   `autorestart: true, max_restarts: 10`. Ten restarts is ten fresh trade budgets.
2. **`openPosition` resets to `null` on restart.** The system does not merely forget the
   position; it believes there is none. Combined with the absence of any reconciliation
   (doc 073 §1), a crash while holding a position produces a system that will open
   another.
3. **`_livePrice` initialises to `70000`.** Any decision taken before the first tick is
   taken against a hardcoded number. `server.js:7833` compounds this:
   `getLivePrice().catch(() => entry || 75000)` — on a price-fetch failure the webhook
   route continues with **75000** and computes the strike from it, then reaches order
   site 7. A failed price read becomes an order at an invented strike.

---

## 0.4 Configuration surface — dangerous defaults

The full environment surface is large (≈120 variables). This section lists only defaults
that **fail dangerous**, per 0.4's instruction to flag them specifically.

### D1 — `LIVE_CONNECTOR` default `'auto'` · `server.js:178`

```js
if (upstoxTok && upstoxTok.length > 40)       live = new UpstoxConnector(...);  // placeOrder throws
else if (kotakKey && kotakKey !== 'your_...') live = new KotakNeoConnector();
else                                          live = new LiveConnector(...);     // placeOrder WORKS
```

Selection of a **capability** by the presence and length of a string. If the Upstox token
expires, is cleared, or is shortened below 41 characters, the process silently selects
the connector that can place real orders. **Absence of configuration substitutes a
different behaviour rather than failing.**

### D2 — `MAX_TRADES_PER_DAY` · six sites, `parseInt(process.env.MAX_TRADES_PER_DAY || 2)`

| Value | `parseInt` result | `tradesToday >= max` | Effect |
|---|---|---|---|
| unset | `2` | works | limit active |
| `""` | `2` (`'' \|\| 2`) | works | limit active |
| `"abc"` | **`NaN`** | **always false** | **limit disabled, silently** |
| `"0"` | `0` | always true | trading blocked (safe) |

A malformed value removes a safety limit with no error and no log line. The same pattern
appears at `position-sizer.js:50` (`SIZER_MAX_LOTS || 25` → `NaN` → lot cap defeated)
and at `execution-engine.js:333–334, 425`.

### D3 — `BOT_AUTOSTART` default `'true'` · `server.js:226`

The process arms itself on start. Combined with `autorestart: true` and the absence of a
startup self-check gate (doc 073 §1), a crash loop is an arm loop.

### D4 — `AI_AGENTS_ENABLED` default `'true'` · `agents-engine.js:238`

On by default. It is paper-only today, so the blast radius is bounded — but the default
direction is toward action rather than inaction.

### D5 — `_livePrice = 70000` · `server.js:383`, and the `|| 75000` fallback at `7833`

Hardcoded prices as fallbacks. Absence of a price is not distinguishable from a price.

**Safe defaults, recorded for balance:** `TRADE_MODE` defaults to `'paper'` at all ten
read sites; `gamma-blast`, `bounce` and `amibroker` engines default to disabled; the risk
layer defaults to **enabled**, which `server.js:5814` documents as deliberate —
*"a risk layer that has to be switched on is a risk layer that will be off on the day it
was needed."* That reasoning is correct and the default is right.

---

## 0.5 Dead code candidates

Per P6, nothing here is deleted, and nothing here is *concluded* dead. These are
candidates for instrumentation only. The instrumentation is Phase 6 work; listing them
now is Phase 0 work.

| Candidate | Why suspected | Why it might not be dead |
|---|---|---|
| `execution-engine.js:540, 678` live branches | Require `TRADE_MODE=live`, which has never been set | Would activate the instant mode flips |
| `afternoon-engine.js:520, 671` live branches | same | same |
| `server.js:1985` manual trade route | Dhan `securityId` + `BSE_FNO`; the active connector is Upstox | A dashboard button may still POST to it |
| `server.js:7845` TradingView webhook | External caller unknown | Cannot be proven from source — external callers are invisible |
| `amibroker-bridge.js:623` | `AMIBROKER_BRIDGE` defaults false | Enabled by env at any time |
| `kotak-neo-connector.js` | Selected only if `KOTAK_CONSUMER_KEY` is set and not placeholder | |
| `dhan-ws-feed.js` | Dhan path inactive; Upstox is the live feed | |
| `backtest-real/`, `backtest-tv/` | Separate historical harnesses | Referenced by npm scripts? unverified |

**`server.js:7845` deserves emphasis: it is an unauthenticated webhook that reaches a
raw order path, and whether anything calls it cannot be determined by reading. It is
exactly the case P6 was written for.**

---

## 0.6 Behaviour inventory — the specification nobody wrote

### B1 — Order placement retries up to four times · `dhan-client.js:174, 287`

`live-connector.js:414` places orders through `this.client._post('/v2/orders', body)`.
`_post` → `_requestUncoalesced` with **`retries = 3`** (default).

```js
if (res.status >= 500 && attempt < retries) {
  await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
  continue;                                    // ← re-POSTs the order
}
```

Plus a catch-all retry for network errors. **One order intent can produce up to four
`POST /v2/orders` submissions**, at 500 ms, 1000 ms and 1500 ms.

A 5xx or a socket error after the exchange has accepted the order is precisely the
ambiguous case. The body carries `correlationId: ag-${Date.now()}`, generated once per
call, so all four attempts share one correlation ID. **Whether Dhan de-duplicates on
`correlationId` is `Unknown` and must be verified with the broker.** If it does not, this
is a position-multiplication path that no one wrote down.

This retry policy was designed for market-data reads and is inherited by orders because
they share `_post`.

### B2 — Order responses are *not* cached · `dhan-client.js:11–22`

`DEFAULT_CACHE_TTL_MS = 0` and `/v2/orders` is absent from `PATH_CACHE_TTL_MS`. So the
response cache does not apply to orders. **Recorded because the opposite was the
reasonable expectation, and it is not what the code does.** This is a correct behaviour
that depends on a default staying at zero, in a table that lists four other paths with
non-zero TTLs. It is one careless line from becoming a defect.

### B3 — In-flight coalescing does apply to orders · `dhan-client.js:189–193`

```js
const pending = this._inflight.get(key);
if (pending) { this._stats.coalesced++; return pending; }
```

This runs **regardless of TTL**. The key includes the body, and the body includes a
millisecond-resolution `correlationId`, so two order intents collide only if generated in
the same millisecond. Practically near-impossible; structurally accidental. The safety
here is an artefact of timestamp resolution, not a decision.

### B4 — `getPositions()` and `getOrders()` return `[]` on failure · `live-connector.js:422–430`

```js
async getOrders()    { if (!this.connected) return []; return this.client._post('/v2/orders', {}).catch(() => []); }
async getPositions() { if (!this.connected) return []; return this.client._post('/v2/positions', {}).catch(() => []); }
```

**An unreachable broker is indistinguishable from a flat book.** Both the disconnected
case and the error case return the empty array that means "you have no positions."

This is the single most consequential behaviour in this inventory, because these are the
two functions that any reconciliation must be built on. A reconciliation written against
`getPositions()` as it stands would conclude "broker has nothing, internal state has
nothing, we agree" during a total broker outage while holding an open position.

`null ≠ 0` and `error ≠ empty`. Both are violated in the same line.

### B5 — 429 handling honours `retry-after`, else exponential · `dhan-client.js:250–262`

Correct and deliberate. Recorded as a behaviour that must survive refactoring, not as a
defect. Doc-memory records this layer reduced refusals from 458 to 0.

### B6 — Auth failure latches · `dhan-client.js:216–226, 292`

A 401 sets `_authBlocked`, and subsequent calls throw before making a request. This
fails closed and is correct. It also means a token expiry mid-session produces a hard
stop on the Dhan path rather than silent degradation — worth preserving.

### B7 — Silent error swallowing

`catch (_) {}` / `catch {}` one-liners: **55 in `server.js`**, 58 counting all forms.
Others: `strangle-engine.js` 5, `event-engine.js` 5, `news-engine.js` 4,
`dhan-ws-feed.js` 3, and singles elsewhere.

Each is a place where a failure produces no signal. Not all are wrong — some wrap
genuinely optional work — but none is distinguishable from the ones that are, because
they are written identically.

### B8 — `paperMode` is read once, at construction · `execution-engine.js:65`, `afternoon-engine.js:100`

```js
this.paperMode = (process.env.TRADE_MODE || 'paper') !== 'live';
```

Changing `TRADE_MODE` has no effect on a running process. This is safe in the
paper→live direction (requires a restart, which is desirable) and **unsafe in the
live→paper direction**: a person who sets `TRADE_MODE=paper` to stop live trading and
does not restart has changed nothing, while believing they have. `amibroker-bridge.js:621`
reads it per call, so the two behave differently. Neither behaviour is documented.

### B9 — Implicit ordering assumption in `server.js`

The file assumes top-to-bottom construction order as its dependency mechanism. There is
no dependency injection at module scope; consumers close over identifiers that must
already exist. This is *why* 0.2's inversion is possible, and it means any reordering of
the file is a behavioural change, not a cosmetic one.

---

## 0.7 Audit score — before

Scored against the defects this document identifies. Re-scored after every phase, per 7.4.

| # | Defect | State |
|---|---|---|
| A1 | Single order chokepoint | **1 of 12 sites** |
| A2 | Construction order correct for order path | **FAIL** (4 consumers before dependency) |
| A3 | Raw order capability unreachable | **FAIL** (`live` in module scope throughout) |
| A4 | Order rate / duplicate circuit breaker | **ABSENT** |
| A5 | `getPositions` distinguishes error from empty | **FAIL** |
| A6 | Order retry is idempotency-safe | **FAIL / Unknown** |
| A7 | Capability selected by explicit declaration | **FAIL** (`auto` by token length) |
| A8 | Malformed numeric config fails closed | **FAIL** (`NaN` disables limits) |
| A9 | `tradesToday` survives restart | **FAIL** |
| A10 | `openPosition` survives restart | **FAIL** |
| A11 | Kill switch authenticated | **FAIL** |
| A12 | Characterization tests on order path | **ABSENT** |
| A13 | Parity harness | **ABSENT** |
| A14 | Smoke suite | **ABSENT** |

**Score: 0 / 14.**

The one thing that is right — the risk layer defaulting to enabled — is not on this list
because it is not one of the defects. It is recorded in §0.4 and should be preserved.

---

## 0.8 What Phase 0 changes about the plan

Two findings alter the sequence given in the brief, and both make the chokepoint more
urgent rather than less:

1. **B4 (`getPositions` returns `[]` on error) must be fixed before any reconciliation
   is built.** Doc 073 lists reconciliation as A3 on its critical path. Building it on
   B4 would produce a reconciliation that passes during an outage. B4 is a two-line fix
   with a characterization test, and it belongs in Phase 1, not Phase 5.

2. **B1 (order retry ×4) is a chokepoint concern, not a connector concern.** The
   circuit breaker required by 2.5 must count *broker submissions*, not *order intents*,
   or a single intent retrying four times will not register as a rate event. This
   changes what the breaker instruments.

Neither changes the phase order. Both change what goes into the phases.

---

## 0.9 Next

Phase 0 is complete and published. Per the sequencing rule, Phase 1 now builds the safety
net **for the order path only** — characterization tests that pin sites 1–12 exactly as
they behave today, including B1, B4 and B8, which are defects and are pinned *as*
defects; replay fixtures; the parity harness; and the smoke suite.

No structural change is permitted until that net exists.
