/**
 * DAILY BACKTEST — Friday 5× preset, but trade EVERY weekday (not just expiries)
 *
 * On each trading day, the strategy runs on SENSEX spot. If a signal fires,
 * we buy the nearest weekly option (Dhan's expiryCode=0 + WEEK auto-picks it)
 * and simulate the trade to SL/target/trail/EOD.
 *
 * Env knobs:
 *   DAILY_BACKTEST_DAYS=500     # how many recent trading days to test
 *   DAILY_BACKTEST_START=YYYY-MM-DD # optional earliest date to include
 *   DAILY_BACKTEST_END=YYYY-MM-DD  # walk backwards from this date (default = today)
 *   MAX_TRADES_PER_DAY=6        # cap signals simulated per day
 *   DAILY_BACKTEST_FRIDAY_CUTOVER=true  # stop at 2024-10-28 (no Dhan data after for Friday weeklies)
 *   STOP_LOSS_PERCENT, TARGET_PERCENT, TRAIL_AFTER_MULTIPLE, TRAIL_LOCK_PERCENT
 *   BACKTEST_INTERVAL, BACKTEST_STRIKE_OFFSET, BACKTEST_CACHE_DIR
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');

const DhanClient = require('./backtest-real/dhan-client');
const { resolveSensexSpot } = require('./backtest-real/instruments');
const { toYmd } = require('./backtest-real/expiry-days');
const DataFetcher = require('./backtest-real/data-fetcher');
const { simulateTrade } = require('./backtest-real/trade-simulator');
const { aggregate } = require('./backtest-real/aggregator');

// Strategy selector (orb | ema | ema-orb | hl-reversal)
const STRATEGY_NAME = String(process.env.BACKTEST_STRATEGY || 'orb').toLowerCase();
const { runStrategy } =
    STRATEGY_NAME === 'ema'         ? require('./backtest-real/strategy-ema')
  : STRATEGY_NAME === 'ema-orb'     ? require('./backtest-real/strategy-ema-orb')
  : STRATEGY_NAME === 'hl-reversal' ? require('./backtest-real/strategy-hl-reversal')
                                     : require('./backtest-real/strategy-runner');

// Index resolver (SENSEX vs NIFTY)
const { resolveIndexSpot } = require('./backtest-real/instruments');

// Reuse the holiday set from expiry-days for accurate skip behaviour.
const INDIA_HOLIDAYS = new Set([
  '2022-01-26','2022-03-01','2022-03-18','2022-04-14','2022-04-15',
  '2022-05-03','2022-08-09','2022-08-15','2022-08-31','2022-10-05',
  '2022-10-24','2022-10-26','2022-11-08',
  '2023-01-26','2023-03-07','2023-03-30','2023-04-04','2023-04-07',
  '2023-04-14','2023-05-01','2023-06-28','2023-08-15','2023-09-19',
  '2023-10-02','2023-10-24','2023-11-14','2023-11-27','2023-12-25',
  '2024-01-26','2024-03-08','2024-03-25','2024-03-29','2024-04-11',
  '2024-04-17','2024-05-01','2024-05-20','2024-06-17','2024-07-17',
  '2024-08-15','2024-10-02','2024-11-01','2024-11-15','2024-12-25',
  '2025-02-26','2025-03-14','2025-03-31','2025-04-10','2025-04-14',
  '2025-04-18','2025-05-01','2025-08-15','2025-08-27','2025-10-02',
  '2025-10-21','2025-10-22','2025-11-05','2025-12-25',
  '2026-01-26','2026-02-17','2026-03-03','2026-03-25','2026-04-03'
]);

function generateTradingDays({ count, startDate = null, endDate, stopAtCutover = true, cutoverDate = '2024-10-28', dowFilter = null }) {
  const out = [];
  const cutover = new Date(`${cutoverDate}T00:00:00Z`);
  const cursor = new Date(`${endDate}T00:00:00Z`);
  const start = startDate ? new Date(`${startDate}T00:00:00Z`) : null;
  cursor.setUTCHours(0, 0, 0, 0);
  if (start) start.setUTCHours(0, 0, 0, 0);

  // Friday-only weekly contract was delisted at cutover; if we stop there,
  // jump straight to the day before so we don't waste API calls on dates
  // that have no usable Dhan option data for Friday-style trading.
  if (stopAtCutover && cursor.getTime() >= cutover.getTime()) {
    cursor.setTime(cutover.getTime() - 86400000);
  }

  while (out.length < count && (!start || cursor.getTime() >= start.getTime())) {
    const dow = cursor.getUTCDay();
    const ymd = toYmd(cursor);
    const isWeekday = dow >= 1 && dow <= 5;
    const dowName = ['SUN','MON','TUE','WED','THU','FRI','SAT'][dow];
    const dowOk = !dowFilter || dowFilter.includes(dowName);
    if (isWeekday && dowOk && !INDIA_HOLIDAYS.has(ymd)) {
      out.push({ date: ymd, weekday: dowName });
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out.reverse();
}

async function main() {
  const instrument = String(process.env.BACKTEST_INSTRUMENT || 'SENSEX').toUpperCase();
  const isNifty    = instrument === 'NIFTY';
  const isBankNifty= instrument === 'BANKNIFTY';
  const isNseIdx   = isNifty || isBankNifty;
  // Bank NIFTY: lot 30, NIFTY: 65, SENSEX: 20
  const lotSize    = isBankNifty ? 30 : isNifty ? 65 : 20;
  const cfg = {
    instrument,
    optionExchangeSegment: isNseIdx ? 'NSE_FNO' : 'BSE_FNO',
    numDays:      Number(process.env.DAILY_BACKTEST_DAYS  || 500),
    startDate:    process.env.DAILY_BACKTEST_START         || '',
    endDate:      process.env.DAILY_BACKTEST_END          || toYmd(new Date()),
    maxTradesPerDay: Number(process.env.BACKTEST_MAX_TRADES_PER_DAY || process.env.MAX_TRADES_PER_DAY || 0),
    // For NSE indices there is no cutover (NSE didn't change weekly day) — disable cutoff.
    stopAtCutover: !isNseIdx && String(process.env.DAILY_BACKTEST_FRIDAY_CUTOVER || 'true').toLowerCase() === 'true',
    cutover:      process.env.SENSEX_EXPIRY_CUTOVER       || '2024-10-28',
    dowFilter:    process.env.DAILY_BACKTEST_DOW
                    ? process.env.DAILY_BACKTEST_DOW.toUpperCase().split(',').map(s => s.trim())
                    : null,
    interval:     Number(process.env.BACKTEST_INTERVAL     || 5),
    strikeOffset: Number(process.env.BACKTEST_STRIKE_OFFSET || 1),
    cacheDir:     path.resolve(process.env.BACKTEST_CACHE_DIR
      || (isBankNifty ? './data/dhan-cache-banknifty-daily'
                      : isNifty ? './data/dhan-cache-nifty-daily'
                                : './data/dhan-cache-daily')),
    risk: {
      stopLossPct:        Number(process.env.STOP_LOSS_PERCENT     || 10),
      targetPct:          Number(process.env.TARGET_PERCENT        || 400),
      trailAfterMultiple: Number(process.env.TRAIL_AFTER_MULTIPLE  || 2),
      trailLockPct:       Number(process.env.TRAIL_LOCK_PERCENT    || 50),
      slippagePct:        Number(process.env.SLIPPAGE_PERCENT      || 2),
      lotSize:            lotSize,
      brokeragePerOrder:  Number(process.env.BROKERAGE_PER_ORDER   || 30)
    }
  };

  console.log(`\nDAILY BACKTEST — ${cfg.instrument}, every weekday`);
  console.log(`  Strategy:           ${STRATEGY_NAME.toUpperCase()}  (${STRATEGY_NAME === 'ema' ? 'EMA 9/21 crossover' : 'ORB+VWAP breakout'})`);
  console.log(`  Lot size:           ${cfg.risk.lotSize}  (brokerage ₹${cfg.risk.brokeragePerOrder}/order)`);
  console.log(`  Days:               ${cfg.numDays} (ending ${cfg.endDate})`);
  console.log(`  Start date:         ${cfg.startDate || 'auto'}`);
  console.log(`  Max trades/day:     ${cfg.maxTradesPerDay || 'no cap'}`);
  console.log(`  Interval / Strike:  ${cfg.interval}m / ATM${cfg.strikeOffset >= 0 ? '+' : ''}${cfg.strikeOffset}`);
  console.log(`  Risk — SL:          ${cfg.risk.stopLossPct}%`);
  console.log(`  Risk — Target:      ${cfg.risk.targetPct}%`);
  console.log(`  Risk — Trail:       after ${cfg.risk.trailAfterMultiple}×, lock ${cfg.risk.trailLockPct}%`);
  console.log(`  Slippage:           ${cfg.risk.slippagePct}% (entry + exit)`);
  console.log(`  Cache dir:          ${cfg.cacheDir}\n`);

  if (!fs.existsSync(cfg.cacheDir)) fs.mkdirSync(cfg.cacheDir, { recursive: true });

  const client  = new DhanClient();
  const spot    = await resolveIndexSpot(instrument, cfg.cacheDir);
  const days    = generateTradingDays({
    count: cfg.numDays, startDate: cfg.startDate, endDate: cfg.endDate,
    stopAtCutover: cfg.stopAtCutover, cutoverDate: cfg.cutover,
    dowFilter: cfg.dowFilter
  });
  console.log(`[2/4] Generated ${days.length} trading days: ${days[0].date} → ${days[days.length-1].date}\n`);

  const fetcher = new DataFetcher({
    client, spot, cacheDir: cfg.cacheDir, interval: cfg.interval,
    optionExchangeSegment: cfg.optionExchangeSegment, cacheLabel: instrument
  });

  console.log(`[3/4] Fetching + simulating...`);
  const results = [];
  const out = path.resolve('./backtest-daily-results.json');
  const checkpointEvery = Number(process.env.DAILY_BACKTEST_CHECKPOINT_EVERY || 100);
  let i = 0;
  for (const day of days) {
    i++;
    const prefix = `  [${String(i).padStart(4)}/${days.length}] ${day.date} (${day.weekday})`;
    try {
      const spotCandles = await fetcher.getSpotCandles(day.date);
      if (!spotCandles?.length) { console.log(`${prefix}  no spot data`); results.push({ ...day, spotCandles: [], signals: [], trades: [] }); continue; }

      const strategyResult = runStrategy(spotCandles);
      const signals = cfg.maxTradesPerDay > 0
        ? (strategyResult.signals || []).slice(0, cfg.maxTradesPerDay)
        : (strategyResult.signals || []);
      const trades = [];
      for (const signal of signals) {
        const optionType = signal.signal === 'CALL' ? 'CALL' : 'PUT';
        const so = optionType === 'PUT' ? -cfg.strikeOffset : cfg.strikeOffset;
        const optionCandles = await fetcher.getOptionCandles({
          expiryDate: day.date, strikeOffset: so, optionType, spotCandles
        });
        trades.push(simulateTrade({ signal, optionCandles, risk: cfg.risk }));
      }
      const best = trades.find(t => t.status === 'OK');
      console.log(`${prefix}  ${best ? `${best.type} ${best.multiplier}x (${best.reason})` : (signals.length ? 'signal but no fill' : 'no signal')}`);
      results.push({ ...day, spotCandles, signals, trades });
    } catch (err) {
      console.log(`${prefix}  ERROR: ${err.message}`);
      results.push({ ...day, error: err.message, spotCandles: [], signals: [], trades: [] });
    }

    if (checkpointEvery > 0 && i % checkpointEvery === 0) {
      const checkpoint = aggregate(results);
      fs.writeFileSync(out, JSON.stringify({ ...checkpoint, config: cfg, partial: true }, null, 2));
    }
  }

  console.log(`\n[4/4] Aggregating ${results.length} days...`);
  const report = aggregate(results);
  fs.writeFileSync(out, JSON.stringify({ ...report, config: cfg }, null, 2));

  printReport(report);
  console.log(`\nSaved → ${out}\n`);
}

function printReport(r) {
  const s = r.stats;
  console.log(`\n============================================================`);
  console.log(`  DAILY RESULTS`);
  console.log(`============================================================`);
  console.log(`  Total days tested:       ${r.totalExpiries}`);
  console.log(`  Days with a trade:       ${r.expiriesWithTrades}`);
  console.log(`  Skipped (no signal):     ${r.skipped.noSignal}`);
  console.log(`  Skipped (no option fill):${r.skipped.noOptionData + r.skipped.noEntry}`);
  console.log(`  Skipped (no spot data):  ${r.skipped.noSpotData}`);
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

  if (s.byYear) {
    console.log(`\n  By year:`);
    Object.entries(s.byYear).sort().forEach(([y, d]) => {
      const wr = d.trades > 0 ? ((d.wins / d.trades) * 100).toFixed(0) : 0;
      console.log(`    ${y}: ${d.trades} trades, ${wr}% win, avg ${(d.totalPnl / d.trades).toFixed(1)}% pnl`);
    });
  }
  if (s.byType) {
    console.log(`\n  By side:`);
    console.log(`    CALL: ${s.byType.CALL.trades} trades, ${s.byType.CALL.wins} wins`);
    console.log(`    PUT:  ${s.byType.PUT.trades} trades, ${s.byType.PUT.wins} wins`);
  }
  if (s.byReason) {
    console.log(`\n  Exit reasons:`);
    Object.entries(s.byReason).forEach(([k, v]) => console.log(`    ${k}: ${v}`));
  }
  console.log();
  console.log(`  Day-of-week breakdown:`);
  const byDow = {};
  for (const t of r.trades || []) {
    const dow = t.weekday;
    byDow[dow] = byDow[dow] || { trades: 0, wins: 0, totalPnl: 0 };
    byDow[dow].trades++;
    byDow[dow].totalPnl += t.pnlPct;
    if (t.win) byDow[dow].wins++;
  }
  for (const dow of ['MON','TUE','WED','THU','FRI']) {
    const d = byDow[dow];
    if (!d) { console.log(`    ${dow}: no trades`); continue; }
    const wr = ((d.wins / d.trades) * 100).toFixed(0);
    console.log(`    ${dow}: ${d.trades} trades, ${wr}% win, avg ${(d.totalPnl / d.trades).toFixed(1)}% pnl`);
  }
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(err => {
    console.error('\nFatal:', err.message);
    if (err.body) console.error('Body:', JSON.stringify(err.body, null, 2));
    process.exit(1);
  });
}
