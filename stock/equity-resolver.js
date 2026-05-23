/**
 * EQUITY SECURITY-ID RESOLVER
 * Maps watchlist symbols (RELIANCE, INFY, …) → Dhan NSE_EQ securityIds by
 * parsing Dhan's public scrip master CSV. Writes data/equity-ids.json so the
 * connector + backtest data source can place live orders / fetch real candles.
 *
 * Reuses the options project's downloadScripMaster + parseCsv (cached 24h).
 * No creds needed — the scrip master is a public CSV. Run:
 *     node equity-resolver.js                 # uses WATCHLIST from .env
 *     node equity-resolver.js RELIANCE INFY   # explicit symbols
 */

const fs   = require('fs');
const path = require('path');

let scrip = null;
try { scrip = require('../backtest-real/instruments'); } catch (_) {}

const CACHE_DIR = path.resolve('./data/dhan-scrip-cache');
const OUT_FILE  = path.resolve('./data/equity-ids.json');

// Column-name candidates vary across Dhan scrip-master versions.
function pick(row, names) {
  for (const n of names) if (row[n] !== undefined && row[n] !== '') return row[n];
  return undefined;
}

/**
 * Resolve a list of NSE equity symbols → { SYMBOL: securityId }.
 * A symbol that can't be found is reported in `unresolved` (never guessed —
 * an unmapped symbol is simply skipped for live trading, never fabricated).
 */
async function resolveEquities(symbols) {
  if (!scrip) throw new Error('scrip master module not found (../backtest-real/instruments)');
  const csvPath = await scrip.downloadScripMaster(CACHE_DIR);
  const rows = scrip.parseCsv(fs.readFileSync(csvPath, 'utf8'));

  const want = new Set(symbols.map(s => s.toUpperCase()));
  const found = {};

  // Dhan "detailed" scrip master columns:
  //   EXCH_ID,SEGMENT,SECURITY_ID,ISIN,INSTRUMENT,UNDERLYING_SECURITY_ID,
  //   UNDERLYING_SYMBOL,SYMBOL_NAME,DISPLAY_NAME,INSTRUMENT_TYPE,SERIES,...
  // NSE cash equity row: EXCH_ID=NSE, SEGMENT=E, INSTRUMENT=EQUITY,
  //   SERIES=EQ, SYMBOL_NAME=RELIANCE, SECURITY_ID=2885.
  for (const row of rows) {
    const exch   = String(pick(row, ['EXCH_ID', 'SEM_EXM_EXCH_ID']) || '').toUpperCase();
    const seg    = String(pick(row, ['SEGMENT', 'SEM_SEGMENT']) || '').toUpperCase();
    const instr  = String(pick(row, ['INSTRUMENT', 'SEM_INSTRUMENT_NAME']) || '').toUpperCase();
    const series = String(pick(row, ['SERIES']) || '').toUpperCase();
    const sym    = String(pick(row, ['UNDERLYING_SYMBOL', 'SYMBOL_NAME', 'SEM_TRADING_SYMBOL']) || '').toUpperCase();
    const secId  = pick(row, ['SECURITY_ID', 'SEM_SMST_SECURITY_ID']);
    if (!secId || !sym) continue;

    const isNse    = exch === 'NSE';
    const isEquity = instr === 'EQUITY' && (seg === 'E' || seg === '');
    const isEqSeries = series === '' || series === 'EQ' || series === 'BE';
    if (!isNse || !isEquity || !isEqSeries) continue;

    const base = sym.replace(/-EQ$/, '').replace(/\s+/g, '');
    if (want.has(base) && !found[base]) found[base] = String(secId);
  }

  const unresolved = [...want].filter(s => !found[s]);
  return { found, unresolved };
}

// Merge into data/equity-ids.json (preserve any hand-entered ids).
function writeIds(found) {
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8')); } catch (_) {}
  const merged = { ...existing, ...found };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(merged, null, 2));
  return merged;
}

async function main() {
  require('dotenv').config();
  const args = process.argv.slice(2).filter(Boolean);
  const symbols = (args.length ? args.join(',') : (process.env.WATCHLIST || 'RELIANCE,HDFCBANK,INFY,TCS,ICICIBANK'))
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

  console.log(`[resolver] resolving ${symbols.length} symbols against Dhan scrip master…`);
  const { found, unresolved } = await resolveEquities(symbols);
  const merged = writeIds(found);

  console.log(`[resolver] resolved ${Object.keys(found).length}/${symbols.length}:`);
  for (const [s, id] of Object.entries(found)) console.log(`   ${s.padEnd(12)} → ${id}`);
  if (unresolved.length) console.warn(`[resolver] ⚠️ unresolved (skipped for live): ${unresolved.join(', ')}`);
  console.log(`[resolver] wrote ${OUT_FILE} (${Object.keys(merged).length} total)`);
}

if (require.main === module) {
  main().catch(e => { console.error('[resolver] failed:', e.message); process.exit(1); });
}

module.exports = { resolveEquities, writeIds };
