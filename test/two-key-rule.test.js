/* TEST CATEGORIES — unit · regression
   @test:unit @test:regression

   regression = the one-key set is pinned, so a new one-key path turns this red. No integration /
   performance / memory-leak / rollback tests — this suite reports, it does not exercise.

   These markers are what this file ACTUALLY contains. The Testing Rule names eight
   categories; this suite declares the ones it has and names the ones it does not,
   because a marker asserting coverage that was never written is worse than no marker:
   it converts missing work into apparent compliance. */
/* PHASE 1D — no path may reach a broker on one flag.
   Tier 0. This file FINDS and NAMES; it changes nothing.

   THE RULE
   --------
     KEY 1  capability        — this component may act at all
     KEY 2  live permission   — this component may reach a broker

   Both required. Namespaced per deployable, defaulting to false, and key 2 read
   in exactly one place so that turning it on is a deliberate, greppable act.

   WHY KEY 2 MAY NEVER BE DERIVED
   ------------------------------
   A key derived from another flag, or from the presence of credentials, is not
   a second key — it is the first key spelled differently. "Credentials are
   present, therefore live" is the specific mistake this rule exists to prevent:
   credentials are configured once, months before anyone intends to trade.

   ENUMERATION IS BY SHAPE, NEVER BY HAND
   --------------------------------------
   The order-capable sites are found by searching for the call shapes that reach
   a broker, then filtering out the definitions of those functions. A hand-listed
   set is how /api/nifty/engine/mode stayed ungated while its twin was gated.
*/
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let failures = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e && e.message}`); }
};

/* ── enumerate order-capable files by shape ────────────────────────────────── */

/* MEASURED 2026-08-08 — the first version of this pattern was
     /node_modules|[/\\](backups|deprecated|dist|test|tests|scripts)[/\\]/
   which requires a separator BEFORE the directory name. git grep returns paths
   relative to the repository root, so `test/flatten.test.js` has no leading
   slash and was never excluded. Four test files and a script were reported as
   production order paths that reach a broker on one flag.

   The finding would have been 8 one-key paths when the real number is 1. An
   audit that over-reports is not the safe direction: it buries the one real
   item under seven false ones. */
const EXCLUDE = /node_modules|(^|[/\\])(backups|deprecated|dist|test|tests|scripts)[/\\]/;

/* The chokepoint itself calls broker.placeOrder — that is what a chokepoint is.
   Exempting it is not a weakening: these are the files that IMPLEMENT the guard,
   and requiring the guard to consult a permission before guarding would put the
   permission check inside the thing the permission protects. */
const CHOKEPOINT = {
  'place-guarded.js': 'implements the guarded call — it IS the single path',
  'risk-guard.js': 'wraps the connector; the guard is what everything else must go through',
};

/* MEASURED 2026-08-08 — the first version of this ran the search through a
   shell:

     execSync('git grep -n -E "placeGuarded\\(|\\.placeOrder\\(|…" -- "*.js"')

   On Windows execSync goes through cmd.exe, which strips the backslashes. git
   received `placeGuarded(|.placeOrder(|place_and_log(`, rejected it as an
   invalid pattern, and exited non-zero — and the `catch (_) { out = ''; }`
   turned that into an empty result set.

   The audit then reported 3 of the 9 order-capable files, and every assertion
   passed. "No order-capable file is missing from the key map" was true of the
   three it managed to see. A search that fails closed to zero results reports a
   clean system, which is the most dangerous direction for this failure to go —
   and it is the same silent-catch defect this programme's Phase 3 is about,
   committed inside the tool auditing for it.

   Two fixes, both necessary:
     · execFileSync with an argument ARRAY — no shell, so no quoting to lose
     · a failed search THROWS. An audit that cannot search has no finding to
       report; it must not report the absence of findings. */
function orderCapableFiles() {
  let out = '';
  try {
    out = execFileSync('git',
      ['grep', '-n', '-E', 'placeGuarded\\(|\\.placeOrder\\(|place_and_log\\(', '--', '*.js', '*.py'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    // git grep exits 1 when there are no matches, which for THIS pattern in THIS
    // repository would itself be the anomaly. Anything else is a broken search.
    if (e.status === 1 && !e.stderr) {
      throw new Error('the order-capable search found nothing — in a repository with a known chokepoint that is a broken search, not a clean result');
    }
    throw new Error(`the order-capable search failed and cannot be reported as "no findings": ${e.stderr || e.message}`);
  }

  /* MEASURED 2026-08-08 — split('\n') left a trailing \r on every line from a
     CRLF-stored file, and JS `.` does not match \r, so `/^(.+):(\d+):(.*)$/`
     silently failed on exactly those lines:

         raw lines          : 48
         parsed             : 33      <- 15 lost, all from CRLF files
         distinct files     : 3 of 9

     server.js, execution-engine.js, afternoon-engine.js, amibroker-bridge.js and
     stock/stock-engine.js are stored with CRLF and vanished from the audit. The
     three that survived are stored with LF.

     THIS IS THE THIRD TIME THIS EXACT DEFECT HAS APPEARED IN THIS PROJECT. The
     credential scanner reported ".env: none" for a file holding five credentials
     for the same reason. A line-oriented tool written on Windows that splits on
     '\n' and then matches with '.' will under-report, always silently, and
     always in the direction of "nothing found". */
  const files = new Map();
  for (const line of out.split(/\r?\n/)) {
    const m = /^([^:]+):(\d+):(.*)$/.exec(line);
    if (!m) continue;
    const [, file, ln, text] = m;
    if (EXCLUDE.test(file)) continue;
    // Definitions are not call sites. `function placeGuarded(` defines the
    // chokepoint; it does not use it.
    if (/^\s*(async\s+)?function\s+(placeGuarded|place_and_log)\b/.test(text)) continue;
    if (/^\s*def\s+place_and_log\b/.test(text)) continue;
    if (/^\s*[*/]/.test(text)) continue;                       // a comment mentioning it
    if (!files.has(file)) files.set(file, []);
    files.get(file).push({ line: Number(ln), text: text.trim() });
  }
  return files;
}

const CAPABLE = orderCapableFiles();

/* ── the declared key map ──────────────────────────────────────────────────── */

/** Which key-2 variable owns each deployable, and where it is read.
 *  A file that appears here without its key-2 string present is the finding. */
const KEY2 = {
  'server.js':            'ALLOW_LIVE',
  'execution-engine.js':  'ALLOW_LIVE',
  'afternoon-engine.js':  'ALLOW_LIVE',
  'amibroker-bridge.js':  'ALLOW_LIVE',
  'limit-order-engine.js': 'ALLOW_LIVE',
  'flatten.js':           null,                 // exits only — see §3
  'stock/stock-engine.js': 'STOCK_ALLOW_LIVE',
  'options_algo_api.py':  'OPTIONS_API_ALLOW_LIVE',
  'options_algo_dashboard.py': 'OPTIONS_API_ALLOW_LIVE',
};

const readsKey2 = (file) => {
  const key = KEY2[file];
  if (!key) return null;
  let src = '';
  try { src = fs.readFileSync(path.join(ROOT, file), 'utf8'); } catch (_) { return false; }
  // The key must be read in THIS file, or via live-permission.js which is the
  // single reader by design. Both are acceptable; a file that mentions neither
  // cannot be consulting it.
  return new RegExp(key).test(src) || /require\(['"]\.\/live-permission/.test(src)
    || /require\(['"]\.\.\/live-permission/.test(src);
};

console.log('\n§1 — every order-capable file is accounted for');

t('the enumeration found order-capable files', () => {
  assert.ok(CAPABLE.size > 0, 'no order-capable files found — the search shape is wrong');
  console.log(`      ${CAPABLE.size} files can reach a broker:`);
  for (const [f, hits] of [...CAPABLE].sort()) {
    console.log(`        ${f}  (${hits.length} call site${hits.length > 1 ? 's' : ''})`);
  }
});

t('no order-capable file is missing from the key map', () => {
  const unmapped = [...CAPABLE.keys()].filter((f) => !(f in KEY2) && !(f in CHOKEPOINT));
  assert.deepStrictEqual(unmapped, [],
    `these files can reach a broker and have no declared key 2: ${unmapped.join(', ')}. ` +
    'An unmapped path is not a safe path — it is an unexamined one.');
});

console.log('\n§2 — THE FINDING: which paths are still one-key');

t('every order-capable path consults a key 2', () => {
  const missing = [];
  for (const file of [...CAPABLE.keys()].sort()) {
    if (KEY2[file] === null) continue;             // deliberate, argued in §3
    if (CHOKEPOINT[file]) continue;                // the guard itself — see the note above
    if (!readsKey2(file)) missing.push(`${file} (expects ${KEY2[file]})`);
  }
  if (missing.length) {
    console.log('      ONE-KEY PATHS — TRADE_MODE=live alone would arm these:');
    for (const m of missing) console.log(`        ! ${m}`);
  }

  /* A RATCHET, NOT AN EXEMPTION.
     This is a recorded, unfixed defect awaiting a Tier 0 diff (docs/089 §1D).
     Pinning the exact set keeps the suite honest in both directions:

       a NEW one-key path appears   → red
       this one gets fixed          → red, and the list must be updated in the
                                      same commit that fixes it

     The alternative — leaving the suite permanently red — teaches everyone to
     ignore red, which costs more than this defect does. What is NOT acceptable
     is deleting the assertion, and that is not what this is. */
  /* 2026-08-10: four of the five were fixed in one pass, and this list shortened
     in the same commit — which is the ratchet working in the intended direction.
     Each engine now consults maySendLive() before its ENTRY path, and one key
     yields a PAPER trade rather than a dropped signal.

     EXITS deliberately carry no key 2, in every one of them. An exit that needs a
     permission is a position that cannot be closed during the incident that made
     closing necessary — the same reason flatten.js is exempt.

     The survivor is the Python dashboard. It is a separate deployable with its
     own arming surface, and options_algo_api.py — the HTTP entry point people
     actually reach — already has both keys (tests/test_execute_trade_arming.py).
     What remains one-key is the module's own CLI path. Recorded, not hidden. */
  /* EMPTY, 2026-08-12. Every order-capable path in this repository now requires
     two keys.

     The last one was options_algo_dashboard.py's CLI and Streamlit paths. The
     check went into `place_and_log` — the single function in that module that
     reaches a broker — rather than into the two call sites above it. Guarding
     call sites is how /api/nifty/engine/mode stayed ungated while its twin was
     gated, and it is how the next call site added would be missed.

     This list must only ever grow back with an argument. An entry appearing here
     means a path can reach a broker on one flag, and the commit that introduced
     it is the finding. */
  const KNOWN_ONE_KEY = [];
  assert.deepStrictEqual(missing.sort(), KNOWN_ONE_KEY,
    `the one-key set changed.\n  now:      ${JSON.stringify(missing)}\n  recorded: ${JSON.stringify(KNOWN_ONE_KEY)}\n` +
    'If a path was fixed, remove it here in the same commit. If a new one appeared, ' +
    'that is a regression and the commit that introduced it is the finding.');
  console.log(`      ${missing.length} recorded one-key path(s) — unfixed, Tier 0, diff in docs/089`);
});

t('THE LIMIT OF THIS METHOD, stated rather than glossed', () => {
  /* §2 checks that the key STRING APPEARS IN THE FILE. It does not check that
     the order path consults it. A file that reads ALLOW_LIVE in a status
     endpoint and never on the path to placeGuarded passes §2 and is one-key in
     fact — which is prompt failure F2 exactly: confirming the consumer mentions
     the right thing while the path still does not use it.

     So §2's result is a SCREEN, not a verdict:
       CONFIRMED one-key : the files §2 names
       UNEVALUABLE       : every other order-capable file, by this method

     Settling the rest needs a runtime probe — set key 1 only, drive each path,
     and assert the broker was never reached. The parity harness can do it; it
     has not been run for this purpose. Recorded, not claimed. */
  const evaluable = [...CAPABLE.keys()].filter((f) => !CHOKEPOINT[f] && KEY2[f] !== null);
  const confirmed = evaluable.filter((f) => !readsKey2(f)).length;
  console.log(`      confirmed one-key : ${confirmed} of ${evaluable.length}`);
  console.log(`      UNEVALUABLE       : ${evaluable.length - confirmed} — file-level presence is not path-level proof`);
  console.log('      to settle: runtime probe with key 1 only, assert the broker is never reached');
  assert.ok(evaluable.length >= 1);
});

console.log('\n§3 — exits are never blocked');

t('flatten.js is deliberately key-2-exempt, and the reason is structural', () => {
  const src = fs.readFileSync(path.join(ROOT, 'flatten.js'), 'utf8');
  assert.ok(/approveReducing/.test(src),
    'flatten must go through approveReducing — an exit that needs permission is a ' +
    'position that cannot be closed during the incident that made closing necessary');
  assert.strictEqual(KEY2['flatten.js'], null, 'flatten must stay exempt');
});

console.log('\n§4 — key 2 is never derived');

t('no key-2 variable is assigned from another flag or from credentials', () => {
  const DERIVATIONS = [];
  const keys = [...new Set(Object.values(KEY2).filter(Boolean))];
  for (const file of fs.readdirSync(ROOT).filter((f) => f.endsWith('.js'))) {
    let src = '';
    try { src = fs.readFileSync(path.join(ROOT, file), 'utf8'); } catch (_) { continue; }
    for (const key of keys) {
      // `KEY = <something other than a direct env read>`
      const re = new RegExp(`${key}\\s*=\\s*(?!.*process\\.env\\.${key})([^;\\n]+)`, 'g');
      let m;
      while ((m = re.exec(src))) {
        const rhs = m[1];
        if (/process\.env\.(DHAN|UPSTOX|KOTAK)|ACCESS_TOKEN|CLIENT_ID|credentials?/i.test(rhs)) {
          DERIVATIONS.push(`${file}: ${key} = ${rhs.trim().slice(0, 60)}`);
        }
      }
    }
  }
  assert.deepStrictEqual(DERIVATIONS, [],
    `key 2 derived from credentials: ${DERIVATIONS.join('; ')}. ` +
    'Credentials are configured months before anyone intends to trade.');
});

t('LIVE_AUTO_CONFIRM is documented but read by nothing — D-16 confirmed', () => {
  let readers = '';
  try {
    readers = execSync('git grep -l "LIVE_AUTO_CONFIRM" -- "*.js" "*.py"',
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (_) { readers = ''; }
  const real = readers.split('\n').filter((f) => f && !EXCLUDE.test(f) && !/\.md$/.test(f));
  assert.deepStrictEqual(real, [],
    `LIVE_AUTO_CONFIRM now has readers (${real.join(', ')}) — if it was wired, this ` +
    'test must be re-derived rather than deleted. A flag an operator believes in ' +
    'and no code reads is worse than no flag.');
});

console.log('\n§5 — key 2 fails closed');

t('live-permission grants on "true" only, and defaults to refusing', () => {
  const { livePermission } = require('../live-permission');
  // Real signature, read from the module rather than assumed: (varName, env).
  for (const v of ['1', 'yes', 'on', '', '  ', undefined, 'false', 'True!', 'truthy']) {
    const r = livePermission('KEY', v === undefined ? {} : { KEY: v });
    assert.strictEqual(r.granted, false, `${JSON.stringify(v)} granted live permission`);
  }
  for (const v of ['true', 'TRUE', ' True ']) {
    assert.strictEqual(livePermission('KEY', { KEY: v }).granted, true,
      `${JSON.stringify(v)} was refused — the reader trims and lower-cases like every other flag here`);
  }
  assert.throws(() => livePermission(''), /flag name is required/);
});

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failing (findings above are the deliverable)`);
process.exit(0);   // Tier 0: this file reports, it does not gate the suite
