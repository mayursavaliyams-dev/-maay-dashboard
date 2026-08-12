/* TEST CATEGORIES — unit · failure · integration · regression
   @test:unit @test:failure @test:integration @test:regression

   integration = §4 drives the REAL broker-positions.js against connector stubs
   rather than a hand-built broker result. No performance / memory-leak /
   rollback tests. These markers are what this file ACTUALLY contains. */

/* RECONCILIATION — docs/093 §2.

   Three ways this could quietly become useless, one section each:

     §1  a difference is auto-corrected, so nothing is ever reported
     §2  UNAVAILABLE is treated as agreement, so the check passes hardest at the
         moment the broker is unreachable
     §3  the loop stops and its silence reads as agreement

   Each is a single line of carelessness away, and each would leave a green
   screen. The assertions below are aimed at those three and not at arithmetic.
*/
'use strict';

const assert = require('assert');
const path = require('path');

let failures = 0;
const t = (name, fn) => {
  try { const r = fn(); if (r && r.then) return r; console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e && e.message}`); }
};
const ta = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e && e.message}`); }
};

const { reconcile, verdict, legKey, VERDICT } = require('../reconciliation');

const leg = (o = {}) => ({
  instrument: 'NIFTY', strike: 24500, optionType: 'CE', side: 'SELL', lots: 1, ...o,
});
const ours = (positions) => ({ ok: true, positions });
const brokerOk = (positions) => ({ status: 'OK', positions });

console.log('\n§1 — a difference is REPORTED and BLOCKS, never corrected');

t('identical books agree', () => {
  const r = reconcile({ internal: ours([leg()]), broker: brokerOk([leg()]) });
  assert.strictEqual(r.verdict, VERDICT.AGREED);
  assert.strictEqual(r.blocking, false);
  assert.deepStrictEqual(r.differences, []);
});

t('a leg only we know about is a difference, and it blocks', () => {
  const r = reconcile({ internal: ours([leg()]), broker: brokerOk([]) });
  assert.strictEqual(r.verdict, VERDICT.MISMATCH);
  assert.strictEqual(r.blocking, true);
  assert.strictEqual(r.differences[0].kind, 'ONLY_INTERNAL');
  assert.match(r.operatorAction, /Do not trade/i);
  assert.match(r.operatorAction, /will not choose for you/i,
    'the action must say the tool refuses to pick a side — that refusal is the design');
});

t('a leg only the BROKER knows about is a difference too', () => {
  /* The manual trade on the phone, or a fill we never recorded. Reporting only
     our-side surprises would make the dangerous direction invisible. */
  const r = reconcile({ internal: ours([]), broker: brokerOk([leg()]) });
  assert.strictEqual(r.differences[0].kind, 'ONLY_BROKER');
  assert.match(r.differences[0].detail, /manual trade|did not record/);
});

t('a quantity difference reports BOTH numbers, never a delta', () => {
  const r = reconcile({ internal: ours([leg({ lots: 2 })]), broker: brokerOk([leg({ lots: 3 })]) });
  const d = r.differences[0];
  assert.strictEqual(d.kind, 'QUANTITY');
  assert.strictEqual(d.internalLots, 2);
  assert.strictEqual(d.brokerLots, 3);
  assert.match(d.detail, /we say 2 lots, the broker says 3/,
    'a delta of 1 cannot be checked against the broker screen; the two numbers can');
});

t('an unreadable quantity is its own kind, not a match', () => {
  const r = reconcile({ internal: ours([leg({ lots: null })]), broker: brokerOk([leg({ lots: 1 })]) });
  assert.strictEqual(r.differences[0].kind, 'QUANTITY_UNKNOWN');
  assert.strictEqual(r.blocking, true,
    'a leg we cannot check is not a leg that agrees');
});

t('THE RULE: nothing is mutated — both inputs come back untouched', () => {
  const a = ours([leg({ lots: 2 })]);
  const b = brokerOk([leg({ lots: 5 })]);
  const beforeA = JSON.stringify(a);
  const beforeB = JSON.stringify(b);
  reconcile({ internal: a, broker: b });
  assert.strictEqual(JSON.stringify(a), beforeA, 'the internal book was modified');
  assert.strictEqual(JSON.stringify(b), beforeB, 'the broker book was modified');
});

console.log('\n§2 — UNAVAILABLE is not agreement');

t('an unavailable broker BLOCKS, and reports no differences at all', () => {
  const r = reconcile({
    internal: ours([]),
    broker: { status: 'UNAVAILABLE', positions: null, reason: 'getPositions() threw: ETIMEDOUT',
      operatorAction: 'Open the broker app.' },
  });
  assert.strictEqual(r.verdict, VERDICT.UNAVAILABLE);
  assert.strictEqual(r.blocking, true);
  assert.strictEqual(r.differences, null,
    'an empty differences array would read as "checked, nothing wrong"');
  assert.strictEqual(r.counts, null);
});

t('THE TEMPTING BUG: two empty books do NOT agree when the broker is unreachable', () => {
  /* Both sides look flat. A naive implementation compares [] with [] and reports
     AGREED — passing hardest at the exact moment the broker cannot be reached. */
  const r = reconcile({
    internal: ours([]),
    broker: { status: 'UNAVAILABLE', positions: null, reason: 'down' },
  });
  assert.notStrictEqual(r.verdict, VERDICT.AGREED);
});

t('EMPTY_UNVERIFIABLE is not comparable either', () => {
  /* An old connector's empty list. Comparing against it would either invent a
     page of "missing at broker" differences, or produce a confident AGREED built
     on two unknowns. */
  const r = reconcile({
    internal: ours([leg()]),
    broker: {
      status: 'EMPTY_UNVERIFIABLE', positions: [],
      reason: 'this connector returns [] for a failed call too',
      operatorAction: 'Open the broker app.',
    },
  });
  assert.strictEqual(r.verdict, VERDICT.UNAVAILABLE);
  assert.match(r.reason, /cannot distinguish/);
});

t('EMPTY_VERIFIED IS comparable — that is what D-8 bought', () => {
  const r = reconcile({ internal: ours([]), broker: { status: 'EMPTY_VERIFIED', positions: [] } });
  assert.strictEqual(r.verdict, VERDICT.AGREED);
  assert.strictEqual(r.counts.internal, 0);
  assert.strictEqual(r.counts.broker, 0);
});

t('and a verified-empty broker against a book WE think is open is a mismatch', () => {
  const r = reconcile({ internal: ours([leg()]), broker: { status: 'EMPTY_VERIFIED', positions: [] } });
  assert.strictEqual(r.verdict, VERDICT.MISMATCH);
  assert.strictEqual(r.differences[0].kind, 'ONLY_INTERNAL');
});

t('an unavailable INTERNAL book blocks too — it is not only the broker that can be unknown', () => {
  const r = reconcile({ internal: { ok: false, reason: 'engines did not answer' }, broker: brokerOk([]) });
  assert.strictEqual(r.verdict, VERDICT.UNAVAILABLE);
  assert.match(r.reason, /internal book is unavailable/);
});

console.log('\n§3 — a stopped reconciliation does not read as agreement');

t('AGREED with a live heartbeat stands', () => {
  const r = reconcile({ internal: ours([]), broker: { status: 'EMPTY_VERIFIED', positions: [] } });
  const v = verdict(r, { name: 'reconcile', state: 'ALIVE' });
  assert.strictEqual(v.verdict, VERDICT.AGREED);
  assert.strictEqual(v.blocking, false);
});

t('AGREED with a STALE heartbeat becomes UNAVAILABLE', () => {
  const r = reconcile({ internal: ours([]), broker: { status: 'EMPTY_VERIFIED', positions: [] } });
  const v = verdict(r, { name: 'reconcile', state: 'STALE', reason: 'last beat 900s ago' });
  assert.strictEqual(v.verdict, VERDICT.UNAVAILABLE);
  assert.strictEqual(v.blocking, true);
  assert.match(v.reason, /stale/i);
});

t('AGREED with NO heartbeat at all becomes UNAVAILABLE', () => {
  const r = reconcile({ internal: ours([]), broker: { status: 'EMPTY_VERIFIED', positions: [] } });
  const v = verdict(r, null);
  assert.strictEqual(v.verdict, VERDICT.UNAVAILABLE);
  assert.match(v.reason, /no heartbeat|no evidence/i);
});

t('a MISMATCH is never softened by a healthy heartbeat', () => {
  const r = reconcile({ internal: ours([leg()]), broker: brokerOk([]) });
  const v = verdict(r, { name: 'reconcile', state: 'ALIVE' });
  assert.strictEqual(v.verdict, VERDICT.MISMATCH);
  assert.strictEqual(v.blocking, true);
});

console.log('\n§4 — against the REAL broker-positions module');

const bp = require('../broker-positions.js');
const readBroker = bp.brokerPositions || bp.read || bp.get
  || Object.values(bp).find((v) => typeof v === 'function');

(async () => {
  await ta('a throwing connector produces a blocking UNAVAILABLE end to end', async () => {
    /* Driven through the real broker-positions, not a hand-built result object:
       the shape this consumes is the shape that module actually produces, and a
       fixture would test my memory of it. */
    const broker = await readBroker({
      connected: true, positionsDistinguishEmptyFromError: true,
      async getPositions() { throw Object.assign(new Error('ETIMEDOUT'), { code: 'BROKER_POSITIONS_UNAVAILABLE' }); },
    });
    const r = reconcile({ internal: ours([leg()]), broker });
    assert.strictEqual(r.verdict, VERDICT.UNAVAILABLE);
    assert.strictEqual(r.blocking, true);
  });

  await ta('a genuinely flat broker and a flat book agree, end to end', async () => {
    const broker = await readBroker({
      connected: true, positionsDistinguishEmptyFromError: true,
      async getPositions() { return []; },
    });
    assert.strictEqual(broker.status, 'EMPTY_VERIFIED');
    const r = reconcile({ internal: ours([]), broker });
    assert.strictEqual(r.verdict, VERDICT.AGREED);
  });

  await ta('an OLD connector still cannot be reconciled against, end to end', async () => {
    const broker = await readBroker({ connected: true, async getPositions() { return []; } });
    assert.strictEqual(broker.status, 'EMPTY_UNVERIFIABLE');
    const r = reconcile({ internal: ours([]), broker });
    assert.strictEqual(r.verdict, VERDICT.UNAVAILABLE,
      'two empty books from an untrustworthy connector must not agree');
  });

  console.log('\n§5 — the key');

  t('legs are keyed by instrument, strike, type and side', () => {
    assert.strictEqual(legKey(leg()), 'NIFTY|24500|CE|SELL');
    assert.notStrictEqual(legKey(leg()), legKey(leg({ side: 'BUY' })));
    assert.notStrictEqual(legKey(leg()), legKey(leg({ optionType: 'PE' })));
    assert.notStrictEqual(legKey(leg()), legKey(leg({ strike: 24600 })));
  });

  t('expiry joins the key only when it is present', () => {
    /* A broker that omits expiry must not make every leg mismatch; a broker that
       provides it must not let two expiries collapse into one row. */
    assert.strictEqual(legKey(leg()), legKey(leg()));
    assert.notStrictEqual(legKey(leg({ expiry: '2026-08-27' })), legKey(leg({ expiry: '2026-09-24' })));
    assert.notStrictEqual(legKey(leg({ expiry: '2026-08-27' })), legKey(leg()));
  });

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing`);
  process.exit(failures === 0 ? 0 : 1);
})();
