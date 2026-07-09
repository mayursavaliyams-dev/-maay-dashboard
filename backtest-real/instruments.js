const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const SCRIP_URL = 'https://images.dhan.co/api-data/api-scrip-master-detailed.csv';

async function downloadScripMaster(cacheDir) {
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  const cachePath = path.join(cacheDir, 'api-scrip-master-detailed.csv');

  const oneDayMs = 24 * 60 * 60 * 1000;
  if (fs.existsSync(cachePath)) {
    const age = Date.now() - fs.statSync(cachePath).mtimeMs;
    if (age < oneDayMs) return cachePath;
  }

  console.log('  [instruments] downloading Dhan scrip master...');
  const res = await fetch(SCRIP_URL, { timeout: 60000 });
  if (!res.ok) throw new Error(`Scrip master download failed: HTTP ${res.status}`);
  const text = await res.text();
  fs.writeFileSync(cachePath, text);
  console.log(`  [instruments] scrip master cached (${(text.length / 1024 / 1024).toFixed(1)} MB)`);
  return cachePath;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length < headers.length) continue;
    const row = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = cols[j];
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQuote = !inQuote; continue; }
    if (c === ',' && !inQuote) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

function pick(row, candidates) {
  for (const c of candidates) {
    if (row[c] !== undefined && row[c] !== '') return row[c];
  }
  return undefined;
}

async function resolveSensexSpot(cacheDir) {
  const csvPath = await downloadScripMaster(cacheDir);
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));

  for (const row of rows) {
    const seg = pick(row, ['SEM_EXM_EXCH_ID', 'SEM_EXCH_INSTRUMENT_TYPE', 'EXCH_ID', 'SEM_SEGMENT']);
    const instrument = pick(row, ['SEM_INSTRUMENT_NAME', 'INSTRUMENT', 'SEM_EXM_EXCH_ID']);
    const symbol = pick(row, ['SEM_TRADING_SYMBOL', 'SEM_CUSTOM_SYMBOL', 'SYMBOL_NAME', 'SM_SYMBOL_NAME']);
    const secId = pick(row, ['SEM_SMST_SECURITY_ID', 'SECURITY_ID', 'SEM_INSTRUMENT_ID']);

    if (!secId || !symbol) continue;
    const sym = String(symbol).toUpperCase();
    const segStr = String(seg || '').toUpperCase();
    const instStr = String(instrument || '').toUpperCase();

    const looksLikeSensex = sym === 'SENSEX' || sym === 'BSX' || sym.includes('SENSEX');
    const looksLikeIndex = instStr.includes('INDEX') || segStr.includes('IDX') || segStr === 'IDX_I';

    if (looksLikeSensex && looksLikeIndex) {
      return {
        securityId: String(secId),
        exchangeSegment: 'IDX_I',
        instrument: 'INDEX',
        symbol: sym,
        raw: row
      };
    }
  }

  // Fallback: Dhan's well-known SENSEX index security id is 51 on IDX_I segment.
  console.warn('  [instruments] could not find SENSEX in scrip master, using fallback id=51');
  return {
    securityId: '51',
    exchangeSegment: 'IDX_I',
    instrument: 'INDEX',
    symbol: 'SENSEX',
    raw: null
  };
}

async function resolveNiftySpot(cacheDir) {
  const csvPath = await downloadScripMaster(cacheDir);
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));

  for (const row of rows) {
    const seg = pick(row, ['SEM_EXM_EXCH_ID', 'SEM_EXCH_INSTRUMENT_TYPE', 'EXCH_ID', 'SEM_SEGMENT']);
    const instrument = pick(row, ['SEM_INSTRUMENT_NAME', 'INSTRUMENT', 'SEM_EXM_EXCH_ID']);
    const symbol = pick(row, ['SEM_TRADING_SYMBOL', 'SEM_CUSTOM_SYMBOL', 'SYMBOL_NAME', 'SM_SYMBOL_NAME']);
    const secId = pick(row, ['SEM_SMST_SECURITY_ID', 'SECURITY_ID', 'SEM_INSTRUMENT_ID']);

    if (!secId || !symbol) continue;
    const sym = String(symbol).toUpperCase();
    const segStr = String(seg || '').toUpperCase();
    const instStr = String(instrument || '').toUpperCase();

    const looksLikeNifty = sym === 'NIFTY' || sym === 'NIFTY 50' || sym === 'NIFTY50';
    const looksLikeIndex = instStr.includes('INDEX') || segStr.includes('IDX') || segStr === 'IDX_I';

    if (looksLikeNifty && looksLikeIndex) {
      return {
        securityId: String(secId), exchangeSegment: 'IDX_I', instrument: 'INDEX',
        symbol: sym, raw: row
      };
    }
  }
  console.warn('  [instruments] could not find NIFTY in scrip master, using fallback id=13');
  return { securityId: '13', exchangeSegment: 'IDX_I', instrument: 'INDEX', symbol: 'NIFTY', raw: null };
}

async function resolveBankNiftySpot(cacheDir) {
  const csvPath = await downloadScripMaster(cacheDir);
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));

  for (const row of rows) {
    const seg = pick(row, ['SEM_EXM_EXCH_ID', 'SEM_EXCH_INSTRUMENT_TYPE', 'EXCH_ID', 'SEM_SEGMENT']);
    const instrument = pick(row, ['SEM_INSTRUMENT_NAME', 'INSTRUMENT', 'SEM_EXM_EXCH_ID']);
    const symbol = pick(row, ['SEM_TRADING_SYMBOL', 'SEM_CUSTOM_SYMBOL', 'SYMBOL_NAME', 'SM_SYMBOL_NAME']);
    const secId = pick(row, ['SEM_SMST_SECURITY_ID', 'SECURITY_ID', 'SEM_INSTRUMENT_ID']);

    if (!secId || !symbol) continue;
    const sym = String(symbol).toUpperCase();
    const segStr = String(seg || '').toUpperCase();
    const instStr = String(instrument || '').toUpperCase();

    const looksLikeBank = sym === 'NIFTY BANK' || sym === 'BANKNIFTY' || sym === 'NIFTYBANK';
    const looksLikeIndex = instStr.includes('INDEX') || segStr.includes('IDX') || segStr === 'IDX_I';

    if (looksLikeBank && looksLikeIndex) {
      return {
        securityId: String(secId), exchangeSegment: 'IDX_I', instrument: 'INDEX',
        symbol: sym, raw: row
      };
    }
  }
  console.warn('  [instruments] could not find Bank NIFTY in scrip master, using fallback id=25');
  return { securityId: '25', exchangeSegment: 'IDX_I', instrument: 'INDEX', symbol: 'BANKNIFTY', raw: null };
}

// Generic resolver — picks SENSEX, NIFTY, or BANKNIFTY based on symbol arg.
async function resolveIndexSpot(symbol, cacheDir) {
  const s = String(symbol || '').toUpperCase();
  if (s === 'NIFTY')                                return resolveNiftySpot(cacheDir);
  if (s === 'BANKNIFTY' || s === 'BANK' || s === 'NIFTYBANK') return resolveBankNiftySpot(cacheDir);
  return resolveSensexSpot(cacheDir);
}

module.exports = { downloadScripMaster, parseCsv, resolveSensexSpot, resolveNiftySpot, resolveBankNiftySpot, resolveIndexSpot };
