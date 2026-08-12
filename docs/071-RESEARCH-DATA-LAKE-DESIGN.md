# 071 — Research Data Lake: Physical Design

**ANTIGRAVITY PRO · lead data engineer, research platform**
**Date:** 2026-07-31 · **Status:** DESIGN ONLY — first deliverable, no implementation code
**Scope:** schemas · partitioning and sort · validation suites · lineage · tiering and
retention · phased delivery with the tests that prove each phase

---

# PART 0 — The dependency check, before anything is designed on top of it

The brief names three dependencies as **"already built, consume, do not rebuild"**.
Before designing ten modules that read from them, I measured whether they exist in
the form the brief assumes. **They largely do not**, and a schema written against
journals-with-offsets that do not exist would be a beautiful document nobody can
implement.

**Grade: Measured**, 2026-07-31, against this repository.

| Declared dependency | Assumed | Actually present |
|---|---|---|
| **Append-only websocket frame journals** | frames, immutable, with manifests and SHA-256 | **None on the live path.** `server.js` runs `UpstoxConnector`, which **polls REST** (`CHAIN_CACHE_MS` 2,500 ms, adaptive). `dhan-ws-feed.js` is a real websocket client but belongs to the **inactive** Dhan connector |
| **REST chain-poll captures** | immutable, manifested, hashed | `data/opt-candles/<date>.json` — **premium OHLC only**: `[t, o, h, l, c]`. No IV, no OI, no volume, no depth, no greeks. No manifest, no hash. **Auto-deleted after 40 files** |
| Landed official files | bhavcopy, participant-wise OI | none found |
| **Effective-dated contract terms** | date-ranged validity | `instrument-registry.js` carries a single `lastVerifiedAt` — a **current snapshot**, not a bitemporal record |
| **Date-ranged symbol maps** | rename history | **none.** TATAMOTORS → TMPV (Oct 2025) is unhandled; the old symbol simply stops resolving |
| Exchange calendars | machine-readable | `data/event-calendar.json` is **0.7 KB** — an event list, not a trading calendar |
| **Effective-dated cost model** | versioned, shared with live | `charges.js`, 55 lines, **one flat rate table**, no version, no effective dates |

### Two further measurements that bound everything below

| | |
|---|---|
| Sessions in the archive missing the market open | **12 of 13** (61–358 minutes each) |
| Index spot price history | **0 KB** — `candles.json`, `prices.json` are empty |
| Actual capture volume | **2.9 MB/day** |
| Design envelope in the brief | **~20 GB/day raw** |
| **Ratio** | **≈ 6,900×** |

The entire `data/` directory is **241 MB across 634 files** — less than a fiftieth
of what *one day* of the designed envelope would be.

## 0.1 What this means for the build order — the handoff contract

**It does not mean the design is wrong.** The envelope is the right target for full
five-index tick capture; the 6,900× gap is the distance between capturing ticks and
polling a chain every 2.5 seconds while keeping only the premium.

**And it is not work for this build.** The three missing dependencies are
**Prompt 1's Modules 1, 2 and 4** — raw capture, contract metadata, cost model. The
brief says plainly: *depend on it and must not duplicate it*. Building frame
journals here would be duplicating Prompt 1 Module 1, which is exactly what the
instruction forbids.

So this is not a Phase 0 that Prompt 2 owns. **It is a blocking dependency, and what
follows is the handoff contract**: the precise, field-level list of what Prompt 1
must deliver before Prompt 2 Phase A can begin. Written as a contract rather than a
complaint, because "the dependencies aren't ready" is not actionable and this is.

### What Prompt 1 Module 1 (raw capture) must deliver

| Deliverable | Why Prompt 2 cannot start without it |
|---|---|
| Append-only frame journals with **byte offsets** | Module 1 requires every silver row to carry `src_file_id` + `src_offset`. A JSON blob rewritten once a minute has no offset to cite |
| **All chain fields persisted**: `bid, ask, bidQty, askQty, oi, changeOI, volume, iv, ivSource` and the greeks | Modules 3, 4, 5, 6 are all functions of these. They arrive every 2.5 seconds today and are discarded |
| **Index spot and India VIX series** | `silver.index_quote` has no source; `research.iv_greeks` cannot pin a spot |
| Per-file **manifest + SHA-256** | P1's determinism claim is unverifiable without a hash to compare against |
| Coverage/gap records at capture time | `silver.coverage` cannot be reconstructed after the fact — a gap nobody recorded is indistinguishable from a quiet market |
| Retention beyond 40 files | Every multi-month dataset below is impossible against a 40-day window |
| Session coverage from **09:15** | 12 of 13 sessions currently start mid-day; a bar series built on that is a bar series about afternoons |

### What Prompt 1 Module 2 (contract metadata) must deliver

| Deliverable | Why |
|---|---|
| **Effective-dated** contract terms (`valid_from`, `valid_to`) | P3. Lot sizes and strike intervals change; a current snapshot silently applies today's terms to 2024 data |
| **Date-ranged symbol maps** | TATAMOTORS → TMPV (Oct 2025) is unhandled today. Every validation rule below that says *"instrument_id resolvable as of `trade_date`"* fails without this |
| Machine-readable **exchange calendar**, including Muhurat | `session_id` on every bar, and the trading-time basis for `tte_trading_years`, both depend on it |

### What Prompt 1 Module 4 (cost model) must deliver

| Deliverable | Why |
|---|---|
| **Effective-dated, versioned** rate schedule | `ai.label_definition` stores `cost_model_version` as part of the label's *identity*; `bt.run` registers it. A flat undated table cannot be pinned, so no label and no run can be reproduced |

### The consequence, stated once

Designing Module 1 to read `opt-candles` instead — the tempting shortcut — would
make premium-only, morning-missing, 40-day-expiring data the **ground truth** of the
entire research lake. **P1 would be violated in the first module**, and every
principle below it would be resting on it.

**Prompt 2 Phase A starts the day the seven rows of the first table above are true.
Not before.**

> **The single most consequential fact in this document:** the chain feed carries
> `bid, ask, bidQty, askQty, oi, changeOI, volume, iv, ivSource, delta, gamma,
> theta, vega` on every strike, and the archive keeps **none of it**. Every module
> from 3 onward is a function of fields that arrive every 2.5 seconds and are
> discarded. Price history can be re-fetched; **chain state cannot**.

---

# PART 1 — Conventions common to every dataset

## 1.1 Time: three stamps, not two

The brief mandates dual timestamps. **Three are required**, and the third is where
Indian options research leaks.

| Column | Meaning |
|---|---|
| `event_time_ns` | exchange event time, int64 nanoseconds UTC |
| `recv_time_ns` | our receive time, int64 nanoseconds UTC — **the research ordering key** |
| `knowledge_time_ns` | when the value became **knowable to us** |

For a live quote, `knowledge_time ≈ recv_time`. For anything published on a lag
they diverge, and the divergence is the whole point:

| Fact | `event_time` | `knowledge_time` |
|---|---|---|
| Bhavcopy for 2026-07-30 | 2026-07-30 15:30 | 2026-07-30 ~18:00, when the file landed |
| Participant-wise OI for 2026-07-30 | 2026-07-30 15:30 | **2026-07-31 morning** |
| Exchange restatement | original trade date | when the revision was published |

**Module 6 must join on `knowledge_time`, never on `event_time`.** This is the most
common source of accidental lookahead in this market and it is invisible in any
schema that carries only two stamps.

## 1.2 Money: integers, never floats

All prices stored as **int64 paise**. The tick is ₹0.05 = **5 paise**, so every
option price is a multiple of 5 and `price_paise % 5 == 0` is a validation rule.

Floats are banned in stored data because `0.05 + 0.10 !== 0.15` in IEEE-754, and a
premium that is off by 1e-15 breaks equality joins and hash-based determinism —
which Module 1 requires to be byte-identical.

Index levels: int64 **paise** as well (NIFTY 24,300.25 → 2,430,025).
IV, greeks and ratios: `float64`, because they are computed, not quoted — and each
carries the methodology version that produced it.

## 1.3 The quality bitmask

One `int32` on every row in the normalized store. Bits, not an enum, because a row
can be several things at once.

| Bit | Name | Meaning |
|---|---|---|
| 0 | `CROSSED_BOOK` | bid ≥ ask |
| 1 | `TIMESTAMP_REGRESSION` | event time earlier than the previous row for this instrument |
| 2 | `VOLUME_REGRESSION` | cumulative volume decreased within a session |
| 3 | `OI_REGRESSION` | open interest decreased beyond tolerance |
| 4 | `STALE_OI` | OI unchanged beyond its own trailing norm |
| 5 | `RESEEDED_AFTER_RECONNECT` | first row after a gap; state was re-established, not continuous |
| 6 | `ONE_SIDED_BOOK` | one side absent |
| 7 | `NO_DEPTH` | no quoted size on an instrument that normally shows it |
| 8 | `CLOCK_SKEW` | event and receive time disagree implausibly |
| 9 | `OUT_OF_BAND` | outside the exchange price band |
| 10 | `PRICE_OUTSIDE_DAY_RANGE` | contradicts the day high/low in the same payload |
| 11 | `SYNTHETIC_FORWARD` | forward inferred, not observed |
| 12 | `CONFLATED` | the source is a snapshot poll, not a tick stream |

**Bit 12 is set on everything this system currently captures**, and it must be,
because a poll every 2.5 seconds is a conflated view and every downstream number
inherits that. Marking it in the schema is the difference between a research result
that knows its own resolution and one that does not.

**Flags never repair.** A crossed book is stored crossed.

## 1.4 Format and evolution

- **Apache Parquet**, ZSTD, with an **Apache Iceberg** table layer. Both are open
  specifications with multiple independent readers — the brief requires that every
  engine be replaceable within five years, and Iceberg's schema and partition
  evolution are what allow the partitioning scheme to change **without rewriting
  history**.
- Columns carry **stable numeric field-ids**; renames are metadata-only.
- Schema changes are **additive first**. A column is never repurposed.
- **Every dataset name ends in a method version** — `iv_surface_v3` — and versions
  live side by side. P5 forbids overwriting.

---

# PART 2 — Physical schemas

Types are Parquet logical types. `PK` marks the primary key. Every table also
carries the lineage columns of §2.0.

## 2.0 Lineage columns, on every derived row

| Column | Type | Notes |
|---|---|---|
| `src_file_id` | int64 | FK to `catalog.files` |
| `src_offset` | int64 | byte offset within that file |
| `builder_version` | string | semantic version of the code that wrote the row |
| `build_id` | string | FK to `catalog.builds` |

`src_offset` is the requirement that Phase 0 exists to satisfy: a JSON blob written
once per minute has no meaningful offset, a frame journal does.

---

## MODULE 1 — Normalized store (silver)

### `silver.option_snapshot`

| Column | Type | Notes |
|---|---|---|
| `trade_date` **PK** | date | partition key |
| `instrument_id` **PK** | int64 | canonical, from contract metadata |
| `recv_time_ns` **PK** | int64 | sort key |
| `seq` **PK** | int32 | tie-break within the same nanosecond |
| `event_time_ns` | int64 | |
| `knowledge_time_ns` | int64 | |
| `bid_paise`, `ask_paise`, `last_paise` | int64 | **null when absent** |
| `bid_qty`, `ask_qty` | int32 | |
| `bid_orders`, `ask_orders` | int32 | null if the feed omits them |
| `volume_cum` | int64 | cumulative, session-to-date |
| `oi` | int64 | **as delivered** — see the OI table for the transition series |
| `feed_iv`, `feed_delta`, `feed_gamma`, `feed_theta`, `feed_vega` | float64 | the broker's own, **never merged** into ours |
| `feed_iv_source` | string | `feed` / `bsm` — two different things, kept apart |
| `quality_flags` | int32 | §1.3 |
| `source_kind` | string | `ws` / `rest_poll` / `official` |
| `connection_id` | string | which socket or poller |

**Partition:** `trade_date`.
**Sort within partition:** `instrument_id`, then `recv_time_ns`, then `seq`.
Sorting by instrument first is what makes per-contract range scans read one
contiguous run rather than touching every row group.

### `silver.index_quote`

Same time and lineage columns; `index_id`, `level_paise`, plus `open/high/low_paise`
where the feed carries them. India VIX is an `index_id`, not a separate table —
it is quoted the same way and separating it would fork every join.

### `silver.oi_transition`

**One row per observed CHANGE**, never per snapshot.

| Column | Type | Notes |
|---|---|---|
| `trade_date` **PK** | date | |
| `instrument_id` **PK** | int64 | |
| `recv_time_ns` **PK** | int64 | when the change was **seen** |
| `oi_prev`, `oi_new` | int64 | |
| `oi_delta` | int64 | signed |
| `prev_change_recv_ns` | int64 | so the dwell between changes is a stored fact |
| `observed_gap_ns` | int64 | **how long we were not looking** — null if unknown |

**Why a transition series and not a column on the snapshot.** OI updates far more
slowly than price. Storing it per snapshot invites `LAST_VALUE(...) OVER (...)`,
which produces a one-second OI series that looks fresh and is not. The transition
form makes the staleness structural: a consumer must ask when it last changed, and
`observed_gap_ns` tells them whether a gap was the market being quiet or us not
watching.

**Sort:** `instrument_id`, `recv_time_ns`.

### `silver.official_eod`

| Column | Type | Notes |
|---|---|---|
| `trade_date` **PK** | date | |
| `instrument_id` **PK** | int64 | |
| `revision` **PK** | int16 | **0 = first publication; restatements append** |
| `knowledge_time_ns` | int64 | when the revision landed |
| `open/high/low/close_paise`, `settle_paise` | int64 | |
| `volume`, `oi`, `oi_change`, `trades`, `turnover_paise` | int64 | |
| `format_era` | string | `pre_udiff` / `udiff` |
| `raw_field_map_version` | string | how the era's columns were mapped |

**Restatements append.** A query wanting today's best knowledge takes
`MAX(revision)`; a point-in-time query takes the highest revision whose
`knowledge_time ≤ t`. **This is why the revision is in the key** — an update in
place would silently rewrite history and make every prior backtest unreproducible.

`format_era` exists because the pre- and post-July-2024 layouts differ, and a
mapping bug in one era must be fixable **without touching the other**.

### `silver.coverage` — absence as a first-class row

| Column | Type | Notes |
|---|---|---|
| `trade_date` **PK**, `instrument_id` **PK**, `window_start_ns` **PK** | | |
| `window_end_ns` | int64 | |
| `expected_updates`, `observed_updates` | int32 | |
| `gap_reason` | string | `disconnect` / `not_subscribed` / `process_down` / `market_closed` / `unknown` |

P4 says absence is a fact. **This is the table that makes it queryable**, and it is
the one that would have shown, on day one, that 12 of 13 sessions were missing the
market open.

---

## MODULE 2 — Bars and backfill

### `silver.bars_{1m,5m,15m,1h,1d}`

| Column | Type | Notes |
|---|---|---|
| `trade_date` **PK**, `instrument_id` **PK**, `bar_start_ns` **PK** | | **timestamped at bar OPEN**, stated once and never mixed |
| `open/high/low/close_paise` | int64 | |
| `volume_delta` | int64 | not cumulative |
| `oi_close` | int64 | from the transition series **as of** the bar close |
| `tick_count` | int32 | updates that built the bar |
| `vwap_paise` | int64 | null when volume is zero — **not the close** |
| `spread_mean_paise`, `spread_close_paise` | int64 | |
| `expected_updates` | int32 | |
| `coverage_ratio` | float64 | `tick_count / expected_updates` |
| `gap_flag` | bool | |
| `source` | string | `captured` / `vendor` / `official_eod` |
| `session_id` | string | `regular` / `muhurat` / `special` |

**A bar built from 12 of 60 expected updates says so**, in `coverage_ratio`, on the
row — not in a side table a query can forget to join.

**`session_id` keeps Muhurat separate.** It is a real session on a calendar holiday
and merging it into an adjacent day corrupts that day's open, high, low and volume.
Making it a partition-visible column means a query has to *choose* to include it.

**`source` is on every bar, never blended within a series.** A `1d` series that is
vendor before 2026-01 and captured after is two series, and a chart that draws them
as one is a lie about where the data came from.

### `research.vendor_acceptance`

One row per vendor sample month, written **before** any bulk purchase.

| Column | Notes |
|---|---|
| `vendor`, `sample_month`, `instruments_tested` | |
| `bar_match_rate`, `price_mae_paise`, `volume_mae` | vs our own bars on the overlap |
| `illiquid_strike_treatment` | how they fill a strike that never traded |
| `oi_cadence_match` | does their OI update at the exchange's cadence or a fabricated one |
| `expired_weekly_coverage_pct` | **the one most vendors fail** |
| `verdict`, `report_uri`, `signed_by` | |

The acceptance report is a **gate, not a formality**. Expired weekly contracts are
where Indian option vendors are weakest, and they are most of the research universe.

---

## MODULE 3 — IV and greeks

### `research.iv_greeks_v{N}`

| Column | Type | Notes |
|---|---|---|
| `trade_date` **PK**, `instrument_id` **PK**, `recv_time_ns` **PK**, `method_version` **PK** | | **the version is IN the key** |
| `quote_basis` **PK** | string | `mid` / `bid` / `ask` / `last` |
| `iv` | float64 | **null with a reason when unsolvable** |
| `iv_null_reason` | string | `no_quote` / `crossed` / `below_intrinsic` / `no_convergence` / `zero_vega` / `stale_last` |
| `delta, gamma, theta, vega, rho` | float64 | |
| `spot_paise`, `forward_paise` | int64 | the exact inputs used |
| `forward_method` | string | `futures` / `parity` / `spot_carry` |
| `rate_curve_id`, `rate_used`, `daycount` | string/float64/string | |
| `tte_calendar_years`, `tte_trading_years` | float64 | **both**, because they differ most on expiry day |
| `solver_iterations`, `converged` | int16 / bool | |
| `is_estimate` | bool | **always true** — P6, at the schema level |

**`is_estimate` is a constant `true` column and that is deliberate.** P6 says an
estimate must be labelled permanently so no downstream consumer can mistake a model
output for an observation. A constant column costs nothing under ZSTD and cannot be
dropped by a `SELECT *`.

**Bid and ask IV are separate rows, not columns**, so every mid IV is bracketed by
construction and a query can ask "how wide is the IV uncertainty here" without a
schema change.

### `research.parity_residual_v{N}`

Per chain-minute: `expiry`, `strike`, `residual_paise`, `residual_bps`,
`forward_implied_paise`. A continuous correctness check — persistent one-sided
residuals mean the forward is wrong, not that the market is mispriced.

---

## MODULE 4 — Option chain research store

### `research.chain_minute_v{N}`

The full cross-section, per minute. Identifiers, `strike_paise`, `right`, `expiry`,
`bid/ask/mid/last_paise`, `volume`, `oi`, `spot_paise`, `forward_paise`, `tte_*`,
`iv`, all greeks, plus the coordinates research is actually done in:

| Column | Notes |
|---|---|
| `log_moneyness` | `ln(K/F)` — the comparable coordinate across expiries and spot levels |
| `strike_distance_points` | for reasoning in the units a trader uses |
| `delta_bucket` | signed, banded |
| `mid_paise` | **null when one-sided** — never `(bid + 0)/2` |
| `quality_flags` | §1.3 |

**Every strike, both rights, every live expiry.** Storing only near-ATM is what
makes a put-call ratio wrong and a max-pain number meaningless, and the bias is
invisible once the missing rows are gone.

### `research.chain_agg_minute_v{N}`

`atm_strike`, `atm_iv`, `straddle_paise`, `pcr_oi`, `pcr_volume`, `max_pain_strike`,
`total_call_oi`, `total_put_oi`, `rr_25d`, `bf_25d`, `term_slope`, plus:

| Column | Notes |
|---|---|
| `component_row_count` | how many rows the aggregate consumed |
| `expected_row_count` | how many the chain should have had |
| `coverage_ratio` | the two divided |
| `chain_quality_score` | quote coverage × spread sanity × solver convergence |

**The self-consistency rule:** every aggregate must equal the aggregation of the
stored component rows, recomputed and compared on build. That test is what catches
**partial-chain coverage bias** — a PCR computed over 60% of a chain is not a PCR,
and it will look perfectly reasonable.

---

## MODULE 5 — Volatility surface

### `research.svi_fit_v{N}`

Per `(trade_date, expiry, fit_time_ns, method_version)`:
SVI parameters `a, b, rho, m, sigma`; `n_quotes_used`, `quote_set_hash`, `rmse`,
`max_abs_residual`; `butterfly_ok`, `calendar_ok`, `violation_detail`; `status` ∈
`fitted` / `insufficient_quotes` / `violates_arbitrage`.

**Violating fits are stored and flagged, never discarded.** A calendar-arbitrage
violation on a chain is a finding — it is usually a stale expiry or a broken
forward, and deleting the fit deletes the evidence.

**`quote_set_hash`** makes the fit reproducible without storing a second copy of the
quotes: the hash proves which rows went in, and the rows are already in Module 4.

### `research.iv_grid_v{N}`

Standardised: IV at fixed deltas (10/25/40/50 both sides) and fixed maturities
(7/14/30/60/90 days). **Null grid when `status = insufficient_quotes`.** Never fit
through nothing.

This grid is the form comparable with published literature — the SVI parameters are
the compact truth, the grid is the lingua franca.

---

## MODULE 6 — Feature store

### `features.registry`
`feature_name`, `version` **PK**, `entity_type`, `source_dataset` + version,
`transform_spec` (a declarative expression, not code), `dtype`, `cadence`, `ttl`,
`owner`, `status`, `created_at`. **Immutable per version.**

### `features.offline_v{N}`
`entity_id`, `feature_name`, `feature_version`, **`knowledge_time_ns`**, `value`,
`is_null`, `null_reason`.

**The point-in-time join is `knowledge_time ≤ label_time`, never `event_time`.**

> A participant-positioning file describing 2026-07-30 and published on the morning
> of 2026-07-31 has **31 July** as its knowledge time. Joining it on the 30th gives
> a model tomorrow's newspaper, and every metric downstream will look excellent.

### `features.online`
Current values, written through the **same registered transformation** as offline.

### `features.skew_check`
Daily: sampled online values against the offline materialisation for the same
timestamps. **Divergence is a defect, not a tolerance** — the two stores exist to
be identical, and a tolerance band is where drift hides.

---

## MODULE 7 — AI dataset layer

### `ai.bundle`
`bundle_id` **PK** = **hash of contents**. Manifest records every feature and
version, label definition and version, upstream snapshot ids, filter rules,
imputation policy, builder version, per-split row counts and class balance.
**Updating means a new id. Nothing is mutated.**

### `ai.label_definition`
`label_name`, `version` **PK**, `horizon`, `formula`, **`cost_model_version`**,
**`slippage_assumption`**.

**The cost assumption is part of the label's identity.** A label built at 1× costs
and one built at 2× are different labels, and a model comparison across them is not
a comparison.

### `ai.split`
`bundle_id`, `split_name`, `start_ns`, `end_ns`, `embargo_ns`.
**Law:** train → embargo → validation → embargo → test, each embargo ≥
`max_feature_lookback + max_label_horizon`.

### `ai.leakage_battery`
Per bundle: knowledge-time audit, shuffled-label collapse, cross-split duplicate
detection, null/infinity census. **A failing battery blocks registration.**

### `ai.representation_report`
Counts per regime, per underlying, per year. **A test split containing no
high-volatility period is flagged**, because a model tested only on calm markets is
untested exactly where it matters.

---

## MODULE 8 — Backtest engine

### `bt.run`
Registered **before execution**: `run_id`, `strategy_code_hash`, `config_hash`,
`data_snapshot_ids[]`, `calendar_version`, `cost_model_version`, `fill_model_version`,
`seeds`, `registered_at`, `status`.

**A run naming "latest" is rejected at registration**, not warned about.

### `bt.order` / `bt.fill` / `bt.equity_curve` / `bt.metrics`
Orders carry the **market snapshot the decision saw**; fills carry a full cost
breakdown; the equity curve carries portfolio greeks through time.

**Paper trading writes the identical schema**, so paper-versus-backtest divergence
is a query, not a translation exercise.

### `bt.data_caveat`
`run_id`, `partition_id`, `caveat_kind` ∈ `quarantined` / `partial_coverage` /
`vendor_sourced` / `restated_after_run`.

**The caveat travels with the number.** And it makes the required question one
query:

```sql
-- which results are tainted if this partition was wrong?
SELECT DISTINCT r.run_id, r.strategy_code_hash, m.sharpe
FROM lineage_closure(:partition_id) l
JOIN bt.run r  ON r.run_id = l.run_id
JOIN bt.metrics m ON m.run_id = r.run_id;
```

---

## MODULE 9 — Replay engine

### `replay.session`
`session_id`, `journal_file_ids[]`, `decoder_version`, `clock_model`, `speed`,
`tie_break_rule`, **`stream_hash`**, `started_at`, `verified`.

- **Replay reads raw journals directly.** No second copy of the truth.
- **Deterministic by contract:** same journals + decoder + clock ⇒ byte-identical
  stream, verified by `stream_hash`.
- **Multi-connection merge by `recv_time_ns`**, tie-break `(connection_id, seq)` —
  stable and documented, so two replays of the same session cannot disagree.
- **Capture gaps replay as explicit gap events**, so a consumer can tell a quiet
  market from our outage.
- **The virtual clock is injected and wall-clock reads are made impossible**, not
  discouraged: consumers receive a clock handle and the real one is not in scope.
  A consumer that reads wall time during replay produces results about the wrong
  day, silently.

---

## MODULE 10 — Catalog, lineage, archive, audit

### `catalog.dataset` / `catalog.schema_version` / `catalog.build` / `catalog.files`
Per partition build: `version`, `builder_version`, `input_batch_ids[]`,
`built_at`, `row_count`, `content_hash`, `validation_status` ∈ `passed` /
`quarantined` / `overridden`.

### `catalog.lineage_edge`
`(from_dataset, from_version, from_partition) → (to_dataset, to_version, to_partition)`
Both directions answerable mechanically: *what did this read* and *what breaks if
this was wrong*.

### `catalog.validation_run`
**Every check execution stored permanently** with observed value, threshold,
verdict, and any human override — **signed and reasoned**. An override with no
reason is refused.

### `catalog.audit_log`
Append-only, **hash-chained** (`prev_hash`, `entry_hash`). Partition builds and
rebuilds, validation overrides, schema changes, metadata edits, archive moves,
deletions, replay sessions, dataset registrations. Actor, timestamp, reason.

The chain is what makes the log evidence rather than a file someone could edit.

---

# PART 3 — Partitioning and sort, in one table

| Dataset | Partition | Sort within partition | Why |
|---|---|---|---|
| `silver.option_snapshot` | `trade_date` | `instrument_id, recv_time_ns, seq` | per-contract scans read one contiguous run |
| `silver.index_quote` | `trade_date` | `index_id, recv_time_ns` | few instruments, high frequency |
| `silver.oi_transition` | `trade_date` | `instrument_id, recv_time_ns` | sparse; sorted for as-of joins |
| `silver.official_eod` | `trade_date` | `instrument_id, revision` | revisions adjacent to what they restate |
| `silver.coverage` | `trade_date` | `instrument_id, window_start_ns` | |
| `silver.bars_1m` | `trade_date` | `instrument_id, bar_start_ns` | |
| `silver.bars_1d` | `year` | `trade_date, instrument_id` | daily bars are small; per-day partitions would be thousands of tiny files |
| `research.iv_greeks_v{N}` | `trade_date`, `method_version` | `instrument_id, recv_time_ns, quote_basis` | version in the partition path ⇒ parallel series never read together by accident |
| `research.chain_minute_v{N}` | `trade_date`, `expiry_month` | `expiry, strike_paise, right, minute_ns` | research reads one expiry's cross-section; sorting by expiry-then-strike is the access pattern |
| `research.chain_agg_minute_v{N}` | `trade_date` | `minute_ns` | |
| `research.svi_fit_v{N}` | `trade_date` | `expiry, fit_time_ns` | |
| `features.offline_v{N}` | `knowledge_date` | `entity_id, feature_name, knowledge_time_ns` | **partitioned by KNOWLEDGE date, not event date** — so a point-in-time join prunes partitions instead of filtering rows |
| `ai.bundle` | `bundle_id` | — | content-addressed; immutable |
| `bt.*` | `run_id` | — | immutable per run |

**Iceberg hidden partitioning** throughout, so the scheme can change without
rewriting history — which the brief requires and which a Hive-style directory
layout cannot deliver.

---

# PART 4 — Validation suites

Declarative expectations, versioned, shipped **in the same change as the dataset**.
A failure **quarantines** the partition; quarantined partitions stay visible.

## 4.1 Universal (every dataset)
`schema_matches_registered_version` · `row_count > 0` · `no_duplicate_primary_keys`
· `partition_column_matches_path` · `content_hash_recorded` · `lineage_edges_present`

## 4.2 `silver.option_snapshot`
| Check | Threshold |
|---|---|
| `price_paise % 5 == 0` | 100% |
| `recv_time` non-decreasing within `instrument_id` | 100% |
| `bid < ask` where both present | ≥ 99.9%, remainder **flagged not fixed** |
| `volume_cum` non-decreasing within session | 100% or `VOLUME_REGRESSION` |
| `instrument_id` resolvable in contract metadata **as of `trade_date`** | 100% |
| Every row has `src_file_id` + `src_offset` | 100% |

### The end-of-day reconciliation, and its declared tolerances
| Quantity | Tolerance | Why not exact |
|---|---|---|
| Close vs official close | **± 1 tick** | our last snapshot precedes the closing auction |
| Final cumulative volume | **± 0.5%** | conflated polls miss trades between samples |
| Final OI | **exact** | OI is a slow, settled figure; a mismatch is a decode bug |
| Contract count | **exact** | a missing contract is missing coverage |

> A feed built from conflated snapshots **will not** match exactly, and the design
> says so rather than hiding it. **OI is the exception and must be exact** — that is
> what makes it a real check rather than a band wide enough to pass anything.

## 4.3 `silver.oi_transition`
`oi_new != oi_prev` on every row (a transition that transitions nothing is a bug) ·
`prev_change_recv_ns < recv_time_ns` · `observed_gap_ns` present or explicitly null ·
**no row exists at a cadence faster than the exchange publishes**

## 4.4 `silver.bars_*`
`high ≥ max(open, close)` and `low ≤ min(open, close)` · `volume_delta ≥ 0` ·
`vwap` within `[low, high]` or null · `coverage_ratio ≤ 1` ·
**`source` constant within any `(instrument_id, resolution)` series** ·
`session_id = 'muhurat'` never shares a `trade_date` with `regular`

## 4.5 `research.iv_greeks_v{N}`
Every non-null IV re-derivable from the stored inputs to 1e-9 (**sampled 1%
nightly**) · `iv IS NULL ⇒ iv_null_reason IS NOT NULL` · convergence rate ≥ 95% on
liquid strikes · `is_estimate = true` on 100% of rows ·
**bid IV ≤ mid IV ≤ ask IV** where all three exist

## 4.6 `research.chain_agg_minute_v{N}` — the one that earns its keep
| Check |
|---|
| Every aggregate **recomputed from the stored component rows and equal** |
| `coverage_ratio ≥ 0.95` or the row is flagged low-coverage |
| `total_call_oi` equals the sum of stored call OI **exactly** |
| `max_pain_strike` recomputed and equal |

**This is the test that catches partial-chain coverage bias.** Without it a PCR
computed over a partial chain looks entirely plausible and is wrong in a direction
nobody can see.

## 4.7 `features.offline_v{N}`
**`knowledge_time ≤ label_time` on 100% of joined rows** ·
**truncation test:** re-materialise with all data cut at `t`; values must be
**unchanged** · daily online-versus-offline skew: **zero divergence** ·
distribution drift versus a trailing window, alerting not blocking

## 4.8 `ai.bundle`
Leakage battery must pass: knowledge-time audit · **shuffled labels collapse to
chance** · no cross-split duplicates · null/infinity census · embargo ≥
`max_lookback + max_horizon` · representation report attached

## 4.9 `bt.run`
No `data_snapshot_id` resolves to "latest" · every fill price within the recorded
bid-ask at its timestamp — **a fill outside the book is a hard error** ·
**no decision timestamp precedes any data it consumed** · `cost_model_version`
matches production

---

# PART 5 — The lineage model

```
raw.journal ──► silver.option_snapshot ──► silver.bars_* ──► research.chain_minute
     │                    │                                          │
     │                    └──► silver.oi_transition ────────────────►│
     │                                                                ▼
     └──► raw.official_file ──► silver.official_eod        research.iv_greeks_v{N}
                                        │                             │
                                        └──────► reconciliation       ▼
                                                              research.chain_agg
                                                                      │
                                                        research.svi_fit ─► iv_grid
                                                                      │
                                                              features.offline
                                                                      │
                                                                 ai.bundle
                                                                      │
                                                                   bt.run
```

**Three properties the model must have:**

1. **Edges are between VERSIONED PARTITIONS**, not datasets. "Which results read
   the 2026-07-14 partition of `iv_greeks_v3`" is the question that actually gets
   asked, and a dataset-level edge cannot answer it.
2. **Transitively closed on demand.** `lineage_closure(partition_id)` walks
   downstream to every affected run.
3. **Recorded at build time by the builder**, never inferred later by parsing SQL.
   Inferred lineage is wrong exactly when it matters — in the odd query.

**Invalidation:** marking a partition `quarantined` marks every downstream
partition `stale_input` and every `bt.run` in the closure gains a `data_caveat`.
**Results are never deleted** — a result computed on data later found wrong is
itself evidence, and the caveat is attached to it permanently.

---

# PART 6 — Storage tiering and retention

## 6.1 The envelope, corrected

The brief's ~20 GB/day raw is the right target for **full five-index tick capture**.
Current capture is **2.9 MB/day** because it polls and keeps only premium. Both
numbers are in the plan:

| | Raw/day | Normalized/day | Per year |
|---|---|---|---|
| Today | 2.9 MB | ~1 MB | **~1 GB** |
| Phase 0 complete (chain fields at 2.5 s) | ~600 MB | ~200 MB | **~200 GB** |
| Full tick capture (the brief's target) | ~20 GB | ~5 GB | **~6 TB** |

At six terabytes a year, cold object storage costs roughly the price of a modest
monthly lunch. **Nothing in this design justifies cutting corners on retention**,
and the plan says so in numbers rather than in principle.

## 6.2 Tiers

| Tier | Age | Storage | Codec |
|---|---|---|---|
| Hot | 0–90 days | local NVMe + object | ZSTD-3 |
| Warm | 90 days–2 years | object standard | ZSTD-9 |
| Cold | 2+ years | object archive | ZSTD-19 |

**On every transition: recompress, verify the round-trip hash, and only then
release the hot copy.** A transition that verifies after deletion is not a
verification.

## 6.3 Retention

| Class | Policy |
|---|---|
| Raw journals · official EOD · contract metadata · audit log | **NEVER DELETED** |
| Silver, research layers | rebuildable — may be evicted from hot, never from cold |
| Derived versions superseded by a new method | **retained**; P5 forbids overwriting |
| Bundles and backtest runs | immutable, retained |

## 6.4 Backups

≥ 3 copies · ≥ 2 providers or media · ≥ 1 off-site · open formats only · hashes
verified on every copy.

## 6.5 Proof of recovery

| Cadence | Drill |
|---|---|
| Quarterly | fixity sweep on sampled cold storage |
| Monthly | rebuild spot check: one random partition rebuilt from raw, hash compared |
| **Annually** | **full drill** — restore a random month from cold, rebuild silver and research from it, re-run a pinned backtest, confirm the metrics match what was recorded |

> **A backup that has never been restored is not a backup.** The annual drill is the
> only test in this document that proves the other nine phases were real.

---

# PART 7 — Phased delivery, and the test that proves each phase

| Phase | Deliverable | **The test that proves it** |
|---|---|---|
| **BLOCKER** — **not Prompt 2's work.** Prompt 1 Modules 1, 2, 4 (see §0.1) | Frame journals with manifests and SHA-256 · full chain fields persisted · index spot series · effective-dated contract metadata with symbol-rename ranges · versioned cost model · collector running 09:15–15:30 | **Prompt 2 accepts the handoff only when these pass:** a journal replayed twice produces a **byte-identical** stream · a symbol query at 2025-09-01 returns TATAMOTORS and at 2025-11-01 returns TMPV · session coverage ≥ 99% across 20 consecutive sessions · every chain field present on a sampled snapshot |
| **A.1** | `silver.option_snapshot`, `index_quote`, `oi_transition`, `coverage` | **Determinism:** same journal + decoder + normalizer ⇒ **byte-identical Parquet**, verified by hash on a monthly sample. Every row resolves to a journal offset |
| **A.2** | `silver.official_eod` + reconciliation | Reconciliation runs on every partition; **OI matches exactly**; a deliberately corrupted partition is **quarantined and stays visible** |
| **B.3** | `silver.bars_*` + vendor acceptance | A bar over a known gap reports the true `coverage_ratio`. **Vendor acceptance report exists and is signed before any purchase.** Muhurat never merges |
| **B.4** | `research.iv_greeks_v1` | 1% nightly sample **re-derives to 1e-9** from stored inputs. `bid ≤ mid ≤ ask` IV. Feed greeks stored separately and **never merged** |
| **B.5** | `research.chain_minute_v1`, `chain_agg_minute_v1` | **Every aggregate equals the aggregation of its stored components.** Injecting a partial chain **fails** the coverage check |
| **B.6** | `research.svi_fit_v1`, `iv_grid_v1` | Arbitrage diagnostics run on every fit; a constructed violating chain is **stored and flagged, not dropped**. `insufficient_quotes` yields a **null grid** |
| **C.7** | `features.*` | **Truncation test**: re-materialise cut at `t`, values unchanged. Online-versus-offline skew **exactly zero**. A participant-OI feature joined on trade date **fails** the knowledge-time audit |
| **C.8** | `ai.bundle` | Leakage battery blocks a deliberately leaky bundle. **Shuffled labels collapse to chance.** A test split with no high-volatility period is flagged |
| **D.9** | `bt.*` | A fill priced outside the recorded book is a **hard error**. A run naming "latest" is **rejected at registration**. Quarantining a partition makes the tainted-results query return the affected runs |
| **D.10** | `replay.*` | Two replays of one session produce the **same stream hash**. Live state rebuilt by replay at random timestamps **matches what was recorded live**. A consumer reading wall-clock time **cannot compile** |
| **E.11** | `catalog.*` | Lineage answers both directions mechanically. Audit hash-chain verifies. **The annual restore drill reproduces a pinned backtest's metrics exactly** |

**Each phase ships its validation suite in the same change.** A dataset without its
suite is not delivered.

---

# PART 8 — Four places I would push back

**1. The dependencies are not built.** Part 0 measures this. Designing Module 1 to
read `opt-candles` instead of journals would make premium-only, morning-missing,
40-day-expiring data the ground truth, and P1 would be violated in the first
module. Phase 0 is the honest way to keep P1.

**2. "Roughly 20 GB per day" is a target, not a description.** Actual capture is
**2.9 MB/day** — a factor of about 6,900. The design should be built for the target
and the plan should say which one it is standing on today, so nobody sizes a
cluster for six terabytes a year against one gigabyte of reality.

**3. Point-in-time needs three timestamps, not two.** The brief mandates event and
receive time. Participant-wise OI published the next morning is knowable on the
next morning, and no combination of event and receive time expresses that. Without
`knowledge_time` as a stored column, P3 is a policy rather than a property.

**4. Backfilling before Phase 0 would waste the purchase.** The vendor acceptance
protocol requires reconciling a sample month **against our own bars**. With 12 of 13
sessions missing their open and no IV, OI, volume or depth stored, there is nothing
to reconcile against — the acceptance report would be unable to fail, which makes it
worthless. **Vendor purchase must follow Phase 0, not precede it.**

---

## Summary

The design is complete: schemas for fifteen datasets across ten modules,
partitioning and sort order for each, validation suites with declared tolerances,
a partition-level lineage model, tiering and retention with a corrected storage
envelope, and a phased plan in which every phase names the test that proves it.

**One thing has to be said before any of it is built.** The three dependencies the
brief instructs me to consume — frame journals with manifests and hashes,
effective-dated contract metadata, and a versioned cost model — are **not present**.
What exists is a 2.5-second REST poll storing premium OHLC only, a current-snapshot
instrument registry, and a 55-line flat cost table.

That is not an obstacle to the design. It is Phase 0, and it is small: persist the
chain fields that already arrive, write them as journals with hashes, effective-date
the metadata, version the cost model, and run the collector from the open.

**What makes it urgent is that the chain fields arrive every 2.5 seconds and are
thrown away.** Price history can be re-fetched from a broker at any time. The state
of the option chain at 11:00 last Tuesday cannot be reconstructed by anyone, at any
price, ever.
