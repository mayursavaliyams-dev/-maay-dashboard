# 065 — Full Work Record

**ANTIGRAVITY PRO · complete detail of everything built and found**
**Session: 2026-07-29 → 2026-07-30**
**Status:** all shipped work is tested and live. All design work is design only.

Every number in this document was measured from the repository or the running
server. Nothing is recalled or estimated unless it says so.

---

## 0. The one-screen summary

| | |
|---|---|
| Files changed | **31** |
| Lines added | **7,205** (31 removed) |
| New modules | 4 — `instrument-guard.js`, `stock-technicals.js`, `stock-universe.js`, `public/js/ticker.js` |
| New pages | 2 — `stock.html`, `universe.html` |
| New design documents | 6 — docs/058 – 064 |
| New test suites | 5 · suite went **67 → 72**, all green |
| Live defects found and fixed | **1 critical** (an endpoint answering with the wrong instrument) |
| Data defects found | **3**, all measured, all recorded |
| Things deliberately **not** built | 5, each with the reason |

**Repo now:** 96 modules · 26,499 lines · `server.js` 7,174 · 26 pages · 144 API
routes · 72 test suites · 129 documents.

---

# PART ONE — Shipped work

---

## 1. The instrument lie (critical, live, fixed)

### What was found

While probing what data a stock view could show, the running server answered:

```
GET /api/options/snapshot?instrument=TMPV
→ { "instrument": "TMPV", "spotPrice": 77654.6, ... }
```

**77654.6 is SENSEX.** TMPV traded at ₹329.80.

Three inputs, one answer, each labelled with the name asked for:

| Asked | Answered | Labelled |
|---|---|---|
| `TMPV` | 77654.6 (SENSEX) | `"instrument": "TMPV"` |
| `RELIANCE` | 77654.6 | `"instrument": "RELIANCE"` |
| `NOTAREALTHING` | 77654.6 | `"instrument": "NOTAREALTHING"` |

**Grade: Verified** — reproduced against the live process before any change.

### Cause

One line in `server.js`:

```js
return INSTRUMENT_META[key] || INSTRUMENT_META.SENSEX;   // any unknown name = SENSEX
```

A missing value replaced by a plausible one — the same class as `null → 0`.

### Why it mattered more than it looked

The response was well-formed, HTTP 200, and carried a name that did not match its
contents. Nothing downstream could detect it. And it was reachable in ordinary
operation: `TATAMOTORS.NS` stopped resolving when Tata Motors demerged into TMPV,
and an exchange renaming a symbol is exactly how an unknown name arrives at that
lookup.

### Fix — `instrument-guard.js` (125 lines)

Two halves, because there are two ways in:

1. **One middleware on `/api`**, mounted after `INSTRUMENT_META` is defined so the
   guard's list and the table it guards are the same list.
2. **A strict resolver** — unknown names **throw**, they do not return `null`,
   because all 23 call sites read a property off the result immediately.

Deliberately still allowed: no instrument named at all → the route's default;
`ALL` on the four aggregating routes; comma lists of known names (one bad name
fails the whole list); repeated parameters, which arrive as an array and are
still checked.

**Why one middleware and not 42 patches:** 42 handlers read an instrument
parameter in 8 different code shapes. Patching each is a sweep that misses the
forty-third. One mount covers every route added after today.

### Verified live after the fix

```
TMPV           → 400  REFUSED · supported=SENSEX,NIFTY,BANKNIFTY,ALL
RELIANCE       → 400  REFUSED
NOTAREALTHING  → 400  REFUSED
NIFTY          → 200  instrument=NIFTY   spotPrice=24250.2
SENSEX         → 200  instrument=SENSEX  spotPrice=77654.6
```

**Test:** `test/instrument-guard.test.js`, 31 checks, **proven RED before the fix**.
It does not `require('server.js')` — that file calls `app.listen()` at the top
level, so importing it in a test would start a second bot on the live port.

---

## 2. The full stock view — `public/stock.html` (685 lines)

### What was measured before anything was built

Vendor data availability was tested against **three deliberately different issuer
shapes**, because one lucky symbol proves nothing:

| Module | TMPV (2026 demerger) | TCS (IT major) | CANBK (state bank) |
|---|---|---|---|
| `assetProfile` | 25/25 fields | 27/27 | 20/20 |
| `calendarEvents` | ✓ | ✓ | ✓ |
| `recommendationTrend` | 25 ratings | 42 | 19 |
| `majorHoldersBreakdown` | ✓ | ✓ | ✓ |
| `insiderHolders` | 1 row | **0** | **0** |
| `netSharePurchaseActivity` | 10/10 | 10/10 | 10/10 |
| `earningsTrend` | 4 rows | 4 | 4 |
| daily bars | 500 | 500 | 500 |
| peers | 5 | 5 | 5 |

**Not available and therefore not shown:** `fundOwnership` (top mutual funds — 0
rows for Indian issuers) and `upgradeDowngradeHistory` (the call fails).

### The six tabs

| Tab | Contents |
|---|---|
| **Overview** | Price, day and 52-week position bars, snapshot stats, calendar, company profile, this system's verdict, performance |
| **Technical** | SMA/EMA 20·50·200, price vs each, RSI(14) with zone, MACD 12/26/9 with cross, 52-week band, ATR, 30-day volatility, volume vs average, trend with its denominator |
| **Fundamental** | Valuation, per-share, returns and margins, growth, balance sheet, dividend, yearly and quarterly results, quarterly EPS vs estimate |
| **Ownership & Analysts** | Shareholding split, analyst buy/hold/sell distribution, price targets, insider activity, forward estimates, similar stocks |
| **News** | Headlines with sentiment, deal-class events |
| **Not available** | The seven panels this system cannot fill, and why |

### Cost, and why the fast path is untouched

The agents pipeline polls `analyze()` on a timer and renders none of the deep
panels. So:

- Card path: **4** vendor modules, as before.
- Deep path: **11 in the same single request**, plus two further calls (chart,
  peers) run **concurrently**.
- **The cache key carries the depth.** Without it a card-depth result cached by
  the pipeline would be served to the full view, which would then render every
  deep panel as "not reported" for 30 seconds — a data outage that is really a
  cache collision.

**Measured live:** TMPV 937 ms · TCS 759 ms · 8.5–10.6 KB.
Fast path verified unchanged: `depth=card`, `technicals` absent, `notAvailable` absent.

---

## 3. `stock-technicals.js` (313 lines) — and the subtlest defect of the week

Pure arithmetic over daily bars. No network, no clock, no state, so every number
is checkable against a worked example. **65 checks**, including the published
Wilder RSI series and hand-computed EMA.

### The corporate-action defect

TMPV's daily series contains a single close-to-close move of **−40.2% on
14 Oct 2025** (660.8 → 395.5). That is the Tata Motors demerger. TCS's worst day
over the same window is **−8.4%**, a real move. **Grade: Verified.**

Before the guard, that produced:

| Figure | Before | Truth |
|---|---|---|
| 200-day average | **362.35** | Blended pre- and post-demerger prices — describes no company that exists |
| 1-year return | **−52.92%** | A corporate action, presented as shareholders losing half their money |
| 52-week range position | **7.9%** | Measured against a ₹660 high this share was never at |
| Trend | DOWN on **3 of 3** | One check used a fabricated average |

**Every one of those numbers was arithmetically correct.**

### The rule now applied

Indian equities carry exchange circuit limits — 20% for most scrips. **A
close-to-close move beyond 25% therefore cannot be a price move.** It is a split,
a bonus, a demerger or a vendor error, and all of those mean the series before
that date is not comparable with the series after it.

Any window reaching past the most recent such break is **left blank, and the page
says why**.

### After

| Figure | After |
|---|---|
| 200-day average | **blank**, with the reason named |
| 1-year return | **blank** |
| 52-week position | **27.8%** — from the comparable stretch |
| Trend | DOWN on **2 of 3**, and it says 2 |
| 1-month return, 50-DMA, RSI | **still shown** — they do not span the break |

TCS and CANBK unaffected: no break, every window kept.

### Other rules in the module

- **An indicator with too little history is `null`, never computed from what
  happened to be available.** RSI(14) on 6 bars is a different statistic wearing
  RSI's name.
- EMA is **SMA-seeded**, not seeded on the first close.
- RSI uses **Wilder's smoothing**, not a rolling mean.
- MACD's two EMA series are **tail-aligned** before subtracting — subtracting from
  the front pairs different dates.
- RSI is withheld below 28 bars, because between 15 and 28 it is dominated by its
  seed and will be read as overbought or oversold.

---

## 4. The index ticker — `public/js/ticker.js` (212 lines)

Six indices on every page, small type, live, with an EXPIRY badge on whichever
expires today.

```
NIFTY 24,290.70 ▲ +40.50 (+0.17%)   BANKNIFTY 57,036.50 ▼ 169.40 (−0.30%)
SENSEX EXPIRY 77,789.73 ▲ +135.13    FINNIFTY WATCH 26,186.25 ▼ 100.85
MIDCPNIFTY WATCH 14,697.85 ▲ +14.80  BANKEX EXPIRY WATCH 64,670.45 ▼ 218.70
```

### The key that would have shipped wrong

Only 3 indices had prices before this. The other 3 were tested against the live
broker rather than assumed, and **FINNIFTY does not resolve under the obvious
key**:

| Key | Result |
|---|---|
| `NSE_INDEX\|Nifty Fin Services` | **nothing** |
| `NSE_INDEX\|Nifty Financial Services` | **nothing** |
| `NSE_INDEX\|Nifty Fin Service` *(singular)* | **26,196** ✓ |

**The registry already held the correct one**, because it was built from the
broker's contract master. So the endpoint reads the registry and no broker key is
typed into `server.js` — the test asserts that too.

### Three rules it keeps

1. **One broker call for all six**, server-cached. Six indices × a 5-second poll ×
   every open tab is the traffic shape that produced 458 rate-limit refusals
   before the connector took over its own call rate.
2. **The change comes from `net_change`, not from `ohlc.close`.** For an index the
   `ohlc.close` is *today's* close — measured, it came back equal to `last_price`
   for all six — so a change derived from it would be zero all day.
3. **A missing price is a dash, never a zero**, and a partial feed says "4 of 6
   quoted". A row of zeros reads as a calm market, not a broken feed.

### `WATCH` — the honesty marker

FINNIFTY, MIDCPNIFTY and BANKEX have prices but **no engine here trades them**.
A price beside a name otherwise implies the system acts on it.

### Polling discipline

Nothing is fetched when the tab is hidden, the strip is collapsed, the market is
closed, or it is a weekend. The last values stay on screen rather than blanking,
because the last close is still true.

### The two pages it broke, and the general fix

Adding a 30 px strip made `heatmap.html` scroll 10 px and `signals4.html` 146 px.

- The strip now publishes its height as `--agtk-h`, so a page written as
  `calc(100vh - 90px)` can subtract it — and the value goes to 0 when collapsed.
- `signals4.html` had **no** `fit.js` at all; its height is data-driven (four
  engine tables whose row counts change through the session), so it fit the screen
  by luck rather than by design. It now uses the project's own standard.

**24/24 pages measured back to zero scroll at 2560×1330.**

---

## 5. The stock universe — 49 → **5,798** listed equities

### The reported defect

Typing `consumer` returned *"could not resolve 'consumer' to a listed stock"*. The
box could resolve 49 hand-listed symbols.

### The obvious fix, measured and rejected

The market-data vendor's own search endpoint:

| Query | Result |
|---|---|
| `"rel"` | 7 results, **0 Indian** — no RELIANCE |
| `"hdf"` | 7 results, **0 Indian** — no HDFCBANK |
| `"sun"` | 7 results, **0 Indian** — no SUNPHARMA |
| `"consumer"` | 7 results, **0 Indian** |

US-biased and unusable. Shipping it would have produced a search box that looked
fixed and failed on the three largest companies anyone would type.

### The source used instead

The **broker's own instrument master** — the same class of source the instrument
registry is built from.

### Two filtering traps, both able to look like a successful build

**BSE does not mark equities `EQ`.** It puts the settlement group there (A, B, T,
X, XT, M, …) and its `BSE_EQ` segment also carries **6,525 bonds** and **1,120
government securities**. Filtering BSE on `instrument_type === 'EQ'` returns
**zero rows** — which the first version of the builder did, printing a clean
successful build with no BSE stocks in it.

**NSE's equity segment holds 9,454 rows of which only 2,412 are `EQ`.** Filtering
on `EQ` alone drops:

| Group | Count | What it is |
|---|---|---|
| SM | 402 | SME board equity |
| BE | 286 | Trade-to-trade equity |
| ST | 156 | SME trade-to-trade |
| **BZ** | **26** | Suspended / blocked — **SANWARIA CONSUMER LIMITED lives here** |
| IV | 21 | Listed InvITs |
| RR | 6 | Listed REITs |
| IT / E1 | 5 | Equity, partly-paid shares |

That fourth row is not academic: the search that started this work was the word
*consumer*.

**Both filters are allowlists, not denylists**, and the builder prints what it
excluded. A denylist would let a new debt group appearing tomorrow flood a stock
search with bonds.

### The final universe

| | |
|---|---|
| **Total** | **5,798** |
| NSE | 3,314 |
| BSE (not already on NSE) | 2,484 |
| With listed derivatives | **208** |

Excluded and named: 6,525 BSE bonds, 4,289 NSE state development loans, 1,250
G-secs, 81 T-bills, 45 sovereign gold bonds, ~1,300 corporate bond series. A stock
search that answers *"IRFC 7.37% 2029 SR 181"* is a worse search.

### Ranking was the rest of the problem

Matching is trivial; ordering is not. A plain substring match sorted
alphabetically answered `"rel"` with **"Avax Apparels and Ornaments"** above
RELIANCE — every result correct, the list useless.

**The signal used:** whether the stock has **listed derivatives** — 208 of 5,798.
The exchange admits a stock to F&O on measured turnover and delivery criteria, so
this is the market's own liquidity judgement, and it was already present in the
instrument master.

| Query | Before | After |
|---|---|---|
| `rel` | RELTD, RELAXO, RELCHEMQ, RELIABLE… | **RELIANCE** |
| `sun` | SUNTV, SUNCLAY, SUNDROP… (no SUNPHARMA in top 5) | **SUNPHARMA** |
| `tat` | TATVA, BGWTATO… | **TATAELXSI, TATAPOWER, TATASTEEL** |
| `consumer` | *(nothing)* | GODREJCP, TATACONSUM, HONASA… |

It is stated as a **proxy for prominence, not a measure of quality**, and it only
orders equally-good textual matches — the tier is always compared first, so it
never promotes a worse match above a better one.

### The dropdown

Opens on the **first character**. ↓ ↑ to move, Enter to open, Esc to dismiss,
click also works. Announced to screen readers.

Two details that matter:

- **Out-of-order replies are discarded.** A slow response would otherwise repaint
  the list for a query the reader has already typed past.
- **Selection is on `mousedown`**, because the input's blur would close the list
  before a click could land.
- The footer says **"showing 20 of 4190"**. Showing 20 and implying that is all of
  them is a quiet lie.

### Resolution will not guess

`stock-analyst.js` resolves an exact symbol through the universe, but accepts a
typed *name* only when the match is unambiguous — a single result, an exact symbol,
or a clear tier separation. **Taking the top of a 38-result list would silently
open a stock nobody asked for**, which is worse than saying nothing.

### The universe page — `public/universe.html`

Browsable, filterable, exportable. Breakdown chips (NSE / BSE / With F&O / each
board), name and symbol filter, CSV export.

**The board column is the point of the page.** A "stock" on this list can be a
main-board company, an SME listing, a trade-to-trade scrip, a suspended one, a
REIT or an InvIT — materially different things. A flat list of 5,798 names with no
board column would imply they are all the same kind of instrument.

Two things fixed after measuring the rendered page: two chips read identically
(`NSE · SME T2T` and `BSE · SME T2T`), and the default alphabetical order opened
the page on *"08ABB · Nippon India Mutual Fund"* — correct, and useless as a first
screen. Now ordered by prominence.

**CSV exports what is filtered, not what is painted.** Exporting 500 rows while
the header says 5,798 is a file that quietly disagrees with the screen.

---

# PART TWO — Design work (no production code)

Five documents, all design only, all grounded in measurements taken during the
session.

| Doc | Subject | The finding that governed it |
|---|---|---|
| **059** | Navigation architecture for 100+ modules | **94 of 95 modules are invisible from the menu**, and no mechanism would notice a 96th. The fix is not a bigger menu — it is a registry each module writes into itself, and a build that fails when a module declares nothing |
| **060** | Strike volatility analysis | Of 19 requested metrics: **9 computable, 3 degraded, 6 blocked, 1 impossible**. One tick is **3.7% of a ₹1.35 option**; 70 of 662 strikes never moved; premium moves mostly because the index moved, so ranking by raw premium volatility re-derives delta |
| **061** | Strike lifecycle engine | Birth happens at the open, and **12 of 13 sessions have no open**. A strike's life is a contract, not an organism — without expiry-relative time every curve is the expiry calendar |
| **062** | Market gravity engine | OI concentrates near spot, so *"price is near the OI wall"* is **true by construction**. Needs a moneyness-matched, round-number-controlled null. The dealer sign is **assumed, not measured**, and getting it wrong turns a magnet into a repellent |
| **063** | 100-task research programme | 39 tasks need no data and start today; **61 wait on data being discarded**; every citation marked `NOT_RETRIEVED` because none could be verified from here |
| **064** | What is in the bot | The single master file — nine strategies, what runs, what the evidence says |

---

# PART THREE — What was found and not fixed

## The data foundation — the largest finding of the session

Three independent design exercises pointed at the same place.

| Fact | Grade |
|---|---|
| **12 of 13 archived sessions are missing the market open** (61–358 minutes each) | **Measured** |
| Complete sessions | **1** — 2026-07-08 |
| Cause: the collector was not running. The restart fix landed 2026-07-28; today's collector started 11:50 against a first sample at 11:45 | **Verified** timeline, **Estimated** attribution |
| Stored per strike | `[t, o, h, l, c]` — **premium only** |
| IV, OI, volume, depth, greeks stored | **None** — observed live, discarded daily |
| Index spot price history | **None** — `candles.json`, `prices.json` are 0 KB |
| Retention | Auto-deleted past **40 files** |
| Sampling | 60 s nominal, **86.2 s mean, 2,520 s (42 min) maximum gap** |
| Chain observed | A **±10% window**, not the listed universe |

**The asymmetry that decides the work order:** price history can be re-fetched
from the broker. **Option-chain state cannot.** Where the OI walls stood at 11:00
last Tuesday is gone permanently.

**Consequence:** 61 of the 100 research tasks depend on data not currently kept.

## The three cheapest, highest-value fixes

| # | Fix | Why first |
|---|---|---|
| **1** | Collector runs 09:15–15:30 every session, with an alert below 95% coverage | Unblocks 61 research tasks. Costs almost nothing. Every deferred day is permanently absent from the future evidence base |
| **2** | Persist the index spot series and per-strike `iv/oi/volume/depth/greeks` | Observed live and thrown away; unreconstructable afterwards |
| **3** | Lift the 40-file retention cap | Otherwise the archive erases itself faster than a year of sessions accumulates, so IV Rank is permanently out of reach |

---

# PART FOUR — What was deliberately not built

Recorded so these read as decisions, not oversights.

| Not built | Why |
|---|---|
| **Participant classification** (institutional vs retail) | No client-type field exists in any obtainable Indian source. Every heuristic — round strikes, large lots — is folklore. Replaced with `POSITION_HELD` / `TURNOVER_DOMINATED`, which describe **flow behaviour, not identity** |
| **Live "Climax" / "Exhaustion" labels** | A maximum is only knowable after it has been exceeded-and-not-exceeded. A live peak call is a **forecast** in a measurement engine's clothing |
| **Live "Historical Accuracy"** for gravity zones | "Accuracy of what?" — if it means *did price reach the zone*, the engine is scoring a forecast. Redefined as an ex-post residence statistic against a matched baseline, shown only on completed sessions |
| **Max pain inside a composite score** | No credible peer-reviewed support. Kept, labelled Opinion, and excluded from any composite — otherwise it borrows the credibility of the inputs beside it |
| **A twelfth top-level navigation section** | The section count is fixed at 11 by design. Needing a twelfth is the signal to revisit the document, not to add one |

---

# PART FIVE — Verification performed

| Check | Result |
|---|---|
| Full suite | **72/72 green** (was 67/68 at the start) |
| `instrument-guard.test.js` | 31 checks · **proven RED before the fix** |
| `stock-technicals.test.js` | 65 checks · RSI and EMA against published worked examples |
| `stock-view-ui.test.js` | 50 checks |
| `index-ticker.test.js` | 51 checks |
| `stock-universe.test.js` | 49 checks |
| Live guard behaviour | 3 unknown instruments refused, 2 known served |
| Live deep stock endpoint | TMPV and TCS verified; fast path verified unchanged |
| Live index endpoint | 6 of 6 quoted; expiry badge verified against the real IST weekday |
| Page scroll, real data, 2560×1330 | **0 px on every page**, all six stock tabs, both symbols |
| Dominant font size | 14 px, root 16 px — passes the ≥13 px ratchet |
| Silent-catch ratchet | held at 112 — two new empty catches were caught and rewritten |
| Browser console | no page errors (one pre-existing `favicon.ico` 404, present on every page) |

### One ratchet that caught me

Adding two `catch (e) {}` blocks to `ticker.js` pushed the silent-catch count past
its ratchet of 112 and failed the build. The rule is correct and the fix was to
follow `rail.js`'s existing pattern — record that storage is unavailable and stop
trying — rather than to move the ratchet.

---

# PART SIX — Every file changed

**31 files · 7,205 insertions · 31 deletions**

### New modules
| File | Lines | Purpose |
|---|---|---|
| `instrument-guard.js` | 125 | Refuse an unknown instrument rather than substituting SENSEX |
| `stock-technicals.js` | 313 | Indicators from daily bars, with corporate-action detection |
| `stock-universe.js` | 162 | Search 5,798 listed equities, ranked |
| `public/js/ticker.js` | 212 | The six-index strip on every page |
| `scripts/build-stock-universe.js` | 212 | Build the universe from the broker instrument master |

### New pages
| File | Lines |
|---|---|
| `public/stock.html` | 685 |
| `public/universe.html` | 230 |

### New tests
| File | Lines | Checks |
|---|---|---|
| `test/instrument-guard.test.js` | 139 | 31 |
| `test/stock-technicals.test.js` | 191 | 65 |
| `test/stock-view-ui.test.js` | 164 | 50 |
| `test/index-ticker.test.js` | 171 | 51 |
| `test/stock-universe.test.js` | 177 | 49 |

### Modified
| File | Change |
|---|---|
| `server.js` | +136 — instrument guard mount, `/api/indices`, `/api/stock/search`, universe endpoints, deep stock mode |
| `stock-analyst.js` | +241 — deep panels, technicals, peers, universe resolution |
| `upstox-connector.js` | +41 — batched `getIndexQuotes` |
| `public/js/rail.js` | +26 — Stock View, Stock Universe, doc pages, ticker loader |
| `public/agents.html` | +19 — tickers link to the full stock view |
| `public/help.html` | +14 — three more documents readable in the bot |
| `public/signals4.html` | +9 — bounded by `fit.js` |
| `public/heatmap.html` | +6 — subtracts the ticker height |
| `test/stock-fundamentals.test.js` | +22 — updated for the deep module list |
| `package.json` | +1 — `npm run build:universe` |

### New documents
`docs/058` through `docs/064` — 3,936 lines.

### New data
`data/stock-universe.json` — 5,798 symbols, 546 KB, rebuildable with
`npm run build:universe`.

---

## The through-line

Six of the defects in this record share one shape: **a number that is correct and
false at the same time.**

- SENSEX's price labelled TMPV.
- A 200-day average that blends two different companies.
- A −52.92% return that describes a demerger as a loss.
- A volatility ranking that re-derives delta.
- A "most stable strike" that nobody has traded.
- A search that answers "rel" without RELIANCE.

None of them throws. None of them logs. Each looks like an answer, and each would
be believed. That is why almost every test written this session asserts that
something is **blank, refused, or explicitly Unknown** — the blanks are the part
that is hard to get right, and the part that makes the numbers beside them worth
reading.

**Nothing here has traded real money. The forward-test gate is still at 22 of 30.**
