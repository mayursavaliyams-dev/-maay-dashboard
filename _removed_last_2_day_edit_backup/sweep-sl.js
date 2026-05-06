/**
 * SL sweep — re-uses cached candles from prior backtest, runs many SL values
 * through the trade simulator, and prints the curve.
 *
 * Holds TARGET, TRAIL, FRIDAY_ONLY constant. Sweeps STOP_LOSS_PERCENT only.
 */
require('dotenv').config();

const path = require('path');
const DhanClient = require('./backtest-real/dhan-client');
const { resolveIndexSpot } = require('./backtest-real/instruments');
const { generateExpiryDays, toYmd } = require('./backtest-real/expiry-days');
const DataFetcher = require('./backtest-real/data-fetcher');
const { runStrategy } = require('./backtest-real/strategy-runner');
const { simulateTrade } = require('./backtest-real/trade-simulator');
const { aggregate } = require('./backtest-real/aggregator');

const SL_VALUES = [3, 5, 8, 10, 15, 20, 25, 30, 35, 40, 50, 60, 70];
const TARGET_PCT       = Number(process.env.TARGET_PERCENT       || 400);
const TRAIL_AFTER_MULT = Number(process.env.TRAIL_AFTER_MULTIPLE || 2);
const TRAIL_LOCK_PCT   = Number(process.env.TRAIL_LOCK_PERCENT   || 50);
const SLIPPAGE_PCT     = Number(process.env.SLIPPAGE_PERCENT     || 2);

async function main() {
  const instrument = String(process.env.BACKTEST_INSTRUMENT || 'SENSEX').toUpperCase();
  const isNifty    = instrument === 'NIFTY';
  const isBankNifty= instrument === 'BANKNIFTY' || instrument === 'BANK' || instrument === 'NIFTYBANK';
  const isNseIndex = isNifty || isBankNifty;
  const defaultCache = isBankNifty ? './data/dhan-cache-banknifty'
                     : isNifty     ? './data/dhan-cache-nifty'
                                   : './data/dhan-cache';
  const cacheDir     = path.resolve(process.env.BACKTEST_CACHE_DIR || defaultCache);
  const numExpiries  = Number(process.env.BACKTEST_NUM_EXPIRIES || 1200);
  const interval     = Number(process.env.BACKTEST_INTERVAL || 5);
  const strikeOffset = Number(process.env.BACKTEST_STRIKE_OFFSET || 1);
  const cutover      = process.env.SENSEX_EXPIRY_CUTOVER || '2024-10-28';

  const fridayOnly   = !isNseIndex && String(process.env.BACKTEST_FRIDAY_ONLY || 'true').toLowerCase() === 'true';
  const thursdayOnly = false;
  const optionExchangeSegment = isNseIndex ? 'NSE_FNO' : 'BSE_FNO';

  console.log(`\nSL SWEEP — ${instrument} ${thursdayOnly ? 'Thursday' : fridayOnly ? 'Friday' : 'auto-cutover'}`);
  console.log(`  target=${TARGET_PCT}%  trail after ${TRAIL_AFTER_MULT}× lock ${TRAIL_LOCK_PCT}%  slippage=${SLIPPAGE_PCT}%`);
  console.log(`  cache: ${cacheDir}\n`);

  const client  = new DhanClient();
  const spot    = await resolveIndexSpot(instrument, cacheDir);
  const days    = generateExpiryDays({ count: numExpiries, cutoverDate: cutover, endDate: toYmd(new Date()), fridayOnly, thursdayOnly, instrument });
  const fetcher = new DataFetcher({ client, spot, cacheDir, interval, optionExchangeSegment, cacheLabel: instrument });

  // ── Phase 1: load all spot + signal + option candles once (cache hits) ──
  console.log(`Loading ${days.length} expiries...`);
  const loaded = [];
  let i = 0;
  for (const day of days) {
    i++;
    if (i % 50 === 0) console.log(`  ${i}/${days.length}`);
    try {
      const spotCandles = await fetcher.getSpotCandles(day.date);
      if (!spotCandles || !spotCandles.length) { loaded.push({ ...day, spotCandles: [], signals: [], optChainsBySig: [] }); continue; }
      const { signals } = runStrategy(spotCandles);
      const optChainsBySig = [];
      for (const signal of signals) {
        const optionType = signal.signal === 'CALL' ? 'CALL' : 'PUT';
        const so = optionType === 'PUT' ? -strikeOffset : strikeOffset;
        const optionCandles = await fetcher.getOptionCandles({ expiryDate: day.date, strikeOffset: so, optionType, spotCandles });
        optChainsBySig.push({ signal, optionCandles });
      }
      loaded.push({ ...day, spotCandles, signals, optChainsBySig });
    } catch (err) {
      loaded.push({ ...day, error: err.message, spotCandles: [], signals: [], optChainsBySig: [] });
    }
  }

  // ── Phase 2: for each SL, replay simulator and aggregate ──
  console.log(`\nSimulating ${SL_VALUES.length} SL values...\n`);
  const rows = [];
  for (const sl of SL_VALUES) {
    const risk = { stopLossPct: sl, targetPct: TARGET_PCT, trailAfterMultiple: TRAIL_AFTER_MULT, trailLockPct: TRAIL_LOCK_PCT, slippagePct: SLIPPAGE_PCT };
    const results = loaded.map(d => {
      if (d.error || !d.spotCandles.length) return { ...d, trades: [] };
      const trades = d.optChainsBySig.map(({ signal, optionCandles }) => simulateTrade({ signal, optionCandles, risk }));
      return { ...d, trades };
    });
    const r = aggregate(results);
    const s = r.stats;
    rows.push({
      sl,
      trades:    s.totalTrades,
      winRate:   s.winRate,
      avgMult:   s.avgMultiplier,
      medianMult:s.medianMultiplier,
      avgPnl:    s.avgPnlPct,
      hit2x:     s.hit2x,
      hit5x:     s.hit5x,
      stops:     s.byReason.STOP_LOSS  || 0,
      trails:    s.byReason.TRAIL_STOP || 0,
      targets:   s.byReason.TARGET     || 0,
      eod:       s.byReason.EOD_CLOSE  || 0,
      // Total return = product of (1 + pnl/100) across all trades, expressed as %
      // (assumes equal sizing each trade)
      totalRetX: +Math.exp(r.trades.reduce((a, t) => a + Math.log(1 + t.pnlPct / 100), 0)).toFixed(3)
    });
  }

  // ── Print table ──
  const fmt = (v, w) => String(v).padStart(w);
  console.log(`SL%  Trades  Win%   AvgMult  Median  AvgPnL%   ≥2x  ≥5x  Stops  Trails  Targets  EOD  TotalRet(x)`);
  console.log(`---  ------  -----  -------  ------  -------  ----  ---  -----  ------  -------  ---  -----------`);
  for (const r of rows) {
    console.log(
      `${fmt(r.sl, 3)}  ${fmt(r.trades, 6)}  ${fmt(r.winRate.toFixed(1), 5)}  ${fmt(r.avgMult.toFixed(3), 7)}  ${fmt(r.medianMult.toFixed(3), 6)}  ${fmt(r.avgPnl.toFixed(2), 7)}  ${fmt(r.hit2x, 4)}  ${fmt(r.hit5x, 3)}  ${fmt(r.stops, 5)}  ${fmt(r.trails, 6)}  ${fmt(r.targets, 7)}  ${fmt(r.eod, 3)}  ${fmt(r.totalRetX.toFixed(3), 11)}`
    );
  }

  const best = rows.reduce((a, b) => a.totalRetX > b.totalRetX ? a : b);
  console.log(`\nBest by compounded total return: SL=${best.sl}% → ${best.totalRetX}× over ${best.trades} trades (avg PnL ${best.avgPnl}%, win rate ${best.winRate}%).`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
