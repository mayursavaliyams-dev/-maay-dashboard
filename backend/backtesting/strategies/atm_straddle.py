from __future__ import annotations

import numpy as np
import pandas as pd

from .base import BaseStrategy, StrategyContext, choose_atm_pair


class ATMStraddleStrategy(BaseStrategy):
    name = "ATM Straddle Strategy"
    code = "atm_straddle"
    description = "Trade ATM straddles on volatility expansion or contraction."
    tags = ("straddle", "volatility", "multi_leg")

    def generate_signals(self, dataset, context: StrategyContext):
        frame = dataset.options.copy()
        if frame.empty:
            return []
        snapshots = frame[["datetime", "index", "expiry", "market_regime", "volatility_regime"]].drop_duplicates().sort_values("datetime")
        candidates = []
        for snap in snapshots.itertuples(index=False):
            ce, pe = choose_atm_pair(frame, pd.Timestamp(snap.datetime), snap.index, snap.expiry)
            if ce is None or pe is None:
                continue
            entry_price = float(ce["close"] + pe["close"])
            vol_score = float(max(getattr(ce, "volume_ratio", 0), getattr(pe, "volume_ratio", 0)))
            iv_flag = bool(getattr(ce, "iv_available", False) or getattr(pe, "iv_available", False))
            buy_signal = vol_score >= 1.05 and (float(ce["contract_return_1"]) > 0 or float(pe["contract_return_1"]) > 0)
            sell_signal = snap.market_regime == "SIDEWAYS" and vol_score < 0.95 and iv_flag
            if not buy_signal and not sell_signal:
                continue
            candidates.append(
                {
                    "datetime": pd.Timestamp(snap.datetime),
                    "index": snap.index,
                    "expiry": snap.expiry,
                    "signal": "BUY_STRADDLE" if buy_signal else "SELL_STRADDLE",
                    "entry_price": entry_price,
                    "confidence": np.clip(52 + vol_score * 18 + (8 if iv_flag else 0), 0, 100),
                    "market_regime": snap.market_regime,
                    "volatility_regime": snap.volatility_regime,
                    "legs": [
                        {"strike": float(ce["strike"]), "option_type": "CE", "expiry": str(pd.Timestamp(ce["expiry"]).date()), "weight": 1.0},
                        {"strike": float(pe["strike"]), "option_type": "PE", "expiry": str(pd.Timestamp(pe["expiry"]).date()), "weight": 1.0},
                    ],
                    "reasons": [
                        "ATM CE and PE auto-selected",
                        "Volatility expansion/contraction signal triggered",
                        f"Combined premium {entry_price:.2f}",
                    ],
                }
            )
        out = []
        if not candidates:
            return out
        ranked = pd.DataFrame(candidates).sort_values(["datetime", "confidence"], ascending=[True, False])
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

