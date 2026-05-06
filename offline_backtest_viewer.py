"""
Offline Backtest Result Viewer

Open an Excel/CSV backtest result file, inspect order details, and view
profit/loss and equity charts. This app runs locally with Tkinter.

Required packages:
  pip install pandas openpyxl matplotlib
"""

from __future__ import annotations

import os
import json
import sys
import tkinter as tk
from tkinter import filedialog, messagebox, ttk


try:
    import pandas as pd
except Exception as exc:  # pragma: no cover - shown in GUI/console
    pd = None
    PANDAS_ERROR = exc
else:
    PANDAS_ERROR = None

try:
    from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
    from matplotlib.figure import Figure
except Exception as exc:  # pragma: no cover - shown in GUI/console
    FigureCanvasTkAgg = None
    Figure = None
    MATPLOTLIB_ERROR = exc
else:
    MATPLOTLIB_ERROR = None


PREFERRED_FILES = [
    "exports/daily-nifty-sensex-banknifty-profit-loss.xlsx",
    "exports/daily-all-indices-6trades-equity-500000-position-2500-nolimit-ladder-charges-0.09-all-date-wise-rounded-graph.xlsx",
    "exports/nifty-sensex-banknifty-profit-loss.xlsx",
    "backtest-daily-results-nifty.json",
    "backtest-daily-results-sensex.json",
    "backtest-tv-results-sensex.json",
]

PARAMETER_GROUPS = {
    "Basic Trade Fields": [
        "Date", "Instrument", "Symbol", "Segment", "TradeType", "BuySell",
        "Quantity", "BuyPrice", "SellPrice", "EntryPrice", "ExitPrice",
        "EntryTime", "ExitTime",
    ],
    "Profit/Loss Fields": [
        "GrossProfit", "GrossLoss", "GrossPnl", "NetProfit", "NetLoss",
        "NetPnl", "PnlAmount", "PnlPercent", "RealizedPnl", "UnrealizedPnl",
    ],
    "Charges": [
        "Brokerage", "ExchangeCharges", "STT", "GST", "SEBICharges",
        "StampDuty", "TotalCharges", "NetPnlAfterCharges",
    ],
    "Result Metrics": [
        "Result", "WinLoss", "WinRate", "LossRate", "TotalTrades",
        "WinningTrades", "LosingTrades", "AverageProfit", "AverageLoss",
        "ProfitFactor", "RiskRewardRatio",
    ],
    "Capital / Equity": [
        "OpeningCapital", "ClosingCapital", "CapitalUsed", "PositionSize",
        "MarginUsed", "EquityBefore", "EquityAfter", "Drawdown",
        "DrawdownPercent", "MaxDrawdown",
    ],
    "Backtest Export Summary": [
        "StartingCapital", "FinalEquity", "NetProfitPct", "RealisticAccuracy",
        "RawWinRate", "ChargePerOrderPct", "MinPosition",
    ],
    "Position Step-Up": [
        "PositionMode", "PositionStart", "PositionStep", "MaxPosition",
        "NoLimitPosition", "PositionRule",
    ],
    "Backtest Specific": [
        "StrategyName", "SignalType", "ExitReason", "Multiplier", "Strike",
        "OptionType", "ExpiryDate", "LotSize", "Lots", "BacktestStartDate",
        "BacktestEndDate",
    ],
}

ALL_PARAMETERS = [name for group in PARAMETER_GROUPS.values() for name in group]

PARAMETER_ALIASES = {
    "Date": ["Date", "date"],
    "Instrument": ["Instrument", "Symbol"],
    "Symbol": ["Symbol", "Instrument"],
    "TradeType": ["TradeType", "Type", "Side", "OptionType", "type"],
    "BuySell": ["BuySell", "Side", "Type", "type"],
    "Quantity": ["Quantity", "Qty"],
    "BuyPrice": ["BuyPrice", "EntryPrice", "entryPrice"],
    "SellPrice": ["SellPrice", "ExitPrice", "exitPrice"],
    "EntryPrice": ["EntryPrice", "BuyPrice", "entryPrice"],
    "ExitPrice": ["ExitPrice", "SellPrice", "exitPrice"],
    "GrossProfit": ["GrossProfit", "GrossPnl", "Win_GrossPnl"],
    "GrossLoss": ["GrossLoss", "GrossPnl", "Loss_GrossPnl"],
    "NetProfit": ["NetProfit", "NetPnl", "Win_NetPnl"],
    "NetLoss": ["NetLoss", "NetPnl", "Loss_NetPnl"],
    "PnlAmount": ["PnlAmount", "NetPnl", "GrossPnl", "NetProfit"],
    "PnlPercent": ["PnlPercent", "P/L %", "Pnl %", "P/L", "pnlPct", "NetPnl"],
    "RealizedPnl": ["RealizedPnl", "NetPnl", "GrossPnl"],
    "Brokerage": ["Brokerage", "BuySellCharges", "TotalCharges", "ChargePerOrderPct"],
    "NetPnlAfterCharges": ["NetPnlAfterCharges", "NetPnl", "NetProfit"],
    "Result": ["Result", "RawResult", "win"],
    "WinLoss": ["WinLoss", "Result", "RawResult", "win"],
    "EquityBefore": ["EquityBefore", "StartEquity", "OpeningCapital", "StartingCapital"],
    "EquityAfter": ["EquityAfter", "EndEquity", "ClosingCapital", "FinalEquity", "Equity"],
    "OpeningCapital": ["OpeningCapital", "StartEquity", "EquityBefore", "StartingCapital"],
    "ClosingCapital": ["ClosingCapital", "EndEquity", "EquityAfter", "FinalEquity", "Equity"],
    "CapitalUsed": ["CapitalUsed", "Deployed"],
    "PositionMode": ["PositionMode", "PositionRule"],
    "PositionStart": ["PositionStart", "MinPosition"],
    "PositionStep": ["PositionStep", "PositionStepSize"],
    "MaxPosition": ["MaxPosition"],
    "NoLimitPosition": ["NoLimitPosition"],
    "PositionRule": ["PositionRule"],
    "DrawdownPercent": ["DrawdownPercent", "DrawdownPct", "Drawdown"],
    "ExitReason": ["ExitReason", "Reason", "reason"],
    "SignalType": ["SignalType", "Type", "Side", "type"],
    "Multiplier": ["Multiplier", "multiplier"],
    "Strike": ["Strike", "strike"],
    "OptionType": ["OptionType", "Type", "Side", "type"],
    "LotSize": ["LotSize", "lotSize"],
    "Lots": ["Lots", "lots"],
}


def column_key(value):
    return "".join(ch for ch in str(value).strip().lower() if ch.isalnum())


def normalize_columns(columns):
    return {column_key(col): col for col in columns}


def find_col(df, *names):
    lookup = normalize_columns(df.columns)
    for name in names:
        col = lookup.get(column_key(name))
        if col is not None:
            return col
    return None


def to_number(series):
    return pd.to_numeric(series, errors="coerce").fillna(0)


def dataframe_from_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)

    if isinstance(data, list):
        return pd.json_normalize(data)
    if isinstance(data, dict):
        if isinstance(data.get("trades"), list):
            return pd.json_normalize(data["trades"])
        if isinstance(data.get("data"), list):
            return pd.json_normalize(data["data"])
        return pd.json_normalize([data])
    return pd.DataFrame()


def expand_win_loss_sheet(df):
    has_win_loss = any(str(col).startswith("Win_") for col in df.columns) or any(str(col).startswith("Loss_") for col in df.columns)
    if not has_win_loss:
        return df

    rows = []
    for _, row in df.iterrows():
        for prefix, result in [("Win_", "WIN"), ("Loss_", "LOSS")]:
            trade = {}
            has_value = False
            for col in df.columns:
                name = str(col)
                if not name.startswith(prefix):
                    continue
                target = name[len(prefix):]
                value = row[col]
                if pd.notna(value) and str(value).strip() != "":
                    has_value = True
                trade[target] = value
            if has_value:
                trade["Result"] = result
                rows.append(trade)
    return pd.DataFrame(rows) if rows else df


def source_column(df, parameter):
    aliases = PARAMETER_ALIASES.get(parameter, [parameter])
    return find_col(df, *aliases)


def with_standard_parameters(df):
    original_columns = list(df.columns)
    out = df.copy()

    for parameter in ALL_PARAMETERS:
        col = source_column(out, parameter)
        if col is not None and parameter not in out.columns:
            out[parameter] = out[col]
        elif parameter not in out.columns:
            out[parameter] = ""

    if "GrossProfit" in out.columns and "GrossPnl" in out.columns:
        pnl = to_number(out["GrossPnl"])
        out["GrossProfit"] = pnl.where(pnl > 0, 0)
        out["GrossLoss"] = pnl.where(pnl < 0, 0)

    if "NetProfit" in out.columns and "NetPnl" in out.columns:
        pnl = to_number(out["NetPnl"])
        out["NetProfit"] = pnl.where(pnl > 0, 0)
        out["NetLoss"] = pnl.where(pnl < 0, 0)
        if "PnlAmount" in out.columns:
            out["PnlAmount"] = pnl
        if "RealizedPnl" in out.columns:
            out["RealizedPnl"] = pnl

    if "NetPnlAfterCharges" in out.columns and "NetPnl" in out.columns:
        out["NetPnlAfterCharges"] = out["NetPnl"]

    if "WinLoss" in out.columns and "Result" in out.columns:
        out["WinLoss"] = out["Result"]

    for col in ["Result", "WinLoss"]:
        if col in out.columns:
            out[col] = out[col].replace({True: "WIN", False: "LOSS", "True": "WIN", "False": "LOSS"})

    if "TotalTrades" in out.columns:
        out["TotalTrades"] = len(out)

    result_col = find_col(out, "Result", "WinLoss", "RawResult")
    if result_col:
        result_values = out[result_col].astype(str).str.upper()
        wins = int(result_values.isin(["WIN", "PROFIT"]).sum())
        losses = int(result_values.isin(["LOSS"]).sum())
        total = wins + losses
        win_rate = (wins / total * 100) if total else 0
        loss_rate = (losses / total * 100) if total else 0
        out["WinningTrades"] = wins
        out["LosingTrades"] = losses
        out["WinRate"] = round(win_rate, 2)
        out["LossRate"] = round(loss_rate, 2)

    pnl_col = find_col(out, "NetPnl", "GrossPnl", "PnlAmount", "PnlPercent")
    if pnl_col:
        pnl = to_number(out[pnl_col])
        profits = pnl[pnl > 0]
        losses = pnl[pnl < 0]
        avg_profit = profits.mean() if not profits.empty else 0
        avg_loss = losses.mean() if not losses.empty else 0
        profit_factor = profits.sum() / abs(losses.sum()) if losses.sum() else 0
        out["AverageProfit"] = round(float(avg_profit), 2)
        out["AverageLoss"] = round(float(avg_loss), 2)
        out["ProfitFactor"] = round(float(profit_factor), 3)

    drawdown_col = find_col(out, "DrawdownPct", "DrawdownPercent", "Drawdown")
    if drawdown_col:
        dd = to_number(out[drawdown_col])
        out["MaxDrawdown"] = round(float(dd.max()), 2) if len(dd) else 0

    ordered = ALL_PARAMETERS + [col for col in original_columns if col not in ALL_PARAMETERS]
    return out.loc[:, [col for col in ordered if col in out.columns]], original_columns


def best_numeric_column(df, *names):
    for name in names:
        col = find_col(df, name)
        if col is None:
            continue
        values = to_number(df[col])
        if values.abs().sum() != 0:
            return col
    for name in names:
        col = find_col(df, name)
        if col is not None:
            return col
    return None


def analysis_columns(df):
    return {
        "date": find_col(df, "Date"),
        "instrument": find_col(df, "Instrument", "Symbol"),
        "result": find_col(df, "Result", "WinLoss", "RawResult"),
        "pnl": best_numeric_column(df, "NetPnlAfterCharges", "NetPnl", "PnlAmount", "GrossPnl", "PnlPercent"),
        "gross": best_numeric_column(df, "GrossPnl", "GrossProfit", "PnlAmount", "PnlPercent"),
        "charges": best_numeric_column(df, "TotalCharges", "Brokerage"),
        "equity_before": best_numeric_column(df, "EquityBefore", "OpeningCapital", "StartEquity"),
        "equity_after": best_numeric_column(df, "EquityAfter", "ClosingCapital", "EndEquity"),
        "drawdown": best_numeric_column(df, "DrawdownPercent", "DrawdownPct", "Drawdown", "MaxDrawdown"),
        "multiplier": best_numeric_column(df, "Multiplier"),
    }


def compute_ratios(df):
    cols = analysis_columns(df)
    pnl = to_number(df[cols["pnl"]]) if cols["pnl"] else pd.Series([0] * len(df))
    profits = pnl[pnl > 0]
    losses = pnl[pnl < 0]

    if cols["result"]:
        result_values = df[cols["result"]].astype(str).str.upper()
        wins = int(result_values.isin(["WIN", "PROFIT", "TRUE"]).sum())
        loss_count = int(result_values.isin(["LOSS", "FALSE"]).sum())
    else:
        wins = int((pnl > 0).sum())
        loss_count = int((pnl < 0).sum())

    total = len(df)
    decided_total = wins + loss_count
    win_rate = wins / decided_total * 100 if decided_total else 0
    loss_rate = loss_count / decided_total * 100 if decided_total else 0

    gross_profit = float(profits.sum())
    gross_loss = float(losses.sum())
    net_pnl = gross_profit + gross_loss
    avg_profit = float(profits.mean()) if not profits.empty else 0
    avg_loss = float(losses.mean()) if not losses.empty else 0
    profit_factor = gross_profit / abs(gross_loss) if gross_loss else 0
    payoff_ratio = avg_profit / abs(avg_loss) if avg_loss else 0
    expectancy = (win_rate / 100 * avg_profit) + (loss_rate / 100 * avg_loss)

    equity_before = to_number(df[cols["equity_before"]]) if cols["equity_before"] else pd.Series(dtype=float)
    equity_after = to_number(df[cols["equity_after"]]) if cols["equity_after"] else pd.Series(dtype=float)
    opening_capital = float(equity_before.iloc[0]) if len(equity_before) else 0
    closing_capital = float(equity_after.iloc[-1]) if len(equity_after) else 0
    return_pct = ((closing_capital - opening_capital) / opening_capital * 100) if opening_capital else 0

    drawdown = to_number(df[cols["drawdown"]]) if cols["drawdown"] else pd.Series(dtype=float)
    max_drawdown = float(drawdown.max()) if len(drawdown) else 0
    recovery_factor = net_pnl / abs(max_drawdown) if max_drawdown else 0

    multiplier = to_number(df[cols["multiplier"]]) if cols["multiplier"] else pd.Series(dtype=float)
    avg_multiplier = float(multiplier.mean()) if len(multiplier) else 0
    max_multiplier = float(multiplier.max()) if len(multiplier) else 0

    charges = to_number(df[cols["charges"]]) if cols["charges"] else pd.Series(dtype=float)
    total_charges = float(charges.sum()) if len(charges) else 0

    return {
        "Total Trades": total,
        "Winning Trades": wins,
        "Losing Trades": loss_count,
        "Win Rate %": win_rate,
        "Loss Rate %": loss_rate,
        "Gross Profit": gross_profit,
        "Gross Loss": gross_loss,
        "Net P/L": net_pnl,
        "Average Profit": avg_profit,
        "Average Loss": avg_loss,
        "Profit Factor": profit_factor,
        "Payoff Ratio": payoff_ratio,
        "Expectancy / Trade": expectancy,
        "Opening Capital": opening_capital,
        "Closing Capital": closing_capital,
        "Return %": return_pct,
        "Max Drawdown": max_drawdown,
        "Recovery Factor": recovery_factor,
        "Total Charges": total_charges,
        "Average Multiplier": avg_multiplier,
        "Max Multiplier": max_multiplier,
    }


def format_metric(value):
    if isinstance(value, (int, float)):
        return f"{value:,.2f}"
    return str(value)


MONEY_METRIC_NAMES = {
    "Gross Profit", "Gross Loss", "Net P/L", "Average Profit", "Average Loss",
    "Expectancy / Trade", "Opening Capital", "Closing Capital", "Max Drawdown",
    "Recovery Factor", "Total Charges", "Profit", "Loss", "Charges",
    "Closing Equity", "Capital Used", "Margin Used",
}

MONEY_COLUMN_NAMES = {
    "GrossProfit", "GrossLoss", "GrossPnl", "NetProfit", "NetLoss", "NetPnl",
    "PnlAmount", "RealizedPnl", "UnrealizedPnl", "Brokerage",
    "ExchangeCharges", "STT", "GST", "SEBICharges", "StampDuty",
    "TotalCharges", "NetPnlAfterCharges", "OpeningCapital", "ClosingCapital",
    "CapitalUsed", "PositionSize", "MarginUsed", "EquityBefore", "EquityAfter",
    "Drawdown", "MaxDrawdown", "BuyPrice", "SellPrice", "EntryPrice", "ExitPrice",
    "Deployed", "StartEquity", "EndEquity", "Gross P/L", "Net P/L",
}


def format_money(value):
    try:
        return f"₹{float(value):,.2f}"
    except Exception:
        return str(value)


def format_metric_value(metric, value):
    if metric in MONEY_METRIC_NAMES:
        return format_money(value)
    if isinstance(value, (int, float)):
        return f"{value:,.2f}"
    return str(value)


class BacktestViewer(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Offline Tally-Style Backtest Dashboard")
        self.geometry("1360x820")
        self.minsize(980, 620)

        self.file_path = ""
        self.sheet_names = []
        self.current_df = None
        self.original_columns = []
        self.canvas = None

        self._build_ui()
        self._check_dependencies()
        self._load_default_file_if_present()

    def _build_ui(self):
        top = ttk.Frame(self, padding=10)
        top.pack(side=tk.TOP, fill=tk.X)

        ttk.Button(top, text="Upload Backtest File", command=self.open_file).pack(side=tk.LEFT)

        self.file_label = ttk.Label(top, text="No file loaded", width=90)
        self.file_label.pack(side=tk.LEFT, padx=10, fill=tk.X, expand=True)

        ttk.Label(top, text="Sheet:").pack(side=tk.LEFT)
        self.sheet_var = tk.StringVar()
        self.sheet_combo = ttk.Combobox(top, textvariable=self.sheet_var, state="readonly", width=32)
        self.sheet_combo.pack(side=tk.LEFT, padx=6)
        self.sheet_combo.bind("<<ComboboxSelected>>", lambda _event: self.load_selected_sheet())

        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill=tk.BOTH, expand=True, padx=10, pady=(0, 10))

        self.dashboard_tab = ttk.Frame(self.notebook)
        self.max_profit_tab = ttk.Frame(self.notebook)
        self.ratio_tab = ttk.Frame(self.notebook)
        self.ledger_tab = ttk.Frame(self.notebook)
        self.orders_tab = ttk.Frame(self.notebook)
        self.charts_tab = ttk.Frame(self.notebook)
        self.parameters_tab = ttk.Frame(self.notebook)

        self.notebook.add(self.dashboard_tab, text="Main Dashboard")
        self.notebook.add(self.max_profit_tab, text="Best Backtest Result")
        self.notebook.add(self.ratio_tab, text="Ratio Analysis")
        self.notebook.add(self.ledger_tab, text="Ledger Dashboard")
        self.notebook.add(self.orders_tab, text="Order Details")
        self.notebook.add(self.charts_tab, text="Diagrams")
        self.notebook.add(self.parameters_tab, text="Parameters")

        self._build_dashboard_tab()
        self._build_max_profit_tab()
        self._build_ratio_tab()
        self._build_ledger_tab()
        self._build_orders_tab()
        self._build_charts_tab()
        self._build_parameters_tab()

    def _build_dashboard_tab(self):
        self.summary_frame = ttk.LabelFrame(self.dashboard_tab, text="Summary", padding=12)
        self.summary_frame.pack(side=tk.TOP, fill=tk.X, padx=8, pady=8)

        self.summary_text = tk.Text(self.summary_frame, height=12, wrap=tk.WORD)
        self.summary_text.pack(fill=tk.X, expand=True)
        self.summary_text.configure(state=tk.DISABLED)

        columns_frame = ttk.Frame(self.dashboard_tab, padding=8)
        columns_frame.pack(fill=tk.BOTH, expand=True)

        self.columns_list = tk.Listbox(columns_frame)
        self.columns_list.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        help_text = (
            "Useful columns detected automatically:\n\n"
            "P/L: NetPnl, GrossPnl, Pnl, P/L %, PnlPercent\n"
            "Equity: EndEquity, Equity, EquityAfter, ClosingCapital\n"
            "Order: Date, Instrument, Type, Result, Reason, BuyPrice, SellPrice, Lots\n\n"
            "Open your backtest Excel file, then choose the sheet that contains trades."
        )
        self.help_label = ttk.Label(columns_frame, text=help_text, justify=tk.LEFT)
        self.help_label.pack(side=tk.LEFT, padx=12, anchor=tk.N)

    def _build_max_profit_tab(self):
        top = ttk.Frame(self.max_profit_tab, padding=8)
        top.pack(side=tk.TOP, fill=tk.X)
        ttk.Label(
            top,
            text="Single best backtest result from the uploaded data, selected by highest Net P/L.",
            justify=tk.LEFT,
        ).pack(side=tk.LEFT, fill=tk.X, expand=True)

        body = ttk.Frame(self.max_profit_tab, padding=8)
        body.pack(fill=tk.BOTH, expand=True)
        body.rowconfigure(1, weight=1)
        body.columnconfigure(0, weight=1)

        self.max_profit_text = tk.Text(body, height=10, wrap=tk.WORD)
        self.max_profit_text.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        self.max_profit_text.configure(state=tk.DISABLED)

        self.max_profit_tree = ttk.Treeview(
            body,
            columns=("Result", "Group", "Trades", "NetPnl", "WinRate", "ProfitFactor", "BestTrade", "WorstTrade"),
            show="headings",
        )
        headers = {
            "Result": "Result",
            "Group": "Group",
            "Trades": "Trades",
            "NetPnl": "Net P/L",
            "WinRate": "Win Rate %",
            "ProfitFactor": "Profit Factor",
            "BestTrade": "Best Trade",
            "WorstTrade": "Worst Trade",
        }
        for col, text in headers.items():
            self.max_profit_tree.heading(col, text=text)
            self.max_profit_tree.column(col, width=145, minwidth=80, stretch=True)
        yscroll = ttk.Scrollbar(body, orient=tk.VERTICAL, command=self.max_profit_tree.yview)
        self.max_profit_tree.configure(yscrollcommand=yscroll.set)
        self.max_profit_tree.grid(row=1, column=0, sticky="nsew")
        yscroll.grid(row=1, column=1, sticky="ns")

    def _build_ratio_tab(self):
        top = ttk.Frame(self.ratio_tab, padding=8)
        top.pack(side=tk.TOP, fill=tk.X)
        ttk.Label(
            top,
            text="Main ratios for share-market/backtest data: profitability, win/loss quality, drawdown, return, and recovery.",
            justify=tk.LEFT,
        ).pack(side=tk.LEFT, fill=tk.X, expand=True)

        body = ttk.Frame(self.ratio_tab, padding=8)
        body.pack(fill=tk.BOTH, expand=True)
        body.columnconfigure(0, weight=1)
        body.columnconfigure(1, weight=1)
        body.rowconfigure(0, weight=1)

        ratio_frame = ttk.LabelFrame(body, text="Main Ratio Analysis", padding=8)
        ratio_frame.grid(row=0, column=0, sticky="nsew", padx=(0, 6))
        instrument_frame = ttk.LabelFrame(body, text="Instrument-wise Analysis", padding=8)
        instrument_frame.grid(row=0, column=1, sticky="nsew", padx=(6, 0))

        self.ratio_tree = ttk.Treeview(ratio_frame, columns=("Metric", "Value"), show="headings")
        self.ratio_tree.heading("Metric", text="Metric")
        self.ratio_tree.heading("Value", text="Value")
        self.ratio_tree.column("Metric", width=240, stretch=True)
        self.ratio_tree.column("Value", width=160, stretch=True)
        self.ratio_tree.pack(fill=tk.BOTH, expand=True)

        self.instrument_tree = ttk.Treeview(
            instrument_frame,
            columns=("Instrument", "Trades", "WinRate", "GrossProfit", "GrossLoss", "NetPnl", "ProfitFactor"),
            show="headings",
        )
        headers = {
            "Instrument": "Instrument",
            "Trades": "Trades",
            "WinRate": "Win Rate %",
            "GrossProfit": "Gross Profit",
            "GrossLoss": "Gross Loss",
            "NetPnl": "Net P/L",
            "ProfitFactor": "Profit Factor",
        }
        for col, text in headers.items():
            self.instrument_tree.heading(col, text=text)
            self.instrument_tree.column(col, width=125, minwidth=80, stretch=True)
        self.instrument_tree.pack(fill=tk.BOTH, expand=True)

    def _build_ledger_tab(self):
        top = ttk.Frame(self.ledger_tab, padding=8)
        top.pack(side=tk.TOP, fill=tk.X)
        ttk.Label(
            top,
            text="Ledger-style summary grouped by date and instrument, similar to checking daybook/account movement.",
            justify=tk.LEFT,
        ).pack(side=tk.LEFT, fill=tk.X, expand=True)

        frame = ttk.Frame(self.ledger_tab, padding=8)
        frame.pack(fill=tk.BOTH, expand=True)
        self.ledger_tree = ttk.Treeview(
            frame,
            columns=("Date", "Instrument", "Trades", "Profit", "Loss", "NetPnl", "Charges", "Closing"),
            show="headings",
        )
        headers = {
            "Date": "Date",
            "Instrument": "Instrument",
            "Trades": "Trades",
            "Profit": "Profit",
            "Loss": "Loss",
            "NetPnl": "Net P/L",
            "Charges": "Charges",
            "Closing": "Closing Equity",
        }
        for col, text in headers.items():
            self.ledger_tree.heading(col, text=text)
            self.ledger_tree.column(col, width=140, minwidth=80, stretch=True)
        yscroll = ttk.Scrollbar(frame, orient=tk.VERTICAL, command=self.ledger_tree.yview)
        xscroll = ttk.Scrollbar(frame, orient=tk.HORIZONTAL, command=self.ledger_tree.xview)
        self.ledger_tree.configure(yscrollcommand=yscroll.set, xscrollcommand=xscroll.set)
        self.ledger_tree.grid(row=0, column=0, sticky="nsew")
        yscroll.grid(row=0, column=1, sticky="ns")
        xscroll.grid(row=1, column=0, sticky="ew")
        frame.rowconfigure(0, weight=1)
        frame.columnconfigure(0, weight=1)

    def _build_orders_tab(self):
        toolbar = ttk.Frame(self.orders_tab, padding=8)
        toolbar.pack(side=tk.TOP, fill=tk.X)

        ttk.Label(toolbar, text="Search:").pack(side=tk.LEFT)
        self.search_var = tk.StringVar()
        self.search_entry = ttk.Entry(toolbar, textvariable=self.search_var, width=32)
        self.search_entry.pack(side=tk.LEFT, padx=6)
        self.search_entry.bind("<Return>", lambda _event: self.refresh_table())
        ttk.Button(toolbar, text="Apply", command=self.refresh_table).pack(side=tk.LEFT)
        ttk.Button(toolbar, text="Clear", command=self.clear_search).pack(side=tk.LEFT, padx=6)
        ttk.Button(toolbar, text="Export Normalized Excel", command=self.export_normalized_excel).pack(side=tk.LEFT, padx=6)

        table_frame = ttk.Frame(self.orders_tab)
        table_frame.pack(fill=tk.BOTH, expand=True, padx=8, pady=(0, 8))

        self.tree = ttk.Treeview(table_frame, show="headings")
        yscroll = ttk.Scrollbar(table_frame, orient=tk.VERTICAL, command=self.tree.yview)
        xscroll = ttk.Scrollbar(table_frame, orient=tk.HORIZONTAL, command=self.tree.xview)
        self.tree.configure(yscrollcommand=yscroll.set, xscrollcommand=xscroll.set)

        self.tree.grid(row=0, column=0, sticky="nsew")
        yscroll.grid(row=0, column=1, sticky="ns")
        xscroll.grid(row=1, column=0, sticky="ew")
        table_frame.rowconfigure(0, weight=1)
        table_frame.columnconfigure(0, weight=1)

    def _build_charts_tab(self):
        self.chart_container = ttk.Frame(self.charts_tab, padding=8)
        self.chart_container.pack(fill=tk.BOTH, expand=True)

    def _build_parameters_tab(self):
        top = ttk.Frame(self.parameters_tab, padding=8)
        top.pack(side=tk.TOP, fill=tk.X)

        info = ttk.Label(
            top,
            text="All standard share-market/backtest parameters. Status shows whether the uploaded sheet had the field directly, mapped it from another field, or left it blank.",
            wraplength=1100,
            justify=tk.LEFT,
        )
        info.pack(side=tk.LEFT, fill=tk.X, expand=True)
        ttk.Button(top, text="Save Blank Template", command=self.save_parameter_template).pack(side=tk.RIGHT, padx=6)

        frame = ttk.Frame(self.parameters_tab, padding=8)
        frame.pack(fill=tk.BOTH, expand=True)

        self.parameter_tree = ttk.Treeview(frame, columns=("Group", "Parameter", "Status", "Source"), show="headings")
        for col, width in [("Group", 190), ("Parameter", 210), ("Status", 120), ("Source", 260)]:
            self.parameter_tree.heading(col, text=col)
            self.parameter_tree.column(col, width=width, minwidth=80, stretch=True)
        yscroll = ttk.Scrollbar(frame, orient=tk.VERTICAL, command=self.parameter_tree.yview)
        self.parameter_tree.configure(yscrollcommand=yscroll.set)
        self.parameter_tree.grid(row=0, column=0, sticky="nsew")
        yscroll.grid(row=0, column=1, sticky="ns")
        frame.rowconfigure(0, weight=1)
        frame.columnconfigure(0, weight=1)

    def _check_dependencies(self):
        missing = []
        if pd is None:
            missing.append(f"pandas/openpyxl problem: {PANDAS_ERROR}")
        if Figure is None or FigureCanvasTkAgg is None:
            missing.append(f"matplotlib problem: {MATPLOTLIB_ERROR}")
        if missing:
            messagebox.showwarning(
                "Python packages needed",
                "Install required packages first:\n\npip install pandas openpyxl matplotlib\n\n"
                + "\n".join(str(x) for x in missing),
            )

    def _load_default_file_if_present(self):
        for rel in PREFERRED_FILES:
            path = os.path.abspath(rel)
            if os.path.exists(path):
                self.load_file(path)
                return

    def open_file(self):
        path = filedialog.askopenfilename(
            title="Open Backtest Result",
            filetypes=[
                ("Backtest files", "*.xlsx *.xls *.csv *.json"),
                ("Excel files", "*.xlsx *.xls"),
                ("CSV files", "*.csv"),
                ("JSON files", "*.json"),
                ("All files", "*.*"),
            ],
        )
        if path:
            self.load_file(path)

    def load_file(self, path):
        if pd is None:
            messagebox.showerror("Missing package", "Please install pandas and openpyxl first.")
            return

        try:
            if path.lower().endswith(".csv"):
                self.file_path = path
                self.sheet_names = ["CSV"]
            elif path.lower().endswith(".json"):
                self.file_path = path
                self.sheet_names = ["JSON Trades"]
            else:
                excel = pd.ExcelFile(path)
                self.file_path = path
                self.sheet_names = list(excel.sheet_names)
        except Exception as exc:
            messagebox.showerror("Could not open file", str(exc))
            return

        self.file_label.configure(text=path)
        self.sheet_combo["values"] = self.sheet_names
        if self.sheet_names:
            preferred = self._pick_default_sheet(self.sheet_names)
            self.sheet_var.set(preferred)
            self.load_selected_sheet()

    def _pick_default_sheet(self, sheet_names):
        preferred_names = [
            "All Trades",
            "ALL DATE WISE",
            "Trades",
            "Market Visual",
            "NIFTY P-L",
            "SENSEX P-L",
            "BANKNIFTY P-L",
            "NIFTY",
            "SENSEX",
            "BANKNIFTY",
            "Daily NIFTY",
            "Daily SENSEX",
            "Daily BANKNIFTY",
            "Summary",
        ]
        for name in preferred_names:
            if name in sheet_names:
                return name
        return sheet_names[0]

    def load_selected_sheet(self):
        if not self.file_path:
            return
        sheet = self.sheet_var.get()
        try:
            if self.file_path.lower().endswith(".csv"):
                df = pd.read_csv(self.file_path)
            elif self.file_path.lower().endswith(".json"):
                df = dataframe_from_json(self.file_path)
            else:
                df = pd.read_excel(self.file_path, sheet_name=sheet)
        except Exception as exc:
            messagebox.showerror("Could not load sheet", str(exc))
            return

        df = df.dropna(how="all")
        df = expand_win_loss_sheet(df)
        sheet_upper = str(sheet).upper()
        if "Instrument" not in df.columns:
            if "NIFTY" in sheet_upper and "BANKNIFTY" not in sheet_upper:
                df["Instrument"] = "NIFTY"
            elif "SENSEX" in sheet_upper:
                df["Instrument"] = "SENSEX"
            elif "BANKNIFTY" in sheet_upper:
                df["Instrument"] = "BANKNIFTY"
        self.current_df, self.original_columns = with_standard_parameters(df)
        self.refresh_dashboard()
        self.refresh_max_profit()
        self.refresh_ratios()
        self.refresh_ledger()
        self.refresh_table()
        self.refresh_charts()
        self.refresh_parameters()

    def refresh_dashboard(self):
        df = self.current_df
        self.columns_list.delete(0, tk.END)
        if df is None:
            return

        for col in df.columns:
            self.columns_list.insert(tk.END, str(col))

        text = self.build_summary_text(df)
        self.summary_text.configure(state=tk.NORMAL)
        self.summary_text.delete("1.0", tk.END)
        self.summary_text.insert(tk.END, text)
        self.summary_text.configure(state=tk.DISABLED)

    def detect_position_rule(self, df):
        def first_value(*names):
            for name in names:
                col = find_col(df, name)
                if col:
                    values = df[col].dropna()
                    values = values[values.astype(str).str.strip() != ""]
                    if not values.empty:
                        return values.iloc[0]
            return ""

        rule = str(first_value("PositionRule")).strip()
        mode = str(first_value("PositionMode")).strip() or ("STEP-UP LADDER" if "step" in rule.lower() else "STEP-UP LADDER")
        start = first_value("PositionStart", "MinPosition", "PositionSize")
        step = first_value("PositionStep", "PositionStepSize")
        max_position = first_value("MaxPosition")
        no_limit = first_value("NoLimitPosition")

        if not start:
            start = 2500
        if not step:
            step = 2500
        if str(no_limit).strip().lower() in ["true", "yes", "1"] or "no max" in rule.lower() or "no limit" in str(max_position).lower():
            max_text = "NO LIMIT"
        elif max_position:
            max_text = str(max_position)
        else:
            max_text = "NO LIMIT"

        return {
            "mode": mode,
            "start": start,
            "step": step,
            "max_position": max_text,
        }

    def refresh_max_profit(self):
        self.max_profit_tree.delete(*self.max_profit_tree.get_children())
        self.max_profit_text.configure(state=tk.NORMAL)
        self.max_profit_text.delete("1.0", tk.END)
        if self.current_df is None:
            self.max_profit_text.configure(state=tk.DISABLED)
            return

        df = self.current_df.copy()
        cols = analysis_columns(df)
        pnl_col = cols["pnl"]
        if not pnl_col:
            self.max_profit_text.insert(tk.END, "No profit/loss column found.")
            self.max_profit_text.configure(state=tk.DISABLED)
            return

        pnl = to_number(df[pnl_col])
        group_col = find_col(df, "BacktestSet", "Instrument", "Symbol")
        date_col = cols["date"]
        type_col = find_col(df, "TradeType", "OptionType", "SignalType", "BuySell")
        reason_col = find_col(df, "ExitReason", "Reason")
        mult_col = cols["multiplier"]

        best_idx = pnl.idxmax() if len(pnl) else None
        worst_idx = pnl.idxmin() if len(pnl) else None

        def trade_label(idx):
            if idx is None:
                return ""
            row = df.loc[idx]
            parts = []
            if date_col:
                parts.append(str(row.get(date_col, "")))
            if group_col:
                parts.append(str(row.get(group_col, "")))
            if type_col:
                parts.append(str(row.get(type_col, "")))
            if reason_col:
                parts.append(str(row.get(reason_col, "")))
            parts.append(format_money(pnl.loc[idx]))
            if mult_col:
                try:
                    parts.append(f"{float(row.get(mult_col, 0)):.3f}x")
                except Exception:
                    pass
            return " | ".join([p for p in parts if p])

        whole = compute_ratios(df)
        lines = [
            f"Best Trade: {trade_label(best_idx)}",
            f"Worst Trade: {trade_label(worst_idx)}",
            f"All Data Net P/L: {format_money(whole['Net P/L'])}",
            f"All Data Profit Factor: {whole['Profit Factor']:.3f}",
            f"All Data Win Rate: {whole['Win Rate %']:.2f}%",
            "",
            "Only the best backtest result is shown below.",
        ]
        self.max_profit_text.insert(tk.END, "\n".join(lines))
        self.max_profit_text.configure(state=tk.DISABLED)

        if group_col:
            groups = []
            for group, frame in df.groupby(df[group_col].astype(str).replace("", "UNKNOWN")):
                r = compute_ratios(frame)
                fpnl = to_number(frame[pnl_col])
                best = fpnl.max() if len(fpnl) else 0
                worst = fpnl.min() if len(fpnl) else 0
                groups.append((group, r, best, worst))
            groups.sort(key=lambda item: item[1]["Net P/L"], reverse=True)
        else:
            groups = [("ALL", whole, pnl.max() if len(pnl) else 0, pnl.min() if len(pnl) else 0)]

        if groups:
            group, r, best, worst = groups[0]
            self.max_profit_tree.insert(
                "",
                tk.END,
                values=(
                    "BEST BACKTEST",
                    group,
                    int(r["Total Trades"]),
                    format_money(r["Net P/L"]),
                    f"{r['Win Rate %']:.2f}",
                    f"{r['Profit Factor']:.3f}",
                    format_money(best),
                    format_money(worst),
                ),
            )

    def refresh_ratios(self):
        self.ratio_tree.delete(*self.ratio_tree.get_children())
        self.instrument_tree.delete(*self.instrument_tree.get_children())
        if self.current_df is None:
            return

        ratios = compute_ratios(self.current_df)
        ratio_order = [
            "Total Trades", "Winning Trades", "Losing Trades", "Win Rate %",
            "Loss Rate %", "Gross Profit", "Gross Loss", "Net P/L",
            "Average Profit", "Average Loss", "Profit Factor", "Payoff Ratio",
            "Expectancy / Trade", "Opening Capital", "Closing Capital",
            "Return %", "Max Drawdown", "Recovery Factor", "Total Charges",
            "Average Multiplier", "Max Multiplier",
        ]
        for metric in ratio_order:
            self.ratio_tree.insert("", tk.END, values=(metric, format_metric_value(metric, ratios.get(metric, ""))))

        instrument_col = find_col(self.current_df, "Instrument", "Symbol")
        if instrument_col and self.current_df[instrument_col].astype(str).str.strip().any():
            grouped = self.current_df.groupby(self.current_df[instrument_col].astype(str).replace("", "UNKNOWN"))
            for instrument, group in grouped:
                r = compute_ratios(group)
                self.instrument_tree.insert(
                    "",
                    tk.END,
                    values=(
                        instrument,
                        int(r["Total Trades"]),
                        f"{r['Win Rate %']:.2f}",
                        format_money(r["Gross Profit"]),
                        format_money(r["Gross Loss"]),
                        format_money(r["Net P/L"]),
                        f"{r['Profit Factor']:.3f}",
                    ),
                )
        else:
            r = compute_ratios(self.current_df)
            self.instrument_tree.insert(
                "",
                tk.END,
                values=(
                    "ALL",
                    int(r["Total Trades"]),
                    f"{r['Win Rate %']:.2f}",
                    format_money(r["Gross Profit"]),
                    format_money(r["Gross Loss"]),
                    format_money(r["Net P/L"]),
                    f"{r['Profit Factor']:.3f}",
                ),
            )

    def refresh_ledger(self):
        self.ledger_tree.delete(*self.ledger_tree.get_children())
        if self.current_df is None:
            return

        df = self.current_df.copy()
        cols = analysis_columns(df)
        pnl_col = cols["pnl"]
        if not pnl_col:
            return

        date_col = cols["date"]
        instrument_col = cols["instrument"]
        charges_col = cols["charges"]
        closing_col = cols["equity_after"]

        df["_ledger_date"] = df[date_col].astype(str) if date_col else ""
        df["_ledger_instrument"] = df[instrument_col].astype(str).replace("", "ALL") if instrument_col else "ALL"
        df["_ledger_pnl"] = to_number(df[pnl_col])
        df["_ledger_charges"] = to_number(df[charges_col]) if charges_col else 0
        df["_ledger_closing"] = to_number(df[closing_col]) if closing_col else 0

        grouped = df.groupby(["_ledger_date", "_ledger_instrument"], dropna=False)
        rows = []
        for (date, instrument), group in grouped:
            pnl = group["_ledger_pnl"]
            rows.append({
                "Date": date,
                "Instrument": instrument,
                "Trades": len(group),
                "Profit": float(pnl[pnl > 0].sum()),
                "Loss": float(pnl[pnl < 0].sum()),
                "NetPnl": float(pnl.sum()),
                "Charges": float(group["_ledger_charges"].sum()) if "_ledger_charges" in group else 0,
                "Closing": float(group["_ledger_closing"].iloc[-1]) if "_ledger_closing" in group and group["_ledger_closing"].abs().sum() else 0,
            })

        rows.sort(key=lambda r: (str(r["Date"]), str(r["Instrument"])))
        for row in rows[:3000]:
            self.ledger_tree.insert(
                "",
                tk.END,
                values=(
                    row["Date"],
                    row["Instrument"],
                    row["Trades"],
                    format_money(row["Profit"]),
                    format_money(row["Loss"]),
                    format_money(row["NetPnl"]),
                    format_money(row["Charges"]),
                    format_money(row["Closing"]) if row["Closing"] else "",
                ),
            )

    def refresh_parameters(self):
        self.parameter_tree.delete(*self.parameter_tree.get_children())
        if self.current_df is None:
            return

        original_lookup = normalize_columns(self.original_columns)
        df_lookup = normalize_columns(self.current_df.columns)
        for group, parameters in PARAMETER_GROUPS.items():
            for parameter in parameters:
                direct = original_lookup.get(column_key(parameter))
                source = source_column(self.current_df.loc[:, self.original_columns], parameter) if self.original_columns else None
                if direct is not None:
                    status = "Found"
                    source_text = str(direct)
                elif source is not None:
                    status = "Mapped"
                    source_text = str(source)
                elif column_key(parameter) in df_lookup:
                    status = "Blank"
                    source_text = ""
                else:
                    status = "Missing"
                    source_text = ""
                self.parameter_tree.insert("", tk.END, values=(group, parameter, status, source_text))

    def build_summary_text(self, df):
        result_col = find_col(df, "Result", "WinLoss", "RawResult")
        pnl_col = best_numeric_column(df, "NetPnlAfterCharges", "NetPnl", "PnlAmount", "GrossPnl", "PnlPercent", "P/L %", "Pnl %")
        equity_col = best_numeric_column(df, "EquityAfter", "EndEquity", "ClosingCapital", "Equity")
        instrument_col = find_col(df, "Instrument", "Symbol")
        date_col = find_col(df, "Date")

        lines = []
        lines.append(f"Rows: {len(df):,}")
        lines.append(f"Columns: {len(df.columns):,}")

        if date_col:
            dates = df[date_col].dropna()
            dates = dates[dates.astype(str).str.strip() != ""]
            if not dates.empty:
                lines.append(f"Date range: {dates.iloc[0]} to {dates.iloc[-1]}")

        if instrument_col:
            instruments = df[instrument_col].dropna().astype(str).unique()
            lines.append(f"Instruments: {', '.join(instruments[:10])}")

        if result_col:
            values = df[result_col].astype(str).str.upper()
            wins = int(values.isin(["WIN", "PROFIT"]).sum())
            losses = int(values.isin(["LOSS"]).sum())
            total = wins + losses
            win_rate = (wins / total * 100) if total else 0
            lines.append(f"Wins: {wins:,}")
            lines.append(f"Losses: {losses:,}")
            lines.append(f"Win rate: {win_rate:.2f}%")

        if pnl_col:
            pnl = to_number(df[pnl_col])
            gross_profit = pnl[pnl > 0].sum()
            gross_loss = pnl[pnl < 0].sum()
            net = pnl.sum()
            avg_profit = pnl[pnl > 0].mean() if (pnl > 0).any() else 0
            avg_loss = pnl[pnl < 0].mean() if (pnl < 0).any() else 0
            profit_factor = gross_profit / abs(gross_loss) if gross_loss else 0
            lines.append("")
            lines.append(f"P/L column: {pnl_col}")
            lines.append(f"Gross profit: {format_money(gross_profit)}")
            lines.append(f"Gross loss: {format_money(gross_loss)}")
            lines.append(f"Net P/L: {format_money(net)}")
            lines.append(f"Average profit: {format_money(avg_profit)}")
            lines.append(f"Average loss: {format_money(avg_loss)}")
            lines.append(f"Profit factor: {profit_factor:.3f}")

        if equity_col:
            equity = to_number(df[equity_col])
            lines.append("")
            lines.append(f"Equity column: {equity_col}")
            lines.append(f"Start equity: {format_money(equity.iloc[0])}")
            lines.append(f"End equity: {format_money(equity.iloc[-1])}")
            lines.append(f"Max equity: {format_money(equity.max())}")
            lines.append(f"Min equity: {format_money(equity.min())}")

        return "\n".join(lines)

    def refresh_table(self):
        df = self.current_df
        self.tree.delete(*self.tree.get_children())
        if df is None:
            return

        display = df.copy()
        query = self.search_var.get().strip().lower()
        if query:
            mask = display.astype(str).apply(
                lambda row: row.str.lower().str.contains(query, regex=False).any(),
                axis=1,
            )
            display = display[mask]

        max_rows = 1000
        display = display.head(max_rows)
        non_blank_cols = []
        blank_cols = []
        for col in display.columns:
            has_data = display[col].astype(str).str.strip().replace("nan", "").ne("").any()
            (non_blank_cols if has_data else blank_cols).append(col)
        display = display.loc[:, non_blank_cols + blank_cols]
        cols = [str(c) for c in display.columns]
        self.tree["columns"] = cols
        for col in cols:
            self.tree.heading(col, text=col)
            self.tree.column(col, width=120, minwidth=70, stretch=True)

        for _, row in display.iterrows():
            values = [self.format_cell(row[col], col) for col in display.columns]
            self.tree.insert("", tk.END, values=values)

    def format_cell(self, value, column=None):
        if pd.isna(value):
            return ""
        if column is not None and str(column) in MONEY_COLUMN_NAMES:
            try:
                if str(value).strip() == "":
                    return ""
                return format_money(value)
            except Exception:
                pass
        if isinstance(value, float):
            return f"{value:.4f}".rstrip("0").rstrip(".")
        return str(value)

    def clear_search(self):
        self.search_var.set("")
        self.refresh_table()

    def export_normalized_excel(self):
        if self.current_df is None:
            messagebox.showinfo("No data", "Open a backtest file first.")
            return
        path = filedialog.asksaveasfilename(
            title="Save Normalized Backtest Excel",
            defaultextension=".xlsx",
            filetypes=[("Excel files", "*.xlsx")],
            initialfile="normalized-backtest-parameters.xlsx",
        )
        if not path:
            return
        try:
            self.current_df.to_excel(path, index=False)
        except Exception as exc:
            messagebox.showerror("Export failed", str(exc))
            return
        messagebox.showinfo("Export complete", f"Saved:\n{path}")

    def save_parameter_template(self):
        path = filedialog.asksaveasfilename(
            title="Save Blank Parameter Template",
            defaultextension=".xlsx",
            filetypes=[("Excel files", "*.xlsx")],
            initialfile="share-market-profit-loss-template.xlsx",
        )
        if not path:
            return
        try:
            template = pd.DataFrame(columns=ALL_PARAMETERS)
            with pd.ExcelWriter(path, engine="openpyxl") as writer:
                template.to_excel(writer, index=False, sheet_name="Backtest Parameters")
                rows = [
                    {"Group": group, "Parameter": parameter}
                    for group, parameters in PARAMETER_GROUPS.items()
                    for parameter in parameters
                ]
                pd.DataFrame(rows).to_excel(writer, index=False, sheet_name="Parameter List")
        except Exception as exc:
            messagebox.showerror("Template failed", str(exc))
            return
        messagebox.showinfo("Template complete", f"Saved:\n{path}")

    def refresh_charts(self):
        for child in self.chart_container.winfo_children():
            child.destroy()

        if self.current_df is None:
            return
        if Figure is None or FigureCanvasTkAgg is None:
            ttk.Label(self.chart_container, text="Install matplotlib to view diagrams.").pack()
            return

        df = self.current_df.copy()
        pnl_col = best_numeric_column(df, "NetPnlAfterCharges", "NetPnl", "PnlAmount", "GrossPnl", "PnlPercent", "P/L %", "Pnl %")
        equity_col = best_numeric_column(df, "EquityAfter", "EndEquity", "ClosingCapital", "Equity")
        date_col = find_col(df, "Date")

        fig = Figure(figsize=(12, 7.5), dpi=100)
        fig.subplots_adjust(hspace=0.55, wspace=0.3)

        has_chart = False
        if pnl_col:
            ax1 = fig.add_subplot(221)
            pnl = to_number(df[pnl_col])
            cumulative = pnl.cumsum()
            x = df[date_col].astype(str) if date_col else range(1, len(df) + 1)
            ax1.plot(list(range(len(cumulative))), cumulative, color="#2563eb", linewidth=1.6)
            ax1.set_title(f"Cumulative P/L ({pnl_col})")
            ax1.set_ylabel("P/L")
            ax1.grid(True, alpha=0.25)
            if date_col and len(df) > 0:
                ticks = [0, len(df) // 2, len(df) - 1]
                ax1.set_xticks(ticks)
                ax1.set_xticklabels([str(x.iloc[i]) for i in ticks], rotation=0)
            has_chart = True

        if equity_col:
            ax2 = fig.add_subplot(222 if pnl_col else 111)
            equity = to_number(df[equity_col])
            ax2.plot(list(range(len(equity))), equity, color="#16a34a", linewidth=1.6)
            ax2.set_title(f"Equity Curve ({equity_col})")
            ax2.set_ylabel("Equity")
            ax2.grid(True, alpha=0.25)
            if date_col and len(df) > 0:
                ticks = [0, len(df) // 2, len(df) - 1]
                ax2.set_xticks(ticks)
                ax2.set_xticklabels([str(df[date_col].astype(str).iloc[i]) for i in ticks], rotation=0)
            has_chart = True

        result_col = find_col(df, "Result", "WinLoss", "RawResult")
        if result_col:
            ax3 = fig.add_subplot(223)
            values = df[result_col].astype(str).str.upper()
            wins = int(values.isin(["WIN", "PROFIT", "TRUE"]).sum())
            losses = int(values.isin(["LOSS", "FALSE"]).sum())
            if wins or losses:
                ax3.pie([wins, losses], labels=["Wins", "Losses"], autopct="%1.1f%%", colors=["#16a34a", "#dc2626"])
                ax3.set_title("Win / Loss Ratio")
                has_chart = True

        instrument_col = find_col(df, "Instrument", "Symbol")
        if pnl_col and instrument_col and df[instrument_col].astype(str).str.strip().any():
            ax4 = fig.add_subplot(224)
            temp = pd.DataFrame({
                "Instrument": df[instrument_col].astype(str).replace("", "UNKNOWN"),
                "Pnl": to_number(df[pnl_col]),
            })
            grouped = temp.groupby("Instrument")["Pnl"].sum().sort_values(ascending=False).head(12)
            ax4.bar(grouped.index.astype(str), grouped.values, color="#7c3aed")
            ax4.set_title("Net P/L by Instrument")
            ax4.tick_params(axis="x", rotation=25)
            ax4.grid(True, axis="y", alpha=0.25)
            has_chart = True

        if not has_chart:
            ttk.Label(
                self.chart_container,
                text="No chart columns found. Need NetPnl/GrossPnl/Pnl or EndEquity/Equity.",
            ).pack(anchor=tk.NW)
            return

        self.canvas = FigureCanvasTkAgg(fig, master=self.chart_container)
        self.canvas.draw()
        self.canvas.get_tk_widget().pack(fill=tk.BOTH, expand=True)


def main():
    app = BacktestViewer()
    app.mainloop()


if __name__ == "__main__":
    main()
