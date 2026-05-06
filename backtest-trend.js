/**
 * TREND ENGINE BACKTEST
 *
 * For each Friday in the existing backtest set, we replay the entry candle
 * through the trend logic from public/chain-trend.html (calculateTrend()) and
 * see whether the trend signal at entry was aligned with the trade direction.
 *
 * This validates whether the trend engine could be used as a FILTER on
 * future trades (only enter when trend ≥ +2 for CALL, ≤ -2 for PUT).
 *
 * Reuses cached candles. Prints:
 *   - per-trade trend score at entry
 *   - filter results: wins/losses + equity if we'd ONLY taken aligned trades
 */
require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const DhanClient = require('./backtest-real/dhan-client');
const { resolveSensexSpot } = require('./backtest-real/instruments');
const DataFetcher = require('./backtest-real/data-fetcher');

const CAPITAL    = Number(process.env.CAPITAL_TOTAL || 50000);
const PCT        = Number(process.env.CAPITAL_PER_TRADE_PERCENT || 5);
const REPORT_PATH = path.resolve('./backtest-real-results.json');

if (!fs.existsSync(REPORT_PATH)) {
  console.error('Run `npm run backtest` first.');
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
const trades = (report.trades || []).slice().sort((a, b) => a.entryTimestamp - b.entryTimestamp);

// ────────────────────────────────────────────────────────────────
// Trend logic — mirror of public/chain-trend.html calculateTrend(),
// but using single-leg candle data (we only have CE OR PE for each trade).
// We build a SIMPLIFIED version using just the entry candle vs the prior
// candle of the same option, on the assumption "leading momentum" predicts
// continuation.
// ────────────────────────────────────────────────────────────────
function calculateSimpleTrend(prevCandle, entryCandle, signalSide) {
  if (!prevCandle || !entryCandle) return { score: 0, label: 'FLAT' };
  let score = 0;
  // PRICE: did the option premium just expand strongly?
  const px = (entryCandle.o - prevCandle.c) / Math.max(1, prevCandle.c);
  if (px > 0.05) score += 2;       // strong expansion = strong directional move on the underlying
  else if (px > 0.02) score += 1;
  else if (px < -0.05) score -= 2;
  else if (px < -0.02) score -= 1;
  // VOLUME: was the entry candle's volume above the prior bar?
  if ((entryCandle.v || 0) > (prevCandle.v || 0) * 1.5) score += 1;
  // OI / IV not available per-bar in the cached data — those would add accuracy
  // The signal side flips bear scores positive: a rising PE premium is bearish for spot
  // but BULLISH for the trade itself (we're long PE). For trade-alignment, treat
  // any positive score as ALIGNED with the trade direction.
  let label;
  if (score >= 3) label = 'STRONG ALIGNED';
  else if (score >= 1) label = 'ALIGNED';
  else if (score === 0) label = 'NEUTRAL';
  else label = 'AGAINST';
  return { score, label };
}

// ────────────────────────────────────────────────────────────────
// Main: enrich each trade with trend score from cached candles.
// ────────────────────────────────────────────────────────────────
async function main() {
  const cacheDir = path.resolve(process.env.BACKTEST_CACHE_DIR || './data/dhan-cache');
  const interval = Number(process.env.BACKTEST_INTERVAL || 5);
  const offset   = Number(process.env.BACKTEST_STRIKE_OFFSET || 1);

  const client  = new DhanClient();
  const sensex  = await resolveSensexSpot(cacheDir);
  const fetcher = new DataFetcher({ client, sensex, cacheDir, interval });

  console.log(`\nTREND ENGINE BACKTEST — ${trades.length} trades from ${trades[0].date} → ${trades[trades.length-1].date}\n`);

  const enriched = [];
  for (const t of trades) {
    const so = t.type === 'PUT' ? -offset : offset;
    const candles = await fetcher.getOptionCandles({
      expiryDate: t.date, strikeOffset: so, optionType: t.type === 'PUT' ? 'PUT' : 'CALL', spotCandles: null
    });
    const idx = candles.findIndex(c => c.t >= t.entryTimestamp);
    const prev = candles[idx - 1] || null;
    const entry = candles[idx] || null;
    const trend = calculateSimpleTrend(prev, entry, t.type);
    enriched.push({ ...t, trendScore: trend.score, trendLabel: trend.label });
  }

  // ── Bucket: by trend score & by alignment ──
  const buckets = { '≥+3': [], '+1..+2': [], '0': [], '-1..-2': [], '≤-3': [] };
  for (const t of enriched) {
    if (t.trendScore >=  3) buckets['≥+3'].push(t);
    else if (t.trendScore >=  1) buckets['+1..+2'].push(t);
    else if (t.trendScore ===  0) buckets['0'].push(t);
    else if (t.trendScore >= -2) buckets['-1..-2'].push(t);
    else                         buckets['≤-3'].push(t);
  }

  console.log('Trade distribution by trend score at entry:');
  console.log('Bucket    Count  Wins  Losses  Win%   AvgPnL%   Sum PnL%');
  console.log('--------  -----  ----  ------  -----  --------  --------');
  for (const [name, arr] of Object.entries(buckets)) {
    if (!arr.length) { console.log(`${name.padEnd(8)}  ${'0'.padStart(5)}`); continue; }
    const wins   = arr.filter(t => t.win).length;
    const losses = arr.length - wins;
    const winPct = (wins / arr.length * 100).toFixed(1);
    const avgPnl = (arr.reduce((s, t) => s + t.pnlPct, 0) / arr.length).toFixed(1);
    const sumPnl = arr.reduce((s, t) => s + t.pnlPct, 0).toFixed(1);
    console.log(`${name.padEnd(8)}  ${String(arr.length).padStart(5)}  ${String(wins).padStart(4)}  ${String(losses).padStart(6)}  ${winPct.padStart(5)}  ${avgPnl.padStart(8)}  ${sumPnl.padStart(8)}`);
  }

  // ── Filter scenarios ──
  console.log('\nIf we used trend score as a FILTER (only take trades where score ≥ N):');
  console.log('  Filter       Trades  Win%   AvgPnL%   Final ₹       Mult     Max DD%');
  console.log('  -----------  ------  -----  --------  ------------  -------  -------');
  for (const minScore of [-99, 0, 1, 2, 3]) {
    const filtered = enriched.filter(t => t.trendScore >= minScore);
    if (!filtered.length) { console.log(`  score ≥ ${String(minScore).padStart(2)}    ${'0'.padStart(6)}`); continue; }
    let equity = CAPITAL, peak = CAPITAL, maxDDPct = 0;
    for (const t of filtered) {
      const bet = equity * (PCT / 100);
      equity += bet * (t.multiplier - 1);
      if (equity > peak) peak = equity;
      const dd = ((peak - equity) / peak) * 100;
      if (dd > maxDDPct) maxDDPct = dd;
    }
    const wins   = filtered.filter(t => t.win).length;
    const winPct = (wins / filtered.length * 100).toFixed(1);
    const avgPnl = (filtered.reduce((s, t) => s + t.pnlPct, 0) / filtered.length).toFixed(1);
    const mult   = (equity / CAPITAL).toFixed(2);
    const lbl    = minScore === -99 ? 'no filter' : `score ≥ ${minScore.toString().padStart(2)}`;
    console.log(`  ${lbl.padEnd(11)}  ${String(filtered.length).padStart(6)}  ${winPct.padStart(5)}  ${avgPnl.padStart(8)}  ₹${Math.round(equity).toLocaleString('en-IN').padStart(11)}  ${mult.padStart(5)}×   ${maxDDPct.toFixed(1).padStart(6)}`);
  }

  console.log('\nDone.');
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
