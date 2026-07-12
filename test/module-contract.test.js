'use strict';
/**
 * The API Rule, made executable.
 *
 * The assertion that matters most is §3: `/config` is a credential-exfiltration route unless
 * redaction is proven. This repo's `.env` holds DHAN_ACCESS_TOKEN, UPSTOX_ACCESS_TOKEN,
 * ANTHROPIC_API_KEY and AUTH_SECRET. Redaction is tested with the real key names.
 */
/**
 * TESTING RULE coverage. `module-contract` is a NEW module — no prior behaviour to pin, so no
 * characterization test; it becomes mandatory the moment anyone changes this file.
 *   @test:unit @test:integration @test:regression @test:performance
 *   @test:memory-leak @test:failure @test:rollback
 */
const assert = require('assert');
const M = require('../module-contract.js');
const { HEALTH } = M;

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
const eq = (a, b, m) => { n++; assert.strictEqual(a, b, m); };
const dee = (a, b, m) => { n++; assert.deepStrictEqual(a, b, m); };

const CLOCK = () => '2026-07-09T00:00:00.000Z';   // injected: nothing here reads the wall clock

// ── 1. health: no evidence is NOT health ─────────────────────────────────────
{
  M._reset();
  const m = M.defineModule({ name: 'silent', version: '1.0.0', clock: CLOCK });
  const h = m.health();
  eq(h.status, HEALTH.UNKNOWN, 'a module with no checks is UNKNOWN, never ok — silence is not health');
  eq(h.healthScore, null, 'and its health score is null, NEVER 0 and never 1');

  M._reset();
  const sick = M.defineModule({
    name: 'sick', version: '1.0.0', clock: CLOCK,
    checks: () => { throw new Error('db exploded'); },
  });
  const hs = sick.health();
  eq(hs.status, HEALTH.DOWN, 'a health check that throws reports DOWN, it does not crash the endpoint');
  ok(/db exploded/.test(hs.checks[0].detail), 'and the reason survives');
  eq(hs.healthScore, 0, 'a MEASURED total failure scores 0 — which is not the same as null');
}

// ── 2. rollup precedence: UNKNOWN outranks DEGRADED ──────────────────────────
{
  const c = (status) => ({ name: 'x', status });
  eq(M.rollup([]), HEALTH.UNKNOWN, 'no checks ⇒ unknown');
  eq(M.rollup([c(HEALTH.OK), c(HEALTH.OK)]), HEALTH.OK, 'all ok ⇒ ok');
  eq(M.rollup([c(HEALTH.OK), c(HEALTH.DEGRADED)]), HEALTH.DEGRADED, 'any degraded ⇒ degraded');
  eq(M.rollup([c(HEALTH.DEGRADED), c(HEALTH.UNKNOWN)]), HEALTH.UNKNOWN,
    'UNKNOWN outranks DEGRADED: "I cannot tell" is a stronger reason to withhold trust than ' +
    '"it is working badly but I can see it"');
  eq(M.rollup([c(HEALTH.UNKNOWN), c(HEALTH.DOWN)]), HEALTH.DOWN, 'DOWN outranks everything');

  // an unknown check DILUTES the score rather than being quietly excluded
  eq(M.healthScore([c(HEALTH.OK)]), 1, 'one ok check ⇒ 1');
  eq(M.healthScore([c(HEALTH.OK), c(HEALTH.UNKNOWN)]), 0.5,
    'one ok + one unknown ⇒ 0.5, not 1. Pretending 1-of-10-known is 100% healthy is the exact ' +
    'failure this rule exists to prevent');
  eq(M.healthScore([c(HEALTH.UNKNOWN), c(HEALTH.UNKNOWN)]), null, 'all unknown ⇒ null, not 0');
  eq(M.healthScore([c(HEALTH.OK), c(HEALTH.DEGRADED)]), 0.75, '(1 + 0.5) / 2 — degraded counts half');
  eq(M.healthScore([c(HEALTH.DOWN)]), 0, 'a measured down ⇒ 0');
}

// ── 3. CONFIG IS A PUBLICATION SURFACE. Prove the secrets do not leak. ───────
{
  // the real key names from this repo's .env.example
  const real = {
    DHAN_ACCESS_TOKEN: 'eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop.signature',
    UPSTOX_ACCESS_TOKEN: 'live-token-aaaaaaaaaaaaaaaaaaaaaaaaaa',
    ANTHROPIC_API_KEY: 'sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    AUTH_SECRET: 'super-secret-signing-key-0123456789',
    TELEGRAM_BOT_TOKEN: '123456:AAH-xxxxxxxxxxxxxxxxxxxxxxxxx',
    KOTAK_CONSUMER_KEY: 'ck_live_xxxxxxxxxxxxxxxxxxxxxxxxxxx',
    AUTH_TOKEN_TTL_HOURS: 12,
    STRANGLE_CAPITAL: 700000,
    AUTH_ENABLED: false,
    MODE: 'paper',
  };
  const r = M.redactConfig(real);
  for (const k of ['DHAN_ACCESS_TOKEN', 'UPSTOX_ACCESS_TOKEN', 'ANTHROPIC_API_KEY', 'AUTH_SECRET',
    'TELEGRAM_BOT_TOKEN', 'KOTAK_CONSUMER_KEY']) {
    eq(r[k], '[REDACTED]', `${k} is redacted — /config must never become an exfiltration route`);
  }
  // AUTH_TOKEN_TTL_HOURS is a harmless integer, and it is redacted anyway because its name
  // matches /auth|token/. That is the design, not a bug: deny-by-default may OVER-redact; it
  // may never UNDER-redact. Losing a TTL from a config view costs nothing. Leaking
  // UPSTOX_ACCESS_TOKEN costs the account.
  eq(r.AUTH_TOKEN_TTL_HOURS, '[REDACTED]',
    'deny-by-default over-redacts an innocent name rather than risk the day someone adds BROKER_TOKEN_2');
  eq(r.STRANGLE_CAPITAL, 700000, 'an innocent number survives');
  eq(r.MODE, 'paper', 'an innocent short string survives');
  eq(r.AUTH_ENABLED, '[REDACTED]', 'a name containing "auth" is redacted even when the value is a boolean');

  // a credential under an innocent key name
  const sneaky = M.redactConfig({ note: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  eq(sneaky.note, '[REDACTED]', 'a long opaque string is redacted even under an innocent key');
  eq(M.redactConfig({ note: 'paper' }).note, 'paper', 'a short one is not');

  // nested and array
  eq(M.redactConfig({ broker: { DHAN_ACCESS_TOKEN: 'x' } }).broker.DHAN_ACCESS_TOKEN, '[REDACTED]',
    'nested secrets are redacted too');
  eq(M.redactConfig({ list: ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaa'] }).list[0], '[REDACTED]',
    'and secrets hidden inside arrays');
  eq(M.redactConfig({ fn: () => {} }).fn, '[REDACTED]', 'anything unexpected is redacted, not serialised');

  // redaction must not mutate the caller's object
  const orig = { DHAN_ACCESS_TOKEN: 'real' };
  M.redactConfig(orig);
  eq(orig.DHAN_ACCESS_TOKEN, 'real', 'redactConfig never mutates its input');
}

// ── 4. structured logging — and log lines are a publication surface too ──────
{
  const lines = [];
  const log = M.createLogger('t', { write: (l) => lines.push(l), clock: CLOCK, level: 'info' });
  log.debug('hidden');
  eq(lines.length, 0, 'below-threshold levels are not emitted');
  log.info('trade closed', { inst: 'NIFTY', pnl: 1950 });
  const rec = JSON.parse(lines[0]);
  eq(rec.level, 'info'); eq(rec.module, 't'); eq(rec.msg, 'trade closed');
  eq(rec.inst, 'NIFTY'); eq(rec.pnl, 1950);
  eq(rec.ts, CLOCK(), 'the clock is injected — no flaky timestamps');
  n += 3;

  log.error('auth failed', { DHAN_ACCESS_TOKEN: 'leaked?' });
  eq(JSON.parse(lines[1]).DHAN_ACCESS_TOKEN, '[REDACTED]',
    'a secret passed into a log field is redacted — logs are shipped, indexed and cached');
  ok(lines.every((l) => { JSON.parse(l); return !l.includes('\n'); }),
    'every line is exactly one valid JSON object');
}

// ── 5. metrics: an absent counter is not a zero counter ─────────────────────
{
  M._reset();
  const m = M.defineModule({
    name: 'metered', version: '2.0.0', clock: CLOCK,
    metrics: () => ({ trades_total: 41, win_rate: 0.89, broken: NaN, alsoBroken: Infinity, notANumber: 'x' }),
  });
  const met = m.metrics();
  eq(met.trades_total, 41); eq(met.win_rate, 0.89); n += 2;
  ok(!('broken' in met) && !('alsoBroken' in met) && !('notANumber' in met),
    'NaN, Infinity and non-numbers are OMITTED, never rendered as 0 — an absent counter and a zero ' +
    'counter mean different things');
  const text = m.metricsText();
  ok(/^metered_trades_total 41$/m.test(text), 'Prometheus exposition uses the module prefix');
  ok(!/NaN|Infinity/.test(text), 'and never emits NaN into a time-series database');

  M._reset();
  const boom = M.defineModule({ name: 'b', version: '1.0.0', metrics: () => { throw new Error('x'); }, clock: CLOCK });
  ok(boom.metrics()._error === 'x', 'a throwing metrics() reports the error instead of crashing');
}

// ── 6. WebSocket: declared, NOT pretended ────────────────────────────────────
{
  M._reset();
  const m = M.defineModule({
    name: 'streamer', version: '1.0.0', clock: CLOCK,
    channels: [{ name: 'ticks', description: 'per-strike LTP' }],
  });
  const ws = m.wsChannel();
  eq(ws.attached, false,
    'THE HONEST ASSERTION: no WebSocket server exists in this repo, so the module says so. ' +
    'A surface that reports itself present while silently never firing is worse than an absent one');
  ok(/no WebSocket server exists/.test(ws.reason), 'and it explains why, with the evidence');
  eq(ws.channels[0].topic, 'streamer.ticks', 'the channel contract is still fully specified');
  dee(Object.keys(ws.envelope), ['topic', 'seq', 'ts', 'payload'], 'as is the message envelope');
}

// ── 7. version + openapi ─────────────────────────────────────────────────────
{
  M._reset();
  const m = M.defineModule({ name: 'v', version: '3.1.4', clock: CLOCK });
  const v = m.versionInfo();
  eq(v.module, 'v'); eq(v.version, '3.1.4'); n += 2;
  eq(v.platform, require('../package.json').version, 'the platform version comes from package.json');
  ok(v.node.startsWith('v'), 'and the node version is reported');

  const doc = m.openapi();
  eq(doc.openapi, '3.1.0', 'OpenAPI 3.1');
  ok(doc.paths['/api/m/v/health'] && doc.paths['/api/m/v/config'], 'the four core paths are documented');
  const custom = M.getModule('v');
  ok(custom === m, 'the registry hands back the same object');
}

// ── 8. graceful shutdown: idempotent, never throws ───────────────────────────
{
  M._reset();
  let calls = 0;
  const lines = [];
  const m = M.defineModule({
    name: 'closer', version: '1.0.0', clock: CLOCK, logWrite: (l) => lines.push(l),
    onShutdown: () => { calls++; },
  });
  return (async () => {
    const a = await m.shutdown('SIGTERM');
    const b = await m.shutdown('SIGTERM');
    eq(calls, 1, 'shutdown is idempotent — a second SIGTERM does not flush twice');
    eq(a.ok, true); dee(a, b, 'and returns the same result'); n++;

    M._reset();
    const bad = M.defineModule({
      name: 'bad', version: '1.0.0', clock: CLOCK, logWrite: () => {},
      onShutdown: () => { throw new Error('flush failed'); },
    });
    const r = await bad.shutdown('SIGINT');
    eq(r.ok, false, 'a failing shutdown resolves with ok:false — it never rejects, so one bad module ' +
      'cannot abort the shutdown of the others');
    eq(r.error, 'flush failed', 'and it says what failed');

    // shutdownAll across modules
    M._reset();
    const order = [];
    M.defineModule({ name: 'a1', version: '1.0.0', clock: CLOCK, logWrite: () => {}, onShutdown: () => order.push('a1') });
    M.defineModule({ name: 'z9', version: '1.0.0', clock: CLOCK, logWrite: () => {}, onShutdown: () => { throw new Error('nope'); } });
    const all = await M.shutdownAll('SIGTERM');
    eq(all.length, 2, 'every module is shut down');
    ok(all.some((x) => x.ok === false), 'and a failure in one is reported, not thrown');
    ok(order.includes('a1'), 'while the healthy one still flushed');

    // ── 9. platform rollup ────────────────────────────────────────────────────
    M._reset();
    M.defineModule({ name: 'good', version: '1.0.0', clock: CLOCK, checks: () => [{ name: 'x', status: HEALTH.OK }] });
    M.defineModule({ name: 'mute', version: '1.0.0', clock: CLOCK });     // no checks ⇒ unknown
    const ph = M.platformHealth();
    eq(ph.status, HEALTH.UNKNOWN, 'one silent module makes the PLATFORM unknown, not ok');
    eq(ph.modulesUnscored, 1, 'and the number of unscored modules is stated, never hidden');
    eq(ph.healthScore, 0.5, 'the score averages over ALL modules, so silence costs you');

    // ── 10. duplicate registration is a bug, not a merge ─────────────────────
    M._reset();
    M.defineModule({ name: 'dup', version: '1.0.0', clock: CLOCK });
    assert.throws(() => M.defineModule({ name: 'dup', version: '2.0.0', clock: CLOCK }),
      /already defined/, 'registering the same module twice throws — silent overwrite hides a bug'); n++;
    assert.throws(() => M.defineModule({ name: 'x' }), /version required/,
      'a module without a version cannot be audited'); n++;

    // …but a module RE-LOADED (test busts require.cache) must be able to reclaim its adapter,
    // or the registry serves health and metrics from the discarded instance. A green light
    // from a corpse. This was a real bug: pop-seller.test.js reloads the module.
    {
      M._reset();
      let live = 'first';
      M.defineModule({ name: 'reload', version: '1.0.0', clock: CLOCK, metrics: () => ({ v: 1 }) });
      M.defineModule({ name: 'reload', version: '1.0.0', clock: CLOCK, replace: true, metrics: () => ({ v: 2 }) });
      eq(M.getModule('reload').metrics().v, 2,
        'after `replace`, the registry serves the NEWEST instance — not the one that was discarded');
      eq(M.listModules().filter((x) => x === 'reload').length, 1, 'and the name is registered exactly once');
      void live;
    }

    // the real engine registers itself and reports honestly
    {
      const pop = require('../pop-seller.js');
      ok(pop.service, 'pop-seller exposes its service adapter');
      const ph = pop.service.health();
      eq(ph.module, 'pop-seller'); n++;
      eq(ph.status, HEALTH.UNKNOWN,
        'pop-seller is UNKNOWN, not ok: its book is fine, but its reliability has never been measured. ' +
        'A health check that says ok for a thing it never checked is the most expensive green light');
      ok(ph.checks.some((c) => c.name === 'reliability' && c.status === HEALTH.UNKNOWN),
        'and it names exactly which check it cannot answer');
      ok(Number.isFinite(pop.service.metrics().book_size), 'metrics read the live book');
      eq(pop.service.config().POP_LIVE_ENABLED, false, 'live trading is off, and the config says so');
    }

    // ── 11. the eleven surfaces, over real HTTP ──────────────────────────────
    // Greps prove nothing about a router. This mounts it on an ephemeral port and asks.
    M._reset();
    M.defineModule({
      name: 'demo', version: '1.0.0', logWrite: () => {}, clock: CLOCK,
      checks: () => [{ name: 'ledger', status: HEALTH.OK },
                     { name: 'broker', status: HEALTH.UNKNOWN, detail: 'no session' }],
      metrics: () => ({ trades_total: 41 }),
      config: () => ({ MODE: 'paper', STRANGLE_CAPITAL: 700000, DHAN_ACCESS_TOKEN: 'eyJhbGciOi.leak' }),
      channels: [{ name: 'ticks', description: 'per-strike LTP' }],
    });
    const express = require('express');
    const app = express();
    app.use('/api/m', M.mountAll());       // <-- the ONE line server.js needs
    const srv = app.listen(0);
    await new Promise((r) => srv.once('listening', r));
    const port = srv.address().port;
    const get = async (u) => { const r = await fetch(`http://127.0.0.1:${port}${u}`); return { status: r.status, body: await r.text() }; };

    try {
      eq((await get('/api/m/')).status, 200, 'the module index responds');

      const h = await get('/api/m/demo/health');
      eq(h.status, 200, 'health responds 200 when not down');
      const hj = JSON.parse(h.body);
      eq(hj.status, HEALTH.UNKNOWN, 'one unknown check makes the module unknown, over HTTP too');
      eq(hj.healthScore, 0.5, 'and the score reflects the dilution, not the one healthy check');

      const cfg = JSON.parse((await get('/api/m/demo/config')).body);
      eq(cfg.DHAN_ACCESS_TOKEN, '[REDACTED]',
        'THE BROKER TOKEN DOES NOT CROSS THE WIRE — verified over real HTTP, not by inspection');
      eq(cfg.STRANGLE_CAPITAL, 700000, 'while ordinary config still renders');

      eq((await get('/api/m/demo/metrics')).body, 'demo_trades_total 41\n', 'Prometheus text is served');
      eq(JSON.parse((await get('/api/m/demo/version')).body).platform, require('../package.json').version,
        'the platform version is served');
      eq(JSON.parse((await get('/api/m/demo/openapi.json')).body).openapi, '3.1.0', 'OpenAPI is served');

      const ws = await get('/api/m/demo/ws');
      eq(ws.status, 501, 'the WebSocket surface answers 501 NOT IMPLEMENTED — it refuses to pretend');
      ok(/no WebSocket server exists/.test(ws.body), 'and explains exactly what is missing');

      // a DOWN module must fail its health probe loudly enough for a load balancer
      M.defineModule({ name: 'dead', version: '1.0.0', logWrite: () => {}, clock: CLOCK,
        checks: () => [{ name: 'x', status: HEALTH.DOWN }] });
      const app2 = express(); app2.use('/api/m', M.mountAll());
      const srv2 = app2.listen(0); await new Promise((r) => srv2.once('listening', r));
      const p2 = srv2.address().port;
      const dead = await fetch(`http://127.0.0.1:${p2}/api/m/dead/health`);
      eq(dead.status, 503, 'a DOWN module returns 503, so an orchestrator can act on it');
      const plat = await fetch(`http://127.0.0.1:${p2}/api/m/health`);
      eq(plat.status, 503, 'and one dead module takes the platform probe down with it — fail closed');
      srv2.close();
    } finally {
      srv.close();
    }

    // ── 12. performance — /health is polled; it must not be expensive ────────
    // Generous, order-of-magnitude thresholds. They exist to catch someone putting a disk read
    // or a network call inside a health check, not to police a few percent on a busy machine.
    {
      M._reset();
      const m = M.defineModule({ name: 'perf', version: '1.0.0', clock: CLOCK,
        checks: () => [{ name: 'a', status: HEALTH.OK }], metrics: () => ({ x: 1 }) });
      const t0 = process.hrtime.bigint();
      for (let i = 0; i < 5000; i++) m.health();
      const per = Number(process.hrtime.bigint() - t0) / 5000 / 1000;
      ok(per < 200, `health() costs ${per.toFixed(2)} µs — cheap enough for a load-balancer probe`);

      // redaction walks the whole config on every /config hit
      const big = {}; for (let i = 0; i < 200; i++) big['k' + i] = 'value' + i;
      const t1 = process.hrtime.bigint();
      for (let i = 0; i < 1000; i++) M.redactConfig(big);
      const perR = Number(process.hrtime.bigint() - t1) / 1000 / 1000;
      ok(perR < 2000, `redactConfig() over 200 keys costs ${perR.toFixed(1)} µs`);
    }

    // ── 13. memory — the registry is bounded; a reload does not accumulate ───
    {
      M._reset();
      for (let i = 0; i < 5000; i++) {
        M.defineModule({ name: 'churn', version: '1.0.0', clock: CLOCK, replace: true,
          metrics: () => ({ i }) });
      }
      eq(M.listModules().length, 1,
        'MEMORY: 5,000 reloads of one module leave ONE registry entry — `replace` swaps, never appends');
      eq(M.getModule('churn').metrics().i, 4999, 'and the live instance is the last one registered');

      // a logger holds nothing
      const lines = [];
      const log = M.createLogger('t', { write: (l) => lines.push(l), clock: CLOCK });
      for (let i = 0; i < 1000; i++) log.info('x', { i });
      eq(lines.length, 1000, 'the logger writes through to its sink and buffers nothing itself');

      if (typeof global.gc === 'function') {
        M._reset();
        global.gc();
        const base = process.memoryUsage().heapUsed;
        for (let i = 0; i < 20000; i++) {
          M.defineModule({ name: 'leak', version: '1.0.0', clock: CLOCK, replace: true, logWrite: () => {} });
        }
        M._reset(); global.gc();
        const grown = process.memoryUsage().heapUsed - base;
        ok(grown < 8 * 1024 * 1024, `20k registrations retained ${(grown / 1048576).toFixed(1)} MB after reset`);
      } else {
        console.log('  (heap assertion skipped: run with --expose-gc to measure retention)');
      }
    }

    // ── 14. rollback validation — additive, so a revert cannot break a caller ─
    {
      // Reverting means deleting module-contract.js and the `service` export on pop-seller.
      // Nothing pre-existing depends on either. Assert that, rather than assume it.
      M._reset();
      const pop = require('../pop-seller.js');
      for (const fn of ['scanPoP', 'buildIronCondor', 'sellPoP', 'closePoP', 'getBook', 'popStatus']) {
        eq(typeof pop[fn], 'function', `ROLLBACK: pre-existing export \`${fn}\` is untouched`);
      }
      const st = pop.popStatus();
      ok('openPositions' in st && 'liveEnabled' in st && 'book' in st,
        'ROLLBACK: popStatus keeps every field its existing callers read');
      ok(typeof pop.service === 'object', 'the new surface is additive — a separate key, not a replacement');

      // and no protected file was touched to make any of this work
      const fs2 = require('fs');
      const server = fs2.readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
      ok(!/module-contract/.test(server),
        'ROLLBACK: server.js does not reference module-contract — the mount line is still an ASK, not a fact');
    }

    M._reset();
    console.log(`\n${n} assertions passed`);
  })();
}
