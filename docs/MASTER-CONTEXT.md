# ANTIGRAVITY PRO — MASTER CONTEXT
## The single document. Everything is here.

> **How to use this file.** Paste it whole into ChatGPT (or any assistant). It is self-contained.
> You do not need any other document.
>
> **You may also ask the assistant to hand you back a Master Prompt** for the next module. Section 12
> tells it exactly how, and Section 13 is the template. That prompt can then be pasted into a fresh
> session — including back into Claude Code — and work continues without losing context.
>
> Written 2026-07-09. Every number in this document was **measured against the running code and the files
> on disk**, or against the **live broker API**. Nothing is recalled from memory. Where something is
> unverified, it says so explicitly.

---

## 1. What the project is

**Antigravity Pro** — a **100% paper-trading** Indian index-options platform. Node.js + Express.
**Runs locally only.** No live order execution. No cloud deployment required.

Purpose: research, analytics, backtesting, replay, paper trading, AI signal generation, an institutional
dashboard.

| | |
|---|---|
| `server.js` | **7,301 lines, 168 routes**, no `express.Router`, no error middleware. This is the monolith |
| modules | 127 tracked JS files, mostly pure leaves |
| tests | **33 suites** (23 at session start) |
| brokers | **Dhan** (`live-connector.js`), **Upstox** (`upstox-connector.js`). AmiBroker is a **signal source only** |
| HEAD | `9434467`, **16 commits this session, all local, nothing pushed** |

### The validated edge
**Volatility Risk Premium — option SELLING.** Directional option **buying has no edge**: a 1,200-trade
real-data backtest gave **PF 0.94**, a net loser. `strangle-engine.js` (paper) is the product face.
`gamma-blast-engine.js` is the one *buying* strategy with a rationale (gamma dominates theta at 0-DTE), and
it is **forward-test only**.

### Standing rules from the owner
- **Never rewrite. Enhance only.** `server.js` and `execution-engine.js` are protected — each edit needs
  individual approval. Exactly **one** `server.js` line was changed all session (`+5/−1`), and only after
  the suite was green three times.
- **Never commit unasked. Never push.**
- Identify the **root cause** before fixing. Prefer the **smallest** change.
- **Never fix unrelated issues in one commit.**
- **Characterization tests first** — pin current behaviour (including the bug), prove the tripwire fires,
  then change.
- **Run the full suite gated on exit code**, never on grepping output. Never commit a red suite.
- **Fail closed.** Refuse rather than emit a plausible wrong number. **`null ≠ 0`.**
- **Never hide technical debt.** Raise it with evidence and a recommended remediation.
- **Never invent market behaviour.** Classify every claim: **Verified / Probable / Hypothesis / Unknown.**
- Replies to the owner are in **Gujarati script**; code, paths and identifiers stay English.

---

## 2. Work completed this session — 16 commits

Each followed the same protocol: backup + `ROLLBACK.sh` → root cause → smallest change → characterization
test proven to fail first → full suite gated on exit code → migration log + audit log → one concern per
commit.

### 2.1 The Instrument Registry

`instrument-registry.js` is now the single source of truth, verified against the **broker contract master**
(`GET https://api.upstox.com/v2/option/contract`):

| inst | lot | tick (raw/₹) | strike step | expiry type | expiryDow | exchange | trading |
|---|---|---|---|---|---|---|---|
| NIFTY | 65 | 5 / 0.05 | 50 | WEEKLY_AND_MONTHLY | Tue | NSE | on |
| BANKNIFTY | 30 | 5 / 0.05 | 100 | MONTHLY | Tue | NSE | on |
| SENSEX | 20 | 5 / 0.05 | 100 | WEEKLY_AND_MONTHLY | Thu | BSE | on |
| FINNIFTY | 60 | 5 / 0.05 | 50 | MONTHLY | Tue | NSE | **off** |
| MIDCPNIFTY | 120 | 5 / 0.05 | **25** | MONTHLY | Tue | NSE | **off** |
| BANKEX | 30 | 5 / 0.05 | 100 | MONTHLY | Thu | BSE | **off** |

Design decisions that must carry forward:

- **Fail-closed, two surfaces.** The *trading surface* (`lotSize`, `step`, `tickSize`, `getMeta`,
  `instruments`) answers only for `tradingEnabled` instruments. The *catalog surface* (`catalog`,
  `allInstruments`, `isTradingEnabled`) exposes verified metadata regardless.
  **Reading metadata is not permission to trade.** This let three instruments be added while editing
  **zero engines** and changing **zero behaviour**.
- **`tickSize` was measured, not assumed.** `tick_size: 5` is ambiguous; **429 live LTPs** across NSE and
  BSE proved it is **paise** (₹0.05). Both `tickRaw: 5` and `tickSize: 0.05` are stored.
- **Two segment vocabularies stored on purpose.** Upstox returns `NSE_FO`; Dhan and `server.js`
  `INSTRUMENT_META` say `NSE_FNO`. Both are right *for their own broker* — which is exactly why a
  broker-specific string must not live in shared instrument metadata. It becomes an active bug the day
  failover lands.
- **SPAN margin deliberately excluded** — it is an exchange risk parameter that changes daily, not
  contract metadata.

`npm run preflight:registry` verifies all 6 instruments × 4 fields against the live broker.
Exit 0 = verified, 1 = drift, 2 = could-not-check. **A broker outage is never reported as agreement.**

### 2.2 Bugs found and fixed — each measured before fixing

| # | Defect | Impact | Commit |
|---|---|---|---|
| 1 | `.env.example` shipped `NIFTY_LOT_SIZE=75`, `BANKNIFTY_LOT_SIZE=35`. Those env keys **override** the verified registry in 3 consumers | `cp .env.example .env` silently reverted the whole migration; P&L +15.4% / +16.7% | `c42f5ec` |
| 2 | `crash-analyzer.js`, `forward-test-logger.js`, `backtest-tv/run.js` were `require`d but never `git add`ed | **A fresh clone crashed at boot.** `Dockerfile COPY . .` hid it — a local build worked, a CI build never would | `bbdd501` |
| 3 | `pop-seller.js:18` `LOT_SIZE = {NIFTY:75, BANKNIFTY:35, FINNIFTY:65…}` + `\|\| 75` fallback | NIFTY paper P&L −13.3% after fix; MIDCPNIFTY (true lot 120) was priced at 75 | `d0558fd` |
| 4 | **`pop-seller.js:31` had the expiry weekdays exactly swapped.** It assumed NIFTY=Thursday, SENSEX=Tuesday. Broker: NIFTY expires **Tuesday**, SENSEX **Thursday**. It also assumed a weekly expiry for 4 MONTHLY-only instruments | `T` feeds Black-Scholes. **BANKNIFTY at 5% OTM reported 100.0% PoP when the truth was 91.8%** — wrong in the direction that makes a position look *safer* | `6e9380a` |
| 5 | `pop-seller.js:51` `bsDelta` returned `±1` whenever `T<=0`, ignoring moneyness | A worthless deep-OTM call at expiry reported **PoP 0%** instead of 100%. Inverted | `8e5903d` |
| 6 | `position-sizer.recommend()` **never received an `inst`** (`strangle-engine:254,392,393`), so one global `lotSize:75` sized every instrument | Condor margin over-estimated +15.4% NIFTY, +25.8% SENSEX → silently **under-sized the book** | `0908896` |
| 7 | No way to detect a stale registry | A drifted registry is worse than none: every engine trusts it, no test fails | `62a8d6a` |
| 8 | `Math.round(spot/50)*50` inlined ≥12×; `STEP` map triplicated | All wrong for MIDCPNIFTY (interval **25**): at spot 13030 they yield 13050, a contract that **does not exist** | `fddc540`, `05362a9` |
| 9 | **`option-analyzer.js:229` hardcoded "SENSEX weekly expiry: Tuesday."** Wrong on **every** weekday; on expiry morning it reported **5.00 days** when the truth was **0.50** (10×) | ATM gamma scales as `1/√T` → gamma understated ≈3.16×, vega overstated ≈3.16×, on the one day gamma dominates. Scope: the **fallback** Greeks path only | `7d1ca3c` |
| 10 | Docker `COPY . .` baked `data/` (49 JSON ledgers) into the image, and compose had **no volume for `/app/data`** | **Every rebuild reset paper history and discarded forward-test evidence.** `config-overrides.json` carries `STRANGLE_ENGINE_ENABLED`, `STRANGLE_CAPITAL`, `AI_AGENTS_ENABLED` | `9434467` |

**Bug 4 is the most serious.** It silently inflated the single number `pop-seller` exists to produce.

Result: **5 of 6 production engines** read instrument metadata exclusively from the registry. The sixth
(`execution-engine`) receives lot/step as constructor args from `server.js` — both protected.
**27 duplicate market-metadata sites remain** outside the engines (`server.js` 17, `live-connector` 3,
`option-analyzer` 3, `free-chain` 3, `sensibull-fetcher` 1).

### 2.3 Corrections made against myself — recorded, not hidden

- I claimed `Dockerfile COPY . .` could bake `.env` into an image. **Wrong** — `.dockerignore` already
  excluded `.env` and `.env.*`. A credential scan of the whole build context found nothing.
- I committed once against a **red suite** because my shell gate was `grep -E "FAILED"`, which *succeeded*
  when it found the word "FAILED". Reset and redone, gated on **exit code**.
- Three test-authoring errors where **the code was right and I was wrong**: an ATM delta of 0.5326
  (correct: 0.5579 — the 6.5% drift lifts it above 0.50); an assertion written `x !== x || true`, which can
  never fail; and an IV-monotonicity test that failed because both ends saturate the 25-lot cap — which
  exposed a **real blind spot** (above the cap, IV scaling has no effect at all).
- A benchmark showed atomic writes 3× *faster* than naive. Absurd. On Windows, `writeFileSync`
  **overwriting** an existing file costs 10–37 ms (truncate-in-place, AV rescan) while a **fresh** file
  costs 1.8 ms. Fair comparison: atomic+fsync = **1.6×** the minimum. The "speedup" is a platform artefact
  and is not claimed as a benefit.
- My scratch script wrote 182 files into a stray `x/` directory **inside the project root** because I
  passed the wrong `argv` index. Removed; verified via `git status` + 33/33 suites that nothing was
  corrupted.

---

## 3. THE URGENT ITEM — C3, atomic writes (built, **uncommitted**, **no writer uses it**)

### The defect, measured

Every ledger is written with `fs.writeFileSync(file, json)` inside `catch (_) {}`. Three defects at once:

**1 — Not atomic.** It truncates, then writes. Under a concurrent reader on a ~20k-row ledger:
**256 reads → 41 unparseable, 199 empty. 94% corrupt.** With the new module: **441 reads → 0 and 0.**

**2 — Not crash-safe.** 6 × `SIGKILL` mid-write: with the new module the ledger stayed complete every time.

**3 — Silent, and therefore fatal.** This chain destroys the record:

```
1. crash (or Ctrl-C) mid writeFileSync   → ledger.json truncated
2. next boot: JSON.parse throws          → catch { return [] }
3. first save of the day: _saveTrades()  → writes [] over the ledger
4. every prior trade is gone. No error. Nowhere.
```

`strangle-engine.js:126` and `agents-engine.js:299` both degrade a corrupt ledger to `[]` and then
overwrite it. **A single mistimed Ctrl-C can destroy the forward-test evidence that gates live approval.**

### What exists (uncommitted)

`safe-write.js` — pure leaf, **48 assertions, 12/12 deterministic runs**.
`writeJsonSync` (serialize → **validate by re-parsing** → temp in the same dir → `fsync` → `chmod` →
atomic `rename`), `readJsonSync` (recovers from `.bak`, **throws rather than guessing**), `cleanupTemp`,
advisory `withLock`.

Platform facts, probed: `renameSync` over an existing file **is** an atomic overwrite on Windows;
`fsync` on a **directory** fd fails with `EPERM` (best-effort, reported as `dirDurable:false`).

### What it does NOT do

**Atomicity is not mutual exclusion.** Three concurrent writers + a reader: 2,585 reads, 0 corrupt — but
the last `rename` wins and the other writers' updates are lost. This prevents **corruption**, not
**lost updates**. The fix for that is a single writer per ledger, not a lock.

### Not finished — this is the point

**The module exists; no writer uses it.** The data-loss chain is **still live**. Remaining, one commit each:
`C3-02` strangle-engine · `C3-03` agents-engine · `C3-04` gamma-blast-engine ·
`C3-05` forward-test-logger + signal-health · `C3-06` database.js · `C3-07` execution-engine (needs approval).

Each must pair the atomic write with `readJsonSync(..., { fallback: [] })` so a **missing** ledger yields
`[]` while a **corrupt** one raises. **That pairing is what actually closes the chain.**

---

## 4. Tracked technical debt

| ID | What | Where |
|---|---|---|
| TD-1 | Fallback Greeks hardcode `volatility = 0.15`, discarding the live IV the caller already solved for two lines earlier | `option-analyzer.js:166` |
| TD-2 | **One shared `OptionAnalyzer`, mutated per request.** Violates "no mutable singleton state". C1c-9 deliberately passed `inst` as an *argument* rather than adding `optionAnalyzer.inst`, which would have moved the race onto every Greek | `server.js:198, 2248-2249` |
| TD-3 | `bt-data` mounted `:ro` but `bt-*.js` CLIs write `bt-data/result-*.json` into it | `docker-compose.yml` |
| TD-4 | Container + local server share one bind-mounted ledger → lost updates. **Downgraded High→Medium; corruption half closed by C3, lost-update half remains.** Remedy: boot-time advisory lock on `data/` so a second server refuses to start | |
| ~~TD-5~~ | **CLOSED (C3-06).** `database.js` `read()` recovers from `.bak` and throws when unrecoverable; `write()` is atomic and throws | `database.js` |
| ~~TD-6~~ | **CLOSED (C3-02…C3-06).** Every ledger loader now recovers from `.bak`; an unrecoverable ledger marks the engine corrupt and **saving is refused**, so the corrupt bytes survive | all engines |
| — | **`pop-seller.buildIronCondor` returns two short legs and no wings** — a short strangle with unbounded loss and **no `maxLoss` field**, under a name that promises defined risk | `pop-seller.js:198` |
| — | `combinedPoP = popCE × popPE` assumes the two breaches are independent; spot cannot pierce both sides, so it **understates** PoP | `pop-seller.js:207` |
| — | `closePoP` applies **no transaction charges**, while three other engines use `charges.js` | |
| — | **`pop-seller`'s `_book` is module-global memory, never persisted.** Positions vanish on restart; no portfolio engine can see them | `pop-seller.js:242` |
| — | **No daily portfolio NAV series exists.** `equity-*.json` are scalar snapshots, not time series | `data/` |
| — | `position-sizer`: hardcoded default strategy stats; `minLot` forces ≥1 lot; `Math.max(1,\|avgLoss\|)` rupee-scale hack; **above the 25-lot cap IV scaling has no effect at all** | |
| — | **Kelly exists three times and they disagree**: `position-sizer.js:30` (full), `trade-planner.js:28` (half), `vix-kelly-sizer.js:19` (half, clamped) | |
| — | Two GEX implementations disagree: `gex-skew.js` uses `r = 0.065`, `vol-context.js` uses **`r = 0`** and the **opposite dealer-sign convention** | |
| — | `.env.example` sets `SIZER_STRANGLE_MARGIN=150000`; the code default is `130000` | |

---

## 5. THE DATA REALITY — this is what blocks everything

### 5.1 What exists on disk

| Dataset | Coverage | Granularity | Contents |
|---|---|---|---|
| `bt-data/bhav/` | **NIFTY only**, 600 days, 2024-01-08 → 2026-06-17, 185.8 MB | End-of-day | OHLC, settle, **OI, ΔOI**, volume, notional, trades, underlying, **board lot** |
| `bt-data/*-1min.json` | NIFTY / BANKNIFTY / SENSEX, 2025-09-01 → 2026-06-18, **197 trading days** | 1-minute | **underlying OHLC only** |
| `data/opt-candles/` | **4 days** | intraday | option-level |

### 5.2 Four measured findings from the bhavcopy (34 positional columns, NSE UDiFF, no header)

**F1 — The lot size is time-varying, and it is in the data.**

| file | `NewBrdLotQty` |
|---|---|
| `nifty-20240108.csv` | **50** |
| `nifty-20241031.csv` | **25** |
| `nifty-20250822.csv` | **75** |
| `nifty-20260617.csv` | **65** |

> `instrument-registry.js` holds **today's** lot (65). It is the source of truth for **live trading** and
> the **wrong** source for history. A 2024 backtest using the registry overstates NIFTY P&L by **30%**
> (65 vs 50) or **160%** (65 vs 25). **This is the single most likely way to silently produce a wrong
> backtest.** The lake must carry its own `contract_dim` keyed by `(symbol, trade_date)`.

**F2 — 45% of rows never traded. Their OHLC is zero; only `SttlmPric` is meaningful.**

```
812 traded, 676 untraded (45%) in nifty-20240108.csv
sample untraded:  O=0.00  H=0.00  L=0.00  C=3672.95  SETTLE=4567.25  OI=1250  VOL=0
```

Option OHLC is a **null concept for 45% of the universe**. IV inversion must use `SttlmPric`, and untraded
rows must be `NULL`, never `0`.

**F3 — These files contain index options only (`FinInstrmTp = IDO`). No futures (`IDF`).**
Therefore **no observable forward.** Black-Scholes inversion must assume `r` and `q = 0`. Those
assumptions must be stored, versioned feature parameters — not constants buried in code. (The codebase
already has `r = 0.065` in three places and `r = 0` in a fourth.)

**F4 — The unit of `OpnIntrst` is UNVERIFIED, and it scales GEX by up to 50×.**

```
strike 19500 PE   OI=371600   lot=50
strike 19500 CE   OI=1250     lot=50
```

Contracts or units? Both readings are internally consistent. GEX is `Σ gamma × OI × lot × S² × 0.01`.
If OI is already in units and we multiply by lot again, **every GEX figure is wrong by 25–75×**.

> **No Gamma Exposure number may be published until F4 is resolved.** Fail closed.

### 5.3 V1 — The underlying has **no volume**. Zero. In every bar.

```
nifty-1min.json      73,560 bars   volume nonzero: 0 / 73,560
banknifty-1min.json  73,935 bars   volume nonzero: 0
sensex-1min.json     73,937 bars   volume nonzero: 0
```

Not a data bug. **A spot index is a computed number, not a traded instrument.** Volume lives on the
futures, and per F3 there are no futures in the data.

**This makes the following not computable:** Volume Delta, Relative Volume, Volume Spike, Climax,
Exhaustion, **Absorption**, **Effort vs Result**, Volume Imbalance, Volume Profile, POC, Value Area,
VWAP on the underlying, **all of Wyckoff** (Spring, Upthrust, SOS, SOW, Accumulation, Distribution — Wyckoff
is *defined* as effort vs result), the **Composite Operator** model, and institutional
accumulation/distribution from price alone.

> **The institutional footprint in this market is not in the index candles. It is in the option chain** —
> option volume, ΔOI, notional, and `notional / trades` (average ticket size). That data is real and
> already available, live and EOD.

### 5.4 M2 — There are **41 labelled outcomes** in the entire platform

| ledger | records |
|---|---|
| `data/signal-outcomes.json` | 11 |
| `data/ai-agents-trades.json` | 20 |
| `data/strangle-trades.json` | 7 |
| `data/signal-paper-positions.json` | 2 |
| `data/gamma-blast-trades.json` | 1 |
| `data/forward-test/` | **empty** |
| **total** | **41** |

At `p = 0.5`, `n = 41` gives a standard error of **±7.8 percentage points**; the 95% Wilson interval on a
raw 60% win rate is roughly **[45%, 74%]**.

> **No probability may be published until calibration exists.** Below `n_min` the engine returns
> `probability: null`, `class: "uncalibrated"`, and a decision restricted to `NO_TRADE` or `ABSTAIN`.
> **It never prints "78%".**

### 5.5 P1 — The whole platform has **four distinct trading days** of paper history

Measured across every ledger:

| book | trades | distinct days | span |
|---|---|---|---|
| `strangle-engine` | 7 | 2 | 2026-07-07 … 07-08 |
| `agents-engine` | 20 | 4 | 2026-07-06 … 07-09 |
| `gamma-blast-engine` | 1 | 1 | 2026-07-07 |
| `signal-paper-positions` | 2 | — | no date field |
| `signal-outcomes` | 11 | — | no date field |
| **union of all books** | **41** | **4 days** | |

Pairwise overlap between books: **1–2 common days.**

**Consequences that cannot be argued around:**

- **A covariance matrix over 5 books needs 15 parameters. There are 4 daily observations.**
  It is **under-determined by roughly 4×**. Correlation, risk parity, equal-risk-contribution,
  maximum-diversification and Kelly allocation are all functions of that covariance. **None is estimable.**
- **Sharpe / Sortino / Calmar / Ulcer** require a daily return series. On `n = 4`, the standard error of a
  Sharpe ratio is on the order of ±0.5 — larger than any Sharpe worth reporting.
- **All books trade the same underlying indices.** Cross-book correlation of index exposure is ≈ 1 **by
  construction**, not something to estimate. The correct tool is **netting**, not correlation.
  A "Diversification Score" over five strategies on one index is a number without a referent.

> **Rule P1.** No portfolio statistic that requires a return distribution may be emitted below a declared
> `n_min` (recommendation: **≥ 200 trading days and ≥ 2 regimes**). Below it: `null` + reason.
> **Netting and structural exposure are computed instead** — they need no history and are exact.

### 5.6 P2 — `pop-seller`'s book is memory-only, and P3 — no NAV series exists

```
pop-seller.js:  const _book = [];        // module-global
                writeFileSync present?   NO
```

`pop-seller` positions **vanish on restart** and are invisible to any portfolio engine. It is the sixth
book, and it is not on disk.

`data/equity-nifty.json` and `data/equity-sensex.json` are **scalar snapshots**
(`{capital, reserve, consecLosses, updatedAt}`) — **not** time series.

> **There is no daily portfolio NAV series anywhere in this platform.** Every equity curve, drawdown curve,
> rolling drawdown, Ulcer index and Calmar ratio the H19 brief requests is computed from a series that does
> not exist. Building that series — one row per day, per book, net of `charges.js` — is the **prerequisite**,
> and it is cheap.

### 5.7 Evidence classification

| Feature | Class |
|---|---|
| OI, ΔOI, PCR, Max Pain, OI build-up | **Verified** — 2.4 y of NIFTY EOD |
| IV / IV Rank / IVP / historical Greeks | **Probable (derived)** — invert BS on `SttlmPric`. **EOD only.** Biased by assumed `r` |
| Realized vol, Parkinson, HV, ATR | **Verified** — underlying OHLC |
| Gamma Exposure | **Blocked on F4**, then Verified (EOD) |
| **Dealer Gamma / Dealer Position** | **Hypothesis, not a measurement.** Public data shows OI, not *who is short* |
| Bid, Ask, Spread, Depth, Liquidity Score | **Not obtainable.** No free historical L1/L2 for NSE options |
| Tick / 1s / 5s bars | **Not obtainable** |
| Intraday option bars | **4 days only.** Forward collection can accumulate more from today |
| Order Block, FVG, BOS, CHOCH, sweeps, premium/discount | **Probable, underpowered** — 197 days = one regime |
| 2016–2026 span | **Obtainable, not present.** NSE publishes bhavcopy free; ingesting it is a project |

**Per-market reality:** SENSEX and BANKEX are **BSE** products needing a **separate bhavcopy adapter**.
FINNIFTY (2021), MIDCPNIFTY (2022), SENSEX/BANKEX (2023) **cannot have ten-year histories** — the products
did not exist.

**Also verified:** the `python` shim is broken on this machine (only the `py` launcher works, 3.14.3), so
the `analytics:api` npm script would fail today.

---

## 6. Engines — corrected inventory

> **CORRECTION (2026-07-09, after C3).** An earlier module scan in this document searched for
> filenames that do not exist in this repo and therefore reported several engines as **absent when
> they are present**. The corrected inventory is below. The H15 and H17 designs in §7 were written on
> the wrong premise and are annotated accordingly. This is recorded rather than quietly fixed.

### Present, and tested
`instrument-registry` · `strike-resolver` · `registry-drift` · `safe-write` · `broker-connector`
(contract only, **not wired into the live data path**) · `gamma-blast-detect` · `gamma-blast-engine` ·
`option-analyzer` · `vrp-monitor` · `gex-skew` · `vol-context` · `candlestick-patterns` ·
**`smart-money`** (224 lines: swings, marketStructure, structureBreaks, orderBlock — pure, OHLC-only) ·
**`event-risk-filter`** · `position-sizer` · `trade-planner` · `meta-label` (Platt/isotonic calibrator) ·
`signal-health` (Brier + reliability bins + drift) · `agents-engine` · `forward-test-logger` ·
`bt-validate` (**deflated Sharpe, PSR, purged k-fold** — reuse, never reimplement) · `strangle-engine` ·
`pop-seller` · `charges`

### Present, but **untested**
**`event-engine`** (136 lines: India VIX, FII/DII flows, macro calendar) ·
**`confluence-learner`** (183 lines: re-weights factors from realised wins/losses — this is the
*reliability learning* H15 needs) · `ai-logger` · `confirmed-signals` · `afternoon-engine` ·
`crash-analyzer` · `database`

### Genuinely absent
**Risk Engine** · **Portfolio Engine** · Historical Data Lake · Feature Store · Dealer Hedging ·
Replay Engine · Market Regime · Strategy Library · **AI Probability** · **Meta Decision** ·
**Explainability**

*(Symbol Resolver, Expiry Service and Tick Size Service already live **inside** `instrument-registry.js` —
they need extraction, not invention.)*

### What the correction changes

- **H15** claimed "8 of 24 declared inputs do not exist", listing Event Engine and Smart Money among
  them. Both exist. The genuinely missing `critical` inputs are **Risk Engine** and **Portfolio Engine**.
  H15 would still `ABSTAIN` today — because every engine has `reliability: null` (M2: 41 outcomes) —
  but the *reason* is calibration, not absence.
- **H17** proposed building a Smart Money engine from scratch. **`smart-money.js` already exists and is
  tested**, and it is already OHLC-only and pure — which is exactly what finding V1 (zero underlying
  volume) demands. H17 should therefore be scoped as *(a)* extending the existing module, *(b)* adding
  the **Option-Flow Participation** engine that genuinely does not exist, and *(c)* deleting nothing.
- **`confluence-learner.js`** is the closest thing to H15's reliability estimator and it is **untested**.
  Testing it is cheaper than building H20.
---

## 7. Designed but NOT built — H13 … H18

All five are designs only. **No code exists for any of them.**

### H13 — TradingView Research & Pine Verification Lab

- **"Python → Pine translator" is not tractable as asked.** Python is Turing-complete; Pine is a
  constrained DSL with no unbounded loops and bar-by-bar series semantics. An "80% working" translator is
  the *worst* outcome — you would believe a strategy was verified when the translator changed its semantics.
- **Proposed inversion:** a `strategy-ir.json` (Intermediate Representation) as the single source of truth,
  with **two code generators** (`codegen-python.js`, `codegen-pine.js`). Drift becomes structurally
  impossible. Anything that does not fit the IR gets `translatable: false` and an **explicit refusal** —
  never a confidence score that lets it through.
- **TradingView has no public API** for Pine compilation or Strategy Tester, and automating
  `tradingview.com` via CDP violates their Terms of Service. Recommended scope: **import-only** — generate
  the `.pine`, the human pastes it, and the Lab imports the Strategy Tester CSV export and the pasted
  compiler errors. CDP against the Desktop app is technically possible but must be an explicit, documented
  owner decision.
- **Python vs TradingView will never match exactly** (bar-close vs tick, broker emulator fills, slippage,
  repainting). Reconciliation uses a **tolerance budget**: trade-count and entry-bar are **hard fails**
  (0 tolerance); win-rate ±1 pt; net profit ±2%; drawdown ±3 pt; equity correlation ≥ 0.99.
- Isolation: separate Express process on **port 3100**, own `data/research-lab/` store, `server.js` gets
  **zero** changes.

### H14 — Historical Options Research Data Lake & Feature Store

- **Storage: DuckDB (embedded) + Hive-partitioned Parquet.** Measured: 1,550 rows/day/index → 10 y × 6
  indices ≈ **15.5 M rows ≈ 3.1 GB raw CSV → 150–350 MB Parquet**. This is a *small* dataset. Do not
  reach for Postgres/Timescale/ClickHouse; do not over-engineer.
- Medallion layout: `raw/` (byte-exact vendor files, the audit anchor) → `bronze/` (typed 1:1) →
  `silver/` (conformed, quality-scored) → `gold/` (versioned features) + `dim/` + `_catalog/`.
  Partition by `symbol / year / month`, **not** by day.
- `raw/` exists so any table can be **rebuilt and byte-compared**. That is what makes it reproducible.
- Every derived number carries provenance: feature version, formula hash, input dataset version, and its
  **assumptions** (`r`, `q`, `oi_unit`, `dealer_sign_model`).
- `open/high/low/close` are **NULL, not 0**, when untraded (F2). `iv` carries a `converged` column; a
  non-converged inversion emits `NULL`, never a fallback constant.
- **Quality engine** with missing-candle, duplicate, gap, outlier, negative-OI, invalid-IV, put-call-parity
  and **lot-consistency** checks. A partition below threshold is stored, never deleted, and gold builds
  refuse to consume it.
- **AI dataset builder must use purged, embargoed splits.** Options labels overlap; a naive
  `train_test_split` leaks. Delegate to `bt-validate.js`. The builder must refuse `test.start < train.end`.
- Separate process, **port 3200**, read-only. `server.js` unchanged.

### H15 — AI Probability & Meta Decision Engine

- **8 of its 24 declared inputs do not exist.** Its own risk filter demands Liquidity and Spread, which are
  **not obtainable at all**. So a correctly fail-closed H15 **returns `ABSTAIN` on 100% of inputs today.**
  *That is not a bug — that is the engine telling the truth.* It ships as the authoritative,
  machine-readable answer to *"what exactly is missing before this platform may recommend a trade?"*
- **The core rule: unproven engines may VETO, never VOTE.**

  | engine state | contributes to score? | can block the trade? |
  |---|---|---|
  | `reliability` measured, `ok` | **Yes**, weight ∝ reliability | Yes |
  | `reliability = null` (never scored) | **No — weight is exactly 0** | **Yes** |
  | `status = abstain` + `critical` | No | **Whole decision ABSTAINs** |

  Being wrong about *not* trading costs an opportunity; being wrong about trading costs capital.
  Today **every** engine has `reliability = null`.
- **`score: 0` ≠ `score: null`.** `0` claims neutrality; `null` admits ignorance. A test asserts they
  produce different decisions.
- **Coverage floor.** `Σ (declaredWeight × reliability × dataQuality × freshnessDecay)` must exceed a
  per-mode threshold before any score is computed. Without it, an engine set that is 90% missing still
  produces a confident number from the 10% that answered.
- **Monte Carlo is not validation.** It propagates the model's assumptions. Label every MC output
  `class: "assumption_propagation"`. Real validation is out-of-sample calibration (Brier, reliability curve)
  plus walk-forward.
- **EV must be net of `charges.js`.** A gross EV is a lie for an options seller.
- Grade `U` (ungraded) — **not `F`** — when unmeasurable. `F` implies we assessed it and found it bad.
- Tail risk for a **naked short strangle is unbounded** and must be reported as such, never as a percentile.
- Append-only, hashed `decisions.jsonl` via `safe-write.js`. Separate process, **port 3300**.
- The **abstain matrix** is the most valuable test suite: for each `critical` engine, force `abstain` →
  decision **must** be `ABSTAIN` naming that engine. It is the executable form of "never guess".

### H16 — Gamma Blast Intelligence (master prompt written)

- **Gamma blast is not backtestable today.** It is an intraday, expiry-day phenomenon. We hold 4 days of
  option intraday and 2.4 years of **end-of-day** bhavcopy. You cannot backtest a 5×/10× intraday premium
  event on EOD settle prices. Any "gamma blast backtest" on bhavcopy measures something else.
- The honest question is not *"how do we backtest it?"* but **"what must be true for it to have an edge,
  and how few forward-test observations do we need to reject it?"** Pre-register the hypothesis, the entry
  and exit rules, the sample size and the stopping rule — **then** let the forward test run.
- First three commits: characterization suite for the detector; a **divergence report** between
  `gex-skew.computeGEX` and `vol-context.gexLite` (they disagree on `r` and on dealer sign); and
  `bronze/option_intraday` capture starting **today**.

### H17 — Smart Money Intelligence

- Because of **V1** (no volume), the module splits into **two engines**:
  **(A) Price Structure** — OHLC only: swings, BOS, CHOCH, equal highs/lows, liquidity sweeps, FVG,
  structural order blocks, premium/discount. Explicitly **not** volume-aware.
  **(B) Option-Flow Participation** — OI build-up, average ticket size (`notional / trades`),
  ΔOI concentration (Herfindahl), strike migration. **This is where institutional evidence actually is.**
- **Wyckoff, Volume Profile, absorption, effort-vs-result are removed from scope**, not stubbed. A
  `_removed.md` records why. `/wyckoff` returns **501 Not Implemented** with the reason — better than a
  404, which would suggest a missing route.
- **The multiple-comparisons trap:** ~60 detectable patterns × 197 days at α = 0.05 yields **≈3
  "significant" findings by chance alone**. Every reliability claim must pass through deflated Sharpe / PSR
  with the **trial count declared up front**, and labels must use triple-barrier + purged folds.
- **No labelled smart-money events exist**, so "false positive rate" cannot be computed. The suite exists
  and is `skip`ped **with the reason recorded**, not silently omitted.
- Every detector is a **pure function with declared, versioned parameters**. Parameters frozen before any
  reliability is measured. Tuning them against outcomes and then reporting accuracy is self-deception.
- Separate process, **port 3400**. Emits an `EngineVerdict` with `reliability: null` → weight 0, veto-only.
  **It never recommends a trade.** H15 decides.

### H18 — Institutional Risk Engine (master prompt written)

**By measurement, this is the single most valuable missing engine** — H15 cannot emit any decision without
it, because Risk Budget and Portfolio Exposure are `critical` inputs.

**Do NOT build:** empirical CVaR / ES / VaR from 41 trades; Risk of Ruin from an uncalibrated win rate;
Monte Carlo presented as validation; a **fourth** Kelly implementation; correlation matrices from 41
overlapping trades on one underlying; anything needing bid/ask.

**DO build, because it needs no history and is exact:**
1. **Portfolio netting.** Five separate P&L books (`strangle-engine`, `agents-engine` ×2,
   `gamma-blast-engine`, `pop-seller`, `signal-paper-engine`) with **no aggregate netting anywhere.**
   The true book-level delta/gamma/vega **is nobody's number today.**
2. **Structural max loss**, exact arithmetic, net of `charges.js`; `unbounded: true` for naked shorts.
3. **Hard limits**, fail-closed: if a ledger cannot be read, the limit is **treated as breached**.
4. **Deterministic stress grid** (spot × IV × time) over the netted book. No randomness, no history.
   **This is the most honest risk number the platform can produce today.**
5. **Unified `sizing.js`** — one Kelly. Delete the three copies; fix the `max(1, |avgLoss|)` rupee-scale
   hack and the IV-masked-above-cap blind spot.

### H19 — Institutional Portfolio Intelligence Engine

**Blocked by P1.** With **4 trading days** and 5 books, the covariance matrix needs 15 parameters and has 4
observations. Every statistic the brief asks for — Sharpe, Sortino, Calmar, Ulcer, rolling drawdown,
strategy correlation, risk parity, ERC, maximum diversification, Kelly allocation, hidden correlation,
cluster analysis, correlation shock — **is a function of that covariance or of a NAV series that does not
exist.**

**Do NOT build:**
- Correlation / cluster analysis / correlation heatmap / hidden correlation from 4 days. All five books
  trade the same index; their exposure correlation is ≈ 1 **by construction**. Estimating it is theatre.
- Risk parity, ERC, maximum diversification, Kelly allocation — all require Σ.
- Sharpe / Sortino / Calmar / Ulcer / rolling drawdown — no NAV series.
- A "Diversification Score" over five strategies on one underlying.
- Model / performance / reliability **drift** detection — drift needs a baseline; there is none.
- Monte Carlo presented as validation. (Label `class: "assumption_propagation"`.)

**DO build — exact, needs no history, and genuinely missing today:**
1. **A daily NAV series.** One row per day per book: realised P&L **net of `charges.js`**, open MTM,
   capital, margin used. Append-only via `safe-write.js`. **This is the prerequisite for everything else in
   H19 and it does not exist.** It is also cheap.
2. **Portfolio netting.** Aggregate all six books into one exposure: net delta, gamma, vega, theta per
   underlying and per expiry, plus notional and margin. **The true book-level Greeks are nobody's number
   today.** This is *netting*, not correlation — it is arithmetic, not statistics.
3. **Persist `pop-seller`'s book** (P2). A portfolio engine that cannot see a sixth book is not a portfolio
   engine.
4. **Structural exposure alerts** — over-exposure, capital concentration, margin risk, Greeks concentration,
   risk-budget breach, **duplicate trades** (two books long the same strike), **conflicting signals** (one
   book long, another short, the same contract). All are *set operations on open positions*. No statistics
   required. These are the alerts worth having.
5. **Deterministic scenario grid** — spot × IV × time over the netted book. Reproducible, no randomness.
   Same tool as H18's stress test; build it once.
6. **Capital allocation, but only the honest kinds:** fixed weights, risk-budget caps, and a reserve.
   Confidence-weighted and Kelly allocation stay **disabled** until `reliability` is measured (H15 gives an
   engine with `reliability: null` a weight of exactly 0).

**Contract.** Emits one `EngineVerdict`, `class: "portfolio"`, with `capitalAllocation`,
`riskContribution`, `expectedContribution` — each `null` when unestimable, with a reason.
`status: "abstain"` whenever the covariance-dependent inputs are requested. **Never places trades.**
Separate process, **port 3600**.

**The single most valuable line of H19:** start writing the daily NAV series **today**. Every portfolio
statistic in the brief becomes computable roughly `n_min` days later, and not one day sooner.

### H20 — AI Probability Intelligence Engine (master prompt, prepared)

**Blocked by M2** (41 labelled outcomes). Bayesian probability, ensemble AI, confidence calibration,
reliability estimation, Brier optimisation and model agreement are all **estimated from labelled outcomes**.

- **Brier score optimisation on 41 samples is optimisation of noise.** The score's own standard error
  exceeds the differences between candidate models.
- **Ensemble AI over engines whose `reliability` is `null`** is an average of unweighted guesses. Per H15's
  rule, those engines have weight exactly 0 — the ensemble is empty.
- **Bayesian probability is the *right* answer to small `n`** — but only if the prior is declared, defended
  and versioned, and the posterior is reported **with its credible interval**, never as a point estimate.
  With `n = 41`, the posterior is the prior with a slight tilt. Say so.

**DO build:** the **calibration harness**, not the model. `meta-label.js` (Platt/isotonic) and
`signal-health.js` (Brier + reliability bins + drift) already exist and are correct. They are **starved of
data, not missing**. H20's real deliverables are:
1. **Outcome logging for every engine's hypothetical call**, not just executed trades. This multiplies the
   labelled set without risking a rupee, and it is the cheapest item on the entire roadmap.
2. **A reliability estimator with Bayesian shrinkage** toward the prior, reporting `n`, the credible
   interval, and refusing a point estimate below `n_min`.
3. **A calibration gate** (n ≥ 200 overall, ≥ 30 per bin, Brier ≤ 0.22, slope ∈ [0.8, 1.2]) that H15
   consults before publishing any probability.
4. **Purged, embargoed evaluation** via `bt-validate.js` — never fit and evaluate on the same outcomes.

**Do NOT build:** an ensemble, a neural model, or a Brier-optimised blend, on 41 samples.

---

## 8. Architecture direction

`server.js` is the monolith and it is protected. Every new module ships as a **separate local process**,
so `server.js` needs **zero** changes and a crash in one cannot touch trading:

| module | port |
|---|---|
| trading server (existing) | 3000 |
| H13 TradingView Research Lab | 3100 |
| H14 Data Lake | 3200 |
| H15 Meta Decision | 3300 |
| H17 Smart Money | 3400 |
| H18 Risk Engine | 3500 |
| H19 Portfolio Intelligence | 3600 |

All are **read-only** with respect to trading state. All persist through `safe-write.js`. All emit
`EngineVerdict` (H15's contract) rather than a bespoke shape. All carry
`{ class, limitations[], missingEvidence[], assumptions, engineVersion }` in every response.

---

## 9. The one contract every engine must satisfy

```jsonc
{
  "engine": "smart-money", "engineVersion": "0.1.0",
  "status": "ok" | "abstain" | "error",
  "score": -1.0 .. +1.0 | null,     // null, NEVER 0, when status ≠ ok
  "confidence": 0..1 | null,
  "reliability": 0..1 | null,        // MEASURED out-of-sample. null ⇒ weight 0 ⇒ veto-only
  "sampleSize": 41 | null,
  "freshnessMs": 900, "dataQuality": 0..1,
  "evidence": [{ "fact": "...", "value": ..., "source": "engine@version" }],
  "limitations": ["underlying volume is zero by construction"],
  "missingEvidence": [{ "input": "risk-engine", "reason": "module absent" }],
  "assumptions": { "r": 0.065, "oi_unit": "UNVERIFIED" },
  "abstainReason": "...", "computedAt": "ISO-8601"
}
```

**No engine has a `decision` field. Only H15 decides.**

---

## 10. Recommended order of work

| # | Task | Why |
|---|---|---|
| **1** | **C3-02 … C3-06** — make the ledger writers atomic | Five module designs now rest on `safe-write.js`, and **no engine uses it.** The data-loss chain is live |
| **2** | **Start capturing intraday option chains today** | The only path to gamma / dealer / option-flow research. Gates H14, H16 and H17 simultaneously. **Every day of delay is a day permanently lost** |
| **3** | **Start logging outcomes for every engine's hypothetical call** | 41 → 200 gates all of H15 **and all of H20**. Cheapest item on the roadmap |
| **3b** | **Start writing a daily NAV series** (per book, net of charges) and **persist `pop-seller`'s book** | Every portfolio statistic in H19 is computed from a series that does not exist. Cheap. Gates H19 entirely |
| **4** | Resolve **F4** (`oi_unit`) against a live NSE chain | One afternoon. Unblocks GEX permanently |
| **5** | **H18 Risk Engine** | The `critical` input H15 is blocked on. Mostly structural, needs no history |
| **6** | **H14 Data Lake** (NIFTY depth-first) | 12 of 26 engines cannot be *validated* without it |
| **7** | H15, then H17, then H16, then H13 | Each depends on the ones above |

**Do not build the dashboard, replay, or portfolio intelligence first.** They render or replay data that
does not yet exist.

---

## 11. What has been deliberately refused, and why

- **No probability without calibration evidence.** Not once. (n = 41)
- **No GEX until `oi_unit` is verified.** (wrong by 25–75×)
- **No dealer positioning presented as data.** It is an assumption, named and versioned.
- **No Wyckoff / volume profile / absorption on volumeless data.**
- **No `0` where we mean "unknown".**
- **No Monte Carlo called validation.**
- **No arbitrary Python → Pine translator.**
- **No TradingView scraping** (no public API; automating it violates their ToS).
- **No `instrument-registry` lot for historical calculations.** (F1)
- **No percentile "tail risk" for a naked short strangle.** Its tail is unbounded.
- **No ten-year history claimed** for FINNIFTY, MIDCPNIFTY, SENSEX or BANKEX.
- **No fourth Kelly implementation.**
- **No correlation, risk parity, ERC or Kelly allocation from 4 trading days.** The covariance matrix needs
  15 parameters and has 4 observations.
- **No Sharpe / Sortino / Calmar / Ulcer / rolling drawdown** — there is no daily NAV series to compute them from.
- **No "Diversification Score"** over five strategies that all trade the same index.
- **No drift detection without a baseline.**
- **No Brier optimisation or ensemble AI on 41 labelled outcomes.**

---

## 12. Instructions to the assistant reading this file

You now have the complete context. Before you propose anything:

1. **Do not re-litigate the measured findings** in Sections 3 and 5. They were measured, not assumed.
2. **Watch for these plausible-sounding suggestions — this codebase has already disproved them:**
   - *"Just use the TradingView API"* → there isn't one for Pine or Strategy Tester.
   - *"Just translate Python to Pine"* → not tractable; use the IR with two code generators.
   - *"Use range as a volume proxy"* / *"Wyckoff works on price alone"* → Wyckoff **is** effort vs result.
   - *"Compute CVaR from the 41 trades"* → the ES estimate rests on ~2 observations.
   - *"Monte Carlo will validate the probability"* → it propagates assumptions; it cannot detect a wrong model.
   - *"Fill missing engines with a neutral 0.5"* → that manufactures confidence from nothing. Use `null`.
   - *"OI is obviously in contracts"* → unverified. It scales GEX by 25–75×.
   - *"Use the registry's lot size for the backtest"* → the lot was 50, then 25, then 75, then 65.
   - *"Postgres/TimescaleDB for the lake"* → 15.5 M rows; DuckDB + Parquet, embedded, no server.
   - *"Compute the strategy correlation matrix"* → 15 parameters, **4 daily observations**. Under-determined.
   - *"Report the portfolio Sharpe"* → there is no daily NAV series anywhere. It does not exist.
   - *"Diversify across the five strategies"* → they all trade the same index. Exposure correlation is ~1 by construction. Use netting, not correlation.
   - *"Ensemble the engines and optimise the Brier score"* → every engine has `reliability: null`, so the ensemble is empty; and 41 samples is optimisation of noise.
   - *"Use Bayesian methods for small n"* → correct in principle, but the posterior on n=41 is the prior with a slight tilt. Report the credible interval; never a point estimate.
3. **Classify every claim** you make: Verified / Probable / Hypothesis / Unknown. If the data is absent,
   say so and stop.
3b. **Verify a module is absent before saying so.** This document previously reported `event-engine.js`,
   `smart-money.js`, `event-risk-filter.js` and `confluence-learner.js` as missing. They exist. A scan
   that searches for a guessed filename proves nothing. `git ls-files` and read the header.
4. **Prefer refusing over guessing.** `null ≠ 0`.

### If the owner asks you for a Master Prompt

**You can generate one.** Produce a single, self-contained prompt that can be pasted into a fresh session
(including back into Claude Code) so work continues with no context loss. Use the template in Section 13.
It must carry, verbatim, the constraints in Sections 3 and 5 — otherwise the next session will rebuild the
same wrong things.

---

## 13. Master Prompt template

```
# <MODULE ID> — <Module Name>
## Master Prompt

## Part A — Status (verify before trusting)
- Which modules are BUILT vs DESIGNED-ONLY? (Today: H13–H18 are designs. C3 is uncommitted.)
- Is C3 finished? If not, no new ledger may use fs.writeFileSync.
- HEAD commit, suite count, anything uncommitted.

## Part B — Non-negotiable measured constraints (copy from MASTER-CONTEXT §3 and §5)
- F1 lot size is time-varying and lives in the data (50 → 25 → 75 → 65)
- F2 45% of option rows never traded; OHLC is NULL, only SttlmPric is meaningful
- F3 no futures ⇒ no observable forward ⇒ r and q are assumptions
- F4 oi_unit UNVERIFIED ⇒ GEX withheld (wrong by 25–75×)
- V1 the underlying has ZERO volume ⇒ no Wyckoff / volume profile / absorption
- M2 41 labelled outcomes total ⇒ no calibrated probability, no empirical CVaR
- Charter: never rewrite; fail closed; null ≠ 0; characterization tests first;
  never commit unasked; never push; Gujarati-script replies.

## Part C — The brief
- Role, objective
- Scope: MUST build / MUST NOT build (with the reason for each refusal)
- Deliverables: architecture · folders · contracts · API · DB · flow · sequence diagram ·
  testing plan · migration plan · rollback plan · risk analysis · performance · future expansion
- Success criteria
- First three commits

## Part D — Questions the module must answer with measurements before writing code
1. ...
2. ...
"Answer with measurements. If the data is absent, say so and stop. Never invent market behaviour."
```

---

## 14. The three open questions

1. **Commit C3-01 and proceed with C3-02?** `safe-write.js` exists with 48 passing assertions, and **no
   writer uses it.** `data/strangle-trades.json` holds 7 real trades. One mistimed Ctrl-C turns it into
   `[]` — silently, with no error anywhere. Five module designs now rest on this file.
2. **Start capturing intraday option chains today?** It is the only path to gamma, dealer and option-flow
   research, and it gates H14, H16 and H17 at once.
3. **Start logging outcomes for every engine's hypothetical call today?** 41 → 200 is what unlocks every
   probability, every reliability and every weight in H15 and H20.
4. **Start writing a daily NAV series today, and persist `pop-seller`'s book?** Every portfolio statistic
   in H19 — Sharpe, drawdown, correlation, allocation — is computed from a series that does not exist.

All three are small. **But without (1), everything else is being written onto a ledger that can be erased
at any moment.**

---

## 16. Platform Health Scores — 2026-07-09 (measured, not estimated)

Every score is anchored to a number produced by a scan of the repository, not to an impression.
Scale 0–10. A high score means "evidence supports it", never "it feels fine".

| dimension | score | the measurement it rests on |
|---|---|---|
| **Architecture** | **6.5** | 0 circular dependencies. 43 of 69 production modules are **pure leaves**. Fan-in is healthy: `instrument-registry` 10, `safe-write` 8, `charges` 5. **But** `server.js` is 5,991 code lines and 168 routes with no `express.Router` and no error middleware |
| **Code Quality** | **6.0** | 0 TODO/FIXME. 0 circular deps. **105 silent `catch (_) {}`** (58 in `server.js`). 16 inline ATM roundings. 9 hardcoded risk-free rates. Kelly implemented **3×**, GEX **2×** with different `r` and opposite dealer sign |
| **Performance** | **6.0** *(unprofiled)* | Atomic writes measured at **1.6×** the fair baseline (2.91 ms vs 1.80 ms). 15 blocking `readFileSync` on request-adjacent paths. **No profiler has ever been run.** This score is a placeholder and should not be trusted until it is |
| **Security** | **6.5** | **0** credential-shaped literals in tracked files. `.env` not tracked. `npm audit`: **0 critical / 0 high / 0 moderate / 0 low**. Docker build context 2.9 MB with secrets excluded. **But** no webhook-secret enforcement, no rate limiting, no CSP |
| **Reliability** | **8.0** | The ledger data-loss chain is **closed in every engine** (C3-02…C3-06). Registry is fail-closed and drift-checked against the live broker. 35/35 suites, deterministic. **TD-4's lost-update half remains open** |
| **Testing** | **5.0** | **27 of 69** production modules have a suite (**39%**). test:prod line ratio **0.19**. **Zero route tests** across 168 routes. `charges.js` — 5 dependents, decides every rupee — had **zero tests until today** |
| **Technical Debt** | **5.5** | 4 tracked TDs open (2 blocked on protected files). 105 silent catches. 3 Kelly copies. 2 GEX copies. 27 duplicate market-metadata sites |
| **Institutional Readiness** | **3.0** | **41 labelled outcomes** platform-wide ⇒ no calibrated probability. **No Risk Engine, no Portfolio Engine, no daily NAV series, no data lake.** 4 distinct trading days of paper history |

**The two scores that matter most are the two lowest.** Institutional readiness is gated by *evidence*
(41 outcomes, 4 trading days), not by code. Testing is gated by *effort*, and it is the cheapest thing on
this list to move.

### New finding this session — E1: `.env.example` disagrees with `charges.js`

| rate | `.env.example` | `charges.js` default | effect in isolation |
|---|---|---|---|
| `CHARGE_STT_SELL_PCT` | 0.0625 | **0.1** | cost **−5.73%** |
| `CHARGE_EXCH_TXN_PCT` | 0.053 | **0.03503** | cost **+5.40%** |
| both, as shipped | | | cost **−0.33%** |

`charges.js` reads `process.env.CHARGE_*`, so `cp .env.example .env` **changes the cost model**.

**The near-cancellation is the hazard, not the 0.33%.** The total looks almost right, so nobody notices
that *both* component rates are wrong — and the moment one is corrected in isolation, the total moves 5%
and looks like a regression. Same defect class as `.env.example` shipping `NIFTY_LOT_SIZE=75` (C1c-0):
a documentation file that is load-bearing in the money math.

The live `.env` sets no `CHARGE_*` key, so the code defaults are in force today. `test/charges.test.js`
(26 assertions) now pins all of this, including the break-even move: **0.95 points on 65 units at ₹100
premium** — any target below that is arithmetically unprofitable before it begins.

**Not fixed here.** Which pair of rates is correct against the current SEBI/exchange schedule is a
question of fact that must be verified against the exchange's published circular, not chosen by whichever
number looks familiar. See §14.

---

## 17. Dashboard Audit — 2026-07-09 (MASTER-02, measured)

**Inventory:** 21 pages, 692 KB, **zero shared CSS, zero shared JS components.**
`dashboard.html` (the declared home): 100 KB, 774 static DOM nodes, 52 panels, **16 `setInterval`
timers polling 15 endpoints, no WebSocket**, TradingView for charts, CSS grid, **no resizable panels,
no workspace save**.

**The decisive finding — a de-facto design system that drifted:** 19/21 pages define their own `:root`
tokens **with the same names** (`--panel` ×19, `--bg` ×18, `--blue` ×17, `--green` ×14 …) but the values
diverged: `--bg` exists in **10 distinct colours**, `--panel` 11, `--green` 5, `--red` 5, `--blue` 6.
**Profit renders in five different greens depending on the page.** The vocabulary is already shared;
only the values need one home.

**Accessibility, measured:** aria attributes on **1/21** pages · `tabindex` on **0/21** ·
light/dark support on **3/21** · keyboard shortcuts only partially on the home page.

**Delivered (UI-01, additive, zero pages modified):** `public/css/tokens.css` — canonical tokens anchored
on `dashboard.html`'s palette (the home page must not change appearance when it adopts the file);
**semantic `--gain`/`--loss`** as indirections over raw hues so a colour-blind theme remaps P&L without
repainting charts; light / high-contrast / deuteranopia themes as token swaps; `tabular-nums` for money
columns; a `:focus-visible` ring (0/21 pages had one). Guarded by `test/ui-tokens.test.js` — a **ratchet**:
the count of pages carrying private tokens (baseline 19) may only go down, and a migrated page may never
privately redefine a core token again.

**Migration path:** one page per commit — add `<link rel="stylesheet" href="/css/tokens.css">`, delete
that page's private `:root` block, visually verify. Start with `health-dashboard.html` (small, shares the
home palette), end with `dashboard.html`.

**Not addressed yet (needs design decisions, not just tokens):** the 16-timer polling storm (a shared
poller or SSE/WebSocket bridge is a server.js-adjacent change — approval needed) · workspace save/restore ·
resizable panels · option-chain institutional layout · alert system.
