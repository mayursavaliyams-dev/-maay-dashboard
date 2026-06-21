// ============================================================================
//  bt-strangle-costs.js — COST-STRESS re-validation of the SHORT_STRANGLE.
//
//  Tier-1 #1 of the strategy-research roadmap. The deep-research finding (3-0
//  verified) was blunt: the volatility-risk-premium edge is real GROSS, but
//  bid-ask SLIPPAGE + charges can flip it negative — the S&P study saw ~10%
//  round-trip spreads erase the edge entirely. Our earlier backtest applied
//  charges.js but assumed FAIR fills (no spread). This re-runs the exact same
//  validated strangle while charging a realistic per-fill slippage, swept across
//  levels, so we can see HOW MUCH slippage the edge survives — and find the
//  break-even slippage where net P&L hits zero.
//
//  Slippage model (against the trader, both legs, entry + exit):
//    sell leg:  received = open*(1 - SLIP)   |  buy-back = exit*(1 + SLIP)
//    so a seller collects less premium AND pays more to close.
//  Charges (charges.js) are applied on top, on the nominal turnover.
//
//  Same data + same config as the validated run: ATM±1.5% legs, 2x leg stop,
//  hold to expiry close, weekly re-entry, 5%-capital sizing, real NSE bhavcopy.
// ============================================================================
const fs = require('fs');
const path = require('path');
const { roundTripCharges } = require('./charges.js');

const { BHAV, LOT, CAPITAL, RISK_PCT, loadDay, leg, atmStrike, sizeLots } = require('./bt-lib.js');
const OTM_PCT = 0.015, STOP_MULT = 2.0;

// loadDay / leg / atmStrike / sizeLots come from bt-lib.js (shared loader).

// A SELL leg's net-of-slippage P&L per unit. Seller is hurt on both fills.
function sellLegPnl(open, dayHigh, exitClose, slip) {
  let exit = exitClose, reason = 'CLOSE';
  if (STOP_MULT && dayHigh >= open * STOP_MULT) { exit = open * STOP_MULT; reason = 'SL'; }
  const received = open * (1 - slip);   // sold at the bid
  const paid     = exit * (1 + slip);   // bought back at the ask
  return { pnlPerUnit: received - paid, exit, reason };
}

function runStrangle(days, slip) {
  let cap = CAPITAL;
  const trades = [];
  let cooldownUntil = null;
  for (const day of days) {
    if (cooldownUntil && day.date <= cooldownUntil) continue;   // one entry per weekly cycle
    const atm = atmStrike(day);
    const off = Math.round((day.underlying * OTM_PCT) / 50) * 50;
    const ce = leg(day, 'CE', atm + off), pe = leg(day, 'PE', atm - off);
    if (!ce || !pe || ce.o < 1 || pe.o < 1) continue;
    const r1 = sellLegPnl(ce.o, ce.h, ce.c, slip);
    const r2 = sellLegPnl(pe.o, pe.h, pe.c, slip);
    const credit = ce.o + pe.o;
    const lots = sizeLots(cap, credit), qty = lots * LOT;
    const gross = (r1.pnlPerUnit + r2.pnlPerUnit) * qty;
    const ch = roundTripCharges(ce.o, r1.exit, qty).total + roundTripCharges(pe.o, r2.exit, qty).total;
    const pnl = Math.round(gross - ch);
    cap += pnl;
    trades.push({ date: day.date, pnl, cap: Math.round(cap) });
    cooldownUntil = day.nearExp;
  }
  // stats
  const wins = trades.filter(t => t.pnl > 0).length;
  const net = cap - CAPITAL;
  let peak = CAPITAL, maxDD = 0;
  for (const t of trades) { peak = Math.max(peak, t.cap); maxDD = Math.max(maxDD, (peak - t.cap) / peak); }
  const W = trades.filter(t => t.pnl > 0), L = trades.filter(t => t.pnl < 0);
  return {
    trades: trades.length, winPct: trades.length ? Math.round(100 * wins / trades.length) : 0,
    net: Math.round(net), final: Math.round(cap), maxDDpct: +(maxDD * 100).toFixed(1),
    avgWin: W.length ? Math.round(W.reduce((s, t) => s + t.pnl, 0) / W.length) : 0,
    avgLoss: L.length ? Math.round(L.reduce((s, t) => s + t.pnl, 0) / L.length) : 0,
  };
}

function main() {
  const files = fs.readdirSync(BHAV).filter(f => f.startsWith('nifty-') && f.endsWith('.csv')).sort();
  const days = files.map(f => loadDay(path.join(BHAV, f))).filter(Boolean);
  console.log(`Loaded ${days.length} real trading days (${days[0].date} → ${days[days.length - 1].date})\n`);
  console.log('Cost-stress: SHORT_STRANGLE net of charges.js + a per-fill bid-ask slippage (both legs, entry+exit).\n');

  const sweep = [0, 0.0025, 0.005, 0.0075, 0.01, 0.015, 0.02, 0.03];
  console.log('Slippage%  Trades  Win%   Net₹        Final₹      MaxDD%   AvgWin    AvgLoss');
  const rows = [];
  for (const slip of sweep) {
    const r = runStrangle(days, slip);
    rows.push({ slip, ...r });
    console.log(
      (((slip * 100).toFixed(2)) + '%').padStart(8),
      String(r.trades).padStart(6),
      String(r.winPct + '%').padStart(6),
      ('₹' + r.net.toLocaleString('en-IN')).padStart(12),
      ('₹' + r.final.toLocaleString('en-IN')).padStart(12),
      String(r.maxDDpct + '%').padStart(7),
      ('₹' + r.avgWin.toLocaleString('en-IN')).padStart(9),
      ('₹' + r.avgLoss.toLocaleString('en-IN')).padStart(9),
    );
  }

  // Find break-even slippage (linear interpolation between the last positive and first negative net).
  let breakeven = null;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i - 1].net > 0 && rows[i].net <= 0) {
      const a = rows[i - 1], b = rows[i];
      const frac = a.net / (a.net - b.net);
      breakeven = a.slip + frac * (b.slip - a.slip);
      break;
    }
  }
  console.log('\n===== VERDICT =====');
  if (rows[rows.length - 1].net > 0) {
    console.log(`Edge SURVIVES even ${(sweep[sweep.length - 1] * 100).toFixed(1)}% per-fill slippage — robust. Net still +₹${rows[rows.length - 1].net.toLocaleString('en-IN')}.`);
  } else if (breakeven != null) {
    console.log(`Break-even slippage ≈ ${(breakeven * 100).toFixed(2)}% per fill. Below it the strangle is net-positive; above it the edge dies.`);
    console.log(`Realistic NIFTY weekly ATM±1.5% per-fill slippage is ~0.25–1%. Compare against the break-even above to judge the real margin of safety.`);
  } else {
    console.log('Edge is NEGATIVE even at 0% slippage in this run — investigate.');
  }
  fs.writeFileSync('bt-data/result-strangle-costs.json', JSON.stringify({ days: days.length, range: [days[0].date, days[days.length - 1].date], breakevenSlip: breakeven, sweep: rows }, null, 1));
  console.log('\nSaved: bt-data/result-strangle-costs.json');
}

main();
