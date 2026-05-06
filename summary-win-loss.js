/**
 * One Excel file, one sheet — counts profit/loss per instrument.
 * Output: exports/win-loss-tabs/summary.xlsx
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const FILES = [
  { label: 'NIFTY',     csv: 'exports/daily-theoretical-compound-5pct.csv'    },
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
  const negative = s.startsWith('-');
  const num = s.replace(/[^0-9.]/g, '');
  if (!num) return NaN;
  const n = parseFloat(num);
  return negative ? -n : n;
}

const rows = [
  ['Instrument', 'Total Trades', 'Profit Count', 'Loss Count', 'Win Rate %', 'Total Profit', 'Total Loss', 'Net P&L', 'Avg Profit', 'Avg Loss']
];

let gTrades = 0, gWin = 0, gLoss = 0, gPro = 0, gLos = 0;

for (const { label, csv } of FILES) {
  const file = path.resolve(csv);
  if (!fs.existsSync(file)) continue;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l.trim());
  const header = splitCsvLine(lines[0]);
  const pnlIdx = header.indexOf('Pnl');
  if (pnlIdx === -1) continue;

  let trades = 0, wins = 0, losses = 0, totalP = 0, totalL = 0;
  for (let i = 1; i < lines.length; i++) {
    const pnl = parseNum(splitCsvLine(lines[i])[pnlIdx]);
    if (!isFinite(pnl)) continue;
    trades++;
    if (pnl > 0) { wins++;   totalP += pnl; }
    else         { losses++; totalL += pnl; }
  }
  const net = totalP + totalL;
  rows.push([
    label,
    trades,
    wins,
    losses,
    +((wins / trades) * 100).toFixed(2),
    +totalP.toFixed(2),
    +totalL.toFixed(2),
    +net.toFixed(2),
    +(totalP / Math.max(wins, 1)).toFixed(2),
    +(totalL / Math.max(losses, 1)).toFixed(2),
  ]);

  gTrades += trades; gWin += wins; gLoss += losses; gPro += totalP; gLos += totalL;
}

rows.push([
  'TOTAL',
  gTrades, gWin, gLoss,
  +((gWin / gTrades) * 100).toFixed(2),
  +gPro.toFixed(2), +gLos.toFixed(2), +(gPro + gLos).toFixed(2),
  +(gPro / Math.max(gWin, 1)).toFixed(2),
  +(gLos / Math.max(gLoss, 1)).toFixed(2),
]);

const outDir = path.resolve('exports/win-loss-tabs');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'summary.xlsx');

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(rows);
ws['!cols'] = [
  { wch: 14 }, { wch: 13 }, { wch: 13 }, { wch: 11 }, { wch: 11 },
  { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 13 }, { wch: 13 }
];
XLSX.utils.book_append_sheet(wb, ws, 'Summary');
XLSX.writeFile(wb, outPath);

console.log(`Written: ${outPath}\n`);
console.log(rows.map(r => r.join('\t')).join('\n'));
