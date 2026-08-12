/* ═══════════════════════════════════════════════════════════════════════════
   live-permission — KEY 2. The second, independent permission every live send
   requires.

   THE RULE

     KEY 1 — CAPABILITY.       This component is switched on and may act.
                               AUTO_TRADE_ENABLED, <INST>_AUTO_ENABLED, engine
                               enables, TRADE_MODE.
     KEY 2 — LIVE PERMISSION.  This component may send to a REAL broker.
                               A dedicated ALLOW_LIVE flag, per deployable,
                               default false.

   Generating a trade and being permitted to send it are separate decisions and
   must be separately flagged. Measured on 2026-07-31, exactly one path in this
   estate had both — the AmiBroker bridge:

       amibroker-bridge.js:26  AMIBROKER_AUTO_TRADE  default false, set true
       amibroker-bridge.js:27  AMIBROKER_ALLOW_LIVE  default false, UNSET
       server.js:3592          'live_blocked_by_AMIBROKER_ALLOW_LIVE'

   Everything else in the estate was one flag from live. This module is that
   pattern, extracted verbatim rather than reinvented, so every path can use the
   one that already works.

   FOUR PROPERTIES, EACH BECAUSE OF A REAL FAILURE

   1. NEVER DERIVED. Key 2 is read from its own variable. It is not computed
      from Key 1, not defaulted from a shared value, and not inferred from the
      presence of credentials. Credentials being present is a fact about a file;
      permission is a decision someone made.

   2. NAMESPACED. One variable grants live permission to exactly one deployable.
      TRADE_MODE was read by three, and only one of them had controls.

   3. FAILS CLOSED ON EVERYTHING ELSE. Absent, empty, whitespace, "1", "yes",
      "on", a number, an object — all FALSE. `MAX_TRADES_PER_DAY="abc"` once
      became NaN and silently disabled the daily trade limit; a permission flag
      must not have a value that means "probably yes".

      "TRUE", "True" and " true " DO grant it. That is deliberate and it is a
      correction: an earlier draft of this comment claimed they did not, while
      the code trimmed and lower-cased. The code was right — the AmiBroker
      implementation this copies is `String(...).toLowerCase() === 'true'`, and
      every boolean flag in this codebase behaves that way. Making one flag
      secretly case-sensitive would be its own hazard: an operator who typed
      TRUE and got paper would go looking for a bug in the wrong place.
      "1" and "yes" are still refused, because accepting them invites
      "0"/"no"/"off" and those are the values that get misread.

   4. THE REFUSAL NAMES THE FLAG. server.js:3592 already returns
      `live_blocked_by_AMIBROKER_ALLOW_LIVE`. A refusal that does not say which
      permission was missing sends the operator to read code during an incident.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

/**
 * Read a live-permission flag. Nothing but the exact string "true" grants it.
 *
 * @param {string} varName  the dedicated variable, e.g. 'STOCK_ALLOW_LIVE'
 * @param {object} env      injected for testing
 * @returns {{ granted: boolean, flag: string, raw: string|null, reason: string }}
 */
function livePermission(varName, env = process.env) {
  if (!varName || typeof varName !== 'string') {
    throw new Error('live-permission: a flag name is required — an unnamed permission cannot be refused by name');
  }
  const raw = env[varName];

  if (raw === undefined || raw === null) {
    return { granted: false, flag: varName, raw: null, reason: `${varName} is not set — live sending is not permitted (default false)` };
  }
  // Anything not a string is a configuration mistake, not a permission.
  if (typeof raw !== 'string') {
    return { granted: false, flag: varName, raw: String(raw), reason: `${varName} is a ${typeof raw}, not a string — refusing rather than coercing` };
  }
  const v = raw.trim().toLowerCase();
  if (v === 'true') return { granted: true, flag: varName, raw, reason: `${varName}=true` };
  if (v === '') return { granted: false, flag: varName, raw, reason: `${varName} is empty — live sending is not permitted` };
  return {
    granted: false, flag: varName, raw,
    reason: `${varName}="${raw}" is not "true" — live sending is not permitted. ` +
            'Only "true" grants it (any case, trimmed). "1", "yes" and "on" do not, deliberately: ' +
            'accepting them invites "0"/"no"/"off", which are the values that get misread.',
  };
}

/**
 * The refusal an order path returns when Key 2 is missing. Named after the flag,
 * in the shape server.js already uses for the AmiBroker path.
 */
function liveBlocked(varName, extra = {}) {
  return { ok: false, error: `live_blocked_by_${varName}`, ...extra };
}

/**
 * Both keys, in one call, for a path that wants to send live.
 * Returns the FIRST missing key, so the operator is told one thing to fix.
 *
 * @param {object} args
 *   capability      boolean — Key 1, already evaluated by the caller
 *   capabilityFlag  the name of Key 1, for the refusal
 *   liveFlag        the name of Key 2
 *   env
 */
function maySendLive({ capability, capabilityFlag, liveFlag, env = process.env }) {
  if (!capability) {
    return { allowed: false, missing: capabilityFlag, reason: `blocked by ${capabilityFlag} — this component is not switched on`, key: 1 };
  }
  const p = livePermission(liveFlag, env);
  if (!p.granted) return { allowed: false, missing: liveFlag, reason: p.reason, key: 2 };
  return { allowed: true, missing: null, reason: `${capabilityFlag} and ${liveFlag} both granted`, key: null };
}

module.exports = { livePermission, liveBlocked, maySendLive };
