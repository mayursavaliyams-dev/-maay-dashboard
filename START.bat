@echo off
title Expiry-Friday-5x  TRADING BOT  (keep this window open)
color 0A

REM ============================================================
REM  START the trading bot.
REM  Double-click this file to turn the engine ON.
REM  A green window will open and stay open while it runs.
REM  Closing this window = the bot stops.
REM ============================================================

REM Run from THIS file's own folder (the current project), NOT the old D: backup.
cd /d "%~dp0"

echo ============================================================
echo   EXPIRY-FRIDAY-5X  TRADING BOT
echo ============================================================
echo.
echo   Starting the engine on http://localhost:3000 ...
echo   Please wait about 5 seconds, the dashboard will open.
echo.
echo   KEEP THIS WINDOW OPEN while you are trading.
echo   To STOP: close this window, or double-click STOP.bat
echo ============================================================
echo.

REM Open the dashboard in the default browser after a short delay,
REM so the server has time to start listening on port 3000.
start "" cmd /c "timeout /t 5 /nobreak >nul & start http://localhost:3000/dashboard.html"

REM Run the server in THIS window so logs are visible.
node server.js

REM If node exits (crash or you pressed Ctrl+C), pause so you can read why.
echo.
echo ============================================================
echo   The bot has STOPPED.
echo ============================================================
pause
