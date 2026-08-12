/* TEST CATEGORIES — characterization · unit · failure
   @test:characterization @test:unit @test:failure

   characterization = §1 pins the real AfternoonEngine losing its trade cap to NaN. No
   integration / performance / memory-leak / rollback tests.

   These markers are what this file ACTUALLY contains. The Testing Rule names eight
   categories; this suite declares the ones it has and names the ones it does not,
   because a marker asserting coverage that was never written is worse than no marker:
   it converts missing work into apparent compliance. */
/* PHASE 1B — a malformed limit is a refusal, not a NaN.

   §1 proves the defect against the REAL engine, not a paraphrase of it. The
   value is set in the environment, the real AfternoonEngine is constructed, and
   the real comparison from afternoon-engine.js:374 is evaluated. A test that
   built its own `maxTrades = NaN` would prove that NaN behaves like NaN, which
   nobody doubted (prompt F1).
*/
'use strict';

const assert = require('assert');
let failures = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e && e.message}`); }
};

const { readLimit, readLimits, assertLimits, isDegenerateLimit } = require('../limits');

console.log('\n§1 — the defect, against the real engine');

t('AFTERNOON_MAX_TRADES="abc" now REFUSES at load — was: removed the cap silently', () => {
  /* CHARACTERIZATION → REGRESSION, 2026-08-10.

     This assertion used to be:

         assert.ok(Number.isNaN(e.maxTrades));
         for (const tradesToday of [0, 1, 5, 100, 1e9])
           assert.strictEqual(tradesToday >= e.maxTrades, false);

     and it passed — against the real engine, the cap was false for every possible
     count, so the limit did not exist. That run is the evidence in docs/089 §1B.

     afternoon-engine now reads its risk limits through assertLimits(), so the
     same input refuses at module load. The assertion was inverted in the same
     commit that made the change; leaving it pinned to NaN would have kept a test
     green while asserting a defect that had been fixed. */
  const saved = process.env.AFTERNOON_MAX_TRADES;
  process.env.AFTERNOON_MAX_TRADES = 'abc';
  delete require.cache[require.resolve('../afternoon-engine.js')];

  let threw = null;
  try { require('../afternoon-engine.js'); } catch (e) { threw = e; }

  if (saved === undefined) delete process.env.AFTERNOON_MAX_TRADES;
  else process.env.AFTERNOON_MAX_TRADES = saved;
  delete require.cache[require.resolve('../afternoon-engine.js')];

  assert.ok(threw, 'a malformed trade cap was accepted — the cap silently does not exist');
  assert.match(threw.message, /AFTERNOON_MAX_TRADES/, 'the refusal must name the variable');
  assert.match(threw.message, /removes the limit rather than applying it/,
    'and say what a non-finite limit actually does, not just that it is invalid');
});

t('and a VALID config still loads and yields a usable cap', () => {
  /* The refusal is only worth having if the ordinary path is untouched. */
  delete require.cache[require.resolve('../afternoon-engine.js')];
  const A = require('../afternoon-engine.js');
  const Engine = A.AfternoonEngine || A;
  const e = new Engine({ live: {}, getPrice: () => 0 });
  assert.strictEqual(isDegenerateLimit(e.maxTrades), false, `maxTrades is ${e.maxTrades}`);
  assert.strictEqual(0 >= e.maxTrades, e.maxTrades <= 0, 'the comparison discriminates again');
  assert.ok(e.maxTrades + 1 > e.maxTrades);
});

t('parseInt("12abc") silently becomes 12 — a typo becomes a different valid limit', () => {
  assert.strictEqual(parseInt('12abc', 10), 12);
  assert.ok(Number.isNaN(Number('12abc')), 'Number() must reject the whole string');
});

console.log('\n§2 — the table. Every input, every outcome named.');

const CASES = [
  // raw,          ok,     value, note
  [undefined,      true,   7,     'absent → default'],
  ['',             true,   7,     'empty → default'],
  ['   ',          true,   7,     'whitespace → default'],
  ['abc',          false,  null,  'malformed → refusal'],
  ['12abc',        false,  null,  'prefix-numeric → refusal, NOT 12'],
  ['I0',           false,  null,  'capital-i typo → refusal, not the default'],
  ['-1',           false,  null,  'below min → refusal'],
  ['0',            true,   0,     'zero is a legitimate limit'],
  ['1e999',        false,  null,  'overflows to Infinity → refusal'],
  ['NaN',          false,  null,  'the literal word → refusal'],
  ['Infinity',     false,  null,  'infinite → refusal'],
  [' 5 ',          true,   5,     'padded → trimmed and accepted'],
  ['5.5',          false,  null,  'non-integer where integer required'],
  ['1000000',      false,  null,  'above max → refusal'],
];

for (const [raw, expectOk, expectValue, note] of CASES) {
  t(`${JSON.stringify(raw)} → ${expectOk ? `value ${expectValue}` : 'REFUSED'}  (${note})`, () => {
    const env = raw === undefined ? {} : { MAX_TRADES: raw };
    const r = readLimit('MAX_TRADES', { default: 7, min: 0, max: 1000, integer: true, env });
    assert.strictEqual(r.ok, expectOk, `ok=${r.ok}, error=${r.error}`);
    if (expectOk) assert.strictEqual(r.value, expectValue);
    else {
      assert.strictEqual(r.value, null, 'a refused limit must not carry a value');
      assert.ok(r.error && r.error.includes('MAX_TRADES'), 'the error must name the variable');
    }
  });
}

console.log('\n§3 — THE PROPERTY: no accepted value can be degenerate');

t('every accepted value is finite — asserted as a property, not a list', () => {
  const inputs = [undefined, '', ' ', 'abc', '12abc', '-1', '0', '1e999', 'NaN',
    'Infinity', '-Infinity', ' 5 ', '5.5', '1e308', '0x10', '1_000', 'null',
    'true', '[]', '{}', '1,000', '½', '٣'];
  for (const raw of inputs) {
    const env = raw === undefined ? {} : { L: raw };
    const r = readLimit('L', { default: 3, min: 0, max: 100, env });
    if (!r.ok) continue;
    assert.strictEqual(isDegenerateLimit(r.value), false,
      `input ${JSON.stringify(raw)} was ACCEPTED as ${r.value}, which is degenerate`);
    // and the comparison must actually discriminate
    assert.strictEqual(r.value + 1 >= r.value, true);
    assert.strictEqual(r.value - 1 >= r.value, false,
      `input ${JSON.stringify(raw)} produced a limit no count can exceed`);
  }
});

t('isDegenerateLimit catches what the old idiom produced', () => {
  assert.strictEqual(isDegenerateLimit(NaN), true);
  assert.strictEqual(isDegenerateLimit(Infinity), true);
  assert.strictEqual(isDegenerateLimit(parseInt('abc', 10)), true);
  assert.strictEqual(isDegenerateLimit(parseFloat(process.env.__NOPE__ || 'zzz')), true);
  assert.strictEqual(isDegenerateLimit(5), false);
  assert.strictEqual(isDegenerateLimit(0), false);
  assert.strictEqual(isDegenerateLimit('5'), true, 'a string limit is degenerate — "10" >= "9" is false');
});

console.log('\n§4 — a bad limit refuses startup, naming every offender at once');

t('assertLimits throws and names ALL the invalid variables', () => {
  const spec = {
    MAX_TRADES: { default: 5, min: 0, max: 100, integer: true },
    MAX_LOSS_PCT: { default: 2, min: 0, max: 100 },
    MAX_CONSEC: { default: 5, min: 1, max: 50, integer: true },
  };
  const env = { MAX_TRADES: 'abc', MAX_LOSS_PCT: '-4', MAX_CONSEC: '3' };
  let msg = '';
  assert.throws(() => assertLimits(spec, env), (e) => { msg = e.message; return true; });
  assert.ok(msg.includes('MAX_TRADES'), 'MAX_TRADES not named');
  assert.ok(msg.includes('MAX_LOSS_PCT'), 'MAX_LOSS_PCT not named');
  assert.ok(!msg.includes('MAX_CONSEC='), 'a valid limit was reported as invalid');
  assert.ok(/2 invalid/.test(msg), 'the count must be stated, so one restart reveals every mistake');
});

t('a failed limit is absent from values — it cannot be read as a wrong number', () => {
  const r = readLimits({
    GOOD: { default: 1, min: 0, max: 10 },
    BAD: { default: 1, min: 0, max: 10 },
  }, { BAD: 'abc' });
  assert.strictEqual(r.values.GOOD, 1);
  assert.ok(!('BAD' in r.values), 'a refused limit leaked into values');
  assert.strictEqual(r.values.BAD, undefined);
  assert.strictEqual(r.ok, false);
});

t('required and unset is a refusal, not a default', () => {
  const r = readLimit('MUST', { required: true, env: {} });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /required/);
});

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
