// ============================================================================
//  bt-world-strategies.js — the WORLD'S documented profitable option mechanics,
//  re-tested honestly on REAL NIFTY bhavcopy (same 600-day dataset, charges.js).
//
//  Source mechanics (deep-research 2026-07-02; see docs/WORLD-STRATEGIES.md):
//   1. TT_MANAGE50   — tastytrade core mechanic: sell strangle, EXIT AT 50% OF
//                      MAX PROFIT instead of holding to expiry. Their studies
//                      (SPY, 45DTE 16Δ) show managing at 50% beats hold-to-exp
//                      on risk-adjusted basis (higher win rate, far smaller tail).
//   2. TT_CONDOR50   — same 50%-management on the defined-risk iron condor.
//   3. EM_STRANGLE   — ORATS/OptionAlpha finding: strikes from the EXPECTED MOVE
//                      (ATM straddle price) beat fixed-% strikes — sell at
//                      ATM ± 1.0× expected move (≈ 1σ, ~68% containment).
//   4. PUT_WRITE     — CBOE PUT-index mechanic (30y: equity-like returns, lower
//                      vol): sell one cash-secured ~2%-OTM weekly put.
//   5. Baseline      — our validated SHORT_STRANGLE (hold to expiry) for
//                      apples-to-apples comparison on the SAME days.
//
//  HONESTY NOTES
//   - Multi-day tracking: positions are walked day-by-day to expiry through the
//     real bhavcopy files (not the single-entry-day proxy of bt-strategies.js),
//     because 50%-profit management NEEDS the daily path.
//   - Daily resolution: TP/SL trigger on daily CLOSES (leg-stop also checks the
//     day HIGH — worst case for a seller). No intraday path exists in bhavcopy,
//     so treat win-rates as ballpark, comparable ACROSS strategies here.
//   - charges.js round-trip costs on every leg. Compounding from ₹1L, 5% risk.
// ============================================================================
'use strict';
const fs = require('fs');
const { roundTripCharges } = require('./charges.js');
const { LOT, CAPITAL, loadDays, atmStrike, sizeLots } = require('./bt-lib.js');

const legAt = (day, type, strike, exp) =>
  day.opts.find(o => o.type === type && o.strike === strike && o.xpry === exp);

// ── multi-day position walker ────────────────────────────────────────────────
// legs: [{type, strike, side:+1 sell|-1 buy, entry}] · exp: expiry date string.
// Walks forward from dayIdx+1 until exp; each day computes cost-to-close
// (Σ sell-leg close − Σ buy-leg close) and applies the exit rules:
//   tpFrac   — exit when cost ≤ credit×(1−tpFrac)            (profit take)
//   stopMult — exit when cost ≥ credit×stopMult (close-based) (credit stop)
//   legStop  — exit if any SOLD leg's day-HIGH ≥ entry×legStop (2× leg stop)
// Returns { exitCost, reason, exitDate, legExits }.
function walk(days, dayIdx, legs, exp, credit, { tpFrac = null, stopMult = null, legStop = null } = {}) {
  let last = null;
  for (let i = dayIdx + 1; i < days.length; i++) {
    const d = days[i];
    if (d.date > exp) break;
    const quotes = legs.map(l => legAt(d, l.type, l.strike, exp));
    if (quotes.some(q => !q)) continue;                    // illiquid day — carry
    const cost = legs.reduce((s, l, j) => s + l.side * quotes[j].c, 0);
    const legExits = quotes.map(q => q.c);
    last = { cost, legExits, date: d.date };
    // 2× leg stop against the day HIGH (seller's worst case), sold legs only
    if (legStop) {
      const j = legs.findIndex((l, j2) => l.side > 0 && quotes[j2].h >= l.entry * legStop);
      if (j >= 0) {
        const stopped = legs.reduce((s, l, j2) => s + l.side * (j2 === j ? l.entry * legStop : quotes[j2].c), 0);
        return { exitCost: stopped, reason: 'LEG_SL', exitDate: d.date, legExits: legExits.map((x, j2) => j2 === j ? legs[j].entry * legStop : x) };
      }
    }
    if (stopMult && cost >= credit * stopMult) return { exitCost: cost, reason: 'CREDIT_SL', exitDate: d.date, legExits };
    if (tpFrac && cost <= credit * (1 - tpFrac)) return { exitCost: cost, reason: 'TP50', exitDate: d.date, legExits };
    if (d.date === exp) return { exitCost: cost, reason: 'EXPIRY', exitDate: d.date, legExits };
  }
  if (last) return { exitCost: last.cost, reason: 'DATA_END', exitDate: last.date, legExits: last.legExits };
  // never found a tradable later day — expire worthless-at-entry (skip-safe)
  return { exitCost: credit, reason: 'NO_PATH', exitDate: days[dayIdx].date, legExits: legs.map(l => l.entry) };
}

function closeOut(legs, legExits, qty) {
  let charges = 0;
  for (let j = 0; j < legs.length; j++) charges += roundTripCharges(Math.max(0.05, legs[j].entry), Math.max(0.05, legExits[j]), qty).total;
  return charges;
}

// round to nearest 50-pt NIFTY strike
const K = v => Math.round(v / 50) * 50;

// ── strategy entry builders (called on each fresh weekly-cycle day) ──────────
function mkStrangle(day, offPts) {
  const atm = atmStrike(day);
  const ce = legAt(day, 'CE', K(atm + offPts), day.nearExp);
  const pe = legAt(day, 'PE', K(atm - offPts), day.nearExp);
  if (!ce || !pe || ce.o < 1 || pe.o < 1) return null;
  return { legs: [{ type: 'CE', strike: ce.strike, side: 1, entry: ce.o }, { type: 'PE', strike: pe.strike, side: 1, entry: pe.o }] };
}
function mkCondor(day, offPts, wingPts) {
  const base = mkStrangle(day, offPts);
  if (!base) return null;
  const atm = atmStrike(day);
  const lce = legAt(day, 'CE', K(atm + offPts + wingPts), day.nearExp);
  const lpe = legAt(day, 'PE', K(atm - offPts - wingPts), day.nearExp);
  if (!lce || !lpe) return null;
  base.legs.push({ type: 'CE', strike: lce.strike, side: -1, entry: lce.o });
  base.legs.push({ type: 'PE', strike: lpe.strike, side: -1, entry: lpe.o });
  return base;
}
function expectedMovePts(day) {
  const atm = atmStrike(day);
  const ce = legAt(day, 'CE', atm, day.nearExp), pe = legAt(day, 'PE', atm, day.nearExp);
  if (!ce || !pe) return null;
  return ce.o + pe.o;                       // ATM straddle ≈ market's expected move to expiry
}

// ── strategies (name → per-cycle trade or null) ──────────────────────────────
const STRATS = {
  // baseline: our validated strangle, hold to expiry (leg 2× stop only)
  BASE_STRANGLE(days, i, day) {
    const s = mkStrangle(day, day.underlying * 0.015);
    if (!s) return null;
    return { ...s, exit: { legStop: 2.0 } };
  },
  // 1. tastytrade: same strangle, MANAGE AT 50% of credit (+2× credit stop)
  TT_MANAGE50(days, i, day) {
    const s = mkStrangle(day, day.underlying * 0.015);
    if (!s) return null;
    return { ...s, exit: { tpFrac: 0.5, stopMult: 2.0, legStop: 2.0 } };
  },
  // 2. tastytrade on defined risk: condor managed at 50% (no leg stop — wings cap it)
  TT_CONDOR50(days, i, day) {
    const s = mkCondor(day, day.underlying * 0.012, 200);
    if (!s) return null;
    const credit = s.legs.reduce((x, l) => x + l.side * l.entry, 0);
    if (credit <= 0) return null;
    return { ...s, exit: { tpFrac: 0.5 } };
  },
  // 3. ORATS/OptionAlpha: strikes at ATM ± 1.0× EXPECTED MOVE, manage at 50%
  EM_STRANGLE(days, i, day) {
    const em = expectedMovePts(day);
    if (!em || em < 50) return null;
    const s = mkStrangle(day, em);
    if (!s) return null;
    return { ...s, exit: { tpFrac: 0.5, stopMult: 2.0, legStop: 2.0 } };
  },
  // 4. CBOE PUT-write: sell one ~2%-OTM weekly put, hold to expiry (2× leg stop)
  PUT_WRITE(days, i, day) {
    const atm = atmStrike(day);
    const pe = legAt(day, 'PE', K(atm - day.underlying * 0.02), day.nearExp);
    if (!pe || pe.o < 1) return null;
    return { legs: [{ type: 'PE', strike: pe.strike, side: 1, entry: pe.o }], exit: { legStop: 2.0 } };
  },
};

// ── runner: one entry per weekly cycle (first tradable day after an expiry) ──
function run(name, days) {
  const fn = STRATS[name];
  let cap = CAPITAL, cooldownUntil = null;
  const trades = [];
  for (let i = 0; i < days.length - 1; i++) {
    const day = days[i];
    if (cooldownUntil && day.date <= cooldownUntil) continue;
    const t = fn(days, i, day);
    if (!t) continue;
    cooldownUntil = day.nearExp;
    const credit = t.legs.reduce((s, l) => s + l.side * l.entry, 0);
    const lots = sizeLots(cap, Math.abs(credit) || 1), qty = lots * LOT;
    const r = walk(days, i, t.legs, day.nearExp, credit, t.exit || {});
    const gross = (credit - r.exitCost) * qty;
    const ch = closeOut(t.legs, r.legExits, qty);
    const pnl = Math.round(gross - ch);
    cap += pnl;
    trades.push({ date: day.date, exitDate: r.exitDate, reason: r.reason, credit: +credit.toFixed(1), lots, pnl, cap: Math.round(cap) });
  }
  // stats
  const W = trades.filter(t => t.pnl > 0), L = trades.filter(t => t.pnl < 0);
  let peak = CAPITAL, maxDD = 0;
  for (const t of trades) { peak = Math.max(peak, t.cap); maxDD = Math.max(maxDD, (peak - t.cap) / peak); }
  const gw = W.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(L.reduce((s, t) => s + t.pnl, 0));
  return {
    name, trades: trades.length,
    winPct: trades.length ? Math.round(100 * W.length / trades.length) : 0,
    net: cap - CAPITAL, final: Math.round(cap),
    pf: gl > 0 ? +(gw / gl).toFixed(2) : null,
    expectancy: trades.length ? Math.round((cap - CAPITAL) / trades.length) : 0,
    maxDDpct: +(maxDD * 100).toFixed(1),
    avgWin: W.length ? Math.round(gw / W.length) : 0,
    avgLoss: L.length ? Math.round(-gl / L.length) : 0,
    worst: trades.length ? Math.min(...trades.map(t => t.pnl)) : 0,
    tpExits: trades.filter(t => t.reason === 'TP50').length,
    slExits: trades.filter(t => /SL/.test(t.reason)).length,
    trades_: trades,
  };
}

function main() {
  const days = loadDays();
  console.log(`Loaded ${days.length} real trading days (${days[0].date} → ${days[days.length - 1].date})`);
  console.log('World-strategy mechanics on REAL NIFTY premiums · multi-day daily-resolution walk · charges.js costs\n');
  const names = Object.keys(STRATS);
  const out = [];
  console.log('Strategy        Trades  Win%    PF     Net₹         ₹/trade   MaxDD%   AvgWin    AvgLoss   Worst     TP50/SL');
  for (const n of names) {
    const r = run(n, days);
    out.push(r);
    console.log(
      n.padEnd(15), String(r.trades).padStart(5), String(r.winPct + '%').padStart(6),
      String(r.pf ?? '∞').padStart(6), ('₹' + r.net.toLocaleString('en-IN')).padStart(12),
      ('₹' + r.expectancy.toLocaleString('en-IN')).padStart(9), String(r.maxDDpct + '%').padStart(7),
      ('₹' + r.avgWin.toLocaleString('en-IN')).padStart(9), ('₹' + r.avgLoss.toLocaleString('en-IN')).padStart(9),
      ('₹' + r.worst.toLocaleString('en-IN')).padStart(9),
      `${r.tpExits}/${r.slExits}`.padStart(7),
    );
  }
  fs.writeFileSync('bt-data/result-world-strategies.json',
    JSON.stringify({ generatedAt: new Date().toISOString(), days: days.length, range: [days[0].date, days[days.length - 1].date],
      results: out.map(({ trades_, ...rest }) => rest) }, null, 1));
  console.log('\nSaved: bt-data/result-world-strategies.json');
}

main();
