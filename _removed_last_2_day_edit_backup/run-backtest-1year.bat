@echo off
title ANTIGRAVITY — 1-YEAR BACKTEST (Direct Run)
cd /d "%~dp0"

echo.
echo ===========================================================
echo   ANTIGRAVITY — Running 1-Year Backtest DIRECTLY
echo   Instrument: ALL (NIFTY + BANKNIFTY + SENSEX)
echo   Days: 365
echo   This will take 15-30+ minutes due to API rate limits.
echo ===========================================================
echo.

node backtest-30d-sweep.js 365 ALL 2>&1

echo.
echo ===========================================================
echo   Done! Results saved to data\sweep-cache\last-run.json
echo ===========================================================
echo.
pause
