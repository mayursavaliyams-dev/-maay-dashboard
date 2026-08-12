/**
 * AFTERNOON GAMMA SQUEEZE ENGINE
 * Secondary execution engine for the 12:00–14:30 IST afternoon session.
 *
 * Instead of ORB+VWAP signals, this engine scores entries by combining
 * EXISTING detection systems that are currently dashboard-only:
 *   1. Gamma Blast (option-analyzer.js)  — 0-30 pts
 *   2. BOS / Rejection reversals         — 0-25 pts
 *   3. Max Pain alignment                — 0-15 pts
 *   4. EMA Stack confluence              — 0-15 pts
 *   5. H/L Pattern momentum              — 0-15 pts
 *
 * Design decisions (user-selected Option B for all):
 *   • Separate capital allocation (40% of total)
 *   • Gamma is soft scoring (not a hard gate)
 *   • Works any day (not expiry-only)
 *
 * Shares the same live connector, telegram alerter, and global risk caps
 * (daily loss limit, max drawdown) with the morning engine.
 */

const { roundTripCharges } = require('./charges');
const { placeGuarded } = require('./place-guarded');
const { maySendLive } = require('./live-permission');
const { assertLimits } = require('./limits');

/* RISK LIMITS THROUGH limits.js — docs/089 §1B.

   Each of these was `parseInt(process.env.X || d)`. Measured against the real
   engine on 2026-08-10:

       AFTERNOON_MAX_TRADES=abc  ->  parseInt  ->  NaN
       tradesToday >= NaN  is false for EVERY count — the cap does not exist

   No error, no log, no test failure. Number() rather than parseInt, because
   parseInt("12abc") is 12: a typo silently becomes a DIFFERENT valid limit.

   A malformed value is a REFUSAL, not the default. Falling back to the default
   feels safe and converts an operator's typo into a silent policy change.

   Bounds are the operator's to set; these are the shipped defaults made
   explicit. */
  /* BOUNDS ARE A SANITY RAIL, NOT A POLICY.

     The first version of this bounded AFTERNOON_MAX_TRADES at 50 and refused to
     start: the deployed .env sets 100. The limits module was right and the bound
     was a guess — so these are now set from what is ACTUALLY configured
     (AFTERNOON_MAX_TRADES=100, MAX_TRADES_PER_DAY=100, MAX_CONSECUTIVE_LOSSES=8)
     with headroom, and their job is to catch a fat finger — a stray zero, a
     negative, a percentage written as a fraction — not to express an opinion
     about how much the operator may trade.

     A bound that refuses a real configuration is worse than no bound: it teaches
     whoever hits it to widen the rail rather than read it. */
const RISK_LIMITS = assertLimits({
  MAX_DAILY_LOSS_PERCENT: { default: 2,  min: 0, max: 100 },
  MAX_CONSECUTIVE_LOSSES: { default: 5,  min: 1, max: 1000, integer: true },
  MAX_DRAWDOWN_PERCENT:   { default: 20, min: 0, max: 100 },
  AFTERNOON_MAX_TRADES:   { default: 1,  min: 0, max: 1000, integer: true },
});

const _registry = require('./instrument-registry');

/* Fails closed: an unknown expiry leaves the risk layer's expiry-concentration
   check UNEVALUABLE, and the order blocks. */
function safeExpiry(inst) {
  try { return _registry.nextExpiry(inst) || null; } catch (_) { return null; }
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istNow() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

function istMins(d) {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

class AfternoonEngine {
  /**
   * @param {object} opts
   * @param {object}   opts.live             — LiveConnector instance (shared with morning engine)
   * @param {function} opts.getPrice         — () => spotPrice
   * @param {function} opts.getOpenPosition  — () => afternoonOpenPosition
   * @param {function} opts.setOpenPosition  — (pos) => void
   * @param {function} opts.pushClosedPosition — (pos) => void
   * @param {function} opts.getGammaBlast    — () => { blastLevel, blastScore, ... } from option-analyzer
   * @param {function} opts.getReversals     — () => [{ kind, dir, pivot, price, movePct, at }]
   * @param {function} opts.getMaxPain       — () => { maxPainStrike } or null
   * @param {function} opts.getEmaStack      — () => { tactic, ema9, ema50, ... } or null
   * @param {function} opts.getPattern       — () => { name, direction, movePct, detectedAt } or null
   * @param {function} opts.getMorningPnl    — () => number (morning engine P&L today)
   * @param {number}   opts.lotSize
   * @param {number}   opts.strikeInterval
   * @param {number}   opts.atmRound
   * @param {string}   opts.exchangeSegment
   * @param {string}   opts.instrumentName
   */
  constructor(opts) {
    this.live             = opts.live;
    /* THE GUARD. server.js:3674 and :3739 have always passed `broker:
       guardedBroker`; this line was missing, so it was dropped on the floor and
       `this.broker` was undefined. Consequences until 2026-08-10:
         :532  placeGuarded({ broker: undefined })  — every entry refused
         :697  if (!this.broker) throw ORDER_NO_BROKER — every EXIT threw

       Found by filling attestation's orderConsumers with the property each
       engine actually holds instead of assuming they were alike; /api/attestation
       reported `bypassing: niftyAfternoon, sensexAfternoon` from the live object
       graph before this was fixed.

       `|| null` rather than leaving it undefined: the :697 check reads
       `!this.broker`, and null says "deliberately absent" where undefined says
       "nobody thought about it". */
    this.broker           = opts.broker || null;
    this.getPrice         = opts.getPrice;
    this.getOpenPosition  = opts.getOpenPosition;
    this.setOpenPosition  = opts.setOpenPosition;
    this.pushClosedPosition = opts.pushClosedPosition;
    this.getGammaBlast    = opts.getGammaBlast    || (() => null);
    this.getReversals     = opts.getReversals     || (() => []);
    this.getMaxPain       = opts.getMaxPain       || (() => null);
    this.getEmaStack      = opts.getEmaStack      || (() => null);
    this.getPattern       = opts.getPattern       || (() => null);
    this.getMorningPnl    = opts.getMorningPnl    || (() => 0);
    // Callback for trade events (entry/exit) — server.js injects this
    // to send telegram alerts tagged [🌅 AFTERNOON].
    this.onTradeEvent     = opts.onTradeEvent     || null;

    // Instrument identity
    this.lotSize         = opts.lotSize         || 20;
    this.strikeInterval  = opts.strikeInterval  || 100;
    this.atmRound        = opts.atmRound        || 100;
    this.exchangeSegment = opts.exchangeSegment || 'BSE_FNO';
    this.instrumentName  = opts.instrumentName  || 'SENSEX';

    // Capital: 40% of total allocation (Option B: separate from morning)
    const totalCapital = parseFloat(process.env.CAPITAL_TOTAL || 100000);
    const afternoonPct = parseFloat(process.env.AFTERNOON_CAPITAL_PCT || 40) / 100;
    this.capital       = totalCapital * afternoonPct;
    this.reserve       = 0;
    this.riskPct       = parseFloat(process.env.CAPITAL_PER_TRADE_PERCENT || 5) / 100;

    // Afternoon-specific risk params
    this.slPct         = parseFloat(process.env.AFTERNOON_STOP_LOSS_PERCENT    || 40) / 100;
    this.trailMult     = parseFloat(process.env.AFTERNOON_TRAIL_AFTER_MULTIPLE || 1.5);
    this.trailLockPct  = parseFloat(process.env.AFTERNOON_TRAIL_LOCK_PERCENT   || 60) / 100;
    this.targetMult    = parseFloat(process.env.AFTERNOON_TARGET_PERCENT       || 300) / 100 + 1; // 4x
    this.scoreThreshold= parseInt(process.env.AFTERNOON_SCORE_THRESHOLD        || 70);
    this.maxTrades     = RISK_LIMITS.AFTERNOON_MAX_TRADES;
    this.timeStopMins  = parseInt(process.env.AFTERNOON_TIME_STOP_MINUTES      || 20);
    // Minimum minutes to wait after an exit before re-entering. 0 = no cooldown.
    this.reentryCooldownMins = parseInt(process.env.AFTERNOON_REENTRY_COOLDOWN_MINUTES || 0);
    // Charge-aware guard: expected gain at target must clear round-trip cost by
    // this multiple. 0 = disabled. Shares MIN_EDGE_OVER_CHARGES with the morning engine.
    this.minEdgeMultiple = parseFloat(process.env.MIN_EDGE_OVER_CHARGES || 0);
    this.maxStrikeOff  = parseInt(process.env.AFTERNOON_MAX_STRIKE_OFFSET      || 6);
    this.strikeOffset  = parseInt(process.env.STRIKE_OFFSET                    || 1);

    this.paperMode     = (process.env.TRADE_MODE || 'paper') !== 'live';

    // Entry window: 12:00 – 14:30 IST (configurable)
    this.entryStartH   = parseInt(process.env.AFTERNOON_ENTRY_START_HOUR   || 12);
    this.entryStartM   = parseInt(process.env.AFTERNOON_ENTRY_START_MINUTE || 0);
    this.entryEndH     = parseInt(process.env.AFTERNOON_ENTRY_END_HOUR     || 14);
    this.entryEndM     = parseInt(process.env.AFTERNOON_ENTRY_END_MINUTE   || 30);

    // Hard EOD: 15:10 IST (5 min before market close, tighter than morning's 15:15)
    this.eodH = 15;
    this.eodM = 10;

    // Per-instrument auto flag
    const perKey = `${(this.instrumentName || '').toUpperCase()}_AFTERNOON_ENABLED`;
    const perVal = process.env[perKey];
    this.autoEnabled = perVal != null
      ? perVal === 'true'
      : (process.env.AFTERNOON_ENABLED || 'false') === 'true';

    // Premium caps (shared with morning engine's env vars)
    const inst = (this.instrumentName || '').toUpperCase();
    this.maxPremium = parseFloat(process.env[`${inst}_MAX_PREMIUM`] || 0) || null;
    this.minPremium = parseFloat(process.env[`${inst}_MIN_PREMIUM`] || 0) || null;

    // Global risk caps (shared with morning)
    this.maxDailyLossPct = RISK_LIMITS.MAX_DAILY_LOSS_PERCENT / 100;
    this.maxConsecLosses = RISK_LIMITS.MAX_CONSECUTIVE_LOSSES;
    this.maxDrawdownPct  = RISK_LIMITS.MAX_DRAWDOWN_PERCENT / 100;

    // Internal state
    this._tradesToday     = 0;
    this._enteredToday    = false;
    this._todayDate       = '';
    this._consecLosses    = 0;
    this._haltedReason    = null;
    this._peakEquity      = this.capital;
    this._lastScore       = null;
    this._lastDirection   = null;
    this._entryTime       = null;    // for time-stop
    this._lastExitAt      = 0;       // ms timestamp of last exit, for re-entry cooldown
    this._getDailyPnl     = null;    // injected by server
  }

  // ── Reset on new day ─────────────────────────────────────────
  _resetIfNewDay() {
    const d = istNow().toUTCString().slice(0, 16);
    if (d !== this._todayDate) {
      this._todayDate    = d;
      this._enteredToday = false;
      this._tradesToday  = 0;
      this._lastScore    = null;
      this._lastDirection= null;
      this._entryTime    = null;
      this._lastExitAt   = 0;
      if (this._haltedReason === 'DAILY_LOSS') this._haltedReason = null;
    }
  }

  // ── Afternoon scoring — wires existing detectors together ────
  /**
   * Compute the Afternoon Gamma Squeeze score (0-100).
   * Returns { score, direction, breakdown, reasons }
   */
  computeScore() {
    let score = 0;
    let callScore = 0;
    let putScore = 0;
    const breakdown = {};
    const reasons = [];

    // ── 1. Gamma Blast — conviction GATE, not a flat score ──
    // Gamma is directionless: adding it equally to both sides used to (a) let weak
    // directional signals trip the threshold on gamma alone, and (b) inflate false
    // CONFLICT skips exactly when gamma was strongest. Instead, gamma is a MULTIPLIER
    // applied to the winning side's directional confluence below. 0 directional → 0,
    // so gamma can never manufacture a signal; it only amplifies a real one.
    const blast = this.getGammaBlast();
    let gammaMult = 1.0;
    if (blast) {
      switch (blast.blastLevel) {
        case 'NUCLEAR':  gammaMult = 1.4; break;
        case 'EXTREME':  gammaMult = 1.3; break;
        case 'HIGH':     gammaMult = 1.2; break;
        case 'MODERATE': gammaMult = 1.1; break;
        default:         gammaMult = 1.0;
      }
      if (gammaMult > 1.0) {
        reasons.push(`Gamma ${blast.blastLevel} (×${gammaMult} conviction)`);
      }
    }
    breakdown.gammaBlast = { mult: gammaMult, level: blast?.blastLevel || 'NONE' };

    // ── 2. BOS / Rejection trigger (0-25) ──
    const reversals = this.getReversals();
    const now = Date.now();
    const recentWindow = 3 * 60 * 1000; // last 3 minutes
    let revCallPts = 0, revPutPts = 0;

    if (reversals && reversals.length > 0) {
      // Check most recent reversal within 3 min window
      const recent = reversals
        .filter(r => (now - r.at) <= recentWindow)
        .sort((a, b) => b.at - a.at);

      if (recent.length > 0) {
        const r = recent[0];
        const isBOS = r.kind === 'BOS';
        const pts = isBOS ? 25 : 20; // BOS > REJECTION

        if (r.dir === 'BULLISH') {
          revCallPts = pts;
          reasons.push(`${r.kind} BULLISH (${r.movePct.toFixed(2)}%)`);
        } else if (r.dir === 'BEARISH') {
          revPutPts = pts;
          reasons.push(`${r.kind} BEARISH (${r.movePct.toFixed(2)}%)`);
        }
      }
    }
    breakdown.reversal = { callPts: revCallPts, putPts: revPutPts, max: 25 };
    callScore += revCallPts;
    putScore  += revPutPts;

    // ── 3. Max Pain alignment (0-15) ──
    const mp = this.getMaxPain();
    const spot = this.getPrice();
    let mpCallPts = 0, mpPutPts = 0;

    if (mp && mp.maxPainStrike && spot > 0) {
      const maxPainStrike = Number(mp.maxPainStrike);
      const distPct = ((spot - maxPainStrike) / maxPainStrike) * 100;

      if (distPct > 0.1) {
        // Price above max pain, gravity pulls DOWN → PUT bias
        mpPutPts = 15;
        reasons.push(`Max Pain pull DOWN (spot ${distPct.toFixed(2)}% above)`);
      } else if (distPct < -0.1) {
        // Price below max pain, gravity pulls UP → CALL bias
        mpCallPts = 15;
        reasons.push(`Max Pain pull UP (spot ${Math.abs(distPct).toFixed(2)}% below)`);
      } else {
        // Near max pain — weak signal either way
        mpCallPts = 5;
        mpPutPts = 5;
      }
    }
    breakdown.maxPain = { callPts: mpCallPts, putPts: mpPutPts, max: 15 };
    callScore += mpCallPts;
    putScore  += mpPutPts;

    // ── 4. EMA Stack confluence (0-15) ──
    const ema = this.getEmaStack();
    let emaCallPts = 0, emaPutPts = 0;

    if (ema && ema.tactic) {
      switch (ema.tactic) {
        case 'STRONG_UP':
          emaCallPts = 15;
          reasons.push('EMA Stack STRONG_UP');
          break;
        case 'STRONG_DOWN':
          emaPutPts = 15;
          reasons.push('EMA Stack STRONG_DOWN');
          break;
        case 'PULLBACK_UP':
        case 'TREND_CHANGE_UP':
          emaCallPts = 10;
          reasons.push(`EMA ${ema.tactic}`);
          break;
        case 'PULLBACK_DOWN':
        case 'REGIME_CHANGE_DOWN':
          emaPutPts = 10;
          reasons.push(`EMA ${ema.tactic}`);
          break;
        default:
          break;
      }
    }
    breakdown.emaStack = { callPts: emaCallPts, putPts: emaPutPts, max: 15 };
    callScore += emaCallPts;
    putScore  += emaPutPts;

    // ── 5. Pattern momentum (0-15) ──
    const pat = this.getPattern();
    let patCallPts = 0, patPutPts = 0;

    if (pat && pat.name) {
      const patAge = now - (pat.detectedAt || 0);
      const patFresh = patAge < 10 * 60 * 1000; // within 10 min

      if (patFresh) {
        if (pat.name === 'HIGHER_HIGHS') {
          patCallPts = 15;
          reasons.push(`HIGHER_HIGHS (${pat.movePct}%)`);
        } else if (pat.name === 'LOWER_LOWS') {
          patPutPts = 15;
          reasons.push(`LOWER_LOWS (${pat.movePct}%)`);
        }
      }
    }
    breakdown.pattern = { callPts: patCallPts, putPts: patPutPts, max: 15 };
    callScore += patCallPts;
    putScore  += patPutPts;

    // ── Apply gamma conviction multiplier ──
    // Directional confluence (factors 2-5) is amplified by gamma. Conflict is
    // judged on the RAW directional scores so high gamma no longer manufactures
    // false conflicts; the multiplier only scales the chosen side toward threshold.
    const rawCall = callScore;
    const rawPut  = putScore;
    callScore = +(rawCall * gammaMult).toFixed(1);
    putScore  = +(rawPut  * gammaMult).toFixed(1);
    breakdown.directional = { rawCall, rawPut, gammaMult, callScore, putScore };

    // ── Determine direction ──
    let direction = 'WAIT';
    score = Math.max(callScore, putScore);

    if (callScore >= this.scoreThreshold && putScore < this.scoreThreshold) {
      direction = 'CALL';
      score = callScore;
    } else if (putScore >= this.scoreThreshold && callScore < this.scoreThreshold) {
      direction = 'PUT';
      score = putScore;
    } else if (callScore >= this.scoreThreshold && putScore >= this.scoreThreshold) {
      // Both sides clear threshold on real directional confluence — genuine conflict, skip.
      direction = 'WAIT';
      reasons.push('CONFLICT: both CALL and PUT above threshold');
    }

    this._lastScore     = { score, direction, callScore, putScore, rawCall, rawPut, gammaMult, breakdown, reasons, at: now };
    this._lastDirection = direction;

    return { score, direction, callScore, putScore, breakdown, reasons };
  }

  // ── Main tick — called every 5s by server bot loop ───────────
  async tick() {
    this._resetIfNewDay();

    const ist  = istNow();
    const mins = istMins(ist);

    // Hard EOD square-off at 15:10
    if (mins >= this.eodH * 60 + this.eodM) {
      const pos = this.getOpenPosition();
      if (pos) {
        console.log(`[${this.instrumentName}-AFT] 15:10 EOD square-off triggered`);
        await this._exit(pos, pos.currentPrice, 'EOD_SQUAREOFF');
      }
      return;
    }

    // Monitor open position (if any)
    if (this.getOpenPosition()) {
      await this._monitorPosition();
      return;
    }

    // Before entry window → do nothing
    const entryStartMins = this.entryStartH * 60 + this.entryStartM;
    const entryEndMins   = this.entryEndH * 60 + this.entryEndM;
    if (mins < entryStartMins || mins > entryEndMins) return;

    // Don't enter if conditions not met
    if (!this.autoEnabled)          return;
    if (this._enteredToday)         return;
    if (this._tradesToday >= this.maxTrades) return;
    // ADR-003: refresh the durable halt from state (survives restart) before blocking.
    { const durable = this._isDurablyHalted(); if (durable) this._haltedReason = durable; }
    if (this._haltedReason)         return;
    // Re-entry cooldown: wait N minutes after the last exit before taking another trade.
    if (this.reentryCooldownMins > 0 && this._lastExitAt) {
      const sinceExitMins = (Date.now() - this._lastExitAt) / 60000;
      if (sinceExitMins < this.reentryCooldownMins) return;
    }

    // Live mode + expired token → pause
    if (!this.paperMode && this._isTokenExpired()) {
      if (!this._tokenWarnedAt || Date.now() - this._tokenWarnedAt > 60000) {
        console.warn(`[${this.instrumentName}-AFT] ⛔ Dhan token EXPIRED — afternoon entry paused`);
        this._tokenWarnedAt = Date.now();
      }
      return;
    }

    // Global daily loss limit (combines morning + afternoon P&L)
    if (this._getDailyPnl) {
      const morningPnl = this.getMorningPnl();
      const afternoonPnl = this._getDailyPnl();
      const totalDayPnl = morningPnl + afternoonPnl;
      const totalCapital = this.capital + (this.reserve || 0);
      if (totalDayPnl < -(totalCapital * this.maxDailyLossPct)) {
        if (this.autoEnabled) {
          this.autoEnabled = false;
          this._haltedReason = 'DAILY_LOSS';
          console.warn(`[${this.instrumentName}-AFT] ⛔ Global daily loss limit hit (₹${(-totalDayPnl).toFixed(0)}) — afternoon DISABLED`);
        }
        return;
      }
    }

    // Compute afternoon score
    const { score, direction } = this.computeScore();

    if (direction === 'CALL' || direction === 'PUT') {
      console.log(`[${this.instrumentName}-AFT] 🌅 Afternoon signal: ${direction} score=${score} — attempting entry`);
      await this._enter(direction, score);
    }
  }

  // ── Token expiry check (same as morning engine) ──────────────
  _isTokenExpired() {
    try {
      const token = process.env.DHAN_ACCESS_TOKEN || '';
      const parts = token.split('.');
      if (parts.length !== 3) return true;
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(Buffer.from(b64, 'base64').toString());
      return !payload.exp || payload.exp * 1000 <= Date.now();
    } catch (_) {
      return true;
    }
  }

  // ── Find option via strike walk (same algorithm as morning) ──
  async _getOption(signal) {
    const spot = this.getPrice();
    const atm  = Math.round(spot / this.atmRound) * this.atmRound;
    const type = signal === 'CALL' ? 'CE' : 'PE';
    const inst = this.instrumentName.toUpperCase();
    const MAX_PREM = parseFloat(process.env[`${inst}_MAX_PREMIUM`] || 0) || null;
    const MIN_PREM = parseFloat(process.env[`${inst}_MIN_PREMIUM`] || 0) || null;

    let chain = null;
    try { chain = await this._getChain(spot); }
    catch (err) { console.warn(`[${this.instrumentName}-AFT] chain fetch failed:`, err.message); }

    // Afternoon uses tighter OTM range (ATM+1 to ATM+6)
    const startOff = Math.max(1, this.strikeOffset);
    const maxOff = this.maxStrikeOff;

    for (let off = startOff; off <= maxOff; off++) {
      const signedOff = signal === 'CALL' ? off : -off;
      const strike    = atm + signedOff * this.strikeInterval;
      const row       = chain?.strikes?.find(s => Number(s.strike) === Number(strike));
      const side      = row ? (signal === 'CALL' ? row.ce : row.pe) : null;
      const ltp       = side?.ltp;

      if (!side?.securityId || !ltp || ltp <= 0) {
        console.log(`[${this.instrumentName}-AFT] off=${off} ${strike}${type} — no live data, walk further`);
        continue;
      }
      if (MAX_PREM && ltp > MAX_PREM) {
        console.log(`[${this.instrumentName}-AFT] off=${off} ${strike}${type} ₹${ltp.toFixed(2)} > cap ₹${MAX_PREM} — walk deeper OTM`);
        continue;
      }
      if (MIN_PREM && ltp < MIN_PREM) {
        console.log(`[${this.instrumentName}-AFT] off=${off} ${strike}${type} ₹${ltp.toFixed(2)} < floor ₹${MIN_PREM} — too cheap, stop walk`);
        break;
      }
      console.log(`[${this.instrumentName}-AFT] off=${off} ${strike}${type} ₹${ltp.toFixed(2)} ✓ fits caps`);
      return { strike, type, securityId: side.securityId, ltp };
    }

    const fallbackStrike = atm + (signal === 'CALL' ? this.strikeOffset : -this.strikeOffset) * this.strikeInterval;
    return { strike: fallbackStrike, type, securityId: null, ltp: null };
  }

  async _getChain(spot) {
    if (this.instrumentName === 'NIFTY') {
      return this.live.getNiftyOptionChain(spot);
    }
    return this.live.getOptionChain(spot);
  }

  // ── Enter trade ─────────────────────────────────────────────
  async _enter(signal, score) {
    console.log(`[${this.instrumentName}-AFT] 🌅 Signal ${signal} (score=${score}) — attempting entry`);

    const { strike, type, securityId, ltp } = await this._getOption(signal);
    if (!ltp || ltp <= 0) {
      console.warn(`[${this.instrumentName}-AFT] Could not determine option LTP — skipping`);
      return;
    }
    if (!securityId) {
      console.warn(`[${this.instrumentName}-AFT] SKIP — no real chain securityId for ${strike}${type}`);
      return;
    }
    if (this.maxPremium && ltp > this.maxPremium) {
      console.log(`[${this.instrumentName}-AFT] SKIP — LTP ₹${ltp.toFixed(2)} > cap ₹${this.maxPremium}`);
      return;
    }
    if (this.minPremium && ltp < this.minPremium) {
      console.log(`[${this.instrumentName}-AFT] SKIP — LTP ₹${ltp.toFixed(2)} < floor ₹${this.minPremium}`);
      return;
    }

    // Position sizing
    const riskAmount = this.capital * this.riskPct;
    const lots       = Math.max(1, Math.floor(riskAmount / (ltp * this.lotSize)));
    const quantity   = lots * this.lotSize;
    const deployed   = lots * ltp * this.lotSize;
    console.log(`[${this.instrumentName}-AFT] Sizing: equity ₹${this.capital.toFixed(0)} × ${(this.riskPct*100).toFixed(1)}% = ₹${riskAmount.toFixed(0)} → ${lots} lot(s) @ ₹${ltp.toFixed(2)} = ₹${deployed.toFixed(0)}`);

    // Charge-aware guard — skip if expected gain at target can't clear the
    // round-trip cost by the configured margin. Disabled when MIN_EDGE_OVER_CHARGES=0.
    if (this.minEdgeMultiple > 0) {
      const targetExit   = ltp * this.targetMult;
      const expectedGain = deployed * (this.targetMult - 1);
      const { total: rtCost } = roundTripCharges(ltp, targetExit, quantity);
      if (expectedGain < rtCost * this.minEdgeMultiple) {
        console.log(`[${this.instrumentName}-AFT] SKIP — charge guard: expected gain ₹${expectedGain.toFixed(0)} < ₹${rtCost.toFixed(0)} round-trip × ${this.minEdgeMultiple} (${strike}${type} @ ₹${ltp.toFixed(2)}, ${lots} lot)`);
        return;
      }
    }

    // Place order
    let orderId = `PAPER-AFT-${Date.now()}`;

    /* TWO KEYS. docs/085, docs/089 §1D.
         KEY 1  TRADE_MODE — this component may act at all
         KEY 2  ALLOW_LIVE — it may reach a broker

       One key gives you PAPER, not live: without key 2 the entry falls through
       and is recorded as a paper trade, loudly. Returning instead would silently
       drop a signal the engine believed in, and the operator would be debugging a
       missing trade rather than a missing flag.

       The EXIT path has no key 2, deliberately: an exit that needs a permission
       is a position that cannot be closed during the incident that made closing
       necessary — the same reason flatten.js is exempt. */
    const _perm = !this.paperMode
      ? maySendLive({ capability: true, capabilityFlag: 'TRADE_MODE', liveFlag: 'ALLOW_LIVE' })
      : { allowed: false, reason: 'paper mode', key: 1 };
    if (!this.paperMode && !_perm.allowed) {
      console.warn(`[${this.instrumentName}] LIVE ENTRY BLOCKED — ${_perm.reason}. Recording as paper.`);
    }

    if (!this.paperMode && _perm.allowed && securityId) {
      try {
        /* Phase 2.3 — through the chokepoint. An ENTRY adds risk, so it is
           evaluated in full and may be refused. A refusal returns; there is no
           other route to the broker from here. */
        const res = await placeGuarded({
          broker: this.broker,
          intent: {
            strategy: 'AFTERNOON', instrument: this.instrumentName,
            strike, optionType: type, side: 'BUY',
            expiry: safeExpiry(this.instrumentName),
            stopDistance: ltp * (this.slPct || 0),
            lotSize: this.lotSize, requestedLots: lots,
            marginVerdict: this.getMarginVerdict ? this.getMarginVerdict({ instrument: this.instrumentName, strike, type, lots }) : null,
          },
          state: this.getRiskState ? this.getRiskState() : null,
          order: {
            securityId,
            exchangeSegment: this.exchangeSegment,
            transactionType: 'BUY',
            productType:     'INTRADAY',
            orderType:       'MARKET',
            quantity
          },
        });
        orderId = res.orderId || orderId;
        console.log(`[${this.instrumentName}-AFT] LIVE BUY order placed: ${orderId}`);
      } catch (err) {
        console.error(`[${this.instrumentName}-AFT] Order placement failed (${err.code || 'ERROR'}):`, err.message);
        return;
      }
    } else {
      console.log(`[${this.instrumentName}-AFT] PAPER BUY ${quantity} × ${strike}${type} @ ${ltp.toFixed(1)}`);
    }

    // Slippage
    const slipPct = parseFloat(process.env.SLIPPAGE_PERCENT || 2) / 100;
    const filledEntry = ltp * (1 + slipPct);

    const pos = {
      instrument:   this.instrumentName,
      session:      'AFTERNOON',
      signal,
      type,
      strike,
      securityId,
      quotedEntry:  ltp,
      slippagePct:  slipPct,
      entryPrice:   filledEntry,
      currentPrice: ltp,
      lots,
      quantity,
      deployed,
      orderId,
      enteredAt:    new Date().toISOString(),
      sl:           filledEntry * (1 - this.slPct),
      trailAt:      filledEntry * this.trailMult,
      trailLocked:  false,
      lockedFloor:  null,
      peakPrice:    filledEntry,
      movingStop:   filledEntry * (1 - this.slPct),
      autoMovingStop: true,
      status:       'OPEN',
      paperMode:    this.paperMode,
      score,
      scoreBreakdown: this._lastScore?.breakdown || null
    };

    this.setOpenPosition(pos);
    this._tradesToday++;
    this._enteredToday = true;
    this._entryTime = Date.now();

    console.log(`[${this.instrumentName}-AFT] 🌅 ENTERED ${signal} ${strike}${type} @ ${ltp.toFixed(1)} | ${lots} lots | deployed ₹${deployed.toFixed(0)} | SL ${pos.sl.toFixed(1)} | score ${score}`);

    // Notify server for telegram alert
    if (this.onTradeEvent) {
      try { this.onTradeEvent('ENTRY', pos); } catch (_) {}
    }
  }

  // ── Monitor open position ───────────────────────────────────
  async _monitorPosition() {
    const pos = this.getOpenPosition();
    if (!pos) return;

    let ltp = pos.currentPrice;
    try {
      const spot  = this.getPrice();
      const chain = await this._getChain(spot);
      const row   = chain?.strikes?.find(s => Number(s.strike) === Number(pos.strike));
      if (row) {
        const side = pos.type === 'CE' ? row.ce : row.pe;
        if (side?.ltp > 0) ltp = side.ltp;
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
      console.log(`[${this.instrumentName}-AFT] TRAIL LOCKED @ ${pos.lockedFloor.toFixed(1)}`);
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

    // Target hit
    if (mult >= this.targetMult) {
      console.log(`[${this.instrumentName}-AFT] TARGET HIT ${mult.toFixed(2)}x`);
      return this._exit(pos, ltp, 'TARGET');
    }

    // Trail stop
    if (pos.trailLocked && ltp < pos.lockedFloor) {
      console.log(`[${this.instrumentName}-AFT] TRAIL STOP hit @ ${ltp.toFixed(1)} (floor ${pos.lockedFloor.toFixed(1)})`);
      return this._exit(pos, ltp, 'TRAIL_STOP');
    }

    // Stop loss
    if (ltp <= pos.sl) {
      console.log(`[${this.instrumentName}-AFT] STOP LOSS hit @ ${ltp.toFixed(1)}`);
      return this._exit(pos, ltp, 'STOP_LOSS');
    }

    // Time stop — if no meaningful move within timeStopMins, exit
    if (this._entryTime && this.timeStopMins > 0) {
      const elapsedMin = (Date.now() - this._entryTime) / 60000;
      if (elapsedMin >= this.timeStopMins && mult < 1.1 && mult > 0.9) {
        console.log(`[${this.instrumentName}-AFT] TIME STOP after ${elapsedMin.toFixed(0)}m (mult=${mult.toFixed(2)}x, neither SL nor profit)`);
        return this._exit(pos, ltp, 'TIME_STOP');
      }
    }

    pos.mult   = mult.toFixed(3);
    pos.pnlPct = pnlPct;
    pos.pnlAbs = pnlAbs;
    this.setOpenPosition(pos);
  }

  // ── Exit trade ──────────────────────────────────────────────
  async _exit(pos, rawExitPrice, reason) {
    const slipPct = pos.slippagePct ?? (parseFloat(process.env.SLIPPAGE_PERCENT || 2) / 100);
    const exitPrice = rawExitPrice * (1 - slipPct);

    if (!this.paperMode && pos.securityId) {
      try {
        /* Phase 2.3 — through the chokepoint as a REDUCING order: recorded and
           counted, never refused. Blocking an exit would hold the position open
           in exactly the conditions that caused the block. */
        if (!this.broker) throw Object.assign(new Error('no guarded broker wired for exit'), { code: 'ORDER_NO_BROKER' });
        const _d = this.broker.approveReducing({
          strategy: 'AFTERNOON', instrument: this.instrumentName,
          strike: pos.strike, optionType: pos.type, side: 'SELL',
          requestedLots: pos.lots ?? null,
        });
        await this.broker.placeOrder({
          instrument:      this.instrumentName,
          strike:          pos.strike,
          optionType:      pos.type,
          side:            'SELL',
          lots:            pos.lots ?? null,
          securityId:      pos.securityId,
          exchangeSegment: this.exchangeSegment,
          transactionType: 'SELL',
          productType:     'INTRADAY',
          orderType:       'MARKET',
          quantity:        pos.quantity,
          approval:        _d.approval,
        });
        console.log(`[${this.instrumentName}-AFT] LIVE SELL order placed`);
      } catch (err) {
        console.error(`[${this.instrumentName}-AFT] Exit order failed:`, err.message);
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
    this._entryTime = null;
    this._lastExitAt = Date.now();   // start re-entry cooldown clock
    // Allow re-entry up to maxTrades. The entry-window check (≤ entryEndMins) and
    // EOD square-off (15:10) still prevent late re-entries; _tradesToday caps the count.
    this._enteredToday = false;

    // Update equity + streaks
    this.recordTradeResult({ pnl: parseFloat(pnlAbs) });

    const emoji = mult >= 1 ? '✅' : '❌';
    console.log(`[${this.instrumentName}-AFT] ${emoji} EXIT ${reason} | ${pos.signal} ${pos.strike}${pos.type} | ${mult.toFixed(2)}x | ${pnlPct}% | ₹${pnlAbs}`);

    // Notify server for telegram alert
    if (this.onTradeEvent) {
      try { this.onTradeEvent('EXIT', closed); } catch (_) {}
    }
  }

  // ── Half-compound equity tracking ───────────────────────────
  recordTradeResult({ pnl }) {
    const PROFIT_REINVEST_PCT = Number(process.env.PROFIT_REINVEST_PCT || 0.5);
    if (this.reserve == null) this.reserve = 0;

    if (pnl > 0) {
      const toReserve = pnl * (1 - PROFIT_REINVEST_PCT);
      this.capital += pnl - toReserve;
      this.reserve += toReserve;
    } else {
      this.capital += pnl;
    }
    console.log(`[${this.instrumentName}-AFT] Equity: active ₹${this.capital.toFixed(0)} reserve ₹${this.reserve.toFixed(0)} total ₹${(this.capital + this.reserve).toFixed(0)}`);

    // Drawdown circuit
    const totalEquity = this.capital + (this.reserve || 0);
    if (totalEquity > this._peakEquity) this._peakEquity = totalEquity;
    const drawdown = (this._peakEquity - totalEquity) / this._peakEquity;
    if (drawdown > this.maxDrawdownPct && this.autoEnabled) {
      this.autoEnabled = false;
      this._haltedReason = 'DRAWDOWN';
      console.warn(`[${this.instrumentName}-AFT] ⛔ Max drawdown ${(drawdown*100).toFixed(1)}% — afternoon DISABLED`);
    }

    // Persist
    try {
      const _path = require('path');
      const file = _path.resolve(`./data/equity-${this.instrumentName.toLowerCase()}-afternoon.json`);
      // C3: this is RISK-BRAKE state (capital + consecLosses). Atomic + .bak.
      require('./safe-write.js').writeJsonSync(file, {
        capital: this.capital, reserve: this.reserve,
        consecLosses: this._consecLosses, peakEquity: this._peakEquity,  // ADR-003: peak persisted so drawdown-halt survives restart
        updatedAt: new Date().toISOString()
      }, { pretty: true, backup: true });
    } catch (e) { console.warn(`[${this.instrumentName}-AFT] equity persist failed: ${e.message}`); }

    // Consecutive loss tracking
    if (pnl > 0) {
      this._consecLosses = 0;
    } else {
      this._consecLosses++;
      console.log(`[${this.instrumentName}-AFT] ⚠️ Loss — consecutive: ${this._consecLosses}/${this.maxConsecLosses}`);
      if (this._consecLosses >= this.maxConsecLosses) {
        this._haltedReason = 'CONSEC_LOSSES';
        this.autoEnabled = false;
        console.warn(`[${this.instrumentName}-AFT] ⛔ HALT: ${this._consecLosses} losses in a row — afternoon DISABLED`);
      }
    }
  }

  // ── Restore equity from disk ────────────────────────────────
  restoreEquity() {
    // C3, FAIL-CLOSED FIX. The old code swallowed a corrupt equity file, which reset
    // consecLosses to 0 — SILENTLY DISARMING the halt-after-N-losses brake. For a risk
    // brake, "state unknown" must mean "brake ON": if the file exists but cannot be
    // read or recovered, the engine HALTS and says so, instead of trading on.
    try {
      const _fs = require('fs'); const _path = require('path');
      const file = _path.resolve(`./data/equity-${this.instrumentName.toLowerCase()}-afternoon.json`);
      if (!_fs.existsSync(file)) return;
      const s = require('./safe-write.js').readJsonSync(file, {
        onRecover: (reason, bak) => console.warn(`[${this.instrumentName}-AFT] equity state was corrupt (${reason}); recovered from ${bak}.`),
      });
      const ageMs = Date.now() - new Date(s.updatedAt || 0).getTime();
      if (ageMs > 30 * 24 * 3600 * 1000) return;
      if (Number.isFinite(s.capital))      this.capital      = s.capital;
      if (Number.isFinite(s.reserve))      this.reserve      = s.reserve;
      if (Number.isFinite(s.consecLosses)) this._consecLosses = s.consecLosses;
      if (Number.isFinite(s.peakEquity))   this._peakEquity  = s.peakEquity;   // ADR-003: restore peak so drawdown-halt survives restart
      console.log(`[${this.instrumentName}-AFT] 📥 Restored afternoon equity: active ₹${this.capital.toFixed(0)} + reserve ₹${(this.reserve||0).toFixed(0)}`);
    } catch (e) {
      this._haltedReason = 'EQUITY_STATE_CORRUPT';
      this.autoEnabled = false;
      console.error(`[${this.instrumentName}-AFT] ⛔ EQUITY STATE UNRECOVERABLE: ${e.message}`);
      console.error(`[${this.instrumentName}-AFT] ⛔ Cannot know the loss streak — HALTING (fail closed). resetHalt() clears after manual review.`);
    }
  }

  // ── Manual reset of halt ────────────────────────────────────
  resetHalt() {
    const was = { consecLosses: this._consecLosses, haltedReason: this._haltedReason };
    this._consecLosses = 0;
    this._haltedReason = null;
    const perKey = `${(this.instrumentName || '').toUpperCase()}_AFTERNOON_ENABLED`;
    const perVal = process.env[perKey];
    this.autoEnabled = perVal != null ? perVal === 'true' : (process.env.AFTERNOON_ENABLED || 'false') === 'true';
    console.log(`[${this.instrumentName}-AFT] 🔓 Afternoon halt cleared. Auto = ${this.autoEnabled}`);
    return was;
  }

  // ── Manual test entry ───────────────────────────────────────
  async forceEntry(signal, { allowLive = false } = {}) {
    if (!this.paperMode && !allowLive) {
      return { ok: false, error: 'forceEntry blocked in LIVE mode' };
    }
    if (this.getOpenPosition()) {
      return { ok: false, error: 'afternoon position already open' };
    }
    if (signal !== 'CALL' && signal !== 'PUT') {
      return { ok: false, error: 'signal must be CALL or PUT' };
    }
    console.log(`[${this.instrumentName}-AFT] 🧪 MANUAL TEST afternoon entry: ${signal}`);
    await this._enter(signal, 99);
    const pos = this.getOpenPosition();
    return pos
      ? { ok: true, position: pos }
      : { ok: false, error: 'afternoon entry did not open — check logs' };
  }

  // ── Config getters/setters ──────────────────────────────────
  // ADR-003: durable halts are a pure function of persisted state (consecLosses +
  // peakEquity survive a restart). Session DAILY_LOSS is handled separately.
  _isDurablyHalted() {
    if (this._haltedReason === 'EQUITY_STATE_CORRUPT') return 'EQUITY_STATE_CORRUPT';
    if (this._consecLosses >= this.maxConsecLosses)    return 'CONSEC_LOSSES';
    const eq = this.capital + (this.reserve || 0);
    if (this._peakEquity > 0 && (this._peakEquity - eq) / this._peakEquity > this.maxDrawdownPct) return 'DRAWDOWN';
    return null;
  }

  setAutoEnabled(v) {
    // ADR-003 invariant: never arm auto while durably halted.
    const durable = v && this._isDurablyHalted();
    this.autoEnabled = !!v && !durable;
    if (durable) console.warn(`[${this.instrumentName}-AFT] ⛔ refused to arm auto — halted (${durable}). resetHalt() after review.`);
    else console.log(`[${this.instrumentName}-AFT] autoEnabled=${this.autoEnabled} | paper=${this.paperMode}`);
  }

  setTradeMode(mode) {
    this.paperMode = mode !== 'live';
    console.log(`[${this.instrumentName}-AFT] tradeMode=${mode} | paper=${this.paperMode}`);
  }

  status() {
    return {
      instrument:   this.instrumentName,
      session:      'AFTERNOON',
      autoEnabled:  this.autoEnabled,
      paperMode:    this.paperMode,
      capital:      +this.capital.toFixed(0),
      reserve:      +(this.reserve || 0).toFixed(0),
      riskPct:      +(this.riskPct * 100).toFixed(1),
      lotSize:      this.lotSize,
      sl:           +(this.slPct * 100).toFixed(1),
      trailMult:    this.trailMult,
      targetMult:   this.targetMult,
      scoreThreshold: this.scoreThreshold,
      entryWindow:  `${this.entryStartH}:${String(this.entryStartM).padStart(2,'0')}-${this.entryEndH}:${String(this.entryEndM).padStart(2,'0')}`,
      timeStopMins: this.timeStopMins,
      tradesToday:  this._tradesToday,
      maxTrades:    this.maxTrades,
      enteredToday: this._enteredToday,
      lastScore:    this._lastScore
    };
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

  getConfig() {
    return {
      AFTERNOON_STOP_LOSS_PERCENT:    +(this.slPct * 100).toFixed(2),
      AFTERNOON_TARGET_PERCENT:       +((this.targetMult - 1) * 100).toFixed(2),
      AFTERNOON_TRAIL_AFTER_MULTIPLE: +this.trailMult.toFixed(2),
      AFTERNOON_TRAIL_LOCK_PERCENT:   +(this.trailLockPct * 100).toFixed(2),
      AFTERNOON_SCORE_THRESHOLD:      this.scoreThreshold,
      AFTERNOON_MAX_TRADES:           this.maxTrades,
      AFTERNOON_TIME_STOP_MINUTES:    this.timeStopMins,
      AFTERNOON_REENTRY_COOLDOWN_MINUTES: this.reentryCooldownMins,
      AFTERNOON_CAPITAL_PCT:          +(this.capital / (parseFloat(process.env.CAPITAL_TOTAL || 100000)) * 100).toFixed(1)
    };
  }

  setConfig(partial) {
    const applied = {};
    const num = (v) => { const n = Number(v); return isFinite(n) ? n : null; };
    if (partial.AFTERNOON_STOP_LOSS_PERCENT    != null && num(partial.AFTERNOON_STOP_LOSS_PERCENT)    != null) { this.slPct          = num(partial.AFTERNOON_STOP_LOSS_PERCENT) / 100;    applied.AFTERNOON_STOP_LOSS_PERCENT    = num(partial.AFTERNOON_STOP_LOSS_PERCENT); }
    if (partial.AFTERNOON_TARGET_PERCENT       != null && num(partial.AFTERNOON_TARGET_PERCENT)       != null) { this.targetMult     = num(partial.AFTERNOON_TARGET_PERCENT) / 100 + 1;   applied.AFTERNOON_TARGET_PERCENT       = num(partial.AFTERNOON_TARGET_PERCENT); }
    if (partial.AFTERNOON_TRAIL_AFTER_MULTIPLE != null && num(partial.AFTERNOON_TRAIL_AFTER_MULTIPLE) != null) { this.trailMult      = num(partial.AFTERNOON_TRAIL_AFTER_MULTIPLE);       applied.AFTERNOON_TRAIL_AFTER_MULTIPLE = num(partial.AFTERNOON_TRAIL_AFTER_MULTIPLE); }
    if (partial.AFTERNOON_TRAIL_LOCK_PERCENT   != null && num(partial.AFTERNOON_TRAIL_LOCK_PERCENT)   != null) { this.trailLockPct   = num(partial.AFTERNOON_TRAIL_LOCK_PERCENT) / 100;   applied.AFTERNOON_TRAIL_LOCK_PERCENT   = num(partial.AFTERNOON_TRAIL_LOCK_PERCENT); }
    if (partial.AFTERNOON_SCORE_THRESHOLD      != null && num(partial.AFTERNOON_SCORE_THRESHOLD)      != null) { this.scoreThreshold = num(partial.AFTERNOON_SCORE_THRESHOLD);             applied.AFTERNOON_SCORE_THRESHOLD      = num(partial.AFTERNOON_SCORE_THRESHOLD); }
    return applied;
  }
}

module.exports = AfternoonEngine;
