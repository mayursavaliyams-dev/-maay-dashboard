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

// ── gamma-blast-engine ──
{
  const GammaBlastEngine = require('../gamma-blast-engine.js');
  const file = tmp('gamma-blast-trades.json');
  const mk = () => {
    const e = new GammaBlastEngine({ enabled: false });
    e._tradesFile = file;
    e._allTrades = e._loadTrades();
    return e;
  };
  ledgerContract('gamma-blast-engine', mk, file,
    (e) => e._allTrades, (e) => e._saveTrades(), (e) => e._ledgerCorrupt === true);
}

// ════════════════════════════════════════════════════════════════════════════
//  signal-health: the calibration evidence. 41 outcomes exist platform-wide.
//
//  The `fs` argument is an INJECTION SEAM for unit tests. An earlier version of this
//  migration ignored it and called safe-write directly — the suite still passed, while
//  writing `x.json` into the project root. These assertions make that impossible.
// ════════════════════════════════════════════════════════════════════════════
{
  console.log('\n  ── signal-health ──');
  const H = require('../signal-health.js');
  const realFs = require('fs');

  // 1. the injected fake must be honoured; nothing may touch the real disk
  {
    const store = {};
    let realWrites = 0;
    const spyFs = {
      writeFileSync: (p, d) => { store[p] = d; },
      readFileSync: (p) => { if (!(p in store)) throw new Error('nofile'); return store[p]; },
    };
    const tk = H.newTracker({ minSamples: 5 });
    for (let i = 0; i < 10; i++) H.logOutcome(tk, { p: 0.7, win: i % 2 === 0, pnl: i % 2 === 0 ? 100 : -50 });
    ok(H.saveState(tk, spyFs, 'INJECTED-ONLY.json') === true, 'signal-health: saveState honours an injected fs');
    ok(!realFs.existsSync(path.join(__dirname, '..', 'INJECTED-ONLY.json')),
      'signal-health: an injected fs NEVER writes to the real disk (this caught a real bug)');
    const tk2 = H.loadState(spyFs, 'INJECTED-ONLY.json', {});
    ok(tk2.outcomes.length === 10, 'signal-health: round-trips through the injected fs');
    void realWrites;
  }

  // 2. with the real fs: missing ⇒ fresh, corrupt ⇒ NOT fresh
  {
    const p = tmp('sig-health.json');
    const fresh = H.loadState(realFs, p, {});
    ok(fresh.outcomes.length === 0 && fresh.stateCorrupt === false, 'signal-health: a MISSING state file is a fresh start');

    const tk = H.newTracker({ minSamples: 5 });
    for (let i = 0; i < 8; i++) H.logOutcome(tk, { p: 0.6, win: true, pnl: 10 });
    H.saveState(tk, realFs, p);                       // creates the file
    H.saveState(tk, realFs, p);                       // creates the .bak
    fs.writeFileSync(p, '{"outcomes":[{"p":0.6');     // truncate
    const rec = H.loadState(realFs, p, {});
    ok(rec.outcomes.length === 8 && rec.stateCorrupt === false, 'signal-health: a corrupt state file recovers from .bak');

    try { fs.unlinkSync(p + '.bak'); } catch (_) {}
    fs.writeFileSync(p, '{"outcomes":[{"p":0.6');
    const lost = H.loadState(realFs, p, {});
    ok(lost.stateCorrupt === true,
      'signal-health: an unrecoverable state file is flagged, NOT silently treated as "no history"');
    ok(lost.outcomes.length === 0, 'signal-health: …and no fabricated outcomes are invented');
  }
}

// ── database.js (TD-5): the two silent failures are gone ──
{
  console.log('\n  ── database.js (TD-5) ──');
  const SimpleDB = require('../database.js');
  const dir = fs.mkdtempSync(path.join(TMP, 'db-'));
  const db = new SimpleDB(dir);

  ok(JSON.stringify(db.read('absent.json')) === '[]', 'database: a MISSING file yields the fallback');
  db.write('x.json', [{ a: 1 }]);
  ok(db.read('x.json').length === 1, 'database: write → read round-trips');

  fs.writeFileSync(path.join(dir, 'bad.json'), '[{"a":');
  let threw = false;
  try { db.read('bad.json'); } catch (_) { threw = true; }
  ok(threw, 'database: TD-5 — read() on a CORRUPT file now THROWS instead of silently returning []');

  const src = fs.readFileSync(path.join(__dirname, '..', 'database.js'), 'utf8');
  ok(!/return false;/.test(src), 'database: TD-5 — write() no longer swallows the error and returns false');
  ok(/safe-write/.test(src), 'database: writes go through safe-write');
}

// ════════════════════════════════════════════════════════════════════════════
//  C3 remaining writers (2026-07-09 batch)
// ════════════════════════════════════════════════════════════════════════════

// ── pop-seller book (P2): was MEMORY-ONLY — every restart erased all positions ──
{
  console.log('\n  ── pop-seller book (P2) ──');
  const P = require('../pop-seller.js');
  const bookFile = path.join(__dirname, '..', 'data', 'pop-book.json');

  const before = P.getBook().length;
  const r = P.sellPoP({ inst: 'NIFTY', side: 'SELL_CE', strike: 24500, type: 'CE', premium: 40 });
  ok(r.ok === true, 'pop-seller: a paper sell still opens');
  ok(fs.existsSync(bookFile), 'pop-seller (P2): the book NOW PERSISTS to disk — the sixth book finally exists');
  const onDisk = S.readJsonSync(bookFile);
  ok(Array.isArray(onDisk.book) && onDisk.book.length === before + 1,
    'pop-seller: the position is on disk, not just in memory');
  ok(Number.isFinite(onDisk.idSeq) && onDisk.idSeq > 1, 'pop-seller: idSeq persists so ids never collide after restart');
  ok(P.popStatus().bookCorrupt === false, 'pop-seller: popStatus surfaces book health');

  P.closePoP(r.position.id, 10);
  ok(S.readJsonSync(bookFile).book.find((p) => p.id === r.position.id).status === 'CLOSED',
    'pop-seller: the close is persisted too');

  // leave no trace in the real data/ directory
  fs.unlinkSync(bookFile);
  try { fs.unlinkSync(bookFile + '.bak'); } catch (_) {}
}

// ── afternoon-engine: the risk brake must FAIL CLOSED ──
{
  console.log('\n  ── afternoon-engine risk brake ──');
  const src = fs.readFileSync(path.join(__dirname, '..', 'afternoon-engine.js'), 'utf8');
  ok(/EQUITY_STATE_CORRUPT/.test(src) && /autoEnabled = false/.test(src),
    'afternoon-engine: an unrecoverable equity file now HALTS the engine (fail closed)');
  ok(/safe-write/.test(src) && /backup: true/.test(src),
    'afternoon-engine: equity state (capital + consecLosses) is written atomically with a .bak');
  // The old behaviour silently reset consecLosses to 0 — disarming the
  // halt-after-N-losses brake. Pin that it is gone:
  ok(!/catch \(e\) \{ console\.warn\(`\[\$\{this\.instrumentName\}-AFT\] equity restore failed/.test(src),
    'afternoon-engine: the silent restore-failure swallow is gone');
}

// ── confluence-learner: learned weights must never silently reset ──
{
  console.log('\n  ── confluence-learner ──');
  const src = fs.readFileSync(path.join(__dirname, '..', 'confluence-learner.js'), 'utf8');
  ok(/safe-write/.test(src) && /backup: true/.test(src), 'confluence-learner: learned weights write atomically with .bak');
  ok(!/catch \(_\) \{ return d; \}/.test(src),
    'confluence-learner: corrupt weights no longer silently return the fallback (they recover or THROW)');
}

// ════════════════════════════════════════════════════════════════════════════
//  C3-07 — execution-engine (PROTECTED file, owner-approved)
//
//  The IDENTICAL brake-disarm bug afternoon-engine had:
//    restoreEquity() { try { JSON.parse(readFileSync(file)) ... }
//                      catch (e) { console.warn('equity restore failed'); } }
//
//  A corrupt data/equity-<inst>.json was swallowed, leaving `consecLosses` at its
//  default 0 — silently DISARMING the halt-after-N-consecutive-losses brake, exactly
//  when a crash has just happened and the file is most likely to be torn.
//
//  For a risk brake, "state unknown" must mean "brake ON".
// ════════════════════════════════════════════════════════════════════════════
{
  console.log('\n  ── execution-engine risk brake (C3-07) ──');
  const ExecutionEngine = require('../execution-engine.js');
  const eqFile = path.resolve(`./data/equity-c3test.json`);
  const mk = () => new ExecutionEngine({ instrumentName: 'C3TEST', capital: 100000, maxConsecLosses: 3 });
  const clean = () => { for (const p of [eqFile, eqFile + '.bak']) { try { fs.unlinkSync(p); } catch (_) {} } };
  clean();

  // A. missing equity file ⇒ fresh baseline, brake armed but not tripped
  {
    const e = mk();
    e.restoreEquity();
    ok(e._consecLosses === 0 && e._haltedReason == null,
      'execution-engine: a MISSING equity file is a fresh start (not an error)');
  }

  // B. good file ⇒ the loss streak is restored, so the brake knows where it stands
  {
    S.writeJsonSync(eqFile, { capital: 90000, reserve: 5000, consecLosses: 2, updatedAt: new Date().toISOString() });
    const e = mk();
    e.restoreEquity();
    ok(e._consecLosses === 2, 'execution-engine: a good file restores the loss streak (2), not 0');
    ok(e.capital === 90000 && e.reserve === 5000, 'execution-engine: capital and reserve carry forward');
  }

  // C. corrupt WITH a .bak ⇒ recover the streak, keep trading
  {
    S.writeJsonSync(eqFile, { capital: 90000, reserve: 5000, consecLosses: 2, updatedAt: new Date().toISOString() }, { backup: true });
    fs.writeFileSync(eqFile, '{"capital":90000,"consecL');
    const e = mk();
    e.restoreEquity();
    ok(e._consecLosses === 2 && e._haltedReason == null,
      'execution-engine: a corrupt equity file recovers from .bak — the loss streak is not forgotten');
  }

  // D. THE ONE THAT MATTERS — corrupt with NO .bak ⇒ HALT, never assume zero losses
  {
    clean();
    const poison = '{"capital":90000,"consecL';
    fs.writeFileSync(eqFile, poison);
    const e = mk();
    e.restoreEquity();
    ok(e._haltedReason === 'EQUITY_STATE_CORRUPT',
      'execution-engine (C3-07): an unrecoverable equity file HALTS the engine');
    ok(e.autoEnabled === false,
      'execution-engine (C3-07): auto-trading is DISABLED — the brake fails CLOSED, not open');
    ok(e._consecLosses === 0,
      'execution-engine (C3-07): consecLosses stays 0 in memory — but the halt, not the counter, is what stops trading');
    ok(fs.readFileSync(eqFile, 'utf8') === poison,
      'execution-engine (C3-07): the corrupt bytes survive for forensics — nothing is overwritten');
  }

  // E. persistence is atomic + backed up
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'execution-engine.js'), 'utf8');
    ok(/safe-write/.test(src) && /backup: true/.test(src),
      'execution-engine: equity state is written atomically with a .bak (it is risk state, not a cache)');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/)
      .map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    ok(!/_fs\.writeFileSync/.test(code), 'execution-engine: no raw writeFileSync survives in executable code');
    ok(!/catch \(e\) \{ console\.warn\(`\[\$\{this\.instrumentName\}\] equity restore failed/.test(src),
      'execution-engine: the silent restore-failure swallow is gone');
  }

  clean();
}

// ── the sweep: NO production ledger writer bypasses safe-write any more ──
{
  console.log('\n  ── final sweep ──');
  const MIGRATED = ['strangle-engine.js', 'agents-engine.js', 'gamma-blast-engine.js',
    'forward-test-logger.js', 'signal-health.js', 'database.js', 'pop-seller.js',
    'ai-logger.js', 'confirmed-signals.js', 'confluence-learner.js', 'event-engine.js',
    'afternoon-engine.js', 'crash-analyzer.js', 'pine-converter.js'];
  const offenders = [];
  for (const f of MIGRATED) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    // strip comments before scanning (migration notes quote the old code verbatim)
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/)
      .map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\s+\/\/.*$/, '')).join('\n');
    if (/fs\.writeFileSync|_fs\.writeFileSync/.test(code)) offenders.push(f);
    if (!/safe-write/.test(src)) offenders.push(f + ' (no safe-write import)');
  }
  // signal-health legitimately keeps ONE writeFileSync: the injected-fake branch.
  const real = offenders.filter((f) => f !== 'signal-health.js');
  ok(real.length === 0,
    `every migrated writer goes through safe-write${real.length ? ' — OFFENDERS: ' + real.join(', ') : ''}`);
}

console.log(`\n${pass} assertions passed`);
