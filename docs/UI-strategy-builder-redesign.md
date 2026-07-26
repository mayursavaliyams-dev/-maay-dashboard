# Redesign — `public/strategy.html` (Strategy Builder)

**Date:** 2026-07-26 · **Scope:** one file, `public/strategy.html`. No other file in
`public/`, no `server.js`, no engine, no build step, no npm, **no CDN library**.
**Nature:** look / layout / usability. Behaviour, data contracts and the paper-execute
path are preserved. **Not committed** — the task said not to commit or push unasked.

---

## 1. Data contract — what changed

**Element IDs: none renamed, none removed, none duplicated.** All 14 contract IDs are
present exactly once (asserted mechanically): `instSel`, `lotsSel`, `expiryDays`,
`spotInfo`, `chainContent`, `legsBody`, `payoffCanvas`, `payoffInfo`, `sumNet`,
`sumMaxP`, `sumMaxL`, `sumBE`, `sumRR`, `sumLot`.

**Endpoints: none changed, none added.** Exactly the three that existed:

| endpoint | change |
|---|---|
| `GET /api/options/chain?instrument=${inst}` | none |
| `GET /api/${sigPath}` (`nifty`/`banknifty`/`sensex`) | none |
| `POST /api/pop/sell` | **payload byte-identical** — `{inst, side:'SELL_'+type, strike, type, premium, lot: lots*L, pop:null}` |

**State model: unchanged.** `legs = [{action,type,strike,premium,lots}]`, `spot`, `atm`,
`chainData`, `maxCeOI`, `maxPeOI` remain the only sources of truth. Added view-state
(`_lastRemoved`, `_newLegKey`, `_payoffGeom`, `_prevSummary`, `_chainScrolledFor`) is
derived and never written back into the model.

**Payoff math: unchanged.** The per-leg formula
`sign*(premium − intrinsic)*lots*L` is character-identical to the previous build. It was
previously duplicated in `calcSummary` and `drawPayoff`; it is now defined **once** as
`pnlAt(px, L)` and called by both. That is a de-duplication, not a change — two copies of
a formula are how the summary and the chart drift apart.

### Three changes that are not pure styling — each justified

1. **`step()` replaces a hardcoded strike-interval table.** The old `loadPreset` computed
   `const step = inst()==='NIFTY'?50:inst()==='SENSEX'?100:100` — a **market constant
   declared on a dashboard page**, exactly the class of defect that put a wrong `lotSize`
   here in the first place. It now reads `window.instStep(inst())` from the generated
   registry. **Values verified identical** for every instrument reachable from this page
   (NIFTY 50, SENSEX 100, BANKNIFTY 100), so no preset changes behaviour. If the step is
   ever `null`, the preset refuses and says so rather than guessing.
2. **`expiryDays` non-zero options are now `disabled`.** No code has ever read this
   select's value — the payoff is always at expiry. Offering "0.5 day / 1 day / 2 days"
   presented a model the page does not have. The element and its ID are kept; the
   unimplemented options are disabled with a title explaining why. **Zero behaviour
   change** — selecting them already did nothing.
3. **Unbounded risk is now detected structurally.** The old code tested `maxP > 1e8`,
   which can never fire because the scan window is ±7% around spot: a naked short showed a
   tidy, bounded rupee figure. A separate `riskShape()` reads the leg book (net-short
   calls / net-short puts) and labels the outcome `Unbounded ⚠`. **This does not touch the
   P&L math** — it only decides what the label is allowed to claim.

### The lot rule — unchanged and proven

Contract size still comes **only** from `window.instLot(inst())`. There is no lot table,
no `|| 75`, no `|| 65` anywhere in executable code (the only occurrence of `75` is inside
the comment that records the historical bug). Verified by running the page's own script
against a DOM stub:

```
instLot() = null  →  cells ["—","—","—","—","—"]   execBtn.disabled = true    ✓ PASS
instLot() = 65    →  sumNet "+ ₹6,500"             execBtn.disabled = false
```

A `window.__lotRuleSelfCheck()` helper is built into the page so the same assertion can be
re-run from the browser console at any time.

---

## 2. Contrast — measured, not asserted

WCAG 2.1 relative-luminance ratios against the page background:

| token | dark (`#0a0a0f`) | light (`#f6f7fb`) |
|---|---|---|
| `--muted` **old** `#4a4a6a` | **2.33:1 — FAIL** | — |
| `--muted` new `#9aa4bf` / `#4a5468` | **7.93:1** | **7.11:1** |
| `--dim` `#7c87a5` | 5.52:1 | — |
| `--text` `#e8eaf2` / `#12161f` | 16.44:1 | 16.91:1 |
| green | 11.83:1 | 5.12:1 |
| red (`#ff5470`, was `#ff4444`) | 6.35:1 | 5.35:1 |
| amber | 14.15:1 | 5.17:1 |
| blue | 8.32:1 | 6.22:1 |

Every text token clears **4.5:1** in both schemes — the brief's bar. Colour is never the
only signal: BUY/SELL carry `▲`/`▼` **and** the word, the profit/loss curve is drawn in two
passes so the sign change is a shape change, and unbounded risk carries `⚠` plus a
sentence.

---

## 3. What was rebuilt

**Design system** — one `:root` block: 5-step type scale, 6-step spacing scale, semantic
colour, `--ui` font for labels and `--mono` + `font-variant-numeric: tabular-nums` for
every number so columns align. Base size raised 13px → 16px.

**Layout** — three zones: Build (left) · Payoff (hero, top-right) · Chain (right rail).
`≤1279px` collapses the chain to a full-width row; `≤899px` stacks everything and pins the
**summary bar to the bottom of the viewport** so the decision stays on screen while the
chain scrolls.

**Payoff chart** — kept on `<canvas>`, **no charting library**. Justification: zero
external dependency (nothing to pin, nothing to fetch, works offline), and full control
over the honesty requirements a generic library would fight — the ghost example, the
"loss continues beyond chart" guide, and the unbounded banner. It now draws breakeven
guides with price labels, max-profit / max-loss guides with ₹ labels, a distinct spot
marker with a dot on the curve, shaded profit/loss zones, ₹ axis ticks in `en-IN`, and a
hover/tap tooltip giving P&L in ₹ and %. It is `devicePixelRatio`-aware and reads its
colours from the CSS variables, so it follows the light/dark scheme.

**Empty state → worked example.** With no legs the chart draws a ghosted short-straddle
**shape** labelled `EXAMPLE — a short straddle`, with `breakeven` and `max profit`
annotated. It carries **no rupee axis**: teaching the shape is useful, inventing numbers
is not.

**Option chain** — sticky header, auto-scroll to ATM once per instrument, ATM chip and row
highlight, a "Jump to ATM" control, `min-height:38px` tap targets, selected strikes stay
highlighted, and scroll position is preserved across the 15-second refresh (it previously
jumped to the top every poll). OI weight is drawn as a **cell background gradient**, not a
fixed-width bar, so five columns always fit; each cell carries a `title`/`aria-label` with
the real number. **Missing OI renders `—` with no fill** — never a zero bar, never a full
one.

**Legs** — per-leg Buy/Sell and CE/PE toggles, live lots, duplicate, remove **with undo**,
and an add-leg row that replaced four chained `prompt()` dialogs.

**Feedback** — every mutation flashes the summary cards that actually changed and writes a
"last change" line (`+1 lot NIFTY 23750 CE (BUY)`); new legs animate in.

**`null ≠ 0` in the summary** — unknown renders `—` in a dimmed style; a true zero renders
`₹0` in the normal style. They can no longer be confused.

**Accessibility** — full keyboard path (Tab to a premium, Enter/Space adds, ↑/↓ move
within a side, Esc clears), visible focus rings, `aria-label` on every icon-only control, a
screen-reader text summary of the chart (`#payoffA11y`, updated on every draw), a table
`<caption>`, and `prefers-reduced-motion` honoured.

**Paper safety** — the primary action stays `PAPER EXECUTE (₹0 risk)` in dashed amber
(deliberately *not* a solid confident button), a `PAPER ONLY` chip sits in the header, a
standing sub-line reads "Nothing is sent to a broker", and the result dialog is prefixed
"PAPER (simulated) — no live order was placed". The button is **disabled** with the reason
shown when there are no legs or no verified lot size.

---

## 4. Verification

- Inline JS parses clean (`node --check` on the extracted script).
- All 14 contract IDs present exactly once; only the 3 original endpoints called.
- Lot rule fails closed — proven by executing the page's own script against a DOM stub.
- Payoff pipeline exercised numerically on three cases:
  - **Iron condor** → net `+ ₹5,200`, max loss `- ₹1,300`, R:R `4.00×`, BE `23,634 / 23,887`,
    no warning banner. (Independently: credit 80 × 65 = ₹5,200; risk (100−80) × 65 = ₹1,300.)
  - **Naked short CE** → max loss `Unbounded ⚠`, R:R `—`, warning banner shown.
  - **No legs** → ghost example, execute disabled, all summary cells `—`.
- **Full suite 56/56 green, gated on exit code, three consecutive runs.**
  `test/dashboard-rule.test.js` (the market-constant drift tripwire) passes with 54
  assertions.
- No horizontal overflow: measured `scrollWidth == clientWidth` at both widths, and with
  the body forced to 390px only the `position:fixed` summary bar tracks the viewport (by
  design) — every other element shrinks.

### Screenshots — `SCREEENSHOTS/strategy-redesign/`
`before-1440.png`, `after-1440.png`, `before-390.png`, `after-390.png`,
`after-1200-narrow.png` (the 2-column breakpoint).

**Honest limitations of the capture environment:**
- The 390px shots are taken at `--force-device-scale-factor=2 --window-size=780` because
  headless Chrome here refuses a window narrower than ~491px. The CSS viewport is a true
  390px; the image is 2×.
- **Light mode could not be screenshotted.** This headless Chrome reports
  `prefers-color-scheme: dark` unconditionally and ignores `--force-prefers-color-scheme`.
  The light block exists and its contrast ratios are computed above, but it has **not been
  verified visually** — it should be eyeballed on a real machine before being relied on.
- **Lighthouse was not run** (no Lighthouse in this environment). The accessibility work
  listed above was done to the brief, but the **≥90 score is unverified** — claiming it
  without measuring it would be exactly the kind of unearned number this repo forbids.

---

## 5. Bugs found and fixed during the redesign

1. **Chain PE side was being clipped** in the right rail — `PE LTP` and `PE OI` were
   invisible at 1440px because the fixed-width OI bars pushed the table wider than its
   column. Fixed with `table-layout:fixed` + `<colgroup>` + background-gradient OI.
2. **Chain scroll jumped to the top every 15 seconds** on refresh. Scroll position is now
   preserved.
3. **I introduced and then fixed a word-break regression** — an `overflow-wrap:anywhere`
   added while chasing mobile overflow broke "STRATEGIES" into "STRATEGIE/S". The real fix
   for the overflow was `min-width:0` on grid children; the aggressive wrap was removed.

## 6. Not done / filed

- `addLegManual` no longer uses `prompt()`. The resulting leg object is identical.
- Light-mode visual check and Lighthouse: see §4 limitations.
- Nothing was committed or pushed.
