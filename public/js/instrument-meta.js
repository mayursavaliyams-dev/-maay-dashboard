/* GENERATED FILE — DO NOT EDIT.
 * Source of truth: instrument-registry.js (broker-verified).
 * Regenerate:      npm run gen:instrument-meta
 * Drift tripwire:  test/dashboard-rule.test.js
 *
 * The dashboard is a visualization layer. It never computes market logic and never
 * declares market metadata. `lot: null` means the instrument has no broker-verified
 * contract size on the trading surface — render '—', never a default.
 */
window.INSTRUMENT_META = Object.freeze({
  NIFTY: { lot: 65, step: 50, exchange: "NSE", tradingEnabled: true },
  BANKNIFTY: { lot: 30, step: 100, exchange: "NSE", tradingEnabled: true },
  SENSEX: { lot: 20, step: 100, exchange: "BSE", tradingEnabled: true },
  FINNIFTY: { lot: null, step: null, exchange: "NSE", tradingEnabled: false },
  MIDCPNIFTY: { lot: null, step: null, exchange: "NSE", tradingEnabled: false },
  BANKEX: { lot: null, step: null, exchange: "BSE", tradingEnabled: false },
});

/** Lot size, or null when unknown. NEVER a fallback: a rupee figure derived from a
 *  guessed contract size is a fabricated number wearing a currency symbol. */
window.instLot  = (i) => (window.INSTRUMENT_META[i] || {}).lot  ?? null;
window.instStep = (i) => (window.INSTRUMENT_META[i] || {}).step ?? null;
