/**
 * Edge-zone analysis: identify WHEN the strategy actually works.
 * Day-of-week, hour-of-day, and weekday-time matrix breakdowns.
 * Pure post-hoc analysis on existing 2y backtest data — no live code touched.
 */
const FILES = [
  ['NIFTY',     'backtest-daily-results-nifty-2y-2024-05-04-to-2026-05-04.json'],
  ['BANKNIFTY', 'backtest-daily-results-banknifty-2y-2024-05-04-to-2026-05-04.json'],
  ['SENSEX',    'backtest-daily-results-sensex-2y-2024-05-04-to-2026-05-04.json'],
];

const POSITION_CAP_INR = 2500;
const LOTS = { NIFTY: 65, BANKNIFTY: 30, SENSEX: 20 };
const MAX_PREM = {
  NIFTY:     POSITION_CAP_INR / LOTS.NIFTY,
  BANKNIFTY: POSITION_CAP_INR / LOTS.BANKNIFTY,
  SENSEX:    POSITION_CAP_INR / LOTS.SENSEX,
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function load(inst, file) {
  const data = require('./' + file);
  return (data.trades || [])
    .filter(t => t.status === 'OK' && typeof t.entryPrice === 'number'
      && typeof t.exitPrice === 'number' && t.entryTimestamp
      && t.entryPrice >= 0 && t.entryPrice <= MAX_PREM[inst]);
}

function bucket(trades) {
  const byDay  = new Map();         // 'Mon' → {wins, total, mult, pnlSum}
  const byHour = new Map();         // 9.5 → ...
  const byCell = new Map();         // 'Mon-9.5' → ...
  for (const t of trades) {
    const d = new Date(t.entryTimestamp * 1000 + 5.5 * 3600 * 1000);
    const dow = DAYS[d.getUTCDay()];
    const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
    const slot = hour < 9.5 ? '09:15'
               : hour < 9.75 ? '09:30'
               : hour < 10.0 ? '09:45'
               : hour < 10.25 ? '10:00'
               : hour < 10.5 ? '10:15'
               : hour < 11 ? '10:30'
               : hour < 12 ? '11:00+'
               : hour < 13 ? '12:00+'
               : hour < 14 ? '13:00+'
               : '14:00+';
    const cell = `${dow}-${slot}`;
    const pnlMult = t.win ? (t.multiplier || 1) : 0;
    for (const [map, key] of [[byDay, dow], [byHour, slot], [byCell, cell]]) {
      const r = map.get(key) || { wins: 0, total: 0, multSum: 0, pnlAbsSum: 0 };
      r.total++;
      if (t.win) r.wins++;
      r.multSum += pnlMult;
      r.pnlAbsSum += Number(t.netPnlAbs || 0);
      map.set(key, r);
    }
  }
  return { byDay, byHour, byCell };
}

function renderTable(title, map, sortBy = 'pnlAbsSum') {
  console.log('\n── ' + title);
  console.log('Key      | Trades | Win% | Avg Mult | Total ₹NetPnL');
  console.log('---------|--------|------|----------|---------------');
  const rows = [...map.entries()].map(([k, r]) => ({
    k,
    total: r.total,
    winPct: r.total ? +(100 * r.wins / r.total).toFixed(1) : 0,
    avgMult: r.total ? +(r.multSum / r.total).toFixed(2) : 0,
    pnl: Math.round(r.pnlAbsSum)
  }));
  rows.sort((a, b) => {
    if (sortBy === 'day') return DAYS.indexOf(a.k) - DAYS.indexOf(b.k);
    if (sortBy === 'slot') return a.k.localeCompare(b.k);
    return b.pnl - a.pnl;
  });
  for (const r of rows) {
    const pnlColor = r.pnl >= 0 ? '+₹' : '-₹';
    console.log(
      r.k.padEnd(9) + '| ' +
      String(r.total).padStart(6) + ' | ' +
      String(r.winPct).padStart(4) + '% | ' +
      String(r.avgMult).padStart(7) + '× | ' +
      pnlColor + Math.abs(r.pnl).toLocaleString('en-IN').padStart(10)
    );
  }
}

function run() {
  const merged = { byDay: new Map(), byHour: new Map(), byCell: new Map() };
  for (const [inst, file] of FILES) {
    const trades = load(inst, file);
    const b = bucket(trades);
    // Merge per-instrument into combined
    for (const [key, val] of b.byDay)  mergeInto(merged.byDay,  key, val);
    for (const [key, val] of b.byHour) mergeInto(merged.byHour, key, val);
    for (const [key, val] of b.byCell) mergeInto(merged.byCell, key, val);
  }
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  EDGE-ZONE ANALYSIS — COMBINED (NIFTY + BANKNIFTY + SENSEX)  ║');
  console.log('║  2 years · 1200 expiries · ₹2500 position cap · ₹60 RT       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  renderTable('BY DAY-OF-WEEK (sorted: chronological)',     merged.byDay,  'day');
  renderTable('BY ENTRY TIME (sorted: chronological)',      merged.byHour, 'slot');
  console.log('\n── TOP 10 EDGE CELLS (Day × Time, sorted by ₹ pnl)');
  console.log('Cell           | Trades | Win% | Avg Mult | Total ₹NetPnL');
  console.log('---------------|--------|------|----------|---------------');
  const cellRows = [...merged.byCell.entries()].map(([k, r]) => ({
    k, total: r.total,
    winPct: r.total ? +(100 * r.wins / r.total).toFixed(1) : 0,
    avgMult: r.total ? +(r.multSum / r.total).toFixed(2) : 0,
    pnl: Math.round(r.pnlAbsSum)
  })).filter(r => r.total >= 8).sort((a, b) => b.pnl - a.pnl);
  for (const r of cellRows.slice(0, 10)) {
    console.log(
      r.k.padEnd(15) + '| ' +
      String(r.total).padStart(6) + ' | ' +
      String(r.winPct).padStart(4) + '% | ' +
      String(r.avgMult).padStart(7) + '× | ' +
      '+₹' + r.pnl.toLocaleString('en-IN').padStart(10)
    );
  }
  console.log('\n── BOTTOM 5 EDGE CELLS (avoid these times)');
  console.log('Cell           | Trades | Win% | Avg Mult | Total ₹NetPnL');
  console.log('---------------|--------|------|----------|---------------');
  for (const r of cellRows.slice(-5).reverse()) {
    console.log(
      r.k.padEnd(15) + '| ' +
      String(r.total).padStart(6) + ' | ' +
      String(r.winPct).padStart(4) + '% | ' +
      String(r.avgMult).padStart(7) + '× | ' +
      (r.pnl >= 0 ? '+₹' : '-₹') + Math.abs(r.pnl).toLocaleString('en-IN').padStart(10)
    );
  }
  console.log('');
}

function mergeInto(map, key, val) {
  const r = map.get(key) || { wins: 0, total: 0, multSum: 0, pnlAbsSum: 0 };
  r.wins += val.wins; r.total += val.total;
  r.multSum += val.multSum; r.pnlAbsSum += val.pnlAbsSum;
  map.set(key, r);
}

run();
