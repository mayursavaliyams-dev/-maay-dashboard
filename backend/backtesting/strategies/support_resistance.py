from __future__ import annotations

import numpy as np

from .base import BaseStrategy, StrategyContext


class SupportResistanceBreakoutStrategy(BaseStrategy):
    name = "Support Resistance Breakout Strategy"
    code = "support_resistance"
    description = "Trade option breakouts once the underlying clears dynamic support or resistance with confirmation."
    tags = ("support", "resistance", "breakout")

    def generate_signals(self, dataset, context: StrategyContext):
        frame = dataset.options.copy()
        if frame.empty:
            return []
        above_res = (frame["spot_close"] > frame["resistance_level"]) & (frame["option_type"] == "CE")
        below_sup = (frame["spot_close"] < frame["support_level"]) & (frame["option_type"] == "PE")
        confirm = (frame["volume_ratio"] >= 1.0) & (frame["oi_change_pct"] >= 0)
        frame = frame.loc[(above_res | below_sup) & confirm].copy()
        frame["signal_score"] = np.clip(
            abs((frame["spot_close"] - frame["resistance_level"].fillna(frame["spot_close"])) / frame["spot_close"].replace(0, np.nan)) * 6000
            + abs((frame["spot_close"] - frame["support_level"].fillna(frame["spot_close"])) / frame["spot_close"].replace(0, np.nan)) * 6000
            + frame["volume_ratio"] * 15,
            0,
            100,
        )
        return self._build_single_leg_signals(
            frame,
            context,
            lambda row: [
                "Underlying broke dynamic support/resistance",
                f"OI change {getattr(row, 'oi_change_pct', 0) * 100:.2f}% with volume confirmation",
                "Directional option selected from breakout side",
            ],
        )

