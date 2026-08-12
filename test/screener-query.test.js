/* TEST CATEGORIES — unit · failure · integration
   @test:unit @test:failure @test:integration

   integration = §5 builds rows from a REAL yahoo payload shape and runs a real
   Screener.in query verbatim. No performance / memory-leak / rollback tests.

   These markers are what this file ACTUALLY contains. */

/* SCREENER-STYLE QUERIES — parsed, never evaluated.

   The query text in §5 is copied verbatim from a published Screener.in screen
   rather than invented here, so the parser is tested against the language people
   actually write instead of against the language I found convenient to parse.
*/
'use strict';

const assert = require('assert');
const path = require('path');

let failures = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e && e.message}`); }
};

const { parse, run, screen, QueryError } = require('../screener-query');
const F = require('../screener-fields');
const NAMES = F.fieldNames();

const rows = [
  { symbol: 'A', 'Price to Earning': 10, 'Market Capitalization': 50000, 'Debt to equity': 20, 'Dividend yield': 2 },
  { symbol: 'B', 'Price to Earning': 40, 'Market Capitalization': 90000, 'Debt to equity': 10, 'Dividend yield': 0.5 },
  { symbol: 'C', 'Price to Earning': null, 'Market Capitalization': 70000, 'Debt to equity': 5, 'Dividend yield': 3 },
  { symbol: 'D', 'Price to Earning': 8, 'Market Capitalization': 200, 'Debt to equity': null, 'Dividend yield': 1 },
];
const syms = (list) => list.map((r) => r.symbol).sort().join(',');

console.log('\n§1 — the grammar');

t('a Screener-shaped AND query filters', () => {
  const r = screen('Price to Earning < 15 AND Market Capitalization > 10000', rows, NAMES);
  assert.strictEqual(syms(r.matched), 'A');
  assert.strictEqual(r.counts.total, 4);
});

t('OR works — Screener does not document it, so we own the semantics', () => {
  const r = screen('Price to Earning < 15 OR Debt to equity < 8', rows, NAMES);
  assert.strictEqual(syms(r.matched), 'A,C,D');
});

t('parentheses override precedence, and NOT binds tightest', () => {
  const flat = screen('Debt to equity < 8 OR Price to Earning < 15 AND Market Capitalization > 10000', rows, NAMES);
  const paren = screen('(Debt to equity < 8 OR Price to Earning < 15) AND Market Capitalization > 10000', rows, NAMES);
  assert.strictEqual(syms(flat.matched), 'A,C', 'AND must bind tighter than OR');
  assert.strictEqual(syms(paren.matched), 'A,C', 'C: D/E 5 < 8 and mcap 70000 > 10000');
  const not = screen('NOT Price to Earning < 15', rows, NAMES);
  assert.strictEqual(syms(not.matched), 'B');
});

t('arithmetic between fields is allowed', () => {
  const r = screen('Market Capitalization / Price to Earning > 4000', rows, NAMES);
  // A: 50000/10 = 5000 ✓   B: 90000/40 = 2250 ✗   D: 200/8 = 25 ✗   C: PE null
  assert.strictEqual(syms(r.matched), 'A');
});

t('field names match longest-first, so a short name cannot shadow a long one', () => {
  // 'Price' is an alias of Current price; 'Price to Earning' must still win.
  const ast = parse('Price to Earning > 1', NAMES);
  assert.strictEqual(ast.left.v, 'Price to Earning',
    `parsed as ${JSON.stringify(ast.left.v)} — a shorter name shadowed a longer one`);
});

t('a field name is not matched inside a longer word', () => {
  assert.throws(() => parse('Priceless > 1', NAMES), /unknown field/);
});

t('a field name that STARTS WITH A DIGIT is reachable', () => {
  /* MEASURED 2026-08-10 against live data. With the number branch tried first,
       Current price > 52 week low * 1.5
     failed with `unknown field "week"`: the tokenizer ate `52` as a number and
     then met a bare word. Every field beginning with a digit was unreachable —
     which is `52 week low` and `52 week high`, the two commonest range fields. */
  const ast = parse('Current price > 52 week low * 1.5', NAMES);
  assert.strictEqual(ast.k, 'cmp');
  assert.strictEqual(ast.right.left.v, '52 week low',
    'the range field was not tokenised as a field');

  const r = screen('Current price > 52 week low * 1.5',
    [{ symbol: 'UP', 'Current price': 200, '52 week low': 100 },
     { symbol: 'FLAT', 'Current price': 120, '52 week low': 100 }], NAMES);
  assert.strictEqual(syms(r.matched), 'UP');
});

t('and a bare number is still a number', () => {
  // The text after `52` does not continue " week low", so no field matches.
  const r = screen('Price to Earning < 52', [{ symbol: 'A', 'Price to Earning': 10 }], NAMES);
  assert.strictEqual(syms(r.matched), 'A');
  const ast = parse('Price to Earning < 52', NAMES);
  assert.strictEqual(ast.right.k, 'num');
  assert.strictEqual(ast.right.v, 52);
});

t('operators >= <= = != all parse and evaluate', () => {
  assert.strictEqual(syms(screen('Price to Earning >= 10 AND Price to Earning <= 40', rows, NAMES).matched), 'A,B');
  assert.strictEqual(syms(screen('Dividend yield = 3', rows, NAMES).matched), 'C');
  assert.strictEqual(syms(screen('Dividend yield != 3 AND Dividend yield > 0', rows, NAMES).matched), 'A,B,D');
});

console.log('\n§2 — THE DECISION: a missing value is UNEVALUABLE, never rejected');

t('a stock missing the field is unevaluable, and the field is named', () => {
  const r = screen('Price to Earning < 15', rows, NAMES);
  assert.strictEqual(syms(r.matched), 'A,D');
  assert.strictEqual(syms(r.rejected), 'B');
  assert.strictEqual(syms(r.unevaluable), 'C');
  assert.deepStrictEqual(r.unevaluable[0].missing, ['Price to Earning'],
    'the unevaluable stock must say WHICH field it lacked');
});

t('the three sets are disjoint and account for every row', () => {
  const r = screen('Price to Earning < 15 AND Debt to equity < 15', rows, NAMES);
  assert.strictEqual(r.counts.matched + r.counts.rejected + r.counts.unevaluable, r.counts.total);
  const all = [...r.matched, ...r.rejected, ...r.unevaluable].map((x) => x.symbol);
  assert.strictEqual(new Set(all).size, all.length, 'a row appeared in two sets');
});

t('KLEENE: false AND missing is REJECTED, because the answer is already known', () => {
  /* B fails the PE test outright. Whatever its missing field turns out to be, it
     cannot pass — so calling it unevaluable would overstate our ignorance. */
  const r = screen('Price to Earning < 5 AND Debt to equity < 15', rows, NAMES);
  assert.ok(r.rejected.some((x) => x.symbol === 'D'),
    'D has PE 8 which fails < 5, so its null D/E cannot change the answer');
  assert.ok(!r.unevaluable.some((x) => x.symbol === 'D'));
});

t('KLEENE: true AND missing is UNEVALUABLE, because it genuinely could go either way', () => {
  const r = screen('Price to Earning < 15 AND Debt to equity < 15', rows, NAMES);
  assert.ok(r.unevaluable.some((x) => x.symbol === 'D'),
    'D passes the PE test and its D/E is unknown — the answer is not known');
});

t('KLEENE: true OR missing is MATCHED', () => {
  const r = screen('Market Capitalization > 100 OR Debt to equity < 1', rows, NAMES);
  assert.ok(r.matched.some((x) => x.symbol === 'D'), 'D passes on mcap; the null D/E cannot un-pass it');
});

t('a NaN in the data is missing, not a silently-false comparison', () => {
  const r = screen('Price to Earning < 15', [{ symbol: 'X', 'Price to Earning': NaN }], NAMES);
  assert.strictEqual(r.counts.unevaluable, 1);
  assert.strictEqual(r.counts.rejected, 0,
    'NaN made the comparison false and the stock was REJECTED — that is a data gap ' +
    'reported as a screening verdict, the exact defect this module exists to avoid');
});

t('a divide by zero is unknown, not Infinity', () => {
  const r = screen('Market Capitalization / Price to Earning > 1',
    [{ symbol: 'Z', 'Market Capitalization': 100, 'Price to Earning': 0 }], NAMES);
  assert.strictEqual(r.counts.unevaluable, 1);
  assert.strictEqual(r.counts.matched, 0, 'Infinity > 1 matched — a zero denominator is not a large ratio');
});

t('missingByField tallies the gap so an outage is visible as an outage', () => {
  const r = screen('Price to Earning < 15', rows, NAMES);
  assert.deepStrictEqual(r.missingByField, { 'Price to Earning': 1 });
});

console.log('\n§3 — the parser refuses rather than guesses');

t('an unknown field is refused BY NAME', () => {
  try { parse('Return on equity > 15', NAMES); assert.fail('accepted an unknown field'); }
  catch (e) {
    assert.ok(e instanceof QueryError);
    assert.strictEqual(e.word, 'Return');
  }
});

t('the registry explains WHY the famous missing ratios are missing', () => {
  for (const n of ['ROE', 'ROCE', 'Return on equity', 'Current ratio']) {
    const why = F.unavailableReason(n);
    assert.ok(why && why.length > 10, `${n} has no stated reason — "unknown field" is not an explanation`);
  }
});

t('an unbalanced parenthesis is an error, not a silent truncation', () => {
  assert.throws(() => parse('(Price to Earning < 15', NAMES), /expected \)/);
  assert.throws(() => parse('Price to Earning < 15)', NAMES), /unexpected/);
});

t('a query that is not a condition is refused', () => {
  assert.throws(() => screen('Market Capitalization', rows, NAMES), /not a condition/,
    'a bare number was treated as a filter — truthiness is not a question anyone asked');
});

t('NO eval: the parser cannot be made to execute anything', () => {
  const attacks = [
    'process.exit(1)',
    'require("fs")',
    'constructor.constructor("return 1")()',
    '1;process.exit(1)',
    '__proto__ > 1',
  ];
  for (const a of attacks) {
    assert.throws(() => parse(a, NAMES), /unknown field|unexpected|expected/,
      `${JSON.stringify(a)} parsed instead of being refused`);
  }
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'screener-query.js'), 'utf8');
  assert.ok(!/\beval\s*\(/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'screener-query.js calls eval');
  assert.ok(!/new Function/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'screener-query.js calls new Function');
});

t('__proto__ as a field name cannot reach the prototype chain', () => {
  const r = run(parse('Price to Earning < 15', NAMES), [Object.create({ 'Price to Earning': 1 })]);
  assert.strictEqual(r.counts.unevaluable, 1,
    'an inherited property was read as data — screening must see own values only');
});

console.log('\n§4 — units are declared, because a 100x error is invisible');

t('every field declares a unit and a source', () => {
  for (const f of F.FIELDS) {
    assert.ok(f.unit, `${f.name} has no unit`);
    assert.ok(f.from, `${f.name} has no source`);
    assert.strictEqual(typeof f.pick, 'function', `${f.name} has no pick`);
  }
});

t('THE TRAP: dividend yield is exposed once, from one endpoint, in one unit', () => {
  const d = F.fieldDef('Dividend yield');
  assert.strictEqual(d.unit, 'percent');
  assert.strictEqual(d.from, 'quote');
  assert.ok(/100x|100 x|fraction/i.test(d.note || ''),
    'the note must record that summaryDetail carries the same concept 100x smaller — ' +
    'that measurement is the reason this field is single-sourced');
});

t('no two fields share a name, and no alias collides with a name', () => {
  const seen = new Map();
  for (const f of F.FIELDS) {
    for (const n of [f.name, ...(f.alias || [])]) {
      const k = n.toLowerCase();
      assert.ok(!seen.has(k), `${n} is declared by both ${seen.get(k)} and ${f.name}`);
      seen.set(k, f.name);
    }
  }
});

t('fields we compute are marked as computed, and vendor fields are not', () => {
  assert.strictEqual(F.fieldDef('RSI').computed, true);
  assert.ok(!F.fieldDef('Price to Earning').computed,
    'a vendor number marked as computed hides where it came from');
});

console.log('\n§5 — a real Screener query, over a real yahoo payload shape');

t('toRow builds every declared field, null when absent', () => {
  /* The payload shape is the one measured from yahoo on 2026-08-10 for
     RELIANCE.NS — the real property names and the real magnitudes, including
     marketCap in absolute rupees, which is why the registry divides by 1e7. */
  const row = F.toRow({
    symbol: 'RELIANCE',
    quote: {
      regularMarketPrice: 1327.3, marketCap: 17961651798016, trailingPE: 24.019184,
      priceToBook: 1.9868423, epsTrailingTwelveMonths: 55.26, bookValue: 668.045,
      fiftyTwoWeekLow: 1249.8, fiftyTwoWeekHigh: 1611.8, averageDailyVolume3Month: 14829746,
      dividendYield: 0.45,
    },
    financialData: { debtToEquity: 36.653, revenueGrowth: 0.297, earningsGrowth: -0.224,
      profitMargins: 0.066149995, totalRevenue: 11296050249728, totalDebt: 3979999969280 },
    defaultKeyStatistics: { pegRatio: 0.82, enterpriseValue: 21280034127872 },
  });

  assert.strictEqual(row['Current price'], 1327.3);
  assert.strictEqual(Math.round(row['Market Capitalization']), 1796165,
    'market cap must be in crore — 17.96 lakh crore, not 1.8e13');
  assert.strictEqual(row['Price to Earning'], 24.019184);
  assert.strictEqual(row['Return on equity'], undefined, 'an unavailable ratio must not be invented');
  assert.strictEqual(row.RSI, null, 'no bars supplied, so the technical is null rather than absent');
  assert.strictEqual(row.PE, row['Price to Earning'], 'aliases resolve to the same value');
});

t('a published Screener query runs verbatim', () => {
  /* Copied from a real Screener.in screen, lower-case `and` and all. */
  const q = 'Price to book value < 2 and Price to Earning < 15 and Dividend yield > .1 '
          + 'and Debt to equity < 1 and Sales > 100';
  const ast = parse(q, NAMES);
  assert.ok(ast, 'the published query did not parse');

  const universe = [
    { symbol: 'CHEAP', 'Price to book value': 1.2, 'Price to Earning': 11, 'Dividend yield': 2, 'Debt to equity': 0.4, Sales: 5000 },
    { symbol: 'RICH',  'Price to book value': 8.0, 'Price to Earning': 60, 'Dividend yield': 0, 'Debt to equity': 0.2, Sales: 9000 },
    { symbol: 'NODATA', 'Price to book value': 1.1, 'Price to Earning': 9, 'Dividend yield': 1, 'Debt to equity': null, Sales: 400 },
  ];
  const r = run(ast, universe);
  assert.strictEqual(syms(r.matched), 'CHEAP');
  assert.strictEqual(syms(r.rejected), 'RICH');
  assert.strictEqual(syms(r.unevaluable), 'NODATA');
  assert.deepStrictEqual(r.fieldsUsed.sort(),
    ['Debt to equity', 'Dividend yield', 'Price to Earning', 'Price to book value', 'Sales']);
});

t('fieldsUsed lets a caller fetch only what the query needs', () => {
  const r = screen('RSI < 30 AND Current price > 100', [], NAMES);
  assert.deepStrictEqual(r.fieldsUsed, ['Current price', 'RSI']);
});

t('5798 rows screen without the field-sort landing inside the loop', () => {
  const big = Array.from({ length: 5798 }, (_, i) => ({ symbol: `S${i}`, 'Price to Earning': i % 60 }));
  const started = Date.now();
  const r = screen('Price to Earning < 15', big, NAMES);
  const ms = Date.now() - started;
  assert.strictEqual(r.counts.total, 5798);
  /* Generous on purpose — an order-of-magnitude guard, not a stopwatch. A perf
     threshold tuned to this machine becomes a flaky test on the next one. */
  assert.ok(ms < 3000, `screening the whole universe took ${ms}ms`);
  console.log(`      (5,798 rows in ${ms}ms)`);
});

console.log('\n§6 — text fields, IN, and type mistakes refused ONCE');

const sect = [
  { symbol: 'OIL', Sector: 'Energy', 'Price to Earning': 9 },
  { symbol: 'BANK', Sector: 'Financial Services', 'Price to Earning': 12 },
  { symbol: 'TECH', Sector: 'Technology', 'Price to Earning': 30 },
  { symbol: 'BLANK', Sector: null, 'Price to Earning': 8 },
];
const typed = { typeOf: F.typeOf };

t('a text field compares with =', () => {
  assert.strictEqual(syms(screen('Sector = "Energy"', sect, NAMES, typed).matched), 'OIL');
});

t('and the comparison is case-insensitive and trimmed', () => {
  /* The vendor writes "Energy"; a person types "energy". Making those differ
     returns an empty set that reads as "no energy stocks match", not as a typo —
     the same class of silent wrong answer as the dividend-yield unit trap. */
  for (const q of ['Sector = "energy"', 'Sector = "  ENERGY  "']) {
    assert.strictEqual(syms(screen(q, sect, NAMES, typed).matched), 'OIL', q);
  }
});

t('IN takes a list', () => {
  assert.strictEqual(syms(screen('Sector IN ("Energy", "Technology")', sect, NAMES, typed).matched), 'OIL,TECH');
});

t('a stock with no sector is UNEVALUABLE, not rejected', () => {
  const r = screen('Sector = "Energy"', sect, NAMES, typed);
  assert.strictEqual(syms(r.unevaluable), 'BLANK');
  assert.deepStrictEqual(r.unevaluable[0].missing, ['Sector']);
});

t('THE POINT OF validate(): a type mistake is refused ONCE, at the query', () => {
  /* Without it this would throw per row and produce 208 identical errors — or
     worse, return MISSING and report the author's mistake as a data outage. */
  assert.throws(() => screen('Sector > 5', sect, NAMES, typed), /Sector is text/);
  assert.throws(() => screen('Sector * 2 > 1', sect, NAMES, typed), /cannot be used in arithmetic/);
  assert.throws(() => screen('Price to Earning = "Energy"', sect, NAMES, typed), /cannot compare/);
});

t('without typeOf nothing is type-checked — it does not guess', () => {
  assert.doesNotThrow(() => parse('Sector > 5', NAMES));
});

t('an unterminated string, or an empty IN list, is an error', () => {
  assert.throws(() => parse('Sector = "Energy', NAMES), /unterminated/);
  assert.throws(() => parse('Sector IN ()', NAMES), /IN takes a list|empty/);
});

console.log('\n§7 — technical fields read the REAL shape of stock-technicals');

t('every declared technical field resolves against a real compute() output', () => {
  /* stock-technicals returns NESTED groups — movingAverages, oscillators, range,
     performance, volume. A flat `t.rsi14` is undefined for every stock, and the
     evaluator would report that as 208 stocks with missing data rather than as a
     wiring mistake. So the picks are exercised against the real function rather
     than against a shape this test invented. */
  const T = require('../stock-technicals');
  const bars = Array.from({ length: 260 }, (_, i) => ({
    date: new Date(2025, 0, 1 + i), open: 100 + i * 0.1, high: 101 + i * 0.1,
    low: 99 + i * 0.1, close: 100 + i * 0.1, volume: 1000 + i,
  }));
  const t0 = T.compute(bars);
  assert.strictEqual(t0.ok, true, 'compute declined on a clean 260-bar series');

  const row = F.toRow({ symbol: 'X', technicals: t0 });
  const computed = F.FIELDS.filter((f) => f.computed);
  assert.ok(computed.length >= 8, `only ${computed.length} computed fields declared`);
  const nulls = computed.filter((f) => row[f.name] === null).map((f) => f.name);
  assert.deepStrictEqual(nulls, [],
    'these technical fields resolved to null against a REAL compute() output, so '
    + `their pick path does not match the returned shape: ${nulls.join(', ')}`);
});

t('a compute() that declined is reported, not stored as technicals', () => {
  const T = require('../stock-technicals');
  const t0 = T.compute([{ date: new Date(), close: 100 }]);
  assert.strictEqual(t0.ok, false, 'compute accepted a single bar');
  assert.ok(t0.reason, 'and it says why, so a newly listed stock is not confused with a fetch failure');
});

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
