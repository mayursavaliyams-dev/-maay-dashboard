/**
 * CANDLESTICK PATTERN SIGNALS — Antigravity Pro
 *
 * Angel-One-style "Trading Signals": detect classic candlestick patterns on real
 * OHLC bars (aggregated from Upstox 1-min candles), then fuse the pattern with
 * OI bias + momentum + trend into a single BULLISH / BEARISH / NEUTRAL verdict,
 * and translate that into concrete strike recommendations (a BUY leg and a SELL
 * leg) the user can act on.
 *
 * This module is PURE (no I/O). server.js fetches the 1-min candles + option-chain
 * analytics and feeds them in; the module returns a ready-to-render signal object.
 *
 *   analyzeTimeframe({ oneMin, minutesPerBar, analytics, lot, step })  →  signal
 *
 * Pattern detection runs on the aggregated TF bars; momentum/trend run on the
 * 1-minute close series (always plenty of data, unlike a half-formed 1-hr bar).
 */

'use strict';

const IST_OFFSET_MIN = 330;
const SESSION_OPEN_MIN = 9 * 60 + 15;   // 09:15 IST
const SESSION_CLOSE_MIN = 15 * 60 + 30; // 15:30 IST

// ── small indicator helpers (local, so the module stays dependency-free) ─────
function ema(series, period) {
  if (!series || !series.length) return null;
  const k = 2 / (period + 1);
  let e = series[0];
  for (let i = 1; i < series.length; i++) e = series[i] * k + e * (1 - k);
  return e;
}
function rsi(series, period = 14) {
  if (!series || series.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = series.length - period; i < series.length; i++) {
    const d = series[i] - series[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  if (loss === 0) return 100;
  const rs = (gain / period) / (loss / period);
  return 100 - 100 / (1 + rs);
}
function emaSeries(series, period) {
  const out = []; const k = 2 / (period + 1); let e = series[0]; out.push(e);
  for (let i = 1; i < series.length; i++) { e = series[i] * k + e * (1 - k); out.push(e); }
  return out;
}
function macdHist(series, fast = 12, slow = 26, sig = 9) {
  if (!series || series.length < slow + sig) return null;
  const f = emaSeries(series, fast), s = emaSeries(series, slow);
  const macd = f.map((v, i) => v - s[i]).slice(slow - 1);
  const sigSer = emaSeries(macd, sig);
  const m = macd[macd.length - 1], g = sigSer[sigSer.length - 1];
  return +(m - g).toFixed(2);
}

// ── 1-min → N-min bar aggregation, anchored to the 09:15 session open ─────────
// oneMin: { timestamp[] (epoch sec, oldest→newest), open[], high[], low[], close[], volume[] }
// Returns bars [{ t, o, h, l, c, v, n }] oldest→newest (n = #1-min candles in the bar).
function aggregate(oneMin, minutesPerBar) {
  const ts = oneMin?.timestamp || [];
  if (!ts.length) return [];
  const bucketsByKey = new Map();
  const order = [];
  for (let i = 0; i < ts.length; i++) {
    const ms = ts[i] * 1000;
    const istMin = Math.floor((ms / 60000 + IST_OFFSET_MIN) % 1440);
    if (istMin < SESSION_OPEN_MIN || istMin >= SESSION_CLOSE_MIN) continue; // session only
    const day = Math.floor((ms / 60000 + IST_OFFSET_MIN) / 1440);
    const slot = Math.floor((istMin - SESSION_OPEN_MIN) / minutesPerBar);
    const key = `${day}:${slot}`;
    const o = +oneMin.open[i], h = +oneMin.high[i], l = +oneMin.low[i], c = +oneMin.close[i], v = +(oneMin.volume[i] || 0);
    if (!(o > 0 && h > 0 && l > 0 && c > 0)) continue;
    let b = bucketsByKey.get(key);
    if (!b) { b = { t: ts[i], o, h, l, c, v, n: 1 }; bucketsByKey.set(key, b); order.push(key); }
    else { b.h = Math.max(b.h, h); b.l = Math.min(b.l, l); b.c = c; b.v += v; b.n++; }
  }
  return order.map(k => bucketsByKey.get(k));
}

// ── candle feature extraction ────────────────────────────────────────────────
function feat(bar) {
  const range = bar.h - bar.l;
  const body = Math.abs(bar.c - bar.o);
  const upper = bar.h - Math.max(bar.o, bar.c);
  const lower = Math.min(bar.o, bar.c) - bar.l;
  return {
    range, body, upper, lower,
    bull: bar.c > bar.o, bear: bar.c < bar.o,
    bodyPct: range > 0 ? body / range : 0,
    upperPct: range > 0 ? upper / range : 0,
    lowerPct: range > 0 ? lower / range : 0,
    mid: (bar.o + bar.c) / 2,
  };
}
// short-term trend just before index idx (slope of closes over `look` bars)
function trendBefore(bars, idx, look = 5) {
  const start = Math.max(0, idx - look);
  if (idx - start < 2) return 'FLAT';
  const a = bars[start].c, b = bars[idx - 1].c;
  const chg = a > 0 ? (b - a) / a : 0;
  if (chg > 0.0015) return 'UP';
  if (chg < -0.0015) return 'DOWN';
  return 'FLAT';
}

/**
 * Detect the most significant candlestick pattern at the last bar.
 * Returns { name, sentiment, strength(0-100), reliability, bar:{o,h,l,c}, forming }.
 */
function detectPattern(bars, minutesPerBar) {
  if (!bars || bars.length < 1) return null;
  const complete = Math.max(2, minutesPerBar * 0.6);
  // Read the pattern off the last CLOSED bar — a half-formed bar (e.g. the 15-min
  // stub of a 1-hr candle at EOD) isn't a real candle. Matches how brokers show it.
  let i = bars.length - 1;
  while (i > 0 && bars[i].n < complete) i--;
  const forming = bars[i].n < complete; // only at the very start of a session
  const b0 = bars[i], f0 = feat(b0);
  const b1 = i >= 1 ? bars[i - 1] : null, f1 = b1 ? feat(b1) : null;
  const b2 = i >= 2 ? bars[i - 2] : null, f2 = b2 ? feat(b2) : null;
  const tr = trendBefore(bars, i, 5);
  const barOut = { o: +b0.o.toFixed(2), h: +b0.h.toFixed(2), l: +b0.l.toFixed(2), c: +b0.c.toFixed(2) };
  const R = (name, sentiment, strength, reliability) =>
    ({ name, sentiment, strength: Math.round(strength), reliability, bar: barOut, forming, idx: i });

  // ── 3-bar patterns ──────────────────────────────────────────────────────
  if (b2 && b1) {
    // Three White Soldiers / Three Black Crows
    if (f2.bull && f1.bull && f0.bull && f2.bodyPct > 0.5 && f1.bodyPct > 0.5 && f0.bodyPct > 0.5
        && b1.c > b2.c && b0.c > b1.c)
      return R('Three White Soldiers', 'Bullish', 88, 'High');
    if (f2.bear && f1.bear && f0.bear && f2.bodyPct > 0.5 && f1.bodyPct > 0.5 && f0.bodyPct > 0.5
        && b1.c < b2.c && b0.c < b1.c)
      return R('Three Black Crows', 'Bearish', 88, 'High');
    // Morning Star — big down, small body (star), big up closing into 1st body
    if (f2.bear && f2.bodyPct > 0.5 && f1.bodyPct < 0.35 && f0.bull && f0.bodyPct > 0.5
        && b0.c > (b2.o + b2.c) / 2)
      return R('Morning Star', 'Bullish', 85, 'High');
    // Evening Star — mirror
    if (f2.bull && f2.bodyPct > 0.5 && f1.bodyPct < 0.35 && f0.bear && f0.bodyPct > 0.5
        && b0.c < (b2.o + b2.c) / 2)
      return R('Evening Star', 'Bearish', 85, 'High');
  }

  // ── 2-bar patterns ──────────────────────────────────────────────────────
  if (b1) {
    // Bullish / Bearish Engulfing
    if (f1.bear && f0.bull && b0.c >= b1.o && b0.o <= b1.c && f0.body > f1.body * 1.0)
      return R('Bullish Engulfing', 'Bullish', 80, 'High');
    if (f1.bull && f0.bear && b0.o >= b1.c && b0.c <= b1.o && f0.body > f1.body * 1.0)
      return R('Bearish Engulfing', 'Bearish', 80, 'High');
    // Piercing Line / Dark Cloud Cover
    if (f1.bear && f0.bull && b0.o < b1.l && b0.c > (b1.o + b1.c) / 2 && b0.c < b1.o)
      return R('Piercing Line', 'Bullish', 72, 'Medium');
    if (f1.bull && f0.bear && b0.o > b1.h && b0.c < (b1.o + b1.c) / 2 && b0.c > b1.o)
      return R('Dark Cloud Cover', 'Bearish', 72, 'Medium');
    // Harami (inside bar after a strong opposite bar)
    if (f1.bear && f1.bodyPct > 0.5 && f0.bull && Math.max(b0.o, b0.c) < b1.o && Math.min(b0.o, b0.c) > b1.c && f0.body < f1.body * 0.6)
      return R('Bullish Harami', 'Bullish', 68, 'Medium');
    if (f1.bull && f1.bodyPct > 0.5 && f0.bear && Math.max(b0.o, b0.c) < b1.c && Math.min(b0.o, b0.c) > b1.o && f0.body < f1.body * 0.6)
      return R('Bearish Harami', 'Bearish', 68, 'Medium');
    // Tweezer top/bottom
    if (f1.bear && f0.bull && Math.abs(b0.l - b1.l) / (b1.l || 1) < 0.0008 && tr === 'DOWN')
      return R('Tweezer Bottom', 'Bullish', 60, 'Medium');
    if (f1.bull && f0.bear && Math.abs(b0.h - b1.h) / (b1.h || 1) < 0.0008 && tr === 'UP')
      return R('Tweezer Top', 'Bearish', 60, 'Medium');
  }

  // ── 1-bar patterns ──────────────────────────────────────────────────────
  // Marubozu — full body, tiny wicks
  if (f0.bodyPct >= 0.9) return R(f0.bull ? 'Bullish Marubozu' : 'Bearish Marubozu', f0.bull ? 'Bullish' : 'Bearish', 70, 'Medium');
  // Hammer family — long lower wick, small body near the top
  if (f0.lower >= f0.body * 2 && f0.upperPct <= 0.15 && f0.bodyPct < 0.4) {
    return tr === 'UP' ? R('Hanging Man', 'Bearish', 62, 'Medium')
                       : R('Hammer', 'Bullish', 66, 'Medium');
  }
  // Inverted hammer / shooting star — long upper wick, small body near the bottom
  if (f0.upper >= f0.body * 2 && f0.lowerPct <= 0.15 && f0.bodyPct < 0.4) {
    return tr === 'UP' ? R('Shooting Star', 'Bearish', 66, 'Medium')
                       : R('Inverted Hammer', 'Bullish', 60, 'Medium');
  }
  // Doji / Spinning Top — indecision
  if (f0.bodyPct < 0.1) return R('Doji', 'Neutral', 40, 'Low');
  if (f0.bodyPct < 0.3) return R('Spinning Top', 'Neutral', 35, 'Low');

  // No textbook pattern — report the raw bar direction as a weak read
  return R(f0.bull ? 'Bullish Candle' : f0.bear ? 'Bearish Candle' : 'Flat', f0.bull ? 'Bullish' : f0.bear ? 'Bearish' : 'Neutral', 25, 'Low');
}

// ── momentum from the 1-min close series (RSI + MACD + EMA stack) ────────────
function computeMomentum(closes) {
  if (!closes || closes.length < 20) return { dir: 0, conf: 0, rsi: null, macdHist: null, ema9: null, ema21: null, label: 'warming up' };
  const r = rsi(closes, 14);
  const mh = macdHist(closes);
  const e9 = ema(closes, 9), e21 = ema(closes, 21);
  let votes = 0, n = 0;
  if (r != null) { votes += r > 55 ? 1 : r < 45 ? -1 : 0; n++; }
  if (mh != null) { votes += mh > 0 ? 1 : mh < 0 ? -1 : 0; n++; }
  if (e9 != null && e21 != null) { votes += e9 > e21 ? 1 : e9 < e21 ? -1 : 0; n++; }
  const dir = votes > 0 ? 1 : votes < 0 ? -1 : 0;
  const conf = n ? Math.abs(votes) / n : 0;
  const label = dir > 0 ? 'momentum up' : dir < 0 ? 'momentum down' : 'mixed';
  return { dir, conf, rsi: r != null ? +r.toFixed(1) : null, macdHist: mh, ema9: e9 != null ? +e9.toFixed(1) : null, ema21: e21 != null ? +e21.toFixed(1) : null, label };
}

// VWAP for the day from 1-min candles (typical price × volume).
function vwap(oneMin) {
  const c = oneMin?.close || [];
  if (!c.length) return null;
  let pv = 0, vol = 0;
  for (let i = 0; i < c.length; i++) {
    const tp = (+oneMin.high[i] + +oneMin.low[i] + +oneMin.close[i]) / 3;
    const v = +(oneMin.volume[i] || 0);
    if (v > 0) { pv += tp * v; vol += v; }
  }
  return vol > 0 ? pv / vol : null;
}

// ── OI bias from option-chain analytics ──────────────────────────────────────
// analytics: { spot, atm, rows:[{strike, ce:{oi,changeOI,ltp}, pe:{...}}], pcr, pcrBias, maxPain }
function oiBias(a) {
  if (!a) return { dir: 0, conf: 0, pcr: null, maxPain: null, label: 'no OI' };
  let votes = 0, n = 0;
  // PCR
  if (a.pcrBias === 'BULLISH') { votes += 1; n++; }
  else if (a.pcrBias === 'BEARISH') { votes += -1; n++; }
  else if (a.pcr != null) { n++; }
  // Max-pain pull: price tends to gravitate toward max-pain by expiry
  if (a.maxPain && a.spot) {
    const diff = (a.maxPain - a.spot) / a.spot;
    if (diff > 0.001) { votes += 1; n++; }        // spot below max-pain → upward pull
    else if (diff < -0.001) { votes += -1; n++; } // spot above max-pain → downward pull
  }
  // ATM change-in-OI: heavy PE writing = bullish floor, heavy CE writing = bearish cap
  const atmRow = (a.rows || []).find(r => Number(r.strike) === Number(a.atm));
  if (atmRow) {
    const dCe = Number(atmRow.ce?.changeOI || 0), dPe = Number(atmRow.pe?.changeOI || 0);
    if (dCe || dPe) {
      if (dPe > dCe * 1.15) { votes += 1; n++; }
      else if (dCe > dPe * 1.15) { votes += -1; n++; }
    }
  }
  const dir = votes > 0 ? 1 : votes < 0 ? -1 : 0;
  const conf = n ? Math.min(1, Math.abs(votes) / n) : 0;
  const label = dir > 0 ? 'OI bullish' : dir < 0 ? 'OI bearish' : 'OI neutral';
  return { dir, conf, pcr: a.pcr ?? null, pcrBias: a.pcrBias || 'SIDEWAYS', maxPain: a.maxPain ?? null, label };
}

// trend/price factor: spot vs VWAP and vs EMA50(1-min)
function trendBias(spot, vwapVal, ema50) {
  let votes = 0, n = 0;
  if (vwapVal) { votes += spot > vwapVal ? 1 : spot < vwapVal ? -1 : 0; n++; }
  if (ema50) { votes += spot > ema50 ? 1 : spot < ema50 ? -1 : 0; n++; }
  const dir = votes > 0 ? 1 : votes < 0 ? -1 : 0;
  const conf = n ? Math.abs(votes) / n : 0;
  return { dir, conf, vwap: vwapVal ? +vwapVal.toFixed(1) : null, label: dir > 0 ? 'above VWAP' : dir < 0 ? 'below VWAP' : 'at VWAP' };
}

// ── confluence: weighted blend of pattern + momentum + OI + trend ────────────
// tfRel = how much to trust the pattern on this timeframe. Grounded in the 15-day
// backtest: 1hr patterns hit ~65%, 15m ~55%, 5m noisier — so a higher-TF pattern
// drives the verdict more, while a low-TF read leans on OI/momentum/trend instead.
function buildConfluence(pattern, momentum, oi, trend, opts = {}) {
  const tfRel = opts.tfRel != null ? opts.tfRel : 1;
  const patDir = pattern.sentiment === 'Bullish' ? 1 : pattern.sentiment === 'Bearish' ? -1 : 0;
  const patW = 0.35 * (pattern.strength / 100) * tfRel;
  const factors = [
    { key: 'pattern', label: pattern.name, dir: patDir, w: patW },
    { key: 'momentum', label: momentum.label, dir: momentum.dir, w: 0.30 * momentum.conf },
    { key: 'oi', label: oi.label, dir: oi.dir, w: 0.20 * oi.conf },
    { key: 'trend', label: trend.label, dir: trend.dir, w: 0.15 * trend.conf },
  ];
  const wsum = factors.reduce((s, f) => s + f.w, 0) || 1;
  const score = factors.reduce((s, f) => s + f.dir * f.w, 0) / wsum; // [-1,1]
  const biasPct = Math.round(score * 100);
  const bias = biasPct >= 15 ? 'BULLISH' : biasPct <= -15 ? 'BEARISH' : 'NEUTRAL';
  const confidence = Math.max(45, Math.min(95, Math.round(50 + Math.abs(score) * 50)));
  // agreement = which factors point the same way as the verdict
  const agree = factors.filter(f => f.dir !== 0 && Math.sign(f.dir) === Math.sign(score) && f.w > 0).map(f => f.key);
  // conviction tier: reward higher-TF reliability + multi-factor agreement + confidence.
  // This is the "only act when the layers align" rule made explicit.
  let conviction = 'LOW';
  if (bias !== 'NEUTRAL') {
    if (tfRel >= 1 && confidence >= 62 && agree.length >= 3) conviction = 'HIGH';
    else if (confidence >= 58 && agree.length >= 2) conviction = 'MEDIUM';
  }
  return { bias, biasPct, confidence, score: +score.toFixed(3), factors, agree, agreeN: agree.length, conviction, tfRel };
}

// ── strike recommendation: a BUY leg and a SELL leg, derived from the verdict ─
function pickRow(rows, strike) { return (rows || []).find(r => Number(r.strike) === Number(strike)); }
function recommendStrikes(bias, a, lot) {
  const rows = a.rows || [], atm = a.atm, step = a.step;
  const leg = (strike, type) => {
    const row = pickRow(rows, strike);
    const ltp = row ? Number((type === 'CE' ? row.ce?.ltp : row.pe?.ltp) || 0) : 0;
    return { strike, type, ltp: +ltp.toFixed(2), lot, value: +(ltp * lot).toFixed(0) };
  };
  if (bias === 'BULLISH') {
    return {
      buy: { ...leg(atm, 'CE'), action: 'BUY', note: 'directional long (theta-risk)' },
      sell: { ...leg(atm - step, 'PE'), action: 'SELL', note: 'put credit — bullish, defined floor' },
      idea: 'Bias up → buy ATM CE for momentum, or sell OTM PE to collect premium with an upward bias.',
    };
  }
  if (bias === 'BEARISH') {
    return {
      buy: { ...leg(atm, 'PE'), action: 'BUY', note: 'directional short (theta-risk)' },
      sell: { ...leg(atm + step, 'CE'), action: 'SELL', note: 'call credit — bearish, defined cap' },
      idea: 'Bias down → buy ATM PE for momentum, or sell OTM CE to collect premium with a downward bias.',
    };
  }
  // Neutral → range; selling premium both sides is the edge, no clean directional buy
  return {
    buy: null,
    sell: { ...leg(atm + step, 'CE'), action: 'SELL', pair: { ...leg(atm - step, 'PE'), action: 'SELL' }, note: 'short strangle — range / sell premium both sides' },
    idea: 'No directional edge → sell an OTM strangle (CE above + PE below) to harvest premium, or stay flat.',
  };
}

/**
 * Top-level: analyze one instrument on one timeframe.
 *   oneMin       : 1-min candle arrays for the day (from Upstox intraday shim)
 *   minutesPerBar: 5 | 15 | 60
 *   analytics    : { spot, atm, step, rows, pcr, pcrBias, maxPain } (option chain)
 *   lot          : lot size for value/credit math
 * Returns the full signal object, or null if there isn't enough data.
 */
function analyzeTimeframe({ oneMin, minutesPerBar, analytics, lot }) {
  const bars = aggregate(oneMin, minutesPerBar);
  if (!bars.length) return null;
  const closes1m = (oneMin.close || []).map(Number).filter(n => n > 0);
  const spot = analytics?.spot || closes1m[closes1m.length - 1] || bars[bars.length - 1].c;

  const pattern = detectPattern(bars, minutesPerBar);
  const momentum = computeMomentum(closes1m);
  const oi = oiBias(analytics);
  const vwapVal = vwap(oneMin);
  const ema50 = closes1m.length >= 50 ? ema(closes1m, 50) : null;
  const trend = trendBias(spot, vwapVal, ema50);

  // TF reliability (backtest-grounded): 1hr patterns are far more predictive than 15m/5m.
  const tfRel = minutesPerBar >= 60 ? 1.0 : minutesPerBar >= 15 ? 0.7 : 0.5;
  const conf = buildConfluence(pattern, momentum, oi, trend, { tfRel });
  const reco = analytics ? recommendStrikes(conf.bias, analytics, lot) : null;

  // day change from the session open
  const dayOpen = bars[0]?.o || spot;
  const changeAbs = +(spot - dayOpen).toFixed(2);
  const changePct = dayOpen > 0 ? +(((spot - dayOpen) / dayOpen) * 100).toFixed(2) : 0;

  return {
    minutesPerBar,
    bars: bars.length,
    barTime: bars[pattern.idx != null ? pattern.idx : bars.length - 1].t,  // epoch sec of the signal (closed) bar
    spot: +spot.toFixed(2),
    changeAbs, changePct,
    pattern,
    momentum,
    oi,
    trend,
    confluence: conf,
    reco,
  };
}

// ── ORB (Opening Range Breakout) + RETEST ────────────────────────────────────
// The opening range = high/low of the first `orbMin` minutes (09:15→09:15+orbMin).
// Breakout = first 1-min CLOSE beyond that range. Retest = price pulls back to the
// broken level and CLOSES holding it in the breakout direction (the high-quality
// entry — fewer false breakouts than entering on the naked break). Returns the
// levels, breakout, retest, the mapped CALL/PUT signal, and the spot-points outcome
// to session end (so it can be replayed/backtested day by day).
function orbSignal(oneMin, { orbMin = 3, atm = 0 } = {}) {
  const bars = aggregate(oneMin, 1);                 // session-filtered 1-min bars
  if (bars.length < 6) return { ready: false, reason: 'not enough candles' };
  const istMin = t => Math.floor((t / 60 + IST_OFFSET_MIN) % 1440);   // t = epoch sec
  const orbEnd = SESSION_OPEN_MIN + orbMin;
  const orbBars = bars.filter(b => { const m = istMin(b.t); return m >= SESSION_OPEN_MIN && m < orbEnd; });
  const post    = bars.filter(b => istMin(b.t) >= orbEnd);
  if (orbBars.length < 2) return { ready: false, reason: 'ORB window not formed' };

  const orbHigh = Math.max(...orbBars.map(b => b.h));
  const orbLow  = Math.min(...orbBars.map(b => b.l));
  const range   = orbHigh - orbLow;
  const buffer  = Math.max(range * 0.12, orbHigh * 0.0004);
  const orb = { high: +orbHigh.toFixed(2), low: +orbLow.toFixed(2), from: orbBars[0].t, to: orbBars[orbBars.length - 1].t, minutes: orbMin, range: +range.toFixed(2) };

  if (!post.length) return { ready: true, orb, breakout: null, retest: null, signal: 'WAIT', note: 'ORB set — session ongoing in range' };

  // breakout = first close beyond the range
  let bi = -1, dir = 0;
  for (let i = 0; i < post.length; i++) {
    if (post[i].c > orbHigh) { dir = 1; bi = i; break; }
    if (post[i].c < orbLow)  { dir = -1; bi = i; break; }
  }
  if (bi < 0) return { ready: true, orb, breakout: null, retest: null, signal: 'WAIT', note: 'no ORB breakout — still ranging' };

  const bk = post[bi];
  const level = dir > 0 ? orbHigh : orbLow;
  const optType = dir > 0 ? 'CALL' : 'PUT';

  // retest = pullback to the broken level, then a close that holds the breakout side
  let retest = null, invalid = false;
  for (let i = bi + 1; i < post.length; i++) {
    const b = post[i];
    if (dir > 0) {
      if (b.c < orbLow) { invalid = true; break; }                       // full failure
      if (b.l <= level + buffer && b.c >= level) { retest = { i, bar: b }; break; }
    } else {
      if (b.c > orbHigh) { invalid = true; break; }
      if (b.h >= level - buffer && b.c <= level) { retest = { i, bar: b }; break; }
    }
  }

  // outcome (spot points) from the entry to session end — entry = retest close if it
  // held, else the breakout close. MFE/MAE = best/worst excursion after entry.
  const entryIdx = retest ? retest.i : bi;
  const entry = post[entryIdx].c;
  const after = post.slice(entryIdx + 1);
  const last  = after.length ? after[after.length - 1].c : entry;
  const hi = Math.max(entry, ...after.map(b => b.h));
  const lo = Math.min(entry, ...after.map(b => b.l));
  const points = +(dir > 0 ? last - entry : entry - last).toFixed(2);
  const mfe = +(dir > 0 ? hi - entry : entry - lo).toFixed(2);
  const mae = +(dir > 0 ? entry - lo : hi - entry).toFixed(2);
  // MANAGED exit — the classic ORB risk plan: SL = opposite side of the range,
  // TP = 1.5× range. (Raw `points` above is the naive hold-to-close.)
  const risk = Math.max(range, orbHigh * 0.0005);
  const sl = dir > 0 ? entry - risk : entry + risk;
  const tp = dir > 0 ? entry + 1.5 * risk : entry - 1.5 * risk;
  let mExit = null, mReason = 'EOD';
  for (const b of after) {
    if (dir > 0) { if (b.l <= sl) { mExit = sl; mReason = 'SL'; break; } if (b.h >= tp) { mExit = tp; mReason = 'TP'; break; } }
    else         { if (b.h >= sl) { mExit = sl; mReason = 'SL'; break; } if (b.l <= tp) { mExit = tp; mReason = 'TP'; break; } }
  }
  const mPx = mExit != null ? mExit : last;
  const mPoints = +(dir > 0 ? mPx - entry : entry - mPx).toFixed(2);

  return {
    ready: true, orb,
    breakout: { dir, type: optType, at: bk.t, price: +bk.c.toFixed(2), level: +level.toFixed(2) },
    retest: retest ? { at: retest.bar.t, price: +retest.bar.c.toFixed(2), held: true }
                   : (invalid ? { invalidated: true } : null),
    signal: dir > 0 ? 'BULLISH' : 'BEARISH',
    optType, strike: atm,
    entry: +entry.toFixed(2), last: +last.toFixed(2),
    sl: +sl.toFixed(2), tp: +tp.toFixed(2),
    outcome: { points, mfe, mae, win: points > 0, managed: { points: mPoints, exitReason: mReason, win: mPoints > 0 } },
    note: retest ? `Breakout + retest held → ${optType} entry`
        : invalid ? 'Breakout failed (price re-entered the range)'
        : `Breakout (${optType}) — awaiting retest`,
  };
}

module.exports = {
  aggregate, detectPattern, computeMomentum, vwap, oiBias, trendBias,
  buildConfluence, recommendStrikes, analyzeTimeframe, orbSignal,
  SESSION_OPEN_MIN, SESSION_CLOSE_MIN,
};
