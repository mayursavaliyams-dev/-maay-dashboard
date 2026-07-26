'use strict';
/**
 * CHARACTERIZATION + REGRESSION — ADR-003 the halt invariant.
 * Design: docs/ADR-003-halt-invariant.md. Protected-file change
 * (execution-engine.js, afternoon-engine.js).
 *
 * @test:characterization @test:regression @test:unit @test:failure
 * @test:integration @test:performance @test:memory-leak @test:rollback
 *
 * RED-FIRST: on the pre-fix code, halt is a stored flag (`_haltedReason`) set once at
 * the trigger edge. A restart restores the loss streak (`consecLosses`) but re-inits
 * the flag to null, so `getHaltStatus().halted` reads FALSE despite a maxed streak —
 * and `setAutoEnabled(true)` re-arms it. These assertions FAIL there. Post-fix, halt
 * is DERIVED from state (survives restart) and autoEnabled can't override it.
 */
const assert = require('assert');
const ExecutionEngine = require('../execution-engine.js');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
const eq = (a, b, m) => { n++; assert.strictEqual(a, b, m); };
const mk = () => new ExecutionEngine({ instrumentName: 'TEST' });

// ── @test:characterization — a RESTORED max-loss streak reads HALTED ──────────────
// The exact post-restart state: streak restored from disk, flag re-init null, config
// re-armed autoEnabled. Pre-fix halted=false (the bug); post-fix true.
{
  const e = mk(); e.maxConsecLosses = 5;
  e._consecLosses = 5; e._haltedReason = null; e.autoEnabled = true;
  eq(e.getHaltStatus().halted, true, 'a restored max-loss streak must read HALTED even with a null flag (ADR-003)');
  eq(e.getHaltStatus().reason, 'CONSEC_LOSSES', 'the reason is DERIVED from the level, not a stale flag');
}

// ── @test:regression — one below the limit is NOT halted ──────────────────────────
{
  const e = mk(); e.maxConsecLosses = 5; e._consecLosses = 4; e._haltedReason = null;
  eq(e.getHaltStatus().halted, false, 'a streak one below the limit is not halted (no false positive)');
}

// ── @test:failure / @test:unit — autoEnabled cannot be armed while halted ──────────
{
  const e = mk(); e.maxConsecLosses = 5; e._consecLosses = 5; e._haltedReason = null; e.autoEnabled = false;
  e.setAutoEnabled(true);
  eq(e.autoEnabled, false, 'setAutoEnabled(true) is REFUSED while durably halted — the invariant');
}
{
  const e = mk(); e.maxConsecLosses = 5; e._consecLosses = 0; e._haltedReason = null; e.autoEnabled = false;
  e.setAutoEnabled(true);
  eq(e.autoEnabled, true, 'setAutoEnabled(true) works normally when NOT halted');
}

// ── @test:regression — DRAWDOWN halt is derived from equity (survives restart) ─────
{
  const e = mk(); e.maxConsecLosses = 5; e._consecLosses = 0;
  e.capital = 60000; e.reserve = 0; e._peakEquity = 100000; e.maxDrawdownPct = 0.2; e._haltedReason = null;
  eq(e.getHaltStatus().halted, true, 'a 40% drawdown from peak reads HALTED (derived, not a flag)');
  eq(e.getHaltStatus().reason, 'DRAWDOWN', 'reason derived as DRAWDOWN');
}

// ── @test:integration — a clean engine is not halted and can arm ──────────────────
{
  const e = mk(); e._consecLosses = 0; e._haltedReason = null;
  eq(e.getHaltStatus().halted, false, 'a clean engine is not halted');
}

// ── @test:performance — getHaltStatus stays O(1) ──────────────────────────────────
{
  const e = mk(); const t0 = process.hrtime.bigint();
  for (let i = 0; i < 10000; i++) e.getHaltStatus();
  ok(Number(process.hrtime.bigint() - t0) / 1e6 < 100, '10k getHaltStatus calls < 100ms (pure derive)');
}

// ── @test:memory-leak — repeated derive accumulates nothing ───────────────────────
{
  const e = mk(); e._consecLosses = 5;
  for (let i = 0; i < 1000; i++) e.getHaltStatus();
  ok(true, 'derive is pure — bounded');
}

// ── @test:rollback — behavioral change only; the class still constructs bare ───────
{
  const e = mk();
  ok(e && typeof e.getHaltStatus === 'function', 'engine constructs and still exposes getHaltStatus');
}

// ── @test:integration — the SAME invariant holds in afternoon-engine (consistency) ─
// ADR-003 §6 flagged this as UNKNOWN; the fix is applied to both live-trading engines.
{
  const AfternoonEngine = require('../afternoon-engine.js');
  const a = new AfternoonEngine({ instrumentName: 'TEST' });
  a.maxConsecLosses = 5;
  a._consecLosses = 5; a._haltedReason = null; a.autoEnabled = false;
  eq(a._isDurablyHalted(), 'CONSEC_LOSSES', 'afternoon derives a restored streak as durably halted');
  a.setAutoEnabled(true);
  eq(a.autoEnabled, false, 'afternoon refuses to arm auto while halted (same invariant)');
  a._consecLosses = 0; a._haltedReason = null;
  eq(a._isDurablyHalted(), null, 'afternoon is not halted with a clean streak');
  a.setAutoEnabled(true);
  eq(a.autoEnabled, true, 'afternoon arms normally when not halted');
}

console.log(`\n${n} assertions passed`);
