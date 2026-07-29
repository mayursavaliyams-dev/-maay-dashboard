'use strict';
/**
 * warehouse-api.js — standalone READ-ONLY HTTP surface over the derived warehouse.
 *
 * WHY: the dashboard's "full High/Low record" modal reads the LIVE server (port 3000),
 * which only knows TODAY. Past-day records now exist in the warehouse
 * (warehouse-derive.js → data/warehouse/L2_strike/history/<date>.json) but the main
 * server may NOT be modified to serve them (server.js is protected). So this tiny,
 * separate process exposes them on its own port. The dashboard fetches past days here;
 * today still comes from the live server. No existing module is touched.
 *
 * Read-only + loopback-bound: it serves historical option records only, never writes,
 * and binds 127.0.0.1 (the main server is unauthenticated on 0.0.0.0 — do not widen
 * that surface). CORS is opened for the local dashboard origin.
 *
 * @test:characterization @test:unit @test:integration @test:regression
 * @test:failure @test:performance @test:memory-leak @test:rollback
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const { OUT_DIR } = require('./warehouse-derive.js');   // data/warehouse/L2_strike/history

const PORT = parseInt(process.env.WAREHOUSE_API_PORT || '3100', 10);
const DATE_RE = /^(\d{4}-\d{2}-\d{2})\.json$/;

/** Available archived days, newest first. */
function listDays() {
  try {
    return fs.readdirSync(OUT_DIR).map(f => (DATE_RE.exec(f) || [])[1]).filter(Boolean).sort().reverse();
  } catch (_) { return []; }
}

/** Map a derived strike record into the modal's leg shape (unknowns stay null, never 0). */
function _leg(s) {
  if (!s) return null;
  return {
    ltp: null, high: s.high ? s.high.price : null, low: s.low ? s.low.price : null,
    opening: s.opening ?? null, closing: s.closing ?? null,
    highHistory: s.highRecord || [], lowHistory: s.lowRecord || [], greeks: null,
  };
}

/** The archived CE+PE record for one strike on one day. */
function getRecord(date, inst, strike, type) {
  void type;                                              // both legs returned regardless
  // Validated read: a torn archive file recovers from its .bak rather than being
  // reported to the dashboard as "no archive for that day", which would look like
  // an absence of history instead of a damaged file.
  let doc;
  try {
    doc = require('./safe-write.js').readJsonSync(path.join(OUT_DIR, `${date}.json`), { fallback: null });
  } catch (e) {
    return { found: false, date, inst, strike, reason: `archive unreadable: ${e.message}` };
  }
  if (!doc) return { found: false, date, inst, strike, reason: 'no archive for that day' };
  const strikes = doc.strikes || {};
  const ceKey = `${inst}|${strike}|CE`, peKey = `${inst}|${strike}|PE`;
  const ce = _leg(strikes[ceKey]), pe = _leg(strikes[peKey]);
  return {
    found: !!(ce || pe), date, inst, strike,
    spot: null, dte: null, isATM: false,
    marketStatus: `ARCHIVE · ${date} · minute-resolution`,
    source: doc.source || null, engine: doc.engine || null,
    ce, pe,
  };
}

/**
 * Every strike's best BUY LOW → SELL HIGH for a day, ranked.
 * `min` is a tradeable-premium floor: a +200% move on a ₹0.15 option is ₹0.30 a
 * share and nothing per lot, and ranking by percentage alone puts that junk on top.
 * Both the percentage and the rupees-per-lot are returned so neither can flatter.
 */
function getCapture(date, opts = {}) {
  let doc;
  try { doc = require('./safe-write.js').readJsonSync(path.join(OUT_DIR, `${date}.json`), { fallback: null }); }
  catch (e) { return { found: false, date, reason: `archive unreadable: ${e.message}` }; }
  if (!doc) return { found: false, date, reason: 'no archive for that day' };

  const min = Number(opts.min);
  const floor = Number.isFinite(min) && min >= 0 ? min : 10;
  const inst = opts.inst ? String(opts.inst).toUpperCase() : null;

  const rows = [];
  let skippedBelowFloor = 0, noCapture = 0;
  for (const [key, s] of Object.entries(doc.strikes || {})) {
    const [i, strike, type] = key.split('|');
    if (inst && i !== inst) continue;
    if (!s || !s.capture) { noCapture++; continue; }
    if (s.capture.buy < floor) { skippedBelowFloor++; continue; }
    rows.push({
      inst: i, strike: Number(strike), type,
      buy: s.capture.buy, buyTime: s.capture.buyTime,
      sell: s.capture.sell, sellTime: s.capture.sellTime,
      gainPct: s.capture.gainPct,
      points: +(s.capture.sell - s.capture.buy).toFixed(2),
      opening: s.opening ?? null, closing: s.closing ?? null,
      high: s.high ? s.high.price : null, low: s.low ? s.low.price : null,
      bars: s.bars ?? null,
    });
  }
  rows.sort((a, b) => b.gainPct - a.gainPct);
  return {
    found: true, date, inst, floor,
    // When the rows were DERIVED, not when they were fetched. A page that polls this
    // endpoint can otherwise only report the age of its own request, which reads as
    // "just now" while showing rows that are a quarter of an hour old — the capture
    // loop, the mirror and derive each add their own lag.
    derivedAt: doc.derivedAt || null,
    engine: doc.engine || null, source: doc.source || null,
    counts: { returned: rows.length, skippedBelowFloor, noForwardGain: noCapture,
              totalStrikes: Object.keys(doc.strikes || {}).length },
    rows,
  };
}

/** Pure router — returns {status, json}. Unit-testable without a socket. */
function route(pathname, query) {
  if (pathname === '/wh/days')  return { status: 200, json: { days: listDays() } };
  if (pathname === '/wh/capture') {
    const q = query || {};
    const date = q.date || listDays()[0];
    if (!date) return { status: 200, json: { found: false, reason: 'no archived days yet' } };
    return { status: 200, json: getCapture(String(date), { inst: q.inst, min: q.min }) };
  }
  if (pathname === '/wh/health') return { status: 200, json: { ok: true, days: listDays().length, dir: OUT_DIR } };
  if (pathname === '/wh/hl-record') {
    const { date, inst, strike, type } = query || {};
    if (!date || !inst || !strike) return { status: 400, json: { error: 'date, inst, strike required' } };
    return { status: 200, json: getRecord(String(date), String(inst).toUpperCase(), String(strike), String(type || 'CE').toUpperCase()) };
  }
  return { status: 404, json: { error: 'not found' } };
}

const CORS = {
  'Access-Control-Allow-Origin': '*',                     // read-only historical data, loopback-bound
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json',
};

function createServer() {
  return http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    if (req.method !== 'GET')     { res.writeHead(405, CORS); return res.end(JSON.stringify({ error: 'read-only' })); }
    const parsed = url.parse(req.url, true);
    let out;
    try { out = route(parsed.pathname, parsed.query); }
    catch (e) { out = { status: 500, json: { error: e.message } }; }
    res.writeHead(out.status, CORS);
    res.end(JSON.stringify(out.json));
  });
}

module.exports = { listDays, getRecord, getCapture, route, createServer, _leg, OUT_DIR, PORT };

// ── CLI: start the read-only server on loopback ──
if (require.main === module) {
  createServer().listen(PORT, '127.0.0.1', () => {
    console.log(`[warehouse-api] read-only archive on http://127.0.0.1:${PORT}  (days: ${listDays().length})`);
  });
}
