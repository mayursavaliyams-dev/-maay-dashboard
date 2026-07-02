# Payoff Builder — multi-leg strategy visualizer

The #1 feature retail options tools compete on (Sensibull/OptionStrat class).
Build any multi-leg NIFTY/SENSEX/BANKNIFTY strategy → expiry payoff curve,
breakevens, max P/L, net credit/debit, Probability-of-Profit, combined
Black-Scholes Greeks, and a margin estimate. Premiums/IV auto-fill from the
live option chain.

## What it computes (payoff-engine.js — pure, no I/O)

- **Payoff curve** — expiry P/L over ±35% of spot (122 points), ₹ terms
  (× lots × lot-size).
- **Breakevens** — zero-crossings of the curve (linear interpolation).
- **Max profit / max loss** — over the plotted range, with **UNBOUNDED**
  flagged explicitly when net-short calls (upside) or net-short puts
  (downside) leave risk uncapped. Honest by design: naked strangles say so.
- **Probability of Profit** — lognormal S_T at expiry, mass over the profit
  intervals between breakevens. Labelled an estimate, not a guarantee.
- **Combined Greeks** — per-leg Black-Scholes Δ/Γ/Θ(per-day)/V(per-1% IV),
  signed and summed across legs × quantity.
- **Margin estimate** — defined-risk → |max loss|; any naked short leg →
  ~12% notional per short lot (broker SPAN differs — labelled estimate).
- **Risk:Reward** — only for defined-risk structures.

## API

```
GET  /api/strategy/payoff/prefill?inst=NIFTY|SENSEX|BANKNIFTY&depth=8
POST /api/strategy/payoff
     { legs:[{type:'CE'|'PE', side:'BUY'|'SELL', strike, premium, lots, iv?}],
       inst?, spot?, dteDays?, lotSize? }
```

`prefill` returns spot/ATM/step/lot-size/DTE + a strike ladder with live CE/PE
LTP & IV (chain getters reused; DTE from the gamma-blast detector's expiry,
fallback 3d). `POST` is pure compute — spot/lot/DTE auto-fill from `inst`
when omitted, so it also works headless (e.g. curl with explicit spot).

## UI — /payoff.html

Instrument switch (NIFTY|SENSEX|BANKNIFTY) · one-click templates (Short
Strangle, Iron Condor, Short Straddle, Long Straddle, Bull Call Spread, Bear
Put Spread) · editable legs table (side/type/strike/premium/lots/IV, premium
re-pulls from chain on strike/type change) · canvas payoff chart with
profit/loss zones, spot line, breakeven markers · metric cards + Greeks chips ·
red UNBOUNDED banner on naked shorts. Chain premiums refresh every 60s without
touching user-edited legs. Build-freshness badge (bootId auto-reload) included.

## Tests

`test/payoff-engine.test.js` — 35 assertions (ncdf/leg-payoff primitives,
validation guards, long-call debit/BE/PoP/Greeks, naked-strangle credit +
UNBOUNDED flags + BE pair + margin, iron-condor defined-risk + R:R, lots
scaling). `npm test`.

## Files

- `payoff-engine.js` — pure engine (no I/O).
- `server.js` — the two routes above (chain/spot context only).
- `public/payoff.html` — builder page.
- `test/payoff-engine.test.js` — unit tests.
