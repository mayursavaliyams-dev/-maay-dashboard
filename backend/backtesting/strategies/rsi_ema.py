from __future__ import annotations

import numpy as np

from .base import BaseStrategy, StrategyContext


class RSIEMATrendStrategy(BaseStrategy):
    name = "RSI + EMA Trend Strategy"
    code = "rsi_ema"
    description = "Buy CE/PE using RSI 14 and EMA 9/21 trend filters while avoiding sideways sessions."
    tags = ("trend", "ema", "rsi")

    def generate_signals(self, dataset, context: StrategyContext):
        frame = dataset.options.copy()
        if frame.empty:
            return []
        bullish = (frame["spot_ema_9"] > frame["spot_ema_21"]) & (frame["spot_rsi_14"] >= 55) & (frame["market_regime"] == "TRENDING")
        bearish = (frame["spot_ema_9"] < frame["spot_ema_21"]) & (frame["spot_rsi_14"] <= 45) & (frame["market_regime"] == "TRENDING")
        option_side = ((frame["option_type"] == "CE") & bullish) | ((frame["option_type"] == "PE") & bearish)
        frame = frame.loc[option_side & (frame["volume_ratio"] >= 1.0)].copy()
        frame["signal_score"] = np.clip(
            abs(frame["spot_ema_9"] - frame["spot_ema_21"]) / frame["spot_close"].replace(0, np.nan) * 5000
            + abs(frame["spot_rsi_14"] - 50)
            + frame["volume_ratio"] * 14,
            0,
            100,
        )
        return self._build_single_leg_signals(
            frame,
            context,
            lambda row: [
                f"RSI {getattr(row, 'spot_rsi_14', 50):.1f} with EMA 9/21 trend alignment",
                "Sideways market filtered out",
                f"Volume ratio {getattr(row, 'volume_ratio', 0):.2f}x",
            ],
        )

