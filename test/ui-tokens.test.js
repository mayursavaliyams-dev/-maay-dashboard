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
  // Baseline measured 2026-07-09, the day tokens.css was created.
  const BASELINE = 19;

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

console.log(`\n${pass} assertions passed`);
