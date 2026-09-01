# 098 - Next 10 Step Changes Deep Research

**Date:** 2026-08-27  
**Scope:** Current Antigravity Pro workspace after reviewing the August readiness docs, current source, and a full `npm test` run.  
**Verdict:** Stay in paper/research mode. The next work is no longer "build heartbeat/reconciliation" because those now exist. The next work is to close the concrete regressions and turn the readiness system into a live gate that cannot be bypassed.

## Current Truth

- `heartbeat.js`, `reconciliation.js`, `/api/heartbeat`, `/api/reconciliation`, `/api/readiness`, and `public/readiness.html` exist.
- `OPTIONS_ALLOW_LIVE=false` is documented in `.env.example`.
- Upstox position reads now throw on failure and declare `positionsDistinguishEmptyFromError`.
- Upstox `placeOrder` still throws intentionally, so options orders cannot reach the broker through that connector.
- Catch triage is no longer unknown: `node scripts/catch-triage.js --assert` reports 79 silent catches, 59 expected-optional, 20 logged, 0 TODO.
- Full test run is not green: `npm test` ended at `103/108 suites passed`, with a visible hard failure in `ui-tokens.test.js`.
- The worktree is very dirty, so the first operational change is still preservation: commit or checkpoint before broad edits.

## Next 10 Changes

1. **Checkpoint the worktree before changing behavior.**  
   There are many staged, modified, and untracked files. This repo contains weeks of safety work in one local tree. Create a commit or at least a local checkpoint branch before touching live gates.

2. **Fix the `ui-tokens` regression.**  
   `npm test` fails because `test/ui-tokens.test.js` expects zero private token pages, but the run found 2. A quick scan found token-like private blocks in `public/command.html`, `public/greeks.html`, `public/market-data.html`, `public/readiness.html`, and `public/strategy.html`; the exact failing set is the pages that both link `public/css/tokens.css` and redefine core tokens. Move page-specific values to the shared token layer or rename them so the design-system ratchet goes green again.

3. **Make readiness a real entry gate, not just a display.**  
   `_readinessSnapshot()` exists in `server.js`, and `/api/readiness` reports blockers. The next change is to make every new-entry path ask the readiness gate before order intent generation. Exits should remain allowed through the reducing path.

4. **Settle runtime two-key proof, not file-level proof.**  
   `test/two-key-rule.test.js` says file-level presence is not path-level proof. Add runtime probes where `TRADE_MODE=live` is set with only key 1, then assert the broker is never reached for each order-capable path.

5. **Remove or reduce the dangerous `Date.now()` approval-token collision.**  
   The order path characterization test pins a defect where identical intents in the same millisecond receive the same approval token. Add nonce/counter/randomness to the approval token payload while keeping single-use semantics.

6. **Stop live/paper mode from being stale after boot.**  
   The characterization suite pins that `paperMode` is read once at construction in execution engines. Either make mode read per order, or explicitly require a restart and make runtime mode changes refuse with an operator-visible reason.

7. **Finish numeric config hardening in remaining server status/order surfaces.**  
   `server.js` has a central `readLimit()` path, but later surfaces still show `parseInt(process.env.MAX_TRADES_PER_DAY || 2)` style reads. Convert remaining reads to the hardened limit source so malformed values cannot become `NaN` and silently disable caps.

8. **Charge-correct `pop-seller` paper P&L.**  
   Tests pin that `pop-seller` still records gross P&L without transaction charges. Apply `charges.js` consistently so paper outcomes are net and comparable with the rest of the system.

9. **Fix the misnamed iron condor.**  
   `buildIronCondor()` currently returns two short legs with no protective wings and no `maxLoss`, which is a short strangle, not an iron condor. Either build true wings and max-loss math, or rename the surface so it does not understate tail risk.

10. **Turn readiness evidence into a daily operator artifact.**  
    Add a daily JSON/HTML snapshot that stores readiness, heartbeat, reconciliation verdict, catch-triage summary, test result, connector capability, and paper/live mode. This gives each paper session an audit trail and makes "can we go live?" answerable from evidence rather than memory.

## Not Next

- Do not implement Upstox `placeOrder` yet.
- Do not call outputs recommendations while calibration and compliance gates are still blocked.
- Do not change broad architecture before the current safety gates are green.
- Do not split `server.js` as the next move; it is attractive cleanup, but less protective than the ten items above.

## Verification

- `node scripts/catch-triage.js --assert`: pass, 0 TODO catches.
- `npm test`: fail, `103/108 suites passed`; visible failure is `ui-tokens.test.js` ratchet on private token pages.
