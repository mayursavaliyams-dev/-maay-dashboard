# C1c · Step 9 — `option-analyzer` fallback Greeks used a hardcoded, wrong expiry

| | |
|---|---|
| **Date** | 2026-07-09 |
| **Severity** | **High** — corrupted the fallback Greeks on the dashboard |
| **Files changed** | `option-analyzer.js`, `server.js` (**one call site, +1/−1 functional line**) |
| **Tests added** | `test/option-analyzer.test.js` (new suite, **41 assertions**) |
| **Backup** | `backups/migration-C1c-9-optanalyzer-20260709-190257/ROLLBACK.sh` (HEAD `effebb8`) |
| **Tests** | 30/30 → **31/31 suites** |

---

## Current state (before)

```js
/**
 * Get time to expiry in years
 * SENSEX weekly expiry: Tuesday post-Oct 2024 cutover
 */
getTimeToExpiry() {
  const now = new Date();
  const dayOfWeek = now.getDay();
  let daysUntilExpiry;
  if (dayOfWeek === 2) daysUntilExpiry = 0.5;          // "Tuesday — expiry day"
  else if (dayOfWeek < 2) daysUntilExpiry = 2 - dayOfWeek;
  else daysUntilExpiry = 9 - dayOfWeek;                 // "Next Tuesday"
  return Math.max(daysUntilExpiry, 0.5) / 365;
}
```

## Problem

**SENSEX does not expire on a Tuesday.** The broker contract master reports SENSEX expiries on
`2026-07-09`, `-16`, `-23`, `-30` — every one a **Thursday**. The module also assumed a *weekly* expiry
for whatever instrument it was analysing, while `server.js:198` shares **one** `OptionAnalyzer` across
NIFTY, BANKNIFTY and SENSEX.

`T` feeds Black-Scholes. It was wrong on **every day of the week**.

## Root cause

A market constant — the expiry weekday — was hardcoded in an analytics module instead of being read from
the Instrument Registry. Exactly the same root cause as `pop-seller.js:31` (migration C1c-3a), in a
different file. It survived because `option-analyzer.js` had **zero tests**.

---

## Behaviour Comparison Report (Before vs After)

### 1. Time to expiry — measured at 09:30 IST on each weekday

| weekday | before (Tuesday ladder) | after (broker calendar) | error |
|---|---|---|---|
| Mon 2026-07-06 | 1.00 d | 3.25 d | 0.31× |
| Tue 2026-07-07 | 0.50 d | 2.25 d | 0.22× |
| Wed 2026-07-08 | 6.00 d | 1.25 d | 4.80× |
| **Thu 2026-07-09 (expiry)** | **5.00 d** | **0.50 d** | **10.0×** |
| Fri 2026-07-10 | 4.00 d | 6.25 d | 0.64× |

Never right. Worst on expiry day, in the direction that **understates** how close expiry is.

Since ATM gamma scales as `1/√T` and vega as `√T`, on expiry morning:
**gamma was understated ≈ 3.16× and vega overstated ≈ 3.16×** — on the one day gamma dominates.

### 2. Per-instrument T — impossible under the old rule

| instrument | before | after (at 2026-07-09 09:30 IST) | note |
|---|---|---|---|
| SENSEX | 5.00 d | **0.50 d** | expires today (Thu) |
| NIFTY | 5.00 d | **5.25 d** | Tue 2026-07-14 |
| BANKNIFTY | 5.00 d | **19.25 d** | MONTHLY, Tue 2026-07-28 |
| FINNIFTY / MIDCPNIFTY / BANKEX | 5.00 d | **null** | trading-disabled → no Greeks |

### 3. Fallback Greeks — SENSEX, spot 80,000, measured post-close (T: 5.00 d → 6.85 d)

| strike | type | gamma before | gamma after | Δ | vega before | vega after | Δ |
|---|---|---|---|---|---|---|---|
| 80000 | CE | 2.8354e-4 | 2.4209e-4 | ×0.85 | 3728.81 | 4361.64 | ×1.17 |
| 80000 | PE | 2.8354e-4 | 2.4209e-4 | ×0.85 | 3728.81 | 4361.64 | ×1.17 |
| 80500 | CE | 2.7192e-4 | 2.3615e-4 | ×0.87 | 3575.94 | 4254.59 | ×1.19 |
| 79500 | PE | 2.6044e-4 | 2.2622e-4 | ×0.87 | 3424.91 | 4075.76 | ×1.19 |
| 82000 | CE | 1.1466e-4 | 1.2787e-4 | ×1.12 | 1507.81 | 2303.81 | ×1.53 |
| 78000 | PE | 9.1996e-5 | 1.0401e-4 | ×1.13 | 1209.80 | 1873.98 | ×1.55 |

> The magnitudes here are modest because these were captured at **19:00 IST, after the 15:30 close**, when
> the old rule pointed at next Tuesday (5.00 d) and the truth is next Thursday (6.85 d). During market
> hours on expiry morning the divergence is the 10× shown in table 1. Both readings are consistent; the
> flattering one is not presented alone.

### 4. What did **not** change

- The **primary** Greeks path. `server.js:2252` derives `_bsmT` from the chain's real expiry and passes it
  into `_impliedVol` / `_rawGreeks`. Verified: the diff contains no line touching `_bsmT`, `_rawGreeks`
  or `_impliedVol`.
- `riskFreeRate = 0.065`, `volatility = 0.15` (**TD-1**, deliberately untouched).
- The returned Greek fields `{delta, gamma, theta, vega}` and their units (theta per day, ÷365).
- The 3-argument call shape `calculateGreeks(strike, type, spot)` still works and defaults to SENSEX.

---

## Solution

```js
getTimeToExpiry(inst = DEFAULT_INST, now = new Date()) {
  return instrumentRegistry.timeToExpiryYears(inst, now);
}

calculateGreeks(strike, type, spotPrice, inst = DEFAULT_INST) {
  const timeToExpiry = this.getTimeToExpiry(inst);
  if (!timeToExpiry || !(timeToExpiry > 0)) {
    return { delta: 0, gamma: 0, theta: 0, vega: 0, unresolved: true, inst };
  }
  ...
}
```

The 15-line weekday ladder is deleted. `now` is injectable, so the calendar is deterministic under test.

**Fail-closed.** An unknown or trading-disabled instrument yields **zeroed** Greeks with `unresolved: true`,
not Greeks computed from a fabricated `T`. `server.js:2269`'s `Number(fallback[name] || 0)` then surfaces
them as *no data* rather than as a plausible lie.

### The single `server.js` change

```diff
-      const fallback = bsm || optionAnalyzer.calculateGreeks(strike, type, spot);
+      const fallback = bsm || optionAnalyzer.calculateGreeks(strike, type, spot, inst);
```

**`inst` is an argument, never instance state** (requirements 1–3). `server.js:198` builds one shared
`OptionAnalyzer` and mutates it per request; adding `optionAnalyzer.inst` would have extended that
pre-existing race onto the expiry calendar, i.e. onto every Greek. See **TD-2**.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Fallback Greeks change value | **Certain** — that is the fix | Dashboard numbers move | Characterization suite captured the before-values; the diff is tabled above |
| Primary Greeks path affected | None | — | Diff verified to contain no `_bsmT` / `_rawGreeks` / `_impliedVol` line |
| Route throws on a disabled instrument | Low | 500 on `/api/*/options/analytics` | Zeroed Greeks returned, not `NaN`/throw; asserted by test |
| Concurrency regression | **None** | — | No shared state added; asserted (`this.inst` appears nowhere) |
| Signature break for other callers | None | — | Only 3 callers exist: 2 internal (SENSEX paths), 1 in `server.js`. `backtest-tv/run.js` uses only the static `gammaBlastScore` |
| Registry unavailable | None | — | Pure in-process lookup, no network |

**Net risk: low.** The change makes a wrong number right, in a narrow, well-fenced path, with no new state.

---

## Test Coverage Report

| | before | after |
|---|---|---|
| suites | 30 | **31** |
| `option-analyzer` assertions | **0** | **41** |

Covers: delegation to the registry · the signature is a parameter, not state (`this.inst` absent) ·
correct `T` on all five weekdays · per-instrument `T` (NIFTY 5.25 d, BANKNIFTY 19.25 d monthly) ·
fail-closed zeroed Greeks for disabled/unknown instruments · 3-arg backward compatibility ·
Greeks checked against an **independent** Black-Scholes at 6 strikes × both types ·
put-call delta parity · gamma peaks ATM · theta negative and per-day · `normalCDF`/`calculateD1` ·
TD-1 and TD-2 pinned so they cannot regress silently.

**Flakiness found and fixed during authoring.** The first version failed 4 runs in 20:
`calculateGreeks()` calls `getTimeToExpiry()` internally, reading `new Date()` again, so its `T` drifts
milliseconds from the `T` captured in the test. An absolute tolerance of `1e-9` on a theta of ≈ −63 cannot
survive that. Four assertions were switched to **relative** tolerance. Re-verified: **50/50 runs clean**,
and the full suite green on 3 consecutive runs before `server.js` was touched.

---

## Performance Impact

| | before | after |
|---|---|---|
| `getTimeToExpiry()` | 94 ns/call | 1,762 ns/call (**18.7×**) |
| `calculateGreeks()` | — | 1,794 ns/call (`T` is 98% of it) |
| Worst case: fallback Greeks for all ~100 legs of one chain | — | **+0.167 ms per request** |

Measured over 200,000 iterations. The registry's calendar builds a few `Date` objects and walks backwards
to find the last weekday of the month; the old rule was one `getDay()`.

**Verdict: negligible.** 0.167 ms sits against a network round-trip of tens of milliseconds, and
`_optionSnapshotCache` coalesces in-flight requests per instrument. Memoising `nextExpiry(inst, day)` would
erase it entirely, but that is an optimisation with no present justification and is **not** done here.

---

## Migration Log

| Stage | Action | Gate |
|---|---|---|
| 0 | Backup `option-analyzer.js`, `server.js` + `ROLLBACK.sh` | — |
| 0 | Baseline suite | 30/30 ✓ |
| 1 | Capture before-values of `T` and the fallback Greeks | — |
| 2 | Write `test/option-analyzer.test.js` pinning current behaviour | 26 assertions ✓ |
| 3 | Migrate `getTimeToExpiry(inst, now)` + `calculateGreeks(..., inst)` | tripwire fired as designed ✓ |
| 4 | Re-point suite to assert the fix; fix 4 flaky tolerances | 41 assertions, 50/50 runs ✓ |
| 5 | **Stage gate:** full suite ×3, exit-code gated | 31/31 ×3 ✓ |
| 6 | Change the **single** `server.js` call site | +5/−1 lines, 1 hunk |
| 7 | Full suite ×3, primary-path diff check, live route smoke test | 31/31 ×3, HTTP 200 ✓ |
| 8 | Record TD-1, TD-2 | `docs/tech-debt/` |

Requirement 8 honoured: `server.js` was **not** touched until the suite was green.

---

## Rollback Plan

```bash
bash backups/migration-C1c-9-optanalyzer-20260709-190257/ROLLBACK.sh
```

Restores `option-analyzer.js` and `server.js` and removes the new suite. No persisted state, ledger or data
file is touched by this migration — Greeks are computed fresh on every request — so rollback is total and
instantaneous. The rolled-back code returns to producing the wrong `T`.

---

## Deliberately not fixed (tracked)

- **[TD-1](../tech-debt/TD-1-fallback-volatility.md)** — `volatility = 0.15` hardcoded for the fallback Greeks, discarding the live IV the caller already solved for.
- **[TD-2](../tech-debt/TD-2-optionanalyzer-singleton-race.md)** — one shared `OptionAnalyzer` mutated per request (`server.js:198`, `:2248-2249`).

Both carry evidence and recommended remediation. Both are asserted by the new suite so they cannot regress
unnoticed.
