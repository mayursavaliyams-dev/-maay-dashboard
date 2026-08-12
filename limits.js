/* limits — a malformed number is a refusal, never a NaN that flows onward.
   Phase 1B of the backend hardening programme. See docs/086, docs/087.

   THE DEFECT, MEASURED 2026-08-08 AGAINST THE REAL ENGINE
   -------------------------------------------------------
       AFTERNOON_MAX_TRADES=abc
       → parseInt("abc") → NaN
       → afternoon-engine.js:374   if (this._tradesToday >= this.maxTrades) return;

       tradesToday=         0  >= NaN  →  false
       tradesToday=         1  >= NaN  →  false
       tradesToday=       100  >= NaN  →  false
       tradesToday=1000000000  >= NaN  →  false

   The cap is false for every possible count. The limit does not exist. There is
   no error, no log, and no test failure — the system reports itself as
   configured with a maximum of NaN trades and then takes as many as it likes.

   Every comparison operator behaves this way with NaN. `>=`, `>`, `<`, `<=` are
   all false; `===` is false; `!==` is true. A limit checked with `>=` vanishes;
   a limit checked with `<` blocks everything. Which of those you get depends on
   which way the author happened to write the comparison, and neither is what
   was configured.

   WHAT `risk-config.js` ALREADY GETS RIGHT
   ---------------------------------------
   risk-config.js:132 already rejects non-finite values, with exactly this
   reasoning written beside it:

       if (!Number.isFinite(n)) { _rejected.push({ key, raw,
         why: 'not a finite number — a NaN limit disables its check entirely' });

   So the dedicated risk module is not the problem. The problem is that the
   engines parse their own limits directly out of the environment and never go
   near it. This module is that guarantee, made available to them.

   THE RULES
   ---------
   1. Absent or empty  → the default. An unset variable is a normal state.
   2. Malformed        → a NAMED ERROR. Never the default: silently defaulting a
                         typo means MAX_TRADES=I0 runs at the default forever and
                         the operator believes their value took effect.
   3. Out of bounds    → a NAMED ERROR. A limit outside its declared range was
                         intended as something, and it was not this.
   4. The result is always a finite number, or there is no result.

   Rule 2 is the one that is tempting to break. Falling back to a default on a
   malformed value feels safe and is the more dangerous choice: it converts an
   operator error into a silent policy change. */
'use strict';

/** Read and validate one numeric limit.
 *
 *  @returns { name, value, source, ok, error }
 *           `value` is a finite number when ok, and null otherwise. Never NaN.
 */
function readLimit(name, {
  default: dflt = undefined, min = -Infinity, max = Infinity,
  integer = false, required = false, env = process.env,
} = {}) {
  const raw = env[name];
  const absent = raw === undefined || raw === null || String(raw).trim() === '';

  if (absent) {
    if (required) {
      return { name, value: null, source: 'missing', ok: false,
        error: `${name} is required and is not set` };
    }
    if (dflt === undefined) {
      return { name, value: null, source: 'missing', ok: false,
        error: `${name} is not set and has no default` };
    }
    return { name, value: dflt, source: 'default', ok: true, error: null };
  }

  const text = String(raw).trim();

  /* Number() rather than parseInt/parseFloat, deliberately.
     parseInt("12abc") is 12 — it reads a prefix and discards the rest, so a
     mistyped value becomes a different valid value with no complaint. Number()
     returns NaN for the whole string, which is what a mistyped value is. */
  const n = Number(text);

  if (!Number.isFinite(n)) {
    return { name, value: null, source: 'env', ok: false,
      error: `${name}=${JSON.stringify(text)} is not a finite number. ` +
             'A non-finite limit makes every comparison against it false, which ' +
             'removes the limit rather than applying it.' };
  }
  if (integer && !Number.isInteger(n)) {
    return { name, value: null, source: 'env', ok: false,
      error: `${name}=${JSON.stringify(text)} must be a whole number` };
  }
  if (n < min || n > max) {
    return { name, value: null, source: 'env', ok: false,
      error: `${name}=${n} is outside the permitted range [${min}, ${max}]` };
  }
  return { name, value: n, source: 'env', ok: true, error: null };
}

/** Read a whole specification at once.
 *
 *  @param spec  { NAME: { default, min, max, integer, required }, … }
 *  @returns { values, errors, ok }
 *
 *  `values` contains only the limits that validated. A caller that reads a key
 *  which failed gets `undefined` rather than a wrong number — the shape of the
 *  result cannot be used to smuggle a bad value through.
 */
function readLimits(spec, env = process.env) {
  const values = {};
  const errors = [];
  for (const [name, rule] of Object.entries(spec)) {
    const r = readLimit(name, { ...rule, env });
    if (r.ok) values[name] = r.value;
    else errors.push({ name, error: r.error });
  }
  return { values, errors, ok: errors.length === 0 };
}

/** Read a specification, or refuse to start.
 *
 *  Every failure is named in one message. Reporting them one at a time makes an
 *  operator restart once per mistake to discover the next one. */
function assertLimits(spec, env = process.env) {
  const r = readLimits(spec, env);
  if (!r.ok) {
    const lines = r.errors.map((e) => `  · ${e.error}`).join('\n');
    throw new Error(`[limits] refusing to start — ${r.errors.length} invalid limit(s):\n${lines}`);
  }
  return r.values;
}

/** Would this value make its comparison meaningless?
 *
 *  Exists so the property can be asserted directly in tests rather than
 *  inferred from a list of inputs somebody thought of. A limit is degenerate
 *  when `n >= limit` has the same answer for every n — which is what NaN does,
 *  and which is the whole defect. */
function isDegenerateLimit(v) {
  if (typeof v !== 'number') return true;
  if (!Number.isFinite(v)) return true;
  return false;
}

module.exports = { readLimit, readLimits, assertLimits, isDegenerateLimit };
