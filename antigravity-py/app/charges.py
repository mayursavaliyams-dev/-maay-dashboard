"""
Indian index-options F&O charges. ALWAYS net these (plus slippage) out of P&L —
never hide them. Rates as of FY2024-25 for NSE/BSE options.

A "leg" here = one option order (buy or sell) of `qty` units at `price`.
"""
from __future__ import annotations

BROKERAGE_PER_ORDER = 20.0      # flat ₹20/order (discount-broker standard); ₹0 for many
STT_SELL_PREMIUM = 0.000625     # 0.0625% on SELL-side premium (options)
EXCHANGE_TXN = 0.00035          # ~0.035% of premium (NSE options; BSE similar)
SEBI_FEES = 0.000001            # ₹10 per crore
GST = 0.18                      # 18% on (brokerage + exchange txn + sebi)
STAMP_BUY = 0.00003             # 0.003% on BUY-side premium


def leg_charges(price: float, qty: int, side: str) -> float:
    """Total statutory + brokerage cost for a single option leg."""
    turnover = price * qty
    brokerage = BROKERAGE_PER_ORDER
    exch = EXCHANGE_TXN * turnover
    sebi = SEBI_FEES * turnover
    gst = GST * (brokerage + exch + sebi)
    stt = STT_SELL_PREMIUM * turnover if side.upper() == "SELL" else 0.0
    stamp = STAMP_BUY * turnover if side.upper() == "BUY" else 0.0
    return round(brokerage + exch + sebi + gst + stt + stamp, 2)


def round_trip(entry_price: float, exit_price: float, qty: int, position: str) -> float:
    """
    Charges for a full round trip.
      position 'SELL' = short (sell to open, buy to close) — the strangle/condor case.
      position 'BUY'  = long  (buy to open, sell to close) — directional buying.
    """
    if position.upper() == "SELL":
        return leg_charges(entry_price, qty, "SELL") + leg_charges(exit_price, qty, "BUY")
    return leg_charges(entry_price, qty, "BUY") + leg_charges(exit_price, qty, "SELL")


def slippage(price: float, qty: int, pct: float = 0.03) -> float:
    """Per-fill slippage estimate (default 3% per fill — the backtest stress level)."""
    return round(price * qty * pct, 2)
