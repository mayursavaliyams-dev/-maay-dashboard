# Confirmed Signals + Accuracy Tracker

Cuts false signals. Instead of trusting any single engine (our backtest: a lone
directional call wins ~32%), a signal is **CONFIRMED only when ≥3 of the 4 engines
agree on ONE direction with none opposing** — far fewer, higher-quality calls. Every
confirmed signal is then **tracked and resolved against the real index move** so you
see (and we can tune on) its live hit-rate.

## Engines voted

Pattern (candlestick confluence) · OI build-up (net bias) · Early (H/L break) · ORB
(breakout direction). Each votes BULLISH / BEARISH / NEUTRAL.

## Confirmation rule (`agree()`)

- `bull` = #engines bullish, `bear` = #engines bearish.
- **CONFIRMED** when `max(bull,bear) ≥ minAgree` (default 3) **AND** the opposing side
  is 0 (clean one-sided confluence). Otherwise → no signal (noise filtered out).
- Direction = the agreed side; strike = ATM CE (bullish) / ATM PE (bearish).

## Accuracy tracking (`ConfirmedTracker`)

- On confirmation, record `{inst, direction, refSpot, strike, at}` (deduped: one open
  per inst+direction).
- After `horizonMin` (default 15) resolve vs current spot: correct if the index moved
  `≥ minMovePct` (default 0.1%) in the predicted direction; sub-threshold = **flat**
  (doesn't count for or against). → rolling hit-rate overall + per instrument.
- Persists to `data/confirmed-signals.json`. Live loop records + resolves every 60s
  during market hours, so accuracy builds up from real forward outcomes (honest — it
  starts empty, not backfilled).

## API

```
GET /api/confirmed-signals   → { signals:[{inst,confirmed,direction,agreeN,engines,strike,spot}],
                                  tracker:{ pending, recent, accuracy:{ overall, byInst, horizonMin, minMovePct } } }
```
Surfaced on `/signals4.html` as the top **✅ CONFIRMED** panel with a live accuracy line.

## Config

`CONFIRMED_HORIZON_MIN` (15), `CONFIRMED_MIN_MOVE_PCT` (0.1), agree `minAgree` (3).

## Tests

`test/confirmed-signals.test.js` — 14 assertions (agreement matrix, dedup, resolve
correct/wrong, flat handling, accuracy math). `npm test`.

## Files

- `confirmed-signals.js` — pure `agree()` + `ConfirmedTracker`.
- `server.js` — `_cfGather()` (4-engine votes), `GET /api/confirmed-signals`, 60s loop.
- `public/signals4.html` — ✅ CONFIRMED panel + accuracy line.
