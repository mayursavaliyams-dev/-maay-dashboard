/**
 * Compare accumulation variants on real data, split IS/OOS:
 *   baseline | +disaster-stop | +uptrend-filter | +both
 * Uses ~24 months of daily data so the 200-day trend filter has warmup.
 */
require('dotenv').config();
const BacktestDataSource = require('./data-source');
const { runAccumulation, cfgFromEnv } = require('./accumulation');

const iso = d => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

async function run(ds, symbols, from, to, over) {
  const cfg = cfgFromEnv(over);
  const r = await runAccumulation({ dataSource: ds, symbols, fromDate: from, toDate: to, cfg });
  const tr = r.trades;
  const byReason = {};
  for (const t of tr) byReason[t.reason] = (byReason[t.reason] || 0) + 1;
  return { ...r.metrics, byReason };
}

(async () => {
  const symbols = (process.env.WATCHLIST || 'RELIANCE,HDFCBANK,INFY,TCS,ICICIBANK')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const ds = new BacktestDataSource();
  const months = 24;
  const from = iso(months * 30), mid = iso(months * 30 / 2), to = iso(0);

  const variants = {
    'baseline':        {},
    '+disaster-stop':  { disasterStopPct: 0.10 },
    '+uptrend-filter': { trendFilter: true, trendPeriod: 200 },
    '+both':           { disasterStopPct: 0.10, trendFilter: true, trendPeriod: 200 }
  };

  console.log(`\n📊 Accumulation variants — REAL data, ${months}mo (${from} → ${to})`);
  console.log(`   Symbols: ${symbols.join(', ')}\n`);
  console.log('  variant            | full net | IS net | OOS net | win% | trades | exits');
  console.log('  ' + '-'.repeat(82));

  for (const [name, over] of Object.entries(variants)) {
    const full = await run(ds, symbols, from, to, over);
    const is   = await run(ds, symbols, from, mid, over);
    const oos  = await run(ds, symbols, mid, to, over);
    const exits = Object.entries(full.byReason).map(([k, v]) => `${k.replace('_', '')}=${v}`).join(' ');
    const pad = (v, n) => String(v).padStart(n);
    console.log(`  ${name.padEnd(18)} | ${pad('₹' + full.netPnl, 8)} | ${pad('₹' + is.netPnl, 6)} | ${pad('₹' + oos.netPnl, 7)} | ${pad(full.winRate, 4)} | ${pad(full.totalTrades, 6)} | ${exits}`);
  }
  console.log(`\n  Verdict guide: an edge must be net-positive in BOTH IS and OOS. Negative OOS = no edge / overfit.`);
  console.log(`⚠️  Backtest profit does not guarantee future profit.\n`);
})().catch(e => { console.error('compare failed:', e); process.exit(1); });
