# 005 — STATE OWNERSHIP, PERSISTENCE & RECOVERY ARCHITECTURE

**Standard:** Master Prompt 005 · **Depends on:** 000-A…E, 001-A…F, 002, 003, 004
**Date:** 2026-07-12 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No implementation modified. No persistence logic changed. Zero files touched.**

**Method.** A harness measured every file in `data/`, every writer, every recovery path — **and the
results were checked against the LIVE running server (`:3000`).** That check found a **critical live
defect** and **refuted one of my own long-standing claims.** Both are below.

---

# ═══════════════════════════════════════════════════
# SECTION 0 — 🔴 LIVE CRITICAL: AN ENGINE IS TRADING PAST ITS OWN RISK BRAKE
# ═══════════════════════════════════════════════════

**Queried from the running process, not inferred:**

```json
GET /api/nifty/engine/status
{
  "instrument": "NIFTY",  "autoEnabled": true,  "capital": 96761,
  "halt": {
      "halted": false,          ◀── 🔴
      "reason": null,           ◀── 🔴
      "consecLosses": 15,       ◀── 🔴 FIFTEEN
      "maxConsecLosses": 8,     ◀── against a limit of EIGHT
      "autoEnabled": true       ◀── 🔴 and it is armed
  }
}
```

**The NIFTY engine has 15 consecutive losses against a limit of 8. It is not halted. It is enabled.**
*(SENSEX, for contrast, reads `2 / 8` — correct.)*

## Root cause — **THREE independent defects compose**

### S-01 — **The halt state is never persisted. At all.**

```js
execution-engine.js:181     writeJsonSync(file, {
                              capital: this.capital,
                              reserve: this.reserve,
                              consecLosses: this._consecLosses,
                              updatedAt: new Date().toISOString()
                            }, { pretty: true, backup: true });
                            //  ◀── `_haltedReason` IS NOT IN THE SCHEMA
```

```js
execution-engine.js:381-383  if (Number.isFinite(s.capital))      this.capital       = s.capital;
                             if (Number.isFinite(s.reserve))      this.reserve       = s.reserve;
                             if (Number.isFinite(s.consecLosses)) this._consecLosses = s.consecLosses;
                             //  ◀── `_haltedReason` IS NEVER RESTORED, because it was never SAVED
```

> **NO HALT SURVIVES A RESTART. EVER.**
> Not `DAILY_LOSS`, not `DRAWDOWN`, not `CONSEC_LOSSES`, not `EQUITY_STATE_CORRUPT`.
> The engine carefully computes a halt, writes the *loss counter* to disk, and **throws the halt away.**

### S-02 — **The halt is an EDGE trigger, never a LEVEL check**

```js
execution-engine.js:193-198   this._consecLosses += 1;
                              if (this._consecLosses >= this.maxConsecLosses) {
                                this._haltedReason = 'CONSEC_LOSSES';
                                this.autoEnabled = false;
                              }
```

**This block only executes inside the `else` branch of a closed losing trade.** Nothing re-evaluates the
invariant at boot, on a tick, or anywhere else. A restored `consecLosses: 15` therefore **sits above the
threshold indefinitely and the brake never re-arms.**

### B-3 — `setAutoEnabled(true)` at boot *(already known; package written)*

`server.js:7288` re-enables the engine from `config-overrides.json` at every boot.

## 🔴 **MY PENDING APPROVAL PACKAGE IS INCOMPLETE. I must say so.**

`docs/APPROVAL-PHASE0-four-fixes.md` proposes guarding `setAutoEnabled(v)` with
`if (v === true && this._haltedReason) refuse`.

> **That guard would NOT have fired here.**
>
> Because of **S-01**, `_haltedReason` is `null` after every restart — **the guard has nothing to
> guard against.** NIFTY would still read `halted: false, autoEnabled: true, consecLosses: 15`.
>
> **B-3 alone does not fix this. The package must be widened to cover S-01 and S-02.**
> *(This is exactly what a characterization test written against the LIVE system catches, and what a
> test written against my own mental model would have missed.)*

## The complete fix requires all three

| | Fix | Where |
|---|---|---|
| **S-01** | Persist `haltedReason` in the equity schema; restore it | `execution-engine.js:181`, `:381` **(PROTECTED)** |
| **S-02** | Re-evaluate the halt invariant **after** `restoreEquity()` — a level check, not an edge trigger | `execution-engine.js` **(PROTECTED)** |
| **B-3** | `setAutoEnabled(true)` refuses while `_haltedReason` is non-null | `execution-engine.js:698` **(PROTECTED)** |

**Severity: CRITICAL.** Contained today **only** by `TRADE_MODE=paper`.

---

# ═══════════════════════════════════════════════════
# SECTION 1 — 🔴 RETRACTION: THE "openPosition RACE" DOES NOT EXIST
# ═══════════════════════════════════════════════════

**I asserted an `openPosition` authority race in FOUR documents** — 001-B (A-05), 001-F (§6), 002 (B-10)
and 003 (§5) — describing it as *"a timer tick and an HTTP handler write the same slot, with an `await`
between the guard and the write,"* impact *"double-entry or lost position."*

**I never verified it. It is false.**

| Claim | Measured |
|---|---|
| *"The engine's timer tick writes `server.js`'s `openPosition` global"* | 🔴 **FALSE.** `grep -c openPosition execution-engine.js` → **0**. `afternoon-engine.js` → **0**. **The engines do not reference these globals at all** |
| *"There is an `await` between the guard and the write"* | 🔴 **FALSE.** `POST /api/position/enter` (`:2825`) and `POST /api/nifty/position/enter` (`:3029`) are **synchronous handlers**. `POST /api/position/exit` (`:2910`) is `async`, but **the guard (`:2911`) and `openPosition = null` (`:2926`) are in one uninterrupted synchronous block.** Node's single thread makes it **atomic** |
| *"Double-entry or lost position"* | 🔴 **NOT SUPPORTED** |

## What IS real — a **downgraded**, different defect

`GET /api/position` (`server.js:2854`) **is** `async`, and it **does** dereference `openPosition` across
an `await`:

```js
:2855   if (!openPosition) return res.json({ open: false, ... });     // guard
:2860   const spot  = await getLivePrice();                            // ◀── yield point
:2861   const chain = await getChainAroundATM(spot, null, 15);         // ◀── yield point
:2862   const row = chain.strikes.find(s => Number(s.strike) === Number(openPosition.strike));
        //                                                             ◀── inside try{}catch — SAFE
:2869   updateAutomaticMovingStop(openPosition, currentPrice, {...});
        //  ◀── OUTSIDE the try. If a concurrent exit nulled openPosition during the await,
        //      this is an unhandled null dereference → HTTP 500 on a read endpoint.
```

| | |
|---|---|
| **Real severity** | **MEDIUM** — a possible 500 on a status endpoint |
| **NOT** | a lost update, a double entry, or a corrupted position |
| **My published severity** | **HIGH, "double-entry or lost position"** |

> **I over-stated a defect by two severity levels and propagated it across four documents without ever
> reading the handler. Rule Zero exists to prevent exactly this, and I broke it.**
> **All four documents must be corrected. This section is the correction of record.**

---

# PART 1 — RUNTIME STATE INVENTORY

**51 JSON files in `data/`. 7 have a `.bak`.**

| State | Purpose | **Owner** | Writers | Readers | Lifetime | Persistence | Recovery | Conf |
|---|---|---|---|---|---|---|---|---|
| **Capital / equity** | The account | 🔴 **NONE — 3 modules** | `execution-engine:54,113,381` · `afternoon-engine:80,782` · `strangle-engine:82` | risk brake, sizing, `/api/risk`, UI | process | `equity-<inst>.json` **[SAFE + `.bak`]** | 🟢 **fail-closed on corrupt (C3-07)** | HIGH |
| 🔴 **Halt / risk state** | The brake | engine | 5 halt paths, **1 un-halt setter** | tick, API | process | 🔴 **NOT PERSISTED (S-01)** | 🔴 **NONE — the halt is lost at every restart** | **HIGH** |
| **consecLosses** | Loss streak | engine | `:191,193,207,383` | halt check | process | `equity-<inst>.json` | 🟡 restored — **but the halt it implies is not re-evaluated (S-02)** | HIGH |
| **Positions (engine)** | Open trade | the engine | engine | engine | process | `equity`/`trades` | 🟡 | HIGH |
| **Positions (manual)** | 6 globals in `server.js` | 🔴 **`server.js`** | `:2833, :2926, :3045, :3104, :7075` | 5 routes | process | 🔴 **NOT PERSISTED** | 🔴 **A manual position is LOST on restart** | HIGH |
| **Portfolio / NAV** | — | 🔴 **DOES NOT EXIST** | — | — | — | — | — | HIGH |
| **Margin** | — | 🔴 **DOES NOT EXIST** — SPAN is not captured | — | — | — | — | — | HIGH |
| **P&L** | Realised | engine + `closedPositions[]` | engine | reports | process | `trades.json`, `eod-*.json` | 🟡 | HIGH |
| **Strategy state** | Engine on/off | 🔴 **`config-overrides.json` (HTTP-mutable)** | 3 writers (**1 raw**) | boot | persistent | JSON | 🟡 2 of 3 atomic | HIGH |
| **Configuration** | Settings | 🔴 **CONTESTED** | 3 | all | persistent | JSON + `.env` | 🔴 **`.env` non-atomic** | HIGH |
| **Market state** | ORB/H/L/VWAP | `server.js` | `_persistMarketState()` ×3 | routes | daily | `market-state.json` **[MIXED]** | 🟡 date-guarded | HIGH |
| **Session state** | `todayDate`, date guards | `server.js` | 5 globals | — | daily | partial | 🟡 | MEDIUM |
| **Timers** | 14 `setInterval` | 🔴 **NOBODY** | — | — | process | n/a | 🔴 **0 `clearInterval`** | HIGH |
| **Statistics** | Learned weights | `confluence-learner.js` | 1 | scoring | persistent | `confluence-weights.json` **[SAFE + `.bak`]** | 🟢 | HIGH |
| **AI state** | Agent ledger | `agents-engine.js` | 1 | agents | persistent | 3 files **[SAFE + `.bak`]** | 🟢 | HIGH |
| **EOD snapshots** | 19 daily files | `server.js:4255` | 1 | reports | permanent | 🔴 **RAW `_fs2.writeFileSync`, no `.bak`** | 🔴 **NONE** | HIGH |
| **AmiBroker signals** | 233 KB, largest file | `consolidate-ami-signals.js` | 1 | bridge | permanent | 🔴 **RAW, no `.bak`** | 🔴 **NONE** | HIGH |

---

# PART 2 — OWNERSHIP AUDIT

| State | Single | Multiple | Unknown |
|---|---|---|---|
| Capital | | 🔴 **3 modules, 6 sites** | |
| **Halt state** | 🟡 engine owns it… | | 🔴 **…but nothing persists it (S-01)** |
| Manual positions | 🔴 `server.js` | | |
| Portfolio / Risk / Margin | | | 🔴 **DO NOT EXIST** |
| Configuration | | 🔴 **3 writers** | |
| Timers | | | 🔴 **NOBODY** |
| Learned weights | 🟢 `confluence-learner` | | |
| AI ledger | 🟢 `agents-engine` | | |
| Storage | 🟢 `safe-write` | | |

### Hidden ownership
- **The halt is owned by whoever restarts the process** — because it is never written down (S-01).
- **The account balance was owned by load order** until 2026-07-10 (004 C-02).

### Circular ownership: **NONE FOUND.** *(001-B: zero dependency cycles.)*

---

# PART 3 — LIFECYCLE

```
 CREATE   engine constructor  → capital = env.CAPITAL_TOTAL || 100000
              ↓                  _haltedReason = null            ◀── and it stays null forever
 INIT     _loadConfigOverrides() → setConfig() → capital OVERWRITTEN by a settings file
              ↓
          restoreEquity()      → capital ✓  reserve ✓  consecLosses ✓
              ↓                  _haltedReason ✗  🔴 S-01
          setAutoEnabled(true) → 🔴 B-3
              ↓                  🔴 NO LEVEL CHECK. consecLosses 15 > 8 is never re-examined. S-02
 MUTATE   tick → trade closes → consecLosses++ → halt check (EDGE ONLY)
              ↓
 PERSIST  saveEquity() → safe-write + .bak  🟢   (but the halt is not in the payload)
              ↓
 RECOVER  corrupt file → EQUITY_STATE_CORRUPT → halt  🟢 fail-closed
              ↓                                        …until the next restart drops it. 🔴
 DELETE   never. 19 eod-*.json accumulate. No retention policy.
```

## Unexpected transitions — **all three confirmed**

| # | Transition | Should be |
|---|---|---|
| **1** | **`HALTED → RUNNING` on restart** | impossible |
| **2** | **A restored `consecLosses` above the limit → `RUNNING`** | impossible |
| **3** | `restored balance → overwritten by a config file` *(fixed 2026-07-10; the shape remains)* | impossible |

---

# PART 4 — PERSISTENCE ASSESSMENT

| Mechanism | Count | Atomic | `.bak` | Reparse-validated | Corrupt → refuse |
|---|---|---|---|---|---|
| **`safe-write` (`[SAFE]`)** | **18 modules** | 🟢 | 🟢 | 🟢 | 🟢 |
| **`[MIXED]`** — `server.js` and others use both | several | 🟡 | 🟡 | 🟡 | 🟡 |
| 🔴 **`[RAW]` `fs.writeFileSync`** | `eod-*.json` (`server.js:4255`) · `ami-signals-all.json` · `config-overrides.json` (`:3773`) · `signal-paper-positions.json` (`:5885`) · `.env` (`:2028`) | 🔴 | 🔴 | 🔴 | 🔴 |

**Files with a `.bak` on disk: 7 of 51.**

### `safe-write.js` — the mechanism, verified by reading it

```js
safe-write.js:111   if (opts.backup && existed) fs.copyFileSync(file, file + '.bak');
safe-write.js:123   if (doFsync) fs.fsyncSync(fd);      // contents on disk BEFORE the rename
safe-write.js:130   fs.renameSync(tmp, file);           // ◀── the atomic step
safe-write.js:147   // the serialized text is parsed back BEFORE the rename
```

🟢 **This is correct.** temp → fsync → validate-by-reparse → atomic rename → `.bak`. **It is the best
module in the repository.** Its problem is that **five production paths still route around it.**

### 🟡 Note — the equity files have **no `.bak` on disk**

`equity-nifty.json` and `equity-sensex.json` are written with `backup: true`, yet no `.bak` exists.
Their `updatedAt` is **2026-07-09**, and `safe-write` only creates a `.bak` **when the file already
existed at write time**. **Most likely explanation: no trade has closed since, so `saveEquity()` has not
run.** ⚪ **Recorded as PLAUSIBLE, not confirmed** — the measurement that settles it is to close one
paper trade and check whether a `.bak` appears.

### Version compatibility: **NONE.** No schema version field in any state file. **Adding `haltedReason` (S-01) must therefore treat its absence as "unknown" — and, per 000-A, an unknown halt state must mean the brake is ON.**

---

# PART 5 — RECOVERY ASSESSMENT

| Scenario | Behaviour | Verdict |
|---|---|---|
| **Missing equity file** | `if (!_fs.existsSync(file)) return;` → keeps the env baseline | 🟡 **Silently starts at ₹100,000.** No warning that the account is unknown |
| **Corrupt equity file** | `catch` → `_haltedReason = 'EQUITY_STATE_CORRUPT'` + `autoEnabled = false` | 🟢 **EXEMPLARY — fail-closed (C3-07).** *"Cannot know the loss streak — HALTING"* |
| **…but then the process restarts** | 🔴 **The halt is gone (S-01)** | 🔴 **The C3-07 guarantee lasts exactly one process lifetime** |
| **Stale equity file (> 30 days)** | keeps the baseline, logs it | 🟢 Correct |
| **Partial write** | Impossible via `safe-write` | 🟢 |
| **Partial write via a RAW writer** | 🔴 **Truncation.** `.env`, `eod-*`, `ami-signals-all` | 🔴 |
| **Interrupted shutdown** | 🔴 **RACE.** `_gracefulShutdown` performs **10 writes**, then `setTimeout(exit, 400)`, **with 0 `clearInterval` against 14 live timers** | 🔴 **The EOD snapshot is a read taken while 14 writers are still running** |
| **Manual positions on restart** | 🔴 **Silently lost.** The 6 globals are never persisted | 🔴 |

## Recovery guarantees — **stated honestly**

| | |
|---|---|
| 🟢 **GUARANTEED** | A file written by `safe-write` is never torn. A corrupt read is detected and refused |
| 🟡 **PARTIAL** | Capital and `consecLosses` survive a restart |
| 🔴 **NOT GUARANTEED** | **The halt.** **Manual positions.** **Any file written raw.** **The EOD snapshot's consistency** |

---

# PART 6 — CONSISTENCY REPORT

| Risk | Verdict | Evidence |
|---|---|---|
| **Lost update on a position slot** | 🟢 **NOT PRESENT** *(RETRACTED — §1)* | The enter/exit handlers are synchronous between guard and write |
| **Stale read / null-deref across an `await`** | 🟡 **PRESENT** | `GET /api/position:2869` — dereferences `openPosition` after two `await`s, outside the `try` |
| **Concurrent config writes** | 🟡 | `safe-write.withLock` exists (`:245`) — **used by `safe-write` internally**, not by the raw writers |
| **Shutdown write race** | 🔴 **PRESENT** | 14 timers, 0 `clearInterval`, 400 ms exit delay, 10 writes |
| **`_signalPaperBusy`** | 🟡 | The **only** ad-hoc mutex in `server.js` — guards **one** of six slots |
| **Read/write ordering at boot** | 🔴 **LOAD-BEARING** | Fixed 2026-07-10. The fragility remains (004 C-02) |

---

# PART 7 — OBSERVABILITY

| | Verdict |
|---|---|
| **State changes logged?** | 🟡 `console.log` only. **Unstructured, ephemeral** |
| **Auditable?** | 🔴 **NO.** No record of who changed the capital, the halt or a flag |
| **Traceable?** | 🔴 **NO.** `EventEmitter` in **1** module. No event bus |
| **Versioned?** | 🔴 **NO.** One `.bak` = one prior version |
| **A halt is visible?** | 🟡 `getHaltStatus()` publishes it — **and it currently, truthfully, reports `halted: false, consecLosses: 15`.** **The API is honest. The state is wrong** |

---

# PART 8 — ARCHITECTURE (conceptual — no code)

```
   AccountLedger  ★  THE SINGLE OWNER OF CAPITAL
      · balance is moved ONLY by a Fill or a MarkToMarket. There is no setter.
      · Configuration MUST NOT be able to write it.               (004 C-02)

   RiskState      ★  THE SINGLE OWNER OF THE HALT
      · haltedReason IS PERSISTED, with the counter that caused it.       (S-01)
      · The invariant is RE-EVALUATED AFTER RESTORE — a LEVEL check, not an edge. (S-02)
      · autoEnabled is NOT SETTABLE while haltedReason is non-null.       (B-3)
      · An ABSENT haltedReason field in an old file means UNKNOWN ⇒ BRAKE ON.

   PositionBook   ★  positions are persisted, or they are declared ephemeral. Not silently lost.

   safe-write     🟢 ALREADY CORRECT — make it the ONLY door.

   Scheduler      ★  registers all 14 timers ⇒ clearInterval becomes possible ⇒
                     the EOD snapshot becomes a real snapshot.
```

### The single rule that would have prevented S-01

> **If a piece of state can stop trading, it MUST be persisted, and its absence MUST mean "stopped".**

---

# PART 9 — TESTING STRATEGY

| Test | Priority | Why |
|---|---|---|
| 🔴 **`halt → persist → restart → STILL HALTED`** | **P0** | **This is the test that does not exist, and its absence is S-01.** It is the single highest-value test in the repository |
| 🔴 **`restore(consecLosses ≥ max) → engine is HALTED at boot`** | **P0** | S-02. **Would fail against the live system right now** |
| **`setAutoEnabled(true)` on a halted engine → REFUSED** | **P0** | B-3 |
| **An equity file with NO `haltedReason` field → treated as UNKNOWN ⇒ brake ON** | **P0** | Forward-compatibility for the S-01 fix. *Unknown ≠ safe* |
| Corrupt equity → `EQUITY_STATE_CORRUPT` → halt | ✅ **exists** | C3-07 |
| `safe-write`: interrupted write leaves the original intact | ✅ **exists** | |
| Concurrent `GET /api/position` + `POST /exit` → no 500 | P1 | §1, the *real* (downgraded) defect |
| Shutdown clears all 14 timers before the snapshot | P1 | |
| Manual position survives a restart, **or the API says it will not** | P2 | |

---

# PART 10 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE — this document** | — | none | Every state has a documented owner |
| **2 — Ownership** | 🔴 **WIDEN the Phase-0 package to S-01 + S-02 + B-3.** ADR-003: *what is the halt invariant?* | The corrected package | **Behaviour change: a halt now survives a restart. THAT IS THE POINT** | `halt → restart → still halted` passes |
| **3 — Persistence isolation** | Route the 5 remaining raw writers through `safe-write` | Phase 2 | Low | 0 raw production writes |
| **4 — Recovery validation** | `Scheduler` → `clearInterval` → a real EOD snapshot. Persist or declare-ephemeral the manual positions | Phase 3 | Medium | Every recovery guarantee in Part 5 is 🟢 or explicitly declared |

---

# PART 11 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every critical state has one owner | 🔴 **NO** — capital 3, halt "whoever restarts", timers nobody |
| Persistence is deterministic | 🟡 **18 modules yes. 5 raw writers no** |
| Recovery is reproducible | 🔴 **NO** — **the halt does not survive a restart** |
| Corruption is detectable | 🟢 **YES** — `safe-write` + C3-07. **The best-engineered guarantee in the platform** |
| Startup behaviour is predictable | 🔴 **NO** — load order is load-bearing; the halt silently vanishes |
| Restart behaviour is validated | 🔴 **NO** — **no restart test exists, which is why S-01 shipped** |
| Critical mutations are observable | 🔴 **NO** — no audit trail |

## **State management maturity: 1 of 7. NOT MATURE.**

---

# EXECUTIVE SUMMARY

**The question this audit was asked to answer, for every critical state: *"What happens if it is lost?"***

**For the halt state, the answer is: it is lost at every single restart, and nobody noticed until a live
query showed an engine running at 15 consecutive losses against a limit of 8.**

`safe-write.js` is genuinely excellent — atomic, validated, backed-up, fail-closed, with tested restore.
**It is protecting the wrong field.** It faithfully persists `capital`, `reserve` and `consecLosses`,
and the one thing that says *"do not trade"* was never put in the payload.

> **A risk brake that a restart releases is not a risk brake. It is a log line.**

**And this audit corrected its own author:** the `openPosition` race I asserted in four documents does
not exist. **I published a HIGH-severity claim four times without reading the handler.** The real defect
in that area is a possible 500 on a read endpoint — two severity levels lower.

**The discipline works. It only works when it is actually applied — including to me.**

---

**Implementation modified: NONE. Persistence logic changed: NONE. Suite: 48/48.**

**Deliverables:** Runtime State Inventory (Part 1) · Ownership Matrix (Part 2) · Lifecycle (Part 3) ·
Persistence Assessment (Part 4) · Recovery Assessment (Part 5) · Consistency Report (Part 6) ·
State Risk Register (§0, §1, Part 5) · Architecture Blueprint (Part 8) · Testing Strategy (Part 9) ·
Migration Roadmap (Part 10) · Executive Summary.
