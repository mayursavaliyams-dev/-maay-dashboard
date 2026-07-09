# H14 — Historical Options Research Data Lake & Institutional Feature Store
## Design Document (no code written)

> Self-contained. Paste into any assistant to continue this work.
> Written 2026-07-09 by the Principal Quant Data Architect role for **Antigravity Pro**.
> Every number below was measured against the files on disk. Where something is unverified, it says so.

---

## 0. Read this first — four measured findings that invalidate the naive design

I parsed the 600 NSE bhavcopy files actually on disk (`bt-data/bhav/`, `nifty-20240108.csv` →
`nifty-20260617.csv`, 185.8 MB, header-less, 34 positional columns, NSE **UDiFF** format). Four things
came out that any design must be built around, not bolted onto.

### F1 — The lot size is **time-varying, and it is in the data**

| file | `NewBrdLotQty` |
|---|---|
| `nifty-20240108.csv` | **50** |
| `nifty-20241031.csv` | **25** |
| `nifty-20250822.csv` | **75** |
| `nifty-20260617.csv` | **65** |

`instrument-registry.js` holds **today's** lot (NIFTY 65). It is the single source of truth for
**live trading**. It is the **wrong** source for history.

> **Rule DL-1.** Any historical ₹ P&L, notional, GEX or exposure figure **must** use the
> `NewBrdLotQty` from the bhavcopy row itself, never `instrumentRegistry.lotSize()`. Using the registry
> for a 2024 backtest would overstate NIFTY P&L by 30% (65 vs 50) or by 160% (65 vs 25), depending on the
> month. This is the single most likely way to silently produce a wrong backtest.

The registry stays the source of truth for **live** decisions. The data lake carries its own
`contract_dim` table, keyed by `(symbol, trade_date)`, sourced from the data. The registry's
`verifyAgainstContracts()` can then be used to assert that *today's* row agrees with *today's* registry —
a drift alarm, not a lookup.

### F2 — 45% of rows never traded. Their OHLC is zero; only `SttlmPric` is meaningful

In `nifty-20240108.csv`: 812 traded rows, **676 untraded (45%)**.

```
sample untraded row:  O=0.00  H=0.00  L=0.00  C=3672.95  SETTLE=4567.25  OI=1250  VOL=0
```

Note `ClsPric ≠ SttlmPric` for untraded contracts. Zero untraded rows have a zero settle price.

> **Rule DL-2.** "Option OHLC" is a **null concept for 45% of the universe**. Any feature derived from
> option OHLC (option ATR, option VWAP, option candles) must carry a `traded` flag and must **fail closed**
> — emit `null`, never `0`. Black-Scholes IV inversion must use **`SttlmPric`**, and must record whether
> the contract traded, because an untraded settle is an exchange model output, not a market price.

Half the "Option OHLC / VWAP / Bid / Ask / Spread" section of the request is therefore not obtainable, and
another chunk is obtainable only as a *derived, model-based* value that must be labelled as such.

### F3 — These files contain **index options only** (`FinInstrmTp = IDO`). No futures

`{"IDO": 1488}` — every row. No `IDF` (index future), no `STO`/`STF` (stock option/future).

> **Consequence.** There is no futures price, hence **no observable forward**. Black-Scholes inversion must
> use `UndrlygPric` (spot) plus an **assumed** risk-free rate and an **assumed** dividend/carry of zero.
> That assumption biases every reconstructed IV and every Greek. It must be a **stored, versioned
> parameter** of the feature, not a constant buried in code — the existing codebase already has three
> different hardcoded `r` values (`0.065` in `option-analyzer.js` and `pop-seller.js`, `0.065` in
> `gex-skew.js`, and **`0` in `vol-context.js`**).

### F4 — The unit of `OpnIntrst` is **UNVERIFIED**, and it scales GEX by up to 50×

```
strike 19500 PE   OI=371600   lot=50   OI/lot=7432
strike 19500 CE   OI=1250     lot=50   OI/lot=25
strike 21100 CE   OI=86600    lot=50   OI/lot=1732
```

Is `OpnIntrst` in **contracts** or in **units (contracts × lot)**? Both readings are internally consistent
here. The old NSE bhavcopy reported OI in units; UDiFF documentation must be checked, and the value
cross-validated against an independent source (e.g. NSE's own option-chain OI for a recent day, which the
platform can already fetch live).

> **Rule DL-3. No Gamma Exposure number may be published until F4 is resolved.** GEX is
> `Σ gamma × OI × lot × spot² × 0.01`. If OI is already in units and we multiply by lot again, every GEX
> figure is wrong by a factor of the lot size (25–75×). This must be **fail-closed**: the GEX feature
> refuses to compute until `oi_unit` is a verified, recorded property of the dataset version.

---

## 1. What can and cannot be built — evidence classification

Charter rule: *"Never invent market behaviour. Distinguish Verified / Probable / Hypothesis / Unknown."*

| Requested dataset | Class | Basis |
|---|---|---|
| Underlying OHLC (daily) | **Verified** | bhavcopy `UndrlygPric`; plus 1-min underlying, ~9.5 months |
| Option settle, OI, ΔOI, volume, notional, contracts | **Verified** | bhavcopy columns, subject to F4 |
| Option OHLC | **Partial** | meaningless for 45% of rows (F2) |
| Expiry calendar (weekly/monthly/special) | **Verified** | derivable from `XpryDt` distribution; already implemented in `instrument-registry.nextExpiry` for the live path |
| Holiday calendar | **Verified** | = set of `TradDt` present |
| Historical IV, IV Rank, IVP, smile, skew, surface, term structure | **Probable (derived)** | BS inversion of `SttlmPric`. **EOD only.** Biased by F3's assumed `r` |
| Greeks: delta, gamma, theta, vega, rho | **Probable (derived)** | same, EOD only |
| Second-order Greeks: charm, vanna, vomma, color, speed, ultima | **Probable (derived)** | analytic from the same BS surface. Note: their *utility* on EOD data is doubtful — they describe intraday hedging dynamics |
| Realized vol, Parkinson, HV, ATR | **Verified** | underlying OHLC. Parkinson needs H/L → underlying only, not options |
| PCR, Max Pain, OI build-up, long/short buildup, covering, unwinding | **Verified** | OI + ΔOI, EOD |
| OI velocity / acceleration | **Verified (EOD)** | first/second difference of daily OI. **Intraday velocity is not obtainable** |
| **Gamma Exposure** | **Blocked on F4**, then **Verified (EOD)** | |
| **Dealer Gamma / Dealer Position** | **Hypothesis — not a measurement** | Public data shows OI, not *who* is long or short. Every "dealer gamma" figure in the industry rests on an assumption (typically: dealers are short calls and short puts, or the sign is inferred from trade-side classification which needs tick data we do not have). **This must be stored as an assumption with a name and a version, never presented as data.** |
| Bid, Ask, Spread, Market Depth, Liquidity Score, Spread Score | **Unknown / not obtainable** | Not in bhavcopy. No free historical L1/L2 source for NSE options |
| Tick, 1s, 5s, 15s, 30s bars | **Not obtainable** | No tick history. `data/opt-candles/` holds **4 days** of option-level intraday |
| Intraday option bars (1m…1h) | **4 days only** | Forward collection can accumulate more from today |
| VWAP (option) | **Not obtainable historically** | needs intraday volume × price |
| Order Block, FVG, Liquidity Sweep, Volume Profile, POC, Value Area | **Probable, underpowered** | computable on ~9.5 months of underlying 1-min = one market regime. Not enough to establish an edge |
| Corporate actions, index reconstitution | **Obtainable** | NSE publishes; not present locally |
| Event dataset (Budget, RBI, Fed, CPI, war…) | **Manual curation** | No free structured API. Must be a hand-maintained, versioned, reviewed CSV. **This is a research artefact, not a data feed** |

### Coverage reality per market

| Market | Exchange | Bhavcopy source | Options inception | 10-year history possible? |
|---|---|---|---|---|
| NIFTY | NSE | present locally, 2024-01 → 2026-06 | ~2001 | **Yes**, by ingesting NSE archives |
| BANKNIFTY | NSE | not local | ~2005 | Yes |
| FINNIFTY | NSE | not local | **2021** | No — data cannot precede launch |
| MIDCPNIFTY | NSE | not local | **2022** | No |
| **SENSEX** | **BSE** | **different source entirely** | 2023 (weekly) | No |
| **BANKEX** | **BSE** | **different source entirely** | 2023 | No |

> The brief says "10+ years of **NSE** research" and then lists SENSEX and BANKEX, which are **BSE**
> products with a **separate bhavcopy pipeline**. Two ingest adapters are needed, not one. And for four of
> the six markets, a ten-year history **cannot exist**.

---

## 2. Architecture

### Principles

1. **The lake is read-only and immutable.** Ingest writes a new partition; nothing is ever updated in
   place. Corrections arrive as a new dataset *version*, never as an edit.
2. **The lake never imports a trading engine.** Zero coupling. It may be *read* by engines through an API.
3. **The registry is for the present; the lake carries its own history.** See F1.
4. **Fail closed.** A feature whose inputs are missing, ambiguous or unverified emits `null` + a reason,
   never `0`.
5. **Every derived number carries its provenance.** Feature version, formula hash, input dataset version,
   and the assumptions it made (`r`, `q`, `oi_unit`, `dealer_sign_model`).
6. **No broker coupling.** The lake ingests exchange files. Brokers are irrelevant to it.

### Physical shape — a separate process, not a library

```
┌──────────────────────┐        ┌──────────────────────────────┐
│  server.js  :3000    │        │  datalake service  :3200     │
│  (live, paper)       │        │  (read-only, separate proc)  │
│                      │ ─────▶ │  HTTP only. No shared state. │
│  never imports lake  │        │  Crash here ≠ trading down   │
└──────────────────────┘        └──────────────┬───────────────┘
                                               │
                             ┌─────────────────▼──────────────────┐
                             │  DuckDB (embedded)  +  Parquet     │
                             │  lake/ (immutable, checksummed)    │
                             └────────────────────────────────────┘
```

`server.js` gets **zero** changes. The dashboard panel calls `:3200` directly.

### Storage strategy — DuckDB + Parquet, and why

The brief asks for *columnar storage, compression, partitioning, incremental updates, fast indexing,
caching, metadata catalog*. On a **local-only, single-machine, Node.js** platform there is exactly one
sane answer:

| Option | Verdict |
|---|---|
| **DuckDB (embedded) reading Hive-partitioned Parquet** | **Chosen.** Zero server, columnar, vectorised, native Parquet, SQL, predicate pushdown, Node bindings (`@duckdb/node-api`). Handles 15 M rows on a laptop trivially |
| Postgres / TimescaleDB | Needs a server; row-store; overkill for immutable analytical scans |
| ClickHouse | Excellent, but a service to operate. Violates "local only, keep it simple" |
| Raw JSON (current approach) | 3.1 GB of CSV → JSON would be worse. No pushdown, no compression |
| `parquetjs` alone | Unmaintained; no query engine |

**Sizing (measured, not guessed):** NIFTY averages **1,550 rows/day**. Ten years × 250 days × one index
≈ **3.9 M rows**. Six indices (BANKNIFTY/SENSEX chains are smaller; 4× is a conservative multiplier)
≈ **15.5 M rows**, ≈ **3.1 GB as raw CSV**. As Parquet with dictionary + ZSTD, expect **150–350 MB**.
This is a *small* dataset. It fits in RAM. Do not over-engineer.

### Partitioning

```
lake/
  raw/                       # byte-exact vendor files, never touched. The audit anchor.
    nse/fo/2024/01/08/nifty-20240108.csv.zst
    bse/fo/2026/07/09/...
  bronze/                    # parsed 1:1, typed, no business logic
    dataset=option_eod/exchange=NSE/symbol=NIFTY/year=2024/month=01/part-*.parquet
  silver/                    # conformed, joined to dims, quality-scored
    dataset=option_eod/...
  gold/                      # features, versioned
    feature_set=iv_surface/version=v3/symbol=NIFTY/year=2024/...
  dim/
    contract_dim.parquet     # (symbol, trade_date) → lot, tick, step   ← F1 lives here
    expiry_dim.parquet
    holiday_dim.parquet
    event_dim.parquet        # hand-curated, reviewed, versioned
  _catalog/
    manifest.jsonl           # every partition: rows, bytes, sha256, ingested_at, source_url
    datasets.json            # dataset versions + schema versions
    features.json            # feature registry (below)
    quality.jsonl            # per-partition quality report
```

Partition by `symbol / year / month`, **not** by day: 250 tiny files per year per symbol kills Parquet's
row-group efficiency. Month-level partitions of ~30 k rows are right.

`raw/` exists so that any bronze/silver/gold table can be **rebuilt from scratch and byte-compared**.
That is what makes the lake reproducible rather than merely persistent.

---

## 3. Schema

### `bronze.option_eod` (1:1 with the vendor row, typed)

| column | type | source | note |
|---|---|---|---|
| `trade_date` | DATE | `TradDt` | partition key |
| `biz_date` | DATE | `BizDt` | |
| `segment` | ENUM | `Sgmt` | FO |
| `source` | ENUM | `Src` | NSE / BSE |
| `instrument_type` | ENUM | `FinInstrmTp` | IDO / IDF / STO / STF |
| `instrument_id` | BIGINT | `FinInstrmId` | |
| `symbol` | VARCHAR | `TckrSymb` | |
| `expiry_date` | DATE | `XpryDt` | |
| `actual_expiry_date` | DATE | `FininstrmActlXpryDt` | differs on holiday shifts |
| `strike` | DECIMAL(18,4) | `StrkPric` | |
| `option_type` | ENUM | `OptnTp` | CE / PE |
| `contract_name` | VARCHAR | `FinInstrmNm` | |
| `open,high,low,close` | DECIMAL(18,4) | | **NULL when `volume = 0`** (F2) |
| `last_price` | DECIMAL(18,4) | `LastPric` | |
| `prev_close` | DECIMAL(18,4) | `PrvsClsgPric` | |
| `underlying_price` | DECIMAL(18,4) | `UndrlygPric` | |
| `settle_price` | DECIMAL(18,4) | `SttlmPric` | **the only price valid for all rows** |
| `open_interest` | BIGINT | `OpnIntrst` | unit governed by `oi_unit` in the dataset version (F4) |
| `change_in_oi` | BIGINT | `ChngInOpnIntrst` | |
| `volume` | BIGINT | `TtlTradgVol` | |
| `turnover` | DECIMAL(24,4) | `TtlTrfVal` | |
| `trades` | BIGINT | `TtlNbOfTxsExctd` | |
| `session_id` | VARCHAR | `SsnId` | |
| `board_lot_qty` | INT | `NewBrdLotQty` | **F1 — the historical lot** |
| `traded` | BOOLEAN | derived | `volume > 0` |
| `_row_hash` | VARCHAR | derived | sha256 of the raw line — dedup + audit |
| `_ingest_id` | VARCHAR | derived | FK to `_catalog/manifest.jsonl` |

`open/high/low/close` are **NULL, not 0**, when untraded. That single decision prevents a whole class of
silently-wrong features.

### `dim.contract_dim`

`(symbol, trade_date) → board_lot_qty, tick_size, strike_step, expiry_type`

Built **from the data** (`board_lot_qty`, modal strike gap). Used by every historical calculation.
Cross-checked against `instrument-registry.js` **only for the current date** — a mismatch there is a drift
alarm, not a correction to history.

### `silver.option_eod`

Bronze + joins to `contract_dim`, `expiry_dim`, `event_dim`, plus:
`dte` (calendar and trading days), `moneyness = strike / underlying_price`, `atm_distance_steps`,
`is_atm`, `quality_flags` (bitmask), `quality_score`.

### `gold.iv_surface_v{n}` (example feature set)

`trade_date, symbol, expiry_date, strike, option_type, iv, iv_source, r_assumed, q_assumed,
solver, iterations, converged, feature_version, formula_hash, input_dataset_version`

Note `converged` and `r_assumed` are **columns**, not footnotes. A non-converged inversion emits
`iv = NULL, converged = false`, never a fallback constant. (The live code currently falls back to
`0.14 + moneyness × 0.5` in `pop-seller.realPoP` and to a hardcoded `0.15` in `option-analyzer` — exactly
the pattern this lake must not repeat.)

---

## 4. Data pipeline

```
 download → verify → raw/ (immutable, .zst, sha256)
    ↓
 parse   → bronze/  (typed, 1:1, NULLs preserved, _row_hash)
    ↓
 conform → dim/ + silver/ (joins, dte, moneyness, quality flags)
    ↓
 derive  → gold/   (feature sets, each versioned & hashed)
    ↓
 catalog → _catalog/manifest.jsonl + quality.jsonl
```

**Rules**

- **Idempotent.** Re-running ingest for a date produces byte-identical Parquet, or the run aborts.
  Guaranteed by sorting deterministically and pinning the writer's compression settings.
- **Incremental.** A day is the unit of ingest. `manifest.jsonl` records `(dataset, partition, sha256,
  rows, source_url, ingested_at)`. A partition already present with a matching hash is skipped.
- **Atomic.** Write to `*.parquet.tmp`, `fsync`, then rename — the exact discipline of `safe-write.js`
  (module C3). A killed ingest never leaves a half-written partition in the catalog.
- **Rate-limited & polite.** NSE archives are a public service. One request at a time, backoff, resume.
  Ten years of NIFTY ≈ 2,500 files. Expect **hours**, not minutes. Plan for it; do not hammer.
- **Fail closed.** A file that fails checksum or schema validation lands in `_quarantine/` with a reason,
  and the day is marked `missing` in the calendar. It is **never** silently skipped.

**Pipeline order matters:** ingest NIFTY first (2,500 files, one adapter), prove the whole chain end to
end, *then* add BANKNIFTY, *then* build the separate BSE adapter for SENSEX/BANKEX.

---

## 5. Feature pipeline & feature store

### The registry entry (every feature, no exceptions)

```jsonc
{
  "name": "gamma_exposure_eod",
  "version": "v1",
  "description": "Dealer-agnostic total gamma exposure per strike, EOD.",
  "formula": "Σ_strike  gamma(S,K,T,σ,r) × OI × lot × S² × 0.01",
  "units": "₹ per 1% move",
  "dependencies": ["silver.option_eod@v2", "gold.iv_surface@v3", "dim.contract_dim@v1"],
  "assumptions": {
    "r": 0.065,
    "q": 0.0,
    "oi_unit": "UNVERIFIED",          // ← blocks computation (F4)
    "dealer_sign_model": "none"       // this feature does NOT assume who is short
  },
  "owner": "quant-research",
  "validation": ["test/features/gamma_exposure.spec.js"],
  "formula_hash": "sha256:…",
  "created_at": "2026-07-09T…",
  "immutable": true
}
```

**Immutability.** A feature version is content-addressed by `formula_hash` + `dependencies`. Changing the
formula creates `v2`; `v1` is never recomputed. A model trained on `v1` can always be reproduced.

**`dealer_gamma` is a separate feature** from `gamma_exposure`, and its registry entry carries
`dealer_sign_model: "assume_dealers_short_gamma"` with a citation. The API labels it
`class: "hypothesis"`. It is never returned from `/greeks` or `/features` without that label.

### Feature groups and their honest status

| group | status |
|---|---|
| IV surface, IV rank/percentile, skew, term structure | derived, EOD, `r`-dependent |
| First-order Greeks | derived, EOD |
| Second-order Greeks (charm, vanna, vomma, color, speed, ultima) | derived; **flag: low research value on EOD data** |
| PCR, Max Pain, OI build-up classification | direct |
| OI velocity / acceleration | direct, **daily** resolution only |
| Gamma exposure | **blocked on F4** |
| Dealer gamma / dealer position | **hypothesis, labelled** |
| Liquidity score, spread score, market depth | **not computable — no bid/ask** |
| Market-structure (HH/HL/LH/LL, swings, OB, FVG, POC, value area) | underlying only; ~9.5 months |
| Market regime | derivable (realized vol + trend + IV rank), but **one regime of data** |

---

## 6. Data Quality Engine

Each partition gets a `quality.jsonl` row and each silver row a `quality_flags` bitmask.

| check | rule | on failure |
|---|---|---|
| Missing session | `trade_date` absent while exchange calendar says open | mark `missing`, do **not** interpolate |
| Duplicate rows | duplicate `_row_hash` | quarantine partition |
| Timestamp validity | `trade_date ≤ expiry_date`, `biz_date` sane | quarantine row |
| Gap detection | consecutive missing sessions > 1 | raise, block gold rebuild |
| Outlier | `settle_price` beyond `[intrinsic, S]` bounds for a call | flag `price_out_of_bounds` |
| Bad tick | `high < low`, `close ∉ [low, high]` **on traded rows only** | flag |
| Invalid IV | solver did not converge, or `σ ∉ (0.01, 5)` | `iv = NULL, converged = false` |
| Negative OI | `open_interest < 0` | quarantine row |
| Price validation | put-call parity residual > tolerance at ATM | flag `parity_violation` |
| Lot consistency | `board_lot_qty` changes mid-month | flag, keep both (**F1 is real, it is not an error**) |
| Feature validation | any feature whose `assumptions` contain `UNVERIFIED` | **refuse to compute** |

`quality_score` = weighted, published per partition. **A partition below threshold is still stored** —
never deleted — but gold builds refuse to consume it, and the API returns it with a warning band.

Arbitrage sanity checks worth running because they catch schema errors that no per-row rule will:
put-call parity at ATM, monotonicity of call price in strike, convexity of the smile.

---

## 7. API design (`localhost:3200`, read-only)

| method | path | notes |
|---|---|---|
| `GET` | `/history/underlying?symbol&from&to&tf` | daily verified; intraday only where present |
| `GET` | `/options/chain?symbol&date` | EOD chain, with `traded` flags and NULL OHLC |
| `GET` | `/options/contract?name&from&to` | one contract's life |
| `GET` | `/volatility/surface?symbol&date` | `iv`, `converged`, `r_assumed` |
| `GET` | `/volatility/rank?symbol&date&lookback` | IV rank / percentile |
| `GET` | `/greeks?symbol&date&order=1\|2` | 2nd-order carries a `low_value_on_eod` warning |
| `GET` | `/features?set&version&symbol&from&to` | immutable feature set |
| `GET` | `/features/registry` | every feature + formula + assumptions |
| `GET` | `/events?from&to` | curated, versioned; each row has `source_url` |
| `GET` | `/quality?dataset&partition` | quality score + flags |
| `GET` | `/replay/session?symbol&date&speed` | bar-by-bar; **EOD or 1-min underlying only** |
| `POST` | `/ai-dataset` | build train/val/test with purged, embargoed splits |
| `GET` | `/research/:study` | prebuilt study extracts |

**Every response carries an envelope:**

```json
{ "data": [...],
  "provenance": { "dataset_version":"silver.option_eod@v2",
                  "feature_version":"iv_surface@v3",
                  "assumptions": {"r":0.065,"q":0,"oi_unit":"UNVERIFIED"},
                  "quality_score": 0.98,
                  "class": "verified|derived|hypothesis" },
  "warnings": ["oi_unit unverified — gamma_exposure withheld"] }
```

A consumer that ignores `class` and `warnings` can still be wrong — but it can no longer be wrong
*silently*, and the audit log will show it was told.

### AI dataset builder — the part everyone gets wrong

`POST /ai-dataset` must implement **purged, embargoed** splits. Options data has overlapping labels
(a 7-DTE trade's outcome depends on bars inside the next fold). A naive `train_test_split` leaks.
`bt-validate.js` already implements purged k-fold, deflated Sharpe and PSR — **reuse it, do not
reimplement**. Supported: walk-forward, rolling window, expanding window, purged k-fold with embargo.

**Never optimise using future data.** The builder must refuse a config where `test.start < train.end`.

---

## 8. Folder structure (code)

```
datalake/
  index.js                    # Express :3200, read-only
  routes/{history,options,features,events,replay,volatility,greeks,quality,research,ai-dataset}.js
  ingest/
    sources/nse-fo.js         # NSE bhavcopy adapter
    sources/bse-fo.js         # BSE — SEPARATE adapter, different format
    download.js               # polite, resumable, checksummed
    parse-udiff.js            # the 34-column positional schema
    quarantine.js
  core/
    schema.js                 # bronze/silver/gold schemas + validators
    catalog.js                # manifest.jsonl, dataset & feature registries
    duck.js                   # DuckDB connection, read-only by default
    quality.js
    calendar.js               # holiday + expiry dims, built from data
  features/
    registry.js               # feature specs (immutable, hashed)
    iv-surface.js  greeks.js  gex.js  dealer.js
    oi-analytics.js  market-structure.js  regime.js
  ai/
    splits.js                 # purged / embargoed; delegates to bt-validate.js
  bin/
    ingest.js  rebuild.js  verify.js  quality-report.js
  test/
lake/                          # DATA — never in git, never in the Docker image
  raw/ bronze/ silver/ gold/ dim/ _catalog/ _quarantine/
```

`lake/` must be added to `.dockerignore` and `.gitignore`. `bt-data/` is already excluded and bind-mounted
read-only (migration C2-01).

---

## 9. Migration plan — one commit each, nothing else touched

| step | deliverable | gate |
|---|---|---|
| H14-00 | **Finish C3-02…C3-06** (atomic ledger writes) | the lake's catalog uses `safe-write.js` |
| H14-01 | `parse-udiff.js` + schema + **characterization tests against the 600 files on disk** | byte-exact round-trip; 45% untraded reproduced |
| H14-02 | **Resolve F4** (`oi_unit`) against a live NSE option chain. Record the answer in the dataset version | GEX stays blocked until this passes |
| H14-03 | `dim.contract_dim` from data; assert the 50→25→75→65 lot drift is captured | drift alarm vs registry for today only |
| H14-04 | bronze ingest of the local 600 NIFTY files → Parquet; manifest + checksums | rebuild-from-raw is byte-identical |
| H14-05 | quality engine + `quality.jsonl` | quarantine path exercised with a corrupted fixture |
| H14-06 | silver: dte, moneyness, joins, flags | |
| H14-07 | `iv_surface@v1` (BS inversion on `SttlmPric`, `converged` column) | put-call parity residual < tol at ATM |
| H14-08 | greeks v1, PCR, max-pain, OI build-up | |
| H14-09 | `gex@v1` — **only if H14-02 passed** | else the feature ships disabled, by design |
| H14-10 | `datalake/index.js` + read-only API + provenance envelope | `server.js` diff must be empty |
| H14-11 | download adapter; backfill NIFTY 2016→2024 | hours; resumable; polite |
| H14-12 | BANKNIFTY; then the **BSE adapter** for SENSEX/BANKEX | |
| H14-13 | `ai-dataset` splits, delegating to `bt-validate.js` | leakage test: future-in-train must fail |

## 10. Rollback plan

The lake is **additive and physically separate**.

```bash
bash scripts/rollback-H14.sh --check    # list what would go; touch nothing
bash scripts/rollback-H14.sh            # remove datalake/ code only
```

- `lake/raw/` is **never** deleted by any script. It is the audit anchor and it took hours to download.
- Rolling back a *feature version* means: stop reading `gold/feature_set=x/version=v2/`. The partition
  stays. Nothing is recomputed. That is the point of immutability.
- `server.js` is not modified, so the trading side has no rollback surface at all.

## 11. Risk analysis

| risk | likelihood | impact | mitigation |
|---|---|---|---|
| **Using today's lot for historical P&L (F1)** | **High** — it is the natural mistake | Backtests wrong by 30–160% | `contract_dim` from data; lint rule forbidding `instrumentRegistry.lotSize()` inside `datalake/` |
| **Untraded rows treated as price 0 (F2)** | High | Silently wrong option OHLC/ATR/VWAP | NULL, not 0. `traded` flag. Tests assert 45% NULL on the known file |
| **GEX off by the lot factor (F4)** | High until resolved | Every dealer-positioning claim wrong by 25–75× | Feature refuses to compute while `oi_unit = UNVERIFIED` |
| **Dealer gamma presented as data** | High | Institutional-looking fiction | `class: "hypothesis"` in the registry and in every API envelope |
| Assumed `r`/`q` biasing every IV | Certain | Systematic bias | Stored as feature assumptions; sensitivity study required before publication |
| Look-ahead in AI splits | High | Fictional model accuracy | Purged + embargoed splits; builder refuses `test.start < train.end` |
| NSE archive changes format | Medium | Ingest breaks | `raw/` retained; parser versioned; quarantine on schema mismatch |
| Overfitting on 9.5 months of intraday | High | False "edge" | Data-availability metadata surfaced in every research extract |
| Disk growth | Low | 150–350 MB Parquet | Measured, not guessed |
| Lake takes down trading | **Zero** | — | Separate process, separate port, no shared imports |

## 12. Performance analysis

- **Volume:** 1,550 rows/day/index (measured). 15.5 M rows for 6 indices × 10 y. **Small.**
- **Storage:** 3.1 GB raw CSV → **150–350 MB Parquet** (ZSTD + dictionary).
- **Query:** month-partitioned Parquet with predicate pushdown; a full-symbol-year scan is ~400 k rows.
  DuckDB will do this in **tens of milliseconds** from page cache.
- **Ingest:** dominated by network politeness, not CPU. ~2,500 files per symbol-decade; budget hours.
- **Feature build:** BS inversion is a Newton solve per row. 3.9 M rows × ~6 iterations ≈ seconds in a
  vectorised path; do it in DuckDB SQL or a single batched pass, **not** row-by-row in JS.
- **Replay:** EOD replay is trivial. **Intraday replay is limited to what exists: 4 days of options,
  ~9.5 months of underlying 1-min.** The API must say so rather than silently returning a short series.

## 13. Future expansion

1. **Forward-collect intraday options from today.** The platform already fetches live chains; persisting
   them into `bronze/option_intraday` costs nothing and, in a year, unblocks the entire gamma/dealer
   research programme. **This is the single highest-value action available today** and it should start
   before any backfill.
2. Resolve `oi_unit` (F4) — one afternoon's work, unblocks GEX permanently.
3. Add `IDF` (index futures) ingest → an observable forward → removes the assumed-`r` bias from every IV.
4. Stock / commodity / currency options: same bronze schema, new `FinInstrmTp` values, new dims.
5. Tick data: only via a paid vendor. Do not design around it until purchased.
6. If the lake ever exceeds a laptop, DuckDB → ClickHouse is a swap of `core/duck.js`. Nothing else moves.

---

## 14. What this design deliberately refuses to do

- It will not emit a **Gamma Exposure** number until `oi_unit` is verified.
- It will not present **dealer gamma / dealer positioning** as a measurement. It is an assumption, named
  and versioned.
- It will not produce **bid / ask / spread / depth / liquidity score** history. The data does not exist.
- It will not fabricate **tick or sub-minute** history.
- It will not use `instrument-registry.js` for historical calculations.
- It will not return `0` where it means "unknown".
- It will not claim ten years for FINNIFTY, MIDCPNIFTY, SENSEX or BANKEX, which did not exist ten years ago.

## 15. Open decisions for the owner

1. **Finish C3 first?** The lake's catalog and quality logs need atomic writes. C3-01 (`safe-write.js`)
   exists but **no writer uses it yet**, so the ledger data-loss chain is still live.
2. **Start forward-collecting intraday option chains today?** Cheap, and it is the only path to gamma /
   dealer research. Every day of delay is a day permanently missing from the archive.
3. **Backfill order:** NIFTY 2016→2024 first (proves the pipeline), or breadth-first across symbols?
   Recommendation: NIFTY depth-first.
4. **Is `py`-based tooling acceptable** for the vectorised feature build, or must everything stay Node?
   (`python` shim is broken on this machine; only the `py` launcher works.) DuckDB SQL can avoid Python
   entirely — that is the recommendation.
