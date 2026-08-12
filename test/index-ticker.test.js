/**
 * index-ticker — every index on every page, in one strip, from one call.
 * Run: node test/index-ticker.test.js
 *
 * @test:unit @test:characterization @test:regression @test:failure
 * @test:integration @test:performance @test:rollback
 *
 * WHAT THIS IS
 *
 * A compact strip across the top of every page showing all six indices the
 * instrument registry knows, live, with an EXPIRY badge on whichever expires
 * today. Small type on purpose — six indices have to fit one line.
 *
 * THREE THINGS THAT WOULD HAVE GONE WRONG, and what this file pins
 *
 * 1. HARD-CODED BROKER KEYS. The obvious key for FINNIFTY is
 *    `NSE_INDEX|Nifty Fin Services`. Measured against the live broker on
 *    2026-07-30: that returns NOTHING. The working key is
 *    `NSE_INDEX|Nifty Fin Service` — singular "Service". The registry already
 *    held the correct one, because it was built from the broker's own contract
 *    master. Any list typed into server.js would have shipped the wrong key and
 *    silently dropped one index. So the endpoint must read the registry.
 *
 * 2. SIX CALLS PER REFRESH PER TAB. Six indices × a 5-second poll × every open
 *    tab is the traffic shape that produced 458 rate-limit refusals before the
 *    connector took over its own call rate. One batched call, server-cached.
 *
 * 3. A MISSING QUOTE RENDERING AS ZERO. An index the broker does not return
 *    must be a blank, never 0 and never a flat market. `null ≠ 0` applies to a
 *    price strip more than to most places, because a row of zeros reads as a
 *    calm market rather than a broken feed.
 *
 * The strip also distinguishes the three indices this system TRADES from the
 * three it merely watches. A price beside a name otherwise implies an engine
 * acts on it, and for FINNIFTY, MIDCPNIFTY and BANKEX none does.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };
const ROOT = path.join(__dirname, '..');

/* Comments stripped before any assertion about code shape. This file quotes the
   very patterns it forbids — `|| 0`, the wrong FINNIFTY key — so a naive search
   would match its own header and pass for ever. */
const code = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const SERVER = code('server.js');
const CONN = code('upstox-connector.js');
const TICK = code('public/js/ticker.js');
const RAIL = code('public/js/rail.js');

console.log('\nindex ticker\n');

/* ── 1. the instrument list comes from the registry ──────────────────────── */
console.log('registry is the source');
const iEnd = SERVER.indexOf("app.get('/api/quant'");
const idx = SERVER.slice(SERVER.indexOf("app.get('/api/indices'"), iEnd > 0 ? iEnd : undefined);
ok(idx.length > 200, 'the /api/indices endpoint exists');
ok(/require\('\.\/instrument-registry'\)/.test(idx), 'it reads the instrument registry');
ok(/allInstruments\(\)/.test(idx), 'and enumerates every instrument the registry knows');
ok(/underlyingKey/.test(idx), 'taking each broker key from the registry record');
ok(!/NSE_INDEX\|/.test(idx),
  'no broker key is typed into the endpoint — the wrong FINNIFTY spelling would have shipped silently');

const registry = require(path.join(ROOT, 'instrument-registry.js'));
const names = registry.allInstruments();
ok(names.length >= 6, `the registry knows ${names.length} instruments`);
const keys = names.map(x => registry.catalog(x).underlyingKey).filter(Boolean);
ok(keys.length === names.length, 'every one of them carries an underlying key');
ok(keys.includes('NSE_INDEX|Nifty Fin Service'),
  'including the FINNIFTY key that actually resolves — singular "Service"');
ok(!keys.includes('NSE_INDEX|Nifty Fin Services'),
  'and not the plural spelling, which the broker does not answer');

/* ── 2. one call, cached ─────────────────────────────────────────────────── */
console.log('\ncost');
ok(/getIndexQuotes/.test(CONN), 'the connector has a batched quote method');
const gq = CONN.slice(CONN.indexOf('async getIndexQuotes'), CONN.indexOf('async getNiftyPrice'));
ok((gq.match(/await this\._get\(/g) || []).length === 1,
  'it makes exactly ONE broker request for all instruments');
ok(/instrument_key=\$\{list\.map\(enc\)\.join\(','\)\}/.test(gq),
  'passing every key in a single comma-separated parameter');
ok(/_idxCache/.test(idx) && /IDX_CACHE_MS/.test(idx),
  'the endpoint caches, so many open tabs do not multiply broker load');
ok((idx.match(/await live\./g) || []).length === 1, 'and hits the connector once per miss');

/* ── 3. null is not zero ─────────────────────────────────────────────────── */
console.log('\nnull is not zero');
ok(/if \(!rec \|\| !\(Number\(rec\.last_price\) > 0\)\) continue;/.test(gq),
  'a key the broker did not return is left ABSENT from the result, not zeroed');
ok(/price: q \? q\.price : null/.test(idx), 'the endpoint reports a missing price as null');
ok(/change: q \? q\.change : null/.test(idx), 'and a missing change as null');
ok(!/last_price \|\| 0/.test(gq) && !/net_change \|\| 0/.test(gq),
  'no `|| 0` turns an unreported quote into a flat market');
ok(/px === null \? '—'/.test(TICK), 'the strip renders a missing price as a dash');
ok(/chg === null\)[\s\S]{0,80}agtk-c na/.test(TICK), 'and a missing change as a neutral dash, not as 0.00');
ok(/quoted < d\.total/.test(TICK),
  'a partial feed says how many of how many were quoted — four of six is not six of six');
ok(/index feed unavailable|unreachable/.test(TICK),
  'and a dead feed says so instead of showing six blanks that look like a quiet market');

/* ── 4. the change is computed from the right base ───────────────────────── */
console.log('\nthe change figure');
ok(/net_change/.test(gq),
  'change comes from the broker net_change — ohlc.close is TODAY\'s close for an index and would give zero all day');
ok(/prev = chg === null \? null : price - chg/.test(gq), 'the previous close is derived from it');
ok(/chg \/ prev \* 100/.test(gq),
  'and the percentage is against the PREVIOUS close, not against today\'s price');

/* ── 5. expiry badge ─────────────────────────────────────────────────────── */
console.log('\nexpiry badge');
ok(/330 \* 60 \* 1000/.test(idx),
  'the weekday is taken in IST — computed in UTC the badge is wrong by a day for half the session');
ok(/getUTCDay\(\)/.test(idx), 'and read off the shifted date, not the local one');
ok(/expiryToday: Number\.isInteger\(m\.expiryDow\) \? m\.expiryDow === dow : null/.test(idx),
  'an instrument with no recorded expiry weekday is null, not false — unknown is not "no"');
ok(/agtk-x/.test(TICK) && /EXPIRY/.test(TICK), 'the strip renders the badge');

// The registry itself, exercised — this repo once shipped NIFTY and SENSEX with
// their expiry weekdays SWAPPED, which is why this is asserted rather than assumed.
const dowOf = (x) => registry.catalog(x).expiryDow;
ok(dowOf('NIFTY') === 2, 'NIFTY expires on a Tuesday');
ok(dowOf('SENSEX') === 4, 'SENSEX expires on a Thursday');
ok(dowOf('NIFTY') !== dowOf('SENSEX'), 'and the two are not swapped');

/* ── 6. traded vs watched ────────────────────────────────────────────────── */
console.log('\ntraded vs watched');
ok(/traded: m\.tradingEnabled === true/.test(idx), 'the endpoint passes through whether the system trades it');
ok(/WATCH/.test(TICK), 'the strip marks the ones it only watches');
ok(/not traded by any engine here/.test(TICK), 'and says so in the tooltip');
const traded = names.filter(x => registry.catalog(x).tradingEnabled === true);
ok(traded.length === 3, `${traded.length} of ${names.length} instruments are actually traded`);

/* ── 7. it is loaded in ONE place ────────────────────────────────────────── */
console.log('\nloaded once');
ok(/ticker\.js/.test(RAIL), 'rail.js loads the ticker');
ok(/getElementById\('agtk-js'\)/.test(RAIL), 'and refuses to load it twice');
/* NARROWED 2026-08-10, with proof, from /ticker\.js/ over the whole file.

   The assertion's own words are "no page carries its own <script src=…>". The
   pattern it used matched the STRING anywhere, including inside a comment.
   screener.html failed it while containing no script tag at all — its CSS
   carries a note explaining that the ticker shifts the page down 30px via body
   padding-top, which is the trap that cost that page a 30px scroll until it read
   --agtk-h instead of a bare 100vh.

   So the rule as written forbade DOCUMENTING the ticker, which is the opposite
   of useful: the next person to size a full-height page needs exactly that note.

   Narrowed to what it claims to check — a script tag, or a dynamically assigned
   src. The dynamic form is included because dropping to "only literal tags"
   would let `s.src = '/js/ticker.js'` through, and that is the same duplication
   wearing a different hat. */
const pages = fs.readdirSync(path.join(ROOT, 'public')).filter(f => f.endsWith('.html'));
const LOADS_TICKER = /<script[^>]+src\s*=\s*["'][^"']*ticker\.js|\.src\s*=\s*["'][^"']*ticker\.js/i;
const direct = pages.filter(f => LOADS_TICKER.test(fs.readFileSync(path.join(ROOT, 'public', f), 'utf8')));
ok(direct.length === 0,
  `no page carries its own <script src="/js/ticker.js">${direct.length ? ': ' + direct.join(', ') : ''}` +
  ' — that is how the nav came to exist in twenty divergent copies');

// and the narrowing is itself checked: a page that DID load it must still fail
ok(LOADS_TICKER.test('<script src="/js/ticker.js" defer></script>'), 'a real script tag is still caught');
ok(LOADS_TICKER.test("s.src = '/js/ticker.js';"), 'a dynamic src assignment is still caught');
ok(!LOADS_TICKER.test('/* the ticker.js strip is 30px tall */'), 'a comment mentioning it is not');

/* ── 8. it does not poll when nobody is looking ──────────────────────────── */
console.log('\npolling discipline');
ok(/document\.hidden/.test(TICK), 'a hidden tab is not polled');
ok(/agtk-shut/.test(TICK) && /shouldPoll/.test(TICK), 'a collapsed strip is not polled');
ok(/day === 0 \|\| day === 6/.test(TICK), 'weekends are not polled');
ok(/m >= 550 && m <= 940/.test(TICK), 'and neither is a closed market — 09:10 to 15:40 IST only');
ok((TICK.match(/setInterval\(/g) || []).length === 1, 'exactly one timer');
ok(/if \(timer\) return;/.test(TICK), 'which is never created twice');
ok(/sig !== lastJSON/.test(TICK),
  're-renders only when the values changed, so it does not fight the reader\'s scroll every 5 seconds');

/* ── 9. layout safety ────────────────────────────────────────────────────── */
console.log('\nlayout');
ok(/position:fixed/.test(TICK), 'the strip is fixed, so it is out of document flow');
ok(/paddingTop = H/.test(TICK), 'and shifts the page down by exactly its own height');
ok(/setProperty\('--agtk-h'/.test(TICK),
  'publishing that height as a CSS variable, so a page sized against 100vh can subtract it');
ok(/var\(--agtk-h, 0px\)/.test(fs.readFileSync(path.join(ROOT, 'public/heatmap.html'), 'utf8')),
  'heatmap.html, which hard-codes a viewport calculation, subtracts it');
ok(/@mediaprint\{\.agtk\{display:none/.test(TICK.replace(/\s+/g, '')),
  'and the strip is dropped when printing');

console.log(`\n${n} checks passed\n`);
