/**
 * STOCK ANALYST — 6th AI agent: ask about ANY stock, get live clear details.
 *
 * Fuses three live sources into ONE verdict with disclosed parameters:
 *   1. MARKET  — live quote via yahoo-finance2 (price, day move, 52w band,
 *                50d/200d averages → momentum score)
 *   2. NEWS    — the news-engine feed filtered to this stock (sentiment,
 *                weighted by impact × recency)
 *   3. DEALS   — deal-class events hitting this stock (agents-engine impact
 *                uncalibrated impact strength with parameters)
 *
 * Output: direction UP/DOWN/NEUTRAL + strength (5–90%) + every parameter
 * that produced it. HONEST: a disclosed-parameter heuristic, not a calibrated
 * probability or recommendation.
 *
 * Pure math is separated (momentumScore / aggregateNewsSentiment / fuseVerdict)
 * so it unit-tests without network. Only analyze() touches yahoo (injected).
 */
'use strict';
const { STOCKS } = require('./news-engine');
const { detectDealEvents, computeImpact } = require('./agents-engine');
const technicals = require('./stock-technicals');
const universe = require('./stock-universe');
const investingPro = require('./investing-pro');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, d = 2) => +(+v).toFixed(d);

/* Resolve a user query to a symbol.

   Two dictionaries, in order:

   1. STOCKS — 49 hand-curated NIFTY names, each with news ALIASES ("reliance
      industries", "mukesh ambani"). Those aliases are what connect a headline to
      a ticker, so this list stays first and stays authoritative for the names it
      covers.

   2. The full listed universe — 5,798 NSE and BSE symbols from the broker's
      instrument master. Before this, anything outside those 49 fell through to a
      vendor search that does not work for Indian equities, which is why typing
      "consumer" answered "could not resolve to a listed stock".

   The universe path returns no aliases and no sector, and that is correct: it
   knows the symbol exists and nothing more. An empty alias list means news
   matching finds nothing for it rather than matching the wrong headlines, which
   is the safer of the two failures. */
function resolveLocal(q) {
  const t = String(q || '').trim().toLowerCase();
  if (!t) return null;
  for (const [sym, sector, aliases] of STOCKS) {
    if (sym.toLowerCase() === t) return { symbol: sym, sector, aliases };
    for (const a of aliases) if (a === t || t.includes(a) || a.includes(t)) return { symbol: sym, sector, aliases };
  }

  // Exact symbol in the full universe — what the autocomplete dropdown sends.
  const exact = universe.bySymbol(t);
  if (exact) return { symbol: exact.symbol, sector: null, aliases: [], name: exact.name, exchange: exact.exchange };

  /* A typed company name, resolved only when the universe is UNAMBIGUOUS about
     it. Taking the top of a 38-result list would silently pick a stock the user
     did not ask for, which is worse than saying nothing — so a single match, or
     a match that is an exact symbol or a clear name prefix, is required. */
  const hits = universe.search(t, 3);
  if (hits.ok && hits.results.length) {
    const top = hits.results[0];
    const unambiguous = hits.total === 1 || top.tier === 0 ||
      (top.tier <= 2 && (hits.results.length === 1 || hits.results[1].tier > top.tier));
    if (unambiguous) return { symbol: top.symbol, sector: null, aliases: [], name: top.name, exchange: top.exchange };
  }
  return null;
}

// ── news for this stock (last N hours), weighted sentiment ────────────────────
function newsForStock(items, symbol, aliases = [], hours = 48) {
  const cut = Date.now() - hours * 3600000;
  const sym = String(symbol).toUpperCase();
  const al = aliases.map(a => a.toLowerCase());
  return (items || []).filter(a => {
    if (!a || a.ts < cut) return false;
    if ((a.stocks || []).includes(sym)) return true;
    const t = (a.title || '').toLowerCase();
    return al.some(x => t.includes(x));
  }).sort((a, b) => b.ts - a.ts);
}

function aggregateNewsSentiment(articles) {
  if (!articles || !articles.length) return { score: 0, label: 'NO NEWS', articles: 0, confidence: 0 };
  let num = 0, wsum = 0;
  for (const a of articles) {
    const rec = (Date.now() - a.ts) / 3600000 <= 6 ? 1 : 0.6;
    const w = ((a.impactScore || 0) / 100 + 0.2) * rec;
    num += (a.sentiment?.score || 0) * w; wsum += w;
  }
  const score = wsum ? Math.round(num / wsum) : 0;
  return {
    score, articles: articles.length,
    label: score >= 12 ? 'BULLISH' : score <= -12 ? 'BEARISH' : 'NEUTRAL',
    confidence: Math.min(90, 40 + articles.length * 8),
  };
}

// ── momentum from the live quote (day move + trend vs 50d/200d) ───────────────
function momentumScore(qt) {
  if (!qt || !(qt.price > 0)) return { score: 0, notes: ['no quote'], available: false };
  const notes = [];
  let s = 0;
  if (isFinite(qt.changePct)) { s += clamp(qt.changePct * 12, -40, 40); notes.push(`day ${qt.changePct >= 0 ? '+' : ''}${round(qt.changePct, 2)}%`); }
  if (qt.avg50 > 0) { const d = (qt.price - qt.avg50) / qt.avg50 * 100; s += clamp(d * 3, -30, 30); notes.push(`${d >= 0 ? '+' : ''}${round(d, 1)}% vs 50d avg`); }
  if (qt.avg200 > 0) { const d = (qt.price - qt.avg200) / qt.avg200 * 100; s += clamp(d * 1.5, -30, 30); notes.push(`${d >= 0 ? '+' : ''}${round(d, 1)}% vs 200d avg`); }
  return { score: Math.round(clamp(s, -100, 100)), notes, available: true };
}

// ── fuse market + news + deals → one verdict with parameters ─────────────────
function fuseVerdict({ momentum, news, dealImpacts }) {
  const dealBias = (dealImpacts || []).reduce((s, d) =>
    s + (d.direction === 'UP' ? 1 : d.direction === 'DOWN' ? -1 : 0) * (d.probability || 0), 0);
  const dealScore = clamp(dealBias / Math.max(1, (dealImpacts || []).length || 1), -100, 100);
  const haveNews = (news?.articles || 0) > 0;
  // weights: market always speaks; news joins when present; deals amplify
  const net = (momentum?.score || 0) * (haveNews ? 0.45 : 0.75)
            + (news?.score || 0) * (haveNews ? 0.35 : 0)
            + dealScore * 0.2;
  const direction = net > 8 ? 'UP' : net < -8 ? 'DOWN' : 'NEUTRAL';
  // probability: legacy field name; value is uncalibrated agreement strength.
  let probability = 50 + Math.abs(net) * 0.42;
  const agree = Math.sign(momentum?.score || 0) !== 0 && haveNews && Math.sign(momentum.score) === Math.sign(news.score);
  if (agree) probability += 6;                       // sources CONFIRM each other
  if (direction === 'NEUTRAL') probability = Math.min(probability, 55);
  probability = Math.round(clamp(probability, 5, 90));
  return {
    direction, probability, strength: probability,
    calibrationStatus: 'uncalibrated',
    recommendationStatus: 'research_only',
    net: round(net, 1),
    params: {
      momentumScore: momentum?.score ?? 0,
      newsScore: news?.score ?? 0, newsArticles: news?.articles ?? 0,
      dealScore: round(dealScore, 1), dealEvents: (dealImpacts || []).length,
      sourcesAgree: !!agree,
    },
    note: agree ? 'market momentum + news CONFIRM each other'
      : haveNews ? 'market and news are mixed — lower conviction'
      : 'verdict from market data only (no recent news)',
  };
}

// ── the on-demand analysis (yahoo client injected; 30s cache per symbol) ─────
const _cache = new Map();
const NOVALIDATE = { validateResult: false };   // yahoo schema drifts; we map fields defensively

async function _searchResolve(yf, q) {
  try {
    const s = await yf.search(q, undefined, NOVALIDATE);
    const hit = (s?.quotes || []).find(x => (x.exchange === 'NSI' || String(x.symbol || '').endsWith('.NS')) && x.quoteType === 'EQUITY')
             || (s?.quotes || []).find(x => x.quoteType === 'EQUITY');
    if (!hit) return null;
    return { yahooSym: hit.symbol, name: hit.shortname || hit.longname || hit.symbol,
      sym: { symbol: String(hit.symbol).replace(/\.(NS|BO)$/, ''), aliases: [String(hit.shortname || '').toLowerCase()] } };
  } catch (_) { return null; }
}

async function _getQuote(yf, yahooSym) {
  try {
    const r = await yf.quote(yahooSym, undefined, NOVALIDATE);
    if (!r || !(Number(r.regularMarketPrice) > 0)) return null;
    return r;
  } catch (_) { return null; }
}

/* Fundamentals for the analyst card: earnings power, returns, the yearly and
 * quarterly profit line, and who holds the stock.
 *
 * EVERY FIELD IS OPTIONAL AND MAY COME BACK null. That is not defensive coding for
 * its own sake — measured on 2026-07-29, Yahoo returns returnOnEquity for TCS
 * (47.7%) and NOTHING for Canara Bank, which is a bank. A card that filled the gap
 * with a zero would report a state-owned lender as earning nothing on its equity.
 *
 * SHAREHOLDING IS NOT THE SEBI PATTERN. Yahoo reports a US-shaped
 * insiders/institutions split. For an Indian issuer "insiders" lands close to the
 * promoter holding — Canara Bank came back 64.4%, against a Government stake around
 * 63% — but it is not the official promoter / FII / DII / public breakdown and the
 * parts do not sum to 100 (64.4 + 18.4 leaves 17% unclassified). It is labelled for
 * what it is, and the remainder is shown rather than hidden.
 */
/* The four modules the analyst card has always needed.
   incomeStatementHistory and balanceSheetHistory are deliberately not asked for:
   the library itself warns they have returned almost nothing since Nov 2024. The
   earnings module carries the same yearly line and does work. */
const BASE_MODULES = ['defaultKeyStatistics', 'financialData', 'earnings', 'summaryDetail'];

/* The rest of what a broker's stock page shows. Asked for only in deep mode —
   the agents pipeline calls analyze() on a timer and does not render any of it,
   so making every tick pay for seven more modules would be a cost with no reader.
   Measured available on 2026-07-29 for all three issuer shapes tested: a 2026
   demerger (TMPV), an IT major (TCS) and a state-owned bank (CANBK). */
const DEEP_MODULES = ['assetProfile', 'calendarEvents', 'recommendationTrend',
  'majorHoldersBreakdown', 'insiderHolders', 'netSharePurchaseActivity', 'earningsTrend'];

async function _getFundamentals(yf, yahooSym, deep = false) {
  if (!yf || !yahooSym) return null;
  let s;
  try {
    s = await yf.quoteSummary(yahooSym, {
      // Still ONE request. Deep mode lengthens the module list; it does not add
      // a second round trip per panel.
      modules: deep ? BASE_MODULES.concat(DEEP_MODULES) : BASE_MODULES,
    }, NOVALIDATE);
  } catch (_) { return null; }
  if (!s) return null;

  const ks = s.defaultKeyStatistics || {}, fd = s.financialData || {},
        er = s.earnings || {}, sd = s.summaryDetail || {};
  const num = v => (v === null || v === undefined || !isFinite(Number(v))) ? null : Number(v);
  const pct = v => { const n = num(v); return n === null ? null : +(n * 100).toFixed(2); };
  /* Some ratios come back as a literal 0 for issuers the source does not compute them
   * for. Measured 2026-07-29: Canara Bank returns grossMargins 0 and ebitdaMargins 0,
   * because a bank does not report a gross profit or an EBITDA the way a manufacturer
   * does. Those are not zeros, they are silences — a company running at a genuine 0%
   * gross margin is not a going concern. For this family of ratios only, zero is read
   * as absent. Margins that CAN legitimately be zero, like a dividend, are left alone. */
  const ratio = v => { const n = pct(v); return (n === null || n === 0) ? null : n; };
  const amt   = v => { const n = num(v); return (n === null || n === 0) ? null : n; };
  const ts    = v => { const d = v && v.raw ? v.raw * 1000 : (v instanceof Date ? v.getTime() : null);
                       return Number.isFinite(d) ? new Date(d).toISOString().slice(0, 10) : null; };

  const eps = num(ks.trailingEps), book = num(ks.bookValue);
  const roeReported = pct(fd.returnOnEquity);
  // A bank with no reported ROE still has an EPS and a book value per share, and
  // their ratio IS return on equity. It is an arithmetic derivation from two
  // reported figures, so it is offered — labelled as derived, never merged with the
  // reported one.
  const roeDerived = (roeReported === null && eps !== null && book > 0)
    ? +((eps / book) * 100).toFixed(2) : null;

  const line = rows => (rows || []).map(r => ({
    period: String(r.date), revenue: num(r.revenue), profit: num(r.earnings),
  })).filter(r => r.revenue !== null || r.profit !== null);

  const insiders = pct(ks.heldPercentInsiders);
  const institutions = pct(ks.heldPercentInstitutions);
  const other = (insiders !== null && institutions !== null)
    ? +(100 - insiders - institutions).toFixed(2) : null;

  return {
    currency: er.financialCurrency || fd.financialCurrency || 'INR',

    valuation: {
      marketCap: num(sd.marketCap), enterpriseValue: num(ks.enterpriseValue),
      peTrailing: num(sd.trailingPE), peForward: num(ks.forwardPE), peg: num(ks.pegRatio),
      priceToBook: num(ks.priceToBook), priceToSales: num(sd.priceToSalesTrailing12Months),
      evToRevenue: num(ks.enterpriseToRevenue), evToEbitda: num(ks.enterpriseToEbitda),
    },
    perShare: {
      eps, epsForward: num(ks.forwardEps), bookValue: book,
      revenuePerShare: num(fd.revenuePerShare), cashPerShare: num(fd.totalCashPerShare),
    },
    returns: {
      roe: roeReported, roeDerived,
      roa: pct(fd.returnOnAssets),
      profitMargin: pct(fd.profitMargins), operatingMargin: pct(fd.operatingMargins),
      // ratio(), not pct(): a bank reports these as 0 because the source does not
      // compute them, and 0% is not a fact about the business.
      grossMargin: ratio(fd.grossMargins), ebitdaMargin: ratio(fd.ebitdaMargins),
    },
    growth: {
      revenue: pct(fd.revenueGrowth),
      // financialData.earningsGrowth and defaultKeyStatistics.earningsQuarterlyGrowth
      // are the same measurement under two names — both came back 0.622 for Canara
      // Bank. Showing it twice under different labels would imply two independent
      // readings agreeing, which is the opposite of what it is.
      earnings: pct(fd.earningsGrowth) ?? pct(ks.earningsQuarterlyGrowth),
      change52w: pct(ks['52WeekChange']), changeIndex52w: pct(ks.SandP52WeekChange),
    },
    balance: {
      totalRevenue: num(fd.totalRevenue),
      // For a lender the source sets gross profit equal to total revenue, because
      // there is no cost of goods to subtract. Echoing revenue back under a second
      // heading tells the reader nothing, so it is dropped when the two match.
      grossProfit: (num(fd.grossProfits) !== null && num(fd.grossProfits) === num(fd.totalRevenue))
        ? null : amt(fd.grossProfits),
      ebitda: amt(fd.ebitda), netIncome: num(ks.netIncomeToCommon),
      totalCash: num(fd.totalCash), totalDebt: num(fd.totalDebt),
      debtToEquity: num(fd.debtToEquity),
      currentRatio: num(fd.currentRatio), quickRatio: num(fd.quickRatio),
      operatingCashflow: num(fd.operatingCashflow), freeCashflow: num(fd.freeCashflow),
    },
    dividend: {
      // The indicated rate, not the trailing one: Canara Bank returned a trailing
      // annual rate of 0 while its last declared dividend was 4.2 a share. Reporting
      // the 0 would have said it pays nothing.
      rate: num(sd.dividendRate), yield: pct(sd.dividendYield),
      payoutRatio: pct(sd.payoutRatio), fiveYearAvgYield: num(sd.fiveYearAvgDividendYield),
      lastValue: num(ks.lastDividendValue), lastDate: ts(ks.lastDividendDate),
      exDate: ts(sd.exDividendDate),
    },
    shares: {
      outstanding: num(ks.sharesOutstanding), float: num(ks.floatShares),
      lastSplitFactor: ks.lastSplitFactor || null,
      lastSplitDate: ks.lastSplitDate ? ts({ raw: ks.lastSplitDate }) : null,
    },
    market: {
      beta: num(sd.beta), volume: num(sd.regularMarketVolume),
      avgVolume: num(sd.averageVolume), avgVolume10d: num(sd.averageDailyVolume10Day),
      allTimeHigh: num(sd.allTimeHigh), allTimeLow: num(sd.allTimeLow),
    },
    /* Analyst targets are OPINION, not a measurement, and are kept in their own block
     * so the card can label them that way. A price target is what a bank's analyst
     * published; it has no more standing here than a headline. */
    analysts: {
      recommendation: fd.recommendationKey || null, mean: num(fd.recommendationMean),
      count: num(fd.numberOfAnalystOpinions),
      targetLow: num(fd.targetLowPrice), targetMean: num(fd.targetMeanPrice),
      targetMedian: num(fd.targetMedianPrice), targetHigh: num(fd.targetHighPrice),
    },

    yearly: line(er.financialsChart?.yearly),
    quarterly: line(er.financialsChart?.quarterly),
    quarterlyEps: (er.earningsChart?.quarterly || [])
      .map(q => ({ period: String(q.date), eps: num(q.actual), estimate: num(q.estimate) }))
      .filter(q => q.eps !== null),
    lastQuarter: ts(ks.mostRecentQuarter), fiscalYearEnd: ts(ks.lastFiscalYearEnd),

    holding: (insiders === null && institutions === null) ? null
      : { insiders, institutions, other,
          note: 'Yahoo insiders/institutions split — not the SEBI promoter/FII/DII pattern' },

    // Present only in deep mode. Undefined rather than null when not asked for,
    // so the card can tell "not requested" from "requested and not reported".
    deep: deep ? _deepPanels(s, num, pct, ts) : undefined,
  };
}

/* The broker-page panels, mapped from the deep modules.

   Each block returns null in full when the source gave nothing, rather than an
   object of nulls: a panel that renders its own headings above six blanks reads
   as "this company has no analysts", which is a claim the data did not make. */
function _deepPanels(s, num, pct, ts) {
  const ap = s.assetProfile || {}, ce = s.calendarEvents || {},
        rt = s.recommendationTrend || {}, mh = s.majorHoldersBreakdown || {},
        ih = s.insiderHolders || {}, ns = s.netSharePurchaseActivity || {},
        et = s.earningsTrend || {};

  const date = (v) => {
    const d = Array.isArray(v) ? v[0] : v;
    if (!d) return null;
    const t = d instanceof Date ? d.getTime() : (d && d.raw ? d.raw * 1000 : Date.parse(d));
    return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
  };
  const txt = (v) => (typeof v === 'string' && v.trim()) ? v.trim() : null;

  const profile = (ap.sector || ap.industry || ap.longBusinessSummary) ? {
    sector: txt(ap.sector), industry: txt(ap.industry),
    employees: num(ap.fullTimeEmployees),
    website: txt(ap.website), phone: txt(ap.phone),
    city: txt(ap.city), state: txt(ap.state), country: txt(ap.country),
    summary: txt(ap.longBusinessSummary),
    // Yahoo's own governance risk scores, 1–10, lower is better. Kept because
    // the broker screens carry a governance block; labelled as the vendor's
    // score, not as a fact about the board.
    governance: (num(ap.auditRisk) !== null || num(ap.boardRisk) !== null) ? {
      audit: num(ap.auditRisk), board: num(ap.boardRisk),
      compensation: num(ap.compensationRisk), shareholderRights: num(ap.shareHolderRightsRisk),
      overall: num(ap.overallRisk),
      note: 'Yahoo governance risk score, 1 (better) to 10 (worse) — the vendor’s ranking, not an audit',
    } : null,
  } : null;

  const e = ce.earnings || {};
  const events = (date(e.earningsDate) || date(ce.exDividendDate) || date(ce.dividendDate)) ? {
    nextEarnings: date(e.earningsDate),
    // The vendor flags an estimated date. A date shown without that flag is read
    // as scheduled, and planning a position around an estimate is a different
    // decision from planning around a confirmed one.
    nextEarningsIsEstimate: e.isEarningsDateEstimate === true,
    lastEarningsCall: date(e.earningsCallDate),
    epsEstimate: num(e.earningsAverage), epsEstimateLow: num(e.earningsLow), epsEstimateHigh: num(e.earningsHigh),
    revenueEstimate: num(e.revenueAverage),
    exDividend: date(ce.exDividendDate), dividendPay: date(ce.dividendDate),
  } : null;

  // Current-month analyst distribution — the buy/hold/sell bar on a broker page.
  const t0 = (rt.trend || []).find(t => t && t.period === '0m') || (rt.trend || [])[0] || null;
  const total = t0 ? ['strongBuy', 'buy', 'hold', 'sell', 'strongSell']
    .reduce((a, k) => a + (num(t0[k]) || 0), 0) : 0;
  const analystTrend = (t0 && total > 0) ? {
    strongBuy: num(t0.strongBuy) || 0, buy: num(t0.buy) || 0, hold: num(t0.hold) || 0,
    sell: num(t0.sell) || 0, strongSell: num(t0.strongSell) || 0, total,
    // History, so a reader can see whether the view is moving rather than only
    // where it stands.
    history: (rt.trend || []).filter(t => t && t.period).map(t => ({
      period: String(t.period), strongBuy: num(t.strongBuy) || 0, buy: num(t.buy) || 0,
      hold: num(t.hold) || 0, sell: num(t.sell) || 0, strongSell: num(t.strongSell) || 0,
    })),
    note: 'Counts of published analyst ratings — opinion, not measurement',
  } : null;

  const holders = (num(mh.insidersPercentHeld) !== null || num(mh.institutionsPercentHeld) !== null) ? {
    insidersPct: pct(mh.insidersPercentHeld), institutionsPct: pct(mh.institutionsPercentHeld),
    institutionsOfFloatPct: pct(mh.institutionsFloatPercentHeld),
    institutionsCount: num(mh.institutionsCount),
    note: 'Vendor’s insiders/institutions split. NOT the SEBI promoter/FII/DII/public pattern, and the parts need not sum to 100.',
  } : null;

  const rows = (ih.holders || []).map(h => ({
    name: txt(h.name), relation: txt(h.relation),
    transaction: txt(h.transactionDescription), date: date(h.latestTransDate),
    shares: num(h.positionDirect) ?? num(h.positionIndirect),
  })).filter(r => r.name);
  // Measured 2026-07-29: TMPV returned 1 row, TCS and CANBK returned 0. An empty
  // list is the normal case for an Indian issuer, so it is reported as "none
  // filed" rather than as an empty table that looks like a loading failure.
  const insiderActivity = {
    rows,
    netSixMonthShares: num(ns.netInfoShares), netSixMonthPct: pct(ns.netPercentInsiderShares),
    boughtShares: num(ns.buyInfoShares), soldShares: num(ns.sellInfoShares),
    reported: rows.length > 0 || num(ns.netInfoShares) !== null,
    note: 'US-style insider filings. Indian issuers rarely populate this; an empty list is not a data failure.',
  };

  const outlook = (et.trend || []).filter(t => t && t.period).map(t => ({
    period: String(t.period), endDate: date(t.endDate),
    epsEstimate: num(t.earningsEstimate?.avg), epsYearAgo: num(t.earningsEstimate?.yearAgoEps),
    epsGrowthPct: pct(t.earningsEstimate?.growth),
    revenueEstimate: num(t.revenueEstimate?.avg), revenueGrowthPct: pct(t.revenueEstimate?.growth),
    analysts: num(t.earningsEstimate?.numberOfAnalysts),
  })).filter(r => r.epsEstimate !== null || r.revenueEstimate !== null);

  return {
    profile, events, analystTrend, holders, insiderActivity,
    earningsOutlook: outlook.length ? outlook : null,
  };
}

/* Daily bars → the technical block. The indicator maths lives in
   stock-technicals.js, which has no network and is tested against worked
   examples; this function only fetches. */
async function _getTechnicals(yf, yahooSym) {
  if (!yf || !yahooSym) return null;
  try {
    // Two years, so a 200-day average exists for anything that has traded that
    // long — and is honestly absent for anything that has not.
    const from = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
    const c = await yf.chart(yahooSym, { period1: from, interval: '1d' }, NOVALIDATE);
    const bars = (c && c.quotes) || [];
    if (!bars.length) return null;
    return technicals.compute(bars);
  } catch (_) { return null; }
}

/* The "similar stocks" strip. Names only — no prices, because pricing five more
   symbols on every open is five more calls for a row the reader skims. */
async function _getPeers(yf, yahooSym) {
  if (!yf || !yahooSym) return null;
  try {
    const r = await yf.recommendationsBySymbol(yahooSym, undefined, NOVALIDATE);
    const list = (r?.recommendedSymbols || [])
      .map(x => ({ symbol: String(x.symbol || '').replace(/\.(NS|BO)$/, ''), yahooSymbol: x.symbol, score: x.score ?? null }))
      .filter(x => x.symbol);
    return list.length ? list : null;
  } catch (_) { return null; }
}

/* Panels a broker shows that a market-data vendor cannot supply.

   This list is part of the response on purpose. The alternative — quietly
   rendering nine panels where the broker shows fifteen — leaves the reader to
   assume the missing six were checked and found empty. Naming them says the
   opposite: they were not available at all, and where they would have to come
   from. Every entry below was tested, not assumed.  */
const NOT_AVAILABLE = [
  { panel: 'Market depth (bid/ask ladder)', why: 'Exchange Level-2 feed — a broker terminal entitlement, not in a market-data vendor’s API' },
  { panel: 'Delivery percentage', why: 'Published by NSE/BSE in end-of-day bhavcopy, not carried by this vendor' },
  { panel: 'Circuit limits (LCL / UCL)', why: 'Exchange band file; not in the quote feed' },
  { panel: 'SEBI shareholding pattern (promoter / FII / DII / public)', why: 'Filed quarterly with the exchanges. The vendor’s insiders/institutions split is a different, US-shaped measure — shown, and labelled as such' },
  { panel: 'Top mutual funds invested', why: 'Vendor returned zero rows for Indian issuers when measured on 2026-07-29' },
  { panel: 'ROCE, EV / capital employed', why: 'Needs capital-employed line items the vendor stopped returning in Nov 2024' },
  { panel: 'Analyst upgrades / downgrades history', why: 'Vendor endpoint fails for Indian issuers' },
];

async function analyze(query, { newsItems, yf, deep = false } = {}) {
  const q = String(query || '').trim();
  if (!q) return { ok: false, error: 'empty query' };

  // 1. resolve: local dictionary first; yahoo search for anything else
  let sym = resolveLocal(q), yahooSym = null, name = null, sector = sym?.sector || null;
  if (sym) { yahooSym = sym.symbol + '.NS'; name = sym.symbol; }
  else if (yf) {
    const s = await _searchResolve(yf, q);
    if (s) { yahooSym = s.yahooSym; name = s.name; sym = s.sym; }
  }
  if (!yahooSym) return { ok: false, error: `could not resolve "${q}" to a listed stock` };

  // The depth is part of the key. Without it a shallow result cached by the
  // agents pipeline would be served to the full view, which would then render
  // every deep panel as "not reported" for the next 30 seconds — a data outage
  // that is really a cache collision.
  const ck = yahooSym + (deep ? '|deep' : '');
  const hit = _cache.get(ck);
  if (hit && Date.now() - hit.at < 30000) return hit.out;

  // 2. live quote — if a dictionary symbol is dead (rename/demerger, e.g.
  //    TATAMOTORS → TMPV on 2026-07-02), re-resolve via yahoo search and retry.
  let quote = null;
  if (yf) {
    let r = await _getQuote(yf, yahooSym);
    if (!r) {
      const s = await _searchResolve(yf, q);
      if (s && s.yahooSym !== yahooSym) {
        yahooSym = s.yahooSym; name = s.name;
        sym = { ...s.sym, aliases: [...(sym?.aliases || []), ...(s.sym.aliases || [])] };
        r = await _getQuote(yf, yahooSym);
      }
    }
    if (!r) return { ok: false, error: `no live quote for "${q}" (${yahooSym}) — symbol may be renamed/delisted` };
    quote = {
      symbol: sym.symbol, yahooSymbol: yahooSym, name: r.shortName || r.longName || name,
      price: Number(r.regularMarketPrice) || 0, changePct: Number(r.regularMarketChangePercent) || 0,
      change: Number(r.regularMarketChange) || 0,
      dayHigh: Number(r.regularMarketDayHigh) || null, dayLow: Number(r.regularMarketDayLow) || null,
      wk52High: Number(r.fiftyTwoWeekHigh) || null, wk52Low: Number(r.fiftyTwoWeekLow) || null,
      avg50: Number(r.fiftyDayAverage) || null, avg200: Number(r.twoHundredDayAverage) || null,
      volume: Number(r.regularMarketVolume) || null, marketCap: Number(r.marketCap) || null,
      pe: Number(r.trailingPE) || null, marketState: r.marketState || null,
    };
  }

  // 3. news + deal events for this stock
  const arts = newsForStock(newsItems, sym.symbol, sym.aliases || [], 48);
  const news = aggregateNewsSentiment(arts);
  const dealImpacts = detectDealEvents(arts, { maxAgeH: 48 }).slice(0, 6).map(ev => computeImpact(ev));

  // 4. fuse
  const momentum = momentumScore(quote || {});
  const verdict = fuseVerdict({ momentum, news, dealImpacts });

  // Fundamentals are additive context, never an input to the verdict. The verdict is
  // a momentum-and-news heuristic with disclosed parameters; quietly folding a P/B or
  // an ROE into it would change what the number means without changing what it says.
  const fundamentals = await _getFundamentals(yf, yahooSym, deep);

  /* Deep mode only. Run together rather than in sequence — they are independent
     calls to the same host and awaiting them one after the other doubles the
     time the page waits for no benefit. allSettled, not all: a peers lookup that
     fails must not take the technicals down with it. Each already returns null
     on its own failure, so a rejection here is the unexpected case. */
  let technicalsOut = null, peers = null, investingProOut = null;
  if (deep) {
    const [t, p, ip] = await Promise.allSettled([_getTechnicals(yf, yahooSym), _getPeers(yf, yahooSym), Promise.resolve(investingPro.forSymbol(sym.symbol))]);
    technicalsOut = t.status === 'fulfilled' ? t.value : null;
    peers = p.status === 'fulfilled' ? p.value : null;
    investingProOut = ip.status === 'fulfilled' ? ip.value : { ok: false, reason: ip.reason?.message || 'Investing.com ProPicks lookup failed' };
  }

  const out = {
    ok: true, query: q, symbol: sym.symbol, sector, quote, fundamentals, momentum, news,
    // Deep panels are absent, not null, on the fast path — "not asked for" and
    // "asked for and unavailable" are different states and the page shows them
    // differently.
    ...(deep ? { technicals: technicalsOut, peers, investingPro: investingProOut, notAvailable: NOT_AVAILABLE, depth: 'full' } : { depth: 'card' }),
    headlines: arts.slice(0, 6).map(a => ({ title: a.title, at: a.publishedAt, source: a.sourceName || a.source,
      sentiment: a.sentiment?.label, score: a.sentiment?.score, url: a.url })),
    dealImpacts: dealImpacts.map(d => ({ title: d.title, type: d.eventType, direction: d.direction, probability: d.probability, params: d.params })),
    verdict,
    generatedAt: new Date().toISOString(),
    disclaimer: 'Live heuristic from market data + news — parameters disclosed. Not investment advice.',
  };
  _cache.set(ck, { at: Date.now(), out });
  return out;
}

module.exports = { analyze, resolveLocal, newsForStock, aggregateNewsSentiment, momentumScore,
  fuseVerdict, BASE_MODULES, DEEP_MODULES, NOT_AVAILABLE };
