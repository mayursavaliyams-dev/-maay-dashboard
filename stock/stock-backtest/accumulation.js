/**
 * ACCUMULATION (buy-the-low, average-down, sell-on-recovery) — daily/swing.
 *
 * Your spec: "low to high mapping daily … record in low buy … price high then sell",
 * refined to: buy near the rolling N-day low + below the moving average; if it
 * keeps falling, add tranches (average down); sell the WHOLE stack when price
 * rises a target % above the blended average cost. Cap at max tranches + a
 * per-stock notional cap; no hard stop (the account-level daily-loss / drawdown
 * halts are the backstop).
 *
 * Works on DAILY candles and holds across days (overnight). Charges modeled as
 * DELIVERY (CNC) not intraday — holding overnight means delivery STT (0.1% both
 * sides) which is heavier than intraday, so we never understate cost.
 */

// Delivery (CNC) round-trip charges for a buy turnover + sell turnover.
//   brokerage : ₹0 (most discount brokers: free delivery) — keep small buffer
//   STT       : 0.1% on BOTH buy and sell (delivery)
//   exchange  : ~0.00297% NSE on total turnover
//   SEBI      : 0.0001% on total
//   stamp     : 0.015% on buy
//   GST       : 18% on (brokerage + exchange + SEBI)
//   DP charge : ~₹15 per sell scrip (depository) — flat
function deliveryCharges(buyValue, sellValue) {
  const total = buyValue + sellValue;
  const brokerage = 0;                       // free-delivery assumption
  const stt = (buyValue + sellValue) * 0.001;
  const exch = total * 0.0000297;
  const sebi = total * 0.000001;
  const stamp = buyValue * 0.00015;
  const gst = (brokerage + exch + sebi) * 0.18;
  const dp = 15;
  return +(brokerage + stt + exch + sebi + stamp + gst + dp).toFixed(2);
}

function sma(candles, i, p) {
  const from = Math.max(0, i - p + 1);
  let s = 0, n = 0;
  for (let k = from; k <= i; k++) { s += candles[k].c; n++; }
  return n ? s / n : candles[i].c;
}

function rollingLow(candles, i, p) {
  const from = Math.max(0, i - p + 1);
  let lo = Infinity;
  for (let k = from; k <= i; k++) lo = Math.min(lo, candles[k].l);
  return lo;
}

function cfgFromEnv(overrides = {}) {
  const num = (k, d) => parseFloat(process.env[k] || d);
  return {
    capital:        num('CAPITAL_TOTAL', 100000),
    nDays:          parseInt(process.env.ACC_LOOKBACK_DAYS || 10),   // rolling window
    avgPeriod:      parseInt(process.env.ACC_AVG_PERIOD || 20),      // SMA period
    nearLowPct:     num('ACC_NEAR_LOW_PCT', 1.0) / 100,             // within X% of N-day low
    addStepPct:     num('ACC_ADD_STEP_PCT', 2.0) / 100,            // add a tranche each -X%
    maxTranches:    parseInt(process.env.ACC_MAX_TRANCHES || 4),
    targetPct:      num('ACC_TARGET_PCT', 3.0) / 100,             // sell at +X% over avg cost
    trancheRiskPct: num('ACC_TRANCHE_PCT', 5.0) / 100,           // capital % per tranche
    maxPositionPct: num('MAX_POSITION_PCT', 25) / 100,
    slipPct:        num('SLIPPAGE_PERCENT', 0.1) / 100,
    profitReinvest: num('PROFIT_REINVEST_PCT', 0.5),
    maxHoldDays:    parseInt(process.env.ACC_MAX_HOLD_DAYS || 30), // give up after N days
    // Risk controls (added to fix the catastrophic-loser problem):
    // disasterStopPct: abandon the whole position if it falls this % below the
    //   FIRST entry price. 0 = off. Caps the few huge losers that sank net P&L.
    disasterStopPct: num('ACC_DISASTER_STOP_PCT', 0) / 100,
    // trendFilter: only enter when price is above its trendPeriod SMA (don't
    //   buy dips in a downtrend — falling knives). false = off.
    trendFilter:    (process.env.ACC_TREND_FILTER || 'false').toLowerCase() === 'true',
    trendPeriod:    parseInt(process.env.ACC_TREND_PERIOD || 200),
    ...overrides
  };
}

// Simulate ONE symbol's daily series. Returns array of closed trades.
function simulateSymbol(candles, cfg, startEquity) {
  const warmup = cfg.trendFilter ? Math.max(cfg.avgPeriod, cfg.trendPeriod) : cfg.avgPeriod;
  if (!candles || candles.length < warmup + 2) return [];
  const trades = [];
  let pos = null;     // { tranches:[{px,qty}], qty, cost, avg, openIdx, firstPx }
  let equity = startEquity;

  for (let i = warmup; i < candles.length; i++) {
    const c = candles[i];
    const price = c.c;
    const nLow = rollingLow(candles, i - 1, cfg.nDays);   // low as of yesterday (no look-ahead on today's low)
    const avg = sma(candles, i, cfg.avgPeriod);

    if (!pos) {
      // ENTRY: price near the N-day low AND below the moving average.
      // Optional uptrend filter: skip if price is below its long SMA (downtrend).
      const nearLow = price <= nLow * (1 + cfg.nearLowPct);
      const belowAvg = price < avg;
      const trendOk = !cfg.trendFilter || price > sma(candles, i, cfg.trendPeriod);
      if (nearLow && belowAvg && trendOk) {
        pos = { tranches: [], qty: 0, cost: 0, avg: 0, openIdx: i, lastAddPx: price, firstPx: price };
        addTranche(pos, price, cfg, equity);
      }
      continue;
    }

    // MANAGE open position.
    // Disaster stop: bail the whole stack if price falls disasterStopPct below
    // the FIRST entry. Checked before averaging so we don't add into a collapse.
    const stopHit = cfg.disasterStopPct > 0 && c.l <= pos.firstPx * (1 - cfg.disasterStopPct);

    // 1) Average down (only if not stopping out this bar): price fell addStepPct
    //    below the last add, room for more tranches.
    if (!stopHit && pos.tranches.length < cfg.maxTranches && price <= pos.lastAddPx * (1 - cfg.addStepPct)) {
      const notional = pos.cost;
      if (notional < equity * cfg.maxPositionPct) {
        addTranche(pos, price, cfg, equity);
        pos.lastAddPx = price;
      }
    }

    // 2) Exit: target recovery, disaster stop, or max hold.
    const target = pos.avg * (1 + cfg.targetPct);
    const hitTarget = c.h >= target;
    const tooLong = (i - pos.openIdx) >= cfg.maxHoldDays;

    if (hitTarget || stopHit || tooLong) {
      const stopPx = pos.firstPx * (1 - cfg.disasterStopPct);
      const rawExit = hitTarget ? target : (stopHit ? stopPx : price);
      const exit = rawExit * (1 - cfg.slipPct);          // sell slippage
      const sellValue = exit * pos.qty;
      const charges = deliveryCharges(pos.cost, sellValue);
      const grossPnl = sellValue - pos.cost;
      const netPnl = grossPnl - charges;
      trades.push({
        symbol: cfg._sym, openDate: dayStr(candles[pos.openIdx].t), exitDate: dayStr(c.t),
        tranches: pos.tranches.length, qty: pos.qty,
        avgCost: +pos.avg.toFixed(2), exitPrice: +exit.toFixed(2),
        deployed: +pos.cost.toFixed(2), holdDays: i - pos.openIdx,
        reason: hitTarget ? 'TARGET' : (stopHit ? 'DISASTER_STOP' : 'MAX_HOLD'),
        grossPnl: +grossPnl.toFixed(2), charges, netPnl: +netPnl.toFixed(2),
        pnlPct: +((netPnl / pos.cost) * 100).toFixed(2)
      });
      // Half-compound into equity for next position sizing.
      equity += netPnl > 0 ? netPnl * cfg.profitReinvest : netPnl;
      pos = null;
    }
  }
  return trades;
}

function addTranche(pos, price, cfg, equity) {
  const fill = price * (1 + cfg.slipPct);                // buy slippage
  const budget = equity * cfg.trancheRiskPct;
  const qty = Math.max(1, Math.floor(budget / fill));
  pos.tranches.push({ px: fill, qty });
  pos.qty += qty;
  pos.cost += fill * qty;
  pos.avg = pos.cost / pos.qty;
}

function dayStr(t) { return new Date(t).toISOString().slice(0, 10); }

/**
 * Run the accumulation backtest across symbols over a daily date range.
 * Each symbol sized off a shared starting equity (independent books, summed).
 */
async function runAccumulation({ dataSource, symbols, fromDate, toDate, cfg }) {
  cfg = cfg || cfgFromEnv();
  const allTrades = [];
  let totalNet = 0, totalCharges = 0;
  const perSymbol = {};

  for (const sym of symbols) {
    let candles;
    try { candles = await dataSource.getDailyCandles(sym, fromDate, toDate); }
    catch (e) { console.warn(`[${sym}] daily fetch failed: ${e.message}`); continue; }
    if (!candles?.length) continue;
    const symCfg = { ...cfg, _sym: sym };
    const trades = simulateSymbol(candles, symCfg, cfg.capital);
    const net = trades.reduce((a, t) => a + t.netPnl, 0);
    perSymbol[sym] = {
      trades: trades.length,
      wins: trades.filter(t => t.netPnl > 0).length,
      net: +net.toFixed(0),
      source: candles[0]?.source
    };
    totalNet += net;
    totalCharges += trades.reduce((a, t) => a + t.charges, 0);
    allTrades.push(...trades);
  }

  const wins = allTrades.filter(t => t.netPnl > 0).length;
  return {
    cfg, fromDate, toDate, symbols,
    trades: allTrades,
    metrics: {
      totalTrades: allTrades.length, wins, losses: allTrades.length - wins,
      winRate: allTrades.length ? +(wins / allTrades.length * 100).toFixed(1) : 0,
      netPnl: +totalNet.toFixed(0),
      totalCharges: +totalCharges.toFixed(0),
      avgHoldDays: allTrades.length ? +(allTrades.reduce((a, t) => a + t.holdDays, 0) / allTrades.length).toFixed(1) : 0,
      perSymbol
    }
  };
}

module.exports = { runAccumulation, simulateSymbol, cfgFromEnv, deliveryCharges };
