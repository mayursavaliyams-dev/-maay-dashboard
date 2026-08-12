/* ═══════════════════════════════════════════════════════════════════════════
   stock-technicals — the indicator block a broker shows on a stock, computed
   here from daily bars rather than taken on trust from anyone's screen.

   WHY THIS IS A SEPARATE FILE

   It is pure arithmetic over an array of bars: no network, no clock, no state.
   That makes every number in it checkable against a hand-worked example, which
   is the only reason to believe an indicator at all. The vendor call that
   fetches the bars lives in stock-analyst.js; nothing here knows it exists.

   THE RULE THAT SHAPES EVERY FUNCTION BELOW

   An indicator with too little history is **null**, never a number computed
   from what happened to be available. RSI(14) on 6 bars is not "roughly RSI" —
   it is a different statistic wearing RSI's name, and it will be read as the
   real one. A newly listed stock, or one whose history the vendor truncates,
   must show a blank where the 200-day average would be. That blank is the
   honest answer and it is what the card renders.

   This matters here more than usual: TMPV is a 2026 demerger. It does not have
   200 days of its own history, and a 200-DMA fabricated from 60 bars would
   read as a long-term trend line for a company that has no long term yet.

   WARM-UP, stated because it is the usual way these are got wrong:
     · SMA(n)  needs n bars.
     · EMA(n)  is seeded with the SMA of the first n bars and then walked
               forward. Seeding with the first close instead makes the early
               values wrong and the error decays slowly.
     · RSI(14) uses Wilder's smoothing, not a plain average of gains and losses.
               It needs 15 bars for the first value and is only meaningful after
               a further ~14, so it is reported from bar 28.
     · MACD    12/26/9 needs 26 bars for the line and 26+9 for the signal. The
               histogram is reported only when both exist.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const num = (v) => (v === null || v === undefined || !isFinite(Number(v))) ? null : Number(v);
const r2 = (v, d = 2) => v === null ? null : +Number(v).toFixed(d);

/* Simple moving average of the LAST n values. Returns null below n. */
function sma(values, n) {
  if (!Array.isArray(values) || n <= 0 || values.length < n) return null;
  const w = values.slice(-n);
  let s = 0;
  for (const v of w) { const x = num(v); if (x === null) return null; s += x; }
  return s / n;
}

/* Full EMA series, SMA-seeded. Returns [] below n so callers cannot read a
   partially warmed value by indexing. */
function emaSeries(values, n) {
  if (!Array.isArray(values) || n <= 0 || values.length < n) return [];
  const k = 2 / (n + 1);
  const seed = sma(values.slice(0, n), n);
  if (seed === null) return [];
  const out = [seed];
  for (let i = n; i < values.length; i++) {
    const x = num(values[i]);
    if (x === null) return out;
    out.push(x * k + out[out.length - 1] * (1 - k));
  }
  return out;
}

function ema(values, n) {
  const s = emaSeries(values, n);
  return s.length ? s[s.length - 1] : null;
}

/* Wilder's RSI. The first average is a plain mean of the first n changes; every
   one after is smoothed. Using a plain rolling mean throughout is a common and
   silent error — it produces a curve that looks like RSI and turns at different
   places. */
function rsi(values, n = 14) {
  if (!Array.isArray(values) || values.length < n + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const a = num(values[i]), b = num(values[i - 1]);
    if (a === null || b === null) return null;
    const d = a - b;
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= n; loss /= n;
  for (let i = n + 1; i < values.length; i++) {
    const a = num(values[i]), b = num(values[i - 1]);
    if (a === null || b === null) return null;
    const d = a - b;
    gain = (gain * (n - 1) + (d > 0 ? d : 0)) / n;
    loss = (loss * (n - 1) + (d < 0 ? -d : 0)) / n;
  }
  // A window with no down-closes has zero average loss. RS is infinite and RSI
  // is exactly 100 — a real reading, not a divide-by-zero to be swallowed.
  if (loss === 0) return gain === 0 ? 50 : 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

/* MACD 12/26/9. Both EMA series are aligned on their tails before subtracting —
   the 12 series is longer than the 26 series, and subtracting them index-by-index
   from the front silently pairs different dates. */
function macd(values, fast = 12, slow = 26, signal = 9) {
  const f = emaSeries(values, fast), s = emaSeries(values, slow);
  if (!f.length || !s.length) return { macd: null, signal: null, histogram: null };
  const n = Math.min(f.length, s.length);
  const line = [];
  for (let i = 0; i < n; i++) line.push(f[f.length - n + i] - s[s.length - n + i]);
  const sig = emaSeries(line, signal);
  const m = line[line.length - 1];
  const g = sig.length ? sig[sig.length - 1] : null;
  return { macd: m, signal: g, histogram: g === null ? null : m - g };
}

/* Average True Range — the range measure that accounts for gaps, which a
   high-minus-low does not. Needs high, low and the previous close. */
function atr(bars, n = 14) {
  if (!Array.isArray(bars) || bars.length < n + 1) return null;
  const tr = [];
  for (let i = 1; i < bars.length; i++) {
    const h = num(bars[i].high), l = num(bars[i].low), pc = num(bars[i - 1].close);
    if (h === null || l === null || pc === null) continue;
    tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  if (tr.length < n) return null;
  let a = tr.slice(0, n).reduce((x, y) => x + y, 0) / n;
  for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
  return a;
}

/* Percentage change over the last n bars. */
function changePct(values, n) {
  if (!Array.isArray(values) || values.length < n + 1) return null;
  const a = num(values[values.length - 1]), b = num(values[values.length - 1 - n]);
  if (a === null || b === null || b === 0) return null;
  return (a - b) / b * 100;
}

/* Annualised volatility from daily log returns, 252 trading days. */
function volatility(values, n = 30) {
  if (!Array.isArray(values) || values.length < n + 1) return null;
  const w = values.slice(-(n + 1));
  const rets = [];
  for (let i = 1; i < w.length; i++) {
    const a = num(w[i]), b = num(w[i - 1]);
    if (a === null || b === null || b <= 0 || a <= 0) return null;
    rets.push(Math.log(a / b));
  }
  const mean = rets.reduce((x, y) => x + y, 0) / rets.length;
  const varr = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(varr) * Math.sqrt(252) * 100;
}

/* A trend read from the moving averages, and nothing else.

   It is deliberately mechanical and it says how many of its inputs were
   available. "UP on 2 of 3 checks" and "UP on 3 of 3" are different claims and
   a stock with no 200-DMA must not be presented as though it had one. */
function trendFromMAs(price, { sma20, sma50, sma200 }) {
  const checks = [];
  if (sma20 !== null && sma50 !== null) checks.push(sma20 > sma50);
  if (price !== null && sma50 !== null) checks.push(price > sma50);
  if (price !== null && sma200 !== null) checks.push(price > sma200);
  if (!checks.length) return { label: 'UNKNOWN', up: 0, of: 0 };
  const up = checks.filter(Boolean).length;
  const label = up === checks.length ? 'UP'
    : up === 0 ? 'DOWN'
    : 'MIXED';
  return { label, up, of: checks.length };
}

/* Where the last close sits inside a window's own range, 0–100.
   Used for the 52-week position bar the broker screens show. */
function positionInRange(last, low, high) {
  const a = num(last), lo = num(low), hi = num(high);
  if (a === null || lo === null || hi === null || hi <= lo) return null;
  return Math.min(100, Math.max(0, (a - lo) / (hi - lo) * 100));
}

/* Find a break in the series that no market move can explain.

   MEASURED, not hypothetical. On 2026-07-29 the TMPV daily series contained a
   single close-to-close move of −40.2% on 14 Oct 2025: 660.8 → 395.5. That is
   the Tata Motors demerger, not a crash. TCS over the same window has a worst
   day of −8.4%, which is a real move.

   Why it matters: every long-window figure computed across that date is
   arithmetically correct and factually meaningless. A 200-day average that
   blends pre- and post-demerger prices is not a trend line for anything that
   exists, and a "1-year return of −52.9%" describes a corporate action as though
   shareholders had lost half their money.

   THE THRESHOLD. Indian equities carry exchange circuit limits — 20% for most
   scrips, tighter for many. A close-to-close move beyond 25% therefore cannot
   be a price move; it is a split, a bonus, a demerger or a vendor error. Any of
   those means the same thing for the arithmetic: the series before that date is
   not comparable with the series after it.

   Returns the most recent such break, because that is the one that bounds how
   far back any window may honestly reach. */
function findDiscontinuity(closes, thresholdPct = 25) {
  if (!Array.isArray(closes) || closes.length < 2) return null;
  for (let i = closes.length - 1; i >= 1; i--) {
    const a = num(closes[i]), b = num(closes[i - 1]);
    if (a === null || b === null || b <= 0) continue;
    const move = (a - b) / b * 100;
    if (Math.abs(move) >= thresholdPct) return { index: i, movePct: r2(move, 1), from: r2(b), to: r2(a) };
  }
  return null;
}

/* The whole block, from daily bars.

   `bars` is [{ date, open, high, low, close, volume }] oldest-first. Anything
   without a close is dropped: the vendor emits null-close rows for holidays,
   and carrying them forward would flatten every average across the gap. */
function compute(bars) {
  const rows = (Array.isArray(bars) ? bars : [])
    .filter(b => b && num(b.close) !== null && num(b.close) > 0);
  if (rows.length < 2) return { ok: false, bars: rows.length, reason: 'not enough price history to compute anything' };

  const close = rows.map(b => Number(b.close));
  const vol = rows.map(b => num(b.volume)).filter(v => v !== null);
  const last = close[close.length - 1];

  /* How many bars of history are actually comparable with today's price.
     A corporate action ends the usable series at that date: everything before it
     is a differently-constituted company or a differently-sized share, and
     averaging across it produces a number about nothing. */
  const brk = findDiscontinuity(close);
  const usable = brk ? close.length - brk.index : close.length;
  const dateOf = (i) => rows[i] && rows[i].date ? new Date(rows[i].date).toISOString().slice(0, 10) : null;

  // Every window is asked for against the usable history, not the raw array.
  // `null` here is the honest answer and the card renders it as a blank with the
  // break named beside it.
  const win = (n, f) => (usable >= n ? f() : null);
  const s20 = win(20, () => sma(close, 20));
  const s50 = win(50, () => sma(close, 50));
  const s200 = win(200, () => sma(close, 200));
  const m = usable >= 26 ? macd(close) : { macd: null, signal: null, histogram: null };
  // RSI is arithmetically defined from 15 bars but is dominated by its seed
  // until Wilder's smoothing has had roughly another full period to work. Below
  // 28 bars it is reported as null rather than as a number that will be read as
  // overbought or oversold.
  const rsi14 = usable >= 28 ? rsi(close, 14) : null;

  // The 52-week band is taken from the comparable stretch only. A pre-demerger
  // high of ₹660 presented as this share's 52-week high would put the current
  // price near the bottom of a range it was never in.
  const band = close.slice(-Math.min(252, usable));
  const hi52 = band.length >= 20 ? Math.max(...band) : null;
  const lo52 = band.length >= 20 ? Math.min(...band) : null;

  const avgVol = vol.length >= 20 ? vol.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
  const lastVol = vol.length ? vol[vol.length - 1] : null;

  const perf = (n) => (usable >= n + 1 ? r2(changePct(close, n)) : null);

  return {
    ok: true,
    bars: rows.length,
    /* Stated even when null, because "no break found" is itself a fact the
       reader is entitled to — it is what makes the 200-day average believable. */
    dataBreak: brk ? {
      on: dateOf(brk.index), movePct: brk.movePct, from: brk.from, to: brk.to,
      usableBars: usable,
      note: `A ${brk.movePct}% single-day move on ${dateOf(brk.index)} exceeds any exchange circuit limit, ` +
            'so it is a corporate action (split, bonus or demerger), not a price move. Windows reaching ' +
            'past that date are left blank rather than averaged across it.',
    } : null,
    asOf: rows[rows.length - 1].date ? new Date(rows[rows.length - 1].date).toISOString().slice(0, 10) : null,
    close: r2(last),
    movingAverages: {
      sma20: r2(s20), sma50: r2(s50), sma200: r2(s200),
      ema20: r2(win(20, () => ema(close, 20))), ema50: r2(win(50, () => ema(close, 50))),
      // Distance from each average, which is what a reader actually compares.
      vsSma50Pct: s50 ? r2((last - s50) / s50 * 100) : null,
      vsSma200Pct: s200 ? r2((last - s200) / s200 * 100) : null,
    },
    oscillators: {
      rsi14: r2(rsi14),
      // Labelled, not just numbered: 70/30 are the conventional bands and the
      // label says which convention is being applied rather than implying one.
      rsiZone: rsi14 === null ? null : rsi14 >= 70 ? 'OVERBOUGHT' : rsi14 <= 30 ? 'OVERSOLD' : 'NEUTRAL',
      macd: r2(m.macd, 3), macdSignal: r2(m.signal, 3), macdHistogram: r2(m.histogram, 3),
      macdCross: (m.macd === null || m.signal === null) ? null : (m.macd > m.signal ? 'BULLISH' : 'BEARISH'),
    },
    range: {
      high52w: r2(hi52), low52w: r2(lo52),
      // From daily CLOSES, so it can differ from the vendor's 52-week high,
      // which uses intraday extremes. Said here so the two disagreeing does not
      // look like a bug.
      basis: 'daily closes in this window, not intraday extremes',
      positionPct: r2(positionInRange(last, lo52, hi52), 1),
      // ATR and 30-day volatility use short windows, but a break inside one of
      // them would still register a 40% corporate action as market risk.
      atr14: r2(win(15, () => atr(rows.slice(-usable), 14))),
      atrPct: (() => { const a = win(15, () => atr(rows.slice(-usable), 14)); return a === null || !last ? null : r2(a / last * 100); })(),
      volatility30d: r2(win(31, () => volatility(close, 30)), 1),
    },
    performance: {
      d1: perf(1), w1: perf(5), m1: perf(21), m3: perf(63), m6: perf(126), y1: perf(252),
    },
    volume: {
      last: lastVol, avg20: avgVol === null ? null : Math.round(avgVol),
      ratio: (avgVol && lastVol) ? r2(lastVol / avgVol) : null,
    },
    trend: trendFromMAs(last, { sma20: s20, sma50: s50, sma200: s200 }),
  };
}

module.exports = { compute, sma, ema, emaSeries, rsi, macd, atr, changePct, volatility,
  trendFromMAs, positionInRange, findDiscontinuity };
