# ADR-003 — The Halt Invariant

**Status:** PROPOSED (design only — no code in this document). Supersedes the informal
"halt fails open" notes in 005 / 030 / APPROVAL-halt-reenabled-at-boot with a single
verified invariant.
**Decision owner:** Chief Risk Officer + Chief Architect. **Commit owner:** repository
owner (this touches protected files → an approval package, not a direct edit).
**Severity:** 🔴 **Critical in live · latent in paper** (bites only when `TRADE_MODE=live`
AND auto is enabled; default mode is paper — stated honestly, not inflated).
**Doctrine:** fail closed; `null ≠ 0`; a brake whose state is unknown reads **ON**.

---

## 1. PROBLEM

A halted trading engine can silently **un-halt itself** and resume entering orders —
most dangerously across a process restart, which is exactly when a crash-loss streak is
most likely to have just occurred. The consecutive-loss / daily-loss / drawdown brakes
are not durable: they are stored as an edge-set flag that a restart resurrects as
"not halted," while the *condition* that caused the halt is still true.

This is a **fail-open safety brake** — the one failure mode Principle 2 forbids.

---

## 2. EVIDENCE (verified in code, 2026-07-18 — file:line)

All references are `execution-engine.js` unless noted. Read directly, not inferred.

**a. What is persisted vs what is not** (`:178-184`, the equity save):
```
persisted:  { capital, reserve, consecLosses, updatedAt }
NOT persisted: _haltedReason, the day's realized PnL, _peakEquity
```

**b. What is restored** (`restoreEquity`, `:368-390`):
- restores `capital, reserve, consecLosses` (`:381-383`);
- on corrupt/unrecoverable file → `_haltedReason='EQUITY_STATE_CORRUPT'`, `autoEnabled=false`
  (`:386-387`) — this part is **already correctly fail-closed** (C3-07);
- but it does **not** re-derive `_haltedReason` from the restored `consecLosses`. After a
  restart with a 15-loss streak: `_consecLosses = 15`, `_haltedReason = null` (its init
  default at `:93`).

**c. The entry guard checks the flag, not the level** (`:280-306`):
- `:280` `if (!this.autoEnabled) return;`
- `:297` `if (this._haltedReason === 'CONSEC_LOSSES') return;`  ← gated on the **stored
  flag**, which is `null` after restart even though `_consecLosses = 15 ≥ maxConsecLosses`.
- `:301-306` daily-loss is re-checked live from `_getDailyPnl()`; but the day's realized
  PnL lives in session memory (`closedPositions`) which resets to empty on restart, so
  after a restart the daily-loss brake also reads ≈0 → passes. **[P]**

**d. `autoEnabled` and the halt are independent, uncoupled fields.**
- `autoEnabled` is seeded from env/config at construction (`:72`), with **no reference**
  to the restored loss streak.
- `setAutoEnabled(v)` (`:698-700`) sets `autoEnabled = v` with **no `_haltedReason`
  check** — anything may re-arm a halted engine.
- Boot / config paths call it: `server.js:3179, 3417, 3634` (`setAutoEnabled(!!enabled)`)
  and `server.js:7349` (config-override applied at boot). A persisted `AUTO=true`
  override therefore re-arms the engine on every restart. **[V]**

**e. Observed consequence (documented):** live NIFTY seen at **15 consecutive losses vs
a limit of 8, unhalted** (005 §0). The mechanism above is why.

**Evidence grade:** a-d are **[V] Verified**. e is **[P] Documented** (prior audit
observation, not re-reproduced this session). Nothing here is Estimated or Opinion.

---

## 3. ROOT CAUSE

**Halt is modelled as a stored, edge-triggered flag instead of a pure level-function of
persisted risk state.**

`_haltedReason` is written once, at the instant a threshold is crossed (`:167`, `:196`,
`:305`). Because it is a separate mutable field:
1. it is not part of the persisted risk state, so it evaporates on restart while the
   underlying counters survive;
2. it can disagree with the level that should imply it (streak = 15 but reason = null);
3. it must be kept in sync by hand across every code path, and `autoEnabled` — a second
   independent flag — must *also* be kept in sync. Safety depends on an `AND` of two
   hand-maintained mutable flags rather than one derived predicate.

The correct model: **`halted` is not a variable you set — it is a question you ask of
the state, every time, and the answer must survive a restart.**

---

## 4. ALTERNATIVE DESIGNS

**Design A — Persist the flag (band-aid).** Add `_haltedReason` to the equity save and
restore it. *Cost:* ~4 LOC. *Verdict:* **Rejected as the primary fix.** It treats the
symptom (flag not persisted), not the root (edge vs level). The flag and the level can
still diverge; any future path that changes `consecLosses` without also setting the flag
reintroduces the bug. Acceptable only as a stop-gap if B cannot ship immediately.

**Design B — Level-derived halt (RECOMMENDED).** Make `halted` a pure function of
persisted state, evaluated as a precondition to every entry; forbid `autoEnabled=true`
while it holds. Concretely, as a *design predicate* (not production code):
```
isHalted(state) :=
      state.consecLosses >= maxConsecLosses           → 'CONSEC_LOSSES'
   OR state.dayRealizedPnl < -(capital * maxDailyLossPct) → 'DAILY_LOSS'
   OR state.drawdownFromPeak > maxDrawdownPct          → 'DRAWDOWN'
   OR state.equityCorrupt                              → 'EQUITY_STATE_CORRUPT'
   else null
```
- `_haltedReason` becomes **derived** (recomputed at boot and before each entry), never a
  free-standing stored flag.
- Persisted risk state is extended so `isHalted` is answerable after a restart:
  `consecLosses` (already ✓), `dayRealizedPnl`, `peakEquity`, `equityCorrupt`.
- **The invariant:** `effectiveAuto = configuredAuto AND NOT isHalted()`. Every
  `autoEnabled = true` / `setAutoEnabled(true)` becomes a no-op-and-log while
  `isHalted()` is true. Clearing a halt is only possible by the state changing (a win
  resets the streak; a new day resets daily-loss) or an explicit operator `resetHalt()`
  after review.
*Cost:* ~20-30 LOC across execution-engine + afternoon-engine + the boot wiring.
*Verdict:* **Recommended.** Removes the entire bug class; the money-instinct now covers
the brake.

**Design C — External RiskEngine owns halt (target-state).** Halt is not engine-local at
all: the single `RiskEngine` (doc 000 singleton #2) evaluates `isHalted` for every engine
from owned state and exposes a **global kill-switch**. *Verdict:* **Correct eventual
home, but out of scope for a Critical hotfix.** It is Phase 4 (money-owner) work.
**B must be structured so it lifts into C cleanly** — i.e. `isHalted(state)` is written as
a pure function that later becomes `RiskEngine.isHalted(engineState)` unchanged.

**Chosen:** **B now, shaped for C later.** A is the fallback only if B slips.

---

## 5. TRADE-OFFS

| Axis | Design B |
|---|---|
| Correctness | Eliminates the bug class (level ≡ flag by construction) |
| Blast radius | Touches 2 protected engine files + boot wiring → approval package |
| Backward compat | Old equity files lack `dayRealizedPnl`/`peakEquity` → treated as **unknown → halt** on first boot after upgrade (fail-closed, safe) — a one-time operator reset is expected and must be documented |
| Performance | `isHalted` is a few comparisons per entry attempt — negligible |
| Reversibility | Fully reversible; additive guard + extra persisted fields |
| Cognitive load | *Fewer* moving parts — one predicate replaces two hand-synced flags |

The only real cost is the **one-time expected halt** on the first restart after deploy
(because the new fields are absent → unknown → fail-closed). That is the invariant
working as designed, not a regression; it must be called out in the release note.

---

## 6. RISK ANALYSIS

- **If we do nothing:** a live, auto-enabled engine resumes trading after a loss-streak
  restart. Direct capital loss. Severity Critical *in live*; the mitigating fact is that
  default mode is paper and live requires two explicit switches. Do not rely on that as
  the control — configuration is not a safety mechanism.
- **Risk introduced by B:** the one-time fail-closed halt on upgrade (mitigated by the
  release note + a single `resetHalt`). A second-order risk: if `dayRealizedPnl`
  persistence is wired incorrectly it could over-halt (false positive). *This is the
  safe direction of failure* and is caught by the characterization tests below.
- **Residual [U]:** whether `afternoon-engine.js` already derives halt differently must be
  verified before the package — the fix must be applied **consistently to all four live
  instances** (2 execution + 2 afternoon). Not confirmed this session.

---

## 7. LONG-TERM IMPACT

- **1 month:** the brake is durable; no engine un-halts itself across restart.
- **6 months:** `isHalted` is the reference predicate; new brakes (event-risk, exposure)
  are added as new clauses, not new flags.
- **1 year:** the predicate lifts into `RiskEngine.isHalted` (singleton #2) with zero
  logic change — the ADR pre-shaped it. A global kill-switch wraps it.
- **3-5 years:** halt is one clause of the firm-wide risk authority; per-engine halt
  flags no longer exist. **This ADR is the seed of the Risk singleton.**
- **Debt created:** none. **Debt removed:** an entire class of fail-open safety flags.
  It converts operational debt into an invariant.

---

## 8. MIGRATION STRATEGY

1. **Verify [U]:** confirm `afternoon-engine.js`'s current halt/restore behaviour so the
   fix is consistent across all four instances.
2. **Characterization test first, proven RED** (Testing Rule): boot an engine from a
   persisted `consecLosses ≥ max` state → assert it refuses entry and `status().halted`
   is true. This test **must fail on today's code** (the flag is null → guard passes) —
   that red is the proof the bug is real.
3. **Author the approval package** (impact + risk + exact diff + rollback + test plan)
   for the protected files. Diff ≈ B: derive `_haltedReason`, extend the persisted risk
   state, gate `autoEnabled`. Target < 30 LOC.
4. **Owner commits** the protected-file diff (Principle 10 — not the assistant).
5. **Shadow/observe** one session: `status()` should show halt derived correctly; the
   one-time upgrade halt is expected on first restart.

---

## 9. ROLLBACK STRATEGY

- The change is additive (a guard + extra persisted fields). Rollback = revert the diff;
  the extra fields in the equity JSON are ignored by the old code (backward-safe).
- No data migration is destructive: old files simply lack the new fields.
- If B misbehaves, fall back to Design A (persist+restore the flag) as an interim while B
  is corrected — A is strictly safer than today even if less clean.

---

## 10. INSTITUTIONAL RECOMMENDATION

**Adopt Design B. Treat it as the first of the three prerequisite ADRs (with ADR-001
capital, ADR-002 `r`) that must exist before any money-layer decomposition.**

Rationale in one line: **a safety brake must be a question asked of durable state, never
a flag remembered in RAM.** This is the smallest change that extends the platform's
proven fail-closed-on-money instinct to the brake that protects that money — and it is
pre-shaped to become the Risk singleton, so it pays down architecture debt while fixing a
Critical safety hole.

**The invariant, stated once, to be enforced forever:**
> `autoEnabled` may never be effectively true while `isHalted(persistedState)` is true;
> `isHalted` is a pure function of state that survives a restart; unknown state ⇒ halted.

---

*Next artifact (separate, on owner's go): the APPROVAL package with the exact diff +
the RED characterization test. This ADR authorizes the design, not the code.*
