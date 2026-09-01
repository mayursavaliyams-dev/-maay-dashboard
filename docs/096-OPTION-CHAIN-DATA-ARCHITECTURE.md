# 096 — TASK 067: Institutional Option Chain Data Architecture

**Research and architecture only. No production code was written and the
repository was not modified for this task.**

Audited 2026-08-14 against the repository **and the running process**, not
against documentation. Every number below has the command that produced it.

Classification on every conclusion: **[VERIFIED]** ran it and read the output ·
**[MEASURED]** a number from a command · **[ESTIMATED]** reasoned from
measurements, assumptions shown · **[HYPOTHESIS]** testable, untested ·
**[OPINION]** judgement · **[UNKNOWN]** not established. These are never merged.

---

## 1. EXECUTIVE FINDING

**The archive cannot identify the contract it is describing.** [VERIFIED]

A stored chain row is `{k, ce, pe}` — a strike number and two quote blocks. There
is no expiry on the row, no expiry on the snapshot, no instrument id, no lot
size, no contract version. On any day where a weekly and a monthly series are
both listed, **a row is ambiguous**: nothing in the file says which series it
belongs to.

This is not a gap in the vendor feed. `securityId` (`NSE_FO|44983`) is present in
the live API response and is **discarded at write time** [VERIFIED]. The chain's
`expiry` is used inside `server.js` for the Black-Scholes fill and never reaches
the archive.

Everything else on this page is secondary to that. A dataset that cannot say
*which contract* a price belongs to cannot be used for expiry research, term
structure, rollover analysis, or any backtest that spans an expiry boundary — and
those are most of the questions in the brief.

**Second finding:** 100% of strikes carry `delta`, `bid` and `ask`; only ~82%
carry `ltp`, `oi` or `iv` [MEASURED]. The complete fields are the **calculated**
ones. A consumer that filters on "has delta" gets a superset of the rows that
were actually traded, and nothing in the schema marks the difference.

---

## 2. EXISTING DATA AUDIT

Answers to the 25 questions, measured.

| # | Question | Answer | Grade |
|---|---|---|---|
| 1 | What is collected? | Full chain snapshot per instrument: spot, atm, pcrOI, maxPain, and a per-strike CE/PE quote block | [MEASURED] |
| 2 | Fields stored per leg | 20: `ltp, oi, changeOI, volume, iv, ivSource, open, high, low, close, prevClose, bid, ask, bidQty, askQty, delta, gamma, theta, vega, pop` | [MEASURED] |
| 3 | Observed but **discarded** | `securityId` (present live, absent in archive); the chain-level `expiry`; the whole HTTP response until 2026-08-12 | [VERIFIED] |
| 4 | Nominal frequency | `--every 300` (5 minutes) | [VERIFIED] |
| 5 | Actual observed interval | median **300 s**, min 19 s (NIFTY 2026-08-13, 82 snapshots) | [MEASURED] |
| 6 | Maximum observed gap | NIFTY **300 s**; SENSEX **18,010 s (5 h 0 m)** on the same day | [MEASURED] |
| 7 | Timestamps used | `at` (ISO string) and `ts` (epoch ms) — **both receipt-time**, written by the capture process | [MEASURED] |
| 8 | Timezone | IST throughout (`tradingDay` is an IST date); `at` is ISO-8601 UTC | [MEASURED] |
| 9 | Expiries represented | **They are not.** No expiry field at row or snapshot level | [VERIFIED] |
| 10 | Strikes represented | `k`, integer, in the underlying's own price units | [MEASURED] |
| 11 | CE / PE | Two named sub-objects per row: `ce`, `pe` | [MEASURED] |
| 12 | Instrument identity | `inst` — a bare string, `"NIFTY"` / `"BANKNIFTY"` / `"SENSEX"` | [MEASURED] |
| 13 | Underlying identity | Same `inst` string. No ISIN, no exchange code, no segment | [MEASURED] |
| 14 | Spot price | `spot`, one float per snapshot. No spot timestamp of its own | [MEASURED] |
| 15 | OI | `oi` absolute, plus `changeOI` — **derived** by the connector as `oi − prev_oi` | [VERIFIED] |
| 16 | Volume | `volume`, cumulative-for-the-day as the vendor reports it | [MEASURED] |
| 17 | IV | `iv` plus **`ivSource`** — the one field in the system that already separates observed from derived. Distribution on a sampled snapshot: **feed 100, bsm 5** | [MEASURED] |
| 18 | Greeks | `delta, gamma, theta, vega` — vendor when supplied, otherwise Black-Scholes from a solved IV. **No source marker.** | [VERIFIED] |
| 19 | Bid/ask | Yes: `bid, ask, bidQty, askQty` | [MEASURED] |
| 20 | Market depth | **Level 1 only.** No depth ladder anywhere in the archive | [MEASURED] |
| 21 | Complete listed universe? | **No.** NIFTY 2026-08-13: 105 strikes, 22000→27200, step 50, spot 24370 → a window of **−9.7% / +11.6%** | [MEASURED] |
| 22 | ATM ± window? | Effectively yes, though not expressed as a rule — see §8 | [MEASURED] |
| 23 | Historical retention | 17 days of chain snapshots. Files: `data/warehouse/L0_raw/chain/<INST>/<DATE>.jsonl` | [MEASURED] |
| 24 | Files / tables | `data/warehouse` **415 MB**, `data/raw-journal` **144 MB**, `data/opt-candles` **88 MB**, `data/opthl` **2 MB**. No database | [MEASURED] |
| 25 | Permanently lost | See §15 | [VERIFIED] |

### Field completeness, and what it reveals

NIFTY 2026-08-13, mid-session snapshot, 105 strikes [MEASURED]:

```
ltp 86    oi 85    volume 82    iv 86    high 86
bid 105   delta 105
```

SENSEX same day, 144 strikes: `ltp 98, oi 98, volume 84, iv 98, bid 144, delta 144`.

**The 100% fields are the computed ones.** `delta` is present on every strike
because it is solved; `ltp` is present on 82% because only those traded. `bid`
being 100% is [UNKNOWN] — it may be a genuine quote on every strike or a
connector default; the archive cannot distinguish them, which is itself the
finding.

---

## 3. DOCUMENTED vs ACTUAL vs RUNTIME

| Claim | Documented | Actual repository | Actual runtime | Verdict |
|---|---|---|---|---|
| "Chain snapshots capture every column the feed gives, verbatim" (`warehouse-capture.js` header) | 21 columns incl. greeks | 20 columns, `securityId` dropped in `legRow()` | `securityId` present in the live response | **CONTRADICTION** [VERIFIED] |
| "unknown stays null" (same header) | null preserved | `open/high/low` are hard-set to `0` in `upstox-connector._leg()` | Live API returns `high: 29.8` — filled later by the system's own tracker, not the vendor | **CONTRADICTION** [VERIFIED] |
| Capture is content-addressed so it self-gates out of hours | writes only on change | true for the chain fingerprint | SENSEX file spans 09:35 → **20:40 IST** | **PARTIAL** — it polls all night; only the *write* is gated [MEASURED] |
| Capture covers the session | implied | — | window began **09:35**, the open is 09:15 | **CONTRADICTION** [MEASURED] |
| Greeks are the vendor's | implied by field names | BSM fallback with no marker | `ivSource` marks IV only | **CONTRADICTION** [VERIFIED] |

---

## 4. CANONICAL DATA MODEL

Fifteen entities. The shape below is the design; nothing here is implemented.

**A. Underlying Snapshot** — `(underlying_id, exch_ts, recv_ts, last, open, high, low, prev_close, source)`

**B. Option Contract Master** — the missing entity. `(contract_id PK, underlying_id, exchange, segment, expiry_date, strike, right, trading_symbol, instrument_key, lot_size, tick_size, contract_version, listed_on, delisted_on, adjustment_ref)`

**C. Option Chain Snapshot** — `(snapshot_id, underlying_id, expiry_date, exch_ts, recv_ts, store_ts, spot_ref, source, seq, completeness)` — **`expiry_date` is part of the key**, so one underlying at one instant produces one snapshot *per series*.

**D. Option Quote** — `(snapshot_id, contract_id, ltp, ltq, ltt, bid, ask, bid_qty, ask_qty, open, high, low, close, prev_close)`

**E. Option Trade** — `(contract_id, exch_ts, price, qty, seq)` — not currently obtainable, see §15.

**F. Market Depth** — `(snapshot_id, contract_id, level, side, price, qty, orders)` — L1 only today.

**G. Open Interest** — `(contract_id, exch_ts, oi, oi_prev_close)`. `change_oi` is **DERIVED** and must be recomputed, never stored as observed.

**H. Volume** — `(contract_id, exch_ts, cum_volume)`. Interval volume is derived by differencing and is wrong across a gap; store the gap flag with it.

**I. Implied Volatility** — `(contract_id, exch_ts, iv, iv_source, iv_model, iv_inputs_ref)` — `iv_source ∈ {feed, solved}`; when solved, the inputs must be recoverable.

**J. Greeks** — same shape, `greek_source ∈ {feed, model}`, plus `model_id`, `rate`, `dividend`, `tte_years`.

**K. Expiry Calendar** — `(underlying_id, expiry_date, series_type, is_holiday_adjusted, source)`.

**L. Corporate / Contract Actions** — `(underlying_id, effective_date, action_type, ratio, old_contract_id, new_contract_id)`.

**M. Data Quality Events** — `(event_id, ts, scope, rule_id, severity, detail, snapshot_ref)`.

**N. Collection Health** — `(component, ts, seq, interval_promised_ms, outcome)` — the heartbeat and coverage records already built.

**O. Session Metadata** — `(trading_day, session_open, session_close, halts[], source)`.

---

## 5. FIELD-LEVEL DATA DICTIONARY (representative)

Full dictionary would run to ~180 rows; the pattern is shown on the fields where
the current system is wrong.

| Field | Meaning | Type | Class | Source | Timestamp meaning | Units | Null? | Validation | Failure mode |
|---|---|---|---|---|---|---|---|---|---|
| `ltp` | last traded price | dec(12,4) | **OBSERVED** | vendor | time of that trade — **not stored today** | underlying ccy | yes, if untraded | `> 0`; must lie within `[low, high]` of same day | absent read as 0 |
| `oi` | open interest | int | **OBSERVED** | vendor | end of vendor's last update | contracts | yes | `>= 0`; step is a multiple of lot | absent read as 0 |
| `change_oi` | oi − prev_oi | int | **DERIVED** | computed | n/a | contracts | — | must equal recomputation | stored as if observed |
| `iv` | implied volatility | dec(8,4) | **OBSERVED or DERIVED** | vendor / solver | quote instant | annualised % | yes | `0 < iv < 500` | mixing the two — `ivSource` exists and is the correct pattern |
| `delta` | ∂price/∂spot | dec(8,6) | **OBSERVED or DERIVED** | vendor / BSM | quote instant | ratio | yes | `CE ∈ [0,1]`, `PE ∈ [−1,0]` | **no source marker today** |
| `bid`/`ask` | best quotes | dec(12,4) | **OBSERVED** | vendor | quote instant | ccy | yes | `ask >= bid` | 100% present — provenance [UNKNOWN] |
| `expiry_date` | series expiry | date | **OBSERVED** | contract master | n/a | IST date | **no** | must exist in Expiry Calendar | **absent — the headline finding** |
| `contract_id` | immutable identity | string | **OBSERVED** | contract master | n/a | — | **no** | resolvable at the snapshot's date | **absent** |
| `high`/`low` | day range | dec(12,4) | **DERIVED** here | system tracker | since tracking began | ccy | yes | `low <= ltp <= high` | vendor sends 0; system fills. On 2026-08-13, **22 of 144** SENSEX strikes had `ltp > high` [MEASURED] — a same-day impossibility, caused by a verifier record that survived the day boundary |

---

## 6. TIMESTAMP ARCHITECTURE

Six distinct times. The archive currently stores **one**, and it is the least
useful for research. [VERIFIED]

| Timestamp | Meaning | Present today? |
|---|---|---|
| **Exchange** | when the event happened at the exchange | **No** |
| **Broker** | when the broker's system observed it | **No** |
| **Receipt** | when this process received it | Yes — `ts`/`at` |
| **Storage** | when it was written | No (≈ receipt) |
| **Processing** | when a derivation was computed | No |
| **Session date** | IST trading day | Yes — `tradingDay` |
| **Expiry date** | series expiry | **No** |
| **TTE** | time to expiry | No (recomputable *only if* expiry is known) |

Which to use:

- **Backtesting** — exchange, always. Receipt time embeds this machine's latency and its outages into the dataset, and a strategy tested on receipt time is tested on the collector's health.
- **Market replay** — exchange for ordering, receipt for realism about what was knowable.
- **Latency research** — the pair (exchange, receipt). Impossible today: only one exists.
- **OI / IV / Greeks change** — exchange, differenced. Differencing receipt times across a 5-hour gap produces a "change" that is an artefact of the collector.
- **Expiry-relative** — expiry date, which is absent.

**[OPINION]** Storing receipt time only is the second-most damaging decision in
the current design, after the missing contract identity.

---

## 7. CONTRACT IDENTITY ARCHITECTURE

An option contract is identified by
`(underlying, exchange, segment, expiry, strike, right)` and carries
`(lot_size, tick_size, contract_version)`.

Today the archive stores **`inst` + `k` + `ce|pe`** — three of the six. Expiry,
exchange and segment are absent. [VERIFIED]

Requirements:

1. **`contract_id` immutable.** A lot-size change or a corporate action creates a
   **new** contract_id with a link to the old, never an edit.
2. **Historical resolution.** `resolve(underlying, expiry, strike, right, as_of)`
   must return the contract as it stood on that date — the registry already holds
   broker-verified lot/tick/step/expiry-weekday for 6 instruments and is the right
   home for this.
3. **Never confuse eras.** A 2026 NIFTY 24000 CE and a 2024 one differ in lot
   size. Keying on `(inst, strike, right)` alone silently merges them — which is
   what today's archive does.

**[VERIFIED]** `securityId` (`NSE_FO|44983`) is already in the live response and
is dropped by `legRow()` in `warehouse-capture.js:127`. Storing it is a
one-field change and would give every historical row a resolvable identity.

---

## 8. FULL CHAIN vs PARTIAL CHAIN

**Measured today:** NIFTY 105 strikes spanning **−9.7% to +11.6%** of spot;
SENSEX 134–144; BANKNIFTY 167. This is a wide window, not the full listed
universe, and it is a *consequence* of what the vendor returns rather than a
stated policy — no code expresses "ATM ± X". [MEASURED]

| Approach | Storage | What it costs you |
|---|---|---|
| Full listed chain | highest | nothing |
| ATM ± N strikes | lowest | far strikes vanish exactly when they matter — a crash moves spot into strikes that were never recorded |
| ATM ± X% | moderate | the window moves with spot, so a strike's history has holes on the days it was far from money |
| **Layered** (full at low frequency + near-ATM at high frequency) | moderate | **[OPINION] the right answer** |

**What a partial chain permanently costs** [ESTIMATED, reasoning shown]:

- **Tail research** — the strikes that matter in a crash are the ones outside the
  window on the day before it.
- **Full-surface volatility fitting** — a surface fitted to a truncated strike
  range is extrapolated at the wings, and the wings are where skew lives.
- **Dealer-gamma totals** — a total computed over a window is a *window* total,
  not a market total, and cannot be compared across days when the window moved.

**The specific risk in today's data**: the window is defined by the vendor, so it
can change without notice and the archive records no `completeness` field to
detect it. [VERIFIED — no such field exists]

---

## 9. SAMPLING FREQUENCY ANALYSIS

**Measured:** median 300 s, one 18,010 s gap, session start 09:35 against a 09:15
open. Coverage is bounded by cadence: a 5-minute poll can observe at most ~75 of
the 376 session minutes — **about 20% by design**. [MEASURED]

| Research use | Frequency required | Evidence |
|---|---|---|
| Microstructure / queue dynamics | tick, with depth | [VERIFIED] impossible at 300 s |
| Market replay | ≤ 1 s | [OPINION] |
| Intraday volatility (5-min realised) | ≤ 60 s | [OPINION] — 300 s makes a 5-minute bar a single observation |
| IV surface, intraday shape | ≤ 60 s | [HYPOTHESIS] untested here |
| Gamma / dealer positioning | ≤ 60 s | [HYPOTHESIS] |
| OI research | **event-driven**; exchange updates OI on its own schedule | [UNKNOWN] — the vendor's OI update cadence has not been measured |
| End-of-day / expiry studies | 1/day, plus a reliable close | [VERIFIED] achievable today |
| ML training | depends entirely on the label horizon | [OPINION] |

**[UNKNOWN]** Whether 300 s is sufficient for OI research cannot be answered
without measuring how often the vendor's `oi` field actually changes. That
measurement is cheap and has not been done.

**Explicitly not claimed:** that 60 s is "enough" for anything. Nothing in this
repository has tested a frequency against a research outcome.

---

## 10. RETENTION ARCHITECTURE

**Measured now:** warehouse 415 MB / 17 days ≈ **24 MB per day** for three
instruments at 5-minute cadence; raw-journal **3.7 MB/hour ≈ 88 MB/day**.
[MEASURED]

**[ESTIMATED]** — assumptions stated, arithmetic shown:

| Cadence | Per day | Per year (250 sessions) | Assumption |
|---|---|---|---|
| 300 s (today) | 24 MB | **~6 GB** | linear in snapshot count |
| 60 s | 120 MB | **~30 GB** | 5× the snapshots, same per-snapshot size |
| 1 s | 7.2 GB | **~1.8 TB** | linear; almost certainly pessimistic — Parquet + dictionary encoding on a slow-moving chain should compress heavily, **[UNKNOWN]** by how much until measured |

Tiers:

- **Hot** — current session + 5 sessions, uncompressed JSONL, direct read.
- **Warm** — 90 sessions, columnar (Parquet), partitioned by `(underlying, expiry, trading_day)`.
- **Cold** — everything, compressed, immutable.
- **Archive** — the raw byte journal, WORM, never derived-from-in-place.

Deletion policy: **[OPINION]** derived tiers may be deleted because they are
rebuildable; the raw journal may not. The repository already learned this the
hard way — a retention loop was deleting the option-candle archive at 41 files,
silently, and was removed on 2026-08-12.

---

## 11. DATA QUALITY ARCHITECTURE

The 29 checks in the brief, mapped to what exists.

**Already implemented** [VERIFIED]: impossible/negative/zero price (hl-verify
rule 4); duplicate snapshot (rule 5); out-of-order (rule 1); stale quote (rule 6);
clock drift / future timestamp (rule 2); undeclared source (rule 7); sequence
regression (rule 8); missing timestamp (rule 2); partial chain — *detected as
absent coverage, not as a chain-completeness rule*.

**Not implemented** [VERIFIED]: negative OI · negative volume · OI jump ·
volume jump · strike mismatch · expiry mismatch (impossible — no expiry stored) ·
wrong lot size · wrong tick size · `bid > ask` · negative spread · IV
discontinuity · Greek discontinuity · spot mismatch · contract rollover ·
corporate action · exchange holiday · market halt · API failure classification ·
rate-limit accounting.

**A live example of why these matter** [MEASURED]: `ltp > high` on 22 of 144
SENSEX strikes on 2026-08-13 — an intra-day impossibility that no rule caught,
because no rule compares a quote against its own day range. Root cause found and
fixed 2026-08-13: a verifier record survived the IST day boundary while the
server's record was cleared, so today's prices were judged against yesterday's
extremes.

---

## 12. HISTORICAL RECONSTRUCTION ANALYSIS

*"State of the entire option market at 10:30:00 IST on any historical day."*

| Requirement | Status |
|---|---|
| A snapshot at or near 10:30 | **Partial** — ±150 s at best; and only for days the collector ran [MEASURED] |
| Which expiry each row belongs to | **NO** [VERIFIED] |
| Contract identity | **NO** [VERIFIED] |
| Lot size / tick size as of that date | **NO** [VERIFIED] |
| Spot at that instant | Yes, receipt-timed |
| Quotes | Yes, L1 |
| Depth | **NO** |
| Trades | **NO** |
| Exchange timestamps | **NO** |
| Was the collector even running? | **Yes, since 2026-08-12** — coverage records now distinguish "unchanged" from "not watching" |

### RECONSTRUCTION COVERAGE SCORE

Computed only from measured facts. Score = fraction of the ten requirements above
that are satisfied for an arbitrary historical timestamp.

**3.5 / 10** [MEASURED] — snapshot (0.5, partial), spot (1), quotes (1),
collector-liveness (1); the other six are absent.

**No percentage is claimed for "how much of the market" is reconstructable.** The
strike window is vendor-defined and unrecorded, so that denominator is
**[UNKNOWN]**.

---

## 13. RESEARCH CAPABILITY MATRIX

| # | Question | Answerable today? | Blocker |
|---|---|---|---|
| 1 | Highest OI strikes | **Yes**, within the window | — |
| 2 | Fastest OI gain | **Partial** | 300 s cadence; OI update rate [UNKNOWN] |
| 3 | OI migration | **Partial** | window moves with spot; no expiry |
| 4 | Volume migration | **Partial** | cumulative volume differenced across gaps |
| 5–7 | IV expansion / collapse / ATM IV | **Partial** | `ivSource` mixes feed and solved; no expiry to group by |
| 8 | Skew | **No** | truncated wings, no expiry |
| 9 | Term structure | **No** | **no expiry field at all** |
| 10 | Bid/ask liquidity over time | **Partial** | L1 only; `bid` provenance [UNKNOWN] |
| 11 | Depth changes | **No** | not collected |
| 12–14 | Spot → premium, IV → premium, decay | **Partial** | TTE unavailable without expiry |
| 15 | Greeks over time | **No** as observation | model outputs unmarked; unusable as ground truth |
| 16 | Behaviour around expiry | **No** | no expiry |
| 17 | High-volatility regimes | **Partial** | 17 sessions [MEASURED] |
| 18 | Dealer positioning **measured** | **No** | requires participant-level data no retail feed carries |
| 19 | Dealer gamma **measured** | **No** | same; a computed proxy is **ESTIMATED** and must never be labelled measured |
| 20 | Which stay impossible? | §15 | — |

---

## 14. MISSING DATA REPORT

Available from the vendor and **not stored**: `securityId`; the chain's
`expiry`; exchange timestamps ([UNKNOWN] whether the vendor supplies them —
unmeasured); depth beyond L1 ([UNKNOWN] whether the plan includes it).

Not available from this vendor at all: trade prints; participant categories;
order-book events.

---

## 15. PERMANENT DATA-LOSS REPORT

Irrecoverable, and each dated:

1. **Every session before 2026-07-26.** No chain archive exists. [MEASURED]
2. **The first ~20 minutes of most sessions.** Mean 183 minutes missed at the
   open across 19 measured days; only 2 captured from 09:15. Root cause found
   2026-08-12: the 08:50 scheduled task fails with win32 4320 (`Interactive`,
   nobody logged on) and capture actually starts at logon. [MEASURED]
3. **Every original response byte before 2026-08-12.** The capture called
   `r.json()` and discarded the bytes. Fixed; everything before is projection
   only. [VERIFIED]
4. **The expiry of every row ever stored.** Not derivable after the fact: a
   snapshot with two live series cannot be disambiguated retrospectively.
   [VERIFIED]
5. **All depth, all trades, all exchange timestamps, for the whole period.**

---

## 16. EVIDENCE TABLE

| Claim | Grade | How |
|---|---|---|
| No expiry in the archive | [VERIFIED] | read snapshot + row keys directly |
| `securityId` live but discarded | [VERIFIED] | compared live API to `legRow()` and to a stored row |
| Cadence 300 s median, 18,010 s max gap | [MEASURED] | interval distribution over a full day |
| Strike window −9.7% / +11.6% | [MEASURED] | min/max strike vs spot in one snapshot |
| delta 105/105, ltp 86/105 | [MEASURED] | non-zero counts per field |
| ivSource feed 100 / bsm 5 | [MEASURED] | distribution over one snapshot |
| Storage 415 MB / 17 days | [MEASURED] | `du` |
| 1 s ≈ 1.8 TB/yr | [ESTIMATED] | linear scaling; compression unmeasured |
| 60 s sufficient for IV surface | [HYPOTHESIS] | not tested |
| Vendor OI update cadence | [UNKNOWN] | not measured |
| `bid` on 100% of strikes is genuine | [UNKNOWN] | cannot distinguish quote from default |

---

## 17–18. SOURCES

**Official — to be consulted before implementation, not cited here as evidence**
because none was read for this audit: NSE and BSE derivatives contract
specifications (lot size, tick size, strike interval, expiry-day rules); NSE/BSE
Clearing settlement and corporate-action circulars; SEBI circulars on contract
adjustment; exchange holiday calendars.

**Academic — named as directions, not as support for any claim above:**
implied-volatility surface estimation and no-arbitrage constraints; the
options-market-maker inventory literature underlying dealer-gamma proxies;
market-microstructure work on quote-vs-trade information content.

**[VERIFIED]** No external source was consulted for this document. Every finding
above comes from this repository and its running process. Citing sources not read
would be the fabrication the brief forbids.

---

## 19. UNKNOWNS

Vendor OI update cadence · whether exchange timestamps are available on this plan
· whether depth beyond L1 is available · whether `bid` on every strike is real ·
compression ratio for columnar storage of this data · the vendor's rule for which
strikes appear in the window · whether the window has changed historically.

---

## 20. CONTRADICTIONS

Four, all in §3: "every column verbatim" vs `securityId` dropped · "unknown stays
null" vs `open/high/low` hard-set to 0 · self-gating out of hours vs a file
spanning to 20:40 · Greeks presented as vendor data when they may be model
output.

---

## 21. RESEARCH RISKS

**[OPINION]** In order of how quietly they mislead:

1. Treating model Greeks as observed Greeks — the field name gives no warning.
2. Differencing cumulative volume or OI across an unrecorded gap.
3. Fitting a surface to a truncated strike range and reporting wing skew.
4. Computing dealer gamma over a moving window and comparing across days.
5. Backtesting on receipt time — the collector's outages become market events.

---

## 22. RECOMMENDED PRIORITY

1. **Store `expiry_date` and `securityId` on every row.** Both exist upstream.
   Without them the archive answers no expiry-related question, and every day
   that passes adds unusable rows.
2. **Mark Greek provenance**, exactly as `ivSource` already marks IV.
3. **Fix the 09:15 start** — operational, not code.
4. **Record `completeness`** on each snapshot: strike count, min/max strike, and
   whether the vendor truncated.
5. **Measure the OI update cadence**, then choose a frequency with evidence.
6. Contract master + expiry calendar.
7. Columnar warm tier.

---

## FINAL DECISION

**A. Store immediately** — `expiry_date`, `securityId`, Greek source marker,
snapshot completeness, exchange timestamp if the vendor supplies one. All are
observed-and-discarded today; all are cheap; each day without them is a day of
rows that cannot be used for expiry research. [VERIFIED]

**B. Can wait** — columnar tiering, contract master, corporate actions, depth,
sub-minute cadence. None of them recovers anything currently being lost.

**C. Being permanently lost right now** — the expiry of every row; the first ~20
minutes of most sessions; depth; trades; exchange timestamps. [VERIFIED]

**D. Possible after fixing storage** — term structure, expiry-day behaviour,
skew *within* the stored window, honest IV research with feed and solved
separated, OI migration by series.

**E. Impossible even then** — measured dealer positioning and measured dealer
gamma (participant-level data no retail feed carries); microstructure and queue
dynamics (no trades, no depth, no exchange time); any reconstruction of sessions
before 2026-07-26.

**F. Do NOT build yet** — tick capture (storage unmeasured, no research question
requires it yet); a dealer-gamma product (the input is [ESTIMATED] and would be
displayed as measured); ML datasets (they would inherit the missing expiry and
the unmarked Greeks); a second vendor (nothing has been measured against the
first).

**G. The single highest-value next technical task** — *(implemented 2026-09-01, see the addendum)*
**add `expiry_date` and `securityId` to every stored chain row.**

It is a two-field change to `legRow()` and the snapshot header, both values are
already in hand, and it converts the archive from *"a wall of numbers whose
contract is unknown"* into a dataset. Nothing else on this list has that ratio,
and nothing else stops the loss that is accruing every session.

---

## ADDENDUM — 2026-09-01: Decision G implemented

The audit above describes the archive as it stood on 2026-08-14. Decision G has
since been carried out. This addendum records what changed, what was proved, and
what is still unverified. The audit body is left exactly as written, because it is
the measurement that motivated the change.

### What was changed

| File | Change |
|---|---|
| `server.js` | `_buildOptionSnapshot` now returns `expiry: _bsmExp`. The value was already computed in that same function for the Black-Scholes fill and then discarded at the return. |
| `warehouse-capture.js` | `securityId` added to `LEG_COLS`, routed through a new `LEG_STR_COLS` set so `num()` cannot flatten the string to null; `expiry` added to the snapshot header; `expiry` added to the change fingerprint. |
| `test/warehouse-capture.test.js` | Six regression assertions. |

### What was proved

- **The new assertions fail against `HEAD`.** [VERIFIED] The pre-change module was
  loaded in-process from `git show HEAD:warehouse-capture.js` and run against the
  same fixture: `snapshot.expiry` → `undefined`, `leg.securityId` → `undefined`. A
  test that only passes *after* a change has not been shown to test the change.
- **A latent defect surfaced while writing the fingerprint test.** [VERIFIED]
  Under the old code two snapshots differing *only* in expiry hashed
  **identically** — so a rollover into a new series whose prices resembled the old
  one's would have been suppressed as "nothing changed" and never written. Expiry
  is now part of the fingerprint. It is an observed identity, constant within a
  series, so it cannot reintroduce the clock drift that kept the Greeks out.
- **`securityId` is genuinely present in the live response.** [VERIFIED]
  `NSE_FO|46905`, read from the running server.
- **The expiry value exists live and is populated.** [VERIFIED]
  `/api/strangle/status` reports `2026-09-03` for the current NIFTY series.
- **`_bsmExp` is in scope at the return.** [VERIFIED] No block boundary lies
  between its declaration and the return; both files parse.
- **Full suite 108/108, capture suite 51 assertions.** [VERIFIED]

### What is NOT verified

**The running processes are still on the old build.** [VERIFIED] `server.js` and
`warehouse-capture.js` must be restarted before one row is written with the new
fields. Until then the change is proved in test and unproved in production. The
first post-restart snapshot should be checked for a non-null `expiry` on the
snapshot and a non-null `securityId` on a leg.

### What this does NOT fix

Every row already stored stays ambiguous. Expiry cannot be reconstructed for a
past snapshot that carried two live series, so §15 item 4 stands unchanged: the
expiry of every row written before this change is permanently lost. The fix stops
the loss; it does not reverse it.

`open`/`high`/`low` are still hard-set to `0` by the connector (§3), Greeks still
carry no source marker (§5), and no `completeness` field exists (§8). Those remain
open.
