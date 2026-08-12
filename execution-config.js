/* ═══════════════════════════════════════════════════════════════════════════
   execution-config — every threshold the execution layer uses, in one place.

   THE RULE: nothing in the execution path reads a magic number. If a value can
   change a fill, it lives here, it has a documented unit, and it can be
   overridden without editing code.

   PRECEDENCE, highest first
     1. data/config-overrides.json   — persisted, survives restart, editable live
     2. process.env                  — for a one-off run
     3. the defaults below           — documented, and deliberately conservative

   WHY THE DEFAULTS ARE CONSERVATIVE
   A too-tight liquidity gate refuses trades. A too-loose one lets an order into
   a book that cannot absorb it. The first failure is visible in the rejection
   log and costs an opportunity; the second is invisible until the fill comes
   back and costs money. The defaults therefore err towards refusing.

   TICKS, NOT RUPEES
   Aggression, chase distance and slice thresholds are expressed in TICKS, never
   in rupees. The tick is ₹0.05 across these instruments, which is 3.7% of a
   ₹1.35 option and 0.025% of a ₹200 one — a rupee offset that is prudent on one
   is absurd on the other. Ticks are the only unit that means the same thing
   across the chain.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

const { readJsonSync } = require('./safe-write');

const OVERRIDES = path.join(__dirname, 'data', 'config-overrides.json');

/* Every knob, with its unit and what it does. Read this table before changing
   any of them — several interact. */
const DEFAULTS = {
  // ── master switches ──────────────────────────────────────────────────────
  /* The new path is OFF until switched on, and PAPER until switched off.
     Two separate flags on purpose: enabling the engine and letting it send a
     real order are different decisions and must not share a switch. */
  EXEC_ENGINE_ENABLED: false,
  EXEC_PAPER_MODE: true,

  // ── reference price and aggression ───────────────────────────────────────
  /* Where the first limit goes, in ticks from mid. 0 = at mid. Positive is
     towards the touch we must cross (more aggressive), negative is away from it
     (more passive, less likely to fill). */
  EXEC_AGGRESSION_TICKS: 0,

  // ── the chase ────────────────────────────────────────────────────────────
  EXEC_REPRICE_INTERVAL_MS: 3000,   // how often an unfilled order is re-priced
  EXEC_CHASE_STEP_TICKS: 1,         // ticks moved towards the touch per step
  EXEC_MAX_CHASE_TICKS: 4,          // total ticks the order may travel from its first price
  EXEC_TIMEOUT_MS: 20000,           // hard stop, measured from first placement

  /* What happens at the hard timeout. There is no default that is right for
     every strategy, so this is set PER STRATEGY below and this value only
     applies when a strategy has not declared one.

       'CANCEL' — give up the trade. Correct when entry price is the edge.
       'CROSS'  — pay the spread and get filled. Correct when being in the
                  position matters more than the entry.

     Never silent: whichever happens is written to the ledger with the policy
     that chose it. */
  EXEC_TIMEOUT_POLICY: 'CANCEL',

  // ── liquidity gate ───────────────────────────────────────────────────────
  /* Relative spread = (ask − bid) / mid. 0.06 = 6%.
     Measured on a live chain 2026-07-30: a ₹1.35 PE quoted 1.35/1.40 is 3.6%;
     an untraded deep-ITM CE quoted 2456.40/2689.45 is 9%. The default sits
     between them deliberately — it admits the first and refuses the second. */
  EXEC_MAX_REL_SPREAD: 0.06,

  /* Top-of-book quantity must be at least this multiple of our order size.
     2 means the touch shows twice what we are sending. */
  EXEC_MIN_TOP_QTY_MULTIPLE: 2,

  /* A quote older than this is not a quote. */
  EXEC_MAX_QUOTE_AGE_MS: 5000,

  /* How far from ATM we are willing to trade, in strike steps. 12 steps on
     NIFTY is 600 points. Outside this the spread widens faster than any
     execution technique can recover. */
  EXEC_LIQUIDITY_BAND_STEPS: 12,

  /* An absolute floor on premium. Below this the tick itself dominates:
     one tick on a ₹0.50 option is 10%, so no placement policy can help. */
  EXEC_MIN_PREMIUM: 1.0,

  // ── slicing ──────────────────────────────────────────────────────────────
  /* If our order exceeds this fraction of visible top-of-book quantity, it is
     split. 0.25 = never show more than a quarter of the touch in one order. */
  EXEC_SLICE_TOP_QTY_FRACTION: 0.25,
  EXEC_SLICE_DELAY_MS: 750,         // between child orders
  EXEC_MAX_SLICES: 6,               // beyond this, the order is refused rather than dribbled

  // ── broker rate limits ───────────────────────────────────────────────────
  /* The connector already governs quote traffic. These bound ORDER traffic,
     which is separate and stricter at every Indian broker. */
  EXEC_MAX_AMENDS_PER_ORDER: 8,     // hard cap on re-prices, independent of the chase maths
  EXEC_MIN_ACTION_GAP_MS: 250,      // floor between any two order actions
  EXEC_BATCH_CANCELS: true,         // use a batch endpoint for cancels where available

  // ── ledger ───────────────────────────────────────────────────────────────
  EXEC_LEDGER_MAX_ROWS: 20000,      // rows kept in the working file
};

/* Per-strategy overrides. A strategy's execution needs follow from its edge:

   STRANGLE   sells premium and the credit IS the edge, so a worse entry is a
              directly worse expectancy. It waits, and it cancels rather than
              paying up.
   GAMMA_BLAST buys expiry-afternoon moves. Being in the position is the whole
              trade; a missed entry is a missed move. It crosses.
   BOUNCE / TREND_RIDE are directional buys with tight stops, where a bad entry
              eats the stop distance. They lean passive.

   Anything not listed uses the global defaults. */
const STRATEGY = {
  STRANGLE:    { EXEC_TIMEOUT_POLICY: 'CANCEL', EXEC_AGGRESSION_TICKS: -1, EXEC_MAX_CHASE_TICKS: 3, EXEC_TIMEOUT_MS: 30000 },
  GAMMA_BLAST: { EXEC_TIMEOUT_POLICY: 'CROSS',  EXEC_AGGRESSION_TICKS: 1,  EXEC_MAX_CHASE_TICKS: 6, EXEC_TIMEOUT_MS: 8000 },
  BOUNCE:      { EXEC_TIMEOUT_POLICY: 'CANCEL', EXEC_AGGRESSION_TICKS: 0,  EXEC_MAX_CHASE_TICKS: 3 },
  TREND_RIDE:  { EXEC_TIMEOUT_POLICY: 'CANCEL', EXEC_AGGRESSION_TICKS: 0,  EXEC_MAX_CHASE_TICKS: 4 },
  AFTERNOON:   { EXEC_TIMEOUT_POLICY: 'CANCEL', EXEC_AGGRESSION_TICKS: 0 },
};

const NUMERIC = new Set(Object.keys(DEFAULTS).filter(k => typeof DEFAULTS[k] === 'number'));
const BOOLEAN = new Set(Object.keys(DEFAULTS).filter(k => typeof DEFAULTS[k] === 'boolean'));

function readOverrides() {
  /* Validated read: safe-write recovers from its own backup if the file is torn,
     and refuses to guess when both copies are unreadable. Falling back to the
     built-in defaults is right here — they are the conservative values — but it
     is reported, because the system is then running on thresholds nobody chose. */
  try { return readJsonSync(OVERRIDES, { fallback: {} }); }
  catch (e) { console.error(`[execution-config] overrides unreadable (${e.message}) — running on built-in defaults`); return {}; }
}

/* Coerce a value to the type its default declares.

   A threshold that silently becomes NaN would disable the gate it belongs to —
   which is the failure mode where a bad config value opens the door instead of
   closing it. So a value that will not coerce is REFUSED and the default is
   used, with the rejection recorded for the health surface. */
const _badValues = [];

function coerce(key, raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (BOOLEAN.has(key)) {
    if (typeof raw === 'boolean') return raw;
    if (/^(1|true|yes|on)$/i.test(String(raw))) return true;
    if (/^(0|false|no|off)$/i.test(String(raw))) return false;
    _badValues.push({ key, raw, why: 'not a boolean' });
    return undefined;
  }
  if (NUMERIC.has(key)) {
    const n = Number(raw);
    if (!Number.isFinite(n)) { _badValues.push({ key, raw, why: 'not a finite number' }); return undefined; }
    if (n < 0) { _badValues.push({ key, raw, why: 'negative' }); return undefined; }
    return n;
  }
  return String(raw);
}

/**
 * Resolve the full configuration, optionally for one strategy.
 * @param {?string} strategy  e.g. 'STRANGLE'. Unknown names fall back to defaults.
 */
function get(strategy) {
  _badValues.length = 0;
  const ov = readOverrides();
  const perStrategy = (strategy && STRATEGY[String(strategy).toUpperCase()]) || {};
  const out = {};

  for (const key of Object.keys(DEFAULTS)) {
    // Per-strategy sits BELOW an explicit override: if someone has set a value
    // in config-overrides.json they meant it, and a strategy default must not
    // quietly win over an operator's decision.
    const chain = [coerce(key, ov[key]), coerce(key, process.env[key]), perStrategy[key], DEFAULTS[key]];
    out[key] = chain.find(v => v !== undefined);
  }

  /* Coherence checks between knobs that are individually valid and jointly
     wrong. Found the first time this engine ran against a live book: GAMMA_BLAST
     builds a 5-rung ladder but re-prices every 3,000 ms against an 8,000 ms
     timeout, so rungs 4 and 5 can never be reached. The order looks like it is
     chasing to the touch and in fact gives up two ticks short of it.

     These are WARNINGS, not refusals. Every combination below is something an
     operator might mean; what they must not be is invisible. */
  const warnings = [];
  const rungs = Math.floor(out.EXEC_MAX_CHASE_TICKS / Math.max(1, out.EXEC_CHASE_STEP_TICKS)) + 1;
  const walkMs = (rungs - 1) * out.EXEC_REPRICE_INTERVAL_MS;
  if (walkMs > out.EXEC_TIMEOUT_MS) {
    warnings.push({
      key: 'EXEC_TIMEOUT_MS',
      why: `the ladder has ${rungs} rungs and needs ${walkMs} ms to walk, but the timeout is ${out.EXEC_TIMEOUT_MS} ms — ` +
           `roughly ${rungs - Math.floor(out.EXEC_TIMEOUT_MS / out.EXEC_REPRICE_INTERVAL_MS) - 1} rung(s) are unreachable`,
    });
  }
  if (rungs > out.EXEC_MAX_AMENDS_PER_ORDER) {
    warnings.push({
      key: 'EXEC_MAX_AMENDS_PER_ORDER',
      why: `the ladder has ${rungs} rungs but only ${out.EXEC_MAX_AMENDS_PER_ORDER} amendments are allowed`,
    });
  }
  if (out.EXEC_TIMEOUT_POLICY === 'CROSS' && out.EXEC_AGGRESSION_TICKS < 0) {
    warnings.push({
      key: 'EXEC_AGGRESSION_TICKS',
      why: 'starting passive and crossing at timeout pays the spread anyway, after a delay — the delay is the only thing gained',
    });
  }
  out._warnings = warnings;

  out._strategy = strategy ? String(strategy).toUpperCase() : null;
  out._strategyDefaultsApplied = Object.keys(perStrategy);
  // Surfaced rather than swallowed. A refused config value means the system is
  // running on a threshold the operator did not choose, and they are entitled
  // to know which one.
  out._rejected = _badValues.slice();
  return out;
}

/** Every knob and its default, for the config screen. */
function describe() {
  return {
    defaults: { ...DEFAULTS },
    strategyOverrides: JSON.parse(JSON.stringify(STRATEGY)),
    overrideFile: 'data/config-overrides.json',
    precedence: ['config-overrides.json', 'process.env', 'built-in default'],
  };
}

module.exports = { get, describe, DEFAULTS, STRATEGY };
