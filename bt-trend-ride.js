/**
 * bt-trend-ride.js — BACKTEST HARNESS for the trend-ride strategy.
 * ============================================================================
 * Mirrors trend-ride-engine.js EXACTLY (same params via its exported DEFAULTS,
 * same entry/exit/filter logic) so the backtest and the live paper engine can
 * never drift. Reports NET P&L — real charges (charges.js) PLUS a modelled
 * bid/ask spread — because GROSS points are not what a real account earns.
 *
 * TWO data sources (see docs/BACKTEST-DATA-PROCUREMENT.md):
 *   • --src=optcandles  → the 9 days in data/opt-candles (works TODAY; premium
 *                         OHLC only, no OI/vol; underlying rebuilt via parity).
 *   • --src=purchased --dir=<path>  → the Track-B data you buy: per-day CSV with
 *                         datetime,expiry,strike,type,open,high,low,close,volume,
 *                         openInterest,iv,spot  (spot optional; parity if absent).
 *
 * Strategy (identical to the engine):
 *   entry  = trend-side leg premium in [entryLo,entryHi] on a >=trigger coiled
 *            move, WITH the 60-min SMA trend, efficiency-ratio >= minER (not chop)
 *   exit   = underlying bracket (+target / -stop index pts) or square-off
 *   pnl    = (exit-entry)*units - charges - spread*units          ← NET
 *
 * Usage:
 *   node bt-trend-ride.js                          # optcandles smoke test
 *   node bt-trend-ride.js --src=purchased --dir=./data/hist-options --spread=1
 */
const fs = require('fs'), path = require('path');
const { roundTripCharges } = require('./charges.js');
const instrumentRegistry = require('./instrument-registry.js');
const { DEFAULTS } = require('./trend-ride-engine.js');   // single source of truth for params

// ── knobs (match the engine defaults; override via flags) ──
const arg = (k, d) => { const m = process.argv.find(a => a.startsWith(`--${k}=`)); return m ? m.split('=')[1] : d; };
const SRC        = arg('src', 'optcandles');
const DIR        = arg('dir', SRC === 'optcandles' ? path.join(__dirname, 'data', 'opt-candles') : '');
const SPREAD     = parseFloat(arg('spread', 1.0));   // round-trip bid/ask cost in premium points (conservative for a ~15 option)
const ENTRY_LO = 13, ENTRY_HI = 17, LOOKBACK = 15;
const TREND_MA = 60, ER_WIN = 15, MIN_ER = 0.35;     // = engine defaults (validated)
const SQUAREOFF = 15 * 60 + 15;
const INSTS = ['NIFTY', 'BANKNIFTY'];                // SENSEX has no reliable historical underlying here

// ══════════════════════════════════════════════════════════════════════════
// DATA LOADERS — both return: { day, insts: { INST: { minutes:[ms...],
//   spot:Map<ms,px>, legs:Map<'STRIKE|TYPE', Map<ms,{o,h,l,c}>> } } }
// ══════════════════════════════════════════════════════════════════════════
function parityMap(legMap) {
  // spot ≈ K + CE − PE, median across strikes with both a live CE & PE at that ms
  const byMs = new Map();
  for (const [key, series] of legMap) {
    const [strikeStr, type] = key.split('|'); const strike = +strikeStr;
    for (const [ms, bar] of series) {
      if (!(bar.c > 0)) continue;
      let e = byMs.get(ms); if (!e) { e = new Map(); byMs.set(ms, e); }
      let s = e.get(strike); if (!s) { s = {}; e.set(strike, s); }
      if (type === 'CE') s.ce = bar.c; else s.pe = bar.c;
    }
  }
  const spot = new Map();
  for (const [ms, strikes] of byMs) {
    const est = []; for (const [k, s] of strikes) if (s.ce != null && s.pe != null) est.push(k + s.ce - s.pe);
    if (est.length) { est.sort((a, b) => a - b); spot.set(ms, est[Math.floor(est.length / 2)]); }
  }
  return spot;
}

function loadOptCandles() {
  const days = [];
  for (const file of fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort()) {
    const j = JSON.parse(fs.readFileSync(path.join(DIR, file)));
    const insts = {};
    for (const key of Object.keys(j.series || {})) {
      const [inst, strike, type] = key.split('|');
      if (!INSTS.includes(inst) || !(type === 'CE' || type === 'PE')) continue;
      insts[inst] = insts[inst] || { legs: new Map() };
      const series = new Map();
      for (const [ms, o, h, l, c] of j.series[key]) series.set(ms, { o, h, l, c });
      insts[inst].legs.set(`${strike}|${type}`, series);
    }
    for (const inst of Object.keys(insts)) {
      insts[inst].spot = parityMap(insts[inst].legs);
      insts[inst].minutes = [...insts[inst].spot.keys()].sort((a, b) => a - b);
    }
    days.push({ day: file.replace('.json', ''), insts });
  }
  return days;
}

// Track-B purchased CSV loader. One file per day (or all), header:
//   datetime,expiry,strike,type,open,high,low,close,volume,openInterest,iv,spot
function loadPurchased() {
  if (!DIR || !fs.existsSync(DIR)) { console.error(`purchased dir not found: ${DIR}`); process.exit(1); }
  const byDay = {};
  for (const file of fs.readdirSync(DIR).filter(f => /\.csv$/i.test(f)).sort()) {
    const lines = fs.readFileSync(path.join(DIR, file), 'utf8').split(/\r?\n/).filter(Boolean);
    const head = lines[0].split(',').map(s => s.trim().toLowerCase());
    const col = n => head.indexOf(n);
    for (let i = 1; i < lines.length; i++) {
      const r = lines[i].split(',');
      const dt = r[col('datetime')]; if (!dt) continue;
      const inst = (r[col('instrument')] || '').toUpperCase() || guessInst(r[col('strike')]);
      if (!INSTS.includes(inst)) continue;
      const day = dt.slice(0, 10); const ms = Date.parse(dt);
      const type = (r[col('type')] || '').toUpperCase();
      const strike = +r[col('strike')];
      byDay[day] = byDay[day] || {};
      const I = byDay[day][inst] = byDay[day][inst] || { legs: new Map(), spot: new Map() };
      const k = `${strike}|${type}`;
      let s = I.legs.get(k); if (!s) { s = new Map(); I.legs.set(k, s); }
      s.set(ms, { o: +r[col('open')], h: +r[col('high')], l: +r[col('low')], c: +r[col('close')],
        vol: +r[col('volume')] || 0, oi: +r[col('openinterest')] || 0, iv: +r[col('iv')] || 0 });
      const sp = col('spot') >= 0 ? +r[col('spot')] : NaN;
      if (isFinite(sp) && sp > 0) I.spot.set(ms, sp);
    }
  }
  const days = [];
  for (const day of Object.keys(byDay).sort()) {
    const insts = byDay[day];
    for (const inst of Object.keys(insts)) {
      const I = insts[inst];
      if (!I.spot.size) I.spot = parityMap(I.legs);     // no spot column → parity
      I.minutes = [...I.spot.keys()].sort((a, b) => a - b);
    }
    days.push({ day, insts });
  }
  return days;
}
function guessInst() { return null; }   // purchased files should carry an `instrument` column

// ══════════════════════════════════════════════════════════════════════════
// STRATEGY — identical decision logic to trend-ride-engine.js
// ══════════════════════════════════════════════════════════════════════════
const istMin = ms => { const d = new Date(ms + 5.5 * 3600e3); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const minuteCloses = (spot, minutes, now, mins) => {
  const since = now - mins * 60000, per = new Map();
  for (const ms of minutes) { if (ms < since || ms > now) continue; per.set(Math.floor(ms / 60000), spot.get(ms)); }
  return [...per.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]);
};

function runInst(inst, I, day, trades) {
  const p = DEFAULTS[inst]; if (!p) return;
  const lot = instrumentRegistry.lotSize(inst); if (!lot) return;
  const minutes = I.minutes, spot = I.spot;
  let pos = null;
  for (const now of minutes) {
    const px = spot.get(now); const m = istMin(now);
    if (pos) {
      const leg = I.legs.get(pos.key); const bar = leg && leg.get(now);
      if (bar) pos.last = bar.c;
      const moveDir = pos.dir > 0 ? (px - pos.entrySpot) : (pos.entrySpot - px);
      let reason = null;
      if (moveDir >= p.target) reason = 'TARGET';
      else if (moveDir <= -p.stop) reason = 'STOP';
      else if (m >= SQUAREOFF) reason = 'SQUARE_OFF';
      if (reason) { close(inst, pos, pos.last, reason, lot, day, px, trades); pos = null; }
      continue;
    }
    if (m >= SQUAREOFF) continue;
    // trigger: |move| over lookback, coiled window
    const past = spot.get(nearestAtOrBefore(minutes, now - LOOKBACK * 60000)) ?? px;
    const move = px - past;
    const win = minuteCloses(spot, minutes, now, LOOKBACK);
    const range = win.length ? Math.max(...win) - Math.min(...win) : 0;
    if (range > p.preRange + p.trigger) continue;
    const dir = move >= p.trigger ? 1 : move <= -p.trigger ? -1 : 0;
    if (!dir) continue;
    // trend filter (SMA60) — trade WITH the broader trend
    const ma = minuteCloses(spot, minutes, now, TREND_MA);
    if (ma.length < 5) continue;
    const maVal = ma.reduce((a, v) => a + v, 0) / ma.length;
    if (dir > 0 ? !(px > maVal) : !(px < maVal)) continue;
    // chop filter (efficiency ratio)
    const er = minuteCloses(spot, minutes, now, ER_WIN);
    if (er.length < 5) continue;
    let pathLen = 0; for (let k = 1; k < er.length; k++) pathLen += Math.abs(er[k] - er[k - 1]);
    const efficiency = pathLen > 0 ? Math.abs(er[er.length - 1] - er[0]) / pathLen : 0;
    if (efficiency < MIN_ER) continue;
    // pick trend-side leg with premium ~15
    const side = dir > 0 ? 'CE' : 'PE';
    let best = null;
    for (const [key, series] of I.legs) {
      if (!key.endsWith('|' + side)) continue;
      const bar = series.get(now); if (!bar) continue;
      if (!(bar.c >= ENTRY_LO && bar.c <= ENTRY_HI)) continue;
      const d = Math.abs(bar.c - 15); if (!best || d < best.d) best = { key, entry: bar.c, d };
    }
    if (!best) continue;
    pos = { key: best.key, side, entry: best.entry, last: best.entry, entrySpot: px, dir };
  }
}
function nearestAtOrBefore(minutes, target) { let b = null; for (const ms of minutes) { if (ms <= target) b = ms; else break; } return b; }

function close(inst, pos, exit, reason, lot, day, spotNow, trades) {
  const units = lot;
  const gross = (exit - pos.entry) * units;
  const charges = roundTripCharges(pos.entry, exit, units).total;
  const spreadCost = SPREAD * units;
  const net = gross - charges - spreadCost;
  trades.push({ day, inst, side: pos.side, key: pos.key, entry: pos.entry, exit: +exit.toFixed(2),
    reason, dir: pos.dir, grossPts: +(exit - pos.entry).toFixed(2), gross: +gross.toFixed(0),
    charges: +charges.toFixed(0), spread: +spreadCost.toFixed(0), net: +net.toFixed(0),
    spotMove: +(spotNow - pos.entrySpot).toFixed(0) });
}

// ══════════════════════════════════════════════════════════════════════════
const days = SRC === 'purchased' ? loadPurchased() : loadOptCandles();
const trades = [];
for (const { day, insts } of days) for (const inst of Object.keys(insts)) runInst(inst, insts[inst], day, trades);

function stat(a) {
  const n = a.length; if (!n) return 'no trades';
  const w = a.filter(t => t.net > 0).length;
  const g = a.filter(t => t.net > 0).reduce((s, t) => s + t.net, 0), l = -a.filter(t => t.net < 0).reduce((s, t) => s + t.net, 0);
  const gp = a.reduce((s, t) => s + t.grossPts, 0);
  return `n ${n} · win ${(w / n * 100).toFixed(0)}% · NET ₹${a.reduce((s, t) => s + t.net, 0)} · PF ${l ? (g / l).toFixed(2) : '∞'} · grossPts ${gp >= 0 ? '+' : ''}${gp.toFixed(0)}`;
}
console.log('══════════════════════════════════════════════════════════════════════');
console.log(` bt-trend-ride · src=${SRC} · spread=${SPREAD}pt · days=${days.length} · (mirrors trend-ride-engine.js)`);
console.log('══════════════════════════════════════════════════════════════════════');
console.log(' ALL      :', stat(trades));
for (const inst of INSTS) console.log(`   ${inst.padEnd(9)}:`, stat(trades.filter(t => t.inst === inst)));
console.log('   CALL     :', stat(trades.filter(t => t.dir > 0)));
console.log('   PUT      :', stat(trades.filter(t => t.dir < 0)));
console.log(' ─────────────────────────────────────────────────────────────────────');
if (SRC === 'optcandles') {
  console.log(' NOTE: only 9 days + SMA60 needs 60min of history → few/no trades is EXPECTED.');
  console.log('       This is a plumbing smoke test. Real verdict needs Track-B purchased data');
  console.log('       (docs/BACKTEST-DATA-PROCUREMENT.md). Then: node bt-trend-ride.js --src=purchased --dir=<path>');
} else {
  console.log(` NET is after charges + ${SPREAD}pt spread. THIS is the real-money-decision number.`);
}
if (trades.length) { console.log(' sample:'); trades.slice(0, 10).forEach(t =>
  console.log(`   ${t.day} ${t.inst} ${t.key} entry ${t.entry} → ${t.exit} [${t.reason}] net ₹${t.net} (spotMove ${t.spotMove})`)); }
