const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { calculateVWAP } = require("./strategy");
const { aiDecision } = require("./ai");
const OptionAnalyzer = require("./option-analyzer");
const SimpleDB = require("./database");
const LiveConnector = require("./live-connector");
const KotakNeoConnector = require("./kotak-neo-connector");
const { getChainAroundATM } = require("./sensibull-fetcher");
const AmiBrokerBridge = require("./amibroker-bridge");
const ExecutionEngine = require("./execution-engine");

const app = express();
// CORS allow-list from env (comma-separated origins). Empty = allow any.
const _corsAllow = (process.env.CORS_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: _corsAllow.length === 0
    ? true
    : (origin, cb) => {
        // Server-to-server / curl requests have no Origin header — allow.
        if (!origin) return cb(null, true);
        if (_corsAllow.includes(origin)) return cb(null, true);
        return cb(new Error(`CORS blocked: ${origin}`));
      },
  credentials: true
}));
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

// ── CONNECTOR SELECTION ──────────────────────────────────────────
// Set LIVE_CONNECTOR=kotak  → use Kotak Neo
// Set LIVE_CONNECTOR=dhan   → use Dhan
// Set LIVE_CONNECTOR=auto   → try Kotak first, fallback to Dhan
const CONNECTOR_MODE = (process.env.LIVE_CONNECTOR || 'auto').toLowerCase();
let live;
if (CONNECTOR_MODE === 'kotak') {
  live = new KotakNeoConnector();
  console.log('[server] Using Kotak Neo connector');
} else if (CONNECTOR_MODE === 'dhan') {
  live = new LiveConnector({ dhanClientId: process.env.DHAN_CLIENT_ID, dhanAccessToken: process.env.DHAN_ACCESS_TOKEN });
  console.log('[server] Using Dhan connector');
} else {
  const kotakKey = process.env.KOTAK_CONSUMER_KEY;
  if (kotakKey && kotakKey !== 'your_consumer_key_here') {
    live = new KotakNeoConnector();
    console.log('[server] AUTO — Kotak Neo connector selected');
  } else {
    live = new LiveConnector({ dhanClientId: process.env.DHAN_CLIENT_ID, dhanAccessToken: process.env.DHAN_ACCESS_TOKEN });
    console.log('[server] AUTO — Dhan connector selected (Kotak key not set)');
  }
}

// Initialize Option Analyzer, Database
const optionAnalyzer = new OptionAnalyzer();
const database = new SimpleDB('./data');
const amiBridge = new AmiBrokerBridge();
live.connect().catch(err => console.error('[live] connect failed:', err.message));

// ==================== STATE — SENSEX ====================
let botRunning = false;
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

async function _fetchYahooPrice() {
  if (Date.now() - _yahooPriceAt < 60000 && _yahooPrice > 0) return _yahooPrice;
  try {
    const YahooFinance = require('yahoo-finance2').default;
    const yf = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] });
    const q = await yf.quote('^BSESN');
    const p = q.regularMarketPrice || q.regularMarketPreviousClose || 0;
    if (p > 10000) { _yahooPrice = p; _yahooPriceAt = Date.now(); }
  } catch (_) { /* use cached */ }
  return _yahooPrice;
}

async function _fetchYahooNiftyPrice() {
  if (Date.now() - _yahooNiftyPriceAt < 60000 && _yahooNiftyPrice > 0) return _yahooNiftyPrice;
  try {
    const YahooFinance = require('yahoo-finance2').default;
    const yf = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] });
    const q = await yf.quote('^NSEI');
    const p = q.regularMarketPrice || q.regularMarketPreviousClose || 0;
    if (p > 10000) { _yahooNiftyPrice = p; _yahooNiftyPriceAt = Date.now(); }
  } catch (_) { /* use cached */ }
  return _yahooNiftyPrice;
}

// ==================== PER-STRIKE OPTION H/L HISTORY ====================
// Tracks LTP high/low history for each option contract (per inst, strike, CE/PE).
// Each breakthrough appends {t, p} — lets the dashboard show full session history.
const _optHL = { SENSEX: new Map(), NIFTY: new Map() };
function _optHLKey(strike, type) { return `${strike}_${type}`; }
function _updateOptHL(inst, strike, type, ltp) {
  if (!ltp || ltp <= 0 || !isFinite(ltp)) return;
  const store = _optHL[inst];
  if (!store) return;
  const today = _istDateStr();
  const key = _optHLKey(strike, type);
  let rec = store.get(key);
  if (!rec || rec.date !== today) {
    rec = { date: today, high: ltp, highAt: Date.now(), low: ltp, lowAt: Date.now(),
            highPath: [{ t: Date.now(), p: ltp }], lowPath: [{ t: Date.now(), p: ltp }] };
    store.set(key, rec);
    return;
  }
  if (ltp > rec.high) {
    rec.high = ltp; rec.highAt = Date.now();
    rec.highPath.push({ t: Date.now(), p: ltp });
    if (rec.highPath.length > 20) rec.highPath.shift();
  }
  if (ltp < rec.low) {
    rec.low = ltp; rec.lowAt = Date.now();
    rec.lowPath.push({ t: Date.now(), p: ltp });
    if (rec.lowPath.length > 20) rec.lowPath.shift();
  }
}
function _getOptHL(inst, strike, type) {
  return _optHL[inst]?.get(_optHLKey(strike, type)) || null;
}

// ==================== HIGH/LOW MAPPING RECORD ====================
// Tracks each time the intraday HIGH or LOW is broken, with timestamps.
// Reset on new IST trading day. Path capped at 50 entries per side to bound memory.
const _hlRecord = {
  SENSEX: { date: '', high: 0, highAt: 0, low: 0, lowAt: 0, highPath: [], lowPath: [] },
  NIFTY:  { date: '', high: 0, highAt: 0, low: 0, lowAt: 0, highPath: [], lowPath: [] }
};
function _istDateStr() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}
function _updateHL(inst, price) {
  if (!price || price < 1) return;
  const rec = _hlRecord[inst];
  if (!rec) return;
  const today = _istDateStr();
  if (rec.date !== today) {
    rec.date = today;
    rec.high = price; rec.highAt = Date.now();
    rec.low  = price; rec.lowAt  = Date.now();
    rec.highPath = [{ t: Date.now(), p: price }];
    rec.lowPath  = [{ t: Date.now(), p: price }];
    return;
  }
  if (price > rec.high) {
    rec.high = price; rec.highAt = Date.now();
    rec.highPath.push({ t: Date.now(), p: price });
    if (rec.highPath.length > 50) rec.highPath.shift();
  }
  if (price < rec.low) {
    rec.low = price; rec.lowAt = Date.now();
    rec.lowPath.push({ t: Date.now(), p: price });
    if (rec.lowPath.length > 50) rec.lowPath.shift();
  }
}

async function getLivePrice() {
  if (Date.now() - _livePriceAt < 5000 && _livePrice > 10000) return _livePrice;
  // Try Dhan first
  try {
    const quote = await live.getSensexPrice();
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
    const quote = await live.getNiftyPrice();
    const p = Number(quote.price);
    if (p > 10000) { _niftyLivePrice = p; _niftyLivePriceAt = Date.now(); _updateHL('NIFTY', p); return _niftyLivePrice; }
  } catch (_) { /* use cached */ }
  return _niftyLivePrice;
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
function _persistMarketState() {
  // Debounced — multiple calls within 2s collapse into one disk write
  if (_persistTimer) return;
  _persistTimer = setTimeout(() => {
    _persistTimer = null;
    try {
      _persistFs.writeFileSync(_persistPath, JSON.stringify({
        date: todayDate,
        sensex: { orbHigh, orbLow, dayHigh, dayLow },
        nifty:  { orbHigh: niftyOrbHigh, orbLow: niftyOrbLow, dayHigh: niftyDayHigh, dayLow: niftyDayLow }
      }));
    } catch (_) { /* best-effort */ }
  }, 2000);
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

// ==================== API ROUTES ====================

// Get live Sensex data (Dhan or demo fallback)
app.get("/api/sensex", async (req, res) => {
  try {
    const quote = await live.getSensexPrice();
    const price = Number(quote.price);
    const volume = Number(quote.volume);

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
        source: 'dhan'
      });
    }

    // Store data
    prices.push(price);
    volumes.push(volume);

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
    if (_changed) _persistMarketState();

    // Calculate VWAP
    vwap = calculateVWAP(prices, volumes);

    // Check volume spike
    const volumeSpike = checkVolumeSpike(volume);

    // Get AI Signal
    const aiResult = aiDecision(price, orbHigh, orbLow, vwap, volumeSpike, hour, minute);
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
    let source = 'dhan';
    try {
      quote = await live.getNiftyPrice();
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

    niftyPrices.push(price);
    niftyVolumes.push(volume);

    let _niftyChanged = false;
    if (hour === 9 && minute <= 30) {
      if (niftyOrbHigh === null || price > niftyOrbHigh) { niftyOrbHigh = price; _niftyChanged = true; }
      if (niftyOrbLow  === null || price < niftyOrbLow)  { niftyOrbLow  = price; _niftyChanged = true; }
    }
    if (hour >= 9) {
      if (niftyDayHigh === null || price > niftyDayHigh) { niftyDayHigh = price; _niftyChanged = true; }
      if (niftyDayLow  === null || price < niftyDayLow)  { niftyDayLow  = price; _niftyChanged = true; }
    }
    if (_niftyChanged) _persistMarketState();

    niftyVwap = calculateVWAP(niftyPrices, niftyVolumes);
    const volumeSpike = niftyVolumes.length >= 5
      ? volume > (niftyVolumes.slice(-10).reduce((a, b) => a + b, 0) / Math.min(niftyVolumes.length, 10)) * 1.5
      : false;

    const aiResult = aiDecision(price, niftyOrbHigh, niftyOrbLow, niftyVwap, volumeSpike, hour, minute);
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

    // Persist new token to .env (preserve every other line as-is)
    let env = _fs.readFileSync(_envPath, 'utf8');
    if (env.match(/^DHAN_ACCESS_TOKEN=/m)) {
      env = env.replace(/^DHAN_ACCESS_TOKEN=.*$/m, `DHAN_ACCESS_TOKEN=${j.accessToken}`);
    } else {
      env += `\nDHAN_ACCESS_TOKEN=${j.accessToken}\n`;
    }
    _fs.writeFileSync(_envPath, env);

    // Apply in-memory + reconnect Dhan client (no restart needed)
    process.env.DHAN_ACCESS_TOKEN = j.accessToken;
    try { if (live && live.client) live.client.accessToken = j.accessToken; } catch (_) {}

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

// Health check
app.get("/api/health", (req, res) => {
  const source = live instanceof KotakNeoConnector ? 'Kotak Neo' : 'Dhan';
  res.json({
    status: "OK",
    mode: live.connected ? `DATA (${source})` : "DISCONNECTED",
    tradeMode: process.env.TRADE_MODE || "paper",
    autoTrading: {
      sensex: engine?.autoEnabled ?? false,
      nifty: niftyEngine?.autoEnabled ?? false
    },
    connector: source,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
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

// Get complete option chain with Greeks
app.get("/api/options/chain", async (req, res) => {
  try {
    const price = await getLivePrice();
    optionAnalyzer.initialize(price, 20);
    const chain = optionAnalyzer.optionChain;
    res.json({
      spotPrice: price.toFixed(2),
      atmStrike: optionAnalyzer.getATMStrike(),
      timestamp: new Date().toISOString(),
      strikes: chain
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch option chain" });
  }
});

// Get PCR (Put Call Ratio)
app.get("/api/options/pcr", async (req, res) => {
  try {
    const price = await getLivePrice();
    optionAnalyzer.initialize(price, 20);
    res.json(optionAnalyzer.calculatePCR());
  } catch (error) {
    res.status(500).json({ error: "Failed to calculate PCR" });
  }
});

// Get Max Pain
app.get("/api/options/maxpain", async (req, res) => {
  try {
    const price = await getLivePrice();
    optionAnalyzer.initialize(price, 20);
    res.json(optionAnalyzer.calculateMaxPain());
  } catch (error) {
    res.status(500).json({ error: "Failed to calculate max pain" });
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
    const spot = inst === 'NIFTY' ? await getLiveNiftyPrice() : await getLivePrice();
    const interval = inst === 'NIFTY' ? 50 : 100;
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
      res.json({ ...analytics, livePrice: price, priceAt: new Date().toISOString(),
                 dataSource: 'Sensibull/BFO', expiry: realChain.expiry,
                 lastUpdated: realChain.lastUpdated });
    } catch (sbErr) {
      // Sensibull unavailable — fall back to simulated chain
      optionAnalyzer.initialize(price, 20);
      const analytics = optionAnalyzer.getCompleteAnalytics();
      res.json({ ...analytics, livePrice: price, priceAt: new Date().toISOString(),
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
      ce: { ltp: s.ce.ltp, oi: s.ce.oi, changeOI: s.ce.changeOI || 0,
            volume: s.ce.volume || 0, iv: s.ce.iv || 12,
            delta: s.strike < atm ? 0.85 : s.strike === atm ? 0.5 : 0.15 },
      pe: { ltp: s.pe.ltp, oi: s.pe.oi, changeOI: s.pe.changeOI || 0,
            volume: s.pe.volume || 0, iv: s.pe.iv || 12,
            delta: s.strike > atm ? -0.85 : s.strike === atm ? -0.5 : -0.15 }
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
    try {
      const realChain = await getChainAroundATM(price, null, 10);
      optionAnalyzer.initializeFromRealData(realChain, price);
    } catch (_) {
      optionAnalyzer.initialize(price, 20);
    }
    const blast = optionAnalyzer.getGammaBlastAlert({ spotPrice: price });
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

// Get backtest results (Yahoo Finance / TradingView engine)
app.get("/api/backtest/real", (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const resultsPath = path.join(__dirname, 'backtest-real-results.json');

    if (!fs.existsSync(resultsPath)) {
      return res.json({
        available: false,
        message: "Run 'npm run backtest:tv' to generate results."
      });
    }

    const data = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    res.json({ available: true, ...data });
  } catch (error) {
    res.status(500).json({ error: "Failed to load backtest results", detail: error.message });
  }
});

// Trigger backtest run (spawns node backtest-tv/run.js)
let backtestRunning = false;
app.post("/api/backtest/run", (req, res) => {
  if (backtestRunning) {
    return res.status(409).json({ error: "Backtest already running" });
  }
  const { spawn } = require('child_process');
  backtestRunning = true;
  const child = spawn('node', ['backtest-tv/run.js'], {
    cwd: __dirname,
    env: { ...process.env },
    stdio: 'inherit'
  });
  child.on('close', (code) => {
    backtestRunning = false;
    console.log(`[backtest] finished with code ${code}`);
  });
  res.json({ status: 'started', message: 'Backtest running in background. Refresh results in ~60s.' });
});

// Backtest status
app.get("/api/backtest/status", (req, res) => {
  res.json({ running: backtestRunning });
});

// ==================== PAPER POSITION TRACKER — SENSEX ====================
let openPosition = null;
let closedPositions = [];

// ==================== PAPER POSITION TRACKER — NIFTY ====================
let niftyOpenPosition = null;
let niftyClosedPositions = [];

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
  niftyOpenPosition = { type, strike: parseInt(strike), entryPrice: ep, enteredAt: new Date().toISOString(),
    sl: ep * (1 - SL_PCT), trailAt: ep * TRAIL_MULT, trailLocked: false, lockedFloor: null,
    peakPrice: ep, movingStop: ep * (1 - SL_PCT), autoMovingStop: true,
    autoMovingStopActive: getMarketSession().inMarketHours,
    currentPrice: ep, status: 'OPEN', instrument: 'NIFTY' };
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
  res.json({ open: true, position: niftyOpenPosition, currentPrice, mult: mult.toFixed(3), pnlPct, status, marketOpen: session.inMarketHours, marketStatus: session.status });
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
  const closed = { ...niftyOpenPosition, exitPrice, exitAt: new Date().toISOString(),
    finalMult: mult.toFixed(3), finalPnlPct: ((mult - 1) * 100).toFixed(1), exitReason: req.body.reason || 'MANUAL' };
  niftyClosedPositions.push(closed);
  niftyOpenPosition = null;
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

// Engine control endpoints — NIFTY
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
  res.json(niftyEngine.status());
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
_loadConfigOverrides();

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
// Returns the intraday H/L record for the requested instrument including
// the full path of breaks (each time a new H or L was set, with timestamp).
app.get('/api/hl-record', (req, res) => {
  const inst = String(req.query.inst || 'SENSEX').toUpperCase();
  const rec = _hlRecord[inst];
  if (!rec) return res.status(400).json({ error: 'unknown instrument' });

  const fmtTime = (ms) => ms ? new Date(ms + 5.5*3600*1000).toISOString().slice(11, 19) : null;
  const path = (arr) => arr.map(e => ({ time: fmtTime(e.t), price: +e.p.toFixed(2), ts: e.t }));

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
    range:      +(rec.high - rec.low).toFixed(2)
  });
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
    const spot     = inst === 'NIFTY' ? await getLiveNiftyPrice() : await getLivePrice();
    const chain    = inst === 'NIFTY' ? await live.getNiftyOptionChain(spot) : await live.getOptionChain(spot);
    const interval = inst === 'NIFTY' ? 50  : 100;
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
    res.status(500).json({ error: err.message, rows: [] });
  }
});

// ==================== MARKET QUOTES WATCHLIST ====================
// Full market quote data (LTP, Low, High, Chng, %Chng, Bid, Ask, Volume, OI,
// Open, Prev Close, UCL, LCL, 52W High/Low, Avg Price) for ATM-2..ATM+2 CE & PE
app.get('/api/watchlist', async (req, res) => {
  const inst = String(req.query.inst || 'SENSEX').toUpperCase();
  try {
    const spot     = inst === 'NIFTY' ? await getLiveNiftyPrice() : await getLivePrice();
    const chain    = inst === 'NIFTY' ? await live.getNiftyOptionChain(spot) : await live.getOptionChain(spot);
    const interval = inst === 'NIFTY' ? 50  : 100;
    const atm      = Math.round(spot / interval) * interval;
    const seg      = inst === 'NIFTY' ? 'NSE_FNO' : 'BSE_FNO';

    const targetStrikes = [-2, -1, 0, 1, 2].map(o => atm + o * interval);
    const meta = [];
    const secIds = [];
    for (const s of targetStrikes) {
      const row = chain.strikes.find(x => x.strike === s);
      if (!row) continue;
      const pushLeg = (leg, type) => {
        const secId = leg?.securityId;
        meta.push({ strike: s, type, secId: secId ? String(secId) : null, chain: leg || {} });
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

    const rows = meta.map(m => {
      const c = m.chain;
      const d = fq[m.secId] || {};
      const ohlc = d.ohlc || {};
      const ltp  = Number(d.last_price ?? d.ltp ?? c.ltp ?? 0);
      const prevClose = Number(ohlc.close ?? d.previous_close ?? c.prevClose ?? c.close ?? 0);
      const chng = prevClose ? ltp - prevClose : 0;
      const chngPct = prevClose ? (chng / prevClose) * 100 : 0;
      // Typical price = (H+L+C)/3 when exchange avg not provided
      const high = Number(ohlc.high ?? c.high ?? 0);
      const low  = Number(ohlc.low  ?? c.low  ?? 0);
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

  engine.tick().catch(err => console.error('[engine] tick error:', err.message));
  // NIFTY engine offset by 2.5s to avoid simultaneous Dhan API calls
  setTimeout(() => niftyEngine.tick().catch(err => console.error('[nifty-engine] tick error:', err.message)), 2500);
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

  const action  = (body.action  || '').toUpperCase();   // BUY | SELL | EXIT
  const signal  = (body.signal  || '').toUpperCase();   // CALL | PUT
  const strike  = body.strike  || null;
  const entry   = parseFloat(body.entry)  || 0;
  const reason  = body.reason  || 'TV_ALERT';
  const conf    = body.conf    || 'HIGH';

  console.log(`[webhook/tv] ${action} ${signal} strike=${strike} entry=${entry} reason=${reason}`);

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

    return res.json({
      ok: true,
      action: 'BUY',
      signal,
      strike: strikeNum,
      optType,
      orderStatus,
      orderId,
      tradeMode
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
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🚀  ANTIGRAVITY AI BOT - SENSEX EXPIRY SYSTEM         ║
║                                                          ║
║   Listening on 0.0.0.0:${PORT}                              ║
║   Mode: ${live.connected ? "LIVE (Dhan)" : "DISCONNECTED — set DHAN creds"}  ║
║   Max trades/day: ${process.env.MAX_TRADES_PER_DAY || 2}                                      ║
║                                                          ║
║   Public: ${PUBLIC_BASE}
║   Local:  http://localhost:${PORT}/dashboard.html
║   API:    ${PUBLIC_BASE}/api/health
║                                                          ║
╚══════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
