/**
 * Split each theoretical-compound CSV into an Excel workbook with two tabs:
 *   - "WIN"  — only winning trades
 *   - "LOSS" — only losing trades
 * Definition: WIN = Pnl > 0, LOSS otherwise.
 * Output: exports/win-loss-tabs/<name>.xlsx
 */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const FILES = [
  'exports/daily-theoretical-compound-5pct.csv',
  'exports/banknifty-theoretical-compound-5pct.csv',
  'exports/sensex-theoretical-compound-5pct.csv',
];

const outDir = path.resolve('exports/win-loss-tabs');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; continue; }
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

function parseNum(raw) {
  const n = parsePnl(raw);
  return isFinite(n) ? n : raw;
}

const NUMERIC_COLS = new Set(['Strike','EntryPrice','ExitPrice','Multiplier','EquityBefore','PositionValue','Pnl','EquityAfter']);

for (const rel of FILES) {
  const file = path.resolve(rel);
  if (!fs.existsSync(file)) { console.log(`skip (missing): ${rel}`); continue; }

  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  const header = splitCsvLine(lines[0]);
  const pnlIdx = header.indexOf('Pnl');
  if (pnlIdx === -1) { console.log(`skip (no Pnl col): ${rel}`); continue; }

  const winRows = [header];
  const lossRows = [header];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    // Coerce numeric columns to actual numbers so Excel sorts/filters work.
    const row = cols.map((v, idx) => NUMERIC_COLS.has(header[idx]) ? parseNum(v) : v);
    const pnl = parsePnl(cols[pnlIdx]);
    if (pnl > 0) winRows.push(row); else lossRows.push(row);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(winRows),  'WIN');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(lossRows), 'LOSS');

  const base = path.basename(rel, '.csv');
  const outPath = path.join(outDir, `${base}.xlsx`);
  XLSX.writeFile(wb, outPath);
  console.log(`${outPath}  —  WIN ${winRows.length-1} / LOSS ${lossRows.length-1}`);
}
