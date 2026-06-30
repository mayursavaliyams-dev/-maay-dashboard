# Module 5 — Smart Money Concepts (SMC)

Institutional price-structure reading. Detects how "smart money" leaves footprints
in OHLC structure, and turns it into a directional bias that feeds the AI
Probability Engine (Module 10).

> Plug-and-play, backward compatible. New module + one new endpoint; nothing in the
> existing engine changed. Pure detection in `smart-money.js`; the server only
> supplies bars (reusing `candlestick-patterns.aggregate`, so bar-building stays
> single-sourced).

## What it detects (closed bars only)

| Concept | Meaning |
|---|---|
| **Swing structure** | Fractal swing highs/lows (k-bar pivots) |
| **Market Structure** | HH/HL → BULLISH · LH/LL → BEARISH · else RANGING / WEAK |
| **BOS** (Break of Structure) | Close beyond the last swing in the trend direction = continuation |
| **CHOCH** (Change of Character) | First counter-trend structural break = early reversal |
| **Order Blocks** | Last opposite candle before the impulse that broke structure (DEMAND / SUPPLY) |
| **Fair Value Gap** | 3-bar imbalance (unfilled inefficiency); tracks fresh vs filled |
| **Liquidity Sweep** | Wick beyond a swing that closes back inside = stop-hunt |
| **Breaker Block** | An order block that failed and flips role |
| **Mitigation** | Price returning into an OB / FVG zone |

## Directional bias (for Module 10)

`analyze()` returns `bias = { score:-100..100, confidence:0..92, direction, note }`:

- **Structure trend**: BULLISH +40 · WEAK_BULLISH +18 · RANGING 0 · WEAK_BEARISH −18 · BEARISH −40
- **Latest break**: CHOCH ±35 / BOS ±25, scaled by recency (fresh breaks dominate)
- **Liquidity sweep** (last 3 bars): ±20
- **Fresh demand below / supply above**: ±8
- Confidence scales with number of confirmations + bar depth.

## API

```
GET /api/smart-money/:inst(nifty|sensex)?tf=15
```
`tf` = minutes per bar (1–60, default 15). Returns full structure
(`structure`, `events`, `orderBlocks`, `fairValueGaps`, `liquiditySweeps`,
`swings`) plus `bias`. NIFTY and SENSEX are independent.

The same `bias` is wired into `GET /api/master-signal/:inst` as the
`smartMoney` factor (11th leg), and is **learnable** — the Confluence Learner
(Module 15) adjusts its weight from trade outcomes.

## Config

- `swingK` (opt, default 2) — fractal lookback (k bars each side).
- Bar timeframe via `?tf=`.

## Tests

`test/smart-money.test.js` — swings, FVG (bull/bear), liquidity sweep, bullish &
bearish structure integration, and the too-few-bars guard. Run with `npm test`
(also enforced in CI).

## Files

- `smart-money.js` — pure engine (no I/O).
- `server.js` — `/api/smart-money/:inst` + `smartMoney` factor in `/api/master-signal`.
- `master-confluence.js` — `smartMoney` default weight.
- `confluence-learner.js` — `smartMoney` in the learnable set.
