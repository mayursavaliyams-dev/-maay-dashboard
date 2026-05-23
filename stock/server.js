/**
 * ANTIGRAVITY STOCK BOT — SERVER
 * Cash-equity sibling of the options bot's server.js. Same architecture:
 *   - Per-instrument ExecutionEngine + state, auto-start bot loop, disk persistence
 *   - Risk endpoints, halt/reset, paper/live mode, EOD summary, confirm-modal API
 * Stock differences: a watchlist of equity symbols (not SENSEX/NIFTY indices),
 * ORB breakout signal computed per symbol, qty sizing by SL distance, charges netted.
 *
 * Runs on PORT (default 3100) so it can run alongside the options bot (3000).
 */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');

const StockExecutionEngine = require('./stock-engine');
const EquityConnector      = require('./equity-connector');
const { getStrategy, listStrategies } = require('./stock-backtest/strategies');
const { cfgFromEnv }       = require('./stock-backtest/engine');
const TelegramAlerter      = require('./telegram');
const tokenMonitor         = require('./token-monitor');

const STRATEGY = (process.env.STRATEGY || 'orb').toLowerCase();
const strategy = getStrategy(STRATEGY);
const stratCfg = cfgFromEnv();   // strategy params shared with backtest
const telegram = new TelegramAlerter();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = parseInt(process.env.PORT || 3100);
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const ORB_RANGE_MINUTES = parseInt(process.env.ORB_RANGE_MINUTES || 15);
const VOLUME_CONFIRM_MULT = parseFloat(process.env.VOLUME_CONFIRM_MULT || 1.4);

// Auto-start the loop on boot unless BOT_AUTOSTART=false.
let botRunning = String(process.env.BOT_AUTOSTART ?? 'true').toLowerCase() !== 'false';

const DATA_DIR = path.resolve('./data');
fs.mkdirSync(DATA_DIR, { recursive: true });

function istNow() { return new Date(Date.now() + IST_OFFSET_MS); }
function istMins(d) { return d.getUTCHours() * 60 + d.getUTCMinutes(); }
function istDateStr() { return istNow().toISOString().slice(0, 10); }

// ==================== WATCHLIST & PER-SYMBOL STATE ====================
const WATCHLIST = (process.env.WATCHLIST || 'RELIANCE,HDFCBANK,INFY,TCS,ICICIBANK')
  .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

const live = new EquityConnector();

// state[sym] = { price, open, high, low, vwap, orbHigh, orbLow, orbDone,
//   prices[], vols[], cumPV, cumV, signal, lastSignalReason,
//   openPosition, closedPositions[], tradesToday }
const state = {};
for (const sym of WATCHLIST) {
  state[sym] = {
    price: 0, open: 0, dayHigh: 0, dayLow: 0,
    vwap: 0, orbHigh: null, orbLow: null, orbDone: false,
    prices: [], vols: [], cumPV: 0, cumV: 0,
    lastVol: 0, avgVol: 0,
    candles: [], curMinute: null,   // rolling 1-min candle buffer for strategy parity
    signal: 'WAIT', signalReason: '',
    openPosition: null, closedPositions: [], tradesToday: 0
  };
}

// ==================== STATE PERSISTENCE ====================
// market-state.json holds today's ORB + day H/L so a mid-session restart
// doesn't wipe the opening range. Restored only if the date matches today.
const STATE_FILE = path.join(DATA_DIR, 'stock-market-state.json');
let _stateWriteTimer = null;
function persistMarketState() {
  if (_stateWriteTimer) return;            // debounce: at most one write / 2s
  _stateWriteTimer = setTimeout(() => {
    _stateWriteTimer = null;
    const out = { date: istDateStr(), symbols: {} };
    for (const sym of WATCHLIST) {
      const s = state[sym];
      out.symbols[sym] = { orbHigh: s.orbHigh, orbLow: s.orbLow, orbDone: s.orbDone, dayHigh: s.dayHigh, dayLow: s.dayLow };
    }
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(out, null, 2)); } catch (_) {}
  }, 2000);
}
function restoreMarketState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (s.date !== istDateStr()) return;   // stale (yesterday) — let it rebuild
    for (const sym of WATCHLIST) {
      const r = s.symbols?.[sym];
      if (!r) continue;
      Object.assign(state[sym], { orbHigh: r.orbHigh, orbLow: r.orbLow, orbDone: !!r.orbDone, dayHigh: r.dayHigh || 0, dayLow: r.dayLow || 0 });
    }
    console.log(`[state] restored ORB/H-L for ${istDateStr()}`);
  } catch (e) { console.warn('[state] restore failed:', e.message); }
}

// New trading day → reset per-symbol intraday state.
let _todayStr = '';
function resetDailyIfNeeded() {
  const d = istDateStr();
  if (d === _todayStr) return;
  _todayStr = d;
  for (const sym of WATCHLIST) {
    Object.assign(state[sym], {
      open: 0, dayHigh: 0, dayLow: 0, vwap: 0,
      orbHigh: null, orbLow: null, orbDone: false,
      prices: [], vols: [], cumPV: 0, cumV: 0,
      candles: [], curMinute: null,
      signal: 'WAIT', signalReason: '', tradesToday: 0
    });
  }
  console.log(`[state] new trading day ${d} — intraday state reset`);
}

// ==================== ENGINES (one per symbol) ====================
const engines = {};
for (const sym of WATCHLIST) {
  const eng = new StockExecutionEngine({
    live,
    getSignal:          () => state[sym].signal,
    getPrice:           () => state[sym].price,
    getOrbLevels:       () => ({ high: state[sym].orbHigh, low: state[sym].orbLow }),
    getVwap:            () => state[sym].vwap,
    getVolume:          () => ({ last: state[sym].lastVol, avg: state[sym].avgVol }),
    getOpenPosition:    () => state[sym].openPosition,
    setOpenPosition:    (p) => {
      const wasOpen = !!state[sym].openPosition;
      state[sym].openPosition = p;
      if (p && !wasOpen) telegram.sendEntry(p);          // alert on new entry
    },
    pushClosedPosition: (p) => { state[sym].closedPositions.push(p); telegram.sendExit(p); },
    incrementTrades:    () => { state[sym].tradesToday++; },
    getTradesToday:     () => state[sym].tradesToday,
    getMaxTrades:       () => parseInt(process.env.MAX_TRADES_PER_DAY || 3),
    symbol:             sym,
    securityId:         live.resolveId(sym),
    exchangeSegment:    'NSE_EQ'
  });
  eng._getDailyPnl = () => {
    const todayStr = new Date().toDateString();
    return state[sym].closedPositions
      .filter(p => new Date(p.exitAt).toDateString() === todayStr)
      .reduce((acc, p) => acc + parseFloat(p.finalPnlAbs || 0), 0);
  };
  eng.restoreEquity();
  engines[sym] = eng;
}

// ==================== SIGNAL (selectable strategy) ====================
// Aggregate ticks into a rolling 1-min candle buffer, then run the SELECTED
// strategy's signalAt() — the exact same function the backtest uses, so live
// and backtest behave identically. STRATEGY env picks: orb | ema-pullback |
// vwap-reversion | gap-and-go.
function pushTickToCandle(sym, q) {
  const s = state[sym];
  const minuteKey = Math.floor((q.timestamp ? new Date(q.timestamp).getTime() : Date.now()) / 60000);
  if (s.curMinute !== minuteKey) {
    // Start a new 1-min candle.
    s.candles.push({ t: minuteKey * 60000, o: q.price, h: q.price, l: q.price, c: q.price, v: q.volume || 0 });
    s.curMinute = minuteKey;
    if (s.candles.length > 500) s.candles.shift();
  } else {
    const c = s.candles[s.candles.length - 1];
    c.h = Math.max(c.h, q.price); c.l = Math.min(c.l, q.price);
    c.c = q.price; c.v += q.volume || 0;
  }
}

function updateSignal(sym) {
  const s = state[sym];
  if (s.candles.length < 2) { s.signal = 'WAIT'; s.signalReason = 'warming up'; return; }
  // Keep ORB levels live for the dashboard, regardless of active strategy.
  const orbEnd = (9 * 60 + 15) + ORB_RANGE_MINUTES;
  const mins = istMins(istNow());
  if (mins < orbEnd) {
    if (s.orbHigh == null || s.price > s.orbHigh) s.orbHigh = s.price;
    if (s.orbLow == null || s.price < s.orbLow) s.orbLow = s.price;
  } else if (!s.orbDone && s.orbHigh != null) {
    s.orbDone = true;
  }
  try {
    const out = strategy.signalAt(s.candles, s.candles.length - 1, stratCfg);
    s.signal = out.signal;
    s.signalReason = out.reason;
  } catch (e) {
    s.signal = 'WAIT'; s.signalReason = 'strategy error: ' + e.message;
  }
}

// ==================== PRICE POLL ====================
// Pulls a fresh quote per symbol, updates day H/L, VWAP, rolling volume avg,
// then recomputes the ORB signal. Runs every 5s (paper sim) / shares Dhan cache.
async function pollPrices() {
  for (const sym of WATCHLIST) {
    try {
      const q = state[sym].pendingQuote || await live.getQuote(sym);
      const s = state[sym];
      s.price = q.price;
      if (!s.open) s.open = q.open || q.price;
      s.dayHigh = s.dayHigh ? Math.max(s.dayHigh, q.price) : q.price;
      s.dayLow  = s.dayLow ? Math.min(s.dayLow, q.price) : q.price;
      s.lastVol = q.volume || 0;

      s.prices.push(q.price);
      s.vols.push(q.volume || 0);
      if (s.prices.length > 500) { s.prices.shift(); s.vols.shift(); }

      // VWAP (cumulative price×vol / cumulative vol). Falls back to mean price.
      if (q.volume > 0) { s.cumPV += q.price * q.volume; s.cumV += q.volume; }
      s.vwap = s.cumV > 0 ? +(s.cumPV / s.cumV).toFixed(2) : q.price;

      // Rolling average volume over the last 20 samples (for breakout confirm).
      const recent = s.vols.slice(-20).filter(v => v > 0);
      s.avgVol = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;

      s.source = q.source;
      pushTickToCandle(sym, q);
      updateSignal(sym);
    } catch (err) {
      // Stale/missing data → never fabricate; just leave last-known and log.
      if (!state[sym]._lastErrAt || Date.now() - state[sym]._lastErrAt > 30000) {
        console.warn(`[${sym}] quote failed: ${err.message}`);
        state[sym]._lastErrAt = Date.now();
      }
    }
  }
  persistMarketState();
}

// ==================== BOT LOOP ====================
// Watch each engine's halt reason and alert once on transition into a halt.
const _lastHalt = {};
function checkHaltTransitions() {
  for (const sym of WATCHLIST) {
    const r = engines[sym]._haltedReason;
    if (r && r !== _lastHalt[sym]) {
      console.warn(`[${sym}] halt → ${r}`);
      telegram.sendHalt(sym, r);
    }
    _lastHalt[sym] = r;
  }
}

function runBotLoop() {
  resetDailyIfNeeded();
  if (!live.isMarketOpen() && (process.env.PAPER_FORCE_OPEN ?? 'false') !== 'true') return;
  pollPrices().then(() => {
    if (!botRunning) return;
    let i = 0;
    for (const sym of WATCHLIST) {
      // Stagger engine ticks to avoid simultaneous broker calls.
      setTimeout(() => engines[sym].tick().catch(e => console.error(`[${sym}] tick error:`, e.message)), i * 300);
      i++;
    }
    setTimeout(checkHaltTransitions, WATCHLIST.length * 300 + 200);
  });
}
setInterval(runBotLoop, 5000);

// ==================== ROUTES ====================
function engineFor(sym) { return engines[(sym || '').toUpperCase()]; }

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    mode: (process.env.TRADE_MODE || 'paper'),
    botRunning,
    watchlist: WATCHLIST,
    strategy: STRATEGY,
    strategies: listStrategies(),
    marketOpen: live.isMarketOpen(),
    paperSim: live.paperMode
  });
});

// Watchlist snapshot — drives the dashboard table.
app.get('/api/watchlist', (_req, res) => {
  const rows = WATCHLIST.map(sym => {
    const s = state[sym];
    const chgPct = s.open ? +(((s.price / s.open) - 1) * 100).toFixed(2) : 0;
    return {
      symbol: sym, price: s.price, open: s.open, chgPct,
      dayHigh: s.dayHigh, dayLow: s.dayLow, vwap: s.vwap,
      orbHigh: s.orbHigh, orbLow: s.orbLow, orbDone: s.orbDone,
      lastVol: s.lastVol, avgVol: Math.round(s.avgVol),
      signal: s.signal, signalReason: s.signalReason,
      hasPosition: !!s.openPosition, source: s.source
    };
  });
  res.json({ date: istDateStr(), rows });
});

// Per-symbol detail.
app.get('/api/stock/:sym', (req, res) => {
  const sym = req.params.sym.toUpperCase();
  const s = state[sym];
  if (!s) return res.status(404).json({ error: 'symbol not in watchlist' });
  res.json({
    symbol: sym, price: s.price, open: s.open, dayHigh: s.dayHigh, dayLow: s.dayLow,
    vwap: s.vwap, orbHigh: s.orbHigh, orbLow: s.orbLow, orbDone: s.orbDone,
    signal: s.signal, signalReason: s.signalReason, source: s.source
  });
});

// Open position + live P&L per symbol.
app.get('/api/stock/:sym/position', (req, res) => {
  const sym = req.params.sym.toUpperCase();
  if (!state[sym]) return res.status(404).json({ error: 'unknown symbol' });
  res.json({ position: state[sym].openPosition, closed: state[sym].closedPositions });
});

// Manual entry (used by the confirm modal). body: { signal: 'BUY'|'SELL' }
app.post('/api/stock/:sym/enter', async (req, res) => {
  const sym = req.params.sym.toUpperCase();
  const eng = engineFor(sym);
  if (!eng) return res.status(404).json({ error: 'unknown symbol' });
  const result = await eng.forceEntry((req.body.signal || 'BUY').toUpperCase(), { allowLive: false });
  res.json(result);
});

// Manual exit. body: { reason }
app.post('/api/stock/:sym/exit', async (req, res) => {
  const sym = req.params.sym.toUpperCase();
  const s = state[sym];
  if (!s) return res.status(404).json({ error: 'unknown symbol' });
  if (!s.openPosition) return res.json({ ok: false, error: 'no open position' });
  await engineFor(sym)._exit(s.openPosition, s.openPosition.currentPrice, req.body.reason || 'MANUAL');
  res.json({ ok: true });
});

// Engine status (+ halt) per symbol.
app.get('/api/stock/:sym/engine/status', (req, res) => {
  const eng = engineFor(req.params.sym);
  if (!eng) return res.status(404).json({ error: 'unknown symbol' });
  res.json({ ...eng.status(), halt: eng.getHaltStatus() });
});

app.post('/api/stock/:sym/engine/auto', (req, res) => {
  const eng = engineFor(req.params.sym);
  if (!eng) return res.status(404).json({ error: 'unknown symbol' });
  eng.setAutoEnabled(!!req.body.enabled);
  res.json({ ok: true, autoEnabled: eng.autoEnabled });
});

app.post('/api/stock/:sym/engine/mode', (req, res) => {
  const eng = engineFor(req.params.sym);
  if (!eng) return res.status(404).json({ error: 'unknown symbol' });
  eng.setTradeMode(req.body.mode);
  res.json({ ok: true, mode: req.body.mode });
});

app.post('/api/engine/reset', (req, res) => {
  const sym = String(req.query.sym || '').toUpperCase();
  const eng = engineFor(sym);
  if (!eng) return res.status(400).json({ error: 'pass ?sym=SYMBOL' });
  const was = eng.resetHalt();
  res.json({ ok: true, symbol: sym, was, halt: eng.getHaltStatus() });
});

// Emergency: disable auto-trading on every symbol. Open positions are NOT closed.
app.post('/api/engine/halt-all', (_req, res) => {
  const before = {};
  for (const sym of WATCHLIST) { before[sym] = engines[sym].autoEnabled; engines[sym].setAutoEnabled(false); }
  console.warn('[engine] 🛑 HALT-ALL — every symbol paused');
  res.json({ ok: true, before });
});

// Bot loop control.
app.post('/api/bot/start', (_req, res) => { botRunning = true; res.json({ ok: true, botRunning }); });
app.post('/api/bot/stop',  (_req, res) => { botRunning = false; res.json({ ok: true, botRunning }); });
app.get('/api/bot/status', (_req, res) => res.json({ botRunning }));

// Risk + capital overview (aggregate).
app.get('/api/risk', (_req, res) => {
  const perSymbol = WATCHLIST.map(sym => {
    const eng = engines[sym];
    return {
      symbol: sym,
      capital: +eng.capital.toFixed(0),
      reserve: +(eng.reserve || 0).toFixed(0),
      dailyLossLimit: +(eng.capital * eng.maxDailyLossPct).toFixed(0),
      dailyPnl: +(eng._getDailyPnl ? eng._getDailyPnl() : 0).toFixed(0),
      halt: eng.getHaltStatus()
    };
  });
  const tokenExp = engines[WATCHLIST[0]]._isTokenExpired();
  res.json({ perSymbol, tokenExpired: live.paperMode ? false : tokenExp });
});

// Dhan token status (decoded JWT expiry).
app.get('/api/token-status', (_req, res) => res.json(tokenMonitor.tokenStatus()));

// Send a Telegram test message (verifies bot token + chat id).
app.post('/api/telegram/test', async (_req, res) => {
  if (!telegram.enabled) return res.json({ ok: false, error: 'telegram disabled (set TELEGRAM_ENABLED=true + token + chat id)' });
  const r = await telegram.sendTest();
  res.json({ ok: !!r.ok, result: r });
});

// Strategy config (read/patch) — applies to all engines.
app.get('/api/strategy-config', (_req, res) => {
  res.json(engines[WATCHLIST[0]].getConfig());
});
app.patch('/api/strategy-config', (req, res) => {
  let applied = {};
  for (const sym of WATCHLIST) applied = engines[sym].setConfig(req.body || {});
  res.json({ ok: true, applied });
});

// Combined trade journal across symbols.
app.get('/api/journal', (_req, res) => {
  const trades = [];
  for (const sym of WATCHLIST) for (const t of state[sym].closedPositions) trades.push(t);
  trades.sort((a, b) => new Date(b.exitAt) - new Date(a.exitAt));
  const wins = trades.filter(t => t.finalPnlAbs >= 0).length;
  res.json({
    trades,
    stats: {
      total: trades.length, wins, losses: trades.length - wins,
      winRate: trades.length ? +(wins / trades.length * 100).toFixed(1) : 0,
      netPnl: +trades.reduce((a, t) => a + (t.finalPnlAbs || 0), 0).toFixed(0),
      charges: +trades.reduce((a, t) => a + (t.charges || 0), 0).toFixed(0)
    }
  });
});

// ==================== EOD SUMMARY ====================
function eodSummary() {
  const date = istDateStr();
  const out = { date, timestamp: Date.now(), totalPnl: 0, symbols: {} };
  let allTrades = 0, allWins = 0;
  for (const sym of WATCHLIST) {
    const today = state[sym].closedPositions.filter(p => p.exitAt && p.exitAt.slice(0, 10) === date);
    const wins = today.filter(t => t.finalPnlAbs >= 0).length;
    const pnl = +today.reduce((a, t) => a + (t.finalPnlAbs || 0), 0).toFixed(0);
    const charges = +today.reduce((a, t) => a + (t.charges || 0), 0).toFixed(0);
    out.totalPnl += pnl; allTrades += today.length; allWins += wins;
    out.symbols[sym] = {
      trades: today.length, wins, losses: today.length - wins,
      winRate: today.length ? +(wins / today.length * 100).toFixed(1) : 0,
      pnl, charges, detail: today
    };
  }
  out.totalPnl = +out.totalPnl.toFixed(0);
  out.overallWinRate = allTrades ? +(allWins / allTrades * 100).toFixed(1) : 0;
  return out;
}
app.get('/api/eod-summary', (_req, res) => res.json(eodSummary()));

// Auto-write the EOD snapshot once at 15:35 IST.
let _eodLoggedDate = '';
setInterval(() => {
  const ist = istNow();
  const hh = ist.getUTCHours(), mm = ist.getUTCMinutes();
  const day = istDateStr();
  if (hh !== 15 || mm !== 35 || _eodLoggedDate === day) return;
  _eodLoggedDate = day;
  const s = eodSummary();
  try {
    fs.writeFileSync(path.join(DATA_DIR, `stock-eod-${day}.json`), JSON.stringify(s, null, 2));
    console.log(`[EOD ${day}] net ₹${s.totalPnl} | win ${s.overallWinRate}% — saved`);
    telegram.sendEod(s);
  } catch (e) { console.warn('[EOD] write failed:', e.message); }
}, 60 * 1000);

// ==================== BACKTEST ====================
// Read the last saved report (run via `node stock-backtest/run.js`).
app.get('/api/backtest/report', (_req, res) => {
  try {
    const r = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'stock-backtest-results.json'), 'utf8'));
    res.json(r);
  } catch (_) {
    res.status(404).json({ error: 'no backtest report yet — run: node stock-backtest/run.js' });
  }
});

// Trigger a backtest run in the background (non-blocking).
let _btRunning = false;
app.post('/api/backtest/run', async (req, res) => {
  if (_btRunning) return res.json({ ok: false, error: 'backtest already running' });
  _btRunning = true;
  res.json({ ok: true, started: true });
  try {
    const BacktestDataSource = require('./stock-backtest/data-source');
    const { runBacktest, cfgFromEnv } = require('./stock-backtest/engine');
    const { computeMetrics } = require('./stock-backtest/metrics');
    const { consistency } = require('./stock-backtest/walk-forward');
    const days = parseInt(req.body?.days || 60);
    const windows = parseInt(req.body?.windows || 4);
    const ds = new BacktestDataSource();
    const dates = BacktestDataSource.tradingDates(days);
    const cfg = cfgFromEnv();
    const result = await runBacktest({ dataSource: ds, symbols: WATCHLIST, dates, cfg });
    const metrics = computeMetrics(result);
    const cons = await consistency({ dataSource: ds, symbols: WATCHLIST, dates, cfg, windows });
    const out = {
      generatedAt: new Date().toISOString(), synthetic: !ds.live, symbols: WATCHLIST,
      dateRange: { from: dates[0], to: dates[dates.length - 1], sessions: dates.length },
      cfg, metrics, consistency: cons, equityCurve: result.equityCurve, trades: result.trades
    };
    fs.writeFileSync(path.join(DATA_DIR, 'stock-backtest-results.json'), JSON.stringify(out, null, 2));
    console.log(`[backtest] done — ${metrics.totalTrades} trades, win ${metrics.winRate}%, verdict ${cons.verdict}`);
  } catch (e) {
    console.error('[backtest] failed:', e.message);
  } finally { _btRunning = false; }
});

app.get('/api/backtest/status', (_req, res) => res.json({ running: _btRunning }));

// Dashboard
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

// ==================== BOOT ====================
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n🟢 Antigravity STOCK Bot on http://localhost:${PORT}`);
  console.log(`   Mode: ${(process.env.TRADE_MODE || 'paper').toUpperCase()} | Strategy: ${STRATEGY} | Watchlist: ${WATCHLIST.join(', ')}`);
  console.log(`   ⚠️  Backtest profit ≠ future profit. Charges + slippage erode returns.\n`);
  try { await live.connect(); } catch (e) { console.error('[equity] connect failed:', e.message); }
  restoreMarketState();
  _todayStr = istDateStr();

  // Token expiry monitor (live mode only — paper has no broker token to track).
  tokenMonitor.startMonitor({
    paperMode: live.paperMode,
    onWarn: (title, msg) => telegram.sendAlert(title, msg)
  });

  if (telegram.enabled) {
    telegram.sendAlert('🟢 Stock Bot Online',
      `Mode: ${process.env.TRADE_MODE || 'paper'}\nStrategy: ${STRATEGY}\nWatchlist: ${WATCHLIST.join(', ')}`);
  }
});

module.exports = app;
