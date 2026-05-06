/**
 * ROI summary — Total Return On Investment per instrument.
 * Output: exports/win-loss-tabs/roi-summary.xlsx
 *   Tab "ROI" — instrument, capital, final equity, profit, loss, net, ROI%, multiplier, CAGR%, span
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const FILES = [
  { label: 'NIFTY',     csv: 'exports/daily-theoretical-compound-5pct.csv'     },
  { label: 'BANKNIFTY', csv: 'exports/banknifty-theoretical-compound-5pct.csv' },
  { label: 'SENSEX',    csv: 'exports/sensex-theoretical-compound-5pct.csv'    },
];

function splitCsvLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
function parseNum(raw) {
  if (raw == null) return NaN;
  const s = String(raw).replace(/"/g, '').trim();
  const neg = s.startsWith('-');
  const num = s.replace(/[^0-9.]/g, '');
  if (!num) return NaN;
  return (neg ? -1 : 1) * parseFloat(num);
}
function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/"/g, '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00Z');
  const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00Z`);
  return null;
}

const rows = [
  ['Instrument','Initial Capital ₹','Final Equity ₹','Total Profit ₹','Total Loss ₹','Net P&L ₹','ROI %','Multiplier (×)','First Trade','Last Trade','Years','CAGR %','Trades','Win %']
];

let agg = { cap: 0, fin: 0, p: 0, l: 0, trades: 0, wins: 0 };

for (const { label, csv } of FILES) {
  const file = path.resolve(csv);
  if (!fs.existsSync(file)) continue;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.trim());
  const header = splitCsvLine(lines[0]);
  const idx = {
    Date:        header.indexOf('Date'),
    EquityBefore:header.indexOf('EquityBefore'),
    EquityAfter: header.indexOf('EquityAfter'),
    Pnl:         header.indexOf('Pnl'),
  };

  const first = splitCsvLine(lines[1]);
  const last  = splitCsvLine(lines[lines.length - 1]);
  const initial = parseNum(first[idx.EquityBefore]);
  const final   = parseNum(last[idx.EquityAfter]);

  let totalP = 0, totalL = 0, trades = 0, wins = 0;
  for (let i = 1; i < lines.length; i++) {
    const pnl = parseNum(splitCsvLine(lines[i])[idx.Pnl]);
    if (!isFinite(pnl)) continue;
    trades++;
    if (pnl > 0) { wins++; totalP += pnl; } else { totalL += pnl; }
  }
  const net = totalP + totalL;
  const roiPct = (net / initial) * 100;
  const mult   = final / initial;

  const dStart = parseDate(first[idx.Date]);
  const dEnd   = parseDate(last[idx.Date]);
  const years  = (dStart && dEnd) ? (dEnd - dStart) / (365.25 * 24 * 3600 * 1000) : null;
  const cagr   = (years && years > 0) ? (Math.pow(mult, 1 / years) - 1) * 100 : null;

  rows.push([
    label,
    +initial.toFixed(2),
    +final.toFixed(2),
    +totalP.toFixed(2),
    +totalL.toFixed(2),
    +net.toFixed(2),
    +roiPct.toFixed(2),
    +mult.toFixed(2),
    dStart ? dStart.toISOString().slice(0,10) : '',
    dEnd   ? dEnd.toISOString().slice(0,10)   : '',
    years ? +years.toFixed(2) : '',
    cagr  ? +cagr.toFixed(2)  : '',
    trades,
    +(wins / trades * 100).toFixed(2),
  ]);

  agg.cap += initial;
  agg.fin += final;
  agg.p   += totalP;
  agg.l   += totalL;
  agg.trades += trades;
  agg.wins   += wins;
}

const aggNet = agg.p + agg.l;
const aggRoi = (aggNet / agg.cap) * 100;
const aggMult = agg.fin / agg.cap;
rows.push([
  'TOTAL (₹50k × 3)',
  +agg.cap.toFixed(2),
  +agg.fin.toFixed(2),
  +agg.p.toFixed(2),
  +agg.l.toFixed(2),
  +aggNet.toFixed(2),
  +aggRoi.toFixed(2),
  +aggMult.toFixed(2),
  '', '', '', '',
  agg.trades,
  +(agg.wins / agg.trades * 100).toFixed(2),
]);

const outDir = path.resolve('exports/win-loss-tabs');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'roi-summary.xlsx');

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(rows);
ws['!cols'] = rows[0].map(() => ({ wch: 18 }));
XLSX.utils.book_append_sheet(wb, ws, 'ROI');
XLSX.writeFile(wb, outPath);

console.log(`Written: ${outPath}\n`);
const w = (s, n) => String(s).padStart(n);
for (const r of rows) {
  console.log(r.map((v, i) => w(v, i === 0 ? 18 : 16)).join('  '));
}
