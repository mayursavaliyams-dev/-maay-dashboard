require('dotenv').config();

const fs = require('fs');
const path = require('path');

const DhanClient = require('./dhan-client');
const { resolveIndexSpot } = require('./instruments');
const { generateExpiryDays, toYmd } = require('./expiry-days');
const DataFetcher = require('./data-fetcher');
const { simulateTrade } = require('./trade-simulator');
const { aggregate } = require('./aggregator');

// Pick strategy based on BACKTEST_STRATEGY env var.
//   orb (default) → ORB+VWAP breakout, one entry per day in 9:31–10:30 IST window
//   ema           → EMA 9/21 crossover, one entry per day in 9:31–14:30 IST window
const STRATEGY_NAME = String(process.env.BACKTEST_STRATEGY || 'orb').toLowerCase();
const { runStrategy } = STRATEGY_NAME === 'ema'
  ? require('./strategy-ema')
  : require('./strategy-runner');

function env(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

async function main() {
  const instrument = String(env('BACKTEST_INSTRUMENT', 'SENSEX')).toUpperCase();
  const isNifty    = instrument === 'NIFTY';
  const isBankNifty= instrument === 'BANKNIFTY' || instrument === 'BANK' || instrument === 'NIFTYBANK';
  const isNseIndex = isNifty || isBankNifty;
  // Default cache dir per-instrument so indices don't fight.
  const defaultCache = isBankNifty ? './data/dhan-cache-banknifty'
                     : isNifty     ? './data/dhan-cache-nifty'
                                   : './data/dhan-cache';
  const config = {
    instrument,
    optionExchangeSegment: isNseIndex ? 'NSE_FNO' : 'BSE_FNO',
    thursdayOnly: false,
    numExpiries: Number(env('BACKTEST_NUM_EXPIRIES', 200)),
    interval: Number(env('BACKTEST_INTERVAL', 5)),
    strikeOffset: Number(env('BACKTEST_STRIKE_OFFSET', 1)),
    cutover: env('SENSEX_EXPIRY_CUTOVER', '2024-10-28'),
    // fridayOnly only applies to SENSEX (NIFTY uses thursdayOnly)
    fridayOnly: !isNseIndex && String(env('BACKTEST_FRIDAY_ONLY', 'true')).toLowerCase() === 'true',
    cacheDir: path.resolve(env('BACKTEST_CACHE_DIR', defaultCache)),
    risk: {
      stopLossPct: Number(env('STOP_LOSS_PERCENT', 35)),
      // Default raised to 400% (=5x premium) for the Friday 5× target.
      targetPct: Number(env('TARGET_PERCENT', 400)),
      trailAfterMultiple: Number(env('TRAIL_AFTER_MULTIPLE', 2)),
      trailLockPct: Number(env('TRAIL_LOCK_PERCENT', 50)),
      // Slippage % applied to entry, target, SL, and EOD exit. Real fills
      // are typically 1–3% worse than candle prices on Sensex weeklies.
      slippagePct: Number(env('SLIPPAGE_PERCENT', 2)),
      // Per-lot quantity and per-order brokerage. NIFTY=65, SENSEX=20, ₹30/order.
      lotSize:           isBankNifty ? 30 : isNifty ? 65 : 20,
      brokeragePerOrder: Number(env('BROKERAGE_PER_ORDER', 30))
    }
  };

  console.log('\n============================================================');
  console.log('  ANTIGRAVITY REAL BACKTEST — Dhan historical option candles');
  console.log('============================================================');
  console.log(`  Instrument:        ${config.instrument}  (options: ${config.optionExchangeSegment})`);
  console.log(`  Strategy:          ${STRATEGY_NAME.toUpperCase()}  (${STRATEGY_NAME === 'ema' ? 'EMA 9/21 crossover' : 'ORB+VWAP breakout'})`);
  console.log(`  Lot size:          ${config.risk.lotSize}  (brokerage ₹${config.risk.brokeragePerOrder}/order)`);
  console.log(`  Expiries:          ${config.numExpiries}`);
  console.log(`  Interval:          ${config.interval}m`);
  console.log(`  Strike:            ATM${config.strikeOffset >= 0 ? '+' : ''}${config.strikeOffset}`);
  console.log(`  Risk — SL:         ${config.risk.stopLossPct}%`);
  console.log(`  Risk — Target:     ${config.risk.targetPct}%`);
  console.log(`  Risk — Trail:      after ${config.risk.trailAfterMultiple}x, lock ${config.risk.trailLockPct}%`);
  console.log(`  Slippage:          ${config.risk.slippagePct}% (entry + exit)`);
  if (isNifty)                console.log(`  Mode:              NIFTY expiry schedule (Thu before Sep 2025, Tue after)`);
  else if (isBankNifty)       console.log(`  Mode:              BANKNIFTY expiry schedule (Thu before Sep 2023, Wed after)`);
  else if (config.fridayOnly) console.log(`  Mode:              Friday-only (SENSEX pre-cutover)`);
  else                        console.log(`  Mode:              auto-cutover (SENSEX Fri→Tue at ${config.cutover})`);
  console.log(`  Cache dir:         ${config.cacheDir}\n`);

  if (!fs.existsSync(config.cacheDir)) fs.mkdirSync(config.cacheDir, { recursive: true });

  const client = new DhanClient();

  console.log(`[1/4] Resolving ${config.instrument} instrument...`);
  const spot = await resolveIndexSpot(config.instrument, config.cacheDir);
  console.log(`      ${config.instrument} securityId=${spot.securityId} segment=${spot.exchangeSegment}\n`);

  console.log('[2/4] Generating expiry day list...');
  const expiryDays = generateExpiryDays({
    count: config.numExpiries,
    cutoverDate: config.cutover,
    endDate: toYmd(new Date()),
    fridayOnly: config.fridayOnly,
    thursdayOnly: config.thursdayOnly,
    instrument: config.instrument
  });
  console.log(`      ${expiryDays.length} expiry days: ${expiryDays[0].date} → ${expiryDays[expiryDays.length - 1].date}\n`);

  const fetcher = new DataFetcher({
    client,
    spot,
    cacheDir: config.cacheDir,
    interval: config.interval,
    optionExchangeSegment: config.optionExchangeSegment,
    cacheLabel: config.instrument
  });

  console.log('[3/4] Fetching data + running strategy...');
  const results = [];
  let processed = 0;

  for (const day of expiryDays) {
    processed++;
    const prefix = `  [${String(processed).padStart(3, ' ')}/${expiryDays.length}] ${day.date} (${day.weekday})`;

    try {
      const spotCandles = await fetcher.getSpotCandles(day.date);
      if (!spotCandles || spotCandles.length === 0) {
        console.log(`${prefix}  no spot data`);
        results.push({ ...day, spotCandles: [], signals: [], trades: [] });
        continue;
      }

      const { signals, orbHigh, orbLow } = runStrategy(spotCandles);

      const trades = [];
      for (const signal of signals) {
        const optionType = signal.signal === 'CALL' ? 'CALL' : 'PUT';
        let strikeOffset = config.strikeOffset;
        if (optionType === 'PUT') strikeOffset = -strikeOffset;

        const optionCandles = await fetcher.getOptionCandles({
          expiryDate: day.date,
          strikeOffset,
          optionType,
          spotCandles
        });

        const trade = simulateTrade({ signal, optionCandles, risk: config.risk });
        trades.push(trade);
      }

      const bestTrade = trades.find(t => t.status === 'OK');
      const summary = bestTrade
        ? `${bestTrade.type} ${bestTrade.multiplier}x (${bestTrade.reason})`
        : signals.length ? 'signal but no fill' : 'no signal';
      console.log(`${prefix}  ${summary}`);

      results.push({
        ...day,
        spotCandles,
        signals,
        trades,
        orbHigh,
        orbLow
      });
    } catch (err) {
      console.log(`${prefix}  ERROR: ${err.message}`);
      results.push({ ...day, error: err.message, spotCandles: [], signals: [], trades: [] });
    }
  }

  console.log('\n[4/4] Aggregating results...');
  const report = aggregate(results);

  const outPath = path.resolve('./backtest-real-results.json');
  const instrumentOutPath = path.resolve(`./backtest-real-results-${config.instrument.toLowerCase()}.json`);
  // Strip heavy candle arrays before saving to keep file size reasonable
  const slim = {
    ...report,
    expirySummaries: report.expirySummaries,
    config
  };
  fs.writeFileSync(outPath, JSON.stringify(slim, null, 2));
  fs.writeFileSync(instrumentOutPath, JSON.stringify(slim, null, 2));

  printReport(report);
  console.log(`\nSaved full report -> ${outPath}`);
  console.log(`Saved instrument report -> ${instrumentOutPath}\n`);
}

function printReport(r) {
  const s = r.stats;
  console.log('\n============================================================');
  console.log('  RESULTS');
  console.log('============================================================');
  console.log(`  Total expiries tested:   ${r.totalExpiries}`);
  console.log(`  Expiries with a trade:   ${r.expiriesWithTrades}`);
  console.log(`  Skipped (no signal):     ${r.skipped.noSignal}`);
  console.log(`  Skipped (no option fill):${r.skipped.noOptionData + r.skipped.noEntry}`);
  console.log(`  Skipped (fetch errors):  ${r.skipped.fetchError}`);
  console.log();
  console.log(`  Total trades:            ${s.totalTrades}`);
  console.log(`  Win rate:                ${s.winRate}%`);
  console.log(`  Avg multiplier:          ${s.avgMultiplier}x`);
  console.log(`  Median multiplier:       ${s.medianMultiplier}x`);
  console.log(`  Max multiplier:          ${s.maxMultiplier}x`);
  console.log(`  Avg PnL %:               ${s.avgPnlPct}%`);
  console.log();
  console.log(`  ≥2x hits:                ${s.hit2x}`);
  console.log(`  ≥5x hits:                ${s.hit5x}`);
  console.log(`  ≥10x hits:               ${s.hit10x}`);
  console.log(`  ≥50x hits:               ${s.hit50x}`);

  if (s.byYear && Object.keys(s.byYear).length > 0) {
    console.log('\n  By year:');
    Object.entries(s.byYear).sort().forEach(([y, d]) => {
      const wr = d.trades > 0 ? ((d.wins / d.trades) * 100).toFixed(0) : 0;
      console.log(`    ${y}: ${d.trades} trades, ${wr}% win, avg ${(d.totalPnl / d.trades).toFixed(1)}% pnl`);
    });
  }

  if (s.byType) {
    console.log('\n  By side:');
    console.log(`    CALL: ${s.byType.CALL.trades} trades, ${s.byType.CALL.wins} wins`);
    console.log(`    PUT:  ${s.byType.PUT.trades} trades, ${s.byType.PUT.wins} wins`);
  }

  if (s.byReason) {
    console.log('\n  Exit reasons:');
    Object.entries(s.byReason).forEach(([k, v]) => console.log(`    ${k}: ${v}`));
  }
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(err => {
    console.error('\nFatal:', err.message);
    if (err.body) console.error('Body:', JSON.stringify(err.body, null, 2));
    process.exit(1);
  });
}

module.exports = { main };
