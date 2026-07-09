function aggregate(results) {
  const trades = [];
  const expirySummaries = [];
  const skipped = { noSpotData: 0, noSignal: 0, noOptionData: 0, noEntry: 0, fetchError: 0 };

  for (const r of results) {
    if (r.error) { skipped.fetchError++; continue; }
    if (!r.spotCandles || r.spotCandles.length === 0) {
      expirySummaries.push({
        date: r.date,
        era: r.era,
        weekday: r.weekday,
        traded: false,
        skipReason: 'NO_SPOT_DATA'
      });
      skipped.noSpotData++;
      continue;
    }
    if (!r.signals || r.signals.length === 0) {
      expirySummaries.push({
        date: r.date,
        era: r.era,
        weekday: r.weekday,
        traded: false,
        skipReason: 'NO_SIGNAL'
      });
      skipped.noSignal++;
      continue;
    }

    const tradeResults = [];
    for (const trade of r.trades) {
      if (trade.status === 'NO_OPTION_DATA') { skipped.noOptionData++; continue; }
      if (trade.status === 'NO_ENTRY_CANDLE' || trade.status === 'BAD_ENTRY_PRICE') { skipped.noEntry++; continue; }
      if (trade.status === 'OK') {
        tradeResults.push(trade);
        trades.push({ ...trade, date: r.date, era: r.era, weekday: r.weekday });
      }
    }

    expirySummaries.push({
      date: r.date,
      era: r.era,
      weekday: r.weekday,
      traded: tradeResults.length > 0,
      bestMultiplier: tradeResults.length ? Math.max(...tradeResults.map(t => t.multiplier)) : 0,
      numTrades: tradeResults.length
    });
  }

  const stats = computeStats(trades);
  return {
    generatedAt: new Date().toISOString(),
    dataSource: 'Dhan HQ (real option candles)',
    totalExpiries: results.length,
    expiriesWithTrades: expirySummaries.filter(e => e.traded).length,
    skipped,
    stats,
    trades,
    expirySummaries
  };
}

function computeStats(trades) {
  if (trades.length === 0) {
    return { totalTrades: 0, winRate: 0, avgMultiplier: 0, maxMultiplier: 0, hit5x: 0, hit10x: 0, hit50x: 0 };
  }

  const wins = trades.filter(t => t.win).length;
  const multipliers = trades.map(t => t.multiplier);
  const pnls = trades.map(t => t.pnlPct);

  const byYear = {};
  const byEra = { 'pre-cutover': { trades: 0, wins: 0 }, 'post-cutover': { trades: 0, wins: 0 } };
  const byType = { CALL: { trades: 0, wins: 0 }, PUT: { trades: 0, wins: 0 } };
  const byReason = {};

  for (const t of trades) {
    const year = t.date.split('-')[0];
    byYear[year] = byYear[year] || { trades: 0, wins: 0, totalPnl: 0 };
    byYear[year].trades++;
    byYear[year].totalPnl += t.pnlPct;
    if (t.win) byYear[year].wins++;

    if (byEra[t.era]) {
      byEra[t.era].trades++;
      if (t.win) byEra[t.era].wins++;
    }

    byType[t.type].trades++;
    if (t.win) byType[t.type].wins++;

    byReason[t.reason] = (byReason[t.reason] || 0) + 1;
  }

  return {
    totalTrades: trades.length,
    wins,
    losses: trades.length - wins,
    winRate: +((wins / trades.length) * 100).toFixed(2),
    avgMultiplier: +(multipliers.reduce((a, b) => a + b, 0) / multipliers.length).toFixed(3),
    maxMultiplier: +Math.max(...multipliers).toFixed(3),
    medianMultiplier: +median(multipliers).toFixed(3),
    avgPnlPct: +(pnls.reduce((a, b) => a + b, 0) / pnls.length).toFixed(2),
    hit2x: trades.filter(t => t.multiplier >= 2).length,
    hit5x: trades.filter(t => t.multiplier >= 5).length,
    hit10x: trades.filter(t => t.multiplier >= 10).length,
    hit50x: trades.filter(t => t.multiplier >= 50).length,
    byYear,
    byEra,
    byType,
    byReason
  };
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

module.exports = { aggregate };
