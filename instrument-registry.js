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
//  PROVENANCE — these values are NOT guessed. Every field below was read from the
//  broker's own contract master on 2026-07-09 via a read-only call:
//
//      GET https://api.upstox.com/v2/option/contract?instrument_key=<underlying>
//
//      inst        lot   tick_size  strike step  expiry type          exch  segment  contracts
//      NIFTY        65       5          50       WEEKLY_AND_MONTHLY   NSE   NSE_FO     1672
//      BANKNIFTY    30       5         100       MONTHLY              NSE   NSE_FO     1014
//      FINNIFTY     60       5          50       MONTHLY              NSE   NSE_FO      488
//      MIDCPNIFTY  120       5          25       MONTHLY              NSE   NSE_FO      792
//      SENSEX       20       5         100       WEEKLY_AND_MONTHLY   BSE   BSE_FO     3054
//      BANKEX       30       5         100       MONTHLY              BSE   BSE_FO      980
//
//  Exactly one distinct lot_size per instrument across its whole contract list.
//
//  ── tickSize: the broker reports PAISE, not rupees ────────────────────────────
//  `tick_size: 5` is ambiguous and was NOT assumed. It was established empirically
//  against 429 live LTPs across NSE and BSE on 2026-07-09:
//    • prices such as 1016.85 / 2239.05 are NOT multiples of 5.00  → tick is not Rs 5
//    • every fractional price had a paise remainder in {5,10,...,95}, all divisible
//      by 5, and remainders of .05/.75/.85 occur                    → tick is Rs 0.05
//  We therefore store BOTH: `tickRaw` (5, exactly as the broker reports it) and
//  `tickSize` (0.05, rupees). Never re-derive one from the other at a call site.
//
//  ── expiryType ───────────────────────────────────────────────────────────────
//  Post-SEBI single-weekly-per-exchange, only NIFTY (NSE) and SENSEX (BSE) have a
//  weekly contract. BANKNIFTY / FINNIFTY / MIDCPNIFTY / BANKEX are MONTHLY-ONLY.
//  Any code assuming a weekly BANKNIFTY expiry is wrong.
//
//  ── segment: two vocabularies, deliberately both recorded ────────────────────
//  Upstox says `NSE_FO` / `BSE_FO`. Dhan (and this codebase's internal convention,
//  server.js INSTRUMENT_META) says `NSE_FNO` / `BSE_FNO`. Both are correct FOR THEIR
//  OWN BROKER. Storing a broker-specific string in shared instrument metadata is a
//  latent failover bug: the day Dhan<->Upstox failover lands, this field is wrong for
//  exactly one provider. `segment` keeps the internal vocabulary (backward compatible);
//  `brokerSegment` records what Upstox actually returned. Reconciling the two is owned
//  by roadmap H3 (Universal Market Data Layer), NOT by this file.
//
//  ── FAIL-CLOSED trading surface (migration C1c-1) ────────────────────────────
//  Three engines gate on `lotSize(inst) == null` meaning "unknown contract → refuse,
//  do not guess" (agents-engine:511,623 · gamma-blast-engine:104 · strangle-engine:314).
//  Simply adding FINNIFTY to this file would therefore have SILENTLY ENABLED trading on
//  it. That is forbidden. So the module has two surfaces:
//
//    TRADING SURFACE  lotSize / step / tickSize / strikeInterval / segment / exchange /
//                     expiryType / getMeta / instruments
//                     → answer ONLY for tradingEnabled instruments; null/absent otherwise.
//
//    CATALOG SURFACE  catalog / allInstruments / isTradingEnabled
//                     → the full verified record regardless of tradingEnabled.
//                       Reading metadata is not permission to trade.
//
//  New instruments therefore default to tradingEnabled:false and are inert until an
//  operator opts in EXPLICITLY via `<INST>_TRADING_ENABLED=true`. Nothing widens
//  implicitly.
//
//  This module is a PURE LEAF: zero local dependencies, no side effects beyond an
//  optional console.warn on an env override mismatch. Nothing is mutated.
// ============================================================================
'use strict';

const VERIFICATION_SOURCE = 'Upstox GET /v2/option/contract (broker contract master)';
const VERIFIED_AT = '2026-07-09';

/**
 * The single source of truth. Do not edit any field without re-querying the
 * broker contract master (see `npm run preflight` once C1c-6 lands).
 *
 * tickRaw       — exactly as the broker reports it (paise)
 * tickSize      — rupees (tickRaw / 100), empirically verified against live LTPs
 * strikeInterval— modal gap between adjacent strikes at the nearest expiry
 * segment       — INTERNAL vocabulary (Dhan-style), backward compatible
 * brokerSegment — what Upstox returned
 * tradingEnabled— policy, not data. New instruments default to false.
 */
const INSTRUMENTS = Object.freeze({
  NIFTY: Object.freeze({
    inst: 'NIFTY', exchange: 'NSE', segment: 'NSE_FNO', brokerSegment: 'NSE_FO',
    lotSize: 65, tickRaw: 5, tickSize: 0.05, strikeInterval: 50,
    expiryType: 'WEEKLY_AND_MONTHLY', expiryDow: 2, tradingEnabled: true,
    underlyingKey: 'NSE_INDEX|Nifty 50', contractCount: 1672,
    lastVerifiedAt: VERIFIED_AT, verificationSource: VERIFICATION_SOURCE,
  }),
  BANKNIFTY: Object.freeze({
    inst: 'BANKNIFTY', exchange: 'NSE', segment: 'NSE_FNO', brokerSegment: 'NSE_FO',
    lotSize: 30, tickRaw: 5, tickSize: 0.05, strikeInterval: 100,
    expiryType: 'MONTHLY', expiryDow: 2, tradingEnabled: true,
    underlyingKey: 'NSE_INDEX|Nifty Bank', contractCount: 1014,
    lastVerifiedAt: VERIFIED_AT, verificationSource: VERIFICATION_SOURCE,
  }),
  SENSEX: Object.freeze({
    inst: 'SENSEX', exchange: 'BSE', segment: 'BSE_FNO', brokerSegment: 'BSE_FO',
    lotSize: 20, tickRaw: 5, tickSize: 0.05, strikeInterval: 100,
    expiryType: 'WEEKLY_AND_MONTHLY', expiryDow: 4, tradingEnabled: true,
    underlyingKey: 'BSE_INDEX|SENSEX', contractCount: 3054,
    lastVerifiedAt: VERIFIED_AT, verificationSource: VERIFICATION_SOURCE,
  }),

  // ── Added by migration C1c-1. tradingEnabled:false — inert until opted in. ──
  FINNIFTY: Object.freeze({
    inst: 'FINNIFTY', exchange: 'NSE', segment: 'NSE_FNO', brokerSegment: 'NSE_FO',
    lotSize: 60, tickRaw: 5, tickSize: 0.05, strikeInterval: 50,
    expiryType: 'MONTHLY', expiryDow: 2, tradingEnabled: false,
    underlyingKey: 'NSE_INDEX|Nifty Fin Service', contractCount: 488,
    lastVerifiedAt: VERIFIED_AT, verificationSource: VERIFICATION_SOURCE,
    // NOTE: pop-seller.js:18 hardcodes FINNIFTY: 65. The broker says 60 (488 contracts,
    // one distinct value). That defect is corrected in C1c-3, not here.
  }),
  MIDCPNIFTY: Object.freeze({
    inst: 'MIDCPNIFTY', exchange: 'NSE', segment: 'NSE_FNO', brokerSegment: 'NSE_FO',
    lotSize: 120, tickRaw: 5, tickSize: 0.05, strikeInterval: 25,
    expiryType: 'MONTHLY', expiryDow: 2, tradingEnabled: false,
    underlyingKey: 'NSE_INDEX|NIFTY MID SELECT', contractCount: 792,
    lastVerifiedAt: VERIFIED_AT, verificationSource: VERIFICATION_SOURCE,
    // Absent from the codebase entirely before C1c-1. Note strikeInterval 25, not 50/100 —
    // every inlined `Math.round(spot/50)*50` would mis-round this instrument.
  }),
  BANKEX: Object.freeze({
    inst: 'BANKEX', exchange: 'BSE', segment: 'BSE_FNO', brokerSegment: 'BSE_FO',
    lotSize: 30, tickRaw: 5, tickSize: 0.05, strikeInterval: 100,
    expiryType: 'MONTHLY', expiryDow: 4, tradingEnabled: false,
    underlyingKey: 'BSE_INDEX|BANKEX', contractCount: 980,
    lastVerifiedAt: VERIFIED_AT, verificationSource: VERIFICATION_SOURCE,
  }),
});

// ── Backward-compatible projections (pre-C1c-1 exports). Data, not policy. ────
const VERIFIED_LOT_SIZE = Object.freeze(
  Object.fromEntries(Object.values(INSTRUMENTS).map((m) => [m.inst, m.lotSize])));
const VERIFIED_STEP = Object.freeze(
  Object.fromEntries(Object.values(INSTRUMENTS).map((m) => [m.inst, m.strikeInterval])));
const SEGMENT = Object.freeze(
  Object.fromEntries(Object.values(INSTRUMENTS).map((m) => [m.inst, m.segment])));
const VERIFIED_TICK_SIZE = Object.freeze(
  Object.fromEntries(Object.values(INSTRUMENTS).map((m) => [m.inst, m.tickSize])));

const PROVENANCE = Object.freeze({
  source: VERIFICATION_SOURCE,
  verifiedAt: VERIFIED_AT,
  lotSize: { ...VERIFIED_LOT_SIZE },
  tickSize: { ...VERIFIED_TICK_SIZE },
  note: 'Single distinct lot_size per instrument across the full contract list. tickRaw is paise; tickSize is rupees (verified against 429 live LTPs).',
  tickUnit: 'broker tick_size is denominated in paise; tickSize = tickRaw / 100',
});

const _key = (inst) => String(inst || '').toUpperCase();
const _record = (inst) => INSTRUMENTS[_key(inst)] || null;

// ── policy ────────────────────────────────────────────────────────────────────

const _warnedEnable = new Set();
/**
 * Is this instrument approved for trading?
 * Data in the catalog is NOT permission. Opt in explicitly with
 * `<INST>_TRADING_ENABLED=true`; anything else leaves the verified default in force.
 */
function isTradingEnabled(inst) {
  const rec = _record(inst);
  if (!rec) return false;
  const raw = process.env[`${rec.inst}_TRADING_ENABLED`];
  if (raw == null || raw === '') return rec.tradingEnabled;
  const on = String(raw).toLowerCase() === 'true';
  if (on && !rec.tradingEnabled && !_warnedEnable.has(rec.inst)) {
    _warnedEnable.add(rec.inst);
    console.warn(`[instrument-registry] ${rec.inst}_TRADING_ENABLED=true — enabling an instrument that ships disabled. lot=${rec.lotSize} step=${rec.strikeInterval} (verified ${rec.lastVerifiedAt}).`);
  }
  return on;
}

/** Trading-surface guard: the record, but only if the instrument may be traded. */
const _tradable = (inst) => (isTradingEnabled(inst) ? _record(inst) : null);

// ── env lot override ──────────────────────────────────────────────────────────

const _warned = new Set();
function _envLot(inst) {
  const raw = process.env[`${inst}_LOT_SIZE`];
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n !== VERIFIED_LOT_SIZE[inst] && !_warned.has(inst)) {
    _warned.add(inst);
    console.warn(`[instrument-registry] ${inst}_LOT_SIZE=${n} overrides the broker-verified ${VERIFIED_LOT_SIZE[inst]} (${VERIFIED_AT}). Using the override — confirm this is a real contract revision.`);
  }
  return n;
}

// ── TRADING SURFACE — null for unknown OR not-enabled instruments ─────────────

/** Contract lot size (units per lot). Env-overridable; broker-verified default. */
function lotSize(inst) {
  const rec = _tradable(inst);
  if (!rec) return null;
  return _envLot(rec.inst) ?? rec.lotSize;
}

/** Strike interval in index points. */
function step(inst) { const r = _tradable(inst); return r ? r.strikeInterval : null; }

/** Strike interval — explicit alias of step(). */
function strikeInterval(inst) { return step(inst); }

/** Minimum price increment, in RUPEES (e.g. 0.05). */
function tickSize(inst) { const r = _tradable(inst); return r ? r.tickSize : null; }

/** Minimum price increment exactly as the broker reports it (PAISE, e.g. 5). */
function tickRaw(inst) { const r = _tradable(inst); return r ? r.tickRaw : null; }

/** Exchange segment, INTERNAL vocabulary (NSE_FNO / BSE_FNO). */
function segment(inst) { const r = _tradable(inst); return r ? r.segment : null; }

/** Exchange segment exactly as the broker reports it (NSE_FO / BSE_FO). */
function brokerSegment(inst) { const r = _tradable(inst); return r ? r.brokerSegment : null; }

/** Exchange (NSE / BSE). */
function exchange(inst) { const r = _tradable(inst); return r ? r.exchange : null; }

/** 'WEEKLY_AND_MONTHLY' | 'MONTHLY'. */
function expiryType(inst) { const r = _tradable(inst); return r ? r.expiryType : null; }

/** Day-of-week (0=Sun) on which this instrument's contracts expire. NSE=Tue(2), BSE=Thu(4). */
function expiryDow(inst) { const r = _tradable(inst); return r ? r.expiryDow : null; }

// ── expiry calendar (migration C1c-3a) ───────────────────────────────────────
//
// Derived from the broker contract master, not from folklore. Observed 2026-07-09:
//
//   NIFTY       2026-07-14 Tue weekly · 07-21 Tue weekly · 07-28 Tue MONTHLY · 08-04 Tue weekly
//   BANKNIFTY   2026-07-28 Tue · 08-25 Tue · 09-29 Tue · 12-29 Tue   (all last-Tue-of-month)
//   FINNIFTY    2026-07-28 Tue · 08-25 Tue · 09-29 Tue               (all last-Tue-of-month)
//   MIDCPNIFTY  2026-07-28 Tue · 08-25 Tue · 09-29 Tue               (all last-Tue-of-month)
//   SENSEX      2026-07-09 Thu weekly · 07-16 · 07-23 · 07-30 Thu MONTHLY
//   BANKEX      2026-07-30 Thu · 08-27 Thu · 09-24 Thu               (all last-Thu-of-month)
//
// Rule, exactly: every NSE instrument expires on a TUESDAY, every BSE instrument on a
// THURSDAY. A WEEKLY_AND_MONTHLY instrument expires on the next such weekday; a
// MONTHLY-only instrument expires on the LAST such weekday of the month.
//
// Contracts stop trading at 15:30 IST on expiry day.

const IST_OFFSET_MIN = 330;
const EXPIRY_CLOSE_MIN = 15 * 60 + 30;   // 15:30 IST

/** {y,m,d,mins} of `now` in IST. Pure — `now` is always injected. */
function _ist(now) {
  const t = new Date(now.getTime() + IST_OFFSET_MIN * 60000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate(), mins: t.getUTCHours() * 60 + t.getUTCMinutes() };
}
const _utc = (y, m, d) => Date.UTC(y, m, d);
const _iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Last `dow` of month (y,m). */
function _lastDowOfMonth(y, m, dow) {
  const d = new Date(_utc(y, m + 1, 0));
  while (d.getUTCDay() !== dow) d.setUTCDate(d.getUTCDate() - 1);
  return d.getTime();
}
/** First `dow` on or after (y,m,d). */
function _nextDowOnOrAfter(y, m, d, dow) {
  const t = new Date(_utc(y, m, d));
  while (t.getUTCDay() !== dow) t.setUTCDate(t.getUTCDate() + 1);
  return t.getTime();
}

/**
 * The next expiry date for an instrument, as 'YYYY-MM-DD' (IST calendar date).
 * Rolls over once the 15:30 IST close on expiry day has passed.
 * Returns null for unknown / trading-disabled instruments.
 */
function nextExpiry(inst, now = new Date()) {
  const rec = _tradable(inst);
  if (!rec) return null;
  const { y, m, d, mins } = _ist(now);
  const today = _utc(y, m, d);
  const expired = (ms) => ms < today || (ms === today && mins >= EXPIRY_CLOSE_MIN);

  if (rec.expiryType === 'MONTHLY') {
    let e = _lastDowOfMonth(y, m, rec.expiryDow);
    if (expired(e)) e = _lastDowOfMonth(m === 11 ? y + 1 : y, (m + 1) % 12, rec.expiryDow);
    return _iso(e);
  }
  // weekly: next matching weekday, skipping today if the close has passed
  let e = _nextDowOnOrAfter(y, m, d, rec.expiryDow);
  if (expired(e)) e = e + 7 * 86400000;
  return _iso(e);
}

/**
 * Time to expiry in YEARS, measured to the 15:30 IST close.
 * Floored at half a day so downstream Black-Scholes never sees T <= 0.
 * Returns null for unknown / trading-disabled instruments.
 */
function timeToExpiryYears(inst, now = new Date()) {
  const exp = nextExpiry(inst, now);
  if (!exp) return null;
  const [ey, em, ed] = exp.split('-').map(Number);
  const closeUtcMs = _utc(ey, em - 1, ed) + (EXPIRY_CLOSE_MIN - IST_OFFSET_MIN) * 60000;
  const days = (closeUtcMs - now.getTime()) / 86400000;
  return Math.max(days, 0.5) / 365;
}

/** Full metadata for one TRADABLE instrument, or null. Superset of the pre-C1c-1 shape. */
function getMeta(inst) {
  const rec = _tradable(inst);
  if (!rec) return null;
  return {
    inst: rec.inst,
    lotSize: lotSize(rec.inst),          // honours the env override
    step: rec.strikeInterval,            // pre-C1c-1 field name, preserved
    segment: rec.segment,                // pre-C1c-1 field name, preserved
    strikeInterval: rec.strikeInterval,
    tickSize: rec.tickSize,
    tickRaw: rec.tickRaw,
    exchange: rec.exchange,
    brokerSegment: rec.brokerSegment,
    expiryType: rec.expiryType,
    tradingEnabled: true,
    lastVerifiedAt: rec.lastVerifiedAt,
    verificationSource: rec.verificationSource,
  };
}

/**
 * Every instrument approved for trading. Three engines derive behaviour from this,
 * so it must NEVER widen implicitly — adding a disabled instrument to the catalog
 * does not change this list.
 */
function instruments() { return Object.keys(INSTRUMENTS).filter(isTradingEnabled); }

// ── CATALOG SURFACE — verified metadata regardless of tradingEnabled ──────────

/** The full verified record for any known instrument, enabled or not. Reading != trading. */
function catalog(inst) {
  const rec = _record(inst);
  if (!rec) return null;
  return { ...rec, tradingEnabled: isTradingEnabled(rec.inst) };
}

/** Every instrument this registry knows about, enabled or not. */
function allInstruments() { return Object.keys(INSTRUMENTS); }

// ── drift detection ───────────────────────────────────────────────────────────

/**
 * Cross-check the registry against a live broker contract list.
 * Uses the CATALOG lot size, so a disabled instrument can still be validated.
 * @param {string} inst
 * @param {Array<{lot_size:number}>} contracts  rows from the broker contract master
 * @returns {{ok:boolean, expected:number|null, found:number[], reason:string}}
 */
function verifyAgainstContracts(inst, contracts) {
  const rec = _record(inst);
  if (!rec) return { ok: false, expected: null, found: [], reason: `unknown instrument: ${inst}` };
  const expected = _envLot(rec.inst) ?? rec.lotSize;
  const found = [...new Set((contracts || []).map((c) => Number(c && c.lot_size)).filter((n) => Number.isFinite(n) && n > 0))];
  if (!found.length) return { ok: false, expected, found, reason: 'no lot_size present in contract rows' };
  if (found.length > 1) return { ok: false, expected, found, reason: `contract master reports multiple lot sizes: ${found.join(', ')}` };
  const ok = found[0] === expected;
  return { ok, expected, found, reason: ok ? 'matches broker contract master' : `registry says ${expected}, broker says ${found[0]}` };
}

module.exports = {
  // trading surface
  lotSize, step, strikeInterval, tickSize, tickRaw, segment, brokerSegment,
  exchange, expiryType, expiryDow, getMeta, instruments,
  // expiry calendar
  nextExpiry, timeToExpiryYears,
  // catalog surface
  catalog, allInstruments, isTradingEnabled,
  // drift detection
  verifyAgainstContracts,
  // constants
  PROVENANCE, INSTRUMENTS, VERIFIED_LOT_SIZE, VERIFIED_STEP, VERIFIED_TICK_SIZE, SEGMENT,
};
