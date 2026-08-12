/* TEST CATEGORIES — characterization · unit · failure · integration
   @test:characterization @test:unit @test:failure @test:integration

   characterization = §1 pins the SHIPPED deletion loop, lifted verbatim from server.js, and was
   proven to delete before retention.js existed. No performance / memory-leak / rollback tests.

   These markers are what this file ACTUALLY contains. The Testing Rule names eight
   categories; this suite declares the ones it has and names the ones it does not,
   because a marker asserting coverage that was never written is worse than no marker:
   it converts missing work into apparent compliance. */
/* PHASE 0b — the archive must not delete itself.
   Written and run BEFORE retention.js exists.

   WHY THE FIRST SECTION EXTRACTS CODE FROM server.js BY TEXT
   ----------------------------------------------------------
   §1 must demonstrate that the SHIPPED code deletes. A paraphrase of the
   retention loop would demonstrate that my paraphrase deletes, which proves
   nothing about the system (prompt F1). So the expression is lifted verbatim out
   of server.js and executed against a temporary directory. If someone edits that
   line, §1 either still finds it or fails loudly — it cannot quietly stop
   testing the thing it names.

   WHAT IS AT STAKE
   ----------------
   data/opt-candles holds 19 files / 62.7 MB as of 2026-08-08, capped at 40.
   Headroom is 21 trading days; the earliest deletion date is 2026-09-07.
   Price history can be re-bought from the broker. An intraday option chain
   cannot be bought back at any price.
*/
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failures = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e && e.message}`); }
};

const mkFiles = (n, prefix = '2026-01-01') => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retention-'));
  const base = new Date(`${prefix}T00:00:00Z`).getTime();
  for (let i = 0; i < n; i++) {
    const d = new Date(base + i * 86400000).toISOString().slice(0, 10);
    fs.writeFileSync(path.join(dir, `${d}.json`), JSON.stringify({ date: d, payload: 'x'.repeat(64) }));
  }
  return dir;
};
const count = (dir) => fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).length;

console.log('\n§1 — REGRESSION: the deleting loops are gone from server.js');

/* THIS SECTION WAS A CHARACTERIZATION TEST AND IS NOW A REGRESSION TEST.

   Until 2026-08-10 it lifted this line verbatim out of server.js and ran it:

       while (files.length > 40) { try { fs2.unlinkSync(…files.shift()); } catch (_) {} }

   and proved, against the shipped code, that 45 files went in and 40 came out —
   five days of intraday option chain unlinked with no log, inside a catch that
   made a failed deletion and a successful one indistinguishable. That run is
   recorded in docs/089 §0b, and it is the evidence the fix was needed.

   The loops were replaced by enforceRetention() in the same commit that changed
   this section. A characterization test whose subject has been deliberately
   removed cannot go on characterizing it, so it now asserts the removal — which
   is the thing that can actually regress.

   What is deliberately NOT done: pasting a copy of the old loop into this file
   and running that. It would prove a literal in this test deletes files, which
   nobody doubted, and would say nothing about server.js. */

t('no self-deleting retention loop remains in server.js', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  // Comments stripped first: the replacement quotes the old line in a comment so
  // the next reader can see what changed, and a line-based scan counts that quote.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const loops = code.split('\n')
    .filter((l) => /while \(files\.length > \d+\) \{ try \{ fs2\.unlinkSync/.test(l));
  assert.strictEqual(loops.length, 0,
    `${loops.length} self-deleting retention loop(s) are back in server.js. The archive ` +
    'is the only copy of intraday option data: price history can be re-bought from the ' +
    'broker, an option chain at 11:00 on a particular Tuesday cannot be bought back at ' +
    'any price.');
});

t('both archives go through enforceRetention instead', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const calls = [...src.matchAll(/enforceRetention\(\{\s*dir:\s*(\w+),\s*cap:\s*(\d+)/g)]
    .map((m) => `${m[1]}:${m[2]}`);
  assert.deepStrictEqual(calls.sort(), ['_optCandDir:40', '_optHLDir:120'],
    `expected both archives routed through enforceRetention, got ${JSON.stringify(calls)}`);
});

t('and the outer silence went with them', () => {
  /* Removing the deletion without removing `catch (_) {}` would leave the archive
     safe and every failure invisible: a persist that has stopped working would
     look exactly like a persist that has nothing to write. */
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const i = src.indexOf('function _persistOptCandles');
  assert.ok(i > 0, 'the persist function was renamed — re-derive this assertion');
  const body = src.slice(i, i + 3000);
  assert.ok(/console\.error\('\[opt-candles\] persist failed/.test(body),
    'the opt-candles persist path swallows its own failure again');
});

console.log('\n§2 — retention.js: the archive is never deleted by default');

const { planRetention, enforceRetention } = require('../retention');

t('THE ACCEPTANCE TEST: 45 files, default policy → count unchanged, nothing unlinked', () => {
  const dir = mkFiles(45);
  const r = enforceRetention({ dir, cap: 40 });
  assert.strictEqual(count(dir), 45, 'files were deleted under the default policy');
  assert.deepStrictEqual(r.deleted, []);
  assert.strictEqual(r.refused, true);
  assert.match(r.reason, /not permitted|allowDelete/i, 'a refusal must say why');
  assert.strictEqual(r.over, 5, 'it must still report the pressure it declined to act on');
});

t('it reports pressure rather than hiding it', () => {
  const dir = mkFiles(45);
  const p = planRetention({ dir, cap: 40 });
  assert.strictEqual(p.total, 45);
  assert.strictEqual(p.over, 5);
  assert.strictEqual(p.candidates.length, 5);
  assert.strictEqual(p.candidates[0], '2026-01-01.json', 'oldest first');
  assert.ok(!p.candidates.includes('2026-02-14.json'), 'the newest file is never a candidate');
});

t('under the cap: nothing to do, and it says so without a refusal', () => {
  const dir = mkFiles(19);
  const r = enforceRetention({ dir, cap: 40 });
  assert.strictEqual(r.over, 0);
  assert.strictEqual(r.refused, false, 'no pressure is not a refusal — those are different states');
  assert.deepStrictEqual(r.deleted, []);
});

console.log('\n§3 — deletion requires permission AND a verified copy');

t('allowDelete alone is not enough — there must be somewhere for it to go', () => {
  const dir = mkFiles(45);
  const r = enforceRetention({ dir, cap: 40, allowDelete: true });
  assert.strictEqual(count(dir), 45);
  assert.strictEqual(r.refused, true);
  assert.match(r.reason, /archiveTo|destination/i);
});

t('with a destination: copied, verified byte-identical, THEN deleted', () => {
  const dir = mkFiles(45);
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'retention-dest-'));
  const r = enforceRetention({ dir, cap: 40, allowDelete: true, archiveTo: dest });
  assert.strictEqual(r.refused, false, r.reason);
  assert.strictEqual(r.deleted.length, 5);
  assert.strictEqual(count(dir), 40);
  assert.strictEqual(count(dest), 5, 'the five files must exist at the destination');
  for (const f of r.deleted) {
    assert.ok(fs.existsSync(path.join(dest, f)), `${f} was deleted but is not at the destination`);
  }
});

t('THE CASE THAT MATTERS: a corrupted copy means the original is NOT deleted', () => {
  const dir = mkFiles(45);
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'retention-bad-'));
  /* A destination that silently writes the wrong bytes. This is the difference
     between "we copied it" and "it is there" — the whole reason the check is a
     re-read and a digest comparison rather than the absence of a throw. */
  const r = enforceRetention({
    dir, cap: 40, allowDelete: true, archiveTo: dest,
    _copy: (src, dst) => fs.writeFileSync(dst, 'corrupted'),
  });
  assert.strictEqual(count(dir), 45, 'originals were deleted after a copy that did not verify');
  assert.strictEqual(r.deleted.length, 0);
  assert.ok(r.errors.length >= 5, 'each failed verification must be reported');
  assert.match(r.errors[0].reason, /verif|digest|mismatch/i);
});

t('an unlink failure is reported, never swallowed', () => {
  const dir = mkFiles(45);
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'retention-busy-'));
  const r = enforceRetention({
    dir, cap: 40, allowDelete: true, archiveTo: dest,
    _unlink: () => { throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' }); },
  });
  assert.strictEqual(r.deleted.length, 0);
  assert.ok(r.errors.length >= 1, 'the failure vanished — this is the silent-catch defect');
  assert.match(r.errors[0].reason, /EBUSY/);
});

console.log('\n§4 — the environment flag fails closed');

t('only the exact string "true" permits deletion', () => {
  for (const v of ['1', 'yes', 'on', '', '  ', 'TRUE ', undefined]) {
    const dir = mkFiles(45);
    const r = enforceRetention({ dir, cap: 40, env: { ARCHIVE_ALLOW_DELETE: v }, archiveTo: fs.mkdtempSync(path.join(os.tmpdir(), 'd-')) });
    const permits = String(v ?? '').trim().toLowerCase() === 'true';
    assert.strictEqual(r.refused, !permits,
      `ARCHIVE_ALLOW_DELETE=${JSON.stringify(v)} gave refused=${r.refused}`);
    assert.strictEqual(count(dir), permits ? 40 : 45);
  }
});

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
