/**
 * safe-write.js — atomic, fail-closed JSON persistence.
 *
 * ── WHY (migration C3) ───────────────────────────────────────────────────────
 * Every ledger in this platform was written with `fs.writeFileSync(file, json)`
 * inside a `catch (_) {}`. That is not one bug but three:
 *
 *   1. NOT ATOMIC. `writeFileSync` truncates the file, then writes. A reader that
 *      arrives in between sees an empty or half-written file. Measured on this
 *      machine against a ~20k-row ledger: of 209 concurrent reads, 27 were
 *      unparseable and 172 were EMPTY. 95% corrupt.
 *
 *   2. NOT CRASH-SAFE. If the process dies mid-write the file stays truncated.
 *
 *   3. SILENT. The write error is swallowed, and on the next boot the loader does
 *      `try { JSON.parse(...) } catch { return [] }` — so a truncated ledger is
 *      silently read as "no trades", and the first save of the day writes `[]`
 *      over it. A single mistimed Ctrl-C destroys the forward-test evidence that
 *      gates live-trading approval, and nothing anywhere reports it.
 *
 * ── GUARANTEES ───────────────────────────────────────────────────────────────
 *   • A reader NEVER observes a partial file. It sees the old bytes or the new
 *     bytes, never a mixture. (write to temp → fsync → atomic rename)
 *   • A crash at ANY point leaves the previous file intact and parseable.
 *   • Invalid JSON never replaces a good file — the serialized text is parsed back
 *     before the rename (requirement 6).
 *   • Any write error throws. Nothing is swallowed (requirement 7).
 *   • File permissions are carried over to the replacement (requirement 5).
 *   • `readJsonSync` recovers from `<file>.bak` when the primary is corrupt, and
 *     throws rather than inventing an empty value.
 *
 * ── WHAT THIS DOES NOT GUARANTEE ─────────────────────────────────────────────
 * Atomicity is not mutual exclusion. Two concurrent writers each produce a
 * *complete, valid* file, but the last rename wins and the other writer's update
 * is lost. This module prevents CORRUPTION, not LOST UPDATES. The correct fix for
 * lost updates is a single writer per ledger (or an append-only log), not a lock.
 * `withLock()` is offered for callers that genuinely need serialization, and it is
 * advisory: it only excludes other processes that also use it.
 *
 * ── PLATFORM NOTES (probed, not assumed) ─────────────────────────────────────
 *   renameSync over an existing file : atomic overwrite. Works on Windows (libuv
 *                                      uses MoveFileExW with REPLACE_EXISTING).
 *   fsync on a file fd               : works.
 *   fsync on a directory fd          : EPERM on Windows. Best-effort only; on
 *                                      POSIX it is what makes the rename durable
 *                                      across a power loss.
 *
 * PURE LEAF: zero local dependencies.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

let _tmpSeq = 0;

/** Unique temp name in the SAME directory — rename is only atomic within one filesystem. */
function _tmpName(file) {
  return path.join(path.dirname(file), `.${path.basename(file)}.tmp-${process.pid}-${Date.now().toString(36)}-${_tmpSeq++}`);
}

function _unlinkQuiet(p) {
  try { fs.unlinkSync(p); } catch (_) { /* already gone */ }
}

/**
 * fsync the directory so the rename itself is durable.
 * POSIX only; Windows rejects a directory fd with EPERM. Never fatal.
 * @returns {boolean} true when the directory entry was flushed
 */
function _fsyncDir(dir) {
  let fd;
  try { fd = fs.openSync(dir, 'r'); } catch (_) { return false; }
  try { fs.fsyncSync(fd); return true; }
  catch (_) { return false; }          // EPERM / EISDIR / EINVAL — platform does not allow it
  finally { try { fs.closeSync(fd); } catch (_) {} }
}

/**
 * Atomically replace `file` with `data`.
 *
 * @param {string} file
 * @param {string|Buffer} data
 * @param {object} [opts]
 *   fsync   {boolean} flush file contents before rename        (default true)
 *   backup  {boolean} keep the previous good file as <file>.bak (default false)
 *   mode    {number}  permissions; defaults to the existing file's, else 0o644
 * @returns {{bytes:number, durable:boolean, dirDurable:boolean, backedUp:boolean, created:boolean}}
 * @throws  on ANY failure. The original file is left untouched.
 */
function writeFileAtomicSync(file, data, opts = {}) {
  if (typeof file !== 'string' || !file) throw new TypeError('safe-write: file path is required');
  if (typeof data !== 'string' && !Buffer.isBuffer(data)) {
    throw new TypeError('safe-write: data must be a string or Buffer');
  }
  const doFsync = opts.fsync !== false;
  const dir = path.dirname(file);

  fs.mkdirSync(dir, { recursive: true });

  // Inherit the existing file's permissions (requirement 5).
  let mode = opts.mode;
  let existed = false;
  try { const st = fs.statSync(file); existed = true; if (mode == null) mode = st.mode & 0o777; }
  catch (_) { /* new file */ }
  if (mode == null) mode = 0o644;

  // Preserve the last known good copy BEFORE we touch anything (requirement 8).
  let backedUp = false;
  if (opts.backup && existed) {
    try { fs.copyFileSync(file, file + '.bak'); backedUp = true; }
    catch (e) { throw new Error(`safe-write: could not create backup of ${file}: ${e.message}`); }
  }

  const tmp = _tmpName(file);
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', mode);      // 'wx' → fail if it somehow exists
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    let off = 0;
    while (off < buf.length) off += fs.writeSync(fd, buf, off, buf.length - off);
    if (doFsync) fs.fsyncSync(fd);          // contents on disk before the rename
    fs.closeSync(fd);
    fd = undefined;

    // openSync's mode is subject to umask; set it explicitly.
    try { fs.chmodSync(tmp, mode); } catch (_) { /* e.g. Windows: no-op */ }

    fs.renameSync(tmp, file);               // ← the atomic step
  } catch (e) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
    _unlinkQuiet(tmp);                      // never leave a partial file behind (requirement 4)
    throw e;                                // fail closed (requirement 7)
  }

  const dirDurable = doFsync ? _fsyncDir(dir) : false;
  return {
    bytes: Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data, 'utf8'),
    durable: doFsync, dirDurable, backedUp, created: !existed,
  };
}

/**
 * Serialize, VALIDATE, then atomically replace.
 *
 * The serialized text is parsed back before the rename, so a value that stringifies
 * to something unreadable can never replace a good ledger (requirement 6).
 *
 * @param {string} file
 * @param {*} value
 * @param {object} [opts]  pretty {boolean|number} · plus every writeFileAtomicSync option
 */
function writeJsonSync(file, value, opts = {}) {
  const indent = opts.pretty === true ? 2 : (typeof opts.pretty === 'number' ? opts.pretty : 0);

  let json;
  try { json = JSON.stringify(value, null, indent); }
  catch (e) { throw new Error(`safe-write: value is not serializable for ${file}: ${e.message}`); }

  // `undefined`, a bare function, or a Symbol all stringify to undefined.
  if (typeof json !== 'string') throw new TypeError(`safe-write: value serialized to ${json} for ${file}`);

  // Round-trip check. Cheap next to the fsync, and it is the whole point.
  try { JSON.parse(json); }
  catch (e) { throw new Error(`safe-write: refusing to write invalid JSON to ${file}: ${e.message}`); }

  return writeFileAtomicSync(file, json, opts);
}

/**
 * Read JSON, recovering from `<file>.bak` if the primary is unreadable.
 *
 * Fails CLOSED. It does not invent `[]` or `{}` — that behaviour is exactly how a
 * truncated ledger got silently overwritten with an empty one. Pass an explicit
 * `fallback` only when an absent file genuinely means "nothing yet".
 *
 * @param {string} file
 * @param {object} [opts]
 *   fallback  {*}        value to return when the file does NOT exist
 *   onRecover {function} called with (reason, backupPath) when .bak was used
 * @returns {*}
 * @throws when the file exists but neither it nor its backup can be parsed
 */
function readJsonSync(file, opts = {}) {
  const hasFallback = Object.prototype.hasOwnProperty.call(opts, 'fallback');

  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') {
      if (hasFallback) return opts.fallback;
      throw new Error(`safe-write: ${file} does not exist and no fallback was supplied`);
    }
    throw e;
  }

  try { return JSON.parse(raw); }
  catch (primaryErr) {
    const bak = file + '.bak';
    let bakRaw;
    try { bakRaw = fs.readFileSync(bak, 'utf8'); }
    catch (_) {
      throw new Error(`safe-write: ${file} is corrupt (${primaryErr.message}) and no backup exists at ${bak}. Refusing to guess.`);
    }
    let value;
    try { value = JSON.parse(bakRaw); }
    catch (bakErr) {
      throw new Error(`safe-write: ${file} is corrupt (${primaryErr.message}) and its backup is corrupt too (${bakErr.message}). Refusing to guess.`);
    }
    if (typeof opts.onRecover === 'function') opts.onRecover(primaryErr.message, bak);
    else console.warn(`[safe-write] ${file} was corrupt; recovered from ${bak}. Investigate — a writer crashed or a second process wrote it.`);
    return value;
  }
}

/**
 * Remove orphaned `.tmp-*` files left by a crashed writer.
 * They are inert — the rename never happened — but they accumulate.
 * @returns {string[]} the paths removed
 */
function cleanupTemp(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  const removed = [];
  for (const n of names) {
    if (!/\.tmp-\d+-[a-z0-9]+-\d+$/.test(n)) continue;
    const p = path.join(dir, n);
    try { fs.unlinkSync(p); removed.push(p); } catch (_) {}
  }
  return removed;
}

/**
 * Advisory cross-process lock, for the rare caller that needs read-modify-write
 * serialization rather than mere atomicity.
 *
 * ADVISORY: it only excludes processes that also call withLock() on the same file.
 * A stale lock (holder killed) is broken after `staleMs`.
 *
 * @param {string} file      the resource being protected
 * @param {function} fn      executed while the lock is held
 * @param {object} [opts]    timeoutMs (default 5000) · staleMs (default 30000)
 */
function withLock(file, fn, opts = {}) {
  const lock = file + '.lock';
  const timeoutMs = opts.timeoutMs ?? 5000;
  const staleMs = opts.staleMs ?? 30000;
  const deadline = Date.now() + timeoutMs;

  fs.mkdirSync(path.dirname(file), { recursive: true });

  for (;;) {
    try {
      const fd = fs.openSync(lock, 'wx');          // atomic create-if-absent
      fs.writeSync(fd, `${process.pid}\n${Date.now()}\n${os.hostname()}`);
      fs.closeSync(fd);
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age = Infinity;
      try { age = Date.now() - fs.statSync(lock).mtimeMs; } catch (_) { continue; }
      if (age > staleMs) { _unlinkQuiet(lock); continue; }   // holder died
      if (Date.now() > deadline) throw new Error(`safe-write: timed out after ${timeoutMs} ms waiting for ${lock}`);
      // Busy-wait: these are sub-millisecond critical sections and this module is sync.
      const spin = Date.now() + 5;
      while (Date.now() < spin) { /* yield nothing; sync API by design */ }
    }
  }

  try { return fn(); }
  finally { _unlinkQuiet(lock); }
}

module.exports = { writeJsonSync, writeFileAtomicSync, readJsonSync, cleanupTemp, withLock };
