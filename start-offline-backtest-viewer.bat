@echo off
cd /d "%~dp0"
python offline_backtest_viewer.py
if errorlevel 1 (
  echo.
  echo If Python packages are missing, run:
  echo pip install pandas openpyxl matplotlib
  echo.
  pause
)
