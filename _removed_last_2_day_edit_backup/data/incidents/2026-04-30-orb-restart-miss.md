# 2026-04-30 — Missed NIFTY PUT due to server restart

## What happened
- 09:15-09:30 IST: ORB computed in memory (high=24019.15, low=23864.55).
- ~10:02 IST: server restarted. In-memory ORB wiped.
- 10:00 IST candle: NIFTY broke ORB low at 23,862.85. Strategy would have fired PUT.
- Bot did not fire because post-restart code path requires `mins >= 9*60+15 && mins <= 9*60+30` to set ORB, which never re-evaluates after the window closes.

## Actual outcome had bot fired (verified via backtest-trade-yesterday.js on real Dhan data)
- Strike: NIFTY 23750 PE  (ATM 23850, offset −2)
- Expiry: 2026-05-05 (next Tuesday weekly — 5 days out, significant time value)
- Entry @ 10:00 IST: raw ₹136.80 → filled ₹139.54 (2% slip)
- Exit @ 12:06 IST: STOP_LOSS @ ₹129.91 (−6.9%)
- **Net P&L: −₹686 (1 lot of 65)**
- The earlier "missed +₹178 win at 146%" estimate was wrong — that figure assumed ₹2.50 entry premium (same-day expiry pricing) but the actual contract was 5 days from expiry.

## Root cause
ORB state lived only in process memory. Any restart inside trading hours = blind for the rest of the day.

## Fix shipped same day
- `data/market-state.json` — JSON file written on each ORB/dayHigh/dayLow change (debounced 2s).
- `_restoreMarketState()` runs on boot. If `state.date === todayDate`, restores `orbHigh/orbLow/dayHigh/dayLow` for both SENSEX and NIFTY.
- Verified after restart: log shows `📥 Restored market state — NIFTY ORB 24019.15/23864.55`.

## Position-sizing observation (separate issue)
- ATM−2 NIFTY weekly with 5 days to expiry costs ~₹140/contract → 1 lot ≈ ₹9,100 capital exposure.
- 5% stop-loss on ₹140 = ₹7 loss per share = ₹455 + brokerage = ~₹686 worst-case per lot.
- Account capital ₹50,000, per-trade allocation 5% = ₹2,500 — but 1 NIFTY lot already costs ₹9,100. Engine will round down to 0 lots and skip the trade unless capital is increased OR strike is moved further OTM.
- This needs review before live Monday May 4.

## Status
- ORB persistence: live.
- Paper run: not validated (today was the first scheduled Thursday and it failed).
- Next attempt: Thursday 2026-05-07.
