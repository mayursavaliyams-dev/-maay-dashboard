# C1b — Hardcoded lot-size inventory (requirement 14)

Generated **2026-07-09**, before any file was modified. Repository-wide scan for lot-size
constants, `LOT` maps, `lotSize:`/`lot:` numeric literals, `*_LOT_SIZE || N` defaults, and
bare `|| 75` / `|| 65` fallbacks in lot position.

**Authoritative values** (broker contract master, `GET /v2/option/contract`, 2026-07-09,
recorded in `instrument-registry.js`):

```
NIFTY 65   BANKNIFTY 30   SENSEX 20
```

---

## IN SCOPE — must consume `instrument-registry.js`

| # | File:Line | Occurrence | Defect |
|---|---|---|---|
| 1 | `agents-engine.js:29` | `const LOT = { NIFTY: 75, BANKNIFTY: 35, SENSEX: 20 }` | wrong values |
| 2 | `agents-engine.js:494` | `lot: LOT[inst] \|\| 75` | wrong values **+ silent fallback** |
| 3 | `agents-engine.js:568` | `lot: LOT[inst] \|\| 75` | wrong values + silent fallback |
| 4 | `agents-engine.js:570` | `(LOT[inst] \|\| 75)` twice, in `maxLossDefined` | wrong values + silent fallback |
| ~~5~~ | ~~`agents-engine.js:603`~~ | `charges = 4 * 65 * pos.qty` | **FALSE POSITIVE — corrected 2026-07-09.** This is `4 legs × ₹65 charge-per-leg × lots`, a **rupee charge fallback**, not a lot size. Left untouched (out of scope; smallest-change rule). Flagged separately as a magic constant worth naming. |
| 6 | `gamma-blast-engine.js:28` | `const LOT = { NIFTY: 75, BANKNIFTY: 35, SENSEX: 20 }` | wrong values |
| 7 | `gamma-blast-engine.js:86` | `const lot = LOT[inst] \|\| 75` | wrong values + silent fallback |
| 8 | `pop-seller.js:18` | `LOT_SIZE = { NIFTY:75, BANKNIFTY:35, SENSEX:20, FINNIFTY:65, BANKEX:30 }` | wrong values |
| 9 | `pop-seller.js:19` | `function lotSize(inst){ return LOT_SIZE[inst] \|\| 75; }` | wrong values + silent fallback |
| 10 | `position-sizer.js:25` | `lotSize: 75` (DEFAULTS) | wrong value |
| 11 | `.env.example:161-163` | `NIFTY_LOT_SIZE=75`, `SENSEX_LOT_SIZE=20`, `BANKNIFTY_LOT_SIZE=35` | would override the registry |

### P&L impact of the wrong constants
`agents-engine` and `gamma-blast-engine` **do** apply `units = qty × lot` correctly — with the
wrong `lot`. Their realized ₹P&L is therefore **overstated**:

- NIFTY: `75 / 65` → **+15.4%**
- BANKNIFTY: `35 / 30` → **+16.7%**
- SENSEX: `20 / 20` → correct

---

## OUT OF SCOPE — reported, deliberately not modified

| File:Line | Occurrence | Reason |
|---|---|---|
| `server.js:252, 260, 268` (`INSTRUMENT_META`) | `20 / 65 / 30` | **Already correct.** Requirement 9 forbids modification without separate approval. |
| `server.js:3121, 3286, 3420, 3479` (`execution-engine` ctor args) | `20 / 65` | Already correct. Requirement 9. |
| `server.js:4416-4418` (`PS_INSTS`) | `65 / 30 / 20` via env | Already correct. Requirement 9. |
| `server.js:3035, 3094` | `niftyEngine?.lotSize \|\| 65` | Correct fallback. Requirement 9. |
| `backtest-tv/sell.js:36-38` | `lot: 20 / 75 / 35` | **Wrong values**, but an offline backtest script with no runtime path. Needs its own migration (filed as **C1c**). |
| `test/gex-skew.test.js:29`, `test/payoff-engine.test.js:33,51,71,82,83`, `test/signal-engine.test.js:17`, `test/signal-paper-engine.test.js:61,63,87`, `test/trade-planner.test.js:14`, `test/vol-context.test.js:69` | `lotSize: 75` / `65` / `20` | Test **fixtures** — explicit inputs to pure functions, not lot-size *sources*. Kept as literals so the suites stay hermetic and do not depend on the registry. |

---

## Requirement 15 — startup validation vs Requirement 9

Requirement 15 ("compare the registry against the live broker instrument master at startup
and warn on mismatch") requires a boot hook in `server.js`, which requirement 9 forbids
without separate approval.

**Resolution adopted:**
1. `instrument-registry.verifyAgainstBroker(connector)` — additive, unit-tested, touches no
   existing module.
2. `preflight-lots.js` — standalone, runnable as `node preflight-lots.js` and from CI. Queries
   the live broker and exits non-zero on mismatch. **Zero `server.js` change.**
3. The one-line `server.js` boot hook is **pending separate approval**.

Already in force: `instrument-registry` emits a `console.warn` whenever an `*_LOT_SIZE` env
override disagrees with the broker-verified value, so an inconsistent lot size can never be
used *silently*.

---

## Migration order (approved)

1. `agents-engine.js`
2. `gamma-blast-engine.js`
3. `pop-seller.js`
4. `position-sizer.js`
5. `.env.example`

Each: backup → registry wiring → legacy preservation (`pnlLegacy` + `calcVersion`) →
regression tests → full suite → migration/audit log → independent commit. Stop and roll back
that module alone on any unexpected behaviour.
