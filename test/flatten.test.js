/**
 * broker-positions + flatten — Task 2. Run: node test/flatten.test.js
 *
 * @test:unit @test:failure @test:boundary @test:integration @test:security
 *
 * P1: "a human must always be able to see every open position and flatten it,
 *  independent of the bot, including when the system is dead or lying."
 *
 * The tests are weighted towards LYING rather than dead. A dead system is
 * obvious. A system that returns an empty array because its broker call failed,
 * and a screen that renders that as "no open positions", is the case that loses
 * money quietly — and it is the current behaviour of both connectors.
 */
'use strict';

const assert = require('assert');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };
const ROOT = path.join(__dirname, '..');
const { readBrokerPositions, renderText, normalise } = require(path.join(ROOT, 'broker-positions.js'));
const { flattenAll } = require(path.join(ROOT, 'flatten.js'));

const quiet = { warn() {}, error() {}, log() {} };
const NOW = 1_800_000_000_000;

/* A broker stand-in. `positions` is what getPositions resolves to; `sendFail`
   names a securityId whose exit should fail. */
function mkBroker(opts = {}) {
  const b = {
    connected: opts.connected !== false,
    sent: [],
    _positions: opts.positions || [],
    async getPositions() {
      if (opts.readThrows) throw new Error('boom');
      if (opts.readNonArray) return null;
      return b._positions;
    },
    approveReducing(intent) {
      b.approvals = (b.approvals || 0) + 1;
      return { approved: true, approval: { token: `RA-RED-${b.approvals}`, reducing: true, why: 'REDUCING', ...intent } };
    },
    async placeOrder(o) {
      if (!o.approval) throw Object.assign(new Error('no approval'), { code: 'RISK_NO_APPROVAL' });
      if (opts.sendFail && o.securityId === opts.sendFail) throw Object.assign(new Error('exchange rejected'), { code: 'BROKER_REJECT' });
      b.sent.push(o);
      // Closing removes the leg, so the read-back afterwards is truthful.
      b._positions = b._positions.filter(p => String(p.securityId) !== String(o.securityId));
      return { orderId: `O${b.sent.length}` };
    },
  };
  return b;
}

function mkKill(opts = {}) {
  let tripped = !!opts.startTripped;
  return {
    trips: 0,
    trip(x) { this.trips++; if (!opts.refuseToTrip) tripped = true; return { ok: true, x }; },
    blocksNewEntries() { return tripped; },
    status() { return { tripped }; },
  };
}

const LEG = (o) => ({ securityId: o.id, tradingSymbol: o.sym, strikePrice: o.strike, optionType: o.type, netQty: o.qty, exchangeSegment: 'NSE_FNO', productType: 'INTRADAY' });

console.log('\nbroker-positions + flatten\n');

(async () => {

/* ═══════════════════════════════════════════════════════════════════════════
   2a · THE POSITIONS VIEW
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('2a · the read-only view');
{
  const b = mkBroker({ positions: [
    LEG({ id: 1, sym: 'NIFTY24300CE', strike: 24300, type: 'CE', qty: -130 }),
    LEG({ id: 2, sym: 'NIFTY24500CE', strike: 24500, type: 'CE', qty: 65 }),
    LEG({ id: 3, sym: 'NIFTY24000PE', strike: 24000, type: 'PE', qty: 0 }),
  ] });
  const v = await readBrokerPositions(b);
  ok(v.status === 'POSITIONS', 'a non-empty broker reply is reported as POSITIONS');
  ok(v.legCount === 3, 'legCount counts everything the broker returned (3)');
  ok(v.openLegs === 2, 'openLegs counts only non-zero quantities (2) — a closed leg would send the operator hunting');
  ok(v.shortLegs === 1 && v.longLegs === 1, 'short and long are counted separately — the flatten needs the order');
  ok(v.positions[0].side === 'SHORT' && v.positions[1].side === 'LONG', 'side is derived from the sign of the quantity');
}

console.log('\n2a · THE BRANCH THAT MATTERS — empty is not flat');
{
  const b = mkBroker({ positions: [] });
  const v = await readBrokerPositions(b);
  ok(v.status === 'EMPTY_UNVERIFIABLE',
    'an empty broker reply is EMPTY_UNVERIFIABLE — never "flat"');
  ok(/cannot be read as "no positions"/.test(v.reason), 'and the reason says why in words the operator can act on');
  ok(/Do not treat this screen as evidence that you are flat/.test(v.operatorAction),
    'and the operator is told explicitly not to trust it');
  const txt = renderText(v);
  ok(!/no open positions/i.test(txt) && !/0 open/i.test(txt),
    'the rendered text never says "no open positions" — the phrase that would cause the harm');

  ok((await readBrokerPositions(mkBroker({ readThrows: true }))).status === 'UNAVAILABLE', 'a throwing read is UNAVAILABLE');
  ok((await readBrokerPositions(mkBroker({ readNonArray: true }))).status === 'UNAVAILABLE', 'a non-array reply is UNAVAILABLE');
  ok((await readBrokerPositions({})).status === 'UNAVAILABLE', 'a connector with no getPositions is UNAVAILABLE, not empty');
  ok((await readBrokerPositions(null)).status === 'UNAVAILABLE', 'and so is no connector at all');
}

console.log('\n2a · the view consults no internal state');
{
  const src = require('fs').readFileSync(path.join(ROOT, 'broker-positions.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  ok(!/positions-book|openPosition|strangleEngine|paper/i.test(src),
    'broker-positions.js references no internal book — a lying system cannot hide a leg from it');
}

/* ═══════════════════════════════════════════════════════════════════════════
   2b · THE FLATTEN
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n2b · kill first, and confirm');
{
  const b = mkBroker({ positions: [LEG({ id: 1, sym: 'X', strike: 1, type: 'CE', qty: -65 })] });
  const k = mkKill();
  const r = await flattenAll({ broker: b, killSwitch: k, log: quiet, now: () => NOW });
  ok(k.trips === 1, 'the kill switch is tripped');
  ok(r.steps[0].step === 'kill-switch' && r.steps[0].ok, 'and it is the FIRST step, before any exit');
  ok(b.sent.length === 1, 'then the exit is sent');
}
{
  const b = mkBroker({ positions: [LEG({ id: 1, sym: 'X', strike: 1, type: 'CE', qty: -65 })] });
  const k = mkKill({ refuseToTrip: true });
  const r = await flattenAll({ broker: b, killSwitch: k, log: quiet, now: () => NOW });
  ok(r.outcome === 'REFUSED', 'a kill switch that does not take effect REFUSES the flatten');
  ok(b.sent.length === 0, 'and NOTHING is sent — exits into an armed bot are a race the operator loses');
  ok(/broker app/.test(r.operatorAction), 'the operator is redirected to the path that works');
}
{
  const b = mkBroker({ positions: [LEG({ id: 1, sym: 'X', strike: 1, type: 'CE', qty: -65 })] });
  const r = await flattenAll({ broker: b, killSwitch: null, log: quiet, now: () => NOW });
  ok(r.outcome === 'REFUSED' && b.sent.length === 0, 'no kill switch at all → refused, nothing sent');
}

console.log('\n2b · short legs before long legs');
{
  const b = mkBroker({ positions: [
    LEG({ id: 'LONG_WING', sym: 'W', strike: 24500, type: 'CE', qty: 65 }),
    LEG({ id: 'SHORT_BODY', sym: 'B', strike: 24300, type: 'CE', qty: -130 }),
    LEG({ id: 'UNKNOWN', sym: 'U', strike: 24100, type: 'PE', qty: null }),
  ] });
  const r = await flattenAll({ broker: b, killSwitch: mkKill(), log: quiet, now: () => NOW });
  const order = r.results.map(x => x.leg.securityId);
  ok(order[0] === 'SHORT_BODY', 'the SHORT leg is exited first');
  ok(order[2] === 'LONG_WING', 'the LONG protective leg is exited LAST — closing a hedge first is how defined risk becomes undefined');
  ok(order[1] === 'UNKNOWN', 'an unknown-side leg sits between them — it might be a hedge, so it is not closed before the shorts');
  ok(b.sent.every(o => o.orderType === 'MARKET'), 'every exit is a MARKET order — a flatten does not chase limits');
  ok(b.sent[0].transactionType === 'BUY', 'closing a SHORT sends BUY');
  ok(b.sent.find(o => o.securityId === 'LONG_WING').transactionType === 'SELL', 'closing a LONG sends SELL');
}

console.log('\n2b · every exit carries a reducing approval');
{
  const b = mkBroker({ positions: [LEG({ id: 1, sym: 'X', strike: 1, type: 'CE', qty: -65 })] });
  await flattenAll({ broker: b, killSwitch: mkKill(), log: quiet, now: () => NOW });
  ok(b.sent[0].approval && b.sent[0].approval.reducing === true,
    'the exit goes THROUGH the chokepoint with a REDUCING approval — recorded and counted, never refusable');
  ok(b.approvals === 1, 'one approval per leg, not a reused one');
}

console.log('\n2b · partial is not success');
{
  const b = mkBroker({
    positions: [
      LEG({ id: 'A', sym: 'A', strike: 1, type: 'CE', qty: -65 }),
      LEG({ id: 'B', sym: 'B', strike: 2, type: 'PE', qty: -65 }),
    ],
    sendFail: 'B',
  });
  const r = await flattenAll({ broker: b, killSwitch: mkKill(), log: quiet, now: () => NOW });
  ok(r.outcome === 'PARTIAL', 'one failed leg makes the whole run PARTIAL, not a success with a footnote');
  ok(r.stillOpen.length === 1 && r.stillOpen[0].securityId === 'B', 'the survivor is named');
  ok(/NOT FLAT/.test(r.operatorAction), 'and the operator action begins with NOT FLAT');
  ok(r.failed.length === 1 && r.failed[0].code === 'BROKER_REJECT', 'the failure carries its code');
}
/* CORRECTED 2026-07-31. This first asserted `FLAT` for a clean run. It is not
   FLAT: after closing the last leg the broker returns an empty list, and this
   connector returns an empty list when the call FAILS too (A5). So every exit
   was sent and none was rejected, and the result still cannot be verified.
   FLAT is the word an operator acts on by walking away, and it was not earned.
   The code was changed to distinguish the two, and this asserts the
   distinction rather than papering over it. */
{
  const b = mkBroker({ positions: [LEG({ id: 'A', sym: 'A', strike: 1, type: 'CE', qty: -65 })] });
  const r = await flattenAll({ broker: b, killSwitch: mkKill(), log: quiet, now: () => NOW });
  ok(r.outcome === 'SENT_UNVERIFIED',
    'a clean run against a connector that cannot verify reports SENT_UNVERIFIED — not FLAT, which was never earned');
  ok(r.failed.length === 0 && r.results.every(x => x.sent), 'every leg WAS sent and none was rejected');
  ok(/Open the broker app and confirm/.test(r.operatorAction), 'and the operator is told to confirm, not that it is done');
  ok(r.after.status === 'EMPTY_UNVERIFIABLE', 'the read-back is what it is — unverifiable, and said so');
}
{
  /* The same run against a connector that CAN verify: an honest FLAT is still
     reachable, so the distinction above is not a permanent downgrade. */
  const b = mkBroker({ positions: [LEG({ id: 'A', sym: 'A', strike: 1, type: 'CE', qty: -65 })] });
  const realGetPositions = b.getPositions.bind(b);
  let closed = false;
  b.getPositions = async () => (closed ? [LEG({ id: 'A', sym: 'A', strike: 1, type: 'CE', qty: 0 })] : realGetPositions());
  const realPlace = b.placeOrder.bind(b);
  b.placeOrder = async (o) => { const r = await realPlace(o); closed = true; return r; };
  const r = await flattenAll({ broker: b, killSwitch: mkKill(), log: quiet, now: () => NOW });
  ok(r.outcome === 'FLAT',
    'against a broker whose read-back is verifiable (a zero-quantity leg, not an empty list), a clean run DOES report FLAT');
}

console.log('\n2b · a leg that cannot be described is not silently skipped');
{
  const b = mkBroker({ positions: [{ tradingSymbol: 'NO_ID', netQty: -65 }] });
  const r = await flattenAll({ broker: b, killSwitch: mkKill(), log: quiet, now: () => NOW });
  ok(b.sent.length === 0, 'a leg with no securityId cannot be exited');
  ok(r.outcome === 'PARTIAL' || r.outcome === 'UNEVALUABLE', `and the run does not claim success (${r.outcome})`);
  ok(r.results[0].error && /securityId/.test(r.results[0].error), 'the reason is recorded against that leg');
}

console.log('\n2b · an unverifiable book blocks the flatten but keeps the kill');
{
  const b = mkBroker({ positions: [] });
  const k = mkKill();
  const r = await flattenAll({ broker: b, killSwitch: k, log: quiet, now: () => NOW });
  ok(r.outcome === 'UNEVALUABLE', 'an empty-unverifiable book gives UNEVALUABLE, not NOTHING_TO_DO');
  ok(k.blocksNewEntries() === true, 'and the kill switch STAYS tripped — the safe residue');
  ok(b.sent.length === 0, 'nothing was sent');
}

/* ═══════════════════════════════════════════════════════════════════════════
   2c · THE RATIFIED PATH, END TO END, THROUGH THE REAL GUARD
   Not a scripted approveReducing — the real RiskGuardedBroker, the real
   RiskManager, the real OrderBreaker, and a kill switch that is TRIPPED.
   This is the claim the decision rests on: an emergency exit cannot be blocked.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n2c · through the REAL guard, with kill switch AND breaker tripped');
{
  const os = require('os');
  const riskConfig = require(path.join(ROOT, 'risk-config.js'));
  const { RiskManager } = require(path.join(ROOT, 'risk-manager.js'));
  const { RiskGuardedBroker } = require(path.join(ROOT, 'risk-guard.js'));
  const { KillSwitch } = require(path.join(ROOT, 'kill-switch.js'));
  const { OrderBreaker } = require(path.join(ROOT, 'order-breaker.js'));

  let t = NOW;
  const clock = () => (t += 1);
  const raw = mkBroker({ positions: [
    LEG({ id: 'SHORT', sym: 'S', strike: 24300, type: 'CE', qty: -130 }),
    LEG({ id: 'WING', sym: 'W', strike: 24500, type: 'CE', qty: 65 }),
  ] });

  const ks = new KillSwitch({
    cfg: riskConfig.get, log: quiet, now: clock,
    file: path.join(os.tmpdir(), `ag-flatten-${process.pid}.json`),
  });
  const guard = new RiskGuardedBroker(raw, {
    riskManager: new RiskManager({ cfg: riskConfig.get, log: quiet, now: clock }),
    killSwitch: ks,
    breaker: new OrderBreaker({ cfg: () => ({ BREAKER_MAX_PER_WINDOW: 1 }), now: clock, log: quiet }),
    log: quiet, now: clock,
  });

  ks.trip({ reason: 'TEST_EMERGENCY', detail: 'kill switch already tripped', by: 'test' });
  ok(ks.blocksNewEntries() === true, 'the kill switch is tripped BEFORE the flatten starts');

  const r = await flattenAll({ broker: guard, killSwitch: ks, log: quiet, now: () => NOW });

  ok(raw.sent.length === 2,
    'BOTH exits reached the broker through the real guard with the kill switch tripped');
  ok(raw.sent[0].securityId === 'SHORT' && raw.sent[1].securityId === 'WING',
    'and in the right order — short before the protective wing');
  ok(guard.breaker.isTripped() === true,
    'the breaker latched on the second order (limit was 1) — it counted them');
  ok(raw.sent.length === 2,
    'and the latched breaker did NOT stop the second exit — a trapped position is the worst failure');
  ok(raw.sent.every(o => o.approval && o.approval.reducing === true),
    'every exit carried a REDUCING approval issued by the real risk manager');
  ok(raw.sent.every(o => /REDUCING/.test(o.approval.why)),
    'labelled REDUCING in the audit trail — distinguishable from an evaluated approval');
  ok(r.outcome === 'SENT_UNVERIFIED' || r.outcome === 'FLAT', `and the run settled (${r.outcome})`);

  /* The door is one-way: it must not be usable to OPEN anything. */
  let entryCode = null;
  try {
    const d = guard.requestApproval({
      strategy: 'X', instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY',
      expiry: '2026-08-06', stopDistance: 20, lotSize: 65, requestedLots: 1,
      marginVerdict: { fits: true, required: 1, marginSource: 'broker', projectedPeak: 1, projectedUtilisationPct: 1 },
    }, { equity: 700000, riskMapComplete: true, totalRisk: 1, riskByExpiry: {}, riskByStrike: {}, deployedByUnderlying: {}, lotsByInstrument: {}, greeks: { delta: 0, gamma: 0, vega: 0, theta: 0 }, openPositions: 0, deployed: 0, dayRealisedPnl: 0, startOfDayEquity: 700000, peakEquityToday: 700000, isExpiryDay: false, minutesToClose: 180, dataAgeMs: 100, consecutiveLosses: 0 });
    if (!d.approved) throw Object.assign(new Error('blocked'), { code: 'RISK_BLOCKED' });
    await guard.placeOrder({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY', lots: 1, approval: d.approval });
  } catch (e) { entryCode = e.code; }
  ok(entryCode !== null,
    `an ENTRY is still refused while the kill switch is tripped (${entryCode}) — the reducing door did not open the building`);
}

console.log('\n2b · dry run');
{
  const b = mkBroker({ positions: [LEG({ id: 1, sym: 'X', strike: 1, type: 'CE', qty: -65 })] });
  const r = await flattenAll({ broker: b, killSwitch: mkKill(), log: quiet, now: () => NOW, dryRun: true });
  ok(r.outcome === 'DRY_RUN' && b.sent.length === 0, 'a dry run plans and sends nothing');
  ok(r.plan.length === 1, 'and reports the plan for review');
}

console.log(`\n${n} assertions passed`);
})().catch(e => { console.error('\n✗ ' + (e.stack || e.message)); process.exit(1); });
