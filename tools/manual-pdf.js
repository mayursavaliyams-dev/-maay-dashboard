#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   manual-pdf — print the user manual to a PDF.

   USAGE
     node tools/manual-pdf.js [output.pdf]     default: docs/ANTIGRAVITY-PRO-User-Manual.pdf

   It drives the real page at /help.html rather than converting the markdown
   separately, so the PDF and the screen cannot disagree. The page fetches
   docs/056-USER-MANUAL.md, which stays the single source.

   TWO THINGS THAT WOULD SILENTLY TRUNCATE IT, both handled
     · fit.js bounds the manual to the viewport height and scrolls it inside its own
       box. Printed as-is that emits ONE page and drops the rest. help.html lifts the
       cap under @media print; this tool then verifies the output is longer than a
       single page rather than trusting that it worked.
     · The page renders its content from a fetch. Printing before that resolves
       produces a PDF of the word "loading". The tool waits for real content.

   REQUIREMENTS
     puppeteer-core and an installed Chrome or Edge. Nothing is downloaded.
     Chrome is preferred: launching msedge.exe while the user's own Edge is running
     makes the new process hand off to it and exit 0, which puppeteer reports as an
     empty-stderr crash.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = process.env.UI_MEASURE_BASE || 'http://127.0.0.1:3000';
const OUT = process.argv[2] || path.join(ROOT, 'docs', 'ANTIGRAVITY-PRO-User-Manual.pdf');

const CANDIDATES = [
  process.env.UI_MEASURE_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

(async () => {
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); }
  catch (_) { console.error('puppeteer-core is not installed. Run:  npm i -D puppeteer-core'); process.exit(2); }

  const exe = CANDIDATES.find(c => fs.existsSync(c));
  if (!exe) { console.error('No Chrome or Edge found. Set UI_MEASURE_BROWSER.'); process.exit(2); }

  // A fresh profile per run: a leftover locked one fails every later launch with an
  // empty stderr, which is an expensive thing to debug twice.
  const profile = path.join(os.tmpdir(), 'manual-pdf-' + process.pid + '-' + Date.now());
  const b = await puppeteer.launch({ executablePath: exe, headless: 'new', userDataDir: profile,
    args: ['--no-sandbox', '--disable-gpu'] });
  const p = await b.newPage();

  const problems = [];
  p.on('pageerror', e => problems.push('page error: ' + e.message));
  p.on('requestfailed', r => problems.push('failed request: ' + r.url()));

  await p.goto(`${BASE}/help.html`, { waitUntil: 'networkidle2', timeout: 30000 });

  // The manual arrives by fetch. Wait for real content, not for a timer — printing
  // early would produce a PDF of the word "loading".
  await p.waitForFunction(
    () => { const el = document.getElementById('doc');
            return el && !el.classList.contains('load') && el.innerText.trim().length > 2000; },
    { timeout: 20000 },
  ).catch(() => { throw new Error('the manual never rendered — is the server up and is /docs served?'); });

  const seen = await p.evaluate(() => ({
    chars: document.getElementById('doc').innerText.length,
    headings: document.querySelectorAll('#doc h1, #doc h2, #doc h3').length,
    tables: document.querySelectorAll('#doc table').length,
  }));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  await p.pdf({
    path: OUT, format: 'A4', printBackground: true,
    margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate:
      '<div style="width:100%;font-size:8pt;color:#888;padding:0 14mm;display:flex;justify-content:space-between">' +
      '<span>ANTIGRAVITY PRO — User Manual</span>' +
      '<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
  });
  await b.close();
  fs.rmSync(profile, { recursive: true, force: true });

  const bytes = fs.statSync(OUT).size;
  // Count pages from the PDF itself. A one-page PDF means the print stylesheet did
  // not lift the viewport cap and the manual was truncated — the exact failure this
  // check exists to catch, and it would otherwise look like a successful run.
  const raw = fs.readFileSync(OUT, 'latin1');
  const pages = (raw.match(/\/Type\s*\/Page[^s]/g) || []).length;

  console.log(`wrote ${path.relative(ROOT, OUT)}`);
  console.log(`  ${(bytes / 1024).toFixed(0)} KB · ${pages} page(s)`);
  console.log(`  source: ${seen.headings} headings, ${seen.tables} tables, ${seen.chars} characters`);
  if (problems.length) { console.log('  warnings:'); for (const w of [...new Set(problems)].slice(0, 5)) console.log('    ' + w); }

  if (pages <= 1) {
    console.error('\nFAIL: one page only — the print stylesheet did not lift the viewport cap, so the manual is truncated.');
    process.exit(1);
  }
  process.exit(0);
})().catch(e => { console.error('manual-pdf failed:', e.message); process.exit(2); });
