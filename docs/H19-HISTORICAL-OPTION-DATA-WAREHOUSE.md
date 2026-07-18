# H19 — Historical Option Data Warehouse: Complete Architecture

**Role:** Principal Quant Systems / Data Architect, ANTIGRAVITY PRO.
**Nature:** production data-architecture design. **No production code. No modification of
any existing module.** Enhance-only, additive, parallel.
**Doctrine:** raw is the source of truth · raw is permanent · never aggregate away raw ·
derived must be reproducible from raw · nothing auto-deleted · fail closed · `null ≠ 0`.
**Evidence grades used everywhere:** **[V] Verified** (read in code/disk today) ·
**[R] Recommended** (my design call, justified) · **[O] Optional** (viable alternative) ·
**[U] Unknown** (not measured — stays unknown).

---

## 0. WHY THIS EXISTS — the verified gap

The current system does **not** warehouse option history. It keeps a live view and two
thin durable stores, both lossy for research. Measured on disk today:

| Store | What it holds [V] | Durability [V] | Research verdict |
|---|---|---|---|
| `_optHL` (RAM) + `data/opthl/<date>.json` (15 files, 628 KB) | per-strike/day **scalar** `{high, highAt, low, lowAt}` only | daily file keeps ~120 days; the **intra-day extreme-break *timeline* is NOT in the file** (only in RAM cap-200 + Redis 12 h TTL) | loses the path — cannot study *how* an extreme formed |
| `_optMin` (RAM) + `data/opt-candles/<date>.json` (8 files, 24 MB) | per-strike/day 1-min `[t, o, h, l, c]` of **premium only** (`volume` written as `0`; no OI/IV/bid-ask/greeks/underlying) | **auto-deletes after 40 files** (`while files.length > 40 unlink`) | **actively violates "never delete minute data" right now**; columns absent |
| Redis mirror | intraday H/L, ORB, breakouts, per-strike opt H/L | **12 h TTL, fire-and-forget** | a same-day cache, not a system of record |
| Raw ticks | — | **none — ticks are aggregated into minute bars immediately and discarded** | **violates "raw is source of truth"** |

**Verified conclusion:** the user's framing is correct. Beyond 12 hours, only scalar
day-extremes and 40 days of premium-only minute bars survive; raw observations never
persist. The warehouse below is the missing foundation. It is **new and parallel** — the
four stores above keep running untouched; the warehouse becomes the durable SoT going
forward and can *backfill* from opt-candles/opthl/Redis for the days those still hold.

**Non-negotiable design consequence:** the warehouse must **tee off** the tick stream as a
read-only sink. It changes no existing behaviour. The *only* future code touch is a single
additive registration hook (≤5 LOC), which ships as its own approval package — not part of
this design.

---

## PART A — THE ARCHITECTURE

## 1. COMPLETE DATABASE ARCHITECTURE

### 1.1 The layered model (WORM raw → reproducible derived)
```
INGEST     WarehouseSink (new, parallel)  ── tees the SAME normalized tick that
             │                                already passes through hl-verify;
             │  append-only, non-blocking     never mutates the live path
             ▼
L0 RAW     Tick WAL (immutable, append-only, line-delimited)         ── SOURCE OF TRUTH
             │   never edited, never deleted, never aggregated in place
             ▼   (nightly, idempotent, verifiable)
L1 CANON   Minute Candles + Option-Chain Snapshots (derived from L0, full columns)
             ▼
L2 STRIKE  Strike History + Strike Summary (per strike, per day)
             ▼
L3 DAILY   Daily / Expiry / Underlying / Session summaries
             ▼
L4 MARTS   Research datasets (18) — regenerable from L0
             ▼
L5 AI      Feature / Label / Outcome / Sequence tables — regenerable from L0
```
**Rule enforced by construction:** data only flows *down*. L1–L5 are **pure functions of
L0**. Any of L1–L5 may be deleted and **rebuilt bit-for-bit from L0** — that is the
reproducibility contract (§12.3). L0 is the only irreplaceable layer.

### 1.2 Engine choice [R]
- **L0 raw:** **JSONL** (newline-delimited JSON), one file per partition, append-only.
  Chosen because appends are crash-tolerant (a torn final line is detectable and
  discardable without corrupting prior rows), human-inspectable, and dependency-free —
  matching the repo's file-based ethos. **[R]**
- **L1–L5 analytical:** **Apache Parquet** (columnar) queried by **DuckDB** (embedded,
  server-less, reads Parquet directly with SQL). Rationale: 10-year option research is a
  columnar-scan workload (select 3 columns across 2 years); Parquet gives 10–20× compression
  and column pruning; DuckDB needs no running server, preserving the "no heavy infra" ethos.
  **[R]** — this is a *new dependency decision*, not present today (`trading.db` is a
  vestigial empty directory [V]).
- **Fallbacks:** if zero new dependencies is a hard constraint → keep everything JSONL +
  gzip and query with streaming readers (**[O]**, slower at scale). If a server is
  acceptable at 5-year scale → **ClickHouse** for the tick tier (§14). **[O]**

### 1.3 The universal raw row (every column the task listed, plus provenance)
One L0 tick row = the complete observation. **No column is ever dropped; unknowns are
`null`, never `0`.**

| Group | Fields |
|---|---|
| Identity | `trading_day_id`, `session_id`, `exchange_ts`, `recv_ts`, `wall_ts` |
| Instrument | `underlying`, `expiry`, `strike`, `opt_type` (CE/PE), `token/security_id` |
| Context | `underlying_price`, `atm_strike`, `atm_distance`, `days_to_expiry`, `moneyness` |
| Price | `ltp`, `bid`, `ask`, `spread`, `open`, `high`, `low`, `close`(session-so-far) |
| Flow | `volume`, `oi`, `oi_change`, `iv` |
| Greeks (if present) | `delta`, `gamma`, `theta`, `vega`, `rho`, `r_used` |
| Provenance | `source` (dhan_ws/dhan_rest/upstox/backfill), `quality_flag`, `verify_tier`, `schema_version`, `ingest_hash` |

**`quality_flag` enum [R]** (rows are *flagged, never discarded* — the rule "never discard
information"): `OK · STALE · OUT_OF_ORDER · GAP · WS_UNCONFIRMED · SUSPECT_SPIKE · MISSING ·
BACKFILLED`. **`verify_tier`** reuses the existing hl-verify vocabulary [V]:
`FEED_VALIDATED · EXCHANGE_RECONCILED · null`. Derived layers filter on these; raw keeps
everything.

### 1.4 The historical tables (all 13 requested)
Fact = raw/measured; Dim = slowly-changing reference; Mart = derived.

| # | Table | Layer | Grain | Type | Immutable? |
|---|---|---|---|---|---|
| 1 | **Raw Tick History** | L0 | one observation | Fact | **Yes — WORM** |
| 2 | **Minute Candles** | L1 | strike × minute | Fact(derived) | rebuildable |
| 3 | **Option Chain Snapshot** | L1 | full chain × interval | Fact(derived) | rebuildable |
| 4 | **Market Snapshot** | L1 | index/market × interval | Fact(derived) | rebuildable |
| 5 | **Strike History** | L2 | strike × day (event series) | Fact(derived) | rebuildable |
| 6 | **Strike Summary** | L2 | strike × day (one row) | Mart | rebuildable |
| 7 | **Daily Summary** | L3 | instrument × day | Mart | rebuildable |
| 8 | **Expiry Summary** | L3 | expiry | Mart | rebuildable |
| 9 | **Underlying History** | L1 | index × minute + tick | Fact(derived) | rebuildable |
| 10 | **Session Metadata** | Dim | session | Dim | append-only |
| 11 | **Trading Calendar** | Dim | day | Dim | corrections logged |
| 12 | **Event Calendar** | Dim | event | Dim | append-only |
| 13 | **Research Tables** | L4/L5 | varies (§12–13) | Mart | rebuildable |

Dimensions 10–12 are **owned by the Instrument Registry family** (single-source-of-truth,
per doc 000) — the warehouse *reads* the registry's expiry calendar and market-session
truth; it does not invent a parallel calendar.

### 1.5 Per-strike stored fields (Strike Summary, all requested)
Each is a **derived** L2 value, reproducible from L0: `first_seen`, `last_seen`,
`highest_premium` + `highest_time`, `lowest_premium` + `lowest_time`, `opening_premium`,
`closing_premium`, `max_expansion`, `max_decay`, `largest_1m_move`, `largest_5m_move`,
`largest_15m_move`, `recovery`, `collapse`, `premium_velocity`, `premium_acceleration`.
Each row also carries `source_partition` + `rebuild_hash` for the reproducibility check.

### 1.6 Per-paper-trade stored fields (Trade Outcome, all requested)
The warehouse **observes** paper trades (it does not place them; the engines own that per
doc 000). For each closed paper trade it stores, all **derived from L0** so MFE/MAE are
measured against real ticks, not the engine's sampling: `entry`, `exit`, `reason`, `MFE`,
`MAE`, `best_exit` + `best_exit_time`, `worst_exit` + `worst_exit_time`,
`max_possible_profit`, `max_possible_loss`, `profit_left_on_table`, `entry_efficiency`,
`exit_efficiency`, `holding_efficiency`, `strike_efficiency`. This is the foundation for
exit-optimization and maximum-profit analytics — the stated objective.

---

## 2. FOLDER ARCHITECTURE
```
data/warehouse/                      ← new root; existing data/opthl, data/opt-candles untouched
  L0_raw/
    ticks/<underlying>/<expiry>/<trading_day>.jsonl        (+ .jsonl.gz once sealed)
    _wal/<trading_day>/<session>.wal.jsonl                 (open, being appended)
  L1_canon/
    minute/<underlying>/<expiry>/<trading_day>.parquet
    chain_snap/<underlying>/<trading_day>.parquet
    underlying/<underlying>/<trading_day>.parquet
  L2_strike/
    history/<underlying>/<expiry>/<trading_day>.parquet
    summary/<underlying>/<trading_day>.parquet
  L3_daily/
    daily/<underlying>/<year>.parquet
    expiry/<underlying>/<expiry>.parquet
  L4_marts/<dataset_name>/<partition>.parquet
  L5_ai/<dataset_name>/{features,labels,outcomes}/<partition>.parquet
  _dim/  calendar.parquet  sessions.parquet  events.parquet  instruments_snapshot.parquet
  _manifest/  <trading_day>.manifest.json      (row counts, hashes, rebuild lineage)
  _archive/  cold/<year>/...                    (compressed, immutable)
```
**Boundary:** the warehouse writes only under `data/warehouse/`. It never writes into the
existing `data/opthl/` or `data/opt-candles/`. Zero blast radius on live trading.

## 3. FILE NAMING CONVENTION
- Partition key everywhere: **`<underlying>/<expiry>/<trading_day>`** — the natural query,
  lifecycle, and archival boundary.
- `trading_day` = `YYYY-MM-DD` (IST). `expiry` = `YYYY-MM-DD`. `session` = `YYYYMMDD-NNN`.
- State suffix encodes lifecycle: `.wal.jsonl` (open) → `.jsonl` (sealed) → `.jsonl.gz`
  (compressed) → `.parquet` (canonicalized). **A file's name tells you its lifecycle stage.**
- Immutability marker: sealed L0 files are content-addressed — a sidecar
  `<file>.sha256` fixes the hash; any later change is detectable (§10).
- Never reuse a filename with different content. A correction is a **new** dated file +
  a manifest entry, never an in-place overwrite (rule: never overwrite historical data).

## 4. DATA FLOW DIAGRAM
```
 Broker feed (Dhan WS 8–30% + REST reconcile [V]) ──► existing normalize + hl-verify [V]
                                                          │  (unchanged)
                                        (tee, read-only)  ▼
                                                   WarehouseSink  ──► in-RAM ring buffer
                                                          │              │ (backpressure-safe)
                                    background flush (≤1 Hz, off the trade loop)
                                                          ▼
                                            L0 WAL append (fsync-batched)
                                                          │
                        ── session close / nightly batch (idempotent) ──
                                                          ▼
             seal WAL → L0 .jsonl(.gz) ──► build L1 ──► L2 ──► L3 ──► L4 ──► L5
                                                          │
                                                write _manifest (counts + hashes)
```
**Key property:** the trade loop's only added work is one non-blocking enqueue; all disk
I/O happens on a background cadence. If the sink queue is full it **drops to a counter and
flags `GAP`** (fail-closed on the *warehouse*, never on the *trade loop*) — a recorded gap
is honest; a stalled trade loop is not.

## 5. STORAGE LIFECYCLE (HOT / WARM / COLD)
| Tier | Age | Location / format | Purpose | Retention |
|---|---|---|---|---|
| **Hot** | today | RAM ring + L0 WAL (JSONL) on local SSD | live dashboard, same-day research | sealed at session close |
| **Warm** | ~0–180 days [R] | L0 `.jsonl.gz` + L1–L3 Parquet on local disk | active quant research, DuckDB queries | **never deleted** |
| **Cold** | >180 days | Parquet in `_archive/` (+ off-box object store) | long-horizon 10-yr research | **never deleted** |
Movement is **copy-then-verify-then-relabel**, never move-then-hope. Age thresholds are
[R]; the invariant is **nothing is deleted by any tier** — cold is compression + relocation,
not expiry.

## 6. INDEX STRATEGY
- **Physical index = the partition path** (`underlying/expiry/trading_day`) — most quant
  queries are scoped by instrument + date range, so partition-pruning is the primary index.
- **Within a Parquet file:** row-groups sorted by `exchange_ts`; column min/max statistics
  give predicate push-down on `strike`, `atm_distance`, `dte` for free. **[R]**
- **A DuckDB catalog view** over the Parquet tree gives SQL indexing without a server. **[R]**
- **Manifest index:** `_manifest/<day>.json` lists partitions, row counts, and hashes so a
  query planner (or a human) finds data without a directory walk. **[R]**
- No B-tree/secondary-index engine is needed at this scale — columnar stats + partitioning
  dominate. Revisit only at ClickHouse scale (§14). **[R]**

## 7. COMPRESSION STRATEGY
- L0 hot WAL: uncompressed (append speed). On seal → **gzip** the JSONL (`~8–12×` on
  option JSON [R]).
- L1–L5 Parquet: **ZSTD** column compression + dictionary encoding for low-cardinality
  columns (`opt_type`, `quality_flag`, `verify_tier`, `source`) + delta encoding for
  monotonic `exchange_ts`. Expected `~10–20×` vs raw JSON. **[R]**
- **Never compress in a way that loses precision** — Parquet stores exact numerics; no
  float truncation, no down-sampling. Compression is lossless only. **[V-principle]**

## 8. BACKUP STRATEGY
- **3-2-1:** 3 copies, 2 media, 1 off-site. Concretely [R]: (1) live local disk,
  (2) a second local/attached disk nightly rsync, (3) off-box object storage weekly for
  cold + daily for the day's sealed L0.
- **L0 is the only mandatory backup target** — because L1–L5 are reproducible, backing up
  L0 + the manifest + the transform code version is sufficient to reconstruct everything.
  This makes backups small and cheap relative to total footprint. **[R]**
- Backups are **append-only mirrors**; a backup job may never delete on the target to
  mirror a (forbidden) source deletion. **[R]**

## 9. RECOVERY STRATEGY
- **Crash mid-session:** the open WAL's last line may be torn → the reader validates
  line-by-line, discards only the final incomplete line, keeps all prior rows. No prior
  data lost (this is why L0 is line-delimited, not one big JSON). **[R]**
- **Lost L1–L5:** rebuild from L0 by re-running the transforms; verify the rebuild hash
  against the manifest. **[R]**
- **Lost L0 partition:** restore from backup tier; if unrecoverable, mark the partition
  `MISSING` in the manifest and **leave the gap explicit** — never synthesize (rule:
  `null ≠ 0`, unknown stays unknown). **[R]**
- **RPO/RTO [R]:** RPO ≤ one flush interval (≤1 s of ticks, flagged if dropped);
  RTO for derived tables = one rebuild pass; RTO for raw = restore-from-backup time.

## 10. CORRUPTION PROTECTION
- Every sealed L0 file has a `.sha256` sidecar; the manifest records it. A periodic scrub
  re-hashes and alerts on mismatch. **[R]**
- Parquet has built-in per-page CRC; DuckDB surfaces read errors rather than silently
  skipping. **[R]**
- **Poison-row isolation:** a malformed raw row is written to a `_quarantine/` sidecar with
  its parse error and flagged, **not dropped and not allowed to abort the batch** (never
  discard information; fail closed on the *row*, not the *pipeline*). **[R]**
- Reuse the repo's proven `safe-write.js` (atomic + `.bak` + refuse-on-corrupt) for all
  manifest/summary writes [V] — do not reinvent atomicity.

## 11. ATOMIC WRITE STRATEGY
- **Appends (L0 WAL):** append + batched `fsync`; a torn tail is recoverable (§9). Appends
  never rewrite existing bytes → historical rows are physically immutable. **[R]**
- **Whole-file publishes (L1–L5, manifests):** **write-temp → fsync → atomic rename** into
  place; readers only ever see complete files. This is the `safe-write.js` pattern extended
  to Parquet. **[R]**
- **Never** open a historical file in write/truncate mode. The only legal mutations are
  *append to today's WAL* and *atomic-create a new file*. Enforced by convention + a scrub
  that flags any mtime change on a sealed file. **[R]**

---

## PART B — RESEARCH & AI DATASETS

## 12. RESEARCH DATASET ARCHITECTURE (L4 marts)
Each of the 18 requested datasets is a **named, versioned, regenerable** Parquet mart with
a declared definition + `source_partitions` + `rebuild_hash`. All are pure functions of L0;
none is a primary store. Definitions (grain → what it measures):

| Dataset | Grain | Measures (from L0) |
|---|---|---|
| Maximum Profit Mapping | trade / strike-day | best achievable P&L vs realized (exit-optimization foundation) |
| High-Low Mapping | strike-day | extreme levels + the *timeline* of how they formed |
| Strike Rotation | chain-day | how activity/OI/volume migrates across strikes over the day |
| Premium Expansion | strike-interval | up-moves in premium, magnitude + speed |
| Premium Decay | strike-interval | theta-driven bleed, isolated from directional moves |
| Gamma Behaviour | strike-interval | premium convexity near ATM into expiry |
| Expiry Behaviour | expiry | intraday/terminal dynamics on expiry days |
| ATM Shift | day | ATM strike migration vs underlying |
| OI Build-up | strike-interval | rising OI + price context |
| OI Unwinding | strike-interval | falling OI + price context |
| Volume Expansion | strike-interval | volume surges |
| IV Expansion | strike-interval | rising IV episodes |
| IV Crush | expiry/event | IV collapse around events/expiry |
| Gap Analysis | day-open | overnight gap in premium/underlying + fill behaviour |
| Premium Elasticity | strike-interval | Δpremium per Δunderlying (empirical delta) |
| Time Decay | strike-day | realized decay curve vs theoretical |
| Momentum | strike-interval | persistence of premium moves |
| Mean Reversion | strike-interval | reversion of premium extremes |

**Reproducibility contract (the spine):** a mart row stores the L0 partitions + transform
version it was built from; a nightly check rebuilds a sample and compares hashes. If a mart
and L0 ever disagree, **L0 wins and the mart is rebuilt** — automatically, no human call.

## 13. AI DATASET ARCHITECTURE (L5 — build datasets, do NOT train)
Structured for future modelling; **no model is trained here.** Strict train/serve integrity:
**every feature is point-in-time** — computed only from data with `exchange_ts ≤ decision_ts`
(no look-ahead; the repo's live look-ahead bugs [V] are precisely what this prevents).

| Table | Shape | Content |
|---|---|---|
| **Feature Tables** | (entity, ts) × features | point-in-time features from L0/L1/L2 |
| **Label Tables** | (entity, ts) × labels | forward outcomes (e.g. premium at t+k), stored with the horizon k explicit |
| **Outcome Tables** | trade × outcome | realized + counterfactual best/worst (from §1.6) |
| **Sequence Learning** | (entity) × ordered steps | variable-length event sequences per strike-day |
| **Transformer Input** | tokenized/normalized sequences | fixed-schema windows + attention mask + padding flags |
| **LSTM Input** | (batch, timesteps, features) | windowed tensors + normalization stats stored beside |
| **Reinforcement Learning** | (state, action, reward, next_state) | exit-timing MDP tuples from real ticks |
| **Pattern Recognition** | labelled windows | motif windows + human/derived labels |
| **Probability Calibration** | (predicted_p, realized_outcome) | for reliability curves — feeds the "reliability MEASURED not null" rule [V] |

**Leakage guard [R]:** each AI table stores its `decision_ts`, `label_horizon`, and a
`no_lookahead: true` assertion validated at build time. Normalization statistics are stored
**per split** (never global) to prevent train/test contamination.

---

## PART C — SCALE, RISK, OPERATIONS

## 14. FUTURE SCALABILITY PLAN
- **Now → 2 yr:** in-process sink + JSONL/Parquet + DuckDB on one box. Handles the estimated
  volumes (§18) comfortably. **[R]**
- **2 → 5 yr:** if tick volume or query concurrency grows, split the sink into an
  **out-of-process recorder** (its own broker subscription or a tail of the WAL) so recording
  and trading share nothing but disk. **[O]** Trade-off: a second broker WS connection —
  broker connection limits are **[U]**, must be checked before adopting.
- **5 yr+:** move the tick tier to **ClickHouse** (or DuckDB-over-object-store) if
  cross-instrument, multi-year tick scans become routine; L0 JSONL remains the immutable
  feed into it. **[O]**
- **Horizontal:** partitioning by instrument/expiry means research jobs shard naturally
  (one worker per partition). **[R]**

## 15. RISK ANALYSIS
| Risk | Severity | Mitigation |
|---|---|---|
| Sink back-pressure slows the trade loop | 🔴 Critical (violates the prime directive) | non-blocking enqueue; bounded ring; drop-to-counter + `GAP` flag; **all** disk I/O off-loop [R] |
| Disk fills → writes fail | 🟠 High | capacity monitor; cold-archival to object store; alert at threshold; L0 is small vs derived [R] |
| Second WS connection breaks the live feed | 🟠 High | prefer in-process tee (no 2nd connection) until broker limits known [U] |
| Silent divergence L0 ↔ derived | 🟠 High | reproducibility hash check; L0 always wins [R] |
| A new dependency (Parquet/DuckDB) adds ops surface | 🟡 Medium | embedded/server-less choice; JSONL-gz fallback [O] |
| Corruption of a raw partition | 🟠 High | sha256 sidecars + 3-2-1 backup + explicit `MISSING`, never synthesized [R] |
| The one wiring hook touches a protected file | 🟡 Medium | ships as its own ≤5 LOC approval package; owner commits [V-rule] |

## 16. MISSING DATA HANDLING
- **Absent ≠ zero.** A missing tick/field is `null` with a `quality_flag`, never `0`
  (reuses hl-verify's "UNKNOWN IS NULL, NEVER ZERO" doctrine [V]).
- **Gaps are first-class rows:** a detected feed gap writes an explicit `GAP` marker with
  its span, so research can *see* the hole rather than interpolate over it.
- **No silent imputation in L0/L1.** Any imputation lives only in a clearly-named L4/L5
  *derived* table (e.g. `..._imputed`), never in raw or canonical layers, and records its
  method. **[R]**
- **Backfill is labelled:** rows reconstructed from opt-candles/opthl/Redis carry
  `source=backfill`, `quality_flag=BACKFILLED`, so backfilled history is never mistaken for
  live-captured history. **[R]**

## 17. PERFORMANCE ESTIMATION [Estimated — assumptions stated]
Assumptions (grade **[U]** on exact tick rate; ranges given, not点 estimates):
~6 instruments × ~40 active strikes × 2 types ≈ **480 option series**; ~1 update/sec/series
over a 6.25 h session ≈ **~10.8 M raw rows/day** at the high end (fewer if WS delivery stays
8–30% [V]).
- **Ingest cost on the trade loop:** one enqueue per tick ≈ *O(100 ns)*; **no disk I/O on
  the loop.** Estimated live-loop impact: **negligible / unmeasurable** — the design goal. [R/Est]
- **Background flush:** batched append at ≤1 Hz; sequential writes, trivially within SSD
  throughput. [Est]
- **Nightly batch (L0→L5):** one pass over the day's partitions; minutes, not hours, at this
  volume. [Est]
- **Research query (DuckDB over Parquet):** partition-pruned column scans → sub-second to
  seconds for typical instrument/date-range queries. [Est]

## 18. STORAGE ESTIMATION [Estimated — from the [V] baseline]
Anchored to the measured `24 MB / 8 days` of premium-only minute JSON [V] ≈ **3 MB/day**,
scaled to the full-column raw warehouse:
| Layer | Per day | Per year (~250 days) | 10 years |
|---|---|---|---|
| L0 raw JSONL (uncompressed) | ~2–3 GB [Est] | ~0.5–0.75 TB | ~5–7.5 TB |
| L0 sealed gzip (~10×) | ~200–300 MB | ~50–75 GB | ~0.5–0.75 TB |
| L1–L3 Parquet (derived) | ~150–250 MB | ~40–60 GB | ~0.4–0.6 TB |
| L4+L5 marts (rebuildable) | variable | tens of GB | rebuildable — not a floor |
**10-year mandatory footprint (L0 gz + derived Parquet):** **~1–1.5 TB [Est]** — a single
commodity disk. If exact tick rate is lower (likely, given WS 8–30% [V]), materially less.
**Backup-critical subset (L0 + manifests):** ≤ ~0.75 TB over 10 years. Entirely feasible.

## 19. FUTURE MIGRATION ROADMAP (design → live, enhance-only)
0. **Design ratified** (this doc). Zero code.
1. **Backfill importer (read-only):** a standalone job reads existing `data/opt-candles/`,
   `data/opthl/`, Redis into L0 as `BACKFILLED`, before opt-candles' 40-file purge erases
   more. **Time-critical** — every day of delay loses 1 more day of minute history. [R]
2. **WarehouseSink module (parallel, off by default):** new file, no wiring yet; unit +
   characterization + performance + rollback tests per the Testing Rule [V].
3. **The single wiring hook (approval package, ≤5 LOC):** register the sink on the existing
   tick path; owner commits. Shadow-runs writing L0 only.
4. **Derivation batch (L1–L3):** nightly transforms + manifests + reproducibility check.
5. **Marts + AI datasets (L4–L5):** built on demand from L0; no live-path involvement.
6. **Tiering + backup + scrub:** hot/warm/cold movement, 3-2-1, sha256 scrub.
7. **Scale-out (if/when §14 triggers fire).**
Each step is additive and independently reversible; the live trade loop is untouched until
step 3, and even then only *reads* the tick.

## 20. FINAL RECOMMENDED ARCHITECTURE
**Build a WORM raw tick warehouse as a parallel, non-blocking sink; derive everything else
reproducibly; delete nothing, ever.**

- **L0 = append-only JSONL, immutable, the single source of truth.** Every column the task
  listed, plus provenance + quality/verify flags. `null ≠ 0`. **[R]**
- **L1–L5 = Parquet, columnar, queried by embedded DuckDB, 100% regenerable from L0.** The
  reproducibility hash contract makes raw authoritative by construction. **[R]**
- **Tee off the existing hl-verify tick path; never modify it.** One future ≤5 LOC hook,
  shipped as its own approval package. Existing `opthl`/`opt-candles`/Redis keep running. **[V-rule]**
- **Fix the active violation first:** the `opt-candles` 40-file auto-purge is deleting minute
  history *now* [V] — the backfill importer (step 1) must run before more is lost. This is the
  one **time-critical** action in the whole plan.
- **Retention = permanent for raw/minute/daily/trade/outcome; research/AI = regenerate.**
  Cold tier compresses and relocates; it never expires. **[R]**

**Institutional one-liner:** *raw observations are the firm's permanent memory; every
statistic, probability, and AI feature is a disposable view over that memory — so the memory
must be captured completely, written once, and never touched again.*

---

## APPENDIX — EVIDENCE LEDGER
**[V] Verified today:** opthl scalar-only save + ~120-day retention (`server.js:551-565`);
opt-candles premium-only minute bars + **40-file auto-delete** (`server.js:594-609`);
`volume` stored as `0`; 24 MB/8 days on disk; no raw tick persistence; Redis 12 h TTL
fire-and-forget; hl-verify two-tier vocabulary; `trading.db` vestigial; safe-write atomicity.
**[R] Recommended (my calls):** JSONL-L0 + Parquet/DuckDB engine; partition scheme;
compression codecs; tiering thresholds; backup 3-2-1; quality-flag enum.
**[O] Optional:** JSONL-gz-only (no new deps); out-of-process recorder; ClickHouse at scale.
**[U] Unknown (left unknown):** exact per-day tick count (WS delivery variance); broker WS
connection limits for a second subscription; whether afternoon/agents ledgers should also
feed L5 trade-outcomes (needs owner intent).
