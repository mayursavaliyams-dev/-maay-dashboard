/**
 * risk-layer — every limit fired individually, and the chokepoint proven.
 * Run: node test/risk-layer.test.js
 *
 * @test:unit @test:characterization @test:regression @test:failure
 * @test:integration @test:boundary @test:security @test:rollback
 *
 * THE STRUCTURAL CLAIM BEING TESTED
 *
 * "No order may reach the broker without passing through the risk layer."
 *
 * That is not a claim about discipline, and it cannot be tested by checking that
 * engines call a function — eight call sites reach `placeOrder` in this repo and
 * a ninth will be added by someone who has not read this file. It is tested by
 * showing that the guarded broker REFUSES an order carrying no approval, a
 * forged approval, a reused approval, a stale approval, or an approval for a
 * different instrument, strike, side or size.
 *
 * THE OTHER CLAIM: FAIL CLOSED
 *
 * Every check has three outcomes, never two: PASS, BLOCKED, and UNEVALUABLE.
 * The third is the one that matters. A limit that cannot be measured — missing
 * equity, absent greeks, an unreadable position book — blocks. If it passed, the
 * layer's own blind spots would be the widest hole in it, and they would be
 * invisible precisely because nothing could see them.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };
const ROOT = path.join(__dirname, '..');

const code = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const riskConfig = require(path.join(ROOT, 'risk-config.js'));
const { KillSwitch } = require(path.join(ROOT, 'kill-switch.js'));
const { RiskManager, sizeFromRisk } = require(path.join(ROOT, 'risk-manager.js'));
const { RiskGuardedBroker } = require(path.join(ROOT, 'risk-guard.js'));

const CFG = { ...riskConfig.DEFAULTS };
const cfg = () => CFG;
const quiet = { warn() {}, error() {}, log() {} };

/* A portfolio state in which every single limit is comfortably satisfied. Each
   test below breaks exactly ONE field of it, so a block can only be attributed
   to the limit under test. */
const HEALTHY = () => ({
  equity: 700000, startOfDayEquity: 700000, peakEquityToday: 700000,
  dayRealisedPnl: 0, deployed: 100000, deployedByUnderlying: { NIFTY: 100000 },
  openPositions: 2, lotsByInstrument: { NIFTY: 2 },
  greeks: { delta: 200, gamma: 5, vega: 500, theta: -1200 },
  totalRisk: 40000, riskByExpiry: { '2026-08-06': 10000 },
  riskByStrike: { 'NIFTY|24300|CE': 5000 },
  isExpiryDay: false, minutesToClose: 180, dataAgeMs: 500, consecutiveLosses: 0,
});

/* The margin verdict is part of the intent, not part of the state, because it is
   about THIS basket rather than about the portfolio. An intent without one is
   refused — see the marginHeadroom cases below. */
const INTENT = () => ({
  strategy: 'STRANGLE', instrument: 'NIFTY', strike: 24300, optionType: 'CE',
  side: 'BUY', expiry: '2026-08-06', stopDistance: 20, lotSize: 65, requestedLots: 2,
  marginVerdict: { fits: true, required: 92694, marginSource: 'broker', projectedPeak: 300000, projectedUtilisationPct: 43 },
});

const mgr = () => new RiskManager({ cfg, log: quiet, now: () => 1_700_000_000_000 });
let _pending = Promise.resolve();

console.log('\nrisk layer\n');

/* ── 0. the baseline must pass, or nothing below means anything ──────────── */
console.log('baseline');
{
  const d = mgr().evaluate(INTENT(), HEALTHY());
  ok(d.approved, 'a healthy portfolio and a well-formed intent are approved');
  ok(d.checks.every(c => c.status === 'PASS'), `all ${d.checks.length} checks pass — so a block below is attributable to one field`);
  ok(d.approval && d.approval.lots > 0, `and it is sized (${d.approval.lots} lots)`);
}

/* ── 1. every limit, fired individually ──────────────────────────────────── */
console.log('\nevery limit blocks, one at a time');

const fires = [
  ['maxDeployed', s => { s.deployed = 700000 * 0.9; }, 'capital deployed over the overall limit'],
  ['maxDeployedPerUnderlying', s => { s.deployedByUnderlying.NIFTY = 700000 * 0.5; s.deployed = 700000 * 0.5; }, 'capital deployed in ONE underlying over its limit'],
  ['maxOpenPositions', s => { s.openPositions = CFG.RISK_MAX_OPEN_POSITIONS; }, 'open position count at the limit'],
  ['dayLossLimit', s => { s.dayRealisedPnl = -700000 * 0.04; }, 'day realised loss past the day stop'],
  ['dayTrailingDrawdown', s => { s.peakEquityToday = 750000; s.equity = 700000; }, 'equity below the day peak by more than the trailing stop'],
  ['netDelta', s => { s.greeks.delta = 99999; }, 'net delta over its limit'],
  ['netGamma', s => { s.greeks.gamma = 9999; }, 'net gamma over its limit'],
  ['netVega', s => { s.greeks.vega = 999999; }, 'net vega over its limit'],
  ['netTheta', s => { s.greeks.theta = -999999; }, 'net theta magnitude over its limit'],
  ['concentrationByExpiry', s => { s.riskByExpiry['2026-08-06'] = 39000; }, 'too much risk in one expiry'],
  ['concentrationByStrike', s => { s.riskByStrike['NIFTY|24300|CE'] = 39000; }, 'too much risk at one strike'],
  ['dataFreshness', s => { s.dataAgeMs = 60000; }, 'market data too stale'],
];

for (const [limit, breakIt, why] of fires) {
  const st = HEALTHY(); breakIt(st);
  const d = mgr().evaluate(INTENT(), st);
  const hit = d.blocks.find(b => b.name === limit);
  ok(!d.approved && hit, `${limit}: blocked — ${why}`);
  ok(hit && hit.observed !== null && hit.threshold !== null,
    `  …and the block carries the observed value (${hit && hit.observed}) and the threshold (${hit && hit.threshold})`);
}

// Lots per instrument depends on the intent, not only on state.
{
  const st = HEALTHY(); st.lotsByInstrument.NIFTY = CFG.RISK_MAX_LOTS_PER_INSTRUMENT;
  const d = mgr().evaluate({ ...INTENT(), requestedLots: 1 }, st);
  ok(!d.approved && d.blocks.some(b => b.name === 'maxLotsPerInstrument'),
    'maxLotsPerInstrument: blocked — held lots plus requested lots exceed the cap');
}

/* ── 1b. margin headroom — refuse before the broker does ─────────────────── */
console.log('\nmargin headroom');
{
  const noVerdict = { ...INTENT() };
  delete noVerdict.marginVerdict;
  const d = mgr().evaluate(noVerdict, HEALTHY());
  ok(!d.approved && d.blocks.some(b => b.name === 'marginHeadroom'),
    'an intent with NO margin verdict is refused — the basket was never priced against headroom');
  ok(d.checks.find(c => c.name === 'marginHeadroom').status === 'UNEVALUABLE',
    '  …as UNEVALUABLE: it was not priced, which is different from being priced and too big');
}
{
  const d = mgr().evaluate({ ...INTENT(), marginVerdict: { fits: false, reason: 'HEADROOM', required: 180959, usableLimit: 665000, detail: 'projected peak ₹720000 exceeds the usable limit ₹665000' } }, HEALTHY());
  const hit = d.blocks.find(b => b.name === 'marginHeadroom');
  ok(!d.approved && hit && hit.status === 'BLOCKED',
    'a basket that does not fit is BLOCKED before it is sent, not rejected by the broker afterwards');
  ok(/exceeds the usable limit/.test(hit.detail), '  …and the block carries the numbers, not just a verdict');
}
{
  const d = mgr().evaluate({ ...INTENT(), marginVerdict: { fits: false, reason: 'MARGIN_UNKNOWN', detail: 'cannot price this basket with the broker', required: null } }, HEALTHY());
  ok(d.checks.find(c => c.name === 'marginHeadroom').status === 'UNEVALUABLE',
    'a basket the broker could not price is UNEVALUABLE — and still blocks');
}
{
  const d = mgr().evaluate({ ...INTENT(), marginVerdict: { fits: false, reason: 'STOP_ENTRIES', detail: 'projected utilisation 88% is past the 85% stop-entries threshold', required: 92694 } }, HEALTHY());
  ok(!d.approved, 'and the stop-entries utilisation threshold blocks too');
}

/* ── 2. expiry day is a different rule set ───────────────────────────────── */
console.log('\nexpiry day');
{
  /* Chosen to sit BETWEEN the two limits. Equity is ₹7 lakh, so gamma 20 is
     2.86 per lakh: inside the normal limit of 8, outside the expiry limit of 2.
     A value inside both would prove nothing, which is what the first version of
     this test did. */
  const st = HEALTHY();
  st.greeks.gamma = 20;
  const normal = mgr().evaluate(INTENT(), st);
  ok(normal.approved, 'gamma of 20 — 2.86 per ₹1 lakh — is fine on a normal day (limit 8)');

  st.isExpiryDay = true;
  const expiry = mgr().evaluate(INTENT(), st);
  ok(!expiry.approved && expiry.blocks.some(b => b.name === 'netGamma'),
    'the SAME gamma blocks on expiry day — the tighter limit is what this section exists for');
  ok(expiry.checks.find(c => c.name === 'netGamma').detail.includes('EXPIRY DAY'),
    'and the record says which limit set was applied');
}
{
  const st = HEALTHY(); st.isExpiryDay = true; st.minutesToClose = 30;
  const d = mgr().evaluate(INTENT(), st);
  ok(!d.approved && d.blocks.some(b => b.name === 'expiryNoNewEntry'),
    `no new entries inside ${CFG.RISK_EXPIRY_NO_NEW_ENTRY_MIN_BEFORE_CLOSE} minutes of an expiry close`);
}
{
  const st = HEALTHY(); st.isExpiryDay = true; st.minutesToClose = null;
  const d = mgr().evaluate(INTENT(), st);
  ok(!d.approved, 'and an UNKNOWN time to close on expiry day blocks, rather than being read as plenty of time');
}

/* ── 3. fail closed — the part that decides whether any of this works ────── */
console.log('\nfail closed');
const unevaluable = [
  ['maxDeployed', s => { s.equity = null; }, 'equity unknown'],
  ['netGamma', s => { s.greeks = null; }, 'greeks entirely absent'],
  ['netVega', s => { s.greeks.vega = null; }, 'ONE greek absent — stale greeks are not zero greeks'],
  ['maxOpenPositions', s => { s.openPositions = null; }, 'position count unreadable'],
  ['dayLossLimit', s => { s.startOfDayEquity = null; }, 'start-of-day equity unknown'],
  ['dayTrailingDrawdown', s => { s.peakEquityToday = null; }, "today's peak unknown"],
  ['concentrationByExpiry', s => { s.riskByExpiry = {}; }, 'risk by expiry unknown'],
  ['dataFreshness', s => { s.dataAgeMs = null; }, 'data age unknown'],
];
for (const [limit, breakIt, why] of unevaluable) {
  const st = HEALTHY(); breakIt(st);
  const d = mgr().evaluate(INTENT(), st);
  const hit = d.checks.find(c => c.name === limit);
  ok(!d.approved, `${limit}: blocked when ${why}`);
  ok(hit && hit.status === 'UNEVALUABLE',
    `  …and it is marked UNEVALUABLE, not BLOCKED — "we could not measure it" and "it is too big" are different facts`);
}
{
  const saved = CFG.RISK_FAIL_MODE;
  CFG.RISK_FAIL_MODE = 'WARN';
  const st = HEALTHY(); st.greeks = null;
  const d = mgr().evaluate(INTENT(), st);
  ok(d.approved, 'RISK_FAIL_MODE=WARN lets an unevaluable limit through — a deliberate, logged decision');
  ok(d.checks.some(c => c.status === 'UNEVALUABLE'), 'and the unevaluable check is still recorded as such');
  CFG.RISK_FAIL_MODE = saved;
}

/* ── 4. sizing from risk, not from capital ───────────────────────────────── */
console.log('\nsizing');
{
  const a = sizeFromRisk({ equity: 700000, stopDistance: 20, lotSize: 65, cfg: CFG });
  const b = sizeFromRisk({ equity: 700000, stopDistance: 40, lotSize: 65, cfg: CFG });
  ok(a.ok && b.ok, 'both size');
  ok(b.lots < a.lots, `a WIDER stop gives FEWER lots (${a.lots} → ${b.lots}) — this is the whole difference from sizing off capital`);
  /* What flooring actually guarantees, stated exactly rather than approximated:
     the rupee risk NEVER exceeds the budget, and falls short of it by less than
     one lot's worth. Both stops therefore risk the same amount up to the
     granularity of a lot — which is the property, and the reason a wider stop
     buys fewer lots rather than more risk. */
  const budget = 700000 * CFG.RISK_PER_TRADE_RISK_PCT / 100;
  for (const [label, s] of [['20-point stop', a], ['40-point stop', b]]) {
    ok(s.riskIfStopped <= budget + 1e-9,
      `${label}: risk if stopped ₹${s.riskIfStopped} never exceeds the ₹${budget} budget`);
    ok(budget - s.riskIfStopped < s.lossPerLot,
      `  …and falls short by less than one lot (₹${(budget - s.riskIfStopped).toFixed(0)} < ₹${s.lossPerLot})`);
  }
}
{
  const s = sizeFromRisk({ equity: 700000, stopDistance: 20, lotSize: 65, cfg: CFG, kelly: { winRate: 0.91, payoff: 0.4 } });
  ok(s.ok && s.effectivePct <= CFG.RISK_PER_TRADE_RISK_PCT,
    `a strong Kelly edge is still capped by the hard budget (${s.effectivePct}% ≤ ${CFG.RISK_PER_TRADE_RISK_PCT}%)`);
  ok(/capped by/.test(s.kellyNote || ''), 'and the record shows Kelly proposed more and was capped');
}
{
  const s = sizeFromRisk({ equity: 700000, stopDistance: 20, lotSize: 65, cfg: CFG, kelly: { winRate: 0.3, payoff: 0.5 } });
  ok(!s.ok && s.reason === 'KELLY_NEGATIVE_EDGE',
    'a NEGATIVE Kelly edge sizes to zero — never to a small positive number, which is how a losing strategy keeps trading');
}
ok(sizeFromRisk({ equity: 700000, stopDistance: null, lotSize: 65, cfg: CFG }).reason === 'STOP_UNDEFINED',
  'no stop distance refuses — risk-based sizing is undefined without one and falling back to capital would change the risk silently');
ok(sizeFromRisk({ equity: 700000, stopDistance: 20, lotSize: null, cfg: CFG }).reason === 'LOT_SIZE_UNKNOWN',
  'an unknown lot size refuses rather than guessing — a guessed lot is a fabricated rupee figure');
ok(sizeFromRisk({ equity: 1000, stopDistance: 500, lotSize: 65, cfg: CFG }).reason === 'BELOW_MIN_SIZE',
  'and when even one lot exceeds the budget the trade is refused, not rounded up');

/* ── 5. the kill switch ──────────────────────────────────────────────────── */
console.log('\nkill switch');
const tmp = () => path.join(os.tmpdir(), `ks-${process.pid}-${Math.floor(Math.random() * 1e9)}.json`);
{
  const f = tmp();
  const ks = new KillSwitch({ cfg, log: quiet, file: f, now: () => 1000 });
  ok(!ks.blocksNewEntries(), 'starts clear');

  ks.evaluate({ dayPnlPct: -5, consecutiveLosses: 0, dataAgeMs: 100 });
  ok(ks.blocksNewEntries() && ks.status().reason === 'DAY_LOSS_LIMIT', 'trips on the day loss limit');

  ks.evaluate({ dayPnlPct: 0, consecutiveLosses: 99, dataAgeMs: 100 });
  ok(ks.status().reason === 'DAY_LOSS_LIMIT',
    'a later trigger does NOT overwrite the first reason — the first cause is the diagnostic one');

  const revived = new KillSwitch({ cfg, log: quiet, file: f, now: () => 2000 });
  ok(revived.blocksNewEntries(), 'and it SURVIVES a restart — a switch that clears on restart is a pause, not a kill switch');

  ok(revived.reset({ by: '' }).ok === false, 'reset refuses without a named human');
  const r = revived.reset({ by: 'mayur', note: 'reviewed the log' });
  ok(r.ok && !revived.blocksNewEntries(), 'a named human can reset it');
  ok(revived.status().history.some(h => h.event === 'RESET' && h.by === 'mayur'), 'and the reset is recorded with who did it');
  fs.rmSync(f, { force: true });
}
{
  const f = tmp();
  const ks = new KillSwitch({ cfg, log: quiet, file: f, now: () => 1000 });
  ks.evaluate({ dayPnlPct: 0, consecutiveLosses: 0, dataAgeMs: 999999 });
  ok(ks.status().reason === 'DATA_STALE', 'trips on data staleness');
  fs.rmSync(f, { force: true });
}
{
  const f = tmp();
  const ks = new KillSwitch({ cfg, log: quiet, file: f, now: () => 1000 });
  for (let i = 0; i < CFG.RISK_KILL_ERROR_WINDOW; i++) ks.noteBrokerCall(i % 2 === 0);
  ok(ks.status().reason === 'BROKER_ERROR_RATE', 'trips on the broker error rate over a full window');
  fs.rmSync(f, { force: true });
}
{
  const f = tmp();
  const ks = new KillSwitch({ cfg, log: quiet, file: f, now: () => 1000 });
  ks.noteBrokerCall(false);
  ok(!ks.blocksNewEntries(),
    'but NOT on one failed call out of one — a partial window would trip on the first hiccup of the morning');
  fs.rmSync(f, { force: true });
}
{
  const f = tmp();
  fs.writeFileSync(f, '{ this is not json');
  const ks = new KillSwitch({ cfg, log: quiet, file: f, now: () => 1000 });
  ok(ks.blocksNewEntries() && ks.status().reason === 'STATE_UNREADABLE',
    'a CORRUPT state file reads as TRIPPED — the alternative is that a crash on a bad day silently resets the switch');
  fs.rmSync(f, { force: true });
}
{
  const f = tmp();
  const ks = new KillSwitch({ cfg, log: quiet, file: f, now: () => 1000 });
  ks.evaluate({ dayPnlPct: null, consecutiveLosses: 0, dataAgeMs: 100 });
  ok(ks.status().reason === 'UNEVALUABLE',
    'and it trips when it CANNOT TELL whether the day loss limit is breached');
  fs.rmSync(f, { force: true });
}

/* ── 6. the chokepoint ───────────────────────────────────────────────────── */
console.log('\nthe chokepoint');
{
  const sent = [];
  const raw = { placeOrder: async (o) => { sent.push(o); return { orderId: 'X1' }; }, getPositions: async () => ['p'] };
  const rm = mgr();
  const g = new RiskGuardedBroker(raw, { riskManager: rm, log: quiet, now: () => 1_700_000_000_000 });

  await0(async () => {
    await assertThrows(() => g.placeOrder({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY', lots: 2 }),
      'RISK_NO_APPROVAL', 'an order with NO approval is refused');
    ok(sent.length === 0, 'and nothing reached the broker');

    await assertThrows(() => g.placeOrder({ instrument: 'NIFTY', approval: { token: 'FORGED' } }),
      'RISK_UNKNOWN_APPROVAL', 'a forged token is refused');

    const d = g.requestApproval(INTENT(), HEALTHY());
    ok(d.approved, 'a healthy intent is approved');

    await assertThrows(() => g.placeOrder({ instrument: 'NIFTY', strike: 24300, optionType: 'PE', side: 'BUY', lots: 2, approval: d.approval }),
      'RISK_APPROVAL_MISMATCH', 'an approval for a CE cannot send a PE');
    await assertThrows(() => g.placeOrder({ instrument: 'BANKNIFTY', strike: 24300, optionType: 'CE', side: 'BUY', lots: 2, approval: d.approval }),
      'RISK_APPROVAL_MISMATCH', 'nor a different instrument');
    await assertThrows(() => g.placeOrder({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY', lots: 999, approval: d.approval }),
      'RISK_APPROVAL_MISMATCH', 'nor more lots than were approved');

    const okRes = await g.placeOrder({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY', lots: d.approval.lots, approval: d.approval });
    ok(okRes.orderId === 'X1' && sent.length === 1, 'a matching order goes through, exactly once');

    await assertThrows(() => g.placeOrder({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY', lots: d.approval.lots, approval: d.approval }),
      'RISK_APPROVAL_REUSED', 'and the same approval cannot be replayed');

    const d2 = g.requestApproval(INTENT(), HEALTHY());
    const gOld = new RiskGuardedBroker(raw, { riskManager: rm, log: quiet, ttlMs: 1, now: () => Date.parse(d2.approval.issuedAt) + 60000 });
    gOld._issued.set(d2.approval.token, d2.approval);
    await assertThrows(() => gOld.placeOrder({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY', lots: d2.approval.lots, approval: d2.approval }),
      'RISK_APPROVAL_STALE', 'an approval issued about an older market expires');

    ok((await g.getPositions())[0] === 'p', 'reads pass straight through — only order placement is gated');
    ok(sent.length === 1, 'and the broker still saw exactly one order in total');
  });
}
{
  let threw = false;
  try { new RiskGuardedBroker({ placeOrder: async () => {} }, {}); } catch (_) { threw = true; }
  ok(threw, 'constructing a guard with NO risk manager is refused — an unguarded guard is worse than none');
}

/* ── 7. limits are configurable and every change is logged ───────────────── */
console.log('\nconfiguration');
ok(Object.keys(riskConfig.DEFAULTS).length >= 25, `${Object.keys(riskConfig.DEFAULTS).length} limits, all in config`);
ok(riskConfig.DEFAULTS.RISK_ENABLED === true,
  'the layer is ON by default — a risk layer that must be switched on will be off on the day it is needed');
ok(riskConfig.DEFAULTS.RISK_FAIL_MODE === 'BLOCK', 'and fails closed by default');
{
  process.env.RISK_DAY_LOSS_LIMIT_PCT = 'nonsense';
  const r = riskConfig.reload({ by: 'test', log: quiet });
  ok(r.config.RISK_DAY_LOSS_LIMIT_PCT === riskConfig.DEFAULTS.RISK_DAY_LOSS_LIMIT_PCT,
    'an unparseable limit falls back to its default — NaN compares false against everything, which DISABLES the check');
  ok(r.rejected.some(x => x.key === 'RISK_DAY_LOSS_LIMIT_PCT'), 'and the refusal is reported');
  delete process.env.RISK_DAY_LOSS_LIMIT_PCT;
  const r2 = riskConfig.reload({ by: 'test', log: quiet });
  ok(r2.changes.length === 0 || r2.changes.every(c => c.by === 'test'), 'reload records who made a change');
}
ok(/changes\.push/.test(code('risk-config.js')) && /log\.warn/.test(code('risk-config.js')),
  'a limit change is logged at WARNING level, whichever direction it moved');

/* ── 8. the wiring ───────────────────────────────────────────────────────── */
console.log('\nwiring');
const SERVER = code('server.js');
ok(/new RiskGuardedBroker\(live/.test(SERVER), 'the server wraps the real broker in the guard');
ok(/broker: guardedBroker/.test(SERVER), 'and the execution engine is handed the GUARDED broker, not the raw one');
ok(/riskConfig\.reload\(\{ by: 'startup' \}\)/.test(SERVER), 'limits are read at startup');
ok(/\/api\/risk\/reload/.test(SERVER), 'and re-loadable without a restart');
ok(/\/api\/risk\/kill\/reset/.test(SERVER), 'the kill switch has an explicit reset endpoint');

/* The chokepoint section is asynchronous, so the count is printed once it has
   settled. Printing it synchronously reported 88 while a dozen assertions were
   still in flight — a passing test that had not finished running. */
_pending.then(() => console.log(`\n${n} checks passed\n`));

/* ── helpers ─────────────────────────────────────────────────────────────── */
function await0(fn) {
  _pending = fn().catch(e => { console.error('\nFAILED: ' + e.message); process.exit(1); });
  return _pending;
}
async function assertThrows(fn, code, msg) {
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  ok(err && err.code === code, `${msg} (${err ? err.code : 'no error thrown'})`);
}
