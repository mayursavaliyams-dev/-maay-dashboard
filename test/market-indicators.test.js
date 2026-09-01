/**
 * @test:unit @test:integration @test:regression @test:failure
 * @test:performance @test:memory-leak @test:rollback
 */
'use strict';

const assert = require('assert');
const path = require('path');

const M = require(path.join(__dirname, '..', 'market-indicators.js'));

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  \u2713 ' + m); };

console.log('\nmarket-indicators\n');

const base = Date.UTC(2026, 7, 25, 3, 45);
const samples = Array.from({ length: 60 }, (_, i) => ({
  t: base + i * 15000,
  price: 100 + i * 0.35,
  volume: 1000 + i,
  source: 'test',
}));

const out = M.compute(samples, { now: base + 60 * 15000, staleMs: 60000 });
ok(out.ok === true, 'a regular stream computes a market snapshot');
ok(out.samples === 60, 'the snapshot reports its sample count');
ok(out.indicators.ema9 !== null && out.indicators.ema21 !== null, 'EMA 9 and EMA 21 are present after warm-up');
ok(out.indicators.rsi14 !== null, 'RSI is present only after the warm-up window');
ok(out.indicators.macdHistogram !== null, 'MACD histogram is present after enough samples');
ok(out.trend.label === 'BULLISH', 'a rising stream gets a bullish indicator read');
ok(out.trend.actionBias === 'BUY_CALL_BIAS', 'bullish read maps to call-side bias, not an order');
ok(out.trend.recommendationStatus === 'research_only', 'the bias is explicitly research-only');
ok(/Research-only/.test(out.note), 'the response says this is not an order instruction');

const down = M.compute(samples.map((s, i) => ({ ...s, price: 130 - i * 0.35 })), { now: base + 60 * 15000, staleMs: 60000 });
ok(down.trend.label === 'BEARISH', 'a falling stream gets a bearish indicator read');
ok(down.trend.actionBias === 'BUY_PUT_BIAS', 'bearish read maps to put-side bias');

const short = M.compute(samples.slice(0, 8), { now: base + 8 * 15000, staleMs: 60000 });
ok(short.ok === true, 'short history still returns the current market data');
ok(short.indicators.ema9 === null && short.indicators.rsi14 === null, 'warm-up indicators stay null on short history');

const stale = M.compute(samples.slice(0, 20), { now: base + 10 * 60000, staleMs: 60000 });
ok(stale.stale === true, 'stale samples are marked stale instead of looking live');

const empty = M.compute([], { now: base });
ok(empty.ok === false && empty.reason.includes('no market samples'), 'empty stream fails closed');

console.log(`\n${n} checks passed\n`);
