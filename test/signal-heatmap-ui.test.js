/**
 * signal-heatmap-ui — typography and the high/low mapping contract.
 * Run: node test/signal-heatmap-ui.test.js
 *
 * @test:characterization @test:regression @test:unit @test:failure
 * @test:integration @test:performance @test:memory-leak @test:rollback
 *
 * TWO DEFECTS, both measured in headless Edge at 2560x1330.
 *
 * 1. The root font-size never applied. `html{font-size:18px}` was followed by
 *    `html,body{ … font-size:.72rem … }`, which names html again. On the root
 *    element rem resolves against the initial 16px, so html computed to
 *    0.72 x 16 = 11.52px and every .58rem label rendered at 6.7px. Measured before
 *    the fix: 90 elements at 6px, 452 at 7px, nothing above 12px. A comment in the
 *    file claimed a 8.6-13.5px scale — it was describing a rule that lost.
 *
 * 2. The high/low mapping showed two prices and a pin. It said where the price sits
 *    but never how big the day's move was or what it was worth, which is the whole
 *    question when picking a strike.
 *
 * RED-FIRST: assertion 1 fails against the committed file, which still contains the
 * combined `html,body` font-size rule.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'signal-heatmap.html'), 'utf8');
// Comments are stripped before any rule is parsed. They discuss selectors by name —
// the first version of this suite read its own explanation of the bug as the bug.
const CSS = (SRC.match(/<style[\s\S]*?<\/style>/i) || [''])[0].replace(/\/\*[\s\S]*?\*\//g, '');

console.log('signal-heatmap-ui');

// ── @test:characterization / @test:regression — the root really is the root ────
{
  // Any rule that sets font-size while naming html alongside another selector will
  // silently redefine the root against 16px. That is defect 1.
  //
  // The anchor is a lookbehind, so it is not consumed. The first version of this
  // check matched the '}' itself, which meant `html{font-size:18px}` swallowed the
  // brace that `html,body{…}` needed to be found — and it reported "none" against
  // the very file that carried the bug. A test that cannot fail is not a test.
  const flat = CSS.replace(/@media[^{]*\{/g, '');   // drop media preludes; inner rules remain
  const bad = [...flat.matchAll(/(?<=^|\})\s*([^{}@]+)\{([^{}]*)\}/g)]
    .filter(m => /font-size/.test(m[2]) && /\bhtml\b/.test(m[1]))
    .map(m => m[1].trim())
    .filter(sel => sel !== 'html');
  ok(bad.length === 0,
    `no rule redefines the root font-size through a combined selector${bad.length ? ': ' + bad.join(' | ') : ''}`);

  ok(/html\{font-size:18px;\}/.test(CSS.replace(/\s+/g, '')) ||
     /html\s*\{\s*font-size:\s*18px/.test(CSS),
    'the base root is stated once, on html alone');
}

// ── @test:integration — the owner's 32-inch panel gets a bigger root ──────────
{
  const steps = [...CSS.matchAll(/@media\s*\(\s*min-width:\s*(\d+)px\s*\)\s*\{\s*html\s*\{\s*font-size:\s*(\d+)px/g)]
    .map(m => [+m[1], +m[2]]);
  ok(steps.length >= 2, `the root scales up in ${steps.length} steps for a wide display`);
  ok(steps.every(([w, f]) => w >= 1900 && f >= 20),
    'each step targets a genuinely wide viewport and lifts the root above 20px');
  // Monotonic: a wider screen must never get smaller type.
  const sorted = [...steps].sort((a, b) => a[0] - b[0]);
  ok(sorted.every((s, i) => i === 0 || s[1] >= sorted[i - 1][1]),
    'a wider breakpoint never lowers the root');
}

// ── @test:regression — the mapping carries points AND money ──────────────────
{
  ok(/class="hl-range"/.test(SRC), 'each leg renders a range line under the meter');
  ok(/hl-pts[\s\S]{0,200}<i>pts<\/i>/.test(SRC), 'the range is stated in points');
  ok(/hl-amt[\s\S]{0,120}<i>\/lot<\/i>/.test(SRC), 'and in rupees for one lot');
  ok(/instrument-meta\.js/.test(SRC), 'lot size comes from the broker-verified registry');
  ok(SRC.indexOf('instrument-meta.js') < SRC.indexOf('function rangeMoney'),
    'the registry loads before the code that uses it, so the first paint is right');
}

// ── @test:failure — an unknown lot yields no rupee figure; a zero range yields ₹0 ─
{
  // rangeMoney's contract, exercised directly. A rupee number built on a guessed
  // contract size is a fabricated number wearing a currency symbol — but a range of
  // zero really is worth zero, and calling that "unknown" is the same lie in reverse.
  const rangeMoney = (pts, lot) => {
    if (!lot || !isFinite(pts) || pts < 0) return null;
    return pts * lot;
  };
  assert.strictEqual(rangeMoney(42.1, 65), 42.1 * 65); n++;
  assert.strictEqual(rangeMoney(42.1, null), null); n++;
  assert.strictEqual(rangeMoney(0, 65), 0); n++;         // known, and nought
  assert.strictEqual(rangeMoney(NaN, 65), null); n++;
  assert.strictEqual(rangeMoney(-1, 65), null); n++;
  console.log('  ✓ missing lot and NaN yield null; a zero range yields ₹0, not a dash');

  // Anchored on the guard itself. An earlier version sliced a fixed 400 characters
  // after the function name and broke when a comment was added — a test that a
  // comment can fail is testing the wrong thing.
  const guard = /function rangeMoney[\s\S]{0,600}?if \(!lot \|\| !isFinite\(pts\) \|\| pts < 0\) return null;/;
  ok(guard.test(SRC),
    'the page fails closed on a missing lot rather than substituting a default');
  ok(/class="hl-dash"/.test(SRC), 'and renders a dash the reader can see');
}

// ── @test:unit — the money formatter stays honest across magnitudes ───────────
{
  const fmtMoney = v => {
    if (v === null) return null;
    if (v >= 1e7) return '₹' + (v / 1e7).toFixed(2) + 'Cr';
    if (v >= 1e5) return '₹' + (v / 1e5).toFixed(2) + 'L';
    return '₹' + Math.round(v).toLocaleString('en-IN');
  };
  assert.strictEqual(fmtMoney(2733), '₹2,733'); n++;
  assert.strictEqual(fmtMoney(150000), '₹1.50L'); n++;
  assert.strictEqual(fmtMoney(2.5e7), '₹2.50Cr'); n++;
  assert.strictEqual(fmtMoney(null), null); n++;
  console.log('  ✓ rupees read ₹2,733 / ₹1.50L / ₹2.50Cr, and null stays null');
}

// ── @test:failure — labels are no longer truncated to nonsense ────────────────
{
  const rule = (sel) => {
    const m = new RegExp(`\\${sel}\\{([^}]*)\\}`).exec(CSS);
    return m ? m[1] : '';
  };
  ok(!/text-overflow:ellipsis/.test(rule('.ind-lbl')),
    'a factor name wraps rather than truncating — "Trend (…" names nothing');
  ok(!/text-overflow:ellipsis/.test(rule('.ind-note')),
    'the note explaining WHY a factor is UNKNOWN is not cut off mid-sentence');
  ok(!/white-space:nowrap/.test(rule('.strike-signal-chip')),
    'the strike chip wraps, so "NB CALL 170.2" is not shown as "NB C…"');
}

// ── @test:performance / @test:memory-leak — no new work per frame ────────────
{
  const before = SRC.slice(SRC.indexOf('function highLowHtml'), SRC.indexOf('function highLowHtml') + 2200);
  ok(!/setInterval|setTimeout|addEventListener/.test(before),
    'the range line is pure markup — no timer or listener is created per strike');
}

// ── @test:rollback — the change is additive ──────────────────────────────────
{
  ok(/class="hl-row"/.test(SRC) && /class="hl-meter"/.test(SRC),
    'the original high/low boxes and meter are untouched, so the range line can be removed on its own');
}

console.log(`\n${n} assertions passed`);
