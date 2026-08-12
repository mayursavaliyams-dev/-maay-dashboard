/* ═══════════════════════════════════════════════════════════════════════════
   control-auth — the gate on the controls whose misuse is most expensive.

   WHY THIS IS NOT `auth.requireRole`

   `auth.js:requireRole` is a NO-OP when AUTH_ENABLED is false, and AUTH_ENABLED
   defaults to false. That is a defensible design for the dashboard: opt-in auth
   on a read surface. Applied to the kill switch it is not a gate at all, and it
   would look exactly like one in review.

   The endpoints this protects — trip the kill switch, RESET the kill switch,
   reload risk configuration, emergency stop — are reachable through a public
   tunnel today. Resetting a tripped kill switch from the internet is the single
   cheapest way to lose money in this system.

   So this gate NEVER no-ops.

   THE FAIL-CLOSED DEFAULT IS THE POINT

   If no CONTROL_TOKEN is configured and session auth is off, there is no way to
   authenticate — so the gate does not "allow because it cannot check". It falls
   back to LOOPBACK ONLY and tells the operator why. That is the same outcome
   the session brief prescribes as its stop condition, made automatic rather
   than remembered.

   THE PHONE MUST STILL WORK

   The manual flatten procedure (doc 073 §6) begins with "kill the bot from your
   phone". A gate that a phone browser cannot pass has not secured the system;
   it has removed the operator's stop button. So a query parameter is accepted
   alongside a header, because a phone browser can send one and cannot easily
   send the other. The trade-off is real — query strings land in browser history
   and proxy logs — and it is taken deliberately: an operator who cannot stop
   the bot is a worse outcome than a token in a history entry, and the token can
   be rotated.

   WHAT IS LOGGED

   Every request, allowed or denied, with its source. Never the credential
   itself, not even when it was wrong: a rejected token in a log is still a
   token someone typed, and logs are read by more people than credentials are.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const crypto = require('crypto');

const LOG_MAX = 500;

function timingSafeEqual(a, b) {
  const A = Buffer.from(String(a || ''), 'utf8');
  const B = Buffer.from(String(b || ''), 'utf8');
  // Length is not secret and comparing different lengths would throw, so it is
  // checked first. The remaining comparison is constant-time.
  if (A.length !== B.length || A.length === 0) return false;
  return crypto.timingSafeEqual(A, B);
}

/* The logged path must not carry the credential.

   The phone path puts the token in the query string — deliberately, because a
   phone browser can send one and cannot easily send a header. That means
   `req.originalUrl` contains the secret, and writing it to the audit log would
   defeat the whole "never log the credential" rule through the back door.

   Found on 2026-07-31 by the Block 1 HTTP proof, which reported
   `token present anywhere in log? true`. The unit test had asserted the
   opposite and passed, because it built its request with the token in
   `req.query` and a clean `url` — a shape no real request ever has. */
const SECRET_PARAMS = ['ct', 'control_token', 'token', 'key', 'access_token'];
function redactPath(url) {
  const s = String(url || '');
  const q = s.indexOf('?');
  if (q < 0) return s;
  const base = s.slice(0, q);
  const parts = s.slice(q + 1).split('&').map(kv => {
    const eq = kv.indexOf('=');
    const k = eq < 0 ? kv : kv.slice(0, eq);
    return SECRET_PARAMS.includes(k.toLowerCase()) ? `${k}=***` : kv;
  });
  return `${base}?${parts.join('&')}`;
}

function sourceOf(req) {
  const fwd = req.headers?.['x-forwarded-for'];
  const direct = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || null;
  return {
    // Behind a tunnel `direct` is the tunnel. Both are recorded because either
    // alone is misleading, and x-forwarded-for is caller-supplied and therefore
    // evidence of a claim rather than of a fact.
    direct: direct || null,
    forwardedFor: fwd ? String(fwd).split(',')[0].trim() : null,
    forwardedRaw: fwd ? String(fwd) : null,
    userAgent: req.headers?.['user-agent'] || null,
  };
}

function isLoopback(src) {
  const d = String(src.direct || '');
  const looksLocal = d === '127.0.0.1' || d === '::1' || d === '::ffff:127.0.0.1' || d === 'localhost';
  // A forwarded-for header means the request arrived through a proxy or tunnel.
  // Its presence disqualifies loopback regardless of what `direct` says, because
  // `direct` is then the proxy and proves nothing about the caller.
  return looksLocal && !src.forwardedRaw;
}

class ControlAuth {
  /**
   * @param {object} deps
   *   token   () => the configured shared secret, or null
   *   auth    the auth.js module (optional; used when session auth is on)
   *   now     () => epoch ms
   *   log
   */
  constructor(deps = {}) {
    this.getToken = deps.token || (() => process.env.CONTROL_TOKEN || null);
    this.auth = deps.auth || null;
    this.now = deps.now || (() => Date.now());
    this.log = deps.log || console;
    this._log = [];
    this.stats = { allowed: 0, denied: 0, loopbackAllowed: 0, unconfiguredDenials: 0 };
  }

  /** Configuration state, for the status endpoint and the startup banner. */
  mode() {
    const tok = this.getToken();
    const sessionAuth = !!(this.auth && this.auth.ENABLED);
    if (tok) return { mode: 'token', sessionAuth, note: 'CONTROL_TOKEN is set' };
    if (sessionAuth) return { mode: 'session', sessionAuth, note: 'admin session required' };
    return {
      mode: 'loopback-only', sessionAuth: false,
      note: 'no CONTROL_TOKEN and session auth is off — control endpoints are reachable from this host ONLY. ' +
            'Set CONTROL_TOKEN to allow the operator phone through the tunnel.',
    };
  }

  _record(entry) {
    this._log.push(entry);
    if (this._log.length > LOG_MAX) this._log.shift();
    return entry;
  }

  recent(limit = 100) { return this._log.slice(-limit); }

  /**
   * Express middleware. Never a no-op.
   * @param {string} action  what is being controlled, for the log
   */
  gate(action) {
    return (req, res, next) => {
      const src = sourceOf(req);
      const presented =
        (req.headers?.['x-control-token']) ||
        (req.query && (req.query.ct || req.query.control_token)) ||
        (typeof req.headers?.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')
          ? req.headers.authorization.slice(7) : null) ||
        null;

      const tok = this.getToken();
      const deny = (reason, status = 401) => {
        this.stats.denied++;
        const e = this._record({
          at: new Date(this.now()).toISOString(), action, outcome: 'DENIED', reason,
          method: req.method, path: redactPath(req.originalUrl || req.url),
          credentialPresented: !!presented,       // never the credential itself
          src,
        });
        this.log.warn?.(`[control-auth] DENIED ${action} from ${src.forwardedFor || src.direct || '?'} — ${reason}`);
        return res.status(status).json({ error: 'unauthorized', action, reason });
      };
      const allow = (via) => {
        this.stats.allowed++;
        this._record({
          at: new Date(this.now()).toISOString(), action, outcome: 'ALLOWED', via,
          method: req.method, path: redactPath(req.originalUrl || req.url),
          credentialPresented: !!presented, src,
        });
        this.log.warn?.(`[control-auth] ALLOWED ${action} via ${via} from ${src.forwardedFor || src.direct || '?'}`);
        req.controlVia = via;
        return next();
      };

      // 1. shared secret
      if (tok) {
        if (presented && timingSafeEqual(presented, tok)) return allow('control-token');
        // Fall through to a session check rather than denying here — an admin
        // with a valid session should not be locked out because they omitted a
        // token they were never given.
      }

      // 2. admin session, when platform auth is on
      if (this.auth && this.auth.ENABLED) {
        const u = this.auth.verifyToken(this.auth.readToken(req));
        if (u && this.auth.roleOk(u.role, 'admin')) return allow(`session:${u.sub}`);
        if (u) return deny(`role '${u.role}' is not admin`, 403);
      }

      // 3. nothing is configured — loopback only, and say so
      if (!tok && !(this.auth && this.auth.ENABLED)) {
        if (isLoopback(src)) { this.stats.loopbackAllowed++; return allow('loopback'); }
        this.stats.unconfiguredDenials++;
        return deny('no CONTROL_TOKEN configured and session auth is off — control endpoints are loopback-only until one is set');
      }

      return deny(presented ? 'invalid control token' : 'no credential presented');
    };
  }
}

module.exports = { ControlAuth, timingSafeEqual, isLoopback, sourceOf, redactPath };
