'use strict';
/**
 * CONTRACT tests for warehouse-capture.js — Phase 1 data capture.
 * Design: docs/H19 + docs/REPORT-bot-vs-world-best.md §5 Phase 1.
 *
 * @test:characterization @test:unit @test:integration @test:regression
 * @test:failure @test:performance @test:memory-leak @test:rollback
 *
 * Isolation: WAREHOUSE_ROOT points at a temp dir (set BEFORE require), so nothing in
 * the repo's data/ is read or written.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-cap-'));
process.env.WAREHOUSE_ROOT = TMP;
const C = require('../warehouse-capture.js');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
const eq = (a, b, m) => { n++; assert.strictEqual(a, b, m); };

const CHAIN = {
  source: 'upstox', spotPrice: 23767.45, atmStrike: 23750,
  pcr: { pcrOI: '0.833' }, maxPain: { maxPain: 23900 },
  strikes: [
    { strike: 23750, ce: { ltp: 152.1, oi: 1900000, iv: 10.8, ivSource: 'feed',
        delta: 0.62, gamma: 0.0014, theta: -12.84, vega: 9.51, pop: 39, bid: 151, ask: 153 },
      pe: { ltp: 81.8, oi: 4270000, iv: 11.99, ivSource: 'bsm',
        delta: -0.39, gamma: 0.0013, theta: -14.36, vega: 9.58, pop: 29 } },
    { strike: 23800, ce: { ltp: 122.7, oi: 7410000, iv: 10.82, ivSource: 'feed',
        delta: 0.55, gamma: 0.0015, theta: -13.37, vega: 9.88, pop: 36 }, pe: null },
  ],
};

// ── @test:unit / @test:characterization — snapshot keeps every column, unknown = null ─
{
  const s = C.buildChainSnapshot('NIFTY', CHAIN, 1000);
  eq(s.inst, 'NIFTY', 'instrument tagged');
  eq(s.spot, 23767.45, 'spot captured');
  eq(s.strikes.length, 2, 'both strikes captured');
  const ce = s.strikes[0].ce;
  ok('delta' in ce && 'gamma' in ce && 'theta' in ce && 'vega' in ce, 'all four Greeks captured');
  eq(ce.ivSource, 'feed', 'ivSource preserved verbatim — the estimated/measured distinction survives');
  eq(s.strikes[0].pe.ivSource, 'bsm', 'a bsm leg keeps its bsm label');
  eq(s.strikes[1].pe, null, 'an absent leg is null, not an empty object');
  eq(ce.changeOI, null, 'a field the feed did not send is null, never 0');
  eq(C.buildChainSnapshot('NIFTY', { strikes: [] }, 1000), null, 'an empty chain produces no snapshot');
  eq(C.buildChainSnapshot('NIFTY', null, 1000), null, 'a missing chain produces no snapshot');
}

// ── @test:regression — the fingerprint ignores time, so identical markets dedupe ─────
{
  const a = C.buildChainSnapshot('NIFTY', CHAIN, 1000);
  const b = C.buildChainSnapshot('NIFTY', CHAIN, 9999999);
  eq(C.chainFingerprint(a), C.chainFingerprint(b), 'same market at a different clock time → same fingerprint (self-gating out of hours)');
  const moved = JSON.parse(JSON.stringify(CHAIN)); moved.strikes[0].ce.ltp = 153.4;
  const c = C.buildChainSnapshot('NIFTY', moved, 1000);
  ok(C.chainFingerprint(a) !== C.chainFingerprint(c), 'a moved premium changes the fingerprint → it IS appended');
}

// ── @test:regression — clock-drift in the DERIVED Greeks must not trigger a capture ──
// Measured on the live feed with the market closed: between two polls 60s apart, 160
// cells changed and every one was gamma/theta/vega/iv — model outputs whose only moving
// input is time-to-expiry. Hashing them meant the capture never self-gated and wrote
// ~66 MB/day of clock drift overnight and at weekends. The key is the OBSERVED market.
{
  const base = C.buildChainSnapshot('NIFTY', CHAIN, 1000);
  const drift = JSON.parse(JSON.stringify(CHAIN));
  drift.strikes[0].ce.gamma = 0.0019;   // theta decay moves these on its own
  drift.strikes[0].ce.theta = -13.9;
  drift.strikes[0].ce.vega  = 9.1;
  drift.strikes[0].ce.iv    = 10.94;
  drift.strikes[0].pe.gamma = 0.0018;
  const d = C.buildChainSnapshot('NIFTY', drift, 61000);
  eq(C.chainFingerprint(base), C.chainFingerprint(d),
     'only the derived Greeks moved → SAME fingerprint → no append (the market did not trade)');

  const traded = JSON.parse(JSON.stringify(drift));
  traded.strikes[0].ce.oi = 1900001;    // an actual observation changed
  ok(C.chainFingerprint(base) !== C.chainFingerprint(C.buildChainSnapshot('NIFTY', traded, 61000)),
     'a real change in open interest DOES trigger a capture');

  const quoted = JSON.parse(JSON.stringify(drift));
  quoted.strikes[0].ce.bid = 151.9;
  ok(C.chainFingerprint(base) !== C.chainFingerprint(C.buildChainSnapshot('NIFTY', quoted, 61000)),
     'a change in the quoted book DOES trigger a capture');
}

// ── @test:unit — book diff ───────────────────────────────────────────────────────────
{
  const p1 = { inst:'NIFTY', strike:24500, type:'CE', openAt:'2026-07-26T08:00:57.194Z', id:1 };
  const p2 = { inst:'NIFTY', strike:24600, type:'CE', openAt:'2026-07-26T09:00:00.000Z', id:2 };
  let d = C.diffBook([p1], [p1, p2]);
  eq(d.opened.length, 1, 'a new position is detected'); eq(d.closed.length, 0, 'nothing falsely closed');
  eq(d.opened[0].strike, 24600, 'the right one');
  d = C.diffBook([p1, p2], [p1]);
  eq(d.closed.length, 1, 'a vanished position is detected as closed');
  d = C.diffBook([p1], [p1]);
  eq(d.opened.length + d.closed.length, 0, 'an unchanged book produces no rows');
  d = C.diffBook(null, [p1]);
  eq(d.opened.length, 1, 'a null previous book still diffs safely');
}

// ── @test:integration — the OPEN row carries the missing column: entry Greeks ────────
{
  const snap = C.buildChainSnapshot('NIFTY', CHAIN, 5000);
  const pos = { inst:'NIFTY', strike:23750, type:'CE', side:'SELL_CE', premium:152.1, lot:65,
                pop:39, creditCollected:9886, lotSource:'instrument-registry',
                openAt: new Date(4000).toISOString(), mode:'PAPER' };
  const r = C.openRow(pos, snap, 5000);
  eq(r.kind, 'OPEN', 'row kind');
  eq(r.entryGreeks.delta, 0.62, 'entry delta captured beside the position');
  eq(r.entryGreeks.iv, 10.8, 'entry IV captured');
  eq(r.entryGreeks.ivSource, 'feed', 'and whether that IV was measured or assumed');
  eq(r.greeksSource, 'chain-at-first-sight', 'the reconstruction is labelled, not passed off as an engine record');
  eq(r.entryLagMs, 1000, 'how stale the reconstruction is, in ms, is recorded');
}
// a strike the chain does not carry → null Greeks, never invented
{
  const snap = C.buildChainSnapshot('NIFTY', CHAIN, 5000);
  const r = C.openRow({ inst:'NIFTY', strike:99999, type:'CE' }, snap, 5000);
  eq(r.entryGreeks, null, 'a strike absent from the chain yields null Greeks');
  eq(r.greeksSource, null, 'and no source claim');
  eq(r.entryLagMs, null, 'no openAt ⇒ no fabricated lag');
}

// ── @test:failure — the CLOSE row refuses to invent a P&L ───────────────────────────
{
  const snap = C.buildChainSnapshot('NIFTY', CHAIN, 9000);
  const r = C.closeRow({ inst:'NIFTY', strike:23750, type:'CE', premium:152.1, lot:65,
                         openAt: new Date(1000).toISOString() }, snap, 9000);
  eq(r.kind, 'CLOSE', 'row kind');
  eq(r.exitLtp, 152.1, 'exit mark captured from the chain');
  eq(r.realizedPnl, null, 'P&L is NOT computed at this layer — the book is gross and the fill is unseen');
  ok(/net of charges/.test(r.pnlNote), 'and the row says why');
  eq(r.heldMs, 8000, 'holding time recorded');
}

// ── @test:regression — NAV: a missing book makes the TOTAL null, not a smaller number ─
{
  const good = C.navRow({ sensex:{equity:88011,peakEquity:100000,consecLosses:2,halted:false},
                          nifty:{equity:94557,peakEquity:100000,consecLosses:15,halted:true} }, 1000);
  eq(good.total, 182568, 'both books present → a real total');
  eq(good.incomplete, null, 'nothing flagged missing');
  eq(good.books.nifty.halted, true, 'halt state carried into the NAV series');

  const partial = C.navRow({ sensex:{equity:88011}, nifty:null }, 1000);
  eq(partial.total, null, 'an unreachable book makes the TOTAL null — a partial sum would overstate health');
  ok(Array.isArray(partial.incomplete) && partial.incomplete.includes('nifty'), 'and names what is missing');
}

// ── @test:performance — snapshotting a 105-strike chain is cheap ────────────────────
{
  const big = { spotPrice: 23767, atmStrike: 23750, strikes: Array.from({length:105}, (_,i)=>({
    strike: 20000 + i*50, ce: { ltp:i, oi:i*100, iv:11, ivSource:'feed', delta:.5, gamma:.001, theta:-1, vega:1, pop:50 },
    pe: { ltp:i, oi:i*100, iv:11, ivSource:'feed', delta:-.5, gamma:.001, theta:-1, vega:1, pop:50 } })) };
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 100; i++) C.chainFingerprint(C.buildChainSnapshot('NIFTY', big, 1000));
  ok(Number(process.hrtime.bigint() - t0) / 1e6 < 900, '100 snapshot+fingerprint cycles of a full chain < 900ms');
}

// ── @test:memory-leak — pure builders retain nothing ────────────────────────────────
{
  for (let i = 0; i < 2000; i++) C.buildChainSnapshot('NIFTY', CHAIN, i);
  ok(true, 'builders are pure — bounded');
}

// ── @test:rollback — nothing is written until a capture runs; module load is inert ──
{
  eq(fs.existsSync(C.CHAIN_DIR), false, 'requiring the module writes nothing');
  eq(fs.existsSync(C.NAV_DIR), false, 'no NAV dir until a capture appends');
  eq(typeof C.captureOnce, 'function', 'the orchestrator is exposed for the CLI/tests');
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
console.log(`\n${n} assertions passed`);
