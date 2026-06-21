// ============================================================================
//  bt-lib.js — shared helpers for the bt-strangle-*.js backtests.
//
//  Extracted verbatim from the byte-identical blocks the strangle backtests each
//  carried, so all of them load NSE F&O bhavcopy the same way (one source of
//  truth, no copy-paste drift). Behaviour-preserving — same loader, same sizing.
// ============================================================================
const fs = require('fs');
const path = require('path');

const BHAV = 'bt-data/bhav';
const LOT = 75, CAPITAL = 100000, RISK_PCT = 0.05;

// col idx: TradDt0 Xpry9 Strk11 Optn12 Opn14 Hgh15 Lw16 Cls17 Undrlyg20 OI22
function loadDay(file) {
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => l.split(','));
  if (!rows.length) return null;
  const date = rows[0][0], underlying = +rows[0][20];
  const opts = rows.map(r => ({ xpry: r[9], strike: +r[11], type: r[12], o: +r[14], h: +r[15], l: +r[16], c: +r[17], oi: +r[22] }))
    .filter(o => o.o > 0 && o.strike > 0);
  if (!opts.length) return null;
  const exps = [...new Set(opts.map(o => o.xpry))].filter(e => e >= date).sort();
  return { date, underlying, nearExp: exps[0], opts };
}
const leg = (day, type, strike) => day.opts.find(o => o.type === type && o.strike === strike && o.xpry === day.nearExp);
const atmStrike = (day, step = 50) => Math.round(day.underlying / step) * step;
const sizeLots = (cap, prem) => Math.min(25, Math.max(1, Math.floor((cap * RISK_PCT) / Math.max(1, prem * LOT))));

// Convenience: load every bhavcopy NIFTY day from `dir`, sorted by date.
function loadDays(dir = BHAV) {
  return fs.readdirSync(dir).filter(f => f.startsWith('nifty-') && f.endsWith('.csv')).sort()
    .map(f => loadDay(path.join(dir, f))).filter(Boolean);
}

module.exports = { BHAV, LOT, CAPITAL, RISK_PCT, loadDay, leg, atmStrike, sizeLots, loadDays };
