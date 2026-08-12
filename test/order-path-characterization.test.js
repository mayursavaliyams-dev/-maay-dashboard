/**
 * order-path-characterization — Phase 1.1. Pins the order path EXACTLY AS IT IS.
 * Run: node test/order-path-characterization.test.js
 *
 * @test:characterization @test:unit @test:integration @test:failure @test:boundary
 *
 * WHAT A CHARACTERIZATION TEST IS FOR
 *
 * Not correctness. Several assertions below pin behaviour that is WRONG, and
 * they are marked DEFECT. The purpose is to make any unintended change visible
 * while the seven order call sites are moved to the chokepoint in Phase 2. You
 * cannot fix a behaviour you have not first captured, and you cannot prove a
 * move was pure if you never recorded what it moved.
 *
 * EACH DEFECT PINNED HERE HAS A FIXED COUNTERPART TO COME
 *
 * When a defect is fixed, its assertion here is INVERTED in the same commit as
 * the fix, with the DEFECT marker removed. A defect whose characterization test
 * quietly disappears has not been fixed; it has been forgotten.
 *
 * Source of truth for every claim: docs/074-PHASE0-INVENTORY-AND-TRUTH.md
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };
const defect = (c, m) => { n++; assert.ok(c, m); console.log('  ⚠ DEFECT PINNED: ' + m); };
const ROOT = path.join(__dirname, '..');

/* Comments are stripped before any source assertion. A test that can be
   satisfied by prose is a test of the prose. */
const code = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

const lines = (rel) => code(rel).split('\n');

/* ═══════════════════════════════════════════════════════════════════════════
   1 · THE CALL-SITE CENSUS
   The map Phase 2 is drawn against. If a site is added or moved, this fails,
   and it should — an unlisted order path is the whole problem.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n── 1 · call-site census ──');

/* A RAW site is one that reaches placeOrder on something that is not the
   guarded broker. `this.broker.placeOrder` and `guardedBroker.placeOrder` are
   the chokepoint and do not count. */
function orderSites(rel) {
  const out = [];
  lines(rel).forEach((l, i) => {
    if (!/\.placeOrder\s*\(/.test(l)) return;
    if (/\b(this\.broker|guardedBroker|broker)\.placeOrder\s*\(/.test(l)) return;
    out.push({ line: i + 1, text: l.trim() });
  });
  return out;
}

/* MOVED 2026-07-31, Phase 2.3. Each of these files held raw-connector order
   calls — 7 in total. Every one now goes through the chokepoint, so the
   expected count of RAW sites is zero everywhere. The list is kept rather than
   deleted: it is the census the phase was drawn against, and a file
   reappearing here is the regression. */
const RAW_SITES = [
  ['execution-engine.js', 0],
  ['afternoon-engine.js', 0],
  ['amibroker-bridge.js', 0],
  ['server.js', 0],
];
/* risk-guard.js used to hold a `this._broker.placeOrder(order)` call. Since
   Phase 2.4 it captures the raw method at construction and sends through the
   private `_send`, after replacing the connector's own `placeOrder` with a
   thrower — so the raw method is no longer reachable by name anywhere,
   including from inside the guard. Expected count is therefore zero. */
/* Both of these hold the chokepoint, so neither has a RAW site.
   limit-order-engine sends via `this.broker.placeOrder`; risk-guard captures
   the connector's method at construction and sends via the private `_send`
   after replacing the connector's own `placeOrder` with a thrower (Phase 2.4),
   so the raw method is not reachable by name from anywhere — including from
   inside the guard. A positive assertion for each follows below. */
const GUARDED_SITES = [
  ['limit-order-engine.js', 0],
  ['risk-guard.js', 0],
];

let rawTotal = 0;
for (const [file, expected] of RAW_SITES) {
  const sites = orderSites(file);
  ok(sites.length === expected, `${file}: ${sites.length} placeOrder site(s) — expected ${expected}`);
  rawTotal += sites.length;
}
ok(rawTotal === 0, `no order site anywhere holds a connector that is not the guard (found ${rawTotal}; there were 7 before Phase 2.3)`);

for (const [file, expected] of GUARDED_SITES) {
  const sites = orderSites(file);
  ok(sites.length === expected, `${file}: ${sites.length} placeOrder site(s) — expected ${expected}`);
}

/* Which object each site reaches through. This is the distinction the whole
   phase exists to remove. */
/* INVERTED 2026-07-31, Phase 2.3. Every assertion below was a `defect(...)`
   pin naming a raw-connector reach. They are inverted rather than removed. */
const srv = code('server.js');
ok(!/await\s+live\.placeOrder\s*\(/.test(srv),
  'server.js no longer reaches `live.placeOrder` [regression: 2 sites did until 2026-07-31]');
ok(/placeGuarded\(\{/.test(srv), 'server.js routes its order routes through placeGuarded');
ok(/const guardedBroker = new RiskGuardedBroker\(live,/.test(srv),
  'server.js constructs guardedBroker by wrapping `live`');
ok(/broker: guardedBroker/.test(srv),
  'server.js hands guardedBroker to its engines and to the AmiBroker bridge');

for (const f of ['execution-engine.js', 'afternoon-engine.js']) {
  ok(!/this\.live\.placeOrder/.test(code(f)),
    `${f} no longer reaches \`this.live.placeOrder\` [regression: 2 sites each until 2026-07-31]`);
  ok(/placeGuarded\(\{/.test(code(f)), `${f} routes ENTRIES through placeGuarded — evaluated in full`);
  ok(/this\.broker\.approveReducing\(/.test(code(f)), `${f} routes EXITS through approveReducing — recorded, never refused`);
}
ok(!/deps\.liveConnector\.placeOrder/.test(code('amibroker-bridge.js')),
  'amibroker-bridge.js no longer reaches `deps.liveConnector.placeOrder` [regression]');
ok(/placeGuarded\(\{/.test(code('amibroker-bridge.js')),
  'amibroker-bridge.js routes through placeGuarded — an ambiguous SELL is evaluated, not waved through');
ok(/this\.broker\.placeOrder/.test(code('limit-order-engine.js')),
  'limit-order-engine.js reaches `this.broker.placeOrder` — and is handed the guard');

/* ═══════════════════════════════════════════════════════════════════════════
   2 · THE CONSTRUCTION-ORDER DEFECT
   Invisible to review: every line is correct alone, only the order is wrong.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n── 2 · construction order ──');

/* Line numbers are taken from the RAW file, not the comment-stripped copy, so
   they match what a reader sees in an editor. Comment lines are excluded from
   matching instead, which is the part comment-stripping was protecting against
   — risk-guard.js's own header lists call sites in prose. */
function lineOf(rel, re) {
  const ls = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
  for (let i = 0; i < ls.length; i++) {
    const t = ls[i].trim();
    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) continue;
    if (re.test(ls[i])) return i + 1;
  }
  return -1;
}

const L_GUARD = lineOf('server.js', /const guardedBroker\s*=\s*new RiskGuardedBroker\(/);
ok(L_GUARD > 0, `guardedBroker constructed at server.js:${L_GUARD}`);

const CONSUMERS = [
  ['engine (ExecutionEngine)', /const engine\s*=\s*new ExecutionEngine\(/],
  ['niftyEngine (ExecutionEngine)', /const niftyEngine\s*=\s*new ExecutionEngine\(/],
  ['afternoonEngine', /const afternoonEngine\s*=\s*new AfternoonEngine\(/],
  ['niftyAfternoonEngine', /const niftyAfternoonEngine\s*=\s*new AfternoonEngine\(/],
];

/* INVERTED 2026-07-31, Phase 2.2. These four assertions previously read
   `defect(at < L_GUARD)` — pinning that each engine was built ~2,300 lines
   BEFORE the guard and so could not receive it. The construction order has been
   fixed, so the assertion is inverted here rather than deleted: a defect whose
   characterization quietly disappears has not been fixed, it has been
   forgotten. The live ordering assertion now lives in
   test/order-path-chokepoint.test.js as well, where it is the primary claim. */
for (const [label, re] of CONSUMERS) {
  const at = lineOf('server.js', re);
  ok(at > 0, `${label} constructed at server.js:${at}`);
  ok(at > L_GUARD,
    `${label} (line ${at}) is constructed AFTER guardedBroker (line ${L_GUARD}) — it CAN now receive the guard [was a pinned defect until 2026-07-31]`);
}

const L_LIMIT = lineOf('server.js', /const executionEngine\s*=\s*new LimitOrderEngine\(/);
ok(L_LIMIT > L_GUARD,
  `LimitOrderEngine (line ${L_LIMIT}) is constructed AFTER guardedBroker (line ${L_GUARD}) — the one correct ordering`);

/* ═══════════════════════════════════════════════════════════════════════════
   3 · B1 — ONE ORDER INTENT CAN PRODUCE FOUR BROKER SUBMISSIONS
   Behavioural. node-fetch is replaced in the require cache so the real retry
   loop runs against a scripted transport.
   ═══════════════════════════════════════════════════════════════════════════ */
console.log('\n── 3 · order retry behaviour (B1/B2/B3) ──');

function withFakeFetch(impl, fn) {
  const fetchPath = require.resolve('node-fetch');
  const savedFetch = require.cache[fetchPath];
  const clientPath = require.resolve(path.join(ROOT, 'dhan-client.js'));
  const savedClient = require.cache[clientPath];

  require.cache[fetchPath] = { id: fetchPath, filename: fetchPath, loaded: true, exports: impl };
  delete require.cache[clientPath];
  try {
    const DhanClient = require(clientPath);
    return fn(DhanClient);
  } finally {
    if (savedFetch) require.cache[fetchPath] = savedFetch; else delete require.cache[fetchPath];
    if (savedClient) require.cache[clientPath] = savedClient; else delete require.cache[clientPath];
  }
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const FAKE_TOKEN = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 86400, dhanClientId: '1100000000' })}.sig`;

function res(status, body) {
  return {
    status, ok: status >= 200 && status < 300,
    headers: { get: () => null },
    text: async () => JSON.stringify(body ?? {}),
  };
}

(async () => {
  /* B1 — a 500 on order placement is retried */
  await withFakeFetch(
    async () => res(500, { errorMessage: 'server error' }),
    async (DhanClient) => {
      const calls = [];
      const client = new DhanClient({ clientId: '1100000000', accessToken: FAKE_TOKEN });
      const orig = client._requestUncoalesced.bind(client);
      // Count actual transport attempts by counting throttle passes.
      let attempts = 0;
      const realThrottle = client._throttle.bind(client);
      client._throttle = async (...a) => { attempts++; return realThrottle(...a); };

      const body = { transactionType: 'BUY', securityId: '1', quantity: 65, correlationId: 'ag-fixed' };
      await client._post('/v2/orders', body).then(() => calls.push('resolved')).catch(e => calls.push(e.status));

      defect(attempts === 4,
        `the client's DEFAULT retry policy still submits ${attempts} times on HTTP 500 — it is written for reads`);
      ok(calls[0] === 500, 'the caller eventually sees the 500 — the failure is not swallowed');

      /* FIXED 2026-07-31, Phase 2. live-connector now passes retries:0 for
         orders specifically. The default above is pinned as a defect because it
         is still the default: any new order path that forgets the option
         inherits four submissions per intent. */
      let attempts0 = 0;
      const c2 = new DhanClient({ clientId: '1100000000', accessToken: FAKE_TOKEN });
      const rt2 = c2._throttle.bind(c2);
      c2._throttle = async (...a) => { attempts0++; return rt2(...a); };
      await c2._post('/v2/orders', { ...body, correlationId: 'ag-noretry' }, { retries: 0 }).catch(() => {});
      ok(attempts0 === 1,
        'with retries:0 — the setting live-connector.placeOrder now uses — ONE intent produces exactly ONE submission');

      const lcSrc = code('live-connector.js');
      ok(/_post\('\/v2\/orders',\s*body,\s*\{\s*retries:\s*0\s*\}\)/.test(lcSrc),
        'live-connector.placeOrder passes retries:0 — an order is sent exactly once [regression]');
      return orig;
    }
  );

  /* B2 — order responses are NOT cached. This is correct today; it is pinned
     because it depends on a default staying at zero in a table where four other
     paths are non-zero. */
  await withFakeFetch(
    async () => res(200, { orderId: 'X1' }),
    async (DhanClient) => {
      const client = new DhanClient({ clientId: '1100000000', accessToken: FAKE_TOKEN });
      let attempts = 0;
      const realThrottle = client._throttle.bind(client);
      client._throttle = async (...a) => { attempts++; return realThrottle(...a); };

      const body = { securityId: '1', quantity: 65, correlationId: 'ag-same' };
      await client._post('/v2/orders', body);
      await client._post('/v2/orders', body);          // identical, sequential
      ok(attempts === 2,
        'two sequential identical orders produce two submissions — the response cache does NOT apply to /v2/orders');
    }
  );

  /* B3 — in-flight coalescing DOES apply to orders. */
  await withFakeFetch(
    async () => { await new Promise(r => setTimeout(r, 40)); return res(200, { orderId: 'X2' }); },
    async (DhanClient) => {
      const client = new DhanClient({ clientId: '1100000000', accessToken: FAKE_TOKEN });
      let attempts = 0;
      const realThrottle = client._throttle.bind(client);
      client._throttle = async (...a) => { attempts++; return realThrottle(...a); };

      const body = { securityId: '1', quantity: 65, correlationId: 'ag-concurrent' };
      const [a, b] = await Promise.all([client._post('/v2/orders', body), client._post('/v2/orders', body)]);
      defect(attempts === 1 && a === b,
        'two CONCURRENT identical orders are coalesced into ONE submission and both callers receive the same response');
    }
  );

  /* ═════════════════════════════════════════════════════════════════════════
     4 · B4 — AN UNREACHABLE BROKER IS INDISTINGUISHABLE FROM A FLAT BOOK
     The behaviour any reconciliation would be built on.
     ═════════════════════════════════════════════════════════════════════════ */
  console.log('\n── 4 · position/order reads on failure (B4) ──');

  /* CHARACTERIZATION → REGRESSION, 2026-08-12.

     These three lines pinned defect B4/A5/D-8: getPositions() and getOrders()
     resolved to [] on a failed call, and a disconnected connector returned []
     too — so "the broker is unreachable" and "the account is flat" were the same
     value, and any reconciliation built on it would have been unsound.

     Both connectors now throw. The assertions are inverted here in the same
     commit that inverted the behaviour: a characterization test whose subject has
     been deliberately removed cannot go on characterizing it, and leaving it
     pinned would keep a test green while asserting a defect that is gone.

     What is asserted now is the property that can regress — that a failure is
     never quietly turned back into an empty list. */
  const lc = code('live-connector.js');
  const uc = code('upstox-connector.js');

  ok(!/getPositions[\s\S]{0,200}?\.catch\(\(\)\s*=>\s*\[\]\)/.test(lc),
    'live-connector.getPositions() no longer resolves to [] on a failed call');
  ok(!/getOrders[\s\S]{0,200}?\.catch\(\(\)\s*=>\s*\[\]\)/.test(lc),
    'live-connector.getOrders() no longer resolves to [] on a failed call');
  ok(!/async getPositions\(\)\s*\{\s*if \(!this\.connected\) return \[\];/.test(lc),
    'a DISCONNECTED connector no longer reports [] positions — it throws, because not being '
    + 'able to ask is not evidence of being flat');
  ok(!/catch\s*\{\s*return \[\];\s*\}/.test(uc),
    'upstox-connector no longer swallows a failed positions/orders call into an empty list');
  ok(/BROKER_POSITIONS_UNAVAILABLE/.test(uc) && /BROKER_POSITIONS_UNAVAILABLE/.test(lc),
    'and both carry a code a caller can branch on, rather than a bare Error');

  /* The other half: only a connector that has EARNED it may have its empty list
     read as flat. See test/broker-positions-d8.test.js for the behavioural
     assertions; this one guards the marker itself. */
  ok(/positionsDistinguishEmptyFromError/.test(uc),
    'upstox declares that its empty list can be trusted');
  ok(!/positionsDistinguishEmptyFromError\s*\(\)\s*\{\s*return true/.test(lc)
     && !/positionsDistinguishEmptyFromError:\s*true/.test(lc),
    'live-connector does NOT declare it — the marker is a claim about behaviour observed '
    + 'against a real session, and this one has never been run against Dhan here');

  /* ═════════════════════════════════════════════════════════════════════════
     5 · B8 — paperMode IS READ ONCE, AT CONSTRUCTION
     Safe paper→live (needs a restart). Unsafe live→paper (looks like it worked).
     ═════════════════════════════════════════════════════════════════════════ */
  console.log('\n── 5 · TRADE_MODE latching (B8) ──');

  const savedMode = process.env.TRADE_MODE;
  try {
    process.env.TRADE_MODE = 'live';
    delete require.cache[require.resolve(path.join(ROOT, 'execution-engine.js'))];
    const ExecutionEngine = require(path.join(ROOT, 'execution-engine.js'));
    const eng = new ExecutionEngine({ live: null, lotSize: 65, strikeInterval: 50, atmRound: 50 });
    ok(eng.paperMode === false, 'engine constructed under TRADE_MODE=live reports paperMode=false');

    process.env.TRADE_MODE = 'paper';
    defect(eng.paperMode === false,
      'setting TRADE_MODE=paper on the RUNNING process does not disarm the engine — the flag was latched at construction');
  } finally {
    if (savedMode === undefined) delete process.env.TRADE_MODE; else process.env.TRADE_MODE = savedMode;
    delete require.cache[require.resolve(path.join(ROOT, 'execution-engine.js'))];
  }

  const ami = code('amibroker-bridge.js');
  ok(/deps\.getTradeMode\(\)\s*===\s*'live'/.test(ami),
    'amibroker-bridge reads the trade mode PER CALL — a different behaviour from the engines, in the same repo');

  /* ═════════════════════════════════════════════════════════════════════════
     6 · D2 — A MALFORMED TRADE LIMIT DISABLES THE TRADE LIMIT
     The shipped expression is extracted from server.js and evaluated, so this
     tests the code rather than a copy of it.
     ═════════════════════════════════════════════════════════════════════════ */
  console.log('\n── 6 · malformed numeric config (D2) ──');

  const EXPR = 'parseInt(process.env.MAX_TRADES_PER_DAY || 2)';
  ok(code('server.js').includes(EXPR), `server.js contains the expression \`${EXPR}\``);

  const savedMax = process.env.MAX_TRADES_PER_DAY;
  const evalMax = () => eval(EXPR);                                   // the shipped expression, verbatim
  try {
    delete process.env.MAX_TRADES_PER_DAY;
    ok(evalMax() === 2, 'absent MAX_TRADES_PER_DAY falls back to 2');
    process.env.MAX_TRADES_PER_DAY = '';
    ok(evalMax() === 2, 'empty MAX_TRADES_PER_DAY falls back to 2');
    process.env.MAX_TRADES_PER_DAY = '5';
    ok(evalMax() === 5, 'a numeric value is honoured');
    process.env.MAX_TRADES_PER_DAY = 'abc';
    const bad = evalMax();
    defect(Number.isNaN(bad), 'a malformed MAX_TRADES_PER_DAY evaluates to NaN');
    defect((3 >= bad) === false && (999999 >= bad) === false,
      'and `tradesToday >= NaN` is false for every count — the daily trade limit is silently DISABLED');
  } finally {
    if (savedMax === undefined) delete process.env.MAX_TRADES_PER_DAY; else process.env.MAX_TRADES_PER_DAY = savedMax;
  }

  /* ═════════════════════════════════════════════════════════════════════════
     8 · THE RISK LAYER REFUSES TO OPEN A POSITION IT DOES NOT ALREADY HOLD
     Found by the parity harness on 2026-07-31, before any call site was moved.
     Not in docs/074 §0.6 — that inventory was written from source, and this
     behaviour is only visible when the layer is actually driven.

     `concentrationByStrike` computes `mine = riskByStrike[key]`. A strike that
     is ABSENT from the map yields null, which makes the check UNEVALUABLE, and
     UNEVALUABLE blocks under the default RISK_FAIL_MODE=BLOCK.

     If the caller builds riskByStrike from open positions — the obvious
     construction — then "absent" means "nothing held here", which is a known
     ZERO, not an unknown. The layer therefore blocks every genuinely new
     strike and permits only adding to strikes already held.

     Nobody has seen this because the guard sits in one of twelve order paths.
     It would fire on the first Phase 2 move. That is what the safety net is for.
     ═════════════════════════════════════════════════════════════════════════ */
  console.log('\n── 8 · risk layer on an unheld strike (found by the parity harness) ──');
  {
    const riskConfig = require(path.join(ROOT, 'risk-config.js'));
    const { RiskManager } = require(path.join(ROOT, 'risk-manager.js'));
    const CFG = { ...riskConfig.DEFAULTS };
    const quietLog = { warn() {}, error() {}, log() {} };
    const mgr = new RiskManager({ cfg: () => CFG, log: quietLog, now: () => 1_700_000_000_000 });

    const state = () => ({
      equity: 700000, startOfDayEquity: 700000, peakEquityToday: 700000,
      dayRealisedPnl: 0, deployed: 100000, deployedByUnderlying: { NIFTY: 100000 },
      openPositions: 2, lotsByInstrument: { NIFTY: 2 },
      greeks: { delta: 200, gamma: 5, vega: 500, theta: -1200 },
      totalRisk: 40000, riskByExpiry: { '2026-08-06': 10000 },
      riskByStrike: { 'NIFTY|24300|CE': 5000 },
      isExpiryDay: false, minutesToClose: 180, dataAgeMs: 500, consecutiveLosses: 0,
    });
    const intent = (over = {}) => ({
      strategy: 'STRANGLE', instrument: 'NIFTY', strike: 24000, optionType: 'CE',
      side: 'SELL', expiry: '2026-08-06', stopDistance: 20, lotSize: 65, requestedLots: 1,
      marginVerdict: { fits: true, required: 92694, marginSource: 'broker', projectedPeak: 300000, projectedUtilisationPct: 43 },
      ...over,
    });

    ok(CFG.RISK_FAIL_MODE === 'BLOCK', `RISK_FAIL_MODE defaults to ${CFG.RISK_FAIL_MODE} — UNEVALUABLE blocks`);

    const held = mgr.evaluate(intent({ strike: 24300, optionType: 'CE' }), state());
    ok(held.approved, 'an order at a strike ALREADY HELD is approved');

    /* FIXED 2026-07-31, Phase 2.0. Previously both of these were `defect(...)`
       pins: an absent key was UNEVALUABLE unconditionally, so no new strike or
       expiry could ever be opened. The caller now DECLARES whether its maps are
       exhaustive. Both halves are asserted, because the fix would be worthless
       if it had simply made absence mean zero everywhere — that would have
       turned a failed map build into a silent pass. */
    const unheld = mgr.evaluate(intent(), state());
    ok(!unheld.approved && unheld.blocks.some(b => b.name === 'concentrationByStrike' && b.status === 'UNEVALUABLE'),
      'without riskMapComplete, an unheld strike stays UNEVALUABLE and blocks — a partial map still fails closed');

    const complete = state(); complete.riskMapComplete = true;
    const openedNew = mgr.evaluate(intent(), complete);
    ok(openedNew.approved,
      'with riskMapComplete, an unheld strike reads as ZERO risk and a NEW position can be opened [regression: this was blocked before 2026-07-31]');

    const zeroed = state(); zeroed.riskByStrike['NIFTY|24000|CE'] = 0;
    ok(mgr.evaluate(intent(), zeroed).approved,
      'an explicit zero in the map is still honoured, with or without the flag');

    const newExpiryPartial = mgr.evaluate(intent({ strike: 24300, expiry: '2026-09-24' }), state());
    ok(!newExpiryPartial.approved && newExpiryPartial.blocks.some(b => b.name === 'concentrationByExpiry' && b.status === 'UNEVALUABLE'),
      'without the flag, an unheld EXPIRY also stays UNEVALUABLE');

    const newExpiryComplete = state(); newExpiryComplete.riskMapComplete = true;
    ok(mgr.evaluate(intent({ strike: 24300, expiry: '2026-09-24' }), newExpiryComplete).approved,
      'with the flag, a NEW expiry can be opened [regression: this was blocked before 2026-07-31]');

    const noTotal = state(); noTotal.riskMapComplete = true; noTotal.totalRisk = null;
    ok(!mgr.evaluate(intent(), noTotal).approved,
      'the flag does not defeat the check itself — an unknown TOTAL risk is still UNEVALUABLE and still blocks');

    /* Also found by the harness: the approval token is
       `RA-<millisecond>-<hash of instrument|strike|type|side|lots>`. No counter,
       no randomness. Two IDENTICAL intents inside one millisecond collide.
       Recorded rather than alarmed about: the collision makes the second order
       fail as a replay, which is the safe direction. It is pinned because the
       safety is an artefact of clock resolution rather than a decision, and
       because any future coarsening of that clock would turn a rare refusal
       into a routine one. */
    const frozen = new RiskManager({ cfg: () => CFG, log: quietLog, now: () => 1_700_000_000_000 });
    const zs = state(); zs.riskByStrike['NIFTY|24000|CE'] = 0;
    const t1 = frozen.evaluate(intent(), zs).approval.token;
    const t2 = frozen.evaluate(intent(), zs).approval.token;
    defect(t1 === t2,
      'two identical intents in the same millisecond receive the SAME approval token — it carries no counter and no randomness');
    ok(frozen.evaluate(intent({ optionType: 'PE' }), (() => { const s = state(); s.riskByStrike['NIFTY|24000|PE'] = 0; return s; })()).approval.token !== t1,
      'intents that differ in any bound field receive different tokens — the collision is confined to genuinely identical intents');
  }

  /* ═════════════════════════════════════════════════════════════════════════
     7 · THE PARITY HARNESS ITSELF
     An instrument that cannot detect a difference is not evidence. It is
     tested before it is trusted.
     ═════════════════════════════════════════════════════════════════════════ */
  console.log('\n── 7 · parity harness self-test ──');

  const { ScriptedBroker, replay, diff, allFixtures, loadFixture } = require(path.join(ROOT, 'parity-harness.js'));

  const fixtures = allFixtures();
  ok(fixtures.length === 4, `four replay fixtures exist (${fixtures.map(f => f.character).join(', ')})`);
  for (const f of fixtures) {
    ok(f.intents.length > 0 && f._source.includes('L0_raw'),
      `fixture '${f.character}' (${f.session}) carries ${f.intents.length} intents derived from real capture`);
  }

  const gap = loadFixture('feed-gap');
  ok(gap.intents.every(i => i.skipped || (i.market && typeof i.market.spot === 'number')),
    'feed-gap fixture preserves holes as SKIPPED rather than zero-filling them');

  const place = async (intent, broker) => broker.placeOrder({
    instrument: intent.instrument, strike: intent.strike, optionType: intent.optionType,
    side: intent.side, lots: intent.lots, quantity: intent.quantity,
  });

  const quiet = loadFixture('quiet');
  const runA = await replay(quiet, place, new ScriptedBroker());
  const runB = await replay(quiet, place, new ScriptedBroker());
  ok(diff(runA, runB).identical, 'two identical paths produce an identical submission log');

  const runC = await replay(quiet, async (intent, broker) => broker.placeOrder({
    instrument: intent.instrument, strike: intent.strike, optionType: intent.optionType,
    side: intent.side, lots: intent.lots + 1, quantity: intent.quantity,       // one field changed
  }), new ScriptedBroker());
  const d = diff(runA, runC);
  ok(!d.identical && d.diffs.some(x => x.key === 'field:lots'),
    'a single changed field is detected and named (`field:lots`)');
  ok(diff(runA, runC, { accept: ['field:lots'] }).identical,
    'a difference can be accepted BY NAME, and only by name');

  const runD = await replay(quiet, async (intent, broker) => {
    await broker.placeOrder({ instrument: intent.instrument, strike: intent.strike, optionType: intent.optionType, side: intent.side, lots: intent.lots, quantity: intent.quantity });
    if (intent.seq === 3) await broker.placeOrder({ instrument: intent.instrument, strike: intent.strike, optionType: intent.optionType, side: intent.side, lots: intent.lots, quantity: intent.quantity });
  }, new ScriptedBroker());
  ok(diff(runA, runD).diffs.some(x => x.key === 'count:submissions'),
    'a duplicated submission is detected as a count difference — the failure mode a retry would produce');

  const failing = new ScriptedBroker({ respond: (o, i) => (i === 2 ? { httpStatus: 500 } : { ok: true }) });
  const runE = await replay(quiet, place, failing);
  ok(runE.submissions.length === quiet.intents.length,
    'a submission is recorded even when the broker rejects it — the case a ledger usually loses');
  ok(runE.outcomes.some(o => o.outcome === 'THREW' && o.status === 500),
    'the rejection is recorded by status code, not by message text');

  console.log(`\n${n} assertions passed`);
})().catch(e => { console.error('\n✗ ' + e.message); process.exit(1); });
