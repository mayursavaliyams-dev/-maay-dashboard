/* ═══════════════════════════════════════════════════════════════════════════
   slippage-ledger — what every order saw, did, and cost.

   WHAT IS RECORDED, AND WHY EACH FIELD EARNS ITS PLACE

     decidedAt        when the decision was taken, not when the order arrived
     decisionBook     the exact bid/ask/depth the decision SAW. Without this the
                      slippage number is unauditable: three weeks later there is
                      no way to tell a bad fill from a book that had already moved
     gate             the checks and their measured values, pass or fail
     amendments       every price the order was ever at, with the book at that
                      moment and whether it filled
     outcome          FILLED / PARTIAL / UNFILLED / REJECTED / CANCELLED / CROSSED
     slippage         against the DECISION mid and the ARRIVAL mid, in ₹ and ticks
     missed           set when nothing filled — see below

   THE TWO REFERENCE PRICES, AND WHY BOTH
     · vs DECISION mid — the whole cost from wanting the trade to having it.
       Includes the delay in getting to market. This is what the strategy pays.
     · vs ARRIVAL mid — the cost from the moment the order reached the book.
       This is what the EXECUTION LAYER is responsible for.
     Reporting only the first blames execution for a slow signal path; reporting
     only the second hides a slow signal path entirely.

   THE FIELD THAT KEEPS THE REPORT HONEST
     An unfilled order has `slippage: null` and `missed` set. It does NOT have
     slippage 0. A passive strategy that fills 40% of the time and records zeros
     for the rest would report a beautiful average — and the number would be
     arithmetic about nothing. Every aggregate below therefore carries its fill
     rate beside it, and refuses to be read without one.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const { writeJsonSync, readJsonSync } = require('./safe-write');
const gate = require('./liquidity-gate');

const DIR = path.join(__dirname, 'data');
const FILE = path.join(DIR, 'slippage-ledger.json');

let _rows = null;

function load() {
  if (_rows) return _rows;
  try {
    const j = readJsonSync(FILE);
    _rows = Array.isArray(j) ? j : (Array.isArray(j && j.rows) ? j.rows : []);
  } catch (_) { _rows = []; }
  return _rows;
}

/**
 * Record one execution. Returns the row as stored.
 *
 * Writing is atomic (safe-write), because this file is appended to during the
 * session and read by the report at the same time — a torn read here would
 * corrupt the only record of what execution actually cost.
 */
async function record(rec, opts = {}) {
  const rows = load();
  const maxRows = Number(opts.maxRows) || 20000;

  const row = {
    id: rec.id,
    ts: rec.decidedAt || new Date().toISOString(),
    strategy: rec.strategy || null,
    instrument: rec.instrument || null,
    strike: rec.strike ?? null,
    optionType: rec.optionType || null,
    side: rec.side || null,
    paper: rec.paper !== false,
    requestedQty: rec.quantity ?? null,

    // the evidence
    decisionBook: rec.decisionBook || null,
    decisionMid: rec.decisionMid ?? null,
    arrivalMid: rec.arrivalMid ?? null,
    liquidityBucket: rec.liquidityBucket || gate.bucket(rec.decisionBook && rec.decisionBook.relSpread),
    gate: rec.gate || null,
    slicing: rec.slicing || null,
    config: rec.config || null,

    // what happened
    amendments: (rec.children || []).flatMap(c => (c.amendments || []).map(a => ({ child: c.index, ...a }))),
    children: (rec.children || []).map(c => ({
      index: c.index, qty: c.qty, state: c.state, filled: !!c.filled,
      fillPrice: c.fillPrice ?? null, ladder: c.ladder || null, why: c.why || null,
    })),
    outcome: rec.outcome || null,
    slippage: rec.slippage || null,          // null when nothing filled — never 0
    missed: rec.missed || null,
    elapsedMs: rec.elapsedMs ?? null,
  };

  rows.push(row);
  // Oldest first out. The cap is a working-file bound, not a retention policy:
  // a real retention policy belongs with the warehouse, and pretending this is
  // one would quietly lose the history the weekly comparison depends on.
  if (rows.length > maxRows) rows.splice(0, rows.length - maxRows);

  try {
    fs.mkdirSync(DIR, { recursive: true });
    writeJsonSync(FILE, rows);
  } catch (e) {
    // Surfaced, not swallowed: an execution we cannot record is an execution
    // that will be invisible in the comparison this ledger exists to produce.
    (opts.log || console).error(`[slippage-ledger] could not persist: ${e.message}`);
  }
  return row;
}

/* ── statistics ──────────────────────────────────────────────────────────── */

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const r2 = (v, d = 3) => v === null || v === undefined ? null : +Number(v).toFixed(d);

/* IST hour bucket. Time of day is the axis most likely to be got wrong here:
   computed in UTC every bucket is shifted by five and a half hours, which puts
   the open in the middle of the afternoon. */
function istHourBucket(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'unknown';
  const ist = new Date(t + 330 * 60 * 1000);
  const h = ist.getUTCHours(), m = ist.getUTCMinutes();
  const mins = h * 60 + m;
  if (mins < 9 * 60 + 15) return 'pre-open';
  if (mins < 10 * 60) return '09:15–10:00';
  if (mins < 12 * 60) return '10:00–12:00';
  if (mins < 14 * 60) return '12:00–14:00';
  if (mins < 15 * 60) return '14:00–15:00';
  if (mins <= 15 * 60 + 30) return '15:00–15:30';
  return 'after-close';
}

/**
 * Summarise a set of rows.
 *
 * Every summary carries `orders`, `filled` and `fillRate` alongside the
 * averages. A slippage average without a fill rate beside it is not a
 * performance figure — it is a figure about the subset that happened to work,
 * and the passive strategies always look best in it.
 */
function summarise(rows) {
  const orders = rows.length;
  const rejected = rows.filter(r => r.outcome && r.outcome.state === 'REJECTED').length;
  const attempted = rows.filter(r => !r.outcome || r.outcome.state !== 'REJECTED');
  const filledRows = attempted.filter(r => r.slippage);
  const unfilled = attempted.filter(r => !r.slippage).length;
  const crossed = rows.filter(r => (r.children || []).some(c => c.state === 'CROSSED')).length;

  const dRs = filledRows.map(r => r.slippage.vsDecisionMid).filter(v => v !== null && v !== undefined);
  const dTk = filledRows.map(r => r.slippage.vsDecisionTicks).filter(v => v !== null && v !== undefined);
  const aRs = filledRows.map(r => r.slippage.vsArrivalMid).filter(v => v !== null && v !== undefined);
  const aTk = filledRows.map(r => r.slippage.vsArrivalTicks).filter(v => v !== null && v !== undefined);
  const saved = filledRows.map(r => r.slippage.savedVsMarketOrder).filter(v => v !== null && v !== undefined);
  const savedTk = filledRows.map(r => r.slippage.savedTicks).filter(v => v !== null && v !== undefined);

  return {
    orders, rejected,
    attempted: attempted.length,
    filled: filledRows.length,
    unfilled,
    crossed,
    // Stated as a fraction of ATTEMPTED, not of all orders: a rejection is the
    // gate working, not the execution failing, and mixing them makes a strict
    // gate look like a bad fill rate.
    fillRate: attempted.length ? r2(filledRows.length / attempted.length, 4) : null,

    vsDecisionMid: { meanRs: r2(mean(dRs)), medianRs: r2(median(dRs)), meanTicks: r2(mean(dTk), 2), medianTicks: r2(median(dTk), 2) },
    vsArrivalMid: { meanRs: r2(mean(aRs)), medianRs: r2(median(aRs)), meanTicks: r2(mean(aTk), 2), medianTicks: r2(median(aTk), 2) },

    /* What this path saved against a market order ON THE SAME BOOK. Not against
       the old flat 2%-of-LTP assumption — that would compare a measurement to a
       guess and the measurement would win by construction. */
    savedVsMarketOrder: { meanRs: r2(mean(saved)), medianRs: r2(median(saved)), meanTicks: r2(mean(savedTk), 2), medianTicks: r2(median(savedTk), 2) },
    savedRupeesTotal: r2(filledRows.reduce((s, r) => s + (r.slippage.savedRupeesTotal || 0), 0), 2),

    /* The counterweight. Orders the passive path never got into, which a
       slippage average cannot show and which may cost more than the spread it
       saved. Whether it does is NOT computable here — it needs the trade's
       subsequent P&L — and this field says so rather than implying otherwise. */
    missedTrades: unfilled,
    missedQty: attempted.filter(r => r.missed).reduce((s, r) => s + (r.missed.quantity || 0), 0),
    missedCostNote: 'Unknown — the cost of a missed entry is the P&L of the trade not taken, which this ledger does not observe.',
  };
}

function groupBy(rows, keyFn) {
  const out = {};
  for (const r of rows) {
    const k = keyFn(r) || 'unknown';
    (out[k] = out[k] || []).push(r);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, summarise(v)]));
}

/**
 * The report.
 * @param {object} filter { strategy, instrument, from, to, paper }
 */
function report(filter = {}) {
  let rows = load();
  if (filter.strategy) rows = rows.filter(r => r.strategy === filter.strategy);
  if (filter.instrument) rows = rows.filter(r => r.instrument === filter.instrument);
  if (filter.paper !== undefined) rows = rows.filter(r => !!r.paper === !!filter.paper);
  if (filter.from) { const t = Date.parse(filter.from); rows = rows.filter(r => Date.parse(r.ts) >= t); }
  if (filter.to) { const t = Date.parse(filter.to); rows = rows.filter(r => Date.parse(r.ts) <= t); }

  const rejectionReasons = {};
  for (const r of rows) {
    if (r.outcome && r.outcome.state === 'REJECTED') {
      for (const c of (r.gate && r.gate.checks) || []) {
        if (!c.pass) rejectionReasons[c.name] = (rejectionReasons[c.name] || 0) + 1;
      }
    }
  }

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    filter,
    overall: summarise(rows),
    byStrategy: groupBy(rows, r => r.strategy),
    byInstrument: groupBy(rows, r => r.instrument),
    byLiquidityBucket: groupBy(rows, r => r.liquidityBucket),
    byTimeOfDay: groupBy(rows, r => istHourBucket(r.ts)),
    // Named, counted, and never merged into the fill statistics.
    rejectionsByGate: rejectionReasons,
    note: 'Positive slippage is WORSE than the reference. An unfilled order has no slippage — it is counted in `unfilled`, never as a zero.',
  };
}

/* Clearing must clear BOTH. If the file write fails the in-memory list is empty
   and the disk still holds the old rows, so the next restart silently resurrects
   a ledger someone believed they had reset — and the weekly comparison would be
   computed over a mixture of two runs. */
function clear(log = console) {
  _rows = [];
  try { writeJsonSync(FILE, []); return { ok: true }; }
  catch (e) {
    log.error(`[slippage-ledger] cleared in memory but COULD NOT clear ${FILE}: ${e.message} — ` +
              'the old rows will return on restart');
    return { ok: false, error: e.message };
  }
}
function all() { return load().slice(); }
function status() {
  const rows = load();
  return { rows: rows.length, file: 'data/slippage-ledger.json', oldest: rows[0] ? rows[0].ts : null, newest: rows.length ? rows[rows.length - 1].ts : null };
}

module.exports = { record, report, summarise, istHourBucket, all, clear, status, load };
