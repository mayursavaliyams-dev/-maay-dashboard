# Phase 1 — data capture (`warehouse-capture.js`)

**Date:** 2026-07-26 · **Scope:** one new module + its tests + one line in `start-bot.bat`.
No engine, no `server.js`, no existing module touched. Out-of-process, append-only, additive —
deleting it changes nothing else.
**Why now:** `docs/REPORT-bot-vs-world-best.md` §5 ranks this Phase 1, above every feature, because
*every day not captured is permanently lost history*. It is also the cheapest item on the list.

---

## 1. The three columns that gate everything

| # | What was missing | Status now |
|---|---|---|
| 1 | **Intraday option chains** — never persisted with Greeks; gates all vol/flow research | ✅ 469 strikes × 21 columns per snapshot, per instrument |
| 2 | **Outcomes with entry Greeks** — ~50 labelled outcomes and **no engine stores entry Greeks beside realized P&L**, which is precisely why the probability layer is blocked | ✅ OPEN row carries reconstructed entry Greeks + IV + `ivSource` |
| 3 | **Daily NAV series** — *"no daily NAV series exists anywhere"*, so Sharpe / drawdown / any portfolio statistic is uncomputable | ✅ per-book equity, peak, streak and halt state |

Output layout (under the existing `data/warehouse/`, git-ignored):

```
L0_raw/chain/<INST>/<trading-day>.jsonl     one snapshot per line, append-only
L1_outcomes/<trading-day>.jsonl             OPEN / CLOSE rows
L1_nav/<year>.jsonl                         NAV rows
_manifest/capture-state.json                last content hash per stream (safe-write)
```

---

## 2. Two design decisions worth stating

### 2.1 No fourth market-session implementation
A capture loop wants a market-hours gate. This repo **already has session logic three times**
(`server.js` opens 9:15, `ai.js` opens 9:00, plus each broker's own `isMarketOpen`) — doc 000 lists
that divergence as a live single-source-of-truth violation. Adding a fourth would make it worse.

Instead each writer is **content-addressed**: a snapshot identical to the previous one is not
appended. Out of hours the market stops changing, so the capture self-gates with no clock at all.
Fewer moving parts, and nothing new to disagree with.

### 2.2 The fingerprint keys on what was OBSERVED, not what was COMPUTED
This was a defect in the first cut of this module, found by measuring rather than assuming.

With the market **closed** and spot frozen, two polls 60 seconds apart differed in **160 cells** —
and every single one was `gamma`, `theta`, `vega` or `iv`. Those are model outputs whose only moving
input is time-to-expiry; they drift with the wall clock forever. Hashing them meant the self-gate
never fired, and the capture would have written **~66 MB a day of pure clock drift** through every
night and weekend.

The key is now the observable market only — `ltp, oi, changeOI, volume, bid, ask, bidQty, askQty,
open, high, low, close, prevClose`. The derived Greeks still ride along in every row that is written;
they just do not get a vote on whether anything happened. Locked by a regression test that drifts the
Greeks on purpose and asserts the fingerprint does **not** change.

---

## 3. Honesty properties

- **Entry Greeks are RECONSTRUCTED, and say so.** The engines do not record Greeks at entry, so this
  observer joins a newly-seen position to the chain snapshot taken at the same moment. Every row
  carries `greeksSource: 'chain-at-first-sight'` and **`entryLagMs`** — how stale that reconstruction
  is versus the book's own `openAt`. A researcher can filter on it. It is never presented as an
  engine record.
- **No P&L is invented at this layer.** The `CLOSE` row records the exit mark and holding time but
  sets `realizedPnl: null` with the reason attached: the paper book reports gross-of-charges numbers
  and this observer cannot see the fill. Joining to a net P&L belongs to a derivation step.
- **First run adopts, it does not fabricate.** Positions already open when the recorder starts are
  taken as a baseline **without** emitting OPEN rows — claiming to have captured their entry Greeks
  would be a lie about when we looked.
- **A missing book makes the NAV total `null`, not smaller.** If any book is unreachable the total is
  withheld and `incomplete` names it. A partial sum would quietly overstate account health.
- **`null ≠ 0` throughout.** A field the feed did not send is `null`; an absent leg is `null`, not an
  empty object.
- **TD-2 honoured** — the server's `OptionAnalyzer` is a shared singleton mutated per request, so the
  per-instrument fetches are sequenced, never fanned out.

---

## 4. Measured footprint (not estimated)

| | measured |
|---|---|
| one NIFTY snapshot | **60 KB** |
| a full 6.25 h session, 3 instruments, 60 s cadence | **~66 MB/day** |
| per year (250 sessions) | **~16 GB uncompressed** |
| with H19's planned gzip-on-seal (~10×) | **~1.6 GB/year** |

Overnight and at weekends the self-gate means **zero** additional bytes. Compression on seal is the
obvious next step and is already in the H19 design; it is not implemented here.

---

## 5. Verification

- `test/warehouse-capture.test.js` — **45 assertions**, 8 `@test:` categories, isolated in a temp
  `WAREHOUSE_ROOT` so the repo's `data/` is never touched.
- **Full suite 57/57 green.**
- Live run against the running server: `NIFTY:appended(105) SENSEX:appended(189)
  BANKNIFTY:appended(175) | nav=appended(₹182568) baseline=2`, and the immediately following run
  reported `unchanged` on every stream — the self-gate working.
- Captured content verified: an ATM CE row carries `ltp, oi, changeOI, volume, iv, ivSource, bid,
  ask, bidQty, askQty, delta, gamma, theta, vega, pop`; the `ivSource` split (182 `feed` / 28 `bsm`)
  is preserved, so the measured-vs-assumed distinction survives into the archive.
- The NAV row carries the halt state, so `nifty: halted true, consecLosses 15` is now part of the
  permanent series rather than something only visible in a live endpoint.

## 6. Operations

Runs as its own process, started by the same at-logon task as everything else
(`start-bot.bat` → `node warehouse-capture.js --every 60`). Five processes now:
`server.js` · `option-warehouse` (300 s) · `warehouse-derive` (600 s) · `warehouse-api` (:3100) ·
`warehouse-capture` (60 s).

## 7. What this does NOT do
- It does not compute P&L, calibrate anything, or claim an edge. It records.
- It does not backfill history that was never captured — that data is gone.
- It does not compress or tier yet (H19 §5/§7).
- It does not close the outcome-count gap by itself: ~50 → ~200 labelled outcomes still requires
  **time and trades**. This module ensures that when they happen, the columns needed to learn from
  them exist.
