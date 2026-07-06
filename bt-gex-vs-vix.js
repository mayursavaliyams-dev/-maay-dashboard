// ============================================================================
//  bt-gex-vs-vix.js — India GEX-vs-VIX partial-correlation harness (research #4)
//
//  Open question from the deep research: the SPY 8-year study found dealer-gamma (GEX)
//  predictive power for next-day realized vol COLLAPSES to noise once VIX/ATM-IV is
//  controlled (raw Spearman −0.36 → partial −0.03, p=0.18) — i.e. GEX is mostly repackaged
//  VIX. Does that transfer to NIFTY/BankNifty? We can't assume it; we must MEASURE it on
//  Indian data. This is the validated harness to do so: it pairs each day's GEX with the
//  NEXT day's realized vol and reports the raw vs VIX-controlled (partial) rank correlation.
//
//  Pure stats (rank / Spearman / partial-Spearman) are unit-tested against synthetic data
//  with a known answer. main() runs on data/gex-vix-history.json, which the server appends
//  to daily — so the real India verdict emerges as samples accumulate (needs >=20 days).
// ============================================================================
'use strict';
const round = (v, d = 3) => +(+v).toFixed(d);

// average ranks (ties → mean rank)
function rank(arr) {
  const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(arr.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
function pearson(x, y) {
  const n = x.length; if (n < 2) return 0;
  const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sx += dx * dx; sy += dy * dy; }
  return (sx > 0 && sy > 0) ? sxy / Math.sqrt(sx * sy) : 0;
}
const spearman = (x, y) => pearson(rank(x), rank(y));
// partial Spearman of (x,y) controlling for z, via the standard first-order partial formula
function partialSpearman(x, y, z) {
  const rxy = spearman(x, y), rxz = spearman(x, z), ryz = spearman(y, z);
  const den = Math.sqrt((1 - rxz * rxz) * (1 - ryz * ryz));
  return den > 0 ? (rxy - rxz * ryz) / den : 0;
}

/**
 * Analyze GEX → next-day realized-vol predictive power, raw vs VIX-controlled.
 * @param {Array} daily  rows [{date, gex, vix, rv}] sorted by date
 * @returns verdict object
 */
function analyze(daily, opts = {}) {
  const minN = opts.minN || 20;
  const rows = (daily || []).filter(r => r && isFinite(r.gex) && isFinite(r.vix) && isFinite(r.rv))
    .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  // pair day t's GEX/VIX with day t+1's realized vol
  const gex = [], vix = [], nextRV = [];
  for (let i = 0; i < rows.length - 1; i++) { gex.push(rows[i].gex); vix.push(rows[i].vix); nextRV.push(rows[i + 1].rv); }
  if (gex.length < minN) return { ok: false, n: gex.length, reason: `insufficient aligned days (${gex.length}/${minN}) — recorder is accumulating`, };
  const raw = spearman(gex, nextRV);
  const partial = partialSpearman(gex, nextRV, vix);
  const shrinkage = Math.abs(raw) > 1e-9 ? 1 - Math.abs(partial) / Math.abs(raw) : 0;
  const verdict = Math.abs(partial) < 0.08 ? 'GEX ≈ VIX repackaged — no independent edge (matches SPY finding)'
    : Math.abs(partial) < Math.abs(raw) * 0.5 ? 'GEX mostly VIX — weak residual signal'
      : 'GEX retains independent signal on NIFTY — does NOT match SPY';
  return {
    ok: true, n: gex.length, rawRho: round(raw), partialRho: round(partial),
    shrinkagePct: Math.round(shrinkage * 100), verdict,
    note: 'SPY 8-yr benchmark: raw −0.36 → partial −0.03 (94% shrinkage). If India shrinks similarly, keep GEX as a regime label only.',
  };
}

// ── persistence helpers (server appends one row/day) ──
function loadHistory(fs, path) {
  try { const j = JSON.parse(fs.readFileSync(path, 'utf8')); return Array.isArray(j) ? j : (Array.isArray(j.rows) ? j.rows : []); }
  catch (_) { return []; }
}
function appendDaily(fs, path, row, cap = 800) {
  const rows = loadHistory(fs, path);
  if (rows.some(r => r.date === row.date && r.inst === row.inst)) return rows;   // one per inst per day
  rows.push(row);
  while (rows.length > cap) rows.shift();
  try { fs.writeFileSync(path, JSON.stringify(rows, null, 2)); } catch (_) {}
  return rows;
}

module.exports = { analyze, spearman, partialSpearman, rank, pearson, loadHistory, appendDaily };

// CLI: node bt-gex-vs-vix.js  → run the analysis per instrument on the recorded history
if (require.main === module) {
  const fs = require('fs'), path = require('path');
  const p = path.join(__dirname, 'data', 'gex-vix-history.json');
  const rows = loadHistory(fs, p);
  const byInst = {};
  for (const r of rows) (byInst[r.inst || 'NIFTY'] = byInst[r.inst || 'NIFTY'] || []).push(r);
  console.log(`GEX-vs-VIX analysis — ${rows.length} recorded rows across ${Object.keys(byInst).length} instrument(s)\n`);
  for (const inst of Object.keys(byInst)) console.log(inst + ':', JSON.stringify(analyze(byInst[inst]), null, 2));
  if (!rows.length) console.log('No history yet — the server records one GEX/VIX/RV row per instrument per trading day. Re-run after ~20+ sessions.');
}
