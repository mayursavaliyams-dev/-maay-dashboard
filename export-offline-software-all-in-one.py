from pathlib import Path

import pandas as pd


OUT_DIR = Path("exports")
OUT_DIR.mkdir(exist_ok=True)

OUT_FILE = OUT_DIR / "offline-software-all-in-one-backtesting.xlsx"

SOURCES = [
    (
        "Whole",
        OUT_DIR / "whole-backtesting-complete-2500-nolimit.xlsx",
        [
            "All Trades",
            "Summary",
            "Max Profit",
            "Ratio Analysis",
            "Yearly",
            "Exit Reasons",
            "By Type",
            "Daily NIFTY",
            "Daily SENSEX",
            "Daily BANKNIFTY",
            "TV NIFTY",
            "TV SENSEX",
            "TV BANKNIFTY",
            "Parameter Template",
        ],
    ),
    (
        "NoLimit",
        OUT_DIR / "daily-all-indices-6trades-equity-500000-position-2500-nolimit-ladder-charges-0.09-all-date-wise-rounded-graph.xlsx",
        [
            "Summary",
            "ALL DATE WISE",
            "WIN LOSS",
            "Equity Graph",
            "Pnl Graph",
            "SENSEX",
            "NIFTY",
            "BANKNIFTY",
        ],
    ),
    (
        "PL",
        OUT_DIR / "daily-nifty-sensex-banknifty-profit-loss.xlsx",
        [
            "Summary",
            "NIFTY P-L",
            "SENSEX P-L",
            "BANKNIFTY P-L",
        ],
    ),
]


def sheet_name(prefix, name):
    if prefix == "Whole":
        base = name
    else:
        base = f"{prefix} {name}"
    bad = "[]:*?/\\"
    clean = "".join("_" if ch in bad else ch for ch in base)
    return clean[:31]


def main():
    written = []
    skipped = []
    with pd.ExcelWriter(OUT_FILE, engine="openpyxl") as writer:
        for prefix, path, preferred_sheets in SOURCES:
            if not path.exists():
                print(f"Missing source, skipped: {path}")
                continue
            xls = pd.ExcelFile(path)
            for source_sheet in preferred_sheets:
                if source_sheet not in xls.sheet_names:
                    continue
                try:
                    df = pd.read_excel(path, sheet_name=source_sheet)
                except Exception as exc:
                    skipped.append((path.name, source_sheet, str(exc)))
                    continue
                target = sheet_name(prefix, source_sheet)
                df.to_excel(writer, sheet_name=target, index=False)
                written.append((target, len(df), path.name, source_sheet))

        index_rows = [
            {
                "Sheet": target,
                "Rows": rows,
                "SourceFile": source_file,
                "SourceSheet": source_sheet,
            }
            for target, rows, source_file, source_sheet in written
        ]
        pd.DataFrame(index_rows).to_excel(writer, sheet_name="Workbook Index", index=False)
        if skipped:
            pd.DataFrame(
                [
                    {"SourceFile": source_file, "SourceSheet": source_sheet, "Reason": reason}
                    for source_file, source_sheet, reason in skipped
                ]
            ).to_excel(writer, sheet_name="Skipped Sheets", index=False)

    print(OUT_FILE.resolve())
    print(f"Sheets written: {len(written) + 1}")


if __name__ == "__main__":
    main()
