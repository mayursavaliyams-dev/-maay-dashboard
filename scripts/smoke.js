#!/usr/bin/env node
/**
 * smoke — Phase 1.4. The fast pre-deploy gate. Run: npm run smoke
 *
 * Under two minutes, run every time, no exceptions. It does not try to be
 * thorough; `npm test` is thorough. It answers one question: is the order path
 * intact enough to deploy?
 *
 * WHY IT PRINTS WHAT IT CANNOT CHECK
 *
 * The brief's smoke suite is: the system starts, self-checks pass, a paper order
 * flows end to end through the intended path, the kill switch stops it, and
 * reconciliation runs. Two of those five capabilities do not exist in this
 * codebase yet. A suite that silently omitted them would report a green gate
 * over a hole, which is the failure this whole programme is about.
 *
 * So uncovered steps are printed as NOT COVERED with the reason, on every run.
 * They do not fail the gate — a gate that can never pass is ignored within a
 * week — but they are impossible to stop seeing, and the count is in the
 * summary line. When the capability lands, its step is flipped to covered in
 * the same commit.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const t0 = Date.now();

let passed = 0, failed = 0, uncovered = 0;
const fails = [];

const step = async (label, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${label}`);
  } catch (e) {
    failed++;
    fails.push({ label, error: e.message });
    console.log(`  ✗ ${label}\n      ${e.message}`);
  }
};
const notCovered = (label, why) => {
  uncovered++;
  console.log(`  ○ NOT COVERED — ${label}\n      ${why}`);
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

/* Kill-switch state is written to a scratch file. A smoke run must never touch
   the real one — a test that trips the production kill switch has caused the
   incident it was checking for. */
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-smoke-'));

async function main() {
  console.log('\nsmoke — order path\n');

  /* ── 1. the system's order-path modules load ──────────────────────────── */
  let riskConfig, KillSwitch, RiskManager, RiskGuardedBroker, harness;
  await step('order-path modules load', () => {
    riskConfig = require(path.join(ROOT, 'risk-config.js'));
    ({ KillSwitch } = require(path.join(ROOT, 'kill-switch.js')));
    ({ RiskManager } = require(path.join(ROOT, 'risk-manager.js')));
    ({ RiskGuardedBroker } = require(path.join(ROOT, 'risk-guard.js')));
    harness = require(path.join(ROOT, 'parity-harness.js'));
    assert(riskConfig && KillSwitch && RiskManager && RiskGuardedBroker && harness, 'a module failed to load');
  });

  const CFG = { ...riskConfig.DEFAULTS };
  const cfg = () => CFG;
  const quiet = { warn() {}, error() {}, log() {} };
  const NOW = 1_700_000_000_000;

  const HEALTHY = () => ({
    equity: 700000, startOfDayEquity: 700000, peakEquityToday: 700000,
    dayRealisedPnl: 0, deployed: 100000, deployedByUnderlying: { NIFTY: 100000 },
    openPositions: 2, lotsByInstrument: { NIFTY: 2 },
    greeks: { delta: 200, gamma: 5, vega: 500, theta: -1200 },
    totalRisk: 40000, riskByExpiry: { '2026-08-06': 10000 },
    riskByStrike: { 'NIFTY|24300|CE': 5000 },
    isExpiryDay: false, minutesToClose: 180, dataAgeMs: 500, consecutiveLosses: 0,
  });
  const INTENT = () => ({
    strategy: 'STRANGLE', instrument: 'NIFTY', strike: 24300, optionType: 'CE',
    side: 'BUY', expiry: '2026-08-06', stopDistance: 20, lotSize: 65, requestedLots: 2,
    marginVerdict: { fits: true, required: 92694, marginSource: 'broker', projectedPeak: 300000, projectedUtilisationPct: 43 },
  });

  /* A clock that ADVANCES. An approval token is `RA-<ms>-<hash of intent>`, so
     two identical intents issued in the same millisecond receive the same token
     and the second is refused as a replay. That fails closed and is therefore
     safe, but under a frozen clock it is guaranteed rather than improbable —
     which would make this harness measure the clock instead of the move.
     Deterministic and collision-free, so parity stays reproducible. */
  const makeClock = () => { let t = NOW; return () => (t += 1); };

  const makeGuard = (broker, ks) => {
    const now = makeClock();
    return new RiskGuardedBroker(broker, {
      riskManager: new RiskManager({ cfg, log: quiet, now }),
      killSwitch: ks, log: quiet, now,
    });
  };

  /* ── 2. an unguarded guard cannot be built ────────────────────────────── */
  await step('constructing a guard without a risk manager is refused', () => {
    let threw = false;
    try { new RiskGuardedBroker(new harness.ScriptedBroker(), {}); } catch { threw = true; }
    assert(threw, 'a guard was constructed with no risk manager — it would look guarded and not be');
  });

  /* ── 3. a paper order flows end to end through the intended path ──────── */
  let broker, guard;
  await step('an APPROVED order reaches the broker through the chokepoint', async () => {
    broker = new harness.ScriptedBroker();
    guard = makeGuard(broker, null);
    const d = guard.requestApproval(INTENT(), HEALTHY());
    assert(d.approved, 'the risk layer refused a healthy intent — the baseline is broken');
    const res = await guard.placeOrder({
      instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY', lots: 2,
      quantity: 130, approval: d.approval,
    });
    assert(res && res.orderId, 'no order id came back');
    assert(broker.submissions.length === 1, `expected 1 broker submission, saw ${broker.submissions.length}`);
  });

  /* ── 4. an unapproved order does not ──────────────────────────────────── */
  await step('an UNAPPROVED order is refused before it reaches the broker', async () => {
    const b = new harness.ScriptedBroker();
    const g = makeGuard(b, null);
    let code = null;
    try {
      await g.placeOrder({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY', lots: 2 });
    } catch (e) { code = e.code; }
    assert(code === 'RISK_NO_APPROVAL', `expected RISK_NO_APPROVAL, got ${code}`);
    assert(b.submissions.length === 0, 'an unapproved order reached the broker');
  });

  /* ── 5. one decision authorises one order ─────────────────────────────── */
  await step('an approval cannot be replayed', async () => {
    const b = new harness.ScriptedBroker();
    const g = makeGuard(b, null);
    const d = g.requestApproval(INTENT(), HEALTHY());
    const order = { instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY', lots: 2, approval: d.approval };
    await g.placeOrder(order);
    let code = null;
    try { await g.placeOrder({ ...order }); } catch (e) { code = e.code; }
    assert(code === 'RISK_APPROVAL_REUSED', `expected RISK_APPROVAL_REUSED, got ${code}`);
    assert(b.submissions.length === 1, `a replayed approval produced ${b.submissions.length} submissions`);
  });

  /* ── 6. the kill switch stops it, at SEND time ────────────────────────── */
  await step('the kill switch stops an already-approved order at send time', async () => {
    const b = new harness.ScriptedBroker();
    const ks = new KillSwitch({ cfg, log: quiet, now: () => NOW, file: path.join(SCRATCH, 'kill-state.json') });
    const g = makeGuard(b, ks);
    const d = g.requestApproval(INTENT(), HEALTHY());          // approved while healthy
    assert(d.approved, 'baseline approval failed');
    ks.trip({ reason: 'SMOKE_TEST', detail: 'smoke suite', by: 'smoke' });   // then the world changes
    let code = null;
    try {
      await g.placeOrder({ instrument: 'NIFTY', strike: 24300, optionType: 'CE', side: 'BUY', lots: 2, approval: d.approval });
    } catch (e) { code = e.code; }
    assert(code === 'RISK_KILLED', `expected RISK_KILLED, got ${code}`);
    assert(b.submissions.length === 0, 'an order got out after the kill switch tripped');
  });

  /* ── 7. parity across all four recorded sessions ──────────────────────── */
  await step('guarded and raw paths submit identically on all four recorded sessions', async () => {
    const fixtures = harness.allFixtures();
    assert(fixtures.length === 4, `expected 4 fixtures, found ${fixtures.length} — run scripts/build-order-fixtures.js`);

    for (const fx of fixtures) {
      const rawBroker = new harness.ScriptedBroker();
      const rawRun = await harness.replay(fx, async (i, b) => b.placeOrder({
        instrument: i.instrument, strike: i.strike, optionType: i.optionType,
        side: i.side, lots: i.lots, quantity: i.quantity,
      }), rawBroker);

      /* The guard's clock follows the FIXTURE's own timestamps. The captured
         intents are ~5 minutes apart; replaying them against a clock that
         advances by a millisecond would present a whole session as a burst and
         latch the order breaker — measuring the harness rather than the move.
         Driving the clock from `intent.at` replays the real cadence. */
      let simNow = NOW;
      const gBroker = new harness.ScriptedBroker();
      const g = new RiskGuardedBroker(gBroker, {
        riskManager: new RiskManager({ cfg, log: quiet, now: () => simNow }),
        killSwitch: null, log: quiet, now: () => simNow,
      });
      const gRun = await harness.replay(fx, async (i) => {
        const t = Date.parse(i.at);
        simNow = Number.isFinite(t) ? t : simNow + 1;
        /* The state carries an explicit ZERO for the strike being opened.
           That is not a convenience: the risk layer treats a strike ABSENT from
           riskByStrike as UNEVALUABLE and blocks it, so a caller supplying only
           held strikes could never open a new position. See the characterization
           test, section 8 — the defect is pinned there and fixed separately.
           Supplying the complete map here keeps this step measuring the MOVE
           rather than that defect. */
        const state = HEALTHY();
        state.riskByStrike[`${i.instrument}|${i.strike}|${i.optionType}`] ??= 0;
        const d = g.requestApproval({ ...INTENT(), instrument: i.instrument, strike: i.strike, optionType: i.optionType, side: i.side, requestedLots: i.lots }, state);
        if (!d.approved) throw Object.assign(new Error(`risk refused: ${d.blocks.map(b => `${b.name}:${b.status}`).join(',')}`), { code: 'RISK_BLOCKED' });
        return g.placeOrder({
          instrument: i.instrument, strike: i.strike, optionType: i.optionType,
          side: i.side, lots: i.lots, quantity: i.quantity, approval: d.approval,
        });
      }, gBroker);

      /* The ONE accepted difference, named explicitly: a guarded order carries an
         approval field a raw order does not. Anything else fails the gate. */
      const r = harness.diff(rawRun, gRun, { accept: ['field:approval'] });
      assert(r.identical, `${fx.character} (${fx.session}) diverged:\n${harness.report(r, 'raw', 'guarded')}`);
    }
  });

  /* ── 8. the capabilities that do not exist yet ────────────────────────── */
  notCovered('startup self-check gates arming',
    'no in-process self-check exists; `npm run preflight` is a separate manual command and the server arms regardless. See docs/073 §3.');
  notCovered('position reconciliation against the broker',
    'no code compares internal positions to broker positions. Building it on live-connector.getPositions() would be unsound while that returns [] on error — see docs/074 §0.6 B4.');

  /* ── summary ──────────────────────────────────────────────────────────── */
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n  ${passed} passed · ${failed} failed · ${uncovered} not covered · ${secs}s`);
  if (Number(secs) > 120) console.log('  ⚠ smoke exceeded its 120s budget — it will start being skipped');
  if (failed) {
    console.log('\n  DO NOT DEPLOY:');
    for (const f of fails) console.log(`    · ${f.label} — ${f.error}`);
  }
  try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch { /* scratch dir; nothing depends on it */ }
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error('\nsmoke crashed: ' + e.stack); process.exit(1); });
