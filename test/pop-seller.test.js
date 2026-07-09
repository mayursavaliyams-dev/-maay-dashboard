/**
 * pop-seller — CHARACTERIZATION suite. Run: node test/pop-seller.test.js
 *
 * Created as part of MIGRATION C1c-2. This module had ZERO tests despite computing
 * probability-of-profit, premium, credit and paper P&L for a live paper book.
 *
 * ── What a characterization suite is for ─────────────────────────────────────
 * These assertions pin the module's CURRENT behaviour — including behaviour that is
 * WRONG. They exist so that C1c-3 (registry migration) produces a diff in which every
 * changed number is visible and explained. A test that asserts `lotSize('NIFTY') === 75`
 * is not endorsing 75; it is a tripwire that fires the moment 75 becomes 65, so the
 * change cannot happen silently.
 *
 * Assertions that pin a KNOWN DEFECT are prefixed `DEFECT:` and name the fix commit.
 *
 * ── Defects pinned here (do not "fix" without a separate approved commit) ────
 *  D1  :18  LOT_SIZE = { NIFTY:75, BANKNIFTY:35, SENSEX:20, FINNIFTY:65, BANKEX:30 }
 *           Broker contract master (2026-07-09): 65 / 30 / 20 / 60 / 30.
 *           NIFTY +15.4%, BANKNIFTY +16.7%, FINNIFTY +8.3% overstated P&L.   → C1c-3
 *  D2  :19  `LOT_SIZE[inst] || 75` — an unknown symbol silently prices at 75.
 *           MIDCPNIFTY (true lot 120) would be off by -37.5%.                → C1c-3
 *  D3  :22  STEP map duplicated from the registry. Values happen to be right;
 *           `|| 50` would mis-round MIDCPNIFTY (true interval 25).           → C1c-3
 *  D4  :31  daysToExpiry assumes NIFTY=Thursday, SENSEX=Tuesday. The broker says
 *           NIFTY's nearest expiry is 2026-07-14 (a TUESDAY) and SENSEX's is
 *           2026-07-09 (a THURSDAY). The two are EXACTLY SWAPPED, so T is wrong for
 *           both, so every delta is wrong, so every PoP is wrong. Additionally
 *           BANKNIFTY/FINNIFTY/BANKEX have NO weekly expiry at all (monthly only).
 *           NOT a lot-size defect — needs its own commit.                 → C1c-3a
 *  D5  :51  bsDelta returns ±1 whenever T<=0 regardless of moneyness. A deep-OTM call
 *           at expiry reports delta 1 → PoP 0%, when the truth is delta≈0 → PoP≈100%.
 *           Inverted. Reachable only via the exported fn (scanPoP floors T).  → C1c-3a
 *  D6 :198  buildIronCondor returns TWO SHORT LEGS and no wings. That is a short
 *           strangle, not an iron condor: max loss is unbounded, and the returned
 *           object has no maxLoss field at all.                              → backlog
 *  D7 :207  combinedPoP = popCE × popPE assumes the two breaches are INDEPENDENT.
 *           They are perfectly negatively correlated (spot cannot pierce both).
 *           The product understates true PoP.                                → backlog
 *  D8 :242  `_book` is module-global mutable state shared by every `require`.
 */
'use strict';
const assert = require('assert');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m} (got ${a}, want ~${b})`); console.log('  ✓ ' + m); pass++; };

console.log('pop-seller (characterization, migration C1c-2)');

delete process.env.POP_LIVE_ENABLED;
const P = require('../pop-seller.js');
const registry = require('../instrument-registry.js');

// ════════════════════════════════════════════════════════════════════════════
//  D1/D2 — lot size: pinned WRONG, so C1c-3 must change these lines visibly
// ════════════════════════════════════════════════════════════════════════════
{
  ok(P.lotSize('NIFTY') === 75, 'DEFECT D1: lotSize(NIFTY) is 75 today — broker says 65 (fix: C1c-3)');
  ok(P.lotSize('BANKNIFTY') === 35, 'DEFECT D1: lotSize(BANKNIFTY) is 35 today — broker says 30 (fix: C1c-3)');
  ok(P.lotSize('FINNIFTY') === 65, 'DEFECT D1: lotSize(FINNIFTY) is 65 today — broker says 60 (fix: C1c-3)');
  ok(P.lotSize('SENSEX') === 20, 'lotSize(SENSEX) is 20 — agrees with the broker');
  ok(P.lotSize('BANKEX') === 30, 'lotSize(BANKEX) is 30 — agrees with the broker');

  ok(P.lotSize('MIDCPNIFTY') === 75, 'DEFECT D2: unknown symbol silently prices at 75 (true lot 120) (fix: C1c-3)');
  ok(P.lotSize('NIFTYNEXT50') === 75, 'DEFECT D2: any unknown symbol → 75, never a refusal (fix: C1c-3)');
  ok(P.lotSize(undefined) === 75, 'DEFECT D2: undefined → 75 (fix: C1c-3)');

  // The registry already knows the truth. This documents the exact divergence.
  const drift = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'SENSEX', 'BANKEX']
    .map((i) => ({ i, popSeller: P.lotSize(i), broker: registry.catalog(i).lotSize }))
    .filter((r) => r.popSeller !== r.broker);
  ok(drift.length === 3 && drift.every((d) => ['NIFTY', 'BANKNIFTY', 'FINNIFTY'].includes(d.i)),
    'DEFECT D1: exactly NIFTY/BANKNIFTY/FINNIFTY disagree with the broker contract master');
}

// ════════════════════════════════════════════════════════════════════════════
//  D3 — strike step (values correct, source duplicated)
// ════════════════════════════════════════════════════════════════════════════
{
  // strikeStep is not exported; observe it through generateStrikes via scanPoP's ATM.
  // Instead assert through the public surface that uses it: buildIronCondor strikes.
  const mkChain = () => [];
  const r = P.scanPoP({ inst: 'NIFTY', spot: 24000, chainStrikes: mkChain(), minPoP: 0, maxResults: 500 });
  const strikes = [...new Set(r.map((x) => x.strike))].sort((a, b) => a - b);
  const gaps = strikes.slice(1).map((k, i) => k - strikes[i]);
  ok(gaps.every((g) => g % 50 === 0), 'NIFTY strike lattice is a multiple of 50 (matches registry)');

  const rs = P.scanPoP({ inst: 'SENSEX', spot: 80000, chainStrikes: [], minPoP: 0, maxResults: 500 });
  const ks = [...new Set(rs.map((x) => x.strike))].sort((a, b) => a - b);
  ok(ks.slice(1).every((k, i) => (k - ks[i]) % 100 === 0), 'SENSEX strike lattice is a multiple of 100');
}

// ════════════════════════════════════════════════════════════════════════════
//  D4 — daysToExpiry: the weekday rule, pinned exactly as it is today
// ════════════════════════════════════════════════════════════════════════════
{
  // Independent reference implementation of the rule AS WRITTEN (pop-seller.js:27-38).
  // If someone changes targetDay, this fails — which is the point.
  const ref = (inst) => {
    const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const dow = ist.getDay();
    const hour = ist.getHours();
    const targetDay = (inst === 'SENSEX' || inst === 'BANKEX') ? 2 : 4;
    let days = (targetDay - dow + 7) % 7;
    if (days === 0 && hour >= 15) days = 7;
    return Math.max(days + (1 - hour / 24), 0.5) / 365;
  };

  for (const inst of ['NIFTY', 'BANKNIFTY', 'SENSEX', 'FINNIFTY', 'BANKEX']) {
    near(P.daysToExpiry(inst) * 365, ref(inst) * 365, 0.05, `daysToExpiry(${inst}) matches the rule as written`);
  }

  ok(P.daysToExpiry('NIFTY') > 0, 'daysToExpiry is strictly positive (T never hits the bsDelta T<=0 branch)');
  ok(P.daysToExpiry('NIFTY') * 365 >= 0.5, 'daysToExpiry floors at 0.5 days');
  ok(P.daysToExpiry('NIFTY') * 365 <= 8, 'daysToExpiry never exceeds 8 days (weekly assumption)');

  // The rule itself is wrong. Pinned, not fixed.
  const dow = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();
  ok(dow('2026-07-14') === 2 && dow('2026-07-09') === 4,
    'DEFECT D4: broker says NIFTY expiry is a TUESDAY and SENSEX a THURSDAY — pop-seller has them swapped (fix: C1c-3a)');
  ok(registry.catalog('BANKNIFTY').expiryType === 'MONTHLY' && registry.catalog('BANKEX').expiryType === 'MONTHLY',
    'DEFECT D4: BANKNIFTY/BANKEX have NO weekly expiry, yet daysToExpiry assumes one (fix: C1c-3a)');
}

// ════════════════════════════════════════════════════════════════════════════
//  Black-Scholes primitives
// ════════════════════════════════════════════════════════════════════════════
{
  // normalCDF is Abramowitz–Stegun 7.1.26 (~1e-7 accurate).
  // ATM, S=K so ln(S/K)=0 and d1 = (r + σ²/2)·T / (σ√T)
  //   = (0.065 + 0.01125) × (30/365) / (0.15 × √(30/365)) = 0.14562
  //   N(0.14562) = 0.55789   →  Δcall = 0.5579, Δput = Δcall − 1 = −0.4421
  near(P.bsDelta(24000, 24000, 30 / 365, 0.15, 'CE'), 0.5579, 0.002, 'bsDelta ATM call ≈ 0.5579 (r=6.5% drift lifts it above 0.50)');
  near(P.bsDelta(24000, 24000, 30 / 365, 0.15, 'PE'), -0.4421, 0.002, 'bsDelta ATM put ≈ -0.4421');
  ok(P.bsDelta(24000, 30000, 30 / 365, 0.15, 'CE') < 0.01, 'bsDelta deep-OTM call → ~0');
  ok(Math.abs(P.bsDelta(24000, 18000, 30 / 365, 0.15, 'PE')) < 0.01, 'bsDelta deep-OTM put → ~0');
  ok(P.bsDelta(24000, 24000, 30 / 365, 0.15, 'CE') - P.bsDelta(24000, 24000, 30 / 365, 0.15, 'PE') === 1
     || Math.abs((P.bsDelta(24000, 24000, 30 / 365, 0.15, 'CE') - P.bsDelta(24000, 24000, 30 / 365, 0.15, 'PE')) - 1) < 1e-9,
    'put-call delta parity: Δcall − Δput = 1');

  // D5 — the T<=0 branch is moneyness-blind and INVERTED
  ok(P.bsDelta(24000, 30000, 0, 0.15, 'CE') === 1,
    'DEFECT D5: at T=0 a deep-OTM call reports delta 1 (→ PoP 0%) instead of 0 (→ PoP 100%) (fix: C1c-3a)');
  ok(P.bsDelta(24000, 18000, 0, 0.15, 'PE') === -1, 'DEFECT D5: at T=0 a deep-OTM put reports delta -1 (fix: C1c-3a)');
  ok(P.bsDelta(24000, 24000, 30 / 365, 0, 'CE') === 1, 'DEFECT D5: sigma=0 also trips the ±1 branch (fix: C1c-3a)');
}

// ── popFromDelta ──
{
  near(P.popFromDelta(0.1), 90, 1e-9, 'popFromDelta(0.10) = 90%');
  near(P.popFromDelta(-0.1), 90, 1e-9, 'popFromDelta uses |delta|, sign-agnostic');
  near(P.popFromDelta(0), 100, 1e-9, 'popFromDelta(0) = 100%');
  near(P.popFromDelta('abc'), 100, 1e-9, 'popFromDelta(garbage) → 100% (coerces NaN to 0)');
}

// ── realPoP: IV normalisation and clamping ──
{
  const a = P.realPoP(24000, 25000, 30 / 365, 15, 'CE');    // 15 → percent form
  const b = P.realPoP(24000, 25000, 30 / 365, 0.15, 'CE');  // 0.15 → decimal form
  near(a.pop, b.pop, 0.05, 'realPoP treats iv=15 and iv=0.15 identically (>5 ⇒ percent)');
  ok(a.sigma === 15, 'realPoP reports sigma back as a percentage');

  const z = P.realPoP(24000, 25000, 30 / 365, 0, 'CE');
  near(z.sigma, 14 + (1000 / 24000) * 50, 0.15, 'realPoP with no IV falls back to 0.14 + moneyness×0.5');

  const lo = P.realPoP(24000, 25000, 30 / 365, 0.001, 'CE');
  ok(lo.sigma === 5, 'realPoP clamps sigma up to 5%');
  const hi = P.realPoP(24000, 25000, 30 / 365, 500, 'CE');
  ok(hi.sigma === 200, 'realPoP clamps sigma down to 200%');

  ok(z.pop >= 0 && z.pop <= 100, 'realPoP is bounded [0,100]');
  ok(P.realPoP(24000, 60000, 30 / 365, 0.15, 'CE').pop === 100, 'far-OTM call → PoP 100%');
}

// ════════════════════════════════════════════════════════════════════════════
//  scanPoP — the money math, pinned with the WRONG lot
// ════════════════════════════════════════════════════════════════════════════
{
  const chain = [
    { strike: 24500, ce: { ltp: 40, iv: 14 }, pe: { ltp: 2, iv: 16 } },
    { strike: 23500, ce: { ltp: 2, iv: 16 }, pe: { ltp: 38, iv: 15 } },
  ];
  const res = P.scanPoP({ inst: 'NIFTY', spot: 24000, chainStrikes: chain, minPoP: 80, maxResults: 50 });

  ok(Array.isArray(res) && res.length > 0, 'scanPoP returns candidates');
  ok(res.every((r) => r.pop >= 80), 'every candidate clears minPoP');
  ok(res.every((r) => r.premium > 0.5), 'candidates with premium ≤ 0.5 are dropped');
  ok(res.every((r) => (r.side === 'SELL_CE' ? r.strike > 24000 : r.strike < 24000)), 'CE candidates are above spot, PE below');
  ok(res.every((r) => r.lot === 75), 'DEFECT D1: every candidate carries lot 75 (fix: C1c-3)');

  const ce = res.find((r) => r.strike === 24500 && r.side === 'SELL_CE');
  if (ce) {
    ok(ce.fromChain === true, 'scanPoP marks chain-sourced LTPs');
    near(ce.maxProfit, 40 * 75, 1, 'DEFECT D1: maxProfit = premium × 75, not × 65 (fix: C1c-3)');
    near(ce.breakeven, 24540, 0.01, 'CE breakeven = strike + premium');
    near(ce.distance, 500, 0.01, 'CE distance = strike − spot');
  }
  const pe = res.find((r) => r.strike === 23500 && r.side === 'SELL_PE');
  if (pe) {
    near(pe.breakeven, 23462, 0.01, 'PE breakeven = strike − premium');
    ok(pe.delta >= 0, 'PE delta is reported as an absolute value');
  }

  // sort contract: PoP desc, then distance asc
  for (let i = 1; i < res.length; i++) {
    assert.ok(res[i - 1].pop > res[i].pop || (res[i - 1].pop === res[i].pop && res[i - 1].distance <= res[i].distance),
      'sort order violated');
  }
  ok(true, 'scanPoP sorts by PoP desc, then distance asc');

  ok(P.scanPoP({ inst: 'NIFTY', spot: 24000, chainStrikes: [], minPoP: 99.99, maxResults: 5 }).length >= 0,
    'scanPoP with an impossible minPoP returns an array, never throws');
  ok(P.scanPoP({ inst: 'NIFTY', spot: 24000, chainStrikes: [], minPoP: 0, maxResults: 3 }).length <= 3, 'maxResults is honoured');
  ok(P.scanPoP({ inst: 'NIFTY', spot: 24000, chainStrikes: [], minPoP: 0 }).every((r) => r.fromChain === false),
    'with no chain, premiums are Black-Scholes estimates and fromChain=false');
}

// ════════════════════════════════════════════════════════════════════════════
//  buildIronCondor — D6/D7 pinned
// ════════════════════════════════════════════════════════════════════════════
{
  const ic = P.buildIronCondor({ inst: 'NIFTY', spot: 24000, chainStrikes: [], minPoP: 85 });
  ok(ic && ic.legs, 'buildIronCondor returns a structure');
  ok(ic.legs.length === 2, 'DEFECT D6: only TWO legs — this is a short strangle, not an iron condor (backlog)');
  ok(ic.legs.every((l) => l.action === 'SELL'), 'DEFECT D6: both legs are SHORT, there are no protective wings (backlog)');
  ok(!('maxLoss' in ic), 'DEFECT D6: no maxLoss field — the structure has unbounded risk (backlog)');
  ok(ic.lot === 75, 'DEFECT D1: condor lot is 75 (fix: C1c-3)');
  near(ic.maxProfit, ic.credit * 75, 1, 'DEFECT D1: maxProfit = credit × 75 (fix: C1c-3)');
  near(ic.credit, ic.legs[0].premium + ic.legs[1].premium, 0.01, 'credit = sum of both premiums');
  near(ic.upperBreakeven, ic.legs[0].strike + ic.credit, 0.01, 'upper breakeven = CE strike + credit');
  near(ic.lowerBreakeven, ic.legs[1].strike - ic.credit, 0.01, 'lower breakeven = PE strike − credit');

  const expectProduct = +((ic.legs[0].pop / 100) * (ic.legs[1].pop / 100) * 100).toFixed(1);
  ok(ic.combinedPoP === expectProduct,
    'DEFECT D7: combinedPoP = popCE × popPE, which assumes the two breaches are independent (backlog)');
  ok(ic.combinedPoP < Math.min(ic.legs[0].pop, ic.legs[1].pop),
    'DEFECT D7: the product is strictly below either leg — spot cannot pierce both sides, so this understates PoP (backlog)');

  ok(P.buildIronCondor({ inst: 'NIFTY', spot: 24000, chainStrikes: [], minPoP: 99.999 }) === null,
    'buildIronCondor returns null when either side has no candidate');
}

// ════════════════════════════════════════════════════════════════════════════
//  payoffCurve
// ════════════════════════════════════════════════════════════════════════════
{
  const legs = [{ action: 'SELL', type: 'CE', strike: 24500, premium: 40 },
                { action: 'SELL', type: 'PE', strike: 23500, premium: 38 }];
  const c = P.payoffCurve(legs, 24000, 75, 41);
  ok(c.length === 41, 'payoffCurve returns `points` samples');
  near(c[0].spot, 24000 * 0.96, 0.01, 'curve starts at spot × 0.96');
  near(c[40].spot, 24000 * 1.04, 0.01, 'curve ends at spot × 1.04');
  const mid = c.find((p) => p.spot >= 24000);
  near(mid.pnl, 78 * 75, 200, 'between the strikes the payoff ≈ full credit × lot');
  ok(c[0].pnl < 0 && c[40].pnl < 0, 'both tails lose money (short strangle)');
  ok(c.every((p) => Number.isFinite(p.pnl)), 'payoff is finite everywhere');
}

// ════════════════════════════════════════════════════════════════════════════
//  paper book — D8: module-global mutable state
// ════════════════════════════════════════════════════════════════════════════
{
  const before = P.getBook().length;
  const r = P.sellPoP({ inst: 'NIFTY', side: 'SELL_CE', strike: 24500, type: 'CE', premium: 40, pop: 92 });
  ok(r.ok && r.position.id > 0, 'sellPoP opens a paper position');
  ok(r.position.mode === 'PAPER', 'defaults to PAPER');
  ok(r.position.lot === 75, 'DEFECT D1: position lot defaults to 75 (fix: C1c-3)');
  near(r.position.creditCollected, 40 * 75, 1, 'DEFECT D1: creditCollected = premium × 75 (fix: C1c-3)');

  const c = P.closePoP(r.position.id, 10);
  ok(c.ok && c.position.status === 'CLOSED', 'closePoP closes it');
  near(c.position.pnl, (40 - 10) * 75, 1, 'DEFECT D1: pnl = (entry − exit) × 75, and NO transaction charges are applied (fix: C1c-3)');

  ok(P.closePoP(r.position.id, 10).ok === false, 'closing twice is refused');
  ok(P.closePoP(999999, 0).ok === false, 'closing an unknown id is refused');
  ok(P.getBook().length === before + 1, 'DEFECT D8: _book is module-global and grows across requires');
  const snap = P.getBook();
  ok(snap[0] !== P.getBook()[0], 'getBook returns fresh copies, not live references');
  snap[0].premium = -1;
  ok(P.getBook()[0].premium !== -1, 'mutating the returned book does not corrupt internal state');
}

// ── live trading is hard-gated ──
{
  const r = P.sellPoP({ inst: 'NIFTY', side: 'SELL_CE', strike: 24500, type: 'CE', premium: 40, tradeMode: 'live', confirmLive: true });
  ok(r.ok === false && /LIVE blocked/.test(r.reason), 'live mode is blocked when POP_LIVE_ENABLED is not "true"');
  const r2 = P.sellPoP({ inst: 'NIFTY', side: 'SELL_CE', strike: 24500, type: 'CE', premium: 40, tradeMode: 'live' });
  ok(r2.ok === false, 'live mode without confirmLive is blocked');
  ok(P.popStatus().liveEnabled === false, 'popStatus reports liveEnabled=false');
}

console.log(`\n${pass} assertions passed`);
