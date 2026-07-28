# 052 — The UI Shell: One Rail, One Screen

**Author:** Chief Architect
**Date:** 2026-07-28
**Status:** Delivered. 22/22 pages measured at zero page scroll on the owner's panel.
**Severity of the defects fixed:** S3 (usability), with one S2 consequence — labels scrolling away from the numbers they label.

---

## 1. Problem

Two defects, both measured rather than assumed, on the owner's 2560×1330 display.

**A. The page list was copied into every page.** Twenty-one pages each carried their
own `<nav>` holding the same links, hand-maintained. They had drifted: some listed
pages that no longer mattered, none listed `capture.html` or `greeks.html`, which
therefore shipped reachable from nothing at all.

**B. Half the pages ran past the viewport.** Measured heights, in screens:

| Page | Before | Page | Before |
|---|---|---|---|
| trade.html | **12.46** | strike-history.html | 2.20 |
| agents.html | **9.65** | greeks.html | 1.96 |
| dashboard.html | **6.71** | strangle-monitor.html | 1.38 |
| capture.html | **6.22** | health-dashboard.html | 1.31 |
| command.html | 1.26 | ami-heatmap.html | 1.11 |
| pattern-signals.html | 1.04 | | |

The cost is not aesthetic. On `trade.html` the header carries the spot prices and
the **PAPER** badge; twelve screens down, a `BUY` could be pressed with no reminder
of which mode was live. On `capture.html` the "this is perfect hindsight, not a
strategy" caveat sat above rows that scrolled for six screens beneath it.

---

## 2. Constraints

| # | Constraint | Source |
|---|---|---|
| C1 | No page-level scrolling, vertically or horizontally | Owner, 2026-07-27 |
| C2 | Build for a 32-inch panel | Owner, 2026-07-27 |
| C3 | Dark is the default theme | Owner decision, 2026-07-09 |
| C4 | Data must remain fully readable — no shrinking to fit | Owner, 2026-07-26 |
| C5 | Nothing may be hidden to make a page "fit" | Architecture principle |

C1 and C4 are in tension for a seven-hundred-row table. §4 records how that was resolved.

---

## 3. Evidence

Measurement drove every change. A headless Edge instance at 2560×1330 loaded each
page, waited for live data, then **attempted to scroll it** — `window.scrollTo(0, 100000)`
and read back `scrollY`. That is the honest test.

An earlier version of the harness used `documentElement.scrollHeight`, which lies:
on a page whose only tall content sits inside an `overflow:auto` region it still
reports the inner extent. It also flagged `strategy.html` as clipping content —
correctly identifying `overflow:hidden` regions with hidden overflow, but all of
them turned out to be `.sr-only` elements, which are supposed to be invisible. **No
page was hiding real data** (C5 satisfied before any change was made).

---

## 4. Decision

### 4.1 One rail owns navigation

`public/js/rail.js` holds a single `PAGES` array and injects the sidebar on every
page. 175 duplicate links across 21 pages were deleted. Adding a page is now one
line. `login.html` deliberately does not mount it: the page list is not shown before
sign-in.

`command.html` and `command-pro.html` are intentionally absent from the rail —
`dashboard.html` is the declared single home and a superset of both. They remain
served, and the rail on them navigates away.

### 4.2 One region per page absorbs the scrolling

`public/js/fit.js` bounds the element marked `data-fit` to exactly the space the
viewport has left, measuring what is above and below it rather than assuming a
structure the pages do not share.

**This is where C1 meets C4.** A table of seven hundred strikes is longer than any
screen; nothing can change that. What can change is *where* the scrolling happens.
Moving it from the page into the data region keeps the header, the instrument
selector, the column headings and the caveats permanently on screen. The honest
claim is therefore not "nothing scrolls" but **"the page never scrolls, and the
labels never leave"**.

### 4.3 The home page is grouped, not stacked

`dashboard.html` held fourteen panes stacked 6.7 screens deep, which meant the most
important number on it was whichever one you had scrolled to. They are now grouped
behind six tabs — High/Low, Chain & Quotes, Signals, Book & P&L, Health — plus an
explicit **All**. Every pane stays mounted and keeps polling, so switching shows
data rather than a spinner.

### 4.4 The 32-inch panel is a first-class target

Eleven pages still carried laptop-era width caps, leaving roughly a thousand pixels
of empty margin on each side while their tables stayed cramped. Each now lifts its
cap at 1900px and again at 2560px, matching what `capture`, `greeks`, `pop` and
`dashboard` already did.

---

## 5. Defects Found While Building This

Three, all found by measurement rather than review, and all recorded in
`test/ui-shell.test.js` so they cannot return.

1. **The fit loop never settled.** `apply()` cleared the cap to take a reading,
   which resized the body, which woke the `ResizeObserver`, which cleared the cap
   again. The region spent much of its life unbounded. Nothing in the calculation
   actually depends on the region's own height, so the cap is no longer cleared.

2. **A static scroll container does not clip absolutely positioned descendants.**
   `greeks.html` still scrolled 727px after being bounded. The cause was the
   `sr-only` `<caption>` elements inside the option-chain table: positioned against
   the document, they sat two thousand pixels down at their static position and
   stretched the page although nothing visible was there. The region is now made a
   containing block.

3. **The default tab named a group that no longer existed.** After regrouping,
   `start` still read `"levels"`, so a first visit with no stored preference would
   have hidden every pane and shown an empty page.

Two further failures were mine and worth recording: the first version of the ratchet
counted `data-fit` as text and accused `dashboard.html` of marking two regions when
the second was a code comment; the second read `@media (max-width: …)` breakpoints
as layout caps and accused four pages that cap nothing. Both times the test was
wrong and the code was right.

---

## 6. Result

| Metric | Before | After |
|---|---|---|
| Pages with page-level vertical scroll | 11 / 22 | **0 / 22** |
| Pages with horizontal scroll | 0 / 22 | **0 / 22** |
| Duplicate navigation links | 175 | **0** |
| Unreachable pages | 2 | **0** |
| Pages capped for a laptop | 11 | **0** |
| Worst page | 12.46 screens | one screen |

Test suite: 59/59 green, including the new `test/ui-shell.test.js` ratchet.

---

## 7. Institutional Recommendation

The navigation defect was possible because the page list had no owner — it lived in
twenty-one places, so it was maintained in none. The scrolling defect was possible
because "does this page fit" was never measured; it was judged on the machine that
happened to be in front of whoever wrote the page.

**Recommendation:** anything duplicated across pages (navigation, tokens, the shell)
gets exactly one owning file and a ratchet test that fails when a second copy
appears. And any layout claim — fits, does not scroll, is readable — is a
measurement at the target viewport, not an opinion. The harness used here lives in
the session scratchpad; promoting it to a checked-in script would make the claim
reproducible by anyone, and that is the natural next step.
