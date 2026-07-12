# CONSTITUTIONAL COMPLIANCE AUDIT — 2026-07-10

Measured against the repository and the running server. **No code was changed by this audit.**
Every claim carries its Article 2 category. Suite 46/46 green.

---

## 0. INCIDENT — Article 1 (Truth), Article 9 (Data), Article 18 (Audit)

**During this audit I ran a script that executed production tooling I did not intend to run.**

A `require()` loop meant to inspect module exports did not exclude `bt-*.js`. Requiring those files
executed them. They downloaded bhavcopy data, merged the 1-minute index series, and re-ran three
backtests, overwriting their outputs.

**Classification: MEASURED.** Damage assessed file by file, not assumed:

| file | effect | recoverable |
|---|---|---|
| `bt-data/result-intraday-nifty.json` | overwritten | **git-tracked — restored** |
| `bt-data/result-real.json` | overwritten | **git-tracked — restored** |
| `bt-data/result-world-strategies.json` | overwritten | **git-tracked — restored** |
| `bt-data/nifty-1min.json` | **appended** 73,560 → 73,935 bars (+375) | untracked; **nothing deleted** |
| `bt-data/bhav/` | 600 files, **0 changed** | — |
| `bt-data/result-validate.json` | new file | additive |
| `data/equity-nifty.json`, `data/equity-sensex.json`, `data/config-overrides.json` | **md5 unchanged** | untouched |

**No irrecoverable history was destroyed.** The three overwritten files were regenerable outputs under
version control and have been restored (`git checkout --`). The 1-minute series gained 375 real bars and
lost none.

**Article 9 was not breached in outcome. It was breached in method.** A loop that requires a file it has
not classified is a loop that can execute anything. The lesson is not "filter `bt-*`"; it is that
**inspecting a module must never mean executing it.** Static scanning (`grep`) was used for every
subsequent measurement in this document.

This incident is recorded here because Article 18 requires it, not because it was discovered by anyone
else.

---

## 1. ARTICLE-BY-ARTICLE

| # | Article | Verdict | Evidence (Article 2 category) |
|---|---|---|---|
| 1 | Truth | **COMPLIANT** | Wrong claims this session were retracted in writing: "105 silent catches" → 112; "50 outcomes" → 55; the far-expiry hypothesis for F4 was published as *wrong* before the correct one. |
| 2 | Evidence | **COMPLIANT** | Every constraint in `THE-ONE-DOCUMENT.md` §2 carries a category. F4 moved Unknown → Measured with a reproducible script. |
| 3 | Unknown | **VIOLATED** — 3 live sites | MEASURED. See §2. |
| 4 | Fail Closed | **VIOLATED** — 1 critical | MEASURED. See §2. |
| 5 | Ownership | **VIOLATED** | MEASURED. Kelly ×4, GEX ×3, capital ×4 owners. See §3. |
| 6 | Research before implementation | **COMPLIANT** | F4 evidence collected; no GEX shipped on it. |
| 7 | Implementation requirements | **COMPLIANT** | Every applied patch this session had a characterization test proven red first. |
| 8 | Risk | **VIOLATED** — critical | MEASURED. `setAutoEnabled()` re-arms a halted engine. |
| 9 | Data | **VIOLATED** | MEASURED. `signal-health.saveState()` overwrites a file it declared unrecoverable. |
| 10 | Architecture | **VIOLATED** | MEASURED. See §3. |
| 11 | Quality ordering | COMPLIANT | No performance optimisation was chosen over correctness this session. |
| 12 | Testing | **COMPLIANT** | 46 suites. Every fix characterized first; three of my own test bugs were found and recorded. |
| 13 | AI is not authority | **COMPLIANT** | A web-search summary asserting "OI is in contracts" was **rejected** in favour of measurement. |
| 14 | Production | **VIOLATED** | MEASURED. No monitoring surface: `GET /api/m/health` → **404**. No audit trail. |
| 15 | Documentation | COMPLIANT | Each decision carries why / evidence / risk / rollback / future impact. |
| 16 | Scientific integrity | **VIOLATED** | MEASURED. 15 modules emit BUY/SELL; `pop-seller` publishes `combinedPoP` as a probability. |
| 17 | Project memory | COMPLIANT | Six approval packages, an architecture review, and this audit are on disk. |
| 18 | Audit | **COMPLIANT** | §0 above. |
| 19 | Long term | **AT RISK** | `server.js` is 7,318 lines, 168 routes, 62 top-level mutable variables, 0 `express.Router()`. |
| 20 | Final law | — | Applied throughout: nothing was implemented under uncertainty. |

**Six articles violated. Four of the six trace to a single absence: no owner.**

---

## 2. ARTICLES 3, 4, 8, 9 — Unknown, Fail Closed, Risk, Data

### 2.1 A halted engine is re-enabled at boot — **CRITICAL**

Classification: **MEASURED** (reproduced on the real prototype).

`restoreEquity()` sets `_haltedReason = 'EQUITY_STATE_CORRUPT'` and `autoEnabled = false`.
`setAutoEnabled(v)` contains **zero references to `_haltedReason`** (`execution-engine.js:698`).
`tick()`'s only gate is `if (!this.autoEnabled) return;` (`:280`).
`server.js:7287` calls `setAutoEnabled(true)` at boot.

`getHaltStatus()` then publishes an **impossible state**:

```json
{"halted": true, "reason": "EQUITY_STATE_CORRUPT", "autoEnabled": true}
```

Breaches **Article 4** (unknown state must reach a safe state), **Article 8** (risk controls cannot be
bypassed, cannot fail open) and **Article 10** (one source of truth).

Observed on the running server: NIFTY holds `consecLosses: 15` against `MAX_CONSECUTIVE_LOSSES=3`,
`autoEnabled: true`.

**Package written, not applied: `docs/APPROVAL-halt-reenabled-at-boot.md`.**

### 2.2 `signal-health.saveState()` overwrites unrecoverable calibration state

Classification: **MEASURED**. `signal-health.js:115-126` contains **zero references** to
`tk.stateCorrupt`, which `loadState()` sets at `:144` while logging *"The file is untouched."*

Breaches **Article 9** (never silently repair corruption; preserve evidence). Every sibling writer
guards this: `pop-seller.js:378`, `agents-engine.js:326`.

**Package written, not applied: `docs/APPROVAL-signal-health-save-over-corrupt.md`.**

### 2.3 Quality gates that the Constitution says auto-reject

Classification: **MEASURED**, comment-stripped scan of the production surface:

| gate | count | worst offender |
|---|---|---|
| Silent Catch | **112** | `server.js` (71) |
| Raw JSON Parse | **11** | `server.js` (9) |
| Raw File Write | **8** | `server.js` (8) |

All eight raw writes and most silent catches are inside the protected monolith. Each needs its own
approval package. **Three are already written.**

---

## 3. ARTICLES 5 & 10 — Ownership and Architecture

Classification: **MEASURED** (static scan; no module was executed).

| thing | owners | evidence |
|---|---|---|
| **Kelly** | **4** | `position-sizer.js`, `strangle-engine.js`, `trade-planner.js`, `vix-kelly-sizer.js` |
| **GEX** | **3** | `gex-skew.js` (`r = 0.065`), `vol-context.js` (`r = 0`, **opposite dealer sign**), `server.js` |
| **Capital** | **4** | `execution-engine.js`, `afternoon-engine.js`, `strangle-engine.js`, `server.js` — plus `data/equity-nifty.json`, `data/equity-sensex.json`, `config-overrides.json:STRANGLE_CAPITAL`, `config-overrides.json:CAPITAL_TOTAL` |
| **Orders** | **8 call sites, 6 modules** | one boolean (`paperMode`) separates them from a live broker |
| **Exposure** | **0** | `grep -rlE "totalExposure\|portfolioRisk\|netDelta"` returns nothing. **The account has no daily-loss brake.** |
| **EngineVerdict** | **1 adopter** | only `pop-seller.verdict()` conforms. `event-risk-filter.js` and `forward-test-report.js` expose a field *named* `verdict` with a different meaning — itself an Article 10 breach ("one contract"). |

**Two GEX implementations disagree on the risk-free rate and on the dealer sign.** Under Article 5 this
is not a code-quality remark; it means **no one owns the pricing model**, and F4's resolution does not
change that.

### The counter-example that proves it can be done

`charges.js` has **12 dependents and one implementation**. `instrument-registry.js` is a single,
broker-verified source of truth with a fail-closed two-surface design. `safe-write.js` is a pure leaf.
**The codebase already knows how to obey Article 5. It has simply not been made to.**

---

## 4. ARTICLE 14 — Production

Classification: **MEASURED** against the running server.

- **Monitoring:** `GET /api/m/health` → **404**. `module-contract.js` builds health, metrics, version,
  config, OpenAPI, structured logs, shutdown and health score for any module, with 114 assertions —
  and **not one of its routes is reachable**, because mounting requires one line in the protected
  `server.js`.
- **Audit trail:** `EventEmitter` appears in exactly **one** production module (`dhan-ws-feed.js`).
  There is no event bus, therefore no replay and no audit trail. *"Why did the system do that at 14:32?"*
  can only be answered by reading `console.log`.
- **Rollback:** present and exercised. Every applied patch this session has a `backups/…/ROLLBACK.sh`.
- **Approval:** enforced. Nothing was committed; nothing was pushed.

**Two of four Article 14 requirements are absent.** Under Article 14, **no deployment is permitted.**

---

## 5. ARTICLE 16 — Scientific Integrity

Classification: **MEASURED**.

- **15 modules emit `BUY` / `SELL`.** The ratified AI Architecture Rule forbids it.
- `pop-seller` publishes `combinedPoP` — a probability — while its own `verdict()` **abstains** and
  states that no probability may be published until a calibrated Meta Decision Engine exists. The module
  contradicts itself across two surfaces.
- **No engine's `reliability` has ever been measured out-of-sample.** 55 labelled outcomes exist
  platform-wide; ~200 are needed. Every `reliability` is `null`, every weight is 0, and a weighted
  ensemble is **mathematically empty**.

**No edge is claimed without evidence, and no accuracy is claimed without measurement.** The one claimed
edge — option *selling* — rests on a 600-day real-premium backtest; the one refuted claim — directional
*buying* — was refuted by a 1,200-trade backtest at **PF 0.94**. Both are recorded with their data.

---

## 6. RULING

**The project's engineering discipline is institutional. Its architecture is not.**

Six articles are violated. **Four of them — 5, 8, 10, 14 — are the same violation seen from four angles:
nothing owns capital, nothing owns orders, nothing owns risk, nothing owns observability.** Eleven
engines each hold a fragment of all four and cannot see one another.

Under **Article 20**, when uncertainty exists, protect Data, Capital, Research, Architecture, Evidence
and Risk before anything else. That ordering names the remedy:

1. **Capital** — protected this session. `restoreEquity()` now runs after the overrides; the daily-loss
   brake is armed at the real ₹4,400.55, not a stale ₹5,000.
2. **Risk** — `docs/APPROVAL-halt-reenabled-at-boot.md`. **A halted engine trades today.** This is the
   single next action.
3. **Data** — `docs/APPROVAL-signal-health-save-over-corrupt.md`, then the remaining `server.js` writers.
4. **Architecture** — `OrderManager` as a pass-through (zero behaviour change), then a read-only
   `RiskEngine` publishing exposure at `/api/risk` for two weeks before it is ever in the path.
5. **Observability** — one approved line mounts `module-contract`, and Article 14 stops being violated.

**Under Article 14, deployment remains forbidden.** Under Article 6, no implementation may proceed
without approval. Both hold.
