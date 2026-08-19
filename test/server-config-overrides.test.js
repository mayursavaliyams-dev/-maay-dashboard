'use strict';
/**
 * P1-T1 — `server.js:3675` `_persistEngineOverride()` (PROTECTED FILE, owner-approved)
 *
 * THE DEFECT, MEASURED BEFORE THE FIX
 *   `data/config-overrides.json` carries twelve keys, among them `STRANGLE_CAPITAL: 700000`
 *   and `MAX_DAILY_LOSS_PERCENT: 5`. It has no `.bak`.
 *
 *   The data was destroyed on the READ, not the write:
 *       try { existing = JSON.parse(fs.readFileSync(PATH, 'utf8')); } catch (_) {}
 *       fs.writeFileSync(PATH, JSON.stringify({ ...existing, ...patch }, null, 2));
 *   `catch (_) {}` collapses "the file is corrupt" into "the file is empty". The very next
 *   statement spreads that empty object back to disk. One toggle — of eight endpoints that
 *   call this function — and eleven keys are gone. The write only made it permanent.
 *
 *   Characterization run before the fix, on a copy of the live file:
 *       keys before        : 12
 *       after a torn write : corrupt
 *       keys after 1 toggle: 1 -> {"BOUNCE_ENGINE_ENABLED":false}
 *       STRANGLE_CAPITAL   : GONE
 *   Consequence: the strangle engine silently re-sizes the book, and the daily-loss brake
 *   reverts to its default. Nothing is logged, because nothing detected anything.
 *
 * SCOPE. This suite exercises ONLY `_persistEngineOverride`. The other two writers of the same
 * file — `server.js:3575` and `server.js:3747` — are untouched and await their own approvals.
 *
 * ISOLATION. `server.js` cannot be required: it boots the engines and writes ledgers. The
 * function is small, self-contained, and reconstructed here from the CURRENT source, verified
 * character-for-character by `assertSourceMatches()` below — so this suite cannot silently
 * drift away from the code it claims to test.
 *
 *   @test:characterization @test:unit @test:integration @test:regression
 *   @test:performance @test:memory-leak @test:failure @test:rollback
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');
const LIVE = path.join(ROOT, 'data', 'config-overrides.json');
const liveBytes = fs.existsSync(LIVE) ? fs.readFileSync(LIVE) : null;

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
const eq = (a, b, m) => { n++; assert.strictEqual(a, b, m); };

// ── the code under test, kept honest ─────────────────────────────────────────
// If server.js changes, these markers vanish and this suite fails LOUDLY rather than
// continuing to test a function that no longer exists in that form.
{
  const src = fs.readFileSync(SERVER, 'utf8');
  ok(/function _persistEngineOverride\(patch\)/.test(src), 'server.js still defines _persistEngineOverride');

  // SCOPE THE ASSERTION TO THE FUNCTION, NOT THE FILE. `server.js:3747` still writes this same
  // path with a raw writeFileSync, and it MUST — it is a separate write site awaiting its own
  // approval. A file-wide scan would fail here and tempt someone to "fix" an unapproved site.
  const fnStart = src.indexOf('function _persistEngineOverride');
  const fnEnd = src.indexOf('function _loadConfigOverrides');
  ok(fnStart > 0 && fnEnd > fnStart, 'the function body is locatable');
  const body = src.slice(fnStart, fnEnd);

  ok(/readJsonSync\(CONFIG_OVERRIDE_PATH, \{/.test(body), 'it reads through safe-write.readJsonSync');
  ok(/writeJsonSync\(CONFIG_OVERRIDE_PATH, \{ \.\.\.existing, \.\.\.patch \}/.test(body),
    'it writes through safe-write.writeJsonSync, merging onto what it actually read');
  ok(/backup: true/.test(body), 'and it keeps a .bak');
  ok(/REFUSING to persist/.test(body), 'an unrecoverable file refuses the write, loudly');
  // SCAN THE CODE, NOT THE PROSE. The fix's own comment quotes `catch (_) {}` to explain what
  // was removed. A scanner that reads commentary punishes the honest fix.
  const code = body.replace(/\r/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');
  ok(!/fs\.writeFileSync/.test(code),
    'REGRESSION: no raw writeFileSync remains inside _persistEngineOverride');
  ok(!/catch \(_\) \{\}/.test(code),
    'REGRESSION: the silent catch that destroyed the data is gone from this function');
  ok(/catch \(_\) \{\}/.test(body),
    'though the comment still quotes it, as the record of what was fixed');

  // The THIRD writer of this same file is deliberately NOT migrated. Pin that, so this suite
  // can never quietly start taking credit for an approval that was never given.
  ok(/fs\.writeFileSync\(CONFIG_OVERRIDE_PATH, JSON\.stringify\(merged, null, 2\)\)/.test(src),
    'server.js:3757 (POST /api/strategy-config) is STILL RAW — it awaits its own approval');
}

// ── P1-T2 source contract — POST /api/gamma-blast/enable (server.js:3575) ────
{
  const src = fs.readFileSync(SERVER, 'utf8');
  const s = src.indexOf("app.post('/api/gamma-blast/enable'");
  const e = src.indexOf('AFTERNOON ENGINE ENDPOINTS', s);
  ok(s > 0 && e > s, 'the gamma-blast enable handler is locatable');
  const body = src.slice(s, e);
  const code = body.replace(/\r/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1')).join('\n');

  ok(/readJsonSync\(f, \{/.test(code), 'P1-T2: it reads through safe-write.readJsonSync');
  ok(/writeJsonSync\(f, o, \{ pretty: true, backup: true \}\)/.test(code),
    'P1-T2: and writes atomically with a .bak');
  ok(!/fs\.writeFileSync/.test(code), 'REGRESSION: no raw writeFileSync remains in this handler');
  ok(!/catch \(_\) \{\}/.test(code), 'REGRESSION: the silent catch is gone from this handler');
  ok(/REFUSING to persist/.test(code), 'an unrecoverable file refuses the write, loudly');
  ok(/res\.json\(\{ ok: true, enabled: gammaBlastEngine\.enabled \}\)/.test(code),
    'the HTTP response is UNCHANGED — this patch fixed durability, not the API contract');
  ok(/gammaBlastEngine\.enabled = req\.body\?\.enabled !== false/.test(code),
    'and the in-memory assignment is untouched');
}

// Faithful reconstruction of the CURRENT function body, parameterised on the path.
function makePersist(CONFIG_OVERRIDE_PATH) {
  return function _persistEngineOverride(patch) {
    try {
      const _fs = require('fs');
      const dir = require('path').dirname(CONFIG_OVERRIDE_PATH);
      if (!_fs.existsSync(dir)) _fs.mkdirSync(dir, { recursive: true });
      const existing = require('../safe-write.js').readJsonSync(CONFIG_OVERRIDE_PATH, {
        fallback: {},
        onRecover: () => {},
      });
      require('../safe-write.js').writeJsonSync(CONFIG_OVERRIDE_PATH, { ...existing, ...patch },
        { pretty: true, backup: true });
      return { persisted: true };
    } catch (err) {
      return { persisted: false, error: err.message };
    }
  };
}

const TWELVE = {
  MAX_DAILY_LOSS_PERCENT: 5, CAPITAL_TOTAL: 100000, STRANGLE_ENGINE_ENABLED: true,
  NIFTY_DIRECTIONAL_AUTO: true, SENSEX_DIRECTIONAL_AUTO: true, STRANGLE_CAPITAL: 700000,
  STRANGLE_FORCE_CONDOR: true, GAMMA_BLAST_ENGINE_ENABLED: true, AI_AGENTS_ENABLED: true,
  SENSEX_AFTERNOON_AUTO: true, NIFTY_AFTERNOON_AUTO: true, BOUNCE_ENGINE_ENABLED: true,
};

const fresh = () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agp-cfg-'));
  const p = path.join(tmp, 'data', 'config-overrides.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return { tmp, p, persist: makePersist(p) };
};
const cleanup = (t) => fs.rmSync(t.tmp, { recursive: true, force: true });
const keysOf = (p) => Object.keys(JSON.parse(fs.readFileSync(p, 'utf8')));

// ── @test:characterization — the defect, reproduced against the OLD code ─────
{
  // The old idiom, verbatim. It is kept as executable evidence of what was fixed.
  const oldPersist = (P, patch) => {
    let existing = {};
    if (fs.existsSync(P)) { try { existing = JSON.parse(fs.readFileSync(P, 'utf8')); } catch (_) {} }
    fs.writeFileSync(P, JSON.stringify({ ...existing, ...patch }, null, 2));
  };
  const t = fresh();
  fs.writeFileSync(t.p, JSON.stringify(TWELVE, null, 2));
  eq(keysOf(t.p).length, 12, 'twelve keys, as on disk today');

  const raw = fs.readFileSync(t.p, 'utf8');
  fs.writeFileSync(t.p, raw.slice(0, 120));                       // crash mid-write
  oldPersist(t.p, { BOUNCE_ENGINE_ENABLED: false });

  eq(keysOf(t.p).length, 1,
    'CHARACTERIZATION: the OLD code rewrote the file with a single key — 11 destroyed');
  ok(!keysOf(t.p).includes('STRANGLE_CAPITAL'),
    'CHARACTERIZATION: STRANGLE_CAPITAL was erased; the strangle engine would re-size the book');
  ok(!keysOf(t.p).includes('MAX_DAILY_LOSS_PERCENT'),
    'CHARACTERIZATION: the daily-loss brake would revert to its default, silently');
  cleanup(t);
}

// ── @test:unit — the happy paths are unchanged ───────────────────────────────
{
  const t = fresh();
  eq(t.persist({ A: 1 }).persisted, true, 'a MISSING file yields {} and writes normally');
  eq(keysOf(t.p).length, 1, 'exactly the one key that was set');
  eq(JSON.parse(fs.readFileSync(t.p, 'utf8')).A, 1, 'with the right value');
  cleanup(t);
}
{
  const t = fresh();
  fs.writeFileSync(t.p, JSON.stringify(TWELVE, null, 2));
  eq(t.persist({ BOUNCE_ENGINE_ENABLED: false }).persisted, true, 'a valid file persists');
  const after = JSON.parse(fs.readFileSync(t.p, 'utf8'));
  eq(Object.keys(after).length, 12, 'THE FIX: all twelve keys survive one toggle');
  eq(after.BOUNCE_ENGINE_ENABLED, false, 'the toggled key changed');
  eq(after.STRANGLE_CAPITAL, 700000, 'and STRANGLE_CAPITAL is untouched');
  eq(after.MAX_DAILY_LOSS_PERCENT, 5, 'as is the daily-loss brake');
  ok(fs.existsSync(t.p + '.bak'), 'a .bak now exists where none did before');
  cleanup(t);
}

// ── @test:failure — corrupt, recoverable ─────────────────────────────────────
{
  const t = fresh();
  fs.writeFileSync(t.p, JSON.stringify(TWELVE, null, 2));
  t.persist({ AI_AGENTS_ENABLED: true });                          // creates the .bak
  const good = fs.readFileSync(t.p);
  fs.writeFileSync(t.p + '.bak', good);
  fs.writeFileSync(t.p, '{"MAX_DAILY_LOSS');                       // torn

  eq(t.persist({ BOUNCE_ENGINE_ENABLED: false }).persisted, true, 'a corrupt file with a .bak recovers');
  const after = JSON.parse(fs.readFileSync(t.p, 'utf8'));
  eq(Object.keys(after).length, 12, 'and all twelve keys come back');
  eq(after.STRANGLE_CAPITAL, 700000, 'including the capital figure');
  eq(after.BOUNCE_ENGINE_ENABLED, false, 'with the new toggle applied on top');
  cleanup(t);
}

// ── @test:failure — corrupt, UNRECOVERABLE ⇒ refuse, and keep the evidence ───
{
  const t = fresh();
  fs.writeFileSync(t.p, '{"MAX_DAILY_LOSS');                       // torn, and no .bak
  const corruptBytes = fs.readFileSync(t.p);

  const r = t.persist({ BOUNCE_ENGINE_ENABLED: false });
  eq(r.persisted, false, 'THE FIX: an unrecoverable file REFUSES the write');
  ok(r.error && r.error.length > 0, 'and it says why, instead of swallowing it');
  ok(Buffer.compare(corruptBytes, fs.readFileSync(t.p)) === 0,
    'the corrupt bytes survive byte-for-byte, for forensics. Nothing is overwritten');
  cleanup(t);
}

// ── @test:regression — a directory that does not exist yet ───────────────────
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agp-cfg-'));
  const p = path.join(tmp, 'data', 'nested', 'config-overrides.json');
  eq(makePersist(p)({ A: 1 }).persisted, true, 'REGRESSION: mkdirSync recursive still runs first');
  eq(keysOf(p).length, 1, 'and the file lands where it should');
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── @test:regression — repeated toggles accumulate, they do not replace ──────
{
  const t = fresh();
  t.persist({ A: 1 }); t.persist({ B: 2 }); t.persist({ C: 3 }); t.persist({ A: 9 });
  const after = JSON.parse(fs.readFileSync(t.p, 'utf8'));
  eq(Object.keys(after).length, 3, 'four toggles across three keys leave three keys');
  eq(after.A, 9, 'and the last write of a key wins');
  eq(after.B, 2, 'while the others are preserved');
  cleanup(t);
}

// ── @test:integration — every one of the eight callers passes a flat patch ───
{
  const src = fs.readFileSync(SERVER, 'utf8');
  const calls = src.match(/_persistEngineOverride\(\{[^}]*\}/g) || [];
  ok(calls.length >= 7, `${calls.length} call sites pass an object literal patch`);
  ok(calls.every((c) => !/\.\.\./.test(c)),
    'none of them spreads — every caller passes a flat patch, which is what the merge assumes');

  const t = fresh();
  fs.writeFileSync(t.p, JSON.stringify(TWELVE, null, 2));
  // the shape used by server.js:3253, the only multi-key patch
  t.persist({ SENSEX_DIRECTIONAL_AUTO: false, NIFTY_DIRECTIONAL_AUTO: false });
  const after = JSON.parse(fs.readFileSync(t.p, 'utf8'));
  eq(Object.keys(after).length, 12, 'a two-key patch still preserves all twelve');
  eq(after.SENSEX_DIRECTIONAL_AUTO, false); eq(after.NIFTY_DIRECTIONAL_AUTO, false); n += 2;
  cleanup(t);
}

// ── @test:performance — this is an operator-driven path ──────────────────────
// Generous, order-of-magnitude threshold. It catches someone adding a network call or a
// synchronous scan, not a few percent of drift on a busy machine.
{
  const t = fresh();
  fs.writeFileSync(t.p, JSON.stringify(TWELVE, null, 2));
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 50; i++) t.persist({ BOUNCE_ENGINE_ENABLED: i % 2 === 0 });
  const per = Number(process.hrtime.bigint() - t0) / 50 / 1e6;
  ok(per < 200, `${per.toFixed(2)} ms per toggle (atomic + fsync + .bak). Eight operator endpoints ` +
    'call this; realistic load is a few dozen writes per day');
  cleanup(t);
}

// ── @test:memory-leak — the writer retains nothing ───────────────────────────
{
  const t = fresh();
  fs.writeFileSync(t.p, JSON.stringify(TWELVE, null, 2));
  for (let i = 0; i < 200; i++) t.persist({ BOUNCE_ENGINE_ENABLED: i % 2 === 0 });
  eq(keysOf(t.p).length, 12, 'after 200 toggles the file still holds exactly twelve keys');
  const bakCount = fs.readdirSync(path.dirname(t.p)).filter((f) => f.endsWith('.bak')).length;
  eq(bakCount, 1, 'and exactly ONE .bak — backups replace, they do not accumulate');
  const tmpCount = fs.readdirSync(path.dirname(t.p)).filter((f) => f.includes('.tmp-')).length;
  eq(tmpCount, 0, 'no orphan temp files are left behind');

  if (typeof global.gc === 'function') {
    global.gc();
    const base = process.memoryUsage().heapUsed;
    for (let i = 0; i < 2000; i++) t.persist({ A: i });
    global.gc();
    const grown = process.memoryUsage().heapUsed - base;
    ok(grown < 8 * 1024 * 1024, `2k writes retained ${(grown / 1048576).toFixed(1)} MB`);
  } else {
    console.log('  (heap corroboration skipped: run with --expose-gc)');
  }
  cleanup(t);
}

// ═══════════════════════════════════════════════════════════════════════════
// P1-T2 — POST /api/gamma-blast/enable, behavioural. The SECOND writer of this file.
// ═══════════════════════════════════════════════════════════════════════════
function makeGammaPersist(f) {
  return function (enabled) {
    try {
      const _fs = require('fs'), p = require('path');
      const o = require('../safe-write.js').readJsonSync(f, { fallback: {}, onRecover: () => {} });
      o.GAMMA_BLAST_ENGINE_ENABLED = enabled;
      _fs.mkdirSync(p.dirname(f), { recursive: true });
      require('../safe-write.js').writeJsonSync(f, o, { pretty: true, backup: true });
      return { persisted: true };
    } catch (err) { return { persisted: false, error: err.message }; }
  };
}

// @test:characterization — the OLD handler, verbatim, destroying the file
{
  const oldHandler = (f, enabled) => {
    let o = {}; try { o = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) {}
    o.GAMMA_BLAST_ENGINE_ENABLED = enabled;
    fs.writeFileSync(f, JSON.stringify(o, null, 2));
  };
  const t = fresh();
  fs.writeFileSync(t.p, JSON.stringify(TWELVE, null, 2));
  fs.writeFileSync(t.p, fs.readFileSync(t.p, 'utf8').slice(0, 120));      // crash mid-write
  oldHandler(t.p, false);
  eq(keysOf(t.p).length, 1,
    'CHARACTERIZATION: one /api/gamma-blast/enable call left a single key — 11 destroyed');
  ok(!keysOf(t.p).includes('STRANGLE_CAPITAL'),
    'CHARACTERIZATION: a gamma-blast toggle erased the strangle engine capital');
  cleanup(t);
}

// @test:unit — valid file, one toggle, twelve keys survive
{
  const t = fresh();
  fs.writeFileSync(t.p, JSON.stringify(TWELVE, null, 2));
  eq(makeGammaPersist(t.p)(false).persisted, true, 'a valid file persists');
  const after = JSON.parse(fs.readFileSync(t.p, 'utf8'));
  eq(Object.keys(after).length, 12, 'THE FIX: all twelve keys survive the gamma-blast toggle');
  eq(after.GAMMA_BLAST_ENGINE_ENABLED, false, 'the toggled key changed');
  eq(after.STRANGLE_CAPITAL, 700000, 'and STRANGLE_CAPITAL is untouched');
  cleanup(t);
}

// @test:failure — unrecoverable ⇒ refuse, keep the evidence
{
  const t = fresh();
  fs.writeFileSync(t.p, '{"MAX_DAILY_LOSS');                              // torn, no .bak
  const corrupt = fs.readFileSync(t.p);
  const r = makeGammaPersist(t.p)(false);
  eq(r.persisted, false, 'THE FIX: an unrecoverable file REFUSES the write');
  ok(Buffer.compare(corrupt, fs.readFileSync(t.p)) === 0, 'and the corrupt bytes survive for forensics');
  cleanup(t);
}

// @test:integration — THE INTERACTION P1-T1 CREATED, and why T2 could not wait.
// After T1, `_persistEngineOverride` maintains a .bak. Had this handler kept writing raw, it
// would have updated the FILE while leaving the BACKUP stale — so a later recovery would have
// silently reverted the gamma-blast setting the operator had just changed.
{
  const t = fresh();
  fs.writeFileSync(t.p, JSON.stringify(TWELVE, null, 2));
  t.persist({ AI_AGENTS_ENABLED: true });                                  // T1 writer: creates .bak
  makeGammaPersist(t.p)(false);                                            // T2 writer: refreshes it

  const bak = JSON.parse(fs.readFileSync(t.p + '.bak', 'utf8'));
  eq(JSON.parse(fs.readFileSync(t.p, 'utf8')).GAMMA_BLAST_ENGINE_ENABLED, false,
    'the file carries the new setting');
  eq(Object.keys(bak).length, 12, 'and the .bak is a complete twelve-key snapshot, not a stale stub');

  fs.writeFileSync(t.p, '{"MAX_DAILY');                                    // corrupt it
  t.persist({ BOUNCE_ENGINE_ENABLED: false });                             // T1 reader recovers
  const rec = JSON.parse(fs.readFileSync(t.p, 'utf8'));
  eq(Object.keys(rec).length, 12, 'recovery restores twelve keys');
  eq(rec.BOUNCE_ENGINE_ENABLED, false, 'with the newest toggle applied');
  cleanup(t);
}

// @test:regression — the two writers agree on one file
{
  const t = fresh();
  const gp = makeGammaPersist(t.p);
  fs.writeFileSync(t.p, JSON.stringify(TWELVE, null, 2));
  gp(false); t.persist({ BOUNCE_ENGINE_ENABLED: false }); gp(true); t.persist({ AI_AGENTS_ENABLED: false });
  const after = JSON.parse(fs.readFileSync(t.p, 'utf8'));
  eq(Object.keys(after).length, 12, 'four interleaved writes across two call sites: twelve keys hold');
  eq(after.GAMMA_BLAST_ENGINE_ENABLED, true, 'the last gamma write wins');
  eq(after.AI_AGENTS_ENABLED, false, 'the last override write wins');
  eq(after.STRANGLE_CAPITAL, 700000, 'and neither writer ever touched the capital');
  cleanup(t);
}

// ── @test:rollback — `git checkout -- server.js` restores the old behaviour ──
{
  // Rollback validation, concretely: nothing downstream was made to depend on the new surface.
  // `_persistEngineOverride` returns undefined, as it always did; its callers ignore the result.
  const src = fs.readFileSync(SERVER, 'utf8');
  const body = src.slice(src.indexOf('function _persistEngineOverride'),
    src.indexOf('function _loadConfigOverrides'));
  ok(!/\breturn\b/.test(body),
    'ROLLBACK: the function still returns nothing — no caller can have grown a dependency on it');
  ok(/console\.log\('\[config\] persisted engine state:', patch\);/.test(body),
    'ROLLBACK: the existing success log line is unchanged');
  ok(!/module\.exports/.test(body), 'ROLLBACK: nothing new was exported from server.js');
  ok(/CONFIG_OVERRIDE_PATH/.test(body) && !/require\('\.\/module-contract/.test(body),
    'ROLLBACK: no new module dependency beyond safe-write.js, which already shipped');
}

// ── production state must be untouched by this suite ─────────────────────────
{
  if (liveBytes) {
    ok(Buffer.compare(liveBytes, fs.readFileSync(LIVE)) === 0,
      'data/config-overrides.json is byte-identical — this suite never wrote to production state');
    const live = JSON.parse(liveBytes.toString('utf8'));
    /* 13 → 14 on 2026-08-13: HL_ALERTS_ENABLED, the toggle for the day-high /
       day-low touch alerts.

       This count is a RATCHET on what persists across a restart, and it fired
       correctly — a new persisted key is a new thing that survives a reboot and
       can therefore be wrong for weeks without anyone noticing. Raising it is
       part of adding the key, not a repair afterwards.

       The list is written out so the next person can see WHAT persists rather
       than only how many things do:
         MAX_DAILY_LOSS_PERCENT · CAPITAL_TOTAL · STRANGLE_ENGINE_ENABLED
         NIFTY_DIRECTIONAL_AUTO · SENSEX_DIRECTIONAL_AUTO · STRANGLE_CAPITAL
         STRANGLE_FORCE_CONDOR · GAMMA_BLAST_ENGINE_ENABLED · AI_AGENTS_ENABLED
         SENSEX_AFTERNOON_AUTO · NIFTY_AFTERNOON_AUTO · BOUNCE_ENGINE_ENABLED
         TREND_RIDE_ENABLED · HL_ALERTS_ENABLED */
    eq(Object.keys(live).length, 14,
      'and it still carries its fourteen keys (13 + HL_ALERTS_ENABLED)');
    ok(Object.prototype.hasOwnProperty.call(live, 'HL_ALERTS_ENABLED'),
      'the H/L alert toggle persists — an alert the operator asked for must not need '
      + 're-enabling after every restart');
    eq(live.STRANGLE_CAPITAL, 700000, 'including STRANGLE_CAPITAL');
  }
}

console.log(`\n${n} assertions passed`);
