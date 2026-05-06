/**
 * Add a Result column (WIN/LOSS) to theoretical-compound CSVs.
 * Rule: Pnl > 0 → WIN, otherwise LOSS.
 * Pnl values may be like "? 9,750.00" or "-? 206.14" — strip non-numeric chars.
 */
const fs = require('fs');
const path = require('path');

const FILES = [
  'exports/daily-theoretical-compound-5pct.csv',
  'exports/banknifty-theoretical-compound-5pct.csv',
  'exports/sensex-theoretical-compound-5pct.csv',
];

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; cur += ch; continue; }
    if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function parsePnl(raw) {
  if (raw == null) return NaN;
  const s = String(raw).replace(/"/g, '').trim();
  const negative = s.startsWith('-');
  const num = s.replace(/[^0-9.]/g, '');
  if (!num) return NaN;
  const n = parseFloat(num);
  return negative ? -n : n;
}

let totalWin = 0, totalLoss = 0;

for (const rel of FILES) {
  const file = path.resolve(rel);
  if (!fs.existsSync(file)) { console.log(`skip (missing): ${rel}`); continue; }

  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const header = splitCsvLine(lines[0]).map(h => h.replace(/^"|"$/g, ''));
  if (header.includes('Result')) {
    console.log(`skip (already has Result): ${rel}`);
    continue;
  }
  const pnlIdx = header.indexOf('Pnl');
  if (pnlIdx === -1) { console.log(`skip (no Pnl col): ${rel}`); continue; }

  const origHeader = splitCsvLine(lines[0]);
  const headerQuoted = origHeader[0].startsWith('"');
  const resultHeaderCell = headerQuoted ? '"Result"' : 'Result';
  const out = [origHeader.concat(resultHeaderCell).join(',')];
  let win = 0, loss = 0;
  for (let i = 1; i < lines.length; i++) {
    const ln = lines[i];
    if (!ln.trim()) { out.push(ln); continue; }
    const cols = splitCsvLine(ln);
    const pnl = parsePnl(cols[pnlIdx]);
    const result = pnl > 0 ? 'WIN' : 'LOSS';
    if (result === 'WIN') win++; else loss++;
    const resultCell = headerQuoted ? `"${result}"` : result;
    out.push(cols.concat(resultCell).join(','));
  }

  fs.writeFileSync(file, out.join('\n'), 'utf8');
  console.log(`${rel} — ${win} WIN / ${loss} LOSS  (win-rate ${(win/(win+loss)*100).toFixed(1)}%)`);
  totalWin += win;
  totalLoss += loss;
}

console.log(`\nTOTAL — ${totalWin} WIN / ${totalLoss} LOSS  (win-rate ${(totalWin/(totalWin+totalLoss)*100).toFixed(1)}%)`);
