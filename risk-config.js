/* ═══════════════════════════════════════════════════════════════════════════
   risk-config — every limit the risk layer enforces, and a record of every
   change to any of them.

   TWO PROPERTIES THAT MATTER MORE THAN THE VALUES

   1. RELOADABLE WITHOUT RESTART, BUT NEVER SILENTLY. A risk limit that changed
      and nobody noticed is the same as no limit. Every reload diffs the previous
      configuration against the new one and writes an entry naming the limit, the
      old value, the new value and when. `changeLog()` returns that history.

   2. A LIMIT THAT WILL NOT PARSE IS NOT A LIMIT. `NaN` compared with anything is
      false, so a mistyped threshold does not merely fail to bind — it DISABLES
      the check it belongs to and every order passes. Values are therefore
      coerced against the type of their default, and a value that will not coerce
      is refused, reported, and replaced by the default. The system runs on a
      limit the operator did not choose, and it says so.

   UNITS ARE IN THE NAME. `_PCT` is a percentage of equity, `_RS` is rupees,
   `_LOTS` is lots, `_MS` is milliseconds. A limit whose unit has to be inferred
   is a limit that will be set wrongly.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

const { writeJsonSync, readJsonSync } = require('./safe-write');

const OVERRIDES = path.join(__dirname, 'data', 'config-overrides.json');
const CHANGELOG = path.join(__dirname, 'data', 'risk-config-changes.json');

const DEFAULTS = {
  // ── master ───────────────────────────────────────────────────────────────
  /* The layer is ON by default. This is the one flag in the codebase that
     defaults to enabled, because a risk layer that has to be switched on is a
     risk layer that will be off on the day it was needed. What it does when it
     cannot evaluate a limit is governed by RISK_FAIL_MODE below, not by this. */
  RISK_ENABLED: true,

  /* What happens when a limit cannot be evaluated — missing equity, stale
     greeks, an unreadable position book. 'BLOCK' is the only defensible default:
     the alternative is that the layer's own blind spots become the widest hole
     in it. 'WARN' exists for a deliberate, temporary, logged decision. */
  RISK_FAIL_MODE: 'BLOCK',

  // ── capital ──────────────────────────────────────────────────────────────
  RISK_MAX_DEPLOYED_PCT: 60,           // % of equity that may be at work at once
  RISK_MAX_DEPLOYED_PER_UNDERLYING_PCT: 35,
  RISK_MAX_OPEN_POSITIONS: 8,
  RISK_MAX_LOTS_PER_INSTRUMENT: 20,

  // ── portfolio greeks (normal session) ────────────────────────────────────
  /* Delta in index points of underlying exposure per ₹1 lakh of equity; gamma,
     vega and theta likewise normalised, so a limit set at ₹1 lakh still means
     something at ₹7 lakh. Absolute limits would have to be rewritten every time
     the capital changed, and would not be. */
  RISK_MAX_NET_DELTA_PER_LAKH: 150,
  RISK_MAX_NET_GAMMA_PER_LAKH: 8,
  RISK_MAX_NET_VEGA_PER_LAKH: 400,
  RISK_MAX_NET_THETA_PER_LAKH: 900,    // magnitude; a large negative theta is the risk

  // ── portfolio greeks (expiry day) ────────────────────────────────────────
  /* Gamma is the reason this section exists. As time to expiry goes to zero the
     gamma of a near-the-money option goes to infinity in the model and to
     "enormous" in fact, so a position that was inside its limit yesterday can be
     far outside it today without a single trade being placed. */
  RISK_EXPIRY_MAX_NET_DELTA_PER_LAKH: 60,
  RISK_EXPIRY_MAX_NET_GAMMA_PER_LAKH: 2,
  RISK_EXPIRY_MAX_NET_VEGA_PER_LAKH: 150,
  RISK_EXPIRY_MAX_NET_THETA_PER_LAKH: 900,

  // ── expiry-day forced exit ───────────────────────────────────────────────
  RISK_EXPIRY_NO_NEW_ENTRY_MIN_BEFORE_CLOSE: 45,   // minutes before 15:30 IST
  RISK_EXPIRY_FORCE_EXIT_MIN_BEFORE_CLOSE: 20,

  // ── day stops ────────────────────────────────────────────────────────────
  RISK_DAY_LOSS_LIMIT_PCT: 3,          // realised loss today, % of start-of-day equity
  RISK_DAY_TRAILING_DD_PCT: 2,         // drawdown from the day's PEAK equity

  // ── concentration ────────────────────────────────────────────────────────
  RISK_MAX_RISK_PER_EXPIRY_PCT: 50,    // % of total risk in one expiry
  RISK_MAX_RISK_PER_STRIKE_PCT: 25,

  // ── sizing ───────────────────────────────────────────────────────────────
  /* The hard budget. Nothing — not Kelly, not a strategy override, not a
     conviction flag — may size above this. */
  RISK_PER_TRADE_RISK_PCT: 1.0,
  RISK_KELLY_FRACTION: 0.25,           // quarter-Kelly
  RISK_KELLY_MAX_PCT: 2.0,             // cap on Kelly's own output, before the hard budget
  RISK_MIN_LOTS: 1,

  // ── kill switch ──────────────────────────────────────────────────────────
  RISK_KILL_ON_DAY_LOSS: true,
  RISK_KILL_CONSECUTIVE_LOSSES: 4,
  RISK_KILL_BROKER_ERROR_RATE_PCT: 25, // over the trailing window below
  RISK_KILL_ERROR_WINDOW: 20,          // last N broker calls
  RISK_KILL_DATA_STALENESS_MS: 15000,
  /* 'STOP_ENTRIES' — no new positions, existing ones keep their exits.
     'FLATTEN'      — close everything now.
     FLATTEN is not the default: forcing exits into the same disordered market
     that tripped the switch is itself a risk, and it should be a decision rather
     than a surprise. */
  RISK_KILL_ACTION: 'STOP_ENTRIES',
};

const NUMERIC = new Set(Object.keys(DEFAULTS).filter(k => typeof DEFAULTS[k] === 'number'));
const BOOLEAN = new Set(Object.keys(DEFAULTS).filter(k => typeof DEFAULTS[k] === 'boolean'));

let _current = null;
let _rejected = [];
let _changes = [];

function _readOverrides() {
  // Corrupt overrides fall back to the built-in DEFAULTS, which are the
  // conservative values — and it is reported loudly, because the system is then
  // running on limits nobody chose.
  try { return readJsonSync(OVERRIDES, { fallback: {} }); }
  catch (e) { console.error(`[risk-config] overrides unreadable (${e.message}) — running on built-in defaults`); return {}; }
}

function _coerce(key, raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (BOOLEAN.has(key)) {
    if (typeof raw === 'boolean') return raw;
    if (/^(1|true|yes|on)$/i.test(String(raw))) return true;
    if (/^(0|false|no|off)$/i.test(String(raw))) return false;
    _rejected.push({ key, raw, why: 'not a boolean' });
    return undefined;
  }
  if (NUMERIC.has(key)) {
    const n = Number(raw);
    if (!Number.isFinite(n)) { _rejected.push({ key, raw, why: 'not a finite number — a NaN limit disables its check entirely' }); return undefined; }
    if (n < 0) { _rejected.push({ key, raw, why: 'negative' }); return undefined; }
    return n;
  }
  return String(raw);
}

function _build() {
  _rejected = [];
  const ov = _readOverrides();
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    const chain = [_coerce(key, ov[key]), _coerce(key, process.env[key]), DEFAULTS[key]];
    out[key] = chain.find(v => v !== undefined);
  }
  return out;
}

function _persistChanges(log) {
  // Atomic: the change log is the only record that a limit moved, and a torn
  // write would lose the entry for the change most likely to matter.
  try { writeJsonSync(CHANGELOG, log.slice(-500)); }
  catch (e) { console.error(`[risk-config] could not persist the change log: ${e.message}`); }
}

function _loadChanges() {
  try { const j = readJsonSync(CHANGELOG, { fallback: [] }); return Array.isArray(j) ? j : []; }
  catch (e) { console.error(`[risk-config] change log unreadable: ${e.message}`); return []; }
}

/**
 * Reload from disk and env. Returns { config, changes, rejected }.
 *
 * The diff is the point. A limit can be widened at 14:50 by someone who means
 * well and nobody would know — so the change is named, timestamped and kept.
 */
function reload({ by = 'system', log = console } = {}) {
  const next = _build();
  const prev = _current;
  const changes = [];

  if (prev) {
    for (const k of Object.keys(next)) {
      if (prev[k] !== next[k]) changes.push({ at: new Date().toISOString(), by, limit: k, from: prev[k], to: next[k] });
    }
  }
  _current = next;

  if (changes.length) {
    _changes = _loadChanges().concat(changes);
    _persistChanges(_changes);
    for (const c of changes) {
      // A risk limit changing is a WARNING-level event, not an informational
      // one, whichever direction it moved.
      log.warn(`[risk-config] ${c.limit}: ${c.from} → ${c.to} (by ${c.by})`);
    }
  }
  for (const r of _rejected) {
    log.error(`[risk-config] REFUSED ${r.key}=${JSON.stringify(r.raw)} — ${r.why}. Using the default ${DEFAULTS[r.key]}.`);
  }
  return { config: { ..._current }, changes, rejected: _rejected.slice() };
}

function get() {
  if (!_current) reload({ by: 'startup' });
  return { ..._current };
}

function changeLog() { return (_changes.length ? _changes : _loadChanges()).slice(); }
function rejected() { return _rejected.slice(); }
function describe() { return { defaults: { ...DEFAULTS }, overrideFile: 'data/config-overrides.json', changeLogFile: 'data/risk-config-changes.json' }; }

module.exports = { get, reload, changeLog, rejected, describe, DEFAULTS };
