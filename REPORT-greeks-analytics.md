# RESEARCH REPORT — Greeks & options analytics on Antigravity Pro
### For: the "when are the Greeks right for profit?" tab · Compiled 2026-07-26 from a four-agent codebase sweep

Every claim below is cited to a file and line read this session. This report is the evidence base for
the implementation prompt (`PROMPT-greeks-tab-v2.md`). It is written to one purpose: to separate what a
Greeks tab **can honestly show** from what would be a number wearing a measurement's clothes.

---

## 0. The one-paragraph answer

The owner's question — *"when the Greeks are at what values does profit happen?"* — has two possible
tabs behind it. The **empirical** one ("historically, at delta X you profited") is **impossible to build
honestly here**: the platform stores **41–50 labelled outcomes total** (the strangle engine has **7**),
and **no engine records the entry Greeks next to the realized P&L**, so the study has neither enough rows
nor the right columns. The **deterministic** one is not only honest, it is the real answer: the Greeks
*are* the P&L relationship by definition, and the code already computes it from first principles. Build
that. Everything below is the detail that keeps it from lying.

---

## 1. There is no single set of "the Greeks" — there are four disagreeing engines

A UI that shows a Greek must know which engine produced it, because they do not agree.

| path | function | IV source | note |
|---|---|---|---|
| **Primary (real)** | `option-analyzer._rawGreeks` + `_impliedVol` | LTP-derived Newton-Raphson | the trustworthy path, when LTP > 0.5 |
| **Fallback** | `option-analyzer.calculateGreeks` | **hardcoded `0.15`** (TD-1) | ignores live IV entirely; returns `0`s + `unresolved:true` when expiry unknown |
| **Gamma-blast** | `getGammaBlastAlert` | `opts.iv \|\| 0.15` | heuristic scores on flat 15% vol unless caller passes IV |
| **Payoff** | `payoff-engine.legGreeks` | `leg.iv \|\| 12` | **vega divided by 100** — see §2 |

**The single most dangerous trap: vega scale differs 100× between engines.** `option-analyzer` returns
vega per *1.0* of vol (`option-analyzer.js:871` `vega = S*sqrtT*nd1`); `payoff-engine` returns it per *1
vol-point* (`payoff-engine.js:42`, `... /100`). A UI must **never place these side by side or sum them.**

Units that *are* consistent: **theta is per-day everywhere** (every path divides annual by 365 —
`option-analyzer.js:882`, `:225`; `payoff-engine.js:46`). **Delta** is per-share, CE ∈ [0,1], PE ∈ [−1,0]
— but the *backtest* path uses a cruder logistic approximation (`option-analyzer.js:1070`) that will not
match the live error-function delta. **Gamma** is positive, per index-point; the fallback prints it at 4dp
(`:89`) so simulated SENSEX gamma (~1e-5) often shows as `0.0000`.

---

## 2. IV is never observed — and a missing IV silently becomes a plausible number

Per the platform's own audit: *"EVERY GREEK AND EVERY IMPLIED VOLATILITY IN THIS PLATFORM IS COMPUTED
FROM A MODEL. NOT ONE IS OBSERVED"* (`036-OPTION-CHAIN-PLATFORM.md:26`). Worse, when the model has no
input, it does not return "unknown" — it returns a placeholder that looks real:

- LTP ≤ 0.5 → IV hardcoded **0.15** (`option-analyzer.js:687-688`).
- `calculateGreeks` fallback → vol hardcoded **0.15**, TD-1, ignores market IV (`option-analyzer.js:203`).
- `gex-skew.js:49-50` → missing IV becomes **0.14** (audit failure OC-4, CRITICAL).
- `vol-context.js:78` → missing IV becomes **12%**.
- `getGammaBlastAlert` → flat **15%** unless `opts.iv` passed (`option-analyzer.js:788`).

So **"IV 15.0%" on screen may mean "we have no idea."** The chain endpoint does expose an **`ivSource`**
field (`'bsm'` = we solved it, `'feed'` = broker reported it — `server.js:2319`); the tab must surface it,
because a `bsm`/placeholder IV and a real feed IV must never look the same.

**Two fields are pure `Math.random()`** and must never be shown as signal:
`ivPercentile` and `ivRank` in the IV summary (`option-analyzer.js:624-625`, `// Simulated`).

---

## 3. GEX / dealer-gamma / gamma-walls — do NOT put these on the tab

This is the strongest "no" in the research. The owner may expect a gamma-exposure view; it cannot be
shown honestly today, for four independent reasons, any one of which is disqualifying:

1. **Unit unknown on the live feed (F4).** Bhavcopy OI is in *units* (`contracts = oi/lot`), proven for 5
   NSE symbols — but *"What unit does the LIVE BROKER CHAIN report? UNKNOWN. If it reports units, every
   GEX number this platform has ever displayed is wrong by 65×"* (`036-…:74-76`). `gex-skew.js` emits an
   **unguarded** number regardless (`computeGEX().netGEX`, `:80`) — no gate.
2. **Fabricated IV** feeds it (0.14, above).
3. **Dealer-sign convention is unverified** and two modules implement it with **opposite signs**
   (`gex-skew.js:52-53` vs `vol-context.js:89-90`).
4. **Ambiguous zeros:** gamma is `0` on 33 of 198 legs where the feed cannot tell a true zero from an
   absent value (`EVIDENCE-F4-oi-unit.md:161`).

The evidence doc's closing line: *"Do not ship GEX on the strength of this document."* The measurable-edges
research agrees: dealer gamma is *"BLOCKED. Publishing GEX with an assumed sign is presenting an
assumption as a measurement"* (`RESEARCH-measurable-edges.md:114-117`). **This tab shows per-position
Greeks only. No chain-wide GEX, no gamma wall, no gamma flip.**

The one aggregate that *is* called reliable is **OI walls** (max-OI strikes) — but even OI has a `||0`
problem, so label it, don't compute risk from it.

---

## 4. The endpoints the tab can call (verified in server.js)

Reusable, real routes — prefer these over reinventing math in the browser:

| method · path | line | what it gives the tab |
|---|---|---|
| `GET /api/options/chain` (= `/snapshot`) | 2415 / 2406 | per-strike `ltp, oi, iv, ivSource, delta, gamma, theta, vega`, plus pcr/maxpain/spot/atm |
| `GET /api/options/greeks-matrix` | 2467 | ATM-centred rows `{strike, ce{delta,gamma,theta,vega,iv}, pe{…}}` + `summary` |
| `GET /api/options/greeks` | 2539 | single strike Greeks |
| `GET /api/strategy/payoff/prefill` | 5597 | `{spot, atm, step, lotSize, dteDays, strikes[]}` — **lotSize already resolved from registry** |
| `POST /api/strategy/payoff` | 5624 | **`payoff-engine.buildPayoff`** — the good path: honest `unbounded` flags, `maxLossLabel`, `riskReward:null` for naked, PoP, curve |
| `GET /api/pop/status` | 4291 | open paper book |
| `GET /api/vix` | 5323 | India VIX (returns a real value ~12 when reachable; `null` on outage) |

Three warnings on the endpoints:
- **TD-2 race:** `optionAnalyzer` is a single shared singleton mutated per request
  (`server.js:199`, `:2283-2284`, re-`initialize()`d at 2457/2475/2543/…). Concurrent NIFTY vs SENSEX
  calls can overwrite each other mid-flight. The tab should not fire many analytics calls in parallel for
  different instruments and assume isolation.
- **Some analytics endpoints hardcode Greeks.** `/api/nifty/options/analytics` and the BANKNIFTY twin
  return **hardcoded deltas 0.85/0.5/0.15** by moneyness and default `iv||12` (`server.js:2628-2633`).
  Do **not** source Greeks from these; use `/api/options/chain` or `/greeks-matrix`.
- **`greeks-matrix`, `/greeks`, `/iv-analysis`, `/top-activity` run on the *simulated* 20-strike chain**
  (`initialize(spot,20)`), not the live feed — acceptable for shape/education, not for a live position.
- No route is authenticated (`server.js:6192` comment) — not this task's problem, but do not add write
  actions to a research tab.

---

## 5. Why the empirical "Greek → profit" tab is forbidden

- **Sample:** 41–50 labelled outcomes platform-wide; strangle engine **7** (`pop-seller.js:501`,
  `OPTIONS-INTELLIGENCE-ENGINE.md:292`). The platform itself says ~200 are needed just to *calibrate one
  probability*. M2 forbids calibrated probability / Brier / ensembles until this rises.
- **Missing columns:** no outcome record stores entry Greeks with realized P&L. pop-seller's closed record
  keeps only `pop` (=1−|delta|), not delta/gamma/theta/vega/IV (`pop-seller.js:412-420`); the strangle
  closed record keeps no Greeks and drops even `ivPctAtEntry` (`strangle-engine.js:384`). *"every Greek"*
  is explicitly *Not stored per minute* and only **1 complete session** has been captured
  (`OPTIONS-INTELLIGENCE-ENGINE.md:96`).
- **Confounded P&L:** pop-seller P&L is **gross** of charges (`pop-seller.js:418, :496`) and its
  `buildIronCondor` returns **two naked shorts, no wings, no `maxLoss`** (`pop-seller.js:274-301, :493`).
  So the labels that exist are neither net nor risk-defined.
- The void `backtest-tv-results-*.json` `gammaBlast` Greeks are contaminated (same-day look-ahead) and
  must not be mined either.

Any "profit by delta" heatmap or win-rate-by-Greek view would therefore manufacture confidence from a
sample that cannot carry it. The honest verdict for such a claim is **INSUFFICIENT_DATA**.

---

## 6. What the tab CAN show — the deterministic Greek→P&L identity

These are closed-form facts the code already computes, no history required:

- **Theta** = the ₹/day a seller harvests (a buyer pays), per-day in every engine. Positive net theta is
  the seller's structural profit engine.
- **Delta** = ₹ P&L per 1-point move; **Gamma** = how fast that delta (your risk) accelerates; **Vega** =
  ₹ P&L per vol-point (watch the 100× scale, §1).
- **PoP = 1 − |delta|** — the risk-neutral probability of finishing OTM, already computed
  (`pop-seller.js:107-136`) and *explicitly labelled* as risk-neutral, **not** real-world, **not**
  no-touch (`:486-491`). Show it with that label.
- **Expiry payoff, breakevens (K ± credit), max profit = credit × lot** — algebra, via `payoff-engine`,
  which already flags unbounded structures honestly (`payoff-engine.js:86-88, :123`).
- **Charges** as the deterministic P&L drag (`charges.js` `roundTripCharges`) — so the tab can show *net*,
  unlike pop-seller.

This literally answers the owner: a position is *structurally* set to profit when **net theta outruns the
delta/gamma/vega moves against it before expiry** — a scenario grid built from the current Greeks shows
exactly the conditions under which that holds. It is a mechanical trade-off (high theta ⇒ tight gamma tail),
not a backtested edge — and that honesty is the point.

---

## 7. The null≠0 checklist the tab must honour

A missing value is `—`/UNKNOWN, never `0`, never a placeholder shown as real:
IV that resolved to 0.15/0.14/12 or `ivSource:'bsm'` → **ESTIMATED**; unresolved Greeks (the dropped
`unresolved:true` flag, `option-analyzer.js:199`) → `—`; `ivPercentile`/`ivRank` → **do not show**
(random); missing VIX → say so, never treat as calm (`vix-kelly-sizer.js:27`); lot `null` from the
registry → refuse the ₹ column, never substitute a literal; GEX → not shown at all.
