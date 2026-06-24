const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { normalizeDhanAccessToken, getDhanTokenStatus } = require("./dhan-auth");

if (process.env.DHAN_ACCESS_TOKEN) {
  process.env.DHAN_ACCESS_TOKEN = normalizeDhanAccessToken(process.env.DHAN_ACCESS_TOKEN);
}

const { calculateVWAP, detectTrend } = require("./strategy");
const { aiDecision, aiDecisionWithClaude } = require("./ai");
const { claudeTradeNarration, claudeGammaBlast, claudeMeanReversion, claudeAiStatus } = require("./claude-ai");
const aiLogger = require("./ai-logger");
const popSeller   = require("./pop-seller");
const redisStore  = require("./redis-store");
const multiconfirm = require("./multiconfirm");
const pineConverter = require("./pine-converter");
const OptionAnalyzer = require("./option-analyzer");
const SimpleDB = require("./database");
const LiveConnector = require("./live-connector");
const KotakNeoConnector = require("./kotak-neo-connector");
const UpstoxConnector = require("./upstox-connector");
const { getChainAroundATM } = require("./sensibull-fetcher");
const AmiBrokerBridge = require("./amibroker-bridge");
const ExecutionEngine = require("./execution-engine");
const AfternoonEngine = require("./afternoon-engine");
const BounceEngine = require("./bounce-engine");
const StrangleEngine = require("./strangle-engine");
const TelegramAlerter = require("./telegram");

// Initialize Telegram (no-op if TELEGRAM_ENABLED=false or credentials missing)
let telegram = null;
try {
  telegram = new TelegramAlerter();
  if (telegram.enabled && telegram.botToken && telegram.chatId) {
    telegram.connect().then(() => {
      console.log('[telegram] ✓ ready — sending startup ping');
      telegram.sendAlert('🟢 Bot Online', `Mode: ${process.env.TRADE_MODE}\nNIFTY auto: ${process.env.NIFTY_AUTO_ENABLED}\nSENSEX auto: ${process.env.SENSEX_AUTO_ENABLED}`).catch(()=>{});
    }).catch(e => console.warn('[telegram] connect failed:', e.message));
  } else if (telegram.enabled) {
    console.warn('[telegram] TELEGRAM_ENABLED=true but missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID — skipping');
  }
} catch (e) { console.warn('[telegram] init error:', e.message); telegram = null; }

const app = express();
// CORS allow-list from env (comma-separated origins). Empty = allow any.
const _corsAllow = (process.env.CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: _corsAllow.length === 0
    ? true
    : (origin, cb) => {
        // Server-to-server / curl / file:// requests have no Origin header — allow.
        if (!origin) return cb(null, true);
        if (_corsAllow.includes(origin)) return cb(null, true);
        return cb(new Error(`CORS blocked: ${origin}`));
      },
  credentials: false  // file:// cannot send cookies anyway
}));
// Explicit null-origin header for file:// pages
app.use((req, res, next) => {
  if (!req.headers.origin) res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});
app.use(express.json());
app.use(express.static("public", {
  index: "command.html",
  // Never cache HTML dashboards — they change often and stale caches cause
  // "I don't see my update" confusion. Static assets (fonts/images) still cache.
  setHeaders: (res, path) => {
    if (path.endsWith(".html")) {
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }
  }
}));

const PORT = process.env.PORT || 3000;

// ── CONNECTOR SELECTION ──────────────────────────────────────────
// Set LIVE_CONNECTOR=kotak  → use Kotak Neo
// Set LIVE_CONNECTOR=dhan   → use Dhan
// Set LIVE_CONNECTOR=auto   → try Kotak first, fallback to Dhan
const CONNECTOR_MODE = (process.env.LIVE_CONNECTOR || 'auto').toLowerCase();
let live;
if (CONNECTOR_MODE === 'upstox') {
  live = new UpstoxConnector({ accessToken: process.env.UPSTOX_ACCESS_TOKEN });
  console.log('[server] Using Upstox connector');
} else if (CONNECTOR_MODE === 'kotak') {
  live = new KotakNeoConnector();
  console.log('[server] Using Kotak Neo connector');
} else if (CONNECTOR_MODE === 'dhan') {
  live = new LiveConnector({ dhanClientId: process.env.DHAN_CLIENT_ID, dhanAccessToken: process.env.DHAN_ACCESS_TOKEN });
  console.log('[server] Using Dhan connector');
} else {
  // AUTO — prefer Upstox when its token is set (Dhan Data API often unsubscribed).
  const upstoxTok = process.env.UPSTOX_ACCESS_TOKEN;
  const kotakKey = process.env.KOTAK_CONSUMER_KEY;
  if (upstoxTok && upstoxTok.length > 40) {
    live = new UpstoxConnector({ accessToken: upstoxTok });
    console.log('[server] AUTO — Upstox connector selected');
  } else if (kotakKey && kotakKey !== 'your_consumer_key_here') {
    live = new KotakNeoConnector();
    console.log('[server] AUTO — Kotak Neo connector selected');
  } else {
    live = new LiveConnector({ dhanClientId: process.env.DHAN_CLIENT_ID, dhanAccessToken: process.env.DHAN_ACCESS_TOKEN });
    console.log('[server] AUTO — Dhan connector selected (no Upstox/Kotak)');
  }
}

// Human-readable name of the active data source — used in `source:` fields and
// the health label so the UI reflects the real provider (not a hardcoded "dhan").
const DATA_SOURCE = live instanceof UpstoxConnector ? 'upstox'
                  : live instanceof KotakNeoConnector ? 'kotak'
                  : 'dhan';

// Initialize Option Analyzer, Database
const optionAnalyzer = new OptionAnalyzer();
const database = new SimpleDB('./data');
const amiBridge = new AmiBrokerBridge();
const liveConnectPromise = live.connect().catch(err => {
  console.error('[live] connect failed:', err.message);
});

// ==================== STATE — SENSEX ====================
// Auto-start the bot loop on boot. The per-engine `autoEnabled` flag
// (NIFTY_AUTO_ENABLED / SENSEX_AUTO_ENABLED in .env) is the real gate for
// whether a given instrument can place trades — botRunning just controls
// whether the tick loop runs at all. Defaulting false caused every prior
// validation attempt to silently no-op because nobody POSTed /api/bot/start
// after the server boot. Override by setting BOT_AUTOSTART=false in .env.
let botRunning = String(process.env.BOT_AUTOSTART ?? 'true').toLowerCase() !== 'false';
let tradesToday = 0;
let orbHigh = null;
let orbLow = null;
let dayHigh = null;
let dayLow = null;
let vwap = 0;
let prices = [];
let volumes = [];
let currentSignal = "WAIT";
let confidence = 0;
let suggestedStrike = "--";
let targetMultiplier = "--";
let tradeHistory = [];
let todayDate = new Date().toDateString();
let _lastAiResult = { signal: 'WAIT', confidence: 0, reasons: [], warnings: [] };

// ==================== STATE — NIFTY ====================
let niftyTradesToday = 0;
let niftyOrbHigh = null;
let niftyOrbLow = null;
let niftyDayHigh = null;
let niftyDayLow = null;
let niftyVwap = 0;
let niftyPrices = [];
let niftyVolumes = [];
let niftySignal = "WAIT";
let niftyConfidence = 0;
let niftySuggestedStrike = "--";
let niftyTargetMultiplier = "--";
let _niftyLivePrice = 24500;
let _niftyLivePriceAt = 0;
let _lastNiftyAiResult = { signal: 'WAIT', confidence: 0, reasons: [], warnings: [] };
let _bankNiftyLivePrice = 52000;
let _bankNiftyLivePriceAt = 0;

const INSTRUMENT_META = {
  SENSEX: {
    segment: 'BSE_FNO',
    step: 100,
    lotSize: 20,
    label: 'SENSEX',
    priceGetter: () => getLivePrice(),
    chainGetter: (spot) => live.getOptionChain(spot),
  },
  NIFTY: {
    segment: 'NSE_FNO',
    step: 50,
    lotSize: 65,
    label: 'NIFTY',
    priceGetter: () => getLiveNiftyPrice(),
    chainGetter: (spot) => live.getNiftyOptionChain(spot),
  },
  BANKNIFTY: {
    segment: 'NSE_FNO',
    step: 100,
    lotSize: Number(process.env.BANKNIFTY_LOT_SIZE || 30),
    label: 'BANKNIFTY',
    priceGetter: () => getLiveBankNiftyPrice(),
    chainGetter: (spot) => live.getBankNiftyOptionChain(spot),
  }
};

function getInstrumentMeta(inst = 'SENSEX') {
  return INSTRUMENT_META[String(inst || 'SENSEX').toUpperCase()] || INSTRUMENT_META.SENSEX;
}

const IST_OFFSET_MIN = 330;
const MARKET_OPEN_MIN = 9 * 60 + 15;
const MARKET_CLOSE_MIN = 15 * 60 + 30;

function getMarketSession(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60 * 1000);
  const day = ist.getUTCDay();
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const tradingDay = day >= 1 && day <= 5;
  return {
    tradingDay,
    inMarketHours: tradingDay && mins >= MARKET_OPEN_MIN && mins < MARKET_CLOSE_MIN,
    beforeOpen: tradingDay && mins < MARKET_OPEN_MIN,
    afterClose: tradingDay && mins >= MARKET_CLOSE_MIN,
    istHour: ist.getUTCHours(),
    istMinute: ist.getUTCMinutes(),
    istMins: mins,
    status: !tradingDay ? 'MARKET_CLOSED_WEEKEND'
      : mins < MARKET_OPEN_MIN ? 'MARKET_NOT_OPEN'
      : mins >= MARKET_CLOSE_MIN ? 'MARKET_CLOSED'
      : 'MARKET_OPEN'
  };
}

function clearSignalsForClosedMarket(session = getMarketSession()) {
  if (session.inMarketHours) return false;
  currentSignal = "WAIT";
  confidence = 0;
  suggestedStrike = "--";
  targetMultiplier = "--";
  niftySignal = "WAIT";
  niftyConfidence = 0;
  niftySuggestedStrike = "--";
  niftyTargetMultiplier = "--";
  _lastAiResult = { signal: 'WAIT', confidence: 0, reasons: [session.status], warnings: [] };
  _lastNiftyAiResult = { signal: 'WAIT', confidence: 0, reasons: [session.status], warnings: [] };
  return true;
}

function publicSignalFor(instrument, session = getMarketSession()) {
  if (!session.inMarketHours) {
    clearSignalsForClosedMarket(session);
    return { signal: 'WAIT', confidence: 0, suggestedStrike: '--', target: '--' };
  }
  if (instrument === 'NIFTY') {
    return {
      signal: niftySignal,
      confidence: niftyConfidence,
      suggestedStrike: niftySuggestedStrike,
      target: niftyTargetMultiplier
    };
  }
  return { signal: currentSignal, confidence, suggestedStrike, target: targetMultiplier };
}

// ==================== AMIBROKER BRIDGE ====================
amiBridge.registerRoutes(app, {
  getCurrentSignal: () => publicSignalFor('SENSEX').signal,
  getConfidence: () => publicSignalFor('SENSEX').confidence,
  getSuggestedStrike: () => publicSignalFor('SENSEX').suggestedStrike,
  getTargetMultiplier: () => publicSignalFor('SENSEX').target,
  getLastPrice: () => _livePrice,
  getOpenPosition: () => openPosition,
  getTradeMode: () => process.env.TRADE_MODE || 'paper',
  getMarketData: () => ({
    price: _livePrice, orbHigh: orbHigh || 0, orbLow: orbLow || 0,
    vwap: vwap || 0, volume: 0, signal: currentSignal, confidence
  }),
  executeAmiSignal: (signal, opts) => executeAmiSignal(signal, opts),
  exitAmiPosition: (signal, opts) => exitAmiPosition(signal, opts),
  liveConnector: live
});

// ==================== HELPER FUNCTIONS ====================

// Live price cache
let _livePrice = 70000;
let _livePriceAt = 0;
let _yahooPrice = 0;
let _yahooPriceAt = 0;
let _yahooNiftyPrice = 0;
let _yahooNiftyPriceAt = 0;
const QUOTE_TIMEOUT_MS = Number(process.env.QUOTE_TIMEOUT_MS || 2500);

function _withTimeout(promise, ms, label = 'operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function _fetchYahooPrice() {
  if (Date.now() - _yahooPriceAt < 180000 && _yahooPrice > 0) return _yahooPrice;
  try {
    const YahooFinance = require('yahoo-finance2').default;
    const yf = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] });
    const q = await _withTimeout(yf.quote('^BSESN'), QUOTE_TIMEOUT_MS, 'Yahoo SENSEX quote');
    const p = q.regularMarketPrice || q.regularMarketPreviousClose || 0;
    if (p > 10000) { _yahooPrice = p; _yahooPriceAt = Date.now(); }
  } catch (_) { /* use cached */ }
  return _yahooPrice;
}

async function _fetchYahooNiftyPrice() {
  if (Date.now() - _yahooNiftyPriceAt < 180000 && _yahooNiftyPrice > 0) return _yahooNiftyPrice;
  try {
    const YahooFinance = require('yahoo-finance2').default;
    const yf = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] });
    const q = await _withTimeout(yf.quote('^NSEI'), QUOTE_TIMEOUT_MS, 'Yahoo NIFTY quote');
    const p = q.regularMarketPrice || q.regularMarketPreviousClose || 0;
    if (p > 10000) { _yahooNiftyPrice = p; _yahooNiftyPriceAt = Date.now(); }
  } catch (_) { /* use cached */ }
  return _yahooNiftyPrice;
}

// ==================== PER-STRIKE OPTION H/L HISTORY ====================
// Tracks LTP high/low history for each option contract (per inst, strike, CE/PE).
// Each breakthrough appends {t, p} — lets the dashboard show full session history.
const _optHL = { SENSEX: new Map(), NIFTY: new Map(), BANKNIFTY: new Map() };
let _optHLPurgeDate = '';

// High/Low TOUCH alerts — when a CALL/PUT LTP makes a NEW session high or low,
// we log a touch event (newest first). Drives a dashboard "X strike CE touched
// new HIGH/LOW" feed. Per-instrument, capped, purged on new day.
const _hlTouchAlerts = { SENSEX: [], NIFTY: [], BANKNIFTY: [] };
function _pushHlTouch(inst, strike, type, kind, price, prev) {
  const arr = _hlTouchAlerts[inst]; if (!arr) return;
  const now = Date.now();
  arr.unshift({
    inst, strike, type, kind,            // kind: 'HIGH' | 'LOW'
    price: +Number(price).toFixed(2),
    prev:  +Number(prev || 0).toFixed(2),
    movePct: prev ? +(((price - prev) / prev) * 100).toFixed(2) : 0,
    time: _fmtHms(now), at: now
  });
  if (arr.length > 100) arr.length = 100;
}
function _purgeOptHLIfNewDay() {
  const today = _istDateStr();
  if (_optHLPurgeDate === today) return;
  _optHLPurgeDate = today;
  Object.values(_optHL).forEach(m => m.clear());
  Object.keys(_hlTouchAlerts).forEach(k => { _hlTouchAlerts[k] = []; });
}
function _optHLKey(strike, type) { return `${strike}_${type}`; }
function _fmtHms(ms) {
  return ms ? new Date(ms + 5.5*3600*1000).toISOString().slice(11, 19) : null;
}
function _toOptHLHistory(arr) {
  // Use `at` - the exact moment the new extreme was observed - so the timeline
  // shows the real break time (e.g. 12:04:37), not the rounded 1-min bucket start.
  return (arr || []).map(e => ({
    time: _fmtHms(e.at || e.t),
    price: +Number(e.p || 0).toFixed(2),
    ts: e.at || e.t
  }));
}
function _toOptTickHistory(arr) {
  return (arr || []).map(e => ({
    time: _fmtHms(e.at || e.t),
    price: +Number(e.p || 0).toFixed(2),
    ts: e.at || e.t
  }));
}
// Option strike-history uses exact 1-minute buckets so the timeline matches
// chart candles more closely. Keep this separate from the broader spot H/L
// tracker, which still uses 5-minute buckets further below.
const _OPT_BUCKET_MS = 60 * 1000;
const _BUCKET_MS = 5 * 60 * 1000;
function _optBucketId(ms) { return Math.floor((ms + 5.5 * 3600 * 1000) / _OPT_BUCKET_MS); }
function _optBucketStartMs(id) { return id * _OPT_BUCKET_MS - 5.5 * 3600 * 1000; }
function _bucketId(ms) { return Math.floor((ms + 5.5 * 3600 * 1000) / _BUCKET_MS); }
function _bucketStartMs(id) { return id * _BUCKET_MS - 5.5 * 3600 * 1000; }

function _updateOptHL(inst, strike, type, ltp, quoteHigh = 0, quoteLow = 0) {
  // Before 09:15 Dhan may carry the previous session's option OHLC.
  // Today's candle reconciliation handles historical/after-close values.
  if (!getMarketSession().inMarketHours) return;
  const last = Number(ltp || 0);
  // Chain OHLC has no event timestamp and can temporarily contain yesterday's
  // values. LTP gives immediate updates; one-minute candles provide exact H/L.
  if (last <= 0 || !isFinite(last)) return;
  const observedHigh = last;
  const observedLow = last;
  _purgeOptHLIfNewDay();
  const store = _optHL[inst];
  if (!store) return;
  const today = _istDateStr();
  const key = _optHLKey(strike, type);
  const now = Date.now();
  const bid = _optBucketId(now);
  let rec = store.get(key);
  if (!rec || rec.date !== today) {
    rec = { date: today, high: observedHigh, highAt: now, low: observedLow, lowAt: now,
            highPath: [], lowPath: [], tickPath: [] };
    if (last > 0 && isFinite(last)) rec.tickPath.push({ t: now, at: now, p: last });
    store.set(key, rec);
    return;
  }

  const newHigh = observedHigh > rec.high;
  const newLow  = observedLow < rec.low;
  const prevHigh = rec.high, prevLow = rec.low;
  if (newHigh) { rec.high = observedHigh; rec.highAt = now; }
  if (newLow)  { rec.low  = observedLow; rec.lowAt  = now; }
  // Touch alert: this CE/PE just made a NEW session high / low.
  if (newHigh) _pushHlTouch(inst, strike, type, 'HIGH', observedHigh, prevHigh);
  if (newLow)  _pushHlTouch(inst, strike, type, 'LOW',  observedLow,  prevLow);

  // Record every genuine new extreme with exact timestamp — no bucket dedup.
  if (newHigh) {
    rec.highPath.push({ t: now, at: now, p: observedHigh });
    if (rec.highPath.length > 200) rec.highPath.shift();
  }
  if (newLow) {
    rec.lowPath.push({ t: now, at: now, p: observedLow });
    if (rec.lowPath.length > 200) rec.lowPath.shift();
  }
  if (last > 0 && isFinite(last)) {
    const tail = rec.tickPath[rec.tickPath.length - 1];
    if (!tail || Math.abs(Number(tail.p || 0) - last) >= 0.01) {
      rec.tickPath.push({ t: now, at: now, p: last });
      if (rec.tickPath.length > 500) rec.tickPath.shift();
    }
  }
  // Persist option-strike record to Redis on any new extreme (fire-and-forget) so
  // the H/L timeline survives a restart/crash — mirrors the spot-H/L persistence.
  if (newHigh || newLow) redisStore.saveOptHL(inst, strike, type, rec).catch(() => {});
}
function _getOptHL(inst, strike, type) {
  return _optHL[inst]?.get(_optHLKey(strike, type)) || null;
}

// ── DATE-WISE H/L ARCHIVE ────────────────────────────────────────────────────
// Redis holds only "today". This writes each day's full option-H/L map to
// data/opthl/<date>.json so the high/low record is retained PER DATE and
// survives restarts. Saved regularly (every 60s) + keeps the last ~120 days.
const _optHLDir = require('path').join(__dirname, 'data', 'opthl');
function _persistOptHLDay() {
  try {
    const fs2 = require('fs'), path2 = require('path');
    const date = _istDateStr();
    const out = { date, savedAt: new Date().toISOString(), strikes: {} };
    let count = 0;
    for (const inst of Object.keys(_optHL)) {
      const m = _optHL[inst];
      if (!m || !m.size) continue;
      const recs = {};
      for (const [key, rec] of m.entries()) {
        if (!rec || rec.date !== date) continue;
        recs[key] = { high: +Number(rec.high || 0).toFixed(2), highAt: rec.highAt,
                      low: +Number(rec.low || 0).toFixed(2),  lowAt: rec.lowAt };
        count++;
      }
      if (Object.keys(recs).length) out.strikes[inst] = recs;
    }
    if (!count) return false;
    fs2.mkdirSync(_optHLDir, { recursive: true });
    fs2.writeFileSync(path2.join(_optHLDir, `${date}.json`), JSON.stringify(out));
    const files = fs2.readdirSync(_optHLDir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    while (files.length > 120) { try { fs2.unlinkSync(path2.join(_optHLDir, files.shift())); } catch (_) {} }
    return true;
  } catch (_) { return false; }
}
// Regular save — every 60s writes today's records if any exist (captures the
// post-close final state too, since _updateOptHL only mutates during hours).
setInterval(_persistOptHLDay, 60 * 1000);

// Periodically reconcile today's 1-minute option candles into the live record.
// Failed pre-open attempts retry, while successful requests are cached/coalesced.
const OPT_HL_RECONCILE_MS = 60 * 1000;
const OPT_HL_RETRY_MS = 15 * 1000;
const _backfillAttempts = new Map(); // key -> { status, at, promise }
let _backfillPurgeDate = '';
async function _backfillOptHLFromDhan(inst, strike, type, securityId) {
  if (!securityId) return false;
  // Establish today's map before writing candle history. Otherwise the first
  // subsequent live tick would run the new-day purge and erase this backfill.
  _purgeOptHLIfNewDay();
  const today = _istDateStr();
  // Purge stale keys from previous days to prevent Map growth
  if (_backfillPurgeDate !== today) {
    _backfillPurgeDate = today;
    for (const k of _backfillAttempts.keys()) {
      if (!k.endsWith('|' + today)) _backfillAttempts.delete(k);
    }
  }
  const key = `${inst}|${strike}|${type}|${today}`;
  const previous = _backfillAttempts.get(key);
  if (previous?.promise) return previous.promise;
  if (previous?.status === 'done' && Date.now() - previous.at < OPT_HL_RECONCILE_MS) return true;
  if (previous?.status === 'fail' && Date.now() - previous.at < OPT_HL_RETRY_MS) return false;

  const segment = getInstrumentMeta(inst).segment;
  const reconcile = (async () => {
    const session = getMarketSession();
    const istNow = new Date(Date.now() + IST_OFFSET_MIN * 60 * 1000);
    const endTime = session.afterClose
      ? '15:30:00'
      : istNow.toISOString().slice(11, 19);
    const r = await live.client._post('/v2/charts/intraday', {
      securityId: String(securityId),
      exchangeSegment: segment,
      instrument: 'OPTIDX',
      interval: '1',
      oi: false,
      // Dhan's intraday range starts after fromDate, so request one minute
      // earlier to include the 09:15 opening candle.
      fromDate: `${today} 09:14:00`,
      toDate: `${today} ${endTime}`,
    });
    const ts   = r?.timestamp || [];
    const high = r?.high || [];
    const low  = r?.low  || [];
    if (!ts.length) throw new Error(`No intraday candles yet for ${today}`);

    // Build a fresh record from history, then merge with any live record
    // already accumulated since restart.
    const store = _optHL[inst];
    const k2 = _optHLKey(strike, type);
    let rec = store.get(k2);
    if (!rec || rec.date !== today) {
      rec = { date: today, high: 0, highAt: 0, low: Infinity, lowAt: 0, highPath: [], lowPath: [], tickPath: [] };
      store.set(k2, rec);
    }

    // Rebuild paths from history candles — one entry per candle with exact timestamp.
    // Track running session high/low to only record genuine new extremes.
    let runHi = -Infinity, runLo = Infinity;
    const histHiArr = [], histLoArr = [];
    let latestCandleMs = 0;
    for (let i = 0; i < ts.length; i++) {
      const candleMs = Number(ts[i]) * 1000;
      if (!Number.isFinite(candleMs) || !getMarketSession(new Date(candleMs)).inMarketHours) continue;
      latestCandleMs = Math.max(latestCandleMs, candleMs);
      const hi = Number(high[i] || 0);
      const lo = Number(low[i]  || 0);
      if (hi > 0 && hi > runHi) {
        runHi = hi;
        histHiArr.push({ t: candleMs, at: candleMs, p: +hi.toFixed(2) });
      }
      if (lo > 0 && lo < runLo) {
        runLo = lo;
        histLoArr.push({ t: candleMs, at: candleMs, p: +lo.toFixed(2) });
      }
    }
    if (!histHiArr.length || !histLoArr.length) throw new Error(`No market-session candles yet for ${today}`);

    const histHigh = histHiArr.at(-1);
    const histLow = histLoArr.at(-1);
    // The candle series is authoritative through latestCandleMs. Preserve only
    // a newer live LTP extreme that occurred after the latest candle.
    if (Number(rec.highAt || 0) <= latestCandleMs || histHigh.p >= rec.high) {
      rec.high = histHigh.p;
      rec.highAt = histHigh.t;
    }
    if (Number(rec.lowAt || 0) <= latestCandleMs || histLow.p <= rec.low || rec.low === Infinity) {
      rec.low = histLow.p;
      rec.lowAt = histLow.t;
    }

    // Candles are authoritative through their latest minute. Keep only live
    // extrema observed after that point, then continue tracking each poll.
    const mergeExact = (histArr, liveArr) => [
      ...histArr,
      ...liveArr.filter(e => Number(e.t || 0) > latestCandleMs)
    ].sort((a, b) => a.t - b.t).slice(-200);
    rec.highPath = mergeExact(histHiArr, rec.highPath);
    rec.lowPath  = mergeExact(histLoArr, rec.lowPath);
    rec.tickPath = (rec.tickPath || [])
      .filter(e => getMarketSession(new Date(Number(e.t || 0))).inMarketHours)
      .slice(-500);
    if (rec.low === Infinity) rec.low = 0;

    return true;
  })();

  const task = reconcile.then(() => {
    _backfillAttempts.set(key, { status: 'done', at: Date.now(), promise: null });
    return true;
  }).catch(err => {
    _backfillAttempts.set(key, { status: 'fail', at: Date.now(), promise: null });
    console.log(`[${inst} ${strike}${type}] H/L reconcile deferred: ${err.message}`);
    return false;
  });
  _backfillAttempts.set(key, { status: 'pending', at: Date.now(), promise: task });
  return task;
}
function _withLegHistory(inst, strike, leg, type) {
  if (!leg) return null;
  const ltp = Number(leg.ltp || 0);
  _updateOptHL(inst, strike, type, ltp, Number(leg.high || 0), Number(leg.low || 0));
  const hl = _getOptHL(inst, strike, type) || {};
  const sessionHigh = Number(hl.high || 0) || null;
  const sessionLowCandidates = [Number(hl.low || 0)].filter(v => v > 0 && isFinite(v));
  const sessionLow = sessionLowCandidates.length ? Math.min(...sessionLowCandidates) : null;
  const lastTick = hl.tickPath?.at(-1);
  return {
    ...leg,
    high: sessionHigh,
    low: sessionLow,
    highHistory: _toOptHLHistory(hl.highPath),
    lowHistory: _toOptHLHistory(hl.lowPath),
    tickHistory: _toOptTickHistory(hl.tickPath),
    highAt: hl.highAt ? _fmtHms(hl.highAt) : null,
    lowAt: hl.lowAt ? _fmtHms(hl.lowAt) : null,
    lastAt: lastTick ? _fmtHms(lastTick.at || lastTick.t) : null,
    sessionHigh: sessionHigh != null ? +Number(sessionHigh).toFixed(2) : null,
    sessionLow: sessionLow != null ? +Number(sessionLow).toFixed(2) : null
  };
}

// ==================== HIGH/LOW MAPPING RECORD ====================
// Tracks each time the intraday HIGH or LOW is broken, with timestamps.
// Reset on new IST trading day. Path capped at 50 entries per side.
// chainLog: at every new H/L break, async-snapshots the ATM CE+PE premiums
// so user can see the "what would I have paid at this exact moment" context.
const _hlRecord = {
  SENSEX: { date: '', high: 0, highAt: 0, low: 0, lowAt: 0, highPath: [], lowPath: [], chainLog: [] },
  NIFTY:  { date: '', high: 0, highAt: 0, low: 0, lowAt: 0, highPath: [], lowPath: [], chainLog: [] },
  BANKNIFTY: { date: '', high: 0, highAt: 0, low: 0, lowAt: 0, highPath: [], lowPath: [], chainLog: [] }
};
function _istDateStr() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

// Async snapshot — fetches the option chain at the moment of a new H/L break
// and records { ts, price, dir, atmStrike, ce, pe }. Fire-and-forget; logs
// errors but never blocks the price-update pipeline.
//
// Throttle: during fast moves the same inst can print 5+ H/L breaks per
// second — each was triggering a chain fetch and getting Dhan 429-rate-limited.
// Skip if the previous snapshot for this inst was within the cooldown.
const _hlSnapshotCooldownMs = 5000;
const _hlLastSnapshotAt = { SENSEX: 0, NIFTY: 0 };
async function _snapshotChainAtHL(inst, price, dir) {
  const lastAt = _hlLastSnapshotAt[inst] || 0;
  if (Date.now() - lastAt < _hlSnapshotCooldownMs) return;
  _hlLastSnapshotAt[inst] = Date.now();
  try {
    const chain = inst === 'NIFTY'
      ? await live.getNiftyOptionChain(price)
      : await live.getOptionChain(price);
    const strikeInt = inst === 'NIFTY' ? 50 : 100;
    const atm = Math.round(price / strikeInt) * strikeInt;
    const row = chain.strikes?.find(s => Number(s.strike) === Number(atm));
    if (!row) return;
    const entry = {
      t: Date.now(),
      p: +price.toFixed(2),
      dir,                       // 'HIGH' or 'LOW'
      atmStrike: atm,
      ce: row.ce?.ltp || 0,
      pe: row.pe?.ltp || 0,
      ceVol: row.ce?.volume || 0,
      peVol: row.pe?.volume || 0
    };
    _hlRecord[inst].chainLog.push(entry);
    if (_hlRecord[inst].chainLog.length > 100) _hlRecord[inst].chainLog.shift();
    console.log(`[${inst}] H/L-LOG ${dir} @ ${entry.p}  ATM ${atm}  CE ${entry.ce}  PE ${entry.pe}`);
    _detectPattern(inst);
  } catch (err) {
    // Silent — H/L tracking must not break price-update flow
  }
}

// Pattern detector — runs after each new chainLog entry. If the last N entries
// are all the same direction AND within PATTERN_WINDOW_MS AND magnitude meets
// MIN_MOVE_PCT, mark a fresh alert. Tightened on 2026-05-12 after noise burst:
//   • N=5 legs (was 3) — higher conviction
//   • min |move| ≥ 0.1% — filters tick-noise patterns
//   • 60s cooldown between same-direction re-fires
const PATTERN_N = 5;
const PATTERN_WINDOW_MS = 10 * 60 * 1000;
const PATTERN_MIN_MOVE_PCT = 0.1;
const PATTERN_COOLDOWN_MS = 60 * 1000;
function _detectPattern(inst) {
  const rec = _hlRecord[inst];
  if (!rec || (rec.chainLog?.length || 0) < PATTERN_N) return;
  const recent = rec.chainLog.slice(-PATTERN_N);
  const allSameDir = recent.every(e => e.dir === recent[0].dir);
  const windowOK = (recent[recent.length - 1].t - recent[0].t) <= PATTERN_WINDOW_MS;
  if (!allSameDir || !windowOK) {
    if (rec.pattern && Date.now() - rec.pattern.detectedAt > PATTERN_WINDOW_MS) rec.pattern = null;
    return;
  }
  const movePct = ((recent[recent.length - 1].p - recent[0].p) / recent[0].p) * 100;
  if (Math.abs(movePct) < PATTERN_MIN_MOVE_PCT) return; // noise — skip
  const dir = recent[0].dir;
  const patName = dir === 'LOW' ? 'LOWER_LOWS' : 'HIGHER_HIGHS';
  // Cooldown — don't re-fire same direction within 60s
  if (rec.pattern?.direction === dir && (Date.now() - rec.pattern.detectedAt) < PATTERN_COOLDOWN_MS) return;
  rec.pattern = {
    name: patName,
    direction: dir,
    detectedAt: Date.now(),
    legs: recent.map(e => ({ t: e.t, p: e.p, ce: e.ce, pe: e.pe })),
    firstP: recent[0].p,
    lastP: recent[recent.length - 1].p,
    movePct: +movePct.toFixed(3),
    atmStrike: recent[recent.length - 1].atmStrike
  };
  console.log(`🎯 [${inst}] PATTERN: ${patName} — ${PATTERN_N} ${dir}s in ${((recent[recent.length-1].t - recent[0].t)/60000).toFixed(1)}m, move ${rec.pattern.movePct}%`);
}

// ==================== BREAKOUT EVENT LOG ====================
// Records a clean, deduplicated event each time price BREAKS a level:
//   • DAY  — new intraday day-high or day-low set
//   • ORB  — first cross of the 9:15-9:30 opening-range high/low
//   • SWING— breaks the rolling swing high/low of the last N price points
// Each event: { type, dir, level, price, at }. Reset daily. Capped at 80/inst.
const _breakoutLog = {
  SENSEX: { date: '', events: [], orbHiDone: false, orbLoDone: false },
  NIFTY:  { date: '', events: [], orbHiDone: false, orbLoDone: false }
};
const SWING_LOOKBACK = 12;   // price points to define a swing pivot
const SWING_MIN_GAP_MS = 30 * 1000; // don't log same-dir swing within 30s

function _instOrb(inst) {
  return inst === 'NIFTY'
    ? { hi: niftyOrbHigh, lo: niftyOrbLow }
    : { hi: orbHigh, lo: orbLow };
}
function _instPrices(inst) {
  return inst === 'NIFTY' ? niftyPrices : prices;
}

function _pushBreakout(inst, type, dir, level, price) {
  const log = _breakoutLog[inst];
  const now = Date.now();
  // De-dup: skip identical (type,dir,level) already at the tail
  const tail = log.events[log.events.length - 1];
  if (tail && tail.type === type && tail.dir === dir && Math.abs(tail.level - level) < 0.01) return;
  // Swing throttle — avoid spamming same-direction swing breaks
  if (type === 'SWING' && tail && tail.type === 'SWING' && tail.dir === dir && (now - tail.at) < SWING_MIN_GAP_MS) return;
  const ev = {
    type, dir,
    level: +Number(level).toFixed(2),
    price: +Number(price).toFixed(2),
    at: now,
    time: _fmtHms ? _fmtHms(now) : new Date(now).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })
  };
  log.events.push(ev);
  if (log.events.length > 80) log.events.shift();
  console.log(`[${inst}] BREAKOUT ${type} ${dir} level=${ev.level} price=${ev.price} @ ${ev.time}`);
  redisStore.saveBreakouts(inst, log.events).catch(() => {});
}

function _detectBreakouts(inst, price, prevDayHigh, prevDayLow) {
  const log = _breakoutLog[inst];
  const today = _istDateStr();
  if (log.date !== today) {
    log.date = today;
    log.events = [];
    log.orbHiDone = false;
    log.orbLoDone = false;
  }

  // 1) DAY breakout — price made a fresh day extreme (prev passed from caller)
  if (prevDayHigh != null && price > prevDayHigh && prevDayHigh > 0) {
    _pushBreakout(inst, 'DAY', 'HIGH', prevDayHigh, price);
  }
  if (prevDayLow != null && price < prevDayLow && prevDayLow > 0) {
    _pushBreakout(inst, 'DAY', 'LOW', prevDayLow, price);
  }

  // 2) ORB breakout — first cross of opening range, once per side per day
  const orb = _instOrb(inst);
  if (orb.hi && !log.orbHiDone && price > orb.hi) {
    log.orbHiDone = true;
    _pushBreakout(inst, 'ORB', 'HIGH', orb.hi, price);
  }
  if (orb.lo && !log.orbLoDone && price < orb.lo) {
    log.orbLoDone = true;
    _pushBreakout(inst, 'ORB', 'LOW', orb.lo, price);
  }

  // 3) SWING breakout — breaks rolling swing high/low of last N points
  const arr = _instPrices(inst);
  if (arr && arr.length >= SWING_LOOKBACK) {
    const window = arr.slice(-SWING_LOOKBACK - 1, -1); // exclude current tick
    if (window.length) {
      const swingHi = Math.max(...window);
      const swingLo = Math.min(...window);
      if (price > swingHi && swingHi > 0) _pushBreakout(inst, 'SWING', 'HIGH', swingHi, price);
      if (price < swingLo && swingLo > 0) _pushBreakout(inst, 'SWING', 'LOW', swingLo, price);
    }
  }
}

// ==================== REVERSAL DETECTOR ====================
// Detects the exact pattern in the user's charts:
//   1. Price pushes to a fresh local extreme (makes a high or low)
//   2. Then sharply reverses back — a rejection / V-bounce
// Two flavours:
//   • REJECTION — price wicks past a key level (ORB / swing / day extreme)
//     then snaps back the other side within a short window (wick rejection)
//   • BOS (Break-of-Structure) — in a down-leg price prints a higher-high
//     (bullish reversal) or in an up-leg a lower-low (bearish reversal)
// Each event: { kind, dir, pivot, price, movePct, at, time }. Capped 60/inst.
const _reversalLog = {
  SENSEX: { date: '', events: [] },
  NIFTY:  { date: '', events: [] }
};
// Rolling extreme tracker (resets daily) used for rejection detection.
const _revState = {
  SENSEX: { extHi: 0, extHiAt: 0, extLo: Infinity, extLoAt: 0, lastDir: null },
  NIFTY:  { extHi: 0, extHiAt: 0, extLo: Infinity, extLoAt: 0, lastDir: null }
};
const REV_REJECT_PCT   = 0.12;  // min % snap-back from the extreme to call rejection
const REV_WINDOW_MS     = 4 * 60 * 1000; // extreme must be recent (last 4 min)
const REV_COOLDOWN_MS   = 90 * 1000; // don't re-fire same direction within 90s

function _pushReversal(inst, kind, dir, pivot, price, movePct) {
  const log = _reversalLog[inst];
  const now = Date.now();
  const tail = log.events[log.events.length - 1];
  // cooldown on same kind+dir
  if (tail && tail.kind === kind && tail.dir === dir && (now - tail.at) < REV_COOLDOWN_MS) return;
  const ev = {
    kind, dir,
    pivot: +Number(pivot).toFixed(2),
    price: +Number(price).toFixed(2),
    movePct: +Number(movePct).toFixed(2),
    at: now,
    time: _fmtHms(now)
  };
  log.events.push(ev);
  if (log.events.length > 60) log.events.shift();
  console.log(`🔄 [${inst}] REVERSAL ${kind} ${dir} pivot=${ev.pivot} price=${ev.price} move=${ev.movePct}% @ ${ev.time}`);
  redisStore.saveReversals(inst, log.events).catch(() => {});
}

function _detectReversals(inst, price) {
  const log = _reversalLog[inst];
  const st  = _revState[inst];
  const today = _istDateStr();
  if (log.date !== today) {
    log.date = today; log.events = [];
    st.extHi = price; st.extHiAt = Date.now();
    st.extLo = price; st.extLoAt = Date.now();
    st.lastDir = null;
    return;
  }
  const now = Date.now();

  // Track rolling extremes
  if (price > st.extHi) { st.extHi = price; st.extHiAt = now; }
  if (price < st.extLo || st.extLo === Infinity) { st.extLo = price; st.extLoAt = now; }

  // ── BULLISH reversal: recent low, then snap UP ──
  // price has rallied REV_REJECT_PCT above the recent low, low was set recently
  if (st.extLo > 0 && st.extLo !== Infinity && (now - st.extLoAt) <= REV_WINDOW_MS) {
    const upPct = ((price - st.extLo) / st.extLo) * 100;
    if (upPct >= REV_REJECT_PCT) {
      _pushReversal(inst, 'REJECTION', 'BULLISH', st.extLo, price, upPct);
      // reset the low anchor so we don't double-fire; start fresh from here
      st.extLo = price; st.extLoAt = now;
    }
  }

  // ── BEARISH reversal: recent high, then snap DOWN ──
  if (st.extHi > 0 && (now - st.extHiAt) <= REV_WINDOW_MS) {
    const dnPct = ((st.extHi - price) / st.extHi) * 100;
    if (dnPct >= REV_REJECT_PCT) {
      _pushReversal(inst, 'REJECTION', 'BEARISH', st.extHi, price, dnPct);
      st.extHi = price; st.extHiAt = now;
    }
  }

  // ── BOS via swing structure ──
  const arr = _instPrices(inst);
  if (arr && arr.length >= SWING_LOOKBACK) {
    const window = arr.slice(-SWING_LOOKBACK - 1, -1);
    if (window.length) {
      const swingHi = Math.max(...window);
      const swingLo = Math.min(...window);
      const mid = (swingHi + swingLo) / 2;
      // Bullish BOS: was below mid (down-leg) and now breaks swing high
      if (st.lastDir === 'DOWN' && price > swingHi && swingHi > 0) {
        _pushReversal(inst, 'BOS', 'BULLISH', swingHi, price, ((price - swingHi) / swingHi) * 100);
        st.lastDir = 'UP';
      }
      // Bearish BOS: was above mid (up-leg) and now breaks swing low
      if (st.lastDir === 'UP' && price < swingLo && swingLo > 0) {
        _pushReversal(inst, 'BOS', 'BEARISH', swingLo, price, ((swingLo - price) / swingLo) * 100);
        st.lastDir = 'DOWN';
      }
      // update leg bias
      if (price > mid) st.lastDir = st.lastDir || 'UP';
      else if (price < mid) st.lastDir = st.lastDir || 'DOWN';
      // refine bias by position
      if (price >= swingHi) st.lastDir = 'UP';
      else if (price <= swingLo) st.lastDir = 'DOWN';
    }
  }
}

function _updateHL(inst, price) {
  if (!price || price < 1) return;
  const rec = _hlRecord[inst];
  if (!rec) return;
  // Capture previous day extremes BEFORE this tick updates them, so the
  // breakout detector compares against the level that was just broken.
  const _prevDayHigh = rec.date === _istDateStr() ? rec.high : null;
  const _prevDayLow  = rec.date === _istDateStr() ? rec.low  : null;
  if (_breakoutLog[inst] && _reversalLog[inst]) {
    _detectBreakouts(inst, price, _prevDayHigh, _prevDayLow);
    _detectReversals(inst, price);
  }
  const today = _istDateStr();
  const now = Date.now();
  const bid = _bucketId(now);          // 5-min bucket id (shared with option H/L)
  if (rec.date !== today) {
    rec.date = today;
    rec.high = price; rec.highAt = now;
    rec.low  = price; rec.lowAt  = now;
    rec.highPath = [];                  // empty — only confirmed break buckets
    rec.lowPath  = [];
    rec.chainLog = [];
    return;
  }

  const newHigh = price > rec.high;
  const newLow  = price < rec.low;
  if (newHigh) { rec.high = price; rec.highAt = now; }
  if (newLow)  { rec.low  = price; rec.lowAt  = now; }

  // 5-min bucket rollup: one entry per 5-min window holding that window's
  // extreme. highPath = per-bucket highest, lowPath = per-bucket lowest.
  if (newHigh) {
    const tail = rec.highPath[rec.highPath.length - 1];
    if (tail && tail.bid === bid) { tail.p = price; tail.t = _bucketStartMs(bid); tail.at = now; }
    else { rec.highPath.push({ bid, t: _bucketStartMs(bid), at: now, p: price });
           if (rec.highPath.length > 96) rec.highPath.shift(); }
    if (_hlLastSnapshotAt[inst] !== undefined) _snapshotChainAtHL(inst, price, 'HIGH');
  }
  if (newLow) {
    const tail = rec.lowPath[rec.lowPath.length - 1];
    if (tail && tail.bid === bid) { tail.p = price; tail.t = _bucketStartMs(bid); tail.at = now; }
    else { rec.lowPath.push({ bid, t: _bucketStartMs(bid), at: now, p: price });
           if (rec.lowPath.length > 96) rec.lowPath.shift(); }
    if (_hlLastSnapshotAt[inst] !== undefined) _snapshotChainAtHL(inst, price, 'LOW');
  }
  // Persist to Redis on any new high/low (fire-and-forget)
  if (newHigh || newLow) redisStore.saveHL(inst, rec).catch(() => {});
}

async function getLivePrice() {
  if (Date.now() - _livePriceAt < 5000 && _livePrice > 10000) return _livePrice;
  // Try Dhan first
  try {
    const quote = await _withTimeout(live.getSensexPrice(), QUOTE_TIMEOUT_MS, 'Dhan SENSEX quote');
    const p = Number(quote.price);
    if (p > 10000) { _livePrice = p; _livePriceAt = Date.now(); _updateHL('SENSEX', p); return _livePrice; }
  } catch (_) { /* fall through */ }
  // Fallback: Yahoo Finance real-time quote
  const yp = await _fetchYahooPrice();
  if (yp > 10000) { _livePrice = yp; _livePriceAt = Date.now(); _updateHL('SENSEX', yp); }
  return _livePrice;
}


async function getLiveNiftyPrice() {
  if (Date.now() - _niftyLivePriceAt < 5000 && _niftyLivePrice > 10000) return _niftyLivePrice;
  try {
    const quote = await _withTimeout(live.getNiftyPrice(), QUOTE_TIMEOUT_MS, 'Dhan NIFTY quote');
    const p = Number(quote.price);
    if (p > 10000) { _niftyLivePrice = p; _niftyLivePriceAt = Date.now(); _updateHL('NIFTY', p); return _niftyLivePrice; }
  } catch (_) { /* use cached */ }
  return _niftyLivePrice;
}

async function getLiveBankNiftyPrice() {
  if (Date.now() - _bankNiftyLivePriceAt < 5000 && _bankNiftyLivePrice > 10000) return _bankNiftyLivePrice;
  try {
    const quote = await _withTimeout(live.getBankNiftyPrice(), QUOTE_TIMEOUT_MS, 'Dhan BANKNIFTY quote');
    const p = Number(quote.price);
    if (p > 10000) {
      _bankNiftyLivePrice = p;
      _bankNiftyLivePriceAt = Date.now();
      _updateHL('BANKNIFTY', p);
      return _bankNiftyLivePrice;
    }
  } catch (_) { /* use cached */ }
  return _bankNiftyLivePrice;
}

function getSuggestedStrike(price, signalType) {
  const roundStrike = Math.round(price / 100) * 100;

  if (signalType === "CALL") {
    return {
      atm: roundStrike + " CE",
      otm: (roundStrike + 100) + " CE",
      deepOtm: (roundStrike + 200) + " CE"
    };
  } else if (signalType === "PUT") {
    return {
      atm: roundStrike + " PE",
      otm: (roundStrike - 100) + " PE",
      deepOtm: (roundStrike - 200) + " PE"
    };
  }
  return null;
}

function checkVolumeSpike(currentVolume) {
  if (volumes.length < 5) return false;
  const avgVolume = volumes.slice(-10).reduce((a, b) => a + b, 0) / Math.min(volumes.length, 10);
  return currentVolume > avgVolume * 1.5; // 50% above average
}

function resetDailyCheck() {
  const currentDate = new Date().toDateString();
  if (currentDate !== todayDate) {
    todayDate = currentDate;
    tradesToday = 0;
    orbHigh = null; orbLow = null; dayHigh = null; dayLow = null;
    prices = []; volumes = [];
    niftyTradesToday = 0;
    niftyOrbHigh = null; niftyOrbLow = null; niftyDayHigh = null; niftyDayLow = null;
    niftyPrices = []; niftyVolumes = [];
    _persistMarketState();  // wipe yesterday's persistence too
    console.log("📅 New day - Resetting daily counters");
  }
}

// ── ORB / DAY-HIGH / DAY-LOW PERSISTENCE ──────────────────────────
// Writes today's intraday state to disk so a mid-session server restart
// (e.g. for token refresh) doesn't wipe the ORB and kill signal generation.
// Restored on startup IF the file's date matches today.
const _persistFs   = require('fs');
const _persistPath = require('path').resolve('./data/market-state.json');
let   _persistTimer = null;
// Synchronous write — used by the debounced saver AND the shutdown flush so a
// pending (un-fired) debounce never loses the latest state when the bot stops.
function _writeMarketState() {
  try {
    _persistFs.writeFileSync(_persistPath, JSON.stringify({
      date: todayDate,
      sensex: { orbHigh, orbLow, dayHigh, dayLow },
      nifty:  { orbHigh: niftyOrbHigh, orbLow: niftyOrbLow, dayHigh: niftyDayHigh, dayLow: niftyDayLow }
    }));
  } catch (_) { /* best-effort */ }
}
function _persistMarketState() {
  // Debounced — multiple calls within 2s collapse into one disk write
  if (_persistTimer) return;
  _persistTimer = setTimeout(() => { _persistTimer = null; _writeMarketState(); }, 2000);
}
function _restoreMarketState() {
  try {
    if (!_persistFs.existsSync(_persistPath)) return;
    const s = JSON.parse(_persistFs.readFileSync(_persistPath, 'utf8'));
    if (s.date !== todayDate) return;     // stale (yesterday or earlier)
    if (s.sensex) {
      orbHigh = s.sensex.orbHigh;  orbLow = s.sensex.orbLow;
      dayHigh = s.sensex.dayHigh;  dayLow = s.sensex.dayLow;
    }
    if (s.nifty) {
      niftyOrbHigh = s.nifty.orbHigh;  niftyOrbLow = s.nifty.orbLow;
      niftyDayHigh = s.nifty.dayHigh;  niftyDayLow = s.nifty.dayLow;
    }
    console.log(`📥 Restored market state — SENSEX ORB ${orbHigh ?? '--'}/${orbLow ?? '--'}, NIFTY ORB ${niftyOrbHigh ?? '--'}/${niftyOrbLow ?? '--'}`);
  } catch (e) {
    console.warn('[persist] restore failed:', e.message);
  }
}
// Run restore once at module load (before any API hits)
_restoreMarketState();

// ==================== ORB BACKFILL ====================
// If the server starts after 09:30 IST and ORB is still null (no in-process
// capture this session, no persisted state from earlier today), pull today's
// 1-min index candles from Dhan and compute the 09:15-09:30 ORB ourselves.
// Without this, every late restart wastes the trading day (root cause of
// multiple failed paper-validation attempts).
async function _backfillORBFromCandles() {
  const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
  const hh = istNow.getUTCHours();
  const mm = istNow.getUTCMinutes();
  const afterORBWindow = (hh > 9) || (hh === 9 && mm >= 30);
  if (!afterORBWindow) return;     // ORB will be captured live by tick handler

  const today = istNow.toISOString().slice(0, 10);
  const fetchOne = async (securityId, label) => {
    try {
      const r = await live.client._post('/v2/charts/intraday', {
        securityId: String(securityId),
        exchangeSegment: 'IDX_I',
        instrument: 'INDEX',
        interval: '1',
        fromDate: today,
        toDate: today,
      });
      const ts = r?.timestamp || [];
      const hi = r?.high || [];
      const lo = r?.low  || [];
      let oH = null, oL = null, dH = null, dL = null;
      // Rolling structures for the H/L break path (post-ORB only — the trend
      // detector cares about who's breaking *after* the opening range prints).
      let rollingHi = null, rollingLo = null;
      const highPath = [], lowPath = [];
      for (let i = 0; i < ts.length; i++) {
        const candleMs = Number(ts[i]) * 1000;
        const istCandle = new Date(candleMs + 5.5 * 3600 * 1000);
        const ch = istCandle.getUTCHours();
        const cm = istCandle.getUTCMinutes();
        const cHi = Number(hi[i]);
        const cLo = Number(lo[i]);
        const inORB = (ch === 9 && cm >= 15 && cm < 30);
        if (inORB) {
          if (oH === null || cHi > oH) oH = cHi;
          if (oL === null || cLo < oL) oL = cLo;
        }
        if (ch >= 9) {
          if (dH === null || cHi > dH) dH = cHi;
          if (dL === null || cLo < dL) dL = cLo;
        }
        // Build break path starting from 9:30 (after ORB window)
        const postORB = ch > 9 || (ch === 9 && cm >= 30);
        if (postORB) {
          if (rollingHi === null) { rollingHi = cHi; rollingLo = cLo; }
          if (cHi > rollingHi) { rollingHi = cHi; highPath.push({ t: candleMs, p: cHi }); }
          if (cLo < rollingLo) { rollingLo = cLo; lowPath.push ({ t: candleMs, p: cLo }); }
        }
      }
      return { orbHigh: oH, orbLow: oL, dayHigh: dH, dayLow: dL, highPath, lowPath, rollingHi, rollingLo, label };
    } catch (err) {
      console.log(`[orb-backfill] ${label} failed: ${err.message}`);
      return null;
    }
  };
  // Apply break path into _hlRecord so /api/trend has data immediately.
  const applyHL = (instKey, fetched) => {
    if (!fetched || (!fetched.highPath.length && !fetched.lowPath.length)) return;
    const r = _hlRecord[instKey];
    if (!r) return;
    r.date = today;
    if (fetched.rollingHi && (r.high === 0 || fetched.rollingHi > r.high)) {
      r.high = fetched.rollingHi; r.highAt = fetched.highPath.at(-1)?.t || Date.now();
    }
    if (fetched.rollingLo && (r.low === 0 || fetched.rollingLo < r.low)) {
      r.low = fetched.rollingLo; r.lowAt = fetched.lowPath.at(-1)?.t || Date.now();
    }
    // Merge: only append breaks newer than what we already have
    const lastHiT = r.highPath.at(-1)?.t || 0;
    const lastLoT = r.lowPath .at(-1)?.t || 0;
    for (const e of fetched.highPath) if (e.t > lastHiT) r.highPath.push(e);
    for (const e of fetched.lowPath)  if (e.t > lastLoT) r.lowPath .push(e);
    if (r.highPath.length > 50) r.highPath = r.highPath.slice(-50);
    if (r.lowPath .length > 50) r.lowPath  = r.lowPath .slice(-50);
    console.log(`📈 Backfilled ${instKey} H/L breaks: ${fetched.highPath.length} highs, ${fetched.lowPath.length} lows`);
  };

  // Always fetch so we can backfill H/L break paths even if ORB was restored
  // from disk. Skip the ORB write itself if already populated.
  const sx = await fetchOne(process.env.DHAN_SENSEX_SECURITY_ID || '51', 'SENSEX');
  if (sx) {
    if ((orbHigh === null || orbLow === null) && sx.orbHigh && sx.orbLow) {
      orbHigh = sx.orbHigh; orbLow = sx.orbLow;
      console.log(`📊 Backfilled SENSEX ORB: ${orbHigh}/${orbLow}`);
    }
    // Day H/L: always merge the full-day extreme from Dhan, regardless of
    // whether ORB was restored from disk. Take the widest range so a restart
    // never loses an earlier high/low that today's live ticks haven't re-hit.
    if (sx.dayHigh && (dayHigh === null || sx.dayHigh > dayHigh)) dayHigh = sx.dayHigh;
    if (sx.dayLow  && (dayLow  === null || sx.dayLow  < dayLow))  dayLow  = sx.dayLow;
    console.log(`📊 SENSEX Day H/L: ${dayHigh}/${dayLow}`);
    applyHL('SENSEX', sx);
  }
  const nf = await fetchOne(process.env.DHAN_NIFTY_SECURITY_ID || '13', 'NIFTY');
  if (nf) {
    if ((niftyOrbHigh === null || niftyOrbLow === null) && nf.orbHigh && nf.orbLow) {
      niftyOrbHigh = nf.orbHigh; niftyOrbLow = nf.orbLow;
      console.log(`📊 Backfilled NIFTY ORB: ${niftyOrbHigh}/${niftyOrbLow}`);
    }
    if (nf.dayHigh && (niftyDayHigh === null || nf.dayHigh > niftyDayHigh)) niftyDayHigh = nf.dayHigh;
    if (nf.dayLow  && (niftyDayLow  === null || nf.dayLow  < niftyDayLow))  niftyDayLow  = nf.dayLow;
    console.log(`📊 NIFTY Day H/L: ${niftyDayHigh}/${niftyDayLow}`);
    applyHL('NIFTY', nf);
  }
  if (sx || nf) _persistMarketState();

  // Holiday/weekend warning — if both fetches returned but with no ORB data,
  // it's a non-trading day. Surface explicitly so engine ticks don't fire blind.
  const istDay = new Date(Date.now() + 5.5 * 3600 * 1000).getUTCDay();
  const isWeekend = istDay === 0 || istDay === 6;
  const sxEmpty = !sx?.orbHigh && !sx?.orbLow;
  const nfEmpty = !nf?.orbHigh && !nf?.orbLow;
  if (sxEmpty && nfEmpty) {
    console.log(`⚠ ORB backfill returned no candles — ${isWeekend ? 'weekend' : 'likely market holiday'} or pre-open. Engine signals will WAIT until live ticks build.`);
  }
}
// Fire on boot — give Dhan client 3s to finish handshake first.
setTimeout(() => { _backfillORBFromCandles().catch(() => {}); }, 3000);

// ==================== API ROUTES ====================

// Get live Sensex data (Dhan or demo fallback)
app.get("/api/sensex", async (req, res) => {
  try {
    const quote = await _withTimeout(live.getSensexPrice(), QUOTE_TIMEOUT_MS, 'Dhan SENSEX quote');
    const price = Number(quote.price);
    const volume = Number(quote.volume);
    _livePrice = price;
    _livePriceAt = Date.now();
    _updateHL('SENSEX', price);

    const now = new Date();
    const session = getMarketSession(now);
    const hour = session.istHour;
    const minute = session.istMinute;

    if (!session.inMarketHours) {
      clearSignalsForClosedMarket(session);
      return res.json({
        price: price.toFixed(2),
        orbHigh: orbHigh ? orbHigh.toFixed(2) : "--",
        orbLow: orbLow ? orbLow.toFixed(2) : "--",
        dayHigh: dayHigh ? dayHigh.toFixed(2) : "--",
        dayLow:  dayLow  ? dayLow.toFixed(2)  : "--",
        vwap: vwap > 0 ? vwap.toFixed(2) : price.toFixed(2),
        signal: "WAIT",
        confidence: 0,
        suggestedStrike: "--",
        target: "--",
        botRunning: botRunning,
        tradesToday: tradesToday,
        marketOpen: false,
        marketStatus: session.status,
        time: now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }),
        source: DATA_SOURCE
      });
    }

    // Store data — cap at 300 ticks to prevent memory growth
    prices.push(price);   if (prices.length  > 300) prices.shift();
    volumes.push(volume); if (volumes.length > 300) volumes.shift();

    // ORB Calculation (First 15 min: 9:15-9:30 AM) — persisted to disk so
    // mid-session restart can't wipe it (see _persistMarketState).
    let _changed = false;
    if (hour === 9 && minute <= 30) {
      if (orbHigh === null || price > orbHigh) { orbHigh = price; _changed = true; }
      if (orbLow === null || price < orbLow)   { orbLow  = price; _changed = true; }
    }

    // Day High / Low (full session)
    if (hour >= 9) {
      if (dayHigh === null || price > dayHigh) { dayHigh = price; _changed = true; }
      if (dayLow  === null || price < dayLow)  { dayLow  = price; _changed = true; }
    }
    if (_changed) {
      _persistMarketState();
      if (orbHigh && orbLow) redisStore.saveORB('SENSEX', orbHigh, orbLow).catch(() => {});
    }

    // Calculate VWAP
    vwap = calculateVWAP(prices, volumes);

    // Check volume spike
    const volumeSpike = checkVolumeSpike(volume);

    // Trend from recent price history vs VWAP — required for full scoring (15pt)
    const sensexTrend = prices.length >= 5 ? detectTrend(prices, vwap) : null;

    // Index feeds carry no volume (Dhan returns 0) — flag it so the volume gate
    // stays neutral instead of silently costing 20 pts and delaying entries.
    const sensexVolAvailable = volumes.slice(-10).some(v => Number(v) > 0);

    // Get AI Signal
    const aiResult = aiDecision(price, orbHigh, orbLow, vwap, volumeSpike, hour, minute,
      { trend: sensexTrend?.direction, volumeAvailable: sensexVolAvailable });
    currentSignal = aiResult.signal;
    confidence = aiResult.confidence;
    _lastAiResult = aiResult;

    // Suggest strike
    if (currentSignal === "CALL" || currentSignal === "PUT") {
      const strikes = getSuggestedStrike(price, currentSignal);
      suggestedStrike = confidence >= 85 ? strikes.otm : strikes.atm;
      targetMultiplier = confidence >= 90 ? "10X-50X" : confidence >= 80 ? "5X-10X" : "2X-5X";
    } else {
      suggestedStrike = "--";
      targetMultiplier = "--";
    }

    res.json({
      price: price.toFixed(2),
      orbHigh: orbHigh ? orbHigh.toFixed(2) : "--",
      orbLow: orbLow ? orbLow.toFixed(2) : "--",
      dayHigh: dayHigh ? dayHigh.toFixed(2) : "--",
      dayLow:  dayLow  ? dayLow.toFixed(2)  : "--",
      vwap: vwap.toFixed(2),
      signal: currentSignal,
      confidence: confidence,
      suggestedStrike: suggestedStrike,
      target: targetMultiplier,
      botRunning: botRunning,
      tradesToday: tradesToday,
      marketOpen: true,
      marketStatus: session.status,
      time: now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })
    });

  } catch (error) {
    // Fallback: use Yahoo Finance price so dashboard always works
    try {
      const yPrice = await getLivePrice();
      const now2 = new Date();
      const session = getMarketSession(now2);
      const sig = publicSignalFor('SENSEX', session);
      res.json({
        price: yPrice.toFixed(2),
        orbHigh: orbHigh ? orbHigh.toFixed(2) : "--",
        orbLow:  orbLow  ? orbLow.toFixed(2)  : "--",
        dayHigh: dayHigh ? dayHigh.toFixed(2) : "--",
        dayLow:  dayLow  ? dayLow.toFixed(2)  : "--",
        vwap:    vwap > 0 ? vwap.toFixed(2)   : yPrice.toFixed(2),
        signal:  sig.signal,
        confidence: sig.confidence,
        suggestedStrike: sig.suggestedStrike,
        target: sig.target,
        botRunning, tradesToday,
        marketOpen: session.inMarketHours,
        marketStatus: session.status,
        time: now2.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }),
        source: 'yahoo_fallback'
      });
    } catch (e2) {
      console.error("Error fetching data:", error.message);
      res.status(500).json({ error: "Failed to fetch data" });
    }
  }
});

// ==================== NIFTY LIVE DATA ====================
app.get("/api/nifty", async (req, res) => {
  try {
    let quote;
    let source = DATA_SOURCE;
    try {
      quote = await _withTimeout(live.getNiftyPrice(), QUOTE_TIMEOUT_MS, 'Dhan NIFTY quote');
    } catch (_) {
      const yp = await _fetchYahooNiftyPrice();
      if (yp > 10000) {
        quote = { price: yp, volume: 0 };
        source = 'yahoo_fallback';
      } else if (_niftyLivePrice > 10000) {
        quote = { price: _niftyLivePrice, volume: 0 };
        source = 'cache';
      } else {
        throw _;
      }
    }
    const price  = Number(quote.price);
    const volume = Number(quote.volume);
    _niftyLivePrice = price; _niftyLivePriceAt = Date.now();
    _updateHL('NIFTY', price);  // H/L break tracker with option-chain snapshots

    const now    = new Date();
    const session = getMarketSession(now);
    const hour   = session.istHour;
    const minute = session.istMinute;

    if (!session.inMarketHours) {
      clearSignalsForClosedMarket(session);
      return res.json({
        price: price.toFixed(2),
        orbHigh: niftyOrbHigh ? niftyOrbHigh.toFixed(2) : '--',
        orbLow:  niftyOrbLow  ? niftyOrbLow.toFixed(2)  : '--',
        dayHigh: niftyDayHigh ? niftyDayHigh.toFixed(2) : '--',
        dayLow:  niftyDayLow  ? niftyDayLow.toFixed(2)  : '--',
        vwap:    niftyVwap > 0 ? niftyVwap.toFixed(2) : price.toFixed(2),
        signal:          'WAIT',
        confidence:      0,
        suggestedStrike: '--',
        target:          '--',
        botRunning,
        tradesToday: niftyTradesToday,
        marketOpen: false,
        marketStatus: session.status,
        time: now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }),
        source
      });
    }

    niftyPrices.push(price);   if (niftyPrices.length  > 300) niftyPrices.shift();
    niftyVolumes.push(volume); if (niftyVolumes.length > 300) niftyVolumes.shift();

    let _niftyChanged = false;
    if (hour === 9 && minute <= 30) {
      if (niftyOrbHigh === null || price > niftyOrbHigh) { niftyOrbHigh = price; _niftyChanged = true; }
      if (niftyOrbLow  === null || price < niftyOrbLow)  { niftyOrbLow  = price; _niftyChanged = true; }
    }
    if (hour >= 9) {
      if (niftyDayHigh === null || price > niftyDayHigh) { niftyDayHigh = price; _niftyChanged = true; }
      if (niftyDayLow  === null || price < niftyDayLow)  { niftyDayLow  = price; _niftyChanged = true; }
    }
    if (_niftyChanged) {
      _persistMarketState();
      if (niftyOrbHigh && niftyOrbLow) redisStore.saveORB('NIFTY', niftyOrbHigh, niftyOrbLow).catch(() => {});
    }

    niftyVwap = calculateVWAP(niftyPrices, niftyVolumes);
    const volumeSpike = niftyVolumes.length >= 5
      ? volume > (niftyVolumes.slice(-10).reduce((a, b) => a + b, 0) / Math.min(niftyVolumes.length, 10)) * 1.5
      : false;

    // Trend from recent price history vs VWAP (BULLISH / BEARISH / SIDEWAYS).
    // Without this, aiDecision was capped at ~70 — never reaching 75 threshold.
    const niftyTrend = niftyPrices.length >= 5 ? detectTrend(niftyPrices, niftyVwap) : null;
    // Index feeds carry no volume — keep the volume gate neutral (see ai.js).
    const niftyVolAvailable = niftyVolumes.slice(-10).some(v => Number(v) > 0);
    const aiResult = aiDecision(price, niftyOrbHigh, niftyOrbLow, niftyVwap, volumeSpike, hour, minute,
      { trend: niftyTrend?.direction, volumeAvailable: niftyVolAvailable });
    niftySignal     = aiResult.signal;
    niftyConfidence = aiResult.confidence;
    _lastNiftyAiResult = aiResult;

    if (niftySignal === 'CALL' || niftySignal === 'PUT') {
      const atm = Math.round(price / 50) * 50;
      niftySuggestedStrike = niftySignal === 'CALL' ? `${atm + 50} CE` : `${atm - 50} PE`;
      niftyTargetMultiplier = niftyConfidence >= 90 ? '10X-50X' : niftyConfidence >= 80 ? '5X-10X' : '2X-5X';
    } else {
      niftySuggestedStrike = '--'; niftyTargetMultiplier = '--';
    }

    res.json({
      price: price.toFixed(2),
      orbHigh: niftyOrbHigh ? niftyOrbHigh.toFixed(2) : '--',
      orbLow:  niftyOrbLow  ? niftyOrbLow.toFixed(2)  : '--',
      dayHigh: niftyDayHigh ? niftyDayHigh.toFixed(2) : '--',
      dayLow:  niftyDayLow  ? niftyDayLow.toFixed(2)  : '--',
      vwap:    niftyVwap.toFixed(2),
      signal:          niftySignal,
      confidence:      niftyConfidence,
      suggestedStrike: niftySuggestedStrike,
      target:          niftyTargetMultiplier,
      botRunning,
      tradesToday: niftyTradesToday,
      marketOpen: true,
      marketStatus: session.status,
      time: now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }),
      source
    });
  } catch (err) {
    console.error('[nifty] fetch error:', err && err.message ? err.message : err);
    if (!res.headersSent) {
      const session = getMarketSession();
      const cached = _niftyLivePrice > 10000 ? _niftyLivePrice : 0;
      if (cached) {
        clearSignalsForClosedMarket(session);
        return res.json({
          price: cached.toFixed(2),
          orbHigh: niftyOrbHigh ? niftyOrbHigh.toFixed(2) : '--',
          orbLow:  niftyOrbLow  ? niftyOrbLow.toFixed(2)  : '--',
          dayHigh: niftyDayHigh ? niftyDayHigh.toFixed(2) : '--',
          dayLow:  niftyDayLow  ? niftyDayLow.toFixed(2)  : '--',
          vwap:    niftyVwap > 0 ? niftyVwap.toFixed(2) : cached.toFixed(2),
          signal: 'WAIT',
          confidence: 0,
          suggestedStrike: '--',
          target: '--',
          botRunning,
          tradesToday: niftyTradesToday,
          marketOpen: session.inMarketHours,
          marketStatus: session.status,
          time: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }),
          source: 'cache'
        });
      }
      res.status(500).json({ error: 'Failed to fetch NIFTY data' });
    }
  }
});

app.get("/api/banknifty", async (req, res) => {
  try {
    let quote;
    let source = DATA_SOURCE;
    try {
      quote = await _withTimeout(live.getBankNiftyPrice(), QUOTE_TIMEOUT_MS, 'Dhan BANKNIFTY quote');
    } catch (_) {
      if (_bankNiftyLivePrice > 10000) {
        quote = { price: _bankNiftyLivePrice, volume: 0 };
        source = 'cache';
      } else {
        throw _;
      }
    }
    const price = Number(quote.price);
    const volume = Number(quote.volume || 0);
    _bankNiftyLivePrice = price;
    _bankNiftyLivePriceAt = Date.now();
    _updateHL('BANKNIFTY', price);

    const now = new Date();
    const session = getMarketSession(now);
    const vwap = price;
    const atm = Math.round(price / 100) * 100;

    res.json({
      price: price.toFixed(2),
      orbHigh: '--',
      orbLow: '--',
      dayHigh: '--',
      dayLow: '--',
      vwap: vwap.toFixed(2),
      signal: 'WAIT',
      confidence: 0,
      suggestedStrike: `${atm} CE / ${atm} PE`,
      target: '--',
      botRunning,
      tradesToday: 0,
      marketOpen: session.inMarketHours,
      marketStatus: session.status,
      time: now.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }),
      volume,
      source
    });
  } catch (err) {
    console.error('[banknifty] fetch error:', err && err.message ? err.message : err);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to fetch BANKNIFTY data' });
  }
});

// Start bot
app.post("/api/bot/start", (req, res) => {
  botRunning = true;
  console.log("🚀 Bot STARTED");
  res.json({ status: "Bot started", running: true });
});

// Stop bot
app.post("/api/bot/stop", (req, res) => {
  botRunning = false;
  console.log("🛑 Bot STOPPED");
  res.json({ status: "Bot stopped", running: false });
});

// Get bot status
app.get("/api/bot/status", (req, res) => {
  res.json({
    running: botRunning,
    tradesToday: tradesToday,
    maxTradesPerDay: parseInt(process.env.MAX_TRADES_PER_DAY || 2),
    currentSignal: currentSignal,
    confidence: confidence
  });
});

// Execute trade via Dhan (semi-auto: user confirms)
app.post("/api/trade/execute", async (req, res) => {
  const { securityId, strike, type, quantity } = req.body;

  const maxTrades = parseInt(process.env.MAX_TRADES_PER_DAY || 2);
  if (tradesToday >= maxTrades) {
    return res.status(400).json({
      error: `Daily trade limit reached (${maxTrades}/${maxTrades})`
    });
  }

  if (!botRunning) {
    return res.status(400).json({ error: "Bot is not running" });
  }

  if (!securityId) {
    return res.status(400).json({ error: "securityId required (Dhan option contract id)" });
  }

  try {
    const tradeMode = process.env.TRADE_MODE || 'paper';
    if (tradeMode !== 'live') {
      tradesToday++;
      tradeHistory.push({
        time: new Date().toLocaleTimeString(),
        securityId,
        strike,
        type,
        quantity: Number(quantity) || 10,
        orderId: `PAPER-${Date.now()}`,
        status: 'PAPER'
      });
      console.log(`[trade] PAPER: ${type} ${strike}`);
      return res.json({ status: 'PAPER', orderId: tradeHistory[tradeHistory.length - 1].orderId, trade: { securityId, strike, type } });
    }

    const orderResult = await live.placeOrder({
      securityId,
      exchangeSegment: 'BSE_FNO',
      transactionType: 'BUY',
      productType: 'INTRADAY',
      orderType: 'MARKET',
      quantity: Number(quantity) || 10
    });

    tradesToday++;
    tradeHistory.push({
      time: new Date().toLocaleTimeString(),
      securityId,
      strike,
      type,
      quantity: Number(quantity) || 10,
      orderId: orderResult.orderId,
      status: orderResult.status
    });

    console.log(`[trade] ${orderResult.status}: ${type} ${strike} (${orderResult.orderId})`);
    res.json({ status: orderResult.status, orderId: orderResult.orderId, trade: { securityId, strike, type } });
  } catch (error) {
    console.error("Trade execution error:", error.message);
    res.status(500).json({ error: "Trade execution failed", detail: error.message });
  }
});

// Get trade history
app.get("/api/trades", (req, res) => {
  res.json({
    tradesToday: tradesToday,
    history: tradeHistory
  });
});

// Get ORB levels
app.get("/api/orb", (req, res) => {
  res.json({
    high: orbHigh ? orbHigh.toFixed(2) : "--",
    low: orbLow ? orbLow.toFixed(2) : "--",
    calculated: orbHigh !== null && orbLow !== null
  });
});

// Get VWAP
app.get("/api/vwap", (req, res) => {
  res.json({
    value: vwap.toFixed(2)
  });
});

// Signal detail — JSON consumed by AmiBroker AFL PollSignalDetail()
// Fields are extracted in order: entry, sl, t2, t3, reason.
// Friday 5× preset: t3 = 5× entry (primary target), t2 = 2× entry (partial book).
app.get("/api/signal", (req, res) => {
  const session = getMarketSession();
  const sig = publicSignalFor('SENSEX', session);
  let entry = 0, sl = 0;
  if (openPosition && openPosition.entryPrice > 0) {
    entry = openPosition.entryPrice;
    sl    = openPosition.sl || entry * 0.65;
  }
  const t2 = entry > 0 ? +(entry * 2).toFixed(2) : 0;
  const t3 = entry > 0 ? +(entry * 5).toFixed(2) : 0;

  res.json({
    signal:     sig.signal,
    confidence: sig.confidence,
    strike:     sig.suggestedStrike,
    target:     sig.target,
    entry:      +entry.toFixed(2),
    sl:         +sl.toFixed(2),
    t2,
    t3,
    reason:     sig.signal === 'WAIT' ? 'NO_SIGNAL' : `${sig.signal}_BREAKOUT`,
    marketOpen: session.inMarketHours,
    marketStatus: session.status,
    primaryMultiple: 5
  });
});

// Frontend runtime config
app.get("/api/config", (_req, res) => {
  res.json({
    apiBaseUrl: process.env.PUBLIC_API_BASE_URL || "",
    mode: process.env.TRADE_MODE || "paper",
    maxTradesPerDay: parseInt(process.env.MAX_TRADES_PER_DAY || 2, 10)
  });
});

// ==================== DHAN ONE-CLICK TOKEN REFRESH ====================
// Flow: GET /api/dhan/login → Dhan consent page → user logs in →
// Dhan redirects to /api/dhan/oauth-callback?tokenId=... → server
// exchanges tokenId for JWT, writes it to .env, restarts engines.
const _dhanFetch = require('node-fetch');
const _fs = require('fs');
const _envPath = require('path').resolve('./.env');

app.get('/api/dhan/login', async (req, res) => {
  const apiKey    = process.env.DHAN_API_KEY;
  const apiSecret = process.env.DHAN_API_SECRET;
  const clientId  = process.env.DHAN_CLIENT_ID;
  if (!apiKey || !apiSecret || !clientId) {
    return res.status(400).send('Missing DHAN_API_KEY / DHAN_API_SECRET / DHAN_CLIENT_ID in .env');
  }
  try {
    const r = await _dhanFetch(`https://auth.dhan.co/app/generate-consent?client_id=${clientId}`, {
      method: 'POST',
      headers: { app_id: apiKey, app_secret: apiSecret, Accept: 'application/json' },
      timeout: 15000
    });
    const j = await r.json();
    if (!r.ok || !j.consentAppId) {
      return res.status(502).send(`Step 1 failed (${r.status}): ${JSON.stringify(j)}`);
    }
    res.redirect(`https://auth.dhan.co/login/consentApp-login?consentAppId=${j.consentAppId}`);
  } catch (err) {
    res.status(500).send(`generate-consent failed: ${err.message}`);
  }
});

app.get('/api/dhan/oauth-callback', async (req, res) => {
  const { tokenId } = req.query;
  if (!tokenId) return res.status(400).send('Missing tokenId in callback');
  const apiKey    = process.env.DHAN_API_KEY;
  const apiSecret = process.env.DHAN_API_SECRET;
  try {
    const r = await _dhanFetch(`https://auth.dhan.co/app/consumeApp-consent?tokenId=${tokenId}`, {
      method: 'POST',
      headers: { app_id: apiKey, app_secret: apiSecret, Accept: 'application/json' },
      timeout: 15000
    });
    const j = await r.json();
    if (!r.ok || !j.accessToken) {
      return res.status(502).send(`Step 3 failed (${r.status}): ${JSON.stringify(j)}`);
    }

    const cleanToken = normalizeDhanAccessToken(j.accessToken);

    // Persist new token to .env (preserve every other line as-is)
    let env = _fs.readFileSync(_envPath, 'utf8');
    if (env.match(/^DHAN_ACCESS_TOKEN=/m)) {
      env = env.replace(/^DHAN_ACCESS_TOKEN=.*$/m, `DHAN_ACCESS_TOKEN=${cleanToken}`);
    } else {
      env += `\nDHAN_ACCESS_TOKEN=${cleanToken}\n`;
    }
    _fs.writeFileSync(_envPath, env);

    // Apply in-memory + reconnect Dhan client (no restart needed)
    process.env.DHAN_ACCESS_TOKEN = cleanToken;
    try {
      if (live?.refreshAuth) {
        await live.refreshAuth({ accessToken: cleanToken });
      } else if (live?.client) {
        live.client.accessToken = cleanToken;
      }
    } catch (e) {
      console.warn('[dhan] token refresh applied, but reconnect failed:', e.message);
    }

    res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Dhan token refreshed</title>
      <style>body{font-family:system-ui;background:#0B0F1A;color:#e5e7eb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
      .card{background:#121826;border:1px solid #1E293B;border-radius:12px;padding:32px;max-width:420px;text-align:center}
      h1{color:#00FFB2;margin:0 0 12px}small{color:#94A3B8;display:block;margin-top:14px}</style></head>
      <body><div class="card"><h1>✓ Token refreshed</h1>
      <div>Expires: ${j.expiryTime || 'in 24h'}</div>
      <small>Saved to .env, applied in-memory.</small>
      <small><a href="/app.html" style="color:#00FFB2">→ open dashboard</a></small>
      </div></body></html>`);
  } catch (err) {
    res.status(500).send(`oauth-callback failed: ${err.message}`);
  }
});

// Decode the JWT to extract `exp` (seconds since epoch). Returns null on
// any parse error — token might be missing, malformed, or non-JWT.
function _decodeDhanTokenExp() {
  return Number(getDhanTokenStatus(process.env.DHAN_ACCESS_TOKEN)?.payload?.exp || 0) || null;
}

function _tokenStatus() {
  const apiAuth = live?.client?.getAuthStatus?.();
  return {
    ...getDhanTokenStatus(process.env.DHAN_ACCESS_TOKEN),
    serverValid: apiAuth?.blocked ? false : (live?.connected ? true : null),
    serverError: apiAuth?.blocked ? apiAuth.message : null,
    refreshUrl: '/api/dhan/login'
  };
}

app.get('/api/dhan/token-status', (req, res) => res.json(_tokenStatus()));

// Daily 08:30 IST token expiry check. If <2h remain, log a console banner
// and (if Telegram is wired) fire an alert. Use a 1-minute interval to
// catch the 08:30 IST window regardless of restart time.
let _tokenWarnedDate = '';
setInterval(async () => {
  try {
    const istNow = new Date(Date.now() + 5.5 * 3600 * 1000);
    const hh = istNow.getUTCHours();
    const mm = istNow.getUTCMinutes();
    const dayStr = istNow.toISOString().slice(0, 10);
    if (hh !== 8 || mm !== 30 || _tokenWarnedDate === dayStr) return;
    _tokenWarnedDate = dayStr;
    const st = _tokenStatus();
    if (st.valid && st.hoursLeft > 2) return;
    const msg = st.valid
      ? `⚠ Dhan token expires in ${st.hoursLeft}h (${st.expiresAtIST}). Refresh at ${process.env.PUBLIC_API_BASE_URL || ''}/api/dhan/login before market open.`
      : `⛔ Dhan token INVALID. Refresh now: ${process.env.PUBLIC_API_BASE_URL || ''}/api/dhan/login`;
    console.log('\n' + '='.repeat(70) + '\n  ' + msg + '\n' + '='.repeat(70) + '\n');
    if (telegram?.enabled) {
      try { await telegram.sendAlert(st.valid ? 'Dhan token expiring' : 'Dhan token invalid', msg); }
      catch (e) { console.log('Telegram alert failed:', e.message); }
    }
  } catch (_) { /* never crash on monitor */ }
}, 60 * 1000);

// Health check
app.get("/api/health", (req, res) => {
  const source = live instanceof UpstoxConnector ? 'Upstox' : live instanceof KotakNeoConnector ? 'Kotak Neo' : 'Dhan';
  res.json({
    status: "OK",
    mode: live.connected ? `DATA (${source})` : "DISCONNECTED",
    tradeMode: process.env.TRADE_MODE || "paper",
    autoTrading: {
      sensex: engine?.autoEnabled ?? false,
      nifty: niftyEngine?.autoEnabled ?? false
    },
    connector: source,
    telegram: telegram ? { enabled: telegram.enabled, connected: telegram.connected, hasToken: !!telegram.botToken, hasChat: !!telegram.chatId } : { enabled: false },
    token: _tokenStatus(),
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// ==================== DATA-SOURCE WATCHDOG ====================
// A trading bot must NEVER silently run on stale/fallback data. (This session a
// zombie process held the port for ~13.6h on an expired token: prices fell back
// to Yahoo and every option chain 401'd, with zero visible warning.) This probes
// the live connector every 60s — a real price quote AND a real option chain — and
// classifies the data source HEALTHY / DEGRADED / DOWN. On any state change it
// logs loudly and Telegram-alerts so an outage surfaces immediately.
let _dataHealth = {
  status: 'UNKNOWN', since: Date.now(), reasons: [], priceLive: null, chainOk: null,
  connector: DATA_SOURCE, lastOkAt: 0, lastProbeAt: 0
};

async function _probeDataHealth() {
  const reasons = [];
  let priceLive = false, chainOk = false;
  try {
    const q = await _withTimeout(live.getNiftyPrice(), 4000, 'probe price');
    if (q && Number(q.price) > 10000) priceLive = true; else reasons.push('price: no live quote');
  } catch (e) { reasons.push('price: ' + String(e.message || 'fail').slice(0, 70)); }
  try {
    const c = await _withTimeout(live.getNiftyOptionChain(), 6000, 'probe chain');
    if (c && Array.isArray(c.strikes) && c.strikes.length) chainOk = true; else reasons.push('chain: empty');
  } catch (e) { reasons.push('chain: ' + String(e.message || 'fail').slice(0, 90)); }

  const status = (priceLive && chainOk) ? 'HEALTHY' : (!priceLive && !chainOk) ? 'DOWN' : 'DEGRADED';
  const prev = _dataHealth.status;
  const now = Date.now();
  _dataHealth = {
    status, since: status === prev ? _dataHealth.since : now, reasons,
    priceLive, chainOk, connector: DATA_SOURCE,
    lastOkAt: status === 'HEALTHY' ? now : _dataHealth.lastOkAt, lastProbeAt: now
  };

  if (status !== prev && prev !== 'UNKNOWN') {
    const sess = getMarketSession();
    const emoji = status === 'HEALTHY' ? '✅' : status === 'DEGRADED' ? '⚠️' : '⛔';
    const msg = `${emoji} Data source ${status} (${DATA_SOURCE})` + (reasons.length ? `\n${reasons.join('; ')}` : '');
    console.log('\n' + '='.repeat(70) + '\n  ' + msg + '\n' + '='.repeat(70) + '\n');
    // Alert on any degrade/down, and on recovery. Skip degrade noise outside market hours.
    if (telegram?.enabled && (sess.inMarketHours || status === 'HEALTHY')) {
      try { await telegram.sendAlert(`Data source ${status}`, msg); } catch (_) {}
    }
  }
}
setTimeout(() => { _probeDataHealth().catch(() => {}); }, 12000);
setInterval(() => { _probeDataHealth().catch(() => {}); }, 60 * 1000);

app.get('/api/data-health', (req, res) => res.json(_dataHealth));

// ==================== AI ADVISOR HIT-RATE ====================
// Mature logged AI signals against the latest spot every 2 min (15-min hold
// window) so the otherwise-unbacktested advisors get a real, measured win-rate.
setInterval(async () => {
  try {
    const [sx, nf] = await Promise.all([
      getLivePrice().catch(() => 0),
      getLiveNiftyPrice().catch(() => 0)
    ]);
    if (sx > 0) aiLogger.evaluate('SENSEX', sx);
    if (nf > 0) aiLogger.evaluate('NIFTY', nf);
  } catch (_) {}
}, 120 * 1000);

app.get('/api/ai-log/stats', (req, res) => res.json(aiLogger.stats()));

// Send a test message via Telegram — used to verify TELEGRAM_BOT_TOKEN
// and TELEGRAM_CHAT_ID are correct without waiting for a real trade signal.
app.post("/api/telegram/test", async (req, res) => {
  if (!telegram || !telegram.enabled) {
    return res.status(400).json({ ok: false, error: 'Telegram disabled — set TELEGRAM_ENABLED=true and credentials in .env, then restart' });
  }
  try {
    await telegram.sendTest();
    res.json({ ok: true, message: 'Test alert sent — check your Telegram chat' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Kotak Neo OTP submission (call this after server starts if OTP is sent to mobile)
app.post("/api/kotak/otp", async (req, res) => {
  const { otp } = req.body;
  if (!otp) return res.status(400).json({ error: "otp required" });
  if (!(live instanceof KotakNeoConnector)) {
    return res.status(400).json({ error: "Server is not using Kotak Neo connector" });
  }
  try {
    const result = await live.submitOTP(String(otp));
    res.json({ success: true, message: "Kotak Neo connected successfully", ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== SENSIBULL-STYLE OPTION ANALYTICS ====================

const OPTION_SNAPSHOT_TTL_MS = 4000;
const _optionSnapshotCache = new Map();

function _optionAuthRequired(error) {
  return error?.code === 'DHAN_AUTH'
    || error?.code === 'DHAN_AUTH_BLOCKED'
    || error?.status === 401
    || error?.status === 403;
}

function _optionSnapshotError(res, error) {
  const authRequired = _optionAuthRequired(error);
  return res.status(authRequired ? 503 : 500).json({
    error: authRequired ? 'Dhan authentication required' : 'Failed to fetch option snapshot',
    code: authRequired ? 'DHAN_AUTH_REQUIRED' : 'OPTION_SNAPSHOT_FAILED',
    refreshUrl: authRequired ? '/api/dhan/login' : undefined
  });
}

async function _buildOptionSnapshot(instrument = 'NIFTY') {
  const inst = String(instrument || 'NIFTY').toUpperCase();
  const cached = _optionSnapshotCache.get(inst);
  if (cached?.data && Date.now() - cached.at < OPTION_SNAPSHOT_TTL_MS) return cached.data;
  if (cached?.promise) return cached.promise;

  const promise = (async () => {
    const startedAt = Date.now();
    const meta = getInstrumentMeta(inst);

    // Stage 1: price getter updates the shared index H/L record.
    const price = await meta.priceGetter();
    const indexHlAt = Date.now();

    // Stage 2: fetch one real chain and update every option contract H/L record.
    const chain = await meta.chainGetter(price);
    const spot = Number(chain?.spotPrice || price || 0);
    const atmStrike = Number(chain?.atmStrike || Math.round(spot / meta.step) * meta.step);

    optionAnalyzer.spotPrice = spot;
    optionAnalyzer.strikePitch = meta.step;
    const normalizeLeg = (leg, type, strike) => {
      if (!leg) return {};
      const ltp = Number(leg.ltp || 0);
      _updateOptHL(inst, strike, type, ltp, Number(leg.high || 0), Number(leg.low || 0));
      const hl = _getOptHL(inst, strike, type) || {};
      const fallback = optionAnalyzer.calculateGreeks(strike, type, spot);
      const metric = (name) => Number.isFinite(Number(leg[name])) ? Number(leg[name]) : Number(fallback[name] || 0);
      return {
        ...leg,
        ltp,
        high: Number(leg.high || hl.high || ltp || 0),
        low: Number(leg.low || hl.low || ltp || 0),
        oi: Number(leg.oi || 0),
        changeOI: Number(leg.changeOI || 0),
        volume: Number(leg.volume || 0),
        iv: Number(leg.iv || 0),
        delta: metric('delta'),
        gamma: metric('gamma'),
        theta: metric('theta'),
        vega: metric('vega')
      };
    };

    const strikes = (chain?.strikes || []).map((row) => ({
      strike: Number(row.strike),
      isATM: Number(row.strike) === atmStrike,
      itmCE: Number(row.strike) < atmStrike,
      itmPE: Number(row.strike) > atmStrike,
      ce: normalizeLeg(row.ce, 'CE', Number(row.strike)),
      pe: normalizeLeg(row.pe, 'PE', Number(row.strike))
    }));

    const optionHlAt = Date.now();

    // Stage 3: all analytics use the exact normalized live chain above.
    const totals = strikes.reduce((sum, row) => {
      sum.callOI += Number(row.ce?.oi || 0);
      sum.putOI += Number(row.pe?.oi || 0);
      sum.callVolume += Number(row.ce?.volume || 0);
      sum.putVolume += Number(row.pe?.volume || 0);
      if (row.isATM) {
        sum.atmCallVolume = Number(row.ce?.volume || 0);
        sum.atmPutVolume = Number(row.pe?.volume || 0);
      }
      return sum;
    }, { callOI: 0, putOI: 0, callVolume: 0, putVolume: 0, atmCallVolume: 0, atmPutVolume: 0 });

    const ratio = (numerator, denominator) => denominator > 0 ? numerator / denominator : 0;
    const pcrOI = ratio(totals.putOI, totals.callOI);
    const pcrVolume = ratio(totals.putVolume, totals.callVolume);
    const pcrATM = ratio(totals.atmPutVolume, totals.atmCallVolume);
    const pcr = {
      pcrOI: pcrOI.toFixed(3),
      pcrVolume: pcrVolume.toFixed(3),
      pcrATM: pcrATM.toFixed(3),
      totalCallOI: totals.callOI,
      totalPutOI: totals.putOI,
      totalCallVolume: totals.callVolume,
      totalPutVolume: totals.putVolume,
      interpretation: optionAnalyzer.interpretPCR(pcrOI, pcrVolume)
    };
    const maxPain = optionAnalyzer.calculateMaxPain(strikes);
    const analyticsAt = Date.now();
    const hl = _hlRecord[inst];

    return {
      spotPrice: +spot.toFixed(2),
      atmStrike,
      instrument: inst,
      source: chain?.source || DATA_SOURCE,
      timestamp: new Date(analyticsAt).toISOString(),
      ts: analyticsAt,
      highLow: hl ? {
        high: +Number(hl.high || 0).toFixed(2),
        highAt: hl.highAt || null,
        low: +Number(hl.low || 0).toFixed(2),
        lowAt: hl.lowAt || null
      } : null,
      pcr,
      maxPain,
      strikes,
      sequence: ['INDEX_HIGH_LOW', 'OPTION_HIGH_LOW_AND_LTP', 'OI_GREEKS_PCR_MAX_PAIN'],
      timings: {
        indexHighLowMs: indexHlAt - startedAt,
        optionHighLowAndLtpMs: optionHlAt - indexHlAt,
        analyticsMs: analyticsAt - optionHlAt,
        totalMs: analyticsAt - startedAt
      }
    };
  })();

  _optionSnapshotCache.set(inst, { ...(cached || {}), promise });
  try {
    const data = await promise;
    _optionSnapshotCache.set(inst, { data, at: Date.now(), promise: null });
    return data;
  } catch (error) {
    _optionSnapshotCache.delete(inst);
    throw error;
  }
}

app.get("/api/options/snapshot", async (req, res) => {
  try {
    res.json(await _buildOptionSnapshot(req.query.instrument || 'NIFTY'));
  } catch (error) {
    _optionSnapshotError(res, error);
  }
});

// Backward-compatible chain endpoint, now backed by the ordered live snapshot.
app.get("/api/options/chain", async (req, res) => {
  try {
    res.json(await _buildOptionSnapshot(req.query.instrument || 'NIFTY'));
  } catch (error) {
    _optionSnapshotError(res, error);
  }
});

// Get PCR (Put Call Ratio)
app.get("/api/options/pcr", async (req, res) => {
  try {
    const snapshot = await _buildOptionSnapshot(req.query.instrument || 'NIFTY');
    res.json({ ...snapshot.pcr, source: snapshot.source, timestamp: snapshot.timestamp });
  } catch (error) {
    _optionSnapshotError(res, error);
  }
});

// Get Max Pain
app.get("/api/options/maxpain", async (req, res) => {
  try {
    const snapshot = await _buildOptionSnapshot(req.query.instrument || 'NIFTY');
    res.json({ ...snapshot.maxPain, source: snapshot.source, timestamp: snapshot.timestamp });
  } catch (error) {
    _optionSnapshotError(res, error);
  }
});

// Get OI Analysis
app.get("/api/options/oi-analysis", async (req, res) => {
  try {
    const price = await getLivePrice();
    optionAnalyzer.initialize(price, 20);
    res.json(optionAnalyzer.analyzeOIBuildup());
  } catch (error) {
    res.status(500).json({ error: "Failed to analyze OI" });
  }
});

// ===== Greeks Matrix: ATM-2..ATM+2 with CE/PE greeks + open position greeks =====
app.get("/api/options/greeks-matrix", async (req, res) => {
  try {
    const inst = (req.query.inst || 'SENSEX').toUpperCase();
    const meta = getInstrumentMeta(inst);
    const spot = await meta.priceGetter();
    const interval = meta.step;
    const atm = Math.round(spot / interval) * interval;

    optionAnalyzer.initialize(spot, 20);
    const chain = optionAnalyzer.optionChain;

    const offsets = [-2, -1, 0, 1, 2];
    const rows = offsets.map(off => {
      const strike = atm + off * interval;
      const row = chain.find(r => r.strike === strike);
      if (!row) return { strike, offset: off, ce: null, pe: null };
      const pick = (leg) => leg ? {
        ltp:   parseFloat(leg.ltp),
        delta: parseFloat(leg.delta),
        gamma: parseFloat(leg.gamma),
        theta: parseFloat(leg.theta),
        vega:  parseFloat(leg.vega),
        iv:    parseFloat(leg.iv)
      } : null;
      return {
        strike,
        offset: off,
        isATM: strike === atm,
        ce: pick(row.ce),
        pe: pick(row.pe)
      };
    });

    // Position greeks (if an open position matches this instrument)
    const pos = inst === 'NIFTY' ? niftyOpenPosition : openPosition;
    let position = null;
    if (pos) {
      const posRow = chain.find(r => r.strike == pos.strike);
      const leg = posRow ? (pos.type === 'CALL' || pos.type === 'CE' ? posRow.ce : posRow.pe) : null;
      if (leg) {
        const qty = pos.quantity || (pos.lots || 0) * (inst === 'NIFTY' ? 65 : 20);
        position = {
          strike: pos.strike,
          type:   pos.type,
          qty,
          delta: +(parseFloat(leg.delta) * qty).toFixed(2),
          gamma: +(parseFloat(leg.gamma) * qty).toFixed(4),
          theta: +(parseFloat(leg.theta) * qty).toFixed(2),
          vega:  +(parseFloat(leg.vega)  * qty).toFixed(2),
          iv:    +parseFloat(leg.iv).toFixed(2)
        };
      }
    }

    // ATM summary
    const atmRow = rows.find(r => r.isATM);
    const summary = atmRow ? {
      atmStrike: atm,
      atmIV:     atmRow.ce && atmRow.pe ? +((atmRow.ce.iv + atmRow.pe.iv) / 2).toFixed(2) : null,
      atmCeDelta: atmRow.ce ? atmRow.ce.delta : null,
      atmPeDelta: atmRow.pe ? atmRow.pe.delta : null,
      atmGamma:  atmRow.ce ? atmRow.ce.gamma : null,
      atmThetaTotal: atmRow.ce && atmRow.pe ? +(atmRow.ce.theta + atmRow.pe.theta).toFixed(2) : null
    } : null;

    res.json({ inst, spot: +spot.toFixed(2), atm, interval, rows, position, summary, ts: Date.now() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to build greeks matrix', detail: err.message });
  }
});

// Get Greeks for specific strike
app.get("/api/options/greeks", async (req, res) => {
  try {
    const { strike, type } = req.query;
    const spotPrice = await getLivePrice();
    optionAnalyzer.initialize(spotPrice, 20);

    const strikeData = optionAnalyzer.optionChain.find(s => s.strike == strike);
    if (!strikeData) return res.status(404).json({ error: "Strike not found" });

    const greeks = type === 'CE' ? strikeData.ce : strikeData.pe;
    res.json({
      strike: parseInt(strike),
      type,
      spotPrice: spotPrice.toFixed(2),
      greeks: { delta: greeks.delta, gamma: greeks.gamma, theta: greeks.theta, vega: greeks.vega, iv: greeks.iv }
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to calculate Greeks" });
  }
});

// Get IV Analysis
app.get("/api/options/iv-analysis", async (req, res) => {
  try {
    const price = await getLivePrice();
    optionAnalyzer.initialize(price, 20);
    res.json(optionAnalyzer.getIVSummary());
  } catch (error) {
    res.status(500).json({ error: "Failed to analyze IV" });
  }
});

// Get Payoff Calculator
app.get("/api/options/payoff", async (req, res) => {
  try {
    const { strategy, strikes } = req.query;
    const spotPrice = await getLivePrice();
    const strikeArray = strikes ? strikes.split(',').map(Number) : [spotPrice, 50];
    res.json(optionAnalyzer.calculatePayoff(strategy || 'LONG_CE', spotPrice, strikeArray));
  } catch (error) {
    res.status(500).json({ error: "Failed to calculate payoff" });
  }
});

// Get Complete Analytics — real Sensibull chain + live price
app.get("/api/options/analytics", async (req, res) => {
  try {
    const price = await getLivePrice();
    // Try real Sensibull data first, fall back to simulated
    try {
      const realChain = await getChainAroundATM(price, null, 10);
      optionAnalyzer.initializeFromRealData(realChain, price);
      const analytics = optionAnalyzer.getCompleteAnalytics();
      const optionChain = (analytics.optionChain || []).map(row => ({
        ...row,
        ce: _withLegHistory('SENSEX', row.strike, row.ce, 'CE'),
        pe: _withLegHistory('SENSEX', row.strike, row.pe, 'PE')
      }));
      res.json({ ...analytics, optionChain, livePrice: price, priceAt: new Date().toISOString(),
                 dataSource: 'Sensibull/BFO', expiry: realChain.expiry,
                 lastUpdated: realChain.lastUpdated });
    } catch (sbErr) {
      // Sensibull unavailable — fall back to simulated chain
      optionAnalyzer.initialize(price, 20);
      const analytics = optionAnalyzer.getCompleteAnalytics();
      const optionChain = (analytics.optionChain || []).map(row => ({
        ...row,
        ce: _withLegHistory('SENSEX', row.strike, row.ce, 'CE'),
        pe: _withLegHistory('SENSEX', row.strike, row.pe, 'PE')
      }));
      res.json({ ...analytics, optionChain, livePrice: price, priceAt: new Date().toISOString(),
                 dataSource: 'Simulated (Sensibull unavailable: ' + sbErr.message + ')' });
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// Get NIFTY Option Chain Analytics
app.get('/api/nifty/options/analytics', async (req, res) => {
  try {
    const price = await getLiveNiftyPrice();
    const chain = await live.getNiftyOptionChain(price);
    const atm   = Math.round(price / 50) * 50;
    const optionChain = chain.strikes.map(s => ({
      strike: s.strike,
      isATM:  s.strike === atm,
      itmCE:  s.strike < atm,
      itmPE:  s.strike > atm,
      ce: _withLegHistory('NIFTY', s.strike, { ltp: s.ce.ltp, oi: s.ce.oi, changeOI: s.ce.changeOI || 0,
            volume: s.ce.volume || 0, iv: s.ce.iv || 12,
            delta: s.strike < atm ? 0.85 : s.strike === atm ? 0.5 : 0.15 }, 'CE'),
      pe: _withLegHistory('NIFTY', s.strike, { ltp: s.pe.ltp, oi: s.pe.oi, changeOI: s.pe.changeOI || 0,
            volume: s.pe.volume || 0, iv: s.pe.iv || 12,
            delta: s.strike > atm ? -0.85 : s.strike === atm ? -0.5 : -0.15 }, 'PE')
    }));
    const totalCeOI = optionChain.reduce((s, r) => s + r.ce.oi, 0);
    const totalPeOI = optionChain.reduce((s, r) => s + r.pe.oi, 0);
    const pcr = totalCeOI > 0 ? +(totalPeOI / totalCeOI).toFixed(2) : 1;
    const pcrBias = pcr > 1.2 ? 'BULLISH' : pcr < 0.8 ? 'BEARISH' : 'SIDEWAYS';
    const maxPainStrike = optionChain.reduce((best, s) => {
      const pain = optionChain.reduce((t, r) =>
        t + Math.max(0, s.strike - r.strike) * r.ce.oi +
            Math.max(0, r.strike - s.strike) * r.pe.oi, 0);
      return (!best || pain < best.pain) ? { strike: s.strike, pain } : best;
    }, null);
    const avgIV = optionChain.length ? +(optionChain.reduce((s, r) => s + r.ce.iv + r.pe.iv, 0) / (optionChain.length * 2)).toFixed(1) : 12;
    res.json({
      spotPrice: price, atmStrike: atm, optionChain, livePrice: price,
      priceAt: new Date().toISOString(), dataSource: 'NIFTY/NSE',
      pcr: { pcr, interpretation: { bias: pcrBias } },
      maxPain: { maxPain: maxPainStrike?.strike || atm, interpretation: 'Max Pain' },
      ivSummary: { overallIV: avgIV, ceAvgIV: avgIV, peAvgIV: avgIV, ivPercentile: 50 }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch NIFTY analytics', detail: err.message });
  }
});

app.get('/api/banknifty/options/analytics', async (req, res) => {
  try {
    const price = await getLiveBankNiftyPrice();
    const chain = await live.getBankNiftyOptionChain(price);
    const atm   = Math.round(price / 100) * 100;
    const optionChain = chain.strikes.map(s => ({
      strike: s.strike,
      isATM:  s.strike === atm,
      itmCE:  s.strike < atm,
      itmPE:  s.strike > atm,
      ce: _withLegHistory('BANKNIFTY', s.strike, { ltp: s.ce.ltp, oi: s.ce.oi, changeOI: s.ce.changeOI || 0,
            volume: s.ce.volume || 0, iv: s.ce.iv || 12,
            delta: s.strike < atm ? 0.85 : s.strike === atm ? 0.5 : 0.15 }, 'CE'),
      pe: _withLegHistory('BANKNIFTY', s.strike, { ltp: s.pe.ltp, oi: s.pe.oi, changeOI: s.pe.changeOI || 0,
            volume: s.pe.volume || 0, iv: s.pe.iv || 12,
            delta: s.strike > atm ? -0.85 : s.strike === atm ? -0.5 : -0.15 }, 'PE')
    }));
    const totalCeOI = optionChain.reduce((s, r) => s + (r.ce?.oi || 0), 0);
    const totalPeOI = optionChain.reduce((s, r) => s + (r.pe?.oi || 0), 0);
    const pcr = totalCeOI > 0 ? +(totalPeOI / totalCeOI).toFixed(2) : 1;
    const pcrBias = pcr > 1.2 ? 'BULLISH' : pcr < 0.8 ? 'BEARISH' : 'SIDEWAYS';
    const maxPainStrike = optionChain.reduce((best, s) => {
      const pain = optionChain.reduce((t, r) =>
        t + Math.max(0, s.strike - r.strike) * (r.ce?.oi || 0) +
            Math.max(0, r.strike - s.strike) * (r.pe?.oi || 0), 0);
      return (!best || pain < best.pain) ? { strike: s.strike, pain } : best;
    }, null);
    const avgIV = optionChain.length ? +(optionChain.reduce((s, r) => s + (r.ce?.iv || 0) + (r.pe?.iv || 0), 0) / (optionChain.length * 2)).toFixed(1) : 12;
    res.json({
      spotPrice: price, atmStrike: atm, optionChain, livePrice: price,
      priceAt: new Date().toISOString(), dataSource: 'BANKNIFTY/NSE',
      pcr: { pcr, interpretation: { bias: pcrBias } },
      maxPain: { maxPain: maxPainStrike?.strike || atm, interpretation: 'Max Pain' },
      ivSummary: { overallIV: avgIV, ceAvgIV: avgIV, peAvgIV: avgIV, ivPercentile: 50 }
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch BANKNIFTY analytics', detail: err.message });
  }
});

// Get Top Activity (Volume & OI)
app.get("/api/options/top-activity", async (req, res) => {
  try {
    const price = await getLivePrice();
    optionAnalyzer.initialize(price, 20);
    res.json(optionAnalyzer.getTopActivity());
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch activity" });
  }
});

// Get Gamma Blast Alert with Greek Point Ranking
app.get("/api/options/gamma-blast", async (req, res) => {
  try {
    const price = await getLivePrice();
    let realChain = null;
    try {
      realChain = await getChainAroundATM(price, null, 10);
      optionAnalyzer.initializeFromRealData(realChain, price);
    } catch (_) {
      optionAnalyzer.initialize(price, 20);
    }
    const blast = optionAnalyzer.getGammaBlastAlert({ spotPrice: price });

    // Optional AI layer (Claude) — only runs when CLAUDE_AI_ENABLED=true and the
    // caller asks for it (?ai=1). The rule-based `blast` stays the source of
    // truth; AI is advisory and never blocks the response on timeout.
    if (req.query.ai === '1' && realChain?.strikes?.length) {
      // Garbage-in guard: don't ask the AI to analyse a degraded/stale feed.
      if (_dataHealth.status === 'DOWN') {
        blast.ai = null; blast.aiSkipped = 'data source DOWN — AI gated';
      } else try {
        const totals = realChain.strikes.reduce((s, r) => {
          s.callOI += Number(r.ce?.oi || 0); s.putOI += Number(r.pe?.oi || 0); return s;
        }, { callOI: 0, putOI: 0 });
        const pcr = totals.callOI > 0 ? (totals.putOI / totals.callOI).toFixed(3) : 'N/A';
        const optionChainData = realChain.strikes.map(r => ({
          strike: r.strike,
          ceOI: Number(r.ce?.oi || 0), ceChgOI: Number(r.ce?.changeOI || 0), ceLtp: Number(r.ce?.ltp || 0),
          peOI: Number(r.pe?.oi || 0), peChgOI: Number(r.pe?.changeOI || 0), peLtp: Number(r.pe?.ltp || 0)
        }));
        blast.ai = await claudeGammaBlast({
          indexName: 'SENSEX',
          currentTime: new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }),
          spotPrice: +price.toFixed(2),
          vwap: vwap || null,
          pcr,
          optionChainData
        });
        // Log the advisory so its real hit-rate can be measured over time.
        if (blast.ai && blast.ai.setup) {
          const dir = /bull/i.test(blast.ai.setup) ? 1 : /bear/i.test(blast.ai.setup) ? -1 : 0;
          aiLogger.logSignal({ type: 'gamma', inst: 'SENSEX', spot: +price.toFixed(2), dir,
            conf: blast.ai.probability, valid: blast.ai.valid, payload: { setup: blast.ai.setup, targetStrike: blast.ai.targetStrike } });
        }
      } catch (_) { blast.ai = null; }
    }
    res.json(blast);
  } catch (error) {
    res.status(500).json({ error: "Failed to compute gamma blast", detail: error.message });
  }
});

// Get Database Stats
app.get("/api/database/stats", (req, res) => {
  try {
    const stats = database.getTradingStats();
    const dates = database.getAvailableDates();
    const size = database.getSize();

    res.json({
      stats,
      availableDates: dates.length,
      dateRange: {
        from: dates[dates.length - 1] || 'N/A',
        to: dates[0] || 'N/A'
      },
      size
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch database stats" });
  }
});

// ==================== PAPER POSITION TRACKER — SENSEX ====================
let openPosition = null;
let closedPositions = [];

// ==================== PAPER POSITION TRACKER — NIFTY ====================
let niftyOpenPosition = null;
let niftyClosedPositions = [];

// ==================== PAPER POSITION TRACKER — AFTERNOON ====================
let afternoonOpenPosition = null;
let afternoonClosedPositions = [];
let niftyAfternoonOpenPosition = null;
let niftyAfternoonClosedPositions = [];

const SL_PCT       = parseFloat(process.env.STOP_LOSS_PERCENT || 35) / 100;    // 0.35
const TRAIL_MULT   = parseFloat(process.env.TRAIL_AFTER_MULTIPLE || 1.5);       // 1.5
const TRAIL_LOCK   = parseFloat(process.env.TRAIL_LOCK_PERCENT || 50) / 100;    // 0.50
const TARGET_MULT  = parseFloat(process.env.TARGET_PERCENT || 150) / 100 + 1;  // 2.5x (150% gain)

function updateAutomaticMovingStop(position, currentPrice, opts = {}) {
  const entry = Number(position.entryPrice || 0);
  const price = Number(currentPrice || position.currentPrice || entry);
  if (!entry || !price) {
    return { mult: 0, pnlPct: '0.0', status: position.status || 'OPEN' };
  }

  const session = opts.session || getMarketSession();
  const active = opts.active ?? session.inMarketHours;
  const slPct = Number(opts.stopLossPct ?? parseFloat(process.env.STOP_LOSS_PERCENT || 50)) / 100;
  const trailMult = Number(opts.trailMult ?? parseFloat(process.env.TRAIL_AFTER_MULTIPLE || 2));
  const trailLockPct = Number(opts.trailLockPct ?? parseFloat(process.env.TRAIL_LOCK_PERCENT || 50)) / 100;
  const targetMult = Number(opts.targetMult ?? (parseFloat(process.env.TARGET_PERCENT || 150) / 100 + 1));

  if (!position.sl) position.sl = entry * (1 - slPct);
  position.trailAt = entry * trailMult;
  position.peakPrice = Number(position.peakPrice || entry);

  if (active) {
    position.peakPrice = Math.max(position.peakPrice, price);

    if (!position.trailLocked && position.peakPrice >= position.trailAt) {
      position.trailLocked = true;
      console.log(`[position] AUTO MOVING STOP ON @ ${position.peakPrice.toFixed(1)}`);
    }

    if (position.trailLocked) {
      const lockedGain = (position.peakPrice - entry) * trailLockPct;
      const nextFloor = entry + lockedGain;
      if (!position.lockedFloor || nextFloor > position.lockedFloor) {
        position.lockedFloor = nextFloor;
        console.log(`[position] MOVING STOP -> ${position.lockedFloor.toFixed(1)}`);
      }
    }
  }

  position.currentPrice = price;
  position.movingStop = Math.max(position.sl, Number(position.lockedFloor || 0));
  position.autoMovingStop = true;
  position.autoMovingStopActive = !!active;
  position.marketStatus = session.status;
  position.stopDistance = +(price - position.movingStop).toFixed(2);
  position.stopDistancePct = position.movingStop > 0
    ? +(((price / position.movingStop) - 1) * 100).toFixed(2)
    : 0;

  const mult = price / entry;
  const pnlPct = ((mult - 1) * 100).toFixed(1);
  let status = 'OPEN';
  if (!active) status = session.status;
  else if (price <= position.movingStop) status = position.trailLocked ? 'TRAIL_EXIT' : 'SL_HIT';
  else if (mult >= targetMult) status = 'TARGET_HIT';
  else if (position.trailLocked) status = 'TRAIL_ACTIVE';
  position.status = status;

  return { mult, pnlPct, status };
}

// Enter paper position
app.post("/api/position/enter", (req, res) => {
  const { type, strike, entryPrice } = req.body;
  if (!type || !strike || !entryPrice || entryPrice <= 0)
    return res.status(400).json({ error: "type, strike, entryPrice required" });
  if (openPosition)
    return res.status(409).json({ error: "Position already open — exit first" });

  const ep = parseFloat(entryPrice);
  openPosition = {
    type,            // 'CE' or 'PE'
    strike: parseInt(strike),
    entryPrice: ep,
    enteredAt: new Date().toISOString(),
    sl: ep * (1 - SL_PCT),
    trailAt: ep * TRAIL_MULT,
    trailLocked: false,
    lockedFloor: null,
    peakPrice: ep,
    movingStop: ep * (1 - SL_PCT),
    autoMovingStop: true,
    autoMovingStopActive: getMarketSession().inMarketHours,
    currentPrice: ep,
    status: 'OPEN'
  };
  console.log(`[position] ENTERED ${type} ${strike} @ ${ep}`);
  res.json({ ok: true, position: openPosition });
});

// Get current position with live P&L
app.get("/api/position", async (req, res) => {
  if (!openPosition) return res.json({ open: false, closed: closedPositions.slice(-5) });

  // Try to get current option price from Sensibull chain
  let currentPrice = openPosition.currentPrice;
  try {
    const spot = await getLivePrice();
    const chain = await getChainAroundATM(spot, null, 15);
    const row = chain.strikes.find(s => Number(s.strike) === Number(openPosition.strike));
    if (row) {
      const ltp = openPosition.type === 'CE' ? row.ce.ltp : row.pe.ltp;
      if (ltp > 0) currentPrice = ltp;
    }
  } catch (_) { /* use last known */ }

  const session = getMarketSession();
  const { mult, pnlPct, status } = updateAutomaticMovingStop(openPosition, currentPrice, {
    stopLossPct: SL_PCT * 100,
    trailMult: TRAIL_MULT,
    trailLockPct: TRAIL_LOCK * 100,
    targetMult: TARGET_MULT,
    session
  });

  res.json({
    open: true,
    position: openPosition,
    currentPrice,
    mult: mult.toFixed(3),
    pnlPct,
    status,
    target: +(openPosition.entryPrice * TARGET_MULT).toFixed(2),
    trailStop: +(openPosition.movingStop || 0).toFixed(2),
    trailLocked: !!openPosition.trailLocked,
    marketOpen: session.inMarketHours,
    marketStatus: session.status
  });
});

// Manual price update (for paper trades where you enter live option price)
app.patch("/api/position/price", (req, res) => {
  if (!openPosition) return res.status(404).json({ error: "No open position" });
  const p = parseFloat(req.body.price);
  if (!p || p <= 0) return res.status(400).json({ error: "valid price required" });
  const session = getMarketSession();
  const trail = updateAutomaticMovingStop(openPosition, p, {
    stopLossPct: SL_PCT * 100,
    trailMult: TRAIL_MULT,
    trailLockPct: TRAIL_LOCK * 100,
    targetMult: TARGET_MULT,
    session
  });
  res.json({ ok: true, currentPrice: p, position: openPosition, status: trail.status, marketOpen: session.inMarketHours, marketStatus: session.status });
});

// Exit position
app.post("/api/position/exit", async (req, res) => {
  if (!openPosition) return res.status(404).json({ error: "No open position" });

  let exitPrice = parseFloat(req.body.exitPrice) || openPosition.currentPrice;
  const mult   = exitPrice / openPosition.entryPrice;
  const pnlPct = ((mult - 1) * 100).toFixed(1);

  const closed = {
    ...openPosition,
    exitPrice,
    exitAt: new Date().toISOString(),
    finalMult: mult.toFixed(3),
    finalPnlPct: pnlPct,
    exitReason: req.body.reason || 'MANUAL'
  };
  closedPositions.push(closed);
  openPosition = null;

  console.log(`[position] EXITED @ ${exitPrice} → ${mult.toFixed(2)}x (${pnlPct}%)`);

  // Claude-written Telegram narration for this exit (non-blocking)
  if (telegram?.enabled) {
    const evtType = closed.exitReason?.includes('SL') ? 'SL_HIT'
                  : closed.exitReason?.includes('TARGET') ? 'TARGET_HIT'
                  : closed.exitReason?.includes('TRAIL') ? 'TRAIL_LOCKED'
                  : 'EXIT';
    claudeTradeNarration(evtType, {
      instrument: 'SENSEX',
      signal:     closed.signal,
      strike:     closed.strike,
      premium:    closed.entryPrice,
      lots:       closed.lots,
      pnlAbs:     closed.finalPnlAbs,
      pnlPct:     closed.finalPnlPct,
      exitReason: closed.exitReason,
      confidence: closed.aiConfidence,
      orbHigh:    closed.orbHigh,
      orbLow:     closed.orbLow,
      vwap:       closed.vwap,
      tradeMode:  process.env.TRADE_MODE || 'paper'
    }).then(msg => {
      if (msg) telegram.sendAlert(evtType, msg).catch(() => {});
    }).catch(() => {});
  }

  res.json({ ok: true, trade: closed });
});


// ==================== P&L SUMMARY API ====================
app.get('/api/pnl', (req, res) => {
  const capital = parseFloat(process.env.CAPITAL_TOTAL || 500000);
  const annualTarget = 2400000; // ₹24L

  const todayStr = new Date().toDateString();
  const todayTrades = closedPositions.filter(p => new Date(p.exitAt).toDateString() === todayStr);

  const allTrades = closedPositions;
  const wins  = allTrades.filter(p => parseFloat(p.finalPnlPct) > 0).length;
  const totalPnlAbs = allTrades.reduce((s, p) => s + parseFloat(p.finalPnlAbs || 0), 0);
  const todayPnlAbs = todayTrades.reduce((s, p) => s + parseFloat(p.finalPnlAbs || 0), 0);

  res.json({
    capital,
    annualTarget,
    totalTrades:   allTrades.length,
    wins,
    winRate:       allTrades.length ? +(wins / allTrades.length * 100).toFixed(1) : 0,
    totalPnlAbs:   +totalPnlAbs.toFixed(0),
    totalPnlPct:   +(totalPnlAbs / capital * 100).toFixed(2),
    todayTrades:   todayTrades.length,
    todayPnlAbs:   +todayPnlAbs.toFixed(0),
    currentCapital: +(capital + totalPnlAbs).toFixed(0),
    targetProgress: +(totalPnlAbs / annualTarget * 100).toFixed(1),
    recentTrades:  closedPositions.slice(-10).reverse().map(p => ({
      signal:   p.signal,
      type:     p.type,
      strike:   p.strike,
      entry:    p.entryPrice,
      exit:     p.exitPrice,
      mult:     p.finalMult,
      pnlPct:   p.finalPnlPct,
      pnlAbs:   p.finalPnlAbs,
      reason:   p.exitReason,
      lots:     p.lots,
      exitAt:   p.exitAt
    }))
  });
});

// ==================== P&L SUMMARY — NIFTY ====================
app.get('/api/nifty/pnl', (req, res) => {
  const capital = parseFloat(process.env.CAPITAL_TOTAL || 500000);
  const annualTarget = 2400000;
  const todayStr = new Date().toDateString();
  const todayTrades = niftyClosedPositions.filter(p => new Date(p.exitAt).toDateString() === todayStr);
  const allTrades = niftyClosedPositions;
  const wins = allTrades.filter(p => parseFloat(p.finalPnlPct) > 0).length;
  const totalPnlAbs = allTrades.reduce((s, p) => s + parseFloat(p.finalPnlAbs || 0), 0);
  const todayPnlAbs = todayTrades.reduce((s, p) => s + parseFloat(p.finalPnlAbs || 0), 0);
  res.json({
    capital, annualTarget,
    totalTrades: allTrades.length, wins,
    winRate:       allTrades.length ? +(wins / allTrades.length * 100).toFixed(1) : 0,
    totalPnlAbs:   +totalPnlAbs.toFixed(0),
    totalPnlPct:   +(totalPnlAbs / capital * 100).toFixed(2),
    todayTrades:   todayTrades.length,
    todayPnlAbs:   +todayPnlAbs.toFixed(0),
    currentCapital: +(capital + totalPnlAbs).toFixed(0),
    targetProgress: +(totalPnlAbs / annualTarget * 100).toFixed(1),
    recentTrades:  niftyClosedPositions.slice(-10).reverse().map(p => ({
      signal: p.signal, type: p.type, strike: p.strike, entry: p.entryPrice,
      exit: p.exitPrice, mult: p.finalMult, pnlPct: p.finalPnlPct, pnlAbs: p.finalPnlAbs,
      reason: p.exitReason, lots: p.lots, exitAt: p.exitAt
    }))
  });
});

// ==================== NIFTY POSITION ENDPOINTS ====================
app.post('/api/nifty/position/enter', (req, res) => {
  const { type, strike, entryPrice } = req.body;
  if (!type || !strike || !entryPrice || entryPrice <= 0)
    return res.status(400).json({ error: 'type, strike, entryPrice required' });
  if (niftyOpenPosition) return res.status(409).json({ error: 'Position already open' });
  const ep = parseFloat(entryPrice);
  const SL_PCT = parseFloat(process.env.STOP_LOSS_PERCENT || 50) / 100;
  const TRAIL_MULT = parseFloat(process.env.TRAIL_AFTER_MULTIPLE || 2);
  // Mirror auto-engine sizing so manual entries also benefit from half-compound:
  // lots = max(1, floor(active × 5% / cost)), capped at 25.
  const lotSz = niftyEngine?.lotSize || 65;
  const activeCap = niftyEngine?.capital || parseFloat(process.env.CAPITAL_TOTAL || 100000);
  const riskPct  = niftyEngine?.riskPct  || (parseFloat(process.env.CAPITAL_PER_TRADE_PERCENT || 5) / 100);
  const lots     = Math.min(25, Math.max(1, Math.floor((activeCap * riskPct) / (ep * lotSz))));
  const qty      = lots * lotSz;
  const deployed = lots * ep * lotSz;
  niftyOpenPosition = { type, strike: parseInt(strike), entryPrice: ep, enteredAt: new Date().toISOString(),
    sl: ep * (1 - SL_PCT), trailAt: ep * TRAIL_MULT, trailLocked: false, lockedFloor: null,
    peakPrice: ep, movingStop: ep * (1 - SL_PCT), autoMovingStop: true,
    autoMovingStopActive: getMarketSession().inMarketHours,
    currentPrice: ep, status: 'OPEN', instrument: 'NIFTY',
    lots, quantity: qty, deployed, signal: type === 'CE' ? 'CALL' : 'PUT' };
  console.log(`[NIFTY] MANUAL ENTRY ${type} ${strike} @ ${ep} | ${lots} lots = ${qty} qty | deployed ₹${deployed.toFixed(0)}`);
  res.json({ ok: true, position: niftyOpenPosition });
});

app.get('/api/nifty/position', async (req, res) => {
  if (!niftyOpenPosition) return res.json({ open: false, closed: niftyClosedPositions.slice(-5) });
  let currentPrice = niftyOpenPosition.currentPrice;
  try {
    const spot = await getLiveNiftyPrice();
    const chain = await live.getNiftyOptionChain(spot);
    const row = chain.strikes.find(s => Number(s.strike) === Number(niftyOpenPosition.strike));
    if (row) {
      const ltp = niftyOpenPosition.type === 'CE' ? row.ce.ltp : row.pe.ltp;
      if (ltp > 0) currentPrice = ltp;
    }
  } catch (_) {}
  const TRAIL_MULT = parseFloat(process.env.TRAIL_AFTER_MULTIPLE || 2);
  const TRAIL_LOCK = parseFloat(process.env.TRAIL_LOCK_PERCENT || 50) / 100;
  const TARGET_MULT = parseFloat(process.env.TARGET_PERCENT || 150) / 100 + 1;
  const SL_PCT = parseFloat(process.env.STOP_LOSS_PERCENT || 50) / 100;
  const session = getMarketSession();
  const { mult, pnlPct, status } = updateAutomaticMovingStop(niftyOpenPosition, currentPrice, {
    stopLossPct: SL_PCT * 100,
    trailMult: TRAIL_MULT,
    trailLockPct: TRAIL_LOCK * 100,
    targetMult: TARGET_MULT,
    session
  });
  const target = niftyOpenPosition.entryPrice * TARGET_MULT;
  res.json({ open: true, position: niftyOpenPosition, currentPrice, mult: mult.toFixed(3), pnlPct, status,
    target: +target.toFixed(2), trailStop: +(niftyOpenPosition.movingStop || 0).toFixed(2), trailLocked: !!niftyOpenPosition.trailLocked,
    marketOpen: session.inMarketHours, marketStatus: session.status });
});

app.patch('/api/nifty/position/price', (req, res) => {
  if (!niftyOpenPosition) return res.status(404).json({ error: 'No open position' });
  const p = parseFloat(req.body.price);
  if (!p || p <= 0) return res.status(400).json({ error: 'valid price required' });
  const session = getMarketSession();
  const trail = updateAutomaticMovingStop(niftyOpenPosition, p, { session });
  res.json({ ok: true, currentPrice: p, position: niftyOpenPosition, status: trail.status, marketOpen: session.inMarketHours, marketStatus: session.status });
});

app.post('/api/nifty/position/exit', (req, res) => {
  if (!niftyOpenPosition) return res.status(404).json({ error: 'No open position' });
  const exitPrice = parseFloat(req.body.exitPrice) || niftyOpenPosition.currentPrice;
  const mult = exitPrice / niftyOpenPosition.entryPrice;
  const deployed = niftyOpenPosition.deployed || (niftyOpenPosition.lots * niftyOpenPosition.entryPrice * (niftyEngine?.lotSize || 65)) || 0;
  const pnlAbs = (mult - 1) * deployed;
  const closed = { ...niftyOpenPosition, exitPrice, exitAt: new Date().toISOString(),
    finalMult: mult.toFixed(3), finalPnlPct: ((mult - 1) * 100).toFixed(1),
    finalPnlAbs: pnlAbs.toFixed(0), exitReason: req.body.reason || 'MANUAL' };
  niftyClosedPositions.push(closed);
  niftyOpenPosition = null;
  // Apply half-compound to engine capital so manual exits also affect future sizing.
  if (niftyEngine?.recordTradeResult && isFinite(pnlAbs)) {
    niftyEngine.recordTradeResult({ pnl: pnlAbs });
  }
  res.json({ ok: true, trade: closed });
});

// ==================== EXECUTION ENGINE — SENSEX ====================
const engine = new ExecutionEngine({
  live,
  getSignal:           () => currentSignal,
  getPrice:            () => _livePrice,
  getOrbLevels:        () => ({ high: orbHigh, low: orbLow }),
  getVwap:             () => vwap,
  getOpenPosition:     () => openPosition,
  setOpenPosition:     (p) => { openPosition = p; },
  pushClosedPosition:  (p) => { closedPositions.push(p); },
  incrementTrades:     () => { tradesToday++; },
  getTradesToday:      () => tradesToday,
  getMaxTrades:        () => parseInt(process.env.MAX_TRADES_PER_DAY || 2),
  lotSize:         20,
  strikeInterval:  100,
  atmRound:        100,
  exchangeSegment: 'BSE_FNO',
  instrumentName:  'SENSEX'
});
engine._getDailyPnl = () => {
  const todayStr = new Date().toDateString();
  return closedPositions
    .filter(p => new Date(p.exitAt).toDateString() === todayStr)
    .reduce((s, p) => s + parseFloat(p.finalPnlAbs || 0), 0);
};
// Trend gate — engine refuses entries that contradict H/L trend (see execution-engine.js).
engine.setTrendProvider(() => _computeTrendFromHL('SENSEX',
  prices.at?.(-1) ?? null, orbHigh, orbLow, vwap));
engine.restoreEquity();

// Engine control endpoints — SENSEX
app.post('/api/engine/auto', (req, res) => {
  const { enabled } = req.body;
  engine.setAutoEnabled(!!enabled);
  res.json({ ok: true, autoEnabled: !!enabled });
});

app.post('/api/engine/mode', (req, res) => {
  const { mode } = req.body;
  engine.setTradeMode(mode);
  res.json({ ok: true, mode });
});

app.get('/api/engine/status', (req, res) => {
  res.json({ ...engine.status(), halt: engine.getHaltStatus() });
});

// ── Multi-confirmation strategy read-out (ported from the Pine F&O strategy) ──
// Computes all 5 core layers + sideways filter + ADX/Supertrend/HTF shields
// from the live price/volume snapshot series, for the dashboard panel.
// inst = nifty | sensex. Read-only: does NOT drive auto entries.
app.get('/api/multiconfirm/:inst(nifty|sensex)', (req, res) => {
  const inst = req.params.inst.toUpperCase();
  const closes  = inst === 'NIFTY' ? niftyPrices  : prices;
  const vols    = inst === 'NIFTY' ? niftyVolumes : volumes;
  const vwapVal = inst === 'NIFTY' ? niftyVwap    : vwap;
  if (!closes || closes.length < 52) {
    return res.json({ instrument: inst, signal: 'WAIT', reason: 'warming up (need ~52 ticks)', layers: {}, shields: {}, values: {} });
  }
  // Build a single-bar candle from the last few snapshots (server stores
  // price snapshots, not true OHLC). open = a few ticks back, h/l = window
  // extremes, close = latest — same approximation the AI signal path uses.
  const win = closes.slice(-5);
  const candle = {
    open:  win[0],
    high:  Math.max(...win),
    low:   Math.min(...win),
    close: closes[closes.length - 1]
  };
  // Higher-TF reference: a longer EMA of the same series stands in for the
  // 15-min EMA when we don't have a separate HTF feed here.
  const htfClose = closes.length >= 75
    ? (() => { const k = 2 / (75 + 1); let e = closes[0]; for (let i = 1; i < closes.length; i++) e = closes[i]*k + e*(1-k); return e; })()
    : null;
  const out = multiconfirm.evaluate({ closes, volumes: vols, candle, vwap: vwapVal, htfClose });
  res.json({ instrument: inst, ...out });
});

// ── Pine → JS strategy converter (agent-assisted, Claude API) ──
// Generate-then-review: writes an AI-converted strategy to ./generated-strategies/.
// It is NEVER required()'d or auto-enabled — a human must review + backtest first.
app.get('/api/pine/status', (_req, res) => {
  res.json({ configured: pineConverter.isConfigured(), generated: pineConverter.listGenerated() });
});

app.post('/api/pine/convert', async (req, res) => {
  const { pine, name } = req.body || {};
  if (!pineConverter.isConfigured()) {
    return res.json({ ok: false, error: 'ANTHROPIC_API_KEY not set in .env — Pine conversion disabled.' });
  }
  if (!pine || String(pine).trim().length < 40) {
    return res.json({ ok: false, error: 'Paste a Pine Script (too short / empty).' });
  }
  console.log(`[pine] converting "${name || 'pine-strategy'}" (${String(pine).length} chars)…`);
  const result = await pineConverter.convert(String(pine), name);
  if (result.ok) {
    console.log(`[pine] ✓ wrote ${result.file} (${result.bytes} bytes)`);
    result.warning = 'AI-generated + UNREVIEWED. Read the file, backtest it, and enable it deliberately. It is NOT auto-trading.';
  } else {
    console.warn(`[pine] ✗ ${result.error}`);
  }
  res.json(result);
});

// H/L break log with CE/PE premiums at each moment.
// Each entry: { t (epoch ms), p (spot price), dir ('HIGH'|'LOW'),
//   atmStrike, ce, pe, ceVol, peVol }
app.get('/api/:inst(nifty|sensex)/hl-log', (req, res) => {
  const inst = req.params.inst.toUpperCase();
  const rec = _hlRecord[inst];
  if (!rec) return res.status(404).json({ error: 'unknown instrument' });
  // Stale pattern → null. Fresh pattern (within window) → return it.
  const pattern = rec.pattern && (Date.now() - rec.pattern.detectedAt) <= PATTERN_WINDOW_MS
    ? rec.pattern : null;
  res.json({
    instrument: inst,
    date: rec.date,
    sessionHigh: rec.high, sessionLow: rec.low,
    highBreaks: rec.highPath.length,
    lowBreaks: rec.lowPath.length,
    chainLog: rec.chainLog || [],
    pattern
  });
});

// Emergency kill switch — disables auto-trading on ALL engines (morning + afternoon)
// atomically. Open positions are NOT closed (use position/exit for that).
// Used by the dashboard header "HALT ALL" button.
app.post('/api/engine/halt-all', (req, res) => {
  const before = {
    sensex: engine.autoEnabled,
    nifty:  niftyEngine.autoEnabled,
    sensexAfternoon: afternoonEngine?.autoEnabled ?? false,
    niftyAfternoon:  niftyAfternoonEngine?.autoEnabled ?? false
  };
  engine.setAutoEnabled(false);
  niftyEngine.setAutoEnabled(false);
  if (afternoonEngine) afternoonEngine.setAutoEnabled(false);
  if (niftyAfternoonEngine) niftyAfternoonEngine.setAutoEnabled(false);
  console.warn('[engine] 🛑 HALT-ALL triggered by operator — all engines paused (morning + afternoon)');
  res.json({
    ok: true,
    before,
    after: {
      sensex: engine.autoEnabled, nifty: niftyEngine.autoEnabled,
      sensexAfternoon: afternoonEngine?.autoEnabled ?? false,
      niftyAfternoon: niftyAfternoonEngine?.autoEnabled ?? false
    }
  });
});

// Manual reset of consecutive-loss halt. Operator action after reviewing
// what went wrong — clears _consecLosses and re-enables auto trading.
app.post('/api/engine/reset', (req, res) => {
  const inst = String(req.query.inst || 'SENSEX').toUpperCase();
  const target = inst === 'NIFTY' ? niftyEngine : engine;
  if (!target.resetHalt) return res.status(400).json({ error: 'engine has no resetHalt method' });
  const was = target.resetHalt();
  res.json({ ok: true, instrument: inst, was, halt: target.getHaltStatus() });
});

// ==================== EXECUTION ENGINE — NIFTY ====================
const niftyEngine = new ExecutionEngine({
  live,
  getSignal:           () => niftySignal,
  getPrice:            () => _niftyLivePrice,
  getOrbLevels:        () => ({ high: niftyOrbHigh, low: niftyOrbLow }),
  getVwap:             () => niftyVwap,
  getOpenPosition:     () => niftyOpenPosition,
  setOpenPosition:     (p) => { niftyOpenPosition = p; },
  pushClosedPosition:  (p) => { niftyClosedPositions.push(p); },
  incrementTrades:     () => { niftyTradesToday++; },
  getTradesToday:      () => niftyTradesToday,
  getMaxTrades:        () => parseInt(process.env.MAX_TRADES_PER_DAY || 2),
  lotSize:         65,
  strikeInterval:  50,
  atmRound:        50,
  exchangeSegment: 'NSE_FNO',
  instrumentName:  'NIFTY'
});
niftyEngine._getDailyPnl = () => {
  const todayStr = new Date().toDateString();
  return niftyClosedPositions
    .filter(p => new Date(p.exitAt).toDateString() === todayStr)
    .reduce((s, p) => s + parseFloat(p.finalPnlAbs || 0), 0);
};
niftyEngine.setTrendProvider(() => _computeTrendFromHL('NIFTY',
  niftyPrices.at?.(-1) ?? null, niftyOrbHigh, niftyOrbLow, niftyVwap));
niftyEngine.restoreEquity();

// Engine control endpoints — NIFTY
function amiEngineForInstrument(instrument) {
  const inst = String(instrument || 'NIFTY').toUpperCase();
  if (inst === 'SENSEX') return engine;
  if (inst === 'NIFTY') return niftyEngine;
  return null;
}

function updatePublicAmiSignal(signal) {
  const inst = String(signal.instrument || 'NIFTY').toUpperCase();
  const strike = signal.strike || '--';
  const target = signal.target || '--';
  if (inst === 'SENSEX') {
    currentSignal = signal.signal;
    confidence = signal.conf || 0;
    suggestedStrike = strike;
    targetMultiplier = target;
    return;
  }
  if (inst === 'NIFTY') {
    niftySignal = signal.signal;
    niftyConfidence = signal.conf || 0;
    niftySuggestedStrike = strike;
    niftyTargetMultiplier = target;
  }
}

async function executeAmiSignal(signal, { allowLive = false } = {}) {
  const inst = String(signal.instrument || 'NIFTY').toUpperCase();
  const eng = amiEngineForInstrument(inst);
  if (!eng) {
    return { ok: false, error: 'unsupported_instrument', instrument: inst };
  }

  const session = getMarketSession();
  const allowAfterHours = String(process.env.AMIBROKER_ALLOW_AFTER_HOURS || 'false').toLowerCase() === 'true';
  if (!session.inMarketHours && !allowAfterHours) {
    return { ok: false, error: session.status, instrument: inst };
  }

  updatePublicAmiSignal(signal);

  if (!eng.paperMode && !allowLive) {
    return { ok: false, error: 'live_blocked_by_AMIBROKER_ALLOW_LIVE', instrument: inst };
  }

  const result = await eng.forceEntry(signal.signal, { allowLive });
  return { instrument: inst, source: 'amibroker', ...result };
}

async function exitAmiPosition(signal, { allowLive = false } = {}) {
  const inst = String(signal.instrument || 'NIFTY').toUpperCase();
  const eng = amiEngineForInstrument(inst);
  if (!eng) {
    return { ok: false, error: 'unsupported_instrument', instrument: inst };
  }

  const pos = eng.getOpenPosition ? eng.getOpenPosition() : null;
  if (!pos) {
    return { ok: false, error: 'no_open_position', instrument: inst };
  }
  if (!eng.paperMode && !allowLive) {
    return { ok: false, error: 'live_exit_blocked_by_AMIBROKER_ALLOW_LIVE', instrument: inst };
  }
  if (typeof eng._exit !== 'function') {
    return { ok: false, error: 'exit_not_supported', instrument: inst };
  }

  const rawExitPrice = Number(signal.price) > 0
    ? Number(signal.price)
    : Number(pos.currentPrice || pos.entryPrice || 0);
  await eng._exit(pos, rawExitPrice, 'AMIBROKER_EXIT');
  return { ok: true, instrument: inst, source: 'amibroker', exitPrice: rawExitPrice };
}

app.post('/api/nifty/engine/auto', (req, res) => {
  const { enabled } = req.body;
  niftyEngine.setAutoEnabled(!!enabled);
  res.json({ ok: true, autoEnabled: !!enabled });
});

app.post('/api/nifty/engine/mode', (req, res) => {
  const { mode } = req.body;
  niftyEngine.setTradeMode(mode);
  res.json({ ok: true, mode });
});

app.get('/api/nifty/engine/status', (req, res) => {
  res.json({ ...niftyEngine.status(), halt: niftyEngine.getHaltStatus() });
});

// ==================== AFTERNOON ENGINE — SENSEX ====================
const afternoonEngine = new AfternoonEngine({
  live,
  getPrice:            () => _livePrice,
  getOpenPosition:     () => afternoonOpenPosition,
  setOpenPosition:     (p) => { afternoonOpenPosition = p; },
  pushClosedPosition:  (p) => { afternoonClosedPositions.push(p); },
  getGammaBlast:       () => {
    try {
      optionAnalyzer.initialize(_livePrice, 20);
      return optionAnalyzer.getGammaBlastAlert({ spotPrice: _livePrice });
    } catch (_) { return null; }
  },
  getReversals:        () => (_reversalLog.SENSEX?.events || []),
  getMaxPain:          () => {
    try { return optionAnalyzer.calculateMaxPain ? { maxPainStrike: optionAnalyzer._lastMaxPain || 0 } : null; }
    catch (_) { return null; }
  },
  getEmaStack:         () => _emaCache.SENSEX,
  getPattern:          () => _hlRecord.SENSEX?.pattern || null,
  getMorningPnl:       () => {
    const todayStr = new Date().toDateString();
    return closedPositions
      .filter(p => new Date(p.exitAt).toDateString() === todayStr)
      .reduce((s, p) => s + parseFloat(p.finalPnlAbs || 0), 0);
  },
  lotSize:         20,
  strikeInterval:  100,
  atmRound:        100,
  exchangeSegment: 'BSE_FNO',
  instrumentName:  'SENSEX'
});
afternoonEngine._getDailyPnl = () => {
  const todayStr = new Date().toDateString();
  return afternoonClosedPositions
    .filter(p => new Date(p.exitAt).toDateString() === todayStr)
    .reduce((s, p) => s + parseFloat(p.finalPnlAbs || 0), 0);
};
afternoonEngine.restoreEquity();

// Telegram alerts for afternoon trades — tagged [🌅 AFTERNOON]
afternoonEngine.onTradeEvent = (event, data) => {
  if (!telegram?.enabled) return;
  const tag = '🌅 AFTERNOON';
  if (event === 'ENTRY') {
    telegram.sendAlert(`[${tag}] ENTRY`,
      `${data.signal} ${data.strike}${data.type} @ ₹${data.quotedEntry?.toFixed(1) || '?'}\n` +
      `${data.lots} lot(s) | Deployed ₹${data.deployed?.toFixed(0) || '?'}\n` +
      `Score: ${data.score || '?'}/100 | SL ₹${data.sl?.toFixed(1) || '?'}\n` +
      `Mode: ${data.paperMode ? 'PAPER' : 'LIVE'}`
    ).catch(() => {});
  } else if (event === 'EXIT') {
    const emoji = parseFloat(data.finalPnlAbs || 0) >= 0 ? '✅' : '❌';
    telegram.sendAlert(`[${tag}] EXIT ${emoji}`,
      `${data.signal} ${data.strike}${data.type}\n` +
      `${data.exitReason} | ${data.finalMult}x | ${data.finalPnlPct}%\n` +
      `P&L: ₹${data.finalPnlAbs}`
    ).catch(() => {});
  }
};

// ==================== AFTERNOON ENGINE — NIFTY ====================
const niftyAfternoonEngine = new AfternoonEngine({
  live,
  getPrice:            () => _niftyLivePrice,
  getOpenPosition:     () => niftyAfternoonOpenPosition,
  setOpenPosition:     (p) => { niftyAfternoonOpenPosition = p; },
  pushClosedPosition:  (p) => { niftyAfternoonClosedPositions.push(p); },
  getGammaBlast:       () => {
    try {
      const analyzer = new OptionAnalyzer();
      analyzer.initialize(_niftyLivePrice, 20);
      return analyzer.getGammaBlastAlert({ spotPrice: _niftyLivePrice });
    } catch (_) { return null; }
  },
  getReversals:        () => (_reversalLog.NIFTY?.events || []),
  getMaxPain:          () => null, // NIFTY max pain TBD
  getEmaStack:         () => _emaCache.NIFTY,
  getPattern:          () => _hlRecord.NIFTY?.pattern || null,
  getMorningPnl:       () => {
    const todayStr = new Date().toDateString();
    return niftyClosedPositions
      .filter(p => new Date(p.exitAt).toDateString() === todayStr)
      .reduce((s, p) => s + parseFloat(p.finalPnlAbs || 0), 0);
  },
  lotSize:         65,
  strikeInterval:  50,
  atmRound:        50,
  exchangeSegment: 'NSE_FNO',
  instrumentName:  'NIFTY'
});
niftyAfternoonEngine._getDailyPnl = () => {
  const todayStr = new Date().toDateString();
  return niftyAfternoonClosedPositions
    .filter(p => new Date(p.exitAt).toDateString() === todayStr)
    .reduce((s, p) => s + parseFloat(p.finalPnlAbs || 0), 0);
};
niftyAfternoonEngine.restoreEquity();

// Telegram alerts for NIFTY afternoon trades
niftyAfternoonEngine.onTradeEvent = (event, data) => {
  if (!telegram?.enabled) return;
  const tag = '🌅 NIFTY AFT';
  if (event === 'ENTRY') {
    telegram.sendAlert(`[${tag}] ENTRY`,
      `${data.signal} ${data.strike}${data.type} @ ₹${data.quotedEntry?.toFixed(1) || '?'}\n` +
      `${data.lots} lot(s) | Score: ${data.score || '?'}/100\n` +
      `Mode: ${data.paperMode ? 'PAPER' : 'LIVE'}`
    ).catch(() => {});
  } else if (event === 'EXIT') {
    const emoji = parseFloat(data.finalPnlAbs || 0) >= 0 ? '✅' : '❌';
    telegram.sendAlert(`[${tag}] EXIT ${emoji}`,
      `${data.signal} ${data.strike}${data.type}\n` +
      `${data.exitReason} | ${data.finalMult}x | P&L: ₹${data.finalPnlAbs}`
    ).catch(() => {});
  }
};

// ==================== BOUNCE ENGINE (paper, experimental) ====================
// buy-on-bounce / sell-on-target. Validated config: bounce 5% / target 30% / SL 15%
// (only profitable variant in single-day backtest). Off by default.
const bounceEngine = new BounceEngine();
bounceEngine.onTrade = (event, d) => {
  console.log(`[bounce] ${event} ${d.inst} ${d.strike}${d.type} @ ${d.entry || d.exit}${d.pnlPct != null ? ` | ${d.reason} ${d.pnlPct}%` : ''}`);
  if (telegram?.enabled) {
    if (event === 'BUY') telegram.sendAlert('🔵 Bounce BUY', `${d.inst} ${d.strike}${d.type} @ ₹${d.entry}`).catch(() => {});
    else telegram.sendAlert(d.pnlPct >= 0 ? '✅ Bounce SELL' : '❌ Bounce SELL', `${d.inst} ${d.strike}${d.type} ${d.reason} ${d.pnlPct}% (₹${d.entry}→₹${d.exit})`).catch(() => {});
  }
};
app.get('/api/bounce/status', (req, res) => res.json(bounceEngine.status()));
app.post('/api/bounce/enable', (req, res) => { bounceEngine.enabled = req.body?.enabled !== false; res.json({ ok: true, enabled: bounceEngine.enabled }); });

// ==================== STRANGLE ENGINE (premium selling, PAPER) ====================
// Validated SHORT_STRANGLE from bt-strategies.js: 89% win / +₹53k / 4.3% DD on
// 120 days real bhavcopy. PAPER-only; off by default (STRANGLE_ENGINE_ENABLED).
const strangleEngine = new StrangleEngine();
strangleEngine.onTrade = (event, d) => {
  if (event === 'SELL_OPEN') {
    console.log(`[strangle] OPEN ${d.structure} ${d.inst} ${d.pe.strike}PE/${d.ce.strike}CE credit ₹${d.credit}${d.maxLoss ? ` maxLoss ₹${d.maxLoss}` : ''} (exp ${d.expiry})`);
    if (telegram?.enabled) telegram.sendAlert(`🟣 ${d.structure} OPEN`, `${d.inst} ${d.pe.strike}PE + ${d.ce.strike}CE\nCredit ₹${d.credit}${d.maxLoss ? ` · maxLoss ₹${d.maxLoss}` : ''}`).catch(() => {});
  } else if (event === 'ADJUST') {
    console.log(`[strangle] ⚠️ ADJUST ${d.inst} ${d.tested} tested @ ${d.mult}x — ${d.suggestion}`);
    if (telegram?.enabled) telegram.sendAlert('⚠️ Strangle ADJUST', `${d.inst} ${d.tested} side tested @ ${d.mult}x\n${d.suggestion}`).catch(() => {});
  } else {
    console.log(`[strangle] CLOSE ${d.inst} ${d.reason} ₹${d.pnlAbs} (${d.pnlPct}% of credit)`);
    if (telegram?.enabled) telegram.sendAlert(d.pnlAbs >= 0 ? '✅ Strangle CLOSE' : '❌ Strangle CLOSE', `${d.inst} ${d.reason}\nP&L ₹${d.pnlAbs} (${d.pnlPct}%)`).catch(() => {});
  }
};
app.get('/api/strangle/status', (req, res) => res.json(strangleEngine.status()));
app.post('/api/strangle/enable', (req, res) => { strangleEngine.enabled = req.body?.enabled !== false; res.json({ ok: true, enabled: strangleEngine.enabled }); });

// ==================== AFTERNOON ENGINE ENDPOINTS ====================
app.get('/api/afternoon/status', (req, res) => {
  const inst = String(req.query.inst || 'SENSEX').toUpperCase();
  const eng = inst === 'NIFTY' ? niftyAfternoonEngine : afternoonEngine;
  res.json({ ...eng.status(), halt: eng.getHaltStatus() });
});

app.post('/api/afternoon/auto', (req, res) => {
  const inst = String(req.query.inst || req.body?.inst || 'SENSEX').toUpperCase();
  const { enabled } = req.body;
  const eng = inst === 'NIFTY' ? niftyAfternoonEngine : afternoonEngine;
  eng.setAutoEnabled(!!enabled);
  res.json({ ok: true, instrument: inst, autoEnabled: !!enabled });
});

app.get('/api/afternoon/score', (req, res) => {
  const inst = String(req.query.inst || 'SENSEX').toUpperCase();
  const eng = inst === 'NIFTY' ? niftyAfternoonEngine : afternoonEngine;
  const score = eng.computeScore();
  res.json({ instrument: inst, ...score });
});

app.get('/api/afternoon/config', (req, res) => {
  const inst = String(req.query.inst || 'SENSEX').toUpperCase();
  const eng = inst === 'NIFTY' ? niftyAfternoonEngine : afternoonEngine;
  res.json(eng.getConfig());
});

app.patch('/api/afternoon/config', (req, res) => {
  const inst = String(req.query.inst || 'SENSEX').toUpperCase();
  const eng = inst === 'NIFTY' ? niftyAfternoonEngine : afternoonEngine;
  const applied = eng.setConfig(req.body || {});
  res.json({ ok: true, applied });
});

app.post('/api/afternoon/reset', (req, res) => {
  const inst = String(req.query.inst || 'SENSEX').toUpperCase();
  const eng = inst === 'NIFTY' ? niftyAfternoonEngine : afternoonEngine;
  const was = eng.resetHalt();
  res.json({ ok: true, instrument: inst, was, halt: eng.getHaltStatus() });
});

app.get('/api/afternoon/position', (req, res) => {
  const inst = String(req.query.inst || 'SENSEX').toUpperCase();
  const pos = inst === 'NIFTY' ? niftyAfternoonOpenPosition : afternoonOpenPosition;
  const closed = inst === 'NIFTY' ? niftyAfternoonClosedPositions : afternoonClosedPositions;
  if (!pos) return res.json({ open: false, closed: closed.slice(-5) });
  res.json({ open: true, position: pos, closed: closed.slice(-5) });
});

app.post('/api/afternoon/test-trade', async (req, res) => {
  const inst   = String(req.query.inst || req.body?.inst || 'SENSEX').toUpperCase();
  const signal = String(req.query.signal || req.body?.signal || 'CALL').toUpperCase();
  const eng = inst === 'NIFTY' ? niftyAfternoonEngine : afternoonEngine;
  try {
    const result = await eng.forceEntry(signal);
    res.json({ inst, signal, session: 'AFTERNOON', ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==================== MANUAL TEST TRADE ====================
// Forces a paper entry for end-to-end pipeline validation (sizing, strike
// walk, slippage, exit, equity persist) without waiting for a live ORB signal.
// POST /api/test-trade?inst=NIFTY&signal=CALL   (paper mode only)
app.post('/api/test-trade', async (req, res) => {
  const inst   = String(req.query.inst || req.body?.inst || 'NIFTY').toUpperCase();
  const signal = String(req.query.signal || req.body?.signal || 'CALL').toUpperCase();
  const eng = inst === 'NIFTY' ? niftyEngine : engine;
  try {
    const result = await eng.forceEntry(signal);
    res.json({ inst, signal, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==================== STRATEGY CONFIG (live editor) ====================
// Applies to both engines at runtime. Overrides persist to data/config-overrides.json
// (not to .env, which stays pristine for version control).
const CONFIG_OVERRIDE_PATH = require('path').join(__dirname, 'data', 'config-overrides.json');

function _loadConfigOverrides() {
  try {
    const fs = require('fs');
    if (fs.existsSync(CONFIG_OVERRIDE_PATH)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_OVERRIDE_PATH, 'utf8'));
      if (engine?.setConfig)      engine.setConfig(data);
      if (niftyEngine?.setConfig) niftyEngine.setConfig(data);
      console.log(`[config] Loaded overrides from ${CONFIG_OVERRIDE_PATH}`);
      return data;
    }
  } catch (err) {
    console.warn('[config] failed to load overrides:', err.message);
  }
  return {};
}
const _cfgOverrides = _loadConfigOverrides();

// Safe numeric bounds for each field
const CONFIG_SPEC = {
  STOP_LOSS_PERCENT:         { min: 5,   max: 90,     step: 1,   label: 'Stop Loss %',         unit: '%' },
  TARGET_PERCENT:            { min: 10,  max: 500,    step: 5,   label: 'Target %',            unit: '%' },
  TRAIL_AFTER_MULTIPLE:      { min: 1,   max: 10,     step: 0.25, label: 'Trail After ×',      unit: '×' },
  TRAIL_LOCK_PERCENT:        { min: 10,  max: 95,     step: 5,   label: 'Trail Lock %',        unit: '%' },
  CAPITAL_PER_TRADE_PERCENT: { min: 0.5, max: 50,     step: 0.5, label: 'Capital/Trade %',     unit: '%' },
  MAX_DAILY_LOSS_PERCENT:    { min: 0.5, max: 10,     step: 0.25, label: 'Max Daily Loss %',   unit: '%' },
  CAPITAL_TOTAL:             { min: 10000, max: 100000000, step: 10000, label: 'Total Capital', unit: '₹' }
};

app.get('/api/strategy-config', (req, res) => {
  const cur = engine?.getConfig ? engine.getConfig() : {};
  res.json({ spec: CONFIG_SPEC, values: cur });
});

app.patch('/api/strategy-config', (req, res) => {
  const body = req.body || {};
  // Validate each field against spec
  const clean = {};
  const errors = [];
  for (const [k, v] of Object.entries(body)) {
    const spec = CONFIG_SPEC[k];
    if (!spec) { errors.push(`${k}: unknown field`); continue; }
    const n = Number(v);
    if (!isFinite(n))       { errors.push(`${k}: not a number`); continue; }
    if (n < spec.min || n > spec.max) {
      errors.push(`${k}: out of range [${spec.min}, ${spec.max}]`); continue;
    }
    clean[k] = n;
  }
  if (errors.length) return res.status(400).json({ error: 'validation failed', details: errors });
  if (!Object.keys(clean).length) return res.status(400).json({ error: 'no valid fields to update' });

  // Apply to both engines
  const applied = {};
  if (engine?.setConfig)      Object.assign(applied, engine.setConfig(clean));
  if (niftyEngine?.setConfig) niftyEngine.setConfig(clean);

  // Persist the full merged override set
  try {
    const fs = require('fs');
    const path = require('path');
    const dir = path.dirname(CONFIG_OVERRIDE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let existing = {};
    if (fs.existsSync(CONFIG_OVERRIDE_PATH)) {
      try { existing = JSON.parse(fs.readFileSync(CONFIG_OVERRIDE_PATH, 'utf8')); } catch(_) {}
    }
    const merged = { ...existing, ...applied };
    fs.writeFileSync(CONFIG_OVERRIDE_PATH, JSON.stringify(merged, null, 2));
    console.log('[config] persisted overrides:', applied);
  } catch (err) {
    console.error('[config] persist failed:', err.message);
  }

  res.json({ ok: true, applied, values: engine.getConfig() });
});

app.post('/api/strategy-config/reset', (req, res) => {
  try {
    const fs = require('fs');
    if (fs.existsSync(CONFIG_OVERRIDE_PATH)) fs.unlinkSync(CONFIG_OVERRIDE_PATH);
  } catch (_) {}
  // Re-create engines' values from original env defaults by calling setConfig with env values
  const envVals = {};
  for (const k of Object.keys(CONFIG_SPEC)) {
    if (process.env[k] != null) envVals[k] = Number(process.env[k]);
  }
  if (engine?.setConfig)      engine.setConfig(envVals);
  if (niftyEngine?.setConfig) niftyEngine.setConfig(envVals);
  res.json({ ok: true, values: engine.getConfig() });
});

// ==================== HIGH/LOW MAPPING ====================
const _prevDayLevelsCache = {};

async function _fetchPrevTradingDayLevels(inst) {
  const upperInst = String(inst || 'SENSEX').toUpperCase();
  const cacheKey = `${upperInst}:${new Date(Date.now() + IST_OFFSET_MIN * 60 * 1000).toISOString().slice(0, 10)}`;
  const cached = _prevDayLevelsCache[cacheKey];
  if (cached && (Date.now() - cached.at) < 15 * 60 * 1000) return cached.data;

  try {
    const YahooFinance = require('yahoo-finance2').default;
    const yf = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] });
    const symbol = upperInst === 'NIFTY' ? '^NSEI' : '^BSESN';
    const period2 = new Date();
    const period1 = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const rows = await yf.historical(symbol, { period1, period2, interval: '1d' });
    const clean = (rows || []).filter(r => Number.isFinite(r?.high) && Number.isFinite(r?.low));
    const todayStr = new Date(Date.now() + IST_OFFSET_MIN * 60 * 1000).toISOString().slice(0, 10);
    const prev = clean.filter(r => new Date(r.date).toISOString().slice(0, 10) < todayStr).at(-1);
    if (prev) {
      const data = {
        inst: upperInst,
        tradeDate: new Date(prev.date).toISOString().slice(0, 10),
        high: +Number(prev.high).toFixed(2),
        low: +Number(prev.low).toFixed(2),
      };
      _prevDayLevelsCache[cacheKey] = { at: Date.now(), data };
      return data;
    }
  } catch (_) {}

  if (!live?.client?._post) throw new Error('historical index feed unavailable');

  const securityId = upperInst === 'NIFTY'
    ? (process.env.DHAN_NIFTY_SECURITY_ID || '13')
    : (process.env.DHAN_SENSEX_SECURITY_ID || '51');

  const todayIST = new Date(Date.now() + IST_OFFSET_MIN * 60 * 1000);
  for (let back = 1; back <= 7; back++) {
    const from = new Date(todayIST.getTime() - back * 24 * 60 * 60 * 1000);
    const day = from.toISOString().slice(0, 10);
    try {
      const r = await live.client._post('/v2/charts/intraday', {
        securityId: String(securityId),
        exchangeSegment: 'IDX_I',
        instrument: 'INDEX',
        interval: '1',
        fromDate: day,
        toDate: day,
      });
      const highs = Array.isArray(r?.high) ? r.high.map(Number).filter(Number.isFinite) : [];
      const lows = Array.isArray(r?.low) ? r.low.map(Number).filter(Number.isFinite) : [];
      if (!highs.length || !lows.length) continue;

      const data = {
        inst: upperInst,
        tradeDate: day,
        high: +Math.max(...highs).toFixed(2),
        low: +Math.min(...lows).toFixed(2),
      };
      _prevDayLevelsCache[cacheKey] = { at: Date.now(), data };
      return data;
    } catch (_) {}
  }
  throw new Error(`previous trading day data not found for ${upperInst}`);
}

app.get('/api/prev-day-levels', async (req, res) => {
  const inst = String(req.query.inst || 'SENSEX').toUpperCase();
  try {
    const base = await _fetchPrevTradingDayLevels(inst);
    let spot = 0;
    try {
      const quote = inst === 'NIFTY' ? await live.getNiftyPrice() : await live.getSensexPrice();
      spot = Number(quote?.price || 0);
    } catch (_) {
      spot = inst === 'NIFTY' ? await _fetchYahooNiftyPrice() : await _fetchYahooPrice();
    }
    const aboveHigh = spot > base.high ? +(spot - base.high).toFixed(2) : +(base.high - spot).toFixed(2);
    const belowLow = spot < base.low ? +(base.low - spot).toFixed(2) : +(spot - base.low).toFixed(2);
    res.json({
      ...base,
      spot: +spot.toFixed(2),
      range: +(base.high - base.low).toFixed(2),
      aboveHigh,
      belowLow,
      highStatus: spot > base.high ? 'ABOVE Y-HIGH' : spot === base.high ? 'AT Y-HIGH' : 'BELOW Y-HIGH',
      lowStatus: spot < base.low ? 'BELOW Y-LOW' : spot === base.low ? 'AT Y-LOW' : 'ABOVE Y-LOW'
    });
  } catch (err) {
    res.status(500).json({ error: err.message, inst, high: 0, low: 0, spot: 0, range: 0 });
  }
});

// Returns the intraday H/L record for the requested instrument including
// the full path of breaks (each time a new H or L was set, with timestamp).
app.get('/api/hl-record', (req, res) => {
  const inst = String(req.query.inst || 'SENSEX').toUpperCase();
  const rec = _hlRecord[inst];
  if (!rec) return res.status(400).json({ error: 'unknown instrument' });

  const fmtTime = (ms) => ms ? new Date(ms + 5.5*3600*1000).toISOString().slice(11, 19) : null;
  const path = (arr) => arr.map(e => ({ time: fmtTime(e.t), price: +e.p.toFixed(2), ts: e.t }));

  // Per-break CE/PE premium snapshot (captured by _snapshotChainAtHL when a
  // new H or L prints). Lets the dashboard show "at that high, ATM CE was X,
  // ATM PE was Y" — useful for entry-pricing analysis.
  const callPutLog = (rec.chainLog || []).map(e => ({
    time:      fmtTime(e.t),
    ts:        e.t,
    price:     e.p,
    dir:       e.dir,                   // 'HIGH' or 'LOW'
    atmStrike: e.atmStrike,
    ce:        +Number(e.ce  || 0).toFixed(2),
    pe:        +Number(e.pe  || 0).toFixed(2),
    ceVol:     e.ceVol || 0,
    peVol:     e.peVol || 0
  }));

  res.json({
    inst,
    date: rec.date,
    high:       +rec.high.toFixed(2),
    highTime:   fmtTime(rec.highAt),
    highAt:     rec.highAt,
    low:        +rec.low.toFixed(2),
    lowTime:    fmtTime(rec.lowAt),
    lowAt:      rec.lowAt,
    highBreaks: path(rec.highPath),
    lowBreaks:  path(rec.lowPath),
    range:      +(rec.high - rec.low).toFixed(2),
    callPutLog                          // [{time,price,dir,atmStrike,ce,pe,ceVol,peVol}]
  });
});

// ==================== TREND FROM H/L BREAK SEQUENCE ====================
// Merges highBreaks + lowBreaks into a time-ordered event log, then judges
// trend from the tail. Distinct from the VWAP/momentum detectTrend() —
// this one is purely structural (HH/HL pattern detection).
//
// Rules:
//   HIGH_TREND  → last 3+ events are HIGH breaks (no LOW since)
//   LOW_TREND   → last 3+ events are LOW breaks  (no HIGH since)
//   RANGE       → mixed or insufficient breaks
//
// Confidence scaled by: consecutive count, time since opposite break,
// price-vs-ORB position, price-vs-VWAP alignment.
function _computeTrendFromHL(inst, currentPrice, orbHigh, orbLow, vwap) {
  const rec = _hlRecord[inst];
  if (!rec) return { trend: 'UNKNOWN', confidence: 0, reason: 'no record' };

  // Merge & sort by timestamp
  const events = [
    ...rec.highPath.map(e => ({ t: e.t, p: e.p, dir: 'HIGH' })),
    ...rec.lowPath.map (e => ({ t: e.t, p: e.p, dir: 'LOW'  }))
  ].sort((a, b) => a.t - b.t);
  if (events.length < 2) return {
    trend: 'RANGE', confidence: 10, reason: 'not enough breaks yet',
    events: events.length, recommend: 'WAIT'
  };

  // Count tail consecutive same-direction events
  const tailDir = events[events.length - 1].dir;
  let consec = 1;
  for (let i = events.length - 2; i >= 0; i--) {
    if (events[i].dir === tailDir) consec++;
    else break;
  }
  const oppositeIdx = events.length - 1 - consec;
  const lastOppositeTime = oppositeIdx >= 0 ? events[oppositeIdx].t : null;
  const minsSinceOpposite = lastOppositeTime
    ? Math.round((Date.now() - lastOppositeTime) / 60000)
    : null;

  // Base label
  let trend, recommend;
  if (consec >= 3 && tailDir === 'HIGH')     { trend = 'HIGH_TREND'; recommend = 'BUY_CALL'; }
  else if (consec >= 3 && tailDir === 'LOW') { trend = 'LOW_TREND';  recommend = 'BUY_PUT';  }
  else                                       { trend = 'RANGE';      recommend = 'WAIT';     }

  // Confidence scoring 0-100
  let conf = Math.min(40, consec * 12);                                                // structure
  if (currentPrice && orbHigh && currentPrice > orbHigh) conf += (tailDir === 'HIGH' ? 25 : -10);  // ORB break align
  if (currentPrice && orbLow  && currentPrice < orbLow)  conf += (tailDir === 'LOW'  ? 25 : -10);
  if (vwap && currentPrice) {
    const aboveVwap = currentPrice > vwap;
    if (aboveVwap && tailDir === 'HIGH') conf += 15;
    if (!aboveVwap && tailDir === 'LOW') conf += 15;
  }
  if (minsSinceOpposite && minsSinceOpposite > 30) conf += 10;                          // sticky trend
  conf = Math.max(0, Math.min(100, conf));

  // Structure flags (HH/HL/LH/LL — quick read for the dashboard badge)
  const lastTwoHighs = rec.highPath.slice(-2);
  const lastTwoLows  = rec.lowPath.slice(-2);
  const makingHH = lastTwoHighs.length === 2 && lastTwoHighs[1].p > lastTwoHighs[0].p;
  const makingLL = lastTwoLows.length  === 2 && lastTwoLows[1].p  < lastTwoLows[0].p;
  const makingHL = lastTwoLows.length  === 2 && lastTwoLows[1].p  > lastTwoLows[0].p;
  const makingLH = lastTwoHighs.length === 2 && lastTwoHighs[1].p < lastTwoHighs[0].p;

  return {
    inst,
    trend,
    recommend,
    confidence: conf,
    consec,
    tailDir,
    lastOppositeMinsAgo: minsSinceOpposite,
    structure: { higherHighs: makingHH, lowerLows: makingLL, higherLows: makingHL, lowerHighs: makingLH },
    reason:
      trend === 'HIGH_TREND' ? `${consec} new highs without a new low${minsSinceOpposite ? ` (${minsSinceOpposite}m since last low)` : ''}` :
      trend === 'LOW_TREND'  ? `${consec} new lows without a new high${minsSinceOpposite ? ` (${minsSinceOpposite}m since last high)` : ''}` :
                               `mixed breaks (last ${consec}× ${tailDir})`,
    currentPrice, orbHigh, orbLow, vwap,
    eventsCount: events.length
  };
}

app.get('/api/trend', (req, res) => {
  const inst = String(req.query.inst || 'NIFTY').toUpperCase();
  const isNifty = inst === 'NIFTY';
  const ctx = {
    currentPrice: isNifty ? niftyPrices.at?.(-1) ?? null : prices.at?.(-1) ?? null,
    orbHigh:      isNifty ? niftyOrbHigh : orbHigh,
    orbLow:       isNifty ? niftyOrbLow  : orbLow,
    vwap:         isNifty ? niftyVwap    : vwap
  };
  res.json(_computeTrendFromHL(inst, ctx.currentPrice, ctx.orbHigh, ctx.orbLow, ctx.vwap));
});

// ==================== END-OF-DAY SUMMARY ====================
// Aggregates today's trades + signal accuracy for both instruments. Auto-fires
// once at 15:35 IST (5 min after market close) — logs banner, can be polled
// via /api/eod-summary at any time.
function _eodSummary() {
  const todayStr = new Date().toDateString();
  const agg = (positions, label) => {
    const today = positions.filter(p => p.exitAt && new Date(p.exitAt).toDateString() === todayStr);
    const wins   = today.filter(p => parseFloat(p.finalPnlAbs || 0) > 0);
    const losses = today.filter(p => parseFloat(p.finalPnlAbs || 0) < 0);
    const pnl = today.reduce((s, p) => s + parseFloat(p.finalPnlAbs || 0), 0);
    const winRate = today.length ? +(100 * wins.length / today.length).toFixed(1) : null;
    const grossWin  = wins  .reduce((s, p) => s + parseFloat(p.finalPnlAbs || 0), 0);
    const grossLoss = losses.reduce((s, p) => s + parseFloat(p.finalPnlAbs || 0), 0);
    return {
      instrument: label,
      tradesToday: today.length,
      wins: wins.length,
      losses: losses.length,
      winRate,
      pnl: +pnl.toFixed(0),
      grossWin: +grossWin.toFixed(0),
      grossLoss: +grossLoss.toFixed(0),
      bestTrade:   today.length ? +Math.max(...today.map(p => parseFloat(p.finalPnlAbs || 0))).toFixed(0) : 0,
      worstTrade:  today.length ? +Math.min(...today.map(p => parseFloat(p.finalPnlAbs || 0))).toFixed(0) : 0,
      trades: today.map(p => ({
        type: p.type, strike: p.strike, entry: p.entryPrice, exit: p.exitPrice,
        pnl: +parseFloat(p.finalPnlAbs || 0).toFixed(0),
        pnlPct: p.finalPnlPct, reason: p.exitReason, exitAt: p.exitAt
      }))
    };
  };
  const sensex = agg(closedPositions,      'SENSEX');
  const nifty  = agg(niftyClosedPositions, 'NIFTY');
  const totalPnl = sensex.pnl + nifty.pnl;
  return {
    date: todayStr,
    timestamp: Date.now(),
    totalPnl,
    overallWinRate: (sensex.tradesToday + nifty.tradesToday)
      ? +(100 * (sensex.wins + nifty.wins) / (sensex.tradesToday + nifty.tradesToday)).toFixed(1)
      : null,
    sensex, nifty
  };
}

app.get('/api/eod-summary', (req, res) => res.json(_eodSummary()));
app.get('/api/claude-status', (_req, res) => res.json(claudeAiStatus()));
app.get('/api/redis-status', async (_req, res) => res.json(await redisStore.status()));

// ── Breakout event log (DAY / ORB / SWING high-low breaks) ────────────────────
app.get('/api/breakouts', (req, res) => {
  const inst = String(req.query.inst || 'SENSEX').toUpperCase();
  const log = _breakoutLog[inst];
  if (!log) return res.json({ inst, events: [] });
  // newest first
  const events = [...log.events].reverse().map(e => ({
    type: e.type, dir: e.dir, level: e.level, price: e.price,
    delta: +(e.price - e.level).toFixed(2), time: e.time, at: e.at
  }));
  res.json({ inst, date: log.date, count: events.length, events });
});

// ── Reversal events (high/low rejection + break-of-structure) ─────────────────
app.get('/api/reversals', (req, res) => {
  const inst = String(req.query.inst || 'SENSEX').toUpperCase();
  const log = _reversalLog[inst];
  if (!log) return res.json({ inst, events: [] });
  const events = [...log.events].reverse();
  res.json({ inst, date: log.date, count: events.length, events });
});

// ── High/Low TOUCH alerts ─────────────────────────────────────────────────────
// Recent "CE/PE touched a NEW session high/low" events for a feed/banner.
app.get('/api/hl-alerts', (req, res) => {
  const inst = String(req.query.inst || 'NIFTY').toUpperCase();
  const kind = String(req.query.kind || '').toUpperCase(); // optional HIGH|LOW filter
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 40));
  let list = _hlTouchAlerts[inst] || [];
  if (kind === 'HIGH' || kind === 'LOW') list = list.filter(e => e.kind === kind);
  res.json({ inst, count: list.length, alerts: list.slice(0, limit) });
});

// ── Last trading-session index H/L (real, from Dhan 1-min candles) ───────────
// When today has no candles (holiday / pre-open / after a fresh restart with an
// empty live H/L store), the dashboard would otherwise show "--". This serves
// the most recent trading day's REAL index high/low + times so the panel is
// never blank — clearly dated so it is never mistaken for "today live".
const _lastHlCache = {}; // inst -> { at, data }
app.get('/api/last-session-hl', async (req, res) => {
  const inst = String(req.query.inst || 'NIFTY').toUpperCase();
  try {
    const cached = _lastHlCache[inst];
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) return res.json(cached.data);
    const meta = getInstrumentMeta(inst);
    const secId = inst === 'NIFTY' ? (process.env.DHAN_NIFTY_SECURITY_ID || '13')
                : inst === 'BANKNIFTY' ? (process.env.DHAN_BANKNIFTY_SECURITY_ID || '25')
                : (process.env.DHAN_SENSEX_SECURITY_ID || '51');
    const idxSeg = inst === 'SENSEX' ? 'IDX_I' : 'IDX_I';
    // Walk back up to 7 days to the most recent day that actually traded.
    const istNow = new Date(Date.now() + IST_OFFSET_MIN * 60 * 1000);
    let found = null;
    for (let back = 1; back <= 7 && !found; back++) {
      const d = new Date(istNow.getTime() - back * 86400000);
      const day = d.toISOString().slice(0, 10);
      try {
        const r = await live.client._post('/v2/charts/intraday', {
          securityId: String(secId), exchangeSegment: idxSeg, instrument: 'INDEX',
          interval: '1', fromDate: `${day} 09:14:00`, toDate: `${day} 15:30:00`
        });
        const ts = r?.timestamp || [], H = r?.high || [], L = r?.low || [], O = r?.open || [], C = r?.close || [];
        if (!ts.length) continue;
        const hi = Math.max(...H), lo = Math.min(...L.filter(x => x > 0));
        const hIdx = H.indexOf(hi), lIdx = L.indexOf(lo);
        const tm = (i) => { const t = new Date(ts[i] * 1000 + IST_OFFSET_MIN * 60000); return String(t.getUTCHours()).padStart(2,'0')+':'+String(t.getUTCMinutes()).padStart(2,'0'); };
        found = {
          inst, date: day, source: 'dhan-1min', live: false,
          high: +hi.toFixed(2), highAt: tm(hIdx),
          low: +lo.toFixed(2), lowAt: tm(lIdx),
          open: +Number(O[0] || 0).toFixed(2), close: +Number(C[C.length - 1] || 0).toFixed(2),
          rangePct: lo > 0 ? +(((hi - lo) / lo) * 100).toFixed(2) : 0
        };
      } catch (_) { /* try previous day */ }
    }
    if (!found) return res.status(404).json({ inst, error: 'no recent trading-day data available' });
    _lastHlCache[inst] = { at: Date.now(), data: found };
    res.json(found);
  } catch (err) {
    res.status(500).json({ inst, error: err.message });
  }
});

// ==================== POP SELLER (Sensibull-style) ====================
// Scan high-PoP sell candidates from the live option chain.
app.get('/api/pop/scan', async (req, res) => {
  const inst   = String(req.query.inst || 'NIFTY').toUpperCase();
  const minPoP = Math.max(50, Number(req.query.minPoP || 75)); // min 50% floor
  try {
    const meta  = getInstrumentMeta(inst);
    const spot  = await meta.priceGetter();
    const chain = await meta.chainGetter(spot);
    const chainStrikes = (chain.strikes || []).map(s => ({
      strike: Number(s.strike),
      ce: s.ce ? { ltp: Number(s.ce.ltp), delta: Number(s.ce.delta), iv: s.ce.iv } : null,
      pe: s.pe ? { ltp: Number(s.pe.ltp), delta: Number(s.pe.delta), iv: s.pe.iv } : null
    }));

    // Extract ATM IV from chain (best available IV near ATM)
    const atm = Math.round(spot / (inst === 'NIFTY' ? 50 : 100)) * (inst === 'NIFTY' ? 50 : 100);
    const atmRow = chainStrikes.find(s => s.strike === atm) || chainStrikes[Math.floor(chainStrikes.length/2)];
    const rawIV = atmRow?.ce?.iv || atmRow?.pe?.iv;
    const atmIV = rawIV && !isNaN(Number(rawIV)) ? Number(rawIV) : null;

    const candidates = popSeller.scanPoP({ inst, spot, chainStrikes, minPoP, maxResults: 40, atmIV });
    const ironCondor = popSeller.buildIronCondor({ inst, spot, chainStrikes, minPoP, atmIV });
    const dte = popSeller.daysToExpiry(inst);
    res.json({
      inst, spot: +Number(spot).toFixed(2), minPoP,
      atmIV: atmIV ? +(Number(atmIV) > 5 ? Number(atmIV) : Number(atmIV)*100).toFixed(1) : null,
      daysToExpiry: +(dte*365).toFixed(1),
      count: candidates.length, candidates, ironCondor
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Payoff curve for a chosen IC / legs.
app.post('/api/pop/payoff', express.json(), (req, res) => {
  const { inst = 'NIFTY', spot, legs } = req.body || {};
  if (!spot || !Array.isArray(legs) || !legs.length) {
    return res.status(400).json({ error: 'spot and legs[] required' });
  }
  const curve = popSeller.payoffCurve(legs, Number(spot), popSeller.lotSize(inst));
  res.json({ inst, spot: +Number(spot).toFixed(2), curve });
});

// Record a sell (paper by default; live hard-gated).
app.post('/api/pop/sell', express.json(), (req, res) => {
  const b = req.body || {};
  const result = popSeller.sellPoP({
    inst: b.inst, side: b.side, strike: b.strike, type: b.type,
    premium: b.premium, lot: b.lot, pop: b.pop,
    tradeMode: process.env.TRADE_MODE || 'paper',
    confirmLive: b.confirmLive === true
  });
  res.status(result.ok ? 200 : 403).json(result);
});

// Close a PoP position.
app.post('/api/pop/close', express.json(), (req, res) => {
  const { id, exitPremium } = req.body || {};
  res.json(popSeller.closePoP(id, exitPremium || 0));
});

// PoP book + status.
app.get('/api/pop/status', (_req, res) => res.json(popSeller.popStatus()));

// ── Extra indices (BANKEX, MIDCPNIFTY, FINNIFTY, VIX) via Yahoo Finance ───────
const _extraCache = { data: null, at: 0 };
app.get('/api/indices-extra', async (_req, res) => {
  if (_extraCache.data && Date.now() - _extraCache.at < 30000) return res.json(_extraCache.data);
  try {
    const YF = require('yahoo-finance2').default;
    const yf = new YF({ suppressNotices: ['ripHistorical', 'yahooSurvey'] });
    const symbols = ['^NSEBANK', '^NSMIDCP', '^NSEI', '^INDIAVIX'];
    const quotes  = await Promise.all(symbols.map(s => yf.quote(s).catch(() => null)));
    const make = q => q ? { price: q.regularMarketPrice || 0, prev: q.regularMarketPreviousClose || 0 } : null;
    const data = {
      BANKEX:     make(quotes[0]),
      MIDCPNIFTY: make(quotes[1]),
      FINNIFTY:   make(quotes[2]),
      VIX:        make(quotes[3])
    };
    _extraCache.data = data; _extraCache.at = Date.now();
    res.json(data);
  } catch (e) { res.json({}); }
});

// Persist today's EOD snapshot to data/eod-YYYY-MM-DD.json.
// Runs every 5 min during market hours (9:15–15:35 IST) for live intraday updates,
// and once more at 15:35 for the final banner + console log.
let _eodLoggedDate = '';
function _persistEod(dayStr, isFinal) {
  try {
    const _path = require('path');
    const _fs2  = require('fs');
    const s = _eodSummary();
    _fs2.writeFileSync(_path.resolve(`./data/eod-${dayStr}.json`), JSON.stringify(s, null, 2));
    if (isFinal) {
      const banner = [
        '',
        '═══════════════════════════════════════════════════════════════',
        `  END-OF-DAY  ${dayStr}  IST`,
        `  Total P&L:        ₹${s.totalPnl.toLocaleString('en-IN')}`,
        `  Overall win rate: ${s.overallWinRate ?? '—'}%`,
        `  ────────────────────────────────────────────────────────────`,
        `  NIFTY   ${s.nifty.tradesToday}× trades   W:${s.nifty.wins} L:${s.nifty.losses}   ₹${s.nifty.pnl.toLocaleString('en-IN')}  (best ₹${s.nifty.bestTrade}, worst ₹${s.nifty.worstTrade})`,
        `  SENSEX  ${s.sensex.tradesToday}× trades   W:${s.sensex.wins} L:${s.sensex.losses}   ₹${s.sensex.pnl.toLocaleString('en-IN')}  (best ₹${s.sensex.bestTrade}, worst ₹${s.sensex.worstTrade})`,
        '═══════════════════════════════════════════════════════════════',
        ''
      ].join('\n');
      console.log(banner);
    }
  } catch (e) { console.warn('[eod] persist failed:', e.message); }
}

setInterval(() => {
  try {
    const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
    const hh = ist.getUTCHours();
    const mm = ist.getUTCMinutes();
    const dayStr = ist.toISOString().slice(0, 10);
    const totalMin = hh * 60 + mm;
    const marketOpen  = 9 * 60 + 15;   // 9:15
    const marketClose = 15 * 60 + 35;  // 15:35

    // Live intraday write every 5 min during market hours
    if (totalMin >= marketOpen && totalMin <= marketClose && mm % 5 === 0) {
      const isFinal = hh === 15 && mm === 35;
      if (isFinal && _eodLoggedDate === dayStr) return; // already done final
      if (isFinal) _eodLoggedDate = dayStr;
      _persistEod(dayStr, isFinal);
    } else if (totalMin >= marketOpen && totalMin <= marketClose) {
      // Safety-net: also snapshot EVERY minute during market hours (not just on the
      // 5-min mark). Windows kills the process without delivering SIGTERM to Node,
      // so the graceful-shutdown flush can't be relied on there — this caps data
      // loss at ~1 minute even on an abrupt kill. Also flush market state.
      _persistEod(dayStr, false);
      _writeMarketState();
    }
  } catch (_) { /* never crash */ }
}, 60 * 1000);

// ==================== EMA STACK (9/15/21/50/200) ====================
// Pulls today's 1-min candles, computes 5 EMAs, returns values + tactical
// badge (STRONG_UP / STRONG_DOWN / PULLBACK / TREND_CHANGE / STOP_HIT).
// Cached 30s per inst — EMAs don't move fast enough to need finer.
const _emaCache = { NIFTY: null, SENSEX: null };
const _emaCacheAt = { NIFTY: 0, SENSEX: 0 };
const _emaClosesCache = { NIFTY: null, SENSEX: null };   // close series for RSI on cache hits
const EMA_TTL_MS = 30 * 1000;

function _ema(values, period) {
  if (!values.length) return null;
  const k = 2 / (period + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i++) ema = values[i] * k + ema * (1 - k);
  return ema;
}

// Local 14-period RSI from a close series (matches multiconfirm.js's formula).
function _rsi14(series, period = 14) {
  if (!series || series.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = series.length - period; i < series.length; i++) {
    const d = series[i] - series[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  if (loss === 0) return 100;
  const rs = (gain / period) / (loss / period);
  return 100 - 100 / (1 + rs);
}

// Augment an ema-stack `data` object with an advisory AI mean-reversion call.
// Support = ORB/day low, Resistance = ORB/day high. Off unless CLAUDE_AI_ENABLED.
async function _augmentMeanReversionAI(inst, data, closes) {
  try {
    // Support = nearest floor (ORB low → day low), Resistance = nearest ceiling.
    const support    = inst === 'NIFTY' ? (niftyOrbLow  || niftyDayLow  || null)
                                        : (orbLow        || dayLow        || null);
    const resistance = inst === 'NIFTY' ? (niftyOrbHigh || niftyDayHigh || null)
                                        : (orbHigh       || dayHigh       || null);
    const series = closes ? closes.map(Number).filter(n => n > 0) : null;
    const rsiVal = series ? _rsi14(series) : null;
    // Extra indicators from the same close series (reuse multiconfirm helpers).
    const bb    = series ? multiconfirm.bollinger(series, 20, 2) : null;
    const stoch = series ? multiconfirm.stochastic(series, 14, 3) : null;
    const mac   = series ? multiconfirm.macd(series, 12, 26, 9) : null;
    // Set indicators + levels FIRST, so they appear even if the AI call errors.
    data.rsi = rsiVal != null ? +rsiVal.toFixed(1) : null;
    data.support = support || null;
    data.resistance = resistance || null;
    data.bollinger = bb;
    data.stochastic = stoch ? stoch.k : null;
    data.macdHist = mac ? mac.hist : null;
    // Garbage-in guard: skip the AI when the live feed is down.
    if (_dataHealth.status === 'DOWN') { data.ai = null; data.aiSkipped = 'data source DOWN — AI gated'; return data; }
    data.ai = await claudeMeanReversion({
      symbol: inst,
      currentPrice: data.price,
      rsiValue: rsiVal != null ? +rsiVal.toFixed(1) : 'N/A',
      supportLevel: support || 'N/A',
      resistanceLevel: resistance || 'N/A',
      ema50: data.ema50 ?? 'N/A',
      bbUpper: bb?.upper, bbLower: bb?.lower, bbPctB: bb?.pctB,
      stochK: stoch?.k, macdHist: mac?.hist
    });
    // Log the advisory so its real hit-rate can be measured over time.
    if (data.ai && data.ai.action && data.ai.action !== 'HOLD' && data.price > 0) {
      const dir = data.ai.action === 'BUY_LOW' ? 1 : data.ai.action === 'SELL_HIGH' ? -1 : 0;
      aiLogger.logSignal({ type: 'meanrev', inst, spot: data.price, dir,
        target: data.ai.targetPrice, stop: data.ai.stopLoss, conf: data.ai.confidenceScore,
        valid: data.ai.valid, payload: { action: data.ai.action } });
    }
  } catch (_) { data.ai = null; }
  return data;
}

app.get('/api/ema-stack', async (req, res) => {
  const inst = String(req.query.inst || 'NIFTY').toUpperCase();
  const wantAI = req.query.ai === '1';
  if (_emaCache[inst] && Date.now() - _emaCacheAt[inst] < EMA_TTL_MS) {
    if (!wantAI) return res.json(_emaCache[inst]);
    // Serve cached EMA values but run a fresh advisory AI pass on top. Reuse the
    // cached close series so RSI is still computed on the cache-hit path.
    return res.json(await _augmentMeanReversionAI(inst, { ..._emaCache[inst] }, _emaClosesCache[inst] || null));
  }
  const secId = inst === 'NIFTY'
    ? (process.env.DHAN_NIFTY_SECURITY_ID  || '13')
    : (process.env.DHAN_SENSEX_SECURITY_ID || '51');
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  try {
    const r = await live.client._post('/v2/charts/intraday', {
      securityId: String(secId), exchangeSegment: 'IDX_I',
      instrument: 'INDEX', interval: '1', fromDate: today, toDate: today
    });
    const closes = (r?.close || []).map(Number).filter(n => n > 0);
    if (closes.length < 9) {
      return res.json({ inst, ready: false, reason: 'need ≥ 9 candles', candles: closes.length });
    }
    const ema9   = _ema(closes, 9);
    const ema15  = _ema(closes, 15);
    const ema21  = _ema(closes, 21);
    const ema50  = closes.length >= 50  ? _ema(closes, 50)  : null;
    const ema200 = closes.length >= 200 ? _ema(closes, 200) : null;
    const price  = closes.at(-1);
    const prev   = closes.length >= 2 ? closes.at(-2) : price;

    // Tactical classification — short-circuit on the most actionable state
    let tactic = 'NEUTRAL';
    let tacticLabel = 'no clear signal';
    const ord = (a, b) => a != null && b != null && a > b;
    const stackUp   = ord(ema9, ema15) && ord(ema15, ema21) && (ema50 == null || ord(ema21, ema50)) && (ema200 == null || ord(ema50, ema200));
    const stackDown = ord(ema15, ema9) && ord(ema21, ema15) && (ema50 == null || ord(ema50, ema21)) && (ema200 == null || ord(ema200, ema50));
    if (price < ema21 && prev >= ema21)        { tactic = 'STOP_HIT';      tacticLabel = 'price crossed below 21 EMA — exit longs'; }
    else if (price > ema50 && prev <= ema50 && ema50 != null) { tactic = 'TREND_CHANGE_UP';   tacticLabel = 'reclaimed 50 EMA — bullish'; }
    else if (price < ema200 && prev >= ema200 && ema200 != null) { tactic = 'REGIME_CHANGE_DOWN'; tacticLabel = 'lost 200 EMA — bearish regime'; }
    else if (price < ema9 && price > ema15 && stackUp) { tactic = 'PULLBACK_UP'; tacticLabel = 'pullback to 15 EMA in uptrend — buy zone'; }
    else if (price > ema9 && price < ema15 && stackDown) { tactic = 'PULLBACK_DOWN'; tacticLabel = 'pullback to 15 EMA in downtrend — sell zone'; }
    else if (stackUp)    { tactic = 'STRONG_UP';   tacticLabel = 'all EMAs stacked up — favor CALL'; }
    else if (stackDown)  { tactic = 'STRONG_DOWN'; tacticLabel = 'all EMAs stacked down — favor PUT'; }

    const data = {
      inst, ready: true, candles: closes.length, price: +price.toFixed(2),
      ema9: ema9 != null ? +ema9.toFixed(2) : null,
      ema15: ema15 != null ? +ema15.toFixed(2) : null,
      ema21: ema21 != null ? +ema21.toFixed(2) : null,
      ema50: ema50 != null ? +ema50.toFixed(2) : null,
      ema200: ema200 != null ? +ema200.toFixed(2) : null,
      tactic, tacticLabel,
      ts: Date.now()
    };
    _emaCache[inst] = data;
    _emaCacheAt[inst] = Date.now();
    _emaClosesCache[inst] = closes;
    if (wantAI) return res.json(await _augmentMeanReversionAI(inst, { ...data }, closes));
    res.json(data);
  } catch (err) {
    res.status(500).json({ inst, ready: false, error: err.message });
  }
});

// ==================== DHAN CLIENT STATS ====================
// Exposes in-flight coalescing / cache / rate-limit counters for observability.
app.get('/api/dhan-stats', (req, res) => {
  if (!live?.client?.getStats) {
    return res.json({ connected: false, error: 'Dhan client not initialized' });
  }
  const s = live.client.getStats();
  const totalRequests = s.calls + s.coalesced + s.cacheHits;
  res.json({
    connected: live.connected,
    calls: s.calls,
    coalesced: s.coalesced,
    cacheHits: s.cacheHits,
    inflight: s.inflight,
    cached: s.cached,
    rateLimited: s.rateLimited,
    errors: s.errors,
    authErrors: s.authErrors,
    totalRequests,
    hitRate: totalRequests ? +((s.coalesced + s.cacheHits) / totalRequests * 100).toFixed(1) : 0,
    lastCallAt:  s.lastCallAt,
    lastErrorAt: s.lastErrorAt,
    lastError:   s.lastError,
    minIntervalMs: s.minIntervalMs
  });
});

// ==================== LIVE LOG STREAM ====================
// Tail of PM2 out.log + error.log with optional level filter.
// Query: ?limit=50&level=all|info|warn|err|dhan  (level filters on last message tokens)
app.get('/api/logs', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const limit  = Math.min(500, Math.max(10, parseInt(req.query.limit) || 80));
  const level  = (req.query.level || 'all').toLowerCase();
  const files = [
    { path: path.join(__dirname, 'logs', 'out.log'),   stream: 'out' },
    { path: path.join(__dirname, 'logs', 'error.log'), stream: 'err' }
  ];
  const tailBytes = 64 * 1024;
  const all = [];
  for (const f of files) {
    try {
      const stat = fs.statSync(f.path);
      const start = Math.max(0, stat.size - tailBytes);
      const fd = fs.openSync(f.path, 'r');
      const buf = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      const lines = buf.toString('utf8').split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        // Handle both "0|antigrav | 2026-04-22 16:27:39: message" and "2026-04-22 16:27:39: message"
        const m = line.match(/^(?:\d+\|\S+\s*\|\s*)?(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}):\s*(.*)$/);
        const ts = m ? m[1] : null;
        const msg = m ? m[2] : line;
        const lvl = /error|fail|invalid|401|403|500|rejected/i.test(msg) ? 'err'
                  : /warn|429|timeout|rate-limit|backing off/i.test(msg) ? 'warn'
                  : /dhan|neo|token/i.test(msg) ? 'dhan'
                  : 'info';
        all.push({ ts, stream: f.stream, level: lvl, msg });
      }
    } catch (_) { /* file missing → skip */ }
  }
  all.sort((a, b) => (a.ts || '').localeCompare(b.ts || ''));
  const filtered = level === 'all' ? all : all.filter(e => e.level === level);
  res.json({ entries: filtered.slice(-limit), total: all.length });
});

// ==================== RISK DASHBOARD ====================
app.get('/api/risk', (req, res) => {
  const capital = parseFloat(process.env.CAPITAL_TOTAL || 500000);
  const maxLossPct = parseFloat(process.env.MAX_DAILY_LOSS_PERCENT || 2) / 100;
  const maxTrades  = parseInt(process.env.MAX_TRADES_PER_DAY || 2);
  const maxConsecutiveLosses = parseInt(process.env.MAX_CONSECUTIVE_LOSSES || 3);
  const todayStr = new Date().toDateString();

  const sensexToday = closedPositions.filter(p => new Date(p.exitAt).toDateString() === todayStr);
  const niftyToday  = niftyClosedPositions.filter(p => new Date(p.exitAt).toDateString() === todayStr);

  const sensexTodayPnl = sensexToday.reduce((s, p) => s + parseFloat(p.finalPnlAbs || 0), 0);
  const niftyTodayPnl  = niftyToday.reduce((s, p) => s + parseFloat(p.finalPnlAbs || 0), 0);

  const totalTodayPnl = sensexTodayPnl + niftyTodayPnl;
  const dailyLossLimit = -(capital * maxLossPct);
  const limitBreached  = totalTodayPnl <= dailyLossLimit;
  const usedPct = Math.abs(Math.min(0, totalTodayPnl)) / (capital * maxLossPct) * 100;

  // Consecutive losses (tail of today's trades per instrument)
  const tailLosses = (arr) => {
    let n = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (parseFloat(arr[i].finalPnlAbs || 0) < 0) n++;
      else break;
    }
    return n;
  };
  const sensexConsecLosses = tailLosses(sensexToday);
  const niftyConsecLosses  = tailLosses(niftyToday);

  // Trading window (IST 09:15 – 15:30)
  const session = getMarketSession();
  const inMarketHours = session.inMarketHours;
  const minsToClose = inMarketHours ? (MARKET_CLOSE_MIN - session.istMins) : 0;

  // Per-instrument status
  const statusFor = (pnl, trades, consec) => {
    if (limitBreached) return 'HALTED';
    if (trades >= maxTrades) return 'HALTED';
    if (consec >= maxConsecutiveLosses) return 'HALTED';
    if (usedPct >= 75 || trades >= maxTrades - 1) return 'WARN';
    return 'OK';
  };
  const sensexStatus = statusFor(sensexTodayPnl, sensexToday.length, sensexConsecLosses);
  const niftyStatus  = statusFor(niftyTodayPnl,  niftyToday.length,  niftyConsecLosses);

  const overallStatus = limitBreached ? 'HALTED'
    : (sensexStatus === 'HALTED' && niftyStatus === 'HALTED') ? 'HALTED'
    : (sensexStatus === 'WARN' || niftyStatus === 'WARN' || usedPct >= 50) ? 'WARN'
    : 'OK';

  // Dhan token expiry from JWT payload
  let tokenExpiryDays = null;
  let tokenExpiryHours = null;
  let tokenExpired = false;
  try {
    const token = process.env.DHAN_ACCESS_TOKEN || '';
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(Buffer.from(b64, 'base64').toString());
    const expiresAt = payload.exp * 1000;
    const remainingMs = expiresAt - Date.now();
    tokenExpiryDays = Math.floor(remainingMs / (1000 * 86400));
    tokenExpiryHours = +(remainingMs / (1000 * 3600)).toFixed(1);
    tokenExpired = remainingMs <= 0;
  } catch (_) {}

  res.json({
    capital,
    maxDailyLossPct: maxLossPct * 100,
    dailyLossLimit:  +dailyLossLimit.toFixed(0),
    sensexTodayPnl:  +sensexTodayPnl.toFixed(0),
    niftyTodayPnl:   +niftyTodayPnl.toFixed(0),
    totalTodayPnl:   +totalTodayPnl.toFixed(0),
    usedPct:         +usedPct.toFixed(1),
    limitBreached,
    tokenExpiryDays,
    tokenExpiryHours,
    tokenExpired,
    sensexAutoEnabled: engine.autoEnabled,
    niftyAutoEnabled:  niftyEngine.autoEnabled,

    maxTrades,
    maxConsecutiveLosses,
    sensexTradesToday: sensexToday.length,
    niftyTradesToday:  niftyToday.length,
    sensexConsecLosses,
    niftyConsecLosses,
    sensexStatus,
    niftyStatus,
    overallStatus,
    inMarketHours,
    marketStatus: session.status,
    minsToClose
  });
});

// Emergency stop: disable both instrument auto-engines immediately
app.post('/api/risk/emergency-stop', (req, res) => {
  try { engine.autoEnabled = false; } catch(_) {}
  try { niftyEngine.autoEnabled = false; } catch(_) {}
  console.log('[risk] EMERGENCY STOP — both auto engines disabled');
  res.json({ ok: true, sensexAutoEnabled: false, niftyAutoEnabled: false });
});

// ==================== TRADE JOURNAL ====================
// Returns the full trade history (both instruments) with optional filters
app.get('/api/journal', (req, res) => {
  const all = [...closedPositions, ...niftyClosedPositions]
    .map((p, idx) => ({
      id:         idx,
      instrument: p.instrument || 'SENSEX',
      signal:     p.signal,
      strike:     p.strike,
      type:       p.type,
      entryPrice: +parseFloat(p.entryPrice || 0).toFixed(2),
      exitPrice:  +parseFloat(p.exitPrice  || 0).toFixed(2),
      lots:       p.lots || 0,
      quantity:   p.quantity || 0,
      deployed:   +parseFloat(p.deployed || 0).toFixed(0),
      finalMult:  +parseFloat(p.finalMult || 0).toFixed(3),
      pnlPct:     +parseFloat(p.finalPnlPct || 0).toFixed(1),
      pnlAbs:     +parseFloat(p.finalPnlAbs || 0).toFixed(0),
      exitReason: p.exitReason || p.status || 'MANUAL',
      enteredAt:  p.enteredAt,
      exitAt:     p.exitAt,
      orbHigh:    +parseFloat(p.orbHigh || 0).toFixed(2),
      orbLow:     +parseFloat(p.orbLow  || 0).toFixed(2),
      vwap:       +parseFloat(p.vwap    || 0).toFixed(2),
      paperMode:  !!p.paperMode,
      durationMin: p.enteredAt && p.exitAt
        ? Math.round((new Date(p.exitAt) - new Date(p.enteredAt)) / 60000)
        : 0
    }))
    .sort((a, b) => new Date(b.exitAt) - new Date(a.exitAt));

  const { inst, signal, outcome, reason, from, to } = req.query;
  const filtered = all.filter(t => {
    if (inst    && inst    !== 'ALL' && t.instrument !== inst) return false;
    if (signal  && signal  !== 'ALL' && t.signal     !== signal) return false;
    if (reason  && reason  !== 'ALL' && t.exitReason !== reason) return false;
    if (outcome === 'WIN'  && t.pnlAbs <= 0) return false;
    if (outcome === 'LOSS' && t.pnlAbs >= 0) return false;
    if (from && new Date(t.exitAt) < new Date(from)) return false;
    if (to   && new Date(t.exitAt) > new Date(to))   return false;
    return true;
  });

  const reasons = [...new Set(all.map(t => t.exitReason))].sort();
  res.json({ trades: filtered, total: all.length, matched: filtered.length, reasons });
});

// ==================== P&L CALENDAR HEATMAP ====================
// Returns daily P&L aggregated from closed trades for the last N days.
// Shape: { days: [{ date:"2026-04-22", pnl, trades, wins, losses }], monthStart, monthLabel, best, worst, best2, totals }
app.get('/api/pnl-calendar', (req, res) => {
  const monthsBack = Math.max(0, Math.min(11, parseInt(req.query.monthsBack) || 0));
  const all = [...closedPositions, ...niftyClosedPositions];

  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const monthStart = new Date(target.getFullYear(), target.getMonth(), 1);
  const monthEnd   = new Date(target.getFullYear(), target.getMonth() + 1, 0); // last day
  const daysInMonth = monthEnd.getDate();

  const byDay = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${target.getFullYear()}-${String(target.getMonth()+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    byDay[key] = { date: key, day: d, pnl: 0, trades: 0, wins: 0, losses: 0 };
  }

  for (const t of all) {
    if (!t.exitAt) continue;
    const dt = new Date(t.exitAt);
    if (dt < monthStart || dt > new Date(monthEnd.getTime() + 86399999)) continue;
    const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    const bucket = byDay[key];
    if (!bucket) continue;
    const pnl = parseFloat(t.finalPnlAbs || 0);
    bucket.pnl += pnl;
    bucket.trades += 1;
    if (pnl > 0) bucket.wins += 1;
    else if (pnl < 0) bucket.losses += 1;
  }

  const days = Object.values(byDay).map(d => ({ ...d, pnl: +d.pnl.toFixed(0) }));
  const traded = days.filter(d => d.trades > 0);
  const best  = traded.reduce((b, d) => (!b || d.pnl > b.pnl) ? d : b, null);
  const worst = traded.reduce((b, d) => (!b || d.pnl < b.pnl) ? d : b, null);

  const totalPnl = days.reduce((s, d) => s + d.pnl, 0);
  const tradingDays = traded.length;
  const winDays = traded.filter(d => d.pnl > 0).length;

  res.json({
    monthStart: monthStart.toISOString().slice(0,10),
    monthLabel: monthStart.toLocaleString('en-IN', { month:'long', year:'numeric' }),
    firstWeekday: monthStart.getDay(),
    daysInMonth,
    days,
    best, worst,
    totals: {
      pnl: +totalPnl.toFixed(0),
      trades: traded.reduce((s, d) => s + d.trades, 0),
      tradingDays,
      winDays,
      loseDays: tradingDays - winDays,
      dayWinRate: tradingDays ? +(winDays / tradingDays * 100).toFixed(1) : 0
    }
  });
});

// ==================== PERFORMANCE ANALYTICS ====================
// Aggregates closed positions (both SENSEX + NIFTY) into trading stats:
// win rate, profit factor, avg win/loss, expectancy, max drawdown, streaks,
// and breakdowns by instrument / signal / exit reason.
app.get('/api/performance', (req, res) => {
  const all = [...closedPositions, ...niftyClosedPositions]
    .sort((a, b) => new Date(a.exitAt) - new Date(b.exitAt));

  if (!all.length) {
    return res.json({
      totalTrades: 0, wins: 0, losses: 0, winRate: 0,
      grossProfit: 0, grossLoss: 0, netPnl: 0,
      avgWin: 0, avgLoss: 0, profitFactor: 0, expectancy: 0,
      bestTrade: 0, worstTrade: 0, maxDrawdown: 0,
      currentStreak: 0, longestWinStreak: 0, longestLossStreak: 0,
      byInstrument: {}, bySignal: {}, byExitReason: {},
      equityCurve: [], recentTrades: []
    });
  }

  const pnlOf = p => parseFloat(p.finalPnlAbs || 0);
  const wins     = all.filter(p => pnlOf(p) > 0);
  const losses   = all.filter(p => pnlOf(p) < 0);
  const grossProfit = wins.reduce((s, p) => s + pnlOf(p), 0);
  const grossLoss   = Math.abs(losses.reduce((s, p) => s + pnlOf(p), 0));
  const netPnl      = grossProfit - grossLoss;
  const avgWin      = wins.length   ? grossProfit / wins.length    : 0;
  const avgLoss     = losses.length ? grossLoss   / losses.length  : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
  const expectancy  = netPnl / all.length;
  const bestTrade   = Math.max(...all.map(pnlOf));
  const worstTrade  = Math.min(...all.map(pnlOf));

  // Max drawdown from equity curve
  let cumPnl = 0, peak = 0, maxDD = 0;
  const equityCurve = all.map(p => {
    cumPnl += pnlOf(p);
    if (cumPnl > peak) peak = cumPnl;
    const dd = peak - cumPnl;
    if (dd > maxDD) maxDD = dd;
    return { t: p.exitAt, pnl: +cumPnl.toFixed(0), drawdown: +dd.toFixed(0) };
  });

  // Streaks
  let cur = 0, curDir = 0, longestWin = 0, longestLoss = 0;
  for (const p of all) {
    const v = pnlOf(p);
    const dir = v > 0 ? 1 : v < 0 ? -1 : 0;
    if (dir === curDir && dir !== 0) cur++;
    else { cur = dir !== 0 ? 1 : 0; curDir = dir; }
    if (curDir > 0 && cur > longestWin) longestWin = cur;
    if (curDir < 0 && cur > longestLoss) longestLoss = cur;
  }
  const currentStreak = curDir * cur;

  // Breakdowns
  const bucket = (keyFn) => {
    const m = {};
    for (const p of all) {
      const k = keyFn(p) || '--';
      if (!m[k]) m[k] = { trades: 0, wins: 0, pnl: 0 };
      m[k].trades++;
      if (pnlOf(p) > 0) m[k].wins++;
      m[k].pnl += pnlOf(p);
    }
    for (const k of Object.keys(m)) {
      m[k].winRate = m[k].trades ? +(m[k].wins / m[k].trades * 100).toFixed(1) : 0;
      m[k].pnl     = +m[k].pnl.toFixed(0);
    }
    return m;
  };

  res.json({
    totalTrades:  all.length,
    wins:         wins.length,
    losses:       losses.length,
    winRate:      +(wins.length / all.length * 100).toFixed(1),
    grossProfit:  +grossProfit.toFixed(0),
    grossLoss:    +grossLoss.toFixed(0),
    netPnl:       +netPnl.toFixed(0),
    avgWin:       +avgWin.toFixed(0),
    avgLoss:      +avgLoss.toFixed(0),
    profitFactor: Number.isFinite(profitFactor) ? +profitFactor.toFixed(2) : 99.99,
    expectancy:   +expectancy.toFixed(0),
    bestTrade:    +bestTrade.toFixed(0),
    worstTrade:   +worstTrade.toFixed(0),
    maxDrawdown:  +maxDD.toFixed(0),
    currentStreak, longestWinStreak: longestWin, longestLossStreak: longestLoss,
    byInstrument: bucket(p => p.instrument || 'SENSEX'),
    bySignal:     bucket(p => p.signal),
    byExitReason: bucket(p => p.exitReason || p.status),
    equityCurve:  equityCurve.slice(-60),
    recentTrades: all.slice(-8).reverse().map(p => ({
      instrument: p.instrument || 'SENSEX',
      signal:     p.signal,
      strike:     p.strike,
      type:       p.type,
      entry:      +parseFloat(p.entryPrice).toFixed(1),
      exit:       +parseFloat(p.exitPrice).toFixed(1),
      pnl:        +pnlOf(p).toFixed(0),
      reason:     p.exitReason || p.status,
      exitAt:     p.exitAt
    }))
  });
});

// ==================== FULL OPTION CHAIN (with H/L history) ====================
// Returns a wider strike slice (ATM ± depth) for both CE + PE with full
// session H/L timelines per contract. Drives the full-screen chain panel.
app.get('/api/option-chain-full', async (req, res) => {
  const inst = String(req.query.inst || 'SENSEX').toUpperCase();
  const depth = Math.min(15, Math.max(1, parseInt(req.query.depth) || 7));
  try {
    const meta = getInstrumentMeta(inst);
    const spot = await meta.priceGetter();
    const chain = await meta.chainGetter(spot);
    const interval = meta.step;
    const atm      = Math.round(spot / interval) * interval;

    const targetStrikes = [];
    for (let o = -depth; o <= depth; o++) targetStrikes.push(atm + o * interval);

    const fmtT = (ms) => ms ? new Date(ms + 5.5*3600*1000).toISOString().slice(11, 19) : null;

    const rows = targetStrikes.map(strike => {
      const row = chain.strikes.find(r => r.strike === strike);
      if (!row) return { strike, ce: null, pe: null, isATM: strike === atm };
      const buildLeg = (leg, type) => {
        if (!leg) return null;
        const ltp       = Number(leg.ltp || 0);
        const prevClose = Number(leg.prevClose || leg.close || 0);
        const chng      = prevClose ? ltp - prevClose : 0;
        _updateOptHL(inst, strike, type, ltp);
        const hl = _getOptHL(inst, strike, type) || {};
        const pathOut = (arr) => (arr || []).map(e => ({ time: fmtT(e.t), price: +e.p.toFixed(2), ts: e.t }));
        return {
          ltp:       +ltp.toFixed(2),
          high:      +(Number(leg.high || hl.high || 0)).toFixed(2),
          low:       +(Number(leg.low  || hl.low  || 0)).toFixed(2),
          chng:      +chng.toFixed(2),
          chngPct:   prevClose ? +((chng / prevClose) * 100).toFixed(2) : 0,
          bid:       +Number(leg.bid || 0).toFixed(2),
          ask:       +Number(leg.ask || 0).toFixed(2),
          volume:    Number(leg.volume || 0),
          oi:        Number(leg.oi || 0),
          changeOI:  Number(leg.changeOI || 0),
          prevClose: +prevClose.toFixed(2),
          iv:        +Number(leg.iv || 0).toFixed(2),
          // Session H/L history (first = day-open baseline, last = current extreme)
          highHistory: pathOut(hl.highPath),
          lowHistory:  pathOut(hl.lowPath),
          highAt:      hl.highAt ? fmtT(hl.highAt) : null,
          lowAt:       hl.lowAt  ? fmtT(hl.lowAt)  : null
        };
      };
      return { strike, isATM: strike === atm, ce: buildLeg(row.ce, 'CE'), pe: buildLeg(row.pe, 'PE') };
    });

    res.json({ inst, spot: +spot.toFixed(2), atm, interval, depth, rows, ts: Date.now() });
  } catch (err) {
    if (err?.code === 'DHAN_AUTH' || err?.code === 'DHAN_AUTH_BLOCKED' || err?.status === 401 || err?.status === 403) {
      return res.status(503).json({ error: err.message, code: 'DHAN_AUTH_REQUIRED', refreshUrl: '/api/dhan/login', rows: [] });
    }
    res.status(500).json({ error: err.message, rows: [] });
  }
});

// Date-wise archived option H/L. ?date=YYYY-MM-DD (default today) [&inst=NIFTY]
app.get('/api/opthl-archive', (req, res) => {
  try {
    const fs2 = require('fs'), path2 = require('path');
    const date = String(req.query.date || _istDateStr()).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'date=YYYY-MM-DD required' });
    const file = path2.join(_optHLDir, `${date}.json`);
    if (!fs2.existsSync(file)) {
      let availableDates = [];
      try { availableDates = fs2.readdirSync(_optHLDir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')).sort(); } catch (_) {}
      return res.status(404).json({ error: 'no archive for ' + date, availableDates });
    }
    const data = JSON.parse(fs2.readFileSync(file, 'utf8'));
    const inst = req.query.inst ? String(req.query.inst).toUpperCase() : null;
    if (inst) return res.json({ date: data.date, savedAt: data.savedAt, inst, strikes: (data.strikes || {})[inst] || {} });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/option-strike-history', async (req, res) => {
  const inst = String(req.query.inst || 'SENSEX').toUpperCase();
  const strike = parseInt(req.query.strike, 10);
  if (!Number.isFinite(strike)) {
    return res.status(400).json({ error: 'strike query is required' });
  }
  try {
    const meta = getInstrumentMeta(inst);
    const spot = await meta.priceGetter();
    const chain = await meta.chainGetter(spot);
    const interval = meta.step;
    const atm = Math.round(spot / interval) * interval;
    const row = chain.strikes.find(r => Number(r.strike) === Number(strike));
    if (!row) {
      return res.status(404).json({ error: 'Strike not found', inst, strike, atm, spot: +spot.toFixed(2) });
    }
    const buildLeg = (leg, type) => {
      if (!leg) return null;
      return _withLegHistory(inst, strike, {
        ltp: +Number(leg.ltp || 0).toFixed(2),
        high: +Number(leg.high || 0).toFixed(2),
        low: +Number(leg.low || 0).toFixed(2),
        bid: +Number(leg.bid || 0).toFixed(2),
        ask: +Number(leg.ask || 0).toFixed(2),
        oi: Number(leg.oi || 0),
        changeOI: Number(leg.changeOI || 0),
        volume: Number(leg.volume || 0),
        iv: +Number(leg.iv || 0).toFixed(2)
      }, type);
    };
    // Reconcile with today's one-minute candles before returning the cards.
    // Calls are coalesced and limited to once per minute per contract.
    await Promise.all([
      _backfillOptHLFromDhan(inst, strike, 'CE', row.ce?.securityId),
      _backfillOptHLFromDhan(inst, strike, 'PE', row.pe?.securityId)
    ]);
    const session = getMarketSession();
    res.json({
      inst,
      strike,
      spot: +spot.toFixed(2),
      atm,
      interval,
      isATM: strike === atm,
      ce: buildLeg(row.ce, 'CE'),
      pe: buildLeg(row.pe, 'PE'),
      marketStatus: session.status,
      ts: Date.now()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== MARKET QUOTES WATCHLIST ====================
// Full market quote data (LTP, Low, High, Chng, %Chng, Bid, Ask, Volume, OI,
// Open, Prev Close, UCL, LCL, 52W High/Low, Avg Price) for ATM-2..ATM+2 CE & PE
app.get('/api/watchlist', async (req, res) => {
  const inst = String(req.query.inst || 'SENSEX').toUpperCase();
  try {
    const meta = getInstrumentMeta(inst);
    const spot = await meta.priceGetter();
    const chain = await meta.chainGetter(spot);
    const interval = meta.step;
    const atm      = Math.round(spot / interval) * interval;
    const seg      = meta.segment;

    const targetStrikes = [-2, -1, 0, 1, 2].map(o => atm + o * interval);
    const legsMeta = [];
    const secIds = [];
    for (const s of targetStrikes) {
      const row = chain.strikes.find(x => x.strike === s);
      if (!row) continue;
      const pushLeg = (leg, type) => {
        const secId = leg?.securityId;
        legsMeta.push({ strike: s, type, secId: secId ? String(secId) : null, chain: leg || {} });
        if (secId) secIds.push(Number(secId));
      };
      pushLeg(row.ce, 'CE');
      pushLeg(row.pe, 'PE');
    }

    // Try the quote endpoint (for UCL/LCL/52W which chain doesn't provide) but don't block
    // the response on it — timeout fast and fall back to chain-only data.
    let fq = {};
    if (secIds.length && live.client) {
      try {
        const r = await Promise.race([
          live.client._post('/v2/marketfeed/quote', { [seg]: secIds }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('quote timeout')), 2000))
        ]);
        fq = r?.data?.[seg] || {};
      } catch (err) {
        // Silent fallback — chain has everything except circuit limits & 52W
      }
    }

    const rows = legsMeta.map(m => {
      const c = m.chain;
      const d = fq[m.secId] || {};
      const ohlc = d.ohlc || {};
      const ltp  = Number(d.last_price ?? d.ltp ?? c.ltp ?? 0);
      const prevClose = Number(ohlc.close ?? d.previous_close ?? c.prevClose ?? c.close ?? 0);
      const chng = prevClose ? ltp - prevClose : 0;
      const chngPct = prevClose ? (chng / prevClose) * 100 : 0;
      // Feed the live tick into the session H/L tracker, then read it back. Upstox
      // option quotes don't carry intraday OHLC (ohlc.high/low come back empty),
      // so without this the watchlist Low/High columns stay 0 → render as "--".
      if (ltp > 0) _updateOptHL(inst, m.strike, m.type, ltp);
      const hl = _getOptHL(inst, m.strike, m.type) || {};
      // Prefer the broker quote/chain OHLC, but those come back as 0 for Upstox
      // options (not null), so `??` wouldn't fall through — use the session
      // H/L tracker as the real intraday extreme. `||` skips the 0s correctly.
      const high = Number(ohlc.high || c.high || hl.high || 0);
      const low  = Number(ohlc.low  || c.low  || hl.low  || 0);
      // Typical price = (H+L+C)/3 when exchange avg not provided
      const avg  = Number(d.average_price ?? d.avg_price ?? 0)
                || (high && low && ltp ? (high + low + ltp) / 3 : 0);
      // UCL/LCL: if quote didn't provide, default to ±20% of prev close (NSE/BSE daily band)
      const ucl = Number(d.upper_circuit_limit ?? d.upper_circuit ?? 0)
                || (prevClose ? prevClose * 1.2 : 0);
      const lcl = Number(d.lower_circuit_limit ?? d.lower_circuit ?? 0)
                || (prevClose ? prevClose * 0.8 : 0);
      return {
        label: `${inst} ${m.strike} ${m.type}`,
        strike: m.strike, type: m.type,
        ltp:      +ltp.toFixed(2),
        low:      +low.toFixed(2),
        high:     +high.toFixed(2),
        chng:     +chng.toFixed(2),
        chngPct:  +chngPct.toFixed(2),
        bid:      +Number(d.buy_price  ?? d.best_bid_price ?? c.bid ?? 0).toFixed(2),
        ask:      +Number(d.sell_price ?? d.best_ask_price ?? c.ask ?? 0).toFixed(2),
        volume:   Number(d.volume ?? c.volume ?? 0),
        oi:       Number(d.oi ?? d.open_interest ?? c.oi ?? 0),
        open:     +Number(ohlc.open ?? d.open ?? c.open ?? 0).toFixed(2),
        prevClose:+prevClose.toFixed(2),
        ucl:      +ucl.toFixed(2),
        lcl:      +lcl.toFixed(2),
        wkHigh:   +Number(d.fifty_two_week_high ?? d.week_52_high ?? high).toFixed(2),
        wkLow:    +Number(d.fifty_two_week_low  ?? d.week_52_low  ?? low).toFixed(2),
        avgPrice: +avg.toFixed(2)
      };
    });

    res.json({ rows, spot, atm, inst, seg, source: Object.keys(fq).length ? 'dhan' : 'chain' });
  } catch (err) {
    if (err?.code === 'DHAN_AUTH' || err?.code === 'DHAN_AUTH_BLOCKED' || err?.status === 401 || err?.status === 403) {
      return res.status(503).json({
        error: 'Dhan authentication required',
        code: 'DHAN_AUTH_REQUIRED',
        refreshUrl: '/api/dhan/login',
        rows: []
      });
    }
    console.error('[watchlist] error:', err.message);
    res.status(500).json({ error: err.message, rows: [] });
  }
});

// ==================== BOT ENGINE ====================
function runBotEngine() {
  resetDailyCheck();

  const session = getMarketSession();
  if (!session.inMarketHours) {
    clearSignalsForClosedMarket(session);
    return;
  }
  if (!botRunning) return;

  // Morning engines
  engine.tick().catch(err => console.error('[engine] tick error:', err.message));
  // NIFTY engine offset by 2.5s to avoid simultaneous Dhan API calls
  setTimeout(() => niftyEngine.tick().catch(err => console.error('[nifty-engine] tick error:', err.message)), 2500);

  // Afternoon engines — offset by 3.5s/4s to stagger Dhan API calls.
  // AfternoonEngine.tick() internally checks its own 12:00-14:30 entry window
  // and 15:10 EOD exit, so it's safe to call every cycle.
  setTimeout(() => {
    afternoonEngine.tick().catch(err => console.error('[sensex-afternoon] tick error:', err.message));
  }, 3500);
  setTimeout(() => {
    niftyAfternoonEngine.tick().catch(err => console.error('[nifty-afternoon] tick error:', err.message));
  }, 4000);

  // Bounce + Strangle engines (paper) — feed the live NIFTY chain once per loop.
  if (bounceEngine.enabled || strangleEngine.enabled) {
    setTimeout(() => {
      live.getNiftyOptionChain(_niftyLivePrice)
        .then(chain => {
          const feed = { atm: chain.atmStrike, interval: 50, rows: chain.strikes, expiry: chain.expiry };
          if (bounceEngine.enabled)   bounceEngine.update('NIFTY', feed);
          if (strangleEngine.enabled) strangleEngine.update('NIFTY', feed);
        })
        .catch(() => {});
    }, 4500);
  }
}

// Run bot engine every 5 seconds
setInterval(runBotEngine, 5000);


// ==================== TRADINGVIEW WEBHOOK ====================
// TradingView alert → POST /api/webhook/tradingview
// Payload (set in TradingView alert message):
// {"action":"BUY","signal":"CALL","strike":"{{plot_0}}","entry":"{{plot_1}}","reason":"POWER_TREND","key":"antigravity"}
//
// Setup in TradingView:
//   1. Add alert on SENSEX Expiry v2 indicator
//   2. Condition: "BUY / SELL SINGLE" plot changes
//   3. Webhook URL: http://YOUR_IP:3000/api/webhook/tradingview
//   4. Message: {"action":"{{strategy.order.action}}","signal":"CALL","key":"antigravity"}

app.post("/api/webhook/tradingview", async (req, res) => {
  const body = req.body;

  // Auth check
  const key = body.key || req.headers['x-api-key'];
  const expectedKey = process.env.AMIBROKER_API_KEY || 'antigravity';
  if (key !== expectedKey) {
    console.warn('[webhook/tv] Rejected — bad key');
    return res.status(401).json({ error: 'unauthorized' });
  }

  let action  = (body.action  || '').toUpperCase();   // BUY | SELL | EXIT
  let signal  = (body.signal  || '').toUpperCase();   // CALL | PUT | BULLISH | BEARISH
  const strike  = body.strike  || null;
  const entry   = parseFloat(body.entry)  || 0;
  const reason  = body.reason  || 'TV_ALERT';
  const conf    = body.conf    || 'HIGH';
  const index   = (body.index  || '').toUpperCase();  // optional: NIFTY | SENSEX from the Pine ticker

  // Accept the simpler BULLISH/BEARISH wording (some Pine alerts emit only signal):
  // BULLISH → BUY CALL, BEARISH → BUY PUT.
  if (signal === 'BULLISH') { action = action || 'BUY'; signal = 'CALL'; }
  else if (signal === 'BEARISH') { action = action || 'BUY'; signal = 'PUT'; }

  console.log(`[webhook/tv] ${action} ${signal} strike=${strike} entry=${entry} index=${index} reason=${reason}`);

  // ── EXIT signal ──
  if (action === 'EXIT' || action === 'SELL' || signal === 'EXIT') {
    if (openPosition) {
      console.log('[webhook/tv] Exit signal — closing position');
      openPosition.status = 'TV_EXIT';
    }
    return res.json({ ok: true, action: 'EXIT' });
  }

  // ── BUY signal (CALL or PUT) ──
  if ((action === 'BUY' || action === 'ALERT') && (signal === 'CALL' || signal === 'PUT')) {
    const session = getMarketSession();
    if (!session.inMarketHours) {
      clearSignalsForClosedMarket(session);
      console.log(`[webhook/tv] Market closed (${session.status}) - ignoring ${signal} signal`);
      return res.json({ ok: false, reason: session.status, signal: 'WAIT' });
    }

    // Rate limit: max trades per day
    resetDailyCheck();
    const maxTrades = parseInt(process.env.MAX_TRADES_PER_DAY || 2);
    if (tradesToday >= maxTrades) {
      console.log(`[webhook/tv] Max trades/day reached (${tradesToday}/${maxTrades}) — skipping`);
      return res.json({ ok: false, reason: 'max_trades_reached' });
    }

    const price = await getLivePrice().catch(() => entry || 75000);
    const atm   = Math.round(price / 100) * 100;
    const strikeNum = strike ? parseInt(strike) : (signal === 'CALL' ? atm : atm);
    const optType   = signal === 'CALL' ? 'CE' : 'PE';
    const symbol    = `SENSEX-${strikeNum}-${optType}`;

    // Paper or Live
    const tradeMode = process.env.TRADE_MODE || 'paper';
    let orderId = null;
    let orderStatus = 'PAPER';

    if (tradeMode === 'live' && live.connected) {
      try {
        const liveResult = await live.placeOrder({
          transactionType: 'BUY',
          exchangeSegment: 'BFO',
          productType: 'INTRADAY',
          orderType: 'MARKET',
          securityId: symbol,
          quantity: 1,
          price: 0
        });
        orderId = liveResult.orderId;
        orderStatus = liveResult.status || 'SENT';
        console.log(`[webhook/tv] Live order placed: ${orderId} — ${orderStatus}`);
      } catch (e) {
        console.error('[webhook/tv] Live order failed:', e.message);
        orderStatus = 'ERROR: ' + e.message;
      }
    } else {
      console.log(`[webhook/tv] Paper mode — logged ${signal} ${strikeNum}${optType}`);
    }

    tradesToday++;
    currentSignal   = signal;
    suggestedStrike = `${strikeNum} ${optType}`;

    // ── Claude AI narration → Telegram (non-blocking, opt-in via CLAUDE_AI_ENABLED) ──
    // Never blocks the webhook response — fire-and-forget with its own 6s internal timeout.
    (async () => {
      try {
        const narration = await claudeTradeNarration('ENTRY', {
          instrument: index || 'SENSEX',
          signal: optType, strike: strikeNum, premium: entry || price,
          tradeMode, confidence: conf, vwap: undefined,
        });
        if (narration && telegram?.enabled) {
          await telegram.sendAlert(`🤖 ${index || 'SENSEX'} ${signal} ${strikeNum}${optType}`, narration).catch(() => {});
        } else if (narration) {
          console.log(`[webhook/tv] Claude: ${narration}`);
        }
      } catch (e) { console.warn('[webhook/tv] Claude narration skipped:', e.message); }
    })();

    return res.json({
      ok: true,
      action: 'BUY',
      signal,
      strike: strikeNum,
      optType,
      orderStatus,
      orderId,
      tradeMode,
      claudeEnabled: process.env.CLAUDE_AI_ENABLED === 'true'
    });
  }

  res.json({ ok: true, received: body });
});

// ── Webhook status ──
app.get("/api/webhook/status", (_req, res) => {
  res.json({
    endpoint: 'POST /api/webhook/tradingview',
    tradeMode: process.env.TRADE_MODE || 'paper',
    tradesToday,
    maxTrades: parseInt(process.env.MAX_TRADES_PER_DAY || 2),
    dhanConnected: live.connected
  });
});

// ==================== START SERVER ====================
// Bind to 0.0.0.0 so the bot is reachable on the LAN and from a reverse
// proxy (e.g. Caddy/nginx forwarding sareetex.in → localhost:3000).
const PUBLIC_BASE = process.env.PUBLIC_API_BASE_URL || `http://localhost:${PORT}`;
// ── Restore intraday data from Redis after restart ────────────────────────────
async function _restoreFromRedis() {
  const today = _istDateStr();
  for (const inst of ['SENSEX', 'NIFTY', 'BANKNIFTY']) {
    try {
      const hl = await redisStore.loadHL(inst);
      if (hl && hl.date === today) {
        _hlRecord[inst].date     = hl.date;
        _hlRecord[inst].high     = hl.high;
        _hlRecord[inst].highAt   = hl.highAt;
        _hlRecord[inst].low      = hl.low;
        _hlRecord[inst].lowAt    = hl.lowAt;
        _hlRecord[inst].highPath = hl.highPath || [];
        _hlRecord[inst].lowPath  = hl.lowPath  || [];
        _hlRecord[inst].chainLog = hl.chainLog  || [];
        console.log(`[redis] Restored ${inst} H/L — high:${hl.high} low:${hl.low}`);
      }
    } catch (e) {
      console.warn(`[redis] restore ${inst} H/L error:`, e.message);
    }
  }

  for (const inst of ['SENSEX', 'NIFTY']) {
    try {
      // ORB
      const orb = await redisStore.loadORB(inst);
      if (orb && orb.date === today) {
        if (inst === 'NIFTY') { niftyOrbHigh = orb.orbHigh; niftyOrbLow = orb.orbLow; }
        else                  { orbHigh = orb.orbHigh;      orbLow = orb.orbLow; }
        console.log(`[redis] Restored ${inst} ORB — H:${orb.orbHigh} L:${orb.orbLow}`);
      }

      // Breakout events
      const bo = await redisStore.loadBreakouts(inst);
      if (bo && bo.length) {
        _breakoutLog[inst].date   = today;
        _breakoutLog[inst].events = bo;
        console.log(`[redis] Restored ${inst} ${bo.length} breakout events`);
      }

      // Reversal events
      const rv = await redisStore.loadReversals(inst);
      if (rv && rv.length) {
        _reversalLog[inst].date   = today;
        _reversalLog[inst].events = rv;
        console.log(`[redis] Restored ${inst} ${rv.length} reversal events`);
      }
    } catch (e) {
      console.warn(`[redis] restore ${inst} error:`, e.message);
    }
  }

  // Restore per-strike option H/L record timelines (survive restart, not just spot).
  try {
    const recs = await redisStore.loadAllOptHL();
    let n = 0;
    for (const { inst, strike, type, rec } of recs) {
      if (!_optHL[inst]) continue;
      _optHL[inst].set(_optHLKey(Number(strike), type), {
        date: rec.date, high: rec.high, highAt: rec.highAt, low: rec.low, lowAt: rec.lowAt,
        highPath: rec.highPath || [], lowPath: rec.lowPath || [], tickPath: rec.tickPath || []
      });
      n++;
    }
    // Mark today's purge as already done so the first chain access does NOT clear
    // the records we just restored (the new-day purge fires when date != last-seen).
    if (n) { _optHLPurgeDate = _istDateStr(); console.log(`[redis] Restored ${n} option-strike H/L records`); }
  } catch (e) {
    console.warn('[redis] restore optHL error:', e.message);
  }
}

app.listen(PORT, '0.0.0.0', async () => {
  // Connect Redis + restore today's high/low data
  await redisStore.connect();
  await _restoreFromRedis();
  await liveConnectPromise;

  console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   ANTIGRAVITY AI BOT - SENSEX EXPIRY SYSTEM             ║
║                                                          ║
║   Listening on 0.0.0.0:${PORT}                              ║
║   Mode: ${live.connected ? "LIVE (Dhan)" : "DISCONNECTED - set DHAN creds"}    ║
║   Max trades/day: ${process.env.MAX_TRADES_PER_DAY || 2}                                      ║
║   Redis: ${redisStore.isReady() ? "ON (high/low persisted)" : "OFF (in-memory only)"}
║   Public: ${PUBLIC_BASE}
║   Local:  http://localhost:${PORT}/dashboard.html
║                                                          ║
╚══════════════════════════════════════════════════════════╝
  `);

  // Apply persisted engine-state overrides LAST (after all env-based init) so they
  // win across restarts: hedged-selling forward-test stays ON, directional autos OFF.
  try {
    if (typeof _cfgOverrides?.STRANGLE_ENGINE_ENABLED === 'boolean') strangleEngine.enabled = _cfgOverrides.STRANGLE_ENGINE_ENABLED;
    if (_cfgOverrides?.NIFTY_DIRECTIONAL_AUTO === false && niftyEngine?.setAutoEnabled) niftyEngine.setAutoEnabled(false);
    if (_cfgOverrides?.SENSEX_DIRECTIONAL_AUTO === false && engine?.setAutoEnabled) engine.setAutoEnabled(false);
    console.log(`[config] engine-state applied → strangle=${strangleEngine.enabled} niftyAuto=${niftyEngine?.autoEnabled} sensexAuto=${engine?.autoEnabled}`);
  } catch (e) { console.warn('[config] engine-state apply failed:', e.message); }
});

// ==================== GRACEFUL SHUTDOWN ====================
// Bug fix: previously NO exit handler existed, so on Ctrl+C / PM2 restart / SIGTERM
// the process died without flushing — losing the latest market state AND any EOD
// snapshot (which only wrote every 5 min during market hours). Now we synchronously
// persist everything before exit, so a restart never wipes the day.
let _shuttingDown = false;
function _gracefulShutdown(sig) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  try {
    console.log(`\n[shutdown] ${sig} received — flushing state before exit…`);
    // 1. Cancel any pending debounced write and flush market state immediately.
    if (_persistTimer) { clearTimeout(_persistTimer); _persistTimer = null; }
    _writeMarketState();
    // 2. Always snapshot EOD on shutdown (even outside market hours / mid-session),
    //    so the day's trades + P&L are never lost to a restart.
    const dayStr = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
    _persistEod(dayStr, false);
    // 3. Persist ORB to Redis (best-effort, non-blocking).
    try {
      if (orbHigh && orbLow) redisStore.saveORB('SENSEX', orbHigh, orbLow).catch(() => {});
      if (niftyOrbHigh && niftyOrbLow) redisStore.saveORB('NIFTY', niftyOrbHigh, niftyOrbLow).catch(() => {});
    } catch (_) {}
    console.log('[shutdown] state flushed → market-state.json + eod-' + dayStr + '.json');
  } catch (e) {
    console.warn('[shutdown] flush error:', e.message);
  }
  // Give Redis a brief moment to flush, then exit.
  setTimeout(() => process.exit(0), 400);
}
process.on('SIGINT',  () => _gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => _gracefulShutdown('SIGTERM'));
process.on('SIGHUP',  () => _gracefulShutdown('SIGHUP'));

module.exports = app;
