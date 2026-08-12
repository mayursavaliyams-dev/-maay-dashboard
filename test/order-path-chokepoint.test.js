/**
 * order-path-chokepoint — Phase 2 proof. Run: node test/order-path-chokepoint.test.js
 *
 * @test:unit @test:integration @test:security @test:failure @test:regression @test:boundary
 *
 * THE CLAIM
 *
 * "There is exactly one point through which every order passes, and going round
 *  it is not merely discouraged but impossible."
 *
 * That claim has three parts and each is tested separately, because the first
 * two were both true in this repository on 2026-07-30 while the whole was
 * false:
 *
 *   1. the guard is constructed BEFORE anything that needs it
 *   2. the raw capability is neutralised, not just unused
 *   3. an automatic breaker latches at the chokepoint, and a closing order is
 *      never one of the things it stops
 *
 * Part 1 exists because the previous defect was invisible to review: the guard
 * was built 2,252 lines after the engines that were supposed to receive it, and
 * every individual line was correct.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };
const ROOT = path.join(__dirname, '..');

const rawLines = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
const code = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

function lineOf(rel, re) {
  const ls = rawLines(rel);
  for (let i = 0; i < ls.length; i++) {
    const t = ls[i].trim();
    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) continue;
    if (re.test(ls[i])) return i + 1;
  }
  return -1;
}

const riskConfig = require(path.join(ROOT, 'risk-config.js'));
const { KillSwitch } = require(path.join(ROOT, 'kill-switch.js'));
const { RiskManager } = require(path.join(ROOT, 'risk-manager.js'));
const { RiskGuardedBroker } = require(path.join(ROOT, 'risk-guard.js'));
const { OrderBreaker } = require(path.join(ROOT, 'order-breaker.js'));
const { ScriptedBroker } = require(path.join(ROOT, 'parity-harness.js'));

const CFG = { ...riskConfig.DEFAULTS };
const quiet = { warn() {}, error() {}, log() {} };
const HEALTHY = () => ({
  equity: 700000, startOfDayEquity: 700000, peakEquityToday: 700000,
  dayRealisedPnl: 0, deployed: 100000, deployedByUnderlying: { NIFTY: 100000 },
  openPositions: 2, lotsByInstrument: { NIFTY: 2 },
  greeks: { delta: 200, gamma: 5, vega: 500, theta: -1200 },
  totalRisk: 40000, riskByExpiry: { '2026-08-06': 10000 },
  riskByStrike: { 'NIFTY|24300|CE': 5000 }, riskMapComplete: true,
  isExpiryDay: false, minutesToClose: 180, dataAgeMs: 500, consecutiveLosses: 0,
});
const INTENT = (o = {}) => ({
  strategy: 'STRANGLE', instrument: 'NIFTY', strike: 24300, optionType: 'CE',
  side: 'BUY', expiry: '2026-08-06', stopDistance: 20, lotSize: 65, requestedLots: 2,
  marginVerdict: { fits: true, required: 92694, marginSource: 'broker', projectedPeak: 300000, projectedUtilisationPct: 43 },
  ...o,
});

const mkClock = (start = 1_700_000_000_000) => { let t = start; const f = () => (t += 1); f.set = (v) => { t = v; }; f.advance = (ms) => { t += ms; }; return f; };
const mkGuard = (broker, extra = {}) => {
  const now = extra.now || mkClock();
  return new RiskGuardedBroker(broker, {
    riskManager: new RiskManager({ cfg: () => CFG, log: quiet, now }),
    log: quiet, now, ...extra,
  });
};

console.log('\norder path — the chokepoint\n');

/* ═══════════════════════════════════════════════════════════════════════════
   1 · CONSTRUCTION ORDER
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('1 · construction order');
{
  const L_GUARD = lineOf('server.js', /const guardedBroker\s*=\s*new RiskGuardedBroker\(/);
  ok(L_GUARD > 0, `guardedBroker is constructed at server.js:${L_GUARD}`);

  const consumers = [
    ['engine', /const engine\s*=\s*new ExecutionEngine\(/],
    ['niftyEngine', /const niftyEngine\s*=\s*new ExecutionEngine\(/],
    ['afternoonEngine', /const afternoonEngine\s*=\s*new AfternoonEngine\(/],
    ['niftyAfternoonEngine', /const niftyAfternoonEngine\s*=\s*new AfternoonEngine\(/],
    ['executionEngine (LimitOrderEngine)', /const executionEngine\s*=\s*new LimitOrderEngine\(/],
    ['amiBridge.registerRoutes', /amiBridge\.registerRoutes\(/],
  ];
  for (const [label, re] of consumers) {
    const at = lineOf('server.js', re);
    ok(at > 0 && at > L_GUARD, `${label} (line ${at}) is constructed AFTER the guard (line ${L_GUARD})`);
  }

  const srv = code('server.js');
  ok((srv.match(/broker: guardedBroker/g) || []).length >= 6,
    'the guard is handed to at least six consumers by name — not reached for from module scope');

  /* THE PROVIDER, NOT ONLY THE CONSUMER.
     On 2026-07-31 the characterization suite asserted that amibroker-bridge.js
     CONTAINS a placeGuarded call — and passed — while server.js was still
     handing that bridge `liveConnector: live` and no `broker` at all. The
     consumer was correct, the wiring was not, and a source-text assertion on
     the consumer could never have seen it. Both ends are now checked. */
  ok(!/liveConnector\s*:/.test(srv),
    'server.js hands no `liveConnector` to anything — the raw handle is not in any deps object');

  const depsBlock = srv.slice(srv.indexOf('amiBridge.registerRoutes'), srv.indexOf('amiBridge.registerRoutes') + 1400);
  ok(/broker:\s*guardedBroker/.test(depsBlock), 'the AmiBroker bridge is handed guardedBroker at its registration site');
  ok(/getRiskState:\s*_riskStateNow/.test(depsBlock), 'and the risk-state builder it needs to use it');
}

/* ═══════════════════════════════════════════════════════════════════════════
   2 · THE RAW CAPABILITY IS NEUTRALISED, NOT MERELY UNUSED
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n2 · bypass is impossible, not just discouraged');
{
  const broker = new ScriptedBroker();
  const before = typeof broker.placeOrder;
  ok(before === 'function', 'before wrapping, the connector has a working placeOrder');

  const guard = mkGuard(broker);

  let code_ = null;
  try { broker.placeOrder({ instrument: 'NIFTY' }); } catch (e) { code_ = e.code; }
  ok(code_ === 'RISK_BYPASS_ATTEMPT',
    'after wrapping, calling the CONNECTOR directly throws RISK_BYPASS_ATTEMPT');
  ok(broker.submissions.length === 0, 'and nothing was submitted by that attempt');

  // A stray reference captured before wrapping is the realistic bypass: a module
  // that stored `live` earlier and calls it later.
  const stashed = broker;
  let code2 = null;
  try { stashed.placeOrder({}); } catch (e) { code2 = e.code; }
  ok(code2 === 'RISK_BYPASS_ATTEMPT', 'a reference stashed elsewhere fails the same way — the object itself is neutralised');

  // …and the guard can still send.
  const d = guard.requestApproval(INTENT(), HEALTHY());
  ok(d.approved, 'the guard still approves a healthy intent');
  return_(guard, d, broker);
}
async function return_(guard, d, broker) {
  await guard.placeOrder({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY', lots: 2, approval: d.approval });
  ok(broker.submissions.length === 1, 'the guard itself still reaches the broker — it captured the method before neutralising the name');
}

/* ═══════════════════════════════════════════════════════════════════════════
   3 · THE AUTOMATIC BREAKER
   ═══════════════════════════════════════════════════════════════════════════ */
(async () => {
  console.log('\n3 · the automatic circuit breaker');

  const order = (o = {}) => ({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY', lots: 2, ...o });

  // rate — across everything
  {
    const clock = mkClock();
    const b = new OrderBreaker({ cfg: () => ({ BREAKER_MAX_PER_WINDOW: 3, BREAKER_DUP_ALLOWED: 99, BREAKER_MAX_PER_INSTRUMENT: 99 }), now: clock, log: quiet });
    const verdicts = [1, 2, 3, 4].map(i => b.check(order({ strike: 24000 + i * 50 })));
    ok(verdicts.slice(0, 3).every(v => v.allowed), 'three orders inside the window are allowed');
    ok(!verdicts[3].allowed && verdicts[3].breaker === 'rate', 'the fourth trips the rate breaker');
    ok(!b.check(order({ strike: 99999 })).allowed, 'and it LATCHES — a later, unrelated order is still refused');
  }

  // per instrument
  {
    const b = new OrderBreaker({ cfg: () => ({ BREAKER_MAX_PER_INSTRUMENT: 2, BREAKER_MAX_PER_WINDOW: 99, BREAKER_DUP_ALLOWED: 99 }), now: mkClock(), log: quiet });
    b.check(order({ instrument: 'SENSEX' })); b.check(order({ instrument: 'SENSEX' }));
    ok(b.check(order({ instrument: 'NIFTY' })).allowed, 'a different instrument is unaffected by another instrument\'s count');
    ok(!b.check(order({ instrument: 'SENSEX', strike: 1 })).allowed, 'the third order for one instrument trips perInstrument');
  }

  // duplicate — the retry-loop signature
  {
    const b = new OrderBreaker({ cfg: () => ({ BREAKER_MAX_PER_WINDOW: 99, BREAKER_MAX_PER_INSTRUMENT: 99, BREAKER_DUP_ALLOWED: 1 }), now: mkClock(), log: quiet });
    ok(b.check(order()).allowed, 'the first order is allowed');
    const v = b.check(order());
    ok(!v.allowed && v.breaker === 'duplicate', 'an IDENTICAL order moments later trips the duplicate breaker');
  }

  // duplicate does not fire on a genuinely different size
  {
    const b = new OrderBreaker({ cfg: () => ({ BREAKER_MAX_PER_WINDOW: 99, BREAKER_MAX_PER_INSTRUMENT: 99, BREAKER_DUP_ALLOWED: 1 }), now: mkClock(), log: quiet });
    b.check(order({ lots: 2 }));
    ok(b.check(order({ lots: 5 })).allowed,
      'a different size is not a duplicate — a strategy asking for more is not a retry loop');
  }

  // reset is explicit and attributed
  {
    const b = new OrderBreaker({ cfg: () => ({ BREAKER_MAX_PER_WINDOW: 1 }), now: mkClock(), log: quiet });
    b.check(order()); b.check(order({ strike: 1 }));
    ok(b.isTripped(), 'tripped');
    let threw = false;
    try { b.reset({}); } catch { threw = true; }
    ok(threw, 'reset without an attributed `by` is refused — an unattributed reset is not a decision');
    b.reset({ by: 'test', note: 'unit' });
    ok(!b.isTripped(), 'an attributed reset clears it');
  }

  // wired at the chokepoint
  {
    const broker = new ScriptedBroker();
    const clock = mkClock();
    const guard = new RiskGuardedBroker(broker, {
      riskManager: new RiskManager({ cfg: () => CFG, log: quiet, now: clock }),
      breaker: new OrderBreaker({ cfg: () => ({ BREAKER_DUP_ALLOWED: 1, BREAKER_MAX_PER_WINDOW: 99, BREAKER_MAX_PER_INSTRUMENT: 99 }), now: clock, log: quiet }),
      log: quiet, now: clock,
    });
    const send = async () => {
      const d = guard.requestApproval(INTENT(), HEALTHY());
      return guard.placeOrder({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY', lots: 2, approval: d.approval });
    };
    await send();
    let code_ = null;
    try { await send(); } catch (e) { code_ = e.code; }
    ok(code_ === 'RISK_BREAKER', 'a duplicate order is refused AT THE CHOKEPOINT with RISK_BREAKER');
    ok(broker.submissions.length === 1, 'and only the first reached the broker');
    ok(guard.status().breaker.tripped === true, 'the guard reports the latched breaker in its status');
  }

  /* ═════════════════════════════════════════════════════════════════════════
     4 · A CLOSING ORDER IS NEVER REFUSED
     Everything above stops risk being added. Applied to an exit they would
     hold a position open in exactly the conditions that tripped them.
     ═════════════════════════════════════════════════════════════════════════ */
  console.log('\n4 · reducing orders always get out');
  {
    const broker = new ScriptedBroker();
    const clock = mkClock();
    const ks = new KillSwitch({ cfg: () => CFG, log: quiet, now: clock, file: path.join(require('os').tmpdir(), `ag-chokepoint-${process.pid}.json`) });
    const guard = new RiskGuardedBroker(broker, {
      riskManager: new RiskManager({ cfg: () => CFG, log: quiet, now: clock }),
      killSwitch: ks,
      breaker: new OrderBreaker({ cfg: () => ({ BREAKER_MAX_PER_WINDOW: 1 }), now: clock, log: quiet }),
      log: quiet, now: clock,
    });

    ks.trip({ reason: 'TEST', detail: 'kill switch is live', by: 'test' });

    // An entry is refused…
    let entryCode = null;
    try {
      const d = guard.requestApproval(INTENT(), HEALTHY());
      if (!d.approved) throw Object.assign(new Error('blocked at approval'), { code: 'RISK_BLOCKED' });
      await guard.placeOrder({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY', lots: 2, approval: d.approval });
    } catch (e) { entryCode = e.code; }
    ok(entryCode === 'RISK_BLOCKED' || entryCode === 'RISK_KILLED',
      `an ENTRY is refused while the kill switch is tripped (${entryCode})`);
    ok(broker.submissions.length === 0, 'and nothing was submitted');

    // …while the exit gets out.
    const r = guard.approveReducing({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'SELL', requestedLots: 2 });
    ok(r.approved && r.approval.reducing === true, 'a reducing order is approved unconditionally');
    ok(/REDUCING/.test(r.approval.why),
      'and it is labelled REDUCING in the audit trail — never indistinguishable from an evaluated approval');

    await guard.placeOrder({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'SELL', lots: 2, approval: r.approval });
    ok(broker.submissions.length === 1, 'the EXIT reached the broker with the kill switch tripped');

    // …and with the breaker latched too.
    const r2 = guard.approveReducing({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'SELL', requestedLots: 2 });
    await guard.placeOrder({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'SELL', lots: 2, approval: r2.approval });
    ok(guard.breaker.isTripped(), 'the breaker latched on that second order');
    ok(broker.submissions.length === 2, 'and the exit still got out — a latched breaker does not trap a position');

    // The reducing door must stay shut to entries.
    let bypass = null;
    try {
      await guard.placeOrder({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY', lots: 2, approval: r2.approval });
    } catch (e) { bypass = e.code; }
    ok(bypass === 'RISK_APPROVAL_REUSED',
      'a reducing approval cannot be replayed to push an entry through — single-use still applies');
  }

  /* ═════════════════════════════════════════════════════════════════════════
     5 · WHO IS ALLOWED TO CALL THE REDUCING DOOR
     approveReducing skips every limit. If it spread to entry paths it would be
     the widest hole in the system, so the callers are enumerated.
     ═════════════════════════════════════════════════════════════════════════ */
  console.log('\n5 · the reducing door has a fixed guest list');
  {
    /* ╔═══════════════════════════════════════════════════════════════════════╗
       ║  THE REDUCING DOOR WAS WIDENED ON 2026-07-31. THIS IS THAT CHANGE.    ║
       ╚═══════════════════════════════════════════════════════════════════════╝

       This set went from 2 to 3. It is the only edit in its commit, on purpose:
       this assertion exists to fail loudly when the door widens, and a widening
       buried among other changes is a widening nobody reviewed.

       ADDED: flatten.js
       WHY:   docs/081 §2c, resolved by the owner 2026-07-31. The manual flatten
              sends exits, and exits must never be refusable. Routing it around
              the guard would have created a second door to the broker — used in
              an emergency, and unrecorded. Through the guard it is recorded,
              counted by the breaker, and labelled REDUCING; and the guard skips
              the kill-switch check and the breaker denial for reducing
              approvals, so an emergency exit cannot be blocked by construction.
       WHERE: flatten.js:_exit(), which the proximity assertion below checks
              unchanged — the regex was NOT widened to accommodate it.

       Anything reaching this door bypasses every risk limit. A fourth entry is
       a risk decision with an owner, not a merge conflict to resolve. */
    const ALLOWED = new Set(['execution-engine.js', 'afternoon-engine.js', 'flatten.js']);
    const files = fs.readdirSync(ROOT).filter(f => f.endsWith('.js'));
    const callers = files.filter(f => /\.approveReducing\s*\(/.test(code(f)) && f !== 'risk-guard.js');
    for (const c of callers) ok(ALLOWED.has(c), `${c} calls approveReducing and is on the allowed list`);
    ok(callers.length === ALLOWED.size,
      `exactly ${ALLOWED.size} files call approveReducing (found ${callers.length}: ${callers.join(', ') || 'none'})`);

    for (const f of ALLOWED) {
      const src = code(f);
      const idx = src.indexOf('approveReducing');
      const window = src.slice(Math.max(0, idx - 1500), idx);
      ok(/_exit\s*\(/.test(window), `${f} calls it from inside an exit path, not an entry path`);
    }
  }

  console.log(`\n${n} assertions passed`);
})().catch(e => { console.error('\n✗ ' + (e.stack || e.message)); process.exit(1); });
