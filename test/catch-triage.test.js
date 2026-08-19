/* TEST CATEGORIES — unit · regression · failure
   @test:unit @test:regression @test:failure

   No integration / performance / memory-leak / rollback tests.
   These markers are what this file ACTUALLY contains. */

/* THE SILENT-CATCH TRIAGE — docs/094, Phase 3B of docs/086.

   79 silent catches in server.js, every one now placed in a category with a
   written reason. The categories live in catch-triage.json rather than as
   comments in server.js, and that is a decision worth defending:

     · annotating 79 sites would be a large diff with no behaviour change to a
       file whose dependency mechanism is construction order
     · a data file cannot change behaviour, which enforces the rule the triage
       was written under — categorising a catch and changing it are two
       different commits

   WHAT THIS FILE GUARDS
     A triage is worth exactly as much as its ability to notice when it has
     stopped describing the code. Two ways that happens, and one assertion each:

       a NEW silent catch appears        → uncategorised, and the count moves
       server.js MOVES                   → a category points at a line that no
                                           longer holds a catch (DRIFT)

     The second is the quiet one. Line numbers rot, and a category that outlives
     the code it described is worse than no category: it reads as a decision.
*/
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let failures = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e && e.message}`); }
};

const report = JSON.parse(execFileSync(process.execPath,
  [path.join(ROOT, 'scripts', 'catch-triage.js'), '--json'], { encoding: 'utf8' }));
const sidecar = JSON.parse(fs.readFileSync(path.join(ROOT, 'catch-triage.json'), 'utf8'));

console.log('\n§1 — every silent catch is placed');

t('nothing is left as TODO-TRIAGE', () => {
  assert.strictEqual(report.counts['TODO-TRIAGE'], 0,
    `${report.counts['TODO-TRIAGE']} silent catch(es) carry no category. The default is `
    + '"undecided", never "fine" — an unexamined catch has not been judged safe.');
});

t('THE RATCHET: the number of silent catches may only go DOWN', () => {
  /* 82 when first counted by parsing (a grep had said 55 — it matched three
     literal spellings). 79 now: four went with the retention and connector
     fixes, and one arrived with the reconciliation loop.

     Raising this number is not the fix for a failing build. A new silent catch
     is a new place the system cannot say what happened, and it needs the same
     argument every one of the 79 got. */
  const CEILING = 79;
  assert.ok(report.total <= CEILING,
    `${report.total} silent catches, ceiling ${CEILING}. If one was added deliberately, `
    + 'lower nothing — argue for it in the commit and move the ceiling in the same change.');
});

t('and no category points at a line that no longer holds one', () => {
  /* DRIFT. scripts/catch-triage.js reports it; this asserts it. A stale entry is
     never dropped silently — dropping it would let a category quietly outlive the
     code it was written about. */
  const out = execFileSync(process.execPath,
    [path.join(ROOT, 'scripts', 'catch-triage.js')], { encoding: 'utf8' });
  assert.ok(!/DRIFT/.test(out),
    'catch-triage.json carries line numbers that no longer hold a silent catch — '
    + 'server.js moved. Re-derive them; do not delete them.');
});

console.log('\n§2 — the categories are arguments, not labels');

t('every group states WHY, at length', () => {
  for (const [cat, groups] of Object.entries(sidecar.categories)) {
    for (const [name, g] of Object.entries(groups)) {
      assert.ok(g.why && g.why.length >= 60,
        `${cat}/${name} has a ${g.why ? g.why.length : 0}-character reason — a category `
        + 'without an argument is a label, and a label is what "TODO" already was');
      assert.ok(Array.isArray(g.keys), `${cat}/${name} has no keys array`);
    }
  }
});

t('no line is claimed by two categories', () => {
  const seen = new Map();
  for (const [cat, groups] of Object.entries(sidecar.categories)) {
    for (const [name, g] of Object.entries(groups)) {
      for (const key of g.keys) {
        assert.ok(!seen.has(key),
          `key ${key} is in both ${seen.get(key)} and ${cat}/${name}`);
        seen.set(key, `${cat}/${name}`);
      }
    }
  }
});

t('TODO-TRIAGE survives as an empty group rather than disappearing', () => {
  /* An empty TODO-TRIAGE says the work was done. A missing one says nothing,
     and the two read identically to a tool. */
  assert.ok(sidecar.categories['TODO-TRIAGE'],
    'the TODO-TRIAGE group was removed once it emptied — keep it, so "none left" is stated');
});

console.log('\n§3 — the group that matters is named as such');

t('the persisted-state group exists and is LOGGED, not EXPECTED-OPTIONAL', () => {
  /* These are the catches worth changing. Each reads or writes a file carrying
     state across restarts — engine config, VRP history, paper positions. A
     failure does not lose a tick; it reverts a setting the operator chose, and
     the system then runs a configuration nobody selected. Same shape as the
     trade counter resetting on restart. */
  const g = sidecar.categories.LOGGED && sidecar.categories.LOGGED.persistedStateSilentlyReverts;
  assert.ok(g, 'the persisted-state group is gone — it is the reason the triage was worth doing');
  assert.ok(g.keys.length >= 8, `only ${g.keys.length} entries in it`);
  assert.match(g.why, /reverts|silently/i);
});

t('the crash guard is EXPECTED-OPTIONAL, and says why', () => {
  const g = sidecar.categories['EXPECTED-OPTIONAL'].crashGuardOwnLog;
  assert.ok(g && g.keys.length === 1, 'the crash-guard group must hold exactly its one catch');
  assert.match(g.why, /crash handler/i,
    'a failure writing the crash log must not throw, or the process loses the original error');
});

console.log('\n§4 — the sidecar cannot fail open');

t('an unreadable catch-triage.json is an ERROR, not "nothing is categorised"', () => {
  /* The tempting bug: a failed read yields an empty map, every catch reads as
     uncategorised, and --assert fails for the wrong reason — or worse, a caller
     concludes the triage was never done. */
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'catch-triage.js'), 'utf8');
  assert.ok(/refusing to report every catch as uncategorised/.test(src),
    'a failed sidecar read must throw with its reason, not degrade to an empty map');
  assert.ok(/e\.code === 'ENOENT'/.test(src),
    'and absent must still differ from unreadable');
});

t('a duplicate key in the sidecar is refused at load', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'catch-triage.js'), 'utf8');
  assert.ok(/twice/.test(src),
    'two categories claiming one catch would let whichever loaded last win, silently');
});

t('THE FIX: categories survive server.js moving', () => {
  /* MEASURED 2026-08-13. The first version keyed on LINE NUMBER. Adding the H/L
     alerter shifted every line below it and 69 of 79 categories stopped
     matching — and worse, a line that still held A catch would have been handed
     another catch's category, silently.

     The key is now the catch's own source plus its preceding non-empty line,
     hashed, plus an ordinal among identical ones. Five collisions were measured
     on the first conversion, which is why the ordinal exists: content alone
     cannot separate two identical catches. */
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'catch-triage.js'), 'utf8');
  assert.ok(/f\.key = `\$\{f\.fp\}#\$\{n\}`/.test(src),
    'the key is not fingerprint#occurrence — line numbers rot and mis-attribute');
  assert.ok(!/sidecar\.map\.get\(f\.line\)/.test(src), 'lookups still go by line number');
  for (const groups of Object.values(sidecar.categories)) {
    for (const g of Object.values(groups)) {
      for (const k of g.keys) {
        assert.match(k, /^[0-9a-f]{12}#\d+$/, `${k} is not a fingerprint#occurrence key`);
      }
    }
  }
});

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing`);
process.exit(failures === 0 ? 0 : 1);
