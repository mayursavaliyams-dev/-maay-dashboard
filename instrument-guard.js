/* ═══════════════════════════════════════════════════════════════════════════
   instrument-guard — refuse an instrument we do not have, never substitute one.

   WHY THIS FILE EXISTS

   On 2026-07-29, this was the live behaviour:

       GET /api/options/snapshot?instrument=TMPV
       → { "instrument": "TMPV", "spotPrice": 77654.6, ... }

   77654.6 is SENSEX. TMPV was ₹329.80. RELIANCE and NOTAREALTHING returned the
   same 77654.6, each labelled with the name that had been asked for. One line
   was responsible:

       return INSTRUMENT_META[key] || INSTRUMENT_META.SENSEX;

   That is a missing value replaced by a plausible one — the failure mode this
   project rejects everywhere else it appears. It is worse than an error,
   because a response that says TMPV and shows SENSEX gives nothing downstream
   any way to notice: not a chart, not a sizing call, not a person reading it.

   And it is reachable in ordinary operation. TATAMOTORS.NS stopped resolving
   when it demerged to TMPV. An exchange renaming a symbol is exactly how a name
   nobody typed by hand arrives at this lookup.

   THE SHAPE OF THE FIX

   Two halves, because there are two ways in:

     · guard()       one middleware on /api. A route added next month is covered
                     without being edited, which is the only version of this that
                     stays true — the 42 handlers reading an instrument today
                     were written in eight different shapes, and patching each
                     one is a sweep that silently misses the forty-third.

     · resolveMeta() throws on an unknown name, so an internal caller reaches the
                     same refusal.

   WHAT IS DELIBERATELY STILL ALLOWED

     · No instrument named at all → the route's own default. "Named nothing" is
       a real case with a real answer; only "named something we do not have" was
       ever a lie.
     · ALL, on the routes that genuinely aggregate. Switchable per mount.

   This module holds no market data and no state. It answers one question:
   is this a name we actually have?
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

/* The instruments this system actually trades. Kept as the default so a caller
   that forgets to pass its own list still gets a real answer rather than an
   empty set that would refuse everything. server.js passes the keys of its own
   INSTRUMENT_META, so the two cannot drift apart. */
const DEFAULT_KNOWN = ['SENSEX', 'NIFTY', 'BANKNIFTY'];

const norm = (v) => (v === null || v === undefined) ? '' : String(v).trim().toUpperCase();

function isKnown(name, known = DEFAULT_KNOWN) {
  const u = norm(name);
  return u !== '' && known.map(k => norm(k)).includes(u);
}

/* Resolve a name against a table of instrument metadata.

   Absent → the fallback, which is the caller's declared default.
   Unknown → throws. It does not return null: every one of the 23 call sites in
   server.js reads a property off the result immediately, so null would surface
   as "Cannot read properties of null" three frames away from the cause. An
   error that names the instrument and lists the alternatives is the same
   failure, said usefully. */
function resolveMeta(table, inst, fallbackKey) {
  const u = norm(inst);
  if (u === '') {
    const f = norm(fallbackKey);
    if (f && table[f]) return table[f];
    throw new Error('instrument-guard: no instrument given and no valid default configured');
  }
  if (table[u]) return table[u];
  throw new Error(
    `Unknown instrument "${inst}". This system has ${Object.keys(table).join(', ')}. ` +
    'Refusing rather than substituting one — a price under the wrong name is not recoverable downstream.',
  );
}

/* Express middleware. Checks both spellings the codebase uses (?inst= and
   ?instrument=) because both are in service and a guard that covers one of them
   is a guard that reports safety it does not provide. */
function guard(opts = {}) {
  const known = opts.known && opts.known.length ? opts.known : DEFAULT_KNOWN;
  const allowAll = opts.allowAll !== false;
  const keys = opts.keys || ['inst', 'instrument'];

  return function instrumentGuard(req, res, next) {
    const q = req && req.query;
    if (!q) return next();

    for (const key of keys) {
      const raw = q[key];
      if (raw === undefined || raw === null || raw === '') continue;

      // A repeated query parameter (?inst=NIFTY&inst=TMPV) arrives as an array.
      // Flattening it rather than skipping it: an array was the easiest way to
      // walk straight past a name-based check.
      const values = (Array.isArray(raw) ? raw : String(raw).split(','))
        .map(v => norm(v)).filter(v => v !== '');
      if (!values.length) continue;

      for (const v of values) {
        if (v === 'ALL' && allowAll) continue;
        if (isKnown(v, known)) continue;
        return res.status(400).json({
          ok: false,
          error: `Unknown instrument "${v}" in ?${key}=. Refusing the request rather than ` +
                 'answering with a different instrument under the name you asked for.',
          asked: v,
          supported: allowAll ? known.concat(['ALL']) : known.slice(),
        });
      }
    }
    return next();
  };
}

module.exports = { guard, isKnown, resolveMeta, DEFAULT_KNOWN };
