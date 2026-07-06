/**
 * VRP monitor (#2) — unit tests. Run: node test/vrp-monitor.test.js
 */
'use strict';
const assert = require('assert');
const V = require('../vrp-monitor');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const near = (a, b, t, m) => { assert.ok(Math.abs(a - b) <= t, `${m} (got ${a}, want ~${b})`); console.log('  ✓ ' + m); pass++; };

console.log('VRP monitor (#2)');

// ── realizedVol ──
ok(V.realizedVol([100]) === null, 'too few closes → null');
{
  const flat = V.realizedVol([100, 100, 100, 100]);
  ok(flat === 0, 'flat series → 0 realized vol');
  const rv = V.realizedVol([100, 101, 100, 102, 101, 103]);
  ok(rv > 0, 'moving series → positive realized vol');
}

// ── netVRP ──
{
  const nv = V.netVRP(15, 11, 1.5);
  near(nv.grossVRP, 4, 1e-9, 'gross VRP = IV − RV = 4');
  near(nv.netVRP, 2.5, 1e-9, 'net VRP = gross − cost = 2.5');
  ok(V.netVRP(null, 11) === null, 'missing IV → null');
}

// ── favorable when premium present net of cost ──
{
  const m = new V.VRPMonitor({ costDrag: 1.5 });
  for (let i = 0; i < 20; i++) m.record('NIFTY', 15, 11, i);   // net +2.5 each
  const a = m.assess('NIFTY');
  ok(a.favorable, 'consistent +net VRP → favorable');
  ok(a.medianNetVRP > 0 && a.positiveShare === 1, 'median +, 100% positive');
  ok(/premium present/.test(a.reason), 'reason explains premium present');
}

// ── NOT favorable when IV≈RV (premium eaten by cost) ──
{
  const m = new V.VRPMonitor({ costDrag: 1.5 });
  for (let i = 0; i < 20; i++) m.record('SENSEX', 12, 11.5, i);  // gross 0.5, net −1.0
  const a = m.assess('SENSEX');
  ok(!a.favorable, 'thin gross VRP eaten by cost → NOT favorable');
  ok(a.medianNetVRP < 0, 'median net VRP negative');
  ok(/stand down/.test(a.reason), 'reason says stand down');
}

// ── current positive but median negative → still not favorable ──
{
  const m = new V.VRPMonitor({ costDrag: 1.5 });
  for (let i = 0; i < 15; i++) m.record('BANKNIFTY', 12, 12, i);  // net −1.5
  m.record('BANKNIFTY', 20, 11, 15);                             // current net +7.5
  const a = m.assess('BANKNIFTY');
  ok(a.current.netVRP > 0 && !a.favorable, 'one good day but bad median → not favorable (needs both)');
}

// ── rolling window caps ──
{
  const m = new V.VRPMonitor({ window: 10 });
  for (let i = 0; i < 25; i++) m.record('NIFTY', 15, 11, i);
  ok(m.series.NIFTY.length === 10, 'window caps series at 10');
}

// ── no data → not favorable, honest reason ──
{
  const m = new V.VRPMonitor();
  const a = m.assess('NIFTY');
  ok(!a.favorable && a.n === 0, 'no samples → not favorable');
}

// ── status + persistence round-trip ──
{
  const m = new V.VRPMonitor({ costDrag: 1.2 });
  m.record('NIFTY', 16, 10, 1);
  const st = m.status(['NIFTY']);
  ok(st.monitors.NIFTY && st.costDrag === 1.2, 'status exposes per-inst assess + costDrag');
  const m2 = new V.VRPMonitor();
  m2.load(JSON.parse(JSON.stringify(m.toJSON())));
  ok(m2.assess('NIFTY').n === 1, 'persistence round-trip restores series');
}

console.log(`\n${pass} assertions passed`);
