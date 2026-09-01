'use strict';

const technicals = require('./stock-technicals');

const num = (v) => (v === null || v === undefined || !Number.isFinite(Number(v))) ? null : Number(v);
const r2 = (v, d = 2) => v === null ? null : +Number(v).toFixed(d);

function compactSamples(samples, max = 500) {
  return (Array.isArray(samples) ? samples : [])
    .map(s => ({
      t: Number(s.t || s.ts || 0),
      price: num(s.price ?? s.close ?? s.ltp),
      volume: num(s.volume ?? s.v),
      source: s.source || null,
    }))
    .filter(s => s.t > 0 && s.price !== null && s.price > 0)
    .slice(-max);
}

function slope(values, n = 5) {
  if (!Array.isArray(values) || values.length < n + 1) return null;
  const a = num(values[values.length - 1]);
  const b = num(values[values.length - 1 - n]);
  if (a === null || b === null || b === 0) return null;
  return (a - b) / b * 100;
}

function sampleVwap(rows) {
  let pv = 0, vv = 0;
  for (const r of rows) {
    const p = num(r.price), v = num(r.volume);
    if (p === null || v === null || v <= 0) continue;
    pv += p * v; vv += v;
  }
  return vv > 0 ? pv / vv : null;
}

function classify({ price, vwap, ema9, ema21, rsi14, macdHistogram, momentumPct }) {
  let bull = 0, bear = 0;
  const reasons = [];
  const add = (side, text) => {
    if (side === 'bull') bull += 1;
    if (side === 'bear') bear += 1;
    reasons.push(text);
  };

  if (ema9 !== null && ema21 !== null) {
    if (ema9 > ema21) add('bull', 'EMA 9 above EMA 21');
    else if (ema9 < ema21) add('bear', 'EMA 9 below EMA 21');
  }
  if (vwap !== null) {
    if (price > vwap) add('bull', 'price above sample VWAP');
    else if (price < vwap) add('bear', 'price below sample VWAP');
  }
  if (rsi14 !== null) {
    if (rsi14 >= 55 && rsi14 < 75) add('bull', 'RSI in bullish zone');
    else if (rsi14 <= 45 && rsi14 > 25) add('bear', 'RSI in bearish zone');
    else if (rsi14 >= 75) reasons.push('RSI stretched high');
    else if (rsi14 <= 25) reasons.push('RSI stretched low');
  }
  if (macdHistogram !== null) {
    if (macdHistogram > 0) add('bull', 'MACD histogram positive');
    else if (macdHistogram < 0) add('bear', 'MACD histogram negative');
  }
  if (momentumPct !== null) {
    if (momentumPct > 0.05) add('bull', 'recent price momentum positive');
    else if (momentumPct < -0.05) add('bear', 'recent price momentum negative');
  }

  const score = bull - bear;
  const label = score >= 3 ? 'BULLISH' : score <= -3 ? 'BEARISH' : 'NEUTRAL';
  return {
    label,
    actionBias: label === 'BULLISH' ? 'BUY_CALL_BIAS' : label === 'BEARISH' ? 'BUY_PUT_BIAS' : 'WAIT',
    score,
    bullVotes: bull,
    bearVotes: bear,
    reasons,
    recommendationStatus: 'research_only',
  };
}

function compute(samples, opts = {}) {
  const rows = compactSamples(samples, opts.maxSamples || 500);
  const closes = rows.map(r => r.price);
  const price = closes.length ? closes[closes.length - 1] : null;
  const lastAt = rows.length ? rows[rows.length - 1].t : 0;
  const now = Number(opts.now || Date.now());
  const staleMs = Number(opts.staleMs || 45000);
  const stale = !lastAt || now - lastAt > staleMs;

  if (price === null) {
    return {
      ok: false,
      reason: 'no market samples yet',
      samples: 0,
      stale: true,
      recommendationStatus: 'research_only',
    };
  }

  const ema9 = technicals.ema(closes, 9);
  const ema21 = technicals.ema(closes, 21);
  const macd = technicals.macd(closes, 12, 26, 9);
  const rsi14 = closes.length >= 28 ? technicals.rsi(closes, 14) : null;
  const vwap = sampleVwap(rows) ?? technicals.sma(closes, Math.min(20, closes.length));
  const momentumPct = slope(closes, Math.min(5, Math.max(1, closes.length - 1)));
  const trend = classify({ price, vwap, ema9, ema21, rsi14, macdHistogram: macd.histogram, momentumPct });

  return {
    ok: true,
    samples: rows.length,
    lastAt: new Date(lastAt).toISOString(),
    ageMs: Math.max(0, now - lastAt),
    stale,
    price: r2(price),
    indicators: {
      vwap: r2(vwap),
      sma20: r2(technicals.sma(closes, 20)),
      ema9: r2(ema9),
      ema21: r2(ema21),
      rsi14: r2(rsi14),
      macd: r2(macd.macd, 3),
      macdSignal: r2(macd.signal, 3),
      macdHistogram: r2(macd.histogram, 3),
      momentumPct: r2(momentumPct, 3),
    },
    trend,
    note: 'Intraday sample indicators from the server poller. Research-only; not an order instruction.',
  };
}

module.exports = { compute, compactSamples, classify };
