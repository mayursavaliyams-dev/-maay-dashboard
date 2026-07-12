> **SUPERSEDED — do not send this file.**
> `docs/STATUS.md` is the single source of truth. It is self-contained.
> This file is kept only as history / detail, and is referenced from STATUS.md when needed.

---

# ANTIGRAVITY PRO — PENDING WORK

**Single source of truth for what is left.** Regenerated 2026-07-10 after Task A.
Suite 45/45. Nothing committed. `execution-engine.js` untouched.
`server.js` carries two owner-approved patches (P1-T1, P1-T2); **8 raw write sites remain**.

Read with `docs/STATUS.md` (what was done) and the newest `docs/sessions/SESSION-*.md`.

---

## 5. PENDING — the complete list, measured 2026-07-10

Suite 45/45. Nothing committed. `execution-engine.js` untouched. `server.js` carries two owner-approved
patches (P1-T1, P1-T2) and **8 raw write sites remain**.

### 5.1 BLOCKED ON APPROVAL — protected file (`server.js`)

**Next in queue: P1-T3, `server.js:3764` — `POST /api/strategy-config`.** The third and last raw writer
of `config-overrides.json`. Same read-modify-write, same `catch (_) {}`, same 12-key destruction.

The 8 remaining raw write sites, in the order they should be approved:

| # | line | file written | why it matters |
|---|---|---|---|
| 1 | 3764 | `config-overrides.json` | last of three writers; capital + daily-loss brake |
| 2 | 5876 | `signal-paper-positions.json` | **a position ledger, 2 open positions, no `.bak`.** Corrupt ⇒ engine believes it is flat ⇒ re-enters ⇒ doubled exposure, no record of the first leg |
| 3 | 1330 | `market-state.json` | the opening range is **not re-derivable** after 09:30 |
| 4 | 5855 | `vrp-monitor.json` | 40-observation rolling window; not reconstructible |
| 5 | 4246 | `eod-<date>.json` | daily archive, written on the shutdown path |
| 6 | 539, 576 | `opt-hl/`, `opt-candles/` | derived caches, **60 s** timers (not 5 s — my earlier note was wrong) |
| 7 | 2028 | **`.env`** | live broker tokens. **NOT SAFE as one patch** |

**`.env` (`:2028`) needs three separate approvals, in this order:**

1. atomicity **preserving the current mode** (`0644`);
2. the mode decision — an atomic `rename` installs the **temp file's** mode, so adopting atomic writes
   naively **silently re-permissions `.env`**. And `.env` is untracked, so `git checkout` will not undo
   a permission change;
3. move the token out of `.env` entirely (`data/broker-tokens.json`, `0600`, atomic, `.bak`), and fix
   `_envPath = path.resolve('./.env')` — it resolves against `process.cwd()`, so starting the server
   from another directory writes a **new `.env` in the wrong place**.

**Also protected, also waiting:**

- **The three-line package that unblocks five performance targets at once.** `app.listen()`'s return
  value is discarded, so `_gracefulShutdown` cannot call `server.close()` — it kills in-flight requests
  with a `setTimeout(() => process.exit(0), 400)` guess — and with no `http.Server` object **no
  WebSocket can ever attach**.
  ```js
  const server = app.listen(PORT, …);                              // 1. capture it
  app.use('/api/m', require('./module-contract.js').mountAll());   // 2. mount the 11 surfaces
  server.close(() => …);                                           // 3. drain in-flight requests
  ```
  Unblocks: API latency measurement · WebSocket · the 250 ms refresh · atomic writes · validated reads.
- **71 silent catches** and **9 unvalidated JSON reads** inside `server.js`.
- **TD-1** — `option-analyzer.js:166` fallback Greeks hardcode `volatility = 0.15`, discarding the live
  IV the caller solved two lines earlier. The fix touches `server.js:2269`.
- **TD-2** — one shared `OptionAnalyzer`, mutated per request: a race on every Greek.
- **C2-02** — webhook secret, rate limiting, CSP.

### 5.2 BLOCKED ON APPROVAL — behaviour change (non-protected)

Characterized by test, **not applied**. Each changes paper-trading behaviour, so none qualifies for
auto-approval.

| # | change | direction |
|---|---|---|
| ~~**A**~~ | ~~`event-risk-filter.js:57`~~ — **DONE 2026-07-10.** An unknown VIX now yields `REDUCE`, `sizeScale 0.5`, `vixUnknown: true`, `vix: null`, and names the missing evidence | gate is now **stricter** during an outage |
| **B** | `event-engine.js` — `vixLift = vix.value ? … : 0`. The same defect, upstream, in the *score*. The engine already returns `regime: 'UNKNOWN'`; the score ignores it | score rises when VIX is unknown |
| **B2** | **`server.js:5785` — PROTECTED.** `cPanic = vix != null && … : 100`. An unreachable VIX scores **100 = maximally calm**, identical to a real calm reading. `ivp` and `vrp` share the shape (`null → 50`). **Approval package: `docs/APPROVAL-regime-unknown-vix.md`** | regime becomes `STAND-DOWN` on an outage |
| **C** | `event-engine.js` — an unrecognised event type falls back to `OTHER` (30). An RBI policy day typed `RBI` instead of `RBI_POLICY` scores **30 (LOW)** instead of **90 (HIGH)** | flags unknown types instead of downgrading them |
| **D** | `confluence-learner.js:137` — `if (!isFinite(s) \|\| s === 0) continue`. A leg scoring exactly 0 is skipped, indistinguishable from an absent leg, and never counted as a sample | changes **learned weights** |
| **E** | `pop-seller` P&L is **gross**, not net — it applies no charges, while three other engines use `charges.js` | changes reported paper P&L |
| **F** | `pop-seller.buildIronCondor` returns two short legs and **no wings**: unbounded loss, no `maxLoss` field, under a name that promises defined risk | changes the structure it builds |

**The caution that blocked A has been resolved by measurement, not by assumption.** `server.js:5838`
passes `ctx.regime?.components?.ivImplied` as `vix`; that traces to `server.js:5772`,
`vix = Number((await eventEngine.getVix()).value) || null` — a Yahoo network call inside `catch (_) {}`.
Run from this machine, `getVix()` returned **12.34 in 4,513 ms**. The value **is** normally present, so
A does not pin the gate at `REDUCE` in ordinary operation; it engages exactly when the source is down.

**A, B and B2 are one defect at three layers.** A is fixed. B2 is the most consequential and is
protected: isolated, `cPanic` alone swings the regime score **+10 points** when the VIX is unreachable,
and near the `>= 62` threshold that single component decides `SELL-ON` versus `REDUCE`:

| VIX | `cPanic` | regime score | verdict |
|---|---|---|---|
| 25 (panic, known) | 0 | 61 | REDUCE |
| 12 (calm, known) | 100 | 71 | SELL-ON |
| **null (unreachable)** | **100** | **71** | **SELL-ON** |

### 5.3 UNBLOCKED — no approval needed, not yet done

- **TD-4** — boot-time advisory lock on `data/`. `withLock` already exists in `safe-write.js`.
  Atomicity is **not** mutual exclusion: it prevents corruption, not lost updates.
- **UI-02** — 18 of 21 pages still carry drifted private CSS token blocks.
- **UI-03** — 16 independent polling timers on `dashboard.html`, fastest 1,000 ms. The 250 ms target is
  reachable only over a WebSocket, which is blocked on 5.1.
- **Deprecate `command.html`** — 14 `demo*` functions fabricate market data with `Math.random()`,
  including max-pain. They are labelled `PAPER·DEMO` on screen, so this is not deception, but it is
  browser-side market logic and `dashboard.html` is now the home page.
- **TD-3** — `bt-data` is mounted `:ro` but the `bt-*.js` CLIs write results into it.
- **EngineVerdict migration** — 15 modules still emit BUY/SELL; only `pop-seller` exposes `verdict()`,
  and it **abstains**. Blocked on the six decisions in §5.4.

### 5.4 BLOCKED ON A DECISION, not on work

Six answers are needed before another engine can be migrated. They will not be guessed.

1. **Does `score` survive?** `engine-verdict.js` has `score: -1..+1`; the newer contract has no `score`,
   only a verdict enum. Without `score` a Meta Decision Engine has a **class** but no **magnitude**, and
   can only ever be a veto aggregator.
2. **`timestamp`** — the contract asks for one; the module deliberately **injects** `computedAt`, because
   `pop-seller`'s suite went red at midnight when `scanPoP` read the wall clock. A clock port, or
   `Date.now()`?
3. **"No globals / no mutable singleton"** — `module-contract.js:141` holds a module-level registry. Does
   the rule bind AI engines only, or infrastructure too?
4. **Forbidden-list scope** — "No Kelly / No position sizing" versus `strangle-engine`, which calls
   `position-sizer` today. Engines only, or everything?
5. **The 20 ms latency budget** applies to what — `verdict()`, or the underlying compute?
6. **`confluence-learner.track()` rejects an `EngineVerdict`.** It accepts only `decision: 'BUY'|'SELL'`.
   **The reliability estimator cannot learn from the only object engines are allowed to emit.** This is
   the blocking coupling between the AI Architecture Rule and reliability measurement.

### 5.5 The three cheapest actions, which gate everything else

1. **Start capturing intraday option chains today.** Four days of history exist. Every day of delay is a
   day permanently lost, and this gates all gamma/dealer/flow research.
2. **Log the outcome of every engine's hypothetical call.** Per engine today: `ai-agents` 20,
   `signal-engine` 11, `signal-paper` 11, `strangle` 7, `gamma-blast` **1**. Platform total **50**;
   ~200 are needed. **No engine's reliability can be measured**, so every `reliability` is `null`, every
   weight is 0, and a weighted ensemble is mathematically empty. Meta Decision v1 can therefore only
   ever return `INSUFFICIENT_DATA` — the honest answer, not a bug.
3. **Write a daily NAV series** (per book, net of charges). Every portfolio statistic is computed from a
   series that does not exist.

---

---

## 6. BLOCKED BY EVIDENCE, not by code — do not "solve" these

| id | fact | what it forbids |
|---|---|---|
| **E1** | `charges.js`: `.env.example` says STT `0.0625` / exch-txn `0.053`; the code says `0.1` / `0.03503` | **Which pair is correct is Unknown.** Both are wrong, in opposite directions, cancelling to **−0.33%** — the near-cancellation *is* the hazard, because the number looks right. Needs the exchange's published circular. **Do not guess.** |
| **F4** | `oi_unit` is unverified — contracts vs shares | **GEX is withheld.** It would be wrong by 25–75×. |
| **M2** | **41 labelled outcomes** exist in total | no calibrated probability, no empirical CVaR, no Brier optimisation, no ensembles |
| **P1/P3** | **4 distinct trading days**; **no daily NAV series exists anywhere** | no Sharpe/Sortino/Calmar, no drawdown, no correlation matrix (15 params, 4 observations), no portfolio intelligence |
| **V1** | the underlying has **zero volume** by construction | no Wyckoff, no volume profile, no absorption |

**The deadlock the AI Architecture Rule creates, and how the owner resolved it.** `reliability` must be
measured *out-of-sample*; out-of-sample outcomes come from running engines. There are 41 outcomes;
~200 are needed. Those outcomes are produced by exactly the four paper self-executors the rule would
silence. **Owner decision:** paper forward-test execution **continues** and is the only sanctioned
execution — no broker order, ever, and nothing published as a recommendation or a probability. The
migration is **additive**: add `verdict()` alongside each engine's existing method; the BUY/SELL
emitter stays until a consumer exists. No caller breaks.

---

