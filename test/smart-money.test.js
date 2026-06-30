/**
 * Smart Money Concepts engine — unit + integration tests.
 * Run: node test/smart-money.test.js   (plain assertions, no test framework)
 */
'use strict';
const assert = require('assert');
const smc = require('../smart-money');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ✓ ' + msg); pass++; };

const bar = (o, h, l, c, t = 0) => ({ o, h, l, c, v: 100, t });

// build a zigzag of bars between pivot prices, with a clear "poke" bar at each
// interior turn so the fractal detector locks onto unambiguous swing points.
function zigzag(pivots, perLeg = 4) {
  const bars = []; let t = 0, prev = pivots[0];
  for (let p = 1; p < pivots.length; p++) {
    const target = pivots[p];
    for (let s = 1; s <= perLeg; s++) {
      const c = prev + (target - prev) * (s / perLeg), o = prev + (target - prev) * ((s - 1) / perLeg);
      bars.push(bar(+o.toFixed(2), +(Math.max(o, c) + 0.3).toFixed(2), +(Math.min(o, c) - 0.3).toFixed(2), +c.toFixed(2), t++));
    }
    if (p < pivots.length - 1) {
      const nextUp = pivots[p + 1] > target;
      if (!nextUp) bars.push(bar(target, +(target + 2).toFixed(2), +(target - 0.5).toFixed(2), +(target - 0.5).toFixed(2), t++)); // top poke
      else         bars.push(bar(target, +(target + 0.5).toFixed(2), +(target - 2).toFixed(2), +(target + 0.5).toFixed(2), t++)); // bottom poke
    }
    prev = target;
  }
  return bars;
}

console.log('Smart Money Concepts engine');

// ── 1. swings (fractal pivots) ──
{
  const bars = [bar(10, 11, 9, 10), bar(10, 12, 10, 11), bar(11, 20, 11, 19), // peak at idx2
    bar(19, 18, 12, 13), bar(13, 14, 8, 9), bar(9, 10, 3, 4),                 // trough at idx5
    bar(4, 12, 4, 11), bar(11, 13, 10, 12)];
  const sw = smc.swings(bars, 2);
  ok(sw.highs.some(h => h.i === 2), 'detects a swing HIGH at the local peak');
  ok(sw.lows.some(l => l.i === 5), 'detects a swing LOW at the local trough');
}

// ── 2. Fair Value Gap (3-bar imbalance) ──
{
  // bullish gap: bar[0].high (11) < bar[2].low (15)
  const bullFvg = [bar(10, 11, 9, 10), bar(12, 16, 12, 15), bar(15, 17, 15, 16), bar(16, 17, 15, 16)];
  const g = smc.fairValueGaps(bullFvg);
  ok(g.some(x => x.dir === 'BULLISH' && x.bottom === 11 && x.top === 15), 'detects a BULLISH FVG zone [11,15]');
  // bearish gap: bar[0].low (14) > bar[2].high (9)
  const bearFvg = [bar(15, 16, 14, 15), bar(12, 12, 8, 9), bar(9, 9, 7, 8), bar(8, 9, 7, 8)];
  const g2 = smc.fairValueGaps(bearFvg);
  ok(g2.some(x => x.dir === 'BEARISH'), 'detects a BEARISH FVG');
}

// ── 3. liquidity sweep (wick beyond a swing, closes back inside) ──
{
  const bars = [bar(10, 11, 9, 10), bar(10, 12, 10, 11), bar(11, 20, 11, 19),  // swing high 20 @2
    bar(19, 19, 15, 16), bar(16, 17, 14, 15), bar(15, 18, 14, 16),
    bar(16, 22, 16, 18)];   // idx6 wicks to 22 (> 20) but closes 18 (< 20) = buy-side sweep
  const sw = smc.swings(bars, 2);
  const sweeps = smc.liquiditySweeps(bars, sw);
  ok(sweeps.some(s => s.dir === 'BEARISH' && s.side === 'BUY_SIDE'), 'detects a buy-side liquidity sweep (bearish)');
}

// ── 4. integration: bullish zigzag → bullish bias + a structural break ──
{
  const up = zigzag([100, 110, 105, 122, 116, 136, 130, 150], 3);
  const r = smc.analyze(up, { swingK: 2 });
  ok(r.available, 'analyze() returns available on sufficient bars');
  ok(r.bias.score > 0, `bullish zigzag → positive bias (got ${r.bias.score})`);
  ok(r.events.length > 0, `detects ≥1 structural break (got ${r.events.length})`);
  ok(['BULLISH', 'WEAK_BULLISH'].includes(r.structure.trend), `structure reads bullish (got ${r.structure.trend})`);
}

// ── 5. integration: bearish zigzag → bearish bias ──
{
  const down = zigzag([150, 140, 145, 128, 134, 114, 120, 100], 3);
  const r = smc.analyze(down, { swingK: 2 });
  ok(r.bias.score < 0, `bearish zigzag → negative bias (got ${r.bias.score})`);
}

// ── 6. guard: too few bars → unavailable, never throws ──
{
  const r = smc.analyze([bar(1, 2, 1, 1)], {});
  ok(r.available === false && r.bias.available === false, 'too few bars → graceful unavailable');
}

console.log(`\nSMC: ${pass} assertions passed`);
