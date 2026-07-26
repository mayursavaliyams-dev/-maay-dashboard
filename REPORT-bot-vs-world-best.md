# ANTIGRAVITY PRO vs THE WORLD'S BEST — where the bot stands, and what to do next
### A comparison + roadmap report · 2026-07-26

**How to read this.** This is an honest scorecard, not a pep talk. It measures the bot against two
reference classes: the best **retail Indian options platforms** (Streak, Tradetron, Sensibull, AlgoTest,
uTrade) and the practices of **institutional volatility-selling desks** (portfolio risk, delta-hedging,
backtest rigor). The bot's own documents (`THE-ONE-DOCUMENT.md`, the `docs/` audits) already state most of
the gaps; this report ranks them against the outside world and turns them into an ordered plan. Every
internal claim is traceable to a file read this session; every external claim to a cited source.

---

## 1. The one-line verdict

**The bot is, unusually, MORE honest than most retail products and LESS complete than any of them.** Its
data-integrity discipline (atomic writes, `null ≠ 0`, look-ahead detection, refusing to invent numbers) is
genuinely better engineering than the average paid Indian algo platform. But it has **no validated edge, no
order manager, no portfolio-level risk brake, and ~50 labelled outcomes** — so as a *trading* system it is
a research prototype, while the retail platforms are shippable products. The right goal is not to copy their
features; it is to convert the bot's honesty advantage into a **real, measured edge** before adding
anything else.

---

## 2. The scorecard

Scale: 🔴 absent/broken · 🟡 partial · 🟢 solid. "Best-in-class" = what a top retail platform or an
institutional vol desk does.

| Dimension | Antigravity today | Best-in-class | Score |
|---|---|---|---|
| **Data integrity / honesty** | atomic writes, `null≠0`, look-ahead caught, refuses to guess | most retail bots show fabricated Sharpe & fake fills | 🟢 **ahead** |
| **Backtest rigor** | purged k-fold, deflated Sharpe, PSR exist in `bt-validate.js` — but the shipping backtests carried look-ahead (`bt-strangle-costs`, `bt-tv/run.js:265`) | walk-forward, shift-test, cost-sweep, break-even cost | 🟡 tools present, not enforced |
| **Validated edge** | **none** — buying PF 0.94; selling PF 0.55 once look-ahead removed | a documented, out-of-sample, cost-net edge before capital | 🔴 |
| **Labelled outcome data** | 41–50 total (strangle 7); no entry-Greeks stored | thousands of trades; full feature capture | 🔴 |
| **Risk management** | 11 private per-engine brakes; **no account-level exposure/loss brake** | portfolio VaR, drawdown kill-switch, correlation caps, pre-trade checks | 🔴 |
| **Execution / OMS** | 8 `placeOrder()` sites, no order manager; one boolean between paper & live | single OMS, idempotency, margin pre-check, kill-switch | 🔴 |
| **Delta / vega hedging** | none — sells premium and holds to expiry | dynamic delta-hedging of the short-vol book | 🔴 |
| **Probability / ML** | honest: reliability `null`, weights 0, Meta-Engine returns INSUFFICIENT_DATA | calibrated probabilities, Brier-checked | 🟡 honest-but-empty (correct given data) |
| **Architecture** | 7,318-line `server.js` monolith, 0 routers, 14 `setInterval`/0 `clearInterval` | modular services, event bus, audit/replay | 🔴 |
| **Strategy builder / UI** | functional pages, contrast & UX gaps (see the 3 UI prompts) | Sensibull-grade builders, payoff, chain | 🟡 |
| **Backtesting breadth** | daily-resolution only; no intraday tick path | multi-leg, intraday, forward-test | 🟡 |
| **Broker / data** | Upstox live + fallbacks; no futures feed, OI unit unverified (F4) | clean multi-broker, verified feeds | 🟡 |

---

## 3. Where the bot is genuinely AHEAD (do not lose this)

This is real and rare, so it is listed first. Professional backtesting literature's central warning is *"the
question is never 'is this backtest biased?' but which biases are present and does any signal survive"*
([Backtest Bias Taxonomy](https://www.susanpotter.net/quant/backtest-bias-taxonomy/)). Most retail bots
never ask. This bot does — it caught its own look-ahead, it writes `null` instead of `0`, it halts a risk
brake when state is unknown instead of failing open, and it labels every claim Verified/Probable/Unknown.
That discipline is the foundation a real edge is built on, and it is worth more than any feature on the
retail platforms. **The roadmap below is designed to protect it, not trade it away for speed.**

---

## 4. The gaps that matter, ranked against the outside world

### 4.1 No validated edge (the only gap that truly matters)
Every retail platform sells *automation*; none guarantees an edge — but a serious operator validates one
before risking capital. This bot's own honest numbers show buying at PF 0.94 and selling at PF 0.55 once
the look-ahead is removed. The volatility-risk-premium *family* is the one edge the platform is even allowed
to claim (`RESEARCH-measurable-edges.md`), and its current evidence for it is invalid. **Nothing else on
this list matters until there is one number, measured out-of-sample and net of costs, that is > 1.0.**

### 4.2 No account-level risk (findings 1–3 of the architecture review)
Best-practice risk management is explicitly *"beyond stop-loss"*: portfolio VaR, drawdown kill-switches,
correlation caps, pre-trade checks, position-size reduction on volatility spikes
([AlgoBulls](https://algobulls.com/blog/algo-trading/risk-management)). This bot has **eleven private
brakes that cannot see each other** and `grep` for `totalExposure|portfolioRisk|netDelta` returns nothing —
the *account* has no daily-loss brake at all. "No module owns capital, no module owns orders, no module owns
risk" is the single structural finding wearing three hats.

### 4.3 No OMS, and a live fail-open visible right now
There are 8 `placeOrder()` sites across 6 modules and **one boolean** (`paperMode`) between them and a live
broker. Worse, a fail-closed halt introduced for safety is undone 6,000 lines later at `server.js:7278`
(NIFTY is running at 5× its loss-halt threshold in paper right now). A professional system has one order
manager with idempotency, a margin pre-check, and a kill-switch that *persists* across restarts. This bot
has none of those yet — which is exactly why staying in paper is correct.

### 4.4 Tiny outcome data → no probability layer
Calibrated probability needs data; this bot has ~50 labelled outcomes where ~200 is the floor to calibrate
one number, and it stores **no entry Greeks beside realized P&L** (see `REPORT-greeks-analytics.md`). Its
Meta-Decision Engine honestly returns INSUFFICIENT_DATA. The fix is not smarter code — it is **capturing
data starting today**.

### 4.5 No hedging of the short-vol book
Institutional vol sellers **dynamically delta-hedge** — the whole point is to isolate the volatility premium
from directional noise ([Predicting Alpha](https://www.predictingalpha.com/delta-hedging/),
[Nasdaq](https://www.nasdaq.com/articles/what-delta-hedging-and-how-can-you-leverage-it)). This bot sells
strangles and holds to expiry, fully exposed to a gap — and its "iron condor" is really two naked shorts
with unbounded loss (finding F). Hedging is a later-stage upgrade, but it is the difference between a
premium-selling *strategy* and a premium-selling *gamble*.

### 4.6 Monolith architecture
7,318 lines, 168 routes, 0 `express.Router()`, 14 `setInterval` and 0 `clearInterval`. The retail platforms
run modular cloud services; institutional systems have an event bus with audit and replay. This bot has one
`EventEmitter` in production — no bus, no audit trail, no replay. It is maintainable by one author who holds
it all in their head, and fragile to everyone else.

---

## 5. What to do next — the ordered roadmap

The ordering rule: **safety before data, data before edge, edge before capital, capital before scale.** Do
not reorder. Each phase gates the next.

### Phase 0 — Stop the live fail-opens (days, not weeks)
1. **`server.js:7278`** — the halt re-enabled at boot. Approval package not yet written; this is the single
   most urgent item because it disarms a brake outright. (Recommended next task in `THE-ONE-DOCUMENT.md` §5.0.)
2. **Persist `_haltedReason`/`autoEnabled`** so a `CONSEC_LOSSES` halt survives a restart.
3. Finish the `config-overrides.json` writer safety (P1-T3) and the remaining raw write sites.
*Why first: these are the only places the bot can hurt a real account, and they cost the least to fix.*

### Phase 1 — Start capturing the data that gates everything (start today, in parallel)
These are the three cheapest, highest-leverage actions, and every day of delay is permanently lost history:
1. **Capture intraday option chains daily** — gates all gamma/flow/vol research.
2. **Log every engine's hypothetical call outcome** — 55 → ~200 unblocks the entire probability layer.
   Store the **entry Greeks and IV** alongside the outcome (the one column the platform is missing).
3. **Write a daily NAV series** (per book, net of charges) — every portfolio statistic (Sharpe, drawdown)
   is computed from a series that does not exist yet.

### Phase 2 — Get ONE honest edge number
1. Fix the backtest look-ahead (`bt-tv/run.js:265`, prompt already written) and re-run **shift-tested**
   (lag all inputs one period — the professional look-ahead test) and **cost-swept** (find the break-even
   cost). Reuse the purged-k-fold / deflated-Sharpe / PSR already in `bt-validate.js`.
2. Report the result **as measured, however bad.** If VRP survives out-of-sample and net of costs at PF > 1,
   you have a foundation. If it does not, you have saved real money — that is also a win.
*No capital moves until this number exists and is positive.*

### Phase 3 — Build the three missing owners
Only after Phases 0–2, refactor toward: a **capital owner** (balance is state, not config — already
half-done by the boot-order fix), an **order manager** (one OMS, idempotent, margin pre-check, persistent
kill-switch), and a **portfolio risk engine** (account-level exposure and daily-loss brake that sees all
engines). These are architecture-review findings 1–3; doing them is what turns eleven blind brakes into one
that can see.

### Phase 4 — Only then: hedging, meta-decision, live
When outcomes ≥ ~200 and an edge is validated: add **dynamic delta-hedging** to the seller book, turn on the
**Meta-Decision Engine** (it will stop returning INSUFFICIENT_DATA once reliability is measurable), give the
"iron condor" real **wings** (finding F), and *consider* a gated live pilot with tiny size. Not before.

---

## 6. The honest bottom line

Measured against the world's best, the bot is **behind on every trading feature and ahead on the one thing
those features are supposed to rest on: not lying to itself.** The temptation is to close the feature gap —
prettier builders, more strategies, a live button. The correct move is the opposite: spend the next weeks on
**safety (Phase 0) and data capture (Phase 1)**, because they are cheap, irreversible-if-skipped, and they
are the only path to the one thing no retail platform can hand you — a *validated* edge. Build that, and the
bot becomes something none of the compared products actually are: an options system that has earned the
right to trade. Skip it, and adding features just makes a faster way to lose money look more professional.

---

### Sources
Internal (read this session): `THE-ONE-DOCUMENT.md`, `docs/RESEARCH-measurable-edges.md`,
`docs/ARCHITECTURE-REVIEW.md`, `docs/EVIDENCE-F4-oi-unit.md`, `docs/036-OPTION-CHAIN-PLATFORM.md`,
`REPORT-greeks-analytics.md`, `bt-validate.js`, `pop-seller.js`, `strangle-engine.js`, `server.js`.
External: [Backtest Bias Taxonomy](https://www.susanpotter.net/quant/backtest-bias-taxonomy/) ·
[AlgoBulls — Risk Management Beyond Stop-Loss](https://algobulls.com/blog/algo-trading/risk-management) ·
[Predicting Alpha — Delta Hedging for Sellers](https://www.predictingalpha.com/delta-hedging/) ·
[Nasdaq — Delta Hedging](https://www.nasdaq.com/articles/what-delta-hedging-and-how-can-you-leverage-it) ·
[The Blockverse — Best Indian Algo Platforms 2026](https://theblockverse.co/best-algo-trading-platforms-in-india/) ·
[AlgoTest — Tradetron vs Sensibull](https://algotest.in/blog/tradetron-vs-sensibull-comparison/).
