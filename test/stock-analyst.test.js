/**
 * Stock Analyst agent — unit tests (no network). Run: node test/stock-analyst.test.js
 */
'use strict';
const assert = require('assert');
const sa = require('../stock-analyst');

let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };

console.log('Stock Analyst agent');

// ── symbol resolution from the local dictionary ──
{
  ok(sa.resolveLocal('RELIANCE').symbol === 'RELIANCE', 'exact symbol resolves');
  ok(sa.resolveLocal('tata motors').symbol === 'TATAMOTORS', 'alias resolves (tata motors)');
  ok(sa.resolveLocal('hdfc bank news today').symbol === 'HDFCBANK', 'query containing alias resolves');
  ok(sa.resolveLocal('zomato').symbol === 'ZOMATO', 'new-age stock resolves');
  ok(sa.resolveLocal('xyzunknown123') === null, 'unknown query → null (falls back to yahoo search)');
}

// ── news filtering + weighted sentiment ──
{
  const now = Date.now();
  const items = [
    { ts: now - 3600e3, title: 'Reliance wins big order', stocks: ['RELIANCE'], sentiment: { score: 50, label: 'BULLISH' }, impactScore: 70 },
    { ts: now - 3600e3, title: 'Airtel tariff hike', stocks: ['BHARTIARTL'], sentiment: { score: 30 }, impactScore: 40 },
    { ts: now - 60 * 3600e3, title: 'Reliance old news', stocks: ['RELIANCE'], sentiment: { score: -80 }, impactScore: 90 },
  ];
  const arts = sa.newsForStock(items, 'RELIANCE', ['reliance'], 48);
  ok(arts.length === 1, 'filters to the asked stock, drops stale (>48h)');
  const agg = sa.aggregateNewsSentiment(arts);
  ok(agg.score > 0 && agg.label === 'BULLISH' && agg.articles === 1, 'weighted sentiment aggregated');
  ok(sa.aggregateNewsSentiment([]).label === 'NO NEWS', 'no articles → NO NEWS, score 0');
}

// ── momentum from the quote ──
{
  const up = sa.momentumScore({ price: 110, changePct: 2, avg50: 100, avg200: 90 });
  ok(up.score > 30, 'up day + above both averages → strong positive momentum');
  const dn = sa.momentumScore({ price: 85, changePct: -2.5, avg50: 100, avg200: 110 });
  ok(dn.score < -30, 'down day + below averages → strong negative momentum');
  ok(sa.momentumScore(null).available === false, 'no quote → unavailable, score 0');
}

// ── verdict fusion ──
{
  const bull = sa.fuseVerdict({ momentum: { score: 60 }, news: { score: 40, articles: 3 }, dealImpacts: [{ direction: 'UP', probability: 70 }] });
  ok(bull.direction === 'UP' && bull.probability > 60, `all sources bullish → UP high prob (${bull.probability}%)`);
  ok(bull.strength === bull.probability && bull.calibrationStatus === 'uncalibrated' && bull.recommendationStatus === 'research_only',
    'verdict exposes legacy probability as uncalibrated research strength');
  ok(bull.params.sourcesAgree === true, 'agreement flagged in parameters');
  const bear = sa.fuseVerdict({ momentum: { score: -55 }, news: { score: -30, articles: 2 }, dealImpacts: [] });
  ok(bear.direction === 'DOWN' && bear.probability > 55, 'bearish agreement → DOWN');
  const mixed = sa.fuseVerdict({ momentum: { score: 40 }, news: { score: -35, articles: 2 }, dealImpacts: [] });
  ok(mixed.probability < bull.probability, 'conflicting sources → lower conviction than agreement');
  const quiet = sa.fuseVerdict({ momentum: { score: 3 }, news: { score: 0, articles: 0 }, dealImpacts: [] });
  ok(quiet.direction === 'NEUTRAL' && quiet.probability <= 55, 'no signal → NEUTRAL, probability capped');
  ok(/market data only/.test(quiet.note), 'no-news case honestly labelled');
  const noNews = sa.fuseVerdict({ momentum: { score: 70 }, news: { score: 0, articles: 0 }, dealImpacts: [] });
  ok(noNews.direction === 'UP' && noNews.params.newsArticles === 0, 'market-only verdict still works (momentum weight boosted)');
}

// ── analyze guards (no yahoo client) ──
{
  sa.analyze('', {}).then(r => { ok(r.ok === false, 'empty query rejected'); });
  sa.analyze('xyzunknown123', {}).then(r => { ok(r.ok === false && /resolve/.test(r.error), 'unresolvable without yahoo → clear error'); });
}

setTimeout(() => console.log(`\n${pass} assertions passed`), 50);
