/**
 * SMART MONEY CONCEPTS (SMC) ENGINE — Antigravity Pro · Module 5
 *
 * Institutional price-structure reading on OHLC bars. PURE — no I/O, no network;
 * the server aggregates 1-min candles into TF bars (reusing candlestick-patterns'
 * `aggregate`) and hands them in, so this is identical for NIFTY and SENSEX and is
 * fully unit-testable.
 *
 * Detects, on CLOSED bars only:
 *   • Swing structure  — fractal swing highs/lows
 *   • Market Structure — HH/HL (up) · LH/LL (down) · RANGING
 *   • BOS              — Break Of Structure (trend continuation)
 *   • CHOCH            — Change Of Character (first counter-trend break = reversal)
 *   • Order Blocks     — last opposite candle before the impulse that broke structure
 *   • Fair Value Gap   — 3-bar imbalance (unfilled inefficiency)
 *   • Liquidity Sweep  — stop-hunt wick beyond a swing that closes back inside
 *   • Breaker Block    — an order block that failed and flipped role
 *   • Mitigation       — price returning into an OB / FVG zone
 *
 * Produces a directional bias { score:-100..100, confidence, note } for the AI
 * Probability Engine (Module 10), plus the full structure for the dashboard.
 */
'use strict';

const sgn = v => (v > 0 ? 1 : v < 0 ? -1 : 0);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, d = 2) => +(+v).toFixed(d);

/** fractal swing points: high at i if it's the strict max of [i-k, i+k]; low symmetric. */
function swings(bars, k = 2) {
  const highs = [], lows = [];
  for (let i = k; i < bars.length - k; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - k; j <= i + k; j++) {
      if (j === i) continue;
      if (bars[j].h >= bars[i].h) isHigh = false;
      if (bars[j].l <= bars[i].l) isLow = false;
    }
    if (isHigh) highs.push({ i, price: bars[i].h, t: bars[i].t, type: 'HIGH' });
    if (isLow)  lows.push({ i, price: bars[i].l, t: bars[i].t, type: 'LOW' });
  }
  return { highs, lows };
}

/** classify market structure from the last swing highs/lows. */
function marketStructure(highs, lows) {
  const h2 = highs.slice(-2), l2 = lows.slice(-2);
  const hh = h2.length === 2 && h2[1].price > h2[0].price;
  const lh = h2.length === 2 && h2[1].price < h2[0].price;
  const hl = l2.length === 2 && l2[1].price > l2[0].price;
  const ll = l2.length === 2 && l2[1].price < l2[0].price;
  let trend = 'RANGING';
  if (hh && hl) trend = 'BULLISH';
  else if (lh && ll) trend = 'BEARISH';
  else if (hh || hl) trend = 'WEAK_BULLISH';
  else if (lh || ll) trend = 'WEAK_BEARISH';
  return { trend, hh, hl, lh, ll, lastHigh: highs[highs.length - 1] || null, lastLow: lows[lows.length - 1] || null };
}

/**
 * Walk closes forward and tag the structural breaks (BOS / CHOCH) relative to the
 * running trend. The most recent break drives the directional bias.
 */
function structureBreaks(bars, sw) {
  const events = [];
  // merge swings into one time-ordered list with running reference levels
  let trend = 0; // +1 up, -1 down, 0 unknown
  let lastSwingHigh = null, lastSwingLow = null;
  const allH = sw.highs.slice(), allL = sw.lows.slice();
  let hi = 0, li = 0;
  for (let i = 0; i < bars.length; i++) {
    // adopt swings as they become confirmed (their index <= i)
    while (hi < allH.length && allH[hi].i <= i) { lastSwingHigh = allH[hi]; hi++; }
    while (li < allL.length && allL[li].i <= i) { lastSwingLow = allL[li]; li++; }
    const c = bars[i].c;
    if (lastSwingHigh && c > lastSwingHigh.price && lastSwingHigh.i < i) {
      const kind = trend < 0 ? 'CHOCH' : 'BOS';         // breaking a high while down = reversal
      events.push({ i, t: bars[i].t, dir: 'BULLISH', kind, level: lastSwingHigh.price, brokeAt: round(c) });
      trend = 1; lastSwingHigh = null;                  // consume so we don't re-fire
    } else if (lastSwingLow && c < lastSwingLow.price && lastSwingLow.i < i) {
      const kind = trend > 0 ? 'CHOCH' : 'BOS';
      events.push({ i, t: bars[i].t, dir: 'BEARISH', kind, level: lastSwingLow.price, brokeAt: round(c) });
      trend = -1; lastSwingLow = null;
    }
  }
  return events;
}

/** last opposite candle before the impulse bar that broke structure = order block. */
function orderBlocks(bars, events, lookback = 6) {
  const obs = [];
  for (const ev of events) {
    const impulseIdx = ev.i;
    if (ev.dir === 'BULLISH') {
      // last DOWN candle before the up-impulse
      for (let j = impulseIdx - 1; j >= Math.max(0, impulseIdx - lookback); j--) {
        if (bars[j].c < bars[j].o) { obs.push({ type: 'DEMAND', dir: 'BULLISH', i: j, t: bars[j].t, top: round(Math.max(bars[j].o, bars[j].c)), bottom: round(bars[j].l), origin: ev.kind }); break; }
      }
    } else {
      for (let j = impulseIdx - 1; j >= Math.max(0, impulseIdx - lookback); j--) {
        if (bars[j].c > bars[j].o) { obs.push({ type: 'SUPPLY', dir: 'BEARISH', i: j, t: bars[j].t, top: round(bars[j].h), bottom: round(Math.min(bars[j].o, bars[j].c)), origin: ev.kind }); break; }
      }
    }
  }
  // mitigation + breaker: did later price return into / break through the block?
  const lastClose = bars.length ? bars[bars.length - 1].c : 0;
  for (const ob of obs) {
    let mitigated = false, broken = false;
    for (let j = ob.i + 2; j < bars.length; j++) {
      if (ob.dir === 'BULLISH') {
        if (bars[j].l <= ob.top && bars[j].l >= ob.bottom) mitigated = true;
        if (bars[j].c < ob.bottom) { broken = true; break; }
      } else {
        if (bars[j].h >= ob.bottom && bars[j].h <= ob.top) mitigated = true;
        if (bars[j].c > ob.top) { broken = true; break; }
      }
    }
    ob.mitigated = mitigated;
    ob.breaker = broken;                                // failed OB → flips role
    ob.fresh = !mitigated && !broken;
    ob.belowPrice = ob.top < lastClose;
  }
  return obs;
}

/** 3-bar Fair Value Gaps (imbalances), with fill/mitigation check. */
function fairValueGaps(bars) {
  const fvgs = [];
  for (let i = 1; i < bars.length - 1; i++) {
    const a = bars[i - 1], c = bars[i + 1];
    if (a.h < c.l) fvgs.push({ dir: 'BULLISH', i, t: bars[i].t, bottom: round(a.h), top: round(c.l) });
    else if (a.l > c.h) fvgs.push({ dir: 'BEARISH', i, t: bars[i].t, bottom: round(c.h), top: round(a.l) });
  }
  for (const g of fvgs) {
    let filled = false;
    for (let j = g.i + 2; j < bars.length; j++) {
      if (g.dir === 'BULLISH' && bars[j].l <= g.bottom) { filled = true; break; }
      if (g.dir === 'BEARISH' && bars[j].h >= g.top)    { filled = true; break; }
    }
    g.filled = filled; g.fresh = !filled;
  }
  return fvgs;
}

/** liquidity sweeps — wick beyond a swing that closes back inside (stop-hunt). */
function liquiditySweeps(bars, sw) {
  const out = [];
  const recentHighs = sw.highs.slice(-6), recentLows = sw.lows.slice(-6);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    for (const s of recentHighs) if (s.i < i && b.h > s.price && b.c < s.price) { out.push({ i, t: b.t, dir: 'BEARISH', side: 'BUY_SIDE', level: s.price }); break; }
    for (const s of recentLows)  if (s.i < i && b.l < s.price && b.c > s.price) { out.push({ i, t: b.t, dir: 'BULLISH', side: 'SELL_SIDE', level: s.price }); break; }
  }
  return out.slice(-6);
}

/**
 * Main entry. bars = [{t,o,h,l,c,v}] (closed bars, oldest→newest).
 * @returns full SMC analysis + a directional bias for the probability engine.
 */
function analyze(bars, opts = {}) {
  const k = opts.swingK || 2;
  const minBars = opts.minBars || (k * 2 + 6);
  if (!Array.isArray(bars) || bars.length < minBars) {
    return { available: false, reason: `need ≥${minBars} bars, got ${bars ? bars.length : 0}`, bias: { score: 0, confidence: 0, available: false } };
  }
  const sw = swings(bars, k);
  const structure = marketStructure(sw.highs, sw.lows);
  const events = structureBreaks(bars, sw);
  const obs = orderBlocks(bars, events);
  const fvgs = fairValueGaps(bars);
  const sweeps = liquiditySweeps(bars, sw);
  const lastClose = bars[bars.length - 1].c;
  const lastEvent = events[events.length - 1] || null;
  const lastSweep = sweeps[sweeps.length - 1] || null;

  // ── directional bias (-100..100) for the AI Probability Engine ──
  let score = 0; const reasons = [];
  const trendScore = { BULLISH: 40, WEAK_BULLISH: 18, RANGING: 0, WEAK_BEARISH: -18, BEARISH: -40 }[structure.trend] || 0;
  score += trendScore; if (trendScore) reasons.push(`structure ${structure.trend}`);

  if (lastEvent) {
    // recency weight: only the latest few bars' break matters strongly
    const age = bars.length - 1 - lastEvent.i;
    const recency = age <= 3 ? 1 : age <= 8 ? 0.6 : 0.3;
    const w = (lastEvent.kind === 'CHOCH' ? 35 : 25) * recency * sgn(lastEvent.dir === 'BULLISH' ? 1 : -1);
    score += w; reasons.push(`${lastEvent.dir} ${lastEvent.kind} @${lastEvent.level}${age <= 3 ? ' (fresh)' : ''}`);
  }
  if (lastSweep && bars.length - 1 - lastSweep.i <= 3) {
    score += lastSweep.dir === 'BULLISH' ? 20 : -20;
    reasons.push(`${lastSweep.dir} liquidity sweep`);
  }
  // fresh demand just below / supply just above = pull toward continuation
  const freshDemandBelow = obs.some(o => o.dir === 'BULLISH' && o.fresh && o.top < lastClose);
  const freshSupplyAbove = obs.some(o => o.dir === 'BEARISH' && o.fresh && o.bottom > lastClose);
  if (freshDemandBelow) { score += 8; reasons.push('fresh demand below'); }
  if (freshSupplyAbove) { score -= 8; reasons.push('fresh supply above'); }

  score = clamp(round(score, 1), -100, 100);
  // confidence grows with confirmations + data depth
  const confirmations = (trendScore ? 1 : 0) + (lastEvent ? 1 : 0) + (lastSweep ? 1 : 0) + (freshDemandBelow || freshSupplyAbove ? 1 : 0);
  const confidence = clamp(Math.round(35 + confirmations * 14 + Math.min(15, bars.length / 4)), 0, 92);

  return {
    available: true,
    bars: bars.length,
    lastClose: round(lastClose),
    structure,
    swings: { highs: sw.highs.slice(-5), lows: sw.lows.slice(-5) },
    events: events.slice(-6),
    lastEvent,
    orderBlocks: obs.slice(-6),
    fairValueGaps: fvgs.filter(g => g.fresh).slice(-6),
    liquiditySweeps: sweeps,
    bias: {
      score, confidence,
      direction: score > 8 ? 'BULLISH' : score < -8 ? 'BEARISH' : 'NEUTRAL',
      note: reasons.slice(0, 4).join(' · ') || 'no clear structure',
      available: true,
    },
  };
}

module.exports = { analyze, swings, marketStructure, structureBreaks, orderBlocks, fairValueGaps, liquiditySweeps };
