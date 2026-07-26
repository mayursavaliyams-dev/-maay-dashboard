# New page — `public/greeks.html` ("Greeks → P&L")

**Date:** 2026-07-26 · **Scope:** one new file, `public/greeks.html`. No `server.js`, no engine,
no other page edited, no build step, no npm, **no CDN library**. Read-only research page —
no order, execute or sell action exists on it. **Not committed** (task said not to commit unasked).
Evidence base: `REPORT-greeks-analytics.md`; task: `PROMPT-greeks-tab-v2.md`.

---

## 1. Which question this page answers

The owner asked for *"when the Greeks are at what values, profit happens."* Two pages could carry
that name and only one of them can be built honestly here.

**Version A — data-mined "at delta X you profited" — was NOT built.** The platform holds 41–50
labelled outcomes in total (the strangle engine has 7), and **no engine records entry Greeks beside
realized P&L**, so the study has neither the rows nor the columns. The `gammaBlast` fields in the
`backtest-tv-results-*.json` are void (same-day look-ahead — see `docs/REVIEW-bt-tv-lookahead.md`)
and were not mined either. There is no Greek→profit heatmap, no win-rate-by-Greek, and no use of
those files anywhere on the page.

**Version B — the deterministic Greek→P&L identity — is what the page is.** The Greeks *are* the
P&L relationship: theta is the ₹/day the clock moves, delta the ₹ per point, vega the ₹ per vol
point, gamma how fast delta turns. A position is structurally set to profit when net theta outruns
the delta/gamma/vega moves against it before expiry. The page shows that as arithmetic from the
*current* Greeks, and says so in the panel itself.

---

## 2. Endpoints used — all verified live this session

| method · path | used for | verified response |
|---|---|---|
| `GET /api/strategy/payoff/prefill?inst=` | spot, atm, step, **lotSize (registry-resolved)**, dteDays | `{ok,inst,spot:23767.45,atm:23750,step:50,lotSize:65,dteDays:3,strikes[]}` |
| `GET /api/options/chain?instrument=` | per-strike `ltp,oi,iv,ivSource,delta,gamma,theta,vega,pop` | 210 legs; `ivSource` distribution `{feed:182, bsm:28}` |
| `POST /api/strategy/payoff` | **net Greeks, curve, breakevens, unbounded flags, PoP** | `{greeks{delta,gamma,theta,vega}, curve[122], breakevens, unbounded{upside,downside}, maxLossLabel, riskReward, probabilityOfProfit, netCredit}` |
| `GET /api/vix?inst=` | India VIX | `{ok:true,value:14.03,regime:"NORMAL"}` |
| `GET /api/pop/status` | load the open paper book | `{book:[{inst,side,strike,type,premium,lot,pop,…}]}` |

**Not used, deliberately:** `/api/nifty/options/analytics` and the BANKNIFTY twin — they return
hardcoded deltas (0.85/0.5/0.15) and `iv||12`.

**TD-2 honoured:** the server's `OptionAnalyzer` is a shared singleton mutated per request, so all
fetches are **sequenced with `await`**, never fanned out in parallel.

---

## 3. The unit problem, and how this page refuses to fall into it

`option-analyzer` returns vega per **1.0 of vol** (`option-analyzer.js:871`, `vega = S*sqrtT*nd1`).
`payoff-engine` returns it per **1 vol point** (`payoff-engine.js:42`, `… /100`). **Verified by
reading both lines this session** — a genuine 100× difference.

The page therefore uses **exactly one source per view** and states the unit in the UI itself:

- **Position board** — only `POST /api/strategy/payoff`. Because `payoff-engine` scales by
  `qty = lots × lotSize` (`payoff-engine.js:59`, verified), its Greeks are already position-level
  and rupee-meaningful. Labels are literal: *Net Theta ₹/day*, *Net Delta ₹ per +1 index point*,
  *Net Vega ₹ per +1 vol point*.
- **Per-strike table** — only the chain's own Greeks, per share, and the vega column header carries
  a `/1.00vol` badge plus a tooltip saying it must never be compared with the board.

The two are never summed and never placed in the same row.

---

## 4. Honesty rules implemented (each one gated)

| rule | implementation |
|---|---|
| IV may be a placeholder | `ivIsEstimated()` flags any `ivSource ≠ 'feed'` **and** any IV within 0.005 of the documented placeholders 15 / 14 / 12. Badge `FEED` vs `EST` on every strike and every leg. |
| Estimated inputs poison the verdict | If any leg's IV is estimated, the verdict block turns amber and says the Greeks are model output on a model input, before giving the reading. |
| Unresolved ≠ 0 | `greekUnknown()` — an illiquid leg (`ltp ≤ 0.5`) whose four Greeks are all exactly 0 renders `—`, not `0`. A leg with a real Greek is never suppressed. |
| `ivPercentile` / `ivRank` | **absent from the file** (they are `Math.random()`). |
| No GEX / gamma wall / gamma flip / dealer gamma | **absent from the file.** The section note states why: the live-feed OI unit is unverified, so any such number could be wrong by 65×. |
| Lot | `window.instLot(inst())`, falling back only to the prefill's registry-resolved `lotSize`. `null` ⇒ the board is replaced by an explicit "contract size unknown" panel and no ₹ figure is printed. No literal anywhere. |
| VIX | real value when `/api/vix` returns one; otherwise the word **unavailable** in the dim/unknown style. Missing VIX is never treated as calm. |
| PoP | shown with a `RISK-NEUTRAL` badge and the line "a model probability, not a measured win rate. It is not a no-touch probability." |
| Unbounded loss | taken from the engine's own `unbounded` flags and `maxLossLabel`; an amber banner, an off-plot "loss continues" marker, and the sentence "the edge of the chart is not the edge of the risk". |

### Theta sign — verified before the "/day" label shipped (§3.3)

The brief required the sign be checked against a known long option rather than assumed. Measured live
through `POST /api/strategy/payoff`:

| position | theta | delta | reading |
|---|---|---|---|
| **BUY** 1× ATM 23750 CE | **−1136.24** | +35.87 | a holder **pays** time decay ✓ |
| **SELL** 1× ATM 23750 CE | **+1136.24** | −35.87 | a seller **harvests** it ✓ |
| **BUY** 1× ATM 23750 PE | **−992.82** | −29.44 | sign is not CE/PE-dependent ✓ |

Delta signs are also correct (long call positive, long put negative). The page's copy — *"Time is paying
you"* for positive theta, *"Time is costing you"* for negative — therefore matches the arithmetic.

### The scenario grid — what is exact and what is estimated

`buildPayoff`'s curve is **intrinsic-only** (at-expiry); passing a different `ivPct` changes the
Greeks and PoP but **not** the curve — verified live (iv 8 vs 30 → same curve, different greeks).
So the grid is split and labelled accordingly:

- **At-expiry column — EXACT.** Read straight off the engine's own curve by interpolation.
- **Today / +1 day columns — ESTIMATE**, badged `EST`, computed as a second-order Taylor step
  `delta·ΔS + ½·gamma·ΔS² + theta·Δt + vega·ΔIV` from the net Greeks, with an explicit note that it
  ignores higher-order terms, the smile and the path, and degrades with the size of the move.

Claiming the mid-life columns were exact would have been the easy lie; they are marked instead.

---

## 5. Verified acceptance gates

Run against the page's own functions in a DOM stub, plus the live feed:

```
GATE 1 — IV honesty
  ✓ feed IV 13.85 → measured          ✓ bsm IV 13.85 → ESTIMATED
  ✓ placeholder 15.00 → ESTIMATED     ✓ 14.00 → ESTIMATED      ✓ 12.00 → ESTIMATED
  ✓ null IV → unknown                 ✓ badges render FEED / EST correctly
GATE 2 — illiquid zero Greeks
  ✓ ltp 0.3 + all-zero Greeks → "—"   ✓ real Greeks never suppressed
GATE 3 — lot rule
  ✓ instLot 65 → 65                   ✓ instLot null → null (₹ withheld, board replaced)
GATES 4–7 (static)
  ✓ no GEX / gamma-wall / dealer-gamma   ✓ no ivPercentile / ivRank
  ✓ no hardcoded lot literal             ✓ hardcoded-Greeks analytics routes not called
  ✓ no CDN script                        ✓ scenario grid labelled EST / EXACT
  ✓ naked short renders UNBOUNDED + off-plot tail (screenshot evidence)
```

Live proof of gate 7: the page auto-loaded the **real** open paper book (2 short NIFTY calls) and
rendered `Max loss UNBOUNDED (naked short)`, an amber banner, and a curve whose right tail runs off
plot with "loss continues" — not a capped triangle.

**Full suite: 56/56 green** (this page adds no test surface; it is a static page).

---

## 6. Design

- **Light is the default**; dark arrives via `prefers-color-scheme` and a manual `[data-theme]`
  toggle that overrides the media query and persists in `localStorage`.
- Contrast measured (WCAG relative luminance): **light** on `#f6f7fb` — text 16.91:1, muted 7.11:1,
  green 5.12, red 5.35, amber 5.17, blue 6.22. **Dark** on `#0a0a0f` — text 16.44:1, muted 7.93:1,
  dim 5.52, green 11.83, red 6.35, amber 14.15, blue 8.32. Every text token clears **4.5:1** in both.
- Type scale and spacing scale defined once at `:root`; `font-variant-numeric: tabular-nums` on every
  Greek and every ₹ figure. Green/red always paired with a word or `▲/▼`, never colour alone; the
  payoff curve is drawn in two passes so the sign change is a shape change.
- Responsive to 390 CSS px (verified); the wide 14-column chain scrolls **inside its own container**,
  never sideways-scrolling the page.
- `aria-label`s on icon-only controls, a screen-reader summary of the chart (`#pfA11y`) refreshed on
  every draw, table `<caption>`s, visible focus rings, `prefers-reduced-motion` honoured.
- **CDN library: none.** The payoff chart is plain `<canvas>`, `devicePixelRatio`-aware, reading its
  colours from the CSS variables so it follows the theme.

### Optional item from §4.3, implemented
Strikes in the **top 15% of |theta| ÷ |gamma|** within the visible chain carry a
`decay-rich · tail-exposed` badge. The label is deliberately two-sided: a strike that decays fastest is,
by the same mechanics, the one that turns against you fastest in a gap. It is never called "high profit",
and only strikes whose theta *and* gamma are genuinely known take part in the ranking.

### Two additions beyond the brief, flagged
On first open the page **auto-loads the operator's existing open paper book** for the selected
instrument (once, and only while the board is empty, so it never overwrites a position the user is
building). Rationale: the question "what do my Greeks say" is usually about the position that already
exists. "Clear position" and "Load open paper book" remain explicit controls.

Second: the `?theme=light|dark` deep-link described in §8.

---

## 7. Nav link

A **Greeks** link was added to this page's own nav only. The nav markup is duplicated by hand across
**12 other pages**, which would each need the same link added — deliberately *not* mass-edited:

`ami-heatmap.html · command-pro.html · command.html · dashboard.html · heatmap.html · oi.html ·
pattern-signals.html · pop.html · signal-heatmap.html · strategy.html · strike-history.html ·
trade.html`

That duplication is itself the finding: a shared nav partial (or a nav generated from a registry, as
the Dashboard Rule already requires for instrument metadata) would remove twelve future edits.

---

## 8. Screenshots — `SCREEENSHOTS/greeks-tab/`

`greeks-1440-light.png` · `greeks-1440-dark.png` · `greeks-390-light.png` (true 390 CSS px, captured
at 2× because headless Chrome here refuses a window under ~491px).

**Light mode is now captured.** This headless Chrome reports `prefers-color-scheme: dark`
unconditionally and ignores `--force-prefers-color-scheme`, so the page gained a `?theme=light|dark`
deep-link (resolution order: query param → `localStorage` → `prefers-color-scheme`). That is a real
feature — a shareable link to either theme — and it also makes both themes reproducibly screenshottable
instead of leaving light mode unverified.

**Remaining honest limitation:**
- **Lighthouse was not run** (not available in this environment), so the **≥90 accessibility score is
  unverified**. The work listed in §6 was done to the brief; the score itself is not claimed.
- The visible chain window happened to contain only `feed` strikes, so the `EST` badge is proven by
  the function-level gate above and by the live count (28 `bsm` legs), not by that screenshot.

## 9. Not done
- No commit, no push.
- No engine or `server.js` change.
- Nothing added to the other 12 navs.
