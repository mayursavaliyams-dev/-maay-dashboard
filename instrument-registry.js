// ============================================================================
//  instrument-registry.js — SINGLE SOURCE OF TRUTH for instrument contract metadata.
//
//  WHY THIS EXISTS
//  Before this file, lot size / strike step were declared independently in at least
//  six places (server.js INSTRUMENT_META, server.js PS_INSTS, upstox-connector STEP,
//  live-connector inline divisors, execution-engine constructor args, and per-engine
//  LOT maps in agents-engine / gamma-blast-engine / pop-seller / position-sizer).
//  They had DRIFTED: some said NIFTY=65/BANKNIFTY=30, others said 75/35. A wrong lot
//  size silently corrupts every P&L, every sizing decision, and the forward-test gate.
//
//  PROVENANCE — these values are NOT guessed. They were read from the broker's own
//  contract master on 2026-07-09 via a read-only call:
//
//      GET https://api.upstox.com/v2/option/contract?instrument_key=<index>
//
//      NIFTY      lot_size = 65   (1672 contracts, single distinct value)
//      BANKNIFTY  lot_size = 30   (1014 contracts, single distinct value)
//      SENSEX     lot_size = 20   (3054 contracts, single distinct value)
//
//  An operator may override via env (NIFTY_LOT_SIZE / BANKNIFTY_LOT_SIZE /
//  SENSEX_LOT_SIZE). If an override disagrees with the verified value we WARN loudly
//  rather than fail — the operator may legitimately be tracking a contract revision.
//
//  ⚠️ NOTE: `.env.example` currently ships 75/35 for NIFTY/BANKNIFTY, which contradicts
//  the broker. That file is corrected under migration C1b, not here (C1 must not touch
//  unrelated modules). Since the live `.env` sets no lot overrides, the verified values
//  below are the ones in force.
//
//  This module is a PURE LEAF: zero local dependencies, no side effects beyond an
//  optional console.warn on an env override mismatch. Nothing is mutated.
// ============================================================================
'use strict';

// Broker-verified contract sizes. Do not edit without re-querying the contract master.
const VERIFIED_LOT_SIZE = Object.freeze({ NIFTY: 65, BANKNIFTY: 30, SENSEX: 20 });
const VERIFIED_STEP     = Object.freeze({ NIFTY: 50, BANKNIFTY: 100, SENSEX: 100 });
const SEGMENT           = Object.freeze({ NIFTY: 'NSE_FNO', BANKNIFTY: 'NSE_FNO', SENSEX: 'BSE_FNO' });

const PROVENANCE = Object.freeze({
  source: 'Upstox GET /v2/option/contract (broker contract master)',
  verifiedAt: '2026-07-09',
  lotSize: { ...VERIFIED_LOT_SIZE },
  note: 'Single distinct lot_size per instrument across the full contract list.',
});

const _warned = new Set();
function _envLot(inst) {
  const raw = process.env[`${inst}_LOT_SIZE`];
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n !== VERIFIED_LOT_SIZE[inst] && !_warned.has(inst)) {
    _warned.add(inst);
    console.warn(`[instrument-registry] ${inst}_LOT_SIZE=${n} overrides the broker-verified ${VERIFIED_LOT_SIZE[inst]} (${PROVENANCE.verifiedAt}). Using the override — confirm this is a real contract revision.`);
  }
  return n;
}

/** Contract lot size (units per lot). Env-overridable; broker-verified default. */
function lotSize(inst) {
  const k = String(inst || '').toUpperCase();
  if (!(k in VERIFIED_LOT_SIZE)) return null;
  return _envLot(k) ?? VERIFIED_LOT_SIZE[k];
}

/** Strike interval in index points. */
function step(inst) {
  const k = String(inst || '').toUpperCase();
  return VERIFIED_STEP[k] ?? null;
}

/** Exchange segment. */
function segment(inst) {
  const k = String(inst || '').toUpperCase();
  return SEGMENT[k] ?? null;
}

/** Full metadata for one instrument, or null if unknown. */
function getMeta(inst) {
  const k = String(inst || '').toUpperCase();
  if (!(k in VERIFIED_LOT_SIZE)) return null;
  return { inst: k, lotSize: lotSize(k), step: step(k), segment: segment(k) };
}

/** Every instrument this registry knows about. */
function instruments() { return Object.keys(VERIFIED_LOT_SIZE); }

/**
 * Cross-check the registry against a live broker contract list.
 * @param {string} inst
 * @param {Array<{lot_size:number}>} contracts  rows from the broker contract master
 * @returns {{ok:boolean, expected:number, found:number[], reason:string}}
 */
function verifyAgainstContracts(inst, contracts) {
  const expected = lotSize(inst);
  const found = [...new Set((contracts || []).map(c => Number(c && c.lot_size)).filter(n => Number.isFinite(n) && n > 0))];
  if (!found.length) return { ok: false, expected, found, reason: 'no lot_size present in contract rows' };
  if (found.length > 1) return { ok: false, expected, found, reason: `contract master reports multiple lot sizes: ${found.join(', ')}` };
  const ok = found[0] === expected;
  return { ok, expected, found, reason: ok ? 'matches broker contract master' : `registry says ${expected}, broker says ${found[0]}` };
}

module.exports = {
  lotSize, step, segment, getMeta, instruments, verifyAgainstContracts,
  PROVENANCE, VERIFIED_LOT_SIZE, VERIFIED_STEP, SEGMENT,
};
