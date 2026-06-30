/**
 * Test runner — executes every test/*.test.js in its own child process so one
 * failing suite doesn't abort the rest. Exit code is non-zero if any suite fails.
 * Run: npm test
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort();
if (!files.length) { console.log('no test files found'); process.exit(0); }

let failed = 0;
for (const f of files) {
  console.log(`\n── ${f} ──`);
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.error(`✗ ${f} FAILED`); }
}
console.log(`\n${files.length - failed}/${files.length} suites passed`);
process.exit(failed ? 1 : 0);
