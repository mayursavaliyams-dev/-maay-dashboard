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

// ── Contract metadata: the Instrument Registry is the single source of truth ───
//
// MIGRATION C1c-3 (2026-07-09). This module previously declared:
//
//   const LOT_SIZE = { NIFTY: 75, BANKNIFTY: 35, SENSEX: 20, FINNIFTY: 65, BANKEX: 30 };
//   function lotSize(inst) { return LOT_SIZE[inst] || 75; }
//   const STEP     = { NIFTY: 50, BANKNIFTY: 100, SENSEX: 100, FINNIFTY: 50, BANKEX: 100 };
//   function strikeStep(inst) { return STEP[inst] || 50; }
//
// The broker contract master (GET /v2/option/contract, re-queried 2026-07-09) reports
// NIFTY 65, BANKNIFTY 30, SENSEX 20, FINNIFTY 60, BANKEX 30. Because every rupee figure
// this module emits is `premium × lot`, the wrong constants overstated maxProfit,
// creditCollected and realised paper P&L by +15.4% (NIFTY), +16.7% (BANKNIFTY) and
// +8.3% (FINNIFTY). The `|| 75` fallback priced ANY unknown symbol at 75 — MIDCPNIFTY,
// whose true lot is 120, would have been off by −37.5% with no warning.
//
// There is now NO fallback. An instrument the registry does not know, or that ships
// `tradingEnabled:false`, yields `null` — and every caller REFUSES rather than guesses.
// FINNIFTY / BANKEX / MIDCPNIFTY are known to the registry but disabled by default;
// enable one explicitly with `<INST>_TRADING_ENABLED=true` and it will use the
// broker-verified lot, never the old constant.
const instrumentRegistry = require('./instrument-registry.js');

/** Contract lot size, or null when the instrument is unknown/disabled. Never guesses. */
function lotSize(inst) { return instrumentRegistry.lotSize(inst); }

/** Strike interval, or null when the instrument is unknown/disabled. Never guesses. */
function strikeStep(inst) { return instrumentRegistry.step(inst); }

// ── Time to expiry ────────────────────────────────────────────────────────────
//
// MIGRATION C1c-3a (2026-07-09). This function previously read:
//
//   const targetDay = (inst === 'SENSEX' || inst === 'BANKEX') ? 2 : 4;  // Tue or Thu
//
// i.e. "NIFTY expires Thursday, SENSEX expires Tuesday". The broker contract master says
// the exact opposite: NIFTY's expiries fall on TUESDAYS (2026-07-14, -21, -28) and
// SENSEX's on THURSDAYS (2026-07-09, -16, -23, -30). The two were SWAPPED.
//
// Worse, it assumed a WEEKLY expiry for every instrument. BANKNIFTY, FINNIFTY,
// MIDCPNIFTY and BANKEX are MONTHLY-only (post-SEBI single-weekly-per-exchange), so
// their DTE was capped at 8 days when the truth was ~19. Understated T shrinks |delta|,
// which INFLATES the reported PoP — every position looked safer than it was.
//
// T feeds Black-Scholes, so this corrupted every delta, every PoP, every premium
// estimate and every iron-condor breakeven this module produced.
//
// The expiry calendar now lives in the Instrument Registry, derived from the broker's
// own expiry lists: NSE instruments expire on a Tuesday, BSE on a Thursday; weekly
// instruments take the next such weekday, monthly-only take the LAST of the month.
// Contracts stop trading at 15:30 IST.

/** Time to expiry in years. null when the instrument is unknown/disabled. */
function daysToExpiry(inst) { return instrumentRegistry.timeToExpiryYears(inst); }

// ── Black-Scholes helpers ─────────────────────────────────────────────────────
function normalCDF(x) {
  const a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429, p=0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x);
  return 0.5 * (1 + sign * y);
}

const RISK_FREE = 0.065; // 6.5%

/**
 * Black-Scholes delta.
 *
 * MIGRATION C1c-3b (2026-07-09). The degenerate branch previously read:
 *
 *     if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return type === 'CE' ? 1 : -1;
 *
 * which returns |delta| = 1 for EVERY option, ignoring moneyness. Since
 * PoP = (1 − |delta|) × 100, a deep-OTM call at expiry reported delta 1 → PoP 0%,
 * when the truth is delta ≈ 0 → PoP ≈ 100%. Exactly inverted, and inverted in the
 * dangerous direction only for the ITM case (a certain loser shown as a certain winner
 * would be worse, but the OTM case hid genuinely safe strikes).
 *
 * At T = 0 the option's delta IS its expiry payoff slope: a call is worth 1 unit of
 * spot exposure iff it finishes in the money. With sigma = 0 the underlying is
 * deterministic, so the same rule applies to the forward S·e^(rT). Exactly at the money
 * the slope is undefined; 0.5 is the conventional limit and the only value that keeps
 * put-call delta parity (Δcall − Δput = 1) intact.
 */
function bsDelta(S, K, T, sigma, type) {
  if (!(S > 0) || !(K > 0)) return 0;                 // nonsensical inputs → no exposure
  if (T <= 0 || sigma <= 0) {
    const fwd = T > 0 ? S * Math.exp(RISK_FREE * T) : S;   // sigma=0 ⇒ deterministic forward
    const itm = fwd > K ? 1 : fwd < K ? 0 : 0.5;           // ATM: conventional 0.5
    return type === 'CE' ? itm : itm - 1;                  // preserves Δcall − Δput = 1
  }
  const d1 = (Math.log(S/K) + (RISK_FREE + sigma*sigma/2)*T) / (sigma*Math.sqrt(T));
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
  if (!step) return { strikes: [], atm: null };   // C1c-3: unknown/disabled → refuse, never guess
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
  // C1c-3: an unknown or trading-disabled instrument has no verified contract size.
  // Emitting `premium × 75` for it would be a fabricated rupee figure. Return nothing.
  if (!lot || !step) return [];
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
  const lot = lotSize(inst);
  if (!lot) return null;                          // C1c-3: unknown/disabled → refuse, never guess

  const cands = scanPoP({ inst, spot, chainStrikes, minPoP, maxResults:60, atmIV });
  // Prefer nearest OTM on each side (most premium, still high PoP)
  const bestCE = cands.filter(c=>c.side==='SELL_CE').sort((a,b)=>a.distance-b.distance)[0];
  const bestPE = cands.filter(c=>c.side==='SELL_PE').sort((a,b)=>a.distance-b.distance)[0];
  if (!bestCE || !bestPE) return null;

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
  // C1c-3: server.js:4170 passes `popSeller.lotSize(inst)` straight in. That is now null
  // for an unknown/disabled instrument. Multiplying by null would silently yield a
  // flat zero payoff curve — a plausible-looking lie. Return nothing instead.
  const L = Number(lot);
  if (!Number.isFinite(L) || L <= 0) return [];
  lot = L;
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
  // C1c-3: resolve the contract size before opening anything. `creditCollected` and the
  // eventual `pnl` are both `× lot`, so an unverified lot fabricates every rupee figure
  // on this position for the rest of its life.
  const resolvedLot = Number(lot) > 0 ? Number(lot) : lotSize(inst);
  if (!resolvedLot) {
    return { ok:false, reason:`No verified contract size for ${inst}. The Instrument Registry does not know it, or it ships tradingEnabled:false. Set ${String(inst||'').toUpperCase()}_TRADING_ENABLED=true to opt in — the registry will supply the broker-verified lot.` };
  }
  const pos = {
    id: _idSeq++, inst, side, strike, type,
    premium: +Number(premium).toFixed(2),
    lot: resolvedLot,
    pop: pop != null ? +Number(pop).toFixed(1) : null,
    creditCollected: +(Number(premium)*resolvedLot).toFixed(0),
    lotSource: Number(lot) > 0 ? 'caller-supplied' : 'instrument-registry',
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
