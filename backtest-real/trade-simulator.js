function simulateTrade({ signal, optionCandles, risk }) {
  if (!optionCandles || optionCandles.length === 0) {
    return { status: 'NO_OPTION_DATA' };
  }

  const entryTs = signal.entryTimestamp;
  const entryIdx = optionCandles.findIndex(c => c.t >= entryTs);
  if (entryIdx === -1 || entryIdx >= optionCandles.length - 1) {
    return { status: 'NO_ENTRY_CANDLE' };
  }

  const entryCandle = optionCandles[entryIdx];
  // Apply entry slippage: real fills hit slightly *worse* than the candle open.
  // slippagePct=2 means we pay 2% above the open price (pessimistic for buy).
  const slipPct = Number(risk.slippagePct || 0);
  const rawEntry = entryCandle.o;
  if (!rawEntry || rawEntry <= 0) {
    return { status: 'BAD_ENTRY_PRICE' };
  }
  const entryPrice = rawEntry * (1 + slipPct / 100);

  const slPrice = entryPrice * (1 - risk.stopLossPct / 100);
  const targetPrice = entryPrice * (1 + risk.targetPct / 100);

  let peakPrice = entryPrice;
  let trailingActive = false;
  let trailingStop = slPrice;

  for (let i = entryIdx + 1; i < optionCandles.length; i++) {
    const c = optionCandles[i];

    // Update peak
    if (c.h > peakPrice) peakPrice = c.h;

    // Activate trailing once we hit N× entry
    if (!trailingActive && peakPrice >= entryPrice * risk.trailAfterMultiple) {
      trailingActive = true;
    }

    if (trailingActive) {
      const gain = peakPrice - entryPrice;
      const lockedGain = gain * (risk.trailLockPct / 100);
      const newStop = entryPrice + lockedGain;
      if (newStop > trailingStop) trailingStop = newStop;
    }

    // Check target hit first (optimistic).
    // Apply exit slippage: real fills exit slightly *below* the target price.
    if (c.h >= targetPrice) {
      const exit = targetPrice * (1 - slipPct / 100);
      return makeResult({ signal, entryCandle, entryPrice, exitPrice: exit, exitCandle: c, reason: 'TARGET',
        lotSize: risk.lotSize, brokeragePerOrder: risk.brokeragePerOrder });
    }

    // Then stop-loss (trailing if active, else hard SL)
    const effectiveStop = trailingActive ? trailingStop : slPrice;
    if (c.l <= effectiveStop) {
      // SL slippage: gap-down or fast move means we exit BELOW the stop level.
      const exit = effectiveStop * (1 - slipPct / 100);
      return makeResult({
        signal, entryCandle, entryPrice,
        exitPrice: exit,
        exitCandle: c,
        reason: trailingActive ? 'TRAIL_STOP' : 'STOP_LOSS',
        lotSize: risk.lotSize, brokeragePerOrder: risk.brokeragePerOrder
      });
    }
  }

  // Ran out of candles — exit at last close (no slippage haircut, MTM exit)
  const last = optionCandles[optionCandles.length - 1];
  return makeResult({
    signal, entryCandle, entryPrice,
    exitPrice: last.c * (1 - slipPct / 100),
    exitCandle: last,
    reason: 'EOD_CLOSE',
    lotSize: risk.lotSize, brokeragePerOrder: risk.brokeragePerOrder
  });
}

function makeResult({ signal, entryCandle, entryPrice, exitPrice, exitCandle, reason, lotSize, brokeragePerOrder }) {
  const multiplier = exitPrice / entryPrice;
  const pnlPct = (multiplier - 1) * 100;
  // Absolute ₹ P&L for one lot, after brokerage.
  // gross = (exit - entry) × lotSize ; brokerage = 2 × per-order fee
  const lots = lotSize || 0;
  const grossPnlAbs   = lots > 0 ? (exitPrice - entryPrice) * lots : 0;
  const brokerageAbs  = lots > 0 ? (brokeragePerOrder || 0) * 2 : 0;
  const netPnlAbs     = grossPnlAbs - brokerageAbs;
  const netPnlPct     = entryPrice > 0 && lots > 0
    ? (netPnlAbs / (entryPrice * lots)) * 100
    : pnlPct;

  return {
    status: 'OK',
    type: signal.signal,
    score: signal.score,
    entryTimestamp: entryCandle.t,
    entryPrice,
    exitTimestamp: exitCandle.t,
    exitPrice,
    multiplier: +multiplier.toFixed(3),
    pnlPct:        +pnlPct.toFixed(2),       // gross % (unchanged for compat with old reports)
    netPnlPct:     +netPnlPct.toFixed(2),    // net % after brokerage
    grossPnlAbs:   +grossPnlAbs.toFixed(2),
    brokerageAbs:  +brokerageAbs.toFixed(2),
    netPnlAbs:     +netPnlAbs.toFixed(2),
    lotSize:       lots,
    reason,
    win: netPnlAbs > 0,
    strike: entryCandle.strike || null,
    spotAtEntry: entryCandle.spot || null
  };
}

module.exports = { simulateTrade };
