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
// LOT is the CURRENT NIFTY lot and is retained only so existing callers keep working. It is NOT
// the lot for most of the history: the bhavcopy carries NewBrdLotQty on every row (column 28), and
// across the 600 days it is 25, 50, 65 or 75 — the hardcoded 75 is wrong on 59.3% of them
// (constraint F1: "lot size is time-varying and lives in the data"). Prefer `loadDay().lot`.
const LOT = 75, CAPITAL = 100000, RISK_PCT = 0.05;

// col idx: TradDt0 Xpry9 Strk11 Optn12 Opn14 Hgh15 Lw16 Cls17 UndrlygPric20 OI22 NewBrdLotQty28
function loadDay(file) {
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => l.split(','));
  if (!rows.length) return null;
  const date = rows[0][0], underlying = +rows[0][20];

  // Column 20 is `UndrlygPric` — the underlying's CLOSING level for that day. It is exposed under
  // both names: `underlying` for the existing callers, and `underlyingClose` so that no future
  // reader can mistake it for a price available at the open. Two backtests were invalidated by
  // exactly that mistake (docs/REVIEW-selling-edge-invalidated.md).
  //
  // NOTE: atmStrike() still reads it. Whether a strategy may see today's close is a STRATEGY
  // decision, not a library one, so it is deliberately left to each script to fix, with its own
  // review. This loader's job is to stop hiding what the number is.
  const underlyingClose = underlying;

  // The real, per-day lot, straight from the data. `null` when unreadable — NEVER a fallback to 75.
  // A guessed contract size is how the hardcoded LOT silently mis-sized 356 of 600 days.
  const rawLot = +rows[0][28];
  const lot = Number.isFinite(rawLot) && rawLot > 0 ? rawLot : null;

  const opts = rows.map(r => ({ xpry: r[9], strike: +r[11], type: r[12], o: +r[14], h: +r[15], l: +r[16], c: +r[17], oi: +r[22] }))
    .filter(o => o.o > 0 && o.strike > 0);
  if (!opts.length) return null;
  const exps = [...new Set(opts.map(o => o.xpry))].filter(e => e >= date).sort();
  return { date, underlying, underlyingClose, lot, nearExp: exps[0], opts };
}
const leg = (day, type, strike) => day.opts.find(o => o.type === type && o.strike === strike && o.xpry === day.nearExp);
const atmStrike = (day, step = 50) => Math.round(day.underlying / step) * step;
// `lot` defaults to the hardcoded LOT so every existing 2-argument call returns exactly what it did
// before. Pass `day.lot` to size against the contract that actually traded that day.
const sizeLots = (cap, prem, lot = LOT) => Math.min(25, Math.max(1, Math.floor((cap * RISK_PCT) / Math.max(1, prem * lot))));

// Convenience: load every bhavcopy NIFTY day from `dir`, sorted by date.
function loadDays(dir = BHAV) {
  return fs.readdirSync(dir).filter(f => f.startsWith('nifty-') && f.endsWith('.csv')).sort()
    .map(f => loadDay(path.join(dir, f))).filter(Boolean);
}

module.exports = { BHAV, LOT, CAPITAL, RISK_PCT, loadDay, leg, atmStrike, sizeLots, loadDays };
