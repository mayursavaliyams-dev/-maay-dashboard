/**
 * GAP-AND-GO
 * Master prompt: "trade direction of opening gap if volume confirms."
 *
 *   Gap = (today's open - prior close) / prior close. We don't have the prior
 *   day's close in an intraday candle array, so we use the FIRST candle's open
 *   vs the session's reference. Practically: a strong directional first move
 *   off the open, confirmed by volume, that then continues.
 *
 *   Entry LONG  = open gapped/ran up >= gapPct AND price holds above the open
 *                 with volume confirmation, early in the session.
 *   Entry SHORT = mirror.
 *
 * Only fires in the early window (gaps resolve fast); after `maxEntryMin` into
 * the session it stops — a "gap" trade taken at noon isn't a gap trade.
 */

const { avgVolume } = require('./indicators');
const { minutesIntoSession } = require('../strategy-orb');

const NAME = 'gap-and-go';

function signalAt(candles, i, cfg) {
  const gapPct = (cfg.gapPct ?? 0.4) / 100;
  const volMult = cfg.volumeConfirmMult ?? 1.4;
  const maxEntryMin = cfg.gapMaxEntryMin ?? 60;       // minutes into session
  if (i < 2) return { signal: 'WAIT', reason: 'gap warmup', ctx: {} };

  const sessionMins = minutesIntoSession(candles[i].t) - minutesIntoSession(candles[0].t);
  if (sessionMins > maxEntryMin) return { signal: 'WAIT', reason: 'past gap window', ctx: {} };

  const dayOpen = candles[0].o;
  const price = candles[i].c;
  const run = (price - dayOpen) / dayOpen;
  const avgV = avgVolume(candles, i, 20);
  const volOk = avgV > 0 ? candles[i].v >= avgV * volMult : true;
  const ctx = { dayOpen: +dayOpen.toFixed(2), runPct: +(run * 100).toFixed(2) };

  // Continuation check: last 2 candles in the same direction as the run.
  const up2 = candles[i].c > candles[i - 1].c && candles[i - 1].c > candles[i - 2].c;
  const dn2 = candles[i].c < candles[i - 1].c && candles[i - 1].c < candles[i - 2].c;

  if (run >= gapPct && volOk && up2) {
    return { signal: 'BUY', reason: `gap-up ${(run*100).toFixed(2)}% off open + vol ${(candles[i].v/(avgV||1)).toFixed(1)}× continuing`, ctx };
  }
  if (run <= -gapPct && volOk && dn2) {
    return { signal: 'SELL', reason: `gap-down ${(run*100).toFixed(2)}% off open + vol ${(candles[i].v/(avgV||1)).toFixed(1)}× continuing`, ctx };
  }
  return { signal: 'WAIT', reason: 'no confirmed gap continuation', ctx };
}

module.exports = { name: NAME, signalAt };
