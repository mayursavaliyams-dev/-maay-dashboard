from __future__ import annotations

from typing import Any

import numpy as np


class AIRanker:
    def rank(self, strategy_results: list[dict[str, Any]]) -> dict[str, Any]:
        enriched: list[dict[str, Any]] = []
        for result in strategy_results:
            metrics = result["metrics"]
            score = self._score(metrics)
            enriched.append(
                {
                    "strategy": result["strategy"],
                    "index": result["index"],
                    "description": result["description"],
                    "score": score,
                    "win_rate": metrics["win_rate"],
                    "net_pnl": metrics["net_pnl"],
                    "profit_factor": metrics["profit_factor"],
                    "cagr": metrics["cagr"],
                    "max_drawdown_pct": metrics["max_drawdown_pct"],
                    "stability": metrics["stability"],
                    "total_trades": metrics["total_trades"],
                    "regime_breakdown": metrics.get("regime_breakdown", {}),
                }
            )

        ranking = sorted(enriched, key=lambda item: (item["score"], item["net_pnl"]), reverse=True)
        return {
            "ranking": ranking,
            "best_overall_strategy": ranking[0] if ranking else None,
            "best_safe_strategy": self._pick(ranking, key=lambda item: (100 - abs(item["max_drawdown_pct"]), item["score"])),
            "best_aggressive_strategy": self._pick(ranking, key=lambda item: (item["cagr"], item["score"])),
            "best_expiry_day_strategy": self._pick(ranking, key=lambda item: self._regime_signal(item, "market_regime", "TRENDING")),
            "best_low_drawdown_strategy": self._pick(ranking, key=lambda item: (-abs(item["max_drawdown_pct"]), item["score"])),
            "best_high_return_strategy": self._pick(ranking, key=lambda item: (item["net_pnl"], item["score"])),
            "best_by_index": {
                "NIFTY": self._best_for_index(ranking, "NIFTY"),
                "BANKNIFTY": self._best_for_index(ranking, "BANKNIFTY"),
                "SENSEX": self._best_for_index(ranking, "SENSEX"),
            },
            "best_trending_market": self._pick(ranking, key=lambda item: self._regime_signal(item, "market_regime", "TRENDING")),
            "best_sideways_market": self._pick(ranking, key=lambda item: self._regime_signal(item, "market_regime", "SIDEWAYS")),
            "best_high_volatility_market": self._pick(ranking, key=lambda item: self._regime_signal(item, "volatility_regime", "HIGH_VOL")),
            "best_low_volatility_market": self._pick(ranking, key=lambda item: self._regime_signal(item, "volatility_regime", "LOW_VOL")),
        }

    def _score(self, metrics: dict[str, Any]) -> float:
        win_rate = np.clip(metrics.get("win_rate", 0.0), 0.0, 100.0)
        profit_factor = metrics.get("profit_factor") or 0.0
        cagr = max(metrics.get("cagr", 0.0), 0.0)
        drawdown = abs(metrics.get("max_drawdown_pct", 0.0))
        stability = np.clip(metrics.get("stability", 0.0), 0.0, 100.0)
        trades = metrics.get("total_trades", 0)
        losing_streak = metrics.get("consecutive_losses", 0)

        trade_score = np.clip(np.log1p(trades) / np.log1p(250) * 100, 0.0, 100.0)
        pf_score = np.clip((profit_factor - 1.0) * 40, 0.0, 100.0)
        cagr_score = np.clip(cagr * 0.7, 0.0, 100.0)
        dd_score = np.clip(100.0 - drawdown * 2.0, 0.0, 100.0)
        streak_score = np.clip(100.0 - losing_streak * 12.0, 0.0, 100.0)

        final = (
            win_rate * 0.22
            + pf_score * 0.18
            + cagr_score * 0.18
            + dd_score * 0.18
            + stability * 0.12
            + streak_score * 0.07
            + trade_score * 0.05
        )
        return round(float(np.clip(final, 0.0, 100.0)), 2)

    def _pick(self, ranking: list[dict[str, Any]], key: Any) -> dict[str, Any] | None:
        return max(ranking, key=key, default=None)

    def _best_for_index(self, ranking: list[dict[str, Any]], index_name: str) -> dict[str, Any] | None:
        subset = [row for row in ranking if row["index"] == index_name]
        return subset[0] if subset else None

    def _regime_signal(self, item: dict[str, Any], column: str, name: str) -> tuple[float, float]:
        rows = item.get("regime_breakdown", {}).get(column, [])
        match = next((row for row in rows if row.get(column) == name), None)
        if not match:
            return (0.0, 0.0)
        return (float(match.get("net_pnl", 0.0)), float(match.get("win_rate", 0.0)))
