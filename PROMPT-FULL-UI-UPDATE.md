# TASK PROMPT — FULL UI UPDATE for Antigravity Pro (whole dashboard suite)

> Paste this whole file into the assistant working on Antigravity.
> Read `MASTER_PROMPT.md` and `THE-ONE-DOCUMENT.md` first; this task obeys both.
> Reply to the owner in **Gujarati script**. Code, paths and identifiers stay English.
> Per-page deep prompts already exist for four pages (`PROMPT-strategy-ui-redesign.md`,
> `PROMPT-pop-seller-ui-sensibull.md`, `PROMPT-greeks-tab-v2.md`, `PROMPT-ami-heatmap-ui.md`) — this master
> prompt ties them together and adds `oi.html` + `signal-heatmap.html`. Follow the per-page prompts for depth.

---

## 0. Goal & scope

Bring the **entire** front-end to one clean, user-friendly, Sensibull-calm, accessible standard — with a
**single shared design system** and **one honesty standard** across every page. Pages in scope (all in
`public/`):

`dashboard.html` · `strategy.html` · `pop.html` · `greeks.html` (new) · `ami-heatmap.html` · `oi.html` ·
`signal-heatmap.html` · `command.html`/`command-pro.html` · `trade.html` · `strike-history.html` ·
`heatmap.html` · `pattern-signals.html` · `health-dashboard.html`.

**Constraints that hold for every page:**
- Each page stays **single-file** (inline `<style>`+`<script>`) *except* it may pull the one shared
  stylesheet from Part A. You may add `/public/js/<page>-view.js` for heavy render code only.
- Every page is a **dashboard** → Dashboard Rule: visualize/reconcile, never invent a market number.
  `null ≠ 0`. Paper-only; **no page gains an order/execute action it didn't have.**
- **Preserve every element ID and every `/api/*` endpoint** each page already uses, or list each change
  with a reason. Do not change any server payload.
- Do not touch `server.js` or any engine. No commit/push. Work **one page per commit**.

---

## PART A — Build the shared design system ONCE (then apply everywhere)

This is the highest-leverage step. `THE-ONE-DOCUMENT` already flags it: *"21 pages had zero shared CSS and
10 different background colours"* and UI-02 (*"18 of 21 pages still carry drifted private CSS token
blocks"*). Fix that at the root.

1. Create `public/css/app.css` — one token layer + component classes, imported by every page:
   - **Tokens:** background, panel, border, text, muted, and semantic accents (buy/call = green,
     sell/put = red, **warning/unknown = amber**, info = blue). Provide a `prefers-color-scheme: light`
     block; ship a **light default with a dark toggle**. Contrast: body ≥ **4.5:1**, secondary ≥ **3:1** —
     no grey-on-grey anywhere.
   - **Type scale** (xs/sm/base/lg/xl) and a **spacing scale** (4/8/12/16/24). Numbers use
     `font-variant-numeric: tabular-nums`; labels/buttons use a real UI font (not monospace).
   - **Shared components:** top nav (one markup, active state), instrument strip (spot/ATM/PCR/VWAP/signal
     pill), option-ladder cell, signal pill (WAIT/BUY-CALL/BUY-PUT), stat tile, OI bar, and the four
     **state styles every page needs: loading · error · empty · UNKNOWN/estimated/stale.**
2. Replace each page's private token block and its own nav CSS with `app.css`. This alone removes the "10
   background colours" drift and makes the suite feel like one product.

---

## PART B — The honesty standard (apply to EVERY page)

These are not cosmetic. They come from findings verified in the codebase; a redesign that hides them makes
risky data look safe.

1. **`null ≠ 0`.** A missing premium, delta, OI, IV, or P&L renders **`—`**, never `0`, `₹0.0`, or `Δ0.00`.
   Multiple pages currently do `Number(x)||0` / `ce.delta||0` (`ami-heatmap.html:571`,
   `signal-heatmap.html:1097`, `oi.html:220`) — a real zero and "no data" must look different.
2. **PoP is not a safety %.** Every page computes `pop = (1−|delta|)×100` (`ami-heatmap.html:469`,
   `signal-heatmap.html:541`). Label the column *"PoP (risk-neutral, 1−|Δ|)"*, **cap the display at "≥99%"
   (never a bare "100%")**, and tooltip it: *"probability of finishing OTM — not probability of profit, not
   a safety guarantee."*
3. **Estimated IV / Greeks.** `/api/options/*` may return Greeks/IV from an assumed-vol fallback; the chain
   carries **`ivSource`** (`'feed'` vs `'bsm'`). Flag `bsm`/placeholder IV (15.00/14.00/12.00) as
   **ESTIMATED**. Never show `ivPercentile`/`ivRank` (they are `Math.random()`). (See `REPORT-greeks-analytics.md`.)
4. **No GEX / exposure from OI.** OI per strike may be displayed as a magnitude, but the live-feed OI unit is
   unverified (could be 65× wrong, F4). **No page may aggregate OI into a GEX / dealer-gamma / net-exposure
   number.**
5. **Synthetic quotes.** `bid`/`ask` are faked (`ltp*0.98/1.02`) and `changeOI` can be 0-as-unknown — label
   "derived" or omit; never present as real.
6. **Lot from the registry only** — `window.instLot(inst)`; on `null`, ₹ figures read `—`, never a literal.
7. **Partial-confluence disclosure (critical for `signal-heatmap.html`).** The analysis board scores ~11
   factors, but several read *"no candle feed"*, *"no cash feed"*, *"import via /api/fii-dii"*, *"NEUTRAL"* —
   and the verdict shows *"BUY 60% · conv LOW · 5/11 live."* A confident verdict computed from partial
   inputs is the exact hazard. **Each dead factor must render UNKNOWN (amber), not a score; the aggregate
   must state "N of 11 live" prominently and must not read as a confident BUY when most factors are dark.**
8. **Stale feeds look stale.** AmiBroker/algo pushes drive several pages; if no push in N minutes, show the
   feed **amber/stale** (the code already tracks `amiLastMs`/`stale` — surface it). Never fabricate a signal
   to fill a gap. Note `signal-heatmap.html:538` hits `http://127.0.0.1:8091` for the algo target — handle
   its absence as "algo feed offline," not as zeros.
9. **Paper everywhere.** Keep every PAPER badge and warning bar; no action may look like a live order.

---

## PART C — Per-page checklist (what each page specifically needs)

| page | keep (endpoints/IDs) | must-fix beyond the shared work |
|---|---|---|
| **dashboard.html** | its panels + `/api/*` | contrast, hierarchy, ATM anchor; it's the home page — make it the calm overview |
| **strategy.html** | `/api/options/chain`, `/api/pop/sell`; IDs `legsBody`,`payoffCanvas`,`sum*` | lot via `instLot` (no `\|\|75`); payoff hero; unbounded tails honest. *(see its own prompt)* |
| **pop.html** | `/api/pop/*` | **relabel the 2-leg "Iron Condor" as SHORT STRANGLE — UNDEFINED RISK; Max Loss = UNBOUNDED; draw unbounded tails; label gross P&L.** *(see its own prompt)* |
| **greeks.html** (new) | `/api/options/chain`,`/greeks-matrix`,`/api/strategy/payoff` | deterministic Greek→P&L only; no data-mined Greek→profit; ESTIMATED IV flags. *(see its own prompt)* |
| **ami-heatmap.html** | `/api/options/snapshot`,`/api/amibroker/*`,`/api/hl-alerts`; IDs `hm-{INST}`,`sig-{INST}`,`afList`,`hlList` | PoP "≥99%" not 100%; `—` for missing ltp/delta; stale-push indicator; kill page-level `overflow:hidden`; ATM anchor. *(see its own prompt)* |
| **oi.html** | `/api/oi-change`,`/api/oi-signals`; IDs `pcrGauge`,`buyList`,`sellList`,`hpVal` | surface the existing `fallback` flag (`oi.html:191`) as a visible "estimated data" banner; `—` for missing ΔOI; PCR gauge readable; do not turn OI into GEX |
| **signal-heatmap.html** | `/api/options/chain`,`/api/master-signal/`,`/api/amibroker/*`,`/api/breakouts`,`/api/ema-stack`,`/api/options/pcr`,`/api/options/maxpain`; IDs `hmWrap`,`indPanel`,`heroCard`,`btStrip`,`signalTape` | **the confluence board is the big one — every dead factor = UNKNOWN, show "N/11 live", verdict must not read confident on partial data**; PoP label; `—` for missing; algo-feed-offline state for `127.0.0.1:8091`; stale-push dot |
| **command / trade / strike-history / heatmap / pattern-signals / health** | their own `/api/*` | apply Part A + Part B; deprecate any `Math.random()` demo data or label it `PAPER·DEMO` unmistakably |

---

## PART D — Rollout, acceptance, guardrails

**Rollout order** (safest first, most-seen first): Part A shared CSS → `dashboard.html` → `pop.html`
(honesty-critical) → `signal-heatmap.html` (honesty-critical) → `ami-heatmap.html` → `oi.html` →
`strategy.html` → `greeks.html` → the rest. **One page per commit.**

**Acceptance — demonstrate on the honesty-critical pages:**
1. `app.css` exists and every migrated page imports it; no page keeps a private token/nav block.
2. A far-OTM strike shows **"≥99%"**, not "100%", under the risk-neutral PoP label (ami-heatmap + signal-heatmap).
3. A missing ltp/delta/IV renders **`—`**, never `0`/`₹0.0`/`Δ0.00`.
4. `signal-heatmap.html` shows **"N of 11 factors live"** and renders each no-feed factor as UNKNOWN; the
   verdict is visibly qualified when most factors are dark.
5. `pop.html` shows **UNBOUNDED** loss for the 2-leg structure and does not call it an Iron Condor.
6. `oi.html` shows the **estimated/fallback** banner when the chain is a fallback.
7. Stale AmiBroker/algo feeds show **amber/stale**; no fabricated signal.
8. Before/after screenshots per page at 1440px and 390px, light + dark; Lighthouse Accessibility ≥ 90 on
   each migrated page. Changelog per commit: IDs/endpoints touched (should be none), contrast ratios, CDN
   lib+version.

**What NOT to do:** no bare "100%" PoP; no unknown rendered as `0`; no GEX/exposure from OI; no synthetic
bid/ask or `Math.random` metric shown as real; no confident verdict on partial confluence; no hardcoded lot;
no framework build for static pages; no order actions; no `server.js`/engine edits; no commit/push unasked.
