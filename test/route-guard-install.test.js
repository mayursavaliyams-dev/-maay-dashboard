/* TEST CATEGORIES — unit · regression · failure
   @test:unit @test:regression @test:failure

   No integration / performance / memory-leak / rollback tests. The in-process
   check is §3, and it runs against the LIVE server when one is up.

   These markers are what this file ACTUALLY contains. */

/* ROUTE GUARD, AS INSTALLED — docs/089 §1A.

   test/route-guard.test.js proves the MECHANISM against small Express apps.
   This file is about the INSTALLATION in server.js: that it is above the routes,
   that the allowlist is the measured one, and that neither the exemption list
   nor the set of routes registered above the guard can grow quietly.

   The distinction matters. A guard that works and is installed too late is a
   guard over nothing, and the mechanism test cannot see that.
*/
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failures = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e && e.message}`); }
};

const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const lineOf = (needle) => SRC.slice(0, SRC.indexOf(needle)).split('\n').length;

console.log('\n§1 — the guard is installed, and installed EARLY');

t('server.js installs the route guard', () => {
  assert.ok(/installRouteGuard\(app,\s*\{/.test(SRC), 'the guard is not installed at all');
  assert.ok(/require\('\.\/route-guard'\)/.test(SRC));
});

t('it is installed before the bulk of the routes', () => {
  const guardLine = lineOf('installRouteGuard(app, {');
  const mutating = SRC.split('\n')
    .map((l, i) => ({ l: l.trim(), n: i + 1 }))
    .filter((x) => /^app\.(post|put|patch|delete)\(['"]/.test(x.l));
  const above = mutating.filter((x) => x.n < guardLine);
  const below = mutating.filter((x) => x.n > guardLine);

  console.log(`      guard at line ${guardLine}: ${above.length} mutating routes above it, ${below.length} below`);
  assert.ok(below.length > 40, `only ${below.length} routes are covered by registration order`);
  assert.ok(above.length <= 2,
    `${above.length} mutating routes are registered above the guard and are therefore NOT wrapped: `
    + above.map((x) => `${x.n}:${x.l.slice(0, 40)}`).join(', '));
});

t('THE RATCHET: exactly two routes sit above the guard, and they are named', () => {
  /* Both are auth routes and both must be open on their merits — requiring a
     credential to obtain one is a locked door with the key inside. They are
     ALSO on the allowlist, so their openness is a decision rather than an
     accident of line order.

     This number may only go DOWN. A third route appearing above the guard is an
     unwrapped mutating route, which is the defect the guard exists to make
     impossible — and it would be invisible without this assertion. */
  const guardLine = lineOf('installRouteGuard(app, {');
  const above = SRC.split('\n')
    .map((l, i) => ({ l: l.trim(), n: i + 1 }))
    .filter((x) => x.n < guardLine && /^app\.(post|put|patch|delete)\(['"]/.test(x.l))
    .map((x) => (x.l.match(/^app\.\w+\(['"]([^'"]+)/) || [])[1]);

  assert.deepStrictEqual(above.sort(), ['/api/auth/login', '/api/auth/logout'],
    'the set of routes registered above the guard changed. If one was moved below, '
    + 'shorten this list in the same commit. If a NEW one appeared, it is unwrapped '
    + 'and the commit that added it is the finding.');
});

console.log('\n§2 — the allowlist is the MEASURED one, and every entry is argued');

/* The measurement: every page loaded in a real browser with request logging,
   plus a scan of every page and shared script for fetch(..., method:'POST').
   Both, because the browser misses click-only calls and the scan misses computed
   URLs. Result on 2026-08-10: the whole UI calls seven mutating routes. */
const EXPECTED_ALLOWLIST = [
  '/api/amibroker/order',
  '/api/amibroker/signal',
  '/api/amibroker/webhook',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/engine/halt-all',
  '/api/pop/close',
  '/api/pop/payoff',
  '/api/screener/backtest',
  '/api/screener/run',
  '/api/strategy/payoff',
  '/api/webhook/tradingview',
];

function parseAllowlist() {
  const start = SRC.indexOf('installRouteGuard(app, {');
  const end = SRC.indexOf('\n});', start);
  const block = SRC.slice(start, end);
  const out = [];
  const re = /\{\s*path:\s*'([^']+)',\s*methods:\s*\[([^\]]*)\],\s*\n?\s*reason:\s*'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = re.exec(block))) out.push({ path: m[1], reason: m[3] });
  return out;
}

t('the allowlist matches the measurement exactly', () => {
  const got = parseAllowlist().map((e) => e.path).sort();
  assert.deepStrictEqual(got, EXPECTED_ALLOWLIST.sort(),
    'the allowlist changed. That is a change to what may be reached WITHOUT A '
    + 'CREDENTIAL, so it is argued for in the commit that makes it — not fixed by '
    + 'updating this list.');
});

t('every entry carries a real reason, not a label', () => {
  for (const e of parseAllowlist()) {
    assert.ok(e.reason && e.reason.length >= 30,
      `${e.path} has a ${e.reason ? e.reason.length : 0}-character reason — an exemption ` +
      'without an argument is not an exemption');
    assert.ok(/\s/.test(e.reason.trim()), `${e.path}: the reason is one word`);
  }
});

t('nothing that ARMS anything is exempt', () => {
  const armLike = /enable|arm|mode|auto|start|sell|execute|trade|order/i;
  const suspicious = parseAllowlist()
    .filter((e) => armLike.test(e.path))
    .filter((e) => !/own (shared )?secret|its own key|authenticate/i.test(e.reason));
  assert.deepStrictEqual(suspicious.map((e) => e.path), [],
    'these look like they arm or place something and their reason does not cite a '
    + 'credential of their own: ' + suspicious.map((e) => e.path).join(', '));
});

t('the external senders that ARE exempt really do authenticate themselves', () => {
  /* Asserted at the PROVIDER, not from the allowlist's own claim. A reason that
     says "it authenticates itself" is a sentence; this checks the code. */
  const bridge = fs.readFileSync(path.join(ROOT, 'amibroker-bridge.js'), 'utf8');
  const routes = [...bridge.matchAll(/app\.post\('(\/api\/amibroker\/[^']+)'/g)].map((m) => m[1]);
  assert.ok(routes.length >= 3, `expected the bridge to register 3 routes, found ${routes.length}`);
  for (const r of routes) {
    const i = bridge.indexOf(`'${r}'`);
    const body = bridge.slice(i, i + 600);
    assert.ok(/self\.authenticate\(req\)/.test(body),
      `${r} is allowlisted on the grounds that it authenticates itself, and it does not`);
  }
  assert.ok(/Rejected — bad key/.test(SRC),
    'the TradingView receiver is allowlisted on the grounds that it checks its own key');
});

console.log('\n§3 — against the RUNNING process, if one is up');

t('the live router reports the allowlist and nothing else as ungated', async () => {
  let j = null;
  try {
    const res = await fetch('http://127.0.0.1:3000/api/attestation', { signal: AbortSignal.timeout(5000) });
    j = await res.json();
  } catch (_) {
    console.log('      (no server on :3000 — skipped, and recorded as not verified in-process)');
    return;
  }
  const cg = j.controls.controlGate;
  const ungated = (cg.ungatedPaths || []).map((p) => p.replace(/^[A-Z|]+\s+/, '')).sort();
  console.log(`      in-process: ${cg.routes.mutating} mutating, ${cg.routes.gated} gated, ${cg.routes.ungated} ungated`);
  assert.deepStrictEqual(ungated, EXPECTED_ALLOWLIST.sort(),
    'the RUNNING process has a different set of open routes than the source says. '
    + 'Either it is stale (run scripts/attest-verify.js) or a route is registered '
    + 'somewhere this file cannot see.');
});

(async () => {
  // §3 is async; give it a tick before the summary.
  await new Promise((r) => setTimeout(r, 6000));
  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing`);
  process.exit(failures === 0 ? 0 : 1);
})();
