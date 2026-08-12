/* screener-backtest — what would this screen have returned, and what happened next.
   Research: docs/091 §4. Design constraints: docs/090.

   WHY THIS EXISTS
     Four Indian products already screen NSE F&O by IV rank. None of them tells
     you whether the screen has ever worked. That is the gap, and it is a gap
     because answering honestly is unattractive: the honest answer is often "it
     did not".

   THE ONE RULE
     A field may be used only if its value on the as-of date can be reconstructed
     FROM BARS THAT EXISTED ON THAT DATE.

     Everything else is refused BY NAME. Today's P/E, today's market cap and
     today's sector are facts about today. Screening 2025-03-01 with them is
     look-ahead bias — the backtest would "discover" that cheap-today stocks did
     well, which is a statement about the present, not a strategy.

     That refusal is the feature. It is also why this file is short: most of the
     work of an honest backtest is declining to do the dishonest one.

   WHAT IT STILL CANNOT FIX — stated, not buried
     SURVIVORSHIP. The universe is today's F&O list. Names that left the segment,
     were delisted or were acquired are simply absent, and their absence is not
     random — it is correlated with having done badly. Published work on Indian
     small-caps measures this at roughly 23% of reported return (26.17% on
     survivors vs 21.23% on the true universe). Every result from this module
     carries the flag; nothing here removes the bias, because the historical
     constituent list is not held.

     COSTS. Forward returns here are gross. Brokerage, STT, slippage and impact
     are not modelled. A screen that beats the benchmark by less than round-trip
     costs has found nothing. */
'use strict';

const technicals = require('./stock-technicals');
const F = require('./screener-fields');
const { parse, validate, run, fieldsUsed, QueryError } = require('./screener-query');

const MS_DAY = 86400000;

/** Fields whose value on a past date can be rebuilt from bars alone. */
function pointInTimeFields() {
  const names = new Set();
  for (const f of F.FIELDS) {
    if (f.computed) { names.add(f.name); if (f.alias) f.alias.forEach((a) => names.add(a)); }
  }
  /* Price and the 52-week extremes come from the bar series itself, so they are
     reconstructable even though they are fetched from the vendor today. */
  for (const n of ['Current price', 'Price', 'CMP', 'Close', '52 week high', '52 week low', '52w high', '52w low']) {
    names.add(n);
  }
  return names;
}

const PIT = pointInTimeFields();

/** Refuse a query that names anything not reconstructable. */
function assertPointInTime(ast) {
  const used = [...fieldsUsed(ast)];
  const bad = used.filter((n) => !PIT.has(n));
  if (bad.length) {
    const canon = bad.map((n) => F.canonical(n) || n);
    throw new QueryError(
      `these fields are today's values and cannot be rebuilt for a past date: ${canon.join(', ')}. `
      + 'Using them would be look-ahead bias — the test would report that stocks which are cheap NOW '
      + 'did well THEN. Only fields computed from price bars can be backtested; see docs/091 §4.');
  }
  return used;
}

/* ── replaying one stock ───────────────────────────────────────────────────── */

/** Bars at or before `asOfMs`, as stock-technicals wants them. */
function barsUpTo(bars, asOfMs) {
  const out = [];
  for (const b of bars) {
    if (b[0] > asOfMs) break;                 // stored ascending
    out.push({ date: new Date(b[0]), open: b[1], high: b[2], low: b[3], close: b[4], volume: b[5] });
  }
  return out;
}

/** The screenable row for one stock as it stood on a date.
 *  Returns null when there is not enough history — which is a fact about that
 *  stock on that date, not a failure, and the caller counts it separately. */
function rowAsOf(symbol, bars, asOfMs) {
  const upto = barsUpTo(bars, asOfMs);
  if (upto.length < 30) return null;
  const t = technicals.compute(upto);
  if (!t.ok) return null;

  const row = F.toRow({ symbol, technicals: t });
  const last = upto[upto.length - 1];
  row['Current price'] = last.close;
  for (const a of ['Price', 'CMP', 'Close']) row[a] = last.close;
  /* The 52-week extremes must come from the truncated window too. toRow filled
     them from `quote`, which is today's — leaving those in would put a 2026 high
     into a 2025 screen. */
  row['52 week high'] = t.range ? t.range.high52w : null;
  row['52 week low'] = t.range ? t.range.low52w : null;
  row['52w high'] = row['52 week high'];
  row['52w low'] = row['52 week low'];
  row.asOfBars = upto.length;
  return row;
}

/** Close-to-close return over the next `sessions` trading bars.
 *  null when the future does not exist yet — never 0, which would be a claim
 *  that the position went nowhere. */
function forwardReturn(bars, asOfMs, sessions) {
  let i = -1;
  for (let k = 0; k < bars.length; k++) { if (bars[k][0] <= asOfMs) i = k; else break; }
  if (i < 0) return null;
  const j = i + sessions;
  if (j >= bars.length) return null;
  const from = bars[i][4];
  const to = bars[j][4];
  if (!(from > 0)) return null;
  return { pct: ((to - from) / from) * 100, fromDate: bars[i][0], toDate: bars[j][0] };
}

/* ── the backtest ──────────────────────────────────────────────────────────── */

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * @param queryText  the screen
 * @param universe   [{ symbol, bars }] — bars ascending [ms,o,h,l,c,v]
 * @param asOfDates  ISO dates to run the screen on
 * @param sessions   forward horizon in trading bars
 */
function backtest({ queryText, universe, asOfDates, sessions = 20 }) {
  const ast = parse(queryText, F.fieldNames());
  validate(ast, F.typeOf);
  const used = assertPointInTime(ast);

  const perDate = [];
  const allMatched = [];
  const allBench = [];

  for (const d of asOfDates) {
    const asOfMs = Date.parse(`${d}T23:59:59Z`);
    const rows = [];
    let noHistory = 0;

    for (const u of universe) {
      const row = rowAsOf(u.symbol, u.bars, asOfMs);
      if (!row) { noHistory++; continue; }
      row.__bars = u.bars;
      rows.push(row);
    }

    const r = run(ast, rows);

    const fwd = (list) => list
      .map((x) => forwardReturn(x.__bars, asOfMs, sessions))
      .filter(Boolean)
      .map((x) => x.pct);

    const matchedR = fwd(r.matched);
    /* The benchmark is EVERY stock that could be screened on that date, not the
       rejected ones. Comparing matched against rejected answers "was the filter
       better than its own inverse", which flatters any filter that happens to
       exclude the worst names — a different and much easier question. */
    const benchR = fwd(rows);

    allMatched.push(...matchedR);
    allBench.push(...benchR);

    perDate.push({
      asOf: d,
      screened: rows.length,
      noHistory,
      matched: r.counts.matched,
      unevaluable: r.counts.unevaluable,
      withForward: matchedR.length,
      meanPct: matchedR.length ? +mean(matchedR).toFixed(2) : null,
      medianPct: matchedR.length ? +median(matchedR).toFixed(2) : null,
      winRate: matchedR.length ? +((matchedR.filter((x) => x > 0).length / matchedR.length) * 100).toFixed(1) : null,
      benchMeanPct: benchR.length ? +mean(benchR).toFixed(2) : null,
      edgePct: (matchedR.length && benchR.length) ? +(mean(matchedR) - mean(benchR)).toFixed(2) : null,
    });
  }

  const dated = perDate.filter((p) => p.withForward > 0);

  return {
    query: queryText,
    fieldsUsed: used,
    sessions,
    dates: perDate,
    /* An aggregate over ZERO observations is null, not 0. A backtest that reports
       0% edge on no data is indistinguishable from one that measured no edge. */
    aggregate: allMatched.length ? {
      observations: allMatched.length,
      datesWithForward: dated.length,
      meanPct: +mean(allMatched).toFixed(2),
      medianPct: +median(allMatched).toFixed(2),
      winRatePct: +((allMatched.filter((x) => x > 0).length / allMatched.length) * 100).toFixed(1),
      benchMeanPct: allBench.length ? +mean(allBench).toFixed(2) : null,
      edgePct: allBench.length ? +(mean(allMatched) - mean(allBench)).toFixed(2) : null,
    } : null,
    limitations: [
      'SURVIVORSHIP: the universe is today\'s F&O list. Names that left the segment, delisted or were acquired are absent, and their absence correlates with having done badly. Published work on Indian small-caps puts this at roughly 23% of reported return.',
      'GROSS: brokerage, STT, slippage and impact are not modelled. An edge smaller than round-trip cost is not an edge.',
      'SHORT HISTORY: bars go back about 400 calendar days, so the number of independent as-of dates is small and the aggregate is not a statistically strong claim.',
      'NO REGIME SPLIT: results are pooled across whatever market conditions the window contained.',
    ],
  };
}

/** Monthly as-of dates that the data can actually support.
 *
 *  Derived from the bars themselves rather than from a calendar: the window
 *  starts once there is enough history for the longest indicator (200 sessions)
 *  and stops early enough that a forward window still exists. A date list that
 *  runs past the data produces dates with no observations, and a caller reading
 *  "11 dates" would be counting dates that measured nothing.
 */
/* minHistory defaults to 60, not 200.
   Assuming the longest indicator would cut the usable window from ten dates to
   four, and it is the wrong place to make that decision: a screen that needs
   SMA 200 already reports the early dates as UNEVALUABLE, visibly, per stock.
   Choosing here would hide those dates instead of showing that they could not
   be answered — which is the same merge of "no result" with "no data" that this
   whole module exists to avoid. */
function monthlyDates(universe, sessions = 20, { minHistory = 60 } = {}) {
  const lengths = universe.map((u) => u.bars.length).sort((a, b) => a - b);
  if (!lengths.length) return [];
  const typical = lengths[Math.floor(lengths.length / 2)];
  if (typical < minHistory + sessions + 20) return [];

  const sample = universe.find((u) => u.bars.length === typical) || universe[0];
  const bars = sample.bars;
  const firstIdx = minHistory;
  const lastIdx = bars.length - sessions - 1;
  if (lastIdx <= firstIdx) return [];

  const out = [];
  let seenMonth = null;
  for (let i = firstIdx; i <= lastIdx; i++) {
    const d = new Date(bars[i][0]);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    if (key === seenMonth) continue;
    seenMonth = key;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

module.exports = {
  backtest, rowAsOf, forwardReturn, barsUpTo, assertPointInTime, pointInTimeFields, monthlyDates,
};
