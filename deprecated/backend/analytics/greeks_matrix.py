from __future__ import annotations

from typing import Any

from .options_analytics import OptionsAnalyticsAnalyzer


class GreeksMatrixAnalyzer:
    def __init__(self) -> None:
        self.options = OptionsAnalyticsAnalyzer()

    def analyze(
        self,
        *,
        spot_price: float,
        index: str = "SENSEX",
        iv_pct: float = 15.0,
        time_to_expiry_days: float = 1.0,
    ) -> dict[str, Any]:
        return self.options.build_greeks_matrix(
            spot_price=spot_price,
            index=index,
            iv_pct=iv_pct,
            time_to_expiry_days=time_to_expiry_days,
        )
