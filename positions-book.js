// ============================================================================
//  positions-book.js — ONE book for every open paper position.
//
//  Audit 011/049 found the platform has FIVE engines each holding their own
//  positions in their own shape, and NOTHING that aggregates them. Live today:
//  strangle 2 · bounce 23 · signal-paper 2 · gamma-blast 0 · agents N — and no
//  single place a human can see what the platform is actually holding.
//
//  This module is PURE: it takes each engine's already-published status object
//  and normalises it into one row shape. It opens nothing, closes nothing, and
//  places no order. It reads what the engines already say about themselves.
//
//  ROW SHAPE (every engine normalises to exactly this):
//    { engine, inst, structure, legs[], qty, entryAt, entryPx, mtm, pnl, note }
//
//  UNKNOWN IS NULL, NEVER ZERO. An engine that does not publish an MTM gets
//  mtm: null — not 0. A null P&L is excluded from the total, never counted as
//  break-even. (000-A: Unknown ≠ Zero.)
// ============================================================================
'use strict';

// Number(null) === 0 — an engine publishing an EXPLICIT `pnl: null` must yield
// null, never a fabricated break-even 0. (Caught by hl-verify's test suite,
// 2026-07-17; the same helper lived here with the same latent bug.)
const num = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const arr = (v) => (Array.isArray(v) ? v : []);

// ── LOT SIZE — the Instrument Registry is the single source of truth ────────
// Most engines do not publish the contract size at all: bounce and signal-paper
// report `qty: 1` and nothing else, so a reader cannot tell that one NIFTY lot is
// SIXTY-FIVE contracts of exposure and not one. The registry knows (NIFTY 65,
// SENSEX 20, BANKNIFTY 30) and it is broker-verified and FAIL-CLOSED — it returns
// null for an instrument it has not verified rather than guessing.
//
// Precedence:  the engine's own lot  >  the registry  >  null.
// NEVER a hardcoded default. An unknown lot is null, and a null lot means the
// notional cannot be computed — which is reported, not silently treated as 1.
let _registry = null;
try { _registry = require('./instrument-registry.js'); } catch (_) { _registry = null; }

function lotFor(inst, engineLot) {
  const own = num(engineLot);
  if (own && own > 0) return own;                    // the engine knows its own contract
  if (!_registry || typeof _registry.lotSize !== 'function') return null;
  try {
    const l = num(_registry.lotSize(String(inst).toUpperCase()));
    return l && l > 0 ? l : null;                    // unregistered ⇒ null, never a guess
  } catch (_) { return null; }                       // fail-closed
}

// ── one row, fully normalised ───────────────────────────────────────────────
function row(engine, inst, structure, legs, extra = {}) {
  const I = String(inst || '?').toUpperCase();
  const qty = num(extra.qty);
  const lot = lotFor(I, extra.lot);               // engine's own > registry > null
  const entryPx = num(extra.entryPx);

  // Notional exposure in rupees = lots × contract size × price. If ANY of the three
  // is unknown, the notional is UNKNOWN — it is not computed from a fabricated lot of 1.
  const notional = (qty != null && lot != null && entryPx != null)
    ? +(qty * lot * entryPx).toFixed(2)
    : null;

  return {
    engine,
    inst: I,
    structure: structure || '?',
    legs: arr(legs),
    qty,
    lot,                                          // ← from the registry when the engine is silent
    lotSource: num(extra.lot) ? 'engine' : (lot != null ? 'registry' : 'unknown'),
    notional,                                     // ← the exposure nobody could see before
    // MEASURED: the engines publish entryAt as a CLOCK STRING ("12:11:28"), not an epoch.
    // Keep it verbatim — inventing a date from a time-of-day would be fabrication.
    entryAt: extra.entryAt != null ? extra.entryAt : null,
    entryPx,
    mtm: num(extra.mtm),          // null when the engine does not publish one
    pnl: num(extra.pnl),          // null when unknown — NEVER 0
    note: extra.note || '',
  };
}

const leg = (side, type, strike, px, ltp) => ({
  side,                                   // 'SELL' | 'BUY'
  type: type || null,                     // 'CE' | 'PE'
  strike: num(strike),
  px: num(px),                            // entry price
  ltp: num(ltp),                          // last traded — null when the engine does not price its book
});

// ── per-engine adapters. Each takes that engine's status() payload. ─────────

// strangle-engine. MEASURED live 2026-07-14 — it publishes `unrealizedPnl` (rupees),
// `entryNet`/`nowNet` (net premium), `qty` (lots) and `lot` (contract size), and an
// `ltp` on every leg. It does NOT publish a key called `pnl`.
function fromStrangle(status) {
  return arr(status && status.openPositions).map((p) => {
    const legs = [];
    if (p.ce)     legs.push(leg('SELL', 'CE', p.ce.strike,     p.ce.entry,     p.ce.ltp));
    if (p.pe)     legs.push(leg('SELL', 'PE', p.pe.strike,     p.pe.entry,     p.pe.ltp));
    if (p.ceWing) legs.push(leg('BUY',  'CE', p.ceWing.strike, p.ceWing.entry, p.ceWing.ltp));
    if (p.peWing) legs.push(leg('BUY',  'PE', p.peWing.strike, p.peWing.entry, p.peWing.ltp));
    return row('strangle', p.inst, p.structure || 'SHORT_STRANGLE', legs, {
      qty: p.qty,
      lot: p.lot,
      entryAt: p.entryAt,
      entryPx: p.entryNet ?? p.credit,
      mtm: p.nowNet,                  // net premium NOW (points), not rupees
      pnl: p.unrealizedPnl,           // ◀── THE RUPEE P&L. Live key, verified.
      note: p.expiry ? `exp ${p.expiry}` : '',
    });
  });
}

// bounce-engine. MEASURED live: it publishes ONLY { inst, strike, type, entry, entryAt,
// peak, qty }. There is NO ltp and NO pnl — the engine does not price its open book.
// Therefore its P&L is genuinely UNKNOWN, and this adapter says so rather than
// inventing a zero. 23 of the 27 live positions are in this state.
function fromBounce(status) {
  return arr(status && status.openPositions).map((p) =>
    row('bounce', p.inst, 'LONG_OPTION', [leg('BUY', p.type, p.strike, p.entry)], {
      qty: p.qty,
      entryAt: p.entryAt,
      entryPx: p.entry,
      mtm: p.ltp,                     // absent today ⇒ null
      pnl: p.pnl,                     // absent today ⇒ null. NOT zero.
      note: p.peak != null ? `peak ${p.peak}` : '',
    }));
}

// gamma-blast-engine: { openPositions: [{ inst, side, strike, entry, qty, lot }] }
function fromGammaBlast(status) {
  return arr(status && status.openPositions).map((p) =>
    row('gamma-blast', p.inst, 'GAMMA_BLAST', [leg('BUY', p.side, p.strike, p.entry)], {
      qty: p.qty,
      entryAt: p.entryAt,
      entryPx: p.entry,
      mtm: p.mtm,
      pnl: p.pnl,
    }));
}

// signal-paper-engine. MEASURED live: strikes arrive as STRINGS like "59700CE" / "57100PE",
// `mtm` is the RUPEE mark-to-market (e.g. -188), and `pnlPts` is the same move in POINTS
// (-6.25). They are NOT the same unit — `mtm` is the money, `pnlPts` is the note.
// `credit: true` is a BOOLEAN (is this a credit structure?), not an amount — do not read
// it as a price.
const _parseStrike = (s) => {
  if (s && typeof s === 'object') return leg(s.side || 'SELL', s.type, s.strike, s.px, s.ltp);
  const m = String(s).match(/^(\d+)(CE|PE)$/i);
  return m ? leg('SELL', m[2].toUpperCase(), m[1], null, null)
           : leg('SELL', null, String(s).replace(/\D/g, '') || null, null, null);
};
function fromSignalPaper(status) {
  return arr(status && status.open).map((p) =>
    row('signal-paper', p.inst, p.structure || 'SPREAD', arr(p.strikes).map(_parseStrike), {
      qty: p.lots,
      entryAt: p.entryAt,
      entryPx: p.entryNet,             // `credit` is a boolean here, NOT a price
      mtm: p.mtm,
      pnl: p.mtm,                      // ◀── `mtm` IS the rupee P&L on this engine. Verified live.
      note: p.pnlPts != null ? `${p.pnlPts} pts` : '',
    }));
}

// agents-engine: { open: [{ inst, side, strike, entry, qty }] } (or openPositions)
function fromAgents(status) {
  const list = arr(status && (status.open || status.openPositions));
  return list.map((p) =>
    row('ai-agents', p.inst, 'AI_AGENT', [leg('BUY', p.side || p.type, p.strike, p.entry)], {
      qty: p.qty ?? p.lots,
      entryAt: p.entryAt ?? p.at,
      entryPx: p.entry,
      mtm: p.mtm ?? p.ltp,
      pnl: p.pnl,
    }));
}

const ADAPTERS = {
  strangle: fromStrangle,
  bounce: fromBounce,
  'gamma-blast': fromGammaBlast,
  'signal-paper': fromSignalPaper,
  'ai-agents': fromAgents,
};

/**
 * Build the unified book.
 * @param {Object} sources  { strangle, bounce, 'gamma-blast', 'signal-paper', 'ai-agents' }
 *                          Each value is that engine's status() payload, or null/undefined
 *                          if the engine is off or unavailable.
 * @returns {{ positions, byEngine, byInstrument, totals, unavailable }}
 */
function build(sources = {}) {
  const positions = [];
  const unavailable = [];

  for (const [engine, adapt] of Object.entries(ADAPTERS)) {
    const src = sources[engine];
    if (src == null) { unavailable.push(engine); continue; }   // OFF or unreachable — say so, don't fake a 0
    try {
      positions.push(...adapt(src));
    } catch (e) {
      unavailable.push(engine);                                 // a broken adapter is UNKNOWN, not empty
    }
  }

  // Newest first. entryAt is a clock string ("12:11:28") on every engine, so sort as a
  // string — it is zero-padded and therefore lexicographically ordered. A row with no
  // entryAt sorts last rather than being silently treated as midnight.
  positions.sort((a, b) => {
    const A = a.entryAt == null ? '' : String(a.entryAt);
    const B = b.entryAt == null ? '' : String(b.entryAt);
    if (A === B) return 0;
    if (A === '') return 1;
    if (B === '') return -1;
    return B < A ? -1 : 1;
  });

  const byEngine = {};
  const byInstrument = {};
  for (const p of positions) {
    (byEngine[p.engine] = byEngine[p.engine] || []).push(p);
    (byInstrument[p.inst] = byInstrument[p.inst] || []).push(p);
  }

  // Totals. A null is UNKNOWN — it is counted separately and NEVER summed as zero.
  const known = positions.filter((p) => p.pnl != null);
  const sized = positions.filter((p) => p.notional != null);
  const totals = {
    open: positions.length,
    engines: Object.keys(byEngine).length,
    instruments: Object.keys(byInstrument).length,
    pnlKnown: known.length,
    pnlUnknown: positions.length - known.length,      // ← the honest number nobody shows
    pnl: known.length ? +known.reduce((s, p) => s + p.pnl, 0).toFixed(2) : null,
    notionalKnown: sized.length,
    notionalUnknown: positions.length - sized.length, // ← a position we cannot even size
    notional: sized.length ? +sized.reduce((s, p) => s + p.notional, 0).toFixed(2) : null,
    lotsFromRegistry: positions.filter((p) => p.lotSource === 'registry').length,
    lotsUnknown: positions.filter((p) => p.lotSource === 'unknown').length,
  };

  return { positions, byEngine, byInstrument, totals, unavailable };
}

module.exports = { build, ADAPTERS, fromStrangle, fromBounce, fromGammaBlast, fromSignalPaper, fromAgents };
