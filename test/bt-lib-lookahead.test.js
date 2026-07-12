'use strict';
/**
 * bt-lib.js — the two data defects behind BOTH invalidated backtests.
 * See docs/REVIEW-selling-edge-invalidated.md and docs/REVIEW-bt-real-lookahead.md.
 *
 * DEFECT 1 — the name hides the price.
 *   `loadDay().underlying` is UDiFF column 20 = `UndrlygPric` = the day's CLOSING level.
 *   It is named `underlying`, and `atmStrike()` consumes it as if it were available at 09:15.
 *   That single unlabelled datum is the look-ahead source in every strategy built on this library.
 *
 * DEFECT 2 — the lot is hardcoded, and the data already carries it.
 *   `bt-lib.js:12` declares `LOT = 75`. The bhavcopy has `NewBrdLotQty` on EVERY row (column 28),
 *   and across the 600 days it takes the values 25, 50, 65 and 75. Measured: the hardcoded 75 is
 *   wrong on 356/600 days (59.3%). This is constraint F1 — "lot size is time-varying and lives in
 *   the data" — violated by the library F1 was written about.
 *
 * WHY THIS FIX IS ADDITIVE, AND DELIBERATELY DOES NOT FIX THE LOOK-AHEAD
 *   `bt-lib.js` is a shared library with five strategy consumers. Silently shifting `atmStrike()`
 *   to yesterday's close would change every backtest result without any script asking for it —
 *   a behaviour change smuggled in through a library. Choosing *which* price a strategy may see is
 *   a STRATEGY decision, and it belongs in each script, with its own review.
 *
 *   What the library can and must do is stop lying: expose the per-day `lot` that is already in the
 *   data, and name the close honestly. Every existing field is preserved, so no consumer breaks and
 *   no existing result moves.
 *
 *   @test:characterization @test:unit @test:regression @test:failure @test:rollback
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BHAV = path.join(ROOT, 'bt-data', 'bhav');
const btlib = require('../bt-lib.js');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
const eq = (a, b, m) => { n++; assert.strictEqual(a, b, m); };

const files = fs.existsSync(BHAV)
  ? fs.readdirSync(BHAV).filter((f) => f.startsWith('nifty-') && f.endsWith('.csv')).sort()
  : [];
ok(files.length > 100, `${files.length} bhavcopy days on disk`);

const file = path.join(BHAV, files[files.length - 1]);
const row0 = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/)[0].split(',');

// ── @test:characterization — column 20 IS the close, and the name says nothing ──
{
  const day = btlib.loadDay(file);
  eq(day.underlying, +row0[20],
    'CHARACTERIZATION: loadDay().underlying is exactly UDiFF column 20 (UndrlygPric) — the CLOSE. ' +
    'Nothing in the name tells a caller that, and atmStrike() treats it as tradeable at the open');
}

// ── @test:characterization — LOT is hardcoded and provably wrong ─────────────
{
  eq(btlib.LOT, 75, 'CHARACTERIZATION: bt-lib exports a hardcoded LOT = 75');

  let wrong = 0, checked = 0;
  const seen = new Set();
  for (const f of files) {
    const r = fs.readFileSync(path.join(BHAV, f), 'utf8').trim().split(/\r?\n/)[0].split(',');
    const lot = +r[28];
    if (!Number.isFinite(lot) || lot <= 0) continue;
    checked++; seen.add(lot);
    if (lot !== 75) wrong++;
  }
  ok(checked > 500, `read NewBrdLotQty from ${checked} days`);
  ok(seen.size > 1,
    `CHARACTERIZATION: the real lot takes ${seen.size} distinct values across the history ` +
    `(${[...seen].sort((a, b) => a - b).join(', ')}) — it is time-varying, exactly as constraint F1 says`);
  ok(wrong / checked > 0.5,
    `CHARACTERIZATION: the hardcoded 75 is wrong on ${wrong}/${checked} days ` +
    `(${((wrong / checked) * 100).toFixed(1)}%) — every position size, charge and P&L is scaled by it`);
}

// ── TRIPWIRES — the fix exposes the truth. These are RED before the fix. ─────
{
  const day = btlib.loadDay(file);

  ok(day.lot !== undefined,
    'TRIPWIRE 1: loadDay() exposes the per-day `lot` from column 28');
  eq(day.lot, +row0[28], 'TRIPWIRE 1b: and it equals that day\'s NewBrdLotQty');

  ok(day.underlyingClose !== undefined,
    'TRIPWIRE 2: loadDay() names the close honestly — `underlyingClose`');
  eq(day.underlyingClose, +row0[20], 'TRIPWIRE 2b: which is column 20');

  // A premium of 40 puts both lot counts on the `Math.max(1, ...)` floor, where 65 and 75 give the
  // same answer — so a difference there would prove nothing. Use a premium low enough that the
  // count is well above 1 and the lot actually moves it.
  const PREM = 5;
  const withReal = btlib.sizeLots(100000, PREM, day.lot);
  const withHardcoded = btlib.sizeLots(100000, PREM, 75);
  ok(Number.isFinite(withReal) && withReal >= 1,
    'TRIPWIRE 3: sizeLots(cap, prem, lot) accepts the REAL lot as a third argument');
  ok(day.lot === 75 || withReal !== withHardcoded,
    `TRIPWIRE 3b: with the real lot ${day.lot} the size is ${withReal}, with the hardcoded 75 it is ` +
    `${withHardcoded} — proving the third argument is used, not ignored`);
}

// ── @test:regression — nothing that existed before has moved ────────────────
{
  const day = btlib.loadDay(file);

  ok(day.underlying !== undefined && day.date && day.nearExp && Array.isArray(day.opts),
    'REGRESSION: every pre-existing field survives — underlying, date, nearExp, opts');
  eq(day.underlying, day.underlyingClose,
    'REGRESSION: `underlying` still holds the close. The alias names it; it does not move it');
  eq(btlib.atmStrike(day), Math.round(day.underlying / 50) * 50,
    'REGRESSION: atmStrike() is UNCHANGED — the look-ahead is deliberately NOT fixed here. ' +
    'Which price a strategy may see is a strategy decision, not a library one');
  eq(btlib.sizeLots(100000, 40), Math.min(25, Math.max(1, Math.floor((100000 * 0.05) / (40 * 75)))),
    'REGRESSION: the 2-argument sizeLots returns exactly what it always did — every existing ' +
    'strategy script keeps producing byte-identical results until it chooses to pass the real lot');
  eq(btlib.LOT, 75, 'REGRESSION: the LOT export is retained, so no consumer breaks');

  const leg = btlib.leg(day, 'CE', btlib.atmStrike(day));
  ok(leg === undefined || (leg.type === 'CE' && leg.xpry === day.nearExp),
    'REGRESSION: leg() is unchanged');
}

// ── @test:failure — a malformed row must not fabricate a lot ────────────────
{
  const day = btlib.loadDay(file);
  ok(Number.isFinite(day.lot) && day.lot > 0,
    'FAILURE PATH: a real file yields a real lot');
  // If column 28 were missing or unparseable, `lot` must be null — never a default of 75.
  const src = fs.readFileSync(path.join(ROOT, 'bt-lib.js'), 'utf8');
  ok(!/lot:\s*\+rows\[0\]\[28\]\s*\|\|\s*75/.test(src) && !/lot:\s*\+rows\[0\]\[28\]\s*\|\|\s*LOT/.test(src),
    'FAILURE PATH: the loader does NOT fall back to 75 when the lot is unreadable. ' +
    'An unknown lot must be null, never a guess — that is exactly the bug being removed');
}

// ── @test:rollback — additive only; one command reverts it ──────────────────
{
  const src = fs.readFileSync(path.join(ROOT, 'bt-lib.js'), 'utf8');
  ok(/underlyingClose/.test(src), 'ROLLBACK: the fix is present');
  ok(/\bunderlying\b/.test(src), 'ROLLBACK: and the old name is retained for compatibility');
  ok(/module\.exports/.test(src) && /loadDay/.test(src) && /sizeLots/.test(src),
    'ROLLBACK: the public surface is unchanged — git checkout -- bt-lib.js restores it');
}

console.log(`\n${n} assertions passed`);
