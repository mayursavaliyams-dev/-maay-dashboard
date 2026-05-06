/**
 * MULTIPLIER SCANNER — All 1200 SENSEX Expiry Weeks
 * Shows ATM Call/Put best possible multiplier for every expiry day
 * Sorted highest → lowest to find the BEST multiplier days
 */

require('dotenv').config();
const YahooFinance = require('yahoo-finance2').default;
const yf = new YahooFinance({ suppressNotices: ['ripHistorical'] });

// ── Helpers ───────────────────────────────────────────────────
function toYmd(d) {
  const x = d instanceof Date ? d : new Date(d);
  return x.getUTCFullYear() + '-' +
    String(x.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(x.getUTCDate()).padStart(2, '0');
}
function pad(s, n)  { return String(s).padEnd(n); }
function padL(s, n) { return String(s).padStart(n); }

// ── Black-Scholes ─────────────────────────────────────────────
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

// ── BSE Holidays ─────────────────────────────────────────────
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

// ── Event labels ──────────────────────────────────────────────
const EVENT_LABELS = {
  '2004-05-13': 'ELECTION(BJP shock)',
  '2004-05-14': 'ELECTION(BJP shock)',
  '2009-05-16': 'ELECTION(UPA landslide)',
  '2014-05-16': 'ELECTION(Modi win)',
  '2019-05-23': 'ELECTION(Modi 2nd)',
  '2024-06-04': 'ELECTION 2024',
  '2019-09-20': 'CORP TAX CUT',
  '2020-03-23': 'COVID CRASH',
  '2016-11-08': 'DEMONETISATION',
  '2008-10-24': 'GLOBAL CRISIS',
  '2013-08-16': 'RUPEE CRISIS',
  '2020-02-28': 'COVID FEAR',
};

async function main() {
  const expiries = generateExpiries(1200, '2024-10-28', toYmd(new Date()));
  console.error('Generated', expiries.length, 'expiry days:', expiries[0], '->', expiries[expiries.length-1]);

  // Fetch all historical data
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

  // Build date index
  const byDate = {};
  rawData.forEach((c, i) => { byDate[toYmd(c.date)] = { idx: i, c }; });

  const r = 0.065;
  const T_entry = 6.0 / (252 * 6.5);
  const rows = [];

  for (const date of expiries) {
    const entry = byDate[date];
    if (!entry) { rows.push({ date, noData: true, bestMult: 0 }); continue; }

    const { idx, c: candle } = entry;

    // Historical vol from last 20 closes before this day
    const prevCloses = rawData
      .slice(Math.max(0, idx - 21), idx)
      .map(x => x.close);
    const vol = histVol(prevCloses);
    const iv  = Math.max(vol * 1.7, 0.30);

    const open  = candle.open;
    const high  = candle.high;
    const low   = candle.low;
    const close = candle.close;
    const atm   = Math.round(open / 100) * 100;

    // ATM premiums at entry (9:30 AM open)
    const ceEntry = bs(open, atm, T_entry, r, iv, 'CE');
    const peEntry = bs(open, atm, T_entry, r, iv, 'PE');

    // Settlement intrinsic at close
    const ceIntrinsic = Math.max(close - atm, 0.05);
    const peIntrinsic = Math.max(atm - close, 0.05);

    // OTM+1 premiums and intrinsics
    const ceOTM1  = bs(open, atm + 100, T_entry, r, iv * 1.08, 'CE');
    const peOTM1  = bs(open, atm - 100, T_entry, r, iv * 1.08, 'PE');
    const ceOTM1I = Math.max(close - (atm + 100), 0.05);
    const peOTM1I = Math.max((atm - 100) - close, 0.05);

    // Multipliers
    const ceMult  = ceEntry  > 0.5 ? ceIntrinsic  / ceEntry  : 0;
    const peMult  = peEntry  > 0.5 ? peIntrinsic  / peEntry  : 0;
    const ceOTM1M = ceOTM1   > 0.5 ? ceOTM1I      / ceOTM1   : 0;
    const peOTM1M = peOTM1   > 0.5 ? peOTM1I      / peOTM1   : 0;

    // Best of all 4
    const allMults = [
      { m: ceMult,  type: 'CALL ATM',   entry: ceEntry,  intrinsic: close - atm },
      { m: peMult,  type: 'PUT  ATM',   entry: peEntry,  intrinsic: atm - close },
      { m: ceOTM1M, type: 'CALL OTM+1', entry: ceOTM1,   intrinsic: close - (atm + 100) },
      { m: peOTM1M, type: 'PUT  OTM+1', entry: peOTM1,   intrinsic: (atm - 100) - close },
    ];
    const best = allMults.reduce((a, b) => b.m > a.m ? b : a);

    const movePct = ((close - open) / open * 100).toFixed(2);
    const dayRange = ((high - low) / open * 100).toFixed(2);

    rows.push({
      date,
      noData: false,
      open:  open.toFixed(0),
      high:  high.toFixed(0),
      low:   low.toFixed(0),
      close: close.toFixed(0),
      atm,
      iv:    (iv * 100).toFixed(1),
      movePct,
      dayRange,
      bestType:      best.type,
      bestEntry:     best.entry.toFixed(1),
      bestIntrinsic: Math.max(best.intrinsic, 0).toFixed(1),
      bestMult:      best.m,
      ceMult:  ceMult.toFixed(2),
      peMult:  peMult.toFixed(2),
      ceOTM1M: ceOTM1M.toFixed(2),
      peOTM1M: peOTM1M.toFixed(2),
      event: EVENT_LABELS[date] || ''
    });
  }

  // Sort by bestMult descending
  const sorted = [...rows]
    .filter(x => !x.noData)
    .sort((a, b) => b.bestMult - a.bestMult);

  // ── Print table ───────────────────────────────────────────────
  console.log('\n' + '='.repeat(125));
  console.log('  SENSEX — ALL 1200 EXPIRY WEEKS RANKED BY BEST ATM/OTM+1 MULTIPLIER');
  console.log('='.repeat(125));
  console.log(
    pad('Rank', 5) + pad('Date', 12) + pad('Best Option', 12) +
    pad('Open', 8) + pad('Close', 8) + pad('Move%', 8) + pad('Range%', 8) +
    pad('ATM', 8) + pad('IV%', 6) + pad('Premium', 9) +
    pad('Intrinsic', 11) + pad('MULTIPLIER', 12) + 'Event / Notes'
  );
  console.log('-'.repeat(125));

  sorted.forEach((row, i) => {
    const rank = padL(i + 1, 4) + '.';
    const mult = row.bestMult;
    let star = '';
    if (mult >= 20) star = '★★★★ 20X+';
    else if (mult >= 10) star = '★★★  10X+';
    else if (mult >= 5)  star = '★★   5X+';
    else if (mult >= 3)  star = '★    3X+';
    else if (mult >= 2)  star = '◆    2X+';
    const notes = (row.event ? '[' + row.event + '] ' : '') + star;
    const multStr = mult.toFixed(2) + 'x';

    console.log(
      rank +
      pad(row.date, 12) +
      pad(row.bestType, 12) +
      padL(row.open, 7)  + ' ' +
      padL(row.close, 7) + ' ' +
      padL((parseFloat(row.movePct) > 0 ? '+' : '') + row.movePct + '%', 8) +
      padL(row.dayRange + '%', 8) +
      padL(row.atm, 7)   + ' ' +
      padL(row.iv + '%', 6) +
      padL(row.bestEntry, 8)     + ' ' +
      padL(row.bestIntrinsic, 10) + ' ' +
      padL(multStr, 11) +
      notes
    );
  });

  console.log('-'.repeat(125));

  // ── Summary stats ─────────────────────────────────────────────
  const total   = sorted.length;
  const above20 = sorted.filter(x => x.bestMult >= 20).length;
  const above10 = sorted.filter(x => x.bestMult >= 10).length;
  const above5  = sorted.filter(x => x.bestMult >= 5).length;
  const above3  = sorted.filter(x => x.bestMult >= 3).length;
  const above2  = sorted.filter(x => x.bestMult >= 2).length;
  const above1  = sorted.filter(x => x.bestMult >= 1).length;

  console.log('\n  MULTIPLIER SUMMARY — ALL ' + total + ' EXPIRY WEEKS WITH DATA');
  console.log('  ' + '-'.repeat(50));
  console.log('  20X+  weeks : ' + above20 + '  (' + (above20/total*100).toFixed(1) + '%)');
  console.log('  10X+  weeks : ' + above10 + '  (' + (above10/total*100).toFixed(1) + '%)');
  console.log('   5X+  weeks : ' + above5  + '  (' + (above5/total*100).toFixed(1)  + '%)');
  console.log('   3X+  weeks : ' + above3  + '  (' + (above3/total*100).toFixed(1)  + '%)');
  console.log('   2X+  weeks : ' + above2  + '  (' + (above2/total*100).toFixed(1)  + '%)');
  console.log('   1X+  weeks : ' + above1  + '  (' + (above1/total*100).toFixed(1)  + '%)');
  console.log('  No data     : ' + rows.filter(x => x.noData).length);
  console.log('='.repeat(125));
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error('ERROR:', err.message); process.exit(1); });
