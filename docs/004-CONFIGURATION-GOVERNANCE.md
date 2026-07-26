# 004 — CONFIGURATION GOVERNANCE, FEATURE FLAGS & STATE CONFIGURATION ARCHITECTURE

**Standard:** Master Prompt 004 · **Depends on:** 000-A…E, 001-A…F, 002, 003
**Date:** 2026-07-12 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No configuration was modified. No loader was rewritten. Zero files changed.**

**Method.** A measurement harness was run against `.env`, `.env.example`, `data/config-overrides.json`,
`ecosystem.config.js` and all 81 source files, **and the results were checked against the LIVE running
server** (`:3000`). Two of my own findings were wrong and are corrected in §12.

---

# SECTION 0 — THE HEADLINE

> ## 🔴 **`.env` IS NOT THE SOURCE OF TRUTH, AND NOTHING TELLS ANYONE THAT.**

**Verified against the live process, not inferred:**

| Setting | **`.env` says** | **The running engine actually uses** | Overridden by |
|---|---|---|---|
| **`MAX_DAILY_LOSS_PERCENT`** — the daily-loss risk brake | **2** | 🔴 **5** *(live: `riskPct: 5`)* | `data/config-overrides.json` |
| **`SENSEX_AUTO_ENABLED`** — the per-instrument auto-trade safety flag | **false** | 🔴 **true** *(live: `autoEnabled: true`)* | `data/config-overrides.json` → `SENSEX_DIRECTIONAL_AUTO` |

**Independent arithmetic confirms it.** The live capital is **₹88,011** and the armed daily-loss brake
is **₹4,400.55**.

```
4,400.55 / 88,011  =  5.00%      ← the brake is 5%, not the 2% written in .env
```

> **An operator who opens `.env`, sees `MAX_DAILY_LOSS_PERCENT=2`, and believes the account can lose at
> most 2% in a day is wrong by a factor of 2.5 — and nothing anywhere warns them.**
>
> **An operator who sets `SENSEX_AUTO_ENABLED=false` to stop SENSEX trading has not stopped it.**
>
> `.env` is a **decoy**. The real configuration lives in `data/config-overrides.json`, a runtime file
> written by HTTP handlers, and it **silently wins**.

---

# SECTION 1 — CONFIGURATION INVENTORY

| Source | Size | Purpose | Owner | Load order | Consumers | Validation | Confidence |
|---|---|---|---|---|---|---|---|
| **`.env`** | 8,404 B, **67 keys** | Secrets + base settings | **NONE** | **1st** | everything | 🔴 **NONE** | HIGH |
| **`.env.example`** | 9,692 B, **181 keys** | Documentation | — | n/a | humans | — | HIGH |
| **`data/config-overrides.json`** | **12 keys** | 🔴 **The REAL config. Runtime-mutable. WINS.** | **3 writers** | **2nd — LAST WORD** | engines | 🟡 partial | HIGH |
| **Hardcoded defaults** (`process.env.X \|\| default`) | **107 keys** | The actual value for **2 out of every 3** settings the code reads | scattered | fallback | everything | — | HIGH |
| `ecosystem.config.js` | 397 B | PM2 process config | — | build | PM2 | — | HIGH |
| `package.json` | 1,294 B | Deps + scripts | — | build | npm | — | HIGH |
| `data/confluence-weights.json` | — | **Learned weights** (state, not config) | `confluence-learner.js` | runtime | learner | 🟢 `.bak` | HIGH |
| **CLI arguments** | — | **NONE** | — | — | — | — | HIGH |
| **Build-time config** | — | **NONE** — no build step | — | — | — | — | HIGH |

### 🔴 The arithmetic that defines this system

```
Environment variables READ by the code : 158
Environment variables DECLARED in .env :  67
                                        ─────
Relying on a HARDCODED DEFAULT         : 107   ← 68% of all settings
```

**Two out of every three configuration values in this platform come from a literal buried in the
source, not from any configuration file.**

Among the 107 are things that matter:

| Key | Hardcoded default | Why it matters |
|---|---|---|
| **`MAX_DRAWDOWN_PERCENT`** | — | 🔴 **A RISK BRAKE, configured by a default nobody wrote down** |
| **`CHARGE_STT_SELL_PCT`** | `0.1` | 🔴 **Constraint E1 — this rate is DISPUTED, and it is a hardcoded default** |
| **`CHARGE_EXCH_TXN_PCT`** | `0.03503` | 🔴 **Also disputed. Both are wrong in opposite directions and cancel to ≈ −0.33%** |
| **`NIFTY_LOT_SIZE`** | registry | The registry's env override — **defeated by `server.js`'s hardcoded `lotSize: 65`** (001-C D-01) |
| **`AUTH_SECRET`** | — | 🔴 **A JWT signing key with a hardcoded fallback** |
| **`STRANGLE_CAPITAL`** | `100000` | Overridden to **₹700,000** by `config-overrides.json` |
| **`AI_AGENTS_ENABLED`** | `'true'` | **AI agents default ON, and the flag appears in no config file** |

---

# SECTION 2 — LOAD ORDER

```
 ┌─────────────────────────────────────────────────────────────────────────┐
 │ 1.  dotenv → process.env                                  [.env, 67 keys]│
 │       ↓                                                                  │
 │ 2.  server.js:7   process.env.DHAN_ACCESS_TOKEN = normalize(...)         │
 │       ↓                       ◀── RUNTIME MUTATION, before anything reads│
 │ 3.  Engine constructors                                                  │
 │       execution-engine:54   this.capital = env.CAPITAL_TOTAL || 100000   │
 │       execution-engine:69   autoEnabled  = env[`${INST}_AUTO_ENABLED`]   │
 │                                          ?? env.AUTO_TRADE_ENABLED       │
 │       execution-engine:76   maxDailyLossPct = env.MAX_DAILY_LOSS_PERCENT │
 │                                              || 2                        │
 │       ↓                                                                  │
 │ 4.  _loadConfigOverrides()  →  data/config-overrides.json  [12 keys]     │
 │       ↓                                                                  │
 │ 5.  engine.setConfig(overrides)                                          │
 │       execution-engine:112  maxDailyLossPct = overrides.MAX_DAILY_LOSS…  │
 │       execution-engine:113  this.capital    = overrides.CAPITAL_TOTAL    │
 │                                          ◀── 🔴 A SETTINGS FILE WRITES   │
 │                                              THE ACCOUNT BALANCE          │
 │       ↓                                                                  │
 │ 6.  engine.restoreEquity()   ← the PERSISTED balance                     │
 │                              ◀── MOVED HERE 2026-07-10. Before that,     │
 │                                  step 5 ran LAST and the config          │
 │                                  overwrote the real account balance      │
 │                                  at every single boot.                   │
 │       ↓                                                                  │
 │ 7.  app.listen() → server.js:7280-7288                                   │
 │       setAutoEnabled(_cfgOverrides.SENSEX_DIRECTIONAL_AUTO)              │
 │                              ◀── 🔴 THE LAST WORD. Overrides .env AND    │
 │                                  re-enables a HALTED engine (B-3)        │
 └─────────────────────────────────────────────────────────────────────────┘
```

## Precedence rules — **measured, never documented anywhere in the repo**

| Rank | Source | Wins over |
|---|---|---|
| **1 (STRONGEST)** | **`data/config-overrides.json`** | everything |
| 2 | `process.env[<INST>_AUTO_ENABLED]` | `AUTO_TRADE_ENABLED` |
| 3 | `.env` | hardcoded defaults |
| 4 (weakest) | **hardcoded literal in the source** | — |

## 🔴 Conflicting load order — CONFIRMED

| # | Conflict | Evidence |
|---|---|---|
| **1** | **`MAX_DAILY_LOSS_PERCENT`**: `.env` = 2 → engine constructs at 2% → `setConfig()` overwrites with **5%** from `config-overrides.json`. **Live: `riskPct: 5`** | `execution-engine.js:76` then `:112` |
| **2** | **`SENSEX_AUTO_ENABLED`**: `.env` = `false` → engine constructs with `autoEnabled = false` → `server.js:7288` calls `setAutoEnabled(true)`. **Live: `autoEnabled: true`** | `execution-engine.js:69-73` then `server.js:7288` |
| **3** | **`CAPITAL_TOTAL`**: config (step 5) vs restored equity (step 6). **Order is load-bearing. It was WRONG until 2026-07-10** | `server.js:3714` — the comment now says *"ORDER MATTERS"* |
| **4** | **`MAX_CONSECUTIVE_LOSSES` has THREE different values**: code default **5** (`execution-engine.js:77`), `.env` **8**, `.env.example` **3** | measured |
| **5** | **`CAPITAL_TOTAL` has TWO different hardcoded defaults**: engines use `\|\| 100000`; **`server.js:2961, 3002, 6349` use `\|\| 500000`** — including **`GET /api/risk`** | measured |

> **Conflict #5 is latent, not live** — `CAPITAL_TOTAL` *is* set in `.env`, so no divergence occurs
> today. **But if it were ever unset, `/api/risk` would report a ₹500,000 account while the engine
> traded a ₹100,000 one.** Two defaults for one balance.

---

# SECTION 3 — CONFIGURATION OWNERSHIP MATRIX

| Item | Source of truth | Single owner? | Validation point | Persistence | Mutation policy |
|---|---|---|---|---|---|
| **`CAPITAL_TOTAL`** | 🔴 **AMBIGUOUS** — `.env` **and** `config-overrides.json` **and** `equity-state.json` | 🔴 **NO — 3 sources, 6 write sites** | **NONE** | 3 files | 🔴 **HTTP-mutable** |
| **`MAX_DAILY_LOSS_PERCENT`** | 🔴 **`config-overrides.json` (not `.env`, despite appearances)** | 🔴 **NO** | **NONE** | JSON | 🔴 **HTTP-mutable** |
| **`MAX_CONSECUTIVE_LOSSES`** | `.env` (**8**) | 🟡 but the code default is **5** and the example says **3** | **NONE** | — | env only |
| **`MAX_DRAWDOWN_PERCENT`** | 🔴 **a hardcoded default — it is in NO config file** | 🔴 **NO OWNER** | **NONE** | — | — |
| **`TRADE_MODE`** | `.env` = `paper` | 🟢 **YES** | 🟢 compared to `'paper'` | **deliberately NOT persisted** | 🟢 **Every boot starts in paper** |
| **`AUTO_TRADE_ENABLED`** | `.env` | 🔴 **NO — overridden per-instrument, then by config-overrides** | **NONE** | JSON | 🔴 HTTP-mutable |
| **`<INST>_AUTO_ENABLED`** | `.env` | 🔴 **NO — `config-overrides.<INST>_DIRECTIONAL_AUTO` wins** | **NONE** | JSON | 🔴 HTTP-mutable |
| **`CHARGE_*` rates** | 🔴 **hardcoded defaults; in NO config file** | 🔴 **NO OWNER — and the values are DISPUTED (E1)** | **NONE** | — | — |
| **`AUTH_SECRET`** | `.env` (absent) → **hardcoded fallback** | 🔴 **NO** | **NONE** | — | — |
| **Lot size** | `instrument-registry.js` | 🟢 **YES** — fail-closed | 🟢 **YES** | frozen | env-overridable | **🔴 …but `server.js` hardcodes `65` ×3 and defeats it** |
| **Charges structure** | `charges.js` | 🟢 **YES** | — | — | — |

## Hidden owners

| Item | Apparent owner | **Actual owner** |
|---|---|---|
| The daily-loss brake | `.env` | **`data/config-overrides.json`, written by an HTTP handler** |
| SENSEX auto-trading | `.env` | **`data/config-overrides.json`, applied at `server.js:7288`** |
| The account balance | `equity-state.json` | 🔴 **Until 2026-07-10: whichever loader ran last** |
| 68% of all settings | a config file | **A literal inside a `.js` file** |

---

# SECTION 4 — FEATURE FLAG CATALOGUE

**15 flags.** *(Runtime-mutable = writable via HTTP + persisted to `config-overrides.json`.)*

| Flag | Purpose | Code default | `.env` | **config-overrides** | **LIVE** | Runtime-mutable | Risk if enabled | Safe default |
|---|---|---|---|---|---|---|---|---|
| **`TRADE_MODE`** | paper vs live | `'paper'` | **`paper`** | **deliberately absent** | **paper** | via API | 🔴 **REAL MONEY** | 🟢 **`paper` — and it is** |
| **`AUTO_TRADE_ENABLED`** | global auto | — | `true` | — | — | — | HIGH | `false` |
| **`SENSEX_AUTO_ENABLED`** | SENSEX auto | — | 🔴 **`false`** | 🔴 **`SENSEX_DIRECTIONAL_AUTO: true`** | 🔴 **`true`** | ✅ | HIGH | `false` |
| **`NIFTY_AUTO_ENABLED`** | NIFTY auto | `'true'` | — | **`NIFTY_DIRECTIONAL_AUTO: true`** | `true` | ✅ | 🔴 **HIGH — this strategy is MEASURED at PF 0.94 (no edge)** | `false` |
| **`STRANGLE_ENGINE_ENABLED`** | short strangle | `'false'` | — | **`true`** | `true` | ✅ | 🔴 **HIGH — measured `FAIL (likely overfit)` after the 002 fix** | `false` |
| **`GAMMA_BLAST_ENGINE_ENABLED`** | expiry buying | `'false'` | — | **`true`** | `true` | ✅ | MEDIUM — **honestly declared not backtestable** | `false` |
| **`AI_AGENTS_ENABLED`** | 5-agent pipeline | 🔴 **`'true'`** | — | `true` | `true` | ✅ | MEDIUM | 🔴 **defaults ON, in no config file** |
| **`BOUNCE_ENGINE_ENABLED`** | bounce engine | `'false'` | `true`? | **`true`** | `true` | ✅ | MEDIUM | `false` |
| **`AFTERNOON_ENABLED`** | 2nd session | `'false'` | SET | `SENSEX/NIFTY_AFTERNOON_AUTO: true` | `true` | ✅ | MEDIUM | `false` |
| **`AGENTS_SELL_ENABLED`** | agent selling | `'true'` | — | — | `true` | ❌ | MEDIUM | `false` |
| **`SIGNAL_PAPER_ENABLED`** | paper signals | `'true'` | — | — | `true` | ❌ | 🟢 LOW | ok |
| **`POP_LIVE_ENABLED`** | PoP live | compared to `'true'` | — | — | off | ❌ | HIGH | `false` |
| **`AUTH_ENABLED`** | JWT/RBAC | 🔴 **`'false'`** | — | — | **off** | ❌ | 🔴 **Default posture = ALLOW.** 000-E mandates DENY | `true` |
| **`CLAUDE_AI_ENABLED`** | LLM calls | compared to `'true'` | SET | — | — | ❌ | LOW (cost) | — |
| **`TREND_GATE_ENABLED`** | trend filter | `'false'` | SET | — | — | ❌ | LOW | — |
| **`DHAN_WS_ENABLED`** | websocket feed | 🔴 **UNKNOWN** | SET | — | — | ❌ | LOW | **UNKNOWN** |

### Flag findings

| | |
|---|---|
| 🔴 **Conflicting** | **`SENSEX_AUTO_ENABLED=false` in `.env` is silently defeated by `SENSEX_DIRECTIONAL_AUTO=true` in `config-overrides.json`.** Two flags, two files, two names, **one concern** — and the *safer* one loses |
| 🔴 **Conflicting** | `AUTO_TRADE_ENABLED` (global) vs `<INST>_AUTO_ENABLED` (per-instrument) vs `<INST>_DIRECTIONAL_AUTO` (overrides). **Three layers, one decision** |
| 🔴 **Hidden** | **`AI_AGENTS_ENABLED` defaults to `true` and appears in no `.env`.** The agents run because a literal in `agents-engine.js` says so |
| 🔴 **Unsafe default** | **`AUTH_ENABLED` defaults to `false`.** 000-E: *"Default posture: DENY."* This is ALLOW |
| 🔴 **Risk mismatch** | **`STRANGLE_ENGINE_ENABLED: true` and `NIFTY_DIRECTIONAL_AUTO: true`** — both strategies are now **measured to have no edge** (002 §0.1: `FAIL (likely overfit)`; PF 0.94). **Nothing in the config knows that.** *(003 §3.6: this is why a `StrategyRegistry` with a maturity level is a boundary, not a comment)* |
| 🟢 **Correct** | **`TRADE_MODE` is deliberately NOT persisted.** `server.js:7286` — *"a restored AUTO ON can never re-arm LIVE."* **This is the single best configuration decision in the codebase** |
| ⚪ **UNKNOWN** | `DHAN_WS_ENABLED` — no default could be determined by static analysis |

### Genuinely dead flags/vars in `.env` — **9** *(corrected — see §12)*

```
EXCHANGE · HF_TOKEN · NODE_ENV · OPTION_SYMBOL · SYMBOL
TELEGRAM_BOT_TOKEN · TELEGRAM_CHAT_ID · TELEGRAM_ENABLED · UPSTOX_ACCOUNT_ID
```

🔴 **`NODE_ENV` is never read.** There is **no development/production distinction anywhere.**
🟡 **`TELEGRAM_*` × 3** — an entire notification channel, configured and wired to nothing.

### Undocumented — in `.env` but **not** in `.env.example`: **11**

```
BANKNIFTY_MAX_PREMIUM · BANKNIFTY_MIN_PREMIUM · EXCHANGE · HF_TOKEN
NIFTY_MAX_PREMIUM · NIFTY_MIN_PREMIUM · OPTION_SYMBOL
SENSEX_MAX_PREMIUM · SENSEX_MIN_PREMIUM · SYMBOL · UPSTOX_ACCOUNT_ID
```

---

# SECTION 5 — RUNTIME MUTATION REPORT

## 5a. `process.env` mutated at runtime — **4 sites**

| Site | What | Why | Persisted? | Sync? | Recovery |
|---|---|---|---|---|---|
| `server.js:7` | `DHAN_ACCESS_TOKEN` normalised | Boot hygiene | no | — | — |
| **`server.js:2031`** | `DHAN_ACCESS_TOKEN = cleanToken` | OAuth callback | 🔴 **YES — rewrites `.env` NON-ATOMICALLY (B-6)** | ❌ | 🔴 **NONE — no `.bak`** |
| `live-connector.js:116-117` | `DHAN_CLIENT_ID`, `DHAN_ACCESS_TOKEN` | Reconnect | no | ❌ | — |

## 5b. `config-overrides.json` mutated at runtime — **3 writers**

| Writer | Atomic? | Refuses on corrupt? |
|---|---|---|
| `server.js:3581` (P1-T1, gamma-blast) | 🟢 **YES** — `safe-write` + `.bak` | 🟢 YES |
| `server.js:3688` (P1-T2, engine override) | 🟢 **YES** — `safe-write` + `.bak` | 🟢 YES |
| 🔴 **`server.js:3773`** (P1-T3, strategy config) | 🔴 **NO — raw `fs.writeFileSync`** | 🔴 **NO** | *(package written)* |

## Operational risk assessment

> 🔴 **The daily-loss brake, the account balance, and every engine's auto flag are all mutable over
> HTTP, with no authentication (`AUTH_ENABLED` defaults off), no audit trail, and no versioning.**
>
> **A single unauthenticated `POST` can raise the daily-loss limit and enable a halted engine, and the
> only record of it is a `console.log` in an unstructured terminal buffer.**

---

# SECTION 6 — VALIDATION ASSESSMENT

| Check | Present? | Evidence |
|---|---|---|
| **Schema validation library** | 🔴 **NONE** | No `zod`/`joi`/`envalid`/`convict`/`ajv` in `package.json` |
| **Missing-variable check at boot** | 🔴 **NONE** | `boot throws on missing config: false`. **107 variables silently fall back to a literal** |
| **Type validation** | 🔴 **NONE** | `parseFloat(process.env.X \|\| 2)` — `X="abc"` yields `NaN`, not a refusal |
| **Range checks** | 🟡 **PARTIAL** | `server.js:3731` defines `{ min: 10000, max: 100000000 }` for `CAPITAL_TOTAL` — **but only for the UI slider, not for the loader** |
| **Enum validation** | 🟡 **PARTIAL** | `TRADE_MODE` is compared to `'paper'`. Anything else = live-ish. **No enum is declared** |
| **File existence** | 🟡 | `safe-write.readJsonSync` handles a missing file |
| **Path validation** | 🟢 | No path is built from user input (001-C §10) |
| **Duplicate values** | 🔴 | **`CAPITAL_TOTAL` has two different hardcoded defaults (100000 / 500000)**; `MAX_CONSECUTIVE_LOSSES` has three (5 / 8 / 3) |

## 🔴 The rule this violates

**000-A: *"Unknown ≠ Zero. Refuse rather than guess."***
**000-E: *"Critical validation failure must prevent startup."***

```js
execution-engine.js:76   this.maxDailyLossPct = parseFloat(process.env.MAX_DAILY_LOSS_PERCENT || 2) / 100;
```

If `MAX_DAILY_LOSS_PERCENT` is **misspelled, deleted, or set to `"two"`**, this does **not** fail.
It **silently arms the risk brake at a value nobody chose.** The same pattern appears **107 times.**

> **`process.exit()` appears twice in `server.js`. Neither is a configuration check** — one is a
> crash-loop guard (`:75`), the other is the shutdown path (`:7321`). **The platform will boot with no
> configuration at all.**

---

# SECTION 7 — PERSISTENCE ASSESSMENT

| File | Atomic | `.bak` | Corruption handling | Recovery | Rollback |
|---|---|---|---|---|---|
| **`config-overrides.json`** | 🟡 **2 of 3 writers** | 🟡 2 of 3 | 🟡 2 of 3 **refuse and leave the file untouched** | 🟡 partial | via `.bak` |
| 🔴 **`.env`** | 🔴 **NO** (`server.js:2028`) | 🔴 **NO** | 🔴 **NONE** | 🔴 **NONE** | 🔴 **NONE** |
| `confluence-weights.json` | 🟢 | 🟢 `.bak` present on disk | 🟢 | 🟢 | 🟢 |
| `equity-state.json` | 🟢 `safe-write` | 🟢 | 🟢 **fail-closed (C3-07)** | 🟢 | 🟢 |

## 🔴 The `.env` failure mode, stated exactly

`fs.writeFileSync` **truncates, then writes.** Between those two syscalls the file is **empty**.

**`.env` holds every broker credential.** A crash, a full disk or a power cut in that window leaves it
**truncated with no backup**, and **every credential is gone at the next boot.**

**`safe-write.js` already exports `writeFileAtomicSync` for exactly this.** `server.js` already imports
`safe-write` at four other lines. **The tool is present, imported, and not used on the one file whose
loss ends the platform's access to the account.** *(B-6 — package written, awaiting approval.)*

---

# SECTION 8 — SAFETY ASSESSMENT

| 000-E requirement | Verdict | Evidence |
|---|---|---|
| **Fails closed** | 🔴 **NO** | 107 variables silently fall back. `MAX_DAILY_LOSS_PERCENT` misspelt ⇒ the brake arms at a value nobody chose |
| **Has explicit defaults** | 🟡 **They exist. They are not explicit** | They are literals inside `||` expressions in 81 files. **Two of them disagree with each other** |
| **Rejects corruption** | 🟡 **2 of 3 JSON writers do. `.env` does not** | — |
| **Prevents unsafe startup** | 🔴 **NO** | **The platform boots with zero configuration.** No validation gate exists |
| **Supports recovery** | 🟡 | `.bak` for JSON. 🔴 **None for `.env`** |
| 🟢 **`TRADE_MODE` never persists to live** | 🟢 **YES** | `server.js:7286`. **The one thing this configuration system gets unambiguously right** |

### Safety score: **2 / 6**

---

# SECTION 9 — OBSERVABILITY

| | Verdict |
|---|---|
| **Logged?** | 🟡 **11 `[config]` log lines in `server.js`** — unstructured `console.log`, ephemeral |
| **Auditable?** | 🔴 **NO.** No record of *who* changed *what*, *when*, or *from where* |
| **Traceable?** | 🔴 **NO.** A `POST` that doubles the daily-loss limit leaves no durable trace |
| **Versioned?** | 🔴 **NO.** `config-overrides.json` is overwritten in place. The `.bak` holds exactly **one** prior version |
| **Exposed over HTTP?** | 🔴 **`/api/m/config` is one of the 11 surfaces `module-contract.js` builds — and it returns 404** because `mountAll()` is never called |

> **The single most safety-relevant number in the platform — the daily-loss brake — can be changed by
> an unauthenticated HTTP request, and the only evidence it ever happened is a line in a terminal
> scrollback.**

---

# SECTION 10 — CONFIGURATION RISK REGISTER

| ID | Risk | Sev | Evidence | Impact | Likelihood | Owner | Mitigation *(conceptual)* |
|---|---|---|---|---|---|---|---|
| **C-01** | 🔴 **`.env` is a decoy. `config-overrides.json` silently wins — including for the RISK BRAKE and a SAFETY FLAG** | **CRITICAL** | `.env`: `MAX_DAILY_LOSS_PERCENT=2`, `SENSEX_AUTO_ENABLED=false`. **LIVE: `riskPct: 5`, `autoEnabled: true`** | **An operator's mental model of the risk limits is wrong, and nothing corrects it** | **CERTAIN — it is true right now** | **NONE** | One source of truth. If a runtime override exists, **it must be logged at boot as an override, loudly** |
| **C-02** | 🔴 **`CAPITAL_TOTAL` — a BALANCE — lives in a SETTINGS file and is HTTP-writable** | **CRITICAL** | `execution-engine.js:113` — `setConfig()` writes it onto `this.capital` | **It overwrote the account balance at every boot until 2026-07-10.** The boot-order fix treats the symptom | **CERTAIN** | **NONE** | **A balance is not a setting.** It belongs to `AccountLedger`, and **configuration must not be able to write it** *(003 §3.1)* |
| **C-03** | 🔴 **NO startup validation. 107 vars silently fall back to a literal** | **CRITICAL** | No schema dependency. `boot throws: false` | A misspelt risk parameter **arms a brake at a value nobody chose** | HIGH | **NONE** | Schema-validate at boot. **Fail closed. Refuse to start** (000-E) |
| **C-04** | 🔴 **`.env` written non-atomically from an HTTP handler** | **HIGH** | `server.js:2028` | **Total, unrecoverable credential loss** | MEDIUM | **OWNER** | `safe-write.writeFileAtomicSync` *(B-6 — package written)* |
| **C-05** | 🔴 **The risk brake and every auto flag are HTTP-mutable with no auth, no audit, no versioning** | **HIGH** | `AUTH_ENABLED` defaults **off**; 0 of 172 routes carry auth middleware | An unauthenticated `POST` can raise the loss limit and enable a halted engine | MEDIUM *(local-only)* | **NONE** | Auth on mutating routes + an append-only audit log |
| **C-06** | 🔴 **`MAX_CONSECUTIVE_LOSSES` has three different values** (code **5**, `.env` **8**, example **3**) | **HIGH** | measured | **Nobody knows what the consecutive-loss brake actually is without running the server** | CERTAIN | **NONE** | One default, one place |
| **C-07** | 🔴 **`CAPITAL_TOTAL` has two different hardcoded defaults — 100000 (engines) and 500000 (`/api/risk`)** | **MEDIUM** | `server.js:2961, 3002, 6349` | **Latent.** If ever unset, `/api/risk` reports a ₹5L account while the engine trades a ₹1L one | LOW *(it is set)* | **NONE** | One default |
| **C-08** | 🔴 **Disputed charge rates (E1) are hardcoded defaults in no config file** | **HIGH** | `charges.js:17` `\|\| 0.1`, `:19` `\|\| 0.03503` | **Both are believed wrong in opposite directions and cancel to ≈ −0.33%, so the total LOOKS right** | CERTAIN | **NONE** | **BLOCKED — needs the exchange circular. DO NOT GUESS** |
| **C-09** | 🔴 **`AUTH_ENABLED` defaults to `false` ⇒ default posture is ALLOW** | **HIGH** | `auth.js` | 000-E mandates **DENY** | CERTAIN | **NONE** | Default to DENY; opt out explicitly |
| **C-10** | 🟡 **`AI_AGENTS_ENABLED` defaults to `true` and is in no config file** | MEDIUM | `agents-engine.js` | **Agents run because a literal says so.** Nobody chose it | CERTAIN | — | Every flag must be declared |
| **C-11** | 🟡 **Three-layer flag system with three different names for one decision** | MEDIUM | `AUTO_TRADE_ENABLED` / `<INST>_AUTO_ENABLED` / `<INST>_DIRECTIONAL_AUTO` | **The safest setting loses** | CERTAIN | — | One flag, one name |
| **C-12** | 🟡 **Strategies with NO validated edge are enabled in config** | MEDIUM | `STRANGLE_ENGINE_ENABLED: true` (**now measures `FAIL (likely overfit)`**), `NIFTY_DIRECTIONAL_AUTO: true` (**PF 0.94**) | **The config does not know a strategy is invalidated** | CERTAIN | — | `StrategyRegistry` with a maturity gate *(003 §3.6)* |
| **C-13** | 🟡 **9 dead vars; `NODE_ENV` never read** | LOW | measured | **No dev/prod distinction exists anywhere** | CERTAIN | — | Delete or wire |
| **C-14** | 🟡 **`config-overrides.json` — 1 of 3 writers is still raw** | MEDIUM | `server.js:3773` | Corruption | LOW | **OWNER** | *(P1-T3 — package written)* |
| **C-15** | ⚪ **`DHAN_WS_ENABLED` default is UNKNOWN** | **UNKNOWN** | Static analysis could not determine it | — | — | — | **Read `live-connector.js` by hand.** Recorded as UNKNOWN, not guessed |

---

# SECTION 11 — TARGET CONFIGURATION GOVERNANCE BLUEPRINT

*(Conceptual only. No implementation.)*

## 11.1 Single source of truth

```
  SECRETS          .env            ← credentials ONLY. Never a setting. Never a balance.
       │                             Written by NOTHING at runtime except via safe-write.
       ▼
  SETTINGS         config/*.json   ← declarative, schema-validated, VERSION-CONTROLLED
       │                             The ONLY place a setting is declared.
       ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │  Config  (frozen after boot)                                     │
  │    · schema-validated                                            │
  │    · FAILS CLOSED — an unknown or invalid value REFUSES to start │
  │    · every effective value is LOGGED at boot, with its source    │
  │    · Object.freeze() — no runtime mutation, ever                 │
  └──────────────────────────────────────────────────────────────────┘
       │
       ▼
  OPERATIONAL STATE   ← NOT configuration. A separate, owned thing.
       · account balance     → AccountLedger   (a BALANCE is not a SETTING)
       · halt state          → the engine       (and it survives a restart)
       · learned weights     → the learner
       · engine on/off       → EngineRegistry, append-only audit log
```

## 11.2 The four rules

| # | Rule | Which risk it kills |
|---|---|---|
| **R-1** | **A setting has exactly ONE source. If an override exists, the boot log must announce it, loudly, as an override — naming the file, the key, the base value and the effective value** | **C-01, C-06, C-07, C-11** |
| **R-2** | **A BALANCE is not a SETTING.** `CAPITAL_TOTAL` must not be writable from a configuration path | **C-02** |
| **R-3** | **Configuration FAILS CLOSED.** An unknown, missing or mistyped value **prevents startup** (000-E) | **C-03, C-08** |
| **R-4** | **Every mutating configuration route requires auth and writes an append-only audit record** | **C-05, C-09** |

## 11.3 Feature flag governance

| Requirement | Why |
|---|---|
| Every flag is **declared** — name, purpose, owner, default, risk | 🔴 `AI_AGENTS_ENABLED` is in no file and defaults ON |
| **Safe default = OFF.** A flag that defaults ON must carry a written justification | 🔴 `AUTH_ENABLED` defaults to ALLOW |
| **One flag, one decision, one name** | 🔴 Three names for "may this engine trade?" |
| **A strategy below maturity Level 3 may not be enabled outside paper mode** | 🔴 Two strategies with **no validated edge** are enabled today |
| **`TRADE_MODE` never persists to live** | 🟢 **Already true. Keep it. It is the best rule in the system** |

## 11.4 Boot-time output the platform should print (and does not)

```
[config] MAX_DAILY_LOSS_PERCENT = 5   (.env said 2 — OVERRIDDEN by data/config-overrides.json)
[config] SENSEX_AUTO_ENABLED    = true (.env said false — OVERRIDDEN by data/config-overrides.json)
[config] CAPITAL_TOTAL          = 88011 (restored balance; config value 100000 IGNORED — a balance is not a setting)
[config] 107 settings using a hardcoded default. Run `npm run config:report` to list them.
```

> **Every line above is TRUE of the running system today. None of them is printed.**

---

# SECTION 12 — CORRECTIONS TO MY OWN MEASUREMENTS (Rule Zero)

| My finding | Reality | How it was caught |
|---|---|---|
| **"16 dead variables in `.env`"** — including `SENSEX_AUTO_ENABLED` and the six `*_PREMIUM` vars | 🔴 **WRONG. 9, not 16.** Seven of them are read **dynamically**: `process.env[\`${inst}_AUTO_ENABLED\`]` (`execution-engine.js:69`) and `process.env[\`${inst}_MAX_PREMIUM\`]` (`afternoon-engine.js:121`). **My grep searched for literal `process.env.NAME` and could not see a computed key** | Read `execution-engine.js:66-73` by hand |
| **"`SENSEX_AUTO_ENABLED` is a dead flag"** | 🔴 **WRONG — and the truth is worse.** It is read, it says `false`, **and the engine is running with `autoEnabled: true` anyway.** It is not dead. **It is overridden and ignored** | Queried the live server |

> **Had I trusted my own harness, this report would have said "a safety flag is dead code" when the
> real finding is "a safety flag is being silently overridden on a live system."**
> **The first is a cleanup task. The second is C-01 — the headline of this audit.**

---

# SECTION 13 — STOP CONDITIONS DECLARED

| Question | Status |
|---|---|
| **What is `DHAN_WS_ENABLED`'s default?** | ⚪ **UNKNOWN.** Static analysis could not determine it. **Requires reading `live-connector.js` by hand. Not guessed** |
| **What are the correct STT / exchange-transaction rates?** | ⚪ **UNKNOWN — BLOCKED (E1).** Both current values are believed wrong **in opposite directions** and cancel to ≈ −0.33%, **so the total looks right.** **Needs the exchange circular. DO NOT GUESS** |
| Which of the 107 hardcoded defaults were deliberate, and which are accidents? | ⚪ **UNKNOWN.** **No ADR exists for any of them.** *(003 Phase 1: ADR-001)* |

---

# SUCCESS CRITERION

> *"An independent engineer should understand exactly where every configuration value comes from, who
> owns it, who may change it, how it is validated, how it is persisted, and how it is recovered."*

**They can now — and the answer is uncomfortable:**

| Question | Answer |
|---|---|
| **Where does a value come from?** | **68% of the time, a literal in a `.js` file.** The rest: `.env`, then silently overridden by `data/config-overrides.json` |
| **Who owns it?** | 🔴 **For the risk brake, the account balance, the charge rates and the auto flags: NOBODY** |
| **Who may change it?** | 🔴 **Anyone with HTTP access. There is no auth by default** |
| **How is it validated?** | 🔴 **It is not. There is no schema, and the platform will boot with no configuration at all** |
| **How is it persisted?** | 🟡 JSON: atomically, by 2 of 3 writers. 🔴 **`.env`: non-atomically, from an HTTP handler, with no backup** |
| **How is it recovered?** | 🟡 JSON: from a `.bak`. 🔴 **`.env`: it is not** |

---

**Configuration modified: NONE. Loaders rewritten: NONE. Files changed: NONE. Suite: 48/48.**

**Deliverables:** Configuration Inventory (§1) · Load Order Diagram (§2) · Ownership Matrix (§3) ·
Feature Flag Catalogue (§4) · Runtime Mutation Report (§5) · Validation Assessment (§6) · Persistence
Assessment (§7) · Safety Assessment (§8) · Observability (§9) · Configuration Risk Register (§10) ·
Target Governance Blueprint (§11).
