/**
 * Trade-by-trade workbook — every trade, every column, one tab per instrument.
 * Output: exports/win-loss-tabs/trade-by-trade.xlsx
 *   Tabs: NIFTY, BANKNIFTY, SENSEX, ALL
 * Adds: Result (WIN/LOSS), CumulativePnl, RunningWinRate%
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const FILES = [
  { label: 'NIFTY',     csv: 'exports/daily-theoretical-compound-5pct.csv'    },
  { label: 'BANKNIFTY', csv: 'exports/banknifty-theoretical-compound-5pct.csv' },
  { label: 'SENSEX',    csv: 'exports/sensex-theoretical-compound-5pct.csv'    },
];

const NUMERIC = new Set(['Strike','EntryPrice','ExitPrice','Multiplier','EquityBefore','PositionValue','Pnl','EquityAfter','CumulativePnl','RunningWinRate%']);

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
  return (negative ? -1 : 1) * parseFloat(num);
}

function buildSheet(csvPath, instrumentLabel) {
  const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(l => l.trim());
  const header = splitCsvLine(lines[0]);
  const pnlIdx = header.indexOf('Pnl');
  const newHeader = ['#', 'Instrument', ...header.filter(h => h !== 'Result'), 'Result', 'CumulativePnl', 'RunningWinRate%'];
  const rows = [newHeader];

  let cum = 0, wins = 0, total = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const pnl = parseNum(cols[pnlIdx]);
    if (!isFinite(pnl)) continue;
    total++;
    cum += pnl;
    const result = pnl > 0 ? 'WIN' : 'LOSS';
    if (result === 'WIN') wins++;
    const winRate = +(wins / total * 100).toFixed(2);

    const baseCols = header.map((h, idx) => {
      if (h === 'Result') return null;
      const v = cols[idx];
      if (NUMERIC.has(h)) {
        const n = parseNum(v);
        return isFinite(n) ? n : v;
      }
      return v;
    }).filter(v => v !== null);

    rows.push([total, instrumentLabel, ...baseCols, result, +cum.toFixed(2), winRate]);
  }
  return rows;
}

const outDir = path.resolve('exports/win-loss-tabs');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'trade-by-trade.xlsx');

const wb = XLSX.utils.book_new();
const allRows = [];
let allHeaderSet = false;

for (const { label, csv } of FILES) {
  const file = path.resolve(csv);
  if (!fs.existsSync(file)) { console.log(`skip: ${csv}`); continue; }
  const sheet = buildSheet(file, label);
  const ws = XLSX.utils.aoa_to_sheet(sheet);
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, ws, label);
  console.log(`${label}: ${sheet.length - 1} trades`);

  if (!allHeaderSet) { allRows.push(sheet[0]); allHeaderSet = true; }
  for (let i = 1; i < sheet.length; i++) allRows.push(sheet[i]);
}

// Renumber the # column on the ALL tab
for (let i = 1; i < allRows.length; i++) allRows[i][0] = i;
const wsAll = XLSX.utils.aoa_to_sheet(allRows);
XLSX.utils.book_append_sheet(wb, wsAll, 'ALL');

XLSX.writeFile(wb, outPath);
console.log(`\nWritten: ${outPath}`);
console.log(`Tabs: NIFTY | BANKNIFTY | SENSEX | ALL  (${allRows.length - 1} trades total)`);
