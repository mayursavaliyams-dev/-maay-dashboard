# Strategy POC — "Premium ~15 → 100-pt Trend Ride → 30-35 (+trail)"

> **Grade: ESTIMATED / near-UNKNOWN.** A 9-day proof-of-concept, not a verified
> edge. Read the verdict before acting. Self-contained for external review.

---

## 1. The idea (as specified)

Buy a **single trend-side** index option (index up-move → CE, down-move → PE)
when:
- its **premium is ~15** and **rising** (momentum "++"), and
- the **underlying has moved ≥100 points** in that direction (the trend trigger), and
- (ideally) an **OI + volume surge** confirms.

Then **ride it toward 30-35**, managing with a **trailing exit + expiry
square-off**. Buy-side, expiry/gamma-blast family.

This is structurally the same animal as the existing **gamma-blast** engine
(0-DTE directional buying), so the natural code home is that engine.

---

## 2. Where the "100-point" rule goes in the code  (the direct question)

The whole entry already has a home in the gamma-blast detector; the 100-point
trigger is a **one-parameter + one-line** addition.

### 2a. `gamma-blast-params.js` — add the absolute-point trigger (section #7)

```js
// ── 7. UNDERLYING TRIGGER — the move that lights the fuse ───────────────────
triggerMovePct:     N('GB_TRIG_PCT', 0.12),   // existing: index ≥0.12% pop
triggerMovePoints:  N('GB_TRIG_PTS', 100),    // NEW: OR ≥100 absolute points
preRangeWindowMin:  N('GB_PRE_WIN', 15),
```

### 2b. `gamma-blast-detect.js` — use it in the `trigger` condition

The detector already computes the spot move (lines 40-41). Add the absolute leg:

```js
// line 40-41 already have sPast; add the point move:
const spotMovePts = (sPast) ? (spot - sPast.v) : 0;

// line 51 — was: trigger: Math.abs(spotMovePct) >= P.triggerMovePct
trigger: Math.abs(spotMovePct) >= P.triggerMovePct
      || Math.abs(spotMovePts) >= P.triggerMovePoints,   // ← 100-pt rule
```

Tune per instrument with env (no code edit): `GB_TRIG_PTS=100` for NIFTY, a
larger value for BANKNIFTY (100 BANKNIFTY points ≈ 0.17%, small).

### 2c. The premium-~15 entry — a NEW selection, not yet in the engine

Gamma-blast currently triggers on **ATM-straddle velocity**, then buys the
breakout side's ATM(±1). It does **not** "pick the leg whose premium ≈ 15".
To honour the spec, add to `gamma-blast-params.js`:

```js
entryPremLo: N('GB_ENTRY_LO', 13),
entryPremHi: N('GB_ENTRY_HI', 17),   // ~15 band
```

and in `gamma-blast-engine.js` leg-selection, instead of ATM, choose the
trend-side strike whose live premium is inside `[entryPremLo, entryPremHi]`
(this is typically a slightly-OTM strike). Exit/trail/square-off logic already
exists in the engine — reuse it.

**Net:** the 100-pt trigger = params #7 + one line in the detector. The
premium-15 leg pick = 2 params + the strike-select tweak in the engine.

---

## 3. Can it be backtested? — the honest data picture

- **No intraday option-premium history exists** for a real backtest — the
  gamma-blast engine itself documents this (`gamma-blast-engine.js:18`,
  "CANNOT be backtested here").
- We have exactly **9 days** of 1-min option-premium candles
  (`data/opt-candles/`, 2026-07-06 → 2026-07-20), and these **auto-delete**
  after 40 files (active data loss — see the warehouse design H19).
- The external 1-min **underlying** feed ends **2026-06-19** — *zero overlap*
  with the option days, so it cannot supply the 100-pt gate.
- **Volume / OI is not stored** in opt-candles (premium OHLC only) → the
  OI+volume confirmation **cannot be tested** and was **omitted** from the POC.

### Underlying reconstructed from the chain (put-call parity)

Because deep-ITM legs are frozen/illiquid, spot was rebuilt from **liquid
near-ATM strikes** via parity: `S ≈ K + CE − PE` (median across strikes).
Validation: on 2026-07-20 this gave NIFTY ≈ 24 121-24 266 and
BANKNIFTY ≈ 57 720-58 158 — consistent with the live tape (server logged
NIFTY ~24 117 the same day). Day-swing NIFTY 146 pts / BANKNIFTY 438 pts.

---

## 4. POC method

For each of the 9 days, for every NIFTY/BANKNIFTY CE & PE 1-min series:
- **Entry** when premium ∈ [13,17], rising vs 15 min ago, AND reconstructed
  spot moved ≥100 pts in the leg's direction over the last 15 min.
- **Exit**: hard stop at 60% of entry (~9); once premium ≥ 22, trailing exit on
  a 25% give-back from peak; square-off at 15:15.
- One position per series at a time. No slippage/spread/charges modelled
  (so real-world would be **worse**). No look-ahead (entry uses only
  past/current bars; exit walks forward).

Script: `scratchpad/poc-prem15-ride.js` (POC only — not wired into the app).

---

## 5. Results

### Raw (per-strike)
| Metric | Value |
|---|---|
| Signals | 83 |
| Win rate | 57.8% (48/83) |
| Avg outcome | **+6.53 premium pts / trade** (entry ~15) |
| Reached 30+ (peak) | 24 (28.9%) · reached 35+ 21 (25.3%) |
| Exit mix | square-off 58 · trail 20 · stop 5 |
| NIFTY | 24 tr · 50% win · +8.67 avg · 38% hit 30+ |
| BANKNIFTY | 59 tr · 61% win · +5.66 avg · 25% hit 30+ |

### De-correlated (the honest view — 1 event = day+instrument+side)
The 83 "trades" are **not independent**: on a trend day a whole wing of
adjacent strikes fires together. Collapsing correlated strikes into one event:

| Metric | Value |
|---|---|
| Distinct events | **10** |
| Event win rate | **40% (4/10)** |
| Avg pts / event | **+0.88** (entry ~15) |
| Events reaching 30+ | **2 / 10** |

Per event:

| Day | Inst | Side | Legs | Avg pts | 30+ |
|---|---|---|---|---|---|
| 2026-07-08 | NIFTY | PE | 17 | **+14.4** | ✅ |
| 2026-07-08 | BANKNIFTY | PE | 30 | **+11.8** | ✅ |
| 2026-07-08 | BANKNIFTY | CE | 4 | −0.4 | |
| 2026-07-14 | BANKNIFTY | CE | 2 | +0.2 | |
| 2026-07-15 | NIFTY | PE | 6 | −4.9 | |
| 2026-07-15 | BANKNIFTY | PE | 10 | −1.1 | |
| 2026-07-15 | BANKNIFTY | CE | 4 | −0.7 | |
| 2026-07-17 | NIFTY | CE | 1 | −6.6 | |
| 2026-07-17 | BANKNIFTY | PE | 2 | −4.4 | |
| 2026-07-17 | BANKNIFTY | CE | 7 | +0.4 | |

---

## 6. Verdict

- The setup **exists and fires** (~10 events / 9 days) and the raw per-strike
  average is positive (+6.5 pts).
- **But the entire positive result comes from ONE day (2026-07-08)**, a strong
  trend day where both PE wings blasted (+14.4 / +11.8 pts). Strip that day and
  the strategy is **net negative**. 8 of 10 events were flat-to-losing.
- This is the **textbook asymmetric buying profile** the gamma-blast doc warns
  about: many small losses, rare large winners — judge by net expectancy over
  *many* expiries, never win-rate, and **never on 9 days**.
- **10 events is far too few to conclude anything.** Grade: **ESTIMATED,
  bordering UNKNOWN.** This is *not* evidence of an edge; it is evidence that
  (a) the pattern is real and codeable, and (b) its payoff is trend-day-lottery
  shaped, so position sizing and survival between winners decide everything.
- Real-world would be **worse** than shown: no slippage, spread, or charges are
  modelled, and the untested OI/volume gate would remove some (good and bad)
  trades.

---

## 7. Recommendation (institutional)

1. **Do not treat this as validated.** Same status as gamma-blast: **paper
   forward-test only**, off by default, never a live order path without
   explicit instruction.
2. **Wire it into the gamma-blast engine** (Section 2) behind env flags so it
   forward-tests live alongside the existing detector, logging every fire.
3. **Fix the data-loss first** (H19): persist opt-candles instead of
   auto-deleting after 40 files, and start capturing **volume/OI** in the
   candle rows — without that, the OI/volume gate can never be evaluated and no
   real backtest will ever be possible.
4. **Collect ≥6-12 months of forward-tested events** before any edge claim.
   Then re-grade Verified/Measured/Estimated and size with the VIX/Kelly sizer,
   assuming most days lose small and a few trend days pay.

---

## 8. Files

| File | Role |
|---|---|
| `gamma-blast-params.js` | add `triggerMovePoints`, `entryPremLo/Hi` |
| `gamma-blast-detect.js` | add absolute-point leg to `trigger` (line 51) |
| `gamma-blast-engine.js` | trend-side premium-~15 leg pick; trail/square-off already present |
| `data/opt-candles/` | the only intraday premium data (9 days, auto-deleting) |
| `scratchpad/poc-prem15-ride.js` | this POC (parity-spot reconstruction + sim) |
| `scratchpad/bt-trend-followthrough.js` | the big 198-day / 1816-event underlying test |

---

## 9. The "1200 expiries" test — what is actually possible, and the result

**A real 1200-expiry backtest of this strategy is impossible.** It needs
intraday option-premium history; we have **9 days**. The repo's "1200" infra
(`backtest-real/`) prices with **`synth-option-pricer.js`** — synthetic premiums
the codebase itself says "cannot validate edge" (0-DTE BSM is unreliable). Real
underlying 1-min only spans **198 days** (2025-09 → 2026-06-19), not 1200.

So instead of fabricating a synthetic 1200, we tested the **falsifiable real
core**: after a 100-pt/15-min move out of a coiled range, does the index
**follow through**? P&L in **real index points, no modeling** — over **1816
trigger events** across 198 days.

| Slice | Trades | Win% | Avg pts | PF | Verdict |
|---|---|---|---|---|---|
| **ALL** | **1816** | **36%** | **−4.0** | **0.84** | net LOSER |
| NIFTY | 120 | 41% | −0.0 | 1.00 | break-even (pre-cost) |
| BANKNIFTY | 1696 | 35% | −4.3 | 0.83 | net loser |
| **Expiry-day (Tue) only** | 347 | 36% | **−6.4** | **0.74** | **worse on expiry** |
| Non-expiry | 1469 | 36% | −3.4 | 0.86 | net loser |

Shape: **110 big winners (≥100 pts) vs 1167 losers vs 539 small-positive** —
after the pop, the index **mean-reverts / chops more often than it continues**.

**Nuance that matters:** average **MFE = +62 pts** — price *does* poke ~62 pts
in-direction before pulling back. A ~15-premium 0-DTE leg (~0.5 delta) would see
that peak as roughly premium 15 → ~45, which is exactly why the 9-day POC saw
"reached 30+". **The ride is real; the continuation edge is not.** Net P&L is
negative because the move reverses past any sane trailing exit.

### Conclusion
- The strategy's **directional premise has no edge** (PF 0.84 over 1816 events;
  **0.74 on expiry days** — the opposite of what the idea assumes).
- Because the *underlying* follow-through is a net loser, the **leveraged option
  version cannot be better** — theta + bid/ask spread only subtract.
- The 9-day POC's apparent +6.5 pts was **one trend day (2026-07-08)**; at scale
  it disappears. This is a **MEASURED** refutation of the edge, not a small
  sample.
- What remains is an **MFE-capture / exit-timing problem**, not a directional
  edge: the only way this profits is perfectly grabbing the transient +62-pt
  excursion, which is fragile and easily curve-fit. Not a foundation to trade.

**Institutional call (revised in §10): the premise wasn't dead — the EXIT was.**
The loss above came from a *trailing* stop giving back the +62 MFE. §10 shows a
fixed asymmetric bracket flips it positive out-of-sample. The remaining gate is
option cost, not direction. Fixing intraday premium+OI/volume capture (H19) is
still the prerequisite for ever testing the *option* leg honestly.

---

## 10. "What to adjust for profit" — exit fix, validated out-of-sample

Because avg MFE was **+62 pts** but the trailing exit lost, the adjustment is the
**exit**: replace the trail with an **asymmetric fixed bracket — big target, tight
stop** (let the impulse run, cut the chop fast). Swept 36 configs per instrument,
**optimised on the first 70% of days, validated on the last 30%** (chronological
out-of-sample, anti-overfit).

| Instrument | Configs profitable in-sample | …that SURVIVED out-of-sample |
|---|---|---|
| NIFTY | 8 / 36 | **8 / 8** |
| BANKNIFTY | 18 / 36 | **14 / 18** |

Best-by-train, shown on the held-out test set:

| Inst | Trigger | Target | Stop | TRAIN PF | **TEST PF** | TEST avg |
|---|---|---|---|---|---|---|
| NIFTY | 100 | **+60** | **−30** | 1.38 | **1.34** ✅ | +5.9 pts |
| NIFTY | 100 | +50 | −30 | 1.30 | **1.64** ✅ | +9.4 pts |
| NIFTY | 100 | +40 | −30 | 1.21 | **1.57** ✅ | +7.7 pts |
| BANKNIFTY | 150 | **+130** | **−80** | 1.17 | **1.14** ✅ | +6.2 pts |
| BANKNIFTY | 150 | +130 | −40 | 1.20 | **1.22** ✅ | +6.2 pts |
| BANKNIFTY | 250 | +70 | −60 | 1.09 | **1.32** ✅ | +9.0 pts |

**The adjustment that creates profit:**
1. **Exit = fixed asymmetric bracket, not a trail.** Target ≫ stop.
   - NIFTY: **target +50-60, stop −25-30** (win ~42%, PF ~1.3-1.6 OOS).
   - BANKNIFTY: **target +100-130, stop −60-80** (PF ~1.1-1.2 OOS).
2. **Stronger trigger helps BANKNIFTY**: 150 (or 250) beats 100 — filters chop.
3. Win rate stays low (~42%); the edge is **reward:risk asymmetry**, not hit-rate.
   Do NOT tighten the target to "feel" like winning — that kills the edge.

**Why this is more than curve-fit:** a *coherent* pattern (asymmetric bracket)
survived out-of-sample across **both** instruments and **most** configs (8/8 and
14/18), not one lucky setting. That is a real directional signature.

**The remaining gate — option cost (unchanged, decisive):** these are **gross
underlying points**. A ~15-premium 0-DTE leg is ~0.4-0.5 delta, so NIFTY's
+6 gross pts ≈ **+3 premium points before theta and bid/ask spread** — and
spread alone on a ₹15 option is ~0.5-1 pt each way. So the option-net could still
be thin or negative. This is a **forward-test candidate, not a verified edge**:
- Wire the bracket exit (target/stop above) into the gamma-blast engine, paper,
  default-off, per-instrument env knobs.
- Forward-test the **actual option leg** (real fills/spread) for ≥3-6 months.
- Only then re-grade. Underlying direction is now MEASURED-positive; the option
  P&L after costs remains UNKNOWN until forward-tested.

---

## 11. Two regime filters — trend-follow + sideways skip (validated, shipped)

Added to `trend-ride-engine.js`; each env-toggleable, each self-contained from the
spot buffer.

### Filter 1 — trend alignment (trade WITH the broader trend)
Only take CE above / PE below a **60-minute SMA** of spot.

> **Why 60, not 30:** a 30-min SMA is dragged past itself by the very 15-min
> impulse being traded, so it green-lights counter-trend fades — measured WORSE
> (NIFTY PF 1.36→1.33, PUT −312→−372). A 60-min SMA stays put. A trend-reference
> bake-off (none / sma30 / sma60 / dayOpen / preMoveSma / prevClose) put sma60
> first on both indices.

### Filter 2 — chop / sideways skip (Kaufman efficiency ratio)
ER = |net move| / |path length| over 15 min. `ER ≥ 0.35` = clean trend, below =
choppy → skip. Near-neutral on P&L; provides the sideways-detection the baseline
lacked.

### Result — both filters, out-of-sample split (train 70% / test 30%)

| Instrument | Baseline PF | Filtered PF | Filtered TEST PF | Effect |
|---|---|---|---|---|
| NIFTY | 1.36 (+730) | **1.59 (+790)** | **1.54** held | n 121→89, avg +6.0→+8.9, PUT −312→−132 |
| BANKNIFTY | 1.15 (+5019) | **1.23 (+5160)** | **1.27** held | n 731→527, avg +6.9→+9.8 |

Improvement HOLDS out-of-sample on both indices — fewer, higher-quality trades;
counter-trend losers cut. Defaults: `trendMaMin 60`, `minER 0.35`, both ON.
Env: `TR_TREND_FILTER`, `TR_TREND_MA_MIN`, `TR_CHOP_FILTER`, `TR_MIN_ER`. Still
GROSS points — the option-cost gate (§10) is unchanged; forward-test measures net.

### CE vs PE
Neither side has an inherent edge — the engine follows the move direction. In this
sample NIFTY favoured CALL (filtered PF 2.34) because it drifted up 2025-09→2026-06;
BANKNIFTY favoured PUT (PF 1.40). That is regime, not a rule — the trend filter
already aligns direction with the prevailing trend; do NOT hardcode a side.
