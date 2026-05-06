from __future__ import annotations

import numpy as np

from .base import BaseStrategy, StrategyContext


class OIBuildupStrategy(BaseStrategy):
    name = "OI Buildup Strategy"
    code = "oi_buildup"
    description = "Detect long buildup, short buildup, covering, and unwinding from price, OI, and volume."
    tags = ("oi", "volume", "structure")

    def generate_signals(self, dataset, context: StrategyContext):
        frame = dataset.options.copy()
        if frame.empty:
            return []
        price_up = frame["contract_return_1"] > 0.01
        price_down = frame["contract_return_1"] < -0.01
        oi_up = frame["oi_change_pct"] > 0.02
        oi_down = frame["oi_change_pct"] < -0.02
        volume_ok = frame["volume_ratio"] >= 1.0
        valid = volume_ok & (
            (price_up & oi_up)
            | (price_down & oi_up)
            | (price_up & oi_down)
            | (price_down & oi_down)
        )
        frame = frame.loc[valid].copy()
        frame["buildup_type"] = np.select(
            [price_up & oi_up, price_down & oi_up, price_up & oi_down, price_down & oi_down],
            ["LONG_BUILDUP", "SHORT_BUILDUP", "SHORT_COVERING", "LONG_UNWINDING"],
            default="MIXED",
        )
        frame["signal_score"] = np.clip(
            abs(frame["contract_return_1"]) * 1800 + abs(frame["oi_change_pct"]) * 500 + frame["volume_ratio"] * 12,
            0,
            100,
        )
        return self._build_single_leg_signals(
            frame,
            context,
            lambda row: [
                f"{getattr(row, 'buildup_type', 'MIXED')} detected",
                f"Price change {getattr(row, 'contract_return_1', 0) * 100:.2f}% with OI change {getattr(row, 'oi_change_pct', 0) * 100:.2f}%",
                "Volume confirmation present",
            ],
        )
