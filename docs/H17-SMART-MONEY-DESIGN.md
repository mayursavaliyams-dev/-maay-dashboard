# H17 — Institutional Smart Money Intelligence Engine
## Design Document (no code written)

> Self-contained. Paste into any assistant to continue this work.
> Written 2026-07-09 for **Antigravity Pro**. Every number below was measured against the files on disk.

---

## 0. Correction to the brief's premise

The H17 prompt opens: *"Prepared automatically after successful completion of H16."*

**H16 has not been completed.** Only its master prompt was written (`docs/H16-MASTER-PROMPT.md`).
Likewise **H14 and H15 are designs, not code.** And **C3 (atomic writes) is still uncommitted** —
`safe-write.js` exists, no writer uses it, and the ledger data-loss chain described in
`docs/C3-01-safe-write.md` is still live.

Nothing below depends on that being untrue, but a design built on a false status is a design built on sand.

---

## 1. The measurement that reshapes this entire module

### V1 — The underlying has **no volume**. Not "low volume". Zero. In every bar.

```
bt-data/nifty-1min.json      73,560 bars   volume nonzero:  0 / 73,560
bt-data/banknifty-1min.json  73,935 bars   volume nonzero:  0
bt-data/sensex-1min.json     73,937 bars   volume nonzero:  0

row shape: ["2025-09-01T09:15:00+05:30", 24432.7, 24513.9, 24432.7, 24512.7, 0, 0]
span: 2025-09-01 → 2026-06-18   (197 trading days)
```

This is not a data-quality bug. **A spot index is a computed number, not a traded instrument.** It has no
volume by construction. Volume exists on the *futures*, and H14's finding F3 established that the bhavcopy
files on disk contain only `FinInstrmTp = IDO` (index options) — **no `IDF` (index futures)** at all.

### What V1 destroys

The following sections of the H17 brief are **not computable from the data this platform holds**:

| requested | status |
|---|---|
| Volume Delta, Relative Volume, Volume Spike | **impossible** — no volume |
| Climax, Exhaustion, Absorption, Effort vs Result | **impossible** — all are volume-vs-price constructs |
| Volume Imbalance, Volume Profile, POC, Value Area | **impossible** |
| VWAP (on the underlying) | **impossible** — VWAP is volume-weighted |
| **Wyckoff: Spring, Upthrust, SOS, SOW, Accumulation, Distribution** | **impossible** — Wyckoff is *defined* as the relationship between effort (volume) and result (price). Without volume it is price patterns with Wyckoff names on them |
| Composite Operator model | **not falsifiable** with public data |
| Institutional Accumulation / Distribution | **not measurable** — requires order flow or holdings data |
| Order Block *strength* (if volume-scored) | must be re-defined without volume |

> **Rule H17-V1.** These features are **removed from scope**, not stubbed, not approximated, not
> "estimated from range". An engine that emits a "Wyckoff Spring" on volumeless data is inventing market
> structure — which the brief itself forbids.

### What V1 does **not** destroy

Everything derivable from OHLC alone remains:

Higher High / Higher Low / Lower High / Lower Low · swing structure · Break of Structure · Change of
Character · range / compression / expansion (ATR, realized vol) · equal highs / equal lows · liquidity
sweeps (wick beyond a prior extreme, close back inside) · Fair Value Gaps (the classic 3-bar imbalance) ·
premium / discount zones · optimal-trade-entry bands · order blocks defined **structurally** (the last
opposing candle before a displacement) rather than by volume · liquidity voids.

---

## 2. The pivot that makes this module worth building

In the Indian index market, **the institutional footprint is not in the index candles. It is in the option
chain.**

The index has no volume. The options do — and the platform already has that data, both live and EOD:

| evidence | source | status |
|---|---|---|
| Option **volume** (`TtlTradgVol`) | bhavcopy, live chain | **real, traded** |
| Option **open interest** and **ΔOI** | bhavcopy, live chain | **real** |
| Option **notional** (`TtlTrfVal`) | bhavcopy | **real** |
| Number of trades (`TtlNbOfTxsExctd`) | bhavcopy | **real** — and `notional / trades` gives an average
ticket size, the closest legitimate proxy for participant size available in public data |
| OI build-up classification (long build-up / short build-up / covering / unwinding) | derived from `Δprice × ΔOI` | **real, and standard** |

> **Architectural conclusion.** H17 must be **two engines, not one**:
>
> **(A) Price Structure Engine** — OHLC-only. BOS, CHOCH, sweeps, FVG, order blocks, premium/discount.
> Honest, computable, and explicitly *not* volume-aware.
>
> **(B) Option-Flow Participation Engine** — the actual "smart money" signal for this market. Built on
> option volume, ΔOI, notional and average ticket size. This is where institutional evidence exists.
>
> Fusing them is H15's job, not H17's.

This is not a workaround. It is a correction: importing an equity/FX ICT vocabulary into a cash-index feed
that has no volume produces a vocabulary, not a measurement.

---

## 3. Statistical reality — read before promising any "reliability"

### S1 — One regime, 197 days
The 1-minute history spans **2025-09-01 → 2026-06-18**. That is a single market regime. Any
"BOS accuracy: 68%" derived from it is an in-sample statistic about one regime, not an edge.

### S2 — The multiple-comparisons trap
The brief lists roughly **60 detectable patterns** (11 objectives × structure/liquidity/OB/FVG/ICT/Wyckoff
sub-signals). Testing 60 hypotheses on 197 days, at α = 0.05, yields **≈ 3 "significant" findings by chance
alone**. Ranking them and shipping the best is exactly how a backtest-overfit engine is born.

The platform already owns the correct instruments: `bt-validate.js` implements **deflated Sharpe**, **PSR**
and **purged k-fold with embargo**. Any H17 reliability claim must pass through them, with the number of
trials declared up front.

### S3 — Overlapping, autocorrelated events
Structural events are not independent samples. A BOS at 10:03 and its retest at 10:17 share the same
information. Effective sample size is far below the raw event count. Labels must be built with
López de Prado's **triple-barrier** method and **purged** folds — the same discipline `meta-label.js`
already documents.

### S4 — There is no ground truth
"False Positive Tests" require labelled positives. **No labelled smart-money events exist.** The platform
holds **41 labelled trade outcomes in total** (measured during H15). A false-positive rate cannot be
computed against a label set that does not exist.

> **Rule H17-S1.** H17 ships with `reliability: null` for every detector. Under H15's contract, an engine
> with `reliability: null` has **weight exactly 0** — it may **veto**, never **vote**. That is the correct
> and honest starting state, and it is enforced by H15's abstain matrix.

---

## 4. Detector specifications — measurable, not discretionary

Every detector is a **pure function of a bar window** with **declared, versioned parameters**. No
discretionary interpretation. Same input ⇒ same output, forever.

| detector | definition (parameterised) | params |
|---|---|---|
| Swing high / low | fractal: `high[i]` is the max of `[i−k, i+k]` | `k` |
| HH / HL / LH / LL | comparison of consecutive confirmed swings | — |
| **BOS** | close beyond the last confirmed swing in the trend direction | `confirmBars` |
| **CHOCH** | first BOS **against** the prevailing structure | — |
| Internal vs External BOS | swing degree: `k_internal < k_external` | `k_i`, `k_e` |
| Equal highs / lows | `|h₁ − h₂| ≤ ε · ATR(n)` within `w` bars | `ε`, `n`, `w` |
| **Liquidity sweep** | wick pierces an equal-high/low cluster **and** close returns inside within `m` bars | `m` |
| Failed sweep | sweep followed by a BOS in the sweep direction | |
| **FVG** | 3-bar imbalance: `low[i] > high[i−2]` (bullish) | min gap in ATR units |
| FVG fill / age | first touch of the gap; bars elapsed | |
| **Order block** | last opposing-colour candle before a displacement of `≥ d · ATR` | `d` |
| OB mitigation / breaker / invalidation | retest, flip, close beyond | |
| Premium / discount | fib bands of the last external swing range | |
| Liquidity void | ≥ `p` consecutive bars with range `< q · ATR` after displacement | `p`, `q` |
| Compression / expansion | ATR(n) or BB-width percentile vs trailing distribution | `n`, pct |

**Every parameter is a knob, and every knob is a chance to overfit.** Parameters must be declared in the
feature registry, versioned, and **frozen before any reliability is measured**. Tuning them against the
outcome set and then reporting accuracy is self-deception.

### Option-flow participation detectors (engine B)

| detector | definition |
|---|---|
| OI build-up class | `Δprice > 0, ΔOI > 0` → long build-up; `Δp < 0, ΔOI > 0` → short build-up; `Δp > 0, ΔOI < 0` → short covering; `Δp < 0, ΔOI < 0` → long unwinding |
| Average ticket size | `TtlTrfVal / TtlNbOfTxsExctd`, z-scored against the strike's own trailing distribution |
| Concentration | Herfindahl index of ΔOI across strikes — diffuse retail vs concentrated institutional |
| OI velocity / acceleration | 1st and 2nd difference of OI. **Daily resolution only** until intraday chains are captured |
| Strike migration | flow of ΔOI up/down the strike ladder relative to spot, via `strike-resolver.js` |

**Blocked:** anything requiring bid/ask, spread, depth, or trade-side classification. H14 established none
exists for NSE options. **Do not proxy it.**

---

## 5. EngineVerdict contract (H15-compatible)

H17 emits exactly one `EngineVerdict` per `(symbol, asOf)`, per H15's `contracts.js`:

```jsonc
{
  "engine": "smart-money",
  "engineVersion": "0.1.0",
  "status": "abstain",
  "score": null,                 // null, never 0 — 0 would claim neutrality
  "confidence": null,
  "reliability": null,           // never measured ⇒ H15 gives it weight 0 (veto-only)
  "sampleSize": 0,
  "freshnessMs": 900,
  "dataQuality": 1.0,

  "evidence": [
    { "fact": "structure", "value": "bullish", "source": "price-structure@0.1.0",
      "detail": { "lastBOS": "2026-07-09T10:03:00+05:30", "swingK": 5 } },
    { "fact": "sweep", "value": "sell_side_swept", "source": "liquidity@0.1.0" },
    { "fact": "oiBuildup", "value": "short_buildup", "source": "option-flow@0.1.0",
      "detail": { "strike": 24000, "dOI": 412000 } }
  ],

  "limitations": [
    "underlying volume is zero by construction — no volume-based evidence exists",
    "Wyckoff / absorption / effort-vs-result are OUT OF SCOPE (require volume)",
    "reliability unmeasured: 197 days, single regime, no labelled events"
  ],
  "missingEvidence": [
    { "input": "market-regime",  "reason": "module absent" },
    { "input": "event-calendar", "reason": "module absent" },
    { "input": "data-lake",      "reason": "H14 not built — no historical similarity" },
    { "input": "liquidity/spread","reason": "no bid/ask data exists for NSE options" }
  ],
  "requiredConfirmations": ["market-regime", "event-calendar"],
  "historicalSimilarity": null,
  "abstainReason": "market-regime and event-calendar absent; structure alone is insufficient",
  "assumptions": { "swingK": 5, "atrN": 14, "fvgMinAtr": 0.25 },
  "computedAt": "2026-07-09T14:22:01.123Z"
}
```

`score: null` is deliberate. `0` would be a claim of neutrality; `null` is an admission of ignorance.
H15's test suite asserts these produce **different decisions**.

**H17 never recommends a trade.** It has no `decision` field. It cannot.

---

## 6. Architecture

```
┌──────────────────┐   ┌───────────────────────┐   ┌──────────────────────┐
│ server.js :3000  │   │ smart-money :3400     │   │ meta-decision :3300  │
│ (live, paper)    │   │ (read-only, separate) │──▶│ (H15 arbiter)        │
│ NOT MODIFIED     │   │ emits EngineVerdict   │   │                      │
└──────────────────┘   └───────────┬───────────┘   └──────────────────────┘
                                   │ reads
                       ┌───────────▼────────────┐
                       │ bt-data/*-1min.json    │ (OHLC only, 197 days)
                       │ live option chain      │ (volume + OI — the real signal)
                       │ H14 lake (when built)  │
                       └────────────────────────┘
```

Separate process, port 3400. `server.js` gets **zero** changes. A crash in H17 cannot touch trading.

### Folder structure

```
smart-money/
  index.js                      # Express :3400, read-only
  routes/{smart-money,liquidity,order-block,fvg,market-structure,ict,institutional-score}.js
  core/
    bars.js                     # bar window abstraction; injected clock; deterministic
    swings.js                   # fractal swing detection (k-parameterised)
    structure.js                # HH/HL/LH/LL, BOS, CHOCH, internal vs external
    liquidity.js                # equal highs/lows, pools, sweeps, failed sweeps
    order-blocks.js             # structural OB, mitigation, breaker, invalidation
    fvg.js                      # 3-bar imbalance, fill, age
    zones.js                    # premium / discount / OTE / liquidity void
    regime-lite.js              # compression / expansion from ATR percentile ONLY
  option-flow/                  # ENGINE B — where institutional evidence actually is
    oi-buildup.js  ticket-size.js  concentration.js  strike-migration.js
  score/
    institutional-score.js      # composes sub-scores; refuses without coverage
  verdict/
    engine-verdict.js           # H15 contract; reliability=null ⇒ veto-only
  research/
    label.js                    # triple-barrier labelling
    validate.js                 # delegates to bt-validate.js (purged k-fold, DSR, PSR)
    preregister.js              # hypothesis registry: params frozen BEFORE measurement
  store/
    event-store.js              # append-only, via safe-write.js (C3)
  test/
data/smart-money/
  events.jsonl                  # append-only, hashed, never overwritten
  hypotheses.jsonl              # pre-registered, with trial count
  audit.jsonl
```

**NOT built:** `wyckoff.js`, `volume-profile.js`, `volume-delta.js`, `absorption.js`. Their absence is the
design. A `_removed.md` in the folder records why, so nobody re-adds them next quarter.

---

## 7. API

| method | path | notes |
|---|---|---|
| `GET` | `/smart-money?symbol&asOf` | the single `EngineVerdict` |
| `GET` | `/market-structure?symbol&asOf&k` | swings, BOS, CHOCH; `k` is explicit |
| `GET` | `/liquidity?symbol&asOf` | pools, equal highs/lows, sweeps |
| `GET` | `/order-block?symbol&asOf` | structural OBs, mitigation state |
| `GET` | `/fvg?symbol&asOf` | gaps, fill state, age |
| `GET` | `/ict?symbol&asOf` | premium/discount, OTE, voids |
| `GET` | `/institutional-score?symbol&asOf` | composite; **refuses below coverage floor** |
| `GET` | `/option-flow?symbol&asOf` | OI build-up, ticket size, concentration |
| — | `/wyckoff` | **deliberately absent.** Returns 501 with the reason |

`/wyckoff` returning **501 Not Implemented with an explanation** is better than returning a number. A 404
would suggest a missing route; a 501 with `"requires volume; the underlying has none"` teaches the caller.

Every response carries `{ class, limitations[], missingEvidence[], assumptions, engineVersion }`.
`asOf` makes every endpoint replayable and deterministic.

---

## 8. Database

Append-only `data/smart-money/events.jsonl` via **`safe-write.js` (C3)**. Every event carries
`eventHash` = sha256 of `(detectorVersion, params, barWindowHash)`. Never overwritten.

`hypotheses.jsonl` is the honesty ledger: **the parameter set and the number of trials are recorded before
any accuracy is computed.** Deflated Sharpe requires the trial count; a trial count discovered after the
fact is a number you chose.

---

## 9. Testing plan

| suite | proves |
|---|---|
| **Volume-absence guard** | Any module importing a volume field fails the build. Asserts `bt-data/*-1min.json` volume is 0 in 100% of bars |
| **`/wyckoff` returns 501** | The refusal is a test, not a comment |
| Characterization | Each detector on a frozen 5-day bar fixture → golden output. Pin before touching |
| Determinism / replay | Same bars + injected clock → identical `eventHash`, byte for byte |
| `null ≠ 0` | An abstaining detector never contributes `0` to the score |
| Coverage floor | `/institutional-score` refuses when sub-engines abstain |
| Parameter freeze | Changing `swingK` without bumping `engineVersion` fails |
| Pre-registration | Computing reliability without a `hypotheses.jsonl` entry throws |
| Purged CV | Label leakage test: a fold containing the label horizon must fail |
| Multiple comparisons | Reliability reported without a trial count fails |
| H15 contract | Output validates against `contracts.js`; `reliability: null` ⇒ H15 gives weight 0 |
| Performance | Full detector sweep over 1 session (375 bars) < 20 ms |
| False positives | **Cannot run today — no labelled events.** The suite exists and is `skip`ped with the reason recorded, not silently omitted |

The **volume-absence guard** is the most important suite here, exactly as the abstain matrix is in H15. It
is the executable form of "never invent market structure".

---

## 10. Migration plan

| step | deliverable | gate |
|---|---|---|
| **H17-00** | **Finish C3-02…C3-06** | the event store cannot use `writeFileSync` |
| H17-01 | `bars.js`, `swings.js` + characterization on a frozen fixture | determinism |
| H17-02 | `structure.js` (BOS, CHOCH) + golden tests | |
| H17-03 | `liquidity.js` (equal highs/lows, sweeps) | |
| H17-04 | `fvg.js`, `order-blocks.js`, `zones.js` | |
| H17-05 | `option-flow/` — **the real institutional signal** | EOD first; intraday when captured |
| H17-06 | `engine-verdict.js` → H15 contract, `reliability: null` | H15 abstain matrix accepts it |
| H17-07 | `event-store.js` append-only + `preregister.js` | reliability without pre-registration throws |
| H17-08 | `index.js` + API + `/wyckoff` → 501 | `server.js` diff empty |
| H17-09 | UI panel (read-only, calls :3400) | |
| *later* | reliability, once labelled outcomes ≥ 200 and ≥ 2 regimes exist | DSR/PSR with declared trials |

## 11. Rollback

```bash
bash scripts/rollback-H17.sh --check   # list; touch nothing
bash scripts/rollback-H17.sh           # remove smart-money/ code only
```

`data/smart-money/events.jsonl` and `hypotheses.jsonl` are **never deleted** — they are the research
record. `server.js` is untouched, so the trading side has no rollback surface.

## 12. Risk analysis

| risk | likelihood | impact | mitigation |
|---|---|---|---|
| **Shipping Wyckoff/volume features on volumeless data** | **High** — the brief asks for them | Fabricated market structure. Institutional-looking fiction | Removed from scope; volume-absence guard; `/wyckoff` → 501; `_removed.md` |
| Overfitting 60 patterns to 197 days | **High** | ≈3 false discoveries by chance at α=0.05 | Pre-registration + trial count + deflated Sharpe (`bt-validate.js`) |
| Reporting reliability from one regime | High | An "edge" that dies on the next regime | `reliability: null` until ≥ 2 regimes; H15 gives weight 0 |
| Overlapping events treated as independent | High | Inflated significance | Triple-barrier labels, purged folds, embargo |
| Parameter tuning against outcomes | High | Self-deception | Params frozen in `engineVersion`; changing them without a bump fails the build |
| `score: 0` read as neutral | Medium | Silent bias | `null ≠ 0`, asserted |
| ICT vocabulary implying rigour it lacks | Medium | False confidence | Every detector is a declared formula with parameters. No discretion |
| Event store corrupted | Medium | Research record lost | Requires C3. Append-only + hash |
| H17 destabilises trading | **Zero** | — | Separate process, read-only, no engine modified |

## 13. Performance

- 197 days × 375 bars = ~74 k bars per symbol. Trivial.
- Full detector sweep over one session: target **< 20 ms**; over the whole history: **< 3 s**.
- Detectors are `O(n)` with a bounded lookback; swings are `O(n·k)`.
- `events.jsonl` ≈ 300 B/event. Even at 200 events/day/symbol that is ~20 MB/year. Irrelevant.
- `asOf` replay must not read `Date.now()`. The clock is injected — the same discipline already applied to
  `instrument-registry.timeToExpiryYears(inst, now)`.

## 14. Future expansion

1. **Capture intraday option chains today.** This is the single highest-value action for H17, H16 and H14
   alike. Option flow — not index candles — is where institutional evidence lives in this market, and the
   intraday series does not exist yet. Every day of delay is a day permanently lost.
2. **Ingest index futures (`IDF`)** in H14. That restores real volume, and with it a *legitimate* volume
   engine: delta, profile, absorption, and a defensible Wyckoff module. **Wyckoff is not wrong — it is
   simply not computable on a spot index.** Futures data makes it computable.
3. Reliability learning once ≥ 200 labelled outcomes and ≥ 2 regimes exist.
4. Historical similarity via H14's feature store, with purge and embargo.
5. Regime-conditional detector parameters — only after a Market Regime engine exists and there is enough
   data per regime. Not on 197 days.

## 15. What this design deliberately refuses to do

- It will not compute Volume Delta, Volume Profile, POC, Value Area, absorption, climax, exhaustion, or
  effort-vs-result. **The underlying has no volume.**
- It will not ship a **Wyckoff** engine. Wyckoff is defined by effort vs result; without volume it is
  price patterns wearing Wyckoff's name.
- It will not model a **Composite Operator**. It is not falsifiable with public data.
- It will not report **institutional accumulation/distribution** from price alone.
- It will not emit a **reliability** number from one regime, 197 days and zero labelled events.
- It will not return `0` where it means "unknown".
- It will not recommend a trade. It emits an `EngineVerdict`. **H15 decides.**

## 16. Open decisions for the owner

1. **Finish C3 first?** The event store and the hypothesis ledger must not be truncatable on crash.
2. **Accept the split into Price Structure (A) + Option Flow (B)?** B is where the institutional signal
   actually is in this market. A alone is ICT vocabulary on a volumeless feed.
3. **Ingest index futures (`IDF`) into H14?** That is what makes a real volume engine — and a real Wyckoff
   engine — possible. Until then they stay out of scope.
4. **Start capturing intraday option chains today?** It gates H14, H16 and H17 simultaneously.
