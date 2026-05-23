/**
 * STOCK BACKTEST ENGINE — replays 1-min candles and trades ORB with the SAME
 * SL/target/trail/slippage/charges semantics as the live stock-engine.js.
 *
 * Guarantees from the master prompt:
 *  - NO look-ahead: each decision uses only data available at that candle.
 *  - Slippage parity: same SLIPPAGE_PERCENT applied to entry AND exit fills.
 *  - All charges included: net P&L, not gross (via stock-engine.intradayCharges).
 *  - Same square-off at SQUARE_OFF_TIME, same entry window, same max-trades/day.
 *  - Compounding: equity carries across days; PROFIT_REINVEST_PCT half-compound.
 *
 * One trade/symbol/day max (matches live "_enteredToday"); MAX_TRADES_PER_DAY
 * caps across the whole watchlist per day.
 */

const { minutesIntoSession } = require('./strategy-orb');
const { getStrategy } = require('./strategies');
const { intradayCharges } = require('../stock-engine');

function parseHHMM(str, def) {
  if (!str || !/^\d{1,2}:\d{2}$/.test(str)) return def;
  const [h, m] = str.split(':').map(Number); return h * 60 + m;
}

// Simulate ONE symbol on ONE day's candles. Returns a closed-trade object or null.
function simulateDay(candles, cfg) {
  if (!candles || candles.length < 5) return null;
  const strategy = cfg._strategy || getStrategy(cfg.strategy);

  const entryStart = parseHHMM(cfg.entryStart, 9 * 60 + 31);
  const entryEnd   = parseHHMM(cfg.entryEnd,   14 * 60 + 30);
  const squareOff  = parseHHMM(cfg.squareOff,  15 * 60 + 15);

  let pos = null;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const mins = minutesIntoSession(c.t);

    // ── Manage an open position bar-by-bar ──
    if (pos) {
      const long = pos.side === 'LONG';
      // Square-off forces exit at this bar's close.
      if (mins >= squareOff) return closeTrade(pos, c.c, 'EOD_SQUAREOFF', cfg);

      // Track peak in the favorable direction (use the bar extreme reachable).
      const favExtreme = long ? c.h : c.l;
      if (long  && favExtreme > pos.peakPrice) pos.peakPrice = favExtreme;
      if (!long && favExtreme < pos.peakPrice) pos.peakPrice = favExtreme;

      // Trail activation + lock (same math as live engine).
      const favMove = long
        ? (pos.peakPrice - pos.entryPrice) / pos.entryPrice
        : (pos.entryPrice - pos.peakPrice) / pos.entryPrice;
      if (!pos.trailActive && favMove >= cfg.trailAfterPct) pos.trailActive = true;
      if (pos.trailActive) {
        const lockedGain = Math.abs(pos.peakPrice - pos.entryPrice) * cfg.trailLockPct;
        const newStop = long ? pos.entryPrice + lockedGain : pos.entryPrice - lockedGain;
        pos.lockedStop = pos.lockedStop == null ? newStop
          : (long ? Math.max(pos.lockedStop, newStop) : Math.min(pos.lockedStop, newStop));
      }

      // Intrabar exit priority. We can't see tick order within the bar, so use a
      // conservative rule: if BOTH stop and target are touched in the same bar,
      // assume the STOP filled first (pessimistic — never overstates the edge).
      const tgtHit = long ? c.h >= pos.target : c.l <= pos.target;
      const slPrice = long
        ? Math.max(pos.sl, pos.lockedStop ?? -Infinity)
        : Math.min(pos.sl, pos.lockedStop ??  Infinity);
      const slHit = long ? c.l <= slPrice : c.h >= slPrice;

      if (slHit && tgtHit) return closeTrade(pos, slPrice, pos.trailActive ? 'TRAIL_STOP' : 'STOP_LOSS', cfg);
      if (slHit)  return closeTrade(pos, slPrice, pos.trailActive ? 'TRAIL_STOP' : 'STOP_LOSS', cfg);
      if (tgtHit) return closeTrade(pos, pos.target, 'TARGET', cfg);
      continue;
    }

    // ── Look for an entry ──
    if (mins < entryStart || mins > entryEnd) continue;
    const { signal, reason } = strategy.signalAt(candles, i, cfg);
    if (signal !== 'BUY' && signal !== 'SELL') continue;

    pos = openTrade(signal, c.c, reason, cfg, c.t);
    if (!pos) { /* sized to 0 — skip the day */ return null; }
  }

  // Held to close with no exit trigger → square off at last candle.
  if (pos) return closeTrade(pos, candles[candles.length - 1].c, 'EOD_SQUAREOFF', cfg);
  return null;
}

function openTrade(signal, ltp, reason, cfg, ts) {
  const dir = signal === 'BUY' ? 1 : -1;
  const filledEntry = ltp * (1 + dir * cfg.slipPct);
  const sl     = signal === 'BUY' ? filledEntry * (1 - cfg.slPct) : filledEntry * (1 + cfg.slPct);
  const target = signal === 'BUY' ? filledEntry * (1 + cfg.targetPct) : filledEntry * (1 - cfg.targetPct);
  const riskPerShare = Math.abs(filledEntry - sl);
  if (riskPerShare <= 0) return null;

  const riskRs = cfg.capital * cfg.riskPct;
  let qty = Math.floor(riskRs / riskPerShare);
  const maxByNotional = Math.floor((cfg.capital * cfg.maxPositionPct) / filledEntry);
  if (qty > maxByNotional) qty = maxByNotional;
  if (qty < 1) return null;

  return {
    side: signal === 'BUY' ? 'LONG' : 'SHORT',
    entryPrice: filledEntry, qty, sl, target,
    peakPrice: filledEntry, trailActive: false, lockedStop: null,
    deployed: qty * filledEntry, reason, enteredAt: ts
  };
}

function closeTrade(pos, rawExit, reason, cfg) {
  const long = pos.side === 'LONG';
  const exitPrice = rawExit * (1 + (long ? -1 : 1) * cfg.slipPct);
  const grossPnl = (long ? (exitPrice - pos.entryPrice) : (pos.entryPrice - exitPrice)) * pos.qty;
  const charges  = intradayCharges(pos.entryPrice, exitPrice, pos.qty);
  const netPnl   = grossPnl - charges;
  return {
    side: pos.side, qty: pos.qty,
    entryPrice: +pos.entryPrice.toFixed(2), exitPrice: +exitPrice.toFixed(2),
    deployed: +pos.deployed.toFixed(2), reason,
    grossPnl: +grossPnl.toFixed(2), charges: +charges.toFixed(2),
    netPnl: +netPnl.toFixed(2),
    pnlPct: +((netPnl / pos.deployed) * 100).toFixed(2),
    entryReason: pos.reason
  };
}

// Resolve a config object from process.env (so backtest == live params by default).
function cfgFromEnv(overrides = {}) {
  const num = (k, d) => parseFloat(process.env[k] || d);
  return {
    capital:        num('CAPITAL_TOTAL', 100000),
    riskPct:        num('RISK_PER_TRADE_PCT', 2) / 100,
    maxPositionPct: num('MAX_POSITION_PCT', 25) / 100,
    slPct:          num('STOP_LOSS_PERCENT', 1) / 100,
    targetPct:      num('TARGET_PERCENT', 2) / 100,
    trailAfterPct:  num('TRAIL_AFTER_PERCENT', 1) / 100,
    trailLockPct:   num('TRAIL_LOCK_PERCENT', 60) / 100,
    slipPct:        num('SLIPPAGE_PERCENT', 0.1) / 100,
    profitReinvest: num('PROFIT_REINVEST_PCT', 0.5),
    strategy: (process.env.STRATEGY || 'orb').toLowerCase(),
    orbRangeMinutes: parseInt(process.env.ORB_RANGE_MINUTES || 15),
    volumeConfirmMult: num('VOLUME_CONFIRM_MULT', 1.4),
    // EMA pullback
    emaFast: parseInt(process.env.EMA_FAST || 9),
    emaSlow: parseInt(process.env.EMA_SLOW || 21),
    emaPullbackPct: num('EMA_PULLBACK_PCT', 0.3),
    emaPullbackLookback: parseInt(process.env.EMA_PULLBACK_LOOKBACK || 5),
    // VWAP reversion
    vwapDevPct: num('VWAP_DEV_PCT', 0.6),
    vwapDevAtr: num('VWAP_DEV_ATR', 1.5),
    // Gap-and-go
    gapPct: num('GAP_PCT', 0.4),
    gapMaxEntryMin: parseInt(process.env.GAP_MAX_ENTRY_MIN || 60),
    entryStart: process.env.ENTRY_WINDOW_START || '09:31',
    entryEnd:   process.env.ENTRY_WINDOW_END   || '14:30',
    squareOff:  process.env.SQUARE_OFF_TIME    || '15:15',
    maxTradesPerDay: parseInt(process.env.MAX_TRADES_PER_DAY || 3),
    ...overrides
  };
}

/**
 * Run a full backtest across symbols × dates with compounding equity.
 * dataSource.getCandles(symbol, date) → candles[]. Returns { trades, equityCurve, cfg }.
 */
async function runBacktest({ dataSource, symbols, dates, cfg }) {
  cfg = cfg || cfgFromEnv();
  const trades = [];
  const equityCurve = [];
  let equity = cfg.capital, reserve = 0;

  for (const date of dates) {
    let tradesThisDay = 0;
    let dayPnl = 0;
    for (const sym of symbols) {
      if (tradesThisDay >= cfg.maxTradesPerDay) break;
      let candles;
      try { candles = await dataSource.getCandles(sym, date); }
      catch (_) { continue; }                       // missing day (holiday) → skip
      if (!candles?.length) continue;

      // Size off the CURRENT compounded equity (active capital only).
      const dayCfg = { ...cfg, capital: equity };
      const t = simulateDay(candles, dayCfg);
      if (!t) continue;

      // Half-compound: profit splits into active vs reserve; loss hits active.
      if (t.netPnl > 0) {
        const toReserve = t.netPnl * (1 - cfg.profitReinvest);
        equity += t.netPnl - toReserve; reserve += toReserve;
      } else {
        equity += t.netPnl;
      }
      tradesThisDay++; dayPnl += t.netPnl;
      trades.push({ symbol: sym, date, ...t, equityAfter: +equity.toFixed(0), reserveAfter: +reserve.toFixed(0) });
    }
    equityCurve.push({ date, equity: +equity.toFixed(0), reserve: +reserve.toFixed(0), total: +(equity + reserve).toFixed(0), dayPnl: +dayPnl.toFixed(0) });
  }

  return { trades, equityCurve, cfg, finalEquity: +equity.toFixed(0), finalReserve: +reserve.toFixed(0) };
}

module.exports = { simulateDay, runBacktest, cfgFromEnv, openTrade, closeTrade };
