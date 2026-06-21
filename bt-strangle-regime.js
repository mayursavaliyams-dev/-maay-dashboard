// ============================================================================
//  bt-strangle-regime.js — Tier-1 #2: does a VRP / regime FILTER improve the
//  strangle? (Honest test before wiring it live.)
//
//  Research (3-0 verified): the variance-risk-premium edge inverts ~25% of days
//  in NIFTY — "always sell vol" is wrong 1-in-4. So sell ONLY when the premium
//  is genuinely rich. We compute, from the same bhavcopy data:
//    IV proxy  = ATM straddle / (0.8 * spot * sqrt(DTE/365))   [annualized vol]
//    RV        = stdev(last N index log-returns) * sqrt(252)    [realized vol]
//    VRP       = IV - RV        (positive = sellers being paid)
//    IV pct    = percentile of today's IV vs a trailing window
//  Then we compare the SAME strangle (ATM±1.5%, 2x stop, 1% slippage, charges)
//  with NO filter vs several regime filters, and measure whether filtering
//  actually skips the losers (higher net-per-trade, lower drawdown) or just
//  trades less for no gain.
// ============================================================================
const fs = require('fs');
const path = require('path');
const { roundTripCharges } = require('./charges.js');

const { BHAV, LOT, CAPITAL, RISK_PCT, loadDay, leg, atmStrike, sizeLots } = require('./bt-lib.js');
const OTM_PCT = 0.015, STOP_MULT = 2.0, SLIP = 0.01;   // realistic 1% per-fill slippage
const RV_WINDOW = 20, IV_PCT_WINDOW = 40;

// loadDay / leg / atmStrike / sizeLots come from bt-lib.js (shared loader).

function sellLegPnl(open, dayHigh, exitClose) {
  let exit = exitClose, reason = 'CLOSE';
  if (dayHigh >= open * STOP_MULT) { exit = open * STOP_MULT; reason = 'SL'; }
  return { pnlPerUnit: open * (1 - SLIP) - exit * (1 + SLIP), exit, reason };
}

// ATM-straddle implied-vol proxy (annualized). DTE in calendar days.
function dayIV(day) {
  const k = atmStrike(day);
  const ce = leg(day, 'CE', k), pe = leg(day, 'PE', k);
  if (!ce || !pe) return null;
  const straddle = ce.o + pe.o;
  const dte = Math.max(1, Math.round((Date.parse(day.nearExp) - Date.parse(day.date)) / 86400000));
  return straddle / (0.8 * day.underlying * Math.sqrt(dte / 365));
}
function realizedVol(und, i, N = RV_WINDOW) {
  if (i < N) return null;
  const rets = [];
  for (let j = i - N + 1; j <= i; j++) rets.push(Math.log(und[j] / und[j - 1]));
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((s, r) => s + (r - m) ** 2, 0) / rets.length;
  return Math.sqrt(v * 252);
}
function pctRank(arr, x) {
  if (!arr.length) return null;
  return arr.filter(v => v <= x).length / arr.length;
}

// Run the strangle with an optional gate(metrics)->bool filter.
function runStrangle(days, ivSeries, undSeries, gate) {
  let cap = CAPITAL;
  const trades = [];
  let cooldownUntil = null, skipped = 0;
  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    if (cooldownUntil && day.date <= cooldownUntil) continue;
    const atm = atmStrike(day);
    const off = Math.round((day.underlying * OTM_PCT) / 50) * 50;
    const ce = leg(day, 'CE', atm + off), pe = leg(day, 'PE', atm - off);
    if (!ce || !pe || ce.o < 1 || pe.o < 1) continue;

    // regime metrics
    const iv = ivSeries[i];
    const rv = realizedVol(undSeries, i);
    const vrp = (iv != null && rv != null) ? iv - rv : null;
    const ivHist = ivSeries.slice(Math.max(0, i - IV_PCT_WINDOW), i).filter(v => v != null);
    const ivPct = (iv != null) ? pctRank(ivHist, iv) : null;
    const metrics = { iv, rv, vrp, ivPct };

    if (gate && !gate(metrics)) { skipped++; continue; }   // filtered out (no cooldown set — try again next cycle)

    const r1 = sellLegPnl(ce.o, ce.h, ce.c), r2 = sellLegPnl(pe.o, pe.h, pe.c);
    const credit = ce.o + pe.o, lots = sizeLots(cap, credit), qty = lots * LOT;
    const gross = (r1.pnlPerUnit + r2.pnlPerUnit) * qty;
    const ch = roundTripCharges(ce.o, r1.exit, qty).total + roundTripCharges(pe.o, r2.exit, qty).total;
    const pnl = Math.round(gross - ch);
    cap += pnl;
    trades.push({ date: day.date, pnl, cap: Math.round(cap), vrp, ivPct });
    cooldownUntil = day.nearExp;
  }
  const wins = trades.filter(t => t.pnl > 0).length;
  let peak = CAPITAL, maxDD = 0;
  for (const t of trades) { peak = Math.max(peak, t.cap); maxDD = Math.max(maxDD, (peak - t.cap) / peak); }
  return {
    trades: trades.length, skipped, winPct: trades.length ? Math.round(100 * wins / trades.length) : 0,
    net: Math.round(cap - CAPITAL), netPerTrade: trades.length ? Math.round((cap - CAPITAL) / trades.length) : 0,
    maxDDpct: +(maxDD * 100).toFixed(1), _trades: trades,
  };
}

function main() {
  const files = fs.readdirSync(BHAV).filter(f => f.startsWith('nifty-') && f.endsWith('.csv')).sort();
  const days = files.map(f => loadDay(path.join(BHAV, f))).filter(Boolean);
  const undSeries = days.map(d => d.underlying);
  const ivSeries = days.map(dayIV);
  console.log(`Loaded ${days.length} real trading days (${days[0].date} → ${days[days.length - 1].date})\n`);

  // VRP regime stats across all days (sanity vs the research's ~25% inversion).
  const vrps = days.map((d, i) => { const iv = ivSeries[i], rv = realizedVol(undSeries, i); return (iv != null && rv != null) ? iv - rv : null; }).filter(v => v != null);
  const posVrp = vrps.filter(v => v > 0).length;
  console.log(`VRP regime: positive on ${Math.round(100 * posVrp / vrps.length)}% of days (research found ~75% in NIFTY), mean VRP ${(vrps.reduce((a, b) => a + b, 0) / vrps.length).toFixed(3)} vol pts.\n`);

  const variants = [
    ['NO FILTER (baseline)', null],
    ['VRP > 0 (sell only when IV>RV)', m => m.vrp != null && m.vrp > 0],
    ['VRP > +2 vol pts (richer)', m => m.vrp != null && m.vrp > 0.02],
    ['IV percentile > 50%', m => m.ivPct != null && m.ivPct > 0.5],
    ['VRP>0 AND IV pct>40%', m => m.vrp != null && m.vrp > 0 && m.ivPct != null && m.ivPct > 0.4],
  ];

  console.log('Filter                              Trades  Skip  Win%   Net₹       Net/Trade  MaxDD%');
  const results = [];
  for (const [name, gate] of variants) {
    const r = runStrangle(days, ivSeries, undSeries, gate);
    results.push({ name, ...r });
    console.log(
      name.padEnd(35),
      String(r.trades).padStart(5), String(r.skipped).padStart(5),
      String(r.winPct + '%').padStart(6),
      ('₹' + r.net.toLocaleString('en-IN')).padStart(11),
      ('₹' + r.netPerTrade.toLocaleString('en-IN')).padStart(10),
      String(r.maxDDpct + '%').padStart(7),
    );
  }

  // Verdict: did filtering improve net-per-trade and/or drawdown vs baseline?
  const base = results[0];
  console.log('\n===== VERDICT (vs baseline) =====');
  let best = base;
  for (const r of results.slice(1)) {
    const ptDelta = r.netPerTrade - base.netPerTrade;
    const ddDelta = r.maxDDpct - base.maxDDpct;
    const verdict = (r.netPerTrade > base.netPerTrade && r.maxDDpct <= base.maxDDpct + 0.3) ? 'HELPS'
                  : (r.netPerTrade < base.netPerTrade * 0.9) ? 'HURTS' : 'neutral';
    console.log(`  ${r.name.padEnd(35)} net/trade ${ptDelta >= 0 ? '+' : ''}₹${ptDelta} · DD ${ddDelta >= 0 ? '+' : ''}${ddDelta.toFixed(1)}% → ${verdict}`);
    if (r.netPerTrade > best.netPerTrade && r.maxDDpct <= base.maxDDpct + 0.3) best = r;
  }
  console.log(`\nBEST: ${best.name} — net/trade ₹${best.netPerTrade}, win ${best.winPct}%, maxDD ${best.maxDDpct}% (baseline net/trade ₹${base.netPerTrade}).`);
  if (best === base) console.log('No filter beat the baseline on this window — the strangle already trades a favorable set; filter adds little here (but may protect in an inverted regime not present in this 300-day sample).');

  fs.writeFileSync('bt-data/result-strangle-regime.json', JSON.stringify({ days: days.length, posVrpPct: Math.round(100 * posVrp / vrps.length), results: results.map(({ _trades, ...r }) => r) }, null, 1));
  console.log('\nSaved: bt-data/result-strangle-regime.json');
}

main();
