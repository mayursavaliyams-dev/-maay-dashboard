# Trader Playbook — Antigravity Pro

> How to READ and USE the bot as a trader. 100% PAPER / educational — not investment advice.
> For running/restarting the server see [OPS-PLAYBOOK.md](OPS-PLAYBOOK.md).

## 1. The one thesis everything is built on

**Selling the volatility risk premium (VRP) is the edge. Directional option BUYING is not.**
Our own real-data backtests: directional buying PF 0.94 (a net loser — theta bleeds it);
short strangle / iron condor win ~80–89%. Peer-reviewed India evidence agrees (NIFTY is
range-bound, volatility more bearish than bullish → premium selling wins). So the bot
**never sells you a naked long option** as its edge — every directional view becomes a
**defined-risk spread**, and the core money-maker is **selling premium in the right regime**.

The catch (also from research): the premium is **not** mechanically there every day, and
**event/vol-spike weeks turn winners into heavy losers**. So the whole game is
**regime-timing + cost-control + risk-management**, which is exactly what the engine layers do.

## 2. Reading the dashboard (top → bottom)

- **Index cards + High/Low levels** — spot, day range, ORB, VWAP. Context.
- **Positions & P&L verification** — what actually makes the paper P&L, each trade re-computed and reconciled (✓/⚠). Trust this over the headline tile.
- **VRP Regime** — SELL-ON / REDUCE / STAND-DOWN. This is the sell-timing gate. Only sell premium when SELL-ON.
- **Technical indicators** (13, multi-confirm) — direction context only; never the edge on their own.
- **Option chain OI** — ΔOI green = buildup (writers), red = unwinding. Support/resistance read.
- **Market quotes** — full option quotes + PoP; BUY buttons place a paper position; the day-low tag blinks when a new low prints.
- **Strike price timeline** — per-strike live price, Greeks + intrinsic/time/breakeven, full high/low record (click a strike anywhere to open it). **⚡ Auto movers** = 4 boxes of the fastest-rising premiums with one-click order.
- **Trade plan** — the defined-risk structure the signal engine would trade (condor / credit / debit / NO-TRADE), its strikes, size (VIX-scaled half-Kelly), the meta-label probability, the **event filter** verdict and the **net-of-cost VRP** read.
- **Signal engine health** — HEALTHY / LEARNING / DEGRADED + the forward-test loop stats.

## 3. What each engine does (all paper)

| Engine | Does | When |
|---|---|---|
| **VRP regime** | Labels SELL-ON/REDUCE/STAND-DOWN from IVP + IV−realized + PCR + event/panic | always |
| **Trade planner** | regime + direction + GEX-skew + calibrated prob → defined-risk structure + size | on demand / paper loop |
| **Event-risk filter** | BLOCKS/REDUCES selling near RBI/Budget/election/Fed events + VIX spikes | gates every sell |
| **VRP monitor** | Verifies IV−realized−cost is actually positive before selling | gates every sell |
| **Signal-paper loop** | Auto-opens the plan (paper), marks to market, exits on target/stop/expiry, feeds calibration | market hours |
| **Gamma-blast** | Expiry-day 0-DTE option BUYING (the one buy strategy with a rationale) | expiry windows |
| **AI agents** | news → stock impact → paper trade | 45s tick |

## 4. Signal quality — how to size trust

- **Regime SELL-ON** + **event filter CLEAR** + **VRP favorable** = the premium-sell setup the research backs. Highest trust.
- **Meta-label probability** is *calibrated* — as the forward-test fills, "70%" should mean ~70%. Check `signal-health` Brier; if DEGRADED, distrust the number.
- **GEX / max-pain / PCR = context labels, not signals.** Research: GEX has no independent edge after controlling for VIX; max pain does not reliably pin the index. Use for range/support read, never as a trigger.
- Directional **debit spreads** only fire on strong confluence in a STAND-DOWN regime — defined risk, small, never naked.

## 5. Sizing & risk

- Size = **half-Kelly × IV-scale × VIX vol-target × regime-scale**, capped by risk-%-of-capital. When India VIX is high, size shrinks automatically (VIX 14→1×, VIX 28→~0.5×).
- REDUCE regime = half size. Event filter REDUCE = half size. BLOCK = no new sell.
- Everything is defined-risk (wings capped). Max loss per structure ≈ wing width − credit.

## 6. Paper → live gate (do NOT skip)

Before *considering* any live money:
1. `GET /api/forward-test-report` must read **PASS** (needs ≥30 forward trades, positive expectancy, PF ≥ 1.2, win-rate vs thesis, healthy calibration).
2. `signal-health` = HEALTHY (not DEGRADED).
3. Re-check SEBI algo/RA rules (2025–26 framework, Algo-ID by Apr 2026). A self-built <10 orders/sec bot needs broker tagging, not strategy registration — but re-verify before live.
4. Start with a **small pilot**; a PASS is "statistically eligible to consider", not a green light and not advice. Tail risk never goes to zero.

## 7. Honest limits

- Backtests are daily-resolution / benign-sample; they do not prove net-of-cost, tail-adjusted live edge. That is what the forward-test is accumulating.
- ~93% of Indian retail F&O traders lose money. The bot's discipline (regime gating, defined risk, event exclusion, honest calibration) exists precisely because the base rate is brutal.
