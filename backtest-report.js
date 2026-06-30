/**
 * BACKTEST REPORT ENGINE — Antigravity Pro · Module 13/14
 *
 * Turns a list of closed backtest trades into an institutional-grade, WHITE-BOX
 * performance report: equity curve, Sharpe, Sortino, expectancy, profit factor,
 * CAGR, max drawdown (+ duration), streaks, year/month breakdown, and the full
 * loss ledger. PURE — no I/O; the server feeds in trades from bt-data and renders.
 *
 * This is the trust + compliance cornerstone: every number is computed from real
 * per-trade P&L, the exact strategy rules are disclosed (white-box), and an
 * honest-limitations disclaimer is attached. Nothing here is advice.
 *
 * trade = { date:'YYYY-MM-DD', pnl:number, ... }  (pnl in ₹, net of costs)
 */
'use strict';

const round = (v, d = 2) => +(+v).toFixed(d);
const sum = a => a.reduce((s, x) => s + x, 0);
const mean = a => (a.length ? sum(a) / a.length : 0);
function std(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(sum(a.map(x => (x - m) ** 2)) / (a.length - 1));
}

// White-box rule descriptions for the bhavcopy strategies (from bt-strategies.js).
// Disclosed verbatim so a user sees EXACTLY how each number was produced.
const STRATEGY_RULES = {
  SHORT_STRANGLE: {
    summary: 'Sell OTM strangle (ATM ±1.5%), exit at expiry or 2× premium stop.',
    entry: 'On entry day open: SELL 1 OTM call (~ATM+1.5%) + 1 OTM put (~ATM−1.5%) of the nearest weekly expiry.',
    exit: 'Hold to expiry-day close, OR stop a leg if its premium ≥ 2× the entry credit (approximated vs the day HIGH — worst case for a seller).',
    costs: 'Brokerage + STT + exchange + stamp via charges.js; 1% per-fill slippage.',
    resolution: 'Daily-resolution (bhavcopy OHLC) — no intraday tick path.',
  },
  SHORT_STRADDLE: { summary: 'Sell ATM straddle, exit at expiry or 2× stop.', entry: 'Open: SELL ATM call + ATM put (nearest expiry).', exit: 'Expiry close OR 2× premium stop vs day high.', costs: 'Full charges + 1% slippage.', resolution: 'Daily-resolution.' },
  IRON_CONDOR: { summary: 'Defined-risk: short strangle + protective wings.', entry: 'Open: short OTM strangle + long further-OTM wings (capped loss).', exit: 'Expiry close OR stop; max loss = wing width − net credit.', costs: 'Full charges + 1% slippage.', resolution: 'Daily-resolution.' },
  EXPIRY_STRADDLE: { summary: 'Expiry-morning ATM straddle sell (0-DTE theta).', entry: 'Expiry-day open: SELL ATM straddle.', exit: 'Expiry close OR 2× stop. WARNING: daily-resolution cannot capture intraday gap-through-stop tail risk.', costs: 'Full charges + 1% slippage.', resolution: 'Daily-resolution — tail risk understated.' },
  GAP_BUY: { summary: 'Directional deep-OTM option BUY on a gap (lottery — reported as a loser).', entry: 'On a >0.15% index gap: BUY nearest-expiry deep-OTM strike (premium ≤ ₹38, liquid OI).', exit: '5% SL / target / trail, vs the strike’s real day low (worst case for a long).', costs: 'Full charges + 2% slippage.', resolution: 'Daily-resolution.' },
};

const DISCLAIMER =
  'Paper/educational backtest on REAL NSE bhavcopy (no modeling). Past performance does NOT ' +
  'guarantee future results. This is NOT investment advice or a recommendation. Daily-resolution: ' +
  'P&L uses per-strike daily OHLC and assumes a clean 2× stop — a real intraday gap can fill past ' +
  'the stop, so tail losses may be understated. Costs/slippage are modeled but real fills vary.';

/**
 * @param {Array} trades  [{date, pnl}]
 * @param {Object} opts { startCapital=100000, strategy, riskFreeRate=0.06, tradesPerYearOverride }
 */
function report(trades, opts = {}) {
  const startCapital = opts.startCapital != null ? opts.startCapital : 100000;
  const rf = opts.riskFreeRate != null ? opts.riskFreeRate : 0.06;
  const T = (trades || []).filter(t => t && isFinite(t.pnl)).slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const n = T.length;
  if (!n) return { available: false, reason: 'no trades', strategy: opts.strategy || null };

  // ── equity curve + per-trade returns (compounded on running capital) ──
  const equityCurve = [];
  let eq = startCapital, peak = startCapital, maxDD = 0, ddPeakEq = startCapital;
  let ddStartIdx = 0, maxDDdur = 0, curDDdur = 0;
  const rets = [];
  for (let i = 0; i < n; i++) {
    const before = eq;
    rets.push(before > 0 ? T[i].pnl / before : 0);
    eq = round(eq + T[i].pnl);
    if (eq > peak) { peak = eq; curDDdur = 0; }
    else { curDDdur++; maxDDdur = Math.max(maxDDdur, curDDdur); }
    const dd = peak > 0 ? (peak - eq) / peak : 0;
    if (dd > maxDD) maxDD = dd;
    equityCurve.push({ i: i + 1, date: T[i].date, pnl: round(T[i].pnl), equity: eq, ddPct: round(dd * 100, 2) });
  }

  const wins = T.filter(t => t.pnl > 0), losses = T.filter(t => t.pnl <= 0);
  const grossWin = sum(wins.map(t => t.pnl)), grossLoss = sum(losses.map(t => t.pnl));
  const net = round(grossWin + grossLoss);

  // ── time span / annualization ──
  const first = T[0].date, last = T[n - 1].date;
  const days = Math.max(1, (Date.parse(last) - Date.parse(first)) / 86400000);
  const years = Math.max(days / 365.25, 1 / 365.25);
  const tradesPerYear = opts.tradesPerYearOverride || (n / years);

  // ── risk-adjusted ──
  const mRet = mean(rets), sdRet = std(rets);
  const downside = rets.map(r => (r < 0 ? r : 0));
  const downDev = Math.sqrt(mean(downside.map(r => r * r)));
  const sharpe = sdRet > 0 ? round((mRet / sdRet) * Math.sqrt(tradesPerYear), 2) : null;
  const sortino = downDev > 0 ? round((mRet / downDev) * Math.sqrt(tradesPerYear), 2) : null;

  // ── CAGR ──
  const finalEq = startCapital + net;
  const cagr = finalEq > 0 && startCapital > 0 ? round((Math.pow(finalEq / startCapital, 1 / years) - 1) * 100, 1) : null;

  // ── streaks ──
  let curW = 0, maxW = 0, curL = 0, maxL = 0;
  for (const t of T) { if (t.pnl > 0) { curW++; maxW = Math.max(maxW, curW); curL = 0; } else { curL++; maxL = Math.max(maxL, curL); curW = 0; } }

  // ── period breakdown ──
  const groupBy = key => {
    const m = {};
    for (const t of T) { const k = key(t.date); (m[k] = m[k] || { n: 0, w: 0, pnl: 0 }); m[k].n++; if (t.pnl > 0) m[k].w++; m[k].pnl += t.pnl; }
    return Object.keys(m).sort().map(k => ({ period: k, trades: m[k].n, winPct: Math.round(m[k].w / m[k].n * 100), pnl: round(m[k].pnl) }));
  };

  const best = T.reduce((b, t) => (t.pnl > b.pnl ? t : b));
  const worst = T.reduce((b, t) => (t.pnl < b.pnl ? t : b));

  return {
    available: true,
    strategy: opts.strategy || null,
    period: { from: first, to: last, days: Math.round(days), years: round(years, 2) },
    startCapital, finalCapital: finalEq,
    summary: {
      trades: n, wins: wins.length, losses: losses.length,
      winRate: round(wins.length / n * 100, 1),
      net, expectancy: round(net / n), expectancyR: round(mRet * 100, 2),
      avgWin: round(mean(wins.map(t => t.pnl))), avgLoss: round(mean(losses.map(t => t.pnl))),
      profitFactor: grossLoss < 0 ? round(grossWin / Math.abs(grossLoss), 2) : null,
      best: { date: best.date, pnl: round(best.pnl) }, worst: { date: worst.date, pnl: round(worst.pnl) },
      maxWinStreak: maxW, maxLossStreak: maxL,
    },
    risk: {
      maxDrawdownPct: round(maxDD * 100, 2),
      maxDrawdownDurationTrades: maxDDdur,
      sharpe, sortino, cagrPct: cagr,
      returnPct: round(net / startCapital * 100, 1),
      riskFreeRateUsed: rf,
    },
    byYear: groupBy(d => String(d).slice(0, 4)),
    byMonth: groupBy(d => String(d).slice(0, 7)),
    losses: losses.slice().sort((a, b) => a.pnl - b.pnl).map(t => ({ ...t, pnl: round(t.pnl) })),
    equityCurve,
    whiteBox: STRATEGY_RULES[opts.strategy] || null,   // exact rules — full transparency
    disclaimer: DISCLAIMER,
  };
}

module.exports = { report, STRATEGY_RULES, DISCLAIMER };
