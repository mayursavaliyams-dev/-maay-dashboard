/* retention — archive pressure is reported; deletion is earned.
   Phase 0b of the backend hardening programme. See docs/086, docs/087.

   WHAT IT REPLACES
   ----------------
   Two lines in server.js, of this shape:

       while (files.length > 40) { try { fs2.unlinkSync(…files.shift()); } catch (_) {} }

   Three things are wrong with it, and only the first is obvious.

   1. It deletes data that cannot be re-bought. Price history can be re-fetched
      from the broker. An intraday option chain at 11:00 on a particular Tuesday
      cannot be bought back at any price.

   2. It deletes SILENTLY. Nothing is logged, so the archive shrinks without
      anybody learning that it did.

   3. It FAILS silently too. `catch (_) {}` means a deletion that fails and a
      deletion that succeeds produce exactly the same observable result: nothing.
      Both are unacceptable, and because they are written identically, neither
      can be distinguished from the other after the fact.

   THE POLICY
   ----------
   Retention never deletes by default. It reports pressure and stops.

   Deletion requires all three, and the absence of any one is a refusal:
     a. explicit permission        — allowDelete, or ARCHIVE_ALLOW_DELETE="true"
     b. a destination              — archiveTo
     c. proof the copy arrived     — re-read and digest-compare, not "no throw"

   (c) is the one that is easy to skip and is the reason this module exists in
   this shape. `fs.copyFileSync` not throwing is not evidence that the bytes are
   at the destination — a full disk, a truncating filesystem, or a destination
   that silently rewrites will all return without error. The file is re-read and
   its SHA-256 compared against the source before the original is unlinked. If
   they differ, the original stays and the mismatch is reported.

   Nothing here is swallowed. Every failure appears in `errors`. */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATED = /^\d{4}-\d{2}-\d{2}\.json$/;

const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

/** Read a permission flag. Only the exact word "true" grants it.
 *
 *  Matches the convention every other flag in this codebase uses: trimmed and
 *  lower-cased, so " TrUe " grants. A secretly case-sensitive permission flag is
 *  worse than a permissive one, because an operator who sets TRUE and sees no
 *  effect concludes the feature is broken rather than that the value is wrong. */
function grants(v) {
  return typeof v === 'string' && v.trim().toLowerCase() === 'true';
}

/** What WOULD be deleted, without deleting anything.
 *
 *  Safe to call at any time; it is the reporting half of the module and takes no
 *  action. `candidates` is oldest-first, matching the sort order the shipped
 *  loop used, so a later comparison of the two is meaningful. */
function planRetention({ dir, cap }) {
  let files = [];
  let readError = null;
  try {
    files = fs.readdirSync(dir).filter((f) => DATED.test(f)).sort();
  } catch (e) {
    readError = `${e.code || 'ERR'}: ${e.message}`;
  }
  const over = Math.max(0, files.length - cap);
  return {
    dir,
    cap,
    total: files.length,
    over,
    candidates: files.slice(0, over),
    keep: files.slice(over),
    readError,
  };
}

/** Enforce the policy.
 *
 *  @param allowDelete  explicit permission. Absent → report and refuse.
 *  @param archiveTo    where the file must exist before the original is removed.
 *  @param env          source for ARCHIVE_ALLOW_DELETE. Defaults to process.env.
 *  @param _copy        seam for tests. Production passes nothing.
 *  @param _unlink      seam for tests. Production passes nothing.
 *
 *  @returns { refused, reason, over, deleted[], archived[], errors[] }
 *
 *  `refused: false` with `deleted: []` and `over: 0` means there was nothing to
 *  do. `refused: true` means there WAS something to do and it was declined.
 *  Those are different states and are never merged — "nothing happened" is not
 *  a diagnosis.
 */
function enforceRetention({
  dir, cap, allowDelete, archiveTo = null, env = process.env,
  log = null, _copy = null, _unlink = null,
} = {}) {
  const plan = planRetention({ dir, cap });
  const out = {
    dir, cap, total: plan.total, over: plan.over,
    refused: false, reason: null, deleted: [], archived: [], errors: [],
  };

  if (plan.readError) {
    out.refused = true;
    out.reason = `the archive directory could not be read (${plan.readError}) — refusing to act on an unknown state`;
    return out;
  }

  if (plan.over === 0) return out;                      // nothing to do; not a refusal

  const permitted = allowDelete === true || grants(env.ARCHIVE_ALLOW_DELETE);
  if (!permitted) {
    out.refused = true;
    out.reason = `${plan.over} file(s) over the cap of ${cap}, and deletion is not permitted ` +
      '(set allowDelete, or ARCHIVE_ALLOW_DELETE="true"). Nothing was removed.';
    log?.warn?.(`[retention] ${dir}: ${out.reason}`);
    return out;
  }

  if (!archiveTo) {
    out.refused = true;
    out.reason = `${plan.over} file(s) over the cap of ${cap} and deletion is permitted, but no ` +
      'archiveTo destination was given. Permission to delete is not permission to lose.';
    log?.warn?.(`[retention] ${dir}: ${out.reason}`);
    return out;
  }

  const copy = _copy || ((src, dst) => fs.copyFileSync(src, dst));
  const unlink = _unlink || ((p) => fs.unlinkSync(p));

  try {
    fs.mkdirSync(archiveTo, { recursive: true });
  } catch (e) {
    out.refused = true;
    out.reason = `the destination could not be created (${e.code || 'ERR'}: ${e.message})`;
    return out;
  }

  for (const f of plan.candidates) {
    const src = path.join(dir, f);
    const dst = path.join(archiveTo, f);
    let srcDigest;
    try {
      srcDigest = sha256(src);
    } catch (e) {
      out.errors.push({ file: f, stage: 'read', reason: `${e.code || 'ERR'}: ${e.message}` });
      continue;
    }

    try {
      copy(src, dst);
    } catch (e) {
      out.errors.push({ file: f, stage: 'copy', reason: `${e.code || 'ERR'}: ${e.message}` });
      continue;
    }

    /* THE CHECK THAT EARNS THE DELETE.
       Not "copy did not throw" — re-read the destination and compare digests.
       A full disk, a truncating filesystem, or a destination that rewrites
       content all return from copyFileSync without error. */
    let dstDigest;
    try {
      dstDigest = sha256(dst);
    } catch (e) {
      out.errors.push({ file: f, stage: 'verify', reason: `could not re-read the copy: ${e.code || 'ERR'}` });
      continue;
    }
    if (dstDigest !== srcDigest) {
      out.errors.push({
        file: f, stage: 'verify',
        reason: `digest mismatch after copy — source ${srcDigest.slice(0, 12)}, ` +
                `destination ${dstDigest.slice(0, 12)}. The original was NOT deleted.`,
      });
      continue;
    }
    out.archived.push(f);

    try {
      unlink(src);
      out.deleted.push(f);
    } catch (e) {
      out.errors.push({ file: f, stage: 'unlink', reason: `${e.code || 'ERR'}: ${e.message}` });
    }
  }

  if (out.deleted.length) {
    log?.warn?.(`[retention] ${dir}: archived and removed ${out.deleted.length} file(s) → ${archiveTo}: ${out.deleted.join(', ')}`);
  }
  for (const e of out.errors) {
    log?.error?.(`[retention] ${dir}: ${e.file} failed at ${e.stage} — ${e.reason}`);
  }
  return out;
}

module.exports = { planRetention, enforceRetention, grants };
