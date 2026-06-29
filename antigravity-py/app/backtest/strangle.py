"""
SHORT_STRANGLE cost-stress backtest — Python port of bt-strangle-costs.js.

Sells ATM±1.5% CE+PE at day open, 2x-leg stop vs day high, holds to expiry
close, weekly re-entry, 5%-capital fractional sizing. Nets charges + a swept
per-fill bid-ask slippage (both legs, entry+exit). Reproduces the validated Node
result (~129 trades, ~91% win, +₹4.4L net at 0 slippage over 600 real days).

Run:  python -m app.backtest.strangle
"""
from __future__ import annotations

import json
import os

from .bhav import LOT, CAPITAL, atm_strike, leg, load_days, size_lots, _jsround

OTM_PCT = 0.015
STOP_MULT = 2.0

# --- charges: exact mirror of the Node charges.js roundTripCharges ---
BROKERAGE_PER_ORDER = 20.0
STT_SELL_PCT = 0.001       # 0.1% sell-side
EXCH_TXN_PCT = 0.0003503   # 0.03503%
SEBI_PCT = 0.000001        # 0.0001%
STAMP_BUY_PCT = 0.00003    # 0.003% buy-side
GST_PCT = 0.18


def round_trip_charges(entry_price: float, exit_price: float, qty: int) -> float:
    buy_turnover = max(0.0, entry_price) * qty
    sell_turnover = max(0.0, exit_price if exit_price is not None else entry_price) * qty
    brokerage = BROKERAGE_PER_ORDER * 2
    stt = sell_turnover * STT_SELL_PCT
    exch = (buy_turnover + sell_turnover) * EXCH_TXN_PCT
    sebi = (buy_turnover + sell_turnover) * SEBI_PCT
    stamp = buy_turnover * STAMP_BUY_PCT
    gst = (brokerage + exch + sebi) * GST_PCT
    return round(brokerage + stt + exch + sebi + stamp + gst, 2)


def _sell_leg_pnl(open_: float, day_high: float, exit_close: float, slip: float) -> tuple[float, float]:
    """Seller is hurt on both fills. Returns (pnl_per_unit, exit_price)."""
    exit_ = exit_close
    if STOP_MULT and day_high >= open_ * STOP_MULT:
        exit_ = open_ * STOP_MULT
    received = open_ * (1 - slip)   # sold at the bid
    paid = exit_ * (1 + slip)       # bought back at the ask
    return received - paid, exit_


def simulate(days: list[dict], slip: float) -> list[dict]:
    """Run the strangle and return the full per-trade detail (one dict per trade)."""
    cap = CAPITAL
    trades = []
    cooldown_until = None
    for day in days:
        if cooldown_until and day["date"] <= cooldown_until:
            continue
        atm = atm_strike(day)
        off = _jsround((day["underlying"] * OTM_PCT) / 50) * 50
        ce = leg(day, "CE", atm + off)
        pe = leg(day, "PE", atm - off)
        if not ce or not pe or ce["o"] < 1 or pe["o"] < 1:
            continue
        p1, x1 = _sell_leg_pnl(ce["o"], ce["h"], ce["c"], slip)
        p2, x2 = _sell_leg_pnl(pe["o"], pe["h"], pe["c"], slip)
        ce_reason = "SL" if ce["h"] >= ce["o"] * STOP_MULT else "EXP"
        pe_reason = "SL" if pe["h"] >= pe["o"] * STOP_MULT else "EXP"
        credit = ce["o"] + pe["o"]
        lots = size_lots(cap, credit)
        qty = lots * LOT
        gross = (p1 + p2) * qty
        ch = round_trip_charges(ce["o"], x1, qty) + round_trip_charges(pe["o"], x2, qty)
        pnl = round(gross - ch)
        cap += pnl
        trades.append({
            "date": day["date"], "expiry": day["nearExp"], "spot": round(day["underlying"], 2),
            "ceStrike": atm + off, "peStrike": atm - off,
            "ceEntry": round(ce["o"], 2), "peEntry": round(pe["o"], 2),
            "ceExit": round(x1, 2), "peExit": round(x2, 2),
            "ceReason": ce_reason, "peReason": pe_reason,
            "credit": round(credit, 2), "lots": lots, "qty": qty,
            "charges": round(ch), "pnl": pnl, "cap": round(cap),
        })
        cooldown_until = day["nearExp"]
    return trades


def summarize(trades: list[dict]) -> dict:
    n = len(trades)
    wins = sum(1 for t in trades if t["pnl"] > 0)
    cap = trades[-1]["cap"] if trades else CAPITAL
    peak, max_dd = CAPITAL, 0.0
    for t in trades:
        peak = max(peak, t["cap"])
        max_dd = max(max_dd, (peak - t["cap"]) / peak)
    W = [t["pnl"] for t in trades if t["pnl"] > 0]
    L = [t["pnl"] for t in trades if t["pnl"] < 0]
    return {
        "trades": n,
        "winPct": round(100 * wins / n) if n else 0,
        "net": round(cap - CAPITAL),
        "final": round(cap),
        "maxDDpct": round(max_dd * 100, 1),
        "avgWin": round(sum(W) / len(W)) if W else 0,
        "avgLoss": round(sum(L) / len(L)) if L else 0,
    }


def run_strangle(days: list[dict], slip: float) -> dict:
    return summarize(simulate(days, slip))


def cost_sweep(days: list[dict], slips=(0, 0.0025, 0.005, 0.0075, 0.01, 0.015, 0.02, 0.03)) -> dict:
    rows = [{"slip": s, **run_strangle(days, s)} for s in slips]
    breakeven = None
    for i in range(1, len(rows)):
        a, b = rows[i - 1], rows[i]
        if a["net"] > 0 and b["net"] <= 0:
            frac = a["net"] / (a["net"] - b["net"])
            breakeven = a["slip"] + frac * (b["slip"] - a["slip"])
            break
    return {
        "days": len(days),
        "range": [days[0]["date"], days[-1]["date"]] if days else [],
        "breakevenSlip": breakeven,
        "sweep": rows,
    }


def main():
    days = load_days()
    print(f"Loaded {len(days)} real trading days "
          f"({days[0]['date']} -> {days[-1]['date']})\n")
    res = cost_sweep(days)
    print("Slip%   Trades  Win%      Net Rs        Final Rs   MaxDD%   AvgWin    AvgLoss")
    for r in res["sweep"]:
        print(f"{r['slip']*100:5.2f}%  {r['trades']:6d}  {r['winPct']:4d}%  "
              f"{r['net']:12,}  {r['final']:11,}  {r['maxDDpct']:5}%  "
              f"{r['avgWin']:8,}  {r['avgLoss']:8,}")
    be = res["breakevenSlip"]
    print("\n===== VERDICT =====")
    if res["sweep"][-1]["net"] > 0:
        print(f"Edge SURVIVES even {res['sweep'][-1]['slip']*100:.1f}% per-fill slippage — "
              f"robust. Net still +Rs {res['sweep'][-1]['net']:,}.")
    elif be is not None:
        print(f"Break-even slippage ~ {be*100:.2f}% per fill. Realistic NIFTY weekly "
              f"ATM+-1.5% slippage is ~0.25-1% — compare for margin of safety.")
    else:
        print("Edge NEGATIVE even at 0% slippage — investigate.")
    out = os.path.join(os.path.dirname(__file__), "..", "..", "data", "bt-strangle-costs.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(res, f, indent=1)
    print(f"\nSaved: {os.path.relpath(out)}")


if __name__ == "__main__":
    main()
