from __future__ import annotations

import numpy as np
import pandas as pd

from .base import BaseStrategy, StrategyContext, choose_atm_pair


class ATMStrangleStrategy(BaseStrategy):
    name = "ATM Strangle Strategy"
    code = "atm_strangle"
    description = "Trade OTM strangles with expiry-aware risk controls."
    tags = ("strangle", "expiry", "multi_leg")

    def generate_signals(self, dataset, context: StrategyContext):
        frame = dataset.options.copy()
        if frame.empty:
            return []
        snapshots = frame.loc[frame["days_to_expiry"] <= 2, ["datetime", "index", "expiry", "market_regime", "volatility_regime"]]
        snapshots = snapshots.drop_duplicates().sort_values("datetime")
        rows = []
        for snap in snapshots.itertuples(index=False):
            ce, pe = choose_atm_pair(frame, pd.Timestamp(snap.datetime), snap.index, snap.expiry, otm_steps=1)
            if ce is None or pe is None:
                continue
            entry_price = float(ce["close"] + pe["close"])
            momentum = max(float(ce["expiry_momentum_score"]), float(pe["expiry_momentum_score"]))
            if momentum < 35:
                continue
            rows.append(
                {
                    "datetime": pd.Timestamp(snap.datetime),
                    "index": snap.index,
                    "expiry": snap.expiry,
                    "entry_price": entry_price,
                    "confidence": np.clip(50 + momentum * 0.45 + max(ce["volume_ratio"], pe["volume_ratio"]) * 10, 0, 100),
                    "signal": "BUY_STRANGLE",
                    "market_regime": snap.market_regime,
                    "volatility_regime": snap.volatility_regime,
                    "legs": [
                        {"strike": float(ce["strike"]), "option_type": "CE", "expiry": str(pd.Timestamp(ce["expiry"]).date()), "weight": 1.0},
                        {"strike": float(pe["strike"]), "option_type": "PE", "expiry": str(pd.Timestamp(pe["expiry"]).date()), "weight": 1.0},
                    ],
                    "reasons": [
                        "OTM CE and PE selected around ATM",
                        "Expiry-window momentum expansion detected",
                        f"Combined premium {entry_price:.2f}",
                    ],
                }
            )
        out = []
        if not rows:
            return out
        ranked = pd.DataFrame(rows).sort_values(["datetime", "confidence"], ascending=[True, False])
        ranked["trade_day"] = ranked["datetime"].dt.strftime("%Y-%m-%d")
        ranked["day_rank"] = ranked.groupby("trade_day").cumcount() + 1
        ranked = ranked.loc[ranked["day_rank"] <= context.top_signals_per_day]
        for row in ranked.itertuples(index=False):
            out.append(
                self._build_multi_leg_signal(
                    index=row.index,
                    signal=row.signal,
                    when=row.datetime,
                    expiry=row.expiry,
                    entry_price=row.entry_price,
                    confidence=row.confidence,
                    reasons=list(row.reasons),
                    legs=list(row.legs),
                    market_regime=row.market_regime,
                    volatility_regime=row.volatility_regime,
                )
            )
        return out

