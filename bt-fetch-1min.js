// Fetch ~10 months of REAL 1-min index history from Upstox, merge into a JSON
// file (dedup by timestamp). Read-only market-data calls.
//   node bt-fetch-1min.js "<instrument_key>" <outfile>
//   default: NIFTY → bt-data/nifty-1min.json
require('dotenv').config();
const fetch = require('node-fetch');
const fs = require('fs');

const TOK = process.env.UPSTOX_ACCESS_TOKEN;
const KEY = encodeURIComponent(process.argv[2] || 'NSE_INDEX|Nifty 50');
const FILE = process.argv[3] || 'bt-data/nifty-1min.json';

const CHUNKS = [
  ['2025-09-01', '2025-09-30'], ['2025-10-01', '2025-10-31'],
  ['2025-11-01', '2025-11-30'], ['2025-12-01', '2025-12-31'],
  ['2026-01-01', '2026-01-31'], ['2026-02-01', '2026-02-28'],
  ['2026-03-01', '2026-03-31'], ['2026-04-01', '2026-04-30'],
  ['2026-05-01', '2026-05-31'], ['2026-06-01', '2026-06-21'],
];

(async () => {
  const existing = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : [];
  const byTs = new Map(existing.map(r => [r[0], r]));
  console.log(`${FILE}: existing ${existing.length} bars`);
  let added = 0;
  for (const [from, to] of CHUNKS) {
    try {
      const u = `https://api.upstox.com/v2/historical-candle/${KEY}/1minute/${to}/${from}`;
      const r = await fetch(u, { headers: { Authorization: `Bearer ${TOK}`, Accept: 'application/json' }, timeout: 30000 });
      const j = await r.json();
      const candles = j?.data?.candles || [];
      let n = 0;
      for (const c of candles) { if (!byTs.has(c[0])) { byTs.set(c[0], [c[0], c[1], c[2], c[3], c[4], c[5] || 0, c[6] || 0]); n++; added++; } }
      console.log(`  ${from}..${to}: ${candles.length} candles, +${n}`);
    } catch (e) { console.log(`  ${from}..${to}: ERR ${e.message}`); }
  }
  const merged = [...byTs.values()].sort((a, b) => new Date(a[0]) - new Date(b[0]));
  fs.writeFileSync(FILE, JSON.stringify(merged));
  const days = new Set(merged.map(r => r[0].slice(0, 10)));
  console.log(`merged: ${merged.length} bars (+${added}) · ${merged[0][0].slice(0, 10)} → ${merged[merged.length - 1][0].slice(0, 10)} · ${days.size} trading days`);
})();
