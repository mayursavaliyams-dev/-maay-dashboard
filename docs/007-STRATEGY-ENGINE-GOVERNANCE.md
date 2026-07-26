# 007 — STRATEGY ENGINE, SIGNAL GENERATION & STRATEGY GOVERNANCE

**Standard:** Master Prompt 007 · **Depends on:** 000-A…E, 001-A…F, 002…006
**Date:** 2026-07-12 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No strategy modified. No parameter tuned. Profitability NOT assessed.**

---

# SECTION 0 — THE HEADLINE

> ## 🔴 **THE STRATEGY THAT IS RUNNING HAS NEVER BEEN BACKTESTED.**
> ## **THE STRATEGY THAT WAS BACKTESTED IS NOT RUNNING.**

**Measured, from the live config and the live ledger:**

```
data/config-overrides.json   STRANGLE_FORCE_CONDOR = true
data/signal-outcomes.json    structures traded = [ "IRON_CONDOR" ]     ← the ONLY one
```

**Measured, from the flagship backtest that justifies the ₹7L allocation:**

```
bt-strangle-costs.js:47   const ce = leg(day,'CE', atm+off), pe = leg(day,'PE', atm-off);
                          ↑ TWO legs. Naked short strangle.

grep -c "wing|condor" bt-strangle-costs.js   →  0
grep -c "wing|condor" bt-validate.js         →  0     ← the validator too
```

| | Backtested | **Live** |
|---|---|---|
| **Structure** | **Naked short strangle** — 2 legs, unlimited loss | **Iron condor** — 4 legs, defined risk |
| Credit received | higher (no wings to buy) | **lower** (wings cost premium) |
| Max loss | **unbounded** | **capped at the wing width** |
| Evidence | PF 7.41 → **0.55** honest → **`FAIL (likely overfit)`** | ⚪ **NONE. It has never been backtested at all.** |

> **The two structures have different credit, different max loss, different win rate and different
> tail behaviour. The evidence chain — every number this platform has ever published about its selling
> edge — describes a strategy that is not the one running.**
>
> **This is not "the backtest was wrong." It is "the backtest was about a different strategy."**

**A condor backtest DOES exist** — `bt-strangle-tailsafe.js` (33 wing/condor references). **It is not
the flagship, it carries the same look-ahead, and no published result cites it.**

---

# PART 1 — STRATEGY CATALOGUE

| # | Strategy | Purpose | Instruments | TF | Status | **Owner** | Emits | Conf |
|---|---|---|---|---|---|---|---|---|
| 1 | **`execution-engine.js`** (directional) | Intraday option **buying**, multi-confirm | SENSEX, NIFTY | intraday | 🔴 **LIVE (paper), auto ON** | itself | `BUY`/`SELL` | HIGH |
| 2 | **`afternoon-engine.js`** | 2nd session, same logic | SENSEX, NIFTY | afternoon | 🔴 **LIVE (paper), auto ON** | itself | `BUY`/`SELL` | HIGH |
| 3 | **`strangle-engine.js`** | Premium selling — **runs as an IRON CONDOR** | NIFTY | daily→expiry | 🔴 **LIVE (paper), ON, ₹7L** | itself | positions | HIGH |
| 4 | **`gamma-blast-engine.js`** | Expiry-day **buying** | NIFTY | expiry day | 🟡 LIVE (paper), ON | itself | positions | HIGH |
| 5 | **`agents-engine.js`** | 5-agent news→impact→risk→paper | multi | 45 s | 🟡 LIVE (paper), ON | itself | `BUY`/`SELL` ×8 | HIGH |
| 6 | **`bounce-engine.js`** | Bounce | — | intraday | 🟡 LIVE (paper), ON | itself | `BUY`/`SELL` | MEDIUM |
| 7 | **`pop-seller.js`** | PoP-ranked selling book | multi | — | 🟡 paper | itself | 🟢 **`EngineVerdict`** | HIGH |
| 8 | `signal-paper-engine.js` | Paper signal executor | — | — | 🟡 ON | itself | signal | MEDIUM |

## 🔴 P1-A — **`engine-verdict.js` has ONE adopter out of eight**

```
grep -rl "require.*engine-verdict"  →  pop-seller.js        ← that is the complete list
```

The contract is written, tested (114 assertions), and enforced in code. **Seven of eight engines
bypass it and emit raw `BUY`/`SELL` strings.**

`engine-verdict.js:25`: *"`reliability: null` ⇒ weight 0 ⇒ VETO-ONLY. An engine that has never been
measured may not steer."*

> **Seven engines steer without ever having been measured, because they do not use the contract that
> would have stopped them.**

## 🔴 P1-B — **`strategyId` does not exist. Anywhere.**

```
grep -rl "strategyId|strategy_id"  →  (nothing)
```

**No signal, anywhere in this platform, records which strategy produced it.**

---

# PART 2 — STRATEGY LIFECYCLE MAP

```
 Research → Prototype → Implementation → Backtest → Validation → Paper → Candidate → Live
                                              ↑           ↑         ↑
                                              │           │         └── ALL 6 ENGINES ARE HERE
                                              │           └── 🔴 ZERO strategies passed this
                                              └── 🔴 and the ONE that was backtested
                                                     is not the one running (§0)
```

## Unsupported transitions — **every engine made at least one**

| Engine | Illegal transition | Evidence |
|---|---|---|
| **`strangle-engine`** | **Backtest → Paper, on a backtest of a DIFFERENT STRUCTURE** | §0. Live = condor; backtest = naked strangle |
| **`execution-engine`** | **Backtest → Paper, on a REFUTED backtest** | PF 0.94 over 1,200 trades. **NIFTY directional auto was disabled 2026-06-22 — and `config-overrides.json` sets `NIFTY_DIRECTIONAL_AUTO: true`, and the live API confirms `autoEnabled: true`** |
| **`afternoon-engine`** | Backtest → Paper | **No backtest of the afternoon session exists at all** |
| **`gamma-blast-engine`** | Prototype → Paper | 🟢 **HONEST** — explicitly declares itself not backtestable; forward-test only. **The only engine whose evidence claim matches its evidence** |
| **`agents-engine`** | Prototype → Paper | No backtest. 23 paper trades |
| **`bounce-engine`** | Prototype → Paper | No backtest found |

> 🔴 **The lifecycle gate does not exist as code.** Nothing in the running system knows that a strategy
> was invalidated. **`STRANGLE_ENGINE_ENABLED: true` and `NIFTY_DIRECTIONAL_AUTO: true` sit in a config
> file, and the config file has no idea that both strategies' evidence is dead.** *(003 §3.6 — this is
> why `StrategyRegistry` with a maturity level is a **boundary**, not a comment.)*

---

# PART 3 — SIGNAL PIPELINE

```
  Market Data ──▶ 🔴 `|| 0` × 119. Unknown becomes zero. (006)
       ↓
  Feature Gen ──▶ multiconfirm · candlestick-patterns · gex-skew · vol-context · smart-money
       ↓          🔴 features are COMPUTED AND DISCARDED. No feature store ⇒ no signal can ever
       ↓             be re-derived, and no ML is possible, ever.
  Filters ──────▶ regime · IV percentile · trend · event-risk
       ↓
  Entry Cond ───▶ per-engine, private, unversioned
       ↓
  SIGNAL ───────▶ 🔴 a raw string 'BUY'/'SELL' in 7 of 8 engines.
       ↓             🟢 an EngineVerdict in 1 (pop-seller).
       ↓             🔴 NO strategyId. NO inputs recorded. NO reason chain.
  Risk Review ──▶ 🔴🔴 **THIS STAGE DOES NOT EXIST.**
       ↓             grep -rn "riskEngine|risk.evaluate|canTrade|allowTrade" → NOTHING
       ↓             Only per-engine self-brakes — and they do not survive a restart (005 S-01).
  Exec Request ─▶ placeOrder() — 8 call sites, 6 modules, NO chokepoint
       ↓
  Order ────────▶ blocked ONLY by `paperMode`
```

## 🔴 P3-A — **The Risk Review stage in the prompt's own diagram is empty**

`grep -rn "riskEngine|RiskEngine|risk.evaluate|canTrade|allowTrade"` → **zero matches.**

**Every engine decides for itself whether it may trade, and then places its own order.** There is no
second opinion anywhere in the pipeline.

---

# PART 4 — ENTRY / EXIT RULE REGISTER

| Engine | Entry | Exit | Stop | Target | Trail | Session exit | **Emergency exit** |
|---|---|---|---|---|---|---|---|
| **`execution-engine`** | multi-confirm score ≥ threshold | SL / target / trail / squareoff | ✅ `STOP_LOSS_PERCENT` | ✅ `targetMult` | ✅ 17 refs | ✅ squareoff | 🔴 **NONE** |
| **`afternoon-engine`** | same, afternoon window | same | ✅ | ✅ | ✅ | ✅ `entryEnd` | 🔴 **NONE** |
| **`strangle-engine`** | IV percentile ≥ `ivPctMin` | leg premium ≥ `stopMult`(2.0×) **OR** `tpPct`(50%) of credit captured **OR** expiry-day close | ✅ `stopMult` | ✅ `tpPct` | ✅ | 🟡 hold-to-expiry | 🟡 **2 refs — `tailSafePct`** |
| **`gamma-blast-engine`** | blast detector | SL / TP / trail / squareoff | ✅ | ✅ | ✅ | ✅ | 🔴 **NONE** |
| **`agents-engine`** | 11-factor fusion + 9-check gate | +40% / −20% | ✅ | ✅ | ✅ | ✅ | 🟡 1 ref |

## 🟢 CORRECTION — the strangle engine is **NOT** a naked short (my harness said it was)

My first pass reported `strangle-engine: SL=0, SQUAREOFF=0, TIME=0` and I nearly published
*"a naked short with unbounded loss and no stop."* **That is false.** The engine has:

```js
strangle-engine.js:60   stopMult    = 2.0    // leg premium × 2 → STOP
strangle-engine.js:61   tpPct       = 50     // take profit at 50% of credit captured
strangle-engine.js:73   wingPts     = 200    // BUY wings 200 pts beyond each short
strangle-engine.js:77   forceCondor          // ← LIVE VALUE: true → DEFINED-RISK IRON CONDOR
strangle-engine.js:72   tailSafePct = 0.8    // tail guard
```

**My grep searched for `stopLoss|SL_PCT|slPct`. The engine uses `stopMult`.** *(This is the third false
positive my own harness produced in this audit programme — see §12.)*

> **`strangle-engine.js` is, by design, the SAFEST engine in the platform: hedged, defined-risk,
> stop, target and tail guard. And it is running a structure that has never been backtested.**

## Hidden assumptions

| # | Assumption | Status |
|---|---|---|
| **A-1** | **That the backtested structure and the live structure are the same** | 🔴 **FALSE (§0)** |
| **A-2** | That margin is available for a 4-leg condor | ⚪ **UNKNOWN — SPAN is not captured anywhere** |
| **A-3** | That `stopMult = 2.0` can actually be filled on a gapping option | ⚪ **UNKNOWN — no slippage/fill model exists** |
| **A-4** | That a halt persists | 🔴 **FALSE (005 S-01)** |
| **A-5** | That the lot is 65 | 🔴 **Hardcoded 8× in `server.js`** (006 N-1) |

---

# PART 5 — PARAMETER GOVERNANCE MATRIX

| Engine | Env params | Owner | Validated? | Ranges declared? |
|---|---|---|---|---|
| `execution-engine` | **21** | 🔴 NONE | 🔴 **NO** | 🔴 NO |
| `agents-engine` | **20** | 🔴 NONE | 🔴 **NO** | 🔴 NO |
| `strangle-engine` | **15** | 🔴 NONE | 🔴 **NO** | 🔴 NO |
| `gamma-blast-engine` | 8 | 🔴 NONE | 🔴 **NO** | 🔴 NO |
| `pop-seller` | 1 | 🟢 registry | 🟡 | — |

**65 tunable parameters across five engines. Not one is validated, range-checked, or owned.**
*(004 §6: no schema library exists; **107 env vars fall back to a hardcoded literal**.)*

**Every one uses the `?? process.env.X ?? <literal>` idiom** — so a misspelt parameter name silently
takes the literal, and **nothing anywhere reports which value was actually used.**

> **`bt-real.js:9-10` — 9 tuned constants with no justification (001-D R-06) — is not an outlier.
> It is the house style.**

---

# PART 6 — STRATEGY STATE INVENTORY

| State | Owner | Persisted? | Survives restart? |
|---|---|---|---|
| Current signal | engine | 🔴 no | 🔴 no |
| `_enteredToday` | engine (`afternoon:131`) | 🔴 **no** | 🔴 **NO — a restart re-arms today's entry** |
| Cooldown (`_lastExitAt`) | engine (`afternoon:139`) | 🔴 no | 🔴 **NO — a restart clears the re-entry cooldown** |
| `_consecLosses` | engine | 🟢 yes | 🟢 yes |
| **Halt (`_haltedReason`)** | engine | 🔴 **NO (005 S-01)** | 🔴 **NO** |
| Position awareness | engine | 🟡 | 🟡 |
| Internal indicators | engine | 🔴 no | 🔴 no |

## 🔴 P6-A — **A restart resets the duplicate-entry guard**

`_enteredToday` and `_lastExitAt` are **in-memory only.** A restart at 11:00 clears both, and the
engine may **enter a second time on the same day** and **ignore its own re-entry cooldown.**

**Same root cause as 005 S-01: the engine persists what it *has* (capital, losses) and not what it
*decided* (halted, entered, cooling down).**

---

# PART 7 — INTERFACE CATALOGUE & HIDDEN COUPLING

| Interface | Exists? |
|---|---|
| Strategy ← Market Data | 🟡 direct, unvalidated |
| **Strategy → Risk** | 🔴 **DOES NOT EXIST** |
| **Strategy → Portfolio** | 🔴 **DOES NOT EXIST** |
| Strategy → Execution | 🔴 **direct `placeOrder()` — 8 sites, no chokepoint** |
| Strategy ← Research/Validation | 🔴 **NONE. No feedback loop** |
| Strategy → AI | 🟢 `EngineVerdict` — **1 adopter** |

## 🔴 P7-A — **No engine knows any other engine exists**

```
grep -rn "strangleEngine|gammaBlastEngine|agentsEngine|niftyEngine" (excluding server.js)  →  NOTHING
```

Six engines run concurrently on the same account, and **none can see any other.**

> **The NIFTY directional engine can be long an ATM call while the strangle engine is short a call at
> the same strike, on the same expiry, funded by the same capital — and no component in this system
> is capable of noticing.**
>
> Nothing nets. Nothing aggregates exposure. `grep totalExposure|portfolioRisk|netDelta` → **nothing.**

## Hidden coupling — **the shared capital**

`CAPITAL_TOTAL` feeds `execution-engine` and `afternoon-engine`; `STRANGLE_CAPITAL` (₹700,000) feeds
the strangle. **They are three separate `this.capital` fields describing one real account** *(001-B §4)*.

---

# PART 8 — OBSERVABILITY

**The prompt requires every signal to record: timestamp · strategy ID · inputs · decision · confidence ·
reason · outcome.**

The actual record, from `data/signal-outcomes.json` (**12 entries**):

```json
{ "t": 1783401873150, "inst": "NIFTY", "structure": "IRON_CONDOR",
  "rawP": 0.7611, "prob": 76, "won": true, "pnl": 1540.5 }
```

| Required | Present? |
|---|---|
| Timestamp | 🟢 `t` |
| **Strategy ID** | 🔴 **ABSENT — the field does not exist anywhere in the codebase** |
| **Inputs** | 🔴 **ABSENT — features are computed and discarded** |
| Decision | 🟡 `structure` only |
| Confidence | 🟢 `rawP` / `prob` |
| **Reason** | 🔴 **ABSENT** |
| Outcome | 🟢 `won`, `pnl` |

> ## 🔴 **NO SIGNAL IN THIS PLATFORM IS REPRODUCIBLE.**
>
> Given a past signal, it is **impossible** to determine which strategy emitted it, what inputs it saw,
> or why it decided as it did. **The inputs were never stored.**
>
> **007's own stop condition applies: *"Stop and report UNKNOWN if signal generation cannot be
> reproduced."* → UNKNOWN.**
>
> This is also why **AI readiness is BLOCKED** (001-D §10): you cannot calibrate, and you cannot train,
> on features you threw away.

---

# PART 9 — FAILURE MODE REGISTER

| ID | Failure | Handling | Fail-safe? |
|---|---|---|---|
| **SF-1** | **Missing market data** | 🔴 `|| 0` × 119 — becomes a number | 🔴 **NO** |
| **SF-2** | **Invalid parameter** | 🔴 silently takes the literal | 🔴 **NO** |
| **SF-3** | **Duplicate signal** | 🟡 `_enteredToday` — 🔴 **in-memory only; a restart clears it** | 🔴 **NO** |
| **SF-4** | **Repeated entry** | 🟡 cooldown — 🔴 **also cleared by a restart** | 🔴 **NO** |
| **SF-5** | **Strategy conflict** | 🔴 **NOT DETECTABLE. No engine sees another** | 🔴 **NO** |
| **SF-6** | **Partial initialization** | 🔴 No boot validation; the platform starts with no config | 🔴 **NO** |
| **SF-7** | **A halted engine restarts** | 🔴 **The halt is gone (005 S-01/S-02)** | 🔴 **NO** |
| **SF-8** | **A strategy with a dead edge is enabled** | 🔴 **Nothing knows.** Both are enabled right now | 🔴 **NO** |
| **SF-9** | Broker 429 | 🟢 backoff + coalescing | 🟢 **YES** |

**One of nine failure modes fails safe.**

---

# PART 10 — STRATEGY ARCHITECTURE (conceptual — no code)

```
   StrategyRegistry  ★
     · every strategy declares: id · maturity(0-6) · structure · backtestRef · owner
     · 🔴 INVARIANT: a strategy below Level 3 (Statistically Validated) may run in PAPER ONLY.
     · 🔴 INVARIANT: `structure` MUST match the structure of its `backtestRef`.
              ── this single rule would have caught §0 at the moment the condor was switched on.

   Strategy (interface)
     propose(ctx) → EngineVerdict { strategyId, reliability, reasons[], freshnessMs, inputsHash }
     · MAY PROPOSE. MAY NEVER: place an order · size a position · touch capital.
     · reliability: null ⇒ weight 0 ⇒ VETO-ONLY.        (engine-verdict.js — 1 adopter today)

   RiskEngine  ★   the ONLY component that may say yes.
     evaluate(proposal) → { allow, reason }
     · sees ALL engines' exposure. Nets. Aggregates. Refuses.

   OrderManager  ★  the ONLY door to a broker. 8 call sites → 1.

   SignalStore  ★  every signal: strategyId · ts · inputsHash · decision · confidence ·
                   reason · outcome.  ← makes a signal REPRODUCIBLE for the first time.

   FeatureStore  ★  features are KEPT, not discarded. Without this, no calibration, no ML — ever.
```

---

# PART 11 — TESTING STRATEGY

| Test | Priority |
|---|---|
| 🔴 **The live structure matches its backtest's structure** | **P0 — §0** |
| 🔴 **A halted engine stays halted across a restart** | **P0 — 005 S-01** |
| 🔴 **`_enteredToday` / cooldown survive a restart** | **P0 — SF-3/SF-4** |
| 🔴 **Every signal carries a `strategyId` and an `inputsHash`** | **P0 — Part 8** |
| 🔴 **A strategy below maturity Level 3 cannot be enabled outside paper** | **P0 — SF-8** |
| **Two engines cannot hold opposing positions in the same strike** | P1 — SF-5 |
| **Missing market data ⇒ the engine REFUSES, it does not score 0** | P1 — SF-1 |
| **Every parameter is range-validated at boot** | P1 — SF-2 |
| Entry/exit logic per engine, against a captured chain | P1 |
| Session boundaries (entry window, squareoff) | P2 |

---

# PART 12 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE — this document** | — | none | Every strategy has an owner, a status and a structure |
| **2 — Ownership** | **`StrategyRegistry`.** Declare id · maturity · structure · backtestRef | Phase 1 | Low — additive | 🔴 **§0 becomes impossible: a structure mismatch fails at boot** |
| **3 — Interface standardization** | Adopt `EngineVerdict` in all 8 engines (**1 today**). `propose()`, never `placeOrder()` | Phase 2 | **Medium — behaviour change ⇒ approval per engine** | 0 raw `BUY`/`SELL` strings · 0 engine-side `placeOrder` |
| **4 — Observability** | `SignalStore` + `FeatureStore`. `strategyId` + `inputsHash` on every signal | Phase 3 | Low — additive | **Every signal is reproducible** |
| **5 — Validation readiness** | Re-backtest **the live structure** through the (now-clean) `bt-validate.js` | Phases 2–4 + **001-D B-2** | 🔴 **The answer may be that the condor has no edge either. That is a success** | Every enabled strategy has a validated backtest **of the structure it actually trades** |

---

# PART 13 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every strategy documented | 🟢 **YES — Part 1** |
| **Every signal reproducible** | 🔴 **NO — no `strategyId`, no stored inputs** |
| Parameter ownership explicit | 🔴 **NO — 65 params, 0 owners, 0 validation** |
| Hidden assumptions eliminated | 🔴 **NO — A-1 (structure mismatch) is live** |
| Strategy decisions observable | 🔴 **NO** |
| Interfaces well-defined | 🔴 **NO — Risk and Portfolio interfaces do not exist** |
| Signal generation deterministic | 🔴 **NO — `|| 0`, unpersisted guards, no input record** |

## **Strategy Engine maturity: 1 of 7. NOT MATURE.**

---

# SECTION 12 — MY OWN FALSE POSITIVES (Rule Zero)

**Third occurrence in this audit programme. Recorded, not hidden.**

| My harness reported | Reality |
|---|---|
| **"`strangle-engine`: SL=0, SQUAREOFF=0, TIME=0 → a naked short with unbounded loss and NO STOP"** | 🔴 **FALSE.** It has `stopMult = 2.0`, `tpPct = 50`, `wingPts = 200`, `tailSafePct = 0.8`, and **`forceCondor: true` — a defined-risk iron condor.** My grep searched for `stopLoss\|SL_PCT`; the engine uses `stopMult`. **It is the SAFEST engine in the platform** |

**Prior false positives:** a "1,647-line function" that was an `if` block (001-C) · a "command injection"
that was a fixed-literal `spawn` (001-C) · a "CORS wildcard" that only fires on origin-less requests
(001-C) · a "dead safety flag" that was live and being overridden (004) · **an `openPosition` race that
does not exist — published in four documents (005)**.

> **Six false positives across seven audits. Every one was caught by reading the code instead of
> trusting the grep. The one I did NOT catch in time — the `openPosition` race — I published four
> times.**
>
> **The measurement is not the finding. Reading the code is the finding.**

---

# EXECUTIVE SUMMARY

**This audit was asked to establish deterministic, reproducible, auditable signal generation.**
**None of the three exists:**

| | |
|---|---|
| **Deterministic** | 🔴 `|| 0` × 119 · unvalidated params · in-memory guards cleared by a restart |
| **Reproducible** | 🔴 **No `strategyId`. No stored inputs. A signal cannot be re-derived. Ever.** |
| **Auditable** | 🔴 No event bus · no signal store · 12 outcome records with no provenance |

**And the finding that outranks all of them:**

> **`STRANGLE_FORCE_CONDOR = true`. The live ledger contains exactly one structure: `IRON_CONDOR`.
> The backtest that justifies its ₹7L allocation models a two-leg naked strangle and contains the word
> "condor" zero times.**
>
> **Every number this platform has ever published about its selling edge — 88.4% win, PF 7.41, and the
> honest PF 0.55 that replaced it — describes a strategy it is not running.**

**What is genuinely good:**

- **`strangle-engine.js`** — hedged, defined-risk, stop, target, tail guard. **The best-designed engine here.** It deserves a backtest of the structure it actually trades.
- **`gamma-blast-engine.js`** — declares itself not backtestable and means it. **The only engine whose evidence claim matches its evidence.**
- **`engine-verdict.js`** — the correct contract, fully specified, 114 assertions. **One adopter.**

**The single highest-value action:** **backtest the iron condor.** `bt-strangle-tailsafe.js` already
models wings. It needs the 001-D look-ahead fix, and then it needs to be run — **because right now,
nobody in the world knows whether the strategy this platform is running works.**

---

**Strategies modified: NONE. Parameters tuned: NONE. Profitability assessed: NOT IN SCOPE. Suite: 48/48.**

**Deliverables:** Strategy Catalogue (Part 1) · Lifecycle Map (Part 2) · Signal Pipeline (Part 3) ·
Entry/Exit Register (Part 4) · Parameter Governance (Part 5) · Strategy State (Part 6) · Interface
Catalogue (Part 7) · Observability (Part 8) · Failure Mode Register (Part 9) · Architecture Blueprint
(Part 10) · Testing Strategy (Part 11) · Migration Roadmap (Part 12) · Executive Summary.
