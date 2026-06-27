# deprecated/

Code archived because it is no longer used by the running system. Kept (not
deleted) so it can be restored from git history or moved back if needed.

## backend/  (Python FastAPI options-analytics API, port 8000)

**Archived 2026-06-27.** This was a standalone FastAPI service exposing
gamma-blast / greeks-matrix / options-analytics / IV / OI endpoints, computed
from Black–Scholes on a passed (or hardcoded-default) spot.

Why it was removed from the live system:
- **The dashboard never called it.** `public/*.html` fetch `/api/options/*`
  from the Node server (`API_BASE` = :3000), not this Python service on :8000.
- **Node already does the same job** — `gamma-blast-detect.js` +
  `option-analyzer.js` serve the same analytics off real chain data, and the
  dashboard consumes those.
- **It was not running** and its greeks were theoretical (default spots
  24500 / 52000 / 75000 when none passed), so keeping two copies only invited
  drift.

To restore: `git mv deprecated/backend backend` and re-add the
`analytics:api` script to `package.json`.
