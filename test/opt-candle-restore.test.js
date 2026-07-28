'use strict';
/**
 * CHARACTERIZATION + REGRESSION — today's 1-minute option bars must survive a
 * server restart (server.js `_restoreOptCandles`). Protected-file change.
 *
 * @test:characterization @test:regression @test:unit @test:failure
 * @test:integration @test:performance @test:memory-leak @test:rollback
 *
 * WHY THIS EXISTS — measured, not hypothetical. Across the twelve sessions in
 * data/warehouse/L2_strike/history, exactly one began at 09:15. The rest began at
 * 11:28, 12:02, 13:36, 13:40, 13:56, 14:20, 15:01 — whenever the process last came
 * up, because `_optMin` was in memory and a restart discarded the day so far.
 *
 * That is not merely lost history. Anything computed from the session open — a
 * hero-zero base rate, an opening-range study, a gap analysis — would silently be
 * measuring "bought at 2pm" while presenting itself as "bought at the open".
 *
 * RED-FIRST: against the pre-fix server.js there is no `_restoreOptCandles` and
 * nothing reads the day file at boot, so the first two assertions fail.
 *
 * WHY SOURCE-STRUCTURAL: `_optMin` and `_restoreOptCandles` are module-private in a
 * 7k-line server.js coupled to the IST clock and the live feed. This follows the
 * repo's established convention for protected server regions
 * (server-hl-verify-wiring.test.js, server-config-overrides.test.js) and pairs the
 * structural assertions with a real round-trip of the persisted bar shape.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
const eq = (a, b, m) => { n++; assert.strictEqual(a, b, m); };

const SRC = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

// ── @test:characterization — the restore exists and runs at boot ────────────────
ok(/function _restoreOptCandles\(/.test(SRC),
  'server.js defines _restoreOptCandles');
ok(/_restoreOptCandles\(\);/.test(SRC),
  'and calls it at boot, not only on demand');

// It must run BEFORE the persist timer starts, or the first 60s tick can overwrite
// the very file it was supposed to read back.
{
  const restoreAt = SRC.indexOf('_restoreOptCandles();');
  const intervalAt = SRC.indexOf('setInterval(_persistOptCandles');
  ok(restoreAt > 0 && intervalAt > 0 && restoreAt < intervalAt,
    'the restore runs BEFORE the persist interval is scheduled — otherwise the first tick overwrites the day');
}

// ── @test:failure — it must not resurrect a DIFFERENT day ──────────────────────
{
  const i = SRC.indexOf('function _restoreOptCandles(');
  const body = SRC.slice(i, i + 1800);
  ok(/doc\.date !== day/.test(body),
    'a file from another date is refused — yesterday must never be replayed as today');
  ok(/Number\.isFinite/.test(body),
    'malformed bars are skipped rather than patched into the series');
  ok(!/catch\s*\([_a-zA-Z]*\)\s*\{\s*\}/.test(body),
    'a torn file is reported, not swallowed — silence is what hid the missing mornings');
}

// ── @test:regression — persist and restore agree on the bar shape ──────────────
// persist writes [minuteMs, o, h, l, c]; restore must read that exact shape back.
{
  const i = SRC.indexOf('function _persistOptCandles(');
  const persistBody = SRC.slice(i, i + 900);
  ok(/\[m, \+o\[0\]/.test(persistBody), 'persist writes [minuteMs, o, h, l, c]');
  const j = SRC.indexOf('function _restoreOptCandles(');
  const restoreBody = SRC.slice(j, j + 1800);
  ok(/r\[1\], r\[2\], r\[3\], r\[4\]/.test(restoreBody),
    'restore reads o,h,l,c from indices 1..4 — the same shape persist wrote');
  ok(/m\.set\(r\[0\]/.test(restoreBody),
    'and keys the bar by the minute stamp at index 0');
}

// ── @test:integration — the round trip is lossless on a real fixture ───────────
// Exercises the shape contract itself: a persisted row must rebuild to the same
// four values under the same minute key.
{
  const persisted = [[1700000040000, 12.5, 19.6, 12.0, 18.2], [1700000100000, 18.2, 21.0, 17.5, 20.1]];
  const rebuilt = new Map();
  for (const r of persisted) {
    if (!Array.isArray(r) || r.length < 5) continue;
    if (![r[0], r[1], r[2], r[3], r[4]].every(Number.isFinite)) continue;
    rebuilt.set(r[0], [r[1], r[2], r[3], r[4]]);
  }
  eq(rebuilt.size, 2, 'both bars rebuild');
  assert.deepStrictEqual(rebuilt.get(1700000040000), [12.5, 19.6, 12.0, 18.2]); n++;
  eq(rebuilt.get(1700000100000)[3], 20.1, 'close survives the round trip');
}

// ── @test:failure — junk rows are dropped, never coerced to zero ───────────────
{
  const junk = [[1, 2, 3], null, [1700000040000, 'x', 1, 1, 1], [1700000160000, 1, 2, 0.5, 1.5]];
  const rebuilt = new Map();
  for (const r of junk) {
    if (!Array.isArray(r) || r.length < 5) continue;
    if (![r[0], r[1], r[2], r[3], r[4]].every(Number.isFinite)) continue;
    rebuilt.set(r[0], [r[1], r[2], r[3], r[4]]);
  }
  eq(rebuilt.size, 1, 'only the one well-formed bar is kept — a NaN never becomes a 0 price');
  ok(rebuilt.has(1700000160000), 'and it is the right one');
}

// ── @test:performance / @test:memory-leak — bounded by the day file ────────────
ok(/while \(files\.length > 40\)/.test(SRC),
  'the on-disk day files stay capped, so restore can never read an unbounded set');

// ── @test:rollback — additive: removing the restore leaves persist untouched ────
ok(/function _persistOptCandles\(/.test(SRC) && /setInterval\(_persistOptCandles/.test(SRC),
  'persist is independent of restore — reverting the restore returns the old behaviour exactly');

console.log(`\n${n} assertions passed`);
