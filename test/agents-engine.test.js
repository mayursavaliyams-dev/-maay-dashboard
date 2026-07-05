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

console.log(`\n${pass} assertions passed`);
