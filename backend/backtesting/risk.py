from __future__ import annotations

from dataclasses import dataclass
from datetime import time
from typing import Any

import pandas as pd

from .data_loader import MarketDataset
from .strategies.base import StrategySignal


DEFAULT_LOT_SIZES = {
    "BANKNIFTY": 65,
    "NIFTY": 50,
    "SENSEX": 10,
}


@dataclass(slots=True)
class RiskConfig:
    capital: float = 500000.0
    lot_size: int | None = None
    stop_loss_pct: float = 25.0
    target_pct: float = 40.0
    trailing_sl_pct: float = 12.0
    max_trades_per_day: int = 3
    max_loss_per_day: float = 25000.0
    max_profit_lock: float = 50000.0
    entry_time: time = time(9, 20)
    exit_time: time = time(15, 15)
    no_trade_after: time = time(15, 0)
    position_sizing: float = 1.0
    capital_allocation: float = 0.1
    brokerage: float = 40.0
    slippage_pct: float = 0.3

    def resolve_lot_size(self, index_name: str) -> int:
        return int(self.lot_size or DEFAULT_LOT_SIZES.get(index_name.upper(), 25))


class TradeSimulator:
    def simulate(self, dataset: MarketDataset, signals: list[StrategySignal], config: RiskConfig) -> list[dict[str, Any]]:
        trades: list[dict[str, Any]] = []
        if not signals:
            return trades

        daily_stats: dict[pd.Timestamp, dict[str, float | int]] = {}
        equity = float(config.capital)
        ordered = sorted(signals, key=lambda signal: signal.datetime)

        for signal in ordered:
            signal_day = pd.Timestamp(signal.datetime).normalize()
            stats = daily_stats.setdefault(signal_day, {"count": 0, "pnl": 0.0})
            if stats["count"] >= config.max_trades_per_day:
                continue
            if stats["pnl"] <= -abs(config.max_loss_per_day):
                continue
            if stats["pnl"] >= abs(config.max_profit_lock):
                continue
            if signal.datetime.time() < config.entry_time or signal.datetime.time() > config.no_trade_after:
                continue

            series = self._build_price_series(dataset.options, signal, config.exit_time)
            if series.empty:
                continue
            entry_row = series.iloc[0]
            entry_price = self._apply_slippage(float(entry_row["close"]), signal.signal, config.slippage_pct, is_entry=True)
            if entry_price <= 0:
                continue

            lot_size = config.resolve_lot_size(signal.index)
            unit_cost = max(entry_price * lot_size, 1.0)
            allocated = max(equity * config.capital_allocation * max(config.position_sizing, 0.1), unit_cost)
            lots = max(1, int(allocated // unit_cost))
            quantity = lots * lot_size
            trade = self._run_trade(series, signal, config, entry_price, quantity)
            if trade is None:
                continue

            trade["equity_after_trade"] = equity + trade["net_pnl"]
            equity = trade["equity_after_trade"]
            stats["count"] += 1
            stats["pnl"] += float(trade["net_pnl"])
            trades.append(trade)

        return trades

    def _build_price_series(self, options: pd.DataFrame, signal: StrategySignal, exit_time: time) -> pd.DataFrame:
        if options.empty:
            return pd.DataFrame()
        start_ts = pd.Timestamp(signal.datetime)
        day_mask = options["datetime"].dt.normalize() == start_ts.normalize()

        if signal.legs:
            merged: pd.DataFrame | None = None
            for leg in signal.legs:
                leg_rows = options.loc[
                    day_mask
                    & (options["datetime"] >= start_ts)
                    & (options["index"] == signal.index)
                    & (options["expiry"] == pd.Timestamp(leg["expiry"]).normalize())
                    & (options["strike"] == float(leg["strike"]))
                    & (options["option_type"] == leg["option_type"]),
                    ["datetime", "open", "high", "low", "close"],
                ].copy()
                if leg_rows.empty:
                    return pd.DataFrame()
                leg_rows = leg_rows.drop_duplicates("datetime").set_index("datetime").sort_index()
                weight = float(leg.get("weight", 1.0))
                leg_rows = leg_rows.mul(weight)
                leg_rows.columns = [f"{leg['option_type']}_{column}" for column in leg_rows.columns]
                merged = leg_rows if merged is None else merged.join(leg_rows, how="outer")
            if merged is None:
                return pd.DataFrame()
            merged = merged.ffill().dropna(how="all")
            out = pd.DataFrame(index=merged.index)
            for price_col in ["open", "high", "low", "close"]:
                cols = [column for column in merged.columns if column.endswith(f"_{price_col}")]
                out[price_col] = merged[cols].sum(axis=1)
            out = out.reset_index()
        else:
            out = options.loc[
                day_mask
                & (options["datetime"] >= start_ts)
                & (options["index"] == signal.index)
                & (options["expiry"] == pd.Timestamp(signal.expiry).normalize())
                & (options["strike"] == float(signal.strike))
                & (options["option_type"] == signal.option_type),
                ["datetime", "open", "high", "low", "close"],
            ].copy()

        out = out.loc[out["datetime"].dt.time <= exit_time].drop_duplicates("datetime").sort_values("datetime")
        return out.reset_index(drop=True)

    def _run_trade(
        self,
        series: pd.DataFrame,
        signal: StrategySignal,
        config: RiskConfig,
        entry_price: float,
        quantity: int,
    ) -> dict[str, Any] | None:
        if series.empty:
            return None

        long_premium = signal.signal.startswith("BUY")
        stop_pct = abs(config.stop_loss_pct) / 100.0
        target_pct = abs(config.target_pct) / 100.0
        trailing_pct = abs(config.trailing_sl_pct) / 100.0

        stop_level = entry_price * (1 - stop_pct if long_premium else 1 + stop_pct)
        target_level = entry_price * (1 + target_pct if long_premium else 1 - target_pct)
        best_price = entry_price
        trail_level = stop_level
        exit_price = entry_price
        exit_time = pd.Timestamp(signal.datetime)
        exit_reason = "TIME_EXIT"

        for row in series.itertuples(index=False):
            bar_time = pd.Timestamp(row.datetime)
            high = float(row.high)
            low = float(row.low)
            close = float(row.close)

            if long_premium:
                best_price = max(best_price, high)
                trail_level = max(trail_level, best_price * (1 - trailing_pct))
                if low <= stop_level:
                    exit_price = stop_level
                    exit_reason = "STOP_LOSS"
                    exit_time = bar_time
                    break
                if high >= target_level:
                    exit_price = target_level
                    exit_reason = "TARGET"
                    exit_time = bar_time
                    break
                if low <= trail_level and trail_level > stop_level:
                    exit_price = trail_level
                    exit_reason = "TRAIL_STOP"
                    exit_time = bar_time
                    break
            else:
                best_price = min(best_price, low)
                trail_level = min(trail_level, best_price * (1 + trailing_pct))
                if high >= stop_level:
                    exit_price = stop_level
                    exit_reason = "STOP_LOSS"
                    exit_time = bar_time
                    break
                if low <= target_level:
                    exit_price = target_level
                    exit_reason = "TARGET"
                    exit_time = bar_time
                    break
                if high >= trail_level and trail_level < stop_level:
                    exit_price = trail_level
                    exit_reason = "TRAIL_STOP"
                    exit_time = bar_time
                    break

            exit_price = close
            exit_time = bar_time

        exit_price = self._apply_slippage(exit_price, signal.signal, config.slippage_pct, is_entry=False)
        multiplier = 1 if long_premium else -1
        gross_pnl = (exit_price - entry_price) * quantity * multiplier
        net_pnl = gross_pnl - float(config.brokerage)
        return_pct = ((exit_price - entry_price) / entry_price) * 100 * multiplier if entry_price else 0.0

        return {
            "strategy": signal.strategy,
            "index": signal.index,
            "signal": signal.signal,
            "entry_time": pd.Timestamp(signal.datetime).isoformat(),
            "exit_time": exit_time.isoformat(),
            "expiry": signal.expiry.isoformat() if signal.expiry else None,
            "strike": signal.strike,
            "option_type": signal.option_type,
            "quantity": quantity,
            "entry_price": round(entry_price, 4),
            "exit_price": round(exit_price, 4),
            "gross_pnl": round(gross_pnl, 4),
            "net_pnl": round(net_pnl, 4),
            "return_pct": round(return_pct, 4),
            "exit_reason": exit_reason,
            "confidence": round(signal.confidence, 2),
            "reasons": signal.reasons,
            "market_regime": signal.market_regime,
            "volatility_regime": signal.volatility_regime,
            "legs": signal.legs,
            "metadata": signal.metadata,
        }

    def _apply_slippage(self, price: float, signal_name: str, slippage_pct: float, *, is_entry: bool) -> float:
        slip = abs(slippage_pct) / 100.0
        long_premium = signal_name.startswith("BUY")
        if long_premium:
            return price * (1 + slip) if is_entry else price * (1 - slip)
        return price * (1 - slip) if is_entry else price * (1 + slip)
