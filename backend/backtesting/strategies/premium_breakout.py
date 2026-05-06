from __future__ import annotations

import numpy as np

from .base import BaseStrategy, StrategyContext


class PremiumBreakoutStrategy(BaseStrategy):
    name = "Premium Breakout Strategy"
    code = "premium_breakout"
    description = "Buy CE/PE when option premium breaks prior highs with volume confirmation."
    tags = ("breakout", "volume", "intraday")

    def generate_signals(self, dataset, context: StrategyContext):
        frame = dataset.options.copy()
        if frame.empty:
            return []
        breakout = frame["close"] > frame["prev_high_5"].fillna(frame["close"] * 10) * 1.005
        volume_ok = frame["volume_ratio"] >= 1.2
        trend_ok = ((frame["option_type"] == "CE") & (frame["spot_ema_9"] >= frame["spot_ema_21"])) | (
            (frame["option_type"] == "PE") & (frame["spot_ema_9"] <= frame["spot_ema_21"])
        )
        frame = frame.loc[breakout & volume_ok & trend_ok].copy()
        frame["signal_score"] = np.clip(
            (frame["close"] / frame["prev_high_5"].replace(0, np.nan) - 1).fillna(0.0) * 2000
            + frame["volume_ratio"] * 18
            + frame["smart_money_score"] * 0.35,
            0,
            100,
        )
        return self._build_single_leg_signals(
            frame,
            context,
            lambda row: [
                "Premium broke previous 5-bar high",
                f"Volume ratio {getattr(row, 'volume_ratio', 0):.2f}x",
                "Underlying EMA trend aligned",
            ],
        )

