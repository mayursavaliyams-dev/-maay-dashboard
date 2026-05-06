/**
 * ANTIGRAVITY AI DECISION LAYER
 * Intelligent filtering to avoid bad trades and maximize high-probability setups
 * 
 * Features:
 * - Confidence scoring (0-100%)
 * - Market condition analysis
 * - Time-based filtering
 * - Multi-factor decision engine
 */

/**
 * AI Decision Engine
 * Analyzes multiple factors to generate confidence score
 */
function aiDecision(price, orHigh, orLow, vwap, volumeSpike, hour, minute, options = {}) {
  const {
    trend = null,
    consolidation = false,
    candleStrength = null,
    oiData = null
  } = options;

  let score = 0;
  let signal = "WAIT";
  let reasons = [];
  let warnings = [];

  // ==================== TIME FILTERS ====================
  const isMarketOpen = hour >= 9 && (hour < 15 || (hour === 15 && minute <= 30));
  const isAfterORB = (hour === 9 && minute > 30) || hour >= 10;
  const isLateDay = hour >= 14;

  if (!isMarketOpen) {
    return {
      signal: "WAIT",
      confidence: 0,
      reasons: ["Market is closed"],
      warnings: []
    };
  }

  if (!isAfterORB) {
    return {
      signal: "WAIT",
      confidence: 0,
      reasons: ["Waiting for ORB completion (9:30 AM)"],
      warnings: ["ORB formation in progress"]
    };
  }

  // ==================== CALL ANALYSIS ====================
  let callScore = 0;
  let callReasons = [];

  // ORB Breakout (25 points)
  if (orHigh && price > orHigh) {
    callScore += 25;
    callReasons.push("ORB High breakout");
  } else if (orHigh) {
    warnings.push("Price below ORB High");
  }

  // VWAP Position (25 points)
  if (vwap && price > vwap) {
    callScore += 25;
    callReasons.push("Above VWAP (bullish)");
    
    // Extra points for distance from VWAP
    const distanceFromVWAP = ((price - vwap) / vwap) * 100;
    if (distanceFromVWAP > 0.3) {
      callScore += 10;
      callReasons.push("Strong distance from VWAP");
    }
  } else if (vwap) {
    warnings.push("Price at or below VWAP");
  }

  // Volume Spike (20 points)
  if (volumeSpike) {
    callScore += 20;
    callReasons.push("Volume spike detected");
  }

  // Trend Alignment (15 points)
  if (trend === "BULLISH") {
    callScore += 15;
    callReasons.push("Bullish trend confirmed");
  } else if (trend === "BEARISH") {
    warnings.push("Trend is bearish (conflicting)");
  }

  // Candle Strength (10 points)
  if (candleStrength && candleStrength > 0.7) {
    callScore += 10;
    callReasons.push("Strong bullish candle");
  }

  // OI Analysis (5 points) - if available
  if (oiData && oiData.callOIBuildup) {
    callScore += 5;
    callReasons.push("Call OI buildup supporting");
  }

  // ==================== PUT ANALYSIS ====================
  let putScore = 0;
  let putReasons = [];

  // ORB Breakdown (25 points)
  if (orLow && price < orLow) {
    putScore += 25;
    putReasons.push("ORB Low breakdown");
  } else if (orLow) {
    warnings.push("Price above ORB Low");
  }

  // VWAP Position (25 points)
  if (vwap && price < vwap) {
    putScore += 25;
    putReasons.push("Below VWAP (bearish)");
    
    const distanceFromVWAP = ((vwap - price) / vwap) * 100;
    if (distanceFromVWAP > 0.3) {
      putScore += 10;
      putReasons.push("Strong distance from VWAP");
    }
  } else if (vwap) {
    warnings.push("Price at or above VWAP");
  }

  // Volume Spike (20 points)
  if (volumeSpike) {
    putScore += 20;
    putReasons.push("Volume spike detected");
  }

  // Trend Alignment (15 points)
  if (trend === "BEARISH") {
    putScore += 15;
    putReasons.push("Bearish trend confirmed");
  } else if (trend === "BULLISH") {
    warnings.push("Trend is bullish (conflicting)");
  }

  // Candle Strength (10 points)
  if (candleStrength && candleStrength > 0.7) {
    putScore += 10;
    putReasons.push("Strong bearish candle");
  }

  // OI Analysis (5 points)
  if (oiData && oiData.putOIBuildup) {
    putScore += 5;
    putReasons.push("Put OI buildup supporting");
  }

  // ==================== CONFLICT DETECTION ====================
  // If both CALL and PUT scores are high, market is choppy
  if (callScore >= 60 && putScore >= 60) {
    return {
      signal: "WAIT",
      confidence: 0,
      reasons: ["Conflicting signals (choppy market)"],
      warnings: ["Avoid trading - unclear direction"]
    };
  }

  // ==================== FINAL DECISION ====================
  const maxScore = Math.max(callScore, putScore);
  
  if (callScore > putScore && callScore >= 75) {
    signal = "CALL";
    score = Math.min(callScore, 100);
    reasons = callReasons;
  } else if (putScore > callScore && putScore >= 75) {
    signal = "PUT";
    score = Math.min(putScore, 100);
    reasons = putReasons;
  } else if (callScore >= 65 || putScore >= 65) {
    signal = "WEAK";
    score = Math.max(callScore, putScore);
    reasons = ["Signal present but below threshold"];
    warnings.push("Low confidence - consider waiting");
  } else {
    signal = "WAIT";
    score = Math.max(callScore, putScore);
    reasons = ["No clear setup detected"];
  }

  // ==================== LATE DAY WARNING ====================
  if (isLateDay && score >= 75) {
    warnings.push("Late day trade - higher risk of reversal");
    score = Math.max(0, score - 10); // Reduce confidence
  }

  // ==================== CONSOLIDATION BONUS ====================
  if (consolidation && score >= 75) {
    score = Math.min(100, score + 10);
    reasons.push("Breakout after consolidation (high probability)");
  }

  return {
    signal,
    confidence: Math.round(score),
    reasons,
    warnings,
    callScore: Math.round(callScore),
    putScore: Math.round(putScore)
  };
}

/**
 * Calculate confidence percentage based on multiple factors
 */
function calculateConfidence(data) {
  const {
    price,
    orHigh,
    orLow,
    vwap,
    volume,
    avgVolume,
    trend,
    time
  } = data;

  let confidence = 0;
  const factors = [];

  // Factor 1: ORB Breakout (25%)
  if (orHigh && price > orHigh) {
    confidence += 25;
    factors.push("ORB breakout confirmed");
  } else if (orLow && price < orLow) {
    confidence += 25;
    factors.push("ORB breakdown confirmed");
  }

  // Factor 2: VWAP Alignment (25%)
  if (vwap) {
    const isAboveVWAP = price > vwap;
    const distancePercent = Math.abs((price - vwap) / vwap) * 100;
    
    if (distancePercent > 0.2) {
      confidence += 25;
      factors.push(`Strong VWAP alignment (${distancePercent.toFixed(2)}%)`);
    } else if (distancePercent > 0.1) {
      confidence += 15;
      factors.push("Moderate VWAP alignment");
    }
  }

  // Factor 3: Volume Analysis (20%)
  if (volume && avgVolume && avgVolume > 0) {
    const volumeRatio = volume / avgVolume;
    
    if (volumeRatio > 2.0) {
      confidence += 20;
      factors.push(`Massive volume spike (${volumeRatio.toFixed(1)}x)`);
    } else if (volumeRatio > 1.5) {
      confidence += 15;
      factors.push(`Volume spike (${volumeRatio.toFixed(1)}x)`);
    } else if (volumeRatio > 1.0) {
      confidence += 10;
      factors.push("Above average volume");
    }
  }

  // Factor 4: Trend Confirmation (15%)
  if (trend === "BULLISH" || trend === "BEARISH") {
    confidence += 15;
    factors.push(`${trend} trend confirmed`);
  }

  // Factor 5: Time Filter (10%)
  if (time) {
    const hour = time.getHours();
    const minute = time.getMinutes();
    
    // Best time: 10 AM - 2 PM
    if ((hour === 10 || hour === 11 || hour === 12 || hour === 13) || 
        (hour === 14 && minute < 30)) {
      confidence += 10;
      factors.push("Optimal time window");
    } else if (hour >= 14 && minute >= 30) {
      confidence += 5;
      factors.push("Late session (reduced confidence)");
    }
  }

  return {
    confidence: Math.min(confidence, 100),
    factors,
    grade: confidence >= 90 ? "A+" : 
           confidence >= 85 ? "A" : 
           confidence >= 80 ? "A-" : 
           confidence >= 75 ? "B+" : 
           confidence >= 70 ? "B" : "C"
  };
}

/**
 * Market condition classifier
 */
function classifyMarket(prices, vwap, lookback = 30) {
  if (!prices || prices.length < lookback) {
    return { condition: "UNKNOWN", volatility: 0 };
  }

  const recentPrices = prices.slice(-lookback);
  const high = Math.max(...recentPrices);
  const low = Math.min(...recentPrices);
  const range = high - low;
  const avgPrice = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
  
  const volatility = (range / avgPrice) * 100;
  
  let condition;
  if (volatility < 0.2) {
    condition = "CONSOLIDATION";
  } else if (volatility < 0.5) {
    condition = "NORMAL";
  } else if (volatility < 1.0) {
    condition = "TRENDING";
  } else {
    condition = "HIGHLY_VOLATILE";
  }

  return {
    condition,
    volatility: volatility.toFixed(3),
    range: range.toFixed(2),
    high,
    low
  };
}

/**
 * Trade quality assessor
 * Evaluates trade quality based on multiple parameters
 */
function assessTradeQuality(signalData) {
  const {
    signal,
    confidence,
    reasons,
    warnings
  } = signalData;

  let quality = "LOW";
  let recommendation = "AVOID";

  if (confidence >= 90 && warnings.length === 0) {
    quality = "EXCELLENT";
    recommendation = "STRONG_ENTRY";
  } else if (confidence >= 85 && warnings.length <= 1) {
    quality = "HIGH";
    recommendation = "ENTER";
  } else if (confidence >= 80) {
    quality = "GOOD";
    recommendation = "CONSIDER";
  } else if (confidence >= 75) {
    quality = "MODERATE";
    recommendation = "CAUTIOUS";
  } else {
    quality = "LOW";
    recommendation = "AVOID";
  }

  return {
    quality,
    recommendation,
    confidence,
    pros: reasons,
    cons: warnings,
    riskLevel: confidence >= 85 ? "LOW" : confidence >= 75 ? "MEDIUM" : "HIGH"
  };
}

/**
 * Pattern recognizer for antigravity moves
 * Detects specific patterns that precede explosive moves
 */
function recognizePattern(priceData, volumeData) {
  const patterns = {
    orbBreakout: false,
    vwapBreakout: false,
    consolidationBreakout: false,
    volumeClimax: false,
    gapFill: false
  };

  if (!priceData || priceData.length < 10) {
    return patterns;
  }

  const recentPrices = priceData.slice(-20);
  const recentVolumes = volumeData ? volumeData.slice(-20) : [];

  // Detect ORB Breakout
  const first15Min = priceData.slice(0, 3); // Approximate first 15 min
  if (first15Min.length > 0) {
    const orbHigh = Math.max(...first15Min);
    const currentPrice = recentPrices[recentPrices.length - 1];
    patterns.orbBreakout = currentPrice > orbHigh;
  }

  // Detect consolidation breakout
  const last10Prices = recentPrices.slice(-10);
  const range = Math.max(...last10Prices) - Math.min(...last10Prices);
  const avgPrice = last10Prices.reduce((a, b) => a + b, 0) / last10Prices.length;
  patterns.consolidationBreakout = (range / avgPrice) * 100 < 0.3;

  // Detect volume climax
  if (recentVolumes.length > 5) {
    const avgVolume = recentVolumes.slice(0, -1).reduce((a, b) => a + b, 0) / (recentVolumes.length - 1);
    const currentVolume = recentVolumes[recentVolumes.length - 1];
    patterns.volumeClimax = currentVolume > avgVolume * 2;
  }

  return patterns;
}

module.exports = {
  aiDecision,
  calculateConfidence,
  classifyMarket,
  assessTradeQuality,
  recognizePattern
};
