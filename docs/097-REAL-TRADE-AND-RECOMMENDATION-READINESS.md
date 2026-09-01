# Real Trade And Recommendation Readiness Research

**Date:** 2026-08-24  
**Scope:** Antigravity Pro product readiness for real broker trading and user-facing trade recommendations.  
**Verdict:** Not ready for real trade or recommendation claims. Ready for a controlled roadmap toward paper-verified research signals.

## 1. Executive Verdict

The product should stay in **paper / research mode**.

Real trading is blocked by broker execution, position truth, reconciliation, heartbeat, and two-key live permission gaps. Recommendation is blocked by calibration, evidence, and India compliance risk. The product can show **research context, source-backed signals, verified data, and paper trade candidates**, but must not present these as personalized investment advice or guaranteed recommendations.

## 2. Current Product Truth

What is working:

- The Upstox connector currently cannot place a live order by accident. `upstox-connector.js` still throws from `placeOrder`.
- Risk guard wraps broker execution and rejects direct `broker.placeOrder` calls.
- UI now has India-only InvestingPro / ProPicks context with source, update date, and "not a trading command" language.
- A validation harness exists and correctly treats `CANNOT_VALIDATE` as not passing.
- Existing architecture docs already define "no probability without calibration evidence" as a hard rule.

What is not ready:

- Live trade execution does not exist as a proven broker path.
- D-8 position truth is now wired for Upstox: broker position failures throw, and a verified empty account is explicitly marked as verified empty. Live readiness still requires reconciliation to be fresh and agreed.
- Options live gating still needs the dedicated `OPTIONS_ALLOW_LIVE` second key.
- There is no broker-vs-internal reconciliation loop strong enough for live money.
- There is no heartbeat/deadman supervision with measured detection latency.
- Probability/confidence surfaces are still heuristics in parts of the product.
- Recommendation wording still appears in API/UI fields such as `recommend`, `BUY_CALL`, and `BUY_PUT`.

## 3. Real Trade Blockers

### P0: Position Truth Must Fail Closed

Before any real order path exists, the system must prove what it holds.

Required update:

- Audit every caller of `getPositions`.
- Confirm failures throw or return explicit unavailable state.
- Block entries and exits when broker positions are unavailable.
- Add tests where broker position API fails, returns malformed data, returns empty positions, and returns stale positions.

Evidence:

- `upstox-connector.js` declares `positionsDistinguishEmptyFromError`.
- `upstox-connector.js:482` owns `getPositions`.
- `docs/092-CAN-WE-GO-LIVE.md` marks D-8 as the first blocker.

### P0: Reconciliation

The internal book and broker book must be compared continuously.

Required update:

- Add a reconciliation service that compares broker positions, internal open book, pending orders, and day P&L.
- Stand down all new entries on mismatch.
- Allow exits only through a controlled emergency path.
- Store every mismatch as an immutable audit event.

### P0: Two-Key Live Permission For Options

`TRADE_MODE=live` must not be enough for options.

Required update:

- Add `OPTIONS_ALLOW_LIVE=false` default.
- Require both `TRADE_MODE=live` and `OPTIONS_ALLOW_LIVE=true`.
- Show the missing key in the refusal reason.
- Add regression tests for every options order entry and exit path.

Evidence:

- `docs/085-TWO-KEY-RULE.md` proposes `OPTIONS_ALLOW_LIVE`.
- `upstox-connector.js:504` still blocks live orders by throwing.

### P0: Heartbeat And Deadman

The product must detect stale feeds, dead broker sessions, hung timers, and stuck write paths.

Required update:

- Add heartbeat state for broker, data feed, order manager, paper ledger, reconciliation, and UI API.
- Define max stale age per source.
- Enter `STAND_DOWN` when a critical heartbeat is stale.
- Expose a readiness endpoint that reports `LIVE_BLOCKED` with exact causes.

### P0: Broker `placeOrder` Only After Safety Gates

Do not implement broker `placeOrder` until D-8, reconciliation, two-key options live permission, and heartbeat are complete.

When ready:

- Implement one broker path only.
- Prove with one manual one-lot trade.
- Capture request, broker response, order id, fill id, position after fill, charges, and reconciliation result.
- Keep auto live disabled until paper evidence gates pass.

## 4. Recommendation Blockers

### P0: Rename Product Language

The current product should not call outputs "recommendations" unless a compliance path and calibrated evidence exist.

Required update:

- Use `Research Signal`, `Market Context`, `Paper Candidate`, or `Trade Plan Draft`.
- Avoid `recommend`, `BUY_CALL`, `BUY_PUT`, `target`, and "high probability" in user-facing surfaces unless the screen is explicitly paper/testing and explains calibration status.
- Add a UI/API wording lint test that fails on new unsafe phrases.

Evidence:

- `server.js:4541` and `server.js:4542` still emit `BUY_CALL` / `BUY_PUT` from high-low trend logic.
- `public/stock.html:829` correctly says ProPicks context is not a trading command.

### P0: Calibration Gate

No probability should be published as measured probability until calibration exists.

Required update:

- Add a central calibration gate for all probability/confidence displays.
- Below threshold, return `probability: null`, `class: "uncalibrated"`, and `decision: "ABSTAIN"` or `NO_TRADE`.
- Persist the shown confidence/probability with the outcome.
- Measure Brier score, reliability curve, calibration slope, and per-bin sample count.

Evidence:

- `docs/MASTER-CONTEXT.md` requires no probability below calibration.
- `docs/009-VALIDATION-ENGINE.md` says 12 outcomes cannot honestly fill a probability bin.
- `validation-harness.js` already supports pre-declared promotion criteria.

### P1: Separate Vendor Opinion From Product Decision

InvestingPro / ProPicks can be shown as third-party context for Indian stocks only. It must not become the product's trade command.

Required update:

- Keep credentials outside git.
- Keep data import manual/verified unless a licensed API path exists.
- Store source, export date, update date, and symbol mapping status.
- Display conflict state when internal signal and vendor opinion disagree.

## 5. Evidence Updates Needed

Required evidence system:

- One unified outcome ledger.
- Fields: `strategyId`, `symbol`, `instrument`, `timeframe`, `setupId`, `inputsHash`, `codeVersion`, `dataVersion`, `shownProbability`, `shownDecision`, `paperOrLive`, `entry`, `exit`, `pnlNet`, `charges`, `slippage`, `regime`, `reason`.
- Minimum gate: at least 200 labelled outcomes overall, at least 30 per probability bin, and at least two regimes before any calibrated probability claim.
- Every backtest must include walk-forward, cost stress, slippage stress, timing perturbation, parameter perturbation, bootstrap/DSR/PBO, and paper-vs-backtest divergence.

Do not shortcut:

- Monte Carlo is assumption propagation, not validation.
- Vendor signals are context, not evidence of our model.
- Win rate without costs, slippage, sample size, regime split, and tail loss is not readiness.

## 6. UI Updates Needed

### Navigation

The new fully-open navigation is directionally right: all pages should be visible without hidden inside tabs. Next update should make page status clear:

- Add small status chips: `Paper`, `Research`, `Blocked`, `Ready`.
- Keep risky/live pages visually distinct from analysis pages.
- Add a single `Readiness` page under Stock or Data showing live blockers.

### Stock View

Needed additions:

- Every signal card must show `source`, `updatedAt`, `evidenceLevel`, `calibrationStatus`, and `paperOnly`.
- Linked Chain should show why each stock is connected and whether relation is direct or inferred.
- High/Low Map should separate vendor 52-week range, computed range, current price, and stale/missing status.
- Company Inside should remain hidden until data is source-verified.

### Recommendation Surface

Replace:

- `Recommendation`
- `BUY_CALL`
- `BUY_PUT`
- `High probability`

With:

- `Research view`
- `Upside pressure`
- `Downside pressure`
- `Uncalibrated strength`

## 7. Compliance Notes For India

This is not legal advice. Before public paid recommendations or personalized calls, get compliance review.

Current official references checked:

- SEBI Investment Advisers Regulations, 2013, last amended November 25, 2025.
- SEBI Research Analysts Regulations, 2014, last amended November 25, 2025.
- SEBI circular "Safer participation of retail investors in Algorithmic trading", February 4, 2025.

Product implication:

- If the system gives personalized investment advice, the IA framework may apply.
- If the system publishes stock research, target prices, or buy/sell calls, the RA framework may apply.
- If broker API automation is exposed to retail users, the algo trading circular and broker controls matter.
- Therefore the product should remain research/paper-trading until registration, disclosures, audit logs, risk profiling, suitability, and broker/API controls are designed with counsel.

## 8. Implementation Order

### Phase 0: Language Lock

- Remove unsafe recommendation wording from UI/API.
- Add wording regression tests.
- Add global `paper/research only` payload metadata.

### Phase 1: Live Safety Base

- Fix position truth and fail-closed behavior.
- Add options two-key live gate.
- Add reconciliation loop.
- Add heartbeat/deadman.
- Add immutable audit events.

### Phase 2: Evidence Base

- Unify outcome ledgers.
- Persist shown confidence/probability.
- Add strategy IDs and input hashes.
- Add calibration dashboard.
- Keep all execution paper-only.

### Phase 3: Market Dry Run

- Run at least 20 market days with zero live orders.
- Perform broker-disconnect, stale-feed, bad-position, write-failure, and kill-switch drills.
- Compare paper fills against broker quotes and actual spreads.

### Phase 4: Manual One-Lot Live

- Implement broker `placeOrder` only after Phase 1 passes.
- Run one manually approved lot.
- Reconcile immediately.
- Keep auto live disabled.

### Phase 5: Limited Auto Live

- Only after evidence gates pass.
- Start with smallest lot, strict daily loss, strict max trades, and no overnight unbounded risk.
- Continue paper shadow mode beside live.

## 9. Do Not Do Now

- Do not implement Upstox `placeOrder` first.
- Do not call any output a recommendation.
- Do not show uncalibrated numbers as probability.
- Do not store Investing.com credentials or paid exports in git.
- Do not allow hidden auto-live behavior from only `TRADE_MODE=live`.

## 10. Next Concrete Work Items

1. Replace high-low `recommend` response with research-only fields.
2. Add recommendation wording lint tests across `public/`, `server.js`, and stock modules.
3. Implement `OPTIONS_ALLOW_LIVE` gate and tests.
4. Build reconciliation status endpoint.
5. Add a `Readiness` UI section that shows exact blockers and source evidence.
6. Start unified outcome ledger design.
