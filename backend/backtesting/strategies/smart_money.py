from __future__ import annotations

import numpy as np

from .base import BaseStrategy, StrategyContext


class SmartMoneyStrategy(BaseStrategy):
    name = "Smart Money Volume + OI Strategy"
    code = "smart_money"
    description = "Detect unusual volume, OI expansion, and premium absorption to estimate smart-money participation."
    tags = ("smart_money", "volume", "oi")

    def generate_signals(self, dataset, context: StrategyContext):
        frame = dataset.options.copy()
        if frame.empty:
            return []
        absorption = (frame["close"] - frame["low"]) / (frame["high"] - frame["low"]).replace(0, np.nan) >= 0.7
        unusual = (frame["volume_ratio"] >= 1.5) & (frame["oi_change_pct"] >= 0.03) & absorption.fillna(False)
        directional = ((frame["option_type"] == "CE") & (frame["spot_ema_9"] >= frame["spot_ema_21"])) | (
            (frame["option_type"] == "PE") & (frame["spot_ema_9"] <= frame["spot_ema_21"])
        )
        frame = frame.loc[unusual & directional].copy()
        frame["signal_score"] = np.clip(frame["smart_money_score"] + frame["volume_ratio"] * 10, 0, 100)
        return self._build_single_leg_signals(
            frame,
            context,
            lambda row: [
                "Unusual volume and OI expansion detected",
                "Premium absorption suggests larger participants stepping in",
                f"Smart-money score {getattr(row, 'smart_money_score', 0):.1f}",
            ],
        )

