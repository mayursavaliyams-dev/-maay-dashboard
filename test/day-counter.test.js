/* TEST CATEGORIES — unit · failure · integration · regression
   @test:unit @test:failure @test:integration @test:regression

   integration = genuinely separate Node processes, not two objects in one. No performance /
   memory-leak / rollback tests.

   These markers are what this file ACTUALLY contains. The Testing Rule names eight
   categories; this suite declares the ones it has and names the ones it does not,
   because a marker asserting coverage that was never written is worse than no marker:
   it converts missing work into apparent compliance. */
/* PHASE 1C — a restart is not a new trading day.

   §1 restarts for real: a separate Node process writes, exits, and another
   process reads. Constructing two DayCounter objects in one process would share
   a module cache and a filesystem cache and would test this test's idea of a
   restart (prompt F3). The interesting failure — state that lives in memory and
   never reaches disk — is invisible unless the process actually ends.
*/
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let failures = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e && e.message}`); }
};

const { DayCounter, istDateStr } = require('../day-counter');
const tmpFile = (n) => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'daycount-')), n || 'state.json');

/** Run a snippet in a genuinely separate Node process. */
const inFreshProcess = (body) => execFileSync(process.execPath, ['-e', `
  const { DayCounter } = require(${JSON.stringify(path.join(ROOT, 'day-counter.js'))});
  ${body}
`], { encoding: 'utf8' }).trim();

console.log('\n§1 — THE ACCEPTANCE TEST: the count survives a real process restart');

t('3 trades recorded in one process are visible to the next', () => {
  const file = tmpFile();
  const wrote = inFreshProcess(`
    const c = new DayCounter({ file: ${JSON.stringify(file)} });
    c.increment('NIFTY'); c.increment('NIFTY'); c.increment('NIFTY');
    process.stdout.write(String(c.count('NIFTY')));
  `);
  assert.strictEqual(wrote, '3', 'the writing process did not count correctly');

  const read = inFreshProcess(`
    const c = new DayCounter({ file: ${JSON.stringify(file)} });
    process.stdout.write(String(c.count('NIFTY')));
  `);
  assert.strictEqual(read, '3',
    `a fresh process saw ${read} trades instead of 3 — ten pm2 restarts would be ten fresh budgets`);
});

t('ten restarts do not produce ten budgets', () => {
  const file = tmpFile();
  for (let i = 0; i < 10; i++) {
    inFreshProcess(`new DayCounter({ file: ${JSON.stringify(file)} }).increment('NIFTY');`);
  }
  const final = inFreshProcess(`
    process.stdout.write(String(new DayCounter({ file: ${JSON.stringify(file)} }).count('NIFTY')));
  `);
  assert.strictEqual(final, '10', `expected 10 accumulated, got ${final}`);
});

t('the write happens at increment, not at shutdown', () => {
  /* A counter flushed on exit is correct except when it matters — the crash and
     the SIGKILL are exactly the cases it must survive. This process is killed
     with process.exit(0) immediately after incrementing, running no exit hooks
     beyond what already happened synchronously. */
  const file = tmpFile();
  inFreshProcess(`
    const c = new DayCounter({ file: ${JSON.stringify(file)} });
    c.increment('SENSEX');
    process.exit(0);
  `);
  const after = inFreshProcess(`
    process.stdout.write(String(new DayCounter({ file: ${JSON.stringify(file)} }).count('SENSEX')));
  `);
  assert.strictEqual(after, '1', 'the increment never reached disk');
});

console.log('\n§2 — only the day resets it');

t('a restart across the 09:15 open does NOT reset', () => {
  const file = tmpFile();
  const at = (h, m) => Date.parse(`2026-08-10T${String(h - 5).padStart(2, '0')}:${String(m - 30 < 0 ? m + 30 : m - 30).padStart(2, '0')}:00Z`);
  // 09:00 IST → 03:30 UTC
  const pre = new DayCounter({ file, now: () => Date.parse('2026-08-10T03:30:00Z') });
  pre.increment('NIFTY');
  pre.increment('NIFTY');

  // 09:20 IST → 03:50 UTC, brand new object reading from disk
  const post = new DayCounter({ file, now: () => Date.parse('2026-08-10T03:50:00Z') });
  assert.strictEqual(post.count('NIFTY'), 2,
    'the count reset across the market open — anything keyed to the session hands ' +
    'back a fresh budget on every morning restart');
});

t('a genuine new IST day DOES reset', () => {
  const file = tmpFile();
  const mon = new DayCounter({ file, now: () => Date.parse('2026-08-10T06:00:00Z') });  // 11:30 IST Mon
  mon.increment('NIFTY', 5);
  assert.strictEqual(mon.count('NIFTY'), 5);

  const tue = new DayCounter({ file, now: () => Date.parse('2026-08-11T06:00:00Z') });  // 11:30 IST Tue
  assert.strictEqual(tue.count('NIFTY'), 0, 'the new day did not reset');
});

t('the IST boundary is 00:00 IST, not 00:00 UTC', () => {
  // 2026-08-10 19:00 UTC is 2026-08-11 00:30 IST — a new trading date already.
  assert.strictEqual(istDateStr(Date.parse('2026-08-10T19:00:00Z')), '2026-08-11');
  // 2026-08-10 18:00 UTC is 2026-08-10 23:30 IST — still the same date.
  assert.strictEqual(istDateStr(Date.parse('2026-08-10T18:00:00Z')), '2026-08-10');
});

t('the reset persists, so the next process does not see yesterday', () => {
  const file = tmpFile();
  new DayCounter({ file, now: () => Date.parse('2026-08-10T06:00:00Z') }).increment('X', 4);
  new DayCounter({ file, now: () => Date.parse('2026-08-11T06:00:00Z') }).count('X');   // rolls
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(raw.date, '2026-08-11', 'the roll was not written');
  assert.deepStrictEqual(raw.counts, {});
});

console.log('\n§3 — unreadable is not zero');

t('a corrupt file yields null, never 0', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{"date":"2026-08-10","cou');     // torn write
  const c = new DayCounter({ file });
  assert.strictEqual(c.loaded, false);
  assert.strictEqual(c.count('NIFTY'), null,
    'a corrupt state file reported 0 trades — that is a claim that none happened');
  assert.match(c.loadError, /unparseable/);
});

t('a wrong-shaped file yields null too', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{"trades": 5}');
  const c = new DayCounter({ file });
  assert.strictEqual(c.count('NIFTY'), null);
  assert.match(c.loadError, /shape/);
});

t('recording against unreadable state throws rather than starting a new count', () => {
  const file = tmpFile();
  fs.writeFileSync(file, 'not json at all');
  const c = new DayCounter({ file });
  assert.throws(() => c.increment('NIFTY'), /unreadable/);
});

t('a file that has NEVER existed is a real empty day, not an error', () => {
  const file = tmpFile('never-written.json');
  const c = new DayCounter({ file });
  assert.strictEqual(c.loaded, true, 'absent must differ from unreadable');
  assert.strictEqual(c.count('NIFTY'), 0);
});

t('status reports its own health instead of an empty happy day', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '}{');
  const s = new DayCounter({ file }).status();
  assert.strictEqual(s.ok, false);
  assert.strictEqual(s.counts, null, 'an empty counts object would read as a clean day');
  assert.ok(s.error);
});

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
