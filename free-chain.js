/**
 * Free Option Chain Fetcher — no Dhan Data API subscription required.
 *
 * NIFTY → NSE official option-chain JSON (real-time, OI/IV/bid/ask).
 * SENSEX → Sensibull instruments feed (5-min cached, LTP/OI/Volume only).
 *
 * Returns the same shape as live-connector's getOptionChain():
 *   { spotPrice, atmStrike, strikes: [{strike, ce:{...}, pe:{...}}],
 *     timestamp, source }
 *
 * Both sources are unofficial — NSE rate-limits and needs cookies, Sensibull
 * data is BSE delayed. Use only when Dhan Data API is not subscribed.
 */

const fetch = require('node-fetch');
const sensibull = require('./sensibull-fetcher');

// Generic Sensibull adapter — works for any underlying (NIFTY/SENSEX/BANKNIFTY).
// Sensibull data is last-tick (delayed up to a minute) and lacks IV/bid/ask
// but always returns a structurally valid chain.
const SENS_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Origin': 'https://web.sensibull.com',
  'Referer': 'https://web.sensibull.com/'
};
async function _sensibullChain(symbol) {
  const r = await fetch(`https://api.sensibull.com/v1/instruments/${symbol}`, { headers: SENS_HEADERS, timeout: 12000 });
  if (!r.ok) throw new Error(`Sensibull ${symbol} ${r.status}`);
  const j = await r.json();
  if (!j?.data?.length) throw new Error(`Sensibull ${symbol} empty`);
  return j.data;
}

const NSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nseindia.com/option-chain',
  'Connection': 'keep-alive'
};

let _nseCookieJar = '';
let _nseCookieAt = 0;
const NSE_COOKIE_TTL = 5 * 60 * 1000; // 5 min

async function _ensureNseCookies() {
  if (_nseCookieJar && Date.now() - _nseCookieAt < NSE_COOKIE_TTL) return;
  // Warm-up: hit homepage to receive Set-Cookie headers, then reuse them.
  const r = await fetch('https://www.nseindia.com/option-chain', {
    headers: NSE_HEADERS, timeout: 10000
  });
  const setCookies = r.headers.raw()['set-cookie'] || [];
  _nseCookieJar = setCookies.map(c => c.split(';')[0]).join('; ');
  _nseCookieAt = Date.now();
}

// In-memory cache: 4 sec for NIFTY (rate-limit friendly), match dashboard 5s poll
let _niftyCache = null;
let _niftyCacheAt = 0;
const NIFTY_TTL = 4000;

async function getNiftyChain(spotHint = null) {
  if (_niftyCache && Date.now() - _niftyCacheAt < NIFTY_TTL) return _niftyCache;
  // Try NSE first (has real-time IV/bid/ask); fall back to Sensibull
  // (always works but lacks IV/bid/ask) when NSE bot-blocks us with empty {}.
  try {
    await _ensureNseCookies();
    const r = await fetch('https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY', {
      headers: { ...NSE_HEADERS, Cookie: _nseCookieJar, 'X-Requested-With': 'XMLHttpRequest' },
      timeout: 12000
    });
    if (!r.ok) { _nseCookieAt = 0; throw new Error(`NSE ${r.status}`); }
    const j = await r.json();
    const records = j?.records;
    const filtered = j?.filtered?.data || records?.data || [];
    if (!filtered.length) throw new Error('NSE empty (bot-blocked)');
    const spot = Number(records?.underlyingValue || spotHint || 0);
    const expiries = (records?.expiryDates || []).map(s => new Date(s).getTime()).sort((a, b) => a - b);
    const nearest = expiries[0];
    const nearestStr = nearest ? new Date(nearest).toDateString() : null;
    const strikes = filtered
      .filter(r => !nearestStr || new Date(r.expiryDate).toDateString() === nearestStr)
      .map(row => ({
        strike: Number(row.strikePrice),
        ce: row.CE ? _adaptNseLeg(row.CE) : null,
        pe: row.PE ? _adaptNseLeg(row.PE) : null
      }))
      .filter(r => r.ce || r.pe)
      .sort((a, b) => a.strike - b.strike);
    if (!strikes.length) throw new Error('NSE no strikes for nearest expiry');
    const result = {
      spotPrice: spot, atmStrike: Math.round(spot / 50) * 50, strikes,
      timestamp: new Date(), source: 'nse-free'
    };
    _niftyCache = result;
    _niftyCacheAt = Date.now();
    return result;
  } catch (err) {
    // Fall through to Sensibull
    console.log(`[free-chain] NSE NIFTY failed (${err.message}); using Sensibull`);
  }
  const data = await _sensibullChain('NIFTY');
  const expiries = [...new Set(data.map(x => x.expiry))].sort();
  const nearest = expiries[0];
  const chain = data.filter(x => x.expiry === nearest);
  const strikeNums = [...new Set(chain.map(x => x.strike))].sort((a, b) => a - b);
  const strikes = strikeNums.map(strike => {
    const ce = chain.find(x => x.strike === strike && x.instrument_type === 'CE');
    const pe = chain.find(x => x.strike === strike && x.instrument_type === 'PE');
    return { strike, ce: ce ? _adaptRawSensibullLeg(ce) : null, pe: pe ? _adaptRawSensibullLeg(pe) : null };
  }).filter(r => r.ce && r.pe);
  const spot = Number(spotHint || 0);
  const result = {
    spotPrice: spot, atmStrike: Math.round(spot / 50) * 50, strikes,
    timestamp: new Date(), source: 'sensibull-free'
  };
  _niftyCache = result;
  _niftyCacheAt = Date.now();
  return result;
}

function _adaptNseLeg(leg) {
  return {
    securityId: leg.identifier || null,
    ltp:        Number(leg.lastPrice || 0),
    high:       Number(leg.dayHigh || 0),
    low:        Number(leg.dayLow || 0),
    bid:        Number(leg.bidprice || 0),
    ask:        Number(leg.askPrice || 0),
    volume:     Number(leg.totalTradedVolume || 0),
    oi:         Number(leg.openInterest || 0),
    changeOI:   Number(leg.changeinOpenInterest || 0),
    iv:         Number(leg.impliedVolatility || 0),
    prevClose:  Number(leg.lastPrice || 0) - Number(leg.change || 0),
    close:      Number(leg.lastPrice || 0) - Number(leg.change || 0)
  };
}

let _sensexCache = null;
let _sensexCacheAt = 0;
const SENSEX_TTL = 8000;

async function getSensexChain(spotHint = null) {
  if (_sensexCache && Date.now() - _sensexCacheAt < SENSEX_TTL) return _sensexCache;
  const data = await sensibull.getOptionChain();
  const spot = Number(spotHint || 0);
  const atmStrike = Math.round(spot / 100) * 100;
  const strikes = (data.strikes || []).map(row => ({
    strike: Number(row.strike),
    ce: row.ce ? _adaptSensibullLeg(row.ce) : null,
    pe: row.pe ? _adaptSensibullLeg(row.pe) : null
  })).sort((a, b) => a.strike - b.strike);
  const result = {
    spotPrice: spot, atmStrike, strikes,
    timestamp: new Date(), source: 'sensibull-free'
  };
  _sensexCache = result;
  _sensexCacheAt = Date.now();
  return result;
}

// Adapter for raw Sensibull /v1/instruments/<sym> records (fields like
// last_price, instrument_token). Used by the NIFTY fallback.
function _adaptRawSensibullLeg(leg) {
  return {
    securityId: leg.instrument_token || null,
    ltp:    Number(leg.last_price || 0),
    high:   0, low: 0, bid: 0, ask: 0, iv: 0,
    volume:   Number(leg.volume || 0),
    oi:       Number(leg.oi || 0),
    changeOI: 0,
    prevClose: Number(leg.last_price || 0),
    close:     Number(leg.last_price || 0)
  };
}

// Adapter for the existing sensibull-fetcher's pre-processed output (ltp, oi, volume, token).
function _adaptSensibullLeg(leg) {
  return {
    securityId: leg.token || null,
    ltp:    Number(leg.ltp || 0),
    high:   0, low: 0, bid: 0, ask: 0, iv: 0,
    volume:   Number(leg.volume || 0),
    oi:       Number(leg.oi || 0),
    changeOI: 0,
    prevClose: Number(leg.ltp || 0),
    close:     Number(leg.ltp || 0)
  };
}

module.exports = { getNiftyChain, getSensexChain };
