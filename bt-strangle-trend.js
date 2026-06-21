// ============================================================================
//  bt-strangle-trend.js — Tier-3 #7: a TREND overlay as cheap tail defense.
//
//  AQR (credible, primary): systematically BUYING puts as a tail hedge bleeds
//  ~-6.4%/yr; TREND-FOLLOWING is a cheaper indirect hedge (+8.7%/yr, crisis-
//  positive). For a vol SELLER the analogue is: don't sell premium INTO a strong
//  trend — that's where a short strangle bleeds (the move keeps going through a
//  short strike). So skip new entries (and/or de-risk) when the index is trending
//  hard. This tests whether an entry-time trend filter avoids the losing trades.
//
//  Trend metrics from the index series: distance from SMA(N), and N-day momentum.
//  Compared on the SAME strangle (ATM±1.5%, 2x stop, 1% slippage, charges).
// ============================================================================
const fs = require('fs');
const path = require('path');
const { roundTripCharges } = require('./charges.js');

const { BHAV, LOT, CAPITAL, RISK_PCT, loadDay, leg, atmStrike, sizeLots } = require('./bt-lib.js');
const OTM_PCT = 0.015, STOP_MULT = 2.0, SLIP = 0.01;
const SMA_N = 10, MOM_N = 5;

// loadDay / leg / atmStrike / sizeLots come from bt-lib.js (shared loader).
function sellLegPnl(open, dayHigh, exitClose) {
  let exit = exitClose, reason = 'CLOSE';
  if (dayHigh >= open * STOP_MULT) { exit = open * STOP_MULT; reason = 'SL'; }
  return { pnlPerUnit: open * (1 - SLIP) - exit * (1 + SLIP), exit, reason };
}
function sma(arr, i, n) { if (i < n - 1) return null; let s = 0; for (let j = i - n + 1; j <= i; j++) s += arr[j]; return s / n; }

function run(days, und, gate) {
  let cap = CAPITAL; const trades = []; let cooldownUntil = null, skipped = 0;
  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    if (cooldownUntil && day.date <= cooldownUntil) continue;
    const atm = atmStrike(day);
    const off = Math.round((day.underlying * OTM_PCT) / 50) * 50;
    const ce = leg(day, 'CE', atm + off), pe = leg(day, 'PE', atm - off);
    if (!ce || !pe || ce.o < 1 || pe.o < 1) continue;

    const smaV = sma(und, i, SMA_N);
    const smaDist = smaV ? Math.abs(und[i] - smaV) / und[i] : 0;            // |spot−SMA|/spot
    const mom = i >= MOM_N ? Math.abs(und[i] / und[i - MOM_N] - 1) : 0;     // |N-day return|
    if (gate && !gate({ smaDist, mom })) { skipped++; continue; }

    const r1 = sellLegPnl(ce.o, ce.h, ce.c), r2 = sellLegPnl(pe.o, pe.h, pe.c);
    const credit = ce.o + pe.o, lots = sizeLots(cap, credit), qty = lots * LOT;
    const gross = (r1.pnlPerUnit + r2.pnlPerUnit) * qty;
    const ch = roundTripCharges(ce.o, r1.exit, qty).total + roundTripCharges(pe.o, r2.exit, qty).total;
    const pnl = Math.round(gross - ch);
    cap += pnl; trades.push({ date: day.date, pnl, cap: Math.round(cap) }); cooldownUntil = day.nearExp;
  }
  const wins = trades.filter(t => t.pnl > 0).length;
  let peak = CAPITAL, maxDD = 0;
  for (const t of trades) { peak = Math.max(peak, t.cap); maxDD = Math.max(maxDD, (peak - t.cap) / peak); }
  return {
    trades: trades.length, skipped, winPct: trades.length ? Math.round(100 * wins / trades.length) : 0,
    net: Math.round(cap - CAPITAL), netPerTrade: trades.length ? Math.round((cap - CAPITAL) / trades.length) : 0,
    maxDDpct: +(maxDD * 100).toFixed(1),
  };
}

function main() {
  const files = fs.readdirSync(BHAV).filter(f => f.startsWith('nifty-') && f.endsWith('.csv')).sort();
  const days = files.map(f => loadDay(path.join(BHAV, f))).filter(Boolean);
  const und = days.map(d => d.underlying);
  console.log(`Loaded ${days.length} real trading days (${days[0].date} → ${days[days.length - 1].date})\n`);

  const variants = [
    ['NO FILTER (baseline)', null],
    ['Skip when |spot−SMA10| > 1.5%', m => m.smaDist <= 0.015],
    ['Skip when |5-day move| > 2.5%', m => m.mom <= 0.025],
    ['Skip when EITHER (trend strong)', m => m.smaDist <= 0.015 && m.mom <= 0.025],
  ];
  console.log('Filter                              Trades  Skip  Win%   Net₹       Net/Trade  MaxDD%');
  const results = [];
  for (const [name, gate] of variants) {
    const r = run(days, und, gate); results.push({ name, ...r });
    console.log(name.padEnd(35), String(r.trades).padStart(5), String(r.skipped).padStart(5),
      String(r.winPct + '%').padStart(6), ('₹' + r.net.toLocaleString('en-IN')).padStart(11),
      ('₹' + r.netPerTrade.toLocaleString('en-IN')).padStart(10), String(r.maxDDpct + '%').padStart(7));
  }
  const base = results[0];
  console.log('\n===== VERDICT (vs baseline) =====');
  let best = base;
  for (const r of results.slice(1)) {
    const v = (r.netPerTrade > base.netPerTrade && r.maxDDpct <= base.maxDDpct + 0.3) ? 'HELPS'
            : (r.netPerTrade < base.netPerTrade * 0.9) ? 'HURTS' : 'neutral';
    console.log(`  ${r.name.padEnd(35)} net/trade ${r.netPerTrade - base.netPerTrade >= 0 ? '+' : ''}₹${r.netPerTrade - base.netPerTrade} · DD ${(r.maxDDpct - base.maxDDpct).toFixed(1)}% → ${v}`);
    if (r.netPerTrade > best.netPerTrade && r.maxDDpct <= base.maxDDpct + 0.3) best = r;
  }
  console.log(`\nBEST: ${best.name} (net/trade ₹${best.netPerTrade}, DD ${best.maxDDpct}%).`);
  if (best === base) console.log('No trend filter beat baseline on this calm-ish window — but the AQR rationale is crisis protection, which a 300-day sample may not contain. Keep it available as a kill-switch for trending regimes.');
  fs.writeFileSync('bt-data/result-strangle-trend.json', JSON.stringify({ days: days.length, results }, null, 1));
  console.log('\nSaved: bt-data/result-strangle-trend.json');
}
main();
