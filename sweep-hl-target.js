/**
 * Target sweep for H/L Reversal Bank NIFTY.
 * Reuses cached data, runs the strategy once, replays simulator with each target %.
 */
require('dotenv').config();

const path = require('path');
const fs = require('fs');
const DhanClient = require('./backtest-real/dhan-client');
const { resolveIndexSpot } = require('./backtest-real/instruments');
const DataFetcher = require('./backtest-real/data-fetcher');
const { runStrategy } = require('./backtest-real/strategy-hl-reversal');
const { simulateTrade } = require('./backtest-real/trade-simulator');
const { aggregate } = require('./backtest-real/aggregator');

const TARGETS  = [50, 75, 100, 150, 200, 300, 400, 500, 700];
const SL_PCT   = Number(process.env.STOP_LOSS_PERCENT     || 30);
const TRAIL_M  = Number(process.env.TRAIL_AFTER_MULTIPLE  || 1.5);
const LOCK_PCT = Number(process.env.TRAIL_LOCK_PERCENT    || 70);
const SLIP_PCT = Number(process.env.SLIPPAGE_PERCENT      || 2);
const CAPITAL  = Number(process.env.CAPITAL_TOTAL || 50000);
const LOTS     = Number(process.argv[2] || 1);

// Reuse the daily backtester's day generator inline (Bank NIFTY: every weekday)
const INDIA_HOLIDAYS = new Set([
  '2025-02-26','2025-03-14','2025-03-31','2025-04-10','2025-04-14','2025-04-18',
  '2025-05-01','2025-08-15','2025-08-27','2025-10-02','2025-10-21','2025-10-22',
  '2025-11-05','2025-12-25',
  '2026-01-26','2026-02-17','2026-03-03','2026-03-25','2026-04-03'
]);
function toYmd(d) { return d.toISOString().slice(0,10); }
function generateWeekdays(count, endStr) {
  const out = [];
  const cursor = new Date(endStr + 'T00:00:00Z');
  while (out.length < count && cursor.getUTCFullYear() >= 2024) {
    const dow = cursor.getUTCDay();
    const ymd = toYmd(cursor);
    if (dow >= 1 && dow <= 5 && !INDIA_HOLIDAYS.has(ymd)) {
      out.push({ date: ymd });
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out.reverse();
}

async function main() {
  const cacheDir = path.resolve('./data/dhan-cache-banknifty-daily');
  if (!fs.existsSync(cacheDir)) {
    console.error('No Bank NIFTY cache. Run the daily backtest first.');
    process.exit(1);
  }
  const client  = new DhanClient();
  const spot    = await resolveIndexSpot('BANKNIFTY', cacheDir);
  const days    = generateWeekdays(300, toYmd(new Date()));
  const fetcher = new DataFetcher({
    client, spot, cacheDir, interval: 5,
    optionExchangeSegment: 'NSE_FNO', cacheLabel: 'BANKNIFTY'
  });

  console.log(`\nH/L REVERSAL BANK NIFTY — Target sweep`);
  console.log(`  Days: ${days.length}   SL=${SL_PCT}%   Trail=${TRAIL_M}× lock ${LOCK_PCT}%   Slip=${SLIP_PCT}%   Lots=${LOTS}\n`);

  console.log(`Loading ${days.length} weekdays from cache...`);
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
        const so = optionType === 'PUT' ? -1 : 1;
        const oc = await fetcher.getOptionCandles({ expiryDate: day.date, strikeOffset: so, optionType, spotCandles });
        optChainsBySig.push({ signal, optionCandles: oc });
      }
      loaded.push({ ...day, spotCandles, signals, optChainsBySig });
    } catch (err) {
      loaded.push({ ...day, error: err.message, spotCandles: [], signals: [], optChainsBySig: [] });
    }
  }

  console.log(`\nReplaying ${TARGETS.length} target values...\n`);
  console.log(`Target%    Trades  Win%   AvgPnL%   Tgts  Trails  Stops  EOD  Final₹           Mult     MaxDD%`);
  console.log(`-------    ------  -----  --------  ----  ------  -----  ---  ---------------  -------  ------`);

  const fmt = (v, w) => String(v).padStart(w);
  let bestRow = null;
  for (const tgt of TARGETS) {
    const risk = { stopLossPct: SL_PCT, targetPct: tgt, trailAfterMultiple: TRAIL_M, trailLockPct: LOCK_PCT, slippagePct: SLIP_PCT, lotSize: 30 * LOTS, brokeragePerOrder: 30 };
    const results = loaded.map(d => {
      if (d.error || !d.spotCandles.length) return { ...d, trades: [] };
      const trades = d.optChainsBySig.map(({ signal, optionCandles }) => simulateTrade({ signal, optionCandles, risk }));
      return { ...d, trades };
    });
    const r = aggregate(results);
    const s = r.stats;

    let equity = CAPITAL, peak = CAPITAL, maxDDPct = 0;
    for (const t of r.trades || []) {
      const lot = (t.lotSize || 30 * LOTS);
      const net = (t.exitPrice - t.entryPrice) * lot - 60;
      equity += net;
      if (equity > peak) peak = equity;
      const dd = ((peak - equity) / peak) * 100;
      if (dd > maxDDPct) maxDDPct = dd;
    }

    const row = {
      tgt, trades: s.totalTrades, winRate: s.winRate, avgPnl: s.avgPnlPct,
      tgts: s.byReason.TARGET || 0, trails: s.byReason.TRAIL_STOP || 0,
      stops: s.byReason.STOP_LOSS || 0, eod: s.byReason.EOD_CLOSE || 0,
      finalEquity: Math.round(equity), finalMult: +(equity / CAPITAL).toFixed(2),
      maxDDPct: +maxDDPct.toFixed(1)
    };
    console.log(
      `${fmt(tgt+'%', 6)}    ${fmt(row.trades, 6)}  ${fmt(row.winRate.toFixed(1), 5)}  ${fmt(row.avgPnl.toFixed(2), 8)}  ${fmt(row.tgts, 4)}  ${fmt(row.trails, 6)}  ${fmt(row.stops, 5)}  ${fmt(row.eod, 3)}  ₹${fmt(row.finalEquity.toLocaleString('en-IN'), 13)}  ${fmt(row.finalMult+'×', 7)}  ${fmt(row.maxDDPct, 6)}`
    );
    if (!bestRow || row.finalEquity > bestRow.finalEquity) bestRow = row;
  }

  console.log(`\nBest by final equity: target=${bestRow.tgt}% → ₹${bestRow.finalEquity.toLocaleString('en-IN')} (${bestRow.finalMult}×, ${bestRow.winRate}% win, ${bestRow.tgts} target hits, max DD ${bestRow.maxDDPct}%)`);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
