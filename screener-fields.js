/* screener-fields — what a screen query may name, where each number comes from,
   and in what unit.
   Research: docs/090.

   WHY A REGISTRY AND NOT JUST "PASS THE OBJECT THROUGH"
   -----------------------------------------------------
   Measured 2026-08-10, same stock, same moment, two yahoo endpoints:

       quote.dividendYield          = 0.45     (percent)
       summaryDetail.dividendYield  = 0.0045   (fraction)

   A hundredfold apart, same name. A screen written as `Dividend yield > 1` means
   "above 1%" to whoever typed it. Against the first field it returns sensible
   stocks; against the second it returns NOTHING — and an empty result reads as a
   correct answer to a demanding query, not as a bug.

   So: one canonical name per concept, a declared unit, a declared source, and a
   `pick` that names the exact endpoint and property. Two fields differing only in
   unit may never share a name.

   WHAT IS DELIBERATELY ABSENT
   ---------------------------
   ROE, ROCE, Return on assets and Current ratio are among the most-used ratios on
   Screener.in and were measured ABSENT from this data source for RELIANCE.NS.
   They are listed in UNAVAILABLE below with the reason, so a query naming one is
   refused BY NAME — never silently dropped, and never quietly zero. A screener
   that answers a question it cannot answer is worse than one that declines. */
'use strict';

/* Each entry:
     name    what the user types (matched case-insensitively, longest-first)
     unit    the unit the NUMBER is in — the thing that silently differs
     from    which yahoo module supplies it
     pick    (raw) => number|null, naming the exact property
     alias   other spellings that mean the same field
     note    anything a reader would otherwise have to discover by experiment */
const FIELDS = [
  /* ── price and size ── */
  { name: 'Current price', unit: 'INR', from: 'quote', pick: (q) => q.regularMarketPrice,
    alias: ['Price', 'CMP', 'Close'] },
  { name: 'Market Capitalization', unit: 'INR crore', from: 'quote',
    pick: (q) => (q.marketCap == null ? null : q.marketCap / 1e7),
    alias: ['Market cap', 'Mcap'],
    note: 'yahoo returns absolute rupees; divided by 1e7 so the number matches how Indian screens are written — Screener quotes market cap in crore.' },
  { name: 'Enterprise value', unit: 'INR crore', from: 'defaultKeyStatistics',
    pick: (k) => (k.enterpriseValue == null ? null : k.enterpriseValue / 1e7) },

  /* ── valuation ── */
  { name: 'Price to Earning', unit: 'ratio', from: 'quote', pick: (q) => q.trailingPE,
    alias: ['PE', 'P/E', 'Price to earnings'] },
  { name: 'Forward PE', unit: 'ratio', from: 'quote', pick: (q) => q.forwardPE },
  { name: 'Price to book value', unit: 'ratio', from: 'quote', pick: (q) => q.priceToBook,
    alias: ['P/BV', 'PBV', 'Price to book'] },
  { name: 'PEG Ratio', unit: 'ratio', from: 'defaultKeyStatistics', pick: (k) => k.pegRatio,
    alias: ['PEG'] },
  { name: 'Book value', unit: 'INR per share', from: 'quote', pick: (q) => q.bookValue },
  { name: 'EPS', unit: 'INR per share', from: 'quote', pick: (q) => q.epsTrailingTwelveMonths,
    alias: ['Earnings per share'] },

  /* ── the field the units note is about ── */
  { name: 'Dividend yield', unit: 'percent', from: 'quote', pick: (q) => q.dividendYield,
    alias: ['Div yield'],
    note: 'PERCENT, from `quote`. summaryDetail.dividendYield is the SAME concept as a FRACTION and is 100x smaller — it is deliberately not exposed, because two fields differing only in unit must not share a name.' },

  /* ── balance sheet and growth ── */
  { name: 'Debt to equity', unit: 'percent', from: 'financialData', pick: (f) => f.debtToEquity,
    alias: ['D/E'],
    note: 'yahoo reports this as a PERCENTAGE (36.653 = 0.37x). Screener writes the same ratio as 0.37. Declared here as percent so `Debt to equity < 50` means what it looks like; do NOT write `< 0.5` expecting Screener semantics.' },
  { name: 'Total debt', unit: 'INR crore', from: 'financialData',
    pick: (f) => (f.totalDebt == null ? null : f.totalDebt / 1e7) },
  { name: 'Sales', unit: 'INR crore', from: 'financialData',
    pick: (f) => (f.totalRevenue == null ? null : f.totalRevenue / 1e7),
    alias: ['Revenue', 'Total revenue'] },
  { name: 'Sales growth', unit: 'fraction', from: 'financialData', pick: (f) => f.revenueGrowth,
    alias: ['Revenue growth'],
    note: 'FRACTION: 0.297 is 29.7%. Not converted, because yahoo gives no percent form and inventing one would be a second unit for the same concept.' },
  { name: 'Profit growth', unit: 'fraction', from: 'financialData', pick: (f) => f.earningsGrowth,
    alias: ['Earnings growth'] },
  { name: 'Profit margin', unit: 'fraction', from: 'financialData', pick: (f) => f.profitMargins,
    alias: ['Net profit margin'] },
  { name: 'Operating margin', unit: 'fraction', from: 'financialData', pick: (f) => f.operatingMargins,
    alias: ['OPM'] },

  /* ── range and liquidity ── */
  { name: '52 week high', unit: 'INR', from: 'quote', pick: (q) => q.fiftyTwoWeekHigh,
    alias: ['52w high'] },
  { name: '52 week low', unit: 'INR', from: 'quote', pick: (q) => q.fiftyTwoWeekLow,
    alias: ['52w low'] },
  { name: 'Volume', unit: 'shares', from: 'quote', pick: (q) => q.regularMarketVolume },
  { name: 'Average volume', unit: 'shares', from: 'quote', pick: (q) => q.averageDailyVolume3Month,
    alias: ['Avg volume'] },
  { name: 'Beta', unit: 'ratio', from: 'summaryDetail', pick: (s) => s.beta },

  /* ── text fields ──
     `type: 'text'` is load-bearing: screener-query's validate() refuses these in
     arithmetic and in ordering comparisons ONCE, at the query, rather than
     failing per row. A text field ordered with `>` is a mistake in the query and
     must not be reported as 208 stocks with missing data. */
  { name: 'Sector', unit: 'text', type: 'text', from: 'assetProfile', pick: (a) => a.sector,
    note: 'Measured 2026-08-10: RELIANCE.NS → "Energy". Comparison is case-insensitive and trimmed — the vendor writes "Energy", people type "energy", and making those differ would return an empty set that reads as "no such sector".' },
  { name: 'Industry', unit: 'text', type: 'text', from: 'assetProfile', pick: (a) => a.industry,
    note: 'RELIANCE.NS → "Oil & Gas Refining & Marketing".' },

  /* ── technicals, computed by us from bars — NOT from yahoo ──
     These carry `computed: true` so a result can say which numbers came from a
     vendor and which this system derived. The two have different failure modes
     and a reader must be able to tell them apart. */
  /* The paths below were READ from stock-technicals.compute()'s actual output,
     not guessed. It returns nested groups — movingAverages, oscillators, range,
     performance — and a flat `t.rsi14` would have been undefined for every stock,
     which the evaluator would have reported as 208 stocks with missing data
     rather than as a wiring mistake. */
  { name: 'RSI', unit: 'index 0-100', from: 'bars', computed: true,
    pick: (t) => t.oscillators && t.oscillators.rsi14, alias: ['RSI 14'] },
  { name: 'SMA 20', unit: 'INR', from: 'bars', computed: true,
    pick: (t) => t.movingAverages && t.movingAverages.sma20 },
  { name: 'SMA 50', unit: 'INR', from: 'bars', computed: true,
    pick: (t) => t.movingAverages && t.movingAverages.sma50 },
  { name: 'SMA 200', unit: 'INR', from: 'bars', computed: true,
    pick: (t) => t.movingAverages && t.movingAverages.sma200 },
  { name: 'ATR', unit: 'INR', from: 'bars', computed: true,
    pick: (t) => t.range && t.range.atr14 },
  { name: 'ATR percent', unit: 'percent', from: 'bars', computed: true,
    pick: (t) => t.range && t.range.atrPct },
  { name: 'Volatility', unit: 'percent, 30d', from: 'bars', computed: true,
    pick: (t) => t.range && t.range.volatility30d, alias: ['HV', 'Historical volatility'],
    note: 'Realised volatility over 30 sessions. This is the HV half of an IV-HV spread; the IV half needs option data we do not yet record. docs/091 §6.' },
  { name: 'Range position', unit: 'percent of 52w range', from: 'bars', computed: true,
    pick: (t) => t.range && t.range.positionPct,
    note: '0 = at the 52-week low, 100 = at the high. Computed from daily CLOSES in the window, not intraday extremes — stock-technicals says so itself, and the two differ.' },
  { name: 'Change 1d', unit: 'percent', from: 'bars', computed: true,
    pick: (t) => t.performance && t.performance.d1 },
  { name: 'Change 1w', unit: 'percent', from: 'bars', computed: true,
    pick: (t) => t.performance && t.performance.w1 },
  { name: 'Change 1m', unit: 'percent', from: 'bars', computed: true,
    pick: (t) => t.performance && t.performance.m1 },
  { name: 'Change 1y', unit: 'percent', from: 'bars', computed: true,
    pick: (t) => t.performance && t.performance.y1 },
  { name: 'Volume ratio', unit: 'ratio to 20d average', from: 'bars', computed: true,
    pick: (t) => t.volume && t.volume.ratio },
];

/* Named so a query mentioning one is refused BY NAME. Measured absent from this
   data source on 2026-08-10 against RELIANCE.NS. If a source is added later, the
   entry moves up into FIELDS and this list shortens — it must never be silently
   emptied, because "we do not have it" is the useful answer. */
const UNAVAILABLE = {
  'Return on equity': 'financialData.returnOnEquity is absent for Indian tickers on this source',
  'ROE': 'see Return on equity',
  'Return on capital employed': 'not provided by this source; needs EBIT and capital employed from statements we do not fetch',
  'ROCE': 'see Return on capital employed',
  'Return on assets': 'financialData.returnOnAssets is absent for Indian tickers on this source',
  'Current ratio': 'financialData.currentRatio is absent for Indian tickers on this source',
};

/** Every name a query may use, including aliases. */
function fieldNames() {
  const out = [];
  for (const f of FIELDS) { out.push(f.name); if (f.alias) out.push(...f.alias); }
  return out;
}

/** Canonical name for whatever the user typed. */
function canonical(name) {
  const lower = String(name).toLowerCase();
  for (const f of FIELDS) {
    if (f.name.toLowerCase() === lower) return f.name;
    if (f.alias && f.alias.some((a) => a.toLowerCase() === lower)) return f.name;
  }
  return null;
}

function fieldDef(name) {
  const c = canonical(name);
  return c ? FIELDS.find((f) => f.name === c) : null;
}

/** Why a name cannot be used — an explanation, or null if it can. */
function unavailableReason(name) {
  const lower = String(name).toLowerCase();
  for (const [k, why] of Object.entries(UNAVAILABLE)) if (k.toLowerCase() === lower) return why;
  return null;
}

/** Build one screenable row from raw vendor payloads.
 *
 *  Every declared field is set, to `null` when absent. Absent keys and null keys
 *  behave identically in the evaluator, but writing the key means a result can
 *  show WHICH fields were attempted — a row that silently lacks a property looks
 *  the same as a field nobody asked for. */
function toRow({ symbol, quote = {}, financialData = {}, defaultKeyStatistics = {}, summaryDetail = {}, assetProfile = {}, technicals = {} }) {
  const src = { quote, financialData, defaultKeyStatistics, summaryDetail, assetProfile, bars: technicals };
  const row = { symbol };
  for (const f of FIELDS) {
    let v = null;
    try { v = f.pick(src[f.from] || {}); } catch (e) { v = null; }
    if (f.type === 'text') {
      // A text field keeps its string. Coercing it through the numeric branch
      // would turn every sector into null and make the field look unfetched.
      row[f.name] = (typeof v === 'string' && v.trim()) ? v.trim() : null;
    } else {
      row[f.name] = (typeof v === 'number' && Number.isFinite(v)) ? v : null;
    }
    if (f.alias) for (const a of f.alias) row[a] = row[f.name];
  }
  return row;
}

/** The registry, for a UI that has to tell the user what they may type. */
function describe() {
  return {
    available: FIELDS.map((f) => ({
      name: f.name, unit: f.unit, type: f.type || 'number', source: f.from,
      computed: !!f.computed, alias: f.alias || [], note: f.note || null,
    })),
    unavailable: Object.entries(UNAVAILABLE).map(([name, why]) => ({ name, why })),
  };
}

/** (fieldName) => 'number' | 'text' | undefined — for screener-query's validate().
 *  Returns undefined for a name the registry does not know, so validate() stays
 *  silent about fields it cannot judge rather than guessing at their type. */
function typeOf(name) {
  const d = fieldDef(name);
  return d ? (d.type || 'number') : undefined;
}

module.exports = { FIELDS, UNAVAILABLE, fieldNames, canonical, fieldDef, unavailableReason, toRow, describe, typeOf };
