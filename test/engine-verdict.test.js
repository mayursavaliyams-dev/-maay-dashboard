'use strict';
/**
 * The AI Architecture Rule, made executable.
 *
 * These assertions are tripwires. Each one corresponds to a way this platform has
 * already produced, or could produce, a confident wrong number:
 *   • `null ≠ 0`         — a missing score rendered as a neutral reading
 *   • `reliability: null`— an unmeasured engine steering a decision
 *   • BUY/SELL           — an engine deciding, when only Meta Decision may decide
 */
/**
 * TESTING RULE coverage. `engine-verdict` is a NEW module: there is no prior behaviour to pin,
 * so it carries contract tests instead of a characterization test. Characterization becomes
 * mandatory the moment anyone changes it.
 *   @test:unit @test:integration @test:regression @test:performance
 *   @test:memory-leak @test:failure @test:rollback
 */
const assert = require('assert');
const V = require('../engine-verdict.js');

let n = 0;
const ok = (cond, msg) => { n++; assert.ok(cond, msg); };
const eq = (a, b, msg) => { n++; assert.strictEqual(a, b, msg); };
const throws = (fn, re, msg) => { n++; assert.throws(fn, re, msg); };

const base = {
  engine: 'pop-seller', engineVersion: '0.1.0', status: 'ok',
  score: 0.4, confidence: 0.6, reliability: null,
  limitations: ['PoP assumes lognormal terminal spot; the tail is not measured'],
  missingEvidence: [{ input: 'risk-engine', reason: 'module absent' }],
  assumptions: { r: 0.065, oi_unit: 'UNVERIFIED' },
};

// ── 1. the happy path is frozen, and complete ────────────────────────────────
{
  const v = V.build(base);
  ok(v.status === 'ok' && v.score === 0.4, 'a valid verdict builds');
  ok(Object.isFrozen(v), 'the verdict is frozen — a consumer cannot mutate an engine');
  ok(Object.isFrozen(v.assumptions) && Object.isFrozen(v.limitations), 'nested fields are frozen too');
  ok(v.sampleSize === null && v.dataQuality === null && v.abstainReason === null,
    'omitted optional fields become null, never 0 and never undefined');
  throws(() => { const c = V.build(base); c.score = 1; },
    /Cannot assign|read only|Cannot add/, 'writing to a frozen verdict throws in strict mode');
}

// ── 2. NO ENGINE MAY OUTPUT BUY / SELL ───────────────────────────────────────
for (const k of V.FORBIDDEN_DECISION_KEYS) {
  throws(() => V.build({ ...base, [k]: 'anything' }),
    /decision belongs to Meta Decision alone/,
    `a '${k}' field is refused — an engine may not decide`);
}
for (const val of V.FORBIDDEN_DECISION_VALUES) {
  throws(() => V.build({ ...base, bias: val }),
    /no engine may output BUY\/SELL/,
    `the direction verb '${val}' is refused wherever it appears`);
}
throws(() => V.build({ ...base, bias: 'buy' }), /no engine may output BUY\/SELL/,
  'the check is case-insensitive — lowercase does not smuggle a decision through');
ok(V.build({ ...base, note: 'ABSTAINED' }).engine === 'pop-seller',
  'an innocent string that merely contains no verb is allowed');

// ── 3. null ≠ 0. THE INVARIANT. ──────────────────────────────────────────────
{
  throws(() => V.build({ ...base, status: 'abstain', score: 0, confidence: null, abstainReason: 'x' }),
    /NEVER 0/, 'abstain with score:0 is refused — this is the bug the whole rule exists to prevent');
  throws(() => V.build({ ...base, status: 'error', score: 0, confidence: null, abstainReason: 'x' }),
    /NEVER 0/, 'error with score:0 is refused for the same reason');
  throws(() => V.build({ ...base, status: 'abstain', score: null, confidence: 0.5, abstainReason: 'x' }),
    /requires confidence:null/, 'you cannot be confident about a score you do not have');
  throws(() => V.build({ ...base, status: 'abstain', score: null, confidence: null }),
    /requires abstainReason/, 'abstaining without saying why is refused — silence is not an explanation');

  const a = V.abstain('smart-money', '0.2.0', 'underlying volume is zero by construction');
  ok(a.status === 'abstain' && a.score === null && a.confidence === null,
    'abstain() produces a contract-valid verdict');
  ok(a.abstainReason === 'underlying volume is zero by construction', 'the reason survives');
  ok(V.build({ ...base, score: 0 }).score === 0,
    'score:0 IS allowed when status is ok — a confident neutral reading is a real reading');
}

// ── 4. NaN and Infinity are not null ─────────────────────────────────────────
for (const bad of [NaN, Infinity, -Infinity]) {
  throws(() => V.build({ ...base, score: bad }), /score must be/,
    `score ${bad} is refused — a non-finite number is not an absent one`);
}
throws(() => V.build({ ...base, score: 1.0001 }), /score must be/, 'score above +1 is refused');
throws(() => V.build({ ...base, score: -1.0001 }), /score must be/, 'score below -1 is refused');
ok(V.build({ ...base, score: 1 }).score === 1 && V.build({ ...base, score: -1 }).score === -1,
  'the bounds themselves are inclusive');
throws(() => V.build({ ...base, confidence: 1.5 }), /confidence must be/, 'confidence above 1 is refused');
throws(() => V.build({ ...base, reliability: 1.5 }), /reliability must be/, 'reliability above 1 is refused');

// ── 5. reliability: null ⇒ weight 0 ⇒ VETO ONLY ──────────────────────────────
{
  const unmeasured = V.build(base);                               // reliability: null
  ok(V.weightOf(unmeasured) === 0, 'an unmeasured engine carries ZERO weight');
  ok(V.isVetoOnly(unmeasured), 'it may veto; it may never drive');
  ok(V.weightOf(V.build({ ...base, reliability: 0.7 })) === 0.7, 'a measured engine carries its weight');
  ok(V.weightOf(V.build({ ...base, reliability: 0 })) === 0,
    'reliability:0 is a MEASURED zero — same weight, different meaning; both may only veto');
  ok(V.weightOf(V.abstain('x', '1', 'no data')) === 0, 'an abstaining engine carries zero weight');
  ok(V.weightOf(null) === 0 && V.weightOf(undefined) === 0,
    'a missing verdict carries zero weight — never a default 0.5');
}

// ── 6. an ok verdict must confess something ──────────────────────────────────
throws(() => V.build({ ...base, limitations: [] }), /at least one limitation/,
  'an ok verdict with no limitations is refused — every engine here has one');
ok(V.abstain('x', '1', 'r').limitations.length === 0,
  'an abstaining verdict need not list limitations — it produced no reading to qualify');

// ── 7. auditability ──────────────────────────────────────────────────────────
throws(() => V.build({ ...base, engineVersion: undefined }), /engineVersion required/,
  'a verdict without a version cannot be audited later');
throws(() => V.build({ ...base, engine: '' }), /engine id required/, 'an anonymous verdict is refused');
throws(() => V.build({ ...base, status: 'OK' }), /status must be one of/, 'status is case-sensitive');
throws(() => V.build({ ...base, assumptions: [] }), /assumptions must be an object/,
  'assumptions must be a named map, not a list');
throws(() => V.build({ ...base, missingEvidence: [{ input: 'x' }] }), /needs \{input, reason\}/,
  'missing evidence must say WHY it is missing');
throws(() => V.build({ ...base, sampleSize: 41.5 }), /non-negative integer/, 'a fractional sample is refused');
throws(() => V.build(null), /must be an object/, 'null is not a verdict');

// ── 8. no clock is read — the module is deterministic ────────────────────────
{
  const a = V.build(base), b = V.build(base);
  ok(a.computedAt === null && b.computedAt === null,
    'computedAt is injected, never read from the clock — otherwise every test is flaky');
  ok(JSON.stringify(a) === JSON.stringify(b), 'the same input yields byte-identical output');
}

// ── 9. the first engine to adopt the contract: pop-seller ────────────────────
{
  const pop = require('../pop-seller.js');
  ok(typeof pop.verdict === 'function', 'pop-seller exposes verdict()');
  ok(typeof pop.scanPoP === 'function' && typeof pop.popStatus === 'function',
    'MIGRATION IS ADDITIVE — every pre-existing export survives');

  const v = pop.verdict();
  ok(v.status === 'abstain', 'with no measured reliability, pop-seller ABSTAINS');
  ok(v.score === null && v.confidence === null, 'an abstaining engine emits null, never 0');
  ok(V.weightOf(v) === 0 && V.isVetoOnly(v), 'it carries zero weight — it may veto, never drive');
  ok(/probability/i.test(v.abstainReason), 'and it says WHY: it publishes nothing but probabilities');

  // NO PROBABILITY VALUE crosses the verdict surface. Note carefully: the rule forbids
  // publishing the NUMBER, not the WORD. `limitations` must be free to explain what PoP is
  // and why it is not what a reader assumes — that explanation is the point of the field.
  // An earlier version of this test banned the substring and failed on its own prose.
  const flat = JSON.stringify(v);
  for (const k of ['pop', 'popCE', 'popPE', 'combinedPoP', 'delta', 'premium', 'strike']) {
    ok(!(k in v), `the verdict carries no '${k}' field — no probability value is published`);
  }
  ok(v.evidence.length === 0,
    'and none is smuggled through evidence[] either — the whole surface is silent on probability');
  const numbers = flat.match(/:\s*-?\d+(\.\d+)?/g) || [];
  ok(!numbers.some((s) => { const x = parseFloat(s.slice(1)); return x > 1 && x <= 100; }),
    'no bare 1..100 number appears anywhere in the verdict — a PoP would have to look like one');
  for (const verb of V.FORBIDDEN_DECISION_VALUES) {
    ok(!flat.toUpperCase().includes(`"${verb}"`), `the verdict carries no '${verb}' — scanPoP's SELL_CE stays internal`);
  }

  ok(v.limitations.length >= 6, 'it confesses its limitations rather than hiding them');
  ok(v.limitations.some((l) => /risk-neutral/.test(l)),
    'including that PoP is risk-neutral, not real-world — the VRP is exactly the difference');
  ok(v.limitations.some((l) => /SYNTHESISED|synthesis/i.test(l)),
    'and that it invents an IV when the chain is silent');
  ok(v.assumptions.iv_when_chain_is_silent.includes('not observed'),
    'the synthesised IV is named as an assumption, not passed off as data');
  ok(v.assumptions.oi_unit === 'UNVERIFIED', 'unverified constants are labelled UNVERIFIED, never omitted');

  // reliability is INJECTED. An engine may not grade its own homework.
  const measured = pop.verdict({ reliability: 0.62, sampleSize: 200 });
  ok(measured.status === 'ok' && measured.reliability === 0.62, 'a measured reliability unlocks an ok verdict');
  ok(V.weightOf(measured) === 0.62, 'and only then does the engine carry weight');
  ok(measured.score === null,
    'even then score stays null: pop-seller sells both sides and holds NO directional view');
  ok(JSON.stringify(pop.verdict()) === JSON.stringify(pop.verdict()),
    'verdict() is deterministic — it reads no clock');
}

// ── 10. performance — build() sits on every engine's hot path ────────────────
// Threshold is generous on purpose: this catches an order-of-magnitude regression (someone
// adding a deep clone or a JSON round-trip inside build()), not a 10% drift on a busy laptop.
{
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 20000; i++) V.build(base);
  const per = Number(process.hrtime.bigint() - t0) / 20000 / 1000;   // µs
  ok(per < 50, `build() costs ${per.toFixed(2)} µs — validation is cheap enough to never be skipped`);
  ok(V.weightOf(V.build(base)) === 0, 'and it still returns the right answer after 20k calls');
}

// ── 11. memory — the module retains nothing ──────────────────────────────────
{
  // Deterministic first: engine-verdict has no registry, no cache, no module-level state.
  // The only way it could leak is by holding a reference to what it builds. It cannot: it
  // returns a frozen object and keeps none.
  eq(Object.keys(V).sort().join(','),
    'FORBIDDEN_DECISION_KEYS,FORBIDDEN_DECISION_VALUES,STATUSES,VerdictContractError,abstain,build,isVetoOnly,weightOf',
    'the module exports functions and constants only — no mutable container to accumulate in');
  ok(Object.isFrozen(V.STATUSES) && Object.isFrozen(V.FORBIDDEN_DECISION_VALUES),
    'and its constants are frozen, so no caller can grow them');

  if (typeof global.gc === 'function') {
    global.gc();
    const base0 = process.memoryUsage().heapUsed;
    for (let i = 0; i < 100000; i++) V.build(base);
    global.gc();
    const grown = process.memoryUsage().heapUsed - base0;
    ok(grown < 4 * 1024 * 1024,
      `100k verdicts retained ${(grown / 1048576).toFixed(1)} MB — nothing is held`);
  } else {
    console.log('  (heap assertion skipped: run with --expose-gc to measure retention)');
  }
}

// ── 12. rollback validation — the change is purely additive ──────────────────
{
  // Reverting the commit that introduced this module means deleting one file and one
  // `verdict()` method. Nothing downstream depends on either, so the revert cannot break a
  // caller. This asserts that property rather than assuming it.
  const pop = require('../pop-seller.js');
  for (const fn of ['scanPoP', 'buildIronCondor', 'payoffCurve', 'sellPoP', 'closePoP',
    'getBook', 'popStatus', 'lotSize', 'daysToExpiry', 'realPoP', 'bsDelta']) {
    eq(typeof pop[fn], 'function', `ROLLBACK: pre-existing export \`${fn}\` is untouched`);
  }
  ok(!('decision' in pop), 'ROLLBACK: no new required field was added to any existing surface');
  const st = pop.popStatus();
  ok('openPositions' in st && 'liveEnabled' in st,
    'ROLLBACK: popStatus keeps the shape its existing callers read');
}

console.log(`\n${n} assertions passed`);
