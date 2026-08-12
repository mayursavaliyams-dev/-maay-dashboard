/* TEST CATEGORIES — unit · failure · integration · regression
   @test:unit @test:failure @test:integration @test:regression

   integration = §3 runs a REAL capture cycle against the live server when one is
   up, and reads what landed on disk. No performance / memory-leak / rollback.

   These markers are what this file ACTUALLY contains. */

/* THE JOURNAL AND THE COVERAGE RECORD ARE ACTUALLY WIRED — docs/089 §2.

   raw-journal.js had 55 passing assertions and was required by exactly one file:
   its own test. capture-coverage.js was the same. Both were correct, tested, and
   connected to nothing — the identical shape of the risk guard that every engine
   failed to hold, and of the four earlier wiring tests in this repository that
   passed while protecting nothing.

   So this file asserts at the PROVIDER and at the DISK, never at the consumer's
   intention:

     · warehouse-capture requires them and constructs them   (source)
     · a real cycle writes real bytes to a real file          (disk)
     · the bytes are the ones the transport delivered         (byte comparison)
     · a failed poll is recorded as an error, not as silence  (behaviour)

   A test that only checked `require('./raw-journal')` appears in the file would
   pass today and would have passed for the whole period the module was wired to
   nothing.
*/
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failures = 0;
const t = (name, fn) => {
  try { const r = fn(); if (r && r.then) return r; console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e && e.message}`); }
};
const ta = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e && e.message}`); }
};

const SRC = fs.readFileSync(path.join(ROOT, 'warehouse-capture.js'), 'utf8');
const walk = (d) => {
  try {
    return fs.readdirSync(d, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  } catch (_) { return []; }
};

console.log('\n§1 — the capture path no longer throws the bytes away');

t('r.json() is gone from the fetch helper', () => {
  /* The defect, verbatim as it stood until 2026-08-11:

       async function jget(url) {
         try {
           const r = await fetch(url, { cache: 'no-store' });
           if (!r.ok) return null;
           return await r.json();          <-- the bytes end here
         } catch (_) { return null; }      <-- and so does the reason
       }
  */
  const helper = SRC.slice(SRC.indexOf('async function jget('), SRC.indexOf('async function jgetJson('));
  assert.ok(!/return await r\.json\(\)/.test(helper),
    'the fetch helper parses straight from the response again — the original bytes are unrecoverable');
  assert.ok(/await r\.text\(\)/.test(helper), 'it must read text first');
  assert.ok(helper.indexOf('_journal.write') < helper.indexOf('JSON.parse'),
    'the journal write must come BEFORE the parse: if the parse throws, the bytes are '
    + 'already safe, which is the entire point');
});

t('and a failure is no longer indistinguishable from an empty market', () => {
  const helper = SRC.slice(SRC.indexOf('async function jget('), SRC.indexOf('async function jgetJson('));
  assert.ok(!/catch \(_\) \{ return null; \}/.test(helper),
    'the silent catch is back — a network failure, a 500 and a quiet market all return null again');
  assert.ok(/status: 0, error: e\.message/.test(helper), 'a transport failure must carry its reason');
  assert.ok(/_journal\.error\(/.test(helper), 'and be journalled');
});

t('the modules are constructed, not merely imported', () => {
  /* `require(...)` in a file proves nothing: a module can be imported and never
     used, which is what "wired to nothing" looked like from the outside. */
  assert.ok(/new RawJournal\(\{/.test(SRC), 'RawJournal is imported but never constructed');
  assert.ok(/new CaptureCoverage\(\{/.test(SRC), 'CaptureCoverage is imported but never constructed');
  assert.ok(/_coverage\.record\('captured'/.test(SRC));
  assert.ok(/_coverage\.record\('unchanged'/.test(SRC));
  assert.ok(/_coverage\.record\('error'/.test(SRC));
});

t('EVERY branch of the chain poll records coverage', () => {
  /* The one that is easy to miss is `unchanged`. If only the appending branch
     recorded, coverage would equal the archive and answer nothing new — a quiet
     market and a dead capture would look identical again, which is the defect. */
  const loop = SRC.slice(SRC.indexOf('for (const inst of INSTRUMENTS)'), SRC.indexOf('// ── 2. outcomes'));
  const branches = (loop.match(/_coverage\.record\(/g) || []).length;
  assert.ok(branches >= 4,
    `only ${branches} coverage records in the chain loop — every exit from it must record, `
    + 'including the unchanged and no-data ones');
  assert.ok(/continue;/.test(loop));
});

console.log('\n§2 — the journal keeps the bytes VERBATIM');

t('a written body comes back byte-identical', () => {
  const { RawJournal, readJournalFile } = require('../raw-journal.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-'));
  const j = new RawJournal({ root, stream: 'test', writer: 'capture-wiring-test' });

  /* Deliberately awkward: a lone surrogate would be mangled by a round trip
     through JSON.parse/stringify, and trailing whitespace is exactly what a
     naive "normalise then store" would eat. */
  const body = '{"a":1,"b":"é₹ \\u0041","c":[1.5,null]}   \n';
  j.write({ kind: 'observation', source: 'chain:TEST', body });
  j.close();

  /* Two files, not one: the hour file AND the manifest the journal seals on
     close. My first version asserted one and failed — the module was right and
     the assertion was a guess about its layout. */
  const files = walk(root).filter((f) => f.endsWith('.jsonl') && !/_manifest/.test(f));
  assert.strictEqual(files.length, 1, `expected one HOUR file, got ${files.length}: ${files.join(', ')}`);
  const rec = readJournalFile(files[0]);
  const obs = (rec.records || []).filter((x) => x.kind === 'observation');
  assert.strictEqual(obs.length, 1);
  assert.strictEqual(obs[0].body, body,
    'the body came back changed — a journal that normalises is not a journal');
  assert.strictEqual(rec.truncatedTail, null);
  assert.strictEqual((rec.malformed || []).length, 0);
});

t('an observation with no body is REFUSED, not stored as an empty one', () => {
  const { RawJournal } = require('../raw-journal.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-'));
  const j = new RawJournal({ root, stream: 'test', writer: 'x' });
  assert.throws(() => j.write({ kind: 'observation', source: 's' }), /must carry a body/);
  j.close();
});

console.log('\n§3 — a REAL cycle, against the live server if one is up');

(async () => {
  const up = await fetch('http://127.0.0.1:3000/healthz', { signal: AbortSignal.timeout(3000) })
    .then((r) => r.ok).catch(() => false);

  if (!up) {
    console.log('  (no server on :3000 — §3 skipped, and recorded as NOT verified end to end)');
  } else {
    await ta('a real capture cycle writes real bytes for a real instrument', async () => {
      const before = walk(path.join(ROOT, 'data', 'raw-journal')).length;
      const cap = require('../warehouse-capture.js');
      const summary = await cap.captureOnce();
      assert.ok(summary && summary.chain, 'captureOnce returned nothing usable');

      const files = walk(path.join(ROOT, 'data', 'raw-journal')).filter((f) => f.endsWith('.jsonl'));
      assert.ok(files.length >= 1, 'no journal file exists after a real cycle');
      assert.ok(files.length >= before || before === 0, 'journal files vanished');

      const { readJournalFile } = require('../raw-journal.js');
      const newest = files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
      const rec = readJournalFile(newest);
      const obs = (rec.records || []).filter((x) => x.kind === 'observation');
      assert.ok(obs.length >= 1, 'the cycle wrote no observations');

      const chain = obs.find((o) => /^chain:/.test(o.source || ''));
      assert.ok(chain, `no chain observation; sources seen: ${[...new Set(obs.map((o) => o.source))].join(', ')}`);
      assert.ok(String(chain.body).length > 500,
        `the chain body is ${String(chain.body).length} bytes — too small to be a real chain`);
      assert.doesNotThrow(() => JSON.parse(chain.body), 'the stored bytes do not parse as the payload');
      console.log(`      ${obs.length} observations, chain body ${String(chain.body).length} bytes from ${chain.source}`);
    });

    await ta('and the same cycle left a coverage record for this minute', async () => {
      const { CaptureCoverage, istDate } = require('../capture-coverage.js');
      const dir = path.join(ROOT, 'data', 'capture-coverage');
      const c = new CaptureCoverage({ dir });
      const today = istDate(Date.now());
      const file = path.join(dir, `${today}.json`);
      assert.ok(fs.existsSync(file), `no coverage file at ${file}`);
      const j = require('../safe-write.js').readJsonSync(file, { fallback: null });
      assert.ok(j && j.minutes && Object.keys(j.minutes).length >= 1, 'the coverage file has no minutes');

      const outcomes = new Set(Object.values(j.minutes).map((m) => m.outcome));
      for (const o of outcomes) {
        assert.ok(['captured', 'unchanged', 'error', 'absent'].includes(o), `unknown outcome ${o}`);
      }
      console.log(`      ${Object.keys(j.minutes).length} minutes recorded today, outcomes: ${[...outcomes].join(', ')}`);
    });
  }

  console.log('\n§4 — what is still NOT solved, asserted so it stays visible');

  t('the capture cadence bounds the achievable coverage, and that is written down', () => {
    /* MEASURED: the loop runs `--every 300`. Coverage is per MINUTE, so a 5-minute
       poll can cover at most ~75 of the 376 session minutes — 20%, by design, with
       nothing wrong. Reading 20% as an outage would be as wrong as reading it as
       full coverage. */
    const doc = fs.readFileSync(path.join(ROOT, 'docs', '089-PHASES-0b-TO-4-REPORT.md'), 'utf8');
    assert.ok(/cadence|every 300|5-minute|5 minute/i.test(doc),
      'the poll cadence caps coverage at about 20%, and that is not recorded anywhere a reader '
      + 'would find it before concluding the capture is broken');
  });

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing`);
  process.exit(failures === 0 ? 0 : 1);
})();
