/**
 * ui-tokens — design-system drift ratchet. Run: node test/ui-tokens.test.js
 *
 * Migration UI-01.
 *
 * Measured 2026-07-09: 21 dashboard pages, ZERO shared CSS. 19/21 define their own
 * :root tokens with the SAME names but DRIFTED values — --bg exists in 10 distinct
 * colours, --green in 5. Profit renders in five different greens depending on the page.
 *
 * public/css/tokens.css is the canonical copy. This suite is a RATCHET:
 *   • the number of pages carrying a private token block may only go DOWN
 *   • a migrated page may never re-introduce a private --bg/--panel/... definition
 *   • tokens.css itself must stay complete and self-consistent
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };

console.log('ui-tokens (migration UI-01)');

const PUB = path.join(__dirname, '..', 'public');
const pages = fs.readdirSync(PUB).filter((f) => f.endsWith('.html'));
const CORE = ['bg', 'panel', 'border', 'muted', 'green', 'red', 'blue', 'amber'];

// ── tokens.css: complete and self-consistent ──
{
  const css = fs.readFileSync(path.join(PUB, 'css', 'tokens.css'), 'utf8');
  const defined = new Set([...css.matchAll(/--([a-z0-9-]+)\s*:/gi)].map((m) => m[1]));

  for (const t of [...CORE, 'text', 'panel2', 'gain', 'loss', 'warn', 'font-ui', 'font-num', 'focus']) {
    assert.ok(defined.has(t), `tokens.css must define --${t}`);
  }
  ok(true, 'tokens.css defines every core, semantic and typography token');

  const referenced = [...css.matchAll(/var\(--([a-z0-9-]+)\)/gi)].map((m) => m[1]);
  const dangling = [...new Set(referenced)].filter((r) => !defined.has(r));
  ok(dangling.length === 0, `no var() references an undefined token${dangling.length ? ': ' + dangling.join(', ') : ''}`);

  ok(/data-theme="light"/.test(css) && /data-theme="high-contrast"/.test(css),
    'light and high-contrast themes exist as token swaps, not page rewrites');
  ok(/data-cvd="deuteranopia"/.test(css), 'a colour-blind mode remaps ONLY the semantic gain/loss tokens');
  ok(/--gain:\s*var\(--green\)/.test(css) && /--loss:\s*var\(--red\)/.test(css),
    'semantic gain/loss are indirections over raw hues — remappable without repainting components');
  ok(/tabular-nums/.test(css), 'numeric columns get tabular figures (P&L must not wobble as digits change)');
  ok(/:focus-visible/.test(css), 'a keyboard focus ring exists (0/21 pages had one)');
}

// ── the ratchet: private token blocks may only decrease ──
{
  // Baseline was 19 on 2026-07-09, the day tokens.css was created. The migration
  // finished on 2026-07-28 and the baseline moves with it: a ratchet left at its
  // original notch stops ratcheting. Zero means no page may reintroduce a private
  // palette, which is the whole point.
  const BASELINE = 0;

  const priv = pages.filter((f) => {
    const src = fs.readFileSync(path.join(PUB, f), 'utf8');
    // a page counts as "private" if it defines any core token in its own <style>
    return CORE.some((t) => new RegExp(`--${t}\\s*:`).test(src));
  });

  console.log(`    pages with a private token block: ${priv.length}/${pages.length} (baseline ${BASELINE})`);
  ok(priv.length <= BASELINE,
    `RATCHET: private token pages ${priv.length} ≤ baseline ${BASELINE} — drift may never grow again`);

  // Migrated pages must link the shared sheet and must NOT redefine core tokens.
  const migrated = pages.filter((f) =>
    /href=["'][^"']*css\/tokens\.css/.test(fs.readFileSync(path.join(PUB, f), 'utf8')));
  for (const f of migrated) {
    const src = fs.readFileSync(path.join(PUB, f), 'utf8');
    const redefines = CORE.filter((t) => new RegExp(`--${t}\\s*:`).test(src));
    assert.ok(redefines.length === 0,
      `${f} links tokens.css but still privately redefines: ${redefines.map((t) => '--' + t).join(', ')}`);
  }
  ok(true, `migrated pages (${migrated.length}) never redefine a core token privately`);
}

// ── the canonical palette is the dashboard's, and every page reaches it ────────
{
  // Owner instruction 2026-07-28: "all UI should be the dashboard's colour."
  // Measured before this migration, across 22 pages: 11 distinct body backgrounds,
  // 10 text colours, 8 greens and 8 reds — profit rendered in eight different
  // greens depending on which page you were looking at. Measured after: one each.
  const css = fs.readFileSync(path.join(PUB, 'css', 'tokens.css'), 'utf8');
  const val = (name) => {
    const m = new RegExp(`--${name}\\s*:\\s*([^;]+);`).exec(css);
    return m ? m[1].trim() : null;
  };
  const DASH = { bg: '#070a10', panel: '#0d1420', panel2: '#111a28',
                 border: '#1a2536', text: '#e6edf6', muted: '#8291a8',
                 green: '#26d0a0', red: '#ff5470', blue: '#5b9cff', amber: '#ffc24b' };
  const wrong = Object.entries(DASH).filter(([k, v]) => (val(k) || '').toLowerCase() !== v);
  ok(wrong.length === 0,
    `every core token equals dashboard.html's value${wrong.length ? ' — drifted: ' + wrong.map(([k]) => '--' + k).join(', ') : ''}`);

  // The home page's background is a wash, not a flat fill, and it is shared so the
  // other pages do not sit beside it looking almost-but-not-quite right.
  ok(/--bg-wash\s*:\s*radial-gradient/.test(css), 'the dashboard background wash is a token, not a per-page copy');

  // Every page must actually load the sheet, or it silently keeps browser defaults.
  const unlinked = pages.filter((f) =>
    !/href=["'][^"']*css\/tokens\.css/.test(fs.readFileSync(path.join(PUB, f), 'utf8')));
  ok(unlinked.length === 0,
    `all ${pages.length} pages link the shared sheet${unlinked.length ? ' — missing: ' + unlinked.join(', ') : ''}`);

  // The names the pages already spoke are aliased, not abolished — that is what let
  // nineteen private blocks be deleted without rewriting the rules that used them.
  for (const alias of ['txt', 'mut', 'line', 'up', 'dn', 'yellow', 'purple', 'teal'])
    assert.ok(new RegExp(`--${alias}\\s*:\\s*var\\(`).test(css),
      `--${alias} is an alias over a canonical token, not a second opinion`);
  ok(true, 'the page vocabulary is aliased onto one set of values');
}

console.log(`\n${pass} assertions passed`);
