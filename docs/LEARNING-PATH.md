# Antigravity Pro — Step-by-Step Learning Path

> A structured curriculum to understand this codebase from zero to confident.
> Self-contained. Every step names the exact files to open, the command to run,
> and a checkpoint question you should be able to answer before moving on.
>
> **Golden rule while learning:** keep `TRADE_MODE=paper`. Never flip to live to
> "see what happens." Every engine in this repo runs paper-first by design.

---

## The 30-second mental model

Antigravity Pro is a **Node/Express workstation** for trading NIFTY / SENSEX /
BANKNIFTY index options. It:

1. Pulls **live market data** from a broker (Upstox is the active connector).
2. Runs **strategy engines** that produce signals (mostly option-*selling*,
   because that is where the statistical edge is).
3. **Paper-executes** those signals through a risk/capital gate — no real money
   unless explicitly switched to live.
4. Serves a **dashboard** (`public/dashboard.html`) that shows everything live.

The single most important architectural idea — **THE SPLIT**:

- **Money path fails CLOSED** — capital, risk, execution: if a file is corrupt or
  a value is missing, it *refuses to trade* (safe).
- **Evidence path fails OPEN** — signals, high/low records, analytics: if data is
  missing it *degrades to "unknown"* rather than blocking (informative).

If you internalize only one thing, internalize the SPLIT.

---

## Stage 0 — Get it running (you are likely here already)

**Goal:** see the live dashboard on your own machine.

```bash
npm install
# copy .env.example -> .env and fill broker creds (never commit .env)
npm start
# open http://localhost:3000/dashboard.html
```

**Checkpoint:** boot log shows `Upstox ✓ connected`, `Listening on 0.0.0.0:3000`,
and `engine-state applied → strangle=… gammaBlast=… niftyAuto=… sensexAuto=…`.
On a market day it also backfills ORB and Day H/L. If you see those lines, the
system is healthy.

**Note:** the ASCII banner prints `Mode: LIVE (Dhan)` as static text, but each
engine logs `paper=true`. Trust the per-engine `paper=` flag, not the banner.

---

## Stage 1 — Read the map before the territory

**Goal:** understand what exists before reading any code.

Read, in this order (they are written for exactly this):

1. `README.md` — setup, main components, safety checklist.
2. `docs/CONTEXT-SHORT.md` — the fastest orientation.
3. `docs/MASTER-CONTEXT.md` — fuller context.
4. `docs/000-ANTIGRAVITY-PRO-MASTER-ARCHITECTURE.md` — the capstone that indexes
   docs 001–050 and states the evidence-grounded ground truth (who writes
   `capital`, who owns `positions`, the singletons, the SPLIT, the live-gate).

**Checkpoint:** you can name (a) the active broker connector, (b) where the
dashboard is served, and (c) what the SPLIT means. Don't move on until you can.

---

## Stage 2 — Trace one request end-to-end

**Goal:** connect a dashboard number to the code that produced it.

The dashboard's main tile feed is the `/api/quick` endpoint. Trace it:

1. Open `server.js`, search for the route that builds the quick payload
   (`/api/quick`). See what it assembles: ticker prices, score, signals, regime.
2. Follow one field — e.g. the index price — back to the broker connector
   (`upstox-connector.js` / `live-connector.js`).
3. Follow the option chain (`/api/... chain`) to `option-analyzer.js` and
   `free-chain.js` / `sensibull-fetcher.js`.

**How to poke the API directly:**

```bash
curl -s http://localhost:3000/api/quick | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(Object.keys(JSON.parse(s))))"
```

**Checkpoint:** pick any number on the dashboard and name the file + endpoint it
comes from.

---

## Stage 3 — Market data layer

**Goal:** understand how raw broker data becomes clean, typed inputs.

Files to read (in order):

- `broker-connector.js` — the adapter interface.
- `upstox-connector.js` — the active implementation (quotes, chain, candles).
- `instrument-registry.js` — **the single source of truth** for lot / tick /
  step / expiry-weekday per instrument. Fail-closed. Run:
  ```bash
  npm run preflight:registry
  ```
  This checks for registry drift (a swapped expiry weekday once cut BANKNIFTY
  PoP from 100% → 91.8%, so this matters).
- `strike-resolver.js` — turns "ATM ± n" into a real tradable strike using the
  registry.
- `redis-store.js` / `redis` wiring — how Day H/L and records are persisted.

**Checkpoint:** explain why the Instrument Registry must fail-closed, and what
`npm run preflight:registry` protects against.

---

## Stage 4 — The strategy / signal layer

**Goal:** understand how a signal is formed and *why selling is the edge*.

Read in this order:

- `strategy.js` — the base signal logic.
- `multiconfirm.js` — multi-indicator confirmation (13 indicators).
- `signal-engine.js` + `confirmed-signals.js` — the confirmed-signal pipeline.
- `trade-planner.js` — regime → structure → size (never a naked buy).
- `vrp-monitor.js` + `vol-context.js` — Volatility Risk Premium, the real edge:
  implied vol is usually richer than realized vol, so *sellers* get paid.
- `meta-label.js` + `signal-health.js` — probability/quality labelling and
  edge-decay detection.

**Key truth to absorb (from the repo's own backtests):**
directional *option buying* on NIFTY has **no durable edge** (1200-trade,
197-day real-data backtest: PF ≈ 0.94, a net loser — theta bleeds buyers).
The edge is **selling** (short strangle / condor) when VRP is favourable.

**Checkpoint:** explain VRP in one sentence and why it favours sellers.

---

## Stage 5 — Execution, risk & capital (the money path — fails CLOSED)

**Goal:** understand the gate that stands between a signal and an order.

Read in this order:

- `position-sizer.js` + `vix-kelly-sizer.js` — how many lots (VIX-scaled,
  half-Kelly; `Math.max(1, …)` forces ≥ 1 lot).
- `execution-engine.js` — paper vs live execution; the risk brake.
- `positions-book.js` — the open-position ledger.
- `capital-engine` logic (search `capital` in `server.js` + related) — equity
  restore/persist. Note the ADRs: `docs/APPROVAL-capital-overwritten-at-boot.md`,
  `docs/APPROVAL-consec-losses-persisted-stale.md`.
- `charges.js` — real brokerage/tax modelling so paper P&L is cost-honest.

**Checkpoint:** name three ways the money path fails closed (e.g. corrupt equity
file → refuse, missing registry value → refuse, unknown regime → no trade).

---

## Stage 6 — The trading engines (what actually places paper orders)

**Goal:** know each engine, its rationale, and its on/off state.

- `strangle-engine.js` — **the product face.** Paper short-strangle / condor.
  Backtests (120-day and 600-day real bhavcopy) reconfirm the selling edge
  (~89% win on SHORT_STRANGLE). Paper-only; forward-test before any live idea.
- `gamma-blast-engine.js` + `gamma-blast-detect.js` + `gamma-blast-params.js` —
  expiry-day option *buying*, the **only** buy strategy with a rationale
  (gamma explodes near expiry). Paper, forward-test only.
- `afternoon-engine.js`, `bounce-engine.js`, `pop-seller.js` — other paper
  engines.
- `agents-engine.js` — the 5-agent news→impact→fusion→risk→paper pipeline
  (`public/agents.html`).

Engine on/off state is persisted in `data/config-overrides.json` and applied at
boot (you saw `engine-state applied → …` in the log).

**Checkpoint:** for each engine, state (a) buy or sell, (b) its rationale,
(c) is it on by default.

---

## Stage 7 — Backtesting & validation (how edge claims are proven)

**Goal:** learn to *verify* a claim instead of trusting it.

- `bt-real.js`, `bt-lib.js`, `bt-strategies.js` — the real-data backtest engine.
- `bt-strangle-*.js` (costs / regime / trend / tailsafe) — strangle studies.
- `bt-validate.js` — validation harness.
- `backtest-report.js` + `forward-test-report.js` — reporting.
- `docs/008-BACKTESTING-INTEGRITY.md`, `docs/009-VALIDATION-ENGINE.md`,
  `docs/010-PAPER-TRADING-EVIDENCE.md` — the integrity rules.

**Critical discipline (from the project's own history):** two "edge" claims were
once found to be **look-ahead artefacts** (see the commit
`fix(evidence): the platform's two edge claims were look-ahead artefacts`).
Always ask: could this backtest have seen the future? Grade every claim
**Verified / Measured / Estimated / Opinion / Unknown** and never merge tiers.

**Checkpoint:** run a backtest and read its output critically — is it cost-net?
is it out-of-sample? could it peek ahead?

---

## Stage 8 — Dashboard & the rest of the UI

**Goal:** map every dashboard panel to its API + file.

- `public/dashboard.html` — the ONE home (superset of the old command page).
  Top cluster now: **High/Low levels → Strike price timeline → Option chain →
  Market quotes/H-L record**, then Performance, Positions, Signals, Trade plan,
  Gate, Gamma-Blast, Quick access.
- Other pages: `agents.html`, `quant.html`, `payoff.html`,
  `pattern-signals.html`, `signal-heatmap.html`, `chart.html`, `strategy.html`.
- `auth.js` + `public/login.html` — opt-in JWT/RBAC cookie auth
  (`AUTH_ENABLED` default off).

**Checkpoint:** open the dashboard, pick three panels, and for each name the
`/api/...` endpoint feeding it.

---

## Stage 9 — State, persistence & recovery

**Goal:** understand what survives a restart and how.

- `data/config-overrides.json` — engine on/off + runtime knobs (applied at boot).
- `data/*.json` / `*.jsonl` — ledgers (trades, signal outcomes, paper positions,
  VRP monitor, pop-book, gex-vix history…).
- `redis-store.js` — Day H/L and high/low records persistence.
- `safe-write.js` — atomic writes so a crash mid-write can't corrupt a ledger.
- `docs/005-STATE-PERSISTENCE-RECOVERY.md`, `docs/025-PERSISTENCE-BACKUP-DR.md`.

**Checkpoint:** restart the server and confirm equity, engine-state, and Day H/L
are restored (you saw `📥 Restored equity…` and `Backfilled … H/L` in the log).

---

## Stage 10 — Testing & operational hygiene

**Goal:** know how to prove you didn't break anything.

```bash
npm test                    # the test suite (test/run.js)
npm run preflight           # boot preflight checks
npm run preflight:registry  # instrument-registry drift check
```

- `test/` — the suites (keep them green before committing).
- `ops-health.js` — runtime health signal surfaced on the dashboard.
- `docs/029-SRE-OPERATIONS.md`, `docs/021-OBSERVABILITY.md`.

**Checkpoint:** `npm test` is green and you can explain what one failing test
would mean.

---

## A suggested 5-day plan

| Day | Focus | Deliverable |
|-----|-------|-------------|
| 1 | Stages 0–2 | Run it; trace `/api/quick`; draw the request path on paper |
| 2 | Stages 3–4 | Explain the market-data layer + why selling is the edge |
| 3 | Stages 5–6 | Explain the money-path gate + every engine's on/off + rationale |
| 4 | Stage 7 | Run one backtest; critique it for look-ahead + cost-honesty |
| 5 | Stages 8–10 | Map 5 dashboard panels to APIs; `npm test` green; restart-recovery check |

---

## Mental models to carry forever

1. **The SPLIT** — money fails closed, evidence fails open.
2. **Selling is the edge; buying bleeds theta** — proven on this repo's own data.
3. **Grade every claim** — Verified / Measured / Estimated / Opinion / Unknown.
4. **Paper-first, forward-test before live** — no exceptions.
5. **The Instrument Registry is the single source of truth** — never hardcode a
   lot/expiry; ask the registry.

---

## Fast file index (cheat sheet)

| Concern | Start here |
|---------|-----------|
| Server + all API routes | `server.js` |
| Live market data | `upstox-connector.js`, `broker-connector.js` |
| Contract truth (lot/tick/expiry) | `instrument-registry.js` |
| Option chain analytics | `option-analyzer.js`, `free-chain.js` |
| Base signal logic | `strategy.js`, `multiconfirm.js` |
| Confirmed-signal pipeline | `signal-engine.js`, `confirmed-signals.js` |
| Regime → structure → size | `trade-planner.js`, `vrp-monitor.js` |
| Sizing | `position-sizer.js`, `vix-kelly-sizer.js` |
| Execution + risk brake | `execution-engine.js`, `positions-book.js` |
| The selling product | `strangle-engine.js` |
| Expiry-day buying | `gamma-blast-engine.js` |
| News→trade agents | `agents-engine.js` |
| Backtesting | `bt-real.js`, `bt-lib.js`, `bt-strategies.js` |
| Dashboard | `public/dashboard.html` |
| Persisted engine state | `data/config-overrides.json` |
| Master architecture doc | `docs/000-ANTIGRAVITY-PRO-MASTER-ARCHITECTURE.md` |
