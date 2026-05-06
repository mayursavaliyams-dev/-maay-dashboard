/**
 * SENSIBULL-STYLE OPTION ANALYZER
 * Complete options analytics suite
 * Features: Option Chain, Greeks, OI Analysis, IV, PCR, Max Pain, Payoff
 */

class OptionAnalyzer {
  constructor() {
    this.spotPrice = 70000;
    this.expiryDate = null;
    this.optionChain = [];
    this.greeks = {};
    this.ivData = {};
    this.oiAnalysis = {};
  }

  /**
   * Initialize with spot price and strikes
   */
  initialize(spotPrice, strikes = 20) {
    this.spotPrice = spotPrice;
    this.optionChain = this.generateOptionChain(spotPrice, strikes);
    return this.optionChain;
  }

  /**
   * Generate complete option chain with Sensibull-style metrics
   */
  generateOptionChain(spotPrice, totalStrikes = 20) {
    const atmStrike = Math.round(spotPrice / 100) * 100;
    const halfStrikes = Math.floor(totalStrikes / 2);
    const chain = [];

    for (let i = -halfStrikes; i <= halfStrikes; i++) {
      const strike = atmStrike + (i * 100);
      
      // Calculate option prices
      const cePrice = this.calculateOptionPrice(strike, 'CE', spotPrice);
      const pePrice = this.calculateOptionPrice(strike, 'PE', spotPrice);
      
      // Calculate Greeks
      const ceGreeks = this.calculateGreeks(strike, 'CE', spotPrice);
      const peGreeks = this.calculateGreeks(strike, 'PE', spotPrice);
      
      // Calculate IV
      const ceIV = this.calculateIV(strike, 'CE', spotPrice, cePrice.ltp);
      const peIV = this.calculateIV(strike, 'PE', spotPrice, pePrice.ltp);

      chain.push({
        strike,
        isATM: strike === atmStrike,
        itmCE: strike < atmStrike,
        itmPE: strike > atmStrike,
        
        // CE Data
        ce: {
          ltp: cePrice.ltp.toFixed(2),
          bid: (cePrice.ltp * 0.98).toFixed(2),
          ask: (cePrice.ltp * 1.02).toFixed(2),
          oi: this.generateOI(strike, 'CE', spotPrice),
          changeOI: 0,
          volume: 0,
          iv: ceIV.toFixed(2),
          delta: ceGreeks.delta.toFixed(4),
          gamma: ceGreeks.gamma.toFixed(4),
          theta: ceGreeks.theta.toFixed(4),
          vega: ceGreeks.vega.toFixed(4),
          openInterest: 0,
          changeInOI: 0,
          totalTrades: 0
        },
        
        // PE Data
        pe: {
          ltp: pePrice.ltp.toFixed(2),
          bid: (pePrice.ltp * 0.98).toFixed(2),
          ask: (pePrice.ltp * 1.02).toFixed(2),
          oi: this.generateOI(strike, 'PE', spotPrice),
          changeOI: 0,
          volume: 0,
          iv: peIV.toFixed(2),
          delta: peGreeks.delta.toFixed(4),
          gamma: peGreeks.gamma.toFixed(4),
          theta: peGreeks.theta.toFixed(4),
          vega: peGreeks.vega.toFixed(4),
          openInterest: 0,
          changeInOI: 0,
          totalTrades: 0
        }
      });
    }

    // Update OI changes
    this.updateOIChanges(chain);
    
    return chain;
  }

  /**
   * Calculate theoretical option price
   */
  calculateOptionPrice(strike, type, spotPrice) {
    const intrinsic = type === 'CE' 
      ? Math.max(0, spotPrice - strike)
      : Math.max(0, strike - spotPrice);
    
    const timeValue = this.calculateTimeValue(strike, spotPrice);
    const ltp = intrinsic + timeValue;

    return {
      ltp,
      intrinsic: intrinsic.toFixed(2),
      timeValue: timeValue.toFixed(2)
    };
  }

  /**
   * Calculate time value (simplified)
   */
  calculateTimeValue(strike, spotPrice) {
    const distanceFromATM = Math.abs(strike - spotPrice);
    const baseTimeValue = 50;
    const decay = distanceFromATM * 0.3;
    
    return Math.max(5, baseTimeValue - decay + (Math.random() * 20 - 10));
  }

  /**
   * Generate Open Interest (realistic simulation)
   */
  generateOI(strike, type, spotPrice) {
    const distanceFromATM = Math.abs(strike - spotPrice);
    const baseOI = 50000;
    const atmBonus = strike === Math.round(spotPrice / 100) * 100 ? 30000 : 0;
    const decay = distanceFromATM * 200;
    
    return Math.max(1000, baseOI - decay + atmBonus + Math.floor(Math.random() * 10000));
  }

  /**
   * Update OI changes
   */
  updateOIChanges(chain) {
    chain.forEach(strike => {
      // Simulate OI changes
      strike.ce.changeOI = Math.floor(Math.random() * 20000 - 10000);
      strike.pe.changeOI = Math.floor(Math.random() * 20000 - 10000);
      
      // Volume
      strike.ce.volume = Math.floor(Math.random() * 100000) + 5000;
      strike.pe.volume = Math.floor(Math.random() * 100000) + 5000;
      
      // Total trades
      strike.ce.totalTrades = Math.floor(strike.ce.volume / 10);
      strike.pe.totalTrades = Math.floor(strike.pe.volume / 10);
    });
  }

  /**
   * Calculate Greeks (Black-Scholes simplified)
   */
  calculateGreeks(strike, type, spotPrice) {
    const timeToExpiry = this.getTimeToExpiry();
    const riskFreeRate = 0.065; // 6.5% RBI rate
    const volatility = 0.15; // 15% typical for SENSEX
    
    // Calculate d1 and d2
    const d1 = this.calculateD1(spotPrice, strike, timeToExpiry, riskFreeRate, volatility);
    const d2 = d1 - volatility * Math.sqrt(timeToExpiry);
    
    let delta, gamma, theta, vega;

    if (type === 'CE') {
      delta = this.normalCDF(d1);
      gamma = this.normalPDF(d1) / (spotPrice * volatility * Math.sqrt(timeToExpiry));
      theta = -(spotPrice * this.normalPDF(d1) * volatility) / (2 * Math.sqrt(timeToExpiry)) 
              - riskFreeRate * strike * Math.exp(-riskFreeRate * timeToExpiry) * this.normalCDF(d2);
      vega = spotPrice * Math.sqrt(timeToExpiry) * this.normalPDF(d1);
    } else {
      delta = this.normalCDF(d1) - 1;
      gamma = this.normalPDF(d1) / (spotPrice * volatility * Math.sqrt(timeToExpiry));
      theta = -(spotPrice * this.normalPDF(d1) * volatility) / (2 * Math.sqrt(timeToExpiry)) 
              + riskFreeRate * strike * Math.exp(-riskFreeRate * timeToExpiry) * this.normalCDF(-d2);
      vega = spotPrice * Math.sqrt(timeToExpiry) * this.normalPDF(d1);
    }

    return { delta, gamma, theta: theta / 365, vega };
  }

  /**
   * Calculate d1 (Black-Scholes)
   */
  calculateD1(S, K, T, r, sigma) {
    return (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  }

  /**
   * Standard normal CDF approximation
   */
  normalCDF(x) {
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;
    
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);
    
    const t = 1 / (1 + p * x);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    
    return 0.5 * (1 + sign * y);
  }

  /**
   * Standard normal PDF
   */
  normalPDF(x) {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  }

  /**
   * Get time to expiry in years
   * SENSEX weekly expiry: Tuesday post-Oct 2024 cutover
   */
  getTimeToExpiry() {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sun,1=Mon,2=Tue,...
    let daysUntilExpiry;

    if (dayOfWeek === 2) { // Tuesday — expiry day
      daysUntilExpiry = 0.5; // ~half day remaining (conservative)
    } else if (dayOfWeek < 2) {
      daysUntilExpiry = 2 - dayOfWeek;
    } else {
      daysUntilExpiry = 9 - dayOfWeek; // Next Tuesday
    }

    return Math.max(daysUntilExpiry, 0.5) / 365;
  }

  /**
   * Calculate Implied Volatility
   */
  calculateIV(strike, type, spotPrice, marketPrice) {
    const timeToExpiry = this.getTimeToExpiry();
    
    // Simplified IV calculation using Newton-Raphson method
    let iv = 0.15; // Start with 15%
    const maxIterations = 100;
    
    for (let i = 0; i < maxIterations; i++) {
      const price = this.blackScholesPrice(spotPrice, strike, timeToExpiry, 0.065, iv, type);
      const diff = price - marketPrice;
      
      if (Math.abs(diff) < 0.01) break;
      
      iv = iv - diff / (spotPrice * Math.sqrt(timeToExpiry) * this.normalPDF(
        (Math.log(spotPrice / strike) + (0.065 + iv * iv / 2) * timeToExpiry) / (iv * Math.sqrt(timeToExpiry))
      ));
    }
    
    return iv * 100; // Return as percentage
  }

  /**
   * Black-Scholes price calculation
   */
  blackScholesPrice(S, K, T, r, sigma, type) {
    const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);
    
    if (type === 'CE') {
      return S * this.normalCDF(d1) - K * Math.exp(-r * T) * this.normalCDF(d2);
    } else {
      return K * Math.exp(-r * T) * this.normalCDF(-d2) - S * this.normalCDF(-d1);
    }
  }

  /**
   * Calculate PCR (Put Call Ratio)
   */
  calculatePCR(chain = null) {
    const data = chain || this.optionChain;
    
    let totalCallOI = 0;
    let totalPutOI = 0;
    let totalCallVolume = 0;
    let totalPutVolume = 0;
    let atmCallVolume = 0;
    let atmPutVolume = 0;

    data.forEach(strike => {
      totalCallOI += strike.ce.oi;
      totalPutOI += strike.pe.oi;
      totalCallVolume += strike.ce.volume;
      totalPutVolume += strike.pe.volume;
      
      if (strike.isATM) {
        atmCallVolume = strike.ce.volume;
        atmPutVolume = strike.pe.volume;
      }
    });

    const pcrOI = totalPutOI / totalCallOI;
    const pcrVolume = totalPutVolume / totalCallVolume;
    const pcrATM = atmPutVolume / atmCallVolume;

    return {
      pcrOI: pcrOI.toFixed(3),
      pcrVolume: pcrVolume.toFixed(3),
      pcrATM: pcrATM.toFixed(3),
      totalCallOI,
      totalPutOI,
      totalCallVolume,
      totalPutVolume,
      interpretation: this.interpretPCR(pcrOI, pcrVolume)
    };
  }

  /**
   * Interpret PCR values
   */
  interpretPCR(pcrOI, pcrVolume) {
    const avgPCR = (parseFloat(pcrOI) + parseFloat(pcrVolume)) / 2;
    
    if (avgPCR > 1.5) return { signal: 'OVERSOLD', bias: 'BULLISH', strength: 'STRONG' };
    if (avgPCR > 1.2) return { signal: 'BEARISH', bias: 'BULLISH', strength: 'MODERATE' };
    if (avgPCR > 0.8) return { signal: 'NEUTRAL', bias: 'SIDEWAYS', strength: 'WEAK' };
    if (avgPCR > 0.5) return { signal: 'BULLISH', bias: 'BEARISH', strength: 'MODERATE' };
    return { signal: 'OVERBOUGHT', bias: 'BEARISH', strength: 'STRONG' };
  }

  /**
   * Calculate Max Pain
   */
  calculateMaxPain(chain = null) {
    const data = chain || this.optionChain;
    const strikes = data.map(s => s.strike);
    const spotPrice = this.spotPrice;
    
    let maxPain = 0;
    let minTotalPain = Infinity;

    strikes.forEach(testStrike => {
      let totalPain = 0;
      
      data.forEach(strike => {
        const cePain = Math.max(0, testStrike - strike.strike) * strike.ce.oi;
        const pePain = Math.max(0, strike.strike - testStrike) * strike.pe.oi;
        totalPain += cePain + pePain;
      });
      
      if (totalPain < minTotalPain) {
        minTotalPain = totalPain;
        maxPain = testStrike;
      }
    });

    return {
      maxPain,
      currentSpot: spotPrice,
      distanceFromMaxPain: (spotPrice - maxPain).toFixed(2),
      distancePercent: ((spotPrice - maxPain) / maxPain * 100).toFixed(2),
      totalPain: minTotalPain,
      interpretation: spotPrice > maxPain ? 'Price above max pain (bullish)' : 'Price below max pain (bearish)'
    };
  }

  /**
   * OI Buildup Analysis
   */
  analyzeOIBuildup(chain = null) {
    const data = chain || this.optionChain;
    
    const ceBuildup = data
      .filter(s => s.ce.changeOI > 0)
      .sort((a, b) => b.ce.changeOI - a.ce.changeOI)
      .slice(0, 5)
      .map(s => ({
        strike: s.strike,
        changeOI: s.ce.changeOI,
        type: s.ce.changeOI > 0 && s.ce.ltp < 100 ? 'LONG_BUILDUP' : 'SHORT_BUILDUP'
      }));

    const peBuildup = data
      .filter(s => s.pe.changeOI > 0)
      .sort((a, b) => b.pe.changeOI - a.pe.changeOI)
      .slice(0, 5)
      .map(s => ({
        strike: s.strike,
        changeOI: s.pe.changeOI,
        type: s.pe.changeOI > 0 && s.pe.ltp < 100 ? 'LONG_BUILDUP' : 'SHORT_BUILDUP'
      }));

    const ceUnwinding = data
      .filter(s => s.ce.changeOI < 0)
      .sort((a, b) => a.ce.changeOI - b.ce.changeOI)
      .slice(0, 5)
      .map(s => ({
        strike: s.strike,
        changeOI: s.ce.changeOI,
        type: 'UNWINDING'
      }));

    const peUnwinding = data
      .filter(s => s.pe.changeOI < 0)
      .sort((a, b) => a.pe.changeOI - b.pe.changeOI)
      .slice(0, 5)
      .map(s => ({
        strike: s.strike,
        changeOI: s.pe.changeOI,
        type: 'UNWINDING'
      }));

    return {
      callLongBuildup: ceBuildup.filter(s => s.type === 'LONG_BUILDUP'),
      callShortBuildup: ceBuildup.filter(s => s.type === 'SHORT_BUILDUP'),
      putLongBuildup: peBuildup.filter(s => s.type === 'LONG_BUILDUP'),
      putShortBuildup: peBuildup.filter(s => s.type === 'SHORT_BUILDUP'),
      callUnwinding: ceUnwinding,
      putUnwinding: peUnwinding,
      interpretation: this.interpretOI(ceBuildup, peBuildup)
    };
  }

  /**
   * Interpret OI buildup data
   */
  interpretOI(ceBuildup, peBuildup) {
    const ceTotal = ceBuildup.reduce((s, x) => s + x.changeOI, 0);
    const peTotal = peBuildup.reduce((s, x) => s + x.changeOI, 0);
    if (peTotal > ceTotal * 1.3) return { bias: 'BULLISH', reason: 'More PE buildup — writers expect support' };
    if (ceTotal > peTotal * 1.3) return { bias: 'BEARISH', reason: 'More CE buildup — writers expect resistance' };
    return { bias: 'NEUTRAL', reason: 'Balanced OI buildup' };
  }

  /**
   * Calculate Payoff for strategies
   */
  calculatePayoff(strategy, spotPrice, strikes = []) {
    const payoffs = [];
    const spotRange = Array.from({length: 41}, (_, i) => spotPrice - 2000 + (i * 100));

    spotRange.forEach(price => {
      let payoff = 0;
      
      switch(strategy) {
        case 'LONG_CE':
          payoff = Math.max(0, price - strikes[0]) - strikes[1]; // strike, premium
          break;
        case 'LONG_PE':
          payoff = Math.max(0, strikes[0] - price) - strikes[1];
          break;
        case 'BULL_CALL_SPREAD':
          payoff = Math.max(0, price - strikes[0]) - strikes[2] 
                   - Math.max(0, price - strikes[1]) + strikes[3];
          break;
        case 'BEAR_PUT_SPREAD':
          payoff = Math.max(0, strikes[0] - price) - strikes[2]
                   - Math.max(0, strikes[1] - price) + strikes[3];
          break;
        case 'STRADDLE':
          payoff = Math.max(0, price - strikes[0]) + Math.max(0, strikes[0] - price) 
                   - strikes[1] - strikes[2];
          break;
        case 'STRANGLE':
          payoff = Math.max(0, price - strikes[0]) + Math.max(0, strikes[1] - price)
                   - strikes[2] - strikes[3];
          break;
      }
      
      payoffs.push({
        spotPrice: price,
        payoff: payoff.toFixed(2),
        pnl: payoff
      });
    });

    // Calculate key levels
    const breakeven = this.findBreakeven(payoffs);
    const maxProfit = Math.max(...payoffs.map(p => p.pnl));
    const maxLoss = Math.min(...payoffs.map(p => p.pnl));

    return {
      strategy,
      payoffs,
      breakeven,
      maxProfit: maxProfit.toFixed(2),
      maxLoss: maxLoss.toFixed(2),
      riskReward: maxLoss !== 0 ? (maxProfit / Math.abs(maxLoss)).toFixed(2) : 'N/A'
    };
  }

  /**
   * Find breakeven points
   */
  findBreakeven(payoffs) {
    const breakevens = [];
    
    for (let i = 1; i < payoffs.length; i++) {
      if ((payoffs[i-1].pnl < 0 && payoffs[i].pnl > 0) ||
          (payoffs[i-1].pnl > 0 && payoffs[i].pnl < 0)) {
        breakevens.push(payoffs[i].spotPrice);
      }
    }
    
    return breakevens;
  }

  /**
   * Get ATM strike
   */
  getATMStrike() {
    return Math.round(this.spotPrice / 100) * 100;
  }

  /**
   * Get all strikes by category
   */
  getStrikesByCategory() {
    const atm = this.getATMStrike();
    
    return {
      deepITM_CE: this.optionChain.filter(s => s.strike <= atm - 300),
      itmCE: this.optionChain.filter(s => s.strike > atm - 300 && s.strike < atm),
      atm: this.optionChain.filter(s => s.strike === atm),
      otmCE: this.optionChain.filter(s => s.strike > atm && s.strike <= atm + 300),
      deepOTM_CE: this.optionChain.filter(s => s.strike > atm + 300),
      deepITM_PE: this.optionChain.filter(s => s.strike >= atm + 300),
      itmPE: this.optionChain.filter(s => s.strike > atm && s.strike < atm + 300),
      otmPE: this.optionChain.filter(s => s.strike < atm && s.strike >= atm - 300),
      deepOTM_PE: this.optionChain.filter(s => s.strike < atm - 300)
    };
  }

  /**
   * Get complete analytics
   */
  getCompleteAnalytics() {
    const pcr = this.calculatePCR();
    const maxPain = this.calculateMaxPain();
    const oiAnalysis = this.analyzeOIBuildup();
    const atmStrike = this.getATMStrike();
    
    return {
      spotPrice: this.spotPrice,
      atmStrike,
      expiryType: this.getExpiryType(),
      optionChain: this.optionChain,
      pcr,
      maxPain,
      oiAnalysis,
      strikesByCategory: this.getStrikesByCategory(),
      ivSummary: this.getIVSummary(),
      topActivity: this.getTopActivity()
    };
  }

  /**
   * Get IV summary
   */
  getIVSummary() {
    const ceIVs = this.optionChain.map(s => parseFloat(s.ce.iv)).filter(v => isFinite(v) && v > 0);
    const peIVs = this.optionChain.map(s => parseFloat(s.pe.iv)).filter(v => isFinite(v) && v > 0);

    const avgCE_IV = ceIVs.length ? (ceIVs.reduce((a, b) => a + b, 0) / ceIVs.length).toFixed(2) : '15.00';
    const avgPE_IV = peIVs.length ? (peIVs.reduce((a, b) => a + b, 0) / peIVs.length).toFixed(2) : '15.00';
    
    return {
      avgCE_IV,
      avgPE_IV,
      overallIV: ((parseFloat(avgCE_IV) + parseFloat(avgPE_IV)) / 2).toFixed(2),
      ivPercentile: Math.floor(Math.random() * 40 + 30), // Simulated
      ivRank: Math.floor(Math.random() * 50 + 25) // Simulated
    };
  }

  /**
   * Get top activity
   */
  getTopActivity() {
    const byVolume = [...this.optionChain].sort((a, b) => 
      (b.ce.volume + b.pe.volume) - (a.ce.volume + a.pe.volume)
    ).slice(0, 5);
    
    const byOIChange = [...this.optionChain].sort((a, b) => 
      Math.abs(b.ce.changeOI) + Math.abs(b.pe.changeOI) - 
      Math.abs(a.ce.changeOI) - Math.abs(a.pe.changeOI)
    ).slice(0, 5);

    return {
      highestVolume: byVolume,
      highestOIChange: byOIChange
    };
  }

  /**
   * Get expiry type
   */
  getExpiryType() {
    const now = new Date();
    const day = now.getDay();
    if (day === 2) return 'WEEKLY_EXPIRY'; // Tuesday
    if (day === 5) return 'WEEKLY_EXPIRY'; // Friday (legacy pre-cutover)
    return 'REGULAR';
  }

  // ================================================================
  // REAL DATA INGESTION — from Sensibull fetcher
  // ================================================================

  /**
   * Initialize option chain from real Sensibull data.
   * Replaces simulated OI/LTP with actual market data.
   * Greeks are calculated via Black-Scholes using real LTP-derived IV.
   *
   * @param {object} realChain  Result of sensibull-fetcher.getChainAroundATM()
   * @param {number} spot       Live SENSEX spot price
   */
  initializeFromRealData(realChain, spot) {
    this.spotPrice = spot;
    const atm = Math.round(spot / 100) * 100;

    // Compute time to expiry from expiry date
    const expiryMs = new Date(realChain.expiry + 'T15:30:00+05:30').getTime();
    const nowMs    = Date.now();
    const T = Math.max((expiryMs - nowMs) / (365 * 24 * 3600 * 1000), 0.5 / 365);
    const r = 0.065;

    this.optionChain = realChain.strikes.map(row => {
      const strike = row.strike;
      const ce = row.ce;
      const pe = row.pe;

      // Back-calculate IV from real LTP using Newton-Raphson
      const ceIV = ce.ltp > 0.5 ? this._impliedVol(spot, strike, T, r, ce.ltp, 'CE') : 0.15;
      const peIV = pe.ltp > 0.5 ? this._impliedVol(spot, strike, T, r, pe.ltp, 'PE') : 0.15;

      const ceG = this._rawGreeks(spot, strike, T, r, ceIV, 'CE');
      const peG = this._rawGreeks(spot, strike, T, r, peIV, 'PE');

      return {
        strike,
        isATM: strike === atm,
        itmCE: strike < atm,
        itmPE: strike > atm,
        ce: {
          ltp:      ce.ltp.toFixed(2),
          bid:      (ce.ltp * 0.98).toFixed(2),
          ask:      (ce.ltp * 1.02).toFixed(2),
          oi:       ce.oi,
          changeOI: 0,
          volume:   ce.volume,
          iv:       (ceIV * 100).toFixed(2),
          delta:    ceG.delta.toFixed(4),
          gamma:    ceG.gamma.toFixed(6),
          theta:    ceG.theta.toFixed(4),
          vega:     ceG.vega.toFixed(4),
          token:    ce.token
        },
        pe: {
          ltp:      pe.ltp.toFixed(2),
          bid:      (pe.ltp * 0.98).toFixed(2),
          ask:      (pe.ltp * 1.02).toFixed(2),
          oi:       pe.oi,
          changeOI: 0,
          volume:   pe.volume,
          iv:       (peIV * 100).toFixed(2),
          delta:    peG.delta.toFixed(4),
          gamma:    peG.gamma.toFixed(6),
          theta:    peG.theta.toFixed(4),
          vega:     peG.vega.toFixed(4),
          token:    pe.token
        }
      };
    });

    return this.optionChain;
  }

  /**
   * Newton-Raphson implied volatility solver
   */
  _impliedVol(S, K, T, r, marketPrice, type, maxIter = 50) {
    let sigma = 0.25;
    for (let i = 0; i < maxIter; i++) {
      const price = this.blackScholesPrice(S, K, T, r, sigma, type);
      const diff  = price - marketPrice;
      if (Math.abs(diff) < 0.01) break;
      const sqrtT = Math.sqrt(T);
      const d1    = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
      const vega  = S * sqrtT * this.normalPDF(d1);
      if (vega < 1e-10) break;
      sigma -= diff / vega;
      if (sigma <= 0) { sigma = 0.01; break; }
      if (sigma > 5)  { sigma = 5;    break; }
    }
    return sigma;
  }

  // ================================================================
  // GAMMA BLAST ALERT — Explosive move detection via Greek analysis
  // ================================================================

  /**
   * Core Gamma Blast detection.
   * A "Gamma Blast" occurs when ATM gamma is extremely high relative to
   * time-to-expiry, meaning small spot moves create massive delta swings
   * → explosive option price moves (the 5x-50x mechanism).
   *
   * @param {object} opts  Optional overrides { spotPrice, timeToExpiry, iv }
   * @returns {object}     { blastActive, blastLevel, score, greekRank, metrics, alert }
   */
  getGammaBlastAlert(opts = {}) {
    const spot = opts.spotPrice || this.spotPrice;
    const T    = opts.timeToExpiry || this.getTimeToExpiry();
    const baseIV = opts.iv || 0.15;
    const r    = 0.065;

    const atm = Math.round(spot / 100) * 100;
    const strikes = [atm - 200, atm - 100, atm, atm + 100, atm + 200];

    // Calculate full Greeks for the strike ladder
    const ladder = strikes.map(K => {
      const ceGreeks = this._rawGreeks(spot, K, T, r, baseIV, 'CE');
      const peGreeks = this._rawGreeks(spot, K, T, r, baseIV, 'PE');
      const cePrice  = this.blackScholesPrice(spot, K, T, r, baseIV, 'CE');
      const pePrice  = this.blackScholesPrice(spot, K, T, r, baseIV, 'PE');
      return { strike: K, isATM: K === atm, ce: ceGreeks, pe: peGreeks, cePrice, pePrice };
    });

    const atmData = ladder.find(l => l.isATM);
    const otm1CE = ladder.find(l => l.strike === atm + 100);
    const otm1PE = ladder.find(l => l.strike === atm - 100);

    // ----- Greek Point Ranking (0–100) -----
    const greekRank = this._computeGreekRank(atmData, otm1CE, otm1PE, T, baseIV, spot);

    // ----- Gamma Blast Level -----
    const blast = this._computeBlastLevel(atmData, T, baseIV, greekRank.total);

    // ----- Build alert -----
    const alert = this._buildBlastAlert(blast, greekRank, atmData, spot, atm);

    return {
      blastActive: blast.active,
      blastLevel:  blast.level,        // 'NUCLEAR' | 'EXTREME' | 'HIGH' | 'MODERATE' | 'LOW'
      blastScore:  blast.score,        // 0–100
      greekRank,                        // { total, breakdown: { gammaPower, deltaSweetSpot, thetaAccel, vegaEdge, gtrRatio } }
      metrics: {
        atmGamma:     atmData ? +atmData.ce.gamma.toFixed(6) : 0,
        atmDelta:     atmData ? +atmData.ce.delta.toFixed(4) : 0,
        atmTheta:     atmData ? +atmData.ce.theta.toFixed(4) : 0,
        atmVega:      atmData ? +atmData.ce.vega.toFixed(4) : 0,
        gammaPerDelta: atmData && atmData.ce.delta !== 0
          ? +(atmData.ce.gamma / Math.abs(atmData.ce.delta)).toFixed(6) : 0,
        gammaThetaRatio: atmData && atmData.ce.theta !== 0
          ? +Math.abs(atmData.ce.gamma / atmData.ce.theta).toFixed(4) : 0,
        timeToExpiry: +T.toFixed(6),
        iv: +(baseIV * 100).toFixed(2),
        spotToATMPct: +((Math.abs(spot - atm) / spot) * 100).toFixed(3)
      },
      ladder: ladder.map(l => ({
        strike: l.strike,
        isATM: l.isATM,
        cePrice:  +l.cePrice.toFixed(2),
        pePrice:  +l.pePrice.toFixed(2),
        ceGamma:  +l.ce.gamma.toFixed(6),
        ceDelta:  +l.ce.delta.toFixed(4),
        ceTheta:  +l.ce.theta.toFixed(4),
        peGamma:  +l.pe.gamma.toFixed(6),
        peDelta:  +l.pe.delta.toFixed(4),
        peTheta:  +l.pe.theta.toFixed(4)
      })),
      alert
    };
  }

  /**
   * Raw Greeks calculator (internal — avoids string formatting)
   */
  _rawGreeks(S, K, T, r, sigma, type) {
    if (T < 0.00001) T = 0.00001;
    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;
    const nd1 = this.normalPDF(d1);

    let delta, gamma, theta, vega;
    gamma = nd1 / (S * sigma * sqrtT);
    vega  = S * sqrtT * nd1;

    if (type === 'CE') {
      delta = this.normalCDF(d1);
      theta = -(S * nd1 * sigma) / (2 * sqrtT)
              - r * K * Math.exp(-r * T) * this.normalCDF(d2);
    } else {
      delta = this.normalCDF(d1) - 1;
      theta = -(S * nd1 * sigma) / (2 * sqrtT)
              + r * K * Math.exp(-r * T) * this.normalCDF(-d2);
    }
    theta /= 365; // per day

    return { delta, gamma, theta, vega };
  }

  /**
   * Greek Point Ranking — 5-dimension scoring system (0–100)
   *
   * Dimensions:
   *   1. Gamma Power (0-25)     — How explosive is gamma vs historical norm
   *   2. Delta Sweet Spot (0-20) — How close to 0.50 delta (maximum gamma zone)
   *   3. Theta Acceleration (0-20) — Theta decay speed (high = expiry pressure)
   *   4. Vega Edge (0-15)         — IV expansion potential
   *   5. GTR Ratio (0-20)         — Gamma-to-Theta ratio (burst potential vs cost)
   */
  _computeGreekRank(atm, otm1CE, otm1PE, T, iv, spot) {
    if (!atm) return { total: 0, grade: 'F', breakdown: {} };

    const gamma = Math.abs(atm.ce.gamma);
    const delta = Math.abs(atm.ce.delta);
    const theta = Math.abs(atm.ce.theta);
    const vega  = Math.abs(atm.ce.vega);

    // 1. GAMMA POWER (0-25)
    //    ATM gamma scales as 1/(S*σ*√T). For SENSEX ~75000, σ=15%, T=1day:
    //    baseline gamma ≈ 0.000003. On expiry day, can reach 0.00005+
    const gammaBaseline = 1 / (spot * iv * Math.sqrt(5 / 365)); // ~5-day gamma
    const gammaRatio = gamma / gammaBaseline;
    const gammaPower = Math.min(25, Math.round(gammaRatio * 8));

    // 2. DELTA SWEET SPOT (0-20)
    //    Perfect = 0.50 delta = maximum gamma exposure
    const deltaDeviation = Math.abs(delta - 0.5);
    const deltaSweetSpot = Math.max(0, Math.round(20 * (1 - deltaDeviation * 4)));

    // 3. THETA ACCELERATION (0-20)
    //    High theta = rapid time decay = expiry pressure = bigger moves
    const thetaPctOfPrice = theta / (atm.cePrice || 1) * 100;
    const thetaAccel = Math.min(20, Math.round(thetaPctOfPrice * 2));

    // 4. VEGA EDGE (0-15)
    //    Low IV + high vega = room for IV expansion
    const ivPct = iv * 100;
    const vegaEdge = ivPct < 12 ? 15 : ivPct < 18 ? 12 : ivPct < 25 ? 8 : ivPct < 35 ? 4 : 0;

    // 5. GTR — Gamma-to-Theta Ratio (0-20)
    //    High gamma relative to theta = burst potential exceeds decay cost
    const gtr = theta !== 0 ? gamma / theta : 0;
    const gtrRatio = Math.min(20, Math.round(Math.abs(gtr) * 500));

    const total = gammaPower + deltaSweetSpot + thetaAccel + vegaEdge + gtrRatio;
    const grade = total >= 85 ? 'S' : total >= 70 ? 'A' : total >= 55 ? 'B'
                : total >= 40 ? 'C' : total >= 25 ? 'D' : 'F';

    return {
      total,
      grade,
      breakdown: {
        gammaPower:     { score: gammaPower,     max: 25, label: 'Gamma Power' },
        deltaSweetSpot: { score: deltaSweetSpot, max: 20, label: 'Delta Sweet Spot' },
        thetaAccel:     { score: thetaAccel,     max: 20, label: 'Theta Acceleration' },
        vegaEdge:       { score: vegaEdge,       max: 15, label: 'Vega Edge' },
        gtrRatio:       { score: gtrRatio,       max: 20, label: 'GTR Ratio' }
      }
    };
  }

  /**
   * Determine Blast Level from gamma + time + rank
   */
  _computeBlastLevel(atm, T, iv, rankScore) {
    if (!atm) return { active: false, level: 'NONE', score: 0 };

    const gamma = Math.abs(atm.ce.gamma);
    const daysToExpiry = T * 365;

    // Gamma spike factor: how much gamma is amplified vs a 5-day baseline
    const baseline = 1 / (this.spotPrice * iv * Math.sqrt(5 / 365));
    const spikeFactor = gamma / baseline;

    // Blast score = weighted combination
    let score = 0;
    score += Math.min(40, spikeFactor * 12);          // Gamma spike (0-40)
    score += Math.min(30, rankScore * 0.3);            // Greek rank contribution (0-30)
    score += daysToExpiry <= 0.5 ? 30 : daysToExpiry <= 1 ? 20 : daysToExpiry <= 2 ? 10 : 0; // Time pressure (0-30)

    score = Math.min(100, Math.round(score));

    let level, active;
    if (score >= 90) { level = 'NUCLEAR'; active = true; }
    else if (score >= 75) { level = 'EXTREME'; active = true; }
    else if (score >= 55) { level = 'HIGH'; active = true; }
    else if (score >= 35) { level = 'MODERATE'; active = false; }
    else { level = 'LOW'; active = false; }

    return { active, level, score };
  }

  /**
   * Build human-readable alert object
   */
  _buildBlastAlert(blast, greekRank, atm, spot, atmStrike) {
    const emojis = {
      NUCLEAR:  '☢️',
      EXTREME:  '🔥',
      HIGH:     '⚡',
      MODERATE: '📊',
      LOW:      '💤'
    };

    const descriptions = {
      NUCLEAR:  'GAMMA NUCLEAR — Maximum explosion zone! ATM gamma at peak, any directional move → massive option price swing.',
      EXTREME:  'GAMMA EXTREME — Very high gamma concentration. Strike selection critical. 5x-50x potential on strong directional burst.',
      HIGH:     'GAMMA HIGH — Elevated gamma exposure. Good conditions for momentum-based expiry trades.',
      MODERATE: 'GAMMA MODERATE — Normal gamma levels. Standard risk/reward profile.',
      LOW:      'GAMMA LOW — Gamma exposure minimal. Options less sensitive to spot moves.'
    };

    return {
      emoji:       emojis[blast.level] || '📊',
      title:       `${emojis[blast.level]} ${blast.level}`,
      description: descriptions[blast.level],
      action:      blast.active
        ? `ATM ${atmStrike} zone active — gamma = ${atm ? atm.ce.gamma.toFixed(6) : '?'}, Greek Rank ${greekRank.total}/100 (${greekRank.grade})`
        : 'No blast conditions detected. Wait for closer-to-expiry or stronger gamma buildup.',
      grade:       greekRank.grade,
      timestamp:   new Date().toISOString()
    };
  }

  /**
   * Static / backtest-compatible gamma blast calculation
   * Uses raw inputs (no live chain needed)
   */
  static gammaBlastScore({ spot, strike, timeToExpiry, iv, type = 'CE' }) {
    const r = 0.065;
    const T = Math.max(timeToExpiry, 0.00001);
    const sqrtT = Math.sqrt(T);
    const sigma = iv;
    const S = spot;
    const K = strike;

    const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
    const nd1 = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);

    const gamma = nd1 / (S * sigma * sqrtT);
    const delta = type === 'CE'
      ? (1 / (1 + Math.exp(-1.7 * d1)))   // fast CDF approx
      : (1 / (1 + Math.exp(-1.7 * d1))) - 1;
    const theta = (-(S * nd1 * sigma) / (2 * sqrtT)) / 365;
    const vega  = S * sqrtT * nd1;

    // Gamma power measurement
    const gammaBaseline = 1 / (S * sigma * Math.sqrt(5 / 365));
    const gammaSpikeRatio = gamma / gammaBaseline;

    // Greek rank (simplified for backtest speed)
    const deltaScore = Math.max(0, Math.round(20 * (1 - Math.abs(Math.abs(delta) - 0.5) * 4)));
    const gammaScore = Math.min(25, Math.round(gammaSpikeRatio * 8));
    const thetaScore = Math.min(20, Math.round(Math.abs(theta / (S * 0.001)) * 200));
    const ivScore    = iv * 100 < 15 ? 15 : iv * 100 < 20 ? 10 : iv * 100 < 30 ? 5 : 0;
    const gtr        = theta !== 0 ? Math.abs(gamma / theta) : 0;
    const gtrScore   = Math.min(20, Math.round(gtr * 500));

    const rankTotal = gammaScore + deltaScore + thetaScore + ivScore + gtrScore;
    const grade = rankTotal >= 85 ? 'S' : rankTotal >= 70 ? 'A' : rankTotal >= 55 ? 'B'
                : rankTotal >= 40 ? 'C' : rankTotal >= 25 ? 'D' : 'F';

    // Blast score
    const daysToExpiry = T * 365;
    let blastScore = 0;
    blastScore += Math.min(40, gammaSpikeRatio * 12);
    blastScore += Math.min(30, rankTotal * 0.3);
    blastScore += daysToExpiry <= 0.5 ? 30 : daysToExpiry <= 1 ? 20 : daysToExpiry <= 2 ? 10 : 0;
    blastScore = Math.min(100, Math.round(blastScore));

    let blastLevel;
    if (blastScore >= 90) blastLevel = 'NUCLEAR';
    else if (blastScore >= 75) blastLevel = 'EXTREME';
    else if (blastScore >= 55) blastLevel = 'HIGH';
    else if (blastScore >= 35) blastLevel = 'MODERATE';
    else blastLevel = 'LOW';

    return {
      blastScore,
      blastLevel,
      greekRank: rankTotal,
      greekGrade: grade,
      gamma: +gamma.toFixed(8),
      delta: +Math.abs(delta).toFixed(4),
      theta: +theta.toFixed(6),
      vega:  +vega.toFixed(4),
      gammaSpikeRatio: +gammaSpikeRatio.toFixed(3),
      breakdown: {
        gammaPower: gammaScore,
        deltaSweetSpot: deltaScore,
        thetaAccel: thetaScore,
        vegaEdge: ivScore,
        gtrRatio: gtrScore
      }
    };
  }
}

module.exports = OptionAnalyzer;
