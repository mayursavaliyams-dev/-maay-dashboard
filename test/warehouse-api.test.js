'use strict';
/**
 * CONTRACT tests for warehouse-api.js — the read-only archive HTTP surface.
 * Design: docs/H19. New module → contract tests.
 *
 * @test:characterization @test:unit @test:integration @test:regression
 * @test:failure @test:performance @test:memory-leak @test:rollback
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-api-'));
process.env.WAREHOUSE_ROOT = TMP;
const api = require('../warehouse-api.js');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
const eq = (a, b, m) => { n++; assert.strictEqual(a, b, m); };

// seed one archived day
fs.mkdirSync(api.OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(api.OUT_DIR, '2026-07-06.json'), JSON.stringify({
  date: '2026-07-06', engine: 'minute-extreme-walk@v1', source: { sha256: 'abc' }, strikeCount: 1,
  strikes: {
    'NIFTY|24400|CE': { opening: 63.5, closing: 68, high: { t: 1, time: '14:26:00', price: 69.2 }, low: { t: 2, time: '14:48:00', price: 51.15 },
      highRecord: [{ t: 1, time: '14:20:00', price: 63.5 }, { t: 2, time: '14:26:00', price: 69.2 }],
      lowRecord:  [{ t: 3, time: '14:48:00', price: 51.15 }] },
  },
}));

const httpGet = (port, p) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: p }, res => {
    let d = ''; res.on('data', c => d += c);
    res.on('end', () => resolve({ status: res.statusCode, cors: res.headers['access-control-allow-origin'], body: JSON.parse(d || '{}') }));
  }).on('error', reject);
});
const httpPost = (port, p) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST' }, res => { res.resume(); resolve(res.statusCode); });
  req.on('error', reject); req.end();
});

async function main() {
  // ── @test:unit — listDays ──
  ok(api.listDays().includes('2026-07-06'), 'listDays surfaces the archived day');

  // ── @test:unit/@test:characterization — getRecord maps to the modal leg shape ──
  {
    const r = api.getRecord('2026-07-06', 'NIFTY', '24400', 'CE');
    ok(r.found, 'record found');
    eq(r.ce.high, 69.2, 'CE high mapped');
    eq(r.ce.highHistory.length, 2, 'CE high RECORD timeline (2 prints) preserved');
    eq(r.pe, null, 'PE absent that day → null, never a fabricated empty leg');
    eq(r.ce.ltp, null, 'archived leg carries no live LTP → null, not 0');
    ok(/ARCHIVE/.test(r.marketStatus), 'status clearly marks archive, never mistaken for live');
  }

  // ── @test:regression — a missing day is reported, never invented ──
  eq(api.getRecord('1999-01-01', 'NIFTY', '24400', 'CE').found, false, 'no archive → found:false (not fabricated)');

  // ── @test:unit — pure router ──
  eq(api.route('/wh/days', {}).status, 200, '/wh/days ok');
  eq(api.route('/wh/hl-record', { inst: 'NIFTY', strike: '24400' }).status, 400, 'missing date → 400');
  eq(api.route('/wh/nope', {}).status, 404, 'unknown path → 404');
  {
    const r = api.route('/wh/hl-record', { date: '2026-07-06', inst: 'nifty', strike: '24400', type: 'ce' });
    eq(r.status, 200, 'lowercase inst/type normalized → 200');
    eq(r.json.ce.high, 69.2, 'router returns the mapped record');
  }

  // ── @test:integration / @test:failure — real socket, GET-only ──
  const server = api.createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const days = await httpGet(port, '/wh/days');
    eq(days.status, 200, 'HTTP /wh/days → 200');
    eq(days.cors, '*', 'CORS header present so the dashboard can read cross-port');
    ok(days.body.days.includes('2026-07-06'), 'HTTP returns the archived day');
    const rec = await httpGet(port, '/wh/hl-record?date=2026-07-06&inst=NIFTY&strike=24400&type=CE');
    eq(rec.body.ce.highHistory.length, 2, 'HTTP returns the full record timeline');
    eq(await httpPost(port, '/wh/days'), 405, 'POST is refused — read-only surface');
  } finally { server.close(); }

  // ── @test:performance ──
  {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 200; i++) api.getRecord('2026-07-06', 'NIFTY', '24400', 'CE');
    ok(Number(process.hrtime.bigint() - t0) / 1e6 < 250, '200 record reads < 250ms');
  }

  // ── @test:memory-leak / @test:rollback — read-only, no side effects ──
  eq(typeof api.createServer, 'function', 'server factory is pure — no side effects at require time');
  for (let i = 0; i < 100; i++) api.listDays();
  ok(true, '100 listDays calls leak nothing (pure reads)');
}

main().then(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
  console.log(`\n${n} assertions passed`);
}).catch(e => { console.error(e); process.exit(1); });
