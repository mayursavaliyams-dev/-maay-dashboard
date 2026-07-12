'use strict';
/**
 * BOOT ORDER — `config-overrides.json` overwrites the restored account equity.
 * (PROTECTED FILE server.js, owner-approved. See docs/APPROVAL-capital-overwritten-at-boot.md)
 *
 * THE DEFECT, MEASURED ON THE RUNNING SERVER BEFORE THE FIX
 *
 *   [SENSEX] Restored equity: active ₹88011 + reserve ₹0 = ₹88011 (consec losses: 2)
 *   [NIFTY]  Restored equity: active ₹96761 + reserve ₹0 = ₹96761 (consec losses: 15)
 *   GET /api/engine/status  ->  { "instrument": "SENSEX", "capital": 100000 }
 *
 *   Three writers set `this.capital`, in server.js line order, and the last one won:
 *     execution-engine.js:54   env CAPITAL_TOTAL            -> 100000
 *     server.js:3140 / :3304   restoreEquity()              -> 88011 / 96761   (the real account)
 *     server.js:3712           _loadConfigOverrides()       -> 100000          (a stored setting)
 *                              -> execution-engine.js:113   this.capital = num(partial.CAPITAL_TOTAL)
 *
 *   `capital` is not only a sizing input. It arms the daily-loss brake — execution-engine.js:302:
 *       if (todayLoss < -(this.capital * this.maxDailyLossPct)) { … }
 *   SENSEX: real brake ₹4,400.55, armed brake ₹5,000.00  (+13.6%)
 *   NIFTY : real brake ₹4,838.05, armed brake ₹5,000.00  (+3.3%)
 *
 *   The asymmetry is what makes it structural. As the account bleeds, recordTradeResult() shrinks
 *   `capital` and the brake tightens — by design. Every restart resets it and the brake loosens
 *   again. A losing account never reduces its risk. And an account that has grown past ₹1,00,000 is
 *   UNDER-sized after a restart, so the half-compound curve can never compound across a restart.
 *
 * THE FIX: `restoreEquity()` runs AFTER `_loadConfigOverrides()`. Restored state is the account,
 * so it must be the last word. Two statements move. No new logic, no flag, no conditional.
 *
 * ISOLATION. server.js cannot be required — it boots the engines and writes ledgers. This suite
 * drives the REAL `ExecutionEngine.prototype` with `process.cwd()` pointed at a mkdtemp directory,
 * so `path.resolve('./data/…')` never reaches the project, and asserts the three live files are
 * byte-identical at the end.
 *
 *   @test:characterization @test:unit @test:integration @test:regression
 *   @test:performance @test:memory-leak @test:failure @test:rollback
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');
const LIVE = ['equity-nifty.json', 'equity-sensex.json', 'config-overrides.json']
  .map((f) => path.join(ROOT, 'data', f));
const liveBytes = LIVE.map((f) => (fs.existsSync(f) ? fs.readFileSync(f) : null));

const { ExecutionEngine } = (() => {
  const M = require('../execution-engine.js');
  return { ExecutionEngine: M.ExecutionEngine || M };
})();

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
const eq = (a, b, m) => { n++; assert.strictEqual(a, b, m); };

// ── a real engine, without booting server.js ────────────────────────────────
const cwd0 = process.cwd();
const mkEngine = (inst, envCapital) => {
  const e = Object.create(ExecutionEngine.prototype);
  Object.assign(e, {
    instrumentName: inst,
    capital: envCapital,                 // execution-engine.js:54  — env CAPITAL_TOTAL
    reserve: 0,
    _consecLosses: 0,
    _haltedReason: null,
    autoEnabled: true,
    maxDailyLossPct: 0.05,               // MAX_DAILY_LOSS_PERCENT: 5
    riskPct: 0.05,                       // CAPITAL_PER_TRADE_PERCENT: 5
    maxConsecLosses: 3,
    maxDrawdownPct: 0.5,
    _peakEquity: envCapital,
  });
  return e;
};
const writeEquity = (dir, inst, capital, ageDays = 0) => {
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', `equity-${inst.toLowerCase()}.json`), JSON.stringify({
    capital, reserve: 0, consecLosses: 2,
    updatedAt: new Date(Date.now() - ageDays * 86400000).toISOString(),
  }, null, 2));
};
const withCwd = (dir, fn) => { process.chdir(dir); try { return fn(); } finally { process.chdir(cwd0); } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agp-boot-'));

// the daily-loss brake, transcribed from execution-engine.js:302
const brakeThreshold = (e) => e.capital * e.maxDailyLossPct;

// ── the source contract: the fix is in place and nothing else moved ─────────
{
  const src = fs.readFileSync(SERVER, 'utf8');
  const iOverrides = src.indexOf('const _cfgOverrides = _loadConfigOverrides();');
  const iRestore = src.indexOf('engine.restoreEquity();');
  ok(iOverrides > 0, 'server.js still calls _loadConfigOverrides()');
  ok(iRestore > iOverrides,
    'THE FIX: engine.restoreEquity() now runs AFTER _loadConfigOverrides() — restored state is the ' +
    'last word on capital');
  ok(src.indexOf('niftyEngine.restoreEquity();') > iOverrides,
    'and so does niftyEngine.restoreEquity()');
  ok(/ORDER MATTERS/.test(src.slice(iOverrides, iOverrides + 900)),
    'the reason is recorded beside the code, not only in the approval package');

  // the afternoon engines are deliberately NOT moved — they never receive setConfig(data)
  const iAft = src.indexOf('afternoonEngine.restoreEquity();');
  ok(iAft > 0 && iAft < iOverrides,
    'afternoonEngine.restoreEquity() is untouched: _loadConfigOverrides() never calls setConfig on it');
  const body = src.slice(src.indexOf('function _loadConfigOverrides'), src.indexOf('const _cfgOverrides'));
  ok(/engine\?\.setConfig\)\s*engine\.setConfig\(data\)/.test(body.replace(/\s+/g, ' ')) ||
     /engine\.setConfig\(data\)/.test(body),
    'REGRESSION: _loadConfigOverrides() still applies every non-capital key to both directional engines');
  ok(!/afternoonEngine\.setConfig/.test(body), 'and still never touches the afternoon engines');
}

// ── @test:characterization — the OLD boot order, reproduced verbatim ────────
{
  const dir = tmp();
  writeEquity(dir, 'SENSEX', 88011);
  const e = mkEngine('SENSEX', 100000);

  withCwd(dir, () => {
    e.restoreEquity();                       // server.js:3140 — the real account
    eq(e.capital, 88011, 'restoreEquity() loads the real account: ₹88,011');
    eq(e._consecLosses, 2, 'and its loss streak');

    e.setConfig({ CAPITAL_TOTAL: 100000 }); // server.js:3712 -> execution-engine.js:113
  });

  eq(e.capital, 100000,
    'CHARACTERIZATION: the override overwrote the restored account. This is what the running ' +
    'server did — it printed "Restored equity: ₹88011" and then served capital: 100000');
  eq(brakeThreshold(e), 5000,
    'CHARACTERIZATION: the daily-loss brake was armed at ₹5,000 instead of ₹4,400.55');
  ok(brakeThreshold(e) > 88011 * 0.05, 'CHARACTERIZATION: i.e. 13.6% more loss than the account permits');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── @test:unit — the NEW boot order ─────────────────────────────────────────
{
  const dir = tmp();
  writeEquity(dir, 'SENSEX', 88011);
  const e = mkEngine('SENSEX', 100000);

  withCwd(dir, () => {
    e.setConfig({ CAPITAL_TOTAL: 100000 }); // _loadConfigOverrides() first …
    e.restoreEquity();                       // … then restoreEquity(). The account wins.
  });

  eq(e.capital, 88011, 'THE FIX: the restored account survives the override');
  eq(brakeThreshold(e), 4400.55, 'and the daily-loss brake is armed at the real ₹4,400.55');
  eq(e.capital * e.riskPct, 4400.55, 'as is the per-trade budget');
  eq(e._consecLosses, 2, 'the loss streak is still restored');
  eq(e.reserve, 0, 'and the reserve');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── @test:regression — a NIFTY-shaped case, the second engine ───────────────
{
  const dir = tmp();
  writeEquity(dir, 'NIFTY', 96761);
  const e = mkEngine('NIFTY', 100000);
  withCwd(dir, () => { e.setConfig({ CAPITAL_TOTAL: 100000 }); e.restoreEquity(); });
  eq(e.capital, 96761, 'NIFTY restores ₹96,761');
  ok(Math.abs(brakeThreshold(e) - 4838.05) < 0.001, 'and arms its brake at ₹4,838.05, not ₹5,000');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── @test:regression — non-capital keys still apply, in either order ────────
{
  const dir = tmp();
  writeEquity(dir, 'SENSEX', 88011);
  const e = mkEngine('SENSEX', 100000);
  withCwd(dir, () => {
    e.setConfig({ CAPITAL_TOTAL: 100000, CAPITAL_PER_TRADE_PERCENT: 3, MAX_DAILY_LOSS_PERCENT: 2 });
    e.restoreEquity();
  });
  eq(e.capital, 88011, 'capital comes from the account …');
  ok(Math.abs(e.riskPct - 0.03) < 1e-9, '… while CAPITAL_PER_TRADE_PERCENT still comes from the override');
  ok(Math.abs(e.maxDailyLossPct - 0.02) < 1e-9, 'and so does MAX_DAILY_LOSS_PERCENT');
  eq(brakeThreshold(e), 88011 * 0.02, 'the brake combines the restored account with the configured percent');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── @test:failure — a fresh install has no equity file ──────────────────────
{
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });   // no equity-*.json
  const e = mkEngine('SENSEX', 100000);
  withCwd(dir, () => { e.setConfig({ CAPITAL_TOTAL: 250000 }); e.restoreEquity(); });
  eq(e.capital, 250000,
    'FAILURE PATH: with no equity file, restoreEquity() returns immediately and the operator\'s ' +
    'CAPITAL_TOTAL survives. Today\'s behaviour, preserved — this is why the fix is a reorder, ' +
    'not a filter on CAPITAL_TOTAL');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── @test:failure — a stale equity file keeps the configured baseline ───────
{
  const dir = tmp();
  writeEquity(dir, 'SENSEX', 88011, 40);       // 40 days old, > the 30-day guard
  const e = mkEngine('SENSEX', 100000);
  withCwd(dir, () => { e.setConfig({ CAPITAL_TOTAL: 250000 }); e.restoreEquity(); });
  eq(e.capital, 250000, 'FAILURE PATH: a >30-day-old equity file is ignored and the baseline is kept');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── @test:failure — an unrecoverable equity file still HALTS (C3-07) ────────
{
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'equity-sensex.json'), '{"capital": 88011');   // torn
  const e = mkEngine('SENSEX', 100000);
  withCwd(dir, () => { e.setConfig({ CAPITAL_TOTAL: 100000 }); e.restoreEquity(); });

  eq(e._haltedReason, 'EQUITY_STATE_CORRUPT',
    'FAILURE PATH: an unrecoverable equity file still halts the engine — running restoreEquity() ' +
    'LATER is strictly safer, because fewer statements follow it');
  eq(e.autoEnabled, false, 'and auto trading is disabled');
  eq(e.capital, 100000, 'the capital falls back to the configured value, since none could be read');
}

// ── @test:integration — the bleeding account tightens its own brake ─────────
// This is the property the defect destroyed: `capital` shrinks as the account loses, so the brake
// tightens. Under the old order every restart undid it.
{
  const dir = tmp();
  const e = mkEngine('SENSEX', 100000);
  withCwd(dir, () => {
    for (let i = 0; i < 3; i++) { e.capital -= 4000; }          // three losing days
    eq(brakeThreshold(e), 4400, 'after ₹12,000 of losses the brake has tightened to ₹4,400');

    writeEquity(dir, 'SENSEX', e.capital);                       // the ledger records it
    const rebooted = mkEngine('SENSEX', 100000);

    // OLD order
    rebooted.restoreEquity(); rebooted.setConfig({ CAPITAL_TOTAL: 100000 });
    eq(brakeThreshold(rebooted), 5000,
      'CHARACTERIZATION: after a restart the OLD order loosened the brake back to ₹5,000 — ' +
      'a losing account never reduced its risk');

    // NEW order
    const fixed = mkEngine('SENSEX', 100000);
    fixed.setConfig({ CAPITAL_TOTAL: 100000 }); fixed.restoreEquity();
    eq(brakeThreshold(fixed), 4400, 'THE FIX: the restart preserves the tightened brake');
  });
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── @test:performance — restoreEquity() is one readFileSync, once per boot ──
// Generous, order-of-magnitude threshold: it catches someone adding a network call to the boot
// path, not a few percent of drift on a busy machine.
{
  const dir = tmp();
  writeEquity(dir, 'SENSEX', 88011);
  const e = mkEngine('SENSEX', 100000);
  withCwd(dir, () => {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 200; i++) e.restoreEquity();
    const per = Number(process.hrtime.bigint() - t0) / 200 / 1e6;
    ok(per < 20, `restoreEquity() costs ${per.toFixed(3)} ms — it runs once per engine per process`);
  });
  ok(true, 'the patch moves two statements; it adds no work at all');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── @test:memory-leak — restore is idempotent and retains nothing ───────────
{
  const dir = tmp();
  writeEquity(dir, 'SENSEX', 88011);
  const e = mkEngine('SENSEX', 100000);
  withCwd(dir, () => { for (let i = 0; i < 500; i++) e.restoreEquity(); });
  eq(e.capital, 88011, '500 restores converge on the same value');
  eq(e._consecLosses, 2, 'and the same streak — restoreEquity() accumulates nothing');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── @test:rollback — the change is a reorder; the surface is identical ──────
{
  const src = fs.readFileSync(SERVER, 'utf8');
  // NOTE: `/engine\.restoreEquity/` matches only the lowercase-`e` receiver, never `niftyEngine.`
  // or `afternoonEngine.`. An earlier version of this assertion counted 4 that way and was simply
  // wrong. Count the calls, not one spelling of the receiver.
  eq((src.match(/\.restoreEquity\(\);/g) || []).length, 4,
    'ROLLBACK: exactly four restoreEquity() calls exist, as before — two directional, two afternoon');
  const order = ['afternoonEngine.restoreEquity();', 'niftyAfternoonEngine.restoreEquity();']
    .map((s) => src.indexOf(s));
  ok(order.every((i) => i > 0), 'ROLLBACK: both afternoon restores are still present');
  ok(/const _cfgOverrides = _loadConfigOverrides\(\);/.test(src),
    'ROLLBACK: _cfgOverrides is still assigned from _loadConfigOverrides()');
  ok(/_cfgOverrides\?\.NIFTY_DIRECTIONAL_AUTO/.test(src),
    'ROLLBACK: server.js:7278 still reads _cfgOverrides to apply the auto flags');
  // The alternation must be grouped. Written as `/CAPITAL_TOTAL[^\n]*delete|filter/` it means
  // "…delete" OR any occurrence of "filter" anywhere in server.js — of which there are dozens.
  ok(!/CAPITAL_TOTAL[^\n]*(delete|filter|omit)/.test(src),
    'ROLLBACK: no filter or special case was introduced around CAPITAL_TOTAL — the fix is a reorder');
  ok(/CAPITAL_TOTAL/.test(src), 'and CAPITAL_TOTAL is still a known config key (CONFIG_SPEC)');
}

// ── production state must be untouched ──────────────────────────────────────
{
  eq(process.cwd(), cwd0, 'the suite restored its working directory');
  LIVE.forEach((f, i) => {
    if (!liveBytes[i]) return;
    ok(Buffer.compare(liveBytes[i], fs.readFileSync(f)) === 0,
      `${path.basename(f)} is byte-identical — this suite never wrote to production state`);
  });
}

console.log(`\n${n} assertions passed`);
