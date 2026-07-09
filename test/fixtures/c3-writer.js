/**
 * Test fixture for test/safe-write.test.js — a child process that hammers a file.
 * Not a test suite (test/run.js only picks up *.test.js).
 *
 *   node c3-writer.js <target> <mode: naive|safe> <rows> [iterations]
 *
 * Exits 0 when it finishes; it is normally SIGKILLed mid-write by the crash tests.
 */
'use strict';
const fs = require('fs');
const safe = require('../../safe-write.js');

const [, , target, mode, rowsArg, iterArg] = process.argv;
const rows = Number(rowsArg) || 20000;
const iterations = Number(iterArg) || 1e9;

const payload = { rows: Array.from({ length: rows }, (_, i) => ({ i, s: 'x'.repeat(40) })) };

if (process.send) process.send('ready');

for (let n = 0; n < iterations; n++) {
  payload.rows[0].i = n;
  if (mode === 'naive') fs.writeFileSync(target, JSON.stringify(payload));
  else safe.writeJsonSync(target, payload, { fsync: false });   // fsync off: we test tearing, not durability
}
