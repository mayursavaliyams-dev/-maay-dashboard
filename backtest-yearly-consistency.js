/**
 * Year-by-year consistency check on 2y backtest data.
 * Detects strategy drift — is the edge stable, improving, or decaying?
 */
const FILES = [
  ['NIFTY',     'backtest-daily-results-nifty-2y-2024-05-04-to-2026-05-04.json'],
  ['BANKNIFTY', 'backtest-daily-results-banknifty-2y-2024-05-04-to-2026-05-04.json'],
  ['SENSEX',    'backtest-daily-results-sensex-2y-2024-05-04-to-2026-05-04.json'],
];

const LOTS = { NIFTY: 65, BANKNIFTY: 30, SENSEX: 20 };
const MAX_PREM = { NIFTY: 2500/65, BANKNIFTY: 2500/30, SENSEX: 2500/20 };

function load(inst, file) {
  const data = require('./' + file);
  return (data.trades || []).filter(t =>
    t.status === 'OK' && typeof t.entryPrice === 'number'
    && typeof t.exitPrice === 'number' && t.entryTimestamp
    && t.entryPrice >= 0 && t.entryPrice <= MAX_PREM[inst]
  );
}

function group(trades) {
  const byPeriod = new Map();
  for (const t of trades) {
    const d = new Date(t.entryTimestamp * 1000 + 5.5 * 3600 * 1000);
    const yyyy = d.getUTCFullYear();
    const half = d.getUTCMonth() < 6 ? 'H1' : 'H2';
    const key = `${yyyy}-${half}`;
    const r = byPeriod.get(key) || { wins: 0, losses: 0, multSum: 0, pnlAbs: 0, big5x: 0, big10x: 0 };
    if (t.win) r.wins++; else r.losses++;
    r.multSum += t.multiplier || 1;
    r.pnlAbs += Number(t.netPnlAbs || 0);
    if ((t.multiplier || 0) >= 5)  r.big5x++;
    if ((t.multiplier || 0) >= 10) r.big10x++;
    byPeriod.set(key, r);
  }
  return byPeriod;
}

function consecLossStreak(trades) {
  let cur = 0, max = 0;
  for (const t of trades) {
    if (t.win) cur = 0;
    else { cur++; if (cur > max) max = cur; }
  }
  return max;
}

function run() {
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║  YEAR-BY-YEAR CONSISTENCY — IS THE EDGE HOLDING?                  ║');
  console.log('║  Half-year buckets · 2y backtest data · ₹2500 cap                 ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');

  for (const [inst, file] of FILES) {
    const trades = load(inst, file);
    const grouped = group(trades);
    console.log('\n══ ' + inst + ' ══  (total ' + trades.length + ' trades, max consec-loss streak: ' + consecLossStreak(trades) + ')');
    console.log('Period   | Trades | Win% | Avg Mult | 5×+ | 10×+ | ₹NetPnL       | Trend');
    console.log('---------|--------|------|----------|-----|------|---------------|-------');
    const keys = [...grouped.keys()].sort();
    let prevPnl = null;
    let prevWin = null;
    for (const k of keys) {
      const r = grouped.get(k);
      const total = r.wins + r.losses;
      const winPct = total ? +(100 * r.wins / total).toFixed(1) : 0;
      const avgMult = total ? +(r.multSum / total).toFixed(2) : 0;
      const pnl = Math.round(r.pnlAbs);
      let trend = '';
      if (prevPnl !== null) {
        const pnlDelta = pnl - prevPnl;
        const winDelta = winPct - prevWin;
        trend = (pnlDelta > 0 ? '▲' : '▼') + ' ₹' + Math.abs(pnlDelta).toLocaleString('en-IN')
              + '  ' + (winDelta > 0 ? '▲' : '▼') + Math.abs(winDelta).toFixed(1) + '%';
      }
      console.log(
        k.padEnd(8) + ' | ' +
        String(total).padStart(6) + ' | ' +
        String(winPct).padStart(4) + '% | ' +
        String(avgMult).padStart(7) + '× | ' +
        String(r.big5x).padStart(3) + ' | ' +
        String(r.big10x).padStart(4) + ' | ' +
        (pnl >= 0 ? '+₹' : '-₹') + Math.abs(pnl).toLocaleString('en-IN').padStart(11) + ' | ' +
        trend
      );
      prevPnl = pnl;
      prevWin = winPct;
    }
  }
  console.log('\nReading guide:');
  console.log('  ▲ pnl + ▲ win%   = strategy improving');
  console.log('  ▼ pnl + ▼ win%   = strategy decaying — investigate before scaling');
  console.log('  ▲ pnl + ▼ win%   = bigger winners are carrying lower hit rate (lucky tail)');
  console.log('  ▼ pnl + ▲ win%   = trade count down but more selective (good if intentional)\n');
}

run();
