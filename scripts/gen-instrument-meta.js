#!/usr/bin/env node
'use strict';
/**
 * Generates `public/js/instrument-meta.js` from the Instrument Registry.
 *
 * WHY GENERATE RATHER THAN FETCH
 *   The browser needs contract metadata (lot size, strike step) to render. The registry
 *   lives in Node and is not exposed over HTTP — adding a route means editing `server.js`,
 *   which is a protected file requiring the owner's approval.
 *
 * WHY GENERATE RATHER THAN HAND-MAINTAIN
 *   Two pages hand-maintained their own tables. Both drifted: `dashboard.html` had NIFTY 75
 *   (truth: 65) and `strategy.html` had NIFTY 75 and BANKNIFTY 35 (truth: 30). A hand copy
 *   of the single source of truth is not a copy; it is a second, wrong source.
 *
 * This file is a BUILD ARTEFACT. Do not edit `public/js/instrument-meta.js` by hand.
 * `test/dashboard-rule.test.js` regenerates it in memory and fails if it has drifted, so a
 * stale artefact is a red suite rather than a wrong number on screen.
 *
 * FAIL-CLOSED: only `tradingEnabled` instruments carry a lot size on the trading surface.
 * A disabled instrument appears with `lot: null` — the browser must render '—', not a guess.
 *
 *   npm run gen:instrument-meta
 */
const path = require('path');
const registry = require('../instrument-registry.js');
const { writeFileAtomicSync } = require('../safe-write.js');

function render() {
  const rows = registry.allInstruments().map((inst) => {
    const cat = registry.catalog(inst);
    const enabled = registry.isTradingEnabled(inst);
    return `  ${inst}: { lot: ${enabled ? cat.lotSize : 'null'}, step: ${enabled ? cat.strikeInterval : 'null'}, ` +
      `exchange: ${JSON.stringify(cat.exchange)}, tradingEnabled: ${enabled} },`;
  });

  return `/* GENERATED FILE — DO NOT EDIT.
 * Source of truth: instrument-registry.js (broker-verified).
 * Regenerate:      npm run gen:instrument-meta
 * Drift tripwire:  test/dashboard-rule.test.js
 *
 * The dashboard is a visualization layer. It never computes market logic and never
 * declares market metadata. \`lot: null\` means the instrument has no broker-verified
 * contract size on the trading surface — render '—', never a default.
 */
window.INSTRUMENT_META = Object.freeze({
${rows.join('\n')}
});

/** Lot size, or null when unknown. NEVER a fallback: a rupee figure derived from a
 *  guessed contract size is a fabricated number wearing a currency symbol. */
window.instLot  = (i) => (window.INSTRUMENT_META[i] || {}).lot  ?? null;
window.instStep = (i) => (window.INSTRUMENT_META[i] || {}).step ?? null;
`;
}

const OUT = path.join(__dirname, '..', 'public', 'js', 'instrument-meta.js');

if (require.main === module) {
  require('fs').mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileAtomicSync(OUT, render());
  console.log(`wrote ${path.relative(process.cwd(), OUT)} from the Instrument Registry`);
}

module.exports = { render, OUT };
