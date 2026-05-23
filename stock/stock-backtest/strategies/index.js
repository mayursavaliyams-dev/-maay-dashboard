/**
 * STRATEGY REGISTRY — selectable strategies, all sharing the same interface:
 *   signalAt(candles, i, cfg) → { signal: 'BUY'|'SELL'|'WAIT', reason, ctx }
 *
 * Pick one with the STRATEGY env var (default 'orb'). Both the backtest engine
 * and the live server resolve through here, so a single env flips both.
 */

const orb           = require('./orb');
const emaPullback   = require('./ema-pullback');
const vwapReversion = require('./vwap-reversion');
const gapAndGo      = require('./gap-and-go');

const REGISTRY = {
  [orb.name]:           orb,
  [emaPullback.name]:   emaPullback,
  [vwapReversion.name]: vwapReversion,
  [gapAndGo.name]:      gapAndGo
};

function getStrategy(name) {
  const key = (name || process.env.STRATEGY || 'orb').toLowerCase();
  const strat = REGISTRY[key];
  if (!strat) throw new Error(`unknown STRATEGY '${key}' — choose: ${Object.keys(REGISTRY).join(', ')}`);
  return strat;
}

function listStrategies() { return Object.keys(REGISTRY); }

module.exports = { getStrategy, listStrategies, REGISTRY };
