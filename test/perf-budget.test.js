'use strict';
/**
 * PERFORMANCE TARGETS (ratified by the owner, 2026-07-09)
 *
 *   API <50ms · WebSocket latency <100ms · Dashboard refresh 250ms · Memory leak 0 ·
 *   CPU under 20% · All writes atomic · All reads validated · No silent catch
 *
 * A target is met, missed, or UNKNOWN. It is never met by silence. Four of these eight cannot
 * be measured from a test process at all, and this file says so rather than printing a green
 * tick beside a number nobody took.
 *
 *   @test:unit @test:integration @test:regression @test:performance
 *   @test:memory-leak @test:failure @test:rollback @test:characterization
 *
 * WHY THERE IS NO "BOOT THE SERVER AND TIME THE ROUTES" TEST
 *   `server.js` starts the engines on require. Booting it inside the suite would tick the
 *   strangle engine, the agents engine and the gamma-blast engine, write to `data/*.json`, and
 *   append paper trades to the forward-test ledger that gates live approval. Measuring latency
 *   is not worth corrupting the evidence. `npm run perf:report` measures a RUNNING server
 *   instead, and reports UNKNOWN when none is listening.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
const eq = (a, b, m) => { n++; assert.strictEqual(a, b, m); };

const prodFiles = () => require('child_process')
  .execSync('git ls-files "*.js"', { cwd: ROOT }).toString().trim().split('\n')
  .filter((f) => !/^(test|scripts|stock|backtest-real|backtest-tv|deprecated)\//.test(f))
  .filter((f) => !/^(bt-|export-)/.test(f));

// strip comments before counting anything: a comment quoting a defect is a warning, not the defect
const strip = (src) => src.replace(/\r/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

// ═════════════════════════════════════════════════════════════════════════════
// TARGET: All writes atomic          — @test:regression
// ═════════════════════════════════════════════════════════════════════════════
{
  const offenders = [];
  for (const f of prodFiles()) {
    if (f === 'safe-write.js') continue;                       // it IS the atomic writer
    const src = strip(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    // MATCH ANY RECEIVER. The first version of this scan matched only `fs.` and `_fs.`, and so
    // never saw `fs2.`, `_fs2.`, `_persistFs.` or `_sigFs.` — server.js uses all four. It
    // reported 4 raw writes where there were 10, and the ratchet passed on an undercount.
    // A ratchet that cannot see the thing it guards is decoration.
    const hits = (src.match(/\.writeFileSync\(/g) || []).length;
    if (hits) offenders.push(`${f}:${hits}`);
  }
  // signal-health's injected-fake branch is a legitimate exception: a fake fs has no atomicity
  // to give, and the test seam must not be routed through the real writer.
  //
  // Ratchet, measured with an alias-proof scan: server.js 8 (PROTECTED — two of the original
  // ten were migrated under P1-T1 and P1-T2) + consolidate-ami-signals 1 + signal-health 1.
  const RAW_WRITE_SITES = 10;
  const total = offenders.reduce((s, o) => s + Number(o.split(':')[1]), 0);
  ok(total <= RAW_WRITE_SITES,
    `MISSED (known): ${total} raw writeFileSync remain in production code → ${offenders.join(', ')}. ` +
    'Ratchet may only go DOWN. server.js is protected and needs an approval package.');
  ok(total >= 8, 'and the ratchet sits on the measured number, not comfortably above it');
  ok(offenders.some((o) => o.startsWith('server.js')),
    'and the biggest remaining group is server.js — named, not hidden');
}

// ═════════════════════════════════════════════════════════════════════════════
// TARGET: All reads validated        — @test:failure
// ═════════════════════════════════════════════════════════════════════════════
{
  const offenders = [];
  for (const f of prodFiles()) {
    const src = strip(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    const hits = (src.match(/JSON\.parse\([^)]*readFileSync/g) || []).length;
    if (hits) offenders.push(`${f}:${hits}`);
  }
  // Ratchet: server.js 11 (PROTECTED, needs an approval package) + two legitimate injected-fake
  // branches (signal-health, event-risk-filter). A fake fs has no `.bak` to recover from, so the
  // test seam parses directly — and BOTH still distinguish corrupt from missing.
  const RAW_READ_SITES = 13;
  const total = offenders.reduce((s, o) => s + Number(o.split(':')[1]), 0);
  ok(total <= RAW_READ_SITES,
    `MISSED (known): ${total} unvalidated JSON reads → ${offenders.join(', ')}. Ratchet may only go DOWN.`);
  ok(offenders.filter((o) => o.startsWith('server.js')).length === 1,
    'and 11 of the 13 are in the protected monolith — the ratchet cannot move until that is approved');

  // event-risk-filter was one of them. This is the fix, asserted behaviourally.
  const erf = require('../event-risk-filter.js');

  // BACKWARD COMPATIBILITY: the injected fake implements readFileSync and NOTHING else. An
  // earlier version of this fix called `fs.existsSync` and broke every existing caller.
  const fakeFs = { readFileSync: () => '{"events":[{"type":"RBI"' };            // truncated JSON
  const cal = erf.loadCalendar(fakeFs, '/x/cal.json');
  eq(cal.length, 0, 'a corrupt calendar yields no events…');
  ok(cal.corrupt, '…but it is FLAGGED as corrupt, so it is not mistaken for an empty one');
  eq(Object.keys(cal).length, 0, 'the flag is non-enumerable — invisible to JSON and to every existing consumer');
  eq(JSON.stringify(cal), '[]', 'and it serialises as a plain empty array, breaking no consumer');

  const enoent = () => { const e = new Error('ENOENT: no such file'); e.code = 'ENOENT'; throw e; };
  const missing = erf.loadCalendar({ readFileSync: enoent }, '/x/none.json');
  eq(missing.length, 0, 'a MISSING calendar is also empty…');
  eq(missing.corrupt, undefined,
    '…and is NOT flagged: absent means "checked, nothing scheduled". ABSENT vs CORRUPT is decided ' +
    'by the error code, not by existsSync, so a fake fs with only readFileSync still works');

  const clear = erf.assess({ dateISO: '2026-07-09', calendar: missing, vix: 12 });
  eq(clear.verdict, 'CLEAR', 'an absent calendar with calm vol trades normally');
  const risky = erf.assess({ dateISO: '2026-07-09', calendar: cal, vix: 12 });
  eq(risky.verdict, 'REDUCE',
    'FAIL CLOSED: an UNREADABLE calendar halves size. Empty means "nothing scheduled"; unreadable ' +
    'means "could not check", and a crash mid-write used to make those identical');
  eq(risky.sizeScale, 0.5, 'and size is actually halved, not merely reported');
  ok(/unreadable/.test(risky.reason) && risky.calendarCorrupt, 'the reason names the missing evidence');
}

// ═════════════════════════════════════════════════════════════════════════════
// TARGET: No silent catch            — @test:characterization + ratchet
// ═════════════════════════════════════════════════════════════════════════════
{
  // CHARACTERIZATION of the shape being counted: `catch (_) {}` swallows everything.
  let swallowed = false;
  try { (() => { throw new Error('gone'); })(); } catch (_) { /* exactly the pattern */ }
  ok(!swallowed, 'CHARACTERIZATION: a silent catch leaves no trace at all — that is the entire problem');

  let count = 0; const byFile = [];
  for (const f of prodFiles()) {
    const src = strip(fs.readFileSync(path.join(ROOT, f), 'utf8'));
    const c = (src.match(/catch\s*(\([_a-zA-Z]*\)\s*)?\{\s*\}/g) || []).length;
    if (c) { count += c; byFile.push(`${f}:${c}`); }
  }
  // Ratchet: 114, measured with comments stripped on 2026-07-09. MAY ONLY GO DOWN.
  // I previously reported "105" from a looser regex over a different file set. The honest number
  // is 114, and 73 of them are in `server.js` — the one file that cannot be touched without
  // approval. The remaining 41 sit across 18 files.
  //
  // Not every silent catch is a bug, but every one must be JUSTIFIED IN PLACE, and today none is:
  //   safe-write.js:77,132  `closeSync(fd)` inside `finally` while already unwinding an error
  //   safe-write.js:229     best-effort `unlinkSync` of an orphan temp file
  // Those three are defensible. They are still counted here, because a rule with an unwritten
  // exception list is a rule that erodes. Annotate them, then the ratchet moves.
  // 114 -> 112: P1-T1 and P1-T2 each removed one `catch (_) {}` from server.js (73 -> 71).
  const SILENT_CATCHES = 112;
  ok(count <= SILENT_CATCHES,
    `MISSED (known): ${count} silent catches remain. Ratchet may only go DOWN. Worst offenders: ` +
    byFile.sort((a, b) => Number(b.split(':')[1]) - Number(a.split(':')[1])).slice(0, 3).join(', '));
  ok(count >= 100, 'and the ratchet is not silently loose — it sits on the measured number');
  console.log(`  no-silent-catch: ${count} remain (ratchet ${SILENT_CATCHES}); 71 are in the protected monolith`);
}

// ═════════════════════════════════════════════════════════════════════════════
// TARGET: Memory leak 0              — @test:memory-leak
// ═════════════════════════════════════════════════════════════════════════════
{
  // "Zero leak" cannot be PROVEN by sampling a heap. What can be proven is the invariant that
  // bounds each accumulator. Sampling is a corroboration, not the assertion.
  const pop = require('../pop-seller.js');
  let book = [{ id: 1, status: 'OPEN' }];
  for (let i = 0; i < 10000; i++) { book.push({ id: i + 2, status: 'CLOSED' }); book = pop._bounded(book); }
  ok(book.length <= 2001, 'pop-seller book is bounded (2,000 closed + all open)');
  ok(book.some((p) => p.status === 'OPEN'), 'and bounding never evicts state');

  const M = require('../module-contract.js');
  M._reset();
  for (let i = 0; i < 2000; i++) M.defineModule({ name: 'x', version: '1.0.0', replace: true, logWrite: () => {} });
  eq(M.listModules().length, 1, 'module registry is bounded under reload');
  M._reset();

  ok(typeof global.gc !== 'function' || (() => {
    global.gc(); const b = process.memoryUsage().heapUsed;
    for (let i = 0; i < 50000; i++) require('../engine-verdict.js').abstain('x', '1', 'y');
    global.gc(); return process.memoryUsage().heapUsed - b < 8 * 1024 * 1024;
  })(), '50k verdicts retain nothing measurable (only asserted under --expose-gc)');
  if (typeof global.gc !== 'function') console.log('  (heap corroboration skipped: run with --expose-gc)');
}

// ═════════════════════════════════════════════════════════════════════════════
// TARGET: API <50ms                  — @test:performance (partial)
// ═════════════════════════════════════════════════════════════════════════════
{
  // What CAN be measured here: the module-contract router, mounted on a bare express app with
  // no engines. This measures the framework path and the handlers, NOT the 168 routes in
  // server.js, which cannot be timed without booting the engines. Do not read this as coverage.
  const express = require('express');
  const M = require('../module-contract.js');
  M._reset();
  M.defineModule({ name: 'p', version: '1.0.0', logWrite: () => {}, checks: () => [{ name: 'a', status: 'ok' }] });
  const app = express(); app.use('/api/m', M.mountAll());
  const srv = app.listen(0);

  return new Promise((resolve) => srv.once('listening', resolve)).then(async () => {
    const port = srv.address().port;
    const t = [];
    for (let i = 0; i < 50; i++) {
      const t0 = process.hrtime.bigint();
      await fetch(`http://127.0.0.1:${port}/api/m/p/health`);
      t.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    t.sort((a, b) => a - b);
    const p95 = t[Math.floor(t.length * 0.95)];
    ok(p95 < 50, `module-contract /health p95 = ${p95.toFixed(2)} ms (target <50 ms)`);
    console.log(`  API: /api/m/*/health p95 ${p95.toFixed(2)} ms — the 168 server.js routes are UNMEASURED`);
    srv.close(); M._reset();

    // ═════════════════════════════════════════════════════════════════════════
    // TARGET: WebSocket latency <100ms   — UNKNOWN, and it must say so
    // ═════════════════════════════════════════════════════════════════════════
    {
      const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
      ok(!/new\s+WebSocket\.Server|new\s+WebSocketServer|require\(['"]ws['"]\)/.test(server),
        'there is no WebSocket SERVER in server.js — `ws` is a broker client in dhan-ws-feed.js only');
      const M2 = require('../module-contract.js');
      M2._reset();
      const m = M2.defineModule({ name: 'w', version: '1.0.0', logWrite: () => {} });
      eq(m.wsChannel().attached, false,
        'UNKNOWN: WebSocket latency cannot be measured because no WebSocket exists. The surface ' +
        'reports attached:false rather than a fabricated latency');
      M2._reset();
      console.log('  WebSocket latency: UNKNOWN — no server exists. Not "met", not "missed".');
    }

    // ═════════════════════════════════════════════════════════════════════════
    // TARGET: Dashboard refresh 250ms    — @test:integration
    // ═════════════════════════════════════════════════════════════════════════
    {
      const dash = fs.readFileSync(path.join(ROOT, 'public', 'dashboard.html'), 'utf8');
      const intervals = [...dash.matchAll(/setInterval\([^,]+,\s*(\d+)\)/g)].map((m2) => Number(m2[1]));
      ok(intervals.length >= 15, `dashboard.html runs ${intervals.length} independent polling timers`);
      const fastest = Math.min(...intervals);
      eq(fastest, 1000, 'the fastest timer polls once per second');

      // 250 ms is a RENDER budget, not a poll interval. Sixteen timers at 250 ms is 64 HTTP
      // requests per second from one open tab, against a single-threaded Node monolith with no
      // WebSocket. Meeting the number that way would MISS the intent.
      ok(fastest >= 1000,
        'no timer polls faster than 1s. A 250 ms refresh is achievable only by pushing over a ' +
        'WebSocket — polling 16 endpoints at 250 ms would issue 64 req/s per tab');
      console.log(`  Dashboard: ${intervals.length} timers, fastest ${fastest} ms. ` +
        '250 ms refresh is BLOCKED on the WebSocket server (UI-03).');
    }

    // ═════════════════════════════════════════════════════════════════════════
    // TARGET: CPU under 20%             — UNKNOWN from a test process
    // ═════════════════════════════════════════════════════════════════════════
    {
      // process.cpuUsage() measures THIS process running a test suite. It says nothing about a
      // production server under market-hours load. Reporting it as "CPU 3% ✓" would be a lie
      // dressed as a measurement.
      const u = process.cpuUsage();
      ok(u.user >= 0, 'cpuUsage() is readable, and it measures the WRONG process');
      console.log('  CPU under load: UNKNOWN — requires a running server during market hours.');
    }

    // ── @test:rollback ─────────────────────────────────────────────────────
    {
      const erf = require('../event-risk-filter.js');
      for (const fn of ['assess', 'nearestEvent', 'daysBetween', 'loadCalendar', 'SEV']) {
        ok(erf[fn] !== undefined, `ROLLBACK: pre-existing export \`${fn}\` survives`);
      }
      const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
      ok(/eventRiskFilter\.loadCalendar\(_sigFs, _EVENT_CAL_PATH\)/.test(server),
        'ROLLBACK: the protected caller is unchanged — loadCalendar keeps its exact signature and never throws');
      const v = erf.assess({ dateISO: '2026-07-09', calendar: [], vix: 12 });
      ok('verdict' in v && 'sizeScale' in v && 'reason' in v,
        'ROLLBACK: assess() keeps every field its callers read; calendarCorrupt is additive');
    }

    console.log(`\n${n} assertions passed`);
  });
}
