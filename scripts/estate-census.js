#!/usr/bin/env node
/**
 * estate-census — Master Prompt 8, Modules 2, 3 and 4.
 * Run: npm run census        (add --json for machine output)
 *
 * WHAT THIS ANSWERS
 *
 *   1. Every path in the WHOLE repository that can reach a broker — not just
 *      the main application.
 *   2. For each: is its send path implemented or does it throw, which controls
 *      apply, and WHAT SINGLE CHANGE WOULD MAKE IT LIVE.
 *   3. Which configuration file each deployable actually loads at runtime.
 *   4. Which environment variables are read by more than one deployable —
 *      shared arming surface.
 *   5. Where order-capable credentials are PRESENT, by file. Presence only;
 *      values are never read, printed or hashed.
 *
 * WHY IT READS THE DISK AND NOT A DOCUMENT
 *
 * A boundary described in a document drifts. Every fact below is derived from
 * the real filesystem at the moment of running, and the census is designed to
 * be re-run — the estate grows, and a snapshot taken once is a snapshot that
 * was true once.
 *
 * WHY dotenv RESOLUTION IS TREATED AS A FINDING
 *
 * `require('dotenv').config()` resolves `.env` against process.cwd(), NOT the
 * module's directory. So which credentials a deployable receives is decided by
 * the directory it was launched from — by a batch file nobody reviews — and not
 * by anything visible in its own source.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
/* antigravity-py is NOT skipped: it is a deployable with a stubbed order path
   and its own arming flag, and excluding a component from the census is exactly
   how it stops being thought about while keeping every capability it was given.
   deprecated/ IS skipped from the code scan and is instead examined by hand and
   recorded in the register — see docs/084 §1a. */
const SKIP = /(^|[\\/])(node_modules|\.git|backups|dist|deprecated|__pycache__|bt-data|data|venv|\.venv)([\\/]|$)/;

/* Broker METHODS only. `flattenAll` was here and should not have been: it is an
   entry point, not a send. Its actual send is flatten.js:128, which is counted
   and is controlled — so including the caller double-counted one path and
   labelled the wrapper "uncontrolled" while the thing it wraps is guarded. */
const ORDER_CALL = /\.(placeOrder|modifyOrder|cancelOrder)\s*\(/;
const GUARDED = /(this\.broker|guardedBroker|broker)\.(placeOrder|modifyOrder|cancelOrder)\s*\(/;

/* Credentials that can move money if a send path exists. Names only — this file
   never reads a value. */
const ORDER_CAPABLE_CREDS = [
  'DHAN_ACCESS_TOKEN', 'DHAN_CLIENT_ID', 'DHAN_API_KEY', 'DHAN_API_SECRET',
  'UPSTOX_ACCESS_TOKEN', 'KOTAK_ACCESS_TOKEN', 'KOTAK_CONSUMER_KEY',
];

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');

function walk(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (SKIP.test(rel(p))) continue;
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const ALL = walk(ROOT);
const JS = ALL.filter(f => f.endsWith('.js'));

/* ── deployables ─────────────────────────────────────────────────────────────
   A deployable is anything that can run as its own long-lived process.

   THIS DEFINITION WAS TOO NARROW ONCE, AND IT MATTERED.

   The first version counted only "a package.json with a start script". That
   found two deployables. A check against the machine's actual listening ports
   then found a THIRD process running on 3100 — warehouse-api — which has no
   package.json of its own and was therefore invisible to the census while being
   very much alive, supervised, and holding whatever the root .env gives it.

   That is precisely the failure Module 5 describes: anything running and not in
   the register is a finding. The census had the same blind spot as the register
   it was meant to check, so it could not have found it. Only the port scan did.

   A deployable is now: a package.json with a start script, OR a module that
   guards on require.main and then either listens on a port or runs a loop. */
function findStandaloneProcesses() {
  const out = [];
  for (const f of JS) {
    const r = rel(f);
    if (/(^|\/)(test|scripts)\//.test(r)) continue;
    const src = strip(fs.readFileSync(f, 'utf8'));
    if (!/require\.main\s*===\s*module/.test(src)) continue;
    const listens = /\.listen\s*\(/.test(src);
    const loops = /runLoop\s*\(|setInterval\s*\(/.test(src);
    if (!listens && !loops) continue;                 // a CLI that exits is not a deployable
    const portM = src.match(/PORT\s*=\s*parseInt\(\s*process\.env\.([A-Z0-9_]+)\s*\|\|\s*'?(\d+)/);
    out.push({ file: r, listens, loops, portVar: portM ? portM[1] : null, defaultPort: portM ? Number(portM[2]) : null });
  }
  return out;
}

/* ── Python deployables ──────────────────────────────────────────────────────
   The Node-only census missed three of these. A FastAPI app is a deployable
   whether or not anything in package.json knows about it, and one of them —
   options_algo_api — has an implemented order path and its own arming flag
   (LIVE_TRADING) that no audit of TRADE_MODE would ever have surfaced. */
const PY_ARMING = ['LIVE_TRADING', 'TRADE_MODE', 'PY_TRADE_MODE', 'BROKER'];

function findPythonDeployables() {
  const out = [];
  const PY = ALL.filter(f => f.endsWith('.py'));
  for (const f of PY) {
    const r = rel(f);
    if (/(^|\/)tests?\//.test(r)) continue;
    const src = fs.readFileSync(f, 'utf8');
    if (!/=\s*FastAPI\(/.test(src)) continue;                  // an app object, not a helper
    const arming = PY_ARMING.filter(v => new RegExp(`["']${v}["']`).test(src));
    // Order capability: does it call something that sends, or only analyse?
    const sends = /place_and_log\(|place_buy_order\(|place_order\(/.test(src);
    const stubbed = /NotImplementedError/.test(src);
    out.push({
      file: r,
      arming,
      orderCapability: sends ? 'IMPLEMENTED' : stubbed ? 'stubbed' : 'none',
      envFileDeclared: (src.match(/env_file\s*=\s*["']([^"']+)["']/) || [])[1] || null,
    });
  }
  /* Modules that are not the app object but define the config/send the app uses
     are folded in by name so their arming flags are not lost. */
  for (const f of PY) {
    const r = rel(f);
    if (/(^|\/)tests?\//.test(r)) continue;
    const src = fs.readFileSync(f, 'utf8');
    if (/=\s*FastAPI\(/.test(src)) continue;
    if (!/place_buy_order\(|def place_and_log|BaseSettings/.test(src)) continue;
    const arming = PY_ARMING.filter(v => new RegExp(`["']${v}["']`).test(src));
    if (!arming.length && !/place_buy_order\(/.test(src)) continue;
    out.push({
      file: r, arming,
      orderCapability: /place_buy_order\(/.test(src) ? 'IMPLEMENTED' : 'none',
      envFileDeclared: (src.match(/env_file\s*=\s*["']([^"']+)["']/) || [])[1] || null,
      supportModule: true,
    });
  }
  return out;
}

function findDeployables() {
  const out = [];
  for (const pkgPath of ALL.filter(f => path.basename(f) === 'package.json')) {
    let pkg;
    try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch { continue; }
    const dir = path.dirname(pkgPath);
    const start = pkg.scripts && pkg.scripts.start;
    if (!start) continue;
    const eco = path.join(dir, 'ecosystem.config.js');
    let pm2 = null;
    if (fs.existsSync(eco)) {
      try { pm2 = require(eco).apps.map(a => ({ name: a.name, script: a.script, cwd: a.cwd || null, autorestart: a.autorestart, max_restarts: a.max_restarts })); }
      catch (e) { pm2 = [{ name: `(unreadable: ${e.message})` }]; }
    }
    out.push({
      name: pkg.name || rel(dir) || 'root',
      dir: rel(dir) || '.',
      start,
      pm2,
      // dotenv resolves against cwd. Both candidates are recorded because which
      // one is loaded depends on how the process was launched.
      envIfLaunchedFromOwnDir: fs.existsSync(path.join(dir, '.env')) ? rel(path.join(dir, '.env')) : null,
      envIfLaunchedFromRoot: fs.existsSync(path.join(ROOT, '.env')) ? '.env' : null,
    });
  }
  return out;
}

/* Which deployable does a file belong to? The deepest deployable directory that
   contains it. */
function ownerOf(file, deployables) {
  const r = rel(file);
  let best = null;
  for (const d of deployables) {
    const prefix = d.dir === '.' ? '' : d.dir + '/';
    if (r.startsWith(prefix) && (!best || prefix.length > (best.dir === '.' ? 0 : best.dir.length + 1))) best = d;
  }
  return best;
}

/* ── send-path capability ────────────────────────────────────────────────────
   Is a connector's placeOrder implemented, or does it throw? Derived from the
   method body, not from a name or a comment. */
function sendPathsIn(file) {
  const src = strip(fs.readFileSync(file, 'utf8'));
  const out = [];
  const re = /async\s+(placeOrder|modifyOrder|cancelOrder)\s*\(([^)]*)\)\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    // Take a generous slice of the body — enough to see a throw or an HTTP call.
    const body = src.slice(m.index, m.index + 1200);
    const throws = /throw\b[\s\S]{0,60}(not implemented|paper mode only)/i.test(body);
    const bypassThrower = /RISK_BYPASS_ATTEMPT/.test(body);
    const sends = /_post\s*\(|_get\s*\(|fetch\s*\(|axios|request\s*\(/.test(body);
    out.push({
      method: m[1],
      implemented: !throws && sends,
      throws,
      bypassThrower,
      verdict: bypassThrower ? 'guard-stub' : throws ? 'refuses' : sends ? 'IMPLEMENTED' : 'unclear',
    });
  }
  return out;
}

/* ── env var → readers ───────────────────────────────────────────────────── */
function envMap(deployables) {
  const map = new Map();                            // VAR -> Set(deployable name)
  for (const f of JS) {
    const src = strip(fs.readFileSync(f, 'utf8'));
    const owner = ownerOf(f, deployables);
    if (!owner) continue;
    for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      if (!map.has(m[1])) map.set(m[1], new Set());
      map.get(m[1]).add(owner.name);
    }
  }
  return map;
}

/* ── credential PRESENCE, never values ───────────────────────────────────── */
function credentialPlacement() {
  const envFiles = ALL.filter(f => /(^|[\\/])\.env(\.[a-z]+)?$/.test(rel(f)) && !/\.example$/.test(f));
  return envFiles.map(f => {
    /* Split on /\r?\n/, not '\n'.
       This file is CRLF. Splitting on '\n' leaves a trailing '\r' on every
       line, and in a JavaScript regex `.` does not match '\r' (it is a line
       terminator), so `(.*)$` could never reach the end of the string and the
       match failed on EVERY line. The scanner then reported ".env: none" —
       a security scanner failing OPEN, telling the reader there were no
       order-capable credentials in a file that holds three.
       Found 2026-07-31 by comparing it against a direct read of the same file. */
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    const present = [];
    for (const line of lines) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const [, key, val] = m;
      if (!ORDER_CAPABLE_CREDS.includes(key)) continue;
      const v = val.trim().replace(/^["']|["']$/g, '');
      // Length and emptiness only. The value is never retained.
      if (v && !/^your_|_here$/.test(v)) present.push({ key, chars: v.length });
    }
    return { file: rel(f), orderCapableCredentials: present };
  });
}

/* ── the census ──────────────────────────────────────────────────────────── */
function census() {
  const deployables = findDeployables();

  const paths = [];
  for (const f of JS) {
    /* Tests and scripts are excluded from the ESTATE census: they are not
       deployed, they are not supervised, and they call placeOrder on purpose.
       Including them buries the two findings that matter under forty that do
       not. `rel()` has no leading separator, so the pattern anchors on ^ too —
       the earlier version anchored only on a separator and matched nothing,
       which is precisely the class of silent-filter bug this file exists to
       surface elsewhere. */
    if (/(^|\/)(test|scripts)\//.test(rel(f)) || /parity-harness\.js$/.test(rel(f))) continue;
    const src = strip(fs.readFileSync(f, 'utf8'));
    src.split('\n').forEach((line, i) => {
      if (!ORDER_CALL.test(line)) return;
      const owner = ownerOf(f, deployables);
      paths.push({
        file: rel(f), line: i + 1,
        deployable: owner ? owner.name : '(unowned)',
        controlled: GUARDED.test(line),
        code: line.trim().slice(0, 90),
      });
    });
  }

  const connectors = [];
  for (const f of JS) {
    if (/[\\/]test[\\/]/.test(rel(f))) continue;
    const sp = sendPathsIn(f);
    if (sp.length) connectors.push({ file: rel(f), deployable: (ownerOf(f, deployables) || {}).name || '(unowned)', methods: sp });
  }

  const env = envMap(deployables);
  const shared = [...env.entries()]
    .filter(([, readers]) => readers.size > 1)
    .map(([k, v]) => ({ variable: k, readers: [...v] }))
    .sort((a, b) => a.variable.localeCompare(b.variable));

  return { deployables, standalone: findStandaloneProcesses(), python: findPythonDeployables(), paths, connectors, shared, credentials: credentialPlacement() };
}

function report(c) {
  const L = [];
  const h = (s) => L.push('\n' + '═'.repeat(78), s, '═'.repeat(78));

  h('1 · DEPLOYABLES');
  for (const d of c.deployables) {
    L.push(`  ${d.name}`);
    L.push(`      dir              ${d.dir}`);
    L.push(`      start            ${d.start}`);
    L.push(`      pm2              ${d.pm2 ? d.pm2.map(p => `${p.name} (${p.script}, autorestart=${p.autorestart}, max=${p.max_restarts})`).join('; ') : '(none)'}`);
    L.push(`      .env loaded      ${d.envIfLaunchedFromOwnDir || '(none in its own dir)'}   ← if launched from its own directory`);
    L.push(`                       ${d.envIfLaunchedFromRoot || '(none at root)'}   ← if launched from the repository root`);
    if (d.envIfLaunchedFromOwnDir && d.envIfLaunchedFromRoot && d.dir !== '.') {
      L.push('      ⚠ TWO CANDIDATES — dotenv resolves against process.cwd(), so which credentials');
      L.push('        this deployable receives is decided by the launcher, not by its own source.');
    } else if (!d.envIfLaunchedFromOwnDir && d.envIfLaunchedFromRoot && d.dir !== '.') {
      L.push('      ⚠ NO .env OF ITS OWN — launched from the repository root it loads the ROOT .env,');
      L.push('        and therefore the root credentials.');
    }
  }

  h('1b · STANDALONE PROCESSES (no package.json — invisible to a register that only reads package.json)');
  for (const p of c.standalone) {
    L.push(`  ${p.file.padEnd(26)} ${p.listens ? `listens on ${p.portVar || '?'} (default ${p.defaultPort ?? '?'})` : ''}${p.loops ? '  runs a loop' : ''}`);
  }
  if (!c.standalone.length) L.push('  none');

  h('1c · PYTHON DEPLOYABLES (invisible to any Node-only census)');
  for (const p of c.python) {
    L.push(`  ${p.file.padEnd(34)} order:${String(p.orderCapability).padEnd(12)} arming:[${p.arming.join(', ') || 'none'}]${p.envFileDeclared ? `  env_file=${p.envFileDeclared}` : ''}${p.supportModule ? '  (support module)' : ''}`);
  }
  if (!c.python.length) L.push('  none');

  h('2 · ORDER-CAPABLE PATHS (whole estate)');
  const un = c.paths.filter(p => !p.controlled);
  for (const p of c.paths) {
    L.push(`  ${p.controlled ? '✓ controlled' : '✗ UNCONTROLLED'}  ${p.file}:${p.line}  [${p.deployable}]`);
    L.push(`       ${p.code}`);
  }
  L.push(`\n  ${c.paths.length} path(s); ${un.length} UNCONTROLLED.`);

  h('3 · SEND-PATH CAPABILITY (is it implemented, or does it throw?)');
  for (const k of c.connectors) {
    for (const m of k.methods) {
      const tag = m.verdict === 'IMPLEMENTED' ? '⚠ IMPLEMENTED' : m.verdict === 'refuses' ? '· refuses    ' : m.verdict === 'guard-stub' ? '· guard-stub ' : '? unclear    ';
      L.push(`  ${tag}  ${k.file}  ${m.method}()  [${k.deployable}]`);
    }
  }

  h('4 · SHARED ARMING SURFACE (env vars read by more than one deployable)');
  if (!c.shared.length) L.push('  none');
  for (const s of c.shared) L.push(`  ${s.variable.padEnd(30)} read by: ${s.readers.join(', ')}`);

  h('5 · ORDER-CAPABLE CREDENTIAL PLACEMENT (presence only — no values read)');
  for (const f of c.credentials) {
    if (!f.orderCapableCredentials.length) { L.push(`  ${f.file}: none`); continue; }
    L.push(`  ${f.file}:`);
    for (const k of f.orderCapableCredentials) L.push(`      ${k.key.padEnd(24)} present (${k.chars} chars)`);
  }

  return L.join('\n');
}

if (require.main === module) {
  const c = census();
  if (process.argv.includes('--json')) console.log(JSON.stringify(c, null, 2));
  else console.log(report(c));
  const uncontrolled = c.paths.filter(p => !p.controlled).length;
  process.exit(uncontrolled ? 1 : 0);          // gate-able
}

module.exports = { census, report, findDeployables, findStandaloneProcesses, findPythonDeployables, sendPathsIn, ownerOf, ORDER_CAPABLE_CREDS };
