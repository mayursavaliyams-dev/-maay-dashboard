"""
Regime-filter backtest — Python port of bt-strangle-regime.js.

Tests whether gating the strangle by VRP / IV-percentile actually improves the
edge (the decision the live engine makes). Same data + 1% slippage + charges.
Reproduces the Node numbers, incl. the headline: IV-percentile>50% lifts
net-per-trade from ~₹3.2k to ~₹5.5k — i.e. the engine's IV gate is data-justified.

  IV proxy = ATM straddle / (0.8 * spot * sqrt(DTE/365))   (annualized)
  RV       = stdev(last 20 index log-returns) * sqrt(252)
  VRP      = IV - RV ;  IV pct = percentile of IV vs trailing 40-day window

Run:  python -m app.backtest.regime
"""
from __future__ import annotations

import json
import math
import os
from datetime import date as _date

from .bhav import CAPITAL, LOT, atm_strike, leg, load_days, size_lots, _jsround
from .strangle import round_trip_charges, _sell_leg_pnl

OTM_PCT = 0.015
SLIP = 0.01
RV_WINDOW = 20
IV_PCT_WINDOW = 40


def day_iv(day: dict) -> float | None:
    k = atm_strike(day)
    ce = leg(day, "CE", k)
    pe = leg(day, "PE", k)
    if not ce or not pe:
        return None
    straddle = ce["o"] + pe["o"]
    dte = max(1, (_date.fromisoformat(day["nearExp"]) - _date.fromisoformat(day["date"])).days)
    return straddle / (0.8 * day["underlying"] * math.sqrt(dte / 365))


def realized_vol(und: list[float], i: int, n: int = RV_WINDOW) -> float | None:
    if i < n:
        return None
    rets = [math.log(und[j] / und[j - 1]) for j in range(i - n + 1, i + 1)]
    m = sum(rets) / len(rets)
    v = sum((r - m) ** 2 for r in rets) / len(rets)
    return math.sqrt(v * 252)


def pct_rank(arr: list[float], x: float) -> float | None:
    if not arr:
        return None
    return sum(1 for v in arr if v <= x) / len(arr)


def run(days, iv_series, und_series, gate) -> dict:
    cap = CAPITAL
    trades = []
    cooldown_until = None
    skipped = 0
    for i, day in enumerate(days):
        if cooldown_until and day["date"] <= cooldown_until:
            continue
        atm = atm_strike(day)
        off = _jsround((day["underlying"] * OTM_PCT) / 50) * 50
        ce = leg(day, "CE", atm + off)
        pe = leg(day, "PE", atm - off)
        if not ce or not pe or ce["o"] < 1 or pe["o"] < 1:
            continue
        iv = iv_series[i]
        rv = realized_vol(und_series, i)
        vrp = (iv - rv) if (iv is not None and rv is not None) else None
        iv_hist = [v for v in iv_series[max(0, i - IV_PCT_WINDOW):i] if v is not None]
        iv_pct = pct_rank(iv_hist, iv) if iv is not None else None
        metrics = {"iv": iv, "rv": rv, "vrp": vrp, "ivPct": iv_pct}
        if gate and not gate(metrics):
            skipped += 1
            continue
        p1, x1 = _sell_leg_pnl(ce["o"], ce["h"], ce["c"], SLIP)
        p2, x2 = _sell_leg_pnl(pe["o"], pe["h"], pe["c"], SLIP)
        credit = ce["o"] + pe["o"]
        lots = size_lots(cap, credit)
        qty = lots * LOT
        gross = (p1 + p2) * qty
        ch = round_trip_charges(ce["o"], x1, qty) + round_trip_charges(pe["o"], x2, qty)
        pnl = round(gross - ch)
        cap += pnl
        trades.append({"pnl": pnl, "cap": round(cap)})
        cooldown_until = day["nearExp"]
    wins = sum(1 for t in trades if t["pnl"] > 0)
    peak, max_dd = CAPITAL, 0.0
    for t in trades:
        peak = max(peak, t["cap"])
        max_dd = max(max_dd, (peak - t["cap"]) / peak)
    n = len(trades)
    return {
        "trades": n, "skipped": skipped,
        "winPct": round(100 * wins / n) if n else 0,
        "net": round(cap - CAPITAL),
        "netPerTrade": round((cap - CAPITAL) / n) if n else 0,
        "maxDDpct": round(max_dd * 100, 1),
    }


VARIANTS = [
    ("NO FILTER (baseline)", None),
    ("VRP > 0 (sell only when IV>RV)", lambda m: m["vrp"] is not None and m["vrp"] > 0),
    ("VRP > +2 vol pts (richer)", lambda m: m["vrp"] is not None and m["vrp"] > 0.02),
    ("IV percentile > 50%", lambda m: m["ivPct"] is not None and m["ivPct"] > 0.5),
    ("VRP>0 AND IV pct>40%", lambda m: m["vrp"] is not None and m["vrp"] > 0 and m["ivPct"] is not None and m["ivPct"] > 0.4),
]


def evaluate(days) -> dict:
    und = [d["underlying"] for d in days]
    ivs = [day_iv(d) for d in days]
    vrps = [(ivs[i] - rv) for i in range(len(days))
            if ivs[i] is not None and (rv := realized_vol(und, i)) is not None]
    pos_vrp_pct = round(100 * sum(1 for v in vrps if v > 0) / len(vrps)) if vrps else 0
    results = [{"name": name, **run(days, ivs, und, gate)} for name, gate in VARIANTS]
    return {"days": len(days), "posVrpPct": pos_vrp_pct, "results": results}


def main():
    days = load_days()
    res = evaluate(days)
    print(f"Loaded {len(days)} days · VRP positive on {res['posVrpPct']}% of days\n")
    print("Filter                              Trades  Skip  Win%   Net Rs      Net/Trade  MaxDD%")
    for r in res["results"]:
        print(f"{r['name']:35} {r['trades']:5d} {r['skipped']:5d} {r['winPct']:5d}% "
              f"{r['net']:11,} {r['netPerTrade']:10,} {r['maxDDpct']:6}%")
    base = res["results"][0]
    best = max(res["results"], key=lambda r: r["netPerTrade"])
    print(f"\nBEST: {best['name']} — net/trade Rs {best['netPerTrade']:,} "
          f"(baseline Rs {base['netPerTrade']:,}). IV gate {'HELPS' if best['netPerTrade'] > base['netPerTrade'] else 'neutral'}.")
    out = os.path.join(os.path.dirname(__file__), "..", "..", "data", "bt-strangle-regime.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(res, f, indent=1)
    print(f"\nSaved: {os.path.relpath(out)}")


if __name__ == "__main__":
    main()
