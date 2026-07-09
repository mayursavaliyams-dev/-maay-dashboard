/**
 * Repository integrity — every local `require()` must resolve to a GIT-TRACKED file.
 * Run: node test/repo-integrity.test.js
 *
 * Created as part of MIGRATION C1c-0a.
 *
 * Bug that shipped: `crash-analyzer.js`, `forward-test-logger.js` and `backtest-tv/run.js`
 * existed on disk and were `require`d by tracked source, but were never `git add`ed.
 * Because `server.js:2168` requires crash-analyzer at top level, and `server.js:3533`
 * constructs `new StrangleEngine()` (whose constructor requires forward-test-logger),
 * a fresh `git clone && npm install && npm start` died at boot with MODULE_NOT_FOUND.
 * `Dockerfile:11` does `COPY . .`, so a LOCAL docker build copied the untracked files and
 * worked — which is exactly why nobody noticed. Only a build from a git checkout failed.
 *
 * Root cause: "the file exists on my machine" was never distinguished from "the file is in
 * the repository". A test that only checks `fs.existsSync` cannot see this class of defect.
 * These assertions check git, not the filesystem.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };

console.log('repo-integrity (migration C1c-0a)');

const ROOT = path.join(__dirname, '..');

let trackedList;
try {
  trackedList = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
} catch {
  console.log('  ⚠ not a git checkout (or git unavailable) — skipping suite');
  console.log('\n0 assertions passed');
  process.exit(0);
}

const tracked = new Set(trackedList.split('\n').filter(Boolean));
const SKIP = /^(node_modules|deprecated|backups|stock|antigravity-py)\//;

const sources = [...tracked].filter((f) => f.endsWith('.js') && !SKIP.test(f));
ok(sources.length > 20, `scanning ${sources.length} tracked .js files`);

// Comments must be stripped: a migration note quoting `require('./forward-test-logger.js')`
// is prose, not an edge in the dependency graph. (This exact false positive appears in
// test/strangle-engine.test.js:192.)
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, ''))
    .join('\n');

const REQUIRE_RX = /require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g;

const untrackedEdges = [];
const danglingEdges = [];

for (const file of sources) {
  const code = stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const dir = path.posix.dirname(file);
  let m;
  REQUIRE_RX.lastIndex = 0;
  while ((m = REQUIRE_RX.exec(code))) {
    const spec = m[1];
    const base = path.posix.normalize(`${dir}/${spec}`).replace(/^\.\//, '');
    const candidates = [base, `${base}.js`, `${base}.json`, `${base}/index.js`];

    const inGit = candidates.some((c) => tracked.has(c));
    const onDisk = candidates.some((c) => fs.existsSync(path.join(ROOT, c)));
    const line = code.slice(0, m.index).split('\n').length;

    if (!inGit && onDisk) untrackedEdges.push(`${file}:${line} → require('${spec}') resolves to an UNTRACKED file`);
    else if (!inGit && !onDisk) danglingEdges.push(`${file}:${line} → require('${spec}') resolves to NOTHING`);
  }
}

// ══ the defect C1c-0a fixed ══
{
  const detail = untrackedEdges.length ? '\n      ' + untrackedEdges.join('\n      ') : '';
  ok(untrackedEdges.length === 0,
    `C1c-0a: every local require() resolves to a git-tracked file (a fresh clone can boot)${detail}`);
}

// ══ and while we are here: no require() may point at nothing at all ══
{
  const detail = danglingEdges.length ? '\n      ' + danglingEdges.join('\n      ') : '';
  ok(danglingEdges.length === 0, `C1c-0a: no dangling require() targets${detail}`);
}

// ══ the specific modules that caused the boot crash are tracked ══
{
  for (const f of ['crash-analyzer.js', 'forward-test-logger.js', 'backtest-tv/run.js']) {
    ok(tracked.has(f), `C1c-0a: ${f} is tracked by git`);
  }
}

// ══ boot-critical requires of server.js specifically ══
{
  const server = stripComments(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'));
  const bad = [];
  REQUIRE_RX.lastIndex = 0;
  let m;
  while ((m = REQUIRE_RX.exec(server))) {
    const base = path.posix.normalize(m[1]).replace(/^\.\//, '');
    if (![base, `${base}.js`, `${base}.json`, `${base}/index.js`].some((c) => tracked.has(c))) bad.push(m[1]);
  }
  ok(bad.length === 0, `C1c-0a: every module server.js requires is in the repository${bad.length ? ' — missing: ' + bad.join(', ') : ''}`);
}

console.log(`\n${pass} assertions passed`);
