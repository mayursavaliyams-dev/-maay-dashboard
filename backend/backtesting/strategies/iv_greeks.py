from __future__ import annotations

import numpy as np

from .base import BaseStrategy, StrategyContext


class IVGreeksFilterStrategy(BaseStrategy):
    name = "IV and Greeks Filter Strategy"
    code = "iv_greeks"
    description = "Use IV and Greeks to filter for higher-quality option entries and avoid weak theta zones."
    tags = ("iv", "greeks", "filter")

    def generate_signals(self, dataset, context: StrategyContext):
        frame = dataset.options.copy()
        if frame.empty:
            return []
        delta_ok = frame["delta"].abs().between(0.2, 0.65)
        gamma_ok = frame["gamma"].fillna(0.0) >= 0
        vega_ok = frame["vega"].fillna(0.0) >= frame["vega"].fillna(0.0).quantile(0.35)
        iv_ok = frame["iv_available"] & (frame["iv"] >= frame["iv"].fillna(0).quantile(0.35))
        directional = ((frame["option_type"] == "CE") & (frame["spot_ema_9"] >= frame["spot_ema_21"])) | (
            (frame["option_type"] == "PE") & (frame["spot_ema_9"] <= frame["spot_ema_21"])
        )
        frame = frame.loc[delta_ok & gamma_ok & vega_ok & iv_ok & frame["theta_safe"] & directional].copy()
        frame["signal_score"] = np.clip(
            frame["iv"].fillna(0) * 1.8
            + frame["delta"].abs() * 65
            + frame["gamma"].fillna(0) * 1000
            + frame["volume_ratio"] * 10,
            0,
            100,
        )
        return self._build_single_leg_signals(
            frame,
            context,
            lambda row: [
                "IV and Greeks passed quality filter",
                f"Delta {getattr(row, 'delta', 0):.2f}, Gamma {getattr(row, 'gamma', 0):.4f}, Theta safe={getattr(row, 'theta_safe', False)}",
                "Directional bias confirmed by underlying trend",
            ],
        )

