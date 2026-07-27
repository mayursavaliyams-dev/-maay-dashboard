# Redesign — `public/pop.html` (PoP Seller)

**Date:** 2026-07-26/27 · **Scope:** one file, `public/pop.html` + adoption of the shared
`/css/tokens.css`. No `server.js`, no engine, no other page. No build step, no npm,
**no CDN library**.
Task: `PROMPT-pop-seller-ui-sensibull.md` · Design system: UI-02 Part A (`b361759`).

> **Commit note:** the redesign reached `main` as `515f9ae` ("Implement code changes to
> enhance functionality and improve performance") — committed by the owner from the IDE
> rather than through the assistant, so it carries a generic message instead of the one
> below. The content is a single file, 479 insertions / 246 deletions, no stray files.

---

## 1. The defect this redesign exists to expose

Verified in code this session, not taken on trust:

`pop-seller.buildIronCondor` (`pop-seller.js:274-301`) returns a payload whose `legs`
array holds **exactly two SELL legs** — one CE, one PE — and **no `maxLoss` field at all**
(confirmed live: `'maxLoss' in ironCondor === false`). Two shorts with no bought wings is
a **short strangle**. Its loss is unbounded on both sides.

The old page rendered that payload as:

- a card titled **"🦅 Iron Condor (auto-built)"** — a structure whose defining property is
  *defined risk*;
- a button reading **"SELL IRON CONDOR (paper)"**;
- rows for Net Credit, Max Profit, Combined PoP and Breakevens — and **no Max Loss row at
  all**, because the engine sends no such field;
- a payoff canvas that plotted the returned window and shaded the profit zone green, so an
  unbounded position was drawn as a tidy trapezoid.

Measured for the live NIFTY structure at the time of writing: max profit **+₹5,506**, and
the P&L at the two edges of the sampled window **−₹53,897 and −₹53,371** — roughly ten
times the maximum gain, still falling at both ends. None of that was visible.

**The engine is not fixed here.** `buildIronCondor` is a separate approval. This task stops
the *page* from misdescribing what the engine hands it.

---

## 2. What the page now says

| before | after |
|---|---|
| "🦅 Iron Condor (auto-built)" | **"⚠ SHORT STRANGLE — UNDEFINED RISK"**, amber, naming the actual leg count: *"the engine returned 2 short leg(s) and 0 bought wing(s)"* |
| Max Loss row absent | **Max loss: UNBOUNDED** in red — a required row that can never be blank |
| — | **Reward : risk = —** (a dash, because with no max loss the ratio does not exist; not a fabricated number) |
| Payoff drawn as a closed shape | Loss arrows leaving the plot on both sides plus **"loss continues ↓"** |
| "SELL IRON CONDOR (paper)" | **"SELL STRUCTURE (paper)"**, and an undefined-risk structure requires an explicit confirm naming the risk before any paper leg is placed |
| thin warning ribbon | full-width bar: *"the edge is unproven — the iron-condor backtest scored **0 wins in 26**"* |
| credit shown bare | **"credit ₹X (gross)"** plus a standing note that brokerage, STT and exchange charges are **not** applied (engine finding E) |
| — | open naked shorts carry an **"undefined risk"** badge in the book |

`classify()` decides the label from the payload every time: **only** a payload with ≥2
bought wings alongside ≥2 shorts is called an IRON CONDOR with DEFINED RISK. If the engine
is ever fixed to emit real wings, the page will say so without further edits.

---

## 3. Data contract — unchanged

**Element IDs: all 13 present exactly once, none renamed** — `tbMode`, `tbSpot`, `warnBar`,
`popSlider`, `popValLbl`, `minPremInput`, `sortMode`, `scanInfo`, `scanBody`, `icCard`,
`payoffChart`, `bookList`, `bookCredit`.

**Endpoints: exactly the five that existed, payloads unchanged** — `GET /api/pop/scan`,
`POST /api/pop/payoff`, `POST /api/pop/sell`, `POST /api/pop/close`, `GET /api/pop/status`.

**No engine number is recomputed.** Credit, max profit, combined PoP, breakevens and lot are
printed exactly as received. The page's only arithmetic is the reward:risk ratio, and it is
shown as `—` rather than invented when `maxLoss` is absent. Live payload field names were
checked before use — candidates carry `distancePct`, `iv`, `dte`, `fromChain`, and the
payoff curve points are `{spot, pnl}` (the brief said `underlying`; the code says `spot`).

---

## 4. Honesty rules applied

- **`null ≠ 0`.** `has()` gates every field; a missing premium, IV, distance or credit
  renders `—` via `.tok-dash`, never `0` or `₹0`.
- **PoP is never a bare 100%.** `popTxt()` caps the display at **"≥99%"** and the column
  header carries *"(risk-neutral, 1−|Δ|)"*. A model probability of finishing OTM is not a
  safety margin and the page no longer lets it read as one.
- **Modelled premiums are labelled.** A candidate with `fromChain:false` was priced by
  Black-Scholes, not read from the live chain; it carries an amber **BS** badge instead of
  the green **LIVE** badge.
- **Estimated ATM IV** shows an `estimated` badge rather than a number when absent.
- **No GEX, no aggregate exposure** anywhere — OI is not aggregated on this page at all.
- **Paper stays paper.** The PAPER-ONLY chip, the warning bar and the `(paper)` suffix all
  remain; nothing was restyled to read as a live order.

---

## 5. Design

Adopts `/css/tokens.css` and **deletes the page's private `:root` block** — the second page
on the shared layer (UI-02 protocol: one page per commit).

- **Dark is the default**, per the owner decision re-confirmed 2026-07-26 ("background black
  joie che"). The brief asked for a light default; that would have reversed a recorded
  decision, so light is opt-in via the header toggle or `?theme=light`, persisted in
  `localStorage`. Flagged rather than silently applied.
- Contrast comes from the shared tokens: text 16.4:1, muted 7.9:1 on the dark background;
  7.1:1 on light. Every text token clears 4.5:1 in both.
- Sticky context strip (instrument · spot · ATM IV · DTE · mode) under a pinned warning bar.
- Two columns on desktop; on ≤980px the structure card and payoff move **above** the long
  scan table (`order:-1`) so the decision is not below the fold on a phone.
- `tabular-nums` on every price, strike, premium and P&L. Green/red always paired with a word
  or a ▼ glyph, never colour alone.
- Payoff chart is plain `<canvas>`, `devicePixelRatio`-aware, reading its colours from the
  CSS variables so it follows the theme. Breakeven guides, spot marker, shaded zones, hover
  tooltip, and a screen-reader summary that states the max loss as UNBOUNDED in words.
- Styled `loading` / `error` / `empty` states from the shared layer — no bare text nodes.
  The empty scan reads *"No strikes at ≥ 75% PoP — lower the PoP threshold or reduce the
  minimum premium."*

**CDN library: none.**

---

## 6. Acceptance gates — demonstrated

Verified statically and against the live NIFTY payload (screenshot evidence in
`SCREEENSHOTS/pop-redesign/`):

1. ✅ A 2-leg payload renders **"SHORT STRANGLE — UNDEFINED RISK"**, **Max loss UNBOUNDED**,
   and the payoff draws arrows off-plot with "loss continues ↓".
2. ✅ A 4-leg payload would render **IRON CONDOR — DEFINED RISK** with a finite max loss —
   `classify()` is driven by the payload, not by a hardcoded title.
3. ✅ Missing engine fields render `—`, never `0` (reward:risk is `—` in the live screenshot).
4. ✅ The **0-wins-in-26** warning and the **gross P&L** note are both visible without scrolling
   to them.
5. ✅ All 13 element IDs present exactly once; only the original 5 endpoints called.
6. ✅ PoP displays `≥99%` rather than `100%`; combined PoP shown verbatim (39.5%).

**Full suite 57/57 green.**

### Screenshots — `SCREEENSHOTS/pop-redesign/`
`pop-before-1440.png` (rendered from the pre-redesign file at `6c8054f`) ·
`pop-after-1440-dark.png` · `pop-after-1440-light.png` · `pop-after-390-dark.png`
(true 390 CSS px, captured at 2× because headless Chrome here refuses a window under ~491px).

**Honest limitation:** **Lighthouse was not run** — it is not available in this environment,
so the **≥90 accessibility target is unverified**. The work in §5 was done to the brief; the
score itself is not claimed.

---

## 7. Filed, not fixed (separate approvals)

- **`pop-seller.buildIronCondor` returns a misnamed 2-leg structure with no `maxLoss`.** The
  function name and the missing field are engine defects; this task only stopped the page
  from repeating them.
- **`pop-seller` P&L is gross of charges** (finding E). Labelled on the page; the engine fix
  is separate.
- **`sellStructure()` maps a BUY leg to `BUY_<type>`** for forward compatibility, but
  `/api/pop/sell` has only ever been exercised with `SELL_*`. If wings are ever added, that
  path needs testing before it is trusted.
