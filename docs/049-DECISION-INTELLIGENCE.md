# 049 — DECISION INTELLIGENCE, META DECISION ENGINE & ENTERPRISE DECISION GOVERNANCE

**Standard:** Master Prompt 049 · **Depends on:** 000-A … 048
**Date:** 2026-07-13 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No strategies created. No performance optimized.**

**049's stop condition: *"Never recommend execution solely because a majority of models agree; decisions
must remain evidence-based, RISK-AWARE and auditable."***

**Audits 041–048 dissected the AI stack. Audits 012–014 dissected the money stack. 049 asks the question
that sits between them, and that nobody has asked: **does the decision engine know anything about risk?***

---

# ═══════════════════════════════════════════════════════════
# SECTION 0 — THE DECISION ENGINE IS RISK-BLIND,
#             AND THE CIRCUIT-BREAKER IS CONSULTED BY NOBODY
# ═══════════════════════════════════════════════════════════

## §0.1 — 🔴 Ten inputs. All ten are market data. Zero are capital.

**Measured — every factor fed to `masterConfluence.fuse()` at `server.js:5417`:**

```
   1. trend        market      6. pcr          market
   2. smartMoney   market      7. greeks       market
   3. oi           market      8. fii          market
   4. volume       market      9. iv (VIX)     market
   5. news         market     10. event        market   ← kind:'risk', but it is EVENT-CALENDAR risk
                                  delivery     market
```

```
   🔴 consecLosses      →  NOT AN INPUT
   🔴 halted            →  NOT AN INPUT
   🔴 capital / equity  →  NOT AN INPUT
   🔴 drawdown          →  NOT AN INPUT
   🔴 open positions    →  NOT AN INPUT
   🔴 daily loss        →  NOT AN INPUT
```

> ## 🔴 **THE TWO LEGS MARKED `kind: 'risk'` ARE `event` AND `delivery`. THEY MEASURE MARKET RISK — AN RBI POLICY DATE, A BUDGET DAY. THEY KNOW NOTHING ABOUT THE ACCOUNT.**
>
> **The decision engine can return **BUY · 82% · VERY HIGH conviction** while the account is halted, down
> 5% on the day, and sitting on fifteen consecutive losses against a limit of eight. Nothing in `fuse()`
> can see any of that.**

## §0.2 — 🔴 The recommendation surface has NO risk gate at all

```js
server.js:5428
  app.get('/api/master-signal/:inst(nifty|sensex|banknifty)', async (req, res) => {
    const out = await gatherMasterSignal(req.params.inst.toUpperCase(), …);
    const { _chain, ...pub } = out;
    res.json(pub);                    // ◀── straight out. No halt check. No risk check. Nothing.
  });
```

**That endpoint feeds `dashboard.html`, `command.html`, `command-pro.html`, `agents.html`,
`pattern-signals.html` and `payoff.html` *(046)*.**

> ## 🔴 **A HUMAN LOOKING AT THE DASHBOARD SEES "BUY · VERY HIGH CONVICTION" AND HAS NO WAY OF KNOWING THAT THE RISK ENGINE HAS TRIPPED. The recommendation surface and the risk surface are not merely separate — they have never been introduced.**

## §0.3 — 🟢 AND YET — the AI risk gate is one of the best things in this repository

```js
agents-engine.js:182   function riskGate(ctx) {
  add('Market hours',                      ctx.inMarketHours);
  add('Signal fired',                      ctx.decision === 'BUY' || ctx.decision === 'SELL');
  add(`Probability ≥ ${ctx.minProb}%`,     (ctx.probability || 0) >= ctx.minProb);
  add('VIX regime',                        !ctx.vixExtreme);
  add('Event risk',                        (ctx.eventRisk || 0) < 70);
  add(`Premium not rich (IVP ≤ 70)`,       !(ctx.ivp != null && ctx.ivp > 70));
  add(`Trades today < ${ctx.maxTrades}`,   (ctx.tradesToday || 0) < ctx.maxTrades);
  add('No open position',                  !ctx.hasOpen);
  add('Daily loss cap',                    !ctx.dailyLossHit);        // 🟢 REAL CAPITAL RISK
  add('Square-off window',                 !ctx.pastSquareOff);
  const go = checks.every(c => c.pass);                               // 🟢 ALL must pass — fail-closed
}
```

> 🟢 **Ten checks. `checks.every(...)` — every single one must pass. A daily loss cap, an open-position
> check, a trade-count cap, a square-off window, an IVP gate that explicitly refuses to buy rich premium
> ("buying rich premium is the classic bleed"). This is a genuinely well-designed circuit and it is
> fail-closed by construction.**
>
> 🟢 **And `(ctx.probability || 0) >= ctx.minProb` — if the probability is unknown, `|| 0` makes it ZERO,
> which FAILS the check and BLOCKS the trade. That is the correct direction of failure. In a codebase with
> 119 `|| 0` sites, this one points the right way.**

## §0.4 — 🔴 **BUT THE CIRCUIT-BREAKER IS CONSULTED BY NOBODY**

**Measured — `grep` for `consecLosses` / `halted` across every engine that consumes a verdict:**

```
   agents-engine.js         →  0 matches
   signal-paper-engine.js   →  0 matches
   strangle-engine.js       →  0 matches
   gamma-blast-engine.js    →  0 matches
                               ─────────
                                🔴  ZERO
```

**`consecLosses` and `_haltedReason` live in `execution-engine.js` — the protected file. Audit 013 measured
their live values before the bot died:**

```
   NIFTY:   consecLosses: 15     maxConsecLosses: 8     halted: false     autoEnabled: true
```

> ## 🔴 **THE PLATFORM HAS A CENTRAL RISK BRAKE. IT WAS AT FIFTEEN AGAINST A LIMIT OF EIGHT. AND NOT ONE OF THE FOUR ENGINES THAT ACT ON THE DECISION ENGINE'S OUTPUT HAS EVER LOOKED AT IT.**
>
> **Each engine carries its OWN daily-loss cap — which is good, and which is why the platform has not lost
> more money than it has. But there is no single risk AUTHORITY. There are five independent risk opinions,
> and the one that represents the platform's actual circuit-breaker is not among the five that anyone
> reads.**
>
> **049's stop condition: *"decisions must remain evidence-based, RISK-AWARE and auditable."* Risk
> integration is not weak here. It is **absent from the decision layer entirely**, and the risk state that
> does exist is orphaned.**

## §0.5 — 🔴 And the risk gate's third check is built on a number with no meaning

```js
   add(`Probability ≥ ${ctx.minProb}%`, (ctx.probability || 0) >= ctx.minProb);
                          ▲
        this is master-confluence.js:103 —  50 + |net|/100 × 45 × (0.55 + 0.45 × agreement)
```

> ## 🔴 **THE RISK GATE'S PRIMARY QUANTITATIVE CHECK IS A THRESHOLD ON A HAND-TUNED AFFINE HEURISTIC THAT AUDIT 048 PROVED HAS NO CALIBRATION, NO DEFINITION, AND WHOSE VALUE WAS DISCARDED ON 20 OF 21 RECORDED DECISIONS.**
>
> **And 047 measured the `agreement` term inside it: agreement was HIGHER on losses than on wins, and the
> only unanimous decision in the platform's history LOST. (p = 0.209 — not significant, and therefore not a
> claim. But it is certainly not support.)**
>
> **The gate is well-built. The number it is gating on is not a number.**

## §0.6 — 🔴 Two of the ten checks FAIL OPEN when the input is unknown

```js
   add('Event risk',   (ctx.eventRisk || 0) < 70);
                        ▲ eventRisk comes from deps. If the event engine is unavailable → undefined
                          → (undefined || 0) = 0 → 0 < 70 → 🔴 PASSES.
                          AN UNKNOWN EVENT RISK IS TREATED AS NO EVENT RISK.

   add('Premium not rich', !(ctx.ivp != null && ctx.ivp > 70));
                        🟡 fail-open TOO — but it says so out loud: 'IVP n/a — allowed'.
                           An honest fail-open, disclosed in the note the user sees.
```

> **`Unknown ≠ Zero`. On the event-risk check, unknown IS zero, and zero means "proceed." On budget day,
> with the event feed down, this gate opens.**

---

# PART 1 — DECISION INPUT INVENTORY

| ID | Input | Source | Validation | Reaches the decision? |
|---|---|---|---|---|
| **D-01** | Market data / spot | 3 connectors | 🟡 | 🟢 YES |
| **D-02** | Option chain | broker | 🔴 **no Greeks, no IV in source** *(036)* | 🟢 YES |
| **D-03** | Greeks | computed | 🔴 **TWO `bsGamma` implementations disagree 6.79%** *(036)* | 🟢 YES |
| **D-04** | Implied volatility / VIX | `eventEngine.getVix()` | 🔴 **a fabricated IV of 0.14 at `gex-skew.js:49`** | 🟢 **YES — as a DIRECTIONAL lean, never as a reliability gate (§0 note below)** |
| **D-05** | Open interest | chain | 🔴 **`oi` is 20% accurate and the LOUDEST leg** *(041/047)* | 🟢 YES |
| 🔴 **D-06** | **Feature store** | — | 🔴 **DOES NOT EXIST** *(035)* | 🔴 **NO** |
| **D-07** | AI models (fusion + learner) | `master-confluence` | 🔴 **33.8% factor accuracy** *(041)* | 🟢 YES |
| **D-08** | Ensemble output | `fuse()` | 🔴 **N_eff = 3.71 of 7** *(047)* | 🟢 YES |
| 🔴 **D-09** | **Reliability score** | — | 🔴 **DOES NOT EXIST** *(048)* | 🔴 **NO** |
| **D-10** | Risk signals — MARKET | `event`, `delivery` | 🟡 | 🟢 YES |
| 🔴 **D-11** | **Risk signals — CAPITAL (`consecLosses`, `halted`)** | `execution-engine` | 🔴 **15 against a limit of 8** *(013)* | 🔴 **NO. NOBODY READS IT (§0.4)** |
| 🟢 **D-12** | **Portfolio constraints** (open position, trades today, daily loss) | `agents-engine` | 🟢 **REAL** | 🟢 **YES — but only inside agents-engine** |
| 🟡 **D-13** | Paper trading evidence | ledgers | 🟢 **the only clean evidence** | 🔴 **NO — it never feeds back into a decision** |
| 🔴 **D-14** | **Human overrides** | — | 🔴 **engine toggles over UNAUTHENTICATED HTTP** *(023)* | 🟡 |

## **14 inputs. 3 do not exist. The one that represents the platform's circuit-breaker reaches no decision at all.**

**And a finding worth its own line:**

> ## 🔴 **VIX ENTERS THE DECISION AS A DIRECTIONAL SIGNAL — `score = −(vix.changePct) × 5` — NEVER AS A RELIABILITY CONDITION.**
>
> **Audit 045 measured the short strangle LOSING MONEY at realised volatility ≥ 15% (₹−13/trade, Sharpe
> −0.06). The platform uses volatility to guess which way the market will go. It never uses volatility to
> say *"do not trust me right now."***

---

# PART 2 — DECISION LIFECYCLE

```
  Market Observation      🟢
       ↓
  🔴 Feature Generation   🔴  computed, then DISCARDED  (035)
       ↓
  Model Evaluation        🟢  fuse() — pure, deterministic
       ↓
  🔴 Reliability Asmt.    🔴🔴  ══ DOES NOT EXIST ══  (048)
       ↓
  🔴 Risk Assessment      🔴🔴  ══ MARKET RISK ONLY. CAPITAL RISK IS NOT AN INPUT. §0.1 ══
       ↓
  Evidence Aggregation    🟡  a weighted mean of 3.7 effective opinions  (047)
       ↓
  🔴 Conflict Resolution  🔴  there is no policy. There is an average.
       ↓
  Decision Recommendation 🟢  BUY / SELL / HOLD + a "probability"
       ↓                       │
  🔴 Human Review         🔴   ├──▶ 🔴 6 DASHBOARDS — RAW, UNGATED. §0.2
       ↓                       │
  Execution Approval      🟢   └──▶ 🟢 agents-engine riskGate — 10 checks, fail-closed. §0.3
       ↓                              🔴 …which never checks consecLosses or halted. §0.4
  Audit                   🟡  21/21 keep the leg table 🟢 · 1/21 keeps the confidence 🔴  (046)
```

## 🔴 **The lifecycle FORKS after the recommendation. One branch goes to a well-built risk gate. The other goes straight to a human being's screen with nothing in between.**

---

# PART 3 — EVIDENCE GOVERNANCE

| Aspect | Assessment |
|---|---|
| **Evidence weighting** | 🟡 weight × confidence — 🔴 **but a missing leg confidence becomes `60`** *(047)* |
| 🔴 **Source independence** | 🔴 **FAILS — N_eff = 3.71 of 7. `oi` and `pcr` read the same data and vote twice** *(047)* |
| 🔴 **Conflicting evidence** | 🔴 **NO POLICY — conflicts are averaged away** |
| 🟡 **Missing evidence** | 🟢 **HANDLED WELL — `available: false` legs are excluded; `minFactors: 4` refuses to decide on too few. Fail-closed and correct** |
| 🔴 **Evidence freshness** | 🔴 **NOT CHECKED — a stale factor and a fresh one are weighted identically** |
| 🔴 **Statistical support** | 🔴 **NONE — 0 of 8 confidence outputs are calibrated** *(048)* |

## 🔴 **049: *"Evidence quality must be distinguished from evidence quantity."* The fusion distinguishes them not at all. Nine legs are counted; three-and-a-half exist; two have never voted; one is 20% accurate and shouts loudest.**

---

# PART 4 — META DECISION GOVERNANCE

| Required | Documented? |
|---|---|
| **Decision objectives** | 🔴 **NO — no hypothesis register exists** *(043)* |
| 🟡 **Acceptance criteria** | 🟡 **`net ≥ 12` → BUY. Explicit in code, undocumented as policy** |
| 🟡 **Rejection criteria** | 🟡 **`probability < 58` → HOLD; severe risk → HOLD. Explicit and good** |
| 🟢 **Abstention criteria** | 🟢 **`minFactors: 4` → `conviction: 'INSUFFICIENT'`. GENUINELY WELL-DESIGNED** |
| 🔴 **Escalation criteria** | 🔴 **NONE — nothing escalates. Ever** |
| 🔴 **Manual intervention rules** | 🔴 **NONE — and the toggles are unauthenticated** *(023)* |

> 🟢 **Credit: abstention is the hardest of these to get right, and the platform got it right. `minFactors`
> and the `INSUFFICIENT` conviction are real fail-closed engineering.**

---

# PART 5 — CONFLICT RESOLUTION

| Situation | Policy |
|---|---|
| **Models disagree** | 🔴 **NO POLICY — averaged** |
| 🔴 **Risk engine blocks execution** | 🔴 **THE DECISION ENGINE CANNOT SEE THE RISK ENGINE (§0.1/§0.4)** |
| 🔴 **Reliability is low** | 🔴 **NO CONCEPT OF RELIABILITY EXISTS** *(048)* |
| 🔴 **Market regime uncertain** | 🔴 **NO REGIME AWARENESS. And 045: NEGATIVE at vol ≥ 15%** |
| 🟢 **Evidence incomplete** | 🟢 **HANDLED — `minFactors: 4`, fail-closed** |
| 🔴 **Confidence conflicts with risk** | 🔴 **CANNOT ARISE — they never meet** |

## 🔴 **Six conflict situations. One is handled. One cannot even be detected, because the two parties to the conflict have never been wired together.**

---

# PART 6 — DECISION EXPLANATION

| Every recommendation must record | Present? |
|---|---|
| 🟢 **Supporting evidence** | 🟢 **YES — 21/21 full leg attribution. Excellent** *(046)* |
| 🟢 **Contributing models** | 🟢 **YES** |
| 🔴 **Reliability assessment** | 🔴 **NONE EXISTS** |
| 🟡 **Risk assessment** | 🟡 **MARKET risk yes; CAPITAL risk never** |
| 🟢 **Decision rationale** | 🟢 **YES — the `reason` string and the leg table** |
| 🔴 **Known limitations** | 🔴 **NONE — a 20%-accurate leg renders like any other** |

---

# PART 7 — OBSERVABILITY

| Every decision must record | Present? |
|---|---|
| 🟢 Decision identifier (`signalId`) | 🟢 **YES** |
| 🟢 Timestamp | 🟢 **YES** |
| 🔴 Input versions | 🔴 **NO** |
| 🔴 **Model versions** | 🔴 **NO — the model has no version** *(044)* |
| 🔴 Reliability version | 🔴 **N/A — none exists** |
| 🔴 Risk version | 🔴 **NO** |
| 🟢 Final recommendation | 🟢 **YES** |
| 🟡 Final outcome | 🟡 **21 resolved — but 20 of 21 discarded the confidence** *(046)* |

## **8 fields. 4 recorded. Decision history is NOT reproducible.**

---

# PART 8 — FAILURE MODE REGISTER

| Failure mode | Present? | Impact |
|---|---|---|
| 🔴 **Unsupported recommendations** | 🔴 **CONFIRMED** | 🔴 **"VERY HIGH conviction" from an uncalibrated heuristic** *(048)* |
| 🔴 **Hidden decision rules** | 🔴 **CONFIRMED** | 🔴 **The weights changed silently on 2026-07-01; `baselineSum` 92 → 99** *(044)* |
| 🔴 **Missing evidence** | 🔴 **CONFIRMED — THE HEADLINE** | 🔴 **The circuit-breaker (`consecLosses` 15/8) is not an input to any decision (§0.4)** |
| 🔴 **Excessive confidence** | 🔴 **CONFIRMED** | 🔴 **The confidence rises with `agreement`, which 047 could not support in either direction** |
| 🔴 **Silent overrides** | 🔴 **CONFIRMED** | 🔴 **`config-overrides.json` silently beats `.env` — 5% vs 2%** *(004)*, **and is HTTP-deletable** *(039)* |
| 🔴 **Conflicting evidence** | 🔴 **CONFIRMED** | 🔴 **Averaged, never adjudicated** |
| 🟡 **Circular dependencies** | 🟡 **NOT DETECTED** | 🟢 legs read the market, not each other |
| 🟡 **Decision oscillation** | 🟡 **UNKNOWN** | 🔴 **Cannot be assessed — 20 of 21 confidences were discarded** |

---

# PART 9 & 10 — DECISION ARCHITECTURE & CONTRACTS (conceptual — no code)

```
   🔴 RiskAuthority  ★★★   — THE PRIMITIVE WHOSE ABSENCE IS §0.4
     ONE risk state. ONE owner. Every decision surface reads it BEFORE it publishes.
       consecLosses · halted · drawdown · daily loss · open exposure · capital
     🔴 Today there are FIVE independent risk opinions (one per engine) and the platform's
        actual circuit-breaker — consecLosses 15 against a limit of 8 — is read by NONE of them.
     🔴 A decision engine that cannot see the halt is not risk-aware. It is risk-ignorant
        and merely happens to be downstream of something that is not.

   🔴 ReliabilityGate  ★★★
     RELIABILITY IS NOT CONFIDENCE. Confidence says "the legs agree."
     Reliability says "in THIS regime, this model has been right X% of the time."
     🔴 045: the strategy LOSES MONEY at realised vol >= 15%. The platform uses VIX to guess
        DIRECTION and never to gate TRUST. Volatility should silence the model, not steer it.

   🟢 AbstentionLayer  ★  — ALREADY EXISTS AND IS CORRECT
     minFactors: 4 → conviction 'INSUFFICIENT'. Fail-closed. Keep it. Extend it.

   DecisionAuditRegistry  ★
     🔴 A decision must record: model version · risk state AT THE TIME · confidence · outcome.
        Today it records 4 of 8, and the two missing ones are version and risk.

   THE RULE 049 ESTABLISHES:
     🔴 A RECOMMENDATION THAT CANNOT SEE THE RISK STATE IS NOT A RECOMMENDATION.
        It is a market opinion. The moment it is rendered as "BUY · VERY HIGH conviction"
        on a dashboard, next to no indication that the account is at 15 losses against a
        limit of 8, it has been PROMOTED to a recommendation by the interface — and the
        interface has no right to do that.
```

---

# PART 11 — TESTING STRATEGY

**Decision correctness has priority over decision frequency.**

| Test | Priority | Fails today? |
|---|---|---|
| 🔴 **No decision surface publishes without reading the risk state** | **P0 — §0.2/§0.4. THE ONE** | ✅ **FAILS — `/api/master-signal` is ungated** |
| 🔴 **`consecLosses` and `halted` are inputs to every gate** | **P0 — §0.4** | ✅ **FAILS — 0 of 4 engines read them** |
| 🔴 **An unknown event risk BLOCKS, never passes** | **P0 — §0.6** | ✅ **FAILS — `(eventRisk \|\| 0) < 70`** |
| 🔴 **Reliability (not confidence) gates the decision** | **P0 — 045: negative at high vol** | ✅ **FAILS — no reliability exists** |
| 🔴 **Every decision records the risk state at the time** | **P0** | ✅ **FAILS** |
| 🟢 **`checks.every(...)` — all 10 gates must pass** | P0 | 🟢 **PASSES — fail-closed. Lock it in** |
| 🟢 **`(probability \|\| 0)` blocks on an unknown probability** | P0 | 🟢 **PASSES — the `\|\| 0` points the RIGHT way here** |
| 🟢 **`minFactors: 4` abstains on sparse evidence** | P0 | 🟢 **PASSES** |

---

# PART 12 — DECISION MATURITY

| Level | Met? | Evidence |
|---|---|---|
| **0 — Manual** | 🟢 **SURPASSED** | — |
| **1 — Rule-Based** | 🟢 **YES** | 🟢 **`fuse()` + a 10-check fail-closed risk gate. Competent engineering** |
| **2 — Assisted Decision Support** | 🟡 **PARTIAL** | 🟢 explanations are excellent *(046)* · 🔴 **the recommendation surface is ungated (§0.2)** |
| **3 — Governed Decision Intelligence** | 🔴 **NO** | 🔴 **The circuit-breaker is not an input to any decision (§0.4)** |
| **4 — Enterprise Decision Platform** | 🔴 **NO** | 🔴 **No reliability layer; no single risk authority** |
| **5 — Institutional** | 🔴 **NO** | — |

## ## **DECISION PLATFORM: LEVEL 1–2 — RULE-BASED, with genuinely good abstention and a genuinely good risk gate that is wired to the wrong risk.**

---

# PART 13 — MIGRATION ROADMAP

| Phase | Preconditions | Risks | Exit criteria |
|---|---|---|---|
| **1 — INVENTORY** | ✅ **DONE — Part 1. 14 inputs; the circuit-breaker reaches none** | — | Every input named |
| **2 — 🔴 WIRE THE RISK STATE INTO THE DECISION (do this first)** | 🟡 **`consecLosses`/`halted` live in `execution-engine.js` — PROTECTED. A READ is additive** | 🟡 **MEDIUM — protected file. A read-only accessor needs an approval package** | 🔴 **No verdict is published without the risk state beside it. The dashboard shows "HALTED" when it is halted** |
| **3 — RELIABILITY GATE** | Phase 2 + 048 | 🟡 | 🔴 **High realised vol SILENCES the model instead of steering it (045)** |
| **4 — ONE RISK AUTHORITY** | Phase 3 | 🔴 **5 engines each own a risk opinion today** | 🔴 **One risk state. One owner. Five readers** |
| **5 — INSTITUTIONAL** | Phase 4 | Low | Versioned, reproducible, risk-aware decisions |

---

# PART 14 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every decision is traceable | 🟡 **PARTIAL — leg table yes; model version and risk state no** |
| 🟢 **Every recommendation cites supporting evidence** | 🟢 **YES — 21/21. The platform's strongest dimension** |
| 🔴 **Reliability influences decisions explicitly** | 🔴 **NO — reliability does not exist** *(048)* |
| 🔴 **Risk constraints enforced consistently** | 🔴 **NO — 5 independent risk opinions; the circuit-breaker is read by none (§0.4)** |
| 🔴 **Conflicts resolved transparently** | 🔴 **NO — they are averaged** |
| 🟢 **Abstention supported when evidence is insufficient** | 🟢 **YES — `minFactors: 4`. Genuinely well-built** |
| 🔴 **Unknown conditions never shown as high-confidence** | 🔴 **NO — an unknown event risk PASSES the gate (§0.6); an n=0 leg renders as a number** |

## **2.5 of 7.**

---

# STOP CONDITIONS

| Condition | Verdict |
|---|---|
| *Decision logic cannot be reconstructed* | 🟢 **DOES NOT FIRE — `fuse()` is pure and readable** |
| *Evidence cannot be traced* | 🟢 **DOES NOT FIRE — 21/21 retain full attribution** |
| *Reliability integration is undocumented* | 🔴 **FIRES — there is no reliability layer to integrate** |
| 🔴 *Risk integration cannot be verified* | 🔴 **FIRES — AND IT IS THE FINDING. The decision engine has no capital-risk input, and the circuit-breaker is read by zero of four engines** |

---

# EXECUTIVE SUMMARY

**The mission: could an independent decision architect reconstruct any recommendation, verify evidence
quality, and evaluate how reliability and risk are integrated into the decision?**

## **The evidence: yes, and it is excellent. The reliability: it does not exist. The risk: the decision engine has never heard of it.**

> ## 🔴 **TEN FACTORS FEED THE DECISION ENGINE. ALL TEN ARE MARKET DATA.**
>
> **`trend · smartMoney · oi · volume · news · pcr · greeks · fii · iv · event`. The two legs labelled
> `kind: 'risk'` measure MARKET risk — an RBI date, a budget day. They know nothing about the account.**
>
> ```
>    consecLosses · halted · capital · drawdown · open positions · daily loss
>                        ── NOT ONE OF THEM IS AN INPUT ──
> ```
>
> **The engine can return **BUY · 82% · VERY HIGH conviction** while the account is halted, down 5% on the
> day, and holding fifteen consecutive losses against a limit of eight. And `GET /api/master-signal`
> publishes that verdict, raw and ungated, to six dashboards. A human reading it has no way to know the
> risk engine has tripped.**

**And then the measurement that settles it:**

> ```
>    grep consecLosses|halted  across every engine that acts on a verdict:
>
>      agents-engine.js        →  0
>      signal-paper-engine.js  →  0
>      strangle-engine.js      →  0
>      gamma-blast-engine.js   →  0
> ```
>
> ## 🔴 **THE PLATFORM HAS A CIRCUIT-BREAKER. IT WAS AT FIFTEEN AGAINST A LIMIT OF EIGHT. NOT ONE ENGINE HAS EVER LOOKED AT IT.**
>
> **There is no single risk authority. There are five independent risk opinions, each engine holding its
> own, and the one that represents the platform's actual brake is read by nobody. That is why audit 013's
> finding — `/api/risk` reporting zero losses while the engine held fifteen — was survivable: nothing was
> listening to either number.**

**And yet — this document must also say the following, because it is true:**

> ## 🟢 **`agents-engine.js`'s `riskGate` IS ONE OF THE BEST PIECES OF ENGINEERING IN THIS REPOSITORY.**
>
> **Ten checks — market hours, signal fired, probability floor, VIX regime, event risk, an IVP gate that
> explicitly refuses to buy rich premium ("buying rich premium is the classic bleed"), a trade-count cap,
> an open-position check, a **daily loss cap**, and a square-off window — and `checks.every(...)`, so a
> single failure blocks the trade. It is fail-closed by construction.**
>
> **And `(ctx.probability || 0) >= ctx.minProb` — an unknown probability becomes zero, which FAILS and
> BLOCKS. In a codebase with 119 `|| 0` sites, this one points the right way.**
>
> **The gate is excellent. It is simply wired to the wrong risk — and the number it gates on
> (`probability`) is the uncalibrated affine heuristic audit 048 dismantled.**

**Two smaller findings that follow the same shape:**

> **🔴 `(ctx.eventRisk || 0) < 70` — if the event feed is unavailable, `undefined || 0` is zero, zero is
> less than seventy, and the gate OPENS. An unknown event risk is treated as no event risk. On budget day,
> with the feed down, this passes.**
>
> **🔴 VIX enters the decision as `score = −(vix.changePct) × 5` — a DIRECTIONAL lean. Audit 045 measured
> the strategy LOSING MONEY at realised volatility ≥ 15%. The platform uses volatility to guess which way
> the market will go, and never to say *"do not trust me right now."* Volatility should silence this model.
> Instead it steers it.**

## **The rule this document establishes:**

> ## **A RECOMMENDATION THAT CANNOT SEE THE RISK STATE IS NOT A RECOMMENDATION. IT IS A MARKET OPINION.**
>
> **The moment the interface renders it as "BUY · VERY HIGH conviction", in large type, with no indication
> that the account sits at fifteen losses against a limit of eight, the INTERFACE has promoted an opinion
> into a recommendation — and the interface has no right to do that.**

**Decision maturity: LEVEL 1–2. 2.5 of 7. The abstention logic is right, the risk gate is right, the
explanations are the best in the repository — and the decision engine, at the centre of all of it, has
never been told that the platform has a brake.**

---

**Strategies created: NONE. Performance optimized: NONE. Code modified: NONE. Suite: 48/48.**

**Deliverables:** Decision Input Inventory (Part 1) · Lifecycle (Part 2) · Evidence Governance (Part 3) ·
Meta Decision Review (Part 4) · **Conflict Resolution (§0, Part 5)** · Decision Explanation (Part 6) ·
Observability (Part 7) · Failure Mode Register (Part 8) · Decision Architecture (Parts 9–10) · Testing
Strategy (Part 11) · Maturity (Part 12) · Roadmap (Part 13) · Executive Summary.

**Stop conditions: decision logic — does not fire · evidence tracing — does not fire ·
RELIABILITY INTEGRATION 🔴 FIRES · RISK INTEGRATION 🔴 FIRES.**
