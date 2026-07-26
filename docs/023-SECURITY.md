# 023 — SECURITY, AUTHENTICATION, AUTHORIZATION & SECRETS GOVERNANCE

**Standard:** Master Prompt 023 · **Depends on:** 000-A … 022
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No penetration testing. No vulnerability exploited. No security control modified.**

---

# SECTION 0 — THE FINDING

## 🔴 §0.1 — **THE ONLY CREDENTIAL GUARDING A BROKER-REACHING ROUTE IS THE STRING `antigravity`**

**`POST /api/webhook/tradingview` (`server.js:7045`) reaches `live.placeOrder(...)` at `server.js:7110`.
It is the platform's only externally-triggerable path to a broker. This is its complete authentication:**

```js
server.js:7049   const key = body.key || req.headers['x-api-key'];
server.js:7050   const expectedKey = process.env.AMIBROKER_API_KEY || 'antigravity';
server.js:7051   if (key !== expectedKey) {
server.js:7052     console.warn('[webhook/tv] Rejected — bad key');
server.js:7053     return res.status(401).json({ error: 'unauthorized' });
                 }
```

**Measured, from the live `.env`:**

```
  AMIBROKER_API_KEY is set    : true
  length                      : 11
  EQUALS the hardcoded default "antigravity"?   *** YES ***
```

**And that value is published in three places in the repository:**

```
.env.example:44            AMIBROKER_API_KEY=antigravity
server.js:7050             process.env.AMIBROKER_API_KEY || 'antigravity'
amibroker-bridge.js:23     config.apiKey || process.env.AMIBROKER_API_KEY || 'antigravity'
```

### Three defects in five lines

| # | Defect |
|---|---|
| **1** | 🔴 **The live key is the documented example value.** It is in `.env.example`, and hardcoded as a fallback in two source files. **It is not a secret. It is a placeholder that was never replaced** |
| **2** | 🔴 **A hardcoded credential fallback.** Even with `.env` deleted, the route still authenticates — against `'antigravity'`. **There is no state in which this route is closed** |
| **3** | 🔴 **`key !== expectedKey` is a non-constant-time comparison.** Timing-attackable. **And `auth.js:47` in the same repository uses `crypto.timingSafeEqual` correctly** |

---

## 🔴 §0.2 — **THE SERVER LISTENS ON EVERY INTERFACE, AND SEVEN PRIVILEGED ROUTES ARE UNAUTHENTICATED**

```js
server.js:7254   app.listen(PORT, '0.0.0.0', ...)      // ◀── ALL interfaces. NOT localhost.
```

**Measured: `0` of `172` routes carry authentication middleware.**

| Unauthenticated privileged route | What it can do |
|---|---|
| **`POST /api/risk/emergency-stop`** | Disable the trading engines |
| **`POST /api/engine/reset`** | 🔴 **CLEAR A TRADING HALT** — the manual reset that exists precisely because a halt is supposed to require human review |
| **`POST /api/engine/config`** | 🔴 **Change `CAPITAL_TOTAL` and `MAX_DAILY_LOSS_PERCENT`** — **double the daily-loss limit over plain HTTP** |
| **`POST /api/webhook/tradingview`** | Open a paper position · **fire `TV_EXIT` on an open one** (`server.js:7075`) · reach `placeOrder` in live mode |
| **`POST /api/position/enter`** | Open a position |
| **`POST /api/trade/execute`** | Execute a trade |
| **`GET /api/dhan/oauth-callback`** | 🔴 **REWRITE `.env`** — non-atomically, with broker tokens *(B-6)* |

## What mitigates this today — and only this

```
.env:109   TRADE_MODE=paper
```

**Paper mode. Nothing else.** The webhook's `placeOrder` sits behind `tradeMode === 'live'` *(012 §1 —
and that guard is intact)*. **But every route above still works, unauthenticated, from any host on the
network, right now.**

> **An unauthenticated `POST` from anywhere on the LAN can clear a trading halt, double the daily-loss
> limit, and open or close positions — and the only reason it cannot reach a broker is one string in a
> `.env` file.**

---

## 🔴 §0.3 — **AND `auth.js` DOES IT ALL CORRECTLY, GUARDING ZERO ROUTES**

```js
auth.js:37   const sig = b64u(crypto.createHmac('sha256', SECRET).update(data).digest());
auth.js:47   if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;   // ◀── CONSTANT-TIME
auth.js:49   if (body.exp && now > body.exp) return null;                               // ◀── EXPIRY CHECKED
auth.js:28   const ROLE_RANK = { viewer: 1, trader: 2, admin: 3 };                      // ◀── RBAC
auth.js:22   if (ENABLED && !SECRET) { SECRET = crypto.randomBytes(48)... }             // ◀── FAIL-CLOSED
```

**HMAC-SHA256. Constant-time signature comparison. Token expiry. Role-based ranks. And when enabled
without a secret, it refuses to run with an empty key and generates an ephemeral one, loudly.**

**This is correct, professional, defensively-written authentication code.**

```js
server.js:105   const auth = require('./auth');
```

**It is imported. And:**

```
routes guarded by auth.requireAuth / auth.requireRole  :  0
AUTH_ENABLED default                                   :  'false'
```

> ## **The platform contains a correct authentication layer, imports it, defaults it OFF, and guards ZERO of its 172 routes with it.**
>
> **Meanwhile the one route that can reach a broker is protected by a non-constant-time comparison
> against the literal string `antigravity`.**
>
> **This is the same pattern as `engine-verdict.js`, `module-contract.js`, `bt-validate.js`,
> `position-sizer.js` and the append-only `.jsonl` writer: the correct thing is BUILT, it is IMPORTED,
> and it is NOT USED.**

---

# PART 1 — SECURITY INVENTORY

| Component | Present? | Owner | Confidence |
|---|---|---|---|
| **Authentication** | 🟢 **`auth.js` — correct** · 🔴 **`AUTH_ENABLED` defaults OFF; guards 0 routes** | 🔴 none | HIGH |
| **Authorization** | 🟢 **RBAC ranks defined** (`viewer/trader/admin`) · 🔴 **enforced on 0 routes** | 🔴 none | HIGH |
| **Session management** | 🟢 JWT cookie `ag_token`, TTL 12h, expiry checked | — | HIGH |
| **API security** | 🔴 **0 of 172 routes protected** | 🔴 none | HIGH |
| **Secret storage** | 🟡 `.env` — 🔴 **mode `0644` (world-readable)**; 🔴 **rewritten non-atomically by an HTTP handler** (B-6) | 🔴 none | HIGH |
| **Environment variables** | 🔴 **107 of 158 consumed vars are in no config file** *(004)* | 🔴 none | HIGH |
| **File permissions** | 🔴 **`.env` is `-rw-r--r--`** | — | HIGH |
| **Protected modules** | 🟢 **`server.js`, `execution-engine.js`** — an approval workflow, honoured throughout this audit | 🟢 owner | HIGH |
| **Webhook validation** | 🔴 **§0.1 — a non-constant-time compare against `'antigravity'`** | 🔴 none | HIGH |
| **Rate limiting** | 🔴 **ZERO middleware.** *(A naive grep returns 4 hits — all comments and an OUTBOUND broker throttle)* | — | HIGH |
| **Input validation** | 🔴 **NONE systematic.** No `zod`/`joi`. Handlers coerce `req.body.x` by hand | — | HIGH |
| **Output encoding** | 🟡 JSON responses | — | MEDIUM |
| **Logging security** | 🟢 **`module-contract.js` redacts secrets by deny-list** — 🔴 **and it is unmounted (404)** | — | HIGH |
| **Error handling** | 🔴 **No error middleware. 92 empty catches** | — | HIGH |
| **Security headers** | 🔴 **`helmet` → 0 matches.** No CSP, HSTS, X-Frame-Options | — | HIGH |

---

# PART 2 — AUTHENTICATION ASSESSMENT

| Aspect | Verdict |
|---|---|
| **Login mechanism** | 🟢 `login.html` + JWT cookie. Correct |
| **Token handling** | 🟢 **HMAC-SHA256 + `timingSafeEqual` + expiry.** Genuinely good |
| **Session lifecycle** | 🟢 12-hour TTL, configurable |
| **Credential validation** | 🟢 `AUTH_ADMIN_USER` / `AUTH_ADMIN_PASS` |
| **Fail-mode when enabled without a secret** | 🟢 **FAIL-CLOSED** — generates an ephemeral 48-byte secret and warns loudly. **Correct** |
| **API authentication** | 🔴 **0 of 172 routes** |
| **Service authentication** | 🔴 **The webhook uses `'antigravity'`** |
| **Default posture** | 🔴 **`AUTH_ENABLED=false` ⇒ ALLOW.** 000-E mandates **DENY** |

## **Authentication governance: the code is Level 3. The deployment is Level 0.**

---

# PART 3 — AUTHORIZATION MATRIX

| Action | Who may do it, TODAY |
|---|---|
| **Read** everything | 🔴 **Anyone on the network** |
| **Write** config | 🔴 **Anyone.** `POST /api/engine/config` — unauthenticated |
| **Execute** a trade | 🔴 **Anyone.** `POST /api/trade/execute`, `/api/position/enter` — unauthenticated |
| **Configure** the daily-loss limit | 🔴 **Anyone.** **The risk brake is HTTP-mutable with no auth** |
| **Trade** via webhook | 🔴 **Anyone with the string `antigravity`** — which is in `.env.example` |
| **Approve** | 🔴 **NOBODY — no approval stage exists** *(020)* |
| **Halt** | 🔴 **Anyone.** `POST /api/risk/emergency-stop` — unauthenticated *(and it stops 2 of 8 engines — 012 §0)* |
| **Resume** | 🔴 **Anyone.** 🔴 **`POST /api/engine/reset` CLEARS A TRADING HALT with no authentication.** The manual reset exists **precisely because a halt should require human review** — and any host on the LAN is that human |

### Missing authorization: **all of it.** Duplicate: **n/a.** Conflicting: **n/a.**

## ## **AUTHORIZATION: DOES NOT EXIST. 023's stop condition — *"authorization rules are ambiguous"* → they are not ambiguous. There are none.**

---

# PART 4 — SECRETS GOVERNANCE

| Secret | Storage | Rotation | Access control | Auditable |
|---|---|---|---|---|
| **`AMIBROKER_API_KEY`** | 🔴 **`.env` — and its value IS the published example, `antigravity`** | 🔴 never | 🔴 none | 🔴 no |
| **`DHAN_ACCESS_TOKEN`** | 🟡 `.env` — 🔴 **rewritten NON-ATOMICALLY by an unauthenticated HTTP handler** (B-6). 🔴 **Currently EXPIRED (7 days)** | 🟡 via OAuth | 🔴 none | 🔴 no |
| **`AUTH_SECRET`** | 🟡 `.env` — 🟢 **fail-closed when absent** | 🔴 never | 🔴 none | 🔴 no |
| **`ANTHROPIC_API_KEY`** | 🟡 `.env`, fallback `''` 🟢 | 🔴 never | 🔴 none | 🔴 no |
| **`AUTH_ADMIN_PASS`** | 🟡 `.env` | 🔴 never | 🔴 none | 🔴 no |
| **Encryption keys / certificates** | ⚪ **N/A — none exist** | — | — | — |

## 🟢 What is genuinely right

| | |
|---|---|
| **`.env` is git-ignored** | 🟢 **No credential is in the repository history** |
| **Secrets are not logged** | 🟢 `module-contract.js` redacts by deny-list *(unmounted, but correct)* |
| **No hardcoded secret in source** | 🟢 **Except one: `'antigravity'`** |
| **`AUTH_SECRET` absent ⇒ ephemeral random** | 🟢 **Fail-closed** |

## 🔴 What is wrong

| | |
|---|---|
| **`.env` mode `0644`** | World-readable |
| **`.env` written by an unauthenticated HTTP route** | 🔴 **Non-atomic.** A crash mid-write truncates it and **every credential is lost** (B-6) |
| **`AMIBROKER_API_KEY = 'antigravity'`** | **The example value, in production** |
| **Zero rotation, zero access control, zero audit** | **No secret in this platform has an owner** |

---

# PART 5 — API SECURITY

| Control | Classification | Evidence |
|---|---|---|
| **Route protection** | 🔴 **UNKNOWN → NONE** | **0 of 172** |
| **Authentication coverage** | 🔴 **NONE** | 0% |
| **Authorization checks** | 🔴 **NONE** | RBAC defined, enforced nowhere |
| **Input validation** | 🔴 **PARTIAL** | No schema library. Hand-rolled coercion |
| **Output sanitization** | 🟡 **IMPLEMENTED** | JSON only |
| **CSRF** | 🔴 **NONE** | Cookie auth + no CSRF token — **would matter the moment `AUTH_ENABLED=true`** |
| **Rate limiting** | 🔴 **NONE** | Zero middleware |
| **Error disclosure** | 🟡 **PARTIAL** | Handlers return `{error: e.message}` — **stack traces are not leaked** 🟢 |
| **Security headers** | 🔴 **NONE** | No `helmet`, no CSP |
| 🟢 **Command injection** | 🟢 **VERIFIED CLEAR** | `spawn(process.execPath, ['bt-real.js'])` — **fixed literals, no user input** *(001-C §10)* |
| 🟢 **Path traversal** | 🟢 **VERIFIED CLEAR** | **Zero** file paths built from `req.*` |
| 🟢 **CORS** | 🟢 **VERIFIED CLEAR** | `*` only when the request carries **no `Origin` header** — not a cross-origin request |
| 🟢 **Body-size limit** | 🟢 **VERIFIED** | `express.json()` default 100 kb |

---

# PART 6 — OPERATIONAL SECURITY

| Control | Verdict |
|---|---|
| **Protected files** | 🟢 **EXCELLENT.** `server.js` and `execution-engine.js` require an approval package with evidence, diff, risk, rollback and a characterization test. **This workflow was honoured on every one of the 25 audits in this programme** |
| **Startup safety** | 🔴 **No config validation. The platform boots with no configuration at all** *(004)* |
| **Shutdown safety** | 🔴 **14 timers, 0 `clearInterval`. And per 021 §0, the last shutdown produced no record at all** |
| **Configuration integrity** | 🔴 **HTTP-mutable, unauthenticated, no audit** |
| **Dependency management** | 🟢 `package-lock.json` |
| **Secure defaults** | 🔴 **`AUTH_ENABLED=false` ⇒ ALLOW.** 🟢 **`TRADE_MODE=paper`, never persisted to live — the single best default in the codebase** |
| **Fail-safe behaviour** | 🟡 **Money paths: fail closed** 🟢 · **Security paths: fail open** 🔴 |

---

# PART 7 — SECURITY OBSERVABILITY

| Required per security event | Recorded? |
|---|---|
| Timestamp | 🔴 **NO** |
| **Actor** | 🔴 **NO — there is no identity** |
| Action | 🟡 a `console.warn` on a rejected webhook |
| Target | 🔴 **NO** |
| Outcome | 🟡 `console.warn` |
| Reason | 🟡 `'bad key'` |
| **Correlation ID** | 🔴 **DOES NOT EXIST** |

## 🔴 **ZERO security events are persisted.**

> **A failed webhook auth writes `console.warn('[webhook/tv] Rejected — bad key')` to a terminal buffer
> that dies with the process** *(021 §0 — and it did)*.
>
> **There is no record that anyone ever tried. There is no record that anyone ever succeeded. There is
> no record of who cleared the last trading halt.**

---

# PART 8 — FAILURE MODE REGISTER

| ID | Failure | Present? | Impact |
|---|---|---|---|
| **SE-1** | **A published example value is the live production credential** | 🔴 **CONFIRMED — `antigravity`** | **CRITICAL. Mitigated ONLY by paper mode** |
| **SE-2** | **A hardcoded credential fallback — the route can never be closed** | 🔴 **CONFIRMED** | **CRITICAL** |
| **SE-3** | **Authorization bypass — there is no authorization** | 🔴 **CONFIRMED. 0 of 172 routes** | **CRITICAL** |
| **SE-4** | **A trading halt can be cleared with no authentication** | 🔴 **CONFIRMED — `POST /api/engine/reset`** | **CRITICAL** |
| **SE-5** | **The risk brake can be changed over unauthenticated HTTP** | 🔴 **CONFIRMED — `POST /api/engine/config`** | **CRITICAL** |
| **SE-6** | **Secret exposure via a non-atomic `.env` rewrite from an unauthenticated route** | 🔴 **CONFIRMED (B-6)** | **HIGH** |
| **SE-7** | **Non-constant-time credential comparison** | 🔴 **CONFIRMED — while `auth.js` does it right** | MEDIUM |
| **SE-8** | **Unsafe default: `AUTH_ENABLED=false`** | 🔴 **CONFIRMED** | **CRITICAL** |
| **SE-9** | **Silent security failures** | 🔴 **CONFIRMED — zero security events persisted** | **HIGH** |
| **SE-10** | **Listens on `0.0.0.0`** | 🔴 **CONFIRMED** | **HIGH — every finding above is reachable from the LAN** |
| 🟢 **SE-11** | Command injection · path traversal · CORS · body-size | 🟢 **VERIFIED CLEAR** | — |

---

# PART 9 & 10 — SECURITY ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   AuthenticationLayer  ★
     🟢 auth.js ALREADY IMPLEMENTS THIS, CORRECTLY:
        HMAC-SHA256 · crypto.timingSafeEqual · expiry · RBAC · fail-closed on missing secret.
     🔴 IT GUARDS ZERO ROUTES. AUTH_ENABLED defaults to false.
        → THE ENTIRE FIX IS: mount it, and flip the default.

   AuthorizationLayer  ★   The Access Control Matrix, ENFORCED:
        viewer  : read
        trader  : + open/close a position
        admin   : + configure · halt · RESUME · rotate secrets
     🔴 `POST /api/engine/reset` (clear a halt) MUST be admin-only.
        Today it is open to the network.                                  → kills SE-4

   SecretManager  ★
     🔴 NO HARDCODED FALLBACK. EVER. A missing secret is a REFUSAL TO START, not a default.
        `|| 'antigravity'` is the single most dangerous line in the codebase. → kills SE-1, SE-2
     🔴 Every credential comparison uses crypto.timingSafeEqual.            → kills SE-7
     🔴 .env is written ONLY via safe-write, ONLY by an authenticated admin route. → B-6

   SecurityAuditLog  ★   WORM, append-only. The .jsonl writer already exists (022 §1).
     Every auth attempt, every config change, every halt, every resume:
     ts · actor · action · target · outcome · reason · correlationId.
     🔴 Today: ZERO security events are persisted.                          → kills SE-9

   Bind to 127.0.0.1 by default. 0.0.0.0 must be an explicit, documented opt-in. → SE-10
```

## The one rule

> **A default is a decision. `|| 'antigravity'` and `AUTH_ENABLED=false` are two decisions that were
> never made — they were inherited from a tutorial and never revisited.**
>
> **A missing secret must be a refusal to start, never a fallback.**

---

# PART 11 — TESTING STRATEGY

**Security regression tests take priority.**

| Test | Priority | Would it fail today? |
|---|---|---|
| 🔴 **No credential has a hardcoded fallback — a missing secret REFUSES TO START** | **P0 — SE-1/SE-2** | ✅ **FAILS — `\|\| 'antigravity'`** |
| 🔴 **`POST /api/engine/reset` (clear a halt) requires `admin`** | **P0 — SE-4** | ✅ **FAILS — unauthenticated** |
| 🔴 **`POST /api/engine/config` (the risk brake) requires `admin`** | **P0 — SE-5** | ✅ **FAILS** |
| 🔴 **Every mutating route requires authentication** | **P0 — SE-3** | ✅ **FAILS — 0 of 172** |
| 🔴 **Every credential comparison is constant-time** | **P0 — SE-7** | ✅ **FAILS at `server.js:7051`; passes in `auth.js`** |
| 🔴 **Every security event is persisted (append-only)** | **P0 — SE-9** | ✅ **FAILS — zero** |
| **`.env` is written only via `safe-write`, only by an authenticated admin** | **P0 — B-6** | ✅ FAILS |
| 🟢 **No file path is built from `req.*`** | P1 | 🟢 **PASSES — assert it so it never regresses** |
| 🟢 **No `spawn`/`exec` receives user input** | P1 | 🟢 **PASSES — assert it** |

**Seven P0 tests. All seven fail. Two P1 tests already pass and should be locked in.**

---

# PART 12 — SECURITY MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Prototype** | 🟢 | It runs |
| **1 — Basic Authentication** | 🔴 **NO** | 🟢 **The code is correct and complete.** 🔴 **`AUTH_ENABLED` defaults OFF and it guards 0 of 172 routes** |
| **2 — Protected APIs** | 🔴 **NO** | **0% coverage. The webhook uses `antigravity`** |
| **3 — Governed Authorization** | 🔴 **NO** | **RBAC is defined and enforced nowhere** |
| **4 — Defense in Depth** | 🔴 **NO** | No headers, no rate limiting, no CSRF, no audit |
| **5 — Enterprise Security Platform** | 🔴 **NO** | — |

## ## **Security: LEVEL 0 — PROTOTYPE.**

**The *code* would score Level 2–3. The *deployment* scores 0. `auth.js` is a Level-3 authentication
layer with zero routes behind it.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE — this document** | — | none | 172 routes, 0 protected, 1 hardcoded credential |
| **2 — Authentication** | 🔴 **DELETE `\|\| 'antigravity'`.** A missing key ⇒ **the route refuses**. 🔴 **Bind to `127.0.0.1` by default** | none | **Low.** 🔒 **`server.js` PROTECTED** | **No hardcoded credential exists. The webhook cannot authenticate without a real secret** |
| **3 — Authorization** | 🔴 **`AUTH_ENABLED` defaults to `true`.** Mount `auth.requireRole('admin')` on: `engine/reset`, `engine/config`, `emergency-stop`, `trade/execute`, `position/enter`, `dhan/oauth-callback` | Phase 2 | **Medium — the dashboard will require a login. That is the point** | **Every privileged action requires authorization** |
| **4 — Secrets** | 🔴 **`.env` via `safe-write` only, from an authenticated admin route** (B-6). Mode `0600`. Rotation procedure | Phase 3 | Low | **A credential cannot be destroyed by an interrupted write** |
| **5 — Operational** | **`SecurityAuditLog`** — reuse the existing append-only `.jsonl` writer *(022 §1)*. `helmet`. Rate limiting | Phase 4 | Low | **Every auth attempt, config change, halt and resume is on disk, forever** |

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every privileged action requires authorization | 🔴 **NO — 0 of 172 routes. A trading halt can be cleared by anyone on the LAN** |
| Secrets have documented ownership | 🔴 **NO — and one of them is the string `antigravity`** |
| APIs are consistently protected | 🔴 **NO — 0%** |
| Security events are auditable | 🔴 **NO — zero are persisted** |
| **Failures default to secure** | 🔴 **NO — `AUTH_ENABLED=false`, and a missing key falls back to a working default** |
| Authentication boundaries are explicit | 🔴 **NO — there are none** |
| Security governance is reproducible | 🔴 **NO** |

## **0 of 7.**

---

# EXECUTIVE SUMMARY

**The mission: could an independent security architect identify every trust boundary, verify every
privileged operation, confirm the protection of secrets, and reproduce the authorization model?**

## **Yes — and the model is: there isn't one.**

**What is genuinely, verifiably secure — and it matters:**

- 🟢 **No command injection.** `spawn(process.execPath, ['bt-real.js'])` — fixed literals, no user input.
- 🟢 **No path traversal.** Zero file paths are built from request data.
- 🟢 **No CORS hole.** `*` is set only when the request carries no `Origin` header.
- 🟢 **No secret in git history.** `.env` is properly ignored.
- 🟢 **Secrets are redacted from logs** by `module-contract.js`.
- 🟢 **`TRADE_MODE=paper` is never persisted to live** — the single best security default in the codebase, and the only thing standing between every finding below and a real broker account.
- 🟢 **The protected-file workflow** — `server.js` and `execution-engine.js` cannot be modified without an approval package. **It held for all 25 audits in this programme.**

**And then:**

> ## **The only externally-triggerable route that can reach a broker is authenticated by comparing a request field against the literal string `antigravity` — the value published in `.env.example`, hardcoded as a fallback in two source files, and confirmed by measurement to be the live production key.**
>
> **The comparison is `!==`. Non-constant-time.**
>
> **The server listens on `0.0.0.0`. Zero of its 172 routes carry authentication. Any host on the
> network can, right now, without credentials: clear a trading halt, double the daily-loss limit, open a
> position, close a position, and rewrite `.env`.**

**And the finding that ties this audit to every other one in the programme:**

> ## **`auth.js` does all of it correctly.**
>
> **HMAC-SHA256. `crypto.timingSafeEqual`. Token expiry. Role-based access with `viewer/trader/admin`
> ranks. And when enabled without a secret, it refuses to run with an empty key and generates an
> ephemeral one, loudly. This is professional, defensively-written authentication code.**
>
> **It is imported at `server.js:105`. It guards ZERO routes. `AUTH_ENABLED` defaults to `false`.**
>
> **This is the sixth time in this audit programme that the correct thing has been found BUILT,
> IMPORTED, and NOT USED — after `engine-verdict.js` (1 adopter of 8), `module-contract.js` (11 surfaces,
> 404), `bt-validate.js` (0 strategy callers), `position-sizer.js` (imported, disabled by default), and
> the append-only `.jsonl` writer (pointed at migrations and news).**
>
> **This platform's defining characteristic is not that it lacks the right components. It is that it
> builds them, correctly, and then leaves them switched off.**

**The two changes that matter most, in order:**

> ## **1. Delete `|| 'antigravity'`. A missing secret must be a refusal, never a default.**
> ## **2. Flip `AUTH_ENABLED` to `true`, and put `requireRole('admin')` on the route that clears a trading halt.**

---

**Penetration testing: NONE. Vulnerabilities exploited: NONE. Security controls modified: NONE.
Code modified: NONE. Suite: 48/48.**

**Deliverables:** Security Inventory (Part 1) · Authentication Assessment (Part 2) · Authorization
Matrix (Part 3) · Secrets Governance (Part 4) · API Security (Part 5) · Operational Security (Part 6) ·
Security Observability (Part 7) · Failure Modes (Part 8) · Architecture & Contracts (Parts 9–10) ·
Testing Strategy (Part 11) · Maturity Assessment (Part 12) · Migration Roadmap (Part 13) · Executive
Summary.
