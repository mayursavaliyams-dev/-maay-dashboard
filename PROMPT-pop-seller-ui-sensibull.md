# TASK PROMPT — Rebuild `public/pop.html` (PoP Seller) with a Sensibull-grade UI

> Paste this whole file into the assistant working on Antigravity.
> Read `MASTER_PROMPT.md` and `THE-ONE-DOCUMENT.md` first; this task obeys both.
> Reply to the owner in **Gujarati script**. Code, paths and identifiers stay English.

---

## 0. Scope & the one thing you must not do

- **One file:** `public/pop.html` (single-file: inline `<style>` + inline `<script>`). Keep it
  single-file; you may add `/public/js/pop-payoff.js` for the chart if it grows, nothing else.
- The goal is a **clean, spacious, professional options-selling UI in the spirit of Sensibull** —
  but "looks like Sensibull" must never mean "makes a risky position look safe." Read §1 before
  touching a pixel.
- `pop.html` is a **dashboard page** → the **Dashboard Rule** binds it: it visualizes and reconciles;
  it never invents market logic and never manufactures a number the engine did not send.
  `null ≠ 0`. Refuse rather than guess.
- **Paper only.** `SELL IRON CONDOR (paper)` and the per-position CLOSE are paper actions. Keep the
  top warning bar. Never restyle either into something that reads as a live order.
- Do not commit or push unasked. Do not touch other files, `server.js`, or any engine.

---

## 1. CRITICAL HONESTY DEFECT — this redesign must expose it, not hide it

Measured against `pop.html` on disk and confirmed by `THE-ONE-DOCUMENT.md` finding **F**:

The card titled **"🦅 Iron Condor (auto-built)"** renders exactly **two legs**:

```js
// pop.html:242-243
Sell CE  ${ic.legs[0].strike} @ ₹${ic.legs[0].premium}
Sell PE  ${ic.legs[1].strike} @ ₹${ic.legs[1].premium}
```

There are **no wings**. Two short legs is a **short strangle**, not an iron condor. Consequences,
all visible on the current screen:

- The card shows **Max Profit** but **no Max Loss** — because the engine emits no `maxLoss` field.
  A structure whose defining property is *defined risk* is shown with its risk simply absent.
- `drawPayoff()` (`pop.html:252`) plots the curve the API returns and shades it. With no wings the
  real payoff runs to **unbounded loss** on both tails; drawing it inside a fixed canvas makes an
  unbounded position look like a bounded trapezoid.
- The warning bar already admits the edge is unproven: *"IC backtest: 0/26 wins — validate on paper
  first."*

**Your redesign must make the truth louder, not the packaging prettier.** Specifically:

1. **Do not call a two-leg structure an "Iron Condor."** If the engine returns 2 legs, label the
   card **"SHORT STRANGLE — UNDEFINED RISK"** with an amber banner. Only call it an Iron Condor when
   the payload actually contains 4 legs (two shorts + two long wings).
2. **Max Loss is a required row.** If `maxLoss` is absent/undefined → render it as **"UNBOUNDED"** in
   red, never blank, never `0`, never `—` styled as calm. An absent max-loss on a short-premium
   structure is the single most important fact on the page.
3. **The payoff chart must show the unbounded tails** — draw them running off the bottom of the plot
   with an explicit "loss continues" indicator and arrowheads, so no one reads a capped triangle.
   Do not clip the y-axis to flatter the position.
4. Keep the `0/26` backtest note prominent, not buried in a thin ribbon.

Do not "fix" the engine in this UI task (that is `pop-seller.buildIronCondor`, a separate
approval). Your job is to stop the **page** from lying about what the engine returns.

---

## 2. Data contract — preserve EXACTLY (verified against the file)

**Element IDs the script uses** (keep or refactor in the same commit): `tbMode`, `tbSpot`,
`warnBar`, `popSlider`, `popValLbl`, `minPremInput`, `sortMode`, `scanInfo`, `scanBody`, `icCard`,
`payoffChart`, `bookList`, `bookCredit`.

**Endpoints — do not change shape, do not add new ones for a UI task:**
- `GET /api/pop/scan?inst=${inst}&minPoP=60` → `{ spot, atmIV, daysToExpiry, count, candidates[], ironCondor }`
  where each candidate has `{ side, strike, type, premium, lot, pop, dist, ivDte, maxProfit }` and
  `ironCondor = { legs:[{strike,type,premium}], credit, maxProfit, combinedPoP, lowerBreakeven, upperBreakeven, spot, lot }`.
- `POST /api/pop/payoff` `{ inst, spot, legs:[{action,type,strike,premium}] }` → `{ curve:[{underlying,pnl}] }`
- `POST /api/pop/sell` `{ inst, side, strike, type, premium, lot, pop }`
- `POST /api/pop/close`
- `GET /api/pop/status`

**`maxProfit`, `pop`, `combinedPoP`, `credit`, breakevens are the ENGINE's numbers — display them
verbatim. Never recompute a market figure to make it look nicer. If a field is missing, show that it
is missing.** (The Dashboard Rule permits *reconcile* — recomputing only to cross-check the engine
and show ✗ on disagreement — but never to replace or invent.)

---

## 3. The Sensibull-grade redesign — what "top class" means here

### 3.1 Design language (the Sensibull feel, done accessibly)

- **Clean and spacious, not dense-dark-terminal.** Generous whitespace, clear card separation, a
  restrained palette. Default to a **light, high-legibility theme** with a proper **dark toggle**
  (respect `prefers-color-scheme`). Sensibull's signature is calm clarity, not neon on black.
- Real UI font for labels/buttons; **tabular-nums** for every price, premium, strike and P&L so
  columns align.
- A defined type scale and 4/8/12/16/24 spacing scale. The decision numbers — PoP, credit, max
  loss — are the largest things in their card.
- Contrast: body text ≥ **4.5:1**, secondary ≥ **3:1**. No grey-on-grey.
- Semantic, colour-blind-safe: sell/credit = green, buy/debit = red, **risk/undefined = amber**,
  always paired with text or a shape, never colour alone.

### 3.2 Layout

- Responsive two-column on desktop → single column on mobile. Left: **scanner** (PoP slider, min
  premium, sort, candidate table). Right: **structure card → payoff → open positions book**.
- **Sticky context strip**: instrument (NIFTY/BANKNIFTY/SENSEX), spot, ATM IV, DTE, PAPER badge —
  visible while scrolling. The warning bar stays pinned at the top.
- On mobile, the payoff and the structure card come **before** the long scan table, and a compact
  "positions" summary pins to the bottom.

### 3.3 The scanner (the candidate table)

- Sensibull-style clarity: sortable columns (Side, Strike, Premium, PoP%, Dist%, IV·DTE, Max
  Profit, Action), a **PoP slider with a live count** ("40 candidates ≥ 75% PoP"), and a clear
  **empty state** ("No strikes ≥ 75% PoP — lower the threshold or widen premium") instead of the
  current bare centered line.
- Colour PoP as a subtle heat scale, but keep the number readable. Each row's **Sell** button is a
  large tap target that adds the leg and animates a confirmation.
- `Scanning...` and error states are styled, with a retry affordance — no bare text nodes.

### 3.4 The structure card (was "Iron Condor")

- Title reflects **reality** per §1 (Short Strangle / Iron Condor by actual leg count).
- Rows: each leg (side · strike · premium), **Net Credit**, **Max Profit (green)**, **Max Loss
  (red, or UNBOUNDED)**, **Combined PoP**, **Breakevens**, **Risk:Reward**. Max Loss is never
  omitted.
- A one-line plain-language verdict: *"Undefined risk — a gap past the short strike can lose far more
  than the ₹1,554 credit"* when there are no wings; *"Defined risk — max loss ₹X"* when there are.
- The paper-sell button keeps `(paper)` and, when risk is undefined, requires a small confirm step
  ("I understand this can lose more than the credit").

### 3.5 The payoff chart (the centrepiece — spend the most effort here)

- Sensibull-quality expiry payoff: shaded profit (green) / loss (red) zones, **breakeven guides**
  with price labels, **max-profit and max-loss guides** with ₹ labels, a distinct **current-spot
  marker**, and **hover/tap** to read P&L (₹ and %) at any underlying.
- Show **T+0 vs expiry** if the API can supply it; otherwise expiry only, labelled as such — do not
  fake a T+0 line.
- **Unbounded tails are drawn as unbounded** (§1.3). Axis ticks in ₹ with `en-IN` grouping.
- Accessible: a text summary for screen readers (credit, max profit, max loss, breakevens), and a
  chart that is legible in both themes. If you use a CDN lib, pin its version.

### 3.6 Open positions book

- Clear per-position card: side · strike · entry premium × lot · current value/credit · **CLOSE**
  (paper) with undo. Show aggregate **credit at risk** and, when any open leg is a naked short, an
  amber "undefined-risk open position" flag.
- Note for the changelog (do not fix here): finding **E** says `pop-seller` P&L is **gross, not net
  of charges**. If the book shows P&L, label it **"gross (charges not applied)"** so the number is
  not mistaken for take-home. Flag it; the engine fix is a separate task.

### 3.7 Accessibility & polish

- Full keyboard path (tab to a candidate row, Enter to add; slider operable by arrows), visible
  focus rings, `aria-label`s on icon buttons, `prefers-reduced-motion` respected, Lighthouse
  Accessibility ≥ 90.

---

## 4. Deliverable & acceptance

- Updated single `public/pop.html` (+ optional `/public/js/pop-payoff.js` for the chart only).
- **Before/after screenshots** at 1440px and 390px, in both light and dark themes.
- A changelog listing: element IDs / endpoints touched (should be **none**, or justified), contrast
  ratios hit, CDN lib + version if any.
- **Acceptance gate — the honesty checks, demonstrated:**
  1. A 2-leg payload renders as **"Short Strangle — undefined risk"**, Max Loss = **UNBOUNDED**,
     and the payoff shows tails running off-plot.
  2. A (hypothetical) 4-leg payload renders as a real Iron Condor with a finite Max Loss.
  3. Any missing engine field renders as missing (`—`/"UNKNOWN"), never as `0`.
  4. The `0/26` backtest warning and the "gross P&L" label are both visible.

## 5. What NOT to do

- Do not label a 2-leg structure "Iron Condor," and do not draw its loss as bounded.
- Do not recompute or "smooth" any engine number (credit, PoP, max profit, breakevens). Display, or
  show absent.
- Do not render an unknown as `0`. `null ≠ 0`.
- Do not make the paper-sell/close buttons look like live orders; keep the PAPER badge and the
  warning bar.
- Do not fix `pop-seller.buildIronCondor` or the charges/gross-P&L engine issue in this task — flag
  them, they are separate approvals.
- Do not pull in a heavy framework for one static page.
