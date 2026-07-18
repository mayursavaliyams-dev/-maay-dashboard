/**
 * positions-book.js — the unified open-position book.  Run: node test/positions-book.test.js
 *
 * The rule this suite exists to protect: UNKNOWN IS NULL, NEVER ZERO.
 * An engine that is OFF is not an engine with no positions. A position with no
 * published P&L is not a position at break-even. Audit 000-A, and 119 `|| 0`
 * sites in this codebase, are why every one of those assertions is here.
 */
'use strict';
const assert = require('assert');
const B = require('../positions-book.js');

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); n++; };

// ── fixtures COPIED FROM THE LIVE BOT, 2026-07-14. Not invented. ───────────
// The keys here are the keys the running engines actually publish — including the
// ones that surprised me: strangle says `unrealizedPnl` (not `pnl`), signal-paper
// says `mtm` in RUPEES and `pnlPts` in POINTS, `credit` is a BOOLEAN there, strikes
// arrive as strings like "59700CE", and every entryAt is a CLOCK STRING.
const strangle = {
  openPositions: [{
    inst: 'SENSEX', expiry: '2026-07-16', structure: 'CONDOR', entryAt: '12:11:28',
    ce:     { strike: 78400, entry: 42.3, ltp: 34.15 },
    pe:     { strike: 76000, entry: 69.2, ltp: 74.5 },
    ceWing: { strike: 78600, entry: 29.05, ltp: 23 },
    peWing: { strike: 75800, entry: 50.2, ltp: 54.2 },
    credit: 32.25, maxLoss: 167.75, qty: 1, lot: 20,
    entryNet: 32.25, nowNet: 31.45,
    unrealizedPnl: 16,                       // ◀── the rupee P&L, under a key I first missed
  }],
};
const bounce = {
  // MEASURED: no ltp, no pnl. The engine does not price its own open book.
  openPositions: [
    { inst: 'NIFTY', strike: 24200, type: 'PE', entry: 128.15, entryAt: '12:13:08', peak: 160.25, qty: 1 },
    { inst: 'NIFTY', strike: 24250, type: 'CE', entry: 2.85,   entryAt: '12:10:01', peak: 3,      qty: 1 },
  ],
};
const gamma = { openPositions: [] };
const signalPaper = {
  open: [{ inst: 'BANKNIFTY', structure: 'IRON_CONDOR',
           strikes: ['59700CE', '57100PE', '61000CE', '55800PE'],
           entryNet: 386.7, credit: true, lots: 1,
           mtm: -188,                        // ◀── RUPEES
           pnlPts: -6.25,                    // ◀── POINTS. A different unit. Never conflate.
           entryAt: '12:14:00' }],
};

// ── 1. @test:integration — it builds one book out of four live payload shapes ─
{
  const b = B.build({ strangle, bounce, 'gamma-blast': gamma, 'signal-paper': signalPaper, 'ai-agents': { open: [] } });
  eq(b.totals.open, 4, 'four open positions across four engines');
  eq(b.totals.engines, 3, 'three engines actually hold something (gamma + agents are empty)');
  eq(b.positions.every(p => p.engine && p.inst && Array.isArray(p.legs)), true, 'every row has the same shape');
  eq(b.positions[0].entryAt, '12:14:00', 'newest first — and entryAt is a CLOCK STRING, sorted as one');
  eq(b.positions[b.positions.length - 1].entryAt, '12:10:01', 'oldest last');
}

// ── 2. @test:unit — legs are normalised, and a condor keeps all FOUR of them ────────────
{
  const b = B.build({ strangle });
  const p = b.positions[0];
  eq(p.legs.length, 4, 'the condor keeps all four legs — two short, two wings');
  eq(p.legs.filter(l => l.side === 'SELL').length, 2, 'two SELL legs');
  eq(p.legs.filter(l => l.side === 'BUY').length, 2, 'two BUY wings');
  eq(p.legs[0].strike, 78400, 'strike carried through');
  eq(p.legs[0].ltp, 34.15, 'and so is the live LTP the engine publishes');
  eq(p.note, 'exp 2026-07-16', 'expiry surfaced in the note');
  eq(p.structure, 'CONDOR', 'the structure is the engine\'s own word, not a guess');
  eq(p.lot, 20, 'contract size carried through — SENSEX lot is 20, not assumed');
}

// ── 2b. @test:regression — 🔴 THE ONE THAT CAUGHT ME: the P&L key is `unrealizedPnl` ────
// My first adapter looked for `pnl` and found nothing, so the book reported the
// strangle's P&L as UNKNOWN when the engine was publishing it all along. Reading
// the live payload is what caught it. This asserts the real key, forever.
{
  const b = B.build({ strangle });
  eq(b.positions[0].pnl, 16, 'strangle P&L comes from `unrealizedPnl` — NOT from a key called `pnl`');
  eq(b.totals.pnl, 16, 'and it reaches the total');
  eq(b.totals.pnlUnknown, 0, 'the strangle is NOT unknown — it publishes its P&L');
}

// ── 2c. 🔴 signal-paper: `mtm` is RUPEES, `pnlPts` is POINTS. Never conflate. ─
{
  const b = B.build({ 'signal-paper': signalPaper });
  const p = b.positions[0];
  eq(p.pnl, -188, 'the RUPEE P&L is `mtm`');
  eq(p.note, '-6.25 pts', 'and `pnlPts` is a different unit — it lives in the note, never in the total');
  eq(p.entryPx, 386.7, '`entryNet` is the price; `credit: true` is a BOOLEAN and must not be read as one');
  eq(p.legs.length, 4, 'four legs parsed out of strings like "59700CE"');
  eq(p.legs[0].strike, 59700, 'the strike is extracted from the string');
  eq(p.legs[0].type, 'CE', 'and so is the option type');
}

// ── 3. @test:failure — 🔴 AN ENGINE THAT IS OFF IS *UNAVAILABLE*, NOT EMPTY ────────────────
{
  const b = B.build({ strangle, bounce: null });          // bounce engine off / unreachable
  eq(b.unavailable.includes('bounce'), true, 'an absent engine is reported UNAVAILABLE');
  eq(b.unavailable.includes('gamma-blast'), true, 'so is one that was never passed');
  eq(b.positions.some(p => p.engine === 'bounce'), false, 'and it contributes no rows');
  // the whole point: "0 open" and "we do not know" must never look the same
  ok(b.unavailable.length > 0, 'the caller can TELL the difference between 0 and unknown');
}

// ── 4. 🔴 UNKNOWN P&L IS NULL AND IS NEVER SUMMED AS ZERO ──────────────────
// This is the live situation, verified 2026-07-14: bounce-engine holds 23 of the
// platform's 27 open positions and publishes NO ltp and NO pnl for any of them.
// A `|| 0` aggregator would render "Total P&L: ₹0" — a confident, false number.
{
  const b = B.build({
    strangle,                                              // unrealizedPnl 16 — KNOWN
    bounce,                                                // no ltp, no pnl   — UNKNOWN
  });
  eq(b.totals.pnlKnown, 1, 'exactly one position publishes a P&L');
  eq(b.totals.pnlUnknown, 2, 'two do NOT — and that count is REPORTED, not hidden');
  eq(b.totals.pnl, 16, 'the total sums ONLY the known — the unknown are not counted as 0');
  eq(b.positions.filter(p => p.engine === 'bounce')[0].pnl, null, 'an unpriced position stays null, never 0');
  eq(b.positions.filter(p => p.engine === 'bounce')[0].mtm, null, 'and its MTM stays null too');
  eq(b.positions.filter(p => p.engine === 'bounce')[0].legs[0].ltp, null, 'and so does the leg LTP');
  // the whole point, stated as an assertion:
  ok(b.totals.pnl !== 0, 'a book with unpriced positions must NEVER report a P&L of exactly 0');
}

// ── 5. 🔴 NO POSITIONS ANYWHERE ⇒ pnl is NULL, not 0 ───────────────────────
{
  const b = B.build({ strangle: { openPositions: [] }, bounce: { openPositions: [] } });
  eq(b.totals.open, 0, 'zero positions');
  eq(b.totals.pnl, null, 'and the total P&L is NULL — there is nothing to sum, which is not the same as zero');
}

// ── 6. @test:failure — a broken engine payload is UNAVAILABLE, and never crashes the book ──
{
  const b = B.build({ strangle, bounce: { openPositions: 'not-an-array' } });
  eq(b.totals.open, 1, 'the good engine still reports');
  eq(b.positions.some(p => p.engine === 'bounce'), false, 'the broken one contributes nothing');
  ok(true, 'and build() did not throw');
}

// ── 7. @test:rollback — purity: build() mutates nothing and the module holds no state,
// so unplugging it rolls back cleanly (nothing persisted, nothing to migrate back) ─────────────────────────
{
  const src = JSON.parse(JSON.stringify({ strangle, bounce }));
  const before = JSON.stringify(src);
  B.build(src);
  eq(JSON.stringify(src), before, 'build() is pure — the engine payloads are untouched');
}

// ── 7b. 🔴 LOT SIZE: the registry is the source of truth, never a guess ────
// bounce and signal-paper publish `qty: 1` and NO lot at all. A reader could not tell
// that one NIFTY lot is SIXTY-FIVE contracts of exposure. The registry knows; a
// hardcoded default would be a fabrication. This is the whole point of the registry.
{
  const b = B.build({ bounce, strangle, 'signal-paper': signalPaper });
  const bo = b.positions.find(p => p.engine === 'bounce');
  eq(bo.lot, 65, 'bounce publishes NO lot — the registry supplies NIFTY = 65');
  eq(bo.lotSource, 'registry', 'and the source is recorded, so nobody has to wonder');

  const st = b.positions.find(p => p.engine === 'strangle');
  eq(st.lot, 20, 'the strangle DOES publish its own lot (SENSEX = 20) — the engine wins');
  eq(st.lotSource, 'engine', 'and that precedence is recorded too');

  const sp = b.positions.find(p => p.engine === 'signal-paper');
  eq(sp.lot, 30, 'signal-paper publishes no lot — the registry supplies BANKNIFTY = 30');
}

// ── 7c. 🔴 NOTIONAL: real exposure — and UNKNOWN when any input is unknown ──
{
  const b = B.build({ bounce });
  const p = b.positions.find(x => x.entryPx === 128.15);
  eq(p.notional, +(1 * 65 * 128.15).toFixed(2), 'notional = lots × 65 × price — the exposure nobody could see');
  eq(p.notional, 8329.75, 'NIFTY 24200PE @128.15, 1 lot = ₹8,329.75 of premium at risk');
}
{
  // an UNREGISTERED instrument: the registry fail-closes, so the lot is null…
  const odd = { openPositions: [{ inst: 'FINNIFTY', strike: 23000, type: 'CE', entry: 50, qty: 1, entryAt: '10:00:00' }] };
  const b = B.build({ bounce: odd });
  eq(b.positions[0].lot, null, 'an instrument the registry has NOT verified yields lot: null');
  eq(b.positions[0].lotSource, 'unknown', 'and says so');
  eq(b.positions[0].notional, null, '…so the notional is UNKNOWN — it is NOT computed with a fabricated lot of 1');
  eq(b.totals.notional, null, 'and the book total is NULL, not a confident wrong number');
  eq(b.totals.lotsUnknown, 1, 'the count of unsizable positions is REPORTED');
}

// ── 7d. @test:regression — 🔴 an EXPLICIT `pnl: null` stays null — Number(null)===0 ─
// Caught 2026-07-17 via hl-verify's twin helper: the old num() coerced an
// explicit null to 0, which would count an unpriced position as break-even.
{
  const explicitNull = { openPositions: [
    { inst: 'NIFTY', strike: 24100, type: 'CE', entry: 50, entryAt: '10:00:00', qty: 1, pnl: null, ltp: null },
  ] };
  const b = B.build({ bounce: explicitNull });
  eq(b.positions[0].pnl, null, 'explicit pnl:null stays null — never a fabricated 0');
  eq(b.positions[0].mtm, null, 'explicit ltp:null stays null');
  eq(b.totals.pnlUnknown, 1, 'and it counts as UNKNOWN, not as break-even');
  eq(b.totals.pnl, null, 'the total refuses to fabricate');
}

// ── 8. grouping ────────────────────────────────────────────────────────────
{
  const b = B.build({ strangle, bounce, 'signal-paper': signalPaper });
  eq(Object.keys(b.byEngine).sort().join(','), 'bounce,signal-paper,strangle', 'grouped by engine');
  eq(b.byInstrument.NIFTY.length, 2, 'NIFTY holds 2 (both bounce)');
  eq(b.byInstrument.SENSEX.length, 1, 'SENSEX holds 1 (the strangle condor)');
  eq(b.byInstrument.BANKNIFTY.length, 1, 'BANKNIFTY holds 1 (the signal-paper condor)');
  eq(Object.keys(b.byInstrument).length, 3, 'three instruments carry risk right now');
}


// ── 9. @test:performance — the dashboard calls build() every 5s; it must stay
// trivially cheap. The bound is generous, not machine-tuned (house rule).
{
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 2000; i++) B.build({ strangle, bounce, 'signal-paper': signalPaper });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok(ms / 2000 < 5, `build() costs ${(ms / 2000).toFixed(3)} ms/call — far under a 5 ms budget`);
}

// ── 10. @test:memory-leak — repeated builds retain nothing between calls ────
{
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 5000; i++) B.build({ strangle, bounce });
  const grownMB = (process.memoryUsage().heapUsed - before) / 1048576;
  ok(grownMB < 30, `5000 builds grew the heap ${grownMB.toFixed(1)} MB — no retained references (generous bound)`);
}

console.log(`\n${n} assertions passed`);
