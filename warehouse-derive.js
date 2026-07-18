'use strict';
/**
 * warehouse-derive.js — L2 derivation: the day-by-day High/Low RECORD, reconstructed
 * from the mirrored minute candles. Reproducible-from-raw (docs/H19 principle).
 *
 * WHY: the live daily `data/opthl/<date>.json` keeps only the day's SCALAR extremes,
 * so opening a PAST day's "full High/Low record" shows "no records yet" — the print
 * timeline was never saved durably. But `data/opt-candles/<date>.json` (rescued
 * day-by-day by option-warehouse.js) holds every strike's 1-minute bars. The H/L
 * record IS a pure function of those bars: a "new high" print is the first minute the
 * running session max increases; a "new low" the first minute the running min drops.
 * This module reconstructs that timeline for EVERY day we have candles for — no server
 * change, no Redis, no fabrication.
 *
 * Fidelity note (honest): this is MINUTE resolution (the durable granularity we have),
 * derived from bar highs/lows. Tick-level fidelity needs the raw-tick tee (future,
 * separate approval package). Unknown prints are simply absent — never invented.
 *
 * @test:characterization @test:unit @test:integration @test:regression
 * @test:failure @test:performance @test:memory-leak @test:rollback
 */
const fs = require('fs');
const path = require('path');
const { writeFileAtomicSync } = require('./safe-write.js');
const { _sha256, WAREHOUSE } = require('./option-warehouse.js');

const CANDLES_SRC = path.join(WAREHOUSE, 'L0_mirror', 'opt-candles');   // mirrored raw
const OUT_DIR     = path.join(WAREHOUSE, 'L2_strike', 'history');       // <date>.json
const ENGINE      = 'minute-extreme-walk@v1';
const IST_OFFSET_MIN = 330;
const DATE_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;

function _istTime(ms) { return new Date(ms + IST_OFFSET_MIN * 60000).toISOString().slice(11, 19); }
const _r2 = (n) => Math.round(n * 100) / 100;

/**
 * Reconstruct one strike's H/L record from its minute bars.
 * bars: [[minMs, open, high, low, close], ...] (any order — sorted here).
 * Returns { first, last, high, low, opening, closing, highRecord, lowRecord,
 *           maxExpansion, maxDecay } — extremes as {t, time, price}; unknowns null.
 */
function deriveStrike(bars) {
  if (!Array.isArray(bars)) return null;                    // garbage/undefined → null, never a throw
  const rows = bars.filter(b => Array.isArray(b) && b.length >= 5).slice().sort((a, b) => a[0] - b[0]);
  if (!rows.length) return null;

  const highRecord = [], lowRecord = [];
  let runHigh = -Infinity, runLow = Infinity;
  for (const [t, , hi, lo] of rows) {
    if (hi > runHigh) { runHigh = hi; highRecord.push({ t, time: _istTime(t), price: _r2(hi) }); }
    if (lo < runLow)  { runLow  = lo; lowRecord.push({ t, time: _istTime(t), price: _r2(lo) }); }
  }
  const first = rows[0], last = rows[rows.length - 1];
  return {
    first:   { t: first[0], time: _istTime(first[0]), price: _r2(first[1]) },   // opening bar open
    last:    { t: last[0],  time: _istTime(last[0]),  price: _r2(last[4]) },    // closing bar close
    opening: _r2(first[1]),
    closing: _r2(last[4]),
    high:    highRecord.length ? highRecord[highRecord.length - 1] : null,
    low:     lowRecord.length  ? lowRecord[lowRecord.length - 1]  : null,
    maxExpansion: runHigh > -Infinity && runLow < Infinity ? _r2(runHigh - runLow) : null,
    maxDecay:     highRecord.length && lowRecord.length ? _r2(runHigh - runLow) : null,
    highRecord, lowRecord,
  };
}

/** Derive every strike in one mirrored opt-candles day document. */
function deriveDay(candlesDoc) {
  const series = (candlesDoc && candlesDoc.series) || {};
  const strikes = {};
  let count = 0;
  for (const key of Object.keys(series)) {
    const d = deriveStrike(series[key]);
    if (d) { strikes[key] = d; count++; }
  }
  return { date: candlesDoc && candlesDoc.date, strikes, strikeCount: count };
}

/**
 * Scan the mirrored opt-candles and write one derived H/L-record file per day.
 * Idempotent by content hash; reproducible (each output records its source hash +
 * engine version). Never deletes; only (re)writes a day when the derivation changes.
 */
function deriveAll(opts = {}) {
  const now = opts.now || Date.now();
  const summary = { at: new Date(now).toISOString(), days: 0, written: 0, unchanged: 0, error: 0, results: [] };
  let names;
  try { names = fs.readdirSync(CANDLES_SRC); }
  catch (_) { return summary; }                        // nothing mirrored yet

  for (const name of names) {
    const m = DATE_RE.exec(name);
    if (!m) continue;
    const date = m[1];
    summary.days++;
    try {
      const rawBuf = fs.readFileSync(path.join(CANDLES_SRC, name));
      const srcHash = _sha256(rawBuf);
      const derived = deriveDay(JSON.parse(rawBuf.toString('utf8')));
      const out = {
        date, derivedAt: new Date(now).toISOString(), engine: ENGINE,
        source: { kind: 'opt-candles', file: name, sha256: srcHash },
        strikeCount: derived.strikeCount, strikes: derived.strikes,
      };
      const body = JSON.stringify(out);
      const dest = path.join(OUT_DIR, `${date}.json`);
      // Reproducibility: skip rewrite only if the SAME source hash already produced this file.
      // A missing/unreadable prior derived file means "never derived" → prevSrc stays
      // null → we (re)derive. Explicit assignment, not a silent swallow (audit 039).
      let prevSrc = null;
      try { prevSrc = JSON.parse(fs.readFileSync(dest, 'utf8')).source.sha256; }
      catch (_) { prevSrc = null; }
      if (prevSrc === srcHash && fs.existsSync(dest)) {
        summary.unchanged++; summary.results.push({ date, status: 'unchanged', strikes: derived.strikeCount });
        continue;
      }
      writeFileAtomicSync(dest, body);
      summary.written++;
      summary.results.push({ date, status: 'written', strikes: derived.strikeCount });
    } catch (e) {
      summary.error++; summary.results.push({ date, status: 'error', error: e.message });
    }
  }
  return summary;
}

module.exports = { deriveStrike, deriveDay, deriveAll, CANDLES_SRC, OUT_DIR, ENGINE };

// ── CLI: derive once, or on a loop (`--every <sec>`) after the mirror runs ──
if (require.main === module) {
  const args = process.argv.slice(2);
  const ix = args.indexOf('--every');
  const everySec = ix >= 0 ? Math.max(30, parseInt(args[ix + 1] || '600', 10)) : 0;
  const run = () => {
    const s = deriveAll();
    console.log(`[derive ${s.at}] days=${s.days} written=${s.written} unchanged=${s.unchanged} error=${s.error}`);
  };
  run();
  if (everySec) { console.log(`[derive] continuous every ${everySec}s — Ctrl-C to stop.`); setInterval(run, everySec * 1000); }
}
