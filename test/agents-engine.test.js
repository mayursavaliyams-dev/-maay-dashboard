/**
 * AI Agents engine — unit tests. Run: node test/agents-engine.test.js
 */
'use strict';
const assert = require('assert');
const ag = require('../agents-engine');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };

console.log('AI Agents engine');

const now = Date.now();
const item = (over = {}) => ({
  id: 'x', title: 'Reliance acquires stake in solar firm', summary: '', url: '', source: 'et',
  sourceName: 'ET', ts: now - 30 * 60000, publishedAt: new Date(now - 1800000).toISOString(),
  sentiment: { score: 40, label: 'BULLISH', confidence: 70 }, stocks: ['RELIANCE'], sectors: ['Energy'],
  impactScore: 60, weight: 1, ...over,
});

// ── 1. News Scout: deal detection ──
{
  const evs = ag.detectDealEvents([item(), item({ id: 'y', title: 'Weather update for Mumbai', ts: now - 60000 })], { now });
  ok(evs.length === 1, 'deal-class headline detected, non-deal ignored');
  ok(evs[0].eventType === 'M&A / STAKE', 'acquisition classified as M&A / STAKE');
  const old = ag.detectDealEvents([item({ ts: now - 30 * 3600000 })], { now });
  ok(old.length === 0, 'stale (>24h) events dropped');
  const order = ag.detectDealEvents([item({ id: 'z', title: 'L&T bags order worth Rs 5000 crore' })], { now });
  ok(order[0].eventType === 'ORDER / DEAL', 'order win classified as ORDER / DEAL');
}

// ── 2. Impact Analyst: probability with parameters ──
{
  const im = ag.computeImpact(ag.detectDealEvents([item()], { now })[0], { now });
  ok(im.direction === 'UP', 'bullish deal → direction UP');
  ok(im.probability > 50 && im.probability <= 92, `probability in sane band (${im.probability}%)`);
  ok(im.params && im.params.sentimentStrength === 40 && im.params.eventTypeWeight === 1,
     'parameters disclosed (sentimentStrength, eventTypeWeight, …)');
  ok(im.stockImpacts.length === 1 && im.stockImpacts[0].symbol === 'RELIANCE', 'affected stock named');
  ok(im.indexBias.NIFTY > 0 && im.indexBias.SENSEX > im.indexBias.NIFTY, 'heavyweight pulls SENSEX more than NIFTY (higher weight)');
  const bear = ag.computeImpact(ag.detectDealEvents([item({ sentiment: { score: -50, label: 'BEARISH', confidence: 70 } })], { now })[0], { now });
  ok(bear.direction === 'DOWN' && bear.indexBias.NIFTY < 0, 'bearish deal → DOWN + negative index bias');
  const flat = ag.computeImpact(ag.detectDealEvents([item({ sentiment: { score: 0, label: 'NEUTRAL', confidence: 35 } })], { now })[0], { now });
  ok(flat.direction === 'FLAT' && flat.probability <= 40, 'no sentiment → FLAT, probability capped low');
}

// ── 3. Signal Agent: master × news fusion ──
{
  const m = { decision: 'BUY', direction: 'BULLISH', probability: 68 };
  const conf = ag.combineSignal(m, +8);
  ok(conf.aligned && conf.probability > 68, 'aligned news boosts probability');
  const opp = ag.combineSignal(m, -8);
  ok(opp.opposed && opp.probability < 68, 'opposing news trims probability');
  ok(ag.combineSignal(m, 0).probability === 68, 'quiet news leaves master probability unchanged');
  ok(ag.combineSignal(null, 5).decision === 'HOLD', 'missing master → HOLD, never invents a trade');
  const hold = ag.combineSignal({ decision: 'HOLD', direction: 'NEUTRAL', probability: 52 }, 9);
  ok(hold.decision === 'HOLD' && !hold.aligned, 'HOLD master stays HOLD even with news bias');
}

// ── 4. Risk Manager: gate logic ──
{
  const base = { inMarketHours: true, decision: 'BUY', probability: 70, minProb: 65, vixExtreme: false,
    eventRisk: 20, maxTrades: 3, tradesToday: 0, hasOpen: false, dailyLossHit: false, pastSquareOff: false, lots: 1 };
  ok(ag.riskGate(base).go === true, 'all checks pass → GO');
  ok(ag.riskGate({ ...base, probability: 60 }).go === false, 'below probability floor → NO-GO');
  ok(ag.riskGate({ ...base, decision: 'HOLD' }).go === false, 'HOLD → NO-GO');
  ok(ag.riskGate({ ...base, vixExtreme: true }).go === false, 'extreme VIX → NO-GO');
  ok(ag.riskGate({ ...base, tradesToday: 3 }).go === false, 'trade cap reached → NO-GO');
  ok(ag.riskGate({ ...base, hasOpen: true }).go === false, 'open position → NO-GO (one at a time)');
  ok(ag.riskGate({ ...base, dailyLossHit: true }).go === false, 'daily loss cap → NO-GO');
  ok(ag.riskGate({ ...base, pastSquareOff: true }).go === false, 'past last-entry time → NO-GO');
  ok(ag.riskGate(base).checks.length === 10, 'all 10 checks reported (transparent gate)');
}

// ── 5. Executor: paper book entry/exit ──
{
  const eng = new ag.AgentsEngine({ enabled: 'true', minProb: 60, qty: 1 });
  eng._tradesFile = require('path').join(require('os').tmpdir(), 'agents-test-trades.json');
  eng._allTrades = [];
  const chain = { atm: 24000, rows: [{ strike: 24000, ce: { ltp: 100 }, pe: { ltp: 95 } }] };
  const { mins } = eng._ist();
  const open = eng._enter('NIFTY', { decision: 'BUY', probability: 72, aligned: true }, chain, mins);
  ok(open && open.action === 'OPEN' && open.side === 'CE' && open.entry === 100, 'BUY signal → paper CE at ATM LTP');
  ok(eng._open.has('NIFTY'), 'position tracked as open');
  // premium hits +40% target
  const up = { atm: 24000, rows: [{ strike: 24000, ce: { ltp: 140 }, pe: { ltp: 60 } }] };
  const closed = eng._manage('NIFTY', eng._open.get('NIFTY'), up, mins);
  ok(closed && closed.action === 'CLOSE' && closed.reason === 'TARGET', 'premium +40% → profit booked (TARGET)');
  ok(closed.pnl > 0 && closed.charges > 0, `P&L net of real charges (₹${closed.pnl}, charges ₹${closed.charges})`);
  ok(!eng._open.has('NIFTY') && eng._closedToday.length === 1, 'book updated after close');
  // stop-loss path
  const open2 = eng._enter('SENSEX', { decision: 'SELL', probability: 70 }, { atm: 77000, rows: [{ strike: 77000, ce: { ltp: 80 }, pe: { ltp: 90 } }] }, mins);
  ok(open2.side === 'PE', 'SELL signal → paper PE');
  const dn = { atm: 77000, rows: [{ strike: 77000, ce: { ltp: 80 }, pe: { ltp: 70 } }] };
  const stopped = eng._manage('SENSEX', eng._open.get('SENSEX'), dn, mins);
  ok(stopped && stopped.reason === 'STOP_LOSS' && stopped.pnl < 0, 'premium -22% → stopped out');
  const st = eng.status();
  ok(st.mode === 'PAPER' && /paper/i.test(st.disclaimer), 'status declares PAPER + disclaimer');
  ok(st.allTime.trades === 2, 'all-time trade ledger counts both');
}

// ── 6. Range gate: the selling-edge conditions ──
{
  const base = { inMarketHours: true, directionalGo: false, decision: 'HOLD', probability: 52, dirMinProb: 65,
    ivp: 62, ivpMin: 50, eventRisk: 10, vix: 13, maxSell: 1, sellsToday: 0, hasOpenCondor: false,
    dailyLossHit: false, pastLastEntry: false, lots: 1 };
  ok(ag.rangeGate(base).go === true, 'quiet market + rich IVP → condor GO');
  ok(ag.rangeGate({ ...base, ivp: 40 }).go === false, 'IVP below 50 → no selling (cheap premium)');
  ok(ag.rangeGate({ ...base, ivp: null }).go === false, 'IVP unavailable → no selling (honest)');
  ok(ag.rangeGate({ ...base, directionalGo: true }).go === false, 'directional play has priority');
  ok(ag.rangeGate({ ...base, eventRisk: 60 }).go === false, 'event risk ≥50 → no condor into events');
  ok(ag.rangeGate({ ...base, vix: 23 }).go === false, 'VIX panic → no selling');
  ok(ag.rangeGate({ ...base, hasOpenCondor: true }).go === false, 'one condor at a time');
  // Phase-1 VRP regime gate
  ok(ag.rangeGate({ ...base, regime: 'SELL-ON' }).go === true, 'regime SELL-ON → condor allowed');
  ok(ag.rangeGate({ ...base, regime: 'STAND-DOWN' }).go === false, 'regime STAND-DOWN → no condor');
  ok(ag.rangeGate({ ...base, regime: 'REDUCE' }).go === false, 'regime REDUCE → no condor (only SELL-ON sells)');
  ok(ag.rangeGate({ ...base, regime: null }).go === true, 'regime unavailable → falls back to IVP check (honest)');
}

// ── 6b. buy gate refuses rich premium ──
{
  const base = { inMarketHours: true, decision: 'BUY', probability: 70, minProb: 65, vixExtreme: false,
    eventRisk: 20, ivp: 80, ivpMaxBuy: 70, maxTrades: 3, tradesToday: 0, hasOpen: false,
    dailyLossHit: false, pastSquareOff: false, lots: 1 };
  ok(ag.riskGate(base).go === false, 'IVP 80 → buying rich premium blocked');
  ok(ag.riskGate({ ...base, ivp: 40 }).go === true, 'IVP 40 → buying cheap premium allowed');
  ok(ag.riskGate({ ...base, ivp: null }).go === true, 'IVP n/a → buy gate unchanged (no false block)');
}

// ── 7. Executor: condor entry / theta-target / stop ──
{
  const eng = new ag.AgentsEngine({ enabled: 'true' });
  eng._tradesFile = require('path').join(require('os').tmpdir(), 'agents-test-trades2.json');
  eng._openFile = require('path').join(require('os').tmpdir(), 'agents-test-open2.json');
  eng._allTrades = [];
  const mkChain = (sce, spe, wce, wpe) => ({ atm: 24000, step: 50, rows: [
    { strike: 24100, ce: { ltp: sce } }, { strike: 23900, pe: { ltp: spe } },
    { strike: 24200, ce: { ltp: wce } }, { strike: 23800, pe: { ltp: wpe } },
  ]});
  const chain = mkChain(60, 55, 25, 22);
  const open = eng._enterCondor('NIFTY', chain, '2026-07-02', 600, { ivp: 62, expiry: '2026-07-09' });
  ok(open && open.strategy === 'IRON_CONDOR', 'condor opened');
  ok(open.credit === 68, 'credit = 60+55-25-22 = 68');
  const pos = eng._openCondor.get('NIFTY');
  ok(pos.legs.shortCE.strike === 24100 && pos.legs.wingCE.strike === 24200, 'shorts ATM±2 steps, wings ±4');
  ok(pos.maxLossDefined > 0, 'defined max loss computed (wings cap the tail)');
  // theta decays the structure: cost-to-close falls to 30 (>50% captured)
  const hold = eng._manageCondor('NIFTY', pos, mkChain(30, 25, 12, 9), '2026-07-03', 600);
  ok(hold && hold.reason === 'TARGET', '≥50% credit captured → profit booked');
  ok(hold.pnl > 0 && hold.charges > 0, `condor P&L net of 4-leg charges (₹${hold.pnl})`);
  // stop path: structure blows out to 1.7× credit
  eng._enterCondor('SENSEX', { atm: 77000, step: 100, rows: [
    { strike: 77200, ce: { ltp: 90 } }, { strike: 76800, pe: { ltp: 85 } },
    { strike: 77400, ce: { ltp: 40 } }, { strike: 76600, pe: { ltp: 35 } },
  ]}, '2026-07-02', 600, {});
  const spos = eng._openCondor.get('SENSEX');
  const stopped = eng._manageCondor('SENSEX', spos, { atm: 77000, step: 100, rows: [
    { strike: 77200, ce: { ltp: 250 } }, { strike: 76800, pe: { ltp: 15 } },
    { strike: 77400, ce: { ltp: 90 } }, { strike: 76600, pe: { ltp: 5 } },
  ]}, '2026-07-02', 650);
  ok(stopped && stopped.reason === 'STOP_LOSS' && stopped.pnl < 0, 'cost ≥1.6× credit → stopped (defined risk)');
  const st = eng.status();
  ok(st.allTime.condor.trades === 2, 'condor bucket tracked separately in stats');
}

// ── 8. learner feedback fires on directional close ──
{
  const eng = new ag.AgentsEngine({ enabled: 'true' });
  eng._tradesFile = require('path').join(require('os').tmpdir(), 'agents-test-trades3.json');
  eng._openFile = require('path').join(require('os').tmpdir(), 'agents-test-open3.json');
  eng._allTrades = [];
  let taught = null;
  eng.onLearn = t => { taught = t; };
  const chain = { atm: 24000, rows: [{ strike: 24000, ce: { ltp: 100 }, pe: { ltp: 95 } }] };
  eng._enter('NIFTY', { decision: 'BUY', probability: 72 }, chain, 600, { trend: 60, oi: 40 });
  eng._manage('NIFTY', eng._open.get('NIFTY'), { atm: 24000, rows: [{ strike: 24000, ce: { ltp: 145 }, pe: { ltp: 60 } }] }, 610);
  ok(taught && taught.result === 'WIN' && taught.factors.trend === 60, 'closed trade teaches the learner (factors + result)');
  ok(ag.snapshotFactors({ a: { score: 5 }, b: { available: false, score: 9 }, c: { kind: 'risk', score: 3 } }).a === 5
     && !('b' in ag.snapshotFactors({ b: { available: false, score: 9 } })), 'factor snapshot keeps only live directional legs');
}

// ── disabled engine does nothing ──
{
  const off = new ag.AgentsEngine({ enabled: 'false' });
  ok(off.tick({}).skipped === 'disabled', 'disabled engine skips tick');
}

// ══════════════════════════════════════════════════════════════════════════════
//  MIGRATION C1b — REGRESSION GUARD: lot size must come from instrument-registry.
//  Bug that shipped: `const LOT = { NIFTY: 75, BANKNIFTY: 35, SENSEX: 20 }` plus
//  `LOT[inst] || 75` silent fallbacks. The broker contract master says 65/30/20.
//  Since P&L is `units = qty × lot`, realized ₹P&L was overstated +15.4% (NIFTY)
//  and +16.7% (BANKNIFTY). These assertions fail loudly if a lot is ever hardcoded.
// ══════════════════════════════════════════════════════════════════════════════
{
  const fs = require('fs'), path = require('path');
  for (const k of ['NIFTY_LOT_SIZE', 'BANKNIFTY_LOT_SIZE', 'SENSEX_LOT_SIZE']) delete process.env[k];
  const registry = require('../instrument-registry');

  // ── source-level guard: no hardcoded lot map, no LOT[] lookups ──
  // Scan EXECUTABLE code only — the migration comments quote the old constants verbatim.
  const src = fs.readFileSync(path.join(__dirname, '..', 'agents-engine.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  ok(/require\(['"]\.\/instrument-registry/.test(src), 'C1b: agents-engine requires instrument-registry');
  ok(!/LOT\[/.test(code), 'C1b: no LOT[...] lookups remain in executable code');
  ok(!/const\s+LOT\s*=\s*\{/.test(code), 'C1b: the hardcoded LOT map is gone from executable code');
  ok(!/lot:\s*(75|35|65|30)\b/.test(code), 'C1b: no `lot: <literal>` assignment survives');
  ok(!/\|\|\s*75\b/.test(code), 'C1b: the `|| 75` silent fallback is gone');

  // ── lot really comes from the registry ──
  const eng = new ag.AgentsEngine({ enabled: 'true', minProb: 60, qty: 1 });
  const s0 = eng.status();
  ok(s0.lotSource === 'instrument-registry', 'C1b: status() advertises the registry as the lot source');
  ok(s0.lotSizes.NIFTY === registry.lotSize('NIFTY') && s0.lotSizes.NIFTY === 65, 'C1b: NIFTY lot 65 from registry');
  ok(s0.lotSizes.SENSEX === 20 && s0.lotSizes.BANKNIFTY === 30, 'C1b: SENSEX 20, BANKNIFTY 30 from registry');

  // ── directional open stamps the registry lot + calcVersion 2 ──
  {
    const chain = { atm: 24000, rows: [{ strike: 24000, ce: { ltp: 100 }, pe: { ltp: 95 } }] };
    const pos = eng._enter('NIFTY', { decision: 'BUY', probability: 72, aligned: true }, chain, 600);
    ok(pos && pos.lot === 65, 'C1b: _enter uses lot 65 (was 75)');
    ok(pos.lotSource === 'instrument-registry' && pos.calcVersion === 2, 'C1b: _enter stamps lotSource + calcVersion 2');
  }

  // ── unknown instrument: refuse, never guess ──
  {
    const e2 = new ag.AgentsEngine({ enabled: 'true', minProb: 60, qty: 1 });
    const chain = { atm: 50000, rows: [{ strike: 50000, ce: { ltp: 100 }, pe: { ltp: 95 } }] };
    ok(e2._enter('FINNIFTY', { decision: 'BUY', probability: 90 }, chain, 600) === null,
      'C1b: unknown instrument → _enter refuses (no `|| 75` guess)');
    ok(registry.lotSize('FINNIFTY') === null, 'C1b: registry itself returns null for FINNIFTY');
  }

  // ── condor open: registry lot + maxLossDefined built from units ──
  // NOTE: _enterCondor returns a SUMMARY ({action, strategy, credit, ...}); the position
  // itself lives in _openCondor. Read it from there, as the suite's condor test does.
  {
    const e3 = new ag.AgentsEngine({ enabled: 'true', qty: 1 });
    e3._tradesFile = require('path').join(require('os').tmpdir(), 'agents-c1b-trades.json');
    e3._openFile = require('path').join(require('os').tmpdir(), 'agents-c1b-open.json');
    e3._allTrades = [];
    const chain = { atm: 24000, step: 50, rows: [
      { strike: 24100, ce: { ltp: 60 } }, { strike: 23900, pe: { ltp: 55 } },
      { strike: 24200, ce: { ltp: 25 } }, { strike: 23800, pe: { ltp: 22 } },
    ] };
    const summary = e3._enterCondor('NIFTY', chain, '2026-07-02', 600, { ivp: 62, expiry: '2026-07-09' });
    ok(summary && summary.strategy === 'IRON_CONDOR', 'C1b: condor opened');
    const pos = e3._openCondor.get('NIFTY');
    ok(pos && pos.lot === 65, 'C1b: _enterCondor uses lot 65 (was 75)');
    ok(pos.calcVersion === 2 && pos.lotSource === 'instrument-registry', 'C1b: condor stamps calcVersion 2');
    const units = pos.qty * pos.lot;
    const expected = +(((e3.wingSteps - e3.shortSteps) * pos.step * units) - pos.credit * units).toFixed(2);
    ok(Math.abs(pos.maxLossDefined - expected) < 0.011, 'C1b: maxLossDefined derived from units (qty × registry lot)');
  }

  // ── legacy preservation: a pre-migration open position closes as v1 ──
  {
    const e4 = new ag.AgentsEngine({ enabled: 'true' });
    const m = e4._closeCalcMeta({ inst: 'NIFTY', qty: 1, lot: 75 }, 1234.5);   // no calcVersion/lotSource
    ok(m.calcVersion === 1, 'C1b: pre-migration position → calcVersion 1');
    ok(m.lotSource === 'legacy-open-position', 'C1b: flagged as a legacy open position');
    ok(m.pnlLegacy === 1234.5, 'C1b: its pnl IS the legacy value');

    const m2 = e4._closeCalcMeta({ inst: 'NIFTY', qty: 1, lot: 65, calcVersion: 2, lotSource: 'instrument-registry' }, 900);
    ok(m2.calcVersion === 2 && m2.lotSource === 'instrument-registry', 'C1b: new position → calcVersion 2');
    ok(m2.pnlLegacy === null, 'C1b: new trade has NO invented legacy counterfactual (pnlLegacy null)');
  }

  // ── reports label legacy vs current ──
  {
    const e5 = new ag.AgentsEngine({ enabled: 'true' });
    const hist = [
      { inst: 'NIFTY', kind: 'DIR', lot: 75, pnl: 1141.62 },        // pre-migration, no calcVersion
      { inst: 'SENSEX', kind: 'DIR', lot: 20, pnl: -935.14 },
    ];
    const before = JSON.stringify(hist);
    let c = e5._calcBreakdown(hist);
    ok(JSON.stringify(hist) === before, 'C1b: _calcBreakdown does not mutate historical records');
    ok(c.legacy.trades === 2 && c.current.trades === 0, 'C1b: legacy-only data → all in the legacy bucket');
    ok(c.mixed === false, 'C1b: not mixed when no v2 trades exist');
    ok(/hardcoded lot/.test(c.legacy.method), 'C1b: legacy method string names the defect');

    c = e5._calcBreakdown([...hist, { inst: 'NIFTY', kind: 'DIR', lot: 65, pnl: 500, calcVersion: 2 }]);
    ok(c.mixed === true, 'C1b: mixed flag flips once both versions exist');
    ok(c.current.trades === 1 && c.current.netPnl === 500, 'C1b: current bucket isolates v2');
    ok(/mixed/.test(c.note), 'C1b: note warns the raw netPnl is mixed');
  }

  // ── backward compatibility: status() shape preserved ──
  {
    const s = new ag.AgentsEngine({ enabled: 'true' }).status();
    for (const k of ['enabled', 'config', 'agents', 'open', 'condors', 'closedToday', 'dayPnl', 'allTime', 'disclaimer']) {
      ok(k in s, `C1b: status().${k} still present (backward compatible)`);
    }
    for (const k of ['trades', 'wins', 'winRate', 'netPnl', 'directional', 'condor']) {
      ok(k in s.allTime, `C1b: status().allTime.${k} still present`);
    }
  }
}

console.log(`\n${pass} assertions passed`);
