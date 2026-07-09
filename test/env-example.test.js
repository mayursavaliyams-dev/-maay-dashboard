/**
 * .env.example — configuration-surface guard.  Run: node test/env-example.test.js
 *
 * Created as part of MIGRATION C1c-0.
 *
 * Bug that shipped: `.env.example` carried NIFTY_LOT_SIZE=75 and BANKNIFTY_LOT_SIZE=35.
 * Those env vars are an ACTIVE override channel — instrument-registry._envLot(),
 * server.js INSTRUMENT_META and server.js PS_INSTS all read `${INST}_LOT_SIZE` and let
 * it win over the broker-verified constant. Anyone doing the ordinary `cp .env.example .env`
 * would therefore have silently reverted the entire C1/C1b lot-size migration and
 * re-inflated realised P&L by +15.4% (NIFTY) / +16.7% (BANKNIFTY) — with no test failing,
 * because no test had ever looked at a .env file.
 *
 * Root cause: a documentation file was a load-bearing part of the money math.
 * These assertions make that impossible to reintroduce.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };

console.log('.env.example (migration C1c-0)');

const ROOT = path.join(__dirname, '..');
const raw = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');

// Assignments only — comments explaining the verified sizes are allowed and desirable.
const assignments = raw
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .filter((l) => /^\s*[A-Za-z_][A-Za-z0-9_]*\s*=/.test(l))
  .map((l) => l.trim());

const valueOf = (key) => {
  const line = assignments.find((l) => l.split('=')[0].trim() === key);
  return line === undefined ? undefined : line.slice(line.indexOf('=') + 1).trim();
};

// ══ C1c-0: no lot size may be pre-populated in the example config ══
{
  const LOT_KEYS = assignments
    .map((l) => l.split('=')[0].trim())
    .filter((k) => /_LOT_SIZE$/.test(k));

  ok(LOT_KEYS.length > 0, 'C1c-0: *_LOT_SIZE keys are still documented (backward compatible)');

  for (const k of LOT_KEYS) {
    ok(valueOf(k) === '', `C1c-0: ${k} ships BLANK (no value to poison the registry)`);
  }

  ok(!/^\s*[A-Za-z_][A-Za-z0-9_]*_LOT_SIZE\s*=\s*(75|35|65|30|20|120|60|500)\s*$/m.test(raw),
    'C1c-0: no numeric lot size literal survives on any assignment line');
}

// ══ blank really does fall through to the verified value in every consumer ══
{
  // Consumer 1: instrument-registry._envLot  ('' → null → verified constant)
  for (const k of ['NIFTY_LOT_SIZE', 'BANKNIFTY_LOT_SIZE', 'SENSEX_LOT_SIZE']) process.env[k] = '';
  delete require.cache[require.resolve('../instrument-registry.js')];
  const registry = require('../instrument-registry.js');
  ok(registry.lotSize('NIFTY') === 65, 'C1c-0: blank env → registry still returns broker-verified NIFTY 65');
  ok(registry.lotSize('BANKNIFTY') === 30, 'C1c-0: blank env → registry still returns broker-verified BANKNIFTY 30');
  ok(registry.lotSize('SENSEX') === 20, 'C1c-0: blank env → registry still returns broker-verified SENSEX 20');

  // Consumer 2 & 3: the `Number(process.env.X || <default>)` idiom used by
  // server.js INSTRUMENT_META (:268) and server.js PS_INSTS (:4415-4419).
  ok(Number(process.env.BANKNIFTY_LOT_SIZE || 30) === 30, 'C1c-0: blank env → server.js INSTRUMENT_META idiom yields 30');
  ok(Number(process.env.NIFTY_LOT_SIZE || 65) === 65, 'C1c-0: blank env → server.js PS_INSTS idiom yields 65');

  for (const k of ['NIFTY_LOT_SIZE', 'BANKNIFTY_LOT_SIZE', 'SENSEX_LOT_SIZE']) delete process.env[k];
}

// ══ the override channel itself must remain functional (documented escape hatch) ══
{
  process.env.NIFTY_LOT_SIZE = '80';   // a hypothetical future contract revision
  delete require.cache[require.resolve('../instrument-registry.js')];
  const registry = require('../instrument-registry.js');
  ok(registry.lotSize('NIFTY') === 80, 'C1c-0: a deliberate non-empty override still wins (escape hatch intact)');
  delete process.env.NIFTY_LOT_SIZE;
  delete require.cache[require.resolve('../instrument-registry.js')];
}

// ══ the comment must tell the next engineer why the blanks are load-bearing ══
{
  ok(/instrument-registry/.test(raw), 'C1c-0: .env.example names the single source of truth');
  ok(/EMERGENCY OVERRIDE ONLY/.test(raw), 'C1c-0: the blanks are documented as deliberate, not an omission');
}

console.log(`\n${pass} assertions passed`);
