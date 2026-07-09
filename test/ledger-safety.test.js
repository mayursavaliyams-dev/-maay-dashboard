/**
 * ledger-safety — the data-loss chain, per engine. Run: node test/ledger-safety.test.js
 *
 * Migration C3-02 … C3-06.
 *
 * THE CHAIN (measured in C3-01):
 *   1. crash mid `fs.writeFileSync`   → ledger.json truncated
 *   2. next boot: `JSON.parse` throws → `catch { return [] }`
 *   3. first save of the day          → writes `[]` over the ledger
 *   4. every prior trade is gone. No error. Nowhere.
 *
 * The dangerous step is **3, not 2**. Reading `[]` is recoverable; *overwriting* is not.
 * So the fix is not "throw on load" — that would take the whole trading server down at boot.
 * The fix is: recover from `.bak`; if unrecoverable, refuse to SAVE, keep the corrupt bytes on
 * disk for forensics, and surface it loudly in `status()`.
 *
 * Every engine gets the same three tests:
 *   A. a MISSING ledger yields [] and saving works (a fresh install must not be an error)
 *   B. a CORRUPT ledger with a good .bak recovers, and the trades come back
 *   C. a CORRUPT ledger with NO .bak → engine marks itself corrupt, REFUSES to save,
 *      and the corrupt bytes are still on disk afterwards
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };

console.log('ledger-safety (migration C3-02…C3-06)');

const S = require('../safe-write.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} });
const tmp = (n) => path.join(TMP, n);

// ════════════════════════════════════════════════════════════════════════════
//  0. The chain itself, reproduced against the OLD idiom. This is the control.
// ════════════════════════════════════════════════════════════════════════════
{
  const f = tmp('old-idiom.json');
  fs.writeFileSync(f, JSON.stringify([{ trade: 1 }, { trade: 2 }]));

  // step 1: a crash leaves the file truncated
  fs.writeFileSync(f, '[{"trade":1},{"tra');

  // step 2: the old loader
  const oldLoad = () => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) || []; } catch { return []; } };
  const loaded = oldLoad();
  ok(Array.isArray(loaded) && loaded.length === 0, 'CONTROL: the old loader silently returns [] for a truncated ledger');

  // step 3: the old saver overwrites it
  const oldSave = (arr) => { try { fs.writeFileSync(f, JSON.stringify(arr)); } catch (_) {} };
  oldSave(loaded);
  ok(fs.readFileSync(f, 'utf8') === '[]', 'CONTROL: the old saver writes [] over it. Two trades destroyed, no error anywhere');
}

// ════════════════════════════════════════════════════════════════════════════
//  The contract every migrated engine must satisfy
// ════════════════════════════════════════════════════════════════════════════

/**
 * @param {string} name
 * @param {function} mk   () => engine instance with its ledger pointed at `file`
 * @param {string} file
 * @param {function} load (engine) => array
 * @param {function} save (engine) => void
 * @param {function} corrupt (engine) => boolean   engine's own corruption flag
 */
function ledgerContract(name, mk, file, load, save, corrupt) {
  console.log(`\n  ── ${name} ──`);

  // A. missing ledger
  {
    try { fs.unlinkSync(file); } catch (_) {}
    try { fs.unlinkSync(file + '.bak'); } catch (_) {}
    const e = mk();
    ok(Array.isArray(load(e)) && load(e).length === 0, `${name}: a MISSING ledger yields [] (a fresh install is not an error)`);
    ok(corrupt(e) === false, `${name}: a missing ledger is not "corrupt"`);
    save(e);
    ok(fs.existsSync(file), `${name}: saving creates the ledger`);
  }

  // B. corrupt ledger WITH a good backup → recover
  {
    S.writeJsonSync(file, [{ trade: 1 }, { trade: 2 }], { backup: false });
    S.writeJsonSync(file, [{ trade: 1 }, { trade: 2 }, { trade: 3 }], { backup: true }); // .bak = 2 trades
    fs.writeFileSync(file, '[{"trade":1},{"tra');                                        // now truncate
    const e = mk();
    const rows = load(e);
    ok(rows.length === 2, `${name}: a CORRUPT ledger recovers from .bak — 2 trades restored, not []`);
    ok(corrupt(e) === false, `${name}: a recovered ledger is not marked corrupt`);
    save(e);
    ok(S.readJsonSync(file).length === 2, `${name}: and saving after recovery preserves them`);
  }

  // C. corrupt ledger with NO backup → refuse to save, keep the bytes
  {
    try { fs.unlinkSync(file + '.bak'); } catch (_) {}
    const poison = '[{"trade":1},{"tra';
    fs.writeFileSync(file, poison);
    const e = mk();
    ok(load(e).length === 0, `${name}: unrecoverable ledger loads as [] in memory`);
    ok(corrupt(e) === true, `${name}: …but the engine MARKS ITSELF CORRUPT`);
    save(e);
    ok(fs.readFileSync(file, 'utf8') === poison,
      `${name}: and REFUSES to save — the corrupt bytes survive for forensics. THE CHAIN IS BROKEN`);
  }
}

// ── strangle-engine ──
{
  const StrangleEngine = require('../strangle-engine.js');
  const file = tmp('strangle-trades.json');
  const mk = () => {
    const e = new StrangleEngine({ enabled: false });
    e._tradesFile = file;
    e._ledgerCorrupt = false;
    e._allTrades = e._loadTrades();
    return e;
  };
  ledgerContract('strangle-engine', mk, file,
    (e) => e._allTrades,
    (e) => e._saveTrades(),
    (e) => e._ledgerCorrupt === true);
}

// ── agents-engine: trade ledger ──
{
  const { AgentsEngine } = require('../agents-engine.js');
  const file = tmp('ai-agents-trades.json');
  const mk = () => {
    const e = new AgentsEngine({ enabled: false });
    e._tradesFile = file;
    e._allTrades = e._loadTrades();
    return e;
  };
  ledgerContract('agents-engine', mk, file,
    (e) => e._allTrades, (e) => e._saveTrades(), (e) => e._ledgerCorrupt === true);
}

// ── agents-engine: OPEN POSITIONS — the file that tracks real open risk ──
{
  console.log('\n  ── agents-engine open positions ──');
  const { AgentsEngine } = require('../agents-engine.js');
  const file = tmp('ai-agents-open.json');

  // recoverable
  S.writeJsonSync(file, { condors: [{ inst: 'NIFTY' }], directional: [] }, { backup: false });
  S.writeJsonSync(file, { condors: [{ inst: 'NIFTY' }], directional: [{ inst: 'SENSEX' }] }, { backup: true });
  fs.writeFileSync(file, '{"condors":[{"inst":"NIF');
  {
    const e = new AgentsEngine({ enabled: false });
    e._openFile = file; e._openCorrupt = false;
    e._openCondor.clear(); e._open.clear();
    e._loadOpen();
    ok(e._openCorrupt === false && e._openCondor.size === 1,
      'agents-engine: a corrupt open-positions file recovers from .bak — the live condor is not forgotten');
  }

  // unrecoverable
  try { fs.unlinkSync(file + '.bak'); } catch (_) {}
  const poison = '{"condors":[{"inst":"NIF';
  fs.writeFileSync(file, poison);
  const e = new AgentsEngine({ enabled: false });
  e._openFile = file; e._openCorrupt = false;
  e._openCondor.clear(); e._open.clear();
  e._loadOpen();
  ok(e._openCorrupt === true, 'agents-engine: an unrecoverable OPEN-POSITIONS file marks the engine corrupt');
  e._saveOpen();
  ok(fs.readFileSync(file, 'utf8') === poison,
    'agents-engine: and it REFUSES to save — the engine never pretends it is flat while a condor may be live');
}

console.log(`\n${pass} assertions passed`);
