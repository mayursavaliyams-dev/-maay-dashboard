/**
 * option-analyzer — CHARACTERIZATION suite. Run: node test/option-analyzer.test.js
 *
 * Created as part of MIGRATION C1c-9. This module had ZERO tests despite supplying the
 * FALLBACK Greeks that server.js:2269 shows on the dashboard whenever the broker returns
 * an IV but no greeks.
 *
 * These assertions pin CURRENT behaviour, including behaviour that is WRONG, so that the
 * migration produces a diff in which every changed number is visible. `DEFECT:` prefixes
 * mark what the migration will change; `DEBT:` marks what it deliberately will NOT.
 *
 * ── Pinned defect (fixed by C1c-9) ──────────────────────────────────────────
 *  G1 :229  getTimeToExpiry() hardcodes "SENSEX weekly expiry: Tuesday". The broker
 *           contract master says SENSEX expires THURSDAY (2026-07-09,-16,-23,-30).
 *           The value is wrong on EVERY day of the week; on expiry day it reports
 *           5.00 days when the truth is 0.50 — a 10x error. Since ATM gamma scales as
 *           1/sqrt(T) (this file says so at :875), gamma is understated ~3.16x and vega
 *           overstated ~3.16x on the one day gamma dominates.
 *
 * ── Tracked technical debt (explicitly NOT fixed in C1c-9) ──────────────────
 *  TD-1 :166  `volatility = 0.15` hardcoded for the fallback greeks, ignoring the live
 *             IV that the caller already solved for. Every fallback greek is computed at
 *             a fixed 15% vol in a volatility product.
 *  TD-2 server.js:198,2248-2249  a SINGLE shared OptionAnalyzer instance is mutated per
 *             request (`spotPrice`, `strikePitch`). Two concurrent chain requests for
 *             different instruments can interleave. C1c-9 does not deepen this: it passes
 *             `inst` as an ARGUMENT rather than adding `optionAnalyzer.inst`.
 */
'use strict';
const assert = require('assert');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ~${b})`); console.log('  ✓ ' + m); pass++; };

console.log('option-analyzer (characterization, migration C1c-9)');

const OptionAnalyzer = require('../option-analyzer.js');
const registry = require('../instrument-registry.js');
const A = new OptionAnalyzer();

// ── Independent reference Black-Scholes, so the greeks are checked against maths
//    rather than against themselves. r and sigma are the module's own constants.
const R_FREE = 0.065, SIGMA = 0.15;
const npdf = (x) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
function ncdf(x) {  // the module's own Abramowitz–Stegun form, replicated
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1; x = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}
function refGreeks(S, K, T, type) {
  const d1 = (Math.log(S / K) + (R_FREE + SIGMA * SIGMA / 2) * T) / (SIGMA * Math.sqrt(T));
  const d2 = d1 - SIGMA * Math.sqrt(T);
  const gamma = npdf(d1) / (S * SIGMA * Math.sqrt(T));
  const vega = S * Math.sqrt(T) * npdf(d1);
  if (type === 'CE') {
    const theta = -(S * npdf(d1) * SIGMA) / (2 * Math.sqrt(T)) - R_FREE * K * Math.exp(-R_FREE * T) * ncdf(d2);
    return { delta: ncdf(d1), gamma, theta: theta / 365, vega };
  }
  const theta = -(S * npdf(d1) * SIGMA) / (2 * Math.sqrt(T)) + R_FREE * K * Math.exp(-R_FREE * T) * ncdf(-d2);
  return { delta: ncdf(d1) - 1, gamma, theta: theta / 365, vega };
}

// ════════════════════════════════════════════════════════════════════════════
//  G1 — RESOLVED by C1c-9. T comes from the registry's broker-derived calendar.
//
//  The old rule was a "next Tuesday" day-of-week ladder. SENSEX expires THURSDAY.
//  Measured at 09:30 IST, the old rule vs the truth:
//      Mon 1.00 / 3.25   Tue 0.50 / 2.25   Wed 6.00 / 1.25
//      Thu 5.00 / 0.50 (10x, expiry day)   Fri 4.00 / 6.25
//  It was never right. Gamma ~ 1/sqrt(T), so on expiry day gamma was understated 3.16x.
// ════════════════════════════════════════════════════════════════════════════
{
  const oldLadder = (now) => {   // option-analyzer.js:229-243, as it used to read
    const d = now.getDay();
    let days;
    if (d === 2) days = 0.5; else if (d < 2) days = 2 - d; else days = 9 - d;
    return Math.max(days, 0.5) / 365;
  };

  // A fixed clock, because both sides otherwise call new Date() at different instants.
  const fixed = new Date('2026-07-09T04:00:00Z');
  ok(A.getTimeToExpiry('SENSEX', fixed) === registry.timeToExpiryYears('SENSEX', fixed),
    'C1c-9: getTimeToExpiry() delegates to the Instrument Registry');

  // NOTE: Function.length stops counting at the first defaulted parameter, so it is 0 here.
  // Assert the signature from source instead.
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'option-analyzer.js'), 'utf8');
  ok(/getTimeToExpiry\(inst = DEFAULT_INST, now = new Date\(\)\)/.test(src),
    'C1c-9: getTimeToExpiry(inst, now) — instrument is a parameter, `now` is injectable');
  ok(/calculateGreeks\(strike, type, spotPrice, inst = DEFAULT_INST\)/.test(src),
    'C1c-9: calculateGreeks(strike, type, spot, inst) — instrument is a parameter');
  ok(!/getTimeToExpiry\(\)\s*\{[\s\S]{0,80}getDay\(\)/.test(src), 'C1c-9: the hardcoded weekday ladder is gone');

  // requirement 1+2: no mutable shared state was introduced
  ok(!('inst' in A), 'C1c-9 (req 2): no OptionAnalyzer.inst was added');
  const A2 = new OptionAnalyzer();
  ok(!('inst' in A2), 'C1c-9 (req 1): a fresh instance carries no instrument state either');
  ok(!/this\.inst\s*=/.test(src), 'C1c-9 (req 2): `this.inst =` appears nowhere in the source');

  // determinism: `now` is injectable, so the calendar can be replayed
  const thuOpen = new Date('2026-07-09T04:00:00Z');   // 09:30 IST on SENSEX expiry day
  near(A.getTimeToExpiry('SENSEX', thuOpen) * 365, 0.5, 0.02,
    'C1c-9: on SENSEX expiry day at 09:30 IST, T = 0.50 days');
  near(oldLadder(new Date(thuOpen.getTime() + 330 * 60000)) * 365, 5.0, 1e-9,
    'C1c-9: the OLD ladder said 5.00 days on that same morning — a 10x error');

  for (const [iso, want] of [['2026-07-06', 3.25], ['2026-07-07', 2.25], ['2026-07-08', 1.25], ['2026-07-09', 0.5], ['2026-07-10', 6.25]]) {
    const at = new Date(iso + 'T04:00:00Z');
    assert.ok(Math.abs(A.getTimeToExpiry('SENSEX', at) * 365 - want) < 0.02, `${iso} T should be ~${want}d`);
  }
  ok(true, 'C1c-9: T is correct on every weekday, not just expiry day');

  // per-instrument, which the old SENSEX-only rule could never do
  const at = new Date('2026-07-09T04:00:00Z');
  near(A.getTimeToExpiry('NIFTY', at) * 365, 5.25, 0.02, 'C1c-9: NIFTY has its own calendar (Tue 2026-07-14)');
  near(A.getTimeToExpiry('BANKNIFTY', at) * 365, 19.25, 0.02, 'C1c-9: BANKNIFTY is MONTHLY — 19.25 days, not a fake weekly 5');
  ok(registry.expiryDow('SENSEX') === 4 && registry.expiryDow('NIFTY') === 2,
    'C1c-9: BSE expires Thursday, NSE expires Tuesday — from the broker');
  ok(A.getTimeToExpiry() > 0 && A.getTimeToExpiry() * 365 >= 0.5, 'T stays strictly positive and floored at half a day');
}

// ── fail-closed: an unresolvable instrument yields no greeks, not fabricated ones ──
{
  ok(A.getTimeToExpiry('FINNIFTY') === null, 'C1c-9: a trading-disabled instrument has no T');
  ok(A.getTimeToExpiry('NIFTYNEXT50') === null, 'C1c-9: an unknown instrument has no T');
  const g = A.calculateGreeks(80000, 'CE', 80000, 'FINNIFTY');
  ok(g.delta === 0 && g.gamma === 0 && g.theta === 0 && g.vega === 0,
    'C1c-9: greeks are ZEROED when T is unresolvable — never computed from a fabricated T');
  ok(g.unresolved === true && g.inst === 'FINNIFTY', 'C1c-9: and the result says so explicitly');
  ok(Number(g.gamma || 0) === 0, 'C1c-9: server.js:2269 `Number(fallback[name] || 0)` surfaces this as "no data", not a lie');
  ok(Object.values(A.calculateGreeks(80000, 'CE', 80000, 'NIFTYNEXT50')).some((v) => v === true), 'unknown instrument is flagged unresolved');
}

// ── requirement 4: backward compatibility of the public API ──
{
  // Each call reads new Date() independently, so T differs by microseconds and the greeks
  // differ in their last bits. Compare RELATIVE, not absolute — an absolute 1e-15 on gamma
  // (~2.4e-4) is a flaky test, and a flaky test is worse than no test.
  const three = A.calculateGreeks(80000, 'CE', 80000);              // pre-migration call shape
  const four = A.calculateGreeks(80000, 'CE', 80000, 'SENSEX');
  const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);
  for (const k of ['delta', 'gamma', 'theta', 'vega']) {
    assert.ok(k in three, `field ${k} preserved`);
    assert.ok(rel(three[k], four[k]) < 1e-6, `${k}: 3-arg and 4-arg agree (rel ${rel(three[k], four[k])})`);
  }
  ok(true, 'C1c-9 (req 4): the 3-argument call still works, defaults to SENSEX, and returns the same greeks');

  // Deterministic version of the same claim, with the clock pinned.
  const fixed = new Date('2026-07-09T04:00:00Z');
  ok(A.getTimeToExpiry(undefined, fixed) === A.getTimeToExpiry('SENSEX', fixed),
    'C1c-9 (req 4): omitting `inst` is exactly equivalent to passing SENSEX');
}

// ════════════════════════════════════════════════════════════════════════════
//  Greeks algebra — checked against an independent Black-Scholes at the module's own T
// ════════════════════════════════════════════════════════════════════════════
{
  // calculateGreeks() calls getTimeToExpiry() internally, reading new Date() again, so its T
  // drifts a few milliseconds from the T captured here. Compare RELATIVE. An absolute 1e-9
  // on a theta of ~-63 is a flaky test — it failed 4 times in 20 runs before this fix.
  const S = 80000;
  const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);
  for (const [K, type] of [[80000, 'CE'], [80000, 'PE'], [81000, 'CE'], [79000, 'PE'], [85000, 'CE'], [75000, 'PE']]) {
    const T = A.getTimeToExpiry();          // captured immediately before the call
    const g = A.calculateGreeks(K, type, S);
    const r = refGreeks(S, K, T, type);
    for (const k of ['delta', 'gamma', 'theta', 'vega']) {
      assert.ok(rel(g[k], r[k]) < 1e-6, `${k} ${K}${type}: rel diff ${rel(g[k], r[k])}`);
    }
  }
  ok(true, 'calculateGreeks matches an independent Black-Scholes at the module\'s own T (6 strikes × both types)');

  const ce = A.calculateGreeks(80000, 'CE', 80000);
  const pe = A.calculateGreeks(80000, 'PE', 80000);
  // ce and pe are separate calls, each reading its own clock — compare relative.
  const relEq = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300) < 1e-6;
  near(ce.delta - pe.delta, 1, 1e-6, 'put-call delta parity: Δcall − Δput = 1');
  ok(relEq(ce.gamma, pe.gamma), 'gamma is identical for calls and puts');
  ok(relEq(ce.vega, pe.vega), 'vega is identical for calls and puts');
  ok(ce.theta < 0 && pe.theta < 0, 'theta is negative for both (time decay), and per-day (÷365)');
  ok(ce.gamma > 0 && ce.vega > 0, 'gamma and vega are positive');

  ok(A.calculateGreeks(85000, 'CE', 80000).delta < A.calculateGreeks(81000, 'CE', 80000).delta,
    'a further-OTM call has a smaller delta');
  ok(A.calculateGreeks(80000, 'CE', 80000).gamma > A.calculateGreeks(85000, 'CE', 80000).gamma,
    'gamma peaks at the money');
}

// ── DEBT TD-1: the fallback vol is hardcoded ──
{
  const T = A.getTimeToExpiry();
  const a = A.calculateGreeks(81000, 'CE', 80000);
  const r = refGreeks(80000, 81000, T, 'CE');   // reference built at sigma = 0.15
  ok(Math.abs(a.vega - r.vega) / r.vega < 1e-6,
    'DEBT TD-1: fallback greeks always use sigma = 0.15, whatever the live IV (not fixed in C1c-9)');
  ok(/volatility = 0\.15/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'option-analyzer.js'), 'utf8')),
    'DEBT TD-1 recorded: option-analyzer.js hardcodes `volatility = 0.15` for the fallback greeks');
}

// ── the pure helpers ──
{
  near(A.normalCDF(0), 0.5, 1e-6, 'normalCDF(0) = 0.5');
  near(A.normalCDF(1.96), 0.975, 1e-3, 'normalCDF(1.96) ≈ 0.975');
  near(A.normalCDF(-1.96), 0.025, 1e-3, 'normalCDF is symmetric');
  near(A.calculateD1(100, 100, 1, 0, 0.2), 0.1, 1e-9, 'calculateD1 with r=0, sigma=0.2, T=1, S=K → 0.1');
  ok(Number.isFinite(A.calculateD1(80000, 80000, A.getTimeToExpiry(), 0.065, 0.15)), 'd1 is finite at the money');
}

// ── the module is SENSEX-shaped, which is why the migration must pass `inst` ──
{
  ok(/SENSEX/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'option-analyzer.js'), 'utf8')),
    'the module documents itself as SENSEX-tuned');
  const strikePitch = new OptionAnalyzer();
  strikePitch.initialize(80000, 5, 100);
  ok(strikePitch.strikePitch === 100, 'initialize() takes an explicit strike pitch (server.js sets it per request)');
  ok(strikePitch.spotPrice === 80000, 'initialize() sets spotPrice');
}

console.log(`\n${pass} assertions passed`);
