/**
 * ANTIGRAVITY STOCK EXECUTION ENGINE
 * Cash-equity sibling of the options execution-engine.js.
 *
 * Differences from options engine:
 *  - No option chain / strike walk. Enters the STOCK directly at its LTP.
 *  - Position sizing is risk-based on SL DISTANCE: qty = floor(riskRs / (entry-sl)),
 *    then capped by MAX_POSITION_PCT of capital. (Options sized by lots × premium.)
 *  - SL / target / trail are price-PERCENT moves on the stock, not premium multiples.
 *  - Supports LONG and SHORT (intraday MIS). Signal 'BUY' = long, 'SELL' = short.
 *  - Charges (brokerage + STT + GST + exch + SEBI + stamp) are modelled on every
 *    round-trip and netted out of P&L — equity premiums in the options bot ignored
 *    charges, but for cash equity they materially erode the edge, so we never hide them.
 *
 * Same as options engine (reused verbatim in spirit):
 *  - Daily-loss / consecutive-loss / drawdown halt layers
 *  - Half-compound reserve (PROFIT_REINVEST_PCT)
 *  - Equity persistence to ./data/equity-stock.json across restarts
 *  - Slippage parity on both entry and exit fills
 *  - 15:15 IST hard square-off, entry window gating, token-expiry guard in live mode
 *  - Per-symbol auto flags overriding the global AUTO_TRADE_ENABLED
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istNow() { return new Date(Date.now() + IST_OFFSET_MS); }
function istMins(d) { return d.getUTCHours() * 60 + d.getUTCMinutes(); }

// Parse "HH:MM" → minutes-since-midnight. Falls back to provided default mins.
function parseHHMM(str, defMins) {
  if (!str || !/^\d{1,2}:\d{2}$/.test(str)) return defMins;
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Indian cash-equity charges for an INTRADAY (MIS) round-trip.
 * Conservative model — better to over-state cost than under-state the edge.
 *   brokerage : ₹20 per executed order or 0.03% of turnover, whichever lower (×2 legs)
 *   STT       : 0.025% on the SELL turnover (intraday)
 *   exchange  : ~0.00297% (NSE) on total turnover
 *   SEBI      : ₹10 per crore = 0.0001% on total turnover
 *   stamp     : 0.003% on the BUY turnover
 *   GST       : 18% on (brokerage + exchange + SEBI)
 * Returns total ₹ charges for the round-trip.
 */
function intradayCharges(entryPrice, exitPrice, qty) {
  const buyTurnover  = entryPrice * qty;
  const sellTurnover = exitPrice * qty;
  const totalTurnover = buyTurnover + sellTurnover;

  const brokPerLeg = (t) => Math.min(20, t * 0.0003);
  const brokerage = brokPerLeg(buyTurnover) + brokPerLeg(sellTurnover);
  const stt       = sellTurnover * 0.00025;
  const exchange  = totalTurnover * 0.0000297;
  const sebi      = totalTurnover * 0.000001;
  const stamp     = buyTurnover * 0.00003;
  const gst       = (brokerage + exchange + sebi) * 0.18;

  return +(brokerage + stt + exchange + sebi + stamp + gst).toFixed(2);
}

class StockExecutionEngine {
  constructor({ live, getSignal, getPrice, getOrbLevels, getVwap, getVolume,
                getOpenPosition, setOpenPosition, pushClosedPosition,
                incrementTrades, getTradesToday, getMaxTrades,
                symbol, securityId, exchangeSegment }) {
    this.live              = live;
    this.getSignal         = getSignal;          // () => 'BUY' | 'SELL' | 'WAIT'
    this.getPrice          = getPrice;           // () => last LTP
    this.getOrbLevels      = getOrbLevels;       // () => { high, low }
    this.getVwap           = getVwap || (() => 0);
    this.getVolume         = getVolume || (() => ({ last: 0, avg: 0 }));
    this.getOpenPosition   = getOpenPosition;
    this.setOpenPosition   = setOpenPosition;
    this.pushClosedPosition = pushClosedPosition;
    this.incrementTrades   = incrementTrades;
    this.getTradesToday    = getTradesToday;
    this.getMaxTrades      = getMaxTrades;

    // Instrument identity
    this.symbol          = (symbol || 'STOCK').toUpperCase();
    this.securityId      = securityId || null;
    this.exchangeSegment = exchangeSegment || 'NSE_EQ';

    // Risk params from env (price-percent based, not premium multiples)
    this.capital       = parseFloat(process.env.CAPITAL_TOTAL        || 100000);
    this.riskPct       = parseFloat(process.env.RISK_PER_TRADE_PCT   || 2) / 100;
    this.maxPositionPct= parseFloat(process.env.MAX_POSITION_PCT     || 25) / 100;
    this.slPct         = parseFloat(process.env.STOP_LOSS_PERCENT    || 1) / 100;
    this.targetPct     = parseFloat(process.env.TARGET_PERCENT       || 2) / 100;
    this.trailAfterPct = parseFloat(process.env.TRAIL_AFTER_PERCENT  || 1) / 100;
    this.trailLockPct  = parseFloat(process.env.TRAIL_LOCK_PERCENT   || 60) / 100;
    this.slipPct       = parseFloat(process.env.SLIPPAGE_PERCENT     || 0.1) / 100;
    /* NOT TRADE_MODE — that is the main bot's flag, and this engine's order
       path has none of the main bot's controls. See stock/arming.js. */
    this.paperMode     = require('./arming').armingState().paperMode;
const { maySendLive } = require('../live-permission');

    // Per-symbol auto flag overrides the global AUTO_TRADE_ENABLED.
    const perKey = `${this.symbol}_AUTO_ENABLED`;
    const perVal = process.env[perKey];
    this.autoEnabled = perVal != null
      ? perVal === 'true'
      : process.env.AUTO_TRADE_ENABLED === 'true';

    this.maxDailyLossPct = parseFloat(process.env.MAX_DAILY_LOSS_PERCENT || 3) / 100;
    this.maxConsecLosses = parseInt(process.env.MAX_CONSECUTIVE_LOSSES   || 8);
    this.maxDrawdownPct  = parseFloat(process.env.MAX_DRAWDOWN_PERCENT    || 20) / 100;

    // Entry window + square-off (IST), all configurable
    this.entryStartMins = parseHHMM(process.env.ENTRY_WINDOW_START, 9 * 60 + 31);
    this.entryEndMins   = parseHHMM(process.env.ENTRY_WINDOW_END,   14 * 60 + 30);
    this.squareOffMins  = parseHHMM(process.env.SQUARE_OFF_TIME,    15 * 60 + 15);

    this._getDailyPnl  = null; // injected by server

    this._lastSignal   = 'WAIT';
    this._enteredToday = false;
    this._todayDate    = '';
    this._consecLosses = 0;
    this._haltedReason = null;  // 'DAILY_LOSS' | 'CONSEC_LOSSES' | 'DRAWDOWN' | null
    this.reserve       = 0;
    this._peakEquity   = this.capital;
    this._tokenWarnedAt = 0;
  }

  // Runtime config update (mirrors options engine setConfig). Partial object.
  setConfig(partial) {
    const applied = {};
    const num = (v) => { const n = Number(v); return isFinite(n) ? n : null; };
    const map = {
      STOP_LOSS_PERCENT:     ['slPct',         (v) => v / 100],
      TARGET_PERCENT:        ['targetPct',     (v) => v / 100],
      TRAIL_AFTER_PERCENT:   ['trailAfterPct', (v) => v / 100],
      TRAIL_LOCK_PERCENT:    ['trailLockPct',  (v) => v / 100],
      RISK_PER_TRADE_PCT:    ['riskPct',       (v) => v / 100],
      MAX_POSITION_PCT:      ['maxPositionPct',(v) => v / 100],
      MAX_DAILY_LOSS_PERCENT:['maxDailyLossPct',(v) => v / 100],
      CAPITAL_TOTAL:         ['capital',       (v) => v]
    };
    for (const [k, [field, fn]] of Object.entries(map)) {
      if (partial[k] != null && num(partial[k]) != null) {
        this[field] = fn(num(partial[k]));
        applied[k] = num(partial[k]);
      }
    }
    return applied;
  }

  getConfig() {
    return {
      STOP_LOSS_PERCENT:   +(this.slPct * 100).toFixed(2),
      TARGET_PERCENT:      +(this.targetPct * 100).toFixed(2),
      TRAIL_AFTER_PERCENT: +(this.trailAfterPct * 100).toFixed(2),
      TRAIL_LOCK_PERCENT:  +(this.trailLockPct * 100).toFixed(2),
      RISK_PER_TRADE_PCT:  +(this.riskPct * 100).toFixed(2),
      MAX_POSITION_PCT:    +(this.maxPositionPct * 100).toFixed(2),
      MAX_DAILY_LOSS_PERCENT: +(this.maxDailyLossPct * 100).toFixed(2),
      CAPITAL_TOTAL:       this.capital
    };
  }

  _resetIfNewDay() {
    const d = istNow().toUTCString().slice(0, 16);
    if (d !== this._todayDate) {
      this._todayDate    = d;
      this._enteredToday = false;
      this._lastSignal   = 'WAIT';
      // Daily-loss halt resets each morning; consecutive-loss halt does NOT.
      if (this._haltedReason === 'DAILY_LOSS') this._haltedReason = null;
    }
  }

  // Called by _exit() after each trade closes. Half-compound + halt layers,
  // identical policy to the options engine.
  recordTradeResult({ pnl }) {
    const PROFIT_REINVEST_PCT = Number(process.env.PROFIT_REINVEST_PCT || 0.5);
    if (this.reserve == null) this.reserve = 0;
    const beforeActive = this.capital, beforeReserve = this.reserve;
    if (pnl > 0) {
      const toReserve = pnl * (1 - PROFIT_REINVEST_PCT);
      this.capital += pnl - toReserve;
      this.reserve += toReserve;
    } else {
      this.capital += pnl;
    }
    console.log(`[${this.symbol}] Equity: active ₹${beforeActive.toFixed(0)}→₹${this.capital.toFixed(0)}  reserve ₹${beforeReserve.toFixed(0)}→₹${this.reserve.toFixed(0)}  total ₹${(this.capital + this.reserve).toFixed(0)}`);

    // Drawdown circuit (active + reserve vs peak)
    const totalEquity = this.capital + (this.reserve || 0);
    if (totalEquity > this._peakEquity) this._peakEquity = totalEquity;
    const drawdown = (this._peakEquity - totalEquity) / this._peakEquity;
    if (drawdown > this.maxDrawdownPct && this.autoEnabled) {
      this.autoEnabled = false;
      this._haltedReason = 'DRAWDOWN';
      console.warn(`[${this.symbol}] ⛔ Max drawdown ${(drawdown * 100).toFixed(1)}% — auto trading DISABLED. Reset via /api/engine/reset?sym=${this.symbol}`);
    }

    this._persistEquity();

    if (pnl > 0) {
      if (this._consecLosses > 0) {
        console.log(`[${this.symbol}] ✅ Win — consecutive-loss counter reset (was ${this._consecLosses})`);
      }
      this._consecLosses = 0;
    } else {
      this._consecLosses += 1;
      console.log(`[${this.symbol}] ⚠️  Loss — consecutive losses: ${this._consecLosses}/${this.maxConsecLosses}`);
      if (this._consecLosses >= this.maxConsecLosses) {
        this._haltedReason = 'CONSEC_LOSSES';
        this.autoEnabled = false;
        console.warn(`[${this.symbol}] ⛔ HALT: ${this._consecLosses} losses in a row — auto trading DISABLED. POST /api/engine/reset to resume.`);
      }
    }
  }

  _persistEquity() {
    try {
      const _fs = require('fs'); const _path = require('path');
      const file = _path.resolve(`./data/equity-stock-${this.symbol.toLowerCase()}.json`);
      _fs.writeFileSync(file, JSON.stringify({
        capital: this.capital, reserve: this.reserve,
        consecLosses: this._consecLosses, peakEquity: this._peakEquity,
        updatedAt: new Date().toISOString()
      }, null, 2));
    } catch (e) { console.warn(`[${this.symbol}] equity persist failed: ${e.message}`); }
  }

  restoreEquity() {
    try {
      const _fs = require('fs'); const _path = require('path');
      const file = _path.resolve(`./data/equity-stock-${this.symbol.toLowerCase()}.json`);
      if (!_fs.existsSync(file)) return;
      const s = JSON.parse(_fs.readFileSync(file, 'utf8'));
      const ageMs = Date.now() - new Date(s.updatedAt || 0).getTime();
      if (ageMs > 30 * 24 * 3600 * 1000) {
        console.log(`[${this.symbol}] equity file stale — keeping baseline ₹${this.capital}`);
        return;
      }
      if (Number.isFinite(s.capital))      this.capital       = s.capital;
      if (Number.isFinite(s.reserve))      this.reserve       = s.reserve;
      if (Number.isFinite(s.consecLosses)) this._consecLosses = s.consecLosses;
      if (Number.isFinite(s.peakEquity))   this._peakEquity   = s.peakEquity;
      console.log(`[${this.symbol}] 📥 Restored equity: active ₹${this.capital.toFixed(0)} + reserve ₹${(this.reserve || 0).toFixed(0)} (consec losses: ${this._consecLosses})`);
    } catch (e) { console.warn(`[${this.symbol}] equity restore failed: ${e.message}`); }
  }

  resetHalt() {
    const was = { consecLosses: this._consecLosses, haltedReason: this._haltedReason };
    this._consecLosses = 0;
    this._haltedReason = null;
    const perKey = `${this.symbol}_AUTO_ENABLED`;
    const perVal = process.env[perKey];
    this.autoEnabled = perVal != null ? perVal === 'true' : process.env.AUTO_TRADE_ENABLED === 'true';
    console.log(`[${this.symbol}] 🔓 Halt cleared. Was: ${JSON.stringify(was)}. Auto = ${this.autoEnabled}`);
    return was;
  }

  getHaltStatus() {
    const totalEquity = this.capital + (this.reserve || 0);
    const dd = this._peakEquity > 0
      ? +((this._peakEquity - totalEquity) / this._peakEquity * 100).toFixed(2)
      : 0;
    return {
      halted: !!this._haltedReason,
      reason: this._haltedReason,
      consecLosses: this._consecLosses,
      maxConsecLosses: this.maxConsecLosses,
      autoEnabled: this.autoEnabled,
      peakEquity: +this._peakEquity.toFixed(0),
      currentEquity: +totalEquity.toFixed(0),
      drawdownPct: dd,
      maxDrawdownPct: +(this.maxDrawdownPct * 100).toFixed(2)
    };
  }

  _isTokenExpired() {
    try {
      const token = process.env.DHAN_ACCESS_TOKEN || '';
      const parts = token.split('.');
      if (parts.length !== 3) return true;
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(Buffer.from(b64, 'base64').toString());
      return !payload.exp || payload.exp * 1000 <= Date.now();
    } catch (_) { return true; }
  }

  // ── Called every 5s by server bot loop ─────────────────────────
  async tick() {
    this._resetIfNewDay();

    const ist  = istNow();
    const mins = istMins(ist);

    // Hard square-off
    if (mins >= this.squareOffMins) {
      const pos = this.getOpenPosition();
      if (pos) {
        console.log(`[${this.symbol}] square-off triggered`);
        await this._exit(pos, pos.currentPrice, 'EOD_SQUAREOFF');
      }
      return;
    }

    // Before entry window opens (let ORB form)
    if (mins < this.entryStartMins) return;

    // Monitor open position
    if (this.getOpenPosition()) {
      await this._monitorPosition();
      return;
    }

    if (!this.autoEnabled)  return;
    if (this._enteredToday) return;
    if (this.getTradesToday() >= this.getMaxTrades()) return;

    // Live mode + expired token = no order can succeed; refuse entry.
    if (!this.paperMode && this._isTokenExpired()) {
      if (!this._tokenWarnedAt || Date.now() - this._tokenWarnedAt > 60000) {
        console.warn(`[${this.symbol}] ⛔ Dhan token EXPIRED — auto entry paused. Refresh token then restart.`);
        this._tokenWarnedAt = Date.now();
      }
      return;
    }

    if (this._haltedReason === 'CONSEC_LOSSES') return;

    // Daily loss limit
    if (this._getDailyPnl) {
      const todayLoss = this._getDailyPnl();
      if (todayLoss < -(this.capital * this.maxDailyLossPct)) {
        if (this.autoEnabled) {
          this.autoEnabled = false;
          this._haltedReason = 'DAILY_LOSS';
          console.warn(`[${this.symbol}] ⛔ Daily loss limit hit (₹${(-todayLoss).toFixed(0)}) — auto trading DISABLED until tomorrow`);
        }
        return;
      }
    }

    // Entry window close
    if (mins > this.entryEndMins) return;

    // Fresh signal transition WAIT → BUY/SELL
    const signal = this.getSignal();
    if ((signal === 'BUY' || signal === 'SELL') && this._lastSignal === 'WAIT') {
      await this._enter(signal);
    }
    this._lastSignal = signal;
  }

  // Manual test entry — bypasses signal/window/auto checks for pipeline validation.
  async forceEntry(signal, { allowLive = false } = {}) {
    if (!this.paperMode && !allowLive) {
      return { ok: false, error: 'forceEntry blocked in LIVE mode (pass allowLive to override)' };
    }
    if (this.getOpenPosition()) return { ok: false, error: 'position already open' };
    if (signal !== 'BUY' && signal !== 'SELL') return { ok: false, error: 'signal must be BUY or SELL' };
    console.log(`[${this.symbol}] 🧪 MANUAL TEST entry: ${signal}`);
    await this._enter(signal);
    const pos = this.getOpenPosition();
    return pos ? { ok: true, position: pos } : { ok: false, error: 'entry did not open — check LTP / sizing (see logs)' };
  }

  // Build the human-readable entry reason from current market context.
  _entryReason(signal, ltp, orb, vwap, vol) {
    const dir = signal === 'BUY' ? 'long' : 'short';
    const bits = [`${dir} ${this.symbol}`];
    if (signal === 'BUY' && orb.high)  bits.push(`break ORB high ${orb.high.toFixed(2)}`);
    if (signal === 'SELL' && orb.low)  bits.push(`break ORB low ${orb.low.toFixed(2)}`);
    if (vwap) bits.push(signal === 'BUY' ? `above VWAP ${vwap.toFixed(2)}` : `below VWAP ${vwap.toFixed(2)}`);
    if (vol && vol.avg > 0) bits.push(`vol ${(vol.last / vol.avg).toFixed(1)}× avg`);
    return bits.join(' + ');
  }

  // ── Enter trade ─────────────────────────────────────────────────
  async _enter(signal) {
    const ltp = this.getPrice();
    if (!ltp || ltp <= 0) {
      console.warn(`[${this.symbol}] No live LTP — skipping (never fabricate a price).`);
      return;
    }
    if (!this.securityId && !this.paperMode) {
      console.warn(`[${this.symbol}] SKIP — no securityId, cannot place a live order.`);
      return;
    }

    // Apply slippage on entry (buy fills above quote, short fills below).
    const dir = signal === 'BUY' ? 1 : -1;
    const filledEntry = ltp * (1 + dir * this.slipPct);

    // SL is a price-percent move against the position.
    const sl     = signal === 'BUY' ? filledEntry * (1 - this.slPct) : filledEntry * (1 + this.slPct);
    const target = signal === 'BUY' ? filledEntry * (1 + this.targetPct) : filledEntry * (1 - this.targetPct);
    const riskPerShare = Math.abs(filledEntry - sl);
    if (riskPerShare <= 0) {
      console.warn(`[${this.symbol}] SKIP — zero risk-per-share (SL == entry).`);
      return;
    }

    // Risk-based sizing: qty = floor(riskRs / SL-distance), capped by notional cap.
    const riskRs   = this.capital * this.riskPct;
    let   qty      = Math.floor(riskRs / riskPerShare);
    const maxNotional = this.capital * this.maxPositionPct;
    const maxByNotional = Math.floor(maxNotional / filledEntry);
    if (qty > maxByNotional) qty = maxByNotional;
    if (qty < 1) {
      console.warn(`[${this.symbol}] SKIP — sized to 0 shares (risk ₹${riskRs.toFixed(0)} / SL-dist ₹${riskPerShare.toFixed(2)}, cap ${maxByNotional}).`);
      return;
    }
    const deployed = +(qty * filledEntry).toFixed(2);

    console.log(`[${this.symbol}] Sizing: risk ₹${riskRs.toFixed(0)} / SL-dist ₹${riskPerShare.toFixed(2)} = ${qty} shares (notional cap ${maxByNotional}) → deployed ₹${deployed.toFixed(0)}`);

    let orderId = `PAPER-${Date.now()}`;

    /* TWO KEYS. docs/085, docs/089 §1D.
         KEY 1  STOCK_TRADE_MODE — this component may act at all
         KEY 2  STOCK_ALLOW_LIVE — it may reach a broker

       One key gives you PAPER, not live: without key 2 the entry falls through
       and is recorded as a paper trade, loudly. Returning instead would silently
       drop a signal the engine believed in, and the operator would be debugging a
       missing trade rather than a missing flag.

       The EXIT path has no key 2, deliberately: an exit that needs a permission
       is a position that cannot be closed during the incident that made closing
       necessary — the same reason flatten.js is exempt. */
    const _perm = !this.paperMode
      ? maySendLive({ capability: true, capabilityFlag: 'STOCK_TRADE_MODE', liveFlag: 'STOCK_ALLOW_LIVE' })
      : { allowed: false, reason: 'paper mode', key: 1 };
    if (!this.paperMode && !_perm.allowed) {
      console.warn(`[${this.symbol}] LIVE ENTRY BLOCKED — ${_perm.reason}. Recording as paper.`);
    }

    if (!this.paperMode && _perm.allowed && this.securityId) {
      try {
        const res = await this.live.placeOrder({
          securityId:      this.securityId,
          exchangeSegment: this.exchangeSegment,
          transactionType: signal,            // BUY | SELL
          productType:     'INTRADAY',
          orderType:       'MARKET',
          quantity:        qty
        });
        orderId = res.orderId || orderId;
        console.log(`[${this.symbol}] LIVE ${signal} order placed: ${orderId}`);
      } catch (err) {
        console.error(`[${this.symbol}] Order placement failed:`, err.message);
        return;
      }
    } else {
      console.log(`[${this.symbol}] PAPER ${signal} ${qty} @ ${filledEntry.toFixed(2)}`);
    }

    const orb  = this.getOrbLevels();
    const vwap = this.getVwap();
    const vol  = this.getVolume();

    const pos = {
      symbol:       this.symbol,
      securityId:   this.securityId,
      signal,                                 // BUY (long) | SELL (short)
      side:         signal === 'BUY' ? 'LONG' : 'SHORT',
      quotedEntry:  ltp,
      slippagePct:  this.slipPct,
      entryPrice:   filledEntry,
      currentPrice: ltp,
      qty,
      deployed,
      orderId,
      enteredAt:    new Date().toISOString(),
      sl,
      target,
      trailActive:  false,
      lockedStop:   null,
      peakPrice:    filledEntry,              // best price seen (favorable direction)
      movingStop:   sl,
      status:       'OPEN',
      paperMode:    this.paperMode,
      orbHigh:      orb.high,
      orbLow:       orb.low,
      vwap,
      reason:       this._entryReason(signal, ltp, orb, vwap, vol)
    };

    this.setOpenPosition(pos);
    this.incrementTrades();
    this._enteredToday = true;
    console.log(`[${this.symbol}] ENTERED ${pos.side} ${qty} @ ${filledEntry.toFixed(2)} | SL ${sl.toFixed(2)} | T ${target.toFixed(2)} | ${pos.reason}`);
  }

  // ── Monitor open position ───────────────────────────────────────
  async _monitorPosition() {
    const pos = this.getOpenPosition();
    if (!pos) return;

    const ltp = this.getPrice() || pos.currentPrice;
    pos.currentPrice = ltp;
    const long = pos.side === 'LONG';

    // Track peak in the favorable direction.
    if (long  && ltp > pos.peakPrice) pos.peakPrice = ltp;
    if (!long && ltp < pos.peakPrice) pos.peakPrice = ltp;

    // Trailing: once price has moved trailAfterPct in our favor, lock a fraction of peak gain.
    const favMove = long
      ? (pos.peakPrice - pos.entryPrice) / pos.entryPrice
      : (pos.entryPrice - pos.peakPrice) / pos.entryPrice;

    if (!pos.trailActive && favMove >= this.trailAfterPct) {
      pos.trailActive = true;
    }
    if (pos.trailActive) {
      const peakGain = Math.abs(pos.peakPrice - pos.entryPrice);
      const lockedGain = peakGain * this.trailLockPct;
      const newStop = long ? pos.entryPrice + lockedGain : pos.entryPrice - lockedGain;
      // Stop only moves in the favorable direction.
      if (pos.lockedStop == null) pos.lockedStop = newStop;
      else pos.lockedStop = long ? Math.max(pos.lockedStop, newStop) : Math.min(pos.lockedStop, newStop);
    }

    // Effective stop = hard SL or trailing lock (whichever is tighter in our favor).
    pos.movingStop = long
      ? Math.max(pos.sl, pos.lockedStop ?? -Infinity)
      : Math.min(pos.sl, pos.lockedStop ??  Infinity);
    pos.status = pos.trailActive ? 'TRAIL_ACTIVE' : 'OPEN';

    // Live P&L (gross, before charges)
    const grossPnl = (long ? (ltp - pos.entryPrice) : (pos.entryPrice - ltp)) * pos.qty;
    pos.pnlAbs = +grossPnl.toFixed(0);
    pos.pnlPct = +(((long ? (ltp / pos.entryPrice - 1) : (pos.entryPrice / ltp - 1))) * 100).toFixed(2);

    // Target hit
    const targetHit = long ? ltp >= pos.target : ltp <= pos.target;
    if (targetHit) { console.log(`[${this.symbol}] TARGET hit @ ${ltp.toFixed(2)}`); return this._exit(pos, ltp, 'TARGET'); }

    // Trailing stop hit
    if (pos.trailActive && pos.lockedStop != null) {
      const trailHit = long ? ltp < pos.lockedStop : ltp > pos.lockedStop;
      if (trailHit) { console.log(`[${this.symbol}] TRAIL STOP @ ${ltp.toFixed(2)} (lock ${pos.lockedStop.toFixed(2)})`); return this._exit(pos, ltp, 'TRAIL_STOP'); }
    }

    // Hard SL hit
    const slHit = long ? ltp <= pos.sl : ltp >= pos.sl;
    if (slHit) { console.log(`[${this.symbol}] STOP LOSS @ ${ltp.toFixed(2)}`); return this._exit(pos, ltp, 'STOP_LOSS'); }

    this.setOpenPosition(pos);
  }

  // ── Exit trade ──────────────────────────────────────────────────
  async _exit(pos, rawExitPrice, reason) {
    const long = pos.side === 'LONG';
    // Slippage on exit (sell below quote when long; buy above quote when short).
    const exitPrice = rawExitPrice * (1 + (long ? -1 : 1) * (pos.slippagePct ?? this.slipPct));

    if (!this.paperMode && pos.securityId) {
      try {
        await this.live.placeOrder({
          securityId:      pos.securityId,
          exchangeSegment: this.exchangeSegment,
          transactionType: long ? 'SELL' : 'BUY',   // close the position
          productType:     'INTRADAY',
          orderType:       'MARKET',
          quantity:        pos.qty
        });
        console.log(`[${this.symbol}] LIVE close order placed`);
      } catch (err) {
        console.error(`[${this.symbol}] Exit order failed:`, err.message);
      }
    }

    const grossPnl = (long ? (exitPrice - pos.entryPrice) : (pos.entryPrice - exitPrice)) * pos.qty;
    const charges  = intradayCharges(pos.entryPrice, exitPrice, pos.qty);
    const netPnl   = grossPnl - charges;

    const closed = {
      ...pos,
      exitPrice:   +exitPrice.toFixed(2),
      exitAt:      new Date().toISOString(),
      exitReason:  reason,
      grossPnl:    +grossPnl.toFixed(2),
      charges,
      finalPnlAbs: +netPnl.toFixed(2),
      finalPnlPct: +((netPnl / pos.deployed) * 100).toFixed(2),
      status:      reason
    };

    this.pushClosedPosition(closed);
    this.setOpenPosition(null);
    this.recordTradeResult({ pnl: netPnl });

    const emoji = netPnl >= 0 ? '✅' : '❌';
    console.log(`[${this.symbol}] ${emoji} EXIT ${reason} | ${pos.side} ${pos.qty} | gross ₹${grossPnl.toFixed(0)} − charges ₹${charges.toFixed(0)} = net ₹${netPnl.toFixed(0)}`);
  }

  setAutoEnabled(v) { this.autoEnabled = v; console.log(`[${this.symbol}] autoEnabled=${v} | paper=${this.paperMode}`); }
  setTradeMode(mode) { this.paperMode = mode !== 'live'; console.log(`[${this.symbol}] tradeMode=${mode} | paper=${this.paperMode}`); }

  status() {
    return {
      symbol:       this.symbol,
      autoEnabled:  this.autoEnabled,
      paperMode:    this.paperMode,
      capital:      this.capital,
      reserve:      this.reserve,
      riskPct:      this.riskPct * 100,
      slPct:        this.slPct * 100,
      targetPct:    this.targetPct * 100,
      enteredToday: this._enteredToday
    };
  }
}

module.exports = StockExecutionEngine;
module.exports.intradayCharges = intradayCharges;
