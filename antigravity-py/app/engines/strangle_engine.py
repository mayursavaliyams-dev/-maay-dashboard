"""
Premium-selling engine — the validated edge (SHORT_STRANGLE / tail-safe IRON
CONDOR), PAPER-first.

Regime ladder (IV percentile gates entries — VRP inverts ~25% of days, so only
sell when premium is genuinely rich):
    IV%ile < 50   -> SKIP        (premium too cheap, edge thin)
    50 <= IV < 80 -> STRANGLE    (naked ATM+-1.5% CE/PE)
    IV%ile >= 80  -> IRON CONDOR (same shorts + long wings ~3% out, caps the tail)

Management per position:
    - per-leg 2x stop (exit a short leg if its premium doubles)
    - take-profit at 50% of credit captured
    - else hold to expiry
Weekly re-entry (one position per expiry cycle). No real orders — place is paper.

The decision helpers (regime / select_legs / manage) are pure and unit-tested so
the logic is verifiable without a live feed.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, asdict

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data")
TRADES_FILE = os.path.join(DATA_DIR, "strangle-trades.json")

OTM_PCT = 0.015      # short legs ~1.5% OTM
WING_PCT = 0.03      # condor long wings ~3% OTM
STEP = 50            # NIFTY strike step
STOP_MULT = 2.0      # exit a short leg at 2x its entry premium
TP_PCT = 0.50        # take profit at 50% of credit
IV_SKIP = 50.0       # below this percentile -> skip
IV_CONDOR = 80.0     # at/above this -> tail-safe condor
RISK_PCT = 0.05
LOT = 75


# ---------- pure decision helpers (unit-tested) ----------
def regime(iv_percentile: float) -> str:
    if iv_percentile < IV_SKIP:
        return "SKIP"
    if iv_percentile >= IV_CONDOR:
        return "CONDOR"
    return "STRANGLE"


def _round_step(x: float, step: int = STEP) -> int:
    import math
    return math.floor(x / step + 0.5) * step


def _ltp_at(rows: list[dict], strike: float, kind: str) -> float | None:
    leg_key = "ce" if kind == "CE" else "pe"
    for r in rows:
        if r["strike"] == strike:
            v = (r.get(leg_key) or {}).get("ltp")
            return float(v) if v else None
    return None


def select_legs(rows: list[dict], spot: float, structure: str) -> dict | None:
    """
    Build the legs for a strangle/condor. Returns
    {credit, legs:[{side,kind,strike,entry}, ...]} or None if any leg is missing.
    """
    atm = _round_step(spot)
    off = _round_step(spot * OTM_PCT)
    ce_k, pe_k = atm + off, atm - off
    ce = _ltp_at(rows, ce_k, "CE")
    pe = _ltp_at(rows, pe_k, "PE")
    if not ce or not pe or ce < 1 or pe < 1:
        return None
    legs = [
        {"side": "SELL", "kind": "CE", "strike": ce_k, "entry": ce},
        {"side": "SELL", "kind": "PE", "strike": pe_k, "entry": pe},
    ]
    credit = ce + pe
    if structure == "CONDOR":
        woff = _round_step(spot * WING_PCT)
        cew_k, pew_k = atm + woff, atm - woff
        cew = _ltp_at(rows, cew_k, "CE")
        pew = _ltp_at(rows, pew_k, "PE")
        if not cew or not pew:
            return None  # can't build a safe condor -> caller falls back / skips
        legs += [
            {"side": "BUY", "kind": "CE", "strike": cew_k, "entry": cew},
            {"side": "BUY", "kind": "PE", "strike": pew_k, "entry": pew},
        ]
        credit = (ce + pe) - (cew + pew)  # net credit after paying for wings
    return {"credit": round(credit, 2), "legs": legs}


def cost_to_close(legs: list[dict], price_of) -> float:
    """Net premium to flatten now: buy back shorts, sell longs. price_of(kind,strike)->ltp."""
    cost = 0.0
    for lg in legs:
        now = price_of(lg["kind"], lg["strike"])
        if now is None:
            now = lg["entry"]
        cost += now if lg["side"] == "SELL" else -now
    return cost


def manage(position: dict, price_of) -> str | None:
    """Return an exit reason ('STOP'|'TP') or None to hold."""
    # per-leg 2x stop on any short
    for lg in position["legs"]:
        if lg["side"] == "SELL":
            now = price_of(lg["kind"], lg["strike"])
            if now is not None and now >= lg["entry"] * STOP_MULT:
                return "STOP"
    # take-profit: captured >= TP_PCT of credit
    credit = position["credit"]
    if credit > 0:
        ctc = cost_to_close(position["legs"], price_of)
        if ctc <= credit * (1 - TP_PCT):
            return "TP"
    return None


def size_lots(capital: float, credit: float, lot: int = LOT) -> int:
    import math
    return min(25, max(1, math.floor((capital * RISK_PCT) / max(1, credit * lot))))


# ---------- stateful paper engine ----------
@dataclass
class StrangleEngine:
    capital: float = 700000.0
    force_condor: bool = True
    enabled: bool = True
    lot: int = LOT
    open_positions: list[dict] = field(default_factory=list)
    closed_trades: list[dict] = field(default_factory=list)
    _cooldown_expiry: str | None = None

    def __post_init__(self):
        self._load()

    def _load(self):
        try:
            with open(TRADES_FILE) as f:
                self.closed_trades = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            self.closed_trades = []

    def _save(self):
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(TRADES_FILE, "w") as f:
            json.dump(self.closed_trades, f, indent=2)

    def on_tick(self, rows: list[dict], spot: float, expiry: str, iv_percentile: float,
                now: str) -> list[dict]:
        """
        Drive one paper tick: manage open positions, then maybe open one.
        `rows` = analytics optionChain (list of {strike, ce:{ltp}, pe:{ltp}}).
        Returns a list of events that occurred this tick.
        """
        events = []
        if not self.enabled:
            return events
        price_of = lambda kind, strike: _ltp_at(rows, strike, kind)  # noqa: E731

        # 1) manage existing
        still_open = []
        for pos in self.open_positions:
            reason = manage(pos, price_of)
            if reason:
                ctc = cost_to_close(pos["legs"], price_of)
                pnl = round((pos["credit"] - ctc) * pos["qty"])
                rec = {**pos, "exit": now, "reason": reason, "ctc": round(ctc, 2), "pnl": pnl}
                self.closed_trades.append(rec)
                self.capital += pnl
                events.append({"event": "close", **rec})
            else:
                still_open.append(pos)
        self.open_positions = still_open

        # 2) maybe open (one per expiry cycle)
        if self._cooldown_expiry == expiry or self.open_positions:
            if self.closed_trades and events:
                self._save()
            return events
        reg = regime(iv_percentile)
        if reg == "SKIP":
            return events
        structure = "CONDOR" if (self.force_condor or reg == "CONDOR") else "STRANGLE"
        built = select_legs(rows, spot, structure)
        if not built and structure == "CONDOR":
            built = select_legs(rows, spot, "STRANGLE")  # wings missing -> naked fallback
            structure = "STRANGLE"
        if not built:
            return events
        lots = size_lots(self.capital, built["credit"], self.lot)
        pos = {
            "instrument": "NIFTY", "structure": structure, "legs": built["legs"],
            "credit": built["credit"], "qty": lots * self.lot, "lots": lots,
            "opened_at": now, "expiry": expiry, "ivPct": iv_percentile, "status": "OPEN",
        }
        self.open_positions.append(pos)
        self._cooldown_expiry = expiry
        events.append({"event": "open", **pos})
        if events:
            self._save()
        return events

    def status(self) -> dict:
        wins = sum(1 for t in self.closed_trades if t.get("pnl", 0) > 0)
        n = len(self.closed_trades)
        net = sum(t.get("pnl", 0) for t in self.closed_trades)
        return {
            "enabled": self.enabled,
            "forceCondor": self.force_condor,
            "capital": round(self.capital),
            "openPositions": self.open_positions,
            "allTime": {
                "trades": n,
                "wins": wins,
                "winRate": round(wins / n * 100, 1) if n else 0,
                "netPnl": round(net, 2),
                "avgPerTrade": round(net / n, 2) if n else 0,
            },
            "note": "PAPER premium seller. IV ladder: skip <50% / strangle 50-80% / "
                    "tail-safe condor >=80%. 2x leg stop, 50% take-profit. Forward-test first.",
        }
