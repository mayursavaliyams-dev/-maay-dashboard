/**
 * Confirmed Signals + accuracy tracker — unit tests. Run: node test/confirmed-signals.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { agree, ConfirmedTracker } = require('../confirmed-signals');
const FILE = path.join(__dirname, '..', 'data', 'confirmed-signals.json');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const clean = () => { try { fs.unlinkSync(FILE); } catch (_) {} };

console.log('Confirmed Signals engine');
clean();

// ── agree(): only clean one-sided confluence confirms ──
{
  const all = agree({ pattern: 'BEARISH', oi: 'BEARISH', early: 'BEARISH', orb: 'BEARISH' });
  ok(all.confirmed && all.direction === 'BEARISH' && all.agreeN === 4, '4/4 bearish → CONFIRMED BEARISH');
  const three = agree({ pattern: 'BULLISH', oi: 'BULLISH', early: 'BULLISH', orb: 'NEUTRAL' });
  ok(three.confirmed && three.direction === 'BULLISH' && three.agreeN === 3, '3 bull + 1 neutral → CONFIRMED BULLISH');
  const opposed = agree({ pattern: 'BEARISH', oi: 'BEARISH', early: 'BEARISH', orb: 'BULLISH' });
  ok(!opposed.confirmed, '3 bear + 1 bull (opposed) → NOT confirmed');
  const split = agree({ pattern: 'BULLISH', oi: 'BULLISH', early: 'BEARISH', orb: 'BEARISH' });
  ok(!split.confirmed, '2v2 split → NOT confirmed');
  const weak = agree({ pattern: 'BULLISH', oi: 'BULLISH', early: 'NEUTRAL', orb: 'NEUTRAL' });
  ok(!weak.confirmed, 'only 2 agree → NOT confirmed (below minAgree 3)');
  const custom = agree({ pattern: 'BULLISH', oi: 'BULLISH', early: 'NEUTRAL', orb: 'NEUTRAL' }, { minAgree: 2 });
  ok(custom.confirmed, 'minAgree=2 override → 2 agree confirms');
}

// ── tracker record + dedup ──
{
  const t = new ConfirmedTracker({ horizonMin: 15, minMovePct: 0.1 });
  const sig = { confirmed: true, inst: 'NIFTY', direction: 'BULLISH', spot: 24000, strike: 24000, agreeN: 3, engines: {}, at: 1000 };
  ok(t.record(sig) && t.pending.length === 1, 'records a confirmed signal → 1 pending');
  ok(t.record(sig) === null && t.pending.length === 1, 'dedup: same inst+dir while open → not re-recorded');
  ok(t.record({ ...sig, confirmed: false }) === null, 'non-confirmed → not recorded');
}

// ── resolve + accuracy (correct hit) ──
{
  clean();
  const t = new ConfirmedTracker({ horizonMin: 15, minMovePct: 0.1 });
  t.record({ confirmed: true, inst: 'NIFTY', direction: 'BULLISH', spot: 24000, strike: 24000, agreeN: 4, engines: {}, at: 0 });
  t.record({ confirmed: true, inst: 'SENSEX', direction: 'BEARISH', spot: 80000, strike: 80000, agreeN: 3, engines: {}, at: 0 });
  // horizon elapsed (now = 15min+1). NIFTY rose (correct bull), SENSEX rose (wrong bear)
  t.resolve({ NIFTY: 24080, SENSEX: 80200 }, 15 * 60000 + 1);
  ok(t.pending.length === 0 && t.resolved.length === 2, 'both resolve after horizon');
  const acc = t.accuracy();
  ok(acc.byInst.NIFTY.hitRate === 100, 'NIFTY bullish + price up → 100% hit');
  ok(acc.byInst.SENSEX.hitRate === 0, 'SENSEX bearish + price up → 0% (wrong)');
  ok(acc.overall.decided === 2 && acc.overall.correct === 1 && acc.overall.hitRate === 50, 'overall 1/2 = 50%');
}

// ── flat move doesn't count for/against ──
{
  clean();
  const t = new ConfirmedTracker({ horizonMin: 15, minMovePct: 0.5 });
  t.record({ confirmed: true, inst: 'NIFTY', direction: 'BULLISH', spot: 24000, strike: 24000, agreeN: 3, engines: {}, at: 0 });
  t.resolve({ NIFTY: 24010 }, 15 * 60000 + 1);   // +0.04% < 0.5% threshold → flat
  const acc = t.accuracy();
  ok(acc.overall.flat === 1 && acc.overall.decided === 0, 'sub-threshold move → flat, not counted');
}

clean();
console.log(`\nConfirmed Signals: ${pass} assertions passed`);
