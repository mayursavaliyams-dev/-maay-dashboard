/* ═══════════════════════════════════════════════════════════════════════════
   arming — how THIS deployable (antigravity-stock-bot) decides it may trade.

   WHY THIS FILE EXISTS

   A census of the whole estate on 2026-07-31 found the following chain:

     1. stock/equity-connector.js placeOrder() is FULLY IMPLEMENTED — it POSTs
        to Dhan /v2/orders. It is not a stub and it does not throw.
     2. stock/stock-engine.js:386 and :507 call it directly. None of the main
        bot's controls apply here: no chokepoint, no risk layer, no circuit
        breaker, no approval.
     3. It was gated by `process.env.TRADE_MODE`, which is THE SAME VARIABLE the
        main bot reads. One flag, two deployables.
     4. This deployable has no .env of its own. Launched from the repository
        root — which is how the batch files launch it — dotenv resolves against
        process.cwd() and it loads the ROOT .env.
     5. The root .env holds DHAN_CLIENT_ID (10 chars) and DHAN_ACCESS_TOKEN
        (303 chars), both present and both valid-looking.

   So setting TRADE_MODE=live — one variable, in a file shared with the main
   bot — armed a second bot with a working order path and no controls. Anyone
   setting that variable would have been thinking about the main bot, which is
   protected by the chokepoint. They would not have been thinking about this one.

   TWO BARRIERS, NOT ONE

   A. THE FLAG IS NAMESPACED. This deployable reads STOCK_TRADE_MODE and never
      TRADE_MODE. The main bot's flag can no longer reach it. A flag named for
      the system arms the system; a flag named for a component arms a component.

   B. THE CREDENTIALS MUST BE ITS OWN. Even with STOCK_TRADE_MODE=live, this
      deployable will not go live on credentials it merely happened to find in a
      shared file. It requires STOCK_DHAN_CLIENT_ID and STOCK_DHAN_ACCESS_TOKEN,
      which exist nowhere unless someone puts them there deliberately.

   Barrier B is the one that matters. A flag is a delay; a credential it does
   not hold is a barrier. Until the broker can issue a data-scoped key, or this
   bot gets its own funded account, that is the strongest available separation —
   and it means a flag change alone can no longer make this component dangerous.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const { livePermission } = require('../live-permission');

const OWN_MODE_VAR = 'STOCK_TRADE_MODE';        // KEY 1 — capability
const OWN_LIVE_VAR = 'STOCK_ALLOW_LIVE';        // KEY 2 — live permission, default false
const OWN_CRED_VARS = ['STOCK_DHAN_CLIENT_ID', 'STOCK_DHAN_ACCESS_TOKEN'];

/**
 * @param {object} env  process.env (injected so this is testable)
 * @returns {{ live: boolean, paperMode: boolean, reason: string, wanted: boolean }}
 */
const OLD_SHARED_VAR = 'TRADE_MODE';

/**
 * Refuse to start when the OLD shared flag says live and the new one is absent.
 *
 * Silently defaulting to paper here would be safe for money and wrong for the
 * operator: they set TRADE_MODE=live, they believe this bot is live, and it is
 * not. A silent fallback to the old name would also reintroduce the coupling
 * being removed — the next person would "fix" the fallback and re-arm two bots
 * with one variable.
 *
 * The check fires only when the old flag is set to LIVE. `TRADE_MODE=paper` is
 * the normal resting state of the shared file and must not stop anything.
 *
 * @throws Error with code ARMING_OLD_FLAG
 */
function assertNoLegacyArming(env = process.env) {
  const oldSaysLive = String(env[OLD_SHARED_VAR] || '').toLowerCase() === 'live';
  const newIsSet = env[OWN_MODE_VAR] != null && String(env[OWN_MODE_VAR]).trim() !== '';
  if (oldSaysLive && !newIsSet) {
    throw Object.assign(new Error(
      `${OLD_SHARED_VAR}=live is set but ${OWN_MODE_VAR} is not.\n` +
      `  ${OLD_SHARED_VAR} arms the OPTIONS bot and no longer reaches this one. This deployable\n` +
      `  has its own order path and none of the options bot's controls, so it was given its own\n` +
      `  flag deliberately (docs/083 §0).\n` +
      `  Set ${OWN_MODE_VAR}=paper to run in paper, or ${OWN_MODE_VAR}=live plus\n` +
      `  ${OWN_CRED_VARS.join(' and ')} to run live. Refusing to start rather than\n` +
      `  guessing which you meant.`
    ), { code: 'ARMING_OLD_FLAG' });
  }
}

function armingState(env = process.env) {
  assertNoLegacyArming(env);
  const wanted = String(env[OWN_MODE_VAR] || 'paper').toLowerCase() === 'live';

  if (!wanted) {
    return {
      live: false, paperMode: true, wanted: false,
      reason: `${OWN_MODE_VAR} is not "live" — paper mode`,
    };
  }

  /* KEY 2 — LIVE PERMISSION, read from its own variable.

     STOCK_TRADE_MODE=live is KEY 1: this component is switched on and may act.
     It is not permission to reach a broker. Those are separate decisions and
     the AmiBroker bridge is the one path in this estate that already treats
     them separately (AMIBROKER_AUTO_TRADE + AMIBROKER_ALLOW_LIVE). This is that
     pattern, not a second mechanism.

     Checked BEFORE credentials, deliberately. Credential presence is a fact
     about a file; permission is a decision someone made. Reporting "you are
     missing credentials" to an operator who never granted live permission tells
     them to go and add credentials, which is the wrong next step. */
  const perm = livePermission(OWN_LIVE_VAR, env);
  if (!perm.granted) {
    return {
      live: false, paperMode: true, wanted: true,
      reason: `${OWN_MODE_VAR}=live but ${perm.reason}. Generating a trade and being permitted ` +
              `to send it are separate decisions; set ${OWN_LIVE_VAR}=true to grant the second. Staying in paper.`,
      blockedBy: OWN_LIVE_VAR,
    };
  }

  const missing = OWN_CRED_VARS.filter(k => !env[k]);
  if (missing.length) {
    return {
      live: false, paperMode: true, wanted: true,
      reason:
        `${OWN_MODE_VAR}=live and ${OWN_LIVE_VAR}=true, but this deployable has no credentials OF ITS OWN: ${missing.join(', ')} not set. ` +
        'It will NOT fall back to DHAN_CLIENT_ID / DHAN_ACCESS_TOKEN from a shared .env — ' +
        'inheriting order-capable credentials from a file it merely resolves to is exactly how ' +
        'one flag change armed an uncontrolled order path. Staying in paper.',
      blockedBy: OWN_CRED_VARS.filter(k => !env[k]).join(','),
    };
  }

  return {
    live: true, paperMode: false, wanted: true,
    reason: `${OWN_MODE_VAR}=live, ${OWN_LIVE_VAR}=true, and its own credentials are present`,
    blockedBy: null,
  };
}

/** The credentials this deployable is allowed to use. Never the shared ones. */
function ownCredentials(env = process.env) {
  return { clientId: env.STOCK_DHAN_CLIENT_ID || null, accessToken: env.STOCK_DHAN_ACCESS_TOKEN || null };
}

module.exports = { armingState, assertNoLegacyArming, ownCredentials, OWN_MODE_VAR, OWN_LIVE_VAR, OWN_CRED_VARS, OLD_SHARED_VAR };
