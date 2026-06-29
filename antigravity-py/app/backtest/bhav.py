"""
NSE F&O bhavcopy loader — faithful port of the Node bt-lib.js so the Python
backtest reads the SAME 600-day data the validated Node run used (and reproduces
its numbers: SHORT_STRANGLE ~91% win, ~129 trades).

Pure stdlib (no pandas) on purpose — exact parity with Node's line-split loader,
and runs before any deps are installed. pandas can be swapped in later.

CSV col idx: TradDt 0 · Xpry 9 · Strk 11 · Optn 12 · Opn 14 · Hgh 15 · Lw 16
             Cls 17 · Undrlyg 20 · OI 22
"""
from __future__ import annotations

import math
import os
from pathlib import Path

# repo-root/bt-data/bhav  (antigravity-py/app/backtest/bhav.py -> parents[3] = repo root)
BHAV = os.getenv("BHAV_DIR", str(Path(__file__).resolve().parents[3] / "bt-data" / "bhav"))
LOT = 75
CAPITAL = 100_000
RISK_PCT = 0.05


def _jsround(x: float) -> int:
    """JS Math.round (half-up), not Python banker's rounding — keeps strike parity."""
    return math.floor(x + 0.5)


def load_day(file: str) -> dict | None:
    with open(file, "r", encoding="utf-8") as f:
        rows = [ln.split(",") for ln in f.read().strip().split("\n") if ln]
    if not rows:
        return None
    date = rows[0][0]
    underlying = float(rows[0][20])
    opts = []
    for r in rows:
        try:
            o = {"xpry": r[9], "strike": float(r[11]), "type": r[12],
                 "o": float(r[14]), "h": float(r[15]), "l": float(r[16]),
                 "c": float(r[17]), "oi": float(r[22])}
        except (IndexError, ValueError):
            continue
        if o["o"] > 0 and o["strike"] > 0:
            opts.append(o)
    if not opts:
        return None
    exps = sorted({o["xpry"] for o in opts if o["xpry"] >= date})
    if not exps:
        return None
    return {"date": date, "underlying": underlying, "nearExp": exps[0], "opts": opts}


def leg(day: dict, typ: str, strike: float) -> dict | None:
    near = day["nearExp"]
    for o in day["opts"]:
        if o["type"] == typ and o["strike"] == strike and o["xpry"] == near:
            return o
    return None


def atm_strike(day: dict, step: int = 50) -> int:
    return _jsround(day["underlying"] / step) * step


def size_lots(cap: float, prem: float) -> int:
    return min(25, max(1, math.floor((cap * RISK_PCT) / max(1, prem * LOT))))


def load_days(directory: str = BHAV) -> list[dict]:
    files = sorted(f for f in os.listdir(directory)
                   if f.startswith("nifty-") and f.endswith(".csv"))
    days = [load_day(os.path.join(directory, f)) for f in files]
    return [d for d in days if d]
