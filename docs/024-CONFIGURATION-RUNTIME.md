# 024 — CONFIGURATION, ENVIRONMENT & RUNTIME GOVERNANCE

**Standard:** Master Prompt 024 · **Depends on:** 000-A … 023
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No configuration file modified. No runtime behaviour changed.**

**Relationship to 004:** Audit **004** established the configuration *inventory* — and it did so by
querying the **live server**. **024 asks a harder question**, and its own stop condition demands it:
***"Never infer correctness from current runtime state alone."***

**The server is now dead** *(021 §0)*. **So this audit reproduces the entire startup from the files
alone — and then checks the prediction against what 004 measured live.**

---

# SECTION 0 — THE STARTUP DETERMINISM TEST

**No running server. No live query. Only `.env`, `data/config-overrides.json`, `data/equity-*.json`,
and the source. Predict the next boot.**

## The precedence trace, resolved value by value

```
  MAX_DAILY_LOSS_PERCENT  — the risk brake
    1. code default (execution-engine:76) : 2
    2. .env                               : 2
    3. config-overrides.json              : 5
    ─────────────────────────────────────────
    EFFECTIVE                             : 5      ◀── config-overrides WINS over .env

  SENSEX auto-trade
    1. code default (AUTO_TRADE_ENABLED)  : false
    2. .env  SENSEX_AUTO_ENABLED          : false
    3. config-overrides SENSEX_DIRECTIONAL_AUTO : true
    4. server.js:7288  setAutoEnabled(true)
    ─────────────────────────────────────────
    EFFECTIVE                             : true   ◀── setAutoEnabled() at boot WINS

  CAPITAL_TOTAL (NIFTY)
    1. code default (execution-engine:54) : 100000
    2. .env                               : 100000
    3. config-overrides.json              : 100000
    4. restoreEquity()                    : 96761
    ─────────────────────────────────────────
    EFFECTIVE                             : 96761  ◀── restoreEquity() runs LAST (fixed 2026-07-10)

  MAX_CONSECUTIVE_LOSSES
    code default : 5    (execution-engine:77)
    .env         : 8
    .env.example : 3
    ─────────────────────────────────────────
    EFFECTIVE    : 8    ◀── THREE different numbers exist for one brake

  _haltedReason
    persisted?   : NO. It is not a key in equity-*.json.
    ─────────────────────────────────────────
    EFFECTIVE    : null ◀── REGARDLESS of what it was when the process died   (005 S-01)
```

## The prediction

```
  NIFTY    capital 96,761   consecLosses 15/8   haltedReason null   autoEnabled TRUE
  SENSEX   capital 88,011   consecLosses  2/8   haltedReason null   autoEnabled TRUE
```

## And it is exactly what 004 and 005 measured against the **live** server, before it died

```
  LIVE (004, 005):  riskPct: 5 · autoEnabled: true · consecLosses: 15 · capital: 96761
  PREDICTED (024):  riskPct: 5 · autoEnabled: true · consecLosses: 15 · capital: 96761
                    ─────────────────────────────────────────────────────────────────
                    IDENTICAL.
```

> ## 🔴 **STARTUP IS DETERMINISTIC. IT IS REPRODUCIBLE. IT IS PREDICTABLE FROM THE FILES ALONE.**
> ## **AND IT DETERMINISTICALLY, REPRODUCIBLY, PREDICTABLY PRODUCES AN UNSAFE STATE.**
>
> **The NIFTY engine will boot at fifteen consecutive losses against a limit of eight, with no halt,
> auto-trading enabled — and this is not a race, not a bug, not an intermittent fault.**
>
> **It is the configuration system working exactly as designed, every single time.**

**This is the answer 024 asks for, and it is worse than "non-deterministic."**
**A non-deterministic system is unreliable. This one is *reliably* wrong.**

---

# PART 1 — CONFIGURATION INVENTORY

*(Established in 004. Re-verified here from files only.)*

| Source | Keys | Priority | Persistence | Owner |
|---|---|---|---|---|
| **Hardcoded defaults** | **107** — *(68% of the 158 vars the code reads)* | **4 (weakest)** | source | 🔴 **none** |
| **`.env`** | **67** | **3** | file | 🔴 **none** |
| **`data/config-overrides.json`** | **12** | 🔴 **1 (STRONGEST)** | file, **HTTP-mutable** | 🔴 **3 writers** |
| **`restoreEquity()`** | capital, reserve, consecLosses | **applied last** — 🟢 **correctly, since 2026-07-10** | file | engine |
| **`.env.example`** | 181 | documentation | — | — |
| **Command-line args** | **0** | — | — | — |
| **Protected configuration** | 🟢 `server.js`, `execution-engine.js` — approval required | — | — | 🟢 **owner** |

## 🔴 The arithmetic that defines this system

```
  environment variables READ by the code : 158
  declared in .env                       :  67
  ─────────────────────────────────────────────
  relying on a HARDCODED DEFAULT         : 107   ← 68%
```

**Two out of every three configuration values come from a literal buried in the source.**

---

# PART 2 — CONFIGURATION LIFECYCLE

```
  Default ──▶ Environment ──▶ Config Files ──▶ Runtime Overrides ──▶ Startup Init ──▶
  Validation ──▶ Consumption ──▶ Persistence ──▶ Restart ──▶ Shutdown
      ↓              ↓               ↓                 ↓              ↓
      │              │               │                 │              └── 🔴 §0: the halt is
      │              │               │                 │                  DROPPED here, every time.
      │              │               │                 └── 🟢 DETERMINISTIC — and §0 proves it.
      │              │               └── 🔴 HTTP-mutable, unauthenticated, no audit (023 §0.2)
      │              │
      │              └── 🔴 VALIDATION: **DOES NOT EXIST.** No schema library. The platform
      │                     boots with no configuration at all.
      └── 🔴 107 literals, unowned, undeclared.

  Shutdown ──▶ 🔴 021 §0: the last shutdown produced NO record. `_haltedReason` was never written.
```

## **Validation is the only stage that does not exist — and it is the one that would have caught everything else.**

---

# PART 3 — OWNERSHIP MATRIX

| Question | Answer |
|---|---|
| **Who creates configuration?** | 🔴 **3 sources + 107 literals.** No owner |
| **Who validates it?** | 🔴 **NOBODY. No schema library exists** |
| **Who modifies it?** | 🔴 **Anyone on the network.** `POST /api/engine/config` — **unauthenticated** *(023 §0.2)* |
| **Who persists it?** | 🟡 **3 writers.** 2 atomic via `safe-write` 🟢 · **1 raw (`server.js:3773`)** 🔴 |
| **Who restores it?** | 🟢 `_loadConfigOverrides()` — **deterministic** |
| **Who resolves conflicts?** | 🔴 **LINE ORDER.** *Until 2026-07-10, whichever loader ran last owned the account balance* |

### Hidden ownership
- **The risk brake is owned by `config-overrides.json`, not `.env`** — and nothing says so.
- **The account balance was owned by line order** until 2026-07-10. **The shape that allowed it is unchanged.**

### Conflicting ownership — **CONFIRMED, and §0 quantifies it**
`MAX_DAILY_LOSS_PERCENT`: **`.env` says 2. The engine runs at 5.**
`SENSEX_AUTO_ENABLED`: **`.env` says false. The engine runs `true`.**
`MAX_CONSECUTIVE_LOSSES`: **code says 5. `.env` says 8. `.env.example` says 3.**

---

# PART 4 — PRECEDENCE

## 🟢 **Precedence IS explicit and reproducible — §0 proves it by prediction.**

| Rank | Source | Beats |
|---|---|---|
| **1 (STRONGEST)** | **`server.js:7288` `setAutoEnabled()`** at boot | everything, **including a halt** *(B-3)* |
| **2** | **`restoreEquity()`** | config, for capital/reserve/consecLosses |
| **3** | **`data/config-overrides.json`** | `.env` |
| **4** | `process.env[<INST>_AUTO_ENABLED]` | `AUTO_TRADE_ENABLED` |
| **5** | `.env` | hardcoded defaults |
| **6 (WEAKEST)** | **a literal in the source** | — |

## 🔴 **And it is documented NOWHERE in the repository.**

> **The precedence order is real, deterministic and knowable — I reconstructed it in §0 from the source.
> But no `README`, no `.env.example` comment, and no ADR states it.**
>
> **An operator editing `.env` to tighten the risk brake has no way to know that a JSON file they have
> never heard of will silently overrule them.**

---

# PART 5 — VALIDATION

| Check | Present? |
|---|---|
| **Required values** | 🔴 **NONE.** The platform boots with **no configuration at all** |
| **Optional values** | 🔴 undeclared |
| **Type validation** | 🔴 **NONE.** `parseFloat(env.X \|\| 2)` — `X="two"` yields **`NaN`**, not a refusal |
| **Range validation** | 🟡 **`server.js:3731`** declares `{min: 10000, max: 100000000}` for `CAPITAL_TOTAL` — 🔴 **for the UI slider only. The loader ignores it** |
| **Schema validation** | 🔴 **NONE.** No `zod`/`joi`/`envalid`/`convict`/`ajv` in `package.json` |
| **Missing values** | 🔴 **SILENTLY fall back** — **107 of them** |
| **Unknown values** | 🔴 **SILENTLY ignored** |

## 🔴 The rule this breaks, verbatim

**000-A: *"Unknown ≠ Zero. Refuse rather than guess."***
**000-E: *"Critical validation failure must prevent startup."***

```js
execution-engine.js:76   this.maxDailyLossPct = parseFloat(process.env.MAX_DAILY_LOSS_PERCENT || 2) / 100;
```

> **Misspell `MAX_DAILY_LOSS_PERCENT`, and the risk brake silently arms at a value nobody chose.**
> **`process.exit()` appears twice in `server.js` — a crash-loop guard and the shutdown path. Neither is
> a configuration check.**
>
> ## **The platform will start with an empty `.env`, and it will trade.**

---

# PART 6 — STARTUP GOVERNANCE

| Aspect | Verdict |
|---|---|
| **Startup sequence** | 🟢 **DETERMINISTIC — §0 predicted it exactly** |
| **Initialization order** | 🔴 **LOAD-BEARING.** `_loadConfigOverrides()` **must** run before `restoreEquity()`, or a settings file overwrites the account. **Fixed 2026-07-10 — the fragility is unchanged** |
| **Dependency ordering** | 🔴 Implicit, undeclared |
| **Restore behaviour** | 🟡 capital ✓ reserve ✓ consecLosses ✓ · 🔴 **`_haltedReason` ✗** *(005 S-01)* |
| **Override behaviour** | 🔴 **`setAutoEnabled(true)` at `server.js:7288` overrides a halt it cannot see** *(B-3)* |
| **Failure handling** | 🔴 **None. A missing config is a default, not a refusal** |

## ## 🟢 **Startup IS deterministic.** 🔴 **And §0 shows what it deterministically produces: `15/8, unhalted, trading`.**

---

# PART 7 — RUNTIME GOVERNANCE

| Aspect | Verdict |
|---|---|
| **Runtime updates** | 🔴 **`POST /api/engine/config` — unauthenticated** *(023)* |
| **Hot reload** | 🟡 `setConfig()` applies immediately |
| **Configuration mutation** | 🔴 **The risk brake and every auto flag are HTTP-mutable, with no auth, no audit, no versioning** |
| **Persistence** | 🟡 2 of 3 writers atomic |
| **Rollback** | 🟡 `.bak` — **exactly one prior version** |
| **Audit trail** | 🔴 **NONE. Zero configuration events are persisted** *(022)* |

## 🔴 Operational safety verdict

> **A single unauthenticated `POST` from anywhere on the LAN can double the daily-loss limit, and the
> only record it ever happened is a `console.log` in a terminal buffer that — as 021 §0 proved — dies
> with the process.**

---

# PART 8 — OBSERVABILITY

| Required per configuration mutation | Recorded? |
|---|---|
| Timestamp | 🔴 **NO** |
| **Previous value** | 🔴 **NO** |
| New value | 🟡 in the file |
| **Source** | 🔴 **NO** |
| **Actor** | 🔴 **NO — there is no identity** *(023)* |
| **Reason** | 🔴 **NO** |
| **Version** | 🔴 **NO** |

## **1 of 7. *"Configuration changes without provenance are unacceptable."***

---

# PART 9 — FAILURE MODE REGISTER

| ID | Failure | Present? | Impact |
|---|---|---|---|
| **CF-1** | **Startup deterministically produces an unsafe state** | 🔴 **CONFIRMED — §0** | **CRITICAL. `15/8, unhalted, trading`, every boot** |
| **CF-2** | **`.env` is silently overruled by `config-overrides.json`** | 🔴 **CONFIRMED** | **CRITICAL. The operator's mental model of the risk limits is wrong** |
| **CF-3** | **A halt is not part of the configuration lifecycle at all** | 🔴 **CONFIRMED — `_haltedReason` is in no schema** | **CRITICAL** |
| **CF-4** | **No validation. 107 silent fallbacks** | 🔴 **CONFIRMED** | **CRITICAL. A misspelt risk parameter arms a brake nobody chose** |
| **CF-5** | **HTTP-mutable, unauthenticated, unaudited** | 🔴 **CONFIRMED** | **CRITICAL** |
| **CF-6** | **Three different values for `MAX_CONSECUTIVE_LOSSES`** | 🔴 **CONFIRMED — 5 / 8 / 3** | HIGH |
| **CF-7** | **`CAPITAL_TOTAL` has two hardcoded defaults** — ₹100,000 (engines) and ₹500,000 (`/api/risk`) | 🔴 **CONFIRMED** | MEDIUM *(latent)* |
| **CF-8** | **Partial write** — 1 of 3 config writers is raw | 🔴 **CONFIRMED (`server.js:3773`)** | MEDIUM *(package written)* |
| **CF-9** | **Configuration drift** | 🔴 **CONFIRMED — 11 `.env` keys are not in `.env.example`; 9 are dead** | LOW |
| 🟢 **CF-10** | **`TRADE_MODE` is never persisted to live** | 🟢 **CORRECT BY DESIGN** — *"a restored AUTO ON can never re-arm LIVE"* | **The best configuration decision in the codebase** |

---

# PART 10 & 11 — CONFIGURATION ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   ConfigRegistry  ★   ONE declaration per setting:
     key · type · range · required · default · owner · source · sensitive?
     🔴 An UNDECLARED key is a STARTUP FAILURE, not a silent literal.   → kills CF-4

   ValidationLayer  ★  RUNS BEFORE ANYTHING ELSE. FAILS CLOSED.
     🔴 Missing required → REFUSE TO START.
     🔴 Wrong type       → REFUSE TO START.
     🔴 Out of range     → REFUSE TO START.
        (000-E: "Critical validation failure must prevent startup.")

   The boot log the platform SHOULD print — every line below is TRUE today, and NONE is printed:
     [config] MAX_DAILY_LOSS_PERCENT = 5   (.env said 2 — OVERRIDDEN by data/config-overrides.json)
     [config] SENSEX_AUTO_ENABLED    = true (.env said false — OVERRIDDEN)
     [config] CAPITAL_TOTAL          = 96761 (restored balance; config's 100000 IGNORED)
     [config] 107 settings using a hardcoded default.
     [risk]   NIFTY consecLosses 15 >= limit 8 — HALTING AT BOOT.        ← the line that matters

   SEPARATION OF CONCERNS — the rule 004 C-02 and §0 both point at:
     SECRETS   .env               credentials ONLY
     SETTINGS  config/*.json      declarative · schema-validated · VERSION-CONTROLLED
     STATE     AccountLedger      🔴 A BALANCE IS NOT A SETTING.
               RiskState          🔴 A HALT IS NOT A SETTING — AND IT MUST BE PERSISTED.
     🔴 Config is FROZEN after boot. Runtime mutation goes through an AUDITED, AUTHENTICATED path.

   ConfigAuditLog  ★  ts · key · prev · next · source · actor · reason.
                      The append-only .jsonl writer already exists (022 §1).   → kills CF-5
```

## The one rule §0 establishes

> **Determinism is not correctness. A configuration system that reproducibly builds an unsafe state is
> more dangerous than one that fails randomly — because it will never surprise anyone into looking.**

---

# PART 12 — TESTING STRATEGY

| Test | Priority | Would it fail today? |
|---|---|---|
| 🔴 **Boot with `consecLosses >= max` ⇒ the engine is HALTED** | **P0 — §0** | ✅ **FAILS — it boots at 15/8 and trades** |
| 🔴 **A missing required key ⇒ REFUSE TO START** | **P0 — CF-4** | ✅ **FAILS — 107 silent fallbacks** |
| 🔴 **A type/range violation ⇒ REFUSE TO START** | **P0** | ✅ **FAILS — `"two"` becomes `NaN`** |
| 🔴 **Every override is LOGGED at boot, naming the file, the base value and the effective value** | **P0 — CF-2** | ✅ **FAILS — the operator is never told** |
| 🔴 **`config-overrides.json` CANNOT contain a balance or a halt** | **P0 — CF-3** | ✅ **FAILS — `CAPITAL_TOTAL` is in it** |
| 🔴 **Every config mutation is persisted (append-only, with an actor)** | **P0 — CF-5** | ✅ **FAILS — zero** |
| **Startup is reproducible from files alone** | P1 | 🟢 **PASSES — §0 is the proof. Lock it in** |
| 🟢 **`TRADE_MODE` never persists to live** | **P0** | 🟢 **PASSES — assert it so it can never regress** |

**Six P0 tests fail. Two pass and must be locked in.**

---

# PART 13 — CONFIGURATION MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Ad Hoc** | 🟢 | **107 literals scattered across 81 files** |
| **1 — Managed** | 🟡 **PARTIAL** | 🟢 `.env` + `config-overrides.json` exist and are loaded deterministically. 🔴 **68% of values are in neither** |
| **2 — Validated** | 🔴 **NO** | **No schema. The platform boots with no configuration at all** |
| **3 — Governed Runtime** | 🔴 **NO** | **HTTP-mutable, unauthenticated, unaudited** |
| **4 — Deterministic Startup** | 🟡 **§0 PROVES IT IS DETERMINISTIC** — 🔴 **but it deterministically produces `15/8, unhalted, trading`.** *Determinism without validation is not maturity; it is repeatable failure* | |
| **5 — Enterprise Platform** | 🔴 **NO** | — |

## ## **Configuration: LEVEL 0–1 — AD HOC / partially managed.**

---

# PART 14 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE — 004 + this document.** **§0 proves startup is reproducible from files alone** | — | none | Precedence is documented for the first time |
| **2 — Ownership** | 🔴 **PRINT THE OVERRIDES AT BOOT.** Every value that `config-overrides.json` overrules must be logged, naming both values. **This is a log line, and it would have exposed CF-2 on day one** | none | **Near-zero — additive logging.** 🔒 `server.js` protected | **The operator can no longer be wrong about the risk brake** |
| **3 — Validation** | 🔴 **Schema-validate at boot. FAIL CLOSED.** 🔴 **Re-evaluate the halt invariant AFTER restore** *(005 S-02)* | Phase 2 | 🔴 **BEHAVIOUR CHANGE: NIFTY will HALT at boot. THAT IS THE ENTIRE POINT** | **§0's prediction becomes: `15/8 → HALTED`** |
| **4 — Runtime governance** | 🔴 **`requireRole('admin')` on `/api/engine/config`** *(023)*. **`ConfigAuditLog`** — the append-only writer already exists | Phase 3 | Medium | **Every mutation has an actor and is on disk forever** |
| **5 — Recovery** | 🔴 **Separate SECRETS / SETTINGS / STATE.** A balance is not a setting. **A halt is not a setting — and it must be persisted** | Phase 4 | Medium | **Config cannot alter the account or the brake** |

---

# PART 15 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every configuration source has one owner | 🔴 **NO — 3 sources, 107 literals, 0 owners** |
| **Startup behaviour is deterministic** | 🟢 **YES — §0 predicted it exactly from files alone.** 🔴 **And what it deterministically produces is unsafe** |
| **Configuration precedence is documented** | 🔴 **NO — it is knowable, and it is written down NOWHERE.** §0 is the first time it has been recorded |
| Runtime mutations are auditable | 🔴 **NO — zero events persisted** |
| Environment consistency is verifiable | 🔴 **NO — `MAX_CONSECUTIVE_LOSSES` has three values** |
| Configuration recovery is reliable | 🟡 **`.bak` — one prior version.** 🔴 **The halt is not in the schema at all** |
| **Unknown config never silently falls back to unsafe defaults** | 🔴 **NO — 107 silent fallbacks, one of which is a risk brake** |

## **1 of 7 — and the one that passes is the one that makes the others dangerous.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent platform engineer reproduce startup behaviour, explain every
configuration value, verify precedence, and confirm that configuration cannot silently alter platform
behaviour?**

## **The first three: yes. The fourth: no. And the combination is the finding.**

**024's own stop condition forbids inferring correctness from the running system. The bot is dead
(021 §0), so I could not have anyway. Instead I reconstructed the entire boot from `.env`,
`config-overrides.json`, `equity-*.json` and the source — and predicted the next startup:**

```
  NIFTY   capital ₹96,761   consecLosses 15/8   haltedReason null   autoEnabled TRUE
  SENSEX  capital ₹88,011   consecLosses  2/8   haltedReason null   autoEnabled TRUE
```

**That prediction is IDENTICAL to what audits 004 and 005 measured against the live server before it
died.**

> ## **The configuration system is deterministic. It is reproducible. It is predictable from the files alone.**
>
> ## **And it deterministically, reproducibly, predictably boots the NIFTY engine at fifteen consecutive losses against a limit of eight, with no halt, auto-trading enabled.**
>
> **This is not a race condition. It is not an intermittent fault. It is not a bug in the sense of
> something going wrong.**
>
> **It is the configuration system working exactly as designed, every single time.**
>
> **A non-deterministic system is unreliable. This one is *reliably wrong* — which is worse, because it
> will never surprise anyone into looking.**

**The three structural causes, each measured:**

1. **`.env` is a decoy.** It says the risk brake is 2%. The engine runs at 5%, because
   `config-overrides.json` silently wins. It says SENSEX auto is `false`. The engine runs `true`.
   **The precedence order is real and knowable — and it is documented nowhere in the repository.**

2. **68% of configuration is invisible.** The code reads **158** environment variables. **67** are in
   `.env`. **107 fall back to a literal buried in the source** — including `MAX_DRAWDOWN_PERCENT`, a
   risk brake, and the disputed STT and exchange-charge rates.

3. **There is no validation.** No schema library. **The platform will boot with an empty `.env` and
   trade.** Misspell `MAX_DAILY_LOSS_PERCENT` and the brake silently arms at a value nobody chose.
   **000-E requires that a critical validation failure prevent startup. Nothing prevents anything.**

**And one thing is exactly right, and must never regress:**

> 🟢 **`TRADE_MODE` is never persisted to live.** `server.js:7286`: *"a restored AUTO ON can never re-arm
> LIVE."* **Every boot starts in paper. It is the single best configuration decision in the codebase,
> and it is the only reason §0's prediction is a report rather than an incident.**

**The cheapest change with the largest return, and it is a log line:**

> ## **PRINT THE OVERRIDES AT BOOT.**
>
> ```
> [config] MAX_DAILY_LOSS_PERCENT = 5   (.env said 2 — OVERRIDDEN by data/config-overrides.json)
> [config] SENSEX_AUTO_ENABLED    = true (.env said false — OVERRIDDEN)
> [risk]   NIFTY consecLosses 15 >= limit 8 — HALTING AT BOOT.
> ```
>
> **Every one of those lines is true of this system today. Not one of them is printed. The first two
> would have exposed the decoy on day one — and the third would have stopped the engine.**

---

**Configuration files modified: NONE. Runtime behaviour changed: NONE. Code modified: NONE.
Suite: 48/48.**

**Deliverables:** Configuration Inventory (Part 1) · Lifecycle (Part 2) · Ownership Matrix (Part 3) ·
**Precedence Assessment — reconstructed and PROVEN by prediction (§0, Part 4)** · Validation Review
(Part 5) · Startup Governance (Part 6) · Runtime Governance (Part 7) · Observability (Part 8) · Failure
Modes (Part 9) · Architecture & Contracts (Parts 10–11) · Testing Strategy (Part 12) · Maturity
Assessment (Part 13) · Migration Roadmap (Part 14) · Executive Summary.
