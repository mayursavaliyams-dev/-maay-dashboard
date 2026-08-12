/**
 * connector-select — Session 2, Block 1. Run: node test/connector-select.test.js
 *
 * @test:unit @test:security @test:failure @test:boundary @test:regression
 *
 * THE CLAIM
 *
 * "There is no configuration in which a missing or unusable credential results
 *  in a DIFFERENT connector being selected."
 *
 * The regression this protects against is measured, not hypothetical. Under the
 * previous AUTO selection (docs/078 §2), an Upstox token shortened to 30
 * characters produced a Dhan connector whose placeOrder is implemented. The
 * system did not stop when its credential broke; it gained the ability to trade.
 *
 * Every case below that ends in a throw is a case that previously ended in a
 * substitution.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };
const ROOT = path.join(__dirname, '..');
const { selectConnector, orderCapability, KNOWN } = require(path.join(ROOT, 'connector-select.js'));

const code = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/* Stand-ins whose only job is to be distinguishable. `dhan` is given a working
   placeOrder and `upstox` a throwing one, mirroring the real modules — because
   the failure being tested is a swap BETWEEN those two capabilities. */
class FakeUpstox { constructor(o) { this.opts = o; } async placeOrder() { throw new Error('Upstox placeOrder not implemented — paper mode only'); } }
class FakeKotak { constructor(o) { this.opts = o; } async placeOrder() { return { orderId: 'K1' }; } }
class FakeDhan { constructor(o) { this.opts = o; } async placeOrder() { return { orderId: 'D1' }; } }
const CLASSES = { upstox: FakeUpstox, kotak: FakeKotak, dhan: FakeDhan };

const GOOD_UPSTOX = 'u'.repeat(120);
const fullEnv = (over = {}) => ({
  LIVE_CONNECTOR: 'upstox',
  UPSTOX_ACCESS_TOKEN: GOOD_UPSTOX,
  KOTAK_CONSUMER_KEY: 'a-real-kotak-key',
  DHAN_CLIENT_ID: '1100000000',
  DHAN_ACCESS_TOKEN: 'dhan-token',
  ...over,
});
const attempt = (env) => { try { return { ok: true, r: selectConnector(env, CLASSES) }; } catch (e) { return { ok: false, code: e.code, msg: e.message }; } };

console.log('\nconnector-select\n');

/* ── 1 · the happy paths, so a failure below is attributable ─────────────── */
console.log('1 · an explicitly named connector with usable credentials');
for (const name of KNOWN) {
  const a = attempt(fullEnv({ LIVE_CONNECTOR: name }));
  ok(a.ok && a.r.name === name, `LIVE_CONNECTOR=${name} → ${name}`);
}
{
  const a = attempt(fullEnv({ LIVE_CONNECTOR: '  UPSTOX  ' }));
  ok(a.ok && a.r.name === 'upstox', 'the name is trimmed and case-folded');
  ok(a.r.connector.opts.accessToken === GOOD_UPSTOX, 'and the credential is passed through to the connector');
}

/* ── 2 · THE REGRESSION: a broken credential never becomes another connector ── */
console.log('\n2 · a broken credential is a REFUSAL, never a substitution');
{
  // The exact case measured on 2026-07-31: AUTO gave Dhan (live-capable).
  const shortened = attempt(fullEnv({ UPSTOX_ACCESS_TOKEN: GOOD_UPSTOX.slice(0, 30) }));
  ok(!shortened.ok && shortened.code === 'CONNECTOR_CREDENTIALS',
    'an Upstox token shortened to 30 chars now THROWS [under AUTO this returned a live-capable Dhan connector]');
  ok(/only 30 characters/.test(shortened.msg), 'and the message names the actual length observed');
  ok(/will NOT fall back/.test(shortened.msg), 'and states explicitly that nothing is substituted');

  const cleared = attempt(fullEnv({ UPSTOX_ACCESS_TOKEN: '' }));
  ok(!cleared.ok && cleared.code === 'CONNECTOR_CREDENTIALS', 'a cleared token throws');
  ok(/not set/.test(cleared.msg), 'and says so plainly');

  const absent = fullEnv(); delete absent.UPSTOX_ACCESS_TOKEN;
  ok(attempt(absent).code === 'CONNECTOR_CREDENTIALS', 'an absent token throws');

  // Every direction, not just the measured one.
  ok(attempt(fullEnv({ LIVE_CONNECTOR: 'dhan', DHAN_ACCESS_TOKEN: '' })).code === 'CONNECTOR_CREDENTIALS',
    'a broken Dhan credential does not fall back to Upstox either — the rule is symmetric');
  ok(attempt(fullEnv({ LIVE_CONNECTOR: 'kotak', KOTAK_CONSUMER_KEY: 'your_consumer_key_here' })).code === 'CONNECTOR_CREDENTIALS',
    'the .env.example placeholder is recognised as unusable rather than accepted as a value');

  const dhanBoth = attempt(fullEnv({ LIVE_CONNECTOR: 'dhan', DHAN_CLIENT_ID: '', DHAN_ACCESS_TOKEN: '' }));
  ok(dhanBoth.missing === undefined && /DHAN_CLIENT_ID/.test(dhanBoth.msg) && /DHAN_ACCESS_TOKEN/.test(dhanBoth.msg),
    'when several credentials are missing, ALL of them are named — not just the first');
}

/* ── 3 · no default, and no inference ────────────────────────────────────── */
console.log('\n3 · the connector must be declared');
{
  const unset = fullEnv(); delete unset.LIVE_CONNECTOR;
  const a = attempt(unset);
  ok(!a.ok && a.code === 'CONNECTOR_NOT_DECLARED',
    'LIVE_CONNECTOR unset is a startup failure [previously defaulted to "auto"]');
  ok(/deliberately no default/.test(a.msg), 'and the message says the absence of a default is deliberate');

  ok(attempt(fullEnv({ LIVE_CONNECTOR: '' })).code === 'CONNECTOR_NOT_DECLARED', 'empty string is not a declaration');
  ok(attempt(fullEnv({ LIVE_CONNECTOR: '   ' })).code === 'CONNECTOR_NOT_DECLARED', 'whitespace is not a declaration');

  const auto = attempt(fullEnv({ LIVE_CONNECTOR: 'auto' }));
  ok(!auto.ok && auto.code === 'CONNECTOR_UNKNOWN',
    '"auto" is no longer a valid value — an old .env fails loudly rather than behaving as before');
  ok(attempt(fullEnv({ LIVE_CONNECTOR: 'zerodha' })).code === 'CONNECTOR_UNKNOWN', 'an unknown name throws rather than falling through');
}

/* ── 4 · capability is reported, not inferred ────────────────────────────── */
console.log('\n4 · order capability is stated at startup');
{
  ok(orderCapability(new FakeUpstox({})) === 'refuses', 'a connector whose placeOrder throws reports "refuses"');
  ok(orderCapability(new FakeDhan({})) === 'live-capable', 'a connector that can place an order reports "live-capable"');
  ok(orderCapability({}) === 'none', 'an object with no placeOrder reports "none" — not silently "refuses"');

  /* REGRESSION 2026-07-31. The risk guard replaces the connector's placeOrder
     with a thrower. Asked AFTER that, orderCapability() was inspecting the
     guard's stub and answered "live-capable" for a connector that refuses —
     which is the same lie the status endpoint was being fixed to remove, in a
     new shape. The real Upstox connector is wrapped by the real guard here;
     nothing is simulated. */
  const riskConfig = require(path.join(ROOT, 'risk-config.js'));
  const { RiskManager } = require(path.join(ROOT, 'risk-manager.js'));
  const { RiskGuardedBroker } = require(path.join(ROOT, 'risk-guard.js'));
  const UpstoxConnector = require(path.join(ROOT, 'upstox-connector.js'));
  const quiet = { warn() {}, error() {}, log() {} };

  const real = new UpstoxConnector({ accessToken: 'x'.repeat(120) });
  ok(orderCapability(real) === 'refuses', 'the real Upstox connector, unwrapped, reports "refuses"');

  new RiskGuardedBroker(real, { riskManager: new RiskManager({ cfg: riskConfig.get, log: quiet }), log: quiet });
  ok(typeof real.placeOrder === 'function',
    'after wrapping, the connector still HAS a placeOrder — which is why `typeof x === "function"` was never an answer');
  ok(orderCapability(real) === 'neutralised',
    'and orderCapability now reports "neutralised" rather than "live-capable" [regression: it said live-capable]');
  ok(orderCapability(real) !== 'refuses',
    'it does not claim "refuses" either — the guard, not this function, is the authority once wrapped');
}

/* ── 5 · the old selection is gone from server.js ────────────────────────── */
console.log('\n5 · the AUTO block no longer exists');
{
  const srv = code('server.js');
  ok(!/upstoxTok\.length > 40/.test(srv),
    'server.js no longer branches on token LENGTH to choose a connector [regression: it did until 2026-07-31]');
  ok(!/AUTO — Dhan connector selected/.test(srv), 'the AUTO fall-through log line is gone with it');
  ok(!/process\.env\.LIVE_CONNECTOR \|\| 'auto'/.test(srv), "and so is the || 'auto' default");
  ok(/selectConnector\(/.test(srv), 'server.js uses connector-select instead');
}

console.log(`\n${n} assertions passed`);
