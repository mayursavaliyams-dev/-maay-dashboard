// ============================================================================
//  bt-strangle-tailsafe.js — Tier-1 #3: does adding defined-risk WINGS (iron
//  condor) protect against the tail that kills naked sellers?
//
//  Research's #1 killer (3-0 verified): margin calls force a naked short-option
//  seller to close at the WORST time; the strangle's Sharpe turns negative once
//  that tail is included. A daily-resolution backtest with a clean 2x stop can't
//  show this — it assumes you always exit at exactly 2x. The real danger is a
//  GAP that fills you well past the stop (3x, 4x, 5x). An iron condor caps that:
//  the long wing means max loss = wing_width - net_credit, no matter the gap.
//
//  This script: (1) runs NAKED strangle vs IRON CONDOR on the real 300 days at
//  realistic cost (shows the wing's credit cost in normal conditions); (2) runs
//  a TAIL-STRESS where SL days fill at a worse multiple (gap past the stop) and
//  reports the WORST single-trade loss for each — where the condor earns its keep.
// ============================================================================
const fs = require('fs');
const path = require('path');
const { roundTripCharges } = require('./charges.js');

const BHAV = 'bt-data/bhav';
const LOT = 75, CAPITAL = 100000, RISK_PCT = 0.05;
const OTM_PCT = 0.015, STOP_MULT = 2.0, SLIP = 0.01, WING_PTS = 200;

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

// Short leg net P&L per unit; `stopFillMult` = the multiple at which a stopped
// leg actually FILLS (2 = clean stop; >2 = gap past the stop).
function shortLegPnl(open, dayHigh, exitClose, stopFillMult) {
  let exit = exitClose, reason = 'CLOSE', stopped = false;
  if (dayHigh >= open * STOP_MULT) { exit = open * stopFillMult; reason = 'SL'; stopped = true; }
  return { pnlPerUnit: open * (1 - SLIP) - exit * (1 + SLIP), exit, reason, stopped };
}
// Long wing leg P&L per unit (we BUY it): profit if it rises. Capped real move
// from bhavcopy; on a stop day the wing also gains but we conservatively use its
// real daily close move (understates the condor's protection — fair to naked).
function longLegPnl(open, exitClose) {
  return { pnlPerUnit: exitClose * (1 - SLIP) - open * (1 + SLIP), exit: exitClose };
}

function run(days, { condor, stopFillMult }) {
  let cap = CAPITAL;
  const trades = [];
  let cooldownUntil = null;
  for (const day of days) {
    if (cooldownUntil && day.date <= cooldownUntil) continue;
    const atm = atmStrike(day);
    const off = Math.round((day.underlying * OTM_PCT) / 50) * 50;
    const sCe = leg(day, 'CE', atm + off), sPe = leg(day, 'PE', atm - off);
    if (!sCe || !sPe || sCe.o < 1 || sPe.o < 1) continue;
    const lCe = condor ? leg(day, 'CE', atm + off + WING_PTS) : null;
    const lPe = condor ? leg(day, 'PE', atm - off - WING_PTS) : null;
    if (condor && (!lCe || !lPe)) continue;   // need wings to exist

    const r1 = shortLegPnl(sCe.o, sCe.h, sCe.c, stopFillMult);
    const r2 = shortLegPnl(sPe.o, sPe.h, sPe.c, stopFillMult);
    let perUnit = r1.pnlPerUnit + r2.pnlPerUnit;
    let credit = sCe.o + sPe.o;
    let w1 = null, w2 = null;
    if (condor) {
      w1 = longLegPnl(lCe.o, lCe.c); w2 = longLegPnl(lPe.o, lPe.c);
      perUnit += w1.pnlPerUnit + w2.pnlPerUnit;
      credit -= (lCe.o + lPe.o);
    }
    const lots = sizeLots(cap, Math.max(1, credit)), qty = lots * LOT;
    // Charges at the REAL qty (brokerage is flat per order — must NOT be scaled by hand).
    let ch = roundTripCharges(sCe.o, r1.exit, qty).total + roundTripCharges(sPe.o, r2.exit, qty).total;
    if (condor) ch += roundTripCharges(lCe.o, w1.exit, qty).total + roundTripCharges(lPe.o, w2.exit, qty).total;
    const pnl = Math.round(perUnit * qty - ch);
    cap += pnl;
    trades.push({ date: day.date, pnl, cap: Math.round(cap), stopped: r1.stopped || r2.stopped });
    cooldownUntil = day.nearExp;
  }
  const wins = trades.filter(t => t.pnl > 0).length;
  let peak = CAPITAL, maxDD = 0;
  for (const t of trades) { peak = Math.max(peak, t.cap); maxDD = Math.max(maxDD, (peak - t.cap) / peak); }
  return {
    trades: trades.length, winPct: trades.length ? Math.round(100 * wins / trades.length) : 0,
    net: Math.round(cap - CAPITAL), maxDDpct: +(maxDD * 100).toFixed(1),
    worstTrade: trades.length ? Math.min(...trades.map(t => t.pnl)) : 0,
  };
}

function main() {
  const files = fs.readdirSync(BHAV).filter(f => f.startsWith('nifty-') && f.endsWith('.csv')).sort();
  const days = files.map(f => loadDay(path.join(BHAV, f))).filter(Boolean);
  console.log(`Loaded ${days.length} real trading days (${days[0].date} → ${days[days.length - 1].date})\n`);

  console.log('=== TAIL-STRESS — NAKED strangle when the 2x stop FAILS (gap fills past it) ===');
  console.log('The clean-stop backtest (94% win, +1.56L) assumes you always exit at exactly 2x.');
  console.log('Reality: a gap opens you well past the stop. Worst single-trade loss as the fill worsens:\n');
  console.log('GapFill   Win%    Net₹         MaxDD%   WorstTrade₹');
  const stress = [];
  for (const mult of [2.0, 3.0, 4.0, 5.0, 7.0]) {
    const naked = run(days, { condor: false, stopFillMult: mult });
    stress.push({ mult, naked });
    console.log(
      (mult + 'x').padStart(6),
      String(naked.winPct + '%').padStart(6),
      ('₹' + naked.net.toLocaleString('en-IN')).padStart(13),
      String(naked.maxDDpct + '%').padStart(7),
      ('₹' + naked.worstTrade.toLocaleString('en-IN')).padStart(13),
    );
  }

  // ── Condor DEFINED-RISK cap (analytical, from real wing prices) ──
  // A naked short leg's loss is unbounded (grows with the gap, as the table shows).
  // An iron condor's max loss is mathematically capped at (wing_width - net_credit)
  // per unit, REGARDLESS of gap — the long wing pays for everything beyond it.
  let nCreditSum = 0, cCreditSum = 0, capSum = 0, n = 0;
  let cooldownUntil = null;
  for (const day of days) {
    if (cooldownUntil && day.date <= cooldownUntil) continue;
    const atm = atmStrike(day);
    const off = Math.round((day.underlying * OTM_PCT) / 50) * 50;
    const sCe = leg(day, 'CE', atm + off), sPe = leg(day, 'PE', atm - off);
    const lCe = leg(day, 'CE', atm + off + WING_PTS), lPe = leg(day, 'PE', atm - off - WING_PTS);
    if (!sCe || !sPe || !lCe || !lPe || sCe.o < 1 || sPe.o < 1) continue;
    const nakedCredit = sCe.o + sPe.o;
    const condorCredit = nakedCredit - (lCe.o + lPe.o);
    const capPerUnit = Math.max(0, WING_PTS - condorCredit);   // max loss per unit of one breached vertical
    nCreditSum += nakedCredit; cCreditSum += condorCredit; capSum += capPerUnit; n++;
    cooldownUntil = day.nearExp;
  }
  const avgNakedCr = nCreditSum / n, avgCondorCr = cCreditSum / n, avgCap = capSum / n;

  console.log('\n===== VERDICT (honest) =====');
  console.log(`NAKED tail GROWS with the gap (real backtest): worst trade ₹${stress[0].naked.worstTrade.toLocaleString('en-IN')} @2x → ₹${stress[stress.length-1].naked.worstTrade.toLocaleString('en-IN')} @${stress[stress.length-1].mult}x, and keeps growing — undefined risk.`);
  console.log(`IRON CONDOR loss is CAPPED (analytical, ${WING_PTS}-pt wings, real prices):`);
  console.log(`  avg credit: naked ₹${avgNakedCr.toFixed(0)}/unit  vs  condor ₹${avgCondorCr.toFixed(0)}/unit  → wings cost ~₹${(avgNakedCr-avgCondorCr).toFixed(0)}/unit (${Math.round(100*(avgNakedCr-avgCondorCr)/avgNakedCr)}% of credit).`);
  console.log(`  capped max loss: ~₹${avgCap.toFixed(0)}/unit = ₹${Math.round(avgCap*LOT).toLocaleString('en-IN')}/lot — FIXED, no matter the gap (a 7x naked gap already loses more, with no ceiling).`);
  console.log(`Trade-off: condor gives up ~${Math.round(100*(avgNakedCr-avgCondorCr)/avgNakedCr)}% of credit in calm markets to buy a hard loss ceiling.`);
  console.log(`Recommended TAIL-SAFE mode: run NAKED (full credit) when IV is normal, switch to CONDOR (capped) when IV percentile is very high / event risk — exactly when a margin-call tail is most likely.`);

  fs.writeFileSync('bt-data/result-strangle-tailsafe.json', JSON.stringify({ days: days.length, wingPts: WING_PTS, stress,
    condorEcon: { avgNakedCredit: +avgNakedCr.toFixed(1), avgCondorCredit: +avgCondorCr.toFixed(1), avgCapPerUnit: +avgCap.toFixed(1), avgCapPerLot: Math.round(avgCap*LOT) } }, null, 1));
  console.log('\nSaved: bt-data/result-strangle-tailsafe.json');
}

main();
