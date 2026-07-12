# EVIDENCE PACKAGE — F4: the unit of Open Interest

**Status: STEP 1 (Evidence) complete. STEP 2–4 not performed.** No code was changed. No architecture
was approved. Nothing was implemented.

**Question.** Constraint **F4** has stood as `UNVERIFIED` since this project began: is `oi` a count of
**contracts**, or a count of **units (shares)**? Every GEX, dealer-positioning and gamma-wall figure is
wrong by the lot size — **65× for NIFTY today** — if this is guessed.

**Answer, by measurement: `oi` is expressed in UNITS. `contracts = oi / lot`.**

Reproduce: `node scripts/verify-oi-unit.js [csvPath]` — exit 0 = determined, exit 2 = INSUFFICIENT EVIDENCE.

---

## Source

**NSE's own UDiFF F&O bhavcopy** — the exchange's official end-of-day file, already in this repository
at `bt-data/bhav/nifty-YYYYMMDD.csv` (600 files). No third-party feed, no web page, no summary.

Columns were read off a real row, not assumed:
`[22] OpnIntrst · [23] ChngInOpnIntrst · [24] TtlTradgVol · [25] TtlTrfVal · [28] NewBrdLotQty`

## Test 1 — What unit is `TtlTradgVol` in? Turnover arithmetic settles it.

`nifty-20260617.csv`, lot 65, 990 rows with volume > 0. A ratio of 1.00 identifies the true relation:

| hypothesis | median ratio |
|---|---|
| `turnover = vol × premium` (vol = units) | 14566.09 |
| `turnover = vol × lot × premium` (vol = contracts) | 224.09 |
| **`turnover = vol × lot × underlying`** (vol = contracts, turnover = notional) | **1.0063** |
| `turnover = vol × underlying` (vol = units) | 65.41 |

**`TtlTradgVol` is in CONTRACTS.** The 0.63% deviation from 1.00 is intraday price drift: turnover
accrues at each trade's underlying, not at the close.

This column becomes the **control** for Test 4.

## Test 2 — `OpnIntrst`, divisibility by the lot

If OI counts units, every position is a whole number of lots, so `OI ≡ 0 (mod 65)`.
If OI counts contracts, divisibility is coincidence at ~1.5%.

```
divisible by 65: 1105 / 1203 = 91.9%
```

**91.9%, not 100%.** A weaker analyst stops here and calls it settled. The residue is 8%, and 8% is not
noise at n = 1203. **It had to be explained before anything could be concluded.**

## Test 3 — The residue, grouped by expiry

```
expiry        rows  div    %
2026-06-23     186   186  100%
2026-06-30     279   252   90%      <-- a NEAR expiry, and not 100%
2026-07-07     137   137  100%
2026-07-14     105   105  100%
2026-07-28     196   196  100%
2026-08-25     154   154  100%
2026-09-29      27    20   74%
2026-12-29      44    14   32%
2027-06-29       6     1   17%
2029-06-26       2     0    0%
```

My first hypothesis — *"only far-dated contracts degrade"* — **is wrong.** `2026-06-30` is thirteen days
away and sits at 90%. **The script's own gate returned `INSUFFICIENT EVIDENCE` at this point, and it was
right to.**

Inspecting the 27 offending rows in that expiry: **all 27 are divisible by 5. None by 65. None by 75.**

## Test 4 — The decisive test, with a control inside the same file

A strike's OI is the **sum of every open position**, and NIFTY's lot has been **50 → 25 → 75 → 65**
(constraint F1). If OI counts units, each position contributes a multiple of the lot *in force when it
was opened*, so OI must be a multiple of **gcd(65, 75, 50, 25) = 5** — on every row, without exception.
If OI counts contracts, it is a raw integer, and ~1-in-5 rows are divisible by 5 by chance.

`TtlTradgVol` is the control: same file, same rows, a column Test 1 already proved counts contracts.

| column | % divisible by 5 | % divisible by 65 | n |
|---|---|---|---|
| `OpnIntrst` | **100.0%** | 91.9% | 1203 |
| `ChngInOpnIntrst` | **100.0%** | 97.1% | 935 |
| `TtlTradgVol` *(control)* | **19.4%** | 0.6% | 990 |

The control lands exactly on chance: 19.4% ≈ 20%, and 0.6% ≈ 1.5%. **`OpnIntrst` does not behave like a
raw count. It behaves like a quantity of shares that is always a whole number of lots.**

Under the contracts hypothesis, observing 1203 consecutive rows divisible by 5 has probability
`(1/5)^1203`. That is not a p-value; it is an impossibility.

## Corroboration

- **Live Upstox feed**, NIFTY, 2026-07-10, 198 legs: **196 / 196 non-zero `oi` values divisible by 65
  (100%)**. Weekly-expiry positions were all opened under the current lot, so the residue vanishes —
  exactly as the units hypothesis predicts.
- **Magnitude:** max `OpnIntrst` = 90,25,225 units = **1,38,850 contracts**. A plausible NIFTY figure.
  As contracts it would be 90 lakh contracts, which is not.
- **A second date, a different lot:** `nifty-20240108.csv`, `NewBrdLotQty 50`, 1488 rows — same verdict.
  The conclusion is not an artefact of one file or one lot size.

## Extension — all five NSE index options, same file, same date

`bt-data/bhav/` holds only `nifty-*.csv`, because `bt-bhav-fetch.js:34` filters on `,NIFTY,`. The full
UDiFF bhavcopy for 2026-06-17 was downloaded (HTTP 200, 1,374,595 bytes, 44,508 rows) and the other
index symbols extracted. **The script was run unchanged.**

| symbol | lot | `OI ÷ 5` | `OI ÷ lot` | `VOL ÷ 5` | `VOL ÷ lot` | n(OI) | verdict |
|---|---|---|---|---|---|---|---|
| NIFTY | 65 | **100.0%** | 91.9% | 19.4% | 0.6% | 1203 | UNITS |
| BANKNIFTY | 30 | **100.0%** | 100.0% | 19.3% | 3.5% | 653 | UNITS |
| FINNIFTY | 60 | **100.0%** | 100.0% | 21.6% | 1.6% | 167 | UNITS |
| MIDCPNIFTY | 120 | **100.0%** | 100.0% | 21.6% | 1.0% | 284 | UNITS |
| NIFTYNXT50 | 25 | **100.0%** | 100.0% | 5.9% | 0.0% | 48 | UNITS |

**Five symbols. Five different lot sizes. `OI ÷ 5 = 100.0%` on every one.** The control column behaves
like chance on every one. BANKNIFTY's Test 1 ratio is exactly **1.0000**.

NIFTY is the only symbol below 100% on `OI ÷ lot`, and constraint F1 explains why: its lot has changed
(50 → 25 → 75 → 65), so long-dated contracts hold positions opened under an older lot. The other four
show no such residue — consistent with, not contradicted by, the units hypothesis.

## Scope of the claim — stated, not implied

**Verified:** NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50 — on **NSE**, in the UDiFF bhavcopy.
Plus the **Upstox live chain feed** for NIFTY (196/196 legs divisible by 65).

**NOT verified, and therefore still `UNVERIFIED`:**

- **SENSEX and BANKEX (BSE).** A different exchange, a different file format. **Nothing in this package
  says anything about BSE.** The test must be **rewritten**, not reused: it depends on UDiFF's column
  positions and on `NewBrdLotQty` being present in the row.
- The **live feed** was checked only for NIFTY. BANKNIFTY and SENSEX chains were not sampled.
- The `changeOI` field of the **live feed** (as opposed to the bhavcopy's `ChngInOpnIntrst`) was not
  tested independently; it is assumed to share `oi`'s unit, and that assumption is **not** evidence.

## Confidence

| dimension | rating | basis |
|---|---|---|
| Data confidence | **HIGH** | the exchange's own end-of-day file, 1,808 rows, two dates, two lot sizes |
| Evidence confidence | **HIGH** | four independent tests, one with an internal control |
| Statistical confidence | **HIGH** | the control column lands on chance (19.4% vs 20%); the OI column at 100.0% |
| Research confidence | **n/a** | no research step was performed |
| Architecture confidence | **n/a** | no architecture was reviewed |
| **Overall** | **HIGH for all five NSE index options. UNKNOWN for BSE (SENSEX, BANKEX).** | |

## What this unblocks — and what must NOT happen next

Verifying F4 removes the reason GEX, dealer positioning and both gamma-wall events were withheld
(`docs/OPTIONS-INTELLIGENCE-ENGINE.md` §6). **That does not make them correct.** GEX additionally
requires:

- the **dealer-sign convention** — this repository has **two GEX implementations that disagree**:
  `gex-skew.js` uses `r = 0.065`, `vol-context.js` uses `r = 0` **and the opposite dealer sign**;
- gamma per unit vs per contract, consistently applied;
- and, for NIFTY, `gamma` is `0` on 33 of 198 legs, where the feed cannot distinguish a true zero from
  an absent value (`gammaQuality: ambiguous_zero`).

**Do not ship GEX on the strength of this document.** It settles one input of three.

## Open questions

1. ~~Does the same hold for BANKNIFTY?~~ **ANSWERED.** Yes — and for FINNIFTY, MIDCPNIFTY and NIFTYNXT50.
2. Does it hold on **BSE** for SENSEX and BANKEX? Different format; the test must be **rewritten**, not reused. This is the only remaining gap.
3. Does the **live feed's** `changeOI` share the unit of its `oi`? Testable against the bhavcopy's
   `ChngInOpnIntrst` on any matching date.
4. Which dealer-sign convention is correct — and why do two modules in this repository disagree?

## Approval status

**INSUFFICIENT DATA to approve any implementation.**

Evidence for F4 (NIFTY) is collected and reproducible. The research, audit and architecture steps of the
orchestration workflow have **not** been performed, and this document does not substitute for them.

**Recommended next step:** `instrument-registry.js` may carry `oiUnit: 'UNITS'` for the five **NSE**
index options, and **`oiUnit: null` — not `'UNITS'` — for SENSEX and BANKEX.** BSE was never tested.
**Unknown must not become fact by adjacency.**

That registry change is an **implementation**. Per the orchestration charter it requires STEP 2 (research),
STEP 3 (audit) and STEP 4 (architecture review) first. This document performs **STEP 1 only.**
