/**
 * stock-technicals — indicators checked against worked examples, not against
 * themselves.
 * Run: node test/stock-technicals.test.js
 *
 * @test:unit @test:characterization @test:regression @test:failure
 * @test:boundary @test:integration @test:rollback
 *
 * WHY THE NUMBERS BELOW ARE WRITTEN OUT
 *
 * An indicator test that computes the expected value with the same code it is
 * testing proves only that the code is deterministic. The RSI and EMA cases here
 * use the standard published series — the 14-period RSI worked example that
 * appears in Wilder's own book and in every reference implementation — so a
 * wrong smoothing rule fails rather than agreeing with itself.
 *
 * THE FAILURE THIS FILE EXISTS TO PREVENT is not a wrong number. It is a number
 * where there should be a blank. TMPV is a 2026 demerger with a few months of
 * its own history; a 200-day average computed from 60 bars would be drawn on a
 * chart as a long-term trend line for a company that has no long term. Half of
 * the assertions below are that something returns null.
 */
'use strict';
const assert = require('assert');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };
const near = (a, b, tol, m) => ok(a !== null && Math.abs(a - b) <= tol, `${m} (${a} ≈ ${b})`);
const ROOT = path.join(__dirname, '..');
const T = require(path.join(ROOT, 'stock-technicals.js'));

console.log('\nstock-technicals\n');

/* ── SMA / EMA ───────────────────────────────────────────────────────────── */
console.log('averages');
ok(T.sma([1, 2, 3, 4, 5], 5) === 3, 'SMA of 1..5 is 3');
ok(T.sma([10, 20, 30, 40], 2) === 35, 'SMA uses the LAST n values, not the first');
ok(T.sma([1, 2], 5) === null, 'SMA below its window is null, not a shorter average');
ok(T.sma([1, 2, 3], 0) === null, 'a zero window is refused rather than dividing by zero');

// EMA(3) over 1..5, SMA-seeded: seed = (1+2+3)/3 = 2, k = 0.5
//   bar4: 4*.5 + 2*.5   = 3
//   bar5: 5*.5 + 3*.5   = 4
ok(T.ema([1, 2, 3, 4, 5], 3) === 4, 'EMA(3) of 1..5 is 4 — SMA-seeded, hand-computed');
ok(T.emaSeries([1, 2, 3, 4, 5], 3).length === 3, 'the EMA series starts at the seed, not at bar 1');
ok(T.emaSeries([1, 2], 3).length === 0,
  'below the window the series is empty — a caller cannot index a half-warmed value');
ok(T.ema([5, 5, 5, 5, 5, 5], 3) === 5, 'a flat series has a flat EMA');

/* ── RSI ─────────────────────────────────────────────────────────────────── */
console.log('\nRSI (Wilder)');
// The canonical worked series. Wilder's own example; the published RSI after
// the 15th close is ~70.5 and after the next two ~66.3 and ~66.5.
const W = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84,
           46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41];
near(T.rsi(W.slice(0, 15), 14), 70.53, 0.15, 'RSI(14) matches the published worked example');
near(T.rsi(W.slice(0, 17), 14), 66.32, 0.4, 'and still matches two bars later — the smoothing is Wilder\'s, not a rolling mean');

ok(T.rsi([1, 2, 3], 14) === null, 'RSI below 15 bars is null');
ok(T.rsi(Array.from({ length: 20 }, (_, i) => i + 1), 14) === 100,
  'a series that never falls is RSI 100 — a real reading, not a swallowed divide-by-zero');
ok(T.rsi(Array.from({ length: 20 }, (_, i) => 20 - i), 14) === 0, 'a series that never rises is RSI 0');
ok(T.rsi(new Array(20).fill(50), 14) === 50, 'a flat series is 50, not 100');

/* ── MACD ────────────────────────────────────────────────────────────────── */
console.log('\nMACD');
const rising = Array.from({ length: 60 }, (_, i) => 100 + i);
const m = T.macd(rising);
ok(m.macd > 0, 'a steadily rising series has a positive MACD line');
ok(m.signal !== null && m.histogram !== null, 'with 60 bars the signal and histogram exist');
const short = T.macd(Array.from({ length: 20 }, (_, i) => 100 + i));
ok(short.macd === null && short.signal === null && short.histogram === null,
  'below 26 bars every MACD field is null — no partial line');
const justEnough = T.macd(Array.from({ length: 30 }, (_, i) => 100 + i));
ok(justEnough.macd !== null && justEnough.signal === null && justEnough.histogram === null,
  'at 30 bars the line exists but the 9-period signal does not — and the histogram waits for it');

/* the alignment bug this guards against: subtracting the two EMA series from
   the front pairs the 12-EMA of an early date with the 26-EMA of a later one. */
const flatThenJump = new Array(40).fill(100).concat(new Array(20).fill(200));
ok(T.macd(flatThenJump).macd > 0, 'a late jump moves MACD positive — the two EMA series are tail-aligned');

/* ── ATR, volatility, change ─────────────────────────────────────────────── */
console.log('\nrange and change');
const bars = Array.from({ length: 30 }, (_, i) => ({ high: 102 + i, low: 98 + i, close: 100 + i }));
near(T.atr(bars, 14), 4, 0.6, 'ATR of a constant 4-wide range that gaps up 1 a day');
ok(T.atr(bars.slice(0, 5), 14) === null, 'ATR below its window is null');

ok(T.changePct([100, 110], 1) === 10, 'a 100 → 110 move is +10%');
near(T.changePct([100, 50], 1), -50, 0.001, 'and 100 → 50 is −50%');
ok(T.changePct([100, 110], 5) === null, 'a lookback longer than the history is null, not the whole-series change');
ok(T.changePct([0, 10], 1) === null, 'a zero base is refused rather than returning Infinity');

ok(T.volatility(new Array(40).fill(100), 30) === 0, 'a flat series has zero volatility');
ok(T.volatility([100, 101], 30) === null, 'volatility below its window is null');

/* ── trend, with its denominator ─────────────────────────────────────────── */
console.log('\ntrend');
let t = T.trendFromMAs(120, { sma20: 115, sma50: 110, sma200: 100 });
ok(t.label === 'UP' && t.of === 3, 'price above both averages and 20>50 is UP on 3 of 3');
t = T.trendFromMAs(120, { sma20: 115, sma50: 110, sma200: null });
ok(t.label === 'UP' && t.of === 2,
  'with no 200-DMA the verdict stands on 2 checks and SAYS 2 — it does not claim the third');
t = T.trendFromMAs(90, { sma20: 95, sma50: 100, sma200: 110 });
ok(t.label === 'DOWN' && t.of === 3, 'the inverse is DOWN');
t = T.trendFromMAs(105, { sma20: 95, sma50: 100, sma200: 110 });
ok(t.label === 'MIXED', 'above one average and below another is MIXED, not rounded to a direction');
t = T.trendFromMAs(100, { sma20: null, sma50: null, sma200: null });
ok(t.label === 'UNKNOWN' && t.of === 0, 'no averages at all is UNKNOWN, never a default of UP or DOWN');

ok(T.positionInRange(50, 0, 100) === 50, 'mid-range is 50%');
ok(T.positionInRange(50, 50, 50) === null, 'a zero-width range is null rather than a divide-by-zero');
ok(T.positionInRange(150, 0, 100) === 100, 'a value above the range clamps to 100 instead of exceeding it');

/* ── compute(): the whole block, and the demerger case ───────────────────── */
console.log('\ncompute');
const day = (i, c) => ({ date: new Date(2025, 0, 1 + i), open: c, high: c + 2, low: c - 2, close: c, volume: 1000 + i });
const long = Array.from({ length: 300 }, (_, i) => day(i, 100 + i * 0.5));
const c = T.compute(long);
ok(c.ok && c.bars === 300, '300 bars compute');
ok(c.movingAverages.sma200 !== null, 'with 300 bars the 200-DMA exists');
ok(c.oscillators.rsi14 !== null && c.oscillators.rsiZone !== null, 'RSI and its zone are reported');
ok(c.performance.y1 !== null, 'the 1-year change is available');
ok(c.range.positionPct !== null && c.range.basis.includes('closes'),
  'the 52-week position says it is computed from closes, so disagreeing with the vendor is not a bug');

// The TMPV case: a real demerger with a few months of history.
const shortHist = Array.from({ length: 60 }, (_, i) => day(i, 300 + i * 0.4));
const s = T.compute(shortHist);
ok(s.ok && s.bars === 60, '60 bars still compute what they can');
ok(s.movingAverages.sma200 === null,
  'but the 200-DMA is BLANK on 60 bars — the demerger defect this file exists for');
ok(s.movingAverages.vsSma200Pct === null, 'and so is the distance from it — no derived value off a missing base');
ok(s.movingAverages.sma50 !== null, 'the 50-DMA, which it does have, is still shown');
ok(s.performance.y1 === null && s.performance.m1 !== null,
  'a 1-year change it cannot know is null while the 1-month change it can know is given');
ok(s.trend.of < 3, 'and the trend reports the smaller number of checks it actually made');

/* ── the corporate action, which is the case that produces a confident lie ──
   MEASURED on 2026-07-29: the TMPV daily series carries a single close-to-close
   move of −40.2% on 14 Oct 2025 (660.8 → 395.5). That is the Tata Motors
   demerger. TCS over the same window has a worst day of −8.4%.

   Before this guard, TMPV reported a 200-day average of 362.35 — blended across
   pre- and post-demerger prices — and a 1-year return of −52.92%, which reads as
   shareholders having lost half their money in a company that merely split. Both
   figures were arithmetically correct. */
console.log('\ncorporate actions');
const demerged = Array.from({ length: 260 }, (_, i) => day(i, 660 - i * 0.2))       // ~1 year pre-split
  .concat(Array.from({ length: 90 }, (_, i) => day(260 + i, 395 - i * 0.3)));       // ~90 days after
const dm = T.compute(demerged);

ok(dm.dataBreak !== null, 'the split is detected');
ok(dm.dataBreak.movePct < -25, `and reported as a ${dm.dataBreak.movePct}% move, beyond any circuit limit`);
ok(dm.dataBreak.usableBars === 90, 'only the 90 bars since the break count as comparable history');
ok(/corporate action/.test(dm.dataBreak.note), 'the note says what it is rather than only that something is missing');

ok(dm.movingAverages.sma200 === null,
  'the 200-DMA is BLANK — averaging 660 with 395 describes no company that exists');
ok(dm.movingAverages.sma50 !== null, 'but the 50-DMA, which sits entirely after the break, is still given');
ok(dm.performance.y1 === null, 'the 1-year return is blank rather than reporting a demerger as a −53% loss');
ok(dm.performance.m1 !== null, 'the 1-month return, which does not span the break, survives');
ok(dm.range.high52w !== null && dm.range.high52w < 500,
  `the 52-week high comes from the comparable stretch (${dm.range.high52w}), not the pre-split 660`);
ok(dm.trend.of < 3, 'and the trend stands on the checks it can actually make');

const clean = T.compute(Array.from({ length: 300 }, (_, i) => day(i, 100 + i * 0.5)));
ok(clean.dataBreak === null,
  'a series with no break says so explicitly — which is what makes its 200-DMA believable');
ok(clean.movingAverages.sma200 !== null, 'and keeps every window');

// An ordinary bad day must not be mistaken for a corporate action.
const crash = Array.from({ length: 120 }, (_, i) => day(i, 100)).concat(
  Array.from({ length: 60 }, (_, i) => day(120 + i, 82 - i * 0.05)));   // −18%, inside circuit limits
ok(T.compute(crash).dataBreak === null,
  'an 18% fall is a real market move and is left alone — the threshold sits above the exchange circuit limit');
ok(T.findDiscontinuity([100, 74]) !== null, '−26% is past the limit and flags');
ok(T.findDiscontinuity([100, 76]) === null, '−24% is not');

const tiny = T.compute(Array.from({ length: 10 }, (_, i) => day(i, 100 + i)));
ok(tiny.ok === true && tiny.oscillators.rsi14 === null, '10 bars give a block with RSI blank rather than an error');
ok(T.compute([]).ok === false, 'no bars at all fails closed with a reason');
ok(T.compute(null).ok === false, 'and so does a missing array');

/* holiday rows: the vendor emits null-close bars, and carrying them forward
   would flatten every average across the gap. */
const holed = long.slice(0, 100).concat([{ date: new Date(2025, 5, 1), close: null, high: null, low: null }], long.slice(100));
ok(T.compute(holed).bars === 300, 'null-close rows are dropped, not carried forward');

console.log(`\n${n} checks passed\n`);
