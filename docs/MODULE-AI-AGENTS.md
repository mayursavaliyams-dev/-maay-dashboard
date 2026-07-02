# AI Agents — 5-agent pipeline (news-deal → impact probability → paper auto-trade)

Five named agents run a pipeline every 45s. The user-facing promise: when a
deal-class news event hits a stock, show WHICH stocks are affected and with what
probability — parameters disclosed — then let the executor auto paper-trade the
index when everything lines up, booking profit at target.

```
📰 News Scout → 🎯 Impact Analyst → 🧠 Signal Agent → 🛡️ Risk Manager → ⚡ Executor
```

## The agents (agents-engine.js — pipeline pure, deps injected)

1. **News Scout** — filters the live news feed (news-engine.js, 5 RSS sources)
   for deal-class events: M&A/stake (w 1.0), order/deal wins (0.9), regulatory
   (0.85), capital actions (0.75), results (0.7). 24h window.
2. **Impact Analyst** — per event: affected stocks (news-engine detection),
   direction from sentiment, and a probability whose **parameters are disclosed**
   (sentimentStrength, sentimentConfidence, eventTypeWeight, recencyFactor,
   sourceWeight, newsImpactScore). Heavyweights pull an index bias
   (approx NIFTY/SENSEX weights: HDFCBANK ~11/13.5%, RELIANCE ~9/11.5%, …).
3. **Signal Agent** — fuses the 11-factor master-signal verdict with the news
   index bias. News is one voice, not a veto: aligned news adds ≤+6 points,
   opposing news trims ≤-8. HOLD stays HOLD — news alone never invents a trade.
4. **Risk Manager** — transparent 9-check gate, all listed with pass/fail:
   market hours · signal fired · probability ≥ floor (65%) · VIX < 22 ·
   event-risk < 70 · trades/day < 3 · no open position · daily-loss cap (₹5k
   paper) · last-entry cutoff 14:45.
5. **Executor** — **PAPER ONLY**. On GO: buys ATM CE (BUY) / PE (SELL) at live
   chain LTP, 1 lot. Books profit at +40%, stops at -20%, trails after +30%
   (give-back 15pts), hard square-off 15:15. P&L net of real round-trip charges
   (charges.js). Ledger: `data/ai-agents-trades.json`.

## Honest by design

- 100% paper — no live order path exists in this engine.
- Impact probability = disclosed-parameter heuristic, labelled as such.
- Directional option BUYING backtested weak here (PF 0.94) — hence the high
  probability floor, trade caps, and daily-loss stand-down. Judge the executor
  on forward expectancy, not promises.

## API

```
GET  /api/agents            → enabled, config, 5 agent statuses, open/closed book, all-time stats
GET  /api/agents/trades     → trade ledger (?limit=)
POST /api/agents/enable     → { enabled } — persists via config-overrides.json (survives restarts)
```

Env knobs: `AI_AGENTS_ENABLED` (default true), `AGENTS_TP_PCT` 40, `AGENTS_SL_PCT` 20,
`AGENTS_TRAIL_AT` 30, `AGENTS_TRAIL_GB` 15, `AGENTS_MIN_PROB` 65, `AGENTS_MAX_TRADES` 3,
`AGENTS_MAX_DAILY_LOSS` 5000, `AGENTS_SQUAREOFF` 15:15, `AGENTS_LAST_ENTRY` 14:45, `AGENTS_QTY` 1.

## UI — /agents.html

5-card pipeline strip (live states: WATCHING/ACTIVE/GO/IN TRADE) · Deal Impact
Radar table (event, type pill, stocks, direction, probability, parameters) ·
Signal Fusion cards (master% × news bias per index) · Risk Gate with all 9
checks ✓/✗ · Executor paper book (open + closed, charges shown, all-time
win-rate). ON/OFF toggle. Auto-refresh 10s; bootId build badge.

## Server wiring

45s `agentsTick()` in server.js: news items + VIX + event-risk always; during
market hours also `gatherMasterSignal(inst, {track:false})` for NIFTY/SENSEX —
the master's `_chain` is reused as the executor's price feed (no extra fetch,
learner not polluted). Boot applies persisted `AI_AGENTS_ENABLED`.

## Tests

`test/agents-engine.test.js` — 35 assertions (deal detection/classification,
impact params + index-bias sign/magnitude, fusion boost/trim/HOLD-stays-HOLD,
all 9 gate checks, paper entry→TARGET/STOP_LOSS with real charges, disabled
skip). `npm test`.
