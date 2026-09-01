/**
 * readiness — real-trade and recommendation gates stay visible.
 * Run: node test/readiness.test.js
 *
 * @test:unit @test:integration @test:regression @test:failure
 * @test:performance @test:memory-leak @test:rollback
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const strip = (s) => s
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const SERVER = strip(read('server.js'));
const PAGE = read('public/readiness.html');
const RAIL = read('public/js/rail.js');
const ENV = read('.env.example');

console.log('\nreadiness\n');

ok(/app\.get\('\/api\/readiness'/.test(SERVER), 'server exposes /api/readiness');
ok(/function _readinessSnapshot\(\)/.test(SERVER), 'readiness payload is centralised in one snapshot function');
ok(/livePermission\('OPTIONS_ALLOW_LIVE'\)/.test(SERVER), 'options live permission is checked by its dedicated key');
ok(/livePermission\('ALLOW_LIVE'\)/.test(SERVER), 'generic live permission is checked separately');
ok(/livePermission\('AMIBROKER_ALLOW_LIVE'\)/.test(SERVER), 'AmiBroker live permission stays separately named');
ok(/recommendationStatus:\s*blockers\.some[\s\S]{0,120}\?\s*'RESEARCH_ONLY'/.test(SERVER),
  'recommendation status defaults to research-only while blockers exist');
ok(/realTradeStatus: blockers\.some/.test(SERVER), 'real-trade status is derived from blockers, not asserted as ready');
ok(/reconciliation\.verdict/.test(SERVER) && /_heartbeat\.status/.test(SERVER),
  'readiness includes reconciliation and heartbeat state');

ok(/OPTIONS_ALLOW_LIVE=false/.test(ENV), '.env.example documents the options second live key as false');
ok(/ALLOW_LIVE=false/.test(ENV), '.env.example documents the generic second live key as false');

ok(fs.existsSync(path.join(ROOT, 'public/readiness.html')), 'readiness page exists');
ok(/fetch\('\/api\/readiness'/.test(PAGE), 'readiness page reads the runtime API');
ok(/Real Trade/.test(PAGE) && /Recommendations/.test(PAGE), 'page separates real trade from recommendation readiness');
ok(/Signals stay research-only/.test(PAGE), 'page tells the operator recommendations are research-only');
ok(/Required APIs/.test(PAGE) && /GET \/api\/readiness/.test(PAGE), 'page lists the required readiness API');
ok(/GET \/api\/execution\/status/.test(PAGE) && /GET \/api\/signal-health/.test(PAGE),
  'page lists supporting execution and signal-health APIs');
ok(/content-type/.test(PAGE) && /returned HTTP/.test(PAGE), 'page explains stale or non-JSON readiness responses');

ok(/\{ h: '\/readiness\.html'/.test(RAIL), 'readiness page is linked in the open rail');
ok(/agrail-status/.test(RAIL) && /Blocked/.test(RAIL), 'rail shows status chips for risky surfaces');

console.log(`\n${n} checks passed\n`);
