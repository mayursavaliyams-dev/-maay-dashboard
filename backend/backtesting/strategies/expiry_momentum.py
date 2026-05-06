from __future__ import annotations

import numpy as np

from .base import BaseStrategy, StrategyContext


class ExpiryMomentumStrategy(BaseStrategy):
    name = "Expiry Day Momentum Strategy"
    code = "expiry_momentum"
    description = "Capture fast expiry-day option premium moves and classify 5x, 10x, or extreme extensions."
    tags = ("expiry", "momentum", "fast_move")

    def generate_signals(self, dataset, context: StrategyContext):
        frame = dataset.options.copy()
        if frame.empty:
            return []
        mask = frame["is_expiry_day"] & (frame["premium_jump_pct"] >= 18) & (frame["volume_ratio"] >= 1.1)
        frame = frame.loc[mask].copy()
        frame["move_multiple"] = frame["close"] / frame["premium_base_10"].replace(0, np.nan)
        frame["extension"] = np.select(
            [frame["move_multiple"] >= 10, frame["move_multiple"] >= 5],
            ["10X_MOVE", "5X_MOVE"],
            default="MOMENTUM",
        )
        frame["signal_score"] = np.clip(frame["expiry_momentum_score"] + frame["move_multiple"] * 8, 0, 100)
        return self._build_single_leg_signals(
            frame,
            context,
            lambda row: [
                f"Expiry-day momentum classified as {getattr(row, 'extension', 'MOMENTUM')}",
                f"Premium jump {getattr(row, 'premium_jump_pct', 0):.1f}% with {getattr(row, 'volume_ratio', 0):.2f}x volume",
                "Designed for NIFTY, BANKNIFTY, and Friday/Tuesday SENSEX expiries",
            ],
        )

