# C1c · Step 2/7 — `pop-seller.js` characterization suite

| | |
|---|---|
| **Date** | 2026-07-09 |
| **Production files changed** | **none** |
| **Tests added** | `test/pop-seller.test.js` (new suite, **87 assertions**) |
| **Tests before** | 26/26 suites |
| **Tests after** | **27/27 suites** |
| **Backup** | not required — no production file was modified |

---

## Current state

`pop-seller.js` had **zero tests**, while computing probability-of-profit, Black-Scholes deltas, option
premiums, credit, and paper P&L for a live paper book exposed through `server.js` routes. It is the module
holding the `FINNIFTY: 65` error that C1c-3 must correct.

## Why a characterization suite comes first

A characterization suite pins what the code **does**, not what it should do. Asserting
`lotSize('NIFTY') === 75` does not endorse 75 — it is a **tripwire** that fires the moment 75 becomes 65,
so the C1c-3 migration produces a diff in which every changed number is visible and explained. Without it,
a lot-size change would silently alter every P&L in the module and no test would notice.

**The tripwire was verified, not assumed.** `LOT_SIZE` was temporarily patched to the broker-correct
`{NIFTY:65, BANKNIFTY:30, FINNIFTY:60}` on a scratch copy; the suite failed immediately with
`DEFECT D1: lotSize(NIFTY) is 75 today` and exit code 1. `pop-seller.js` was then restored and confirmed
byte-identical to HEAD (`md5 ad9ca250519da58311e262be45c0f760`, `git diff --quiet` clean).

## Defects pinned (each fixed in a SEPARATE commit — never bundled)

| ID | Site | Defect | Impact | Fix |
|---|---|---|---|---|
| **D1** | `:18` | `LOT_SIZE = { NIFTY:75, BANKNIFTY:35, SENSEX:20, FINNIFTY:65, BANKEX:30 }` | Broker: 65/30/20/**60**/30. P&L overstated **+15.4% / +16.7% / +8.3%** | C1c-3 |
| **D2** | `:19` | `LOT_SIZE[inst] \|\| 75` | Any unknown symbol silently prices at 75. MIDCPNIFTY (true 120) → **−37.5%** | C1c-3 |
| **D3** | `:22` | `STEP` map duplicated from the registry | Values correct; `\|\| 50` would mis-round MIDCPNIFTY (true 25) | C1c-3 |
| **D4** | `:31` | `daysToExpiry` assumes **NIFTY = Thursday, SENSEX = Tuesday** | **They are exactly swapped.** Broker: NIFTY's nearest expiry `2026-07-14` is a **Tuesday**; SENSEX's `2026-07-09` is a **Thursday**. `T` is wrong → every delta is wrong → **every PoP this module exists to produce is wrong**. Worse, BANKNIFTY/FINNIFTY/BANKEX have **no weekly expiry at all** (MONTHLY-only, post-SEBI), yet the function assumes one. | **C1c-3a** |
| **D5** | `:51` | `bsDelta` returns `±1` whenever `T <= 0`, ignoring moneyness | A deep-OTM call at expiry reports delta `1` → **PoP 0%**; the truth is delta ≈ 0 → PoP ≈ 100%. Exactly inverted. Also trips on `sigma <= 0`. Reachable only via the exported function — `scanPoP` floors `T` at `0.5/365`. | **C1c-3a** |
| **D6** | `:198` | `buildIronCondor` returns **two short legs and no wings** | That is a **short strangle**, not an iron condor. Max loss is unbounded, and the returned object has no `maxLoss` field. | backlog |
| **D7** | `:207` | `combinedPoP = popCE × popPE` | Assumes the two breaches are **independent**. They are perfectly negatively correlated — spot cannot pierce both sides. The product **understates** true PoP. | backlog |
| **D8** | `:242` | `_book` is module-global mutable state | Shared across every `require`; no persistence, lost on restart. | backlog |

**D4 and D5 are not lot-size defects.** Fixing them inside the C1c-3 commit would violate the
"never fix multiple unrelated issues in one commit" rule, so they are scheduled as **C1c-3a**.

## Coverage

87 assertions across: lot-size map + `|| 75` fallback · strike lattice (NIFTY 50 / SENSEX 100) ·
`daysToExpiry` weekday rule, 0.5-day floor, 8-day ceiling · `bsDelta` ATM/OTM/parity and the `T<=0` branch ·
`popFromDelta` · `realPoP` IV normalisation (`>5 ⇒ percent`), 5%–200% clamp, moneyness fallback ·
`scanPoP` filtering, sort order (PoP desc, distance asc), `premium > 0.5` gate, `fromChain` flag, maxProfit,
breakeven · `buildIronCondor` structure, credit, breakevens, null path · `payoffCurve` shape and tails ·
paper book open/close/double-close/unknown-id, copy-on-read · live-trading hard gate.

## Correction made during authoring

My first expected value for the ATM call delta (`0.5326`) was **wrong** — the test failed, and the module
was right. With `S = K`, `ln(S/K) = 0`, so `d1 = (r + σ²/2)·T / (σ√T) = 0.14562` and `N(d1) = 0.5579`.
The 6.5% risk-free drift lifts an ATM call delta above 0.50. The test was corrected; `pop-seller.js` was not
touched. A tautological assertion (`x !== x || true`) was also removed — a test that cannot fail is worse
than no test.

## Impact / Risk

Zero. No production file was modified. `git status` shows only the new suite (`bt-real.js` and
`package.json` carry pre-existing, unrelated working-tree changes and were not committed).

## Test results

```
26/26 → 27/27 suites passed
test/pop-seller.test.js — 87 assertions
```

## Rollback plan

```bash
rm test/pop-seller.test.js
```
Nothing else to undo.
