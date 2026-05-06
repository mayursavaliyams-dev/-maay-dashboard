from __future__ import annotations

import numpy as np

from .base import BaseStrategy, StrategyContext


class PremiumJump35Strategy(BaseStrategy):
    name = "35 Percent Premium Jump Strategy"
    code = "premium_jump_35"
    description = "Detect 35% option premium expansion from recent base with volume and OI follow-through."
    tags = ("momentum", "volume", "oi")

    def generate_signals(self, dataset, context: StrategyContext):
        frame = dataset.options.copy()
        if frame.empty:
            return []
        mask = (frame["premium_jump_pct"] >= 35) & (frame["volume_ratio"] >= 1.15) & (frame["oi_change_pct"] >= 0.03)
        frame = frame.loc[mask].copy()
        frame["signal_score"] = np.clip(
            frame["premium_jump_pct"] * 1.1 + frame["volume_ratio"] * 15 + frame["oi_change_pct"] * 250,
            0,
            100,
        )
        return self._build_single_leg_signals(
            frame,
            context,
            lambda row: [
                f"Premium jump {getattr(row, 'premium_jump_pct', 0):.1f}%",
                f"OI buildup {getattr(row, 'oi_change_pct', 0) * 100:.1f}%",
                "Continuation setup confirmed by volume",
            ],
        )

