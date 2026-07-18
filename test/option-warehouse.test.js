'use strict';
/**
 * CONTRACT tests for option-warehouse.js — the immutable rescue mirror.
 * Design: docs/H19-HISTORICAL-OPTION-DATA-WAREHOUSE.md. New module → contract tests.
 *
 * @test:characterization @test:unit @test:integration @test:regression
 * @test:failure @test:performance @test:memory-leak @test:rollback
 *
 * Isolation: WAREHOUSE_ROOT redirects ALL warehouse WRITES into a throwaway temp dir;
 * the real data/opt-candles + data/opthl are only ever READ. Nothing in the repo's
 * data/ is written or deleted by this suite.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-test-'));
process.env.WAREHOUSE_ROOT = TMP;                 // MUST be set before require
const wh = require('../option-warehouse.js');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
const eq = (a, b, m) => { n++; assert.strictEqual(a, b, m); };

const B = (s) => Buffer.from(s);
const destOf = (kind, date) => path.join(TMP, 'data', 'warehouse', 'L0_mirror', kind, `${date}.json`);

// ── @test:unit / @test:characterization — first write CREATES + seals a hash ──────
{
  const r = wh.mirrorOne('opt-candles', '1970-01-01', B('{"a":1}'));
  eq(r.status, 'created', 'first sight of a (kind,date) → created');
  ok(fs.existsSync(destOf('opt-candles', '1970-01-01')), 'the mirrored file exists');
  ok(fs.existsSync(destOf('opt-candles', '1970-01-01') + '.sha256'), 'a sha256 sidecar is written (immutability seal)');
  eq(fs.readFileSync(destOf('opt-candles', '1970-01-01'), 'utf8'), '{"a":1}', 'stored bytes are VERBATIM — no transformation, no invention');
}

// ── @test:unit — identical bytes are idempotent (no rewrite) ──────────────────────
{
  const r = wh.mirrorOne('opt-candles', '1970-01-01', B('{"a":1}'));
  eq(r.status, 'unchanged', 're-mirroring identical content is a no-op');
}

// ── @test:unit — a larger/different snapshot GROWS the record ─────────────────────
{
  const r = wh.mirrorOne('opt-candles', '1970-01-01', B('{"a":1,"b":2,"c":3}'));
  eq(r.status, 'grown', 'a more-complete snapshot completes the record');
  eq(fs.readFileSync(destOf('opt-candles', '1970-01-01'), 'utf8'), '{"a":1,"b":2,"c":3}', 'the fuller content is now stored');
}

// ── @test:regression — the CORE rule: a SMALLER source never overwrites the larger ─
{
  const before = fs.readFileSync(destOf('opt-candles', '1970-01-01'), 'utf8');
  const r = wh.mirrorOne('opt-candles', '1970-01-01', B('{"a":1}'));   // shorter than stored
  eq(r.status, 'ignored_smaller', 'a smaller source is refused as the primary copy');
  eq(fs.readFileSync(destOf('opt-candles', '1970-01-01'), 'utf8'), before, 'the larger stored copy is UNTOUCHED — never shrunk (never lose data)');
  const shrunkFiles = fs.readdirSync(path.dirname(destOf('opt-candles', '1970-01-01'))).filter(f => f.includes('.shrunk.'));
  ok(shrunkFiles.length >= 1, 'the smaller snapshot is preserved as a flagged .shrunk sidecar, not discarded');
}

// ── @test:failure — bad input fails CLOSED to an error status, never a silent write ─
{
  const r = wh.mirrorOne('opt-candles', '1970-01-02', 12345);   // not string/Buffer → safe-write throws
  eq(r.status, 'error', 'invalid bytes → error status (fail closed), not a corrupt file');
  ok(!fs.existsSync(destOf('opt-candles', '1970-01-02')), 'no partial/corrupt file is left behind');
}

// ── @test:integration — mirrorAll READS real source dirs, WRITES only to temp ─────
// Clone-safe: data/opt-candles + data/opthl are NOT git-tracked, so a fresh checkout
// may have zero source files. The contract asserted here is accounting integrity, not
// the presence of real data.
{
  const s = wh.mirrorAll();
  ok(typeof s.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.today), 'summary carries an IST trading day');
  eq(s.created + s.grown + s.unchanged + s.ignored_smaller + s.error, s.files,
     'every processed file is accounted for in exactly one status bucket (no silent drops)');
  if (s.files > 0) ok(fs.existsSync(wh.LOG_FILE), 'when files are mirrored, an append-only audit log exists');
}

// ── @test:performance — a ~1 MB snapshot mirrors well under a frame budget ────────
{
  const big = B(JSON.stringify({ x: 'y'.repeat(1_000_000) }));
  const t0 = process.hrtime.bigint();
  wh.mirrorOne('opt-candles', '1970-02-01', big);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok(ms < 250, `1 MB mirror took ${ms.toFixed(1)}ms (< 250ms budget)`);
}

// ── @test:memory-leak — repeated identical mirrors do not grow the store ──────────
{
  const dir = path.dirname(destOf('opt-candles', '1970-01-01'));
  const countBefore = fs.readdirSync(dir).length;
  for (let i = 0; i < 100; i++) wh.mirrorOne('opt-candles', '1970-01-01', B('{"a":1,"b":2,"c":3}'));
  const countAfter = fs.readdirSync(dir).length;
  eq(countAfter, countBefore, '100 idempotent mirrors add zero files — bounded');
}

// ── @test:rollback — the mirror is additive: removing it never touches the source ─
{
  const srcDir = wh.SRC['opt-candles'];
  const srcReadableBefore = fs.existsSync(srcDir);
  fs.rmSync(path.join(TMP, 'data', 'warehouse'), { recursive: true, force: true });   // nuke the whole warehouse
  const srcReadableAfter = fs.existsSync(srcDir);
  eq(srcReadableAfter, srcReadableBefore, 'deleting the entire warehouse leaves the source of truth intact (fully reversible)');
}

// cleanup temp
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}

console.log(`\n${n} assertions passed`);
