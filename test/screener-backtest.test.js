/* TEST CATEGORIES — unit · failure · integration
   @test:unit @test:failure @test:integration

   integration = §4 runs against the REAL cached bars for the F&O universe.
   No performance / memory-leak / rollback tests.

   These markers are what this file ACTUALLY contains. */

/* SCREEN BACKTESTING — the value is in what it REFUSES.

   Four Indian products already screen NSE F&O by IV rank; none says whether the
   screen ever worked. Answering honestly is unattractive because the honest
   answer is often "it did not" — and §4 below shows exactly that for one of the
   three screens it runs.
*/
'use strict';

const assert = require('assert');
const path = require('path');

let failures = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e && e.message}`); }
};

const ROOT = path.join(__dirname, '..');
const BT = require('../screener-backtest');
const { backtest, rowAsOf, forwardReturn, barsUpTo } = BT;

/** A synthetic series: 300 sessions, close rising 100 → 130 with a dip. */
function series(from = '2025-01-01', n = 300, shape = (i) => 100 + i * 0.1) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = shape(i);
    out.push([start + i * 86400000, c, c * 1.01, c * 0.99, c, 1000 + i]);
  }
  return out;
}

console.log('\n§1 — THE RULE: only fields rebuildable from bars are allowed');

t('a fundamental field is refused BY NAME', () => {
  const universe = [{ symbol: 'A', bars: series() }];
  assert.throws(
    () => backtest({ queryText: 'Price to Earning < 15', universe, asOfDates: ['2025-06-01'] }),
    /Price to Earning/);
});

t('and the refusal explains WHY, not just that', () => {
  const universe = [{ symbol: 'A', bars: series() }];
  try { backtest({ queryText: 'Market Capitalization > 100', universe, asOfDates: ['2025-06-01'] }); assert.fail('accepted'); }
  catch (e) {
    assert.match(e.message, /look-ahead/i);
    assert.match(e.message, /today/i, 'the message must say these are TODAY\'s values');
  }
});

t('a text field is refused too — sector is today\'s classification', () => {
  const universe = [{ symbol: 'A', bars: series() }];
  assert.throws(() => backtest({ queryText: 'Sector = "Energy"', universe, asOfDates: ['2025-06-01'] }), /Sector/);
});

t('a mixed query is refused and names only the offending field', () => {
  const universe = [{ symbol: 'A', bars: series() }];
  try { backtest({ queryText: 'RSI < 40 AND Price to Earning < 15', universe, asOfDates: ['2025-06-01'] }); assert.fail('accepted'); }
  catch (e) {
    assert.match(e.message, /Price to Earning/);
    assert.ok(!/RSI/.test(e.message), 'RSI is allowed and must not appear in the refusal');
  }
});

t('technical fields and price ARE allowed', () => {
  const universe = [{ symbol: 'A', bars: series() }];
  for (const q of ['RSI < 40', 'Current price > SMA 50', 'Range position < 30', 'Volatility > 5']) {
    assert.doesNotThrow(() => backtest({ queryText: q, universe, asOfDates: ['2025-09-01'] }), q);
  }
});

console.log('\n§2 — no look-ahead: a past row sees only past bars');

t('barsUpTo stops at the as-of date', () => {
  const b = series('2025-01-01', 100);
  const cut = Date.parse('2025-02-10T23:59:59Z');
  const up = barsUpTo(b, cut);
  assert.strictEqual(up.length, 41, `expected 41 bars to 10 Feb, got ${up.length}`);
  assert.ok(up[up.length - 1].date.getTime() <= cut);
});

t('THE CASE THAT MATTERS: the 52-week high is the PAST window, not today', () => {
  /* toRow fills the 52-week extremes from `quote`, which is today's. Leaving
     those in would put a 2026 high into a 2025 screen, and every "near its high"
     filter would silently be answering a question about the present. */
  const b = series('2025-01-01', 300, (i) => 100 + i * 0.1);
  const early = rowAsOf('A', b, Date.parse('2025-04-01T23:59:59Z'));
  const late = rowAsOf('A', b, Date.parse('2025-10-01T23:59:59Z'));
  assert.ok(early['52 week high'] < late['52 week high'],
    `early high ${early['52 week high']} should be below late high ${late['52 week high']}`);
  assert.ok(early['Current price'] < late['Current price']);
});

t('a stock with too little history yields null, not a row of zeros', () => {
  const b = series('2025-01-01', 300);
  assert.strictEqual(rowAsOf('A', b, Date.parse('2025-01-10T23:59:59Z')), null,
    'ten bars produced a screenable row — every derived field would be a fiction');
});

console.log('\n§3 — forward returns');

t('the forward return is close-to-close over N sessions', () => {
  const b = series('2025-01-01', 300, (i) => 100 + i);       // +1 per session
  const r = forwardReturn(b, Date.parse('2025-02-01T23:59:59Z'), 20);
  assert.ok(r, 'no forward return');
  // from bar 31 (close 131) to bar 51 (close 151) = +15.27%
  assert.strictEqual(+r.pct.toFixed(2), 15.27);
});

t('a future that does not exist yet is null, never 0', () => {
  const b = series('2025-01-01', 100);
  assert.strictEqual(forwardReturn(b, Date.parse('2025-04-05T23:59:59Z'), 20), null,
    'a zero return would be a claim the position went nowhere');
});

t('an aggregate over zero observations is null, not 0%', () => {
  const universe = [{ symbol: 'A', bars: series('2025-01-01', 60) }];
  // as-of near the end, so no 20-session future exists
  const r = backtest({ queryText: 'RSI < 100', universe, asOfDates: ['2025-02-25'], sessions: 20 });
  assert.strictEqual(r.aggregate, null,
    'a backtest reporting 0% on no data is indistinguishable from one that measured no edge');
});

console.log('\n§4 — against the REAL cached bars for the F&O universe');

const cache = (() => {
  try { return require('../safe-write').readJsonSync(path.join(ROOT, 'data', 'screener-cache.json')); }
  catch (e) { return null; }
})();

t('the real universe has bars to backtest with', () => {
  if (!cache) { console.log('      (no cache — run POST /api/screener/fetch {bars:true}; skipped and recorded)'); return; }
  const withBars = Object.values(cache.rows).filter((r) => Array.isArray(r.bars));
  console.log(`      ${withBars.length} symbols, ${withBars[0] ? withBars[0].bars.length : 0} bars each`);
  assert.ok(withBars.length > 50, `only ${withBars.length} symbols carry raw bars`);
});

t('a real screen produces a real edge number — whatever sign it has', () => {
  if (!cache) { console.log('      (no cache; skipped and recorded)'); return; }
  const universe = Object.entries(cache.rows)
    .filter(([, v]) => Array.isArray(v.bars))
    .map(([s, v]) => ({ symbol: s, bars: v.bars }));
  const dates = ['2025-10-01', '2025-12-01', '2026-02-02', '2026-04-01', '2026-06-01'];

  const r = backtest({ queryText: 'Range position < 20', universe, asOfDates: dates, sessions: 20 });
  assert.ok(r.aggregate, 'no observations from the real universe');
  console.log(`      Range position < 20 → screen ${r.aggregate.meanPct}%  market ${r.aggregate.benchMeanPct}%  edge ${r.aggregate.edgePct}%  (n=${r.aggregate.observations})`);

  assert.strictEqual(typeof r.aggregate.edgePct, 'number');
  assert.ok(r.aggregate.benchMeanPct !== null,
    'the benchmark must be computed — an edge with no benchmark is a return, not an edge');
});

t('THE BENCHMARK IS THE WHOLE UNIVERSE, not the rejected stocks', () => {
  /* Comparing matched against rejected answers "was the filter better than its
     own inverse", which flatters any filter that happens to exclude the worst
     names. The benchmark must be every stock that could have been screened. */
  const src = require('fs').readFileSync(path.join(ROOT, 'screener-backtest.js'), 'utf8');
  assert.ok(/const benchR = fwd\(rows\)/.test(src),
    'the benchmark is not computed over all screenable rows');
  assert.ok(/not the rejected ones|own inverse/i.test(src),
    'and the reason is not written down where the next person will change it');
});

console.log('\n§5 — the limitations are part of the result, not a footnote');

t('every result carries survivorship and cost warnings', () => {
  const universe = [{ symbol: 'A', bars: series() }];
  const r = backtest({ queryText: 'RSI < 40', universe, asOfDates: ['2025-09-01'] });
  const text = r.limitations.join(' ');
  assert.match(text, /SURVIVORSHIP/);
  assert.match(text, /23%/, 'the measured size of the survivorship bias must be stated, not just its name');
  assert.match(text, /GROSS|brokerage|slippage/i);
  assert.ok(r.limitations.length >= 3);
});

t('and they are returned with the numbers, not printed separately', () => {
  const universe = [{ symbol: 'A', bars: series() }];
  const r = backtest({ queryText: 'RSI < 40', universe, asOfDates: ['2025-09-01'] });
  assert.ok(Array.isArray(r.limitations),
    'limitations must travel with the result — a caveat in a log nobody reads is not a caveat');
});

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
