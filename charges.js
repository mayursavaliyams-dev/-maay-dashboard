// charges.js — Indian index-options round-trip cost model.
//
// Single source of truth for transaction costs so the pre-trade charge-aware
// guard and any P&L accounting use the SAME math (no divergence). Rates are the
// standard NSE/BSE equity-options schedule (premium-based), tunable via .env.
//
// A "round trip" = one BUY leg + one SELL leg on a long-option position.
//
// All rates are applied on the PREMIUM TURNOVER (price × quantity), which is how
// option charges actually work in India — NOT on notional/strike value.

// ── Default rates (override via .env) ──────────────────────────────
// Brokerage: flat per executed order (₹20 typical discount broker), charged
//   on BOTH legs → ₹40 round trip by default.
const BROKERAGE_PER_ORDER = parseFloat(process.env.CHARGE_BROKERAGE_PER_ORDER || 20);
// STT: 0.1% on the SELL-side premium only (options, as of current schedule).
const STT_SELL_PCT        = parseFloat(process.env.CHARGE_STT_SELL_PCT        || 0.1) / 100;
// Exchange transaction charge: ~0.03503% (NSE options) on premium, both sides.
const EXCH_TXN_PCT        = parseFloat(process.env.CHARGE_EXCH_TXN_PCT        || 0.03503) / 100;
// SEBI turnover fee: ₹10 per crore = 0.0001% on premium, both sides.
const SEBI_PCT            = parseFloat(process.env.CHARGE_SEBI_PCT            || 0.0001) / 100;
// Stamp duty: 0.003% on the BUY-side premium only.
const STAMP_BUY_PCT       = parseFloat(process.env.CHARGE_STAMP_BUY_PCT       || 0.003) / 100;
// GST: 18% on (brokerage + exchange txn + SEBI).
const GST_PCT             = parseFloat(process.env.CHARGE_GST_PCT             || 18) / 100;

/**
 * Round-trip transaction cost for a long-option position.
 * @param {number} entryPrice  premium paid per unit (buy)
 * @param {number} exitPrice   premium received per unit (sell). Defaults to entryPrice
 *                             when unknown (pre-trade estimate uses entry as proxy).
 * @param {number} quantity    total units (lots × lotSize)
 * @returns {{ total:number, breakdown:object }}
 */
function roundTripCharges(entryPrice, exitPrice, quantity) {
  const buyTurnover  = Math.max(0, entryPrice) * quantity;
  const sellTurnover = Math.max(0, (exitPrice ?? entryPrice)) * quantity;

  const brokerage = BROKERAGE_PER_ORDER * 2;                 // both legs
  const stt       = sellTurnover * STT_SELL_PCT;             // sell only
  const exchTxn   = (buyTurnover + sellTurnover) * EXCH_TXN_PCT;
  const sebi      = (buyTurnover + sellTurnover) * SEBI_PCT;
  const stamp     = buyTurnover * STAMP_BUY_PCT;             // buy only
  const gst       = (brokerage + exchTxn + sebi) * GST_PCT;

  const total = brokerage + stt + exchTxn + sebi + stamp + gst;
  return {
    total: +total.toFixed(2),
    breakdown: {
      brokerage: +brokerage.toFixed(2),
      stt:       +stt.toFixed(2),
      exchTxn:   +exchTxn.toFixed(2),
      sebi:      +sebi.toFixed(4),
      stamp:     +stamp.toFixed(2),
      gst:       +gst.toFixed(2)
    }
  };
}

module.exports = { roundTripCharges };
