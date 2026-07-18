/**
 * hl-verify.js — Data Verification Engine.  Run: node test/hl-verify.test.js
 *
 * The doctrine assertions this suite exists to protect (Board review 008):
 *   COND-2  a tick-confirmed record is FEED_VALIDATED, never "exchange verified"
 *   COND-4  a violent-but-real move (gamma blast) is CONFIRMED, never rejected by a threshold
 *   COND-6  the audit log never trims silently
 *   COND-7  a feed gap (ABSENT) is not a rejection (INVALID)
 */
'use strict';
const assert = require('assert');
const { HLVerifier, LEVEL, TIER } = require('../hl-verify.js');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); n++; };

let CLOCK = 1_000_000;
const mk = (opts = {}) => new HLVerifier({ now: () => CLOCK, ...opts });
const tick = (price, exchTs, extra = {}) => ({ price, exchTs, recvTs: exchTs + 50, source: 'ws', ...extra });

// ── 1. first valid tick initializes — an INIT, not a "new high" event ──────
{
  const v = mk();
  const r = v.ingest('NIFTY:24100CE', tick(100, 1_000_000));
  eq(r.status, 'ACCEPT', 'first tick accepted'); eq(r.kind, 'INIT', 'as initialization');
  eq(v.record('NIFTY:24100CE').high, 100, 'record seeded');
  eq(v.record('NIFTY:24100CE').low, 100, 'both sides');
}

// ── 2. @test:unit — rule 4: NaN / null / 0 / negative → INVALID RED, record untouched ───
{
  const v = mk();
  v.ingest('K', tick(100, 1_000_000));
  for (const bad of [NaN, null, 0, -5]) {
    const r = v.ingest('K', tick(bad, 1_000_100));
    eq(r.status, 'INVALID', `price ${bad} rejected`); eq(r.level, LEVEL.RED, 'red');
  }
  eq(v.record('K').high, 100, 'record never touched by invalid ticks');
}

// ── 3. rule 5: duplicate → INVALID ─────────────────────────────────────────
{
  const v = mk();
  v.ingest('K', tick(100, 1_000_000));
  const r = v.ingest('K', tick(100, 1_000_000));
  eq(r.status, 'INVALID', 'exact duplicate rejected');
  ok(r.reasons.join().includes('duplicate'), 'named as duplicate');
}

// ── 4. rule 1: older exchange timestamp → INVALID ──────────────────────────
{
  const v = mk();
  v.ingest('K', tick(100, 1_000_000));
  const r = v.ingest('K', tick(101, 999_000));
  eq(r.status, 'INVALID', 'out-of-order rejected');
  ok(r.reasons.join().includes('older'), 'named');
}

// ── 5. rule 6: stale → INVALID; rule 2: future exchTs → INVALID ────────────
{
  const v = mk({ staleMs: 10_000, skewMs: 2_000 });
  const r1 = v.ingest('K', { price: 100, exchTs: 1_000_000, recvTs: 1_020_000, source: 'ws' });
  eq(r1.status, 'INVALID', 'stale (20s late) rejected');
  const r2 = v.ingest('K', { price: 100, exchTs: 1_010_000, recvTs: 1_000_000, source: 'ws' });
  eq(r2.status, 'INVALID', 'future exchTs rejected');
}

// ── 6. rule 7 (honest form): undeclared source → INVALID; 'rest' is legal ──
{
  const v = mk();
  const r1 = v.ingest('K', { price: 100, exchTs: 1_000_000, recvTs: 1_000_050 });
  eq(r1.status, 'INVALID', 'untagged source rejected');
  const r2 = v.ingest('K', { price: 100, exchTs: 1_000_100, recvTs: 1_000_150, source: 'rest' });
  eq(r2.status, 'ACCEPT', 'declared REST source is legal on this mixed pipeline');
}

// ── 7. double verification: new high goes PENDING, is NOT saved yet ────────
{
  const v = mk();
  v.ingest('K', tick(100, 1_000_000));
  const r = v.ingest('K', tick(120, 1_001_000));
  eq(r.status, 'PENDING', 'new high waits'); eq(r.level, LEVEL.YELLOW, 'yellow');
  eq(v.record('K').high, 100, 'record NOT updated before confirmation');
  ok(v.pending('K'), 'candidate parked');
}

// ── 8. confirmation by next tick → GREEN, FEED_VALIDATED (never "exchange") ─
{
  const v = mk();
  v.ingest('K', tick(100, 1_000_000));
  v.ingest('K', tick(120, 1_001_000));
  const r = v.ingest('K', tick(118, 1_002_000));
  eq(r.confirmed.tier, TIER.FEED, 'COND-2: tick-confirmed = FEED_VALIDATED tier');
  eq(v.record('K').high, 120, 'record now updated');
  eq(v.record('K').highTier, TIER.FEED, 'tier stored on the record');
  const acc = v.auditLog().find(e => e.status === 'ACCEPTED');
  eq(acc.level, LEVEL.GREEN, 'green for a verified high');
}

// ── 9. @test:regression — BAD TICK: isolated 10× spike, next tick far below → spike REJECTED ──
// The follow-through tick (101) proves only that SOME high above 100 exists —
// it does not prove the spike's PRICE (1000) ever traded. So the spike dies,
// and 101 becomes its own pending candidate through the normal path. The
// record moves only after 101 is itself confirmed. Spec-faithful: nothing is
// saved before verification.
{
  const v = mk();
  v.ingest('K', tick(100, 1_000_000));
  v.ingest('K', tick(1_000, 1_001_000));                    // spike
  const r = v.ingest('K', tick(101, 1_002_000));            // collapses far from the candidate
  ok(r.confirmed && r.confirmed.rejected, 'spike rejected as bad tick');
  eq(v.record('K').high, 100, 'record untouched — the spike never reached it');
  eq(r.status, 'PENDING', 'the honest 101 becomes its own candidate');
  eq(v.pending('K').price, 101, 'parked at 101');
  const r2 = v.ingest('K', tick(101.5, 1_003_000));         // and confirms normally
  eq(r2.confirmed.tier, TIER.FEED, '…then confirms');
  eq(v.record('K').high, 101, 'high moved only by the PROVEN tick');
  ok(v.auditLog().some(e => e.status === 'REJECTED'), 'the spike\'s rejection is audited with reason');
}

// ── 10. 🔴 COND-4 DOCTRINE: gamma blast — 10× move CONFIRMED by follow-through ─
{
  const v = mk({ jumpLogPct: 300 });                        // even with jump-logging on
  v.ingest('K', tick(10, 1_000_000));
  const c = v.ingest('K', tick(100, 1_001_000));            // 10× — the platform's own thesis event
  eq(c.status, 'PENDING', 'violent move is SUSPICIOUS, never auto-rejected');
  ok(c.reasons.join().includes('logged, not rejected'), 'jump is logged, not fatal');
  const r = v.ingest('K', tick(95, 1_002_000));             // follow-through holds
  eq(r.confirmed.tier, TIER.FEED, 'real blast CONFIRMED');
  eq(v.record('K').high, 100, 'the 10× high stands — a threshold must never kill the thesis');
}

// ── 11. @test:integration — COND-3: timeout → NEEDS_CANDLE; candle confirms → EXCHANGE_RECONCILED ─
{
  const v = mk({ confirmTimeoutMs: 5_000 });
  CLOCK = 1_000_000;
  v.ingest('K', tick(100, 1_000_000));
  v.ingest('K', tick(120, 1_001_000, { recvTs: 1_001_050 }));
  CLOCK = 1_010_000; v.sweep();
  ok(v.auditLog().some(e => e.status === 'NEEDS_CANDLE'), 'starved candidate escalated, not dropped');
  const r = v.confirmByCandle('K', { high: 120.5, low: 99 });
  eq(r.tier, TIER.EXCH, 'candle confirmation = EXCHANGE_RECONCILED tier');
  eq(v.record('K').highTier, TIER.EXCH, 'the stronger tier is stored');
}

// ── 12. @test:regression — candle CONTRADICTS (also pins the num(null)→0 coercion fix) → candidate rejected; unknown candle decides nothing ─
{
  const v = mk();
  v.ingest('K', tick(100, 1_000_000));
  v.ingest('K', tick(500, 1_001_000));
  eq(v.confirmByCandle('K', { high: null, low: null }), null, 'an unknown candle decides NOTHING (Unknown ≠ evidence)');
  const r = v.confirmByCandle('K', { high: 110, low: 98 });
  ok(r.rejected, 'candle never printed 500 → bad tick');
  eq(v.record('K').high, 100, 'record protected');
}

// ── 13. F-10: ₹0.05 → ₹0.10 (+100%) is a legitimate candidate, confirmable ─
{
  const v = mk();
  v.ingest('K', tick(0.05, 1_000_000));
  const c = v.ingest('K', tick(0.10, 1_001_000));
  eq(c.status, 'PENDING', 'micro-price double is a normal candidate');
  const r = v.ingest('K', tick(0.10, 1_002_000));
  eq(r.confirmed.tier, TIER.FEED, 'and confirms normally');
}

// ── 14. 🔴 COND-7: ABSENT (gap) is logged distinctly from INVALID ──────────
{
  const v = mk();
  v.ingest('K', tick(100, 1_000_000));
  v.noteGap('K', 90_000, 'ws');
  const gap = v.auditLog().find(e => e.status === 'GAP');
  ok(gap, 'gap recorded'); ok(!v.auditLog().some(e => e.status === 'INVALID'), 'and it is NOT an INVALID — silence ≠ rejection ≠ health');
}

// ── 15. @test:memory-leak — 🔴 COND-6: the log is CAPPED (bounded memory) and trims WITH a TRIM entry — never silently ──────
{
  const v = mk({ maxLog: 10 });
  for (let i = 0; i < 25; i++) v.ingest('K', tick(100 + i, 1_000_000 + i * 1000)); // pendings + logs
  const log = v.auditLog();
  ok(log.length <= 11, 'log capped');
  ok(log.some(e => e.status === 'TRIM' && /trimmed \d+ oldest/.test(e.reason)), 'trim is itself audited');
}

// ── 16. rule 8: sequence enforced only when the feed provides one ──────────
{
  const v = mk();
  v.ingest('K', tick(100, 1_000_000, { seq: 5 }));
  const r1 = v.ingest('K', tick(101, 1_001_000, { seq: 5 }));
  eq(r1.status, 'INVALID', 'non-increasing seq rejected when present');
  const v2 = mk();
  v2.ingest('K', tick(100, 1_000_000));
  const r2 = v2.ingest('K', tick(101, 1_001_000));
  eq(r2.status, 'PENDING', 'no seq field → no seq-based rejection (measured: feed parses none)');
}

// ── 17. LOW mirror: pending → confirm → BLUE ───────────────────────────────
{
  const v = mk();
  v.ingest('K', tick(100, 1_000_000));
  v.ingest('K', tick(80, 1_001_000));
  const r = v.ingest('K', tick(82, 1_002_000));
  eq(r.confirmed.kind, 'LOW', 'low confirmed');
  eq(v.record('K').low, 80, 'low stored');
  eq(v.auditLog().find(e => e.status === 'ACCEPTED').level, LEVEL.BLUE, 'blue for a verified low');
}

// ── 18. COND-5: band check logs only, never rejects; unknown band = silent ─
{
  const v = mk();
  v.ingest('K', tick(100, 1_000_000));
  v.bandCheck('K', 100, { lower: null, upper: null });
  eq(v.auditLog().filter(e => e.status === 'BAND_LOG').length, 0, 'unknown band logs nothing (no fabricated bound)');
  v.bandCheck('K', 100, { lower: 10, upper: 50 });
  const b = v.auditLog().find(e => e.status === 'BAND_LOG');
  ok(b && /log-only/.test(b.reason), 'declared band violation is LOGGED, never a rejection');
}

// ── 19. CSV export: pure, escaped, header-first ────────────────────────────
{
  const v = mk();
  v.ingest('K,with"comma', tick(100, 1_000_000));
  const csv = v.toCSV();
  ok(csv.startsWith('at,key,kind,price,status'), 'header row');
  ok(csv.includes('"K,with""comma"'), 'quotes and commas escaped');
  eq(csv.split('\n').length, 1 + v.auditLog().length, 'one row per audit entry');
}

// ── 20. @test:failure — garbage never throws — the gate fails closed, not loudly ───────────
{
  const v = mk();
  for (const g of [null, undefined, {}, { price: 'x' }, { price: Infinity, exchTs: 'y' }]) {
    const r = v.ingest('K', g);
    eq(r.status, 'INVALID', 'garbage is INVALID, not an exception');
  }
}


// ── 21. @test:performance — the gate sits on the tick path; it must be cheap.
// Generous bound, not machine-tuned (house rule).
{
  const v = mk({ maxLog: 1000 });
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 20_000; i++) v.ingest('PERF', tick(100 + (i % 50), 2_000_000 + i * 10));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok(ms / 20_000 < 0.25, `ingest costs ${(ms / 20_000 * 1000).toFixed(1)} µs/tick — far under a 250 µs budget`);
}

// ── 22. @test:rollback — the module keeps no global state: two verifiers are
// fully independent, and dropping one leaves the other untouched. Unplugging
// the engine therefore rolls back cleanly (nothing persisted outside it).
{
  const a = mk(), b = mk();
  a.ingest('K', tick(100, 1_000_000));
  eq(b.record('K'), null, 'a second verifier shares nothing with the first');
  eq(b.auditLog().length, 0, 'not even the audit log');
}

console.log(`\n${n} assertions passed`);
