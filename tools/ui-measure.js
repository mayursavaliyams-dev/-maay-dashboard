#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   ui-measure — measure the running UI instead of judging it by eye.

   WHY THIS IS IN THE REPO
     Every UI claim made on 2026-07-28/29 — "no page scrolls", "the type is 13px or
     more", "one palette", "262 requests a minute from one tab" — was produced by
     throwing scripts into a session scratchpad. docs/052 §7 said outright that
     promoting them was the next step, because a measurement nobody else can repeat
     is an assertion with extra steps.

   USAGE
     node tools/ui-measure.js scroll   [page…]     does the page scroll at all?
     node tools/ui-measure.js fonts    [page…]     dominant and sub-12px text
     node tools/ui-measure.js colours  [page…]     bg / text / panel / gain / loss
     node tools/ui-measure.js clip     [page…]     content hidden by overflow
     node tools/ui-measure.js requests <page> [s]  real client request rate
   With no page arguments the first four sweep every page in public/.

   REQUIREMENTS
     puppeteer-core (devDependency) and a Chrome or Edge already on the machine.
     Nothing is downloaded.

   TWO THINGS LEARNED THE HARD WAY, BOTH ENCODED BELOW
     · Launching msedge.exe while the user's own Edge is running makes the new
       process hand off to the existing instance and exit 0. Puppeteer reports
       "Failed to launch the browser process: Code: 0" with an empty stderr, which
       reads as "Edge is broken" and is not. Chrome is preferred for that reason,
       and the message says so when no browser works.
     · A killed run leaves a locked profile in TEMP and every later launch fails on
       it. Each run therefore gets its own profile directory.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.UI_MEASURE_BASE || 'http://127.0.0.1:3000';
const VW = Number(process.env.UI_MEASURE_W) || 2560;
const VH = Number(process.env.UI_MEASURE_H) || 1330;

/* Chrome first — see the header. Edge is a fallback, not a preference. */
const CANDIDATES = [
  process.env.UI_MEASURE_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function findBrowser() {
  for (const c of CANDIDATES) if (fs.existsSync(c)) return c;
  return null;
}

function pagesInPublic() {
  return fs.readdirSync(path.join(ROOT, 'public'))
    .filter(f => f.endsWith('.html') && f !== 'login.html')   // login is pre-auth
    .sort();
}

async function open() {
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); }
  catch (_) {
    console.error('puppeteer-core is not installed. Run:  npm i -D puppeteer-core');
    process.exit(2);
  }
  const exe = findBrowser();
  if (!exe) {
    console.error('No Chrome or Edge found. Set UI_MEASURE_BROWSER to a browser executable.');
    process.exit(2);
  }
  // A fresh profile per run. A leftover locked one makes every later launch fail
  // with an empty stderr, which is a very expensive thing to debug twice.
  const profile = path.join(os.tmpdir(), 'ui-measure-' + process.pid + '-' + Date.now());
  let b;
  try {
    b = await puppeteer.launch({ executablePath: exe, headless: 'new', userDataDir: profile,
      args: [`--window-size=${VW},${VH}`, '--no-sandbox', '--disable-gpu'] });
  } catch (e) {
    console.error(`Could not launch ${path.basename(exe)}: ${String(e.message).split('\n')[0]}`);
    if (/msedge/i.test(exe))
      console.error('Edge hands off to an already-running instance and exits, which looks like a crash. Install Chrome or close Edge.');
    process.exit(2);
  }
  const p = await b.newPage();
  await p.setViewport({ width: VW, height: VH });
  return { b, p, profile, exe };
}

const settle = ms => new Promise(r => setTimeout(r, ms));

async function visit(p, name, wait = 2200) {
  await p.goto(`${BASE}/${name}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await settle(wait);
}

/* ── scroll ──────────────────────────────────────────────────────────────────
   Tries to scroll and reads where it landed. scrollHeight is not used on purpose:
   on a page whose only tall content sits inside an overflow:auto region it still
   reports the inner extent while the page itself does not move. */
async function cmdScroll(names) {
  const { b, p } = await open();
  console.log(`viewport ${VW}x${VH}\n`);
  console.log('page                        V-scroll   H-scroll   worst horizontal offender');
  const bad = [];
  for (const name of names) {
    try {
      await visit(p, name);
      const m = await p.evaluate(() => {
        window.scrollTo(0, 100000); const v = Math.round(window.scrollY);
        window.scrollTo(100000, 0); const h = Math.round(window.scrollX);
        window.scrollTo(0, 0);
        let worst = null;
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect();
          if (!r.width) continue;
          const over = r.right - window.innerWidth;
          if (over > 2 && (!worst || over > worst.over))
            worst = { over: Math.round(over), s: el.tagName.toLowerCase() +
              (el.id ? '#' + el.id : '') + (el.className ? '.' + String(el.className).slice(0, 28) : '') };
        }
        return { v, h, worst };
      });
      if (m.v || m.h) bad.push({ name, ...m });
      console.log(`${name.padEnd(26)} ${(m.v ? m.v + 'px' : 'none').padStart(8)}   ${(m.h ? m.h + 'px' : 'none').padStart(8)}   ${m.h && m.worst ? m.worst.s + ' +' + m.worst.over + 'px' : ''}`);
    } catch (e) { console.log(`${name.padEnd(26)}  FAIL  ${String(e.message).slice(0, 60)}`); }
  }
  await b.close();
  console.log(`\n${names.length - bad.length}/${names.length} pages do not scroll at all`);
  for (const r of bad) console.log(`   ${r.name.padEnd(26)} ${r.v ? r.v + 'px down' : ''} ${r.h ? r.h + 'px across' : ''}`);
  return bad.length ? 1 : 0;
}

/* ── fonts ─────────────────────────────────────────────────────────────────── */
async function cmdFonts(names) {
  const { b, p } = await open();
  console.log('page                       root   dominant   under-12px elements');
  const bad = [];
  for (const name of names) {
    try {
      await visit(p, name, 2500);
      const d = await p.evaluate(() => {
        const buckets = {};
        for (const el of document.querySelectorAll('body *')) {
          if (el.closest('.agrail')) continue;               // the rail sizes itself in px
          if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
          if (!el.getBoundingClientRect().height) continue;
          const px = Math.round(parseFloat(getComputedStyle(el).fontSize));
          buckets[px] = (buckets[px] || 0) + 1;
        }
        const e = Object.entries(buckets).map(([k, v]) => [+k, v]);
        const dom = e.sort((a, c) => c[1] - a[1])[0] || [0, 0];
        return { root: parseFloat(getComputedStyle(document.documentElement).fontSize),
                 dom: dom[0],
                 small: e.filter(([px]) => px < 12).reduce((a, [, v]) => a + v, 0),
                 total: e.reduce((a, [, v]) => a + v, 0) };
      });
      if (d.dom < 13) bad.push({ name, ...d });
      console.log(`${name.padEnd(26)} ${String(d.root).padStart(4)}px  ${String(d.dom).padStart(5)}px   ${String(d.small).padStart(4)} of ${d.total}`);
    } catch (e) { console.log(`${name.padEnd(26)} FAIL ${String(e.message).slice(0, 40)}`); }
  }
  await b.close();
  console.log(`\n${names.length - bad.length}/${names.length} pages have dominant text at 13px or more`);
  for (const r of bad) console.log(`   ${r.name.padEnd(26)} dominant ${r.dom}px`);
  return bad.length ? 1 : 0;
}

/* ── colours ───────────────────────────────────────────────────────────────── */
async function cmdColours(names) {
  const { b, p } = await open();
  const rows = [];
  console.log('page                       body bg          body text        commonest panel   green      red');
  for (const name of names) {
    try {
      await visit(p, name, 2000);
      const d = await p.evaluate(() => {
        const cs = getComputedStyle(document.body);
        const bg = {};
        for (const el of document.querySelectorAll('body *')) {
          if (el.closest('.agrail')) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 80 || r.height < 24) continue;
          const c = getComputedStyle(el).backgroundColor;
          if (!c || c === 'rgba(0, 0, 0, 0)') continue;
          bg[c] = (bg[c] || 0) + 1;
        }
        const panel = Object.entries(bg).sort((a, c) => c[1] - a[1])[0];
        const root = getComputedStyle(document.documentElement);
        const pick = ns => { for (const n of ns) { const v = root.getPropertyValue(n).trim(); if (v) return v; } return '—'; };
        return { bg: cs.backgroundColor, text: cs.color, panel: panel ? panel[0] : '—',
                 green: pick(['--green', '--up', '--gain']), red: pick(['--red', '--dn', '--loss']) };
      });
      rows.push(d);
      console.log(`${name.padEnd(26)} ${d.bg.padEnd(16)} ${d.text.padEnd(16)} ${d.panel.padEnd(17)} ${d.green.padEnd(10)} ${d.red}`);
    } catch (e) { console.log(`${name.padEnd(26)} FAIL ${String(e.message).slice(0, 40)}`); }
  }
  await b.close();
  let drift = 0;
  for (const k of ['bg', 'text', 'panel', 'green', 'red']) {
    const m = {}; for (const r of rows) m[r[k]] = (m[r[k]] || 0) + 1;
    const t = Object.entries(m).sort((a, c) => c[1] - a[1]);
    console.log(`\n${k}: ${t.length} distinct value(s)`);
    for (const [v, c] of t) console.log(`   ${String(c).padStart(3)} x  ${v}`);
    if (['text', 'green', 'red'].includes(k) && t.length > 1) drift++;
  }
  return drift ? 1 : 0;
}

/* ── clip ──────────────────────────────────────────────────────────────────── */
async function cmdClip(names) {
  const { b, p } = await open();
  let found = 0;
  for (const name of names) {
    try {
      await visit(p, name, 1800);
      const hits = await p.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el);
          const hidY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
          const hidX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
          const dy = el.scrollHeight - el.clientHeight, dx = el.scrollWidth - el.clientWidth;
          if ((hidY && dy > 8) || (hidX && dx > 8)) {
            // .sr-only is meant to be invisible; reporting it as hidden data is noise.
            if (/(^|\s)sr-only(\s|$)/.test(String(el.className))) continue;
            out.push({ dy: hidY ? dy : 0, dx: hidX ? dx : 0,
                       s: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
                          (el.className ? '.' + String(el.className).trim().split(/\s+/).join('.') : ''),
                       txt: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 46) });
          }
        }
        return out.sort((a, c) => (c.dy + c.dx) - (a.dy + a.dx)).slice(0, 6);
      });
      if (!hits.length) { console.log(`${name.padEnd(24)} clean`); continue; }
      found += hits.length;
      console.log(`${name.padEnd(24)} ${hits.length} CLIPPED region(s):`);
      for (const h of hits)
        console.log(`     ${h.dy ? h.dy + 'px below ' : ''}${h.dx ? h.dx + 'px right ' : ''} ${h.s.slice(0, 56)}  "${h.txt}"`);
    } catch (e) { console.log(`${name.padEnd(24)} FAIL ${String(e.message).slice(0, 40)}`); }
  }
  await b.close();
  console.log(`\n${found} clipped region(s) that are not sr-only`);
  return found ? 1 : 0;
}

/* ── requests ──────────────────────────────────────────────────────────────── */
async function cmdRequests(name, secs) {
  const { b, p } = await open();
  const hits = {};
  p.on('request', r => {
    const u = r.url();
    if (!/\/api\/|\/wh\//.test(u)) return;
    const key = u.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    hits[key] = (hits[key] || 0) + 1;
  });
  await p.goto(`${BASE}/${name}`, { waitUntil: 'networkidle2', timeout: 30000 });
  // Discard the initial paint: what matters is steady-state polling.
  await settle(5000);
  for (const k of Object.keys(hits)) delete hits[k];
  console.log(`watching ${name} for ${secs}s of steady-state polling...`);
  await settle(secs * 1000);
  await b.close();
  const rows = Object.entries(hits).sort((a, c) => c[1] - a[1]);
  const total = rows.reduce((a, [, v]) => a + v, 0);
  console.log(`\nendpoint                                       calls   per min`);
  for (const [k, v] of rows) console.log(`  ${k.padEnd(46)} ${String(v).padStart(4)}   ${(v / secs * 60).toFixed(1)}`);
  console.log(`\n  TOTAL ${total} requests in ${secs}s = ${(total / secs * 60).toFixed(0)}/min from ONE open tab`);
  return 0;
}

(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  const names = rest.filter(a => a.endsWith('.html'));
  const list = names.length ? names : pagesInPublic();
  let code = 0;
  switch (cmd) {
    case 'scroll':   code = await cmdScroll(list); break;
    case 'fonts':    code = await cmdFonts(list); break;
    case 'colours':
    case 'colors':   code = await cmdColours(list); break;
    case 'clip':     code = await cmdClip(list); break;
    case 'requests': code = await cmdRequests(names[0] || 'dashboard.html', Number(rest.find(a => /^\d+$/.test(a))) || 60); break;
    default:
      console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].split('USAGE')[1].split('REQUIREMENTS')[0].trim());
      code = 2;
  }
  process.exit(code);
})().catch(e => { console.error('ui-measure failed:', e.message); process.exit(2); });
