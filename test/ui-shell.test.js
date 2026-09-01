/**
 * ui-shell — navigation and viewport-fit ratchet. Run: node test/ui-shell.test.js
 *
 * @test:characterization @test:regression @test:unit @test:failure
 * @test:integration @test:performance @test:memory-leak @test:rollback
 *
 * WHY THIS EXISTS — two defects, both measured on the owner's 2560x1330 panel.
 *
 * 1. The page list was hand-copied into every page's own <nav>. Twenty-one copies,
 *    each slightly different, which is how capture.html and greeks.html shipped
 *    reachable from nothing. /js/rail.js now owns the list; 175 duplicate links
 *    were removed. This suite stops them coming back.
 *
 * 2. Eleven of twenty-two pages ran past the viewport — trade.html scrolled 12.5
 *    screens, agents.html 9.7. The header, the instrument selector and the column
 *    headings scrolled away with them, so the number you were reading had no label
 *    above it. /js/fit.js bounds the data region instead. All 22 now scroll zero
 *    pixels in either direction.
 *
 * RATCHET, not a snapshot: the counts here may only improve.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };

console.log('ui-shell (navigation + viewport fit)');

const PUB = path.join(__dirname, '..', 'public');
const pages = fs.readdirSync(PUB).filter(f => f.endsWith('.html'));
const read = f => fs.readFileSync(path.join(PUB, f), 'utf8');

// login.html is pre-auth: it must NOT advertise the app's pages to a stranger.
const APP = pages.filter(f => f !== 'login.html');

// ── the rail is the single source of the page list ────────────────────────────
{
  const rail = fs.readFileSync(path.join(PUB, 'js', 'rail.js'), 'utf8');
  const entries = [...rail.matchAll(/\{\s*h:\s*'([^']+)'/g)].map(m => m[1]);
  ok(entries.length >= 19, `rail lists ${entries.length} pages from one array`);

  // A rail entry may carry a query string — /help.html?doc=strategies is the same page
  // rendering a different document. The file check is about the page, so the query is
  // stripped; keeping it would fail on a link that works.
  const fileOf = h => h.replace(/^\//, '').split('?')[0];
  const missing = entries.filter(h => !fs.existsSync(path.join(PUB, fileOf(h))));
  ok(missing.length === 0,
    `every rail entry points at a file that exists${missing.length ? ': ' + missing.join(', ') : ''}`);

  // A page the rail does not list is only acceptable if it is deliberately
  // superseded. Anything else is unreachable — the defect this file was written for.
  const SUPERSEDED = ['command.html', 'command-pro.html', 'login.html'];
  const orphans = APP.filter(f => !entries.includes('/' + f) && !SUPERSEDED.includes(f));
  ok(orphans.length === 0,
    `no page is unreachable${orphans.length ? ': ' + orphans.join(', ') : ''}`);
}

// ── every app page mounts the rail ────────────────────────────────────────────
{
  const without = APP.filter(f => !/js\/rail\.js/.test(read(f)));
  ok(without.length === 0, `all ${APP.length} app pages include the shared rail${without.length ? ' — missing: ' + without.join(', ') : ''}`);
  ok(!/js\/rail\.js/.test(read('login.html')),
    'login.html does not — the page list is not shown before sign-in');
}

// ── @test:regression — no page rebuilds its own page-list nav ─────────────────
{
  const offenders = [];
  for (const f of pages) {
    for (const m of read(f).matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi)) {
      const links = (m[0].match(/href="\/?[a-z0-9-]*\.html"/gi) || []).length
                  + (m[0].match(/href="\/"/g) || []).length;
      if (links >= 3) offenders.push(`${f} (${links} links)`);
    }
  }
  ok(offenders.length === 0,
    `no page duplicates the rail's list${offenders.length ? ': ' + offenders.join(', ') : ''}`);
}

// ── the fit contract ──────────────────────────────────────────────────────────
{
  const fit = fs.readFileSync(path.join(PUB, 'js', 'fit.js'), 'utf8');

  // @test:failure — the two bugs that made an earlier version wrong
  ok(!/maxHeight\s*=\s*['"]none['"]/.test(fit),
    'the cap is never cleared to take a reading — doing so resized the body, woke the observer, and left the region unbounded');
  ok(/position\s*===\s*['"]static['"]/.test(fit),
    'the region is made a containing block — a static scroll container does not clip absolutely positioned descendants, which left greeks.html scrolling 727px for sr-only captions');
  ok(/if \(next === had\) return;/.test(fit),
    'an unchanged height writes no style, so the observer settles instead of looping');

  // @test:memory-leak / @test:performance — bounded work per frame
  ok(/requestAnimationFrame/.test(fit) && /pending/.test(fit),
    'recomputes are coalesced to one per frame');
  ok(!/setInterval/.test(fit), 'no polling timer is left running on every page');

  // @test:integration — exactly one region per page, or none.
  // Counted as an attribute inside a tag, not as text: dashboard.html mentions
  // data-fit in a code comment, and querySelector does not read comments.
  const marks = s => (s.match(/<[a-z][^>]*\sdata-fit(?=[\s>=])/gi) || []).length;
  const multi = [];
  for (const f of pages) {
    const n = marks(read(f));
    if (n > 1) multi.push(`${f} (${n})`);
  }
  ok(multi.length === 0,
    `no page marks more than one fit region${multi.length ? ': ' + multi.join(', ') : ''}`);

  // A page that marks a region must load the script, or the mark does nothing.
  const marked = pages.filter(f => marks(read(f)) === 1);
  const unwired = marked.filter(f => !/js\/fit\.js/.test(read(f)));
  ok(marked.length >= 10, `${marked.length} pages opt into the viewport fit`);
  ok(unwired.length === 0,
    `every marked page loads fit.js${unwired.length ? ' — missing: ' + unwired.join(', ') : ''}`);
}

// ── @test:rollback — removing fit.js leaves the pages readable ────────────────
{
  const fit = fs.readFileSync(path.join(PUB, 'js', 'fit.js'), 'utf8');
  ok(/if \(!region\(\)\) return;/.test(fit),
    'a page without a marked region is untouched, so the script is safe to drop anywhere');
  const styled = [];
  for (const f of pages) {
    // The cap must come from the script, not from CSS: with the script removed a
    // hard-coded max-height would strand content inside an unscrollable box.
    if (/data-fit[^>]*style="[^"]*max-height/i.test(read(f))) styled.push(f);
  }
  ok(styled.length === 0, 'no page hard-codes the cap in markup');
}

// ── the owner's display is a first-class target ───────────────────────────────
{
  const narrow = [];
  for (const f of APP) {
    const s = read(f);
    // Only a max-width *declaration* caps the layout. The same text inside a
    // @media prelude is a breakpoint going the other way — reading those as caps
    // wrongly accused command.html, command-pro.html, oi.html and strategy.html,
    // none of which cap anything.
    const decls = s.replace(/@media[^{]*\{/g, '{');
    if (!/max-width\s*:\s*\d+px/.test(decls)) continue;     // fluid page: nothing to lift
    if (!/@media\s*\(\s*min-width\s*:\s*(19|2[0-9])\d\dpx/.test(s)) narrow.push(f);
  }
  ok(narrow.length === 0,
    `every capped page lifts its cap for a wide display${narrow.length ? ' — still laptop-only: ' + narrow.join(', ') : ''}`);
}

// ── type scale: nothing on the owner's panel may be laptop-sized ──────────────
{
  // Measured in headless Edge at 2560x1330 before this ratchet existed: the dominant
  // rendered text was under 13px on 17 of 22 pages — ami-heatmap at 7px, heatmap 8px,
  // charts4 9px. Three mechanisms carry the fix, and each is asserted here because
  // each was needed for a different set of pages.
  const tokens = fs.readFileSync(path.join(PUB, 'css', 'tokens.css'), 'utf8');
  const wide = /@media\s*\(\s*min-width:\s*(19|2[0-9])\d\dpx\s*\)\s*\{\s*:root\s*\{([^}]*)\}/g;
  const steps = [...tokens.matchAll(wide)];
  ok(steps.length >= 2, `the shared type scale has ${steps.length} wide-display steps`);
  ok(steps.every(m => /--fs-xs:\s*1[3-9]/.test(m[2])),
    'even the smallest shared token (--fs-xs) clears 13px on a wide display');
  ok(steps.every(m => !/--sp-\d/.test(m[2])),
    'only type tokens move — spacing is untouched, so the layout does not shift');

  // Pages whose rem scale drives font-size get a lifted root.
  const scaled = APP.filter(f => /AG-ROOT-SCALE/.test(read(f)));
  ok(scaled.length >= 13, `${scaled.length} pages lift their root for the panel`);

  // Highcharts writes font-size straight into SVG, where no stylesheet reaches it.
  const c4 = read('charts4.html');
  ok(!/fontSize:\s*'\d+px'/.test(c4),
    'chart labels are not pinned to a literal px size — they were the smallest text in the app at 8-9px');
  ok(/matchMedia\('\(min-width:2400px\)'\)/.test(c4),
    'and are sized from the same breakpoints the CSS uses');
}

// ── the high/low mapping contract, shared by both heatmaps ───────────────────
{
  // Both pages answer the same question about a strike, so they must answer it the
  // same way. signal-heatmap showed two prices and a pin; ami-heatmap showed no
  // range at all. Each leg on both now states the session high and low, the range
  // in points, and what one lot of that range is worth.
  for (const f of ['signal-heatmap.html', 'ami-heatmap.html']) {
    const s = read(f);
    ok(/<i>pts<\/i>/.test(s), `${f} states the range in points`);
    ok(/<i>\/lot<\/i>/.test(s), `${f} states what one lot of it is worth`);
    ok(/instrument-meta\.js/.test(s), `${f} takes the lot from the registry, not a constant`);
    ok(/window\.instLot/.test(s) && /return null;/.test(s),
      `${f} fails closed when the lot is unknown`);
  }

  // A zero range is worth zero rupees, and that is a fact. Reserving null for the
  // lot we genuinely lack is what keeps the dash meaningful — both pages first
  // printed a dash on every strike whose high equalled its low.
  for (const [f, fn] of [['ami-heatmap.html', 'function hlMoney'],
                         ['signal-heatmap.html', 'function rangeMoney']]) {
    const s = read(f);
    const body = s.slice(s.indexOf(fn), s.indexOf(fn) + 700);
    ok(/pts < 0/.test(body) && !/pts <= 0/.test(body),
      `${f}: a zero range yields ₹0, not a dash — null means "no lot", never "no movement"`);
  }
}

// ── the measurement tool is part of the repo, not of one session ─────────────
{
  // Every UI claim in docs/052 and docs/053 came from scripts in a session
  // scratchpad. docs/052 §7 said promoting them was the next step, because a
  // measurement nobody can repeat is an assertion with extra steps. It also caught a
  // real regression the moment it was checked in: pop.html fitted in Edge and
  // scrolled 422px in Chrome once the shared type tokens grew.
  const REPO = path.join(__dirname, '..');
  const tool = path.join(REPO, 'tools', 'ui-measure.js');
  ok(fs.existsSync(tool), 'tools/ui-measure.js is checked in');
  const src = fs.readFileSync(tool, 'utf8');
  for (const c of ['scroll', 'fonts', 'colours', 'clip', 'requests'])
    { assert.ok(new RegExp(`case '${c}'`).test(src), `it can measure ${c}`); pass++; }
  console.log('  ✓ it measures scroll, fonts, colours, clipping and request rate');

  ok(/window\.scrollTo\(0, 100000\)/.test(src),
    'scroll is measured by attempting it, not by trusting scrollHeight');
  ok(/userDataDir/.test(src),
    'each run gets its own browser profile — a leftover locked one fails every later launch');
  ok(/hands off to an already-running instance/.test(src),
    'and the Edge handoff trap is written down where the next person hits it');
  ok(/process\.exit\(code\)/.test(src),
    'it exits non-zero when a page fails, so it can gate a commit rather than just inform');

  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  ok(!!(pkg.devDependencies && pkg.devDependencies['puppeteer-core']),
    'puppeteer-core is a devDependency — no browser is downloaded, an installed one is driven');
}

// ── the rail is fully open, not hidden behind tabs ────────────────────────────
{
  const rail = fs.readFileSync(path.join(PUB, 'js', 'rail.js'), 'utf8');

  const tabKeys = [...rail.matchAll(/\{\s*k:\s*'([a-z]+)',\s*i:/g)].map(m => m[1]);
  ok(tabKeys.length >= 6, `the rail declares ${tabKeys.length} navigation groups`);
  ok(tabKeys.includes('stock') && tabKeys.includes('options'),
    'stock and options are separate groups — different instruments, lot sizes and strategies');
  ok(tabKeys.includes('data') && tabKeys.includes('research'),
    'data and research are separate groups: data is what we HAVE, research is what we ' +
    'CONCLUDE from it, and merging them is how a gap in the archive becomes a backtest ' +
    'result nobody questions');
  ok(/\/stock\.html\?tab=propicks/.test(rail),
    'ProPicks is directly reachable from Research, not only hidden inside Stock View');

  const pages = [...rail.matchAll(/\{\s*h:\s*'([^']+)',[^}]*k:\s*'([a-z]+)'/g)]
    .map(m => ({ h: m[1], k: m[2] }));
  ok(pages.length >= 19, `${pages.length} pages carry a group key`);

  const strays = pages.filter(p => !tabKeys.includes(p.k));
  ok(strays.length === 0,
    `every page names a group that exists${strays.length ? ': ' + strays.map(p => p.h).join(', ') : ''}`);

  ok(/WHY IT IS FULLY OPEN/.test(rail),
    'the rail documents that every group is visible at once, not hidden inside a selected tab');
  ok(!/role="tablist"|agrailTabs|selectTab|activeTab|TABKEY/.test(rail),
    'the rail has no tablist, selected-tab state, or category-click navigation');
  ok(/for \(var g = 0; g < TABS\.length; g\+\+\)/.test(rail) && /<section class="agrail-group">/.test(rail),
    'renderPages walks every group and prints a section for each one');

  // The dashboard and the connection state open together: when a number looks
  // wrong the first question is whether the feed is stale.
  const live = pages.filter(p => p.k === 'live').map(p => p.h);
  ok(live.includes('/dashboard.html') && live.includes('/health-dashboard.html') && live.includes('/readiness.html'),
    'the readiness and connection views sit with the dashboard, not inside a hidden group');
  ok(/agrail-status/.test(rail) && /Readiness/.test(rail) && /Blocked/.test(rail),
    'risky/live surfaces carry visible status chips in the open rail');
  ok(/id="agrailCommand" href="\/dashboard\.html"/.test(rail) && /id="agrailFull"/.test(rail),
    'the rail top has direct Command and Fullscreen buttons');
  ok(/html\.agrail-min \.agrail-btn,html\.agrail-min \.agrail-tg\{display:grid/.test(rail),
    'collapsed rail keeps command, fullscreen and expand buttons visible');
  ok(/requestFullscreen/.test(rail) && /exitFullscreen/.test(rail) && /e\.key === 'f'/.test(rail),
    'fullscreen can be toggled from the button or the f key');

  ok(/var W = 276, WMIN = 64/.test(rail),
    'the fully-open rail is wider and less cramped than the old 210px sidebar');
  ok(/fully-open group navigation/.test(rail) && /agrail-group/.test(rail) && /agrail-section/.test(rail),
    'the rail uses fully-open grouped sections, not an inside-tab view');
  ok(/\.agrail-group\{display:grid;grid-template-columns:1fr 1fr/.test(rail),
    'the open rail uses two compact columns so side options stay visible on a normal-height screen');
}

// ── dashboard health tab must not squeeze validation cards ───────────────────
{
  const dash = read('dashboard.html');
  const healthSections = [...dash.matchAll(/<section data-tab="health" class="pane ([^"]+)"/g)].map(m => m[1]);
  ok(healthSections.length === 1 && healthSections[0] === 'full',
    `dashboard health tab is one full-width pane, not duplicated compact cards (${healthSections.join(', ')})`);
  ok(/health-board/.test(dash) && /health-grid validation/.test(dash) && /plan-grid/.test(dash),
    'health tab uses the redesigned board/grid layout so all validation points stay visible');
}

console.log(`\n${pass} assertions passed`);
