/**
 * Post-mortem: of the trades the trend gate blocked, how many were wins vs losses?
 * Also: which filter variants (4-streak, 5-streak, time-decayed) would have done better?
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

function load(inst, file) {
  const data = require('./' + file);
  return (data.trades || [])
    .filter(t => t.status === 'OK' && typeof t.entryPrice === 'number'
      && typeof t.exitPrice === 'number' && t.entryTimestamp
      && t.entryPrice >= 0 && t.entryPrice <= MAX_PREM[inst])
    .sort((a, b) => a.entryTimestamp - b.entryTimestamp);
}

function postmortemGate(trades, streakLen) {
  const recent = [];
  let blockedWin = 0, blockedLoss = 0, takenWin = 0, takenLoss = 0;
  const blockedPnl = [];
  const takenPnl = [];
  for (const t of trades) {
    const side = (t.type || '').toUpperCase();
    const won = !!t.win;
    if (recent.length === streakLen) {
      const allCall = recent.every(s => s === 'CALL');
      const allPut  = recent.every(s => s === 'PUT');
      const oppose = (allCall && side === 'PUT') || (allPut && side === 'CALL');
      if (oppose) {
        if (won) blockedWin++; else blockedLoss++;
        blockedPnl.push({ won, multiplier: t.multiplier, pnlPct: t.pnlPct });
        continue;
      }
    }
    if (won) takenWin++; else takenLoss++;
    takenPnl.push({ won, multiplier: t.multiplier, pnlPct: t.pnlPct });
    recent.push(side);
    if (recent.length > streakLen) recent.shift();
  }
  const totalBlocked = blockedWin + blockedLoss;
  const totalTaken   = takenWin + takenLoss;
  return {
    streakLen,
    blocked:       totalBlocked,
    blockedWinRate: totalBlocked ? +(100 * blockedWin / totalBlocked).toFixed(1) : null,
    blockedAvgMult: totalBlocked
      ? +(blockedPnl.reduce((s, t) => s + (t.multiplier || 1), 0) / totalBlocked).toFixed(2)
      : null,
    taken:         totalTaken,
    takenWinRate:  totalTaken ? +(100 * takenWin / totalTaken).toFixed(1) : null,
    takenAvgMult:  totalTaken
      ? +(takenPnl.reduce((s, t) => s + (t.multiplier || 1), 0) / totalTaken).toFixed(2)
      : null,
    blockedBigWins: blockedPnl.filter(t => t.won && (t.multiplier || 1) >= 3).length,
    blockedBigLoss: blockedPnl.filter(t => !t.won && (t.pnlPct || 0) < -50).length,
  };
}

function run() {
  for (const [inst, file] of FILES) {
    const trades = load(inst, file);
    console.log('\n══ ' + inst + ' ══  (total ' + trades.length + ' trades)');
    console.log('streak | blocked | blocked-win% | blocked-avg-mult | taken | taken-win% | taken-avg-mult | big-wins-lost | big-losses-avoided');
    console.log('-'.repeat(140));
    for (const streakLen of [3, 4, 5, 6]) {
      const r = postmortemGate(trades, streakLen);
      console.log(
        String(streakLen).padStart(6) + ' | ' +
        String(r.blocked).padStart(7) + ' | ' +
        String(r.blockedWinRate ?? '--').padStart(12) + '% | ' +
        String(r.blockedAvgMult ?? '--').padStart(15) + '× | ' +
        String(r.taken).padStart(5) + ' | ' +
        String(r.takenWinRate ?? '--').padStart(9) + '% | ' +
        String(r.takenAvgMult ?? '--').padStart(13) + '× | ' +
        String(r.blockedBigWins).padStart(13) + ' | ' +
        String(r.blockedBigLoss).padStart(17)
      );
    }
  }
  console.log('\nKey: ');
  console.log('  blocked-win%  → if > taken-win%, gate is filtering AGAINST you (blocking winners)');
  console.log('  big-wins-lost → blocked trades that hit ≥3× target (these are the irreversible misses)');
  console.log('  big-losses-avoided → blocked trades that lost >50% (these justify the gate)');
}

run();
