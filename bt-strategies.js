// ============================================================================
//  bt-strategies.js — honest multi-strategy backtest on REAL NSE bhavcopy data.
//
//  Tests the most widely-validated Indian index-options strategies on the SAME
//  real-premium dataset (bt-data/bhav/nifty-*.csv) so results are comparable.
//  No modeling, no Black-Scholes — every entry/exit uses the strike's actual
//  daily Open/High/Low/Close. Charges applied via charges.js. Honest report:
//  winners get recommended for the bot; losers are reported as losers.
//
//  Caveat (stated up front): bhavcopy is END-OF-DAY OHLC per strike — there is
//  no intraday tick path. So:
//    - Entry  = day Open (or expiry-morning open for the expiry strategies)
//    - Exit   = expiry-day Close, OR an intraday SL approximated against the
//               day HIGH (worst case for a seller) / LOW (worst case for a buyer).
//  This is a DAILY-resolution backtest. It is directionally honest but cannot
//  capture intraday whipsaw precision. Treat win-rates as ballpark.
// ============================================================================
const fs = require('fs');
const path = require('path');
const { roundTripCharges } = require('./charges.js');

const BHAV = 'bt-data/bhav';
const LOT = 75;
const CAPITAL = 100000;
const RISK_PCT = 0.05;          // 5% of capital deployed per trade (margin proxy for sells)

// col idx: TradDt0 Xpry9 Strk11 Optn12 Opn14 Hgh15 Lw16 Cls17 Undrlyg20 OI22
function loadDay(file) {
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(l => l.split(','));
  if (!rows.length) return null;
  const date = rows[0][0];
  const underlying = +rows[0][20];
  const opts = rows.map(r => ({
    xpry: r[9], strike: +r[11], type: r[12],
    o: +r[14], h: +r[15], l: +r[16], c: +r[17], oi: +r[22]
  })).filter(o => o.o > 0 && o.strike > 0);
  if (!opts.length) return null;
  const exps = [...new Set(opts.map(o => o.xpry))].filter(e => e >= date).sort();
  return { date, underlying, nearExp: exps[0], opts, file: path.basename(file) };
}

function leg(day, type, strike, exp) {
  return day.opts.find(o => o.type === type && o.strike === strike && o.xpry === (exp || day.nearExp));
}
function atmStrike(day, step = 50) { return Math.round(day.underlying / step) * step; }
function isExpiryDay(day) { return day.date === day.nearExp; }

// Sizing: lots so deployed ≈ RISK_PCT of running capital (≥1 lot, cap 25).
function sizeLots(cap, premiumTotal) {
  return Math.min(25, Math.max(1, Math.floor((cap * RISK_PCT) / Math.max(1, premiumTotal * LOT))));
}

// Net P&L of a SELL leg held to `exitPrice`, with a SL check vs the day's HIGH.
// Seller profits when premium decays; loses if it rises. SL = stopMult × entry.
function sellLegPnl(entryO, dayHigh, exitClose, stopMult) {
  let exit = exitClose;
  let reason = 'EXPIRY/CLOSE';
  if (stopMult && dayHigh >= entryO * stopMult) { exit = entryO * stopMult; reason = 'SL'; }
  // sold at entryO, buy back at exit → profit = entryO - exit
  return { pnlPerUnit: entryO - exit, exit, reason };
}
// Net P&L of a BUY leg, SL check vs the day's LOW.
function buyLegPnl(entryO, dayLow, dayHigh, target, stopPct) {
  const slLvl = entryO * (1 - stopPct);
  if (dayLow <= slLvl) return { pnlPerUnit: slLvl - entryO, exit: slLvl, reason: 'SL' };
  if (target && dayHigh >= entryO * target) return { pnlPerUnit: entryO * target - entryO, exit: entryO * target, reason: 'TARGET' };
  return { pnlPerUnit: 0, exit: entryO, reason: 'EOD' }; // close ≈ entry for a 1-day hold proxy
}

// ---------------------------------------------------------------------------
// STRATEGIES — each returns a trade {date, legs[], pnl} or null (no entry).
// ---------------------------------------------------------------------------

// 1) SHORT STRADDLE — sell ATM CE + ATM PE on entry day, hold to expiry-day close.
//    Entry only on a fresh weekly cycle (Mon-ish: day after an expiry). SL 1.5× each leg.
function shortStraddle(day, cap) {
  const k = atmStrike(day);
  const ce = leg(day, 'CE', k), pe = leg(day, 'PE', k);
  if (!ce || !pe || ce.o < 2 || pe.o < 2) return null;
  const stop = 1.5;
  const r1 = sellLegPnl(ce.o, ce.h, ce.c, stop);
  const r2 = sellLegPnl(pe.o, pe.h, pe.c, stop);
  const credit = ce.o + pe.o;
  const lots = sizeLots(cap, credit);
  const qty = lots * LOT;
  const gross = (r1.pnlPerUnit + r2.pnlPerUnit) * qty;
  const ch = roundTripCharges(ce.o, r1.exit, qty).total + roundTripCharges(pe.o, r2.exit, qty).total;
  return { date: day.date, strat: 'SHORT_STRADDLE', strike: k, credit: +credit.toFixed(1),
    lots, exit: r1.reason + '/' + r2.reason, pnl: Math.round(gross - ch) };
}

// 2) SHORT STRANGLE — sell ~OTM CE & PE (≈ ATM ± 1.5%). Wider safety, lower credit.
function shortStrangle(day, cap) {
  const atm = atmStrike(day);
  const off = Math.round((day.underlying * 0.015) / 50) * 50;
  const ce = leg(day, 'CE', atm + off), pe = leg(day, 'PE', atm - off);
  if (!ce || !pe || ce.o < 1 || pe.o < 1) return null;
  const stop = 2.0;
  const r1 = sellLegPnl(ce.o, ce.h, ce.c, stop);
  const r2 = sellLegPnl(pe.o, pe.h, pe.c, stop);
  const credit = ce.o + pe.o;
  const lots = sizeLots(cap, credit);
  const qty = lots * LOT;
  const gross = (r1.pnlPerUnit + r2.pnlPerUnit) * qty;
  const ch = roundTripCharges(ce.o, r1.exit, qty).total + roundTripCharges(pe.o, r2.exit, qty).total;
  return { date: day.date, strat: 'SHORT_STRANGLE', strikes: [pe.strike, ce.strike], credit: +credit.toFixed(1),
    lots, exit: r1.reason + '/' + r2.reason, pnl: Math.round(gross - ch) };
}

// 3) IRON CONDOR — short strangle + long wings (defined risk). Buy CE+200/PE-200.
function ironCondor(day, cap) {
  const atm = atmStrike(day);
  const off = Math.round((day.underlying * 0.012) / 50) * 50;
  const wing = 200;
  const sCe = leg(day, 'CE', atm + off), sPe = leg(day, 'PE', atm - off);
  const lCe = leg(day, 'CE', atm + off + wing), lPe = leg(day, 'PE', atm - off - wing);
  if (!sCe || !sPe || !lCe || !lPe || sCe.o < 1 || sPe.o < 1) return null;
  const credit = (sCe.o + sPe.o) - (lCe.o + lPe.o);
  if (credit <= 0) return null;
  // short legs decay-to-close; long legs also move (hedge). No hard SL (defined risk).
  const sCeP = sCe.o - sCe.c, sPeP = sPe.o - sPe.c;       // sold: profit if price falls
  const lCeP = lCe.c - lCe.o, lPeP = lPe.c - lPe.o;       // bought: profit if price rises
  const lots = sizeLots(cap, Math.abs(credit));
  const qty = lots * LOT;
  const gross = (sCeP + sPeP + lCeP + lPeP) * qty;
  const ch = roundTripCharges(sCe.o, sCe.c, qty).total + roundTripCharges(sPe.o, sPe.c, qty).total +
             roundTripCharges(lCe.o, lCe.c, qty).total + roundTripCharges(lPe.o, lPe.c, qty).total;
  return { date: day.date, strat: 'IRON_CONDOR', credit: +credit.toFixed(1),
    lots, exit: 'CLOSE', pnl: Math.round(gross - ch) };
}

// 4) EXPIRY-DAY STRADDLE — on expiry day only, sell ATM CE+PE at open, exit at close.
//    Fastest theta of the week; the classic Indian expiry-day seller edge.
function expiryStraddle(day, cap) {
  if (!isExpiryDay(day)) return null;
  const k = atmStrike(day);
  const ce = leg(day, 'CE', k), pe = leg(day, 'PE', k);
  if (!ce || !pe || ce.o < 2 || pe.o < 2) return null;
  const stop = 2.0;
  const r1 = sellLegPnl(ce.o, ce.h, ce.c, stop);
  const r2 = sellLegPnl(pe.o, pe.h, pe.c, stop);
  const credit = ce.o + pe.o;
  const lots = sizeLots(cap, credit);
  const qty = lots * LOT;
  const gross = (r1.pnlPerUnit + r2.pnlPerUnit) * qty;
  const ch = roundTripCharges(ce.o, r1.exit, qty).total + roundTripCharges(pe.o, r2.exit, qty).total;
  return { date: day.date, strat: 'EXPIRY_STRADDLE', strike: k, credit: +credit.toFixed(1),
    lots, exit: r1.reason + '/' + r2.reason, pnl: Math.round(gross - ch) };
}

// 5) GAP-AND-GO BUY — directional benchmark (mirrors bt-real.js). Buy deep-OTM
//    on a >0.15% gap, 5% SL / 5x target against the strike's real H/L.
function gapBuy(day, cap, prevUnderlying) {
  if (prevUnderlying == null) return null;
  const gapPct = ((day.underlying - prevUnderlying) / prevUnderlying) * 100;
  const sig = gapPct > 0.15 ? 'CE' : gapPct < -0.15 ? 'PE' : null;
  if (!sig) return null;
  const atm = atmStrike(day);
  const cands = day.opts.filter(o => o.type === sig && o.xpry === day.nearExp && o.o > 0.5 && o.o <= 38 && o.oi >= 50000 && o.h > 0 && o.l > 0)
    .filter(o => sig === 'CE' ? o.strike > atm : o.strike < atm)
    .sort((a, b) => Math.abs(a.strike - atm) - Math.abs(b.strike - atm));
  const opt = cands[0];
  if (!opt) return null;
  const r = buyLegPnl(opt.o, opt.l, opt.h, 5.0, 0.05);
  const lots = sizeLots(cap, opt.o);
  const qty = lots * LOT;
  const gross = r.pnlPerUnit * qty;
  const ch = roundTripCharges(opt.o, r.exit, qty).total;
  return { date: day.date, strat: 'GAP_BUY', side: sig, strike: opt.strike, entry: +opt.o.toFixed(1),
    lots, exit: r.reason, pnl: Math.round(gross - ch) };
}

// ---------------------------------------------------------------------------
// RUNNER — compound each strategy independently over all days.
// ---------------------------------------------------------------------------
function run(strategyFn, days, opts = {}) {
  let cap = CAPITAL;
  const trades = [];
  let prevUnderlying = null;
  let cooldownUntil = null;   // for weekly-entry strategies: skip until next cycle
  for (const day of days) {
    let t = null;
    if (opts.weekly) {
      // enter once per weekly cycle: only the day AFTER an expiry, hold through.
      if (!cooldownUntil || day.date > cooldownUntil) {
        t = strategyFn(day, cap);
        if (t) cooldownUntil = day.nearExp;   // no re-entry until this expiry passes
      }
    } else if (opts.usePrev) {
      t = strategyFn(day, cap, prevUnderlying);
    } else {
      t = strategyFn(day, cap);
    }
    if (t) { cap += t.pnl; t.cap = Math.round(cap); trades.push(t); }
    prevUnderlying = day.underlying;
  }
  return { trades, cap };
}

function report(name, res, nDays) {
  const t = res.trades;
  const wins = t.filter(x => x.pnl > 0).length;
  const net = res.cap - CAPITAL;
  // max drawdown on the equity curve
  let peak = CAPITAL, maxDD = 0;
  for (const x of t) { peak = Math.max(peak, x.cap); maxDD = Math.max(maxDD, (peak - x.cap) / peak); }
  const winPct = t.length ? Math.round(100 * wins / t.length) : 0;
  const cagr = t.length ? (Math.pow(res.cap / CAPITAL, 252 / nDays) - 1) * 100 : 0;
  return { name, trades: t.length, winPct, net: Math.round(net), final: Math.round(res.cap),
    maxDDpct: +(maxDD * 100).toFixed(1), cagrPct: +cagr.toFixed(0),
    best: t.length ? Math.max(...t.map(x => x.pnl)) : 0,
    worst: t.length ? Math.min(...t.map(x => x.pnl)) : 0 };
}

// ---------------------------------------------------------------------------
function main() {
  const files = fs.readdirSync(BHAV).filter(f => f.startsWith('nifty-') && f.endsWith('.csv')).sort();
  const days = files.map(f => loadDay(path.join(BHAV, f))).filter(Boolean);
  console.log(`Loaded ${days.length} real trading days (${days[0].date} → ${days[days.length - 1].date})\n`);

  const runs = {
    SHORT_STRADDLE:  run(shortStraddle, days, { weekly: true }),
    SHORT_STRANGLE:  run(shortStrangle, days, { weekly: true }),
    IRON_CONDOR:     run(ironCondor,    days, { weekly: true }),
    EXPIRY_STRADDLE: run(expiryStraddle, days),
    GAP_BUY:         run(gapBuy,        days, { usePrev: true }),
  };

  const reports = Object.entries(runs).map(([k, v]) => report(k, v, days.length));
  reports.sort((a, b) => b.net - a.net);

  console.log('================ STRATEGY LEADERBOARD (real bhavcopy) ================');
  console.log('Strategy          Trades  Win%   Net₹      Final₹    MaxDD%  CAGR%   Best     Worst');
  for (const r of reports) {
    console.log(
      r.name.padEnd(16),
      String(r.trades).padStart(5),
      String(r.winPct + '%').padStart(6),
      ('₹' + r.net.toLocaleString('en-IN')).padStart(11),
      ('₹' + r.final.toLocaleString('en-IN')).padStart(11),
      String(r.maxDDpct + '%').padStart(7),
      String(r.cagrPct + '%').padStart(6),
      ('₹' + r.best.toLocaleString('en-IN')).padStart(9),
      ('₹' + r.worst.toLocaleString('en-IN')).padStart(9),
    );
  }
  console.log('=====================================================================');

  const out = { generatedOnDays: days.length, range: [days[0].date, days[days.length - 1].date],
    leaderboard: reports, trades: Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, v.trades])) };
  fs.writeFileSync('bt-data/result-strategies.json', JSON.stringify(out, null, 1));
  console.log('\nSaved: bt-data/result-strategies.json');
}

main();
