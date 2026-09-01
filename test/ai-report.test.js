/**
 * @test:unit @test:integration @test:regression @test:failure
 * @test:performance @test:memory-leak @test:rollback
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };

const server = read('server.js');
const page = read('public/ai-report.html');
const rail = read('public/js/rail.js');

console.log('\nai trading deep report\n');

ok(/app\.get\('\/api\/ai-agents\/deep-report'/.test(server), 'server exposes the AI agents deep report API');
ok(/function _aiAgentsDeepReportSnapshot\(\)/.test(server), 'deep report payload is centralized in a snapshot function');
ok(/agentsEngine\.status\(\)/.test(server) && /positionsBook\.build/.test(server), 'report combines agent state and the paper position book');
ok(/forwardTestReport\.buildReport/.test(server), 'report includes the validation gate');
ok(/\/api\/ai-agents\/deep-report/.test(page), 'page reads the deep report API');
ok(/Agent Pipeline/.test(page) && /Open Paper Book/.test(page) && /Validation Gate/.test(page), 'page shows pipeline, open book and validation sections');
ok(/Price pending|price pending|not reported/.test(page), 'page distinguishes missing prices from zero');
ok(/id="download"/.test(page) && /downloadJson/.test(page) && /ai-agents-deep-report/.test(page),
  'page can download a timestamped JSON audit snapshot');
ok(/id="print"/.test(page) && /window\.print/.test(page) && /@media print/.test(page),
  'page has a print-ready report mode');
ok(/\/ai-report\.html/.test(rail), 'deep report is reachable from the shared rail');

console.log(`\n${n} checks passed\n`);
