# Option-Selling Capital Structure — ₹7 Lakh

**Status:** Reference design. NOT deployed. Backtest validation required before any live deployment.

## Capital Allocation

| Bucket | Amount | % | Purpose |
|---|---|---|---|
| Active capital | ₹4,00,000 | 57% | Margin for live spreads |
| Drawdown reserve | ₹2,00,000 | 29% | Refills active after >25% DD; never touched otherwise |
| Tail event buffer | ₹80,000 | 11% | Black swan absorber (1.5σ+ moves) |
| Cash float | ₹20,000 | 3% | Brokerage, slippage, assignment buffer |
| **Total** | **₹7,00,000** | **100%** | |

## Strategy

- **Structure:** NIFTY weekly bull-put / bear-call credit spreads
- **Strike selection:** ~0.15 delta short leg
- **Hedge width:** 200 points further OTM
- **DTE entry window:** 2-5 days to expiry
- **Margin per spread:** ~₹20,000
- **Credit collected:** ₹3,000-₹4,000 per spread
- **Max loss per spread:** ~₹16,000 (width − credit)

## Position Sizing

- Max concurrent spreads: **8**
- Margin utilization cap: **40%** (₹160k of ₹400k active)
- Per-trade risk: ₹16k = **4% of active capital**

## Exit Rules

| Rule | Trigger | Action |
|---|---|---|
| Profit take | Position at +50% of credit | Close — don't hold to expiry |
| Stop loss | Loss = 2× credit received | Close, accept partial loss |
| Time stop | DTE = 1 | Force close regardless of P&L |

## Compounding (half-compound)

- **On win:** 50% profit → active (compounds), 50% → reserve (locked)
- **On loss:** 100% from active; reserve untouched

## Halt Ladder

| Active capital | Action |
|---|---|
| Below ₹3L | Pause new trades; refill from reserve; review |
| Below ₹2L | Full halt; manual review only |
| Reserve below ₹1L | Strategy broken; stop entirely |

Plus: 4 consecutive losses OR daily loss > 3% of active → halt that day.

## Return Projection (theoretical, not validated)

Assumes 100 trades/year, ₹3,500 avg credit, ₹14,000 avg loss:

| Win rate | Net per trade | Annual return |
|---|---|---|
| 75% (textbook) | +₹863 | +21.6% |
| 70% | +₹250 | +6.3% |
| 65% | -₹625 | -15.6% |

**Break-even win rate ≈ 70%.** Below that, the strategy compounds losses.

## Risk Notes

- 75% win rate × 100 trades/yr = ~25 losses/yr expected
- 4-loss streak probability ≈ 5% → ₹64k drawdown (16% of active)
- 6-loss streak probability ≈ 1% → ₹96k drawdown (24% of active) — reserve trigger
- Tail event (5σ move): both legs blow through hedges; could lose multiple max-loss spreads simultaneously

## Pre-Deployment Checklist

Do not flip `SELL_AUTO_ENABLED=true` until all four are checked:

- [ ] [backtest-iron-condor.js](backtest-iron-condor.js) fixed (wider strikes 2σ+, wider hedges 300pt+, calibrated IV) and re-run on 2yr data with ≥70% win rate
- [ ] Credit-spread backtest built and shows ≥70% win rate on 2yr NIFTY data with profit-take rule
- [ ] Paper trading completed for ≥30 sessions with live data, P&L tracked vs backtest expectation
- [ ] Selling-engine code written (currently no engine consumes `SELL_*` env vars)

## Files

- [.env.selling.example](.env.selling.example) — env-var template (reference only, not loaded)
- [selling-config.md](selling-config.md) — this document
