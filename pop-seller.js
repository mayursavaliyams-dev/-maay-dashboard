/**
 * POP SELLER — Antigravity Pro
 *
 * Real 100% PoP scanner using Black-Scholes delta.
 *
 * PoP for a SOLD option = 1 - |delta|
 * Far-OTM strikes (delta → 0) = PoP → 100%
 *
 * Since chain API only returns ATM±10, we GENERATE far-OTM strikes
 * and compute BS delta ourselves using spot/strike/IV/DTE.
 *
 * SAFETY: Paper-only by default. Live hard-gated.
 */

const POP_LIVE_ENABLED = process.env.POP_LIVE_ENABLED === 'true';

// ── Lot sizes ─────────────────────────────────────────────────────────────────
const LOT_SIZE = { NIFTY: 75, BANKNIFTY: 35, SENSEX: 20, FINNIFTY: 65, BANKEX: 30 };
function lotSize(inst) { return LOT_SIZE[inst] || 75; }

// ── Strike step ───────────────────────────────────────────────────────────────
const STEP = { NIFTY: 50, BANKNIFTY: 100, SENSEX: 100, FINNIFTY: 50, BANKEX: 100 };
function strikeStep(inst) { return STEP[inst] || 50; }

// ── Days to next weekly expiry ────────────────────────────────────────────────
// NIFTY = Thursday, SENSEX = Tuesday
function daysToExpiry(inst) {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const dow = ist.getDay(); // 0=Sun..6=Sat
  const hour = ist.getHours();
  const targetDay = (inst === 'SENSEX' || inst === 'BANKEX') ? 2 : 4; // Tue or Thu
  let days = (targetDay - dow + 7) % 7;
  // If today is expiry day and past 3:30PM, use next week
  if (days === 0 && hour >= 15) days = 7;
  // Minimum 0.5 day (half-day buffer)
  const dte = Math.max(days + (1 - hour / 24), 0.5);
  return dte / 365; // in years
}

// ── Black-Scholes helpers ─────────────────────────────────────────────────────
function normalCDF(x) {
  const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return 0.5 * (1 + sign * y);
}

function bsDelta(S, K, T, sigma, type) {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return type === 'CE' ? 1 : -1;
  const r = 0.065; // 6.5% risk-free
  const d1 = (Math.log(S/K) + (r + sigma*sigma/2)*T) / (sigma*Math.sqrt(T));
  return type === 'CE' ? normalCDF(d1) : normalCDF(d1) - 1;
}

/**
 * Compute real PoP% using BS delta.
 * Uses IV from chain if available, else falls back to ATM IV estimate.
 */
function realPoP(S, K, T, iv, type) {
  // iv from chain may be % string or decimal — normalize
  let sigma = Number(iv);
  if (!sigma || !isFinite(sigma) || isNaN(sigma)) sigma = 0;
  if (sigma > 5) sigma = sigma / 100; // convert % to decimal
  if (sigma <= 0) {
    // Fallback: estimate IV from moneyness (typical NIFTY: 12-18% ATM)
    const moneyness = Math.abs(K - S) / S;
    sigma = 0.14 + moneyness * 0.5; // ~14% ATM, rises for OTM
  }
  sigma = Math.max(0.05, Math.min(sigma, 2.0)); // clamp 5%–200%
  const delta = bsDelta(S, K, T, sigma, type);
  const pop = (1 - Math.abs(delta)) * 100;
  return { pop: +pop.toFixed(1), delta: +delta.toFixed(4), sigma: +(sigma*100).toFixed(1), T };
}

/**
 * Generate far-OTM strike range beyond what chain provides.
 * Returns strikes from ATM±range in step increments.
 */
function generateStrikes(spot, inst, rangePercent = 10) {
  const step = strikeStep(inst);
  const atm  = Math.round(spot / step) * step;
  const lo   = Math.round(spot * (1 - rangePercent/100) / step) * step;
  const hi   = Math.round(spot * (1 + rangePercent/100) / step) * step;
  const strikes = [];
  for (let k = lo; k <= hi; k += step) strikes.push(k);
  return { strikes, atm };
}

/**
 * Scan for high-PoP sell candidates.
 * Merges chain LTP/IV data with BS-computed PoP for far-OTM strikes.
 *
 * @param {object} opts
 *   inst, spot, chainStrikes (from API), minPoP (default 90), atmIV
 */
function scanPoP({ inst='NIFTY', spot, chainStrikes=[], minPoP=90, maxResults=30, atmIV=null }) {
  const T    = daysToExpiry(inst);
  const lot  = lotSize(inst);
  const step = strikeStep(inst);
  const atm  = Math.round(spot / step) * step;

  // Build IV map from chain (strike → {ceIV, peIV})
  const ivMap = {};
  let sumIV = 0, ivCount = 0;
  for (const row of chainStrikes) {
    const k = Number(row.strike);
    const ceIV = Number(row.ce?.iv) || 0;
    const peIV = Number(row.pe?.iv) || 0;
    ivMap[k] = { ceIV, peIV };
    if (ceIV > 0 && ceIV < 200) { sumIV += ceIV > 5 ? ceIV/100 : ceIV; ivCount++; }
    if (peIV > 0 && peIV < 200) { sumIV += peIV > 5 ? peIV/100 : peIV; ivCount++; }
  }
  // ATM IV estimate
  const estimatedATMIV = atmIV || (ivCount > 0 ? sumIV/ivCount : 0.14);

  // Build LTP map
  const ltpMap = {};
  for (const row of chainStrikes) {
    ltpMap[Number(row.strike)] = { ceLtp: Number(row.ce?.ltp)||0, peLtp: Number(row.pe?.ltp)||0 };
  }

  // Generate strike range ±8% to include near-ATM high-premium strikes
  const { strikes: allStrikes } = generateStrikes(spot, inst, 8);
  const out = [];

  for (const K of allStrikes) {
    const ivData = ivMap[K] || {};
    const ltpData = ltpMap[K] || {};

    // SELL CALL — OTM when K > spot
    if (K > spot) {
      const iv = ivData.ceIV || estimatedATMIV;
      const { pop, delta, sigma } = realPoP(spot, K, T, iv, 'CE');
      if (pop >= minPoP) {
        const ltp = ltpData.ceLtp || estimatePremium(spot, K, T, sigma/100, 'CE');
        if (ltp > 0.5) {
          out.push({
            side:'SELL_CE', strike:K, type:'CE',
            premium: +ltp.toFixed(2),
            pop, delta, iv: +(sigma).toFixed(1),
            dte: +(T*365).toFixed(1),
            distance: +(K-spot).toFixed(0),
            distancePct: +(((K-spot)/spot)*100).toFixed(2),
            maxProfit: +(ltp*lot).toFixed(0),
            breakeven: +(K+ltp).toFixed(2),
            lot, fromChain: !!ltpData.ceLtp
          });
        }
      }
    }

    // SELL PUT — OTM when K < spot
    if (K < spot) {
      const iv = ivData.peIV || estimatedATMIV;
      const { pop, delta, sigma } = realPoP(spot, K, T, iv, 'PE');
      if (pop >= minPoP) {
        const ltp = ltpData.peLtp || estimatePremium(spot, K, T, sigma/100, 'PE');
        if (ltp > 0.5) {
          out.push({
            side:'SELL_PE', strike:K, type:'PE',
            premium: +ltp.toFixed(2),
            pop, delta: +Math.abs(delta).toFixed(4), iv: +(sigma).toFixed(1),
            dte: +(T*365).toFixed(1),
            distance: +(spot-K).toFixed(0),
            distancePct: +(((spot-K)/spot)*100).toFixed(2),
            maxProfit: +(ltp*lot).toFixed(0),
            breakeven: +(K-ltp).toFixed(2),
            lot, fromChain: !!ltpData.peLtp
          });
        }
      }
    }
  }

  // Sort: highest PoP first, then nearest strike (most premium)
  out.sort((a,b) => b.pop - a.pop || a.distance - b.distance);
  return out.slice(0, maxResults);
}

/**
 * Estimate BS option premium when LTP not available from chain.
 */
function estimatePremium(S, K, T, sigma, type) {
  if (T <= 0 || sigma <= 0) return 0;
  const r = 0.065;
  const d1 = (Math.log(S/K) + (r+sigma*sigma/2)*T) / (sigma*Math.sqrt(T));
  const d2 = d1 - sigma*Math.sqrt(T);
  const disc = Math.exp(-r*T);
  if (type === 'CE') return Math.max(0, S*normalCDF(d1) - K*disc*normalCDF(d2));
  return Math.max(0, K*disc*normalCDF(-d2) - S*normalCDF(-d1));
}

/**
 * Build Iron Condor from best equidistant CE+PE candidates.
 */
function buildIronCondor({ inst, spot, chainStrikes, minPoP=90, atmIV=null }) {
  const cands = scanPoP({ inst, spot, chainStrikes, minPoP, maxResults:60, atmIV });
  // Prefer nearest OTM on each side (most premium, still high PoP)
  const bestCE = cands.filter(c=>c.side==='SELL_CE').sort((a,b)=>a.distance-b.distance)[0];
  const bestPE = cands.filter(c=>c.side==='SELL_PE').sort((a,b)=>a.distance-b.distance)[0];
  if (!bestCE || !bestPE) return null;

  const lot    = lotSize(inst);
  const credit = +(bestCE.premium + bestPE.premium).toFixed(2);
  const combPoP = +((bestCE.pop/100)*(bestPE.pop/100)*100).toFixed(1);
  const T      = daysToExpiry(inst);

  return {
    inst, spot,
    legs:[
      { action:'SELL', type:'CE', strike:bestCE.strike, premium:bestCE.premium, pop:bestCE.pop, delta:bestCE.delta },
      { action:'SELL', type:'PE', strike:bestPE.strike, premium:bestPE.premium, pop:bestPE.pop, delta:bestPE.delta }
    ],
    credit, maxProfit: +(credit*lot).toFixed(0),
    combinedPoP: combPoP,
    upperBreakeven: +(bestCE.strike + credit).toFixed(2),
    lowerBreakeven: +(bestPE.strike - credit).toFixed(2),
    daysToExpiry: +(T*365).toFixed(1),
    lot
  };
}

/**
 * Payoff curve for a set of legs.
 */
function payoffCurve(legs, spot, lot, points=41) {
  const lo=spot*0.96, hi=spot*1.04, step=(hi-lo)/(points-1);
  return Array.from({length:points}, (_,i) => {
    const px = lo+step*i;
    const pnl = legs.reduce((s,leg) => {
      const sign = leg.action==='SELL' ? 1 : -1;
      const intr = leg.type==='CE' ? Math.max(0,px-leg.strike) : Math.max(0,leg.strike-px);
      return s + sign*(leg.premium-intr);
    }, 0);
    return { spot:+px.toFixed(2), pnl:+(pnl*lot).toFixed(0) };
  });
}

// ── Paper position book ───────────────────────────────────────────────────────
const _book = [];
let _idSeq = 1;

function sellPoP({ inst, side, strike, type, premium, lot, pop, tradeMode='paper', confirmLive=false }) {
  const wantLive = tradeMode === 'live';
  if (wantLive && (!POP_LIVE_ENABLED || !confirmLive)) {
    return { ok:false, reason:'LIVE blocked — POP_LIVE_ENABLED=true + confirmLive required. (IC backtest 0/26 wins — validate paper first.)' };
  }
  const pos = {
    id: _idSeq++, inst, side, strike, type,
    premium: +Number(premium).toFixed(2),
    lot: lot || lotSize(inst),
    pop: pop != null ? +Number(pop).toFixed(1) : null,
    creditCollected: +(Number(premium)*(lot||lotSize(inst))).toFixed(0),
    openAt: new Date().toISOString(),
    mode: wantLive ? 'LIVE' : 'PAPER',
    status: 'OPEN'
  };
  _book.push(pos);
  return { ok:true, position:pos };
}

function closePoP(id, exitPremium=0) {
  const pos = _book.find(p=>p.id===Number(id)&&p.status==='OPEN');
  if (!pos) return { ok:false, reason:'not found / already closed' };
  pos.status = 'CLOSED';
  pos.exitPremium = +Number(exitPremium).toFixed(2);
  pos.exitAt = new Date().toISOString();
  pos.pnl = +((pos.premium - pos.exitPremium)*pos.lot).toFixed(0);
  return { ok:true, position:pos };
}

function getBook() { return _book.map(p=>({...p})); }

function popStatus() {
  const open = _book.filter(p=>p.status==='OPEN');
  return {
    liveEnabled: POP_LIVE_ENABLED,
    openPositions: open.length,
    totalCredit: open.reduce((s,p)=>s+(p.creditCollected||0),0),
    book: getBook()
  };
}

module.exports = {
  scanPoP, buildIronCondor, payoffCurve,
  sellPoP, closePoP, getBook, popStatus,
  lotSize, popFromDelta: (d) => +(1-Math.abs(Number(d)||0))*100,
  daysToExpiry, realPoP, bsDelta
};
