/**
 * ANTIGRAVITY STRATEGY ENGINE
 * Core logic for detecting explosive 5X/10X/99X moves in SENSEX options
 * 
 * Components:
 * - Opening Range Breakout (ORB) detection
 * - VWAP calculation
 * - Momentum analysis
 * - Volume spike detection
 */

/**
 * Calculate Opening Range Breakout (ORB) levels
 * Tracks high/low during first 15 minutes (9:15-9:30 AM)
 */
function calculateORB(prices, marketStartTime = null) {
  if (!prices || prices.length === 0) {
    return { high: null, low: null };
  }

  const high = Math.max(...prices);
  const low = Math.min(...prices);

  return { high, low };
}

/**
 * Calculate Volume Weighted Average Price (VWAP)
 * VWAP = Cumulative(Price * Volume) / Cumulative(Volume)
 */
function calculateVWAP(prices, volumes) {
  if (!prices || prices.length === 0 || !volumes || volumes.length === 0) {
    return 0;
  }

  // Ensure arrays are same length
  const minLength = Math.min(prices.length, volumes.length);
  
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;

  for (let i = 0; i < minLength; i++) {
    cumulativePriceVolume += prices[i] * volumes[i];
    cumulativeVolume += volumes[i];
  }

  if (cumulativeVolume === 0) return 0;

  return cumulativePriceVolume / cumulativeVolume;
}

/**
 * Detect volume spike
 * Returns true if current volume is significantly above average
 */
function detectVolumeSpike(currentVolume, historicalVolumes, threshold = 1.5) {
  if (!historicalVolumes || historicalVolumes.length < 5) {
    return false;
  }

  // Get last 10 volumes (or available)
  const recentVolumes = historicalVolumes.slice(-10);
  const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
  
  return currentVolume > avgVolume * threshold;
}

/**
 * Check if candle is strong (big body, small wicks)
 * Indicates strong momentum
 */
function isStrongCandle(open, high, low, close, bodyPercentThreshold = 0.7) {
  const candleRange = high - low;
  if (candleRange === 0) return false;

  const bodySize = Math.abs(close - open);
  const bodyPercent = bodySize / candleRange;

  return bodyPercent >= bodyPercentThreshold;
}

/**
 * Detect trend direction and strength
 */
function detectTrend(prices, vwap) {
  if (!prices || prices.length < 5 || !vwap) {
    return { direction: "UNKNOWN", strength: 0 };
  }

  const recentPrices = prices.slice(-10);
  const currentPrice = recentPrices[recentPrices.length - 1];
  
  // Distance from VWAP
  const distanceFromVWAP = ((currentPrice - vwap) / vwap) * 100;
  
  // Price momentum (recent direction)
  const priceChange = recentPrices[recentPrices.length - 1] - recentPrices[0];
  const momentum = priceChange / recentPrices[0] * 100;

  let direction = "SIDEWAYS";
  if (distanceFromVWAP > 0.1 && momentum > 0) direction = "BULLISH";
  else if (distanceFromVWAP < -0.1 && momentum < 0) direction = "BEARISH";

  const strength = Math.abs(distanceFromVWAP) + Math.abs(momentum);

  return { direction, strength, distanceFromVWAP, momentum };
}

/**
 * Check for consolidation before breakout
 * Antigravity moves often happen after consolidation
 */
function isConsolidation(prices, lookback = 20, threshold = 0.3) {
  if (!prices || prices.length < lookback) {
    return false;
  }

  const recentPrices = prices.slice(-lookback);
  const high = Math.max(...recentPrices);
  const low = Math.min(...recentPrices);
  const range = high - low;
  const avgPrice = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
  
  const rangePercent = (range / avgPrice) * 100;
  
  return rangePercent < threshold;
}

/**
 * Main strategy signal generator
 * Combines all indicators to generate trading signal
 */
function getSignal(data) {
  const {
    price,
    orHigh,
    orLow,
    vwap,
    volume,
    volumes,
    prices,
    candle,
    time
  } = data;

  let score = 0;
  let signal = "WAIT";
  let signalType = null;

  // Time filter - avoid first 15 minutes (ORB formation)
  // time is an IST-adjusted Date built via UTC offset, so use getUTCHours
  const hour = time ? time.getUTCHours() : 9;
  const minute = time ? time.getUTCMinutes() : 0;
  const isAfterORB = (hour === 9 && minute > 30) || hour >= 10;

  if (!isAfterORB) {
    return { signal: "WAIT", score: 0, reason: "ORB formation period" };
  }

  // Shared indicators (computed once for both directions)
  const volSpike   = volume && volumes && detectVolumeSpike(volume, volumes);
  const strongBody = candle && isStrongCandle(candle.open, candle.high, candle.low, candle.close);
  const priceArr   = prices && prices.length >= 5 ? prices : [price];
  const trend      = vwap ? detectTrend(priceArr, vwap) : { direction: 'UNKNOWN' };

  // ==================== CALL CONDITIONS ====================
  if (orHigh && price > orHigh) score += 25;
  if (vwap   && price > vwap)   score += 25;
  if (volSpike)                  score += 20;
  if (strongBody)                score += 15;
  if (trend.direction === 'BULLISH') score += 15;

  // ==================== PUT CONDITIONS ====================
  let putScore = 0;
  if (orLow && price < orLow) putScore += 25;
  if (vwap  && price < vwap)  putScore += 25;
  if (volSpike)                putScore += 20;
  if (strongBody)              putScore += 15;
  if (trend.direction === 'BEARISH') putScore += 15;

  // ==================== DETERMINE SIGNAL ====================
  if (score >= 75 && putScore < 75) {
    signal = "CALL";
    signalType = "BUY_CE";
  } else if (putScore >= 75 && score < 75) {
    signal = "PUT";
    signalType = "BUY_PE";
  }

  // If both scores are high, market is choppy - avoid
  if (score >= 70 && putScore >= 70) {
    signal = "WAIT";
    signalType = null;
    score = 0;
  }

  return {
    signal,
    signalType,
    score: Math.max(score, putScore),
    callScore: score,
    putScore: putScore
  };
}

/**
 * Strike selection logic
 * Suggests best strike based on signal strength
 */
function selectStrike(currentPrice, signalType, confidence) {
  const lotSize = 100; // SENSEX lot size
  const atmStrike = Math.round(currentPrice / lotSize) * lotSize;

  let strikes = {
    atm: null,
    otm1: null,
    otm2: null,
    recommendation: null
  };

  if (signalType === "CALL" || signalType === "BUY_CE") {
    strikes.atm = atmStrike + " CE";
    strikes.otm1 = (atmStrike + lotSize) + " CE";
    strikes.otm2 = (atmStrike + lotSize * 2) + " CE";

    // Higher confidence = deeper OTM for bigger multiplier
    if (confidence >= 90) {
      strikes.recommendation = strikes.otm2; // 50X-99X potential
    } else if (confidence >= 80) {
      strikes.recommendation = strikes.otm1; // 10X-50X potential
    } else {
      strikes.recommendation = strikes.atm; // 5X-10X potential
    }
  } else if (signalType === "PUT" || signalType === "BUY_PE") {
    strikes.atm = atmStrike + " PE";
    strikes.otm1 = (atmStrike - lotSize) + " PE";
    strikes.otm2 = (atmStrike - lotSize * 2) + " PE";

    if (confidence >= 90) {
      strikes.recommendation = strikes.otm2;
    } else if (confidence >= 80) {
      strikes.recommendation = strikes.otm1;
    } else {
      strikes.recommendation = strikes.atm;
    }
  }

  return strikes;
}

/**
 * Target calculator based on signal strength
 */
function calculateTarget(entryPrice, signalStrength) {
  // Friday 5× preset: 5x is the primary target band; weaker signals
  // partial-book before 5x, stronger ones let it run beyond.
  let multiplier;

  if (signalStrength >= 95) {
    multiplier = { min: 5, max: 50, description: "5X-50X (Jackpot)" };
  } else if (signalStrength >= 90) {
    multiplier = { min: 5, max: 20, description: "5X-20X (Extreme)" };
  } else if (signalStrength >= 80) {
    multiplier = { min: 5, max: 10, description: "5X-10X (Strong)" };
  } else if (signalStrength >= 70) {
    multiplier = { min: 3, max: 5,  description: "3X-5X (Moderate)" };
  } else {
    multiplier = { min: 2, max: 5,  description: "2X-5X (Weak)" };
  }

  return {
    entryPrice,
    targets: {
      target1: entryPrice * multiplier.min,
      // Always book at 5x as the headline target.
      target2: entryPrice * 5,
      target3: entryPrice * multiplier.max
    },
    multiplier,
    primaryMultiple: 5,
    stopLoss: entryPrice * 0.65 // matches STOP_LOSS_PERCENT=35 default
  };
}

module.exports = {
  calculateORB,
  calculateVWAP,
  detectVolumeSpike,
  isStrongCandle,
  detectTrend,
  isConsolidation,
  getSignal,
  selectStrike,
  calculateTarget
};
