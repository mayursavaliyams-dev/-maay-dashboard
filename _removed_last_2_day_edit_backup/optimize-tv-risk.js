require('dotenv').config();

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance({ suppressNotices: ['ripHistorical'] });

const { aggregate } = require('./backtest-real/aggregator');
const {
  toYmd,
  generateExpiryDays,
  getSignal,
  simulateTrade,
  histVol
} = require('./backtest-tv/run');

const NUM_EXPIRIES = Number(process.env.BACKTEST_NUM_EXPIRIES || 1300);
const START_YEAR = Number(process.env.BACKTEST_START_YEAR || (NUM_EXPIRIES > 1200 ? 1999 : 2003));
const CUTOVER = process.env.SENSEX_EXPIRY_CUTOVER || '2024-10-28';

const SL_VALUES = (process.env.OPT_SL || '3,5,8,10,15,20,25,35')
  .split(',').map(Number).filter(Number.isFinite);
const TARGET_VALUES = (process.env.OPT_TARGET || '100,150,200,300,400,600,900')
  .split(',').map(Number).filter(Number.isFinite);
const TRAIL_AFTER_VALUES = (process.env.OPT_TRAIL_AFTER || '1.5,2,2.5,3')
  .split(',').map(Number).filter(Number.isFinite);
const TRAIL_LOCK_VALUES = (process.env.OPT_TRAIL_LOCK || '40,50,60,70')
  .split(',').map(Number).filter(Number.isFinite);
const CAPITAL_PER_TRADE_PCT = Number(process.env.CAPITAL_PER_TRADE_PERCENT || 5);

function sheetFromObjects(rows) {
  const ws = XLSX.utils.json_to_sheet(rows);
  const headers = Object.keys(rows[0] || {});
  ws['!cols'] = headers.map(h => {
    const max = rows.reduce((m, row) => Math.max(m, String(row[h] ?? '').length), h.length);
    return { wch: Math.min(max + 2, 28) };
  });
  return ws;
}

function replay(rawData, expiryDays, risk) {
  const byDate = {};
  rawData.forEach((c, i) => { byDate[toYmd(c.date)] = { idx: i, c }; });

  const results = [];
  for (const day of expiryDays) {
    const entry = byDate[day.date];
    if (!entry) {
      results.push({ ...day, spotCandles: [], signals: [], trades: [] });
      continue;
    }

    const { idx, c: raw } = entry;
    const candle = { open: raw.open, high: raw.high, low: raw.low, close: raw.close };
    const prevSlice = rawData.slice(Math.max(0, idx - 21), idx).map(x => x.close);
    const vol = histVol(prevSlice);
    const prevClose = prevSlice.length ? prevSlice[prevSlice.length - 1] : candle.open;
    const sig = getSignal(candle, prevClose, prevSlice.slice(-5), vol, day.date);

    const trades = [];
    if (sig) {
      const trade = simulateTrade({
        signal: sig.direction,
        candle,
        vol,
        risk,
        strikeOffset: sig.strikeOffset,
        confidence: sig.confidence
      });
      if (trade) trades.push(trade);
    }

    results.push({
      ...day,
      spotCandles: [candle],
      signals: sig ? [{ signal: sig.direction, confidence: sig.confidence === 'HIGH' ? 90 : 75, time: `${day.date}T09:31:00` }] : [],
      trades
    });
  }

  return aggregate(results);
}

function rankScore(row) {
  if (row.trades < 50) return -Infinity;
  return row.finalEquityX * (1 - row.maxDrawdownPct / 100);
}

async function main() {
  const expiryDays = generateExpiryDays({
    count: NUM_EXPIRIES,
    cutoverDate: CUTOVER,
    endDate: toYmd(new Date()),
    startYear: START_YEAR
  });

  const firstDate = expiryDays[0].date;
  const lastDate = expiryDays[expiryDays.length - 1].date;
  const fetchFrom = new Date(firstDate);
  fetchFrom.setDate(fetchFrom.getDate() - 35);
  const fetchTo = new Date(`${lastDate}T00:00:00Z`);
  fetchTo.setUTCDate(fetchTo.getUTCDate() + 2);

  console.log(`Fetching ^BSESN candles for ${expiryDays.length} expiries (${firstDate} to ${lastDate})...`);
  const rawData = await yf.historical('^BSESN', {
    period1: toYmd(fetchFrom),
    period2: toYmd(fetchTo),
    interval: '1d'
  });
  rawData.sort((a, b) => new Date(a.date) - new Date(b.date));
  console.log(`Got ${rawData.length} daily candles.`);

  const rows = [];
  const totalCombos = SL_VALUES.length * TARGET_VALUES.length * TRAIL_AFTER_VALUES.length * TRAIL_LOCK_VALUES.length;
  let done = 0;

  for (const stopLossPct of SL_VALUES) {
    for (const targetPct of TARGET_VALUES) {
      for (const trailAfterMultiple of TRAIL_AFTER_VALUES) {
        for (const trailLockPct of TRAIL_LOCK_VALUES) {
          done++;
          if (done % 100 === 0) console.log(`Simulated ${done}/${totalCombos} settings...`);

          const risk = { stopLossPct, targetPct, trailAfterMultiple, trailLockPct };
          const report = replay(rawData, expiryDays, risk);
          const s = report.stats;

          const sortedTrades = (report.trades || []).slice().sort((a, b) => a.date.localeCompare(b.date));
          let fullEquity = 1;
          let equity = 1;
          let peak = 1;
          let maxDrawdownPct = 0;
          for (const t of sortedTrades) {
            fullEquity *= Math.max(0.001, t.multiplier);
            equity += equity * (CAPITAL_PER_TRADE_PCT / 100) * (t.multiplier - 1);
            if (equity > peak) peak = equity;
            const dd = ((peak - equity) / peak) * 100;
            if (dd > maxDrawdownPct) maxDrawdownPct = dd;
          }

          rows.push({
            stopLossPct,
            targetPct,
            trailAfterMultiple,
            trailLockPct,
            trades: s.totalTrades,
            winRate: s.winRate,
            avgMultiplier: s.avgMultiplier,
            medianMultiplier: s.medianMultiplier,
            maxMultiplier: s.maxMultiplier,
            avgPnlPct: s.avgPnlPct,
            hit2x: s.hit2x,
            hit5x: s.hit5x,
            targets: s.byReason.TARGET || 0,
            stopLosses: s.byReason.STOP_LOSS || 0,
            trails: s.byReason.TRAIL_STOP || 0,
            eod: s.byReason.EOD_CLOSE || 0,
            fullCompoundedX: +fullEquity.toFixed(4),
            finalEquityX: +equity.toFixed(4),
            maxDrawdownPct: +maxDrawdownPct.toFixed(2)
          });
        }
      }
    }
  }

  rows.sort((a, b) => rankScore(b) - rankScore(a));
  rows.forEach((row, index) => { row.rank = index + 1; });

  const outDir = path.resolve('exports');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, `tv-risk-optimization-${NUM_EXPIRIES}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt: new Date().toISOString(), numExpiries: NUM_EXPIRIES, rows }, null, 2));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheetFromObjects(rows), 'All Settings');
  XLSX.utils.book_append_sheet(wb, sheetFromObjects(rows.slice(0, 30)), 'Top 30');
  const xlsxPath = path.join(outDir, `tv-risk-optimization-${NUM_EXPIRIES}.xlsx`);
  XLSX.writeFile(wb, xlsxPath);

  console.log('\nTop 10 settings:');
  console.table(rows.slice(0, 10).map(r => ({
    rank: r.rank,
    sl: r.stopLossPct,
    target: r.targetPct,
    trailAfter: r.trailAfterMultiple,
    trailLock: r.trailLockPct,
    trades: r.trades,
    winRate: r.winRate,
    avgMult: r.avgMultiplier,
    med: r.medianMultiplier,
    equityX: r.finalEquityX,
    maxDD: r.maxDrawdownPct
  })));
  console.log(`Saved ${jsonPath}`);
  console.log(`Saved ${xlsxPath}`);
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
