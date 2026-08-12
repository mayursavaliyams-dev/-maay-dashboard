/**
 * instrument-guard — an unknown instrument must be refused, never silently swapped.
 * Run: node test/instrument-guard.test.js
 *
 * @test:characterization @test:regression @test:unit @test:failure
 * @test:integration @test:security @test:rollback
 *
 * THE DEFECT, as found on 2026-07-29 while probing the stock view.
 *
 *     GET /api/options/snapshot?instrument=TMPV   →  { instrument: "TMPV",
 *                                                      spotPrice: 77654.6, ... }
 *
 * 77654.6 is SENSEX. TMPV traded at ₹329.80. The same number came back for
 * RELIANCE and for NOTAREALTHING — three different inputs, one output, each
 * labelled with the name that was asked for. The response did not fail and did
 * not warn; it stated an instrument it was not showing.
 *
 * The cause was one line:
 *
 *     return INSTRUMENT_META[String(inst || 'SENSEX').toUpperCase()]
 *            || INSTRUMENT_META.SENSEX;          // ← any unknown name = SENSEX
 *
 * This is the exact class the project forbids everywhere else: a missing value
 * substituted by a plausible one. `null ≠ 0`, and TMPV ≠ SENSEX. A wrong price
 * under a right label is worse than an error, because nothing downstream — a
 * chart, a sizing call, a person reading the screen — has any way to notice.
 *
 * REAL TRIGGER, not hypothetical: TATAMOTORS.NS stopped resolving after the
 * demerger to TMPV. A symbol that is renamed by an exchange is exactly how an
 * unknown instrument reaches this function in production.
 *
 * THE FIX has two halves, and this file tests both:
 *   · the HTTP boundary refuses an unknown instrument with 400 (one middleware,
 *     so a route added tomorrow is covered without being edited);
 *   · getInstrumentMeta throws on an unknown name instead of returning SENSEX,
 *     so an internal caller cannot reach the lie either.
 *
 * The no-argument call still defaults to SENSEX. That default is legitimate —
 * it is the "caller named nothing" case, not the "caller named something we do
 * not have" case. Only the second one was ever a lie.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };
const ROOT = path.join(__dirname, '..');

/* Read a source file with its comments removed.
   Every assertion about code SHAPE goes through this. Four separate times in
   this codebase a test has matched its own explanatory prose instead of the
   code and reported the opposite of the truth — and this very file quotes the
   defective `|| INSTRUMENT_META.SENSEX` line in its header, so a naive search
   for it would find the comment above and pass forever. */
const code = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const G = require(path.join(ROOT, 'instrument-guard.js'));

console.log('\ninstrument-guard\n');

/* ── 1. the name test ────────────────────────────────────────────────────── */
console.log('known vs unknown');
ok(G.isKnown('SENSEX') && G.isKnown('NIFTY') && G.isKnown('BANKNIFTY'),
  'the three traded instruments are known');
ok(G.isKnown('nifty') && G.isKnown(' NiFtY '),
  'case and surrounding space do not change the answer');
ok(!G.isKnown('TMPV'), 'TMPV is not known — the symbol from the live defect');
ok(!G.isKnown('RELIANCE'), 'an equity symbol is not a known index');
ok(!G.isKnown('NOTAREALTHING') && !G.isKnown('') && !G.isKnown(null) && !G.isKnown(undefined),
  'garbage, empty and absent are all not-known');
ok(!G.isKnown('SENSEX_'), 'a near-miss is not a match — no prefix or fuzzy behaviour');

/* ── 2. the middleware refuses rather than substitutes ───────────────────── */
console.log('\nHTTP boundary');
const call = (query, opts) => {
  const req = { query, path: '/api/x' };
  let sent = null, status = 200, nexted = false;
  const res = { status(c) { status = c; return this; }, json(b) { sent = b; return this; } };
  G.guard(opts)(req, res, () => { nexted = true; });
  return { sent, status, nexted };
};

const bad = call({ instrument: 'TMPV' });
ok(bad.status === 400 && !bad.nexted, 'instrument=TMPV is refused with 400, handler never runs');
ok(bad.sent && bad.sent.ok === false, 'the refusal is marked not-ok');
ok(bad.sent && /TMPV/.test(JSON.stringify(bad.sent)),
  'the refusal names the value that was rejected — a 400 that hides the input is unactionable');
ok(bad.sent && Array.isArray(bad.sent.supported) && bad.sent.supported.includes('NIFTY'),
  'the refusal lists what IS supported, so the caller can fix the call');
ok(!/77654|SENSEX/.test(JSON.stringify(bad.sent.error || '')),
  'the refusal does not quietly suggest SENSEX as a stand-in');

ok(call({ inst: 'NOTAREALTHING' }).status === 400, 'the ?inst= spelling is guarded too');
ok(call({ inst: 'NIFTY' }).nexted === true, 'a known instrument passes through untouched');
ok(call({}).nexted === true, 'no instrument named at all still passes — routes have defaults');
ok(call({ inst: '' }).nexted === true, 'an empty value is "not named", not "named wrongly"');
ok(call({ inst: 'ALL' }).nexted === true, 'ALL is a real value on the multi-instrument routes');
ok(call({ inst: 'NIFTY,SENSEX' }).nexted === true, 'a comma list of known names passes');
ok(call({ inst: 'NIFTY,TMPV' }).status === 400, 'one bad name in a list fails the whole list');
ok(call({ inst: ['NIFTY', 'TMPV'] }).status === 400,
  'a repeated query parameter arrives as an array and is still checked');
ok(call({ inst: 'ALL' }, { allowAll: false }).status === 400,
  'ALL can be switched off for routes that do not mean it');

/* ── 3. the internal path cannot reach the lie either ────────────────────── */
console.log('\nserver.js');
const S = code('server.js');
ok(!/\|\|\s*INSTRUMENT_META\.SENSEX/.test(S),
  'the silent `|| INSTRUMENT_META.SENSEX` fallback is gone from the code');
ok(/require\(['"]\.\/instrument-guard['"]\)/.test(S), 'server.js uses the guard module');
ok(/app\.use\(['"]\/api['"]\s*,\s*[\w.]*guard/.test(S),
  'the guard is mounted on /api as middleware — one place, so new routes inherit it');

/* ── 4. the resolver, exercised rather than read ─────────────────────────────
   server.js is not require()d here on purpose: it calls app.listen() at the top
   level, so importing it would start a second bot on the live port. The logic
   getInstrumentMeta delegates to lives in the guard module, where it can be run
   directly — which is the reason it was put there rather than left inline. */
console.log('\nresolver');
const TABLE = { SENSEX: { label: 'SENSEX' }, NIFTY: { label: 'NIFTY' }, BANKNIFTY: { label: 'BANKNIFTY' } };
const resolve = (v) => G.resolveMeta(TABLE, v, 'SENSEX');

ok(resolve('NIFTY').label === 'NIFTY', 'a known name resolves to its own meta');
ok(resolve('nifty').label === 'NIFTY', 'lower case resolves the same');
ok(resolve(undefined).label === 'SENSEX', 'no argument still defaults to SENSEX — that default was never the bug');
ok(resolve('').label === 'SENSEX', 'an empty string is "named nothing", so the default applies');

const threw = (v) => { try { resolve(v); return false; } catch (e) { return e; } };
ok(threw('TMPV'), 'TMPV throws instead of returning SENSEX — the live defect, refused');
ok(/TMPV/.test(threw('TMPV').message), 'the error names the instrument that was asked for');
ok(/SENSEX/.test(threw('TMPV').message) && /NIFTY/.test(threw('TMPV').message),
  'the error lists what is available, so the caller can act on it');
ok(threw('RELIANCE') && threw('NOTAREALTHING'), 'every unknown name throws, not just the one that was reported');

console.log(`\n${n} checks passed\n`);
