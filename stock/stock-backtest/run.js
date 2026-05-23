/**
 * STOCK BACKTEST RUNNER (CLI)
 *
 *   node stock-backtest/run.js [--days N] [--symbols A,B] [--windows W] [--end YYYY-MM-DD]
 *
 * Uses real Dhan equity candles when DHAN creds + data/equity-ids.json exist,
 * otherwise deterministic synthetic sessions (clearly flagged) so the engine can
 * be validated end-to-end. Writes the full report to data/stock-backtest-results.json.
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const BacktestDataSource = require('./data-source');
const { runBacktest, cfgFromEnv } = require('./engine');
const { computeMetrics, printReport } = require('./metrics');
const { consistency, printConsistency } = require('./walk-forward');

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const m = argv[i].match(/^--([^=]+)=?(.*)$/);
    if (!m) continue;
    a[m[1]] = m[2] || argv[++i];
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv);
  const days = parseInt(args.days || 60);
  const windows = parseInt(args.windows || 4);
  const endDate = args.end || null;
  const symbols = (args.symbols || process.env.WATCHLIST || 'RELIANCE,HDFCBANK,INFY,TCS,ICICIBANK')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

  const dataSource = new BacktestDataSource();
  const dates = BacktestDataSource.tradingDates(days, endDate);
  const cfg = cfgFromEnv();

  console.log(`\n🔬 Stock backtest — ORB`);
  console.log(`   Data: ${dataSource.live ? 'Dhan equity (live history)' : 'SYNTHETIC (no creds — validation only)'}`);
  console.log(`   Symbols: ${symbols.join(', ')}`);
  console.log(`   Range: ${dates[0]} → ${dates[dates.length - 1]} (${dates.length} sessions)`);
  console.log(`   Params: SL ${(cfg.slPct*100)}% · target ${(cfg.targetPct*100)}% · risk ${(cfg.riskPct*100)}%/trade · slip ${(cfg.slipPct*100)}% · ORB ${cfg.orbRangeMinutes}m`);

  const result = await runBacktest({ dataSource, symbols, dates, cfg });
  const metrics = computeMetrics(result);
  printReport('OVERALL', metrics);

  const cons = await consistency({ dataSource, symbols, dates, cfg, windows });
  printConsistency(cons);

  const synthetic = !dataSource.live;
  if (synthetic) {
    console.log(`\n⚠️  SYNTHETIC DATA — these numbers validate the ENGINE, not a real edge.`);
    console.log(`   Add Dhan creds + data/equity-ids.json, then rerun for real history.`);
  }
  console.log(`\n⚠️  Backtest profit does not guarantee future profit. Charges + slippage erode returns.`);

  const out = {
    generatedAt: new Date().toISOString(),
    synthetic, symbols, dateRange: { from: dates[0], to: dates[dates.length - 1], sessions: dates.length },
    cfg, metrics, consistency: cons,
    equityCurve: result.equityCurve, trades: result.trades
  };
  const file = path.resolve('./data/stock-backtest-results.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\n📄 Full report → ${file}\n`);
}

main().catch(e => { console.error('backtest failed:', e); process.exit(1); });
