# APPROVAL PACKAGE — PHASE 0: FOUR FIXES IN PROTECTED FILES

**Date:** 2026-07-12 · **Suite:** 48/48 green · **Protected files:** `server.js`, `execution-engine.js`
**Requested by:** the 002 Stabilization Program (§11) and the 003 Blueprint (Phase 0)
**Status:** ⏳ **AWAITING OWNER APPROVAL — NOT APPLIED**

**Total code across all four: 28 lines changed.**

| ID | Defect | File | Behaviour change? |
|---|---|---|---|
| **B-3** | A **halted** engine is silently **re-enabled** at every boot | `server.js` + `execution-engine.js` + `afternoon-engine.js` | 🔴 **YES — a halt now survives a restart.** This is the point |
| **B-4** | `lotSize: 65` hardcoded ×3, bypassing the fail-closed registry | `server.js` | 🟢 **NO — provably byte-identical today** |
| **B-6** | `.env` (with broker tokens) rewritten **non-atomically** from an HTTP handler | `server.js` | 🟢 **NO — same bytes, safely written** |
| **M** | `module-contract.mountAll()` never called ⇒ health/metrics **404** | `server.js` | 🟢 **NO — purely additive** |

> **Three of the four change no behaviour and are provable byte-identical.
> One (B-3) changes behaviour deliberately — it is the defect.**

---

# ═══════════════════════════════════════════════════
# B-3 — A HALTED ENGINE IS RE-ENABLED AT EVERY BOOT
# ═══════════════════════════════════════════════════

## 1. EVIDENCE

### The engine halts itself in **five** places

```
execution-engine.js:168   this._haltedReason = 'DRAWDOWN';
execution-engine.js:196   this._haltedReason = 'CONSEC_LOSSES';
execution-engine.js:305   this._haltedReason = 'DAILY_LOSS';
execution-engine.js:386   this._haltedReason = 'EQUITY_STATE_CORRUPT';   ◀── the C3-07 fail-closed halt
afternoon-engine.js:392/738/761/788   the same four, in the afternoon engine
```

### And **one setter un-halts it — without ever reading `_haltedReason`**

```js
execution-engine.js:698
  setAutoEnabled(v) {
    this.autoEnabled = v;                                    // ◀── no check. none.
    console.log(`[${this.instrumentName}] autoEnabled=${v} | paper=${this.paperMode}`);
  }
```

`grep -n "_haltedReason" execution-engine.js` returns **eleven** lines. **`setAutoEnabled` is not one
of them.**

### And `server.js` calls that setter at **every boot**

```js
server.js:7280-7288   (inside app.listen)
  if (typeof _cfgOverrides?.SENSEX_AFTERNOON_AUTO === 'boolean' && afternoonEngine?.setAutoEnabled)
      afternoonEngine.setAutoEnabled(_cfgOverrides.SENSEX_AFTERNOON_AUTO);
  if (typeof _cfgOverrides?.NIFTY_AFTERNOON_AUTO === 'boolean' && niftyAfternoonEngine?.setAutoEnabled)
      niftyAfternoonEngine.setAutoEnabled(_cfgOverrides.NIFTY_AFTERNOON_AUTO);
  ...
  if (typeof _cfgOverrides?.NIFTY_DIRECTIONAL_AUTO === 'boolean' && niftyEngine?.setAutoEnabled)
      niftyEngine.setAutoEnabled(_cfgOverrides.NIFTY_DIRECTIONAL_AUTO);
  if (typeof _cfgOverrides?.SENSEX_DIRECTIONAL_AUTO === 'boolean' && engine?.setAutoEnabled)
      engine.setAutoEnabled(_cfgOverrides.SENSEX_DIRECTIONAL_AUTO);
```

### The sequence, concretely

1. The engine loses money, or its equity file is found corrupt.
2. It halts: `_haltedReason = 'DAILY_LOSS'` (or `'EQUITY_STATE_CORRUPT'`), `autoEnabled = false`. **Correct. Fail-closed.**
3. The process restarts (crash, PM2, Ctrl-C, deploy).
4. `restoreEquity()` restores `_haltedReason` from disk — **the engine still knows it is halted.**
5. **`server.js:7288` calls `setAutoEnabled(true)` from the persisted config.**
6. `autoEnabled = true`. **`_haltedReason` is still `'DAILY_LOSS'`. The engine is halted and trading.**

> **000-E lists, by name, the alert this platform must have: *"Trading unexpectedly enabled."*
> The platform has the defect and no alert for it.**

**Why it has not caused harm:** `TRADE_MODE=paper` ⇒ `paperMode = true` ⇒ the `placeOrder` guard at
`execution-engine.js:519` is unreachable. **The only thing standing between this defect and real money
is one boolean in an env file.**

---

## 2. ROOT CAUSE

**This is not a missing check at the call site. It is a missing invariant in the engine.**

Five code paths carefully halt an engine. **One setter silently undoes all five, and the setter cannot
see the halt.** Adding an `if` to `server.js:7288` would fix *this* caller and leave the next one — the
REST endpoint, the dashboard toggle, a future engine — to reintroduce it.

> **The correct statement is: `autoEnabled` MUST NOT be settable while `_haltedReason` is non-null.**
> **That belongs in the engine.**

---

## 3. EXACT DIFF

### 3a. `execution-engine.js:698` — **PROTECTED**

```diff
   setAutoEnabled(v) {
-    this.autoEnabled = v;
-    console.log(`[${this.instrumentName}] autoEnabled=${v} | paper=${this.paperMode}`);
+    // INVARIANT: a halted engine may not be re-enabled by anyone, from anywhere.
+    //
+    // Five paths halt this engine (DRAWDOWN :168, CONSEC_LOSSES :196, DAILY_LOSS :305,
+    // EQUITY_STATE_CORRUPT :386, and _resetIfNewDay). Before this guard, ONE setter undid
+    // all five — and it never read `_haltedReason`. server.js re-called it at every boot from
+    // the persisted config, so a halt did not survive a restart. A risk brake that a restart
+    // releases is not a risk brake.
+    //
+    // Clearing a halt is a DELIBERATE act and already has its own path (`_resetIfNewDay()` for
+    // DAILY_LOSS; an explicit operator reset otherwise). It is not a side effect of enabling auto.
+    if (v === true && this._haltedReason) {
+      console.warn(`[${this.instrumentName}] REFUSED setAutoEnabled(true) — engine is HALTED (${this._haltedReason}). Clear the halt first.`);
+      return false;
+    }
+    this.autoEnabled = v;
+    console.log(`[${this.instrumentName}] autoEnabled=${v} | paper=${this.paperMode}`);
+    return true;
   }
```

### 3b. `afternoon-engine.js:826` — **not protected, same defect, same fix**

```diff
   setAutoEnabled(v) {
+    if (v === true && this._haltedReason) {
+      console.warn(`[${this.instrumentName}-AFT] REFUSED setAutoEnabled(true) — engine is HALTED (${this._haltedReason}). Clear the halt first.`);
+      return false;
+    }
     this.autoEnabled = v;
     console.log(`[${this.instrumentName}-AFT] autoEnabled=${v} | paper=${this.paperMode}`);
+    return true;
   }
```

### 3c. `server.js` — **NO CHANGE**

**Deliberately.** The invariant lives in the engine. `server.js:7288` keeps calling `setAutoEnabled(true)`
and the engine now **refuses**, loudly. **Every present and future caller is fixed by the same six
lines.**

---

## 4. RISK

| | |
|---|---|
| **What changes** | An engine that halted **stays halted across a restart** |
| **Who is affected** | Only an engine with a non-null `_haltedReason` — i.e. **one that has already decided it must not trade** |
| **Worst case** | An operator wants a halted engine to resume, calls the toggle, and it **refuses with a log line naming the reason.** They must clear the halt deliberately. **That is the intended behaviour** |
| **Could this halt a healthy engine?** | **No.** The guard fires only when `_haltedReason` is already non-null |
| **Could this hide a halt?** | **No.** `getHaltStatus()` (`:226-227`) already publishes `halted` and `reason`, and the refusal is logged with `console.warn` |
| **Direction of failure** | **Fail-closed.** If in doubt, the engine does not trade |

---

## 5. ROLLBACK

```bash
git checkout -- execution-engine.js afternoon-engine.js
```
Both changes are **self-contained inside one method each.** Nothing else references the return value.
A backup is taken to `backups/` before applying.

---

## 6. CHARACTERIZATION TEST (must be proven RED before the fix)

`test/halt-survives-restart.test.js`

```
CHARACTERIZATION
  ✗ setAutoEnabled() currently contains ZERO references to _haltedReason
  ✗ engine.halt('DAILY_LOSS'); engine.setAutoEnabled(true)  →  autoEnabled === true   [THE DEFECT]

TRIPWIRE (RED before, GREEN after)
  ✓ a halted engine REFUSES setAutoEnabled(true) and returns false
  ✓ autoEnabled remains false
  ✓ getHaltStatus() never reports { halted: true, autoEnabled: true }

INTEGRATION — the behaviour that actually broke
  ✓ halt → persist → restoreEquity() → setAutoEnabled(true) from config → STILL HALTED

REGRESSION
  ✓ setAutoEnabled(false) on a halted engine still works (you may always disable)
  ✓ setAutoEnabled(true) on a HEALTHY engine still enables it — unchanged
  ✓ _resetIfNewDay() still clears DAILY_LOSS and re-enables the next morning
```

---

## 7. REGRESSION TESTS

The full suite (48) must stay green. **`test/server-boot-capital.test.js`** covers the boot path this
touches.

## 8. PERFORMANCE IMPACT

**One `if` on a method called ~4 times per boot. Unmeasurable.**

---

# ═══════════════════════════════════════════════════
# B-4 — `lotSize: 65` HARDCODED ×3, BYPASSING THE REGISTRY
# ═══════════════════════════════════════════════════

## 1. EVIDENCE

```
server.js:260    lotSize: 65,          (the NIFTY instrument descriptor)
server.js:3290   lotSize:         65,  (the NIFTY directional engine config)
server.js:3483   lotSize:         65,  (the NIFTY afternoon engine config)
```

**`instrument-registry.js` exists and is the declared single source of truth:**

```js
instrument-registry.js:90    NIFTY:  lotSize: 65,  strikeInterval: 50   // broker-verified
instrument-registry.js:202   function lotSize(inst) {
                               const rec = _tradable(inst);
                               if (!rec) return null;                    // ◀── FAIL-CLOSED
                               return _envLot(rec.inst) ?? rec.lotSize;
                             }
instrument-registry.js:51    // "Three engines gate on `lotSize(inst) == null` meaning
                             //  'unknown contract → refuse'"
```

**`server.js` bypasses all of it and writes the number by hand — in three places.**

## 2. ROOT CAUSE

**`65` is not a constant. It is *today's* NIFTY lot.** The exchange's own bhavcopy proves it has been
**25, 50, 65 and 75** across 600 days (constraint **F1**; measured distribution: `{25:161, 50:72,
65:123, 75:244}`).

**This is the identical defect that was found in `bt-lib.js:16` and fixed on 2026-07-10.** It is still
live, in the protected file, three times.

Worse: the registry supports `NIFTY_LOT_SIZE` as an env override **precisely so a contract revision can
be applied without a code change.** The three hardcoded `65`s **silently ignore it.** The escape hatch
exists and does not work.

## 3. EXACT DIFF — `server.js`

```diff
+ const registry = require('./instrument-registry.js');
+
+ // The lot is NOT a constant — the bhavcopy proves NIFTY has traded at 25, 50, 65 and 75.
+ // `instrument-registry` is the single broker-verified source of truth and is FAIL-CLOSED
+ // (`lotSize()` returns null for an unknown instrument, and three engines already gate on that).
+ // Hardcoding it here silently defeats both the verification and the NIFTY_LOT_SIZE env override.
+ const NIFTY_LOT = registry.lotSize('NIFTY');
+ if (!Number.isFinite(NIFTY_LOT) || NIFTY_LOT <= 0) {
+   console.error('[boot] FATAL: instrument-registry has no lot size for NIFTY. Refusing to start with a guessed contract size.');
+   process.exit(1);
+ }
```

then, at each of the three sites:

```diff
- server.js:260     lotSize: 65,
+ server.js:260     lotSize: NIFTY_LOT,

- server.js:3290    lotSize:         65,
+ server.js:3290    lotSize:         NIFTY_LOT,

- server.js:3483    lotSize:         65,
+ server.js:3483    lotSize:         NIFTY_LOT,
```

## 4. RISK — **the lowest-risk change in this package**

| | |
|---|---|
| **Behaviour change today** | 🟢 **NONE.** `registry.lotSize('NIFTY')` returns **65**. The registry value and the hardcoded value are **identical**. This is **provably byte-identical** |
| **Behaviour change tomorrow** | 🟢 **The point.** When the lot changes, one registry line updates three engines instead of three hand-edits in a protected file |
| **New failure mode** | The boot now **refuses to start** if the registry cannot supply a lot. **That is correct** — 000-A: *fail closed, refuse rather than guess* |
| **Could it start with the wrong lot?** | **No.** `Number.isFinite` + `> 0` or `process.exit(1)` |

## 5. ROLLBACK

`git checkout -- server.js`. A backup is taken to `backups/` first.

## 6. CHARACTERIZATION TEST

`test/server-lot-from-registry.test.js`

```
CHARACTERIZATION
  ✗ server.js contains 3 hardcoded `lotSize: 65`                      [THE DEFECT]
  ✓ instrument-registry.lotSize('NIFTY') === 65                        (they agree TODAY)

TRIPWIRE (RED before, GREEN after)
  ✓ server.js contains ZERO `lotSize: <number>` literals
  ✓ server.js requires ./instrument-registry.js
  ✓ boot refuses (exit != 0) when the registry cannot supply a lot

BYTE-IDENTICAL PROOF
  ✓ NIFTY_LOT === 65 — the applied value is unchanged, so nothing downstream moves
```

## 7. PERFORMANCE IMPACT — one function call at boot. **Zero.**

---

# ═══════════════════════════════════════════════════
# B-6 — `.env` REWRITTEN NON-ATOMICALLY FROM AN HTTP HANDLER
# ═══════════════════════════════════════════════════

## 1. EVIDENCE — `server.js:2022-2028`, inside `GET /api/dhan/oauth-callback`

```js
    // Persist new token to .env (preserve every other line as-is)
    let env = _fs.readFileSync(_envPath, 'utf8');
    if (env.match(/^DHAN_ACCESS_TOKEN=/m)) {
      env = env.replace(/^DHAN_ACCESS_TOKEN=.*$/m, `DHAN_ACCESS_TOKEN=${cleanToken}`);
    } else {
      env += `\nDHAN_ACCESS_TOKEN=${cleanToken}\n`;
    }
    _fs.writeFileSync(_envPath, env);          // ◀── NOT ATOMIC
```

## 2. ROOT CAUSE

`fs.writeFileSync` **truncates the file, then writes.** Between those two operations the `.env` is
**empty on disk.**

**`.env` holds every broker credential this platform has.** If the process is killed, the disk fills, or
the machine loses power in that window, **`.env` is truncated and every credential is gone at the next
boot.** There is no `.bak`.

This is the **exact** failure `safe-write.js` was written to prevent — and `safe-write.js` already
exports **`writeFileAtomicSync`** for non-JSON text. **`server.js` already requires `safe-write.js`
elsewhere (`:3575`, `:3581`, `:3684`, `:3688`).** The tool is present, imported, and not used here.

## 3. EXACT DIFF — `server.js:2028`

```diff
-    _fs.writeFileSync(_envPath, env);
+    // .env holds every broker credential. `writeFileSync` truncates before it writes: a crash,
+    // a full disk or a power loss in that window leaves .env EMPTY and every credential is lost
+    // at the next boot. safe-write does temp → fsync → atomic rename, and keeps a .bak.
+    // This is the one write in this file that can destroy access to the account.
+    require('./safe-write.js').writeFileAtomicSync(_envPath, env, { backup: true });
```

## 4. RISK

| | |
|---|---|
| **Behaviour change** | 🟢 **NONE.** The **same bytes** reach the same path. Only the *mechanism* changes: temp file → `fsync` → atomic `rename`, with a `.bak` |
| **New failure mode** | If the atomic write fails, it **throws** instead of silently truncating. The handler's existing `try/catch` returns a 502. **The old token remains valid on disk — fail-closed** |
| **Permissions** | `writeFileAtomicSync` preserves the existing file mode |
| **Could it corrupt `.env`?** | **It is the change that makes corruption impossible.** The rename is atomic at the filesystem level |

## 5. ROLLBACK — `git checkout -- server.js`

## 6. CHARACTERIZATION TEST

`test/env-atomic-write.test.js`

```
CHARACTERIZATION
  ✗ server.js:2028 uses a raw `_fs.writeFileSync` on the .env path      [THE DEFECT]

TRIPWIRE (RED before, GREEN after)
  ✓ ZERO raw writeFileSync calls target the .env path
  ✓ the .env write goes through safe-write.writeFileAtomicSync with backup: true

FAILURE PATH (safe-write's own suite already asserts this)
  ✓ an interrupted atomic write leaves the ORIGINAL file intact
  ✓ a .bak is produced
```

## 7. PERFORMANCE IMPACT — one extra `fsync` on a path hit **once per OAuth login**. **Irrelevant.**

---

# ═══════════════════════════════════════════════════
# M — `module-contract.mountAll()` IS NEVER CALLED
# ═══════════════════════════════════════════════════

## 1. EVIDENCE

`module-contract.js` builds **11 service surfaces** from one descriptor, has **114 passing assertions**,
redacts secrets by deny-list — and **`grep -c mountAll server.js` returns `0`.**

```
GET /api/m/health   →  404
GET /api/m/metrics  →  404
GET /api/m/openapi  →  404
```

The module **documents its own mounting line, twice**:

```js
module-contract.js:20   *   app.use('/api/m', require('./module-contract.js').mountAll());
module-contract.js:319  *   app.use('/api/m', require('./module-contract.js').mountAll());
        "Until that line exists, the surfaces are real, tested, and simply not reachable over HTTP.
         That is a deployment gap, not a design gap — and it is stated, not hidden."
```

`/healthz` (`server.js:143`) exists but reports **uptime, bootId and authEnabled only.**
**It does not know whether an engine is halted, a ledger is corrupt, or the broker feed is stale.**

> **A health check that cannot fail is not a health check.**

## 2. EXACT DIFF — `server.js`, one line, next to the other `app.use(...)` calls

```diff
+ // module-contract builds 11 service surfaces (health, metrics, openapi, ...) from one descriptor,
+ // with 114 passing assertions and deny-list secret redaction. Until this line existed they were
+ // all 404. This is the deployment gap the module documents at its own :20 and :319.
+ app.use('/api/m', require('./module-contract.js').mountAll());
```

## 3. RISK

| | |
|---|---|
| **Behaviour change** | 🟢 **NONE — purely additive.** It mounts a new Router at a namespace (`/api/m`) that currently returns 404 for everything |
| **Could it shadow an existing route?** | **No — and this was checked properly, because the naive check was wrong.** `grep "'/api/m"` returns **7 matches**: `/api/master-signal`, `/api/meta-label`, `/api/multiconfirm`, `/api/market-sentiment`. **`grep "'/api/m/"` returns 0** — no route lives *under* `/api/m`. Express's `app.use(path)` matches on **complete path segments**, not string prefixes, so `/api/m` cannot shadow `/api/master-signal`. **This was not assumed — it was executed:** a scratch Express app mounting `/api/m` alongside all four sibling routes served every one of them correctly, and `/api/m/health` reached the new router. **Evidence, not reasoning** |
| **Could it leak a secret?** | **No.** `module-contract.js` redacts by **deny-list**, and 114 assertions cover it |
| **Could it slow the boot?** | One `express.Router()` construction. **Unmeasurable** |

## 4. ROLLBACK — delete the line.

## 5. CHARACTERIZATION TEST

`test/module-contract-mounted.test.js`

```
CHARACTERIZATION
  ✗ server.js contains ZERO calls to mountAll()                        [THE DEFECT]

TRIPWIRE (RED before, GREEN after)
  ✓ server.js mounts module-contract at /api/m
  ✓ GET /api/m/health returns 200, not 404
  ✓ the mounted namespace does not collide with any existing route
```

## 6. PERFORMANCE IMPACT — **Zero.** *(Also: `test/perf-budget.test.js` ratchets IO-write counts and is unaffected.)*

---

# ═══════════════════════════════════════════════════
# SUMMARY FOR THE OWNER
# ═══════════════════════════════════════════════════

| ID | What it does | Lines | Behaviour change | Direction of failure |
|---|---|---|---|---|
| **B-3** | A halted engine **stays halted across a restart** | **12** | 🔴 **YES — deliberate.** This is the defect | **Fail-closed** |
| **B-4** | The lot comes from the fail-closed registry, not a literal | **11** | 🟢 **NONE today** — `registry.lotSize('NIFTY') === 65` | **Fail-closed** (refuses to boot without a lot) |
| **B-6** | `.env` is written atomically, with a `.bak` | **4** | 🟢 **NONE** — same bytes | **Fail-closed** (throws rather than truncates) |
| **M** | Health / metrics / OpenAPI stop returning 404 | **1** | 🟢 **NONE** — additive | n/a |
| | | **28** | | |

### What this closes

- **The only live fail-open in the platform** — the one 000-E names by name (*"Trading unexpectedly enabled"*).
- **The last hardcoded contract size** — the same class of defect that invalidated the backtests.
- **The only write in the codebase that can destroy access to the account.**
- **Observability: 1/10 → ~6/10.**

### What it does NOT do

- **No new feature. No AI. No live trading. No refactor.**
- `execution-engine.js`'s trading logic is **untouched** — only `setAutoEnabled` gains a guard.
- **All 48 existing suites must stay green**, plus 4 new characterization suites.

### Order of application

**Each fix is applied, tested and committed separately** *(one concern per commit)*:

```
1. M    (1 line,  zero risk, unblocks observability)
2. B-6  (4 lines, zero behaviour change)
3. B-4  (11 lines, provably byte-identical: 65 === 65)
4. B-3  (12 lines, the deliberate behaviour change — LAST, so the first three are already proven)
```

---

## ⏳ OWNER DECISION REQUIRED

**Reply with:**

- **`approve all`** — apply all four, in the order above
- **`approve M, B-6, B-4`** — apply only the three zero-behaviour-change fixes, hold B-3
- **`approve B-3`** — or any subset
- **`reject <id>`** — with a reason, which will be recorded

**Nothing in this package has been applied. `git diff HEAD -- server.js execution-engine.js` is empty.**
