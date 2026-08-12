#!/usr/bin/env node
/* construction-order — map what server.js builds, in what order, and who
   receives which broker.
   Phase 4, first deliverable. Reports; changes nothing.

   Usage:  node scripts/construction-order.js [--json]

   THE DEFECT CLASS
   ----------------
   server.js manages dependencies by construction order across 8,363 lines.
   "What is defined by the time this line runs" is the entire mechanism. That is
   how the risk guard came to be constructed 2,300 lines AFTER the engines that
   were supposed to receive it — where it could not have been passed to them, and
   was not. Nothing failed. Nothing warned. The guard existed, was correct, and
   was held by nobody.

   WHAT THIS ANSWERS
   -----------------
   For each object that can reach a broker: which broker object was handed to it,
   and was the guard even in existence at that line?

   A consumer constructed BEFORE the guard cannot be holding the guard, whatever
   the code appears to say. That is a fact derivable from line numbers alone, and
   it is the one fact this file exists to produce.

   WHAT IT DOES NOT ANSWER
   -----------------------
   Whether a consumer constructed AFTER the guard actually received it. That
   requires reading the live object graph, which is what attestation.js
   `orderConsumers` does. Line order can prove a negative; only the running
   process can confirm the positive. Both halves are needed and this is one. */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const AS_JSON = process.argv.includes('--json');
const SRC = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const LINES = SRC.split('\n');

/* ── top-level constructions ───────────────────────────────────────────────── */

const constructions = [];
const requires = [];

LINES.forEach((raw, i) => {
  const line = i + 1;
  const text = raw.trim();
  if (text.startsWith('//') || text.startsWith('*') || text.startsWith('/*')) return;

  let m = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+([A-Za-z_$][\w$.]*)\s*\(([^]*)$/.exec(text);
  if (m) {
    constructions.push({ line, name: m[1], ctor: m[2], args: m[3].slice(0, 120), source: text.slice(0, 110) });
    return;
  }
  m = /^(?:const|let|var)\s+(?:\{([^}]*)\}|([A-Za-z_$][\w$]*))\s*=\s*require\(['"]([^'"]+)['"]\)/.exec(text);
  if (m) {
    requires.push({ line, names: (m[1] || m[2] || '').split(',').map((s) => s.trim().split(':')[0].trim()).filter(Boolean), spec: m[3] });
  }
});

/* ── the broker objects, and who receives one ──────────────────────────────── */

const BROKERS = ['live', 'guardedBroker'];

/* MEASURED 2026-08-08 — the first version of this used
     new RegExp(`^\\s*(?:const|let|var)\\s+${name}\\s*=`, 'm')
   and reported `live` as declared at line 6491. It is declared at line 193, as

     let live, CONNECTOR_NAME, CONNECTOR_ORDER_CAPABILITY;

   Two separate misses: the multi-declarator form has no `=` after the name, and
   `\s*` matched an INDENTED `const live = …` inside a loop at 6492 — a
   block-scoped shadow, not the declaration.

   The reported consequence would have been that the guard at line 256 receives a
   connector declared 6,000 lines later, which is not merely wrong but
   impossible, and a map that reports impossible things is not consulted twice.

   Now: top-level only (column 0), and the whole declarator list is read. */
function findAssignment(name) {
  const c = constructions.find((x) => x.name === name);
  if (c) return c.line;
  for (let i = 0; i < LINES.length; i++) {
    const l = LINES[i];
    if (/^\s/.test(l)) continue;                                  // not top-level
    const m = /^(?:const|let|var)\s+([^=;]+)/.exec(l);
    if (!m) continue;
    const declared = m[1].split(',').map((s) => s.trim().split(/[\s=]/)[0]);
    if (declared.includes(name)) return i + 1;
  }
  return null;
}

const guardLine = findAssignment('guardedBroker');
const rawLine = findAssignment('live');

/** Every construction whose arguments mention a broker object. */
const consumers = constructions
  .map((c) => {
    const got = BROKERS.filter((b) => new RegExp(`(^|[^\\w$])${b}([^\\w$]|$)`).test(c.args));
    return got.length ? { ...c, receives: got } : null;
  })
  .filter(Boolean);

/* Constructions that take no broker in their constructor but might be wired
   later — recorded so their absence from `consumers` is not read as safety. */
const ENGINE_HINT = /engine|bridge|executor|trader|bot|strangle|gamma|bounce|afternoon|limit|pop/i;
const enginesWithoutBroker = constructions.filter(
  (c) => ENGINE_HINT.test(c.name + c.ctor) && !consumers.some((x) => x.line === c.line));

/* ── report ────────────────────────────────────────────────────────────────── */

const findings = [];

for (const c of consumers) {
  const beforeGuard = guardLine !== null && c.line < guardLine;
  findings.push({
    line: c.line,
    name: c.name,
    ctor: c.ctor,
    receives: c.receives,
    verdict: c.receives.includes('guardedBroker')
      ? (beforeGuard ? 'IMPOSSIBLE' : 'guarded')
      : 'RAW CONNECTOR',
    note: beforeGuard
      ? `constructed at ${c.line}, ${guardLine - c.line} lines BEFORE the guard exists at ${guardLine}`
      : null,
  });
}

if (AS_JSON) {
  console.log(JSON.stringify({
    guardLine, rawLine, totalConstructions: constructions.length,
    consumers: findings, enginesWithoutBrokerArg: enginesWithoutBroker.map((c) => ({ line: c.line, name: c.name, ctor: c.ctor })),
  }, null, 2));
  process.exit(0);
}

console.log('\n══ CONSTRUCTION ORDER — server.js ══\n');
console.log(`  file length                : ${LINES.length} lines`);
console.log(`  top-level constructions    : ${constructions.length}`);
console.log(`  top-level requires         : ${requires.length}`);
console.log(`  raw connector  'live'      : line ${rawLine}`);
console.log(`  guard 'guardedBroker'      : line ${guardLine}`);
console.log('');

console.log('══ WHO RECEIVES A BROKER ══\n');
console.log('   line  name                  receives            verdict');
console.log('  ─────  ────────────────────  ──────────────────  ──────────────');
for (const f of findings.sort((a, b) => a.line - b.line)) {
  console.log(`  ${String(f.line).padStart(5)}  ${f.name.padEnd(20).slice(0, 20)}  ${f.receives.join('+').padEnd(18)}  ${f.verdict}`);
  if (f.note) console.log(`         ${f.note}`);
}
if (!findings.length) console.log('  (none found — a broker is passed by some shape this scan does not read)');

console.log('\n══ ENGINE-LIKE OBJECTS THAT TAKE NO BROKER AT CONSTRUCTION ══\n');
console.log('  These are NOT proven safe. They may be wired a broker afterwards, by');
console.log('  assignment or by a setter, which this scan cannot see. Their absence');
console.log('  from the table above is absence of evidence, not evidence of absence.\n');
for (const c of enginesWithoutBroker.slice(0, 30)) {
  console.log(`  ${String(c.line).padStart(5)}  ${c.name.padEnd(24).slice(0, 24)} ${c.ctor}`);
}
if (enginesWithoutBroker.length > 30) console.log(`  … and ${enginesWithoutBroker.length - 30} more`);

console.log('\n══ WHAT THIS PROVES AND WHAT IT DOES NOT ══\n');
console.log('  PROVES    : a consumer constructed before line ' + guardLine + ' cannot hold the guard.');
console.log('              Line order settles that regardless of what the code appears to say.');
console.log('  DOES NOT  : confirm that a consumer constructed after it DID receive it.');
console.log('              Only the running object graph answers that — attestation.js');
console.log('              orderConsumers, which is still empty. Line order proves a');
console.log('              negative; the live process is required for the positive.');
console.log('');
