/* ═══════════════════════════════════════════════════════════════════════════
   stock-universe — search every listed Indian equity by symbol or name.

   WHY THIS FILE EXISTS

   The Stock View box could resolve 49 hand-listed symbols. Typing "consumer"
   returned "could not resolve to a listed stock". The market-data vendor's own
   search endpoint was measured as a replacement on 2026-07-30 and rejected:
   "rel" returned no RELIANCE, "hdf" no HDFCBANK, "sun" no SUNPHARMA — it is
   US-biased and unusable as an Indian autocomplete.

   The list therefore comes from the broker's instrument master, built by
   scripts/build-stock-universe.js into data/stock-universe.json. 5,798 symbols
   across NSE and BSE.

   RANKING IS THE WHOLE PROBLEM

   Matching is trivial; ordering is not. A plain substring match sorted
   alphabetically answers "rel" with "Avax Apparels and Ornaments" above
   RELIANCE — every result correct, the list useless. So matches are placed in
   explicit tiers, and within a tier the main board wins, then the shorter
   symbol, then alphabetical order.

   The tiers are deliberately readable rather than clever. A scoring formula with
   tuned weights cannot be explained to the person wondering why their stock is
   fourth; a tier list can.

   NO NETWORK, NO STATE. The file is loaded once and searched in memory, so this
   module is a pure function of its input and can be tested without a server.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

const { readJsonSync } = require('./safe-write');

const FILE = path.join(__dirname, 'data', 'stock-universe.json');

/* Boards, best first. NSE's main board carries the companies almost everyone is
   looking for; SME, trade-to-trade and the BSE tail carry the ones almost nobody
   is. This orders equally-good textual matches — it never promotes a worse match
   above a better one. */
const BOARD_RANK = { EQ: 0, BE: 1, RR: 1, IV: 1, A: 2, B: 3, SM: 4, ST: 4, T: 4, M: 5, MT: 5, BZ: 6, Z: 6 };

/* Prominence, used only to order matches that are equally good textually.

   `f` marks a stock whose underlying has listed derivatives — 208 of 5,798. That
   is the exchange's own liquidity judgement, since admission to F&O is granted on
   measured turnover and delivery criteria, and it is the only such signal present
   in the instrument master.

   It is what puts RELIANCE above RELTD, RELAXO, RELCHEMQ and RELIABLE for "rel",
   and SUNPHARMA into the top five for "sun" — all of which were correct matches
   before, in an order nobody wanted.

   This orders equal matches. It never promotes a worse textual match above a
   better one, because the tier is always compared first. */
const boardRank = (r) => {
  const t = BOARD_RANK[r.t];
  const base = (t === undefined ? 7 : t);
  const board = r.e === 'NSE' ? base : base + 0.5;   // NSE ahead of BSE on a tie
  return (r.f ? 0 : 10) + board;                     // F&O names ahead of everything else
};

let _cache = null;

/** Load the universe. Returns { stocks: [], builtAt, error } — never throws. */
function load(force) {
  if (_cache && !force) return _cache;
  try {
    const raw = readJsonSync(FILE, { fallback: null });
    if (!raw) throw Object.assign(new Error('universe not built'), { code: 'ENOENT' });
    const stocks = Array.isArray(raw.stocks) ? raw.stocks : [];
    // Uppercase name kept alongside, so search does not re-uppercase 5,798
    // strings on every keystroke.
    for (const r of stocks) r.N = String(r.n || '').toUpperCase();
    _cache = { stocks, builtAt: raw.builtAt || null, counts: raw.counts || null, source: raw.source || null, error: null };
  } catch (e) {
    // A missing or unreadable universe is reported, not silently treated as an
    // empty market. "0 stocks listed in India" and "the file is not built" look
    // identical to a user unless one of them says so.
    _cache = { stocks: [], builtAt: null, counts: null, source: null, error: e.code === 'ENOENT'
      ? 'stock universe not built — run: npm run build:universe'
      : e.message };
  }
  return _cache;
}

/* Word-boundary prefix: does any word of the name start with q?
   "asian" should reach "ASIAN HOTELS", and "hotels" should reach it too. */
function wordStarts(name, q) {
  if (name.startsWith(q)) return true;
  let i = 0;
  while ((i = name.indexOf(' ', i)) !== -1) {
    i += 1;
    if (name.startsWith(q, i)) return true;
  }
  return false;
}

/**
 * Search the universe.
 * @param {string} query   what the user typed
 * @param {number} limit   maximum rows returned
 * @returns {{ok:boolean, query:string, results:Array, total:number, error:?string}}
 */
function search(query, limit = 20) {
  const u = load();
  const q = String(query || '').trim().toUpperCase();
  if (u.error) return { ok: false, query: q, results: [], total: 0, error: u.error };
  // One character is a legitimate search — the request was that typing a single
  // letter brings up the near matches.
  if (!q) return { ok: true, query: q, results: [], total: 0, error: null };

  const out = [];
  for (const r of u.stocks) {
    let tier;
    if (r.s === q) tier = 0;                         // exact symbol
    else if (r.s.startsWith(q)) tier = 1;            // symbol prefix
    else if (wordStarts(r.N, q)) tier = 2;           // a word of the name starts with it
    else if (r.s.includes(q)) tier = 3;              // symbol contains
    else if (r.N.includes(q)) tier = 4;              // name contains
    else continue;
    out.push({ r, tier });
  }

  out.sort((a, b) =>
    a.tier - b.tier ||
    boardRank(a.r) - boardRank(b.r) ||
    a.r.s.length - b.r.s.length ||
    a.r.s.localeCompare(b.r.s));

  return {
    ok: true,
    query: q,
    // `total` is the full match count, not the truncated one. A dropdown showing
    // 20 of 38 must be able to say so; showing 20 and implying that is all of
    // them is the same class of quiet lie as a silent filter.
    total: out.length,
    results: out.slice(0, limit).map(x => ({
      symbol: x.r.s, name: x.r.n, exchange: x.r.e, board: x.r.t, tier: x.tier,
      // Surfaced so the dropdown can mark it. It is a liquidity proxy, not a
      // recommendation, and the badge says only "F&O" — nothing about quality.
      fno: x.r.f === 1,
    })),
    error: null,
  };
}

/** Exact symbol lookup, used to resolve before a full analysis. */
function bySymbol(sym) {
  const u = load();
  const q = String(sym || '').trim().toUpperCase();
  if (!q) return null;
  const hit = u.stocks.find(r => r.s === q);
  return hit ? { symbol: hit.s, name: hit.n, exchange: hit.e, board: hit.t } : null;
}

/** What the universe is and when it was built — for the health surface. */
function status() {
  const u = load();
  return { built: !!u.builtAt, builtAt: u.builtAt, count: u.stocks.length, counts: u.counts, source: u.source, error: u.error };
}

module.exports = { search, bySymbol, status, load };
