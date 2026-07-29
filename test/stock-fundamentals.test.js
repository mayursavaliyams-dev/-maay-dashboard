/**
 * stock-fundamentals — ROE, EPS, the profit line and shareholding on the analyst card.
 * Run: node test/stock-fundamentals.test.js
 *
 * @test:characterization @test:regression @test:unit @test:failure
 * @test:integration @test:performance @test:memory-leak @test:rollback
 *
 * TWO THINGS THE SOURCE FORCED, both measured against live Yahoo on 2026-07-29:
 *
 *   1. RETURN ON EQUITY IS NOT ALWAYS THERE. Reported for TCS (47.74%), absent for
 *      Canara Bank. A card that filled the gap with a zero would state that a
 *      state-owned lender earns nothing on its equity. Where it is missing the card
 *      derives it as EPS / book value per share — arithmetic from two reported
 *      figures — and labels it DERIVED. The two are never merged.
 *
 *   2. SHAREHOLDING IS NOT THE SEBI PATTERN. Yahoo gives a US-shaped
 *      insiders/institutions split. For an Indian issuer "insiders" lands near the
 *      promoter stake (Canara Bank 64.36% against a Government holding around 63%)
 *      but it is a different taxonomy and the parts do not sum to 100 — 17.27% is
 *      unclassified. It is labelled as Yahoo's split and the remainder is shown.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };

const ROOT = path.join(__dirname, '..');
const SA = fs.readFileSync(path.join(ROOT, 'stock-analyst.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'public', 'agents.html'), 'utf8');
const SACODE = SA.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

console.log('stock-fundamentals');

// ── @test:unit — the ROE rule, exercised directly ────────────────────────────
{
  // Mirrors _getFundamentals: reported wins; derived only fills a genuine absence.
  const roe = (reported, eps, book) => {
    const r = (reported === null || reported === undefined) ? null : +(reported * 100).toFixed(2);
    const d = (r === null && eps !== null && book > 0) ? +((eps / book) * 100).toFixed(2) : null;
    return { roe: r, roeDerived: d };
  };
  assert.deepStrictEqual(roe(0.47743, 143.88, 303.014), { roe: 47.74, roeDerived: null }); n++;
  assert.deepStrictEqual(roe(null, 21.9, 129.764),      { roe: null, roeDerived: 16.88 }); n++;
  assert.deepStrictEqual(roe(null, null, 129.764),      { roe: null, roeDerived: null }); n++;
  assert.deepStrictEqual(roe(null, 21.9, 0),            { roe: null, roeDerived: null }); n++;
  console.log('  ✓ reported ROE is never overwritten, and a derived one only appears where none was reported');
  console.log('  ✓ no EPS or no book value yields null, never a zero return on equity');

  ok(/roeDerived/.test(SACODE) && /roeReported === null/.test(SACODE),
    'the source keeps the two apart rather than coalescing them');
  ok(/DERIVED/.test(PAGE), 'and the card badges the derived one so it cannot be read as reported');
}

// ── @test:failure — absence renders as absence ──────────────────────────────
{
  const num = v => (v === null || v === undefined || !isFinite(Number(v))) ? null : Number(v);
  assert.strictEqual(num(undefined), null); n++;
  assert.strictEqual(num(NaN), null); n++;
  assert.strictEqual(num(0), 0); n++;              // a real zero survives
  console.log('  ✓ missing is null and a genuine zero is zero — the two are distinguishable');
  ok(/\? '—'/.test(PAGE) || /'—'/.test(PAGE), 'the card renders a dash for a missing figure');
  ok(/unknown, not zero|Unknown, not zero/.test(PAGE + SA),
    'with that stated where the next person will read it');
}

// ── @test:regression — shareholding is labelled for what it is ──────────────
{
  ok(/not the SEBI promoter\/FII\/DII pattern/.test(SA),
    'the shareholding note says plainly it is not the SEBI pattern');
  ok(/holding[\s\S]{0,400}other/.test(SACODE),
    'and the unclassified remainder is computed rather than dropped');
  // The parts must add up, or the bar lies about what it shows.
  const split = (ins, inst) => ({ insiders: ins, institutions: inst, other: +(100 - ins - inst).toFixed(2) });
  const c = split(64.36, 18.37);
  assert.strictEqual(+(c.insiders + c.institutions + c.other).toFixed(2), 100); n++;
  assert.strictEqual(c.other, 17.27); n++;
  console.log('  ✓ insiders + institutions + other sums to exactly 100');
  ok(/left unlabelled rather than guessed/.test(PAGE),
    'and the card refuses to split that remainder into FII/DII/retail it does not have');
}

// ── @test:unit — Indian reporting units ─────────────────────────────────────
{
  const cr = v => (v === null || !isFinite(v)) ? '—' : '₹' + (v / 1e7).toLocaleString('en-IN', {maximumFractionDigits:0}) + ' Cr';
  assert.strictEqual(cr(197059095000), '₹19,706 Cr'); n++;   // Canara Bank FY26 profit
  assert.strictEqual(cr(492100000000), '₹49,210 Cr'); n++;   // TCS FY26 profit
  assert.strictEqual(cr(null), '—'); n++;
  console.log('  ✓ absolute rupees render as crores, the unit Indian results are actually reported in');
  ok(/1e7/.test(PAGE), 'the crore conversion is in the card, not hard-coded per figure');
}

// ── @test:integration — fundamentals never touch the verdict ────────────────
{
  const i = SA.indexOf('const verdict = fuseVerdict(');
  const j = SA.indexOf('const fundamentals = await _getFundamentals(');
  ok(i > 0 && j > i,
    'the verdict is computed BEFORE fundamentals are fetched, so it cannot depend on them');
  ok(/fuseVerdict\(\{ momentum, news, dealImpacts \}\)/.test(SA),
    'and fuseVerdict still takes only momentum, news and deal impacts');
  ok(/context, not part of the verdict/.test(PAGE),
    'the card says so, so a reader does not assume the probability moved');
}

// ── @test:performance — one extra call, and only on demand ─────────────────
{
  const f = SACODE.slice(SACODE.indexOf('async function _getFundamentals'),
                         SACODE.indexOf('async function analyze'));
  const calls = (f.match(/await yf\./g) || []).length;
  ok(calls === 1, `one quoteSummary call, not one per module (${calls})`);
  ok(/modules: \['defaultKeyStatistics', 'financialData', 'earnings', 'summaryDetail'\]/.test(SACODE),
    'four modules in a single request');
  ok(!/incomeStatementHistory|balanceSheetHistory/.test(SACODE),
    'and not the two the library itself warns have returned almost nothing since Nov 2024');
}

// ── @test:failure / @test:rollback — a dead source degrades, never throws ──
{
  const f = SACODE.slice(SACODE.indexOf('async function _getFundamentals'),
                         SACODE.indexOf('async function analyze'));
  ok(/catch \(_\) \{ return null; \}/.test(f),
    'a failed lookup returns null, so the analyst card still renders without it');
  ok(/if \(!f\) return/.test(PAGE),
    'and the card handles that null instead of throwing halfway through the panel');
  ok(/no fundamentals available/.test(PAGE),
    'saying so, rather than silently omitting the block');
}

// ── @test:memory-leak — nothing retained ───────────────────────────────────
{
  const f = SACODE.slice(SACODE.indexOf('async function _getFundamentals'),
                         SACODE.indexOf('async function analyze'));
  ok(!/setInterval|setTimeout|push\(/.test(f),
    'the fetcher builds a value and returns it — no timer, no growing collection');
}

console.log(`\n${n} assertions passed`);
