@echo off
title ANTIGRAVITY — 30-Day NIFTY Backtest
echo.
echo ══════════════════════════════════════════════════════
echo   ANTIGRAVITY — Starting 30-Day NIFTY Backtest...
echo   This may take 3-5 minutes (API rate limits).
echo   Results will be saved to: backtest-30d-output.log
echo ══════════════════════════════════════════════════════
echo.

cd /d "%~dp0"
node backtest-30d-sweep.js 30 NIFTY 2>&1 | powershell -Command "& { $input | Tee-Object -FilePath 'backtest-30d-output.log' }"

echo.
echo ══════════════════════════════════════════════════════
echo   Done! Results saved to backtest-30d-output.log
echo   Raw JSON saved to data\sweep-cache\last-run.json
echo ══════════════════════════════════════════════════════
echo.
pause
