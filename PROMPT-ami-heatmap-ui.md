# TASK PROMPT — Redesign `public/ami-heatmap.html` (AMI Heatmap) into a user-friendly, top-class UI

> Paste this whole file into the assistant working on Antigravity.
> Read `MASTER_PROMPT.md` and `THE-ONE-DOCUMENT.md` first; this task obeys both.
> Reply to the owner in **Gujarati script**. Code, paths and identifiers stay English.

---

## 0. Scope & ground rules

- **One file:** `public/ami-heatmap.html` (782 lines, single-file: inline `<style>` + `<script>`). Keep it
  single-file; you may add `/public/js/ami-heatmap-view.js` for the heatmap/render code only.
- This is a **monitoring dashboard** → the **Dashboard Rule** binds it: visualize and reconcile, never
  invent a market number. `null ≠ 0`. It has **no order actions** and must not gain any.
- The page's whole purpose is to show **signals your AmiBroker AFL pushes** (the `WAIT`/empty states are
  correct, not bugs — see §3.4). Preserve that data flow exactly.
- **This is a look/layout/readability redesign, not a data-logic rewrite.** Preserve every contract in §2.
- Do not touch `server.js` or any engine. No commit/push.

---

## 1. What's wrong with the current screen (the brief)

The page is information-dense but hostile to read, and — more seriously — it presents two *misleading*
numbers as if they were plain facts. Fix both.

**Readability (the obvious problem):**
1. `overflow:hidden` on `body` with **12px monospace** and three full option ladders side by side — the
   grid is a wall of near-identical red/green cells. Nothing guides the eye to the ATM row, the signal, or
   what changed.
2. No sticky ATM anchor, no scroll-to-ATM, tiny tap targets, low contrast (grey-on-near-black).
3. The three instruments compete for equal attention; there is no "what matters right now" hierarchy.

**Honesty (the dangerous problem — must be fixed, not just prettified):**
4. **The green "100%" badge is not a 100% anything.** It is `pop(delta) = (1 − |delta|) × 100`
   (`ami-heatmap.html:469, 477`) — the **risk-neutral probability of finishing OTM**, and it hits 100% only
   because far-OTM strikes have delta ≈ 0. A deep-OTM strike is **not "100% safe"**; a solid green "100%"
   reads exactly like that. This is the same PoP the rest of the platform is careful to label as
   *risk-neutral, not real-world, not no-touch.* The redesign must carry that label and **must not display a
   bare "100%."**
5. **`₹0.0` and `Δ0.00` are "no data," not real zeros.** The cells render `ceLtp`/`peLtp` and
   `Δ${Math.abs(ce.delta||0)}` (`:571-574`), so a missing premium or delta shows as `₹0.0` / `Δ0.00`. That
   is a `null ≠ 0` violation — an untraded/illiquid strike must read `—`, not `0`.

---

## 2. Data contract — preserve EXACTLY (verified against the file)

**Element IDs the script reads/writes** (keep, or refactor in the same commit): per-instrument
`hm-{INST}`, `spot-{INST}`, `atm-{INST}`, `pcr-{INST}`, `sig-{INST}`, `sMP-{INST}`, `sVW-{INST}`,
`sCeOI-{INST}`, `sPeOI-{INST}`, `sOH-{INST}`, `sOL-{INST}`, `panel-{INST}`, `strip-{INST}`, where
`{INST} ∈ {NIFTY, SENSEX, BANKNIFTY}`; plus `afList`, `afCount`, `afCalls`, `afPuts`, `hlList`, `hlCount`,
`hlHighs`, `hlLows`, and the AMI card ids `amiCard, amiSigPill, amiPosBadge, amiPrice, amiStrike, amiTarget,
amiConf, amiTime, amiPnl, amiDot, amiFeed`, and the tooltip ids `tt-delta, tt-chgoi, …`.

**Endpoints — do not change shape or add new ones:**
- `GET /api/options/snapshot?instrument=${inst}` → `{ spotPrice, atmStrike, strikes:[{ strike, ce:{ltp,oi,delta,…}, pe:{…} }], pcr, maxPain }`
- `GET /api/${sp}` (`sp ∈ {nifty, banknifty, sensex}`) → `{ signal, price }`
- `GET /api/amibroker/last-signal` → `{ signal, conf, strike, target, price, time }` (the AFL's pushed signal)
- `GET /api/amibroker/position?key=antigravity` → open AMI position `{ …, mult }`
- `GET /api/amibroker/signals` → today's pushed-signal feed
- `GET /api/hl-alerts?inst=${i}&limit=30` → session high/low break alerts

**Honesty caveats baked into this data (the page must respect all):**
- `pop()` is `(1−|delta|)` — risk-neutral OTM probability, **not** a safety percentage (§1.4).
- `/api/options/snapshot` Greeks/IV may come from a fallback (assumed vol); `delta` can be absent → the
  `||0` in the current code hides that. Treat absent delta/ltp as **unknown**.
- OI is shown per strike (Cr/L). That is fine as a magnitude, but **do not aggregate OI into any GEX /
  exposure number** — the OI unit is unverified platform-wide (F4).

---

## 3. The redesign — what "top-class & user-friendly" means here

### 3.1 Design system
- Keep a dark identity but **fix contrast** (body ≥ 4.5:1, secondary ≥ 3:1) and offer a
  `prefers-color-scheme: light` variant. Real UI font for labels; **tabular-nums** for every price, OI,
  delta and premium so columns align. A defined type scale — the ATM row, the live signal, and any H/L break
  are the largest things on screen.
- Semantic, colour-blind-safe: CE/calls one hue, PE/puts another, **signal states (WAIT/BUY-CALL/BUY-PUT)**
  a distinct accent — always paired with text, never colour alone. Drop the wall-of-red look: use colour to
  encode *one* meaning per view (e.g. OI intensity **or** PoP), not three at once.

### 3.2 Layout & hierarchy
- Three instrument panels, but with a clear **focus model**: a compact top strip per instrument (spot, ATM,
  PCR, VWAP, max-pain, signal pill) always visible, and the full ladder below it. On smaller screens, let
  the user collapse two instruments and focus one; the ladder becomes vertically scrollable (remove the
  page-level `overflow:hidden` trap).
- **Anchor the ATM row**: highlight it, add an "ATM" chip, and auto-scroll each ladder to ATM on load with a
  "jump to ATM" control. Shade ITM/OTM softly around ATM so moneyness is readable at a glance.

### 3.3 The heatmap cells — honest and legible
- Each strike row: strike (centre), CE and PE with **LTP, OI (bar + number), Δ, and PoP**. Make the OI bar
  accessible (title/aria with the real number).
- **PoP cell:** never a bare "100%." Cap the display at **"≥99%"** and label the column *"PoP (risk-neutral,
  1−|Δ|)"* with a tooltip: *"probability of finishing OTM — not a probability of profit and not a safety
  guarantee."* A hover explains that deep-OTM 100% means "far from spot," not "safe."
- **Missing data:** an absent LTP or delta renders **`—`**, never `₹0.0` / `Δ0.00`. If a whole side of a
  strike has no quote, grey the cell as "no data" — visually distinct from a real ₹0.5 premium.
- Keep the existing tooltip (delta, ΔOI, …) but style it and show units; render its missing fields as `—`.

### 3.4 The AmiBroker signal + alert feeds (the point of the page)
- The **AMI signal card** and the **"AMI Signals (today)"** and **"Low/High Alerts"** feeds are the reason
  this page exists. Keep their live, newest-first behaviour and their honest empty states (*"no signals yet
  — waiting for AmiBroker push…"*). Redesign them to be scannable: each signal row shows time, instrument,
  side, strike, confidence, target — with a clear BUY-CALL/BUY-PUT/WAIT state.
- A **"last push received" timestamp / freshness dot**: if AmiBroker hasn't pushed in N minutes, show the
  feed as **stale** (amber), so a silent AFL looks different from a quiet market. Do not fabricate a signal
  to fill the gap.
- Confidence and target come from the AFL push (`amiData.conf`, `amiData.target`); display them as given,
  and show `—` when absent (the code already guards `conf ? … : '--'` — keep that, style it).

### 3.5 Feedback & states
- Live updates get a subtle highlight on the changed cell (respect `prefers-reduced-motion`). Every fetch
  has explicit loading / error / empty / stale states — no bare text nodes, no silent blanks.

### 3.6 Accessibility & polish
- Full keyboard path (focus a strike row, arrow through the ladder, jump-to-ATM), visible focus rings,
  `aria-label`s on icon-only controls, a screen-reader summary per instrument (spot, ATM, signal, PCR).
  Target Lighthouse Accessibility ≥ 90.

---

## 4. Deliverable & acceptance
- Updated single `public/ami-heatmap.html` (+ optional `/public/js/ami-heatmap-view.js` for render code).
- Before/after screenshots at 1440px and 390px, light + dark.
- Changelog: element IDs / endpoints touched (should be **none**, or justified), contrast ratios, CDN
  lib+version if any.
- **Honesty gates, demonstrated:**
  1. A far-OTM strike shows **"≥99%"** (not "100%") under a column labelled *risk-neutral PoP (1−|Δ|)*, with
     the not-a-safety-guarantee tooltip.
  2. A strike with no LTP / no delta renders **`—`**, never `₹0.0` / `Δ0.00`.
  3. When AmiBroker hasn't pushed recently, the feed shows **stale**, not a fabricated signal.
  4. No aggregated GEX / exposure number is computed from OI anywhere on the page.

## 5. What NOT to do
- Do not display a bare "100%" PoP, or let PoP read as "probability of profit" or "safe."
- Do not render a missing premium/delta as `0`. `null ≠ 0`.
- Do not invent or backfill an AmiBroker signal; a silent AFL must look silent (stale), not active.
- Do not aggregate OI into GEX/exposure (F4).
- Do not add order/execute actions, touch `server.js`/engines, or commit/push.
- Do not pull in a heavy framework for one static page.
