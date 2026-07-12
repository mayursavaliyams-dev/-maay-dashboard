#!/usr/bin/env node
'use strict';
/**
 * Performance target report.
 *
 *   npm run perf:report              # measures whatever it can, reports UNKNOWN for the rest
 *   PORT=3000 npm run perf:report    # measures a RUNNING server's real routes
 *
 * THIS SCRIPT NEVER BOOTS `server.js`. Requiring it starts the strangle, agents and gamma-blast
 * engines, writes `data/*.json`, and appends to the forward-test ledger that gates live approval.
 * Measuring latency is not worth corrupting the evidence. If no server is listening, the API
 * target is reported as UNKNOWN — never as met.
 *
 * Every line is one of: VERIFIED (measured, meets target), MISSED (measured, fails target),
 * or UNKNOWN (not measurable from here, and why). Nothing passes by silence.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const PORT = process.env.PORT || null;
const rows = [];
const row = (target, state, detail) => rows.push({ target, state, detail });

const strip = (s) => s.replace(/\r/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

const prodFiles = () => require('child_process')
  .execSync('git ls-files "*.js"', { cwd: ROOT }).toString().trim().split('\n')
  .filter((f) => !/^(test|scripts|stock|backtest-real|backtest-tv|deprecated)\//.test(f))
  .filter((f) => !/^(bt-|export-)/.test(f));

async function main() {
  // ── API <50ms ──────────────────────────────────────────────────────────────
  if (!PORT) {
    row('API < 50 ms', 'UNKNOWN',
      'no PORT given. Start the server, then `PORT=3000 npm run perf:report`. ' +
      'This script refuses to boot server.js: doing so starts the engines and writes ledgers.');
  } else {
    const routes = ['/healthz', '/api/quant', '/api/strangle/status'];
    for (const r of routes) {
      const t = [];
      let failed = null;
      for (let i = 0; i < 30; i++) {
        const t0 = process.hrtime.bigint();
        try { await fetch(`http://127.0.0.1:${PORT}${r}`); }
        catch (e) { failed = e.message; break; }
        t.push(Number(process.hrtime.bigint() - t0) / 1e6);
      }
      if (failed) { row(`API ${r}`, 'UNKNOWN', `no server listening on :${PORT} (${failed})`); continue; }
      t.sort((a, b) => a - b);
      const p50 = t[Math.floor(t.length * 0.5)], p95 = t[Math.floor(t.length * 0.95)];
      row(`API ${r} < 50 ms`, p95 < 50 ? 'VERIFIED' : 'MISSED',
        `p50 ${p50.toFixed(1)} ms · p95 ${p95.toFixed(1)} ms · n=${t.length}`);
    }
  }

  // ── WebSocket latency <100ms ───────────────────────────────────────────────
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const hasWsServer = /new\s+(WebSocket\.Server|WebSocketServer)/.test(server);
  row('WebSocket latency < 100 ms', hasWsServer ? 'UNKNOWN' : 'UNKNOWN',
    hasWsServer ? 'a WS server exists but no client harness measures it'
      : 'NO WebSocket server exists. `ws` is a broker CLIENT in dhan-ws-feed.js. ' +
        'server.js discards the http.Server from app.listen(), so nothing can attach.');

  // ── Dashboard refresh 250 ms ───────────────────────────────────────────────
  const dash = fs.readFileSync(path.join(ROOT, 'public', 'dashboard.html'), 'utf8');
  const iv = [...dash.matchAll(/setInterval\([^,]+,\s*(\d+)\)/g)].map((m) => Number(m[1]));
  const fastest = Math.min(...iv);
  row('Dashboard refresh 250 ms', 'MISSED',
    `${iv.length} independent polling timers, fastest ${fastest} ms. 250 ms is a RENDER budget, ` +
    `not a poll interval: ${iv.length} timers at 250 ms = ${(iv.length * 4)} req/s per open tab ` +
    'against a single-threaded monolith. Reaching it requires the WebSocket server (UI-03).');

  // ── Memory leak 0 ──────────────────────────────────────────────────────────
  const pop = require(path.join(ROOT, 'pop-seller.js'));
  let book = [{ id: 1, status: 'OPEN' }];
  for (let i = 0; i < 20000; i++) { book.push({ id: i + 2, status: 'CLOSED' }); book = pop._bounded(book); }
  const bounded = book.length <= 2001 && book.some((p) => p.status === 'OPEN');
  row('Memory leak 0', bounded ? 'VERIFIED' : 'MISSED',
    `pop-seller book bounded at ${book.length} rows after 20k round-trips, open position retained. ` +
    'Zero-leak cannot be PROVEN by heap sampling; the bounding invariants are asserted instead. ' +
    'Run the suite with --expose-gc for heap corroboration.');

  // ── CPU under 20% ──────────────────────────────────────────────────────────
  row('CPU under 20%', 'UNKNOWN',
    'process.cpuUsage() here measures this script, not a production server during market hours. ' +
    'Reporting it would be a lie dressed as a measurement.');

  // ── All writes atomic ──────────────────────────────────────────────────────
  let rawWrites = 0; const wFiles = [];
  for (const f of prodFiles()) {
    if (f === 'safe-write.js') continue;
    // Any receiver: server.js writes through `fs`, `_fs`, `fs2`, `_fs2`, `_persistFs` and `_sigFs`.
    const c = (strip(fs.readFileSync(path.join(ROOT, f), 'utf8')).match(/\.writeFileSync\(/g) || []).length;
    if (c) { rawWrites += c; wFiles.push(`${f}(${c})`); }
  }
  row('All writes atomic', rawWrites === 0 ? 'VERIFIED' : 'MISSED',
    `${rawWrites} raw writeFileSync remain: ${wFiles.join(', ')}. 17 production writers migrated ` +
    '(15 modules + server.js:3675 and :3575). server.js is PROTECTED; the remaining 8 sites each ' +
    'need their own approval package.');

  // ── All reads validated ────────────────────────────────────────────────────
  let rawReads = 0; const rFiles = [];
  for (const f of prodFiles()) {
    const c = (strip(fs.readFileSync(path.join(ROOT, f), 'utf8')).match(/JSON\.parse\([^)]*readFileSync/g) || []).length;
    if (c) { rawReads += c; rFiles.push(`${f}(${c})`); }
  }
  row('All reads validated', rawReads === 0 ? 'VERIFIED' : 'MISSED',
    `${rawReads} unvalidated reads: ${rFiles.join(', ')}. Two are legitimate injected-fake test ` +
    'seams (signal-health, event-risk-filter); 11 are in the protected monolith.');

  // ── No silent catch ────────────────────────────────────────────────────────
  let silent = 0; const sFiles = [];
  for (const f of prodFiles()) {
    const c = (strip(fs.readFileSync(path.join(ROOT, f), 'utf8'))
      .match(/catch\s*(\([_a-zA-Z]*\)\s*)?\{\s*\}/g) || []).length;
    if (c) { silent += c; sFiles.push([c, f]); }
  }
  sFiles.sort((a, b) => b[0] - a[0]);
  row('No silent catch', silent === 0 ? 'VERIFIED' : 'MISSED',
    `${silent} silent catches across ${sFiles.length} files. Worst: ` +
    sFiles.slice(0, 3).map(([c, f]) => `${f}(${c})`).join(', ') + '. ' +
    'Three in safe-write.js are defensible (fd close while unwinding, orphan-temp cleanup) but ' +
    'are still counted: a rule with an unwritten exception list is a rule that erodes.');

  // ── print ──────────────────────────────────────────────────────────────────
  const pad = (s, n) => String(s).padEnd(n);
  const colour = { VERIFIED: '\x1b[32m', MISSED: '\x1b[31m', UNKNOWN: '\x1b[33m' };
  console.log('\n  PERFORMANCE TARGETS — measured ' + new Date().toISOString().slice(0, 10) + '\n');
  for (const r of rows) {
    console.log(`  ${colour[r.state]}${pad(r.state, 9)}\x1b[0m ${pad(r.target, 30)}`);
    console.log(`            ${r.detail.replace(/(.{92}) /g, '$1\n            ')}\n`);
  }
  const v = rows.filter((r) => r.state === 'VERIFIED').length;
  const m = rows.filter((r) => r.state === 'MISSED').length;
  const u = rows.filter((r) => r.state === 'UNKNOWN').length;
  console.log(`  ${v} verified · ${m} missed · ${u} unknown\n`);
  console.log('  UNKNOWN is not a pass. A target with no measurement behind it has not been met.\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
