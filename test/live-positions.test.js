/**
 * live-positions — what the running P&L is actually made of.
 * Run: node test/live-positions.test.js
 *
 * @test:unit @test:characterization @test:regression @test:failure
 *
 * WHAT THIS IS
 *
 * The quant board has always shown how MANY positions are open — "OPEN 1" in
 * the header, "Open now 1" on the win card, "1 open" beside each engine. It
 * never showed WHICH, so a floating profit had no visible source. This adds a
 * Live Positions table: one row per open position across all four books, with
 * what it cost, what it is worth now, and what it is up or down.
 *
 * THREE THINGS THAT WOULD HAVE GONE WRONG, and what this file pins
 *
 * 1. A MISSING PRICE RENDERING AS ZERO. This is the failure that matters most
 *    here, and it is not hypothetical: the condor engine already carries an
 *    `unrealizedPnlReason` precisely because a short leg whose LTP has not
 *    arrived reads as 0 and therefore looks maximally profitable. A long leg
 *    fails the other way — priced at 0 it shows a total loss. So `last` must
 *    only be taken when it is a real, positive quote, the unrealised figure
 *    must be null otherwise, and the reason must travel with it.
 *
 * 2. A PARTIAL TOTAL READ AS THE WHOLE BOOK. If three positions are open and
 *    one has no price yet, summing the two that do and calling it "floating
 *    P&L" understates the book without saying so. The endpoint therefore sends
 *    `priced` and `pending` counts alongside the total, and the header says how
 *    many are still waiting.
 *
 * 3. CONTRACT SIZE GUESSED. Every engine here refuses to open a position when
 *    the registry has no lot size for the instrument — `if (!lot) return null`.
 *    The P&L per position is (price move × lot × qty), so a fallback lot of 50
 *    or 75 typed in here would silently misprice every row. The endpoint uses
 *    the lot the position was opened with and nothing else.
 *
 * The table is read-only. Nothing here can open, close or size a position; it
 * reports the paper book the engines keep.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };
const ROOT = path.join(__dirname, '..');

/* Comments stripped first: this file quotes the patterns it forbids, and the
   endpoint's own comments name them too, so a naive search would match prose
   and pass for ever. */
const code = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const SERVER = code('server.js');
const HTML = fs.readFileSync(path.join(ROOT, 'public/quant.html'), 'utf8');
const SCRIPT = code('public/quant.html');

/* the /api/quant handler only */
const qStart = SERVER.indexOf("app.get('/api/quant'");
const qEnd = SERVER.indexOf('app.get(', qStart + 20);
const QUANT = SERVER.slice(qStart, qEnd > 0 ? qEnd : qStart + 12000);

console.log('\nlive positions\n');

/* ── 1. the endpoint sends the positions, not just the count ─────────────── */
console.log('the book is sent, not just its size');
ok(QUANT.length > 500, 'the /api/quant endpoint exists');
ok(/const positions = \[\]/.test(QUANT), 'it builds a positions list');
ok(/positions,/.test(QUANT), 'and sends it in the response');
ok(/openBook:/.test(QUANT), 'with a summary of the open book beside it');

for (const [src, label] of [
  ['A.open', 'AI agents directional'],
  ['A.condors', 'AI agents condors'],
  ['S.openPositions', 'condor VRP'],
  ['G.openPositions', 'gamma blast'],
]) {
  ok(QUANT.includes(src), `every book is read - ${label} (${src})`);
}
ok((QUANT.match(/positions\.push\(\{/g) || []).length === 4,
  'four books, four push sites - none silently skipped');

/* ── 2. a missing price is never a price of zero ─────────────────────────── */
console.log('\nnull is not zero');
ok(/const priced = v => Number\.isFinite\(Number\(v\)\) && Number\(v\) > 0/.test(QUANT),
  'a quote counts only when it is finite AND above zero');
ok(/priced\(p\.last\) \? Number\(p\.last\) : null/.test(QUANT),
  'an unquoted long leg becomes null, not 0 - at 0 it would read as a total loss');
ok(/priced\(p\.lastCost\) \? Number\(p\.lastCost\) : null/.test(QUANT),
  'an unquoted condor becomes null, not 0 - at 0 it would read as maximum profit');
ok(/unrealizedReason/.test(QUANT), 'and the reason travels with the null');
ok(/p\.unrealizedPnlReason/.test(QUANT),
  "the condor engine's own reason is passed through, not re-invented");

/* the one shape that must never appear: a fallback that turns null into 0 */
ok(!/Number\(p\.last\)\s*\|\|\s*0/.test(QUANT),
  'no `|| 0` on a live price anywhere in the handler');
ok(!/p\.lastCost\s*\|\|\s*0/.test(QUANT), 'nor on the cost to close a condor');

/* ── 3. a partial total says so ──────────────────────────────────────────── */
console.log('\na partial total is labelled');
ok(/const livePos = positions\.filter\(p => p\.unrealizedPnl !== null\)/.test(QUANT),
  'the running total is taken over priced positions only');
ok(/pending: positions\.length - livePos\.length/.test(QUANT),
  'and the number still waiting is reported');
ok(/priced: livePos\.length/.test(QUANT), 'alongside how many were counted');
ok(/still waiting for a price/.test(SCRIPT),
  'the screen says so rather than presenting a partial sum as the whole book');

/* ── 4. contract size is never guessed ───────────────────────────────────── */
console.log('\nlot size comes from the position');
ok(/num\(p\.lot\) \* num\(p\.qty\)/.test(QUANT),
  'units are the lot the position was opened with, times its quantity');
ok(!/lot\s*\|\|\s*(50|75|25|15)\b/.test(QUANT),
  'no hard-coded lot size stands in when the registry had none');
ok(!/const\s+LOT\s*=/.test(QUANT), 'and no local lot constant to drift from the registry');

/* ── 5. the screen renders it ────────────────────────────────────────────── */
console.log('\nthe table');
ok(/id="posBody"/.test(HTML), 'the positions table has a body to fill');
ok(/id="posSum"/.test(HTML), 'and a header line for the floating total');
ok(/function renderPositions/.test(SCRIPT), 'a renderer exists');
ok(/renderPositions\(d\.positions \|\| \[\], d\.openBook \|\| \{\}\)/.test(SCRIPT),
  'and the poll feeds it every refresh');
for (const h of ['Engine', 'Position', 'Side', 'Entry', 'Now', 'Unrealised', 'Max loss']) {
  ok(HTML.includes(`>${h}<`), `the table has a ${h} column`);
}
ok(/waiting for a price/.test(SCRIPT),
  'a row with no quote says waiting rather than printing a number');
ok(/Nothing open\./.test(SCRIPT),
  'an empty book is stated plainly, not left as a blank table');
ok(/realised, not floating/.test(SCRIPT),
  'and when nothing is open it says the P&L above is realised');

/* ── 6. it stays read-only ───────────────────────────────────────────────── */
console.log('\nread-only');
ok(!/\.close\(|\.exit\(|squareOff|_open\.delete/.test(QUANT),
  'the endpoint cannot close or square off a position');
ok(!/fetch\([^)]*method:\s*['"]POST/.test(SCRIPT),
  'and the table posts nothing back');

/* ── 7. paper framing survives ───────────────────────────────────────────── */
console.log('\nstill labelled paper');
ok(/PAPER trading/.test(HTML), 'the paper disclaimer is still on the page');
ok(/mode: 'PAPER'/.test(QUANT), 'and the payload still declares PAPER mode');

console.log(`\n${n} checks passed\n`);
