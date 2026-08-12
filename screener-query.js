/* screener-query — a Screener.in-style query language, parsed rather than evaluated.
   Research and design: docs/090.

   WHAT IT IS FOR
     "Market Capitalization > 30000 AND Debt to equity < 0.5 AND Current price > 100"

   THREE DECISIONS WORTH THE WORDS
   -------------------------------

   1. NO eval, NO new Function.
      A screen query is user input arriving over HTTP. A grammar that reaches the
      JavaScript evaluator is a remote code execution hole wearing a finance
      costume. This is a recursive descent parser producing an AST, and an
      evaluator that walks it. Nothing here can call anything.

   2. A MISSING VALUE IS UNEVALUABLE, NEVER false.
      Every other screener drops a stock whose P/E is unavailable, which blends
      "failed the test" with "could not be tested". A fetch outage then produces
      an ordinary-looking result set. Here a stock missing a field the query needs
      comes back in its own bucket WITH THE FIELD NAMED, so 400 unevaluable stocks
      look like 400 unevaluable stocks and not like a demanding screen.

      This is the same three-valued rule the order path uses — PASS / BLOCKED /
      UNEVALUABLE, never merged — applied to research.

   3. FIELD NAMES ARE MATCHED LONGEST-FIRST.
      `Price to book value` must win over `Price`. Matching shortest-first, or in
      declaration order, lets a short name shadow a longer one and silently screen
      on the wrong number — which is worse than failing to parse, because it
      produces a plausible answer.

   ON UNITS
     Two fields that differ only in unit may never share a name. Measured
     2026-08-10: yahoo returns dividendYield as 0.45 from `quote` and 0.0045 from
     `summaryDetail` for the same stock at the same moment. A query written as
     `Dividend yield > 1` returns sensible stocks against one and NOTHING against
     the other — an empty result that reads as a correct answer to a strict query.
     Hence `unit` on every registry entry, and the resolver refuses a field whose
     unit was never declared. */
'use strict';

/* ── tokens ────────────────────────────────────────────────────────────────── */

const KEYWORDS = new Set(['AND', 'OR', 'NOT', 'IN']);
const CMP = ['>=', '<=', '!=', '==', '>', '<', '='];

function tokenize(src, fieldNames) {
  /* Longest-first, so a longer field name can never be shadowed by a shorter one
     that happens to be a prefix of it. Sorted once per call rather than per
     token — this runs against 5,798 stocks and the sort must not be in the loop. */
  const names = [...fieldNames].sort((a, b) => b.length - a.length);
  const tokens = [];
  let i = 0;

  const isWordChar = (c) => /[A-Za-z0-9_%]/.test(c);

  while (i < src.length) {
    const c = src[i];

    if (/\s/.test(c)) { i++; continue; }

    if (c === '(' || c === ')' || c === ',') { tokens.push({ t: c, at: i }); i++; continue; }

    /* A quoted string. Text fields (Sector, Industry) need one, and quoting is
       what separates a VALUE from a field name: without quotes, `Sector = Energy`
       would send the tokenizer looking for a field called Energy and refuse a
       query that is perfectly clear to its author. */
    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new QueryError(`unterminated string starting at ${i}`, i);
      tokens.push({ t: 'str', v: src.slice(i + 1, end), at: i });
      i = end + 1;
      continue;
    }

    const cmp = CMP.find((op) => src.startsWith(op, i));
    if (cmp) { tokens.push({ t: 'cmp', v: cmp === '==' ? '=' : cmp, at: i }); i += cmp.length; continue; }

    if ('+-*/'.includes(c)) { tokens.push({ t: 'op', v: c, at: i }); i++; continue; }

    /* FIELD NAMES ARE TRIED BEFORE NUMBERS.

       MEASURED 2026-08-10 against live data: with the number branch first,
       `Current price > 52 week low * 1.5` failed with `unknown field "week"` —
       the tokenizer consumed `52` as a number and then met a bare word. Every
       field whose name begins with a digit was unreachable, which is `52 week
       low` and `52 week high`, the two most common range fields in a screen.

       Trying fields first is safe because the match is a prefix match with a
       boundary check: in `PE < 52` the text after `52` does not continue
       ` week low`, so no field matches and it falls through to the number branch
       one line below. */
    const rest = src.slice(i);
    const hit = names.find((n) => rest.toLowerCase().startsWith(n.toLowerCase())
      // must end on a boundary: "Price" must not match inside "Priceless"
      && !isWordChar(rest[n.length] || ' '));
    if (hit) {
      tokens.push({ t: 'field', v: hit, at: i });
      i += hit.length;
      continue;
    }

    // number: 12, 12.5, .5, 1e3
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i));
      tokens.push({ t: 'num', v: Number(m[0]), at: i });
      i += m[0].length;
      continue;
    }

    if (isWordChar(c)) {
      // a keyword, standing alone
      const word = /^[A-Za-z0-9_%]+/.exec(rest)[0];
      if (KEYWORDS.has(word.toUpperCase())) {
        tokens.push({ t: word.toUpperCase(), at: i });
        i += word.length;
        continue;
      }
      /* An unknown word is an error that NAMES THE WORD. Skipping it, or treating
         it as zero, is how a typo becomes a screen that quietly means something
         else. */
      throw new QueryError(`unknown field ${JSON.stringify(word)}`, i, word);
    }

    throw new QueryError(`unexpected character ${JSON.stringify(c)}`, i);
  }
  tokens.push({ t: 'end', at: src.length });
  return tokens;
}

class QueryError extends Error {
  constructor(message, at, word) {
    super(message);
    this.name = 'QueryError';
    this.at = at;
    this.word = word || null;
  }
}

/* ── parser: recursive descent, precedence NOT > AND > OR ──────────────────── */

function parse(src, fieldNames) {
  const tk = tokenize(src, fieldNames);
  let p = 0;
  const peek = () => tk[p];
  const eat = (t) => { if (tk[p].t === t) return tk[p++]; return null; };
  const expect = (t) => {
    const got = eat(t);
    if (!got) throw new QueryError(`expected ${t} but found ${tk[p].t}`, tk[p].at);
    return got;
  };

  function orExpr() {
    let left = andExpr();
    while (eat('OR')) left = { k: 'or', left, right: andExpr() };
    return left;
  }
  function andExpr() {
    let left = notExpr();
    while (eat('AND')) left = { k: 'and', left, right: notExpr() };
    return left;
  }
  function notExpr() {
    if (eat('NOT')) return { k: 'not', expr: notExpr() };
    return comparison();
  }
  function comparison() {
    const left = arith();

    /* `Sector IN ("Energy", "Utilities")`. Without it a three-sector filter is
       three ORs and a pair of parentheses, which people get wrong. */
    if (eat('IN')) {
      expect('(');
      const list = [];
      do {
        const t = peek();
        if (t.t === 'str') { p++; list.push({ k: 'str', v: t.v }); }
        else if (t.t === 'num') { p++; list.push({ k: 'num', v: t.v }); }
        else throw new QueryError(`IN takes a list of values, found ${t.t}`, t.at);
      } while (eat(','));
      expect(')');
      if (!list.length) throw new QueryError('IN () is empty — it can never match', peek().at);
      return { k: 'in', left, list };
    }

    const op = eat('cmp');
    if (!op) return left;                       // a bare arithmetic node; see evaluate()
    return { k: 'cmp', op: op.v, left, right: arith() };
  }
  function arith() {
    let left = term();
    for (;;) {
      const t = peek();
      if (t.t === 'op' && (t.v === '+' || t.v === '-')) { p++; left = { k: 'bin', op: t.v, left, right: term() }; }
      else return left;
    }
  }
  function term() {
    let left = factor();
    for (;;) {
      const t = peek();
      if (t.t === 'op' && (t.v === '*' || t.v === '/')) { p++; left = { k: 'bin', op: t.v, left, right: factor() }; }
      else return left;
    }
  }
  function factor() {
    const t = peek();
    if (t.t === 'op' && t.v === '-') { p++; return { k: 'neg', expr: factor() }; }
    if (t.t === '(') { p++; const e = orExpr(); expect(')'); return e; }
    if (t.t === 'num') { p++; return { k: 'num', v: t.v }; }
    if (t.t === 'str') { p++; return { k: 'str', v: t.v }; }
    if (t.t === 'field') { p++; return { k: 'field', v: t.v }; }
    throw new QueryError(`expected a number, a string, a field or '(' but found ${t.t}`, t.at);
  }

  const ast = orExpr();
  if (peek().t !== 'end') throw new QueryError(`unexpected ${peek().t} after the end of the query`, peek().at);
  return ast;
}

/** Every field a query reads. Used to fetch only what is needed and to report
 *  which field made a stock unevaluable. */
function fieldsUsed(ast, out = new Set()) {
  if (!ast || typeof ast !== 'object') return out;
  if (ast.k === 'field') out.add(ast.v);
  for (const key of ['left', 'right', 'expr']) if (ast[key]) fieldsUsed(ast[key], out);
  return out;
}

/* ── evaluation ────────────────────────────────────────────────────────────── */

/* The one sentinel. A missing field poisons its whole expression: any arithmetic
   or comparison touching it yields MISSING, and MISSING at the top means the
   stock is UNEVALUABLE rather than rejected.

   NOT a NaN. NaN silently makes every comparison false, which is precisely the
   defect that removed a daily trade cap in this codebase (docs/089 §1B) — and
   here it would silently reject a stock instead of admitting it could not test
   it. The distinction is the point of the module. */
const MISSING = Symbol('missing');

function evalNode(ast, row, missingFields) {
  switch (ast.k) {
    case 'num': return ast.v;

    case 'str': return ast.v;

    case 'field': {
      /* OWN properties only.
         `row[name]` walks the prototype chain, so a row built with Object.create,
         or one whose prototype was polluted upstream, would have inherited values
         read as though they were this stock's data. A screen result must be a
         statement about the row in front of it. */
      const v = Object.prototype.hasOwnProperty.call(row, ast.v) ? row[ast.v] : undefined;
      if (v === undefined || v === null || (typeof v === 'number' && !Number.isFinite(v))) {
        missingFields.add(ast.v);
        return MISSING;
      }
      if (typeof v === 'string') return v.trim() === '' ? (missingFields.add(ast.v), MISSING) : v;
      if (typeof v !== 'number') { missingFields.add(ast.v); return MISSING; }
      return v;
    }

    case 'neg': {
      const v = evalNode(ast.expr, row, missingFields);
      return v === MISSING ? MISSING : -v;
    }

    case 'bin': {
      const a = evalNode(ast.left, row, missingFields);
      const b = evalNode(ast.right, row, missingFields);
      if (a === MISSING || b === MISSING) return MISSING;
      switch (ast.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? MISSING : a / b;   // a divide by zero is unknown, not Infinity
        default: throw new QueryError(`unknown operator ${ast.op}`);
      }
    }

    case 'cmp': {
      const a = evalNode(ast.left, row, missingFields);
      const b = evalNode(ast.right, row, missingFields);
      if (a === MISSING || b === MISSING) return MISSING;

      /* String equality is CASE-INSENSITIVE and trimmed.
         The vendor writes "Energy"; a person types "energy". Making them differ
         would produce an empty result set that reads as "no energy stocks match"
         rather than "you typed it in lower case" — the same class of silent wrong
         answer as the dividend-yield unit trap in docs/090 §3.
         Ordering comparisons on strings are refused by validate(), not here. */
      if (typeof a === 'string' || typeof b === 'string') {
        const sa = String(a).trim().toLowerCase();
        const sb = String(b).trim().toLowerCase();
        if (ast.op === '=') return sa === sb;
        if (ast.op === '!=') return sa !== sb;
        throw new QueryError(`${ast.op} does not apply to text — use = or != or IN`);
      }

      switch (ast.op) {
        case '>': return a > b;
        case '>=': return a >= b;
        case '<': return a < b;
        case '<=': return a <= b;
        case '=': return a === b;
        case '!=': return a !== b;
        default: throw new QueryError(`unknown comparison ${ast.op}`);
      }
    }

    case 'in': {
      const a = evalNode(ast.left, row, missingFields);
      if (a === MISSING) return MISSING;
      const norm = (x) => (typeof x === 'string' ? x.trim().toLowerCase() : x);
      const target = norm(a);
      return ast.list.some((n) => norm(n.v) === target);
    }

    case 'not': {
      const v = evalNode(ast.expr, row, missingFields);
      return v === MISSING ? MISSING : !v;
    }

    /* AND and OR do NOT short-circuit past MISSING.

       `false AND missing` is false — the answer is known whatever the missing
       side turns out to be, so the stock is genuinely rejected and saying
       "unevaluable" would be wrong.
       `true AND missing` is MISSING — we cannot tell.
       Symmetrically for OR. This is Kleene three-valued logic, and getting it
       wrong in either direction turns a data gap into a screening verdict. */
    case 'and': {
      const a = evalNode(ast.left, row, missingFields);
      const b = evalNode(ast.right, row, missingFields);
      if (a === false || b === false) return false;
      if (a === MISSING || b === MISSING) return MISSING;
      return !!(a && b);
    }
    case 'or': {
      const a = evalNode(ast.left, row, missingFields);
      const b = evalNode(ast.right, row, missingFields);
      if (a === true || b === true) return true;
      if (a === MISSING || b === MISSING) return MISSING;
      return !!(a || b);
    }

    default: throw new QueryError(`unknown node ${ast.k}`);
  }
}

/** Run a parsed query over rows.
 *
 *  @param rows  [{ symbol, ...fields }]
 *  @returns { matched[], rejected[], unevaluable[], counts, fieldsUsed }
 *
 *  Three sets, never merged. `unevaluable` entries carry `missing: [field…]` so
 *  "no results" can always be told apart from "no data".
 */
function run(ast, rows, { keyField = 'symbol' } = {}) {
  const matched = [];
  const rejected = [];
  const unevaluable = [];
  const missingTally = {};

  for (const row of rows) {
    const missing = new Set();
    let verdict;
    try {
      verdict = evalNode(ast, row, missing);
    } catch (e) {
      unevaluable.push({ [keyField]: row[keyField], missing: [], error: e.message });
      continue;
    }
    if (verdict === MISSING) {
      const list = [...missing].sort();
      for (const f of list) missingTally[f] = (missingTally[f] || 0) + 1;
      unevaluable.push({ ...row, missing: list });
    } else if (verdict === true) matched.push(row);
    else if (verdict === false) rejected.push(row);
    else {
      /* A bare arithmetic query — `Market Capitalization > 100` is a comparison,
         but `Market Capitalization` alone is a number. Screening on a number is
         not a question, and quietly treating non-zero as "matched" would answer a
         question the user did not ask. */
      throw new QueryError('the query is not a condition — it evaluates to a number, not to true or false. Add a comparison, e.g. "> 100".');
    }
  }

  return {
    matched,
    rejected,
    unevaluable,
    counts: {
      total: rows.length,
      matched: matched.length,
      rejected: rejected.length,
      unevaluable: unevaluable.length,
    },
    missingByField: missingTally,
    fieldsUsed: [...fieldsUsed(ast)].sort(),
  };
}

/** Refuse type mistakes ONCE, at the query, instead of once per row.
 *
 *  A text field in an arithmetic or ordering position is a mistake in the query,
 *  not a gap in the data. Discovering it during evaluation would produce 208
 *  identical errors and — worse — would tempt the evaluator into returning
 *  MISSING, which would report the author's mistake as an outage.
 *
 *  @param typeOf  (fieldName) => 'number' | 'text' | undefined.
 *                 Omit it and no type checking happens; nothing here guesses.
 */
function validate(ast, typeOf) {
  if (typeof typeOf !== 'function') return;
  const ORDERING = new Set(['>', '>=', '<', '<=']);

  const typeOfNode = (n) => {
    if (!n) return undefined;
    if (n.k === 'num') return 'number';
    if (n.k === 'str') return 'text';
    if (n.k === 'field') return typeOf(n.v);
    if (n.k === 'bin' || n.k === 'neg') return 'number';
    return undefined;
  };

  const walk = (n) => {
    if (!n || typeof n !== 'object') return;

    if (n.k === 'bin' || n.k === 'neg') {
      for (const side of ['left', 'right', 'expr']) {
        const t = typeOfNode(n[side]);
        if (t === 'text') {
          const name = n[side].k === 'field' ? n[side].v : JSON.stringify(n[side].v);
          throw new QueryError(`${name} is a text field and cannot be used in arithmetic`);
        }
      }
    }

    if (n.k === 'cmp') {
      const lt = typeOfNode(n.left);
      const rt = typeOfNode(n.right);
      if (ORDERING.has(n.op) && (lt === 'text' || rt === 'text')) {
        const which = lt === 'text' ? n.left : n.right;
        const name = which.k === 'field' ? which.v : JSON.stringify(which.v);
        throw new QueryError(`${name} is text — ${n.op} does not apply. Use = , != or IN.`);
      }
      if (lt && rt && lt !== rt) {
        throw new QueryError(`cannot compare ${lt} with ${rt} — check the quotes`);
      }
    }

    if (n.k === 'in') {
      const lt = typeOfNode(n.left);
      for (const item of n.list) {
        const it = item.k === 'str' ? 'text' : 'number';
        if (lt && it !== lt) throw new QueryError(`IN list mixes ${it} with a ${lt} field`);
      }
    }

    for (const key of ['left', 'right', 'expr']) if (n[key]) walk(n[key]);
  };
  walk(ast);
}

/** Parse and run in one call.
 *
 *  @param typeOf  optional; when given, type mistakes are refused before any row
 *                 is touched. See validate().
 */
function screen(queryText, rows, fieldNames, opts = {}) {
  const ast = parse(queryText, fieldNames);
  validate(ast, opts.typeOf);
  return { ast, ...run(ast, rows, opts) };
}

module.exports = { parse, validate, run, screen, fieldsUsed, tokenize, QueryError, MISSING };
