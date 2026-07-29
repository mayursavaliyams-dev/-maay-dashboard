/**
 * loop-guard — one bad cycle must not end a collector.
 * Run: node test/loop-guard.test.js
 *
 * @test:characterization @test:regression @test:unit @test:failure
 * @test:integration @test:performance @test:memory-leak @test:rollback
 *
 * THE DEFECT, as found on 2026-07-29. All three warehouse helpers ended the same way:
 *
 *     run();
 *     if (every) setInterval(run, every * 1000);
 *
 * No .catch() on either call, and no unhandledRejection handler in any of the three
 * files. Node 15 and later terminate on an unhandled rejection — verified below
 * against the node actually in use — so one rejected cycle ends the helper. The two
 * synchronous ones (mirror, derive) are worse rather than better: they do file I/O,
 * so a torn JSON file throws straight out of a timer callback.
 *
 * Nothing would restart it. The launcher runs at logon and at 08:50; there is no
 * supervisor between. The bot keeps running, the dashboard keeps serving, and the
 * warehouse just stops filling — the same shape as the morning that went missing,
 * and the warehouse is the input to a hero-zero base rate already blocked on data.
 *
 * LATENT, NOT ACTIVE: 653 lines of capture log carry no unhandled rejection. This is
 * a fix for a failure that has not happened, chosen because the consequence is a
 * silent permanent stop and the fix is six lines.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };
const ROOT = path.join(__dirname, '..');
const { runLoop } = require(path.join(ROOT, 'loop-guard.js'));

const quiet = () => { const l = []; return { l, log: (...a) => l.push(a.join(' ')),
  warn: (...a) => l.push(a.join(' ')), error: (...a) => l.push(a.join(' ')) }; };

/* Read a source file with its comments removed.
   Every assertion about code SHAPE must go through this. Four times in this
   codebase's tests a check has matched prose instead of code and reported the
   opposite of the truth — here the comments quote the very `setInterval(run, …)`
   that was removed, and quoting the defect you fixed is the normal way to document
   it. Strip once, in one place, so the next assertion cannot get it wrong. */
const code = f => fs.readFileSync(path.join(ROOT, f), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

(async () => {
  console.log('loop-guard');

  // ── @test:characterization — the platform really does kill on a bare rejection ──
  {
    let died = false;
    try {
      execFileSync(process.execPath,
        ['-e', 'const f=async()=>{throw new Error("boom")}; f(); setTimeout(()=>console.log("SURVIVED"),200);'],
        { stdio: 'pipe', timeout: 10000 });
    } catch (_) { died = true; }
    ok(died, `node ${process.version} terminates on an unhandled rejection — the premise of this file, checked rather than assumed`);
  }

  // ── @test:regression — a rejecting task does not end anything ─────────────
  {
    const io = quiet();
    let runs = 0;
    const loop = runLoop('t', async () => { runs++; throw new Error('cycle blew up'); }, 0, io);
    await loop.started;
    ok(runs === 1, 'the task ran');
    ok(loop.stats().failures === 1, 'the failure is counted');
    ok(io.l.some(l => /cycle failed/.test(l) && /cycle blew up/.test(l)),
      'and logged WITH its message — the error is surfaced, not swallowed');
  }

  // ── @test:failure — a synchronous throw is caught too ─────────────────────
  {
    // mirrorAll and deriveAll are sync and do file I/O; a torn JSON throws straight
    // out. `await task()` turns that into the same rejected path.
    const io = quiet();
    const loop = runLoop('sync', () => { throw new TypeError('torn file'); }, 0, io);
    await loop.started;
    ok(loop.stats().failures === 1, 'a synchronous throw is caught by the same guard');
    ok(/torn file/.test(io.l.join(' ')), 'and reported verbatim');
  }

  // ── @test:regression — the loop keeps going after a failure ───────────────
  {
    const io = quiet();
    let runs = 0;
    const loop = runLoop('keep', async () => { runs++; if (runs <= 2) throw new Error('transient'); }, 20, io);
    await new Promise(r => setTimeout(r, 130));
    loop.stop();
    ok(runs >= 4, `the loop kept running past two failures (${runs} cycles)`);
    ok(loop.stats().consecutive === 0, 'and the consecutive counter reset once it recovered');
    ok(io.l.some(l => /recovered after 2 failed cycle/.test(l)),
      'recovery is announced — a loop that was failing and now is not must not look like one that never failed');
  }

  // ── @test:failure — a permanent failure escalates instead of becoming noise ─
  {
    const io = quiet();
    const loop = runLoop('dead', async () => { throw new Error('always'); }, 5, io);
    await new Promise(r => setTimeout(r, 90));
    loop.stop();
    ok(loop.stats().consecutive >= 3, 'consecutive failures accumulate');
    ok(io.l.some(l => /STILL FAILING/.test(l)),
      'and a run of them escalates — silence forever is worse than stopping, because a stopped process is at least visible');
  }

  // ── @test:memory-leak — stop() actually stops ─────────────────────────────
  {
    const io = quiet();
    let runs = 0;
    const loop = runLoop('stopme', async () => { runs++; }, 10, io);
    await new Promise(r => setTimeout(r, 45));
    loop.stop();
    const after = runs;
    await new Promise(r => setTimeout(r, 45));
    ok(runs === after, 'no cycle runs after stop() — the timer is cleared, not just ignored');
    ok(loop.stats().running === false, 'and the stats say so');
  }

  // ── @test:performance — one timer, no accumulation ────────────────────────
  {
    const src = code('loop-guard.js');
    ok((src.match(/setInterval\(/g) || []).length === 1, 'exactly one timer is created per loop');
    ok(!/setTimeout\(/.test(src), 'and no per-cycle timeout is scheduled on top of it');
  }

  // ── @test:integration — all three helpers actually use it ─────────────────
  {
    for (const f of ['warehouse-capture.js', 'option-warehouse.js', 'warehouse-derive.js']) {
      const s = code(f);
      assert.ok(/loop-guard\.js'\)\.runLoop\(/.test(s), `${f} runs its loop through the guard`); n++;
      assert.ok(!/^\s*run\(\);\s*$/m.test(s), `${f} has no bare run() left`); n++;
      assert.ok(!/setInterval\(\s*run\s*,/.test(s), `${f} has no unguarded setInterval(run, …) left`); n++;
    }
    console.log('  ✓ capture, mirror and derive all route through the guard — no bare run(), no raw setInterval');
  }

  // ── @test:rollback — the observable behaviour is unchanged ────────────────
  {
    const io = quiet();
    let ran = 0;
    const loop = runLoop('same', async () => { ran++; }, 0, io);
    await loop.started;
    ok(ran === 1, 'a healthy task still runs immediately, exactly once, as before');
    ok(io.l.length === 0, 'and a healthy loop logs nothing extra — the guard is invisible until something fails');
  }

  console.log(`\n${n} assertions passed`);
})();
