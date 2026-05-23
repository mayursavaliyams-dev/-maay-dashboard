@echo off
title Expiry-Friday-5x  STOP
color 0C

REM ============================================================
REM  STOP the trading bot.
REM  Double-click this file to turn the engine OFF completely.
REM  It finds the running server (port 3000) and shuts it down.
REM ============================================================

echo ============================================================
echo   STOPPING the Expiry-Friday-5x trading bot ...
echo ============================================================
echo.

REM Find whatever process is listening on port 3000 and kill it.
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo   Stopping server process PID %%P ...
    taskkill /PID %%P /F >nul 2>&1
)

echo.
echo   Done. The bot is now OFF.
echo   (If it was already stopped, nothing happened - that is fine.)
echo.
echo ============================================================
echo   You can close this window.
echo ============================================================
echo.
timeout /t 4 /nobreak >nul
