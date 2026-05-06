from __future__ import annotations

import numpy as np
import pandas as pd

from .base import BaseStrategy, StrategyContext, StrategySignal


class HighLowMappingStrategy(BaseStrategy):
    name = "High Low Mapping Strategy"
    code = "high_low_mapping"
    description = "Track nearby strike highs/lows and trade synchronized premium expansions."
    tags = ("breadth", "mapping", "trend")

    def generate_signals(self, dataset, context: StrategyContext):
        frame = dataset.options.copy()
        if frame.empty:
            return []
        near_atm = frame.loc[frame["atm_distance"] <= frame["atm_distance"].median() * 1.5].copy()
        high_hits = near_atm.loc[near_atm["new_high_20"]].copy()
        if high_hits.empty:
            return []
        grouped = (
            high_hits.groupby(["datetime", "index", "expiry", "option_type"], as_index=False)
            .agg(strike_breaks=("strike", "nunique"), best_volume=("volume", "max"))
            .query("strike_breaks >= 2")
        )
        signals: list[StrategySignal] = []
        for row in grouped.itertuples(index=False):
            candidates = high_hits.loc[
                (high_hits["datetime"] == row.datetime)
                & (high_hits["index"] == row.index)
                & (high_hits["expiry"] == row.expiry)
                & (high_hits["option_type"] == row.option_type)
            ].copy()
            if candidates.empty:
                continue
            candidates["distance_rank"] = candidates["atm_distance"].rank(method="first")
            picked = candidates.sort_values(["distance_rank", "volume"], ascending=[True, False]).iloc[0]
            score = np.clip(45 + row.strike_breaks * 12 + picked["volume_ratio"] * 10, 0, 100)
            signal_type = "BUY_CALL" if picked["option_type"] == "CE" else "BUY_PUT"
            signals.append(
                StrategySignal(
                    strategy=self.name,
                    signal=signal_type,
                    index=picked["index"],
                    datetime=pd.Timestamp(picked["datetime"]).to_pydatetime(),
                    expiry=pd.Timestamp(picked["expiry"]).date() if pd.notna(picked["expiry"]) else None,
                    strike=float(picked["strike"]),
                    option_type=picked["option_type"],
                    confidence=float(score),
                    entry_price=float(picked["close"]),
                    reasons=[
                        f"{int(row.strike_breaks)} nearby strikes broke fresh highs together",
                        "Mapped option breadth supports directional continuation",
                        f"Volume ratio {picked['volume_ratio']:.2f}x on selected strike",
                    ],
                    market_regime=str(picked.get("market_regime", "UNKNOWN")),
                    volatility_regime=str(picked.get("volatility_regime", "UNKNOWN")),
                    metadata={"cluster_breaks": int(row.strike_breaks)},
                )
            )
        return signals

