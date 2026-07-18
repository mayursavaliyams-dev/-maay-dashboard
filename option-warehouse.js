'use strict';
/**
 * option-warehouse.js — immutable mirror of the existing durable option stores.
 *
 * WHY: `data/opt-candles/<date>.json` is auto-DELETED after 40 files by the live
 * server (server.js `_persistOptCandles`), and `data/opthl/<date>.json` keeps only
 * scalar day-extremes. Both are lossy for research and one is actively erasing minute
 * history. This module RESCUES that data into `data/warehouse/` — write-once,
 * never-deleted, never-shrunk — WITHOUT modifying any existing module or the live
 * trade loop. It is a standalone, out-of-process mirror (design: docs/H19).
 *
 * NON-NEGOTIABLE RULES honoured here:
 *   • never overwrite historical data with a LESS-complete version (most-complete wins)
 *   • never delete anything from the warehouse (no retention cap — unlike the source)
 *   • never invent data (verbatim byte-for-byte copy of the source; unknown stays absent)
 *   • atomic writes (reuses the repo-proven safe-write.writeFileAtomicSync)
 *   • append-only audit log of every action
 *
 * This is a MIRROR of already-persisted (minute/scalar) data, tagged accordingly.
 * True raw-tick L0 capture still requires the tee hook (a separate approval package).
 *
 * @test:characterization @test:unit @test:integration @test:regression
 * @test:failure @test:performance @test:memory-leak @test:rollback
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeFileAtomicSync } = require('./safe-write.js');

const ROOT       = __dirname;
const SRC        = {
  'opt-candles': path.join(ROOT, 'data', 'opt-candles'),
  'opthl':       path.join(ROOT, 'data', 'opthl'),
};
// Output base is redirectable (WAREHOUSE_ROOT) so tests write to an isolated temp dir
// while STILL reading the real source dirs read-only. Production leaves it unset.
const OUT_BASE   = process.env.WAREHOUSE_ROOT || ROOT;
const WAREHOUSE  = path.join(OUT_BASE, 'data', 'warehouse');
const MIRROR_DIR = path.join(WAREHOUSE, 'L0_mirror');       // <kind>/<date>.json (+ .sha256)
const MANIFEST   = path.join(WAREHOUSE, '_manifest');
const LOG_FILE   = path.join(MANIFEST, 'mirror-log.jsonl'); // append-only audit

const IST_OFFSET_MIN = 330;
const DATE_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;

function _sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function _istDate(now = Date.now()) { return new Date(now + IST_OFFSET_MIN * 60000).toISOString().slice(0, 10); }
function _readHash(hashFile) { try { return fs.readFileSync(hashFile, 'utf8').trim(); } catch (_) { return null; } }

function _appendLog(entry) {
  try {
    fs.mkdirSync(MANIFEST, { recursive: true });
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  } catch (e) { console.warn(`[warehouse] audit-log append failed: ${e.message}`); }
}

/**
 * Mirror one source file's CURRENT bytes into the warehouse for (kind,date).
 * Returns { status, kind, date, bytes, hash }.
 *  status: 'created' | 'grown' | 'unchanged' | 'ignored_smaller' | 'error'
 *
 * Rule: the warehouse keeps the MOST-COMPLETE snapshot ever seen (byte length is the
 * completeness proxy for these append-only-growing daily files). A strictly smaller
 * source is NEVER written over a larger stored copy — it is preserved as a flagged
 * `.shrunk` sidecar and the anomaly is logged. Nothing is ever lost or shrunk.
 */
function mirrorOne(kind, date, bytes, now = Date.now()) {
  // Fail closed on bad input — a non-buffer/string can never become a mirrored file.
  if (typeof bytes !== 'string' && !Buffer.isBuffer(bytes)) {
    const e = { at: new Date(now).toISOString(), action: 'error', kind, date, error: 'bytes must be a string or Buffer' };
    _appendLog(e);
    return { status: 'error', kind, date, error: e.error };
  }
  const destDir  = path.join(MIRROR_DIR, kind);
  const dest     = path.join(destDir, `${date}.json`);
  const hashFile = `${dest}.sha256`;
  const hash     = _sha256(bytes);
  const size     = bytes.length;
  const at       = new Date(now).toISOString();

  try {
    if (fs.existsSync(dest)) {
      const storedHash = _readHash(hashFile) || _sha256(fs.readFileSync(dest));
      if (storedHash === hash) {
        return { status: 'unchanged', kind, date, bytes: size, hash };
      }
      const storedSize = fs.statSync(dest).size;
      if (size < storedSize) {
        // Source shrank vs what we already preserved → keep the larger, quarantine the smaller.
        const shrunk = path.join(destDir, `${date}.${hash.slice(0, 8)}.shrunk.json`);
        writeFileAtomicSync(shrunk, bytes);
        const e = { at, action: 'ignored_smaller', kind, date, bytes: size, storedBytes: storedSize, hash, note: 'source smaller than stored; larger preserved' };
        _appendLog(e);
        return { status: 'ignored_smaller', kind, date, bytes: size, hash };
      }
      // Same-or-larger, different content → complete the record (grow).
      writeFileAtomicSync(dest, bytes);
      writeFileAtomicSync(hashFile, hash);
      _appendLog({ at, action: 'grown', kind, date, bytes: size, prevBytes: storedSize, hash });
      return { status: 'grown', kind, date, bytes: size, hash };
    }
    // First time we see this (kind,date).
    writeFileAtomicSync(dest, bytes);
    writeFileAtomicSync(hashFile, hash);
    _appendLog({ at, action: 'created', kind, date, bytes: size, hash });
    return { status: 'created', kind, date, bytes: size, hash };
  } catch (e) {
    _appendLog({ at, action: 'error', kind, date, bytes: size, error: e.message });
    return { status: 'error', kind, date, bytes: size, hash, error: e.message };
  }
}

/** Scan the source dirs and mirror every dated file. Returns a summary. */
function mirrorAll(opts = {}) {
  const now = opts.now || Date.now();
  const today = _istDate(now);
  const summary = { at: new Date(now).toISOString(), today, created: 0, grown: 0, unchanged: 0, ignored_smaller: 0, error: 0, files: 0, results: [] };

  for (const kind of Object.keys(SRC)) {
    const dir = SRC[kind];
    let names;
    try { names = fs.readdirSync(dir); } catch (_) { continue; } // source dir absent → nothing to mirror
    for (const name of names) {
      const m = DATE_RE.exec(name);
      if (!m) continue;
      const date = m[1];
      let bytes;
      try { bytes = fs.readFileSync(path.join(dir, name)); }
      catch (e) { summary.error++; summary.results.push({ status: 'error', kind, date, error: e.message }); continue; }
      const r = mirrorOne(kind, date, bytes, now);
      summary[r.status] = (summary[r.status] || 0) + 1;
      summary.files++;
      if (opts.verbose) summary.results.push(r);
    }
  }
  return summary;
}

module.exports = { mirrorOne, mirrorAll, _istDate, _sha256, WAREHOUSE, MIRROR_DIR, LOG_FILE, SRC };

// ── CLI: one-shot, or a self-contained loop (`--every <sec>`) for continuous rescue ──
if (require.main === module) {
  const args = process.argv.slice(2);
  const everyIx = args.indexOf('--every');
  const everySec = everyIx >= 0 ? Math.max(30, parseInt(args[everyIx + 1] || '300', 10)) : 0;
  const run = () => {
    const s = mirrorAll();
    console.log(`[warehouse ${s.at}] files=${s.files} created=${s.created} grown=${s.grown} unchanged=${s.unchanged} ignored_smaller=${s.ignored_smaller} error=${s.error}`);
  };
  run();
  if (everySec) {
    console.log(`[warehouse] continuous mirror every ${everySec}s — Ctrl-C to stop.`);
    setInterval(run, everySec * 1000);
  }
}
