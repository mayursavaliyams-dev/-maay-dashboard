from __future__ import annotations

from pathlib import Path

import pandas as pd
from openpyxl import load_workbook

from backend.backtesting.data_loader import HistoricalDataEngine
from backend.backtesting.engine import BacktestEngine, BacktestRunRequest
from backend.backtesting.metrics import calculate_metrics
from backend.backtesting.report_excel import ExcelReportGenerator
from backend.backtesting.strategies.premium_breakout import PremiumBreakoutStrategy


def build_sample_csv(path: Path) -> Path:
    rows = []
    expiry = "2026-05-07"
    strike_pack = [24400, 24500, 24600]
    day_specs = [("2026-05-01", 24400, 1), ("2026-05-02", 24550, -1)]
    for day, base_spot, direction in day_specs:
        times = pd.date_range(f"{day} 09:15:00", periods=14, freq="5min")
        for idx, dt in enumerate(times):
            spot = base_spot + direction * idx * 22
            rows.append(
                {
                    "datetime": dt,
                    "index": "NIFTY",
                    "record_type": "SPOT",
                    "expiry": "",
                    "strike": "",
                    "option_type": "",
                    "open": spot - 5,
                    "high": spot + 8,
                    "low": spot - 9,
                    "close": spot,
                    "ltp": spot,
                    "volume": 0,
                    "oi": 0,
                    "iv": "",
                    "delta": "",
                    "gamma": "",
                    "theta": "",
                    "vega": "",
                    "spot_open": spot - 5,
                    "spot_high": spot + 8,
                    "spot_low": spot - 9,
                    "spot_close": spot,
                    "futures_close": spot + 4,
                }
            )
            for strike in strike_pack:
                distance = strike - spot
                ce_price = max(18, 115 + direction * idx * 12 - max(distance, 0) * 0.08 + max(-distance, 0) * 0.02)
                pe_price = max(16, 108 - direction * idx * 11 + max(distance, 0) * 0.03 + max(-distance, 0) * 0.09)
                for option_type, price, delta in [("CE", ce_price, 0.42), ("PE", pe_price, -0.43)]:
                    rows.append(
                        {
                            "datetime": dt,
                            "index": "NIFTY",
                            "record_type": "OPTION",
                            "expiry": expiry,
                            "strike": strike,
                            "option_type": option_type,
                            "open": round(price * 0.98, 2),
                            "high": round(price * 1.05, 2),
                            "low": round(price * 0.96, 2),
                            "close": round(price, 2),
                            "ltp": round(price, 2),
                            "volume": 15000 + idx * 1100 + (400 if strike == 24500 else 0),
                            "oi": 200000 + idx * 3500 + (1200 if option_type == "CE" else 900),
                            "iv": 13.5 + idx * 0.2,
                            "delta": delta,
                            "gamma": 0.012 + idx * 0.0004,
                            "theta": -2.4 - idx * 0.05,
                            "vega": 8.0 + idx * 0.1,
                            "spot_open": spot - 5,
                            "spot_high": spot + 8,
                            "spot_low": spot - 9,
                            "spot_close": spot,
                            "futures_close": spot + 4,
                        }
                    )
    pd.DataFrame(rows).to_csv(path, index=False)
    return path


def test_data_loading(tmp_path: Path):
    csv_path = build_sample_csv(tmp_path / "sample.csv")
    loader = HistoricalDataEngine()
    dataset = loader.load_csv(csv_path, timeframe="5m", index_filter="NIFTY")
    assert not dataset.options.empty
    assert "NIFTY" in dataset.metadata["indices"]
    assert {"datetime", "spot_close", "volume_ratio", "premium_jump_pct"}.issubset(dataset.options.columns)


def test_strategy_signal_generation(tmp_path: Path):
    csv_path = build_sample_csv(tmp_path / "sample.csv")
    dataset = HistoricalDataEngine().load_csv(csv_path, timeframe="5m", index_filter="NIFTY")
    strategy = PremiumBreakoutStrategy()
    signals = strategy.generate_signals(dataset, context=strategy_context())
    assert signals
    assert {signal.signal for signal in signals}.issubset({"BUY_CALL", "BUY_PUT"})


def test_backtest_run(tmp_path: Path):
    csv_path = build_sample_csv(tmp_path / "sample.csv")
    engine = BacktestEngine()
    request = BacktestRunRequest(
        index="NIFTY",
        strategy="combined_ai",
        start_date="2026-05-01",
        end_date="2026-05-02",
        capital=200000,
        lot_size=50,
        timeframe="5m",
    )
    result = engine.run(request, dataset_path=csv_path, job_id="unit_job", report_dir=tmp_path)
    assert result["strategy_results"]
    assert Path(result["report_path"]).exists()
    assert result["ranking"]["ranking"]


def test_metrics_calculation():
    trades = [
        {"entry_time": "2026-05-01T09:20:00", "exit_time": "2026-05-01T09:45:00", "strategy": "A", "index": "NIFTY", "signal": "BUY_CALL", "strike": 24500, "return_pct": 12.5, "net_pnl": 2500, "gross_pnl": 2540, "exit_reason": "TARGET", "market_regime": "TRENDING", "volatility_regime": "HIGH_VOL"},
        {"entry_time": "2026-05-02T10:00:00", "exit_time": "2026-05-02T10:25:00", "strategy": "A", "index": "NIFTY", "signal": "BUY_PUT", "strike": 24500, "return_pct": -5.2, "net_pnl": -1200, "gross_pnl": -1160, "exit_reason": "STOP_LOSS", "market_regime": "SIDEWAYS", "volatility_regime": "LOW_VOL"},
    ]
    metrics = calculate_metrics(trades, initial_capital=100000, start_date="2026-05-01", end_date="2026-05-02")
    assert metrics["total_trades"] == 2
    assert metrics["winning_trades"] == 1
    assert metrics["net_pnl"] == 1300.0
    assert metrics["best_trade"]["exit_reason"] == "TARGET"


def test_excel_report_generation(tmp_path: Path):
    csv_path = build_sample_csv(tmp_path / "sample.csv")
    engine = BacktestEngine()
    request = BacktestRunRequest(index="NIFTY", strategy="premium_breakout", start_date="2026-05-01", end_date="2026-05-02", capital=200000, lot_size=50, timeframe="5m")
    result = engine.run(request, dataset_path=csv_path, job_id="excel_job", report_dir=tmp_path)
    report_path = Path(result["report_path"])
    workbook = load_workbook(report_path)
    assert "Dashboard" in workbook.sheetnames
    assert "Strategy Ranking" in workbook.sheetnames
    assert "Trade Book" in workbook.sheetnames
    assert "Best Worst Trades" in workbook.sheetnames


def strategy_context():
    from backend.backtesting.strategies.base import StrategyContext

    return StrategyContext(timeframe="5m", top_signals_per_day=2)
