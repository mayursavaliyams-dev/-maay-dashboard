/**
 * Long-straddle backtest on NIFTY expiry days (Tuesday + Thursday eras).
 *
 * Setup per expiry:
 *   - Buy ATM CE for ₹4000 + ATM PE for ₹4000 (₹8000 total deployment)
 *   - 35% stop-loss on EACH leg independently
 *   - Hold survivors to expiry close (intrinsic settle)
 *
 * Data: backtest-tv-results-nifty.json — has one real traded leg per expiry
 * (entry+exit premium, IV, ATM strike). We recover spotExit from that leg's
 * expiry-close intrinsic value, then price BOTH straddle legs from it.
 *
 * APPROXIMATION (honest): we only have entry + EOD-exit per leg, not the
 * intraday path. The 35% SL is applied on the FINAL leg value — if a leg
 * closed below entry×0.65 it's booked at -35% (capped), else it rides to
 * its real exit. This is mildly optimistic (a real SL could trigger then
 * reverse) but is the best the available data supports.
 */
const { bsmPrice } = require('./backtest-real/synth-option-pricer');

const DEPLOY_PER_LEG = 4000;      // ₹4000 CE + ₹4000 PE
const SL_PCT         = 0.35;      // 35% stop-loss per leg
const LOT_SIZE       = 65;        // NIFTY (recent); older eras smaller but data is premium-based
const BROKERAGE_RT   = 60;        // per leg round-trip
const SLIPPAGE       = 0.02;      // 2% per fill

const d = require('./backtest-tv-results-nifty.json');
// ONLY Tuesday + Thursday expiries (NIFTY weekly eras), with usable price data.
const expiries = d.trades.filter(t =>
  t.status === 'OK' && t.entryPrice > 0 && t.exitPrice > 0 && t.iv > 0 && t.strike > 0
  && (t.weekday === 'TUE' || t.weekday === 'THU')
);
// Sort by date so "last N" means most recent.
expiries.sort((a, b) => new Date(a.date) - new Date(b.date));

console.log(`\n╔══════════════════════════════════════════════════════════════════════╗`);
console.log(`║  NIFTY EXPIRY STRADDLE — CE ₹4000 + PE ₹4000, 35% SL per leg          ║`);
console.log(`║  ${expiries.length} expiries with data (Tue+Thu eras) · 2% slip · ₹60 RT/leg      ║`);
console.log(`╚══════════════════════════════════════════════════════════════════════╝`);

let totalPnl = 0, wins = 0, losses = 0;
let totalDeployed = 0;
const rows = [];
const byYear = {};

for (const t of expiries) {
  const strike = t.strike;
  const iv = t.iv;
  const isCall = t.type === 'CALL';

  // Recover spotExit from the traded leg's expiry-close intrinsic value.
  // exitReason is mostly EOD_CLOSE → exit ≈ intrinsic at T≈0.
  const tradedExit = t.exitPrice;
  let spotExit;
  if (isCall) spotExit = strike + tradedExit;   // CE exit ≈ max(spot-strike,0)
  else        spotExit = strike - tradedExit;    // PE exit ≈ max(strike-spot,0)

  // Entry premiums: ATM strikeOffset=0 → CE≈PE. Use traded leg's real entry
  // for its side, BSM the opposite for symmetry sanity, then take ATM-symmetric.
  const T_entry = 0.25 / 252;     // ~quarter trading day to expiry close
  const ceEntry = isCall ? t.entryPrice : bsmPrice(strike, strike, T_entry, iv, 'CE');
  const peEntry = !isCall ? t.entryPrice : bsmPrice(strike, strike, T_entry, iv, 'PE');

  // Exit at expiry (intrinsic)
  const ceExitIntrinsic = Math.max(spotExit - strike, 0);
  const peExitIntrinsic = Math.max(strike - spotExit, 0);

  // Apply 35% SL per leg: if final < entry×0.65, booked at entry×0.65.
  const legPnl = (entry, exitIntrinsic) => {
    const slFloor = entry * (1 - SL_PCT);
    const exitFill = Math.max(exitIntrinsic, slFloor);   // SL caps the loss
    // qty from ₹4000 deployment
    const qty = Math.max(LOT_SIZE, Math.floor(DEPLOY_PER_LEG / (entry * LOT_SIZE)) * LOT_SIZE);
    const entryFill = entry * (1 + SLIPPAGE);
    const exitFinal = exitFill * (1 - SLIPPAGE);
    const gross = (exitFinal - entryFill) * qty;
    return { pnl: gross - BROKERAGE_RT, qty, entry, exit: exitFill };
  };

  const ce = legPnl(ceEntry, ceExitIntrinsic);
  const pe = legPnl(peEntry, peExitIntrinsic);
  const dayPnl = ce.pnl + pe.pnl;
  const deployed = ce.entry * ce.qty + pe.entry * pe.qty;

  totalPnl += dayPnl;
  totalDeployed += deployed;
  if (dayPnl > 0) wins++; else losses++;

  const yr = t.date.slice(0, 4);
  byYear[yr] = byYear[yr] || { pnl: 0, n: 0, w: 0 };
  byYear[yr].pnl += dayPnl; byYear[yr].n++; if (dayPnl > 0) byYear[yr].w++;

  rows.push({ date: t.date, wd: t.weekday, strike, spotExit: spotExit.toFixed(0),
    ceEntry: ceEntry.toFixed(1), peEntry: peEntry.toFixed(1),
    ceExit: ce.exit.toFixed(1), peExit: pe.exit.toFixed(1),
    dayPnl: Math.round(dayPnl) });
}

// Print last 20 trades
console.log('\nDate         WD  Strike  SpotExit  CEent  PEent  CEexit PEexit  DayPnL');
console.log('------------------------------------------------------------------------');
for (const r of rows.slice(-20)) {
  console.log(
    r.date.padEnd(12) + ' ' + r.wd.padEnd(3) + ' ' +
    String(r.strike).padStart(6) + '  ' + String(r.spotExit).padStart(7) + '  ' +
    String(r.ceEntry).padStart(5) + '  ' + String(r.peEntry).padStart(5) + '  ' +
    String(r.ceExit).padStart(5) + '  ' + String(r.peExit).padStart(5) + '  ' +
    (r.dayPnl >= 0 ? '+₹' : '-₹') + Math.abs(r.dayPnl).toLocaleString('en-IN').padStart(7)
  );
}

console.log('\n── BY YEAR');
console.log('Year | Expiries | Win% | Total P&L');
console.log('-----|----------|------|----------');
for (const yr of Object.keys(byYear).sort()) {
  const y = byYear[yr];
  console.log(
    yr + ' | ' + String(y.n).padStart(8) + ' | ' +
    String((100*y.w/y.n).toFixed(0)).padStart(4) + '% | ' +
    (y.pnl >= 0 ? '+₹' : '-₹') + Math.abs(Math.round(y.pnl)).toLocaleString('en-IN')
  );
}

console.log('\n══════════════════════════════════════════════════════════════════════');
console.log(`  TOTAL EXPIRIES:   ${expiries.length}`);
console.log(`  WINS / LOSSES:    ${wins} / ${losses}  (${(100*wins/expiries.length).toFixed(1)}% win)`);
console.log(`  NET P&L:          ${totalPnl >= 0 ? '+' : ''}₹${Math.round(totalPnl).toLocaleString('en-IN')}`);
console.log(`  AVG PER EXPIRY:   ${totalPnl >= 0 ? '+' : ''}₹${Math.round(totalPnl/expiries.length).toLocaleString('en-IN')}`);
console.log(`  AVG DEPLOY/EXPIRY: ₹${Math.round(totalDeployed/expiries.length).toLocaleString('en-IN')}`);
console.log(`  RETURN ON DEPLOY:  ${(100*totalPnl/totalDeployed).toFixed(1)}% (per-expiry capital recycled)`);
console.log('══════════════════════════════════════════════════════════════════════');
console.log('\n⚠ APPROXIMATION: 35% SL applied on final leg value (no intraday path in data).');
console.log('  Mildly optimistic. Real straddle results need tick-level option data per leg.\n');
