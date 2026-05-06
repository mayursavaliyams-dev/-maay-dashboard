import json
import os
from pathlib import Path

import pandas as pd

import offline_backtest_viewer as viewer


OUT_DIR = Path("exports")
OUT_DIR.mkdir(exist_ok=True)
OUT_FILE = Path(os.environ["WHOLE_BACKTEST_OUT"]) if "WHOLE_BACKTEST_OUT" in os.environ else OUT_DIR / "whole-backtesting-complete.xlsx"

JSON_SOURCES = [
    ("Daily NIFTY", "backtest-daily-results-nifty.json"),
    ("Daily SENSEX", "backtest-daily-results-sensex.json"),
    ("Daily BANKNIFTY", "backtest-daily-results-banknifty.json"),
    ("TV NIFTY", "backtest-tv-results-nifty.json"),
    ("TV SENSEX", "backtest-tv-results-sensex.json"),
    ("TV BANKNIFTY", "backtest-tv-results-banknifty.json"),
]


def safe_sheet_name(name: str) -> str:
    bad = "[]:*?/\\"
    cleaned = "".join("_" if ch in bad else ch for ch in name)
    return cleaned[:31]


def load_report(path: str):
    p = Path(path)
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def trades_frame(report, default_instrument: str):
    trades = report.get("trades") or []
    df = pd.json_normalize(trades)
    if df.empty:
        df = pd.DataFrame()
    if "Instrument" not in df.columns:
        df["Instrument"] = report.get("config", {}).get("instrument") or report.get("instrument") or default_instrument
    normalized, _ = viewer.with_standard_parameters(df)
    if "OpeningCapital" in normalized.columns and "EquityBefore" in normalized.columns:
        normalized["OpeningCapital"] = normalized["EquityBefore"]
    if "ClosingCapital" in normalized.columns and "EquityAfter" in normalized.columns:
        normalized["ClosingCapital"] = normalized["EquityAfter"]
    normalized["PositionMode"] = "STEP-UP LADDER"
    normalized["PositionStart"] = 2500
    normalized["PositionStep"] = 2500
    normalized["MaxPosition"] = "NO LIMIT"
    normalized["NoLimitPosition"] = True
    normalized["PositionRule"] = "start 2500, step +2500 per 2500 profit, no max"
    return normalized


def summary_row(label: str, report: dict):
    stats = report.get("stats") or {}
    cfg = report.get("config") or {}
    return {
        "Name": label,
        "Instrument": cfg.get("instrument") or report.get("instrument") or "",
        "GeneratedAt": report.get("generatedAt", ""),
        "DataSource": report.get("dataSource", ""),
        "TotalExpiriesDays": report.get("totalExpiries", ""),
        "ExpiriesWithTrades": report.get("expiriesWithTrades", ""),
        "TotalTrades": stats.get("totalTrades", ""),
        "Wins": stats.get("wins", ""),
        "Losses": stats.get("losses", ""),
        "WinRate": stats.get("winRate", ""),
        "AvgMultiplier": stats.get("avgMultiplier", ""),
        "MedianMultiplier": stats.get("medianMultiplier", ""),
        "MaxMultiplier": stats.get("maxMultiplier", ""),
        "AvgPnlPct": stats.get("avgPnlPct", ""),
        "Hit2x": stats.get("hit2x", ""),
        "Hit5x": stats.get("hit5x", ""),
        "Hit10x": stats.get("hit10x", ""),
        "Hit50x": stats.get("hit50x", ""),
        "StartDate": cfg.get("startDate", ""),
        "EndDate": cfg.get("endDate", ""),
        "MaxTradesPerDay": cfg.get("maxTradesPerDay", ""),
        "PositionMode": "STEP-UP LADDER",
        "PositionStart": 2500,
        "PositionStep": 2500,
        "MaxPosition": "NO LIMIT",
        "NoLimitPosition": True,
        "PositionRule": "start 2500, step +2500 per 2500 profit, no max",
        "StopLossPct": (cfg.get("risk") or {}).get("stopLossPct", ""),
        "TargetPct": (cfg.get("risk") or {}).get("targetPct", ""),
        "TrailAfterMultiple": (cfg.get("risk") or {}).get("trailAfterMultiple", ""),
        "TrailLockPct": (cfg.get("risk") or {}).get("trailLockPct", ""),
    }


def ratio_row(label: str, df: pd.DataFrame):
    ratios = viewer.compute_ratios(df)
    return {"Name": label, **ratios}


def max_profit_rows(label: str, df: pd.DataFrame):
    cols = viewer.analysis_columns(df)
    pnl_col = cols["pnl"]
    if not pnl_col or df.empty:
        return []
    pnl = viewer.to_number(df[pnl_col])
    best_idx = pnl.idxmax()
    worst_idx = pnl.idxmin()
    best = df.loc[best_idx]
    worst = df.loc[worst_idx]
    date_col = cols["date"]
    type_col = viewer.find_col(df, "TradeType", "OptionType", "SignalType", "BuySell")
    reason_col = viewer.find_col(df, "ExitReason", "Reason")
    r = viewer.compute_ratios(df)
    return [{
        "Name": label,
        "Trades": r["Total Trades"],
        "NetPnl": r["Net P/L"],
        "GrossProfit": r["Gross Profit"],
        "GrossLoss": r["Gross Loss"],
        "WinRate": r["Win Rate %"],
        "ProfitFactor": r["Profit Factor"],
        "BestTradeDate": best.get(date_col, "") if date_col else "",
        "BestTradeType": best.get(type_col, "") if type_col else "",
        "BestTradeReason": best.get(reason_col, "") if reason_col else "",
        "BestTradePnl": pnl.loc[best_idx],
        "WorstTradeDate": worst.get(date_col, "") if date_col else "",
        "WorstTradeType": worst.get(type_col, "") if type_col else "",
        "WorstTradeReason": worst.get(reason_col, "") if reason_col else "",
        "WorstTradePnl": pnl.loc[worst_idx],
    }]


def yearly_frame(report: dict, label: str):
    rows = []
    for year, item in (report.get("stats", {}).get("byYear") or {}).items():
        trades = item.get("trades", 0) or 0
        wins = item.get("wins", 0) or 0
        rows.append({
            "Name": label,
            "Year": year,
            "Trades": trades,
            "Wins": wins,
            "Losses": trades - wins,
            "WinRate": round(wins / trades * 100, 2) if trades else 0,
            "TotalPnl": item.get("totalPnl", 0),
            "AvgPnl": round((item.get("totalPnl", 0) or 0) / trades, 2) if trades else 0,
        })
    return pd.DataFrame(rows)


def reason_frame(report: dict, label: str):
    rows = []
    reasons = report.get("stats", {}).get("byReason") or report.get("stats", {}).get("exitReasons") or {}
    total = report.get("stats", {}).get("totalTrades") or 0
    for reason, count in reasons.items():
        rows.append({
            "Name": label,
            "Reason": reason,
            "Trades": count,
            "SharePct": round(count / total * 100, 2) if total else 0,
        })
    return pd.DataFrame(rows)


def type_frame(report: dict, label: str):
    rows = []
    for trade_type, item in (report.get("stats", {}).get("byType") or {}).items():
        trades = item.get("trades", 0) or 0
        wins = item.get("wins", 0) or 0
        rows.append({
            "Name": label,
            "Type": trade_type,
            "Trades": trades,
            "Wins": wins,
            "Losses": trades - wins,
            "WinRate": round(wins / trades * 100, 2) if trades else 0,
        })
    return pd.DataFrame(rows)


def main():
    summaries = []
    ratios = []
    max_profit = []
    yearly = []
    reasons = []
    types = []
    trade_sheets = []
    all_trades = []

    for label, source in JSON_SOURCES:
        report = load_report(source)
        if not report:
            continue
        df = trades_frame(report, label.split()[-1])
        summaries.append(summary_row(label, report))
        ratios.append(ratio_row(label, df))
        max_profit.extend(max_profit_rows(label, df))
        yearly.append(yearly_frame(report, label))
        reasons.append(reason_frame(report, label))
        types.append(type_frame(report, label))
        trade_sheets.append((label, df))
        if not df.empty:
            combined = df.copy()
            combined.insert(0, "BacktestSet", label)
            all_trades.append(combined)

    with pd.ExcelWriter(OUT_FILE, engine="openpyxl") as writer:
        pd.DataFrame(summaries).to_excel(writer, sheet_name="Summary", index=False)
        pd.DataFrame(ratios).to_excel(writer, sheet_name="Ratio Analysis", index=False)
        if max_profit:
            pd.DataFrame(max_profit).sort_values("NetPnl", ascending=False).to_excel(writer, sheet_name="Max Profit", index=False)

        if yearly:
            pd.concat(yearly, ignore_index=True).to_excel(writer, sheet_name="Yearly", index=False)
        if reasons:
            pd.concat(reasons, ignore_index=True).to_excel(writer, sheet_name="Exit Reasons", index=False)
        if types:
            pd.concat(types, ignore_index=True).to_excel(writer, sheet_name="By Type", index=False)
        if all_trades:
            pd.concat(all_trades, ignore_index=True).to_excel(writer, sheet_name="All Trades", index=False)

        for label, df in trade_sheets:
            df.to_excel(writer, sheet_name=safe_sheet_name(label), index=False)

        pd.DataFrame(columns=viewer.ALL_PARAMETERS).to_excel(writer, sheet_name="Parameter Template", index=False)

    print(OUT_FILE.resolve())


if __name__ == "__main__":
    main()
