# QUANTITATIVE RESEARCH — measurable edges vs. this platform's data

**2026-07-10. Research only. No code, no pseudocode, no architecture.**

**The organising principle of this document is not the literature. It is the data.** A documented edge
this platform cannot compute is, for this platform, not an edge. Every concept below is scored against
the data capabilities **measured this session**, not against what a paper assumes.

### Citation honesty — read this first

Producing a "Top 100 features, ranked, with DOIs" as the brief requests would require fabricating
citations, because I cannot verify one hundred DOIs against real sources in this pass. **I will not.**
Instead:

- **[VERIFIED THIS SESSION]** — I confirmed the venue, volume, pages and a stable identifier via web
  search during this task. Four papers.
- **[RECALLED — VERIFY BEFORE CITING]** — a well-known paper I am confident exists, but whose DOI I did
  **not** re-verify this session. Treat the citation as a lead, not a fact.
- No entry is presented without one of those two tags. If I cannot tag it, it is not here.

### The data reality this platform operates under — MEASURED

Established earlier this session and in `docs/OPTIONS-INTELLIGENCE-ENGINE.md`, `docs/EVIDENCE-F4-oi-unit.md`:

| datum | status |
|---|---|
| Tick data | **ABSENT. Never captured, at any depth.** The single hardest constraint below. |
| Level 2 / Level 3 order book | **ABSENT.** No queue, no imbalance, no microprice — ever. |
| Dealer inventory | **UNOBSERVABLE.** Garleanu-Pedersen-Poteshman [VERIFIED] built it from a *"unique dataset"* of dealer/end-user positions. Retail has no such feed. |
| Intraday option chain | **1 complete session** (2026-07-08, 375 min). Bid/ask/IV/greeks not stored per minute. |
| EOD option OHLC + OI + settlement | **PRESENT.** ~1.08 M strike-days in `bt-data/bhav/` (NSE UDiFF). OI unit = **units**, verified for 5 NSE symbols. |
| IV | 78% feed-observed, **21.7% computed by us** (`ivSource: 'bsm'`). |
| Gamma / Vega | `0` on 33/198 legs — **ambiguous_zero**, feed cannot distinguish absent from true zero. |

**Verdict shorthand used below:** `EOD-YES` = computable from the 600-day bhavcopy today ·
`INTRADAY-NO` = needs intraday history this platform has for one day · `TICK-NO` = needs tick/LOB data
this platform will never have from a broker REST feed · `PROPRIETARY-NO` = needs dealer/clearing data.

---

## TIER 1 — Documented, and computable from data this platform ALREADY has

### 1.1 Volatility Risk Premium (option selling)

- **Definition.** Implied variance systematically exceeds subsequently realised variance; a seller of
  options/variance earns the difference as compensation for bearing volatility risk.
- **Evidence [VERIFIED THIS SESSION].** Bakshi & Kapadia (2003), *"Delta-Hedged Gains and the Negative
  Market Volatility Risk Premium,"* **Review of Financial Studies 16(2), 527–566** ([JSTOR
  1262684](https://www.jstor.org/stable/1262684), [SSRN 267106](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=267106),
  [Oxford](https://academic.oup.com/rfs/article-abstract/16/2/527/1579962)). Delta-hedged index-option
  portfolios underperform zero; **underperformance is LESS away-from-the-money and GREATER when
  volatility is high.**
- **Related [RECALLED — VERIFY BEFORE CITING].** Carr & Wu (2009), *"Variance Risk Premiums,"* RFS
  22(3) — the variance-swap formalisation. Verify the DOI before quoting.
- **India [VERIFIED THIS SESSION, weak venue].** A [Quantpedia
  summary](https://quantpedia.com/strategies/volatility-risk-premium-effect) and NSE-focused GARCH/IV
  studies confirm IV > realised on NIFTY, **but explicitly warn the short-vol return distribution is
  "very abnormal" with tail losses.** This is a secondary source; the primary Indian academic paper was
  not located this session.
- **Required data.** Implied vol (or option prices) + realised vol. **EOD-YES.**
- **The catch this platform already hit.** Bakshi-Kapadia measure a **delta-hedged** premium. The
  platform's `bt-strangle-costs.js` measured an **un-hedged, look-ahead** premium and got PF 7.41; the
  honest replication gave **PF 0.55** (`docs/REVIEW-selling-edge-invalidated.md`). **The literature says
  the premium is real and small and delta-hedged; the platform's evidence for it is invalid.** These are
  not the same claim.
- **Classification: VERIFIED (phenomenon) · UNKNOWN (this platform's ability to harvest it net of costs).**
- **Should ANTIGRAVITY implement?** **LATER, and only delta-hedged, cost-net, out-of-sample.** The
  un-hedged short strangle it currently runs is not what the literature validates.

### 1.2 IV Rank / IV Percentile as a conditioning signal

- **Definition.** Where current IV sits within its own trailing distribution; used to time premium
  selling (sell when IV is rich relative to its history).
- **Evidence.** This is **practitioner methodology, not a peer-reviewed edge.** It is a *conditioning*
  variable that appears inside VRP studies, not an independently validated alpha. I found **no** primary
  paper establishing "IV percentile > X predicts short-vol profit" as a standalone result.
- **Required data.** A trailing IV series. The platform has **one intraday session** and India VIX EOD.
  For per-strike IV rank: **INTRADAY-NO** today; **EOD-YES** if built from the bhavcopy's implied series.
- **Classification: ESTIMATED / ASSUMPTION.** Widely used; not independently validated as alpha.
- **Should implement?** **LATER**, as a *feature*, never as a standalone signal, and never before the
  VRP itself is validated (§1.1).

### 1.3 Put-Call Ratio

- **Definition.** Ratio of put to call volume or OI, used as a sentiment/positioning proxy.
- **Evidence [RECALLED — VERIFY BEFORE CITING].** The academic record on PCR predictive power is
  **mixed and often weak**; much of the supportive work is in lower-tier journals or is
  in-sample. I did not locate a top-3-journal result establishing PCR as a robust standalone predictor.
- **Required data.** Volume or OI by option type. **EOD-YES** (OI), intraday volume partial.
- **Classification: CONFLICTING RESEARCH.** Present both sides: sentiment-contrarian usage is common;
  rigorous out-of-sample validation is thin.
- **Should implement?** **LATER**, feature only, low weight, high overfitting risk.

---

## TIER 2 — Documented and real, but the platform CANNOT compute the input

### 2.1 Dealer Gamma Exposure (GEX) / demand-based pricing

- **Definition.** Aggregate option-dealer gamma position; when dealers are long gamma they buy dips /
  sell rips (dampening realised vol), and vice versa. The theoretical basis for "gamma walls".
- **Evidence [VERIFIED THIS SESSION].** Garleanu, Pedersen & Poteshman (2009), *"Demand-Based Option
  Pricing,"* **RFS 22(10), 4259–4299** ([NBER w11843](https://www.nber.org/papers/w11843),
  [SSRN 676501](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=676501),
  [Oxford](https://academic.oup.com/rfs/article-abstract/22/10/4259/1590158)). Demand pressure moves
  option prices; **the authors identify dealer vs end-user positions using a UNIQUE PROPRIETARY DATASET.**
- **Required data.** Signed dealer inventory, or a defensible proxy. **PROPRIETARY-NO.**
- **What the platform can and cannot do.** F4 is now resolved — `oi = units` — so a *naive* GEX
  (assume all OI is dealer-short-gamma, or apply a fixed sign convention) is arithmetically expressible.
  **But that is an assumption, not a measurement**, and this repository already contains **two GEX
  implementations that disagree on the risk-free rate AND the dealer sign** (`gex-skew.js` `r=0.065`
  vs `vol-context.js` `r=0`, opposite sign). The paper's edge comes from *knowing* dealer positioning;
  the platform can only *assume* it.
- **Classification: VERIFIED (phenomenon) · NOT MEASURABLE (dealer sign, on this platform).**
- **Should implement?** **BLOCKED.** Publishing GEX with an assumed sign is presenting an assumption as
  a measurement — the exact Article 3 violation this project forbids. Resolve the two-implementation
  disagreement *and* state the sign assumption explicitly, or do not ship it.

### 2.2 Pinning / expiry clustering

- **Definition.** Underlying tends to close near a high-OI strike on expiry, driven by market-maker
  delta-hedge rebalancing.
- **Evidence [VERIFIED THIS SESSION].** Ni, Pearson & Poteshman (2005), *"Stock price clustering on
  option expiration dates,"* **Journal of Financial Economics 78(1), 49–87**
  ([SSRN 519044](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=519044),
  [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0304405X05000577)). ~16.5 bp
  average expiry-date return distortion. Supporting: Avellaneda & Lipkin, *"A Market-Induced Mechanism
  for Stock Pinning"* ([SSRN 458020](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=458020));
  *"Pinning in the S&P 500 futures,"* JFE (2012) [RECALLED — VERIFY].
- **The India blocker — MEASURED.** Pinning is a **physical-delivery** phenomenon: it works because
  market makers must hold or deliver shares. **NIFTY, BANKNIFTY, FINNIFTY are CASH-SETTLED.** The
  hedging-unwind mechanism that produces pinning in single stocks does not transfer to a cash-settled
  index without evidence, and I found **no** paper establishing pinning in NIFTY. The S&P-futures result
  is the closest analogue and it is futures, not cash index.
- **Classification: VERIFIED (US single stocks) · UNKNOWN (Indian cash-settled index).**
- **Should implement?** **NO — until measured on NIFTY.** The platform has 600 days of EOD bhavcopy and
  can *test* whether NIFTY closes cluster at high-OI strikes on expiry. **That test is EOD-YES and has
  not been run.** Run the test before believing the effect exists here.

### 2.3 Charm / Vanna flows

- **Definition.** Charm = dδ/dt, Vanna = dδ/dσ. Predictable dealer re-hedging as time passes (charm) or
  as IV moves (vanna) is a documented intraday flow driver.
- **Evidence [RECALLED — VERIFY BEFORE CITING].** Discussed in the dealer-hedging literature
  (Barbon & Buraschi and others on "gamma fragility"); I did **not** verify a specific DOI this session.
- **Required data.** Dealer positioning (sign) + intraday spot/IV path. **PROPRIETARY-NO + INTRADAY-NO.**
- **Classification: NOT MEASURABLE on this platform.**
- **Should implement?** **BLOCKED.** Same barrier as GEX, plus it needs the intraday history the
  platform does not have.

---

## TIER 3 — Real microstructure edges that require data this platform will NEVER have from a broker feed

Every item here is **TICK-NO**. Listed so the roadmap never mistakes them for reachable.

| concept | canonical reference | why unreachable |
|---|---|---|
| **Kyle's lambda** (price impact of order flow) | [RECALLED] Kyle (1985), *"Continuous Auctions and Insider Trading,"* Econometrica 53(6). **VERIFY DOI.** | needs signed trade-by-trade order flow |
| **Amihud illiquidity** | [RECALLED] Amihud (2002), *J. Financial Markets* 5(1). **VERIFY DOI.** | needs daily volume + return; *arguably EOD-computable* for the underlying, but not for per-strike options at the resolution it assumes |
| **Hasbrouck information share** | [RECALLED] Hasbrouck (1995), *"One Security, Many Markets,"* Journal of Finance 50(4). **VERIFY DOI.** | needs multi-venue tick data |
| **LOB imbalance / microprice** | [RECALLED] Stoikov, *"The micro-price"*; Cont-Kukanov-Stoikov. **VERIFY.** | needs Level-2 book |
| **Queue position / fill probability** | practitioner + academic LOB models | needs Level-3 / order-by-order |
| **Iceberg / hidden liquidity detection** | LOB literature | needs full-depth tick |
| **Realised-vol jump separation** (bipower variation) | [RECALLED] Barndorff-Nielsen & Shephard (2004/2006). **VERIFY.** | needs intraday high-frequency returns; the platform has 1 session |

**Verdict for the entire tier: IMPOSSIBLE on the current data feed.** Not "hard" — the inputs are
structurally unavailable through a broker REST/websocket chain. No roadmap item changes this.

---

## PHASE 7 — Indian-market applicability, per instrument

| instrument | settlement | pinning testable? | VRP testable? | OI unit |
|---|---|---|---|---|
| NIFTY | cash | EOD-YES (untested) | EOD-YES | **units (verified)** |
| BANKNIFTY | cash | EOD-YES | EOD-YES | **units (verified)** |
| FINNIFTY | cash | EOD-YES | EOD-YES | **units (verified)** |
| MIDCPNIFTY | cash | EOD-YES | EOD-YES | **units (verified)** |
| NIFTYNXT50 | cash | EOD-YES | EOD-YES | **units (verified)** |
| SENSEX / BANKEX (BSE) | cash | needs BSE bhavcopy | needs BSE data | **UNKNOWN — never tested** |
| Single-stock options | **physical delivery** | pinning literature **directly applies** | VRP applies | not tested here |

**The one place the pinning literature transfers cleanly — single-stock physical-delivery options — is
the one place this platform does not trade.** The indices it does trade are cash-settled, where the
mechanism is unproven.

---

## PHASE 8/9 — Ranked, honest, and short

I will not manufacture a Top 100. Here is what is **both documented and reachable**, most valuable first.
Everything not on this list is Tier 2/3 above — real, but blocked by data.

| rank | feature | data | classification | implement? |
|---|---|---|---|---|
| 1 | **Test NIFTY expiry pinning on 600 bhavcopy days** | EOD-YES | UNKNOWN → measurable | **YES (research task)** |
| 2 | **Delta-hedged, cost-net VRP backtest** through `bt-validate.js` | EOD-YES | VERIFIED phenomenon | **YES** — replaces the invalid claim |
| 3 | **IV term-structure / smile features** from bhavcopy | EOD-YES | ESTIMATED | LATER (feature) |
| 4 | **Realised-vs-implied vol series** (the VRP input) | EOD-YES | VERIFIED | YES (data) |
| 5 | **Naive GEX with an EXPLICIT sign assumption + reconcile the two impls** | EOD-YES arithmetic | NOT MEASURABLE (sign) | BLOCKED until §2.1 resolved |
| — | Everything in Tier 3 | TICK-NO | IMPOSSIBLE | NO |

---

## Failure modes, false-positive & overfitting risk — for the reachable items

- **VRP (delta-hedged).** Failure mode: tail events (the "-800%" the India VIX survey warns of); the
  premium is compensation for exactly that risk, so a backtest that avoids a crash **overstates** the
  edge. Overfitting risk: HIGH if strike/DTE/stop are tuned (the platform's current script has eight
  tuned constants). **Sample requirement:** the premium is small; needs many independent expiries and a
  deflated-Sharpe / PSR gate — which `bt-validate.js` already implements and which is currently unused.
- **Pinning test.** False-positive risk: multiple-testing across strikes; a cluster at *some* strike is
  likely by chance. Requires a pre-registered strike definition and a significance test, not eyeballing.
- **GEX.** False-positive risk: **structural.** With the sign assumed, any "signal" is a restatement of
  the assumption. This is why it is blocked, not merely deferred.

---

## Unknown appendix

- Whether NIFTY exhibits pinning — **testable, untested.**
- The correct dealer-sign convention — **the two in-repo implementations disagree; unresolved.**
- Whether the Indian VRP survives realistic costs — **the platform's own backtest was invalid; open.**
- BSE OI unit — **UNVERIFIED.**
- Every Tier-3 microstructure edge — **structurally unobservable here; not "unknown", but "unreachable".**

## References verified this session

1. Bakshi & Kapadia (2003), RFS 16(2), 527–566. [JSTOR 1262684](https://www.jstor.org/stable/1262684) ·
   [SSRN 267106](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=267106).
2. Garleanu, Pedersen & Poteshman (2009), RFS 22(10), 4259–4299.
   [NBER w11843](https://www.nber.org/papers/w11843) ·
   [SSRN 676501](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=676501).
3. Ni, Pearson & Poteshman (2005), JFE 78(1), 49–87.
   [SSRN 519044](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=519044).
4. Avellaneda & Lipkin, *"A Market-Induced Mechanism for Stock Pinning."*
   [SSRN 458020](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=458020).

Every other citation in this document is tagged **[RECALLED — VERIFY BEFORE CITING]** and must be
confirmed against the primary source before it is used as evidence for any decision.

---

## The single research conclusion

**The only edges this platform can both cite and compute belong to the volatility-risk-premium family,
and the platform's own evidence for that family is currently invalid.** Everything richer — dealer
gamma, pinning-for-profit, charm/vanna, any microstructure alpha — is blocked either by the missing
dealer-inventory data or by the missing tick data, and no amount of engineering produces that data from
a broker REST feed.

**The correct next research act is not to find a new edge. It is to run the two tests the platform can
already run — the pinning test on 600 bhavcopy days, and a delta-hedged cost-net VRP backtest through
the unused `bt-validate.js` — and let them return a verdict.** One of them may survive. Neither has been
run.
