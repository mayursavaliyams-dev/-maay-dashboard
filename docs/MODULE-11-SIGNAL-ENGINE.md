# Module 11 — Signal Engine

Turns the Master Confluence verdict (Module 10) into an **actionable option trade
plan**. Plug-and-play, backward compatible — new module + one endpoint; the
master-signal route was refactored into a reusable `gatherMasterSignal(inst)` so
the plan is built from the SAME verdict with no double-fetch.

## Output — exactly one signal

`BUY CALL · BUY PUT · SELL CALL · SELL PUT · NO TRADE`

- **BUY** verdict (bullish) → **BUY CALL** (credit alt: SELL PUT)
- **SELL** verdict (bearish) → **BUY PUT** (credit alt: SELL CALL)
- **HOLD** / missing-illiquid premium → **NO TRADE**

## Every tradeable signal carries

| Field | How it's derived |
|---|---|
| `strike` / `optionType` | ATM (best gamma/theta + liquidity for an intraday directional buy) |
| `entry` / `expectedPremium` | live ATM option premium (LTP) |
| `stopLoss` / `stopLossPct` | premium-based; widens with IV (`0.25 + (IV−12)/120`, capped 20–45%) |
| `target1/2/3` | R-multiples of risk (1R / 2R / 3.5R), stretched by conviction |
| `expectedMove` | IV-implied underlying move over the holding window (points + %) |
| `expectedHoldingMin` | conviction → 90/60/40/25 min; ×0.6 on expiry day |
| `riskScore` (0–100) | from verdict risk-penalty + IV + (100−probability) + cautions |
| `economics` | premium/lot, max-loss/lot, reward@T2/lot, R:R (sizing itself = Module 12) |
| `confidence` / `probability` / `reason` / `drivers` | straight from the Master verdict |

Premium-based SL/targets because the traded instrument is the option. NO TRADE is
returned (never a fabricated plan) on HOLD or when the ATM premium is missing.

## API

```
GET /api/signal/:inst(nifty|sensex)
```
Returns the full plan. Also returns the `signalId` from the master verdict so the
outcome can be posted back to the Confluence Learner (Module 15) to self-tune
weights. NIFTY and SENSEX independent.

## Tests

`test/signal-engine.test.js` — 17 assertions (BUY→CALL, SELL→PUT, ATM strike,
ascending targets, expected move, holding time, risk score, economics, credit
alternative, HOLD→NO TRADE, illiquid→NO TRADE, expiry-day shortening). `npm test`.

## Files

- `signal-engine.js` — pure plan builder (no I/O).
- `server.js` — `gatherMasterSignal()` refactor + `GET /api/signal/:inst`.
