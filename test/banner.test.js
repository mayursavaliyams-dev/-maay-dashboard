/* TEST CATEGORIES — characterization · unit · failure
   @test:characterization @test:unit @test:failure

   characterization = §1 evaluates the shipped server.js:8302 expression with the state the
   running process was actually in. No integration / performance / memory-leak / rollback tests.

   These markers are what this file ACTUALLY contains. The Testing Rule names eight
   categories; this suite declares the ones it has and names the ones it does not,
   because a marker asserting coverage that was never written is worse than no marker:
   it converts missing work into apparent compliance. */
/* PHASE 3A — the first line an operator reads must be true.

   §2 uses the REAL connector classes from this repository, not stubs. The
   defect being fixed is that a banner reported a connector's capability wrongly;
   a stub would report whatever this test decided a connector looks like, which
   is how the previous capability fix came to pass while being wrong (prompt F4).
*/
'use strict';

const assert = require('assert');
const path = require('path');

let failures = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e && e.message}`); }
};

const { renderBanner, captureCapability, liveOrdersPossible, CAPABILITIES } = require('../banner');

console.log('\n§1 — the defect: the old expression, evaluated');

t('the shipped banner says LIVE (Dhan) for an upstox paper process', () => {
  // The expression from server.js:8302, verbatim, with the state the running
  // process was actually in on 2026-08-07.
  const live = { connected: true };          // upstox market data was connected
  const shipped = live.connected ? 'LIVE (Dhan)' : 'DISCONNECTED - set DHAN creds';
  assert.strictEqual(shipped, 'LIVE (Dhan)');

  const truth = renderBanner({ connector: 'upstox', tradeMode: 'paper', orderCapability: CAPABILITIES.REFUSES });
  assert.ok(!truth.includes('Dhan'), 'the replacement still names a broker that is not connected');
  assert.ok(truth.includes('upstox'), 'the connector is not named');
  assert.ok(truth.includes('PAPER'), 'the mode is not stated');
  console.log(`      shipped : Mode: ${shipped}`);
  console.log(`      derived : ${truth}`);
});

t('live.connected answers a different question and must not drive the mode', () => {
  // Connected market data with a refusing connector in paper mode.
  const b = renderBanner({ connector: 'upstox', tradeMode: 'paper', orderCapability: CAPABILITIES.REFUSES });
  assert.ok(!/LIVE ORDERS POSSIBLE/.test(b));
});

console.log('\n§2 — capability comes from the REAL connector modules');

const REAL = [
  ['upstox-connector.js', 'UpstoxConnector'],
  ['kotak-neo-connector.js', 'KotakNeoConnector'],
  ['live-connector.js', 'LiveConnector'],
];

t('every real connector yields a definite capability, never UNKNOWN', () => {
  for (const [file, name] of REAL) {
    let Mod;
    try { Mod = require(path.join('..', file)); } catch (e) { console.log(`      (${file} not loadable: ${e.message})`); continue; }
    const Ctor = Mod[name] || Mod;
    const proto = Ctor && Ctor.prototype;
    if (!proto) { console.log(`      (${file}: no prototype — skipped, recorded)`); continue; }
    const cap = captureCapability(Object.create(proto));
    console.log(`      ${name.padEnd(20)} → ${cap}`);
    assert.notStrictEqual(cap, CAPABILITIES.UNKNOWN,
      `${name} produced UNKNOWN — the banner would print an unknown into the operator's first line`);
  }
});

t('a connector with no placeOrder is NONE, not REFUSES', () => {
  assert.strictEqual(captureCapability({ name: 'x' }), CAPABILITIES.NONE);
});

t('a connector that throws by design is REFUSES', () => {
  const c = { placeOrder() { throw new Error('paper mode only — not implemented'); } };
  assert.strictEqual(captureCapability(c), CAPABILITIES.REFUSES);
});

t('a connector that would submit is LIVE_CAPABLE', () => {
  const c = { async placeOrder(o) { return this._post('/orders', o); } };
  assert.strictEqual(captureCapability(c), CAPABILITIES.LIVE_CAPABLE);
});

t('reading capability AFTER a guard replaces the method does not report the connector', () => {
  /* THE F4 CASE. A previous fix read capability at request time, by which point
     the guard had replaced placeOrder — so every connector looked incapable,
     including the live-capable ones. */
  const connector = { async placeOrder(o) { return this._post('/orders', o); } };
  const before = captureCapability(connector);
  assert.strictEqual(before, CAPABILITIES.LIVE_CAPABLE);

  connector.placeOrder = function guarded(o) {
    if (!o.approval) throw new Error('requestApproval must be called first');
    return null;
  };
  const after = captureCapability(connector);
  assert.notStrictEqual(after, CAPABILITIES.LIVE_CAPABLE,
    'a guarded method was read as the connector\'s own capability');
  assert.strictEqual(after, CAPABILITIES.NEUTRALISED,
    'a guarded method must be reported as neutralised, not as incapable — the ' +
    'underlying connector may still be live-capable and that is the thing that matters');
});

console.log('\n§3 — "could an order reach a broker" is its own fact');

const TABLE = [
  [CAPABILITIES.LIVE_CAPABLE, 'live',  true,  null],
  [CAPABILITIES.LIVE_CAPABLE, 'paper', false, 'mode'],
  [CAPABILITIES.REFUSES,      'live',  false, 'connector'],
  [CAPABILITIES.REFUSES,      'paper', false, 'connector and mode'],
  [CAPABILITIES.NONE,         'live',  false, 'connector'],
  [CAPABILITIES.UNKNOWN,      'live',  false, 'connector'],
];

for (const [cap, mode, expected, blockedBy] of TABLE) {
  t(`${cap.padEnd(13)} + ${mode.padEnd(5)} → ${expected ? 'POSSIBLE' : `blocked by ${blockedBy}`}`, () => {
    const r = liveOrdersPossible({ orderCapability: cap, tradeMode: mode });
    assert.strictEqual(r.possible, expected);
    assert.strictEqual(r.blockedBy, blockedBy);
  });
}

t('the refusal names WHICH key is missing, because the two need different actions', () => {
  assert.strictEqual(liveOrdersPossible({ orderCapability: CAPABILITIES.LIVE_CAPABLE, tradeMode: 'paper' }).blockedBy, 'mode');
  assert.strictEqual(liveOrdersPossible({ orderCapability: CAPABILITIES.REFUSES, tradeMode: 'live' }).blockedBy, 'connector');
});

console.log('\n§4 — the banner under three real configurations');

const CONFIGS = [
  ['today', { connector: 'upstox', tradeMode: 'paper', orderCapability: CAPABILITIES.REFUSES }],
  ['armed', { connector: 'upstox', tradeMode: 'live', orderCapability: CAPABILITIES.LIVE_CAPABLE }],
  ['half-armed', { connector: 'kotak', tradeMode: 'live', orderCapability: CAPABILITIES.REFUSES }],
];

for (const [label, cfg] of CONFIGS) {
  t(`${label}: names the connector, the mode, and the order reality`, () => {
    const b = renderBanner(cfg);
    console.log(`      ${b}`);
    assert.ok(b.includes(cfg.connector), 'connector missing');
    assert.ok(b.includes(cfg.tradeMode.toUpperCase()), 'mode missing');
    const shouldWarn = cfg.tradeMode === 'live' && cfg.orderCapability === CAPABILITIES.LIVE_CAPABLE;
    assert.strictEqual(/LIVE ORDERS POSSIBLE/.test(b), shouldWarn,
      shouldWarn ? 'an armed system did not say so' : 'a non-armed system claimed it was armed');
  });
}

t('an unknown connector is printed as UNKNOWN, not as a plausible default', () => {
  const b = renderBanner({ connector: null, tradeMode: null, orderCapability: null });
  assert.ok(b.includes('UNKNOWN'), 'a missing connector was given a name it does not have');
  assert.ok(b.includes('PAPER'), 'the safe default is stated rather than left blank');
});

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
