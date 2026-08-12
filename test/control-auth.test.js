/**
 * control-auth — Block 1. Run: node test/control-auth.test.js
 *
 * @test:unit @test:security @test:failure @test:boundary @test:regression
 *
 * THE CLAIM
 *
 * "The kill switch, its reset, risk reload and emergency stop return 401
 *  unauthenticated and succeed authenticated — and there is no configuration in
 *  which they are reachable from the internet without a credential."
 *
 * The last clause is the one that matters. `auth.requireRole` is a no-op when
 * AUTH_ENABLED is false, so a gate built on it would pass a review, pass a
 * smoke test, and be open. Several assertions below exist only to prove that
 * this gate has no such state.
 */
'use strict';

const assert = require('assert');
const path = require('path');

let n = 0;
const ok = (c, m) => { n++; assert.ok(c, m); console.log('  ✓ ' + m); };
const ROOT = path.join(__dirname, '..');
const { ControlAuth, timingSafeEqual, isLoopback } = require(path.join(ROOT, 'control-auth.js'));

const quiet = { warn() {}, error() {}, log() {} };
const NOW = 1_700_000_000_000;

/* A request/response pair thin enough to reason about and shaped like express. */
const mkReq = (o = {}) => ({
  method: o.method || 'POST',
  url: o.url || '/api/risk/kill',
  originalUrl: o.url || '/api/risk/kill',
  headers: o.headers || {},
  query: o.query || {},
  ip: o.ip || '203.0.113.9',
  socket: { remoteAddress: o.ip || '203.0.113.9' },
});
const mkRes = () => {
  const r = { statusCode: null, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const run = (mw, req) => {
  const res = mkRes();
  let passed = false;
  mw(req, res, () => { passed = true; });
  return { passed, status: res.statusCode, body: res.body, req };
};

console.log('\ncontrol-auth\n');

/* ── 1 · the gate never no-ops ───────────────────────────────────────────── */
console.log('1 · there is no configuration in which it passes everything');
{
  // Nothing configured at all: no token, no session auth. The dangerous state.
  const ca = new ControlAuth({ token: () => null, auth: null, now: () => NOW, log: quiet });
  const r = run(ca.gate('kill'), mkReq());
  ok(!r.passed && r.status === 401,
    'no token, no session auth, remote caller → 401 (auth.requireRole would have called next())');
  ok(/loopback-only/.test(r.body.reason), 'and the reason names the fallback so the operator can fix it');
  ok(ca.mode().mode === 'loopback-only', 'mode() reports loopback-only rather than claiming to be secured');

  // Session auth present but DISABLED — the exact shape of auth.js by default.
  const fakeAuth = { ENABLED: false, verifyToken: () => ({ sub: 'x', role: 'admin' }), readToken: () => 'tok', roleOk: () => true };
  const ca2 = new ControlAuth({ token: () => null, auth: fakeAuth, now: () => NOW, log: quiet });
  const r2 = run(ca2.gate('kill'), mkReq());
  ok(!r2.passed && r2.status === 401,
    'an auth module whose ENABLED is false does NOT satisfy the gate — the no-op path is not inherited');
}

/* ── 2 · loopback fallback, and its limits ───────────────────────────────── */
console.log('\n2 · the loopback fallback');
{
  const ca = new ControlAuth({ token: () => null, auth: null, now: () => NOW, log: quiet });
  ok(run(ca.gate('kill'), mkReq({ ip: '127.0.0.1' })).passed, 'a loopback caller is allowed when nothing is configured');
  ok(run(ca.gate('kill'), mkReq({ ip: '::1' })).passed, 'IPv6 loopback likewise');

  // The tunnel case: the socket is local because the tunnel client is local.
  const viaTunnel = mkReq({ ip: '127.0.0.1', headers: { 'x-forwarded-for': '203.0.113.9' } });
  const r = run(ca.gate('kill'), viaTunnel);
  ok(!r.passed && r.status === 401,
    'a request through the public tunnel is REFUSED even though its socket is 127.0.0.1 — the tunnel client is local, the caller is not');
  ok(!isLoopback({ direct: '127.0.0.1', forwardedRaw: '203.0.113.9' }),
    'isLoopback() disqualifies anything carrying x-forwarded-for');
}

/* ── 3 · the shared secret ───────────────────────────────────────────────── */
console.log('\n3 · CONTROL_TOKEN');
{
  const SECRET = 's3cret-control-token-value';
  const ca = new ControlAuth({ token: () => SECRET, auth: null, now: () => NOW, log: quiet });

  ok(run(ca.gate('kill'), mkReq({ headers: { 'x-control-token': SECRET } })).passed,
    'the X-Control-Token header is accepted');
  ok(run(ca.gate('kill'), mkReq({ headers: { authorization: `Bearer ${SECRET}` } })).passed,
    'Authorization: Bearer is accepted');
  ok(run(ca.gate('kill'), mkReq({ query: { ct: SECRET } })).passed,
    'the ?ct= query parameter is accepted — this is the path a PHONE BROWSER can use');

  const bad = run(ca.gate('kill'), mkReq({ query: { ct: 'wrong' } }));
  ok(!bad.passed && bad.status === 401, 'a wrong token is refused');
  ok(bad.body.reason === 'invalid control token', 'and is distinguished from presenting nothing at all');

  const none = run(ca.gate('kill'), mkReq());
  ok(none.body.reason === 'no credential presented', 'presenting nothing has its own reason');

  ok(!run(ca.gate('kill'), mkReq({ query: { ct: SECRET + 'x' } })).passed, 'a longer token is refused');
  ok(!run(ca.gate('kill'), mkReq({ query: { ct: SECRET.slice(0, -1) } })).passed, 'a truncated token is refused');
  ok(!timingSafeEqual('', ''), 'two empty strings do not compare equal — an unset token can never authenticate');
}

/* ── 4 · admin session ───────────────────────────────────────────────────── */
console.log('\n4 · session auth, when it is on');
{
  const authOn = (role) => ({
    ENABLED: true,
    readToken: () => 'tok',
    verifyToken: () => (role ? { sub: 'mayur', role } : null),
    roleOk: (have, min) => ({ viewer: 1, trader: 2, admin: 3 }[have] || 0) >= ({ viewer: 1, trader: 2, admin: 3 }[min] || 0),
  });

  const admin = new ControlAuth({ token: () => null, auth: authOn('admin'), now: () => NOW, log: quiet });
  const ra = run(admin.gate('kill'), mkReq());
  ok(ra.passed && ra.req.controlVia === 'session:mayur', 'a valid admin session passes, and the route is told how');

  const trader = new ControlAuth({ token: () => null, auth: authOn('trader'), now: () => NOW, log: quiet });
  const rt = run(trader.gate('kill'), mkReq());
  ok(!rt.passed && rt.status === 403, 'a trader session is 403, not 401 — authenticated but not permitted');

  const anon = new ControlAuth({ token: () => null, auth: authOn(null), now: () => NOW, log: quiet });
  ok(!run(anon.gate('kill'), mkReq()).passed, 'no session with auth on → refused');

  // Both configured: a valid session must still work when a token exists but
  // was not presented. An admin locked out of the kill switch is the failure
  // this gate is supposed to prevent.
  const both = new ControlAuth({ token: () => 'a-token', auth: authOn('admin'), now: () => NOW, log: quiet });
  ok(run(both.gate('kill'), mkReq()).passed,
    'with BOTH a token and session auth, an admin session alone is enough — no operator lockout');
}

/* ── 5 · the audit log ───────────────────────────────────────────────────── */
console.log('\n5 · every attempt is recorded, the credential never is');
{
  const SECRET = 'super-secret-value-xyz';
  const ca = new ControlAuth({ token: () => SECRET, auth: null, now: () => NOW, log: quiet });

  /* CORRECTED 2026-07-31. These three requests previously carried the token in
     `query` while leaving `url` clean — a shape no real request ever has.
     Express populates BOTH: a phone hitting `/api/risk/kill?ct=<token>` gives
     `req.query.ct` AND `req.originalUrl` containing the secret. The assertion
     below passed against the unreal shape and the Block 1 HTTP proof then
     reported `token present anywhere in log? true` against the real one.
     The URLs now carry the query string, as they do in production. */
  run(ca.gate('kill'), mkReq({
    url: `/api/risk/kill?ct=${SECRET}&reason=manual`,
    query: { ct: SECRET, reason: 'manual' },
    headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }, ip: '127.0.0.1',
  }));
  run(ca.gate('kill-reset'), mkReq({ url: '/api/risk/kill/reset?ct=WRONG-GUESS', query: { ct: 'WRONG-GUESS' } }));
  run(ca.gate('emergency-stop'), mkReq());

  const log = ca.recent();
  ok(log.length === 3, 'all three attempts are logged — denied ones too');
  ok(log[0].outcome === 'ALLOWED' && log[1].outcome === 'DENIED' && log[2].outcome === 'DENIED',
    'each carries its outcome');
  ok(log[0].src.forwardedFor === '203.0.113.9',
    'the source address is recorded, taking the first hop from x-forwarded-for');
  ok(log[0].src.direct === '127.0.0.1' && log[0].src.forwardedRaw.includes('10.0.0.1'),
    'and the raw chain is kept alongside it, because a forwarded header is a CLAIM not a fact');

  const dump = JSON.stringify(log);
  ok(!dump.includes(SECRET), 'the correct token appears NOWHERE in the log — INCLUDING inside the logged URL [regression 2026-07-31]');
  ok(!dump.includes('WRONG-GUESS'), 'and neither does a rejected one — a wrong guess is still something someone typed');
  ok(log[0].path === '/api/risk/kill?ct=***&reason=manual',
    'the secret query parameter is redacted while the rest of the URL survives — the log stays useful');
  ok(log[1].path === '/api/risk/kill/reset?ct=***', 'a rejected token is redacted the same way');
  ok(log[1].credentialPresented === true && log[2].credentialPresented === false,
    'the log records WHETHER a credential was presented, which is the useful part');

  ok(ca.stats.allowed === 1 && ca.stats.denied === 2, 'counters agree with the log');
}

/* ── 6 · the ring buffer does not grow without bound ─────────────────────── */
console.log('\n6 · bounded memory');
{
  const ca = new ControlAuth({ token: () => 't', auth: null, now: () => NOW, log: quiet });
  for (let i = 0; i < 600; i++) run(ca.gate('kill'), mkReq());
  ok(ca.recent(1000).length === 500, 'the in-memory log caps at 500 entries');
  ok(ca.stats.denied === 600, 'but the counters still reflect every attempt');
}

console.log(`\n${n} assertions passed`);
