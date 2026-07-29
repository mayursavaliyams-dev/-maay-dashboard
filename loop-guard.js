'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   loop-guard — run an async task now and on an interval, without letting one
   rejection end the process.

   WHY THIS EXISTS
     All three warehouse helpers were written the same way:

         run();
         if (every) setInterval(run, every * 1000);

     `run` is async and neither call has a .catch(), and none of the three files
     installs an unhandledRejection handler. Node 15 and later terminate the process
     on an unhandled rejection — verified on the node in use here, v24.14.1 — so a
     single rejected cycle ends the helper.

     Nothing would restart it. The launcher runs at logon and at 08:50; there is no
     supervisor in between. The bot would keep running, the dashboard would keep
     serving, and the warehouse would simply stop filling. Silently, until somebody
     noticed a missing day.

     That is the same failure shape as the morning that went missing on 2026-07-29,
     and the warehouse is the input to the hero-zero base rate that is already
     blocked on data. It has not fired yet — the capture log carries no unhandled
     rejection in 653 lines — which makes this a latent defect, not an active one.

   WHAT IT DOES NOT DO
     It does not swallow the error. A failing cycle is logged with its message every
     time, and a run of consecutive failures escalates, because a loop that fails
     forever in silence is worse than one that stops: at least a stopped process is
     visible in a process list.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @param {string}   name     short label used in log lines, e.g. 'capture'
 * @param {Function} task     async function to run each cycle
 * @param {number}   everyMs  0 = run once and return; otherwise repeat
 * @param {object}   [io]     injectable console for tests
 * @returns {{ stop: Function, stats: Function }}
 */
function runLoop(name, task, everyMs, io = console) {
  let consecutive = 0, cycles = 0, failures = 0, timer = null, lastError = null;

  const cycle = async () => {
    cycles++;
    try {
      await task();
      // Recovery is worth saying out loud: a loop that was failing and now is not
      // should not look identical to one that never failed.
      if (consecutive > 0) io.warn(`[${name}] recovered after ${consecutive} failed cycle(s)`);
      consecutive = 0;
      lastError = null;
    } catch (e) {
      consecutive++; failures++;
      lastError = (e && e.message) || String(e);
      io.error(`[${name}] cycle failed (${consecutive} in a row): ${lastError}`);
      // Escalate on a run of failures. Every cycle already logs; this exists so a
      // permanent failure reads as permanent instead of as noise.
      if (consecutive === 3 || consecutive === 10 || (consecutive > 10 && consecutive % 50 === 0))
        io.error(`[${name}] STILL FAILING after ${consecutive} consecutive cycles — this loop is not collecting anything`);
    }
  };

  const started = cycle();                       // fire immediately, as before
  if (everyMs > 0) {
    timer = setInterval(cycle, everyMs);
    // Do not hold the event loop open on this timer alone: if everything else
    // finishes, the helper should be allowed to exit rather than hang forever.
    if (typeof timer.unref === 'function' && process.env.LOOP_GUARD_UNREF === '1') timer.unref();
  }

  return {
    started,                                     // awaitable first cycle, for tests
    stop() { if (timer) { clearInterval(timer); timer = null; } },
    stats() { return { name, cycles, failures, consecutive, lastError, running: !!timer }; },
  };
}

module.exports = { runLoop };
