#!/usr/bin/env node
/**
 * preflight-registry.js — verify the Instrument Registry against the LIVE broker
 * instrument master. Run:  npm run preflight:registry
 *
 * Migration C1c-6, requirement 15. This is the network edge; all comparison logic lives
 * in registry-drift.js, which is pure and unit-tested with fixtures.
 *
 * Unlike preflight.js this does NOT need the bot server running — only a broker token.
 * Exit codes:  0 = registry agrees   1 = DRIFT (do not trade)   2 = could not check
 */
'use strict';
require('dotenv').config();

const https = require('https');
const registry = require('./instrument-registry.js');
const { checkDrift, formatReport } = require('./registry-drift.js');

const TOKEN = process.env.UPSTOX_ACCESS_TOKEN;
const c = (n, s) => `\x1b[${n}m${s}\x1b[0m`;

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Accept: 'application/json', Authorization: `Bearer ${TOKEN}` }, timeout: 15000 }, (res) => {
      let d = '';
      res.on('data', (x) => (d += x));
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (res.statusCode !== 200 || j.status !== 'success') return reject(new Error(`HTTP ${res.statusCode}: ${(j.errors && j.errors[0] && j.errors[0].message) || d.slice(0, 80)}`));
          resolve(j);
        } catch (e) { reject(new Error(`bad JSON (HTTP ${res.statusCode})`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

const fetchContracts = async (inst) => {
  const key = registry.catalog(inst).underlyingKey;
  const j = await getJson(`https://api.upstox.com/v2/option/contract?instrument_key=${encodeURIComponent(key)}`);
  return j.data;
};

(async () => {
  console.log(`\n${c(36, 'Instrument Registry — broker drift check')}`);
  console.log(`  source     : Upstox GET /v2/option/contract`);
  console.log(`  registry   : verified ${registry.PROVENANCE.verifiedAt}`);
  console.log(`  instruments: ${registry.allInstruments().join(', ')}\n`);

  if (!TOKEN) {
    console.log(c(33, '  ⚠ UPSTOX_ACCESS_TOKEN not set — cannot reach the broker.'));
    console.log(c(33, '    The registry could NOT be verified. This is not a pass.\n'));
    process.exit(2);
  }

  let report;
  try {
    report = await checkDrift({ fetchContracts });
  } catch (e) {
    console.log(c(31, `  ✗ drift check crashed: ${e.message}\n`));
    process.exit(2);
  }

  console.log(formatReport(report));

  if (report.ok) {
    console.log(`\n  ${c(32, '✓ REGISTRY VERIFIED')} — safe to trade.\n`);
    process.exit(0);
  }
  if (report.drifted > 0) {
    console.log(`\n  ${c(31, '✗ REGISTRY DRIFT DETECTED')} — do NOT trade.`);
    console.log('    Re-query the contract master and update instrument-registry.js,');
    console.log('    then bump PROVENANCE.verifiedAt. Never "fix" this with an env override.\n');
    process.exit(1);
  }
  console.log(`\n  ${c(33, '⚠ COULD NOT VERIFY')} — ${report.errored} instrument(s) unreachable. Treat as unverified.\n`);
  process.exit(2);
})();
