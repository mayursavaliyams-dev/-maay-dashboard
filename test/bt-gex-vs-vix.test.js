/**
 * GEX-vs-VIX harness (#4) — unit tests. Run: node test/bt-gex-vs-vix.test.js
 * Uses deterministic synthetic data with a KNOWN answer to validate the method.
 */
'use strict';
const assert = require('assert');
const B = require('../bt-gex-vs-vix');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const near = (a, b, t, m) => { assert.ok(Math.abs(a - b) <= t, `${m} (got ${a}, want ~${b})`); console.log('  ✓ ' + m); pass++; };

console.log('GEX-vs-VIX harness (#4)');

// deterministic pseudo-noise (no Math.random → reproducible)
let _s = 12345;
const noise = () => { _s = (_s * 1103515245 + 12345) & 0x7fffffff; return (_s / 0x7fffffff) - 0.5; };

// ── rank / spearman basics ──
{
  ok(JSON.stringify(B.rank([10, 30, 20])) === JSON.stringify([1, 3, 2]), 'rank orders values');
  near(B.spearman([1, 2, 3, 4], [1, 2, 3, 4]), 1, 1e-9, 'monotone up → spearman 1');
  near(B.spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1, 1e-9, 'monotone down → spearman -1');
}

// ── CASE A: VIX (z) drives BOTH gex and next-day RV → raw strong, partial ≈ 0 ("GEX is just VIX") ──
{
  const daily = [];
  for (let i = 0; i < 120; i++) {
    const vix = 12 + 8 * Math.sin(i / 6) + noise();          // the common driver
    const gex = -vix + 0.5 * noise();                        // gex tracks -vix
    const rv = vix + 0.5 * noise();                          // today's rv ~ vix; next-day pairing done in analyze
    daily.push({ date: `2026-01-${String(i + 1).padStart(3, '0')}`, inst: 'NIFTY', gex, vix, rv });
  }
  const a = B.analyze(daily);
  ok(a.ok && a.n >= 100, 'enough paired samples');
  ok(Math.abs(a.rawRho) > 0.25, 'raw GEX↔next-RV correlation is real (|rho| > 0.25)');
  ok(Math.abs(a.partialRho) < Math.abs(a.rawRho) * 0.6, 'partial (VIX-controlled) collapses well below raw');
  ok(/repackaged|mostly VIX/.test(a.verdict), 'verdict: GEX is mostly/just VIX');
}

// ── CASE B: GEX carries an INDEPENDENT signal on next-day RV beyond VIX → partial survives ──
{
  _s = 999;
  const daily = [];
  const gexIndep = [];
  for (let i = 0; i < 120; i++) {
    const vix = 14 + 3 * noise();
    const g = 4 * noise();                                    // gex independent of vix
    gexIndep.push(g);
    daily.push({ date: `2026-02-${String(i + 1).padStart(3, '0')}`, inst: 'NIFTY', gex: g, vix, rv: 0 });
  }
  // set each day's rv so that NEXT-day rv depends on TODAY's independent gex (strong link)
  for (let i = 1; i < daily.length; i++) daily[i].rv = 15 + 3 * gexIndep[i - 1] + 0.3 * noise();
  daily[0].rv = 15;
  const a = B.analyze(daily);
  ok(a.ok, 'analysis runs');
  ok(Math.abs(a.partialRho) > 0.2, 'independent GEX signal survives VIX control (partial stays meaningful)');
  ok(/retains independent/.test(a.verdict), 'verdict: GEX retains independent signal');
}

// ── insufficient data → honest ──
{
  const a = B.analyze([{ date: '2026-01-01', gex: 1, vix: 12, rv: 10 }, { date: '2026-01-02', gex: 2, vix: 13, rv: 11 }]);
  ok(!a.ok && /insufficient/.test(a.reason), 'few days → honest insufficient');
}

// ── appendDaily de-dupes per inst per day (fake fs) ──
{
  const store = {};
  const fs = { writeFileSync: (p, d) => { store[p] = d; }, readFileSync: (p) => { if (!(p in store)) throw new Error('no'); return store[p]; } };
  B.appendDaily(fs, 'h.json', { date: '2026-01-01', inst: 'NIFTY', gex: 1, vix: 12, rv: 10 });
  B.appendDaily(fs, 'h.json', { date: '2026-01-01', inst: 'NIFTY', gex: 9, vix: 9, rv: 9 });   // dupe
  B.appendDaily(fs, 'h.json', { date: '2026-01-02', inst: 'NIFTY', gex: 2, vix: 13, rv: 11 });
  ok(B.loadHistory(fs, 'h.json').length === 2, 'dupe same inst+day ignored, new day appended');
}

console.log(`\n${pass} assertions passed`);
