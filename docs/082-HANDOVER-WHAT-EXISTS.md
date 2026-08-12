# ANTIGRAVITY PRO — What Has Been Built, and What Has Not

**A self-contained handover.** Everything needed to decide what to build next is
in this file. You do not need the repository to read it.

**Measured 2026-07-31.** Every number below was taken from the working tree on
that date by a named command, not from memory.

**Read §7 first if you only read one section.** It is the honest answer to
"what next", and it is not what most readers expect.

---

## 1. WHAT THIS SYSTEM IS

A Node.js system that captures Indian index-options market data, researches it,
and is intended to trade it with real capital through retail broker APIs.

- **Underlyings:** NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50 (NSE);
  SENSEX (BSE)
- **Brokers:** Upstox (active), Dhan, Kotak Neo (connectors exist)
- **Trading state:** **PAPER ONLY. No order has ever reached a broker.**
- **Codebase:** `server.js` is ~8,100 lines; ~120 root modules; 83 test suites

### Market facts that govern every design decision

Do not use plausible values; these are the real ones.

- Broker feeds are **~1 conflated snapshot per second**, not tick-by-tick. There
  is no trade-level or order-level data at this tier.
- Depth is **5 levels**. Open interest lags price by tens of seconds to minutes.
- **No historical option ticks exist at this tier.** Expired-contract history is
  absent or patchy. **Any uncaptured day is permanently lost.**
- Lot sizes changed **Nov 2024** and again for the **Jan 2026** cycle.
- Weekly expiries ended for BANKNIFTY, FINNIFTY, MIDCPNIFTY in **Nov 2024**.
  Only NIFTY (NSE) and SENSEX (BSE) still have weeklies.
- **NSE expiry is Tuesday, BSE is Thursday, since Sep 2025.** Previously both
  Thursday.
- F&O bhavcopy switched to **UDiFF in Jul 2024**. Two schema eras exist.
- SEBI's retail algo framework has been in effect since 2025. Its current
  requirements must be verified with the broker directly and the date recorded.

### The ten principles the code is built to

1. **Fail closed.** Uncertainty blocks the action.
2. **Null is not zero.** Missing stays missing; nothing is fabricated or
   defaulted into a decision or a stored record.
3. **Raw capture is immutable.** Journal before parsing; never edit or delete.
4. **Point-in-time.** Event time and receive time on every record.
5. **One code path** across live, paper and backtest.
6. **Everything versioned and pinned.**
7. **Paper before live.**
8. **Manual override always works**, including when the system is dead or lying.
9. **Estimates labelled as estimates**, at the schema level.
10. **Log the decision and the reason**, not just the outcome.

**Principles 3 and 8 are currently violated by the running system.** See §5.

---

## 2. THE BUILD MODEL

Work is sequenced by what is irrecoverable and what blocks what.

```
STAGE 0  irrecoverable and blocking
   0a  order chokepoint          ← BUILT (0 days in live operation)
   0b  raw data capture          ← LARGELY ABSENT
   0c  effective-dated contracts ← ABSENT
STAGE 1  stop leaking            ← largely built, but see the caveat below
STAGE 2  make the data usable    ← not started
STAGE 3  make results trustworthy← harness built, cannot be used yet
STAGE 4  find out what is true   ← pre-registered, nothing tested
STAGE 5  machine learning        ← not started
STAGE 6  run it as a business    ← partially specified
```

**The system is in Stage 0, and Stage 0 is open.**

**The caveat that matters:** several Stage 1 components are built and tested.
They are not thereby *valid*. Each assumes a raw capture and a contract history
that do not exist, so their outputs inherit that absence. Building more Stage 1+
does not close Stage 0.

---

## 3. WHAT HAS BEEN BUILT

30 new modules, ~3,000 lines of new load-bearing code, 83 test suites, all
passing. Assertion counts are from running each suite.

### 3.1 The order chokepoint — Stage 0a · COMPLETE

The single most important structural property: **every order passes one point,
and going round it is impossible rather than discouraged.**

| Module | What it does |
|---|---|
| `risk-guard.js` | Wraps the broker. `placeOrder` refuses any order without a valid, **bound, single-use, TTL-expiring** approval. Re-checks the kill switch at send time. **Neutralises the connector's raw `placeOrder` with a thrower**, so a stray reference fails loudly at run time rather than relying on a lint rule |
| `risk-manager.js` | Evaluates every order intent against portfolio limits. Three-valued: PASS / BLOCKED / **UNEVALUABLE**, never merged. UNEVALUABLE blocks |
| `risk-config.js` | Versioned risk limits with a change log |
| `kill-switch.js` | Latching, survives restart, atomic state persistence |
| `order-breaker.js` | Automatic latching circuit breaker: order rate, per-instrument rate, **repeated-identical-order detection**. The manual kill switch cannot outrun a loop firing 200 orders in 4 seconds |
| `place-guarded.js` | The one shared, fail-closed placement path used by every call site |
| `risk-state.js` | Builds the portfolio state the risk layer evaluates against. Every field is measured or `null`; nothing defaults to zero |
| `connector-select.js` | Broker named explicitly. A missing or unusable credential is a **startup failure**, never a substitution |

**Before:** 8 order call sites, **7 held the raw connector**; the guard was
constructed ~2,300 lines *after* the engines that needed it, so they could not
have received it even deliberately.
**Now:** 0 raw sites in the main bot; 8 consumers handed the guard by name;
construction order asserted by a test, because the defect was invisible to review.

Tests: `order-path-chokepoint` **46**, `order-path-characterization` **70**,
`risk-layer` **106**.

### 3.2 Execution, margin, data quality — Stage 1

| Module | What it does |
|---|---|
| `limit-order-engine.js` | Limit placement with a repricing ladder; marketable-vs-resting fill logic (a resting order prints at **its own** price) |
| `liquidity-gate.js` | Refuses to trade illiquid strikes; rejections are logged with reasons |
| `slippage-ledger.js` | Records the order book each decision actually saw |
| `execution-config.js` | Per-strategy execution config with rejected-value and joint-warning reporting |
| `margin-calculator.js` | **Broker basket-margin API** (`POST /v2/charges/margin`, verified). Wings release ~49% of margin — `final_margin` ≠ sum of legs |
| `margin-optimiser.js` | Ranks by **return on margin**, not rupee profit |
| `margin-monitor.js` | Utilisation and projected peak, feeding the risk layer |
| `data-quality.js` | **Per-instrument** adaptive staleness against each instrument's own trailing median gap. A single global threshold is wrong in both directions on the same chain |
| `feed-health.js` | Connection health and coverage ratio |
| `data-gate.js` | Blocks trading decisions on untrustworthy data. Uses structured **codes**, not message text |
| `instrument-guard.js` | One `/api` middleware refusing unknown instruments — replaced 42 route patches |

Tests: `execution-layer` **99**, `margin-layer` **74**.

### 3.3 Validation — Stage 3

| Module | What it does |
|---|---|
| `validation-harness.js` | Promotion gate with criteria declared before results are seen |
| `walk-forward.js` | Walk-forward, purged + embargoed cross-validation |
| `validation-stats.js` | Deflated Sharpe (Bailey–López de Prado), PBO |
| `validation-ledger.js` | Family trial counter feeding deflated significance |
| `parity-harness.js` | Replays recorded sessions through two code paths and **diffs what the broker actually received**. Differences must be accepted **by name**; an unnamed difference always fails |

Tests: `validation-harness` **92**.

**Current validation result: 9 of 9 strategies report `CANNOT_VALIDATE`,**
because no trial count was ever recorded before pre-registration existed.

### 3.4 Operations and control

| Module | What it does |
|---|---|
| `control-auth.js` | Gate on the kill switch, kill reset, risk config, engine arming, trade-mode switch. **Never no-ops** — with nothing configured it falls back to loopback-only and says so. Accepts a query parameter so a **phone browser** can reach the kill switch. Redacts the credential from its own audit log |
| `broker-positions.js` | Read-only positions view **from the broker**, consulting no internal book — asserted by a test that greps the module |
| `flatten.js` | Programmatic flatten. Trips the kill switch **first and confirms it**; exits **short legs before long protective legs**; market orders; re-reads afterwards; **refuses to report success on a partial exit** |
| `raw-journal.js` | Append-only journal: hourly roll, self-describing header, dual disk, SHA-256 manifest, **truncation detectable**, and **absence recorded as a fact** |

Tests: `control-auth` **33**, `flatten` **55**, `connector-select` **31**,
`raw-journal` **55**.

### 3.5 Documentation

**Docs 058–081** (24 documents this programme). The load-bearing ones:

| Doc | Contents |
|---|---|
| 071 | Research data-lake design — 10-year WORM raw-tick warehouse |
| 072 | **Research agenda pre-registration** — 12 programmes, priors recorded before testing |
| 073 | Operations: environment separation, startup self-check, DR procedures, runbooks, **manual flatten card**, capital and drawdown policy, drill schedule |
| 074 | **Phase 0 inventory** — call graph, construction-order map, state ownership, dangerous defaults, undocumented behaviours |
| 075 | Chokepoint build record; audit score 0/17 → 11/17 |
| 076 | **AI agent use policy** — permission tiers, task template, verification obligations, and a **claim audit reporting a 33% inaccuracy rate on the agent's own claims** |
| 077 | Stage 0 assessment |
| 079 | **Standing context** — attach to every task |
| 081 | Latest session: status-surface fixes, positions view, flatten |

---

## 4. DATA ON DISK — what research can actually use

| Asset | Coverage | Resolution | Usable for |
|---|---|---|---|
| NIFTY F&O bhavcopy | **600 days**, 2024-01-08 → 2026-06-17 | Daily EOD per contract, 18 expiries/day. OI, change-OI, volume, settle, **underlying close, market lot** | Structural breaks, VRP, term structure, skew — all **daily only** |
| 1-minute underlying | 2025-09-01 → 2026-06-19, ~190 sessions | 1-min OHLC, NIFTY + BANKNIFTY + SENSEX | Intraday seasonality of the **underlying only** |
| Daily underlying | 2023-03-08 → 2026-06-18, 812 days | Daily OHLC | Realised volatility |
| Live raw option chain | **6 sessions** | **~5 min**, starting **11:16–12:06 IST** | Almost nothing yet |
| Option premium candles | 15 days | Intraday, premium OHLC only | Limited |
| Order-path replay fixtures | 4 sessions (quiet/trending/expiry/feed-gap) | Derived from real capture | Parity testing |

### The three facts that constrain all research

1. **The market opens at 09:15. Capture has never started before 11:16.** On
   6 of 6 sessions, two to three hours of every session is missing.
2. **The captured cadence is ~5 minutes, and it varies** — 1.3 minutes one day,
   9.7 the next. Any time-weighted statistic is biased unless reweighted.
3. **An unchanged snapshot is not written at all.** The capture skips the write
   when the chain fingerprint matches the previous one. So the archive **cannot
   distinguish "the market did not move" from "we were not watching."** Coverage
   is not recorded as a fact.

**Consequence:** of the 12 pre-registered research programmes, **4 are runnable
today** (structural breaks, variance risk premium, term structure, skew — all
from the bhavcopy, all daily), **2 are partial**, **3 are blocked on data that
could be fetched in a day** (SENSEX/BANKNIFTY option history, India VIX history,
an event calendar), and **3 are not feasible at any near-term cost**.

**Also measured and recorded:** the 600-day bhavcopy has already been used for
**at least 30 strategy variants** before any pre-registration existed. Anything
tested on it starts at trial number 31, not 1.

---

## 5. THE STATE THAT MATTERS MOST

**The repository is not what is running.**

```
$ curl http://127.0.0.1:3000/api/control/audit
HTTP 404
```

That endpoint exists in the source. The process serving port 3000 does not have
it. **The running process is older code, with the control surface open.**

| | In the repository | Actually running |
|---|---|---|
| Order paths guarded | 8 of 8 | unknown — never verified against the live process |
| Control endpoints authenticated | 10 gated | **NO — not deployed** |
| Connector selection explicit | YES | **NO — old code still has the AUTO fall-through** |
| Circuit breaker | YES | **NO** |
| Position reconciliation | **NO** | NO |
| Manual flatten rehearsed | **NO — never run, not even in paper** | NO |
| Suite | 83/83 | — |
| Chokepoint days in live operation | **0** | — |

**Everything built in this programme is currently theoretical.**

### Principle violations, live right now

- **#3 "Raw capture is immutable, never delete."** `server.js:736` runs
  `while (files.length > 40) unlinkSync(...)` on the option-candle archive,
  inside two nested `catch (_) {}`. 15 files today; at 41 trading days the
  oldest day is destroyed permanently. And the capture path parses before
  writing, so there is no raw to be immutable about.
- **#8 "Manual override always works."** `CONTROL_TOKEN` is blank, so the
  operator's phone cannot reach the kill switch. The flatten exists in code and
  has never been run.

---

## 6. OPEN DEFECT REGISTER

| # | Defect | Severity |
|---|---|---|
| **D-0** | Repository ≠ running process. Chokepoint, control gate, breaker, explicit connector selection — **none deployed** | **critical** |
| **D-3** | The control gate's loopback fallback assumes the tunnel sets `x-forwarded-for`. **If it does not, a public caller looks local and is allowed without a token.** Unverified | **critical, unknown** |
| **D-5** | Option-candle archive deletes itself at 41 days, inside two silent catches | **high, dated** |
| **D-7** | `kotak-neo-connector.js` has **no `getPositions()` at all**, and `LIVE_CONNECTOR=kotak` is a supported value | **high** |
| **D-8 / A5** | Both connectors return `[]` when the positions read **fails** — an unreachable broker is indistinguishable from a flat book. **Blocks reconciliation** | **high** |
| D-1 | `stock/stock-engine.js:417,538` — two raw order paths in a separate bot, outside every control built | medium |
| D-4 | `CONTROL_TOKEN` blank ⇒ no phone access to the kill switch | medium |
| A8 | Malformed `MAX_TRADES_PER_DAY` → `NaN` → `tradesToday >= NaN` is false for every count ⇒ **the daily trade limit is silently disabled** | medium |
| A9/A10 | `tradesToday` and `openPosition` reset on restart; PM2 allows 10 restarts | medium |

---

## 7. WHAT TO BUILD NEXT — and the trap in that question

### The trap

Every instinct says: build reconciliation, build heartbeats, build the data lake,
run the research programmes. All of that is real work and all of it is on the
plan.

**None of it is the next thing.**

The system has spent several sessions producing high-quality, well-tested code
that **is not running**. Building more increases the gap between the repository
and the process. The highest-value work available is not code.

### 7.1 FIRST — deploy what exists. Not code.

In order, outside market hours (09:00–15:45 IST), never on an expiry day:

1. **Determine whether the public tunnel sets `x-forwarded-for` (D-3).** Do this
   *before* setting `CONTROL_TOKEN`, because until the token exists the loopback
   fallback is the only thing protecting the kill switch. If the header is
   absent, the fallback must be removed and the token made mandatory.
2. Set `CONTROL_TOKEN` (32 random bytes). Restart. Confirm the two banner lines.
3. Confirm `/api/control/audit` no longer returns 404. **That is the moment D-0
   closes.**
4. From the operator's **actual phone**, through the **actual tunnel**: one read,
   then one timed kill-and-reset drill. This is the first measured response time
   this system will have.
5. Run the flatten **in paper, once**, and read back the result. It has never
   been executed.

### 7.2 SECOND — fix the two defects that block the next build

- **D-8/A5:** make `getPositions()`/`getOrders()` distinguish a list, a confirmed
  empty, and a thrown error. **Reconciliation cannot be built until this is
  fixed** — built on the current behaviour it would compare internal state
  against `[]` during an outage and conclude MATCH. A broken check that passes is
  worse than no check.
- **D-5:** stop the option-candle archive deleting itself. It is dated: it fires
  at 41 trading days.

### 7.3 THIRD — Stage 0b, the only work whose cost rises daily

Everything else on this list can be done next month at the same price. This
cannot.

- **Journal the raw bytes before parsing.** `raw-journal.js` is built and tested
  (55 assertions) and **wired to nothing**. The wiring diff is written out in
  doc 077 §6.1.
- **Record coverage as a fact** — write a record for every poll, including polls
  that returned nothing and polls whose result was unchanged.
- **Start capture at 09:15** and hold a fixed cadence. This is supervision and
  configuration, not code.
- **Land the official files daily** with hashes. The bhavcopy is ~30 trading days
  stale.

> Price history can be re-bought from the broker at any time. **Last Tuesday's
> option chain at 11:00 cannot be bought back at any price.**

### 7.4 FOURTH — Stage 0c, cheap and already sitting in the data

Effective-dated contract terms. Every historical P&L computed with today's lot
size is wrong by a multiple. And the fix does not need an external circular
table: **market lot is field 28 of the UDiFF bhavcopy already on disk**, and
expiry weekday is derivable from the expiry dates present in each day's file.

### 7.5 THEN, and only then

Reconciliation → heartbeats → normalized store → bars → IV surface → backtest
engine → the research programmes, starting with **structural breaks**, because
its result determines how every other study must sample its data.

### 7.6 One irreplaceable asset, time-critical

The bhavcopy archive ends **2026-06-17**. Roughly **30 trading days** exist at
NSE that no script here has ever fetched. That is the only genuinely untouched
out-of-sample data available without waiting.

**It is not at risk of being lost — it is at risk of being *looked at*.** Fetch
it into a **sealed** directory with a SHA-256 manifest, gate access behind a
logged unseal step, and do it before any script sweeps it into a 630-day
backtest. Out-of-sample data can only otherwise be bought with calendar time, at
roughly **21 trading days per month**.

---

## 8. HOW TO WORK ON THIS CODEBASE

### Permission tiers

- **Tier 0, propose only, never apply:** credentials, risk limits, kill switch,
  position sizing, the order chokepoint, anything that can place a live order,
  production config, deletion of raw or audit data, and the **critical test set**
  (`risk-layer`, `order-path-chokepoint`, `order-path-characterization`,
  `instrument-registry`, `ledger-safety`, `repo-integrity`, `perf-budget`).
- **Tier 1, propose only:** execution logic, state persistence, reconciliation,
  connectors, the startup self-check path, and **`server.js` in its entirety** —
  its dependency mechanism is construction order, so any edit is potentially an
  ordering change.
- **Tier 2, apply with review:** research code, backtest engine, pipelines, tests
  outside the critical set.
- **Tier 3, apply freely:** documentation, scratch analysis.

### Verification owed on every change

Raw command output, not a summary. A one-command way for a human to re-run it.
**An explicit statement of what was NOT verified.** For money paths, a regression
test that demonstrably **fails against the old code**. "Tests pass" without the
output counts as no verification.

### Load-bearing ugliness — do not tidy these

Code that looks wrong and is not:

- `risk-guard.js` mutating the wrapped connector's `placeOrder` — that is the
  bypass barrier.
- `risk-manager.js` requiring the caller to declare `riskMapComplete` — removing
  it makes a risk map that **failed to build** read as a portfolio with no risk.
- `live-connector.js` passing `retries: 0` for orders while the client default is
  3 — an order is not a read.
- `positions-book.js` reporting `unavailable` engines separately and never
  summing a null as zero.
- `data-gate.js` using structured codes rather than message text — a gate here
  once matched a regex against its own prose, and **its test contained the same
  bug and passed**.
- `broker-positions.js` refusing to say "flat" — see D-8.

### The failure mode this codebase keeps producing

Four times in four sessions, a test constructed its own input, asserted something
true of that input, passed, and protected nothing:

- a data gate matched a regex against prose — and so did its test;
- a wiring test confirmed the *consumer* called the right function while the
  *provider* still handed it the raw connector;
- a log-redaction test built a request with the token in `req.query` and a clean
  `url` — a shape Express never produces;
- a status-field fix used `orderCapability(live)` at request time, after the
  guard had replaced the method, and reported `live-capable` for a connector that
  refuses.

**A test that constructs its own input tests the constructor's idea of the
input.** Where a real request, a real file, or a real wiring can be exercised, it
must be.

A claim audit run on the agent's own work found **4 of 12 claims materially
inaccurate (33%)** — and every inaccurate one was a claim of *completeness* or
*provenance* ("exhaustive", "nothing is synthetic", "the only"). Every accurate
one had a mechanical check that was actually run. Prefer tasks with a mechanical
check.

---

## 9. THE ONE-PARAGRAPH SUMMARY

A well-tested order chokepoint, risk layer, execution layer, margin layer, data
quality gate and validation harness have been built — roughly 3,000 lines of new
code across 30 modules, 83 passing test suites, and 24 design documents. **None
of it is running.** The system is in Stage 0: the chokepoint is complete but has
never operated live, raw data capture is largely absent and is losing
irreplaceable option-chain data every trading day, and effective-dated contract
metadata does not exist, which makes every historical P&L wrong. The next work
is not code — it is deploying what exists, verifying one unknown about the public
tunnel, and closing the capture gap, in that order. Research can begin on 4 of 12
pre-registered programmes today using 600 days of daily bhavcopy already on disk;
the other 8 are blocked on data that is either cheap to fetch or permanently
gone.
