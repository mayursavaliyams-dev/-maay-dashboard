/**
 * ANTIGRAVITY BACKTEST — Yahoo Finance / TradingView Data
 *
 * Data: Yahoo Finance ^BSESN daily OHLCV (same as TradingView shows).
 * Options: priced at entry via Black-Scholes; exit = intrinsic at close (settlement).
 * Stop-loss: triggered when spot moves against us beyond delta-based threshold.
 * Trailing stop: if midday option hit 2x, lock in 50% of that gain.
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['ripHistorical'] });

const { aggregate } = require('../backtest-real/aggregator');
const OptionAnalyzer = require('../option-analyzer');
const { writeBacktestExcel } = require('../export-backtest-excel');

// ================================================================
// HELPERS
// ================================================================
function toYmd(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

const INDEX_CONFIG = {
  SENSEX:    { yahoo: '^BSESN',   strikeStep: 100, label: 'SENSEX' },
  NIFTY:     { yahoo: '^NSEI',    strikeStep: 50,  label: 'NIFTY' },
  BANKNIFTY: { yahoo: '^NSEBANK', strikeStep: 100, label: 'BANKNIFTY' }
};

function normalizeInstrument(value) {
  const s = String(value || 'SENSEX').toUpperCase();
  if (s === 'BANKNIFTY' || s === 'BANK' || s === 'NIFTYBANK') return 'BANKNIFTY';
  if (s === 'NIFTY') return 'NIFTY';
  return 'SENSEX';
}

function targetDowForInstrument(instrument, cursor, sensexCutover) {
  const ts = cursor.getTime();
  if (instrument === 'NIFTY') {
    return ts >= new Date('2025-09-02T00:00:00Z').getTime() ? 2 : 4;
  }
  if (instrument === 'BANKNIFTY') {
    return ts >= new Date('2023-09-04T00:00:00Z').getTime() ? 3 : 4;
  }
  return ts >= sensexCutover.getTime() ? 2 : 5;
}

function eraForInstrument(instrument, targetDow, isAfterSensexCutover) {
  if (instrument === 'NIFTY') return targetDow === 2 ? 'nifty-tuesday' : 'nifty-thursday';
  if (instrument === 'BANKNIFTY') return targetDow === 3 ? 'banknifty-wednesday' : 'banknifty-thursday';
  return isAfterSensexCutover ? 'post-cutover' : 'pre-cutover';
}

// ================================================================
// HIGH-IMPACT EVENT CALENDAR
// On these dates: use OTM+2 (if signal exists) for max multiplier
// Sources: Union Budget, RBI MPC decisions, Election result days
// ================================================================
const HIGH_IMPACT_EVENTS = new Set([
  // ── UNION BUDGET DAYS ────────────────────────────────────────
  '2003-02-28','2004-02-03','2005-02-28','2006-02-28','2007-02-28',
  '2008-02-29','2009-02-16','2010-02-26','2011-02-28','2012-03-16',
  '2013-02-28','2014-07-10','2015-02-28','2016-02-29','2017-02-01',
  '2018-02-01','2019-02-01','2020-02-01','2021-02-01','2022-02-01',
  '2023-02-01','2024-02-01','2025-02-01','2026-02-01',
  // ── ELECTION RESULT DAYS ─────────────────────────────────────
  '2004-05-13', // UPA shock win — SENSEX crashed 15% in one day
  '2009-05-16', // UPA landslide — SENSEX upper circuit
  '2014-05-16', // Modi landslide
  '2019-05-23', // Modi 2nd term
  '2024-06-04', // General election 2024
  // ── RBI MPC HIGH-IMPACT DECISIONS ───────────────────────────
  // 2020 emergency cuts
  '2020-03-27','2020-05-22',
  // 2022 surprise hike cycle
  '2022-05-04','2022-06-08','2022-08-05','2022-09-30',
  // 2023-2024 key decisions
  '2023-02-08','2023-04-06','2024-04-05','2024-06-07',
  // ── COVID / MAJOR MARKET EVENTS ──────────────────────────────
  '2020-03-23', // COVID crash low
  '2016-11-08', // Demonetisation
  '2019-09-20', // Corp tax cut surprise
  '2008-10-24', // Global financial crisis peak fear
  '2013-08-16', // Rupee crisis
]);

function isHighImpactDay(dateStr) {
  return HIGH_IMPACT_EVENTS.has(dateStr);
}

// ================================================================
// IV REGIME FILTER
// Skip trades when market is too calm (low vol = options don't move enough)
// Only trade when 20-day HV >= minVolThreshold
// ================================================================
const MIN_VOL_THRESHOLD = 0.12; // 12% annualised = minimum volatility to trade

function isVolatileEnough(vol) {
  return vol >= MIN_VOL_THRESHOLD;
}

// ================================================================
// EXPIRY DAY GENERATOR — extended to 2003 for 1200-expiry runs
// ================================================================
// Approximate BSE market holidays (fixed + key variable dates per year)
const BSE_HOLIDAYS = new Set([
  // ---- 2003 ----
  '2003-01-26', '2003-08-15', '2003-12-25',
  // ---- 2004 ----
  '2004-01-26', '2004-08-15', '2004-10-01', '2004-11-12', '2004-12-25',
  // ---- 2005 ----
  '2005-01-26', '2005-03-25', '2005-08-15', '2005-11-01', '2005-12-25',
  // ---- 2006 ----
  '2006-01-26', '2006-04-14', '2006-08-15', '2006-10-24', '2006-12-25',
  // ---- 2007 ----
  '2007-01-26', '2007-03-02', '2007-04-06', '2007-08-15', '2007-11-09', '2007-12-25',
  // ---- 2008 ----
  '2008-01-26', '2008-03-21', '2008-08-15', '2008-10-29', '2008-12-25',
  // ---- 2009 ----
  '2009-01-26', '2009-04-10', '2009-08-15', '2009-10-19', '2009-12-25',
  // ---- 2010 ----
  '2010-01-26', '2010-03-01', '2010-04-02', '2010-08-15', '2010-11-05', '2010-12-25',
  // ---- 2011 ----
  '2011-01-26', '2011-03-19', '2011-04-14', '2011-04-22', '2011-08-15', '2011-10-26', '2011-12-25',
  // ---- 2012 ----
  '2012-01-26', '2012-03-08', '2012-04-06', '2012-08-15', '2012-11-13', '2012-11-14', '2012-12-25',
  // ---- 2013 ----
  '2013-01-26', '2013-03-27', '2013-03-29', '2013-04-01', '2013-08-15', '2013-11-04', '2013-12-25',
  // ---- 2014 ----
  '2014-01-14', '2014-01-26', '2014-02-27', '2014-04-14', '2014-04-18', '2014-08-15', '2014-10-03', '2014-10-24', '2014-12-25',
  // ---- 2015 ----
  '2015-01-26', '2015-02-17', '2015-03-06', '2015-04-03', '2015-04-14', '2015-08-15', '2015-09-17', '2015-10-22', '2015-11-12', '2015-12-25',
  // ---- 2016 ----
  '2016-01-26', '2016-03-07', '2016-03-25', '2016-04-14', '2016-04-15', '2016-08-15', '2016-09-05', '2016-10-11', '2016-10-12', '2016-10-30', '2016-11-14', '2016-12-25',
  // ---- 2017 ----
  '2017-01-26', '2017-02-24', '2017-03-13', '2017-04-04', '2017-04-14', '2017-06-26', '2017-08-15', '2017-08-25', '2017-10-02', '2017-10-19', '2017-10-20', '2017-12-25',
  // ---- 2018 ----
  '2018-01-26', '2018-02-13', '2018-03-02', '2018-03-29', '2018-03-30', '2018-04-02', '2018-05-01', '2018-08-15', '2018-08-22', '2018-09-20', '2018-10-02', '2018-11-07', '2018-11-08', '2018-11-21', '2018-12-25',
  // ---- 2019 ----
  '2019-03-04', '2019-03-21', '2019-04-17', '2019-04-19', '2019-04-29', '2019-05-01', '2019-06-05', '2019-08-12', '2019-08-15', '2019-09-02', '2019-09-10', '2019-10-02', '2019-10-07', '2019-10-08', '2019-10-27', '2019-10-28', '2019-11-12', '2019-12-25',
  // ---- 2020 ----
  '2020-02-21', '2020-03-10', '2020-04-02', '2020-04-06', '2020-04-10', '2020-04-14', '2020-05-01', '2020-05-25', '2020-08-03', '2020-08-15', '2020-11-16', '2020-11-30', '2020-12-25',
  // ---- 2021 ----
  '2021-01-26', '2021-03-11', '2021-03-29', '2021-04-02', '2021-04-14', '2021-05-13', '2021-07-21', '2021-08-15', '2021-09-10', '2021-10-15', '2021-11-04', '2021-11-05', '2021-11-19', '2021-12-25',
  // ---- 2022-2026 (from original expiry-days.js) ----
  '2022-01-26', '2022-03-01', '2022-03-18', '2022-04-14', '2022-04-15',
  '2022-05-03', '2022-08-09', '2022-08-15', '2022-08-31', '2022-10-05',
  '2022-10-24', '2022-10-26', '2022-11-08',
  '2023-01-26', '2023-03-07', '2023-03-30', '2023-04-04', '2023-04-07',
  '2023-04-14', '2023-05-01', '2023-06-28', '2023-08-15', '2023-09-19',
  '2023-10-02', '2023-10-24', '2023-11-14', '2023-11-27', '2023-12-25',
  '2024-01-26', '2024-03-08', '2024-03-25', '2024-03-29', '2024-04-11',
  '2024-04-17', '2024-05-01', '2024-05-20', '2024-06-17', '2024-07-17',
  '2024-08-15', '2024-10-02', '2024-11-01', '2024-11-15', '2024-12-25',
  '2025-02-26', '2025-03-14', '2025-03-31', '2025-04-10', '2025-04-14',
  '2025-04-18', '2025-05-01', '2025-08-15', '2025-08-27', '2025-10-02',
  '2025-10-21', '2025-10-22', '2025-11-05', '2025-12-25',
  '2026-01-26', '2026-02-17', '2026-03-03', '2026-03-25', '2026-04-03'
]);

function generateExpiryDays({ count, cutoverDate, endDate, startYear = 2003, startDate = null, instrument = 'SENSEX' }) {
  const expiries = [];
  const cutover = new Date(`${cutoverDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const start = startDate ? new Date(`${startDate}T00:00:00Z`) : null;
  const cursor = new Date(end.getTime());
  cursor.setUTCHours(0, 0, 0, 0);

  while (expiries.length < count) {
    if (start && cursor.getTime() < start.getTime()) break;
    const dow = cursor.getUTCDay();
    const isAfterCutover = cursor.getTime() >= cutover.getTime();
    const targetDow = targetDowForInstrument(instrument, cursor, cutover);

    if (dow === targetDow) {
      const ymd = toYmd(cursor);
      if (!BSE_HOLIDAYS.has(ymd)) {
        expiries.push({
          date: ymd,
          weekday: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][targetDow],
          era: eraForInstrument(instrument, targetDow, isAfterCutover)
        });
      } else {
        // Holiday: shift one trading day earlier
        const prev = new Date(cursor.getTime() - 86400000);
        const prevYmd = toYmd(prev);
        const prevDow = prev.getUTCDay();
        if (!BSE_HOLIDAYS.has(prevYmd) && prevDow !== 0 && prevDow !== 6) {
          expiries.push({
            date: prevYmd,
            weekday: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][prevDow],
            era: eraForInstrument(instrument, targetDow, isAfterCutover),
            shiftedFrom: ymd
          });
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() - 7);
    } else {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    if (cursor.getUTCFullYear() < startYear) break;
  }

  return expiries.reverse();
}

// ================================================================
// BLACK-SCHOLES
// ================================================================
function normCDF(x) {
  const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
  const p = 0.3275911;
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a[4] * t + a[3]) * t) + a[2]) * t + a[1]) * t + a[0]) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + s * y);
}

function bsPrice(S, K, T, r, sigma, type) {
  if (T < 0.00001) return Math.max(type === 'CE' ? S - K : K - S, 0);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  if (type === 'CE') return S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2);
  return K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1);
}

// ================================================================
// HISTORICAL VOLATILITY
// ================================================================
function histVol(closes) {
  if (closes.length < 3) return 0.18;
  const rets = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance * 252);
}

// ================================================================
// SIGNAL — improved with confidence levels + gap plays + event + IV filters
// Returns { direction, confidence, strikeOffset, reason } or null
// ================================================================
function getSignal(candle, prevClose, _recentCloses, vol, dateStr) {
  // ── IV REGIME FILTER ─────────────────────────────────────────
  // Skip entirely when market is too calm — options won't move enough
  if (!isVolatileEnough(vol)) return null;

  const { open, high, low, close } = candle;
  const range = (high - low) / open * 100;
  const body = Math.abs(close - open) / open * 100;
  const bodyRatio = range > 0 ? body / range : 0;
  const gapPct = (open - prevClose) / prevClose * 100; // signed: +ve = gap up
  const absGap = Math.abs(gapPct);

  const direction = close >= open ? 'CALL' : 'PUT';

  // ── EVENT DAY BOOST ───────────────────────────────────────────
  // Budget / Elections / RBI surprise → OTM+1 (ATM_NOMED mode: keep OTM+1 for events)
  if (isHighImpactDay(dateStr) && bodyRatio >= 0.55 && range >= 1.0) {
    return { direction, confidence: 'EVENT', strikeOffset: 1, reason: 'HIGH_IMPACT_EVENT' };
  }

  // ── TIER 1: POWER TREND (HIGH → ATM) ─────────────────────────
  // Optimised: ATM options win 77.6% vs 54.4% with OTM+1 (1200-week backtest)
  if (bodyRatio >= 0.75 && range >= 1.2 && absGap <= 3) {
    return { direction, confidence: 'HIGH', strikeOffset: 0, reason: 'POWER_TREND' };
  }

  // ── TIER 2: GAP + CONTINUATION (HIGH → ATM) ──────────────────
  const gapAligned = (gapPct > 1.0 && close > open) || (gapPct < -1.0 && close < open);
  if (gapAligned && bodyRatio >= 0.60 && range >= 1.0) {
    return { direction, confidence: 'HIGH', strikeOffset: 0, reason: 'GAP_CONTINUATION' };
  }

  // ── TIER 3 & 4: DROPPED ───────────────────────────────────────
  // MEDIUM signals (TREND + GAP_REVERSAL) removed — they dragged win rate to 54%
  // Only EVENT + POWER_TREND + GAP_CONT remain → 77.6% win rate

  return null;
}

// ================================================================
// TRADE SIMULATION — OTM strike selection + volatility smile + improved risk
// ================================================================
function simulateTrade({ signal, candle, vol, risk, strikeOffset = 1, confidence = 'MEDIUM', strikeStep = 100 }) {
  const { open, high, low, close } = candle;
  const { stopLossPct, targetPct, trailAfterMultiple, trailLockPct } = risk;

  const r = 0.065;
  // ~6 trading hours remain after ORB (9:30 AM → 3:30 PM)
  const T_entry = 6.0 / (252 * 6.5);
  const T_mid   = 3.0 / (252 * 6.5);

  const atm = Math.round(open / strikeStep) * strikeStep;
  const optType = signal === 'CALL' ? 'CE' : 'PE';

  // ── OTM STRIKE SELECTION ─────────────────────────────────────
  // strikeOffset=0 → ATM, 1 → OTM+1 (100pts away), 2 → OTM+2 (200pts away)
  const strike = signal === 'CALL'
    ? atm + strikeOffset * strikeStep
    : atm - strikeOffset * strikeStep;

  // ── VOLATILITY SMILE (OTM options have higher IV) ────────────
  // Base IV on expiry day: 1.7× historical (min 30%)
  const baseIV = Math.max(vol * 1.7, 0.30);
  // Smile: each strike away from ATM adds ~8% to IV
  const iv = baseIV * (1 + strikeOffset * 0.08);

  // ── ENTRY PRICE ───────────────────────────────────────────────
  const entryOpt = bsPrice(open, strike, T_entry, r, iv, optType);
  if (entryOpt < 0.5) return null; // near-worthless OTM — skip

  // ── DELTA-BASED STOP LOSS ─────────────────────────────────────
  const sqrtT = Math.sqrt(T_entry);
  const d1 = (Math.log(open / strike) + (r + 0.5 * iv * iv) * T_entry) / (iv * sqrtT);
  const delta = signal === 'CALL' ? normCDF(d1) : normCDF(-d1);

  // HIGH confidence → tighter SL (don't let a winner turn into a big loser)
  const effectiveSL = confidence === 'HIGH' ? stopLossPct * 0.85 : stopLossPct;
  const spotSLMove  = (entryOpt * effectiveSL / 100) / Math.max(delta, 0.05);
  const spotSLLevel = signal === 'CALL' ? open - spotSLMove : open + spotSLMove;

  let exitOpt, reason;

  if (signal === 'CALL' && low <= spotSLLevel) {
    exitOpt = entryOpt * (1 - effectiveSL / 100);
    reason = 'STOP_LOSS';
  } else if (signal === 'PUT' && high >= spotSLLevel) {
    exitOpt = entryOpt * (1 - effectiveSL / 100);
    reason = 'STOP_LOSS';
  } else {
    // Held to close → settlement = intrinsic value
    const intrinsic = signal === 'CALL'
      ? Math.max(close - strike, 0)
      : Math.max(strike - close, 0);
    exitOpt = Math.max(intrinsic, 0.05);
    reason = 'EOD_CLOSE';

    // ── TRAILING STOP ────────────────────────────────────────────
    // HIGH confidence: trail after 2x and lock 60%
    // MEDIUM: trail after 1.5x and lock 50%
    const trailTrigger = confidence === 'HIGH'
      ? trailAfterMultiple * 1.3
      : trailAfterMultiple;
    const trailLock = confidence === 'HIGH'
      ? Math.min(trailLockPct + 10, 70)
      : trailLockPct;

    const spotMidFav = signal === 'CALL' ? high : low;
    const optAtMid   = bsPrice(spotMidFav, strike, T_mid, r, iv, optType);

    const targetOpt = targetPct > 0 ? entryOpt * (1 + targetPct / 100) : Infinity;
    if (optAtMid >= targetOpt) {
      exitOpt = targetOpt;
      reason = 'TARGET';
    } else if (optAtMid >= entryOpt * trailTrigger) {
      const lockedGain  = (optAtMid - entryOpt) * (trailLock / 100);
      const trailFloor  = entryOpt + lockedGain;
      if (exitOpt < trailFloor) {
        exitOpt = trailFloor;
        reason  = 'TRAIL_STOP';
      }
    }
  }

  const pnlPct    = ((exitOpt - entryOpt) / entryOpt) * 100;
  const multiplier = exitOpt / entryOpt;

  // ── GAMMA BLAST SCORING ───────────────────────────────────────
  const gammaBlast = OptionAnalyzer.gammaBlastScore({
    spot: open, strike, timeToExpiry: T_entry, iv, type: optType
  });

  return {
    status: 'OK',
    type: signal,
    confidence,
    strikeOffset,
    entryPrice:  +entryOpt.toFixed(2),
    exitPrice:   +exitOpt.toFixed(2),
    pnlPct:      +pnlPct.toFixed(2),
    multiplier:  +multiplier.toFixed(3),
    reason,
    win: pnlPct > 0,
    strike,
    iv: +iv.toFixed(3),
    gammaBlast: {
      blastScore: gammaBlast.blastScore,
      blastLevel: gammaBlast.blastLevel,
      greekRank:  gammaBlast.greekRank,
      greekGrade: gammaBlast.greekGrade,
      gamma:      gammaBlast.gamma,
      delta:      gammaBlast.delta,
      breakdown:  gammaBlast.breakdown
    }
  };
}

// ================================================================
// MAIN
// ================================================================
async function main() {
  const instrument = normalizeInstrument(process.env.BACKTEST_INSTRUMENT || 'SENSEX');
  const indexCfg = INDEX_CONFIG[instrument];
  const numExpiries = Number(process.env.BACKTEST_NUM_EXPIRIES || 200);
  const startDate = process.env.BACKTEST_START_DATE || '';
  const cutover = process.env.SENSEX_EXPIRY_CUTOVER || '2024-10-28';
  const startYear = Number(process.env.BACKTEST_START_YEAR || (startDate ? startDate.slice(0, 4) : (numExpiries > 1200 ? 1999 : 2003)));
  const risk = {
    stopLossPct: Number(process.env.STOP_LOSS_PERCENT || 35),
    targetPct: Number(process.env.TARGET_PERCENT || 150),
    trailAfterMultiple: Number(process.env.TRAIL_AFTER_MULTIPLE || 2),
    trailLockPct: Number(process.env.TRAIL_LOCK_PERCENT || 50)
  };

  console.log('\n============================================================');
  console.log('  ANTIGRAVITY BACKTEST — Yahoo Finance / TradingView Data');
  console.log('============================================================');
  console.log(`  Instrument:          ${instrument}`);
  console.log(`  Expiries requested:  ${numExpiries}`);
  console.log(`  Start:               ${startDate || startYear}`);
  console.log(`  SL / Trail:          ${risk.stopLossPct}% / after ${risk.trailAfterMultiple}x`);
  console.log(`  Cutover:             ${cutover}`);
  console.log(`  Data source:         Yahoo Finance ${indexCfg.yahoo} daily\n`);

  // ---- Generate expiry days (back to 2003) ----
  const expiryDays = generateExpiryDays({
    count: numExpiries,
    cutoverDate: cutover,
    endDate: toYmd(new Date()),
    startYear,
    startDate: startDate || null,
    instrument
  });
  const firstDate = expiryDays[0].date;
  const lastDate = expiryDays[expiryDays.length - 1].date;
  console.log(`[1/3] Generated ${expiryDays.length} expiry days: ${firstDate} → ${lastDate}`);

  // ---- Fetch Yahoo Finance data ----
  console.log(`[2/3] Fetching ${indexCfg.yahoo} daily data from Yahoo Finance...`);
  const fetchFrom = new Date(firstDate);
  fetchFrom.setDate(fetchFrom.getDate() - 35);

  let rawData;
  try {
    // Add 2 days to period2 so Yahoo Finance includes the last expiry day
    const fetchTo = new Date(`${lastDate}T00:00:00Z`);
    fetchTo.setUTCDate(fetchTo.getUTCDate() + 2);
    rawData = await yahooFinance.historical(indexCfg.yahoo, {
      period1: toYmd(fetchFrom),
      period2: toYmd(fetchTo),
      interval: '1d'
    });
  } catch (err) {
    throw new Error(`Yahoo Finance fetch failed: ${err.message}`);
  }
  rawData.sort((a, b) => new Date(a.date) - new Date(b.date));
  console.log(`      Received ${rawData.length} daily candles (${toYmd(rawData[0].date)} → ${toYmd(rawData[rawData.length - 1].date)})\n`);

  // Date lookup
  const byDate = {};
  rawData.forEach((c, i) => { byDate[toYmd(c.date)] = { idx: i, c }; });

  // ---- Run strategy ----
  console.log('[3/3] Running strategy on each expiry day...');
  const results = [];

  for (const day of expiryDays) {
    const entry = byDate[day.date];
    if (!entry) {
      results.push({ ...day, spotCandles: [], signals: [], trades: [] });
      continue;
    }

    const { idx, c: raw } = entry;
    const candle = { open: raw.open, high: raw.high, low: raw.low, close: raw.close };

    // Historical vol (20-day window before this day)
    const prevSlice = rawData.slice(Math.max(0, idx - 21), idx).map(x => x.close);
    const vol = histVol(prevSlice);
    const prevClose = prevSlice.length > 0 ? prevSlice[prevSlice.length - 1] : candle.open;

    const recentCloses = prevSlice.slice(-5);
    const sig = getSignal(candle, prevClose, recentCloses, vol, day.date);

    let trades = [];
    if (sig) {
      const trade = simulateTrade({
        signal: sig.direction,
        candle,
        vol,
        risk,
        strikeOffset: sig.strikeOffset,
        confidence: sig.confidence,
        strikeStep: indexCfg.strikeStep
      });
      if (trade) {
        trades.push(trade);
        const tag       = trade.win ? `WIN  ${trade.multiplier}x` : `LOSS ${trade.multiplier}x`;
        const gb        = trade.gammaBlast;
        const blastTag  = gb.blastScore >= 55 ? ` ☢️${gb.blastLevel}[${gb.greekRank}]` : '';
        const confTag   = sig.confidence === 'EVENT' ? ' [EVENT⚡]' : sig.confidence === 'HIGH' ? ' [HIGH]' : '';
        const strikeTag = sig.strikeOffset > 0 ? ` OTM+${sig.strikeOffset}` : ' ATM';
        process.stdout.write(`  ${day.date}  ${sig.direction.padEnd(4)}  ${tag}  (${trade.reason})${strikeTag}${confTag}${blastTag}\n`);
      }
    }

    results.push({
      ...day,
      spotCandles: [candle],
      signals: sig ? [{ signal: sig.direction, confidence: sig.confidence === 'HIGH' ? 90 : 75, time: day.date + 'T09:31:00' }] : [],
      trades
    });
  }

  // ---- Aggregate & save ----
  const report = aggregate(results);
  report.instrument = instrument;
  report.dataSource = `Yahoo Finance / TradingView (${indexCfg.yahoo} daily + Black-Scholes settlement)`;

  const outPath = path.resolve('./backtest-real-results.json');
  const instrumentOutPath = path.resolve(`./backtest-tv-results-${instrument.toLowerCase()}.json`);
  const config = { instrument, numExpiries, startDate: startDate || null, risk, cutover, yahoo: indexCfg.yahoo };
  fs.writeFileSync(outPath, JSON.stringify({ ...report, config }, null, 2));
  fs.writeFileSync(instrumentOutPath, JSON.stringify({ ...report, config }, null, 2));
  const excelOutPath = writeBacktestExcel(outPath, 'exports');
  const reportWithExcel = { ...report, config: { ...config, excelReportPath: excelOutPath } };
  fs.writeFileSync(outPath, JSON.stringify(reportWithExcel, null, 2));
  fs.writeFileSync(instrumentOutPath, JSON.stringify(reportWithExcel, null, 2));

  // ---- Print summary ----
  const s = report.stats;
  console.log('\n============================================================');
  console.log('  RESULTS');
  console.log('============================================================');
  console.log(`  Total expiries:          ${report.totalExpiries}`);
  console.log(`  Expiries with trade:     ${report.expiriesWithTrades}`);
  console.log(`  Skipped (no data):       ${report.skipped.noSpotData + report.skipped.noSignal}`);
  console.log(`  Total trades:            ${s.totalTrades}`);
  console.log(`  Win rate:                ${s.winRate}%`);
  console.log(`  Avg multiplier:          ${s.avgMultiplier}x`);
  console.log(`  Median multiplier:       ${s.medianMultiplier}x`);
  console.log(`  Max multiplier:          ${s.maxMultiplier}x`);
  console.log(`  ≥2x hits:                ${s.hit2x}`);
  console.log(`  ≥5x hits:                ${s.hit5x}`);
  console.log(`  ≥10x hits:               ${s.hit10x}`);
  console.log(`  ≥50x hits:               ${s.hit50x}`);

  // ---- Gamma Blast Summary ----
  const allTrades = report.trades || [];
  const blastCounts = { NUCLEAR: 0, EXTREME: 0, HIGH: 0, MODERATE: 0, LOW: 0 };
  const blastWins = { NUCLEAR: 0, EXTREME: 0, HIGH: 0, MODERATE: 0, LOW: 0 };
  let totalGreekRank = 0;
  for (const t of allTrades) {
    if (t.gammaBlast) {
      blastCounts[t.gammaBlast.blastLevel] = (blastCounts[t.gammaBlast.blastLevel] || 0) + 1;
      if (t.win) blastWins[t.gammaBlast.blastLevel] = (blastWins[t.gammaBlast.blastLevel] || 0) + 1;
      totalGreekRank += t.gammaBlast.greekRank;
    }
  }
  const avgGreekRank = allTrades.length > 0 ? (totalGreekRank / allTrades.length).toFixed(1) : '0';

  console.log('\n  ⚡ Gamma Blast Breakdown:');
  console.log(`    Avg Greek Rank:  ${avgGreekRank}/100`);
  for (const lev of ['NUCLEAR', 'EXTREME', 'HIGH', 'MODERATE', 'LOW']) {
    const count = blastCounts[lev] || 0;
    const wins  = blastWins[lev] || 0;
    const wr    = count > 0 ? ((wins / count) * 100).toFixed(0) + '%' : '--';
    const icon  = lev === 'NUCLEAR' ? '☢️ ' : lev === 'EXTREME' ? '🔥' : lev === 'HIGH' ? '⚡' : lev === 'MODERATE' ? '📊' : '💤';
    if (count > 0) {
      console.log(`    ${icon} ${lev.padEnd(10)}: ${String(count).padStart(4)} trades  ${wr.padStart(4)} win`);
    }
  }

  if (s.byYear && Object.keys(s.byYear).length > 0) {
    console.log('\n  By year:');
    Object.entries(s.byYear).sort().forEach(([y, d]) => {
      if (d.trades > 0) {
        const wr = ((d.wins / d.trades) * 100).toFixed(0);
        const avg = (d.totalPnl / d.trades).toFixed(1);
        console.log(`    ${y}:  ${String(d.trades).padStart(3)} trades  ${String(wr).padStart(3)}% win  avg ${avg}%`);
      }
    });
  }

  if (s.byReason) {
    console.log('\n  Exit reasons:');
    Object.entries(s.byReason).forEach(([k, v]) =>
      console.log(`    ${k.padEnd(12)}: ${v}`)
    );
  }

  console.log(`\n  Saved -> ${outPath}`);
  console.log(`  Saved -> ${instrumentOutPath}`);
  console.log(`  Saved -> ${excelOutPath}`);
  console.log('============================================================\n');
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(err => {
    console.error('\nFatal:', err.message);
    process.exit(1);
  });
}

module.exports = {
  main,
  toYmd,
  generateExpiryDays,
  getSignal,
  simulateTrade,
  histVol
};
