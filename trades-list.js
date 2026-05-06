/**
 * Print every backtest trade chronologically with IST entry/exit time,
 * spot at entry, strike, premiums, multiplier, and P&L.
 */
const fs = require('fs');
const path = require('path');

const REPORT_PATH = path.resolve('./backtest-real-results.json');
if (!fs.existsSync(REPORT_PATH)) {
  console.error(`No report at ${REPORT_PATH}. Run \`npm run backtest\` first.`);
  process.exit(1);
}
const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
const trades = (report.trades || []).slice().sort((a, b) => a.entryTimestamp - b.entryTimestamp);

if (!trades.length) { console.error('No trades.'); process.exit(1); }

const fmtIst = (unixSec) =>
  new Date(unixSec * 1000).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });

const fmtTime = (unixSec) =>
  new Date(unixSec * 1000).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', hour12: false,
    hour: '2-digit', minute: '2-digit'
  });

const pad = (s, n, l = false) => l ? String(s).padEnd(n) : String(s).padStart(n);

console.log(`\n${trades.length} trades  (${trades[0].date} → ${trades[trades.length-1].date})\n`);
console.log(`#    DATE        DAY  TYPE  ENTRY  EXIT   STRIKE   SPOT@ENT   ENTRY₹   EXIT₹    MULT    PnL%      REASON`);
console.log(`---  ----------  ---  ----  -----  -----  ------   --------   ------   ------   ------  -------   ----------`);

let i = 0;
let cumPnl = 0;
for (const t of trades) {
  i++;
  const entry  = fmtTime(t.entryTimestamp);
  const exit   = fmtTime(t.exitTimestamp);
  cumPnl += t.pnlPct;
  const winFlag = t.win ? '✓' : '✗';
  console.log(
    `${pad(i, 3)}  ${pad(t.date, 10)}  ${pad(t.weekday, 3)}  ${pad(t.type, 4, true)} ` +
    ` ${pad(entry, 5)}  ${pad(exit, 5)}  ${pad(t.strike || '—', 6)}   ` +
    `${pad((t.spotAtEntry || 0).toFixed(2), 8)}   ` +
    `${pad(t.entryPrice.toFixed(2), 6)}   ${pad(t.exitPrice.toFixed(2), 6)}   ` +
    `${pad(t.multiplier.toFixed(3) + '×', 6)}  ${pad((t.pnlPct >= 0 ? '+' : '') + t.pnlPct.toFixed(1), 6)}%  ${pad(t.reason, 10, true)}`
  );
}

console.log(`\nCumulative simple-sum P&L: ${cumPnl >= 0 ? '+' : ''}${cumPnl.toFixed(1)}%   (compounded ledger: \`node equity-curve.js\`)`);
