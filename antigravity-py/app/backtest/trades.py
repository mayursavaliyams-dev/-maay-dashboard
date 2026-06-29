"""
Trade-by-trade detail for the SHORT_STRANGLE backtest.

Prints every trade (date, legs, entry/exit, reason, P&L, running capital) and
saves the full log to data/bt-trades.json.

Run:  python -m app.backtest.trades            # default 1% slippage
      python -m app.backtest.trades 0          # 0% slippage
      python -m app.backtest.trades 0.01 20    # 1% slip, show first 20 only
"""
from __future__ import annotations

import json
import os
import sys

from .bhav import load_days
from .strangle import simulate, summarize


def main():
    slip = float(sys.argv[1]) if len(sys.argv) > 1 else 0.01
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 0  # 0 = all

    days = load_days()
    trades = simulate(days, slip)
    s = summarize(trades)

    print(f"SHORT_STRANGLE trade-by-trade · {len(days)} days "
          f"({days[0]['date']} -> {days[-1]['date']}) · slippage {slip*100:.2f}%\n")
    header = ("#    Date        Spot      CE / PE strikes     CE in>out      PE in>out     "
              "Lot   Credit   P&L       Cap")
    print(header)
    print("-" * len(header))
    shown = trades if not limit else trades[:limit]
    for i, t in enumerate(shown, 1):
        wl = "W" if t["pnl"] > 0 else "L"
        ce = f"{t['ceEntry']:.0f}>{t['ceExit']:.0f}{'*' if t['ceReason']=='SL' else ''}"
        pe = f"{t['peEntry']:.0f}>{t['peExit']:.0f}{'*' if t['peReason']=='SL' else ''}"
        print(f"{i:<4} {t['date']}  {t['spot']:>8.0f}  {t['ceStrike']:>6}/{t['peStrike']:<6}  "
              f"{ce:>12}  {pe:>12}  {t['lots']:>3}  {t['credit']:>6.0f}  "
              f"{t['pnl']:>8,} {wl}  {t['cap']:>9,}")
    if limit and len(trades) > limit:
        print(f"... ({len(trades) - limit} more — omit the limit arg to see all)")

    print(f"\n{s['trades']} trades · {s['winPct']}% win · net Rs {s['net']:,} · "
          f"avgWin Rs {s['avgWin']:,} · avgLoss Rs {s['avgLoss']:,} · maxDD {s['maxDDpct']}%")
    print("(* = leg hit the 2x stop)")

    out = os.path.join(os.path.dirname(__file__), "..", "..", "data", "bt-trades.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump({"slip": slip, "summary": s, "trades": trades}, f, indent=1)
    print(f"\nSaved full log: {os.path.relpath(out)}")


if __name__ == "__main__":
    main()
