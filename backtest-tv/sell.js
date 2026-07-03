/**
 * ANTIGRAVITY BACKTEST — SELLING side (the real edge), 20-year / 1200+ expiries.
 *
 * The existing run.js only tests option BUYING. Our whole thesis is that the
 * EDGE is option SELLING (VRP). This script re-uses run.js's proven plumbing
 * (Yahoo daily OHLCV, expiry-day generator, Black-Scholes, historical vol) but
 * simulates SHORT premium on every expiry, over the same 1200+ expiries.
 *
 * Model (honest, stated up front):
 *   - 0-DTE expiry-day sell: enter the structure at the day OPEN (BS-priced with
 *     ~6h to expiry and expiry-morning IV = 1.7x HV, min 30% — the same IV the
 *     buy sim uses, so both sides price identically), settle at the day CLOSE
 *     (intrinsic). This IS a real Indian strategy (expiry-day theta crush).
 *   - Intraday stop: if cost-to-close at the day's adverse extreme (HIGH for the
 *     short call, LOW for the short put), priced with ~3h left, reaches
 *     stopMult x credit, the structure is stopped there. Else it settles at close.
 *   - Strikes from the expected move EM = open x IV x sqrt(T): straddle = ATM,
 *     strangle = ATM +/- 1 EM, condor = strangle + wings 1 EM beyond the shorts.
 *   - Charges: real round-trip costs (charges.js) on every leg, lot-sized.
 *
 * Caveat: daily-resolution, BS-modelled (no real bid/ask or tick path). Treat
 * win-rates as ballpark and COMPARABLE to the buy sim (identical pricing engine).
 * Real-premium truth remains the bhavcopy backtests. Selling's tail is the risk.
 */
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['ripHistorical', 'yahooSurvey'] });

const { toYmd, generateExpiryDays, histVol } = require('./run.js');
const { roundTripCharges } = require('../charges.js');

const INDEX_CONFIG = {
  SENSEX:    { yahoo: '^BSESN',   strikeStep: 100, lot: 20, label: 'SENSEX' },
  NIFTY:     { yahoo: '^NSEI',    strikeStep: 50,  lot: 75, label: 'NIFTY' },
  BANKNIFTY: { yahoo: '^NSEBANK', strikeStep: 100, lot: 35, label: 'BANKNIFTY' },
};
const norm = v => { const s = String(v || 'NIFTY').toUpperCase(); return INDEX_CONFIG[s] ? s : 'NIFTY'; };

// ── Black-Scholes (self-contained; identical to run.js) ──
function normCDF(x) {
  const a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429], p = 0.3275911;
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a[4] * t + a[3]) * t) + a[2]) * t + a[1]) * t + a[0]) * t * Math.exp(-x * x);
  return 0.5 * (1 + s * y);
}
function bsPrice(S, K, T, r, sig, type) {
  if (T < 0.00001) return Math.max(type === 'CE' ? S - K : K - S, 0);
  const d1 = (Math.log(S / K) + (r + 0.5 * sig * sig) * T) / (sig * Math.sqrt(T));
  const d2 = d1 - sig * Math.sqrt(T);
  return type === 'CE' ? S * normCDF(d1) - K * Math.exp(-r * T) * normCDF(d2)
                       : K * Math.exp(-r * T) * normCDF(-d2) - S * normCDF(-d1);
}

const R = 0.065;
const T_ENTRY = 6.0 / (252 * 6.5);   // ~6h to expiry
const T_MID   = 3.0 / (252 * 6.5);   // ~3h left at the adverse extreme
const STOP_MULT = Number(process.env.SELL_STOP_MULT || 2.5);   // stop if cost >= credit x this
const MIN_HV = 0.10;                                            // skip dead-calm days

// One 0-DTE selling trade on an expiry day's candle.
function sellTrade({ candle, vol, step, lot, kind }) {
  const { open, high, low, close } = candle;
  if (!(open > 0 && high > 0 && low > 0 && close > 0)) return null;
  if (vol < MIN_HV) return null;                                // regime filter
  const iv = Math.max(vol * 1.7, 0.30);                         // expiry-morning IV (same as buy sim)
  const atm = Math.round(open / step) * step;
  const em = open * iv * Math.sqrt(T_ENTRY);                    // 0-DTE expected move
  const emSteps = Math.max(1, Math.round(em / step));
  const off = kind === 'STRADDLE' ? 0 : emSteps * step;
  const wing = emSteps * step;

  const ceK = atm + off, peK = atm - off;
  const legs = [
    { type: 'CE', K: ceK, side: 1 },   // sell
    { type: 'PE', K: peK, side: 1 },
  ];
  if (kind === 'CONDOR') {
    legs.push({ type: 'CE', K: ceK + wing, side: -1 });        // buy wings
    legs.push({ type: 'PE', K: peK - wing, side: -1 });
  }

  // entry prices + net credit
  let credit = 0;
  for (const l of legs) { l.entry = bsPrice(open, l.K, T_ENTRY, R, iv, l.type); credit += l.side * l.entry; }
  if (credit <= 0.5) return null;                               // no meaningful premium

  // adverse intraday cost-to-close: worst of (spot at HIGH) and (spot at LOW), ~3h left
  const structCost = (S) => legs.reduce((s, l) => s + l.side * bsPrice(S, l.K, T_MID, R, iv, l.type), 0);
  const worstCost = Math.max(structCost(high), structCost(low));

  let exitCost, reason;
  if (worstCost >= credit * STOP_MULT) { exitCost = credit * STOP_MULT; reason = 'STOP'; }
  else {                                                        // settle at close intrinsic
    exitCost = legs.reduce((s, l) => s + l.side * Math.max(l.type === 'CE' ? close - l.K : l.K - close, 0), 0);
    exitCost = Math.max(0, exitCost);
    reason = (exitCost <= 0.05) ? 'EXPIRE_WORTHLESS' : 'SETTLE';
  }

  const pnlPts = credit - exitCost;                             // per unit (index points)
  const qty = lot;
  let charges = 0;
  for (const l of legs) charges += roundTripCharges(Math.max(0.05, l.entry),
      Math.max(0.05, l.type === 'CE' ? Math.max(close - l.K, 0) : Math.max(l.K - close, 0)), qty).total;
  const grossRs = pnlPts * qty;
  const netRs = grossRs - charges;
  return {
    kind, credit: +credit.toFixed(1), exitCost: +exitCost.toFixed(1),
    pnlPts: +pnlPts.toFixed(1), capturedPct: +((pnlPts / credit) * 100).toFixed(1),
    grossRs: Math.round(grossRs), charges: Math.round(charges), netRs: Math.round(netRs),
    win: netRs > 0, reason, ceK, peK, iv: +iv.toFixed(3),
  };
}

function summarize(kind, trades) {
  const t = trades.filter(Boolean);
  const W = t.filter(x => x.netRs > 0), L = t.filter(x => x.netRs <= 0);
  const gw = W.reduce((s, x) => s + x.netRs, 0), gl = Math.abs(L.reduce((s, x) => s + x.netRs, 0));
  const net = t.reduce((s, x) => s + x.netRs, 0);
  const byYear = {};
  for (const x of t) { const y = x._year; (byYear[y] = byYear[y] || { trades: 0, wins: 0, net: 0 });
    byYear[y].trades++; if (x.netRs > 0) byYear[y].wins++; byYear[y].net += x.netRs; }
  return {
    kind, trades: t.length,
    winRate: t.length ? +(W.length / t.length * 100).toFixed(1) : 0,
    pf: gl > 0 ? +(gw / gl).toFixed(2) : null,
    netRs: Math.round(net), avgRs: t.length ? Math.round(net / t.length) : 0,
    avgCapturedPct: t.length ? +(t.reduce((s, x) => s + x.capturedPct, 0) / t.length).toFixed(1) : 0,
    worstRs: t.length ? Math.min(...t.map(x => x.netRs)) : 0,
    bestRs: t.length ? Math.max(...t.map(x => x.netRs)) : 0,
    stops: t.filter(x => x.reason === 'STOP').length,
    worthless: t.filter(x => x.reason === 'EXPIRE_WORTHLESS').length,
    byYear,
  };
}

async function main() {
  const instrument = norm(process.env.BACKTEST_INSTRUMENT || 'NIFTY');
  const cfg = INDEX_CONFIG[instrument];
  const numExpiries = Number(process.env.BACKTEST_NUM_EXPIRIES || 1200);
  const cutover = process.env.SENSEX_EXPIRY_CUTOVER || '2024-10-28';
  const startYear = Number(process.env.BACKTEST_START_YEAR || (numExpiries > 1200 ? 1999 : 2003));

  console.log('\n============================================================');
  console.log('  ANTIGRAVITY BACKTEST — SELLING side (0-DTE, ' + numExpiries + ' expiries)');
  console.log('============================================================');
  console.log('  Instrument: ' + instrument + '  ·  ' + cfg.yahoo + '  ·  stop ' + STOP_MULT + 'x credit\n');

  const expiryDays = generateExpiryDays({ count: numExpiries, cutoverDate: cutover, endDate: toYmd(new Date()), startYear, startDate: null, instrument });
  const first = expiryDays[0].date, last = expiryDays[expiryDays.length - 1].date;
  console.log('[1/3] ' + expiryDays.length + ' expiries: ' + first + ' -> ' + last);

  console.log('[2/3] Fetching ' + cfg.yahoo + ' daily from Yahoo...');
  const from = new Date(first); from.setDate(from.getDate() - 35);
  const to = new Date(last + 'T00:00:00Z'); to.setUTCDate(to.getUTCDate() + 2);
  let raw;
  try { raw = await yahooFinance.historical(cfg.yahoo, { period1: toYmd(from), period2: toYmd(to), interval: '1d' }); }
  catch (e) { throw new Error('Yahoo fetch failed: ' + e.message); }
  raw.sort((a, b) => new Date(a.date) - new Date(b.date));
  console.log('      ' + raw.length + ' candles (' + toYmd(raw[0].date) + ' -> ' + toYmd(raw[raw.length - 1].date) + ')\n');
  const byDate = {}; raw.forEach((c, i) => { byDate[toYmd(c.date)] = { idx: i, c }; });

  console.log('[3/3] Selling 0-DTE STRADDLE / STRANGLE / CONDOR on each expiry...');
  const kinds = ['STRADDLE', 'STRANGLE', 'CONDOR'];
  const bucket = { STRADDLE: [], STRANGLE: [], CONDOR: [] };
  let traded = 0, noData = 0, noVol = 0;
  for (const day of expiryDays) {
    const e = byDate[day.date]; if (!e) { noData++; continue; }
    const { idx, c } = e;
    const candle = { open: c.open, high: c.high, low: c.low, close: c.close };
    const prev = raw.slice(Math.max(0, idx - 21), idx).map(x => x.close);
    const vol = histVol(prev);
    if (vol < MIN_HV) { noVol++; continue; }
    const year = day.date.slice(0, 4);
    let any = false;
    for (const kind of kinds) {
      const tr = sellTrade({ candle, vol, step: cfg.strikeStep, lot: cfg.lot, kind });
      if (tr) { tr._year = year; tr.date = day.date; bucket[kind].push(tr); any = true; }
    }
    if (any) traded++;
  }

  const results = kinds.map(k => summarize(k, bucket[k]));
  const out = {
    generatedAt: new Date().toISOString(), instrument, dataSource: 'Yahoo ' + cfg.yahoo + ' daily + BS 0-DTE settlement',
    expiries: expiryDays.length, traded, skipped: { noData, noVol }, stopMult: STOP_MULT, lot: cfg.lot,
    results,
    note: 'PAPER/modelled 0-DTE selling. BS-priced, daily-resolution — comparable to the buy sim, not broker-precise. Selling tail risk is real; forward-test.',
  };
  const outPath = path.resolve('./backtest-tv-sell-results-' + instrument.toLowerCase() + '.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));

  console.log('\n============================================================');
  console.log('  SELLING RESULTS — ' + instrument + ' (' + traded + ' expiries traded, ' + cfg.lot + '-lot, net of charges)');
  console.log('============================================================');
  console.log('  Strategy    Trades  Win%    PF     Net Rs        Rs/trade  Cap%   Worst        Stops/Worthless');
  for (const r of results) {
    console.log('  ' + r.kind.padEnd(10),
      String(r.trades).padStart(5), String(r.winRate + '%').padStart(6), String(r.pf ?? '-').padStart(6),
      ('Rs' + r.netRs.toLocaleString('en-IN')).padStart(13), ('Rs' + r.avgRs.toLocaleString('en-IN')).padStart(9),
      String(r.avgCapturedPct + '%').padStart(6), ('Rs' + r.worstRs.toLocaleString('en-IN')).padStart(12),
      (r.stops + '/' + r.worthless).padStart(10));
  }
  // recent-years view on the best structure
  const best = results.slice().sort((a, b) => b.netRs - a.netRs)[0];
  console.log('\n  ' + best.kind + ' by recent year:');
  for (const y of ['2020', '2021', '2022', '2023', '2024', '2025', '2026']) {
    const d = best.byYear[y]; if (d) console.log('    ' + y + ':  ' + String(d.trades).padStart(3) + ' trades  ' +
      String(Math.round(d.wins / d.trades * 100)).padStart(3) + '% win  net Rs' + d.net.toLocaleString('en-IN'));
  }
  console.log('\n  Saved -> ' + outPath);
  console.log('============================================================\n');
}

if (require.main === module) main().then(() => process.exit(0)).catch(e => { console.error('Fatal:', e.message); process.exit(1); });
module.exports = { sellTrade, bsPrice, summarize };
