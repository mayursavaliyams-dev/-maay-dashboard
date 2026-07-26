# ANTIGRAVITY PRO — PROJECT STATUS REPORT

**Date:** 2026-07-15 · **Prepared from measured evidence only (no assertions)**
**Scope:** everything done on the project to date — code, audits, tests, live state.

---

# 1. WHAT THIS PROJECT IS

**ANTIGRAVITY PRO** is a **100% paper-trading** Indian index-options research platform
(NIFTY · SENSEX · BANKNIFTY). Node.js / Express, local-only, **no live execution — it never
places a real order**. It fuses market signals into BUY/SELL/HOLD verdicts, runs several paper
strategy engines, and backtests strategies against real NSE bhavcopy data.

---

# 2. THE NUMBERS (measured today)

| Metric | Value |
|---|---|
| **Git commits** | **201** (first 2026-05-06 → last 2026-07-12) |
| **Root code modules** | 82 `.js` files · `server.js` = 7,350 lines |
| **Test suites** | **49 files** · **49/49 passing** |
| **Audit documents** | **52 numbered** (001 → 050) + 41 others = **93 markdown docs** |
| **Backtest data** | 600 daily NSE bhavcopy files (2024-01 → 2026-06) |
| **Live paper engines** | 6 (strangle · bounce · gamma-blast · ai-agents · signal-paper · directional) |
| **Live open positions (now)** | 30 open · P&L ₹1,889 · exposure ₹3,22,676 |

---

# 3. THE THREE PHASES OF WORK

## Phase A — BUILD (May–June 2026)
The platform was built: market-data connectors, an 9-factor confluence signal engine, a learning
model, 6 paper engines, a backtesting harness, 20+ dashboards, and an enterprise-hardening layer
(JWT/RBAC auth, Docker, PM2, CI).

## Phase B — THE 50-DOCUMENT AUDIT (July 2026)
A systematic forensic audit, one governance document at a time (001 → 050), each in **READ-ONLY**
mode: **Audit · Measure · Verify · Document · Model** — no code changes permitted. Every finding
was proven by a measurement harness, not asserted. This is documented in `docs/001-*` … `docs/050-*`.

## Phase C — TARGETED FIXES (July 2026, ongoing)
A small number of verified, tested, owner-approved changes. Deliberately minimal.

---

# 4. THE CENTRAL FINDING (proven twice, from opposite directions)

> **The platform's headline edge claims were LOOK-AHEAD ARTEFACTS.**

`bt-lib.js` published UDiFF column 20 (`UndrlygPric` = the day's own CLOSING price) under the
innocent name `underlying`, and 9 strategy scripts chose their strikes from it — a price that had
not happened yet.

**Measured impact on the flagship SHORT_STRANGLE, on real 600-day data:**

| | with look-ahead (the claim) | reality |
|---|---|---|
| Win rate | 88–91% | **59%** |
| Net ₹/trade | ₹1,504 | **₹226** |
| Deflated Sharpe verdict | `PASS (edge real @95%)` | **`FAIL (likely overfit)`** |

**The deeper pattern (the "looking problem"):** across nine AI audits (041–050), every instrument
needed to discover this was *already built, already correct, and already writing the answer to
disk* — the validator, the hit-rate stats, the calibration data, the risk brake — and **none of
them was ever read**. The platform did not fail to build the truth; it built it, saved it, and
never looked.

**Notable sub-findings (all measured):**
- The validator's honesty parameter `nTrials` is passed `1` — the only value that makes a failing
  edge PASS. At the true trial count (dozens), the Deflated Sharpe reads 41% = FAIL.
- The AI model was silently re-specified on 2026-07-01 (8→9 factors) with no version and no reset;
  its factors are correct **33.8%** of the time over 130 real decisions.
- The displayed "probability" is a hand-tuned formula, not a calibrated probability. A calibrated
  75%-win structure that loses 2.9× what it wins nets ₹42/trade — the platform shows P(win), never
  expectancy.
- 37 backtest experiments (incl. a failure post-mortem and a 40-config optimizer) were deleted in
  a commit labelled "junk" — pure survivorship bias.
- The decision engine has **zero capital-risk inputs**; the circuit-breaker (15 losses vs a limit
  of 8) is read by none of the 4 engines that act on verdicts.

---

# 5. WHAT WAS ACTUALLY FIXED (production changes — very few, all verified)

| Fix | Status | Evidence |
|---|---|---|
| **Look-ahead in `bt-validate.js`** | ✅ committed (`7823864`) | Win% 91→51, DSR 0.9999→0.0008. +30-assertion characterization test, proven red first |
| **Risk brake failing OPEN on corrupt equity file** (C3-07) | ✅ committed (`f8609ec`) | Now HALTS fail-closed instead of trading on a fabricated clean slate |
| **Ledger safety — 7 writers, atomic writes** | ✅ committed (`0d1acec`) | `safe-write.js`, 28 modules depend on it, 7/7 backups verified |
| **Charges money-math test suite** | ✅ committed (`fefd38b`) | First tests for transaction costs (26 assertions) |
| **📒 Unified Positions Book** (today) | ✅ built + approved, not yet committed | `positions-book.js` (56 assertions) + `/api/positions` + dashboard panel |

**Discipline maintained throughout:** protected files (`server.js`, `execution-engine.js`) are
never touched without an evidence + rollback + test approval package. `npm test` stays green
(49/49). Nothing is committed without explicit request.

---

# 6. TODAY'S WORK (2026-07-15)

1. **Bot brought back online under PM2** (autorestart) — fixes INC-001, where the bot had died
   unattended because the runbook told the operator to run a bare `node server.js`.
   - NIFTY directional kept **OFF** by owner decision (it would boot at 15 losses vs a limit of 8).
   - Crash-recovery **verified**: killed the process, PM2 revived it with a new PID.
2. **Unified Positions Book** — one view of every open paper position across all 5 engines, which
   nothing aggregated before. Live now on the dashboard.
   - Honours **Unknown ≠ Zero**: 20+ bounce positions publish no price, so their P&L shows
     **UNKNOWN**, never a false ₹0. A naive aggregator would have shown a confident wrong total.
   - **Lot size from the Instrument Registry** (NIFTY 65 · SENSEX 20 · BANKNIFTY 30), the
     broker-verified source of truth — so real exposure is finally visible (was hidden as `qty:1`).
     An unverified instrument yields `lot: null`, never a guess.

---

# 7. LIVE STATE RIGHT NOW

```
  PM2  →  antigravity-bot · online · autorestart on
  http://localhost:3000/dashboard.html
  100% PAPER — no live orders, ever

  NIFTY directional  → OFF   (15/8 brake; owner-held off)
  SENSEX directional → ON
  strangle · gamma-blast · ai-agents · bounce · signal-paper → ON

  signal-paper is actively STANDING DOWN on the VRP gate ("premium thin net of cost,
  stand down") — this is discipline, not inactivity, and it is correct.
```

---

# 8. TOP PRIORITIES NEXT (ranked by measured leverage)

| # | Action | Why | Cost |
|---|---|---|---|
| **1** | **Save the irreplaceable intraday session** — `data/opt-candles/2026-07-08.json` (the only 99%-complete session) sits in a FIFO-40 dir; ~37 sessions from silent deletion | Deadline | one `cp` |
| **2** | **Open-book persistence** — strangle + bounce lose all positions on every restart, and PM2 now restarts on crash | Every crash erases evidence | copy the signal-paper pattern |
| **3** | **The Evidence Column** — render each factor's own hit-rate next to its score | Exposes the 33.8% problem on day one | ~20 lines, data already stored |
| **4** | **Pass the honest `nTrials`** | Makes the validator stop lying | one persistent counter |
| **5** | **Show expectancy, not just P(win)** | The decision-relevant number | one line; `pnl` already on disk |

---

# 9. HONEST LIMITATIONS OF THIS REPORT

- Figures are from the running system and git today; live P&L moves each tick.
- "Edge unproven" ≠ "edge absent" — the residual strangle edge is real out-of-sample but fails
  multiple-testing correction at the platform's true search count. It is not production-ready.
- Several findings await owner decision (the approval packages) and are **not applied**.
- One earlier audit number was self-retracted: the `charges.js` short-cost error is ₹0.32/trade,
  not the ₹157 first published (re-measured in doc 045).

---

**Bottom line:** The platform is a competently-engineered, genuinely honest **paper-trading research
tool** with **no black box** and real forward evidence — whose headline profitability claims did not
survive measurement, and whose correct instruments were never read. The audit programme has now read
them. The fixes are small, verified, and deliberately few.

*Full detail: `docs/001-*` through `docs/050-*` (52 numbered documents).*
