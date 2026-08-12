/* ═══════════════════════════════════════════════════════════════════════════
   raw-journal — Stage 0b.1–0b.3. The append-only record of what actually
   arrived, written BEFORE anything parses it.

   WHY THIS EXISTS

   The capture path today calls `r.json()` and keeps the object
   (warehouse-capture.js:78). The bytes are never written. Everything in the
   warehouse is therefore a projection whose original does not exist, and a
   column the projection did not think to keep is gone permanently. No broker
   sells historical option ticks; an uncaptured day is not recoverable at any
   price.

   THE THREE PROPERTIES THAT MATTER, AND WHY

   1. RAW BEFORE PARSE. The body is written verbatim, as bytes, before any
      interpretation. A parser bug then costs a re-parse rather than a day.

   2. ABSENCE IS A RECORD. The existing capture skips writing when a snapshot
      matches the previous one. That makes "the market did not move" and "we
      were not watching" the same bytes on disk — which is to say, it destroys
      the coverage record while looking like a sensible optimisation. Here,
      every poll writes something: an observation, a `gap` when nothing came
      back, or an `error` with its reason. Deduplication, if ever wanted, is a
      read-time concern; it is never a write-time one.

   3. TRUNCATION IS DETECTABLE. A process killed mid-append leaves a partial
      final line. A reader that silently drops it cannot distinguish a crash
      from a clean end. `read()` reports `truncatedTail` explicitly and returns
      the intact records separately, so the caller decides.

   WHAT IT DELIBERATELY DOES NOT DO

   It does not compress, dedupe, validate, or interpret. It writes bytes and
   remembers where it put them. Every one of those other things is a
   rebuildable derivation, and this file is the thing they are rebuilt from.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FORMAT = 'antigravity/raw-journal';
const FORMAT_VERSION = 1;
const IST_OFFSET_MIN = 330;

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/* IST, because the trading day is an IST concept and a UTC date boundary falls
   at 05:30 IST — in the middle of nothing, but before the open, which is worse
   than useless for anyone reading the archive by session. */
function istParts(ms) {
  const d = new Date(ms + IST_OFFSET_MIN * 60000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return {
    date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    hour: p(d.getUTCHours()),
  };
}

class RawJournal {
  /**
   * @param {object} opts
   *   root        primary journal root (required)
   *   mirrorRoot  second disk. Omitted = single copy, and `status().mirrored`
   *               reports false so the absence is visible rather than assumed.
   *   stream      logical stream name, e.g. 'upstox-chain' or 'upstox-ws'
   *   writer      free-text identity recorded in the header
   *   now         () => epoch ms
   *   log
   */
  constructor(opts = {}) {
    if (!opts.root) throw new Error('raw-journal: `root` is required — a journal with no home is not a journal');
    if (!opts.stream) throw new Error('raw-journal: `stream` is required — an unnamed stream cannot be rebuilt from');
    this.root = opts.root;
    this.mirrorRoot = opts.mirrorRoot || null;
    this.stream = String(opts.stream);
    this.writer = opts.writer || 'unknown';
    this.now = opts.now || (() => Date.now());
    this.log = opts.log || console;

    this._seq = 0;
    this._openKey = null;                 // `${date}/${hour}` currently being written
    this.stats = {
      records: 0, bytes: 0, gaps: 0, errors: 0, repeats: 0, repeatBytesSaved: 0,
      rolls: 0, mirrorFailures: 0, writeFailures: 0,
    };
  }

  /* ── paths ─────────────────────────────────────────────────────────────── */
  _rel(date, hour) { return path.join('L0_journal', this.stream, date, `${hour}.jsonl`); }
  _primary(date, hour) { return path.join(this.root, this._rel(date, hour)); }
  _mirror(date, hour) { return this.mirrorRoot ? path.join(this.mirrorRoot, this._rel(date, hour)) : null; }
  _manifestPath(rootDir) { return path.join(rootDir, 'L0_journal', '_manifest', `${this.stream}.jsonl`); }

  /* ── the header ────────────────────────────────────────────────────────────
     Written as the first line of every hour file. Self-describing means a
     reader five years from now needs nothing but the file: what format, which
     version, which stream, which hour, who wrote it, and the record shape. */
  _header(date, hour) {
    return {
      _hdr: 1,
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      stream: this.stream,
      tradingDayIST: date,
      hourIST: hour,
      openedAt: new Date(this.now()).toISOString(),
      writer: this.writer,
      recordShape: {
        seq: 'monotonic within this process run, not across restarts',
        t: 'epoch ms at the moment of write (receive time, not event time)',
        kind: 'observation | gap | error',
        source: 'the URL, topic or socket the bytes came from',
        len: 'byte length of `body` before encoding',
        enc: 'utf8 | base64',
        body: 'the payload EXACTLY as received, unparsed. null for gap/error',
        note: 'reason string for gap/error, otherwise absent',
      },
      guarantee: 'append-only. every poll writes a record, including polls that returned nothing.',
    };
  }

  /* ── the write path ────────────────────────────────────────────────────── */
  _ensureOpen(ms) {
    const { date, hour } = istParts(ms);
    const key = `${date}/${hour}`;
    if (this._openKey === key) return { date, hour, rolled: false };

    const previous = this._openKey;
    this._openKey = key;

    const file = this._primary(date, hour);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // The header is written once per file, on creation. Re-opening an existing
    // hour (a restart inside the same hour) must NOT write a second header.
    if (!fs.existsSync(file)) {
      fs.appendFileSync(file, JSON.stringify(this._header(date, hour)) + '\n');
      const m = this._mirror(date, hour);
      if (m) {
        try {
          fs.mkdirSync(path.dirname(m), { recursive: true });
          if (!fs.existsSync(m)) fs.appendFileSync(m, JSON.stringify(this._header(date, hour)) + '\n');
        } catch (e) { this.stats.mirrorFailures++; this.log.warn?.(`[raw-journal] mirror header failed: ${e.message}`); }
      }
    }

    if (previous) {
      this.stats.rolls++;
      const [pd, ph] = previous.split('/');
      this.seal(pd, ph);
    }
    return { date, hour, rolled: !!previous };
  }

  /**
   * Write one record. The ONLY way bytes enter the journal.
   *
   * @param {object} rec
   *   kind    'observation' | 'gap' | 'error'
   *   source  where it came from
   *   body    Buffer or string — written verbatim. Omit for gap/error.
   *   note    reason, for gap/error
   *   meta    optional small object recorded alongside (never a substitute for body)
   * @returns {{ ok: boolean, seq: number, file: string, mirrored: boolean }}
   */
  write(rec = {}) {
    const kind = rec.kind || 'observation';
    if (!['observation', 'gap', 'error', 'repeat'].includes(kind)) throw new Error(`raw-journal: unknown kind '${kind}'`);
    if (kind === 'observation' && rec.body == null) {
      // An observation with no body is a gap that has been mislabelled. Refusing
      // is better than storing an empty observation that later reads as data.
      throw new Error('raw-journal: an observation must carry a body — use kind:"gap" when nothing arrived');
    }
    /* `repeat` — the source answered with bytes IDENTICAL to the last observation
       from it. Added 2026-08-12, on the first day of real use.

       MEASURED: writing the full body every poll grew this journal at 3.7 MB an
       hour, around the clock, because the capture loop polls all night and an
       out-of-hours option chain never changes. 88 MB a day, 31.5 GB a year, and
       almost all of it byte-identical copies.

       A `repeat` is NOT a gap: something arrived, and we were watching, and both
       of those are facts worth keeping. It is not an observation either, because
       storing the bytes again says nothing new. It carries the SHA-256 of the
       bytes it repeats, so the payload is still reconstructable from the earlier
       record — nothing is lost, only the duplication.

       `warehouse-capture` already refuses to append an unchanged snapshot for
       exactly this reason and says so at the top of the file: "each writer is
       CONTENT-ADDRESSED". The journal was the one writer that was not. */
    if (kind === 'repeat' && !rec.sha256) {
      throw new Error('raw-journal: a repeat must carry the sha256 of the bytes it repeats — otherwise it is an unrecoverable hole');
    }

    const ms = this.now();
    const { date, hour } = this._ensureOpen(ms);

    let enc = null, body = null, len = 0;
    if (rec.body != null) {
      const buf = Buffer.isBuffer(rec.body) ? rec.body : Buffer.from(String(rec.body), 'utf8');
      len = buf.length;
      // utf8 when the bytes round-trip exactly; base64 otherwise. Chosen per
      // record and recorded per record, so a binary websocket frame and a JSON
      // REST body can share one stream without either being mangled.
      const asUtf8 = buf.toString('utf8');
      if (Buffer.from(asUtf8, 'utf8').equals(buf)) { enc = 'utf8'; body = asUtf8; }
      else { enc = 'base64'; body = buf.toString('base64'); }
    }

    const out = {
      seq: ++this._seq,
      t: ms,
      kind,
      source: rec.source || null,
      len,
      enc,
      body,
    };
    if (rec.note) out.note = String(rec.note);
    if (rec.meta && typeof rec.meta === 'object') out.meta = rec.meta;
    // The hash the repeat points at. Without it the record is an unrecoverable
    // hole, which is why write() refuses a repeat that lacks one.
    if (rec.sha256) out.sha256 = String(rec.sha256);

    const line = JSON.stringify(out) + '\n';
    const file = this._primary(date, hour);

    try {
      fs.appendFileSync(file, line);
    } catch (e) {
      // A failed journal write is not something to swallow: it is the loss this
      // module exists to prevent. Counted, logged, and reported to the caller.
      this.stats.writeFailures++;
      this.log.error?.(`[raw-journal] PRIMARY WRITE FAILED (${e.message}) — ${kind} from ${out.source}`);
      return { ok: false, seq: out.seq, file, mirrored: false, error: e.message };
    }

    this.stats.records++;
    this.stats.bytes += len;
    if (kind === 'gap') this.stats.gaps++;
    if (kind === 'error') this.stats.errors++;
    if (kind === 'repeat') {
      this.stats.repeats = (this.stats.repeats || 0) + 1;
      // The bytes NOT written, so the saving is a measured number rather than a
      // claim. A reader can compare it against stats.bytes and see what the
      // journal would have cost without content addressing.
      this.stats.repeatBytesSaved = (this.stats.repeatBytesSaved || 0) + (Number(rec.repeatedLen) || 0);
    }

    let mirrored = false;
    const m = this._mirror(date, hour);
    if (m) {
      try { fs.appendFileSync(m, line); mirrored = true; }
      catch (e) {
        // The mirror is the second copy, not the record. Its failure degrades
        // durability and is counted; it does not fail the write, because
        // refusing to keep one copy when the second disk is full would turn a
        // degraded state into a total loss.
        this.stats.mirrorFailures++;
        this.log.warn?.(`[raw-journal] mirror write failed: ${e.message}`);
      }
    }

    return { ok: true, seq: out.seq, file, mirrored };
  }

  /** Convenience: nothing came back. Absence, recorded. */
  gap(source, note, meta) { return this.write({ kind: 'gap', source, note: note || 'no data returned', meta }); }

  /** The source answered with exactly the bytes it answered with last time.
   *  @param sha256       digest of those bytes — required; it is what makes the
   *                      payload reconstructable from the earlier record
   *  @param repeatedLen  how many bytes were not written, for the saving stat */
  repeat(source, sha256, repeatedLen, meta) {
    return this.write({ kind: 'repeat', source, sha256, repeatedLen, meta, note: 'identical to the previous observation from this source' });
  }
  /** Convenience: the call failed. The reason, recorded. */
  error(source, note, meta) { return this.write({ kind: 'error', source, note: note || 'call failed', meta }); }

  /* ── sealing ───────────────────────────────────────────────────────────────
     On roll (and on close) the finished hour is hashed and the hash appended to
     a manifest. This is what makes a later copy verifiable and a later
     corruption detectable — without it, "three copies" means three files that
     might all differ. */
  seal(date, hour) {
    const file = this._primary(date, hour);
    if (!fs.existsSync(file)) return null;
    let buf;
    try { buf = fs.readFileSync(file); }
    catch (e) { this.log.warn?.(`[raw-journal] cannot seal ${file}: ${e.message}`); return null; }

    const entry = {
      stream: this.stream,
      tradingDayIST: date, hourIST: hour,
      rel: this._rel(date, hour),
      bytes: buf.length,
      sha256: sha256(buf),
      records: countRecords(buf),
      sealedAt: new Date(this.now()).toISOString(),
    };

    // The mirror is hashed independently and compared. A silent divergence
    // between the two copies is exactly the failure a manifest exists to catch.
    const m = this._mirror(date, hour);
    if (m && fs.existsSync(m)) {
      try {
        const mb = fs.readFileSync(m);
        entry.mirrorSha256 = sha256(mb);
        entry.mirrorAgrees = entry.mirrorSha256 === entry.sha256;
        if (!entry.mirrorAgrees) this.log.error?.(`[raw-journal] MIRROR DIVERGED for ${entry.rel} — primary ${entry.sha256.slice(0, 12)} vs mirror ${entry.mirrorSha256.slice(0, 12)}`);
      } catch (e) { entry.mirrorSha256 = null; entry.mirrorAgrees = null; }
    } else if (m) {
      entry.mirrorSha256 = null;
      entry.mirrorAgrees = null;      // not false — the mirror is absent, not wrong
    }

    for (const rootDir of [this.root, this.mirrorRoot].filter(Boolean)) {
      try {
        const mp = this._manifestPath(rootDir);
        fs.mkdirSync(path.dirname(mp), { recursive: true });
        fs.appendFileSync(mp, JSON.stringify(entry) + '\n');
      } catch (e) { this.log.warn?.(`[raw-journal] manifest append failed: ${e.message}`); }
    }
    return entry;
  }

  /** Seal whatever hour is open. Call on shutdown. */
  close() {
    if (!this._openKey) return null;
    const [d, h] = this._openKey.split('/');
    const e = this.seal(d, h);
    this._openKey = null;
    return e;
  }

  status() {
    return {
      stream: this.stream,
      root: this.root,
      mirrored: !!this.mirrorRoot,
      openHour: this._openKey,
      stats: { ...this.stats },
    };
  }
}

/* ── reading ────────────────────────────────────────────────────────────────
   Separate from the writer on purpose: a reader that can also write is a
   reader that can corrupt what it is reading. */

function countRecords(buf) {
  let n = 0;
  const s = buf.toString('utf8');
  for (const line of s.split('\n')) { if (line.trim() && !line.startsWith('{"_hdr"')) n++; }
  return n;
}

/**
 * Read one hour file.
 *
 * A crash mid-append leaves a partial final line. It is reported, never
 * silently dropped: a reader that discards it cannot tell a crash from a clean
 * end, and that difference is the whole point of a coverage record.
 *
 * @returns {{ header, records, truncatedTail, malformed, bytes, sha256 }}
 */
function readJournalFile(file) {
  const buf = fs.readFileSync(file);
  const text = buf.toString('utf8');
  const endsClean = text.length === 0 || text.endsWith('\n');
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  let header = null;
  const records = [];
  const malformed = [];
  let truncatedTail = null;

  lines.forEach((line, i) => {
    const isLast = i === lines.length - 1;
    let obj;
    try { obj = JSON.parse(line); }
    catch (e) {
      if (isLast && !endsClean) {
        // The characteristic shape of a process killed mid-write.
        truncatedTail = { bytes: Buffer.byteLength(line, 'utf8'), preview: line.slice(0, 120) };
      } else {
        malformed.push({ lineNo: i + 1, preview: line.slice(0, 120) });
      }
      return;
    }
    if (obj && obj._hdr) { header = obj; return; }
    records.push(obj);
  });

  return { header, records, truncatedTail, malformed, bytes: buf.length, sha256: sha256(buf) };
}

/**
 * Verify a manifest against the files it describes.
 * @returns {{ checked, ok, mismatched: [], missing: [] }}
 */
function verifyManifest(root, stream) {
  const mp = path.join(root, 'L0_journal', '_manifest', `${stream}.jsonl`);
  const out = { checked: 0, ok: 0, mismatched: [], missing: [] };
  if (!fs.existsSync(mp)) return out;
  for (const line of fs.readFileSync(mp, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    out.checked++;
    const f = path.join(root, e.rel);
    if (!fs.existsSync(f)) { out.missing.push(e.rel); continue; }
    const actual = sha256(fs.readFileSync(f));
    // A file may have GROWN since sealing only if the process re-opened that
    // hour. That is still a mismatch against the sealed hash and is reported as
    // one — a manifest that tolerates drift verifies nothing.
    if (actual === e.sha256) out.ok++;
    else out.mismatched.push({ rel: e.rel, sealed: e.sha256, actual });
  }
  return out;
}

module.exports = { RawJournal, readJournalFile, verifyManifest, FORMAT, FORMAT_VERSION, istParts };
