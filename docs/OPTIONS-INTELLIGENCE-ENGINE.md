# OPTIONS INTELLIGENCE ENGINE — DESIGN

**Purpose.** Observe the option chain exactly as it exists. Never estimate, never interpolate, never
fill, never predict. No BUY, no SELL, no EXIT. Publish only an `EngineVerdict`.

**Status: design only. No code written.**

Every number below was measured against the **running server** on 2026-07-10 (`upstox` feed, NIFTY,
99 strikes × 2 sides = 198 legs) and against `data/opt-candles/*.json`. Nothing is assumed.

---

## 0. THE SPECIFICATION MEETS THE DATA

The brief demands a set of fields. Here is what the feed actually delivers, per leg, across all 198:

| field | non-zero | zero | null | verdict |
|---|---|---|---|---|
| `ltp` | 196 | 2 | 0 | **measurable** |
| `oi` | 196 | 2 | 0 | **measurable** (unit unverified — see F4) |
| `changeOI` | 174 | 24 | 0 | **measurable** |
| `volume` | 188 | 10 | 0 | **measurable** (10 legs never traded today) |
| `iv` | 196 | 2 | 0 | **partly measurable** — see below |
| `high` | 196 | 2 | 0 | **measurable** |
| `low` | 196 | 2 | 0 | **measurable** |
| `bid` / `ask` | 198 | 0 | 0 | **measurable** — a two-sided quote on **100%** of legs |
| `bidQty` / `askQty` | 198 | 0 | 0 | **measurable** |
| `delta` | 198 | 0 | 0 | **measurable** |
| `theta` | 198 | 0 | 0 | **measurable** |
| `gamma` | 165 | **33** | 0 | **ambiguous** — see below |
| `vega` | 165 | **33** | 0 | **ambiguous** — see below |
| **`open`** | **0** | **198** | 0 | **UNMEASURABLE. The field exists and is never populated.** |
| **`close`** | 198 | 0 | 0 | **MISLABELLED.** `close === prevClose` on **198 / 198** legs. It is *yesterday's* close |
| **`settlement`** | — | — | — | **ABSENT from the feed entirely** |

### Three refusals, forced by the data

**1. `open` does not exist.** The brief asks every strike object to carry `Open`. The feed returns `0`
for **every leg, every time**. A per-strike opening premium can only be *reconstructed* — the first LTP
observed after 09:15 — and that is an observation of our polling, not of the market's open. It will be
stored as `firstObservedLtp` with its timestamp, and `open` will be **`null`**. It will never be
silently aliased to the first tick.

**2. `close` is yesterday.** Storing the feed's `close` as today's close would be a lie by field name.
Today's close is only knowable **after 15:30**, as the last observed LTP. Until then: `close: null`,
`prevClose: <feed value>`.

**3. `settlement` cannot be produced.** It is not in the feed. It arrives in the exchange bhavcopy after
the session. The engine will expose `settlement: null` and a `settlementSource: null`, and a separate
ingest may fill it later — **as a distinct, timestamped observation**, never as a backfill of the tick.

### IV is only 78% observed

```
IV observed by feed : 155 / 198
IV computed by us   :  43 / 198   (ivSource: "bsm")   -> 21.7% of IVs are DERIVED, not observed
```

The chain already tags this with `ivSource`. **The engine must carry that tag through every derived
metric.** An "IV expansion" event computed from a `bsm` IV is an event about *our Black-Scholes
inversion*, not about the market. It gets `confidence: 'derived'` and a named assumption (`r`, `q`,
which F3 says are assumptions, not observations).

### `gamma: 0` and `vega: 0` are ambiguous, and must be treated as such

33 legs report exactly `0`. Deep-OTM gamma genuinely approaches zero — but a feed that has no value and
sends `0` is indistinguishable from a feed reporting a true zero. **We cannot tell these apart.**

The engine will store the raw value **and** a `greekQuality` flag: `observed | ambiguous_zero`. Any
metric built on an `ambiguous_zero` inherits `confidence: null`. This is the `Unknown ≠ Zero` rule
applied to a field where the feed itself has erased the distinction.

---

## 1. WHAT THE HISTORY ACTUALLY CONTAINS

The brief asks for a minute-by-minute timeline of *high, low, premium, OI, volume, spread, IV, bid,
ask*. Here is what is on disk today, in `data/opt-candles/`:

| day | strikes | bars/strike (median) | distinct minutes | window (IST) |
|---|---|---|---|---|
| 2026-07-06 | 665 | 69 | 70 | 14:20–15:29 |
| 2026-07-07 | 506 | 56 | 56 | 14:34–15:29 |
| **2026-07-08** | **669** | **370** | **375** | **09:15–15:29** |
| 2026-07-09 | 712 | 114 | 114 | 13:36–15:29 |
| 2026-07-10 | 521 | 12 | — | partial (today) |

**One complete session exists.** The others are partial — the server was not running.

And a bar is:

```
[1783675860000, 331.2, 331.2, 326.1, 327.3]     // [minute, open, high, low, close]  of LTP ONLY
```

**Not stored per minute:** `oi`, `changeOI`, `volume`, `bid`, `ask`, `bidQty`, `askQty`, `iv`, and every
Greek.

### The consequence, stated plainly

**Every velocity, acceleration, expansion and compression metric in the brief — for OI, volume, spread
and IV — is uncomputable over history. Not "hard": uncomputable.** The inputs were never recorded.
They become computable **forward only**, starting the first minute the new store runs.

The engine must therefore return `null` — not `0`, not a guess — for every such metric until it has
observed at least two of its own samples. That is not a limitation of the design. It is the design.

---

## 2. STORAGE — MEASURED, NOT ESTIMATED

One full session at 665 strikes:

```
observations (leg × minute) : 498,750
fields per observation      : 15
raw values                  : 7,481,250

as JSON rows                : ~67 MB/day   ->  16.3 GB/year
as columnar float64         : ~57 MB/day   ->  13.9 GB/year
```

For scale: today's `data/opt-candles/2026-07-08.json` is **7.3 MB**, and it holds **LTP OHLC and
nothing else**.

**Design consequence.** A per-minute JSON file per day does not survive a year. The store is
**columnar, append-only, one file per (day, instrument)**, with:

- `int32` for `oi`, `changeOI`, `volume`, `bidQty`, `askQty` (delta-encoded against the previous minute)
- `float32` for `ltp`, `high`, `low`, `bid`, `ask`, `iv`, and the Greeks
- a `uint8` quality byte per leg-minute: bit flags for `ivDerived`, `ambiguousZeroGamma`,
  `staleQuote`, `noTradeThisMinute`
- a monotonic `seq` per observation, and the wall-clock `ts`

A missing minute is a **hole**. It is never interpolated. `observed[minuteIndex] = false`.

---

## 3. THE OBSERVATION MODEL

```jsonc
// one leg-minute. Append-only. Never mutated. Never destroyed.
{
  "seq": 1048576,                  // monotonic, per (day, instrument)
  "ts": "2026-07-10T09:16:00.000Z",
  "minute": 1,                     // 0 = 09:15 IST
  "inst": "NIFTY", "expiry": "2026-07-14", "strike": 24200, "side": "CE",

  "ltp": 373.2, "high": 390.3, "low": 356.7,
  "open": null,                    // the feed never provides it
  "close": null,                   // only after 15:30
  "prevClose": 202.05,
  "settlement": null,              // not in the feed

  "oi": 349245, "changeOI": -193505, "oiUnit": "UNVERIFIED",
  "volume": 1587755,
  "bid": 371.65, "ask": 372.7, "bidQty": 65, "askQty": 130,
  "spread": 1.05,                  // ask - bid, measured
  "iv": 9.43, "ivSource": "feed",  // or "bsm" -> derived, not observed

  "delta": 0.9393, "theta": -3.585,
  "gamma": 0.0005, "gammaQuality": "observed",
  "vega": 3.0503, "vegaQuality": "observed",

  "assumptions": { "r": 0.065, "q": 0, "oi_unit": "UNVERIFIED" }
}
```

`spread` is the only field derived at write time, because it is a pure difference of two observations
made at the same instant. Everything else is derived at read time, from the store, so a bug in a
derivation never corrupts the record.

### Strike Memory — O(1), running

Per (day, strike, side), updated on each observation with no scan:

`maxLtp, minLtp, maxOi, minOi, maxVolume, maxSpread, minSpread, maxIv, minIv, dayHigh, dayLow` —
**each with the `seq` and `ts` at which it was set.** An extreme without its timestamp is an anecdote.

Every field starts `null`, not `0`. `minOi` of a strike that has never been observed is `null`.

---

## 4. DERIVATIVES — AND WHEN THEY ARE `null`

For any series `x` over minutes:

```
velocity(t)     = x(t) - x(t-1)                     requires 2 consecutive OBSERVED minutes
acceleration(t) = velocity(t) - velocity(t-1)       requires 3
```

Rules, non-negotiable:

- **A gap breaks the chain.** If minute `t-1` was not observed, `velocity(t) = null`. It is *not*
  computed against `t-2` with a doubled denominator; that is interpolation wearing arithmetic's clothes.
- **`iv` velocity inherits `ivSource`.** If either endpoint is `bsm`, the result carries
  `confidence: 'derived'`.
- **Spread expansion / compression** is `velocity(spread)`, and it is measurable on 100% of legs,
  because the two-sided quote is 100% present. This is the single most reliable derivative available.
- **OI velocity is measurable; OI *notional* is not.** `oi_unit` is **UNVERIFIED** (constraint F4).
  Any rupee figure derived from OI would be wrong by 25–75×. The engine publishes OI in **raw feed
  units**, labelled, and refuses to convert.
- **The OI update cadence is UNKNOWN.** Brokers commonly refresh OI every few minutes, not every tick.
  Until it is measured — by recording `changeOI` transitions against wall-clock and finding the modal
  interval — every OI velocity carries `cadence: null`. **This must be measured before OI velocity is
  published.** It is the first thing the store makes possible.

---

## 5. CLASSIFICATION — AND WHAT IT HONESTLY REQUIRES

The brief lists twenty states. They are not equal. Sorted by what the data can actually support:

**Directly measurable from (ΔLTP, ΔOI) — the classic four.** Both inputs are observed:

| ΔPrice | ΔOI | state |
|---|---|---|
| ↑ | ↑ | `LONG_BUILDUP` |
| ↓ | ↑ | `SHORT_BUILDUP` |
| ↑ | ↓ | `SHORT_COVERING` |
| ↓ | ↓ | `LONG_UNWINDING` |

**Measurable from a single series:** `PREMIUM_EXPANSION`, `PREMIUM_COMPRESSION`, `OI_EXPANSION`,
`OI_REDUCTION`, `LIQUIDITY_INCREASE` / `LIQUIDITY_REMOVAL` (from `bidQty + askQty` and spread).

**Requires a level, and therefore a definition the owner must supply:** `BREAKOUT_ATTEMPT`,
`BREAKOUT_SUCCESS`, `BREAKOUT_FAILURE`, `FALSE_BREAKOUT`, `HIGH_REJECTION`, `LOW_REJECTION`.
*Breakout of what?* Today's high? Yesterday's? The opening range? **Each answer is a different engine.**
Until the owner names the level and the confirmation rule, these states are `UNKNOWN` — and that is the
correct output, not a placeholder.

**Requires history this platform does not have:** `TREND_CONTINUATION`, `TREND_EXHAUSTION`. A trend is
defined over sessions. **One complete session exists.** These are `UNKNOWN` until roughly 20 sessions
are captured, and the engine will say so with `missingEvidence: [{ input: 'sessions', have: 1, need: 20 }]`.

**The twentieth state, `UNKNOWN`, is not a failure mode. On day one it is the majority output.**

Every classification carries: `evidence` (the exact deltas and their `seq`), `confidence`,
`unknowns`, `source`, `ts`. A state with no evidence is not emitted.

---

## 6. EVENTS

Each event: `{ ts, seq, inst, expiry, strike, side, type, evidence, confidence, unknowns, reason }`.

Detectable **today**, from observed fields:

`PREMIUM_EXPLOSION`, `PREMIUM_COLLAPSE`, `OI_EXPLOSION`, `OI_COLLAPSE`, `SPREAD_SPIKE`,
`SPREAD_RECOVERY`, `BID_WITHDRAWAL`, `ASK_WITHDRAWAL`, `LIQUIDITY_VACUUM` (both depths collapse),
`PREMIUM_REVERSAL`, `OI_REVERSAL`.

**Each needs a threshold, and a threshold is not an observation.** `PREMIUM_EXPLOSION` at what — 3σ of
the strike's own realised minute-return distribution? Then it needs a sample. **Until a strike has ≥ 30
observed minutes today, its event thresholds are `null` and no event fires.** A z-score on n=4 is noise
with a Greek letter.

**Not detectable, and will not be pretended:** `GAMMA_WALL_FORMATION`, `GAMMA_WALL_BREAK`. A gamma wall
is dealer gamma exposure. Dealer positioning requires **GEX**, and GEX requires `oi_unit`, which is
**UNVERIFIED (F4)** — the number would be wrong by 25–75×. These two events are declared
`UNSUPPORTED`, with the reason attached, and they stay that way until `oi_unit` is verified against a
live NSE chain. **That is one afternoon of work, and it is the highest-value unblock in this document.**

---

## 7. HISTORICAL DATABASE — WHAT IS `null` TODAY

| bucket | status |
|---|---|
| Today | partial (server started 14:30 IST) |
| Yesterday | partial — 114 of 375 minutes |
| Last 5 days | **1 complete session**, 3 partial, 1 today |
| Last 20 days | **null** |
| Last 50 sessions | **null** |
| Previous weekly expiry | **null** — no captured expiry-day session |
| Previous monthly expiry | **null** |
| Budget day / RBI day / Election day | **null** — no session captured on any |
| Holiday session | **null** |

Every one of these is a promise the store can keep **only forward**. The engine exposes them as
`null` with `have` / `need` counts. It never returns a partial window as if it were complete.

---

## 8. PROBABILITY AND LEARNING

The brief already states the rule, and the platform's measured constraint agrees:

> Probability exists only if the minimum sample threshold is reached. Otherwise NULL.

**Platform-wide there are 50 labelled outcomes** (constraint M2: `ai-agents` 20, `signal-engine` 11,
`signal-paper` 11, `strangle` 7, `gamma-blast` 1). No engine's `reliability` has ever been measured
out-of-sample.

**Therefore, on the day this engine ships, every probability it can emit is `null`, and every
`reliability` is `null`.** `reliability: null ⇒ weight 0 ⇒ veto-only` (`engine-verdict.js`).

The learning layer will:
- learn **only** from closed, labelled outcomes;
- never learn from an open position;
- never mutate a stored observation — a correction is a **new observation** with a new `seq` and a
  `supersedes` pointer.

---

## 9. ARCHITECTURE

Pure engine. No dashboard logic, no broker logic, no order logic, no API logic **inside** the engine.

```
observation-store.js   append-only columnar writer/reader. Owns nothing but bytes.
strike-memory.js       O(1) running extrema, per (day, strike, side).
derivatives.js         pure. (series, minuteIndex) -> value | null
classifier.js          pure. (observation, memory, derivatives) -> state + evidence
event-detector.js      pure. thresholds injected, never hardcoded
oi-cadence-probe.js    measures the feed's OI refresh interval. Must run before OI velocity is trusted.
options-intelligence.js  composes the above. Emits EngineVerdict only.
```

- Every module is a **pure leaf**. `fs` and the clock are **injected** — `pop-seller`'s suite went red at
  midnight because `scanPoP` read `new Date()` internally. That lesson is load-bearing here: an engine
  that replays a day must be able to be told what time it is.
- Persistence goes through **`safe-write.js`**: atomic rename, `fsync`, `.bak`, validate-by-reparse, and
  **refuse to save over a file it could not read**.
- The service surface — REST, WebSocket, metrics, health, version, config, OpenAPI, structured logs,
  graceful shutdown, health score — comes from **`module-contract.js`**, which already builds all eleven
  from one descriptor. **An engine is not a service.** The engine core stays pure; the adapter wraps it.
- The only output is an **`EngineVerdict`** (`engine-verdict.js`): no `decision` field, no BUY, no SELL.
  `build()` refuses to construct a verdict containing a direction verb.

**One honest note on the WebSocket surface.** There is **no WebSocket server in this repository**. `ws`
is used only as a broker *client*, and `server.js` discards the `http.Server` from `app.listen()`, so
nothing can attach. `module-contract.wsChannel()` therefore reports `attached: false` and `/ws` answers
**501**. The channel contract is defined; the transport is absent; both are stated. *An unimplemented
surface that reports itself present is worse than an absent one.*

---

## 10. WHAT THIS ENGINE REFUSES TO DO

- Return `open`. The feed sends `0` on 198 of 198 legs.
- Call yesterday's close "close".
- Invent a settlement price.
- Emit an IV-derived metric without carrying `ivSource`.
- Treat `gamma: 0` as a measurement.
- Interpolate a missing minute.
- Compute a z-score, a probability or a reliability below its sample threshold.
- Publish GEX, dealer positioning, or a gamma wall while `oi_unit` is `UNVERIFIED`.
- Convert OI to a rupee notional.
- Emit BUY, SELL, LONG, SHORT, ENTRY or EXIT — in any field, at any confidence.

---

## 11. BUILD ORDER

Each step is independently useful and independently testable. Nothing later is required for anything
earlier to be correct.

| # | step | why first |
|---|---|---|
| **1** | **`observation-store.js` + start capturing, today** | Every metric in this document is uncomputable over history because the inputs were never recorded. **Each day of delay is a day permanently lost.** The store is worth building even if nothing reads it for a month. |
| **2** | `oi-cadence-probe.js` | Until the OI refresh interval is measured, every OI velocity is `cadence: null`. One session of data answers it. |
| **3** | **Verify `oi_unit`** against a live NSE chain | One afternoon. Unblocks GEX, dealer positioning and both gamma-wall events — permanently. The highest-value unblock here. |
| 4 | `strike-memory.js` + `derivatives.js` | Pure, fully testable against the one complete session (2026-07-08). |
| 5 | `classifier.js` — the four (ΔPrice, ΔOI) states only | The only states the data supports without a definition from the owner. |
| 6 | `event-detector.js` — spread and liquidity events first | 100% two-sided quote coverage makes these the most reliable. |
| 7 | Service adapter via `module-contract.js` | Health, metrics, OpenAPI. Needs one approved line in `server.js` to be reachable. |
| 8 | Replay harness | Success criterion: replay 2026-07-08 minute-by-minute and reproduce every stored observation byte-for-byte. |

**Step 1 is not the foundation of the engine. It is the engine.** Everything else is a pure function of
what it captured.

---

## 12. OPEN DECISIONS — THE OWNER MUST ANSWER, I WILL NOT GUESS

1. **Breakout of what level?** Today's high, yesterday's high, the opening range, or a strike's own
   session high? Six of the twenty classifier states depend entirely on this answer.
2. **Retention.** 13.9 GB/year columnar. Keep every leg-minute forever, or keep full resolution for
   N days and downsample beyond? *Downsampling is lossy, and this engine's stated purpose is to lose
   nothing.* My recommendation: keep everything, `float32`, delta-encoded — and revisit at 50 GB.
3. **Polling cadence.** The chain fetch takes **180 ms** end-to-end (`timings.totalMs`). At 60 s we
   capture 375 minutes. At 5 s we capture 4,500 samples and the store grows 12×. What resolution is the
   microstructure question actually asked at?
4. **Which instruments.** 665 NIFTY strikes is one instrument. Three instruments is ~42 GB/year.
5. **`settlement` ingest.** Bhavcopy after the session, as a separate timestamped observation — yes or no?

Until #1 is answered, six classifier states emit `UNKNOWN`. That is the correct behaviour, and the
engine will ship that way rather than choose a definition on the owner's behalf.
