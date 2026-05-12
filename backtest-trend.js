require('dotenv').config();

const fs = require('fs');
const path = require('path');

const DhanClient = require('./backtest-real/dhan-client');
const { resolveIndexSpot } = require('./backtest-real/instruments');
const DataFetcher = require('./backtest-real/data-fetcher');

const CAPITAL = Number(process.env.CAPITAL_TOTAL || 50000);
const PCT = Number(process.env.CAPITAL_PER_TRADE_PERCENT || 5);
const REPORT_PATH = path.resolve('./backtest-real-results.json');
const OUTPUT_PATH = path.resolve('./backtest-trend-results.json');

if (!fs.existsSync(REPORT_PATH)) {
  console.error('Run `npm run backtest` first.');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
const trades = (report.trades || []).slice().sort((a, b) => a.entryTimestamp - b.entryTimestamp);

function normalizeInstrument(value) {
  const text = String(value || 'SENSEX').toUpperCase();
  if (text === 'BANK' || text === 'NIFTYBANK') return 'BANKNIFTY';
  if (text === 'BANKNIFTY') return 'BANKNIFTY';
  if (text === 'NIFTY') return 'NIFTY';
  return 'SENSEX';
}

function optionExchangeSegmentFor(instrument) {
  return instrument === 'SENSEX' ? 'BSE_FNO' : 'NSE_FNO';
}

function calculateSimpleTrend(prevCandle, entryCandle) {
  if (!prevCandle || !entryCandle) {
    return { score: 0, label: 'FLAT' };
  }

  let score = 0;
  const priceJump = (entryCandle.o - prevCandle.c) / Math.max(1, prevCandle.c);

  if (priceJump > 0.05) score += 2;
  else if (priceJump > 0.02) score += 1;
  else if (priceJump < -0.05) score -= 2;
  else if (priceJump < -0.02) score -= 1;

  if ((entryCandle.v || 0) > (prevCandle.v || 0) * 1.5) {
    score += 1;
  }

  if (score >= 3) return { score, label: 'STRONG ALIGNED' };
  if (score >= 1) return { score, label: 'ALIGNED' };
  if (score === 0) return { score, label: 'NEUTRAL' };
  return { score, label: 'AGAINST' };
}

function summarizeBuckets(enriched) {
  const buckets = {
    '>=+3': [],
    '+1..+2': [],
    '0': [],
    '-1..-2': [],
    '<=-3': [],
  };

  for (const trade of enriched) {
    if (trade.trendScore >= 3) buckets['>=+3'].push(trade);
    else if (trade.trendScore >= 1) buckets['+1..+2'].push(trade);
    else if (trade.trendScore === 0) buckets['0'].push(trade);
    else if (trade.trendScore >= -2) buckets['-1..-2'].push(trade);
    else buckets['<=-3'].push(trade);
  }

  console.log('Trade distribution by trend score at entry:');
  console.log('Bucket    Count  Wins  Losses  Win%   AvgPnL%   SumPnL%');
  console.log('--------  -----  ----  ------  -----  --------  -------');

  return Object.entries(buckets).map(([bucket, items]) => {
    if (!items.length) {
      console.log(`${bucket.padEnd(8)}  ${'0'.padStart(5)}`);
      return { bucket, count: 0, wins: 0, losses: 0, winPct: 0, avgPnlPct: 0, sumPnlPct: 0 };
    }

    const wins = items.filter((trade) => trade.win).length;
    const losses = items.length - wins;
    const winPct = +(wins / items.length * 100).toFixed(1);
    const avgPnlPct = +(items.reduce((sum, trade) => sum + trade.pnlPct, 0) / items.length).toFixed(1);
    const sumPnlPct = +items.reduce((sum, trade) => sum + trade.pnlPct, 0).toFixed(1);

    console.log(
      `${bucket.padEnd(8)}  ${String(items.length).padStart(5)}  ${String(wins).padStart(4)}  ${String(losses).padStart(6)}  ${String(winPct).padStart(5)}  ${String(avgPnlPct).padStart(8)}  ${String(sumPnlPct).padStart(7)}`
    );

    return { bucket, count: items.length, wins, losses, winPct, avgPnlPct, sumPnlPct };
  });
}

function summarizeFilters(enriched) {
  console.log('\nIf we used trend score as a filter (only take trades where score >= N):');
  console.log('Filter       Trades  Win%   AvgPnL%   Final Rs      Mult   MaxDD%');
  console.log('-----------  ------  -----  --------  ------------  -----  ------');

  return [-99, 0, 1, 2, 3].map((minScore) => {
    const filtered = enriched.filter((trade) => trade.trendScore >= minScore);
    const filter = minScore === -99 ? 'no filter' : `score >= ${minScore}`;

    if (!filtered.length) {
      console.log(`${filter.padEnd(11)}  ${'0'.padStart(6)}`);
      return { filter, minScore, trades: 0, winPct: 0, avgPnlPct: 0, finalEquity: CAPITAL, multiple: 1, maxDrawdownPct: 0 };
    }

    let equity = CAPITAL;
    let peak = CAPITAL;
    let maxDrawdownPct = 0;

    for (const trade of filtered) {
      const bet = equity * (PCT / 100);
      equity += bet * (trade.multiplier - 1);
      if (equity > peak) peak = equity;
      const drawdownPct = ((peak - equity) / peak) * 100;
      if (drawdownPct > maxDrawdownPct) maxDrawdownPct = drawdownPct;
    }

    const wins = filtered.filter((trade) => trade.win).length;
    const winPct = +(wins / filtered.length * 100).toFixed(1);
    const avgPnlPct = +(filtered.reduce((sum, trade) => sum + trade.pnlPct, 0) / filtered.length).toFixed(1);
    const multiple = +(equity / CAPITAL).toFixed(2);
    const finalEquity = Math.round(equity);

    console.log(
      `${filter.padEnd(11)}  ${String(filtered.length).padStart(6)}  ${String(winPct).padStart(5)}  ${String(avgPnlPct).padStart(8)}  Rs${finalEquity.toLocaleString('en-IN').padStart(10)}  ${String(multiple).padStart(5)}  ${maxDrawdownPct.toFixed(1).padStart(6)}`
    );

    return {
      filter,
      minScore,
      trades: filtered.length,
      winPct,
      avgPnlPct,
      finalEquity,
      multiple,
      maxDrawdownPct: +maxDrawdownPct.toFixed(1),
    };
  });
}

async function main() {
  const cacheDir = path.resolve(process.env.BACKTEST_CACHE_DIR || './data/dhan-cache');
  const interval = Number(process.env.BACKTEST_INTERVAL || 5);
  const offset = Number(process.env.BACKTEST_STRIKE_OFFSET || 1);
  const instrument = normalizeInstrument(report?.config?.instrument || report?.instrument || process.env.BACKTEST_INSTRUMENT);

  const client = new DhanClient();
  const spot = await resolveIndexSpot(instrument, cacheDir);
  const fetcher = new DataFetcher({
    client,
    spot,
    cacheDir,
    interval,
    optionExchangeSegment: optionExchangeSegmentFor(instrument),
    cacheLabel: instrument.toLowerCase(),
  });

  if (!trades.length) {
    const empty = {
      generatedAt: new Date().toISOString(),
      sourceReport: REPORT_PATH,
      tradesCount: 0,
      config: { instrument, capital: CAPITAL, capitalPerTradePercent: PCT, interval, strikeOffset: offset, cacheDir },
      bucketSummary: [],
      filterSummary: [],
      trades: [],
    };
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(empty, null, 2));
    console.log('No trades found in base backtest report.');
    return;
  }

  console.log(`\nTREND ENGINE BACKTEST - ${trades.length} trades from ${trades[0].date} to ${trades[trades.length - 1].date}\n`);

  const enriched = [];
  for (const trade of trades) {
    const strikeOffset = trade.type === 'PUT' ? -offset : offset;
    const candles = await fetcher.getOptionCandles({
      expiryDate: trade.date,
      strikeOffset,
      optionType: trade.type === 'PUT' ? 'PUT' : 'CALL',
      spotCandles: null,
    });
    const idx = candles.findIndex((candle) => candle.t >= trade.entryTimestamp);
    const prev = candles[idx - 1] || null;
    const entry = candles[idx] || null;
    const trend = calculateSimpleTrend(prev, entry);
    enriched.push({ ...trade, trendScore: trend.score, trendLabel: trend.label });
  }

  const bucketSummary = summarizeBuckets(enriched);
  const filterSummary = summarizeFilters(enriched);

  const output = {
    generatedAt: new Date().toISOString(),
    sourceReport: REPORT_PATH,
    sourceConfig: report.config || null,
    tradesCount: trades.length,
    config: {
      instrument,
      capital: CAPITAL,
      capitalPerTradePercent: PCT,
      interval,
      strikeOffset: offset,
      cacheDir,
    },
    bucketSummary,
    filterSummary,
    trades: enriched,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`\nSaved trend results -> ${OUTPUT_PATH}`);
  console.log('\nDone.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
