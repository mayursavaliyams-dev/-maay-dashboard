# TASK PROMPT — "Greeks → P&L" tab (`public/greeks.html`), research-grounded v2

> Paste this whole file into the assistant working on Antigravity.
> Read `MASTER_PROMPT.md` and `THE-ONE-DOCUMENT.md` first; this task obeys both.
> A companion evidence file, `REPORT-greeks-analytics.md`, backs every constraint here with
> file:line citations — read it if you doubt any rule below.
> Reply to the owner in **Gujarati script**. Code, paths and identifiers stay English.

---

## 0. The ask, and the only honest way to build it

Owner's ask: *"a tab that shows, when the Greeks are at what values, profit happens — so I can see when
the position is set up to make more."*

A four-agent sweep of this codebase (see `REPORT-greeks-analytics.md`) settled how to build it:

- **Version A — data-mined "at delta X → profit" — is FORBIDDEN.** The platform holds **41–50 labelled
  outcomes total** (strangle engine: **7**), and **no engine stores entry Greeks beside realized P&L**.
  M2/P1 forbid calibrated probability and correlation on this sample. The `gammaBlast` fields in the
  `backtest-tv-results-*.json` are void (look-ahead). Any "profit-by-delta" heatmap or win-rate-by-Greek
  is a false measurement. If the page is ever tempted to make such a claim, it renders **INSUFFICIENT_DATA**.
- **Version B — the deterministic Greek→P&L identity — is what you BUILD.** The Greeks *are* the P&L
  relationship: Theta = ₹/day the seller harvests, Delta = ₹ per point, Vega = ₹ per vol-point, Gamma =
  how fast Delta turns against you. A position is structurally set to profit when **net Theta outruns the
  Delta/Gamma/Vega moves against it before expiry.** Show that as cause-and-effect from the *current*
  Greeks — a mechanical trade-off, never a backtested edge.

---

## 1. Scope

- **New single file** `public/greeks.html` (inline `<style>`+`<script>`; optional `/public/js/greeks-view.js`
  for the chart only). Reference `/js/instrument-meta.js` as the other pages do.
- **Add one nav link "Greeks"** to the top nav; list in the changelog which other pages carry the
  duplicated nav and would need it (do not mass-edit them).
- **Dashboard Rule** binds this page: visualize/reconcile only, never invent a market number. `null ≠ 0`.
- Research page — **no order/execute/sell actions.** Do not touch `server.js` or any engine. No commit/push.

---

## 2. Endpoints — use these, verified in `server.js`

| method · path | line | use it for |
|---|---|---|
| `GET /api/options/chain?instrument=${inst}` | 2415 | per-strike `ltp, oi, iv, ivSource, delta, gamma, theta, vega`, spot, atm |
| `GET /api/options/greeks-matrix?inst=${inst}` | 2467 | ATM-centred Greek rows + `summary` |
| `GET /api/strategy/payoff/prefill?inst=${inst}` | 5597 | `{spot, atm, step, lotSize, dteDays, strikes[]}` — **lotSize already registry-resolved** |
| `POST /api/strategy/payoff` | 5624 | **`payoff-engine.buildPayoff`** — returns `unbounded{upside,downside}`, `maxProfitLabel`, `maxLossLabel`, `riskReward` (null when unbounded), `probabilityOfProfit`, `greeks`, `curve`, `breakevens` |
| `GET /api/pop/status` | 4291 | load the current open paper book as a position |
| `GET /api/vix?inst=${inst}` | 5323 | India VIX; real (~12) when reachable, `null` on outage |

**Do NOT use** `/api/nifty/options/analytics` or `/api/banknifty/options/analytics` for Greeks — they
return **hardcoded deltas** (0.85/0.5/0.15) and `iv||12` (`server.js:2628-2633`).

**For the payoff and net-Greeks, prefer `POST /api/strategy/payoff`** over browser math: it already
handles unbounded loss honestly and resolves lot from the registry. Reinvent nothing it already does.

**TD-2 caution:** the server's `OptionAnalyzer` is a shared singleton mutated per request
(`server.js:199,2283`). Do not fan out many analytics calls for *different* instruments in parallel and
assume isolation — sequence per-instrument fetches.

---

## 3. Hard data-honesty rules (each maps to a cited finding)

1. **IV may be a placeholder.** Fallbacks hardcode IV to 0.15 / 0.14 / 12 and are indistinguishable from a
   real reading. Every strike carries **`ivSource`** (`'feed'` = real, `'bsm'` = we solved/assumed). Show
   `ivSource`; flag any `bsm` IV, or an IV that resolves to exactly 15.00/14.00/12.00, as **ESTIMATED**.
   A Greek built on an assumed vol is not a measured Greek.
2. **Never mix vega scales.** `option-analyzer` vega is per 1.0 vol; `payoff-engine` vega is per 1
   vol-point (÷100) — a **100× difference**. Pick **one** source for any given view and state the unit
   ("Vega = ₹ per +1% IV"). Never sum or compare vegas from the two.
3. **Theta is per-day** in every engine — you may label it "/day". Verify the sign on a known long option
   before shipping the label.
4. **`unresolved`/zero Greeks ≠ real 0.** The chain drops the `unresolved:true` flag after formatting, so a
   `0.0000` may mean "no data." Treat exact-zero Greeks on an illiquid strike (ltp ≤ 0.5) as **unknown →
   "—"**, not a real zero.
5. **Never show `ivPercentile` / `ivRank`** — they are `Math.random()` (`option-analyzer.js:624-625`).
6. **No GEX, no gamma wall, no gamma flip, no dealer-gamma.** The live-feed OI unit is unverified (could be
   65× wrong), the IV feeding it is fabricated, and the dealer sign is unverified. This tab is
   **per-position Greeks only.** OI walls (max-OI strikes) may appear only as a labelled context line, never
   as a computed risk number.
7. **Lot from `window.instLot(inst())` or the prefill `lotSize` only.** If `null` → ₹ columns read **"—"**
   and the page says lot is unknown. Never substitute 75/65/any literal.
8. **VIX:** show the real value when `/api/vix` returns one; on `null` show "VIX unavailable" and do **not**
   treat missing VIX as calm.

---

## 4. What to build

### 4.1 Position Greeks board (top)
Pick instrument; assemble a position by (a) clicking strikes from the chain or (b) loading the open book
(`/api/pop/status`). Show **Net Delta / Gamma / Theta / Vega**, each with its ₹ meaning beside the raw
number — "Net Theta **+₹X/day**", "Net Delta = ₹Y **per 1-pt**", "Net Vega = ₹Z **per +1% IV**" — using
`POST /api/strategy/payoff`'s `greeks` so the scale is single-sourced and lot-correct. Positive theta green
(seller earns), negative red. One **mechanical verdict** line, e.g. *"Positive Theta ₹X/day with low Gamma
— structurally a premium-seller setup; the risk is a fast move (Gamma turns Delta against you)."* When any
input is estimated/unknown, the verdict says so and stops.

### 4.2 "When does this make money?" panel — deterministic, the core of the ask
A **scenario grid**: rows = underlying moves (−2%, −1%, 0, +1%, +2%), columns = IV change (−2, 0, +2
vol-pts) × time (today, +1 day, at expiry). Each cell = projected **₹ P&L**. Get it from `POST
/api/strategy/payoff` by re-pricing the legs at each shifted spot/IV/DTE where the endpoint supports it;
otherwise a first/second-order Taylor estimate from the net Greeks is acceptable **but must be labelled an
estimate** that ignores higher-order and path effects. Shade profit green / loss red. Add a plain reading:
*"This position profits if {inst} stays within ±X and IV does not rise more than Y before expiry."* This is
literally "when the Greeks are right, profit happens" — done as math, not mined from history.

### 4.3 Per-strike Greeks table (chain)
Clean, Sensibull-calm table from `/api/options/chain`: strike, CE/PE **IV (+ivSource badge), Delta, Gamma,
Theta, Vega, PoP**, ATM anchored and auto-scrolled. Optionally highlight **high theta-to-gamma** strikes,
labelled *"decay-rich, tail-exposed"* — never "high profit." Every estimated/unresolved cell flagged per §3.

### 4.4 Payoff + explainer
Render `POST /api/strategy/payoff`'s curve with breakevens, max-profit/loss guides, spot marker, and —
critically — draw **unbounded tails as unbounded** (use its `unbounded` flags and `maxLossLabel`; never a
capped triangle). A collapsible explainer: what each Greek does to P&L for buyer vs seller, why a seller
wants high Theta / low Gamma, and why that same profile loses fast in a gap. No edge claims.

---

## 5. Design quality (top-class, accessible)
Clean, spacious, professional; light default with dark toggle honouring `prefers-color-scheme`. Body
contrast ≥ 4.5:1, secondary ≥ 3:1. Tabular-nums on every Greek/₹. Colour-blind-safe green/red paired with
sign/label. Loading, error, empty, and **estimated/unknown** states all explicit and styled — never a bare
`0`. Responsive to 390px; full keyboard path; `aria-label`s; `prefers-reduced-motion`; Lighthouse
Accessibility ≥ 90.

## 6. Acceptance gates — demonstrate each
1. A strike with `ivSource:'bsm'` (or IV = 15.00/14.00/12.00) is flagged **ESTIMATED**, not shown as
   measured.
2. An illiquid strike (ltp ≤ 0.5) with zero Greeks renders **"—"**, not `0`.
3. `window.instLot()` = `null` → every ₹ column reads **"—"** and the page states lot is unknown.
4. The scenario grid is labelled an **estimate**; there is **no** Greek→profit heatmap, win-rate-by-Greek,
   or use of the void backtest fields anywhere.
5. **No GEX / gamma-wall / dealer-gamma number** exists on the page.
6. `ivPercentile`/`ivRank` appear nowhere. Vega carries a stated unit and is single-sourced.
7. A naked-short position shows **UNBOUNDED** loss and off-plot tails, not a bounded shape.
8. Before/after (new-page) screenshots at 1440px and 390px, light + dark; changelog lists endpoints/IDs
   used, contrast ratios, and CDN lib + version.

## 7. What NOT to do
- No Version A (data-mined Greek→profit) in any form.
- No presenting an assumed-vol Greek, a `Math.random` percentile, a synthetic bid/ask, or a `||0` OI as
  real.
- No GEX/aggregate-gamma. Per-position only.
- No mixing the two vega scales; no rendering an unknown as `0`; no hardcoded lot.
- No order actions, no engine/`server.js` edits, no commit/push.
