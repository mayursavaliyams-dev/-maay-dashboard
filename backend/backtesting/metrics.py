from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd


def calculate_metrics(
    trades: list[dict[str, Any]],
    *,
    initial_capital: float,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict[str, Any]:
    if not trades:
        return _empty_metrics(initial_capital, start_date)

    frame = pd.DataFrame(trades)
    frame["entry_time"] = pd.to_datetime(frame["entry_time"])
    frame["exit_time"] = pd.to_datetime(frame["exit_time"])
    frame["trade_date"] = frame["exit_time"].dt.normalize()
    frame["month"] = frame["exit_time"].dt.strftime("%Y-%m")
    frame["year"] = frame["exit_time"].dt.strftime("%Y")

    daily = frame.groupby("trade_date", as_index=False)["net_pnl"].sum().sort_values("trade_date")
    daily["equity"] = initial_capital + daily["net_pnl"].cumsum()
    daily["peak"] = daily["equity"].cummax()
    daily["drawdown"] = daily["equity"] - daily["peak"]
    daily["drawdown_pct"] = np.where(daily["peak"] != 0, daily["drawdown"] / daily["peak"] * 100, 0.0)
    daily["return_pct"] = np.where(initial_capital != 0, daily["net_pnl"] / initial_capital * 100, 0.0)

    monthly = frame.groupby("month", as_index=False)["net_pnl"].sum().sort_values("month")
    yearly = frame.groupby("year", as_index=False)["net_pnl"].sum().sort_values("year")
    best_day = daily.loc[daily["net_pnl"].idxmax()]
    worst_day = daily.loc[daily["net_pnl"].idxmin()]
    best_trade = frame.loc[frame["net_pnl"].idxmax()]
    worst_trade = frame.loc[frame["net_pnl"].idxmin()]
    win_mask = frame["net_pnl"] > 0
    loss_mask = frame["net_pnl"] < 0
    gross_profit = float(frame.loc[win_mask, "net_pnl"].sum())
    gross_loss = float(frame.loc[loss_mask, "net_pnl"].sum())
    avg_profit = float(frame.loc[win_mask, "net_pnl"].mean()) if win_mask.any() else 0.0
    avg_loss = float(frame.loc[loss_mask, "net_pnl"].mean()) if loss_mask.any() else 0.0
    years = _years_between(start_date, end_date, frame["entry_time"].min(), frame["exit_time"].max())
    ending_equity = float(daily["equity"].iloc[-1])
    cagr = (ending_equity / initial_capital) ** (1 / years) - 1 if years > 0 and initial_capital > 0 and ending_equity > 0 else 0.0
    daily_returns = daily["return_pct"] / 100.0
    stability = float(max(0.0, 1.0 - daily_returns.std(ddof=0) * 10))

    return {
        "total_trades": int(len(frame)),
        "winning_trades": int(win_mask.sum()),
        "losing_trades": int(loss_mask.sum()),
        "win_rate": round(float(win_mask.mean() * 100), 4),
        "net_pnl": round(float(frame["net_pnl"].sum()), 4),
        "gross_profit": round(gross_profit, 4),
        "gross_loss": round(gross_loss, 4),
        "profit_factor": round(gross_profit / abs(gross_loss), 4) if gross_loss < 0 else None,
        "average_profit": round(avg_profit, 4),
        "average_loss": round(avg_loss, 4),
        "risk_reward_ratio": round(abs(avg_profit / avg_loss), 4) if avg_loss else None,
        "cagr": round(cagr * 100, 4),
        "max_drawdown": round(float(daily["drawdown"].min()), 4),
        "max_drawdown_pct": round(float(daily["drawdown_pct"].min()), 4),
        "sharpe_ratio": round(_sharpe(daily_returns), 4),
        "sortino_ratio": round(_sortino(daily_returns), 4),
        "consecutive_wins": int(_max_streak(frame["net_pnl"], positive=True)),
        "consecutive_losses": int(_max_streak(frame["net_pnl"], positive=False)),
        "best_trade": _row_to_record(best_trade),
        "worst_trade": _row_to_record(worst_trade),
        "best_day": {"date": best_day["trade_date"].strftime("%Y-%m-%d"), "net_pnl": round(float(best_day["net_pnl"]), 4)},
        "worst_day": {"date": worst_day["trade_date"].strftime("%Y-%m-%d"), "net_pnl": round(float(worst_day["net_pnl"]), 4)},
        "monthly_returns": monthly.round(4).to_dict(orient="records"),
        "yearly_returns": yearly.round(4).to_dict(orient="records"),
        "daily_returns": daily[["trade_date", "net_pnl", "equity", "drawdown", "drawdown_pct"]]
        .assign(trade_date=lambda df: df["trade_date"].dt.strftime("%Y-%m-%d"))
        .round(4)
        .to_dict(orient="records"),
        "equity_curve": daily[["trade_date", "equity"]]
        .assign(trade_date=lambda df: df["trade_date"].dt.strftime("%Y-%m-%d"))
        .round(4)
        .to_dict(orient="records"),
        "drawdown_curve": daily[["trade_date", "drawdown", "drawdown_pct"]]
        .assign(trade_date=lambda df: df["trade_date"].dt.strftime("%Y-%m-%d"))
        .round(4)
        .to_dict(orient="records"),
        "expiry_analysis": _aggregate(frame, "expiry"),
        "regime_breakdown": {
            "market_regime": _aggregate(frame, "market_regime"),
            "volatility_regime": _aggregate(frame, "volatility_regime"),
        },
        "walk_forward": _walk_forward(frame, initial_capital),
        "stability": round(stability * 100, 4),
    }


def _aggregate(frame: pd.DataFrame, column: str) -> list[dict[str, Any]]:
    copy = frame.copy()
    if column not in copy.columns:
        return []
    copy[column] = copy[column].fillna("UNKNOWN")
    grouped = copy.groupby(column, as_index=False).agg(
        trades=("net_pnl", "count"),
        net_pnl=("net_pnl", "sum"),
        win_rate=("net_pnl", lambda s: (s > 0).mean() * 100),
        avg_pnl=("net_pnl", "mean"),
    )
    return grouped.round(4).to_dict(orient="records")


def _walk_forward(frame: pd.DataFrame, initial_capital: float, windows: int = 3) -> list[dict[str, Any]]:
    ordered = frame.sort_values("entry_time").reset_index(drop=True)
    parts = np.array_split(ordered, windows)
    running = initial_capital
    rows: list[dict[str, Any]] = []
    for idx, part in enumerate(parts, start=1):
        if part.empty:
            continue
        pnl = float(part["net_pnl"].sum())
        running += pnl
        rows.append(
            {
                "window": idx,
                "start": part["entry_time"].min().strftime("%Y-%m-%d"),
                "end": part["exit_time"].max().strftime("%Y-%m-%d"),
                "trades": int(len(part)),
                "net_pnl": round(pnl, 4),
                "equity": round(running, 4),
                "win_rate": round(float((part["net_pnl"] > 0).mean() * 100), 4),
            }
        )
    return rows


def _empty_metrics(initial_capital: float, start_date: str | None) -> dict[str, Any]:
    return {
        "total_trades": 0,
        "winning_trades": 0,
        "losing_trades": 0,
        "win_rate": 0.0,
        "net_pnl": 0.0,
        "gross_profit": 0.0,
        "gross_loss": 0.0,
        "profit_factor": None,
        "average_profit": 0.0,
        "average_loss": 0.0,
        "risk_reward_ratio": None,
        "cagr": 0.0,
        "max_drawdown": 0.0,
        "max_drawdown_pct": 0.0,
        "sharpe_ratio": 0.0,
        "sortino_ratio": 0.0,
        "consecutive_wins": 0,
        "consecutive_losses": 0,
        "best_trade": None,
        "worst_trade": None,
        "best_day": None,
        "worst_day": None,
        "monthly_returns": [],
        "yearly_returns": [],
        "daily_returns": [],
        "equity_curve": [{"trade_date": start_date or "", "equity": initial_capital}] if start_date else [],
        "drawdown_curve": [],
        "expiry_analysis": [],
        "regime_breakdown": {"market_regime": [], "volatility_regime": []},
        "walk_forward": [],
        "stability": 0.0,
    }


def _years_between(start_date: str | None, end_date: str | None, trade_start: pd.Timestamp, trade_end: pd.Timestamp) -> float:
    start = pd.Timestamp(start_date) if start_date else trade_start
    end = pd.Timestamp(end_date) if end_date else trade_end
    days = max((end - start).days, 1)
    return days / 365.25


def _row_to_record(row: pd.Series) -> dict[str, Any]:
    return {
        "entry_time": row["entry_time"].strftime("%Y-%m-%d %H:%M:%S"),
        "exit_time": row["exit_time"].strftime("%Y-%m-%d %H:%M:%S"),
        "strategy": row["strategy"],
        "index": row["index"],
        "signal": row["signal"],
        "strike": row.get("strike"),
        "net_pnl": round(float(row["net_pnl"]), 4),
        "return_pct": round(float(row["return_pct"]), 4),
        "exit_reason": row["exit_reason"],
    }


def _sharpe(returns: pd.Series) -> float:
    std = float(returns.std(ddof=0))
    return float((returns.mean() / std) * np.sqrt(252)) if std > 0 else 0.0


def _sortino(returns: pd.Series) -> float:
    downside = returns.loc[returns < 0]
    std = float(downside.std(ddof=0))
    return float((returns.mean() / std) * np.sqrt(252)) if std > 0 else 0.0


def _max_streak(values: pd.Series, *, positive: bool) -> int:
    best = 0
    current = 0
    for value in values:
        hit = value > 0 if positive else value < 0
        current = current + 1 if hit else 0
        best = max(best, current)
    return best
