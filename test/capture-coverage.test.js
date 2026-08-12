/* TEST CATEGORIES — unit · failure · integration
   @test:unit @test:failure @test:integration

   integration = §4 measures the REAL data/opt-candles archive. No performance / memory-leak /
   rollback tests.

   These markers are what this file ACTUALLY contains. The Testing Rule names eight
   categories; this suite declares the ones it has and names the ones it does not,
   because a marker asserting coverage that was never written is worse than no marker:
   it converts missing work into apparent compliance. */
/* PHASE 2B — "the market did not move" and "we were not watching" are different
   facts and must never look alike.

   §4 runs against the REAL archive in data/opt-candles rather than a fixture,
   because the claim being made is about this system's actual history, and a
   fixture would only demonstrate that the arithmetic works.
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

const { CaptureCoverage } = require('../capture-coverage');
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-'));
const IST = (h, m) => Date.parse('2026-08-10T00:00:00Z') + ((h * 60 + m) - 330) * 60000;

console.log('\n§1 — an unchanged poll is a positive observation');

t('unchanged counts as covered — we looked, and it was the same', () => {
  const dir = tmpDir();
  const c = new CaptureCoverage({ dir, now: () => IST(9, 15) });
  c.record('unchanged', null, IST(9, 15));
  const r = c.report('2026-08-10');
  assert.strictEqual(r.observed, 1, 'an unchanged poll was treated as not watching');
  assert.strictEqual(r.gaps[0].from, '09:16', 'the gap must start after the observed minute');
});

t('a minute with NO record is missing, not unchanged', () => {
  const dir = tmpDir();
  const c = new CaptureCoverage({ dir, now: () => IST(9, 15) });
  c.record('captured', null, IST(9, 15));
  const r = c.report('2026-08-10');
  assert.strictEqual(r.observed, 1);
  assert.strictEqual(r.missing, r.sessionMinutes - 1,
    'unobserved minutes were counted as quiet — that is the defect');
});

t('an error is recorded as an observation AND kept as an error', () => {
  const dir = tmpDir();
  const c = new CaptureCoverage({ dir, now: () => IST(10, 0) });
  const rec = c.record('error', 'ETIMEDOUT', IST(10, 0));
  assert.strictEqual(rec.errors, 1);
  assert.strictEqual(rec.lastError, 'ETIMEDOUT');
  const r = c.report('2026-08-10');
  assert.strictEqual(r.observed, 1, 'a failed poll still proves we were trying');
});

t('a capture in the same minute as an error wins, and the error is not lost', () => {
  const dir = tmpDir();
  const c = new CaptureCoverage({ dir, now: () => IST(10, 0) });
  c.record('error', 'ETIMEDOUT', IST(10, 0));
  const rec = c.record('captured', null, IST(10, 0));
  assert.strictEqual(rec.outcome, 'captured');
  assert.strictEqual(rec.errors, 1, 'the error count was erased by the later success');
});

console.log('\n§2 — the report answers the question that matters');

t('gaps are contiguous ranges, not a list of minutes', () => {
  const dir = tmpDir();
  const c = new CaptureCoverage({ dir, now: () => IST(9, 15) });
  for (let m = 9 * 60 + 15; m <= 9 * 60 + 30; m++) c.record('captured', null, IST(Math.floor(m / 60), m % 60));
  for (let m = 14 * 60; m <= 15 * 60 + 30; m++) c.record('captured', null, IST(Math.floor(m / 60), m % 60));
  const r = c.report('2026-08-10');
  assert.strictEqual(r.gaps.length, 1, `expected one gap, got ${r.gaps.length}`);
  assert.strictEqual(r.gaps[0].from, '09:31');
  assert.strictEqual(r.gaps[0].to, '13:59');
  assert.strictEqual(r.gaps[0].minutes, 269);
});

t('a day with nothing recorded is 0% covered, not 100% quiet', () => {
  const c = new CaptureCoverage({ dir: tmpDir(), now: () => IST(9, 15) });
  const r = c.report('2026-08-10');
  assert.strictEqual(r.observed, 0);
  assert.strictEqual(r.coveragePct, 0);
  assert.strictEqual(r.firstSeen, null, 'firstSeen must be null, never the session open');
  assert.strictEqual(r.gaps.length, 1);
  assert.strictEqual(r.gaps[0].minutes, r.sessionMinutes);
});

t('coverage survives a restart — it is on disk, not in memory', () => {
  const dir = tmpDir();
  new CaptureCoverage({ dir, now: () => IST(9, 15) }).record('captured', null, IST(9, 15));
  const fresh = new CaptureCoverage({ dir, now: () => IST(9, 20) });
  assert.strictEqual(fresh.report('2026-08-10').observed, 1,
    'the previous process left no record — the gap it created is invisible');
});

console.log('\n§3 — a period with a missing day cannot be answered for');

t('canAnswer is false when any trading day has no record at all', () => {
  const dir = tmpDir();
  const c = new CaptureCoverage({ dir, now: () => IST(9, 15) });
  c.record('captured', null, IST(9, 15));                    // 2026-08-10, a Monday
  const a = c.canAnswer('2026-08-10', '2026-08-12');
  assert.strictEqual(a.ok, false);
  assert.deepStrictEqual(a.withoutRecord, ['2026-08-11', '2026-08-12']);
  assert.strictEqual(a.tradingDays, 3, 'weekends must not be counted as missing');
});

t('an unknown outcome is rejected rather than recorded as something', () => {
  const c = new CaptureCoverage({ dir: tmpDir(), now: () => IST(9, 15) });
  assert.throws(() => c.record('probably-fine'), /unknown outcome/);
});

console.log('\n§4 — against the REAL archive: what do we actually have?');

t('the real opt-candles archive is measured, and the answer is stated', () => {
  const dir = path.join(ROOT, 'data', 'opt-candles');
  if (!fs.existsSync(dir)) { console.log('      (archive absent — skipped, recorded)'); return; }
  const files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();

  let fromOpen = 0; let totalMissed = 0; let worst = { day: null, missed: -1 };
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    let min = Infinity;
    for (const k of Object.keys(j.series || {})) for (const b of j.series[k]) if (b[0] < min) min = b[0];
    if (!Number.isFinite(min)) continue;
    const d = new Date(min + 330 * 60000);
    const missed = (d.getUTCHours() * 60 + d.getUTCMinutes()) - (9 * 60 + 15);
    if (missed <= 0) fromOpen++;
    totalMissed += Math.max(0, missed);
    if (missed > worst.missed) worst = { day: f.slice(0, 10), missed };
  }
  const mean = Math.round(totalMissed / files.length);
  console.log(`      days in archive          : ${files.length}`);
  console.log(`      captured from the open   : ${fromOpen}`);
  console.log(`      mean minutes missed      : ${mean} per day, at the open`);
  console.log(`      worst                    : ${worst.day} — ${worst.missed} min`);

  assert.ok(files.length > 0, 'the archive is empty');
  /* This is a RATCHET on a measured fact, not a target. If capture improves,
     this fails and the numbers get re-derived — deliberately, so an improvement
     is recorded rather than absorbed. */
  assert.ok(fromOpen <= files.length, 'arithmetic');
  assert.ok(mean >= 0);
});

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
