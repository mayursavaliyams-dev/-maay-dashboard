/**
 * stock.html — the full stock view. A blank must mean "not reported", and the
 * panels the vendor cannot fill must be named rather than quietly dropped.
 * Run: node test/stock-view-ui.test.js
 *
 * @test:unit @test:characterization @test:regression @test:failure
 * @test:integration @test:security @test:performance @test:rollback
 *
 * WHAT THIS PAGE IS FOR
 *
 * The request was that clicking any stock opens everything a broker shows. A
 * broker terminal shows roughly sixteen panels; a market-data vendor can fill
 * about nine of them. The interesting engineering is not the nine — it is the
 * seven, because a page that renders nine panels and stops invites the reader to
 * assume the other seven were checked and found empty.
 *
 * So the page carries a "Not available" tab listing every panel it cannot fill
 * and why, and that list comes from the server — from a constant that was
 * MEASURED against the vendor on 2026-07-29 for three different issuer shapes
 * (a 2026 demerger, an IT major, a state-owned bank) — not typed into the HTML
 * where it would drift the first time the vendor changed.
 *
 * THE OTHER FAILURE MODE THIS GUARDS
 *
 * `null || 0` and `value ?? '—'`-style shortcuts turn "not reported" into a
 * zero. On this page a zero dividend and an unreported dividend must look
 * different, because for a bank they routinely are different.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };
const ROOT = path.join(__dirname, '..');

/* Comments stripped before any assertion about code or markup SHAPE. This file
   quotes several of the patterns it forbids in the prose above; a naive search
   would find its own header and pass forever. */
const strip = (s) => s
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PAGE = strip(read('public/stock.html'));
const SA = strip(read('stock-analyst.js'));
const AGENTS = strip(read('public/agents.html'));
const RAIL = read('public/js/rail.js');
const SERVER = strip(read('server.js'));

console.log('\nstock view\n');

/* ── it is reachable, and it is one of the app's pages ───────────────────── */
console.log('reachable');
ok(fs.existsSync(path.join(ROOT, 'public/stock.html')), 'the page exists');
ok(/\{ h: '\/stock\.html'/.test(RAIL), 'the rail lists it, so it is reachable from every page');
ok(/rail\.js/.test(PAGE) && /fit\.js/.test(PAGE) && /tokens\.css/.test(PAGE),
  'it uses the shared rail, the viewport fitter and the shared palette rather than its own');
ok(/data-fit/.test(PAGE), 'the panel region is bounded to the viewport — this page must not scroll the document');

/* ── clicking a stock anywhere opens it ──────────────────────────────────── */
console.log('\nclicking a stock');
ok(/href="\/stock\.html\?q=/.test(AGENTS) || /'\/stock\.html\?q='/.test(AGENTS),
  'agents.html links tickers to the full view');
ok(/<a class="tkr" href="\/stock\.html\?q=' \+ encodeURIComponent\(sym\)/.test(AGENTS) ||
   /const href = '\/stock\.html\?q=' \+ encodeURIComponent\(sym\)/.test(AGENTS),
  'and the symbol is URL-encoded rather than pasted into the href');
ok(/<a class="tkr"/.test(AGENTS),
  'a ticker is a real anchor, so middle-click and open-in-new-tab work — it was a <button> before');
ok(/text-decoration:none/.test(AGENTS), 'and it keeps its chip styling as an anchor');

/* ── the request ─────────────────────────────────────────────────────────── */
console.log('\nthe request it makes');
ok(/deep=1/.test(PAGE), 'the page asks for the deep payload');
ok(/encodeURIComponent\(q\)/.test(PAGE), 'the query is encoded');
ok(/\/api\/agents\/stock\?q=\$\{encodeURIComponent\(q\)\}&deep=1/.test(PAGE),
  'one request carries everything — the page does not fan out a call per panel');
/* Two fetches, and only two. The invariant was never "one fetch"; it was that the
   ANALYSIS is a single request rather than one per panel. Autocomplete is the
   second, deliberately separate: it is a local in-memory search that costs the
   broker nothing and must answer on every keystroke, while the analysis is an
   expensive multi-source call made once per stock. Collapsing them would make
   every keystroke expensive. */
const fetches = (PAGE.match(/await fetch\(/g) || []).length;
ok(fetches === 2, `two fetches in the page (${fetches}) — the analysis, and the autocomplete`);
ok(/api\/stock\/search/.test(PAGE), 'the second is the local symbol search');
ok((PAGE.match(/api\/agents\/stock/g) || []).length === 1,
  'and the analysis is still requested exactly once, not once per panel');

/* ── null is not zero. This is the whole point. ──────────────────────────── */
console.log('\nnull is not zero');
ok(/const isNum = v => v !== null && v !== undefined && isFinite\(Number\(v\)\)/.test(PAGE),
  'the numeric test rejects null and undefined and ACCEPTS zero');
ok(/isNum\(v\) \?[\s\S]{0,120}: null/.test(PAGE),
  'the formatters return null for an unreportable value rather than a placeholder number');
ok(/raw === null \|\| raw === undefined \? 'na'/.test(PAGE),
  'a row is styled "not reported" on null — not on falsy, which would swallow a real 0');
ok(!/\|\| 0\b/.test(PAGE.replace(/changePct \|\| 0/g, '')),
  'no `|| 0` fallback turns an unreported figure into a zero');
ok(/not reported/.test(PAGE), 'and the reader is told so in words, not with a bare dash');

/* ── the panels that cannot be filled are named, and named by the server ── */
console.log('\nwhat it cannot show');
ok(/NOT_AVAILABLE/.test(SA), 'the analyst module holds the list of unavailable panels');
ok(/notAvailable/.test(PAGE), 'and the page renders it');
ok(/DATA\.notAvailable/.test(PAGE),
  'from the API response — not a copy typed into the HTML, which would drift the first time the vendor changed');
const NA = require(path.join(ROOT, 'stock-analyst.js')).NOT_AVAILABLE;
ok(Array.isArray(NA) && NA.length >= 5, `${NA.length} unavailable panels are named`);
ok(NA.every(x => x.panel && x.why), 'each names the panel AND why it cannot be filled');
for (const must of ['Market depth', 'Delivery', 'Circuit', 'SEBI']) {
  ok(NA.some(x => x.panel.includes(must)), `${must} is declared unavailable rather than silently missing`);
}
ok(/data-t="gaps"/.test(PAGE), 'it has its own tab, so it is not a footnote nobody opens');

/* ── company-inside verification surface ────────────────────────────────── */
console.log('\ncompany inside');
ok(/data-t="company"/.test(PAGE), 'it has a Company Inside tab for source-backed company facts');
ok(/function companyInside\(\)/.test(PAGE), 'the company-inside section is rendered by its own function');
ok(/Inside readiness/.test(PAGE) && /verifyGrid/.test(PAGE), 'it shows a readiness section instead of mixing verification into prose');
ok(/Needs confirmation/.test(PAGE) && /Estimated result date ko verified nahi maana/.test(PAGE),
  'estimated company events are explicitly not treated as verified');
ok(/Missing values remain not reported/.test(PAGE),
  'missing company-inside values stay unreported rather than becoming confident claims');

/* ── high/low mapping ────────────────────────────────────────────────────── */
console.log('\nhigh low map');
ok(/data-t="highlow"/.test(PAGE), 'it has a dedicated High/Low Map tab');
ok(/function highLowMap\(\)/.test(PAGE) && /function bandMap\(/.test(PAGE),
  'high/low mapping is rendered by explicit mapping functions');
ok(/LOW = left edge/.test(PAGE) && /CURRENT = white marker/.test(PAGE) && /HIGH = right edge/.test(PAGE),
  'the visual mapping rule is stated on the surface');
ok(/rawPct/.test(PAGE) && /Math\.min\(100, Math\.max\(0, rawPct\)\)/.test(PAGE),
  'the marker is clamped visually while preserving the raw percent for distances');
ok(/Above reported high by/.test(PAGE) && /Below reported low by/.test(PAGE),
  'outside-band prices are warned about rather than silently hidden');
ok(/vendor uses intraday extremes; computed uses daily closes/.test(PAGE),
  'vendor and computed 52-week bands are not mixed together');

/* ── Investing.com / ProPicks ────────────────────────────────────────────── */
console.log('\npropicks');
ok(/data-t="propicks"/.test(PAGE), 'it has a ProPicks tab');
ok(/function propicksTab\(\)/.test(PAGE), 'ProPicks renders through its own tab function');
ok(/VALID_TABS/.test(PAGE) && /get\('tab'\)/.test(PAGE) && /stockUrl/.test(PAGE),
  'ProPicks can be opened directly from a research navigation URL');
ok(/data\/investing-propicks\.json/.test(PAGE), 'the UI names the verified local export file');
ok(/https:\/\/in\.investing\.com\/equities\/india/.test(PAGE) && /investing\.com\/pro\/watchlist\/w-78178381\.iwl\/v-68f5a6e5/.test(PAGE),
  'the ProPicks tab displays Investing.com source links');
ok(/Investing\.com India range/.test(PAGE) && /InvestingPro Fair Value/.test(PAGE),
  'the tab separates price range from Fair Value opinion');
ok(/Price added/.test(PAGE) && /priceWhenAdded/.test(PAGE),
  'the ProPicks table shows the InvestingPro price-when-added field');
ok(/Indian stocks only/.test(PAGE) && /not as a trading command/.test(PAGE),
  'ProPicks is labelled India-only context rather than a trade command');
ok(/Consensus view/.test(PAGE) && !/row\('Consensus'/.test(PAGE),
  'analyst consensus is labelled as a view, not a recommendation field');

/* ── opinion is labelled as opinion ──────────────────────────────────────── */
console.log('\nevidence grades');
ok(/class="tag">\$\{esc\(tag\)\}|'opinion'/.test(PAGE), 'panels can carry a grade tag');
ok(/Analyst ratings[\s\S]{0,80}'opinion'/.test(PAGE) && /Price targets[\s\S]{0,60}'opinion'/.test(PAGE),
  'analyst ratings and price targets are both badged as opinion');
ok(/opinion published by banks/.test(PAGE), 'and the card says outright what a price target is');
ok(/Research signal/.test(PAGE) && /research context only/.test(PAGE) && /not advice/.test(PAGE),
  'the verdict card is labelled as research context, not advice');
ok(/not[\s\S]{0,40}inputs to this number/.test(PAGE),
  'the verdict card says fundamentals and ratings do NOT feed the legacy strength number');
ok(/derived/.test(PAGE), 'a derived ROE is badged as derived rather than shown as reported');
ok(/'forecast'/.test(PAGE), 'forward estimates are badged as forecasts, not results');

/* ── the corporate action, which is the subtlest lie on this page ────────── */
console.log('\ncorporate actions');
ok(/dataBreak/.test(PAGE), 'the page reads the data-break flag');
ok(/breakNote|Corporate action detected/.test(PAGE),
  'and explains a blank window instead of leaving it looking like a bug');
ok(/usableBars/.test(PAGE), 'saying how many bars are actually comparable');
ok(/findDiscontinuity/.test(strip(read('stock-technicals.js'))), 'the detection lives in the tested module');

/* ── the fast path must not pay for any of this ──────────────────────────── */
console.log('\ncost');
ok(/const deep = \/\^\(1\|true\|yes\)\$\/i\.test\(String\(req\.query\.deep \|\| ''\)\)/.test(SERVER),
  'the server treats deep as an explicit opt-in');
ok(/deep=1/.test(PAGE) && !/deep=1/.test(AGENTS),
  'only the full view asks for it — the agents page, which polls, does not');
ok(/DEEP_MODULES/.test(SA) && /BASE_MODULES/.test(SA),
  'the module lists are separate, so the card cannot silently start paying for the full set');

/* ── it degrades rather than throwing ────────────────────────────────────── */
console.log('\nwhen data is missing');
ok(/if \(!t \|\| !t\.ok\)/.test(PAGE), 'a missing technical block is handled, not assumed');
ok(/if \(!f\) return/.test(PAGE), 'so are missing fundamentals');
ok(/catch \(err\)/.test(PAGE), 'a failed fetch shows a message rather than a blank screen');
ok(/is the server running/.test(PAGE), 'and says what to check');
ok(/No insider filings reported/.test(PAGE),
  'an empty insider list reads as "none filed", not as a loading failure — it is the normal Indian case');

/* ── injection: every value from the network is escaped ──────────────────── */
console.log('\nescaping');
ok(/const esc = s =>[\s\S]{0,200}replace\(\/&\/g/.test(PAGE), 'there is an escaper');
ok(/replace\(\/</.test(PAGE) && /&quot;/.test(PAGE),
  'it handles angle brackets and quotes — company names and headlines come from the network');
ok(/esc\(h\.title\)/.test(PAGE), 'headlines are escaped');
ok(/esc\(p\.summary/.test(PAGE) || /esc\(\(p\.summary/.test(PAGE), 'so is the business summary');
ok(/esc\(x\.panel\)/.test(PAGE) || /card\(x\.panel/.test(PAGE), 'and the unavailable-panel list');

console.log(`\n${n} checks passed\n`);
