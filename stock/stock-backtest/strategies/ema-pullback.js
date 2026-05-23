/**
 * EMA TREND + PULLBACK
 * Master prompt: "9/21 EMA stack for trend; enter on pullback to 21 EMA that resumes."
 *
 *   Trend up   = EMA9 > EMA21 and price above EMA21.
 *   Pullback   = a prior candle dipped to/near the 21 EMA (within `pullbackPct`).
 *   Entry LONG = trend up + a pullback happened recently + this candle resumes
 *                (closes back above EMA9). Short is the mirror.
 *
 * Needs warmup (≥ emaSlow candles) before it fires.
 */

const { ema } = require('./indicators');

const NAME = 'ema-pullback';

function signalAt(candles, i, cfg) {
  const fast = cfg.emaFast || 9, slow = cfg.emaSlow || 21;
  const pullbackPct = (cfg.emaPullbackPct ?? 0.3) / 100;   // proximity to 21 EMA
  const lookback = cfg.emaPullbackLookback || 5;            // bars to find the dip

  if (i < slow + 2) return { signal: 'WAIT', reason: 'EMA warmup', ctx: {} };

  const e9  = ema(candles, i, fast);
  const e21 = ema(candles, i, slow);
  const price = candles[i].c;
  const ctx = { ema9: +e9.toFixed(2), ema21: +e21.toFixed(2) };

  const trendUp   = e9 > e21 && price > e21;
  const trendDown = e9 < e21 && price < e21;
  if (!trendUp && !trendDown) return { signal: 'WAIT', reason: 'no EMA trend', ctx };

  // Did price recently pull back to the 21 EMA?
  let pulledBack = false;
  for (let k = Math.max(slow, i - lookback); k < i; k++) {
    const e21k = ema(candles, k, slow);
    const near = Math.abs(candles[k].c - e21k) / e21k <= pullbackPct
              || (trendUp  && candles[k].l <= e21k)
              || (trendDown && candles[k].h >= e21k);
    if (near) { pulledBack = true; break; }
  }
  if (!pulledBack) return { signal: 'WAIT', reason: 'no pullback to EMA21', ctx };

  // Resumption: this candle closes back through the fast EMA in the trend direction.
  const prev = candles[i - 1].c;
  if (trendUp && prev <= e9 && price > e9) {
    return { signal: 'BUY', reason: `EMA9>${'EMA21'} uptrend + pullback resumed (px ${price.toFixed(2)} > EMA9 ${e9.toFixed(2)})`, ctx };
  }
  if (trendDown && prev >= e9 && price < e9) {
    return { signal: 'SELL', reason: `EMA9<EMA21 downtrend + pullback resumed (px ${price.toFixed(2)} < EMA9 ${e9.toFixed(2)})`, ctx };
  }
  return { signal: 'WAIT', reason: 'trend+pullback but no resumption yet', ctx };
}

module.exports = { name: NAME, signalAt };
