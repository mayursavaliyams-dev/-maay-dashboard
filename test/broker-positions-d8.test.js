/* TEST CATEGORIES — characterization · unit · failure · regression
   @test:characterization @test:unit @test:failure @test:regression

   No integration / performance / memory-leak / rollback tests.
   These markers are what this file ACTUALLY contains. */

/* D-8 / A5 — "the call failed" and "the account is flat" are different answers.

   WHAT WAS ACTUALLY WRONG, stated precisely, because I first stated it wrongly.

   I described this as "the system reports itself flat when the broker errors".
   That was not true. broker-positions.js already refused to read an empty list
   as flat, and named this very defect in its own reason string. Nothing ever
   claimed the account was flat on the strength of a failed call.

   The real cost was quieter and permanent: because an empty list could ALWAYS be
   a failure, an empty list could NEVER be read as flat. The operator could not
   get a clean answer even when the account genuinely was flat, and no
   reconciliation could be built on a book whose empty state means nothing.

   The fix is at the connector, where the conflation was:
     · a failed call now THROWS, with a code
     · a disconnected session THROWS rather than returning []
     · [] means the broker was asked and answered with nothing

   and `positionsDistinguishEmptyFromError` is how a connector declares it.
*/
'use strict';

const assert = require('assert');
const fs = require('fs');
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

const bp = require('../broker-positions.js');
const read = bp.brokerPositions || bp.read || bp.get
  || Object.values(bp).find((v) => typeof v === 'function');

console.log('\n§1 — the connectors no longer swallow a failure');

t('upstox getPositions throws instead of returning []', () => {
  const src = fs.readFileSync(path.join(ROOT, 'upstox-connector.js'), 'utf8');
  const body = src.slice(src.indexOf('async getPositions()'), src.indexOf('async getOrders()'));
  assert.ok(!/catch\s*\{\s*return \[\];\s*\}/.test(body),
    'the swallowing catch is back — a failed call reads as an empty account again');
  assert.ok(/BROKER_POSITIONS_UNAVAILABLE/.test(body), 'the throw must carry a code callers can branch on');
});

t('and declares that its empty list can be trusted', () => {
  const U = require('../upstox-connector.js');
  const Ctor = U.UpstoxConnector || U;
  const c = Object.create(Ctor.prototype);
  assert.strictEqual(c.positionsDistinguishEmptyFromError, true,
    'the marker is missing, so broker-positions cannot tell this connector apart from the old ones');
});

t('live-connector throws when disconnected — absence of a session is not evidence of being flat', () => {
  const src = fs.readFileSync(path.join(ROOT, 'live-connector.js'), 'utf8');
  const i = src.indexOf('async getPositions()');
  const body = src.slice(i, i + 900);
  assert.ok(!/\.catch\(\(\) => \[\]\)/.test(body), 'the swallowing catch is back');
  assert.ok(/if \(!this\.connected\)[\s\S]{0,120}throw/.test(body),
    'a disconnected session must throw, not return an empty list');
});

t('live-connector does NOT claim the marker it has not earned', () => {
  /* The marker is a claim about OBSERVED behaviour. live-connector has never been
     exercised against a Dhan session in this repository, so it does not carry it
     and broker-positions keeps giving the honest-but-useless answer for it. */
  const L = require('../live-connector.js');
  const Ctor = L.LiveConnector || L;
  const c = Object.create(Ctor.prototype);
  assert.notStrictEqual(c.positionsDistinguishEmptyFromError, true,
    'live-connector declares the marker without having been proven against a live session');
});

console.log('\n§2 — the three answers are now three answers');

(async () => {
  await ta('an OLD-style connector still gets the unverifiable answer', async () => {
    const r = await read({ connected: true, async getPositions() { return []; } });
    assert.strictEqual(r.status, 'EMPTY_UNVERIFIABLE');
    assert.match(r.operatorAction, /Open the broker app/);
    assert.match(r.reason, /A5|FAILED call/);
  });

  await ta('a NEW connector with a genuinely flat account gets a clean answer', async () => {
    const r = await read({
      connected: true, positionsDistinguishEmptyFromError: true,
      async getPositions() { return []; },
    });
    assert.strictEqual(r.status, 'EMPTY_VERIFIED');
    assert.deepStrictEqual(r.positions, []);
    assert.strictEqual(r.openLegs, 0);
    assert.match(r.operatorAction, /Nothing/i,
      'a verified-flat account must not send the operator to the broker app');
  });

  await ta('and a broker that is down is UNAVAILABLE, never flat', async () => {
    const r = await read({
      connected: true, positionsDistinguishEmptyFromError: true,
      async getPositions() {
        throw Object.assign(new Error('ETIMEDOUT'), { code: 'BROKER_POSITIONS_UNAVAILABLE' });
      },
    });
    assert.strictEqual(r.status, 'UNAVAILABLE');
    assert.strictEqual(r.positions, null, 'positions must be null, not [] — [] is a claim');
    assert.strictEqual(r.openLegs, null, 'a leg count of 0 would be a claim too');
    assert.match(r.reason, /threw/);
  });

  await ta('THE POINT: flat and unavailable never share a status', async () => {
    const flat = await read({ connected: true, positionsDistinguishEmptyFromError: true, async getPositions() { return []; } });
    const down = await read({ connected: true, positionsDistinguishEmptyFromError: true, async getPositions() { throw new Error('x'); } });
    assert.notStrictEqual(flat.status, down.status);
    assert.ok(flat.positions !== null && down.positions === null,
      'one of them must carry a list and the other must carry nothing at all');
  });

  await ta('a connector with no getPositions at all is still handled', async () => {
    const r = await read({ connected: true });
    assert.strictEqual(r.status, 'UNAVAILABLE');
    assert.match(r.reason, /no getPositions/);
  });

  console.log('\n§3 — what this unblocks, and what it does not');

  t('reconciliation is now BUILDABLE — recorded, not built', () => {
    /* scripts/smoke.js carried the reason it could not be built. That reason has
       gone for upstox; the note stays until reconciliation actually exists, so
       nobody reads its absence as a decision. */
    const smoke = fs.readFileSync(path.join(ROOT, 'scripts', 'smoke.js'), 'utf8');
    assert.ok(/no code compares internal positions to broker positions/.test(smoke),
      'the note that reconciliation does not exist was removed before reconciliation existed');
  });

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing`);
  process.exit(failures === 0 ? 0 : 1);
})();
