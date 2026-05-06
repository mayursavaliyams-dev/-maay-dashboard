from __future__ import annotations

import threading
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import pandas as pd

from .ai_ranker import AIRanker
from .data_loader import HistoricalDataEngine, MarketDataset
from .metrics import calculate_metrics
from .report_excel import ExcelReportGenerator
from .risk import RiskConfig, TradeSimulator
from .strategies import STRATEGY_REGISTRY, get_strategy
from .strategies.base import StrategyContext


@dataclass(slots=True)
class BacktestRunRequest:
    index: str = "NIFTY"
    strategy: str = "combined_ai"
    start_date: str | None = None
    end_date: str | None = None
    capital: float = 500000.0
    lot_size: int | None = None
    stop_loss: float = 25.0
    target: float = 40.0
    trailing_sl: float = 12.0
    timeframe: str = "5m"
    brokerage: float = 40.0
    slippage: float = 0.3
    max_trades_per_day: int = 3
    max_loss_per_day: float = 25000.0
    max_profit_lock: float = 50000.0
    capital_allocation: float = 0.1
    dataset_id: str | None = None
    data_path: str | None = None


class BacktestEngine:
    def __init__(
        self,
        loader: HistoricalDataEngine | None = None,
        simulator: TradeSimulator | None = None,
        ranker: AIRanker | None = None,
        report_generator: ExcelReportGenerator | None = None,
    ) -> None:
        self.loader = loader or HistoricalDataEngine()
        self.simulator = simulator or TradeSimulator()
        self.ranker = ranker or AIRanker()
        self.report_generator = report_generator or ExcelReportGenerator()

    def run(self, request: BacktestRunRequest, *, dataset_path: str | Path, job_id: str, report_dir: str | Path) -> dict[str, Any]:
        dataset = self.loader.load_csv(
            dataset_path,
            timeframe=request.timeframe,
            index_filter=None if request.index.upper() == "ALL" else request.index,
            start_date=request.start_date,
            end_date=request.end_date,
        )
        indices = dataset.metadata.get("indices", [])
        if request.index.upper() != "ALL":
            indices = [request.index.upper()]
        strategies = self._resolve_strategies(request.strategy)
        risk = RiskConfig(
            capital=request.capital,
            lot_size=request.lot_size,
            stop_loss_pct=request.stop_loss,
            target_pct=request.target,
            trailing_sl_pct=request.trailing_sl,
            max_trades_per_day=request.max_trades_per_day,
            max_loss_per_day=request.max_loss_per_day,
            max_profit_lock=request.max_profit_lock,
            brokerage=request.brokerage,
            slippage_pct=request.slippage,
            capital_allocation=request.capital_allocation,
        )
        context = StrategyContext(timeframe=request.timeframe)

        strategy_results: list[dict[str, Any]] = []
        for index_name in indices:
            filtered = dataset.filter(index_name, request.start_date, request.end_date)
            if filtered.options.empty:
                continue
            for strategy in strategies:
                signals = strategy.generate_signals(filtered, context)
                trades = self.simulator.simulate(filtered, signals, risk)
                metrics = calculate_metrics(
                    trades,
                    initial_capital=request.capital,
                    start_date=request.start_date,
                    end_date=request.end_date,
                )
                strategy_results.append(
                    {
                        "strategy": strategy.name,
                        "strategy_code": strategy.code,
                        "description": strategy.description,
                        "index": index_name,
                        "signals_generated": len(signals),
                        "trades": trades,
                        "metrics": metrics,
                    }
                )

        ranking = self.ranker.rank(strategy_results)
        score_lookup = {(item["strategy"], item["index"]): item["score"] for item in ranking.get("ranking", [])}
        for item in strategy_results:
            item["metrics"]["strategy_score"] = score_lookup.get((item["strategy"], item["index"]), 0.0)

        result = {
            "job_id": job_id,
            "request": asdict(request),
            "dataset_summary": dataset.metadata,
            "strategy_results": strategy_results,
            "ranking": ranking,
            "index_comparison": self._index_comparison(strategy_results),
            "generated_at": pd.Timestamp.utcnow().isoformat(),
            "report_path": "",
        }
        report_path = Path(report_dir) / f"{job_id}.xlsx"
        self.report_generator.generate(result, report_path)
        result["report_path"] = str(report_path)
        return result

    def _resolve_strategies(self, strategy_name: str) -> list[Any]:
        if strategy_name.lower().strip() in {"all", "*"}:
            return list(STRATEGY_REGISTRY.values())
        selected = get_strategy(strategy_name)
        return selected if isinstance(selected, list) else [selected]

    def _index_comparison(self, results: list[dict[str, Any]]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for item in results:
            metrics = item["metrics"]
            rows.append(
                {
                    "index": item["index"],
                    "strategy": item["strategy"],
                    "net_pnl": metrics.get("net_pnl"),
                    "win_rate": metrics.get("win_rate"),
                    "score": metrics.get("strategy_score"),
                }
            )
        return rows


class PaperTradingManager:
    def __init__(self, loader: HistoricalDataEngine | None = None) -> None:
        self.loader = loader or HistoricalDataEngine()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self.state: dict[str, Any] = {"running": False, "signals": [], "started_at": None}

    def start(self, *, dataset_path: str | Path, index: str, strategy_code: str, timeframe: str) -> dict[str, Any]:
        if self.state["running"]:
            return self.state
        self._stop.clear()
        self.state = {"running": True, "signals": [], "started_at": pd.Timestamp.utcnow().isoformat(), "index": index, "strategy": strategy_code}
        self._thread = threading.Thread(
            target=self._run_loop,
            kwargs={"dataset_path": str(dataset_path), "index": index, "strategy_code": strategy_code, "timeframe": timeframe},
            daemon=True,
        )
        self._thread.start()
        return self.state

    def stop(self) -> dict[str, Any]:
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self.state["running"] = False
        self.state["stopped_at"] = pd.Timestamp.utcnow().isoformat()
        return self.state

    def _run_loop(self, *, dataset_path: str, index: str, strategy_code: str, timeframe: str) -> None:
        dataset = self.loader.load_csv(dataset_path, timeframe=timeframe, index_filter=index)
        if dataset.options.empty:
            self.state["running"] = False
            self.state["error"] = "No option rows available for paper trading."
            return
        strategy = get_strategy(strategy_code)
        if isinstance(strategy, list):
            strategy = strategy[0]
        last_day = dataset.options["datetime"].dt.normalize().max()
        day_rows = dataset.options.loc[dataset.options["datetime"].dt.normalize() == last_day].sort_values("datetime")
        seen_times: set[str] = set()
        for current_time in day_rows["datetime"].drop_duplicates():
            if self._stop.is_set():
                break
            snapshot = _snapshot_until(dataset, pd.Timestamp(current_time))
            signals = strategy.generate_signals(snapshot, StrategyContext(timeframe=timeframe, top_signals_per_day=1))
            new_signals = [signal for signal in signals if signal.datetime.isoformat() not in seen_times]
            for signal in new_signals:
                seen_times.add(signal.datetime.isoformat())
                self.state["signals"].append(
                    {
                        "time": signal.datetime.isoformat(),
                        "signal": signal.signal,
                        "strategy": signal.strategy,
                        "confidence": signal.confidence,
                        "reasons": signal.reasons,
                    }
                )
            self.state["last_tick"] = pd.Timestamp(current_time).isoformat()
            time.sleep(0.05)
        self.state["running"] = False
        self.state["completed_at"] = pd.Timestamp.utcnow().isoformat()


def _snapshot_until(dataset: MarketDataset, cutoff: pd.Timestamp) -> MarketDataset:
    def _slice(frame: pd.DataFrame) -> pd.DataFrame:
        if frame.empty:
            return frame.copy()
        return frame.loc[frame["datetime"] <= cutoff].copy()

    return MarketDataset(
        raw=_slice(dataset.raw),
        options=_slice(dataset.options),
        spot=_slice(dataset.spot),
        futures=_slice(dataset.futures),
        metadata=dict(dataset.metadata),
    )
