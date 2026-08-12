# 058 — The Full Stock View, and the Instrument Lie It Uncovered

**Date:** 2026-07-29 · **Status:** built, tested, live-verified
**Suites:** 70/70 green (was 67/68) · **New modules:** `instrument-guard.js`, `stock-technicals.js`
**New page:** `public/stock.html`

This document is self-contained. It states what was measured, what was built, and
what is still unavailable — with the evidence grade of each claim.

---

## 0. Evidence grades used below

| Grade | Meaning |
|---|---|
| **Verified** | Observed directly, on the live system, and reproduced |
| **Measured** | Produced by a test or instrument in this repo |
| **Estimated** | Reasoned from partial evidence |
| **Opinion** | A judgement call, held loosely |
| **Unknown** | Not established — and left that way |

Grades are never merged. A Verified number and an Estimated one are not averaged
into a single figure.

---

# Part 1 — A live endpoint was answering with the wrong instrument

## 1.1 What was found

While probing what data was available for a stock view, this came back from the
running server:

```
GET /api/options/snapshot?instrument=TMPV
→ { "instrument": "TMPV", "spotPrice": 77654.6, ... }
```

**77654.6 is SENSEX.** TMPV traded at ₹329.80 that day.

Three different inputs were tried. All three returned the same number, each
labelled with the name that had been asked for:

| Asked for | Answered with | Labelled |
|---|---|---|
| `TMPV` | 77654.6 (SENSEX) | `"instrument": "TMPV"` |
| `RELIANCE` | 77654.6 (SENSEX) | `"instrument": "RELIANCE"` |
| `NOTAREALTHING` | 77654.6 (SENSEX) | `"instrument": "NOTAREALTHING"` |

**Grade: Verified.** Reproduced against the live process before any change was made.

## 1.2 The cause

One line in `server.js`:

```js
function getInstrumentMeta(inst = 'SENSEX') {
  return INSTRUMENT_META[String(inst || 'SENSEX').toUpperCase()]
      || INSTRUMENT_META.SENSEX;          // ← any unknown name becomes SENSEX
}
```

A missing value replaced by a plausible one. This is the exact failure class the
project rejects everywhere else — the same class as `null` becoming `0`.

## 1.3 Why it is worse than an error

An error stops something. This did not. The response was well-formed, had a
200 status, and carried a name that did not match its contents. Nothing
downstream — a chart, a sizing call, a person reading a screen — had any way to
detect it.

## 1.4 It was reachable in ordinary operation

`TATAMOTORS.NS` stopped resolving when Tata Motors demerged into TMPV. **An
exchange renaming a symbol is exactly how a name nobody typed by hand arrives at
this lookup.** This was not a hypothetical hostile input.

**Grade: Verified** — the rename is the reason the probe used TMPV at all.

## 1.5 The fix

A new module, `instrument-guard.js`, with two halves, because there are two ways in.

**a. One middleware at the HTTP boundary.**

```js
app.use('/api', instrumentGuard.guard({ known: Object.keys(INSTRUMENT_META) }));
```

Mounted after `INSTRUMENT_META` is defined — so the guard's list of valid names
and the table it guards are the same list and cannot drift — and before every
route.

*Why one middleware and not 42 patches:* 42 handlers read an instrument
parameter, in 8 different code shapes. Patching each is a sweep that silently
misses the forty-third. One mount covers every route added after today without
any of them being edited.

**b. A strict resolver.**

```js
function getInstrumentMeta(inst = 'SENSEX') {
  return instrumentGuard.resolveMeta(INSTRUMENT_META, inst, 'SENSEX');
}
```

Unknown names **throw**. They do not return `null`: all 23 call sites read a
property off the result immediately, so `null` would surface as
`Cannot read properties of null` three frames from the cause. An error naming the
instrument and listing the alternatives is the same failure, said usefully.

## 1.6 What is still deliberately allowed

- **No instrument named at all** → the route's own default. "Named nothing" is a
  real case with a real answer. Only "named something we do not have" was ever a lie.
- **`ALL`**, on the four routes that genuinely aggregate. Switchable per mount.
- **Comma lists** of known names. One bad name fails the whole list.
- **Repeated parameters** (`?inst=NIFTY&inst=TMPV`) arrive as an array and are
  still checked — an array was the easiest way to walk past a name check.

## 1.7 Verified after the fix, on the live server

```
TMPV           → 400  REFUSED · asked=TMPV · supported=SENSEX,NIFTY,BANKNIFTY,ALL
RELIANCE       → 400  REFUSED · asked=RELIANCE
NOTAREALTHING  → 400  REFUSED · asked=NOTAREALTHING
NIFTY          → 200  instrument=NIFTY   spotPrice=24250.2
SENSEX         → 200  instrument=SENSEX  spotPrice=77654.6
```

**Grade: Verified.** Server restarted; the four checks above were run against it.

**Test:** `test/instrument-guard.test.js`, 31 checks. Proven **RED** before the
fix and green after. It does not `require('server.js')` — that file calls
`app.listen()` at the top level, so importing it in a test would start a second
bot on the live port.

---

# Part 2 — The full stock view

## 2.1 The request

Clicking any stock should open everything a broker shows, for all stocks.

## 2.2 What was measured before anything was built

Availability was tested against the vendor for **three deliberately different
issuer shapes**, because one lucky symbol proves nothing:

- **TMPV** — a 2026 demerger
- **TCS** — an IT major
- **CANBK** — a state-owned bank

| Module | TMPV | TCS | CANBK |
|---|---|---|---|
| `assetProfile` | 25/25 fields | 27/27 | 20/20 |
| `calendarEvents` | ✓ | ✓ | ✓ |
| `recommendationTrend` | 25 ratings | 42 | 19 |
| `majorHoldersBreakdown` | ✓ | ✓ | ✓ |
| `insiderHolders` | 1 row | **0 rows** | **0 rows** |
| `netSharePurchaseActivity` | 10/10 | 10/10 | 10/10 |
| `earningsTrend` | 4 rows | 4 | 4 |
| daily bars (`chart`) | 500 | 500 | 500 |
| peers | 5 | 5 | 5 |

**Grade: Measured**, 2026-07-29.

Two things came back empty and are **not** presented as panels: `fundOwnership`
(top mutual funds — 0 rows) and `upgradeDowngradeHistory` (the call fails).

## 2.3 What was built

**`public/stock.html`** — six tabs, one screen, dashboard palette, shared rail
and viewport fitter.

| Tab | Contents |
|---|---|
| **Overview** | Price, day and 52-week position bars, snapshot stats, calendar (results / ex-dividend), company profile, this system's verdict, performance table |
| **Technical** | SMA/EMA 20·50·200, price vs each, RSI(14) with zone, MACD 12/26/9 with cross, 52-week band, ATR, 30-day volatility, performance, volume vs average, trend with its denominator |
| **Fundamental** | Valuation, per-share, returns and margins, growth, balance sheet, dividend, yearly and quarterly results, quarterly EPS vs estimate |
| **Ownership & Analysts** | Shareholding split, analyst buy/hold/sell distribution, price targets, insider activity, forward estimates, similar stocks |
| **News** | Headlines with sentiment, deal-class events |
| **Not available** | The seven panels this system cannot fill, and why |

**`stock-technicals.js`** — pure indicator arithmetic. No network, no clock, no
state, so every number is checkable against a worked example.

**`/api/agents/stock?q=…&deep=1`** — the deep payload. Off by default.

## 2.4 Clicking a stock

Every ticker in `agents.html` is now a real `<a>` pointing at
`/stock.html?q=SYMBOL`, so middle-click and open-in-new-tab work. The analyst
card header and the hedge columns link there too, and peer chips on the page
itself open one another.

## 2.5 Cost, and why the fast path is untouched

The agents pipeline polls `analyze()` on a timer and renders none of the deep
panels. So:

- The card path asks for **4** vendor modules, as before.
- The deep path asks for **11 in the same single request**, plus two further
  calls (chart, peers) run **concurrently**, not in sequence.
- The **cache key carries the depth**. Without that, a card-depth result cached
  by the pipeline would be served to the full view, which would render every deep
  panel as "not reported" for 30 seconds — a data outage that is really a cache
  collision.

**Measured, live:** TMPV 937 ms · TCS 759 ms · 8.5–10.6 KB.
Fast path verified unchanged: `depth=card`, `technicals` absent, `notAvailable` absent.

---

# Part 3 — The subtlest defect: a corporate action read as a price move

## 3.1 What was found

TMPV's daily series contains a single close-to-close move of **−40.2% on
14 Oct 2025** (660.8 → 395.5). That is the Tata Motors demerger. TCS's worst day
over the same window is **−8.4%**, a real move.

**Grade: Verified**, by scanning both series.

## 3.2 What that produced, before the guard

| Figure | Before | Truth |
|---|---|---|
| 200-day average | **362.35** | Blended pre- and post-demerger prices — describes no company that exists |
| 1-year return | **−52.92%** | A corporate action, presented as shareholders losing half their money |
| Position in 52-week range | **7.9%** | Measured against a ₹660 high this share was never at |
| Trend | DOWN on **3 of 3** | One of the three checks used a fabricated average |

Every one of those numbers was **arithmetically correct**.

## 3.3 The rule now applied

Indian equities carry exchange circuit limits — 20% for most scrips, tighter for
many. **A close-to-close move beyond 25% therefore cannot be a price move.** It
is a split, a bonus, a demerger or a vendor error. All of those mean the same
thing for the arithmetic: the series before that date is not comparable with the
series after it.

Any window reaching past the most recent such break is **left blank**, and the
page says why.

## 3.4 After

| Figure | After |
|---|---|
| 200-day average | **blank**, with the reason named |
| 1-year return | **blank** |
| Position in 52-week range | **27.8%** — from the comparable stretch |
| Trend | DOWN on **2 of 3**, and it says 2 |
| 1-month return, 50-DMA, RSI | **still shown** — they do not span the break |

TCS and CANBK are unaffected: no break, every window kept.

**Grade: Verified**, before and after, on live data.

---

# Part 4 — What this system still cannot show, and why

Listed on the page's own last tab, and returned by the API rather than typed into
the HTML where it would drift.

| Panel a broker shows | Why it is not here |
|---|---|
| Market depth (bid/ask ladder) | Exchange Level-2 feed — a broker terminal entitlement, not in a market-data vendor's API |
| Delivery percentage | Published by NSE/BSE in end-of-day bhavcopy, not carried by this vendor |
| Circuit limits (LCL / UCL) | Exchange band file; not in the quote feed |
| SEBI shareholding pattern (promoter / FII / DII / public) | Filed quarterly with the exchanges. The vendor's insiders/institutions split is a different, US-shaped measure — shown, and labelled as such |
| Top mutual funds invested | Vendor returned **zero rows** for Indian issuers when measured |
| ROCE, EV / capital employed | Needs capital-employed line items the vendor stopped returning in Nov 2024 |
| Analyst upgrade / downgrade history | Vendor endpoint fails for Indian issuers |

**Why name them at all.** A page showing nine panels where a broker shows sixteen
invites the reader to assume the other seven were checked and found empty. Naming
them says the opposite: they were never available, and here is where they would
have to come from.

---

# Part 5 — Rules the page enforces

1. **A blank means "not reported". It never means zero.** The numeric test rejects
   `null` and `undefined` and **accepts** `0`. A bank reporting a 0% gross margin
   and a bank not reporting one are different facts and look different.
2. **Opinion is badged as opinion.** Analyst ratings and price targets carry an
   `opinion` tag; forward estimates carry `forecast`; a derived ROE carries
   `derived` and is never merged with a reported one.
3. **The verdict is not fed by any of it.** The card states outright that
   fundamentals, ratings and technicals are context, not inputs to the probability.
4. **An empty insider list reads as "none filed"**, not as a loading failure —
   measured, it is the normal case for Indian issuers.
5. **Everything from the network is escaped** before it reaches the DOM.

---

# Part 6 — Verification performed

| Check | Result |
|---|---|
| Full suite | **70/70 suites green** (was 67/68) |
| `instrument-guard.test.js` | 31 checks · proven RED before the fix |
| `stock-technicals.test.js` | 65 checks · RSI and EMA against published worked examples |
| `stock-view-ui.test.js` | 50 checks |
| Live guard behaviour | 3 unknown instruments refused, 2 known ones served |
| Live deep endpoint | TMPV, TCS verified; fast path verified unchanged |
| Page scroll, real data, 2560×1330 | **0 px on all 6 tabs, both symbols** |
| Dominant font size | 14 px, root 16 px — passes the ≥13 px ratchet |
| Sub-11px elements | reduced 22 → 9 after enlarging every caption |
| Browser console | no page errors (one pre-existing `favicon.ico` 404, present on every page) |

---

# Part 7 — Open items, recorded not hidden

| Item | Grade | Note |
|---|---|---|
| The `insiderHolders` panel is usually empty for Indian issuers | Measured | Handled, labelled — not a defect |
| 112 silent catches elsewhere in the repo | Measured, latent | None fired under a verified instrument; unchanged by this work |
| `bt-real.js` has no premium floor | Measured | Unrelated to this work; still open |
| 16 `bt-*` scripts lack a `require.main` guard | Measured | Still open |
| Poll cadences across pages are uncoordinated | Measured | Withdrawn as a build item earlier — 262 req/min costs 3.2% CPU, p95 3 ms |
| Hero-zero base rate | **Unknown** | Still gated on 20 clean sessions |

---

## The one-line summary

> An endpoint was answering "TMPV" with SENSEX's price; it now refuses instead.
> The stock view shows every panel the vendor actually provides, names the seven
> it cannot, and blanks any figure that spans a corporate action rather than
> reporting a demerger as a 53% loss.
