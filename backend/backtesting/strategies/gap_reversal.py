from __future__ import annotations

import numpy as np

from .base import BaseStrategy, StrategyContext


class GapReversalStrategy(BaseStrategy):
    name = "Gap Up / Gap Down Reversal Strategy"
    code = "gap_reversal"
    description = "Trade confirmed gap reversals or gap continuations after the opening range resolves."
    tags = ("gap", "reversal", "open_range")

    def generate_signals(self, dataset, context: StrategyContext):
        frame = dataset.options.copy()
        if frame.empty:
            return []
        gap_up_reversal = (frame["gap_pct"] >= 0.4) & (frame["spot_close"] < frame["day_open"]) & (frame["option_type"] == "PE")
        gap_down_reversal = (frame["gap_pct"] <= -0.4) & (frame["spot_close"] > frame["day_open"]) & (frame["option_type"] == "CE")
        gap_up_continue = (frame["gap_pct"] >= 0.4) & (frame["spot_close"] > frame["open_range_high"]) & (frame["option_type"] == "CE")
        gap_down_continue = (frame["gap_pct"] <= -0.4) & (frame["spot_close"] < frame["open_range_low"]) & (frame["option_type"] == "PE")
        frame = frame.loc[(gap_up_reversal | gap_down_reversal | gap_up_continue | gap_down_continue) & (frame["volume_ratio"] >= 1.0)].copy()
        frame["signal_score"] = np.clip(abs(frame["gap_pct"]) * 20 + frame["volume_ratio"] * 12 + abs(frame["contract_return_1"]) * 1200, 0, 100)
        return self._build_single_leg_signals(
            frame,
            context,
            lambda row: [
                f"Gap setup detected at {getattr(row, 'gap_pct', 0):.2f}%",
                "Opening-range confirmation triggered reversal/continuation logic",
                f"Spot vs open-range context: {getattr(row, 'spot_close', 0):.2f}",
            ],
        )

