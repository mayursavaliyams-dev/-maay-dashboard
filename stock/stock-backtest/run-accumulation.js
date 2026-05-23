/**
 * ACCUMULATION BACKTEST RUNNER (daily/swing).
 *   node stock-backtest/run-accumulation.js [--months 12]
 *
 * Splits the daily range in half: optimize nothing (fixed params), but report
 * the first half (IS) vs second half (OOS) so a result that only works in one
 * period is visible. Uses REAL Dhan daily candles when creds exist.
 */

require('dotenv').config();
const BacktestDataSource = require('./data-source');
const { runAccumulation, cfgFromEnv } = require('./accumulation');

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) { const m = argv[i].match(/^--([^=]+)=?(.*)$/); if (m) a[m[1]] = m[2] || argv[++i]; }
  return a;
}
function isoDaysAgo(days) { return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); }

function printBlock(label, r) {
  const m = r.metrics;
  console.log(`\n── ${label} (${r.fromDate} → ${r.toDate}) ──`);
  console.log(`  Trades: ${m.totalTrades}  win ${m.winRate}%  | net ₹${m.netPnl.toLocaleString('en-IN')}  charges ₹${m.totalCharges.toLocaleString('en-IN')}  | avg hold ${m.avgHoldDays}d`);
  const per = Object.entries(m.perSymbol).map(([k, v]) => `${k} ₹${v.net}(${v.trades})`).join('  ');
  console.log(`  By symbol: ${per || '—'}`);
}

async function main() {
  const args = parseArgs(process.argv);
  const months = parseInt(args.months || 12);
  const symbols = (process.env.WATCHLIST || 'RELIANCE,HDFCBANK,INFY,TCS,ICICIBANK')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

  const ds = new BacktestDataSource();
  const cfg = cfgFromEnv();
  const fullFrom = isoDaysAgo(months * 30), fullTo = isoDaysAgo(0);
  const midFrom = isoDaysAgo(Math.floor(months * 30 / 2));

  console.log(`\n📥 Accumulation (buy-low / average-down / sell-recovery) — daily swing`);
  console.log(`   Data: ${ds.live ? 'REAL Dhan daily history' : 'SYNTHETIC (no creds)'}`);
  console.log(`   Symbols: ${symbols.join(', ')}  | window ${months} months`);
  console.log(`   Params: N-day low ${cfg.nDays}d · avg ${cfg.avgPeriod}d · add each -${(cfg.addStepPct*100)}% · max ${cfg.maxTranches} tranches · target +${(cfg.targetPct*100)}% over avg · maxHold ${cfg.maxHoldDays}d`);

  const full = await runAccumulation({ dataSource: ds, symbols, fromDate: fullFrom, toDate: fullTo, cfg });
  const is   = await runAccumulation({ dataSource: ds, symbols, fromDate: fullFrom, toDate: midFrom, cfg });
  const oos  = await runAccumulation({ dataSource: ds, symbols, fromDate: midFrom, toDate: fullTo, cfg });

  printBlock('FULL PERIOD', full);
  printBlock('IN-SAMPLE (1st half)', is);
  printBlock('OUT-OF-SAMPLE (2nd half)', oos);

  const f = full.metrics, isM = is.metrics, oM = oos.metrics;
  let verdict, flag;
  if (f.netPnl > 0 && isM.netPnl > 0 && oM.netPnl > 0) { verdict = 'CANDIDATE EDGE — profitable in both halves'; flag = '✅'; }
  else if (f.netPnl > 0) { verdict = 'MIXED — net positive overall but not both halves (fragile)'; flag = '⚠️'; }
  else { verdict = 'NO EDGE — net negative after charges'; flag = '⛔'; }
  console.log(`\n  ${flag} ${verdict}`);
  if (!ds.live) console.log(`     (SYNTHETIC data — validates the engine only, not a real edge.)`);
  console.log(`\n⚠️  Backtest profit does not guarantee future profit. Charges + slippage erode returns.\n`);
}

main().catch(e => { console.error('accumulation backtest failed:', e); process.exit(1); });
