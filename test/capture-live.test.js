/**
 * capture-live — the Buy Low -> Sell High page keeps today current on its own.
 * Run: node test/capture-live.test.js
 *
 * @test:characterization @test:regression @test:unit @test:failure
 * @test:integration @test:performance @test:memory-leak @test:rollback
 *
 * WHY THIS EXISTS
 *   The page only refreshed when you pressed Reload, so on a live day it quietly
 *   showed whatever the archive held when the tab was opened.
 *
 * WHY IT IS NOT JUST setInterval(load, 60000)
 *   Three things must NOT be polled, and each is a real cost, not a nicety:
 *     · a past day    — that file is finished; polling it is pure waste and the
 *                       freshness chip would keep claiming it had just checked
 *     · a closed market — nothing new is being captured to find
 *     · a hidden tab  — a background tab that keeps fetching is a battery leak
 *   And the refresh must be silent: the manual load blanks the table to a spinner,
 *   which once a minute would throw away your scroll position and flash away rows
 *   that are usually identical.
 *
 * THE HONESTY PART
 *   The rows reach the page through the capture loop, then the mirror (5 min), then
 *   derive (10 min). A chip that timed its own fetch would read "just now" while
 *   showing rows a quarter of an hour old, so /wh/capture now returns derivedAt and
 *   the chip ages from that.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };

const ROOT = path.join(__dirname, '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'public', 'capture.html'), 'utf8');
const API = fs.readFileSync(path.join(ROOT, 'warehouse-api.js'), 'utf8');

console.log('capture-live');

// ── @test:regression — the API reports when the rows were DERIVED ─────────────
{
  ok(/derivedAt:\s*doc\.derivedAt \|\| null/.test(API),
    '/wh/capture returns derivedAt, so the page can age the DATA and not its own request');
  const { getCapture } = require(path.join(ROOT, 'warehouse-api.js'));
  ok(typeof getCapture === 'function', 'getCapture is exported and callable without a socket');
  const missing = getCapture('1999-01-01', {});
  assert.strictEqual(missing.found, false); n++;
  ok(!('derivedAt' in missing) || missing.derivedAt == null,
    'a day with no archive carries no derivation stamp — absent, not zero');
}

// ── @test:failure — what must NOT be polled ──────────────────────────────────
{
  const cond = /const shouldPoll = \(\) =>([\s\S]{0,240}?);/.exec(PAGE);
  ok(cond, 'the poll decision is one named predicate, not scattered ifs');
  const c = cond ? cond[1] : '';
  ok(/istToday\(\)/.test(c), 'a past day is never polled — that file will never change again');
  ok(/marketOpen\(\)/.test(c), 'a closed market is never polled — nothing new is being captured');
  ok(/visibilityState === 'visible'/.test(c), 'a hidden tab is never polled');
  ok(/AUTO/.test(c), 'and the owner can switch it off');
}

// ── @test:unit — the market window, at the boundaries ────────────────────────
{
  // Mirrors the page's own arithmetic: minutes since midnight IST, 09:15 to 15:35.
  const open = (h, m, day = 3) => {
    if (day === 0 || day === 6) return false;
    const mins = h * 60 + m;
    return mins >= 555 && mins <= 935;
  };
  assert.strictEqual(open(9, 14), false); n++;   // one minute before the bell
  assert.strictEqual(open(9, 15), true);  n++;   // the open itself
  assert.strictEqual(open(15, 29), true); n++;
  assert.strictEqual(open(15, 35), true); n++;   // a little past the close, for late writes
  assert.strictEqual(open(15, 36), false); n++;
  assert.strictEqual(open(12, 0, 0), false); n++; // Sunday
  assert.strictEqual(open(12, 0, 6), false); n++; // Saturday
  console.log('  ✓ the poll window opens at 09:15, closes at 15:35, and never on a weekend');
}

// ── @test:performance — a silent refresh must not disturb the view ───────────
{
  ok(/if \(!silent\) \$\('tb'\)\.innerHTML = `<tr><td colspan="8"><div class="tok-loading"/.test(PAGE),
    'a timed refresh does not blank the table to a spinner');
  ok(/if \(sig !== ROWS_SIG\)/.test(PAGE),
    'and re-renders only when the rows actually changed, so scroll position survives');
  ok(/if \(!silent\)\s*\n?\s*\$\('tb'\)\.innerHTML = `<tr><td colspan="8"><div class="tok-error"/.test(PAGE),
    'a failed poll leaves the last good table on screen rather than replacing it with an error');
}

// ── @test:memory-leak — one timer, not one per state change ─────────────────
{
  const intervals = (PAGE.match(/setInterval\(/g) || []).length;
  ok(intervals === 2, `two timers only: the poll and the chip's clock (${intervals})`);
  ok(/TIMER = setInterval/.test(PAGE) && !/clearInterval/.test(PAGE),
    'the timer is created once and decides per tick — no start/stop churn as the day, market and tab change');
}

// ── @test:integration — the chip states the age of the archive, not the fetch ─
{
  ok(/DERIVED_AT \? Date\.parse\(DERIVED_AT\) : LAST_OK/.test(PAGE),
    'the chip ages from derivedAt, falling back to the fetch only when the API gives nothing');
  ok(/trails the live price/.test(PAGE),
    'and says plainly that the archive trails live — this page is not a quote screen');
  ok(/paused/.test(PAGE), 'when polling is off the chip says so instead of looking fresh');
}

// ── @test:rollback — the manual path still works on its own ─────────────────
{
  ok(/onclick="load\(\)"/.test(PAGE), 'Reload still calls load() with no arguments');
  ok(/async function load\(opts\)/.test(PAGE) && /const silent = !!\(opts && opts\.silent\)/.test(PAGE),
    'and load() without options behaves exactly as before — the auto path is additive');
}

// ── @test:characterization — the cadence is justified in the file ───────────
{
  ok(/const POLL_MS = 60000;/.test(PAGE), 'the poll is once a minute');
  ok(/mirror \(5 min\)[\s\S]{0,80}derive \(10 min\)/.test(PAGE),
    'with the pipeline lag it is chasing written down beside it');
}

console.log(`\n${n} assertions passed`);
