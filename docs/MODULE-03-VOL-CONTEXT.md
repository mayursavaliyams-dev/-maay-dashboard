# Module 3 (vol slice) — Volatility Context

IV Rank/Percentile · Expected Move · GEX-lite (call/put walls + gamma flip).
Index-only (NIFTY/SENSEX). The competitive research flagged these as the
highest-value defensible option-analytics features — and IVP is the single best
"is selling premium attractive right now" gauge, so it directly feeds the
validated strangle edge.

## What it computes

- **IV Rank / IV Percentile** — where India VIX sits vs its trailing 1-year range.
  `IV Rank = (cur−min)/(max−min)`; `IV Percentile = % of days below current`.
  Labelled (LOW/BELOW-AVG/ABOVE-AVG/HIGH) with `sellingFavored` boolean.
- **Expected Move** — ±1σ range by expiry (from the ATM straddle, the market's own
  price) and for one session (IV model), with upper/lower bands.
- **GEX-lite** — Call/Put **OI walls** (S/R magnets, the most reliable output), a
  naive net dealer-**gamma** profile (Black-Scholes gamma × OI), **gamma-flip**
  level, and a **regime** label (positive gamma → range-bound; negative → trend risk).

## Honest by design

Per the research, GEX carries an explicit **caveat** on every response: the dealer
sign (long calls / short puts) is an **un-verifiable assumption**, so GEX is a
**regime gauge, not a price predictor**, and gamma uses an **estimated DTE**. Walls
(max OI) need no such assumption and are the reliable part. Single-stock GEX is
intentionally **not** supported (thin OI) — index-only, where it is defensible.

## API

```
GET /api/vol-context/:inst(nifty|sensex)
```
Returns `{ ivp, expectedMove, gex }` + spot/atm/dte/vix. India VIX (via
yahoo-finance2 `^INDIAVIX`, 1y daily, cached ~6h) is the IV series for IVP; DTE is
taken from the gamma-blast detector's expiry (fallback 3 days).

## Data sources (reused, single-sourced)

- Current + historical India VIX: `event-engine.js` `getVix()` / new `getVixHistory()`.
- Spot + option chain (OI, ATM straddle): existing instrument chain getters.

## Tests

`test/vol-context.test.js` — 21 assertions (IV rank/percentile math, BS gamma
ATM>OTM, expected-move straddle vs IV-model, GEX walls, honest caveat, guards).
`npm test`.

## Files

- `vol-context.js` — pure engine (no I/O).
- `event-engine.js` — `getVixHistory()`.
- `server.js` — `GET /api/vol-context/:inst`.
