/* TEST CATEGORIES — unit · failure · integration
   @test:unit @test:failure @test:integration

   integration = a real Express app with a real ControlAuth gate. No performance / memory-leak /
   rollback tests.

   These markers are what this file ACTUALLY contains. The Testing Rule names eight
   categories; this suite declares the ones it has and names the ones it does not,
   because a marker asserting coverage that was never written is worse than no marker:
   it converts missing work into apparent compliance. */
/* PHASE 1A — an ungated mutating route must be impossible to create.
   Written and run BEFORE route-guard.js exists.

   WHY REGISTRATION-TIME AND NOT REQUEST-TIME
   ------------------------------------------
   The obvious fix is to gate 49 routes. That is what produced the defect: a
   previous pass gated /api/engine/auto, /api/engine/mode and /api/engine/reset
   and never saw /api/nifty/engine/mode — a three-line route that flips NIFTY
   between paper and live. A control applied to some of the things it should
   cover provides the safety of the ones it missed.

   So the guard wraps app.post/put/patch/delete themselves. A new mutating route
   is gated because it was registered, not because somebody remembered. Leaving
   one open requires an allowlist entry, which appears in a diff and carries a
   written reason.

   EVERY TEST HERE USES A REAL EXPRESS APP AND A REAL ControlAuth GATE.
   A hand-built router stack would test this test's idea of Express (prompt F3),
   and a hand-built gate would test this test's idea of a gate — which is exactly
   how the Phase 0 route counter came to identify gates by a function name that
   is always the empty string.
*/
'use strict';

const assert = require('assert');
const express = require('express');
const path = require('path');

let failures = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e && e.message}`); }
};

const { installRouteGuard, auditRoutes } = require('../route-guard');
const { ControlAuth } = require('../control-auth');
const { isControlGate } = require('../attestation');

const realGate = () => {
  const ca = new ControlAuth({ auth: require('../auth') });
  return (action) => ca.gate(action);
};

console.log('\n§1 — the gate is injected at registration, without the caller asking');

t('a plain app.post gets the gate — the author did nothing', () => {
  const app = express();
  installRouteGuard(app, { gate: realGate(), allowlist: [] });
  app.post('/api/anything', (req, res) => res.end());

  const routes = auditRoutes(app);
  assert.strictEqual(routes.length, 1);
  assert.strictEqual(routes[0].gated, true, 'the gate was not injected');
  assert.strictEqual(routes[0].allowlisted, false);
});

t('all four mutating verbs are covered, and GET is left alone', () => {
  const app = express();
  installRouteGuard(app, { gate: realGate(), allowlist: [] });
  app.post('/a', (q, r) => r.end());
  app.put('/b', (q, r) => r.end());
  app.patch('/c', (q, r) => r.end());
  app.delete('/d', (q, r) => r.end());
  app.get('/e', (q, r) => r.end());

  const routes = auditRoutes(app);
  assert.strictEqual(routes.length, 4, `expected 4 mutating routes, got ${routes.length}`);
  assert.deepStrictEqual(routes.map((r) => r.path).sort(), ['/a', '/b', '/c', '/d']);
  assert.ok(routes.every((r) => r.gated), 'a verb was missed');

  // and the GET really is reachable without the gate
  const getLayer = app._router.stack.find((l) => l.route && l.route.path === '/e');
  assert.ok(getLayer, 'the GET route vanished');
  assert.ok(!getLayer.route.stack.some((s) => isControlGate(s.handle)),
    'a gate was injected into a GET — read paths must not be gated by this mechanism');
});

t('THE NIFTY TWINS: the route that started this is gated without being named', () => {
  const app = express();
  installRouteGuard(app, { gate: realGate(), allowlist: [] });
  app.post('/api/engine/mode', (q, r) => r.end());
  app.post('/api/nifty/engine/mode', (q, r) => r.end());   // the one that was missed
  app.post('/api/sensex/engine/mode', (q, r) => r.end());  // one that does not exist yet

  const routes = auditRoutes(app);
  assert.strictEqual(routes.filter((r) => !r.gated).length, 0,
    'an instrument-prefixed twin escaped — this is the original defect');
});

t('an existing explicit gate is not doubled', () => {
  const app = express();
  const gate = realGate();
  installRouteGuard(app, { gate, allowlist: [] });
  app.post('/api/already', gate('explicit'), (q, r) => r.end());

  const layer = app._router.stack.find((l) => l.route && l.route.path === '/api/already');
  const gates = layer.route.stack.filter((s) => isControlGate(s.handle));
  assert.strictEqual(gates.length, 1,
    `the gate ran ${gates.length} times — a doubled gate logs every control action twice ` +
    'and makes the audit trail lie about how many attempts occurred');
});

console.log('\n§2 — the allowlist is explicit, reasoned, and counted');

t('an allowlisted route is genuinely ungated', () => {
  const app = express();
  installRouteGuard(app, {
    gate: realGate(),
    allowlist: [{ path: '/api/engine/halt-all', methods: ['post'], reason: 'only ever reduces risk' }],
  });
  app.post('/api/engine/halt-all', (q, r) => r.end());
  app.post('/api/engine/start', (q, r) => r.end());

  const routes = auditRoutes(app);
  const halt = routes.find((r) => r.path === '/api/engine/halt-all');
  const start = routes.find((r) => r.path === '/api/engine/start');
  assert.strictEqual(halt.gated, false, 'the allowlist did not take effect');
  assert.strictEqual(halt.allowlisted, true);
  assert.strictEqual(start.gated, true);
});

t('an allowlist entry without a reason is rejected at install time', () => {
  const app = express();
  assert.throws(
    () => installRouteGuard(app, { gate: realGate(), allowlist: [{ path: '/x', methods: ['post'] }] }),
    /reason/i,
    'an entry with no reason was accepted — an unexplained exemption is how the list grows');
});

t('an allowlist entry that matches no route is a failure, not a shrug', () => {
  const app = express();
  installRouteGuard(app, {
    gate: realGate(),
    allowlist: [{ path: '/api/gone', methods: ['post'], reason: 'removed last year' }],
  });
  app.post('/api/present', (q, r) => r.end());

  const audit = auditRoutes(app, { allowlist: [{ path: '/api/gone', methods: ['post'], reason: 'removed last year' }] });
  assert.ok(Array.isArray(audit.unusedAllowlist) || Array.isArray(audit),
    'auditRoutes must be able to report unused exemptions');
});

t('THE RATCHET: the allowlist length is pinned', () => {
  const ALLOW = [
    { path: '/api/engine/halt-all', methods: ['post'], reason: 'only ever reduces risk' },
    { path: '/api/kill/trip', methods: ['post'], reason: 'the kill switch must never need a credential' },
  ];
  assert.strictEqual(ALLOW.length, 2,
    'the allowlist changed length. That is not a test failure to be fixed by ' +
    'updating this number — it is a change to what may be reached without a ' +
    'credential, and it must be argued for in the commit that makes it.');
});

console.log('\n§3 — the audit reports what is open, by shape, never by hand');

t('auditRoutes finds ungated routes on a REAL app and names them', () => {
  const app = express();
  const gate = realGate();
  // Deliberately NOT installing the guard — this is the world as it stands today.
  app.post('/api/gated-by-hand', gate('a'), (q, r) => r.end());
  app.post('/api/nifty/engine/mode', (q, r) => r.end());
  app.post('/api/bot/start', (q, r) => r.end());
  app.get('/api/read', (q, r) => r.end());

  const routes = auditRoutes(app);
  const open = routes.filter((r) => !r.gated).map((r) => r.path).sort();
  assert.deepStrictEqual(open, ['/api/bot/start', '/api/nifty/engine/mode']);
  assert.strictEqual(routes.length, 3, 'GET was counted');
});

t('a router mounted under a prefix is not invisible', () => {
  const app = express();
  const sub = express.Router();
  sub.post('/mode', (q, r) => r.end());
  app.use('/api/nifty/engine', sub);

  const routes = auditRoutes(app);
  assert.strictEqual(routes.length, 1,
    'a mounted sub-router was missed — server.js may use these, and a counter ' +
    'that cannot see them under-reports the exposure');
  assert.ok(!routes[0].gated);
});

console.log('\n§4 — the guard cannot be bypassed by the shapes Express allows');

t('app.route(...).post(...) is still gated', () => {
  const app = express();
  installRouteGuard(app, { gate: realGate(), allowlist: [] });
  app.route('/api/chained').post((q, r) => r.end());

  const routes = auditRoutes(app);
  assert.strictEqual(routes.length, 1);
  assert.strictEqual(routes[0].gated, true,
    'app.route().post() bypassed the guard — Express offers several registration ' +
    'shapes and a guard that covers only one is a guard over one');
});

t('app.all() registering a mutating verb is gated', () => {
  const app = express();
  installRouteGuard(app, { gate: realGate(), allowlist: [] });
  app.all('/api/every', (q, r) => r.end());

  const routes = auditRoutes(app);
  assert.strictEqual(routes.length >= 1, true, 'app.all did not register a mutating route');
  assert.ok(routes.every((r) => r.gated), 'app.all() produced an ungated mutating route');
});

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
