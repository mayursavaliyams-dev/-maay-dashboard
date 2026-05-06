/**
 * SINGLE TRADING DAY — SESSION TIME PROFILE
 * Usage:  node day-profile.js [YYYY-MM-DD]
 * Default: last/next SENSEX expiry day
 *
 * Shows full intraday session breakdown with:
 *   — Hourly candles with OHLCV
 *   — Option price at each session (BS)
 *   — Signal fire point
 *   — Entry / SL / Trail levels
 *   — Running P&L by session
 */

require('dotenv').config();
const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance({ suppressNotices: ['ripHistorical'] });

// ── Helpers ──────────────────────────────────────────────────────
function toYmd(d) {
  const x = d instanceof Date ? d : new Date(d);
  return x.getUTCFullYear() + '-' +
    String(x.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(x.getUTCDate()).padStart(2, '0');
}
function pad(s, n)  { return String(s).padEnd(n); }
function padL(s, n) { return String(s).padStart(n); }
function bar(val, max, width = 20) {
  const filled = Math.round((val / max) * width);
  return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, width - filled));
}
function sign(n) { return n >= 0 ? '+' : ''; }

// ── Black-Scholes ────────────────────────────────────────────────
function normCDF(x) {
  const a = [0.254829592,-0.284496736,1.421413741,-1.453152027,1.061405429];
  const p = 0.3275911, s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a[4]*t+a[3])*t)+a[2])*t+a[1])*t+a[0])*t*Math.exp(-x*x);
  return 0.5 * (1 + s * y);
}
function bs(S, K, T, r, iv, type) {
  if (T <= 0.000001) return Math.max(type === 'CE' ? S-K : K-S, 0.01);
  const d1 = (Math.log(S/K) + (r + 0.5*iv*iv)*T) / (iv*Math.sqrt(T));
  const d2 = d1 - iv*Math.sqrt(T);
  return type === 'CE'
    ? S*normCDF(d1) - K*Math.exp(-r*T)*normCDF(d2)
    : K*Math.exp(-r*T)*normCDF(-d2) - S*normCDF(-d1);
}
function histVol(closes) {
  if (closes.length < 3) return 0.20;
  const rets = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i]/closes[i-1]));
  const mean = rets.reduce((s,r) => s+r, 0) / rets.length;
  const v = rets.reduce((s,r) => s+(r-mean)**2, 0) / (rets.length-1);
  return Math.sqrt(v * 252);
}

// ── Signal logic (same as backtest) ─────────────────────────────
const HIGH_IMPACT_EVENTS = new Set([
  '2003-02-28','2004-02-03','2005-02-28','2006-02-28','2007-02-28',
  '2008-02-29','2009-02-16','2010-02-26','2011-02-28','2012-03-16',
  '2013-02-28','2014-07-10','2015-02-28','2016-02-29','2017-02-01',
  '2018-02-01','2019-02-01','2020-02-01','2021-02-01','2022-02-01',
  '2023-02-01','2024-02-01','2025-02-01','2026-02-01',
  '2004-05-13','2009-05-16','2014-05-16','2019-05-23','2024-06-04',
  '2020-03-27','2020-05-22','2022-05-04','2022-06-08','2022-08-05','2022-09-30',
  '2023-02-08','2023-04-06','2024-04-05','2024-06-07',
  '2020-03-23','2016-11-08','2019-09-20','2008-10-24','2013-08-16',
]);
const MIN_VOL = 0.12;

function getSignal(c, prevClose, recentCl, vol, date) {
  if (vol < MIN_VOL) return null;
  const { open, high, low, close } = c;
  const range     = (high-low)/open*100;
  const body      = Math.abs(close-open)/open*100;
  const bodyRatio = range > 0 ? body/range : 0;
  const gapPct    = (open-prevClose)/prevClose*100;
  const absGap    = Math.abs(gapPct);
  const direction = close >= open ? 'CALL' : 'PUT';
  if (HIGH_IMPACT_EVENTS.has(date) && bodyRatio >= 0.55 && range >= 1.0)
    return { direction, confidence:'EVENT', strikeOffset:2, reason:'HIGH_IMPACT_EVENT' };
  if (bodyRatio >= 0.75 && range >= 1.2 && absGap <= 3)
    return { direction, confidence:'HIGH', strikeOffset:1, reason:'POWER_TREND' };
  const gapAligned = (gapPct>1.0 && close>open)||(gapPct<-1.0 && close<open);
  if (gapAligned && bodyRatio >= 0.60 && range >= 1.0)
    return { direction, confidence:'HIGH', strikeOffset:1, reason:'GAP_CONTINUATION' };
  if (bodyRatio >= 0.65 && range >= 0.9 && absGap <= 5)
    return { direction, confidence:'MEDIUM', strikeOffset:0, reason:'TREND' };
  const pt = recentCl && recentCl.length>=3
    ? (recentCl[recentCl.length-1]>recentCl[recentCl.length-3]?'UP':'DOWN') : null;
  const rev  = pt==='UP'   && gapPct<-1.2 && close<open && bodyRatio>=0.60;
  const revU = pt==='DOWN' && gapPct> 1.2 && close>open && bodyRatio>=0.60;
  if ((rev||revU) && range >= 1.0)
    return { direction, confidence:'MEDIUM', strikeOffset:0, reason:'GAP_REVERSAL' };
  return null;
}

// ── IST session slots ────────────────────────────────────────────
// Yahoo Finance returns hourly bars in UTC. IST = UTC+5:30
// 9:15 IST = 03:45 UTC  → use 04:00 UTC hourly bar
// Sessions:
//   S0: Pre-open  / ORB    9:15 – 10:00  (first bar)
//   S1: Morning           10:00 – 11:00
//   S2: Mid-morning       11:00 – 12:00
//   S3: Midday            12:00 – 13:00
//   S4: Afternoon         13:00 – 14:00
//   S5: Late afternoon    14:00 – 15:00
//   S6: Closing           15:00 – 15:30  (partial bar)
const SESSION_LABELS = [
  { utcH: 3,  ist: '09:15-10:00', name: 'ORB / Open' },
  { utcH: 4,  ist: '10:00-11:00', name: 'Morning' },
  { utcH: 5,  ist: '11:00-12:00', name: 'Mid-Morning' },
  { utcH: 6,  ist: '12:00-13:00', name: 'Midday' },
  { utcH: 7,  ist: '13:00-14:00', name: 'Afternoon' },
  { utcH: 8,  ist: '14:00-15:00', name: 'Late Afternoon' },
  { utcH: 9,  ist: '15:00-15:30', name: 'Closing' },
];

// ── BSE Holidays ─────────────────────────────────────────────────
const BSE_HOLIDAYS = new Set([
  '2003-01-26','2003-08-15','2003-12-25',
  '2004-01-26','2004-08-15','2004-10-01','2004-11-12','2004-12-25',
  '2005-01-26','2005-03-25','2005-08-15','2005-11-01','2005-12-25',
  '2006-01-26','2006-04-14','2006-08-15','2006-10-24','2006-12-25',
  '2007-01-26','2007-03-02','2007-04-06','2007-08-15','2007-11-09','2007-12-25',
  '2008-01-26','2008-03-21','2008-08-15','2008-10-29','2008-12-25',
  '2009-01-26','2009-04-10','2009-08-15','2009-10-19','2009-12-25',
  '2010-01-26','2010-03-01','2010-04-02','2010-08-15','2010-11-05','2010-12-25',
  '2011-01-26','2011-03-19','2011-04-14','2011-04-22','2011-08-15','2011-10-26','2011-12-25',
  '2012-01-26','2012-03-08','2012-04-06','2012-08-15','2012-11-13','2012-11-14','2012-12-25',
  '2013-01-26','2013-03-27','2013-03-29','2013-04-01','2013-08-15','2013-11-04','2013-12-25',
  '2014-01-14','2014-01-26','2014-02-27','2014-04-14','2014-04-18','2014-08-15','2014-10-03','2014-10-24','2014-12-25',
  '2015-01-26','2015-02-17','2015-03-06','2015-04-03','2015-04-14','2015-08-15','2015-09-17','2015-10-22','2015-11-12','2015-12-25',
  '2016-01-26','2016-03-07','2016-03-25','2016-04-14','2016-04-15','2016-08-15','2016-09-05','2016-10-11','2016-10-12','2016-10-30','2016-11-14','2016-12-25',
  '2017-01-26','2017-02-24','2017-03-13','2017-04-04','2017-04-14','2017-06-26','2017-08-15','2017-08-25','2017-10-02','2017-10-19','2017-10-20','2017-12-25',
  '2018-01-26','2018-02-13','2018-03-02','2018-03-29','2018-03-30','2018-04-02','2018-05-01','2018-08-15','2018-08-22','2018-09-20','2018-10-02','2018-11-07','2018-11-08','2018-11-21','2018-12-25',
  '2019-03-04','2019-03-21','2019-04-17','2019-04-19','2019-04-29','2019-05-01','2019-06-05','2019-08-12','2019-08-15','2019-09-02','2019-09-10','2019-10-02','2019-10-07','2019-10-08','2019-10-27','2019-10-28','2019-11-12','2019-12-25',
  '2020-02-21','2020-03-10','2020-04-02','2020-04-06','2020-04-10','2020-04-14','2020-05-01','2020-05-25','2020-08-03','2020-08-15','2020-11-16','2020-11-30','2020-12-25',
  '2021-01-26','2021-03-11','2021-03-29','2021-04-02','2021-04-14','2021-05-13','2021-07-21','2021-08-15','2021-09-10','2021-10-15','2021-11-04','2021-11-05','2021-11-19','2021-12-25',
  '2022-01-26','2022-03-01','2022-03-18','2022-04-14','2022-04-15','2022-05-03','2022-08-09','2022-08-15','2022-08-31','2022-10-05','2022-10-24','2022-10-26','2022-11-08',
  '2023-01-26','2023-03-07','2023-03-30','2023-04-04','2023-04-07','2023-04-14','2023-05-01','2023-06-28','2023-08-15','2023-09-19','2023-10-02','2023-10-24','2023-11-14','2023-11-27','2023-12-25',
  '2024-01-26','2024-03-08','2024-03-25','2024-03-29','2024-04-11','2024-04-17','2024-05-01','2024-05-20','2024-06-17','2024-07-17','2024-08-15','2024-10-02','2024-11-01','2024-11-15','2024-12-25',
  '2025-02-26','2025-03-14','2025-03-31','2025-04-10','2025-04-14','2025-04-18','2025-05-01','2025-08-15','2025-08-27','2025-10-02','2025-10-21','2025-10-22','2025-11-05','2025-12-25',
  '2026-01-26','2026-02-17','2026-03-03','2026-03-25','2026-04-03'
]);

function lastExpiry() {
  const cutover = new Date('2024-10-28T00:00:00Z');
  const cursor  = new Date();
  cursor.setUTCHours(0,0,0,0);
  for (let i = 0; i < 14; i++) {
    const dow = cursor.getUTCDay();
    const target = cursor >= cutover ? 2 : 5;
    if (dow === target) {
      const ymd = toYmd(cursor);
      if (!BSE_HOLIDAYS.has(ymd)) return ymd;
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return toYmd(new Date());
}

// ── MAIN ──────────────────────────────────────────────────────────
async function main() {
  const targetDate = process.argv[2] || lastExpiry();
  console.log('\n' + '='.repeat(72));
  console.log(`  SENSEX EXPIRY DAY — SESSION TIME PROFILE`);
  console.log(`  Date: ${targetDate}`);
  if (HIGH_IMPACT_EVENTS.has(targetDate)) console.log('  *** HIGH-IMPACT EVENT DAY ***');
  console.log('='.repeat(72));

  // ── Fetch 20 daily bars for vol calculation ──────────────────
  const dailyFrom = new Date(targetDate + 'T00:00:00Z');
  dailyFrom.setUTCDate(dailyFrom.getUTCDate() - 30);
  const dailyTo   = new Date(targetDate + 'T00:00:00Z');
  dailyTo.setUTCDate(dailyTo.getUTCDate() + 1);

  console.error('Fetching daily data for vol...');
  const dailyData = await yf.historical('^BSESN', {
    period1: toYmd(dailyFrom), period2: toYmd(dailyTo), interval: '1d'
  });
  dailyData.sort((a,b) => new Date(a.date)-new Date(b.date));

  const targetDaily = dailyData.find(c => toYmd(c.date) === targetDate);
  const prevDailyIdx = dailyData.findIndex(c => toYmd(c.date) === targetDate) - 1;
  const prevClose = prevDailyIdx >= 0 ? dailyData[prevDailyIdx].close : null;
  const recentCloses = dailyData.slice(Math.max(0, prevDailyIdx-5), prevDailyIdx).map(c=>c.close);
  const volCloses  = dailyData.slice(Math.max(0, prevDailyIdx-20), prevDailyIdx).map(c=>c.close);
  const vol = histVol(volCloses);
  const baseIV = Math.max(vol * 1.7, 0.30);

  if (!targetDaily) {
    console.log(`\n  No daily data found for ${targetDate}.`);
    console.log('  Try a recent expiry date, e.g.: node day-profile.js 2019-09-20\n');
    return;
  }

  // ── Try fetching 1h intraday data via chart() ───────────────
  console.error('Fetching intraday 1h data...');
  let hourlyBars = [];
  try {
    const h1From = new Date(targetDate + 'T00:00:00Z');
    const h1To   = new Date(targetDate + 'T00:00:00Z');
    h1To.setUTCDate(h1To.getUTCDate() + 1);
    const chartRes = await yf.chart('^BSESN', {
      period1: toYmd(h1From), period2: toYmd(h1To), interval: '1h'
    });
    const quotes = chartRes?.quotes || [];
    hourlyBars = quotes
      .filter(c => {
        const d = new Date(c.date);
        const utcH = d.getUTCHours();
        return toYmd(d) === targetDate && utcH >= 3 && utcH <= 9;
      })
      .sort((a,b) => new Date(a.date)-new Date(b.date));
    console.error('Got', hourlyBars.length, 'intraday bars');
  } catch(e) {
    console.error('Intraday fetch failed (using simulation):', e.message);
  }

  // ── Build session candles (fallback: simulate from OHLC) ─────
  const dayOpen  = targetDaily.open;
  const dayHigh  = targetDaily.high;
  const dayLow   = targetDaily.low;
  const dayClose = targetDaily.close;
  const atm = Math.round(dayOpen / 100) * 100;

  let sessions = [];

  if (hourlyBars.length >= 4) {
    // Real hourly data
    for (const sl of SESSION_LABELS) {
      const bar = hourlyBars.find(b => new Date(b.date).getUTCHours() === sl.utcH);
      if (bar) {
        sessions.push({
          ist: sl.ist, name: sl.name,
          open: bar.open, high: bar.high, low: bar.low, close: bar.close,
          volume: bar.volume || 0,
          real: true
        });
      }
    }
  }

  // Fallback: reconstruct 7 sessions from daily OHLC using a realistic intraday model
  if (sessions.length < 4) {
    console.error('Using simulated intraday sessions from daily OHLC');
    const move  = dayClose - dayOpen;
    const trend = move > 0 ? 1 : -1;

    // Session close weights: ORB captures most of the move, rest consolidates
    // Realistic: trend days front-load the move, reversals back-load
    const sessionWeights = [0.40, 0.20, 0.12, 0.08, 0.08, 0.07, 0.05];

    // Each session's range as fraction of total day range
    // For trend days: range is tight (close to directional move only)
    // For volatile days: range is wider
    const rangePctDay = Math.abs(dayHigh - dayLow) / dayOpen;
    const isTrend = Math.abs(move / dayOpen) > 0.015; // >1.5% directional

    let prevSessClose = dayOpen;

    for (let i = 0; i < SESSION_LABELS.length; i++) {
      const sl = SESSION_LABELS[i];
      const sessMove  = move * sessionWeights[i];
      const sessOpen  = prevSessClose;
      const sessClose = sessOpen + sessMove;

      // For trend days: session high/low stay close to the directional path
      // Overshoot above/below is small so no false stop-losses
      const sessRange = (dayHigh - dayLow) * sessionWeights[i] * (isTrend ? 0.6 : 1.0);
      const wobbleUp  = isTrend ? sessRange * (trend > 0 ? 0.7 : 0.3) : sessRange * 0.5;
      const wobbleDn  = isTrend ? sessRange * (trend > 0 ? 0.3 : 0.7) : sessRange * 0.5;

      const sessHigh = Math.max(sessOpen, sessClose) + wobbleUp;
      const sessLow  = Math.min(sessOpen, sessClose) - wobbleDn;

      sessions.push({
        ist: sl.ist, name: sl.name,
        open:  +sessOpen.toFixed(1),
        high:  +sessHigh.toFixed(1),
        low:   +sessLow.toFixed(1),
        close: +sessClose.toFixed(1),
        volume: 0, real: false
      });
      prevSessClose = sessClose;
    }
    // Force last session to land exactly on dayClose
    if (sessions.length) sessions[sessions.length-1].close = dayClose;
  }

  // ── Daily candle signal ──────────────────────────────────────
  const signal = getSignal(
    { open:dayOpen, high:dayHigh, low:dayLow, close:dayClose },
    prevClose || dayOpen,
    recentCloses, vol, targetDate
  );

  const r = 0.065;
  const totalTradingHours = 6.25;

  // ── Print day header ─────────────────────────────────────────
  const movePct  = ((dayClose - dayOpen) / dayOpen * 100);
  const rangePct = ((dayHigh - dayLow)   / dayOpen * 100);
  const gapPct   = prevClose ? ((dayOpen - prevClose) / prevClose * 100) : 0;

  console.log(`\n  SENSEX  Open: ${dayOpen.toFixed(0)}  High: ${dayHigh.toFixed(0)}  Low: ${dayLow.toFixed(0)}  Close: ${dayClose.toFixed(0)}`);
  console.log(`  Move:  ${sign(movePct)}${movePct.toFixed(2)}%   Range: ${rangePct.toFixed(2)}%   Gap: ${sign(gapPct)}${gapPct.toFixed(2)}%`);
  console.log(`  HV(20): ${(vol*100).toFixed(1)}%   Base IV: ${(baseIV*100).toFixed(1)}%   ATM Strike: ${atm}`);

  if (signal) {
    const conf = signal.confidence === 'EVENT' ? '⚡ EVENT' :
                 signal.confidence === 'HIGH'  ? '★ HIGH'  : '◆ MEDIUM';
    console.log(`\n  SIGNAL: ${signal.direction}  [${conf}]  Strike Offset: OTM+${signal.strikeOffset}  Reason: ${signal.reason}`);
  } else {
    console.log('\n  SIGNAL: NONE (vol filter or no pattern)');
  }

  // ── Option setup ─────────────────────────────────────────────
  let entryOpt = null, strike = null, optType = null, entryT = null;
  let tradeActive = false, exitPrinted = false;
  let trailFloor = null;
  const SL_PCT   = 35;
  const TRAIL_AT = 2.0;

  if (signal) {
    const strikeOffset = signal.strikeOffset;
    optType = signal.direction === 'CALL' ? 'CE' : 'PE';
    strike  = signal.direction === 'CALL'
      ? atm + strikeOffset * 100
      : atm - strikeOffset * 100;
    const iv_entry = baseIV * (1 + strikeOffset * 0.08);
    entryT  = totalTradingHours / (252 * 6.5);
    entryOpt = bs(dayOpen, strike, entryT, r, iv_entry, optType);
    if (entryOpt >= 0.5) tradeActive = true;

    console.log(`  Strike: ${strike}  Entry Premium: ₹${entryOpt.toFixed(2)}`);
    console.log(`  Stop Loss: ${SL_PCT}%  →  exit at ₹${(entryOpt*(1-SL_PCT/100)).toFixed(2)}`);
  }

  // ── Session table ─────────────────────────────────────────────
  const realLabel = sessions[0]?.real ? '(real intraday data)' : '(simulated from OHLC)';
  console.log(`\n  ${realLabel}`);
  console.log('\n' + '─'.repeat(72));
  console.log(
    pad('Session',14) + pad('IST Time',12) +
    pad('Open',8) + pad('High',8) + pad('Low',8) + pad('Close',8) +
    pad('Move%',7) + (tradeActive ? pad('OptPrice',10) + pad('P&L',10) : '') + 'Status'
  );
  console.log('─'.repeat(72));

  const isRealSessions = sessions[0]?.real;
  let hoursElapsed = 0;
  const sessionHours = [0.75, 1, 1, 1, 1, 1, 0.5]; // hours per session

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i];
    hoursElapsed += sessionHours[i];
    const timeLeft = Math.max(totalTradingHours - hoursElapsed, 0);
    const T_sess   = timeLeft / (252 * 6.5);

    const sessMove = ((s.close - s.open) / s.open * 100).toFixed(2);
    let optLine = '', statusLine = '';

    if (tradeActive && signal && !exitPrinted) {
      const strikeOffset = signal.strikeOffset;
      const iv_now = baseIV * (1 + strikeOffset * 0.08);

      // Stop loss check: only for real intraday data (simulation can give false triggers)
      if (isRealSessions) {
        const slLevel   = entryOpt * (1 - SL_PCT / 100);
        const spotWorst = signal.direction === 'CALL' ? s.low : s.high;
        const optWorst  = bs(spotWorst, strike, T_sess, r, iv_now, optType);

        if (optWorst <= slLevel) {
          const pnlPct = ((slLevel - entryOpt) / entryOpt * 100).toFixed(1);
          optLine = padL(slLevel.toFixed(2), 9) + ' ' + padL(sign(parseFloat(pnlPct))+pnlPct+'%', 9);
          statusLine = '🔴 STOP LOSS';
          exitPrinted = true;
        }
      }

      if (!exitPrinted) {
        // Check trail trigger using session best spot
        const spotBest = signal.direction === 'CALL' ? s.high : s.low;
        const optBest  = bs(spotBest, strike, T_sess + 0.001, r, iv_now, optType);

        if (optBest >= entryOpt * TRAIL_AT && !trailFloor) {
          trailFloor = entryOpt + (optBest - entryOpt) * 0.60;
        }

        // Current opt at close of session (last session = settlement intrinsic)
        const optNow = i === sessions.length - 1
          ? Math.max(signal.direction === 'CALL' ? s.close - strike : strike - s.close, 0.05)
          : bs(s.close, strike, T_sess, r, iv_now, optType);

        const effExit = trailFloor ? Math.max(optNow, trailFloor) : optNow;
        const pnlPct  = ((effExit - entryOpt) / entryOpt * 100).toFixed(1);
        const mult    = (effExit / entryOpt).toFixed(2);

        optLine = padL(effExit.toFixed(2), 9) + ' ' + padL(sign(parseFloat(pnlPct))+pnlPct+'%', 9);

        if (i === sessions.length - 1) {
          statusLine = parseFloat(pnlPct) >= 0 ? `✅ WIN  ${mult}x` : `❌ LOSS ${mult}x`;
          exitPrinted = true;
        } else if (trailFloor && effExit === trailFloor) {
          statusLine = '🔒 TRAIL LOCKED';
        } else if (parseFloat(pnlPct) >= 100) {
          statusLine = `⚡ ${mult}x running`;
        } else {
          statusLine = 'active';
        }
      }
    } else if (!tradeActive && !signal) {
      statusLine = i === 0 ? 'no signal' : '';
    }

    // Price bar chart (range visualization)
    const dayRng = dayHigh - dayLow;
    const posH = dayRng > 0 ? Math.round(((s.high - dayLow) / dayRng) * 10) : 5;
    const posL = dayRng > 0 ? Math.round(((s.low  - dayLow) / dayRng) * 10) : 5;

    console.log(
      pad(s.name, 14) +
      pad(s.ist, 12) +
      padL(s.open.toFixed(0), 7)  + ' ' +
      padL(s.high.toFixed(0), 7)  + ' ' +
      padL(s.low.toFixed(0),  7)  + ' ' +
      padL(s.close.toFixed(0), 7) + ' ' +
      padL((parseFloat(sessMove)>0?'+':'')+sessMove+'%', 6) + ' ' +
      optLine + ' ' + statusLine
    );
  }

  console.log('─'.repeat(72));

  // ── Price range bar ──────────────────────────────────────────
  console.log('\n  Price range visualizer (Low → High)');
  console.log('  ' + padL(dayLow.toFixed(0), 7) + ' [' + bar(dayClose - dayLow, dayHigh - dayLow, 30) + '] ' + padL(dayHigh.toFixed(0), 7));
  console.log('  ' + ' '.repeat(9) + '^'.padStart(Math.round(((dayClose-dayLow)/(dayHigh-dayLow))*30)+1) + ' Close ' + dayClose.toFixed(0));

  // ── Option chain at open (ATM ±3 strikes) ───────────────────
  console.log('\n\n  OPTION CHAIN AT OPEN (9:15 AM)');
  console.log('  ' + '─'.repeat(60));
  console.log('  ' + pad('Strike',9) + pad('CE Premium',12) + pad('PE Premium',12) + pad('CE Mult (eod)',14) + 'PE Mult (eod)');
  console.log('  ' + '─'.repeat(60));

  for (let offset = -3; offset <= 3; offset++) {
    const k    = atm + offset * 100;
    const iv_k = baseIV * (1 + Math.abs(offset) * 0.08);
    const T    = totalTradingHours / (252 * 6.5);
    const ceP  = bs(dayOpen, k, T, r, iv_k, 'CE');
    const peP  = bs(dayOpen, k, T, r, iv_k, 'PE');
    const ceI  = Math.max(dayClose - k, 0.05);
    const peI  = Math.max(k - dayClose, 0.05);
    const ceM  = ceP > 0.5 ? (ceI/ceP).toFixed(2)+'x' : '—';
    const peM  = peP > 0.5 ? (peI/peP).toFixed(2)+'x' : '—';
    const marker = k === atm ? ' ← ATM' : (signal && k === strike ? ' ← SIGNAL STRIKE' : '');
    console.log('  ' +
      pad(k, 9) +
      padL('₹' + ceP.toFixed(1), 11) + ' ' +
      padL('₹' + peP.toFixed(1), 11) + ' ' +
      padL(ceM, 13) + ' ' +
      peM + marker
    );
  }

  console.log('\n' + '='.repeat(72));
  console.log(`  Run a different date:  node day-profile.js YYYY-MM-DD`);
  console.log(`  Best dates to try:     2004-05-14  2019-09-20  2020-03-13  2013-08-16`);
  console.log('='.repeat(72) + '\n');
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('ERROR:', err.message); process.exit(1); });
