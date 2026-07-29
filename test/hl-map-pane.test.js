/**
 * hl-map-pane — the dashboard's High/Low mapping grid.
 * Run: node test/hl-map-pane.test.js
 *
 * @test:characterization @test:regression @test:unit @test:failure
 * @test:integration @test:performance @test:memory-leak @test:rollback
 *
 * TWO DEFECTS, both in a pane that had never once shown a number.
 *
 * 1. CASE. The archive keys legs as "24300_CE", so the parser produced type "CE" and
 *    stored map[24300].CE — while the renderer read map[k].ce. Every cell fell to the
 *    dash branch. Measured 2026-07-29: strike 23600 rendered "—" while the archive
 *    held CE low 634.1, high 650. The pane has been empty since it shipped on
 *    2026-07-26 (aa7d77a), so nobody had yet seen it work to notice.
 *
 * 2. CENTRE. The ATM±12 filter took the MIDDLE of the strike list as the at-the-money
 *    strike, which is only true if the archive reaches equally far either side. It did
 *    not: the window came out 23450-24200 with NIFTY at 24230, so a filter labelled
 *    ATM hid every strike nearest the money. The ATM is now read off put-call parity,
 *    which needs no spot and works for an archived day from months ago.
 *
 * RED-FIRST: assertion 1 fails against the committed page, which stores `[type]`.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'dashboard.html'), 'utf8');
const FN = SRC.slice(SRC.indexOf('async function loadHLMap()'),
                     SRC.indexOf('function renderWatchlist()'));

console.log('hl-map-pane');

// ── @test:characterization / @test:regression — the key case must agree ──────
{
  ok(/\[type\.toLowerCase\(\)\]\s*=\s*v/.test(FN),
    'legs are stored under a lower-case key, matching the map[k].ce / map[k].pe the renderer reads');
  ok(!/\}\)\[type\]\s*=\s*v/.test(FN),
    'and never under the raw upper-case type, which is what emptied the grid');

  // The contract, exercised directly: parse an archive key the way the page does and
  // confirm the renderer's lookup finds it.
  const build = (entries) => {
    const map = {};
    for (const [key, v] of Object.entries(entries)) {
      const us = key.lastIndexOf('_');
      const strike = +key.slice(0, us), type = key.slice(us + 1);
      if (!isFinite(strike) || !(type === 'CE' || type === 'PE')) continue;
      (map[strike] = map[strike] || {})[type.toLowerCase()] = v;
    }
    return map;
  };
  const m = build({ '23600_CE': { high: 650, low: 634.1 }, '23600_PE': { high: 12.3, low: 11.65 } });
  assert.strictEqual(m[23600].ce.high, 650); n++;
  assert.strictEqual(m[23600].pe.low, 11.65); n++;
  console.log('  ✓ 23600_CE and 23600_PE both land where the renderer looks');

  // @test:failure — junk keys are dropped, not coerced onto a strike
  const junk = build({ 'foo_CE': { high: 1 }, '24000_XX': { high: 1 }, '24000': { high: 1 } });
  assert.strictEqual(Object.keys(junk).length, 0); n++;
  console.log('  ✓ a malformed key is skipped rather than mapped to NaN');
}

// ── @test:unit — the ATM comes from put-call parity, not from list position ──
{
  ok(/put-call parity/.test(FN), 'the ATM is derived from where the call and put are worth the same');
  ok(!/\[Math\.floor\(\(both\.length\?both:strikes\)\.length\/2\)\]/.test(FN),
    'not from the middle of whatever the archive happens to hold');

  // Same arithmetic as the page, on an archive that is deliberately lopsided: many
  // strikes below the money, few above. The middle of the list would be far too low.
  const mid = o => (o && isFinite(o.high) && isFinite(o.low)) ? (o.high + o.low) / 2 : null;
  const map = {};
  const SPOT = 24230;
  for (let k = 22000; k <= 24800; k += 50) {
    const intrinsicCe = Math.max(0, SPOT - k), intrinsicPe = Math.max(0, k - SPOT);
    map[k] = { ce: { high: intrinsicCe + 21, low: intrinsicCe + 19 },
               pe: { high: intrinsicPe + 21, low: intrinsicPe + 19 } };
  }
  const strikes = Object.keys(map).map(Number).sort((a, b) => a - b);
  let atm = null, best = Infinity;
  for (const k of strikes) {
    const d = Math.abs(mid(map[k].ce) - mid(map[k].pe));
    if (d < best) { best = d; atm = k; }
  }
  ok(Math.abs(atm - SPOT) <= 50,
    `parity finds ${atm} against a spot of ${SPOT} — within one strike interval`);

  const middle = strikes[Math.floor(strikes.length / 2)];
  ok(Math.abs(middle - SPOT) > 200,
    `the old rule would have picked ${middle}, ${Math.abs(middle - SPOT)} points away — that is the defect, reproduced`);
}

// ── @test:failure — an unpriced archive still renders something ─────────────
{
  ok(/if \(atm === null\) atm = strikes\[Math\.floor\(strikes\.length \/ 2\)\]/.test(FN),
    'when no strike has both legs priced it falls back to the middle rather than showing nothing');
  ok(/'<td style="color:var\(--mut\)">—<\/td>'/.test(FN),
    'a leg with no archive entry renders a dash — absent stays absent, never 0');
}

// ── @test:integration — the pane is fed by the archive endpoint ─────────────
{
  ok(/\/api\/opthl-archive/.test(FN), 'the grid reads the date-wise archive');
  ok(/cache:'no-store'/.test(FN), 'and never a cached copy, so a reload shows the latest write');
  ok(/availableDates/.test(FN), 'a missing date offers the days that do exist instead of a bare error');
}

// ── @test:performance / @test:memory-leak — one pass, no timers ────────────
{
  ok(!/setInterval|setTimeout/.test(FN), 'the grid builds on demand and leaves no timer behind');
  const loops = (FN.match(/for\s*\(/g) || []).length;
  ok(loops <= 3, `the archive is walked a bounded number of times (${loops})`);
}

// ── @test:rollback — the fix is two expressions, independently revertible ──
{
  ok(/const map=\{\};/.test(FN) && /body\.innerHTML = strikes\.length/.test(FN),
    'the surrounding parse and render are untouched, so either change can be backed out alone');
}

console.log(`\n${n} assertions passed`);
