@echo off
title ANTIGRAVITY — 1-YEAR BACKTEST
cd /d "%~dp0"

echo.
echo ══════════════════════════════════════════════════════════
echo   ANTIGRAVITY — 1-Year Backtest (365 trading days)
echo   This will take 15-30+ minutes due to API rate limits.
echo ══════════════════════════════════════════════════════════
echo.

echo   Stopping old server instances...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo   Starting server...
start "Antigravity Server" cmd /k "node server.js"

echo   Waiting for server to boot...
timeout /t 5 /nobreak >nul

echo   Opening backtest dashboard...
start http://localhost:3000/backtest.html

echo.
echo   ════════════════════════════════════════════════════
echo   Server running. Backtest page opened in browser.
echo   Select 365 days (1 Year) and click RUN.
echo   ════════════════════════════════════════════════════
echo   Press any key to close this launcher window.
pause >nul
