from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time
from typing import Any

import numpy as np
import pandas as pd


@dataclass(slots=True)
class StrategySignal:
    strategy: str
    signal: str
    index: str
    datetime: datetime
    expiry: date | None
    strike: float | None
    option_type: str | None
    confidence: float
    entry_price: float
    reasons: list[str] = field(default_factory=list)
    legs: list[dict[str, Any]] = field(default_factory=list)
    market_regime: str = "UNKNOWN"
    volatility_regime: str = "UNKNOWN"
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class StrategyContext:
    timeframe: str = "5m"
    top_signals_per_day: int = 2
    entry_time: time = time(9, 20)
    no_trade_after: time = time(15, 0)


class BaseStrategy:
    name = "Base Strategy"
    code = "base"
    description = "Base strategy."
    tags: tuple[str, ...] = ()

    def generate_signals(self, dataset: Any, context: StrategyContext) -> list[StrategySignal]:
        raise NotImplementedError

    def _time_filtered(self, frame: pd.DataFrame, context: StrategyContext) -> pd.DataFrame:
        if frame.empty:
            return frame.copy()
        mask = frame["datetime"].dt.time.between(context.entry_time, context.no_trade_after)
        return frame.loc[mask].copy()

    def _top_per_day(self, frame: pd.DataFrame, context: StrategyContext, score_col: str = "signal_score") -> pd.DataFrame:
        if frame.empty:
            return frame.copy()
        ranked = frame.copy()
        ranked["trade_day"] = ranked["datetime"].dt.strftime("%Y-%m-%d")
        ranked = ranked.sort_values(["trade_day", score_col, "datetime"], ascending=[True, False, True])
        ranked["day_rank"] = ranked.groupby("trade_day").cumcount() + 1
        return ranked.loc[ranked["day_rank"] <= context.top_signals_per_day].copy()

    def _build_single_leg_signals(
        self,
        frame: pd.DataFrame,
        context: StrategyContext,
        reasons_builder: Any,
    ) -> list[StrategySignal]:
        signals: list[StrategySignal] = []
        filtered = self._top_per_day(self._time_filtered(frame, context), context)
        for row in filtered.itertuples(index=False):
            option_type = getattr(row, "option_type", None)
            signal = "BUY_CALL" if option_type == "CE" else "BUY_PUT"
            reasons = reasons_builder(row)
            signals.append(
                StrategySignal(
                    strategy=self.name,
                    signal=signal,
                    index=str(getattr(row, "index", "")).upper(),
                    datetime=pd.Timestamp(getattr(row, "datetime")).to_pydatetime(),
                    expiry=_to_date(getattr(row, "expiry", None)),
                    strike=_to_float(getattr(row, "strike", None)),
                    option_type=option_type,
                    confidence=float(np.clip(getattr(row, "signal_score", 50.0), 0.0, 100.0)),
                    entry_price=float(getattr(row, "close", getattr(row, "ltp", 0.0)) or 0.0),
                    reasons=reasons,
                    market_regime=str(getattr(row, "market_regime", "UNKNOWN")),
                    volatility_regime=str(getattr(row, "volatility_regime", "UNKNOWN")),
                    metadata={
                        "spot_close": _to_float(getattr(row, "spot_close", None)),
                        "oi_change_pct": _to_float(getattr(row, "oi_change_pct", None)),
                        "volume_ratio": _to_float(getattr(row, "volume_ratio", None)),
                        "premium_jump_pct": _to_float(getattr(row, "premium_jump_pct", None)),
                    },
                )
            )
        return signals

    def _build_multi_leg_signal(
        self,
        *,
        index: str,
        signal: str,
        when: pd.Timestamp,
        expiry: Any,
        entry_price: float,
        confidence: float,
        reasons: list[str],
        legs: list[dict[str, Any]],
        market_regime: str,
        volatility_regime: str,
        metadata: dict[str, Any] | None = None,
    ) -> StrategySignal:
        return StrategySignal(
            strategy=self.name,
            signal=signal,
            index=index.upper(),
            datetime=when.to_pydatetime(),
            expiry=_to_date(expiry),
            strike=None,
            option_type=None,
            confidence=float(np.clip(confidence, 0.0, 100.0)),
            entry_price=float(entry_price),
            reasons=reasons,
            legs=legs,
            market_regime=market_regime,
            volatility_regime=volatility_regime,
            metadata=metadata or {},
        )


def ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False, min_periods=max(1, min(span, 3))).mean()


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    values = 100 - (100 / (1 + rs))
    return values.fillna(50.0)


def choose_nearest_contract(
    frame: pd.DataFrame,
    when: pd.Timestamp,
    index_name: str,
    expiry: Any,
    option_type: str,
    target_strike: float,
) -> pd.Series | None:
    rows = frame.loc[
        (frame["index"] == index_name)
        & (frame["datetime"] == when)
        & (frame["option_type"] == option_type)
        & (frame["expiry"] == expiry)
    ].copy()
    if rows.empty:
        return None
    rows["distance"] = (rows["strike"] - target_strike).abs()
    rows = rows.sort_values(["distance", "volume"], ascending=[True, False])
    return rows.iloc[0]


def choose_atm_pair(
    frame: pd.DataFrame,
    when: pd.Timestamp,
    index_name: str,
    expiry: Any,
    otm_steps: int = 0,
) -> tuple[pd.Series, pd.Series] | tuple[None, None]:
    rows = frame.loc[(frame["index"] == index_name) & (frame["datetime"] == when) & (frame["expiry"] == expiry)].copy()
    if rows.empty:
        return None, None
    spot = float(rows["spot_close"].dropna().iloc[0]) if rows["spot_close"].notna().any() else float(rows["strike"].median())
    unique_strikes = np.sort(rows["strike"].dropna().unique())
    if len(unique_strikes) == 0:
        return None, None
    closest_idx = int(np.argmin(np.abs(unique_strikes - spot)))
    ce_idx = min(len(unique_strikes) - 1, closest_idx + max(0, otm_steps))
    pe_idx = max(0, closest_idx - max(0, otm_steps))
    ce = choose_nearest_contract(frame, when, index_name, expiry, "CE", float(unique_strikes[ce_idx]))
    pe = choose_nearest_contract(frame, when, index_name, expiry, "PE", float(unique_strikes[pe_idx]))
    return ce, pe


def _to_date(value: Any) -> date | None:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, pd.Timestamp):
        return value.date()
    if isinstance(value, datetime):
        return value.date()
    parsed = pd.to_datetime(value, errors="coerce")
    return None if pd.isna(parsed) else parsed.date()


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except TypeError:
        pass
    return float(value)

