/**
 * STOCK ANALYST — 6th AI agent: ask about ANY stock, get live clear details.
 *
 * Fuses three live sources into ONE verdict with disclosed parameters:
 *   1. MARKET  — live quote via yahoo-finance2 (price, day move, 52w band,
 *                50d/200d averages → momentum score)
 *   2. NEWS    — the news-engine feed filtered to this stock (sentiment,
 *                weighted by impact × recency)
 *   3. DEALS   — deal-class events hitting this stock (agents-engine impact
 *                probability with parameters)
 *
 * Output: direction UP/DOWN/NEUTRAL + probability (5–90%) + every parameter
 * that produced it. HONEST: a disclosed-parameter heuristic, not a promise —
 * "high probability" means the inputs agree, not a guarantee.
 *
 * Pure math is separated (momentumScore / aggregateNewsSentiment / fuseVerdict)
 * so it unit-tests without network. Only analyze() touches yahoo (injected).
 */
'use strict';
const { STOCKS } = require('./news-engine');
const { detectDealEvents, computeImpact } = require('./agents-engine');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, d = 2) => +(+v).toFixed(d);

// ── resolve a user query against the known NIFTY-universe dictionary ─────────
function resolveLocal(q) {
  const t = String(q || '').trim().toLowerCase();
  if (!t) return null;
  for (const [sym, sector, aliases] of STOCKS) {
    if (sym.toLowerCase() === t) return { symbol: sym, sector, aliases };
    for (const a of aliases) if (a === t || t.includes(a) || a.includes(t)) return { symbol: sym, sector, aliases };
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
  // probability: magnitude of agreement, honest 5–90 band
  let probability = 50 + Math.abs(net) * 0.42;
  const agree = Math.sign(momentum?.score || 0) !== 0 && haveNews && Math.sign(momentum.score) === Math.sign(news.score);
  if (agree) probability += 6;                       // sources CONFIRM each other
  if (direction === 'NEUTRAL') probability = Math.min(probability, 55);
  probability = Math.round(clamp(probability, 5, 90));
  return {
    direction, probability, net: round(net, 1),
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
async function _getFundamentals(yf, yahooSym) {
  if (!yf || !yahooSym) return null;
  let s;
  try {
    s = await yf.quoteSummary(yahooSym, {
      // incomeStatementHistory and balanceSheetHistory are deliberately not asked
      // for: the library itself warns they have returned almost nothing since
      // Nov 2024. The earnings module carries the same yearly line and does work.
      modules: ['defaultKeyStatistics', 'financialData', 'earnings', 'summaryDetail'],
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
  };
}

async function analyze(query, { newsItems, yf } = {}) {
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

  const ck = yahooSym;
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
  const fundamentals = await _getFundamentals(yf, yahooSym);

  const out = {
    ok: true, query: q, symbol: sym.symbol, sector, quote, fundamentals, momentum, news,
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

module.exports = { analyze, resolveLocal, newsForStock, aggregateNewsSentiment, momentumScore, fuseVerdict };
