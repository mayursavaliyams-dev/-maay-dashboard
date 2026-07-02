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

  const out = {
    ok: true, query: q, symbol: sym.symbol, sector, quote, momentum, news,
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
