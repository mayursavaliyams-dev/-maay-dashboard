/**
 * Shared technical indicators for the stock strategies. Pure functions over an
 * array of candles ({ o,h,l,c,v,t }); each computes the value AS OF index i
 * using only candles[0..i] (no look-ahead).
 */

// EMA of close as of index i, period p. Walks from 0 to i (cheap for intraday).
function ema(candles, i, p) {
  if (i < 0) return null;
  const k = 2 / (p + 1);
  let e = candles[0].c;
  for (let n = 1; n <= i; n++) e = candles[n].c * k + e * (1 - k);
  return e;
}

// Session VWAP as of index i (cumulative typical-price × vol / cumulative vol).
function vwap(candles, i) {
  let pv = 0, v = 0;
  for (let n = 0; n <= i; n++) {
    const c = candles[n];
    const tp = (c.h + c.l + c.c) / 3;
    pv += tp * (c.v || 0); v += (c.v || 0);
  }
  return v > 0 ? pv / v : candles[i].c;
}

// Rolling average volume over the last `win` candles ending at i.
function avgVolume(candles, i, win = 20) {
  const from = Math.max(0, i - win + 1);
  const vols = candles.slice(from, i + 1).map(c => c.v).filter(v => v > 0);
  return vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : 0;
}

// Simple ATR (Wilder-ish) over `p` candles as of i — used for volatility-aware
// deviation thresholds. Falls back to mean range when fewer than p candles.
function atr(candles, i, p = 14) {
  const from = Math.max(1, i - p + 1);
  let sum = 0, n = 0;
  for (let k = from; k <= i; k++) {
    const tr = Math.max(
      candles[k].h - candles[k].l,
      Math.abs(candles[k].h - candles[k - 1].c),
      Math.abs(candles[k].l - candles[k - 1].c)
    );
    sum += tr; n++;
  }
  return n ? sum / n : (candles[i].h - candles[i].l);
}

module.exports = { ema, vwap, avgVolume, atr };
