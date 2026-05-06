from __future__ import annotations

import numpy as np

from .base import BaseStrategy, StrategyContext


class CombinedAIStrategy(BaseStrategy):
    name = "Combined AI Strategy"
    code = "combined_ai"
    description = "Blend breakout, momentum, trend, OI, and smart-money signals into a unified 0-100 confidence engine."
    tags = ("ai", "ensemble", "ranking")

    def generate_signals(self, dataset, context: StrategyContext):
        frame = dataset.options.copy()
        if frame.empty:
            return []
        ce_score = (
            np.where(frame["option_type"] == "CE", 1, 0) * 12
            + np.where(frame["spot_ema_9"] > frame["spot_ema_21"], 16, 0)
            + np.where(frame["spot_rsi_14"] >= 55, 10, 0)
            + np.where(frame["close"] > frame["prev_high_5"], 14, 0)
            + np.clip(frame["premium_jump_pct"], 0, 30) * 0.6
            + np.clip(frame["smart_money_score"], 0, 100) * 0.22
            + np.clip(frame["oi_change_pct"], 0, 0.2) * 120
        )
        pe_score = (
            np.where(frame["option_type"] == "PE", 1, 0) * 12
            + np.where(frame["spot_ema_9"] < frame["spot_ema_21"], 16, 0)
            + np.where(frame["spot_rsi_14"] <= 45, 10, 0)
            + np.where(frame["close"] > frame["prev_high_5"], 14, 0)
            + np.clip(frame["premium_jump_pct"], 0, 30) * 0.6
            + np.clip(frame["smart_money_score"], 0, 100) * 0.22
            + np.clip(frame["oi_change_pct"], 0, 0.2) * 120
        )
        frame["ai_side"] = np.where(ce_score >= pe_score, "CE", "PE")
        frame["signal_score"] = np.clip(np.maximum(ce_score, pe_score), 0, 100)
        frame = frame.loc[(frame["signal_score"] >= 58) & (frame["option_type"] == frame["ai_side"])].copy()
        return self._build_single_leg_signals(
            frame,
            context,
            lambda row: [
                f"AI confidence {getattr(row, 'signal_score', 0):.1f}/100",
                "Reason blend: breakout + premium jump + trend + OI + smart-money score",
                f"Final action {'CALL BUY' if getattr(row, 'option_type', '') == 'CE' else 'PUT BUY'}",
            ],
        )

