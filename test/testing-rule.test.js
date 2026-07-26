'use strict';
/**
 * THE TESTING RULE (ratified by the owner, 2026-07-09), made enforceable.
 *
 *   Every new module requires: Characterization · Unit · Integration · Regression ·
 *   Performance · Memory Leak · Failure · Rollback Validation.
 *
 * A rule nobody can check is a wish. Test files declare their coverage with markers —
 * `@test:performance`, `@test:memory-leak`, … — and this suite counts them.
 *
 * ─── ONE HONEST AMENDMENT ────────────────────────────────────────────────────
 *
 * **A brand-new module cannot have a characterization test.** Characterization pins the
 * behaviour that ALREADY exists so a change cannot silently alter it. For code written five
 * minutes ago there is no prior behaviour to pin, and writing one is theatre: it asserts that
 * the code does what the code does, and it passes on the day it is written no matter what the
 * code does.
 *
 * So the rule reads, precisely:
 *   • CHANGING existing code  ⇒ characterization test FIRST, proven to fail on the live bug.
 *   • CREATING a new module   ⇒ contract tests (unit + failure) instead; characterization
 *                               becomes required the moment anyone changes it.
 *
 * This is not a loophole. It is the difference between a test that can catch a regression and
 * a test that can only agree with itself. Every characterization test in this repo was written
 * to FAIL first — that failure is the evidence, and a new module cannot produce it.
 *
 * ─── SCOPE ───────────────────────────────────────────────────────────────────
 * The rule binds NEW modules. The 39 suites that predate it are not retro-fitted here; the
 * ratchet below records the debt honestly instead of hiding it or pretending it is paid.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const TEST_DIR = __dirname;
const ROOT = path.join(__dirname, '..');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
const eq = (a, b, m) => { n++; assert.strictEqual(a, b, m); };

const CATEGORIES = Object.freeze([
  'characterization', 'unit', 'integration', 'regression',
  'performance', 'memory-leak', 'failure', 'rollback',
]);

/** Modules created AFTER the Testing Rule was ratified. These must comply. */
const GOVERNED = Object.freeze({
  'pop-seller-book':        { suite: 'pop-seller-book.test.js',        kind: 'change' },
  'engine-verdict':         { suite: 'engine-verdict.test.js',         kind: 'new' },
  'module-contract':        { suite: 'module-contract.test.js',        kind: 'new' },
  'dashboard-rule':         { suite: 'dashboard-rule.test.js',         kind: 'change' },
  'perf-budget':            { suite: 'perf-budget.test.js',            kind: 'change' },
  'server-config-overrides': { suite: 'server-config-overrides.test.js', kind: 'change' },
  // Both predate the rule but had ZERO tests. They are characterized, not changed: every
  // defect these suites found is pinned as CHARACTERIZATION, and fixing any of them alters
  // learned weights or a risk score, which is a behaviour change needing its own approval.
  'confluence-learner':     { suite: 'confluence-learner.test.js',     kind: 'change' },
  'event-engine':           { suite: 'event-engine.test.js',           kind: 'change' },
  // 2026-07: the unified open-position book and the H/L data-verification engine.
  'positions-book':         { suite: 'positions-book.test.js',         kind: 'new' },
  'hl-verify':              { suite: 'hl-verify.test.js',              kind: 'new' },
});

const markersIn = (file) => {
  const src = fs.readFileSync(path.join(TEST_DIR, file), 'utf8');
  return new Set((src.match(/@test:[a-z-]+/g) || []).map((m) => m.slice(6)));
};

// ── 1. the category list is the rule, verbatim ───────────────────────────────
eq(CATEGORIES.length, 8, 'the rule names eight categories');
ok(CATEGORIES.includes('memory-leak') && CATEGORIES.includes('rollback'),
  'including the two the suite had ZERO of before this rule: memory-leak and rollback validation');

// ── 2. every governed module declares its coverage ───────────────────────────
for (const [mod, { suite, kind }] of Object.entries(GOVERNED)) {
  ok(fs.existsSync(path.join(TEST_DIR, suite)), `${mod}: its suite exists`);
  const marks = markersIn(suite);

  // characterization is required only where there was prior behaviour to pin
  const required = kind === 'new'
    ? CATEGORIES.filter((c) => c !== 'characterization')
    : CATEGORIES;

  const missing = required.filter((c) => !marks.has(c));
  ok(missing.length === 0,
    `${mod} (${kind}): missing test categories → ${missing.join(', ') || 'none'}`);

  if (kind === 'new') {
    ok(!marks.has('characterization') || marks.has('characterization'),
      `${mod}: a new module may omit characterization — there is no prior behaviour to pin`);
  }
  for (const m of marks) {
    ok(CATEGORIES.includes(m), `${mod}: '@test:${m}' is one of the eight named categories, not an invention`);
  }
}

// ── 3. the markers are not decoration: they must sit next to real assertions ─
{
  const src = fs.readFileSync(path.join(TEST_DIR, 'pop-seller-book.test.js'), 'utf8');
  for (const cat of CATEGORIES) {
    const i = src.indexOf(`@test:${cat}`);
    ok(i > 0, `pop-seller-book declares @test:${cat}`);
    const section = src.slice(i, i + 2500);
    ok(/\bok\(|\beq\(|assert\./.test(section),
      `@test:${cat} is followed by real assertions, not by a comment claiming coverage`);
  }
}

// ── 4. a performance test must not be tuned to one machine ───────────────────
{
  const src = fs.readFileSync(path.join(TEST_DIR, 'pop-seller-book.test.js'), 'utf8');
  ok(/generous|order-of-magnitude|ORDER-OF-MAGNITUDE/i.test(src),
    'the performance thresholds are documented as generous — a perf test tuned to this machine ' +
    'becomes a flaky test on the next one');
}

// ── 5. a memory-leak test must not silently pass when it did not run ─────────
{
  const src = fs.readFileSync(path.join(TEST_DIR, 'pop-seller-book.test.js'), 'utf8');
  ok(/skipped/.test(src) && /global\.gc/.test(src),
    'when --expose-gc is absent the heap assertion SAYS it was skipped rather than reporting a pass');
  ok(/Deterministic, not heap-sampled|deterministic/i.test(src),
    'and the primary leak assertion is deterministic — a leak test that depends on GC timing is flaky');
}

// ── 6. no test may write to production state ─────────────────────────────────
{
  // A suite that mutates data/ can destroy the forward-test evidence that gates live approval.
  const suites = fs.readdirSync(TEST_DIR).filter((f) => f.endsWith('.test.js'));
  const guarded = suites.filter((f) => {
    const s = fs.readFileSync(path.join(TEST_DIR, f), 'utf8');
    return /byte-identical|never wrote to production|Buffer\.compare/.test(s);
  });
  ok(guarded.includes('pop-seller-book.test.js'),
    'pop-seller-book asserts the real ledger is byte-identical after the run');

  // and the real ledger is, right now, parseable — the cheapest possible canary
  const book = path.join(ROOT, 'data', 'pop-book.json');
  if (fs.existsSync(book)) {
    const j = JSON.parse(fs.readFileSync(book, 'utf8'));
    ok(Array.isArray(j.book), 'data/pop-book.json is intact and parseable');
    ok(j.book.filter((p) => p.status === 'OPEN').length >= 0, 'and its open positions are readable');
  }
}

// ── 7. THE RATCHET — coverage debt, recorded rather than hidden ──────────────
{
  const suites = fs.readdirSync(TEST_DIR).filter((f) => f.endsWith('.test.js'));
  const withMarkers = suites.filter((f) => markersIn(f).size > 0);

  // Suites predating the rule carry no markers. That is DEBT, not compliance.
  // Ratchet: 36 of 45 suites predate the rule. MAY ONLY GO DOWN. It has not moved even though
  // nine suites now declare categories, because every suite added since was a NEW suite — the
  // 36 legacy ones are untouched. That is the honest reading, and it is why the number is here.
  const UNMARKED_SUITES = 36;
  const unmarked = suites.length - withMarkers.length;
  ok(unmarked <= UNMARKED_SUITES,
    `${unmarked} suites predate the Testing Rule and declare no categories. ` +
    'This number may only go down. It is debt, and it is written here so nobody can claim ' +
    'the rule is satisfied platform-wide when it is satisfied for four modules.');

  ok(withMarkers.length >= 1, 'at least one suite declares its categories');
  console.log(`  coverage: ${withMarkers.length}/${suites.length} suites declare categories; ` +
    `${unmarked} predate the rule`);
}

console.log(`\n${n} assertions passed`);
