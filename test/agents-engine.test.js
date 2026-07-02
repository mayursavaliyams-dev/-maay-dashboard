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
  ok(ag.riskGate(base).checks.length === 9, 'all 9 checks reported (transparent gate)');
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

// ── disabled engine does nothing ──
{
  const off = new ag.AgentsEngine({ enabled: 'false' });
  ok(off.tick({}).skipped === 'disabled', 'disabled engine skips tick');
}

console.log(`\n${pass} assertions passed`);
