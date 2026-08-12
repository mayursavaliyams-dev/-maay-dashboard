/* TEST CATEGORIES — unit · failure · integration
   @test:unit @test:failure @test:integration

   integration = a real spawned Node process (§4). No @test:performance, @test:memory-leak or
   @test:rollback: none was written. Stating that is cheaper than a marker that is not true.

   These markers are what this file ACTUALLY contains. The Testing Rule names eight
   categories; this suite declares the ones it has and names the ones it does not,
   because a marker asserting coverage that was never written is worse than no marker:
   it converts missing work into apparent compliance. */
/* PHASE 0 — attestation acceptance test.
   Written and run BEFORE attestation.js exists, per the implementation prompt.

   WHAT THIS PHASE IS FOR
   ----------------------
   An endpoint returned 404 for a week while the code that serves it sat in the
   working tree. A wiring edit matched nothing and its test passed anyway. Until
   "the running process contains this change" is a checkable fact, every other
   acceptance test in this programme tests the repository's intentions rather
   than the system's behaviour.

   THE TRAP THIS TEST EXISTS TO CATCH  (prompt F4)
   ----------------------------------------------
   The obvious implementation reads the files from disk when asked. That reports
   the NEW hash from a process still running the OLD code — the exact defect the
   feature exists to detect, reimplemented inside the detector. So the version
   must be sealed at load time and never recomputed. §1 asserts that directly:
   it changes a file AFTER sealing and requires the sealed value to be unmoved.

   THE SECOND TRAP  (prompt F2)
   ----------------------------
   "The chokepoint is active" is not "a guarded broker was constructed". The
   defect that made this programme necessary was a risk guard constructed 2,300
   lines AFTER the engines that were meant to receive it — it existed, it was
   correct, and no engine held it. So `active` is derived from what the consumers
   are actually holding, and §3 proves the distinction by building a graph where
   the guard exists and every engine holds the raw connector. A checker that
   reports that as active fails here.
*/
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let failures = 0;
const ok = (name) => console.log(`  ✓ ${name}`);
const bad = (name, e) => { failures++; console.log(`  ✗ ${name}\n      ${e && e.message}`); };
const t = (name, fn) => { try { fn(); ok(name); } catch (e) { bad(name, e); } };

const { computeAttestation, sealCodeVersion } = require('../attestation');

console.log('\n§1 — the code version is sealed at load time, not recomputed on demand');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-'));
const fileA = path.join(tmp, 'a.js');
const fileB = path.join(tmp, 'b.js');
fs.writeFileSync(fileA, 'module.exports = 1;\n');
fs.writeFileSync(fileB, 'module.exports = 2;\n');

t('sealCodeVersion returns a hash and the file list it covers', () => {
  const sealed = sealCodeVersion([fileA, fileB]);
  assert.match(sealed.hash, /^[0-9a-f]{64}$/, 'expected a sha-256 hex digest');
  assert.deepStrictEqual(sealed.files.map((f) => path.basename(f.path)).sort(), ['a.js', 'b.js']);
  assert.strictEqual(sealed.files.length, 2);
});

t('THE TRAP: changing a file after sealing does not move the sealed value', () => {
  const sealed = sealCodeVersion([fileA, fileB]);
  const before = sealed.hash;
  fs.writeFileSync(fileA, 'module.exports = 999; // changed after the seal\n');
  assert.strictEqual(sealed.hash, before,
    'the sealed hash moved when a file changed — this is a process reporting the ' +
    'tree it can see rather than the code it is running, which is the defect ' +
    'attestation exists to detect');
  // and a fresh seal over the same files MUST differ, or the hash is not of content
  const reSealed = sealCodeVersion([fileA, fileB]);
  assert.notStrictEqual(reSealed.hash, before,
    'a fresh seal over changed content produced the same hash — the hash is not ' +
    'derived from file content');
});

t('the version is not a constant: different content gives a different hash', () => {
  const one = sealCodeVersion([fileB]).hash;
  fs.writeFileSync(fileB, 'module.exports = 3;\n');
  const two = sealCodeVersion([fileB]).hash;
  assert.notStrictEqual(one, two);
});

console.log('\n§2 — configured and active are separate facts, never merged');

t('every control reports configured and active as distinct booleans', () => {
  const a = computeAttestation({ graph: {}, sealed: sealCodeVersion([fileA]) });
  const names = Object.keys(a.controls);
  assert.ok(names.length >= 4, `expected at least 4 controls, got ${names.length}: ${names}`);
  for (const n of names) {
    const c = a.controls[n];
    assert.ok('configured' in c, `${n} has no 'configured'`);
    assert.ok('active' in c, `${n} has no 'active'`);
    assert.ok(!('enabled' in c), `${n} exposes a merged 'enabled' — configured and active must not be merged`);
  }
});

t('an absent control is UNEVALUABLE, never false', () => {
  const a = computeAttestation({ graph: {}, sealed: sealCodeVersion([fileA]) });
  const c = a.controls.orderChokepoint;
  assert.strictEqual(c.active, null,
    'with nothing supplied, active must be null (unevaluable) — false would assert ' +
    'a fact about a graph that was never inspected');
  assert.match(String(c.note || ''), /unevaluable|not supplied|no consumers/i);
});

console.log('\n§3 — THE REAL QUESTION: active is what the consumers hold');

/* A guard that exists and is held by nobody is the defect this programme was
   created to fix. These two graphs differ ONLY in what the engines hold. */
const rawConnector = { name: 'upstox', placeOrder() {}, getPositions() { return []; } };
const guardedBroker = {
  name: 'upstox',
  requestApproval() { return { approval: 'x' }; },
  placeOrder() {},
  __guards: rawConnector,
};

t('guard constructed but NO engine holds it → active false, and it says why', () => {
  const a = computeAttestation({
    sealed: sealCodeVersion([fileA]),
    graph: {
      guardedBroker,
      consumers: { niftyEngine: rawConnector, sensexEngine: rawConnector },
    },
  });
  const c = a.controls.orderChokepoint;
  assert.strictEqual(c.configured, true, 'the guard was constructed — configured is true');
  assert.strictEqual(c.active, false,
    'reported active while every consumer holds the raw connector — this is the ' +
    'exact defect (guard built 2,300 lines after the engines that needed it)');
  assert.deepStrictEqual((c.bypassing || []).sort(), ['niftyEngine', 'sensexEngine']);
});

t('every engine holds the guard → active true', () => {
  const a = computeAttestation({
    sealed: sealCodeVersion([fileA]),
    graph: {
      guardedBroker,
      consumers: { niftyEngine: guardedBroker, sensexEngine: guardedBroker },
    },
  });
  const c = a.controls.orderChokepoint;
  assert.strictEqual(c.configured, true);
  assert.strictEqual(c.active, true);
  assert.deepStrictEqual(c.bypassing || [], []);
});

t('ONE engine bypassing is enough to make it not active', () => {
  const a = computeAttestation({
    sealed: sealCodeVersion([fileA]),
    graph: {
      guardedBroker,
      consumers: { niftyEngine: guardedBroker, sensexEngine: rawConnector },
    },
  });
  assert.strictEqual(a.controls.orderChokepoint.active, false);
  assert.deepStrictEqual(a.controls.orderChokepoint.bypassing, ['sensexEngine']);
});

console.log('\n§4 — the verify script exits non-zero against a genuinely stale process');

/* Per prompt F3: a real process, launched for real, serving the real module —
   not a stubbed report object this test authored and handed to itself. */
t('a REAL spawned process is verified green, then goes red when the tree moves', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'attest-proc-'));
  const target = path.join(work, 'watched.js');
  fs.writeFileSync(target, 'module.exports = { v: 1 };\n');

  // A real Node process that seals at startup and serves the attestation.
  const portFile = path.join(work, 'port');
  const serverSrc = `
    const http = require('http');
    const fs = require('fs');
    const { computeAttestation, sealCodeVersion } = require(${JSON.stringify(path.join(ROOT, 'attestation.js'))});
    const sealed = sealCodeVersion([${JSON.stringify(target)}]);   // sealed ONCE, at startup
    http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(computeAttestation({ sealed, graph: {} })));
    }).listen(0, '127.0.0.1', function () {
      fs.writeFileSync(${JSON.stringify(portFile)}, String(this.address().port));
    });
  `;
  const serverFile = path.join(work, 'proc.js');
  fs.writeFileSync(serverFile, serverSrc);

  const { spawn } = require('child_process');
  const proc = spawn(process.execPath, [serverFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d; });
  try {
    /* Block until the child publishes its port. A real sleep, not a spin:
       Atomics.wait on a SharedArrayBuffer is the only synchronous sleep Node
       offers, and this test is synchronous because the rest of the file is. */
    const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    const started = Date.now();
    let port = null;
    while (!port && Date.now() - started < 15000) {
      if (proc.exitCode !== null) break;
      try { port = fs.readFileSync(portFile, 'utf8').trim() || null; } catch (_) { /* not listening yet */ }
      if (!port) sleep(50);
    }
    assert.ok(port, `the spawned process never reported a port (exit=${proc.exitCode})\n${stderr}`);

    const verify = path.join(ROOT, 'scripts', 'attest-verify.js');

    const green = spawnSync(process.execPath, [verify, '--url', `http://127.0.0.1:${port}`],
      { encoding: 'utf8' });
    assert.strictEqual(green.status, 0,
      `verify should pass against a fresh process, got ${green.status}\n${green.stdout}${green.stderr}`);

    // Now make the process genuinely stale: the tree moves, the process does not.
    fs.writeFileSync(target, 'module.exports = { v: 2 }; // the tree moved\n');

    const red = spawnSync(process.execPath, [verify, '--url', `http://127.0.0.1:${port}`],
      { encoding: 'utf8' });
    assert.notStrictEqual(red.status, 0,
      'verify passed against a process whose code no longer matches the tree');
    assert.match(red.stdout + red.stderr, /stale|mismatch|differs/i,
      'a non-zero exit that does not say what is wrong is not a diagnosis');
  } finally {
    proc.kill();
  }
});

console.log('\n§5 — the gate predicate, proven against a REAL gate before its counts are trusted');

/* MEASURED 2026-08-08. The first version of walkMutatingRoutes identified the
   gate BY FUNCTION NAME. ControlAuth.gate() returns an arrow function directly,
   whose .name is "". Every gated route would have been counted as ungated, and
   Phase 1A — which gates everything and asserts the ungated count reaches zero —
   could never have gone green no matter what was fixed.

   So the predicate is checked against a gate this test did not construct the
   shape of: it comes from the real ControlAuth. */
const { isControlGate, walkMutatingRoutes } = require('../attestation');
const { ControlAuth } = require('../control-auth');

t('a real ControlAuth gate is recognised (and its .name is empty, proving why)', () => {
  const realGate = new ControlAuth({ auth: require('../auth') }).gate('engine-TRADE-MODE');
  assert.strictEqual(realGate.name, '',
    'the gate now has a name — if control-auth changed, re-derive the predicate ' +
    'rather than assuming the old reasoning still holds');
  assert.strictEqual(isControlGate(realGate), true, 'the real gate was not recognised');
});

t('an ordinary handler is not mistaken for a gate', () => {
  assert.strictEqual(isControlGate((req, res) => res.json({ ok: true })), false);
  assert.strictEqual(isControlGate(function control(req, res, next) { next(); }), false,
    'a handler merely NAMED control must not count — naming is what this replaced');
  assert.strictEqual(isControlGate(null), false);
  assert.strictEqual(isControlGate(undefined), false);
});

t('walkMutatingRoutes counts gated vs ungated on a REAL express app', () => {
  const express = require('express');
  const app = express();
  const ca = new ControlAuth({ auth: require('../auth') });
  app.post('/api/gated', ca.gate('a'), (req, res) => res.end());
  app.post('/api/open', (req, res) => res.end());
  app.put('/api/open2', (req, res) => res.end());
  app.get('/api/read', (req, res) => res.end());          // GET must be excluded

  const routes = walkMutatingRoutes(app);
  assert.ok(Array.isArray(routes), 'walkMutatingRoutes returned null on a real app');
  assert.strictEqual(routes.length, 3, `expected 3 mutating routes, got ${routes.length}`);
  assert.deepStrictEqual(routes.filter((r) => r.gated).map((r) => r.path), ['/api/gated']);
  assert.deepStrictEqual(routes.filter((r) => !r.gated).map((r) => r.path).sort(),
    ['/api/open', '/api/open2']);
});

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
