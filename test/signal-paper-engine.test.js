/**
 * Signal paper engine — unit tests. Run: node test/signal-paper-engine.test.js
 */
'use strict';
const assert = require('assert');
const E = require('../signal-paper-engine');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const near = (a, b, t, m) => { assert.ok(Math.abs(a - b) <= t, `${m} (got ${a}, want ~${b})`); console.log('  ✓ ' + m); pass++; };

console.log('Signal paper engine');

// quote helper: map of "strikeType" -> ltp
const Q = (map) => (strike, type) => map[`${strike}${type}`] ?? 0;

// ── positionValue / pnl sign conventions ──
{
  const condor = [ {type:'CE',side:'SELL',strike:24500}, {type:'PE',side:'SELL',strike:24300}, {type:'CE',side:'BUY',strike:24600}, {type:'PE',side:'BUY',strike:24200} ];
  const entry = E.positionValue(condor, Q({ '24500CE':40, '24300PE':38, '24600CE':15, '24200PE':14 }));
  near(entry, 40+38-15-14, 1e-6, 'condor entry net credit = sells − buys = 49');
  ok(E.isCredit('IRON_CONDOR'), 'condor is a credit structure');
  // premium decays → profit
  const pos = { legs: condor, entryNet: entry, credit:true, width:300 };
  const nowCheap = E.pnlPoints(pos, Q({ '24500CE':20, '24300PE':18, '24600CE':8, '24200PE':7 }));
  ok(nowCheap > 0, 'condor premium decay → positive P&L');
  const nowRich = E.pnlPoints(pos, Q({ '24500CE':80, '24300PE':70, '24600CE':20, '24200PE':18 }));
  ok(nowRich < 0, 'condor premium expansion → negative P&L');
}

// ── debit spread P&L ──
{
  const debit = [ {type:'CE',side:'BUY',strike:24400}, {type:'CE',side:'SELL',strike:24500} ];
  const entry = E.positionValue(debit, Q({ '24400CE':68, '24500CE':30 }));
  near(entry, 30-68, 1e-6, 'debit entry net = −38 (paid 38)');
  ok(!E.isCredit('DEBIT_SPREAD_CALL'), 'debit spread is not a credit structure');
  const pos = { legs: debit, entryNet: entry, credit:false, width: E.spreadWidth(debit) };
  ok(E.spreadWidth(debit) === 100, 'spread width 100');
  const up = E.pnlPoints(pos, Q({ '24400CE':120, '24500CE':60 }));
  near(up, 22, 0.01, 'debit spread gains: bought 38 now worth 60 → +22');
}

// ── exitDecision: credit target/stop/expiry ──
{
  const cfg = { creditTpFrac:0.5, creditSlMult:1.0, debitTpFrac:0.6, debitSlFrac:0.6, expiryDte:0, exitOnStandDown:true };
  const pos = { credit:true, entryNet:50, width:300 };
  ok(E.exitDecision(pos, 25, 2, 'SELL-ON', cfg).reason === 'TARGET', 'credit +50% credit → TARGET');
  ok(E.exitDecision(pos, -50, 2, 'SELL-ON', cfg).reason === 'STOP', 'credit −1× credit → STOP');
  ok(E.exitDecision(pos, 0, 0, 'SELL-ON', cfg).reason === 'EXPIRY', 'dte 0 → EXPIRY');
  ok(E.exitDecision(pos, 0, 2, 'STAND-DOWN', cfg).reason === 'REGIME_FLIP', 'stand-down → REGIME_FLIP');
  ok(E.exitDecision(pos, 10, 2, 'SELL-ON', cfg).close === false, 'credit small gain → hold');
}

// ── engine lifecycle: open → mark → close → outcome ──
{
  const eng = new E.SignalPaperEngine({ cfg: { minProb: 0 } });
  const plan = { structure:'IRON_CONDOR', regime:'SELL-ON', legs:[
    {type:'CE',side:'SELL',strike:24500},{type:'PE',side:'SELL',strike:24300},
    {type:'CE',side:'BUY',strike:24600},{type:'PE',side:'BUY',strike:24200} ], sizing:{ lots:2 } };
  const entryQ = Q({ '24500CE':40,'24300PE':38,'24600CE':15,'24200PE':14 });
  const pos = eng.open('NIFTY', plan, entryQ, { now: 1000, lotSize: 75, rawP: 0.7 });
  ok(pos && eng.hasOpen('NIFTY'), 'position opened');
  ok(!eng.open('NIFTY', plan, entryQ, { now:1001, lotSize:75 }), 'maxPerInst blocks a 2nd NIFTY position');
  // premium decays a lot → hits +50% target
  const cheapQ = Q({ '24500CE':12,'24300PE':10,'24600CE':6,'24200PE':5 });
  const outs = eng.step(()=>cheapQ, ()=>2, ()=>'SELL-ON', 1000 + 60*60000);
  ok(outs.length === 1, 'one position closed');
  ok(outs[0].reason === 'TARGET' && outs[0].won, 'closed at TARGET as a win');
  ok(outs[0].pnl > 0 && outs[0].rawP === 0.7, 'outcome carries pnl + entry rawP for calibration');
  ok(outs[0].heldMin === 60, 'held-minutes computed');
  ok(!eng.hasOpen('NIFTY'), 'no longer open after close');
  ok(eng.status().allTime.trades === 1 && eng.status().allTime.wins === 1, 'allTime stats updated');
}

// ── disabled / NO_TRADE / low prob guards ──
{
  const eng = new E.SignalPaperEngine({ enabled:false });
  ok(!eng.open('NIFTY', { structure:'IRON_CONDOR', legs:[{type:'CE',side:'SELL',strike:1}] }, ()=>10, {}), 'disabled engine opens nothing');
  const eng2 = new E.SignalPaperEngine({ cfg:{ minProb:60 } });
  ok(!eng2.open('NIFTY', { structure:'NO_TRADE' }, ()=>10, {}), 'NO_TRADE opens nothing');
  ok(!eng2.open('NIFTY', { structure:'IRON_CONDOR', legs:[{type:'CE',side:'SELL',strike:1}] }, ()=>10, { probability:40 }), 'below minProb opens nothing');
}

// ── persistence round-trip ──
{
  const eng = new E.SignalPaperEngine({ cfg:{ minProb:0 } });
  eng.open('SENSEX', { structure:'CREDIT_SPREAD_PUT', legs:[{type:'PE',side:'SELL',strike:78000},{type:'PE',side:'BUY',strike:77800}], sizing:{lots:1} }, Q({'78000PE':50,'77800PE':30}), { now:1, lotSize:20 });
  const snap = JSON.parse(JSON.stringify(eng.toJSON()));
  const eng2 = new E.SignalPaperEngine();
  eng2.load(snap);
  ok(eng2.hasOpen('SENSEX'), 'restored open position');
}

console.log(`\n${pass} assertions passed`);
