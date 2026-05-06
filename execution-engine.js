/**
 * ANTIGRAVITY EXECUTION ENGINE
 * Watches for ORB signals → enters ATM+2 option → manages SL/trail/target/EOD exit
 * Works in both paper mode (no real orders) and live mode (Dhan orders).
 *
 * Supports SENSEX (BSE_FNO, lot=20, interval=100) and NIFTY (NSE_FNO, lot=75, interval=50).
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const SQUARE_OFF_H  = 15;
const SQUARE_OFF_M  = 15;

function istNow() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

function istMins(d) {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

class ExecutionEngine {
  constructor({ live, getSignal, getPrice, getOrbLevels, getOpenPosition, setOpenPosition,
                pushClosedPosition, incrementTrades, getTradesToday, getMaxTrades, getVwap,
                // Instrument params
                lotSize, strikeInterval, atmRound, exchangeSegment, instrumentName }) {
    this.live             = live;
    this.getSignal        = getSignal;
    this.getPrice         = getPrice;
    this.getOrbLevels     = getOrbLevels;
    this.getOpenPosition  = getOpenPosition;
    this.setOpenPosition  = setOpenPosition;
    this.pushClosedPosition = pushClosedPosition;
    this.incrementTrades  = incrementTrades;
    this.getTradesToday   = getTradesToday;
    this.getMaxTrades     = getMaxTrades;
    this.getVwap          = getVwap;

    // Instrument identity
    this.lotSize         = lotSize         || 20;
    this.strikeInterval  = strikeInterval  || 100;
    this.atmRound        = atmRound        || 100;
    this.exchangeSegment = exchangeSegment || 'BSE_FNO';
    this.instrumentName  = instrumentName  || 'SENSEX';

    // Risk params from env
    this.capital       = parseFloat(process.env.CAPITAL_TOTAL           || 500000);
    this.riskPct       = parseFloat(process.env.CAPITAL_PER_TRADE_PERCENT|| 5) / 100;
    this.slPct         = parseFloat(process.env.STOP_LOSS_PERCENT        || 50) / 100;
    this.trailMult     = parseFloat(process.env.TRAIL_AFTER_MULTIPLE     || 2);
    this.trailLockPct  = parseFloat(process.env.TRAIL_LOCK_PERCENT       || 50) / 100;
    this.targetMult    = parseFloat(process.env.TARGET_PERCENT           || 150) / 100 + 1; // 2.5x
    this.strikeOffset  = parseInt(process.env.BACKTEST_STRIKE_OFFSET     || 2);
    this.paperMode     = (process.env.TRADE_MODE || 'paper') !== 'live';

    // Per-instrument auto flag overrides the global AUTO_TRADE_ENABLED.
    // Order: SENSEX_AUTO_ENABLED / NIFTY_AUTO_ENABLED → AUTO_TRADE_ENABLED → false
    // Use this to enable NIFTY-only trading without firing the disabled SENSEX strategy.
    const perInstrumentKey = `${(this.instrumentName || '').toUpperCase()}_AUTO_ENABLED`;
    const perInstrumentVal = process.env[perInstrumentKey];
    this.autoEnabled = perInstrumentVal != null
      ? perInstrumentVal === 'true'
      : process.env.AUTO_TRADE_ENABLED === 'true';

    this.maxDailyLossPct = parseFloat(process.env.MAX_DAILY_LOSS_PERCENT || 2) / 100;
    this.maxConsecLosses = parseInt(process.env.MAX_CONSECUTIVE_LOSSES   || 5);

    // Per-instrument premium cap — skip the trade if option LTP exceeds this.
    // Forces deeper-OTM strikes that fit the user's per-trade ₹ budget.
    const maxPremEnvKey = `${(this.instrumentName || '').toUpperCase()}_MAX_PREMIUM`;
    this.maxPremium = parseFloat(process.env[maxPremEnvKey] || 0) || null;
    this._getDailyPnl  = null; // injected by server

    this._lastSignal      = 'WAIT';
    this._enteredToday    = false;
    this._todayDate       = '';
    this._consecLosses    = 0;     // resets only on a winning trade
    this._haltedReason    = null;  // 'DAILY_LOSS' | 'CONSEC_LOSSES' | null
  }

  // Runtime config update — called by /api/config PATCH to apply changes
  // without restarting the bot. Partial object: only provided keys are updated.
  setConfig(partial) {
    const applied = {};
    const num = (v) => { const n = Number(v); return isFinite(n) ? n : null; };
    if (partial.STOP_LOSS_PERCENT        != null && num(partial.STOP_LOSS_PERCENT)        != null) { this.slPct          = num(partial.STOP_LOSS_PERCENT) / 100;        applied.STOP_LOSS_PERCENT        = num(partial.STOP_LOSS_PERCENT); }
    if (partial.TARGET_PERCENT           != null && num(partial.TARGET_PERCENT)           != null) { this.targetMult     = num(partial.TARGET_PERCENT) / 100 + 1;       applied.TARGET_PERCENT           = num(partial.TARGET_PERCENT); }
    if (partial.TRAIL_AFTER_MULTIPLE     != null && num(partial.TRAIL_AFTER_MULTIPLE)     != null) { this.trailMult      = num(partial.TRAIL_AFTER_MULTIPLE);           applied.TRAIL_AFTER_MULTIPLE     = num(partial.TRAIL_AFTER_MULTIPLE); }
    if (partial.TRAIL_LOCK_PERCENT       != null && num(partial.TRAIL_LOCK_PERCENT)       != null) { this.trailLockPct   = num(partial.TRAIL_LOCK_PERCENT) / 100;       applied.TRAIL_LOCK_PERCENT       = num(partial.TRAIL_LOCK_PERCENT); }
    if (partial.CAPITAL_PER_TRADE_PERCENT!= null && num(partial.CAPITAL_PER_TRADE_PERCENT)!= null) { this.riskPct        = num(partial.CAPITAL_PER_TRADE_PERCENT)/100; applied.CAPITAL_PER_TRADE_PERCENT= num(partial.CAPITAL_PER_TRADE_PERCENT); }
    if (partial.MAX_DAILY_LOSS_PERCENT   != null && num(partial.MAX_DAILY_LOSS_PERCENT)   != null) { this.maxDailyLossPct= num(partial.MAX_DAILY_LOSS_PERCENT) / 100;   applied.MAX_DAILY_LOSS_PERCENT   = num(partial.MAX_DAILY_LOSS_PERCENT); }
    if (partial.CAPITAL_TOTAL            != null && num(partial.CAPITAL_TOTAL)            != null) { this.capital        = num(partial.CAPITAL_TOTAL);                  applied.CAPITAL_TOTAL            = num(partial.CAPITAL_TOTAL); }
    return applied;
  }

  getConfig() {
    return {
      STOP_LOSS_PERCENT:         +(this.slPct * 100).toFixed(2),
      TARGET_PERCENT:            +((this.targetMult - 1) * 100).toFixed(2),
      TRAIL_AFTER_MULTIPLE:      +this.trailMult.toFixed(2),
      TRAIL_LOCK_PERCENT:        +(this.trailLockPct * 100).toFixed(2),
      CAPITAL_PER_TRADE_PERCENT: +(this.riskPct * 100).toFixed(2),
      MAX_DAILY_LOSS_PERCENT:    +(this.maxDailyLossPct * 100).toFixed(2),
      CAPITAL_TOTAL:             this.capital
    };
  }

  _resetIfNewDay() {
    const d = istNow().toUTCString().slice(0, 16);
    if (d !== this._todayDate) {
      this._todayDate    = d;
      this._enteredToday = false;
      // Daily-loss halt resets each morning; consecutive-loss halt does NOT
      // (a 5-trade losing streak across days is still a streak — needs manual reset).
      if (this._haltedReason === 'DAILY_LOSS') this._haltedReason = null;
    }
  }

  // Called by _exit() after each trade closes. Tracks streaks and halts the
  // engine when MAX_CONSECUTIVE_LOSSES is hit (defends against the 2023-style
  // 9% win-rate regime burning through the account before it self-corrects).
  recordTradeResult({ pnl }) {
    // Half-compound (Rule B): on a profit, only PROFIT_REINVEST_PCT of the
    // profit goes back into the active capital used for sizing — the other
    // half is moved to a "reserve" pile that's protected from later losses.
    // Losses come out of active capital in full (reserve is safe).
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
    console.log(`[${this.instrumentName}] Equity: active ₹${beforeActive.toFixed(0)}→₹${this.capital.toFixed(0)}  reserve ₹${beforeReserve.toFixed(0)}→₹${this.reserve.toFixed(0)}  total ₹${(this.capital+this.reserve).toFixed(0)}`);

    if (pnl > 0) {
      if (this._consecLosses > 0) {
        console.log(`[${this.instrumentName}] ✅ Win — consecutive-loss counter reset (was ${this._consecLosses})`);
      }
      this._consecLosses = 0;
    } else {
      this._consecLosses += 1;
      console.log(`[${this.instrumentName}] ⚠️  Loss — consecutive losses: ${this._consecLosses}/${this.maxConsecLosses}`);
      if (this._consecLosses >= this.maxConsecLosses) {
        this._haltedReason = 'CONSEC_LOSSES';
        this.autoEnabled = false;
        console.warn(`[${this.instrumentName}] ⛔ HALT: ${this._consecLosses} losses in a row — auto trading DISABLED. Use POST /api/engine/reset to resume.`);
      }
    }
  }

  // Manual reset of the consecutive-loss halt. Called by server endpoint
  // when the operator has reviewed the situation and wants to resume.
  resetHalt() {
    const was = { consecLosses: this._consecLosses, haltedReason: this._haltedReason };
    this._consecLosses = 0;
    this._haltedReason = null;
    this.autoEnabled = process.env.AUTO_TRADE_ENABLED === 'true';
    console.log(`[${this.instrumentName}] 🔓 Halt cleared. Was: ${JSON.stringify(was)}. Auto = ${this.autoEnabled}`);
    return was;
  }

  getHaltStatus() {
    return {
      halted: !!this._haltedReason,
      reason: this._haltedReason,
      consecLosses: this._consecLosses,
      maxConsecLosses: this.maxConsecLosses,
      autoEnabled: this.autoEnabled
    };
  }

  // ── Called every 5s by server bot loop ─────────────────────────
  async tick() {
    this._resetIfNewDay();

    const ist  = istNow();
    const mins = istMins(ist);

    // Hard square-off at 15:15
    if (mins >= SQUARE_OFF_H * 60 + SQUARE_OFF_M) {
      const pos = this.getOpenPosition();
      if (pos) {
        console.log(`[${this.instrumentName}] 15:15 square-off triggered`);
        await this._exit(pos, pos.currentPrice, 'EOD_SQUAREOFF');
      }
      return;
    }

    // Market not open yet (before 9:31 IST — let ORB form)
    if (mins < 9 * 60 + 31) return;

    // Monitor open position
    if (this.getOpenPosition()) {
      await this._monitorPosition();
      return;
    }

    // Don't enter if already traded today or auto disabled
    if (!this.autoEnabled)       return;
    if (this._enteredToday)      return;
    if (this.getTradesToday() >= this.getMaxTrades()) return;

    // Consecutive-loss circuit breaker — bot stays halted across days
    // until operator clears via POST /api/engine/reset.
    if (this._haltedReason === 'CONSEC_LOSSES') return;

    // Daily loss limit check
    if (this._getDailyPnl) {
      const todayLoss = this._getDailyPnl();
      if (todayLoss < -(this.capital * this.maxDailyLossPct)) {
        if (this.autoEnabled) {
          this.autoEnabled = false;
          this._haltedReason = 'DAILY_LOSS';
          console.warn(`[${this.instrumentName}] ⛔ Daily loss limit hit (₹${(-todayLoss).toFixed(0)}) — auto trading DISABLED until tomorrow`);
        }
        return;
      }
    }

    // Only enter in 9:31–10:30 window
    if (mins > 10 * 60 + 30) return;

    // Check for fresh signal
    const signal = this.getSignal();
    if ((signal === 'CALL' || signal === 'PUT') && this._lastSignal === 'WAIT') {
      await this._enter(signal);
    }
    this._lastSignal = signal;
  }

  // ── Find option security ID and LTP from live chain ────────────
  async _getOption(signal) {
    const spot   = this.getPrice();
    const atm    = Math.round(spot / this.atmRound) * this.atmRound;
    const offset = signal === 'CALL' ? this.strikeOffset : -this.strikeOffset;
    const strike = atm + offset * this.strikeInterval;
    const type   = signal === 'CALL' ? 'CE' : 'PE';

    let securityId = null;
    let ltp        = null;

    try {
      const chain = await this._getChain(spot);
      const row   = chain.strikes.find(s => Number(s.strike) === Number(strike));
      if (row) {
        const side = signal === 'CALL' ? row.ce : row.pe;
        securityId = side.securityId;
        ltp        = side.ltp;
      }
    } catch (err) {
      console.warn(`[${this.instrumentName}] chain fetch failed:`, err.message);
    }

    // Fallback LTP from BSM if chain unavailable
    if (!ltp || ltp <= 0) {
      try {
        const { bsmPrice, tteYears } = require('./backtest-real/synth-option-pricer');
        const T   = tteYears(Math.floor(Date.now() / 1000));
        const bsm = bsmPrice(spot, strike, T, 0.08, type);
        ltp = Math.max(bsm, 0.05);
        console.log(`[${this.instrumentName}] BSM fallback LTP: ${ltp.toFixed(1)} for ${strike}${type}`);
      } catch (_) { ltp = 50; }
    }

    return { strike, type, securityId, ltp };
  }

  async _getChain(spot) {
    if (this.instrumentName === 'NIFTY') {
      return this.live.getNiftyOptionChain(spot);
    }
    return this.live.getOptionChain(spot);
  }

  // ── Enter trade ─────────────────────────────────────────────────
  async _enter(signal) {
    console.log(`[${this.instrumentName}] Signal ${signal} — attempting entry`);

    const { strike, type, securityId, ltp } = await this._getOption(signal);
    if (!ltp || ltp <= 0) {
      console.warn(`[${this.instrumentName}] Could not determine option LTP — skipping`);
      return;
    }

    if (this.maxPremium && ltp > this.maxPremium) {
      console.log(`[${this.instrumentName}] SKIP — option LTP ₹${ltp.toFixed(2)} > cap ₹${this.maxPremium} (${strike}${type})`);
      return;
    }
    // Compounded position sizing: lots = floor(equity × riskPct / cost-per-lot).
    // Min 1 lot — even if budget < 1 lot, take it (per-trade ₹ cap above
    // already filtered overpriced premiums). As equity grows, lots scale.
    const riskAmount = this.capital * this.riskPct;
    const lots       = Math.max(1, Math.floor(riskAmount / (ltp * this.lotSize)));
    const quantity   = lots * this.lotSize;
    const deployed   = lots * ltp * this.lotSize;
    console.log(`[${this.instrumentName}] Sizing: equity ₹${this.capital.toFixed(0)} × ${(this.riskPct*100).toFixed(1)}% = ₹${riskAmount.toFixed(0)} budget → ${lots} lot(s) (${quantity} qty) @ ₹${ltp.toFixed(2)} = ₹${deployed.toFixed(0)} deployed`);

    let orderId = `PAPER-${Date.now()}`;
    if (!this.paperMode && securityId) {
      try {
        const res = await this.live.placeOrder({
          securityId,
          exchangeSegment: this.exchangeSegment,
          transactionType: 'BUY',
          productType:     'INTRADAY',
          orderType:       'MARKET',
          quantity
        });
        orderId = res.orderId || orderId;
        console.log(`[${this.instrumentName}] LIVE BUY order placed: ${orderId}`);
      } catch (err) {
        console.error(`[${this.instrumentName}] Order placement failed:`, err.message);
        return;
      }
    } else {
      console.log(`[${this.instrumentName}] PAPER BUY ${quantity} × ${strike}${type} @ ${ltp.toFixed(1)}`);
    }

    const pos = {
      instrument:   this.instrumentName,
      signal,
      type,
      strike,
      securityId,
      entryPrice:   ltp,
      currentPrice: ltp,
      lots,
      quantity,
      deployed,
      orderId,
      enteredAt:    new Date().toISOString(),
      sl:           ltp * (1 - this.slPct),
      trailAt:      ltp * this.trailMult,
      trailLocked:  false,
      lockedFloor:  null,
      peakPrice:    ltp,
      movingStop:   ltp * (1 - this.slPct),
      autoMovingStop: true,
      status:       'OPEN',
      paperMode:    this.paperMode,
      orbHigh:      this.getOrbLevels().high,
      orbLow:       this.getOrbLevels().low,
      vwap:         this.getVwap()
    };

    this.setOpenPosition(pos);
    this.incrementTrades();
    this._enteredToday = true;

    console.log(`[${this.instrumentName}] ENTERED ${signal} ${strike}${type} @ ${ltp.toFixed(1)} | ${lots} lots | deployed ₹${deployed.toFixed(0)} | SL ${pos.sl.toFixed(1)}`);
  }

  // ── Monitor open position ───────────────────────────────────────
  async _monitorPosition() {
    const pos = this.getOpenPosition();
    if (!pos) return;

    let ltp = pos.currentPrice;
    try {
      const spot  = this.getPrice();
      const chain = await this._getChain(spot);
      const row   = chain.strikes.find(s => Number(s.strike) === Number(pos.strike));
      if (row) {
        const side = pos.type === 'CE' ? row.ce : row.pe;
        if (side.ltp > 0) ltp = side.ltp;
      }
    } catch (_) { /* use last known */ }

    pos.currentPrice = ltp;
    if (ltp > pos.peakPrice) pos.peakPrice = ltp;

    // Trail activation
    if (!pos.trailLocked && ltp >= pos.entryPrice * this.trailMult) {
      const gain       = pos.peakPrice - pos.entryPrice;
      const lockedGain = gain * this.trailLockPct;
      pos.trailLocked  = true;
      pos.lockedFloor  = pos.entryPrice + lockedGain;
      console.log(`[${this.instrumentName}] TRAIL LOCKED @ ${pos.lockedFloor.toFixed(1)}`);
    }

    if (pos.trailLocked) {
      const gain       = pos.peakPrice - pos.entryPrice;
      const lockedGain = gain * this.trailLockPct;
      const newFloor   = pos.entryPrice + lockedGain;
      if (newFloor > pos.lockedFloor) pos.lockedFloor = newFloor;
    }

    pos.movingStop = Math.max(pos.sl || 0, pos.lockedFloor || 0);
    pos.autoMovingStop = true;
    pos.stopDistance = +(ltp - pos.movingStop).toFixed(2);
    pos.stopDistancePct = pos.movingStop > 0 ? +(((ltp / pos.movingStop) - 1) * 100).toFixed(2) : 0;

    pos.status = 'OPEN';
    if (pos.trailLocked) pos.status = 'TRAIL_ACTIVE';

    const mult   = ltp / pos.entryPrice;
    const pnlPct = ((mult - 1) * 100).toFixed(1);
    const pnlAbs = ((mult - 1) * pos.deployed).toFixed(0);

    if (mult >= this.targetMult) {
      console.log(`[${this.instrumentName}] TARGET HIT ${mult.toFixed(2)}x`);
      return this._exit(pos, ltp, 'TARGET');
    }

    if (pos.trailLocked && ltp < pos.lockedFloor) {
      console.log(`[${this.instrumentName}] TRAIL STOP hit @ ${ltp.toFixed(1)} (floor ${pos.lockedFloor.toFixed(1)})`);
      return this._exit(pos, ltp, 'TRAIL_STOP');
    }

    if (ltp <= pos.sl) {
      console.log(`[${this.instrumentName}] STOP LOSS hit @ ${ltp.toFixed(1)}`);
      return this._exit(pos, ltp, 'STOP_LOSS');
    }

    pos.mult   = mult.toFixed(3);
    pos.pnlPct = pnlPct;
    pos.pnlAbs = pnlAbs;
    this.setOpenPosition(pos);
  }

  // ── Exit trade ──────────────────────────────────────────────────
  async _exit(pos, exitPrice, reason) {
    if (!this.paperMode && pos.securityId) {
      try {
        await this.live.placeOrder({
          securityId:      pos.securityId,
          exchangeSegment: this.exchangeSegment,
          transactionType: 'SELL',
          productType:     'INTRADAY',
          orderType:       'MARKET',
          quantity:        pos.quantity
        });
        console.log(`[${this.instrumentName}] LIVE SELL order placed`);
      } catch (err) {
        console.error(`[${this.instrumentName}] Exit order failed:`, err.message);
      }
    }

    const mult   = exitPrice / pos.entryPrice;
    const pnlPct = ((mult - 1) * 100).toFixed(1);
    const pnlAbs = ((mult - 1) * pos.deployed).toFixed(0);

    const closed = {
      ...pos,
      exitPrice,
      exitAt:      new Date().toISOString(),
      exitReason:  reason,
      finalMult:   mult.toFixed(3),
      finalPnlPct: pnlPct,
      finalPnlAbs: pnlAbs,
      status:      reason
    };

    this.pushClosedPosition(closed);
    this.setOpenPosition(null);

    // Update consecutive-loss counter — may halt the engine if streak limit hit.
    this.recordTradeResult({ pnl: parseFloat(pnlAbs) });

    const emoji = mult >= 1 ? '✅' : '❌';
    console.log(`[${this.instrumentName}] ${emoji} EXIT ${reason} | ${pos.signal} ${pos.strike}${pos.type} | ${mult.toFixed(2)}x | ${pnlPct}% | ₹${pnlAbs}`);
  }

  setAutoEnabled(v) {
    this.autoEnabled = v;
    console.log(`[${this.instrumentName}] autoEnabled=${v} | paper=${this.paperMode}`);
  }

  setTradeMode(mode) {
    this.paperMode = mode !== 'live';
    console.log(`[${this.instrumentName}] tradeMode=${mode} | paper=${this.paperMode}`);
  }

  status() {
    return {
      instrument:   this.instrumentName,
      autoEnabled:  this.autoEnabled,
      paperMode:    this.paperMode,
      capital:      this.capital,
      riskPct:      this.riskPct * 100,
      lotSize:      this.lotSize,
      strikeOffset: this.strikeOffset,
      sl:           this.slPct * 100,
      trailMult:    this.trailMult,
      targetMult:   this.targetMult,
      enteredToday: this._enteredToday
    };
  }
}

module.exports = ExecutionEngine;
