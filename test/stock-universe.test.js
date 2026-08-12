/**
 * stock-universe — search every listed Indian equity, and rank the answers usefully.
 * Run: node test/stock-universe.test.js
 *
 * @test:unit @test:characterization @test:regression @test:failure
 * @test:integration @test:performance @test:boundary @test:rollback
 *
 * THE DEFECT, as reported on 2026-07-30. Typing "consumer" into the Stock View box
 * returned:
 *
 *     could not resolve "consumer" to a listed stock
 *
 * The box could resolve 49 hand-listed symbols and nothing else.
 *
 * THE FIX THAT WAS REJECTED, and why it is recorded here
 *
 * The obvious replacement — the market-data vendor's own search endpoint — was
 * measured against live before being adopted, and it does not work for this market:
 *
 *     "rel"       → 7 results, 0 Indian   (no RELIANCE)
 *     "hdf"       → 7 results, 0 Indian   (no HDFCBANK)
 *     "sun"       → 7 results, 0 Indian   (no SUNPHARMA)
 *     "consumer"  → 7 results, 0 Indian
 *
 * It is US-biased. Shipping it would have produced a search box that looked fixed
 * and failed on the three largest companies anyone would type.
 *
 * TWO FILTERING TRAPS, both measured, both able to look like success
 *
 * 1. BSE does not mark equities `EQ`. It puts the SETTLEMENT GROUP in that field
 *    (A, B, T, X, XT, M, …) and its BSE_EQ segment also carries 6,525 bonds and
 *    1,120 government securities. Filtering BSE on `instrument_type === 'EQ'`
 *    returns ZERO rows — which the first version of the builder did, printing a
 *    clean successful build with 0 BSE stocks in it.
 *
 * 2. NSE's equity segment holds 9,454 rows of which only 2,412 are `EQ`. Filtering
 *    on `EQ` alone drops 402 SME equities, 286 trade-to-trade equities, 156 SME
 *    T2T, 21 InvITs, 6 REITs — and 26 suspended-group equities, one of which is
 *    SANWARIA CONSUMER LIMITED. The word that started this work.
 *
 * RANKING IS THE REST OF THE PROBLEM. Matching is easy; ordering is not. A plain
 * substring match sorted alphabetically answered "rel" with "Avax Apparels and
 * Ornaments" above RELIANCE — every result correct, the list useless.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };
const ROOT = path.join(__dirname, '..');

const code = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const U = require(path.join(ROOT, 'stock-universe.js'));
const BUILD = code('scripts/build-stock-universe.js');
const PAGE = code('public/stock.html');
const SERVER = code('server.js');
const SA = code('stock-analyst.js');

console.log('\nstock universe\n');

/* ── 1. the universe is built and large ──────────────────────────────────── */
console.log('the list');
const st = U.status();
if (!st.built) {
  console.log('  · universe not built — run: npm run build:universe');
  console.log('    skipping the data-dependent checks; the code-shape checks still run');
} else {
  ok(st.count > 4000, `${st.count.toLocaleString('en-IN')} listed symbols`);
  ok(st.counts && st.counts.NSE > 3000, `NSE contributes ${st.counts.NSE}`);
  ok(st.counts && st.counts.BSE > 4000,
    `BSE contributes ${st.counts.BSE} — filtering it on instrument_type 'EQ' returns ZERO, which looks like a clean build`);
  ok(st.counts && st.counts.fno >= 150 && st.counts.fno <= 400,
    `${st.counts.fno} of them have listed derivatives — the liquidity proxy used for ranking`);

  /* ── 2. the searches that used to fail ────────────────────────────────── */
  console.log('\nthe queries that used to return nothing');
  const first = (q) => (U.search(q, 5).results[0] || {}).symbol;
  ok(U.search('consumer').total > 0, '"consumer" now matches — the reported defect');
  ok(U.search('sanwaria').total === 1,
    'SANWARIA CONSUMER LIMITED is found — it sits in NSE group BZ, which an EQ-only filter drops');
  ok(first('rel') === 'RELIANCE', '"rel" puts RELIANCE first, not RELTD or RELAXO');
  ok(first('hdf') && /^HDFC/.test(first('hdf')), '"hdf" reaches the HDFC names');
  ok(first('sun') === 'SUNPHARMA', '"sun" puts SUNPHARMA first');
  ok(U.search('tat', 5).results.some(r => r.symbol === 'TATASTEEL'),
    '"tat" surfaces TATASTEEL in the top five');
  ok(first('tcs') === 'TCS', 'an exact symbol wins outright');

  console.log('\nranking');
  /* The property is not "there are many F&O names" — only 5 symbols in the whole
     universe start with R, so 5 of 20 is the maximum possible there. It is that
     within a tier, every F&O name comes BEFORE every non-F&O one. Asserting a
     count instead would fail on a letter the market happens not to favour. */
  for (const letter of ['r', 'a', 's', 't']) {
    const rows = U.search(letter, 20).results.filter(r => r.tier === 1);
    const lastFno = rows.map(r => r.fno).lastIndexOf(true);
    const firstPlain = rows.map(r => r.fno).indexOf(false);
    ok(lastFno === -1 || firstPlain === -1 || lastFno < firstPlain,
      `"${letter}": all ${rows.filter(r => r.fno).length} traded names precede the rest — ordered by prominence, not alphabetically`);
  }
  const rel = U.search('rel', 40).results;
  ok(rel.findIndex(r => r.symbol === 'RELIANCE') === 0, 'RELIANCE is index 0 for "rel"');
  ok(rel.every((r, i) => i === 0 || r.tier >= rel[0].tier),
    'the tier never decreases down the list — prominence orders equal matches, it does not outrank a better one');

  console.log('\nboundaries');
  ok(U.search('').total === 0 && U.search('').ok, 'an empty query returns nothing, without erroring');
  ok(U.search('a', 5).results.length === 5 && U.search('a').total > 1000,
    'the limit truncates the rows but `total` still reports the full count — "20 of 4190" must be sayable');
  ok(U.search('zzzzznotastock').total === 0, 'a query nothing matches returns zero, not a guess');
  ok(U.search('reliance').results[0].symbol === 'RELIANCE', 'a full name resolves');
  ok(U.bySymbol('tcs') && U.bySymbol('tcs').symbol === 'TCS', 'symbol lookup is case-insensitive');
  ok(U.bySymbol('NOTREAL') === null, 'and returns null — not a nearest guess — for an unknown symbol');

  console.log('\nspeed');
  const t0 = Date.now();
  for (let i = 0; i < 50; i++) U.search('a', 20);
  const ms = (Date.now() - t0) / 50;
  ok(ms < 40, `a worst-case single-letter search takes ${ms.toFixed(1)} ms — fast enough for every keystroke`);
}

/* ── 3. the builder's filters are allowlists, and they report exclusions ─── */
console.log('\nthe builder');
ok(/NSE_EQUITY_TYPES = new Set\(/.test(BUILD) && /BSE_EQUITY_GROUPS = new Set\(/.test(BUILD),
  'both exchanges use an explicit ALLOWLIST');
ok(/'BZ'/.test(BUILD), 'NSE group BZ is admitted — SANWARIA CONSUMER lives there');
ok(/'SM'/.test(BUILD) && /'BE'/.test(BUILD) && /'ST'/.test(BUILD),
  'so are SME, trade-to-trade and SME trade-to-trade equities');
ok(!/instrument_type !== 'F'/.test(BUILD) && !/!== 'G'/.test(BUILD),
  'and NOT a denylist — a new debt group appearing tomorrow would otherwise flood a stock search with bonds');
ok(/excluded:/.test(BUILD), 'the builder prints what it excluded, so the filter is auditable');
ok(/if \(!stocks\.length\)[\s\S]{0,400}process\.exit\(1\)/.test(BUILD),
  'a failed download leaves the existing file alone and exits non-zero — an emptied universe reads as a broken search box');
ok(/User-Agent/.test(BUILD), 'the download sends a User-Agent — a bare HEAD to this CDN is refused with 403');
ok(/fno\.has\(r\.s\)/.test(BUILD), 'F&O underlyings are marked for ranking');
ok(/for \(const r of seen\.values\(\)\) if \(fno\.has/.test(BUILD),
  'and marked only after BOTH masters are read, so a cross-listed stock is not missed');

/* ── 4. failure states are stated, not disguised ─────────────────────────── */
console.log('\nwhen the universe is missing');
ok(/npm run build:universe/.test(code('stock-universe.js')),
  'an unbuilt universe returns the command that fixes it');
ok(/ok: false/.test(code('stock-universe.js')),
  'as ok:false — an empty list would claim no such stock is listed in India');
ok(/res\.status\(out\.ok \? 200 : 503\)/.test(SERVER), 'and the endpoint answers 503, not 200 with nothing');

/* ── 5. the dropdown ─────────────────────────────────────────────────────── */
console.log('\nthe dropdown');
ok(/api\/stock\/search/.test(PAGE), 'the page queries the search endpoint');
ok(/qEl\.addEventListener\('input'/.test(PAGE), 'on every keystroke');
ok(!/length\s*<\s*[23]/.test(PAGE.slice(PAGE.indexOf("addEventListener('input'"), PAGE.indexOf("addEventListener('keydown'"))),
  'with no minimum length — one letter opens the list, which is what was asked for');
ok(/ArrowDown/.test(PAGE) && /ArrowUp/.test(PAGE) && /Escape/.test(PAGE),
  'arrow keys move and Escape dismisses');
ok(/e\.key === 'Enter' && acSel >= 0/.test(PAGE), 'Enter opens the highlighted row');
ok(/seq !== acSeq/.test(PAGE),
  'out-of-order replies are discarded — otherwise a slow response repaints a query the reader has typed past');
ok(/mousedown/.test(PAGE), 'selection is on mousedown, because blur would close the list before a click lands');
ok(/showing \$\{acRows\.length\} of \$\{d\.total\}/.test(PAGE),
  'and it says how many of how many — showing 20 and implying that is all of them is a quiet lie');
ok(/role="listbox"/.test(fs.readFileSync(path.join(ROOT, 'public/stock.html'), 'utf8')) &&
   /aria-selected/.test(PAGE), 'the list is announced to a screen reader');

/* ── 6. resolution uses it, without guessing ─────────────────────────────── */
console.log('\nresolution');
ok(/universe\.bySymbol/.test(SA), 'the analyst resolves an exact symbol through the universe');
ok(/unambiguous/.test(SA), 'and only accepts a name match when it is unambiguous');
ok(/hits\.total === 1 \|\| top\.tier === 0/.test(SA),
  'taking the top of a 38-result list would silently open a stock nobody asked for');
ok(/for \(const \[sym, sector, aliases\] of STOCKS\)/.test(SA),
  'the 49 curated names still come first — their news aliases are what connect a headline to a ticker');

console.log(`\n${n} checks passed\n`);
