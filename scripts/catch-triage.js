#!/usr/bin/env node
/* catch-triage — enumerate every silent catch by PARSING, not by grep.
   Phase 3B. Reports; changes nothing.

   Usage:  node scripts/catch-triage.js [file...] [--json] [--assert]

   WHY PARSING
   -----------
   A grep for `catch (_) {}` finds the ones written that way. It misses
   `catch(e){}`, a catch whose body is only a comment, a catch spanning lines,
   and a catch containing a lone `return`. Those are the same defect wearing
   different clothes, and a count that misses them under-reports the exposure —
   which is worse than not counting, because it produces a number people trust.

   The source is scanned with comments and string literals blanked out first, so
   a brace inside a string or a `catch` inside a comment cannot shift the count.
   No parser dependency is added: the repository has none, and Phase 3 is not
   the place to introduce one.

   WHAT COUNTS AS SILENT
   ---------------------
   A catch whose body, with comments and whitespace removed, is:
     · empty
     · a bare `return` / `return null` / `return false` / `return 0` / `return []`
     · a bare `continue` or `break`

   A catch that logs, rethrows, records, or takes any other action is NOT silent
   and is not reported. The question is not "is this catch bare" — it is "can an
   operator tell this happened".

   THE THREE CATEGORIES
   --------------------
   EXPECTED-OPTIONAL  the failure is a normal state and there is nothing to say
   LOGGED             it should say something and currently does not
   TODO-TRIAGE        nobody has decided yet

   Only an annotation puts a catch in the first two. An unannotated silent catch
   is TODO-TRIAGE by definition — the default is "undecided", never "fine". */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const AS_JSON = process.argv.includes('--json');
const ASSERT = process.argv.includes('--assert');
const FILES = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const TARGETS = FILES.length ? FILES : ['server.js'];

const CATEGORIES = ['EXPECTED-OPTIONAL', 'LOGGED', 'TODO-TRIAGE'];

/** Blank comments and string literals, preserving offsets and line breaks. */
function blankOutNoise(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && c2 === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += ' '; i++;
      while (i < n && src[i] !== q) {
        if (src[i] === '\\') { out += '  '; i += 2; continue; }
        out += src[i] === '\n' ? '\n' : ' '; i++;
      }
      out += ' '; i++;
      continue;
    }
    out += c; i++;
  }
  return out;
}

const SILENT_BODY = /^(|return\s*(null|false|true|0|\[\]|\{\})?\s*;?|continue\s*;?|break\s*;?)$/;

function findCatches(file) {
  const raw = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const clean = blankOutNoise(raw);
  const lines = raw.split('\n');
  const lineStarts = [];
  { let acc = 0; for (const l of lines) { lineStarts.push(acc); acc += l.length + 1; } }
  const lineOf = (idx) => {
    let lo = 0; let hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };

  const found = [];
  const re = /\bcatch\b/g;
  let m;
  while ((m = re.exec(clean))) {
    let i = m.index + 5;
    while (i < clean.length && /\s/.test(clean[i])) i++;
    if (clean[i] === '(') {
      let depth = 1; i++;
      while (i < clean.length && depth > 0) { if (clean[i] === '(') depth++; else if (clean[i] === ')') depth--; i++; }
      while (i < clean.length && /\s/.test(clean[i])) i++;
    }
    if (clean[i] !== '{') continue;
    const bodyStart = i + 1;
    let depth = 1; i++;
    while (i < clean.length && depth > 0) { if (clean[i] === '{') depth++; else if (clean[i] === '}') depth--; i++; }
    const bodyEnd = i - 1;

    const cleanBody = clean.slice(bodyStart, bodyEnd).trim();
    if (!SILENT_BODY.test(cleanBody)) continue;

    const line = lineOf(m.index);
    const rawBody = raw.slice(bodyStart, bodyEnd);
    const rawLine = lines[line - 1] || '';
    const annotationText = `${rawBody} ${rawLine}`;
    const category = CATEGORIES.find((c) => annotationText.includes(c)) || 'TODO-TRIAGE';

    found.push({
      file,
      line,
      category,
      annotated: category !== 'TODO-TRIAGE',
      swallows: cleanBody === '' ? 'everything' : `everything → ${cleanBody.replace(/;$/, '')}`,
      source: rawLine.trim().slice(0, 100),
    });
  }
  return found;
}

const all = TARGETS.flatMap(findCatches);
const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, all.filter((x) => x.category === c)]));

if (AS_JSON) {
  console.log(JSON.stringify({ total: all.length, counts: Object.fromEntries(CATEGORIES.map((c) => [c, byCategory[c].length])), findings: all }, null, 2));
} else {
  console.log(`\n══ SILENT CATCHES — ${TARGETS.join(', ')} ══\n`);
  console.log(`  total silent      : ${all.length}`);
  for (const c of CATEGORIES) console.log(`  ${c.padEnd(18)}: ${byCategory[c].length}`);
  console.log('');
  console.log('   line   swallows                    source');
  console.log('  ─────  ──────────────────────────  ─────────────────────────────────────────────');
  for (const f of all) {
    console.log(`  ${String(f.line).padStart(5)}  ${f.swallows.padEnd(26).slice(0, 26)}  ${f.source.slice(0, 62)}`);
  }
  console.log('');
  console.log('  Every unannotated entry is TODO-TRIAGE by definition. The default is');
  console.log('  "undecided", never "fine" — an unexamined catch has not been judged safe.');
}

if (ASSERT) {
  const undecided = byCategory['TODO-TRIAGE'].length;
  if (undecided > 0) {
    console.error(`\nFAIL — ${undecided} silent catch(es) carry no category.`);
    process.exit(1);
  }
  console.log('\nPASS — every silent catch is categorised.');
}
