# 010 — PAPER TRADING ENGINE, FORWARD VALIDATION & EVIDENCE COLLECTION

**Standard:** Master Prompt 010 · **Depends on:** 000-A…E, 001-A…F, 002…009
**Date:** 2026-07-12 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No live trading authorized. Profitability NOT evaluated.**

---

# SECTION 0 — THE HEADLINE

> ## 🔴 **PAPER TRADING IS THIS PLATFORM'S ONLY UNCONTAMINATED EVIDENCE STREAM — AND IT SILENTLY DESTROYS EVIDENCE AT EVERY RESTART.**

**Measured — open-position restore on boot:**

```
strangle-engine.js      (the LIVE ₹7L engine)   restore-on-boot:  0     🔴
gamma-blast-engine.js                           restore-on-boot:  0     🔴
signal-paper-engine.js                          restore-on-boot:  0     🔴
agents-engine.js                                restore-on-boot:  2     🟢
```

**Three of four paper engines do not restore their open positions.**

## What that means, concretely

1. The strangle engine opens an iron condor at 09:15. It is in memory only.
2. The process restarts — a crash, a deploy, `Ctrl-C`, PM2.
3. The engine boots **with no position.**
4. **The trade is never exited, never priced, never scored, never written to `strangle-trades.json`.**

> **The trade did not lose. It did not win. It vanished — and the ledger shows no gap where it was.**
>
> **This is not a P&L bug. It is an EVIDENCE bug, and it is worse.** A missing trade is
> **indistinguishable from a trade that never happened**, so the surviving sample is not merely small —
> **it is silently selected.** Trades that survived a restart are over-represented. That is a
> **survivorship bias introduced by the infrastructure itself**, in the one dataset the platform relies
> on to eventually prove it has an edge.

**`data/strangle-trades.json` contains SEVEN records.** How many condors were orphaned by a restart?
⚪ **UNKNOWN — AND UNKNOWABLE. Nothing records that a position existed before the process died.**

---

# PART 1 — PAPER TRADING INVENTORY

| Component | Purpose | Owner | Persists open positions? | Confidence |
|---|---|---|---|---|
| **Signal generation** | 6 engines | per-engine | n/a | HIGH |
| **Order simulation** | 🔴 **DOES NOT EXIST** — no order object, no order id, no state machine | — | — | HIGH |
| **Fill simulation** | 🔴 **DOES NOT EXIST** — the LTP *is* the fill. No spread, no slippage, no rejection, no partial | — | — | HIGH |
| **Position tracking** | in-memory, per-engine | engine | 🔴 **3 of 4: NO** | HIGH |
| **P&L tracking** | per-engine | engine | 🟡 closed trades only | HIGH |
| **Logging** | 🔴 **6 incompatible ledgers** | — | — | HIGH |
| **Session management** | 🟡 `_resetIfNewDay()` (`execution-engine:129`) | engine | 🔴 in-memory | HIGH |
| **Daily summaries** | `eod-YYYY-MM-DD.json` × 19 | `server.js:4255` | 🔴 **raw write, no `.bak`** | HIGH |

## 🔴 P1-A — There is no order, and there is no fill

Paper trading here is not a **simulation**. It is a **bookkeeping entry.**

- **No order object.** A "paper order" is an assignment to a JavaScript field.
- **No fill model.** The last traded price *is* the fill price. **No bid-ask spread. No slippage. No rejection. No partial fill. No liquidity check.**
- **Consequence:** the paper engine's fill assumptions are **strictly more optimistic than the backtest's**, which at least sweeps 0–2% slippage (`bt-strangle-costs`).

> **The forward test is more optimistic than the backtest it is meant to validate.**

---

# PART 2 — SIGNAL TRACEABILITY

```
  Market Data ──▶ 🔴 `|| 0` × 119. Unknown becomes a number. (006)
       ↓
  Strategy Decision ──▶ 🔴 no strategyId. no inputs stored. (007 P1-B)
       ↓
  Risk Review ──▶ 🔴🔴 **THIS STAGE DOES NOT EXIST.** grep riskEngine|canTrade → nothing
       ↓
  Paper Order ──▶ 🔴 **DOES NOT EXIST.** No order object, no id.
       ↓
  Simulated Fill ──▶ 🔴 **DOES NOT EXIST.** LTP = fill.
       ↓
  Position ──▶ 🔴 **IN MEMORY ONLY** in 3 of 4 engines. Lost on restart. (§0)
       ↓
  Exit ──▶ 🟡 recorded when it happens
       ↓
  Outcome ──▶ 🔴 **6 incompatible ledgers**, two names for one structure
       ↓
  Evidence Store ──▶ 🔴 **DOES NOT EXIST.** There is no single store.
```

**Four of nine stages do not exist. One more (Position) is not durable.**

---

# PART 3 — EVIDENCE QUALITY ASSESSMENT

**010 requires 14 fields on every paper trade. Measured across all six ledgers:**

| Required field | signal-outcomes | ai-agents | strangle | gamma-blast | pop-book | signal-paper | **Ledgers recording it** |
|---|---|---|---|---|---|---|---|
| **`strategyId`** | — | — | — | — | — | — | 🔴 **0 / 6** |
| `signalTs` | ✅ | — | — | — | — | — | 🔴 **1 / 6** |
| `instrument` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟢 **6 / 6** |
| `expiry` | — | — | ✅ | — | — | — | 🔴 **1 / 6** |
| `strike` | — | ✅ | ✅* | ✅ | ✅ | ✅ | 🟡 **5 / 6** |
| `entryPrice` | — | ✅ | ✅ | ✅ | — | ✅ | 🟡 **4 / 6** |
| `exitPrice` | — | ✅ | — | ✅ | — | — | 🔴 **2 / 6** |
| `size` (qty/lots) | — | ✅ | — | ✅ | — | ✅ | 🔴 **3 / 6** |
| **`stopLoss`** | — | — | — | — | — | — | 🔴 **0 / 6** |
| **`target`** | — | — | — | — | — | — | 🔴 **0 / 6** |
| `exitReason` | — | ✅ | ✅ | ✅ | ✅ | — | 🟡 **4 / 6** |
| `pnl` | ✅ | ✅ | ✅ | ✅ | ✅ | — | 🟡 **5 / 6** |
| **`sessionId`** | — | — | — | — | — | — | 🔴 **0 / 6** |
| **`configVersion`** | — | — | — | — | — | — | 🔴 **0 / 6** |

\* per-leg (`ce.strike`, `pe.strike`, `ceWing.strike`)

## 🔴 **FIVE of the fourteen required fields are recorded by ZERO ledgers:**

```
strategyId  ·  stopLoss  ·  target  ·  sessionId  ·  configVersion
```

## The canonical record — what a paper trade actually is

```json
data/signal-outcomes.json
{ "t": 1783401873150, "inst": "NIFTY", "structure": "IRON_CONDOR",
  "rawP": 0.7611, "prob": 76, "won": true, "pnl": 1540.5 }
```

> **No strike. No expiry. No entry price. No exit price. No size. No stop. No target. No reason.
> No strategy. No session. No config.**
>
> **A trade cannot be reconstructed from its own record.** 010's stop condition applies:
> ***"Stop and report UNKNOWN if trade provenance cannot be established."* → UNKNOWN.**

## 🟢 The best ledger — and it is genuinely good

```json
data/strangle-trades.json
{ "inst":"NIFTY", "expiry":"2026-07-07", "entryAt":"09:15:06", "exitAt":"11:07:47",
  "structure":"CONDOR",
  "ce":     {"strike":24800,"entry":0.95,"ltp":0.65},
  "pe":     {"strike":24100,"entry":2.05,"ltp":1.7},
  "ceWing": {"strike":25000,"entry":0.75,"ltp":0.55}, ... }
```

**Per-leg strikes, entries, exits, timestamps, structure.** This is what a paper trade record should
look like. **It still lacks `strategyId`, `sessionId`, `configVersion`, `size`, `stopLoss` and
`target`** — and **it holds seven records.**

## 🔴 P3-A — Two names for one structure

`strangle-trades.json` says **`"CONDOR"`**. `signal-outcomes.json` says **`"IRON_CONDOR"`**.
**Same structure. Two vocabularies. No canonical enum.** Any join across ledgers requires a hand-written
mapping that does not exist.

---

# PART 4 — FORWARD VALIDATION

| Requirement | Verdict |
|---|---|
| **Forward-only execution** | 🟢 **YES.** The live engines see only the current chain. **No future-bar access found.** This is the platform's one genuine temporal strength |
| **No future data access** | 🟢 **CONFIRMED** — and it is precisely **why paper trading is the only uncontaminated evidence** the platform has (all 8 backtests read the future; 7 still do) |
| **Session isolation** | 🟡 `_resetIfNewDay()` (`execution-engine:129`) resets `_enteredToday` and the date |
| **🔴 Restart integrity** | 🔴 **BROKEN.** Open positions lost in 3 of 4 engines (§0). `_enteredToday` and the re-entry cooldown are **in-memory only** ⇒ **a restart re-arms today's entry** (007 P6-A). **The halt is not persisted at all** (005 S-01) |
| **Order reproducibility** | 🔴 **NO.** No order object exists |
| **Outcome consistency** | 🔴 **NO.** 6 ledgers, 2 structure names, 5 missing fields |

## 🟢 The one thing this platform gets right, temporally

> **The paper engines cannot see the future. They are structurally incapable of it — they poll a live
> chain that has not happened yet.**
>
> **That makes 12 honest paper outcomes worth more than 129 contaminated backtest trades.**
> **And it makes losing them at a restart the most expensive bug in the repository.**

---

# PART 5 — LABEL QUALITY

| | |
|---|---|
| **Complete outcomes** | 🔴 **NO** — 5 of 14 fields absent everywhere |
| **Missing labels** | 🔴 `signal-paper-positions.json`: **2 entries, 0 labelled** |
| **Invalid labels** | 🟢 None found |
| **Duplicate labels** | ⚪ **UNKNOWN — no dedupe key exists.** Without a `strategyId` + `signalTs` key, duplicates cannot even be detected |
| **Delayed outcomes** | 🟡 Multi-day condors: an outcome lands only when the position closes — **and if a restart intervenes, it never does (§0)** |
| **Unknown outcomes** | 🔴 **THE ORPHANED TRADES.** ⚪ Count: **UNKNOWABLE** |

---

# PART 6 — SAMPLE SUFFICIENCY

**Measured against the project's own M2 threshold (~200 labelled outcomes). No new thresholds invented.**

| Ledger | Entries | Labelled |
|---|---|---|
| `ai-agents-trades.json` | 23 | 23 |
| **`signal-outcomes.json`** *(canonical)* | **12** | **12** |
| `strangle-trades.json` *(the LIVE ₹7L engine)* | **7** | 7 |
| `pop-book.json` | 2 | 1 |
| `signal-paper-positions.json` | 2 | **0** |
| `gamma-blast-trades.json` | 1 | 1 |
| **TOTAL** | **47** | **44** |

| Dimension | Measured |
|---|---|
| **Completed trades (canonical)** | **12** — vs **M2 ≈ 200** ⇒ **6%** |
| **Sessions covered** | **4 calendar days** (2026-07-07 → 2026-07-10) |
| **Market conditions** | ⚪ **UNKNOWN — never classified.** No regime label on any outcome |
| **Instrument diversity** | **1** (NIFTY) in the canonical ledger |
| **Regime diversity** | 🔴 **Four consecutive days cannot contain a regime change** |

> **12 outcomes over four days is not a sample. It is a long weekend.**
>
> And for a **negative-skew** structure — an iron condor, whose entire risk lives in a tail that
> appears a few times a decade — **four days contains structurally zero information about the risk that
> matters.** *(009 Part 4: measured skew of the honest backtest returns = **−0.765**.)*

---

# PART 7 — OPERATIONAL SAFETY

| Aspect | Verdict |
|---|---|
| **Restart behaviour** | 🔴 **BROKEN** — §0. **Open positions vanish. `_enteredToday` re-arms. The halt evaporates (005 S-01)** |
| **Recovery** | 🔴 **NONE for open positions.** 🟢 `safe-write` protects the closed-trade ledgers |
| **Daily reset** | 🟡 `_resetIfNewDay()` exists — **but it runs off `new Date()` inside domain logic**, and `NODE_ENV`/TZ is never declared (004, 006 T-2) |
| **Session boundaries** | 🟡 entry windows exist per engine |
| **Logging integrity** | 🟡 `safe-write` for most ledgers · 🔴 `eod-*.json` written **raw** |
| **Failure handling** | 🔴 **92 empty catches** repo-wide; **5 in `strangle-engine.js`** |

## 🔴 P7-A — The three failure modes compose into one

| | |
|---|---|
| **005 S-01** | The halt is not persisted ⇒ **no halt survives a restart** |
| **007 P6-A** | `_enteredToday` is not persisted ⇒ **a restart re-arms today's entry** |
| **010 §0** | The open position is not persisted ⇒ **the trade is orphaned** |

> **All three are the same defect:** *the engine persists what it **has** (capital, closed trades) and
> never what it **decided** (halted, entered, holding).*
>
> **A restart is not a resume. It is a rebirth with amnesia — and it keeps the money while forgetting
> the reasons.**

---

# PART 8 — OBSERVABILITY

| Required per decision | Recorded? |
|---|---|
| **Inputs** | 🔴 **NO.** Features are computed and **discarded.** ⇒ no post-hoc re-labelling, no calibration, **no ML — ever** |
| Decision | 🟡 structure / side only |
| Confidence | 🟢 `rawP`, `prob` — **but never validated** (009 Part 7) |
| **Parameters** | 🔴 **NO.** 65 tunables, **0 recorded per trade** |
| **Risk assessment** | 🔴 **NO — the stage does not exist** |
| Final outcome | 🟡 `won`, `pnl` — **when the trade survives to be closed** |

> **010's rule: *"Evidence without provenance is unusable."***
> **By that rule, the platform has 47 records and 0 usable pieces of evidence for calibration, because
> not one of them can be tied to a strategy, a config, a session, or the inputs that produced it.**

---

# PART 9 — PAPER TRADING ARCHITECTURE (conceptual — no code)

```
   PaperOrderManager  ★     an ORDER is an OBJECT with an ID and a STATE MACHINE
       NEW → SUBMITTED → FILLED | PARTIAL | REJECTED → CLOSED
       🔴 today an "order" is a field assignment. There is nothing to trace.

   FillModel  ★             spread · slippage · liquidity · rejection
       🔴 today: LTP = fill. The forward test is MORE optimistic than the backtest.

   PositionStore  ★         🔴 OPEN POSITIONS ARE PERSISTED, ATOMICALLY, ON EVERY MUTATION.
       A restart RESTORES them, or REFUSES TO START.
       An open position that cannot be restored is an INCIDENT, not a silence.   → kills §0

   EvidenceStore  ★         ONE ledger. ONE schema. ONE structure vocabulary.
       Every row: strategyId · sessionId · configVersion(gitSha) · signalTs ·
                  inputsHash · instrument · expiry · legs[] · size · SL · target ·
                  exitReason · pnl · regime
       🔴 A trade WITHOUT a complete row is a BUG, not a record.

   SessionManager  ★        sessionId = bootId. Every trade names the session that made it.
                            A restart is VISIBLE in the evidence, not invisible.
```

## The single rule that would fix §0, 005 S-01 and 007 P6-A together

> **If a decision can change what the engine does next, it MUST be persisted — and its absence after a
> restart MUST be treated as an incident, never as a clean slate.**

---

# PART 10 — TESTING STRATEGY

| Test | Priority |
|---|---|
| 🔴 **An open position survives a restart, or the engine refuses to start** | **P0 — §0. The most valuable test in this document** |
| 🔴 **Every paper trade carries all 14 required fields, or the write is REJECTED** | **P0 — 5 fields are missing everywhere** |
| 🔴 **A halt survives a restart** | **P0 — 005 S-01** |
| 🔴 **`_enteredToday` / cooldown survive a restart** | **P0 — 007 P6-A** |
| **Duplicate prevention: the same signal cannot be booked twice** | P1 — no dedupe key exists |
| **One structure vocabulary across all ledgers** | P1 — `CONDOR` vs `IRON_CONDOR` |
| Daily summary is written after all timers are cleared | P1 — the shutdown race (001-B A-04) |
| Fill simulation applies spread + slippage | P2 |

---

# PART 11 — MATURITY ASSESSMENT

| Level | Met? | Evidence |
|---|---|---|
| **0 — Prototype** | 🟢 | It runs |
| **1 — Operational** | 🔴 **NO** | **Open positions are lost on restart (§0).** The halt evaporates. `_enteredToday` re-arms |
| **2 — Evidence Collection** | 🔴 **NO** | 5 of 14 required fields recorded **nowhere**; 6 incompatible ledgers |
| **3 — Statistically Useful** | 🔴 **NO** | **12 outcomes, 4 days, 1 instrument, 0 regimes** |
| **4 — Research Qualified** | 🔴 **NO** | No inputs stored ⇒ **no calibration is possible, ever** |
| **5 — Production Candidate** | 🔴 **NO** | — |

## ## **Paper Trading Engine: LEVEL 0 — PROTOTYPE.**

**It cannot be Level 1 (Operational) while a restart silently destroys an open trade.**

---

# PART 12 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE — this document** | — | none | Every component and every ledger catalogued |
| **2 — Evidence completeness** | 🔴 **ONE `EvidenceStore`, ONE schema, 14 required fields.** Reject an incomplete write. One structure vocabulary | Phase 1 | **Low — additive.** Old ledgers stay | **Every new trade carries all 14 fields** |
| **3 — Operational robustness** | 🔴 **PERSIST OPEN POSITIONS** (§0) · **persist the halt** (005 S-01) · **persist `_enteredToday`** (007 P6-A). **A restart that cannot restore an open position is an INCIDENT** | Phase 2 | **Medium — touches 4 engines. `strangle-engine` is not protected; `execution-engine` IS** | **A restart loses nothing. Zero orphaned trades** |
| **4 — Forward-validation maturity** | Add a fill model (spread, slippage). Add `sessionId`, `inputsHash`, `regime` | Phase 3 | Low | **The forward test is no longer more optimistic than the backtest** |
| **5 — Research qualification** | Grow **12 → 200** (M2). **Start the VRP monitor — it is EMPTY** | Phase 4 | **Time. Cannot be shortcut** | ≥ 200 complete, labelled, traceable outcomes in ONE schema |

---

# PART 13 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every paper trade fully traceable | 🔴 **NO** — no `strategyId`, no `sessionId`, no `configVersion`, no inputs |
| Outcomes completely labelled | 🔴 **NO** — 5 of 14 fields absent everywhere; orphaned trades are unlabelled and uncounted |
| **Forward validation temporally correct** | 🟢 **YES — the one criterion that passes.** The engines cannot see the future |
| Evidence reproducible | 🔴 **NO** |
| Operational failures observable | 🔴 **NO** — **an orphaned trade leaves no trace at all** |
| Evidence supports downstream validation | 🔴 **NO** — 12 outcomes, 4 days |

## **1 of 6.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent researcher audit every paper trade from market data to outcome,
verify no future information influenced it, and judge whether the evidence advances the programme?**

**Two of three: no. One: yes — and it is the most important one.**

🟢 **The paper engines are temporally correct.** They poll a chain that has not happened yet. They are
**structurally incapable** of the look-ahead that invalidated all eight backtests. **This makes paper
trading the only trustworthy evidence stream this platform has ever had.**

🔴 **And it is being thrown away.**

> **Three of four paper engines — including the ₹7L iron-condor engine — do not restore their open
> positions on restart. An open trade is simply lost: never exited, never priced, never scored, never
> written down. The ledger shows no gap where it was.**
>
> **A trade orphaned by a restart is indistinguishable from a trade that never happened. The surviving
> sample is therefore not merely small — it is silently selected. The infrastructure has introduced a
> survivorship bias into the one dataset that was supposed to be clean.**

🔴 **And what does survive cannot be used.** Five of the fourteen required evidence fields —
**`strategyId`, `stopLoss`, `target`, `sessionId`, `configVersion`** — are recorded by **zero** of the
six ledgers. The canonical record is seven fields long and contains **no strike, no entry, no exit, no
size, no reason**. **A trade cannot be reconstructed from its own record.** The inputs that produced it
were computed and discarded. **No calibration is possible. Not now, and not with 200 outcomes either,
unless this changes.**

**The sample: 12 outcomes. Four calendar days. One instrument. Zero regime changes. Against M2's ~200
— that is 6%.**

**The cheapest, highest-value fix in the entire audit programme:**

> **Persist the open positions. `safe-write.js` already exists and already does this correctly for the
> closed-trade ledgers. Three engines need to call it. `strangle-engine.js` is not a protected file.**
>
> **Every day this is not done, the platform runs its only honest experiment — and loses the results.**

---

**Live trading: NOT AUTHORIZED. Profitability: NOT EVALUATED. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Paper Trading Inventory (Part 1) · Signal Traceability (Part 2) · Evidence Quality
(Part 3) · Forward Validation (Part 4) · Label Quality (Part 5) · Sample Sufficiency (Part 6) ·
Operational Safety (Part 7) · Observability (Part 8) · Architecture Blueprint (Part 9) · Testing
Strategy (Part 10) · Maturity Assessment (Part 11) · Migration Roadmap (Part 12) · Executive Summary.
