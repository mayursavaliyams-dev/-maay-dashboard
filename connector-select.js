/* ═══════════════════════════════════════════════════════════════════════════
   connector-select — which broker connector this process uses, declared rather
   than discovered.

   WHAT THIS REPLACES, AND WHY

   The previous selection branched on the PRESENCE and LENGTH of an environment
   variable:

       const CONNECTOR_MODE = (process.env.LIVE_CONNECTOR || 'auto').toLowerCase();
       ...
       if (upstoxTok && upstoxTok.length > 40)      → Upstox   (placeOrder throws)
       else if (kotakKey && kotakKey !== 'your_...') → Kotak
       else                                          → Dhan     (placeOrder WORKS)

   Measured on 2026-07-31 (docs/078 §2), by executing that exact block against
   the real connector modules:

       auto, token intact           → UpstoxConnector   placeOrder: THROWS
       auto, token shortened to 30  → LiveConnector     placeOrder: IMPLEMENTED
       auto, token cleared          → LiveConnector     placeOrder: IMPLEMENTED
       LIVE_CONNECTOR unset         → LiveConnector     placeOrder: IMPLEMENTED

   So losing the Upstox token did not stop the system. It PROMOTED it — from a
   connector that cannot place an order to one that can. A credential expiring is
   an ordinary Tuesday; silently gaining the ability to trade because of it is
   not.

   THE RULE HERE

   The connector is NAMED. A missing or unusable credential is a startup
   failure that says what is missing. There is no fallback, no inference, and no
   configuration in which one connector substitutes for another — because a
   substitution is exactly what nobody would notice.

   WHY IT REFUSES RATHER THAN WARNS

   A warning at startup is read once, on the day it is added. This throws, and a
   process that will not start is a problem an operator solves in minutes. A
   process that started with the wrong broker is a problem discovered from a
   contract note.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const KNOWN = ['upstox', 'kotak', 'dhan'];

/* What each connector cannot work without. `check` returns null when the
   credential is usable, or a human-readable reason when it is not.

   Length thresholds appear here too — but as a VALIDITY check that refuses,
   never as a selection input that substitutes. That is the whole difference. */
const REQUIREMENTS = {
  upstox: [
    { key: 'UPSTOX_ACCESS_TOKEN', check: (v) => {
      if (!v) return 'not set';
      if (v.length <= 40) return `only ${v.length} characters — an Upstox access token is far longer, so this is a placeholder or a truncated paste`;
      return null;
    } },
  ],
  kotak: [
    { key: 'KOTAK_CONSUMER_KEY', check: (v) => {
      if (!v) return 'not set';
      if (v === 'your_consumer_key_here') return 'still the placeholder from .env.example';
      return null;
    } },
  ],
  dhan: [
    { key: 'DHAN_CLIENT_ID', check: (v) => (v ? null : 'not set') },
    { key: 'DHAN_ACCESS_TOKEN', check: (v) => (v ? null : 'not set') },
  ],
};

/**
 * Decide, or refuse.
 *
 * @param {object} env      process.env (injected so this is testable)
 * @param {object} classes  { upstox, kotak, dhan } constructors
 * @returns {{ name, connector, credentialsFrom }}
 * @throws  Error with `code` = CONNECTOR_NOT_DECLARED | CONNECTOR_UNKNOWN | CONNECTOR_CREDENTIALS
 */
function selectConnector(env, classes) {
  const raw = env.LIVE_CONNECTOR;

  if (raw == null || String(raw).trim() === '') {
    throw Object.assign(new Error(
      'LIVE_CONNECTOR is not set. The broker connector must be named explicitly — ' +
      `one of: ${KNOWN.join(', ')}. There is deliberately no default: the previous ` +
      'default ("auto") selected a connector by inspecting credential length, and a ' +
      'token that expired silently promoted this process to one that can place real ' +
      'orders (measured 2026-07-31, docs/078 §2).'
    ), { code: 'CONNECTOR_NOT_DECLARED' });
  }

  const name = String(raw).trim().toLowerCase();
  if (!KNOWN.includes(name)) {
    throw Object.assign(new Error(
      `LIVE_CONNECTOR="${raw}" is not a known connector. Expected one of: ${KNOWN.join(', ')}. ` +
      'Nothing is substituted for an unrecognised name.'
    ), { code: 'CONNECTOR_UNKNOWN' });
  }

  const missing = [];
  for (const req of REQUIREMENTS[name]) {
    const why = req.check(env[req.key]);
    if (why) missing.push(`${req.key} — ${why}`);
  }
  if (missing.length) {
    throw Object.assign(new Error(
      `LIVE_CONNECTOR="${name}" but its credentials are not usable:\n` +
      missing.map(m => `    · ${m}`).join('\n') +
      '\n  Fix the credential. This process will NOT fall back to another connector: ' +
      'the connector that would have been chosen instead can place real orders.'
    ), { code: 'CONNECTOR_CREDENTIALS', connector: name, missing });
  }

  const Klass = classes && classes[name];
  if (typeof Klass !== 'function') {
    throw Object.assign(new Error(`connector-select: no class supplied for "${name}"`), { code: 'CONNECTOR_UNKNOWN' });
  }

  let connector;
  switch (name) {
    case 'upstox': connector = new Klass({ accessToken: env.UPSTOX_ACCESS_TOKEN }); break;
    case 'kotak':  connector = new Klass(); break;
    case 'dhan':   connector = new Klass({ dhanClientId: env.DHAN_CLIENT_ID, dhanAccessToken: env.DHAN_ACCESS_TOKEN }); break;
  }

  return { name, connector, credentialsFrom: REQUIREMENTS[name].map(r => r.key) };
}

/** Whether a connector can actually place an order.
 *
 *  MUST BE READ BEFORE THE RISK GUARD WRAPS THE CONNECTOR.
 *
 *  The guard replaces the connector's own `placeOrder` with a thrower, so after
 *  wrapping this function is inspecting the guard's stub rather than the
 *  connector's method. Measured 2026-07-31: called on an already-wrapped Upstox
 *  connector it returned `live-capable`, which is exactly the misreport the
 *  status endpoint was being fixed to remove.
 *
 *  Two defences, because one was not enough:
 *    · server.js captures the answer at startup, before wrapping, and reports
 *      the captured value;
 *    · a neutralised method is recognised here and reported as such, so a
 *      future caller that asks too late gets an honest "ask the guard" rather
 *      than a confident wrong answer.
 *
 *  @returns 'none' | 'refuses' | 'live-capable' | 'neutralised'
 */
function orderCapability(connector) {
  const fn = connector && connector.placeOrder;
  if (typeof fn !== 'function') return 'none';
  const body = Function.prototype.toString.call(fn);
  if (/RISK_BYPASS_ATTEMPT/.test(body) || /^\s*function\s+neutralisedPlaceOrder/.test(body)) return 'neutralised';
  return (/throw\b[\s\S]{0,40}new Error\(/.test(body) && /not implemented|paper mode only/i.test(body))
    ? 'refuses' : 'live-capable';
}

module.exports = { selectConnector, orderCapability, KNOWN, REQUIREMENTS };
