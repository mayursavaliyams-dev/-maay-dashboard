'use strict';

const fs = require('fs');
const path = require('path');
const universe = require('./stock-universe');

const FILE = path.join(__dirname, 'data', 'investing-propicks.json');
const SOURCE_LINKS = {
  indiaShares: 'https://in.investing.com/equities/india',
  propicks: 'https://in.investing.com/pro/watchlist/w-78178381.iwl/v-68f5a6e5',
};

function norm(symbol) {
  return String(symbol || '').trim().toUpperCase().replace(/\.(NS|BO)$/, '');
}

function num(v) {
  return v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
}

function date(v) {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

function indianStock(symbol) {
  const key = norm(symbol);
  const hit = universe.bySymbol(key);
  return hit ? { ok: true, ...hit } : { ok: false, symbol: key, reason: `${key || 'symbol'} is not in the Indian NSE/BSE stock universe` };
}

function load() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const data = JSON.parse(raw);
    const stocks = data && data.stocks && typeof data.stocks === 'object' ? data.stocks : {};
    return {
      ok: true,
      updatedAt: date(data.updatedAt),
      source: data.source || 'Investing.com India / InvestingPro export',
      sourceLinks: { ...SOURCE_LINKS, ...(data.sourceLinks || {}) },
      market: data.market || 'India',
      stocks,
    };
  } catch (e) {
    return {
      ok: false,
      reason: e.code === 'ENOENT'
        ? 'Investing.com ProPicks export not loaded — create data/investing-propicks.json from a verified account export'
        : 'Investing.com ProPicks export unreadable: ' + e.message,
      updatedAt: null,
      source: 'Investing.com India / InvestingPro export',
      sourceLinks: SOURCE_LINKS,
      market: 'India',
      stocks: {},
    };
  }
}

function cleanRow(row, fallbackUpdatedAt) {
  const r = row || {};
  const pr = r.priceRange || {};
  const fv = r.fairValue || {};
  return {
    source: r.source || 'Investing.com / InvestingPro',
    sourceUrl: r.sourceUrl || SOURCE_LINKS.indiaShares,
    propicksUrl: r.propicksUrl || SOURCE_LINKS.propicks,
    updatedAt: date(r.updatedAt) || fallbackUpdatedAt || null,
    verifiedAt: date(r.verifiedAt) || null,
    priceRange: {
      period: pr.period || '52 weeks',
      low: num(pr.low),
      current: num(pr.current),
      high: num(pr.high),
      updatedAt: date(pr.updatedAt) || date(r.updatedAt) || fallbackUpdatedAt || null,
    },
    fairValue: {
      label: fv.label || null,
      price: num(fv.price),
      upsidePct: num(fv.upsidePct),
      uncertainty: fv.uncertainty || null,
      models: num(fv.models),
      updatedAt: date(fv.updatedAt) || date(r.updatedAt) || fallbackUpdatedAt || null,
    },
    propicks: Array.isArray(r.propicks) ? r.propicks.map(x => ({
      strategy: x.strategy || null,
      action: x.action || null,
      priceWhenAdded: num(x.priceWhenAdded),
      rank: num(x.rank),
      pickedAt: date(x.pickedAt),
      returnPct: num(x.returnPct),
      note: x.note || null,
    })).filter(x => x.strategy || x.action || x.note) : [],
    note: r.note || null,
  };
}

function forSymbol(symbol) {
  const listed = indianStock(symbol);
  if (!listed.ok) return { ok: false, symbol: listed.symbol, reason: listed.reason, source: 'Investing.com India / InvestingPro export', sourceLinks: SOURCE_LINKS, market: 'India' };
  const data = load();
  if (!data.ok) return { ok: false, reason: data.reason, source: data.source, sourceLinks: data.sourceLinks || SOURCE_LINKS, market: data.market, updatedAt: data.updatedAt };
  const key = norm(symbol);
  const row = data.stocks[key] || data.stocks[String(symbol || '').trim()] || null;
  if (!row) {
    return {
      ok: false,
      reason: `no Investing.com ProPicks row for ${key}`,
      source: data.source,
      sourceLinks: data.sourceLinks || SOURCE_LINKS,
      market: data.market,
      updatedAt: data.updatedAt,
    };
  }
  return { ok: true, symbol: key, name: listed.name, exchange: listed.exchange, board: listed.board, market: data.market, sourceLinks: data.sourceLinks || SOURCE_LINKS, ...cleanRow(row, data.updatedAt) };
}

module.exports = { FILE, SOURCE_LINKS, load, forSymbol, norm, indianStock };
