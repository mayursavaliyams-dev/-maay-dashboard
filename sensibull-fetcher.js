/**
 * Sensibull Data Fetcher — Real SENSEX Option Chain
 * Source: api.sensibull.com/v1/instruments/SENSEX
 * Data: LTP, OI, Volume per strike/expiry (last market close)
 */

const fetch = require('node-fetch');

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Origin': 'https://web.sensibull.com',
  'Referer': 'https://web.sensibull.com/'
};

const CACHE_TTL = 5 * 60 * 1000; // 5 min cache
let _cache = null;
let _cacheAt = 0;

/**
 * Fetch all SENSEX instruments from Sensibull (cached)
 */
async function fetchInstruments() {
  if (_cache && Date.now() - _cacheAt < CACHE_TTL) return _cache;
  const r = await fetch('https://api.sensibull.com/v1/instruments/SENSEX', {
    headers: HEADERS, timeout: 10000
  });
  if (!r.ok) throw new Error(`Sensibull instruments failed: ${r.status}`);
  const json = await r.json();
  if (!json.status || !json.data) throw new Error('Sensibull: unexpected response');
  _cache = json.data;
  _cacheAt = Date.now();
  return _cache;
}

/**
 * Get list of available expiry dates (sorted ascending)
 */
async function getExpiries() {
  const all = await fetchInstruments();
  return [...new Set(all.map(x => x.expiry))].sort();
}

/**
 * Build option chain for a specific expiry (or nearest if not specified)
 * Returns array of { strike, ce:{ltp,oi,volume,token}, pe:{ltp,oi,volume,token} }
 * plus metadata: expiry, spot (from instruments), lotSize
 */
async function getOptionChain(expiry = null) {
  const all = await fetchInstruments();

  // Pick expiry
  const expiries = [...new Set(all.map(x => x.expiry))].sort();
  const targetExpiry = expiry || expiries[0];

  const chain = all.filter(x => x.expiry === targetExpiry);
  const strikes = [...new Set(chain.map(x => x.strike))].sort((a, b) => a - b);
  const lotSize = chain[0]?.lot_size || 20;

  // Build strike-keyed map
  const rows = strikes.map(strike => {
    const ce = chain.find(x => x.strike === strike && x.instrument_type === 'CE');
    const pe = chain.find(x => x.strike === strike && x.instrument_type === 'PE');
    return {
      strike,
      ce: ce ? {
        ltp: ce.last_price || 0,
        oi: ce.oi || 0,
        volume: ce.volume || 0,
        token: ce.instrument_token,
        updatedAt: ce.last_updated_at
      } : null,
      pe: pe ? {
        ltp: pe.last_price || 0,
        oi: pe.oi || 0,
        volume: pe.volume || 0,
        token: pe.instrument_token,
        updatedAt: pe.last_updated_at
      } : null
    };
  }).filter(r => r.ce && r.pe); // only strikes with both legs

  const lastUpdated = chain[0]?.last_updated_at || null;

  return {
    expiry: targetExpiry,
    allExpiries: expiries,
    strikes: rows,
    lotSize,
    lastUpdated,
    source: 'Sensibull / BFO'
  };
}

/**
 * Get ±N strikes around ATM for dashboard display
 */
async function getChainAroundATM(spot, expiry = null, halfStrikes = 10) {
  const data = await getOptionChain(expiry);
  const atm = Math.round(spot / 100) * 100;

  // Find closest strike to ATM
  let closest = data.strikes.reduce((best, row) =>
    Math.abs(row.strike - atm) < Math.abs(best.strike - atm) ? row : best
  , data.strikes[0]);

  const atmIdx = data.strikes.indexOf(closest);
  const slice = data.strikes.slice(
    Math.max(0, atmIdx - halfStrikes),
    Math.min(data.strikes.length, atmIdx + halfStrikes + 1)
  );

  return { ...data, strikes: slice, atmStrike: closest.strike };
}

module.exports = { getOptionChain, getChainAroundATM, getExpiries, fetchInstruments };
