import json
from pathlib import Path

import pandas as pd

import offline_backtest_viewer as viewer


OUT_DIR = Path("exports")
OUT_DIR.mkdir(exist_ok=True)
OUT_FILE = OUT_DIR / "whole-trade-detail-2006-till-date.xlsx"
START_DATE = "2006-01-01"

SOURCES = [
    ("Daily NIFTY", "backtest-daily-results-nifty.json"),
    ("Daily SENSEX", "backtest-daily-results-sensex.json"),
    ("Daily BANKNIFTY", "backtest-daily-results-banknifty.json"),
    ("TV NIFTY", "backtest-tv-results-nifty.json"),
    ("TV SENSEX", "backtest-tv-results-sensex.json"),
    ("TV BANKNIFTY", "backtest-tv-results-banknifty.json"),
]


def safe_sheet_name(name):
    bad = "[]:*?/\\"
    return "".join("_" if ch in bad else ch for ch in name)[:31]


def load_report(path):
    p = Path(path)
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def normalized_trades(label, path):
    report = load_report(path)
    if not report:
        return pd.DataFrame(), None

    trades = report.get("trades") or []
    df = pd.json_normalize(trades)
    if df.empty:
        return pd.DataFrame(), report

    instrument = report.get("config", {}).get("instrument") or report.get("instrument") or label.split()[-1]
    if "Instrument" not in df.columns:
        df["Instrument"] = instrument
    df["BacktestSet"] = label
    df["BacktestStartDate"] = START_DATE
    df["BacktestEndDate"] = "Till Date"
    df["PositionMode"] = "STEP-UP LADDER"
    df["PositionStart"] = 2500
    df["PositionStep"] = 2500
    df["MaxPosition"] = "NO LIMIT"
    df["NoLimitPosition"] = True
    df["PositionRule"] = "start 2500, step +2500 per 2500 profit, no max"

    normalized, _ = viewer.with_standard_parameters(df)
    date_col = viewer.find_col(normalized, "Date")
    if date_col:
        normalized = normalized[normalized[date_col].astype(str) >= START_DATE]
    return normalized, report


def summary_row(label, df, report):
    ratios = viewer.compute_ratios(df) if not df.empty else {}
    cfg = (report or {}).get("config", {})
    return {
        "BacktestSet": label,
        "Instrument": cfg.get("instrument") or (df["Instrument"].dropna().iloc[0] if not df.empty and "Instrument" in df else ""),
        "StartDate": START_DATE,
        "EndDate": "Till Date",
        "Rows": len(df),
        "GeneratedAt": (report or {}).get("generatedAt", ""),
        "SourceTotalDays": (report or {}).get("totalExpiries", ""),
        "SourceTrades": ((report or {}).get("stats") or {}).get("totalTrades", ""),
        "TradesInFile": ratios.get("Total Trades", 0),
        "WinningTrades": ratios.get("Winning Trades", 0),
        "LosingTrades": ratios.get("Losing Trades", 0),
        "WinRate": ratios.get("Win Rate %", 0),
        "GrossProfit": ratios.get("Gross Profit", 0),
        "GrossLoss": ratios.get("Gross Loss", 0),
        "NetPnl": ratios.get("Net P/L", 0),
        "ProfitFactor": ratios.get("Profit Factor", 0),
        "PositionStart": 2500,
        "PositionStep": 2500,
        "MaxPosition": "NO LIMIT",
    }


def main():
    all_frames = []
    summaries = []
    per_source = []

    for label, path in SOURCES:
        df, report = normalized_trades(label, path)
        summaries.append(summary_row(label, df, report))
        if not df.empty:
            all_frames.append(df)
            per_source.append((label, df))

    all_trades = pd.concat(all_frames, ignore_index=True) if all_frames else pd.DataFrame()

    with pd.ExcelWriter(OUT_FILE, engine="openpyxl") as writer:
        all_trades.to_excel(writer, sheet_name="All Trade Detail", index=False)
        pd.DataFrame(summaries).to_excel(writer, sheet_name="Summary", index=False)

        if not all_trades.empty:
            ratios = viewer.compute_ratios(all_trades)
            pd.DataFrame([ratios]).to_excel(writer, sheet_name="Whole P&L", index=False)

        for label, df in per_source:
            df.to_excel(writer, sheet_name=safe_sheet_name(label), index=False)

        pd.DataFrame(columns=viewer.ALL_PARAMETERS).to_excel(writer, sheet_name="Parameter Template", index=False)

    print(OUT_FILE.resolve())
    print(f"All trade rows: {len(all_trades)}")


if __name__ == "__main__":
    main()
