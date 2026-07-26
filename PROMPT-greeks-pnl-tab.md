# TASK PROMPT — New "Greeks → P&L" tab (`public/greeks.html`)

> Paste this whole file into the assistant working on Antigravity.
> Read `MASTER_PROMPT.md` and `THE-ONE-DOCUMENT.md` first; this task obeys both.
> Reply to the owner in **Gujarati script**. Code, paths and identifiers stay English.

---

## 0. What the owner asked, and the honest way to build it

The ask: *"a Greeks tab that shows, when the Greeks are at what values, profit happens — so I can
see when the position is set up to make more."*

There are two ways to build that, and only one is allowed here.

**Version A — data-mined "at delta X, gamma Y → profit" (FORBIDDEN in this task).** That is an
empirical claim about which Greek values *predict* profit. It requires labelled outcomes the
platform does not have:
- **M2**: 55 labelled outcomes platform-wide — forbids calibrated probability / Brier / ensembles.
- **P1**: 4 distinct intraday days — forbids correlation matrices and regime models.
- The `gammaBlast` Greek fields in `backtest-tv-results-*.json` are **void** (same-day look-ahead;
  see the bt-tv finding). Mining them would manufacture confidence from contaminated data.

Do **not** build a "Greek → win-rate" heatmap, a "profit zone by delta" scatter, or any backtested
Greek edge. If the page ever wants to say "these Greeks make more money," it must say
**INSUFFICIENT_DATA** — that is the correct answer, not a bug.

**Version B — the deterministic Greeks→P&L relationship (BUILD THIS).** The Greeks *are* the P&L
relationship, by definition — no data-mining needed:
- **Theta** = the ₹ a seller earns (a buyer loses) **per day** from time decay.
- **Delta** = ₹ P&L per 1-point move in the underlying.
- **Vega** = ₹ P&L per 1 vol-point (1%) change in IV.
- **Gamma** = how fast Delta (hence directional risk) accelerates as the underlying moves.

This answers the owner's question mechanically and honestly: for a **premium seller**, the setup
that is *structurally* set up to profit is **high positive Theta, low Gamma, contained Vega** — with
the explicit trade-off that low Gamma + high Theta also means the tail (a gap) hurts fast. State it
as a mechanical trade-off, never as a backtested prediction.

---

## 1. Scope

- **New single file:** `public/greeks.html` (inline `<style>` + `<script>`; you may add
  `/public/js/greeks-view.js` for the chart only). Reference `/js/instrument-meta.js` the same way
  the other pages do.
- **Add one nav link** "Greeks" to the top nav. The nav markup is duplicated across pages — add the
  link at least on `greeks.html`; list the other pages that need it in the changelog (do not edit
  unrelated pages beyond the nav link unless asked).
- **Dashboard Rule** binds this page: visualize and reconcile only; never invent a market number.
  `null ≠ 0`. Refuse rather than guess.
- Paper/research page — no order actions. Do not touch `server.js` or any engine. No commit/push.

---

## 2. Data contract — verified against `option-analyzer.js`

`GET /api/options/chain?instrument=${inst}` returns `{ spotPrice, atmStrike, strikes:[…] }`, each
strike carrying `ce` and `pe` with **already-computed Greeks**:

```
ce/pe: { ltp, bid, ask, oi, changeOI, volume, iv, delta, gamma, theta, vega, pop, token }
```

Verify on the wire before rendering. Known hazards in that payload — the page must respect all:

- **`bid` and `ask` are synthetic** (`ltp*0.98` / `ltp*1.02`) and **`changeOI` is always 0**
  (`option-analyzer.js:704-707,722`). Do **not** present them as real quotes or real OI change.
  Either omit them or label them "derived".
- **Greeks may come from a 0.15-vol fallback.** `_rawGreeks` uses **LTP-derived IV**, but falls back
  to **IV = 0.15** whenever `ltp ≤ 0.5` (`option-analyzer.js:687-688`); and the separate
  `calculateGreeks` fallback (`server.js:2269`, TD-1) **hardcodes `volatility = 0.15`** and returns
  `{delta:0,gamma:0,theta:0,vega:0,unresolved:true}` for an unknown/disabled instrument. So:
  - Show each strike's **`iv`** next to its Greeks, and flag Greeks as **ESTIMATED** when `iv`
    resolves to exactly `0.15`/`15.00` or `unresolved` is set. A Greek built on an assumed vol is not
    a measured Greek.
  - Render `unresolved` / zero-Greek strikes as **"—" / "unknown"**, never as a real `0`. `null ≠ 0`.
- **`theta` unit is ambiguous in the codebase** (one path divides by 365, another does not). Before
  labelling anything "per day," verify the sign and unit against a known strike; if you cannot
  confirm, label it "theta (unit unverified)" rather than guess.
- **No GEX / dealer-gamma.** F4: `oi_unit` is unverified, so aggregate gamma exposure "would be wrong
  by 25–75×." This tab shows **per-position** Greeks only. Do not sum Greeks across the chain into a
  market-wide GEX number.

**Position sizing:** per-contract Greeks are per 1 unit underlying. To show ₹ impact for a position,
multiply by **`window.instLot(inst())` × lots** — and if `instLot` returns `null`, show the ₹ column
as **"—"** and say lot is unknown. Never substitute a literal lot.

---

## 3. The tab — what to build

### 3.1 Position Greeks board (top)

Let the user pick an instrument and assemble a position two ways: (a) click strikes from the chain,
or (b) load the current open book (`GET /api/pop/status` if available). For that position show, big
and clear:

- **Net Delta, Net Gamma, Net Theta, Net Vega** — aggregated across legs, each with its **₹ meaning**
  beside the raw number: "Net Theta +₹X **/day**", "Net Delta = ₹Y **per 1-pt move**", "Net Vega =
  ₹Z **per +1% IV**". Sign matters — positive Theta green (seller earns decay), negative red.
- A one-line **mechanical verdict**, not a prediction: e.g. *"Positive Theta ₹X/day, low Gamma —
  structurally a premium-seller setup; the risk is a fast move (Gamma turns Delta against you)."*
  When Greeks are estimated/unknown, the verdict says so and stops.

### 3.2 "When does this make money?" panel — deterministic, not empirical

The core of the owner's ask, done as **cause-and-effect from the current Greeks**, live:

- A small **scenario grid**: rows = underlying moves (−2%, −1%, 0, +1%, +2%), columns = IV changes
  (−2, 0, +2 vol-pts) and days-passed (0, 1, DTE). Each cell = **projected P&L in ₹**, derived from
  the position's Delta/Gamma/Theta/Vega (a first/second-order Taylor estimate is fine — **label it an
  estimate**, and state that it ignores higher-order and path effects).
- Shade profit green / loss red. This literally shows the owner *the Greek conditions under which the
  position profits* — because it profits when time passes faster than the underlying/IV move against
  it. That is the honest version of "when Greeks are right, profit happens."
- A plain-language reading of the grid: *"This position profits if NIFTY stays within ±X and IV does
  not rise more than Y before expiry."*

### 3.3 Per-strike Greeks table (chain view)

Sensibull-style clean table of the chain: strike, CE/PE **IV, Delta, Gamma, Theta, Vega, PoP**, with
ATM anchored and auto-scrolled. Highlight the **seller's sweet-spot** strikes — high Theta relative
to Gamma — but label it *"high theta-to-gamma (decay-rich, tail-exposed)"*, not "high profit." Every
estimated/unresolved Greek is flagged per §2.

### 3.4 Greeks explainer (so the tab teaches)

A collapsible reference: what each Greek does to P&L for a **buyer vs a seller**, why a seller wants
high Theta / low Gamma, and why that same profile is the one that loses fast in a gap. Short, honest,
no edge claims.

---

## 4. Design quality (top-class, accessible)

- Clean, spacious, professional. Default light theme with a dark toggle; respect
  `prefers-color-scheme`. Body contrast ≥ 4.5:1, secondary ≥ 3:1.
- Tabular-nums for every Greek and ₹ figure; a defined type scale; the decision numbers (Net Theta,
  Net Vega) are the largest things on the board.
- Colour-blind-safe green/red paired with sign/label. Loading, error, empty, and **estimated/unknown**
  states are all explicit and styled — never a bare `0` or blank.
- Responsive to mobile; full keyboard path; `aria-label`s; `prefers-reduced-motion`; Lighthouse
  Accessibility ≥ 90.

## 5. Acceptance

- Before/after (here: new-page) screenshots at 1440px and 390px, light + dark.
- Changelog: endpoints/IDs used, which pages still need the nav link, contrast ratios, CDN lib+version.
- **Honesty gates, demonstrated:**
  1. A strike whose Greeks came from IV = 0.15 (or `unresolved`) is flagged **ESTIMATED / unknown**,
     never shown as a plain measured value or a `0`.
  2. With `instLot()` = `null`, all ₹ columns read **"—"** and the page states lot is unknown.
  3. The scenario grid is labelled an **estimate**; there is **no** backtested "Greek → profit"
     claim, heatmap, or win-rate anywhere.
  4. No chain-wide GEX / aggregate-gamma number exists on the page.

## 6. What NOT to do

- Do **not** build Version A (data-mined Greek→profit). No "profit by delta" heatmap, no win-rate by
  Greek, no use of the void `gammaBlast` backtest fields.
- Do **not** present synthetic `bid`/`ask` or `changeOI:0` as real, or an assumed-vol Greek as
  measured.
- Do **not** render an unknown Greek or ₹ figure as `0`. `null ≠ 0`.
- Do **not** sum Greeks into a market GEX (F4). Per-position only.
- Do **not** hardcode a lot; use `window.instLot()`, refuse on `null`.
- Do **not** add order/execute actions, touch engines/`server.js`, or commit/push.
