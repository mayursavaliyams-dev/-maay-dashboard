'use strict';
/**
 * CONTRACT tests for warehouse-derive.js — the day-by-day H/L record derivation.
 * Design: docs/H19. New module → contract tests.
 *
 * @test:characterization @test:unit @test:integration @test:regression
 * @test:failure @test:performance @test:memory-leak @test:rollback
 *
 * Isolation: WAREHOUSE_ROOT redirects the warehouse root into a temp dir (set BEFORE
 * require), so the derivation reads a SEEDED mirror and writes only to temp.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-derive-'));
process.env.WAREHOUSE_ROOT = TMP;
const der = require('../warehouse-derive.js');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); };
const eq = (a, b, m) => { n++; assert.strictEqual(a, b, m); };

// ── @test:unit / @test:characterization — a new extreme is the first minute it moves ─
{
  const bars = [
    [60000, 10, 12, 9, 11],
    [120000, 11, 15, 11, 14],
    [180000, 14, 13, 10, 12],
  ];
  const d = der.deriveStrike(bars);
  eq(d.highRecord.length, 2, 'two new-high prints (12 then 15)');
  eq(d.highRecord[0].price, 12, 'first high print is the opening bar high');
  eq(d.highRecord[1].price, 15, 'second high print is the new session max');
  eq(d.lowRecord.length, 1, 'one new-low print (9) — never beaten');
  eq(d.high.price, 15, 'session high = last high print');
  eq(d.low.price, 9, 'session low = 9');
  eq(d.opening, 10, 'opening = first bar open');
  eq(d.closing, 12, 'closing = last bar close');
  eq(d.maxExpansion, 6, 'max expansion = 15 - 9');
  ok(/^\d{2}:\d{2}:\d{2}$/.test(d.high.time), 'prints carry an IST HH:MM:SS time');
}

// ── @test:regression — a strictly decaying strike records highs only at the open ──
{
  const d = der.deriveStrike([[60000, 20, 20, 18, 19], [120000, 19, 18, 15, 16], [180000, 16, 16, 12, 13]]);
  eq(d.highRecord.length, 1, 'no new highs after the open when premium only decays');
  eq(d.lowRecord.length, 3, 'each lower low is a new-low print (18→15→12)');
  eq(d.low.price, 12, 'final low is the session min');
}

// ── @test:failure — empty / malformed input returns null, never throws ────────────
{
  eq(der.deriveStrike([]), null, 'no bars → null (not a fabricated record)');
  eq(der.deriveStrike(null), null, 'null bars → null');
  const day = der.deriveDay({ date: '2020-01-01', series: { 'X|1|CE': 'garbage', 'Y|2|PE': [[1, 1, 2, 1, 1]] } });
  eq(day.strikeCount, 1, 'a garbage strike is skipped; the valid one is still derived');
}

// ── @test:integration — deriveAll reads the mirror, writes one file per day ────────
{
  const mirrorDir = der.CANDLES_SRC;
  fs.mkdirSync(mirrorDir, { recursive: true });
  const doc = { date: '2026-07-06', savedAt: 1, series: {
    'NIFTY|24400|CE': [[100000, 60, 65, 58, 63], [160000, 63, 70, 62, 68]],
    'NIFTY|24400|PE': [[100000, 40, 42, 39, 41]],
  } };
  fs.writeFileSync(path.join(mirrorDir, '2026-07-06.json'), JSON.stringify(doc));

  const s = der.deriveAll();
  eq(s.written, 1, 'one day derived');
  const outFile = path.join(der.OUT_DIR, '2026-07-06.json');
  ok(fs.existsSync(outFile), 'a per-day H/L record file is written');
  const out = JSON.parse(fs.readFileSync(outFile, 'utf8'));
  eq(out.strikeCount, 2, 'both strikes derived');
  eq(out.engine, der.ENGINE, 'the derivation engine version is stamped (reproducibility)');
  ok(out.source && out.source.sha256, 'the source-candle hash is recorded (rebuildable-from-raw)');
  eq(out.strikes['NIFTY|24400|CE'].high.price, 70, 'CE session high derived correctly');
}

// ── @test:regression — idempotent: same source hash → unchanged, no rewrite ───────
{
  const s2 = der.deriveAll();
  eq(s2.unchanged, 1, 'a second pass over identical source is a no-op');
  eq(s2.written, 0, 'nothing rewritten when the source is unchanged');
}

// ── @test:performance — a 400-bar strike derives well under budget ────────────────
{
  const bars = Array.from({ length: 400 }, (_, i) => [i * 60000, 100 + i, 100 + i + 2, 99 + i, 100 + i + 1]);
  const t0 = process.hrtime.bigint();
  der.deriveStrike(bars);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok(ms < 50, `400-bar derive took ${ms.toFixed(2)}ms (< 50ms)`);
}

// ── @test:memory-leak — repeated derivation adds no files (idempotent) ────────────
{
  const before = fs.readdirSync(der.OUT_DIR).length;
  for (let i = 0; i < 50; i++) der.deriveAll();
  eq(fs.readdirSync(der.OUT_DIR).length, before, '50 derivations add zero files — bounded');
}

// ── @test:rollback — deleting the derived layer never touches the mirrored raw ────
{
  const rawBefore = fs.existsSync(der.CANDLES_SRC);
  fs.rmSync(path.join(TMP, 'data', 'warehouse', 'L2_strike'), { recursive: true, force: true });
  eq(fs.existsSync(der.CANDLES_SRC), rawBefore, 'derived layer is disposable; the raw mirror is untouched');
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
console.log(`\n${n} assertions passed`);
