/**
 * Trail sweep — holds best SL/target/Friday config, varies the trailing
 * stop's activation multiple and lock %.
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

const SLIPPAGE_PCT = Number(process.env.SLIPPAGE_PERCENT || 2);

const CAPITAL_TOTAL = Number(process.env.CAPITAL_TOTAL || 50000);
const CAPITAL_PCT   = Number(process.env.CAPITAL_PER_TRADE_PERCENT || 5);

const SL_PCT     = Number(process.env.STOP_LOSS_PERCENT || 5);
const TARGET_PCT = Number(process.env.TARGET_PERCENT    || 400);

// (activation multiple, lock %) pairs — picked to span tight→loose
const TRAIL_GRID = [
  [1.5, 30], [1.5, 50], [1.5, 70],
  [2.0, 30], [2.0, 50], [2.0, 70], [2.0, 90],
  [2.5, 30], [2.5, 50], [2.5, 70],
  [3.0, 30], [3.0, 50], [3.0, 70],
  [4.0, 50], [4.0, 70],
];

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

  console.log(`\nTRAIL SWEEP — ${instrument} ${thursdayOnly ? 'Thursday' : fridayOnly ? 'Friday' : 'auto'}  (SL=${SL_PCT}%, target=${TARGET_PCT}%, slip ${SLIPPAGE_PCT}%)`);
  console.log(`Cache: ${cacheDir}\n`);

  const client  = new DhanClient();
  const spot    = await resolveIndexSpot(instrument, cacheDir);
  const days    = generateExpiryDays({ count: numExpiries, cutoverDate: cutover, endDate: toYmd(new Date()), fridayOnly, thursdayOnly, instrument });
  const fetcher = new DataFetcher({ client, spot, cacheDir, interval, optionExchangeSegment, cacheLabel: instrument });

  console.log(`Loading ${days.length} Friday expiries...`);
  const loaded = [];
  let i = 0;
  for (const day of days) {
    i++;
    if (i % 50 === 0) console.log(`  ${i}/${days.length}`);
    try {
      const spotCandles = await fetcher.getSpotCandles(day.date);
      if (!spotCandles?.length) { loaded.push({ ...day, spotCandles: [], signals: [], optChainsBySig: [] }); continue; }
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

  console.log(`\nSimulating ${TRAIL_GRID.length} trail combos...\n`);
  const rows = [];
  for (const [trailAfter, trailLock] of TRAIL_GRID) {
    const risk = { stopLossPct: SL_PCT, targetPct: TARGET_PCT, trailAfterMultiple: trailAfter, trailLockPct: trailLock, slippagePct: SLIPPAGE_PCT };
    const results = loaded.map(d => {
      if (d.error || !d.spotCandles.length) return { ...d, trades: [] };
      const trades = d.optChainsBySig.map(({ signal, optionCandles }) => simulateTrade({ signal, optionCandles, risk }));
      return { ...d, trades };
    });
    const r = aggregate(results);
    const s = r.stats;

    const sortedTrades = (r.trades || []).slice().sort((a, b) => a.date.localeCompare(b.date));
    let equity = CAPITAL_TOTAL, peak = CAPITAL_TOTAL, maxDDPct = 0;
    for (const t of sortedTrades) {
      const bet = equity * (CAPITAL_PCT / 100);
      equity += bet * (t.multiplier - 1);
      if (equity > peak) peak = equity;
      const dd = ((peak - equity) / peak) * 100;
      if (dd > maxDDPct) maxDDPct = dd;
    }

    rows.push({
      trailAfter, trailLock,
      trades:  s.totalTrades,
      winRate: s.winRate,
      avgMult: s.avgMultiplier,
      avgPnl:  s.avgPnlPct,
      hit2x:   s.hit2x,
      hit5x:   s.hit5x,
      stops:   s.byReason.STOP_LOSS  || 0,
      trails:  s.byReason.TRAIL_STOP || 0,
      targets: s.byReason.TARGET     || 0,
      eod:     s.byReason.EOD_CLOSE  || 0,
      finalEquity: Math.round(equity),
      finalMult:   +(equity / CAPITAL_TOTAL).toFixed(2),
      maxDDPct:    +maxDDPct.toFixed(1)
    });
  }

  const fmt = (v, w) => String(v).padStart(w);
  console.log(`Trail-After  Lock%   Trades  Win%   AvgMult  AvgPnL%   ≥2x  ≥5x  Stops  Trails  Tgts  EOD  Final₹           Final×    MaxDD%`);
  console.log(`-----------  -----   ------  -----  -------  -------  ----  ---  -----  ------  ----  ---  ---------------  --------  ------`);
  for (const r of rows) {
    console.log(
      `${fmt(r.trailAfter+'×', 11)}  ${fmt(r.trailLock+'%', 5)}   ${fmt(r.trades, 6)}  ${fmt(r.winRate.toFixed(1), 5)}  ${fmt(r.avgMult.toFixed(3), 7)}  ${fmt(r.avgPnl.toFixed(2), 7)}  ${fmt(r.hit2x, 4)}  ${fmt(r.hit5x, 3)}  ${fmt(r.stops, 5)}  ${fmt(r.trails, 6)}  ${fmt(r.targets, 4)}  ${fmt(r.eod, 3)}  ₹${fmt(r.finalEquity.toLocaleString('en-IN'), 13)}  ${fmt(r.finalMult.toFixed(2)+'×', 8)}  ${fmt(r.maxDDPct.toFixed(1), 6)}`
    );
  }

  const best = rows.reduce((a, b) => a.finalEquity > b.finalEquity ? a : b);
  console.log(`\nBest by final equity: trail after ${best.trailAfter}× lock ${best.trailLock}% → ₹${best.finalEquity.toLocaleString('en-IN')}  (${best.finalMult}×, win ${best.winRate}%, avg PnL ${best.avgPnl}%, max DD ${best.maxDDPct}%)`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
