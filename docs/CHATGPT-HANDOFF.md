# ANTIGRAVITY PRO — HANDOFF FOR CHATGPT

Paste this whole file into ChatGPT. Self-contained. **State: 2026-07-12.**
Suite **47/47 green**. Git HEAD **`7823864`** — **committed, NOT pushed.**
Bot is **running** in paper mode (`TRADE_MODE=paper` — no live order path is reachable).

The commit `7823864` carries 52 files: the `bt-lib` fix, the boot-order capital fix, the unknown-VIX
fixes, two of three `config-overrides.json` writers, all tests, and every approval package and review
document. **Deliberately excluded:** `backups/` (rollback artefacts), runtime `data/*.json` (paper state
that changes every tick), screenshots, and the owner's own pre-existing edits to `README.md`,
`bt-real.js`, `package-lock.json`, `signal-heatmap.html`, `data/config-overrides.json`.

100% paper-trading Indian index-options research platform (Node/Express, local).
Protected files: `server.js`, `execution-engine.js` — no edit without an approval package.

---

## 1. WHAT IS DONE (su kaam thayu)

### Applied this session (uncommitted, in the working tree)

**A. `bt-lib.js` — the source of BOTH invalidated backtests. FIXED (additive).**
- `loadDay().underlying` was UDiFF column 20 = `UndrlygPric` = **the day's CLOSING level**, named as if
  it were tradeable at the open. That one unlabelled datum is the look-ahead in every strategy built
  on this library.
- `LOT = 75` was hardcoded. The bhavcopy carries `NewBrdLotQty` per row (column 28); across 600 days it
  is 25 / 50 / 65 / 75. The hardcoded 75 is **wrong on 59.3% of them** (constraint F1).
- **Fix:** `loadDay()` now also returns `underlyingClose` (honest name) and `lot` (real, per-day, from
  the data — `null` if unreadable, **never** a fallback to 75). `sizeLots(cap, prem, lot = LOT)` accepts
  the real lot; the 2-argument form is unchanged.
- **Proven additive** — old vs new on the same file: `underlying`, `atmStrike()`, `sizeLots(2-arg)` and
  `opts.length` are byte-identical. **No consumer breaks. No existing result moves.**
- **Deliberately NOT fixed: the look-ahead itself.** `atmStrike()` still reads today's close. *Which
  price a strategy may see is a STRATEGY decision, not a library one* — changing it in the library would
  silently move all five backtests without any script asking for it. That is the next step, per script.
- Test: `test/bt-lib-lookahead.test.js` (23 assertions), tripwire verified red before the fix.

**B. Boot-order capital fix.** `config-overrides.json` overwrote restored equity at every boot (three
writers, line order, last one won). Verified live: the API said `capital: 100000` while the boot log said
`Restored equity: 88011`. `capital` also arms the daily-loss brake (`execution-engine.js:302`), so a
bleeding account never tightened its own risk. Fixed by moving `restoreEquity()` after
`_loadConfigOverrides()`. **Confirmed on the running bot: `capital: ₹88,011`, brake `₹4,400.55`.**

**C. event-risk-filter + event-engine.** An unknown India VIX no longer scores as a calm one; an
unrecognised event type no longer scores as a dividend. Both now yield `UNKNOWN`, not a fabricated level.

**D. P1-T1, P1-T2.** Two of three `config-overrides.json` writers are atomic + `.bak` + refuse-on-corrupt.

### Verified by measurement (research)

**F4 — `oi_unit` = UNITS, not contracts.** Settled by NSE bhavcopy arithmetic across **5 NSE symbols**
(NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50): `OpnIntrst` is divisible by gcd(historic lots) = 5
on **100%** of rows, while the volume column (known to be contracts) sits at chance. So
`contracts = oi / lot`. **BSE (SENSEX, BANKEX) is still UNKNOWN.**
Reproduce: `node scripts/verify-oi-unit.js`.

### Both edge claims — INVALIDATED

- **Selling REJECTED.** `bt-strangle-costs.js` picks strikes from the **closing** price of the day it
  trades and sells them at that day's **open**. Replicated independently:
  - shipped (with look-ahead): **88.4% win, PF 7.41, +₹3.65L**
  - honest (no look-ahead): **46.5% win, PF 0.55, −₹80k**
- **Buying already refuted** (PF 0.94, 1,200 trades) and re-confirmed: it fails at **PF 0.84 even with
  look-ahead**.

> **THE PLATFORM HAS NO VALIDATED EDGE.** The only uncontaminated evidence is the paper forward-test
> (~55 labelled outcomes; constraint M2 already declares that insufficient). This does **not** disprove
> the volatility risk premium — no literature was consulted — it means the evidence the repository
> offers for its own edge is invalid.

---

## 2. WHAT IS PENDING (pending su che)

### A. Blocked on owner approval — protected `server.js` (packages written, NOT applied)
1. **`server.js:7278` re-enables a HALTED engine at boot.** `setAutoEnabled(true)` undoes the C3-07
   fail-closed halt; `setAutoEnabled()` never reads `_haltedReason`. **A live fail-open.**
   `docs/APPROVAL-halt-reenabled-at-boot.md`. **CRITICAL — recommended first.**
2. `execution-engine` persists `consecLosses` **before** updating it — the brake trips one loss late
   after every restart. `docs/APPROVAL-consec-losses-persisted-stale.md`.
3. **P1-T3** — `server.js:3764`, the last raw writer of `config-overrides.json`.
4. Regime scores an unreachable VIX as maximally calm (`server.js:5785`). SAFE, unconditional.
5. The remaining 7 raw write sites. `docs/APPROVAL-server-write-sites.md`.

### B. Confirmed, packages not yet written
6. **`afternoon-engine` consecLosses** — the same stale-by-one bug (`:747` before `:755`).
7. **Shutdown timer race** — `_gracefulShutdown` writes the EOD snapshot, then `setTimeout(exit, 400)`,
   with **zero `clearInterval`**. 14 timers keep firing for 400 ms after the snapshot.
8. **`openPosition` authority race** — the manual REST endpoints and the auto engine write the same
   slot, with `await` between the guard and the write. MEDIUM.

### C. Blocked on evidence, not code
- **E1** — which STT / exch-txn rate pair is correct (`0.1` vs `0.0625`; `0.03503` vs `0.053`). Needs
  the exchange circular. Both are wrong and they cancel to −0.33%, so the number *looks* right. Do not guess.
- **BSE `oi_unit`** — the F4 test must be rewritten for the BSE file format.
- **M2** — ~55 labelled outcomes; ~200 needed. Every `reliability` is null ⇒ a weighted ensemble is
  mathematically empty ⇒ a Meta Decision Engine v1 could only ever return `INSUFFICIENT_DATA`.

### D. New owner request (not yet investigated)
**Click any strike → open its high/low AND its chart.** Must first audit what already exists
(`public/strike-history.html`, the option H/L archive in `data/opt-hl/`, `data/opt-candles/`) before
building anything. **Not started.**

### E. Two of MY OWN claims were WRONG — corrected here
- I repeatedly said *"NIFTY runs at `consecLosses: 15` against a threshold of 3."* The 3 came from
  `.env.example`. **The live `.env` sets `MAX_CONSECUTIVE_LOSSES = 8`.** The `:7278` fail-open is still
  real; the number I quoted was not. SENSEX today reads `2 / 8`, `halted: false` — correct.
- I said **`vol-context.js` uses `r = 0`**, creating a GEX contradiction with `gex-skew.js`'s `r = 0.065`.
  A fresh grep did **not** confirm it. `gex-skew.js:18 r = 0.065` is confirmed; **the vol-context value
  must be re-measured before that contradiction is repeated as fact.**

---

## 3. WHAT TO DO (karavnu su che) — ranked

1. **Fix the look-ahead in the strategy scripts, one at a time.** `bt-lib` now exposes `day.lot` and
   `underlyingClose`. Each script must choose *yesterday's* close for its ATM/offset and pass the real
   lot. **This WILL change results (PF 7.41 → ~0.55) — it is a behaviour change and needs approval.**
2. **Run every `bt-*` strategy through `bt-validate.js`** — purged k-fold, deflated Sharpe, PSR. It
   exists in the repo and is used by **zero** strategy scripts today.
3. **Approve package #1** (halt re-enable). It disarms a live fail-open.
4. **Keep the paper bot running.** 55 → 200 labelled outcomes is the only mechanism that unblocks
   probability, calibration and any Meta Decision Engine.
5. **Start capturing intraday option chains.** One complete session exists (2026-07-08, 375 minutes).
   Every day of delay is permanently lost.

### Do NOT build yet (blocked by absent evidence)
Volatility Surface (1 session; 21.7% of live IVs are computed, not observed) · GEX / dealer flow (F4 is
done, but the GEX implementations disagree and nobody owns `r`) · Meta Decision Engine (all weights 0) ·
Portfolio / exposure / execution / tick-replay (no NAV series; **zero tick data — unobservable**).

---

## 4. MEASURED ARCHITECTURE FACTS

- `server.js`: **7,327 lines, 168 routes, 0 `express.Router()`, 62 top-level mutable variables,
  14 `setInterval` / 0 `clearInterval`, 20 synchronous IO calls in the request path.**
- **No capital owner, no order owner, no risk owner.** 8 `placeOrder()` sites across 6 modules; one
  boolean (`paperMode`) stands between them and a broker.
  `grep -rlE "totalExposure|portfolioRisk|netDelta"` → **nothing**.
- Kelly ×4 · GEX implementations disagree · capital lives in 4 places.
- 112 silent catches · 11 unvalidated JSON reads · 8 raw `writeFileSync` (all in protected `server.js`).

---

## 5. HOW TO RESUME

```
npm test                                # expect 47/47, exit 0
git status                              # uncommitted working set; nothing pushed
git diff -U0 server.js | grep -c '^@@'  # expect 7 (all owner-approved)
```

**Standing rules:** never commit unasked; never push; never touch the two protected files without an
approval package; characterization test first, proven red; **Unknown != Zero; null != 0; fail closed;
refuse rather than guess**; reply to the owner in **Gujarati script** (code and identifiers in English).

**Full record:** `THE-ONE-DOCUMENT.md`. Detail: `docs/APPROVAL-*.md`, `docs/REVIEW-*.md`,
`docs/EVIDENCE-F4-oi-unit.md`, `docs/ARCHITECTURE-REVIEW.md`, `docs/EVOLUTION-2026-07-10.md`.
