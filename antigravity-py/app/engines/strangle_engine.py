"""
Premium-selling engine (skeleton). The validated edge: SHORT_STRANGLE / tail-safe
IRON_CONDOR, IV-percentile gated, paper-first.

This scaffold holds state + status; the entry/adjust/exit ladder is built next
(see MASTER_PROMPT_PYTHON.md §3). Directional buying is intentionally NOT here —
it has no edge.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, asdict

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data")
TRADES_FILE = os.path.join(DATA_DIR, "strangle-trades.json")


@dataclass
class Position:
    instrument: str
    ce_strike: float
    pe_strike: float
    credit: float
    is_condor: bool
    opened_at: str


@dataclass
class StrangleEngine:
    capital: float = 700000.0
    force_condor: bool = True
    enabled: bool = True
    open_positions: list[Position] = field(default_factory=list)
    closed_trades: list[dict] = field(default_factory=list)

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

    def status(self) -> dict:
        wins = sum(1 for t in self.closed_trades if t.get("pnl", 0) > 0)
        n = len(self.closed_trades)
        net = sum(t.get("pnl", 0) for t in self.closed_trades)
        return {
            "enabled": self.enabled,
            "forceCondor": self.force_condor,
            "capital": self.capital,
            "openPositions": [asdict(p) for p in self.open_positions],
            "allTime": {
                "trades": n,
                "wins": wins,
                "winRate": round(wins / n * 100, 1) if n else 0,
                "netPnl": round(net, 2),
                "avgPerTrade": round(net / n, 2) if n else 0,
            },
            "note": "PAPER-only premium seller. Regime ladder: skip <50% IV / "
                    "strangle 50-80% / tail-safe condor >=80%. Forward-test before trusting.",
        }
