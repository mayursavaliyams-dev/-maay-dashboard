/**
 * VWAP REVERSION
 * Master prompt: "fade extreme deviations from VWAP on range-bound days."
 *
 *   Deviation = (price - VWAP) / VWAP, also measured in ATR units.
 *   Entry SHORT when price is stretched FAR ABOVE VWAP (expect pull back down).
 *   Entry LONG  when price is stretched FAR BELOW VWAP (expect pull back up).
 *
 * Mean-reversion only makes sense in a range, so we additionally require the
 * deviation to be large in BOTH percent and ATR terms (filters trending days
 * where "far from VWAP" just means a strong trend, not an extreme).
 */

const { vwap, atr } = require('./indicators');

const NAME = 'vwap-reversion';

function signalAt(candles, i, cfg) {
  const devPct = (cfg.vwapDevPct ?? 0.6) / 100;   // min % stretch from VWAP
  const devAtr = cfg.vwapDevAtr ?? 1.5;            // min stretch in ATR units
  if (i < 15) return { signal: 'WAIT', reason: 'VWAP/ATR warmup', ctx: {} };

  const vw = vwap(candles, i);
  const a  = atr(candles, i, 14);
  const price = candles[i].c;
  const dev = (price - vw) / vw;
  const devInAtr = a > 0 ? (price - vw) / a : 0;
  const ctx = { vwap: +vw.toFixed(2), devPct: +(dev * 100).toFixed(2), devAtr: +devInAtr.toFixed(2) };

  const stretchedUp   = dev >=  devPct && devInAtr >=  devAtr;
  const stretchedDown = dev <= -devPct && devInAtr <= -devAtr;

  if (stretchedUp)   return { signal: 'SELL', reason: `fade: ${(dev*100).toFixed(2)}% (${devInAtr.toFixed(1)} ATR) above VWAP ${vw.toFixed(2)}`, ctx };
  if (stretchedDown) return { signal: 'BUY',  reason: `fade: ${(dev*100).toFixed(2)}% (${devInAtr.toFixed(1)} ATR) below VWAP ${vw.toFixed(2)}`, ctx };
  return { signal: 'WAIT', reason: 'within VWAP band', ctx };
}

module.exports = { name: NAME, signalAt };
