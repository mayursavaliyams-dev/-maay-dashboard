/* TEST CATEGORIES — unit · failure · integration
   @test:unit @test:failure @test:integration

   integration = §4 beats from genuinely separate Node processes.
   No performance / memory-leak / rollback tests.
   These markers are what this file ACTUALLY contains. */

/* HEARTBEATS — docs/093 §1.

   The assertions that matter are the ones about what CANNOT be told apart if the
   module is written carelessly:

     NEVER vs STALE      — a component that was never started, versus one that
                           stopped. Different incidents, different actions.
     UNKNOWN vs DEAD     — an unreadable store, versus everything being down.
     ALIVE per component — a 300s loop and a 15s server are both healthy.

   Every one of those is a merge that a single boolean would perform silently.
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

const { Heartbeat, GRACE } = require('../heartbeat');
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hb-')), 'heartbeats.json');

console.log('\n§1 — NEVER and STALE are different facts');

t('a component that never beat is NEVER, not STALE', () => {
  const hb = new Heartbeat({ file: tmp(), now: () => 1000 });
  const s = hb.status(['capture', 'server']);
  assert.strictEqual(s.components.length, 2);
  for (const c of s.components) {
    assert.strictEqual(c.state, 'NEVER');
    assert.strictEqual(c.ageMs, null, 'an age would imply it was once seen');
    assert.match(c.reason, /has not run|different name/);
  }
  assert.strictEqual(s.summary.never, 2);
  assert.strictEqual(s.summary.stale, 0);
});

t('a component that beat and went quiet is STALE, with its age and its promise', () => {
  const file = tmp();
  let t0 = 1_000_000;
  const hb = new Heartbeat({ file, now: () => t0 });
  hb.beat('capture', { intervalMs: 300_000 });

  t0 += 300_000 * GRACE + 1;
  const c = hb.status().components[0];
  assert.strictEqual(c.state, 'STALE');
  assert.ok(c.ageSec > 700, `age ${c.ageSec}s`);
  assert.strictEqual(c.intervalMs, 300_000);
  assert.match(c.reason, /promised every 300s/,
    'the reason must state what the component promised — "stale" alone is not actionable');
});

t('THE MERGE THIS PREVENTS: never and stale are counted separately', () => {
  const file = tmp();
  let t0 = 1_000_000;
  const hb = new Heartbeat({ file, now: () => t0 });
  hb.beat('capture', { intervalMs: 60_000 });
  t0 += 60_000 * GRACE + 1;

  const s = hb.status(['capture', 'never-started']);
  assert.strictEqual(s.summary.stale, 1);
  assert.strictEqual(s.summary.never, 1);
  assert.strictEqual(s.summary.alive, 0);
  /* Both are "not alive". Reporting them as one number sends the operator
     hunting for a crashed process when the real problem is a process that was
     never started, or the reverse. */
  assert.notStrictEqual(
    s.components.find((c) => c.name === 'capture').state,
    s.components.find((c) => c.name === 'never-started').state);
});

console.log('\n§2 — staleness is judged against what each component promised');

t('a 300s loop and a 15s server are both ALIVE at the same moment', () => {
  const file = tmp();
  let t0 = 1_000_000;
  const hb = new Heartbeat({ file, now: () => t0 });
  hb.beat('capture', { intervalMs: 300_000 });
  hb.beat('server', { intervalMs: 15_000 });

  /* 60s: past the server's grace (15s x 2.5 = 37.5s) and far inside the
     capture's (300s x 2.5 = 750s).

     My first version used 20s and asserted the server was already STALE, which
     was wrong — 20s is inside 37.5s. The module was right and the assertion was
     an arithmetic guess. Worth leaving the reasoning here: a test that picks its
     boundary by eye tests the author's arithmetic, not the code. */
  t0 += 60_000;
  const s = hb.status();
  const byName = Object.fromEntries(s.components.map((c) => [c.name, c]));
  assert.strictEqual(byName.capture.state, 'ALIVE', 'a 300s loop 60s after its beat is fine');
  assert.strictEqual(byName.server.state, 'STALE', 'a 15s server 60s after its beat is not');
  /* A single global threshold would have to call one of these wrong. */
});

t('a beat with no declared interval is refused', () => {
  const hb = new Heartbeat({ file: tmp() });
  assert.throws(() => hb.beat('x', {}), /positive intervalMs/);
  assert.throws(() => hb.beat('x', { intervalMs: 0 }), /positive intervalMs/);
  assert.throws(() => hb.beat('', { intervalMs: 1000 }), /name is required/);
});

console.log('\n§3 — an unreadable store is UNKNOWN, not "everything is dead"');

t('a corrupt store reports ok:false and components null', () => {
  const file = tmp();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"beats": {"a": ');          // torn write
  const s = new Heartbeat({ file }).status(['a', 'b']);
  assert.strictEqual(s.ok, false);
  assert.strictEqual(s.components, null,
    'a list of components would be a claim about processes we could not look up');
  assert.strictEqual(s.summary, null);
  assert.ok(s.error);
  assert.match(s.operatorAction, /check the processes directly/i);
});

t('and a beat REFUSES to overwrite a store it could not read', () => {
  /* Overwriting would discard every other component's record on the strength of
     one bad read — a single corrupt byte would erase the whole fleet's history. */
  const file = tmp();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'not json');
  const r = new Heartbeat({ file }).beat('a', { intervalMs: 1000 });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /refusing to write over an unreadable store/);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), 'not json', 'the store was overwritten anyway');
});

t('a store that has NEVER been written is a clean empty state, not an error', () => {
  const s = new Heartbeat({ file: tmp() }).status([]);
  assert.strictEqual(s.ok, true, 'absent must differ from unreadable');
  assert.deepStrictEqual(s.components, []);
});

console.log('\n§4 — across real processes');

t('a beat written by one process is read by another', () => {
  const file = tmp();
  const run = (body) => execFileSync(process.execPath, ['-e', `
    const { Heartbeat } = require(${JSON.stringify(path.join(ROOT, 'heartbeat.js'))});
    const hb = new Heartbeat({ file: ${JSON.stringify(file)} });
    ${body}
  `], { encoding: 'utf8' }).trim();

  run("hb.beat('capture', { intervalMs: 300000, meta: { instruments: 3 } });");
  const out = run("const s = hb.status(); process.stdout.write(JSON.stringify(s.components[0]));");
  const c = JSON.parse(out);
  assert.strictEqual(c.name, 'capture');
  assert.strictEqual(c.state, 'ALIVE');
  assert.deepStrictEqual(c.meta, { instruments: 3 });
});

t('a restart is visible: the pid changes and seq continues', () => {
  const file = tmp();
  const run = () => execFileSync(process.execPath, ['-e', `
    const { Heartbeat } = require(${JSON.stringify(path.join(ROOT, 'heartbeat.js'))});
    const hb = new Heartbeat({ file: ${JSON.stringify(file)} });
    hb.beat('server', { intervalMs: 15000 });
    process.stdout.write(JSON.stringify(hb.status().components[0]));
  `], { encoding: 'utf8' }).trim();

  const a = JSON.parse(run());
  const b = JSON.parse(run());
  assert.strictEqual(b.seq, a.seq + 1, 'seq must continue across processes, not reset');
  assert.notStrictEqual(b.pid, a.pid, 'a different process must be visible as one');
  assert.strictEqual(b.upSinceISO, a.upSinceISO,
    'firstSeen must survive the restart — otherwise "up for 3 days" and "restarted just now" look identical');
});

console.log('\n§5 — the timer beats immediately, not after one interval');

t('start() beats at once', () => {
  const file = tmp();
  const hb = new Heartbeat({ file });
  const stop = hb.start('x', { intervalMs: 60_000 });
  try {
    const s = hb.status();
    assert.strictEqual(s.components.length, 1);
    assert.strictEqual(s.components[0].state, 'ALIVE',
      'a component that beats only after its first interval is indistinguishable from a dead '
      + 'one for that whole period — five minutes, for the capture loop');
  } finally { stop(); }
});

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
