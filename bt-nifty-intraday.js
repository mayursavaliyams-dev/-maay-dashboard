// ============================================================================
//  bt-nifty-intraday.js — 100-trade PAPER backtest of the bot's NIFTY directional
//  signal on REAL 1-minute index data (bt-data/nifty-1min.json).
//
//  "Check the NIFTY side": runs the bot's intraday CALL/PUT logic (multi-confirm
//  CORE, minus the volume layer because index data carries no volume) over real
//  NIFTY 1-min OHLC and measures each entry against the REAL index path.
//
//  HONEST by design (matches the project's no-modeling rule):
//    - Entry  = close of the bar a fresh signal appears (flat → one position).
//    - Exit   = ATR stop / ATR target / opposite signal / end-of-day square-off.
//    - P&L    = REAL index points moved (close-to-exit). No Black-Scholes.
//  An illustrative ATM-option premium estimate (delta~0.5) is shown SEPARATELY
//  and clearly labelled as an estimate, never as a validated result.
//
//  Caps at 100 trades so the report is exactly the "100 paper trades" asked for.
// ============================================================================
const fs = require('fs');

const DATAFILE = process.argv[2] || 'bt-data/nifty-1min.json';
const LABEL = process.argv[3] || 'NIFTY';
const RAW = JSON.parse(fs.readFileSync(DATAFILE, 'utf8'));
// rows: [isoTime, open, high, low, close, volume, ?]
const bars = RAW.map(r => ({
  t: r[0], date: String(r[0]).slice(0, 10),
  o: +r[1], h: +r[2], l: +r[3], c: +r[4],
})).filter(b => b.c > 0);

// ── indicators (Wilder/standard, computed bar-by-bar, no look-ahead) ─────────
function emaSeries(src, n) {
  const k = 2 / (n + 1); const out = []; let e = src[0];
  for (let i = 0; i < src.length; i++) { e = i ? src[i] * k + e * (1 - k) : src[i]; out.push(e); }
  return out;
}
function rsiSeries(src, n = 14) {
  const out = [50]; let ag = 0, al = 0;
  for (let i = 1; i < src.length; i++) {
    const d = src[i] - src[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    if (i <= n) { ag += g; al += l; if (i === n) { ag /= n; al /= n; } out.push(i === n ? (al ? 100 - 100 / (1 + ag / al) : 100) : 50); }
    else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; out.push(al ? 100 - 100 / (1 + ag / al) : 100); }
  }
  return out;
}
function atrSeries(b, n = 14) {
  const tr = [], out = [];
  for (let i = 0; i < b.length; i++) {
    const prevC = i ? b[i - 1].c : b[i].o;
    tr.push(Math.max(b[i].h - b[i].l, Math.abs(b[i].h - prevC), Math.abs(b[i].l - prevC)));
    if (i < n) { const s = tr.reduce((a, v) => a + v, 0) / tr.length; out.push(s); }
    else out.push((out[i - 1] * (n - 1) + tr[i]) / n);
  }
  return out;
}
// session VWAP — resets each calendar day (typical price, vol unavailable → equal weight)
function vwapSeries(b) {
  const out = []; let day = null, cum = 0, cnt = 0;
  for (let i = 0; i < b.length; i++) {
    if (b[i].date !== day) { day = b[i].date; cum = 0; cnt = 0; }
    const tp = (b[i].h + b[i].l + b[i].c) / 3; cum += tp; cnt++;
    out.push(cum / cnt);
  }
  return out;
}

// ── shields: real ADX (Wilder), Supertrend, MACD histogram ───────────────────
function adxSeries(b, n = 14) {
  const tr = [], pdm = [], ndm = [];
  for (let i = 0; i < b.length; i++) {
    if (i === 0) { tr.push(b[i].h - b[i].l); pdm.push(0); ndm.push(0); continue; }
    const up = b[i].h - b[i - 1].h, dn = b[i - 1].l - b[i].l, pc = b[i - 1].c;
    pdm.push(up > dn && up > 0 ? up : 0);
    ndm.push(dn > up && dn > 0 ? dn : 0);
    tr.push(Math.max(b[i].h - b[i].l, Math.abs(b[i].h - pc), Math.abs(b[i].l - pc)));
  }
  const wilder = arr => { const o = []; let s = 0; for (let i = 0; i < arr.length; i++) { if (i < n) { s += arr[i]; o.push(i === n - 1 ? s : NaN); } else o.push(o[i - 1] - o[i - 1] / n + arr[i]); } return o; };
  const str = wilder(tr), sp = wilder(pdm), sn = wilder(ndm), dx = [], adx = [];
  for (let i = 0; i < b.length; i++) {
    if (isNaN(str[i]) || str[i] === 0) { dx.push(NaN); adx.push(NaN); continue; }
    const pdi = 100 * sp[i] / str[i], ndi = 100 * sn[i] / str[i];
    dx.push((pdi + ndi) === 0 ? 0 : 100 * Math.abs(pdi - ndi) / (pdi + ndi));
    if (i < 2 * n) { const sl = dx.slice(i - n + 1, i + 1).filter(v => !isNaN(v)); adx.push(sl.length === n ? sl.reduce((a, v) => a + v, 0) / n : NaN); }
    else adx.push((adx[i - 1] * (n - 1) + dx[i]) / n);
  }
  return adx;
}
function supertrendSeries(b, factor, n) {
  const a = atrSeries(b, n), fU = [], fL = [], line = [];
  for (let i = 0; i < b.length; i++) {
    const hl2 = (b[i].h + b[i].l) / 2, bU = hl2 + factor * a[i], bL = hl2 - factor * a[i];
    if (i === 0) { fU.push(bU); fL.push(bL); line.push(bU); continue; }
    const pc = b[i - 1].c;
    fU.push((bU < fU[i - 1] || pc > fU[i - 1]) ? bU : fU[i - 1]);
    fL.push((bL > fL[i - 1] || pc < fL[i - 1]) ? bL : fL[i - 1]);
    line.push(line[i - 1] === fU[i - 1] ? (b[i].c <= fU[i] ? fU[i] : fL[i]) : (b[i].c >= fL[i] ? fL[i] : fU[i]));
  }
  return line;
}
function macdHistSeries(src, f = 12, s = 26, sig = 9) {
  const fe = emaSeries(src, f), se = emaSeries(src, s);
  const macd = fe.map((v, i) => v - se[i]);
  const sigl = emaSeries(macd, sig);
  return macd.map((v, i) => v - sigl[i]);
}

const closes = bars.map(b => b.c);
const e9 = emaSeries(closes, 9), e21 = emaSeries(closes, 21), e50 = emaSeries(closes, 50);
const rsi = rsiSeries(closes, 14);
const atr = atrSeries(bars, 14);
const vwap = vwapSeries(bars);
const adx = adxSeries(bars, 14);              // SHIELD: trend strength
const stLine = supertrendSeries(bars, 3.0, 10); // SHIELD: Supertrend side
const macdH = macdHistSeries(closes, 12, 26, 9); // SHIELD: MACD not-against

// ── strategy params (mirror multiconfirm.js DEFAULTS where applicable) ───────
const RSI_BULL_MIN = 45, RSI_BEAR_MAX = 55, RSI_OB = 70, RSI_OS = 30;
const MIN_BODY_PCT = 40;
const SL_ATR = 1.5, TP_ATR = 3.0;     // 2R target
const ADX_MIN = 20;                    // SHIELD threshold
const WARM = 55;                       // bars to warm up the slow EMA
const MAX_TRADES = 1200;
const LAST_ENTRY_MIN = 15 * 60 + 0;    // no new entries after 15:00 IST (square off 15:25)
const SQUAREOFF_MIN = 15 * 60 + 25;

function mins(t) { const hm = t.slice(11, 16).split(':'); return +hm[0] * 60 + +hm[1]; }

function signalAt(i) {
  const price = closes[i];
  const bullStack = e9[i] > e21[i] && e21[i] > e50[i] && price > e50[i];
  const bearStack = e9[i] < e21[i] && e21[i] < e50[i] && price < e50[i];
  const bullMom = bullStack && e9[i] > e9[i - 2] && e21[i] > e21[i - 2];
  const bearMom = bearStack && e9[i] < e9[i - 2] && e21[i] < e21[i - 2];
  const vBull = price > vwap[i], vBear = price < vwap[i];
  const rBull = rsi[i] > RSI_BULL_MIN && rsi[i] < RSI_OB;
  const rBear = rsi[i] < RSI_BEAR_MAX && rsi[i] > RSI_OS;
  const rng = bars[i].h - bars[i].l, body = Math.abs(bars[i].c - bars[i].o);
  const bodyPct = rng > 0 ? body / rng * 100 : 0;
  const bullCandle = bars[i].c > bars[i].o && bodyPct >= MIN_BODY_PCT;
  const bearCandle = bars[i].c < bars[i].o && bodyPct >= MIN_BODY_PCT;
  // CORE alignment (volume layer omitted — index has none)
  const coreBuy = bullMom && vBull && rBull && bullCandle;
  const coreSell = bearMom && vBear && rBear && bearCandle;
  // SHIELDS — ADX strength, Supertrend side, MACD not-against (NaN ADX → fails)
  const adxOk = adx[i] >= ADX_MIN;
  const stBull = price > stLine[i], stBear = price < stLine[i];
  const hist = macdH[i], histPrev = macdH[i - 1];
  const macdCallOk = hist >= 0 || hist > histPrev;
  const macdPutOk = hist <= 0 || hist < histPrev;
  if (coreBuy && adxOk && stBull && macdCallOk) return 'CALL';
  if (coreSell && adxOk && stBear && macdPutOk) return 'PUT';
  return null;
}

// ── run ──────────────────────────────────────────────────────────────────────
const trades = [];
let pos = null;  // { side, entry, sl, tp, entryIdx, entryTime }

for (let i = WARM; i < bars.length && trades.length < MAX_TRADES; i++) {
  const b = bars[i], m = mins(b.t);
  const newDay = i > 0 && b.date !== bars[i - 1].date;

  // manage open position first
  if (pos) {
    let exit = null, reason = null;
    if (pos.side === 'CALL') {
      if (b.l <= pos.sl) { exit = pos.sl; reason = 'SL'; }
      else if (b.h >= pos.tp) { exit = pos.tp; reason = 'TP'; }
    } else {
      if (b.h >= pos.sl) { exit = pos.sl; reason = 'SL'; }
      else if (b.l <= pos.tp) { exit = pos.tp; reason = 'TP'; }
    }
    const sig = signalAt(i);
    if (!exit && sig && sig !== pos.side) { exit = b.c; reason = 'FLIP'; }
    if (!exit && (m >= SQUAREOFF_MIN || newDay)) { exit = b.c; reason = 'EOD'; }
    if (exit != null) {
      const pts = pos.side === 'CALL' ? (exit - pos.entry) : (pos.entry - exit);
      trades.push({ ...pos, exit, reason, pts: +pts.toFixed(2), exitTime: b.t });
      pos = null;
    }
  }

  // look for a new entry (flat, within trading window)
  if (!pos && trades.length < MAX_TRADES && m < LAST_ENTRY_MIN) {
    const sig = signalAt(i);
    if (sig) {
      const a = atr[i];
      pos = sig === 'CALL'
        ? { side: 'CALL', entry: b.c, sl: b.c - SL_ATR * a, tp: b.c + TP_ATR * a, entryIdx: i, entryTime: b.t, atr: +a.toFixed(2) }
        : { side: 'PUT',  entry: b.c, sl: b.c + SL_ATR * a, tp: b.c - TP_ATR * a, entryIdx: i, entryTime: b.t, atr: +a.toFixed(2) };
    }
  }
}

// ── stats ─────────────────────────────────────────────────────────────────────
const wins = trades.filter(t => t.pts > 0);
const losses = trades.filter(t => t.pts <= 0);
const net = trades.reduce((s, t) => s + t.pts, 0);
const grossW = wins.reduce((s, t) => s + t.pts, 0);
const grossL = Math.abs(losses.reduce((s, t) => s + t.pts, 0));
const pf = grossL ? grossW / grossL : Infinity;
let peak = 0, cum = 0, maxDD = 0, curStreak = 0, maxLossStreak = 0;
for (const t of trades) {
  cum += t.pts; peak = Math.max(peak, cum); maxDD = Math.max(maxDD, peak - cum);
  if (t.pts <= 0) { curStreak++; maxLossStreak = Math.max(maxLossStreak, curStreak); } else curStreak = 0;
}
const byReason = {};
for (const t of trades) byReason[t.reason] = (byReason[t.reason] || 0) + 1;

const fmt = n => (n >= 0 ? '+' : '') + n.toFixed(1);
console.log('================================================================');
console.log(`  ${LABEL} DIRECTIONAL — PAPER backtest (REAL 1-min index)`);
console.log('================================================================');
console.log(`  Data       : ${bars.length} bars · ${bars[0].date} → ${bars[bars.length - 1].date}`);
console.log(`  Strategy   : EMA9/21/50 stack+slope · VWAP side · RSI zone · strong candle`);
console.log(`               ATR stop ${SL_ATR}x / target ${TP_ATR}x (2R) · intraday square-off 15:25`);
console.log(`               (volume layer omitted — index carries no volume)`);
console.log('  ----------------------------------------------------------------');
console.log(`  Trades     : ${trades.length}`);
console.log(`  Win rate   : ${trades.length ? (100 * wins.length / trades.length).toFixed(1) : 0}%  (${wins.length}W / ${losses.length}L)`);
console.log(`  Net (index): ${fmt(net)} pts`);
console.log(`  Avg win    : ${wins.length ? fmt(grossW / wins.length) : 0} pts   Avg loss: ${losses.length ? fmt(-grossL / losses.length) : 0} pts`);
console.log(`  Profit factor: ${pf === Infinity ? '∞' : pf.toFixed(2)}   Max loss streak: ${maxLossStreak}   Max DD: ${maxDD.toFixed(1)} pts`);
console.log(`  Exits      : ${Object.entries(byReason).map(([k, v]) => `${k}:${v}`).join('  ')}`);
console.log('  ----------------------------------------------------------------');
// Illustrative ONLY — rough ATM option premium proxy (delta ~0.5, no theta).
const lot = 75, optPtPerIdx = 0.5;
const estOptNet = net * optPtPerIdx;
console.log(`  ~Option est: a directional ATM buy at delta~0.5 (NO theta/IV modelled,`);
console.log(`               illustrative only) ≈ ${fmt(estOptNet)} premium pts → ₹${Math.round(estOptNet * lot).toLocaleString('en-IN')}/lot over ${trades.length} trades.`);
console.log('================================================================');

fs.writeFileSync(`bt-data/result-intraday-${LABEL.toLowerCase()}.json`, JSON.stringify({
  data: { bars: bars.length, from: bars[0].date, to: bars[bars.length - 1].date },
  params: { SL_ATR, TP_ATR, RSI_BULL_MIN, RSI_BEAR_MAX, MIN_BODY_PCT, MAX_TRADES },
  summary: {
    trades: trades.length, wins: wins.length, losses: losses.length,
    winPct: trades.length ? +(100 * wins.length / trades.length).toFixed(1) : 0,
    netPts: +net.toFixed(1), avgWin: wins.length ? +(grossW / wins.length).toFixed(1) : 0,
    avgLoss: losses.length ? +(-grossL / losses.length).toFixed(1) : 0,
    profitFactor: pf === Infinity ? null : +pf.toFixed(2),
    maxLossStreak, maxDDpts: +maxDD.toFixed(1), exits: byReason,
  },
  trades,
}, null, 1));
console.log(`Saved: bt-data/result-intraday-${LABEL.toLowerCase()}.json`);
