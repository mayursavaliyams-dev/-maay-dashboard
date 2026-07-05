// ============================================================================
//  trade-planner.js — Signal-Engine Roadmap · Phase 4 (signal → structure → size)
//
//  A signal is worthless until it maps to the RIGHT trade at the RIGHT size.
//  Our real-data backtests are blunt: directional BUYING has no edge (PF 0.94),
//  SELLING has the edge (~80-91% win). So this planner NEVER emits a naked long
//  option — every view becomes a defined-risk structure:
//
//    regime SELL-ON + neutral direction  → IRON CONDOR (symmetric premium sell)
//    regime SELL-ON + directional skew    → CREDIT SPREAD on the safer side
//    regime STAND-DOWN + strong direction → DEBIT SPREAD (defined-risk directional)
//    otherwise                            → NO TRADE (stand down = the edge)
//
//  Strikes come from the EXPECTED MOVE (ATM straddle), not a fixed %. Size is
//  fractional-Kelly × IV-scale, capped by a hard risk-%-of-capital limit.
//
//  Pure & unit-tested. The server assembles inputs (regime, master signal, vol
//  context expected-move, GEX skew) and calls planTrade(). See docs/SIGNAL-ENGINE-ROADMAP.md
// ============================================================================
'use strict';
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v, d = 2) => +(+v).toFixed(d);
const roundToStep = (v, step) => Math.round(v / step) * step;

// Half-Kelly fraction from win-rate p and payoff b (avgWin/avgLoss).
// Kelly f* = p - (1-p)/b ; we use HALF Kelly (survival > growth), floored at 0.
function halfKelly(winRate, payoff) {
  const p = clamp(winRate, 0, 1), b = Math.max(payoff, 0.05);
  const f = p - (1 - p) / b;
  return clamp(f * 0.5, 0, 0.5);
}

/**
 * @param {object} i
 *   regime      'SELL-ON'|'REDUCE'|'STAND-DOWN'|null
 *   regimeScore 0-100
 *   decision    'BUY'|'SELL'|'HOLD'  (direction head)
 *   probability 0-100
 *   skew        -100..+100  (>0 = upward tilt; from GEX/OI — Phase 2)
 *   ivp         0-100
 *   emPts       expected move in points (ATM straddle × 0.85), > 0
 *   spot, step  index level + strike step
 *   vix         India VIX
 *   capital     account size (₹)
 *   riskPct     max fraction of capital at risk per trade (e.g. 0.05)
 *   lotSize     contract multiplier
 *   dte         days to expiry
 *   sellStats   {winRate, payoff} for Kelly on the selling edge
 *   minProb     directional probability floor for a debit spread
 */
function planTrade(i = {}) {
  const spot = Number(i.spot) || 0, step = Number(i.step) || 50;
  const em = Number(i.emPts) || 0;
  const ivp = i.ivp != null ? Number(i.ivp) : null;
  const skew = Number(i.skew) || 0;
  const prob = Number(i.probability) || 0;
  const decision = i.decision || 'HOLD';
  const regime = i.regime || null;
  const minProb = Number(i.minProb) || 65;
  const skewGate = Number(i.skewGate) || 30;             // |skew| beyond this = directional tilt
  if (!(spot > 0) || !(em > 0)) return { ok: false, structure: 'NO_TRADE', reason: 'no spot / expected-move' };

  const atm = roundToStep(spot, step);
  const s1 = Math.max(step, roundToStep(em, step));       // ~1 expected move
  const wing = s1;                                        // wings one EM beyond the shorts

  const mk = (type, side, strike) => ({ type, side, strike });
  let structure = 'NO_TRADE', legs = [], rationale = '', dir = null;

  const sellOn = regime === 'SELL-ON', reduce = regime === 'REDUCE', standDown = regime === 'STAND-DOWN' || regime == null;

  if (sellOn || reduce) {
    if (Math.abs(skew) < skewGate) {
      // symmetric premium sell — iron condor
      structure = 'IRON_CONDOR';
      legs = [ mk('CE', 'SELL', atm + s1), mk('PE', 'SELL', atm - s1), mk('CE', 'BUY', atm + s1 + wing), mk('PE', 'BUY', atm - s1 - wing) ];
      rationale = `regime ${regime} + neutral skew → sell both sides ~1 EM out, wings capped`;
    } else if (skew > 0) {
      // market tilts UP → the PUT side is safer to sell → BULL PUT credit spread
      structure = 'CREDIT_SPREAD_PUT'; dir = 'bullish';
      legs = [ mk('PE', 'SELL', atm - s1), mk('PE', 'BUY', atm - s1 - wing) ];
      rationale = `regime ${regime} + upward skew (${skew}) → sell the put side (bull put spread)`;
    } else {
      // market tilts DOWN → the CALL side is safer to sell → BEAR CALL credit spread
      structure = 'CREDIT_SPREAD_CALL'; dir = 'bearish';
      legs = [ mk('CE', 'SELL', atm + s1), mk('CE', 'BUY', atm + s1 + wing) ];
      rationale = `regime ${regime} + downward skew (${skew}) → sell the call side (bear call spread)`;
    }
  } else if (standDown && (decision === 'BUY' || decision === 'SELL') && prob >= minProb) {
    // wrong regime to SELL, but strong directional confluence → DEFINED-RISK debit spread
    if (decision === 'BUY') { structure = 'DEBIT_SPREAD_CALL'; dir = 'bullish'; legs = [ mk('CE', 'BUY', atm), mk('CE', 'SELL', atm + s1) ]; }
    else { structure = 'DEBIT_SPREAD_PUT'; dir = 'bearish'; legs = [ mk('PE', 'BUY', atm), mk('PE', 'SELL', atm - s1) ]; }
    rationale = `regime STAND-DOWN (no sell) but ${decision} ${prob}% ≥ ${minProb}% → defined-risk debit spread (never a naked buy)`;
  } else {
    return { ok: true, structure: 'NO_TRADE', spot: round(spot), atm, em: round(em),
      reason: standDown ? 'stand-down regime + no strong directional edge — the edge is patience' : 'no actionable setup', regime, skew, decision, probability: prob };
  }

  // ── sizing: half-Kelly × IV-scale, capped by risk-%-of-capital ──
  const isSpread = structure.startsWith('CREDIT') || structure.startsWith('DEBIT');
  const defensiveWidth = (isSpread ? wing : wing);        // max loss per unit ≈ spread width − credit (approx width)
  const maxLossPtsPerLot = defensiveWidth;                // conservative: full wing width per lot
  const capital = Number(i.capital) || 700000, riskPct = Number(i.riskPct) || 0.05, lotSize = Number(i.lotSize) || 1;
  const riskBudget = capital * riskPct;
  const perLotRisk = Math.max(1, maxLossPtsPerLot * lotSize);
  let baseLots = Math.floor(riskBudget / perLotRisk);
  const kelly = halfKelly((i.sellStats?.winRate ?? 0.84), (i.sellStats?.payoff ?? 0.86));
  const ivScale = ivp != null ? clamp(0.6 + (ivp / 100) * 0.8, 0.6, 1.4) : 1;  // richer premium → a touch bigger
  const regimeScale = reduce ? 0.5 : 1;                   // half size in the REDUCE regime
  let lots = Math.max(1, Math.round(baseLots * kelly * ivScale * regimeScale));
  lots = clamp(lots, 1, Number(i.maxLots) || 10);

  return {
    ok: true, structure, dir, spot: round(spot), atm, step, em: round(em), regime, regimeScore: i.regimeScore,
    decision, probability: prob, skew, ivp,
    legs, strikes: legs.map(l => `${l.strike}${l.type}`),
    sizing: { lots, kellyFraction: round(kelly, 3), ivScale: round(ivScale, 2), regimeScale, perLotRiskPts: round(perLotRisk / lotSize), riskBudget: Math.round(riskBudget) },
    rationale,
    disclaimer: 'Defined-risk only — never a naked long option (buying has no edge here). Paper/educational, not advice.',
  };
}

module.exports = { planTrade, halfKelly, roundToStep };
