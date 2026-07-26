# 014 — CAPITAL ENGINE, MONEY MANAGEMENT & CAPITAL GOVERNANCE

**Standard:** Master Prompt 014 · **Depends on:** 000-A…E, 001-A…F, 002…013
**Date:** 2026-07-12 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No strategy optimized. No sizing rule recommended.**

---

# SECTION 0 — THE TWO FINDINGS

## 🔴 §0.1 — **THE PLATFORM ALLOCATES ₹9,80,000 FROM A ₹1,00,000 ACCOUNT**

**Measured. Every engine's own belief about how much money it controls:**

```
  execution-engine SENSEX     ₹ 1,00,000     ← the WHOLE of CAPITAL_TOTAL
  execution-engine NIFTY      ₹ 1,00,000     ← the WHOLE of CAPITAL_TOTAL, again
  afternoon SENSEX            ₹   40,000     ← CAPITAL_TOTAL × AFTERNOON_CAPITAL_PCT (40%)
  afternoon NIFTY             ₹   40,000     ← the same 40%, again
  strangle-engine             ₹ 7,00,000     ← STRANGLE_CAPITAL
  ──────────────────────────────────────
  TOTAL CLAIMED               ₹ 9,80,000
  ACTUAL ACCOUNT              ₹ 1,00,000     (CAPITAL_TOTAL)
  ──────────────────────────────────────
  OVER-ALLOCATED                    9.8×
```

**Five engines. One account. Nobody adds them up.**

`execution-engine.js:54` — `this.capital = parseFloat(process.env.CAPITAL_TOTAL || 100000)` — is
constructed **once per instrument**, and **each instance takes the entire balance.**
`afternoon-engine.js:80` takes a **fraction of the same balance**, in parallel.
`strangle-engine.js:82` takes a **separate ₹7L** that has no relationship to the account at all.

> **There is no allocation. There are five engines each helping themselves to the same money, and no
> component in this system is capable of noticing.** *(011 P1-A: `grep availableCapital` → **0 modules**.)*

---

## 🔴 §0.2 — **THE PLATFORM CONTAINS THE CORRECT ANSWER, IMPORTED IT, AND TURNED IT OFF**

**`position-sizer.js` — verbatim, from its own header:**

```js
position-sizer.js:6-9
 *   1. MARGIN. A naked NIFTY short strangle needs ~₹1.3L/lot of SPAN+exposure
 *      margin — so a ₹1L account LITERALLY CANNOT HOLD EVEN ONE LOT. A defined-
 *      risk condor's margin is its max loss ... "5% of capital as premium"
 *      sizing was FANTASY; real sizing is margin-bound.
```

**And it is imported. And it is disabled.**

```js
strangle-engine.js:81   this._sizer   = require('./position-sizer.js');          // ← loaded
strangle-engine.js:83   this.useSizer = String(cfg.useSizer
                          ?? process.env.STRANGLE_USE_SIZER ?? 'false')          // ← DEFAULT: FALSE
                          .toLowerCase() === 'true';
```

**`STRANGLE_USE_SIZER` appears in neither `.env` nor `data/config-overrides.json`.**
⇒ **It takes the code default. ⇒ `useSizer = false`. ⇒ The margin-aware sizer is loaded and never used.**

### What that means, arithmetically

The backtests and the engines size with `min(25, floor(cap × 5% / (premium × lot)))` — **premium-based**.
On a ₹1L account with a ₹2 premium and lot 65, that yields the **25-lot cap.**

```
  25 lots of a short NIFTY strangle  ×  ~₹1.3L/lot SPAN + exposure margin
  =  ₹32,50,000 of margin required
  on a ₹1,00,000 account.
```

> **Every backtest in this repository opens positions that could never have been funded.**
> **The platform's own `position-sizer.js` says so, in the word "fantasy", and the engine that requires
> it has it switched off by default.**

**Note:** the live engine runs `STRANGLE_FORCE_CONDOR = true` *(007 §0)*, and a **defined-risk condor's
margin is its max loss** — far lower than a naked strangle's SPAN. **So the live structure is
substantially less margin-hungry than the backtested one.** But that is **another** consequence of the
structure mismatch, **not a defence of the sizing** — because **the backtest that produced the
published numbers modelled the naked strangle, at 25 lots, on ₹1L.**

⚪ **The exact margin for the live condor is UNKNOWN — SPAN is an exchange risk parameter published daily
and it is NOT CAPTURED anywhere.** *(014's stop condition: margin accounting cannot be verified → UNKNOWN.)*

---

# PART 1 — CAPITAL INVENTORY

| Component | Owner | Persisted | Confidence |
|---|---|---|---|
| **Initial capital** | 🔴 **CONTESTED** — `.env` **and** `config-overrides.json` **and** the engine constructor | 🟡 | HIGH |
| **Current equity** | 🔴 **3 modules, 6 write sites** | 🟢 `equity-<inst>.json` | HIGH |
| **Reserve** (half-compound) | `execution-engine:149` | 🟢 persisted | HIGH |
| **Available capital** | 🔴 **DOES NOT EXIST** — `grep availableCapital` → **0 modules** | — | HIGH |
| **Reserved / used / free margin** | 🔴 **DO NOT EXIST** — `usedMargin`, `freeMargin`, `availableMargin`, `spanMargin`, `marginRequired`, `blockedMargin`, `exposureMargin` → **0 modules each** | — | HIGH |
| **Daily P&L** | `server.js` per-instrument | 🟡 `eod-*.json` (**raw write**) | MEDIUM |
| **Cumulative P&L** | 🔴 **NOT COMPUTED across engines** | — | HIGH |
| **Account balance** | 🔴 **DOES NOT EXIST.** There is no account | — | HIGH |
| **Strategy allocation** | 🔴 **§0.1 — 9.8× over-allocated** | config | HIGH |
| **Risk allocation** | 🟡 `riskPct = 5%` per engine, of **its own** capital | 🔴 | HIGH |
| **Daily NAV series** | 🔴 **DOES NOT EXIST.** `pop-seller.js:503` says so in its own words | — | HIGH |

---

# PART 2 — CAPITAL LIFECYCLE

```
 Configuration  ──▶ CAPITAL_TOTAL lives in a SETTINGS file        🔴 (004 C-02)
      ↓
 Initialization ──▶ execution-engine:54   capital = env.CAPITAL_TOTAL || 100000
      ↓             afternoon-engine:80   capital = totalCapital × 40%
      ↓             strangle-engine:82    capital = STRANGLE_CAPITAL (₹7L, unrelated)
      ↓             🔴 FIVE ENGINES, ONE ACCOUNT, NO ALLOCATOR.
      ↓
 setConfig()    ──▶ execution-engine:113  capital = config-overrides.CAPITAL_TOTAL
      ↓             🔴 A SETTINGS FILE WRITES A BALANCE.
      ↓
 restoreEquity()──▶ execution-engine:381  capital = the persisted balance
      ↓             🟢 ORDER FIXED 2026-07-10 — before that, step above OVERWROTE this.
      ↓
 Trade impact   ──▶ capital += pnl   (losses in full from active; reserve is protected)
      ↓
 P&L update     ──▶ half-compound: on a WIN, half the profit moves to `reserve`
      ↓             🟢 A GENUINELY GOOD DESIGN — and correctly documented at :146-147
      ↓
 Risk adjust    ──▶ drawdown circuit on (capital + reserve) vs peak      🟢 correct
      ↓
 Persistence    ──▶ safe-write → { capital, reserve, consecLosses, updatedAt }
      ↓             🔴 _haltedReason NOT IN THE SCHEMA (005 S-01)
      ↓
 Restart        ──▶ 🟢 capital + reserve + consecLosses restored
      ↓             🔴 the HALT is not. The OPEN POSITION is not. (010 §0)
      ↓
 Session close  ──▶ eod-YYYY-MM-DD.json (raw write, no .bak)
      ↓
 Archive        ──▶ 19 files, no retention policy
```

---

# PART 3 — CAPITAL OWNERSHIP MATRIX

**Every capital write in the platform. Definitive:**

```
execution-engine.js:54    this.capital = env.CAPITAL_TOTAL || 100000          ← constructor
execution-engine.js:113   this.capital = config-overrides.CAPITAL_TOTAL       ← 🔴 A CONFIG FILE
execution-engine.js:381   this.capital = s.capital                            ← restore
afternoon-engine.js:80    this.capital = totalCapital × afternoonPct          ← constructor
afternoon-engine.js:782   this.capital = s.capital                            ← restore
strangle-engine.js:82     this.capital = STRANGLE_CAPITAL ?? 100000           ← constructor
```

| Question | Answer | Verdict |
|---|---|---|
| **Who initializes capital?** | **3 modules, independently** | 🔴 **MULTIPLE** |
| **Who modifies capital?** | The owning engine — **and `setConfig()`, from a settings file** | 🔴 **CONFLICTING** |
| **Who calculates equity?** | Each engine, for itself: `capital + reserve` | 🔴 **NO ACCOUNT-LEVEL EQUITY** |
| **Who reserves margin?** | 🔴 **NOBODY. Margin does not exist** | 🔴 **MISSING** |
| **Who releases margin?** | 🔴 **NOBODY** | 🔴 **MISSING** |
| **Who persists capital?** | `saveEquity()` per engine 🟢 | 🟡 |
| **Who restores capital?** | `restoreEquity()` per engine 🟢 | 🟡 |
| **Who owns the ACCOUNT?** | 🔴 **NOBODY. There is no account** | 🔴 **MISSING** |

### Hidden ownership
**Until 2026-07-10, capital was owned by *load order*** — `_loadConfigOverrides()` ran after
`restoreEquity()`, so a config value silently overwrote the real balance at **every boot**.
**The fix reversed the order. The shape that allowed it is unchanged.**

---

# PART 4 — CAPITAL ACCOUNTING

## 🟢 The half-compound mechanism — genuinely well designed

```js
execution-engine.js:146-158
  // On a WIN, half the profit is moved to a protected "reserve" pile.
  // Losses come out of ACTIVE capital in full (reserve is safe).
  if (pnl > 0) { const toReserve = pnl * 0.5; this.capital += pnl - toReserve;
                 this.reserve += toReserve; }
  else         { this.capital += pnl; }              // full loss from active only

execution-engine.js:163
  const totalEquity = this.capital + (this.reserve || 0);   // drawdown tracks TOTAL
```

**Position size scales off `capital` (active), so a winning streak compounds at half rate and a losing
streak de-risks at full rate.** **This is a sound, deliberate money-management design, and it is
correctly documented.**

## The live numbers — and they reconcile

```
  SENSEX   capital ₹88,011   reserve ₹0   total ₹88,011   drawdown −11.99%   (limit 20%)
  NIFTY    capital ₹96,761   reserve ₹0   total ₹96,761   drawdown  −3.24%   (limit 20%)
  baseline ₹1,00,000 each
```

🟢 **`reserve = 0` on both is CORRECT, not a bug:** both engines are net losers, so no profit was ever
half-compounded into the reserve. **The arithmetic is internally consistent.**
🟢 **Neither breaches the 20% drawdown limit.** *(This is one risk control that is genuinely holding.)*

## What is NOT computed

| Quantity | Formula | Status |
|---|---|---|
| **Equity (account)** | — | 🔴 **NOT COMPUTED.** Three separate equities, never summed |
| **Balance** | — | 🔴 **DOES NOT EXIST** |
| **Available capital** | — | 🔴 **0 modules** |
| **Used margin** | — | 🔴 **0 modules** |
| **Free margin** | — | 🔴 **0 modules** |
| Realized P&L | per-engine | 🟡 |
| Unrealized P&L | per-engine, in memory | 🔴 **lost on restart** |
| Daily P&L | per-instrument | 🟡 |
| **Cumulative P&L (account)** | — | 🔴 **NOT COMPUTED** |

> **014's stop condition applies: *"Stop and report UNKNOWN if margin accounting cannot be verified."***
> ## **→ MARGIN ACCOUNTING: UNKNOWN. It does not exist.**

---

# PART 5 — CAPITAL ALLOCATION

| Allocation | Status | Evidence |
|---|---|---|
| **Strategy allocation** | 🔴 **NOT IMPLEMENTED** | **§0.1 — 9.8× over-allocated. Five engines, one account, no allocator** |
| **Instrument allocation** | 🔴 **NOT IMPLEMENTED** | Each instrument's engine takes the **whole** `CAPITAL_TOTAL` |
| **Portfolio allocation** | 🔴 **NOT IMPLEMENTED** | No portfolio exists (011) |
| **Session allocation** | 🟡 **PARTIALLY** | `AFTERNOON_CAPITAL_PCT = 40%` — **of a balance already fully claimed by the morning engine** |
| **Risk allocation** | 🟡 **PARTIALLY** | `riskPct = 5%` per engine, **of its own imaginary capital** |
| **Margin allocation** | 🔴 **NOT IMPLEMENTED** | 0 modules |

---

# PART 6 — CAPITAL PRESERVATION

| Control | Implemented | Owner | Interacts with Risk Engine? |
|---|---|---|---|
| **Daily loss limit** | 🟡 **2 of 8 engines** | engine | 🔴 **There is no Risk Engine** (013) |
| **Equity protection (half-compound reserve)** | 🟢 **YES — and it is good** | `execution-engine` | 🟢 feeds the drawdown circuit |
| **Drawdown protection** | 🟡 **2 of 8 engines**, 20% on total equity | engine | 🔴 |
| **Capital floor** | 🔴 **NOT IMPLEMENTED** | — | — |
| **Trading suspension** | 🔴 **FAILS OPEN** — the halt is not persisted (005 S-01) | — | — |
| **Recovery rules** | 🟡 `resetHalt()` (manual) · `_resetIfNewDay()` (daily-loss only) | engine | — |

> **The reserve mechanism protects capital *within* a session, correctly.**
> **Nothing protects the account *across* engines, and nothing protects the halt across a restart.**

---

# PART 7 — CAPITAL STATE

**The complete persisted schema:**

```json
data/equity-nifty.json
{ "capital": 96761, "reserve": 0, "consecLosses": 15, "updatedAt": "2026-07-09T09:59:47.580Z" }
```

| Aspect | Verdict |
|---|---|
| **Persistence** | 🟢 **`safe-write` — atomic, `.bak`, validate-by-reparse, fail-closed.** Genuinely excellent |
| **Recovery** | 🟢 capital, reserve, consecLosses restored · 🟡 stale-file guard (30 days) · 🟢 **corrupt ⇒ HALT** |
| **Reset policy** | 🟢 explicit and documented |
| **Audit trail** | 🔴 **NONE.** No record of *who* changed the capital, *when*, *why*, or *from what* |
| **Allocation map** | 🔴 **DOES NOT EXIST** |
| **Margin state** | 🔴 **DOES NOT EXIST** |

---

# PART 8 — FAILURE MODE REGISTER

| ID | Failure | Consequence |
|---|---|---|
| **CP-1** | **Five engines claim 9.8× the account** | 🔴 **CRITICAL.** In live mode, the first three orders would be **margin-rejected** — and *nothing in the platform models a rejection* (012) |
| **CP-2** | **Sizing ignores margin entirely** | 🔴 **CRITICAL.** **Every backtest position could never have been funded.** `position-sizer.js` says so, in the word "fantasy" — **and it is disabled by default** |
| **CP-3** | **A config file writes the account balance** | 🔴 **HIGH.** It overwrote the real balance at every boot until 2026-07-10 |
| **CP-4** | **Corrupted capital state** | 🟢 **HALTS (fail-closed, C3-07)** — 🔴 **until the next restart, when the halt is lost (005 S-01)** |
| **CP-5** | **Lost updates** | 🟢 Not found — `safe-write` is atomic |
| **CP-6** | **Restart during trading** | 🔴 **The open position vanishes (010 §0). Its unrealized P&L was never in the capital** |
| **CP-7** | **Inconsistent accounting** | 🔴 **`/api/risk` reports capital from `process.env`, not the engine** (011 §0) |
| **CP-8** | **Missing persistence** | 🟢 capital ✅ · 🔴 **halt ✗** · 🔴 **positions ✗** |
| **CP-9** | **Configuration conflict** | 🔴 **`CAPITAL_TOTAL` has TWO different hardcoded defaults — ₹1,00,000 (engines) and ₹5,00,000 (`/api/risk`)** (004 C-07) |

---

# PART 9 — OBSERVABILITY

| Required per capital mutation | Recorded? |
|---|---|
| Timestamp | 🟡 `updatedAt` — **the latest one only** |
| **Previous value** | 🟡 **only in a `console.log`** (`execution-engine:158`) |
| New value | 🟢 |
| **Trigger** | 🔴 **NO** |
| **Strategy** | 🔴 **NO** |
| **Trade reference** | 🔴 **NO** |
| **Reason** | 🔴 **NO** |

> **014's rule: *"Capital changes without provenance are unacceptable."***
>
> **Capital is a single number on disk that is overwritten in place. There is one `.bak` — exactly one
> prior value. The question *"why is the SENSEX balance ₹88,011 and not ₹1,00,000?"* can be answered
> only by re-deriving it from a trade ledger that does not carry the capital impact of each trade.**
>
> **The account's history is not merely unaudited. It is unrecoverable.**

---

# PART 10 & 11 — CAPITAL ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   AccountLedger  ★   THE SINGLE AUTHORITATIVE OWNER OF MONEY.

     balance()            ONE number. The account.
     applyFill(fill)      🔴 THE ONLY WAY MONEY MOVES. There is no setter.
     markToMarket(marks)  unrealized P&L
     navSeries()          🔴 the daily series that unlocks Sharpe, drawdown, EVERYTHING

     🔴 FORBIDDEN DEPENDENCY: Configuration.
        A SETTINGS FILE MUST NOT BE ABLE TO WRITE A BALANCE.              → kills CP-3

   AllocationManager  ★
     allocate(strategyId, amount) → { ok } | { rejected, reason }
     🔴 INVARIANT: Σ allocations ≤ balance. ALWAYS.                       → kills §0.1 / CP-1
     🔴 An over-allocation is a REFUSAL AT BOOT, not a silent 9.8×.

   MarginManager  ★
     required(position) → ₹    (SPAN + exposure, or maxLoss for a defined-risk structure)
     🔴 A POSITION THAT CANNOT BE FUNDED IS NEVER OPENED.                 → kills §0.2 / CP-2
     🟢 position-sizer.js ALREADY IMPLEMENTS THIS. It is imported and disabled.
     ⚪ SPAN is an exchange risk parameter, published daily, NOT CAPTURED. Capture it or
        declare the gap. NEVER fabricate it.

   CapitalAuditLog  ★
     every mutation: ts · prev · next · trigger · strategyId · tradeRef · reason
     🔴 today: a console.log and one .bak.                                → kills PART 9
```

## Contract boundaries

| From | To | Rule |
|---|---|---|
| **Configuration → Capital** | 🔴 **FORBIDDEN.** Config may declare an *initial* balance **once**, and never again |
| **Capital → Risk** | one balance, one equity, one NAV | 🔴 *Today: three balances, no NAV* |
| **Capital → Execution** | `canFund(position)` → bool | 🔴 *Today: nothing asks* |
| **Portfolio → Capital** | a `Fill` is the only thing that moves money | 🔴 *Today: engines assign `this.capital` directly* |
| **Capital → Research** | the NAV series | 🔴 *Today: absent ⇒ no Sharpe, no drawdown, ever* |

---

# PART 12 — TESTING STRATEGY

| Test | Priority | Would it fail today? |
|---|---|---|
| 🔴 **Σ(engine allocations) ≤ account balance** | **P0** | ✅ **FAILS — 9.8×** |
| 🔴 **A position that cannot be margin-funded is never opened** | **P0** | ✅ **FAILS — margin does not exist** |
| 🔴 **Configuration cannot write the account balance** | **P0** | ✅ **FAILS — `execution-engine:113`** |
| 🔴 **`/api/risk` reports the ENGINE's capital** | **P0** | ✅ **FAILS — shows env's ₹1,00,000** |
| **Half-compound: a win moves 50% to reserve; a loss takes 100% from active** | **P0** | 🟢 would pass — **assert it so it never regresses** |
| **Drawdown circuit fires on (capital + reserve) vs peak** | **P0** | 🟢 would pass — **assert it** |
| **Corrupt equity ⇒ HALT** | ✅ exists (C3-07) | — |
| **capital + reserve + consecLosses survive a restart** | ✅ exists | — |
| **The HALT survives a restart** | **P0** | ✅ **FAILS — S-01** |

---

# PART 13 — CAPITAL MATURITY ASSESSMENT

| Level | Met? | Evidence |
|---|---|---|
| **0 — Prototype** | 🟢 | Capital exists and persists |
| **1 — Capital Tracking** | 🟡 **PARTIAL** | 🟢 Per-engine tracking is atomic, recoverable and fail-closed. 🔴 **No account-level number exists** |
| **2 — Equity Accounting** | 🔴 **NO** | **No account equity. No balance. No NAV. Three separate equities** |
| **3 — Allocation Governance** | 🔴 **NO** | **9.8× over-allocated. No allocator exists** |
| **4 — Capital Protection** | 🔴 **NO** | 🟢 The half-compound reserve is genuinely good — 🔴 **but the halt that protects it does not survive a restart**, and **6 of 8 engines have no loss limit at all** |
| **5 — Production Candidate** | 🔴 **NO** | — |

## ## **Capital Engine: LEVEL 0–1 — PROTOTYPE / partial tracking.**

---

# PART 14 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE — this document** | — | none | 6 write sites, 5 claimants, 0 allocators, 0 margin |
| **2 — Ownership** | **`AccountLedger` as a READ-ONLY SHADOW.** Publish one balance alongside the three, and **assert they reconcile for two weeks before it becomes authoritative** | — | **Low — it decides nothing yet** | One published account balance, reconciling |
| **3 — Accounting consistency** | 🔴 **Configuration MUST NOT write a balance** (`execution-engine:113`). 🔴 **`/api/risk` must read the engines** (011 §0) | Phase 2 | 🔒 **Both files are PROTECTED — approval** | A settings file can no longer change the account |
| **4 — Allocation governance** | 🔴 **`AllocationManager`: Σ allocations ≤ balance, enforced AT BOOT.** 🔴 **Enable `position-sizer.js`** — it is already written and already imported | Phase 3 | 🔴 **BEHAVIOUR CHANGE: every position size will shrink, and some will become unopenable. THAT IS THE CORRECT OUTCOME.** Approval | **9.8× → 1.0×.** No position is opened that cannot be funded |
| **5 — Recovery validation** | Persist the halt (S-01). Persist open positions (010 §0). `CapitalAuditLog` | Phase 4 | Medium | **Every capital mutation is traceable to a trade** |

---

# PART 15 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Capital has one authoritative owner | 🔴 **NO — 3 modules, 6 write sites, and a config file** |
| Equity calculations are deterministic | 🟡 **Per-engine: yes and correct. Account-level: does not exist** |
| **Margin accounting is reproducible** | 🔴 **NO — margin does not exist. UNKNOWN** |
| Capital survives restart correctly | 🟢 **YES — capital, reserve and consecLosses all restore.** 🔴 **The halt does not** |
| **Allocation is explicit** | 🔴 **NO — 9.8× over-allocated, silently** |
| Capital mutations are fully auditable | 🔴 **NO — one number, overwritten in place** |
| Risk decisions consume validated capital state | 🔴 **NO — `/api/risk` reads `process.env`** |

## **1 of 7.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent financial systems engineer explain every capital change, reproduce
the equity calculation, verify margin accounting, confirm restart recovery, and name the single
authoritative source of capital?**

**Four of five: no. One: yes — and it is the best-engineered thing in the domain.**

🟢 **What is genuinely good, and must be preserved:**

- **`safe-write` on the equity file** — atomic, `.bak`, validate-by-reparse, **fail-closed on corrupt**.
  *"Cannot know the loss streak — HALTING."* **This is exemplary.**
- **The half-compound reserve** — on a win, half the profit is moved to a protected pile; losses come
  out of active capital in full; the drawdown circuit tracks the total. **A sound, deliberate,
  correctly-documented money-management design.** The live numbers reconcile exactly.
- **`position-sizer.js`** — margin-aware, and **brutally honest in its own header.**

🔴 **And then the two findings:**

> **Five engines each help themselves to the same account. Measured: they collectively claim
> ₹9,80,000 against a ₹1,00,000 balance — a 9.8× over-allocation — and no component in this system is
> capable of adding them up.** *(`grep availableCapital` → **0 modules**.)*

> **And the platform already knows its position sizing is fiction. `position-sizer.js` states, in its own
> words, that a naked NIFTY short strangle needs ~₹1.3L/lot of SPAN margin, so "a ₹1L account literally
> cannot hold even one lot," and that premium-based sizing "was fantasy."**
>
> **`strangle-engine.js:81` imports that module. `strangle-engine.js:83` disables it by default.**
> **`STRANGLE_USE_SIZER` is set nowhere — not in `.env`, not in `config-overrides.json`.**
>
> **The correct answer is in the repository, loaded into memory, and switched off.**

**The consequence, stated plainly: every backtest in this platform opens positions that could never have
been funded, and the platform's own code says so.**

**The single highest-value capital change:**

> ## **Enable `position-sizer.js`, and refuse at boot to allocate more than the account holds.**
>
> **Both will make every position smaller, and some will become unopenable. That is not a regression.
> That is the first time this platform will have sized a trade it could actually afford.**

---

**Strategies optimized: NONE. Sizing rules recommended: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Capital Inventory (Part 1) · Lifecycle (Part 2) · Ownership Matrix (Part 3) ·
Accounting Assessment (Part 4) · Allocation Assessment (Part 5) · Preservation Review (Part 6) ·
Capital State (Part 7) · Failure Modes (Part 8) · Observability (Part 9) · Architecture & Contracts
(Parts 10–11) · Testing Strategy (Part 12) · Maturity Assessment (Part 13) · Migration Roadmap
(Part 14) · Executive Summary.
