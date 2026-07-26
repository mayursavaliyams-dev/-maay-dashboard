# 006 — MARKET DATA ENGINE, DATA INTEGRITY & INGESTION ARCHITECTURE

**Standard:** Master Prompt 006 · **Depends on:** 000-A…E, 001-A…F, 002…005
**Date:** 2026-07-12 · **Suite:** 48/48 green
**Mode:** **READ-ONLY. No ingestion logic modified. No provider changed. No parser rewritten.**

---

# SECTION 0 — THE HEADLINE

> ## 🔴 **THE PLATFORM'S OWN FIRST RULE IS BROKEN 119 TIMES IN THE DATA LAYER.**

**000-A, Rule: *"Unknown ≠ Zero. null ≠ 0. Fail closed. Refuse rather than guess."***

**Measured across the non-backtest source: 119 sites where an unknown market value silently becomes a
number.**

```js
free-chain.js:132   oi:     Number(leg.openInterest      || 0),   // a MISSING OI becomes ZERO OI
free-chain.js:134   iv:     Number(leg.impliedVolatility || 0),   // a MISSING IV becomes ZERO VOLATILITY
free-chain.js:126   ltp:    Number(leg.lastPrice         || 0),   // an UNTRADED strike becomes FREE
gex-skew.js:49      ivCe = Number(row.ceIV) || Number(p.iv) || 0.14;   // a MISSING IV becomes a FABRICATED 14%
```

**These are not equivalent errors. They are different lies:**

| Value | What `|| 0` says | What is true |
|---|---|---|
| **`oi: 0`** | *"No one holds this strike"* | **"We do not know."** A zero-OI strike is excluded from GEX and max-pain — **silently reweighting every number built on the chain** |
| **`iv: 0`** | *"This option has zero volatility"* | **"We do not know."** Zero IV in a Black-Scholes gamma is a **division by zero** guarded by `if (sigma > 0) return 0` — so the strike's gamma silently becomes **0** |
| **`ltp: 0`** | *"This option is free"* | **"It did not trade."** |
| **`iv || 0.14`** | *"Volatility is 14%"* | **"We invented it."** 🔴 **This is a fabricated market observation, in a live scoring path** |

> **`gex-skew.js:49-50` does not merely lose information — it manufactures it.** A strike with no
> observed IV is assigned **14%**, and that number flows into the dealer-gamma profile shown on the
> dashboard. **000-A: *"Never invent market behaviour."***

---

# PART 1 — MARKET DATA INVENTORY

| # | Source | Provider | Coverage | Frequency | Format | Owner | Reliability | Conf |
|---|---|---|---|---|---|---|---|---|
| 1 | **NSE UDiFF bhavcopy** | `nsearchives.nseindia.com` | NIFTY + 5 F&O symbols, **600 days** (2024-01-08 → 2026-06-17) | manual, daily | CSV (zip) | `bt-bhav-fetch.js` | 🟢 **HIGHEST — the exchange's own file** | HIGH |
| 2 | **Dhan REST** | `api.dhan.co` | quotes, chain, candles | polled | JSON | `dhan-client.js` | 🟡 rate-limited (429s handled) | HIGH |
| 3 | **Dhan WebSocket** | `dhan-ws-feed.js` | ticks | stream | binary | `dhan-ws-feed.js` | 🟡 **the only module with `clearInterval` (2)** | HIGH |
| 4 | **Upstox REST** | `api.upstox.com` | historical candles, instruments | polled | JSON | `upstox-connector.js` | 🟡 **no retry** | HIGH |
| 5 | **Sensibull** | `api.sensibull.com`, `web.sensibull.com` | option chain | polled | JSON | `free-chain.js`, `sensibull-fetcher.js` | 🔴 **unofficial / scraped** | MEDIUM |
| 6 | **NSE web** | `www.nseindia.com` | option chain (cookie-jar) | polled | JSON | `free-chain.js` | 🔴 **scraped; needs a cookie handshake** | MEDIUM |
| 7 | **Yahoo (implied)** | — | VIX, spot fallback | polled | JSON | `server.js:372-384`, `event-engine.js:76` | 🟡 fallback only | MEDIUM |
| 8 | **News** | moneycontrol · livemint · business-standard · economictimes | headlines | polled | HTML/RSS | `news-engine.js` | 🔴 scraped | LOW |
| 9 | **Anthropic** | `api.anthropic.com` | LLM (not market data) | on demand | JSON | `pine-converter.js`, `claude-ai.js` | — | HIGH |
| 10 | **Kotak Neo** | — | — | — | — | `kotak-neo-connector.js` — **17-LOC stub** | ⚪ **DEAD** | HIGH |
| 11 | 🔴 **`encoding-pierce-season-edwards.trycloudflare.com`** | **a Cloudflare tunnel** | ? | ? | ? | `preflight.js` | 🔴 **UNKNOWN — an ephemeral tunnel URL hardcoded in the source** | **UNKNOWN** |

## Derived datasets

| Dataset | Built from | Storage | Coverage |
|---|---|---|---|
| Option high/low | live chain | `data/opt-hl/` | date-wise archive |
| Option candles | live chain | `data/opt-candles/` | **1 complete session (2026-07-08, 375 min)** |
| GEX / VIX history | chain + VIX | `data/gex-vix-history.json` | 15 entries |
| Strangle IV | chain | `data/strangle-iv.json` | 12 entries |
| 🔴 **VRP monitor** | — | `data/vrp-monitor.json` | **EMPTY (0 entries)** |

### Connector maturity

| Module | LOC | WS | Cache | Retry | Timeout |
|---|---|---|---|---|---|
| `dhan-client.js` | 356 | — | 🟢 | 🟢 | 🟢 |
| `dhan-ws-feed.js` | 243 | 🟢 | — | 🟢 | 🟢 |
| `upstox-connector.js` | 216 | — | 🟢 | 🔴 | 🟢 |
| `free-chain.js` | 193 | — | 🟢 | 🔴 | 🟢 |
| `sensibull-fetcher.js` | 119 | — | 🟢 | 🔴 | 🟢 |
| 🔴 **`live-connector.js`** | **460** | 🟢 | 🟢 | 🔴 | 🔴 **NO TIMEOUT** |
| `kotak-neo-connector.js` | 17 | — | — | — | — |

> 🔴 **`live-connector.js` — 460 lines, the primary live path, and it has neither a retry policy nor a
> timeout.** A hung broker socket has no bounded failure.

**There is no `MarketDataPort`. Six connectors, six shapes, no interface.** *(003 §3.5.)*

---

# PART 2 — INGESTION PIPELINE

```
 ┌── LIVE ────────────────────────────────────────────────────────────────────┐
 │ Dhan REST ─┐                                                               │
 │ Dhan WS   ─┤                                                               │
 │ Upstox    ─┼─▶ connector (6, no shared interface)                          │
 │ Sensibull ─┤        ↓                                                      │
 │ NSE web   ─┤   PARSE  ── 🔴 `Number(x || 0)` × 119                         │
 │ Yahoo     ─┘        ↓        UNKNOWN silently becomes 0                    │
 │                VALIDATE ── 🔴 NONE. No schema. No range check.             │
 │                     ↓                                                      │
 │                NORMALIZE ─ 🟡 partial: strike/expiry mapped;               │
 │                     ↓        🔴 oiUnit NEVER declared                      │
 │                 CACHE ──── 🟢 TTL 5 s (price) / 3 min (Yahoo) / per-source  │
 │                     ↓                                                      │
 │                 GLOBALS ── 🔴 62 mutable vars in server.js                 │
 │                     ↓                                                      │
 │                CONSUMERS ─ engines · analytics · GEX · dashboard           │
 └────────────────────────────────────────────────────────────────────────────┘

 ┌── HISTORICAL ──────────────────────────────────────────────────────────────┐
 │ NSE bhavcopy ──▶ bt-bhav-fetch ──▶ bt-data/bhav/*.csv (600 days)            │
 │                                        ↓                                   │
 │                                   bt-lib.loadDay()                         │
 │                                        ↓                                   │
 │                          🟢 lot from column 28 (real, per-day, null-safe)   │
 │                          🔴 `underlying` = column 20 = the CLOSE            │
 │                                        ↓                                   │
 │                            8 strategy scripts + bt-validate                 │
 │                            (bt-validate FIXED in 002; the 8 are NOT)        │
 └────────────────────────────────────────────────────────────────────────────┘
```

## 🔴 **The two pipelines never meet.** *(001-B §1.4.)*

Nothing the backtests learn reaches the engines; nothing the engines observe reaches a backtest.
**There is no feedback loop — which is how a look-ahead bias survived into production.**

---

# PART 3 — DATA QUALITY ASSESSMENT

| Dimension | Verdict | Evidence |
|---|---|---|
| **Completeness (historical)** | 🟢 **EXCELLENT** | 600 days; `SttlmPric` non-zero on **1,804/1,808** rows; `OpnIntrst` on 1,203 |
| **Completeness (live)** | 🔴 **UNMEASURABLE** | **A missing field becomes 0. There is no "missing" count, because nothing is ever missing** |
| **Freshness** | 🟡 **CACHED, NOT VALIDATED** | TTLs exist (`server.js:1240` — 5 s price cache). 🔴 **But no consumer ever asks "is this stale?" before trading on it.** `engine-verdict.js:150` defines a `freshnessMs` field — **and one module publishes it** |
| **Accuracy** | ⚪ **UNKNOWN** | Live chain is **never cross-checked** against the bhavcopy, even though both exist on disk |
| **Consistency** | 🔴 **NO** | 6 connectors, 6 shapes. `free-chain.js` alone has **three different leg parsers** (`:126`, `:168`, `:182`) for three providers |
| **Timestamp integrity** | 🔴 **See Part 4** | |
| **Duplicates** | ⚪ **UNKNOWN** | No dedupe logic found in any connector |
| **Corrupt records** | 🔴 **INVISIBLE** | A corrupt field parses to `0` and flows downstream as data |

### 🔴 The measurement that cannot be taken

> **"How much market data is missing?"** — **UNANSWERABLE.**
> Every missing value has already been converted to a valid-looking `0` before anything could count it.
> **The platform cannot measure its own data quality, because it destroys the evidence at parse time.**

---

# PART 4 — TIMESTAMP INTEGRITY REPORT

| | |
|---|---|
| **Timezone library** | 🔴 **NONE.** No `luxon`, `dayjs`, `moment-timezone`, `date-fns-tz` |
| **Hardcoded IST offsets** | 🔴 **22 literals across 8 files** (`+05:30`, `19800`, `5.5*60`) — **`server.js` alone has 14** |
| **Exchange timestamps** | 🟡 Bhavcopy `TradDt` (date only). **The timezone is never declared, only assumed** |
| **Local timestamps** | 🔴 `new Date()` called inside domain logic. **A suite went red at midnight with no code change** (`pop-seller`, since fixed) |
| **Ordering guarantees** | 🔴 **NONE.** No sequence numbers, no monotonic clock |
| **Out-of-order events** | 🔴 **NOT HANDLED.** WS ticks are applied as they arrive |
| **Clock drift** | 🔴 **ASSUMED ZERO.** The server's clock is trusted absolutely, including for **expiry-day detection** |

## 🔴 Temporal risks

| # | Risk | Evidence |
|---|---|---|
| **T-1** | **The expiry weekday is hardcoded and instrument-blind** | `option-analyzer.js:653-655`: `if (day === 2) return 'WEEKLY_EXPIRY'; // Tuesday` / `if (day === 5) ... // Friday`. **`instrument-registry` owns the expiry weekday — and it is not consulted.** The project's own history records that **NIFTY and SENSEX expiry weekdays were SWAPPED** in `pop-seller`, which moved BANKNIFTY's PoP from 100% to 91.8%. **The same bypass is live here** |
| **T-2** | **Everything is IST by hand** | 22 literals. **One machine in a different timezone and every session boundary, every EOD snapshot and every expiry check is wrong** |
| **T-3** | **`NODE_ENV` is never read** (004) | No dev/prod distinction ⇒ **a test clock cannot be injected globally** |

---

# PART 5 — NORMALIZATION REVIEW

## 🔴 N-1 — `lotSize` is hardcoded in **SIX** places in `server.js`

*(001-C reported **three**. The full measurement finds **six literals**, plus two `|| 65` fallbacks.)*

```
server.js:252    lotSize: 20,       (SENSEX)
server.js:260    lotSize: 65,       (NIFTY)
server.js:3125   lotSize: 20,       (SENSEX engine)
server.js:3290   lotSize: 65,       (NIFTY engine)
server.js:3424   lotSize: 20,       (SENSEX afternoon)
server.js:3483   lotSize: 65,       (NIFTY afternoon)
server.js:3039   niftyEngine?.lotSize || 65      ◀── fallback
server.js:3098   niftyEngine?.lotSize || 65      ◀── fallback
```

**`instrument-registry.js` — broker-verified, fail-closed, Ca=10 — is bypassed eight times.**
**The Phase-0 approval package (B-4) must be widened from 3 sites to 8.**

Also: `bt-nifty-intraday.js:226 const lot = 75` — the F1 defect, still live in a backtest script.

## 🔴 N-2 — `oiUnit` is never declared. Anywhere.

| Fact | Source |
|---|---|
| **NSE bhavcopy OI is in UNITS** | ✅ **MEASURED** — 5 NSE symbols, `docs/EVIDENCE-F4-oi-unit.md` |
| **`gex-skew.js:32` documents its input as "OI in contracts"** | measured |
| **`server.js:5971` feeds it the LIVE broker chain's `oi`** | measured |
| **What unit does the broker chain report?** | ⚪ **UNKNOWN. NEVER MEASURED.** |

> **If the broker chain reports units, every GEX number on the dashboard is wrong by a factor of the
> lot size — 65× for NIFTY.**
>
> **The measurement is trivial and has not been done:** take one live chain row and the same-day
> bhavcopy row for the same strike and expiry, and compare `oi`. **One row settles it.**

## 🟡 N-3 — `strategy.js:211` — a variable named `lotSize` that is not a lot size

```js
strategy.js:211   const lotSize = 100; // SENSEX lot size
                  const atmStrike = Math.round(currentPrice / lotSize) * lotSize;
```

**The registry says SENSEX `lotSize = 20`.** This looked like a 5× error. **It is not.**
The value `100` is used as a **strike-interval rounding divisor**, and SENSEX's strike interval **is**
100 (`instrument-registry.js:104 strikeInterval: 100`). **The number is right; the name and the comment
are wrong**, and `selectStrike` is **not exported** (`server.js:10` imports only `calculateVWAP` and
`detectTrend`). **Severity: LOW — dead code with a misleading name.**

*(Recorded because I initially flagged it as a 5× lot error and it was not. Reading the two lines
around it settled it in thirty seconds.)*

## Symbol / strike / expiry mapping

| | |
|---|---|
| Symbol mapping | 🟡 Per-connector, ad-hoc. `instrument-registry` holds the canonical names — **and each connector maps its own** |
| Strike mapping | 🟡 `Number(row.strike)` — no validation that it lies on the instrument's strike interval |
| Expiry | 🔴 **Bypassed** — T-1 |
| Instrument identifiers | 🔴 `DHAN_NIFTY_SECURITY_ID` etc. are **env vars with no value in `.env`** (004) |

---

# PART 6 — STORAGE ASSESSMENT

| Store | Retention | Versioning | Atomic | Corruption handling | Recovery |
|---|---|---|---|---|---|
| **`bt-data/bhav/`** — 600 CSV | 🟢 permanent | — | n/a (read-only) | n/a | 🟢 **re-downloadable from NSE** |
| `data/opt-hl/` | date-wise | — | 🟡 | — | 🔴 **not re-derivable — live-only** |
| **`data/opt-candles/`** | **1 session** | — | 🟡 | — | 🔴 **NOT RE-DERIVABLE. Every day of delay is permanently lost** |
| `data/gex-vix-history.json` | 15 entries | — | 🟡 `[MIXED]` | — | 🔴 |
| 🔴 **`data/vrp-monitor.json`** | **EMPTY** | — | — | — | 🔴 **The one instrument that would test the platform's core hypothesis has recorded ZERO observations** |
| `data/market-state.json` | daily | — | 🟡 | date-guarded | 🟡 |

> **The historical data is safe (re-downloadable). The live-derived data is not.**
> **Intraday option chains cannot be reconstructed after the fact.** One complete session exists.
> **This is the only irreversible clock in the project.**

---

# PART 7 — CONSUMER DEPENDENCY MATRIX

| Consumer | Consumes | Owner | Validated input? |
|---|---|---|---|
| **Strategy engines** (6) | live chain, spot, VIX | per-engine | 🔴 **NO** |
| **Backtests** (8) | bhavcopy | `bt-lib` | 🔴 **NO — all 8 carry look-ahead** (001-D) |
| **`bt-validate.js`** | bhavcopy | itself | 🟢 **FIXED in 002** |
| **GEX / vol-context** | chain OI + IV | 🔴 **NOBODY** | 🔴 **NO — and `oiUnit` is UNKNOWN (N-2)** |
| **Risk engine** | — | — | ⚪ **DOES NOT EXIST** |
| **Portfolio** | — | — | ⚪ **DOES NOT EXIST** |
| **AI agents** | news + chain | `agents-engine` | 🔴 NO |
| **Dashboard** (19 pages) | everything | `server.js` | 🔴 NO |

> **Not one consumer validates its input.** Every one of them trusts that a `0` means zero.

---

# PART 8 — FAILURE MODE REGISTER

| ID | Failure | Current handling | Fail-safe? |
|---|---|---|---|
| **F-1** | **A field is missing from the feed** | 🔴 **`|| 0` — it becomes a valid-looking number** | 🔴 **NO. FAILS OPEN** |
| **F-2** | **IV is unavailable** | 🔴 **`gex-skew.js:49` substitutes 0.14** | 🔴 **NO. IT INVENTS DATA** |
| **F-3** | **Feed interruption** | 🟡 Cache serves the last value **with no age limit at the consumer** | 🔴 **A stale price is indistinguishable from a live one** |
| **F-4** | **Broker rate-limit (429)** | 🟢 backoff + coalescing (`server.js:6280`) | 🟢 **YES — the best-handled failure in the data layer** |
| **F-5** | **Parse failure** | 🟡 `try/catch` → often an **empty catch** (92 across the repo) | 🔴 |
| **F-6** | **Storage failure** | 🟢 `safe-write` where used; 🔴 raw elsewhere | 🟡 |
| **F-7** | **A hung socket** | 🔴 **`live-connector.js` has NO timeout** | 🔴 |
| **F-8** | **Out-of-order ticks** | 🔴 **Not detected** | 🔴 |
| **F-9** | **The clock is wrong** | 🔴 **Trusted absolutely — including for expiry detection** | 🔴 |
| **F-10** | **The Cloudflare tunnel URL is dead** | ⚪ **UNKNOWN what it serves** | ⚪ |

---

# PART 9 — OBSERVABILITY REPORT

| Metric | Exposed? |
|---|---|
| Health status | 🟡 **`_dataHealth` exists (`server.js:2125`)** — and 🔴 **`/api/m/health` returns 404** because `mountAll()` is never called |
| Latency | 🟡 Broker-call latency is instrumented (`server.js:6280`) — **the only instrumented thing in the platform** |
| **Drop counts** | 🔴 **IMPOSSIBLE.** Nothing is ever dropped — it is converted to `0` |
| **Error counts** | 🔴 **NO.** 92 empty catches |
| **Freshness metrics** | 🔴 **NO.** TTLs exist internally; **no freshness is published** |
| Recovery events | 🔴 **NO** |

> **`engine-verdict.js:150` defines `freshnessMs` in its contract — the right idea, with one adopter.**

---

# PART 10 — MARKET DATA ARCHITECTURE (conceptual — no code)

```
   MarketDataPort  ★  ONE interface. Six adapters behind it.

     quote(inst)      → { price, ts, source, freshnessMs } | null
     chain(inst, exp) → { strikes[], oiUnit, ts, source, freshnessMs } | null
     freshness(inst)  → seconds

   ┌──────────────────── THE FOUR CONTRACT RULES ────────────────────┐
   │                                                                 │
   │ 1. A MISSING VALUE IS `null`. NEVER `0`.                        │
   │    An unknown OI is not zero OI. An unknown IV is not calm.     │
   │    → kills F-1 (119 sites)                                       │
   │                                                                 │
   │ 2. `oiUnit` IS A MANDATORY FIELD.                                │
   │    A required field makes the question un-skippable.             │
   │    → kills N-2 (a possible 65× error)                            │
   │                                                                 │
   │ 3. EVERY PAYLOAD CARRIES ITS AGE. A consumer that trades on     │
   │    data older than its own limit MUST refuse.                   │
   │    → kills F-3                                                   │
   │                                                                 │
   │ 4. NOTHING IS EVER SUBSTITUTED. No `|| 0.14`.                   │
   │    An engine with no IV publishes `reliability: null` ⇒ weight 0.│
   │    → kills F-2 (fabricated data)                                 │
   └─────────────────────────────────────────────────────────────────┘

   QUALITY GATE (before storage):
     · every field is present, or explicitly null with a reason
     · the strike lies on the instrument's strike interval (registry)
     · the expiry is a valid expiry for that instrument (registry — NOT getDay())
     · the timestamp is monotonic and within tolerance of the exchange clock
     · lot and oiUnit come from the registry. NEVER from a literal.
```

---

# PART 11 — TESTING STRATEGY

| Test | Priority | Why |
|---|---|---|
| 🔴 **A chain row with a MISSING `oi`/`iv` yields `null`, not `0`** | **P0** | **119 sites. This is the platform's own first rule** |
| 🔴 **`oiUnit` — one live chain row vs the same-day bhavcopy row** | **P0** | **One row settles a possible 65× error** |
| 🔴 **The expiry weekday comes from the registry, not `getDay()`** | **P0** | **T-1 — the exact bug that swapped NIFTY/SENSEX expiry in `pop-seller`** |
| **Lot size: 0 literals outside the registry** | **P0** | 8 sites. **B-4, widened** |
| **Stale data: a consumer refuses data older than its limit** | P1 | F-3 |
| **`gex-skew` refuses to substitute 0.14 for a missing IV** | P1 | F-2 |
| **Timestamp ordering: out-of-order ticks are detected** | P1 | F-8 |
| **Parsing: each of the three `free-chain` leg parsers, against a captured payload** | P1 | |
| **Historical replay: `bt-lib.loadDay()` is byte-stable** | ✅ **exists** | |

---

# PART 12 — MIGRATION ROADMAP

| Phase | Actions | Preconditions | Risks | Exit criteria |
|---|---|---|---|---|
| **1 — Inventory** | ✅ **DONE — this document** | — | none | Every source has a provider, an owner and a confidence |
| **2 — Quality validation** | **Measure `oiUnit` (one row).** Audit the 119 `|| 0` sites. Cross-check one live chain against the same-day bhavcopy | Phase 1 | 🔴 **Changing `|| 0` → `null` WILL surface latent null-derefs downstream. That is the point, and it needs approval** | `oiUnit` is KNOWN. The `|| 0` count is triaged into *harmless* and *lying* |
| **3 — Ownership** | `MarketDataPort` interface. **Expiry + lot from the registry, everywhere** | Phase 2 | Medium — protected file | 0 lot literals · 0 `getDay()` expiry checks |
| **4 — Observability** | `mountAll()`. Publish freshness, drop counts, error counts | Phase 3 | Low | `/api/m/health` returns **200** and can **FAIL** |
| **5 — Recovery** | Timeouts + retry on `live-connector`. Timer registry | Phase 4 | Low | Every failure in Part 8 is 🟢 or explicitly accepted |

---

# PART 13 — SUCCESS CRITERIA

| Criterion | Status |
|---|---|
| Every source documented | 🟢 **YES — Part 1** *(one UNKNOWN: the Cloudflare tunnel)* |
| Time semantics verified | 🔴 **NO** — 22 hand-rolled IST literals, no TZ library, expiry by `getDay()` |
| Data quality measurable | 🔴 **NO** — **the evidence is destroyed at parse time** |
| Ownership explicit | 🔴 **NO** — 6 connectors, no port; **nobody owns `oiUnit`** |
| Failures observable | 🔴 **NO** — nothing can be dropped, so nothing is counted |
| Recovery reproducible | 🟡 Historical: 🟢 re-downloadable. Live-derived: 🔴 **gone forever** |
| Consumers receive validated data | 🔴 **NO** — **not one consumer validates its input** |

## **Market Data Engine maturity: 1 of 7. NOT MATURE.**

---

# EXECUTIVE SUMMARY

**The mission was to be able to trace any value from its source to every consumer.**
**You now can — and the trace is short and bad:**

> A field arrives from a scraped endpoint. If it is missing, **`|| 0` turns it into a number** — one of
> **119 places** this happens. If it is an IV, `gex-skew.js` may instead **invent 14%**. It is not
> validated, its unit is **never declared**, its age is **never checked by any consumer**, and it lands
> in one of **62 mutable globals** in a 7,328-line file, from which six engines, twelve analytics
> modules and nineteen dashboard pages read it **without a single validation between them.**

**Three things are genuinely good and must be kept:**

1. **The historical archive** — 600 days of the exchange's own authoritative file, ~1.08M strike-days, **re-downloadable**.
2. **The broker rate-limit handling** — coalescing + backoff + counters. **The only properly instrumented failure path in the platform.**
3. **`bt-lib.loadDay()`** — since 2026-07-10 it returns the real per-day lot and **`null` when it cannot know**. **It is the one parser in the repository that obeys `Unknown ≠ Zero`.**

**One measurement, costing minutes, is the highest-value action available:**

> **Compare one live chain row's `oi` against the same-day bhavcopy row's `OpnIntrst`.**
> **If they differ by the lot size, every GEX number this platform has ever displayed is wrong by 65×.**
> **It has never been done.**

---

**Ingestion logic modified: NONE. Providers changed: NONE. Parsers rewritten: NONE. Suite: 48/48.**

**Deliverables:** Market Data Inventory (Part 1) · Ingestion Pipeline (Part 2) · Data Quality (Part 3) ·
Timestamp Integrity (Part 4) · Normalization Review (Part 5) · Storage (Part 6) · Consumer Matrix
(Part 7) · Failure Mode Register (Part 8) · Observability (Part 9) · Architecture Blueprint (Part 10) ·
Testing Strategy (Part 11) · Migration Roadmap (Part 12) · Executive Summary.
