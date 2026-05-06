import json
from pathlib import Path

import pandas as pd

import offline_backtest_viewer as viewer


OUT_DIR = Path("exports")
OUT_DIR.mkdir(exist_ok=True)
OUT_FILE = OUT_DIR / "best-backtest-one-result.xlsx"

SOURCES = [
    ("Daily NIFTY", "backtest-daily-results-nifty.json"),
    ("Daily SENSEX", "backtest-daily-results-sensex.json"),
    ("Daily BANKNIFTY", "backtest-daily-results-banknifty.json"),
    ("TV NIFTY", "backtest-tv-results-nifty.json"),
    ("TV SENSEX", "backtest-tv-results-sensex.json"),
    ("TV BANKNIFTY", "backtest-tv-results-banknifty.json"),
]


def load_report(path):
    p = Path(path)
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def trades_df(label, report):
    df = pd.json_normalize(report.get("trades") or [])
    if df.empty:
        return df
    instrument = report.get("config", {}).get("instrument") or report.get("instrument") or label.split()[-1]
    df["BacktestSet"] = label
    df["Instrument"] = instrument
    df["PositionMode"] = "STEP-UP LADDER"
    df["PositionStart"] = 2500
    df["PositionStep"] = 2500
    df["MaxPosition"] = "NO LIMIT"
    df["NoLimitPosition"] = True
    df["PositionRule"] = "start 2500, step +2500 per 2500 profit, no max"
    normalized, _ = viewer.with_standard_parameters(df)
    return normalized


def row_for(label, report):
    df = trades_df(label, report)
    ratios = viewer.compute_ratios(df) if not df.empty else {}
    stats = report.get("stats") or {}
    cfg = report.get("config") or {}
    risk = cfg.get("risk") or {}

    return {
        "BacktestSet": label,
        "Instrument": cfg.get("instrument") or report.get("instrument") or label.split()[-1],
        "GeneratedAt": report.get("generatedAt", ""),
        "DataSource": report.get("dataSource", ""),
        "StartDate": cfg.get("startDate", "2006-01-01" if label.startswith("Daily") else "1999"),
        "EndDate": cfg.get("endDate", "Till Date"),
        "DaysOrExpiries": report.get("totalExpiries", ""),
        "Trades": ratios.get("Total Trades", stats.get("totalTrades", 0)),
        "Wins": ratios.get("Winning Trades", stats.get("wins", 0)),
        "Losses": ratios.get("Losing Trades", stats.get("losses", 0)),
        "WinRatePct": ratios.get("Win Rate %", stats.get("winRate", 0)),
        "GrossProfit": ratios.get("Gross Profit", 0),
        "GrossLoss": ratios.get("Gross Loss", 0),
        "NetPnl": ratios.get("Net P/L", 0),
        "AverageProfit": ratios.get("Average Profit", 0),
        "AverageLoss": ratios.get("Average Loss", 0),
        "ProfitFactor": ratios.get("Profit Factor", 0),
        "PayoffRatio": ratios.get("Payoff Ratio", 0),
        "ExpectancyPerTrade": ratios.get("Expectancy / Trade", 0),
        "AvgMultiplier": stats.get("avgMultiplier", ratios.get("Average Multiplier", 0)),
        "MaxMultiplier": stats.get("maxMultiplier", ratios.get("Max Multiplier", 0)),
        "Hit2x": stats.get("hit2x", 0),
        "Hit5x": stats.get("hit5x", 0),
        "OpeningCapital": ratios.get("Opening Capital", 0),
        "ClosingCapital": ratios.get("Closing Capital", 0),
        "ReturnPct": ratios.get("Return %", 0),
        "MaxDrawdown": ratios.get("Max Drawdown", 0),
        "RecoveryFactor": ratios.get("Recovery Factor", 0),
        "PositionMode": "STEP-UP LADDER",
        "PositionStart": 2500,
        "PositionStep": 2500,
        "MaxPosition": "NO LIMIT",
        "NoLimitPosition": True,
        "PositionRule": "start 2500, step +2500 per 2500 profit, no max",
        "MaxTradesPerDay": cfg.get("maxTradesPerDay", 6 if label.startswith("Daily") else ""),
        "StopLossPct": risk.get("stopLossPct", 10 if label.startswith("Daily") else 35),
        "TargetPct": risk.get("targetPct", 400 if label.startswith("Daily") else 150),
        "TrailAfterMultiple": risk.get("trailAfterMultiple", 2),
        "TrailLockPct": risk.get("trailLockPct", 50),
        "SourceFile": "",
    }


def best_row(rows):
    if not rows:
        return []
    best = max(rows, key=lambda row: float(row.get("NetPnl") or 0))
    return [{
        "Result": "BEST BACKTEST",
        "RankBy": "NetPnl",
        **best,
    }]


def main():
    rows = []
    for label, source in SOURCES:
        report = load_report(source)
        if not report:
            continue
        row = row_for(label, report)
        row["SourceFile"] = source
        rows.append(row)

    output = best_row(rows)

    with pd.ExcelWriter(OUT_FILE, engine="openpyxl") as writer:
        pd.DataFrame(output).to_excel(writer, sheet_name="Best Backtest", index=False)
        pd.DataFrame(columns=viewer.ALL_PARAMETERS).to_excel(writer, sheet_name="Parameter Template", index=False)

    print(OUT_FILE.resolve())


if __name__ == "__main__":
    main()
