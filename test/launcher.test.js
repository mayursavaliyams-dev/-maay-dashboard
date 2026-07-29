/**
 * launcher — the bot must be up before the market opens, and exactly once.
 * Run: node test/launcher.test.js
 *
 * @test:characterization @test:regression @test:unit @test:failure
 * @test:integration @test:performance @test:memory-leak @test:rollback
 *
 * WHY THIS EXISTS — measured on 2026-07-29, a Wednesday.
 *
 *   08:50  the weekday pre-market task was DISABLED and did not fire
 *   09:15  market opened, bot not running
 *   11:43  the owner logged in; the logon task fired and started the bot
 *   11:45  first option bar captured
 *
 * 150 minutes of the session never existed for the bot. This is the same failure
 * that makes the hero-zero base rate unmeasurable (docs/051): of twelve archived
 * days only one begins at 09:15, and the rest begin whenever someone logged in.
 * `_restoreOptCandles` rescues a restart WITHIN a day; it cannot recover a morning
 * where nothing was running.
 *
 * And start-bot.bat had launched warehouse-capture TWICE — once at the documented
 * 300s and once at 60s, four lines below the comment explaining that 60s helped
 * trigger an Upstox 429 on 2026-07-27. The 60s copy was the one actually running.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };

const ROOT = path.join(__dirname, '..');
const BAT = fs.readFileSync(path.join(ROOT, 'start-bot.bat'), 'utf8');
const PS1 = fs.readFileSync(path.join(ROOT, 'start-bot.ps1'), 'utf8');

console.log('launcher');

// ── @test:failure — cmd.exe needs CRLF, and Windows PowerShell needs ASCII ─────
{
  // A .bat saved with bare LF is misparsed by cmd.exe: REM split and the console
  // filled with "'M' is not recognized". Both files are written by tooling that
  // defaults to LF, so this is checked, not assumed.
  const bareLf = (BAT.match(/(?<!\r)\n/g) || []).length;
  ok(bareLf === 0, `start-bot.bat uses CRLF throughout (${bareLf} bare LF)`);

  // Windows PowerShell reads a BOM-less .ps1 as ANSI. The first version of the
  // launcher used em dashes in comments; every one became mojibake and the parser
  // died before a single component started.
  const nonAscii = [...PS1].filter(c => c.charCodeAt(0) > 126);
  ok(nonAscii.length === 0,
    `start-bot.ps1 is plain ASCII${nonAscii.length ? ` (${nonAscii.length} non-ASCII chars)` : ''}`);
}

// ── @test:regression — one capture, at the documented interval ────────────────
{
  const captures = (PS1.match(/warehouse-capture\.js --every (\d+)/g) || []);
  ok(captures.length === 1, `warehouse-capture is started exactly once (found ${captures.length})`);
  ok(/warehouse-capture\.js --every 300/.test(PS1),
    'and at 300s — 60s x 3 instruments defeats the 4s snapshot cache and rate-limits the broker');
  ok(!/--every 60\b/.test(PS1), 'no component runs on the 60s cadence that caused the 429');
}

// ── @test:integration — every component the bot needs is launched ─────────────
{
  for (const c of ['server.js', 'option-warehouse.js', 'warehouse-derive.js',
                   'warehouse-api.js', 'warehouse-capture.js']) {
    assert.ok(new RegExp(`-Match '${c.replace('.', '\\.')}'`).test(PS1), `${c} is launched`);
    n++;
  }
  console.log('  ✓ server and all four warehouse helpers are launched');
}

// ── @test:failure — the guard must be able to fail loudly ────────────────────
{
  ok(/Start-IfMissing/.test(PS1) && /already running/.test(PS1),
    'each component is started only when absent');
  ok(/launcher\.log/.test(PS1),
    'decisions go to the launcher\'s own log — a component holds its own log open, so writing there fails exactly when there is something to report');
  ok(!/Add-Content\s+-Path\s+\$logPath/.test(PS1),
    'and never into the locked component log');
  // The guard lived in the .bat as a PowerShell one-liner nested in batch quoting,
  // which ate its $_ so the check never ran — it logged nothing, skipped nothing,
  // and looked correct only because everything happened to be running already.
  ok(!/powershell[^\n]*Where-Object/i.test(BAT),
    'the guard is not a PowerShell one-liner nested inside batch quoting');
  ok(/-File\s+"?[^"]*start-bot\.ps1/.test(BAT),
    'the .bat only delegates, so the Task Scheduler action needs no change');
}

// ── @test:performance / @test:memory-leak — one process query, no polling ────
{
  const queries = (PS1.match(/Get-CimInstance/g) || []).length;
  ok(queries === 1, `the process table is read once per launch (${queries})`);
  ok(!/while\s*\(|Start-Sleep/.test(PS1), 'the launcher starts things and exits — it is not a supervisor');
}

// ── @test:rollback — a clean exit, so a green task means a green launch ──────
{
  ok(/^exit 0$/m.test(PS1), 'the launcher exits 0 explicitly');
  ok(/exit \/b %errorlevel%/i.test(BAT), 'and the .bat passes that result through to Task Scheduler');
}

// ── @test:characterization — the schedule this is all for ────────────────────
{
  ok(/08:50/.test(PS1), 'the pre-market schedule is documented where the launcher lives');
  ok(/09:15/.test(PS1), 'along with the open it exists to beat');
}

console.log(`\n${n} assertions passed`);
