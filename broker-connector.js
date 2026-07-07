// ============================================================================
//  broker-connector.js — #7 Broker Connector Interface Layer
//
//  The bot talks to three broker adapters (Upstox / Dhan-live / Kotak-Neo) that already
//  share a method shape but with no enforced contract — so a swap or a new adapter is
//  risky and shape-handling is duplicated. This is a thin, ADDITIVE interface layer:
//    • CORE — the method contract every connector must satisfy
//    • conforms() — validate an adapter against the contract (safe-swap gate)
//    • describe() — capability map (what a given adapter actually implements)
//    • normalizePrice/normalizeChain — one canonical output shape (kills duplication)
//    • BrokerRegistry — register named adapters, introspect, select the active one
//
//  It does NOT modify the existing connectors — it wraps/introspects them. Pure + tested.
// ============================================================================
'use strict';

// Methods every connector MUST provide to be swappable.
const CORE = [
  'connect', 'disconnect',
  'getNiftyPrice', 'getSensexPrice', 'getBankNiftyPrice',
  'getNiftyOptionChain', 'getBankNiftyOptionChain', 'getOptionChain',
  'placeOrder', 'getPositions', 'getOrders', 'isMarketOpen',
];
// Nice-to-have methods — used when present, degraded gracefully when absent.
const OPTIONAL = ['refreshAuth', 'isExpiryDay', 'getSensexOptionChain', 'getOptionHistory'];

const isFn = (o, m) => o && typeof o[m] === 'function';

// Does a connector satisfy the CORE contract?
function conforms(connector) {
  const missing = CORE.filter(m => !isFn(connector, m));
  return { ok: missing.length === 0, missing, core: CORE.length, present: CORE.length - missing.length };
}

// Capability map — which CORE + OPTIONAL methods this connector implements.
function describe(connector) {
  const cap = {};
  for (const m of [...CORE, ...OPTIONAL]) cap[m] = isFn(connector, m);
  return cap;
}

// Canonical price shape: { price:Number|null, source }
function normalizePrice(raw, source = null) {
  if (raw == null) return { price: null, source };
  if (typeof raw === 'number') return { price: isFinite(raw) ? raw : null, source };
  const p = Number(raw.price ?? raw.ltp ?? raw.last ?? raw.value);
  return { price: isFinite(p) ? p : null, source };
}

// Canonical chain shape: { strikes:[], atmStrike, spot, source }
function normalizeChain(raw, source = null) {
  if (!raw || typeof raw !== 'object') return { strikes: [], atmStrike: null, spot: null, source };
  const strikes = Array.isArray(raw.strikes) ? raw.strikes : (Array.isArray(raw.rows) ? raw.rows : []);
  return {
    strikes,
    atmStrike: raw.atmStrike ?? raw.atm ?? null,
    spot: raw.spot ?? raw.underlying ?? null,
    expiry: raw.expiry ?? null,
    source,
  };
}

// Registry of named connectors — introspect + safe-swap the active one.
class BrokerRegistry {
  constructor() { this.entries = {}; this.activeName = null; }
  register(name, connector, { activate } = {}) {
    const c = conforms(connector);
    this.entries[name] = { name, connector, conforms: c, capabilities: describe(connector) };
    if (activate || (!this.activeName && c.ok)) this.activeName = name;
    return c;
  }
  use(name) {
    if (!this.entries[name]) throw new Error(`no broker connector registered as '${name}'`);
    if (!this.entries[name].conforms.ok) throw new Error(`connector '${name}' does not satisfy the core contract (missing: ${this.entries[name].conforms.missing.join(', ')})`);
    this.activeName = name;
    return this.active();
  }
  active() { return this.activeName ? this.entries[this.activeName] : null; }
  list() {
    return Object.values(this.entries).map(e => ({
      name: e.name, active: e.name === this.activeName,
      conforms: e.conforms.ok, missing: e.conforms.missing,
      coverage: `${e.conforms.present}/${e.conforms.core}`,
      supportsOptionHistory: !!e.capabilities.getOptionHistory,
    }));
  }
}

module.exports = { CORE, OPTIONAL, conforms, describe, normalizePrice, normalizeChain, BrokerRegistry };
