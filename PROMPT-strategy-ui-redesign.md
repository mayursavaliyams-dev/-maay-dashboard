# TASK PROMPT — Redesign `public/strategy.html` (Strategy Builder) into a top-class, user-friendly UI

> Paste this whole file into the assistant working on Antigravity.
> Read `MASTER_PROMPT.md` and `THE-ONE-DOCUMENT.md` first; this task obeys both.
> Reply to the owner in **Gujarati script**. Code, paths and identifiers stay English.

---

## 0. Scope & ground rules

- **One file only:** `public/strategy.html` (single-file: inline `<style>` + inline `<script>`,
  plus the existing `<script src="/js/instrument-meta.js">`). Keep it single-file. No build step,
  no npm, no framework unless justified — vanilla JS + one CDN charting lib at most.
- `strategy.html` is a **dashboard page**, so the **Dashboard Rule** binds it: *the page
  visualizes; it never invents market logic.* It may cache, aggregate, and reconcile. It must
  **not** re-introduce any market constant. (History: this page once hardcoded
  `lotSize = { NIFTY:75, SENSEX:20, BANKNIFTY:35 }` with a `|| 75` fallback — every rupee figure
  was scaled by a wrong contract size. That is why lots now come only from `window.instLot(inst())`.)
- **This is a redesign of look, layout and usability — not a rewrite of behaviour.** Preserve every
  data contract in §2 exactly, or list each change with a reason. Do not "improve" the payoff math,
  the strike selection, or the execute path as a side effect. One concern per change.
- **Paper only.** The primary action is `PAPER EXECUTE (₹0 risk)`. It must stay unmistakably a
  paper action after the redesign — never restyle it into something that looks like a live order.
- Do not commit or push unasked.

---

## 1. What is wrong with the current screen (the brief)

The current Strategy Builder is functional but hostile to a human. Fix these, in order of pain:

1. **Everything is the same visual weight.** 13px monospace on near-black, ~0.62–0.78rem labels,
   `--muted:#4a4a6a` on `--bg:#0a0a0f` — that is roughly a **2:1** contrast ratio where WCAG asks
   for 4.5:1. The whole left rail is barely legible.
2. **The payoff pane is dead until you act, and says so in grey nothing** ("Add legs to see
   payoff"). No sample, no guidance, no skeleton. The single most valuable object on the page is
   empty most of the time.
3. **The option chain is a wall of numbers** — 30+ rows, CE LTP / STRIKE / PE LTP / OI bars, no
   sticky header, no ATM anchor, no scroll-to-ATM, tiny tap targets. Finding the strike you want is
   a hunt.
4. **The summary is a row of `--` / `₹0`** with no distinction between "zero" and "not yet known".
   `null ≠ 0`: an unknown max-loss and a zero max-loss must look different.
5. **No feedback loop.** Clicking a strike, adding a leg, changing lots — none of it is confirmed
   with motion, highlight, or a running "what changed" read-out.
6. **Not responsive / not keyboard-usable.** Below 900px the grid collapses to one column and the
   chain becomes unusable; there is no keyboard path to add a leg.

---

## 2. Data contract — preserve EXACTLY (verified against the file on disk)

Do not rename these without updating every reference and saying so.

**Element IDs the script reads/writes** (keep them, or refactor the script in the same commit):
`instSel`, `lotsSel`, `expiryDays`, `spotInfo`, `chainContent`, `legsBody`, `payoffCanvas`,
`payoffInfo`, `sumNet`, `sumMaxP`, `sumMaxL`, `sumBE`, `sumRR`, `sumLot`.

**Endpoints** (do not change shape or add new ones for a UI task):
- `GET /api/options/chain?instrument=${inst}` → `{ spotPrice, atmStrike, strikes:[{ strike, ce:{ltp,oi}, pe:{ltp,oi} }] }`
- `GET /api/${sigPath}` where `sigPath ∈ {nifty, banknifty, sensex}` → `{ price }` (spot refinement)
- `POST /api/pop/sell` — the paper-execute path. Keep its payload identical.

**Lot size — the one hard rule.** Contract size comes **only** from `window.instLot(inst())`
(generated from the broker-verified registry into `/js/instrument-meta.js`). If it returns `null`:
**disable PAPER EXECUTE, show the reason inline, render P&L cells as `—`.** Never substitute 75, 65,
or any literal. Never re-add a `lotSize = {…}` object. A wrong lot silently rescales the entire
payoff curve.

**State model stays:** `legs = [{ action, type, strike, premium, lots }]`, plus `spot`, `atm`,
`chainData`, `maxCeOI`, `maxPeOI`. Redesign may add derived view-state; it must not move the source
of truth out of these.

---

## 3. The redesign — what "top-class" means here

### 3.1 Design system (define once at `:root`, use everywhere)

- **Keep the dark identity** but fix contrast. Body text ≥ **4.5:1** on background; secondary text
  ≥ **3:1**. Raise `--muted` until it passes; do not ship grey-on-grey. Provide a `prefers-color-scheme:
  light` block so the page is usable in a lit room.
- A **type scale**, not ten ad-hoc sizes: e.g. `--fs-xs .75rem / --fs-sm .875rem / --fs-base 1rem /
  --fs-lg 1.25rem / --fs-xl 1.75rem`. The one number that matters right now (net premium, or max
  loss) is the largest thing in the summary.
- Use monospace/tabular-nums **only for numbers** (so columns align); use a real UI font for labels
  and buttons. `font-variant-numeric: tabular-nums` on every price cell.
- Spacing on a scale (4/8/12/16/24). Give the left rail breathing room; it is currently choked.
- Semantic colour, consistent everywhere: **buy = green, sell = red, warning/unknown = amber**.
  Green/red must be distinguishable for red-green colour-blindness — pair colour with a
  shape/label (▲/▼, "BUY"/"SELL" text), never colour alone.

### 3.2 Layout

- Three zones, responsive: **(a) Build** (presets + controls + legs + summary), **(b) Payoff**,
  **(c) Chain**. On desktop, payoff is the hero — largest area, top-right. On mobile, stack as
  Build → Payoff → Chain with the chain in a collapsible/expandable panel and a floating summary
  bar pinned to the bottom.
- **Sticky, always-visible summary bar**: net premium, max profit, max loss, breakeven(s), R:R —
  visible while the user scrolls the chain. This is the decision, keep it on screen.

### 3.3 The payoff chart (the centrepiece — spend the most effort here)

- Replace the empty state with a **live, labelled payoff diagram** the moment there is ≥1 leg;
  before that, show a **worked sample** (e.g. a short straddle) as a ghosted preview with a "this is
  an example" tag, so the user learns the tool by seeing it.
- Mark, clearly: **breakeven point(s)** (vertical guides + price label), **max profit** and **max
  loss** (horizontal guides + ₹ label), **current spot** (a distinct marker), and the profit/loss
  zones shaded green/red. Curve crosses zero at breakevens — label them.
- Interactive: hover/tap anywhere on the x-axis shows expiry P&L at that underlying level in a
  tooltip (₹ and %). Axis ticks in ₹ with `en-IN` grouping.
- If max loss is unbounded (e.g. a naked short with no wing — see `pop-seller.buildIronCondor`
  finding F), the chart must **say "unbounded"** with an amber warning, not clip the axis to make it
  look bounded. Honesty over prettiness.
- Chart quality bar: one accessible palette, legible in dark and light, gridlines low-contrast,
  data high-contrast, no chartjunk. If you use a CDN lib, pin the version.

### 3.4 The option chain

- **Sticky header row.** **Auto-scroll to ATM on load**, with the ATM row visually anchored
  (highlight + a small "ATM" chip). A "jump to ATM" control.
- Each row is a **large tap target**; clicking CE or PE adds that leg and **animates it into the
  legs table** so the cause→effect is visible. Selected strikes stay highlighted in the chain.
- OI bars: keep them, but give them an accessible label (title/aria) with the actual number, and
  render **missing OI as an empty/`—` cell, never a full or zero bar** (`null ≠ 0`).
- Moneyness cue: subtle ITM/OTM background gradient split at ATM, low-contrast so it never fights
  the numbers.

### 3.5 Legs, controls, and feedback

- Legs table: per-leg **action toggle (Buy/Sell), type (CE/PE), strike, premium, lots**, an inline
  **remove** with undo, and a **duplicate leg** action. Editing lots re-renders payoff + summary
  live.
- **Presets** (Straddle, Strangle, Bull Call Spread, Bear Put Spread, Iron Condor, Long Straddle,
  Synthetic Bear, Custom): clicking one populates legs around ATM and shows a one-line plain-language
  description of the resulting risk ("defined risk, max loss ₹X" / "undefined risk — can lose more
  than premium").
- **Every mutation gets feedback**: a brief highlight on the changed summary number, and a tiny
  "last change" line ("+1 lot NIFTY 23750 CE"). Loading and error states are explicit and styled —
  no bare "Loading..." / "Error: …" text nodes.
- **Empty/edge states everywhere**: chain unavailable, spot unknown, lot unknown, no legs. Each
  states what is missing and what the user can do — never a blank or a silent `0`.

### 3.6 Accessibility & polish

- Full keyboard path: tab to a strike row, Enter adds it; arrow-keys move up/down the chain;
  Escape clears selection. Visible focus rings.
- `aria-label`s on icon-only buttons; the payoff chart has a text summary for screen readers
  (net premium, max P, max L, breakevens).
- Respect `prefers-reduced-motion` (disable the add-leg animation when set).
- Target **Lighthouse ≥ 90** Accessibility and Best-Practices on this page.

---

## 4. Deliverable & acceptance

- A single updated `public/strategy.html`. If it grows unwieldy, you may split the payoff-drawing
  code into `/public/js/payoff-view.js` — but nothing else, and reference it the same way
  `instrument-meta.js` is referenced.
- **Before/after screenshots** at 1440px and at 390px (mobile).
- A short changelog listing: every element ID / endpoint touched (should be **none**, or justified),
  the contrast ratios you hit, and the CDN lib + version if any.
- **Do not change** any `/api/*` payload, the lot rule, or the paper-execute behaviour.
- Prove the lot rule still holds: with `window.instLot()` forced to return `null`, PAPER EXECUTE is
  disabled and P&L cells read `—`. Include that check.

## 5. What NOT to do

- Do not re-add a hardcoded lot table or a `|| 75` fallback, anywhere, for any reason.
- Do not render an unknown value as `0`, a full OI bar, or a bounded-looking payoff. `null ≠ 0`.
- Do not turn PAPER EXECUTE into anything that reads as a live order.
- Do not pull in a heavy framework (React/Vue build) for a single static page.
- Do not touch other files in `public/`, `server.js`, or any engine. One page, this task.
