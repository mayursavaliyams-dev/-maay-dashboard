/**
 * SIGNAL vs MULTIPLIER CROSS-REFERENCE
 * Shows which 1X+ multiplier weeks the strategy fired a signal on
 * — how many winning weeks did we CATCH vs MISS?
 */

require('dotenv').config();
const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance({ suppressNotices: ['ripHistorical'] });

// ── Helpers ────────────────────────────────────────────────────
function toYmd(d) {
  const x = d instanceof Date ? d : new Date(d);
  return x.getUTCFullYear() + '-' +
    String(x.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(x.getUTCDate()).padStart(2, '0');
}
function pad(s, n)  { return String(s).padEnd(n); }
function padL(s, n) { return String(s).padStart(n); }

// ── Black-Scholes ──────────────────────────────────────────────
function normCDF(x) {
  const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429];
  const p = 0.3275911, s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a[4]*t+a[3])*t)+a[2])*t+a[1])*t+a[0])*t*Math.exp(-x*x);
  return 0.5 * (1 + s * y);
}
function bs(S, K, T, r, iv, type) {
  if (T < 0.00001) return Math.max(type === 'CE' ? S - K : K - S, 0);
  const d1 = (Math.log(S / K) + (r + 0.5 * iv * iv) * T) / (iv * Math.sqrt(T));
  const d2 = d1 - iv * Math.sqrt(T);
  return type === 'CE'
    ? S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2)
    : K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1);
}
function histVol(closes) {
  if (closes.length < 3) return 0.18;
  const rets = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i-1]));
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance * 252);
}

// ── High-impact events ─────────────────────────────────────────
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

const MIN_VOL_THRESHOLD = 0.12;

function getSignal(candle, prevClose, recentCloses, vol, dateStr) {
  if (vol < MIN_VOL_THRESHOLD) return null;

  const { open, high, low, close } = candle;
  const range     = (high - low) / open * 100;
  const body      = Math.abs(close - open) / open * 100;
  const bodyRatio = range > 0 ? body / range : 0;
  const gapPct    = (open - prevClose) / prevClose * 100;
  const absGap    = Math.abs(gapPct);
  const direction = close >= open ? 'CALL' : 'PUT';

  if (HIGH_IMPACT_EVENTS.has(dateStr) && bodyRatio >= 0.55 && range >= 1.0)
    return { direction, confidence: 'EVENT', strikeOffset: 2, reason: 'HIGH_IMPACT_EVENT' };

  if (bodyRatio >= 0.75 && range >= 1.2 && absGap <= 3)
    return { direction, confidence: 'HIGH',   strikeOffset: 1, reason: 'POWER_TREND' };

  const gapAligned = (gapPct > 1.0 && close > open) || (gapPct < -1.0 && close < open);
  if (gapAligned && bodyRatio >= 0.60 && range >= 1.0)
    return { direction, confidence: 'HIGH',   strikeOffset: 1, reason: 'GAP_CONTINUATION' };

  if (bodyRatio >= 0.65 && range >= 0.9 && absGap <= 5)
    return { direction, confidence: 'MEDIUM', strikeOffset: 0, reason: 'TREND' };

  const prevTrend = recentCloses && recentCloses.length >= 3
    ? (recentCloses[recentCloses.length-1] > recentCloses[recentCloses.length-3] ? 'UP' : 'DOWN')
    : null;
  const gapRev   = prevTrend === 'UP'   && gapPct < -1.2 && close < open && bodyRatio >= 0.60;
  const gapRevUp = prevTrend === 'DOWN' && gapPct >  1.2 && close > open && bodyRatio >= 0.60;
  if ((gapRev || gapRevUp) && range >= 1.0)
    return { direction, confidence: 'MEDIUM', strikeOffset: 0, reason: 'GAP_REVERSAL' };

  return null;
}

// ── BSE Holidays ───────────────────────────────────────────────
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

function generateExpiries(count, cutover, endDate) {
  const expiries = [];
  const cut = new Date(cutover + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  const cursor = new Date(end);
  cursor.setUTCHours(0, 0, 0, 0);
  while (expiries.length < count) {
    const dow = cursor.getUTCDay();
    const isAfter = cursor >= cut;
    const target = isAfter ? 2 : 5;
    if (dow === target) {
      const ymd = toYmd(cursor);
      if (!BSE_HOLIDAYS.has(ymd)) {
        expiries.push(ymd);
      } else {
        const prev = new Date(cursor - 86400000);
        const py = toYmd(prev), pd = prev.getUTCDay();
        if (!BSE_HOLIDAYS.has(py) && pd !== 0 && pd !== 6) expiries.push(py);
      }
      cursor.setUTCDate(cursor.getUTCDate() - 7);
    } else {
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    if (cursor.getUTCFullYear() < 2003) break;
  }
  return expiries.reverse();
}

const EVENT_LABELS = {
  '2004-05-13':'ELECTION BJP shock','2004-05-14':'ELECTION BJP shock',
  '2009-05-16':'ELECTION UPA landslide','2014-05-16':'ELECTION Modi win',
  '2019-05-23':'ELECTION Modi 2nd','2024-06-04':'ELECTION 2024',
  '2019-09-20':'CORP TAX CUT','2020-03-23':'COVID CRASH',
  '2016-11-08':'DEMONETISATION','2008-10-24':'GLOBAL CRISIS',
  '2013-08-16':'RUPEE CRISIS','2020-02-28':'COVID FEAR',
};

async function main() {
  const expiries = generateExpiries(1200, '2024-10-28', toYmd(new Date()));

  const fetchFrom = new Date(expiries[0]);
  fetchFrom.setDate(fetchFrom.getDate() - 35);
  const fetchTo = new Date(expiries[expiries.length-1] + 'T00:00:00Z');
  fetchTo.setUTCDate(fetchTo.getUTCDate() + 2);

  console.error('Fetching Yahoo Finance data...');
  const rawData = await yf.historical('^BSESN', {
    period1: toYmd(fetchFrom),
    period2: toYmd(fetchTo),
    interval: '1d'
  });
  rawData.sort((a, b) => new Date(a.date) - new Date(b.date));
  console.error('Got', rawData.length, 'candles');

  const byDate = {};
  rawData.forEach((c, i) => { byDate[toYmd(c.date)] = { idx: i, c }; });

  const r = 0.065;
  const T_entry = 6.0 / (252 * 6.5);

  // Multiplier thresholds
  const THRESHOLDS = [5, 3, 2, 1.5, 1.0];

  // Results buckets: for each threshold, caught vs missed
  const buckets = {};
  THRESHOLDS.forEach(t => { buckets[t] = { caught: [], missed: [] }; });

  // All rows for detail table
  const allRows = [];

  for (const date of expiries) {
    const entry = byDate[date];
    if (!entry) continue;

    const { idx, c: candle } = entry;
    const prevCloses = rawData.slice(Math.max(0, idx - 21), idx).map(x => x.close);
    const vol = histVol(prevCloses);
    const iv  = Math.max(vol * 1.7, 0.30);

    const { open, high, low, close } = candle;
    const atm = Math.round(open / 100) * 100;

    // Best possible multiplier (same logic as multiplier-scan)
    const ceEntry  = bs(open, atm,       T_entry, r, iv, 'CE');
    const peEntry  = bs(open, atm,       T_entry, r, iv, 'PE');
    const ceOTM1   = bs(open, atm + 100, T_entry, r, iv * 1.08, 'CE');
    const peOTM1   = bs(open, atm - 100, T_entry, r, iv * 1.08, 'PE');

    const ceMult  = ceEntry  > 0.5 ? Math.max(close - atm, 0.05)         / ceEntry  : 0;
    const peMult  = peEntry  > 0.5 ? Math.max(atm - close, 0.05)         / peEntry  : 0;
    const ceOTM1M = ceOTM1   > 0.5 ? Math.max(close - (atm + 100), 0.05) / ceOTM1   : 0;
    const peOTM1M = peOTM1   > 0.5 ? Math.max((atm - 100) - close, 0.05) / peOTM1   : 0;

    const bestMult = Math.max(ceMult, peMult, ceOTM1M, peOTM1M);

    // Strategy signal for this day
    const prevClose   = idx > 0 ? rawData[idx - 1].close : open;
    const recentCl    = prevCloses.slice(-5);
    const signal      = getSignal(candle, prevClose, recentCl, vol, date);

    // Did signal match the winning direction?
    let signalWins = false;
    let signalDir  = '';
    if (signal) {
      signalDir = signal.direction;
      const actualDir = close >= open ? 'CALL' : 'PUT';
      signalWins = signalDir === actualDir;
    }

    allRows.push({
      date, bestMult, signal: signal ? signal : null,
      signalDir, signalWins,
      movePct: ((close - open) / open * 100).toFixed(2),
      range:   ((high - low) / open * 100).toFixed(2),
      event:   EVENT_LABELS[date] || ''
    });

    // Bucket by threshold
    for (const t of THRESHOLDS) {
      if (bestMult >= t) {
        if (signal && signalWins) {
          buckets[t].caught.push({ date, bestMult, signal });
        } else {
          buckets[t].missed.push({ date, bestMult, signal, signalDir });
        }
      }
    }
  }

  // ── SUMMARY TABLE ──────────────────────────────────────────────
  console.log('\n' + '='.repeat(80));
  console.log('  STRATEGY SIGNAL vs BEST-POSSIBLE MULTIPLIER  — 1200 EXPIRY WEEKS');
  console.log('='.repeat(80));
  console.log(pad('Threshold', 12) + pad('Possible', 10) + pad('Caught', 10) + pad('Missed', 10) + pad('Catch%', 10) + 'Notes');
  console.log('-'.repeat(80));

  for (const t of THRESHOLDS) {
    const total  = buckets[t].caught.length + buckets[t].missed.length;
    const caught = buckets[t].caught.length;
    const missed = buckets[t].missed.length;
    const pct    = total > 0 ? (caught / total * 100).toFixed(1) : '0.0';
    console.log(
      pad(t + 'X+', 12) +
      pad(total, 10) +
      pad(caught, 10) +
      pad(missed, 10) +
      pad(pct + '%', 10)
    );
  }

  console.log('='.repeat(80));

  // ── DETAIL: 2X+ weeks — CAUGHT ────────────────────────────────
  console.log('\n\n── CAUGHT: 2X+ weeks where strategy fired correct signal ──────────────────');
  console.log(pad('Date', 12) + pad('BestMult', 10) + pad('Signal', 8) + pad('Confidence', 12) + pad('Reason', 20) + 'Event');
  console.log('-'.repeat(80));
  const caught2x = buckets[2].caught.sort((a, b) => b.bestMult - a.bestMult);
  for (const row of caught2x) {
    console.log(
      pad(row.date, 12) +
      pad(row.bestMult.toFixed(2) + 'x', 10) +
      pad(row.signal.direction, 8) +
      pad(row.signal.confidence, 12) +
      pad(row.signal.reason, 20) +
      (EVENT_LABELS[row.date] || '')
    );
  }

  // ── DETAIL: 2X+ weeks — MISSED ────────────────────────────────
  console.log('\n\n── MISSED: 2X+ weeks where strategy had NO signal (or wrong direction) ────');
  console.log(pad('Date', 12) + pad('BestMult', 10) + pad('Status', 20) + pad('Move%', 8) + pad('Range%', 8) + 'Event');
  console.log('-'.repeat(80));
  const missed2x = buckets[2].missed.sort((a, b) => b.bestMult - a.bestMult);
  for (const r of missed2x) {
    const row = allRows.find(x => x.date === r.date);
    let status = 'NO_SIGNAL';
    if (r.signal) status = 'WRONG_DIR(' + r.signalDir + ')';
    console.log(
      pad(r.date, 12) +
      pad(r.bestMult.toFixed(2) + 'x', 10) +
      pad(status, 20) +
      pad((parseFloat(row.movePct) > 0 ? '+' : '') + row.movePct + '%', 8) +
      pad(row.range + '%', 8) +
      (row.event || '')
    );
  }

  // ── SIGNAL QUALITY: what % of signals are in 1X+ weeks ───────
  const allSignals   = allRows.filter(r => r.signal && r.signalWins);
  const sig1xPlus    = allSignals.filter(r => r.bestMult >= 1.0).length;
  const sig2xPlus    = allSignals.filter(r => r.bestMult >= 2.0).length;
  const sigTotal     = allSignals.length;

  console.log('\n\n── SIGNAL QUALITY: of all weeks strategy fired correct-direction signal ────');
  console.log(`  Total correct-direction signals : ${sigTotal}`);
  console.log(`  Of those, 1X+ multiplier weeks  : ${sig1xPlus}  (${(sig1xPlus/sigTotal*100).toFixed(1)}%)`);
  console.log(`  Of those, 2X+ multiplier weeks  : ${sig2xPlus}  (${(sig2xPlus/sigTotal*100).toFixed(1)}%)`);
  console.log('='.repeat(80));
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('ERROR:', err.message); process.exit(1); });
