/**
 * PARAMETER SWEEP with IN-SAMPLE / OUT-OF-SAMPLE validation.
 *
 * The honest way to tune: optimize on the FIRST half of the date range
 * (in-sample), then test the single best combo on the SECOND half it never saw
 * (out-of-sample). A combo that wins IS but loses OOS is OVERFIT — we say so.
 * Only a combo profitable in BOTH halves is a candidate edge (and even then,
 * one OOS window is weak evidence — treat with suspicion).
 *
 *   node stock-backtest/sweep.js [--strategy orb] [--days 120]
 *
 * Grid (tunable below): stop-loss %, target %, and ORB window (orb strategy only).
 * Everything else (slippage, charges, sizing, halts) stays at the live defaults
 * so the sweep reflects real net P&L, not gross fantasy.
 */

require('dotenv').config();
const BacktestDataSource = require('./data-source');
const { runBacktest, cfgFromEnv } = require('./engine');
const { computeMetrics } = require('./metrics');

function parseArgs(argv) {
  const a = {};
  for (let i = 2; i < argv.length; i++) {
    const m = argv[i].match(/^--([^=]+)=?(.*)$/);
    if (m) a[m[1]] = m[2] || argv[++i];
  }
  return a;
}

// Grids. Kept deliberately small — a huge grid finds a "winner" by chance
// (more combos = more overfitting), which defeats the purpose.
const GRID = {
  slPct:     [0.5, 0.75, 1.0, 1.5],          // STOP_LOSS_PERCENT
  targetPct: [1.0, 1.5, 2.0, 3.0],           // TARGET_PERCENT
  orbMin:    [5, 15, 30]                      // ORB_RANGE_MINUTES (orb only)
};

function combosFor(strategy) {
  const out = [];
  const orbWindows = strategy === 'orb' ? GRID.orbMin : [null];
  for (const sl of GRID.slPct)
    for (const tg of GRID.targetPct) {
      if (tg <= sl) continue;                  // target must exceed stop (R:R > 1)
      for (const orb of orbWindows)
        out.push({ slPct: sl / 100, targetPct: tg / 100, orbRangeMinutes: orb });
    }
  return out;
}

async function evalCombo(dataSource, symbols, dates, baseCfg, combo) {
  const cfg = { ...baseCfg, ...combo };
  if (combo.orbRangeMinutes == null) delete cfg.orbRangeMinutes, cfg.orbRangeMinutes = baseCfg.orbRangeMinutes;
  const res = await runBacktest({ dataSource, symbols, dates, cfg });
  const m = computeMetrics(res);
  return { combo, trades: m.totalTrades, winRate: m.winRate, netPnl: m.netPnl, returnPct: m.totalReturn, profitFactor: m.profitFactor === Infinity ? 99 : m.profitFactor, maxDD: m.maxDrawdownPct };
}

function fmtCombo(c) {
  return `SL ${(c.slPct*100)}% / T ${(c.targetPct*100)}%` + (c.orbRangeMinutes != null ? ` / ORB ${c.orbRangeMinutes}m` : '');
}

async function main() {
  const args = parseArgs(process.argv);
  const strategy = (args.strategy || process.env.STRATEGY || 'orb').toLowerCase();
  const days = parseInt(args.days || 120);
  const symbols = (process.env.WATCHLIST || 'RELIANCE,HDFCBANK,INFY,TCS,ICICIBANK')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

  const ds = new BacktestDataSource();
  const allDates = BacktestDataSource.tradingDates(days);
  const mid = Math.floor(allDates.length / 2);
  const inSample = allDates.slice(0, mid);
  const outSample = allDates.slice(mid);
  const baseCfg = { ...cfgFromEnv(), strategy };
  const combos = combosFor(strategy);

  console.log(`\n🔧 Parameter sweep — ${strategy}`);
  console.log(`   Data: ${ds.live ? 'REAL Dhan history' : 'SYNTHETIC (no creds)'}`);
  console.log(`   In-sample:  ${inSample[0]} → ${inSample[inSample.length-1]} (${inSample.length} sessions)`);
  console.log(`   Out-sample: ${outSample[0]} → ${outSample[outSample.length-1]} (${outSample.length} sessions)`);
  console.log(`   Testing ${combos.length} combos…\n`);

  // 1) Optimize on in-sample.
  const isResults = [];
  for (const combo of combos) {
    const r = await evalCombo(ds, symbols, inSample, baseCfg, combo);
    isResults.push(r);
    process.stdout.write('.');
  }
  isResults.sort((a, b) => b.netPnl - a.netPnl);
  console.log('\n\n── Top 5 in-sample combos ──');
  for (const r of isResults.slice(0, 5)) {
    console.log(`  ${fmtCombo(r.combo).padEnd(34)} net ₹${String(r.netPnl).padStart(7)}  win ${r.winRate}%  PF ${r.profitFactor}  (${r.trades} trades)`);
  }

  // 2) Validate the single best IS combo on out-of-sample.
  const best = isResults[0];
  const oos = await evalCombo(ds, symbols, outSample, baseCfg, best.combo);

  console.log(`\n── Out-of-sample test of best IS combo (${fmtCombo(best.combo)}) ──`);
  console.log(`  IN-SAMPLE : net ₹${best.netPnl}  win ${best.winRate}%  PF ${best.profitFactor}  return ${best.returnPct}%`);
  console.log(`  OUT-SAMPLE: net ₹${oos.netPnl}  win ${oos.winRate}%  PF ${oos.profitFactor}  return ${oos.returnPct}%`);

  let verdict, flag;
  if (best.netPnl > 0 && oos.netPnl > 0) { verdict = 'CANDIDATE EDGE'; flag = '✅'; }
  else if (best.netPnl > 0 && oos.netPnl <= 0) { verdict = 'OVERFIT — wins in-sample, loses out-of-sample'; flag = '⛔'; }
  else { verdict = 'NO EDGE — best combo loses even in-sample'; flag = '⛔'; }
  console.log(`\n  ${flag} ${verdict}`);
  if (verdict.startsWith('CANDIDATE')) {
    console.log(`     One OOS window is weak proof — re-test across more windows + forward paper-trade before trusting.`);
  }
  console.log(`\n⚠️  Backtest profit does not guarantee future profit.\n`);
}

main().catch(e => { console.error('sweep failed:', e); process.exit(1); });
