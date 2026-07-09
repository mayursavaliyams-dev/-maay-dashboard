/**
 * strike-resolver.js — the ONE place that turns a spot price into a strike.
 *
 * WHY (migration C1c-7)
 * `Math.round(spot / 50) * 50` appears inline in at least a dozen places:
 *   server.js:1280,1714,1793,2583,2623,7068  live-connector.js:279,313,363
 *   option-analyzer.js:135,642,760           free-chain.js:93,115,148
 *   sensibull-fetcher.js:102                 upstox-connector.js:141
 * plus three `inst === 'NIFTY' ? 50 : 100` ternaries (server.js:934,2468,4145,
 * agents-engine.js:607) and a duplicate STEP map in upstox-connector.js:28.
 *
 * Every one of them hardcodes the interval it happens to need. All of them are wrong for
 * MIDCPNIFTY, whose strike interval is 25 — `Math.round(spot/50)*50` would silently snap
 * to a strike that does not exist, and the option lookup would return nothing (or, worse,
 * the neighbouring strike).
 *
 * This module is a PURE LEAF: it reads the Instrument Registry and does arithmetic.
 * It has no network, no state, no side effects.
 *
 * Fail-closed, exactly like the registry: an unknown or trading-disabled instrument
 * yields `null`. A strike is a contract identifier — inventing one is never safe.
 */
'use strict';

const registry = require('./instrument-registry.js');

const _finite = (n) => Number.isFinite(n) && n > 0;

/**
 * The at-the-money strike: spot rounded to the instrument's strike interval.
 * @returns {number|null} null when the instrument is unknown/disabled or spot is invalid
 */
function atm(inst, spot) {
  const step = registry.step(inst);
  const s = Number(spot);
  if (!step || !_finite(s)) return null;
  return Math.round(s / step) * step;
}

/**
 * A strike `offset` intervals away from ATM. Positive = higher strike.
 *   resolve('NIFTY', 24013, +2) → 24100    (ATM 24000, step 50)
 *   resolve('NIFTY', 24013, -1) → 23950
 * @returns {number|null}
 */
function resolve(inst, spot, offset = 0) {
  const step = registry.step(inst);
  const a = atm(inst, spot);
  if (a == null || !Number.isInteger(Number(offset))) return null;
  return a + Number(offset) * step;
}

/** The nearest strike at or below spot. */
function floorStrike(inst, spot) {
  const step = registry.step(inst);
  const s = Number(spot);
  if (!step || !_finite(s)) return null;
  return Math.floor(s / step) * step;
}

/** The nearest strike at or above spot. */
function ceilStrike(inst, spot) {
  const step = registry.step(inst);
  const s = Number(spot);
  if (!step || !_finite(s)) return null;
  return Math.ceil(s / step) * step;
}

/**
 * A symmetric ladder of strikes around ATM, `half` intervals each side.
 * `strikes(inst, spot, 2)` → [atm-2·step … atm+2·step]  (5 strikes)
 * @returns {number[]} empty array when the instrument is unknown/disabled
 */
function strikes(inst, spot, half = 10) {
  const step = registry.step(inst);
  const a = atm(inst, spot);
  const h = Number(half);
  if (a == null || !Number.isInteger(h) || h < 0) return [];
  const out = [];
  for (let i = -h; i <= h; i++) out.push(a + i * step);
  return out;
}

/**
 * Strikes spanning ±rangePercent of spot, on the instrument's lattice.
 * Replaces pop-seller's `generateStrikes`.
 */
function strikesByPercent(inst, spot, rangePercent = 8) {
  const step = registry.step(inst);
  const s = Number(spot);
  const r = Number(rangePercent);
  if (!step || !_finite(s) || !Number.isFinite(r) || r <= 0) return [];
  const lo = Math.round((s * (1 - r / 100)) / step) * step;
  const hi = Math.round((s * (1 + r / 100)) / step) * step;
  const out = [];
  for (let k = lo; k <= hi; k += step) out.push(k);
  return out;
}

/** Is `strike` a strike that actually exists on this instrument's lattice? */
function isValidStrike(inst, strike) {
  const step = registry.step(inst);
  const k = Number(strike);
  if (!step || !Number.isFinite(k) || k <= 0) return false;
  return Math.abs(k / step - Math.round(k / step)) < 1e-9;
}

/** Signed distance from spot to strike, in intervals. Null when unresolvable. */
function offsetOf(inst, spot, strike) {
  const step = registry.step(inst);
  const a = atm(inst, spot);
  if (a == null || !Number.isFinite(Number(strike))) return null;
  return (Number(strike) - a) / step;
}

module.exports = { atm, resolve, floorStrike, ceilStrike, strikes, strikesByPercent, isValidStrike, offsetOf };
